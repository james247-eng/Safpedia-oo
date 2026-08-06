async function getRecipient(admin, db, uid, profileCollections = []) {
  let profile = {};

  for (const collectionName of profileCollections) {
    try {
      const snapshot = await db.collection(collectionName).doc(uid).get();
      if (snapshot.exists) {
        profile = { ...profile, ...snapshot.data() };
      }
    } catch (error) {
      console.warn(`Could not load ${collectionName}/${uid}:`, error.message);
    }
  }

  let authUser = null;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (error) {
    console.warn(`Could not load auth user ${uid}:`, error.message);
  }

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

  return {
    email: profile.email || authUser?.email || '',
    name: profile.businessName || profile.displayName || profile.name || fullName || authUser?.displayName || 'Valued User'
  };
}

module.exports = { getRecipient };
