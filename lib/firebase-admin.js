const admin = require('firebase-admin');

/**
 * Lazily initializes Firebase Admin exactly once per cold start,
 * and returns the admin instance. Import this in every /api function
 * instead of re-initializing.
 */
function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccount) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
    }
    const cred = JSON.parse(serviceAccount);
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  return admin;
}

module.exports = { getFirebaseAdmin };