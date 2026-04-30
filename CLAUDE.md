# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the `client/` directory:

```bash
cd client
npm run dev      # Start dev server (Vite HMR)
npm run build    # Production build
npm run lint     # ESLint
npm run preview  # Preview production build
npm test         # Run tests (Node built-in test runner)
```

Run a single test file:
```bash
node --test client/src/utils/schemaClassification.test.js
```

## Architecture

This is a **frontend-only** React + Vite app. There is no server — all data is served as static files from `client/public/`.

### Data Layout

CSV files live in `client/public/{STATE}/` and follow this naming convention:
- `Crawl_Data_{STATE} - {Period}.csv` — full dataset
- `Crawl_Data_{STATE} - PotentiallyNonCompliantSites{Period}.csv` — PNC subset
- `Crawl_Data_{STATE} - NullSites{Period}.csv` — null sites subset

Available states: `CA`, `CT`, `CO`, `NJ`. Not every state has data for every period — the mapping is hardcoded in `STATE_MONTHS` in `App.jsx`.

Supporting JSON files in `client/public/`:
- `descriptions_of_columns.json` — tooltip text for table column headers
- `header_friendly_names.json` — display names for column headers
- `classifications_of_compliance.json` — descriptions for legacy PNC reason codes

### Two Analysis Modes

The app has two distinct analysis modes (toggled in the Settings panel):

1. **Legacy mode** — filters by the `Reasons_Non_Compliant` column (a stringified Python list). Uses `PNC_REASON_LIST` constants.
2. **Schema mode** — parses the `compliance_classification` column (a JSON object) using `schemaClassification.js`. This is the newer, more structured approach.

Schema mode is unavailable for older CSVs that predate the `compliance_classification` column.

### Schema Classification System (`client/src/utils/schemaClassification.js`)

This is the core business logic file. It parses the `compliance_classification` JSON column into structured **tokens** of the form:
- `{family}|{status}` for top-level families (`usps`, `optanonConsent`, `wellKnown`)
- `gpp|{state}|{field}|{status}` for GPP state-level classifications

Valid statuses: `opted_out`, `did_not_opt_out`, `invalid_missing`, `invalid`, `not_applicable`.
Valid GPP fields: `SaleOptOut`, `SharingOptOut`, `TargetedAdvertisingOptOut`.

Key exports: `parseSchemaClassificationCell`, `getSchemaClassificationForRow`, `buildSchemaToken`, `parseSchemaToken`, `sortSchemaTokens`, `isSchemaRowNonCompliant`.

### Component Structure

- **`App.jsx`** — main shell; owns all filter state (state, period, data type, search, analysis mode, selected reasons/tokens); handles URL parameter sync (`window.history.replaceState`) for deep linking
- **`ReasonTrendsChart.jsx`** — time-series chart (line/bar) showing compliance trends across months; loads all CSVs for selected states eagerly on mount
- **`GppSectionBreakdownChart.jsx`** — stacked bar chart breaking down GPP section (US, CA, CO, etc.) compliance; decodes the `decoded_gpp_before_gpc`/`decoded_gpp_after_gpc` columns
- **`components/SchemaFilterPanel.jsx`** — filter UI for schema tokens in the table view
- **`components/ChartSchemaFilterPanel.jsx`** — filter UI for chart series selection
- **`components/Tooltip.jsx`** — hover tooltip wrapper
- **`utils/renderJSONCell.jsx`** — renders structured columns (JSON/list values) as formatted HTML in the table

### URL State Synchronization

`App.jsx` reads initial state from URL params on load and writes back on every state change using `replaceState`. Supported params: `state`, `period`, `datatype`, `search`, `mode`, `reasons` (comma-separated), `tokens` (comma-separated).

### Adding a New State or Time Period

1. Add the period key to `TIME_PERIODS` in `App.jsx`
2. Add the state's period list to `STATE_MONTHS` in `App.jsx`
3. Add the state code to `AVAILABLE_STATES` in both `App.jsx` and `ReasonTrendsChart.jsx`
4. Place the CSV files in `client/public/{STATE}/` following the naming convention above
