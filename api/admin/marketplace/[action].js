// api/admin/marketplace/[action].js

const { getFirebaseAdmin } = require('../../../lib/firebase-admin');
const { requireAdmin } = require('../../../lib/auth');

const BATCH_LIMIT = 400; // stay comfortably under Firestore's 500-write batch cap

/**
 * Consolidated admin marketplace router — one Vercel serverless function
 * serving multiple routes via the [action] dynamic segment, to stay under
 * the Hobby plan's 12-function-per-deployment cap. URL paths are unchanged
 * from the original standalone files, so no frontend calls need updating:
 *
 *   POST /api/admin/marketplace/suspend-product  -> handleSuspendProduct
 *   POST /api/admin/marketplace/suspend-vendor   -> handleSuspendVendor
 *
 * Each handler's internal logic is preserved exactly as it was in its
 * original standalone file — only the routing/admin-check wrapper is shared.
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    await requireAdmin(req, admin);

    switch (action) {
      case 'suspend-product':
        return await handleSuspendProduct(req, res, admin, db);
      case 'suspend-vendor':
        return await handleSuspendVendor(req, res, admin, db);
      default:
        return res.status(404).json({ error: `Unknown action: ${action}` });
    }

  } catch (err) {
    console.error(`admin/marketplace/${action} error:`, err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

/**
 * POST /api/admin/marketplace/suspend-product
 * Reactive moderation tool — since vendor products publish without
 * pre-approval, this is how a problematic listing gets pulled. Reuses the
 * existing isActive flag (already checked by create-transaction.js and the
 * public product-details page) rather than introducing a second flag.
 *
 * Body: { productId, suspend: boolean, reason? }
 */
async function handleSuspendProduct(req, res, admin, db) {
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
async function handleSuspendVendor(req, res, admin, db) {
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

  return res.status(200).json({
    success: true,
    vendorUid,
    isSuspended: suspend,
    deactivatedProductCount: deactivatedCount
  });
}