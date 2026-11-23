import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// State codes are two letters (CA) or two letters + underscore + two letters
// (NJ_NY: NJ crawl collected from a NY-geolocated IP).
const STATE_CODE = "[A-Z]{2}(?:_[A-Z]{2})?";
const STATE_DIR_PATTERN = new RegExp(`^${STATE_CODE}$`);

// Datasets served to the browser are Parquet. Raw CSVs are the lab's source
// format and are converted with `npm run add-crawl` (see docs/ADDING_CRAWL_DATA.md).
export const DATA_EXTENSION = ".parquet";
const buildFilenamePattern = (ext) =>
  new RegExp(`^Crawl_Data_(?<state>${STATE_CODE}) - (?<period>[A-Za-z0-9]+)\\${ext}$`);
const FILENAME_PATTERN = buildFilenamePattern(DATA_EXTENSION);
const CSV_FILENAME_PATTERN = buildFilenamePattern(".csv");

/** Parses "Crawl_Data_CA - May2026.csv" -> { state: "CA", period: "May2026" }, or null. */
export function parseCrawlFilename(name, ext = ".csv") {
  const match = name.match(ext === DATA_EXTENSION ? FILENAME_PATTERN : CSV_FILENAME_PATTERN);
  return match ? { state: match.groups.state, period: match.groups.period } : null;
}

const PNC_PREFIX = "PotentiallyNonCompliantSites";

// Maps any recognized month token (lowercased) to its 1-based month number
// and a canonical 3-letter form. Aug/August → 8, "Aug"; Sep → 9, "Sep"; Sept/September → 9, "Sept".
// Sep and Sept are intentionally kept distinct so the key mirrors the filename.
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
  sep: { n: 9, canonical: "Sep", full: "September" },
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
    .filter((entry) => entry.isDirectory() && STATE_DIR_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const periodsByState = {};
  const warnings = [];

  for (const state of stateDirs) {
    const stateDir = join(publicDir, state);
    const allFiles = readdirSync(stateDir);
    const files = allFiles.filter((name) => name.endsWith(DATA_EXTENSION));
    const byCanonicalKey = new Map();

    // A raw CSV in public/ is deployed (20MB+) but never read by the app.
    for (const name of allFiles) {
      if (CSV_FILENAME_PATTERN.test(name) && !name.includes(PNC_PREFIX)) {
        warnings.push(
          `[dataset-manifest] ${state}/${name} is a raw CSV and is ignored. ` +
            `Move it to crawl-data/ and run: npm run add-crawl`,
        );
      }
    }

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

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PUBLIC_DIR = resolve(here, "..", "public");
export const DEFAULT_MANIFEST_FILE = resolve(here, "..", "src", "generated", "datasets.json");

/** Rebuilds src/generated/datasets.json from public/. Returns the manifest. */
export function writeManifest({
  publicDir = DEFAULT_PUBLIC_DIR,
  outFile = DEFAULT_MANIFEST_FILE,
  logger,
} = {}) {
  const log = logger ?? console;
  const manifest = buildManifest(publicDir);
  for (const warning of manifest.warnings) log.warn(warning);

  const next =
    JSON.stringify(
      { states: manifest.states, periodsByState: manifest.periodsByState },
      null,
      2,
    ) + "\n";
  mkdirSync(dirname(outFile), { recursive: true });
  if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== next) {
    writeFileSync(outFile, next);
  }
  return manifest;
}

export function datasetManifest({ publicDir, outFile } = {}) {
  const publicPath = publicDir ?? DEFAULT_PUBLIC_DIR;
  const outPath = outFile ?? DEFAULT_MANIFEST_FILE;

  function regenerate(logger) {
    writeManifest({ publicDir: publicPath, outFile: outPath, logger });
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
        if (!filePath.endsWith(DATA_EXTENSION)) return;
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