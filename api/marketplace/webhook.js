// api/marketplace/webhook.js

const crypto = require('crypto');
const { getFirebaseAdmin } = require('../../lib/firebase-admin');

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
 *
 * Stock is re-checked and decremented atomically here (not at checkout
 * init) to avoid overselling. If two buyers race for the last unit, the
 * loser's payment is refunded via the Paystack Refund API rather than
 * silently taking their money for a product that's no longer available.
 */
async function handleChargeSuccess(data, admin, db, res, PAYSTACK_SECRET) {
  const metadata = data.metadata || {};

  if (metadata.orderType !== 'marketplace') {
    console.log('Ignoring non-marketplace charge.success event');
    return res.status(200).send('ok');
  }

  const { buyerUid, productId, vendorUid, quantity, commissionRate } = metadata;
  const reference = data.reference;

  if (!buyerUid || !productId || !vendorUid) {
    console.error('Missing required metadata on marketplace charge:', metadata);
    return res.status(400).send('Missing required metadata');
  }

  const qty = typeof quantity === 'number' ? quantity : 1;
  const rate = typeof commissionRate === 'number' ? commissionRate : 0.15;
  const amountNaira = data.amount / 100; // kobo -> naira
  const commissionAmount = Math.round(amountNaira * rate * 100) / 100;
  const vendorAmount = Math.round((amountNaira - commissionAmount) * 100) / 100;

  const productRef = db.collection('vendorProducts').doc(productId);
  const saleRef = productRef.collection('sales').doc(reference);
  const vendorRef = db.collection('vendors').doc(vendorUid);

  let oversold = false;

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

      let fulfillmentStatus;

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
        productTitle: metadata.productTitle || product.title || 'Product',
        productType: product.type,
        quantity: qty,
        amount: amountNaira,
        commissionRate: rate,
        commissionAmount,
        vendorAmount,
        fulfillmentStatus,
        shippingAddress: product.type === 'physical' ? (metadata.shippingAddress || null) : null,
        createdAt: admin.firestore.Timestamp.now()
      });
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
      // If the automated refund call itself fails, this needs a human to
      // resolve manually — logging loudly rather than failing silently.
      console.error('❌ AUTOMATED REFUND FAILED — manual action required:', reference, refundErr.message);
    }
    return res.status(200).send('ok');
  }

  console.log(`✓ Marketplace sale recorded and vendor credited: ${reference}`);
  return res.status(200).json({ success: true, reference });
}

/**
 * Settles a vendorPayoutRequests doc once Paystack confirms the transfer's
 * final state. Mirrors the affiliate payout settlement logic, but reads
 * from the vendorPayoutRequests collection group — kept as a distinct name
 * from affiliates' payoutRequests so the two collection groups never overlap.
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

    return res.status(200).send('ok');

  } catch (err) {
    console.error('Vendor transfer webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}