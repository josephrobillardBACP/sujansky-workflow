(function () {
  const PRACTICE_ID = "daniher";
  const PRACTICE_LABEL = "Daniher";
  const SHEET_ID = "1og96N5wkXKgoJu-28UaNm4r-uMaVYi3vTEGmXdiH2bM";
  const SHEET_GID = "360167185";
  const CONCERNS_COL = 63;
  const TRAVEL_FLAGS_COL = 64;

  function parseDateValue(v) {
    if (!v && v !== 0) return "";
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
    const s = String(v).trim();
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
    const d = new Date(typeof v === "number" ? v : s);
    return isNaN(d) ? "" : d.toISOString().slice(0, 10);
  }

  function formatName(raw) {
    if (!raw) return "Unknown patient";
    const parts = String(raw).split(",").map(p => p.trim());
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : String(raw).trim();
  }

  function normalizeCountryCount(rawValue) {
    const raw = String(rawValue ?? "").trim().toLowerCase();
    const numeric = Number(rawValue);
    if (numeric >= 1 && numeric <= 9) return numeric;
    if (raw.includes("more than 4") || raw.includes("5")) return 5;
    return 0;
  }

  function parseTravelSelections(rawValue) {
    return String(rawValue ?? "")
      .split(/,\s+(?=Will you\b|Other\b)/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  function parseSheetRows(table) {
    const layouts = [
      {
        count: 5,
        stops: [
          { country: 44, arrival: 45, departure: 46, city: [47] },
          { country: 48, arrival: 49, departure: 50, city: [51] },
          { country: 52, arrival: 53, departure: 54, city: [55] },
          { country: 56, arrival: 57, departure: 58, city: [59] },
        ],
        overflowCountry: 60,
        overflowDates: 61,
        overflowCity: 62,
        returnDate: 58,
        matches: str => [44, 48, 52, 56, 60].some(idx => str(idx)),
      },
      {
        count: 4,
        stops: [
          { country: 28, arrival: 29, departure: 30, city: [31] },
          { country: 32, arrival: 33, departure: 34, city: [35] },
          { country: 36, arrival: 37, departure: 38, city: [39] },
          { country: 40, arrival: 41, departure: 42, city: [43] },
        ],
        returnDate: 42,
        matches: str => [28, 32, 36, 40].some(idx => str(idx)),
      },
      {
        count: 3,
        stops: [
          { country: 16, arrival: 17, departure: 18, city: [19] },
          { country: 20, arrival: 21, departure: 22, city: [23] },
          { country: 24, arrival: 25, departure: 26, city: [27] },
        ],
        returnDate: 26,
        matches: str => [16, 20, 24].some(idx => str(idx)),
      },
      {
        count: 2,
        stops: [
          { country: 8, arrival: 9, departure: 10, city: [11] },
          { country: 12, arrival: 13, departure: 14, city: [15] },
        ],
        returnDate: 14,
        matches: str => [8, 12].some(idx => str(idx)),
      },
      {
        count: 1,
        stops: [
          { country: 4, arrival: 5, departure: 6, city: [7] },
        ],
        returnDate: 6,
        matches: str => [4, 5, 6, 7].some(idx => str(idx)),
      },
    ];

    return (table.rows || []).map((row, i) => {
      const cells = row.c || [];
      const get = idx => cells[idx]?.v ?? null;
      const pd = idx => parseDateValue(cells[idx]?.f ?? null) || parseDateValue(get(idx));
      const str = idx => String(get(idx) ?? "").trim();
      const pick = (...indices) => indices.map(str).find(Boolean) || "";

      const submitted = pd(0);
      const name = formatName(get(1));
      const purpose = str(3);
      const concerns = str(CONCERNS_COL);
      const travelSelections = parseTravelSelections(str(TRAVEL_FLAGS_COL));

      const explicitCount = normalizeCountryCount(get(2));
      const inferredLayout = layouts.find(layout => layout.matches(str)) || layouts.at(-1);
      const layout = layouts.find(candidate => candidate.count === explicitCount) || inferredLayout;
      let stops = layout.stops.map(stop => ({
        country: str(stop.country),
        city: pick(...stop.city),
        arrival: pd(stop.arrival),
        departure: pd(stop.departure),
      }));
      let returnDate = pd(layout.returnDate);

      if (layout.overflowCountry !== undefined) {
        const overflowCountry = str(layout.overflowCountry);
        if (overflowCountry) {
          const overflowDates = str(layout.overflowDates);
          const overflowCity = str(layout.overflowCity);
          const dateTokens = overflowDates.match(/\d{1,2}\/\d{1,2}(?:\/\d{4})?/g) || [];
          const ctxYear = (() => {
            const last = stops.filter(s => s.departure).at(-1);
            if (last?.departure) return new Date(last.departure + "T00:00:00").getFullYear();
            return new Date().getFullYear();
          })();
          const toISO = d => parseDateValue(d.split("/").length === 2 ? `${d}/${ctxYear}` : d);
          const overflowArrival = dateTokens.length ? toISO(dateTokens[0]) : "";
          const overflowDeparture = dateTokens.length ? toISO(dateTokens[dateTokens.length - 1]) : "";
          if (overflowDeparture) returnDate = overflowDeparture;
          stops.push({
            country: overflowCountry,
            city: overflowCity,
            arrival: overflowArrival,
            departure: overflowDeparture,
          });
        }
      }

      stops = stops.filter(s => s.country || s.city);
      if (!stops.length) stops = [{ country: "Unknown", city: "", arrival: "", departure: "" }];

      return {
        id: `${PRACTICE_ID}-sheet-${name.replace(/\s+/g, "-").toLowerCase()}-${i}`,
        name,
        purpose,
        returnDate,
        submitted,
        stops,
        numCountries: stops.length,
        concerns,
        travelSelections,
      };
    });
  }

  function fetchPatients() {
    return new Promise((resolve, reject) => {
      const callbackName = `__workflow_${PRACTICE_ID}_${Date.now()}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${PRACTICE_LABEL} request timed out`));
      }, 10000);

      function cleanup() {
        clearTimeout(timer);
        delete window[callbackName];
        script.remove();
      }

      window[callbackName] = function(data) {
        cleanup();
        if (!data?.table) {
          reject(new Error(`${PRACTICE_LABEL} returned an unexpected response`));
          return;
        }
        resolve(parseSheetRows(data.table));
      };

      script.onerror = () => {
        cleanup();
        reject(new Error(`Could not load ${PRACTICE_LABEL} workflow data`));
      };
      script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&gid=${SHEET_GID}`;
      document.head.appendChild(script);
    });
  }

  window.__workflowDataSources = window.__workflowDataSources || {};
  window.__workflowDataSources[PRACTICE_ID] = {
    id: PRACTICE_ID,
    label: PRACTICE_LABEL,
    displayName: "Amy Daniher, MD",
    logo: "daniher-logo.png",
    dashboardUrl: "https://josephrobillardBACP.github.io/sujansky-workflow/",
    responsesUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`,
    fetchPatients,
  };
})();
