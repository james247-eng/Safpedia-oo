// ====================================================================
// ENROLLMENT SUCCESS MODAL
// Shows beautiful success animation before redirecting to checkout
// ====================================================================

/**
 * Show enrollment success modal with animated checkmark
 * @param {Function} callback - Function to call after modal closes
 * @param {string} type - 'signup' or 'login'
 */
export function showEnrollmentSuccessModal(callback, type = 'signup') {
  // Create modal HTML
  const modalHTML = `
    <div class="enrollment-modal-overlay" id="enrollment-modal-overlay">
      <div class="enrollment-modal-content">
        <div class="success-checkmark">
          <div class="check-icon">
            <span class="icon-line line-tip"></span>
            <span class="icon-line line-long"></span>
            <div class="icon-circle"></div>
            <div class="icon-fix"></div>
          </div>
        </div>
        
        <h2 class="success-title">
          ${type === 'signup' ? 'Account Created Successfully!' : 'Welcome Back!'}
        </h2>
        
        <p class="success-message">
          Redirecting you to complete your enrollment...
        </p>
        
        <div class="progress-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>
  `;

  // Inject modal styles if not already present
  if (!document.getElementById('enrollment-modal-styles')) {
    const styles = document.createElement('style');
    styles.id = 'enrollment-modal-styles';
    styles.textContent = `
      .enrollment-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .enrollment-modal-content {
        background: white;
        padding: 50px 40px;
        border-radius: 20px;
        text-align: center;
        max-width: 450px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.4s ease;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Animated Checkmark */
      .success-checkmark {
        width: 80px;
        height: 80px;
        margin: 0 auto 30px;
      }

      .check-icon {
        width: 80px;
        height: 80px;
        position: relative;
        border-radius: 50%;
        box-sizing: content-box;
        border: 4px solid #14b8a6;
        animation: scaleAnimation 0.3s ease 0.5s both;
      }

      @keyframes scaleAnimation {
        0% { transform: scale(0); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }

      .check-icon::before {
        top: 3px;
        left: -2px;
        width: 30px;
        transform-origin: 100% 50%;
        border-radius: 100px 0 0 100px;
      }

      .check-icon::after {
        top: 0;
        left: 30px;
        width: 60px;
        transform-origin: 0 50%;
        border-radius: 0 100px 100px 0;
        animation: rotateCircle 4.25s ease-in;
      }

      .icon-line {
        height: 5px;
        background-color: #14b8a6;
        display: block;
        border-radius: 2px;
        position: absolute;
        z-index: 10;
      }

      .icon-line.line-tip {
        top: 46px;
        left: 14px;
        width: 25px;
        transform: rotate(45deg);
        animation: checkTip 0.75s ease 0.6s both;
      }

      @keyframes checkTip {
        0% {
          width: 0;
          left: 1px;
          top: 19px;
        }
        54% {
          width: 0;
          left: 1px;
          top: 19px;
        }
        70% {
          width: 50px;
          left: -8px;
          top: 37px;
        }
        84% {
          width: 17px;
          left: 21px;
          top: 48px;
        }
        100% {
          width: 25px;
          left: 14px;
          top: 45px;
        }
      }

      .icon-line.line-long {
        top: 38px;
        right: 8px;
        width: 47px;
        transform: rotate(-45deg);
        animation: checkLong 0.75s ease 0.6s both;
      }

      @keyframes checkLong {
        0% {
          width: 0;
          right: 46px;
          top: 54px;
        }
        65% {
          width: 0;
          right: 46px;
          top: 54px;
        }
        84% {
          width: 55px;
          right: 0px;
          top: 35px;
        }
        100% {
          width: 47px;
          right: 8px;
          top: 38px;
        }
      }

      .icon-circle {
        top: -4px;
        left: -4px;
        z-index: 10;
        width: 80px;
        height: 80px;
        border-radius: 50%;
        position: absolute;
        box-sizing: content-box;
        border: 4px solid rgba(20, 184, 166, 0.2);
      }

      .icon-fix {
        top: 8px;
        width: 5px;
        left: 26px;
        z-index: 1;
        height: 85px;
        position: absolute;
        transform: rotate(-45deg);
        background-color: white;
      }

      /* Text Styles */
      .success-title {
        font-size: 28px;
        font-weight: 800;
        color: #1a1f36;
        margin-bottom: 15px;
        animation: fadeInUp 0.5s ease 0.8s both;
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .success-message {
        font-size: 16px;
        color: #6b7280;
        margin-bottom: 25px;
        animation: fadeInUp 0.5s ease 1s both;
      }

      /* Progress Dots */
      .progress-dots {
        display: flex;
        gap: 8px;
        justify-content: center;
        animation: fadeInUp 0.5s ease 1.2s both;
      }

      .dot {
        width: 8px;
        height: 8px;
        background: #14b8a6;
        border-radius: 50%;
        animation: bounce 1.4s infinite ease-in-out both;
      }

      .dot:nth-child(1) {
        animation-delay: -0.32s;
      }

      .dot:nth-child(2) {
        animation-delay: -0.16s;
      }

      @keyframes bounce {
        0%, 80%, 100% {
          transform: scale(0);
          opacity: 0.5;
        }
        40% {
          transform: scale(1);
          opacity: 1;
        }
      }

      /* Responsive */
      @media (max-width: 480px) {
        .enrollment-modal-content {
          padding: 40px 30px;
        }

        .success-title {
          font-size: 24px;
        }

        .success-message {
          font-size: 14px;
        }

        .success-checkmark {
          width: 60px;
          height: 60px;
        }

        .check-icon {
          width: 60px;
          height: 60px;
        }
      }
    `;
    document.head.appendChild(styles);
  }

  // Insert modal into page
  const container = document.getElementById('enrollment-success-modal');
  if (container) {
    container.innerHTML = modalHTML;
    container.style.display = 'block';
  } else {
    // Create container if it doesn't exist
    const newContainer = document.createElement('div');
    newContainer.id = 'enrollment-success-modal';
    newContainer.innerHTML = modalHTML;
    document.body.appendChild(newContainer);
  }

  // Play success sound (optional - you can add this)
  playSuccessSound();

  // Auto-close after 2 seconds and execute callback
  setTimeout(() => {
    const overlay = document.getElementById('enrollment-modal-overlay');
    if (overlay) {
      overlay.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => {
        if (container) {
          container.style.display = 'none';
          container.innerHTML = '';
        }
        if (callback && typeof callback === 'function') {
          callback();
        }
      }, 300);
    }
  }, 2000);
}

/**
 * Optional: Play success sound
 */
function playSuccessSound() {
  try {
    // Create a subtle success beep using Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (e) {
    // Silently fail if Web Audio API not supported
    console.log('Audio not supported');
  }
}

/**
 * Fade out animation keyframes
 */
const fadeOutKeyframes = `
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
`;

// Inject fade out animation
if (!document.getElementById('fadeout-animation')) {
  const style = document.createElement('style');
  style.id = 'fadeout-animation';
  style.textContent = fadeOutKeyframes;
  document.head.appendChild(style);
}

console.log('✅ Enrollment Success Modal loaded');