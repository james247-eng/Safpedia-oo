// js/marketplace-payment-success.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getFirestore, collectionGroup, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

// NOTE: mirrors course.js's inline Firebase init since this project's shared
// firebase-config.js exports weren't available to confirm against.
  const firebaseConfig = {
    apiKey: "AIzaSyDxAQPzgKw6XjTg2f64vsvBcOo1u3eQGBU",
    authDomain: "safpedia-concept.firebaseapp.com",
    projectId: "safpedia-concept",
    storageBucket: "safpedia-concept.firebasestorage.app",
    messagingSenderId: "1052529581680",
    appId: "1:1052529581680:web:a1fceadc99da90dc17deb5",
    measurementId: "G-2MFWN6K7ZX"
  };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const MAX_POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;
const AUTO_REDIRECT_MS = 5000;
const ORDERS_PAGE = 'users/marketplace-orders.html';

function setStatus(iconName, title, message) {
    document.getElementById('status-icon').innerHTML = `<ion-icon name="${iconName}"></ion-icon>`;
    document.getElementById('status-title').textContent = title;
    document.getElementById('status-message').textContent = message;
}

function showOrderSummary(sale) {
    const el = document.getElementById('order-summary');
    const fulfillmentNote = sale.productType === 'digital'
        ? 'Your download is ready — grab it from My Orders.'
        : "We've notified the seller — track shipping status from My Orders.";

    el.innerHTML = `
        <p><strong>${sale.productTitle}</strong></p>
        <p>Quantity: ${sale.quantity} — ₦${(sale.amount || 0).toLocaleString()}</p>
        <p>${fulfillmentNote}</p>
    `;
    el.classList.remove('hidden');
}

function startAutoRedirectCountdown() {
    let secondsLeft = Math.ceil(AUTO_REDIRECT_MS / 1000);
    const noteEl = document.getElementById('redirect-note');

    const tick = () => {
        noteEl.textContent = `Redirecting to My Orders in ${secondsLeft}...`;
        secondsLeft -= 1;
        if (secondsLeft < 0) {
            window.location.href = ORDERS_PAGE;
            return;
        }
        setTimeout(tick, 1000);
    };
    tick();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====================================================================
// POLL FOR THE WEBHOOK-CREATED SALE RECORD
// ====================================================================
// The webhook usually processes within a second or two of the redirect
// landing here, but isn't guaranteed to have finished yet — this polls
// briefly rather than assuming success or failure instantly. Matches on
// the 'reference' field alone (no productId available in the callback
// URL), which Paystack guarantees is unique per transaction.
async function pollForSale(reference) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        try {
            const q = query(collectionGroup(db, 'sales'), where('reference', '==', reference));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                return snapshot.docs[0].data();
            }
        } catch (err) {
            console.warn('Sale lookup attempt failed:', err.message);
        }
        await sleep(POLL_INTERVAL_MS);
    }
    return null;
}

async function init() {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');

    if (!reference) {
        setStatus('alert-circle-outline', 'No payment reference found', 'If you just completed a purchase, check My Orders directly.');
        startAutoRedirectCountdown();
        return;
    }

    // Purchases require login, so a signed-out visitor here is unusual —
    // still handle it gracefully rather than querying with no auth context.
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            setStatus('checkmark-circle-outline', 'Payment received!', 'Sign in to view your order details.');
            startAutoRedirectCountdown();
            return;
        }

        const sale = await pollForSale(reference);

        if (sale) {
            setStatus('checkmark-circle-outline', 'Payment successful!', 'Your order has been recorded.');
            showOrderSummary(sale);
        } else {
            setStatus('checkmark-circle-outline', 'Payment received!', "We're still confirming your order — it'll appear in My Orders shortly.");
        }

        startAutoRedirectCountdown();
    });
}

init();