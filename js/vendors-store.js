// js/vendor-store.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collection, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';

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

// ====================================================================
// AUTH STATUS
// ====================================================================
onAuthStateChanged(auth, (user) => {
    const container = document.getElementById('auth-status-container');
    if (user) {
        container.innerHTML = `
            <a href="/users/dashboard.html" class="student-profile-avatar" title="View Profile">
                ${(user.email || 'U').charAt(0).toUpperCase()}
            </a>
        `;
        document.getElementById('student-portal-link').href = '/users/dashboard.html';
    }
});

// ====================================================================
// LOAD VENDOR'S PRODUCTS
// ====================================================================
async function loadVendorStore() {
    const grid = document.getElementById('products-grid');
    const params = new URLSearchParams(window.location.search);
    const vendorUid = params.get('vendor');

    if (!vendorUid) {
        document.getElementById('vendor-store-title').textContent = 'Store not found';
        grid.innerHTML = '<div class="error-state">No vendor specified.</div>';
        return;
    }

    try {
        const q = query(
            collection(db, 'vendorProducts'),
            where('vendorUid', '==', vendorUid),
            where('isActive', '==', true),
            orderBy('createdAt', 'desc')
        );
        const querySnapshot = await getDocs(q);

        const products = [];
        querySnapshot.forEach((docSnap) => {
            products.push({ id: docSnap.id, ...docSnap.data() });
        });

        renderBanner(products);
        renderProductGrid(products);

    } catch (error) {
        console.error('Vendor store retrieval failure:', error);
        document.getElementById('vendor-store-title').textContent = 'Could not load this store';
        grid.innerHTML = `<div class="error-state">Error: ${error.message}</div>`;
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

        const stockNote = item.type === 'physical'
            ? (item.stock > 0 ? `${item.stock} in stock` : 'Out of stock')
            : 'Instant download';

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
                    <a href="product-details.html?id=${item.id}" class="btn btn-secondary btn-sm">View Product</a>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

loadVendorStore();