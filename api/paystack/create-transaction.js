const { getFirebaseAdmin } = require('../../lib/firebase-admin');

/**
 * POST /api/paystack/create-transaction
 * Body: { courseId, referralCode? }
 * Header: Authorization: Bearer <firebase-id-token>
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    // ---- Auth ----
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // ---- Input ----
    const { courseId, referralCode } = req.body || {};
    if (!courseId) {
      return res.status(400).json({ error: 'Missing courseId' });
    }

    // ---- Course lookup ----
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const course = courseSnap.data();
    if (typeof course.price !== 'number') {
      return res.status(400).json({ error: 'Course price must be a number in Firestore' });
    }

    // ---- Validate referral code (if provided) ----
    // We resolve it here rather than trusting it blindly in the webhook,
    // since only an approved affiliate should ever earn commission.
    let validatedReferral = null;
    if (referralCode) {
      const affQuery = await db.collection('affiliates')
        .where('code', '==', referralCode)
        .where('status', '==', 'approved')
        .limit(1)
        .get();

      if (!affQuery.empty) {
        validatedReferral = {
          code: referralCode,
          affiliateUid: affQuery.docs[0].id
        };
      } else {
        console.warn('Referral code provided but not valid/approved:', referralCode);
      }
    }

    // ---- Paystack init ----
    const amountKobo = Math.round(course.price * 100);
    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });
    }

    const origin = req.headers.origin || process.env.SITE_URL || 'https://techwizardsacademy.com';
    const callbackUrl = `${origin}/payment-success.html`;

    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: decoded.email,
        amount: amountKobo,
        callback_url: callbackUrl,
        metadata: {
          userId: uid,
          courseId,
          courseName: course.title || 'Course',
          referralCode: validatedReferral ? validatedReferral.code : null,
          affiliateUid: validatedReferral ? validatedReferral.affiliateUid : null
        }
      })
    });

    const initJson = await initRes.json();

    if (!initJson.status) {
      console.error('Paystack init failed:', initJson);
      return res.status(502).json({
        error: 'Paystack initialization failed',
        details: initJson
      });
    }

    console.log('Payment initialized:', {
      reference: initJson.data.reference,
      userId: uid,
      courseId,
      referral: validatedReferral?.code || 'none'
    });

    return res.status(200).json({
      authorization_url: initJson.data.authorization_url,
      reference: initJson.data.reference
    });

  } catch (err) {
    console.error('Transaction creation error:', err);
    return res.status(500).json({ error: err.message });
  }
};