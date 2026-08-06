const { getFirebaseAdmin } = require('../../lib/firebase-admin');

async function sendNotification({ recipientUid, title, message, link, type }) {
  if (!recipientUid) {
    console.warn('Notification write skipped: recipient UID is missing');
    return { success: false, skipped: true };
  }

  try {
    const admin = getFirebaseAdmin();
    const notificationRef = await admin.firestore()
      .collection('users')
      .doc(recipientUid)
      .collection('notifications')
      .add({
        title,
        message,
        link: link || '',
        read: false,
        type: type || 'general',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

    return { success: true, id: notificationRef.id };
  } catch (error) {
    console.error('Notification write failed (non-blocking):', error.message);
    return { success: false, error };
  }
}

module.exports = { sendNotification };
