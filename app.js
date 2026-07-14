// ═══════════════════════════════════════════════════════════════════
// CHECKLIST STEPS
// ═══════════════════════════════════════════════════════════════════

const CHECKLIST = [
  {
    html: `Enter patient in <a class="checklist-link" href="https://travelcare.com/" target="_blank" rel="noopener noreferrer">TravelCare</a> and generate report`,
  },
  { text: "Determine and order recommended vaccines" },
  { text: "Schedule patient appointment for pre-travel consultation and vaccine administration",
    notes: ["Calculate vaccine costs and confirm with patient", "Schedule once vaccines have arrived"] },
  { text: "Write and order prescriptions" },
  {
    html: `Assemble <a class="checklist-link" href="travel_kit.html" target="_blank" rel="noopener noreferrer">travel kit</a>`,
  },
  { text: "Conduct patient appointment, administer vaccines, assign prescriptions, and provide the travel kit" },
  { text: "Schedule any follow-ups if necessary" },
  { text: "Mark patient cleared for travel" },
];

// ═══════════════════════════════════════════════════════════════════
// RUNTIME STATE
// ═══════════════════════════════════════════════════════════════════

let activePractice       = null;
let patients             = [];
let expandedId           = null;
let activePracticeFilter = "all";

// ── Persistence ──────────────────────────────────────────────────

// Shared across every view so archiving in one place hides the patient everywhere.
const SHARED_CHECKLIST_KEY = "travelMedicineChecklistState_v4";
const SHARED_ARCHIVE_KEY   = "travelMedicineArchiveState_v3";

// One-time migration from the old per-practice keys → shared keys.
(function migrateSharedState() {
  try {
    if (!localStorage.getItem(SHARED_ARCHIVE_KEY)) {
      const merged = new Set();
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith("travelMedicineArchiveState_v2_")) {
          try {
            const ids = JSON.parse(localStorage.getItem(k) || "[]");
            if (Array.isArray(ids)) ids.forEach(id => merged.add(id));
          } catch {}
        }
      });
      if (merged.size) localStorage.setItem(SHARED_ARCHIVE_KEY, JSON.stringify([...merged]));
    }

    if (!localStorage.getItem(SHARED_CHECKLIST_KEY)) {
      const merged = {};
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith("travelMedicineChecklistState_v3_")) {
          try {
            const state = JSON.parse(localStorage.getItem(k) || "{}");
            Object.entries(state).forEach(([pid, tasks]) => {
              merged[pid] = { ...(merged[pid] || {}), ...tasks };
            });
          } catch {}
        }
      });
      if (Object.keys(merged).length) localStorage.setItem(SHARED_CHECKLIST_KEY, JSON.stringify(merged));
    }
  } catch {}
})();

function loadState() {
  try { return JSON.parse(localStorage.getItem(SHARED_CHECKLIST_KEY) || "{}"); }
  catch { return {}; }
}

function saveState(s) {
  localStorage.setItem(SHARED_CHECKLIST_KEY, JSON.stringify(s));
  if (window.__cloud?.saveChecklistToCloud) window.__cloud.saveChecklistToCloud(s);
}

function loadArchive() {
  try { return JSON.parse(localStorage.getItem(SHARED_ARCHIVE_KEY) || "[]"); }
  catch { return []; }
}

function saveArchive(ids) {
  localStorage.setItem(SHARED_ARCHIVE_KEY, JSON.stringify(ids));
  if (window.__cloud?.saveArchiveToCloud) window.__cloud.saveArchiveToCloud(ids);
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr + "T00:00:00") - TODAY) / 86_400_000);
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d) ? dateStr : d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function firstDeparture(p) {
  return p.stops?.[0]?.arrival ?? "";
}

function departureChip(p) {
  const dateStr = firstDeparture(p);
  const days    = daysUntil(dateStr);
  if (days === null) return `<span class="chip chip-muted">No date</span>`;
  if (days < 0)      return `<span class="chip chip-muted">Departed</span>`;
  if (days === 0)    return `<span class="chip chip-danger">Departs today!</span>`;
  if (days <= 7)     return `<span class="chip chip-danger">Departs in ${days}d</span>`;
  if (days <= 30)    return `<span class="chip chip-warning">Departs in ${days}d</span>`;
  return `<span class="chip chip-muted">Departs ${fmtDate(dateStr)}</span>`;
}

function countryCount(stops) {
  return new Set((stops || []).map(s => s.country).filter(Boolean)).size;
}

function destinationLabel(stops) {
  if (!stops || !stops.length) return "Unknown destination";
  const first = [stops[0].country, stops[0].city].filter(Boolean).join(", ");
  if (stops.length === 1) return first;
  return `${first} + ${stops.length - 1} more`;
}

function travelLocationsParam(stops) {
  const parts = (stops || [])
    .map(stop => [stop.country, stop.city].filter(Boolean).join(", "))
    .filter(Boolean);
  return parts.join(" | ") || "Unknown destination";
}

function buildTravelKitUrl(patient) {
  const url = new URL("travel_kit.html", window.location.href);
  url.searchParams.set("view", activePractice?.isStaff ? "staff" : "doctor");
  url.searchParams.set("patientId", patient.id);
  url.searchParams.set("patient", patient.name);
  url.searchParams.set("practice", patient.sourceId || activePractice.id);
  url.searchParams.set("locations", travelLocationsParam(patient.stops));
  return url.toString();
}

function getTravelKitStorageKey() {
  return "travel-kit-workflow-records-v4";
}

function getTravelKitRecordKey(patient) {
  return `${patient.sourceId || activePractice.id}::${patient.id}`;
}

function loadTravelKitRecords() {
  try {
    return JSON.parse(window.localStorage.getItem(getTravelKitStorageKey()) || "{}");
  } catch (error) {
    return {};
  }
}

function isTravelKitApproved(patient) {
  const records = loadTravelKitRecords();
  return !!records[getTravelKitRecordKey(patient)]?.approved;
}

function renderTravelKitApproval(patient) {
  const approved = isTravelKitApproved(patient);
  return `<a class="approval-pill ${approved ? "approval-pill-approved" : "approval-pill-pending"}" data-patient-id="${patient.id}" data-task-index="4" href="${buildTravelKitUrl(patient)}" target="_blank" rel="noopener noreferrer">${approved ? "Approved" : "Not Approved"}</a>`;
}

function renderChecklistTask(task, index, patient) {
  if (index === 4) {
    return `<span class="checklist-inline">Assemble <a class="checklist-link" href="${buildTravelKitUrl(patient)}" target="_blank" rel="noopener noreferrer">travel kit</a> ${renderTravelKitApproval(patient)}</span>`;
  }
  return task.html ?? task.text;
}

function isTaskChecked(patient, taskIndex, state) {
  return !!(state[patient.id] || {})[taskIndex];
}

function getProgress(patientId, state) {
  const patient = patients.find(entry => entry.id === patientId);
  const ps    = state[patientId] || {};
  const done  = CHECKLIST.filter((_, i) => patient ? isTaskChecked(patient, i, state) : ps[i]).length;
  const total = CHECKLIST.length;
  const pct   = Math.round(done / total * 100);
  if (done === 0)     return { label: "Not started", cls: "status-not-started", done, total, pct };
  if (done === total) return { label: "Complete",    cls: "status-complete",     done, total, pct };
  return               { label: "In progress",  cls: "status-in-progress",  done, total, pct };
}

const ARCHIVE_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`;

// ═══════════════════════════════════════════════════════════════════
// SYNC STATUS
// ═══════════════════════════════════════════════════════════════════

function setSyncStatus(state, text) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.dataset.state = state;
  el.textContent   = text;
}

// ═══════════════════════════════════════════════════════════════════
// RENDER — Stats bar
// ═══════════════════════════════════════════════════════════════════

function renderStats() {
  const state    = loadState();
  const archived = loadArchive();
  let notStarted = 0, inProgress = 0, complete = 0;

  patients
    .filter(p => !archived.includes(p.id))
    .forEach(p => {
      const { cls } = getProgress(p.id, state);
      if      (cls === "status-not-started") notStarted++;
      else if (cls === "status-complete")    complete++;
      else                                   inProgress++;
    });

  const archivedCount   = archived.filter(id => patients.some(p => p.id === id)).length;
  const clearedArchived = complete + archivedCount;
  const drawerOpen      = document.getElementById("archive-drawer").dataset.open === "true";

  document.getElementById("stats-bar").innerHTML = `
    <div class="stat-card stat-not-started">
      <div class="stat-count">${notStarted}</div>
      <div class="stat-label">Not started</div>
    </div>
    <div class="stat-card stat-in-progress">
      <div class="stat-count">${inProgress}</div>
      <div class="stat-label">In progress</div>
    </div>
    <button class="stat-archived${drawerOpen ? " stat-archive-active" : ""}" id="archived-stat-btn" type="button">
      <div class="stat-count">${clearedArchived}</div>
      <div class="stat-label">Cleared / Archived ${drawerOpen ? "▲" : "▼"}</div>
    </button>
  `;

  document.getElementById("archived-stat-btn").addEventListener("click", toggleArchiveDrawer);
}

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE DRAWER
// ═══════════════════════════════════════════════════════════════════

function toggleArchiveDrawer() {
  const drawer = document.getElementById("archive-drawer");
  const isOpen = drawer.dataset.open === "true";
  drawer.dataset.open = String(!isOpen);
  if (!isOpen) {
    renderArchiveDrawer();
  } else {
    drawer.innerHTML = "";
  }
  renderStats();
}

function renderArchiveDrawer() {
  const drawer           = document.getElementById("archive-drawer");
  const archived         = loadArchive();
  const state            = loadState();
  const archivedPatients = patients.filter(p => archived.includes(p.id));

  if (!archivedPatients.length) {
    drawer.innerHTML = '<div class="archive-empty">No archived patients yet.</div>';
    return;
  }

  drawer.innerHTML = `
    <div class="archive-header">Archived patients</div>
    ${archivedPatients.map(p => {
      const prog = getProgress(p.id, state);
      return `
        <div class="archive-row">
          <div class="archive-info">
            <span class="archive-name">${p.name}</span>
            <span class="archive-meta">${destinationLabel(p.stops)} · Departs ${fmtDate(firstDeparture(p))}</span>
            <span class="archive-status ${prog.cls}">${prog.label}</span>
          </div>
          <button class="unarchive-btn" data-patient-id="${p.id}" type="button">Restore</button>
        </div>`;
    }).join("")}
  `;

  drawer.querySelectorAll(".unarchive-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      saveArchive(loadArchive().filter(id => id !== btn.dataset.patientId));
      renderPatients();
      renderArchiveDrawer();
      renderStats();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// RENDER — Patient list
// ═══════════════════════════════════════════════════════════════════

function getFilteredSorted() {
  const q        = (document.getElementById("search")?.value || "").toLowerCase().trim();
  const archived = loadArchive();
  const isStaff  = !!activePractice?.isStaff;
  const active   = patients.filter(p =>
    !archived.includes(p.id) &&
    (!isStaff || activePracticeFilter === "all" || p.sourceId === activePracticeFilter)
  );
  const visible  = q
    ? active.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.practice || "").toLowerCase().includes(q) ||
        (p.stops || []).some(s =>
          s.country.toLowerCase().includes(q) || s.city.toLowerCase().includes(q)))
    : active;
  return [...visible].sort((a, b) => new Date(firstDeparture(a)) - new Date(firstDeparture(b)));
}

function sourceChip(p) {
  if (!activePractice?.isStaff) return "";
  if (!p.sourceId) return "";
  return `<span class="chip source-chip source-${p.sourceId}">${p.practice} Workflow</span>`;
}

function renderItinerary(p) {
  if (!p.stops || !p.stops.length) return "";
  const n = p.numCountries || countryCount(p.stops);
  const selections = Array.isArray(p.travelSelections) ? p.travelSelections : [];
  const comments = String(p.concerns ?? "").trim();

  return `
    <div class="patient-info-section">
      <div class="info-section-title">Itinerary — ${n} ${n === 1 ? "country" : "countries"}</div>
      <table class="itinerary-table">
        <thead>
          <tr>
            <th>Country</th>
            <th>City / Region / Area</th>
            <th>Arrival</th>
            <th>Departure</th>
          </tr>
        </thead>
        <tbody>
          ${p.stops.map(s => `
            <tr>
              <td class="itinerary-primary">${s.country || "—"}</td>
              <td class="itinerary-secondary">${s.city || "—"}</td>
              <td class="itinerary-date">${fmtDate(s.arrival)}</td>
              <td class="itinerary-date">${fmtDate(s.departure)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="itinerary-facts">
        ${selections.length ? `
          <div class="fact-card fact-card-wide">
            <span class="fact-label">Select all that apply</span>
            <div class="travel-flags-list">
              ${selections.map(item => `<div class="travel-flag">${escapeHtml(item)}</div>`).join("")}
            </div>
          </div>` : ""}
        ${comments ? `
          <div class="fact-card fact-card-wide">
            <span class="fact-label">Any more details or questions surrounding your travel the office should be aware of?</span>
            <div class="travel-comments-copy">${escapeHtml(comments).replace(/\r?\n/g, "<br />")}</div>
          </div>` : ""}
        ${p.returnDate ? `
          <div class="fact-card">
            <span class="fact-label">Return date</span>
            <span class="fact-value">${fmtDate(p.returnDate)}</span>
          </div>` : ""}
      </div>
    </div>`;
}

function renderPatients() {
  const container = document.getElementById("patient-list");
  const state     = loadState();
  const sorted    = getFilteredSorted();

  if (!sorted.length) {
    container.innerHTML = '<div class="no-patients">No patients match your search.</div>';
    renderStats();
    return;
  }

  container.innerHTML = sorted.map(p => {
    const prog       = getProgress(p.id, state);
    const ps         = state[p.id] || {};
    const isComplete = prog.done === prog.total;
    const n          = p.numCountries || countryCount(p.stops);

    const sourceClass = activePractice?.isStaff && p.sourceId ? ` patient-card-${p.sourceId}` : "";
    return `
<article class="patient-card${sourceClass}" data-patient-id="${p.id}">

  <div class="card-header-row">
    <button class="patient-summary" type="button" aria-expanded="false">
      <div>
        <h3 class="patient-name">${p.name}</h3>
        <div class="patient-meta">
          ${sourceChip(p)}
          <span class="chip chip-countries">${n} ${n === 1 ? "country" : "countries"}</span>
          <span class="dest-label">${destinationLabel(p.stops)}</span>
          ${departureChip(p)}
        </div>
      </div>
      <div>
        <div class="progress-pill ${prog.cls}">${prog.label}&nbsp;·&nbsp;${prog.done}/${prog.total}</div>
      </div>
    </button>
    <button class="archive-icon-btn" type="button" data-patient-id="${p.id}" title="Archive patient" aria-label="Archive ${p.name}">
      ${ARCHIVE_SVG}
    </button>
  </div>

  <div class="progress-track">
    <div class="progress-fill ${prog.cls}" style="width:${prog.pct}%"></div>
  </div>

  <div class="patient-details" id="details-${p.id}">

    <div class="archive-prompt${isComplete ? " visible" : ""}" id="prompt-${p.id}">
      <span class="archive-prompt-text">All steps complete — ready to archive this patient?</span>
      <div class="archive-prompt-actions">
        <button class="archive-prompt-confirm" type="button" data-patient-id="${p.id}">Archive</button>
        <button class="archive-prompt-dismiss" type="button" data-patient-id="${p.id}">Dismiss</button>
      </div>
    </div>

    ${renderItinerary(p)}

    <div class="checklist">
      ${CHECKLIST.map((task, i) => {
        const checked = isTaskChecked(p, i, state);
        return `
        <label class="checklist-item${checked ? " completed" : ""}">
          <input type="checkbox" data-patient-id="${p.id}" data-task-index="${i}" ${checked ? "checked" : ""} />
          <span class="checklist-item-text">
            ${renderChecklistTask(task, i, p)}
            ${(task.notes ?? (task.note ? [task.note] : [])).map(n => `<span class="checklist-note">⚠ ${n}</span>`).join("")}
          </span>
        </label>`;
      }).join("")}
    </div>

    <div class="checklist-footer">
      <button class="reset-btn" type="button" data-patient-id="${p.id}">Reset checklist</button>
      <button class="archive-btn" type="button" data-patient-id="${p.id}">Archive</button>
    </div>

  </div>

</article>`;
  }).join("");

  attachEvents();
  restoreExpanded();
  renderStats();
}

function restoreExpanded() {
  if (!expandedId) return;
  const card = document.querySelector(`[data-patient-id="${expandedId}"]`);
  if (!card) return;
  const btn     = card.querySelector(".patient-summary");
  const details = document.getElementById(`details-${expandedId}`);
  if (btn && details) {
    btn.setAttribute("aria-expanded", "true");
    details.classList.add("active");
    card.classList.add("is-open");
  }
}

// ═══════════════════════════════════════════════════════════════════
// TARGETED DOM UPDATE
// ═══════════════════════════════════════════════════════════════════

function updatePatientProgress(patientId, state) {
  const prog = getProgress(patientId, state);
  const card = document.querySelector(`[data-patient-id="${patientId}"]`);
  if (!card) return;

  const pill = card.querySelector(".progress-pill");
  if (pill) {
    pill.textContent = `${prog.label} · ${prog.done}/${prog.total}`;
    pill.className   = `progress-pill ${prog.cls}`;
  }

  const fill = card.querySelector(".progress-fill");
  if (fill) {
    fill.style.width = `${prog.pct}%`;
    fill.className   = `progress-fill ${prog.cls}`;
  }

  const prompt = document.getElementById(`prompt-${patientId}`);
  if (prompt) {
    prompt.classList.toggle("visible", prog.done === prog.total);
  }

  const approvalPill = card.querySelector('.approval-pill[data-task-index="4"]');
  const patient = patients.find(entry => entry.id === patientId);
  if (approvalPill && patient) {
    const approved = isTravelKitApproved(patient);
    approvalPill.textContent = approved ? "Approved" : "Not Approved";
    approvalPill.href = buildTravelKitUrl(patient);
    approvalPill.classList.toggle("approval-pill-approved", approved);
    approvalPill.classList.toggle("approval-pill-pending", !approved);
  }
}

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE ACTION
// ═══════════════════════════════════════════════════════════════════

function doArchive(patientId) {
  const archived = loadArchive();
  if (!archived.includes(patientId)) archived.push(patientId);
  saveArchive(archived);
  if (expandedId === patientId) expandedId = null;
  renderPatients();
  const drawer = document.getElementById("archive-drawer");
  if (drawer.dataset.open === "true") renderArchiveDrawer();
  renderStats();
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════

function attachEvents() {

  document.querySelectorAll(".patient-summary").forEach(btn => {
    btn.addEventListener("click", () => {
      const card      = btn.closest(".patient-card");
      const patientId = card.dataset.patientId;
      const details   = document.getElementById(`details-${patientId}`);
      const isOpen    = btn.getAttribute("aria-expanded") === "true";

      btn.setAttribute("aria-expanded", String(!isOpen));
      details.classList.toggle("active", !isOpen);
      card.classList.toggle("is-open", !isOpen);
      expandedId = !isOpen ? patientId : null;
    });
  });

  document.querySelectorAll(".checklist-item input[type='checkbox']").forEach(cb => {
    cb.addEventListener("change", () => {
      const patientId = cb.dataset.patientId;
      const taskIndex = Number(cb.dataset.taskIndex);
      const state     = loadState();

      if (!state[patientId]) state[patientId] = {};
      state[patientId][taskIndex] = cb.checked;
      saveState(state);

      cb.closest(".checklist-item").classList.toggle("completed", cb.checked);
      updatePatientProgress(patientId, state);
      renderStats();
    });
  });

  document.querySelectorAll(".checklist-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      window.open(link.href, "_blank", "noopener,noreferrer");
    });
  });

  document.querySelectorAll(".reset-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const patientId = btn.dataset.patientId;
      const state     = loadState();
      state[patientId] = {};
      saveState(state);

      const details = document.getElementById(`details-${patientId}`);
      if (details) {
        details.querySelectorAll(".checklist-item").forEach(item => {
          item.classList.remove("completed");
          item.querySelector("input").checked = false;
        });
      }

      updatePatientProgress(patientId, state);
      renderStats();
    });
  });

  document.querySelectorAll(".archive-icon-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      doArchive(btn.dataset.patientId);
    });
  });

  document.querySelectorAll(".archive-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      doArchive(btn.dataset.patientId);
    });
  });

  document.querySelectorAll(".archive-prompt-confirm").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      doArchive(btn.dataset.patientId);
    });
  });

  document.querySelectorAll(".archive-prompt-dismiss").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      btn.closest(".archive-prompt").classList.remove("visible");
    });
  });
}

function onSearch() {
  renderPatients();
}

window.addEventListener("focus", () => {
  if (activePractice) renderPatients();
});

// ═══════════════════════════════════════════════════════════════════
// PRACTICE PICKER
// ═══════════════════════════════════════════════════════════════════

function renderPracticePicker() {
  const sources = Object.values(window.__workflowDataSources || {});
  const cards   = document.getElementById("picker-cards");
  cards.innerHTML = sources.map(src => `
    <button class="picker-card" type="button" data-practice-id="${src.id}">
      ${src.displayName || src.label}
    </button>
  `).join("");

  cards.querySelectorAll(".picker-card").forEach(btn => {
    btn.addEventListener("click", () => selectPractice(btn.dataset.practiceId));
  });
}

function selectPractice(id) {
  activePractice       = window.__workflowDataSources[id];
  patients             = [];
  expandedId           = null;
  activePracticeFilter = "all";

  document.getElementById("practice-picker").style.display = "none";
  document.getElementById("app-shell").style.display = "";

  document.getElementById("practice-name").textContent = activePractice.displayName || activePractice.label;

  const sheetLink = document.getElementById("sheet-link");
  if (activePractice.responsesUrl) {
    sheetLink.href = activePractice.responsesUrl;
    sheetLink.style.display = "";
  } else {
    sheetLink.style.display = "none";
  }

  const filters = document.getElementById("practice-filters");
  if (activePractice.isStaff) {
    renderPracticeFilters();
    filters.style.display = "";
  } else {
    filters.style.display = "none";
    filters.innerHTML = "";
  }

  document.getElementById("archive-drawer").dataset.open = "false";
  document.getElementById("archive-drawer").innerHTML = "";
  document.getElementById("search").value = "";

  init();
}

function renderPracticeFilters() {
  const container = document.getElementById("practice-filters");
  const sources   = Object.values(window.__workflowDataSources || {}).filter(s => !s.isStaff);
  const buttons   = [
    `<button class="practice-filter is-active" type="button" data-practice-filter="all">All</button>`,
    ...sources.map(s => `<button class="practice-filter" type="button" data-practice-filter="${s.id}">${s.label}</button>`),
  ];
  container.innerHTML = buttons.join("");

  container.querySelectorAll(".practice-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      activePracticeFilter = btn.dataset.practiceFilter || "all";
      container.querySelectorAll(".practice-filter").forEach(b => {
        b.classList.toggle("is-active", b.dataset.practiceFilter === activePracticeFilter);
      });
      renderPatients();
    });
  });
}

function showPicker() {
  activePractice = null;
  patients       = [];
  expandedId     = null;
  document.getElementById("app-shell").style.display      = "none";
  document.getElementById("practice-picker").style.display = "";
}

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════

async function init() {
  document.getElementById("patient-list").innerHTML =
    '<div class="no-patients">Loading patients from form responses…</div>';
  document.getElementById("stats-bar").innerHTML = "";
  setSyncStatus("syncing", "Connecting…");

  try {
    patients = await activePractice.fetchPatients();

    // Merge locally-created (manual) patients
    const manualPatients = loadManualPatientsForActivePractice();
    patients = patients.concat(manualPatients);

    if (activePractice.isStaff) {
      const bySource = {};
      patients.forEach(p => {
        if (!p.sourceId) return;
        (bySource[p.sourceId] ||= []).push({ id: p.id, name: p.name, stops: p.stops || [] });
      });
      Object.entries(bySource).forEach(([sid, list]) => {
        localStorage.setItem(`${sid}-patients-v1`, JSON.stringify(list));
      });
    } else {
      localStorage.setItem(
        `${activePractice.id}-patients-v1`,
        JSON.stringify(patients.map(p => ({ id: p.id, name: p.name, stops: p.stops || [] })))
      );
    }
    renderPatients();

    if (patients.length) {
      setSyncStatus("ok", `${patients.length} response${patients.length === 1 ? "" : "s"} loaded`);
    } else {
      setSyncStatus("ok", "No responses yet");
      document.getElementById("patient-list").innerHTML =
        '<div class="no-patients">No form responses yet. Responses will appear here automatically once patients submit the form.</div>';
    }
    console.info(`Loaded ${patients.length} patient(s) for ${activePractice.label}.`);
  } catch (err) {
    setSyncStatus("error", "Could not load – check sheet access");
    document.getElementById("patient-list").innerHTML =
      '<div class="no-patients">Could not load form responses. Make sure the sheet is shared as "Anyone with the link can view."</div>';
    console.warn(`${activePractice.label} sheet unavailable:`, err.message);
  }
}

document.getElementById("switch-practice-btn").addEventListener("click", showPicker);

// Re-render when the cloud pushes a change from another device.
window.addEventListener("cloud-sync-change", async () => {
  if (!activePractice) return;
  // Merge fresh manual patients + latest checklist/archive state into the current view.
  const fetched = patients.filter(p => !p.isManual);
  const manualPatients = loadManualPatientsForActivePractice();
  patients = fetched.concat(manualPatients);
  renderPatients();
});

// ═══════════════════════════════════════════════════════════════════
// MANUAL PATIENTS (created via the "Create New Patient" modal)
// ═══════════════════════════════════════════════════════════════════

const MANUAL_STORAGE_PREFIX = "manual-patients-";

function manualStorageKey(practiceId) {
  return `${MANUAL_STORAGE_PREFIX}${practiceId}`;
}

function loadManualPatientsForPractice(practiceId) {
  try {
    const raw = localStorage.getItem(manualStorageKey(practiceId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map(p => decorateManualPatient(p, practiceId));
  } catch {
    return [];
  }
}

function decorateManualPatient(p, practiceId) {
  const source = window.__workflowDataSources?.[practiceId];
  return {
    ...p,
    isManual: true,
    sourceId: practiceId,
    practice: source?.label || practiceId,
  };
}

function loadManualPatientsForActivePractice() {
  if (!activePractice) return [];
  if (activePractice.isStaff) {
    const sources = Object.values(window.__workflowDataSources || {}).filter(s => !s.isStaff);
    return sources.flatMap(s => loadManualPatientsForPractice(s.id));
  }
  return loadManualPatientsForPractice(activePractice.id);
}

function saveManualPatientToPractice(practiceId, patient) {
  const key = manualStorageKey(practiceId);
  const list = (() => {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
  })();
  list.push(patient);
  localStorage.setItem(key, JSON.stringify(list));
  if (window.__cloud?.saveManualPatientToCloud) {
    window.__cloud.saveManualPatientToCloud(practiceId, patient);
  }
}

function generateManualPatientId(practiceId, name) {
  const slug = String(name || "patient").trim().replace(/\s+/g, "-").toLowerCase();
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${practiceId}-manual-${slug}-${stamp}-${rand}`;
}

// ═══════════════════════════════════════════════════════════════════
// CREATE PATIENT MODAL
// ═══════════════════════════════════════════════════════════════════

const cpModal          = document.getElementById("create-patient-modal");
const cpBackdrop       = document.getElementById("cp-modal-backdrop");
const cpCloseBtn       = document.getElementById("cp-modal-close");
const cpCancelBtn      = document.getElementById("cp-cancel");
const cpForm           = document.getElementById("cp-form");
const cpNameInput      = document.getElementById("cp-name");
const cpPhysicianField = document.getElementById("cp-physician-field");
const cpPhysicianSelect= document.getElementById("cp-physician");
const cpLocationsWrap  = document.getElementById("cp-locations");
const cpAddLocationBtn = document.getElementById("cp-add-location");
const cpNotesInput     = document.getElementById("cp-notes");
const cpOpenBtn        = document.getElementById("create-patient-btn");

function openCreatePatientModal() {
  if (!activePractice) return;

  // Reset form
  cpForm.reset();
  cpLocationsWrap.innerHTML = "";
  addLocationRow();

  // Physician dropdown: populate with non-staff practices
  const sources = Object.values(window.__workflowDataSources || {}).filter(s => !s.isStaff);
  cpPhysicianSelect.innerHTML =
    `<option value="">Select physician…</option>` +
    sources.map(s => `<option value="${s.id}">${s.displayName || s.label}</option>`).join("");

  if (activePractice.isStaff) {
    cpPhysicianField.style.display = "";
    cpPhysicianSelect.disabled = false;
    cpPhysicianSelect.required = true;
    cpPhysicianSelect.value = "";
  } else {
    // Individual practice — hide the picker but still assign
    cpPhysicianField.style.display = "none";
    cpPhysicianSelect.value = activePractice.id;
    cpPhysicianSelect.disabled = true;
    cpPhysicianSelect.required = false;
  }

  cpModal.style.display = "flex";
  setTimeout(() => cpNameInput.focus(), 20);
}

function closeCreatePatientModal() {
  cpModal.style.display = "none";
}

function addLocationRow() {
  const idx = cpLocationsWrap.children.length;
  const row = document.createElement("div");
  row.className = "cp-location";
  row.innerHTML = `
    <div class="cp-field">
      <label>Country <span class="cp-req">*</span></label>
      <input type="text" name="country" required autocomplete="off" />
    </div>
    <div class="cp-field">
      <label>City / Region</label>
      <input type="text" name="city" autocomplete="off" />
    </div>
    <div class="cp-field">
      <label>Arrival <span class="cp-req">*</span></label>
      <input type="date" name="arrival" required />
    </div>
    <div class="cp-field">
      <label>Departure</label>
      <input type="date" name="departure" />
    </div>
    ${idx > 0 ? `<button type="button" class="cp-location-remove" aria-label="Remove location">×</button>` : ""}
  `;
  cpLocationsWrap.appendChild(row);
  const removeBtn = row.querySelector(".cp-location-remove");
  if (removeBtn) removeBtn.addEventListener("click", () => row.remove());
}

function collectLocationsFromForm() {
  const rows = cpLocationsWrap.querySelectorAll(".cp-location");
  const stops = [];
  for (const row of rows) {
    const country   = row.querySelector('[name="country"]').value.trim();
    const city      = row.querySelector('[name="city"]').value.trim();
    const arrival   = row.querySelector('[name="arrival"]').value;
    const departure = row.querySelector('[name="departure"]').value;
    if (!country || !arrival) return null;
    stops.push({ country, city, arrival, departure: departure || arrival });
  }
  return stops.length ? stops : null;
}

async function submitCreatePatientForm(event) {
  event.preventDefault();

  const name = cpNameInput.value.trim();
  if (!name) { cpNameInput.focus(); return; }

  const practiceId = activePractice.isStaff ? cpPhysicianSelect.value : activePractice.id;
  if (!practiceId) { cpPhysicianSelect.focus(); return; }

  const stops = collectLocationsFromForm();
  if (!stops) {
    alert("Please fill in every location's country and arrival date.");
    return;
  }

  const notes = cpNotesInput.value.trim();
  const lastDeparture = stops.at(-1)?.departure || stops.at(-1)?.arrival || "";
  const today = new Date().toISOString().slice(0, 10);

  const patient = {
    id: generateManualPatientId(practiceId, name),
    name,
    purpose: "",
    returnDate: lastDeparture,
    submitted: today,
    stops,
    numCountries: new Set(stops.map(s => s.country)).size,
    concerns: notes,
    travelSelections: [],
    isManual: true,
  };

  saveManualPatientToPractice(practiceId, patient);

  // Add to in-memory list (with decoration for staff mode)
  const decorated = decorateManualPatient(patient, practiceId);
  patients.push(decorated);

  // Keep the localStorage-lite record used elsewhere in the app up to date
  const roster = JSON.parse(localStorage.getItem(`${practiceId}-patients-v1`) || "[]");
  roster.push({ id: patient.id, name: patient.name, stops: patient.stops });
  localStorage.setItem(`${practiceId}-patients-v1`, JSON.stringify(roster));

  expandedId = patient.id;
  closeCreatePatientModal();
  renderPatients();
}

cpOpenBtn.addEventListener("click", openCreatePatientModal);
cpCloseBtn.addEventListener("click", closeCreatePatientModal);
cpCancelBtn.addEventListener("click", closeCreatePatientModal);
cpBackdrop.addEventListener("click", closeCreatePatientModal);
cpAddLocationBtn.addEventListener("click", addLocationRow);
cpForm.addEventListener("submit", submitCreatePatientForm);

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && cpModal.style.display === "flex") closeCreatePatientModal();
});

renderPracticePicker();
