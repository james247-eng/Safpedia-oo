// ====================================================================
// TOAST NOTIFICATION SYSTEM
// Shows success, error, info, and warning messages
// ====================================================================

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'error', 'info', or 'warning'
 * @param {number} duration - How long to show (milliseconds), default 4000
 */
export function showToast(message, type = 'info', duration = 8000) {
  // Create toast container if it doesn't exist
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  // Set colors based on type
  const colors = {
    success: { bg: '#d1fae5', border: '#10b981', text: '#065f46', icon: '✓' },
    error: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', icon: '✗' },
    warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', icon: '⚠' },
    info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', icon: 'ⓘ' }
  };

  const color = colors[type] || colors.info;

  toast.style.cssText = `
    background: ${color.bg};
    border-left: 4px solid ${color.border};
    color: ${color.text};
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
    min-width: 300px;
    max-width: 400px;
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideIn 0.3s ease-out;
    cursor: pointer;
  `;

  toast.innerHTML = `
    <span style="font-size: 20px; font-weight: bold;">${color.icon}</span>
    <span style="flex: 1;">${message}</span>
    <span style="font-size: 18px; opacity: 0.5;">×</span>
  `;

  // Add animation styles
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
      .toast:hover {
        box-shadow: 0 15px 35px rgba(0,0,0,0.15);
      }
      @media (max-width: 768px) {
        #toast-container {
          right: 10px;
          left: 10px;
          top: 10px;
        }
        .toast {
          min-width: auto;
          max-width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Add to container
  container.appendChild(toast);

  // Remove on click
  toast.addEventListener('click', () => {
    removeToast(toast);
  });

  // Auto-remove after duration
  setTimeout(() => {
    removeToast(toast);
  }, duration);
}

/**
 * Remove a toast with animation
 */
function removeToast(toast) {
  toast.style.animation = 'slideOut 0.3s ease-out';
  setTimeout(() => {
    toast.remove();
  }, 300);
}

/**
 * Show loading toast (doesn't auto-dismiss)
 * Returns a function to dismiss it
 */
export function showLoading(message = 'Loading...') {
  const container = document.getElementById('toast-container') || (() => {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(c);
    return c;
  })();

  const toast = document.createElement('div');
  toast.className = 'toast toast-loading';
  toast.style.cssText = `
    background: #ffffff;
    border-left: 4px solid #3b82f6;
    color: #1e40af;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
    min-width: 300px;
    max-width: 400px;
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: slideIn 0.3s ease-out;
  `;

  toast.innerHTML = `
    <div style="
      width: 20px;
      height: 20px;
      border: 3px solid #e5e7eb;
      border-top: 3px solid #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    "></div>
    <span style="flex: 1;">${message}</span>
  `;

  // Add spin animation if not exists
  if (!document.getElementById('spin-animation')) {
    const style = document.createElement('style');
    style.id = 'spin-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  container.appendChild(toast);

  // Return dismiss function
  return () => removeToast(toast);
}

// Make available globally
window.showToast = showToast;
window.showLoading = showLoading;