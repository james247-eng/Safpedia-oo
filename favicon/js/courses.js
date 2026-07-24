
// courses.js - Load courses dynamically from Firestore
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getFirestore, collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

// Firebase config (replace with your actual config)
// TODO: keep this in sync with your existing firebaseConfig
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

// Load all courses from Firestore
async function loadCourses() {
  try {
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    
    if (!courseInnerWrapper) {
      console.error('Course container not found');
      return;
    }

    // Show loading state
    courseInnerWrapper.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">Loading courses...</p>';

    // Query only published courses
    const q = query(
      collection(db, 'courses'),
      where('isPublished', '==', true),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);

    // Clear loading state
    courseInnerWrapper.innerHTML = '';

    if (querySnapshot.empty) {
      courseInnerWrapper.innerHTML = `
        <div style="text-align:center; padding:60px 20px; grid-column: 1/-1;">
          <h3 style="color:#666; margin-bottom:10px;">No courses available yet</h3>
          <p style="color:#999;">Check back soon for new courses!</p>
        </div>
      `;
      return;
    }

    // Render each course
    querySnapshot.forEach((doc) => {
      const course = doc.data();
      const courseCard = createCourseCard(doc.id, course);
      courseInnerWrapper.appendChild(courseCard);
    });

  } catch (error) {
    console.error('Error loading courses:', error);
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    if (courseInnerWrapper) {
      courseInnerWrapper.innerHTML = `
        <div style="text-align:center; padding:40px; color:#ef4444; grid-column: 1/-1;">
          <p>Error loading courses. Please try again later.</p>
          <p style="font-size:12px; color:#999;">${error.message}</p>
        </div>
      `;
    }
  }
}

// Create course card HTML element
function createCourseCard(courseId, course) {
  const card = document.createElement('div');
  card.className = 'c-card';
  card.dataset.courseId = courseId;

  // Generate star rating
  const rating = course.rating || 4.5;
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  let starsHTML = '';
  
  for (let i = 0; i < fullStars; i++) {
    starsHTML += '<ion-icon name="star" style="color:gold;"></ion-icon>';
  }
  if (hasHalfStar) {
    starsHTML += '<ion-icon name="star-half" style="color:gold;"></ion-icon>';
  }
  for (let i = Math.ceil(rating); i < 5; i++) {
    starsHTML += '<ion-icon name="star-outline" style="color:gold;"></ion-icon>';
  }

  // Truncate description
  const shortDesc = course.shortDescription || course.description || 'No description available';
  const truncatedDesc = shortDesc.length > 100 
    ? shortDesc.substring(0, 100) + '...' 
    : shortDesc;

  card.innerHTML = `
    <img src="${course.thumbnail || 'https://via.placeholder.com/300x200?text=Course+Image'}" 
         alt="${course.title}" 
         onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
    
    <h3 class="title">${course.title}</h3>
    
    <div class="active-learners">
      👥 ${course.enrolledCount || 0} students enrolled
    </div>
    
    <div class="price">
      ₦${(course.price || 0).toLocaleString()}
    </div>
    
    <p class="description">${truncatedDesc}</p>
    
    <div class="rating-container">
      ${starsHTML}
      <span style="color:#666; margin-left:5px;">(${rating})</span>
    </div>
    
    <div class="button-container">
      <a href="#" class="view-details-btn" data-course-id="${courseId}">
        View Details
      </a>
      <a href="#" class="buy-now-btn" data-course-id="${courseId}" data-price="${course.price}">
        Buy Now
      </a>
    </div>
  `;

  return card;
}

// Filter courses by category
async function filterCourses(category) {
  try {
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    courseInnerWrapper.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">Loading courses...</p>';

    let q;
    if (category === 'all' || !category) {
      q = query(
        collection(db, 'courses'),
        where('isPublished', '==', true),
        orderBy('createdAt', 'desc')
      );
    } else {
      q = query(
        collection(db, 'courses'),
        where('isPublished', '==', true),
        where('category', '==', category),
        orderBy('createdAt', 'desc')
      );
    }

    const querySnapshot = await getDocs(q);
    courseInnerWrapper.innerHTML = '';

    if (querySnapshot.empty) {
      courseInnerWrapper.innerHTML = `
        <div style="text-align:center; padding:60px 20px; grid-column: 1/-1;">
          <h3 style="color:#666;">No courses found in this category</h3>
        </div>
      `;
      return;
    }

    querySnapshot.forEach((doc) => {
      const course = doc.data();
      const courseCard = createCourseCard(doc.id, course);
      courseInnerWrapper.appendChild(courseCard);
    });

  } catch (error) {
    console.error('Error filtering courses:', error);
  }
}

// Search courses
async function searchCourses(searchTerm) {
  try {
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    courseInnerWrapper.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">Searching...</p>';

    const q = query(
      collection(db, 'courses'),
      where('isPublished', '==', true)
    );

    const querySnapshot = await getDocs(q);
    courseInnerWrapper.innerHTML = '';

    const searchLower = searchTerm.toLowerCase();
    let foundCourses = 0;

    querySnapshot.forEach((doc) => {
      const course = doc.data();
      const titleMatch = course.title?.toLowerCase().includes(searchLower);
      const descMatch = course.description?.toLowerCase().includes(searchLower);
      const categoryMatch = course.category?.toLowerCase().includes(searchLower);

      if (titleMatch || descMatch || categoryMatch) {
        const courseCard = createCourseCard(doc.id, course);
        courseInnerWrapper.appendChild(courseCard);
        foundCourses++;
      }
    });

    if (foundCourses === 0) {
      courseInnerWrapper.innerHTML = `
        <div style="text-align:center; padding:60px 20px; grid-column: 1/-1;">
          <h3 style="color:#666;">No courses found for "${searchTerm}"</h3>
          <p style="color:#999;">Try a different search term</p>
        </div>
      `;
    }

  } catch (error) {
    console.error('Error searching courses:', error);
  }
}

// Get single course details
async function getCourseDetails(courseId) {
  try {
    const coursesRef = collection(db, 'courses');
    const querySnapshot = await getDocs(coursesRef);
    
    let courseData = null;
    querySnapshot.forEach((doc) => {
      if (doc.id === courseId) {
        courseData = { id: doc.id, ...doc.data() };
      }
    });

    return courseData;
  } catch (error) {
    console.error('Error getting course details:', error);
    return null;
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Load courses on page load
  loadCourses();

  // Add event listeners for filtering (if you have filter buttons)
  const filterButtons = document.querySelectorAll('[data-filter-category]');
  filterButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const category = e.target.dataset.filterCategory;
      filterCourses(category);
    });
  });

  // Add event listener for search (if you have search input)
  const searchInput = document.querySelector('#course-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.trim();
      if (searchTerm.length >= 3) {
        searchCourses(searchTerm);
      } else if (searchTerm.length === 0) {
        loadCourses();
      }
    });
  }

  // Handle "View Details" clicks
  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('view-details-btn')) {
      e.preventDefault();
      const courseId = e.target.dataset.courseId;
      const course = await getCourseDetails(courseId);
      
      if (course) {
        showCourseModal(course);
      }
    }
  });

  // Handle "Buy Now" clicks
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('buy-now-btn')) {
      e.preventDefault();
      const courseId = e.target.dataset.courseId;
      const price = e.target.dataset.price;
      
      // Redirect to checkout or show checkout modal
      initiateCheckout(courseId, price);
    }
  });
});

// Show course details modal
function showCourseModal(course) {
  // Create or show a modal with full course details
  const modal = document.createElement('div');
  modal.className = 'course-detail-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  `;

  modal.innerHTML = `
    <div style="background:white; padding:30px; border-radius:15px; max-width:800px; max-height:90vh; overflow-y:auto; width:100%;">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:20px;">
        <h2 style="color:teal; margin:0;">${course.title}</h2>
        <button onclick="this.closest('.course-detail-modal').remove()" style="background:none; border:none; font-size:30px; cursor:pointer; color:#666;">&times;</button>
      </div>
      
      <img src="${course.thumbnail}" alt="${course.title}" style="width:100%; height:300px; object-fit:cover; border-radius:10px; margin-bottom:20px;">
      
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:20px;">
        <div style="background:#f0f9ff; padding:15px; border-radius:8px;">
          <strong style="color:#0369a1;">Price:</strong>
          <p style="font-size:24px; color:teal; margin:5px 0;">₦${(course.price || 0).toLocaleString()}</p>
        </div>
        <div style="background:#f0fdf4; padding:15px; border-radius:8px;">
          <strong style="color:#065f46;">Students:</strong>
          <p style="font-size:24px; margin:5px 0;">${course.enrolledCount || 0}</p>
        </div>
        <div style="background:#fef3c7; padding:15px; border-radius:8px;">
          <strong style="color:#92400e;">Duration:</strong>
          <p style="font-size:20px; margin:5px 0;">${course.duration || 'N/A'}</p>
        </div>
      </div>
      
      <div style="margin-bottom:20px;">
        <strong style="color:#333;">Instructor:</strong> ${course.instructor || 'N/A'}<br>
        <strong style="color:#333;">Level:</strong> <span style="text-transform:capitalize;">${course.level || 'beginner'}</span><br>
        <strong style="color:#333;">Category:</strong> <span style="text-transform:capitalize;">${course.category?.replace('-', ' ') || 'N/A'}</span>
      </div>
      
      <div style="margin-bottom:20px;">
        <h3 style="color:#333; margin-bottom:10px;">Course Description</h3>
        <p style="color:#666; line-height:1.6;">${course.description || 'No description available.'}</p>
      </div>
      
      <button onclick="window.initiateCheckout('${course.id}', ${course.price})" style="width:100%; padding:15px; background:teal; color:white; border:none; border-radius:8px; font-size:18px; font-weight:bold; cursor:pointer;">
        Enroll Now - ₦${(course.price || 0).toLocaleString()}
      </button>
    </div>
  `;

  document.body.appendChild(modal);
}

// Initiate checkout (will be handled by checkout.js)
window.initiateCheckout = function(courseId, price) {
  console.log('Initiating checkout for course:', courseId);
  // Call the actual checkout function from checkout.js
  if (typeof window.startPurchase === 'function') {
    window.startPurchase(courseId);
  } else {
    console.error('startPurchase function not found. Make sure checkout.js is loaded.');
  }
};
// Export functions for use in other modules
export { loadCourses, filterCourses, searchCourses, getCourseDetails };


