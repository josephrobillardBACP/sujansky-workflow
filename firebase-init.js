// ═══════════════════════════════════════════════════════════════════
// Firebase initialization — must load before auth-gate.js
// ═══════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDb84xpoq9Z4NRUJ3xu3f_qj-qzHsMM-f8",
  authDomain: "travel-medicine-workflow-ee312.firebaseapp.com",
  projectId: "travel-medicine-workflow-ee312",
  storageBucket: "travel-medicine-workflow-ee312.firebasestorage.app",
  messagingSenderId: "814155807315",
  appId: "1:814155807315:web:e3c7c251cbcd666ba424a6",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth        = getAuth(firebaseApp);
export const db          = getFirestore(firebaseApp);

// Expose for classic-script code (app.js) to read from.
window.__firebase = { firebaseApp, auth, db };
