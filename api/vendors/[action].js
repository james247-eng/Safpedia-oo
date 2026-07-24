// api/vendors/[action].js

const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { getAuthedUser } = require('../../lib/auth');

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

  const available = vendorData.pendingPayout || 0;
  const requestAmount = typeof amount === 'number' && amount > 0 ? amount : available;

  if (requestAmount <= 0) {
    return res.status(400).json({ error: 'No payout balance available' });
  }
  if (requestAmount > available) {
    return res.status(400).json({ error: `Requested amount exceeds available balance of ₦${available}` });
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
      pendingPayout: vendor.pendingPayout || 0,
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