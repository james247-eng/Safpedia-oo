const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { getAuthedUser } = require('../../lib/auth');
const { sendEmail, sendNotification, getRecipient } = require('../utils/[action]');

const APP_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

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
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

async function createDispute(req, res, admin, db, user) {
  const { reference, reason, buyerStatement } = req.body || {};
  if (!reference || typeof reference !== 'string' || !reason || typeof reason !== 'string' || !buyerStatement || typeof buyerStatement !== 'string') {
    return res.status(400).json({ error: 'reference, reason, and buyerStatement are required' });
  }
  const matches = await db.collectionGroup('sales').where('reference', '==', reference.trim()).limit(1).get();
  if (matches.empty) return res.status(404).json({ error: 'Order not found' });
  const sale = matches.docs[0].data();
  if (sale.buyerUid !== user.uid) return res.status(403).json({ error: 'You cannot dispute this order' });

  const existing = await db.collection('disputes').where('reference', '==', reference.trim()).where('status', 'in', ['open', 'investigating']).limit(1).get();
  if (!existing.empty) return res.status(409).json({ error: 'An active dispute already exists for this order', disputeId: existing.docs[0].id });

  const now = admin.firestore.Timestamp.now();
  const disputeRef = db.collection('disputes').doc();
  await disputeRef.set({ reference: reference.trim(), buyerUid: user.uid, vendorUid: sale.vendorUid, productId: sale.productId, status: 'open', reason: reason.trim(), buyerStatement: buyerStatement.trim(), vendorStatement: null, adminNotes: [], resolution: null, createdAt: now, updatedAt: now });
  notifyVendorDispute(admin, db, sale.vendorUid, reference.trim(), reason.trim()).catch(() => {});
  return res.status(201).json({ success: true, disputeId: disputeRef.id, status: 'open' });
}

async function respondToDispute(req, res, admin, db, user) {
  const { disputeId, vendorStatement } = req.body || {};
  if (!disputeId || typeof vendorStatement !== 'string' || !vendorStatement.trim()) return res.status(400).json({ error: 'disputeId and vendorStatement are required' });
  const ref = db.collection('disputes').doc(disputeId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Dispute not found' });
  const dispute = snap.data();
  if (dispute.vendorUid !== user.uid) return res.status(403).json({ error: 'You cannot respond to this dispute' });
  if (!['open', 'investigating'].includes(dispute.status)) return res.status(409).json({ error: 'This dispute is already resolved or closed' });
  const now = admin.firestore.Timestamp.now();
  await ref.set({ vendorStatement: vendorStatement.trim(), status: 'investigating', updatedAt: now }, { merge: true });
  notifyBuyerVendorResponse(admin, db, dispute.buyerUid, dispute.reference).catch(() => {});
  return res.status(200).json({ success: true, status: 'investigating' });
}

async function notifyBuyerVendorResponse(admin, db, buyerUid, reference) {
  try {
    const buyer = await getRecipient(admin, db, buyerUid, ['user']);
    const link = `${APP_URL}/users/marketplace-orders.html`;
    await Promise.all([
      sendEmail({ toEmail: buyer.email, toName: buyer.name, subject: 'Vendor responded to your dispute', headline: 'Your dispute has a vendor response', bodyContent: `The vendor responded to your dispute for order ${reference}.`, actionUrl: link, actionText: 'View your orders' }),
      sendNotification({ recipientUid: buyerUid, title: 'Vendor responded to your dispute', message: `The vendor responded to order ${reference}.`, link, type: 'dispute_vendor_response' })
    ]);
  } catch (err) { console.error('Buyer dispute response notification failed:', err.message); }
}

async function listDisputes(req, res, db, user) {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  let q = db.collection('disputes').where('buyerUid', '==', user.uid);
  const [buyerSnap, vendorSnap] = await Promise.all([
    q.get(),
    db.collection('disputes').where('vendorUid', '==', user.uid).get()
  ]);
  const map = new Map();
  [...buyerSnap.docs, ...vendorSnap.docs].forEach((d) => { const data = d.data(); if (!status || data.status === status) map.set(d.id, { id: d.id, ...data }); });
  return res.status(200).json({ success: true, disputes: Array.from(map.values()).sort((a, b) => (b.createdAt?._seconds || b.createdAt?.seconds || 0) - (a.createdAt?._seconds || a.createdAt?.seconds || 0)) });
}

async function notifyVendorDispute(admin, db, vendorUid, reference, reason) {
  try {
    const vendor = await getRecipient(admin, db, vendorUid, ['user', 'vendors']);
    const link = `${APP_URL}/seller-dashboard.html?tab=disputes`;
    await Promise.all([
      sendEmail({ toEmail: vendor.email, toName: vendor.name, subject: 'A buyer reported a problem with an order', headline: 'New order dispute', bodyContent: `A buyer opened a dispute for order ${reference}. Reason: ${reason}.`, actionUrl: link, actionText: 'Review dispute' }),
      sendNotification({ recipientUid: vendorUid, title: 'New order dispute', message: `A buyer reported a problem with order ${reference}.`, link, type: 'dispute_opened' })
    ]);
  } catch (err) { console.error('Vendor dispute notification failed (non-blocking):', err.message); }
}
