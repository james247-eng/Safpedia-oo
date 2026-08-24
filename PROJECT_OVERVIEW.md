# Project Overview: Safpedia Marketplace

SAFpedia is a Firebase/Vercel marketplace integrated with the SAFpedia digital library. Static HTML pages and browser ES modules provide the buyer, vendor and admin interfaces; Vercel serverless functions under `api/` handle trusted operations.

## Features

- Vendor stores and product listings for physical and digital products.
- Paystack checkout, order history, digital download links and fulfilment tracking.
- Buyer complaints/disputes, vendor responses, notifications and admin resolution.
- Admin vendor management, storefront controls, subscriptions, audits and refunds.
- Digital library: courses, ebooks, audio, podcasts, enrolment and certificates.
- Affiliate referrals and commissions, user dashboards, notifications and profiles.

## Files

The repository contains the HTML entry points in the root, `pages/`, `users/`, and the admin dashboard directory; shared styles in `css/` and nested CSS folders; browser logic in `js/`, `users/js/`, `pages/js/`, and admin assets; Firebase setup in `firebase-config.js` and `lib/`; and serverless handlers in `api/`. Each page imports its stylesheet and one or more ES modules. API files import shared Firebase Admin, authentication, email/notification and payment helpers. Use `rg --files` for the current complete file list (the inventory includes HTML, CSS, JS and every API function).

## Payment flow

Buyers select a product, the browser requests a Paystack transaction from `api/marketplace/create-transaction`, and Paystack hosts payment. The webhook verifies the event, records a sale under `vendorProducts/{productId}/sales/{reference}`, updates the buyer order, credits the vendor pending balance and records eligible affiliate commission. Physical orders are fulfilled by vendors; digital orders receive a signed download link. Library purchases follow the analogous Paystack flow through the course transaction/webhook handlers and create enrolment/purchase records. Vendor payouts are requested from the vendor balance and settled through Paystack transfer webhooks.

## Authentication and Authorization

Firebase Authentication identifies users. `lib/auth.js` verifies ID tokens for APIs and reads the `user` profile role. Buyers access their orders and complaints, vendors access their own products, sales and disputes, and admins must have the `admin` role for management endpoints. Firestore rules and server-side ownership checks provide the second authorization layer.

## External APIs

- Paystack: checkout, transaction verification, refunds and vendor/affiliate transfers; integrated through serverless functions and webhooks.
- Firebase Authentication, Firestore and Storage: identity, marketplace/library data and files.
- Cloudinary: protected digital asset/download URL generation where configured.
- Resend/email and application notification helpers: transactional email and in-app notifications.

## Environment-Variables

`FIREBASE_SERVICE_ACCOUNT` configures Firebase Admin; `PAYSTACK_SECRET_KEY` and public Paystack configuration authorize payments; `APP_URL` builds notification links; Cloudinary credentials configure protected assets; email provider credentials configure transactional mail. Values are configured in Vercel/project environment settings and are never committed.

## Subscription and Membership

Vendors choose a pricing tier and monthly or annual cycle. The subscription transaction is initialized with Paystack, confirmed by the marketplace webhook, and stored under `vendors/{uid}/subscriptionPayments`. The vendor profile receives tier, active status and expiry dates; tier limits and storefront availability are enforced by marketplace/admin handlers. Admins can grant or clear a subscription override. Subscription payment success is shown by the subscription success page.

## Firestore

Firestore stores user profiles, vendor storefront/product data, nested sales and subscription payments, library content and enrolments, purchases, complaints, notifications, affiliate records and admin audit data. Browser clients query permitted collections; sensitive writes and payment state changes occur in serverless functions using Firebase Admin and merge/transaction operations.

## Firestore collections

- `user` / `users`: profiles, roles, contact and membership metadata.
- `vendors`: vendor storefront, subscription state and `subscriptionPayments` subcollections.
- `vendorProducts`: listings, inventory, media and nested `sales` records.
- `purchases`: verified library and marketplace payment records.
- `disputes`: buyer complaints, vendor responses, admin notes and resolutions.
- `notifications`: in-app messages by recipient.
- `affiliates` and nested `commissions`/`payoutRequests`: referral earnings and transfers.
- Library collections such as courses, ebooks, audio/podcasts, enrolments and certificates.
- Admin audit and operational collections used by dashboard handlers.
