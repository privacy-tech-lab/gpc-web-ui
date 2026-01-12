import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import "./App.css";
import ReasonTrendsChart from "./ReasonTrendsChart.jsx";
import Tooltip from "./components/Tooltip";

function App() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const timePeriods = useMemo(
    () => [
      { key: "Dec2023", label: "December 2023" },
      { key: "Feb2024", label: "February 2024" },
      { key: "Apr2024", label: "April 2024" },
      { key: "Jun2024", label: "June 2024" },
      { key: "FebMar2025", label: "Feb-Mar 2025" },
      { key: "May2025", label: "May 2025" },
      { key: "August2025", label: "August 2025" },
    ],
    []
  );
  const stateMonths = {
    CA: [
      "Dec2023",
      "Feb2024",
      "Apr2024",
      "Jun2024",
      "FebMar2025",
      "May2025",
      "August2025",
    ],
    CT: ["FebMar2025", "May2025", "August2025"],
    CO: ["FebMar2025", "May2025"],
    NJ: ["August2025"],
  };

  const availableStates = ["CA", "CT", "CO", "NJ"];

  const [descriptionsOfColumns, setDescriptionsOfColumns] = useState({});
  const [headerFriendlyNames, setHeaderFriendlyNames] = useState({});
  useEffect(() => {
    let cancelled = false;
    fetch("/descriptions_of_columns.json")
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(
              new Error("Failed to load descriptions_of_columns.json")
            )
      )
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          setDescriptionsOfColumns(data);
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
    fetch("/header_friendly_names.json")
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(
              new Error("Failed to load header_friendly_names.json")
            )
      )
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          setHeaderFriendlyNames(data);
        }
      })
      .catch((err) => {
        console.warn("Failed to load header friendly names:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dataTypes = useMemo(
    () => [
      { key: "all", label: "All data" },
      { key: "null", label: "Null sites" },
      { key: "pnc", label: "Potentially non-compliant" },
    ],
    []
  );

  const [selectedTimePeriod, setSelectedTimePeriod] = useState("May2025");
  const [selectedDataType, setSelectedDataType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedState, setSelectedState] = useState("CA");

  const getFilePath = useMemo(() => {
    const buildPath = (period, type, state) => {
      if (type === "all") {
        return `/${state}/Crawl_Data_${state} - ${period}.csv`;
      } else if (type === "null") {
        return `/${state}/Crawl_Data_${state} - NullSites${period}.csv`;
      } else if (type === "pnc") {
        return `/${state}/Crawl_Data_${state} - PotentiallyNonCompliantSites${period}.csv`;
      }
      return `/${state}/Crawl_Data_${state} - ${period}.csv`;
    };
    return buildPath(selectedTimePeriod, selectedDataType, selectedState);
  }, [selectedTimePeriod, selectedDataType, selectedState]);

  // Periods allowed for the currently selected state
  const allowedTimePeriods = useMemo(() => {
    const keys = stateMonths[selectedState] || [];
    const allowed = timePeriods.filter((p) => keys.includes(p.key));
    return allowed;
  }, [selectedState, stateMonths, timePeriods]);

  // Ensure selected time period is valid when state changes
  useEffect(() => {
    const allowedKeys = stateMonths[selectedState] || [];
    if (!allowedKeys.includes(selectedTimePeriod)) {
      // Default to the last available (usually most recent) for that state
      const next =
        allowedKeys.length > 0
          ? allowedKeys[allowedKeys.length - 1]
          : selectedTimePeriod;
      setSelectedTimePeriod(next);
      setCurrentPage(1);
    }
  }, [selectedState]);
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [showFilters, setShowFilters] = useState(true);

  function parseReasons(value) {
    if (!value) return [];
    if (Array.isArray(value))
      return value.map((v) => String(v).trim()).filter(Boolean);
    const str = String(value).trim();
    // Normalize single-quoted list to JSON and parse
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
    } catch (_) {
      // Fallback: comma-split
    }
    return str
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.replace(/^[\s'\"]+|[\s'\"]+$/g, "").trim())
      .filter(Boolean);
  }

  useEffect(() => {
    function loadData() {
      // Load CSV from the public folder using Papa directly (no manual fetch)
      const publicCsvPath = getFilePath;
      setLoading(true);
      setError("");
      setHeaders([]);
      setRows([]);
      setSelectedReasons([]);

      Papa.parse(publicCsvPath, {
        download: true,
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (parsed) => {
          if (parsed.errors && parsed.errors.length) {
            console.warn("CSV parse errors:", parsed.errors);
          }

          // Set headers from CSV if available
          if (parsed.meta && parsed.meta.fields) {
            setHeaders(parsed.meta.fields.map((h) => String(h).trim()));
          }

          const normalizedRows = (parsed.data || []).map((row) => {
            const normalized = {};
            Object.keys(row).forEach((key) => {
              const trimmedKey = String(key).trim();
              normalized[trimmedKey] = row[key];
            });
            return normalized;
          });

          setRows(normalizedRows);
          setLoading(false);
        },
        error: (err) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        },
      });
    }

    loadData();
  }, [selectedTimePeriod, selectedDataType, getFilePath]);

  const displayHeaders = useMemo(() => {
    if (headers.length > 0) return headers;
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [headers, rows]);

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  useEffect(() => {
    setVisibleColumns(displayHeaders);
  }, [displayHeaders]);
  const firstStickyColumn = useMemo(() => {
    const cols =
      Array.isArray(visibleColumns) && visibleColumns.length > 0
        ? visibleColumns
        : displayHeaders;
    return cols && cols.length > 0 ? cols[0] : undefined;
  }, [visibleColumns, displayHeaders]);

  const structuredColumns = useMemo(
    () => new Set(["urlclassification", "third_party_urls"]),
    []
  );

  const pncReasonList = useMemo(
    () => [
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
    ],
    []
  );

  const reasonOptions = useMemo(() => {
    if (selectedDataType !== "pnc") return [];
    return pncReasonList;
  }, [selectedDataType, pncReasonList]);

  const filteredRows = useMemo(() => {
    let base = rows;
    if (
      selectedDataType === "pnc" &&
      selectedReasons &&
      selectedReasons.length > 0
    ) {
      base = base.filter((row) => {
        const reasons = parseReasons(row?.Reasons_Non_Compliant);
        return reasons.some((r) => selectedReasons.includes(r));
      });
    }
    const q = String(searchQuery || "")
      .trim()
      .toLowerCase();
    if (q.length > 0) {
      base = base.filter((row) =>
        String(row?.["Site URL"] ?? "")
          .toLowerCase()
          .includes(q)
      );
    }
    return base;
  }, [rows, selectedDataType, selectedReasons, searchQuery]);

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageRows = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex]
  );

  function renderJSONCell(raw) {
    try {
      const parseJsonLike = (input) => {
        if (typeof input !== "string") return input;
        const s = input.trim();
        try {
          return JSON.parse(s);
        } catch {
          // Try to normalize Python/JSON-ish strings with single quotes and None/True/False
          const normalized = s
            .replace(/'/g, '"')
            .replace(/\bNone\b/g, "null")
            .replace(/\bTrue\b/g, "true")
            .replace(/\bFalse\b/g, "false");
          try {
            return JSON.parse(normalized);
          } catch {
            return input;
          }
        }
      };

      const obj = typeof raw === "string" ? parseJsonLike(raw) : raw;
      if (!obj || typeof obj !== "object") return String(raw ?? "");

      const humanizeKey = (key) => {
        return String(key || "")
          .replace(/_/g, " ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\b\w/g, (c) => c.toUpperCase());
      };

      // Normalize values into string lists (arrays or object-of-arrays)
      const toStringList = (value) => {
        if (Array.isArray(value)) return value.map((v) => String(v));
        if (value && typeof value === "object") {
          const out = [];
          for (const subVal of Object.values(value)) {
            if (Array.isArray(subVal))
              out.push(...subVal.map((v) => String(v)));
            else if (typeof subVal === "string") out.push(subVal);
            else if (typeof subVal === "number" || typeof subVal === "boolean")
              out.push(String(subVal));
          }
          return out;
        }
        if (value == null) return [];
        if (typeof value === "string") {
          const s = value.trim();
          const parsed = parseJsonLike(s);
          if (Array.isArray(parsed)) return parsed.map((v) => String(v));
          if (s.includes(",") || s.includes(";")) {
            return s
              .split(/[,;]+/)
              .map((part) => part.trim())
              .filter(Boolean);
          }
          return [s];
        }
        return [String(value)];
      };

      const rows = [];
      for (const [topKey, topVal] of Object.entries(obj)) {
        if (topVal && typeof topVal === "object" && !Array.isArray(topVal)) {
          const subEntries = Object.entries(topVal);
          if (subEntries.length === 0) {
            rows.push(
              <div key={`row-${topKey}`} className="uc-row">
                <span className="uc-label">{humanizeKey(topKey)}:</span>
                <span className="uc-domains">None</span>
              </div>
            );
          } else {
            for (const [subKey, subVal] of subEntries) {
              const items = toStringList(subVal);
              rows.push(
                <div key={`row-${topKey}-${subKey}`} className="uc-row">
                  <span className="uc-label">{humanizeKey(subKey)}:</span>
                  <span className="uc-domains">
                    {items.length > 0 ? items.join(", ") : "None"}
                  </span>
                </div>
              );
            }
          }
        } else {
          const items = toStringList(topVal);
          rows.push(
            <div key={`row-${topKey}`} className="uc-row">
              <span className="uc-label">{humanizeKey(topKey)}:</span>
              <span className="uc-domains">
                {items.length > 0 ? items.join(", ") : "None"}
              </span>
            </div>
          );
        }
      }

      return rows.length > 0 ? <>{rows}</> : "None";
    } catch {
      return String(raw ?? "");
    }
  }

  const handleExportFiltered = () => {
    try {
      const cols =
        Array.isArray(visibleColumns) && visibleColumns.length > 0
          ? visibleColumns
          : displayHeaders;
      const data = filteredRows.map((row) =>
        cols.map((h) => (row && row[h] != null ? String(row[h]) : ""))
      );
      const csv = Papa.unparse({ fields: cols, data });
      const blob = new Blob(["\ufeff", csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const filename = `GPC_${selectedState}_${selectedTimePeriod}_${selectedDataType}_filtered.csv`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export CSV:", e);
    }
  };

  return (
    <div className="app-container">
      <div className="hero">
        <h1>GPC Crawl Data</h1>
        <p className="intro">
          The GPC Web Crawler analyzes websites' compliance with{" "}
          <a
            href="https://globalprivacycontrol.org/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Global Privacy Control (GPC)
          </a>{" "}
          at scale. GPC is a privacy preference signal that people can use to
          exercise their rights to opt out from web tracking. The GPC Web
          Crawler is based on{" "}
          <a
            href="https://www.selenium.dev/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Selenium
          </a>{" "}
          and the{" "}
          <a
            href="https://github.com/privacy-tech-lab/gpc-web-crawler/tree/main/gpc-analysis-extension"
            target="_blank"
            rel="noreferrer noopener"
          >
            OptMeowt Analysis extension
          </a>
          . To track the evolution of GPC compliance on the web over time we are
          performing regular crawls of a set of 11,708 websites.
        </p>
      </div>
      <ReasonTrendsChart timePeriods={timePeriods} stateMonths={stateMonths} />
      <h2 className="section-title">Filter GPC Web Crawler Data</h2>
      <div className="toolbar" role="group" aria-label="Data filters">
        <label htmlFor="state-select">State:</label>
        <select
          id="state-select"
          value={selectedState}
          onChange={(e) => {
            setSelectedState(e.target.value);
            setCurrentPage(1);
          }}
        >
          {availableStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label htmlFor="time-period-select">Time Period:</label>
        <select
          id="time-period-select"
          value={selectedTimePeriod}
          onChange={(e) => {
            setSelectedTimePeriod(e.target.value);
            setCurrentPage(1);
          }}
        >
          {allowedTimePeriods.map((period) => (
            <option key={period.key} value={period.key}>
              {period.label}
            </option>
          ))}
        </select>

        <label htmlFor="data-type-select">Data Type:</label>
        <select
          id="data-type-select"
          value={selectedDataType}
          onChange={(e) => {
            setSelectedDataType(e.target.value);
            setCurrentPage(1);
          }}
        >
          {dataTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </select>
        <div className="toolbar-item-group">
          <label htmlFor="url-search">Search URL:</label>{" "}
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
          />
        </div>
        <button
          type="button"
          aria-expanded={showColumnPicker}
          aria-controls="column-picker"
          onClick={() => setShowColumnPicker((s) => !s)}
        >
          Edit Columns
        </button>
        <button
          onClick={handleExportFiltered}
          disabled={totalItems === 0 || loading}
        >
          Export filtered data ({totalItems})
        </button>
      </div>
      {showColumnPicker && (
        <div
          id="column-picker"
          className="card card--padded column-picker"
          role="group"
          aria-label="Toggle columns"
        >
          <div className="column-picker-header">
            <strong>Select columns to display</strong>
            <div className="column-picker-actions">
              <button
                type="button"
                className="compact-btn"
                onClick={() => setVisibleColumns(displayHeaders)}
                disabled={displayHeaders.length === 0}
              >
                Select all
              </button>
              <button
                type="button"
                className="compact-btn"
                onClick={() => {
                  // Keep at least one column selected; if only one, do nothing
                  if (visibleColumns.length <= 1) return;
                  // Clear down to the first header to keep one visible
                  setVisibleColumns((prev) =>
                    prev.length > 0 ? [prev[0]] : displayHeaders.slice(0, 1)
                  );
                }}
                disabled={visibleColumns.length <= 1}
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="column-grid">
            {displayHeaders.map((col) => {
              const checked = visibleColumns.includes(col);
              const id = `col-${col.replace(/\s+/g, "-")}`;
              return (
                <label key={col} htmlFor={id} className="column-item">
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setVisibleColumns((prev) => {
                        const has = prev.includes(col);
                        if (has) {
                          // Do not allow removing the last visible column
                          if (prev.length === 1) return prev;
                          return prev.filter((c) => c !== col);
                        }
                        return [...prev, col];
                      });
                      setCurrentPage(1);
                    }}
                  />
                  <span>{col}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-value">{totalItems.toLocaleString()}</div>
          <div className="kpi-label">Sites (after filters)</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">
            {totalItems > 0 ? `${startIndex + 1}-${endIndex}` : "0-0"}
          </div>
          <div className="kpi-label">Sites on this page</div>
        </div>
      </div>

      {selectedDataType === "pnc" && (
        <div id="reason-filters" className="compact-filters">
          <div className="filter-header">
            <h3>
              Reason Filters{" "}
              {selectedReasons.length > 0 &&
                `(${selectedReasons.length} selected)`}
            </h3>
            <button
              className="toggle-filters-btn"
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : "Show Filters"}
            </button>
          </div>
          {showFilters && (
            <div className="filter-content">
              <div className="filter-controls">
                <button
                  className="compact-btn"
                  onClick={() => {
                    setSelectedReasons(reasonOptions);
                    setCurrentPage(1);
                  }}
                  disabled={reasonOptions.length === 0}
                >
                  All
                </button>
                <button
                  className="compact-btn"
                  onClick={() => {
                    setSelectedReasons([]);
                    setCurrentPage(1);
                  }}
                  disabled={
                    reasonOptions.length === 0 && selectedReasons.length === 0
                  }
                >
                  Clear
                </button>
              </div>
              <div className="reason-grid">
                {reasonOptions.map((reason) => {
                  const active = selectedReasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      className={`reason-filter-btn${active ? " active" : ""}`}
                      onClick={() => {
                        setCurrentPage(1);
                        setSelectedReasons((prev) => {
                          const has = prev.includes(reason);
                          if (has) return prev.filter((r) => r !== reason);
                          return [...prev, reason];
                        });
                      }}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div id="table-wrapper" role="status" aria-live="polite">
          <div style={{ padding: 16 }}>
            <h2>Loading CSV…</h2>
            <p>Fetching configuration and data.</p>
          </div>
        </div>
      ) : error ? (
        <div id="table-wrapper" role="status" aria-live="polite">
          <div style={{ padding: 16, color: "#b00020" }}>
            <h2>Error</h2>
            <pre>{error}</pre>
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        <p>No data rows.</p>
      ) : (
        <div id="table-wrapper">
          <div id="pager">
            <div>
              {totalItems > 0 && (
                <span>
                  Showing {startIndex + 1}-{endIndex} of {totalItems}
                </span>
              )}
            </div>
            <div className="pager-actions">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
              >
                Previous
              </button>
              <span>
                Page {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={safeCurrentPage >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
          <div id="table-scroll">
            <table>
              <thead>
                <tr>
                  {(visibleColumns.length > 0
                    ? visibleColumns
                    : displayHeaders
                  ).map((h) => (
                    <th
                      key={h}
                      className={
                        h === firstStickyColumn ? "col-sticky" : undefined
                      }
                    >
                      {descriptionsOfColumns[h] ? (
                        <div className="header-wrapper">
                          <span className="header-content">
                            {headerFriendlyNames[h] || h}
                          </span>
                          <Tooltip
                            content={descriptionsOfColumns[h]}
                            position="bottom"
                          >
                            <span className="tooltip-icon">?</span>
                          </Tooltip>
                        </div>
                      ) : (
                        <span className="header-content">
                          {headerFriendlyNames[h] || h}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, idx) => (
                  <tr key={idx}>
                    {(visibleColumns.length > 0
                      ? visibleColumns
                      : displayHeaders
                    ).map((h) => (
                      <td
                        key={h}
                        className={
                          [
                            h === "Reasons_Non_Compliant"
                              ? "Reasons_Non_Compliant"
                              : "",
                            h === firstStickyColumn ? "col-sticky" : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      >
                        {h && structuredColumns.has(String(h).toLowerCase()) ? (
                          <span className="cell-content">
                            {renderJSONCell(row[h])}
                          </span>
                        ) : (
                          <span className="cell-content">
                            {String(row[h] ?? "")}
                          </span>
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
                <span>
                  Showing {startIndex + 1}-{endIndex} of {totalItems}
                </span>
              )}
            </div>
            <div className="pager-actions">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
              >
                Previous
              </button>
              <span>
                Page {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={safeCurrentPage >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
