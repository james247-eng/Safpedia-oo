const crypto = require('crypto');
const { getFirebaseAdmin } = require('../../lib/firebase-admin');

// Paystack signature verification needs the RAW request body.
// Disabling Vercel's default JSON body parsing so we can read the exact bytes.
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      console.error('PAYSTACK_SECRET_KEY not configured');
      return res.status(500).send('PAYSTACK_SECRET_KEY not configured');
    }

    // ---- Verify signature against raw body ----
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-paystack-signature'];

    if (!signature) {
      console.warn('Missing Paystack signature');
      return res.status(400).send('Missing signature');
    }

    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');
    if (hash !== signature) {
      console.warn('Invalid signature on webhook');
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.event;
    const data = payload.data;

    console.log('Webhook received:', eventType, 'Reference:', data.reference);

    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    if (eventType === 'transfer.success' || eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      return handleTransferEvent(eventType, data, admin, db, res);
    }

    if (eventType !== 'charge.success') {
      console.log('Unhandled event type:', eventType);
      return res.status(200).send('ok');
    }

    const metadata = data.metadata || {};
    const userId = metadata.userId;
    const courseId = metadata.courseId;
    const reference = data.reference;
    const referralCode = metadata.referralCode || null;
    const affiliateUid = metadata.affiliateUid || null;

    if (!userId || !courseId) {
      console.error('Missing userId or courseId in metadata');
      return res.status(400).send('Missing required metadata');
    }

    // ---- Student details ----
    let studentName = 'Unknown Student';
    let studentEmail = data.customer?.email || 'Unknown';
    try {
      const userDoc = await db.collection('user').doc(userId).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        studentName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || studentEmail;
        studentEmail = u.email || studentEmail;
      }
    } catch (err) {
      console.warn('Could not fetch user data:', err.message);
    }

    // ---- Course details ----
    let courseTitle = 'Unknown Course';
    let coursePrice = 0;
    try {
      const courseDoc = await db.collection('courses').doc(courseId).get();
      if (courseDoc.exists) {
        const c = courseDoc.data();
        courseTitle = c.title || 'Unknown Course';
        coursePrice = c.price || 0;
      }
    } catch (err) {
      console.warn('Could not fetch course data:', err.message);
    }

    // ---- paid_at parsing ----
    let paidAt;
    try {
      if (data.paid_at) {
        paidAt = typeof data.paid_at === 'string'
          ? admin.firestore.Timestamp.fromDate(new Date(data.paid_at))
          : admin.firestore.Timestamp.fromMillis(data.paid_at * 1000);
      } else {
        paidAt = admin.firestore.Timestamp.now();
      }
    } catch (err) {
      console.warn('Error parsing paid_at, using current time:', err.message);
      paidAt = admin.firestore.Timestamp.now();
    }

    const purchase = {
      userId,
      courseId,
      studentName,
      studentEmail,
      courseTitle,
      coursePrice,
      amount: data.amount, // kobo
      currency: data.currency || 'NGN',
      payment_provider: 'paystack',
      reference,
      status: 'paid',
      referralCode: referralCode || null,
      affiliateUid: affiliateUid || null,
      commissionAmount: 0,
      paid_at: paidAt,
      createdAt: admin.firestore.Timestamp.now()
    };

    // ---- Affiliate commission crediting ----
    // Re-validates status here too (not just trusting create-transaction's check),
    // since an affiliate could be revoked between checkout start and payment completion.
    if (affiliateUid) {
      try {
        const affRef = db.collection('affiliates').doc(affiliateUid);
        const affSnap = await affRef.get();

        if (affSnap.exists && affSnap.data().status === 'approved') {
          const affData = affSnap.data();
          const rate = typeof affData.commissionRate === 'number' ? affData.commissionRate : 0;
          // amount is in kobo; commission stored in naira
          const commission = Math.round((data.amount * rate)) / 100;

          purchase.commissionAmount = commission;

          await affRef.set({
            totalEarned: admin.firestore.FieldValue.increment(commission),
            pendingPayout: admin.firestore.FieldValue.increment(commission),
            totalSales: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.Timestamp.now()
          }, { merge: true });

          // Ledger entry per sale, for auditability / payout history
          await affRef.collection('commissions').doc(reference).set({
            reference,
            courseId,
            courseTitle,
            saleAmount: data.amount / 100,
            commissionAmount: commission,
            rate,
            studentEmail,
            createdAt: admin.firestore.Timestamp.now()
          });

          console.log(`✓ Credited ₦${commission} commission to affiliate ${affiliateUid}`);
        } else {
          console.warn('Referral affiliate not found or not approved at payment time:', affiliateUid);
        }
      } catch (err) {
        // Commission crediting must never block enrollment fulfillment
        console.error('Error crediting affiliate commission:', err.message);
      }
    }

    // ---- Save purchase records ----
    await db.collection('purchases').doc(reference).set(purchase, { merge: true });
    await db.collection('user').doc(userId).collection('purchases').doc(reference).set(purchase, { merge: true });

    // ---- Enroll the student ----
    await db.collection('user').doc(userId).set({
      enrolledCourses: admin.firestore.FieldValue.arrayUnion(courseId),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });

    // ---- Bump course enrollment count ----
    try {
      await db.collection('courses').doc(courseId).update({
        enrolledCount: admin.firestore.FieldValue.increment(1)
      });
    } catch (err) {
      console.warn('Could not update enrolledCount:', err.message);
    }

    console.log('✅ Purchase recorded successfully:', reference);

    return res.status(200).json({
      success: true,
      reference,
      studentName,
      courseTitle
    });

  } catch (err) {
    console.error('❌ Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Settles a payoutRequests doc once Paystack confirms the transfer's final state.
 * The doc lives at affiliates/{uid}/payoutRequests/{payoutId} — we don't know the uid
 * up front, so we find it via a collectionGroup query on the 'reference' field, which
 * request-payout.js sets equal to the doc's own ID (the same value sent to Paystack
 * as the transfer reference).
 *
 * IMPORTANT: collectionGroup queries require a Firestore index to be created once.
 * The first time this fires, Firestore/Vercel logs will contain an error with a direct
 * link to auto-create it — click it, or create manually: Collection group
 * "payoutRequests", field "reference", Ascending.
 */
async function handleTransferEvent(eventType, data, admin, db, res) {
  try {
    const reference = data.reference;
    if (!reference) {
      console.warn('Transfer webhook missing reference');
      return res.status(200).send('ok');
    }

    const matches = await db.collectionGroup('payoutRequests')
      .where('reference', '==', reference)
      .limit(1)
      .get();

    if (matches.empty) {
      console.warn('No payout request found for transfer reference:', reference);
      return res.status(200).send('ok');
    }

    const payoutDoc = matches.docs[0];
    const payoutData = payoutDoc.data();
    const affiliateUid = payoutData.affiliateUid;
    const amount = payoutData.amount;
    const affRef = db.collection('affiliates').doc(affiliateUid);

    if (payoutData.status === 'paid' || payoutData.status === 'failed') {
      console.log('Payout already settled, ignoring duplicate webhook:', reference);
      return res.status(200).send('ok');
    }

    if (eventType === 'transfer.success') {
      await db.runTransaction(async (tx) => {
        tx.set(payoutDoc.ref, {
          status: 'paid',
          paidAt: admin.firestore.Timestamp.now()
        }, { merge: true });
        tx.set(affRef, {
          awaitingPayout: admin.firestore.FieldValue.increment(-amount),
          totalPaidOut: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      });
      console.log('✓ Payout settled as paid:', reference);
    } else {
      // transfer.failed or transfer.reversed — return the reserved funds to the affiliate's balance
      await db.runTransaction(async (tx) => {
        tx.set(payoutDoc.ref, {
          status: 'failed',
          failureReason: eventType,
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
        tx.set(affRef, {
          awaitingPayout: admin.firestore.FieldValue.increment(-amount),
          pendingPayout: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      });
      console.log('✗ Payout failed/reversed, funds returned to balance:', reference);
    }

    return res.status(200).send('ok');

  } catch (err) {
    console.error('Transfer webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}