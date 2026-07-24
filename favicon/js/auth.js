
  import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";

  import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";
  import { getFirestore, collection, getDocs, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

  import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { showToast, showLoading } from './toast-notification.js';

  const firebaseConfig = {

    apiKey: "AIzaSyBBA8KVzbxoomwAm83erzk_JPxq37H27j0",

    authDomain: "key-board-wizards.firebaseapp.com",

    projectId: "key-board-wizards",

    storageBucket: "key-board-wizards.firebasestorage.app",

    messagingSenderId: "570989716323",

    appId: "1:570989716323:web:adb3d3ae753a91458f2956",

    measurementId: "G-E13DTS3XDB"

  };


  // Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);



// Signup handler (signup.html uses form id 'signup-form')
/*======================================================*/
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
    
    // validate form values
    if (!firstName || !lastName || !email || !password || !phone) {
      alert_container.textContent = 'Please fill in all required fields.';
      return;
    }

    //  ============================= MY EDITS =============================  
    // Show loading
    const originalText = signupBtn.textContent;
    signupBtn.disabled = true;
    signupBtn.textContent = 'Creating account...';
    const dismissLoading = showLoading('Creating your account...');
    //  ============================= MY EDITS =============================  

    // create user account
    //  ============================= MY EDITS =============================  
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
        role: 'student',
        createdAt: new Date().toISOString()
      };


      try {
        const writeResult = await setDoc(doc(db, 'user', user.uid), userData);
        console.log('User profile written for', user.uid, writeResult);
      } catch (fireErr) {
        console.error('Failed to write user doc after auth created:', fireErr);
        // Try to clean up created auth user to avoid orphaned accounts
        try {
          await user.delete();
        } catch (delErr) {
          console.error('Failed to delete auth user after Firestore failure:', delErr);
        }
        const msg = 'Signup failed: could not write user data. Check Firestore rules/permissions.';
        if (alert_container) alert_container.textContent = msg; else alert(msg);
        return;
      }

//  ============================= MY EDITS =============================
// Dismiss loading
      dismissLoading();

      // Show success
      showToast('Account created successfully! Redirecting...', 'success');
//  ============================= MY EDITS =============================


      // Save user ID in localStorage for session persistence
  localStorage.setItem('user', JSON.stringify(user.uid));
  // redirect to next if present
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  const redirectUrl = next ? '/all-courses.html?autoBuy=' + encodeURIComponent(next) : '/students/dashboard.html';
  // ensure user sees success message briefly
  // const successMsg = 'Signup successful. Redirecting...'
  // if (alert_container) alert_container.textContent = successMsg; else return;
  setTimeout(() => { window.location.href = redirectUrl; }, 700);

    } catch (error) {

      //  ============================= MY EDITS =============================
       // Dismiss loading
      dismissLoading();

      // Reset button
      signupBtn.disabled = false;
      signupBtn.textContent = originalText; 
      // ================== MY EDITS =============================
      console.error('Signup error', error);
      // Better messaging for common cases
      if (error.code === 'auth/email-already-in-use') {
        if (alert_container) alert_container.textContent = 'That email address is already in use. Please log in.';
      } else if (error.code === 'auth/invalid-email') {
        if (alert_container) alert_container.textContent = 'Invalid email address.';
      } else {
        if (alert_container) alert_container.textContent = 'Signup failed: ' + (error.message || error);
      }
    }
  });
}
 
// Login handler (login.html uses form id 'login-form')

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
      return;
    }
//  ============================= MY EDITS =============================
    // Show loading
    const originalText = loginBtn.textContent;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    const dismissLoading = showLoading('Logging you in...');
//  ============================= MY EDITS =============================
    try {
      const userCredential = await signInWithEmailAndPassword(auth, log_in_email, log_in_password);
      const user = userCredential.user;

      // Fetch user role from Firestore
      const userDocRef = doc(db, 'user', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        console.error('User document not found in Firestore');
        if (alert_container) alert_container.textContent = 'User profile not found. Please contact support.';
         //============================= MY EDITS ============================= 
        // Dismiss loading
      dismissLoading();
      //============================= MY EDITS =============================

      // Reset button
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;
      //============================= MY EDITS =============================

      return;
      }

      const userData = userDocSnap.data();
      const userRole = userData.role;

      // Check for next parameter
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');

      // Role-based redirect
      if (next) {
        window.location.href = '/all-courses.html?autoBuy=' + encodeURIComponent(next);
      } else {
        if (userRole === 'admin') {
          window.location.href = '/tech wizzards admin dashboard/dashboard.html';
        } else if (userRole === 'student') {
          window.location.href = '/students/dashboard.html';
        } else {
          // Fallback for unknown roles
          console.warn('Unknown user role:', userRole);
          window.location.href = '/students/dashboard.html';
        }
      }
    } catch (error) {
      // Dismiss loading
      dismissLoading();

      // Reset button
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;


       console.error('Login error', error);
      // if (alert_container) alert_container.textContent = 'Login failed: ' + error.message;
      showToast(error.message, 'error');
    }
  });
}
// ====================================================================
// TOAST NOTIFICATION SYSTEM (toast-notification.js)
// ====================================================================