import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import "./App.css";

function App() {
  const [csvUrl, setCsvUrl] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const datasets = useMemo(
    () => [
      {
        key: "all",
        label: "All data",
        path: "/Crawl_Data_CA - May2025.csv",
      },
      {
        key: "null",
        label: "Null sites",
        path: "/Crawl_Data_CA - NullSitesMay2025.csv",
      },
      {
        key: "pnc",
        label: "Potentially non-compliant",
        path: "/Crawl_Data_CA - PotentiallyNonCompliantSitesMay2025.csv",
      },
    ],
    []
  );
  const [selectedDataset, setSelectedDataset] = useState("all");
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
      const ds = datasets.find((d) => d.key === selectedDataset) || datasets[0];
      const publicCsvPath = ds.path;
      setCsvUrl(`public:${publicCsvPath}`);
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
  }, [selectedDataset, datasets]);

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
      "WellKnown",
      "Invalid_WellKnown",
      "SegmentSwitchGPP",
    ],
    []
  );

  const reasonOptions = useMemo(() => {
    if (selectedDataset !== "pnc") return [];
    return pncReasonList;
  }, [selectedDataset, pncReasonList]);

  const filteredRows = useMemo(() => {
    if (selectedDataset !== "pnc") return rows;
    if (!selectedReasons || selectedReasons.length === 0) return rows;
    return rows.filter((row) => {
      const reasons = parseReasons(row?.Reasons_Non_Compliant);
      return reasons.some((r) => selectedReasons.includes(r));
    });
  }, [rows, selectedDataset, selectedReasons]);

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageRows = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex]
  );

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Loading CSV…</h1>
        <p>Fetching configuration and data.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Error</h1>
        <pre>{error}</pre>
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1>CA Data Table</h1>
      <div className="controls">
        <label htmlFor="dataset-select">Dataset:</label>
        <select
          id="dataset-select"
          value={selectedDataset}
          onChange={(e) => {
            setSelectedDataset(e.target.value);
            setCurrentPage(1);
          }}
        >
          {datasets.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {selectedDataset === "pnc" && (
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

      {filteredRows.length === 0 ? (
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
