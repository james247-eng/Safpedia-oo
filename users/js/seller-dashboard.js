// students/js/seller-dashboard.js

import { auth, db } from '../../firebase-config.js';
import '../../js/notification-center.js';
import { collection, doc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

let currentUser = null;
let tierConfig = {};
let subscriptionSummary = null;
const VENDOR_SUBSCRIPTION_INTENT_KEY = 'safpedia-vendor-subscription-intent';

function subscriptionDate(value) {
    if (!value) return null;
    if (typeof value === 'string' || value instanceof Date) return new Date(value);
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    return null;
}

function formatSubscriptionDate(value) {
    const date = subscriptionDate(value);
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : 'Not set';
}

function naira(amount) { return amount == null ? 'N/A' : `₦${Number(amount).toLocaleString()}`; }

function subscriptionStorageKey() { return currentUser ? `safpedia-add-product-draft:${currentUser.uid}` : null; }

// ====================================================================
// TAB SWITCHING (self-contained — no dependency on dashboard-nav.js)
// ====================================================================
document.querySelectorAll('.nav-item-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.tab;

        document.querySelectorAll('.nav-item-btn[data-tab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.dashboard-section-card').forEach((section) => {
            section.classList.toggle('active-tab', section.id === targetId);
        });
    });
});

// ====================================================================
// AUTH GUARD
// ====================================================================
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = '/sign-in.html';
        return;
    }
    currentUser = user;

    const avatarEl = document.getElementById('seller-avatar-slot');
    const emailEl = document.getElementById('seller-display-email');
    if (avatarEl) avatarEl.textContent = (user.email || 'U').charAt(0).toUpperCase();
    if (emailEl) emailEl.textContent = user.email || 'Seller Account';
    document.getElementById('my-storefront-link').href = `/vendor-store.html?vendor=${user.uid}`;

    loadVendorProfile();
    loadBankList();
    loadOrders();
    loadSubscriptionSummary();
    loadVendorDisputes();
    restoreProductDraft();
});

document.getElementById('seller-logout-trigger')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = '/sign-in.html';
});

// ====================================================================
// STATUS MESSAGE HELPER (kept dependency-free — no assumed toast module)
// ====================================================================
function showStatus(message, isError = false) {
    const el = document.getElementById('upload-progress');
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('status-error', isError);
}

function clearStatus() {
    const el = document.getElementById('upload-progress');
    el.textContent = '';
    el.classList.add('hidden');
    el.classList.remove('status-error');
}

async function loadVendorDisputes() {
    const container = document.getElementById('vendor-disputes-list');
    try {
        const token = await currentUser.getIdToken(); const res = await fetch('/api/disputes/list-disputes', { headers: { Authorization: `Bearer ${token}` } }); const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load disputes');
        const disputes = json.disputes.filter((d) => d.vendorUid === currentUser.uid);
        if (!disputes.length) { container.innerHTML = '<div class="empty-state">No disputes filed against your sales.</div>'; return; }
        container.innerHTML = disputes.map((d) => `<div class="dashboard-section-card"><p><strong>${d.reference}</strong> — ${d.status}</p><p>Reason: ${d.reason}</p><p>Buyer: ${d.buyerStatement}</p>${d.vendorStatement ? `<p>Your response: ${d.vendorStatement}</p>` : ''}${['open','investigating'].includes(d.status) ? `<form class="vendor-dispute-response" data-id="${d.id}"><textarea required placeholder="Your response to the buyer"></textarea><button class="btn btn-primary" type="submit">Send response</button></form>` : `<p>Resolution: ${d.resolution || d.status}</p>`}</div>`).join('');
        container.querySelectorAll('.vendor-dispute-response').forEach((form) => form.addEventListener('submit', async (e) => { e.preventDefault(); const token = await currentUser.getIdToken(); const response = await fetch('/api/disputes/respond-to-dispute', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ disputeId: form.dataset.id, vendorStatement: form.querySelector('textarea').value }) }); const body = await response.json(); if (!response.ok) return alert(body.error || 'Could not respond'); loadVendorDisputes(); }));
    } catch (err) { container.innerHTML = `<div class="error-state">${err.message}</div>`; }
}

async function loadSubscriptionSummary() {
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/vendors/get-subscription-summary', {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load subscription');
        tierConfig = json.tiers || {};
        subscriptionSummary = json;
        renderSubscriptionSummary(json);
        resumeVendorSubscriptionIntent();
    } catch (err) {
        console.error('loadSubscriptionSummary error:', err);
        document.getElementById('subscription-status-panel').textContent = `Could not load subscription: ${err.message}`;
        document.getElementById('subscription-payments-list').innerHTML = '<div class="error-state">Could not load payment history.</div>';
    }
}

async function resumeVendorSubscriptionIntent() {
    let intent;
    try { intent = JSON.parse(localStorage.getItem(VENDOR_SUBSCRIPTION_INTENT_KEY) || 'null'); } catch { intent = null; }
    if (!intent) return;
    if (!intent.createdAt || Date.now() - Number(intent.createdAt) > 24 * 60 * 60 * 1000) { localStorage.removeItem(VENDOR_SUBSCRIPTION_INTENT_KEY); return; }
    if (!tierConfig[intent.tier] || !['safbloom', 'safscale'].includes(intent.tier) || !['monthly', 'annual'].includes(intent.billingCycle)) return;
    const button = document.createElement('button');
    try { const started = await initiateSubscriptionPayment(intent.tier, intent.billingCycle, button); if (started) localStorage.removeItem(VENDOR_SUBSCRIPTION_INTENT_KEY); } catch (err) { console.error('Subscription intent resume failed:', err); }
}

function renderSubscriptionSummary(summary) {
    const vendor = summary.vendor || {};
    const tierKey = tierConfig[vendor.subscriptionTier] ? vendor.subscriptionTier : 'safseed';
    const tier = tierConfig[tierKey] || {};
    const paidTier = tierKey !== 'safseed';
    const expired = paidTier && vendor.subscriptionStatus === 'expired';
    const status = paidTier ? (expired ? 'Expired' : 'Active') : 'Free tier (no status needed)';
document.getElementById('subscription-status-panel').innerHTML = `
    <p class="sub-tier-name"><strong>${tier.displayName || 'Safseed'}</strong></p>
    <p class="sub-status">Status: ${status}</p>
    ${paidTier ? `<p class="sub-expiry">Expires: ${formatSubscriptionDate(vendor.subscriptionExpiresAt)}</p>` : '<p class="sub-expiry sub-expiry--free">Safseed is free and does not expire.</p>'}
`;

    const actions = document.getElementById('subscription-actions');
    actions.innerHTML = '';
    if (expired) actions.appendChild(subscriptionButton(tierKey, 'monthly', 'Renew'));
    if (!paidTier || expired) {
        actions.appendChild(buildTierChoices());
    } else {
        actions.appendChild(buildTierChoices('Change plan'));
    }
    renderSubscriptionPayments(summary.payments || []);
}

function subscriptionButton(tier, billingCycle, label) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-primary'; button.textContent = label;
    button.addEventListener('click', () => initiateSubscriptionPayment(tier, billingCycle, button));
    return button;
}

function buildTierChoices(label = 'Upgrade') {
    const wrapper = document.createElement('div');
    wrapper.className = 'subscription-tier-choices';
    const heading = document.createElement('h3'); heading.textContent = label; wrapper.appendChild(heading);
    Object.entries(tierConfig).filter(([key]) => key !== 'safseed').forEach(([key, tier]) => {
        const row = document.createElement('div'); row.className = 'subscription-tier-row';
        const details = document.createElement('span');
        details.textContent = `${tier.displayName}: ${naira(tier.monthlyPrice)}/month or ${naira(tier.annualPrice)}/year`;
        const monthly = subscriptionButton(key, 'monthly', 'Monthly');
        const annual = subscriptionButton(key, 'annual', 'Annual');
        row.append(details, monthly, annual); wrapper.appendChild(row);
    });
    return wrapper;
}

function renderSubscriptionPayments(payments) {
    const container = document.getElementById('subscription-payments-list');
    if (!payments.length) { container.innerHTML = '<div class="empty-state">No subscription payments yet.</div>'; return; }
    container.innerHTML = '';
    payments.forEach((payment) => {
        const tier = tierConfig[payment.tier];
        const row = document.createElement('div'); row.className = 'subscription-payment-row';
        const reference = document.createElement('code'); reference.textContent = payment.reference || payment.id;
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-secondary btn-sm'; copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(payment.reference || payment.id); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }
            catch { copy.textContent = 'Copy failed'; }
        });
        row.append(`${tier?.displayName || payment.tier || 'Subscription'} | ${naira(payment.amount)} | ${payment.billingCycle || 'monthly'} | ${payment.status || 'unknown'} | ${formatSubscriptionDate(payment.createdAt)} | `, reference, copy);
        container.appendChild(row);
    });
}

async function initiateSubscriptionPayment(tier, billingCycle, button) {
    button.disabled = true;
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/marketplace/initiate-subscription-payment', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ tier, billingCycle })
        });
        const json = await res.json();
        if (!res.ok || !json.authorization_url) throw new Error(json.error || 'Could not start payment');
        window.location.assign(json.authorization_url);
        return true;
    } catch (err) {
        alert(`Subscription payment could not start: ${err.message}`); button.disabled = false;
        return false;
    }
}

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
// VENDOR PROFILE (balance + product list)
// ====================================================================
async function loadVendorProfile() {
    const grid = document.getElementById('products-grid');
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/vendors/get-profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load profile');

        renderBalance(json.vendor);
        renderBankAccount(json.vendor.bankAccount);
        renderProducts(json.products);

    } catch (err) {
        console.error('loadVendorProfile error:', err);
        grid.innerHTML = `<div class="error-state">Could not load your products: ${err.message}</div>`;
    }
}

function renderBalance(vendor) {
    document.getElementById('pending-payout-value').textContent = '₦' + (vendor.pendingPayout || 0).toLocaleString();
    document.getElementById('awaiting-payout-value').textContent = '₦' + (vendor.awaitingPayout || 0).toLocaleString();
    document.getElementById('total-paid-value').textContent = '₦' + (vendor.totalPaidOut || 0).toLocaleString();
}

function renderBankAccount(bankAccount) {
    const el = document.getElementById('bank-account-display');
    if (!bankAccount) {
        el.innerHTML = '<p class="empty-state">No bank account on file yet.</p>';
        return;
    }
    const masked = maskAccountNumber(bankAccount.accountNumber);
    el.innerHTML = `
        <p><strong>${bankAccount.accountName}</strong></p>
        <p>${masked} — Bank code ${bankAccount.bankCode}</p>
    `;
}

function renderProducts(products) {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    if (!products || products.length === 0) {
        grid.innerHTML = `
          <div class="empty-state-block">
            <div class="empty-icon"><ion-icon name="cube-outline"></ion-icon></div>
            <h3>No products listed yet</h3>
            <p>Once you add a product, it appears here and goes live immediately — no approval wait.</p>
            <button type="button" class="btn btn-primary" id="empty-add-product-btn"><ion-icon name="add-circle-outline"></ion-icon> Add Your First Product</button>
          </div>
        `;
        document.getElementById('empty-add-product-btn')?.addEventListener('click', () => {
            document.querySelector('.nav-item-btn[data-tab="add-product-pane"]')?.click();
        });
        return;
    }

    products.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'product-card';
        const cover = p.images && p.images[0] ? p.images[0].url : 'images/hero.png';
        const statusBadge = p.isActive
            ? '<span class="badge-f live">Active</span>'
            : '<span class="badge-f pdf">Inactive</span>';

        card.innerHTML = `
            <div class="card-banner">
                <img src="${cover}" alt="${p.title}">
                ${statusBadge}
            </div>
            <div class="card-details">
                <span class="category-meta">${p.category}</span>
                <h3 class="product-title">${p.title}</h3>
                <div class="card-footer-row">
                    <span class="product-cost">₦${p.price.toLocaleString()}</span>
                    <span>${p.type === 'physical' ? `Stock: ${p.stock}` : 'Digital'}</span>
                </div>
                <p>Sales: ${p.totalSales}</p>
                <div class="product-card-actions">
                    <a href="/vendors-product-details.html?id=${p.id}" class="btn btn-secondary btn-sm" target="_blank">View</a>
                    <button class="btn btn-secondary btn-sm edit-product-btn" data-id="${p.id}">Edit</button>
                    <button class="btn btn-secondary btn-sm toggle-active-btn" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button class="btn btn-secondary btn-sm delete-product-btn" data-id="${p.id}">Delete</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    grid.querySelectorAll('.edit-product-btn').forEach((btn) => {
        btn.addEventListener('click', () => openEditProduct(btn.dataset.id, products));
    });
    grid.querySelectorAll('.toggle-active-btn').forEach((btn) => {
        btn.addEventListener('click', () => toggleProductActive(btn.dataset.id, btn.dataset.active !== 'true'));
    });
    grid.querySelectorAll('.delete-product-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
    });
}

// ====================================================================
// EDIT / TOGGLE / DELETE PRODUCT
// ====================================================================
function openEditProduct(productId, products) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    const newTitle = prompt('Title:', product.title);
    if (newTitle === null) return;
    const newPrice = prompt('Price (₦):', product.price);
    if (newPrice === null) return;

    const payload = { productId, title: newTitle.trim(), price: parseFloat(newPrice) };

    if (product.type === 'physical') {
        const newStock = prompt('Stock quantity:', product.stock);
        if (newStock === null) return;
        payload.stock = parseInt(newStock, 10);
    }

    submitProductUpdate(payload);
}

async function submitProductUpdate(payload) {
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/marketplace/update-product', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not update product');

        loadVendorProfile();
    } catch (err) {
        console.error('Update product error:', err);
        alert('Error: ' + err.message);
    }
}

async function toggleProductActive(productId, nextActive) {
    await submitProductUpdate({ productId, isActive: nextActive });
}

async function deleteProduct(productId) {
    if (!confirm('Delete this product? Products with past sales are hidden rather than permanently removed.')) {
        return;
    }
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/marketplace/delete-product', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ productId })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not delete product');

        alert(json.mode === 'soft-deleted' ? json.message : 'Product permanently deleted.');
        loadVendorProfile();
    } catch (err) {
        console.error('Delete product error:', err);
        alert('Error: ' + err.message);
    }
}

// ====================================================================
// ADD PRODUCT — TYPE TOGGLE
// ====================================================================
document.querySelectorAll('input[name="product-type"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
        const isDigital = e.target.value === 'digital';
        document.getElementById('stock-field-wrapper').classList.toggle('hidden', isDigital);
        document.getElementById('digital-file-wrapper').classList.toggle('hidden', !isDigital);
    });
});

function draftSnapshot() {
    const form = document.getElementById('add-product-form');
    return {
        title: document.getElementById('product-title').value,
        description: document.getElementById('product-description').value,
        category: document.getElementById('product-category').value,
        price: document.getElementById('product-price').value,
        type: document.querySelector('input[name="product-type"]:checked')?.value || 'physical',
        stock: document.getElementById('product-stock').value,
        imageFiles: Array.from(document.getElementById('product-images').files || []).map((file) => ({ name: file.name, size: file.size, type: file.type })),
        digitalFile: document.getElementById('product-digital-file').files[0] ? { name: document.getElementById('product-digital-file').files[0].name, size: document.getElementById('product-digital-file').files[0].size, type: document.getElementById('product-digital-file').files[0].type } : null,
        savedAt: Date.now()
    };
}

function saveProductDraft() {
    const key = subscriptionStorageKey();
    if (!key) return;
    const snapshot = draftSnapshot();
    if (snapshot.title || snapshot.description || snapshot.category || snapshot.price || snapshot.imageFiles.length || snapshot.digitalFile) localStorage.setItem(key, JSON.stringify(snapshot));
}

function restoreProductDraft() {
    const raw = subscriptionStorageKey() && localStorage.getItem(subscriptionStorageKey());
    if (!raw) return;
    try {
        const draft = JSON.parse(raw);
        document.getElementById('product-title').value = draft.title || '';
        document.getElementById('product-description').value = draft.description || '';
        document.getElementById('product-category').value = draft.category || '';
        document.getElementById('product-price').value = draft.price || '';
        document.getElementById('product-stock').value = draft.stock || '';
        const radio = document.querySelector(`input[name="product-type"][value="${draft.type || 'physical'}"]`); if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
        const notes = [...(draft.imageFiles || []).map((file) => file.name), draft.digitalFile?.name].filter(Boolean);
        const notice = document.getElementById('product-draft-restored'); notice.textContent = `We restored your unsaved product details. Please reselect your files${notes.length ? `: ${notes.join(', ')}` : ''}.`; notice.classList.remove('hidden');
    } catch { localStorage.removeItem(subscriptionStorageKey()); }
}

document.getElementById('add-product-form').addEventListener('input', saveProductDraft);
document.getElementById('add-product-form').addEventListener('change', saveProductDraft);
window.addEventListener('beforeunload', saveProductDraft);

// ====================================================================
// CLOUDINARY UPLOAD HELPERS
// ====================================================================
async function getUploadSignature(productId, kind) {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/marketplace/get-upload-signature', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ productId, kind })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not get upload signature');
    return json;
}

async function uploadToCloudinary(file, signed) {
    const url = `https://api.cloudinary.com/v1_1/${signed.cloudName}/${signed.resourceType}/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', signed.apiKey);
    formData.append('timestamp', signed.timestamp);
    formData.append('signature', signed.signature);
    formData.append('folder', signed.folder);
    formData.append('type', signed.type);

    const res = await fetch(url, { method: 'POST', body: formData });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json; // { public_id, format, secure_url, bytes, ... }
}

// ====================================================================
// ADD PRODUCT — SUBMIT
// ====================================================================
document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submit-product-btn');
    submitBtn.disabled = true;

    try {
        const title = document.getElementById('product-title').value.trim();
        const description = document.getElementById('product-description').value.trim();
        const category = document.getElementById('product-category').value.trim();
        const price = parseFloat(document.getElementById('product-price').value);
        const type = document.querySelector('input[name="product-type"]:checked').value;
        const imageFiles = Array.from(document.getElementById('product-images').files || []);

        if (imageFiles.length > 6) {
            throw new Error('Maximum 6 product photos allowed');
        }

        let stock = null;
        if (type === 'physical') {
            stock = parseInt(document.getElementById('product-stock').value, 10);
            if (Number.isNaN(stock) || stock < 0) {
                throw new Error('Enter a valid stock quantity');
            }
        }

        let digitalFile = null;
        if (type === 'digital') {
            digitalFile = document.getElementById('product-digital-file').files[0];
            if (!digitalFile) {
                throw new Error('Select a file for your digital product');
            }
        }

        // Draft ID generated locally, shared across upload calls and create-product.
        const productId = doc(collection(db, 'vendorProducts')).id;

        // ---- Upload images ----
        const images = [];
        for (let i = 0; i < imageFiles.length; i++) {
            showStatus(`Uploading photo ${i + 1} of ${imageFiles.length}...`);
            const signed = await getUploadSignature(productId, 'media');
            const uploaded = await uploadToCloudinary(imageFiles[i], signed);
            images.push({ publicId: uploaded.public_id });
        }

        // ---- Upload digital file ----
        let digitalAsset = null;
        if (type === 'digital') {
            showStatus('Uploading product file...');
            const signed = await getUploadSignature(productId, 'digital');
            const uploaded = await uploadToCloudinary(digitalFile, signed);
            const fileExtension = digitalFile.name.split('.').pop().toLowerCase();
            digitalAsset = { publicId: uploaded.public_id, format: fileExtension };
        }

        // ---- Create the product ----
        showStatus('Publishing product...');
        const idToken = await currentUser.getIdToken();
        const createRes = await fetch('/api/marketplace/create-product', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                productId,
                title,
                description,
                category,
                price,
                type,
                stock,
                digitalAsset,
                images
            })
        });
        const createJson = await createRes.json();
        if (!createRes.ok) {
            const error = new Error(createJson.error || 'Could not publish product');
            error.reasonCode = createJson.reasonCode;
            throw error;
        }

        showStatus('Product published successfully!');
        document.getElementById('add-product-form').reset();
        localStorage.removeItem(subscriptionStorageKey());
        document.getElementById('product-draft-restored').classList.add('hidden');
        document.getElementById('product-limit-upgrade-prompt').classList.add('hidden');
        document.getElementById('digital-file-wrapper').classList.add('hidden');
        document.getElementById('stock-field-wrapper').classList.remove('hidden');
        loadVendorProfile();
        setTimeout(clearStatus, 3000);

    } catch (err) {
        console.error('Product creation error:', err);
        saveProductDraft();
        if (err.reasonCode === 'limit_reached') showProductLimitPrompt(err.message);
        showStatus('Error: ' + err.message, true);
    } finally {
        submitBtn.disabled = false;
    }
});

function showProductLimitPrompt(message) {
    const currentTier = subscriptionSummary?.vendor?.subscriptionTier || 'safseed';
    const limit = tierConfig[currentTier]?.productLimit;
    document.getElementById('product-limit-upgrade-message').textContent = `${message || `You have reached your ${limit}-product limit.`} Your details are still here. Upgrade to add another product.`;
    document.getElementById('product-limit-upgrade-prompt').classList.remove('hidden');
}

document.getElementById('product-limit-upgrade-btn').addEventListener('click', () => {
    document.querySelector('.nav-item-btn[data-tab="subscription-pane"]')?.click();
});
document.getElementById('dismiss-product-limit-prompt').addEventListener('click', () => {
    document.getElementById('product-limit-upgrade-prompt').classList.add('hidden');
});

// ====================================================================
// ORDERS
// ====================================================================
async function loadOrders() {
    const container = document.getElementById('orders-list');
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/vendors/get-orders', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load orders');

        renderOrders(json.orders);

    } catch (err) {
        console.error('loadOrders error:', err);
        container.innerHTML = `<div class="error-state">Could not load orders: ${err.message}</div>`;
    }
}

function renderOrders(orders) {
    const container = document.getElementById('orders-list');

    if (!orders || orders.length === 0) {
        container.innerHTML = `
          <div class="empty-state-block">
            <div class="empty-icon"><ion-icon name="receipt-outline"></ion-icon></div>
            <h3>No orders yet</h3>
            <p>Orders from buyers will show up here as soon as your first sale comes in.</p>
          </div>
        `;
        return;
    }

    const rows = orders.map((o, index) => {
        const date = o.createdAt && o.createdAt._seconds
            ? new Date(o.createdAt._seconds * 1000).toLocaleDateString()
            : '';

        let actionCell = '—';
        if (o.productType === 'physical') {
            if (o.fulfillmentStatus === 'pending_shipment') {
                actionCell = `<button class="btn btn-sm btn-secondary mark-shipped-btn" data-product-id="${o.productId}" data-reference="${o.reference}">Mark Shipped</button>`;
            } else if (o.fulfillmentStatus === 'shipped') {
                actionCell = `<button class="btn btn-sm btn-secondary mark-delivered-btn" data-product-id="${o.productId}" data-reference="${o.reference}">Mark Delivered</button>`;
            } else if (o.fulfillmentStatus === 'delivered') {
                actionCell = 'Delivered';
            }
        } else {
            actionCell = 'Digital — auto-fulfilled';
        }

        return `
            <tr>
                <td>${o.productTitle}</td>
                <td>${o.quantity}</td>
                <td>₦${(o.vendorAmount || 0).toLocaleString()}</td>
                <td>${o.productType === 'physical' ? 'Physical' : 'Digital'}</td>
                <td>${date}</td>
                <td>${actionCell}</td>
                <td><button type="button" class="btn btn-sm btn-secondary view-order-details-btn" data-order-index="${index}">View Details</button></td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="data-table-frame">
            <thead>
                <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Your Cut</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Status / Action</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('.view-order-details-btn').forEach((btn) => {
        btn.addEventListener('click', () => openOrderDetails(orders[btn.dataset.orderIndex]));
    });

    container.querySelectorAll('.mark-shipped-btn').forEach((btn) => {
        btn.addEventListener('click', () => updateOrderStatus(btn.dataset.productId, btn.dataset.reference, 'shipped'));
    });
    container.querySelectorAll('.mark-delivered-btn').forEach((btn) => {
        btn.addEventListener('click', () => updateOrderStatus(btn.dataset.productId, btn.dataset.reference, 'delivered'));
    });
}

function openOrderDetails(order) {
    const modal = document.getElementById('order-detail-modal');
    const shippingPanel = document.getElementById('shipping-details-panel');
    const digitalPanel = document.getElementById('digital-details-panel');

    document.getElementById('order-detail-reference').textContent = order.reference || '—';
    document.getElementById('order-detail-product-title').textContent = order.productTitle || '—';
    document.getElementById('order-detail-quantity').textContent = order.quantity || '—';
    document.getElementById('order-detail-amount').textContent = `₦${(order.vendorAmount || 0).toLocaleString()}`;
    document.getElementById('order-detail-type').textContent = order.productType === 'physical' ? 'Physical' : 'Digital';
    document.getElementById('order-detail-status').textContent = order.fulfillmentStatus || 'Unknown';
    document.getElementById('order-detail-date').textContent = order.createdAt && order.createdAt._seconds
        ? new Date(order.createdAt._seconds * 1000).toLocaleDateString()
        : '—';

    if (order.shippingAddress) {
        shippingPanel.classList.remove('hidden');
        digitalPanel.classList.add('hidden');
        document.getElementById('order-detail-fullname').textContent = order.shippingAddress.fullName || '—';
        document.getElementById('order-detail-phone').textContent = order.shippingAddress.phone || '—';
        document.getElementById('order-detail-address').textContent = order.shippingAddress.address || '—';
        document.getElementById('order-detail-city').textContent = order.shippingAddress.city || '—';
        document.getElementById('order-detail-state').textContent = order.shippingAddress.state || '—';
    } else {
        shippingPanel.classList.add('hidden');
        digitalPanel.classList.remove('hidden');
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeOrderDetails() {
    const modal = document.getElementById('order-detail-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

const closeOrderDetailBtn = document.getElementById('close-order-detail-modal');
if (closeOrderDetailBtn) {
    closeOrderDetailBtn.addEventListener('click', closeOrderDetails);
}

document.getElementById('order-detail-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
        closeOrderDetails();
    }
});

async function updateOrderStatus(productId, reference, action) {
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/vendors/update-order-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ productId, reference, action })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not update order status');

        loadOrders();

    } catch (err) {
        console.error('updateOrderStatus error:', err);
        alert('Error: ' + err.message);
    }
}

// ====================================================================
// BANK ACCOUNT
// ====================================================================
async function loadBankList() {
    const select = document.getElementById('bank-select');
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/affiliates/list-banks', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load bank list');

        select.innerHTML = '<option value="">Select your bank</option>';
        json.banks.forEach((bank) => {
            const opt = document.createElement('option');
            opt.value = bank.code;
            opt.textContent = bank.name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('loadBankList error:', err);
        select.innerHTML = '<option value="">Could not load banks</option>';
    }
}

document.getElementById('bank-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-bank-btn');
    btn.disabled = true;

    try {
        const bankCode = document.getElementById('bank-select').value;
        const accountNumber = document.getElementById('account-number').value.trim();

        if (!bankCode || !accountNumber) {
            throw new Error('Select a bank and enter your account number');
        }

        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/vendors/add-bank-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ bankCode, accountNumber })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not save bank account');

        renderBankAccount(json.bankAccount);
        alert('Bank account saved successfully.');

    } catch (err) {
        console.error('Bank account error:', err);
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
    }
});

// ====================================================================
// REQUEST PAYOUT
// ====================================================================
document.getElementById('request-payout-btn').addEventListener('click', async () => {
    const btn = document.getElementById('request-payout-btn');
    btn.disabled = true;

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/vendors/request-payout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({})
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not request payout');

        alert(`Payout of ₦${json.amount.toLocaleString()} requested — status: ${json.status}`);
        loadVendorProfile();

    } catch (err) {
        console.error('Request payout error:', err);
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
    }
});

// ====================================================================
// DEEP-LINK TAB ROUTING (additive)
// Same pattern as dashboard.js — lets another page send a seller
// straight to e.g. "sellers-page.html#payouts-pane" with that tab
// already open. Doesn't touch the existing click-based tab switcher.
// ====================================================================
function openTabFromHash() {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    const targetSection = document.getElementById(targetId);
    if (!targetSection || !targetSection.classList.contains('dashboard-section-card')) return;

    const targetBtn = document.querySelector(`.nav-item-btn[data-tab="${targetId}"]`);
    if (!targetBtn) return;

    document.querySelectorAll('.nav-item-btn[data-tab]').forEach((b) => b.classList.remove('active'));
    targetBtn.classList.add('active');
    document.querySelectorAll('.dashboard-section-card').forEach((section) => {
        section.classList.toggle('active-tab', section.id === targetId);
    });
}

window.addEventListener('DOMContentLoaded', openTabFromHash);
window.addEventListener('hashchange', openTabFromHash);
