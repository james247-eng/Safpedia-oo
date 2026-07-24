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

  // Helper function to bind drag-and-drop to a zone
  function setupDropZone(dropZone, fileInput, statusEl) {
    // Click on dropzone to open standard file browser
    dropZone.addEventListener('click', () => fileInput.click());

    // Highlight drop zone when dragging over
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    // Un-highlight drop zone when leaving/dropping
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    // Handle dropped files
    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files; // Assign files to hidden input
        const textEl = dropZone.querySelector('.drop-zone-text');
        if (textEl) textEl.innerHTML = `Selected file: <strong>${files[0].name}</strong>`;
      }
    });

    // Update text if chosen via click/browse
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        const textEl = dropZone.querySelector('.drop-zone-text');
        if (textEl) textEl.innerHTML = `Selected file: <strong>${fileInput.files[0].name}</strong>`;
      }
    });
  }

  // Bind Audio Drop Zone
  const audioZone = root.querySelector('.lesson-audio-drop-zone');
  const audioInput = root.querySelector('.lesson-audio-file');
  const audioStatus = root.querySelector('.lesson-audio-status');
  setupDropZone(audioZone, audioInput, audioStatus);

  // Bind PDF Drop Zone
  const pdfZone = root.querySelector('.lesson-pdf-drop-zone');
  const pdfInput = root.querySelector('.lesson-pdf-file');
  const pdfStatus = root.querySelector('.lesson-pdf-status');
  setupDropZone(pdfZone, pdfInput, pdfStatus);

  // Audio upload -> Cloudinary
  root.querySelector('.lesson-audio-upload-btn').addEventListener('click', async () => {
    const fileInput = root.querySelector('.lesson-audio-file');
    const statusEl = root.querySelector('.lesson-audio-status');
    const urlInput = root.querySelector('.lesson-content-url');

    if (!fileInput.files[0]) {
      showAlert('Choose or drag an audio file first', 'error');
      return;
    }
    statusEl.textContent = 'Uploading...';
    statusEl.style.color = '#9ca3af';
    try {
      const url = await uploadToCloudinary(fileInput.files[0], 'course-audio');
      urlInput.value = url;
      statusEl.textContent = 'Uploaded ✓';
      statusEl.style.color = '#059669';
    } catch (error) {
      statusEl.textContent = 'Upload failed: ' + error.message;
      statusEl.style.color = '#ef4444';
    }
  });

  // PDF upload -> Cloudinary
  root.querySelector('.lesson-pdf-upload-btn').addEventListener('click', async () => {
    const fileInput = root.querySelector('.lesson-pdf-file');
    const statusEl = root.querySelector('.lesson-pdf-status');
    const urlInput = root.querySelector('.lesson-content-url');

    if (!fileInput.files[0]) {
      showAlert('Choose or drag a PDF file first', 'error');
      return;
    }
    statusEl.textContent = 'Uploading...';
    statusEl.style.color = '#9ca3af';
    try {
      const url = await uploadToCloudinary(fileInput.files[0], 'course-pdfs');
      urlInput.value = url;
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