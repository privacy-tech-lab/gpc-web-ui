# Compliance Classification System – Overview

This document explains the end-to-end pipeline for generating and consuming
per-site GPC compliance classifications in the GPC Web UI.

---

## 1. What is a "compliance classification"?

Each crawled site is evaluated across four privacy-string families:

| Family | Source columns in CSV |
|---|---|
| **USPS** | `uspapi_before_gpc`, `uspapi_after_gpc`, `usp_cookies_before_gpc`, `usp_cookies_after_gpc` |
| **OptanonConsent** | `OptanonConsent_before_gpc`, `OptanonConsent_after_gpc` |
| **Well-known** | `Well-known` column (JSON blob or `None`) |
| **GPP** | `decoded_gpp_before_gpc`, `decoded_gpp_after_gpc` |

For each family, a **status** is assigned:

| Status | Meaning |
|---|---|
| `opted_out` | Site correctly opted the user out after GPC |
| `did_not_opt_out` | Site did NOT opt out — **non-compliant** |
| `invalid_missing` | String was present before but gone/invalid after GPC |
| `not_applicable` | The opt-out field was legitimately N/A |
| `invalid` | Well-known only: file exists but unparseable |
| `null` (JSON null) | No privacy string detected at all — no classification |

GPP is special: it produces **one classification per (state, field) pair**
where `state` ∈ `{US, CA, CO, CT, VA, …}` and `field` ∈
`{SaleOptOut, SharingOptOut, TargetedAdvertisingOptOut}`.

---

## 2. JSON Schema

**File:** `compliance_classification_schema.json`

The schema validates the `compliance_classification` column value for each row.
Example:

```json
{
  "$schema": "./compliance_classification_schema.json",
  "schemaVersion": "1.0.0",
  "site": "buzzfeed.com",
  "usps": { "status": "opted_out" },
  "optanonConsent": { "status": "opted_out" },
  "wellKnown": null,
  "gpp": {
    "classifications": [
      { "state": "CA", "field": "SaleOptOut",    "status": "opted_out" },
      { "state": "CA", "field": "SharingOptOut", "status": "opted_out" }
    ]
  }
}
```

- A `null` top-level field means no privacy string of that type was detected.
- GPP `null` means no GPP string in any section before or after GPC.
- Additional example files live alongside the schema: `compliance_classification_column.*.example.json`

---

## 3. Classification Rules

See `compliance_criteria/` for the full condition-to-status mapping tables:

| File | Covers |
|---|---|
| `USPS Compliance Classification.csv` | US Privacy String |
| `OptanonConsent Compliance Class.csv` | OneTrust OptanonConsent cookie |
| `Well-known Compliance Classific.csv` | `/.well-known/gpc.json` |
| `GPP Compliance Classification.csv` | Global Privacy Platform string |

---

## 4. Generating the Column (Python)

**Script:** `generate_compliance_column.py` (see file alongside this document)

Reads `Crawl_Data_CA - Aug2025.csv`, applies the rules above, appends a
`compliance_classification` column with a compact JSON string, and writes the
result back to the same CSV.

```bash
python3 generate_compliance_column.py
```

The script is self-contained; it only uses the Python standard library (`csv`,
`json`, `re`, `ast`).

---

## 5. Web UI Integration

**Repo:** `gpc-web-ui/client/src/`

### Analysis modes

The UI has two analysis modes (dropdown in the toolbar):

| Mode | How non-compliant sites are identified |
|---|---|
| **Legacy** | Reads `Reasons_Non_Compliant` column from a separate `PotentiallyNonCompliantSites` CSV |
| **Schema** | Reads `compliance_classification` JSON column from the main all-data CSV |

### Schema mode pipeline

```
CSV row
  └── compliance_classification (raw JSON string)
        └── parseSchemaClassificationCell()   [schemaClassification.js]
              ├── entries[]  – one per (family, status) or (family, state, field, status)
              ├── tokens[]   – pipe-delimited strings, e.g. "usps|opted_out", "gpp|CA|SaleOptOut|did_not_opt_out"
              ├── labels{}   – human-readable label per token
              └── parseError – null if OK
```

### Non-compliant definition (schema mode)

> A site is **non-compliant** if **any** entry in its parsed schema result has
> `status === "did_not_opt_out"`.

Implemented in `isSchemaRowNonCompliant(schemaResult)` in `schemaClassification.js`.

### Data Type options

| Option | Loads | Filters |
|---|---|---|
| All data | `Crawl_Data_<state> - <period>.csv` | none |
| Null sites | `Crawl_Data_<state> - NullSites<period>.csv` | none |
| Potentially non-compliant | `Crawl_Data_<state> - PotentiallyNonCompliantSites<period>.csv` | legacy reasons filter |
| **Non-compliant (schema)** | `Crawl_Data_<state> - <period>.csv` | `isSchemaRowNonCompliant` |

The last option is only enabled in schema mode.

### Chart (ReasonTrendsChart.jsx)

In schema mode, the chart gains a **"Non-Compliant Sites (Schema)"** series that
plots `isSchemaRowNonCompliant` counts from the all-data CSV over time.

---

## 6. Key Files

| Path | Purpose |
|---|---|
| `client/JSON SCHEMA/compliance_classification_schema.json` | Formal JSON schema |
| `client/JSON SCHEMA/compliance_criteria/*.csv` | Classification rule tables |
| `client/JSON SCHEMA/Crawl_Data_CA - Aug2025.csv` | Crawl data with `compliance_classification` column |
| `client/JSON SCHEMA/generate_compliance_column.py` | Python script that adds the column |
| `client/src/utils/schemaClassification.js` | Core parsing + token + non-compliant logic |
| `client/src/utils/schemaClassification.test.js` | Unit tests (`node --test`) |
| `client/src/App.jsx` | Main UI: data type selector, table filter |
| `client/src/ReasonTrendsChart.jsx` | Trends chart with schema series |
