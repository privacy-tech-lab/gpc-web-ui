#!/usr/bin/env node
/**
 * Rebuilds the dashboard's data from the raw crawl CSVs in crawl-data/.
 *
 *   npm run add-crawl
 *
 * Every CSV in crawl-data/ is converted to a compressed Parquet file in
 * public/<STATE>/, replacing what was there. Parquet files whose CSV is no longer in
 * crawl-data/ are deleted, so public/ always mirrors the folder. Then
 * src/generated/datasets.json is regenerated.
 *
 *   Add a crawl:      put the CSV in crawl-data/, run the command
 *   Replace a crawl:  delete the old CSV, put the new one in, run the command
 *   Remove a crawl:   delete the CSV, run the command
 *
 * CSVs must be named:  Crawl_Data_<STATE> - <Period>.csv
 * e.g.  Crawl_Data_CA - May2026.csv   Crawl_Data_NJ_NY - AugSep2026.csv
 *
 * Options
 *   --level N   zstd level 1-22 (default 15; 19 is ~12% smaller but ~5x slower)
 *   --help      show this message
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import Papa from "papaparse";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { parquetWriteBuffer } from "hyparquet-writer";

import {
  DATA_EXTENSION,
  DEFAULT_PUBLIC_DIR,
  normalizePeriod,
  parseCrawlFilename,
  writeManifest,
} from "../vite-plugins/dataset-manifest.js";

const SOURCE_DIR = resolve(DEFAULT_PUBLIC_DIR, "..", "crawl-data");
const ROW_GROUP_SIZE = 50_000;
const RECOMMENDED_COLUMNS = ["Site URL", "complianceClassification"];
const PNC_PREFIX = "PotentiallyNonCompliantSites";

class UserError extends Error {}

// ── Inputs ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { level: 15, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--level") {
      opts.level = Number(argv[++i]);
      if (!Number.isInteger(opts.level) || opts.level < 1 || opts.level > 22) {
        throw new UserError("--level must be an integer from 1 to 22");
      }
    } else throw new UserError(`Unknown argument "${arg}" (try --help). Just run: npm run add-crawl`);
  }
  return opts;
}

function printHelp() {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  console.log(source.match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, "").trim());
}

/** All crawl CSVs under crawl-data/ (any depth), skipping PotentiallyNonCompliantSites files. */
function findCsvs(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...findCsvs(path));
    else if (name.toLowerCase().endsWith(".csv") && !name.includes(PNC_PREFIX)) files.push(path);
  }
  return files;
}

function validate(file) {
  const name = basename(file);
  const parsed = parseCrawlFilename(name);
  if (!parsed) {
    throw new UserError(
      `"${name}" is not named correctly.\n` +
        `    Expected: Crawl_Data_<STATE> - <Period>.csv   (e.g. "Crawl_Data_CA - May2026.csv")`,
    );
  }
  const normalized = normalizePeriod(parsed.period);
  if (!normalized) {
    throw new UserError(
      `"${name}": the period "${parsed.period}" isn't recognized.\n` +
        `    Use month names followed by a 4-digit year, like May2026, FebMar2025 or AugSep2026.`,
    );
  }
  return { file, state: parsed.state, key: normalized.key, outName: name.replace(/\.csv$/i, DATA_EXTENSION) };
}

// ── Conversion ──────────────────────────────────────────────────────────────

function pickCodec(level) {
  if (typeof zlib.zstdCompressSync === "function") {
    const compress = (input) =>
      new Uint8Array(zlib.zstdCompressSync(input, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }));
    return { codec: "ZSTD", compressors: { ZSTD: compress } };
  }
  console.warn(
    `! Node ${process.versions.node} has no built-in zstd (needs 22.15+). Falling back to Snappy: ` +
      `files will be roughly 2x larger. Upgrade Node when you can.`,
  );
  return { codec: "SNAPPY" };
}

function readCsv(file) {
  // utf-8 BOM (Excel) would otherwise stick to the first column name.
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  // Some exports are tab-separated despite the .csv name: decide from the header line.
  const header = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = header.split("\t").length > header.split(",").length ? "\t" : ",";

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter });
  const rawNames = parsed.meta.fields ?? [];
  const names = rawNames.map((field) => field.trim());
  if (names.length === 0 || parsed.data.length === 0) throw new Error("the file has no header or no data rows");
  if (new Set(names).size !== names.length) {
    const dupes = names.filter((name, i) => names.indexOf(name) !== i);
    throw new Error(`duplicate column names: ${[...new Set(dupes)].join(", ")}`);
  }
  return { rawNames, names, rows: parsed.data, errors: parsed.errors, delimiter };
}

async function convertOne({ file, state, outName }, codecOptions) {
  const { rawNames, names, rows, errors, delimiter } = readCsv(file);

  // Every column is stored as the exact text from the CSV, so the app sees the
  // same "null" / "None" / "TRUE" / Python-list strings it always did.
  const columnData = names.map((name, c) => ({
    name,
    type: "STRING",
    data: rows.map((row) => row[rawNames[c]] ?? ""),
  }));
  const buffer = parquetWriteBuffer({ columnData, rowGroupSize: ROW_GROUP_SIZE, ...codecOptions });

  // Read the result back with the same reader the browser uses and compare every cell.
  const back = await parquetReadObjects({ file: buffer, compressors });
  if (back.length !== rows.length) throw new Error(`verification failed: wrote ${rows.length} rows, read back ${back.length}`);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < names.length; c++) {
      if (back[r][names[c]] !== (rows[r][rawNames[c]] ?? "")) {
        throw new Error(`verification failed at row ${r + 2}, column "${names[c]}"`);
      }
    }
  }

  mkdirSync(join(DEFAULT_PUBLIC_DIR, state), { recursive: true });
  writeFileSync(join(DEFAULT_PUBLIC_DIR, state, outName), new Uint8Array(buffer));

  const before = statSync(file).size;
  console.log(
    `  ✓ ${outName}  ${rows.length.toLocaleString()} rows, ${(before / 1e6).toFixed(1)} MB → ` +
      `${(buffer.byteLength / 1e6).toFixed(1)} MB (${delimiter === "\t" ? "tab" : "comma"}-separated)`,
  );
  const missing = RECOMMENDED_COLUMNS.filter((column) => !names.includes(column));
  if (missing.length > 0) {
    console.warn(`    ! missing expected column(s): ${missing.join(", ")} — the dashboard needs these for the table/filters.`);
  }
  if (errors.length > 0) {
    console.warn(`    ! the CSV parser reported ${errors.length} warning(s); first: ${errors[0].message} (row ${errors[0].row + 2})`);
  }
}

/** Deletes Parquet files in public/<STATE>/ that no longer have a CSV in crawl-data/. */
function pruneOrphans(keep) {
  const removed = [];
  for (const entry of readdirSync(DEFAULT_PUBLIC_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of readdirSync(join(DEFAULT_PUBLIC_DIR, entry.name))) {
      const parsed = parseCrawlFilename(name, DATA_EXTENSION);
      if (parsed?.state !== entry.name || keep.has(`${entry.name}/${name}`)) continue;
      unlinkSync(join(DEFAULT_PUBLIC_DIR, entry.name, name));
      removed.push(`${entry.name}/${name}`);
    }
  }
  return removed;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const folder = relative(process.cwd(), SOURCE_DIR) || "crawl-data";
  if (!existsSync(SOURCE_DIR)) {
    mkdirSync(SOURCE_DIR, { recursive: true });
    console.log(`Created ${folder}/. Put your crawl CSVs in it, then run: npm run add-crawl`);
    return 0;
  }
  const files = findCsvs(SOURCE_DIR);
  if (files.length === 0) {
    // Refuse rather than wipe public/ because of an empty or wrong folder.
    throw new UserError(`No crawl CSVs found in ${folder}/. Nothing was changed.`);
  }

  // Validate everything first so a typo in file #5 doesn't leave a half-done rebuild.
  const plan = files.map(validate);
  const seen = new Map();
  for (const item of plan) {
    const id = `${item.state}/${item.key}`;
    if (seen.has(id)) {
      throw new UserError(
        `Two CSVs are the same period (${id}):\n    ${basename(seen.get(id))}\n    ${basename(item.file)}\n` +
          `    Delete the old one from ${folder}/.`,
      );
    }
    seen.set(id, item.file);
  }

  console.log(`Converting ${plan.length} file(s) from ${folder}/…\n`);
  const codecOptions = pickCodec(opts.level);
  const failures = [];
  for (const item of plan) {
    try {
      await convertOne(item, codecOptions);
    } catch (err) {
      failures.push(basename(item.file));
      console.error(`  ✗ ${basename(item.file)}: ${err.message}`);
    }
  }
  if (failures.length > 0) {
    // Don't delete anything when part of the rebuild failed.
    console.error(`\n${failures.length} file(s) failed: ${failures.join(", ")}\nNo old files were removed.`);
    writeManifest();
    return 1;
  }

  const removed = pruneOrphans(new Set(plan.map((item) => `${item.state}/${item.outName}`)));
  for (const name of removed) console.log(`  – removed ${name} (no matching CSV in ${folder}/)`);

  const manifest = writeManifest();
  console.log("\nDatasets now available:");
  for (const state of manifest.states) {
    console.log(`  ${state.padEnd(6)} ${manifest.periodsByState[state].map((p) => p.key).join(", ")}`);
  }
  console.log("\nDone.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof UserError ? `\nError: ${err.message}` : err);
    process.exit(1);
  },
);