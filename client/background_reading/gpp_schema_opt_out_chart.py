#!/usr/bin/env python3
"""
gpp_schema_opt_out_chart.py

Generates horizontal stacked bar charts showing GPP compliance status
broken down by GPP section/state (US National, California, Connecticut, etc.),
using the `compliance_classification` JSON schema column.

Background
----------
The old monthly_data_analysis.py approach decoded raw GPP strings
(decoded_gpp_before_gpc / decoded_gpp_after_gpc) and mapped the numeric
field values (0 = N/A, 1 = opted-out, 2 = did-not-opt-out) directly to
Before/After GPC bar charts.

This script replaces that with the new schema-based approach:
  - Reads the `compliance_classification` JSON column
  - Extracts per-(state, field) statuses already encoded by generate_compliance_column.py
  - Renders one horizontal bar per GPP section showing the status breakdown
  - Statuses: opted_out | did_not_opt_out | not_applicable | invalid_missing

Use --legacy to reproduce the old Before/After GPC chart style instead.

Usage
-----
    # Single field, single CSV (schema mode, one bar per GPP section):
    python3 gpp_schema_opt_out_chart.py \\
        --input "path/to/Crawl_Data_CA - August2025.csv" \\
        --field SharingOptOut \\
        --time "August 2025" \\
        --output sharing_chart.png

    # All three GPP fields:
    python3 gpp_schema_opt_out_chart.py \\
        --input "path/to/data.csv" \\
        --all-fields \\
        --time "August 2025"

    # Multiple CSVs side-by-side (one input per state dataset):
    python3 gpp_schema_opt_out_chart.py \\
        --input "CA/data.csv" "CT/data.csv" "CO/data.csv" \\
        --labels "California" "Connecticut" "Colorado" \\
        --field SharingOptOut \\
        --time "August 2025"

    # Limit to specific GPP sections:
    python3 gpp_schema_opt_out_chart.py \\
        --input data.csv --field SharingOptOut \\
        --sections US CA CT

    # Aggregate all GPP sections into a single bar (schema column):
    python3 gpp_schema_opt_out_chart.py \\
        --input data.csv --field SharingOptOut \\
        --time "August 2025" --aggregate

    # Before/After GPC pairs per section (schema After + raw Before):
    python3 gpp_schema_opt_out_chart.py \\
        --input data.csv --field SharingOptOut \\
        --time "August 2025" --before-after-by-section

    # Legacy Before/After GPC chart (replicates monthly_data_analysis.py output):
    python3 gpp_schema_opt_out_chart.py \\
        --input data.csv --field SharingOptOut \\
        --time "August 2025" --legacy
"""

import argparse
import ast
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# ─── Status definitions ───────────────────────────────────────────────────────

# Display order within each stacked bar (left → right)
STATUS_ORDER = ['not_applicable', 'did_not_opt_out', 'opted_out', 'invalid_missing']

# Semantic colours matching the web UI's schemaClassification.js palette
STATUS_COLORS = {
    'opted_out':       '#9ee6b0',  # green
    'did_not_opt_out': '#90dcfc',  # blue
    'not_applicable':  '#d6baca',  # pink/mauve
    'invalid_missing': '#f59e0b',  # amber
}

STATUS_LABELS = {
    'opted_out':       'Opted Out',
    'did_not_opt_out': 'Did Not Opt Out',
    'not_applicable':  'Not Applicable',
    'invalid_missing': 'Invalid / Missing',
}

# ─── GPP section metadata ─────────────────────────────────────────────────────

SECTION_DISPLAY_NAMES = {
    'US':  'US National (usnatv1)',
    'CA':  'California (uscav1)',
    'CO':  'Colorado (uscov1)',
    'CT':  'Connecticut (usctv1)',
    'VA':  'Virginia (usvav1)',
    'UT':  'Utah (usutv1)',
    'IA':  'Iowa (usiatv1)',
    'OR':  'Oregon (usorv1)',
    'MT':  'Montana (usmtv1)',
    'NH':  'New Hampshire (usnhv1)',
    'NJ':  'New Jersey (usnjv1)',
    'TN':  'Tennessee (ustnv1)',
    'TX':  'Texas (ustxv1)',
    'DE':  'Delaware (usdel1)',
}

# Canonical display order for sections
SECTION_ORDER = ['US', 'CA', 'CO', 'CT', 'VA', 'UT', 'IA', 'OR', 'MT', 'NH', 'NJ', 'TN', 'TX', 'DE']

# Reverse map: raw decoded_gpp section keys → state abbreviations
_SECTION_KEY_TO_ABBREV = {
    'usnatv1': 'US',
    'uscav1':  'CA',
    'uscov1':  'CO',
    'usctv1':  'CT',
    'usvav1':  'VA',
    'usutv1':  'UT',
    'usiatv1': 'IA',
    'usorv1':  'OR',
    'usmtv1':  'MT',
    'usnhv1':  'NH',
    'usnjv1':  'NJ',
    'ustnv1':  'TN',
    'ustxv1':  'TX',
    'usdel1':  'DE',
}

GPP_FIELDS = ['SaleOptOut', 'SharingOptOut', 'TargetedAdvertisingOptOut']

# Which sections support each field (matches generate_compliance_column.py logic)
FIELD_APPLICABLE_SECTIONS = {
    'SaleOptOut':                 {'US', 'CA', 'CO', 'CT', 'VA', 'UT', 'IA', 'OR', 'MT', 'NH', 'NJ', 'TN', 'TX', 'DE'},
    'SharingOptOut':              {'US', 'CA'},
    'TargetedAdvertisingOptOut':  {'US', 'CO', 'CT', 'VA', 'UT', 'IA', 'OR', 'MT', 'NH', 'NJ', 'TN', 'TX', 'DE'},
}

# ─── Data loading ─────────────────────────────────────────────────────────────

def load_csv(path: str) -> list[dict]:
    """Load a crawl-data CSV into a list of row dicts."""
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    if not rows:
        print(f"Warning: {path} is empty", file=sys.stderr)
    return rows


def parse_compliance_classification(cell: str) -> dict | None:
    """
    Parse the `compliance_classification` JSON string from a CSV cell.
    Returns the parsed dict, or None on any error / missing value.
    """
    if not cell or cell.strip() in ('', 'null', 'None', 'none'):
        return None
    try:
        return json.loads(cell)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None

# ─── Count extraction ─────────────────────────────────────────────────────────

def extract_counts_by_section(rows: list[dict], field: str) -> dict[str, dict[str, int]]:
    """
    For the given GPP field name (e.g. 'SharingOptOut'), iterate over all rows
    and tally per-section status counts.

    Returns:
        {state_abbrev: {status: count}}
        e.g. {'US': {'opted_out': 12, 'did_not_opt_out': 40, ...}, 'CA': {...}}
    """
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for row in rows:
        obj = parse_compliance_classification(row.get('compliance_classification', ''))
        if obj is None:
            continue

        gpp = obj.get('gpp')
        if not gpp or not isinstance(gpp, dict):
            continue

        for entry in gpp.get('classifications', []):
            if entry.get('field') != field:
                continue
            state  = entry.get('state', 'Unknown')
            status = entry.get('status', 'invalid_missing')
            counts[state][status] += 1

    return {state: dict(c) for state, c in counts.items()}


def extract_counts_family(rows: list[dict], family: str) -> dict[str, int]:
    """
    For non-GPP families (usps, optanonConsent, wellKnown), return status counts.

    Returns:
        {status: count}
    """
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        obj = parse_compliance_classification(row.get('compliance_classification', ''))
        if obj is None:
            continue
        entry = obj.get(family)
        if entry and isinstance(entry, dict):
            status = entry.get('status', 'invalid_missing')
            counts[status] += 1
    return dict(counts)


def extract_counts_aggregated(
    rows: list[dict],
    field: str,
) -> tuple[dict[str, int], dict[str, int]]:
    """
    Collapse all GPP sections into a single per-site status for both Before
    and After GPC, aggregated across all states.

    Before: decoded from decoded_gpp_before_gpc (3 statuses: opted_out,
            did_not_opt_out, not_applicable). Best status across sections wins.
    After:  decoded from compliance_classification schema (4 statuses, including
            invalid_missing). Best status across sections wins:
            opted_out > did_not_opt_out > not_applicable > invalid_missing.

    Returns (before_counts, after_counts), each {status: count}.
    """
    _priority = {'opted_out': 0, 'did_not_opt_out': 1, 'not_applicable': 2, 'invalid_missing': 3}
    before_counts: dict[str, int] = defaultdict(int)
    after_counts:  dict[str, int] = defaultdict(int)

    for row in rows:
        # --- After: schema column ---
        obj = parse_compliance_classification(row.get('compliance_classification', ''))
        if obj is not None:
            gpp = obj.get('gpp')
            if gpp and isinstance(gpp, dict):
                site_status: str | None = None
                for entry in gpp.get('classifications', []):
                    if entry.get('field') != field:
                        continue
                    status = entry.get('status', 'invalid_missing')
                    if site_status is None or _priority.get(status, 99) < _priority.get(site_status, 99):
                        site_status = status
                    if site_status == 'opted_out':
                        break
                if site_status:
                    after_counts[site_status] += 1

        # --- Before: raw decoded_gpp_before_gpc, aggregated across all sections ---
        before_raw = row.get('decoded_gpp_before_gpc', '')
        if before_raw in ('', 'None', 'none', 'null', '{}', None):
            continue
        try:
            gpp_dict = ast.literal_eval(before_raw)
        except Exception:
            continue
        if not isinstance(gpp_dict, dict):
            continue

        site_before: str | None = None
        for section_key in _SECTION_KEY_TO_ABBREV:
            sec = gpp_dict.get(section_key)
            if not isinstance(sec, dict):
                continue
            val = sec.get(field)
            if val is None:
                continue
            try:
                val = float(val)
            except (TypeError, ValueError):
                continue
            if val == 1.0:
                site_before = 'opted_out'
                break   # best possible
            elif val == 2.0 and site_before != 'opted_out':
                site_before = 'did_not_opt_out'
            elif val == 0.0 and site_before is None:
                site_before = 'not_applicable'

        if site_before:
            before_counts[site_before] += 1

    return dict(before_counts), dict(after_counts)


def extract_before_after_by_section(
    rows: list[dict],
    field: str,
) -> dict[str, tuple[dict[str, int], dict[str, int]]]:
    """
    For each GPP section, return (before_counts, after_counts).

    - before_counts: decoded from decoded_gpp_before_gpc raw column, per section
    - after_counts:  from compliance_classification schema column (same as default mode)

    Returns:
        {state_abbrev: (before_counts_dict, after_counts_dict)}
    """
    before: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    after:  dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for row in rows:
        # --- After: from schema classification ---
        obj = parse_compliance_classification(row.get('compliance_classification', ''))
        if obj is not None:
            gpp = obj.get('gpp')
            if gpp and isinstance(gpp, dict):
                for entry in gpp.get('classifications', []):
                    if entry.get('field') != field:
                        continue
                    state  = entry.get('state', 'Unknown')
                    status = entry.get('status', 'invalid_missing')
                    after[state][status] += 1

        # --- Before: from decoded_gpp_before_gpc raw per section ---
        before_raw = row.get('decoded_gpp_before_gpc', '')
        if before_raw in ('', 'None', 'none', 'null', '{}', None):
            continue
        try:
            gpp_dict = ast.literal_eval(before_raw)
        except Exception:
            continue
        if not isinstance(gpp_dict, dict):
            continue

        for section_key, abbrev in _SECTION_KEY_TO_ABBREV.items():
            sec = gpp_dict.get(section_key)
            if not isinstance(sec, dict):
                continue
            val = sec.get(field)
            if val is None:
                continue
            try:
                val = float(val)
            except (TypeError, ValueError):
                continue
            if val == 1.0:
                before[abbrev]['opted_out'] += 1
            elif val == 2.0:
                before[abbrev]['did_not_opt_out'] += 1
            elif val == 0.0:
                before[abbrev]['not_applicable'] += 1
            # other values silently skipped

    all_states = set(before.keys()) | set(after.keys())
    return {
        state: (dict(before[state]), dict(after[state]))
        for state in all_states
    }


# ─── Chart rendering ──────────────────────────────────────────────────────────

def _format_x(x: float, _pos) -> str:
    """Compact x-axis tick labels (e.g. 1000 → '1K')."""
    if x >= 1000:
        return f'{x/1000:.0f}K'
    return str(int(x))


def _annotate_small_segment(ax, x_center: float, y: float, label: str, direction: int = -1):
    """
    Draw an arrow + label for a bar segment that is too narrow to hold inline text.
    direction: -1 = label below bar, +1 = label above bar.
    """
    offset = direction * 0.38
    ax.annotate(
        label,
        xy=(x_center, y),
        xytext=(x_center, y + offset),
        ha='center', va='bottom' if direction < 0 else 'top',
        fontsize=8,
        arrowprops=dict(facecolor='black', arrowstyle='->', lw=0.7),
    )


def plot_gpp_field_by_section(
    counts_by_section: dict[str, dict[str, int]],
    field: str,
    time_label: str,
    sections_to_show: list[str] | None = None,
    min_sites: int = 0,
    output_path: str | None = None,
    show: bool = True,
) -> plt.Figure:
    """
    Render a horizontal stacked bar chart with one bar per GPP section.

    Args:
        counts_by_section: {state: {status: count}} from extract_counts_by_section()
        field:             GPP field name, e.g. 'SharingOptOut'
        time_label:        Period string for the chart title (e.g. 'August 2025')
        sections_to_show:  If provided, restrict to these state abbreviations
        min_sites:         Skip sections with fewer than this many sites
        output_path:       Save figure to this path (None = don't save)
        show:              Call plt.show() when True
    """
    # Determine which sections to plot
    ordered = [s for s in SECTION_ORDER if s in counts_by_section]
    # append any extra sections not in SECTION_ORDER
    for s in sorted(counts_by_section):
        if s not in ordered:
            ordered.append(s)

    if sections_to_show:
        ordered = [s for s in ordered if s in sections_to_show]

    if min_sites > 0:
        ordered = [s for s in ordered if sum(counts_by_section[s].values()) >= min_sites]

    if not ordered:
        print(f"[{field}] No sections to plot (check --sections / --min-sites).")
        return None

    totals = {s: sum(counts_by_section[s].values()) for s in ordered}
    n_total = sum(totals.values())

    # Y-axis labels  (e.g. "US National (usnatv1)\n(n=1,234)")
    y_labels = [
        f"{SECTION_DISPLAY_NAMES.get(s, s)}\n(n={totals[s]:,})"
        for s in ordered
    ]

    fig_height = max(3.0, len(ordered) * 1.0 + 2.5)
    fig, ax = plt.subplots(figsize=(12, fig_height))

    bar_height = 0.6
    small_threshold = 0.04   # segments < 4 % of bar get arrow annotation

    for row_idx, state in enumerate(ordered):
        state_counts = counts_by_section[state]
        total = totals[state]
        left = 0

        for status in STATUS_ORDER:
            val = state_counts.get(status, 0)
            if val == 0:
                continue
            color = STATUS_COLORS[status]
            ax.barh(row_idx, val, bar_height, left=left,
                    color=color, edgecolor='white', linewidth=0.5)

            fraction = val / total if total else 0
            if fraction >= small_threshold:
                ax.text(
                    left + val / 2, row_idx, str(val),
                    ha='center', va='center',
                    fontsize=9,
                    fontweight='bold' if val > 50 else 'normal',
                )
            else:
                _annotate_small_segment(ax, left + val / 2, row_idx, str(val),
                                        direction=1 if row_idx == 0 else -1)

            left += val

    # Axes formatting
    ax.set_yticks(range(len(ordered)))
    ax.set_yticklabels(y_labels, fontsize=10)
    ax.invert_yaxis()   # first section at the top
    ax.set_xlabel('Number of Sites', fontsize=11)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(_format_x))

    # Legend (at top, matching the reference image)
    legend_patches = [
        mpatches.Patch(facecolor=STATUS_COLORS[s], label=STATUS_LABELS[s])
        for s in STATUS_ORDER
    ]
    ax.legend(
        handles=legend_patches,
        loc='upper center',
        bbox_to_anchor=(0.5, 1.14),
        ncol=len(STATUS_ORDER),
        frameon=False,
        fontsize=10,
    )

    # Title
    title_time = f', {time_label}' if time_label else ''
    ax.set_title(
        f'{field} by GPP Section{title_time}  (n = {n_total:,})',
        fontsize=13, fontweight='bold', pad=42,
    )

    plt.tight_layout()

    if output_path:
        fig.savefig(output_path, bbox_inches='tight', dpi=150)
        print(f"Saved: {output_path}")

    if show:
        plt.show()

    return fig


def plot_multi_csv_comparison(
    csv_paths: list[str],
    labels: list[str],
    field: str,
    time_label: str,
    sections_to_show: list[str] | None = None,
    output_path: str | None = None,
    show: bool = True,
) -> plt.Figure:
    """
    Side-by-side comparison across multiple CSVs (e.g. one per state dataset).

    Each CSV becomes a column of horizontal bars; within each column, bars are
    organised by GPP section.  Useful for comparing CA vs CT vs CO datasets.
    """
    all_data = []
    for path, label in zip(csv_paths, labels):
        rows = load_csv(path)
        counts = extract_counts_by_section(rows, field)
        all_data.append({'label': label, 'counts': counts, 'n': len(rows)})

    # Gather all unique sections across inputs
    all_sections: set[str] = set()
    for d in all_data:
        all_sections.update(d['counts'].keys())

    ordered_sections = [s for s in SECTION_ORDER if s in all_sections]
    for s in sorted(all_sections):
        if s not in ordered_sections:
            ordered_sections.append(s)

    if sections_to_show:
        ordered_sections = [s for s in ordered_sections if s in sections_to_show]

    n_inputs = len(all_data)
    n_sections = len(ordered_sections)
    if n_sections == 0:
        print(f"[{field}] No sections to plot.")
        return None

    fig, axes = plt.subplots(
        1, n_inputs,
        figsize=(8 * n_inputs, max(3.0, n_sections * 0.9 + 2.5)),
        sharey=True,
    )
    if n_inputs == 1:
        axes = [axes]

    bar_height = 0.6
    small_threshold = 0.04

    for col_idx, (ax, d) in enumerate(zip(axes, all_data)):
        counts_by_section = d['counts']
        for row_idx, state in enumerate(ordered_sections):
            state_counts = counts_by_section.get(state, {})
            total = sum(state_counts.values())
            left = 0

            for status in STATUS_ORDER:
                val = state_counts.get(status, 0)
                if val == 0:
                    continue
                ax.barh(row_idx, val, bar_height, left=left,
                        color=STATUS_COLORS[status], edgecolor='white', linewidth=0.5)

                fraction = val / total if total else 0
                if fraction >= small_threshold:
                    ax.text(left + val / 2, row_idx, str(val),
                            ha='center', va='center', fontsize=8,
                            fontweight='bold' if val > 50 else 'normal')
                else:
                    _annotate_small_segment(ax, left + val / 2, row_idx, str(val),
                                            direction=1 if row_idx == 0 else -1)
                left += val

        ax.set_title(f"{d['label']}\n(n={d['n']:,})", fontsize=11)
        ax.invert_yaxis()
        ax.set_xlabel('Number of Sites', fontsize=10)
        ax.xaxis.set_major_formatter(plt.FuncFormatter(_format_x))

        if col_idx == 0:
            y_labels = [
                f"{SECTION_DISPLAY_NAMES.get(s, s)}"
                for s in ordered_sections
            ]
            ax.set_yticks(range(n_sections))
            ax.set_yticklabels(y_labels, fontsize=10)

    # Shared legend
    legend_patches = [
        mpatches.Patch(facecolor=STATUS_COLORS[s], label=STATUS_LABELS[s])
        for s in STATUS_ORDER
    ]
    fig.legend(
        handles=legend_patches,
        loc='upper center',
        bbox_to_anchor=(0.5, 1.04),
        ncol=len(STATUS_ORDER),
        frameon=False,
        fontsize=10,
    )

    title_time = f' ({time_label})' if time_label else ''
    fig.suptitle(f'{field} by GPP Section{title_time}',
                 fontsize=13, fontweight='bold', y=1.08)

    plt.tight_layout()

    if output_path:
        fig.savefig(output_path, bbox_inches='tight', dpi=150)
        print(f"Saved: {output_path}")

    if show:
        plt.show()

    return fig


def plot_aggregated(
    before_counts: dict[str, int],
    after_counts: dict[str, int],
    field: str,
    time_label: str,
    output_path: str | None = None,
    show: bool = True,
) -> plt.Figure:
    """
    Render a Before GPC / After GPC horizontal stacked bar chart, aggregated
    across all GPP sections (no per-state split).

    Before bar uses 3 statuses (no invalid_missing, same as legacy).
    After bar uses 4 statuses (includes invalid_missing in amber).
    No error or subject filter is applied — all rows with data are included.
    """
    n_after = sum(after_counts.values())
    n_before = sum(before_counts.values())

    if n_after == 0 and n_before == 0:
        print(f'[{field}] No data to plot (aggregate mode).')
        return None

    BEFORE_STATUS_ORDER = ['not_applicable', 'did_not_opt_out', 'opted_out']
    rows_data = [
        ('Before\nGPC', BEFORE_STATUS_ORDER, before_counts),
        ('After\nGPC',  STATUS_ORDER,         after_counts),
    ]

    fig, ax = plt.subplots(figsize=(12, 3.5))
    bar_height = 0.6
    small_threshold = 0.04

    for row_idx, (label, s_order, counts) in enumerate(rows_data):
        total = sum(counts.values())
        left = 0
        for status in s_order:
            val = counts.get(status, 0)
            if val == 0:
                continue
            ax.barh(row_idx, val, bar_height, left=left,
                    color=STATUS_COLORS[status], edgecolor='white', linewidth=0.5)
            fraction = val / total if total else 0
            if fraction >= small_threshold:
                ax.text(left + val / 2, row_idx, str(val),
                        ha='center', va='center', fontsize=9,
                        fontweight='bold' if val > 50 else 'normal')
            else:
                _annotate_small_segment(ax, left + val / 2, row_idx, str(val),
                                        direction=1 if row_idx == 0 else -1)
            left += val

    ax.set_yticks([0, 1])
    ax.set_yticklabels(['Before\nGPC', 'After\nGPC'], fontsize=11)
    ax.invert_yaxis()
    ax.set_xlabel('Number of Sites', fontsize=11)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(_format_x))

    # Legend: show all 4 statuses (Before won't have invalid_missing but amber stays in legend)
    legend_patches = [
        mpatches.Patch(facecolor=STATUS_COLORS[s], label=STATUS_LABELS[s])
        for s in STATUS_ORDER
    ]
    ax.legend(handles=legend_patches, loc='upper center',
              bbox_to_anchor=(0.5, 1.18), ncol=len(STATUS_ORDER),
              frameon=False, fontsize=10)

    title_time = f', {time_label}' if time_label else ''
    ax.set_title(
        f'{field} (All Sections Aggregated){title_time}  (n = {n_after:,})',
        fontsize=13, fontweight='bold', pad=42,
    )

    plt.tight_layout()

    if output_path:
        fig.savefig(output_path, bbox_inches='tight', dpi=150)
        print(f'Saved: {output_path}')

    if show:
        plt.show()

    return fig


def plot_before_after_by_section(
    data: dict[str, tuple[dict[str, int], dict[str, int]]],
    field: str,
    time_label: str,
    sections_to_show: list[str] | None = None,
    output_path: str | None = None,
    show: bool = True,
) -> plt.Figure:
    """
    Render Before GPC / After GPC bar pairs for each GPP section.

    Before bars read raw decoded_gpp_before_gpc values (3 statuses).
    After bars read compliance_classification schema (4 statuses, including
    invalid_missing).
    """
    ordered = [s for s in SECTION_ORDER if s in data]
    for s in sorted(data):
        if s not in ordered:
            ordered.append(s)

    if sections_to_show:
        ordered = [s for s in ordered if s in sections_to_show]

    if not ordered:
        print(f'[{field}] No sections to plot (before-after-by-section mode).')
        return None

    # Build flat list of rows: interleave Before/After pairs with blank gap rows between sections
    BEFORE_STATUS_ORDER = ['not_applicable', 'did_not_opt_out', 'opted_out']
    row_labels: list[str] = []
    row_items:  list[tuple | None] = []   # (status_order, counts) | None = gap

    for i, state in enumerate(ordered):
        before_counts, after_counts = data[state]
        section_name = SECTION_DISPLAY_NAMES.get(state, state)
        before_total = sum(before_counts.values())
        after_total  = sum(after_counts.values())

        row_labels.append(f'{section_name}\nBefore GPC  (n={before_total:,})')
        row_items.append((BEFORE_STATUS_ORDER, before_counts))

        row_labels.append(f'{section_name}\nAfter GPC   (n={after_total:,})')
        row_items.append((STATUS_ORDER, after_counts))

        if i < len(ordered) - 1:
            row_labels.append('')     # visual gap between section groups
            row_items.append(None)

    n_rows = len(row_labels)
    fig_height = max(4.0, n_rows * 0.7 + 3.0)
    fig, ax = plt.subplots(figsize=(12, fig_height))

    bar_height = 0.55
    small_threshold = 0.04

    for row_idx, item in enumerate(row_items):
        if item is None:
            continue
        s_order, counts = item
        total = sum(counts.values())
        left = 0

        for status in s_order:
            val = counts.get(status, 0)
            if val == 0:
                continue
            ax.barh(row_idx, val, bar_height,
                    left=left,
                    color=STATUS_COLORS[status],
                    edgecolor='white', linewidth=0.5)
            fraction = val / total if total else 0
            if fraction >= small_threshold:
                ax.text(left + val / 2, row_idx, str(val),
                        ha='center', va='center', fontsize=9,
                        fontweight='bold' if val > 50 else 'normal')
            else:
                _annotate_small_segment(ax, left + val / 2, row_idx, str(val),
                                        direction=1 if row_idx == 0 else -1)
            left += val

    ax.set_yticks(range(n_rows))
    ax.set_yticklabels(row_labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel('Number of Sites', fontsize=11)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(_format_x))

    legend_patches = [
        mpatches.Patch(facecolor=STATUS_COLORS[s], label=STATUS_LABELS[s])
        for s in STATUS_ORDER
    ]
    ax.legend(handles=legend_patches, loc='upper center',
              bbox_to_anchor=(0.5, 1.06), ncol=len(STATUS_ORDER),
              frameon=False, fontsize=10)

    title_time = f', {time_label}' if time_label else ''
    ax.set_title(
        f'{field} Before/After GPC by Section{title_time}',
        fontsize=13, fontweight='bold', pad=36,
    )

    plt.tight_layout()

    if output_path:
        fig.savefig(output_path, bbox_inches='tight', dpi=150)
        print(f'Saved: {output_path}')

    if show:
        plt.show()

    return fig


# ─── Legacy (Before/After GPC) mode ──────────────────────────────────────────

# GPP section keys to check (in priority order) for legacy aggregation
_LEGACY_SECTIONS = ['usnatv1', 'uscav1', 'uscov1', 'usctv1', 'usvav1', 'usutv1',
                    'usiatv1', 'usorv1', 'usmtv1', 'usnhv1', 'usnjv1', 'ustnv1',
                    'ustxv1', 'usdel1']

LEGACY_STATUS_ORDER  = ['not_applicable', 'did_not_opt_out', 'opted_out']
LEGACY_STATUS_COLORS = {
    'opted_out':       '#9ee6b0',  # green
    'did_not_opt_out': '#90dcfc',  # blue
    'not_applicable':  '#d6baca',  # pink/mauve
}
LEGACY_STATUS_LABELS = {
    'opted_out':       'Opted Out',
    'did_not_opt_out': 'Did Not Opt Out',
    'not_applicable':  'Not Applicable',
}


def _is_added(row: dict) -> bool:
    """
    Replicates the `added` row filter from monthly_data_analysis.py line 129:

        added = full_merged_df[
            (status != 'not added') &
            (error IS NULL OR error == 'singleTimeoutError')
        ]

    The old Colab also ran `replace('null', np.nan)` on the raw sheet data,
    converting the string 'null' to NaN before this filter. Sites with
    ReferenceError, doubleTimeoutError, WebDriverError, etc. are excluded.

    NOTE: The local public/ CSVs store all errors as the string 'null', so
    they do not reflect this filter correctly. Use the server CSV
    (DOWNLADEDFROMSERVER.csv or a fresh export) for accurate legacy output.
    The two sites this filter removes that affect SharingOptOut are:
      - glidemagazine.com  (doubleTimeoutError)
      - bugsnag.com        (ReferenceError)
    """
    if row.get('status', '') == 'not added':
        return False
    error = row.get('error', '')
    # null/empty/NaN-equivalent strings pass; singleTimeoutError also passes
    return error in ('', 'null', 'None', 'none', 'singleTimeoutError')


def _is_subject_or_likely(row: dict) -> bool:
    """
    Replicates the subject_or_likely_with_privacy_string filter from
    monthly_data_analysis.py / processing_analysis_data.py:

      - Must have third_party_count > 0
      - Must have at least one privacy string detected (USPS, OAC, GPP, or Well-known)

    Applied on top of _is_added(). Sites failing this filter were excluded
    from the old Before/After charts.
    """
    absent = ('', 'null', 'None', 'none')

    try:
        if int(row.get('third_party_count', 0)) == 0:
            return False
    except (ValueError, TypeError):
        return False

    has_usps = any(row.get(c, '') not in absent for c in (
        'uspapi_before_gpc', 'uspapi_after_gpc',
        'usp_cookies_before_gpc', 'usp_cookies_after_gpc',
    ))
    has_oac = any(row.get(c, '') not in absent for c in (
        'OptanonConsent_before_gpc', 'OptanonConsent_after_gpc',
    ))
    has_gpp = any(row.get(c, '') not in absent for c in (
        'gpp_before_gpc', 'gpp_after_gpc',
    ))
    has_wk = "'gpc'" in str(row.get('Well-known', ''))

    return has_usps or has_oac or has_gpp or has_wk


def _legacy_row_status(decoded_gpp_raw: str, field: str) -> str | None:
    """
    Extract the highest-priority status for a single site from a raw
    decoded_gpp column value, aggregating across all GPP sections.

    Priority: opted_out > did_not_opt_out > not_applicable > None (no data).
    Mirrors the old script's approach of taking the best outcome across sections.

    Values: 1.0 = opted_out, 2.0 = did_not_opt_out, 0.0 = not_applicable.
    """
    if decoded_gpp_raw in ('', 'None', 'none', 'null', '{}', None):
        return None
    try:
        gpp_dict = ast.literal_eval(decoded_gpp_raw)
    except Exception:
        return None
    if not isinstance(gpp_dict, dict):
        return None

    status = None
    for section in _LEGACY_SECTIONS:
        sec = gpp_dict.get(section)
        if not isinstance(sec, dict):
            continue
        val = sec.get(field)
        if val is None:
            continue
        try:
            val = float(val)
        except (TypeError, ValueError):
            continue
        if val == 1.0:
            return 'opted_out'          # best possible — short-circuit
        elif val == 2.0 and status != 'opted_out':
            status = 'did_not_opt_out'
        elif val == 0.0 and status is None:
            status = 'not_applicable'

    return status


def extract_legacy_counts(rows: list[dict], field: str,
                          filter_subject: bool = True,
                          dedup_by_site_id: bool = True
                          ) -> tuple[dict[str, int], dict[str, int], int]:
    """
    Count Before/After GPC statuses for the given field using raw
    decoded_gpp columns, replicating monthly_data_analysis.py logic.

    Args:
        rows:              All CSV rows.
        field:             GPP field name (e.g. 'SharingOptOut').
        filter_subject:    Apply subject_or_likely_with_privacy_string filter.
        dedup_by_site_id:  Deduplicate on site_id (first occurrence wins),
                           matching old Colab behaviour.

    Returns:
        (before_counts, after_counts, n_sites)
        where each counts dict is {status: count}.
    """
    # Step 1: apply the error filter (replicates old script's `added` dataframe)
    filtered = [r for r in rows if _is_added(r)]
    # Step 2: apply the subject_or_likely_with_privacy_string filter
    if filter_subject:
        filtered = [r for r in filtered if _is_subject_or_likely(r)]

    if dedup_by_site_id:
        seen: set[str] = set()
        deduped = []
        for r in filtered:
            sid = r.get('site_id', r.get('domain', ''))
            if sid not in seen:
                seen.add(sid)
                deduped.append(r)
        filtered = deduped

    before_counts: dict[str, int] = defaultdict(int)
    after_counts:  dict[str, int] = defaultdict(int)
    n_sites = len(filtered)

    for row in filtered:
        b = _legacy_row_status(row.get('decoded_gpp_before_gpc', ''), field)
        a = _legacy_row_status(row.get('decoded_gpp_after_gpc',  ''), field)
        if b:
            before_counts[b] += 1
        if a:
            after_counts[a] += 1

    return dict(before_counts), dict(after_counts), n_sites


def plot_legacy_before_after(
    rows: list[dict],
    field: str,
    time_label: str,
    filter_subject: bool = True,
    dedup_by_site_id: bool = True,
    output_path: str | None = None,
    show: bool = True,
) -> plt.Figure:
    """
    Render the old-style Before/After GPC horizontal stacked bar chart.

    Reads decoded_gpp_before/after columns directly (not compliance_classification),
    aggregates across all GPP sections per site, and applies the
    subject_or_likely_with_privacy_string filter matching old behaviour.
    """
    before_counts, after_counts, n_sites = extract_legacy_counts(
        rows, field, filter_subject=filter_subject,
        dedup_by_site_id=dedup_by_site_id,
    )

    n_after = sum(after_counts.values())
    rows_data = [
        ('Before\nGPC', before_counts),
        ('After\nGPC',  after_counts),
    ]

    fig, ax = plt.subplots(figsize=(12, 3.5))
    bar_height = 0.6
    small_threshold = 0.04

    for row_idx, (label, counts) in enumerate(rows_data):
        total = sum(counts.values())
        left = 0
        for status in LEGACY_STATUS_ORDER:
            val = counts.get(status, 0)
            if val == 0:
                continue
            ax.barh(row_idx, val, bar_height, left=left,
                    color=LEGACY_STATUS_COLORS[status],
                    edgecolor='white', linewidth=0.5)
            fraction = val / total if total else 0
            if fraction >= small_threshold:
                ax.text(left + val / 2, row_idx, str(val),
                        ha='center', va='center', fontsize=9,
                        fontweight='bold' if val > 50 else 'normal')
            else:
                _annotate_small_segment(ax, left + val / 2, row_idx, str(val),
                                        direction=1 if row_idx == 0 else -1)
            left += val

    ax.set_yticks([0, 1])
    ax.set_yticklabels(['Before\nGPC', 'After\nGPC'], fontsize=11)
    ax.invert_yaxis()
    ax.set_xlabel('Number of Sites', fontsize=11)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(_format_x))

    legend_patches = [
        mpatches.Patch(facecolor=LEGACY_STATUS_COLORS[s], label=LEGACY_STATUS_LABELS[s])
        for s in LEGACY_STATUS_ORDER
    ]
    ax.legend(handles=legend_patches, loc='upper center',
              bbox_to_anchor=(0.5, 1.18), ncol=3, frameon=False, fontsize=10)

    title_time = f', {time_label}' if time_label else ''
    ax.set_title(f'{field}{title_time}  (n = {n_after:,})',
                 fontsize=13, fontweight='bold', pad=42)

    plt.tight_layout()

    if output_path:
        fig.savefig(output_path, bbox_inches='tight', dpi=150)
        print(f'Saved: {output_path}')

    if show:
        plt.show()

    return fig


# ─── CLI ──────────────────────────────────────────────────────────────────────

def build_output_path(base: str, field: str, label: str | None = None) -> str:
    """
    Derive a sensible output file name from the base path, field, and optional label.
    e.g. base='chart.png', field='SharingOptOut' → 'chart_SharingOptOut.png'
    """
    p = Path(base)
    suffix = f'_{field}'
    if label:
        suffix += f'_{label.replace(" ", "_")}'
    return str(p.with_name(p.stem + suffix + p.suffix))


def main():
    parser = argparse.ArgumentParser(
        description=(
            'Generate GPP compliance status charts by section/state '
            'using the compliance_classification JSON schema column.'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--input', '-i', nargs='+', required=True,
        help='Path(s) to crawl-data CSV file(s) with compliance_classification column.',
    )
    parser.add_argument(
        '--labels', nargs='+', default=None,
        help=(
            'Human-readable label for each --input file '
            '(used in multi-CSV comparison chart titles). '
            'Defaults to the file name stem.'
        ),
    )
    parser.add_argument(
        '--field', '-f', default='SharingOptOut',
        choices=GPP_FIELDS,
        help='GPP field to analyse (default: SharingOptOut).',
    )
    parser.add_argument(
        '--all-fields', action='store_true',
        help='Generate charts for all three GPP fields.',
    )
    parser.add_argument(
        '--time', '-t', default='',
        help='Period label for chart title, e.g. "August 2025".',
    )
    parser.add_argument(
        '--output', '-o', default=None,
        help=(
            'Output image path. When --all-fields or multiple inputs are used '
            'the field/label is appended to the stem automatically. '
            'Omit to display interactively.'
        ),
    )
    parser.add_argument(
        '--sections', nargs='+', default=None,
        metavar='STATE',
        help=(
            'Restrict chart to these GPP section abbreviations, '
            'e.g. --sections US CA CT  (default: all detected).'
        ),
    )
    parser.add_argument(
        '--min-sites', type=int, default=0, metavar='N',
        help='Skip GPP sections with fewer than N sites (default: 0 = show all).',
    )
    parser.add_argument(
        '--no-show', action='store_true',
        help='Do not open an interactive window (useful in headless environments).',
    )
    parser.add_argument(
        '--aggregate', action='store_true',
        help=(
            'Collapse all GPP sections into a single bar per field using the '
            'compliance_classification schema column. Best status per site wins '
            '(opted_out > did_not_opt_out > not_applicable > invalid_missing).'
        ),
    )
    parser.add_argument(
        '--before-after-by-section', action='store_true',
        dest='before_after_by_section',
        help=(
            'Show Before GPC / After GPC bar pairs for each GPP section. '
            'The Before bar reads raw decoded_gpp_before_gpc column values per section; '
            'the After bar reads the compliance_classification schema column. '
            'Includes the invalid_missing category in the After bar.'
        ),
    )
    parser.add_argument(
        '--legacy', action='store_true',
        dest='legacy',
        default=False,
        help=(
            'Generate the old-style Before/After GPC chart using raw '
            'decoded_gpp_before/after columns instead of compliance_classification. '
            'Applies the subject_or_likely_with_privacy_string filter and '
            'deduplicates by site_id to match monthly_data_analysis.py output.'
        ),
    )
    parser.add_argument(
        '--no-filter', action='store_true',
        help=(
            '(Legacy mode only) Disable the subject_or_likely_with_privacy_string '
            'filter so all rows are included.'
        ),
    )

    args = parser.parse_args()

    show = not args.no_show
    fields = GPP_FIELDS if args.all_fields else [args.field]
    inputs = args.input
    labels = args.labels or [Path(p).stem for p in inputs]

    if len(labels) != len(inputs):
        parser.error('--labels must have the same number of entries as --input')

    # ── Single CSV ──────────────────────────────────────────────────────────
    if len(inputs) == 1:
        path = inputs[0]
        print(f'Loading: {path}')
        rows = load_csv(path)
        print(f'  {len(rows):,} rows loaded')

        # ── Legacy Before/After mode ────────────────────────────────────────
        if args.legacy:
            filter_subject = not args.no_filter
            for field in fields:
                print(f'\n── {field} (legacy Before/After mode) ──')
                before, after, n = extract_legacy_counts(
                    rows, field,
                    filter_subject=filter_subject,
                    dedup_by_site_id=True,
                )
                print(f'  Filter applied: {"subject_or_likely_with_privacy_string" if filter_subject else "none"}')
                print(f'  Sites in filter: {n:,}')
                print(f'  Before GPC: { {LEGACY_STATUS_LABELS[s]: before.get(s,0) for s in LEGACY_STATUS_ORDER} }')
                print(f'  After GPC:  { {LEGACY_STATUS_LABELS[s]: after.get(s,0)  for s in LEGACY_STATUS_ORDER} }')

                out = build_output_path(args.output, field, 'legacy') if args.output else None
                plot_legacy_before_after(
                    rows=rows,
                    field=field,
                    time_label=args.time,
                    filter_subject=filter_subject,
                    dedup_by_site_id=True,
                    output_path=out,
                    show=show,
                )

        # ── Aggregate mode: all sections → Before/After GPC ─────────────────
        elif args.aggregate:
            for field in fields:
                print(f'\n── {field} (aggregate mode) ──')
                before, after = extract_counts_aggregated(rows, field)
                if not before and not after:
                    print('  No GPP data found for this field.')
                    continue
                before_parts = ', '.join(f'{STATUS_LABELS.get(s, s)}: {before.get(s, 0)}'
                                         for s in ['not_applicable', 'did_not_opt_out', 'opted_out']
                                         if before.get(s, 0))
                after_parts = ', '.join(f'{STATUS_LABELS[s]}: {after.get(s, 0)}'
                                        for s in STATUS_ORDER if after.get(s, 0))
                print(f'  Before GPC: {before_parts}')
                print(f'  After GPC:  {after_parts}')

                out = build_output_path(args.output, field, 'aggregate') if args.output else None
                plot_aggregated(
                    before_counts=before,
                    after_counts=after,
                    field=field,
                    time_label=args.time,
                    output_path=out,
                    show=show,
                )

        # ── Before/After by section mode ──────────────────────────────────────
        elif args.before_after_by_section:
            for field in fields:
                print(f'\n── {field} (before-after-by-section mode) ──')
                data = extract_before_after_by_section(rows, field)
                if not data:
                    print('  No data found for this field.')
                    continue

                for state in SECTION_ORDER:
                    if state not in data:
                        continue
                    before_c, after_c = data[state]
                    b_parts = ', '.join(f'{STATUS_LABELS.get(s, s)}: {before_c.get(s, 0)}'
                                        for s in ['not_applicable', 'did_not_opt_out', 'opted_out']
                                        if before_c.get(s, 0))
                    a_parts = ', '.join(f'{STATUS_LABELS[s]}: {after_c.get(s, 0)}'
                                        for s in STATUS_ORDER if after_c.get(s, 0))
                    print(f'  {SECTION_DISPLAY_NAMES.get(state, state)}')
                    print(f'    Before: {b_parts}')
                    print(f'    After:  {a_parts}')

                out = build_output_path(args.output, field, 'before_after_section') if args.output else None
                plot_before_after_by_section(
                    data=data,
                    field=field,
                    time_label=args.time,
                    sections_to_show=args.sections,
                    output_path=out,
                    show=show,
                )

        # ── Schema per-section mode (default) ───────────────────────────────
        else:
            for field in fields:
                print(f'\n── {field} ──')
                counts = extract_counts_by_section(rows, field)
                if not counts:
                    print('  No GPP classifications found for this field.')
                    continue

                for state in SECTION_ORDER:
                    if state not in counts:
                        continue
                    c = counts[state]
                    total = sum(c.values())
                    parts = ', '.join(f'{STATUS_LABELS[s]}: {c.get(s,0)}' for s in STATUS_ORDER if c.get(s, 0))
                    print(f'  {SECTION_DISPLAY_NAMES.get(state, state)}: {total:,} sites  ({parts})')

                out = build_output_path(args.output, field) if args.output else None
                plot_gpp_field_by_section(
                    counts_by_section=counts,
                    field=field,
                    time_label=args.time,
                    sections_to_show=args.sections,
                    min_sites=args.min_sites,
                    output_path=out,
                    show=show,
                )

    # ── Multiple CSVs (comparison) ──────────────────────────────────────────
    else:
        for field in fields:
            print(f'\n── {field} (multi-CSV comparison) ──')
            out = build_output_path(args.output, field, 'comparison') if args.output else None
            plot_multi_csv_comparison(
                csv_paths=inputs,
                labels=labels,
                field=field,
                time_label=args.time,
                sections_to_show=args.sections,
                output_path=out,
                show=show,
            )


if __name__ == '__main__':
    main()
