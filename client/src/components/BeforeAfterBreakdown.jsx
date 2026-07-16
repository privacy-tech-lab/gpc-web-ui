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
import { parseJsonLike } from "../utils/schemaClassification.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Legend, ChartTooltip, ChartDataLabels);

// ==============================================================================
// 1. CONSTANTS & CONFIGURATION
// ==============================================================================

const SECTION_ORDER = [
  "US", "CA", "CO", "CT", "VA", "UT", "IA", "OR", "MT", "NH", "NJ", "TN", "TX", "DE",
];

const SECTION_KEY_TO_ABBREV = {
  usnatv1: "US", uscav1: "CA", uscov1: "CO", usctv1: "CT",
  usvav1: "VA", usutv1: "UT", usiatv1: "IA", usorv1: "OR",
  usmtv1: "MT", usnhv1: "NH", usnjv1: "NJ", ustnv1: "TN",
  ustxv1: "TX", usdel1: "DE",
};

const STATE_TO_SECTION_KEYS = {
  CA: ["uscav1", "usnatv1"],
  CO: ["uscov1", "usnatv1"],
  CT: ["usctv1", "usnatv1"],
  VA: ["usvav1", "usnatv1"],
  UT: ["usutv1", "usnatv1"],
  IA: ["usiatv1", "usnatv1"],
  OR: ["usorv1", "usnatv1"],
  MT: ["usmtv1", "usnatv1"],
  NH: ["usnhv1", "usnatv1"],
  NJ: ["usnjv1", "usnatv1"],
  TN: ["ustnv1", "usnatv1"],
  TX: ["ustxv1", "usnatv1"],
  DE: ["usdel1", "usnatv1"],
};

const STATUS_RENDER_ORDER = [
  "not_applicable",
  "did_not_opt_out",
  "opted_out",
  "invalid_missing",
];

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
  invalid_missing: "Invalid / Missing", // TODO: Update Invariants to use this string instead of returning []
};


// ==============================================================================
// 2. PLUG-AND-PLAY PRIVACY FRAMEWORK STRATEGIES
// ==============================================================================

const PRIVACY_FRAMEWORK_DECODERS = {
  // ── STRATEGY 1: GLOBAL PRIVACY PLATFORM (GPP) ──────────────────────────────
  GPP: {
    label: "Global Privacy Platform (GPP)",
    fields: ["TargetedAdvertisingOptOut", "SaleOptOut", "SharingOptOut", "GPC-SubSection"],
    hasSections: true,
    parse: (row, timing, field, selectedState) => {
      /**
       * INPUTS:
       * @param {Object} row           - A single raw data row from the CSV
       * @param {string} timing        - Either "before" or "after"
       * @param {string} field         - Active field string (e.g., "SaleOptOut")
       * @param {string} selectedState - Active 2-letter state filter (e.g., "CA")
       * OUTPUTS:
       * @returns {Array<[string, string]>} - Array of [sectionLabel, statusBucket] tuples.
       */
      const columnName = `decoded_gpp_${timing}_gpc`;
      const raw = row[columnName];
      if (!raw || ["null", ""].includes(String(raw).trim())) return [];
      
      const gppDict = parseJsonLike(String(raw));
      if (!gppDict || typeof gppDict !== "object" || Array.isArray(gppDict)) return [];
      
      const pairs = [];
      const keys = STATE_TO_SECTION_KEYS[selectedState] ?? Object.keys(SECTION_KEY_TO_ABBREV);

      for (const sectionKey of keys) {
        const abbrev = SECTION_KEY_TO_ABBREV[sectionKey];
        if (!abbrev) continue;
        const sec = gppDict[sectionKey];
        if (!sec || typeof sec !== "object") continue;
        
        let status;
        if (field === "GPC-SubSection") {
          const val = sec["Gpc"];
          // Check for both boolean and string representations just to be safe
          if (val === true || val === "True") status = "opted_out";
          else if (val === false || val === "False") status = "did_not_opt_out";
          else continue; 
        } 
        else {
          // Standard numerical GPP logic
          const val = parseFloat(sec[field]);
          if (isNaN(val)) continue;
          
          if (val === 1.0) status = "opted_out";
          else if (val === 2.0) status = "did_not_opt_out";
          else if (val === 0.0) status = "not_applicable";
          else continue;
        }
        
        pairs.push([abbrev, status]);
      }
      return pairs;
    }
  },

  // ── STRATEGY 2: USPS (uspapi and usp_cookies) ──────────────────────────────
  USPS: {
    label: "US Privacy String (USPS)",
    fields: ["OptOutSale"], 
    // TODO: Add support for other fields (i.e., "Notice/Opportunity to Opt Out" and "LSPA Covered Transaction") 
    // see https://github.com/InteractiveAdvertisingBureau/USPrivacy/blob/master/CCPA/US%20Privacy%20String.md#us-privacy-string-format
    hasSections: false,
    parse: (row, timing, field, selectedState) => {
      /**
       * INPUTS:
       * @param {Object} row           - A single raw data row from the CSV
       * @param {string} timing        - Either "before" or "after"
       * @param {string} field         - Active field string
       * @param {string} selectedState - Active 2-letter state filter
       * OUTPUTS:
       * @returns {Array<[string, string]>} - Array of [label, statusBucket] tuples.
       */

      // 1. Extract raw string from row[columnName] (e.g., "1YNY").
      const columnName = `usps_${timing}_gpc`;
      const raw = row[columnName]

      // 2. Filter out null/empty states.
      if (!raw || ["null", ""].includes(String(raw).trim())) return [];

      // 3. Map field to status.
      if (field == "OptOutSale") // currently redundant
      {
        const statusChar = raw[2];
        if (statusChar === "Y") return [["USPS", "opted_out"]];
        if (statusChar === "N") return [["USPS", "did_not_opt_out"]];
        if (statusChar === "-") return [["USPS", "not_applicable"]];
      }

      // If the character isn't Y, N, or -, or if an unimplemented field is selected, 
      // TODO: support "invalid_missing" instead
      return [];
    }
  },

  // ── STRATEGY 3: OneTrust (currently just OptanonConsent) ────────────────────────────────────
  OneTrust: {
    label: "OptanonConsent",
    fields: ["isGpcEnabled"],
    // TODO Add support for other labels and fields
    // see https://my.onetrust.com/articles/en_US/Knowledge/UUID-2dc719a8-4be5-8d16-1dc8-c7b4147b88e0#:~:text=Decoded%20Example%20Cookie
    hasSections: false,
    parse: (row, timing, field, selectedState) => {
      /**
       * INPUTS:
       * @param {Object} row          - A single raw data row from the CSV
       * @param {string} timing       - Either "before" or "after"
       * @param {string} field        - Active field string
       * @param {string} selectedState - Active 2-letter state filter
       * OUTPUTS:
       * @returns {Array<[string, string]>} - Array of [label, statusBucket] tuples.
       */

      // 1. Extract raw config parameters from row[columnName].
      const columnName = `OptanonConsent_${timing}_gpc`;
      const raw = row[columnName];

      // 2. Filter for null/empty states + n/a
      if (!raw || ["null", ""].includes(String(raw).trim())) return [["OneTrust", "invalid_missing"]];

      // 3. Map field to status.
      if (field == "isGpcEnabled") // currently redundant
      {
        if (raw === "no_gpc") return [["OneTrust", "not_applicable"]]

        const status = raw.at(-1);
        if (status == 1) return [["OneTrust", "opted_out"]];
        if (status == 0) return [["OneTrust", "did_not_opt_out"]];
      }

      // If the character isn't 0 or 1, or if an unimplemented field is selected, 
      // safely return an empty array to prevent the chart from breaking.
      // TODO: support "invalid_missing" instead
      return [];
    }
  }
};


// ==============================================================================
// 3. CORE DATA CALCULATION & FILTERING ENGINES
// ==============================================================================

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

// Mode A: Aggregated Tallying
function computeAggregated(rows, frameworkKey, field, applyFilter, selectedState) {
  const added = rows.filter(isAdded);
  const source = applyFilter ? added.filter(isSubjectOrLikely) : added;
  const beforeCounts = {};
  const afterCounts = {};

  const strategy = PRIVACY_FRAMEWORK_DECODERS[frameworkKey];

  for (const row of source) {
    const beforePairs = strategy.parse(row, "before", field, selectedState);
    const afterPairs = strategy.parse(row, "after", field, selectedState);

    for (const [, status] of beforePairs) {
      beforeCounts[status] = (beforeCounts[status] || 0) + 1;
    }
    for (const [, status] of afterPairs) {
      afterCounts[status] = (afterCounts[status] || 0) + 1;
    }
  }
  return { beforeCounts, afterCounts };
}

// Mode B: Split by Section Tallying
function computeBySection(rows, frameworkKey, field, applyFilter, selectedState) {
  const added = rows.filter(isAdded);
  const source = applyFilter ? added.filter(isSubjectOrLikely) : added;
  const beforeByCombo = {};
  const afterByCombo = {};

  const strategy = PRIVACY_FRAMEWORK_DECODERS[frameworkKey];

  for (const row of source) {
    const beforePairs = strategy.parse(row, "before", field, selectedState);
    const afterPairs = strategy.parse(row, "after", field, selectedState);

    for (const [abbrev, status] of beforePairs) {
      if (!beforeByCombo[abbrev]) beforeByCombo[abbrev] = {};
      beforeByCombo[abbrev][status] = (beforeByCombo[abbrev][status] || 0) + 1;
    }
    for (const [abbrev, status] of afterPairs) {
      if (!afterByCombo[abbrev]) afterByCombo[abbrev] = {};
      afterByCombo[abbrev][status] = (afterByCombo[abbrev][status] || 0) + 1;
    }
  }
  return { beforeByCombo, afterByCombo };
}


// ==============================================================================
// 4. CHART LAYOUT & COLOR SHADING GENERATORS
// ==============================================================================

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


// ==============================================================================
// 5. MAIN COMPONENT CONTROLLER
// ==============================================================================

const BeforeAfterBreakdown = memo(function BeforeAfterBreakdown({ timePeriods, stateMonths }) {
  
  // ── 5a. UI Dynamic States & Filters ──────────────────────────────────────────
  const availableStates = Object.keys(stateMonths);
  
  const [selectedFramework, setSelectedFramework] = useState("GPP");
  const [selectedState, setSelectedState] = useState(availableStates[0] ?? "CA");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [selectedField, setSelectedField] = useState("TargetedAdvertisingOptOut");
  
  const [showInvalid, setShowInvalid] = useState(false);
  const [showDataLabels, setShowDataLabels] = useState(false);
  const [splitBySections, setSplitBySections] = useState(false);
  const applyFilter = true; // true ensures consistency with Colab (Dec2023, Apr2024, Jun2024 are untested)


  // ── 5b. File Fetching Lifecycle Hooks ───────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const chartRef = useRef(null);

  // Grab all rows that were successfully added but FAILED the subject filter
  const filteredOutRows = useMemo(() => {
    const added = rows.filter(isAdded);
    return added.filter((row) => !isSubjectOrLikely(row));
  }, [rows]);

  // Sync supported field selection lists when the active layout framework changes
  useEffect(() => {
    const frameworkFields = PRIVACY_FRAMEWORK_DECODERS[selectedFramework].fields;
    setSelectedField(frameworkFields[0]);
    
    // Automatically disable "split sections" checkbox if the active standard doesn't support them
    if (!PRIVACY_FRAMEWORK_DECODERS[selectedFramework].hasSections) {
      setSplitBySections(false);
    }
  }, [selectedFramework]);

  // Sync available time periods when state selection moves
  useEffect(() => {
    const periods = stateMonths[selectedState] ?? [];
    if (periods.length > 0 && !periods.includes(selectedPeriod)) {
      setSelectedPeriod(periods[periods.length - 1]);
    }
  }, [selectedState, stateMonths]);

  // Dynamic AJAX parser loading target CSV data targets
  useEffect(() => {
    if (!selectedState || !selectedPeriod) {
      setLoading(false);
      return;
    }
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


  // ── 5c. Tally Computation Selectors ────────────────────────────────────────
  
  const { beforeCounts, afterCounts } = useMemo(
    () =>
      !splitBySections && rows.length > 0
        ? computeAggregated(rows, selectedFramework, selectedField, applyFilter, selectedState)
        : { beforeCounts: {}, afterCounts: {} },
    [rows, selectedFramework, selectedField, applyFilter, splitBySections, selectedState]
  );

  const { beforeByCombo, afterByCombo } = useMemo(
    () =>
      splitBySections && rows.length > 0
        ? computeBySection(rows, selectedFramework, selectedField, applyFilter, selectedState)
        : { beforeByCombo: {}, afterByCombo: {} },
    [rows, selectedFramework, selectedField, applyFilter, splitBySections, selectedState]
  );

  // Structural compiling pipelines building final UI Data formats
  const chartData = useMemo(() => {
    const data = splitBySections
      ? buildSectionChartData(beforeByCombo, afterByCombo, showInvalid)
      : buildAggregatedChartData(beforeCounts, afterCounts, showInvalid);

    const visibilityMap = [{}, {}]; 
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

  const chartN = useMemo(() => {
    const sumVisible = (counts) =>
      Object.entries(counts).reduce(
        (acc, [status, v]) => acc + (status === "invalid_missing" && !showInvalid ? 0 : v),
        0
      );
    if (splitBySections) {
      let before = 0;
      let after = 0;
      for (const c of Object.values(beforeByCombo)) before += sumVisible(c);
      for (const c of Object.values(afterByCombo)) after += sumVisible(c);
      return Math.max(before, after);
    }
    return Math.max(sumVisible(beforeCounts), sumVisible(afterCounts));
  }, [splitBySections, beforeCounts, afterCounts, beforeByCombo, afterByCombo, showInvalid]);

  // Flush filter tracking indexes on state mutations
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current._isolatedIndices = null;
    }
  }, [selectedFramework, selectedField, selectedPeriod, selectedState, splitBySections, showInvalid]);


  // ── 5d. Image Rendering & Snapshot Handlers ────────────────────────────────
  function handleDownload() {
    const chart = chartRef.current;
    if (!chart) return;

    const originalDatasets = chart.data.datasets;
    const originalLegendFilter = chart.options.plugins.legend.labels.filter;

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

    chart.data.datasets = originalDatasets;
    chart.options.plugins.legend.labels.filter = originalLegendFilter;
    chart.update("none");
  }

  const availablePeriods = stateMonths[selectedState] ?? [];
  const periodLabel = timePeriods.find((p) => p.key === selectedPeriod)?.label ?? selectedPeriod;
  const titleLine2 = `${periodLabel}  (n = ${chartN.toLocaleString()})${
    splitBySections ? " — split by section" : ""
  }`;


  // ── 5e. Rendering Graphics Display Configurations ───────────────────────
  const chartOptions = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    normalized: true, 
    layout: { padding: { top: 10, bottom: 10, left: 10, right: 20 } },
    scales: {
      x: {
        stacked: true,
        grid: { display: false, drawBorder: false },
        border: { display: false },
        ticks: { font: { size: 11, family: "'Segoe UI', sans-serif" }, color: "#64748b" },
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
        grid: { display: false, drawBorder: false },
        border: { display: false },
        ticks: { font: { size: 13, weight: "600", family: "'Segoe UI', sans-serif" }, color: "#1e293b" },
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
            chart.data.datasets.forEach((ds, i) => { ds.hidden = i !== index; });
          } else {
            if (isolated.has(index)) {
              isolated.delete(index);
              chart.data.datasets[index].hidden = true;
              if (isolated.size === 0) {
                chart.data.datasets.forEach((ds) => { ds.hidden = false; });
              }
            } else {
              isolated.add(index);
              chart.data.datasets[index].hidden = false;
              if (isolated.size === total) {
                isolated.clear();
                chart.data.datasets.forEach((ds) => { ds.hidden = false; });
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
        backgroundColor: "rgba(15, 23, 42, 0.9)", 
        padding: 12,
        titleFont: { size: 14, weight: "700", family: "'Segoe UI', sans-serif" },
        bodyFont: { size: 13, family: "'Segoe UI', sans-serif" },
        cornerRadius: 8,
        usePointStyle: true,
        callbacks: {
          label: (ctx) => ctx.parsed.x > 0 ? `${ctx.dataset.label}: ${ctx.parsed.x.toLocaleString()}` : null,
          filter: (item) => item.parsed.x > 0,
        },
      },
    },
    barPercentage: 0.85,
    categoryPercentage: 0.8,
  };

  const hasData = chartData.datasets.length > 0;


  // ── 5f. Template Dashboard Markup Render Block ────────────────────────────
  return (
    <div className="card card--padded section">
      <h2>Privacy Compliance Before and After GPC</h2>

      {/* Control Configuration Interface */}
      <div className="toolbar" role="group" aria-label="Privacy breakdown chart filters">
        <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingRight: "12px", borderRight: "1px solid #e2e8f0" }}>
          
          <label htmlFor="gs-framework" style={{ fontSize: "13px", fontWeight: "600", color: "#475569" }}>Framework:</label>
          <select id="gs-framework" value={selectedFramework} onChange={(e) => setSelectedFramework(e.target.value)} style={{ padding: "4px 8px" }}>
            {Object.keys(PRIVACY_FRAMEWORK_DECODERS).map((fKey) => (
              <option key={fKey} value={fKey}>{PRIVACY_FRAMEWORK_DECODERS[fKey].label}</option>
            ))}
          </select>

          <label htmlFor="gs-state" style={{ fontSize: "13px", fontWeight: "600", color: "#475569", marginLeft: "4px" }}>State:</label>
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
            {PRIVACY_FRAMEWORK_DECODERS[selectedFramework].fields.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* Structural Regional Segmentation Checkbox */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", paddingLeft: "4px" }}>
          <label style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "5px", 
            fontSize: "13px", 
            color: PRIVACY_FRAMEWORK_DECODERS[selectedFramework].hasSections ? "#475569" : "#cbd5e1", 
            cursor: PRIVACY_FRAMEWORK_DECODERS[selectedFramework].hasSections ? "pointer" : "not-allowed" 
          }}>
            <input 
              type="checkbox" 
              checked={splitBySections} 
              disabled={!PRIVACY_FRAMEWORK_DECODERS[selectedFramework].hasSections}
              onChange={(e) => setSplitBySections(e.target.checked)} 
            />
            Split by GPP type
          </label>
        </div>
      </div>

      {/* Loading Canvas View */}
      {loading && (
        <div style={{ height: 260, marginTop: "0.75rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem" }} role="status" aria-live="polite">
          <div style={{ width: 28, height: 28, border: "3px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "gpp-spin 0.8s linear infinite" }} aria-hidden="true" />
          <span className="muted-text" style={{ fontSize: 13 }}>Loading data layout view…</span>
          <style>{`@keyframes gpp-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      
      {/* Error Boundary View */}
      {loadError && <p style={{ color: "red" }}>{loadError}</p>}

      {/* Empty States Fallbacks */}
      {!loading && !loadError && !hasData && (
        <p className="muted-text">
          No records matching <strong>{selectedField}</strong> found inside {selectedState} ({periodLabel}).
        </p>
      )}

      {/* Active Chart Dashboard Core */}
      {!loading && !loadError && hasData && (
        <>
          {splitBySections && (
            <p className="muted-text" style={{ marginTop: "0.5rem", marginBottom: "0.25rem" }}>
              Each GPP string section (US, CA, CO, …) is counted independently — a site with multiple sections contributes once per section.
              {" "}{applyFilter && "Subject filter applied."}
            </p>
          )}

          <div style={{ height: 260, marginTop: "0.75rem" }}>
            <Bar ref={chartRef} data={chartData} options={chartOptions} />
          </div>

          {/* Action Execution Footer Toolbar */}
          <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "14px", color: "#475569", cursor: "pointer" }}>
              <input type="checkbox" checked={showInvalid} onChange={(e) => setShowInvalid(e.target.checked)} />
              Show invalid
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "14px", color: "#475569", cursor: "pointer" }}>
              <input type="checkbox" checked={showDataLabels} onChange={(e) => setShowDataLabels(e.target.checked)} />
              Show data labels
            </label>

            <button className="btn-download" onClick={handleDownload}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
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

export default BeforeAfterBreakdown;