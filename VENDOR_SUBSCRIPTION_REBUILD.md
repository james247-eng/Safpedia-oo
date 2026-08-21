# Vendor Subscription Rebuild — Safpedia Marketplace

**Status:** Planning complete. Build in progress.
**Purpose of this file:** Single source of truth for what we are changing, why, and in what order. Codex should reference this file throughout the build instead of relying on chat history. Update this file's checkboxes as milestones complete — do not delete decided sections, only check them off.

---

## 1. What we are replacing

**Old model:** Vendors list products for free. Platform takes a commission (default 15%, `settings/marketplace.platformCommissionRate`) off every sale via `api/marketplace/webhook.js`. Vendor keeps the remainder in `pendingPayout`.

**New model:** Vendors pay a subscription fee for one of three tiers. Subscribed vendors keep the full sale amount (no commission split). Product-listing ability is gated by active subscription status + tier product limit. Vendors absorb Paystack's processing fee themselves (encouraged to build it into their prices — no platform-side handling needed).

Renewal is **manual only** — vendor manually initiates a one-off payment each cycle via Paystack (card, transfer, etc.). We do **not** store card details or use Paystack's native recurring Subscription/auto-debit API. Nothing charges a vendor automatically.

---

## 2. The three tiers

| | Safseed (Tier 1) | SafBloom (Tier 2) | SafScale (Tier 3) |
|---|---|---|---|
| Price | Free | ₦6,300/month | ₦10,500/month |
| Annual price | N/A | ₦68,796/year (9% off ₦75,600) | ₦108,360/year (14% off ₦126,000) |
| Duration | Lifetime (never expires) | 30 days per cycle | 30 days per cycle |
| Product limit | 3 (active products) | 30 (active products) | 75 (active products) |
| Storefront | **Yes** — but capped at 3 products, meant to motivate upgrade | Yes | Yes |
| Support | Basic | Dedicated customer management dashboard, order tracking panel, conflict resolution support, 24/7 support | Everything in Tier 2 + VIP support, marketing support, listing priority, product recommendation |
| Membership Room | No | Automatic access | Automatic access |

**Upgrade/downgrade:** No proration for v1. Buying a new tier overwrites the current one and starts a fresh `subscriptionExpiresAt` from the new payment date. Simple, revisit later if needed.

**Product limit counts active products only** (not lifetime total ever created).

---

## 3. Data model additions

### `vendors/{uid}` — new fields
| Field | Type | Meaning |
|---|---|---|
| `subscriptionTier` | string | `safseed` \| `safbloom` \| `safscale` |
| `subscriptionStatus` | string | `active` \| `expired` \| `none` (safseed has no real status concept but store `active` for consistency) |
| `subscriptionExpiresAt` | Timestamp \| null | End of current paid period. Null for safseed. |
| `subscriptionStartedAt` | Timestamp \| null | Start of current period |
| `subscriptionPaystackReference` | string \| null | Last successful payment's reference, for vendor to quote to admin |
| `subscriptionOverrideActive` | boolean | Admin manual override — see §5. Stays true until admin manually clears it. |
| `subscriptionUpdatedAt` | Timestamp | Last state change |

### `vendors/{uid}/subscriptionPayments/{reference}` — new subcollection
One doc per subscription payment attempt (success or fail), so vendor and admin both have a full history to reference.
| Field | Type |
|---|---|
| `reference` | string |
| `tier` | string |
| `amount` | number |
| `billingCycle` | `monthly` \| `annual` |
| `status` | `success` \| `failed` |
| `createdAt` | Timestamp |

### `vendorProducts/{productId}` — new field
| Field | Type | Meaning |
|---|---|---|
| `subscriptionLapsed` | boolean | Set true when cron deactivates a product due to vendor's subscription expiry. **Distinct from `adminSuspended`.** Cron/renewal logic only ever touches products with this flag — never touches `adminSuspended` products. |

### `disputes/{disputeId}` — new top-level collection (see §6)
| Field | Type |
|---|---|
| `orderId` / `reference` | string |
| `buyerUid`, `vendorUid`, `productId` | string |
| `status` | `open` \| `investigating` \| `resolved_buyer` \| `resolved_vendor` \| `closed` |
| `reason` | string |
| `buyerStatement` | string |
| `vendorStatement` | string \| null |
| `adminNotes` | array of `{ note, adminUid, createdAt }` |
| `resolution` | string \| null |
| `createdAt`, `updatedAt` | Timestamp |

---

## 4. Server-side gate logic (centralized)

New shared module: `lib/vendor-subscriptions.js` — single source of truth for tier config and gate checks, used by `handleCreateProduct` and anywhere else that needs it.

**Check order for "can this vendor create a product":**
1. Load vendor doc.
2. `isSuspended === true` → reject (admin block, applies regardless of plan or override).
3. If tier ≠ safseed: check `subscriptionStatus === 'active'` AND `subscriptionOverrideActive === true` OR `subscriptionExpiresAt > now` → reject with "subscription expired, please renew" if neither holds.
4. Count vendor's currently **active** products (`vendorProducts` where `vendorUid == uid AND isActive == true`).
5. Compare count against tier's limit. If at/over limit → reject with a specific "upgrade required" response (not generic error) — frontend uses this to show the upgrade prompt.

**Frontend behavior on limit-reached rejection:**
- Do **not** clear the Add Product form.
- Show an inline upgrade prompt above the submit button.
- Persist the filled form data (all fields + selected files' metadata, where feasible) to `localStorage` so that if the vendor navigates away or the tab reloads, the form is prefilled and awaiting resubmission once they've upgraded.

---

## 5. Product/vendor lifecycle rules

| Action | Effect |
|---|---|
| **Vendor deletes a product** | Hard delete: remove Firestore doc **and** Cloudinary assets (images + digital file). New handler needed — no delete-product action currently exists. |
| **Admin suspends a product** | `isActive: false`, `adminSuspended: true`. Removed from marketplace/storefront. Doc stays intact. |
| **Admin reactivates a product** | `isActive: true`, `adminSuspended: false`. Reappears on marketplace. |
| **Admin suspends a vendor** | Existing behavior — `isSuspended: true`, deactivates all currently-active products (marks them, doesn't touch `subscriptionLapsed` state). |
| **Admin deactivates a vendor's entire storefront** | New: single toggle that hides the storefront + all products at once, separate from suspending individual listings. |
| **Vendor's subscription expires (cron)** | Sets `subscriptionStatus: 'expired'`. Deactivates all currently-active products, marking them `subscriptionLapsed: true` (only — never sets `adminSuspended`). |
| **Vendor renews subscription (successful payment)** | Sets `subscriptionStatus: 'active'`, new `subscriptionExpiresAt`. Reactivates only products where `subscriptionLapsed === true`. Products with `adminSuspended === true` stay suspended — resubscribing never undoes an admin suspension. |
| **Admin manually overrides a subscription ban** | Sets `subscriptionOverrideActive: true`. Cron job skips vendors with this flag set (does not re-expire them even if `subscriptionExpiresAt` has passed). **Stays on until admin manually turns it off** — no auto-clear on next successful payment; admin must explicitly review and toggle. |

---

## 6. Cron job — subscription expiry

- **New file:** `api/cron/expire-vendor-subscriptions.js`, scheduled via `vercel.json` Vercel Cron, runs every 24 hours.
- Query: `vendors` where `subscriptionStatus == 'active' AND subscriptionExpiresAt < now AND subscriptionOverrideActive != true` (safseed vendors excluded — no expiry).
- For each match: set `subscriptionStatus: 'expired'`, deactivate their active products per §5, tagging `subscriptionLapsed: true`.
- Naturally per-vendor scoped since the comparison is against each vendor's own `subscriptionExpiresAt` — no global reset time.

---

## 7. Storefront gating

- Free-tier (Safseed) vendors **keep their storefront** — capped naturally at 3 products, intended as an upgrade incentive.
- Storefront route itself (not just the dashboard button) needs the real access check server-side wherever it's rendered/served, respecting the new **storefront-level admin toggle** (§5) — if admin has deactivated a vendor's whole storefront, the public route must reflect that regardless of subscription state.

---

## 8. Admin panel additions (`vendor-management.html` / `admin-vendor-management.js`)

Building this as a full product, not a patch:

- [ ] **Storefront-level toggle** per vendor — hides whole storefront + all products at once, distinct from suspending individual listings.
- [ ] **Subscription tab per vendor** — current tier, status, expiry, `subscriptionOverrideActive` toggle, and full payment history pulled from `subscriptionPayments` subcollection.
- [ ] **Payment reference lookup bar** — admin pastes a reference (that a vendor sent them), jumps straight to that payment record. This is what makes the vendor "copy ID, send to admin" flow actually usable.
- [ ] **Filter/search vendors** by tier (safseed/safbloom/safscale) and status (active/expired/suspended) on the main vendor list.
- [ ] **Audit trail** on all admin actions — who suspended/reactivated/overrode what and when. Needed before this handles real disputes.
- [ ] **Disputes/Conflict Resolution tab** — see §9. Building alongside now, not deferred.

---

## 9. Conflict Resolution / Disputes system — building now, not later

Trigger case: buyer pays, doesn't receive what they paid for, vendor won't refund.

**New collection:** `disputes/{disputeId}` (see §3 for schema).

**Buyer side:**
- [ ] "Report a problem with this order" entry point on the buyer's order view, linked to a specific `reference`/sale record.
- [ ] Dispute submission form: reason + statement.

**Vendor side:**
- [ ] Vendor sees disputes filed against their sales in their dashboard.
- [ ] Vendor can respond with their own statement.

**Admin side:**
- [ ] Disputes tab in admin panel (reserved nav slot now, full build alongside this project — not a stub).
- [ ] Admin views buyer statement, vendor statement, order/sale record, and can add internal notes.
- [ ] Admin sets resolution: `resolved_buyer` (e.g. trigger refund via existing Paystack refund path already used for oversold items) or `resolved_vendor` (dismiss) or `closed`.
- [ ] Resolution updates the sale/order record status so both parties see the outcome.

**New/edited API files (tentative, confirm during build):**
- `api/disputes/[action].js` — new router: `create-dispute`, `respond-to-dispute` (vendor), `resolve-dispute` (admin), `list-disputes`.
- Extend admin panel and seller dashboard to surface dispute status.

---

## 10. Vendor dashboard additions (`sellers-page.html` / `seller-dashboard.js`)

- [ ] **Subscription section**: current tier, status (active/failed/pending), expiry date.
- [ ] **Payment history list**: each past subscription payment with its Paystack reference and a **copy-to-clipboard** button — this is what the vendor sends to admin when disputing "I paid but nothing happened."
- [ ] **Upgrade prompt UI**: shown inline (not a blocking modal that clears the form) when product-limit gate rejects a create-product attempt.
- [ ] **Add Product form localStorage persistence**: on any interruption/failure, save form state to `localStorage`; on page return, prefill and await resubmission.
- [ ] Disputes surfaced here too (see §9).

---

## 11. Explicitly decided — do not re-litigate

- Manual renewal only. No stored card, no Paystack native auto-debit subscriptions.
- No proration on upgrade/downgrade — new payment simply overwrites tier + resets expiry.
- Vendors absorb Paystack processing fees (encouraged to build into pricing — no platform code needed for this).
- Historical sales keep existing commission fields untouched; new sales post-cutover write `commissionAmount: 0, vendorAmount: amount`.
- Product limit = active products only, not lifetime count.
- `subscriptionOverrideActive` stays on until admin manually clears it — no auto-clear on next payment.
- Product-limit rejection never clears the vendor's in-progress form; shows upgrade prompt inline instead, backed by localStorage persistence.
- Free tier keeps its storefront (capped at 3 products) rather than losing it.
- Deleted products are hard-deleted everywhere (Firestore + Cloudinary). Suspended products are soft-deactivated and reversible.
- `subscriptionLapsed` and `adminSuspended` are independent flags — resubscribing never reverses an admin suspension.
- Disputes/conflict resolution is built as part of this project, not deferred to later.

---

## 12. Build milestones

- [x] **M1 — Data model & core gate.** `lib/vendor-subscriptions.js` (tier config + gate function), new vendor fields, product-limit + status checks wired into `handleCreateProduct` in `api/marketplace/[action].js`.
- [x] **M2 — Subscription payment flow.** New action to initialize a subscription payment (Paystack, marketplace account, `orderType: 'vendor_subscription'` metadata), webhook handling in `api/marketplace/webhook.js` for subscription `charge.success`, writes to `subscriptionPayments` subcollection.
- [x] **M3 — Product delete (hard) endpoint.** New handler: Firestore doc removal + Cloudinary asset destroy.
- [x] **M4 — Cron expiry job.** `api/cron/expire-vendor-subscriptions.js` + `vercel.json` schedule. Product deactivation with `subscriptionLapsed` tagging on lapse; reactivation logic on renewal respecting `adminSuspended`.
- [x] **M5 — Storefront gating.** Server-side check on storefront route respecting tier + admin storefront-toggle.
- [ ] **M6 — Vendor dashboard UI.** Subscription section, payment history + copy reference, upgrade prompt (non-blocking), localStorage form persistence.
- [ ] **M7 — Admin panel: subscriptions.** Subscription tab per vendor, override toggle, payment lookup bar, tier/status filters, storefront-level toggle, audit trail.
- [ ] **M8 — Disputes system.** `disputes` collection, `api/disputes/[action].js`, buyer report-a-problem flow, vendor response flow, admin resolution flow + refund trigger.
- [ ] **M9 — Pricing page & copy update.** `pages/pricing.html` reflects the three tiers; remove old "no subscription" commission-model copy.
- [ ] **M10 — Cutover & QA.** Confirm old commission code paths are cleanly retired or clearly marked legacy-only for historical data; end-to-end test each tier's create/expire/renew/reactivate cycle and one full dispute cycle.

---

*This file should be updated (checkboxes ticked, decisions appended under §11 if new ones arise) as the build progresses. Do not remove earlier sections when adding new ones.*
