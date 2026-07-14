import { useEffect, useMemo, useState, useRef, lazy, Suspense } from "react";
import Papa from "papaparse";
import "./App.css";
import ReasonTrendsChart from "./ReasonTrendsChart.jsx";

/*
const GppSectionBreakdownChart = lazy(
  () => import("./components/GppSectionBreakdownChart.jsx"),
);
*/
const BeforeAfterBreakdown = lazy(
  () => import("./components/BeforeAfterBreakdown.jsx"),
);


// Renders children only once the wrapper scrolls within rootMargin of the
// viewport. Used to defer the GPP breakdown chart (its own bundle + CSV
// parse) until the user is about to see it, so the Reason Trends chart up
// top isn't competing with it on first paint.
function LazyOnView({ children, fallback = null, rootMargin = "200px" }) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (show || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [show, rootMargin]);

  return <div ref={ref}>{show ? children : fallback}</div>;
}

import Tooltip from "./components/Tooltip";
import { renderJSONCell } from "./utils/renderJSONCell";
import {
  ANALYSIS_MODES,
  SCHEMA_CLASSIFICATION_COLUMN,
  getSchemaClassificationForRow,
  isSchemaRowNonCompliant,
} from "./utils/schemaClassification.js";
import { SPECIAL_SERIES } from "./utils/colorPalettes.js";
import datasetsManifest from "./generated/datasets.json";

const PAGE_SIZE = 10;

const TIME_PERIODS = [
  { key: "Dec2023", label: "December 2023" },
  { key: "Feb2024", label: "February 2024" },
  { key: "Apr2024", label: "April 2024" },
  { key: "Jun2024", label: "June 2024" },
  { key: "FebMar2025", label: "Feb-Mar 2025" },
  { key: "May2025", label: "May 2025" },
  { key: "AugSeptOct2025", label: "Aug-Oct 2025" },
  { key: "Jan2026", label: "January 2026" },
  { key: "Feb2026", label: "February 2026" },
  { key: "Apr2026", label: "April 2026" },
];

const STATE_MONTHS = {
  CA: [
    "Dec2023",
    "Feb2024",
    "Apr2024",
    "Jun2024",
    "FebMar2025",
    "May2025",
    "AugSeptOct2025",
    "Jan2026",
    "Apr2026",
  ],
  CT: ["FebMar2025", "May2025", "AugSeptOct2025", "Feb2026", "Apr2026"],
  CO: ["FebMar2025", "May2025", "AugSeptOct2025", "Jan2026", "Apr2026"],
  NJ: ["AugSeptOct2025", "Feb2026", "Apr2026"],
};

const AVAILABLE_STATES = datasetsManifest.states;
const DEFAULT_STATE = AVAILABLE_STATES.includes("CA")
  ? "CA"
  : (AVAILABLE_STATES[0] ?? "CA");
const DEFAULT_PERIOD =
  datasetsManifest.periodsByState[DEFAULT_STATE]?.at(-1)?.key ?? "";

function findPeriod(state, key) {
  return (datasetsManifest.periodsByState[state] || []).find(
    (period) => period.key === key,
  );
}

const STRUCTURED_COLUMNS = new Set([
  "urlclassification",
  "third_party_urls",
  "unique_ad_networks",
  "decoded_gpp_before_gpc",
  "decoded_gpp_after_gpc",
  SCHEMA_CLASSIFICATION_COLUMN.toLowerCase(),
]);

function buildPath(periodEntry, type, state) {
  if (!periodEntry) return null;
  if (type === "pnc") {
    return `/${state}/Crawl_Data_${state} - PotentiallyNonCompliantSites${periodEntry.key}.csv`;
  }
  return `/${state}/${periodEntry.file}`;
}

function normalizeRow(row) {
  const normalized = {};
  Object.keys(row || {}).forEach((key) => {
    normalized[String(key).trim()] = row[key];
  });
  return normalized;
}

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
    // Fall through
  }
  return str
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.replace(/^[\s'"]+|[\s'"]+$/g, "").trim())
    .filter(Boolean);
}

function getRowSearchValue(row) {
  return String(row?.["Site URL"] ?? row?.domain ?? row?.site ?? "")
    .trim()
    .toLowerCase();
}

const getParam = (keys, fallback) => {
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  for (const k of keys) {
    if (params.has(k)) return params.get(k);
  }
  return fallback;
};

const getArrayParam = (keys, fallback) => {
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  for (const k of keys) {
    const val = params.get(k);
    if (val)
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  }
  return fallback;
};

function App() {
  const [viewMode, setViewMode] = useState("graph");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(() => {
    const p = parseInt(getParam(["page"], "1"), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [selectedTimePeriod, setSelectedTimePeriod] = useState(() =>
    getParam(["period"], DEFAULT_PERIOD),
  );
  const [searchQuery, setSearchQuery] = useState(() =>
    getParam(["search", "url", "domain", "site"], ""),
  );
  const hasScrolledToSearch = useRef(false);
  const [selectedState, setSelectedState] = useState(() =>
    getParam(["state"], DEFAULT_STATE),
  );
  const [analysisMode, setAnalysisMode] = useState(() =>
    getParam(["mode"], ANALYSIS_MODES.SCHEMA),
  );
  const [descriptionsOfColumns, setDescriptionsOfColumns] = useState({});
  const [headerFriendlyNames, setHeaderFriendlyNames] = useState({});
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHeroDescription, setShowHeroDescription] = useState(false);
  const [activeChart, setActiveChart] = useState("trends");

  const [chartFilters, setChartFilters] = useState(() => ({
    selectedSeries: getArrayParam(["cseries"], []),
    selectedStates: getArrayParam(["cstates"], ["CA"]),
  }));
  const [chartType, setChartType] = useState(() => getParam(["ctype"], "line"));
  const setChartSelectedSeries = (updater) =>
    setChartFilters((prev) => ({
      ...prev,
      selectedSeries:
        typeof updater === "function" ? updater(prev.selectedSeries) : updater,
    }));
  const setChartSelectedStates = (updater) =>
    setChartFilters((prev) => ({
      ...prev,
      selectedStates:
        typeof updater === "function" ? updater(prev.selectedStates) : updater,
    }));

  const prevChartStates = useRef(chartFilters.selectedStates);
  useEffect(() => {
    const currentStates = chartFilters.selectedStates || [];
    const prevStates = prevChartStates.current || [];
    prevChartStates.current = currentStates;

    const newlyAdded = currentStates.find(s => !prevStates.includes(s));
    if (newlyAdded) {
      setSelectedState(newlyAdded);
      setCurrentPage(1);
    } else if (currentStates.length > 0 && !currentStates.includes(selectedState)) {
      setSelectedState(currentStates[0]);
      setCurrentPage(1);
    }
  }, [chartFilters.selectedStates, selectedState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    if (currentPage !== 1) params.set("page", currentPage);
    else params.delete("page");

    if (selectedState !== DEFAULT_STATE) params.set("state", selectedState);
    else params.delete("state");

    params.set("period", selectedTimePeriod);

    if (searchQuery) params.set("search", searchQuery);
    else {
      params.delete("search");
      params.delete("url");
      params.delete("domain");
      params.delete("site");
    }

    if (analysisMode !== ANALYSIS_MODES.SCHEMA)
      params.set("mode", analysisMode);
    else params.delete("mode");

    const newRelativePathQuery =
      window.location.pathname + "?" + params.toString();
    const finalUrl = params.toString()
      ? newRelativePathQuery
      : window.location.pathname;

    if (finalUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", finalUrl);
    }
  }, [currentPage, selectedState, selectedTimePeriod, searchQuery, analysisMode]);

  const allowedTimePeriods = useMemo(
    () => datasetsManifest.periodsByState[selectedState] || [],
    [selectedState],
  );

  const currentPeriodEntry = useMemo(
    () => findPeriod(selectedState, selectedTimePeriod),
    [selectedState, selectedTimePeriod],
  );

  const filePath = useMemo(
    () => buildPath(currentPeriodEntry, "all", selectedState),
    [currentPeriodEntry, selectedState],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/descriptions_of_columns.json")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Failed to load descriptions_of_columns.json")))
      .then((data) => { if (!cancelled && data && typeof data === "object") setDescriptionsOfColumns(data); })
      .catch((err) => console.warn("Failed to load column descriptions:", err));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/header_friendly_names.json")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Failed to load header_friendly_names.json")))
      .then((data) => { if (!cancelled && data && typeof data === "object") setHeaderFriendlyNames(data); })
      .catch((err) => console.warn("Failed to load header friendly names:", err));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const periods = datasetsManifest.periodsByState[selectedState] || [];
    const hasMatch = periods.some((period) => period.key === selectedTimePeriod);
    if (!hasMatch && periods.length > 0) {
      setSelectedTimePeriod(periods[periods.length - 1].key);
      setCurrentPage(1);
    }
  }, [selectedState, selectedTimePeriod]);

  useEffect(() => { setCurrentPage(1); }, [analysisMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setHeaders([]); setRows([]);

    if (!filePath) {
      setError("No dataset available for the selected state and time period.");
      setLoading(false);
      return;
    }

    Papa.parse(filePath, {
      download: true, header: true, dynamicTyping: false, skipEmptyLines: true,
      complete: (parsed) => {
        if (cancelled) return;
        if (parsed.meta?.fields) setHeaders(parsed.meta.fields.map((field) => String(field).trim()));
        setRows((parsed.data || []).map(normalizeRow));
        setLoading(false);
      },
      error: (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    });
    return () => { cancelled = true; };
  }, [filePath]);

  useEffect(() => {
    if (!loading && searchQuery && !hasScrolledToSearch.current) {
      const table = document.getElementById("table-wrapper");
      if (table) {
        setTimeout(() => {
          table.scrollIntoView({ behavior: "smooth", block: "start" });
          hasScrolledToSearch.current = true;
        }, 100);
      }
    }
  }, [loading, searchQuery]);

  const displayHeaders = useMemo(() => {
    if (headers.length > 0) return headers;
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [headers, rows]);

  useEffect(() => { setVisibleColumns(displayHeaders); }, [displayHeaders]);

  const hasSchemaColumn = displayHeaders.includes(SCHEMA_CLASSIFICATION_COLUMN);
  const schemaModeUnavailable = analysisMode === ANALYSIS_MODES.SCHEMA && !hasSchemaColumn;

  useEffect(() => { if (schemaModeUnavailable) setShowColumnPicker(false); }, [schemaModeUnavailable]);

  const rowRecords = useMemo(
    () => rows.map((row) => ({ row, schema: getSchemaClassificationForRow(row) })),
    [rows],
  );

  const schemaParseErrorCount = useMemo(
    () => rowRecords.filter((record) => record.schema.parseError).length,
    [rowRecords],
  );

  const firstStickyColumn = useMemo(() => {
    const columns = Array.isArray(visibleColumns) && visibleColumns.length > 0 ? visibleColumns : displayHeaders;
    return columns.length > 0 ? columns[0] : undefined;
  }, [visibleColumns, displayHeaders]);

  const filteredRecords = useMemo(() => {
    if (schemaModeUnavailable) return [];
    let base = rowRecords;

    if (chartFilters.selectedSeries && chartFilters.selectedSeries.length > 0) {
      base = base.filter(({ row, schema }) => {
        return chartFilters.selectedSeries.some((seriesKey) => {
          if (seriesKey === "Likely Does Not Honor GPC") return schema?.complianceResult === "Likely Does Not Honor GPC";
          if (seriesKey === "Likely Honors GPC") return schema?.complianceResult === "Likely Honors GPC";
          if (seriesKey === "Not Applicable/Invalid/Missing") return schema?.complianceResult === "Not Applicable/Invalid/Missing";
          if (seriesKey === SPECIAL_SERIES.NULL_SITES) return String(row?.site_isnull ?? "").trim().toUpperCase() === "TRUE";
          if (seriesKey === SPECIAL_SERIES.PNC_SITES) return isSchemaRowNonCompliant(schema);
          if (analysisMode === ANALYSIS_MODES.SCHEMA) return schema?.tokens?.includes(seriesKey);
          return parseReasons(row?.Reasons_Non_Compliant).includes(seriesKey);
        });
      });
    }

    const query = String(searchQuery || "").trim().toLowerCase();
    if (query.length > 0) {
      base = base.filter(({ row }) => getRowSearchValue(row).includes(query));
    }
    return base;
  }, [analysisMode, rowRecords, schemaModeUnavailable, searchQuery, chartFilters.selectedSeries]);

  const filteredRows = useMemo(() => filteredRecords.map((record) => record.row), [filteredRecords]);

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);

  const pageRows = useMemo(() => filteredRows.slice(startIndex, endIndex), [filteredRows, startIndex, endIndex]);
  const visibleTableColumns = visibleColumns.length > 0 ? visibleColumns : displayHeaders;

  const handleExportFiltered = () => {
    try {
      const data = filteredRows.map((row) => visibleTableColumns.map((header) => row && row[header] != null ? String(row[header]) : ""));
      const csv = Papa.unparse({ fields: visibleTableColumns, data });
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `GPC_${selectedState}_${selectedTimePeriod}_${analysisMode}_filtered.csv`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    } catch (err) { console.error("Failed to export CSV:", err); }
  };

  const tableContent = (
    <div className="table-section-view">
      <h2 className="section-title" style={{ marginTop: 0 }}>Filter GPC Web Crawler Data</h2>

      {/* ROW 1: State, Time Period, Edit Columns, Export Filtered Data */}
      <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="state-select" style={{ margin: 0, fontWeight: "500", color: "#475569" }}>State:</label>
          <select
            id="state-select"
            value={selectedState}
            onChange={(e) => {
              setSelectedState(e.target.value);
              setCurrentPage(1);
            }}
            style={{ margin: 0 }}
          >
            {AVAILABLE_STATES.map((stateCode) => (
              <option key={stateCode} value={stateCode}>
                {stateCode}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="time-period-select" style={{ margin: 0, fontWeight: "500", color: "#475569" }}>Time Period:</label>
          <select
            id="time-period-select"
            value={selectedTimePeriod}
            onChange={(e) => {
              setSelectedTimePeriod(e.target.value);
              setCurrentPage(1);
            }}
            style={{ margin: 0 }}
          >
            {allowedTimePeriods.map((period) => (
              <option key={period.key} value={period.key}>
                {period.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            type="button"
            aria-expanded={showColumnPicker}
            aria-controls="column-picker"
            onClick={() => setShowColumnPicker((open) => !open)}
            disabled={schemaModeUnavailable || loading}
            style={{ margin: 0 }}
          >
            Edit Columns
          </button>
          <button
            onClick={handleExportFiltered}
            disabled={totalItems === 0 || loading || schemaModeUnavailable}
            style={{ margin: 0 }}
          >
            Export filtered data ({totalItems})
          </button>
        </div>
      </div>

      {/* ROW 2: Smaller & Wider Sites after filter box + Search URL */}
      <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "20px", width: "100%" }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "10px", 
          background: "#f8fafc", 
          border: "1px solid #e2e8f0", 
          borderRadius: "6px", 
          padding: "6px 14px",
          height: "38px",
          boxSizing: "border-box"
        }}>
          <span style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a" }}>
            {totalItems.toLocaleString()}
          </span>
          <span style={{ fontSize: "12px", fontWeight: "500", color: "#64748b", whiteSpace: "nowrap" }}>
            Sites (after filters)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "250px" }}>
          <label htmlFor="url-search" style={{ margin: 0, fontWeight: "500", color: "#475569", whiteSpace: "nowrap" }}>Search URL:</label>
          <input
            id="url-search"
            type="text"
            placeholder="e.g., example.com"
            value={searchQuery}
            onChange={(e) => {
              setCurrentPage(1);
              setSearchQuery(e.target.value);
            }}
            className="input"
            style={{ width: "100%", margin: 0 }}
          />
        </div>
      </div>

      {analysisMode === ANALYSIS_MODES.SCHEMA && schemaParseErrorCount > 0 && (
        <div className="notice-card notice-card--warning" role="status">
          Ignored invalid schema classifications in {schemaParseErrorCount} row
          {schemaParseErrorCount === 1 ? "" : "s"} for this dataset.
        </div>
      )}

      {showColumnPicker && (
        <div
          id="column-picker"
          className="card card--padded column-picker"
          role="group"
          aria-label="Toggle columns"
          style={{ position: "absolute", zIndex: 100, width: "100%", boxSizing: "border-box" }}
        >
          <div className="column-picker-header">
            <strong>Select columns to display</strong>
            <div className="column-picker-actions">
              <button type="button" className="compact-btn" onClick={() => setVisibleColumns(displayHeaders)} disabled={displayHeaders.length === 0}>Select all</button>
              <button
                type="button"
                className="compact-btn"
                onClick={() => {
                  if (visibleColumns.length <= 1) return;
                  setVisibleColumns((prev) => prev.length > 0 ? [prev[0]] : displayHeaders.slice(0, 1));
                }}
                disabled={visibleColumns.length <= 1}
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="column-grid">
            {displayHeaders.map((column) => {
              const checked = visibleColumns.includes(column);
              const id = `col-${column.replace(/\s+/g, "-")}`;
              return (
                <label key={column} htmlFor={id} className="column-item">
                  <input
                    id={id} type="checkbox" checked={checked}
                    onChange={() => {
                      setVisibleColumns((prev) => {
                        const hasColumn = prev.includes(column);
                        if (hasColumn) { if (prev.length === 1) return prev; return prev.filter((value) => value !== column); }
                        return [...prev, column];
                      });
                      setCurrentPage(1);
                    }}
                  />
                  <span>{column}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div id="table-wrapper" role="status" aria-live="polite" style={{ padding: 16 }}>
          <h2>Loading CSV...</h2>
          <p>Fetching configuration and data.</p>
        </div>
      ) : error ? (
        <div id="table-wrapper" role="status" aria-live="polite" style={{ padding: 16, color: "#b00020" }}>
          <h2>Error</h2><pre>{error}</pre>
        </div>
      ) : schemaModeUnavailable ? (
        <div id="table-wrapper" className="empty-state" role="status" aria-live="polite" style={{ padding: 16 }}>
          <h2>Schema mode unavailable</h2>
          <p>This CSV does not yet include the future <code>{SCHEMA_CLASSIFICATION_COLUMN}</code> column. Switch back to legacy reasons to inspect this dataset.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div id="table-wrapper">
          <p style={{ padding: "16px 0" }}>No data rows.</p>
        </div>
      ) : (
        <div id="table-wrapper">
          <div id="pager">
            <div>
              {totalItems > 0 && (
                <span>Showing {startIndex + 1}-{endIndex} of {totalItems}</span>
              )}
            </div>
            <div className="pager-actions">
              <button onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safeCurrentPage <= 1}>Previous</button>
              <span>Page {safeCurrentPage} / {totalPages}</span>
              <button onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safeCurrentPage >= totalPages}>Next</button>
            </div>
          </div>
          <div id="table-scroll">
            <table>
              <thead>
                <tr>
                  {visibleTableColumns.map((header) => (
                    <th key={header} className={header === firstStickyColumn ? "col-sticky" : undefined}>
                      {descriptionsOfColumns[header] ? (
                        <div className="header-wrapper">
                          <span className="header-content">{headerFriendlyNames[header] || header}</span>
                          <Tooltip content={descriptionsOfColumns[header]} position="bottom">
                            <span className="tooltip-icon">?</span>
                          </Tooltip>
                        </div>
                      ) : (
                        <span className="header-content">{headerFriendlyNames[header] || header}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {visibleTableColumns.map((header) => (
                      <td
                        key={header}
                        className={[
                          header === "Reasons_Non_Compliant" ? "Reasons_Non_Compliant" : "",
                          header === firstStickyColumn ? "col-sticky" : "",
                        ].filter(Boolean).join(" ") || undefined}
                      >
                        {STRUCTURED_COLUMNS.has(String(header).toLowerCase()) ? (
                          <span className="cell-content">{renderJSONCell(row[header])}</span>
                        ) : (
                          <span className="cell-content">{String(row[header] ?? "")}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div id="pager">
            <div>
              {totalItems > 0 && (
                <span>Showing {startIndex + 1}-{endIndex} of {totalItems}</span>
              )}
            </div>
            <div className="pager-actions">
              <button onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safeCurrentPage <= 1}>Previous</button>
              <span>Page {safeCurrentPage} / {totalPages}</span>
              <button onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safeCurrentPage >= totalPages}>Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-container">
      <style>{`
        #table-scroll table {
          width: 100%;
          border-collapse: collapse;
        }
        #table-scroll th {
          padding: 6px 12px;
          text-align: left;
        }
        #table-scroll td {
          padding: 4px 12px;
          max-width: 260px;
          min-width: 140px;
          position: relative;
          box-sizing: border-box;
          vertical-align: top;
        }
        #table-scroll td .cell-content {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: normal;
          max-width: 100%;
          line-height: 1.3em;
          max-height: 2.6em;
        }
        #table-scroll td:hover {
          overflow: visible;
          z-index: 90;
        }
        #table-scroll td:hover .cell-content {
          display: block;
          position: absolute;
          left: 0;
          top: 0;
          min-width: 100%;
          width: max-content;
          max-width: 520px;
          white-space: normal;
          background: #ffffff;
          padding: 8px 12px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
          border: 1px solid #cbd5e1;
          z-index: 120;
          border-radius: 4px;
          word-break: break-word;
          color: #0f172a;
          max-height: none;
          -webkit-line-clamp: unset;
        }
        #table-scroll td.col-sticky:hover .cell-content {
          left: 0;
        }
        .hero-title-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .hero-toggle-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          border-radius: 4px;
          transition: background-color 0.2s, color 0.2s;
        }
        .hero-toggle-btn:hover {
          background-color: #f1f5f9;
          color: #0f172a;
        }
        .hero-toggle-icon {
          transition: transform 0.2s ease;
        }
      `}</style>

      <button
        className={`settings-toggle ${showSettings ? "settings-toggle--active" : ""}`}
        onClick={() => setShowSettings(!showSettings)}
        title="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
          <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
        </svg>
      </button>

      <div className="hero">
        <div className="hero-title-wrapper">
          <h1 style={{ margin: 0 }}>GPC Crawl Data</h1>
          <button
            type="button"
            className="hero-toggle-btn"
            onClick={() => setShowHeroDescription((prev) => !prev)}
            aria-expanded={showHeroDescription}
            title={showHeroDescription ? "Hide description" : "Show description"}
          >
            <svg
              className="hero-toggle-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 16 16"
              style={{ transform: showHeroDescription ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              <path fillRule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>
        
        {showHeroDescription && (
          <p className="intro">
            The GPC Web Crawler analyzes websites' compliance with{" "}
            <a href="https://globalprivacycontrol.org/" target="_blank" rel="noreferrer noopener">Global Privacy Control (GPC)</a>{" "}
            at scale. GPC is a privacy preference signal that people can use to exercise their rights to opt out from web tracking.
            The GPC Web Crawler is based on <a href="https://www.selenium.dev/" target="_blank" rel="noreferrer noopener">Selenium</a>{" "}
            and the <a href="https://github.com/privacy-tech-lab/gpc-web-crawler/tree/main/gpc-analysis-extension" target="_blank" rel="noreferrer noopener">OptMeowt Analysis extension</a>.
            To track the evolution of GPC compliance on the web over time we are performing regular crawls of a set of 11,708 websites.
          </p>
        )}
      </div>

      {showSettings && (
        <div className="settings-panel">
          <div className="card card--padded">
            <div className="toolbar mode-toolbar__inner">
              <label htmlFor="analysis-mode-select">Analysis Mode:</label>
              <select id="analysis-mode-select" value={analysisMode} onChange={(e) => setAnalysisMode(e.target.value)}>
                <option value={ANALYSIS_MODES.SCHEMA}>Schema classifications</option>
                <option value={ANALYSIS_MODES.LEGACY}>Legacy reasons</option>
              </select>
              <span className="mode-toolbar__hint">
                {analysisMode === ANALYSIS_MODES.LEGACY
                  ? "Legacy mode uses the existing Reasons_Non_Compliant CSV columns."
                  : `Schema mode uses the ${SCHEMA_CLASSIFICATION_COLUMN} column. Select "Non-compliant (schema)" to see sites with any Did Not Opt Out classification.`}
              </span>
            </div>
          </div>
        </div>
      )}

      <ReasonTrendsChart
        viewMode={viewMode}
        setViewMode={setViewMode}
        tableContent={tableContent}
        analysisMode={analysisMode}
        timePeriods={TIME_PERIODS}
        stateMonths={STATE_MONTHS}
        selectedSeries={chartFilters.selectedSeries}
        setSelectedSeries={setChartSelectedSeries}
        selectedStates={chartFilters.selectedStates}
        setSelectedStates={setChartSelectedStates}
        chartType={chartType}
        setChartType={setChartType}
        activeChart={activeChart}
        setActiveChart={setActiveChart}
        setCurrentPage={setCurrentPage}
        gppSection={
          <LazyOnView
            fallback={
              <div
                className="card card--padded section"
                style={{ minHeight: 360 }}
                aria-hidden="true"
              />
            }
          >
            <Suspense
              fallback={
                <div
                  className="card card--padded section"
                  style={{ minHeight: 360 }}
                >
                  <p className="muted-text">Loading GPP breakdown…</p>
                </div>
              }
            >
              <BeforeAfterBreakdown
                timePeriods={TIME_PERIODS}
                stateMonths={STATE_MONTHS}
              />
            </Suspense>
          </LazyOnView>
        }
      />
    </div>
  );
}

export default App;