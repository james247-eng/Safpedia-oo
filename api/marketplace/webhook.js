// api/marketplace/webhook.js
const crypto = require('crypto');
const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { sendEmail } = require('../utils/send-email');
const { sendNotification } = require('../utils/send-notification');
const { getRecipient } = require('../utils/recipient');
const { TIERS } = require('../../lib/vendor-subscriptions');

const APP_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

// Paystack signature verification needs the RAW request body.
module.exports.config = {
  api: {
    bodyParser: false
  }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * POST /api/marketplace/webhook
 * Registered against the MARKETPLACE Paystack business account (separate
 * from the courses/affiliates account), so verifies signatures against
 * PAYSTACK_SECRET_KEY_MARKETPLACE, not the main PAYSTACK_SECRET_KEY.
 *
 * Handles:
 *   - charge.success: decrements stock (physical), credits the vendor's
 *     balance, writes a sale record under vendorProducts/{id}/sales/{reference}
 *   - transfer.success / transfer.failed / transfer.reversed: settles a
 *     vendor payout request (see request-payout.js)
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY_MARKETPLACE;
    if (!PAYSTACK_SECRET) {
      console.error('PAYSTACK_SECRET_KEY_MARKETPLACE not configured');
      return res.status(500).send('PAYSTACK_SECRET_KEY_MARKETPLACE not configured');
    }

    const rawBody = await getRawBody(req);
    const signature = req.headers['x-paystack-signature'];

    if (!signature) {
      console.warn('Missing Paystack signature');
      return res.status(400).send('Missing signature');
    }

    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');
    if (hash !== signature) {
      console.warn('Invalid signature on marketplace webhook');
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.event;
    const data = payload.data;

    console.log('Marketplace webhook received:', eventType, 'Reference:', data.reference);

    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    if (eventType === 'transfer.success' || eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      return handleTransferEvent(eventType, data, admin, db, res);
    }

    if (eventType !== 'charge.success') {
      console.log('Unhandled marketplace event type:', eventType);
      return res.status(200).send('ok');
    }

    return handleChargeSuccess(data, admin, db, res, PAYSTACK_SECRET);

  } catch (err) {
    console.error('Marketplace webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Handles a successful marketplace payment: verifies stock (if physical),
 * credits the vendor's balance with their cut, records the sale.
 */
async function handleChargeSuccess(data, admin, db, res, PAYSTACK_SECRET) {
  const metadata = data.metadata || {};

  if (metadata.orderType === 'vendor_subscription') {
    return handleSubscriptionChargeSuccess(data, metadata, admin, db, res);
  }

  if (metadata.orderType !== 'marketplace') {
    console.log('Ignoring non-marketplace charge.success event');
    return res.status(200).send('ok');
  }

  const { buyerUid, productId, vendorUid, quantity } = metadata;
  const reference = data.reference;

  if (!buyerUid || !productId || !vendorUid) {
    console.error('Missing required metadata on marketplace charge:', metadata);
    return res.status(400).send('Missing required metadata');
  }

  const qty = typeof quantity === 'number' ? quantity : 1;
  const amountNaira = data.amount / 100; // kobo -> naira
  const rate = 0;
  const commissionAmount = 0;
  const vendorAmount = amountNaira;

  const productRef = db.collection('vendorProducts').doc(productId);
  const saleRef = productRef.collection('sales').doc(reference);
  const vendorRef = db.collection('vendors').doc(vendorUid);

  let oversold = false;
  let saleDetails = null;

  try {
    await db.runTransaction(async (tx) => {
      const saleSnap = await tx.get(saleRef);
      if (saleSnap.exists) {
        // Already processed — Paystack may retry webhooks. Idempotent no-op.
        return;
      }

      const productSnap = await tx.get(productRef);
      if (!productSnap.exists) {
        throw new Error(`Product ${productId} not found during fulfillment`);
      }
      const product = productSnap.data();
      const productTitle = metadata.productTitle || product.title || 'Product';

      let fulfillmentStatus;
      let stockRemaining = null;

      if (product.type === 'physical') {
        if (product.stock === null || product.stock < qty) {
          oversold = true;
          return; // handled after the transaction — funds get refunded, nothing credited
        }
        tx.set(productRef, {
          stock: admin.firestore.FieldValue.increment(-qty),
          totalSales: admin.firestore.FieldValue.increment(qty),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
        fulfillmentStatus = 'pending_shipment';
        stockRemaining = product.stock - qty;
      } else {
        tx.set(productRef, {
          totalSales: admin.firestore.FieldValue.increment(qty),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
        fulfillmentStatus = 'available'; // download link generated on-demand by the buyer
      }

      tx.set(vendorRef, {
        totalEarned: admin.firestore.FieldValue.increment(vendorAmount),
        pendingPayout: admin.firestore.FieldValue.increment(vendorAmount),
        totalSales: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      tx.set(saleRef, {
        reference,
        productId,
        vendorUid,
        buyerUid,
        productTitle,
        productType: product.type,
        quantity: qty,
        unit: product.unit || 'unit', // <-- SAVED TO SALE RECORD
        amount: amountNaira,
        commissionRate: rate,
        commissionAmount,
        vendorAmount,
        fulfillmentStatus,
        shippingAddress: product.type === 'physical' ? (metadata.shippingAddress || null) : null,
        createdAt: admin.firestore.Timestamp.now()
      });

      saleDetails = {
        productTitle,
        productType: product.type,
        unit: product.unit || 'unit',
        stockRemaining
      };
    });
  } catch (err) {
    console.error('Error processing marketplace charge.success:', err.message);
    return res.status(500).json({ error: err.message });
  }

  if (oversold) {
    console.warn(`Product ${productId} oversold — refunding reference ${reference}`);
    try {
      await fetch('https://api.paystack.co/refund', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transaction: reference })
      });
      await saleRef.set({
        reference,
        productId,
        vendorUid,
        buyerUid,
        status: 'oversold_refunded',
        amount: amountNaira,
        createdAt: admin.firestore.Timestamp.now()
      }, { merge: true });
    } catch (refundErr) {
      console.error('❌ AUTOMATED REFUND FAILED — manual action required:', reference, refundErr.message);
    }
    return res.status(200).send('ok');
  }

  if (saleDetails) {
    await notifyMarketplaceSale({
      admin,
      db,
      buyerUid,
      vendorUid,
      reference,
      qty,
      amountNaira,
      vendorAmount,
      ...saleDetails
    });
  }

  console.log(`✓ Marketplace sale recorded and vendor credited: ${reference}`);
  return res.status(200).json({ success: true, reference });
}

/**
 * Settles a vendorPayoutRequests doc once Paystack confirms the transfer's
 * final state.
 */
async function handleTransferEvent(eventType, data, admin, db, res) {
  try {
    const reference = data.reference;
    if (!reference) {
      console.warn('Transfer webhook missing reference');
      return res.status(200).send('ok');
    }

    const matches = await db.collectionGroup('vendorPayoutRequests')
      .where('reference', '==', reference)
      .limit(1)
      .get();

    if (matches.empty) {
      console.warn('No vendor payout request found for transfer reference:', reference);
      return res.status(200).send('ok');
    }

    const payoutDoc = matches.docs[0];
    const payoutData = payoutDoc.data();
    const vendorUid = payoutData.vendorUid;
    const amount = payoutData.amount;
    const vendorRef = db.collection('vendors').doc(vendorUid);

    if (payoutData.status === 'paid' || payoutData.status === 'failed') {
      console.log('Vendor payout already settled, ignoring duplicate webhook:', reference);
      return res.status(200).send('ok');
    }

    if (eventType === 'transfer.success') {
      await db.runTransaction(async (tx) => {
        tx.set(payoutDoc.ref, {
          status: 'paid',
          paidAt: admin.firestore.Timestamp.now()
        }, { merge: true });
        tx.set(vendorRef, {
          awaitingPayout: admin.firestore.FieldValue.increment(-amount),
          totalPaidOut: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      });
      console.log('✓ Vendor payout settled as paid:', reference);
    } else {
      await db.runTransaction(async (tx) => {
        tx.set(payoutDoc.ref, {
          status: 'failed',
          failureReason: eventType,
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
        tx.set(vendorRef, {
          awaitingPayout: admin.firestore.FieldValue.increment(-amount),
          pendingPayout: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      });
      console.log('✗ Vendor payout failed/reversed, funds returned to balance:', reference);
    }

    await notifyVendorTransfer({ admin, db, vendorUid, amount, eventType, reference });

    return res.status(200).send('ok');

  } catch (err) {
    console.error('Vendor transfer webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function handleSubscriptionChargeSuccess(data, metadata, admin, db, res) {
  const { vendorUid, subscriptionTier, billingCycle } = metadata;
  const reference = data.reference;
  const tier = TIERS[subscriptionTier];
  if (!vendorUid || !tier || subscriptionTier === 'safseed' || !['monthly', 'annual'].includes(billingCycle) || !reference) {
    return res.status(400).send('Invalid subscription metadata');
  }
  const expectedAmount = billingCycle === 'annual' ? tier.annualPrice : tier.monthlyPrice;
  const amountNaira = data.amount / 100;
  if (amountNaira !== expectedAmount) console.warn('Subscription amount mismatch:', { reference, expectedAmount, amountNaira });
  const paymentRef = db.collection('vendors').doc(vendorUid).collection('subscriptionPayments').doc(reference);
  const vendorRef = db.collection('vendors').doc(vendorUid);
  const now = admin.firestore.Timestamp.now();
  const days = billingCycle === 'annual' ? 365 : 30;
  const expires = admin.firestore.Timestamp.fromMillis(now.toMillis() + days * 24 * 60 * 60 * 1000);
  try {
    let alreadyProcessed = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(paymentRef);
      if (existing.exists) { alreadyProcessed = true; return; }
      tx.set(paymentRef, { reference, tier: subscriptionTier, amount: amountNaira, billingCycle, status: 'success', createdAt: now });
      tx.set(vendorRef, { subscriptionTier, subscriptionStatus: 'active', subscriptionStartedAt: now, subscriptionExpiresAt: expires, subscriptionPaystackReference: reference, subscriptionUpdatedAt: now }, { merge: true });
    });
    const products = await db.collection('vendorProducts').where('vendorUid', '==', vendorUid).where('subscriptionLapsed', '==', true).get();
    for (let i = 0; i < products.docs.length; i += 400) {
      const batch = db.batch();
      products.docs.slice(i, i + 400).forEach((doc) => {
        if (doc.data().adminSuspended !== true) batch.set(doc.ref, { isActive: true, subscriptionLapsed: false }, { merge: true });
      });
      await batch.commit();
    }
    if (!alreadyProcessed) {
      await notifyVendorSubscription({ admin, db, vendorUid, tierName: tier.displayName, billingCycle, amountNaira, reference, expires });
    }
    return res.status(200).json({ success: true, reference });
  } catch (err) {
    console.error('Subscription charge processing error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function notifyMarketplaceSale({
  admin,
  db,
  buyerUid,
  vendorUid,
  reference,
  qty,
  amountNaira,
  vendorAmount,
  productTitle,
  productType,
  unit,
  stockRemaining
}) {
  try {
    const [buyer, vendor] = await Promise.all([
      getRecipient(admin, db, buyerUid, ['user']),
      getRecipient(admin, db, vendorUid, ['user', 'vendors'])
    ]);
    const orderLink = `${APP_URL}/users/dashboard.html`;
    const vendorOrdersLink = `${APP_URL}/seller-dashboard.html?tab=orders`;

    await Promise.all([
      sendEmail({
        toEmail: buyer.email,
        toName: buyer.name,
        subject: `Order confirmed: ${productTitle}`,
        headline: 'Your marketplace order is confirmed',
        bodyContent: `Order ${reference} for ${qty} ${unit}(s) of "${productTitle}" was successful. Total paid: NGN ${amountNaira.toLocaleString('en-NG')}.`,
        actionUrl: orderLink,
        actionText: 'View Order'
      }),
      sendNotification({
        recipientUid: buyerUid,
        title: 'Order confirmed',
        message: `Your order for ${productTitle} was successful.`,
        link: orderLink,
        type: 'order_confirmation'
      }),
      sendEmail({
        toEmail: vendor.email,
        toName: vendor.name,
        subject: `New order: ${productTitle}`,
        headline: 'You received a new order',
        bodyContent: `Order ${reference} includes ${qty} ${unit}(s) of "${productTitle}". NGN ${vendorAmount.toLocaleString('en-NG')} was credited to your pending payout balance.`,
        actionUrl: vendorOrdersLink,
        actionText: 'Manage Order'
      }),
      sendNotification({
        recipientUid: vendorUid,
        title: 'New marketplace order',
        message: `${qty} ${unit}(s) of ${productTitle} was ordered.`,
        link: vendorOrdersLink,
        type: 'new_order'
      })
    ]);

    if (productType === 'physical' && stockRemaining <= 2) {
      const productsLink = `${APP_URL}/seller-dashboard.html?tab=products`;
      await Promise.all([
        sendEmail({
          toEmail: vendor.email,
          toName: vendor.name,
          subject: `Low stock alert: ${productTitle}`,
          headline: 'Inventory is running low',
          bodyContent: `Only ${stockRemaining} unit(s) of "${productTitle}" remain in stock.`,
          actionUrl: productsLink,
          actionText: 'Update Inventory'
        }),
        sendNotification({
          recipientUid: vendorUid,
          title: 'Low stock warning',
          message: `${productTitle} has ${stockRemaining} unit(s) remaining.`,
          link: productsLink,
          type: 'low_stock'
        })
      ]);
    }
  } catch (error) {
    console.error('Marketplace sale notifications failed (non-blocking):', error.message);
  }
}

async function notifyVendorTransfer({ admin, db, vendorUid, amount, eventType, reference }) {
  try {
    const vendor = await getRecipient(admin, db, vendorUid, ['user', 'vendors']);
    const succeeded = eventType === 'transfer.success';
    const payoutLink = `${APP_URL}/seller-dashboard.html?tab=payouts`;

    await Promise.all([
      sendEmail({
        toEmail: vendor.email,
        toName: vendor.name,
        subject: succeeded ? 'Payout completed' : 'Payout failed',
        headline: succeeded ? 'Your payout was successful' : 'Your payout could not be completed',
        bodyContent: succeeded
          ? `Your payout of NGN ${amount.toLocaleString('en-NG')} was transferred successfully. Reference: ${reference}.`
          : `Your payout of NGN ${amount.toLocaleString('en-NG')} failed and the funds were returned to your available balance. Reference: ${reference}.`,
        actionUrl: payoutLink,
        actionText: 'View Payouts'
      }),
      sendNotification({
        recipientUid: vendorUid,
        title: succeeded ? 'Payout successful' : 'Payout failed',
        message: succeeded
          ? `NGN ${amount.toLocaleString('en-NG')} was paid to your bank account.`
          : `Your NGN ${amount.toLocaleString('en-NG')} payout failed. Funds were returned to your balance.`,
        link: payoutLink,
        type: succeeded ? 'payout_success' : 'payout_failed'
      })
    ]);
  } catch (error) {
    console.error('Vendor payout notifications failed (non-blocking):', error.message);
  }
}

async function notifyVendorSubscription({ admin, db, vendorUid, tierName, billingCycle, amountNaira, reference, expires }) {
  try {
    const vendor = await getRecipient(admin, db, vendorUid, ['user', 'vendors']);
    const subscriptionLink = `${APP_URL}/seller-dashboard.html?tab=subscription`;
    const expiryDate = expires.toDate().toLocaleDateString('en-NG');
    await Promise.all([
      sendEmail({
        toEmail: vendor.email,
        toName: vendor.name,
        subject: `${tierName} subscription activated`,
        headline: 'Your vendor subscription is active',
        bodyContent: `Your ${tierName} ${billingCycle} subscription is active until ${expiryDate}. Amount paid: NGN ${amountNaira.toLocaleString('en-NG')}. Reference: ${reference}.`,
        actionUrl: subscriptionLink,
        actionText: 'View Subscription'
      }),
      sendNotification({
        recipientUid: vendorUid,
        title: 'Subscription activated',
        message: `Your ${tierName} subscription is active until ${expiryDate}.`,
        link: subscriptionLink,
        type: 'vendor_subscription_activated'
      })
    ]);
  } catch (error) {
    console.error('Vendor subscription notifications failed (non-blocking):', error.message);
  }
}
