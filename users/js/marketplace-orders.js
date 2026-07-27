// students/js/marketplace-orders.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collectionGroup, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';
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

// ====================================================================
// AUTH GUARD
// ====================================================================
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = '/sign-in.html';
        return;
    }
    currentUser = user;

    document.getElementById('buyer-avatar-slot').textContent = (user.email || 'U').charAt(0).toUpperCase();
    document.getElementById('buyer-display-email').textContent = user.email || 'Student Account';

    loadOrders();
});

document.getElementById('buyer-logout-trigger').addEventListener('click', async (e) => {
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

        return `
            <tr>
                <td>${o.productTitle}</td>
                <td>${o.quantity}</td>
                <td>₦${(o.amount || 0).toLocaleString()}</td>
                <td>${o.productType}</td>
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
}

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