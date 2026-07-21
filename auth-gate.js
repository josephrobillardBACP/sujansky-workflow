// ═══════════════════════════════════════════════════════════════════
// Authentication gate — Google Sign-In OR email link (magic link)
// with email allowlist. Runs before the workflow app renders; if
// the signed-in user isn't on the allowlist, they're signed back
// out and shown an error.
// ═══════════════════════════════════════════════════════════════════

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

// ── Allowlist ────────────────────────────────────────────────────
// Hardcoded fallback so the Blue Angel team can never accidentally
// lose access. Everyone else is managed via /admin.html.
const ALLOWED_DOMAINS = ["blueangelclinical.com"];
const ALLOWED_EMAILS  = [];
const ALL_PRACTICES   = ["sujansky", "daniher", "staff"];

function checkHardcoded(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(lower)) return true;
  const domain = lower.split("@")[1];
  return ALLOWED_DOMAINS.map(d => d.toLowerCase()).includes(domain);
}

// Cache the dynamic allowlist so repeated calls in one session are cheap.
let dynamicAllowlistCache = null;
async function fetchDynamicAllowlist() {
  if (dynamicAllowlistCache) return dynamicAllowlistCache;
  try {
    const snap = await getDoc(doc(db, "admin", "allowlist"));
    dynamicAllowlistCache = snap.exists() ? (snap.data() || {}) : {};
    dynamicAllowlistCache.emails = dynamicAllowlistCache.emails || {};
  } catch (err) {
    console.warn("Could not fetch dynamic allowlist:", err);
    dynamicAllowlistCache = { emails: {} };
  }
  return dynamicAllowlistCache;
}

// Returns the array of practice ids this user can access:
// ["sujansky"], ["daniher","staff"], etc. Empty array = no access.
async function resolveAccess(email) {
  if (!email) return [];
  const lower = email.toLowerCase();

  // Hardcoded users get full access as a safety net.
  if (checkHardcoded(lower)) return [...ALL_PRACTICES];

  // Managed users get exactly the practices configured for them.
  const dyn = await fetchDynamicAllowlist();
  const entry = dyn.emails?.[lower];
  if (entry && Array.isArray(entry.access)) {
    return entry.access.filter(p => ALL_PRACTICES.includes(p));
  }

  return [];
}

async function isAllowed(email) {
  const access = await resolveAccess(email);
  return access.length > 0;
}

// Email-link sign-in is intentionally stricter than the general allowlist:
// only explicitly-listed emails (not the hardcoded domain) can request a
// magic link. This prevents someone from typing any @blueangelclinical.com
// address and having a link mailed to whoever owns that alias.
async function isAllowedForEmailLink(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(lower)) return true;
  const dyn = await fetchDynamicAllowlist();
  return !!dyn.emails?.[lower];
}

const EMAIL_STORAGE_KEY = "authEmailForLink";

// ── DOM references ───────────────────────────────────────────────
const authGate         = document.getElementById("auth-gate");
const authStatus       = document.getElementById("auth-status");
const authError        = document.getElementById("auth-error");
const authSuccess      = document.getElementById("auth-success");
const signInBtn        = document.getElementById("auth-signin-btn");
const emailInput       = document.getElementById("auth-email-input");
const emailLinkBtn     = document.getElementById("auth-email-link-btn");
const appShell         = document.getElementById("app-shell");
const practicePicker   = document.getElementById("practice-picker");

// Signed-in header pill (shows in the app for context + sign out)
const authHeaderPill  = document.getElementById("auth-header-pill");
const authHeaderEmail = document.getElementById("auth-header-email");
const authHeaderBtn   = document.getElementById("auth-header-signout");

// ── UI state helpers ─────────────────────────────────────────────
function showGate({ error = "", success = "", loading = false } = {}) {
  authGate.style.display = "flex";
  practicePicker.style.display = "none";
  appShell.style.display = "none";
  authHeaderPill.style.display = "none";
  authStatus.textContent = loading ? "Signing you in…" : "";
  authError.textContent = error;
  authError.style.display = error ? "block" : "none";
  authSuccess.textContent = success;
  authSuccess.style.display = success ? "block" : "none";
  signInBtn.disabled = loading;
  emailLinkBtn.disabled = loading;
  emailInput.disabled = loading;
  if (!loading && !success) {
    // Reset email flow after a completed cycle
    emailInput.value = emailInput.value || "";
  }
}

function showApp(email) {
  authGate.style.display = "none";
  authHeaderPill.style.display = "";
  authHeaderEmail.textContent = email;
  if (!window.__workflowState || !window.__workflowState.activePractice) {
    practicePicker.style.display = "";
  }
}

// ── Auth actions ─────────────────────────────────────────────────
let pendingDenialMessage = "";

async function handleGoogleSignInClick() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  signInBtn.disabled = true;
  authStatus.textContent = "Opening Google sign-in…";
  authError.style.display = "none";
  authSuccess.style.display = "none";
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    signInBtn.disabled = false;
    authStatus.textContent = "";
    authError.textContent = `Sign-in failed: ${err?.message || err}`;
    authError.style.display = "block";
  }
}

async function handleEmailLinkSubmit() {
  const email = emailInput.value.trim().toLowerCase();
  authError.style.display = "none";
  authSuccess.style.display = "none";

  if (!email || !email.includes("@")) {
    authError.textContent = "Enter a valid email address.";
    authError.style.display = "block";
    emailInput.focus();
    return;
  }

  if (!(await isAllowedForEmailLink(email))) {
    // Deliberately vague message so we don't leak which addresses ARE on the list.
    authError.textContent = `Email sign-in isn't available for this address. If you're a Blue Angel staff member, use the "Sign in with Google" button above.`;
    authError.style.display = "block";
    return;
  }

  emailLinkBtn.disabled = true;
  emailInput.disabled = true;
  authStatus.textContent = "Sending sign-in link…";

  try {
    await sendSignInLinkToEmail(auth, email, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    });
    window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
    authStatus.textContent = "";
    authSuccess.textContent = `Sign-in link sent to ${email}. Check your inbox (and spam) and click the link to sign in. Links expire in 1 hour.`;
    authSuccess.style.display = "block";
  } catch (err) {
    emailLinkBtn.disabled = false;
    emailInput.disabled = false;
    authStatus.textContent = "";
    authError.textContent = `Could not send link: ${err?.message || err}`;
    authError.style.display = "block";
  }
}

async function handleSignOutClick() {
  try { await signOut(auth); } catch {}
  window.location.reload();
}

signInBtn.addEventListener("click", handleGoogleSignInClick);
emailLinkBtn.addEventListener("click", handleEmailLinkSubmit);
emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); handleEmailLinkSubmit(); }
});
authHeaderBtn.addEventListener("click", handleSignOutClick);

// ── Boot ─────────────────────────────────────────────────────────
showGate({ loading: true });

// Complete an email-link sign-in if the current URL is one.
(async function completeEmailLinkIfPresent() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return;
  let email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
  if (!email) {
    email = window.prompt("Confirm the email address you used to request the sign-in link:");
  }
  if (!email) {
    showGate({ error: "Email confirmation cancelled. Please request a new sign-in link." });
    return;
  }
  try {
    await signInWithEmailLink(auth, email.trim().toLowerCase(), window.location.href);
    window.localStorage.removeItem(EMAIL_STORAGE_KEY);
    // Strip the one-time link params from the URL so a refresh doesn't try to reuse them
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    showGate({ error: `Sign-in link could not be verified: ${err?.message || err}` });
  }
})();

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
  const access = await resolveAccess(email);

  if (!access.length) {
    pendingDenialMessage = `${email} is not authorized to access this workflow. Contact the office administrator to be added.`;
    try { await signOut(auth); } catch {}
    return;
  }

  window.__authUser = {
    email,
    uid: user.uid,
    displayName: user.displayName || "",
    access,
  };
  showApp(email);
  window.dispatchEvent(new CustomEvent("app-authorized", { detail: { email, uid: user.uid, access } }));
});
