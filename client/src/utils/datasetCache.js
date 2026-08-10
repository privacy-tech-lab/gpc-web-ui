import Papa from "papaparse";
import datasetsManifest from "../generated/datasets.json";
import {
  SCHEMA_CLASSIFICATION_COLUMN,
  getSchemaClassificationForRow,
  isSchemaRowNonCompliant,
} from "./schemaClassification.js";

export const datasetCache = new Map();
const fetchPromises = new Map();

function normalizeRow(row) {
  const normalized = {};
  Object.keys(row || {}).forEach((key) => {
    let trimmedKey = String(key).trim();
    if (trimmedKey === "site_isnull" || trimmedKey.toLowerCase() === "site id") {
      if (trimmedKey === "site_isnull") trimmedKey = "Site Is Null";
    }
    normalized[trimmedKey] = row[key];
  });
  return normalized;
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

  const filePath = `/${state}/${periodEntry.file}`;

  const promise = (async () => {
    try {
      const response = await fetch(filePath);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${filePath}`);
      const text = await response.text();

      const parsed = await new Promise((resolve, reject) => {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => resolve(res),
          error: (err) => reject(err),
        });
      });

      const headers = (parsed.meta?.fields || []).map((field) => {
        const trimmed = String(field).trim();
        return trimmed === "site_isnull" ? "Site Is Null" : trimmed;
      });

      const rows = (parsed.data || []).map(normalizeRow);
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
      };

      datasetCache.set(cacheKey, result);
      return result;
    } finally {
      fetchPromises.delete(cacheKey);
    }
  })();

  fetchPromises.set(cacheKey, promise);
  return promise;
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