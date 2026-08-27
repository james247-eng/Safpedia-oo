/* Read-only Firestore diagnostics for vendor dispute visibility. */
const admin = require('firebase-admin');

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  console.log('PROJECT_ID', serviceAccount.project_id);
  const snap = await db.collection('disputes').get();
  console.log('CONNECTIVITY_OK', true);
  console.log('TOTAL', snap.size);

  let missingVendorUid = 0;
  let missingReference = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const vendorMissing = data.vendorUid == null || (typeof data.vendorUid === 'string' && !data.vendorUid.trim());
    const referenceMissing = data.reference == null || (typeof data.reference === 'string' && !data.reference.trim());
    if (vendorMissing) missingVendorUid += 1;
    if (referenceMissing) missingReference += 1;
    console.log('DISPUTE', JSON.stringify({
      id: doc.id,
      reference: data.reference,
      buyerUid: data.buyerUid,
      vendorUid: data.vendorUid,
      status: data.status
    }));
  }
  console.log('MISSING_OR_EMPTY_VENDOR_UID', missingVendorUid);
  console.log('MISSING_OR_EMPTY_REFERENCE', missingReference);

  const realVendorDoc = snap.docs.find((doc) => {
    const uid = doc.data().vendorUid;
    return typeof uid === 'string' && uid.trim();
  });
  if (!realVendorDoc) {
    console.log('VENDOR_QUERY', JSON.stringify({ skipped: true, reason: 'No non-empty vendorUid found' }));
    return;
  }
  const vendorUid = realVendorDoc.data().vendorUid;
  const vendorSnap = await db.collection('disputes').where('vendorUid', '==', vendorUid).get();
  console.log('VENDOR_QUERY', JSON.stringify({
    vendorUid,
    count: vendorSnap.size,
    ids: vendorSnap.docs.map((doc) => doc.id)
  }));
}

main().catch((err) => {
  console.error('DIAGNOSTIC_FAILED', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
