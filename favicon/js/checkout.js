/*checkout.js - Handles course purchases and Firebase authentication */
/*
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBBA8KVzbxoomwAm83erzk_JPxq37H27j0",
  authDomain: "key-board-wizards.firebaseapp.com",
  projectId: "key-board-wizards",
  storageBucket: "key-board-wizards.firebasestorage.app",
  messagingSenderId: "570989716323",
  appId: "1:570989716323:web:adb3d3ae753a91458f2956",
  measurementId: "G-E13DTS3XDB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// startPurchase now accepts a single courseId identifier.
window.startPurchase = async function (courseId) {
  try {
    const user = auth.currentUser;
    if (!user) {
      // redirect to login with next param (the courseId)
      const loginUrl = '/login.html?next=' + encodeURIComponent(courseId);
      window.location.href = loginUrl;
      return;
    }

    const idToken = await user.getIdToken();

    const res = await fetch('/.netlify/functions/create-paystack-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ courseId })
    });

    const json = await res.json();
    if (!res.ok) {
      alert('Could not start payment: ' + (json.error || JSON.stringify(json)));
      return;
    }

    // Redirect user to Paystack authorization_url
    window.location.href = json.authorization_url;
  } catch (err) {
    console.error(err);
    alert('Error starting purchase: ' + err.message);
  }
}

// Auto-start purchase if ?autoBuy=<courseId> present
window.addEventListener('load', async () => {
  const params = new URLSearchParams(window.location.search);
  const autoBuy = params.get('autoBuy');
  if (autoBuy) {
    // small delay to allow auth state to hydrate
    setTimeout(() => startPurchase(autoBuy), 600);
  }
});
*/

// ====================================================================
// CHECKOUT - Handles Course Purchases with Loading & Toasts
// ====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { showToast, showLoading } from './toast-notification.js';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBBA8KVzbxoomwAm83erzk_JPxq37H27j0",
  authDomain: "key-board-wizards.firebaseapp.com",
  projectId: "key-board-wizards",
  storageBucket: "key-board-wizards.firebasestorage.app",
  messagingSenderId: "570989716323",
  appId: "1:570989716323:web:adb3d3ae753a91458f2956",
  measurementId: "G-E13DTS3XDB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ====================================================================
// START PURCHASE FUNCTION
// ====================================================================
window.startPurchase = async function (courseId) {
  console.log('Starting purchase for course:', courseId);

  // Show loading
  const dismissLoading = showLoading('Preparing checkout...');

  try {
    // Check if user is logged in
    const user = auth.currentUser;
    
    if (!user) {
      dismissLoading();
      showToast('Please login to purchase courses', 'warning');
      
      // Redirect to login with course ID
      setTimeout(() => {
        const loginUrl = '/sign-in.html?next=' + encodeURIComponent(courseId);
        window.location.href = loginUrl;
      }, 1500);
      return;
    }

    // Get user's ID token
    const idToken = await user.getIdToken();

    // Call Netlify function to create Paystack transaction
    const res = await fetch('/.netlify/functions/create-paystack-transaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ courseId })
    });

    const json = await res.json();

    // Check response
    if (!res.ok) {
      dismissLoading();
      const errorMsg = json.error || 'Failed to initialize payment';
      showToast(errorMsg, 'error');
      console.error('Payment initialization failed:', json);
      return;
    }

    // Success - show message and redirect
    dismissLoading();
    showToast('Redirecting to payment...', 'success');

    // Redirect to Paystack after short delay
    setTimeout(() => {
      window.location.href = json.authorization_url;
    }, 1000);

  } catch (err) {
    dismissLoading();
    console.error('Purchase error:', err);
    showToast('Error starting purchase: ' + err.message, 'error');
  }
};

// ====================================================================
// AUTO-START PURCHASE IF ?autoBuy=<courseId> IN URL
// ====================================================================
window.addEventListener('load', async () => {
  const params = new URLSearchParams(window.location.search);
  const autoBuy = params.get('autoBuy');
  
  if (autoBuy) {
    // Small delay to allow auth state to hydrate
    showToast('Processing your purchase request...', 'info');
    setTimeout(() => {
      window.startPurchase(autoBuy);
    }, 800);
  }
});

