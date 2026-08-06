import { db } from '../firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

function getNotificationsCollection(userUid) {
  return collection(db, 'users', userUid, 'notifications');
}

export async function sendInAppNotification(
  recipientUid,
  { title, message, link = '', type = 'info' }
) {
  if (!recipientUid || !title || !message) {
    throw new Error('recipientUid, title, and message are required');
  }

  const notificationRef = doc(getNotificationsCollection(recipientUid));
  await setDoc(notificationRef, {
    id: notificationRef.id,
    title: String(title).trim(),
    message: String(message).trim(),
    link: link ? String(link).trim() : '',
    read: false,
    type: type ? String(type).trim() : 'info',
    createdAt: serverTimestamp()
  });

  return notificationRef.id;
}

export function listenToUnreadNotifications(userUid, callback) {
  if (!userUid || typeof callback !== 'function') {
    throw new Error('userUid and callback are required');
  }

  const unreadQuery = query(
    getNotificationsCollection(userUid),
    where('read', '==', false)
  );

  return onSnapshot(
    unreadQuery,
    (snapshot) => {
      const notifications = snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

      callback(notifications, snapshot.size);
    },
    (error) => callback([], 0, error)
  );
}

export async function markAllNotificationsAsRead(userUid) {
  if (!userUid) {
    throw new Error('userUid is required');
  }

  const snapshot = await getDocs(query(
    getNotificationsCollection(userUid),
    where('read', '==', false)
  ));

  if (snapshot.empty) return;

  const batch = writeBatch(db);
  snapshot.docs.forEach((snapshotDoc) => {
    batch.update(snapshotDoc.ref, { read: true });
  });
  await batch.commit();
}
