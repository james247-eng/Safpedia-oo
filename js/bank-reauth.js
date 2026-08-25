// ====================================================================
// BANK ACCOUNT RE-AUTHENTICATION GATE
// Shared by seller-dashboard.js and affiliate-dashboard.js.
//
// Requires the member to re-confirm their identity (password, or a
// fresh Google popup for social-login accounts) immediately before a
// bank-account add/change request is sent — so a hijacked session or
// stale tab can't silently redirect future payouts.
//
// IMPORTANT: this is a UX convenience, not the security boundary.
// The real boundary must live server-side: /api/affiliates/add-bank-account
// and /api/vendors/add-bank-account must independently check the decoded
// ID token's `auth_time` claim and reject stale tokens with the same
// REAUTH_FRESHNESS_MS window used here. Without that check, this modal
// can simply be skipped by calling the API directly.
// ====================================================================

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const REAUTH_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes — must match the backend's auth_time check

let lastReauthAt = 0;
let modalEl = null;

// ====================================================================
// MODAL (built dynamically — no dependency on page-specific HTML/CSS)
// ====================================================================
function ensureModal() {
  if (modalEl) return modalEl;

  const style = document.createElement('style');
  style.textContent = `
    .safp-reauth-overlay {
      position: fixed; inset: 0; background: rgba(11,18,32,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 20px;
    }
    .safp-reauth-card {
      background: #FFFFFF; border-radius: 16px; padding: 28px; max-width: 380px; width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .safp-reauth-card h3 { margin: 0 0 8px; font-size: 18px; color: #0B1220; }
    .safp-reauth-card p { margin: 0 0 16px; font-size: 14px; color: #4A5568; line-height: 1.5; }
    .safp-reauth-card input {
      width: 100%; padding: 11px 14px; border: 1px solid #E3E7F0; border-radius: 8px;
      margin-bottom: 12px; font-size: 14px; box-sizing: border-box;
    }
    .safp-reauth-card input:focus { outline: 2px solid #2563EB; outline-offset: 1px; }
    .safp-reauth-error {
      color: #D82F1E; font-size: 13px; margin: -4px 0 12px; display: none;
    }
    .safp-reauth-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .safp-reauth-actions button {
      padding: 10px 20px; border-radius: 999px; font-weight: 600; font-size: 14px;
      cursor: pointer; border: none; font-family: inherit;
    }
    .safp-reauth-cancel { background: #F7F8FB; color: #0B1220; }
    .safp-reauth-cancel:hover { background: #E3E7F0; }
    .safp-reauth-confirm { background: #2563EB; color: #FFFFFF; }
    .safp-reauth-confirm:hover { background: #1d4fc4; }
    .safp-reauth-confirm:disabled { opacity: 0.6; cursor: not-allowed; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'safp-reauth-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="safp-reauth-card">
      <h3>Confirm it's you</h3>
      <p id="safp-reauth-copy">For your security, re-enter your password before changing your payout bank account.</p>
      <input type="password" id="safp-reauth-password" placeholder="Current password" autocomplete="current-password" />
      <div class="safp-reauth-error" id="safp-reauth-error"></div>
      <div class="safp-reauth-actions">
        <button type="button" class="safp-reauth-cancel" id="safp-reauth-cancel">Cancel</button>
        <button type="button" class="safp-reauth-confirm" id="safp-reauth-confirm">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  modalEl = overlay;
  return overlay;
}

function openModal(user, { onSuccess, onCancel }) {
  const overlay = ensureModal();
  const copyEl = overlay.querySelector('#safp-reauth-copy');
  const passwordInput = overlay.querySelector('#safp-reauth-password');
  const errorEl = overlay.querySelector('#safp-reauth-error');
  const confirmBtn = overlay.querySelector('#safp-reauth-confirm');
  const cancelBtn = overlay.querySelector('#safp-reauth-cancel');

  const usesPassword = user.providerData.some((p) => p.providerId === 'password');

  errorEl.style.display = 'none';
  errorEl.textContent = '';
  passwordInput.value = '';
  passwordInput.style.display = usesPassword ? 'block' : 'none';
  copyEl.textContent = usesPassword
    ? 'For your security, re-enter your password before changing your payout bank account.'
    : 'For your security, confirm your Google account before changing your payout bank account.';
  confirmBtn.textContent = usesPassword ? 'Confirm' : 'Confirm with Google';

  overlay.style.display = 'flex';
  if (usesPassword) setTimeout(() => passwordInput.focus(), 50);

  function cleanup() {
    overlay.style.display = 'none';
    confirmBtn.removeEventListener('click', onConfirm);
    cancelBtn.removeEventListener('click', onCancelClick);
    passwordInput.removeEventListener('keydown', onKeydown);
  }

  async function onConfirm() {
    confirmBtn.disabled = true;
    errorEl.style.display = 'none';
    try {
      if (usesPassword) {
        const password = passwordInput.value;
        if (!password) throw new Error('Enter your password');
        const credential = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, credential);
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }
      cleanup();
      onSuccess();
    } catch (err) {
      console.error('Reauth error:', err);
      errorEl.textContent =
        err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
          ? 'Incorrect password. Try again.'
          : 'Could not verify your identity. Please try again.';
      errorEl.style.display = 'block';
    } finally {
      confirmBtn.disabled = false;
    }
  }

  function onCancelClick() {
    cleanup();
    onCancel();
  }

  function onKeydown(e) {
    if (e.key === 'Enter') onConfirm();
  }

  confirmBtn.addEventListener('click', onConfirm);
  cancelBtn.addEventListener('click', onCancelClick);
  passwordInput.addEventListener('keydown', onKeydown);
}

// ====================================================================
// PUBLIC API
// ====================================================================
// Resolves true if the user is already re-authenticated within the
// freshness window, or successfully re-authenticates now. Resolves
// false if they cancel.
export async function requireFreshAuth(user) {
  if (Date.now() - lastReauthAt < REAUTH_FRESHNESS_MS) return true;

  return new Promise((resolve) => {
    openModal(user, {
      onSuccess: () => {
        lastReauthAt = Date.now();
        resolve(true);
      },
      onCancel: () => resolve(false)
    });
  });
}