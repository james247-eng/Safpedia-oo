// ====================================================================
// SHARED FIREBASE CONFIGURATION
// Tech Wizards Academy - Central Firebase Instance
// ====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAATExPAdi27kKvuvU0ujf6f2QqR8JWwTg",
  authDomain: "tech-wizards-academy.firebaseapp.com",
  projectId: "tech-wizards-academy",
  storageBucket: "tech-wizards-academy.firebasestorage.app",
  messagingSenderId: "155089680506",
  appId: "1:155089680506:web:bd1909e4cc8e85b09663c3",
  measurementId: "G-1JCG9GLV37"
};

// Initialize Firebase (only once)
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export for use in other files
export { app, auth, db };