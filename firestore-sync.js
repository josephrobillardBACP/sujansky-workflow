// ═══════════════════════════════════════════════════════════════════
// Firestore sync — mirrors workflow state to the cloud so all
// devices see the same data in real time.
//
// Design: Firestore is the source of truth. localStorage is a
// mirror kept up-to-date via onSnapshot listeners. Existing app.js
// code reads from localStorage synchronously (no changes needed),
// but writes go through cloud-save helpers exposed on window.__cloud.
// ═══════════════════════════════════════════════════════════════════

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth, db } from "./firebase-init.js";

const KEYS = {
  archive:   "travelMedicineArchiveState_v3",
  checklist: "travelMedicineChecklistState_v4",
  travelKit: "travel-kit-workflow-records-v4",
};

function manualKey(practiceId) { return `manual-patients-${practiceId}`; }
const KNOWN_PRACTICES = ["sujansky", "daniher"];

// ── Utilities ────────────────────────────────────────────────────
function readLocal(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

function writeLocal(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function notifyChange() {
  window.dispatchEvent(new CustomEvent("cloud-sync-change"));
}

// Prevent write→read echo loop: when we write to Firestore, we
// also update localStorage locally so the UI is snappy. When the
// listener fires with the same data, we skip the redundant write.
function shallowEqualJSON(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// ══════════════════════════════════════════════════════════════════
// Subscribe once authorized
// ══════════════════════════════════════════════════════════════════

function subscribeAll() {
  // ── Archive (single doc) ───────────────────────────────────────
  onSnapshot(doc(db, "state", "archive"), (snap) => {
    const remote = snap.exists() ? (snap.data().ids || []) : [];
    const local  = readLocal(KEYS.archive, []);
    if (!shallowEqualJSON(local, remote)) {
      writeLocal(KEYS.archive, remote);
      notifyChange();
    }
  }, (err) => console.warn("archive listener error:", err));

  // ── Checklist state (single doc) ───────────────────────────────
  onSnapshot(doc(db, "state", "checklist"), (snap) => {
    const remote = snap.exists() ? (snap.data().state || {}) : {};
    const local  = readLocal(KEYS.checklist, {});
    if (!shallowEqualJSON(local, remote)) {
      writeLocal(KEYS.checklist, remote);
      notifyChange();
    }
  }, (err) => console.warn("checklist listener error:", err));

  // ── Travel kit records (single doc) ────────────────────────────
  onSnapshot(doc(db, "state", "travelKits"), (snap) => {
    const remote = snap.exists() ? (snap.data().records || {}) : {};
    const local  = readLocal(KEYS.travelKit, {});
    if (!shallowEqualJSON(local, remote)) {
      writeLocal(KEYS.travelKit, remote);
      notifyChange();
    }
  }, (err) => console.warn("travel-kit listener error:", err));

  // ── Manual patients (collection) ───────────────────────────────
  // Grouped in localStorage by practiceId. Each patient doc carries
  // its own practiceId field.
  onSnapshot(collection(db, "manualPatients"), (snap) => {
    const byPractice = {};
    KNOWN_PRACTICES.forEach(p => (byPractice[p] = []));
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const practiceId = data.practiceId || data.sourceId;
      if (!practiceId) return;
      if (!byPractice[practiceId]) byPractice[practiceId] = [];
      const { practiceId: _p, ...patientData } = data;
      byPractice[practiceId].push(patientData);
    });
    let changed = false;
    for (const [practiceId, patients] of Object.entries(byPractice)) {
      const key = manualKey(practiceId);
      const local = readLocal(key, []);
      if (!shallowEqualJSON(local, patients)) {
        writeLocal(key, patients);
        changed = true;
      }
    }
    if (changed) notifyChange();
  }, (err) => console.warn("manual patients listener error:", err));
}

// ══════════════════════════════════════════════════════════════════
// Cloud-save API (called by app.js in place of raw localStorage)
// ══════════════════════════════════════════════════════════════════

async function saveArchiveToCloud(ids) {
  writeLocal(KEYS.archive, ids); // optimistic
  try {
    await setDoc(doc(db, "state", "archive"), { ids });
  } catch (err) {
    console.warn("archive save failed:", err);
  }
}

async function saveChecklistToCloud(state) {
  writeLocal(KEYS.checklist, state); // optimistic
  try {
    await setDoc(doc(db, "state", "checklist"), { state });
  } catch (err) {
    console.warn("checklist save failed:", err);
  }
}

async function saveTravelKitsToCloud(records) {
  writeLocal(KEYS.travelKit, records); // optimistic
  try {
    await setDoc(doc(db, "state", "travelKits"), { records });
  } catch (err) {
    console.warn("travel kit save failed:", err);
  }
}

async function saveManualPatientToCloud(practiceId, patient) {
  // Optimistic local write
  const key = manualKey(practiceId);
  const list = readLocal(key, []);
  const idx  = list.findIndex(p => p.id === patient.id);
  if (idx >= 0) list[idx] = patient; else list.push(patient);
  writeLocal(key, list);

  try {
    await setDoc(doc(db, "manualPatients", patient.id), {
      ...patient,
      practiceId,
    });
  } catch (err) {
    console.warn("manual patient save failed:", err);
  }
}

async function deleteManualPatientFromCloud(patientId) {
  try {
    await deleteDoc(doc(db, "manualPatients", patientId));
  } catch (err) {
    console.warn("manual patient delete failed:", err);
  }
}

// ══════════════════════════════════════════════════════════════════
// One-time seed: on first authorized load, push any existing
// localStorage state to Firestore so nothing is lost during cutover.
// ══════════════════════════════════════════════════════════════════

const SEED_FLAG = "cloud-sync-seeded-v1";

async function seedFromLocalIfEmpty() {
  if (window.localStorage.getItem(SEED_FLAG)) return;

  const archive   = readLocal(KEYS.archive, []);
  const checklist = readLocal(KEYS.checklist, {});
  const travelKit = readLocal(KEYS.travelKit, {});

  try {
    if (archive.length)                    await setDoc(doc(db, "state", "archive"),    { ids: archive }, { merge: true });
    if (Object.keys(checklist).length)     await setDoc(doc(db, "state", "checklist"),  { state: checklist }, { merge: true });
    if (Object.keys(travelKit).length)     await setDoc(doc(db, "state", "travelKits"), { records: travelKit }, { merge: true });

    for (const practiceId of KNOWN_PRACTICES) {
      const list = readLocal(manualKey(practiceId), []);
      for (const patient of list) {
        if (!patient?.id) continue;
        await setDoc(doc(db, "manualPatients", patient.id), { ...patient, practiceId }, { merge: true });
      }
    }
    window.localStorage.setItem(SEED_FLAG, "1");
  } catch (err) {
    console.warn("initial seed failed:", err);
  }
}

// ══════════════════════════════════════════════════════════════════
// Bootstrap on auth
// ══════════════════════════════════════════════════════════════════

window.__cloud = {
  saveArchiveToCloud,
  saveChecklistToCloud,
  saveTravelKitsToCloud,
  saveManualPatientToCloud,
  deleteManualPatientFromCloud,
};

let started = false;
async function startSync() {
  if (started) return;
  started = true;
  await seedFromLocalIfEmpty();
  subscribeAll();
}

// Trigger sync whenever Firebase reports an authenticated user.
// Works with or without auth-gate.js in the page.
onAuthStateChanged(auth, (user) => {
  if (user) startSync();
});
