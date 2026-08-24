// js/vendor-store.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
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
const auth = getAuth(app);
let currentUser = null;
let activeVendorUid = null;

// ====================================================================
// AUTH STATUS
// ====================================================================
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const container = document.getElementById('auth-status-container');
    if (user) {
        container.innerHTML = `
            <a href="/users/dashboard.html" class="student-profile-avatar" title="View Profile">
                ${(user.email || 'U').charAt(0).toUpperCase()}
            </a>
        `;
        document.getElementById('student-portal-link').href = '/users/dashboard.html';
    }
});

// ====================================================================
// LOAD VENDOR'S PRODUCTS
// ====================================================================
async function loadVendorStore() {
    const grid = document.getElementById('products-grid');
    const params = new URLSearchParams(window.location.search);
    const vendorUid = params.get('vendor');
    activeVendorUid = vendorUid;

    if (!vendorUid) {
        document.getElementById('vendor-store-title').textContent = 'Store not found';
        grid.innerHTML = '<div class="error-state">No vendor specified.</div>';
        return;
    }

    try {
        const response = await fetch(`/api/marketplace/get-storefront?vendorUid=${encodeURIComponent(vendorUid)}`);
        const result = await response.json();
        if (response.status === 404) throw new Error('This storefront is unavailable.');
        if (!response.ok) throw new Error(result.error || 'Could not load this store');
        const products = result.products || [];

        renderBanner(products);
        renderProductGrid(products);

    } catch (error) {
        console.error('Vendor store retrieval failure:', error);
        document.getElementById('vendor-store-title').textContent = 'Storefront unavailable';
        grid.innerHTML = `<div class="error-state">${error.message || 'This storefront is unavailable.'}</div>`;
    }
}

function renderBanner(products) {
    const vendorName = products.length ? (products[0].vendorFirstName || 'Vendor') : 'Vendor';
    document.getElementById('vendor-store-title').textContent = `${vendorName}'s Store`;
    document.getElementById('vendor-avatar').textContent = vendorName.charAt(0).toUpperCase();
    document.getElementById('vendor-product-count').textContent =
        products.length === 1 ? '1 product' : `${products.length} products`;
    document.title = `${vendorName}'s Store | Safpedia`;
}

function renderProductGrid(items) {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state">This store has no products listed yet.</div>';
        return;
    }

    items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'product-card';

        const cover = item.images && item.images[0] ? item.images[0].url : 'images/hero.png';
        const typeBadge = item.type === 'physical'
            ? '<span class="badge-f video"><ion-icon name="cube-outline"></ion-icon> Physical</span>'
            : '<span class="badge-f pdf"><ion-icon name="download-outline"></ion-icon> Digital</span>';

        const stockNote = item.type === 'physical'
            ? (item.stock > 0 ? `${item.stock} in stock` : 'Out of stock')
            : 'Instant download';

        card.innerHTML = `
            <div class="card-banner">
                <img src="${cover}" alt="${item.title}">
                ${typeBadge}
            </div>
            <div class="card-details">
                <span class="category-meta">${(item.category || 'GENERAL').toUpperCase()}</span>
                <h3 class="product-title">${item.title}</h3>
                <p class="product-snippet">${stockNote}</p>
                <div class="card-footer-row">
                    <span class="product-cost">₦${item.price.toLocaleString()}</span>
                    <a href="/vendors-product-details.html?id=${item.id}" class="btn btn-secondary btn-sm">View Product</a>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

loadVendorStore();

const modal = document.getElementById('complaint-modal');
document.getElementById('lodge-complaint-btn').addEventListener('click', () => {
    if (!currentUser) { window.location.href = '/sign-in.html'; return; }
    modal.classList.remove('hidden');
});
document.getElementById('complaint-modal-close').addEventListener('click', () => modal.classList.add('hidden'));
document.getElementById('complaint-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('complaint-form-message'); const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true; message.textContent = '';
    try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/disputes/create-dispute', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ vendorUid: activeVendorUid, reason: document.getElementById('complaint-reason').value, buyerStatement: document.getElementById('complaint-statement').value }) });
        const text = await response.text(); let result; try { result = JSON.parse(text); } catch { throw new Error(text || 'Server returned an invalid response'); }
        if (!response.ok) throw new Error(result.error || 'Could not submit complaint');
        modal.classList.add('hidden'); event.currentTarget.reset(); alert('Your complaint was submitted.');
    } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
});
