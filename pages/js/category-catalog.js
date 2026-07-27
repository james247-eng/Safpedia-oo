import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';

// Re-use core initialized instance context securely
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

// Each category page sets this in a tiny inline <script> before loading this
// file, e.g. <script>window.SAFPEDIA_CATEGORY = 'Sermon';</script>
const CATEGORY_VALUE = window.SAFPEDIA_CATEGORY;

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
  }
});

// Pull the same published/createdAt query the main marketplace already uses
// (no new Firestore index needed), then filter to this page's category
// client-side. Course counts here are small enough that this is simpler
// and safer than adding a second composite-index query to maintain.
async function fetchCategoryCatalog() {
  const grid = document.getElementById('catalog-grid');
  try {
    const q = query(collection(db, 'courses'), where('isPublished', '==', true), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    localCatalogCache = [];
    querySnapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (data.category === CATEGORY_VALUE) {
        localCatalogCache.push(data);
      }
    });

    renderCatalogToGrid(localCatalogCache);
  } catch (error) {
    console.error("Category catalog retrieval failure:", error);
    grid.innerHTML = `<div class="error-state">Error loading this category: ${error.message}</div>`;
  }
}

// Identical card markup/logic to the main marketplace grid, so a course
// looks the same whether it's found via search or via a category page.
function renderCatalogToGrid(items) {
  const grid = document.getElementById('catalog-grid');
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">No items published in this category yet.</div>`;
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'product-card';

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
          <a href="../product-details.html?id=${item.id}" class="btn btn-secondary btn-sm">View Insights</a>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Search + format filtering within this one category (no category filter —
// the whole page is already one category)
function runCategoryFilterPipeline() {
  const queryStr = document.getElementById('catalog-search').value.toLowerCase().trim();
  const formatSelected = document.getElementById('filter-format').value;

  const filtered = localCatalogCache.filter(item => {
    const matchesSearch = item.title?.toLowerCase().includes(queryStr) || item.shortDescription?.toLowerCase().includes(queryStr);
    const matchesFormat = formatSelected === 'all' || item.formatType === formatSelected;
    return matchesSearch && matchesFormat;
  });

  renderCatalogToGrid(filtered);
}

document.getElementById('catalog-search').addEventListener('input', runCategoryFilterPipeline);
document.getElementById('filter-format').addEventListener('change', runCategoryFilterPipeline);

fetchCategoryCatalog();