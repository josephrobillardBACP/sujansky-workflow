(function () {
  const PRACTICE_ID = "staff";

  async function fetchPatients() {
    const sources = Object.values(window.__workflowDataSources || {})
      .filter(s => !s.isStaff);

    const results = await Promise.allSettled(sources.map(s => s.fetchPatients()));
    const all = [];

    results.forEach((result, i) => {
      const source = sources[i];
      if (result.status === "fulfilled") {
        all.push(...result.value.map(patient => ({
          ...patient,
          sourceId: source.id,
          practice: source.label,
        })));
      } else {
        console.warn(`${source.label} feed failed:`, result.reason?.message || result.reason);
      }
    });

    return all;
  }

  window.__workflowDataSources = window.__workflowDataSources || {};
  window.__workflowDataSources[PRACTICE_ID] = {
    id: PRACTICE_ID,
    label: "Staff",
    displayName: "Staff Workflow",
    isStaff: true,
    fetchPatients,
  };
})();
