import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
        import { getFirestore, collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
        import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

        // Re-use core initialized instance context securely
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

        let localCatalogCache = [];

        // Track user context securely
        onAuthStateChanged(auth, (user) => {
            const container = document.getElementById('auth-status-container');
            if (user) {
                container.innerHTML = `
                    <a href="/users/dashboard.html" class="student-profile-avatar" title="View Profile">
                        ${(user.email || 'U').charAt(0).toUpperCase()}
                    </a>
                `;
                document.getElementById('student-portal-link').href = "/users/dashboard.html";
            }
        });

        // Pull active collection lines out cleanly
        async function fetchMarketplaceCatalog() {
            const grid = document.getElementById('catalog-grid');
            try {
                // Pull only products set as Published by admin workspace parameters
                const q = query(collection(db, 'courses'), where('isPublished', '==', true), orderBy('createdAt', 'desc'));
                const querySnapshot = await getDocs(q);
                
                localCatalogCache = [];
                querySnapshot.forEach(docSnap => {
                    localCatalogCache.push({ id: docSnap.id, ...docSnap.data() });
                });

                renderCatalogToGrid(localCatalogCache);
            } catch (error) {
                console.error("Catalog retrieval execution failure:", error);
                grid.innerHTML = `<div class="error-state">Error syncing active catalog lines: ${error.message}</div>`;
            }
        }

        function renderCatalogToGrid(items) {
            const grid = document.getElementById('catalog-grid');
            grid.innerHTML = '';

            if (items.length === 0) {
                grid.innerHTML = `<div class="empty-state">No matching digital products found in this directory framework layout lookups.</div>`;
                return;
            }

            items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'product-card';
                
                // Humanize target delivery formats cleanly
                const formatBadges = {
                    video: '<span class="badge-f video"><ion-icon name="videocam-outline"></ion-icon> Video</span>',
                    audio: '<span class="badge-f audio"><ion-icon name="musical-notes-outline"></ion-icon> Audio Pack</span>',
                    pdf: '<span class="badge-f pdf"><ion-icon name="document-text-outline"></ion-icon> PDF Book</span>',
                    live: '<span class="badge-f live"><ion-icon name="shapes-outline"></ion-icon> Live Stream</span>'
                };

                const displayBadge = formatBadges[item.formatType] || formatBadges.video;
                const formattedPrice = item.price ? '₦' + item.price.toLocaleString() : 'Free Access';

                card.innerHTML = `
                    <div class="card-banner">
                        <img src="${item.thumbnail || 'images/hero.png'}" alt="Cover image">
                        ${displayBadge}
                    </div>
                    <div class="card-details">
                        <span class="category-meta">${item.category?.replace(/-/g, ' ').toUpperCase() || 'GENERAL'}</span>
                        <h3 class="product-title">${item.title}</h3>
                        <p class="product-snippet">${item.shortDescription || ''}</p>
                        <div class="card-footer-row">
                            <span class="product-cost">${formattedPrice}</span>
                            <a href="product-details.html?id=${item.id}" class="btn btn-secondary btn-sm">View Insights</a>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            });
        }

        // Search & Dynamic Live Parameter Filtering Pipelines
        function runCatalogFilterPipeline() {
            const queryStr = document.getElementById('catalog-search').value.toLowerCase().trim();
            const formatSelected = document.getElementById('filter-format').value;
            const categorySelected = document.getElementById('filter-category').value;

            const filtered = localCatalogCache.filter(item => {
                const matchesSearch = item.title?.toLowerCase().includes(queryStr) || item.shortDescription?.toLowerCase().includes(queryStr);
                const matchesFormat = formatSelected === 'all' || item.formatType === formatSelected;
                const matchesCategory = categorySelected === 'all' || item.category === categorySelected;
                
                return matchesSearch && matchesFormat && matchesCategory;
            });

            renderCatalogToGrid(filtered);
        }

        document.getElementById('catalog-search').addEventListener('input', runCatalogFilterPipeline);
        document.getElementById('filter-format').addEventListener('change', runCatalogFilterPipeline);
        document.getElementById('filter-category').addEventListener('change', runCatalogFilterPipeline);

        // Execute initialization loop
        fetchMarketplaceCatalog();