import { useMemo } from "react";
import { parseSchemaToken } from "../utils/schemaClassification.js";
import Tooltip from "./Tooltip.jsx";
import SchemaFilterPanel from "./SchemaFilterPanel.jsx";

/**
 * ChartSchemaFilterPanel
 *
 * Redesigned "Chart Schema Filters" for ReasonTrendsChart.
 * Shows:
 *  - A "Quick Series" row for the special/overview chips
 *    (Potentially Non-Compliant Sites, Null Sites, Non-Compliant Sites (Schema))
 *  - In schema mode: the full hierarchical SchemaFilterPanel for token-level
 *    chart series
 *  - In legacy mode: the flat reason chip grid (unchanged from before)
 *
 * Props:
 *  seriesOptions      – array of { key, label, description }
 *  selectedSeries     – array of active keys
 *  onSelectAll        – () => void
 *  onClearAll         – () => void
 *  onToggle           – (key) => void
 *  isSchemaMode       – boolean
 */

const SPECIAL_KEYS = new Set([
  "Potentially Non-Compliant Sites",
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
  isSchemaMode,
}) {
  const selectedSet = useMemo(
    () => new Set(selectedSeries),
    [selectedSeries]
  );

  // Split options into special chips vs schema tokens vs legacy reasons
  const specialOptions = useMemo(
    () => seriesOptions.filter((o) => SPECIAL_KEYS.has(o.key)),
    [seriesOptions]
  );

  const schemaTokenOptions = useMemo(
    () =>
      isSchemaMode
        ? seriesOptions.filter((o) => !SPECIAL_KEYS.has(o.key) && parseSchemaToken(o.key))
        : [],
    [seriesOptions, isSchemaMode]
  );

  const legacyOptions = useMemo(
    () =>
      !isSchemaMode
        ? seriesOptions.filter((o) => !SPECIAL_KEYS.has(o.key))
        : [],
    [seriesOptions, isSchemaMode]
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
    // Keep non-schema items (specials + any legacy), replace schema tokens only.
    const schemaKeySet = new Set(schemaTokenOptions.map((o) => o.key));
    const kept = selectedSeries.filter((k) => !schemaKeySet.has(k));
    const nextSchemaKeys = newTokens.filter((k) => schemaKeySet.has(k));
    const merged = [...kept, ...nextSchemaKeys];
    // Apply diffs via onToggle so parent state stays consistent
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
          {isSchemaMode ? "Chart Filters" : "Chart Reason Filters"}
        </strong>
      </div>

      {/* ── Special / overview chips ── */}
      {specialOptions.length > 0 && (
        <div className="csfp__specials-section" style={{ padding: "8px 0 16px" }}>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {specialOptions.map((opt) => {
              const active = selectedSet.has(opt.key);
              
              let icon = "📊";
              let label = opt.label;
              if (opt.key === "Potentially Non-Compliant Sites") { icon = "⚠️"; label = "All Potentially Non-Compliant Sites"; }
              if (opt.key === "Null Sites") { icon = "∅"; label = "All Null Sites"; }

              return (
                <Tooltip key={opt.key} content={opt.description} position="top">
                  <div
                    className={`sfp__family-card ${active ? "sfp__family-card--on" : ""}`}
                    style={{ cursor: "pointer", flex: "1 1 0%", minWidth: "280px", margin: 0 }}
                    onClick={() => onToggle(opt.key)}
                  >
                    <div className="sfp__family-header">
                      <span className="sfp__family-label">
                        {icon} {label}
                      </span>
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
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Schema-mode: hierarchical token filter ── */}
      {isSchemaMode && schemaFilterMeta.tokens.length > 0 && (
        <div className="csfp__schema-panel">
          <SchemaFilterPanel
            schemaFilterMeta={schemaFilterMeta}
            selectedSchemaTokens={selectedSchemaTokens}
            geoStates={selectedStates}
            onChange={handleSchemaTokenChange}
          />
        </div>
      )}

      {/* ── Legacy mode: flat reason chips ── */}
      {!isSchemaMode && legacyOptions.length > 0 && (
        <div className="csfp__legacy-chips">
          {legacyOptions.map((opt) => {
            const active = selectedSet.has(opt.key);
            return (
              <Tooltip key={opt.key} content={opt.description} position="top">
                <button
                  className={`chip${active ? " chip--active" : ""}`}
                  onClick={() => onToggle(opt.key)}
                >
                  {opt.label}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
