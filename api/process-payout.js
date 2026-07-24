import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { payoutId } = req.body;
  if (!payoutId) {
    return res.status(400).json({ error: 'Missing target payout identifier parameters' });
  }

  try {
    // Run an atomic server-side transaction loop to prevent payout collision or duplicate runs
    const result = await db.runTransaction(async (transaction) => {
      const payoutRef = db.collection('payouts').doc(payoutId);
      const payoutSnap = await transaction.get(payoutRef);

      if (!payoutSnap.exists) {
        throw new Error('Target payout allocation document does not exist.');
      }

      const payoutData = payoutSnap.data();

      // Lock security gate against duplicate processing requests
      if (payoutData.status !== 'pending') {
        throw new Error('This payout request has already been resolved or processed.');
      }

      const affiliateRef = db.collection('user').doc(payoutData.affiliateId);
      const affiliateSnap = await transaction.get(affiliateRef);

      if (!affiliateSnap.exists) {
        throw new Error('Referencing affiliate account could not be found.');
      }

      const affiliateData = affiliateSnap.data();
      const bankDetails = payoutData.bankDetails; // Contains bankCode, accountNumber, accountName

      if (!bankDetails || !bankDetails.bankCode || !bankDetails.accountNumber) {
        throw new Error('Incomplete affiliate settlement bank routing parameters provided.');
      }

      // 1. GENERATE PAYSTACK TRANSFER RECIPIENT REFERENCE
      const recipientResponse = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: "nuban",
          name: `${affiliateData.firstName || ''} ${affiliateData.lastName || 'Affiliate'}`.trim(),
          account_number: bankDetails.accountNumber,
          bank_code: bankDetails.bankCode,
          currency: "NGN"
        })
      });

      const recipientResult = await recipientResponse.json();
      if (!recipientResponse.ok || !recipientResult.status) {
        throw new Error(recipientResult.message || 'Failed creating Paystack transfer destination parameter.');
      }

      const recipientCode = recipientResult.data.recipient_code;

      // 2. INITIATE PAYSTACK DIRECT NUBAN TRANSFER OUT
      const transferResponse = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: "balance",
          amount: payoutData.amount, // Value passed directly in Kobo currency standards
          recipient: recipientCode,
          reason: `Tech Wizards Academy Affiliate Earnings Payout ID: ${payoutId}`
        })
      });

      const transferResult = await transferResponse.json();
      if (!transferResponse.ok || !transferResult.status) {
        throw new Error(transferResult.message || 'Paystack live fund allocation transfer declined.');
      }

      // 3. SECURELY REDUCE BALANCES AND UPDATE TRANSACTION RECORDS
      transaction.update(payoutRef, {
        status: 'processing',
        paystackTransferCode: transferResult.data.transfer_code,
        processedAt: FieldValue.serverTimestamp()
      });

      return { success: true, referenceCode: transferResult.data.transfer_code };
    });

    return res.status(200).json({ status: 'success', message: 'Paystack ledger execution finalized', transferCode: result.referenceCode });

  } catch (error) {
    console.error('CRITICAL PAYOUT ENGINE FAULT:', error.message);
    return res.status(400).json({ error: error.message });
  }
}