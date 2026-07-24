import { auth, db } from '/firebase-config.js'; 
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

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
    // Wait a bit for webhook to process (10 seconds)
    await new Promise((resolve) => setTimeout(resolve, 10000));

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
      window.location.href = "/users/dashboard.html";
    }, 5000);
  } catch (error) {
    console.error("Error verifying purchase:", error);
    // Still show actions even if verification fails
    document.getElementById("loading").style.display = "none";
    document.getElementById("actions").style.display = "block";
  }
});