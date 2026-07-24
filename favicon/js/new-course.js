// ====================================================================
// COURSES.JS - Multi-Lesson Course Listing
// Tech Wizards Academy
// ====================================================================

import { auth, db } from '../firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

// ====================================================================
// LOAD ALL COURSES
// ====================================================================
async function loadCourses() {
  try {
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    
    if (!courseInnerWrapper) {
      console.error('Course container not found');
      return;
    }

    courseInnerWrapper.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">Loading courses...</p>';

    const q = query(
      collection(db, 'courses'),
      where('isPublished', '==', true)
    );

    const querySnapshot = await getDocs(q);
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

// ====================================================================
// CREATE COURSE CARD
// ====================================================================
function createCourseCard(courseId, course) {
  const card = document.createElement('div');
  card.className = 'c-card';
  card.dataset.courseId = courseId;

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

  const shortDesc = course.shortDescription || course.description || 'No description available';
  const truncatedDesc = shortDesc.length > 100 
    ? shortDesc.substring(0, 100) + '...' 
    : shortDesc;

  const totalLessons = course.totalLessons || course.lessons?.length || 0;

  card.innerHTML = `
    <img src="${course.thumbnail || 'https://via.placeholder.com/300x200?text=Course+Image'}" 
         alt="${course.title}" 
         onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
    
    <h3 class="title">${course.title}</h3>
    
    <div class="active-learners">
      <ion-icon name="people-outline"></ion-icon> ${course.enrolledCount || 0} students • 
      <ion-icon name="book-outline"></ion-icon> ${totalLessons} lessons
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
       <ion-icon name="school-outline" style="font-size: 18px;"></ion-icon> Enroll Now
      </a>
    </div>
  `;

  return card;
}

// ====================================================================
// GET SINGLE COURSE DETAILS
// ====================================================================
async function getCourseDetails(courseId) {
  try {
    const courseDoc = await getDoc(doc(db, 'courses', courseId));
    
    if (courseDoc.exists()) {
      return { id: courseDoc.id, ...courseDoc.data() };
    }
    return null;
  } catch (error) {
    console.error('Error getting course details:', error);
    return null;
  }
}

// ====================================================================
// CHECK IF USER IS ENROLLED
// ====================================================================
async function checkEnrollment(userId, courseId) {
  try {
    const userDoc = await getDoc(doc(db, 'user', userId));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const enrolledCourses = userData.enrolledCourses || [];
      return enrolledCourses.some(c => c.courseId === courseId);
    }
    return false;
  } catch (error) {
    console.error('Error checking enrollment:', error);
    return false;
  }
}

// ====================================================================
// SHOW COURSE DETAILS MODAL
// ====================================================================
function showCourseModal(course) {
  const modal = document.createElement('div');
  modal.className = 'course-detail-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: px;
    backdrop-filter: blur(10px);
    animation: fadeIn 0.3s ease;
  `;

  const totalLessons = course.totalLessons || course.lessons?.length || 0;

  // Build lessons curriculum HTML
  let lessonsHTML = '';
  if (course.lessons && course.lessons.length > 0) {
    lessonsHTML = `
      <div style="margin-bottom:25px;">
        <h5 style="color:#fff; margin-bottom:15px; display:flex; align-items:center; font-size:1.5rem;">
          <ion-icon name="play-circle-outline" style="font-size:28px; margin-right:10px; color:#14b8a6;"></ion-icon>
          Course Curriculum (${course.lessons.length} Lessons)
        </h5>
        <div style="background:#1f2937; border-radius:12px; padding:5px; max-height:400px; overflow-y:auto; border:2px solid #374151;">
          ${course.lessons.map((lesson, index) => `
            <div style="padding:7px; margin-bottom:12px; background:#111827; border-radius:10px; border-left:4px solid #14b8a6; display:flex; justify-content:space-between; align-items:start; transition:all 0.3s ease;" onmouseover="this.style.transform='translateX(4px)'; this.style.background='#1f2937';" onmouseout="this.style.transform='translateX(0)'; this.style.background='#111827';">
              <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                  <span style="background:linear-gradient(135deg, #14b8a6 0%, #0f766e 100%); color:white; padding:4px 12px; border-radius:50%; font-size:12px; font-weight:700;">Lesson ${lesson.lessonNumber || index + 1}</span>
                  <h4 style="color:#fff; font-size:15px;">${lesson.title}</h4>
                </div>
                ${lesson.description ? `<p style="margin:6px 0 0 0; color:#9ca3af; font-size:13px; line-height:1.5;">${lesson.description}</p>` : ''}
              </div>

            </div>
          `).join('')}
        </div>
      </div>
    `;
  }





  modal.innerHTML = `
    <div style="background:linear-gradient(135deg, #111827 0%, #0a0a0a 100%); padding:10px; border-radius:20px; max-width:1000px; max-height:90vh; overflow-y:auto; width:100%; border:3px solid #14b8a6; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:25px;">
        <h4 style="color:#14b8a6; margin:0; font-size:2rem; font-weight:800;">${course.title}</h4>
        <button onclick="this.closest('.course-detail-modal').remove()" style="background:#374151; border:none; width:45px; height:45px; border-radius:50%; font-size:30px; cursor:pointer; color:#fff; transition:all 0.3s ease; display:flex; align-items:center; justify-content:center;" onmouseover="this.style.background='#ef4444'; this.style.transform='rotate(90deg)';" onmouseout="this.style.background='#374151'; this.style.transform='rotate(0)';">×</button>
      </div>
      
      <img src="${course.thumbnail}" alt="${course.title}" style="width:100%; height:350px; object-fit:cover; border-radius:16px; margin-bottom:30px; border:2px solid #14b8a6;">
      
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:30px;">
        <div style="background:linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding:20px; border-radius:12px; box-shadow:0 4px 12px rgba(20,184,166,0.3);">
          <strong style="color:#fff; font-size:14px; text-transform:uppercase; letter-spacing:1px;">Price</strong>
          <p style="font-size:32px; color:#fff; margin:8px 0 0 0; font-weight:800;">₦${(course.price || 0).toLocaleString()}</p>
        </div>
        <div style="background:linear-gradient(135deg, #059669 0%, #10b981 100%); padding:20px; border-radius:12px; box-shadow:0 4px 12px rgba(16,185,129,0.3);">
          <strong style="color:#fff; font-size:14px; text-transform:uppercase; letter-spacing:1px;">Students Enrolled</strong>
          <p style="font-size:32px; color:#fff; margin:8px 0 0 0; font-weight:800;">${course.enrolledCount || 0}</p>
        </div>
        <div style="background:linear-gradient(135deg, #d97706 0%, #f59e0b 100%); padding:20px; border-radius:12px; box-shadow:0 4px 12px rgba(245,158,11,0.3);">
          <strong style="color:#fff; font-size:14px; text-transform:uppercase; letter-spacing:1px;">Total Lessons</strong>
          <p style="font-size:32px; color:#fff; margin:8px 0 0 0; font-weight:800;">${totalLessons}</p>
        </div>
      </div>
      
      <div style="margin-bottom:25px; padding:20px; background:#1f2937; border-radius:12px; border:2px solid #374151;">
        <div style="margin-bottom:12px;">
          <h5 style="color:#14b8a6; font-size:15px;"> Instructor:</h5> 
          <span style="color:#e5e7eb; font-size:15px;"><ion-icon name="person-outline"></ion-icon> ${course.instructor || 'N/A'}</span>
        </div>
        <div style="margin-bottom:12px;">
          <h5 style="color:#14b8a6; font-size:15px;"><ion-icon name="podium-outline"></ion-icon> Level:</h5> 
          <span style="color:#e5e7eb; font-size:15px; text-transform:capitalize;">${course.level || 'beginner'}</span>
        </div>
        <div>
          <h5 style="color:#14b8a6; font-size:15px;"><ion-icon name="folder-open-outline"></ion-icon> Category:</h5> 
          <span style="color:#e5e7eb; font-size:15px; text-transform:capitalize;">${course.category?.replace('-', ' ') || 'N/A'}</span>
        </div>
      </div>
      
      <div style="margin-bottom:30px;">
        <h3 style="color:#fff; margin-bottom:12px; font-size:1.5rem;"><ion-icon name="book-outline"></ion-icon> Course Description</h3>
        <p style="color:#d1d5db; line-height:1.8; font-size:15px; background:#1f2937; padding:20px; border-radius:12px; border:2px solid #374151;">${course.description || 'No description available.'}</p>
      </div>
      
      ${lessonsHTML}
      
      <button onclick="window.initiateCheckout('${course.id}', ${course.price})" style="width:100%; padding:18px; background:linear-gradient(135deg, #14b8a6 0%, #0f766e 100%); color:white; border:none; border-radius:12px; font-size:20px; font-weight:700; cursor:pointer; transition:all 0.3s ease; box-shadow:0 4px 16px rgba(20,184,166,0.4);" onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 20px rgba(20,184,166,0.5)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 16px rgba(20,184,166,0.4)';">
        <ion-icon name="school-outline"></ion-icon> Enroll Now - ₦${(course.price || 0).toLocaleString()}
      </button>
    </div>
  `;

  document.body.appendChild(modal);
  
  // Add fade-in animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ====================================================================
// EVENT LISTENERS
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadCourses();

  // Filter courses
  const filterButtons = document.querySelectorAll('[data-filter-category]');
  filterButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const category = e.target.dataset.filterCategory;
      filterCourses(category);
    });
  });

  // Search courses
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
        // Check if user is logged in and enrolled
        const user = auth.currentUser;
        if (user) {
          const isEnrolled = await checkEnrollment(user.uid, courseId);
          if (isEnrolled) {
            // Redirect to course viewer
            window.location.href = `/course-viewer.html?courseId=${courseId}`;
            return;
          }
        }
        // Show enrollment modal
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
      initiateCheckout(courseId, price);
    }
  });
});

// ====================================================================
// INITIATE CHECKOUT// checkout.js will handle this functionality
// ====================================================================
window.initiateCheckout = function(courseId, price) {
  console.log('Initiating checkout for course:', courseId);
  if (typeof window.startPurchase === 'function') {
    window.startPurchase(courseId);
  } else {
    console.error('startPurchase function not found. Make sure checkout.js is loaded.');
    alert('Checkout system not available. Please contact support.');
  }
};

// ====================================================================
// FILTER COURSES BY CATEGORY
// ====================================================================
// ====================================================================
// FILTER COURSES BY CATEGORY
// ====================================================================
async function filterCourses(category) {
  try {
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    courseInnerWrapper.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">Loading courses...</p>';

    let q;
    if (category === 'all' || !category) {
      q = query(collection(db, 'courses'), where('isPublished', '==', true));
    } else {
      q = query(collection(db, 'courses'), where('isPublished', '==', true), where('category', '==', category));
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

// ====================================================================
// SEARCH COURSES
// ====================================================================
async function searchCourses(searchTerm) {
  try {
    const courseInnerWrapper = document.querySelector('.course-inner-wrapper');
    courseInnerWrapper.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">Searching...</p>';

    const q = query(collection(db, 'courses'), where('isPublished', '==', true));
    const querySnapshot = await getDocs(q);
    courseInnerWrapper.innerHTML = '';

    const searchLower = searchTerm.toLowerCase();
    let foundCourses = 0;

    querySnapshot.forEach((doc) => {
      const course = doc.data();
      const titleMatch = course.title?.toLowerCase().includes(searchLower);
      const descMatch = course.description?.toLowerCase().includes(searchLower);
      const categoryMatch = course.category?.toLowerCase().includes(searchLower);
      const instructorMatch = course.instructor?.toLowerCase().includes(searchLower);

      if (titleMatch || descMatch || categoryMatch || instructorMatch) {
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

export { loadCourses, filterCourses, searchCourses, getCourseDetails };




