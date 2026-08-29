// js/admin-vendor-management.js

import { auth, db } from '../../../firebase-config.js';
import '../../../js/notification-center.js';
import {
    collection, collectionGroup, doc, getDoc, getDocs,
    query, where, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

let currentUser = null;
let allProducts = [];
let vendorSummaries = [];
let activeModalVendorUid = null;
let disputeSummaries = [];
let activeModalDisputeId = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// ====================================================================
// Sidebar toggle, tab-switching, and account-dropdown wiring all live in
// nav-core.js now (shared with every other dashboard page). This file
// only owns admin-vendor data: auth/role guard below, then vendor,
// product, payout, and dispute logic.
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

        const initial = (user.email || 'A').charAt(0).toUpperCase();
        const avatarSlot = document.getElementById('admin-avatar-slot');
        const headerAvatar = document.getElementById('header-admin-avatar');
        const emailEl = document.getElementById('admin-display-email');

        if (avatarSlot) avatarSlot.textContent = initial;
        if (headerAvatar) headerAvatar.textContent = initial;
        if (emailEl) emailEl.textContent = user.email || 'Admin Account';

        document.getElementById('dashboard-content').classList.remove('hidden');

        loadOverviewStats();
        await loadVendorsAndProducts();
        loadPayoutHistory();

    } catch (err) {
        console.error('Admin auth check failed:', err);
        document.getElementById('access-denied').classList.remove('hidden');
    }
});

document.getElementById('admin-logout-trigger')?.addEventListener('click', async (e) => {
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
    const tierLabels = stats.tierLabels || {};
    const tierCounts = stats.activeVendorCountByTier || {};
    const tierRevenue = stats.subscriptionRevenueByTier || {};
    const tierCard = (tierKey) =>
        '<div class="stat-card">' +
            '<span class="stat-label">' + (tierLabels[tierKey] || tierKey) + ' Vendors</span>' +
            '<span class="stat-value">' + (tierCounts[tierKey] || 0) + '</span>' +
            '<span class="stat-sub">Active · Revenue: ' + fmt(tierRevenue[tierKey] || 0) + '</span>' +
        '</div>';

    grid.innerHTML =
        '<div class="stat-card">' +
            '<span class="stat-label">Total Sales Volume</span>' +
            '<span class="stat-value">' + fmt(stats.totalVolume) + '</span>' +
            '<span class="stat-sub">' + stats.saleCount + ' order' + (stats.saleCount === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '<div class="stat-card highlight">' +
            '<span class="stat-label">Subscription Revenue</span>' +
            '<span class="stat-value">' + fmt(stats.totalSubscriptionRevenue) + '</span>' +
            '<span class="stat-sub">Successful vendor subscription payments</span>' +
        '</div>' +
        '<div class="stat-card">' +
            '<span class="stat-label">Revenue by Paid Tier</span>' +
            '<span class="stat-value">' + fmt(tierRevenue.safbloom || 0) + '</span>' +
            '<span class="stat-sub">' + (tierLabels.safbloom || 'Paid tier') + ' · ' + fmt(tierRevenue.safscale || 0) + ' ' + (tierLabels.safscale || 'Paid tier') + '</span>' +
        '</div>' +
        '<div class="stat-card">' +
            '<span class="stat-label">Most Popular Tier</span>' +
            '<span class="stat-value">' + (stats.mostPopularTier?.displayName || '—') + '</span>' +
            '<span class="stat-sub">' + (stats.mostPopularTier?.activeVendorCount || 0) + ' active vendor' + ((stats.mostPopularTier?.activeVendorCount || 0) === 1 ? '' : 's') + '</span>' +
        '</div>' +
        tierCard('safseed') + tierCard('safbloom') + tierCard('safscale') +
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
            '<span class="stat-label">Total Vendor Accounts</span>' +
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
        runVendorFilters();
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
                v.storefrontActive = vd.storefrontActive !== false;
                v.subscriptionTier = vd.subscriptionTier || 'safseed';
                v.subscriptionStatus = vd.subscriptionStatus || 'active';
                v.subscriptionExpiresAt = vd.subscriptionExpiresAt || null;
                v.subscriptionOverrideActive = vd.subscriptionOverrideActive === true;
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
    activeModalVendorUid = vendorUid;

    document.getElementById('modal-vendor-name').textContent = vendor.vendorFirstName;
    document.getElementById('modal-vendor-email').textContent = vendor.email;
    document.getElementById('modal-balance-row').innerHTML =
        '<div><span class="stat-label">Total Earned</span><span class="stat-value">' + fmt(vendor.totalEarned) + '</span></div>' +
        '<div><span class="stat-label">Available</span><span class="stat-value">' + fmt(vendor.pendingPayout) + '</span></div>' +
        '<div><span class="stat-label">Paid Out</span><span class="stat-value">' + fmt(vendor.totalPaidOut) + '</span></div>';

    document.getElementById('vendor-detail-modal').classList.remove('hidden');
    document.getElementById('modal-sales-list').innerHTML = '<div class="loading-placeholder">Loading...</div>';
    document.getElementById('modal-payouts-list').innerHTML = '<div class="loading-placeholder">Loading...</div>';
    renderModalSubscription(vendor);
    loadModalSubscriptionPayments(vendorUid);

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

        const subscriptionLapsed = p.subscriptionLapsed === true;
        const actionLabel = subscriptionLapsed && !p.adminSuspended
            ? 'Renew Required'
            : ((p.isActive && !p.adminSuspended) ? 'Suspend' : 'Reactivate');
        const nextSuspendValue = subscriptionLapsed && !p.adminSuspended
            ? 'blocked-lapsed'
            : (p.isActive && !p.adminSuspended);
        const statusKey = p.adminSuspended ? 'admin-suspended' : (subscriptionLapsed ? 'subscription-lapsed' : (p.isActive ? 'active' : 'inactive'));

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
        btn.addEventListener('click', () => {
            if (btn.dataset.suspend === 'blocked-lapsed') {
                alert('This product was deactivated because the vendor subscription lapsed. The vendor must renew before it can be reactivated.');
                return;
            }
            toggleProductSuspension(btn.dataset.productId, btn.dataset.suspend === 'true', btn);
        });
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

    const rows = document.querySelectorAll('#products-list tbody tr');
    let visible = 0;
    rows.forEach((row) => {
        const matchesSearch = row.dataset.title.indexOf(searchTerm) !== -1 || row.dataset.vendor.indexOf(searchTerm) !== -1;
        const matchesStatus = statusValue === 'all' || row.dataset.status === statusValue;
        const matched = matchesSearch && matchesStatus;
        row.style.display = matched ? '' : 'none';
        if (matched) visible += 1;
    });
    const countEl = document.getElementById('products-count');
    if (countEl) countEl.textContent = `${visible} product${visible === 1 ? '' : 's'}`;
}

function runVendorFilters() {
    const tier = document.getElementById('vendor-tier-filter')?.value || 'all';
    const account = document.getElementById('vendor-account-filter')?.value || 'all';
    const subscription = document.getElementById('vendor-subscription-filter')?.value || 'all';
    const filtered = vendorSummaries.filter((v) =>
        (tier === 'all' || (v.subscriptionTier || 'safseed') === tier) &&
        (account === 'all' || (account === 'suspended' ? v.isSuspended : !v.isSuspended)) &&
        (subscription === 'all' || (subscription === 'expired' ? v.subscriptionStatus === 'expired' : v.subscriptionStatus !== 'expired'))
    );
    renderVendors(filtered);
    const count = document.getElementById('vendors-count');
    if (count) count.textContent = `${filtered.length} vendor${filtered.length === 1 ? '' : 's'}`;
}

const auditActionLabels = {
    suspend_product: 'Suspended product',
    reactivate_product: 'Reactivated product',
    suspend_vendor: 'Suspended vendor',
    reactivate_vendor: 'Reactivated vendor',
    set_subscription_override: 'Granted subscription override',
    clear_subscription_override: 'Removed subscription override',
    add_dispute_note: 'Added internal dispute note',
    resolve_dispute: 'Resolved dispute',
    resolve_dispute_refund_failed: 'Dispute refund failed'
};

function describeAuditAction(e) {
    if (e.action === 'toggle_storefront') return e.details?.newStorefrontActive ? 'Enabled storefront' : 'Disabled storefront';
    if (e.action === 'resolve_dispute') {
        if (e.details?.resolution === 'resolved_buyer') return "Resolved dispute in buyer\u2019s favor";
        if (e.details?.resolution === 'resolved_vendor') return "Resolved dispute in vendor\u2019s favor";
        if (e.details?.resolution === 'closed') return 'Closed dispute';
    }
    return auditActionLabels[e.action] || (e.action || 'Unknown action').replace(/_/g, ' ');
}

function auditActionBadgeClass(e) {
    if (['suspend_product', 'suspend_vendor', 'resolve_dispute_refund_failed'].includes(e.action)) return 'inactive';
    if (['reactivate_product', 'reactivate_vendor', 'set_subscription_override'].includes(e.action)) return 'resolved';
    if (e.action === 'resolve_dispute') return e.details?.resolution === 'resolved_buyer' || e.details?.resolution === 'resolved_vendor' ? 'resolved' : 'dispute-closed';
    return 'open';
}

function describeAuditTarget(e) {
    const parts = [];
    if (e.vendorName) {
        const emailPart = e.vendorEmail && e.vendorEmail !== '\u2014' ? ' <span class="table-subtext">(' + escapeHtml(e.vendorEmail) + ')</span>' : '';
        parts.push(escapeHtml(e.vendorName) + emailPart);
    }
    if (e.productTitle) parts.push(escapeHtml(e.productTitle));
    if (e.disputeReference) parts.push('Order <code>' + escapeHtml(e.disputeReference) + '</code>');
    return parts.length ? parts.join(' &middot; ') : '<span class="table-subtext">\u2014</span>';
}

async function loadAuditLog(vendorUid = '') {
    const container = document.getElementById('audit-log-list');
    container.innerHTML = '<div class="loading-placeholder">Loading activity...</div>';
    try {
        const token = await currentUser.getIdToken();
        const url = '/api/admin/marketplace/get-audit-log' + (vendorUid ? '?vendorUid=' + encodeURIComponent(vendorUid) : '');
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load activity');
        if (!json.entries.length) { container.innerHTML = '<div class="empty-state">No admin activity found.</div>'; return; }
        const rows = json.entries.map((e) => {
            const d = e.createdAt && e.createdAt._seconds ? new Date(e.createdAt._seconds * 1000).toLocaleString() : (e.createdAt?.seconds ? new Date(e.createdAt.seconds * 1000).toLocaleString() : '');
            return '<tr>' +
                '<td>' + escapeHtml(e.adminEmail || e.adminUid) + '</td>' +
                '<td><span class="status-badge ' + auditActionBadgeClass(e) + '">' + escapeHtml(describeAuditAction(e)) + '</span></td>' +
                '<td>' + describeAuditTarget(e) + '</td>' +
                '<td>' + escapeHtml(d) + '</td>' +
            '</tr>';
        }).join('');
        container.innerHTML = '<table class="admin-table"><thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>Timestamp</th></tr></thead><tbody>' + rows + '</tbody></table>';
    } catch (err) { container.innerHTML = '<div class="error-state">' + err.message + '</div>'; }
}

async function loadAdminDisputes() {
    const list = document.getElementById('admin-disputes-list');
    list.innerHTML = '<div class="loading-placeholder">Loading disputes...</div>';
    try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/admin/marketplace/admin-list-disputes', { headers: { Authorization: 'Bearer ' + token } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load disputes');
        disputeSummaries = json.disputes;

        if (!disputeSummaries.length) { list.innerHTML = '<div class="empty-state">No disputes found.</div>'; return; }

        const rows = disputeSummaries.map((d) =>
            '<tr>' +
                '<td>' + escapeHtml(d.reference) + '</td>' +
                '<td>' + escapeHtml(d.buyerName) + '<span class="table-subtext">' + escapeHtml(d.buyerEmail) + '</span></td>' +
                '<td>' + escapeHtml(d.vendorName) + '<span class="table-subtext">' + escapeHtml(d.vendorEmail) + '</span></td>' +
                '<td>' + escapeHtml(d.productTitle) + '</td>' +
                '<td>' + escapeHtml(d.reason) + '</td>' +
                '<td>' + disputeStatusBadge(d.status) + '</td>' +
                '<td><button class="btn-action btn-view dispute-view-btn" data-id="' + d.id + '">View</button></td>' +
            '</tr>'
        ).join('');

        list.innerHTML =
            '<table class="admin-table"><thead><tr>' +
            '<th>Reference</th><th>Buyer</th><th>Vendor</th><th>Product</th><th>Reason</th><th>Status</th><th></th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>';

        list.querySelectorAll('.dispute-view-btn').forEach((btn) => {
            btn.addEventListener('click', () => openDisputeDetail(btn.dataset.id));
        });
    } catch (err) {
        list.innerHTML = '<div class="error-state">' + escapeHtml(err.message) + '</div>';
    }
}

function disputeStatusBadge(status) {
    if (status === 'open') return '<span class="status-badge open">Open</span>';
    if (status === 'closed') return '<span class="status-badge dispute-closed">Closed</span>';
    if (status === 'resolved_buyer' || status === 'resolved_vendor') return '<span class="status-badge resolved">Resolved</span>';
    return '<span class="status-badge inactive">' + escapeHtml(status || 'Unknown') + '</span>';
}

function ensureDisputeModal() {
    if (document.getElementById('dispute-detail-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dispute-detail-modal';
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML =
        '<div class="modal-box">' +
            '<button type="button" class="modal-close-btn" id="dispute-modal-close-btn">&times;</button>' +
            '<h2 id="dispute-modal-title"></h2>' +
            '<p class="modal-subtitle" id="dispute-modal-subtitle"></p>' +
            '<div class="modal-balance-row" id="dispute-modal-parties"></div>' +
            '<div class="dispute-statement-block" id="dispute-modal-statements"></div>' +
            '<div id="dispute-modal-banner"></div>' +
            '<h3>Internal Notes</h3>' +
            '<div class="dispute-notes-list" id="dispute-modal-notes"></div>' +
            '<textarea id="admin-dispute-note" class="dispute-textarea" placeholder="Add internal note"></textarea>' +
            '<button type="button" class="btn-action" id="admin-dispute-note-btn">Add Note</button>' +
            '<h3>Resolution</h3>' +
            '<select id="admin-dispute-resolution" class="dispute-select">' +
                '<option value="">Choose resolution</option>' +
                '<option value="resolved_buyer">Resolve for buyer (refund)</option>' +
                '<option value="resolved_vendor">Resolve for vendor</option>' +
                '<option value="closed">Close</option>' +
            '</select>' +
            '<textarea id="admin-dispute-resolution-note" class="dispute-textarea" placeholder="Resolution note"></textarea>' +
            '<button type="button" class="btn-action" id="admin-dispute-resolve-btn">Apply Resolution</button>' +
        '</div>';
    document.body.appendChild(overlay);

    document.getElementById('dispute-modal-close-btn').addEventListener('click', closeDisputeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target.id === 'dispute-detail-modal') closeDisputeModal();
    });
}

function closeDisputeModal() {
    const overlay = document.getElementById('dispute-detail-modal');
    if (overlay) overlay.classList.add('hidden');
    activeModalDisputeId = null;
}

function openDisputeDetail(disputeId) {
    const dispute = disputeSummaries.find((d) => d.id === disputeId);
    if (!dispute) return;
    ensureDisputeModal();
    activeModalDisputeId = disputeId;
    renderDisputeModalContent(dispute);
    document.getElementById('dispute-detail-modal').classList.remove('hidden');
}

function disputeHoldLabel(d) {
    if (!d.holdApplied) return 'No hold applied (storefront complaint)';
    const amount = '\u20a6' + Number(d.holdAmount || 0).toLocaleString();
    if (d.status === 'resolved_buyer') return amount + ' forfeited (deducted from vendor balance)';
    if (d.holdReleased) return amount + ' released back to vendor';
    return amount + ' held pending resolution';
}

function renderDisputeModalContent(d) {
    document.getElementById('dispute-modal-title').textContent = d.reference;
    document.getElementById('dispute-modal-subtitle').textContent = 'Reason: ' + (d.reason || '\u2014');

    document.getElementById('dispute-modal-parties').innerHTML =
        '<div><span class="stat-label">Buyer</span><span class="stat-value dispute-party-name">' + escapeHtml(d.buyerName) + '</span><span class="table-subtext">' + escapeHtml(d.buyerEmail) + '</span></div>' +
        '<div><span class="stat-label">Vendor</span><span class="stat-value dispute-party-name">' + escapeHtml(d.vendorName) + '</span><span class="table-subtext">' + escapeHtml(d.vendorEmail) + '</span></div>' +
        '<div><span class="stat-label">Product</span><span class="stat-value dispute-party-name">' + escapeHtml(d.productTitle) + '</span></div>';

    document.getElementById('dispute-modal-statements').innerHTML =
        '<p><strong>Buyer statement:</strong> ' + escapeHtml(d.buyerStatement) + '</p>' +
        '<p><strong>Vendor statement:</strong> ' + escapeHtml(d.vendorStatement || 'No response yet') + '</p>' +
        '<p><strong>Refund:</strong> ' + escapeHtml(d.refundStatus || 'Not applicable') + '</p>' +
        '<p><strong>Vendor payout hold:</strong> ' + escapeHtml(disputeHoldLabel(d)) + '</p>';

    document.getElementById('dispute-modal-banner').innerHTML = '';

    const notesContainer = document.getElementById('dispute-modal-notes');
    const notes = d.adminNotes || [];
    notesContainer.innerHTML = notes.length
        ? notes.map((n) => '<div class="dispute-note-item">' + escapeHtml(n.note) + '<small>' + escapeHtml(n.adminUid) + '</small></div>').join('')
        : '<div class="empty-state dispute-notes-empty">No notes yet.</div>';

    const noteInput = document.getElementById('admin-dispute-note');
    const resolutionSelect = document.getElementById('admin-dispute-resolution');
    const resolutionNoteInput = document.getElementById('admin-dispute-resolution-note');
    const resolveBtn = document.getElementById('admin-dispute-resolve-btn');
    const noteBtn = document.getElementById('admin-dispute-note-btn');

    noteInput.value = '';
    resolutionSelect.value = '';
    resolutionNoteInput.value = '';

    const isClosed = !['open', 'investigating'].includes(d.status);
    resolutionSelect.disabled = isClosed;
    resolutionNoteInput.disabled = isClosed;
    resolveBtn.disabled = isClosed;
    if (isClosed) {
        document.getElementById('dispute-modal-banner').innerHTML =
            '<div class="dispute-banner success">This dispute is already ' + escapeHtml(String(d.status).replace('_', ' ')) + '.</div>';
    }

    noteBtn.onclick = async () => {
        const note = noteInput.value.trim();
        if (!note) return;
        noteBtn.disabled = true;
        try {
            await adminPost('add-dispute-note', { disputeId: d.id, note });
            await refreshOpenDispute();
        } catch (err) {
            document.getElementById('dispute-modal-banner').innerHTML = '<div class="dispute-banner error">' + escapeHtml(err.message) + '</div>';
        } finally {
            noteBtn.disabled = false;
        }
    };

    resolveBtn.onclick = async () => {
        const resolution = resolutionSelect.value;
        if (!resolution) return;
        resolveBtn.disabled = true;
        document.getElementById('dispute-modal-banner').innerHTML = '';
        try {
            await adminPost('resolve-dispute', {
                disputeId: d.id,
                resolution,
                resolutionNote: resolutionNoteInput.value.trim()
            });
            await refreshOpenDispute();
        } catch (err) {
            document.getElementById('dispute-modal-banner').innerHTML = '<div class="dispute-banner error">' + escapeHtml(err.message) + '</div>';
            resolveBtn.disabled = false;
        }
    };
}

async function refreshOpenDispute() {
    const id = activeModalDisputeId;
    await loadAdminDisputes();
    if (id) openDisputeDetail(id);
}

function dateLabel(value) {
    if (!value) return 'Not set';
    const seconds = value.seconds ?? value._seconds;
    const date = seconds ? new Date(seconds * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleDateString();
}

function renderModalSubscription(vendor) {
    const storefrontStatus = vendor.storefrontActive !== false ? 'Active' : 'Deactivated';
    document.getElementById('modal-storefront-status').innerHTML = '<div><span class="stat-label">Visibility</span><span class="stat-value">' + storefrontStatus + '</span></div>';
    const storefrontBtn = document.getElementById('modal-storefront-toggle-btn');
    storefrontBtn.textContent = vendor.storefrontActive !== false ? 'Deactivate Storefront' : 'Reactivate Storefront';
    storefrontBtn.dataset.active = String(vendor.storefrontActive !== false);
    document.getElementById('modal-subscription-summary').innerHTML =
        '<div><span class="stat-label">Tier</span><span class="stat-value">' + vendor.subscriptionTier + '</span></div>' +
        '<div><span class="stat-label">Status</span><span class="stat-value">' + vendor.subscriptionStatus + '</span></div>' +
        '<div><span class="stat-label">Expires</span><span class="stat-value">' + dateLabel(vendor.subscriptionExpiresAt) + '</span></div>' +
        '<div><span class="stat-label">Override</span><span class="stat-value">' + (vendor.subscriptionOverrideActive ? 'On' : 'Off') + '</span></div>';
    document.getElementById('modal-grant-override-btn').disabled = vendor.subscriptionOverrideActive;
    document.getElementById('modal-clear-override-btn').disabled = !vendor.subscriptionOverrideActive;
}

async function loadModalSubscriptionPayments(vendorUid) {
    const container = document.getElementById('modal-subscription-payments');
    try {
        const snap = await getDocs(query(collection(db, 'vendors', vendorUid, 'subscriptionPayments'), orderBy('createdAt', 'desc')));
        const payments = []; snap.forEach((d) => payments.push(Object.assign({ id: d.id }, d.data())));
        if (!payments.length) { container.innerHTML = '<div class="empty-state">No subscription payments yet.</div>'; return; }
        const maskReference = (value) => { const s = String(value || ''); return s.length > 8 ? s.slice(0, 4) + '****' + s.slice(-4) : '********'; };
        const rows = payments.map((p) => '<tr><td>' + (p.tier || '—') + '</td><td>' + fmt(p.amount) + '</td><td>' + (p.billingCycle || '—') + '</td><td>' + (p.status || '—') + '</td><td>' + dateLabel(p.createdAt) + '</td><td>' + (p.reference || p.id) + '</td></tr>').join('');
        container.innerHTML = '<table class="admin-table"><thead><tr><th>Tier</th><th>Amount</th><th>Cycle</th><th>Status</th><th>Date</th><th>Reference</th></tr></thead><tbody>' + rows + '</tbody></table>';
    } catch (err) { container.innerHTML = '<div class="error-state">' + err.message + '</div>'; }
}

async function adminPost(action, body) {
    const idToken = await currentUser.getIdToken();
    const res = await fetch('/api/admin/marketplace/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(body) });
    const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Admin action failed'); return json;
}

document.getElementById('modal-storefront-toggle-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget; 
    button.disabled = true;
    
    // Explicit toggle check: if active === 'true', next state is false (deactivate); otherwise true (reactivate)
    const nextState = button.dataset.active !== 'true';

    try { 
        await adminPost('toggle-storefront', { 
            vendorUid: activeModalVendorUid, 
            storefrontActive: nextState 
        }); 
        await refreshOpenVendor(); 
    } catch (err) { 
        alert('Error: ' + err.message); 
        button.disabled = false; 
    }
});

async function setOverride(overrideActive, button) {
    button.disabled = true;
    try { await adminPost('set-subscription-override', { vendorUid: activeModalVendorUid, overrideActive }); await refreshOpenVendor(); }
    catch (err) { alert('Error: ' + err.message); button.disabled = false; }
}
document.getElementById('modal-grant-override-btn').addEventListener('click', (e) => setOverride(true, e.currentTarget));
document.getElementById('modal-clear-override-btn').addEventListener('click', (e) => setOverride(false, e.currentTarget));

async function refreshOpenVendor() {
    const uid = activeModalVendorUid;
    await loadVendorsAndProducts();
    if (uid) openVendorDetail(uid);
}

document.getElementById('subscription-reference-lookup-btn').addEventListener('click', async () => {
    const input = document.getElementById('subscription-reference-input');
    const result = document.getElementById('subscription-reference-result');
    const reference = input.value.trim();
    if (!reference) { result.innerHTML = '<div class="error-state">Enter a payment reference.</div>'; return; }
    result.innerHTML = '<div class="loading-placeholder">Looking up payment...</div>';
    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/admin/marketplace/lookup-subscription-payment?reference=' + encodeURIComponent(reference), { headers: { Authorization: 'Bearer ' + idToken } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not find payment');
        const payment = json.payment;
        const vendor = vendorSummaries.find((v) => v.vendorUid === json.vendorUid);
        const vendorLabel = vendor ? vendor.vendorFirstName + ' (' + vendor.email + ')' : json.vendorUid;
        result.innerHTML = '<div class="payment-lookup-result"><strong>' + vendorLabel + '</strong><span>' + (payment.tier || '—') + ' | ' + fmt(payment.amount) + ' | ' + (payment.billingCycle || '—') + ' | ' + (payment.status || '—') + ' | ' + dateLabel(payment.createdAt) + '</span><code>' + (payment.reference || payment.id) + '</code><button type="button" class="btn-action" id="lookup-open-vendor-btn">Open Vendor</button></div>';
        document.getElementById('lookup-open-vendor-btn').addEventListener('click', () => openVendorDetail(json.vendorUid));
    } catch (err) { result.innerHTML = '<div class="error-state">' + err.message + '</div>'; }
});
document.getElementById('product-search').addEventListener('input', runProductFilter);
document.getElementById('status-filter').addEventListener('change', runProductFilter);
document.getElementById('vendor-tier-filter')?.addEventListener('change', runVendorFilters);
document.getElementById('vendor-account-filter')?.addEventListener('change', runVendorFilters);
document.getElementById('vendor-subscription-filter')?.addEventListener('change', runVendorFilters);
document.getElementById('audit-filter-btn')?.addEventListener('click', () => loadAuditLog(document.getElementById('audit-vendor-filter').value.trim()));
document.getElementById('audit-clear-btn')?.addEventListener('click', () => { document.getElementById('audit-vendor-filter').value = ''; loadAuditLog(); });
document.querySelector('.page-tab[data-tab="activity-pane"]')?.addEventListener('click', () => loadAuditLog());
document.querySelector('.page-tab[data-tab="disputes-pane"]')?.addEventListener('click', loadAdminDisputes);

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
        const vendorLabel = vendor
            ? escapeHtml(vendor.email || vendor.vendorFirstName || 'Unnamed vendor') + (vendor.vendorFirstName ? ' <span class="table-subtext">' + escapeHtml(vendor.vendorFirstName) + '</span>' : '')
            : '<span class="table-subtext">Unknown vendor (' + escapeHtml(p.vendorUid) + ')</span>';

        return '<tr>' +
            '<td>' + vendorLabel + '</td>' +
            '<td>' + fmt(p.amount) + '</td>' +
            '<td>' + statusBadgeFor(p.status) + '</td>' +
            '<td>' + date + '</td>' +
            '<td>' + escapeHtml(p.failureReason || '\u2014') + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
        '<table class="admin-table"><thead><tr><th>Vendor</th><th>Amount</th><th>Status</th><th>Date</th><th>Failure Reason</th></tr></thead><tbody>' + rows + '</tbody></table>';
}