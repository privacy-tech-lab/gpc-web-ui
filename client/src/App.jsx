import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import "./App.css";
import ReasonTrendsChart from "./ReasonTrendsChart.jsx";
import Tooltip from "./components/Tooltip";
import SchemaFilterPanel from "./components/SchemaFilterPanel.jsx";
import { renderJSONCell } from "./utils/renderJSONCell";
import {
  ANALYSIS_MODES,
  SCHEMA_CLASSIFICATION_COLUMN,
  getSchemaClassificationForRow,
  isSchemaRowNonCompliant,
  sortSchemaTokens,
} from "./utils/schemaClassification.js";

const PAGE_SIZE = 10;

const TIME_PERIODS = [
  { key: "Dec2023", label: "December 2023" },
  { key: "Feb2024", label: "February 2024" },
  { key: "Apr2024", label: "April 2024" },
  { key: "Jun2024", label: "June 2024" },
  { key: "FebMar2025", label: "Feb-Mar 2025" },
  { key: "May2025", label: "May 2025" },
  { key: "August2025", label: "August 2025" },
  { key: "Jan2026", label: "January 2026" },
];

const STATE_MONTHS = {
  CA: [
    "Dec2023",
    "Feb2024",
    "Apr2024",
    "Jun2024",
    "FebMar2025",
    "May2025",
    "August2025",
    "Jan2026",
  ],
  CT: ["FebMar2025", "May2025", "August2025"],
  CO: ["FebMar2025", "May2025"],
  NJ: ["August2025"],
};

const AVAILABLE_STATES = ["CA", "CT", "CO", "NJ"];

const DATA_TYPES = [
  { key: "all", label: "All data" },
  { key: "null", label: "Null sites" },
  { key: "pnc", label: "Potentially non-compliant" },
  { key: "schema-noncompliant", label: "Non-compliant (schema)", schemaOnly: true },
];

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

const STRUCTURED_COLUMNS = new Set([
  "urlclassification",
  "third_party_urls",
  "unique_ad_networks",
  "decoded_gpp_before_gpc",
  "decoded_gpp_after_gpc",
  SCHEMA_CLASSIFICATION_COLUMN.toLowerCase(),
]);

function buildPath(period, type, state) {
  if (type === "all" || type === "schema-noncompliant") {
    return `/${state}/Crawl_Data_${state} - ${period}.csv`;
  }
  if (type === "null") {
    return `/${state}/Crawl_Data_${state} - NullSites${period}.csv`;
  }
  if (type === "pnc") {
    return `/${state}/Crawl_Data_${state} - PotentiallyNonCompliantSites${period}.csv`;
  }
  return `/${state}/Crawl_Data_${state} - ${period}.csv`;
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
    // Fall through to the simple parser below.
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

function App() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTimePeriod, setSelectedTimePeriod] = useState("May2025");
  const [selectedDataType, setSelectedDataType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedState, setSelectedState] = useState("CA");
  const [analysisMode, setAnalysisMode] = useState(ANALYSIS_MODES.SCHEMA);
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [selectedSchemaTokens, setSelectedSchemaTokens] = useState([]);
  const [showFilters, setShowFilters] = useState(true);
  const [descriptionsOfColumns, setDescriptionsOfColumns] = useState({});
  const [headerFriendlyNames, setHeaderFriendlyNames] = useState({});
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const filePath = useMemo(
    () => buildPath(selectedTimePeriod, selectedDataType, selectedState),
    [selectedTimePeriod, selectedDataType, selectedState]
  );

  const allowedTimePeriods = useMemo(() => {
    const keys = STATE_MONTHS[selectedState] || [];
    return TIME_PERIODS.filter((period) => keys.includes(period.key));
  }, [selectedState]);

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
        console.warn("Failed to load column descriptions:", err);
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

  useEffect(() => {
    const allowedKeys = STATE_MONTHS[selectedState] || [];
    if (!allowedKeys.includes(selectedTimePeriod)) {
      const next =
        allowedKeys.length > 0
          ? allowedKeys[allowedKeys.length - 1]
          : selectedTimePeriod;
      setSelectedTimePeriod(next);
      setCurrentPage(1);
    }
  }, [selectedState, selectedTimePeriod]);

  useEffect(() => {
    setSelectedReasons([]);
    setSelectedSchemaTokens([]);
    setCurrentPage(1);
  }, [analysisMode]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");
    setHeaders([]);
    setRows([]);
    setSelectedReasons([]);
    setSelectedSchemaTokens([]);

    Papa.parse(filePath, {
      download: true,
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (parsed) => {
        if (cancelled) return;

        if (parsed.errors && parsed.errors.length > 0) {
          console.warn("CSV parse errors:", parsed.errors);
        }

        if (parsed.meta?.fields) {
          setHeaders(parsed.meta.fields.map((field) => String(field).trim()));
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

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const displayHeaders = useMemo(() => {
    if (headers.length > 0) return headers;
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [headers, rows]);

  useEffect(() => {
    setVisibleColumns(displayHeaders);
  }, [displayHeaders]);

  const hasSchemaColumn = displayHeaders.includes(SCHEMA_CLASSIFICATION_COLUMN);
  const schemaModeUnavailable =
    analysisMode === ANALYSIS_MODES.SCHEMA && !hasSchemaColumn;

  useEffect(() => {
    if (schemaModeUnavailable) {
      setShowColumnPicker(false);
    }
  }, [schemaModeUnavailable]);

  const rowRecords = useMemo(
    () =>
      rows.map((row) => ({
        row,
        schema: getSchemaClassificationForRow(row),
      })),
    [rows]
  );

  const schemaParseErrorCount = useMemo(
    () => rowRecords.filter((record) => record.schema.parseError).length,
    [rowRecords]
  );

  const schemaFilterMeta = useMemo(() => {
    const labels = {};
    const descriptions = {};
    const tokenSet = new Set();

    rowRecords.forEach(({ schema }) => {
      schema.tokens.forEach((token) => {
        tokenSet.add(token);
        labels[token] = schema.labels[token] || token;
        descriptions[token] = schema.descriptions[token] || "";
      });
    });

    const tokens = sortSchemaTokens(tokenSet);
    return { tokens, labels, descriptions };
  }, [rowRecords]);

  const firstStickyColumn = useMemo(() => {
    const columns =
      Array.isArray(visibleColumns) && visibleColumns.length > 0
        ? visibleColumns
        : displayHeaders;
    return columns.length > 0 ? columns[0] : undefined;
  }, [visibleColumns, displayHeaders]);

  const legacyReasonOptions = useMemo(() => {
    if (selectedDataType !== "pnc") return [];
    return PNC_REASON_LIST;
  }, [selectedDataType]);

  const filteredRecords = useMemo(() => {
    if (schemaModeUnavailable) return [];

    let base = rowRecords;
    if (
      analysisMode === ANALYSIS_MODES.LEGACY &&
      selectedDataType === "pnc" &&
      selectedReasons.length > 0
    ) {
      base = base.filter(({ row }) => {
        const reasons = parseReasons(row?.Reasons_Non_Compliant);
        return reasons.some((reason) => selectedReasons.includes(reason));
      });
    }

    // Schema-derived non-compliant filter: any did_not_opt_out status.
    if (
      analysisMode === ANALYSIS_MODES.SCHEMA &&
      selectedDataType === "schema-noncompliant"
    ) {
      base = base.filter(({ schema }) => isSchemaRowNonCompliant(schema));
    }

    if (
      analysisMode === ANALYSIS_MODES.SCHEMA &&
      selectedSchemaTokens.length > 0
    ) {
      base = base.filter(({ schema }) =>
        schema.tokens.some((token) => selectedSchemaTokens.includes(token))
      );
    }

    const query = String(searchQuery || "").trim().toLowerCase();
    if (query.length > 0) {
      base = base.filter(({ row }) => getRowSearchValue(row).includes(query));
    }

    return base;
  }, [
    analysisMode,
    isSchemaRowNonCompliant,
    rowRecords,
    schemaModeUnavailable,
    searchQuery,
    selectedDataType,
    selectedReasons,
    selectedSchemaTokens,
  ]);

  const filteredRows = useMemo(
    () => filteredRecords.map((record) => record.row),
    [filteredRecords]
  );

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);

  const pageRows = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex]
  );

  const visibleTableColumns =
    visibleColumns.length > 0 ? visibleColumns : displayHeaders;

  const showLegacyReasonFilters =
    analysisMode === ANALYSIS_MODES.LEGACY && selectedDataType === "pnc";
  const showSchemaFilters =
    analysisMode === ANALYSIS_MODES.SCHEMA && hasSchemaColumn;

  const handleExportFiltered = () => {
    try {
      const data = filteredRows.map((row) =>
        visibleTableColumns.map((header) =>
          row && row[header] != null ? String(row[header]) : ""
        )
      );
      const csv = Papa.unparse({ fields: visibleTableColumns, data });
      const blob = new Blob(["\ufeff", csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `GPC_${selectedState}_${selectedTimePeriod}_${selectedDataType}_${analysisMode}_filtered.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export CSV:", err);
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

      <div className="card card--padded mode-toolbar">
        <div className="toolbar mode-toolbar__inner">
          <label htmlFor="analysis-mode-select">Analysis Mode:</label>
          <select
            id="analysis-mode-select"
            value={analysisMode}
            onChange={(e) => setAnalysisMode(e.target.value)}
          >
            <option value={ANALYSIS_MODES.SCHEMA}>Schema classifications</option>
            <option value={ANALYSIS_MODES.LEGACY}>Legacy reasons</option>
          </select>
          <span className="mode-toolbar__hint">
            {analysisMode === ANALYSIS_MODES.LEGACY
              ? "Legacy mode uses the existing Reasons_Non_Compliant CSV columns."
              : `Schema mode uses the ${SCHEMA_CLASSIFICATION_COLUMN} column. Select \"Non-compliant (schema)\" to see sites with any Did Not Opt Out classification.`}
          </span>
        </div>
      </div>

      <ReasonTrendsChart
        analysisMode={analysisMode}
        timePeriods={TIME_PERIODS}
        stateMonths={STATE_MONTHS}
      />

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
          {AVAILABLE_STATES.map((stateCode) => (
            <option key={stateCode} value={stateCode}>
              {stateCode}
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
          {DATA_TYPES.map((type) => (
            <option
              key={type.key}
              value={type.key}
              disabled={type.schemaOnly && analysisMode !== ANALYSIS_MODES.SCHEMA}
            >
              {type.label}{type.schemaOnly && analysisMode !== ANALYSIS_MODES.SCHEMA ? " (schema mode only)" : ""}
            </option>
          ))}
        </select>

        <div className="toolbar-item-group">
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
            className="input"
          />
        </div>

        <button
          type="button"
          aria-expanded={showColumnPicker}
          aria-controls="column-picker"
          onClick={() => setShowColumnPicker((open) => !open)}
          disabled={schemaModeUnavailable || loading}
        >
          Edit Columns
        </button>
        <button
          onClick={handleExportFiltered}
          disabled={totalItems === 0 || loading || schemaModeUnavailable}
        >
          Export filtered data ({totalItems})
        </button>
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
                  if (visibleColumns.length <= 1) return;
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
            {displayHeaders.map((column) => {
              const checked = visibleColumns.includes(column);
              const id = `col-${column.replace(/\s+/g, "-")}`;
              return (
                <label key={column} htmlFor={id} className="column-item">
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setVisibleColumns((prev) => {
                        const hasColumn = prev.includes(column);
                        if (hasColumn) {
                          if (prev.length === 1) return prev;
                          return prev.filter((value) => value !== column);
                        }
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

      {showLegacyReasonFilters && (
        <div id="reason-filters" className="compact-filters">
          <div className="filter-header">
            <h3>
              Reason Filters{" "}
              {selectedReasons.length > 0 &&
                `(${selectedReasons.length} selected)`}
            </h3>
            <button
              className="toggle-filters-btn"
              onClick={() => setShowFilters((visible) => !visible)}
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
                    setSelectedReasons(legacyReasonOptions);
                    setCurrentPage(1);
                  }}
                  disabled={legacyReasonOptions.length === 0}
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
                    legacyReasonOptions.length === 0 &&
                    selectedReasons.length === 0
                  }
                >
                  Clear
                </button>
              </div>
              <div className="reason-grid">
                {legacyReasonOptions.map((reason) => {
                  const active = selectedReasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      className={`reason-filter-btn${active ? " active" : ""}`}
                      onClick={() => {
                        setCurrentPage(1);
                        setSelectedReasons((prev) =>
                          prev.includes(reason)
                            ? prev.filter((value) => value !== reason)
                            : [...prev, reason]
                        );
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

      {showSchemaFilters && (
        <SchemaFilterPanel
          schemaFilterMeta={schemaFilterMeta}
          selectedSchemaTokens={selectedSchemaTokens}
          geoStates={[selectedState]}
          onChange={(tokens) => {
            setSelectedSchemaTokens(tokens);
            setCurrentPage(1);
          }}
        />
      )}


      {loading ? (

        <div id="table-wrapper" role="status" aria-live="polite">
          <div style={{ padding: 16 }}>
            <h2>Loading CSV...</h2>
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
      ) : schemaModeUnavailable ? (
        <div id="table-wrapper" role="status" aria-live="polite">
          <div className="empty-state">
            <h2>Schema mode unavailable</h2>
            <p>
              This CSV does not yet include the future{" "}
              <code>{SCHEMA_CLASSIFICATION_COLUMN}</code> column. Switch back to
              legacy reasons to inspect this dataset.
            </p>
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
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage <= 1}
              >
                Previous
              </button>
              <span>
                Page {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
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
                  {visibleTableColumns.map((header) => (
                    <th
                      key={header}
                      className={
                        header === firstStickyColumn ? "col-sticky" : undefined
                      }
                    >
                      {descriptionsOfColumns[header] ? (
                        <div className="header-wrapper">
                          <span className="header-content">
                            {headerFriendlyNames[header] || header}
                          </span>
                          <Tooltip
                            content={descriptionsOfColumns[header]}
                            position="bottom"
                          >
                            <span className="tooltip-icon">?</span>
                          </Tooltip>
                        </div>
                      ) : (
                        <span className="header-content">
                          {headerFriendlyNames[header] || header}
                        </span>
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
                        className={
                          [
                            header === "Reasons_Non_Compliant"
                              ? "Reasons_Non_Compliant"
                              : "",
                            header === firstStickyColumn ? "col-sticky" : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                      >
                        {STRUCTURED_COLUMNS.has(String(header).toLowerCase()) ? (
                          <span className="cell-content">
                            {renderJSONCell(row[header])}
                          </span>
                        ) : (
                          <span className="cell-content">
                            {String(row[header] ?? "")}
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
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage <= 1}
              >
                Previous
              </button>
              <span>
                Page {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
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
