import datasetsManifest from "../generated/datasets.json";
import { openParquet } from "./parquetData.js";
import {
  SCHEMA_CLASSIFICATION_COLUMN,
  getSchemaClassificationForRow,
  isSchemaRowNonCompliant,
} from "./schemaClassification.js";

export const datasetCache = new Map();
const fetchPromises = new Map();
const parquetHandles = new Map(); // cacheKey -> opened Parquet file (for late column loads)
const pendingColumnLoads = new Map(); // `${cacheKey}|${column}` -> Promise

/**
 * Columns that are large (tens of KB per row) and only matter when the user
 * adds them to the table. They are NOT downloaded or parsed with the dataset;
 * `ensureColumns` fetches them on demand. Everything else loads up front,
 * because the charts and filters depend on it.
 * To load a column eagerly again, just remove it from this list.
 */
export const DEFERRED_COLUMNS = new Set([
  "urlClassification",
  "third_party_urls",
  "unique_ad_networks",
]);

export const isDeferredColumn = (column) => DEFERRED_COLUMNS.has(column);

// Raw file column -> name used in the app. (The CSV pipeline did this rename too.)
const RENAMED_COLUMNS = { site_isnull: "Site Is Null" };
const displayName = (column) => RENAMED_COLUMNS[column] ?? column;
const fileName = (column) =>
  Object.keys(RENAMED_COLUMNS).find((raw) => RENAMED_COLUMNS[raw] === column) ?? column;

/** Reads columns and returns row objects keyed by the app's column names. */
async function readRows(handle, fileColumns) {
  const rows = await handle.readColumns(fileColumns);
  const renames = fileColumns.filter((column) => column in RENAMED_COLUMNS);
  if (renames.length > 0) {
    for (const row of rows) {
      for (const raw of renames) {
        row[RENAMED_COLUMNS[raw]] = row[raw];
        delete row[raw];
      }
    }
  }
  return rows;
}

/**
 * Pre-computes counts so the chart never has to filter raw rows.
 */
function createDatasetSummary(allRecords, nullRows) {
  const complianceCounts = {};
  const tokenCounts = {};
  const tokenLabels = {};
  const tokenDescriptions = {};
  let pncCount = 0;

  for (let i = 0; i < allRecords.length; i++) {
    const { schema } = allRecords[i];

    // Count compliance results
    if (schema?.complianceResult) {
      complianceCounts[schema.complianceResult] =
        (complianceCounts[schema.complianceResult] || 0) + 1;
    }

    // Count schema reason tokens
    if (schema?.tokens) {
      for (let j = 0; j < schema.tokens.length; j++) {
        const token = schema.tokens[j];
        tokenCounts[token] = (tokenCounts[token] || 0) + 1;
        if (schema.labels?.[token]) tokenLabels[token] = schema.labels[token];
        if (schema.descriptions?.[token]) tokenDescriptions[token] = schema.descriptions[token];
      }
    }

    // Count potentially non-compliant sites
    if (isSchemaRowNonCompliant(schema)) {
      pncCount++;
    }
  }

  return {
    complianceCounts,
    tokenCounts,
    tokenLabels,
    tokenDescriptions,
    pncCount,
    nullCount: nullRows.length,
  };
}

export async function loadDataset(state, periodEntry) {
  if (!state || !periodEntry) return null;
  const cacheKey = `${state}_${periodEntry.key}`;

  if (datasetCache.has(cacheKey)) {
    return datasetCache.get(cacheKey);
  }

  if (fetchPromises.has(cacheKey)) {
    return fetchPromises.get(cacheKey);
  }

  const filePath = `/${state}/${encodeURIComponent(periodEntry.file)}`;

  const promise = (async () => {
    try {
      const handle = await openParquet(filePath);

      // `headers` lists every column (so the column picker shows them all),
      // but deferred columns are not read yet.
      const headers = handle.columns.map(displayName);
      const eagerColumns = handle.columns.filter((column) => !isDeferredColumn(column));

      const rows = await readRows(handle, eagerColumns);
      const hasSchemaColumn = headers.includes(SCHEMA_CLASSIFICATION_COLUMN);

      const allRecords = rows.map((row) => ({
        row,
        schema: getSchemaClassificationForRow(row),
      }));

      const nullRows = rows.filter(
        (row) =>
          String(row?.["Site Is Null"] ?? row?.site_isnull ?? "")
            .trim()
            .toUpperCase() === "TRUE"
      );

      // Fast pre-aggregated summary
      const summary = createDatasetSummary(allRecords, nullRows);

      const result = {
        headers,
        rows,
        allRecords,
        nullRows,
        hasSchemaColumn,
        summary,
        // Columns present on every row object (grows as deferred columns load).
        loadedColumns: new Set(eagerColumns.map(displayName)),
      };

      parquetHandles.set(cacheKey, handle);
      datasetCache.set(cacheKey, result);
      return result;
    } finally {
      fetchPromises.delete(cacheKey);
    }
  })();

  fetchPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Loads deferred columns into an already-loaded dataset, in place: each row
 * object in `dataset.rows` gains the new keys (rows and allRecords share the
 * same row objects, so everything sees them). Resolves to true if any requested
 * column became available during this call, so the caller knows to re-render.
 */
export async function ensureColumns(state, periodEntry, columns) {
  const dataset = await loadDataset(state, periodEntry);
  const cacheKey = `${state}_${periodEntry?.key}`;
  const handle = parquetHandles.get(cacheKey);
  if (!dataset || !handle) return false;

  const needed = columns.filter(
    (column) => handle.columns.includes(fileName(column)) && !dataset.loadedColumns.has(column),
  );
  if (needed.length === 0) return false;

  // Start one read for everything nobody is already loading.
  const toStart = needed.filter((column) => !pendingColumnLoads.has(`${cacheKey}|${column}`));
  if (toStart.length > 0) {
    const load = (async () => {
      const extra = await readRows(handle, toStart.map(fileName));
      for (let i = 0; i < dataset.rows.length; i++) {
        for (const column of toStart) dataset.rows[i][column] = extra[i][column];
      }
      for (const column of toStart) dataset.loadedColumns.add(column);
    })().finally(() => {
      for (const column of toStart) pendingColumnLoads.delete(`${cacheKey}|${column}`);
    });
    for (const column of toStart) pendingColumnLoads.set(`${cacheKey}|${column}`, load);
  }

  await Promise.all(needed.map((column) => pendingColumnLoads.get(`${cacheKey}|${column}`)));
  return true;
}

let preloadingStarted = false;

export function preloadAllDatasets() {
  if (preloadingStarted) return;
  preloadingStarted = true;

  const queue = [];
  const states = datasetsManifest.states || [];
  for (const stateCode of states) {
    const periods = datasetsManifest.periodsByState[stateCode] || [];
    for (const periodEntry of periods) {
      queue.push({ state: stateCode, periodEntry });
    }
  }

  async function processQueue() {
    for (const item of queue) {
      try {
        await loadDataset(item.state, item.periodEntry);
      } catch (err) {
        console.warn(`Preload skipped for ${item.state} ${item.periodEntry.key}:`, err);
      }
    }
  }

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(() => processQueue());
  } else {
    setTimeout(processQueue, 150);
  }
}
