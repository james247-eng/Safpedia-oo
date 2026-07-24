
// ====================================================================
// CHECKOUT - Handles Course Purchases (FIXED)
// ====================================================================
import { auth } from '../firebase-config.js'; // ⭐ Use existing auth
import { showToast, showLoading } from './toast-notification.js';

// ====================================================================
// ⭐ AFFILIATE REFERRAL CAPTURE
// Runs on every page load. If a ?ref=CODE param is present, store it with
// a 30-day expiry (last-click attribution — a new ?ref visit overwrites an
// older one). startPurchase() reads this back when checkout begins.
// ====================================================================
const REFERRAL_STORAGE_KEY = 'affiliateReferral';
const REFERRAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

(function captureReferralCode() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({
      code: ref,
      timestamp: Date.now()
    }));
    console.log('📌 Affiliate referral captured:', ref);
  }
})();

function getActiveReferralCode() {
  const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
  if (!raw) return null;

  try {
    const { code, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > REFERRAL_MAX_AGE_MS) {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    return code || null;
  } catch {
    return null;
  }
}

// ====================================================================
// START PURCHASE FUNCTION
// ====================================================================
window.startPurchase = async function (courseId) {
  console.log('💳 Starting purchase for course:', courseId);
  
  const dismissLoading = showLoading('Preparing checkout...');
  
  try {
    // Check if user is logged in
    const user = auth.currentUser;
    
    if (!user) {
      dismissLoading();
      showToast('Please login to purchase courses', 'warning');
      
      // ⭐ Save to localStorage instead of URL
      localStorage.setItem('pendingEnrollment', JSON.stringify({
        courseId: courseId,
        timestamp: Date.now()
      }));
      
      setTimeout(() => {
        window.location.href = '/sign-in.html';
      }, 1500);
      return;
    }

    // Get user's ID token
    const idToken = await user.getIdToken();

    const referralCode = getActiveReferralCode();
    console.log('🔑 Got ID token, calling Vercel function...', referralCode ? `(ref: ${referralCode})` : '');

    // ⭐ Call Vercel function (was Netlify)
    const res = await fetch('/api/paystack/create-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ courseId, referralCode })
    });

    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error || `Server error: ${res.status}`);
    }

    const json = await res.json();
    
    dismissLoading();
    showToast('Redirecting to payment...', 'success');
    
    // Redirect to Paystack
    setTimeout(() => {
      window.location.href = json.authorization_url;
    }, 1000);

  } catch (err) {
    dismissLoading();
    console.error('❌ Purchase error:', err);
    showToast('Error starting purchase: ' + err.message, 'error');
  }
};

console.log('✅ Checkout.js loaded');