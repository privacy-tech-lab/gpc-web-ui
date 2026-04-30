import { useEffect, useMemo, useState, useRef, memo } from "react";
import Papa from "papaparse";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Legend,
  Tooltip as ChartTooltip,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import ChartDataLabels from "chartjs-plugin-datalabels";

import Tooltip from "./components/Tooltip";
import ChartSchemaFilterPanel from "./components/ChartSchemaFilterPanel.jsx";
import {
  ANALYSIS_MODES,
  SCHEMA_CLASSIFICATION_COLUMN,
  getSchemaClassificationForRow,
  sortSchemaTokens,
  parseSchemaToken,
} from "./utils/schemaClassification.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Legend,
  ChartTooltip,
  ChartDataLabels
);

// ── Semantic color palettes keyed by compliance status ────────────────────────
const STATUS_COLOR_PALETTES = {
  opted_out: [
    "#10b981", "#059669", "#047857", "#16a34a", "#15803d", "#22c55e",
  ],
  did_not_opt_out: [
    "#3b82f6", "#2563eb", "#1d4ed8", "#60a5fa", "#3b82f6cc", "#2563ebcc",
  ],
  invalid_missing: [
    "#f59e0b", "#d97706", "#b45309", "#fbbf24", "#f59e0bcc",
  ],
  invalid: [
    "#ea580c", "#c2410c", "#f97316", "#9a3412",
  ],
  not_applicable: [
    "#94a3b8", "#64748b", "#475569", "#cbd5e1", "#334155",
  ],
};

const LEGACY_COLOR_PALETTE = [
  "#2e7d32", "#1b5e20", "#43a047", "#66bb6a", "#81c784",
  "#26a69a", "#00796b", "#558b2f", "#689f38", "#8bc34a",
  "#33691e", "#00acc1", "#26c6da", "#9ccc65", "#4db6ac", "#a5d6a7",
];

const SPECIAL_SERIES = {
  PNC_SITES: "Potentially Non-Compliant Sites",
  NULL_SITES: "Null Sites",
};

const SPECIAL_SERIES_DESCRIPTIONS = {
  [SPECIAL_SERIES.PNC_SITES]: "Counts rows in the PotentiallyNonCompliantSites dataset for each month.",
  [SPECIAL_SERIES.NULL_SITES]: "Counts rows in the NullSites dataset for each month.",
};

const PNC_REASON_LIST = [
  "Invalid_uspapi", "Invalid_usp_cookies", "uspapi", "usp_cookies",
  "MissingAfter_uspapi", "MissingAfter_usp_cookies", "Invalid_GPPString",
  "SaleOptOut_USNAT", "SharingOptOut_USNAT", "TargetedAdvertisingOptOut_USNAT",
  "SaleOptOut_State", "SharingOptOut_State", "TargetedAdvertisingOptOut_State",
  "MissingAfterGPPString", "Invalid_OptanonConsent", "OptanonConsent",
  "MissingAfterOptanonConsent", "Well-Known", "Invalid_Well-Known", "SegmentSwitchGPP",
];

const AVAILABLE_STATES = ["CA", "CT", "CO", "NJ"];

function parseReasons(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(i => String(i).trim()).filter(Boolean);
  const str = String(value).trim();
  const jsonLike = str.replace(/^\s*\[\s*/, "[").replace(/\s*\]\s*$/, "]")
    .replace(/'\s*,\s*'/g, '","').replace(/^\['/, '["').replace(/'\]$/, '"]').replace(/'/g, '"');
  try {
    const parsed = JSON.parse(jsonLike);
    if (Array.isArray(parsed)) return parsed.map(i => String(i).trim()).filter(Boolean);
  } catch {}
  return str.replace(/^\[|\]$/g, "").split(",").map(i => i.replace(/^[\s'"]+|[\s'"]+$/g, "").trim()).filter(Boolean);
}

function normalizeRow(row) {
  const normalized = {};
  Object.keys(row || {}).forEach(key => { normalized[String(key).trim()] = row[key]; });
  return normalized;
}

function parseCsv(publicCsvPath) {
  return new Promise((resolve, reject) => {
    Papa.parse(publicCsvPath, {
      download: true, header: true, skipEmptyLines: true,
      complete: parsed => resolve({
        headers: (parsed.meta?.fields || []).map(f => String(f).trim()),
        rows: (parsed.data || []).map(normalizeRow),
      }),
      error: err => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

function getChartParam(key, fallback) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}

function getChartArrayParam(key, fallback) {
  if (typeof window === "undefined") return fallback;
  const val = new URLSearchParams(window.location.search).get(key);
  if (val) return val.split(",").map(s => s.trim()).filter(Boolean);
  return fallback;
}

const ReasonTrendsChart = memo(function ReasonTrendsChart({ analysisMode, timePeriods, stateMonths }) {
  const [selectedSeries, setSelectedSeries] = useState(() => getChartArrayParam("cseries", [SPECIAL_SERIES.PNC_SITES]));
  const [chartType, setChartType] = useState(() => getChartParam("ctype", "line"));
  const [stateMonthToAllRecords, setStateMonthToAllRecords] = useState({});
  const [stateMonthToPncRows, setStateMonthToPncRows] = useState({});
  const [stateMonthToNullRows, setStateMonthToNullRows] = useState({});
  const [stateMonthToSchemaAvailability, setStateMonthToSchemaAvailability] = useState({});
  const [schemaParseErrorCount, setSchemaParseErrorCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedStates, setSelectedStates] = useState(() => getChartArrayParam("cstates", ["CA"]));
  const [showDataLabels, setShowDataLabels] = useState(false);
  const [reasonDescriptions, setReasonDescriptions] = useState({});
  const chartRef = useRef(null);

  // Reset isolation when main filters change
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current._isolatedIndices = null;
    }
  }, [selectedSeries, selectedStates, analysisMode, chartType]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (selectedSeries.length > 0) params.set("cseries", selectedSeries.join(","));
    else params.delete("cseries");
    if (selectedStates.length !== 1 || selectedStates[0] !== "CA") params.set("cstates", selectedStates.join(","));
    else params.delete("cstates");
    if (chartType !== "line") params.set("ctype", chartType);
    else params.delete("ctype");
    const newUrl = params.toString() ? window.location.pathname + "?" + params.toString() : window.location.pathname;
    if (newUrl !== window.location.pathname + window.location.search) window.history.replaceState(null, "", newUrl);
  }, [selectedSeries, selectedStates, chartType]);

  function handleDownload() {
    const chart = chartRef.current;
    if (!chart) return;

    chart.stop();
    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.setActiveElements([]);

    const originalDatasets = chart.data.datasets;
    const originalLegendFilter = chart.options.plugins.legend.labels.filter;

    // Filter hidden for export
    chart.options.plugins.legend.labels.filter = (item) => !originalDatasets[item.datasetIndex].hidden;
    chart.data.datasets = originalDatasets.filter(ds => !ds.hidden);
    
    chart.update("none");

    const canvas = chart.canvas;
    const newCanvas = document.createElement("canvas");
    newCanvas.width = canvas.width; newCanvas.height = canvas.height;
    const ctx = newCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    const url = newCanvas.toDataURL("image/png", 1);
    const a = document.createElement("a"); a.href = url;
    a.download = `Trend_${analysisMode}_${selectedStates.join("_")}.png`;
    a.click();

    // Restore
    chart.data.datasets = originalDatasets;
    chart.options.plugins.legend.labels.filter = originalLegendFilter;
    chart.update("none");
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/classifications_of_compliance.json")
      .then(res => res.ok ? res.json() : Promise.reject(new Error("Failed to load")))
      .then(data => { if (!cancelled) setReasonDescriptions(data); })
      .catch(err => console.warn(err));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSelectedSeries(prev => {
      const specials = prev.filter(k => k === SPECIAL_SERIES.PNC_SITES || k === SPECIAL_SERIES.NULL_SITES);
      return specials.length > 0 ? specials : [SPECIAL_SERIES.PNC_SITES];
    });
  }, [analysisMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedStates() {
      setLoading(true); setError("");
      try {
        const states = Array.isArray(selectedStates) ? selectedStates : [];
        if (states.length === 0) {
          setStateMonthToAllRecords({}); setStateMonthToPncRows({}); setStateMonthToNullRows({}); setStateMonthToSchemaAvailability({});
          setLoading(false); return;
        }
        const perStateResults = await Promise.all(states.map(async (stateCode) => {
          const monthKeys = stateMonths[stateCode] || [];
          const monthResults = await Promise.all(monthKeys.map(async (monthKey) => {
            const [allData, pncData, nullData] = await Promise.all([
              parseCsv(`/${stateCode}/Crawl_Data_${stateCode} - ${monthKey}.csv`),
              parseCsv(`/${stateCode}/Crawl_Data_${stateCode} - PotentiallyNonCompliantSites${monthKey}.csv`),
              parseCsv(`/${stateCode}/Crawl_Data_${stateCode} - NullSites${monthKey}.csv`),
            ]);
            const allRecords = allData.rows.map(row => ({ row, schema: getSchemaClassificationForRow(row) }));
            return { key: monthKey, allRecords, pncRows: pncData.rows, nullRows: nullData.rows, hasSchemaColumn: allData.headers.includes(SCHEMA_CLASSIFICATION_COLUMN) };
          }));
          return { stateCode, monthResults };
        }));
        if (cancelled) return;
        const nextAll = {}; const nextPnc = {}; const nextNull = {}; const nextAvail = {};
        perStateResults.forEach(({ stateCode, monthResults }) => {
          nextAll[stateCode] = {}; nextPnc[stateCode] = {}; nextNull[stateCode] = {}; nextAvail[stateCode] = {};
          monthResults.forEach(m => {
            nextAll[stateCode][m.key] = m.allRecords; nextPnc[stateCode][m.key] = m.pncRows;
            nextNull[stateCode][m.key] = m.nullRows; nextAvail[stateCode][m.key] = m.hasSchemaColumn;
          });
        });
        setStateMonthToAllRecords(nextAll); setStateMonthToPncRows(nextPnc); setStateMonthToNullRows(nextNull); setStateMonthToSchemaAvailability(nextAvail);
      } catch (err) { if (!cancelled) setError(err.message); } finally { if (!cancelled) setLoading(false); }
    }
    loadSelectedStates(); return () => { cancelled = true; };
  }, [selectedStates, stateMonths]);

  const unifiedMonthKeys = useMemo(() => {
    const states = selectedStates || [];
    const keySet = new Set();
    states.forEach(s => (stateMonths[s] || []).forEach(k => keySet.add(k)));
    return (timePeriods || []).filter(p => keySet.has(p.key)).map(p => p.key);
  }, [selectedStates, stateMonths, timePeriods]);

  const labels = useMemo(() => {
    const keyToLabel = new Map((timePeriods || []).map(p => [p.key, p.label]));
    return unifiedMonthKeys.map(k => keyToLabel.get(k) || k);
  }, [timePeriods, unifiedMonthKeys]);

  const schemaSeriesMeta = useMemo(() => {
    const labelsByToken = {}; const descriptionsByToken = {}; const tokenSet = new Set();
    selectedStates.forEach(s => unifiedMonthKeys.forEach(m => {
      (stateMonthToAllRecords[s]?.[m] || []).forEach(({ schema }) => schema.tokens.forEach(t => {
        tokenSet.add(t); labelsByToken[t] = schema.labels[t] || t; descriptionsByToken[t] = schema.descriptions[t] || "";
      }));
    }));
    return { tokens: sortSchemaTokens(tokenSet), labelsByToken, descriptionsByToken };
  }, [selectedStates, stateMonthToAllRecords, unifiedMonthKeys]);

  const seriesOptions = useMemo(() => {
    const base = [
      { key: SPECIAL_SERIES.PNC_SITES, label: SPECIAL_SERIES.PNC_SITES, description: SPECIAL_SERIES_DESCRIPTIONS[SPECIAL_SERIES.PNC_SITES] },
      { key: SPECIAL_SERIES.NULL_SITES, label: SPECIAL_SERIES.NULL_SITES, description: SPECIAL_SERIES_DESCRIPTIONS[SPECIAL_SERIES.NULL_SITES] },
    ];
    if (analysisMode === ANALYSIS_MODES.SCHEMA) return [...base, ...schemaSeriesMeta.tokens.map(t => ({ key: t, label: schemaSeriesMeta.labelsByToken[t] || t, description: schemaSeriesMeta.descriptionsByToken[t] || "" }))];
    return [...base, ...PNC_REASON_LIST.map(r => ({ key: r, label: r, description: reasonDescriptions[r] || "" }))];
  }, [analysisMode, reasonDescriptions, schemaSeriesMeta]);

  const datasets = useMemo(() => {
    if (selectedSeries.length === 0) return [];
    const allDatasets = []; const statusVarCounters = {};
    selectedStates.forEach(stateCode => selectedSeries.forEach(seriesKey => {
      let color;
      if (seriesKey === SPECIAL_SERIES.PNC_SITES) color = "#c2410c";
      else if (seriesKey === SPECIAL_SERIES.NULL_SITES) color = "#94a3b8";
      else {
        const statusKey = parseSchemaToken(seriesKey)?.status ?? "__legacy";
        const palette = STATUS_COLOR_PALETTES[statusKey] ?? LEGACY_COLOR_PALETTE;
        const idx = statusVarCounters[statusKey] ?? 0;
        statusVarCounters[statusKey] = idx + 1;
        color = palette[idx % palette.length];
      }
      let data = unifiedMonthKeys.map(m => {
        if (seriesKey === SPECIAL_SERIES.PNC_SITES) return stateMonthToPncRows[stateCode]?.[m]?.length;
        if (seriesKey === SPECIAL_SERIES.NULL_SITES) return stateMonthToNullRows[stateCode]?.[m]?.length;
        if (analysisMode === ANALYSIS_MODES.SCHEMA) {
          if (!stateMonthToSchemaAvailability[stateCode]?.[m]) return null;
          return (stateMonthToAllRecords[stateCode]?.[m] || []).filter(r => r.schema.tokens.includes(seriesKey)).length;
        }
        return (stateMonthToPncRows[stateCode]?.[m] || []).filter(r => parseReasons(r.Reasons_Non_Compliant).includes(seriesKey)).length;
      });
      allDatasets.push({
        label: `${stateCode} - ${seriesOptions.find(o => o.key === seriesKey)?.label || seriesKey}`,
        data, borderColor: color, backgroundColor: chartType === "line" ? color : `${color}80`,
        fill: false, tension: 0.3, pointRadius: 4, pointHoverRadius: 6,
        borderRadius: chartType === "bar" ? { topLeft: 8, topRight: 8 } : 0,
      });
    }));
    return allDatasets;
  }, [analysisMode, chartType, selectedSeries, selectedStates, seriesOptions, stateMonthToAllRecords, stateMonthToNullRows, stateMonthToPncRows, stateMonthToSchemaAvailability, unifiedMonthKeys]);

  const options = useMemo(() => ({
    responsive: true, maintainAspectRatio: false, normalized: true, customType: chartType,
    layout: { padding: { top: 10, bottom: 10, left: 10, right: 20 } },
    plugins: {
      datalabels: {
        display: showDataLabels,
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        borderRadius: 4,
        color: (ctx) => ctx.dataset.borderColor,
        font: { weight: "bold", size: 10 },
        formatter: (val) => (val > 0 ? val.toLocaleString() : ""),
        padding: 4,
        offset: 8,
        anchor: "end",
        align: "top",
      },
      legend: {
        position: "bottom",
        onClick: (e, item, legend) => {
          const index = item.datasetIndex; const chart = legend.chart; const total = chart.data.datasets.length;
          if (!chart._isolatedIndices) chart._isolatedIndices = new Set();
          const isolated = chart._isolatedIndices;
          if (isolated.size === 0 || isolated.size === total) {
            isolated.clear(); isolated.add(index);
            chart.data.datasets.forEach((ds, i) => { ds.hidden = i !== index; });
          } else {
            if (isolated.has(index)) {
              isolated.delete(index); chart.data.datasets[index].hidden = true;
              if (isolated.size === 0) chart.data.datasets.forEach(ds => { ds.hidden = false; });
            } else {
              isolated.add(index); chart.data.datasets[index].hidden = false;
              if (isolated.size === total) { isolated.clear(); chart.data.datasets.forEach(ds => { ds.hidden = false; }); }
            }
          }
          chart.update();
        },
        onHover: (evt, item, legend) => {
          const chart = legend.chart; const index = item.datasetIndex; const isLine = chart.options.customType === "line";
          chart.data.datasets.forEach((ds, i) => {
            const baseColor = ds.borderColor.length > 7 ? ds.borderColor.slice(0, 7) : ds.borderColor;
            if (i === index) {
              ds.borderWidth = isLine ? 4 : ds.borderWidth; ds.borderColor = baseColor; ds.backgroundColor = baseColor;
              ds.pointBackgroundColor = baseColor; ds.pointBorderColor = baseColor;
              if (isLine) ds.pointRadius = 4;
            } else {
              ds.borderWidth = isLine ? 1 : ds.borderWidth; ds.borderColor = baseColor + "25"; ds.backgroundColor = baseColor + "20";
              ds.pointBackgroundColor = baseColor; ds.pointBorderColor = baseColor;
              if (isLine) ds.pointRadius = 4;
            }
          });
          chart.update("none");
        },
        onLeave: (evt, item, legend) => {
          const chart = legend.chart; const isLine = chart.options.customType === "line";
          chart.data.datasets.forEach(ds => {
            const baseColor = ds.borderColor.length > 7 ? ds.borderColor.slice(0, 7) : ds.borderColor;
            ds.borderWidth = isLine ? 3 : 0; ds.borderColor = baseColor; ds.backgroundColor = isLine ? baseColor : baseColor + "80";
            ds.pointBackgroundColor = baseColor; ds.pointBorderColor = baseColor;
            if (isLine) ds.pointRadius = 4;
          });
          chart.update("none");
        },
        labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", padding: 12, font: { size: 11, family: "'Segoe UI', sans-serif", weight: "500" }, color: "#475569" },
      },
      tooltip: { mode: "index", intersect: false, backgroundColor: "rgba(15, 23, 42, 0.9)", padding: 12, titleFont: { size: 14, weight: "700" }, bodyFont: { size: 13 }, cornerRadius: 8, usePointStyle: true },
      title: { display: true, text: analysisMode === ANALYSIS_MODES.SCHEMA ? "Schema classification trends over months" : "Reason trends over months", font: { size: 15, weight: "700" }, color: "#1e293b", padding: { bottom: 20 } },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: "rgba(0, 0, 0, 0.05)", drawBorder: false }, border: { display: false }, ticks: { font: { size: 12 }, color: "#64748b" }, title: { display: true, text: "Number of Sites", font: { size: 12, weight: "600" }, color: "#475569" } },
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 12 }, color: "#64748b" }, title: { display: true, text: "Month", font: { size: 12, weight: "600" }, color: "#475569" } },
    },
  }), [analysisMode, chartType, showDataLabels]);

  return (
    <div className="card card--padded section">
      <h2>Track Compliance Evolution Over Time</h2>
      <div className="toolbar">
        <div className="toolbar-item-group" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <label htmlFor="chart-type-select">Chart Type:</label>
          <select id="chart-type-select" value={chartType} onChange={e => setChartType(e.target.value)}>
            <option value="line">Line Trend</option><option value="bar">Bar Comparison</option>
          </select>
        </div>
        <div className="toolbar-item-group" style={{ display: "flex", alignItems: "center", gap: "8px", borderLeft: "1px solid #e2e8f0", paddingLeft: "16px", marginLeft: "4px" }}>
          <span style={{ fontSize: "14px", fontWeight: "500", color: "#475569" }}>States:</span>
          <div className="chip-group">
            {AVAILABLE_STATES.map(s => {
              const active = selectedStates.includes(s);
              return <button key={s} className={`chip${active ? " chip--active" : ""}`} style={{ padding: "4px 12px", fontSize: "12px" }} onClick={() => setSelectedStates(prev => prev.includes(s) ? prev.filter(v => v !== s) : [...prev, s])}>{s}</button>;
            })}
          </div>
        </div>
      </div>
      <ChartSchemaFilterPanel seriesOptions={seriesOptions} selectedSeries={selectedSeries} selectedStates={selectedStates} onToggle={k => setSelectedSeries(prev => prev.includes(k) ? prev.filter(s => s !== k) : [...prev, k])} isSchemaMode={analysisMode === ANALYSIS_MODES.SCHEMA} />
      {loading && <div style={{ padding: 8 }}>Loading chart data...</div>}
      {error && <div style={{ padding: 8, color: "#b00020" }}>Error: {error}</div>}
      {!loading && !error && selectedStates.length > 0 && (
        <>
          <div className="chart-area">{chartType === "line" ? <Line ref={chartRef} data={{ labels, datasets }} options={options} /> : <Bar ref={chartRef} data={{ labels, datasets }} options={options} />}</div>
          <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "14px", color: "#475569", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showDataLabels}
                onChange={(e) => setShowDataLabels(e.target.checked)}
              />
              Show data labels
            </label>
            <button className="btn-download" onClick={handleDownload}>Download PNG</button>
          </div>
        </>
      )}
    </div>
  );
});

export default ReasonTrendsChart;