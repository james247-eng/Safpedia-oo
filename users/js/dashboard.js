// ====================================================================
// STUDENT DASHBOARD - COMPLETE ENGINE (FIXED V6 - NO AFFILIATE LOGIC)
// Tech Wizards Academy — Key Board Wizards
// ====================================================================

import { auth, db } from '../../firebase-config.js';
import '../../js/notification-center.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { doc, getDoc, collection, getDocs, updateDoc } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

// ====================================================================
// GLOBAL STATE VARIABLES
// ====================================================================
let currentUser = null;
let enrolledCourses = [];
let isLoadingCourses = false;

// ====================================================================
// AUTHENTICATION LIFECYCLE MONITOR
// ====================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '../sign-in.html';
    return;
  }

  currentUser = user;
  console.log('✅ User authenticated:', user.email);

  try {
    const userEmailEl = document.getElementById('user-display-email');
    const avatarSlotEl = document.getElementById('admin-avatar-slot');
    
    if (userEmailEl) userEmailEl.textContent = user.email || "Student Account";
    if (avatarSlotEl) avatarSlotEl.textContent = (user.email || 'U').charAt(0).toUpperCase();
    
    // Master data sync pipelines
    await loadStudentDashboardData(user.uid);
    await checkPendingEnrollment();
    
  } catch (error) {
    console.error('❌ Error loading profile:', error);
    showError('Error loading your profile. Please refresh the page.');
  }
});

// ====================================================================
// CORE ENGINE & METRICS ROUTER
// ====================================================================
async function loadStudentDashboardData(userId) {
  if (isLoadingCourses) {
    console.log('⏳ Already loading inventory data, skipping...');
    return;
  }
  
  isLoadingCourses = true;

  try {
    console.log('📚 Loading user profile records for:', userId);
    
    const libraryGrid = document.getElementById('library-grid');
    if (!libraryGrid) {
      console.error('❌ Essential DOM element library-grid not found');
      isLoadingCourses = false;
      return;
    }

    // Set initial loading visual state
    libraryGrid.innerHTML = '<div class="loading-placeholder">Loading active Assets...</div>';

    // Fetch user document from Firestore
    const userDocSnap = await getDoc(doc(db, 'user', userId));
    if (!userDocSnap.exists()) {
      console.error('Operational runtime error: Security access mapping token reference missing.');
      showError('Profile tracking map not found.');
      isLoadingCourses = false;
      return;
    }

    const userData = userDocSnap.data();
    let enrolledCoursesData = userData.enrolledCourses || [];

    console.log('📋 Raw enrolled data payload:', enrolledCoursesData);

    // Normalize incoming data configurations safely
    const cleanedEnrollments = [];
    let needsUpdate = false;

    for (let i = 0; i < enrolledCoursesData.length; i++) {
      const enrollment = enrolledCoursesData[i];
      let normalized = null;

      if (typeof enrollment === 'string') {
        normalized = {
          courseId: enrollment,
          progress: 0,
          completedLessons: [],
          lastAccessedLesson: 0,
          isCompleted: false
        };
        needsUpdate = true;
      } else if (enrollment && typeof enrollment === 'object' && enrollment.courseId) {
        normalized = {
          courseId: enrollment.courseId,
          progress: enrollment.progress || 0,
          completedLessons: enrollment.completedLessons || [],
          lastAccessedLesson: enrollment.lastAccessedLesson || 0,
          isCompleted: enrollment.isCompleted || false
        };
        if (enrollment.lastAccessedAt) normalized.lastAccessedAt = enrollment.lastAccessedAt;
        if (enrollment.enrolledAt) normalized.enrolledAt = enrollment.enrolledAt;
        if (enrollment.completedAt) normalized.completedAt = enrollment.completedAt;
      } else {
        needsUpdate = true;
        continue;
      }

      if (normalized && normalized.courseId && typeof normalized.courseId === 'string' && normalized.courseId.trim().length > 0) {
        cleanedEnrollments.push(normalized);
      } else {
        needsUpdate = true;
      }
    }

    // Clean up DB schema structural arrays if anomalies were detected
    if (needsUpdate && cleanedEnrollments.length > 0) {
      try {
        await updateDoc(doc(db, 'user', userId), { enrolledCourses: cleanedEnrollments });
        console.log('✅ Cleaned enrollment schema updated in Firestore.');
      } catch (err) {
        console.error('❌ Error tracking normalization update:', err);
      }
    }

    enrolledCourses = [];

    // Query entire course inventory from db collection
    const coursesSnap = await getDocs(collection(db, 'courses'));
    libraryGrid.innerHTML = '';

    // If user has no courses and isn't an admin, break out to empty state view
    if (cleanedEnrollments.length === 0 && userData.role !== 'admin') {
      showEmptyState();
      isLoadingCourses = false;
      return;
    }

    coursesSnap.forEach(courseDoc => {
      const matchingEnrollment = cleanedEnrollments.find(e => e.courseId === courseDoc.id);
      
      // Render card if user owns the course or has admin role privileges
      if (matchingEnrollment || userData.role === 'admin') {
        const courseData = courseDoc.data();
        const fallbackEnrollment = {
          courseId: courseDoc.id,
          progress: 0,
          completedLessons: [],
          lastAccessedLesson: 0,
          isCompleted: false
        };
        
        const activeEnrollment = matchingEnrollment || fallbackEnrollment;
        
        enrolledCourses.push({
          courseId: courseDoc.id,
          course: courseData,
          ...activeEnrollment
        });
        
        const card = document.createElement('div');
        card.className = 'product-card';
        card.style.cssText = "background: white; border: 1px solid #33415598; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;";
        
        const progress = activeEnrollment.progress || 0;
        const totalLessons = courseData.totalLessons || courseData.lessons?.length || 0;
        const completedLessons = activeEnrollment.completedLessons?.length || 0;

        card.innerHTML = `
          <div style="position: relative; width: 100%; height: 160px; overflow: hidden; background: #e2e8f5;">
              <img src="${courseData.thumbnail || '../assets/img/placeholder.png'}" alt="Thumb" style="width: 100%; height: 100%; object-fit: cover;">
              <span class="badge-f ${courseData.formatType || 'video'}" style="position: absolute; top: 12px; right: 12px; background: #4f46e5; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase;">${courseData.formatType || 'VIDEO'}</span>
              ${activeEnrollment.isCompleted ? '<div style="position: absolute; bottom: 12px; left: 12px; background: #14b8a6; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;"><ion-icon name="checkmark-circle"></ion-icon> Completed</div>' : ''}
          </div>
          <div style="padding: 20px; flex-grow: 1; display: flex; flex-direction: column; gap: 12px;">
              <span style="font-size: 11px; color: #0059bf; font-weight: 700; letter-spacing: 0.05em;">${courseData.category?.replace('-', ' ').toUpperCase() || 'TRACK'}</span>
              <h3 style="font-size: 16px; font-weight: 600; color: #fff; margin: 0; line-height: 1.4;">${courseData.title}</h3>
              
              <div style="display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; margin-top: 4px;">
                <span><ion-icon name="book-outline"></ion-icon> ${completedLessons}/${totalLessons} Lessons</span>
                <span>${progress}% Complete</span>
              </div>

              <div style="width: 100%; background: #0f172a; height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="width: ${progress}%; background: #00bfa6; height: 100%; transition: width 0.3s;"></div>
              </div>

              <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px; pt: 8px;">
                <button class="nav-item-btn active" onclick="continueCourse('${courseDoc.id}')" style="width: 100%; justify-content: center; font-size: 14px; padding: 10px;">
                    <ion-icon name="${progress > 0 ? 'play' : 'play-circle'}-outline"></ion-icon>
                    ${progress > 0 ? 'Continue Learning' : 'Start Course'}
                </button>
                ${activeEnrollment.isCompleted ? `
                  <button class="nav-item-btn" onclick="viewCertificate('${courseDoc.id}')" style="width: 100%; justify-content: center; font-size: 14px; padding: 10px; background: #14b8a6; color: #fff;">
                    <ion-icon name="ribbon-outline"></ion-icon> Certificate
                  </button>
                ` : ''}
              </div>
          </div>
        `;
        libraryGrid.appendChild(card);
      }
    });

    // If nothing structural rendered because filters omitted entries
    if (libraryGrid.innerHTML === '') {
      showEmptyState();
    }

    // ------------------------------------------------------------
    // HISTORICAL PAYMENT TRANSACTION LOOP RECEIPTS
    // ------------------------------------------------------------
    const historyTable = document.getElementById('purchase-history-table');
    if (historyTable) {
      historyTable.innerHTML = '';
      const purchasesSnap = await getDocs(collection(db, 'user', userId, 'purchases'));
      
      if (purchasesSnap.empty) {
        historyTable.innerHTML = `
          <tr class="table-empty-block">
            <td colspan="4">
              <div class="empty-state-block">
                <div class="empty-icon"><ion-icon name="receipt-outline"></ion-icon></div>
                <h3>No purchases yet</h3>
                <p>Everything you buy on SAFpedia will show up here.</p>
                <a href="../all-courses.html" class="btn btn-primary"><ion-icon name="search-outline"></ion-icon> Browse the Library</a>
              </div>
            </td>
          </tr>
        `;
      } else {
        purchasesSnap.forEach(pDoc => {
          const pData = pDoc.data();
          const date = pData.lastAccessedAt ? pData.lastAccessedAt.toDate().toLocaleDateString() : 'Recent Transact';
          historyTable.innerHTML += `
              <tr>
                  <td><code>${pDoc.id.substring(0,12)}...</code></td>
                  <td>Course Asset Core Unit</td>
                  <td>₦${(pData.progress * 100 || 0).toLocaleString()} (Cleared)</td>
                  <td>${date}</td>
              </tr>
          `;
        });
      }
    }

  } catch (err) {
    console.error("Critical dashboard engine core rendering execution fault:", err);
    showError('Critical failure rendering inventory matrices.');
  } finally {
    isLoadingCourses = false;
  }
}

// ====================================================================
// CHECK FOR PENDING ENROLLMENT (Direct Checkout)
// ====================================================================
async function checkPendingEnrollment() {
  const pending = localStorage.getItem('pendingEnrollment');
  if (!pending) return;

  try {
    const data = JSON.parse(pending);
    if (!data.courseId) {
      localStorage.removeItem('pendingEnrollment');
      return;
    }

    const maxAge = 24 * 60 * 60 * 1000; 
    if (data.timestamp && (Date.now() - data.timestamp > maxAge)) {
      localStorage.removeItem('pendingEnrollment');
      return;
    }

    localStorage.removeItem('pendingEnrollment');
    showEnrollmentNotification(data);
    
    console.log('⏳ Waiting for checkout system modules...');
    const checkoutReady = await waitForCheckout(10000);
    
    if (checkoutReady && typeof window.startPurchase === 'function') {
      setTimeout(() => {
        console.log('💳 Triggering direct checkout for:', data.courseId);
        window.startPurchase(data.courseId);
      }, 1500);
    }
  } catch (error) {
    console.error('❌ Error processing pending enrollment:', error);
    localStorage.removeItem('pendingEnrollment');
  }
}

function waitForCheckout(maxWait = 10000) {
  return new Promise((resolve) => {
    if (typeof window.startPurchase === 'function') {
      resolve(true);
      return;
    }
    
    let waited = 0;
    const interval = setInterval(() => {
      if (typeof window.startPurchase === 'function') {
        clearInterval(interval);
        resolve(true);
        return;
      }
      waited += 100;
      if (waited >= maxWait) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

function showEnrollmentNotification(data) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%);
    color: white; padding: 20px 25px; border-radius: 12px; box-shadow: 0 10px 30px rgba(20, 184, 166, 0.3);
    z-index: 10000; max-width: 350px;
  `;
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <ion-icon name="information-circle" style="font-size: 24px;"></ion-icon>
      <div>
        <strong style="display: block; margin-bottom: 5px;">Continuing your enrollment...</strong>
        <span style="font-size: 14px; opacity: 0.95;">${data.courseTitle || 'Selected Course'}</span>
      </div>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => { notification.remove(); }, 3000);
}

// ====================================================================
// GLOBAL RUNTIME INTERACTION ROUTERS
// ====================================================================
window.continueCourse = function(courseId) {
  window.location.href = `./course-viewer.html?courseId=${courseId}`;
};

window.switchDashboardTab = function(targetTabId, element) {
  document.querySelectorAll('.dashboard-section-card').forEach(tab => tab.classList.remove('active-tab'));
  document.querySelectorAll('.nav-item-btn').forEach(btn => btn.classList.remove('active'));
  
  const target = document.getElementById(targetTabId);
  if (target) target.classList.add('active-tab');
  if (element) element.classList.add('active');
};

// ====================================================================
// CERTIFICATE ISSUANCE SYSTEM ARCHITECTURE
// ====================================================================
window.viewCertificate = async function(courseId) {
  const enrollment = enrolledCourses.find(e => e.courseId === courseId);
  if (!enrollment || !enrollment.isCompleted) {
    alert('Course metrics indicate milestone incomplete.');
    return;
  }

  await generateCertificate(enrollment);
  const certModal = document.getElementById('certificate-modal');
  if (certModal) certModal.classList.add('open');
};

async function generateCertificate(enrollment) {
  try {
    const userDoc = await getDoc(doc(db, 'user', currentUser.uid));
    const userData = userDoc.data();
    const userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || currentUser.email.split('@')[0];
    
    const canvas = document.getElementById('certificate-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 600;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 12;
    ctx.strokeRect(15, 15, 770, 570);
    
    ctx.fillStyle = '#0a0a0a';
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CERTIFICATE', 400, 110);
    
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillStyle = '#14b8a6';
    ctx.fillText(userName, 400, 280);

    ctx.font = 'bold 32px Arial, sans-serif';
    ctx.fillStyle = '#0a0a0a';
    ctx.fillText(enrollment.course.title || 'Course Track', 400, 385);
  } catch (error) {
    console.error('❌ Certificate system fault tracking context:', error);
  }
}

// ====================================================================
// VIEW STATE RESPONSES
// ====================================================================
function showEmptyState() {
  const libraryGrid = document.getElementById('library-grid');
  if (!libraryGrid) return;
  libraryGrid.innerHTML = `
    <div class="empty-state-block">
      <div class="empty-icon"><ion-icon name="school-outline"></ion-icon></div>
      <h3>No courses yet</h3>
      <p>You haven't enrolled in anything yet. Browse the library to find your first course.</p>
      <a href="../all-courses.html" class="btn btn-primary"><ion-icon name="search-outline"></ion-icon> Browse the Library</a>
    </div>
  `;
}

function showError(message) {
  const libraryGrid = document.getElementById('library-grid');
  if (!libraryGrid) return;
  libraryGrid.innerHTML = `<div style="grid-column: 1/-1; color: #ef4444; text-align: center; padding: 40px 0;"><ion-icon name="alert-circle-outline" style="font-size: 32px;"></ion-icon><p>${message}</p></div>`;
}

// ====================================================================
// APPLICATION EXIT DESTRUCTION INTERACTION
// ====================================================================
const logoutTrigger = document.getElementById('user-logout-trigger');
if (logoutTrigger) {
  logoutTrigger.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await signOut(auth);
      window.location.href = '../sign-in.html';
    } catch (err) {
      console.error("Signout error encounter trace execution path:", err);
    }
  });
}

// Page visibility tracking updates
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser && !isLoadingCourses) {
    loaduserDashboardData(currentUser.uid);
  }
});

// ====================================================================
// DEEP-LINK TAB ROUTING (additive)
// Lets other dashboard pages (affiliate.html, sellers-page.html) send a
// user straight to a specific tab here — e.g. linking to
// "dashboard.html#history-pane" opens Purchase History immediately
// instead of landing on the default tab and making them click again.
// Reuses the existing window.switchDashboardTab; no existing tab logic
// is changed.
// ====================================================================
function openTabFromHash() {
  const targetId = window.location.hash.slice(1);
  if (!targetId) return;

  const targetSection = document.getElementById(targetId);
  if (!targetSection || !targetSection.classList.contains('dashboard-section-card')) return;

  const targetBtn = document.querySelector(`.nav-item-btn[data-tab="${targetId}"]`);
  window.switchDashboardTab(targetId, targetBtn);
}

window.addEventListener('DOMContentLoaded', openTabFromHash);
window.addEventListener('hashchange', openTabFromHash);
