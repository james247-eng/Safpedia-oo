// ====================================================================
// CHATBOT INQUIRIES - Admin page for chatbot escalations
// SAFpedia
// ====================================================================

import { auth, db } from '../../../firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { collection, getDocs, updateDoc, doc, query, where, orderBy, limit, Timestamp, getDoc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

let allInquiries = [];
let currentStatusFilter = 'all';

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
    if (userData.role !== 'admin') {
      console.warn('Access denied: Not an admin');
      showAlert('Access denied. Admins only.', 'error');
      window.location.href = '../../users/dashboard.html';
      return;
    }

    document.getElementById('user-avatar').textContent = user.email.charAt(0).toUpperCase();
    document.getElementById('admin-display-email').textContent = user.email;
    loadInquiries();

  } catch (error) {
    console.error('Auth error:', error);
    showAlert('Error verifying access. Please try again.', 'error');
    await signOut(auth);
    window.location.href = '../../sign-in.html';
  }
});

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
// LOAD INQUIRIES
// ====================================================================
async function loadInquiries() {
  const tbody = document.getElementById('inquiries-body');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading inquiries...</td></tr>';

  try {
    const inquiriesRef = collection(db, 'chatbotEscalations');
    const q = query(inquiriesRef, orderBy('createdAt', 'desc'), limit(100));
    const snapshot = await getDocs(q);

    allInquiries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInquiries();
  } catch (error) {
    console.error('Failed to load inquiries:', error);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Could not load inquiries. Try again.</td></tr>';
  }
}

// ====================================================================
// RENDER
// ====================================================================
function renderInquiries() {
  const tbody = document.getElementById('inquiries-body');
  const searchTerm = document.getElementById('inquiries-search').value.trim().toLowerCase();

  let filtered = allInquiries;
  if (currentStatusFilter !== 'all') {
    filtered = filtered.filter(i => i.status === currentStatusFilter);
  }
  if (searchTerm) {
    filtered = filtered.filter(i =>
      (i.contact || '').toLowerCase().includes(searchTerm) ||
      (i.topic || '').toLowerCase().includes(searchTerm)
    );
  }

  document.getElementById('inquiries-count').textContent = `${filtered.length} inquir${filtered.length === 1 ? 'y' : 'ies'}`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No inquiries match this view.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(inquiry => {
    const date = inquiry.createdAt?.toDate ? inquiry.createdAt.toDate().toLocaleString() : '—';
    const contactBtn = inquiry.contactMethod === 'whatsapp'
      ? `<button type="button" class="btn btn-secondary btn-sm whatsapp-btn" data-contact="${inquiry.contact}">Message on WhatsApp</button>`
      : `<button type="button" class="btn btn-secondary btn-sm email-btn" data-contact="${inquiry.contact}" data-topic="${escapeAttr(inquiry.topic || '')}">Send Email</button>`;

    let statusAction = '';
    if (inquiry.status === 'new') {
      statusAction = `<button type="button" class="btn btn-primary btn-sm mark-contacted-btn" data-id="${inquiry.id}">Mark Contacted</button>`;
    } else if (inquiry.status === 'contacted') {
      statusAction = `<button type="button" class="btn btn-primary btn-sm mark-resolved-btn" data-id="${inquiry.id}">Mark Resolved</button>`;
    }

    return `
      <tr>
        <td>${inquiry.contact || '—'}</td>
        <td><span class="status-badge ${inquiry.contactMethod === 'whatsapp' ? 'active' : 'pending'}">${inquiry.contactMethod === 'whatsapp' ? 'WhatsApp' : 'Email'}</span></td>
        <td>${inquiry.topic || 'General inquiry'}</td>
        <td>${date}</td>
        <td><span class="status-badge ${inquiry.status}">${capitalize(inquiry.status)}</span></td>
        <td class="action-buttons">
          ${contactBtn}
          <button type="button" class="btn btn-secondary btn-sm view-transcript-btn" data-id="${inquiry.id}">View Transcript</button>
          ${statusAction}
        </td>
      </tr>
    `;
  }).join('');
}

// ====================================================================
// FILTERS
// ====================================================================
document.getElementById('status-filter').addEventListener('change', (e) => {
  currentStatusFilter = e.target.value;
  renderInquiries();
});

document.getElementById('inquiries-search').addEventListener('input', () => {
  renderInquiries();
});

// ====================================================================
// ROW ACTIONS (event delegation)
// ====================================================================
document.getElementById('inquiries-body').addEventListener('click', async (e) => {
  const whatsappBtn = e.target.closest('.whatsapp-btn');
  const emailBtn = e.target.closest('.email-btn');
  const viewBtn = e.target.closest('.view-transcript-btn');
  const contactedBtn = e.target.closest('.mark-contacted-btn');
  const resolvedBtn = e.target.closest('.mark-resolved-btn');

  if (whatsappBtn) {
    const digits = whatsappBtn.dataset.contact.replace(/\D/g, '');
    window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
    return;
  }

  if (emailBtn) {
    const subject = encodeURIComponent(`Re: your Safpedia inquiry`);
    window.location.href = `mailto:${emailBtn.dataset.contact}?subject=${subject}`;
    return;
  }

  if (viewBtn) {
    openTranscriptModal(viewBtn.dataset.id);
    return;
  }

  if (contactedBtn) {
    await updateStatus(contactedBtn.dataset.id, 'contacted');
    return;
  }

  if (resolvedBtn) {
    await updateStatus(resolvedBtn.dataset.id, 'resolved');
    return;
  }
});

// ====================================================================
// STATUS UPDATE
// ====================================================================
async function updateStatus(escalationId, status) {
  try {
    const ref = doc(db, 'chatbotEscalations', escalationId);
    const update = { status };
    if (status === 'contacted') update.contactedAt = Timestamp.now();
    if (status === 'resolved') update.resolvedAt = Timestamp.now();

    await updateDoc(ref, update);

    const inquiry = allInquiries.find(i => i.id === escalationId);
    if (inquiry) Object.assign(inquiry, update);
    renderInquiries();
    showAlert(`Marked as ${status}.`, 'success');
  } catch (error) {
    console.error('Failed to update status:', error);
    showAlert('Could not update status. Try again.', 'error');
  }
}

// ====================================================================
// TRANSCRIPT MODAL
// ====================================================================
function openTranscriptModal(escalationId) {
  const inquiry = allInquiries.find(i => i.id === escalationId);
  const body = document.getElementById('transcript-body');

  if (!inquiry || !Array.isArray(inquiry.transcript) || !inquiry.transcript.length) {
    body.innerHTML = '<div class="empty-state">No transcript recorded for this inquiry.</div>';
  } else {
    body.innerHTML = inquiry.transcript.map(m => `
      <p style="margin-bottom:10px;"><strong>${m.role === 'user' ? 'User' : 'Bot'}:</strong> ${escapeHtml(m.content)}</p>
    `).join('');
  }

  document.getElementById('transcript-modal').classList.add('active');
}

document.getElementById('close-transcript-modal').addEventListener('click', () => {
  document.getElementById('transcript-modal').classList.remove('active');
});

// ====================================================================
// HELPERS
// ====================================================================
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

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