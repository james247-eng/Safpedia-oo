// ====================================================================
// PROFILE HANDLER - Tech Wizards Academy
// Handles user authentication state and profile icon functionality
// ====================================================================
/*
// ====================================================================
// PROFILE HANDLER - Tech Wizards Academy
// ====================================================================
*/
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBBA8KVzbxoomwAm83erzk_JPxq37H27j0",
  authDomain: "key-board-wizards.firebaseapp.com",
  projectId: "key-board-wizards",
  storageBucket: "key-board-wizards.firebasestorage.app",
  messagingSenderId: "570989716323",
  appId: "1:570989716323:web:adb3d3ae753a91458f2956",
  measurementId: "G-E13DTS3XDB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// ====================================================================
// DOM ELEMENTS
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
    // Wait a bit and try again if DOM isn't ready
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
      const userRole = userData.role || 'student';
      
      // Update profile icon appearance
      profileIcon.classList.add('logged-in');
      
      // Create avatar with user's initial
      profileIcon.innerHTML = `
        <div class="profile-avatar">${firstName.charAt(0).toUpperCase()}</div>
        <span class="profile-text">Dashboard</span>
      `;
      
      // Add click handler for redirect to appropriate dashboard
      profileIcon.onclick = () => {
        if (userRole === 'admin') {
          window.location.href = '/tech wizzards admin dashboard/dashboard.html';
        } else {
          window.location.href = '/students/dashboard.html';
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
    <span class="profile-text">Dashboard</span>
  `;
  
  profileIcon.onclick = () => {
    window.location.href = '/students/dashboard.html';
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

// ====================================================================
// EXPORT FOR TESTING (Optional)
// ====================================================================
export { updateProfileIcon, setGuestProfileIcon };