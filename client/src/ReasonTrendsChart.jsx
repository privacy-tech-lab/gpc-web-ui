import { useEffect, useMemo, useState, useRef, memo } from "react";
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
  SCHEMA_CLASSIFICATION_COLUMN,
  isSchemaRowNonCompliant,
  sortSchemaTokens,
  parseSchemaToken,
} from "./utils/schemaClassification.js";
import { STATUS_COLOR_PALETTES, LEGACY_COLOR_PALETTE, SPECIAL_SERIES, getColorForSeries } from "./utils/colorPalettes.js";
import { loadDataset } from "./utils/datasetCache.js";
import datasetsManifest from "./generated/datasets.json";

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

const COMPLIANCE_SERIES = {
  DOES_NOT_HONOR: "Likely Does Not Honor GPC",
  HONORS: "Likely Honors GPC",
  NA_INVALID: "Not Applicable/Invalid/Missing",
};

const COMPLIANCE_DESCRIPTIONS = {
  [COMPLIANCE_SERIES.DOES_NOT_HONOR]: "Sites whose compliance classification explicitly states that they likely do not honor GPC.",
  [COMPLIANCE_SERIES.HONORS]: "Sites whose compliance classification explicitly states that they likely honor GPC.",
  [COMPLIANCE_SERIES.NA_INVALID]: "Sites where GPC compliance could not be determined or is not applicable.",
};

const SPECIAL_SERIES_DESCRIPTIONS = {
  [SPECIAL_SERIES.PNC_SITES]:
    "Counts sites where at least one opt-out signal (USPS, OptanonConsent, or GPP) did not opt the user out after GPC. Well-known is excluded (it reflects GPC support, not opt-out behavior). Sites with no opt-out signal (could not determine) and sites that opted out (compliant) are excluded.",
  [SPECIAL_SERIES.NULL_SITES]:
    "Counts rows where site_isnull is TRUE in the main dataset for each month.",
};

const AVAILABLE_STATES = ["CA", "CT", "CO", "NJ"];

// These four are mutually exclusive classifications of a site's GPC
// compliance result — a site can only be one of them. The chips act as
// logical ANDs, so in table view (where they gate which rows show) only one
// may be active at a time.
const MUTUALLY_EXCLUSIVE_SERIES = new Set([
  COMPLIANCE_SERIES.DOES_NOT_HONOR,
  COMPLIANCE_SERIES.HONORS,
  COMPLIANCE_SERIES.NA_INVALID,
  SPECIAL_SERIES.NULL_SITES,
]);

// Point shape identifies which family a line belongs to, so color can stay
// fixed to status (opted_out green, did_not_opt_out red, etc.) even when
// several families' lines of the same status are on the chart together.
// GPP uses "star" for every state — Chart.js's built-in point styles don't
// support varying the number of points, so a true 4/5/6-point star per
// state would need custom canvas-drawn point images; skipped as overkill
// for a "possibly" ask.
const POINT_STYLE_BY_FAMILY = {
  usps: "triangle",
  optanonConsent: "rect",
  wellKnown: "rectRot",
  gpp: "star", // fallback for any GPP state not covered by GPP_STATE_SHAPES below
};

// Rainbowize palette: ROYGBIV, extended with pink/black/gray for an 8th–10th
// line. Cycles back to red if there are somehow more than 10 selected lines.
// Hues chosen so no two neighbors sit closer than ~20° apart even in the
// naturally-compressed blue/indigo/violet stretch of the spectrum (a plain
// ROYGBIV picked by name alone tends to cluster those three); pink is kept
// noticeably lighter than red/violet so it doesn't read as a shade of
// either, and gray is a warm (not blue-leaning) neutral so it doesn't blend
// into the blue/indigo/violet group.
const RAINBOW_PALETTE = [
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // yellow
  "#16a34a", // green
  "#2563eb", // blue
  "#3730a3", // indigo
  "#9333ea", // violet
  "#f472b6", // pink
  "#000000", // black
  "#78716c", // gray
];

// GPP's own section value in the data may be the old 2-letter state code
// ("US", "CA", ...) or the newer technical segment name ("usnat", "usca",
// ...) depending on crawl vintage — normalize either to the segment name.
const GPP_STATE_SECTION_NAMES = {
  US: "usnat", usnat: "usnat",
  CA: "usca", usca: "usca",
  CO: "usco", usco: "usco",
  CT: "usct", usct: "usct",
  NJ: "usnj", usnj: "usnj",
};
function gppStateSectionName(state) {
  return GPP_STATE_SECTION_NAMES[state] || String(state || "").toLowerCase();
}

// One invented custom shape per GPP state, drawn on an offscreen canvas at
// dataset-build time (colored to match that line's status color, since
// Chart.js draws a canvas/image pointStyle as-is and ignores
// pointBackgroundColor/pointBorderColor for it). Each path is built around
// the origin so it can be reused at any size.
const GPP_STATE_SHAPE_DRAWERS = {
  // usnat: shield — flat top, sides curving down to a point.
  usnat(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, -r * 0.6);
    ctx.lineTo(r * 0.85, -r * 0.6);
    ctx.lineTo(r * 0.85, r * 0.05);
    ctx.quadraticCurveTo(r * 0.85, r * 0.55, 0, r);
    ctx.quadraticCurveTo(-r * 0.85, r * 0.55, -r * 0.85, r * 0.05);
    ctx.closePath();
    ctx.fill();
  },
  // usca: pentagon.
  usca(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = ((-90 + i * 72) * Math.PI) / 180;
      const px = r * Math.cos(angle);
      const py = r * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  },
  // usco: plus / cross.
  usco(ctx, r) {
    const t = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(-t, -r); ctx.lineTo(t, -r); ctx.lineTo(t, -t); ctx.lineTo(r, -t);
    ctx.lineTo(r, t); ctx.lineTo(t, t); ctx.lineTo(t, r); ctx.lineTo(-t, r);
    ctx.lineTo(-t, t); ctx.lineTo(-r, t); ctx.lineTo(-r, -t); ctx.lineTo(-t, -t);
    ctx.closePath();
    ctx.fill();
  },
  // usct: hourglass / bowtie — a self-crossing quad fills as two triangles.
  usct(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(-r, -r); ctx.lineTo(r, -r); ctx.lineTo(-r, r); ctx.lineTo(r, r);
    ctx.closePath();
    ctx.fill();
  },
  // usnj: six-armed asterisk / snowflake — stroked, not filled, so it reads
  // distinctly from the solid shapes above.
  usnj(ctx, r) {
    ctx.lineWidth = r * 0.32;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const angle = (i * 60 * Math.PI) / 180;
      const dx = r * Math.cos(angle);
      const dy = r * Math.sin(angle);
      ctx.moveTo(-dx, -dy);
      ctx.lineTo(dx, dy);
    }
    ctx.stroke();
  },
};

const shapeCanvasCache = new Map();

// Builds (and caches) a small canvas with one of the shapes above, tinted
// to match a specific line's color — canvas point styles bake their own
// color in, so a new one is needed per distinct color, not just per shape.
function getGppStateShapeCanvas(sectionName, color, size) {
  const drawer = GPP_STATE_SHAPE_DRAWERS[sectionName];
  if (!drawer || typeof document === "undefined") return null;
  const cacheKey = `${sectionName}|${color}|${size}`;
  const cached = shapeCanvasCache.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  drawer(ctx, size * 0.42);
  shapeCanvasCache.set(cacheKey, canvas);
  return canvas;
}

function baseColorForSeries(seriesKey) {
  if (seriesKey === SPECIAL_SERIES.PNC_SITES) return getColorForSeries(SPECIAL_SERIES.PNC_SITES);
  if (seriesKey === COMPLIANCE_SERIES.DOES_NOT_HONOR) return "#ef4444";
  if (seriesKey === COMPLIANCE_SERIES.HONORS) return "#22c55e";
  if (seriesKey === COMPLIANCE_SERIES.NA_INVALID) return "#1B7EB5";
  if (seriesKey === SPECIAL_SERIES.NULL_SITES) return getColorForSeries(SPECIAL_SERIES.NULL_SITES);
  const statusKey = parseSchemaToken(seriesKey)?.status ?? "__legacy";
  const palette = STATUS_COLOR_PALETTES[statusKey] ?? LEGACY_COLOR_PALETTE;
  return palette[0];
}

// Each entry: prefixes a series key may start with -> display label for the footnote.
// Uses the same prefix logic as isStateSensitiveSeries in App.jsx so all four families
// are detected reliably, regardless of what parseSchemaToken returns internally.
const SCHEMA_FAMILY_MATCHERS = [
  { prefixes: ["usps"],                                       label: "USPS" },
  { prefixes: ["optanonconsent", "optanon"],                  label: "OptanonConsent" },
  { prefixes: ["wellknown", "well_known", "well-known"],      label: "Well-Known" },
  { prefixes: ["gpp"],                                        label: "GPP" },
];

function getSchemaFamilyLabel(seriesKey) {
  const lower = String(seriesKey).toLowerCase();
  for (const { prefixes, label } of SCHEMA_FAMILY_MATCHERS) {
    if (prefixes.some(p => lower === p || lower.startsWith(`${p}|`) || lower.startsWith(`${p}_`))) {
      return label;
    }
  }
  return null;
}

const ReasonTrendsChart = memo(function ReasonTrendsChart({
  viewMode,
  tableContent,
  timePeriods,
  stateMonths,
  graphSelectedSeries,
  setGraphSelectedSeries,
  tableSelectedSeries,
  setTableSelectedSeries,
  selectedStates,
  setSelectedStates,
  chartType,
  setChartType,
  activeChart,
  setActiveChart,
  gppSection,
  setCurrentPage,
  tableSelectedState,
  expandedCategories,
  setExpandedCategories,
}) {
  const [stateMonthToAllRecords, setStateMonthToAllRecords] = useState({});
  const [stateMonthToNullRows, setStateMonthToNullRows] = useState({});
  const [stateMonthToSchemaAvailability, setStateMonthToSchemaAvailability] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDataLabels, setShowDataLabels] = useState("off"); // "off" | "counts" | "percentages"
  // When on, every line gets an evenly-spaced rainbow hue instead of its
  // status color, so an arbitrarily large number of lines all stay visually
  // distinguishable from each other (status color and shape are otherwise
  // shared across many lines by design).
  const [rainbowize, setRainbowize] = useState(false);
  // Index of the dataset currently hovered in the legend, or null when
  // nothing is hovered — drives the isolate-this-line effect below.
  const [hoveredDatasetIndex, setHoveredDatasetIndex] = useState(null);
  const chartRef = useRef(null);

  // Which schema families (USPS / OptanonConsent / Well-Known / GPP) are currently selected.
  // Keyed by display label so variants (well_known / well-known) never double-count.
  const activeSchemaFamilies = useMemo(() => {
    const seen = new Set();
    graphSelectedSeries.forEach(k => {
      const label = getSchemaFamilyLabel(k);
      if (label) seen.add(label);
    });
    // Return in the canonical order defined by SCHEMA_FAMILY_MATCHERS
    return SCHEMA_FAMILY_MATCHERS.map(m => m.label).filter(l => seen.has(l));
  }, [graphSelectedSeries]);

  // Footnote sentence built from only the active families
  const footnoteText = useMemo(() => {
    if (activeSchemaFamilies.length === 0) return null;
    const list =
      activeSchemaFamilies.length === 1
        ? activeSchemaFamilies[0]
        : activeSchemaFamilies.slice(0, -1).join(", ") + " and " + activeSchemaFamilies.at(-1);
    return `* Percentages for ${list} series are out of sites with a non-None value for that variable, not total sites.`;
  }, [activeSchemaFamilies]);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current._isolatedIndices = null;
    }
  }, [graphSelectedSeries, selectedStates, chartType]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (graphSelectedSeries.length > 0) params.set("cseries", graphSelectedSeries.join(","));
    else params.delete("cseries");
    if (tableSelectedSeries.length > 0) params.set("tseries", tableSelectedSeries.join(","));
    else params.delete("tseries");
    if (selectedStates.length !== 1 || selectedStates[0] !== "CA") params.set("cstates", selectedStates.join(","));
    else params.delete("cstates");
    if (chartType !== "line") params.set("ctype", chartType);
    else params.delete("ctype");
    const newUrl = params.toString() ? window.location.pathname + "?" + params.toString() : window.location.pathname;
    if (newUrl !== window.location.pathname + window.location.search) window.history.replaceState(null, "", newUrl);
  }, [graphSelectedSeries, tableSelectedSeries, selectedStates, chartType]);

  function handleDownload() {
    const chart = chartRef.current;
    if (!chart) return;

    chart.stop();

    // Clear any hover tooltip
    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.setActiveElements([]);
    const originalDatasets = chart.data.datasets;
    chart.update("none");

    // Draw title + chart (+ optional footnote) onto a new canvas
    const canvas = chart.canvas;
    const scale = window.devicePixelRatio || 1;
    const totalTopPad = Math.round(40 * scale); // space for title

    const showFootnote = showDataLabels === "percentages" && Boolean(footnoteText);
    const footnoteFontSize = Math.round(11 * scale);
    const footnoteLineHeight = Math.round(16 * scale);
    const footnotePadX = Math.round(16 * scale);
    const footnotePadY = Math.round(10 * scale);

    // Measure how many lines the footnote needs (simple word-wrap)
    function wrapText(ctx2, text, maxWidth) {
      const words = text.split(" ");
      const lines = [];
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (ctx2.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    // Temporary canvas just for measuring footnote wrap
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d");
    measureCtx.font = `italic ${footnoteFontSize}px 'Segoe UI', system-ui, sans-serif`;
    const footnoteLines = showFootnote
      ? wrapText(measureCtx, footnoteText, canvas.width - footnotePadX * 2)
      : [];
    const totalBottomPad = showFootnote
      ? footnotePadY + footnoteLines.length * footnoteLineHeight + footnotePadY
      : 0;

    const newCanvas = document.createElement("canvas");
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height + totalTopPad + totalBottomPad;
    const ctx = newCanvas.getContext("2d");

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);

    // Title
    const titleFontSize = Math.round(15 * scale);
    ctx.fillStyle = "#1e293b";
    ctx.font = `700 ${titleFontSize}px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Track Compliance Evolution Over Time", newCanvas.width / 2, totalTopPad / 2);

    // Chart image below the title (datalabels already rendered on canvas as-is)
    ctx.drawImage(canvas, 0, totalTopPad);

    // Footnote below chart
    if (showFootnote) {
      ctx.font = `italic ${footnoteFontSize}px 'Segoe UI', system-ui, sans-serif`;
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const footnoteTop = totalTopPad + canvas.height + footnotePadY;
      footnoteLines.forEach((line, i) => {
        ctx.fillText(line, footnotePadX, footnoteTop + i * footnoteLineHeight);
      });
    }

    const url = newCanvas.toDataURL("image/png", 1);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Trend_${selectedStates.join("_")}.png`;
    a.click();

    // Restore datasets
    chart.data.datasets = originalDatasets;
    chart.update("none");
  }

  // Preload data for ALL states upfront on initial load using datasetCache
  useEffect(() => {
    let cancelled = false;
    async function loadAllStates() {
      setLoading(true); setError("");
      try {
        const states = AVAILABLE_STATES;
        const perStateResults = await Promise.all(
          states.map(async (stateCode) => {
            const periods = datasetsManifest.periodsByState[stateCode] || [];
            const monthResults = await Promise.all(
              periods.map(async (periodEntry) => {
                const data = await loadDataset(stateCode, periodEntry);
                return {
                  key: periodEntry.key,
                  allRecords: data?.allRecords || [],
                  nullRows: data?.nullRows || [],
                  hasSchemaColumn: Boolean(data?.hasSchemaColumn),
                };
              })
            );
            return { stateCode, monthResults };
          })
        );

        if (cancelled) return;
        const nextAll = {}; const nextNull = {}; const nextAvail = {};
        perStateResults.forEach(({ stateCode, monthResults }) => {
          nextAll[stateCode] = {}; nextNull[stateCode] = {}; nextAvail[stateCode] = {};
          monthResults.forEach(m => {
            nextAll[stateCode][m.key] = m.allRecords;
            nextNull[stateCode][m.key] = m.nullRows;
            nextAvail[stateCode][m.key] = m.hasSchemaColumn;
          });
        });
        setStateMonthToAllRecords(nextAll);
        setStateMonthToNullRows(nextNull);
        setStateMonthToSchemaAvailability(nextAvail);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAllStates(); return () => { cancelled = true; };
  }, []);

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
    AVAILABLE_STATES.forEach(s => (stateMonths[s] || []).forEach(m => {
      (stateMonthToAllRecords[s]?.[m] || []).forEach(({ schema }) => schema?.tokens?.forEach(t => {
        tokenSet.add(t); labelsByToken[t] = schema.labels[t] || t; descriptionsByToken[t] = schema.descriptions[t] || "";
      }));
    }));
    return { tokens: sortSchemaTokens(tokenSet), labelsByToken, descriptionsByToken };
  }, [stateMonthToAllRecords, stateMonths]);

  const seriesOptions = useMemo(() => {
    const baseSchema = [
      { key: COMPLIANCE_SERIES.DOES_NOT_HONOR, label: COMPLIANCE_SERIES.DOES_NOT_HONOR, description: COMPLIANCE_DESCRIPTIONS[COMPLIANCE_SERIES.DOES_NOT_HONOR] },
      { key: COMPLIANCE_SERIES.HONORS, label: COMPLIANCE_SERIES.HONORS, description: COMPLIANCE_DESCRIPTIONS[COMPLIANCE_SERIES.HONORS] },
      { key: COMPLIANCE_SERIES.NA_INVALID, label: COMPLIANCE_SERIES.NA_INVALID, description: COMPLIANCE_DESCRIPTIONS[COMPLIANCE_SERIES.NA_INVALID] },
      { key: SPECIAL_SERIES.NULL_SITES, label: SPECIAL_SERIES.NULL_SITES, description: SPECIAL_SERIES_DESCRIPTIONS[SPECIAL_SERIES.NULL_SITES] },
    ];
    return [...baseSchema, ...schemaSeriesMeta.tokens.map(t => ({ key: t, label: schemaSeriesMeta.labelsByToken[t] || t, description: schemaSeriesMeta.descriptionsByToken[t] || "" }))];
  }, [schemaSeriesMeta]);

  function shadeHex(hex, percent) {
    if (!hex || hex[0] !== "#") return hex;
    const h = hex.replace("#", "");
    const num = parseInt(h, 16);
    let r = (num >> 16) & 0xff;
    let g = (num >> 8) & 0xff;
    let b = num & 0xff;
    r = Math.min(255, Math.max(0, Math.round(r * (1 + percent))));
    g = Math.min(255, Math.max(0, Math.round(g * (1 + percent))));
    b = Math.min(255, Math.max(0, Math.round(b * (1 + percent))));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  // True when at least one base status color would be used by two or more
  // of the currently selected lines — the only situation where Rainbowize
  // has anything to do, so the button only shows then.
  const hasColorDuplicates = useMemo(() => {
    const counts = {};
    for (const seriesKey of graphSelectedSeries) {
      const c = baseColorForSeries(seriesKey);
      counts[c] = (counts[c] || 0) + Math.max(1, selectedStates.length);
    }
    return Object.values(counts).some(n => n > 1);
  }, [graphSelectedSeries, selectedStates]);

  const baseDatasets = useMemo(() => {
    if (graphSelectedSeries.length === 0) return [];
    const allDatasets = [];

    // How many lines end up sharing each base status color across the whole
    // selection (base color depends only on the series, not the state) —
    // only used for the non-rainbow gentle same-color shading below.
    const colorUsageCounts = {};
    selectedStates.forEach(() => graphSelectedSeries.forEach(seriesKey => {
      const c = baseColorForSeries(seriesKey);
      colorUsageCounts[c] = (colorUsageCounts[c] || 0) + 1;
    }));
    const useRainbow = rainbowize && hasColorDuplicates;

    const colorSeenCounts = {};
    let lineIndex = 0;

    selectedStates.forEach(stateCode => graphSelectedSeries.forEach(seriesKey => {
      const baseColor = baseColorForSeries(seriesKey);
      const seen = colorSeenCounts[baseColor] ?? 0;
      colorSeenCounts[baseColor] = seen + 1;

      // Color is fixed to status (opted_out green, did_not_opt_out red,
      // invalid/na blue, null gray) regardless of family — point shape
      // (below) carries the family distinction instead. Multiple selected
      // states shade apart more strongly so state comparisons stay readable.
      let color = baseColor;
      if (useRainbow) {
        // Every line — not just repeats — gets recolored in strict
        // ROYGBIV(+pink/black/gray) order, cycling if there are more than
        // 10 lines selected.
        color = RAINBOW_PALETTE[lineIndex % RAINBOW_PALETTE.length];
      } else if (selectedStates.length > 1) {
        const n = selectedStates.length;
        const i = Math.max(0, selectedStates.indexOf(stateCode));
        const spread = n > 1 ? (i / (n - 1)) : 0.5;
        const percent = (spread - 0.5) * 0.6;
        color = shadeHex(baseColor, percent);
      } else {
        const colorTotal = colorUsageCounts[baseColor] ?? 1;
        if (colorTotal > 1) {
          const spread = seen / (colorTotal - 1);
          const percent = (spread - 0.5) * 0.6;
          color = shadeHex(baseColor, percent);
        }
      }
      lineIndex++;

      const isComplianceOrNull =
        seriesKey === SPECIAL_SERIES.PNC_SITES ||
        seriesKey === COMPLIANCE_SERIES.DOES_NOT_HONOR ||
        seriesKey === COMPLIANCE_SERIES.HONORS ||
        seriesKey === COMPLIANCE_SERIES.NA_INVALID ||
        seriesKey === SPECIAL_SERIES.NULL_SITES;

      const schemaFamily = !isComplianceOrNull ? parseSchemaToken(seriesKey)?.family : null;
      let pointStyle = isComplianceOrNull ? "circle" : (POINT_STYLE_BY_FAMILY[schemaFamily] ?? "circle");
      let hoverPointStyle;
      if (schemaFamily === "gpp") {
        const gppSection = gppStateSectionName(parseSchemaToken(seriesKey)?.state);
        const gppShape = getGppStateShapeCanvas(gppSection, color, 12);
        hoverPointStyle = getGppStateShapeCanvas(gppSection, color, 17);
        if (gppShape) pointStyle = gppShape;
      }

      let data = unifiedMonthKeys.map(m => {
        if (seriesKey === SPECIAL_SERIES.PNC_SITES) {
          if (!stateMonthToSchemaAvailability[stateCode]?.[m]) return null;
          return (stateMonthToAllRecords[stateCode]?.[m] || []).filter(r => isSchemaRowNonCompliant(r.schema)).length;
        }

        if (seriesKey === COMPLIANCE_SERIES.DOES_NOT_HONOR) {
          if (!stateMonthToSchemaAvailability[stateCode]?.[m]) return null;
          return (stateMonthToAllRecords[stateCode]?.[m] || []).filter(r => r.schema?.complianceResult === COMPLIANCE_SERIES.DOES_NOT_HONOR).length;
        }
        if (seriesKey === COMPLIANCE_SERIES.HONORS) {
          if (!stateMonthToSchemaAvailability[stateCode]?.[m]) return null;
          return (stateMonthToAllRecords[stateCode]?.[m] || []).filter(r => r.schema?.complianceResult === COMPLIANCE_SERIES.HONORS).length;
        }
        if (seriesKey === COMPLIANCE_SERIES.NA_INVALID) {
          if (!stateMonthToSchemaAvailability[stateCode]?.[m]) return null;
          return (stateMonthToAllRecords[stateCode]?.[m] || []).filter(r => r.schema?.complianceResult === COMPLIANCE_SERIES.NA_INVALID).length;
        }

        if (seriesKey === SPECIAL_SERIES.NULL_SITES) return stateMonthToNullRows[stateCode]?.[m]?.length;
        if (!stateMonthToSchemaAvailability[stateCode]?.[m]) return null;
        return (stateMonthToAllRecords[stateCode]?.[m] || []).filter(r => r.schema.tokens.includes(seriesKey)).length;
      });

      // Denominators for percentage labels:
      // - compliance/null series → total sites for that state/month
      // - schema token series (usps, optanonConsent, wellKnown, gpp) → sites with any token from that family
      const denominators = unifiedMonthKeys.map(m => {
        const allRecs = stateMonthToAllRecords[stateCode]?.[m] || [];
        if (isComplianceOrNull) return allRecs.length;
        if (!schemaFamily) return allRecs.length;
        const targetPrefix = schemaFamily.toLowerCase() + "|";
        return allRecs.filter(r => r.schema?.tokens?.some(t => t.toLowerCase().startsWith(targetPrefix))).length;
      });

      allDatasets.push({
        label: `${stateCode} - ${seriesOptions.find(o => o.key === seriesKey)?.label || seriesKey}`,
        data, borderColor: color, backgroundColor: chartType === "line" ? color : `${color}80`,
        // Set explicitly (rather than relying on Chart.js's default point-
        // color inheritance) so both built-in shapes and the legend swatch
        // always reflect this line's current color — status-based or, with
        // Rainbowize on, its rainbow hue — the instant it's computed above.
        pointBackgroundColor: color, pointBorderColor: color,
        // Explicit (matches Chart.js's own line/bar defaults) rather than
        // left unset, so the legend-hover memo below always has a concrete
        // value to reset to — an unset key risks react-chartjs-2 leaving a
        // stale hover-time value in place instead of clearing it.
        borderWidth: chartType === "bar" ? 0 : 3,
        fill: false, tension: 0.3, pointRadius: 5, pointHoverRadius: 7,
        pointStyle,
        borderRadius: chartType === "bar" ? { topLeft: 8, topRight: 8 } : 0,
        spanGaps: true,
        _denominators: denominators,
        // Larger canvas variant of this line's point shape, used only while
        // this exact line is the one being hovered in the legend — custom
        // canvas shapes ignore pointRadius, so enlarging them on hover needs
        // an actual bigger pre-rendered image, not just a radius bump.
        _hoverPointStyle: hoverPointStyle,
      });
    }));
    return allDatasets;
  }, [chartType, graphSelectedSeries, hasColorDuplicates, rainbowize, selectedStates, seriesOptions, stateMonthToAllRecords, stateMonthToNullRows, stateMonthToSchemaAvailability, unifiedMonthKeys]);

  // Re-skins baseDatasets for the currently hovered legend item — computed
  // as plain derived state (not by mutating the Chart.js instance directly)
  // so react-chartjs-2's normal prop-diffing update path applies it, the
  // same reliable path that renders the chart from scratch.
  const datasets = useMemo(() => {
    if (hoveredDatasetIndex === null) return baseDatasets;
    const isLine = chartType === "line";
    return baseDatasets.map((ds, i) => {
      const baseColor = ds.borderColor.length > 7 ? ds.borderColor.slice(0, 7) : ds.borderColor;
      if (i === hoveredDatasetIndex) {
        return {
          ...ds,
          borderWidth: isLine ? 4 : ds.borderWidth,
          borderColor: baseColor,
          backgroundColor: baseColor,
          pointBackgroundColor: baseColor,
          pointBorderColor: baseColor,
          pointRadius: isLine ? 7 : ds.pointRadius,
          pointStyle: isLine ? (ds._hoverPointStyle || ds.pointStyle) : ds.pointStyle,
        };
      }
      // Other lines just go thin and faded, not fully invisible — points
      // keep their real shape/color/size so the chart still reads as "every
      // line is here, just dimmed" rather than lines dropping out.
      return {
        ...ds,
        borderWidth: isLine ? 2 : ds.borderWidth,
        borderColor: baseColor + "40",
        backgroundColor: baseColor + "30",
      };
    });
  }, [baseDatasets, hoveredDatasetIndex, chartType]);

  const options = useMemo(() => ({
    responsive: true, maintainAspectRatio: false, normalized: true, customType: chartType,
    // Chart.js animates color/point changes between updates by default,
    // which turned the legend-hover isolate effect into a fade. Disabling
    // animation entirely makes every update — including that one — instant.
    animation: false,
    layout: { padding: { top: 10, bottom: 10, left: 10, right: 20 } },
    plugins: {
      datalabels: {
        // The legend-hover isolate effect below hides a dataset by appending
        // a fully-transparent alpha suffix to its border color (making it 9
        // chars, "#rrggbb00", instead of the normal 7-char "#rrggbb") —
        // datalabels draws independently of the point/line's own opacity
        // though, so without this check its number/percentage callouts
        // would keep floating over an otherwise-invisible line. Checking
        // length (not the literal "00" suffix) avoids false-hiding a
        // legitimately black "#000000" line, e.g. from Rainbowize.
        display: (ctx) =>
          showDataLabels !== "off" &&
          !(typeof ctx.dataset.borderColor === "string" && ctx.dataset.borderColor.length > 7),
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        borderRadius: 4,
        color: (ctx) => {
          const border = ctx.dataset.borderColor;
          if (typeof border === "string" && border.startsWith("#")) {
            return shadeHex(border.slice(0, 7), -0.45);
          }
          return "#0f172a";
        },
        font: { weight: "bold", size: 10 },
        formatter: (val, ctx) => {
          if (!val || val <= 0) return "";
          if (showDataLabels === "counts") return val.toLocaleString();
          if (showDataLabels === "percentages") {
            const denom = ctx.dataset._denominators?.[ctx.dataIndex];
            if (!denom) return "";
            return ((val / denom) * 100).toFixed(1) + "%";
          }
          return "";
        },
        padding: 4,
        offset: 8,
        anchor: "end",
        align: "top",
      },
      legend: {
        position: "bottom",
        // Isolating the hovered line is done by recomputing `datasets` as
        // React state (see hoveredDatasetIndex / the datasets useMemo
        // above) rather than mutating the Chart.js instance here, so these
        // just record which legend item is hovered.
        onHover: (evt, item) => setHoveredDatasetIndex(item.datasetIndex),
        onLeave: () => setHoveredDatasetIndex(null),
        labels: {
          boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 12,
          font: { size: 11, family: "'Segoe UI', sans-serif", weight: "500" }, color: "#475569",
          // The chart's own `datasets` prop goes fully transparent for every
          // line but the hovered one (see the datasets useMemo above), so
          // legend swatches built from it would also vanish. Building
          // labels from baseDatasets instead — each line's real, un-hovered
          // color/shape — keeps every legend icon visible no matter which
          // line is currently isolated on the chart.
          generateLabels: () => baseDatasets.map((ds, i) => ({
            text: ds.label,
            fillStyle: ds.backgroundColor,
            strokeStyle: ds.borderColor,
            lineWidth: 1,
            pointStyle: ds.pointStyle,
            datasetIndex: i,
          })),
        },
      },
      tooltip: {
        // intersect: false means hovering anywhere above a month's
        // x-position shows that month's tooltip for every series, not just
        // when the cursor is exactly touching a line/point.
        mode: "index", intersect: false, backgroundColor: "rgba(15, 23, 42, 0.9)", padding: 12,
        titleFont: { size: 14, weight: "700" }, bodyFont: { size: 13 }, cornerRadius: 8, usePointStyle: true,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y;
            const label = ctx.dataset.label ?? "";
            if (val == null) return `${label}: —`;
            if (showDataLabels === "percentages") {
              const denom = ctx.dataset._denominators?.[ctx.dataIndex];
              if (denom) {
                const pct = ((val / denom) * 100).toFixed(1);
                return `${label}: ${pct}% (${val.toLocaleString()} out of ${denom.toLocaleString()})`;
              }
            }
            return `${label}: ${val.toLocaleString()}`;
          },
        },
      },
      title: { display: false, text: "Schema classification trends over months", font: { size: 15, weight: "700" }, color: "#1e293b", padding: { bottom: 20 } },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: "rgba(0, 0, 0, 0.05)", drawBorder: false }, border: { display: false }, ticks: { font: { size: 12 }, color: "#64748b" }, title: { display: true, text: "Number of Sites", font: { size: 12, weight: "600" }, color: "#475569" } },
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 12 }, color: "#64748b" }, title: { display: true, text: "Month", font: { size: 12, weight: "600" }, color: "#475569" } },
    },
  }), [baseDatasets, chartType, showDataLabels]);

  const activeSeries = viewMode === "table" ? tableSelectedSeries : graphSelectedSeries;
  const setActiveSeries = viewMode === "table" ? setTableSelectedSeries : setGraphSelectedSeries;

  return (
    <div className="card card--padded section">
      <div id="section-trends" style={{ display: activeChart === "trends" || viewMode === "table" ? "block" : "none" }}>
        <div style={{ display: "flex", flexDirection: "row", gap: "20px", alignItems: "flex-start" }}>

          {/* LEFT SIDE: chart/table content */}
          <div style={{ flex: "1", minWidth: 0 }}>
            {viewMode === "graph" ? (
              <>
                <h2 className="section-title" style={{ marginTop: 0 }}>Track Compliance Evolution Over Time</h2>
                <div className="toolbar" style={{ marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "16px" }}>
                  <div className="toolbar-item-group" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div className="chip-group">
                      <button
                        className="chip"
                        disabled={activeChart === "trends" && chartType === "line"}
                        style={activeChart === "trends" && chartType === "line" ? { opacity: 0.55, cursor: "default" } : undefined}
                        onClick={() => {
                          setChartType("line");
                          setActiveChart("trends");
                        }}
                      >
                        Line
                      </button>
                      <button
                        className="chip"
                        disabled={activeChart === "trends" && chartType === "bar"}
                        style={activeChart === "trends" && chartType === "bar" ? { opacity: 0.55, cursor: "default" } : undefined}
                        onClick={() => {
                          setChartType("bar");
                          setActiveChart("trends");
                        }}
                      >
                        Bar
                      </button>
                    </div>
                  </div>
                  <div className="toolbar-item-group" style={{ display: "flex", alignItems: "center", gap: "8px", borderLeft: "1px solid #e2e8f0", paddingLeft: "16px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "#475569" }}>States:</span>
                    <div className="chip-group">
                      {AVAILABLE_STATES.map(s => {
                        const active = selectedStates.includes(s);
                        return <button key={s} className={`chip${active ? " chip--active" : ""}`} style={{ padding: "4px 12px", fontSize: "12px" }} onClick={() => setSelectedStates(prev => prev.includes(s) ? prev.filter(v => v !== s) : [...prev, s])}>{s}</button>;
                      })}
                    </div>
                  </div>
                </div>

                {loading && <div style={{ padding: 8 }}>Loading chart data...</div>}
                {error && <div style={{ padding: 8, color: "#b00020" }}>Error: {error}</div>}
                {!loading && !error && selectedStates.length > 0 && (
                  <>
                    <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#94a3b8", fontStyle: "italic" }}>
                      Hover over the legend to isolate an individual line.
                    </p>
                    <div className="chart-area" onMouseLeave={() => setHoveredDatasetIndex(null)}>
                      {chartType === "line" ? (
                        <Line
                          ref={chartRef}
                          data={{ labels, datasets }}
                          options={options}
                          aria-label="Line chart showing schema classification trends over months"
                        />
                      ) : (
                        <Bar
                          ref={chartRef}
                          data={{ labels, datasets }}
                          options={options}
                          aria-label="Bar chart showing schema classification trends over months"
                        />
                      )}
                    </div>
                    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "14px", fontWeight: "500", color: "#475569" }}>Labels:</span>
                          <div className="chip-group">
                            {[
                              { value: "off", label: "Off" },
                              { value: "counts", label: "Counts" },
                              { value: "percentages", label: "Percentages" },
                            ].map(({ value, label }) => {
                              const isActive = showDataLabels === value;
                              return (
                                <button
                                  key={value}
                                  className={`chip${isActive ? " chip--active" : ""}`}
                                  style={{
                                    padding: "4px 12px",
                                    fontSize: "12px",
                                    backgroundColor: isActive ? "#0f172a" : undefined,
                                    color: isActive ? "#ffffff" : undefined,
                                    borderColor: isActive ? "#0f172a" : undefined,
                                    fontWeight: isActive ? "600" : "400",
                                  }}
                                  onClick={() => setShowDataLabels(value)}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {hasColorDuplicates && (
                          <button
                            type="button"
                            className={`chip${rainbowize ? " chip--active" : ""}`}
                            style={{
                              padding: "4px 12px",
                              fontSize: "12px",
                              fontWeight: rainbowize ? "600" : "400",
                              ...(rainbowize
                                ? {
                                    color: "#ffffff",
                                    borderColor: "transparent",
                                    background:
                                      "linear-gradient(90deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)",
                                  }
                                : {}),
                            }}
                            aria-pressed={rainbowize}
                            title={
                              rainbowize
                                ? "Click to go back to status colors"
                                : "Click to recolor every line in ROYGBIV order (plus pink/black/gray) so they're all distinct"
                            }
                            onClick={() => setRainbowize((v) => !v)}
                          >
                            🌈 Rainbowize
                          </button>
                        )}
                        <button className="btn-download" onClick={handleDownload}>Download PNG</button>
                      </div>
                      {showDataLabels === "percentages" && footnoteText && (
                        <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>
                          {footnoteText}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              tableContent
            )}
          </div>

          {/* RIGHT SIDE: Filters */}
          <div
            style={{
              flex: "0 0 350px",
            }}
          >
            <ChartSchemaFilterPanel
              seriesOptions={seriesOptions}
              selectedSeries={activeSeries}
              selectedStates={
                viewMode === "table" && tableSelectedState
                  ? [tableSelectedState]
                  : selectedStates
              }
              onToggle={k => {
                setActiveSeries(prev => {
                  if (viewMode === "table" && MUTUALLY_EXCLUSIVE_SERIES.has(k) && !prev.includes(k)) {
                    return [...prev.filter(s => !MUTUALLY_EXCLUSIVE_SERIES.has(s)), k];
                  }
                  return prev.includes(k) ? prev.filter(s => s !== k) : [...prev, k];
                });
                if (viewMode === "table") {
                  setCurrentPage?.(1);
                }
              }}
              viewMode={viewMode}
              expandedCategories={expandedCategories}
              setExpandedCategories={setExpandedCategories}
            />
          </div>

        </div>
      </div>

      <div id="section-gpp" style={{ display: activeChart === "gpp" && viewMode === "graph" ? "block" : "none", marginTop: "15px" }}>
        {gppSection}
      </div>
    </div>
  );
});

export default ReasonTrendsChart;