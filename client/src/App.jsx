import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import "./App.css";
import ReasonTrendsChart from "./ReasonTrendsChart.jsx";

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
  };

  const availableStates = ["CA", "CT", "CO"];

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

  return (
    <div className="app-container">
      <h1>GPC Crawl Data</h1>

      <p>
        The GPC Web Crawler analyzes websites' compliance with{" "}
        <a href="https://globalprivacycontrol.org/" target="_blank">
          Global Privacy Control (GPC)
        </a>{" "}
        at scale. GPC is a privacy preference signal that people can use to
        exercise their rights to opt out from web tracking. The GPC Web Crawler
        is based on{" "}
        <a href="https://www.selenium.dev/" target="_blank">
          Selenium
        </a>{" "}
        and the{" "}
        <a
          href="https://github.com/privacy-tech-lab/gpc-web-crawler/tree/main/gpc-analysis-extension"
          target="_blank"
        >
          OptMeowt Analysis extension
        </a>
        . To track the evolution of GPC compliance on the web over time we are
        performing regular crawls of a set of 11,708 websites.
      </p>
      <ReasonTrendsChart timePeriods={timePeriods} stateMonths={stateMonths} />
      <h2>Filter GPC Web Crawler Data</h2>
      <div className="controls">
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
        <label htmlFor="url-search">Search URL:</label>
        <input
          id="url-search"
          type="text"
          placeholder="e.g., example.com"
          value={searchQuery}
          onChange={(e) => {
            setCurrentPage(1);
            setSearchQuery(e.target.value);
          }}
          style={{ minWidth: 260 }}
        />
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
        <div id="table-wrapper">
          <div style={{ padding: 16 }}>
            <h2>Loading CSV…</h2>
            <p>Fetching configuration and data.</p>
          </div>
        </div>
      ) : error ? (
        <div id="table-wrapper">
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
            <div style={{ display: "flex", gap: 8 }}>
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
                  {displayHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, idx) => (
                  <tr key={idx}>
                    {displayHeaders.map((h) => (
                      <td
                        key={h}
                        className={
                          h === "Reasons_Non_Compliant"
                            ? "Reasons_Non_Compliant"
                            : undefined
                        }
                      >
                        {String(row[h] ?? "")}
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
            <div style={{ display: "flex", gap: 8 }}>
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
