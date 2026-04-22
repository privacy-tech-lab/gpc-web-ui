# `--legacy` Flag — Usage Guide

The `--legacy` flag switches `gpp_schema_opt_out_chart.py` from the default schema-based chart to a **Before/After GPC** chart that exactly replicates the output of `monthly_data_analysis.py`.

---

## Usage

```bash
python3 gpp_schema_opt_out_chart.py \
  --input "DOWNLADEDFROMSERVER.csv" \
  --field SharingOptOut \
  --time "August 2025" \
  --legacy \
  --output chart.png
```

> **Important:** Always use a CSV exported directly from Google Sheets (not the local `public/` CSVs) when running in legacy mode. The local CSVs store all crawler errors as the string `'null'`, which causes 2 extra sites to be included that the old script would have excluded.

---

## What it does

Applies the same two-step filter pipeline as the old Colab script:

1. **Error filter** — excludes sites where the crawler encountered a non-recoverable error (`ReferenceError`, `doubleTimeoutError`, `WebDriverError`, etc.). Only null errors and `singleTimeoutError` are kept.
2. **Subject filter** — keeps only sites with at least one privacy string (USPS, OptanonConsent, GPP, or Well-known) and at least one third-party request.

Then counts SharingOptOut (or the specified field) from the raw `decoded_gpp_before_gpc` / `decoded_gpp_after_gpc` columns, aggregating across all GPP sections per site, and renders two horizontal bars: **Before GPC** and **After GPC**.

---

## Options

| Flag | Description |
|---|---|
| `--legacy` | Enable legacy Before/After mode |
| `--no-filter` | Skip the subject filter (step 2 above); error filter still applies |
| `--field` | GPP field to plot: `SaleOptOut`, `SharingOptOut` (default), `TargetedAdvertisingOptOut` |
| `--all-fields` | Generate charts for all three fields |
| `--time` | Period label shown in the chart title |
| `--output` | Output file path (omit to display interactively) |

---

## Default (schema) mode vs legacy mode

| | Default (schema) | Legacy (`--legacy`) |
|---|---|---|
| Data source | `compliance_classification` JSON column | `decoded_gpp_before/after_gpc` columns |
| Chart rows | One per GPP section (US National, CA, etc.) | Before GPC / After GPC |
| Statuses | opted_out, did_not_opt_out, not_applicable, invalid_missing | Opted Out, Did Not Opt Out, Not Applicable |
| Site filter | None (all rows) | Error filter + subject filter |
| Input CSV | Local public/ CSVs work fine | Use server export for exact match |
