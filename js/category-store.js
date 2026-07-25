// js/category-store.js

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collection, query, where, getDocs, orderBy } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { CATEGORIES, getCategoryById } from './categories-config.js';

// Centralized Firebase Initialization
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
// AUTH STATE (Public Storefront)
// ====================================================================
onAuthStateChanged(auth, (user) => {
    const container = document.getElementById('auth-status-container');
    if (!container) return;

    if (user) {
        container.innerHTML = `
            <a href="/students/dashboard.html" class="student-profile-avatar" title="View Profile">
                ${(user.email || 'U').charAt(0).toUpperCase()}
            </a>
        `;
    }
});

// ====================================================================
// LOAD & RENDER CATEGORY PRODUCTS
// ====================================================================
async function loadCategoryProducts() {
    const params = new URLSearchParams(window.location.search);
    const categorySlug = params.get('type') || 'general';

    const loadingEl = document.getElementById('category-loading');
    const errorEl = document.getElementById('category-error');
    const gridEl = document.getElementById('category-products-grid');
    const titleEl = document.getElementById('category-title');
    const badgeEl = document.getElementById('category-badge');
    const descEl = document.getElementById('category-description');

    const categoryInfo = getCategoryById(categorySlug);

    if (titleEl) titleEl.textContent = categoryInfo ? categoryInfo.label : 'Explore Products';
    if (badgeEl) badgeEl.textContent = categoryInfo ? categoryInfo.label : 'Category';
    if (descEl) descEl.textContent = `Browse quality items listed under ${categoryInfo ? categoryInfo.label : 'this category'}.`;
    document.title = `${categoryInfo ? categoryInfo.label : 'Category Store'} | Safpedia Marketplace`;

    try {
        const q = query(
            collection(db, 'vendorProducts'),
            where('category', '==', categorySlug),
            where('isActive', '==', true)
        );

        const querySnapshot = await getDocs(q);

        loadingEl.classList.add('hidden');

        if (querySnapshot.empty) {
            errorEl.textContent = 'No products available in this category yet.';
            errorEl.classList.remove('hidden');
            return;
        }

        gridEl.innerHTML = '';
        gridEl.classList.remove('hidden');

        querySnapshot.forEach((docSnap) => {
            const product = { id: docSnap.id, ...docSnap.data() };
            if (product.isDeleted) return;

            const card = document.createElement('div');
            card.className = 'product-card';

            const coverUrl = product.images && product.images[0] ? product.images[0].url : 'images/hero.png';
            const unitText = product.unit ? ` / ${product.unit}` : '';

            card.innerHTML = `
                <div class="card-banner">
                    <img src="${coverUrl}" alt="${product.title}">
                    <span class="badge-f ${product.type === 'physical' ? 'physical' : 'digital'}">
                        ${product.type === 'physical' ? 'Physical' : 'Digital'}
                    </span>
                </div>
                <div class="card-details">
                    <span class="category-meta">${product.category}</span>
                    <h3 class="product-title">${product.title}</h3>
                    <div class="card-footer-row">
                        <span class="product-cost">₦${product.price ? product.price.toLocaleString() : '0'}${unitText}</span>
                    </div>
                    <div class="product-card-actions" style="margin-top: 12px;">
                        <a href="vendors-product-details.html?id=${product.id}" class="btn btn-primary btn-sm" style="width: 100%; text-align: center;">View Details</a>
                    </div>
                </div>
            `;
            gridEl.appendChild(card);
        });

    } catch (err) {
        console.error('loadCategoryProducts error:', err);
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'Could not load products for this category.';
        errorEl.classList.remove('hidden');
    }
}

loadCategoryProducts();