// ====================================================================
// BLOG.JS - Firestore Blog System
// ====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, orderBy, where, limit } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBBA8KVzbxoomwAm83erzk_JPxq37H27j0",
  authDomain: "key-board-wizards.firebaseapp.com",
  projectId: "key-board-wizards",
  storageBucket: "key-board-wizards.firebasestorage.app",
  messagingSenderId: "570989716323",
  appId: "1:570989716323:web:adb3d3ae753a91458f2956",
  measurementId: "G-E13DTS3XDB"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ====================================================================
// GLOBAL VARIABLES
// ====================================================================
let allPosts = [];
let filteredPosts = [];
let currentCategory = 'all';

// ====================================================================
// LOAD ALL BLOG POSTS
// ====================================================================
async function loadBlogPosts() {
  try {
    const q = query(
      collection(db, 'blog-posts'), 
      orderBy('publishedAt', 'desc')
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      showEmptyState();
      return;
    }

    allPosts = [];
    snapshot.forEach(doc => {
      allPosts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    filteredPosts = [...allPosts];
    
    // Show featured post (first one)
    if (allPosts.length > 0 && allPosts[0].featured) {
      displayFeaturedPost(allPosts[0]);
      filteredPosts = allPosts.slice(1); // Remove featured from grid
    }

    displayBlogPosts(filteredPosts);

  } catch (error) {
    console.error('Error loading blog posts:', error);
    showError();
  }
}

// ====================================================================
// DISPLAY FEATURED POST
// ====================================================================
function displayFeaturedPost(post) {
  const section = document.getElementById('featured-section');
  const container = document.getElementById('featured-post');
  
  section.style.display = 'block';
  
  container.innerHTML = `
    <div class="featured-card" onclick="openPost('${post.id}')">
      <img 
        src="${post.image || 'https://via.placeholder.com/800x600?text=Featured+Post'}" 
        alt="${post.title}"
        class="featured-image"
        onerror="this.src='https://via.placeholder.com/800x600?text=Featured+Post'">
      <div class="featured-content">
        <div class="featured-badge">⭐ Featured</div>
        <h3 class="featured-title">${post.title}</h3>
        <p class="featured-excerpt">${post.excerpt || post.content.substring(0, 200) + '...'}</p>
        <div style="display: flex; gap: 20px; margin-bottom: 24px; color: #6b7280; font-size: 14px;">
          <span><ion-icon name="person-outline"></ion-icon> ${post.author || 'Tech Wizards'}</span>
          <span><ion-icon name="calendar-outline"></ion-icon> ${formatDate(post.publishedAt)}</span>
          <span><ion-icon name="timer-outline"></ion-icon> ${post.readTime || '5'} min read</span>
        </div>
        <button class="read-more-btn">Read Full Article →</button>
      </div>
    </div>
  `;
}

// ====================================================================
// DISPLAY BLOG POSTS GRID
// ====================================================================
function displayBlogPosts(posts) {
  const grid = document.getElementById('blog-grid');
  
  if (posts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No articles found</h3>
        <p>Try selecting a different category or search term</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = posts.map(post => `
    <article class="blog-card" onclick="openPost('${post.id}')">
      <img 
        src="${post.image || 'https://via.placeholder.com/400x300?text=Blog+Post'}" 
        alt="${post.title}"
        class="blog-image"
        onerror="this.src='https://via.placeholder.com/400x300?text=Blog+Post'">
      <div class="blog-content">
        <span class="blog-category">${formatCategory(post.category)}</span>
        <h3 class="blog-title">${post.title}</h3>
        <p class="blog-excerpt">${post.excerpt || post.content.substring(0, 120) + '...'}</p>
        <div class="blog-meta">
          <div class="blog-author">
            <div class="author-avatar">${getInitials(post.author)}</div>
            <span>${post.author || 'Tech Wizards'}</span>
          </div>
          <div class="blog-date">
            <span><ion-icon name="calendar-outline"></ion-icon></span>
            <span>${formatDate(post.publishedAt)}</span>
          </div>
        </div>
      </div>
    </article>
  `
  ).join('');
}


// ====================================================================
// FILTER BY CATEGORY
// ====================================================================
function filterByCategory(category) {
  currentCategory = category;
  
  // Update active chip
  document.querySelectorAll('.category-chip').forEach(chip => {
    chip.classList.remove('active');
  });
  event.target.classList.add('active');

  if (category === 'all') {
    filteredPosts = allPosts.filter(post => !post.featured);
  } else {
    filteredPosts = allPosts.filter(post => 
      post.category === category && !post.featured
    );
  }

  displayBlogPosts(filteredPosts);
}

// ====================================================================
// SEARCH FUNCTIONALITY
// ====================================================================
function searchPosts(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  
  if (term === '') {
    filteredPosts = currentCategory === 'all' 
      ? allPosts.filter(post => !post.featured)
      : allPosts.filter(post => post.category === currentCategory && !post.featured);
  } else {
    filteredPosts = allPosts.filter(post => {
      const matchesSearch = 
        post.title.toLowerCase().includes(term) ||
        post.content.toLowerCase().includes(term) ||
        (post.excerpt && post.excerpt.toLowerCase().includes(term)) ||
        (post.tags && post.tags.some(tag => tag.toLowerCase().includes(term)));
      
      const matchesCategory = currentCategory === 'all' || post.category === currentCategory;
      
      return matchesSearch && matchesCategory && !post.featured;
    });
  }

  displayBlogPosts(filteredPosts);
}

// ====================================================================
// OPEN BLOG POST DETAIL PAGE
// ====================================================================
window.openPost = function(postId) {
  window.location.href = `/blog-post.html?id=${postId}`;
};

// ====================================================================
// UTILITY FUNCTIONS
// ====================================================================
function formatDate(timestamp) {
  if (!timestamp) return 'Recently';
  
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

function formatCategory(category) {
  if (!category) return 'General';
  return category.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function getInitials(name) {
  if (!name) return 'TW';
  const words = name.split(' ');
  if (words.length === 1) return name.substring(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ====================================================================
// SHOW EMPTY STATE
// ====================================================================
function showEmptyState() {
  const grid = document.getElementById('blog-grid');
  grid.innerHTML = `
    <div class="empty-state">
      <h3>No blog posts yet</h3>
      <p>Check back soon for exciting content!</p>
    </div>
  `;
}

// ====================================================================
// SHOW ERROR STATE
// ====================================================================
function showError() {
  const grid = document.getElementById('blog-grid');
  grid.innerHTML = `
    <div class="empty-state">
      <h3>Oops! Something went wrong</h3>
      <p>Unable to load blog posts. Please refresh the page.</p>
    </div>
  `;
}

// ====================================================================
// EVENT LISTENERS
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Load posts on page load
  loadBlogPosts();

  // Category filter
  document.querySelectorAll('.category-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const category = e.target.dataset.category;
      filterByCategory(category);
    });
  });

  // Search functionality
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');

  searchBtn.addEventListener('click', () => {
    searchPosts(searchInput.value);
  });

  searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      searchPosts(searchInput.value);
    }
  });

  // Real-time search (optional - searches as you type)
  searchInput.addEventListener('input', (e) => {
    if (e.target.value.length > 2 || e.target.value.length === 0) {
      searchPosts(e.target.value);
    }
  });
});

console.log('✅ Blog system initialized');