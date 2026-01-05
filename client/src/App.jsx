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
    NJ: ["August2025"],
  };

  const availableStates = ["CA", "CT", "CO", "NJ"];

  const headerFriendlyNames = {
    "Site URL": "Site URL",
    "site_id": "Site ID",
    "status": "Status",
    "domain": "Domain",
    "sent_gpc": "GPC Signal Sent",
    "gpp_version": "GPP Version",
    "uspapi_before_gpc": "USP API (Before GPC)",
    "uspapi_after_gpc": "USP API (After GPC)",
    "usp_cookies_before_gpc": "USP Cookies (Before GPC)",
    "usp_cookies_after_gpc": "USP Cookies (After GPC)",
    "OptanonConsent_before_gpc": "Optanon Consent (Before GPC)",
    "OptanonConsent_after_gpc": "Optanon Consent (After GPC)",
    "gpp_before_gpc": "GPP String (Before GPC)",
    "gpp_after_gpc": "GPP String (After GPC)",
    "urlClassification": "URL Classification",
    "OneTrustWPCCPAGoogleOptOut_before_gpc": "OneTrust CCPA OptOut (Before)",
    "OneTrustWPCCPAGoogleOptOut_after_gpc": "OneTrust CCPA OptOut (After)",
    "OTGPPConsent_before_gpc": "OneTrust GPP Consent (Before)",
    "OTGPPConsent_after_gpc": "OneTrust GPP Consent (After)",
    "usps_before_gpc": "US Privacy String (Before)",
    "usps_after_gpc": "US Privacy String (After)",
    "decoded_gpp_before_gpc": "Decoded GPP (Before)",
    "decoded_gpp_after_gpc": "Decoded GPP (After)",
    "USPS implementation": "USPS Implementation",
    "error": "Error",
    "Well-known": "Well-Known Resource",
    "Tranco": "Tranco Rank",
    "third_party_count": "Third-Party Count",
    "third_party_urls": "Third-Party URLs",
    "unique_ad_networks": "Unique Ad Networks",
    "num_unique_ad_networks": "Ad Networks Count",
  };

  const headerDefinitions = {
    "Site URL": "The full URL of the website that was analyzed by the crawler.",
    "site_id": "A unique numerical identifier assigned to the site within the dataset.",
    "status": "The current processing status of the site (e.g., 'added', 'not added').",
    "domain": "The root domain name of the site (e.g., 'example.com').",
    "sent_gpc": "Indicates whether the Global Privacy Control (GPC) signal was effectively sent to the site during the crawl.",
    "gpp_version": "The version of the IAB Global Privacy Platform (GPP) detected on the site.",
    "uspapi_before_gpc": "The value returned by the U.S. Privacy API (__uspapi) BEFORE the GPC signal was sent. This API allows vendors to query a user's privacy preferences.",
    "uspapi_after_gpc": "The value returned by the U.S. Privacy API (__uspapi) AFTER the GPC signal was sent. A change here often indicates the site reacted to the GPC signal. If this is '1YNN' or '1YNY and other fields also don't recognize the GPC signal, we consider it a potential non-compliance.",
    "usp_cookies_before_gpc": "The content of the 'usprivacy' cookie BEFORE the GPC signal was sent. This cookie stores the U.S. Privacy String.",
    "usp_cookies_after_gpc": "The content of the 'usprivacy' cookie AFTER the GPC signal was sent. Sites may update this to '1YYN' to reflect an opt-out. If this is '1YNN' or '1YNY and other fields also don't recognize the GPC signal, we consider it a potential non-compliance.",
    "OptanonConsent_before_gpc": "The value of the OneTrust 'OptanonConsent' cookie BEFORE the GPC signal. This cookie manages user consent preferences.",
    "OptanonConsent_after_gpc": "The value of the OneTrust 'OptanonConsent' cookie AFTER the GPC signal. We look for 'isGpcEnabled=1' to see if GPC is respected. If 'isGpcEnabled=0' and other fields also don't recognize the GPC signal, we consider it a potential non-compliance.",
    "gpp_before_gpc": "The raw IAB Global Privacy Platform (GPP) string detected BEFORE the GPC signal was sent.",
    "gpp_after_gpc": "The raw IAB Global Privacy Platform (GPP) string detected AFTER the GPC signal was sent.",
    "urlClassification": "Categorization of the URLs on the page by Firefox (e.g. 'tracking_ads' vs 'tracking_social').",
    "OneTrustWPCCPAGoogleOptOut_before_gpc": "Status of the OneTrust CCPA Google Opt-Out mechanism BEFORE GPC signal.",
    "OneTrustWPCCPAGoogleOptOut_after_gpc": "Status of the OneTrust CCPA Google Opt-Out mechanism AFTER GPC signal.",
    "OTGPPConsent_before_gpc": "OneTrust-specific GPP consent status BEFORE GPC signal.",
    "OTGPPConsent_after_gpc": "OneTrust-specific GPP consent status AFTER GPC signal.",
    "usps_before_gpc": "The U.S. Privacy String (USPS) detected BEFORE GPC. Character 3 ('Y'/'N') indicates if the user has opted out of sale. For example, '1YYN' indicates the user was opted out of sale, while '1YNN' indicates they were not.",
    "usps_after_gpc": "The U.S. Privacy String (USPS) detected AFTER GPC. We check if the 3rd character changes to 'Y' such as '1NNN' -> '1NYN' (Yes, opted out). If it is 'N' (No, not opted out) and other fields also don't recognize the GPC signal, we consider it a potential non-compliance.",
    "decoded_gpp_before_gpc": "The human-readable contents of the GPP string (decoded) BEFORE GPC. Shows which sections (e.g., uscav1) are present.",
    "decoded_gpp_after_gpc": "The human-readable contents of the GPP string (decoded) AFTER GPC. We check for 'SaleOptOut' or 'SharingOptOut' flags here.",
    "USPS implementation": "Details on how the site implements the US Privacy String (e.g., via API, Cookie, or both).",
    "error": "Any error message logged during the crawl (e.g., timeouts, connection refusals).",
    "Well-known": "Status of the /.well-known/gpc.json resource, which allows sites to publicly declare GPC support.",
    "Tranco": "The site's traffic rank from the Tranco list. Lower numbers mean higher traffic.",
    "third_party_count": "The total number of unique third-party domains detected on the site.",
    "third_party_urls": "A list of the specific third-party URLs that were detected.",
    "unique_ad_networks": "Names of unique advertising networks identified on the site.",
    "num_unique_ad_networks": "The count of unique advertising networks identified.",
  };

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
                      {headerDefinitions[h] ? (
                        <div className="header-wrapper">
                          <span className="header-content">
                            {headerFriendlyNames[h] || h}
                          </span>
                          <span className="tooltip-container">
                            <span className="tooltip-icon">?</span>
                            <span className="tooltip-text">
                              {headerDefinitions[h]}
                            </span>
                          </span>
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
                        <span className="cell-content">
                          {String(row[h] ?? "")}
                        </span>
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
