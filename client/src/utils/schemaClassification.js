export const ANALYSIS_MODES = Object.freeze({
  LEGACY: "legacy",
  SCHEMA: "schema",
});

export const SCHEMA_CLASSIFICATION_COLUMN = "compliance_classification";

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

function collectTopLevelClassification(entries, errors, family, value) {
  if (value == null) return;

  if (!isPlainObject(value)) {
    errors.push(`${family} must be an object or null.`);
    return;
  }

  const status = String(value.status || "").trim();
  if (!TOP_LEVEL_ALLOWED_STATUSES[family]?.has(status)) {
    errors.push(`${family} has unsupported status "${status}".`);
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
  if (value == null) return;

  if (!isPlainObject(value)) {
    errors.push("gpp must be an object or null.");
    return;
  }

  const classifications = value.classifications;
  if (!Array.isArray(classifications)) {
    errors.push("gpp.classifications must be an array.");
    return;
  }

  classifications.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`gpp.classifications[${index}] must be an object.`);
      return;
    }

    const state = String(item.state || "").trim();
    const field = String(item.field || "").trim();
    const status = String(item.status || "").trim();

    if (!state) {
      errors.push(`gpp.classifications[${index}] is missing a state.`);
      return;
    }
    if (!GPP_ALLOWED_FIELDS.has(field)) {
      errors.push(
        `gpp.classifications[${index}] has unsupported field "${field}".`
      );
      return;
    }
    if (!GPP_ALLOWED_STATUSES.has(status)) {
      errors.push(
        `gpp.classifications[${index}] has unsupported status "${status}".`
      );
      return;
    }

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
    parseError: null,
  };

  if (rawValue == null) return emptyResult;
  if (typeof rawValue === "string" && rawValue.trim() === "") return emptyResult;

  const parsed = parseJsonLike(rawValue);
  if (!isPlainObject(parsed)) {
    return {
      ...emptyResult,
      parseError: "Could not parse compliance_classification as a JSON object.",
    };
  }

  const errors = [];
  const entries = [];
  const hasKnownSections = ["usps", "optanonConsent", "wellKnown", "gpp"].some(
    (key) => Object.hasOwn(parsed, key)
  );

  if (!hasKnownSections) {
    errors.push(
      "compliance_classification is missing expected classification sections."
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

  return {
    parsed,
    entries,
    tokens,
    labels,
    descriptions,
    parseError: errors.length > 0 ? errors.join(" ") : null,
  };
}

export function getSchemaClassificationForRow(row) {
  return parseSchemaClassificationCell(row?.[SCHEMA_CLASSIFICATION_COLUMN]);
}

/**
 * Returns true if the parsed schema classification result contains at least
 * one entry with status === "did_not_opt_out". A site is considered
 * non-compliant if any tracked privacy string (USPS, OptanonConsent,
 * Well-known, or any GPP state/field combination) did not opt the user out
 * after receiving a GPC signal.
 */
export function isSchemaRowNonCompliant(schemaResult) {
  return (
    Array.isArray(schemaResult?.entries) &&
    schemaResult.entries.some((entry) => entry.status === "did_not_opt_out")
  );
}
