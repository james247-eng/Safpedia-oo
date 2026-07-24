// ====================================================================
// BLOG-POST.JS - Single Blog Post Detail Page
// ====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, doc, getDoc, collection, query, where, limit, getDocs } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

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
// GET POST ID FROM URL
// ====================================================================
const urlParams = new URLSearchParams(window.location.search);
const postId = urlParams.get('id');

if (!postId) {
  window.location.href = '/blog.html';
}

// ====================================================================
// LOAD BLOG POST
// ====================================================================
async function loadBlogPost() {
  try {
    const postDoc = await getDoc(doc(db, 'blog-posts', postId));
    
    if (!postDoc.exists()) {
      showError('Post not found');
      return;
    }

    const postData = postDoc.data();
    
    // Generate SEO meta tags
    generatePostSEO(postData);
    
    // Display post
    displayPost(postData);
    
    // Load related posts
    loadRelatedPosts(postData.category);

  } catch (error) {
    console.error('Error loading post:', error);
    showError('Unable to load article');
  }
}

// ====================================================================
// GENERATE DYNAMIC SEO FOR POST
// ====================================================================
function generatePostSEO(post) {
  const postUrl = `https://tech-wizards-academy.netlify.app/blog-post.html?id=${postId}`;
  
  // Update title
  document.title = `${post.title} | Tech Wizards Academy Blog`;
  
  // Remove existing dynamic meta tags
  document.querySelectorAll('[data-dynamic-seo]').forEach(el => el.remove());
  
  // Meta description
  const metaDesc = document.createElement('meta');
  metaDesc.name = 'description';
  metaDesc.content = post.excerpt || post.content.substring(0, 155);
  metaDesc.setAttribute('data-dynamic-seo', 'true');
  document.head.appendChild(metaDesc);
  
  // Meta keywords
  const metaKeywords = document.createElement('meta');
  metaKeywords.name = 'keywords';
  metaKeywords.content = post.tags ? post.tags.join(', ') : post.category;
  metaKeywords.setAttribute('data-dynamic-seo', 'true');
  document.head.appendChild(metaKeywords);
  
  // Canonical
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = postUrl;
  
  // Open Graph tags
  const ogTags = {
    'og:type': 'article',
    'og:title': post.title,
    'og:description': post.excerpt || post.content.substring(0, 200),
    'og:url': postUrl,
    'og:image': post.image,
    'og:site_name': 'Tech Wizards Academy',
    'article:published_time': post.publishedAt?.toDate().toISOString(),
    'article:author': post.author,
    'article:section': post.category
  };
  
  Object.entries(ogTags).forEach(([property, content]) => {
    if (content) {
      const meta = document.createElement('meta');
      meta.setAttribute('property', property);
      meta.setAttribute('content', content);
      meta.setAttribute('data-dynamic-seo', 'true');
      document.head.appendChild(meta);
    }
  });
  
  // Twitter Card
  const twitterTags = {
    'twitter:card': 'summary_large_image',
    'twitter:title': post.title,
    'twitter:description': post.excerpt || post.content.substring(0, 200),
    'twitter:image': post.image
  };
  
  Object.entries(twitterTags).forEach(([name, content]) => {
    if (content) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      meta.setAttribute('content', content);
      meta.setAttribute('data-dynamic-seo', 'true');
      document.head.appendChild(meta);
    }
  });
  
  // Structured Data - Article Schema
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": post.excerpt || post.content.substring(0, 200),
    "image": post.image,
    "author": {
      "@type": "Person",
      "name": post.author || "Tech Wizards Academy"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Tech Wizards Academy",
      "logo": {
        "@type": "ImageObject",
        "url": "https://tech-wizards-academy.netlify.app/images/logo.png"
      }
    },
    "datePublished": post.publishedAt?.toDate().toISOString(),
    "dateModified": post.updatedAt?.toDate().toISOString() || post.publishedAt?.toDate().toISOString(),
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": postUrl
    },
    "keywords": post.tags ? post.tags.join(', ') : post.category,
    "articleSection": post.category,
    "wordCount": post.content.split(' ').length,
    "inLanguage": "en-NG"
  };
  
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(structuredData, null, 2);
  script.setAttribute('data-dynamic-seo', 'true');
  document.head.appendChild(script);
  
  console.log('✅ SEO meta tags generated for blog post');
}

// ====================================================================
// DISPLAY POST
// ====================================================================
function displayPost(post) {
  const container = document.getElementById('post-container');
  
  const formattedDate = post.publishedAt ? formatDate(post.publishedAt) : 'Recently';
  const categoryFormatted = formatCategory(post.category);
  
  container.innerHTML = `
    <!-- Header -->
    <header class="post-header">
      <div class="header-container">
        <a href="/blog.html" class="back-btn">← Back to Blog</a>
        <div class="post-category">${categoryFormatted}</div>
        <h1 class="post-title">${post.title}</h1>
        <div class="post-meta">
          <div class="meta-item">
            <span>👤</span>
            <span>${post.author || 'Tech Wizards Academy'}</span>
          </div>
          <div class="meta-item">
            <span>📅</span>
            <span>${formattedDate}</span>
          </div>
          <div class="meta-item">
            <span>⏱️</span>
            <span>${post.readTime || calculateReadTime(post.content)} min read</span>
          </div>
          ${post.views ? `
            <div class="meta-item">
              <span>👁️</span>
              <span>${post.views.toLocaleString()} views</span>
            </div>
          ` : ''}
        </div>
      </div>
    </header>

    <!-- Featured Image -->
    ${post.image ? `
      <div class="featured-image-container">
        <img 
          src="${post.image}" 
          alt="${post.title}"
          class="featured-image"
          onerror="this.style.display='none'">
      </div>
    ` : ''}

    <!-- Content -->
    <div class="post-content-container">
      <article class="post-content">
        ${formatContent(post.content)}
      </article>

      <!-- Tags -->
      ${post.tags && post.tags.length > 0 ? `
        <div style="margin-top: 40px; padding-top: 40px; border-top: 1px solid #e5e7eb;">
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${post.tags.map(tag => `
              <span style="background: #f3f4f6; padding: 6px 14px; border-radius: 20px; font-size: 13px; color: #6b7280;">
                #${tag}
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Author Section -->
      <div class="author-section">
        <div class="author-info">
          <div class="author-avatar">${getInitials(post.author)}</div>
          <div class="author-details">
            <h3>Written by ${post.author || 'Tech Wizards Team'}</h3>
            <p>${post.authorBio || 'Expert instructor passionate about tech education and helping students achieve their goals.'}</p>
          </div>
        </div>
      </div>

      <!-- Share Section -->
      <div class="share-section">
        <div class="share-title">📤 Share this article</div>
        <div class="share-buttons">
          <button class="share-btn twitter" onclick="shareOnTwitter()">
            🐦 Twitter
          </button>
          <button class="share-btn facebook" onclick="shareOnFacebook()">
            📘 Facebook
          </button>
          <button class="share-btn linkedin" onclick="shareOnLinkedIn()">
            💼 LinkedIn
          </button>
          <button class="share-btn whatsapp" onclick="shareOnWhatsApp()">
            💬 WhatsApp
          </button>
        </div>
      </div>
    </div>

    <!-- Related Posts -->
    <div class="related-posts">
      <h2 class="related-title">📚 Related Articles</h2>
      <div class="related-grid" id="related-grid">
        <div class="loading">
          <div class="spinner" style="width: 40px; height: 40px;"></div>
        </div>
      </div>
    </div>
  `;
}

// ====================================================================
// LOAD RELATED POSTS
// ====================================================================
async function loadRelatedPosts(category) {
  try {
    const q = query(
      collection(db, 'blog-posts'),
      where('category', '==', category),
      limit(3)
    );
    
    const snapshot = await getDocs(q);
    const relatedGrid = document.getElementById('related-grid');
    
    if (snapshot.empty || snapshot.size === 1) {
      relatedGrid.innerHTML = '<p style="text-align: center; color: #6b7280;">No related articles found</p>';
      return;
    }
    
    const posts = [];
    snapshot.forEach(doc => {
      if (doc.id !== postId) {
        posts.push({ id: doc.id, ...doc.data() });
      }
    });
    
    relatedGrid.innerHTML = posts.map(post => `
      <div class="blog-card" onclick="window.location.href='/blog-post.html?id=${post.id}'">
        <img src="${post.image || 'https://via.placeholder.com/400x300'}" 
             alt="${post.title}"
             class="blog-image">
        <div class="blog-content">
          <span class="blog-category">${formatCategory(post.category)}</span>
          <h3 class="blog-title">${post.title}</h3>
          <p class="blog-excerpt">${post.excerpt || post.content.substring(0, 100) + '...'}</p>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading related posts:', error);
  }
}

// ====================================================================
// UTILITY FUNCTIONS
// ====================================================================
function formatContent(content) {
  // Convert line breaks to paragraphs
  return content
    .split('\n\n')
    .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function calculateReadTime(content) {
  const wordsPerMinute = 200;
  const words = content.split(' ').length;
  return Math.ceil(words / wordsPerMinute);
}

function formatDate(timestamp) {
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
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

function showError(message) {
  const container = document.getElementById('post-container');
  container.innerHTML = `
    <div class="loading">
      <h2 style="color: #ef4444; margin-bottom: 12px;">Error</h2>
      <p style="color: #6b7280;">${message}</p>
      <a href="/blog.html" style="display: inline-block; margin-top: 20px; padding: 12px 24px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; border-radius: 50px; font-weight: 600;">
        ← Back to Blog
      </a>
    </div>
  `;
}

// ====================================================================
// SOCIAL SHARE FUNCTIONS
// ====================================================================
window.shareOnTwitter = function() {
  const url = window.location.href;
  const text = document.title;
  window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank', 'width=600,height=400');
};

window.shareOnFacebook = function() {
  const url = window.location.href;
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'width=600,height=400');
};

window.shareOnLinkedIn = function() {
  const url = window.location.href;
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'width=600,height=400');
};

window.shareOnWhatsApp = function() {
  const url = window.location.href;
  const text = document.title;
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
};

// ====================================================================
// INITIALIZE
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadBlogPost();
});

console.log('✅ Blog post detail page initialized');