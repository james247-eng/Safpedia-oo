// js/marketplace-store.js

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

let localProductCache = [];

// ====================================================================
// AUTH STATUS (mirrors course.js)
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
// FETCH + RENDER
// ====================================================================
async function fetchProductCatalog() {
    const grid = document.getElementById('products-grid');
    try {
        const q = query(
            collection(db, 'vendorProducts'),
            where('isActive', '==', true),
            orderBy('createdAt', 'desc')
        );
        const querySnapshot = await getDocs(q);

        localProductCache = [];
        querySnapshot.forEach((docSnap) => {
            localProductCache.push({ id: docSnap.id, ...docSnap.data() });
        });

        populateCategoryFilter(localProductCache);
        renderProductGrid(localProductCache);

    } catch (error) {
        console.error('Marketplace catalog retrieval failure:', error);
        grid.innerHTML = `<div class="error-state">Error loading marketplace products: ${error.message}</div>`;
    }
}

function populateCategoryFilter(items) {
    const select = document.getElementById('filter-category');
    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();

    // Preserve the "All Categories" option, append the rest once.
    categories.forEach((cat) => {
        if ([...select.options].some((opt) => opt.value === cat)) return;
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
}

function renderProductGrid(items) {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = `<div class="empty-state">No products found.</div>`;
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
                <a href="vendor-store.html?vendor=${item.vendorUid}" class="product-vendor-link">by ${item.vendorFirstName || 'Vendor'}</a>
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

// ====================================================================
// SEARCH & FILTER
// ====================================================================
function runProductFilterPipeline() {
    const queryStr = document.getElementById('product-search').value.toLowerCase().trim();
    const typeSelected = document.getElementById('filter-type').value;
    const categorySelected = document.getElementById('filter-category').value;

    const filtered = localProductCache.filter((item) => {
        const matchesSearch = item.title?.toLowerCase().includes(queryStr) || item.description?.toLowerCase().includes(queryStr);
        const matchesType = typeSelected === 'all' || item.type === typeSelected;
        const matchesCategory = categorySelected === 'all' || item.category === categorySelected;
        return matchesSearch && matchesType && matchesCategory;
    });

    renderProductGrid(filtered);
}

document.getElementById('product-search').addEventListener('input', runProductFilterPipeline);
document.getElementById('filter-type').addEventListener('change', runProductFilterPipeline);
document.getElementById('filter-category').addEventListener('change', runProductFilterPipeline);

fetchProductCatalog();