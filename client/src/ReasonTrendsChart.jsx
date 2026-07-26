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
import { loadDataset, datasetCache } from "./utils/datasetCache.js";
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

const AVAILABLE_STATES = datasetsManifest.states || ["CA", "CT", "CO", "NJ"];

const ReasonTrendsChart = memo(function ReasonTrendsChart({
  viewMode,
  tableContent,
  timePeriods,
  stateMonths,
  selectedSeries,
  setSelectedSeries,
  selectedStates,
  setSelectedStates,
  chartType,
  setChartType,
  activeChart,
  setActiveChart,
  gppSection,
  setCurrentPage,
}) {
  const [stateMonthToAllRecords, setStateMonthToAllRecords] = useState({});
  const [stateMonthToNullRows, setStateMonthToNullRows] = useState({});
  const [stateMonthToSchemaAvailability, setStateMonthToSchemaAvailability] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDataLabels, setShowDataLabels] = useState(false);
  const chartRef = useRef(null);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current._isolatedIndices = null;
    }
  }, [selectedSeries, selectedStates, chartType]);

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
    a.download = `Trend_${selectedStates.join("_")}.png`;
    a.click();

    chart.data.datasets = originalDatasets;
    chart.update("none");
  }

  useEffect(() => {
    setSelectedSeries(prev => {
      const specials = prev.filter(k => k === COMPLIANCE_SERIES.DOES_NOT_HONOR || k === COMPLIANCE_SERIES.HONORS || k === COMPLIANCE_SERIES.NA_INVALID || k === SPECIAL_SERIES.NULL_SITES);
      return specials.length > 0 ? specials : [COMPLIANCE_SERIES.DOES_NOT_HONOR];
    });
  }, []);

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

  const datasets = useMemo(() => {
    if (selectedSeries.length === 0) return [];
    const allDatasets = []; const statusVarCounters = {};
    const colorUsageCounts = {};
    selectedStates.forEach(s => selectedSeries.forEach(sk => {
      let c;
      if (sk === SPECIAL_SERIES.PNC_SITES) c = getColorForSeries(SPECIAL_SERIES.PNC_SITES);
      else if (sk === COMPLIANCE_SERIES.DOES_NOT_HONOR) c = "#ef4444";
      else if (sk === COMPLIANCE_SERIES.HONORS) c = "#22c55e";
      else if (sk === COMPLIANCE_SERIES.NA_INVALID) c = "#94a3b8";
      else if (sk === SPECIAL_SERIES.NULL_SITES) c = getColorForSeries(SPECIAL_SERIES.NULL_SITES);
      else {
        const statusKey = parseSchemaToken(sk)?.status ?? "__legacy";
        const palette = STATUS_COLOR_PALETTES[statusKey] ?? LEGACY_COLOR_PALETTE;
        c = palette[0];
      }
      colorUsageCounts[c] = (colorUsageCounts[c] || 0) + 1;
    }));

    const colorIndexCounters = {};
    selectedStates.forEach(stateCode => selectedSeries.forEach(seriesKey => {
      let baseColor;
      if (seriesKey === SPECIAL_SERIES.PNC_SITES) baseColor = getColorForSeries(SPECIAL_SERIES.PNC_SITES);
      else if (seriesKey === COMPLIANCE_SERIES.DOES_NOT_HONOR) baseColor = "#ef4444";
      else if (seriesKey === COMPLIANCE_SERIES.HONORS) baseColor = "#22c55e";
      else if (seriesKey === COMPLIANCE_SERIES.NA_INVALID) baseColor = "#94a3b8";
      else if (seriesKey === SPECIAL_SERIES.NULL_SITES) baseColor = getColorForSeries(SPECIAL_SERIES.NULL_SITES);
      else {
        const statusKey = parseSchemaToken(seriesKey)?.status ?? "__legacy";
        const palette = STATUS_COLOR_PALETTES[statusKey] ?? LEGACY_COLOR_PALETTE;
        const idx = statusVarCounters[statusKey] ?? 0;
        statusVarCounters[statusKey] = idx + 1;
        baseColor = palette[0];
      }

      let color = baseColor;
      const colorIdx = colorIndexCounters[baseColor] ?? 0;
      colorIndexCounters[baseColor] = colorIdx + 1;
      const colorTotal = colorUsageCounts[baseColor] ?? 1;
      if (selectedStates.length > 1) {
        const n = selectedStates.length;
        const i = Math.max(0, selectedStates.indexOf(stateCode));
        const spread = n > 1 ? (i / (n - 1)) : 0.5;
        const percent = (spread - 0.5) * 0.6;
        color = shadeHex(baseColor, percent);
      } else if (colorTotal > 1) {
        const spread = colorIdx / (colorTotal - 1);
        const percent = (spread - 0.5) * 0.6;
        color = shadeHex(baseColor, percent);
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
      allDatasets.push({
        label: `${stateCode} - ${seriesOptions.find(o => o.key === seriesKey)?.label || seriesKey}`,
        data, borderColor: color, backgroundColor: chartType === "line" ? color : `${color}80`,
        fill: false, tension: 0.3, pointRadius: 4, pointHoverRadius: 6,
        borderRadius: chartType === "bar" ? { topLeft: 8, topRight: 8 } : 0,
        spanGaps: true,
      });
    }));
    return allDatasets;
  }, [chartType, selectedSeries, selectedStates, seriesOptions, stateMonthToAllRecords, stateMonthToNullRows, stateMonthToSchemaAvailability, unifiedMonthKeys]);

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
      title: { display: true, text: "Schema classification trends over months", font: { size: 15, weight: "700" }, color: "#1e293b", padding: { bottom: 20 } },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: "rgba(0, 0, 0, 0.05)", drawBorder: false }, border: { display: false }, ticks: { font: { size: 12 }, color: "#64748b" }, title: { display: true, text: "Number of Sites", font: { size: 12, weight: "600" }, color: "#475569" } },
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 12 }, color: "#64748b" }, title: { display: true, text: "Month", font: { size: 12, weight: "600" }, color: "#475569" } },
    },
  }), [chartType, showDataLabels]);

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
                    <div className="chart-area">
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
              </>
            ) : (
              tableContent
            )}
          </div>

          {/* RIGHT SIDE: Filters */}
          <div
            style={{
              flex: "0 0 350px",
              position: "sticky",
              top: "20px",
              maxHeight: "calc(100vh - 40px)",
              overflowY: "auto",
            }}
          >
            <ChartSchemaFilterPanel
              seriesOptions={seriesOptions}
              selectedSeries={selectedSeries}
              selectedStates={selectedStates}
              onToggle={k => {
                setSelectedSeries(prev => prev.includes(k) ? prev.filter(s => s !== k) : [...prev, k]);
                setCurrentPage?.(1);
              }}
              viewMode={viewMode}
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