// api/admin/marketplace/[action].js

const { getFirebaseAdmin } = require('../../../lib/firebase-admin');
const { requireAdmin } = require('../../../lib/auth');
const { TIERS } = require('../../../lib/vendor-subscriptions');
const { sendEmail, sendNotification, getRecipient } = require('../../utils/[action]');

const BATCH_LIMIT = 400; // stay comfortably under Firestore's 500-write batch cap

/**
 * Consolidated admin marketplace router — one Vercel serverless function
 * serving multiple routes via the [action] dynamic segment, to stay under
 * the Hobby plan's 12-function-per-deployment cap. URL paths are unchanged
 * from the original standalone files, so no frontend calls need updating:
 *
 *   POST /api/admin/marketplace/suspend-product    -> handleSuspendProduct
 *   POST /api/admin/marketplace/suspend-vendor     -> handleSuspendVendor
 *   GET  /api/admin/marketplace/get-platform-stats -> handleGetPlatformStats
 *
 * get-platform-stats is GET and computed via the Admin SDK deliberately —
 * an unfiltered collectionGroup('sales') scan can't be proven safe by
 * Firestore's client-side rule validator (it checks a query's *shape*
 * against the rules, not the caller's actual identity), since our sales
 * rule mixes isAdmin() with data-dependent buyerUid/vendorUid conditions
 * and this query has no matching where() clause. Running it server-side
 * sidesteps that entirely, since the Admin SDK bypasses rules altogether.
 *
 * Each handler's internal logic is preserved exactly as it was in its
 * original standalone file — only the routing/admin-check wrapper is shared.
 */
module.exports = async (req, res) => {
  const { action } = req.query;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    const adminUser = await requireAdmin(req, admin);

    if (req.method === 'GET' && action === 'get-platform-stats') {
      return await handleGetPlatformStats(req, res, admin, db);
    }
    if (req.method === 'GET' && action === 'lookup-subscription-payment') {
      return await handleLookupSubscriptionPayment(req, res, db);
    }
    if (req.method === 'GET' && action === 'get-audit-log') {
      return await handleGetAuditLog(req, res, db);
    }
    if (req.method === 'GET' && action === 'admin-list-disputes') {
      return await handleAdminListDisputes(req, res, db);
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    switch (action) {
      case 'suspend-product':
        return await handleSuspendProduct(req, res, admin, db, adminUser);
      case 'suspend-vendor':
        return await handleSuspendVendor(req, res, admin, db, adminUser);
      case 'toggle-storefront':
        return await handleToggleStorefront(req, res, admin, db, adminUser);
      case 'set-subscription-override':
        return await handleSetSubscriptionOverride(req, res, admin, db, adminUser);
      case 'add-dispute-note': return await handleAddDisputeNote(req, res, admin, db, adminUser);
      case 'resolve-dispute': return await handleResolveDispute(req, res, admin, db, adminUser);
      default:
        return res.status(404).json({ error: `Unknown action: ${action}` });
    }

  } catch (err) {
    console.error(`admin/marketplace/${action} error:`, err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

/**
 * GET /api/admin/marketplace/get-platform-stats
 * Admin only. Computes platform-wide totals by summing in memory rather
 * than relying on the Admin SDK's aggregate() API, deliberately — avoids
 * any risk of an aggregate-API version mismatch, at the cost of reading
 * every sales/vendors doc. Fine for an infrequently-called admin report at
 * current scale; worth revisiting with real aggregate queries or cached
 * counters if the sales collection grows very large.
 */
async function handleGetPlatformStats(req, res, admin, db) {
  const [salesSnap, vendorsSnap, subscriptionPaymentsSnap] = await Promise.all([
    db.collectionGroup('sales').get(),
    db.collection('vendors').get(),
    db.collectionGroup('subscriptionPayments').get()
  ]);

  let totalVolume = 0;
  let saleCount = 0;

  salesSnap.forEach((doc) => {
    const s = doc.data();
    totalVolume += s.amount || 0;
    saleCount += 1;
  });

  let totalPendingPayout = 0;
  let totalAwaitingPayout = 0;
  let totalPaidOut = 0;
  let vendorCount = 0;
  const activeVendorCountByTier = Object.fromEntries(Object.keys(TIERS).map((tierKey) => [tierKey, 0]));

  vendorsSnap.forEach((doc) => {
    const v = doc.data();
    totalPendingPayout += v.pendingPayout || 0;
    totalAwaitingPayout += v.awaitingPayout || 0;
    totalPaidOut += v.totalPaidOut || 0;
    vendorCount += 1;

    const tierKey = Object.prototype.hasOwnProperty.call(TIERS, v.subscriptionTier)
      ? v.subscriptionTier
      : 'safseed';
    if (tierKey === 'safseed' || v.subscriptionStatus === 'active') {
      activeVendorCountByTier[tierKey] += 1;
    }
  });

  let totalSubscriptionRevenue = 0;
  const subscriptionRevenueByTier = Object.fromEntries(Object.keys(TIERS).map((tierKey) => [tierKey, 0]));
  subscriptionPaymentsSnap.forEach((doc) => {
    const payment = doc.data();
    if (payment.status !== 'success') return;
    const tierKey = payment.tier;
    if (!Object.prototype.hasOwnProperty.call(TIERS, tierKey)) return;
    const amount = typeof payment.amount === 'number' ? payment.amount : 0;
    totalSubscriptionRevenue += amount;
    subscriptionRevenueByTier[tierKey] += amount;
  });

  const mostPopularTierKey = Object.keys(TIERS).reduce((leader, tierKey) =>
    activeVendorCountByTier[tierKey] > activeVendorCountByTier[leader] ? tierKey : leader
  , 'safseed');
  const tierLabels = Object.fromEntries(Object.entries(TIERS).map(([tierKey, tier]) => [tierKey, tier.displayName]));

  return res.status(200).json({
    success: true,
    totalVolume,
    saleCount,
    totalSubscriptionRevenue,
    subscriptionRevenueByTier,
    activeVendorCountByTier,
    mostPopularTier: {
      key: mostPopularTierKey,
      displayName: TIERS[mostPopularTierKey].displayName,
      activeVendorCount: activeVendorCountByTier[mostPopularTierKey]
    },
    tierLabels,
    totalPendingPayout,
    totalAwaitingPayout,
    totalPaidOut,
    vendorCount
  });
}

/**
 * POST /api/admin/marketplace/suspend-product
 * Reactive moderation tool — since vendor products publish without
 * pre-approval, this is how a problematic listing gets pulled. Reuses the
 * existing isActive flag (already checked by create-transaction.js and the
 * public product-details page) rather than introducing a second flag.
 *
 * Body: { productId, suspend: boolean, reason? }
 */
async function handleSuspendProduct(req, res, admin, db, adminUser) {
  const { productId, suspend, reason } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing productId' });
  }
  if (typeof suspend !== 'boolean') {
    return res.status(400).json({ error: 'suspend must be true or false' });
  }

  const productRef = db.collection('vendorProducts').doc(productId);
  const productSnap = await productRef.get();

  if (!productSnap.exists) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (!suspend && productSnap.data().subscriptionLapsed === true) {
    return res.status(409).json({
      error: 'This product was deactivated because the vendor subscription lapsed. The vendor must renew before it can be reactivated.',
      reasonCode: 'subscription_lapsed'
    });
  }

  const update = {
    isActive: !suspend,
    adminSuspended: suspend,
    updatedAt: admin.firestore.Timestamp.now()
  };

  if (suspend) {
    update.suspendedReason = reason || '';
    update.suspendedAt = admin.firestore.Timestamp.now();
  } else {
    update.suspendedReason = admin.firestore.FieldValue.delete();
    update.suspendedAt = admin.firestore.FieldValue.delete();
  }

  await productRef.set(update, { merge: true });
  await writeAdminAuditLog(db, admin, adminUser, { action: suspend ? 'suspend_product' : 'reactivate_product', vendorUid: productSnap.data().vendorUid, productId, details: { reason: reason || '', newIsActive: !suspend } });

  return res.status(200).json({ success: true, productId, isActive: !suspend });
}

/**
 * POST /api/admin/marketplace/suspend-vendor
 * Suspending a vendor:
 *   - sets vendors/{uid}.isSuspended = true
 *   - deactivates (isActive: false) every currently-active product they own,
 *     so suspension takes effect immediately across their whole catalog
 *   - blocks future product creation and payout requests (enforced in the
 *     consolidated marketplace/vendors routers, which check isSuspended)
 *
 * Reactivating a vendor only clears isSuspended — it deliberately does NOT
 * auto-reactivate their products, so each listing gets a manual review
 * before going back live.
 *
 * Body: { vendorUid, suspend: boolean, reason? }
 */
async function handleSuspendVendor(req, res, admin, db, adminUser) {
  const { vendorUid, suspend, reason } = req.body || {};

  if (!vendorUid || typeof vendorUid !== 'string') {
    return res.status(400).json({ error: 'Missing vendorUid' });
  }
  if (typeof suspend !== 'boolean') {
    return res.status(400).json({ error: 'suspend must be true or false' });
  }

  const vendorRef = db.collection('vendors').doc(vendorUid);

  const vendorUpdate = {
    isSuspended: suspend,
    updatedAt: admin.firestore.Timestamp.now()
  };
  if (suspend) {
    vendorUpdate.suspendedReason = reason || '';
    vendorUpdate.suspendedAt = admin.firestore.Timestamp.now();
  } else {
    vendorUpdate.suspendedReason = admin.firestore.FieldValue.delete();
    vendorUpdate.suspendedAt = admin.firestore.FieldValue.delete();
  }

  await vendorRef.set(vendorUpdate, { merge: true });

  let deactivatedCount = 0;

  if (suspend) {
    const activeProductsSnap = await db.collection('vendorProducts')
      .where('vendorUid', '==', vendorUid)
      .where('isActive', '==', true)
      .get();

    const docs = activeProductsSnap.docs;
    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach((doc) => {
        batch.set(doc.ref, {
          isActive: false,
          adminSuspended: true,
          suspendedReason: 'Vendor account suspended',
          suspendedAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      });
      await batch.commit();
      deactivatedCount += chunk.length;
    }
  }

  await writeAdminAuditLog(db, admin, adminUser, { action: suspend ? 'suspend_vendor' : 'reactivate_vendor', vendorUid, details: { reason: reason || '', newIsSuspended: suspend, deactivatedProductCount: deactivatedCount } });

  return res.status(200).json({
    success: true,
    vendorUid,
    isSuspended: suspend,
    deactivatedProductCount: deactivatedCount
  });
}

async function handleToggleStorefront(req, res, admin, db, adminUser) {
  const { vendorUid, storefrontActive } = req.body || {};
  if (!vendorUid || typeof vendorUid !== 'string') return res.status(400).json({ error: 'Missing vendorUid' });
  if (typeof storefrontActive !== 'boolean') return res.status(400).json({ error: 'storefrontActive must be true or false' });
  const vendorRef = db.collection('vendors').doc(vendorUid);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) return res.status(404).json({ error: 'Vendor not found' });
  const oldValue = vendorSnap.data().storefrontActive !== false;
  await vendorRef.set({ storefrontActive, subscriptionUpdatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  await writeAdminAuditLog(db, admin, adminUser, { action: 'toggle_storefront', vendorUid, details: { oldStorefrontActive: oldValue, newStorefrontActive: storefrontActive } });
  return res.status(200).json({ success: true, vendorUid, storefrontActive });
}

async function handleSetSubscriptionOverride(req, res, admin, db, adminUser) {
  const { vendorUid, overrideActive } = req.body || {};
  if (!vendorUid || typeof vendorUid !== 'string') return res.status(400).json({ error: 'Missing vendorUid' });
  if (typeof overrideActive !== 'boolean') return res.status(400).json({ error: 'overrideActive must be true or false' });
  const vendorRef = db.collection('vendors').doc(vendorUid);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) return res.status(404).json({ error: 'Vendor not found' });
  const oldValue = vendorSnap.data().subscriptionOverrideActive === true;
  await vendorRef.set({ subscriptionOverrideActive: overrideActive, subscriptionUpdatedAt: admin.firestore.Timestamp.now() }, { merge: true });

  let reactivatedProductCount = 0;
  if (overrideActive) {
    const lapsedSnap = await db.collection('vendorProducts')
      .where('vendorUid', '==', vendorUid).where('subscriptionLapsed', '==', true).get();
    const eligibleDocs = lapsedSnap.docs.filter((doc) => doc.data().adminSuspended !== true);
    for (let i = 0; i < eligibleDocs.length; i += BATCH_LIMIT) {
      const chunk = eligibleDocs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach((doc) => batch.set(doc.ref, {
        isActive: true,
        subscriptionLapsed: false,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true }));
      await batch.commit();
      reactivatedProductCount += chunk.length;
    }
  }
  await writeAdminAuditLog(db, admin, adminUser, { action: overrideActive ? 'set_subscription_override' : 'clear_subscription_override', vendorUid, details: { oldOverrideActive: oldValue, newOverrideActive: overrideActive, reactivatedProductCount } });
  return res.status(200).json({ success: true, vendorUid, subscriptionOverrideActive: overrideActive, reactivatedProductCount });
}

async function handleLookupSubscriptionPayment(req, res, db) {
  const reference = typeof req.query.reference === 'string' ? req.query.reference.trim() : '';
  if (!reference) return res.status(400).json({ error: 'Missing reference' });
  const snap = await db.collectionGroup('subscriptionPayments').where('reference', '==', reference).limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'No payment found with that reference' });
  const paymentDoc = snap.docs[0];
  const vendorUid = paymentDoc.ref.parent.parent.id;
  return res.status(200).json({ success: true, vendorUid, payment: { id: paymentDoc.id, ...paymentDoc.data() } });
}

async function handleGetAuditLog(req, res, db) {
  const vendorUid = typeof req.query.vendorUid === 'string' ? req.query.vendorUid.trim() : '';
  let q = db.collection('adminAuditLog');
  if (vendorUid) q = q.where('vendorUid', '==', vendorUid);
  const snap = await q.orderBy('createdAt', 'desc').limit(200).get();
  const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const enriched = await enrichAuditLogEntries(db, entries);
  return res.status(200).json({ success: true, entries: enriched });
}

/**
 * Attaches human-readable labels to each raw audit log entry so the Activity
 * pane never has to show a bare Firestore UID — vendor name/email, product
 * title, and (for dispute-related actions) the order reference in place of
 * a bare disputeId. Looks up each unique id once via Promise.all rather than
 * once per entry, same pattern as enrichDisputesWithLabels above.
 */
async function enrichAuditLogEntries(db, entries) {
  const vendorUids = [...new Set(entries.map((e) => e.vendorUid).filter(Boolean))];
  const productIds = [...new Set(entries.map((e) => e.productId).filter(Boolean))];
  const disputeIds = [...new Set(entries.map((e) => e.details?.disputeId).filter(Boolean))];

  const [vendorUserDocs, vendorDocs, productDocs, disputeDocs] = await Promise.all([
    Promise.all(vendorUids.map((uid) => db.collection('user').doc(uid).get())),
    Promise.all(vendorUids.map((uid) => db.collection('vendors').doc(uid).get())),
    Promise.all(productIds.map((id) => db.collection('vendorProducts').doc(id).get())),
    Promise.all(disputeIds.map((id) => db.collection('disputes').doc(id).get()))
  ]);

  const vendorMap = new Map();
  vendorUids.forEach((uid, i) => {
    const userData = vendorUserDocs[i].exists ? vendorUserDocs[i].data() : null;
    const vendorData = vendorDocs[i].exists ? vendorDocs[i].data() : null;
    const email = userData?.email || null;
    const name = vendorData?.vendorFirstName || userData?.firstName || userData?.displayName || (email ? email.split('@')[0] : null);
    vendorMap.set(uid, { name: name || 'Unknown vendor', email: email || '\u2014' });
  });

  const productMap = new Map();
  productIds.forEach((id, i) => {
    const snap = productDocs[i];
    productMap.set(id, snap.exists ? (snap.data().title || 'Untitled product') : 'Deleted product');
  });

  const disputeMap = new Map();
  disputeIds.forEach((id, i) => {
    const snap = disputeDocs[i];
    disputeMap.set(id, snap.exists ? (snap.data().reference || 'Storefront complaint') : 'Deleted dispute');
  });

  return entries.map((e) => {
    const vendor = e.vendorUid ? (vendorMap.get(e.vendorUid) || { name: 'Unknown vendor', email: '\u2014' }) : null;
    return Object.assign({}, e, {
      vendorName: vendor ? vendor.name : null,
      vendorEmail: vendor ? vendor.email : null,
      productTitle: e.productId ? (productMap.get(e.productId) || e.productId) : null,
      disputeReference: e.details?.disputeId ? (disputeMap.get(e.details.disputeId) || null) : null
    });
  });
}

async function writeAdminAuditLog(db, admin, adminUser, entry) {
  try {
    await db.collection('adminAuditLog').add({
      adminUid: adminUser.uid,
      adminEmail: adminUser.email || null,
      action: entry.action,
      vendorUid: entry.vendorUid || null,
      productId: entry.productId || null,
      details: entry.details || {},
      createdAt: admin.firestore.Timestamp.now()
    });
  } catch (err) {
    console.error('Failed to write admin audit log:', err);
  }
}

async function handleAdminListDisputes(req, res, db) {
  const status = typeof req.body?.status === 'string' ? req.body.status : (typeof req.query.status === 'string' ? req.query.status : '');
  const snap = await db.collection('disputes').get();
  const disputes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => !status || d.status === status).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || ((b.updatedAt?._seconds || b.updatedAt?.seconds || 0) - (a.updatedAt?._seconds || a.updatedAt?.seconds || 0)));
  const enriched = await enrichDisputesWithLabels(db, disputes);
  return res.status(200).json({ success: true, disputes: enriched });
}

/**
 * Attaches human-readable labels (buyer/vendor name + email, product title)
 * to each dispute so the admin UI never has to show raw Firestore UIDs.
 * Looks up each unique buyerUid/vendorUid/productId once via Promise.all,
 * rather than once per dispute, so a dispute list doesn't re-fetch the same
 * user/vendor doc repeatedly.
 */
async function enrichDisputesWithLabels(db, disputes) {
  const buyerUids = [...new Set(disputes.map((d) => d.buyerUid).filter(Boolean))];
  const vendorUids = [...new Set(disputes.map((d) => d.vendorUid).filter(Boolean))];
  const productIds = [...new Set(disputes.map((d) => d.productId).filter(Boolean))];

  const [buyerUserDocs, vendorUserDocs, vendorDocs, productDocs] = await Promise.all([
    Promise.all(buyerUids.map((uid) => db.collection('user').doc(uid).get())),
    Promise.all(vendorUids.map((uid) => db.collection('user').doc(uid).get())),
    Promise.all(vendorUids.map((uid) => db.collection('vendors').doc(uid).get())),
    Promise.all(productIds.map((id) => db.collection('vendorProducts').doc(id).get()))
  ]);

  const labelFor = (userData, vendorData) => {
    const email = userData?.email || null;
    const name = vendorData?.vendorFirstName || userData?.firstName || userData?.displayName || (email ? email.split('@')[0] : null);
    return { name: name || 'Unknown', email: email || '\u2014' };
  };

  const buyerMap = new Map();
  buyerUids.forEach((uid, i) => {
    const userData = buyerUserDocs[i].exists ? buyerUserDocs[i].data() : null;
    buyerMap.set(uid, labelFor(userData, null));
  });

  const vendorMap = new Map();
  vendorUids.forEach((uid, i) => {
    const userData = vendorUserDocs[i].exists ? vendorUserDocs[i].data() : null;
    const vendorData = vendorDocs[i].exists ? vendorDocs[i].data() : null;
    vendorMap.set(uid, labelFor(userData, vendorData));
  });

  const productMap = new Map();
  productIds.forEach((id, i) => {
    const snap = productDocs[i];
    productMap.set(id, snap.exists ? (snap.data().title || 'Untitled product') : 'Deleted product');
  });

  return disputes.map((d) => {
    const buyer = buyerMap.get(d.buyerUid) || { name: 'Unknown buyer', email: '\u2014' };
    const vendor = vendorMap.get(d.vendorUid) || { name: 'Unknown vendor', email: '\u2014' };
    return Object.assign({}, d, {
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      vendorName: vendor.name,
      vendorEmail: vendor.email,
      productTitle: d.productId ? (productMap.get(d.productId) || d.productId) : '\u2014'
    });
  });
}

async function handleAddDisputeNote(req, res, admin, db, adminUser) {
  const { disputeId, note } = req.body || {};
  if (!disputeId || typeof note !== 'string' || !note.trim()) return res.status(400).json({ error: 'disputeId and note are required' });
  const ref = db.collection('disputes').doc(disputeId); const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Dispute not found' });
  const now = admin.firestore.Timestamp.now();
  await ref.set({ adminNotes: admin.firestore.FieldValue.arrayUnion({ note: note.trim(), adminUid: adminUser.uid, createdAt: now }), updatedAt: now }, { merge: true });
  await writeAdminAuditLog(db, admin, adminUser, { action: 'add_dispute_note', vendorUid: snap.data().vendorUid, details: { disputeId, note: note.trim() } });
  return res.status(200).json({ success: true });
}

async function handleResolveDispute(req, res, admin, db, adminUser) {
  const { disputeId, resolution, resolutionNote } = req.body || {};
  if (!disputeId || !['resolved_buyer', 'resolved_vendor', 'closed'].includes(resolution)) return res.status(400).json({ error: 'Invalid dispute resolution' });
  const ref = db.collection('disputes').doc(disputeId); const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Dispute not found' });
  const dispute = snap.data();

  // Guard against double-processing: a dispute that's already resolved/closed
  // must not be resolved again, since that would re-release or re-forfeit the
  // held vendor amount a second time.
  if (['resolved_buyer', 'resolved_vendor', 'closed'].includes(dispute.status)) {
    return res.status(409).json({ error: 'This dispute has already been resolved' });
  }

  let refundStatus = 'not_applicable';
  if (resolution === 'resolved_buyer') {
    const secret = process.env.PAYSTACK_SECRET_KEY_MARKETPLACE;
    try {
      const refund = await fetch('https://api.paystack.co/refund', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: dispute.reference }) });
      const body = await refund.json();
      if (!refund.ok || body.status === false) throw new Error(body.message || 'Paystack refund failed');
      refundStatus = 'triggered';
    } catch (err) {
      console.error('DISPUTE REFUND FAILED — manual action required:', dispute.reference, err.message);
      await ref.set({ resolution: `refund_failed: ${resolutionNote || err.message}`, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      await writeAdminAuditLog(db, admin, adminUser, { action: 'resolve_dispute_refund_failed', vendorUid: dispute.vendorUid, details: { disputeId, resolution, reference: dispute.reference, error: err.message } });
      return res.status(502).json({ error: 'Refund failed; dispute was not marked resolved. Manual action required.', refundStatus: 'failed' });
    }
  }

  const now = admin.firestore.Timestamp.now();

  // The vendor's earnings for this sale were deducted from pendingPayout the
  // moment the dispute was filed (see createDispute in api/disputes/[action].js).
  // Release that hold back to the vendor if the dispute resolves in their favor
  // or is closed without fault. If it resolves against the buyer's favor
  // (resolved_buyer), the hold is forfeited permanently — it stays deducted,
  // since that amount already left the platform via the Paystack refund above.
  const holdAmount = typeof dispute.holdAmount === 'number' ? dispute.holdAmount : 0;
  const shouldReleaseHold = dispute.holdApplied === true && dispute.holdReleased !== true && holdAmount > 0 && resolution !== 'resolved_buyer';

  if (shouldReleaseHold) {
    const vendorRef = db.collection('vendors').doc(dispute.vendorUid);
    await db.runTransaction(async (tx) => {
      tx.set(ref, { status: resolution, resolution: resolutionNote || resolution, updatedAt: now, refundStatus, holdReleased: true }, { merge: true });
      tx.set(vendorRef, { pendingPayout: admin.firestore.FieldValue.increment(holdAmount), updatedAt: now }, { merge: true });
    });
  } else {
    await ref.set({ status: resolution, resolution: resolutionNote || resolution, updatedAt: now, refundStatus }, { merge: true });
  }

  await writeAdminAuditLog(db, admin, adminUser, { action: 'resolve_dispute', vendorUid: dispute.vendorUid, details: { disputeId, resolution, refundStatus, holdAmount, holdReleased: shouldReleaseHold } });
  notifyDisputeOutcome(admin, db, dispute, resolution, refundStatus).catch(() => {});
  return res.status(200).json({ success: true, status: resolution, refundStatus });
}

async function notifyDisputeOutcome(admin, db, dispute, resolution, refundStatus) {
  try {
    const [buyer, vendor] = await Promise.all([getRecipient(admin, db, dispute.buyerUid, ['user']), getRecipient(admin, db, dispute.vendorUid, ['user', 'vendors'])]);
    const message = `Dispute ${dispute.reference} was updated to ${resolution}.`;
    await Promise.all([
      sendNotification({ recipientUid: dispute.buyerUid, title: 'Dispute updated', message, link: '/users/marketplace-orders.html', type: 'dispute_resolved' }),
      sendNotification({ recipientUid: dispute.vendorUid, title: 'Dispute updated', message, link: '/users/sellers-page.html#disputes-pane', type: 'dispute_resolved' })
    ]);
  } catch (err) { console.error('Dispute outcome notification failed:', err.message); }
}