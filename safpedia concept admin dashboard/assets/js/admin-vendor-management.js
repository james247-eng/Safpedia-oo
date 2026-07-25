// js/admin-vendor-management.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';

// NOTE: mirrors course.js's inline Firebase init since this project's shared
// firebase-config.js exports weren't available to confirm against.
const firebaseConfig = {
    apiKey: "AIzaSyAATExPAdi27kKvuvU0ujf6f2QqR8JWwTg",
    authDomain: "tech-wizards-academy.firebaseapp.com",
    projectId: "tech-wizards-academy",
    storageBucket: "tech-wizards-academy.firebasestorage.app",
    messagingSenderId: "155089680506",
    appId: "1:155089680506:web:bd1909e4cc8e85b09663c3",
    measurementId: "G-1JCG9GLV37"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let allProducts = [];   // raw vendorProducts docs, cached for both tabs
let vendorSummaries = []; // aggregated per-vendor view built from allProducts + vendors/{uid}

// ====================================================================
// MOBILE SIDEBAR TOGGLE (self-contained — no external nav script)
// ====================================================================
const sidebarPanel = document.getElementById('sidebar-panel');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');

function openSidebar() {
    sidebarPanel.classList.add('sidebar-open');
    sidebarOverlay.classList.add('visible');
    sidebarToggleBtn.classList.add('active');
}
function closeSidebar() {
    sidebarPanel.classList.remove('sidebar-open');
    sidebarOverlay.classList.remove('visible');
    sidebarToggleBtn.classList.remove('active');
}
sidebarToggleBtn.addEventListener('click', () => {
    sidebarPanel.classList.contains('sidebar-open') ? closeSidebar() : openSidebar();
});
sidebarOverlay.addEventListener('click', closeSidebar);

// ====================================================================
// TAB SWITCHING
// ====================================================================
document.querySelectorAll('.nav-item-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.tab;
        document.querySelectorAll('.nav-item-btn[data-tab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.dashboard-section-card').forEach((section) => {
            section.classList.toggle('active-tab', section.id === targetId);
        });
        closeSidebar(); // in case a mobile user tapped a nav item while the drawer was open
    });
});

// ====================================================================
// AUTH GUARD — requires role === 'admin' on the user doc
// ====================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/sign-in.html';
        return;
    }
    currentUser = user;

    try {
        const userDoc = await getDoc(doc(db, 'user', user.uid));
        const role = userDoc.exists() ? userDoc.data().role : null;

        if (role !== 'admin') {
            document.getElementById('access-denied').classList.remove('hidden');
            return;
        }

        document.getElementById('admin-avatar-slot').textContent = (user.email || 'A').charAt(0).toUpperCase();
        document.getElementById('admin-display-email').textContent = user.email || 'Admin Account';
        document.getElementById('dashboard-content').classList.remove('hidden');

        loadData();

    } catch (err) {
        console.error('Admin auth check failed:', err);
        document.getElementById('access-denied').classList.remove('hidden');
    }
});

document.getElementById('admin-logout-trigger').addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = '/sign-in.html';
});

// ====================================================================
// LOAD DATA
// ====================================================================
// vendorProducts is publicly readable by rule, so this reads directly from
// Firestore rather than needing a dedicated "list products" server endpoint.
// Vendor balance/suspension docs (vendors/{uid}) are admin-or-owner-only —
// readable here because isAdmin() is true for this signed-in user.
async function loadData() {
    try {
        const q = query(collection(db, 'vendorProducts'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        allProducts = [];
        snapshot.forEach((docSnap) => {
            const p = docSnap.data();
            if (p.isDeleted) return; // nothing for admin to act on here
            allProducts.push({ id: docSnap.id, ...p });
        });

        await buildVendorSummaries();
        renderVendors(vendorSummaries);
        renderProducts(allProducts);

    } catch (err) {
        console.error('loadData error:', err);
        document.getElementById('vendors-list').innerHTML = `<div class="error-state">Could not load data: ${err.message}</div>`;
        document.getElementById('products-list').innerHTML = `<div class="error-state">Could not load data: ${err.message}</div>`;
    }
}

async function buildVendorSummaries() {
    const byVendor = new Map();

    allProducts.forEach((p) => {
        if (!byVendor.has(p.vendorUid)) {
            byVendor.set(p.vendorUid, {
                vendorUid: p.vendorUid,
                vendorFirstName: p.vendorFirstName || 'Vendor',
                totalProducts: 0,
                activeProducts: 0
            });
        }
        const entry = byVendor.get(p.vendorUid);
        entry.totalProducts += 1;
        if (p.isActive) entry.activeProducts += 1;
    });

    const summaries = Array.from(byVendor.values());

    // Fetch each vendor's balance/suspension doc in parallel.
    await Promise.all(summaries.map(async (v) => {
        try {
            const vendorSnap = await getDoc(doc(db, 'vendors', v.vendorUid));
            if (vendorSnap.exists()) {
                const vd = vendorSnap.data();
                v.isSuspended = !!vd.isSuspended;
                v.pendingPayout = vd.pendingPayout || 0;
                v.totalEarned = vd.totalEarned || 0;
            } else {
                // Vendor has listed products but never added a bank account
                // or completed a sale yet — no vendors/{uid} doc exists.
                v.isSuspended = false;
                v.pendingPayout = 0;
                v.totalEarned = 0;
            }
        } catch (err) {
            console.warn(`Could not load vendor doc for ${v.vendorUid}:`, err.message);
            v.isSuspended = false;
            v.pendingPayout = 0;
            v.totalEarned = 0;
        }
    }));

    vendorSummaries = summaries;
}

// ====================================================================
// RENDER: VENDORS TAB
// ====================================================================
function renderVendors(vendors) {
    const container = document.getElementById('vendors-list');

    if (!vendors.length) {
        container.innerHTML = '<div class="empty-state">No vendors yet.</div>';
        return;
    }

    const rows = vendors.map((v) => {
        const statusBadge = v.isSuspended
            ? '<span class="status-badge suspended">Suspended</span>'
            : '<span class="status-badge active">Active</span>';
        const actionLabel = v.isSuspended ? 'Reactivate' : 'Suspend';

        return `
            <tr>
                <td>${v.vendorFirstName}</td>
                <td>${v.activeProducts} / ${v.totalProducts}</td>
                <td>₦${v.pendingPayout.toLocaleString()}</td>
                <td>₦${v.totalEarned.toLocaleString()}</td>
                <td>${statusBadge}</td>
                <td><button class="btn-action" data-vendor-uid="${v.vendorUid}" data-suspend="${!v.isSuspended}">${actionLabel}</button></td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Vendor</th>
                    <th>Products (Active/Total)</th>
                    <th>Available Balance</th>
                    <th>Total Earned</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('.btn-action').forEach((btn) => {
        btn.addEventListener('click', () => toggleVendorSuspension(btn.dataset.vendorUid, btn.dataset.suspend === 'true', btn));
    });
}

async function toggleVendorSuspension(vendorUid, suspend, btn) {
    const reason = suspend ? (prompt('Reason for suspending this vendor (optional):') || '') : '';
    btn.disabled = true;

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/admin/marketplace/suspend-vendor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ vendorUid, suspend, reason })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not update vendor status');

        loadData(); // refresh both tabs since suspending a vendor cascades to their products

    } catch (err) {
        console.error('toggleVendorSuspension error:', err);
        alert('Error: ' + err.message);
        btn.disabled = false;
    }
}

// ====================================================================
// RENDER: PRODUCTS TAB
// ====================================================================
function renderProducts(products) {
    const container = document.getElementById('products-list');

    if (!products.length) {
        container.innerHTML = '<div class="empty-state">No products yet.</div>';
        return;
    }

    const rows = products.map((p) => {
        let statusBadge;
        if (p.adminSuspended) {
            statusBadge = '<span class="status-badge suspended">Admin Suspended</span>';
        } else if (p.isActive) {
            statusBadge = '<span class="status-badge active">Active</span>';
        } else {
            statusBadge = '<span class="status-badge inactive">Inactive</span>';
        }

        const actionLabel = (p.isActive && !p.adminSuspended) ? 'Suspend' : 'Reactivate';
        const nextSuspendValue = !(p.isActive && !p.adminSuspended);

        return `
            <tr data-title="${(p.title || '').toLowerCase()}" data-vendor="${(p.vendorFirstName || '').toLowerCase()}" data-status="${p.adminSuspended ? 'admin-suspended' : (p.isActive ? 'active' : 'inactive')}">
                <td>${p.title}</td>
                <td>${p.vendorFirstName || 'Vendor'}</td>
                <td>${p.category}</td>
                <td>₦${(p.price || 0).toLocaleString()}</td>
                <td>${p.type}</td>
                <td>${p.totalSales || 0}</td>
                <td>${statusBadge}</td>
                <td><button class="btn-action" data-product-id="${p.id}" data-suspend="${nextSuspendValue}">${actionLabel}</button></td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Type</th>
                    <th>Sales</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('.btn-action').forEach((btn) => {
        btn.addEventListener('click', () => toggleProductSuspension(btn.dataset.productId, btn.dataset.suspend === 'true', btn));
    });
}

async function toggleProductSuspension(productId, suspend, btn) {
    const reason = suspend ? (prompt('Reason for suspending this product (optional):') || '') : '';
    btn.disabled = true;

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/admin/marketplace/suspend-product', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ productId, suspend, reason })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not update product status');

        loadData();

    } catch (err) {
        console.error('toggleProductSuspension error:', err);
        alert('Error: ' + err.message);
        btn.disabled = false;
    }
}

// ====================================================================
// PRODUCT SEARCH / STATUS FILTER
// ====================================================================
function runProductFilter() {
    const searchTerm = document.getElementById('product-search').value.toLowerCase().trim();
    const statusValue = document.getElementById('status-filter').value;

    document.querySelectorAll('#products-list tbody tr').forEach((row) => {
        const matchesSearch = row.dataset.title.includes(searchTerm) || row.dataset.vendor.includes(searchTerm);
        const matchesStatus = statusValue === 'all' || row.dataset.status === statusValue;
        row.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
    });
}

document.getElementById('product-search').addEventListener('input', runProductFilter);
document.getElementById('status-filter').addEventListener('change', runProductFilter);