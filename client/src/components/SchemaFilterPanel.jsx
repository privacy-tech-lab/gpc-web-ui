import { useMemo, useState, useEffect } from "react";
import { parseSchemaToken, getSchemaTokenLabel } from "../utils/schemaClassification.js";
import Tooltip from "./Tooltip.jsx";
import { STATUS_COLOR_PALETTES } from "../utils/colorPalettes.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const FAMILY_CONFIG = [
  { key: "usps",           label: "USPS",                icon: "🔒" },
  { key: "optanonConsent", label: "OptanonConsent Cookie", icon: "🍪" },
  { key: "wellKnown",      label: "Well-Known Endpoint",  icon: "🌐" },
];

// Maps internal state codes → technical GPP string segment names
const GPP_STATE_NAMES = {
  US: "usnat",
  CA: "usca",
  CO: "usco",
  CT: "usct",
  VA: "usva",
  NJ: "usnj",
  TX: "ustx",
  MT: "usmt",
  OR: "usor",
};

const STATUS_CONFIG = [
  { key: "opted_out",       label: "Opted Out",      cls: "sfp__pill--green" },
  { key: "did_not_opt_out", label: "Did Not Opt Out",cls: "sfp__pill--red"   },
  { key: "invalid_missing", label: "Invalid/Missing",cls: "sfp__pill--amber" },
  { key: "invalid",         label: "Invalid",        cls: "sfp__pill--amber" },
  { key: "not_applicable",  label: "Not Applicable", cls: "sfp__pill--grey"  },
];

const GPP_FIELD_SHORT = {
  SaleOptOut:                "Sale",
  SharingOptOut:             "Sharing",
  TargetedAdvertisingOptOut: "Targeted Ads",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function familyTokens(allTokens, family) {
  if (family === "gpp") return allTokens.filter((t) => t.startsWith("gpp|"));
  return allTokens.filter((t) => t.startsWith(family + "|"));
}

function statusTokens(subset, status) {
  return subset.filter((t) => t.endsWith("|" + status));
}

function partitionGpp(allTokens) {
  // Returns { [state]: { [field]: { [status]: token } } }
  const result = {};
  allTokens.forEach((token) => {
    const parsed = parseSchemaToken(token);
    if (!parsed || parsed.family !== "gpp") return;
    const { state, field, status } = parsed;
    if (!result[state]) result[state] = {};
    if (!result[state][field]) result[state][field] = {};
    result[state][field][status] = token;
  });
  return result;
}

function sortedStates(stateMap) {
  return Object.keys(stateMap).sort((a, b) => {
    if (a === "US") return -1;
    if (b === "US") return 1;
    return a.localeCompare(b);
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PowerToggle({ on, onClick, label }) {
  return (
    <button
      className={`sfp__power-toggle ${on ? "sfp__power-toggle--on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${label}: ${on ? "on" : "off"}`}
      title={on ? "Click to turn off" : "Click to turn on (shows Opted Out by default)"}
    >
      <span className="sfp__power-thumb" />
    </button>
  );
}

function StatusPills({ subset, selectedSet, onToggle, size }) {
  return (
    <div className="sfp__statuses">
      {STATUS_CONFIG.filter((s) => statusTokens(subset, s.key).length > 0).map(
        ({ key: sk, label: sl, cls }) => {
          const st = statusTokens(subset, sk);
          const allOn = st.length > 0 && st.every((t) => selectedSet.has(t));
          const anyOn = st.some((t) => selectedSet.has(t));
          const color = (STATUS_COLOR_PALETTES[sk] && STATUS_COLOR_PALETTES[sk][0]) || "#666";
          const activeBg = allOn ? `${color}22` : undefined;
          const textColor = allOn ? "#07122b" : color;
          return (
            <button
              key={sk}
              className={[
                "sfp__status-pill",
                cls,
                size === "sm" ? "sfp__status-pill--sm" : "",
                allOn ? "sfp__status-pill--on" : "",
                anyOn && !allOn ? "sfp__status-pill--partial" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onToggle(st, allOn)}
              style={{
                borderColor: color,
                color: textColor,
                background: activeBg,
              }}
            >
              {sl}
              {anyOn && !allOn ? " ◑" : ""}
            </button>
          );
        }
      )}
    </div>
  );
}

// ─── GPP Card ─────────────────────────────────────────────────────────────────

function GppCard({ tokens, selectedSet, onToggleFamily, onAdd, onRemove, labels, isOn }) {
  const [expandedStates, setExpandedStates] = useState(new Set());
  const gppMap = useMemo(() => partitionGpp(tokens), [tokens]);
  const states = useMemo(() => sortedStates(gppMap), [gppMap]);

  const getExpectedTokensForState = (state) => {
    const stateObj = gppMap[state] || {};
    const expectedTokens = [];
    const orderedFields = ["SaleOptOut", "SharingOptOut", "TargetedAdvertisingOptOut"].filter(
      (f) => stateObj[f]
    );
    orderedFields.forEach((field) => {
      ["opted_out", "did_not_opt_out", "invalid_missing", "not_applicable"].forEach((sk) => {
        expectedTokens.push(stateObj[field]?.[sk] || `gpp|${state}|${field}|${sk}`);
      });
    });
    return expectedTokens;
  };

  function toggleFamilyStatus(subset, allOn) {
    if (allOn) onRemove(subset);
    else onAdd(subset);
  }

  function toggleState(state) {
    const stateTokens = getExpectedTokensForState(state);
    const anyOn = stateTokens.some((t) => selectedSet.has(t));
    if (anyOn) {
      onRemove(stateTokens);
    } else {
      // Default: opted_out tokens for this state
      const toAdd = stateTokens.filter((t) => t.endsWith("|opted_out"));
      onAdd(toAdd.length > 0 ? toAdd : stateTokens);
    }
  }

  function toggleStateExpand(state) {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });
  }

  function toggleSingleToken(token, isActive) {
    if (isActive) onRemove([token]);
    else onAdd([token]);
  }

  const stateButtonClass = (state) => {
    const stateTokens = getExpectedTokensForState(state);
    const anyOn = stateTokens.some((t) => selectedSet.has(t));
    const allOn = stateTokens.length > 0 && stateTokens.every((t) => selectedSet.has(t));
    if (allOn) return "sfp__state-chip sfp__state-chip--on";
    if (anyOn) return "sfp__state-chip sfp__state-chip--partial";
    return "sfp__state-chip";
  };

  return (
    <div className={`sfp__family-card sfp__family-card--gpp ${isOn ? "sfp__family-card--on" : ""}`}>
      {/* Clean header layout matching standard card structures */}
      <div className="sfp__family-header">
        <span className="sfp__family-label">📋 GPP</span>
        <PowerToggle on={isOn} onClick={() => onToggleFamily("gpp")} label="GPP" />
      </div>

      {isOn && (
        <div className="sfp__gpp-body">
          {/* Status Pills are moved down here so they don't break header toggle alignments */}
          <StatusPills
            subset={tokens}
            selectedSet={selectedSet}
            onToggle={toggleFamilyStatus}
          />

          {/* State chips */}
          <div className="sfp__gpp-states" style={{ marginTop: "12px" }}>
            {states.map((state) => (
              <div key={state} className="sfp__gpp-state-wrapper">
                <button
                  className={stateButtonClass(state)}
                  onClick={() => toggleState(state)}
                  title={state}
                >
                  {GPP_STATE_NAMES[state] || state.toLowerCase()}
                </button>
                {getExpectedTokensForState(state).some((t) => selectedSet.has(t)) && (
                  <button
                    className="sfp__state-expand"
                    onClick={() => toggleStateExpand(state)}
                    aria-label={`${expandedStates.has(state) ? "Collapse" : "Expand"} ${state} details`}
                    title={`${expandedStates.has(state) ? "Hide" : "Show"} ${state} field breakdown`}
                  >
                    {expandedStates.has(state) ? "▲" : "▼"}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Expanded field breakdown */}
          {states.some((s) => expandedStates.has(s)) && (
            <div className="sfp__gpp-detail">
              {states.map((state) => {
                if (!expandedStates.has(state)) return null;
                const stateObj = gppMap[state] || {};
                const GPP_FIELD_ORDER = [
                  "SaleOptOut",
                  "SharingOptOut",
                  "TargetedAdvertisingOptOut",
                ];
                const orderedFields = GPP_FIELD_ORDER.filter(
                  (f) => stateObj[f]
                );

                return (
                  <div key={state} className="sfp__gpp-state-detail">
                    <span className="sfp__gpp-state-label" title={state}>{GPP_STATE_NAMES[state] || state.toLowerCase()}</span>
                    <div className="sfp__gpp-fields">
                      {orderedFields.map((field) => (
                        <div key={field} className="sfp__gpp-field-row">
                          <span className="sfp__gpp-field-label">
                            {GPP_FIELD_SHORT[field] || field}
                          </span>
                          <div className="sfp__gpp-field-pills">
                            {STATUS_CONFIG.filter((sc) =>
                              ["opted_out", "did_not_opt_out", "invalid_missing", "not_applicable"].includes(sc.key)
                            ).map(({ key: sk, label: sl, cls }) => {
                              const token = stateObj[field]?.[sk] || `gpp|${state}|${field}|${sk}`;
                              const active = selectedSet.has(token);
                              return (
                                <Tooltip
                                  key={sk}
                                  content={labels[token] || getSchemaTokenLabel(token)}
                                  position="top"
                                >
                                  <button
                                    className={[
                                      "sfp__status-pill sfp__status-pill--sm",
                                      cls,
                                      active ? "sfp__status-pill--on" : "",
                                    ].join(" ")}
                                    onClick={() => toggleSingleToken(token, active)}
                                    style={{
                                      borderColor: (STATUS_COLOR_PALETTES[sk] && STATUS_COLOR_PALETTES[sk][0]) || undefined,
                                      color: active ? undefined : (STATUS_COLOR_PALETTES[sk] && STATUS_COLOR_PALETTES[sk][0]) || undefined,
                                      background: active ? (STATUS_COLOR_PALETTES[sk] && STATUS_COLOR_PALETTES[sk][0]) || undefined : undefined,
                                    }}
                                  >
                                    {sl}
                                  </button>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SchemaFilterPanel ────────────────────────────────────────────────────────

export default function SchemaFilterPanel({
  schemaFilterMeta,
  selectedSchemaTokens,
  onChange,
  geoStates, 
}) {
  const [expandedFamilies, setExpandedFamilies] = useState(new Set());
  const { tokens, labels } = schemaFilterMeta;

  const selectedSet = useMemo(
    () => new Set(selectedSchemaTokens),
    [selectedSchemaTokens]
  );

  // Sync expanded families when tokens change
  useEffect(() => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      let changed = false;
      const allFamilies = [...FAMILY_CONFIG.map(f => f.key), "gpp"];
      allFamilies.forEach((key) => {
        if (!next.has(key)) {
          const ft = familyTokens(tokens, key);
          if (ft.some((t) => selectedSchemaTokens.includes(t))) {
            next.add(key);
            changed = true;
          }
        }
      });
      return changed ? next : prev;
    });
  }, [selectedSchemaTokens, tokens]);

  // ── helpers ──

  function add(toAdd) {
    const next = new Set([...selectedSchemaTokens, ...toAdd]);
    onChange([...next]);
  }

  function remove(toRemove) {
    const removeSet = new Set(toRemove);
    onChange(selectedSchemaTokens.filter((t) => !removeSet.has(t)));
  }

  function toggleFamily(familyKey) {
    const ft = familyTokens(tokens, familyKey);
    const isOn = expandedFamilies.has(familyKey);
    const hasTokens = ft.some((t) => selectedSet.has(t));

    if (isOn) {
      if (hasTokens) remove(ft);
      setExpandedFamilies((prev) => {
        const next = new Set(prev);
        next.delete(familyKey);
        return next;
      });
    } else {
      setExpandedFamilies((prev) => {
        const next = new Set(prev);
        next.add(familyKey);
        return next;
      });

      let toAdd;
      if (familyKey === "gpp" && Array.isArray(geoStates) && geoStates.length > 0) {
        const relevantStates = new Set(["US", ...geoStates]);
        toAdd = ft.filter((t) => {
          const parsed = parseSchemaToken(t);
          return (
            parsed?.family === "gpp" &&
            relevantStates.has(parsed.state) &&
            parsed.status === "opted_out"
          );
        });
        if (toAdd.length === 0) toAdd = statusTokens(ft, "opted_out");
      } else {
        toAdd = statusTokens(ft, "opted_out");
      }

      add(toAdd.length > 0 ? toAdd : ft);
    }
  }

  function toggleStatusPills(subset, allOn) {
    if (allOn) remove(subset);
    else add(subset);
  }

  if (tokens.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px", alignItems: "start" }}>
      {FAMILY_CONFIG.map(({ key, label, icon }) => {
        const ft = familyTokens(tokens, key);
        if (ft.length === 0) return null;
        const isOn = expandedFamilies.has(key);
        return (
          <div
            key={key}
            className={`sfp__family-card ${isOn ? "sfp__family-card--on" : ""}`}
            style={{ margin: 0 }}
          >
            <div className="sfp__family-header">
              <span className="sfp__family-label">
                {icon} {label}
              </span>
              <PowerToggle
                on={isOn}
                onClick={() => toggleFamily(key)}
                label={label}
              />
            </div>
            {isOn && (
              <StatusPills
                subset={ft}
                selectedSet={selectedSet}
                onToggle={toggleStatusPills}
              />
            )}
          </div>
        );
      })}

      {familyTokens(tokens, "gpp").length > 0 && (
        <GppCard
          tokens={familyTokens(tokens, "gpp")}
          selectedSet={selectedSet}
          onToggleFamily={toggleFamily}
          onAdd={add}
          onRemove={remove}
          labels={labels}
          isOn={expandedFamilies.has("gpp")}
        />
      )}
    </div>
  );
}