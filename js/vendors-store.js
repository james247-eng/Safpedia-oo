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
let storeProducts = [];

// ====================================================================
// CART STATE
// ====================================================================
// Cart is scoped to this one vendor's storefront (the platform has no
// shared warehouse, so a checkout can never span vendors). Stored
// pre-auth, like product-details.js's PENDING_PURCHASE_KEY pattern —
// auth is only required at the checkout step, not to build a cart.
const PENDING_CART_CHECKOUT_KEY = 'safpedia-pending-cart-checkout';
let cart = {}; // { [productId]: quantity }

function cartStorageKey() {
    return `safpedia-vendor-cart:${activeVendorUid}`;
}

function loadCartFromStorage() {
    try {
        cart = JSON.parse(localStorage.getItem(cartStorageKey()) || '{}');
    } catch {
        cart = {};
    }
}

function saveCartToStorage() {
    localStorage.setItem(cartStorageKey(), JSON.stringify(cart));
}

function cartItemCount() {
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

function cartHasPhysicalItem() {
    return Object.keys(cart).some((productId) => {
        const product = storeProducts.find((p) => p.id === productId);
        return product && product.type === 'physical';
    });
}

function addToCart(productId, quantity) {
    const product = storeProducts.find((p) => p.id === productId);
    if (!product) return;

    const currentQty = cart[productId] || 0;
    let newQty = currentQty + quantity;

    if (product.type === 'physical') {
        newQty = Math.min(newQty, product.stock);
    } else {
        newQty = 1; // digital products: quantity is always 1
    }

    if (newQty <= 0) {
        delete cart[productId];
    } else {
        cart[productId] = newQty;
    }

    saveCartToStorage();
    renderCartDrawer();
    updateCartToggleCount();
}

function removeFromCart(productId) {
    delete cart[productId];
    saveCartToStorage();
    renderCartDrawer();
    updateCartToggleCount();
}

function updateCartToggleCount() {
    document.getElementById('cart-item-count').textContent = cartItemCount();
}

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
        resumePendingCartCheckoutIfAny();
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

    loadCartFromStorage();
    updateCartToggleCount();

    try {
        const response = await fetch(`/api/marketplace/get-storefront?vendorUid=${encodeURIComponent(vendorUid)}`);
        const result = await response.json();
        if (response.status === 404) throw new Error('This storefront is unavailable.');
        if (!response.ok) throw new Error(result.error || 'Could not load this store');
        storeProducts = result.products || [];

        renderBanner(storeProducts);
        renderProductGrid(storeProducts);
        renderCartDrawer();

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

        const outOfStock = item.type === 'physical' && item.stock <= 0;
        const stockNote = item.type === 'physical'
            ? (item.stock > 0 ? `${item.stock} in stock` : 'Out of stock')
            : 'Instant download';

        const inCartQty = cart[item.id] || 0;
        const addToCartControl = outOfStock
            ? `<button type="button" class="btn btn-secondary btn-sm" disabled>Out of Stock</button>`
            : `<button type="button" class="btn btn-secondary btn-sm add-to-cart-btn" data-id="${item.id}">
                   ${inCartQty > 0 ? `In Cart (${inCartQty})` : 'Add to Cart'}
               </button>`;

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
                <div class="card-cart-row">${addToCartControl}</div>
            </div>
        `;
        grid.appendChild(card);
    });

    grid.querySelectorAll('.add-to-cart-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            addToCart(btn.dataset.id, 1);
            renderProductGrid(storeProducts); // refresh "In Cart (n)" labels
        });
    });
}

// ====================================================================
// CART DRAWER
// ====================================================================
function renderCartDrawer() {
    const list = document.getElementById('cart-items-list');
    const subtotalEl = document.getElementById('cart-subtotal-value');
    const checkoutBtn = document.getElementById('cart-checkout-btn');
    const shippingWrapper = document.getElementById('cart-shipping-form-wrapper');

    const productIds = Object.keys(cart);

    if (productIds.length === 0) {
        list.innerHTML = '<div class="empty-state">Your cart is empty.</div>';
        subtotalEl.textContent = '₦0';
        checkoutBtn.disabled = true;
        shippingWrapper.classList.add('hidden');
        return;
    }

    let subtotal = 0;
    list.innerHTML = productIds.map((productId) => {
        const product = storeProducts.find((p) => p.id === productId);
        if (!product) return '';
        const qty = cart[productId];
        const lineTotal = product.price * qty;
        subtotal += lineTotal;

        const qtyControl = product.type === 'physical'
            ? `
                <div class="cart-qty-control">
                    <button type="button" class="cart-qty-btn cart-qty-decrement" data-id="${productId}">−</button>
                    <span>${qty}</span>
                    <button type="button" class="cart-qty-btn cart-qty-increment" data-id="${productId}" ${qty >= product.stock ? 'disabled' : ''}>+</button>
                </div>
              `
            : `<span class="cart-qty-fixed">Qty: 1</span>`;

        return `
            <div class="cart-item-row">
                <div class="cart-item-info">
                    <span class="cart-item-title">${product.title}</span>
                    <span class="cart-item-price">₦${lineTotal.toLocaleString()}</span>
                </div>
                <div class="cart-item-controls">
                    ${qtyControl}
                    <button type="button" class="cart-remove-btn" data-id="${productId}" aria-label="Remove item">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    subtotalEl.textContent = `₦${subtotal.toLocaleString()}`;
    checkoutBtn.disabled = false;
    shippingWrapper.classList.toggle('hidden', !cartHasPhysicalItem());

    list.querySelectorAll('.cart-qty-increment').forEach((btn) => {
        btn.addEventListener('click', () => { addToCart(btn.dataset.id, 1); renderProductGrid(storeProducts); });
    });
    list.querySelectorAll('.cart-qty-decrement').forEach((btn) => {
        btn.addEventListener('click', () => { addToCart(btn.dataset.id, -1); renderProductGrid(storeProducts); });
    });
    list.querySelectorAll('.cart-remove-btn').forEach((btn) => {
        btn.addEventListener('click', () => { removeFromCart(btn.dataset.id); renderProductGrid(storeProducts); });
    });
}

function openCartDrawer() {
    document.getElementById('cart-drawer-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeCartDrawer() {
    document.getElementById('cart-drawer-overlay').classList.add('hidden');
    document.body.style.overflow = '';
}

document.getElementById('cart-toggle-btn').addEventListener('click', openCartDrawer);
document.getElementById('cart-drawer-close').addEventListener('click', closeCartDrawer);
document.getElementById('cart-drawer-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCartDrawer();
});

// ====================================================================
// CHECKOUT
// ====================================================================
function readCartShippingAddress() {
    return {
        fullName: document.getElementById('cart-ship-fullname').value.trim(),
        phone: document.getElementById('cart-ship-phone').value.trim(),
        address: document.getElementById('cart-ship-address').value.trim(),
        city: document.getElementById('cart-ship-city').value.trim(),
        state: document.getElementById('cart-ship-state').value.trim()
    };
}

function fillCartShippingAddress(shippingAddress) {
    if (!shippingAddress) return;
    document.getElementById('cart-ship-fullname').value = shippingAddress.fullName || '';
    document.getElementById('cart-ship-phone').value = shippingAddress.phone || '';
    document.getElementById('cart-ship-address').value = shippingAddress.address || '';
    document.getElementById('cart-ship-city').value = shippingAddress.city || '';
    document.getElementById('cart-ship-state').value = shippingAddress.state || '';
}

function showCartStatus(message, isError = false) {
    const el = document.getElementById('cart-status');
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('status-error', isError);
}

async function startCartCheckout() {
    const checkoutBtn = document.getElementById('cart-checkout-btn');
    const productIds = Object.keys(cart);
    if (productIds.length === 0) return;

    const items = productIds.map((productId) => ({ productId, quantity: cart[productId] }));

    let shippingAddress = null;
    if (cartHasPhysicalItem()) {
        shippingAddress = readCartShippingAddress();
        const missing = Object.entries(shippingAddress).filter(([, v]) => !v).map(([k]) => k);
        if (missing.length) {
            showCartStatus(`Please fill in: ${missing.join(', ')}`, true);
            return;
        }
    }

    if (!currentUser) {
        localStorage.setItem(PENDING_CART_CHECKOUT_KEY, JSON.stringify({
            vendorUid: activeVendorUid,
            items,
            shippingAddress,
            timestamp: Date.now()
        }));
        showCartStatus('Please sign in to continue — redirecting...');
        setTimeout(() => { window.location.href = '/sign-in.html'; }, 1200);
        return;
    }

    checkoutBtn.disabled = true;
    showCartStatus('Preparing checkout...');

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/marketplace/create-transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ items, shippingAddress })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not start checkout');

        localStorage.removeItem(cartStorageKey());
        showCartStatus('Redirecting to payment...');
        window.location.href = json.authorization_url;

    } catch (err) {
        console.error('startCartCheckout error:', err);
        showCartStatus('Error: ' + err.message, true);
        checkoutBtn.disabled = false;
    }
}

document.getElementById('cart-checkout-btn').addEventListener('click', startCartCheckout);

function resumePendingCartCheckoutIfAny() {
    const raw = localStorage.getItem(PENDING_CART_CHECKOUT_KEY);
    if (!raw) return;

    try {
        const pending = JSON.parse(raw);
        localStorage.removeItem(PENDING_CART_CHECKOUT_KEY); // consume — don't retry loop on failure

        if (pending.vendorUid !== activeVendorUid) return;

        // Re-populate the in-memory cart from the pending record so the
        // drawer reflects what's about to be checked out, then re-fire
        // checkout now that we're authenticated.
        cart = {};
        (pending.items || []).forEach((item) => { cart[item.productId] = item.quantity; });
        saveCartToStorage();

        if (pending.shippingAddress) {
            fillCartShippingAddress(pending.shippingAddress);
        }

        openCartDrawer();
        renderCartDrawer();
        startCartCheckout();

    } catch (err) {
        console.warn('Could not resume pending cart checkout:', err.message);
        localStorage.removeItem(PENDING_CART_CHECKOUT_KEY);
    }
}

loadVendorStore();

// ====================================================================
// COMPLAINT MODAL (unchanged from existing build)
// ====================================================================
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