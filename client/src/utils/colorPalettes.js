export const STATUS_COLOR_PALETTES = {
  opted_out: ["#04B90E"],
  did_not_opt_out: ["#F34B4B"],
  invalid_missing: ["#1B7EB5"],
  invalid: ["#1B7EB5"],
  not_applicable: ["#9CA2AB"],
};

export const LEGACY_COLOR_PALETTE = [
  "#2e7d32",
];

export const SPECIAL_SERIES = {
  PNC_SITES: "Potentially Non-Compliant Sites",
  NULL_SITES: "Null Sites",
};

export function getColorForSeries(seriesKey) {
  if (seriesKey === SPECIAL_SERIES.PNC_SITES) return "#880606";
  if (seriesKey === SPECIAL_SERIES.NULL_SITES) return "#9CA2AB";
  const statusKey = typeof seriesKey === "string" && seriesKey.includes?.("(")
    ? null
    : (seriesKey && seriesKey.status) || null;
  const key = typeof seriesKey === "string" ? seriesKey.split(".")[0] : null;
  const palette = STATUS_COLOR_PALETTES[key] ?? STATUS_COLOR_PALETTES[statusKey] ?? LEGACY_COLOR_PALETTE;
  return palette[0];
}