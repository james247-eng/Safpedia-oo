const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { getAuthedUser } = require('../../lib/auth');
const { sendEmail, sendNotification, getRecipient } = require('../utils/[action]');

const APP_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

// ====================================================================
// SECURITY HELPER: HTML Entity Encoding for Input Sanitization
// Prevents Stored XSS attacks in Admin & Seller Dashboards
// ====================================================================
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = async (req, res) => {
  const { action } = req.query;
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const user = await getAuthedUser(req, admin);
    if (req.method === 'POST' && action === 'create-dispute') return createDispute(req, res, admin, db, user);
    if (req.method === 'POST' && action === 'respond-to-dispute') return respondToDispute(req, res, admin, db, user);
    if (req.method === 'GET' && action === 'list-disputes') return listDisputes(req, res, db, user);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`disputes/${action} error:`, err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
  }
};

async function createDispute(req, res, admin, db, user) {
  const { reference, vendorUid, reason, buyerStatement } = req.body || {};
  
  // Storefront complaints are not tied to a particular order.
  if (!reference && vendorUid) {
    if (typeof vendorUid !== 'string' || !reason || !buyerStatement) {
      return res.status(400).json({ error: 'vendorUid, reason, and buyerStatement are required' });
    }
    if (vendorUid === user.uid) {
      return res.status(400).json({ error: 'You cannot complain about your own store' });
    }
    const vendorSnap = await db.collection('user').doc(vendorUid).get();
    if (!vendorSnap.exists) return res.status(404).json({ error: 'Vendor not found' });
    
    const now = admin.firestore.Timestamp.now();
    const ref = db.collection('disputes').doc();
    
    const cleanReason = escapeHtml(reason.trim());
    const cleanStatement = escapeHtml(buyerStatement.trim());

    await ref.set({ 
      reference: null, 
      buyerUid: user.uid, 
      vendorUid, 
      productId: null, 
      status: 'open', 
      reason: cleanReason, 
      buyerStatement: cleanStatement, 
      vendorStatement: null, 
      adminNotes: [], 
      resolution: null, 
      createdAt: now, 
      updatedAt: now, 
      source: 'vendor_store' 
    });
    
    notifyVendorDispute(admin, db, vendorUid, 'storefront complaint', cleanReason).catch(() => {});
    return res.status(201).json({ success: true, complaintId: ref.id, status: 'open' });
  }

  if (!reference || typeof reference !== 'string' || !reason || typeof reason !== 'string' || !buyerStatement || typeof buyerStatement !== 'string') {
    return res.status(400).json({ error: 'reference, reason, and buyerStatement are required' });
  }

  const matches = await db.collectionGroup('sales').where('reference', '==', reference.trim()).limit(1).get();
  if (matches.empty) return res.status(404).json({ error: 'Order not found' });
  const sale = matches.docs[0].data();
  if (sale.buyerUid !== user.uid) return res.status(403).json({ error: 'You cannot dispute this order' });

  const existing = await db.collection('disputes').where('reference', '==', reference.trim()).get();
  const activeExisting = existing.docs.find((doc) => ['open', 'investigating'].includes(doc.data().status));
  if (activeExisting) return res.status(409).json({ error: 'An active dispute already exists for this order', disputeId: activeExisting.id });

  const now = admin.firestore.Timestamp.now();
  const disputeRef = db.collection('disputes').doc();
  
  const cleanReason = escapeHtml(reason.trim());
  const cleanStatement = escapeHtml(buyerStatement.trim());

  await disputeRef.set({ 
    reference: reference.trim(), 
    buyerUid: user.uid, 
    vendorUid: sale.vendorUid, // FIX: Ensure vendorUid is attached for seller dashboard filtering
    productId: sale.productId || null, 
    status: 'open', 
    reason: cleanReason, 
    buyerStatement: cleanStatement, 
    vendorStatement: null, 
    adminNotes: [], 
    resolution: null, 
    createdAt: now, 
    updatedAt: now 
  });

  notifyVendorDispute(admin, db, sale.vendorUid, reference.trim(), cleanReason).catch(() => {});
  return res.status(201).json({ success: true, disputeId: disputeRef.id, status: 'open' });
}

async function respondToDispute(req, res, admin, db, user) {
  const { disputeId, vendorStatement } = req.body || {};
  if (!disputeId || typeof vendorStatement !== 'string' || !vendorStatement.trim()) {
    return res.status(400).json({ error: 'disputeId and vendorStatement are required' });
  }
  
  const ref = db.collection('disputes').doc(disputeId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Dispute not found' });
  
  const dispute = snap.data();
  if (dispute.vendorUid !== user.uid) return res.status(403).json({ error: 'You cannot respond to this dispute' });
  if (!['open', 'investigating'].includes(dispute.status)) return res.status(409).json({ error: 'This dispute is already resolved or closed' });
  
  const now = admin.firestore.Timestamp.now();
  const cleanVendorStatement = escapeHtml(vendorStatement.trim());

  await ref.set({ vendorStatement: cleanVendorStatement, status: 'investigating', updatedAt: now }, { merge: true });
  notifyBuyerVendorResponse(admin, db, dispute.buyerUid, dispute.reference).catch(() => {});
  return res.status(200).json({ success: true, status: 'investigating' });
}

async function notifyBuyerVendorResponse(admin, db, buyerUid, reference) {
  try {
    const buyer = await getRecipient(admin, db, buyerUid, ['user', 'users']);
    const link = `${APP_URL}/users/marketplace-orders.html`;
    await Promise.all([
      sendEmail({ toEmail: buyer.email, toName: buyer.name, subject: 'Vendor responded to your dispute', headline: 'Your dispute has a vendor response', bodyContent: `The vendor responded to your dispute for order ${reference}.`, actionUrl: link, actionText: 'View your orders' }),
      sendNotification({ recipientUid: buyerUid, title: 'Vendor responded to your dispute', message: `The vendor responded to order ${reference}.`, link, type: 'dispute_vendor_response' })
    ]);
  } catch (err) { console.error('Buyer dispute response notification failed:', err.message); }
}

async function listDisputes(req, res, db, user) {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  
  const [buyerSnap, vendorSnap] = await Promise.all([
    db.collection('disputes').where('buyerUid', '==', user.uid).get(),
    db.collection('disputes').where('vendorUid', '==', user.uid).get()
  ]);

  const map = new Map();
  const allDocs = [...buyerSnap.docs, ...vendorSnap.docs];

  // Populate human-readable names, emails, and titles
  for (const d of allDocs) {
    const data = d.data();
    if (status && data.status !== status) continue;

    let buyerName = 'Customer';
    let buyerEmail = '';
    if (data.buyerUid) {
      try {
        const buyerDoc = await db.collection('users').doc(data.buyerUid).get();
        if (buyerDoc.exists) {
          const bData = buyerDoc.data();
          buyerName = bData.fullName || bData.name || bData.displayName || buyerName;
          buyerEmail = bData.email || '';
        } else {
          const fallbackDoc = await db.collection('user').doc(data.buyerUid).get();
          if (fallbackDoc.exists) {
            const fbData = fallbackDoc.data();
            buyerName = fbData.fullName || fbData.name || fbData.displayName || buyerName;
            buyerEmail = fbData.email || '';
          }
        }
      } catch (e) {
        console.warn('Could not load buyer profile for dispute:', e.message);
      }
    }

    let productTitle = 'Marketplace Order';
    if (data.productId) {
      try {
        const prodDoc = await db.collection('vendorProducts').doc(data.productId).get();
        if (prodDoc.exists) {
          productTitle = prodDoc.data().title || productTitle;
        }
      } catch (e) {
        console.warn('Could not load product title for dispute:', e.message);
      }
    }

    map.set(d.id, {
      id: d.id,
      ...data,
      buyerName,
      buyerEmail,
      productTitle
    });
  }

  const disputes = Array.from(map.values()).sort(
    (a, b) => (b.createdAt?._seconds || b.createdAt?.seconds || 0) - (a.createdAt?._seconds || a.createdAt?.seconds || 0)
  );

  return res.status(200).json({ success: true, disputes });
}

async function notifyVendorDispute(admin, db, vendorUid, reference, reason) {
  try {
    const vendor = await getRecipient(admin, db, vendorUid, ['user', 'users', 'vendors']);
    const link = `${APP_URL}/users/sellers-page.html#disputes-pane`;
    await Promise.all([
      sendEmail({ toEmail: vendor.email, toName: vendor.name, subject: 'A buyer reported a problem with an order', headline: 'New order dispute', bodyContent: `A buyer opened a dispute for order ${reference}. Reason: ${reason}.`, actionUrl: link, actionText: 'Review dispute' }),
      sendNotification({ recipientUid: vendorUid, title: 'New order dispute', message: `A buyer reported a problem with order ${reference}.`, link, type: 'dispute_opened' })
    ]);
  } catch (err) { console.error('Vendor dispute notification failed (non-blocking):', err.message); }
}