/* Manual legacy-dispute backfill. Dry-run by default; pass --apply to write. */
const admin = require('firebase-admin');
if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const apply = process.argv.includes('--apply');

async function main() {
  const snap = await db.collection('disputes').get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.reference || (typeof data.vendorUid === 'string' && data.vendorUid.trim())) continue;
    const matches = await db.collectionGroup('sales').where('reference', '==', String(data.reference).trim()).limit(1).get();
    if (matches.empty) { console.log(`[SKIP] ${doc.id}: no sale for reference ${data.reference}`); continue; }
    const vendorUid = matches.docs[0].data().vendorUid;
    if (!vendorUid) { console.log(`[SKIP] ${doc.id}: matching sale has no vendorUid`); continue; }
    console.log(`[${apply ? 'PATCH' : 'DRY-RUN'}] ${doc.id}: ${JSON.stringify(data.vendorUid)} -> ${JSON.stringify(vendorUid)}`);
    if (apply) await doc.ref.update({ vendorUid });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
