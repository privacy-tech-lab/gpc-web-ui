#!/usr/bin/env python3
"""
Generate the compliance_classification JSON column for each site in
'Crawl_Data_CA - Aug2025.csv', following the schema in
compliance_classification_schema.json and the rules in the
compliance_criteria/ CSVs.

Run from any directory:
    python3 "path/to/JSON SCHEMA/generate_compliance_column.py"

The script reads and overwrites Crawl_Data_CA - Aug2025.csv in-place
(writing to a temp file first, then replacing).
"""

import csv
import json
import re
import ast
import os

_HERE = os.path.dirname(os.path.abspath(__file__))

CSV_IN  = os.path.join(_HERE, "Crawl_Data_CA - Aug2025.csv")
CSV_OUT = os.path.join(_HERE, "Crawl_Data_CA - Aug2025_with_classification.csv")

SCHEMA_REF = "./compliance_classification_schema.json"
SCHEMA_VERSION = "1.0.0"

# ─── GPP fields we track ────────────────────────────────────────────────────
GPP_OPT_OUT_FIELDS = ["SaleOptOut", "SharingOptOut", "TargetedAdvertisingOptOut"]

# ─── Helpers ─────────────────────────────────────────────────────────────────

def is_valid_usps(s):
    """True if s is a 4-char USPS string with valid chars."""
    if not isinstance(s, str):
        return False
    return bool(re.fullmatch(r'1[YN-][YN-][YN-]', s))

def classify_usps(before_raw, after_raw):
    """
    Returns one of: opted_out | did_not_opt_out | invalid_missing | not_applicable | None
    None means no USPS data at all -> schema field is null.
    Rules (from USPS Compliance Classification.csv):
      - Uses the better of uspapi or usp_cookies for each side.
      - before = the string if valid, else the raw value (or None if absent).
      - after  = the string if valid, else the raw value (or None if absent).
    """
    before = _best_usps(before_raw)
    after  = _best_usps(after_raw)

    # Null condition: no USPS detected at all before or after
    if before is None and after is None:
        return None  # -> null in schema

    b_valid = is_valid_usps(before)
    a_valid = is_valid_usps(after)

    # After is valid
    if a_valid:
        after_opt = after[2]  # 3rd char
        if after_opt == 'Y':
            return "opted_out"
        elif after_opt == 'N':
            return "did_not_opt_out"
        elif after_opt == '-':
            return "not_applicable"

    # After is invalid/null — anything before → invalid_missing
    return "invalid_missing"

def _best_usps(raw):
    """Pick uspapi or usp_cookies - whichever is a valid USPS string, else return raw."""
    # raw may be a tuple (uspapi, usp_cookies) or a single value
    if isinstance(raw, tuple):
        api, cookie = raw
        if is_valid_usps(api):
            return api
        if is_valid_usps(cookie):
            return cookie
        # Neither valid — return one that is not None/null/empty
        if api not in (None, 'null', '', 'None'):
            return api
        if cookie not in (None, 'null', '', 'None'):
            return cookie
        return None
    # Single value
    if raw in (None, 'null', '', 'None'):
        return None
    return raw


def classify_optanon(before, after):
    """
    Returns: opted_out | did_not_opt_out | invalid_missing | None (-> null)
    Null if neither before nor after detectable.
    """
    def extract_gpc(val):
        """'isGpcEnabled=0' -> 0, 'isGpcEnabled=1' -> 1, else None."""
        if val in (None, '', 'null', 'None'):
            return None
        m = re.search(r'isGpcEnabled=([01])', str(val))
        if m:
            return int(m.group(1))
        return 'invalid'

    b = extract_gpc(before)
    a = extract_gpc(after)

    if b is None and a is None:
        return None   # -> null

    # After side drives the classification
    if a == 1:
        return "opted_out"
    if a == 0:
        return "did_not_opt_out"
    # a is None or invalid
    return "invalid_missing"


def classify_wellknown(wk_raw):
    """
    Returns: opted_out | did_not_opt_out | invalid | None (-> null)
    """
    if wk_raw in (None, '', 'null', 'None', 'none'):
        return None

    s = str(wk_raw)
    if "'gpc': true" in s or '"gpc": true' in s:
        return "opted_out"
    if "'gpc': false" in s or '"gpc": false' in s:
        return "did_not_opt_out"
    # file was found but can't be parsed
    return "invalid"


def parse_gpp_decoded(raw):
    """
    Parse a decoded_gpp field (Python-dict-like string) into a dict of
    {section_name: {field: value, ...}} or None/{} if absent/empty.
    """
    if raw in (None, '', 'null', 'None', 'none', '{}'):
        return {}
    s = str(raw).strip()
    if s == 'None' or s == '{}':
        return {}
    try:
        # Replace Python booleans so ast can parse them
        obj = ast.literal_eval(s)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    return None  # unparseable -> "invalid"


def gpp_field_status(before_val, after_val):
    """
    Map a (before, after) field value pair to a schema status string.
    Values are floats (0.0, 1.0, 2.0) or None (missing/invalid).
    Rules from GPP Compliance Classification table:
      0 = not applicable
      1 = opted out
      2 = did not opt out

    - If after == 1.0 → opted_out (regardless of before, unless before==1.0 → still opted_out)
      Actually from table:
        (any, 1.0)  → opted_out  (rows 3, 7, 11, 15)
        (any, 2.0)  → did_not_opt_out (rows 4, 8, 10, 12, 16)
        (any, 0.0)  → not_applicable  (rows 2, 14)  [but NOT (1.0, 0.0) → that's invalid! row 6]
        (any, None) → invalid_missing
    Wait - let me reread carefully:
      Row 6: before=1.0, after=0.0  → invalid_missing (section disappeared)
      Row 14: before=None, after=0.0 → not_applicable
      Row 2: before=0.0, after=0.0  → not_applicable (both 0)
    So:
      after == None/invalid → invalid_missing
      after == 0.0:
        if before in (1.0, 2.0) → invalid_missing  (section disappeared / switched to 0)
        else → not_applicable
      after == 1.0 → opted_out
      after == 2.0 → did_not_opt_out
    """
    if after_val is None:
        return "invalid_missing"
    if after_val == 1.0:
        return "opted_out"
    if after_val == 2.0:
        return "did_not_opt_out"
    if after_val == 0.0:
        # before was opted-out or did-not-opt-out → section went to 0 → invalid/missing
        if before_val in (1.0, 2.0):
            return "invalid_missing"
        return "not_applicable"
    return "invalid_missing"


def classify_gpp(decoded_before_raw, decoded_after_raw):
    """
    Returns gpp object for schema or None (-> null) if no GPP data at all.
    """
    before_dict = parse_gpp_decoded(decoded_before_raw)
    after_dict  = parse_gpp_decoded(decoded_after_raw)

    # Both completely absent
    if (before_dict is not None and len(before_dict) == 0 and
            after_dict is not None and len(after_dict) == 0):
        return None  # -> null in schema

    # Treat None (unparseable) as "invalid"
    before_invalid = (before_dict is None)
    after_invalid  = (after_dict is None)

    if before_invalid and after_invalid:
        # Both invalid - can't classify, treat as null
        return None

    # Gather all sections seen in either before or after
    sections = set()
    if not before_invalid:
        sections.update(before_dict.keys())
    if not after_invalid:
        sections.update(after_dict.keys())

    classifications = []

    for section_key in sections:
        # Map section key to state abbreviation
        state = _section_to_state(section_key)
        if state is None:
            continue  # skip unrecognized sections

        before_section = {} if before_invalid else before_dict.get(section_key, {})
        after_section  = {} if after_invalid  else after_dict.get(section_key, {})

        # If section exists in either dict, classify each of the three fields
        # that are present in at least one of the two dicts
        # (only if the field has numeric values)
        all_fields_in_section = set()
        if isinstance(before_section, dict):
            all_fields_in_section.update(before_section.keys())
        if isinstance(after_section, dict):
            all_fields_in_section.update(after_section.keys())

        for field in GPP_OPT_OUT_FIELDS:
            # Only include if field present in at least one side
            if field not in all_fields_in_section:
                continue

            b_val = _get_field_val(before_section, field)
            a_val = _get_field_val(after_section, field)

            # Skip if both sides have no data for this field
            if b_val is None and a_val is None:
                continue

            status = gpp_field_status(b_val, a_val)
            classifications.append({
                "state": state,
                "field": field,
                "status": status
            })

    if not classifications:
        return None

    return {"classifications": classifications}


def _get_field_val(section_dict, field):
    """Extract numeric value for a field from a GPP section dict."""
    if not isinstance(section_dict, dict):
        return None
    v = section_dict.get(field)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# Map GPP section keys (as decoded by crawler) to state abbreviations
_SECTION_STATE_MAP = {
    'usnatv1': 'US',
    'uscav1':  'CA',
    'uscov1':  'CO',
    'usctv1':  'CT',
    'usutv1':  'UT',
    'usvav1':  'VA',
    'usiatv1': 'IA',
    'usorv1':  'OR',
    'usmtv1':  'MT',
    'usnhv1':  'NH',
    'usnjv1':  'NJ',
    'ustnv1':  'TN',
    'ustxv1':  'TX',
    'usdel1':  'DE',
    'uspv1':   'US',   # legacy USP v1 - maps to US National
}

def _section_to_state(key):
    k = key.lower()
    return _SECTION_STATE_MAP.get(k, None)


# ─── Main processing ─────────────────────────────────────────────────────────

def classify_row(row):
    domain = row['domain']

    # USPS: take best of api and cookie for each side
    uspapi_before   = row.get('uspapi_before_gpc', '')
    uspapi_after    = row.get('uspapi_after_gpc', '')
    usp_cook_before = row.get('usp_cookies_before_gpc', '')
    usp_cook_after  = row.get('usp_cookies_after_gpc', '')

    # Prefer the valid one; pass tuple so classifier can pick
    usps_before_pair = (
        None if uspapi_before in ('', 'null', 'None', None) else uspapi_before,
        None if usp_cook_before in ('', 'null', 'None', None) else usp_cook_before,
    )
    usps_after_pair = (
        None if uspapi_after in ('', 'null', 'None', None) else uspapi_after,
        None if usp_cook_after in ('', 'null', 'None', None) else usp_cook_after,
    )

    usps_status = classify_usps(usps_before_pair, usps_after_pair)

    # OptanonConsent
    obc = row.get('OptanonConsent_before_gpc', '')
    oac = row.get('OptanonConsent_after_gpc', '')
    optanon_status = classify_optanon(
        None if obc in ('', 'null', 'None', None) else obc,
        None if oac in ('', 'null', 'None', None) else oac,
    )

    # Well-known
    wk = row.get('Well-known', '')
    wk_status = classify_wellknown(None if wk in ('', 'null', 'None', None) else wk)

    # GPP
    gpp_before = row.get('decoded_gpp_before_gpc', '')
    gpp_after  = row.get('decoded_gpp_after_gpc', '')
    gpp_result = classify_gpp(
        None if gpp_before in ('', 'null', 'None', None) else gpp_before,
        None if gpp_after  in ('', 'null', 'None', None) else gpp_after,
    )

    obj = {
        "$schema": SCHEMA_REF,
        "schemaVersion": SCHEMA_VERSION,
        "site": domain,
        "usps": {"status": usps_status} if usps_status is not None else None,
        "optanonConsent": {"status": optanon_status} if optanon_status is not None else None,
        "wellKnown": {"status": wk_status} if wk_status is not None else None,
        "gpp": gpp_result,
    }

    return json.dumps(obj, separators=(',', ':'))


def main():
    with open(CSV_IN, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames

    new_fieldnames = list(fieldnames) + ['compliance_classification']

    print(f"Processing {len(rows)} rows...")

    with open(CSV_OUT, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames)
        writer.writeheader()
        for row in rows:
            row['compliance_classification'] = classify_row(row)
            writer.writerow(row)
            print(f"  {row['domain']}: done")

    print(f"\n✓ Written to: {CSV_OUT}")


if __name__ == '__main__':
    main()
