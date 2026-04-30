import { useEffect, useMemo, useRef, useState, memo } from "react";
import Papa from "papaparse";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Legend,
  Tooltip as ChartTooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import ChartDataLabels from "chartjs-plugin-datalabels";
import {
  getSchemaClassificationForRow,
  parseSchemaToken,
  parseJsonLike,
} from "../utils/schemaClassification.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Legend, ChartTooltip, ChartDataLabels);

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTION_ORDER = [
  "US", "CA", "CO", "CT", "VA", "UT", "IA", "OR", "MT", "NH", "NJ", "TN", "TX", "DE",
];

const SECTION_KEY_TO_ABBREV = {
  usnatv1: "US", uscav1: "CA", uscov1: "CO", usctv1: "CT",
  usvav1: "VA", usutv1: "UT", usiatv1: "IA", usorv1: "OR",
  usmtv1: "MT", usnhv1: "NH", usnjv1: "NJ", ustnv1: "TN",
  ustxv1: "TX", usdel1: "DE",
};

const STATUS_RENDER_ORDER = [
  "not_applicable",
  "did_not_opt_out",
  "opted_out",
  "invalid_missing",
];

const STATUS_PRIORITY = {
  opted_out: 0,
  did_not_opt_out: 1,
  not_applicable: 2,
  invalid_missing: 3,
};

const STATUS_BASE_COLORS = {
  opted_out: "#10b981",       // Emerald 500
  did_not_opt_out: "#3b82f6",  // Blue 500
  not_applicable: "#94a3b8",   // Slate 400
  invalid_missing: "#f59e0b",  // Amber 500
};

const STATUS_LABELS = {
  opted_out: "Opted Out",
  did_not_opt_out: "Did Not Opt Out",
  not_applicable: "Not Applicable",
  invalid_missing: "Invalid / Missing",
};

const GPP_FIELDS = ["SaleOptOut", "SharingOptOut", "TargetedAdvertisingOptOut"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionShade(hex, idx, total) {
  if (total <= 1 || idx === 0) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const blend = Math.min(idx * 0.28, 0.72);
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.round(c + (255 - c) * blend).toString(16).padStart(2, "0"))
      .join("")
  );
}

function isAdded(row) {
  if (String(row["status"] ?? "").trim() === "not added") return false;
  const error = String(row["error"] ?? "").trim();
  return error === "" || error === "null" || error === "None" || error === "none" || error === "singleTimeoutError";
}

function isSubjectOrLikely(row) {
  const absent = new Set(["", "null", "None", "none"]);
  const thirdParty = parseInt(
    row["third_party_count"] ?? row["Third_party_count"] ?? "0",
    10
  );
  if (isNaN(thirdParty) || thirdParty === 0) return false;
  const privacyCols = [
    "uspapi_before_gpc", "uspapi_after_gpc",
    "usp_cookies_before_gpc", "usp_cookies_after_gpc",
    "OptanonConsent_before_gpc", "OptanonConsent_after_gpc",
    "gpp_before_gpc", "gpp_after_gpc",
  ];
  if (privacyCols.some((col) => row[col] && !absent.has(String(row[col])))) return true;
  return String(row["Well-known"] ?? "").includes("'gpc'");
}

function sortedAbbrevs(abbrevSet) {
  return [...abbrevSet].sort(
    (a, b) =>
      (SECTION_ORDER.indexOf(a) + 1 || 999) -
      (SECTION_ORDER.indexOf(b) + 1 || 999)
  );
}

function bestStatus(pairs) {
  return pairs.reduce(
    (best, [, s]) =>
      (STATUS_PRIORITY[s] ?? 99) < (STATUS_PRIORITY[best] ?? 99) ? s : best,
    pairs[0][1]
  );
}

// Extract GPP section pairs for a row's before column
function beforePairsForRow(row, field) {
  const raw = row["decoded_gpp_before_gpc"];
  if (!raw || ["null", "", "None", "none"].includes(String(raw).trim())) return [];
  const gppDict = parseJsonLike(String(raw));
  if (!gppDict || typeof gppDict !== "object" || Array.isArray(gppDict)) return [];
  const pairs = [];
  for (const [sectionKey, abbrev] of Object.entries(SECTION_KEY_TO_ABBREV)) {
    const sec = gppDict[sectionKey];
    if (!sec || typeof sec !== "object") continue;
    const val = parseFloat(sec[field]);
    if (isNaN(val)) continue;
    let status;
    if (val === 1.0) status = "opted_out";
    else if (val === 2.0) status = "did_not_opt_out";
    else if (val === 0.0) status = "not_applicable";
    else continue;
    pairs.push([abbrev, status]);
  }
  return pairs;
}

// Extract GPP section pairs for a row's after column (compliance_classification)
function afterPairsForRow(row, field) {
  const schemaResult = getSchemaClassificationForRow(row);
  if (!schemaResult || schemaResult.parseError) return [];
  const pairs = [];
  for (const token of schemaResult.tokens ?? []) {
    const parsed = parseSchemaToken(token);
    if (parsed?.family === "gpp" && parsed?.field === field) {
      pairs.push([parsed.state, parsed.status]);
    }
  }
  return pairs;
}

// ── Aggregated computation (no section split) ─────────────────────────────────
// Each site counted once — best status across all its sections.

function computeAggregated(rows, field, applyFilter) {
  const added = rows.filter(isAdded);
  const source = applyFilter ? added.filter(isSubjectOrLikely) : added;
  const beforeCounts = {};
  const afterCounts = {};

  for (const row of source) {
    const bp = beforePairsForRow(row, field);
    if (bp.length > 0) {
      const best = bestStatus(bp);
      beforeCounts[best] = (beforeCounts[best] || 0) + 1;
    }

    const ap = afterPairsForRow(row, field);
    if (ap.length > 0) {
      const best = bestStatus(ap);
      afterCounts[best] = (afterCounts[best] || 0) + 1;
    }
  }

  return { beforeCounts, afterCounts };
}

// ── Section-split computation ─────────────────────────────────────────────────
// Sites with multiple sections get a "US & CO" combo bucket.

function computeBySection(rows, field, applyFilter) {
  const added = rows.filter(isAdded);
  const source = applyFilter ? added.filter(isSubjectOrLikely) : added;
  const beforeByCombo = {};
  const afterByCombo = {};

  for (const row of source) {
    const bp = beforePairsForRow(row, field);
    if (bp.length > 0) {
      const combo = sortedAbbrevs(new Set(bp.map(([a]) => a))).join(" & ");
      const best = bestStatus(bp);
      if (!beforeByCombo[combo]) beforeByCombo[combo] = {};
      beforeByCombo[combo][best] = (beforeByCombo[combo][best] || 0) + 1;
    }

    const ap = afterPairsForRow(row, field);
    if (ap.length > 0) {
      const combo = sortedAbbrevs(new Set(ap.map(([a]) => a))).join(" & ");
      const best = bestStatus(ap);
      if (!afterByCombo[combo]) afterByCombo[combo] = {};
      afterByCombo[combo][best] = (afterByCombo[combo][best] || 0) + 1;
    }
  }

  return { beforeByCombo, afterByCombo };
}

// ── Chart dataset builders ────────────────────────────────────────────────────

function buildAggregatedChartData(beforeCounts, afterCounts, showInvalid) {
  const order = showInvalid
    ? STATUS_RENDER_ORDER
    : STATUS_RENDER_ORDER.filter((s) => s !== "invalid_missing");

  const datasets = order.flatMap((status) => {
    const bv = beforeCounts[status] ?? 0;
    const av = afterCounts[status] ?? 0;
    if (bv === 0 && av === 0) return [];
    return [{
      label: STATUS_LABELS[status],
      data: [bv, av],
      backgroundColor: STATUS_BASE_COLORS[status],
      borderColor: STATUS_BASE_COLORS[status],
      borderWidth: 0,
    }];
  });
  return { labels: ["Before GPC", "After GPC"], datasets };
}

function buildSectionChartData(beforeByCombo, afterByCombo, showInvalid) {
  const allCombos = new Set([
    ...Object.keys(beforeByCombo),
    ...Object.keys(afterByCombo),
  ]);
  const singles = SECTION_ORDER.filter((s) => allCombos.has(s));
  const multis = [...allCombos].filter((c) => c.includes(" & ")).sort();
  const orderedCombos = [...singles, ...multis];

  const order = showInvalid
    ? STATUS_RENDER_ORDER
    : STATUS_RENDER_ORDER.filter((s) => s !== "invalid_missing");

  const datasets = [];
  for (const status of order) {
    orderedCombos.forEach((combo, idx) => {
      const bv = beforeByCombo[combo]?.[status] ?? 0;
      const av = afterByCombo[combo]?.[status] ?? 0;
      if (bv === 0 && av === 0) return;
      const isMulti = combo.includes(" & ");
      const color = sectionShade(STATUS_BASE_COLORS[status], idx, orderedCombos.length);
      datasets.push({
        label: `${combo} — ${STATUS_LABELS[status]}`,
        data: [bv, av],
        backgroundColor: color,
        borderColor: isMulti ? "rgba(0,0,0,0.35)" : color,
        borderWidth: isMulti ? 1 : 0,
      });
    });
  }
  return { labels: ["Before GPC", "After GPC"], datasets };
}

// ── Component ─────────────────────────────────────────────────────────────────

const GppSectionBreakdownChart = memo(function GppSectionBreakdownChart({ timePeriods, stateMonths }) {
  const availableStates = Object.keys(stateMonths);

  const [selectedState, setSelectedState] = useState(availableStates[0] ?? "CA");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [selectedField, setSelectedField] = useState("TargetedAdvertisingOptOut");
  const [showInvalid, setShowInvalid] = useState(false);
  const [showDataLabels, setShowDataLabels] = useState(false);
  const applyFilter = true;
  const [splitBySections, setSplitBySections] = useState(false);
  const [rows, setRows] = useState([]);
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Default to most recent available period for the selected state
  useEffect(() => {
    const periods = stateMonths[selectedState] ?? [];
    if (periods.length > 0 && !periods.includes(selectedPeriod)) {
      setSelectedPeriod(periods[periods.length - 1]);
    }
  }, [selectedState, stateMonths]);

  // Load the "all data" CSV for selected state + period
  useEffect(() => {
    if (!selectedState || !selectedPeriod) return;
    setLoading(true);
    setLoadError("");
    const path = `/${selectedState}/Crawl_Data_${selectedState} - ${selectedPeriod}.csv`;
    Papa.parse(path, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        setRows(
          data.map((row) => {
            const out = {};
            Object.keys(row ?? {}).forEach((k) => { out[String(k).trim()] = row[k]; });
            return out;
          })
        );
        setLoading(false);
      },
      error: (err) => {
        setLoadError(`Failed to load data: ${err.message}`);
        setLoading(false);
      },
    });
  }, [selectedState, selectedPeriod]);

  // Aggregated (no section split)
  const { beforeCounts, afterCounts } = useMemo(
    () =>
      !splitBySections && rows.length > 0
        ? computeAggregated(rows, selectedField, applyFilter)
        : { beforeCounts: {}, afterCounts: {} },
    [rows, selectedField, applyFilter, splitBySections]
  );

  // Section-split
  const { beforeByCombo, afterByCombo } = useMemo(
    () =>
      splitBySections && rows.length > 0
        ? computeBySection(rows, selectedField, applyFilter)
        : { beforeByCombo: {}, afterByCombo: {} },
    [rows, selectedField, applyFilter, splitBySections]
  );

  // Reset isolation when important filters change
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current._isolatedIndices = null;
    }
  }, [selectedField, selectedPeriod, selectedState, splitBySections, showInvalid]);

  const chartData = useMemo(() => {
    const data = splitBySections
      ? buildSectionChartData(beforeByCombo, afterByCombo, showInvalid)
      : buildAggregatedChartData(beforeCounts, afterCounts, showInvalid);

    // Pre-calculate visibility indices to avoid complex loops during chart animation/hover
    const visibilityMap = [{}, {}]; // for index 0 (Before) and 1 (After)
    data.datasets.forEach((ds, dsIdx) => {
      [0, 1].forEach((dataIdx) => {
        if (ds.data[dataIdx] > 0) {
          if (visibilityMap[dataIdx].first === undefined) visibilityMap[dataIdx].first = dsIdx;
          visibilityMap[dataIdx].last = dsIdx;
        }
      });
    });

    data.datasets.forEach((ds, dsIdx) => {
      ds.borderRadius = (ctx) => {
        const { dataIndex, datasetIndex } = ctx;
        const { first, last } = visibilityMap[dataIndex];
        if (first === undefined) return 0;
        if (datasetIndex === first && datasetIndex === last) return 8;
        if (datasetIndex === first) return { topLeft: 8, bottomLeft: 8 };
        if (datasetIndex === last) return { topRight: 8, bottomRight: 8 };
        return 0;
      };
      ds.borderSkipped = false;
    });

    return data;
  }, [splitBySections, beforeCounts, afterCounts, beforeByCombo, afterByCombo, showInvalid]);

  // n = after GPC unique sites, excluding invalid_missing
  const nAfter = useMemo(() => {
    const counts = splitBySections ? afterByCombo : { "all": afterCounts };
    const seenSites = new Set();
    
    const added = rows.filter(isAdded);
    const source = applyFilter ? added.filter(isSubjectOrLikely) : added;
    let count = 0;
    for (const row of source) {
      const ap = afterPairsForRow(row, selectedField);
      if (ap.length > 0) {
        const best = bestStatus(ap);
        if (best !== "invalid_missing") {
          count++;
        }
      }
    }
    return count;
  }, [rows, selectedField, applyFilter, splitBySections, afterByCombo, afterCounts]);

  function handleDownload() {
    const chart = chartRef.current;
    if (!chart) return;

    // Save current state
    const originalDatasets = chart.data.datasets;
    const originalLegendFilter = chart.options.plugins.legend.labels.filter;

    // Filter hidden for export
    chart.options.plugins.legend.labels.filter = (item) => !originalDatasets[item.datasetIndex].hidden;
    chart.data.datasets = originalDatasets.filter(ds => !ds.hidden);
    
    chart.update("none");

    const canvas = chart.canvas;
    const newCanvas = document.createElement("canvas");
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height;
    const ctx = newCanvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    const url = newCanvas.toDataURL("image/png", 1);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedField}_${selectedState}_${selectedPeriod}${
      splitBySections ? "_by_section" : ""
    }.png`;
    a.click();

    // Restore
    chart.data.datasets = originalDatasets;
    chart.options.plugins.legend.labels.filter = originalLegendFilter;
    chart.update("none");
  }

  const availablePeriods = stateMonths[selectedState] ?? [];
  const periodLabel = timePeriods.find((p) => p.key === selectedPeriod)?.label ?? selectedPeriod;

  // Multi-section combos (only relevant when split mode is on)
  const multiCombos = splitBySections
    ? [...new Set([...Object.keys(beforeByCombo), ...Object.keys(afterByCombo)])].filter(
        (c) => c.includes(" & ")
      )
    : [];

  const titleLine2 = `${periodLabel}  (n = ${nAfter.toLocaleString()})${
    splitBySections ? " — split by section" : ""
  }`;

  const chartOptions = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    normalized: true, // Performance boost
    layout: {
      padding: {
        top: 10,
        bottom: 10,
        left: 10,
        right: 20,
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: {
          display: false,
          drawBorder: false,
        },
        border: {
          display: false,
        },
        ticks: {
          font: { size: 11, family: "'Segoe UI', sans-serif" },
          color: "#64748b",
        },
        title: {
          display: true,
          text: "Number of Sites",
          font: { size: 12, weight: "600", family: "'Segoe UI', sans-serif" },
          color: "#475569",
          padding: { top: 10 },
        },
      },
      y: {
        stacked: true,
        grid: {
          display: false,
          drawBorder: false,
        },
        border: {
          display: false,
        },
        ticks: {
          font: { size: 13, weight: "600", family: "'Segoe UI', sans-serif" },
          color: "#1e293b",
        },
      },
    },
    plugins: {
      datalabels: {
        display: showDataLabels,
        color: "#fff",
        font: { weight: "bold", size: 11 },
        formatter: (val) => (val > 0 ? val.toLocaleString() : ""),
        anchor: "center",
        align: "center",
      },
      legend: {
        position: "top",
        align: "end",
        onClick: (e, legendItem, legend) => {
          const index = legendItem.datasetIndex;
          const chart = legend.chart;
          const total = chart.data.datasets.length;
          
          if (!chart._isolatedIndices) chart._isolatedIndices = new Set();
          const isolated = chart._isolatedIndices;

          if (isolated.size === 0 || isolated.size === total) {
            isolated.clear();
            isolated.add(index);
            chart.data.datasets.forEach((ds, i) => {
              ds.hidden = i !== index;
            });
          } else {
            if (isolated.has(index)) {
              isolated.delete(index);
              chart.data.datasets[index].hidden = true;
              if (isolated.size === 0) {
                chart.data.datasets.forEach((ds) => {
                  ds.hidden = false;
                });
              }
            } else {
              isolated.add(index);
              chart.data.datasets[index].hidden = false;
              if (isolated.size === total) {
                isolated.clear();
                chart.data.datasets.forEach((ds) => {
                  ds.hidden = false;
                });
              }
            }
          }
          chart.update();
        },
        onHover: (evt, item, legend) => {
          const chart = legend.chart;
          const index = item.datasetIndex;
          chart.data.datasets.forEach((ds, i) => {
            if (i === index) {
              ds.borderWidth = 2;
              ds.borderColor = "rgba(0,0,0,0.8)";
            } else {
              ds.borderWidth = 0;
              // Add transparency to the fill color
              if (!ds._origBackground) ds._origBackground = ds.backgroundColor;
              ds.backgroundColor = ds._origBackground + "20"; 
            }
          });
          chart.update("none");
        },
        onLeave: (evt, item, legend) => {
          const chart = legend.chart;
          chart.data.datasets.forEach((ds) => {
            ds.borderWidth = 0;
            if (ds._origBackground) ds.backgroundColor = ds._origBackground;
            ds.borderColor = ds.backgroundColor;
          });
          chart.update("none");
        },
        labels: {
          boxWidth: 12,
          boxHeight: 12,
          usePointStyle: true,
          pointStyle: "circle",
          padding: 20,
          font: { size: 12, family: "'Segoe UI', sans-serif", weight: "500" },
          color: "#475569",
        },
      },
      title: {
        display: true,
        text: [`${selectedField} — Before/After GPC`, titleLine2],
        font: { size: 15, weight: "700", family: "'Segoe UI', sans-serif" },
        color: "#1e293b",
        padding: { bottom: 20 },
        textAlign: "left",
      },
      tooltip: {
        mode: "index",
        backgroundColor: "rgba(15, 23, 42, 0.9)", // Slate 900
        padding: 12,
        titleFont: { size: 14, weight: "700", family: "'Segoe UI', sans-serif" },
        bodyFont: { size: 13, family: "'Segoe UI', sans-serif" },
        cornerRadius: 8,
        usePointStyle: true,
        callbacks: {
          label: (ctx) =>
            ctx.parsed.x > 0
              ? `${ctx.dataset.label}: ${ctx.parsed.x.toLocaleString()}`
              : null,
          filter: (item) => item.parsed.x > 0,
        },
      },
    },
    barPercentage: 0.85,
    categoryPercentage: 0.8,
  };

  const hasData = chartData.datasets.length > 0;

  return (
    <div className="card card--padded section">
      <h2>GPP Compliance Before and After GPC</h2>

      <div className="toolbar" role="group" aria-label="GPP breakdown chart filters">
        <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingRight: "12px", borderRight: "1px solid #e2e8f0" }}>
          <label htmlFor="gs-state" style={{ fontSize: "13px", fontWeight: "600", color: "#475569" }}>State:</label>
          <select id="gs-state" value={selectedState} onChange={(e) => setSelectedState(e.target.value)} style={{ padding: "4px 8px" }}>
            {availableStates.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <label htmlFor="gs-period" style={{ fontSize: "13px", fontWeight: "600", color: "#475569", marginLeft: "4px" }}>Period:</label>
          <select id="gs-period" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)} style={{ padding: "4px 8px" }}>
            {availablePeriods.map((p) => (
              <option key={p} value={p}>
                {timePeriods.find((t) => t.key === p)?.label ?? p}
              </option>
            ))}
          </select>

          <label htmlFor="gs-field" style={{ fontSize: "13px", fontWeight: "600", color: "#475569", marginLeft: "4px" }}>Field:</label>
          <select id="gs-field" value={selectedField} onChange={(e) => setSelectedField(e.target.value)} style={{ padding: "4px 8px" }}>
            {GPP_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px", paddingLeft: "4px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", color: "#475569", cursor: "pointer" }}>
            <input type="checkbox" checked={splitBySections} onChange={(e) => setSplitBySections(e.target.checked)} />
            Split by GPP type
          </label>
        </div>
      </div>

      {loading && <p>Loading…</p>}
      {loadError && <p style={{ color: "red" }}>{loadError}</p>}

      {!loading && !loadError && !hasData && (
        <p className="muted-text">
          No GPP data found for <strong>{selectedField}</strong> in {selectedState} {periodLabel}.
        </p>
      )}

      {!loading && !loadError && hasData && (
        <>
          {splitBySections && (
            <p className="muted-text" style={{ marginTop: "0.5rem", marginBottom: "0.25rem" }}>
              Sites with multiple GPP string sections are grouped as combined segments (e.g. <em>US &amp; CO</em>).
              {" "}{applyFilter && "Subject filter applied."}
            </p>
          )}

          {splitBySections && multiCombos.length > 0 && (
            <p className="muted-text" style={{ marginBottom: "0.25rem" }}>
              Multi-section detail:{" "}
              {multiCombos.map((c) => {
                const bData = beforeByCombo[c] ?? {};
                const aData = afterByCombo[c] ?? {};

                const formatEntry = (data, timing) => {
                  return Object.entries(data)
                    .filter(([, count]) => count > 0)
                    .map(([status, count]) => (
                      <span key={`${timing}-${status}`}>
                        {count} site{count === 1 ? "" : "s"} found matching "<em>{c}</em>" ({STATUS_LABELS[status]}) {timing} GPC
                      </span>
                    ));
                };

                const results = [...formatEntry(bData, "before"), ...formatEntry(aData, "after")];
                
                return results.length > 0 ? (
                  <span key={c}>
                    {results.reduce((prev, curr) => [prev, ", ", curr])}.{" "}
                  </span>
                ) : null;
              })}
            </p>
          )}

          <div style={{ height: 260, marginTop: "0.75rem" }}>
            <Bar ref={chartRef} data={chartData} options={chartOptions} />
          </div>
          <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "14px", color: "#475569", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showInvalid}
                onChange={(e) => setShowInvalid(e.target.checked)}
              />
              Show invalid
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "14px", color: "#475569", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showDataLabels}
                onChange={(e) => setShowDataLabels(e.target.checked)}
              />
              Show data labels
            </label>
            <button className="btn-download" onClick={handleDownload}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
              </svg>
              Download PNG
            </button>
          </div>
        </>
      )}
    </div>
  );
});

export default GppSectionBreakdownChart;