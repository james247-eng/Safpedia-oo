// js/product-details.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
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

const PENDING_PURCHASE_KEY = 'pendingMarketplacePurchase';

let currentUser = null;
let currentProduct = null;
let currentProductId = null;

// ====================================================================
// AUTH STATE (page is public — login only required at purchase time)
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
        resumePendingPurchaseIfAny();
    }
});

// ====================================================================
// LOAD PRODUCT
// ====================================================================
async function loadProduct() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');
    currentProductId = productId;

    const loadingEl = document.getElementById('product-loading');
    const errorEl = document.getElementById('product-error');
    const contentEl = document.getElementById('product-content');

    if (!productId) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'No product specified.';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const snap = await getDoc(doc(db, 'vendorProducts', productId));

        if (!snap.exists()) {
            throw new Error('Product not found.');
        }

        const product = snap.data();

        if (!product.isActive || product.isDeleted) {
            throw new Error('This product is no longer available.');
        }

        currentProduct = product;
        renderProduct(product);

        loadingEl.classList.add('hidden');
        contentEl.classList.remove('hidden');

    } catch (err) {
        console.error('loadProduct error:', err);
        loadingEl.classList.add('hidden');
        errorEl.textContent = err.message || 'Could not load this product.';
        errorEl.classList.remove('hidden');
    }
}

function renderProduct(product) {
    document.title = `${product.title} | Safpedia Marketplace`;

    document.getElementById('product-category').textContent = product.category;
    document.getElementById('product-title').textContent = product.title;
    document.getElementById('product-vendor-name').textContent = product.vendorFirstName || 'Vendor';
    document.getElementById('product-price').textContent = '₦' + product.price.toLocaleString();
    document.getElementById('product-description').textContent = product.description || '';

    const typeBadge = document.getElementById('product-type-badge');
    typeBadge.textContent = product.type === 'physical' ? 'Physical Product' : 'Digital Download';
    typeBadge.classList.add(product.type === 'physical' ? 'physical' : 'digital');

    // ---- Gallery ----
    const images = product.images && product.images.length ? product.images : [{ url: 'images/hero.png' }];
    const mainImg = document.getElementById('gallery-main-image');
    mainImg.src = images[0].url;

    const thumbsContainer = document.getElementById('gallery-thumbs');
    thumbsContainer.innerHTML = '';
    images.forEach((img) => {
        const thumb = document.createElement('img');
        thumb.src = img.url;
        thumb.className = 'gallery-thumb';
        thumb.addEventListener('click', () => { mainImg.src = img.url; });
        thumbsContainer.appendChild(thumb);
    });

    // ---- Stock / quantity / shipping visibility ----
    const stockNote = document.getElementById('product-stock-note');
    const quantityRow = document.getElementById('quantity-row');
    const quantityInput = document.getElementById('quantity-input');
    const shippingForm = document.getElementById('shipping-form');
    const buyBtn = document.getElementById('buy-now-btn');

    if (product.type === 'physical') {
        quantityRow.classList.remove('hidden');
        shippingForm.classList.remove('hidden');
        quantityInput.max = product.stock;

        if (product.stock <= 0) {
            stockNote.textContent = 'Out of stock';
            stockNote.classList.remove('hidden');
            buyBtn.disabled = true;
            buyBtn.textContent = 'Out of Stock';
        } else {
            stockNote.textContent = `${product.stock} in stock`;
            stockNote.classList.remove('hidden');
        }
    } else {
        quantityRow.classList.add('hidden');
        shippingForm.classList.add('hidden');
        quantityInput.value = 1;
    }
}

// ====================================================================
// PURCHASE FLOW
// ====================================================================
function readShippingAddress() {
    return {
        fullName: document.getElementById('ship-fullname').value.trim(),
        phone: document.getElementById('ship-phone').value.trim(),
        address: document.getElementById('ship-address').value.trim(),
        city: document.getElementById('ship-city').value.trim(),
        state: document.getElementById('ship-state').value.trim()
    };
}

function fillShippingAddress(shippingAddress) {
    if (!shippingAddress) return;
    document.getElementById('ship-fullname').value = shippingAddress.fullName || '';
    document.getElementById('ship-phone').value = shippingAddress.phone || '';
    document.getElementById('ship-address').value = shippingAddress.address || '';
    document.getElementById('ship-city').value = shippingAddress.city || '';
    document.getElementById('ship-state').value = shippingAddress.state || '';
}

function showPurchaseStatus(message, isError = false) {
    const el = document.getElementById('purchase-status');
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('status-error', isError);
}

async function startPurchase() {
    const buyBtn = document.getElementById('buy-now-btn');

    if (!currentProduct || !currentProductId) return;

    const quantity = currentProduct.type === 'physical'
        ? parseInt(document.getElementById('quantity-input').value, 10)
        : 1;

    if (currentProduct.type === 'physical') {
        if (Number.isNaN(quantity) || quantity < 1) {
            showPurchaseStatus('Enter a valid quantity.', true);
            return;
        }
        if (quantity > currentProduct.stock) {
            showPurchaseStatus('Requested quantity exceeds available stock.', true);
            return;
        }
    }

    let shippingAddress = null;
    if (currentProduct.type === 'physical') {
        shippingAddress = readShippingAddress();
        const missing = Object.entries(shippingAddress).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length) {
            showPurchaseStatus(`Please fill in: ${missing.join(', ')}`, true);
            return;
        }
    }

    // ---- Not logged in: stash intent, redirect to sign-in ----
    if (!currentUser) {
        localStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify({
            productId: currentProductId,
            quantity,
            shippingAddress,
            timestamp: Date.now()
        }));
        showPurchaseStatus('Please sign in to continue — redirecting...');
        setTimeout(() => { window.location.href = '/sign-in.html'; }, 1200);
        return;
    }

    buyBtn.disabled = true;
    showPurchaseStatus('Preparing checkout...');

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/marketplace/create-transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ productId: currentProductId, quantity, shippingAddress })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not start checkout');

        showPurchaseStatus('Redirecting to payment...');
        window.location.href = json.authorization_url;

    } catch (err) {
        console.error('startPurchase error:', err);
        showPurchaseStatus('Error: ' + err.message, true);
        buyBtn.disabled = false;
    }
}

function resumePendingPurchaseIfAny() {
    const raw = localStorage.getItem(PENDING_PURCHASE_KEY);
    if (!raw) return;

    try {
        const pending = JSON.parse(raw);
        localStorage.removeItem(PENDING_PURCHASE_KEY); // consume it — don't retry loop on failure

        if (pending.productId !== currentProductId) return;

        if (pending.shippingAddress) {
            fillShippingAddress(pending.shippingAddress);
        }
        if (pending.quantity) {
            document.getElementById('quantity-input').value = pending.quantity;
        }

        startPurchase();

    } catch (err) {
        console.warn('Could not resume pending purchase:', err.message);
        localStorage.removeItem(PENDING_PURCHASE_KEY);
    }
}

document.getElementById('buy-now-btn').addEventListener('click', startPurchase);

loadProduct();