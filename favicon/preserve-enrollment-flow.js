// ====================================================================
// PRESERVE ENROLLMENT FLOW
// Keeps ?next= parameter when switching between login/signup pages
// ====================================================================

(function() {
  console.log('🔗 Enrollment flow preserver loaded');

  // Get current URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const next = urlParams.get('next');
  
  if (next) {
    console.log('📝 Enrollment flow detected for course:', next);
    
    // Update all navigation links when page loads
    document.addEventListener('DOMContentLoaded', () => {
      updateNavigationLinks(next);
    });

    // Also update dynamically added links
    const observer = new MutationObserver(() => {
      updateNavigationLinks(next);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Update all login/signup links to preserve enrollment flow
   */
  function updateNavigationLinks(courseId) {
    // Find all links pointing to signup or login pages
    const links = document.querySelectorAll('a[href*="sign-up.html"], a[href*="sign-in.html"], a[href*="sign-in.html"]');
    
    links.forEach(link => {
      try {
        const url = new URL(link.href, window.location.origin);
        
        // Only add 'next' if it doesn't already exist
        if (!url.searchParams.has('next')) {
          url.searchParams.set('next', courseId);
          link.href = url.toString();
          
          // Add visual indicator (optional)
          if (!link.classList.contains('enrollment-flow-link')) {
            link.classList.add('enrollment-flow-link');
          }
        }
      } catch (e) {
        console.warn('Could not update link:', link.href);
      }
    });

    console.log(`✅ Updated ${links.length} navigation link(s) with enrollment flow`);
  }

  /**
   * Show enrollment context banner
   */
  function showEnrollmentContext() {
    const contextDiv = document.getElementById('enrollment-context');
    if (contextDiv) {
      contextDiv.style.display = 'block';
    }
  }

  // Show enrollment context if it exists
  if (next) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showEnrollmentContext);
    } else {
      showEnrollmentContext();
    }
  }

  /**
   * Intercept form submissions to preserve enrollment flow
   */
  window.addEventListener('load', () => {
    if (!next) return;

    // Find signup/login forms
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
      form.addEventListener('submit', (e) => {
        // Store in session storage as backup
        sessionStorage.setItem('pendingEnrollment', next);
        console.log('💾 Stored enrollment in session storage as backup');
      });
    });
  });

  /**
   * Check session storage for lost enrollment flows
   */
  window.addEventListener('load', () => {
    if (!next) {
      // Check if we lost the parameter but have it in storage
      const pending = sessionStorage.getItem('pendingEnrollment');
      
      if (pending) {
        console.log('🔄 Recovered lost enrollment flow from session storage');
        
        // Redirect with proper parameter
        const currentPath = window.location.pathname;
        if (currentPath.includes('sign-up.html') || currentPath.includes('sign-in.html')) {
          const newUrl = `${currentPath}?next=${encodeURIComponent(pending)}`;
          window.history.replaceState({}, '', newUrl);
          
          // Trigger page refresh to pick up the parameter
          window.location.reload();
        }
      }
    } else {
      // Clear session storage if we have the parameter in URL
      sessionStorage.removeItem('pendingEnrollment');
    }
  });

})();

console.log('✅ Enrollment flow preservation system active');