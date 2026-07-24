/**
 * Shared auth helpers for /api functions.
 * Verifies the Firebase ID token on the request and (optionally) enforces admin role.
 * Throws an Error with .statusCode set — callers should catch and respond with that code.
 */

async function getAuthedUser(req, admin) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const idToken = authHeader.replace('Bearer ', '');

  if (!idToken) {
    const err = new Error('Missing authorization token');
    err.statusCode = 401;
    throw err;
  }

  const decoded = await admin.auth().verifyIdToken(idToken);
  const db = admin.firestore();
  const userDoc = await db.collection('user').doc(decoded.uid).get();
  const profile = userDoc.exists ? userDoc.data() : {};
  const role = profile.role || 'student';

  return { uid: decoded.uid, email: decoded.email, role, profile };
}

async function requireAdmin(req, admin) {
  const user = await getAuthedUser(req, admin);
  if (user.role !== 'admin') {
    const err = new Error('Access denied. Admins only.');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

module.exports = { getAuthedUser, requireAdmin };