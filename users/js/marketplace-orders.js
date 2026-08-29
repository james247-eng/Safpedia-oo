import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { collection, query, where, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

let currentUser = null;
let activeOrders = [];
let activeDisputesMap = new Map();
let selectedReferenceForDispute = null;

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
    setupAuthObserver();
    setupModalListeners();
});

function setupAuthObserver() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = '/login.html';
            return;
        }
        currentUser = user;
        updateUserHeader(user);
        await loadDashboardData();
    });
}

function updateUserHeader(user) {
    const avatarSlot = document.getElementById('buyer-avatar-slot');
    const emailSlot = document.getElementById('buyer-display-email');
    const logoutBtn = document.getElementById('buyer-logout-trigger');

    if (avatarSlot) {
        avatarSlot.textContent = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
    }
    if (emailSlot) {
        emailSlot.textContent = user.email || 'Student Account';
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(auth).then(() => {
                window.location.href = '/login.html';
            });
        });
    }
}

async function loadDashboardData() {
    const container = document.getElementById('orders-list');
    if (container) {
        container.innerHTML = '<div class="loading-placeholder">Loading your orders...</div>';
    }

    try {
        await Promise.all([
            fetchBuyerOrders(),
            fetchBuyerDisputes()
        ]);
        renderOrdersTable();
    } catch (error) {
        console.error('Error loading marketplace data:', error);
        if (container) {
            container.innerHTML = `<div class="error-placeholder">Failed to load orders: ${escapeHtml(error.message)}</div>`;
        }
    }
}

async function fetchBuyerOrders() {
    activeOrders = [];
    try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/marketplace/my-orders', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            activeOrders = data.orders || [];
        } else {
            // Firestore Direct Fallback if API route is not available
            const q = query(
                collection(db, 'sales'),
                where('buyerUid', '==', currentUser.uid)
            );
            const snapshot = await getDocs(q);
            snapshot.forEach(docSnap => {
                activeOrders.push({ id: docSnap.id, ...docSnap.data() });
            });
        }
    } catch (e) {
        console.warn('Falling back to Firestore client query for sales:', e.message);
        const q = query(
            collection(db, 'sales'),
            where('buyerUid', '==', currentUser.uid)
        );
        const snapshot = await getDocs(q);
        snapshot.forEach(docSnap => {
            activeOrders.push({ id: docSnap.id, ...docSnap.data() });
        });
    }
}

async function fetchBuyerDisputes() {
    activeDisputesMap.clear();
    try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/disputes/list-disputes', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data.disputes)) {
                data.disputes.forEach(dispute => {
                    if (dispute.reference) {
                        activeDisputesMap.set(dispute.reference, dispute);
                    }
                });
            }
        }
    } catch (err) {
        console.error('Failed to load disputes list:', err);
    }
}

function renderOrdersTable() {
    const container = document.getElementById('orders-list');
    if (!container) return;

    if (activeOrders.length === 0) {
        container.innerHTML = '<div class="empty-placeholder">No marketplace orders found.</div>';
        return;
    }

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>PRODUCT</th>
                    <th>QTY</th>
                    <th>AMOUNT PAID</th>
                    <th>TYPE</th>
                    <th>DATE</th>
                    <th>STATUS / ACTION</th>
                </tr>
            </thead>
            <tbody>
    `;

    activeOrders.forEach(order => {
        const ref = order.reference || order.id;
        const title = escapeHtml(order.productTitle || order.title || 'Product Item');
        const qty = order.quantity || 1;
        const amount = order.amountPaid || order.price || order.vendorAmount || 0;
        const type = escapeHtml(order.type || order.productType || 'physical');
        
        let formattedDate = 'N/A';
        if (order.createdAt) {
            if (order.createdAt._seconds) {
                formattedDate = new Date(order.createdAt._seconds * 1000).toLocaleDateString();
            } else if (typeof order.createdAt === 'string') {
                formattedDate = new Date(order.createdAt).toLocaleDateString();
            }
        }

        const orderStatus = escapeHtml(order.status || 'pending_shipment');
        const dispute = activeDisputesMap.get(ref);

        let actionColumnHtml = `
            <div class="status-cell-wrapper" style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                <span class="status-badge status-${orderStatus}">${orderStatus}</span>
        `;

        if (dispute) {
            actionColumnHtml += `
                <button 
                    type="button" 
                    class="btn-view-dispute" 
                    data-reference="${escapeHtml(ref)}"
                    style="padding: 4px 10px; font-size: 11px; font-weight:600; cursor: pointer; background-color: #2563eb; color: #ffffff; border: none; border-radius: 4px;">
                    View Dispute (${escapeHtml(dispute.status)})
                </button>
            `;
        } else {
            actionColumnHtml += `
                <button 
                    type="button" 
                    class="btn-report-issue" 
                    data-reference="${escapeHtml(ref)}"
                    style="padding: 4px 8px; font-size: 11px; cursor: pointer; background-color: #ef4444; color: #ffffff; border: none; border-radius: 4px;">
                    Report Issue
                </button>
            `;
        }

        actionColumnHtml += `</div>`;

        html += `
            <tr>
                <td><strong>${title}</strong></td>
                <td>${qty}</td>
                <td>&#8358;${Number(amount).toLocaleString()}</td>
                <td>${type}</td>
                <td>${formattedDate}</td>
                <td>${actionColumnHtml}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
    bindTableActionButtons();
}

function bindTableActionButtons() {
    document.querySelectorAll('.btn-view-dispute').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ref = e.currentTarget.getAttribute('data-reference');
            openDisputeDetailsModal(ref);
        });
    });

    document.querySelectorAll('.btn-report-issue').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ref = e.currentTarget.getAttribute('data-reference');
            openReportModal(ref);
        });
    });
}

function openReportModal(reference) {
    selectedReferenceForDispute = reference;
    const modal = document.getElementById('dispute-modal');
    const msg = document.getElementById('dispute-form-message');
    const form = document.getElementById('dispute-form');

    if (msg) msg.textContent = '';
    if (form) form.reset();

    if (modal) modal.classList.remove('hidden');
}

function openDisputeDetailsModal(reference) {
    const dispute = activeDisputesMap.get(reference);
    const modal = document.getElementById('dispute-details-modal');
    if (!dispute || !modal) return;

    const contentArea = modal.querySelector('.dispute-details-content');
    
    const vendorReply = dispute.vendorStatement || dispute.vendorResponse || dispute.vendorReply || 'No response yet';
    const cleanBuyerStatement = dispute.buyerStatement || 'No statement provided';
    const statusLabel = dispute.status || 'open';
    const publicResolution = dispute.resolution || null;

    let adminNotesHtml = '';
    if (Array.isArray(dispute.adminNotes) && dispute.adminNotes.length > 0) {
        adminNotesHtml = dispute.adminNotes.map(n => {
            const timeStr = n.createdAt ? new Date(n.createdAt._seconds ? n.createdAt._seconds * 1000 : n.createdAt).toLocaleString() : '';
            return `<div style="background:#f3f4f6; padding:8px; border-radius:4px; margin-top:4px;">
                <small style="color:#6b7280;">${escapeHtml(timeStr)}</small>
                <p style="margin:4px 0 0 0; font-size:13px;">${escapeHtml(n.note || n.message || n)}</p>
            </div>`;
        }).join('');
    } else {
        adminNotesHtml = '<em style="color:#9ca3af; font-size:13px;">No public admin updates yet.</em>';
    }

    contentArea.innerHTML = `
        <h3 style="margin-top:0; font-size:18px; color:#111827;">Dispute Details</h3>
        <dl style="display:grid; grid-template-columns: 130px 1fr; gap:10px; font-size:14px; margin:0;">
            <dt style="font-weight:600; color:#374151;">Reference:</dt>
            <dd style="margin:0;">${escapeHtml(reference)}</dd>

            <dt style="font-weight:600; color:#374151;">Reason:</dt>
            <dd style="margin:0;">${escapeHtml(dispute.reason || 'Not provided')}</dd>

            <dt style="font-weight:600; color:#374151;">Your Statement:</dt>
            <dd style="margin:0; background:#f9fafb; padding:8px; border-radius:4px;">${escapeHtml(cleanBuyerStatement)}</dd>

            <dt style="font-weight:600; color:#374151;">Vendor Response:</dt>
            <dd style="margin:0; background:#f9fafb; padding:8px; border-radius:4px;">${escapeHtml(vendorReply)}</dd>

            <dt style="font-weight:600; color:#374151;">Admin Updates:</dt>
            <dd style="margin:0;">${adminNotesHtml}</dd>

            <dt style="font-weight:600; color:#374151;">Status:</dt>
            <dd style="margin:0;"><span class="status-badge status-${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span></dd>

            ${publicResolution ? `
                <dt style="font-weight:600; color:#374151;">Resolution:</dt>
                <dd style="margin:0; background:#ecfdf5; color:#065f46; padding:8px; border-radius:4px;">${escapeHtml(publicResolution)}</dd>
            ` : ''}
        </dl>
    `;

    modal.classList.remove('hidden');
}

function setupModalListeners() {
    const reportModal = document.getElementById('dispute-modal');
    const reportCloseBtn = document.getElementById('dispute-modal-close');
    const reportForm = document.getElementById('dispute-form');

    if (reportCloseBtn && reportModal) {
        reportCloseBtn.addEventListener('click', () => {
            reportModal.classList.add('hidden');
        });
    }

    const detailsModal = document.getElementById('dispute-details-modal');
    const detailsCloseBtn = document.getElementById('dispute-details-modal-close');

    if (detailsCloseBtn && detailsModal) {
        detailsCloseBtn.addEventListener('click', () => {
            detailsModal.classList.add('hidden');
        });
    }

    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = document.getElementById('dispute-reason').value;
            const buyerStatement = document.getElementById('dispute-statement').value;
            const msg = document.getElementById('dispute-form-message');

            if (!selectedReferenceForDispute) {
                if (msg) msg.textContent = 'Invalid order reference.';
                return;
            }

            if (msg) msg.textContent = 'Submitting dispute...';

            try {
                const token = await currentUser.getIdToken();
                const response = await fetch('/api/disputes/create-dispute', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        reference: selectedReferenceForDispute,
                        reason,
                        buyerStatement
                    })
                });

                const resData = await response.json();

                if (response.ok && resData.success) {
                    if (msg) msg.textContent = 'Dispute submitted successfully!';
                    setTimeout(() => {
                        if (reportModal) reportModal.classList.add('hidden');
                        loadDashboardData();
                    }, 1200);
                } else {
                    if (msg) msg.textContent = resData.error || 'Failed to submit dispute.';
                }
            } catch (err) {
                console.error('Error submitting dispute:', err);
                if (msg) msg.textContent = 'An error occurred. Please try again.';
            }
        });
    }
}

window.openDisputeDetailsModal = openDisputeDetailsModal;
window.openReportModal = openReportModal;