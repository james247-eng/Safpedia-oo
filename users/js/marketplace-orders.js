// users/js/marketplace-orders.js

import { auth, db } from '../../firebase-config.js';
import '../../js/notification-center.js';
import { collectionGroup, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

let currentUser = null;
let disputesByReference = new Map();
let activeDisputeReference = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const disputeStatusLabels = {
    open: 'Under review',
    investigating: 'Vendor responded — awaiting decision',
    resolved_buyer: 'Resolved in your favor',
    resolved_vendor: "Resolved in vendor's favor",
    closed: 'Closed'
};

// ====================================================================
// AUTH GUARD
// ====================================================================
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = '/sign-in.html';
        return;
    }
    currentUser = user;

    const avatarEl = document.getElementById('buyer-avatar-slot');
    const emailEl = document.getElementById('buyer-display-email');
    if (avatarEl) avatarEl.textContent = (user.email || 'U').charAt(0).toUpperCase();
    if (emailEl) emailEl.textContent = user.email || 'Student Account';

    loadOrders();
});

document.getElementById('buyer-logout-trigger')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = '/sign-in.html';
});

// ====================================================================
// LOAD ORDERS
// ====================================================================
async function loadOrders() {
    const container = document.getElementById('orders-list');
    try {
        const q = query(
            collectionGroup(db, 'sales'),
            where('buyerUid', '==', currentUser.uid),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);

        const orders = [];
        snapshot.forEach((docSnap) => {
            orders.push({ id: docSnap.id, ...docSnap.data() });
        });

        try {
            await loadDisputes();
        } catch (disputeError) {
            console.warn('Could not load existing disputes:', disputeError);
            disputesByReference = new Map();
        }
        renderOrders(orders);
    } catch (err) {
        console.error('loadOrders error:', err);
        container.innerHTML = `<div class="error-state">Could not load your orders: ${escapeHtml(err.message)}</div>`;
    }
}

function renderOrders(orders) {
    const container = document.getElementById('orders-list');

    if (!orders || orders.length === 0) {
        container.innerHTML = `
          <div class="empty-state-block">
            <div class="empty-icon"><ion-icon name="bag-handle-outline"></ion-icon></div>
            <h3>No marketplace orders yet</h3>
            <p>Anything you buy from a SAFpedia vendor's storefront will show up here.</p>
            <a href="../marketplace.html" class="btn btn-primary"><ion-icon name="storefront-outline"></ion-icon> Browse the Marketplace</a>
          </div>
        `;
        return;
    }

    const rows = orders.map((o) => {
        const date = o.createdAt && o.createdAt.seconds
            ? new Date(o.createdAt.seconds * 1000).toLocaleDateString()
            : '';

        let actionCell;
        if (o.productType === 'digital') {
            actionCell = o.fulfillmentStatus === 'available'
                ? `<button type="button" class="btn btn-sm btn-secondary download-btn" data-product-id="${escapeHtml(o.productId)}" data-reference="${escapeHtml(o.reference)}">Download</button>`
                : `<span class="order-status-text">Status: ${escapeHtml(o.fulfillmentStatus || 'unknown')}</span>`;
        } else {
            const tracking = o.trackingNumber
                ? ` (${escapeHtml(o.carrier || 'carrier')}: ${escapeHtml(o.trackingNumber)})`
                : '';
            actionCell = `<span class="order-status-text">${escapeHtml(o.fulfillmentStatus || 'pending_shipment')}${tracking}</span>`;
        }

        const dispute = disputesByReference.get(o.reference);
        const disputeAction = dispute
            ? `<button type="button" class="btn btn-sm btn-secondary view-dispute-btn" data-reference="${escapeHtml(o.reference)}" title="View dispute details">View</button>`
            : `<button type="button" class="btn btn-sm btn-secondary dispute-btn" data-reference="${escapeHtml(o.reference)}">Report a problem</button>`;

        return `
            <tr>
                <td>${escapeHtml(o.productTitle)}</td>
                <td>${escapeHtml(o.quantity)}</td>
                <td>₦${(o.amount || 0).toLocaleString()}</td>
                <td>${escapeHtml(o.productType)}</td>
                <td>${escapeHtml(date)}</td>
                <td>
                    <div class="order-action-stack">
                        ${actionCell}
                        ${disputeAction}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="data-table-frame">
            <thead>
                <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Amount Paid</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Status / Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('.download-btn').forEach((btn) => {
        btn.addEventListener('click', () => getDownloadLink(btn.dataset.productId, btn.dataset.reference, btn));
    });
    container.querySelectorAll('.dispute-btn').forEach((btn) => {
        btn.addEventListener('click', () => openDisputeModal(btn.dataset.reference));
    });
    container.querySelectorAll('.view-dispute-btn').forEach((btn) => {
        btn.addEventListener('click', () => openDisputeDetailsModal(btn.dataset.reference));
    });
}

// ====================================================================
// DISPUTES
// ====================================================================
async function authedFetch(url, options = {}) {
    const token = await currentUser.getIdToken();
    options.headers = Object.assign({}, options.headers, {
        Authorization: `Bearer ${token}`
    });
    return fetch(url, options);
}

async function loadDisputes() {
    const res = await authedFetch('/api/disputes/list-disputes');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not load disputes');
    disputesByReference = new Map(json.disputes.map((d) => [d.reference, d]));
}

function lockBodyScroll(lock) {
    document.body.style.overflow = lock ? 'hidden' : '';
}

function closeDisputeModal() {
    const modal = document.getElementById('dispute-modal');
    if (modal) modal.classList.add('hidden');
    lockBodyScroll(false);
}

function closeDisputeDetailsModal() {
    const modal = document.getElementById('dispute-details-modal');
    if (modal) modal.classList.add('hidden');
    lockBodyScroll(false);
}

function openDisputeModal(reference) {
    activeDisputeReference = reference;
    const form = document.getElementById('dispute-form');
    const message = document.getElementById('dispute-form-message');
    const modal = document.getElementById('dispute-modal');
    if (!form || !modal) return;

    form.reset();
    if (message) {
        message.textContent = '';
        message.className = 'modal-form-message';
    }
    modal.classList.remove('hidden');
    lockBodyScroll(true);
}

function openDisputeDetailsModal(reference) {
    const dispute = disputesByReference.get(reference);
    if (!dispute) return;

    const modal = document.getElementById('dispute-details-modal');
    const content = document.getElementById('dispute-details-content');
    if (!modal || !content) return;

    const status = dispute.status || 'open';
    const statusLabel = disputeStatusLabels[status] || 'Status unavailable';
    const isResolved = ['resolved_buyer', 'resolved_vendor', 'closed'].includes(status);
    const resolution = dispute.resolution || '';
    const refundFailed = dispute.refundStatus === 'failed' || String(resolution).startsWith('refund_failed');
    const publicResolution = String(resolution).startsWith('refund_failed') ? '' : resolution;

    let refundLine = '';
    if (isResolved) {
        if (dispute.refundStatus === 'triggered') {
            refundLine = 'A refund has been issued to your original payment method.';
        } else if (dispute.refundStatus === 'not_applicable') {
            refundLine = 'No refund applies to this resolution.';
        } else if (refundFailed) {
            refundLine = 'A refund was approved but could not be processed automatically. Our team will contact you to complete it manually.';
        }
    }

    const statusClass = {
        open: 'status-open',
        investigating: 'status-investigating',
        resolved_buyer: 'status-resolved-buyer',
        resolved_vendor: 'status-resolved-vendor',
        closed: 'status-closed'
    }[status] || 'status-open';

    content.innerHTML = `
        <div class="dispute-details-header">
            <span class="dispute-status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
            <p class="dispute-ref">Order ref: <code>${escapeHtml(dispute.reference || '—')}</code></p>
        </div>

        <div class="dispute-details-grid">
            <div class="dispute-field">
                <span class="dispute-field-label">Reason</span>
                <p class="dispute-field-value">${escapeHtml(dispute.reason || 'Not provided')}</p>
            </div>
            <div class="dispute-field">
                <span class="dispute-field-label">Your statement</span>
                <p class="dispute-field-value">${escapeHtml(dispute.buyerStatement || 'Not provided')}</p>
            </div>
            <div class="dispute-field">
                <span class="dispute-field-label">Vendor response</span>
                <p class="dispute-field-value">${escapeHtml(dispute.vendorStatement || 'No response yet')}</p>
            </div>
            ${isResolved && publicResolution ? `
            <div class="dispute-field">
                <span class="dispute-field-label">Resolution</span>
                <p class="dispute-field-value">${escapeHtml(publicResolution)}</p>
            </div>` : ''}
            ${refundLine ? `
            <div class="dispute-field">
                <span class="dispute-field-label">Refund</span>
                <p class="dispute-field-value">${escapeHtml(refundLine)}</p>
            </div>` : ''}
        </div>
    `;

    modal.classList.remove('hidden');
    lockBodyScroll(true);
}

document.getElementById('dispute-modal-close')?.addEventListener('click', closeDisputeModal);
document.getElementById('dispute-modal-cancel')?.addEventListener('click', closeDisputeModal);
document.getElementById('dispute-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeDisputeModal();
});

document.getElementById('dispute-details-close')?.addEventListener('click', closeDisputeDetailsModal);
document.getElementById('dispute-details-done')?.addEventListener('click', closeDisputeDetailsModal);
document.getElementById('dispute-details-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeDisputeDetailsModal();
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeDisputeModal();
    closeDisputeDetailsModal();
});

document.getElementById('dispute-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('dispute-form-message');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (!button) return;

    button.disabled = true;
    if (message) {
        message.textContent = '';
        message.className = 'modal-form-message';
    }

    try {
        const res = await authedFetch('/api/disputes/create-dispute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reference: activeDisputeReference,
                reason: document.getElementById('dispute-reason').value,
                buyerStatement: document.getElementById('dispute-statement').value
            })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not create dispute');

        closeDisputeModal();
        await loadOrders();
    } catch (err) {
        if (message) {
            message.textContent = err.message;
            message.className = 'modal-form-message is-error';
        }
    } finally {
        button.disabled = false;
    }
});

// ====================================================================
// DOWNLOAD LINK
// ====================================================================
async function getDownloadLink(productId, reference, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing...';

    try {
        const idToken = await currentUser.getIdToken();
        const res = await fetch('/api/marketplace/get-download-link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ productId, reference })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not get download link');

        window.open(json.downloadUrl, '_blank');
    } catch (err) {
        console.error('getDownloadLink error:', err);
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}