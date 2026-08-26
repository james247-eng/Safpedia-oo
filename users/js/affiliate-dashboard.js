// ====================================================================
// AFFILIATE DASHBOARD - Student-facing affiliate program page
// Tech Wizards Academy
// Reads affiliate status/stats directly from Firestore (fast, no cold-start wait).
// Writes (apply, add bank account, request payout) go through the serverless
// functions, since those need the Paystack secret key server-side.
// ====================================================================

import { auth, db } from '../../firebase-config.js';
import '../../js/notification-center.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { doc, getDoc, collection, getDocs, orderBy, query } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { showToast, showLoading } from '../../js/toast-notification.js';
import { requireFreshAuth } from '../../js/bank-reauth.js';

let currentUser = null;

// ====================================================================
// HELPER: mask account number (show only last 4 digits)
// ====================================================================
function maskAccountNumber(accountNumber) {
  if (!accountNumber || typeof accountNumber !== 'string') return '••••';
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length <= 4) return '••••' + digits;
  return '••••••' + digits.slice(-4);
}

// ====================================================================
// AUTH + INITIAL LOAD
// ====================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '../../sign-in.html';
    return;
  }
  currentUser = user;

  const emailEl = document.getElementById('user-display-email');
  const avatarEl = document.getElementById('admin-avatar-slot');
  if (emailEl) emailEl.textContent = user.email || 'Affiliate Account';
  if (avatarEl) avatarEl.textContent = (user.email || 'U').charAt(0).toUpperCase();

  await loadAffiliateStatus();
});

document.getElementById('user-logout-trigger')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await signOut(auth);
    window.location.href = '../../sign-in.html';
  } catch (error) {
    console.error('Signout error:', error);
  }
});

async function loadAffiliateStatus() {
  try {
    const affDoc = await getDoc(doc(db, 'affiliates', currentUser.uid));

    if (!affDoc.exists()) {
      renderNoApplication();
      return;
    }

    const data = affDoc.data();

    if (data.status === 'pending') {
      renderPending();
    } else if (data.status === 'rejected') {
      renderRejected();
    } else if (data.status === 'approved') {
      renderApproved(data);
      await loadCommissionHistory();
      await loadPayoutHistory();
    }

  } catch (error) {
    console.error('Error loading affiliate status:', error);
    showToast('Error loading affiliate status: ' + error.message, 'error');
  }
}

// ====================================================================
// RENDER STATES
// ====================================================================
function renderNoApplication() {
  setView('apply');
}

function renderPending() {
  setView('pending');
}

function renderRejected() {
  setView('rejected');
}

function renderApproved(data) {
  setView('approved');

  document.getElementById('referral-code').textContent = data.code || '—';
  document.getElementById('referral-link').textContent =
    `${window.location.origin}/all-courses.html?ref=${data.code}`;

  document.getElementById('stat-total-earned').textContent = `₦${(data.totalEarned || 0).toLocaleString()}`;
  document.getElementById('stat-pending-payout').textContent = `₦${(data.pendingPayout || 0).toLocaleString()}`;
  document.getElementById('stat-awaiting-payout').textContent = `₦${(data.awaitingPayout || 0).toLocaleString()}`;
  document.getElementById('stat-total-paid').textContent = `₦${(data.totalPaidOut || 0).toLocaleString()}`;
  
  const salesStatEl = document.getElementById('stat-total-sales');
  if (salesStatEl) {
    salesStatEl.textContent = data.totalSales || 0;
  }

  const bankSection = document.getElementById('bank-account-section');
  const payoutSection = document.getElementById('payout-section');

  if (data.bankAccount && data.bankAccount.recipientCode) {
    const masked = maskAccountNumber(data.bankAccount.accountNumber);
    bankSection.innerHTML = `
      <p style="margin-bottom: 8px;"><strong>Bank Name/Owner:</strong> ${data.bankAccount.accountName}</p>
      <p style="margin-bottom: 12px;"><strong>Account Number:</strong> ${masked}</p>
      <button class="btn btn-secondary" id="change-bank-btn">Change Bank Account</button>
    `;
    document.getElementById('change-bank-btn').addEventListener('click', showBankForm);
    payoutSection.style.display = 'block';
  } else {
    showBankForm();
    payoutSection.style.display = 'none';
  }
}

function setView(view) {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.style.display = el.dataset.view === view ? 'block' : 'none';
  });
}

// ====================================================================
// APPLY
// ====================================================================
document.getElementById('apply-btn')?.addEventListener('click', async () => {
  const reason = document.getElementById('apply-reason')?.value.trim() || '';
  const socialLink = document.getElementById('apply-social-link')?.value.trim() || '';

  const dismiss = showLoading('Submitting application...');
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/affiliates/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ reason, socialLink })
    });
    const json = await res.json();
    dismiss();

    if (!res.ok) {
      showToast(json.error || 'Could not submit application', 'error');
      return;
    }
    showToast('Application submitted! Awaiting admin approval.', 'success');
    await loadAffiliateStatus();
  } catch (error) {
    dismiss();
    showToast('Error submitting application: ' + error.message, 'error');
  }
});

// ====================================================================
// BANK ACCOUNT FORM
// ====================================================================
async function showBankForm() {
  document.getElementById('bank-account-section').innerHTML = `
    <label>Bank</label>
    <select id="bank-select"><option>Loading banks...</option></select>
    <label>Account Number</label>
    <input type="text" id="account-number-input" maxlength="10" placeholder="0123456789" />
    <button class="btn btn-primary" id="save-bank-btn">Save Bank Account</button>
  `;

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/affiliates/list-banks', {
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const json = await res.json();
    const select = document.getElementById('bank-select');

    if (res.ok && json.banks) {
      select.innerHTML = json.banks
        .map(b => `<option value="${b.code}">${b.name}</option>`)
        .join('');
    } else {
      select.innerHTML = '<option value="">Could not load banks</option>';
    }
  } catch (error) {
    console.error('Error loading banks:', error);
  }

  document.getElementById('save-bank-btn').addEventListener('click', saveBankAccount);
}

async function saveBankAccount() {
  const bankCode = document.getElementById('bank-select').value;
  const accountNumber = document.getElementById('account-number-input').value.trim();

  if (!bankCode || accountNumber.length !== 10) {
    showToast('Enter a valid 10-digit account number and select your bank', 'warning');
    return;
  }

  // SECURITY: require fresh re-authentication before touching payout bank
  // details — a hijacked session shouldn't be able to silently redirect
  // future commission payouts. Mirrored server-side in
  // /api/affiliates/add-bank-account via an auth_time freshness check.
  const confirmed = await requireFreshAuth(currentUser);
  if (!confirmed) {
    showToast('Bank account not changed — identity verification was cancelled.', 'warning');
    return;
  }

  const dismiss = showLoading('Verifying account...');
  try {
    const idToken = await currentUser.getIdToken(true); // force-refresh so auth_time reflects the reauth just completed
    const res = await fetch('/api/affiliates/add-bank-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ bankCode, accountNumber })
    });
    const json = await res.json();
    dismiss();

    if (!res.ok) {
      showToast(json.error || 'Could not verify bank account', 'error');
      return;
    }
    showToast(`Bank account verified: ${json.bankAccount.accountName}`, 'success');
    await loadAffiliateStatus();
  } catch (error) {
    dismiss();
    showToast('Error saving bank account: ' + error.message, 'error');
  }
}

// ====================================================================
// REQUEST PAYOUT
// ====================================================================
document.getElementById('request-payout-btn')?.addEventListener('click', async () => {
  const confirmed = confirm('Request payout of your full available balance?');
  if (!confirmed) return;

  const dismiss = showLoading('Sending payout request...');
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/affiliates/request-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({})
    });
    const json = await res.json();
    dismiss();

    if (!res.ok) {
      showToast(json.error || 'Payout request failed', 'error');
      return;
    }
    showToast(`Payout of ₦${json.amount.toLocaleString()} initiated!`, 'success');
    await loadAffiliateStatus();
  } catch (error) {
    dismiss();
    showToast('Error requesting payout: ' + error.message, 'error');
  }
});

// ====================================================================
// HISTORY (read-only Firestore reads)
// ====================================================================
async function loadCommissionHistory() {
  const container = document.getElementById('commissions-list');
  if (!container) return;

  try {
    const q = query(collection(db, 'affiliates', currentUser.uid, 'commissions'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="empty-state-block">
          <div class="empty-icon"><ion-icon name="link-outline"></ion-icon></div>
          <h3>No sales yet</h3>
          <p>Share your referral link above — commission from every sale it brings in will show up here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `
        <div class="commission-row">
          <span>${c.courseTitle}</span>
          <span>₦${c.saleAmount.toLocaleString()} sale</span>
          <span style="color:#059669; font-weight:600;">+₦${c.commissionAmount.toLocaleString()}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading commission history:', error);
  }
}

async function loadPayoutHistory() {
  const container = document.getElementById('payouts-list');
  if (!container) return;

  try {
    const q = query(collection(db, 'affiliates', currentUser.uid, 'payoutRequests'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="empty-state-block">
          <div class="empty-icon"><ion-icon name="time-outline"></ion-icon></div>
          <h3>No payout requests yet</h3>
          <p>Once you have an available balance, request a payout and it'll be tracked here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = snap.docs.map(d => {
      const p = d.data();
      return `
        <div class="commission-row">
          <span>${p.createdAt?.toDate().toLocaleDateString() || ''}</span>
          <span>₦${p.amount.toLocaleString()}</span>
          <span class="status-badge status-${p.status}">${p.status}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading payout history:', error);
  }
}