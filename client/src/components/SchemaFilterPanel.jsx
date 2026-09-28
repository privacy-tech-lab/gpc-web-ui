import { useMemo, useState, useEffect } from "react";
import { parseSchemaToken, getSchemaTokenLabel } from "../utils/schemaClassification.js";
import Tooltip from "./Tooltip.jsx";
import { STATUS_COLOR_PALETTES } from "../utils/colorPalettes.js";

const FAMILY_CONFIG = [
  { key: "usps",           label: "USPS",                icon: "🔒" },
  { key: "optanonConsent", label: "OptanonConsent Cookie", icon: "🍪" },
  { key: "wellKnown",      label: "Well-Known Endpoint",  icon: "🌐" },
];

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

const GPP_SECTION_TO_STATE_CODE = Object.fromEntries(
  Object.entries(GPP_STATE_NAMES).map(([code, section]) => [section, code])
);

function normalizeStateCode(state) {
  return GPP_SECTION_TO_STATE_CODE[state] || state;
}

const NAT_ALL_FIELDS = ["SaleOptOut", "SharingOptOut", "TargetedAdvertisingOptOut"];
const STATE_CA_FIELDS = ["SaleOptOut", "SharingOptOut"];
const STATE_OTHER_FIELDS = ["SaleOptOut", "TargetedAdvertisingOptOut"];

function stateFieldsForState(state) {
  return normalizeStateCode(state) === "CA" ? STATE_CA_FIELDS : STATE_OTHER_FIELDS;
}

function fieldsForState(state) {
  return normalizeStateCode(state) === "US" ? NAT_ALL_FIELDS : stateFieldsForState(state);
}

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

const GPP_USNAT_FIELD_NOTES = {
  SharingOptOut:             "Only legally applies to CA",
  TargetedAdvertisingOptOut: "Does not legally apply to CA",
};

const GPP_USNAT_TABLE_SHARING_EXCEPTIONS = new Set(["CT", "CO", "NJ"]);

function usnatTableFieldNote(field, tableState) {
  if (field === "SharingOptOut" && GPP_USNAT_TABLE_SHARING_EXCEPTIONS.has(tableState)) {
    return `Does not legally apply to ${tableState}`;
  }
  if (field === "TargetedAdvertisingOptOut" && tableState === "CA") {
    return "Does not legally apply to CA";
  }
  return null;
}

const FAMILY_DESCRIPTIONS = {
  usps: "The US Privacy String (USPS) is a legacy consent signal used by sites to communicate a user's privacy choices.",
  optanonConsent: "The OptanonConsent cookie is OneTrust's mechanism for storing and communicating a user's consent preferences across a site.",
  wellKnown: "The well-known endpoint is a file sites publish to declare their GPC policy — whether they intend to honor opt-out signals.",
  gpp: "The Global Privacy Platform (GPP) string is a standardized consent signal covering multiple US state privacy laws, with separate sections per state.",
};

const STATUS_DESCRIPTIONS = {
  usps: {
    opted_out: "The site opted the user out of sale after receiving the GPC signal.",
    did_not_opt_out: "The site did not opt the user out of sale after receiving the GPC signal.",
    invalid_missing: "USPS string was invalid or missing after the GPC signal.",
    not_applicable: "USPS declares this privacy regulation is not applicable to this site.",
  },
  optanonConsent: {
    opted_out: "OptanonConsent cookie was updated to reflect opt-out after the GPC signal.",
    did_not_opt_out: "OptanonConsent cookie was not updated after the GPC signal.",
    invalid_missing: "OptanonConsent cookie was invalid or missing after the GPC signal.",
  },
  wellKnown: {
    opted_out: "The well-known endpoint signals this site honors GPC.",
    did_not_opt_out: "The well-known endpoint signals the site does not honor GPC — this likely means GPC is not applicable to the site rather than non-compliance.",
    invalid_missing: "The well-known endpoint was missing or invalid after the GPC signal.",
    not_applicable: "The well-known endpoint declares GPC is not applicable to this site.",
  },
};

function familyTokens(allTokens, family) {
  if (family === "gpp") return allTokens.filter((t) => t.startsWith("gpp|"));
  return allTokens.filter((t) => t.startsWith(family + "|"));
}

function statusTokens(subset, status) {
  return subset.filter((t) => t.endsWith("|" + status));
}

function partitionGpp(allTokens) {
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
    const na = normalizeStateCode(a);
    const nb = normalizeStateCode(b);
    if (na === "US") return -1;
    if (nb === "US") return 1;
    return na.localeCompare(nb);
  });
}

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

function StatusPills({ subset, selectedSet, onToggle, size, descriptions = {} }) {
  const visible = STATUS_CONFIG.filter((s) => statusTokens(subset, s.key).length > 0);
  return (
    <div className="sfp__statuses">
      {visible.map(({ key: sk, label: sl, cls }) => {
        const st = statusTokens(subset, sk);
        const allOn = st.length > 0 && st.every((t) => selectedSet.has(t));
        const anyOn = st.some((t) => selectedSet.has(t));
        const siblingTokens = visible
          .filter((s) => s.key !== sk)
          .flatMap((s) => statusTokens(subset, s.key));
        const color = (STATUS_COLOR_PALETTES[sk] && STATUS_COLOR_PALETTES[sk][0]) || "#666";
        const activeBg = allOn ? `${color}22` : undefined;
        const textColor = allOn ? "#07122b" : color;
        const desc = descriptions[sk];
        const btn = (
          <button
            className={[
              "sfp__status-pill",
              cls,
              size === "sm" ? "sfp__status-pill--sm" : "",
              allOn ? "sfp__status-pill--on" : "",
              anyOn && !allOn ? "sfp__status-pill--partial" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onToggle(st, allOn, siblingTokens)}
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
        return desc ? (
          <Tooltip key={sk} content={desc} position="top">{btn}</Tooltip>
        ) : (
          <span key={sk}>{btn}</span>
        );
      })}
    </div>
  );
}

function GppCard({ tokens, selectedSet, onToggleFamily, onAdd, onRemove, onReplace, labels, isOn, geoStates, viewMode }) {
  const gppMap = useMemo(() => partitionGpp(tokens), [tokens]);
  const states = useMemo(() => {
    const all = sortedStates(gppMap);
    if (!Array.isArray(geoStates) || geoStates.length === 0) return all;
    const relevant = new Set(["US", ...geoStates]);
    return all.filter((s) => relevant.has(normalizeStateCode(s)));
  }, [gppMap, geoStates]);

  const getExpectedTokensForState = (state) => {
    const stateObj = gppMap[state] || {};
    const expectedTokens = [];
    const orderedFields = fieldsForState(state);
    orderedFields.forEach((field) => {
      ["opted_out", "did_not_opt_out", "invalid_missing", "not_applicable"].forEach((sk) => {
        expectedTokens.push(stateObj[field]?.[sk] || `gpp|${state}|${field}|${sk}`);
      });
    });
    return expectedTokens;
  };

  function toggleSingleToken(token, isActive, siblingTokens) {
    if (viewMode === "table" && !isActive && siblingTokens?.length > 0) {
      onReplace([token], siblingTokens);
      return;
    }
    if (isActive) onRemove([token]);
    else onAdd([token]);
  }

  function toggleState(state) {
    const stateTokens = getExpectedTokensForState(state);
    const anyOn = stateTokens.some((t) => selectedSet.has(t));
    if (anyOn) {
      onRemove(stateTokens);
      return;
    }
    const toAdd = stateTokens.filter((t) => {
      const parsed = parseSchemaToken(t);
      return parsed?.field === "SaleOptOut" && parsed?.status === "opted_out";
    });
    const nextTokens = toAdd.length > 0 ? toAdd : stateTokens;
    if (viewMode === "table") {
      const siblingTokens = states
        .filter((s) => s !== state)
        .flatMap((s) => getExpectedTokensForState(s));
      onReplace(nextTokens, siblingTokens);
      return;
    }
    onAdd(nextTokens);
  }

  const stateButtonClass = (state) => {
    const stateTokens = getExpectedTokensForState(state);
    const anyOn = stateTokens.some((t) => selectedSet.has(t));
    const allOn = stateTokens.length > 0 && stateTokens.every((t) => selectedSet.has(t));
    if (allOn) return "sfp__state-chip sfp__state-chip--on";
    if (anyOn) return "sfp__state-chip sfp__state-chip--partial";
    return "sfp__state-chip";
  };

  const hasActiveSelection = (state) =>
    getExpectedTokensForState(state).some((t) => selectedSet.has(t));

  const detailStates = states.filter(hasActiveSelection);

  return (
    <div className={`sfp__family-card sfp__family-card--gpp ${isOn ? "sfp__family-card--on" : ""}`} style={{ margin: 0, boxSizing: "border-box", overflow: "hidden", width: "100%" }}>
      <div className="sfp__family-header" style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ flex: "1 1 0%", minWidth: 0 }}>
          <Tooltip content={FAMILY_DESCRIPTIONS.gpp} position="top">
            <span className="sfp__family-label" style={{ whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", display: "block" }}>📋 GPP</span>
          </Tooltip>
        </div>
        <div style={{ flexShrink: 0 }}>
          <PowerToggle on={isOn} onClick={() => onToggleFamily("gpp")} label="GPP" />
        </div>
      </div>

      {isOn && (
        <div className="sfp__gpp-body">
          <div className="sfp__gpp-states" style={{ marginTop: "8px" }}>
            {states.map((state) => (
              <div key={state} className="sfp__gpp-state-wrapper">
                <button
                  className={stateButtonClass(state)}
                  onClick={() => toggleState(state)}
                  title={state}
                >
                  {GPP_STATE_NAMES[state] || state.toLowerCase()}
                </button>
              </div>
            ))}
          </div>

          {detailStates.length > 0 && (
            <div className="sfp__gpp-detail">
              {detailStates.map((state) => {
                const stateObj = gppMap[state] || {};
                const orderedFields = fieldsForState(state);

                return (
                  <div key={state} className="sfp__gpp-state-detail">
                    <span className="sfp__gpp-state-label" title={state}>{GPP_STATE_NAMES[state] || state.toLowerCase()}</span>
                    <div className="sfp__gpp-fields">
                      {orderedFields.map((field) => {
                        let usnatNote = null;
                        if (normalizeStateCode(state) === "US") {
                          usnatNote =
                            viewMode === "table"
                              ? usnatTableFieldNote(field, normalizeStateCode(geoStates?.[0]))
                              : GPP_USNAT_FIELD_NOTES[field];
                        }
                        return (
                        <div key={field} className="sfp__gpp-field-row">
                          <span className="sfp__gpp-field-label">
                            {GPP_FIELD_SHORT[field] || field}
                            {usnatNote && (
                              <Tooltip content={usnatNote} position="top">
                                <span className="sfp__gpp-field-note" aria-label={usnatNote}> *</span>
                              </Tooltip>
                            )}
                          </span>
                          <div className="sfp__gpp-field-pills">
                            {(() => {
                              const fieldStatuses = STATUS_CONFIG.filter((sc) =>
                                ["opted_out", "did_not_opt_out", "invalid_missing", "not_applicable"].includes(sc.key)
                              );
                              const fieldToken = (sk) => stateObj[field]?.[sk] || `gpp|${state}|${field}|${sk}`;
                              return fieldStatuses.map(({ key: sk, label: sl, cls }) => {
                              const token = fieldToken(sk);
                              const active = selectedSet.has(token);
                              const siblingTokens = fieldStatuses
                                .filter((sc) => sc.key !== sk)
                                .map((sc) => fieldToken(sc.key));
                              const color = (STATUS_COLOR_PALETTES[sk] && STATUS_COLOR_PALETTES[sk][0]) || "#666";
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
                                    onClick={() => toggleSingleToken(token, active, siblingTokens)}
                                    style={{
                                      borderColor: color,
                                      color: active ? "#07122b" : color,
                                      background: active ? `${color}22` : undefined,
                                    }}
                                  >
                                    {sl}
                                  </button>
                                </Tooltip>
                              );
                              });
                            })()}
                          </div>
                        </div>
                        );
                      })}
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

export default function SchemaFilterPanel({
  schemaFilterMeta,
  selectedSchemaTokens,
  onChange,
  geoStates,
  viewMode,
}) {
  const [expandedFamilies, setExpandedFamilies] = useState(new Set());
  const { tokens, labels } = schemaFilterMeta;

  const selectedSet = useMemo(
    () => new Set(selectedSchemaTokens),
    [selectedSchemaTokens]
  );

  useEffect(() => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      let changed = false;
      const allFamilies = [...FAMILY_CONFIG.map(f => f.key), "gpp"];
      allFamilies.forEach((key) => {
        const ft = familyTokens(tokens, key);
        const hasSelected = ft.some((t) => selectedSchemaTokens.includes(t));
        if (!next.has(key) && hasSelected) {
          next.add(key);
          changed = true;
        } else if (next.has(key) && !hasSelected) {
          next.delete(key);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [selectedSchemaTokens, tokens]);

  function add(toAdd) {
    const next = new Set([...selectedSchemaTokens, ...toAdd]);
    onChange([...next]);
  }

  function remove(toRemove) {
    const removeSet = new Set(toRemove);
    onChange(selectedSchemaTokens.filter((t) => !removeSet.has(t)));
  }

  function replaceStatus(toAdd, toRemove) {
    const removeSet = new Set(toRemove);
    const kept = selectedSchemaTokens.filter((t) => !removeSet.has(t));
    onChange([...new Set([...kept, ...toAdd])]);
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
      return;
    }

    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      next.add(familyKey);
      return next;
    });

    if (familyKey === "gpp") {
      const relevantStates =
        viewMode === "table"
          ? new Set(["US"])
          : Array.isArray(geoStates) && geoStates.length > 0
            ? new Set(["US", ...geoStates])
            : null;

      const saleOptedOut = ft.filter((t) => {
        const parsed = parseSchemaToken(t);
        return parsed?.family === "gpp" && parsed.field === "SaleOptOut" && parsed.status === "opted_out";
      });
      const scoped = relevantStates
        ? saleOptedOut.filter((t) => relevantStates.has(normalizeStateCode(parseSchemaToken(t).state)))
        : saleOptedOut;
      add(scoped.length > 0 ? scoped : saleOptedOut);
      return;
    }

    const toAdd = statusTokens(ft, "opted_out");
    add(toAdd.length > 0 ? toAdd : ft);
  }

  function toggleStatusPills(subset, allOn, siblingTokens) {
    if (viewMode === "table" && !allOn && siblingTokens?.length > 0) {
      replaceStatus(subset, siblingTokens);
      return;
    }
    if (allOn) remove(subset);
    else add(subset);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      {FAMILY_CONFIG.map(({ key, label, icon }) => {
        const ft = familyTokens(tokens, key);
        const isOn = expandedFamilies.has(key);
        return (
          <div
            key={key}
            className={`sfp__family-card ${isOn ? "sfp__family-card--on" : ""}`}
            style={{ margin: 0, boxSizing: "border-box", overflow: "hidden", width: "100%" }}
          >
            <div className="sfp__family-header" style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ flex: "1 1 0%", minWidth: 0 }}>
                <Tooltip content={FAMILY_DESCRIPTIONS[key]} position="top">
                  <span className="sfp__family-label" style={{ whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", display: "block" }}>
                    {icon} {label}
                  </span>
                </Tooltip>
              </div>
              <div style={{ flexShrink: 0 }}>
                <PowerToggle
                  on={isOn}
                  onClick={() => toggleFamily(key)}
                  label={label}
                />
              </div>
            </div>
            {isOn && (
              <StatusPills
                subset={ft}
                selectedSet={selectedSet}
                onToggle={toggleStatusPills}
                descriptions={STATUS_DESCRIPTIONS[key] || {}}
              />
            )}
          </div>
        );
      })}

      <GppCard
        tokens={familyTokens(tokens, "gpp")}
        selectedSet={selectedSet}
        onToggleFamily={toggleFamily}
        onAdd={add}
        onRemove={remove}
        onReplace={replaceStatus}
        labels={labels}
        isOn={expandedFamilies.has("gpp")}
        geoStates={geoStates}
        viewMode={viewMode}
      />
    </div>
  );
}