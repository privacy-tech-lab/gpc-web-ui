import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILENAME_PATTERN =
  /^Crawl_Data_(?<state>[A-Z]{2}) - (?<period>[A-Za-z0-9]+)\.csv$/;

const PNC_PREFIX = "PotentiallyNonCompliantSites";

// Maps any recognized month token (lowercased) to its 1-based month number
// and a canonical 3-letter form. Aug/August → 8, "Aug"; Sept/Sep/September → 9, "Sept".
const MONTH_TABLE = {
  jan: { n: 1, canonical: "Jan", full: "January" },
  january: { n: 1, canonical: "Jan", full: "January" },
  feb: { n: 2, canonical: "Feb", full: "February" },
  february: { n: 2, canonical: "Feb", full: "February" },
  mar: { n: 3, canonical: "Mar", full: "March" },
  march: { n: 3, canonical: "Mar", full: "March" },
  apr: { n: 4, canonical: "Apr", full: "April" },
  april: { n: 4, canonical: "Apr", full: "April" },
  may: { n: 5, canonical: "May", full: "May" },
  jun: { n: 6, canonical: "Jun", full: "June" },
  june: { n: 6, canonical: "Jun", full: "June" },
  jul: { n: 7, canonical: "Jul", full: "July" },
  july: { n: 7, canonical: "Jul", full: "July" },
  aug: { n: 8, canonical: "Aug", full: "August" },
  august: { n: 8, canonical: "Aug", full: "August" },
  sep: { n: 9, canonical: "Sept", full: "September" },
  sept: { n: 9, canonical: "Sept", full: "September" },
  september: { n: 9, canonical: "Sept", full: "September" },
  oct: { n: 10, canonical: "Oct", full: "October" },
  october: { n: 10, canonical: "Oct", full: "October" },
  nov: { n: 11, canonical: "Nov", full: "November" },
  november: { n: 11, canonical: "Nov", full: "November" },
  dec: { n: 12, canonical: "Dec", full: "December" },
  december: { n: 12, canonical: "Dec", full: "December" },
};

// Splits "AugSeptOct2025" → ["Aug","Sept","Oct","2025"]. Tokens are uppercase-prefixed
// alphabetic runs followed by a single trailing 4-digit year.
function tokenize(period) {
  const yearMatch = period.match(/(\d{4})$/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const monthsPart = period.slice(0, period.length - 4);
  if (!monthsPart) return null;
  // Split on the boundary before each uppercase letter (but keep the first run).
  const monthTokens = monthsPart.split(/(?=[A-Z])/).filter(Boolean);
  return { monthTokens, year };
}

export function normalizePeriod(period) {
  const tokens = tokenize(period);
  if (!tokens) return null;
  const months = [];
  for (const token of tokens.monthTokens) {
    const entry = MONTH_TABLE[token.toLowerCase()];
    if (!entry) return null;
    months.push(entry);
  }
  if (months.length === 0) return null;
  const canonicalKey = months.map((m) => m.canonical).join("") + tokens.year;
  const label =
    months.length === 1
      ? `${months[0].full} ${tokens.year}`
      : `${months.map((m) => m.canonical).join("-")} ${tokens.year}`;
  const sortKey = `${tokens.year}-${String(months[0].n).padStart(2, "0")}`;
  return { key: canonicalKey, label, sortKey };
}

export function buildManifest(publicDir) {
  const entries = readdirSync(publicDir, { withFileTypes: true });
  const stateDirs = entries
    .filter((entry) => entry.isDirectory() && /^[A-Z]{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const periodsByState = {};
  const warnings = [];

  for (const state of stateDirs) {
    const stateDir = join(publicDir, state);
    const files = readdirSync(stateDir).filter((name) => name.endsWith(".csv"));
    const byCanonicalKey = new Map();

    for (const file of files) {
      if (file.includes(PNC_PREFIX)) continue;
      const match = file.match(FILENAME_PATTERN);
      if (!match) continue;
      if (match.groups.state !== state) continue;
      const normalized = normalizePeriod(match.groups.period);
      if (!normalized) {
        warnings.push(
          `[dataset-manifest] Skipping ${state}/${file}: unrecognized period "${match.groups.period}"`,
        );
        continue;
      }
      if (byCanonicalKey.has(normalized.key)) {
        const existing = byCanonicalKey.get(normalized.key);
        throw new Error(
          `[dataset-manifest] Duplicate period "${normalized.key}" in ${state}: ` +
            `"${existing.file}" and "${file}" normalize to the same key. ` +
            `Delete or rename one.`,
        );
      }
      byCanonicalKey.set(normalized.key, { ...normalized, file });
    }

    const periods = [...byCanonicalKey.values()].sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey),
    );
    if (periods.length > 0) periodsByState[state] = periods;
  }

  return {
    states: Object.keys(periodsByState),
    periodsByState,
    warnings,
  };
}

export function datasetManifest({ publicDir, outFile } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultPublic = resolve(here, "..", "public");
  const defaultOut = resolve(here, "..", "src", "generated", "datasets.json");
  const publicPath = publicDir ?? defaultPublic;
  const outPath = outFile ?? defaultOut;

  function regenerate(logger) {
    const log = logger ?? console;
    const { states, periodsByState, warnings } = buildManifest(publicPath);
    for (const warning of warnings) log.warn(warning);

    const next = JSON.stringify({ states, periodsByState }, null, 2) + "\n";
    mkdirSync(dirname(outPath), { recursive: true });
    if (existsSync(outPath)) {
      const current = readFileSync(outPath, "utf8");
      if (current === next) return;
    }
    writeFileSync(outPath, next);
  }

  return {
    name: "dataset-manifest",
    buildStart() {
      regenerate(this);
    },
    configureServer(server) {
      regenerate(server.config.logger);
      const watcher = server.watcher;
      watcher.add(publicPath);
      const onChange = (filePath) => {
        if (!filePath.startsWith(publicPath)) return;
        if (!filePath.endsWith(".csv")) return;
        try {
          regenerate(server.config.logger);
        } catch (err) {
          server.config.logger.error(
            `[dataset-manifest] ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      watcher.on("add", onChange);
      watcher.on("unlink", onChange);
    },
  };
}
