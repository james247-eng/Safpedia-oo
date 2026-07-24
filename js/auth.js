import { auth, db } from '/firebase-config.js'; // Centralized shared instance
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { showToast, showLoading } from './toast-notification.js';

// Initialize Analytics using the shared app instance behind the config if needed
const analytics = getAnalytics(auth.app);

// ====================================================================
// SIGNUP HANDLER
// ====================================================================
const signupForm = document.getElementById('signup-form');
const signupBtn = document.getElementById('signup-btn');

if (signupForm && signupBtn) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const course = document.getElementById('course-selection').value || '';
    const alert_container = document.getElementById('signup-result');
    
    // Validate form values
    if (!firstName || !lastName || !email || !password || !phone) {
      if (alert_container) alert_container.textContent = 'Please fill in all required fields.';
      showToast('Please fill in all required fields', 'error');
      return;
    }

    // Show loading
    const originalText = signupBtn.textContent;
    signupBtn.disabled = true;
    signupBtn.textContent = 'Creating account...';
    const dismissLoading = showLoading('Creating your account...');

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userData = {
        firstName,
        lastName,
        email,
        phone,
        preferredCourse: course,
        enrolledCourses: [],
        role: 'user',
        createdAt: new Date().toISOString()
      };

      try {
        await setDoc(doc(db, 'user', user.uid), userData);
        console.log('✅ User profile created:', user.uid);
      } catch (fireErr) {
        console.error('❌ Failed to write user doc:', fireErr);
        
        // Try to clean up auth user
        try {
          await user.delete();
        } catch (delErr) {
          console.error('Failed to delete auth user:', delErr);
        }
        
        dismissLoading();
        signupBtn.disabled = false;
        signupBtn.textContent = originalText;
        
        const msg = 'Signup failed: Could not create user profile.';
        if (alert_container) alert_container.textContent = msg;
        showToast(msg, 'error');
        return;
      }

      // Dismiss loading
      dismissLoading();

      // ⭐ SIMPLE: ALWAYS GO TO DASHBOARD
      // The dashboard will check localStorage for pending enrollment
      console.log('✅ Account created successfully, redirecting to dashboard...');
      showToast('Account created successfully! Redirecting...', 'success');
      
      setTimeout(() => { 
        window.location.href = '/users/dashboard.html'; 
      }, 1000);

    } catch (error) {
      // Dismiss loading
      dismissLoading();

      // Reset button
      signupBtn.disabled = false;
      signupBtn.textContent = originalText;

      console.error('Signup error:', error);
      
      // Better error messages
      let errorMsg = 'Signup failed: ' + error.message;
      
      if (error.code === 'auth/email-already-in-use') {
        errorMsg = 'That email is already in use. Please login instead.';
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = 'Invalid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMsg = 'Password should be at least 6 characters.';
      }
      
      if (alert_container) alert_container.textContent = errorMsg;
      showToast(errorMsg, 'error');
    }
  });
}

// ====================================================================
// LOGIN HANDLER
// ====================================================================
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
  
if (loginForm && loginBtn) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const log_in_email = document.getElementById('log-in-email').value.trim();
    const log_in_password = document.getElementById('log-in-password').value.trim();
    const alert_container = document.getElementById('login-result');

    if (!log_in_email || !log_in_password) {
      if (alert_container) alert_container.textContent = 'Please fill in your credentials.';
      showToast('Please enter email and password', 'error');
      return;
    }

    // Show loading
    const originalText = loginBtn.textContent;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    const dismissLoading = showLoading('Logging you in...');

    try {
      const userCredential = await signInWithEmailAndPassword(auth, log_in_email, log_in_password);
      const user = userCredential.user;

      // Fetch user role from Firestore
      const userDocRef = doc(db, 'user', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        console.error('User document not found');
        if (alert_container) alert_container.textContent = 'User profile not found. Please contact support.';
        showToast('User profile not found', 'error');
        
        dismissLoading();
        loginBtn.disabled = false;
        loginBtn.textContent = originalText;
        return;
      }

      const userData = userDocSnap.data();
      const userRole = userData.role;

      // Dismiss loading
      dismissLoading();

      console.log('✅ Login successful');
      showToast('Login successful!', 'success');
      
      // ⭐ SIMPLE: ROLE-BASED REDIRECT ONLY
      // Dashboard will handle pending enrollment
      setTimeout(() => {
        if (userRole === 'admin') {
          window.location.href = '/safpedia concept admin dashboard/dashboard.html';
        } else {
          window.location.href = '/users/dashboard.html';
        }
      }, 500);

    } catch (error) {
      // Dismiss loading
      dismissLoading();

      // Reset button
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;

      console.error('Login error:', error);
      
      // Better error messages
      let errorMsg = error.message;
      
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        errorMsg = 'Incorrect email or password.';
      } else if (error.code === 'auth/user-not-found') {
        errorMsg = 'No account found with this email.';
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = 'Invalid email address.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMsg = 'Too many failed attempts. Please try again later.';
      }
      
      if (alert_container) alert_container.textContent = errorMsg;
      showToast(errorMsg, 'error');
    }
  });
}

// ====================================================================
// PROFILE NAV INTERACTION & INTERFACE MANAGEMENT
// ====================================================================
let profileIcon;
let navbar;

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  profileIcon = document.getElementById('profile-icon');
  navbar = document.getElementById('navbar');
  
  // Initialize mobile menu
  initMobileMenu();
  
  // Initialize scroll effects
  initScrollEffects();
  
  // Initialize preloader
  initPreloader();
  
  // Initialize smooth scroll
  initSmoothScroll();
});

// ====================================================================
// PRELOADER
// ====================================================================
function initPreloader() {
  window.addEventListener('load', () => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      setTimeout(() => {
        preloader.classList.add('hidden');
        // Remove from DOM after animation completes
        setTimeout(() => {
          preloader.remove();
        }, 500);
      }, 1000); // Show for at least 1 second
    }
  });
}

// ====================================================================
// MOBILE MENU
// ====================================================================
function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
  
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileMenuBtn.classList.toggle('active');
      mobileMenu.classList.toggle('active');
    });
    
    // Close menu when clicking on a link
    mobileNavLinks.forEach(link => {
      link.addEventListener('click', () => {
        mobileMenuBtn.classList.remove('active');
        mobileMenu.classList.remove('active');
      });
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileMenuBtn.classList.remove('active');
        mobileMenu.classList.remove('active');
      }
    });
  }
}

// ====================================================================
// SCROLL EFFECTS
// ====================================================================
function initScrollEffects() {
  window.addEventListener('scroll', () => {
    if (navbar) {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }
  });
}

// ====================================================================
// SMOOTH SCROLL
// ====================================================================
function initSmoothScroll() {
  const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');
  
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      
      // Only handle internal links that start with #
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const target = document.querySelector(href);
        
        if (target) {
          const offsetTop = target.offsetTop - 80; // Account for fixed navbar
          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      }
    });
  });
}

// ====================================================================
// AUTH STATE LISTENER
// ====================================================================
onAuthStateChanged(auth, async (user) => {
  if (!profileIcon) {
    // Wait a bit and try again if DOM isn't ready yet
    setTimeout(() => {
      profileIcon = document.getElementById('profile-icon');
      if (profileIcon && user) {
        updateProfileIcon(user);
      } else if (profileIcon) {
        setGuestProfileIcon();
      }
    }, 100);
    return;
  }
  
  if (user) {
    // User is logged in
    console.log('User logged in:', user.uid);
    await updateProfileIcon(user);
  } else {
    // User is logged out
    console.log('No user logged in');
    setGuestProfileIcon();
  }
});

// ====================================================================
// UPDATE PROFILE ICON FOR LOGGED-IN USER
// ====================================================================
async function updateProfileIcon(user) {
  try {
    // Fetch user data from Firestore to get role
    const userDocRef = doc(db, 'user', user.uid);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      const firstName = userData.firstName || user.email.charAt(0);
      const userRole = userData.role || 'user';
      
      // Update profile icon appearance
      profileIcon.classList.add('logged-in');
      
      // Create avatar with user's initial
      profileIcon.innerHTML = `
        <div class="profile-avatar">${firstName.charAt(0).toUpperCase()}</div>
      `;
      
      // Add click handler for redirect to appropriate dashboard
      profileIcon.onclick = () => {
        if (userRole === 'admin') {
          window.location.href = '/safpedia concept admin dashboard/dashboard.html';
        } else {
          window.location.href = '/users/dashboard.html';
        }
      };
      
      console.log('Profile icon updated for user:', firstName, 'Role:', userRole);
      
    } else {
      console.warn('User document not found in Firestore');
      setDefaultLoggedInIcon(user);
    }
    
  } catch (error) {
    console.error('Error fetching user data:', error);
    setDefaultLoggedInIcon(user);
  }
}

// ====================================================================
// SET DEFAULT LOGGED-IN ICON (Fallback)
// ====================================================================
function setDefaultLoggedInIcon(user) {
  profileIcon.classList.add('logged-in');
  
  const initial = user.email ? user.email.charAt(0).toUpperCase() : 'U';
  
  profileIcon.innerHTML = `
    <div class="profile-avatar">${initial}</div>
  `;
  
  profileIcon.onclick = () => {
    window.location.href = '/users/dashboard.html';
  };
}

// ====================================================================
// SET GUEST PROFILE ICON
// ====================================================================
function setGuestProfileIcon() {
  profileIcon.classList.remove('logged-in');
  
  profileIcon.innerHTML = `
    <ion-icon name="person-outline"></ion-icon>
    <span class="profile-text">Login</span>
  `;
  
  profileIcon.onclick = () => {
    window.location.href = '/sign-in.html';
  };
  
  console.log('Guest profile icon set');
}

console.log('✅ Auth and navigation handling systems completely loaded together');