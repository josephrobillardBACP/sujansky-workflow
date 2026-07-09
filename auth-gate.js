// ═══════════════════════════════════════════════════════════════════
// Authentication gate — Google Sign-In with email allowlist
// Runs before the workflow app renders; if the signed-in user isn't
// on the allowlist, they're signed back out and shown an error.
// ═══════════════════════════════════════════════════════════════════

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth } from "./firebase-init.js";

// ── Allowlist ────────────────────────────────────────────────────
const ALLOWED_DOMAINS = ["blueangelclinical.com"];
const ALLOWED_EMAILS  = [
  "amy@amydanihermd.com",
  "doctor@sujanskymd.com",
];

function isAllowed(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(lower)) return true;
  const domain = lower.split("@")[1];
  return ALLOWED_DOMAINS.map(d => d.toLowerCase()).includes(domain);
}

// ── DOM references ───────────────────────────────────────────────
const authGate       = document.getElementById("auth-gate");
const authStatus     = document.getElementById("auth-status");
const authError      = document.getElementById("auth-error");
const authUserEmail  = document.getElementById("auth-user-email");
const signInBtn      = document.getElementById("auth-signin-btn");
const signOutBtn     = document.getElementById("auth-signout-btn");
const appShell       = document.getElementById("app-shell");
const practicePicker = document.getElementById("practice-picker");

// Signed-in header pill (shows in the app for context + sign out)
const authHeaderPill = document.getElementById("auth-header-pill");
const authHeaderEmail= document.getElementById("auth-header-email");
const authHeaderBtn  = document.getElementById("auth-header-signout");

// ── UI state helpers ─────────────────────────────────────────────
function showGate({ error = "", loading = false } = {}) {
  authGate.style.display = "flex";
  practicePicker.style.display = "none";
  appShell.style.display = "none";
  authHeaderPill.style.display = "none";
  authStatus.textContent = loading ? "Signing you in…" : "";
  authError.textContent = error;
  authError.style.display = error ? "block" : "none";
  signInBtn.disabled = loading;
  authUserEmail.style.display = "none";
  signOutBtn.style.display = "none";
}

function showApp(email) {
  authGate.style.display = "none";
  authHeaderPill.style.display = "";
  authHeaderEmail.textContent = email;
  // Practice picker only appears if there is no active practice yet
  if (!window.__workflowState || !window.__workflowState.activePractice) {
    practicePicker.style.display = "";
  }
}

// ── Auth actions ─────────────────────────────────────────────────
// Held across the signOut round-trip so we can display why the user was rejected.
let pendingDenialMessage = "";

async function handleSignInClick() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  signInBtn.disabled = true;
  authStatus.textContent = "Opening Google sign-in…";
  authError.style.display = "none";
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged will take over from here
  } catch (err) {
    signInBtn.disabled = false;
    authStatus.textContent = "";
    authError.textContent = `Sign-in failed: ${err?.message || err}`;
    authError.style.display = "block";
  }
}

async function handleSignOutClick() {
  try { await signOut(auth); } catch {}
  // Fresh slate for the next user (clears in-memory state from app.js)
  window.location.reload();
}

signInBtn.addEventListener("click", handleSignInClick);
signOutBtn.addEventListener("click", handleSignOutClick);
authHeaderBtn.addEventListener("click", handleSignOutClick);

// ── Boot: listen for auth state ──────────────────────────────────
showGate({ loading: true });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (pendingDenialMessage) {
      showGate({ error: pendingDenialMessage });
      pendingDenialMessage = "";
    } else {
      showGate();
    }
    return;
  }

  const email = (user.email || "").toLowerCase();

  if (!isAllowed(email)) {
    // Remember the message, sign out — then the next tick shows it.
    pendingDenialMessage = `${email} is not authorized to access this workflow. Contact the office administrator to be added.`;
    try { await signOut(auth); } catch {}
    return;
  }

  // Allowed — surface user info and show the app
  window.__authUser = { email, uid: user.uid, displayName: user.displayName || "" };
  showApp(email);

  // Notify anyone listening that auth is ready
  window.dispatchEvent(new CustomEvent("app-authorized", { detail: { email, uid: user.uid } }));
});
