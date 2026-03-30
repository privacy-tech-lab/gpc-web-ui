#!/usr/bin/env python3
"""
Batch runner: apply compliance_classification column to every main-data
Crawl_Data CSV across all states (CA, CO, CT, NJ) in both public/ and dist/.

Run from any directory:
    python3 "path/to/JSON SCHEMA/run_all_classifications.py"

Rules:
  - Processes files in client/public/<STATE>/ and client/dist/<STATE>/
  - Skips NullSites and PotentiallyNonCompliantSites files (they are filtered
    subsets and derive their column from the main files)
  - Adds or updates the compliance_classification column in-place (uses a temp
    file, then atomic rename)
  - Prints a summary of how many rows were processed per file
"""

import csv
import json
import os
import re
import ast
import tempfile
import shutil
import sys

# ─── Resolve paths ────────────────────────────────────────────────────────────

_HERE       = os.path.dirname(os.path.abspath(__file__))
_CLIENT_DIR = os.path.dirname(_HERE)          # …/client

STATES = ["CA", "CO", "CT", "NJ"]
ROOTS  = [
    os.path.join(_CLIENT_DIR, "public"),
    os.path.join(_CLIENT_DIR, "dist"),
]

SCHEMA_REF      = "./compliance_classification_schema.json"
SCHEMA_VERSION  = "1.0.0"
GPP_OPT_OUT_FIELDS = ["SaleOptOut", "SharingOptOut", "TargetedAdvertisingOptOut"]

# ─── Classification helpers (same logic as generate_compliance_column.py) ─────

def is_valid_usps(s):
    if not isinstance(s, str):
        return False
    return bool(re.fullmatch(r'1[YN-][YN-][YN-]', s))


def _best_usps(raw):
    if isinstance(raw, tuple):
        api, cookie = raw
        if is_valid_usps(api):    return api
        if is_valid_usps(cookie): return cookie
        if api    not in (None, 'null', '', 'None'): return api
        if cookie not in (None, 'null', '', 'None'): return cookie
        return None
    if raw in (None, 'null', '', 'None'): return None
    return raw


def classify_usps(before_raw, after_raw):
    before = _best_usps(before_raw)
    after  = _best_usps(after_raw)
    if before is None and after is None:
        return None
    a_valid = is_valid_usps(after)
    if a_valid:
        c = after[2]
        if c == 'Y': return "opted_out"
        if c == 'N': return "did_not_opt_out"
        if c == '-': return "not_applicable"
    return "invalid_missing"


def classify_optanon(before, after):
    def extract_gpc(val):
        if val in (None, '', 'null', 'None'): return None
        m = re.search(r'isGpcEnabled=([01])', str(val))
        if m: return int(m.group(1))
        return 'invalid'
    b, a = extract_gpc(before), extract_gpc(after)
    if b is None and a is None: return None
    if a == 1: return "opted_out"
    if a == 0: return "did_not_opt_out"
    return "invalid_missing"


def classify_wellknown(wk_raw):
    if wk_raw in (None, '', 'null', 'None', 'none'): return None
    s = str(wk_raw)
    if "'gpc': true"  in s or '"gpc": true'  in s: return "opted_out"
    if "'gpc': false" in s or '"gpc": false' in s: return "did_not_opt_out"
    return "invalid"


def parse_gpp_decoded(raw):
    if raw in (None, '', 'null', 'None', 'none', '{}'): return {}
    s = str(raw).strip()
    if s in ('None', '{}'): return {}
    try:
        obj = ast.literal_eval(s)
        if isinstance(obj, dict): return obj
    except Exception:
        pass
    return None


def gpp_field_status(before_val, after_val):
    if after_val is None:  return "invalid_missing"
    if after_val == 1.0:   return "opted_out"
    if after_val == 2.0:   return "did_not_opt_out"
    if after_val == 0.0:
        if before_val in (1.0, 2.0): return "invalid_missing"
        return "not_applicable"
    return "invalid_missing"


_SECTION_STATE_MAP = {
    'usnatv1': 'US', 'uscav1': 'CA', 'uscov1': 'CO', 'usctv1': 'CT',
    'usutv1': 'UT',  'usvav1': 'VA', 'usiatv1': 'IA', 'usorv1': 'OR',
    'usmtv1': 'MT',  'usnhv1': 'NH', 'usnjv1': 'NJ', 'ustnv1': 'TN',
    'ustxv1': 'TX',  'usdel1': 'DE', 'uspv1':  'US',
}

def _section_to_state(key):
    return _SECTION_STATE_MAP.get(key.lower(), None)


def _get_field_val(section_dict, field):
    if not isinstance(section_dict, dict): return None
    v = section_dict.get(field)
    if v is None: return None
    try:    return float(v)
    except: return None


def classify_gpp(decoded_before_raw, decoded_after_raw):
    before_dict = parse_gpp_decoded(decoded_before_raw)
    after_dict  = parse_gpp_decoded(decoded_after_raw)
    if (before_dict is not None and len(before_dict) == 0 and
            after_dict is not None and len(after_dict) == 0):
        return None
    before_invalid = (before_dict is None)
    after_invalid  = (after_dict  is None)
    if before_invalid and after_invalid: return None

    sections = set()
    if not before_invalid: sections.update(before_dict.keys())
    if not after_invalid:  sections.update(after_dict.keys())

    classifications = []
    for section_key in sections:
        state = _section_to_state(section_key)
        if state is None: continue
        before_section = {} if before_invalid else before_dict.get(section_key, {})
        after_section  = {} if after_invalid  else after_dict.get(section_key,  {})
        all_fields = set()
        if isinstance(before_section, dict): all_fields.update(before_section.keys())
        if isinstance(after_section,  dict): all_fields.update(after_section.keys())
        for field in GPP_OPT_OUT_FIELDS:
            if field not in all_fields: continue
            b_val = _get_field_val(before_section, field)
            a_val = _get_field_val(after_section,  field)
            if b_val is None and a_val is None: continue
            status = gpp_field_status(b_val, a_val)
            classifications.append({"state": state, "field": field, "status": status})

    if not classifications: return None
    return {"classifications": classifications}


def _clean(val):
    return None if val in ('', 'null', 'None', None) else val


def classify_row(row):
    domain = row['domain']

    usps_before_pair = (
        _clean(row.get('uspapi_before_gpc',    '')),
        _clean(row.get('usp_cookies_before_gpc',''))
    )
    usps_after_pair = (
        _clean(row.get('uspapi_after_gpc',     '')),
        _clean(row.get('usp_cookies_after_gpc', ''))
    )
    usps_status  = classify_usps(usps_before_pair, usps_after_pair)
    optanon_status = classify_optanon(
        _clean(row.get('OptanonConsent_before_gpc', '')),
        _clean(row.get('OptanonConsent_after_gpc',  ''))
    )
    wk_status = classify_wellknown(_clean(row.get('Well-known', '')))
    gpp_result = classify_gpp(
        _clean(row.get('decoded_gpp_before_gpc', '')),
        _clean(row.get('decoded_gpp_after_gpc',  ''))
    )

    obj = {
        "$schema":    SCHEMA_REF,
        "schemaVersion": SCHEMA_VERSION,
        "site":       domain,
        "usps":       {"status": usps_status}    if usps_status    is not None else None,
        "optanonConsent": {"status": optanon_status} if optanon_status is not None else None,
        "wellKnown":  {"status": wk_status}      if wk_status      is not None else None,
        "gpp":        gpp_result,
    }
    return json.dumps(obj, separators=(',', ':'))


# ─── Per-file processing ──────────────────────────────────────────────────────

def process_file(path, dry_run=False):
    """Read CSV, add/update compliance_classification, write back atomically."""
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])

    if 'compliance_classification' not in fieldnames:
        fieldnames.append('compliance_classification')

    if dry_run:
        return len(rows)

    dir_name = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix='.tmp.csv')
    try:
        with os.fdopen(fd, 'w', newline='', encoding='utf-8') as tmp:
            writer = csv.DictWriter(tmp, fieldnames=fieldnames, extrasaction='ignore')
            writer.writeheader()
            for row in rows:
                row['compliance_classification'] = classify_row(row)
                writer.writerow(row)
        shutil.move(tmp_path, path)
    except Exception:
        os.unlink(tmp_path)
        raise

    return len(rows)


# ─── Main ─────────────────────────────────────────────────────────────────────

def collect_targets():
    """Return list of (path, state, period) tuples for all main-data CSVs."""
    targets = []
    for root in ROOTS:
        for state in STATES:
            folder = os.path.join(root, state)
            if not os.path.isdir(folder):
                continue
            for fname in sorted(os.listdir(folder)):
                if not fname.endswith('.csv'):
                    continue
                if 'NullSites' in fname or 'Potentially' in fname:
                    continue
                targets.append(os.path.join(folder, fname))
    return targets


def main():
    dry_run = '--dry-run' in sys.argv
    targets = collect_targets()

    if not targets:
        print("No matching CSV files found.")
        sys.exit(1)

    total_files = len(targets)
    total_rows  = 0
    errors      = []

    print(f"{'[DRY RUN] ' if dry_run else ''}Found {total_files} main-data CSVs to process:\n")

    for i, path in enumerate(targets, 1):
        rel = os.path.relpath(path, _CLIENT_DIR)
        try:
            n = process_file(path, dry_run=dry_run)
            total_rows += n
            tag = "would process" if dry_run else "✓"
            print(f"  [{i:2d}/{total_files}] {tag}  {rel}  ({n} rows)")
        except Exception as e:
            errors.append((rel, str(e)))
            print(f"  [{i:2d}/{total_files}] ERROR  {rel}: {e}", file=sys.stderr)

    print(f"\n{'─' * 60}")
    if dry_run:
        print(f"[DRY RUN] Would have processed {total_rows} rows across {total_files} files.")
    else:
        print(f"Done. {total_rows} rows processed across {total_files - len(errors)} files.")
    if errors:
        print(f"\n{len(errors)} file(s) failed:")
        for rel, msg in errors:
            print(f"  {rel}: {msg}")
        sys.exit(1)


if __name__ == '__main__':
    main()
