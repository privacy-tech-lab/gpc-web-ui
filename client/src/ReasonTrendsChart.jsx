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

const MONTHS = [
  { key: "Dec2023", label: "December 2023" },
  { key: "Feb2024", label: "February 2024" },
  { key: "Apr2024", label: "April 2024" },
  { key: "Jun2024", label: "June 2024" },
  { key: "FebMar2025", label: "Feb-Mar 2025" },
  { key: "May2025", label: "May 2025" },
  { key: "August2025", label: "August 2025" },
];

const COLOR_PALETTE = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
  "#5e3c99",
  "#e66101",
  "#4daf4a",
  "#984ea3",
  "#a65628",
  "#f781bf",
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

export default function ReasonTrendsChart() {
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [chartType, setChartType] = useState("line");
  const [monthToRows, setMonthToRows] = useState({});
  const [monthToNullRows, setMonthToNullRows] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadAllMonths() {
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

        const results = await Promise.all(
          MONTHS.map(async (m) => {
            const pncPath = `/Crawl_Data_CA - PotentiallyNonCompliantSites${m.key}.csv`;
            const nullPath = `/Crawl_Data_CA - NullSites${m.key}.csv`;
            const [pncRows, nullRows] = await Promise.all([
              parseCsv(pncPath),
              parseCsv(nullPath),
            ]);
            return { key: m.key, pncRows, nullRows };
          })
        );
        if (cancelled) return;
        const pncMap = {};
        const nullMap = {};
        results.forEach(({ key, pncRows, nullRows }) => {
          pncMap[key] = pncRows;
          nullMap[key] = nullRows;
        });
        setMonthToRows(pncMap);
        setMonthToNullRows(nullMap);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAllMonths();
    return () => {
      cancelled = true;
    };
  }, []);

  const labels = useMemo(() => MONTHS.map((m) => m.label), []);

  const datasets = useMemo(() => {
    if (!selectedReasons || selectedReasons.length === 0) return [];
    return selectedReasons.map((reason, idx) => {
      const color = COLOR_PALETTE[idx % COLOR_PALETTE.length];
      let data;
      if (reason === SPECIAL_SERIES.PNC_SITES) {
        data = MONTHS.map((m) => (monthToRows[m.key] || []).length);
      } else if (reason === SPECIAL_SERIES.NULL_SITES) {
        data = MONTHS.map((m) => (monthToNullRows[m.key] || []).length);
      } else {
        data = MONTHS.map((m) => {
          const rows = monthToRows[m.key] || [];
          let count = 0;
          for (const row of rows) {
            const reasons = parseReasons(row?.Reasons_Non_Compliant);
            if (reasons.includes(reason)) count += 1;
          }
          return count;
        });
      }
      return {
        label: reason,
        data,
        borderColor: color,
        backgroundColor: chartType === "line" ? color : `${color}80`,
        fill: false,
      };
    });
  }, [selectedReasons, monthToRows, monthToNullRows, chartType]);

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
    <div
      style={{
        border: "1px solid #eee",
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0, textAlign: "center", flex: 1 }}>
          Track Compliance Evolution Over Time
        </h2>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <label htmlFor="chart-type-select" style={{ marginRight: 8 }}>
          Chart Type:
        </label>
        <select
          id="chart-type-select"
          value={chartType}
          onChange={(e) => setChartType(e.target.value)}
        >
          <option value="line">Line</option>
          <option value="bar">Bar</option>
        </select>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <strong>Chart Reason Filters</strong>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            SPECIAL_SERIES.PNC_SITES,
            SPECIAL_SERIES.NULL_SITES,
            ...PNC_REASON_LIST,
          ].map((reason) => {
            const active = selectedReasons?.includes(reason);
            return (
              <button
                key={reason}
                onClick={() => {
                  setSelectedReasons((prev) =>
                    prev.includes(reason)
                      ? prev.filter((r) => r !== reason)
                      : [...prev, reason]
                  );
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: active ? "1px solid #1976d2" : "1px solid #ddd",
                  background: active ? "#e3f2fd" : "#fff",
                  cursor: "pointer",
                  color: "#000",
                }}
              >
                {reason}
              </button>
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
        <div style={{ height: 360 }}>
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
