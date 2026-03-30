import { useEffect, useMemo, useState } from "react";
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
  ChartTooltip
);

// ── Semantic color palettes keyed by compliance status ────────────────────────
// Each palette has several shades so multiple same-status series stay distinct.
const STATUS_COLOR_PALETTES = {
  // Opted out → greens (compliant ✔)
  opted_out: [
    "#15803d", // rich forest green
    "#16a34a", // medium green
    "#166534", // dark pine
    "#4ade80", // mint
    "#059669", // emerald
    "#22c55e", // bright green
  ],
  // Did not opt out → reds (non-compliant ✘)
  did_not_opt_out: [
    "#dc2626", // vivid red
    "#b91c1c", // deep red
    "#991b1b", // dark burgundy
    "#ef4444", // bright red
    "#e11d48", // rose red
    "#f43f5e", // pink-red
  ],
  // Invalid / missing → ambers (warning ⚠️)
  invalid_missing: [
    "#d97706", // rich amber
    "#b45309", // dark amber
    "#f59e0b", // gold amber
    "#92400e", // brown-amber
    "#fbbf24", // bright yellow-amber
  ],
  invalid: [
    "#ea580c", // burnt orange
    "#c2410c", // dark orange
    "#f97316", // bright orange
    "#9a3412", // deep sienna
  ],
  // Not applicable → greys (neutral)
  not_applicable: [
    "#64748b", // slate
    "#6b7280", // neutral grey
    "#475569", // dark slate
    "#94a3b8", // light slate
    "#334155", // very dark slate
  ],
};

// Legacy reason series (non-schema mode) keep the original green-ish palette
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
  [SPECIAL_SERIES.PNC_SITES]:
    "Counts rows in the PotentiallyNonCompliantSites dataset for each month.",
  [SPECIAL_SERIES.NULL_SITES]:
    "Counts rows in the NullSites dataset for each month.",
};

const PNC_REASON_LIST = [
  "Invalid_uspapi",
  "Invalid_usp_cookies",
  "uspapi",
  "usp_cookies",
  "MissingAfter_uspapi",
  "MissingAfter_usp_cookies",
  "Invalid_GPPString",
  "SaleOptOut_USNAT",
  "SharingOptOut_USNAT",
  "TargetedAdvertisingOptOut_USNAT",
  "SaleOptOut_State",
  "SharingOptOut_State",
  "TargetedAdvertisingOptOut_State",
  "MissingAfterGPPString",
  "Invalid_OptanonConsent",
  "OptanonConsent",
  "MissingAfterOptanonConsent",
  "Well-Known",
  "Invalid_Well-Known",
  "SegmentSwitchGPP",
];

const AVAILABLE_STATES = ["CA", "CT", "CO", "NJ"];

function parseReasons(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const str = String(value).trim();
  const jsonLike = str
    .replace(/^\s*\[\s*/, "[")
    .replace(/\s*\]\s*$/, "]")
    .replace(/'\s*,\s*'/g, '","')
    .replace(/^\['/, '["')
    .replace(/'\]$/, '"]')
    .replace(/'/g, '"');
  try {
    const parsed = JSON.parse(jsonLike);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Fall back to the simple split below.
  }
  return str
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.replace(/^[\s'"]+|[\s'"]+$/g, "").trim())
    .filter(Boolean);
}

function normalizeRow(row) {
  const normalized = {};
  Object.keys(row || {}).forEach((key) => {
    normalized[String(key).trim()] = row[key];
  });
  return normalized;
}

function parseCsv(publicCsvPath) {
  return new Promise((resolve, reject) => {
    Papa.parse(publicCsvPath, {
      download: true,
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (parsed) => {
        resolve({
          headers: (parsed.meta?.fields || []).map((field) => String(field).trim()),
          rows: (parsed.data || []).map(normalizeRow),
        });
      },
      error: (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
}

export default function ReasonTrendsChart({
  analysisMode,
  timePeriods,
  stateMonths,
}) {
  const [selectedSeries, setSelectedSeries] = useState([]);
  const [chartType, setChartType] = useState("line");
  const [stateMonthToAllRecords, setStateMonthToAllRecords] = useState({});
  const [stateMonthToPncRows, setStateMonthToPncRows] = useState({});
  const [stateMonthToNullRows, setStateMonthToNullRows] = useState({});
  const [stateMonthToSchemaAvailability, setStateMonthToSchemaAvailability] =
    useState({});
  const [schemaParseErrorCount, setSchemaParseErrorCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedStates, setSelectedStates] = useState(["CA"]);
  const [reasonDescriptions, setReasonDescriptions] = useState({});

  useEffect(() => {
    let cancelled = false;

    fetch("/classifications_of_compliance.json")
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(
              new Error("Failed to load classifications_of_compliance.json")
            )
      )
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          setReasonDescriptions(data);
        }
      })
      .catch((err) => {
        console.warn("Failed to load reason descriptions:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedSeries([]);
  }, [analysisMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedStates() {
      setLoading(true);
      setError("");

      try {
        const states = Array.isArray(selectedStates) ? selectedStates : [];
        if (states.length === 0) {
          setStateMonthToAllRecords({});
          setStateMonthToPncRows({});
          setStateMonthToNullRows({});
          setStateMonthToSchemaAvailability({});
          setSchemaParseErrorCount(0);
          setLoading(false);
          return;
        }

        const perStateResults = await Promise.all(
          states.map(async (stateCode) => {
            const monthKeys = (stateMonths && stateMonths[stateCode]) || [];
            const monthResults = await Promise.all(
              monthKeys.map(async (monthKey) => {
                const allPath = `/${stateCode}/Crawl_Data_${stateCode} - ${monthKey}.csv`;
                const pncPath = `/${stateCode}/Crawl_Data_${stateCode} - PotentiallyNonCompliantSites${monthKey}.csv`;
                const nullPath = `/${stateCode}/Crawl_Data_${stateCode} - NullSites${monthKey}.csv`;

                const [allData, pncData, nullData] = await Promise.all([
                  parseCsv(allPath),
                  parseCsv(pncPath),
                  parseCsv(nullPath),
                ]);

                const hasSchemaColumn = allData.headers.includes(
                  SCHEMA_CLASSIFICATION_COLUMN
                );
                const allRecords = allData.rows.map((row) => ({
                  row,
                  schema: getSchemaClassificationForRow(row),
                }));
                const parseErrors = hasSchemaColumn
                  ? allRecords.reduce(
                      (count, record) =>
                        count + (record.schema.parseError ? 1 : 0),
                      0
                    )
                  : 0;

                return {
                  key: monthKey,
                  allRecords,
                  pncRows: pncData.rows,
                  nullRows: nullData.rows,
                  hasSchemaColumn,
                  parseErrors,
                };
              })
            );

            return { stateCode, monthResults };
          })
        );

        if (cancelled) return;

        const nextAllRecords = {};
        const nextPncRows = {};
        const nextNullRows = {};
        const nextSchemaAvailability = {};
        let nextParseErrorCount = 0;

        perStateResults.forEach(({ stateCode, monthResults }) => {
          nextAllRecords[stateCode] = {};
          nextPncRows[stateCode] = {};
          nextNullRows[stateCode] = {};
          nextSchemaAvailability[stateCode] = {};

          monthResults.forEach(
            ({
              key,
              allRecords,
              pncRows,
              nullRows,
              hasSchemaColumn,
              parseErrors,
            }) => {
              nextAllRecords[stateCode][key] = allRecords;
              nextPncRows[stateCode][key] = pncRows;
              nextNullRows[stateCode][key] = nullRows;
              nextSchemaAvailability[stateCode][key] = hasSchemaColumn;
              nextParseErrorCount += parseErrors;
            }
          );
        });

        setStateMonthToAllRecords(nextAllRecords);
        setStateMonthToPncRows(nextPncRows);
        setStateMonthToNullRows(nextNullRows);
        setStateMonthToSchemaAvailability(nextSchemaAvailability);
        setSchemaParseErrorCount(nextParseErrorCount);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSelectedStates();

    return () => {
      cancelled = true;
    };
  }, [selectedStates, stateMonths]);

  const unifiedMonthKeys = useMemo(() => {
    const states = Array.isArray(selectedStates) ? selectedStates : [];
    if (!Array.isArray(timePeriods) || timePeriods.length === 0) return [];
    if (states.length === 0) return timePeriods.map((period) => period.key);

    const keySet = new Set();
    states.forEach((stateCode) => {
      const keys = (stateMonths && stateMonths[stateCode]) || [];
      keys.forEach((key) => keySet.add(key));
    });

    return timePeriods
      .filter((period) => keySet.has(period.key))
      .map((period) => period.key);
  }, [selectedStates, stateMonths, timePeriods]);

  const labels = useMemo(() => {
    const keyToLabel = new Map(
      (timePeriods || []).map((period) => [period.key, period.label])
    );
    return unifiedMonthKeys.map((key) => keyToLabel.get(key) || key);
  }, [timePeriods, unifiedMonthKeys]);

  const schemaSeriesMeta = useMemo(() => {
    const labelsByToken = {};
    const descriptionsByToken = {};
    const tokenSet = new Set();

    selectedStates.forEach((stateCode) => {
      unifiedMonthKeys.forEach((monthKey) => {
        const records = stateMonthToAllRecords[stateCode]?.[monthKey] || [];
        records.forEach(({ schema }) => {
          schema.tokens.forEach((token) => {
            tokenSet.add(token);
            labelsByToken[token] = schema.labels[token] || token;
            descriptionsByToken[token] = schema.descriptions[token] || "";
          });
        });
      });
    });

    const tokens = sortSchemaTokens(tokenSet);
    return { tokens, labelsByToken, descriptionsByToken };
  }, [selectedStates, stateMonthToAllRecords, unifiedMonthKeys]);

  const schemaModeAvailable = useMemo(() => {
    return selectedStates.some((stateCode) =>
      unifiedMonthKeys.some(
        (monthKey) => stateMonthToSchemaAvailability[stateCode]?.[monthKey]
      )
    );
  }, [selectedStates, stateMonthToSchemaAvailability, unifiedMonthKeys]);

  const seriesOptions = useMemo(() => {
    const base = [
      {
        key: SPECIAL_SERIES.PNC_SITES,
        label: SPECIAL_SERIES.PNC_SITES,
        description: SPECIAL_SERIES_DESCRIPTIONS[SPECIAL_SERIES.PNC_SITES],
      },
      {
        key: SPECIAL_SERIES.NULL_SITES,
        label: SPECIAL_SERIES.NULL_SITES,
        description: SPECIAL_SERIES_DESCRIPTIONS[SPECIAL_SERIES.NULL_SITES],
      },
    ];

    if (analysisMode === ANALYSIS_MODES.SCHEMA) {
      return [
        ...base,
        ...schemaSeriesMeta.tokens.map((token) => ({
          key: token,
          label: schemaSeriesMeta.labelsByToken[token] || token,
          description: schemaSeriesMeta.descriptionsByToken[token] || "",
        })),
      ];
    }

    return [
      ...base,
      ...PNC_REASON_LIST.map((reason) => ({
        key: reason,
        label: reason,
        description: reasonDescriptions[reason] || "",
      })),
    ];
  }, [analysisMode, reasonDescriptions, schemaSeriesMeta]);

  useEffect(() => {
    const optionKeys = new Set(seriesOptions.map((option) => option.key));
    setSelectedSeries((previous) =>
      previous.filter((value) => optionKeys.has(value))
    );
  }, [seriesOptions]);

  const datasets = useMemo(() => {
    if (selectedSeries.length === 0) return [];

    const allDatasets = [];
    const activeStates =
      selectedStates && selectedStates.length > 0 ? selectedStates : [];

    // Track how many times each status group has been used so successive
    // same-status series cycle through different shades within their palette.
    const statusVarCounters = {};

    activeStates.forEach((stateCode) => {
      selectedSeries.forEach((seriesKey) => {
        // ── Semantic color assignment ──────────────────────────────────────
        let color;
        if (seriesKey === SPECIAL_SERIES.PNC_SITES) {
          // Always a punchy warning red — distinct from the did_not_opt_out palette
          color = "#c2410c";
        } else if (seriesKey === SPECIAL_SERIES.NULL_SITES) {
          color = "#94a3b8"; // light slate grey
        } else {
          const parsed = parseSchemaToken(seriesKey);
          const statusKey = parsed?.status ?? "__legacy";
          const palette =
            STATUS_COLOR_PALETTES[statusKey] ?? LEGACY_COLOR_PALETTE;
          const idx = statusVarCounters[statusKey] ?? 0;
          statusVarCounters[statusKey] = idx + 1;
          color = palette[idx % palette.length];
        }
        // ──────────────────────────────────────────────────────────────────

        let data;

        if (seriesKey === SPECIAL_SERIES.PNC_SITES) {
          data = unifiedMonthKeys.map((monthKey) => {
            const rows = stateMonthToPncRows[stateCode]?.[monthKey];
            return Array.isArray(rows) ? rows.length : null;
          });
        } else if (seriesKey === SPECIAL_SERIES.NULL_SITES) {
          data = unifiedMonthKeys.map((monthKey) => {
            const rows = stateMonthToNullRows[stateCode]?.[monthKey];
            return Array.isArray(rows) ? rows.length : null;
          });
        } else if (analysisMode === ANALYSIS_MODES.SCHEMA) {
          data = unifiedMonthKeys.map((monthKey) => {
            const hasSchemaColumn =
              stateMonthToSchemaAvailability[stateCode]?.[monthKey];
            if (!hasSchemaColumn) return null;

            const records = stateMonthToAllRecords[stateCode]?.[monthKey];
            if (!Array.isArray(records)) return null;

            let count = 0;
            records.forEach(({ schema }) => {
              if (schema.tokens.includes(seriesKey)) {
                count += 1;
              }
            });
            return count;
          });
        } else {
          data = unifiedMonthKeys.map((monthKey) => {
            const rows = stateMonthToPncRows[stateCode]?.[monthKey];
            if (!Array.isArray(rows)) return null;

            let count = 0;
            rows.forEach((row) => {
              const reasons = parseReasons(row?.Reasons_Non_Compliant);
              if (reasons.includes(seriesKey)) {
                count += 1;
              }
            });
            return count;
          });
        }

        const seriesOption = seriesOptions.find(
          (option) => option.key === seriesKey
        );

        allDatasets.push({
          label: `${stateCode} - ${seriesOption?.label || seriesKey}`,
          data,
          borderColor: color,
          backgroundColor: chartType === "line" ? color : `${color}80`,
          fill: false,
        });
      });
    });

    return allDatasets;
  }, [
    analysisMode,
    chartType,
    selectedSeries,
    selectedStates,
    seriesOptions,
    stateMonthToAllRecords,
    stateMonthToNullRows,
    stateMonthToPncRows,
    stateMonthToSchemaAvailability,
    unifiedMonthKeys,
  ]);

  const data = useMemo(
    () => ({
      labels,
      datasets,
    }),
    [datasets, labels]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          mode: "nearest",
          intersect: true,
        },
        title: {
          display: true,
          text:
            analysisMode === ANALYSIS_MODES.SCHEMA
              ? "Schema classification trends over months"
              : "Reason trends over months",
        },
      },
      scales: {
        y: {
          title: { display: true, text: "Number of Sites" },
          beginAtZero: true,
        },
        x: {
          title: { display: true, text: "Month" },
        },
      },
    }),
    [analysisMode]
  );

  return (
    <div className="card card--padded section">
      <h2 className="section-title">Track Compliance Evolution Over Time</h2>
      <div className="toolbar" role="group" aria-label="Chart display options">
        <label htmlFor="chart-type-select">Chart Type:</label>
        <select
          id="chart-type-select"
          value={chartType}
          onChange={(e) => setChartType(e.target.value)}
        >
          <option value="line">Line</option>
          <option value="bar">Bar</option>
        </select>
      </div>

      <div className="chip-group" role="group" aria-label="States">
        {AVAILABLE_STATES.map((stateCode) => {
          const active = selectedStates.includes(stateCode);
          return (
            <button
              key={stateCode}
              className={`chip${active ? " chip--active" : ""}`}
              onClick={() =>
                setSelectedStates((prev) =>
                  prev.includes(stateCode)
                    ? prev.filter((value) => value !== stateCode)
                    : [...prev, stateCode]
                )
              }
            >
              {stateCode}
            </button>
          );
        })}
      </div>

      {analysisMode === ANALYSIS_MODES.SCHEMA && schemaParseErrorCount > 0 && (
        <div className="notice-card notice-card--warning" role="status">
          Ignored invalid schema classifications in {schemaParseErrorCount} row
          {schemaParseErrorCount === 1 ? "" : "s"} while building chart
          datasets.
        </div>
      )}

      {/* Chart Schema/Reason Filters (hierarchical panel) */}
      <ChartSchemaFilterPanel
        seriesOptions={seriesOptions}
        selectedSeries={selectedSeries}
        selectedStates={selectedStates}
        onToggle={(key) =>
          setSelectedSeries((prev) =>
            prev.includes(key)
              ? prev.filter((k) => k !== key)
              : [...prev, key]
          )
        }
        isSchemaMode={analysisMode === ANALYSIS_MODES.SCHEMA}
      />

      {loading && <div style={{ padding: 8 }}>Loading chart data...</div>}
      {error && (
        <div style={{ padding: 8, color: "#b00020" }}>
          Error loading chart data: {error}
        </div>
      )}
      {!loading && !error && selectedStates.length === 0 && (
        <div style={{ padding: 8 }}>Select one or more states to view the chart.</div>
      )}
      {!loading &&
        !error &&
        selectedStates.length > 0 &&
        analysisMode === ANALYSIS_MODES.SCHEMA &&
        !schemaModeAvailable && (
          <div className="empty-state">
            <h3>Schema mode unavailable</h3>
            <p>
              The selected monthly CSVs do not yet include the future{" "}
              <code>{SCHEMA_CLASSIFICATION_COLUMN}</code> column.
            </p>
          </div>
        )}
      {!loading &&
        !error &&
        selectedStates.length > 0 &&
        (analysisMode !== ANALYSIS_MODES.SCHEMA || schemaModeAvailable) &&
        selectedSeries.length === 0 && (
          <div style={{ padding: 8 }}>
            {analysisMode === ANALYSIS_MODES.SCHEMA
              ? "Select one or more schema classifications to view the chart."
              : "Select one or more reasons to view the chart."}
          </div>
        )}
      {!loading &&
        !error &&
        selectedSeries.length > 0 &&
        selectedStates.length > 0 &&
        (analysisMode !== ANALYSIS_MODES.SCHEMA || schemaModeAvailable) && (
          <div className="chart-area">
            {chartType === "line" ? (
              <Line data={data} options={options} />
            ) : (
              <Bar data={data} options={options} />
            )}
          </div>
        )}
    </div>
  );
}
