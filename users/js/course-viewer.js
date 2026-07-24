// ====================================================================
// COURSE VIEWER - Multi-Lesson System with Universal Video Support
// Safpedia
// ====================================================================

import { auth, db } from '../../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { doc, getDoc, updateDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';


// Global Variables
let currentUser = null;
let currentCourse = null;
let userProgress = null;
let currentLessonIndex = 0;

// ====================================================================
// AUTHENTICATION & INITIALIZATION
// ====================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '/sign-in.html';
    return;
  }

  currentUser = user;
  await initializeCourseViewer();
});

// Initialize Course Viewer
async function initializeCourseViewer() {
  try {
    showLoading(true);

    // Get course ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('courseId');

    if (!courseId) {
      showNotification('No course specified', 'error');
      setTimeout(() => window.location.href = './dashboard.html', 2000);
      return;
    }

    // Load course data
    const courseDoc = await getDoc(doc(db, 'courses', courseId));
    if (!courseDoc.exists()) {
      showNotification('Course not found', 'error');
      setTimeout(() => window.location.href = './dashboard.html', 2000);
      return;
    }

    currentCourse = { id: courseDoc.id, ...courseDoc.data() };

    // Verify user owns this course
    const hasAccess = await verifyAccess();
    if (!hasAccess) {
      showNotification('You do not have access to this course', 'error');
      setTimeout(() => window.location.href = '/all-courses.html', 2000);
      return;
    }

    // Load user progress
    await loadUserProgress();

    // Render UI
    renderCourseInfo();
    renderLessonsList();
    updateProgressBadge();

    // Load first available lesson
    loadFirstAvailableLesson();

    showLoading(false);

  } catch (error) {
    console.error('Error initializing viewer:', error);
    showNotification('Error loading course: ' + error.message, 'error');
    showLoading(false);
  }
}

// ====================================================================
// VERIFY ACCESS
// ====================================================================
async function verifyAccess() {
  try {
    const userDoc = await getDoc(doc(db, 'user', currentUser.uid));
    if (!userDoc.exists()) return false;

    const userData = userDoc.data();
    const enrolledCourses = userData.enrolledCourses || [];
    
    // Handle both string and object formats
    return enrolledCourses.some(c => {
      if (typeof c === 'string') {
        return c === currentCourse.id;
      } else if (c && typeof c === 'object') {
        return c.courseId === currentCourse.id;
      }
      return false;
    });
  } catch (error) {
    console.error('Error verifying access:', error);
    return false;
  }
}
// ====================================================================
// LOAD USER PROGRESS
// ====================================================================
async function loadUserProgress() {
  try {
    const userDoc = await getDoc(doc(db, 'user', currentUser.uid));
    if (!userDoc.exists()) {
      throw new Error('User data not found');
    }

    const userData = userDoc.data();
    const enrolledCourses = userData.enrolledCourses || [];
    
    // Find progress for current course
    userProgress = enrolledCourses.find(c => c.courseId === currentCourse.id);

    if (!userProgress) {
      // Initialize progress if not found
      userProgress = {
        courseId: currentCourse.id,
        enrolledAt: Timestamp.now(),
        completedLessons: [],
        lastAccessedLesson: 0,
        progress: 0,
        isCompleted: false
      };
      
      // Save initial progress
      await updateDoc(doc(db, 'user', currentUser.uid), {
        enrolledCourses: [...enrolledCourses, userProgress]
      });
    }

  } catch (error) {
    console.error('Error loading progress:', error);
    throw error;
  }
}

// ====================================================================
// RENDER COURSE INFO
// ====================================================================
function renderCourseInfo() {
  document.getElementById('course-title').textContent = currentCourse.title;
  document.getElementById('lesson-count').textContent = 
    `${currentCourse.lessons?.length || 0} Lessons`;
}

// ====================================================================
// RENDER LESSONS LIST
// ====================================================================
function renderLessonsList() {
  const lessonsList = document.getElementById('lessons-list');
  lessonsList.innerHTML = '';

  if (!currentCourse.lessons || currentCourse.lessons.length === 0) {
    lessonsList.innerHTML = `
      <div class="loading-state">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <p>No lessons available</p>
      </div>
    `;
    return;
  }

  currentCourse.lessons.forEach((lesson, index) => {
    const isCompleted = userProgress.completedLessons.includes(index);
    const isLocked = index > 0 && !userProgress.completedLessons.includes(index - 1);
    const isActive = index === currentLessonIndex;

    const lessonItem = document.createElement('div');
    lessonItem.className = `lesson-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${isLocked ? 'locked' : ''}`;
    lessonItem.dataset.index = index;

    let statusIcon = '';
    let statusText = '';
    
    if (isCompleted) {
      statusIcon = '<ion-icon name="checkmark-circle"></ion-icon>';
      statusText = 'Completed';
    } else if (isLocked) {
      statusIcon = '<ion-icon name="lock-closed"></ion-icon>';
      statusText = 'Locked';
    } else {
      statusIcon = '<ion-icon name="play-circle-outline"></ion-icon>';
      statusText = 'Start';
    }

    lessonItem.innerHTML = `
      <div class="lesson-number">${index + 1}</div>
      <div class="lesson-details">
        <h4>${contentTypeIcon(lesson.contentType)} ${lesson.title}</h4>
        <div class="lesson-meta">
          <span><ion-icon name="time-outline"></ion-icon> ${lesson.duration || 'N/A'}</span>
          <span class="lesson-status">
            ${statusIcon}
            ${statusText}
          </span>
        </div>
      </div>
    `;

    if (!isLocked) {
      lessonItem.addEventListener('click', () => loadLesson(index));
    }

    lessonsList.appendChild(lessonItem);
  });
}

// ====================================================================
// CONTENT TYPE ICON (small glyph shown next to lesson title in sidebar)
// ====================================================================
function contentTypeIcon(contentType) {
  const icons = {
    video: '<ion-icon name="videocam-outline" style="font-size:14px; vertical-align:-2px;"></ion-icon>',
    audio: '<ion-icon name="headset-outline" style="font-size:14px; vertical-align:-2px;"></ion-icon>',
    pdf: '<ion-icon name="document-outline" style="font-size:14px; vertical-align:-2px;"></ion-icon>',
    live: '<ion-icon name="radio-outline" style="font-size:14px; vertical-align:-2px; color:#FF3B5C;"></ion-icon>'
  };
  return icons[contentType] || icons.video;
}

// ====================================================================
// LOAD LESSON
// ====================================================================
function loadLesson(index) {
  if (index < 0 || index >= currentCourse.lessons.length) return;

  const lesson = currentCourse.lessons[index];
  const isCompleted = userProgress.completedLessons.includes(index);

  currentLessonIndex = index;

  // Update UI
  document.getElementById('current-lesson-title').textContent = lesson.title;
  document.getElementById('current-lesson-description').textContent = 
    lesson.description || 'Watch this lesson to continue your learning journey.';

  // Load lesson content based on its type (video/audio/pdf/live) — falls back
  // to video for older lessons saved before contentType existed
  loadLessonContent(lesson);

  // Show/hide buttons
  const markCompleteBtn = document.getElementById('mark-complete-btn');
  const nextLessonBtn = document.getElementById('next-lesson-btn');

  if (isCompleted) {
    markCompleteBtn.style.display = 'none';
    nextLessonBtn.style.display = index < currentCourse.lessons.length - 1 ? 'inline-flex' : 'none';
  } else {
    markCompleteBtn.style.display = 'inline-flex';
    nextLessonBtn.style.display = 'none';
  }

  // Update sidebar
  renderLessonsList();

  // Update last accessed lesson
  updateLastAccessedLesson(index);
}

// ====================================================================
// CONTENT-TYPE DISPATCHER
// Routes to the right renderer based on lesson.contentType.
// Lessons saved before this update have no contentType field and always
// used videoUrl — treat those as 'video' so nothing breaks retroactively.
// ====================================================================
function loadLessonContent(lesson) {
  const contentType = lesson.contentType || 'video';

  if (contentType === 'video') {
    loadVideoPlayer(lesson.contentUrl || lesson.videoUrl);
  } else if (contentType === 'audio') {
    loadAudioPlayer(lesson.contentUrl);
  } else if (contentType === 'pdf') {
    loadPdfViewer(lesson.contentUrl);
  } else if (contentType === 'live') {
    loadLiveSession(lesson);
  } else {
    loadVideoPlayer(lesson.contentUrl || lesson.videoUrl);
  }
}

// ====================================================================
// AUDIO PLAYER
// ====================================================================
function loadAudioPlayer(audioUrl) {
  const container = document.getElementById('video-container');

  if (!audioUrl) {
    container.innerHTML = `
      <div class="video-placeholder">
        <ion-icon name="musical-notes-outline"></ion-icon>
        <p>No audio available for this lesson</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="audio-player-wrapper">
      <ion-icon name="headset-outline" class="audio-icon"></ion-icon>
      <audio controls controlsList="nodownload" style="width:100%; max-width:500px;">
        <source src="${audioUrl}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
    </div>
  `;
}

// ====================================================================
// PDF VIEWER
// ====================================================================
function loadPdfViewer(pdfUrl) {
  const container = document.getElementById('video-container');

  if (!pdfUrl) {
    container.innerHTML = `
      <div class="video-placeholder">
        <ion-icon name="document-outline"></ion-icon>
        <p>No PDF available for this lesson</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="pdf-viewer-wrapper">
      <iframe src="${pdfUrl}" style="width:100%; height:100%; border:none;"></iframe>
      <a href="${pdfUrl}" target="_blank" class="btn btn-secondary pdf-open-tab-btn">
        <ion-icon name="open-outline"></ion-icon> Open in New Tab
      </a>
    </div>
  `;
}

// ====================================================================
// LIVE SESSION (ZOOM)
// ====================================================================
function loadLiveSession(lesson) {
  const container = document.getElementById('video-container');

  if (!lesson.zoomJoinUrl) {
    container.innerHTML = `
      <div class="video-placeholder">
        <ion-icon name="videocam-outline"></ion-icon>
        <p>This live session hasn't been scheduled yet</p>
      </div>
    `;
    return;
  }

  const scheduledDate = lesson.scheduledAt ? new Date(lesson.scheduledAt) : null;
  const dateText = scheduledDate
    ? scheduledDate.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })
    : 'Schedule to be confirmed';

  container.innerHTML = `
    <div class="live-session-wrapper">
      <ion-icon name="videocam" class="live-icon"></ion-icon>
      <h3>Live Class Session</h3>
      <p class="live-session-time">${dateText}</p>
      <a href="${lesson.zoomJoinUrl}" target="_blank" class="btn btn-primary live-join-btn">
        <ion-icon name="log-in-outline"></ion-icon> Join Zoom Session
      </a>
      <p class="live-session-note">The join button works once the host starts the session.</p>
    </div>
  `;
}

// ====================================================================
// UNIVERSAL VIDEO PLAYER - Supports All Major Formats
// ====================================================================
function loadVideoPlayer(videoUrl) {
  const container = document.getElementById('video-container');
  
  if (!videoUrl) {
    container.innerHTML = `
      <div class="video-placeholder">
        <ion-icon name="videocam-off-outline"></ion-icon>
        <p>No video available for this lesson</p>
      </div>
    `;
    return;
  }

  let playerHTML = '';

  // YouTub


// YouTube (OPTIMIZED - No Console Warnings)
if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
  const videoId = extractYouTubeId(videoUrl);
  playerHTML = `
    <iframe 
      src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&showinfo=0&controls=1&fs=1&iv_load_policy=3&playsinline=1" 
      title="Course Video"
      frameborder="0" 
      allowfullscreen 
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
      referrerpolicy="strict-origin-when-cross-origin"
      loading="lazy"
      style="width:100%; height:100%; border:none; border-radius:12px;"
    ></iframe>
  `;
}






  // Vimeo
  else if (videoUrl.includes('vimeo.com')) {
    const videoId = extractVimeoId(videoUrl);
    playerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&showinfo=0&controls=1&disablekb=1&fs=1&iv_load_policy=3&cc_load_policy=0&playsinline=1" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`;
    // playerHTML = `<iframe src="https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0" frameborder="0" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>`;
  }
  // Streamable
  else if (videoUrl.includes('streamable.com')) {
    const videoId = extractStreamableId(videoUrl);
    playerHTML = `<iframe src="https://streamable.com/e/${videoId}?autoplay=1" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
  }
  // Dailymotion
  else if (videoUrl.includes('dailymotion.com')) {
    const videoId = extractDailymotionId(videoUrl);
    playerHTML = `<iframe src="https://www.dailymotion.com/embed/video/${videoId}" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
  }
  // Wistia
  else if (videoUrl.includes('wistia.com')) {
    const videoId = extractWistiaId(videoUrl);
    playerHTML = `<iframe src="https://fast.wistia.net/embed/iframe/${videoId}" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
  }
  /*
  // Google Drive
  else
     if (videoUrl.includes('drive.google.com')) {
    const fileId = extractGoogleDriveId(videoUrl);
    pla
    yerHTML = `<iframe src="https://drive.google.com/file/d/${fileId}/preview" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
  }*/

    



// Google Drive (IMPROVED)
else if (videoUrl.includes('drive.google.com')) {
  const fileId = extractGoogleDriveId(videoUrl);
  if (fileId) {
    // Use preview mode with better parameters
    playerHTML = `<iframe 
      src="https://drive.google.com/file/d/${fileId}/preview?autoplay=0&controls=1" 
      frameborder="0" 
      allowfullscreen 
      allow="autoplay; fullscreen"
      style="border: none; border-radius: 12px;"
    ></iframe>`;
  } else {
    playerHTML = `
      <div class="video-placeholder">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <p>Invalid Google Drive link</p>
        <a href="${videoUrl}" target="_blank" class="btn btn-primary" style="margin-top:1rem;">Open in Google Drive</a>
      </div>
    `;
  }
}

/*============================================*/




  // Dropbox
  else if (videoUrl.includes('dropbox.com')) {
    const modifiedUrl = videoUrl.replace('dl=0', 'raw=1');
    playerHTML = `<video controls autoplay style="width:100%; height:100%;"><source src="${modifiedUrl}" type="video/mp4">Your browser does not support the video tag.</video>`;
  }
  // Direct video files (.mp4, .webm, .ogg, .mov)
  else if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(videoUrl)) {
    playerHTML = `<video controls autoplay controlsList="nodownload" style="width:100%; height:100%;"><source src="${videoUrl}" type="video/mp4">Your browser does not support the video tag.</video>`;
  }
  // Generic iframe (for other platforms)
  else if (videoUrl.startsWith('http')) {
    playerHTML = `<iframe src="${videoUrl}" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
  }
  // Fallback for unsupported formats
  else {
    playerHTML = `
      <div class="video-placeholder">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <p>Unsupported video format</p>
        <a href="${videoUrl}" target="_blank" class="btn btn-primary" style="margin-top:1rem;">Open Video in New Tab</a>
      </div>
    `;
  }

  container.innerHTML = playerHTML;
}

// ====================================================================
// VIDEO ID EXTRACTORS
// ====================================================================
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function extractVimeoId(url) {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : '';
}

function extractStreamableId(url) {
  const match = url.match(/streamable\.com\/([a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}

function extractDailymotionId(url) {
  const match = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}

function extractWistiaId(url) {
  const match = url.match(/wistia\.com\/medias\/([a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}
/*
function extractGoogleDriveId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}
*/
// UPDATED: Extract Google Drive ID (handles multiple formats)
function extractGoogleDriveId(url) {
  // Format 1: /file/d/FILE_ID/
  let match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  
  // Format 2: /open?id=FILE_ID
  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  
  // Format 3: /uc?id=FILE_ID
  match = url.match(/\/uc\?id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  
  return '';
}


// ====================================================================
// MARK LESSON AS COMPLETE
// ====================================================================
document.getElementById('mark-complete-btn').addEventListener('click', async () => {
  try {
    if (userProgress.completedLessons.includes(currentLessonIndex)) {
      return; // Already completed
    }

    showLoading(true);

    // Add to completed lessons
    userProgress.completedLessons.push(currentLessonIndex);
    userProgress.completedLessons.sort((a, b) => a - b); // Keep sorted

    // Calculate progress percentage
    const progressPercent = Math.round(
      (userProgress.completedLessons.length / currentCourse.lessons.length) * 100
    );
    userProgress.progress = progressPercent;

    // Check if course is fully completed
    if (userProgress.completedLessons.length === currentCourse.lessons.length) {
      userProgress.isCompleted = true;
      userProgress.completedAt = Timestamp.now();
    }

    // Update Firestore
    const userDocRef = doc(db, 'user', currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    let enrolledCourses = userData.enrolledCourses || [];

    // Update or add progress
    const courseIndex = enrolledCourses.findIndex(c => c.courseId === currentCourse.id);
    if (courseIndex >= 0) {
      enrolledCourses[courseIndex] = userProgress;
    } else {
      enrolledCourses.push(userProgress);
    }

    await updateDoc(userDocRef, {
      enrolledCourses: enrolledCourses
    });

    // Update UI
    renderLessonsList();
    updateProgressBadge();

    // Show next lesson button
    document.getElementById('mark-complete-btn').style.display = 'none';
    if (currentLessonIndex < currentCourse.lessons.length - 1) {
      document.getElementById('next-lesson-btn').style.display = 'inline-flex';
    }

    // Check if course completed
    if (userProgress.isCompleted) {
      showCertificateSection();
      showNotification('🎉 Congratulations! You completed the course!', 'success');
    } else {
      showNotification('✅ Lesson completed!', 'success');
    }

    showLoading(false);

  } catch (error) {
    console.error('Error marking complete:', error);
    showNotification('Error saving progress: ' + error.message, 'error');
    showLoading(false);
  }
});

// ====================================================================
// NEXT LESSON
// ====================================================================
document.getElementById('next-lesson-btn').addEventListener('click', () => {
  if (currentLessonIndex < currentCourse.lessons.length - 1) {
    loadLesson(currentLessonIndex + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// ====================================================================
// UPDATE PROGRESS BADGE
// ====================================================================
function updateProgressBadge() {
  const progressBadge = document.getElementById('progress-badge');
  progressBadge.textContent = `${userProgress.progress || 0}% Complete`;
  
  // Add animation on progress update
  progressBadge.style.animation = 'none';
  setTimeout(() => {
    progressBadge.style.animation = 'pulse 2s infinite';
  }, 10);
}

// ====================================================================
// UPDATE LAST ACCESSED LESSON
// ====================================================================
async function updateLastAccessedLesson(index) {
  try {
    userProgress.lastAccessedLesson = index;
    userProgress.lastAccessedAt = Timestamp.now();
    
    const userDocRef = doc(db, 'user', currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    let enrolledCourses = userData.enrolledCourses || [];

    const courseIndex = enrolledCourses.findIndex(c => c.courseId === currentCourse.id);
    if (courseIndex >= 0) {
      enrolledCourses[courseIndex].lastAccessedLesson = index;
      enrolledCourses[courseIndex].lastAccessedAt = Timestamp.now();
      await updateDoc(userDocRef, { enrolledCourses });
    }
  } catch (error) {
    console.error('Error updating last accessed:', error);
  }
}

// ====================================================================
// LOAD FIRST AVAILABLE LESSON
// ====================================================================
function loadFirstAvailableLesson() {
  // Load last accessed or first uncompleted lesson
  let lessonToLoad = userProgress.lastAccessedLesson || 0;
  
  // If last accessed is completed, find next uncompleted
  if (userProgress.completedLessons.includes(lessonToLoad)) {
    for (let i = 0; i < currentCourse.lessons.length; i++) {
      if (!userProgress.completedLessons.includes(i)) {
        lessonToLoad = i;
        break;
      }
    }
  }

  loadLesson(lessonToLoad);
}

// ====================================================================
// CERTIFICATE SECTION
// ====================================================================
function showCertificateSection() {
  document.getElementById('certificate-section').style.display = 'block';
  
  // Scroll to certificate section
  setTimeout(() => {
    document.getElementById('certificate-section').scrollIntoView({ 
      behavior: 'smooth', 
      block: 'nearest' 
    });
  }, 500);
}

document.getElementById('view-certificate-btn')?.addEventListener('click', () => {
  generateCertificate();
  document.getElementById('certificate-modal').classList.add('active');
});

// ====================================================================
// GENERATE CERTIFICATE
// ====================================================================
async function generateCertificate() {
  try {
    const userDoc = await getDoc(doc(db, 'user', currentUser.uid));
    const userData = userDoc.data();
    
    const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 
                     currentUser.displayName || 
                     currentUser.email.split('@')[0];
                     
    const completionDate = userProgress.completedAt?.toDate().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) || new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const certificateHTML = `
      <div class="certificate-header">
        <div class="certificate-logo">
          <ion-icon name="ribbon"></ion-icon>
        </div>
        <h1 class="certificate-title">Certificate</h1>
        <p class="certificate-subtitle">Safpedia</p>
      </div>
      
      <div class="certificate-body">
        <p class="certificate-text">This certifies that</p>
        <h2 class="certificate-name">${fullName}</h2>
        <p class="certificate-text">has successfully completed the course</p>
        <h3 class="certificate-course">${currentCourse.title}</h3>
        <p class="certificate-text" style="max-width: 600px; margin: 1.5rem auto;">
          In recognition of outstanding performance, consistent dedication, and the successful demonstration 
          of practical competence throughout the duration of this program. The recipient has shown a strong 
          understanding of the theoretical concepts and hands-on application required to excel in this field.
        </p>

        <p class="certificate-date">Completed on ${completionDate}</p>
      </div>
      
      <div class="certificate-footer">
        <div class="certificate-signature">
          <div class="signature-line"></div>
          <p class="signature-name">Safpedia</p>
          <p class="signature-title">Platform Director</p>
        </div>
        <div class="certificate-signature">
          <div class="signature-line"></div>
          <p class="signature-name">${currentCourse.instructor || 'Course Instructor'}</p>
          <p class="signature-title">Lead Instructor</p>
        </div>
      </div>
    `;

    document.getElementById('certificate-card').innerHTML = certificateHTML;
  } catch (error) {
    console.error('Error generating certificate:', error);
    showNotification('Error generating certificate', 'error');
  }
}

// ====================================================================
// CERTIFICATE MODAL CONTROLS
// ====================================================================
window.closeCertificate = function() {
  document.getElementById('certificate-modal').classList.remove('active');
};

window.downloadCertificate = function() {
  // Use html2canvas to convert certificate to image
  showNotification('📸 Generating certificate image...', 'info');
  
  // Simple fallback: print the certificate
  setTimeout(() => {
    window.print();
  }, 500);
};

window.shareCertificate = function() {
  const shareData = {
    title: `${currentCourse.title} - Certificate`,
    text: `I just completed "${currentCourse.title}" on Safpedia! 🎉`,
    url: window.location.href
  };
  
  if (navigator.share) {
    navigator.share(shareData)
      .then(() => showNotification('✅ Shared successfully!', 'success'))
      .catch(() => showNotification('Sharing cancelled', 'info'));
  } else {
    // Fallback: Copy link to clipboard
    navigator.clipboard.writeText(window.location.href)
      .then(() => showNotification('📋 Link copied to clipboard!', 'success'))
      .catch(() => showNotification('Could not copy link', 'error'));
  }
};

// ====================================================================
// UTILITY FUNCTIONS
// ====================================================================
function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  if (show) {
    overlay.classList.add('active');
  } else {
    overlay.classList.remove('active');
  }
}

function showNotification(message, type = 'info') {
  const colors = {
    success: '#10b981',
    error: '#FF3B5C',
    info: '#2954FF',
    warning: '#f59e0b'
  };
  
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10001;
    animation: slideInRight 0.3s ease;
    font-weight: 600;
    max-width: 350px;
  `;
  notification.textContent = message;
  
  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3500);
}

// ====================================================================
// KEYBOARD SHORTCUTS
// ====================================================================
document.addEventListener('keydown', (e) => {
  // Space: Play/Pause (if video element exists)
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    const video = document.querySelector('video');
    if (video) {
      video.paused ? video.play() : video.pause();
    }
  }
  
  // Arrow Right: Next lesson
  if (e.code === 'ArrowRight' && e.ctrlKey) {
    e.preventDefault();
    document.getElementById('next-lesson-btn')?.click();
  }
  
  // Escape: Close modal
  if (e.code === 'Escape') {
    if (document.getElementById('certificate-modal').classList.contains('active')) {
      closeCertificate();
    }
  }
});

console.log('Course Viewer initialized with multi-format video support');