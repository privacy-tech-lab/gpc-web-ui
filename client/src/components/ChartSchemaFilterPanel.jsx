import { useMemo } from "react";
import { parseSchemaToken } from "../utils/schemaClassification.js";
import Tooltip from "./Tooltip.jsx";
import SchemaFilterPanel from "./SchemaFilterPanel.jsx";

const SPECIAL_KEYS = new Set([
  "Likely Does Not Honor GPC",
  "Likely Honors GPC",
  "Not Applicable/Invalid/Missing",
  "None",
  "Null Sites",
]);

const COMPLIANCE_SECTION_DESCRIPTION =
  "Overall GPC compliance outcome for each site, plus sites that could not be analyzed.";
const PRIVACY_SECTION_DESCRIPTION =
  "Individual opt-out signals (USPS, OptanonConsent, Well-known, GPP) that feed into the compliance results above.";

const SECTION_TITLE_STYLE = {
  margin: "0 0 8px",
  cursor: "help",
  fontSize: "0.8rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};


const SPECIAL_DESCRIPTIONS = {
  "Likely Does Not Honor GPC":
    "At least one privacy string has 'Did Not Opt Out' (excluding the Well-known endpoint).",
  "Likely Honors GPC":
    "At least one privacy string has 'Opted Out' and none have 'Did Not Opt Out' (including the Well-known endpoint).",
  "Not Applicable/Invalid/Missing":
    "No privacy string shows a clear opt-out or refusal — strings are null, invalid, missing, or not applicable.",
  "None":
    "Sites whose compliance result is recorded as None.",
  "Null Sites":
    "Sites the crawler could not reach or evaluate. Excluded from compliance analysis.",
};

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
  loading = false,
}) {
  const selectedSet = useMemo(
    () => new Set(selectedSeries),
    [selectedSeries]
  );

  const specialOptions = useMemo(
    () => seriesOptions.filter((o) => SPECIAL_KEYS.has(o.key)),
    [seriesOptions]
  );

  const schemaTokenOptions = useMemo(
    () => seriesOptions.filter((o) => !SPECIAL_KEYS.has(o.key) && parseSchemaToken(o.key)),
    [seriesOptions]
  );

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
    <div className="csfp" style={{ width: "100%", boxSizing: "border-box" }}>
      <div className="csfp__header">
        <strong className="csfp__title">
          {viewMode === "table" ? "Table Filters" : "Chart Filters"}
        </strong>
      </div>

      {specialOptions.length > 0 && (
        <div className="csfp__specials-section" style={{ padding: "8px 0 12px" }}>
          <Tooltip content={COMPLIANCE_SECTION_DESCRIPTION} position="top">
            <h4 style={SECTION_TITLE_STYLE}>Compliance Results / Null</h4>
          </Tooltip>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            {specialOptions.map((opt) => {
              const active = selectedSet.has(opt.key);
              
              let icon = "📊";
              let iconColor;
              let label = opt.label;

              if (opt.key === "Likely Does Not Honor GPC") { icon = "❌"; }
              if (opt.key === "Likely Honors GPC") { icon = "✅"; }
              if (opt.key === "Not Applicable/Invalid/Missing") { icon = "➖"; iconColor = "#1B7EB5"; }
              if (opt.key === "None") { icon = "⊘"; }
              if (opt.key === "Null Sites") { icon = "∅"; label = "Null Sites"; }

              return (
                <div
                  key={opt.key}
                  className={`sfp__family-card ${active ? "sfp__family-card--on" : ""}`}
                  style={{ cursor: "pointer", margin: 0, boxSizing: "border-box", overflow: "hidden", width: "100%" }}
                  onClick={() => onToggle(opt.key)}
                >
                <div className="sfp__family-header" style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ flex: "1 1 0%", minWidth: 0 }}>
                      <Tooltip content={SPECIAL_DESCRIPTIONS[opt.key] || opt.description} position="top">
                        <span className="sfp__family-label" style={{ whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", display: "block" }}>
                          <span style={iconColor ? { color: iconColor } : undefined}>{icon}</span> {label}
                        </span>
                      </Tooltip>
                    </div>
                    <div style={{ flexShrink: 0 }}>
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="csfp__schema-panel" style={{ width: "100%" }}>
        <Tooltip content={PRIVACY_SECTION_DESCRIPTION} position="top">
          <h4 style={SECTION_TITLE_STYLE}>Privacy Signals</h4>
        </Tooltip>
        <SchemaFilterPanel
          schemaFilterMeta={schemaFilterMeta}
          selectedSchemaTokens={selectedSchemaTokens}
          geoStates={selectedStates}
          onChange={handleSchemaTokenChange}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}