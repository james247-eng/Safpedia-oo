// ====================================================================
// ADMIN DASHBOARD - COMPLETE JAVASCRIPT
// Tech Wizards Academy
// ====================================================================

// Import Firebase modules
import { auth, db } from '../../../firebase-config.js';
import '../../../js/notification-center.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, limit, Timestamp, getDoc } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

// ====================================================================
// GLOBAL VARIABLES
// ====================================================================
let allCourses = [];
let allUsers = [];
let allSales = [];
let lessonCount = 0; // Track lesson count

// ====================================================================
// AUTHENTICATION CHECK
// ====================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '../../sign-in.html';
    return;
  }

  try {
    const userDocRef = doc(db, 'user', user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      console.error('User document not found');
      showAlert('User profile not found. Please contact support.', 'error');
      await signOut(auth);
      window.location.href = '../../sign-in.html';
      return;
    }

    const userData = userDocSnap.data();
    const userRole = userData.role;

    if (userRole !== 'admin') {
      console.warn('Access denied: Not an admin');
      showAlert('Access denied. Admins only.', 'error');
      window.location.href = '../../users/dashboard.html';
      return;
    }

    console.log('Admin authenticated successfully');
    document.getElementById('user-avatar').textContent = user.email.charAt(0).toUpperCase();
    loadDashboardData();

  } catch (error) {
    console.error('Auth error:', error);
    showAlert('Error verifying access. Please try again.', 'error');
    await signOut(auth);
    window.location.href = '../../sign-in.html';
  }
});

// ====================================================================
// LOGOUT
// ====================================================================
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = '../../sign-in.html';
  } catch (error) {
    console.error('Logout error:', error);
    showAlert('Error logging out. Please try again.', 'error');
  }
});

// ====================================================================
// NAVIGATION
// ====================================================================
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    const section = e.currentTarget.dataset.section;

    // Real page-links (Blog, Vendors) have no data-section — let the
    // browser navigate normally instead of trying to switch a tab that
    // doesn't exist on this page.
    if (!section) return;

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    e.currentTarget.classList.add('active');
    
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}-section`).classList.add('active');
    
    const titles = {
      overview: 'Dashboard Overview',
      courses: 'Course Management',
      users: 'User Management',
      sales: 'Sales & Transactions',
      analytics: 'Analytics',
      affiliates: 'Affiliate Program'
    };
    document.getElementById('page-title').textContent = titles[section];
    
    if (section === 'courses') loadCourses();
    if (section === 'users') loadUsers();
    if (section === 'sales') loadSales();
    if (section === 'analytics') loadAnalytics();
    if (section === 'affiliates') loadAffiliates();
  });
});

// ====================================================================
// MODAL CONTROLS
// ====================================================================
document.getElementById('add-course-btn').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = 'Add New Course';
  document.getElementById('course-form').reset();
  document.getElementById('course-id').value = '';
  document.getElementById('lessons-container').innerHTML = '';
  lessonCount = 0;
  document.getElementById('course-modal').classList.add('active');
});

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('course-modal').classList.remove('active');
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  document.getElementById('course-modal').classList.remove('active');
});

// ====================================================================
// LESSON MANAGEMENT FUNCTIONS - CONTENT-TYPE AWARE (video/audio/pdf/live)
// ====================================================================

// Add new lesson
document.getElementById('add-lesson-btn').addEventListener('click', () => {
  lessonCount++;
  const clone = createLessonCardElement();
  clone.querySelector('.lesson-number').textContent = lessonCount;
  document.getElementById('lessons-container').appendChild(clone);
});

// Builds a lesson card from the template and wires up all its interactive bits.
function createLessonCardElement() {
  const template = document.getElementById('lesson-card-template');
  const clone = template.content.cloneNode(true);
  wireLessonCard(clone);
  return clone;
}

function wireLessonCard(root) {
  const contentTypeSelect = root.querySelector('.lesson-content-type');
  const videoFields = root.querySelector('.lesson-video-fields');
  const audioFields = root.querySelector('.lesson-audio-fields');
  const pdfFields = root.querySelector('.lesson-pdf-fields');
  const liveFields = root.querySelector('.lesson-live-fields');

  function toggleFields() {
    const type = contentTypeSelect.value;
    videoFields.style.display = type === 'video' ? 'block' : 'none';
    audioFields.style.display = type === 'audio' ? 'block' : 'none';
    pdfFields.style.display = type === 'pdf' ? 'block' : 'none';
    liveFields.style.display = type === 'live' ? 'block' : 'none';
  }
  contentTypeSelect.addEventListener('change', toggleFields);
  toggleFields();

  root.querySelector('.remove-lesson-btn').addEventListener('click', function () {
    this.closest('.lesson-card').remove();
    updateLessonNumbers();
  });

  // PDF Upload Click Handler
  root.querySelector('.lesson-pdf-upload-btn')?.addEventListener('click', async (e) => {
    const container = e.target.closest('.lesson-pdf-fields');
    const fileInput = container ? container.querySelector('.lesson-pdf-file') : null;
    const statusEl = container ? container.querySelector('.lesson-pdf-status') : null;
    const urlInput = container ? container.querySelector('.lesson-content-url') : null;

    if (!fileInput || !fileInput.files[0]) {
      showAlert('Choose a PDF file first', 'error');
      return;
    }

    statusEl.textContent = 'Uploading...';
    statusEl.style.color = '#9ca3af';

    try {
      const url = await uploadToCloudinary(fileInput.files[0], 'course-pdfs');
      if (urlInput) urlInput.value = url;
      statusEl.textContent = 'Uploaded ✓';
      statusEl.style.color = '#059669';
    } catch (error) {
      statusEl.textContent = 'Upload failed: ' + error.message;
      statusEl.style.color = '#ef4444';
    }
  });

  // Audio Upload Click Handler
  root.querySelector('.lesson-audio-upload-btn')?.addEventListener('click', async (e) => {
    const container = e.target.closest('.lesson-audio-fields');
    const fileInput = container ? container.querySelector('.lesson-audio-file') : null;
    const statusEl = container ? container.querySelector('.lesson-audio-status') : null;
    const urlInput = container ? container.querySelector('.lesson-content-url') : null;

    if (!fileInput || !fileInput.files[0]) {
      showAlert('Choose an audio file first', 'error');
      return;
    }

    statusEl.textContent = 'Uploading...';
    statusEl.style.color = '#9ca3af';

    try {
      const url = await uploadToCloudinary(fileInput.files[0], 'course-audio');
      if (urlInput) urlInput.value = url;
      statusEl.textContent = 'Uploaded ✓';
      statusEl.style.color = '#059669';
    } catch (error) {
      statusEl.textContent = 'Upload failed: ' + error.message;
      statusEl.style.color = '#ef4444';
    }
  });

  // Create Zoom meeting for a live lesson
  root.querySelector('.lesson-create-zoom-btn').addEventListener('click', async () => {
    const statusEl = root.querySelector('.lesson-zoom-status');
    const topic = root.querySelector('.lesson-title').value.trim() || 'Live Class Session';
    const startTime = root.querySelector('.lesson-live-datetime').value;
    const durationMinutes = parseInt(root.querySelector('.lesson-live-duration').value) || 60;

    if (!startTime) {
      showAlert('Set a session date & time first', 'error');
      return;
    }

    statusEl.textContent = 'Creating Zoom meeting...';
    statusEl.style.color = '#9ca3af';

    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/zoom/create-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ topic, startTime, durationMinutes })
      });
      const json = await res.json();

      if (!res.ok) {
        statusEl.textContent = 'Error: ' + (json.error || 'Could not create meeting');
        statusEl.style.color = '#ef4444';
        return;
      }

      root.querySelector('.lesson-zoom-join-url').value = json.joinUrl;
      root.querySelector('.lesson-zoom-start-url').value = json.startUrl;
      root.querySelector('.lesson-zoom-meeting-id').value = json.meetingId;
      statusEl.textContent = `Meeting created ✓ (ID: ${json.meetingId})`;
      statusEl.style.color = '#059669';
    } catch (error) {
      statusEl.textContent = 'Error: ' + error.message;
      statusEl.style.color = '#ef4444';
    }
  });
}

// Uploads a file to Cloudinary via a signed request
async function uploadToCloudinary(file, folder) {
  const idToken = await auth.currentUser.getIdToken();
  const sigRes = await fetch('/api/cloudinary/signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ folder })
  });
  const sigJson = await sigRes.json();
  if (!sigRes.ok) throw new Error(sigJson.error || 'Could not get upload signature');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', sigJson.apiKey);
  formData.append('timestamp', sigJson.timestamp);
  formData.append('signature', sigJson.signature);
  formData.append('folder', sigJson.folder);

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sigJson.cloudName}/auto/upload`, {
    method: 'POST',
    body: formData
  });
  const uploadJson = await uploadRes.json();

  if (!uploadJson.secure_url) {
    throw new Error(uploadJson.error?.message || 'Cloudinary upload failed');
  }
  return uploadJson.secure_url;
}

// Update lesson numbers after removal
function updateLessonNumbers() {
  const lessonCards = document.querySelectorAll('.lesson-card');
  lessonCount = lessonCards.length;

  lessonCards.forEach((card, index) => {
    card.querySelector('.lesson-number').textContent = index + 1;
  });
}

// Collect lessons data from form.
function collectLessonsData() {
  const lessonCards = document.querySelectorAll('.lesson-card');
  const lessons = [];
  let hasError = false;

  lessonCards.forEach((card, index) => {
    const title = card.querySelector('.lesson-title').value.trim();
    const contentType = card.querySelector('.lesson-content-type').value;
    const duration = card.querySelector('.lesson-duration').value.trim();
    const description = card.querySelector('.lesson-description').value.trim();

    if (!title) {
      hasError = true;
      return;
    }

    const lesson = {
      lessonNumber: index + 1,
      title,
      contentType,
      duration: duration || 'N/A',
      description: description || '',
      isCompleted: false
    };

    if (contentType === 'video') {
      const url = card.querySelector('.lesson-video-url').value.trim();
      if (!url) { hasError = true; return; }
      lesson.contentUrl = url;

    } else if (contentType === 'audio' || contentType === 'pdf') {
      const targetContainer = contentType === 'audio' ? card.querySelector('.lesson-audio-fields') : card.querySelector('.lesson-pdf-fields');
      const urlInput = targetContainer ? targetContainer.querySelector('.lesson-content-url') : null;
      const url = urlInput ? urlInput.value.trim() : '';
      if (!url) { hasError = true; return; }
      lesson.contentUrl = url;

    } else if (contentType === 'live') {
      const joinUrl = card.querySelector('.lesson-zoom-join-url').value.trim();
      if (!joinUrl) { hasError = true; return; }
      lesson.zoomJoinUrl = joinUrl;
      lesson.zoomStartUrl = card.querySelector('.lesson-zoom-start-url').value.trim();
      lesson.zoomMeetingId = card.querySelector('.lesson-zoom-meeting-id').value.trim();
      const datetimeLocal = card.querySelector('.lesson-live-datetime').value;
      lesson.scheduledAt = datetimeLocal ? new Date(datetimeLocal).toISOString() : null;
      lesson.liveDurationMinutes = parseInt(card.querySelector('.lesson-live-duration').value) || 60;
    }

    lessons.push(lesson);
  });

  return hasError ? null : lessons;
}

// The marketplace badge/filter needs one formatType per course, but content
// type only ever lived per-lesson — roll the lessons up into whichever type
// is most common so the badge/filter has something accurate to read.
function deriveFormatType(lessons) {
  const counts = {};
  lessons.forEach((lesson) => {
    const type = lesson.contentType || 'video';
    counts[type] = (counts[type] || 0) + 1;
  });

  let dominant = 'video';
  let highest = 0;
  Object.entries(counts).forEach(([type, count]) => {
    if (count > highest) {
      dominant = type;
      highest = count;
    }
  });
  return dominant;
}

// Populate lessons in edit mode
function populateLessons(lessons) {
  document.getElementById('lessons-container').innerHTML = '';
  lessonCount = 0;

  if (!lessons || lessons.length === 0) return;

  lessons.forEach((lesson) => {
    lessonCount++;
    const clone = createLessonCardElement();

    clone.querySelector('.lesson-number').textContent = lessonCount;
    clone.querySelector('.lesson-title').value = lesson.title || '';
    clone.querySelector('.lesson-duration').value = lesson.duration || '';
    clone.querySelector('.lesson-description').value = lesson.description || '';

    const contentType = lesson.contentType || 'video';
    const typeSelect = clone.querySelector('.lesson-content-type');
    typeSelect.value = contentType;

    if (contentType === 'video') {
      clone.querySelector('.lesson-video-url').value = lesson.contentUrl || lesson.videoUrl || '';

    } else if (contentType === 'audio' || contentType === 'pdf') {
      const container = contentType === 'audio' ? clone.querySelector('.lesson-audio-fields') : clone.querySelector('.lesson-pdf-fields');
      const urlInput = container ? container.querySelector('.lesson-content-url') : null;
      if (urlInput) urlInput.value = lesson.contentUrl || '';
      
      if (lesson.contentUrl) {
        const statusEl = clone.querySelector(contentType === 'audio' ? '.lesson-audio-status' : '.lesson-pdf-status');
        if (statusEl) {
          statusEl.textContent = 'Existing file on record ✓';
          statusEl.style.color = '#059669';
        }
      }

    } else if (contentType === 'live') {
      clone.querySelector('.lesson-zoom-join-url').value = lesson.zoomJoinUrl || '';
      clone.querySelector('.lesson-zoom-start-url').value = lesson.zoomStartUrl || '';
      clone.querySelector('.lesson-zoom-meeting-id').value = lesson.zoomMeetingId || '';
      clone.querySelector('.lesson-live-duration').value = lesson.liveDurationMinutes || 60;

      if (lesson.scheduledAt) {
        const dt = new Date(lesson.scheduledAt);
        const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        clone.querySelector('.lesson-live-datetime').value = localIso;
      }
      if (lesson.zoomMeetingId) {
        const statusEl = clone.querySelector('.lesson-zoom-status');
        statusEl.textContent = `Meeting exists (ID: ${lesson.zoomMeetingId})`;
        statusEl.style.color = '#059669';
      }
    }

    typeSelect.dispatchEvent(new Event('change'));
    document.getElementById('lessons-container').appendChild(clone);
  });
}

// ====================================================================
// LOAD DASHBOARD DATA
// ====================================================================
async function loadDashboardData() {
  try {
    const coursesSnap = await getDocs(collection(db, 'courses'));
    const userSnap = await getDocs(collection(db, 'user'));
    const purchasesSnap = await getDocs(collection(db, 'purchases'));
    
    document.getElementById('active-courses').textContent = coursesSnap.size;
    document.getElementById('total-users').textContent = userSnap.size;
    document.getElementById('total-sales').textContent = purchasesSnap.size;
    
    let totalRevenue = 0;
    purchasesSnap.forEach(doc => {
      const data = doc.data();
      if (data.status === 'paid') {
        totalRevenue += (data.amount || 0) / 100;
      }
    });
    document.getElementById('total-revenue').textContent = `₦${totalRevenue.toLocaleString()}`;
    
    await loadRecentSales();
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showAlert('Error loading dashboard data: ' + error.message, 'error');
  }
}

// ====================================================================
// LOAD RECENT SALES
// ====================================================================
async function loadRecentSales() {
  try {
    const q = query(collection(db, 'purchases'), orderBy('paid_at', 'desc'), limit(5));
    const snapshot = await getDocs(q);
    
    const tbody = document.getElementById('recent-sales-body');
    tbody.innerHTML = '';
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No sales yet</td></tr>';
      return;
    }
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const row = tbody.insertRow();
      
      let userName = 'Unknown';
      if (data.userId) {
        try {
          const userDoc = await getDoc(doc(db, 'user', data.userId));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || 'Unknown';
          }
        } catch (e) {
          console.error('Error fetching user:', e);
        }
      }
      
      let courseName = 'Unknown';
      if (data.courseId) {
        try {
          const courseDoc = await getDoc(doc(db, 'courses', data.courseId));
          if (courseDoc.exists()) {
            courseName = courseDoc.data().title || 'Unknown';
          }
        } catch (e) {
          console.error('Error fetching course:', e);
        }
      }
      
      row.innerHTML = `
        <td><strong>${userName}</strong></td>
        <td>${courseName}</td>
        <td style="font-weight:600; color:#059669;">₦${((data.amount || 0) / 100).toLocaleString()}</td>
        <td>${data.paid_at?.toDate().toLocaleDateString() || 'N/A'}</td>
        <td><span class="status-badge status-published">${data.status || 'paid'}</span></td>
      `;
    }
  } catch (error) {
    console.error('Error loading recent sales:', error);
  }
}

// ====================================================================
// LOAD COURSES
// ====================================================================
async function loadCourses() {
  try {
    const snapshot = await getDocs(collection(db, 'courses'));
    allCourses = [];

    snapshot.forEach(docSnap => {
      allCourses.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderCoursesTable(allCourses);
  } catch (error) {
    console.error('Error loading courses:', error);
    showAlert('Error loading courses: ' + error.message, 'error');
  }
}

// Renders a given list of courses into the admin courses table. Shared by
// loadCourses() and the search filter below so both stay in sync.
function renderCoursesTable(courses) {
  const tbody = document.getElementById('courses-table-body');
  tbody.innerHTML = '';

  if (courses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No courses yet. Click "Add New Course" to create one.</td></tr>';
    return;
  }

  courses.forEach(data => {
    const row = tbody.insertRow();
    row.innerHTML = `
      <td><img src="${data.thumbnail || ''}" class="course-thumbnail" alt="${data.title}" onerror="this.src='https://via.placeholder.com/60x40'"></td>
      <td><strong>${data.title}</strong></td>
      <td style="text-transform:capitalize;">${(data.category || 'N/A').replace(/-/g, ' ')}</td>
      <td style="font-weight:600; color:#059669;">₦${(data.price || 0).toLocaleString()}</td>
      <td>${data.enrolledCount || 0}</td>
      <td><span class="status-badge ${data.isPublished ? 'status-published' : 'status-draft'}">${data.isPublished ? 'Published' : 'Draft'}</span></td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-secondary btn-sm" onclick="editCourse('${data.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCourse('${data.id}')">Delete</button>
        </div>
      </td>
    `;
  });
}

// Live-filter the admin courses table by title or category as the admin
// types — this input existed in the markup but was never wired up.
document.getElementById('courses-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = allCourses.filter(c =>
    (c.title || '').toLowerCase().includes(q) ||
    (c.category || '').toLowerCase().includes(q)
  );
  renderCoursesTable(filtered);
});

// ====================================================================
// LOAD USERS
// ====================================================================
async function loadUsers() {
  try {
    const snapshot = await getDocs(collection(db, 'user'));
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';
    
    allUsers = [];
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users yet</td></tr>';
      return;
    }
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      allUsers.push({ id: docSnap.id, ...data });
      const row = tbody.insertRow();
      
      row.innerHTML = `
        <td><strong>${data.firstName || ''} ${data.lastName || ''}</strong></td>
        <td>${data.email || 'N/A'}</td>
        <td>${(data.enrolledCourses || []).length}</td>
        <td>${data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewUser('${docSnap.id}')">View</button>
        </td>
      `;
    });
  } catch (error) {
    showAlert('Error loading users: ' + error.message, 'error');
  }
}

// ====================================================================
// LOAD SALES
// ====================================================================
async function loadSales() {
  try {
    const q = query(collection(db, 'purchases'), orderBy('paid_at', 'desc'));
    const snapshot = await getDocs(q);
    const tbody = document.getElementById('sales-table-body');
    tbody.innerHTML = '';
    
    allSales = [];
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No transactions yet</td></tr>';
      return;
    }
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      
      let userEmail = 'Unknown';
      if (data.userId) {
        try {
          const userDoc = await getDoc(doc(db, 'user', data.userId));
          if (userDoc.exists()) {
            userEmail = userDoc.data().email || 'Unknown';
          }
        } catch (e) {
          console.error('Error fetching user:', e);
        }
      }
      
      let courseTitle = 'Unknown';
      if (data.courseId) {
        try {
          const courseDoc = await getDoc(doc(db, 'courses', data.courseId));
          if (courseDoc.exists()) {
            courseTitle = courseDoc.data().title || 'Unknown';
          }
        } catch (e) {
          console.error('Error fetching course:', e);
        }
      }
      
      const saleWithDetails = {
        id: docSnap.id,
        ...data,
        userEmail,
        courseTitle
      };
      allSales.push(saleWithDetails);
      
      const row = tbody.insertRow();
      
      row.innerHTML = `
        <td><code style="background:#f3f4f6; padding:4px 8px; border-radius:4px; font-size:11px;">${data.reference || docSnap.id}</code></td>
        <td>${userEmail}</td>
        <td>${courseTitle}</td>
        <td style="font-weight:600; color:#059669;">₦${((data.amount || 0) / 100).toLocaleString()}</td>
        <td>${data.paid_at?.toDate().toLocaleDateString() || 'N/A'}</td>
        <td><span class="status-badge status-published">${data.status || 'paid'}</span></td>
      `;
    }
  } catch (error) {
    console.error('Error loading sales:', error);
    showAlert('Error loading sales: ' + error.message, 'error');
  }
}

// ====================================================================
// LOAD ANALYTICS
// ====================================================================
async function loadAnalytics() {
  try {
    const [coursesSnap, purchasesSnap] = await Promise.all([
      getDocs(collection(db, 'courses')),
      getDocs(collection(db, 'purchases'))
    ]);

    const revenueByRev = {};
    purchasesSnap.forEach(doc => {
      const data = doc.data();
      if (data.status === 'paid' && data.courseId) {
        if (!revenueByRev[data.courseId]) {
          revenueByRev[data.courseId] = 0;
        }
        revenueByRev[data.courseId] += (data.amount || 0) / 100;
      }
    });

    const coursesMap = {};
    coursesSnap.forEach(doc => {
      coursesMap[doc.id] = doc.data();
    });

    const topByRevenue = Object.entries(revenueByRev)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const revenueDiv = document.getElementById('top-courses-chart');
    revenueDiv.innerHTML = '<h3 style="margin-bottom:20px;">Top 5 Courses by Revenue</h3>';
    
    if (topByRevenue.length === 0) {
      revenueDiv.innerHTML += '<p style="color:#999;">No sales data yet</p>';
    } else {
      topByRevenue.forEach(([courseId, revenue], index) => {
        const course = coursesMap[courseId] || {};
        revenueDiv.innerHTML += `
          <div style="margin-bottom:15px; padding:15px; background:#f9fafb; border-radius:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="color:#1a1f36;">${index + 1}. ${course.title || 'Unknown Course'}</strong>
                <p style="margin:5px 0 0 0; color:#6b7280; font-size:14px;">${course.enrolledCount || 0} users enrolled</p>
              </div>
              <div style="font-size:20px; font-weight:700; color:#059669;">₦${revenue.toLocaleString()}</div>
            </div>
          </div>
        `;
      });
    }
  } catch (error) {
    console.error('Error loading analytics:', error);
    showAlert('Error loading analytics: ' + error.message, 'error');
  }
}

// ====================================================================
// SAVE COURSE - UPDATED WITH LESSONS
// ====================================================================
document.getElementById('course-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const lessons = collectLessonsData();
  
  if (lessons === null) {
    showAlert('Each lesson needs its required content: a video URL, an uploaded audio/PDF file, or a created Zoom meeting', 'error');
    return;
  }
  if (lessons.length === 0) {
    showAlert('Please add at least one lesson to the course', 'error');
    return;
  }
  
  const courseData = {
    title: document.getElementById('course-title').value.trim(),
    category: document.getElementById('course-category').value,
    formatType: deriveFormatType(lessons),
    shortDescription: document.getElementById('course-short-desc').value.trim(),
    description: document.getElementById('course-description').value.trim(),
    price: parseFloat(document.getElementById('course-price').value),
    thumbnail: document.getElementById('course-thumbnail').value.trim(),
    instructor: document.getElementById('course-instructor').value.trim() || 'Safpedia',
    level: document.getElementById('course-level').value,
    isPublished: document.getElementById('course-status').value === 'true',
    lessons: lessons,
    totalLessons: lessons.length,
    enrolledCount: 0,
    rating: 0,
    updatedAt: Timestamp.now()
  };
  
  try {
    const courseId = document.getElementById('course-id').value;
    
    if (courseId) {
      await updateDoc(doc(db, 'courses', courseId), courseData);
      showAlert('Course updated successfully!', 'success');
    } else {
      courseData.createdAt = Timestamp.now();
      await addDoc(collection(db, 'courses'), courseData);
      showAlert('Course created successfully!', 'success');
    }
    
    document.getElementById('course-modal').classList.remove('active');
    document.getElementById('lessons-container').innerHTML = '';
    lessonCount = 0;
    loadCourses();
    loadDashboardData();
    
  } catch (error) {
    console.error('Error saving course:', error);
    showAlert('Error saving course: ' + error.message, 'error');
  }
});

// ====================================================================
// EDIT COURSE - UPDATED WITH LESSONS
// ====================================================================
window.editCourse = async (courseId) => {
  try {
    const courseDocRef = doc(db, 'courses', courseId);
    const courseDocSnap = await getDoc(courseDocRef);
    
    if (!courseDocSnap.exists()) {
      showAlert('Course not found', 'error');
      return;
    }
    
    const courseData = courseDocSnap.data();
    
    document.getElementById('modal-title').textContent = 'Edit Course';
    document.getElementById('course-id').value = courseId;
    document.getElementById('course-title').value = courseData.title || '';
    document.getElementById('course-category').value = courseData.category || '';
    document.getElementById('course-short-desc').value = courseData.shortDescription || '';
    document.getElementById('course-description').value = courseData.description || '';
    document.getElementById('course-price').value = courseData.price || '';
    document.getElementById('course-thumbnail').value = courseData.thumbnail || '';
    document.getElementById('course-instructor').value = courseData.instructor || '';
    document.getElementById('course-level').value = courseData.level || 'beginner';
    document.getElementById('course-status').value = courseData.isPublished ? 'true' : 'false';
    
    populateLessons(courseData.lessons || []);
    
    document.getElementById('course-modal').classList.add('active');
    
  } catch (error) {
    console.error('Error loading course:', error);
    showAlert('Error loading course: ' + error.message, 'error');
  }
};

// ====================================================================
// DELETE COURSE
// ====================================================================
window.deleteCourse = async (courseId) => {
  if (!confirm('Are you sure you want to delete this course? This action cannot be undone.')) {
    return;
  }
  
  try {
    await deleteDoc(doc(db, 'courses', courseId));
    showAlert('Course deleted successfully!', 'success');
    loadCourses();
    loadDashboardData();
  } catch (error) {
    console.error('Error deleting course:', error);
    showAlert('Error deleting course: ' + error.message, 'error');
  }
};

// ====================================================================
// VIEW USER
// ====================================================================
window.viewUser = async (userId) => {
  alert('User details coming soon...');
};

// ====================================================================
// SHOW ALERT
// ====================================================================
function showAlert(message, type) {
  const alertContainer = document.getElementById('alert-container');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alertContainer.appendChild(alert);
  
  setTimeout(() => {
    alert.remove();
  }, 5000);
}

// ====================================================================
// AFFILIATES - LOAD PENDING + ACTIVE
// ====================================================================
async function loadAffiliates() {
  await Promise.all([loadPendingAffiliates(), loadActiveAffiliates()]);
}

async function loadPendingAffiliates() {
  const tbody = document.getElementById('pending-affiliates-body');
  try {
    const q = query(collection(db, 'affiliates'), where('status', '==', 'pending'));
    const snap = await getDocs(q);
    tbody.innerHTML = '';

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending applications</td></tr>';
      return;
    }

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${data.name || 'N/A'}</td>
        <td>${data.email || 'N/A'}</td>
        <td style="max-width:220px; white-space:normal;">${data.applicationReason || '—'}</td>
        <td>${data.appliedAt?.toDate().toLocaleDateString() || 'N/A'}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-primary btn-sm" onclick="openApproveModal('${docSnap.id}', '${(data.name || 'this applicant').replace(/'/g, "\\'")}')">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="rejectAffiliate('${docSnap.id}')">Reject</button>
          </div>
        </td>
      `;
    });
  } catch (error) {
    console.error('Error loading pending affiliates:', error);
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Error loading applications</td></tr>';
  }
}

async function loadActiveAffiliates() {
  const tbody = document.getElementById('active-affiliates-body');
  try {
    const q = query(collection(db, 'affiliates'), where('status', '==', 'approved'));
    const snap = await getDocs(q);
    tbody.innerHTML = '';

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No active affiliates yet</td></tr>';
      return;
    }

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${data.name || 'N/A'}</td>
        <td><code style="background:#f3f4f6; padding:4px 8px; border-radius:4px;">${data.code || 'N/A'}</code></td>
        <td>${Math.round((data.commissionRate || 0) * 100)}%</td>
        <td>₦${(data.totalEarned || 0).toLocaleString()}</td>
        <td>₦${(data.pendingPayout || 0).toLocaleString()}</td>
        <td>${data.totalSales || 0}</td>
      `;
    });
  } catch (error) {
    console.error('Error loading active affiliates:', error);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error loading affiliates</td></tr>';
  }
}

// ====================================================================
// AFFILIATES - APPROVE / REJECT
// ====================================================================
window.openApproveModal = (uid, name) => {
  document.getElementById('approve-affiliate-uid').value = uid;
  document.getElementById('approve-affiliate-name').textContent = name;
  document.getElementById('approve-commission-rate').value = '';
  document.getElementById('approve-affiliate-modal').classList.add('active');
};

document.getElementById('close-approve-modal').addEventListener('click', () => {
  document.getElementById('approve-affiliate-modal').classList.remove('active');
});
document.getElementById('cancel-approve-btn').addEventListener('click', () => {
  document.getElementById('approve-affiliate-modal').classList.remove('active');
});

document.getElementById('approve-affiliate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const affiliateUid = document.getElementById('approve-affiliate-uid').value;
  const ratePercent = parseFloat(document.getElementById('approve-commission-rate').value);

  if (!ratePercent || ratePercent <= 0 || ratePercent > 100) {
    showAlert('Enter a valid commission rate between 1 and 100', 'error');
    return;
  }

  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/affiliates/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ affiliateUid, commissionRate: ratePercent / 100, action: 'approve' })
    });
    const json = await res.json();

    if (!res.ok) {
      showAlert(json.error || 'Could not approve affiliate', 'error');
      return;
    }

    showAlert(`Approved! Referral code: ${json.code}`, 'success');
    document.getElementById('approve-affiliate-modal').classList.remove('active');
    loadAffiliates();
  } catch (error) {
    console.error('Error approving affiliate:', error);
    showAlert('Error approving affiliate: ' + error.message, 'error');
  }
});

window.rejectAffiliate = async (affiliateUid) => {
  if (!confirm('Reject this affiliate application?')) return;

  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/affiliates/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ affiliateUid, action: 'reject' })
    });
    const json = await res.json();

    if (!res.ok) {
      showAlert(json.error || 'Could not reject application', 'error');
      return;
    }

    showAlert('Application rejected', 'success');
    loadAffiliates();
  } catch (error) {
    console.error('Error rejecting affiliate:', error);
    showAlert('Error rejecting affiliate: ' + error.message, 'error');
  }
};

// ====================================================================
// AFFILIATES - CREATE ACCOUNT DIRECTLY (admin picks an existing user)
// ====================================================================
document.getElementById('create-affiliate-btn').addEventListener('click', () => {
  document.getElementById('create-affiliate-form').reset();
  document.getElementById('create-affiliate-uid').value = '';
  document.getElementById('create-affiliate-lookup-status').textContent = '';
  document.getElementById('create-affiliate-modal').classList.add('active');
});

document.getElementById('close-create-affiliate-modal').addEventListener('click', () => {
  document.getElementById('create-affiliate-modal').classList.remove('active');
});
document.getElementById('cancel-create-affiliate-btn').addEventListener('click', () => {
  document.getElementById('create-affiliate-modal').classList.remove('active');
});

// Look up the user by email as soon as they leave the email field
document.getElementById('create-affiliate-email').addEventListener('blur', async (e) => {
  const email = e.target.value.trim();
  const statusEl = document.getElementById('create-affiliate-lookup-status');
  document.getElementById('create-affiliate-uid').value = '';

  if (!email) return;

  statusEl.textContent = 'Looking up user...';
  statusEl.style.color = '#9ca3af';

  try {
    const q = query(collection(db, 'user'), where('email', '==', email));
    const snap = await getDocs(q);

    if (snap.empty) {
      statusEl.textContent = 'No user found with that email';
      statusEl.style.color = '#ef4444';
      return;
    }

    const userDoc = snap.docs[0];
    document.getElementById('create-affiliate-uid').value = userDoc.id;
    statusEl.textContent = `Found: ${userDoc.data().firstName || ''} ${userDoc.data().lastName || ''}`.trim();
    statusEl.style.color = '#059669';
  } catch (error) {
    console.error('Error looking up user:', error);
    statusEl.textContent = 'Error looking up user';
    statusEl.style.color = '#ef4444';
  }
});

document.getElementById('create-affiliate-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const uid = document.getElementById('create-affiliate-uid').value;
  const ratePercent = parseFloat(document.getElementById('create-affiliate-rate').value);

  if (!uid) {
    showAlert('Look up a valid user email first', 'error');
    return;
  }
  if (!ratePercent || ratePercent <= 0 || ratePercent > 100) {
    showAlert('Enter a valid commission rate between 1 and 100', 'error');
    return;
  }

  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/affiliates/create-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ uid, commissionRate: ratePercent / 100 })
    });
    const json = await res.json();

    if (!res.ok) {
      showAlert(json.error || 'Could not create affiliate account', 'error');
      return;
    }

    showAlert(`Affiliate account created! Code: ${json.affiliate.code}`, 'success');
    document.getElementById('create-affiliate-modal').classList.remove('active');
    loadAffiliates();
  } catch (error) {
    console.error('Error creating affiliate account:', error);
    showAlert('Error creating affiliate account: ' + error.message, 'error');
  }
});

console.log('Admin Dashboard loaded successfully');
