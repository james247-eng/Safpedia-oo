# SafPedia Notification & Serverless Audit Report

> Read-only structural audit of the repository. No files were modified.

---

## 1. NAVIGATION & LAYOUT AUDIT

### Dashboards inspected

- `users/dashboard.html`
- `safpedia concept admin dashboard/dashboard.html`

### Dashboard layout wrappers

- `users/dashboard.html`
  - Root structure:
    - `.dashboard-layout`
    - `aside.sidebar-panel`
    - `main.main-workspace-view`
  - No `<nav id="navbar">`
  - No `.nav-right`
  - No `#profile-icon` in a top navbar wrapper

- `safpedia concept admin dashboard/dashboard.html`
  - Root structure:
    - `.admin-container`
    - `aside.sidebar#sidebar`
    - `main.main-content`
    - `header.header`
      - `.header-left-wrapper`
      - `.user-info`
  - No `<nav id="navbar">`
  - No `.nav-right`
  - No `#profile-icon` inside a navbar wrapper

### Public page pattern

Public pages use:

- `<nav class="navbar" id="navbar">`
- `<div class="nav-right">`
- `<div id="profile-icon">...`

Examples:
- `index.html`
- `all-courses.html`
- `category.html`
- `marketplace.html`
- many `pages/*.html`

These public pages have the exact DOM structure that `js/notification-center.js` expects.

### Notification center mount logic

In `js/notification-center.js`:

- `mountNotificationCenter()` does:
  - `const navRight = document.querySelector('#navbar .nav-right');`
- It returns early if:
  - `!navRight`
  - or `.notification-center` already exists inside that wrapper

Then it:
- creates `.notification-center`
- inserts it before `#profile-icon` or as first child of `.nav-right`

### Why the bell fails on dashboard layouts

Two independent reasons:

1. `notification-center.js` only targets `#navbar .nav-right`
   - Dashboard HTML does not contain `#navbar` or `.nav-right`
   - So `querySelector('#navbar .nav-right')` returns `null`

2. The dashboard pages do not load the same shared page loader
   - `js/main.js` imports `/js/notification-center.js`
   - `users/dashboard.html` loads `js/dashboard.js` and `js/dashboard-nav.js`
   - admin dashboard page does not appear to include `js/main.js`
   - Thus the notification center script is not automatically initialized on those pages

### Result

- On public pages, the bell renders because the required header container exists.
- On dashboard pages, the bell fails because:
  - the required navbar wrapper is absent
  - the script is not guaranteed to run there
- This is a structural mismatch, not a runtime error in the notification center itself.

---

## 2. IN-APP NOTIFICATION SYSTEM AUDIT

### Files inspected

- `js/notification-center.js`
- `js/notifications.js`

### Exported helper functions

From `js/notifications.js`:

- `sendInAppNotification(recipientUid, { title, message, link = '', type = 'info' })`
- `listenToUnreadNotifications(userUid, callback)`
- `markAllNotificationsAsRead(userUid)`

### Notification collection path

`js/notifications.js` uses:

- `collection(db, 'users', userUid, 'notifications')`

So the Firestore path is:

- `users/{uid}/notifications`

Each notification document contains:
- `id`
- `title`
- `message`
- `link`
- `read: false`
- `type`
- `createdAt: serverTimestamp()`

### Notification center behavior

In `js/notification-center.js`:

- It subscribes to unread notifications with:
  - `listenToUnreadNotifications(user.uid, callback)`
- That query filters:
  - `where('read', '==', false)`
- It updates:
  - badge count
  - notification list
  - `Mark all as read` button state

### Important gap

- `sendInAppNotification()` is defined, but no code path in this repo calls it outside its own module.
- I did not find any other file importing or using `sendInAppNotification`.
- Therefore the Firestore notification stream appears to be only consumable, not currently produced by app logic in this repo.

---

## 3. SERVERLESS FUNCTIONS & EVENT TRIGGERS AUDIT

### API directory structure

- `api/admin/marketplace/[action].js`
- `api/affiliates/[action].js`
- `api/cloudinary/signature.js`
- `api/marketplace/[action].js`
- `api/marketplace/webhook.js`
- `api/paystack/create-transaction.js`
- `api/paystack/webhook.js`
- `api/process-payout.js`
- `api/vendors/[action].js`
- `api/zoom/create-meeting.js`

### Eventful serverless functions

#### `api/paystack/webhook.js`
Handles:
- `charge.success`
- `transfer.success`
- `transfer.failed`
- `transfer.reversed`

Behavior:
- records course purchases
- enrolls users
- credits affiliate commissions
- resolves affiliate payout status

Notification logic:
- None detected
- No `sendInAppNotification` or notification document writes

#### `api/marketplace/webhook.js`
Handles:
- `charge.success`
- `transfer.success`
- `transfer.failed`
- `transfer.reversed`

Behavior:
- processes marketplace sales
- decrements physical stock
- credits vendor balance
- records sale history
- settles marketplace payout requests

Notification logic:
- None detected
- No in-app notification writes

#### `api/vendors/[action].js`
Handles:
- `request-payout`
- `update-order-status`
- `add-bank-account`
- `get-profile`
- `get-orders`

Behavior:
- vendor payout reservation and Paystack transfer
- physical order shipment status updates
- vendor profile/order retrieval

Notification logic:
- None detected

#### `api/affiliates/[action].js`
Handles:
- affiliate onboarding / approval
- bank account registration
- `request-payout`

Behavior:
- payout request creation
- Paystack transfer initiation
- affiliate balance updates

Notification logic:
- None detected

#### `api/process-payout.js`
Handles:
- manual payout execution via Paystack transfer

Behavior:
- processes `payouts/{payoutId}`
- updates payout status to processing

Notification logic:
- None detected

#### `api/marketplace/[action].js`
Handles:
- marketplace CRUD
- `create-transaction`
- upload signature
- download links

Behavior:
- product create/update/delete
- transaction init
- signed upload/download workflows

Notification logic:
- None detected

#### `api/paystack/create-transaction.js`
Handles:
- browser-initiated payment creation
- returns Paystack authorization URL

Behavior:
- authenticates user
- validates course
- initializes Paystack checkout

Notification logic:
- None detected

#### `api/admin/marketplace/[action].js`
Handles admin reports and suspend actions.

Notification logic:
- None detected

### Browser-trigger points

- `api/paystack/create-transaction.js`
  - trigger: checkout flow for course purchases
- `api/vendors/[action].js` request-payout
  - trigger: vendor payout request
- `api/affiliates/[action].js` request-payout
  - trigger: affiliate payout request
- `api/marketplace/[action].js` create-transaction
  - trigger: marketplace purchase flow

### Notification coverage summary

- No backend/serverless route currently writes into `users/{uid}/notifications`
- No backend route currently calls `sendInAppNotification`
- Notification generation appears absent in serverless code
- The backend does handle many events, but none trigger in-app notification creation in this audit

---

## Key Findings

1. `js/notification-center.js` is hard-coded to public navbar structure:
   - `#navbar .nav-right`
   - This is incompatible with dashboard layouts

2. Dashboard pages do not load the shared notification loader:
   - `users/dashboard.html` uses `js/dashboard.js` and `js/dashboard-nav.js`
   - `admin dashboard.html` does not use `js/main.js`

3. In-app notification system is partially implemented:
   - exports exist correctly
   - Firestore path is clearly `users/{uid}/notifications`
   - but no producer is attached in the current repo

4. Backend event handlers are rich, but notification integration is missing:
   - Paystack webhooks
   - marketplace webhooks
   - payout request flows
   - vendor order status updates
   - affiliate payout flows

5. The root cause for missing dashboard bell:
   - structural selector mismatch
   - missing script initialization on dashboards

---

## Recommendations

- Add dashboard-specific header mounting support in `js/notification-center.js`
  - support `.header .user-info`
  - support `.dashboard-layout` or other dashboard wrappers
- Ensure dashboard pages import the notification center loader
  - either via `js/main.js` or a dedicated dashboard script
- Add notification creation in backend event handlers
  - e.g. course purchase success
  - vendor payout success/failure
  - marketplace sale events
  - order shipment status update
- Or add a frontend producer path that calls `sendInAppNotification(...)` after relevant actions
