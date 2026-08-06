import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  listenToUnreadNotifications,
  markAllNotificationsAsRead
} from './notifications.js';

const DISPLAY_LIMIT = 5;

function addNotificationStyles() {
  if (document.getElementById('notification-center-styles')) return;

  const style = document.createElement('style');
  style.id = 'notification-center-styles';
  style.textContent = `
    .notification-center{position:relative;display:none;flex:0 0 auto}.notification-center.is-active{display:block}
    .notification-bell{position:relative;display:grid;place-items:center;width:40px;height:40px;padding:0;border:1px solid rgba(15,23,42,.14);border-radius:50%;background:#fff;color:#172033;cursor:pointer}.notification-bell ion-icon{font-size:21px}.notification-bell:hover,.notification-bell:focus-visible{border-color:#e85d2a;color:#e85d2a;outline:none}
    .notification-badge{position:absolute;top:-5px;right:-6px;display:none;min-width:18px;height:18px;padding:0 5px;border:2px solid #fff;border-radius:9px;background:#dc2626;color:#fff;font:700 10px/14px Inter,sans-serif;text-align:center}.notification-badge.is-visible{display:block}
    .notification-panel{position:absolute;top:calc(100% + 12px);right:0;z-index:1200;display:none;width:min(360px,calc(100vw - 24px));overflow:hidden;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 18px 45px rgba(15,23,42,.18);color:#172033}.notification-panel.is-open{display:block}
    .notification-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #eef0f3}.notification-panel-title{margin:0;font:700 15px/1.3 Inter,sans-serif}.notification-mark-all{border:0;background:transparent;color:#c94d21;cursor:pointer;font:600 12px/1.3 Inter,sans-serif}.notification-mark-all:disabled{cursor:default;opacity:.45}
    .notification-list{max-height:390px;overflow-y:auto}.notification-item{display:block;padding:13px 16px;border-bottom:1px solid #f0f1f3;color:inherit;text-decoration:none}.notification-item:hover,.notification-item:focus-visible{background:#f8fafc;outline:none}.notification-item-title{display:block;margin-bottom:4px;font:700 13px/1.4 Inter,sans-serif}.notification-item-message{display:block;color:#5d6675;font:400 12px/1.5 Inter,sans-serif}.notification-item-time{display:block;margin-top:6px;color:#8a93a1;font:500 10px/1.3 Inter,sans-serif}.notification-empty{margin:0;padding:28px 16px;color:#687181;text-align:center;font:500 13px/1.5 Inter,sans-serif}
    @media(max-width:560px){.notification-panel{position:fixed;top:72px;right:12px;left:12px;width:auto}}
  `;
  document.head.appendChild(style);
}

function formatTime(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date) return 'Just now';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function renderNotifications(container, notifications) {
  container.replaceChildren();

  if (!notifications.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'notification-empty';
    emptyState.textContent = 'You have no unread notifications.';
    container.appendChild(emptyState);
    return;
  }

  notifications.slice(0, DISPLAY_LIMIT).forEach((notification) => {
    const item = document.createElement(notification.link ? 'a' : 'div');
    item.className = 'notification-item';
    if (notification.link) item.href = notification.link;

    const title = document.createElement('span');
    title.className = 'notification-item-title';
    title.textContent = notification.title || 'Notification';

    const message = document.createElement('span');
    message.className = 'notification-item-message';
    message.textContent = notification.message || '';

    const time = document.createElement('span');
    time.className = 'notification-item-time';
    time.textContent = formatTime(notification.createdAt);

    item.append(title, message, time);
    container.appendChild(item);
  });
}

export function mountNotificationCenter() {
  const navRight = document.querySelector('#navbar .nav-right');
  const userDashboardTarget = document.querySelector(
    '.dashboard-layout .main-workspace-view, .dashboard-header, .top-nav'
  );
  const adminDashboardTarget = document.querySelector(
    'header.header .user-info, .admin-container'
  );
  const mountTarget = navRight || userDashboardTarget || adminDashboardTarget;

  if (!mountTarget || document.querySelector('.notification-center')) return;

  addNotificationStyles();

  const center = document.createElement('div');
  center.className = 'notification-center';

  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'notification-bell';
  bell.setAttribute('aria-label', 'Notifications');
  bell.setAttribute('aria-expanded', 'false');
  bell.innerHTML = '<ion-icon name="notifications-outline" aria-hidden="true"></ion-icon>';

  const badge = document.createElement('span');
  badge.className = 'notification-badge';
  badge.setAttribute('aria-hidden', 'true');
  bell.appendChild(badge);

  const panel = document.createElement('div');
  panel.className = 'notification-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Recent notifications');
  panel.innerHTML = `
    <div class="notification-panel-header">
      <p class="notification-panel-title">Notifications</p>
      <button type="button" class="notification-mark-all">Mark all as read</button>
    </div>
    <div class="notification-list"></div>
  `;

  center.append(bell, panel);
  if (navRight) {
    const profileIcon = navRight.querySelector('#profile-icon');
    navRight.insertBefore(center, profileIcon || navRight.firstChild);
  } else if (mountTarget.matches('.main-workspace-view, .dashboard-header, .top-nav')) {
    mountTarget.prepend(center);
  } else {
    mountTarget.append(center);
  }

  const list = panel.querySelector('.notification-list');
  const markAllButton = panel.querySelector('.notification-mark-all');
  let currentUid = null;
  let unsubscribe = null;

  const closePanel = () => {
    panel.classList.remove('is-open');
    bell.setAttribute('aria-expanded', 'false');
  };

  bell.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = panel.classList.toggle('is-open');
    bell.setAttribute('aria-expanded', String(isOpen));
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closePanel);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });

  markAllButton.addEventListener('click', async () => {
    if (!currentUid) return;
    markAllButton.disabled = true;
    try {
      await markAllNotificationsAsRead(currentUid);
    } catch (error) {
      console.error('Could not mark notifications as read:', error);
      markAllButton.disabled = false;
    }
  });

  onAuthStateChanged(auth, (user) => {
    unsubscribe?.();
    unsubscribe = null;
    currentUid = user?.uid || null;
    center.classList.toggle('is-active', Boolean(user));
    closePanel();

    if (!user) {
      badge.textContent = '';
      badge.classList.remove('is-visible');
      markAllButton.disabled = true;
      renderNotifications(list, []);
      return;
    }

    unsubscribe = listenToUnreadNotifications(user.uid, (notifications, unreadCount, error) => {
      if (error) console.error('Notification listener failed:', error);
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.classList.toggle('is-visible', unreadCount > 0);
      markAllButton.disabled = unreadCount === 0;
      renderNotifications(list, notifications);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountNotificationCenter, { once: true });
} else {
  mountNotificationCenter();
}
