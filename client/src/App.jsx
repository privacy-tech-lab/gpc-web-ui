import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import "./App.css";

function App() {
  const [csvUrl, setCsvUrl] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const csvUrl =
          "https://docs.google.com/spreadsheets/d/e/2PACX-1vRs7wj_geKHtEF74L5o3svZ0xUNgnKcyG1WkonRNHcDIIGO-pmX6OOd_OK-hW_m7TY3gMOwXGcQMQVF/pub?gid=793991159&single=true&output=csv";
        setCsvUrl(csvUrl);

        const csvResponse = await fetch(csvUrl, { cache: "no-store" });
        if (!csvResponse.ok) {
          throw new Error(`Failed to fetch CSV: ${csvResponse.status}`);
        }
        const csvText = await csvResponse.text();

        const parsed = Papa.parse(csvText, {
          header: true,
          dynamicTyping: false,
          skipEmptyLines: true,
        });

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
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const displayHeaders = useMemo(() => {
    if (headers.length > 0) return headers;
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [headers, rows]);

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
    <div style={{ padding: 16 }}>
      <h1>CA Data Table</h1>

      {rows.length === 0 ? (
        <p>No data rows.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {displayHeaders.map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid #ddd",
                      padding: "8px 6px",
                      background: "#f7f7f7",
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {displayHeaders.map((h) => (
                    <td
                      key={h}
                      style={{ borderBottom: "1px solid #eee", padding: "6px" }}
                    >
                      {String(row[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
