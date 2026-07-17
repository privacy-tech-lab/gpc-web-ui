// Updated to the new column name
export const SCHEMA_CLASSIFICATION_COLUMN = "complianceClassification";

const FAMILY_ORDER = {
  usps: 0,
  optanonConsent: 1,
  wellKnown: 2,
  gpp: 3,
};

const FIELD_ORDER = {
  SaleOptOut: 0,
  SharingOptOut: 1,
  TargetedAdvertisingOptOut: 2,
};

const STATUS_ORDER = {
  opted_out: 0,
  did_not_opt_out: 1,
  invalid_missing: 2,
  invalid: 3,
  not_applicable: 4,
};

const STATUS_LABELS = {
  opted_out: "Opted Out",
  did_not_opt_out: "Did Not Opt Out",
  invalid_missing: "Invalid or Missing",
  invalid: "Invalid",
  not_applicable: "Not Applicable",
};

const FAMILY_LABELS = {
  usps: "USPS",
  optanonConsent: "Optanon Consent",
  wellKnown: "Well-Known",
  gpp: "GPP",
};

const TOP_LEVEL_ALLOWED_STATUSES = {
  usps: new Set([
    "opted_out",
    "did_not_opt_out",
    "invalid_missing",
    "not_applicable",
  ]),
  optanonConsent: new Set([
    "opted_out",
    "did_not_opt_out",
    "invalid_missing",
  ]),
  wellKnown: new Set(["opted_out", "did_not_opt_out", "invalid"]),
};

const GPP_ALLOWED_STATUSES = new Set([
  "opted_out",
  "did_not_opt_out",
  "invalid_missing",
  "not_applicable",
]);

const GPP_ALLOWED_FIELDS = new Set(Object.keys(FIELD_ORDER));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonLike(input) {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    return JSON.parse(trimmed);
  } catch {
    const normalized = trimmed
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/'/g, '"');
    try {
      return JSON.parse(normalized);
    } catch {
      return input;
    }
  }
}

function humanizeIdentifier(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeStateSortKey(state) {
  return state === "US" ? "00-US" : String(state || "");
}

function buildEntry(entry) {
  const token = buildSchemaToken(entry);
  return {
    ...entry,
    token,
    label: getSchemaTokenLabel(token),
    description: getSchemaTokenDescription(token),
  };
}

function compareEntries(a, b) {
  const familyDiff =
    (FAMILY_ORDER[a.family] ?? Number.MAX_SAFE_INTEGER) -
    (FAMILY_ORDER[b.family] ?? Number.MAX_SAFE_INTEGER);
  if (familyDiff !== 0) return familyDiff;

  if (a.family === "gpp" && b.family === "gpp") {
    const stateDiff = normalizeStateSortKey(a.state).localeCompare(
      normalizeStateSortKey(b.state)
    );
    if (stateDiff !== 0) return stateDiff;

    const fieldDiff =
      (FIELD_ORDER[a.field] ?? Number.MAX_SAFE_INTEGER) -
      (FIELD_ORDER[b.field] ?? Number.MAX_SAFE_INTEGER);
    if (fieldDiff !== 0) return fieldDiff;
  }

  return (
    (STATUS_ORDER[a.status] ?? Number.MAX_SAFE_INTEGER) -
    (STATUS_ORDER[b.status] ?? Number.MAX_SAFE_INTEGER)
  );
}

// Maps 1.1.0 human-readable statuses to 1.0.0 internal statuses
function normalizeStatus(rawStatus) {
  const statusStr = String(rawStatus || "").trim();
  switch (statusStr) {
    case "Opted Out":
      return "opted_out";
    case "Did Not Opt Out":
      return "did_not_opt_out";
    case "Invalid Missing":      
    case "Invalid or Missing":
      return "invalid_missing";
    case "Invalid":
      return "invalid";
    case "Not Applicable":
      return "not_applicable";
    default:
      return statusStr;
  }
}

function collectTopLevelClassification(entries, errors, family, value) {
  // Support for 1.1.0 string "None"
  if (value == null || value === "None") return;

  if (!isPlainObject(value)) {
    errors.push(`${family} must be an object, null, or "None".`);
    return;
  }

  // Graceful fallback allows it to parse 1.0.0 schemas using 'status' too
  const rawStatus = value.complianceClassification !== undefined 
    ? value.complianceClassification 
    : value.status;
  
  const status = normalizeStatus(rawStatus);

  if (!TOP_LEVEL_ALLOWED_STATUSES[family]?.has(status)) {
    errors.push(`${family} has unsupported status "${rawStatus}".`);
    return;
  }

  entries.push(
    buildEntry({
      family,
      status,
    })
  );
}

function collectGppClassification(entries, errors, value) {
  if (value == null || value === "None") return;

  if (!isPlainObject(value)) {
    errors.push("gpp must be an object, null, or \"None\".");
    return;
  }

  // Handle both 1.0.0 (classifications) and 1.1.0 (complianceClassifications)
  const classifications = value.complianceClassifications || value.classifications;
  
  if (!Array.isArray(classifications)) {
    errors.push("gpp classifications array is missing or invalid.");
    return;
  }

  classifications.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`gpp classification [${index}] must be an object.`);
      return;
    }

    // Handle both 1.0.0 (state) and 1.1.0 (section)
    const state = String(item.section || item.state || "").trim();
    const field = String(item.field || "").trim();
    
    // Handle both 1.0.0 (status) and 1.1.0 (complianceClassification)
    const rawStatus = item.complianceClassification !== undefined 
      ? item.complianceClassification 
      : item.status;
    const status = normalizeStatus(rawStatus);

    if (!state) {
      errors.push(`gpp classification [${index}] is missing a state/section.`);
      return;
    }
    if (!GPP_ALLOWED_FIELDS.has(field)) {
      errors.push(
        `gpp classification [${index}] has unsupported field "${field}".`
      );
      return;
    }
    if (!GPP_ALLOWED_STATUSES.has(status)) {
      errors.push(
        `gpp classification [${index}] has unsupported status "${rawStatus}".`
      );
      return;
    }

    // We keep the internal property name as "state" so the rest of the app 
    // (and the UI filters) don't have to change!
    entries.push(
      buildEntry({
        family: "gpp",
        state, 
        field,
        status,
      })
    );
  });
}

export function buildSchemaToken(entry) {
  if (!entry || !entry.family || !entry.status) return "";
  if (entry.family === "gpp") {
    return `gpp|${entry.state}|${entry.field}|${entry.status}`;
  }
  return `${entry.family}|${entry.status}`;
}

export function parseSchemaToken(token) {
  const parts = String(token || "").split("|");
  if (parts[0] === "gpp" && parts.length === 4) {
    return {
      family: "gpp",
      state: parts[1],
      field: parts[2],
      status: parts[3],
    };
  }
  if (parts.length === 2) {
    return {
      family: parts[0],
      status: parts[1],
    };
  }
  return null;
}

export function getSchemaTokenLabel(token) {
  const parsed = parseSchemaToken(token);
  if (!parsed) return String(token || "");

  const statusLabel = STATUS_LABELS[parsed.status] || humanizeIdentifier(parsed.status);
  if (parsed.family === "gpp") {
    return `${FAMILY_LABELS.gpp}: ${parsed.state} ${humanizeIdentifier(parsed.field)} (${statusLabel})`;
  }

  const familyLabel =
    FAMILY_LABELS[parsed.family] || humanizeIdentifier(parsed.family);
  return `${familyLabel}: ${statusLabel}`;
}

export function getSchemaTokenDescription(token) {
  const parsed = parseSchemaToken(token);
  if (!parsed) return "";

  const statusLabel = STATUS_LABELS[parsed.status] || humanizeIdentifier(parsed.status);
  if (parsed.family === "gpp") {
    return `Counts sites whose GPP classification includes ${parsed.state} ${humanizeIdentifier(parsed.field)} with status "${statusLabel}".`;
  }

  const familyLabel =
    FAMILY_LABELS[parsed.family] || humanizeIdentifier(parsed.family);
  return `Counts sites whose ${familyLabel} schema classification is "${statusLabel}".`;
}

export function sortSchemaTokens(tokens) {
  return [...tokens].sort((left, right) => {
    const leftEntry = parseSchemaToken(left);
    const rightEntry = parseSchemaToken(right);
    if (!leftEntry || !rightEntry) {
      return String(left).localeCompare(String(right));
    }
    return compareEntries(leftEntry, rightEntry);
  });
}

export function parseSchemaClassificationCell(rawValue) {
  const emptyResult = {
    parsed: null,
    entries: [],
    tokens: [],
    labels: {},
    descriptions: {},
    complianceResult: "Not Applicable/Invalid/Missing", // Added to default state
    parseError: null,
  };

  if (rawValue == null) return emptyResult;
  if (typeof rawValue === "string" && rawValue.trim() === "") return emptyResult;

  const parsed = parseJsonLike(rawValue);
  if (!isPlainObject(parsed)) {
    return {
      ...emptyResult,
      parseError: `Could not parse ${SCHEMA_CLASSIFICATION_COLUMN} as a JSON object.`,
    };
  }

  const errors = [];
  const entries = [];
  const hasKnownSections = ["usps", "optanonConsent", "wellKnown", "gpp"].some(
    (key) => Object.hasOwn(parsed, key)
  );

  if (!hasKnownSections) {
    errors.push(
      `${SCHEMA_CLASSIFICATION_COLUMN} is missing expected classification sections.`
    );
  }

  collectTopLevelClassification(entries, errors, "usps", parsed.usps);
  collectTopLevelClassification(
    entries,
    errors,
    "optanonConsent",
    parsed.optanonConsent
  );
  collectTopLevelClassification(entries, errors, "wellKnown", parsed.wellKnown);
  collectGppClassification(entries, errors, parsed.gpp);

  entries.sort(compareEntries);

  const tokens = [];
  const labels = {};
  const descriptions = {};
  entries.forEach((entry) => {
    tokens.push(entry.token);
    labels[entry.token] = entry.label;
    descriptions[entry.token] = entry.description;
  });

  // Extract the new complianceResult field (falling back if missing)
  const complianceResult = parsed.complianceResult || "Not Applicable/Invalid/Missing";

  return {
    parsed,
    entries,
    tokens,
    labels,
    descriptions,
    complianceResult, // Export it here
    parseError: errors.length > 0 ? errors.join(" ") : null,
  };
}

export function getSchemaClassificationForRow(row) {
  return parseSchemaClassificationCell(row?.[SCHEMA_CLASSIFICATION_COLUMN]);
}

/**
 * Families that represent an actual opt-out outcome after a GPC signal.
 * Well-known is intentionally excluded: a `/.well-known/gpc.json` file is the
 * site *declaring* GPC support, which is a separate compliance dimension from
 * whether the site actually honored the signal. It must not factor into the
 * non-compliant determination.
 */
const OPT_OUT_FAMILIES = new Set(["usps", "optanonConsent", "gpp"]);

/**
 * Returns true if the site's top-level complianceResult explicitly states
 * that it likely does not honor the Global Privacy Control.
 */
export function isSchemaRowNonCompliant(schemaResult) {
  // 1. Check the new top-level field first (for new data)
  if (
    schemaResult?.complianceResult && 
    schemaResult.complianceResult !== "Not Applicable/Invalid/Missing" &&
    schemaResult.complianceResult !== "Unknown"
  ) {
    return schemaResult.complianceResult === "Likely Does Not Honor GPC";
  }

  // 2. Fallback to the legacy check (for historical data & GPP Breakdown charts)
  return (
    Array.isArray(schemaResult?.entries) &&
    schemaResult.entries.some(
      (entry) =>
        OPT_OUT_FAMILIES.has(entry.family) &&
        entry.status === "did_not_opt_out"
    )
  );
}