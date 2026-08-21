// students/js/marketplace-orders.js

import { auth, db } from '../../firebase-config.js';
import '../../js/notification-center.js';
import { collectionGroup, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

let currentUser = null;
let disputesByReference = new Map();
let activeDisputeReference = null;

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
// NOTE: this reads directly from Firestore via a collectionGroup query on
// 'sales' filtered by buyerUid — it requires a Security Rule allowing a
// signed-in user to read sales docs where buyerUid == request.auth.uid,
// and a one-time composite index (collection group 'sales', field
// 'buyerUid' Ascending, field 'createdAt' Descending). The first request
// will fail with an error containing a direct link to auto-create it.
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

        await loadDisputes();
        renderOrders(orders);

    } catch (err) {
        console.error('loadOrders error:', err);
        container.innerHTML = `<div class="error-state">Could not load your orders: ${err.message}</div>`;
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
                ? `<button class="btn btn-sm btn-secondary download-btn" data-product-id="${o.productId}" data-reference="${o.reference}">Download</button>`
                : `Status: ${o.fulfillmentStatus || 'unknown'}`;
        } else {
            const tracking = o.trackingNumber ? ` (${o.carrier || 'carrier'}: ${o.trackingNumber})` : '';
            actionCell = `${o.fulfillmentStatus || 'pending_shipment'}${tracking}`;
        }

        const dispute = disputesByReference.get(o.reference);
        const disputeAction = dispute ? `<span class="status-badge">Dispute: ${dispute.status}</span>` : `<button class="btn btn-sm btn-secondary dispute-btn" data-reference="${o.reference}">Report a problem</button>`;
        return `
            <tr>
                <td>${o.productTitle}</td>
                <td>${o.quantity}</td>
                <td>₦${(o.amount || 0).toLocaleString()}</td>
                <td>${o.productType}</td>
                <td>${date}</td>
                <td>${actionCell}<div>${disputeAction}</div></td>
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
    container.querySelectorAll('.dispute-btn').forEach((btn) => btn.addEventListener('click', () => openDisputeModal(btn.dataset.reference)));
}

async function authedFetch(url, options = {}) { const token = await currentUser.getIdToken(); options.headers = Object.assign({}, options.headers, { Authorization: `Bearer ${token}` }); return fetch(url, options); }
async function loadDisputes() { const res = await authedFetch('/api/disputes/list-disputes'); const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Could not load disputes'); disputesByReference = new Map(json.disputes.map((d) => [d.reference, d])); }
function openDisputeModal(reference) { activeDisputeReference = reference; document.getElementById('dispute-form').reset(); document.getElementById('dispute-form-message').textContent = ''; document.getElementById('dispute-modal').classList.remove('hidden'); }
document.getElementById('dispute-modal-close').addEventListener('click', () => document.getElementById('dispute-modal').classList.add('hidden'));
document.getElementById('dispute-form').addEventListener('submit', async (event) => { event.preventDefault(); const message = document.getElementById('dispute-form-message'); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; try { const res = await authedFetch('/api/disputes/create-dispute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: activeDisputeReference, reason: document.getElementById('dispute-reason').value, buyerStatement: document.getElementById('dispute-statement').value }) }); const json = await res.json(); if (!res.ok) throw new Error(json.error || 'Could not create dispute'); document.getElementById('dispute-modal').classList.add('hidden'); await loadOrders(); } catch (err) { message.textContent = err.message; } finally { button.disabled = false; } });

// ====================================================================
// DOWNLOAD LINK (server call — needs the Cloudinary secret, stays serverless)
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
