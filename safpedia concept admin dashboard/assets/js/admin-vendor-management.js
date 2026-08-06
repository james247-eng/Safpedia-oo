// js/admin-vendor-management.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
    getFirestore, collection, collectionGroup, doc, getDoc, getDocs,
    query, where, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

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

let currentUser = null;
let allProducts = [];
let vendorSummaries = [];

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

document.querySelectorAll('.nav-item-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.tab;
        document.querySelectorAll('.nav-item-btn[data-tab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.dashboard-section-card').forEach((section) => {
            section.classList.toggle('active-tab', section.id === targetId);
        });
        closeSidebar();
    });
});

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

        loadOverviewStats();
        loadVendorsAndProducts();
        loadPayoutHistory();

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

async function loadOverviewStats() {
    const grid = document.getElementById('stats-grid');
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/admin/marketplace/get-platform-stats', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + idToken }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load platform stats');

        renderOverviewStats(json);
    } catch (err) {
        console.error('loadOverviewStats error:', err);
        grid.innerHTML = '<div class="error-state">Could not load platform stats: ' + err.message + '</div>';
    }
}

function renderOverviewStats(stats) {
    const grid = document.getElementById('stats-grid');
    const vendorPayableTotal = stats.totalVolume - stats.totalCommission;

    grid.innerHTML =
        '<div class="stat-card">' +
            '<span class="stat-label">Total Sales Volume</span>' +
            '<span class="stat-value">' + fmt(stats.totalVolume) + '</span>' +
            '<span class="stat-sub">' + stats.saleCount + ' order' + (stats.saleCount === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '<div class="stat-card highlight">' +
            '<span class="stat-label">Platform Commission Earned</span>' +
            '<span class="stat-value">' + fmt(stats.totalCommission) + '</span>' +
            '<span class="stat-sub">Vendors\' cut: ' + fmt(vendorPayableTotal) + '</span>' +
        '</div>' +
        '<div class="stat-card">' +
            '<span class="stat-label">Total Paid Out to Vendors</span>' +
            '<span class="stat-value">' + fmt(stats.totalPaidOut) + '</span>' +
        '</div>' +
        '<div class="stat-card">' +
            '<span class="stat-label">Awaiting Payout Confirmation</span>' +
            '<span class="stat-value">' + fmt(stats.totalAwaitingPayout) + '</span>' +
            '<span class="stat-sub">Transfers Paystack hasn\'t confirmed yet</span>' +
        '</div>' +
        '<div class="stat-card">' +
            '<span class="stat-label">Owed to Vendors (Unpaid Balance)</span>' +
            '<span class="stat-value">' + fmt(stats.totalPendingPayout) + '</span>' +
            '<span class="stat-sub">Available for vendors to withdraw</span>' +
        '</div>' +
        '<div class="stat-card">' +
            '<span class="stat-label">Vendors With Payout Setup</span>' +
            '<span class="stat-value">' + stats.vendorCount + '</span>' +
        '</div>';
}

function fmt(n) {
    return '\u20A6' + (n || 0).toLocaleString();
}

async function loadVendorsAndProducts() {
    try {
        const productsSnap = await getDocs(query(collection(db, 'vendorProducts'), orderBy('createdAt', 'desc')));

        allProducts = [];
        productsSnap.forEach((docSnap) => {
            const p = docSnap.data();
            if (p.isDeleted) return;
            allProducts.push(Object.assign({ id: docSnap.id }, p));
        });

        await buildVendorSummaries();
        renderVendors(vendorSummaries);
        renderProducts(allProducts);

    } catch (err) {
        console.error('loadVendorsAndProducts error:', err);
        document.getElementById('vendors-list').innerHTML = '<div class="error-state">Could not load data: ' + err.message + '</div>';
        document.getElementById('products-list').innerHTML = '<div class="error-state">Could not load data: ' + err.message + '</div>';
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

    try {
        const vendorsSnap = await getDocs(collection(db, 'vendors'));
        vendorsSnap.forEach((docSnap) => {
            if (!byVendor.has(docSnap.id)) {
                byVendor.set(docSnap.id, {
                    vendorUid: docSnap.id,
                    vendorFirstName: 'Vendor',
                    totalProducts: 0,
                    activeProducts: 0
                });
            }
        });
    } catch (err) {
        console.warn('Could not load full vendors collection:', err.message);
    }

    const summaries = Array.from(byVendor.values());

    await Promise.all(summaries.map(async (v) => {
        try {
            const vendorSnap = await getDoc(doc(db, 'vendors', v.vendorUid));
            if (vendorSnap.exists()) {
                const vd = vendorSnap.data();
                v.isSuspended = !!vd.isSuspended;
                v.pendingPayout = vd.pendingPayout || 0;
                v.awaitingPayout = vd.awaitingPayout || 0;
                v.totalEarned = vd.totalEarned || 0;
                v.totalPaidOut = vd.totalPaidOut || 0;
            } else {
                v.isSuspended = false;
                v.pendingPayout = 0;
                v.awaitingPayout = 0;
                v.totalEarned = 0;
                v.totalPaidOut = 0;
            }
        } catch (err) {
            v.isSuspended = false;
            v.pendingPayout = 0;
            v.awaitingPayout = 0;
            v.totalEarned = 0;
            v.totalPaidOut = 0;
        }

        try {
            const userSnap = await getDoc(doc(db, 'user', v.vendorUid));
            v.email = userSnap.exists() ? (userSnap.data().email || '\u2014') : '\u2014';
        } catch (err) {
            v.email = '\u2014';
        }
    }));

    vendorSummaries = summaries;
}

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

        return '<tr>' +
            '<td>' + v.vendorFirstName + '</td>' +
            '<td>' + v.email + '</td>' +
            '<td>' + v.activeProducts + ' / ' + v.totalProducts + '</td>' +
            '<td>' + fmt(v.totalEarned) + '</td>' +
            '<td>' + fmt(v.pendingPayout) + '</td>' +
            '<td>' + fmt(v.totalPaidOut) + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td class="action-cell">' +
                '<button class="btn-action" data-vendor-uid="' + v.vendorUid + '" data-suspend="' + (!v.isSuspended) + '">' + actionLabel + '</button>' +
                '<button class="btn-action btn-view" data-view-vendor="' + v.vendorUid + '">View</button>' +
            '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
        '<table class="admin-table"><thead><tr>' +
        '<th>Vendor</th><th>Email</th><th>Products (Active/Total)</th><th>Total Earned</th>' +
        '<th>Available Balance</th><th>Total Paid Out</th><th>Status</th><th>Action</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';

    container.querySelectorAll('.btn-action[data-vendor-uid]').forEach((btn) => {
        btn.addEventListener('click', () => toggleVendorSuspension(btn.dataset.vendorUid, btn.dataset.suspend === 'true', btn));
    });
    container.querySelectorAll('.btn-view[data-view-vendor]').forEach((btn) => {
        btn.addEventListener('click', () => openVendorDetail(btn.dataset.viewVendor));
    });
}

async function toggleVendorSuspension(vendorUid, suspend, btn) {
    const reason = suspend ? (prompt('Reason for suspending this vendor (optional):') || '') : '';
    btn.disabled = true;

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/admin/marketplace/suspend-vendor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({ vendorUid: vendorUid, suspend: suspend, reason: reason })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not update vendor status');

        loadVendorsAndProducts();
        loadOverviewStats();

    } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
    }
}

async function openVendorDetail(vendorUid) {
    const vendor = vendorSummaries.find((v) => v.vendorUid === vendorUid);
    if (!vendor) return;

    document.getElementById('modal-vendor-name').textContent = vendor.vendorFirstName;
    document.getElementById('modal-vendor-email').textContent = vendor.email;
    document.getElementById('modal-balance-row').innerHTML =
        '<div><span class="stat-label">Total Earned</span><span class="stat-value">' + fmt(vendor.totalEarned) + '</span></div>' +
        '<div><span class="stat-label">Available</span><span class="stat-value">' + fmt(vendor.pendingPayout) + '</span></div>' +
        '<div><span class="stat-label">Paid Out</span><span class="stat-value">' + fmt(vendor.totalPaidOut) + '</span></div>';

    document.getElementById('vendor-detail-modal').classList.remove('hidden');
    document.getElementById('modal-sales-list').innerHTML = '<div class="loading-placeholder">Loading...</div>';
    document.getElementById('modal-payouts-list').innerHTML = '<div class="loading-placeholder">Loading...</div>';

    try {
        const salesSnap = await getDocs(query(
            collectionGroup(db, 'sales'),
            where('vendorUid', '==', vendorUid),
            orderBy('createdAt', 'desc'),
            limit(20)
        ));
        const sales = [];
        salesSnap.forEach((d) => sales.push(d.data()));
        renderModalSales(sales);
    } catch (err) {
        document.getElementById('modal-sales-list').innerHTML = '<div class="error-state">' + err.message + '</div>';
    }

    try {
        const payoutsSnap = await getDocs(query(
            collection(db, 'vendors', vendorUid, 'vendorPayoutRequests'),
            orderBy('createdAt', 'desc'),
            limit(20)
        ));
        const payouts = [];
        payoutsSnap.forEach((d) => payouts.push(d.data()));
        renderModalPayouts(payouts);
    } catch (err) {
        document.getElementById('modal-payouts-list').innerHTML = '<div class="error-state">' + err.message + '</div>';
    }
}

function renderModalSales(sales) {
    const container = document.getElementById('modal-sales-list');
    if (!sales.length) {
        container.innerHTML = '<div class="empty-state">No sales yet.</div>';
        return;
    }
    const rows = sales.map((s) => {
        const date = s.createdAt && s.createdAt.seconds ? new Date(s.createdAt.seconds * 1000).toLocaleDateString() : '';
        return '<tr><td>' + s.productTitle + '</td><td>' + fmt(s.amount) + '</td><td>' + fmt(s.vendorAmount) + '</td><td>' + date + '</td></tr>';
    }).join('');
    container.innerHTML = '<table class="admin-table"><thead><tr><th>Product</th><th>Sale Amount</th><th>Vendor Cut</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderModalPayouts(payouts) {
    const container = document.getElementById('modal-payouts-list');
    if (!payouts.length) {
        container.innerHTML = '<div class="empty-state">No payout requests yet.</div>';
        return;
    }
    const rows = payouts.map((p) => {
        const date = p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : '';
        return '<tr><td>' + fmt(p.amount) + '</td><td>' + statusBadgeFor(p.status) + '</td><td>' + date + '</td></tr>';
    }).join('');
    container.innerHTML = '<table class="admin-table"><thead><tr><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function statusBadgeFor(status) {
    if (status === 'paid') return '<span class="status-badge active">Paid</span>';
    if (status === 'failed') return '<span class="status-badge suspended">Failed</span>';
    return '<span class="status-badge inactive">Processing</span>';
}

document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('vendor-detail-modal').classList.add('hidden');
});
document.getElementById('vendor-detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'vendor-detail-modal') {
        document.getElementById('vendor-detail-modal').classList.add('hidden');
    }
});

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
        const statusKey = p.adminSuspended ? 'admin-suspended' : (p.isActive ? 'active' : 'inactive');

        return '<tr data-title="' + (p.title || '').toLowerCase() + '" data-vendor="' + (p.vendorFirstName || '').toLowerCase() + '" data-status="' + statusKey + '">' +
            '<td>' + p.title + '</td>' +
            '<td>' + (p.vendorFirstName || 'Vendor') + '</td>' +
            '<td>' + p.category + '</td>' +
            '<td>' + fmt(p.price) + '</td>' +
            '<td>' + p.type + '</td>' +
            '<td>' + (p.totalSales || 0) + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><button class="btn-action" data-product-id="' + p.id + '" data-suspend="' + nextSuspendValue + '">' + actionLabel + '</button></td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
        '<table class="admin-table"><thead><tr>' +
        '<th>Title</th><th>Vendor</th><th>Category</th><th>Price</th><th>Type</th><th>Sales</th><th>Status</th><th>Action</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';

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
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({ productId: productId, suspend: suspend, reason: reason })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not update product status');

        loadVendorsAndProducts();

    } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
    }
}

function runProductFilter() {
    const searchTerm = document.getElementById('product-search').value.toLowerCase().trim();
    const statusValue = document.getElementById('status-filter').value;

    document.querySelectorAll('#products-list tbody tr').forEach((row) => {
        const matchesSearch = row.dataset.title.indexOf(searchTerm) !== -1 || row.dataset.vendor.indexOf(searchTerm) !== -1;
        const matchesStatus = statusValue === 'all' || row.dataset.status === statusValue;
        row.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
    });
}
document.getElementById('product-search').addEventListener('input', runProductFilter);
document.getElementById('status-filter').addEventListener('change', runProductFilter);

async function loadPayoutHistory() {
    const container = document.getElementById('payouts-list');
    try {
        const snap = await getDocs(query(
            collectionGroup(db, 'vendorPayoutRequests'),
            orderBy('createdAt', 'desc'),
            limit(200)
        ));

        const payouts = [];
        snap.forEach((d) => payouts.push(d.data()));

        renderPayoutHistory(payouts);

    } catch (err) {
        console.error('loadPayoutHistory error:', err);
        container.innerHTML = '<div class="error-state">Could not load payout history: ' + err.message + '</div>';
    }
}

function renderPayoutHistory(payouts) {
    const container = document.getElementById('payouts-list');

    if (!payouts.length) {
        container.innerHTML = '<div class="empty-state">No payout requests yet.</div>';
        return;
    }

    const rows = payouts.map((p) => {
        const date = p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString() : '';
        const vendor = vendorSummaries.find((v) => v.vendorUid === p.vendorUid);
        const vendorLabel = vendor ? (vendor.vendorFirstName + ' (' + vendor.email + ')') : p.vendorUid;

        return '<tr>' +
            '<td>' + vendorLabel + '</td>' +
            '<td>' + fmt(p.amount) + '</td>' +
            '<td>' + statusBadgeFor(p.status) + '</td>' +
            '<td>' + date + '</td>' +
            '<td>' + (p.failureReason || '\u2014') + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
        '<table class="admin-table"><thead><tr><th>Vendor</th><th>Amount</th><th>Status</th><th>Date</th><th>Failure Reason</th></tr></thead><tbody>' + rows + '</tbody></table>';
}