
// ====================================================================
// SINGLE COURSE HANDLER - LocalStorage Enrollment Flow
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
    console.log('Initializing course page:', courseId);

    // Show loading state
    showLoadingState();
    
    // Fetch course data from Firestore
    const courseDoc = await getDoc(doc(db, 'courses', courseId));
    
    if (!courseDoc.exists()) {
      console.error(' Course not found:', courseId);
      showErrorState('Course not found. Please contact support.');
      return;
    }

    const course = courseDoc.data();
    console.log('✅ Course loaded:', course.title);

    // Update page title and meta description
    document.title = `${course.title} | Tech Wizards Academy`;
    
    // Update meta description if exists
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.content = course.shortDescription || course.description || '';
    }

    // ⭐ UPDATE HERO SECTION (for both static and dynamic pages)
    const heroTitle = document.getElementById('course-title-hero');
    const heroSubtitle = document.getElementById('course-subtitle');
    
    if (heroTitle) {
      heroTitle.textContent = course.title;
    }
    
    if (heroSubtitle) {
      heroSubtitle.textContent = course.shortDescription || course.description?.substring(0, 150) + '...' || 'Learn in-demand skills';
    }

    // ⭐ UPDATE COURSE DESCRIPTION
    const descElement = document.getElementById('course-description');
    if (descElement) {
      descElement.textContent = course.description || 'No description available.';
    }

    // ⭐ UPDATE INSTRUCTOR
    const instructorElement = document.getElementById('course-instructor');
    if (instructorElement) {
      instructorElement.textContent = course.instructor || 'Tech Wizards Academy';
    }

    // ⭐ UPDATE CATEGORY
    const categoryElement = document.getElementById('course-category');
    if (categoryElement) {
      const categoryText = (course.category || 'general').replace('-', ' ');
      categoryElement.textContent = categoryText.charAt(0).toUpperCase() + categoryText.slice(1);
    }

    // ⭐ UPDATE DURATION (calculate from lessons)
    const durationElement = document.getElementById('course-duration');
    if (durationElement) {
      const lessons = course.lessons || [];
      const totalMinutes = lessons.reduce((sum, lesson) => {
        const duration = lesson.duration || '0 min';
        const minutes = parseInt(duration) || 0;
        return sum + minutes;
      }, 0);
      
      if (totalMinutes > 0) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        durationElement.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
      } else {
        durationElement.textContent = 'Self-paced';
      }
    }

    // Update all dynamic price elements
    updatePriceElements(course.price);

    // Load curriculum if container exists
    loadCurriculum(course.lessons || []);

    // Update course stats
    updateCourseStats(course);

    // Check if user is enrolled
    await checkEnrollmentStatus(courseId);

    // Attach enrollment handlers to all buttons
    attachEnrollmentHandlers(courseId, course.title);

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

  console.log('Price updated:', formattedPrice);
}

/**
 * Load and display course curriculum
 */
function loadCurriculum(lessons) {
  const curriculumContainer = document.getElementById('curriculum-list');
  
  if (!curriculumContainer) {
    console.log(' No curriculum container found (optional)');
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
          <div style="display:flex; gap:15px; align-items:center; font-size:13px; color:#9ca3af; flex-wrap:wrap;">
            ${lesson.duration ? `<span><ion-icon name="time-outline"></ion-icon> ${lesson.duration}</span>` : ''}
            ${contentTypeBadge(lesson)}
          </div>
          ${liveSessionScheduleLine(lesson)}
        </div>
      </div>
    </div>
  `).join('');

  console.log(`Loaded ${lessons.length} lessons`);
}

/**
 * Content-type badge for the curriculum preview — shows what kind of lesson
 * this is (video/audio/pdf/live) so prospective users know what they're buying.
 * Falls back to "Video Lesson" for older lessons saved before contentType existed.
 */
function contentTypeBadge(lesson) {
  const type = lesson.contentType || 'video';
  const badges = {
    video: '<span><ion-icon name="play-circle-outline"></ion-icon> Video Lesson</span>',
    audio: '<span><ion-icon name="headset-outline"></ion-icon> Audio Lesson</span>',
    pdf: '<span><ion-icon name="document-outline"></ion-icon> PDF Resource</span>',
    live: '<span style="color:#ef4444; font-weight:600;"><ion-icon name="radio-outline"></ion-icon> Live Session</span>'
  };
  return badges[type] || badges.video;
}

/**
 * For 'live' lessons, shows the scheduled date/time under the badge row on the
 * sales page, so prospective users know when the class actually happens.
 */
function liveSessionScheduleLine(lesson) {
  if ((lesson.contentType || 'video') !== 'live' || !lesson.scheduledAt) return '';

  const scheduledDate = new Date(lesson.scheduledAt);
  const dateText = scheduledDate.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

  return `
    <p style="margin:8px 0 0 0; font-size:13px; color:#ef4444;">
      <ion-icon name="calendar-outline"></ion-icon> Scheduled for ${dateText}
    </p>
  `;
}
function updateCourseStats(course) {
  const statsElements = {
    'total-lessons': course.totalLessons || course.lessons?.length || 0,
    'enrolled-count': course.enrolledCount || '1.1k',
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
        console.log('User not logged in');
        updateEnrollButtons('login', courseId);
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
            console.log('User is enrolled');
            updateEnrollButtons('enrolled', courseId);
            resolve(true);
          } else {
            console.log('User not enrolled');
            updateEnrollButtons('enroll', courseId);
            resolve(false);
          }
        } else {
          updateEnrollButtons('enroll', courseId);
          resolve(false);
        }
      } catch (error) {
        console.error('Error checking enrollment:', error);
        updateEnrollButtons('enroll', courseId);
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
        window.location.href = '/users/dashboard.html';
      };
    } else if (status === 'login') {
      btn.innerHTML = '<ion-icon name="log-in-outline"></ion-icon> Login to Enroll';
      btn.onclick = (e) => {
        e.preventDefault();
        // ⭐ SAVE TO LOCALSTORAGE INSTEAD OF URL
        savePendingEnrollment(courseId);
        window.location.href = '/sign-in.html';
      };
    } else {
      // Default enroll state
      btn.innerHTML = btn.innerHTML; // Keep original content
    }
  });
}

/**
 * Attach click handlers to all enrollment buttons
 */
function attachEnrollmentHandlers(courseId, courseTitle) {
  const buttons = document.querySelectorAll('.enroll-btn');
  
  buttons.forEach(btn => {
    // Only attach if not already modified by updateEnrollButtons
    if (!btn.onclick) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Check if user is logged in
        const user = auth.currentUser;
        if (!user) {
          console.log(' User not logged in, saving enrollment and redirecting...');
          // ⭐ SAVE TO LOCALSTORAGE
          savePendingEnrollment(courseId, courseTitle);
          window.location.href = '/sign-in.html';
          return;
        }

        // Start purchase process
        console.log(' Starting purchase for:', courseId);
        if (typeof window.startPurchase === 'function') {
          window.startPurchase(courseId);
        } else {
          console.error('❌ startPurchase function not found');
          alert('Checkout system not available. Please refresh the page.');
        }
      });
    }
  });

  console.log(` Attached handlers to ${buttons.length} enroll button(s)`);
}

/**
 * ⭐ SAVE PENDING ENROLLMENT TO LOCALSTORAGE
 */
function savePendingEnrollment(courseId, courseTitle = 'Selected Course') {
  const enrollmentData = {
    courseId: courseId,
    courseTitle: courseTitle,
    timestamp: Date.now(),
    returnUrl: window.location.href
  };

  localStorage.setItem('pendingEnrollment', JSON.stringify(enrollmentData));
  console.log('Saved pending enrollment:', enrollmentData);
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

console.log('✅ Single Course Handler loaded (LocalStorage version)');