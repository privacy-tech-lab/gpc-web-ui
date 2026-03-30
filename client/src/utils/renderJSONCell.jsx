function parseJsonLike(input) {
  if (typeof input !== "string") return input;
  const s = input.trim();
  try {
    return JSON.parse(s);
  } catch {
    const normalized = s
      .replace(/'/g, '"')
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    try {
      return JSON.parse(normalized);
    } catch {
      return input;
    }
  }
}

function humanizeKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatInlineValue(value, parseJsonLikeFn) {
  if (value == null) return "None";
  if (Array.isArray(value)) {
    return value
      .map((item) => formatInlineValue(item, parseJsonLikeFn))
      .filter(Boolean)
      .join(", ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, subValue]) => {
        const formatted = formatInlineValue(subValue, parseJsonLikeFn);
        return `${humanizeKey(key)}: ${formatted || "None"}`;
      })
      .join("; ");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = parseJsonLikeFn(trimmed);
    if (parsed !== value) {
      return formatInlineValue(parsed, parseJsonLikeFn);
    }
    return trimmed;
  }
  return String(value);
}

function toStringList(value, parseJsonLikeFn) {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatInlineValue(item, parseJsonLikeFn))
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return [formatInlineValue(value, parseJsonLikeFn)].filter(Boolean);
  }
  if (value == null) return [];
  if (typeof value === "string") {
    const s = value.trim();
    const parsed = parseJsonLikeFn(s);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    if (s.includes(",") || s.includes(";")) {
      return s
        .split(/[,;]+/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [s];
  }
  return [String(value)];
}

export function renderJSONCell(raw) {
  try {
    const obj = typeof raw === "string" ? parseJsonLike(raw) : raw;
    if (!obj || typeof obj !== "object") return String(raw ?? "");

    const toList = (value) => toStringList(value, parseJsonLike);

    if (Array.isArray(obj)) {
      const items = toList(obj);
      return items.length > 0 ? items.join(", ") : "None";
    }

    const rows = [];
    for (const [topKey, topVal] of Object.entries(obj)) {
      if (topVal && typeof topVal === "object" && !Array.isArray(topVal)) {
        const subEntries = Object.entries(topVal);
        if (subEntries.length === 0) {
          rows.push(
            <div key={`row-${topKey}`} className="uc-row">
              <span className="uc-label">{humanizeKey(topKey)}:</span>
              <span className="uc-domains">None</span>
            </div>
          );
        } else {
          rows.push(
            <div key={`header-${topKey}`} className="uc-row">
              <span className="uc-label" style={{ fontWeight: 700 }}>{humanizeKey(topKey)}:</span>
            </div>
          );
          for (const [subKey, subVal] of subEntries) {
            const items = toList(subVal);
            rows.push(
              <div key={`row-${topKey}-${subKey}`} className="uc-row" style={{ paddingLeft: "0.75em" }}>
                <span className="uc-label">{humanizeKey(subKey)}:</span>
                <span className="uc-domains">
                  {items.length > 0 ? items.join(", ") : "None"}
                </span>
              </div>
            );
          }
        }
      } else {
        const items = toList(topVal);
        rows.push(
          <div key={`row-${topKey}`} className="uc-row">
            <span className="uc-label">{humanizeKey(topKey)}:</span>
            <span className="uc-domains">
              {items.length > 0 ? items.join(", ") : "None"}
            </span>
          </div>
        );
      }
    }

    return rows.length > 0 ? <>{rows}</> : "None";
  } catch {
    return String(raw ?? "");
  }
}
