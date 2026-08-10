// students/js/seller-dashboard.js

import { auth, db } from '../../firebase-config.js';
import '../../js/notification-center.js';
import { collection, doc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

let currentUser = null;

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
        if (!createRes.ok) throw new Error(createJson.error || 'Could not publish product');

        showStatus('Product published successfully!');
        document.getElementById('add-product-form').reset();
        document.getElementById('digital-file-wrapper').classList.add('hidden');
        document.getElementById('stock-field-wrapper').classList.remove('hidden');
        loadVendorProfile();
        setTimeout(clearStatus, 3000);

    } catch (err) {
        console.error('Product creation error:', err);
        showStatus('Error: ' + err.message, true);
    } finally {
        submitBtn.disabled = false;
    }
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

    const rows = orders.map((o) => {
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
                <td>${o.fulfillmentStatus}</td>
                <td>${date}</td>
                <td>${actionCell}</td>
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
                    <th>Status</th>
                    <th>Date</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('.mark-shipped-btn').forEach((btn) => {
        btn.addEventListener('click', () => updateOrderStatus(btn.dataset.productId, btn.dataset.reference, 'shipped'));
    });
    container.querySelectorAll('.mark-delivered-btn').forEach((btn) => {
        btn.addEventListener('click', () => updateOrderStatus(btn.dataset.productId, btn.dataset.reference, 'delivered'));
    });
}

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