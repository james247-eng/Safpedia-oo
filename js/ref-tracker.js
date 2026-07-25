// ====================================================================
// REFERRAL TRACKER MODULE
// Captures ?ref= parameters on any page load and preserves them in localStorage.
// Implements 30-day expiration and last-click attribution.
// ====================================================================

(function initReferralTracker() {
  const REFERRAL_STORAGE_KEY = 'affiliateReferral';
  const REFERRAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // 1. Capture referral code from URL if present
  try {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');

    if (refCode && refCode.trim() !== '') {
      const payload = {
        code: refCode.trim(),
        timestamp: Date.now()
      };
      localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(payload));
      console.log('📌 Referral token captured and saved:', refCode.trim());
    }
  } catch (err) {
    console.error('Error saving referral token:', err);
  }

  // 2. Expose global helper function to retrieve active referral code anywhere
  window.getActiveReferralCode = function () {
    const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;

    try {
      const { code, timestamp } = JSON.parse(raw);
      
      // Check if token has expired
      if (Date.now() - timestamp > REFERRAL_MAX_AGE_MS) {
        localStorage.removeItem(REFERRAL_STORAGE_KEY);
        console.log('⚠️ Referral token expired and removed.');
        return null;
      }
      return code || null;
    } catch (err) {
      console.error('Error reading referral token:', err);
      return null;
    }
  };
})();