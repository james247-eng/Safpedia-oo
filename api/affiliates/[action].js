const crypto = require('crypto');
const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { requireAdmin, getAuthedUser } = require('../../lib/auth');

function generateReferralCode(seed) {
  const base = (seed || 'AFF').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6) || 'AFF';
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${base}${suffix}`;
}

async function rollbackPayout(db, admin, affRef, payoutRef, amount, reason) {
  await db.runTransaction(async (tx) => {
    tx.set(payoutRef, {
      status: 'failed',
      failureReason: reason,
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
    tx.set(affRef, {
      pendingPayout: admin.firestore.FieldValue.increment(amount),
      awaitingPayout: admin.firestore.FieldValue.increment(-amount),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
  });
}

/**
 * POST /api/affiliates/apply
 * Any authenticated student can call this to apply for the affiliate program.
 * Body: { reason?, socialLink? }
 */
async function handleApply(req, res, admin, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getAuthedUser(req, admin);
    const { reason, socialLink } = req.body || {};

    const existing = await db.collection('affiliates').doc(user.uid).get();
    if (existing.exists) {
      return res.status(409).json({
        error: 'You already have an affiliate application on file',
        status: existing.data().status
      });
    }

    const fallbackName = user.displayName || user.email || 'Anonymous Student';
    const affiliateName = user.firstName
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
      : fallbackName;

    const affiliateData = {
      uid: user.uid,
      email: user.email || '',
      name: affiliateName,
      code: null,
      status: 'pending',
      commissionRate: null,
      totalEarned: 0,
      pendingPayout: 0,
      awaitingPayout: 0,
      totalPaidOut: 0,
      totalSales: 0,
      createdBy: 'self-application',
      applicationReason: reason || '',
      applicationSocialLink: socialLink || '',
      appliedAt: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    await db.collection('affiliates').doc(user.uid).set(affiliateData);

    return res.status(200).json({
      success: true,
      message: 'Application submitted. Awaiting admin approval.'
    });
  } catch (err) {
    console.error('apply error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

/**
 * POST /api/affiliates/approve
 * Admin only. Approves (or rejects) a pending self-application from /apply.
 * Body: { affiliateUid, commissionRate, action? }  action: 'approve' (default) | 'reject'
 */
async function handleApprove(req, res, admin, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await requireAdmin(req, admin);

    const { affiliateUid, commissionRate, action } = req.body || {};

    if (!affiliateUid) {
      return res.status(400).json({ error: 'Missing affiliateUid' });
    }

    const affRef = db.collection('affiliates').doc(affiliateUid);
    const affSnap = await affRef.get();

    if (!affSnap.exists) {
      return res.status(404).json({ error: 'Affiliate application not found' });
    }

    const affData = affSnap.data();
    if (affData.status !== 'pending') {
      return res.status(409).json({ error: `Application already ${affData.status}` });
    }

    if (action === 'reject') {
      await affRef.set({
        status: 'rejected',
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      return res.status(200).json({ success: true, status: 'rejected' });
    }

    if (typeof commissionRate !== 'number' || commissionRate <= 0 || commissionRate > 1) {
      return res.status(400).json({ error: 'commissionRate must be a decimal between 0 and 1 (e.g. 0.2 for 20%)' });
    }

    let code;
    let attempts = 0;
    do {
      code = generateReferralCode(affData.name);
      const clash = await db.collection('affiliates').where('code', '==', code).limit(1).get();
      if (clash.empty) break;
      attempts++;
    } while (attempts < 5);

    await affRef.set({
      status: 'approved',
      code,
      commissionRate,
      approvedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });

    await db.collection('user').doc(affiliateUid).set(
      { isAffiliate: true, updatedAt: admin.firestore.Timestamp.now() },
      { merge: true }
    );

    return res.status(200).json({ success: true, status: 'approved', code, commissionRate });
  } catch (err) {
    console.error('approve error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

/**
 * POST /api/affiliates/create-account
 * Admin only. Grants affiliate status to an existing user immediately (no approval step).
 * Body: { uid, commissionRate }
 */
async function handleCreateAccount(req, res, admin, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await requireAdmin(req, admin);

    const { uid, commissionRate } = req.body || {};

    if (!uid) {
      return res.status(400).json({ error: 'Missing uid of the user to make an affiliate' });
    }
    if (typeof commissionRate !== 'number' || commissionRate <= 0 || commissionRate > 1) {
      return res.status(400).json({ error: 'commissionRate must be a decimal between 0 and 1 (e.g. 0.2 for 20%)' });
    }

    const userDoc = await db.collection('user').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();

    const existing = await db.collection('affiliates').doc(uid).get();
    if (existing.exists) {
      return res.status(409).json({
        error: 'This user already has an affiliate account',
        status: existing.data().status
      });
    }

    let code;
    let attempts = 0;
    do {
      code = generateReferralCode(userData.firstName || userData.email);
      const clash = await db.collection('affiliates').where('code', '==', code).limit(1).get();
      if (clash.empty) break;
      attempts++;
    } while (attempts < 5);

    const affiliateData = {
      uid,
      email: userData.email || '',
      name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email,
      code,
      status: 'approved',
      commissionRate,
      totalEarned: 0,
      pendingPayout: 0,
      awaitingPayout: 0,
      totalPaidOut: 0,
      totalSales: 0,
      createdBy: 'admin',
      approvedAt: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    await db.collection('affiliates').doc(uid).set(affiliateData);

    await db.collection('user').doc(uid).set(
      { isAffiliate: true, updatedAt: admin.firestore.Timestamp.now() },
      { merge: true }
    );

    return res.status(200).json({ success: true, affiliate: affiliateData });
  } catch (err) {
    console.error('create-account error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

/**
 * GET /api/affiliates/list-banks
 * Any authenticated user. Returns { name, code } for every Nigerian bank Paystack supports.
 */
async function handleListBanks(req, res, admin) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await getAuthedUser(req, admin);

    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });
    }

    const banksRes = await fetch('https://api.paystack.co/bank?country=nigeria', {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const banksJson = await banksRes.json();

    if (!banksJson.status) {
      return res.status(502).json({ error: 'Could not fetch bank list from Paystack' });
    }

    const banks = banksJson.data.map((b) => ({ name: b.name, code: b.code }));
    return res.status(200).json({ success: true, banks });
  } catch (err) {
    console.error('list-banks error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

/**
 * POST /api/affiliates/add-bank-account
 * Approved affiliate only. Resolves account number -> name, registers a Paystack
 * transfer recipient, stores recipientCode. Body: { bankCode, accountNumber }
 */
async function handleAddBankAccount(req, res, admin, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const user = await getAuthedUser(req, admin);
    const { bankCode, accountNumber } = req.body || {};

    if (!bankCode || !accountNumber) {
      return res.status(400).json({ error: 'Missing bankCode or accountNumber' });
    }

    const affRef = db.collection('affiliates').doc(user.uid);
    const affSnap = await affRef.get();

    if (!affSnap.exists || affSnap.data().status !== 'approved') {
      return res.status(403).json({ error: 'You do not have an approved affiliate account' });
    }

    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });
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

    await affRef.set({
      bankAccount,
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });

    return res.status(200).json({ success: true, bankAccount });
  } catch (err) {
    console.error('add-bank-account error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

/**
 * POST /api/affiliates/request-payout
 * Approved affiliate only, requires a bank account already added via add-bank-account.
 * Body: { amount? } // defaults to full pendingPayout balance if omitted
 */
async function handleRequestPayout(req, res, admin, db) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let affRef, payoutRef, requestAmount;

  try {
    const user = await getAuthedUser(req, admin);
    const { amount } = req.body || {};

    affRef = db.collection('affiliates').doc(user.uid);
    const affSnap = await affRef.get();

    if (!affSnap.exists || affSnap.data().status !== 'approved') {
      return res.status(403).json({ error: 'You do not have an approved affiliate account' });
    }

    const affData = affSnap.data();

    if (!affData.bankAccount || !affData.bankAccount.recipientCode) {
      return res.status(400).json({ error: 'Add a bank account before requesting a payout' });
    }

    const available = affData.pendingPayout || 0;
    requestAmount = typeof amount === 'number' && amount > 0 ? amount : available;

    if (requestAmount <= 0) {
      return res.status(400).json({ error: 'No payout balance available' });
    }
    if (requestAmount > available) {
      return res.status(400).json({ error: `Requested amount exceeds available balance of ₦${available}` });
    }

    payoutRef = affRef.collection('payoutRequests').doc();

    await db.runTransaction(async (tx) => {
      tx.set(payoutRef, {
        amount: requestAmount,
        status: 'processing',
        reference: payoutRef.id,
        affiliateUid: user.uid,
        createdAt: admin.firestore.Timestamp.now()
      });
      tx.set(affRef, {
        pendingPayout: admin.firestore.FieldValue.increment(-requestAmount),
        awaitingPayout: admin.firestore.FieldValue.increment(requestAmount),
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });
    });

    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      await rollbackPayout(db, admin, affRef, payoutRef, requestAmount, 'PAYSTACK_SECRET_KEY not configured');
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
          recipient: affData.bankAccount.recipientCode,
          reason: 'Affiliate commission payout',
          reference: payoutRef.id
        })
      });
      transferJson = await transferRes.json();
    } catch (networkErr) {
      await rollbackPayout(db, admin, affRef, payoutRef, requestAmount, networkErr.message);
      return res.status(502).json({ error: 'Could not reach Paystack transfer API: ' + networkErr.message });
    }

    if (!transferJson.status) {
      await rollbackPayout(db, admin, affRef, payoutRef, requestAmount, transferJson.message || 'Transfer rejected');
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
  } catch (err) {
    console.error('request-payout error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

const actions = {
  'apply': handleApply,
  'approve': handleApprove,
  'create-account': handleCreateAccount,
  'list-banks': handleListBanks,
  'add-bank-account': handleAddBankAccount,
  'request-payout': handleRequestPayout
};

module.exports = async (req, res) => {
  const { action } = req.query;
  const handler = actions[action];

  if (!handler) {
    return res.status(404).json({ error: `Unknown affiliates action: ${action}` });
  }

  const admin = getFirebaseAdmin();
  const db = admin.firestore();

  return handler(req, res, admin, db);
};