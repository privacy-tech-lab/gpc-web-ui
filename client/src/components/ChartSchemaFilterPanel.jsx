import { useMemo } from "react";
import { parseSchemaToken } from "../utils/schemaClassification.js";
import Tooltip from "./Tooltip.jsx";
import SchemaFilterPanel from "./SchemaFilterPanel.jsx";

/**
 * ChartSchemaFilterPanel
 *
 * "Chart Schema Filters" for ReasonTrendsChart. Shows:
 * - A "Quick Series" section for the special/overview cards
 * (Potentially Non-Compliant Sites, Null Sites, and Top-Level Compliance Results)
 * - The full hierarchical SchemaFilterPanel for token-level chart series
 */

const SPECIAL_KEYS = new Set([
  "Potentially Non-Compliant Sites",
  "Likely Does Not Honor GPC",
  "Likely Honors GPC",
  "Not Applicable/Invalid/Missing",
  "Null Sites",
]);

function PowerToggle({ on, onClick, label }) {
  return (
    <button
      className={`sfp__power-toggle ${on ? "sfp__power-toggle--on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${label}: ${on ? "on" : "off"}`}
      title={on ? "Click to turn off" : "Click to turn on"}
    >
      <span className="sfp__power-thumb" />
    </button>
  );
}

export default function ChartSchemaFilterPanel({
  seriesOptions,
  selectedSeries,
  selectedStates,
  onToggle,
  viewMode,
}) {
  const selectedSet = useMemo(
    () => new Set(selectedSeries),
    [selectedSeries]
  );

  // Split options into special chips vs schema tokens
  const specialOptions = useMemo(
    () => seriesOptions.filter((o) => SPECIAL_KEYS.has(o.key)),
    [seriesOptions]
  );

  const schemaTokenOptions = useMemo(
    () => seriesOptions.filter((o) => !SPECIAL_KEYS.has(o.key) && parseSchemaToken(o.key)),
    [seriesOptions]
  );

  // Build schemaFilterMeta shape for SchemaFilterPanel
  const schemaFilterMeta = useMemo(() => {
    const tokens = schemaTokenOptions.map((o) => o.key);
    const labels = {};
    const descriptions = {};
    schemaTokenOptions.forEach((o) => {
      labels[o.key] = o.label;
      descriptions[o.key] = o.description;
    });
    return { tokens, labels, descriptions };
  }, [schemaTokenOptions]);

  // Compute token-level selected list (only schema tokens, not specials)
  const selectedSchemaTokens = useMemo(
    () => schemaTokenOptions.map((o) => o.key).filter((k) => selectedSet.has(k)),
    [schemaTokenOptions, selectedSet]
  );

  function handleSchemaTokenChange(newTokens) {
    const schemaKeySet = new Set(schemaTokenOptions.map((o) => o.key));
    const kept = selectedSeries.filter((k) => !schemaKeySet.has(k));
    const nextSchemaKeys = newTokens.filter((k) => schemaKeySet.has(k));
    const merged = [...kept, ...nextSchemaKeys];
    
    const prev = new Set(selectedSeries);
    const next = new Set(merged);
    schemaKeySet.forEach((k) => {
      if (prev.has(k) !== next.has(k)) onToggle(k);
    });
  }

  return (
    <div className="csfp">
      {/* ── Header / global controls ── */}
      <div className="csfp__header">
        <strong className="csfp__title">
          {viewMode === "table" ? "Table Filters" : "Chart Filters"}
        </strong>
      </div>

      {/* ── Special / overview cards, responsive grid ── */}
      {specialOptions.length > 0 && (
        <div className="csfp__specials-section" style={{ padding: "8px 0 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
            {specialOptions.map((opt) => {
              const active = selectedSet.has(opt.key);
              
              let icon = "📊";
              let label = opt.label;
              
              if (opt.key === "Potentially Non-Compliant Sites") { icon = "⚠️"; label = "All Potentially Non-Compliant Sites"; }
              if (opt.key === "Likely Does Not Honor GPC") { icon = "❌"; }
              if (opt.key === "Likely Honors GPC") { icon = "✅"; }
              if (opt.key === "Not Applicable/Invalid/Missing") { icon = "➖"; }
              if (opt.key === "Null Sites") { icon = "∅"; label = "All Null Sites"; }

              return (
                <div
                  key={opt.key}
                  className={`sfp__family-card ${active ? "sfp__family-card--on" : ""}`}
                  style={{ cursor: "pointer", margin: 0, width: "100%", boxSizing: "border-box" }}
                  onClick={() => onToggle(opt.key)}
                >
                  <div className="sfp__family-header">
                    {/* Tooltip isolated safely inside the text item layout wrapper */}
                    <Tooltip content={opt.description} position="top">
                      <span className="sfp__family-label" style={{ whiteSpace: "nowrap" }}>
                        {icon} {label}
                      </span>
                    </Tooltip>
                    <PowerToggle
                      on={active}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(opt.key);
                      }}
                      label={label}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Hierarchical token filter ── */}
      {schemaFilterMeta.tokens.length > 0 && (
        <div className="csfp__schema-panel">
          <SchemaFilterPanel
            schemaFilterMeta={schemaFilterMeta}
            selectedSchemaTokens={selectedSchemaTokens}
            geoStates={selectedStates}
            onChange={handleSchemaTokenChange}
          />
        </div>
      )}
    </div>
  );
}