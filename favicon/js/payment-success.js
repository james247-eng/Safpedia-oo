 import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
      import {
        getAuth,
        onAuthStateChanged,
      } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
      import {
        getFirestore,
        doc,
        getDoc,
      } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

      // Firebase config
      const firebaseConfig = {
        apiKey: "AIzaSyBBA8KVzbxoomwAm83erzk_JPxq37H27j0",
        authDomain: "key-board-wizards.firebaseapp.com",
        projectId: "key-board-wizards",
        storageBucket: "key-board-wizards.firebasestorage.app",
        messagingSenderId: "570989716323",
        appId: "1:570989716323:web:adb3d3ae753a91458f2956",
        measurementId: "G-E13DTS3XDB",
      };

      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);

      // Get reference from URL
      const urlParams = new URLSearchParams(window.location.search);
      const reference = urlParams.get("reference");
      const trxref = urlParams.get("trxref"); // Paystack uses both

      const actualRef = reference || trxref;

      if (actualRef) {
        document.getElementById("reference").textContent = actualRef;
        document.getElementById("payment-info").style.display = "block";
      }

      // Check authentication and verify purchase
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          // Not logged in - redirect to login
          window.location.href = "/sign-in.html";
          return;
        }

        // Show loading
        document.getElementById("loading").style.display = "block";

        try {
          // Wait a bit for webhook to process (3 seconds)
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // Verify purchase in Firestore
          if (actualRef) {
            const purchaseDoc = await getDoc(doc(db, "purchases", actualRef));

            if (purchaseDoc.exists()) {
              console.log("Purchase verified:", purchaseDoc.data());
            } else {
              console.warn(
                "Purchase not found yet, webhook may still be processing"
              );
            }
          }

          // Hide loading, show actions
          document.getElementById("loading").style.display = "none";
          document.getElementById("actions").style.display = "block";

          // Auto-redirect after 5 seconds
          setTimeout(() => {
            window.location.href = "/students/dashboard.html";
          }, 5000);
        } catch (error) {
          console.error("Error verifying purchase:", error);
          // Still show actions even if verification fails
          document.getElementById("loading").style.display = "none";
          document.getElementById("actions").style.display = "block";
        }
      });