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
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

function parseReasons(value) {
  if (!value) return [];
  if (Array.isArray(value))
    return value.map((v) => String(v).trim()).filter(Boolean);
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
      return parsed.map((v) => String(v).trim()).filter(Boolean);
    }
  } catch (_) {}
  return str
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.replace(/^[\s'\"]+|[\s'\"]+$/g, "").trim())
    .filter(Boolean);
}

const COLOR_PALETTE = [
  "#2e7d32", // green 700
  "#1b5e20", // green 900
  "#43a047", // green 600
  "#66bb6a", // green 400
  "#81c784", // green 300
  "#26a69a", // teal 600
  "#00796b", // teal 800
  "#558b2f", // light green 800
  "#689f38", // light green 700
  "#8bc34a", // light green 500
  "#33691e", // light green 900
  "#00acc1", // cyan 600
  "#26c6da", // cyan 400
  "#9ccc65", // light green 400
  "#4db6ac", // teal 300
  "#a5d6a7", // green 200
];

const SPECIAL_SERIES = {
  PNC_SITES: "Potentially Non-Compliant Sites",
  NULL_SITES: "Null Sites",
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

export default function ReasonTrendsChart({ timePeriods, stateMonths }) {
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [chartType, setChartType] = useState("line");
  const [stateMonthToRows, setStateMonthToRows] = useState({});
  const [stateMonthToNullRows, setStateMonthToNullRows] = useState({});
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
    let cancelled = false;
    async function loadSelectedStates() {
      setLoading(true);
      setError("");
      try {
        function parseCsv(publicCsvPath) {
          return new Promise((resolve, reject) => {
            Papa.parse(publicCsvPath, {
              download: true,
              header: true,
              dynamicTyping: false,
              skipEmptyLines: true,
              complete: (parsed) => {
                const normalizedRows = (parsed.data || []).map((row) => {
                  const normalized = {};
                  Object.keys(row).forEach((key) => {
                    const trimmedKey = String(key).trim();
                    normalized[trimmedKey] = row[key];
                  });
                  return normalized;
                });
                resolve(normalizedRows);
              },
              error: (err) => {
                reject(err instanceof Error ? err : new Error(String(err)));
              },
            });
          });
        }

        const states = Array.isArray(selectedStates) ? selectedStates : [];
        if (states.length === 0) {
          setStateMonthToRows({});
          setStateMonthToNullRows({});
          setLoading(false);
          return;
        }

        const perStateResults = await Promise.all(
          states.map(async (stateCode) => {
            const monthKeys = (stateMonths && stateMonths[stateCode]) || [];
            const results = await Promise.all(
              monthKeys.map(async (monthKey) => {
                const pncPath = `/${stateCode}/Crawl_Data_${stateCode} - PotentiallyNonCompliantSites${monthKey}.csv`;
                const nullPath = `/${stateCode}/Crawl_Data_${stateCode} - NullSites${monthKey}.csv`;
                const [pncRows, nullRows] = await Promise.all([
                  parseCsv(pncPath),
                  parseCsv(nullPath),
                ]);
                return { key: monthKey, pncRows, nullRows };
              })
            );
            const pncMap = {};
            const nullMap = {};
            results.forEach(({ key, pncRows, nullRows }) => {
              pncMap[key] = pncRows;
              nullMap[key] = nullRows;
            });
            return { state: stateCode, pncMap, nullMap };
          })
        );
        if (cancelled) return;
        const nextStateMonthToRows = {};
        const nextStateMonthToNullRows = {};
        perStateResults.forEach(({ state, pncMap, nullMap }) => {
          nextStateMonthToRows[state] = pncMap;
          nextStateMonthToNullRows[state] = nullMap;
        });
        setStateMonthToRows(nextStateMonthToRows);
        setStateMonthToNullRows(nextStateMonthToNullRows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSelectedStates();
    return () => {
      cancelled = true;
    };
  }, [selectedStates]);

  const unifiedMonthKeys = useMemo(() => {
    const states = Array.isArray(selectedStates) ? selectedStates : [];
    if (!Array.isArray(timePeriods) || timePeriods.length === 0) return [];
    if (states.length === 0) return timePeriods.map((p) => p.key);
    const keySet = new Set();
    states.forEach((s) => {
      const keys = (stateMonths && stateMonths[s]) || [];
      keys.forEach((k) => keySet.add(k));
    });
    // Preserve chronological order from timePeriods
    return timePeriods.filter((p) => keySet.has(p.key)).map((p) => p.key);
  }, [selectedStates, timePeriods, stateMonths]);

  const labels = useMemo(() => {
    const keyToLabel = new Map(
      (timePeriods || []).map((p) => [p.key, p.label])
    );
    return unifiedMonthKeys.map((k) => keyToLabel.get(k));
  }, [timePeriods, unifiedMonthKeys]);

  const datasets = useMemo(() => {
    if (!selectedReasons || selectedReasons.length === 0) return [];
    const allDatasets = [];
    const states =
      selectedStates && selectedStates.length > 0 ? selectedStates : [];
    states.forEach((stateCode, stateIdx) => {
      selectedReasons.forEach((reason, reasonIdx) => {
        const color =
          COLOR_PALETTE[(reasonIdx * 3 + stateIdx) % COLOR_PALETTE.length];
        let data;
        if (reason === SPECIAL_SERIES.PNC_SITES) {
          data = unifiedMonthKeys.map((monthKey) => {
            const rows = stateMonthToRows[stateCode]?.[monthKey];
            return Array.isArray(rows) ? rows.length : null;
          });
        } else if (reason === SPECIAL_SERIES.NULL_SITES) {
          data = unifiedMonthKeys.map((monthKey) => {
            const rows = stateMonthToNullRows[stateCode]?.[monthKey];
            return Array.isArray(rows) ? rows.length : null;
          });
        } else {
          data = unifiedMonthKeys.map((monthKey) => {
            const rows = stateMonthToRows[stateCode]?.[monthKey];
            if (!Array.isArray(rows)) return null;
            let count = 0;
            for (const row of rows) {
              const reasons = parseReasons(row?.Reasons_Non_Compliant);
              if (reasons.includes(reason)) count += 1;
            }
            return count;
          });
        }
        allDatasets.push({
          label: `${stateCode} - ${reason}`,
          data,
          borderColor: color,
          backgroundColor: chartType === "line" ? color : `${color}80`,
          fill: false,
        });
      });
    });
    return allDatasets;
  }, [
    selectedReasons,
    selectedStates,
    stateMonthToRows,
    stateMonthToNullRows,
    chartType,
  ]);

  const data = useMemo(
    () => ({
      labels,
      datasets,
    }),
    [labels, datasets]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        title: {
          display: true,
          text: "Reason trends over months",
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
    []
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
                    ? prev.filter((s) => s !== stateCode)
                    : [...prev, stateCode]
                )
              }
            >
              {stateCode}
            </button>
          );
        })}
      </div>

      <div className="section">
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <strong>Chart Reason Filters</strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setSelectedReasons(PNC_REASON_LIST)}
              disabled={PNC_REASON_LIST.length === 0}
            >
              All
            </button>
            <button
              onClick={() => setSelectedReasons([])}
              disabled={!selectedReasons || selectedReasons.length === 0}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="chip-group">
          {[
            SPECIAL_SERIES.PNC_SITES,
            SPECIAL_SERIES.NULL_SITES,
            ...PNC_REASON_LIST,
          ].map((reason) => {
            const active = selectedReasons?.includes(reason);
            return (
              <div key={reason} className="chart-reason-tooltip-wrapper">
                <button
                  className={`chip${active ? " chip--active" : ""}`}
                  onClick={() => {
                    setSelectedReasons((prev) =>
                      prev.includes(reason)
                        ? prev.filter((r) => r !== reason)
                        : [...prev, reason]
                    );
                  }}
                >
                  {reason}
                </button>
                {reasonDescriptions[reason] ? (
                  <div className="chart-reason-tooltip">
                    {reasonDescriptions[reason]}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {loading && <div style={{ padding: 8 }}>Loading chart data…</div>}
      {error && (
        <div style={{ padding: 8, color: "#b00020" }}>
          Error loading chart data: {error}
        </div>
      )}
      {!loading &&
        !error &&
        (!selectedReasons || selectedReasons.length === 0) && (
          <div style={{ padding: 8 }}>
            Select one or more reasons to view the chart.
          </div>
        )}
      {!loading && !error && selectedReasons && selectedReasons.length > 0 && (
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
