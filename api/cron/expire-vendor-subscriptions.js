const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { sendEmail, sendNotification, getRecipient } = require('../utils/[action]');

const BATCH_LIMIT = 400;
const APP_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

function isAuthorizedCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || req.headers.Authorization || '';
  return Boolean(secret) && authorization === `Bearer ${secret}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized cron request' });
  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const failures = [];
  let expiredVendors = 0;
  let deactivatedProducts = 0;
  try {
    const vendorsSnap = await db.collection('vendors').where('subscriptionStatus', '==', 'active').where('subscriptionExpiresAt', '<', now).get();
    for (const vendorDoc of vendorsSnap.docs) {
      const vendorUid = vendorDoc.id;
      if (vendorDoc.data().subscriptionOverrideActive === true) continue;
      try {
        const productsSnap = await db.collection('vendorProducts').where('vendorUid', '==', vendorUid).where('isActive', '==', true).get();
        const products = productsSnap.docs;
        for (let i = 0; i < products.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          products.slice(i, i + BATCH_LIMIT).forEach((productDoc) => {
            batch.set(productDoc.ref, { isActive: false, subscriptionLapsed: true }, { merge: true });
          });
          await batch.commit();
        }
        await vendorDoc.ref.set({ subscriptionStatus: 'expired', subscriptionUpdatedAt: now }, { merge: true });
        expiredVendors += 1;
        deactivatedProducts += products.length;
        notifyVendorSubscriptionLapsed({ admin, db, vendorUid }).catch((err) => console.error('Subscription lapse notification failed (non-blocking):', vendorUid, err.message));
      } catch (err) {
        console.error('Vendor subscription expiry failed:', vendorUid, err);
        failures.push({ vendorUid, error: err.message });
      }
    }
    return res.status(200).json({ success: true, expiredVendors, deactivatedProducts, failures });
  } catch (err) {
    console.error('Vendor subscription expiry query failed:', err);
    return res.status(500).json({ error: err.message, expiredVendors, deactivatedProducts, failures });
  }
};

async function notifyVendorSubscriptionLapsed({ admin, db, vendorUid }) {
  const vendor = await getRecipient(admin, db, vendorUid, ['user', 'vendors']);
  const renewLink = `${APP_URL}/users/sellers-page.html#subscription-pane`;
  await Promise.all([
    sendEmail({ toEmail: vendor.email, toName: vendor.name, subject: 'Your vendor subscription has expired', headline: 'Subscription expired - products deactivated', bodyContent: 'Your subscription lapsed and active products were deactivated. Renew to reactivate products marked as subscription-lapsed.', actionUrl: renewLink, actionText: 'Renew Subscription' }),
    sendNotification({ recipientUid: vendorUid, title: 'Subscription expired', message: 'Your subscription lapsed and active products were deactivated. Renew to reactivate them.', link: renewLink, type: 'vendor_subscription_lapsed' })
  ]);
}
