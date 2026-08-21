import { auth, db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const MAX_POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;
const AUTO_REDIRECT_MS = 5000;
const SELLER_PAGE = 'users/sellers-page.html#subscription-pane';

function setStatus(iconName, title, message) {
    document.getElementById('status-icon').innerHTML = `<ion-icon name="${iconName}"></ion-icon>`;
    document.getElementById('status-title').textContent = title;
    document.getElementById('status-message').textContent = message;
}

function dateValue(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    return new Date(value);
}

function showSubscriptionSummary(payment, vendor) {
    const tier = payment.tier || 'your selected tier';
    const expiry = dateValue(vendor?.subscriptionExpiresAt);
    document.getElementById('order-summary').innerHTML = `<p><strong>${tier} activated</strong></p><p>Billing cycle: ${payment.billingCycle || 'monthly'} | Amount: ₦${Number(payment.amount || 0).toLocaleString()}</p>${expiry && !Number.isNaN(expiry.getTime()) ? `<p>New expiry date: ${expiry.toLocaleDateString()}</p>` : ''}`;
    document.getElementById('order-summary').classList.remove('hidden');
}

function startAutoRedirectCountdown() {
    let secondsLeft = Math.ceil(AUTO_REDIRECT_MS / 1000);
    const noteEl = document.getElementById('redirect-note');
    const tick = () => {
        noteEl.textContent = `Redirecting to your Subscription page in ${secondsLeft}...`;
        secondsLeft -= 1;
        if (secondsLeft < 0) { window.location.href = SELLER_PAGE; return; }
        setTimeout(tick, 1000);
    };
    tick();
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function pollForPayment(uid, reference) {
    const paymentRef = doc(db, 'vendors', uid, 'subscriptionPayments', reference);
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        try {
            const snapshot = await getDoc(paymentRef);
            if (snapshot.exists() && snapshot.data().status === 'success') return snapshot.data();
        } catch (err) { console.warn('Subscription lookup attempt failed:', err.message); }
        await sleep(POLL_INTERVAL_MS);
    }
    return null;
}

async function init() {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference) {
        setStatus('alert-circle-outline', 'No payment reference found', 'If you just completed a subscription payment, check your seller dashboard shortly.');
        startAutoRedirectCountdown();
        return;
    }
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            setStatus('alert-circle-outline', 'Sign in required', 'Sign in as the vendor who made this payment to confirm your subscription.');
            return;
        }
        const payment = await pollForPayment(user.uid, reference);
        if (!payment) {
            setStatus('checkmark-circle-outline', 'Payment received!', "We're still confirming your subscription — it'll appear in your seller dashboard shortly.");
            startAutoRedirectCountdown();
            return;
        }
        const vendorSnap = await getDoc(doc(db, 'vendors', user.uid));
        setStatus('checkmark-circle-outline', 'Subscription activated!', 'Your payment has been recorded and your listing access is updating now.');
        showSubscriptionSummary(payment, vendorSnap.exists() ? vendorSnap.data() : null);
        startAutoRedirectCountdown();
    });
}

init();
