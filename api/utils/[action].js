const { getFirebaseAdmin } = require('../../lib/firebase-admin');

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const DEFAULT_ACTION_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

async function sendEmail({ toEmail, toName, subject, headline, bodyContent, actionUrl, actionText }) {
  if (!toEmail) {
    console.warn('Email dispatch skipped: recipient email is missing');
    return { success: false, skipped: true };
  }

  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || process.env.EMAILJS_USER_ID;
  if (!serviceId || !templateId || !publicKey) {
    console.warn('Email dispatch skipped: EmailJS configuration is incomplete');
    return { success: false, skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const payload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        to_email: toEmail,
        to_name: toName || 'Valued User',
        subject,
        headline,
        body_content: bodyContent,
        action_url: actionUrl || DEFAULT_ACTION_URL,
        action_text: actionText || 'View Dashboard'
      }
    };
    if (process.env.EMAILJS_PRIVATE_KEY) payload.accessToken = process.env.EMAILJS_PRIVATE_KEY;
    const response = await fetch(EMAILJS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`EmailJS returned ${response.status}: ${await response.text()}`);
    return { success: true };
  } catch (error) {
    console.error('Email dispatch failed (non-blocking):', error.message);
    return { success: false, error };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendNotification({ recipientUid, title, message, link, type }) {
  if (!recipientUid) {
    console.warn('Notification write skipped: recipient UID is missing');
    return { success: false, skipped: true };
  }
  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    // Check if user document exists under 'user' singular or 'users' plural
    const userDoc = await db.collection('user').doc(recipientUid).get();
    const targetCollection = userDoc.exists ? 'user' : 'users';

    const notificationRef = await db.collection(targetCollection).doc(recipientUid).collection('notifications').add({
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

async function getRecipient(admin, db, uid, profileCollections = []) {
  let profile = {};
  for (const collectionName of profileCollections) {
    try {
      const snapshot = await db.collection(collectionName).doc(uid).get();
      if (snapshot.exists) profile = { ...profile, ...snapshot.data() };
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

module.exports = { sendEmail, sendNotification, getRecipient };