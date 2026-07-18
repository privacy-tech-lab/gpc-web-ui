import { useEffect, useMemo, useState, useRef, lazy, Suspense } from "react";
import Papa from "papaparse";
import "./App.css";
import ReasonTrendsChart from "./ReasonTrendsChart.jsx";
import SideNav from "./components/SideNav.jsx";

const BeforeAfterBreakdown = lazy(
  () => import("./components/BeforeAfterBreakdown.jsx"),
);

// SVG Icons matching those in SideNav.jsx - Enlarged to 56x56
function ChartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" fill="currentColor" viewBox="0 0 16 16">
      <path d="M0 0h1v15h15v1H0V0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07z" />
    </svg>
  );
}

function PieIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" fill="currentColor" viewBox="0 0 16 16">
      <path d="M15.985 8.5H8.207l5.5 5.5a8 8 0 0 0 2.278-5.5zM14.972 7A7.001 7.001 0 0 0 9 1.028v6.972h5.972zM8 1.028V8l.5.5H15.5A8 8 0 1 0 8 1.028zM7.5 9V1.028A8 8 0 1 0 13.73 14.5L7.5 9z" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" fill="currentColor" viewBox="0 0 16 16">
      <path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V2zm1 2v2h3V4H1zm4 0v2h3V4H5zm4 0v2h3V4H9zm4 0v2h2V4h-2zM1 7v2h3V7H1zm4 0v2h3V7H5zm4 0v2h2V7h-2zm-12 3v2h3v-2H1zm4 0v2h3v-2H5zm4 0v2h3v-2H9zm4 0v2h2v-2h-2z" />
    </svg>
  );
}

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
    let trimmedKey = String(key).trim();
    if (trimmedKey === "site_isnull" || trimmedKey.toLowerCase() === "site id") {
      if (trimmedKey === "site_isnull") trimmedKey = "Site Is Null";
    }
    normalized[trimmedKey] = row[key];
  });
  return normalized;
}

function getRowSearchValue(row) {
  return String(row?.["Site URL"] ?? row?.domain ?? row?.site ?? "")
    .trim()
    .toLowerCase();
}

const isSiteUrlColumn = (column) => {
  const rawLower = String(column || "").toLowerCase();
  return rawLower === "site url" || rawLower === "site" || rawLower === "domain";
};

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
  const hasSearchDeepLink = Boolean(getParam(["search", "url", "domain", "site"], ""));
  const [viewMode, setViewMode] = useState(() => (hasSearchDeepLink ? "table" : "graph"));
  const [showOverview, setShowOverview] = useState(() => !hasSearchDeepLink);
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
  const [descriptionsOfColumns, setDescriptionsOfColumns] = useState({});
  const [headerFriendlyNames, setHeaderFriendlyNames] = useState({});
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [activeChart, setActiveChart] = useState("trends");
  const [pendingScrollId, setPendingScrollId] = useState(null);

  const pickerBtnRef = useRef(null);
  const pickerPanelRef = useRef(null);

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

  function goToSection(sectionId) {
    switch (sectionId) {
      case "overview":
        setShowOverview(true);
        setPendingScrollId("section-overview");
        break;
      case "trends":
        setShowOverview(false);
        setViewMode("graph");
        setActiveChart("trends");
        setPendingScrollId("section-trends");
        break;
      case "gpp":
        setShowOverview(false);
        setViewMode("graph");
        setActiveChart("gpp");
        setPendingScrollId("section-gpp");
        break;
      case "table":
        setShowOverview(false);
        setViewMode("table");
        setPendingScrollId("page-top");
        break;
      default:
        break;
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      import("./components/BeforeAfterBreakdown.jsx")
        .then(() => console.log("BeforeAfterBreakdownChart preloaded in background"))
        .catch((err) => console.warn("Background preload of GPP bundle failed:", err));
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showOverview) {
      const resizeTimer = setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 80);
      return () => clearTimeout(resizeTimer);
    }
  }, [showOverview]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(pendingScrollId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        setPendingScrollId(null);
      });
    });
    return () => cancelAnimationFrame(raf1);
  }, [pendingScrollId, viewMode, activeChart, showOverview]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        showColumnPicker &&
        pickerPanelRef.current &&
        !pickerPanelRef.current.contains(event.target) &&
        pickerBtnRef.current &&
        !pickerBtnRef.current.contains(event.target)
      ) {
        setShowColumnPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showColumnPicker]);

  const activeSectionId = showOverview
    ? "overview"
    : viewMode === "table"
      ? "table"
      : activeChart === "gpp"
        ? "gpp"
        : "trends";

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

    const newRelativePathQuery =
      window.location.pathname + "?" + params.toString();
    const finalUrl = params.toString()
      ? newRelativePathQuery
      : window.location.pathname;

    if (finalUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", finalUrl);
    }
  }, [currentPage, selectedState, selectedTimePeriod, searchQuery]);

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
        if (parsed.meta?.fields) {
          setHeaders(
            parsed.meta.fields.map((field) => {
              const trimmed = String(field).trim();
              return trimmed === "site_isnull" ? "Site Is Null" : trimmed;
            })
          );
        }
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
    let baseHeaders = [];
    if (headers.length > 0) {
      baseHeaders = [...headers];
    } else if (rows.length > 0) {
      baseHeaders = Object.keys(rows[0]);
    }

    if (baseHeaders.length > 0 && !baseHeaders.includes("Compliance Result")) {
      baseHeaders.push("Compliance Result");
    }
    return baseHeaders;
  }, [headers, rows]);

  useEffect(() => {
    if (displayHeaders.includes("Compliance Result")) {
      setVisibleColumns(["Compliance Result"]);
    } else if (displayHeaders.length > 0) {
      setVisibleColumns([displayHeaders[0]]);
    }
  }, [displayHeaders]);

  const hasSchemaColumn = displayHeaders.includes(SCHEMA_CLASSIFICATION_COLUMN);
  const schemaModeUnavailable = !hasSchemaColumn;

  useEffect(() => { if (schemaModeUnavailable) setShowColumnPicker(false); }, [schemaModeUnavailable]);

  const rowRecords = useMemo(
    () => rows.map((row) => ({ row, schema: getSchemaClassificationForRow(row) })),
    [rows],
  );

  const schemaParseErrorCount = useMemo(
    () => rowRecords.filter((record) => record.schema.parseError).length,
    [rowRecords],
  );

  const visibleTableColumns = useMemo(() => {
    const cols = visibleColumns.length > 0 ? visibleColumns : displayHeaders;
    const siteUrlCol = displayHeaders.find(isSiteUrlColumn);
    if (siteUrlCol && !cols.includes(siteUrlCol)) {
      return [siteUrlCol, ...cols];
    }
    return cols;
  }, [visibleColumns, displayHeaders]);

  const firstStickyColumn = useMemo(() => {
    const columns = Array.isArray(visibleTableColumns) && visibleTableColumns.length > 0 ? visibleTableColumns : displayHeaders;
    return columns.length > 0 ? columns[0] : undefined;
  }, [visibleTableColumns, displayHeaders]);

  const groupedColumns = useMemo(() => {
    const categories = [
      { id: "website", name: "Website Metadata", columns: [] },
      { id: "compliance", name: "Compliance Status", columns: [] },
      { id: "tracking", name: "Tracking & Networks", columns: [] },
      { id: "gpp", name: "Global Privacy Platform (GPP)", columns: [] },
      { id: "signals", name: "Cookies & Other Signals", columns: [] },
      { id: "other", name: "Other Columns", columns: [] },
    ];

    displayHeaders.forEach((column) => {
      if (isSiteUrlColumn(column)) {
        return;
      }

      const rawLower = column.toLowerCase();

      // Explicitly remove "Site ID" from the editing/picking dashboard list
      if (rawLower === "site id" || rawLower === "site_id") {
        return;
      }

      const friendlyLower = (headerFriendlyNames[column] || column).toLowerCase();

      // Force "Site Is Null" explicitly into the Compliance Status container
      if (rawLower === "site is null") {
        categories[1].columns.push(column);
      }
      else if (
        rawLower.includes("site") ||
        rawLower.includes("domain") ||
        rawLower.includes("url") && !rawLower.includes("classification") && !rawLower.includes("third_party")
      ) {
        categories[0].columns.push(column);
      }
      else if (
        rawLower.includes("compliant") ||
        rawLower.includes("compliance") ||
        rawLower.includes("schema") ||
        rawLower.includes("reason")
      ) {
        categories[1].columns.push(column);
      }
      else if (
        rawLower.includes("ad_network") ||
        rawLower.includes("third_party") ||
        rawLower.includes("classification") ||
        friendlyLower.includes("tracking") ||
        friendlyLower.includes("network") ||
        friendlyLower.includes("third party")
      ) {
        categories[2].columns.push(column);
      }
      else if (rawLower.includes("gpp")) {
        categories[3].columns.push(column);
      }
      else if (
        rawLower.includes("usps") ||
        rawLower.includes("optanon") ||
        rawLower.includes("well_known") ||
        rawLower.includes("well-known") ||
        friendlyLower.includes("us privacy") ||
        friendlyLower.includes("cookie") ||
        friendlyLower.includes("well-known")
      ) {
        categories[4].columns.push(column);
      }
      else {
        categories[5].columns.push(column);
      }
    });

    return categories.filter((cat) => cat.columns.length > 0);
  }, [displayHeaders, headerFriendlyNames]);

  const filteredRecords = useMemo(() => {
    if (schemaModeUnavailable) return [];
    let base = rowRecords;

    if (chartFilters.selectedSeries && chartFilters.selectedSeries.length > 0) {
      const matchesSeries = ({ row, schema }, seriesKey) => {
        if (seriesKey === "Likely Does Not Honor GPC") return schema?.complianceResult === "Likely Does Not Honor GPC";
        if (seriesKey === "Likely Honors GPC") return schema?.complianceResult === "Likely Honors GPC";
        if (seriesKey === "Not Applicable/Invalid/Missing") return schema?.complianceResult === "Not Applicable/Invalid/Missing";
        if (seriesKey === SPECIAL_SERIES.NULL_SITES) return String(row?.["Site Is Null"] ?? row?.site_isnull ?? "").trim().toUpperCase() === "TRUE";
        if (seriesKey === SPECIAL_SERIES.PNC_SITES) return isSchemaRowNonCompliant(schema);
        return schema?.tokens?.includes(seriesKey);
      };
      base =
        viewMode === "table"
          ? base.filter((record) =>
              chartFilters.selectedSeries.every((seriesKey) => matchesSeries(record, seriesKey)),
            )
          : base.filter((record) =>
              chartFilters.selectedSeries.some((seriesKey) => matchesSeries(record, seriesKey)),
            );
    }

    const query = String(searchQuery || "").trim().toLowerCase();
    if (query.length > 0) {
      base = base.filter(({ row }) => getRowSearchValue(row).includes(query));
    }
    return base;
  }, [rowRecords, schemaModeUnavailable, searchQuery, chartFilters.selectedSeries, viewMode]);

  const filteredRows = useMemo(() => filteredRecords.map((record) => record.row), [filteredRecords]);

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);

  const pageRows = useMemo(() => filteredRows.slice(startIndex, endIndex), [filteredRows, startIndex, endIndex]);

  const handleExportFiltered = () => {
    try {
      const data = filteredRows.map((row) => 
        visibleTableColumns.map((header) => {
          if (row) {
            if (header === "Compliance Result") {
              return getSchemaClassificationForRow(row)?.complianceResult || "";
            }
            return row[header] != null ? String(row[header]) : "";
          }
          return "";
        })
      );
      const csv = Papa.unparse({ fields: visibleTableColumns, data });
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `GPC_${selectedState}_${selectedTimePeriod}_filtered.csv`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    } catch (err) { console.error("Failed to export CSV:", err); }
  };

  const renderTableBody = () => {
    if (loading) {
      return (
        <div id="table-wrapper" role="status" aria-live="polite" style={{ padding: 16 }}>
          <h2>Loading CSV...</h2>
          <p>Fetching configuration and data.</p>
        </div>
      );
    }

    if (error) {
      return (
        <div id="table-wrapper" role="status" aria-live="polite" style={{ padding: 16, color: "#b00020" }}>
          <h2>Error</h2>
          <pre>{error}</pre>
        </div>
      );
    }

    if (schemaModeUnavailable) {
      return (
        <div id="table-wrapper" className="empty-state" role="status" aria-live="polite" style={{ padding: 16 }}>
          <h2>Schema classification unavailable</h2>
          <p>
            This dataset doesn&apos;t include the <code>{SCHEMA_CLASSIFICATION_COLUMN}</code> column, so it can&apos;t be classified or filtered.
          </p>
        </div>
      );
    }

    if (filteredRows.length === 0) {
      return (
        <div id="table-wrapper">
          <p style={{ padding: "16px 0" }}>No data rows.</p>
        </div>
      );
    }

    return (
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
                  {visibleTableColumns.map((header) => {
                    const isSticky = header === firstStickyColumn;
                    const isNonCompliant = header === "Reasons_Non_Compliant";
                    const cellClasses = [
                      isNonCompliant ? "Reasons_Non_Compliant" : "",
                      isSticky ? "col-sticky" : "",
                    ].filter(Boolean).join(" ");

                    const isStructured = STRUCTURED_COLUMNS.has(String(header).toLowerCase());
                    let cellValue = "";
                    if (row) {
                      if (header === "Compliance Result") {
                        cellValue = getSchemaClassificationForRow(row)?.complianceResult || "";
                      } else {
                        cellValue = row[header];
                      }
                    }

                    return (
                      <td key={header} className={cellClasses || undefined}>
                        {isStructured ? (
                          <span className="cell-content">{renderJSONCell(cellValue)}</span>
                        ) : (
                          <span className="cell-content">{String(cellValue ?? "")}</span>
                        )}
                      </td>
                    );
                  })}
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
    );
  };

  const tableContent = (
    <div className="table-section-view">
      <h2 className="section-title" style={{ marginTop: 0 }}>Filter GPC Web Crawler Data</h2>

      <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="state-select" style={{ margin: 0, fontWeight: "500", color: "#334155" }}>State:</label>
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
          <label htmlFor="time-period-select" style={{ margin: 0, fontWeight: "500", color: "#334155" }}>Time Period:</label>
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
            ref={pickerBtnRef}
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

      <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "20px", width: "100%" }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "10px", 
          background: "#f8fafc", 
          border: "1px solid #cbd5e1", 
          borderRadius: "6px", 
          padding: "6px 14px",
          height: "38px",
          boxSizing: "border-box"
        }}>
          <span style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a" }}>
            {totalItems.toLocaleString()}
          </span>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#334155", whiteSpace: "nowrap" }}>
            Sites (after filters)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "250px" }}>
          <label htmlFor="url-search" style={{ margin: 0, fontWeight: "500", color: "#334155", whiteSpace: "nowrap" }}>Search URL:</label>
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

      {schemaParseErrorCount > 0 && (
        <div className="notice-card notice-card--warning" role="status">
          Ignored invalid schema classifications in {schemaParseErrorCount} row
          {schemaParseErrorCount === 1 ? "" : "s"} for this dataset.
        </div>
      )}

      {showColumnPicker && (
        <div
          ref={pickerPanelRef}
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
                  const siteUrlCol = displayHeaders.find(isSiteUrlColumn);
                  if (siteUrlCol) {
                    setVisibleColumns([siteUrlCol]);
                  } else if (displayHeaders.length > 0) {
                    setVisibleColumns(displayHeaders.slice(0, 1));
                  }
                }}
                disabled={visibleColumns.length <= 1 && visibleColumns.some(isSiteUrlColumn)}
              >
                Clear all
              </button>
            </div>
          </div>
          
          <div className="column-categories" style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "12px" }}>
            {groupedColumns.map((cat) => (
              <div key={cat.id} className="column-category-section">
                <div style={{ fontWeight: "700", fontSize: "14px", color: "#1e293b", borderBottom: "2px solid #cbd5e1", paddingBottom: "4px", marginBottom: "10px" }}>
                  {cat.name}
                </div>
                <div className="column-grid">
                  {cat.columns.map((column) => {
                    const checked = visibleColumns.includes(column);
                    const id = `col-${column.replace(/\s+/g, "-")}`;
                    return (
                      <label key={column} htmlFor={id} className="column-item">
                        <input
                          id={id} type="checkbox" checked={checked}
                          onChange={() => {
                            setVisibleColumns((prev) => {
                              if (prev.includes(column)) {
                                return prev.length === 1 ? prev : prev.filter((value) => value !== column);
                              }
                              return [...prev, column];
                            });
                            setCurrentPage(1);
                          }}
                        />
                        <span>{headerFriendlyNames[column] || column}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {renderTableBody()}
    </div>
  );

  return (
    <>
      <SideNav activeSectionId={activeSectionId} onNavigate={goToSection} />
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
        #table-scroll td.col-sticky {
          position: sticky;
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
          margin-bottom: 12px;
        }
      `}</style>

      <div className="hero-title-wrapper" id="page-top">
        <h1 style={{ margin: 0, color: "#0f172a", fontSize: "32px", fontWeight: "800" }}>GPC Compliance Data</h1>
      </div>

      {showOverview && (
        <div className="hero" id="section-overview" style={{ color: "#0f172a" }}>
          <p className="intro" style={{ color: "#0f172a", fontSize: "16px", lineHeight: "1.6" }}>
            The GPC Web Crawler analyzes websites&apos; compliance with{" "}
            <a href="https://globalprivacycontrol.org/" target="_blank" rel="noreferrer noopener" style={{ color: "#0369a1", fontWeight: "600" }}>Global Privacy Control (GPC)</a>{" "}
            at scale. GPC is a privacy preference signal that people can use to exercise their rights to opt out from web tracking.
            The GPC Web Crawler is based on <a href="https://www.selenium.dev/" target="_blank" rel="noreferrer noopener" style={{ color: "#0369a1", fontWeight: "600" }}>Selenium</a>{" "}
            and the <a href="https://github.com/privacy-tech-lab/gpc-web-crawler/tree/main/gpc-analysis-extension" target="_blank" rel="noreferrer noopener" style={{ color: "#0369a1", fontWeight: "600" }}>OptMeowt Analysis extension</a>.
            To track the evolution of GPC compliance on the web over time we are performing regular crawls of a set of 11,708 websites.
          </p>

          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", 
            gap: "24px", 
            marginTop: "28px" 
          }}>
            <button 
              onClick={() => goToSection("trends")} 
              className="card" 
              style={{ 
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "18px",
                cursor: "pointer", 
                textAlign: "left", 
                background: "#ffffff", 
                border: "1px solid #cbd5e1", 
                borderRadius: "12px", 
                padding: "28px", 
                boxShadow: "0 2px 5px rgba(0,0,0,0.06)",
                transition: "transform 0.2s, box-shadow 0.2s",
                width: "100%",
                boxSizing: "border-box"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.06)";
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f1f5f9",
                color: "#0f172a",
                borderRadius: "12px",
                padding: "16px",
                flexShrink: 0
              }}>
                <ChartIcon />
              </div>
              <div>
                <h3 style={{ margin: "0 0 12px 0", color: "#0f172a", fontSize: "22px", fontWeight: "800" }}>Trends Chart</h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", color: "#1e293b", lineHeight: "1.6" }}>
                  <li>Track historical GPC compliance trends over time</li>
                  <li>Compare response rates across US states (CA, CT, CO, NJ)</li>
                  <li>Filter graphs by compliance status or violation reasons</li>
                </ul>
              </div>
            </button>

            <button 
              onClick={() => goToSection("gpp")} 
              className="card" 
              style={{ 
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "18px",
                cursor: "pointer", 
                textAlign: "left", 
                background: "#ffffff", 
                border: "1px solid #cbd5e1", 
                borderRadius: "12px", 
                padding: "28px", 
                boxShadow: "0 2px 5px rgba(0,0,0,0.06)",
                transition: "transform 0.2s, box-shadow 0.2s",
                width: "100%",
                boxSizing: "border-box"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.06)";
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f1f5f9",
                color: "#0f172a",
                borderRadius: "12px",
                padding: "16px",
                flexShrink: 0
              }}>
                <PieIcon />
              </div>
              <div>
                <h3 style={{ margin: "0 0 12px 0", color: "#0f172a", fontSize: "22px", fontWeight: "800" }}>GPC Breakdown</h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", color: "#1e293b", lineHeight: "1.6" }}>
                  <li>Compare privacy compliance before and after GPC signals</li>
                  <li>Examine GPP string segments and US Privacy Strings (USPS)</li>
                  <li>Monitor changes in Optanon / OneTrust consent cookies</li>
                </ul>
              </div>
            </button>

            <button 
              onClick={() => goToSection("table")} 
              className="card" 
              style={{ 
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "18px",
                cursor: "pointer", 
                textAlign: "left", 
                background: "#ffffff", 
                border: "1px solid #cbd5e1", 
                borderRadius: "12px", 
                padding: "28px", 
                boxShadow: "0 2px 5px rgba(0,0,0,0.06)",
                transition: "transform 0.2s, box-shadow 0.2s",
                width: "100%",
                boxSizing: "border-box"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.06)";
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f1f5f9",
                color: "#0f172a",
                borderRadius: "12px",
                padding: "16px",
                flexShrink: 0
              }}>
                <TableIcon />
              </div>
              <div>
                <h3 style={{ margin: "0 0 12px 0", color: "#0f172a", fontSize: "22px", fontWeight: "800" }}>Data Table</h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", color: "#1e293b", lineHeight: "1.6" }}>
                  <li>Search and query specific site URLs across datasets</li>
                  <li>Customize visible columns for targeted research</li>
                  <li>Export custom-filtered web crawl data to CSV format</li>
                </ul>
              </div>
            </button>
          </div>
        </div>
      )}

      {!showOverview && (
      <ReasonTrendsChart
        viewMode={viewMode}
        tableContent={tableContent}
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
                  <p className="muted-text">Loading GPC breakdown…</p>
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
      )}
      </div>
    </>
  );
}

export default App;