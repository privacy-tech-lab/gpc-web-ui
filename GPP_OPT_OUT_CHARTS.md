# GPP Opt-Out Charts — Guide

> Replaces `LEGACY_FLAG_USAGE.md` and `GPP_CHART_METHODOLOGY.md`.

## TL;DR

Three main ways to look at the data — pick based on your question:

| Question | Mode |
|---|---|
| How many sites opted out in each state? | Default (no flag) |
| Does this match the old Colab numbers? | `--legacy` + server CSV |
| Both at once — state breakdown *and* legacy-matching totals? | `--before-after-by-time` |

The legacy mode and default mode **cannot be directly compared** — they count different things (filtered unique sites vs. unfiltered site×section pairs). `--before-after-by-time` bridges them: per-state breakdown where the status totals across states equal legacy exactly.

---

## Default — per-state schema bars

One bar per GPP section (US National, California, Colorado, etc.). No filter applied. Sites with both usnatv1 and uscov1 sections are counted in both bars.

```bash
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --field SharingOptOut \
    --time "August 2025" \
    --output Aug2025_schema_SharingOptOut.png
```

![Default schema chart](images/Aug2025_schema_SharingOptOut.png)

---

## `--legacy` — Before/After GPC (matches old Colab)

Replicates `monthly_data_analysis.py` exactly. Two bars: Before GPC and After GPC. Each site counted once (best status across all sections wins). Applies:
1. **Error filter** — drops sites with ReferenceError, doubleTimeoutError, etc.
2. **Subject filter** — keeps only sites with ≥1 privacy string and ≥1 third-party request

> **Use the server CSV** (`DOWNLADEDFROMSERVER_classified.csv`), not the local `public/` CSVs. Local CSVs store all errors as `'null'`, causing 2 extra sites to slip through the error filter.

```bash
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --field SharingOptOut \
    --time "August 2025" \
    --legacy \
    --output legacy_Aug2025_SharingOptOut.png
```

![Legacy chart](images/legacy_Aug2025_SharingOptOut_legacy.png)

---

## `--before-after-by-time` — Before/After GPC split by state

Two bars (Before GPC and After GPC), but within each bar the status groups are subdivided by GPP section — US National shown darker, state sections progressively lighter. Same error + subject filter as `--legacy`.

**The status totals across sections match legacy exactly:**
- Did Not Opt Out: US (558) + CO (7) = **565** = legacy's 565 ✓
- Opted Out: US (242) + CO (1) = **243** = legacy's 243 ✓

The amber Invalid/Missing segment (sites where the GPP string disappeared after GPC) is new — legacy silently excluded these.

```bash
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --field TargetedAdvertisingOptOut \
    --time "August 2025" \
    --before-after-by-time \
    --output Aug2025_TargetedAdvertisingOptOut_by_section.png
```

![Before/After by section](images/Aug2025_TargetedAdvertisingOptOut_by_section.png)

---

## `--legacy` + `--before-after-by-time` side by side

Run both for the same field to compare:

```bash
# Legacy — unique sites, aggregated
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --field TargetedAdvertisingOptOut \
    --time "August 2025" \
    --legacy \
    --output legacy_Aug2025_TargetedAdvertisingOptOut.png

# New — same filter, split by state
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --field TargetedAdvertisingOptOut \
    --time "August 2025" \
    --before-after-by-time \
    --output Aug2025_TargetedAdvertisingOptOut_by_section.png
```

![Legacy](images/legacy_Aug2025_TargetedAdvertisingOptOut_legacy.png)
![By section](images/Aug2025_TargetedAdvertisingOptOut_by_section.png)

---

## `--oac` — OptanonConsent Cookie Opt Outs

Before/After GPC bars for OptanonConsent cookie status. Error filter only (no subject filter).

```bash
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --time "August 2025" \
    --oac \
    --output Aug2025_OAC.png
```

![OAC chart](images/Aug2025_OAC.png)

---

## `--gpc-flag` — GPC Sub-section (Gpc=0 vs Gpc=1)

Shows how many GPP section entries had Gpc=0 vs Gpc=1, before and after GPC. Error + subject filter applied.

```bash
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --time "August 2025" \
    --gpc-flag \
    --output Aug2025_gpc_flag.png
```

![GPC flag chart](images/Aug2025_gpc_flag.png)

---

## `--opt-outs-by-mechanism` — Full Opt-Outs by Mechanism

Vertical bar chart: how many sites fully opted out via USP String, GPP String, or OptanonConsent. A site counts only if it opts out in all mechanisms it has implemented. Error + subject filter applied.

```bash
python3 background_reading/gpp_schema_opt_out_chart.py \
    --input "DOWNLADEDFROMSERVER_classified.csv" \
    --time "August 2025" \
    --opt-outs-by-mechanism \
    --output Aug2025_opt_outs_by_mechanism.png
```

![Opt-outs by mechanism](images/Aug2025_opt_outs_by_mechanism.png)

---

## Why legacy and default mode numbers differ

| | Default (schema) | `--legacy` |
|---|---|---|
| Data source | `compliance_classification` column | raw `decoded_gpp` columns |
| Counting unit | (site × section) pairs | unique sites |
| Filter | none | error + subject filter |
| Statuses | 4 (includes invalid_missing) | 3 (invalid_missing silently excluded) |
| Matches old Colab? | no | yes |

A "US National: 559 Did Not Opt Out" bar in default mode counts all rows where the usnatv1 section is did_not_opt_out — no filter, and ignores what that site's Colorado section says. A legacy "565 Did Not Opt Out" counts unique filtered sites where the best status across *all* sections is did_not_opt_out. These measure different things and should not be directly compared.

---

## Which fields apply to which states

| Field | Sections |
|---|---|
| `SaleOptOut` | All (US, CA, CO, CT, VA, UT, IA, OR, MT, NH, NJ, TN, TX, DE) |
| `SharingOptOut` | US National, California only |
| `TargetedAdvertisingOptOut` | All except California |

---

## Options reference

| Flag | Description |
|---|---|
| `--field` | `SaleOptOut`, `SharingOptOut` (default), `TargetedAdvertisingOptOut` |
| `--all-fields` | Generate charts for all three fields |
| `--time` | Period label for chart title, e.g. `"August 2025"` |
| `--sections US CA` | Restrict to specific GPP section abbreviations |
| `--no-filter` | Skip subject filter (legacy / before-after-by-time only) |
| `--output` | Output file path (omit to display interactively) |
| `--no-show` | Suppress interactive window (headless / scripted use) |
