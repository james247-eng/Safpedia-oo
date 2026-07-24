// ====================================================================
// SINGLE COURSE HANDLER - Handles Individual Course Pages
// Tech Wizards Academy
// ====================================================================

import { auth, db } from '/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';
import '/js/checkout.js';

/**
 * Initialize a single course page
 * @param {string} courseId - The Firestore document ID of the course
 */
export async function initCoursePage(courseId) {
  try {
    console.log('🚀 Initializing course page:', courseId);

    // Show loading state
    showLoadingState();

    // Fetch course data from Firestore
    const courseDoc = await getDoc(doc(db, 'courses', courseId));
    
    if (!courseDoc.exists()) {
      console.error('❌ Course not found:', courseId);
      showErrorState('Course not found. Please contact support.');
      return;
    }

    const course = courseDoc.data();
    console.log('✅ Course loaded:', course.title);

    // Update page title
    document.title = `${course.title} | Tech Wizards Academy`;

    // Update all dynamic price elements
    updatePriceElements(course.price);

    // Load curriculum if container exists
    loadCurriculum(course.lessons || []);

    // Update course stats
    updateCourseStats(course);

    // Check if user is enrolled
    await checkEnrollmentStatus(courseId);

    // Attach enrollment handlers to all buttons
    attachEnrollmentHandlers(courseId);

    // Hide loading state
    hideLoadingState();

    console.log('✅ Course page initialized successfully');

  } catch (error) {
    console.error('❌ Error initializing course page:', error);
    showErrorState('Error loading course. Please refresh the page.');
  }
}

/**
 * Update all price display elements
 */
function updatePriceElements(price) {
  const formattedPrice = `₦${price.toLocaleString()}`;
  
  document.querySelectorAll('.course-price').forEach(el => {
    el.textContent = formattedPrice;
  });

  document.querySelectorAll('[data-price]').forEach(el => {
    el.dataset.price = price;
    if (el.textContent.includes('₦')) {
      el.textContent = el.textContent.replace(/₦[\d,]+/, formattedPrice);
    }
  });

  console.log('💰 Price updated:', formattedPrice);
}

/**
 * Load and display course curriculum
 */
function loadCurriculum(lessons) {
  const curriculumContainer = document.getElementById('curriculum-list');
  
  if (!curriculumContainer) {
    console.log('ℹ️ No curriculum container found (optional)');
    return;
  }

  if (!lessons || lessons.length === 0) {
    curriculumContainer.innerHTML = `
      <p style="text-align:center; color:#999; padding:20px;">
        Curriculum details coming soon
      </p>
    `;
    return;
  }

  curriculumContainer.innerHTML = lessons.map((lesson, index) => `
    <div class="lesson-item" style="padding:20px; margin-bottom:15px; background:#f9fafb; border-radius:12px; border-left:4px solid #14b8a6; transition:all 0.3s ease;">
      <div style="display:flex; align-items:start; gap:15px;">
        <div style="background:#14b8a6; color:white; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; flex-shrink:0;">
          ${index + 1}
        </div>
        <div style="flex:1;">
          <h4 style="margin:0 0 8px 0; color:#1a1f36; font-size:18px;">${lesson.title}</h4>
          ${lesson.description ? `<p style="margin:0 0 8px 0; color:#6b7280; font-size:14px; line-height:1.6;">${lesson.description}</p>` : ''}
          <div style="display:flex; gap:15px; align-items:center; font-size:13px; color:#9ca3af;">
            ${lesson.duration ? `<span><ion-icon name="time-outline"></ion-icon> ${lesson.duration}</span>` : ''}
            <span><ion-icon name="play-circle-outline"></ion-icon> Video Lesson</span>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  console.log(`📚 Loaded ${lessons.length} lessons`);
}

/**
 * Update course statistics
 */
function updateCourseStats(course) {
  const statsElements = {
    'total-lessons': course.totalLessons || course.lessons?.length || 0,
    'enrolled-count': course.enrolledCount || 0,
    'course-level': course.level || 'Beginner',
    'course-category': course.category || 'General'
  };

  Object.entries(statsElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      if (typeof value === 'string') {
        element.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      } else {
        element.textContent = value;
      }
    }
  });
}

/**
 * Check if user is already enrolled
 */
async function checkEnrollmentStatus(courseId) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.log('👤 User not logged in');
        updateEnrollButtons('login');
        resolve(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'user', user.uid));
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          const enrolledCourses = userData.enrolledCourses || [];
          
          // Check if user is enrolled (handle both string and object formats)
          const isEnrolled = enrolledCourses.some(enrollment => {
            if (typeof enrollment === 'string') {
              return enrollment === courseId;
            }
            return enrollment.courseId === courseId;
          });

          if (isEnrolled) {
            console.log('✅ User is enrolled');
            updateEnrollButtons('enrolled', courseId);
            resolve(true);
          } else {
            console.log('📝 User not enrolled');
            updateEnrollButtons('enroll');
            resolve(false);
          }
        } else {
          updateEnrollButtons('enroll');
          resolve(false);
        }
      } catch (error) {
        console.error('Error checking enrollment:', error);
        updateEnrollButtons('enroll');
        resolve(false);
      }
    });
  });
}

/**
 * Update enrollment buttons based on status
 */
function updateEnrollButtons(status, courseId = null) {
  const buttons = document.querySelectorAll('.enroll-btn');
  
  buttons.forEach(btn => {
    if (status === 'enrolled') {
      btn.innerHTML = '<ion-icon name="checkmark-circle"></ion-icon> Already Enrolled - Go to Dashboard';
      btn.style.background = '#10b981';
      btn.onclick = (e) => {
        e.preventDefault();
        window.location.href = '/students/dashboard.html';
      };
    } else if (status === 'login') {
      btn.innerHTML = '<ion-icon name="log-in-outline"></ion-icon> Login to Enroll';
      btn.onclick = (e) => {
        e.preventDefault();
        window.location.href = '/sign-in.html';
      };
    } else {
      // Default enroll state - will be handled by attachEnrollmentHandlers
      btn.innerHTML = btn.innerHTML; // Keep original content
    }
  });
}

/**
 * Attach click handlers to all enrollment buttons
 */
function attachEnrollmentHandlers(courseId) {
  const buttons = document.querySelectorAll('.enroll-btn');
  
  buttons.forEach(btn => {
    // Only attach if not already modified by updateEnrollButtons
    if (!btn.onclick) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Check if user is logged in
        const user = auth.currentUser;
        if (!user) {
          console.log('⚠️ User not logged in, redirecting...');
          window.location.href = '/sign-in.html';
          return;
        }

        // Start purchase process
        console.log('💳 Starting purchase for:', courseId);
        if (typeof window.startPurchase === 'function') {
          window.startPurchase(courseId);
        } else {
          console.error('❌ startPurchase function not found');
          alert('Checkout system not available. Please refresh the page.');
        }
      });
    }
  });

  console.log(`🔗 Attached handlers to ${buttons.length} enroll button(s)`);
}

/**
 * Show loading state
 */
function showLoadingState() {
  const loadingIndicator = document.getElementById('page-loading');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'flex';
  }
}

/**
 * Hide loading state
 */
function hideLoadingState() {
  const loadingIndicator = document.getElementById('page-loading');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }
}

/**
 * Show error state
 */
function showErrorState(message) {
  const errorContainer = document.getElementById('error-container');
  if (errorContainer) {
    errorContainer.innerHTML = `
      <div style="text-align:center; padding:40px;">
        <ion-icon name="alert-circle-outline" style="font-size:4rem; color:#ef4444;"></ion-icon>
        <h3 style="color:#ef4444; margin:20px 0 10px 0;">Error</h3>
        <p style="color:#6b7280;">${message}</p>
        <button onclick="location.reload()" style="margin-top:20px; padding:12px 24px; background:#14b8a6; color:white; border:none; border-radius:8px; cursor:pointer;">
          Retry
        </button>
      </div>
    `;
    errorContainer.style.display = 'block';
  }
  hideLoadingState();
}

console.log('✅ Single Course Handler loaded');

