// api/vendors/[action].js

const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { getAuthedUser } = require('../../lib/auth');
const { sendEmail, sendNotification, getRecipient } = require('../utils/[action]');
const { TIERS } = require('../../lib/vendor-subscriptions');

const HOLD_PERIOD_DAYS = 7;

/**
 * Computes how much of a vendor's pendingPayout balance is still inside the
 * platform's return-policy window and therefore not withdrawable yet.
 * Reuses the same collectionGroup('sales') vendorUid+createdAt composite
 * index that get-orders already requires — no new index needed.
 */
async function computeHeldBalance(db, admin, vendorUid) {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - HOLD_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const heldSalesSnap = await db.collectionGroup('sales')
    .where('vendorUid', '==', vendorUid)
    .where('createdAt', '>=', cutoff)
    .get();

  let heldAmount = 0;
  let earliestHeldCreatedAt = null;

  heldSalesSnap.forEach((doc) => {
    const sale = doc.data();
    if (typeof sale.vendorAmount === 'number') {
      heldAmount += sale.vendorAmount;
      const createdAtMillis = sale.createdAt?.toMillis ? sale.createdAt.toMillis() : null;
      if (createdAtMillis !== null && (earliestHeldCreatedAt === null || createdAtMillis < earliestHeldCreatedAt)) {
        earliestHeldCreatedAt = createdAtMillis;
      }
    }
  });

  const nextAvailableAt = earliestHeldCreatedAt !== null
    ? admin.firestore.Timestamp.fromMillis(earliestHeldCreatedAt + HOLD_PERIOD_DAYS * 24 * 60 * 60 * 1000)
    : null;

  return { heldAmount, nextAvailableAt };
}


const APP_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

/**
 * Consolidated vendors router — one Vercel serverless function serving
 * multiple routes via the [action] dynamic segment, to stay under the
 * Hobby plan's 12-function-per-deployment cap. URL paths are unchanged
 * from the original standalone files, so no frontend calls need updating:
 *
 *   POST /api/vendors/add-bank-account    -> handleAddBankAccount
 *   POST /api/vendors/request-payout      -> handleRequestPayout
 *   POST /api/vendors/update-order-status  -> handleUpdateOrderStatus
 *   GET  /api/vendors/get-profile         -> handleGetProfile
 *   GET  /api/vendors/get-orders          -> handleGetOrders
 *
 * Dispatch checks BOTH req.method and action together, since two of these
 * routes are GET and three are POST — action alone isn't enough to route.
 *
 * Each handler's internal logic is preserved exactly as it was in its
 * original standalone file — only the routing wrapper is shared.
 */
module.exports = async (req, res) => {
  const { action } = req.query;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    if (req.method === 'POST' && action === 'add-bank-account') {
      return await handleAddBankAccount(req, res, admin, db);
    }
    if (req.method === 'POST' && action === 'request-payout') {
      return await handleRequestPayout(req, res, admin, db);
    }
    if (req.method === 'POST' && action === 'update-order-status') {
      return await handleUpdateOrderStatus(req, res, admin, db);
    }
    if (req.method === 'GET' && action === 'get-profile') {
      return await handleGetProfile(req, res, admin, db);
    }
    if (req.method === 'GET' && action === 'get-orders') {
      return await handleGetOrders(req, res, admin, db);
    }
    if (req.method === 'GET' && action === 'get-subscription-summary') {
      return await handleGetSubscriptionSummary(req, res, admin, db);
    }

    return res.status(404).json({ error: `Unknown route: ${req.method} ${action}` });

  } catch (err) {
    console.error(`vendors/${action} error:`, err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

/**
 * POST /api/vendors/add-bank-account
 * Any authenticated user — no approval gate, since vendors can list and
 * sell products without admin sign-off. Resolves the account number to a
 * name, then registers a Paystack transfer recipient under the
 * MARKETPLACE account (separate from courses/affiliates) and stores the
 * recipientCode — required before request-payout will work.
 *
 * Body: { bankCode, accountNumber }
 */
async function handleAddBankAccount(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);
  const { bankCode, accountNumber } = req.body || {};

  if (!bankCode || !accountNumber) {
    return res.status(400).json({ error: 'Missing bankCode or accountNumber' });
  }

  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY_MARKETPLACE;
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY_MARKETPLACE not configured' });
  }

  const resolveRes = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );
  const resolveJson = await resolveRes.json();

  if (!resolveJson.status) {
    return res.status(400).json({ error: resolveJson.message || 'Could not verify account number' });
  }

  const accountName = resolveJson.data.account_name;

  const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'nuban',
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN'
    })
  });
  const recipientJson = await recipientRes.json();

  if (!recipientJson.status) {
    return res.status(502).json({ error: recipientJson.message || 'Could not register bank account with Paystack' });
  }

  const bankAccount = {
    bankCode,
    accountNumber,
    accountName,
    recipientCode: recipientJson.data.recipient_code
  };

  await db.collection('vendors').doc(user.uid).set({
    bankAccount,
    updatedAt: admin.firestore.Timestamp.now()
  }, { merge: true });

  return res.status(200).json({ success: true, bankAccount });
}

/**
 * POST /api/vendors/request-payout
 * Any vendor with a bank account on file. Reserves the requested amount
 * (pendingPayout -> awaitingPayout) in a transaction first, then fires a
 * real Paystack Transfer on the MARKETPLACE account. If Paystack rejects
 * the transfer outright, the reservation is rolled back immediately.
 * Final settlement is confirmed asynchronously by the transfer.success /
 * transfer.failed / transfer.reversed webhook events.
 *
 * Body: { amount? }  // defaults to full pendingPayout balance if omitted
 */






/*
async function handleRequestPayout(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);
  const { amount } = req.body || {};

  const vendorRef = db.collection('vendors').doc(user.uid);
  const vendorSnap = await vendorRef.get();

  if (!vendorSnap.exists) {
    return res.status(403).json({ error: 'You do not have a vendor account yet' });
  }

  const vendorData = vendorSnap.data();

  if (vendorData.isSuspended) {
    return res.status(403).json({ error: 'This vendor account is suspended and cannot request payouts' });
  }

  if (!vendorData.bankAccount || !vendorData.bankAccount.recipientCode) {
    return res.status(400).json({ error: 'Add a bank account before requesting a payout' });
  }

  const pendingPayout = vendorData.pendingPayout || 0;
  const { heldAmount, nextAvailableAt } = await computeHeldBalance(db, admin, user.uid);
  const availableNow = Math.max(0, pendingPayout - heldAmount);

  const requestAmount = typeof amount === 'number' && amount > 0 ? amount : availableNow;

  if (requestAmount <= 0) {
    if (heldAmount > 0) {
      return res.status(400).json({
        error: `No payout available yet — ₦${heldAmount.toLocaleString('en-NG')} from recent sales is held for ${HOLD_PERIOD_DAYS} days after purchase to match our return policy.${nextAvailableAt ? ` It becomes available on ${nextAvailableAt.toDate().toLocaleDateString('en-NG')}.` : ''}`,
        reasonCode: 'held_pending_return_window',
        heldAmount,
        nextAvailableAt
      });
    }
    return res.status(400).json({ error: 'No payout balance available' });
  }
  if (requestAmount > availableNow) {
    return res.status(400).json({
      error: `Requested amount exceeds your available balance of ₦${availableNow.toLocaleString('en-NG')}. ₦${heldAmount.toLocaleString('en-NG')} from recent sales is still held until ${HOLD_PERIOD_DAYS} days after purchase${nextAvailableAt ? ` (earliest release: ${nextAvailableAt.toDate().toLocaleDateString('en-NG')})` : ''}.`,
      reasonCode: 'exceeds_available_balance',
      availableNow,
      heldAmount,
      nextAvailableAt
    });
  }

  const payoutRef = vendorRef.collection('vendorPayoutRequests').doc();

  await db.runTransaction(async (tx) => {
    tx.set(payoutRef, {
      amount: requestAmount,
      status: 'processing',
      reference: payoutRef.id,
      vendorUid: user.uid,
      createdAt: admin.firestore.Timestamp.now()
    });
    tx.set(vendorRef, {
      pendingPayout: admin.firestore.FieldValue.increment(-requestAmount),
      awaitingPayout: admin.firestore.FieldValue.increment(requestAmount),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
  });

  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY_MARKETPLACE;
  if (!PAYSTACK_SECRET) {
    await rollbackPayout(db, admin, vendorRef, payoutRef, requestAmount, 'PAYSTACK_SECRET_KEY_MARKETPLACE not configured');
    return res.status(500).json({ error: 'Payout provider not configured' });
  }

  let transferJson;
  try {
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(requestAmount * 100),
        recipient: vendorData.bankAccount.recipientCode,
        reason: 'Vendor product sale payout',
        reference: payoutRef.id
      })
    });
    transferJson = await transferRes.json();
  } catch (networkErr) {
    await rollbackPayout(db, admin, vendorRef, payoutRef, requestAmount, networkErr.message);
    return res.status(502).json({ error: 'Could not reach Paystack transfer API: ' + networkErr.message });
  }

  if (!transferJson.status) {
    await rollbackPayout(db, admin, vendorRef, payoutRef, requestAmount, transferJson.message || 'Transfer rejected');
    return res.status(502).json({ error: transferJson.message || 'Paystack transfer failed', details: transferJson });
  }

  await payoutRef.set({
    transferCode: transferJson.data.transfer_code,
    paystackStatus: transferJson.data.status,
    updatedAt: admin.firestore.Timestamp.now()
  }, { merge: true });

  await notifyPayoutRequested({
    admin,
    db,
    vendorUid: user.uid,
    amount: requestAmount,
    reference: payoutRef.id
  });

  return res.status(200).json({
    success: true,
    payoutId: payoutRef.id,
    amount: requestAmount,
    status: transferJson.data.status
  });
}
*/



async function handleRequestPayout(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);
  const { amount } = req.body || {};

  const vendorRef = db.collection('vendors').doc(user.uid);
  const vendorSnap = await vendorRef.get();

  if (!vendorSnap.exists) {
    return res.status(403).json({ error: 'You do not have a vendor account yet' });
  }

  const vendorData = vendorSnap.data();

  if (vendorData.isSuspended) {
    return res.status(403).json({ error: 'This vendor account is suspended and cannot request payouts' });
  }

  if (!vendorData.bankAccount || !vendorData.bankAccount.recipientCode) {
    return res.status(400).json({ error: 'Add a bank account before requesting a payout' });
  }

  // Preliminary check outside the transaction — gives a fast, friendly
  // error for the common case. The transaction below re-checks everything
  // against fresh data and is the actual source of truth; this is just to
  // avoid making the vendor wait for a transaction when the answer is
  // obviously "no" (e.g. everything is held, or balance is zero).
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - HOLD_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const { heldAmount: precheckHeld, nextAvailableAt: precheckNextAvailable } = await computeHeldBalance(db, admin, user.uid);
  const precheckAvailable = Math.max(0, (vendorData.pendingPayout || 0) - precheckHeld);
  const precheckRequestAmount = typeof amount === 'number' && amount > 0 ? amount : precheckAvailable;

  if (precheckRequestAmount <= 0) {
    if (precheckHeld > 0) {
      return res.status(400).json({
        error: `No payout available yet — ₦${precheckHeld.toLocaleString('en-NG')} from recent sales is held for ${HOLD_PERIOD_DAYS} days after purchase to match our return policy.${precheckNextAvailable ? ` It becomes available on ${precheckNextAvailable.toDate().toLocaleDateString('en-NG')}.` : ''}`,
        reasonCode: 'held_pending_return_window',
        heldAmount: precheckHeld,
        nextAvailableAt: precheckNextAvailable
      });
    }
    return res.status(400).json({ error: 'No payout balance available' });
  }

  const payoutRef = vendorRef.collection('vendorPayoutRequests').doc();
  let requestAmount;

  // ---- Atomic re-check + reservation ----
  // Reads vendorRef AND the held-sales query INSIDE the transaction, so
  // Firestore's write-conflict detection actually applies. Two concurrent
  // requests will now genuinely race — one commits, the other is forced
  // to retry against post-commit data and fails the balance check instead
  // of both succeeding against stale reads.
  try {
    await db.runTransaction(async (tx) => {
      const freshVendorSnap = await tx.get(vendorRef);
      if (!freshVendorSnap.exists) {
        throw Object.assign(new Error('Vendor account not found'), { statusCode: 403 });
      }
      const freshVendorData = freshVendorSnap.data();

      if (freshVendorData.isSuspended) {
        throw Object.assign(new Error('This vendor account is suspended and cannot request payouts'), { statusCode: 403 });
      }

      const freshHeldSnap = await tx.get(
        db.collectionGroup('sales')
          .where('vendorUid', '==', user.uid)
          .where('createdAt', '>=', cutoff)
      );
      let freshHeld = 0;
      freshHeldSnap.forEach((doc) => {
        const sale = doc.data();
        if (typeof sale.vendorAmount === 'number') freshHeld += sale.vendorAmount;
      });

      const freshPending = freshVendorData.pendingPayout || 0;
      const freshAvailable = Math.max(0, freshPending - freshHeld);

      requestAmount = typeof amount === 'number' && amount > 0 ? amount : freshAvailable;

      if (requestAmount <= 0) {
        throw Object.assign(new Error('No payout balance available'), { statusCode: 400 });
      }
      if (requestAmount > freshAvailable) {
        throw Object.assign(new Error(
          `Requested amount exceeds your available balance of ₦${freshAvailable.toLocaleString('en-NG')}. ₦${freshHeld.toLocaleString('en-NG')} from recent sales is still held for ${HOLD_PERIOD_DAYS} days after purchase.`
        ), { statusCode: 400 });
      }

      tx.set(payoutRef, {
        amount: requestAmount,
        status: 'processing',
        reference: payoutRef.id,
        vendorUid: user.uid,
        createdAt: admin.firestore.Timestamp.now()
      });
      tx.set(vendorRef, {
        pendingPayout: admin.firestore.FieldValue.increment(-requestAmount),
        awaitingPayout: admin.firestore.FieldValue.increment(requestAmount),
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }

  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY_MARKETPLACE;
  if (!PAYSTACK_SECRET) {
    await rollbackPayout(db, admin, vendorRef, payoutRef, requestAmount, 'PAYSTACK_SECRET_KEY_MARKETPLACE not configured');
    return res.status(500).json({ error: 'Payout provider not configured' });
  }

  let transferJson;
  try {
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(requestAmount * 100),
        recipient: vendorData.bankAccount.recipientCode,
        reason: 'Vendor product sale payout',
        reference: payoutRef.id
      })
    });
    transferJson = await transferRes.json();
  } catch (networkErr) {
    await rollbackPayout(db, admin, vendorRef, payoutRef, requestAmount, networkErr.message);
    return res.status(502).json({ error: 'Could not reach Paystack transfer API: ' + networkErr.message });
  }

  if (!transferJson.status) {
    await rollbackPayout(db, admin, vendorRef, payoutRef, requestAmount, transferJson.message || 'Transfer rejected');
    return res.status(502).json({ error: transferJson.message || 'Paystack transfer failed', details: transferJson });
  }

  await payoutRef.set({
    transferCode: transferJson.data.transfer_code,
    paystackStatus: transferJson.data.status,
    updatedAt: admin.firestore.Timestamp.now()
  }, { merge: true });

  await notifyPayoutRequested({
    admin,
    db,
    vendorUid: user.uid,
    amount: requestAmount,
    reference: payoutRef.id
  });

  return res.status(200).json({
    success: true,
    payoutId: payoutRef.id,
    amount: requestAmount,
    status: transferJson.data.status
  });
}


async function rollbackPayout(db, admin, vendorRef, payoutRef, amount, reason) {
  await db.runTransaction(async (tx) => {
    tx.set(payoutRef, {
      status: 'failed',
      failureReason: reason,
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
    tx.set(vendorRef, {
      pendingPayout: admin.firestore.FieldValue.increment(amount),
      awaitingPayout: admin.firestore.FieldValue.increment(-amount),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
  });
}

/**
 * POST /api/vendors/update-order-status
 * Vendor-only, own product's sale only. Physical fulfillment tracking —
 * digital sales never touch this, since fulfillmentStatus is set once by
 * the webhook and never needs a manual update.
 *
 * Body: { productId, reference, action, trackingNumber?, carrier? }
 */
async function handleUpdateOrderStatus(req, res, admin, db) {
  const ALLOWED_TRANSITIONS = {
    pending_shipment: ['shipped'],
    shipped: ['delivered']
  };

  const user = await getAuthedUser(req, admin);
  const { productId, reference, action: orderAction, trackingNumber, carrier } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing productId' });
  }
  if (!reference || typeof reference !== 'string') {
    return res.status(400).json({ error: 'Missing reference' });
  }
  if (!orderAction || !['shipped', 'delivered'].includes(orderAction)) {
    return res.status(400).json({ error: "action must be 'shipped' or 'delivered'" });
  }

  const saleRef = db.collection('vendorProducts').doc(productId).collection('sales').doc(reference);
  const saleSnap = await saleRef.get();

  if (!saleSnap.exists) {
    return res.status(404).json({ error: 'Sale record not found' });
  }

  const sale = saleSnap.data();

  if (sale.vendorUid !== user.uid) {
    return res.status(403).json({ error: 'This sale does not belong to your account' });
  }
  if (sale.productType !== 'physical') {
    return res.status(400).json({ error: 'Only physical product orders have a shipment status' });
  }

  const currentStatus = sale.fulfillmentStatus;
  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];

  if (!allowedNext.includes(orderAction)) {
    return res.status(409).json({
      error: `Cannot mark as '${orderAction}' from current status '${currentStatus}'`,
      currentStatus
    });
  }

  const update = {
    fulfillmentStatus: orderAction,
    updatedAt: admin.firestore.Timestamp.now()
  };

  if (orderAction === 'shipped') {
    if (trackingNumber && typeof trackingNumber === 'string') {
      update.trackingNumber = trackingNumber.trim();
    }
    if (carrier && typeof carrier === 'string') {
      update.carrier = carrier.trim();
    }
    update.shippedAt = admin.firestore.Timestamp.now();
  }

  if (orderAction === 'delivered') {
    update.deliveredAt = admin.firestore.Timestamp.now();
  }

  await saleRef.set(update, { merge: true });

  if (orderAction === 'shipped') {
    await notifyBuyerOrderShipped({
      admin,
      db,
      sale,
      reference,
      trackingNumber: update.trackingNumber,
      carrier: update.carrier
    });
  }

  return res.status(200).json({ success: true, reference, fulfillmentStatus: orderAction });
}

/**
 * GET /api/vendors/get-profile
 * Any authenticated user. Returns the caller's own vendor balance/bank info
 * plus their product list, for rendering the seller dashboard.
 */
async function handleGetProfile(req, res, admin, db) {
  const PRODUCTS_LIMIT = 100;
  const user = await getAuthedUser(req, admin);

  const vendorSnap = await db.collection('vendors').doc(user.uid).get();

  const vendor = vendorSnap.exists
    ? vendorSnap.data()
    : {
        bankAccount: null,
        totalEarned: 0,
        pendingPayout: 0,
        awaitingPayout: 0,
        totalPaidOut: 0,
        totalSales: 0
      };

  const { heldAmount, nextAvailableAt } = await computeHeldBalance(db, admin, user.uid);
  const pendingPayout = vendor.pendingPayout || 0;
  const availableNow = Math.max(0, pendingPayout - heldAmount);

  const productsSnap = await db.collection('vendorProducts')
    .where('vendorUid', '==', user.uid)
    .orderBy('createdAt', 'desc')
    .limit(PRODUCTS_LIMIT)
    .get();

  const products = [];
  productsSnap.forEach((doc) => {
    const p = doc.data();
    products.push({
      id: doc.id,
      title: p.title,
      type: p.type,
      price: p.price,
      category: p.category,
      stock: p.stock,
      isActive: p.isActive,
      totalSales: p.totalSales || 0,
      images: p.images || [],
      createdAt: p.createdAt
    });
  });

  return res.status(200).json({
    success: true,
    vendor: {
      bankAccount: vendor.bankAccount || null,
      totalEarned: vendor.totalEarned || 0,
      pendingPayout,
      availableNow,
      heldAmount,
      nextAvailableAt,
      awaitingPayout: vendor.awaitingPayout || 0,
      totalPaidOut: vendor.totalPaidOut || 0,
      totalSales: vendor.totalSales || 0
    },
    products
  });
}

/**
 * GET /api/vendors/get-orders
 * Any authenticated user. Returns the caller's own sales across ALL of
 * their products, newest first — powers the seller dashboard's Orders tab.
 * Uses a collectionGroup('sales') query filtered by vendorUid.
 *
 * NOTE: requires a one-time Firestore composite index (collection group
 * 'sales', field 'vendorUid' Ascending, field 'createdAt' Descending). The
 * first request will fail with an error containing a direct link to
 * auto-create it.
 */
async function handleGetOrders(req, res, admin, db) {
  const ORDERS_LIMIT = 200;
  const user = await getAuthedUser(req, admin);

  const salesSnap = await db.collectionGroup('sales')
    .where('vendorUid', '==', user.uid)
    .orderBy('createdAt', 'desc')
    .limit(ORDERS_LIMIT)
    .get();

  const orders = [];
  salesSnap.forEach((doc) => {
    const s = doc.data();
    orders.push({
      reference: s.reference,
      productId: s.productId,
      productTitle: s.productTitle,
      imageUrl: s.imageUrl || null,
      productType: s.productType,
      quantity: s.quantity,
      amount: s.amount,
      commissionAmount: s.commissionAmount,
      vendorAmount: s.vendorAmount,
      fulfillmentStatus: s.fulfillmentStatus,
      shippingAddress: s.shippingAddress || null,
      trackingNumber: s.trackingNumber || null,
      carrier: s.carrier || null,
      createdAt: s.createdAt
    });
  });

  return res.status(200).json({ success: true, orders });
}

async function handleGetSubscriptionSummary(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);
  const vendorRef = db.collection('vendors').doc(user.uid);
  const vendorSnap = await vendorRef.get();
  const vendor = vendorSnap.exists ? vendorSnap.data() : {};
  const paymentsSnap = await vendorRef.collection('subscriptionPayments')
    .orderBy('createdAt', 'desc').limit(50).get();

  return res.status(200).json({
    tiers: Object.fromEntries(Object.entries(TIERS).map(([key, value]) => [key, value])),
    vendor: {
      subscriptionTier: vendor.subscriptionTier || 'safseed',
      subscriptionStatus: vendor.subscriptionStatus || 'active',
      subscriptionExpiresAt: vendor.subscriptionExpiresAt || null,
      subscriptionOverrideActive: vendor.subscriptionOverrideActive === true
    },
    payments: paymentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  });
}

async function notifyBuyerOrderShipped({ admin, db, sale, reference, trackingNumber, carrier }) {
  try {
    const buyer = await getRecipient(admin, db, sale.buyerUid, ['user']);
    const orderLink = `${APP_URL}/users/marketplace-orders.html`;
    const trackingDetails = [carrier, trackingNumber].filter(Boolean).join(' / ');
    const trackingMessage = trackingDetails ? ` Tracking: ${trackingDetails}.` : '';

    await Promise.all([
      sendEmail({
        toEmail: buyer.email,
        toName: buyer.name,
        subject: `Order shipped: ${sale.productTitle}`,
        headline: 'Your order is on the way',
        bodyContent: `Order ${reference} for "${sale.productTitle}" has been marked as shipped.${trackingMessage}`,
        actionUrl: orderLink,
        actionText: 'View Order'
      }),
      sendNotification({
        recipientUid: sale.buyerUid,
        title: 'Order shipped',
        message: `${sale.productTitle} is on the way.${trackingMessage}`,
        link: orderLink,
        type: 'order_shipped'
      })
    ]);
  } catch (error) {
    console.error('Order shipped notifications failed (non-blocking):', error.message);
  }
}

async function notifyPayoutRequested({ admin, db, vendorUid, amount, reference }) {
  try {
    const vendor = await getRecipient(admin, db, vendorUid, ['user', 'vendors']);
    const payoutLink = `${APP_URL}/users/sellers-page.html#payouts-pane`;

    await sendEmail({
      toEmail: vendor.email,
      toName: vendor.name,
      subject: 'Payout request submitted',
      headline: 'Your payout request is processing',
      bodyContent: `Your payout request for NGN ${amount.toLocaleString('en-NG')} was submitted successfully. Reference: ${reference}.`,
      actionUrl: payoutLink,
      actionText: 'View Payouts'
    });

    const admins = await db.collection('user').where('role', '==', 'admin').get();
    const adminLink = `${APP_URL}/safpedia%20concept%20admin%20dashboard/vendor-management.html#payouts-pane`;
    await Promise.all(admins.docs.map((adminDoc) => sendNotification({
      recipientUid: adminDoc.id,
      title: 'Vendor payout requested',
      message: `${vendor.name} requested a payout of NGN ${amount.toLocaleString('en-NG')}.`,
      link: adminLink,
      type: 'vendor_payout_request'
    })));
  } catch (error) {
    console.error('Payout request notifications failed (non-blocking):', error.message);
  }
}
