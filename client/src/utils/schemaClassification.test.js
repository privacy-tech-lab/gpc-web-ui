import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSchemaToken,
  getSchemaTokenDescription,
  getSchemaTokenLabel,
  isSchemaRowNonCompliant,
  parseJsonLike,
  parseSchemaClassificationCell,
  parseSchemaToken,
  sortSchemaTokens,
} from "./schemaClassification.js";

// ─── parseJsonLike ────────────────────────────────────────────────────────────

test("parseJsonLike – returns parsed object for valid JSON string", () => {
  const obj = { usps: { status: "opted_out" }, gpp: null };
  assert.deepEqual(parseJsonLike(JSON.stringify(obj)), obj);
});

test("parseJsonLike – returns parsed value for valid JSON primitives", () => {
  assert.equal(parseJsonLike("null"), null);
  assert.equal(parseJsonLike("true"), true);
  assert.equal(parseJsonLike("42"), 42);
});

test("parseJsonLike – handles leading/trailing whitespace", () => {
  const obj = { usps: { status: "opted_out" } };
  assert.deepEqual(parseJsonLike("  " + JSON.stringify(obj) + "\n"), obj);
});

test("parseJsonLike – converts Python None → null", () => {
  // Typical CSV cell produced by Python json.dumps with ensure_ascii replacements
  // or raw Python repr e.g. {'usps': None, 'gpp': None}
  const pythonLike = "{'usps': None, 'gpp': None}";
  assert.deepEqual(parseJsonLike(pythonLike), { usps: null, gpp: null });
});

test("parseJsonLike – converts Python True/False booleans", () => {
  const pythonLike = "{'flag': True, 'other': False}";
  assert.deepEqual(parseJsonLike(pythonLike), { flag: true, other: false });
});

test("parseJsonLike – converts Python single-quote strings to double-quote", () => {
  const pythonLike = "{'status': 'opted_out'}";
  assert.deepEqual(parseJsonLike(pythonLike), { status: "opted_out" });
});

test("parseJsonLike – returns original string when both parse attempts fail", () => {
  const garbage = "{completely: broken json ===";
  assert.equal(parseJsonLike(garbage), garbage);
});

test("parseJsonLike – returns empty string for blank string input", () => {
  assert.equal(parseJsonLike(""), "");
  assert.equal(parseJsonLike("   "), "");
});

test("parseJsonLike – returns non-string input unchanged", () => {
  const obj = { a: 1 };
  assert.equal(parseJsonLike(obj), obj);
  assert.equal(parseJsonLike(null), null);
  assert.equal(parseJsonLike(undefined), undefined);
  assert.equal(parseJsonLike(42), 42);
});

test("parseJsonLike – handles nested None/True/False in complex structure", () => {
  const pythonRepr =
    "{'usps': {'status': 'opted_out'}, 'wellKnown': None, 'gpp': {'classifications': []}, 'flag': True}";
  assert.deepEqual(parseJsonLike(pythonRepr), {
    usps: { status: "opted_out" },
    wellKnown: null,
    gpp: { classifications: [] },
    flag: true,
  });
});

// ─── parseSchemaClassificationCell – null / empty inputs ─────────────────────

test("parseSchemaClassificationCell – returns empty result for null", () => {
  const result = parseSchemaClassificationCell(null);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.entries, []);
  assert.equal(result.parsed, null);
});

test("parseSchemaClassificationCell – returns empty result for undefined", () => {
  const result = parseSchemaClassificationCell(undefined);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – returns empty result for empty string", () => {
  assert.equal(parseSchemaClassificationCell("").parseError, null);
  assert.equal(parseSchemaClassificationCell("   ").parseError, null);
});

// ─── parseSchemaClassificationCell – JSON parsing errors ────────────────────

test("parseSchemaClassificationCell – errors on completely malformed input", () => {
  const result = parseSchemaClassificationCell("{not-json");
  assert.match(result.parseError, /Could not parse/);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – errors on plain string value", () => {
  const result = parseSchemaClassificationCell('"just a string"');
  assert.match(result.parseError, /Could not parse/);
});

test("parseSchemaClassificationCell – errors on JSON array (not object)", () => {
  const result = parseSchemaClassificationCell("[]");
  assert.match(result.parseError, /Could not parse/);
});

test("parseSchemaClassificationCell – errors when no known classification sections", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ schemaVersion: "1.0.0", site: "example.com" })
  );
  assert.match(result.parseError, /missing expected classification sections/);
  assert.deepEqual(result.tokens, []);
});

// ─── parseSchemaClassificationCell – valid full payload ──────────────────────

test("parseSchemaClassificationCell – parses full payload with all families", () => {
  const payload = JSON.stringify({
    schemaVersion: "1.0.0",
    site: "example.com",
    usps: { status: "opted_out" },
    optanonConsent: { status: "did_not_opt_out" },
    wellKnown: { status: "opted_out" },
    gpp: {
      classifications: [
        { state: "US", field: "SaleOptOut", status: "opted_out" },
        { state: "CA", field: "SharingOptOut", status: "did_not_opt_out" },
      ],
    },
  });

  const result = parseSchemaClassificationCell(payload);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, [
    "usps|opted_out",
    "optanonConsent|did_not_opt_out",
    "wellKnown|opted_out",
    "gpp|US|SaleOptOut|opted_out",
    "gpp|CA|SharingOptOut|did_not_opt_out",
  ]);
});

test("parseSchemaClassificationCell – all sections null produces empty tokens", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      schemaVersion: "1.0.0",
      site: "example.com",
      usps: null,
      optanonConsent: null,
      wellKnown: null,
      gpp: null,
    })
  );
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – accepts Python-repr string from CSV", () => {
  // Simulates what Python might write into a CSV cell without JSON serialisation
  const csvCell =
    "{'usps': {'status': 'opted_out'}, 'optanonConsent': None, 'wellKnown': None, 'gpp': None}";
  const result = parseSchemaClassificationCell(csvCell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["usps|opted_out"]);
});

test("parseSchemaClassificationCell – accepts Python-repr with True/False/None mix", () => {
  const csvCell =
    "{'usps': {'status': 'did_not_opt_out'}, 'optanonConsent': {'status': 'opted_out'}, 'wellKnown': None, 'gpp': None}";
  const result = parseSchemaClassificationCell(csvCell);
  assert.equal(result.parseError, null);
  // FAMILY_ORDER(usps=0) < FAMILY_ORDER(optanonConsent=1) so usps comes first
  // regardless of status ordering; family order always wins.
  assert.deepEqual(result.tokens, [
    "usps|did_not_opt_out",
    "optanonConsent|opted_out",
  ]);
});

test("parseSchemaClassificationCell – tokens produced in family then status order", () => {
  const payload = JSON.stringify({
    usps: { status: "did_not_opt_out" },
    optanonConsent: { status: "opted_out" },
    wellKnown: { status: "invalid" },
    gpp: null,
  });
  const result = parseSchemaClassificationCell(payload);
  assert.equal(result.parseError, null);
  // FAMILY_ORDER: usps=0, optanonConsent=1, wellKnown=2
  assert.deepEqual(result.tokens, [
    "usps|did_not_opt_out",
    "optanonConsent|opted_out",
    "wellKnown|invalid",
  ]);
});

test("parseSchemaClassificationCell – only gpp section present", () => {
  const payload = JSON.stringify({
    gpp: {
      classifications: [
        { state: "CA", field: "SaleOptOut", status: "opted_out" },
      ],
    },
  });
  const result = parseSchemaClassificationCell(payload);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["gpp|CA|SaleOptOut|opted_out"]);
});

test("parseSchemaClassificationCell – populates labels and descriptions", () => {
  const payload = JSON.stringify({
    usps: { status: "opted_out" },
    gpp: null,
  });
  const result = parseSchemaClassificationCell(payload);
  assert.equal(result.labels["usps|opted_out"], "USPS: Opted Out");
  assert.match(
    result.descriptions["usps|opted_out"],
    /Counts sites whose USPS schema classification is "Opted Out"/
  );
});

test("parseSchemaClassificationCell – passes non-object through as parseError", () => {
  // Passing an already-parsed non-object (e.g. someone feeds a raw boolean)
  const result = parseSchemaClassificationCell(true);
  // parseJsonLike returns true unchanged; isPlainObject(true) → false
  assert.match(result.parseError, /Could not parse/);
});

// ─── USPS specific validation ─────────────────────────────────────────────────

test("parseSchemaClassificationCell – USPS all valid statuses accepted", () => {
  for (const status of [
    "opted_out",
    "did_not_opt_out",
    "invalid_missing",
    "not_applicable",
  ]) {
    const result = parseSchemaClassificationCell(
      JSON.stringify({ usps: { status } })
    );
    assert.equal(result.parseError, null, `Expected no error for usps status "${status}"`);
    assert.deepEqual(result.tokens, [`usps|${status}`]);
  }
});

test("parseSchemaClassificationCell – USPS rejects unsupported status", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ usps: { status: "invalid" } })
  );
  assert.match(result.parseError, /unsupported status/);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – USPS rejects non-object value", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ usps: "opted_out" })
  );
  assert.match(result.parseError, /usps must be an object/);
});

// ─── optanonConsent specific validation ───────────────────────────────────────

test("parseSchemaClassificationCell – optanonConsent valid statuses", () => {
  for (const status of ["opted_out", "did_not_opt_out", "invalid_missing"]) {
    const result = parseSchemaClassificationCell(
      JSON.stringify({ optanonConsent: { status } })
    );
    assert.equal(result.parseError, null, `optanonConsent status "${status}" should be valid`);
  }
});

test("parseSchemaClassificationCell – optanonConsent rejects not_applicable", () => {
  // not_applicable is NOT in optanonConsent's allowed set
  const result = parseSchemaClassificationCell(
    JSON.stringify({ optanonConsent: { status: "not_applicable" } })
  );
  assert.match(result.parseError, /unsupported status/);
});

// ─── wellKnown specific validation ────────────────────────────────────────────

test("parseSchemaClassificationCell – wellKnown accepts invalid status", () => {
  // wellKnown's unique status: "invalid" (bad file, not parseable)
  const result = parseSchemaClassificationCell(
    JSON.stringify({ wellKnown: { status: "invalid" } })
  );
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["wellKnown|invalid"]);
});

test("parseSchemaClassificationCell – wellKnown rejects not_applicable", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ wellKnown: { status: "not_applicable" } })
  );
  assert.match(result.parseError, /unsupported status/);
});

// ─── GPP classification validation ────────────────────────────────────────────

test("parseSchemaClassificationCell – gpp rejects non-object", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ gpp: "not-an-object" })
  );
  assert.match(result.parseError, /gpp must be an object/);
});

test("parseSchemaClassificationCell – gpp rejects missing classifications array", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ gpp: { someOtherKey: [] } })
  );
  assert.match(result.parseError, /gpp.classifications must be an array/);
});

test("parseSchemaClassificationCell – gpp empty classifications array is valid", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ gpp: { classifications: [] } })
  );
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – gpp rejects item missing state", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      gpp: {
        classifications: [
          { field: "SaleOptOut", status: "opted_out" }, // no state
        ],
      },
    })
  );
  assert.match(result.parseError, /missing a state/);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – gpp rejects unsupported field", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      gpp: {
        classifications: [
          { state: "CA", field: "BadField", status: "opted_out" },
        ],
      },
    })
  );
  assert.match(result.parseError, /unsupported field/);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – gpp rejects unsupported status", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      gpp: {
        classifications: [
          { state: "CA", field: "SaleOptOut", status: "invalid" },
        ],
      },
    })
  );
  assert.match(result.parseError, /unsupported status/);
  assert.deepEqual(result.tokens, []);
});

test("parseSchemaClassificationCell – gpp rejects non-object item in array", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      gpp: {
        classifications: ["CA|SaleOptOut|opted_out"],
      },
    })
  );
  assert.match(result.parseError, /must be an object/);
});

test("parseSchemaClassificationCell – gpp keeps valid items when one is invalid", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "opted_out" },
      gpp: {
        classifications: [
          { state: "CA", field: "SharingOptOut", status: "did_not_opt_out" },
          { state: "CA", field: "BadField", status: "opted_out" }, // invalid
        ],
      },
    })
  );
  // error is set but valid entries are still returned
  assert.match(result.parseError, /unsupported field/);
  assert.deepEqual(result.tokens, [
    "usps|opted_out",
    "gpp|CA|SharingOptOut|did_not_opt_out",
  ]);
});

test("parseSchemaClassificationCell – gpp all supported fields accepted", () => {
  const fields = [
    "SaleOptOut",
    "SharingOptOut",
    "TargetedAdvertisingOptOut",
  ];
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      gpp: {
        classifications: fields.map((field) => ({
          state: "CA",
          field,
          status: "opted_out",
        })),
      },
    })
  );
  assert.equal(result.parseError, null);
  // All three should produce tokens
  assert.equal(result.tokens.length, 3);
});

test("parseSchemaClassificationCell – gpp all supported statuses accepted", () => {
  for (const status of [
    "opted_out",
    "did_not_opt_out",
    "invalid_missing",
    "not_applicable",
  ]) {
    const result = parseSchemaClassificationCell(
      JSON.stringify({
        gpp: {
          classifications: [
            { state: "US", field: "SaleOptOut", status },
          ],
        },
      })
    );
    assert.equal(result.parseError, null, `gpp status "${status}" should be valid`);
    assert.deepEqual(result.tokens, [`gpp|US|SaleOptOut|${status}`]);
  }
});

// ─── GPP sort order ───────────────────────────────────────────────────────────

test("parseSchemaClassificationCell – gpp entries sorted: US before states, fields in defined order", () => {
  const payload = JSON.stringify({
    gpp: {
      classifications: [
        { state: "CA", field: "TargetedAdvertisingOptOut", status: "opted_out" },
        { state: "US", field: "SaleOptOut",                status: "opted_out" },
        { state: "CA", field: "SaleOptOut",                status: "opted_out" },
        { state: "CA", field: "SharingOptOut",             status: "opted_out" },
      ],
    },
  });
  const result = parseSchemaClassificationCell(payload);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, [
    // US normalises to "00-US" → sorts before "CA"
    "gpp|US|SaleOptOut|opted_out",
    "gpp|CA|SaleOptOut|opted_out",
    "gpp|CA|SharingOptOut|opted_out",
    "gpp|CA|TargetedAdvertisingOptOut|opted_out",
  ]);
});

// ─── buildSchemaToken ─────────────────────────────────────────────────────────

test("buildSchemaToken – builds top-level family token", () => {
  assert.equal(
    buildSchemaToken({ family: "usps", status: "opted_out" }),
    "usps|opted_out"
  );
  assert.equal(
    buildSchemaToken({ family: "wellKnown", status: "invalid" }),
    "wellKnown|invalid"
  );
});

test("buildSchemaToken – builds gpp token", () => {
  assert.equal(
    buildSchemaToken({
      family: "gpp",
      state: "CA",
      field: "SaleOptOut",
      status: "did_not_opt_out",
    }),
    "gpp|CA|SaleOptOut|did_not_opt_out"
  );
});

test("buildSchemaToken – returns empty string for missing family or status", () => {
  assert.equal(buildSchemaToken(null), "");
  assert.equal(buildSchemaToken({}), "");
  assert.equal(buildSchemaToken({ family: "usps" }), "");
  assert.equal(buildSchemaToken({ status: "opted_out" }), "");
});

// ─── parseSchemaToken ─────────────────────────────────────────────────────────

test("parseSchemaToken – parses a top-level token", () => {
  assert.deepEqual(parseSchemaToken("usps|opted_out"), {
    family: "usps",
    status: "opted_out",
  });
});

test("parseSchemaToken – parses a gpp token", () => {
  assert.deepEqual(parseSchemaToken("gpp|CA|SaleOptOut|did_not_opt_out"), {
    family: "gpp",
    state: "CA",
    field: "SaleOptOut",
    status: "did_not_opt_out",
  });
});

test("parseSchemaToken – returns null for invalid token", () => {
  assert.equal(parseSchemaToken(""), null);
  assert.equal(parseSchemaToken("too|many|parts|but|not|gpp"), null);
  assert.equal(parseSchemaToken("only_one_part"), null);
});

test("parseSchemaToken – returns null for a gpp token with only 3 parts", () => {
  // gpp needs exactly 4 parts
  assert.equal(parseSchemaToken("gpp|CA|SaleOptOut"), null);
});

// ─── getSchemaTokenLabel ──────────────────────────────────────────────────────

test("getSchemaTokenLabel – returns human-readable label for USPS opted_out", () => {
  assert.equal(getSchemaTokenLabel("usps|opted_out"), "USPS: Opted Out");
});

test("getSchemaTokenLabel – returns human-readable label for did_not_opt_out", () => {
  assert.equal(
    getSchemaTokenLabel("optanonConsent|did_not_opt_out"),
    "Optanon Consent: Did Not Opt Out"
  );
});

test("getSchemaTokenLabel – returns human-readable label for wellKnown invalid", () => {
  assert.equal(getSchemaTokenLabel("wellKnown|invalid"), "Well-Known: Invalid");
});

test("getSchemaTokenLabel – returns GPP label with state and field", () => {
  assert.equal(
    getSchemaTokenLabel("gpp|CA|TargetedAdvertisingOptOut|not_applicable"),
    "GPP: CA Targeted Advertising Opt Out (Not Applicable)"
  );
});

test("getSchemaTokenLabel – handles unknown family with humanized name", () => {
  // Unknown families fallback to humanizeIdentifier
  const label = getSchemaTokenLabel("myNewFamily|opted_out");
  assert.equal(label, "My New Family: Opted Out");
});

test("getSchemaTokenLabel – returns token string for unrecognized format", () => {
  assert.equal(getSchemaTokenLabel("bad_token"), "bad_token");
  assert.equal(getSchemaTokenLabel(""), "");
});

// ─── getSchemaTokenDescription ────────────────────────────────────────────────

test("getSchemaTokenDescription – returns description for usps token", () => {
  assert.match(
    getSchemaTokenDescription("usps|did_not_opt_out"),
    /Counts sites whose USPS schema classification is "Did Not Opt Out"/
  );
});

test("getSchemaTokenDescription – returns description for gpp token", () => {
  assert.match(
    getSchemaTokenDescription("gpp|CA|SaleOptOut|opted_out"),
    /Counts sites whose GPP classification includes CA Sale Opt Out/
  );
});

test("getSchemaTokenDescription – returns empty string for bad token", () => {
  assert.equal(getSchemaTokenDescription(""), "");
  assert.equal(getSchemaTokenDescription("no_pipe"), "");
});

// ─── sortSchemaTokens ─────────────────────────────────────────────────────────

test("sortSchemaTokens – sorts by family order first", () => {
  const tokens = sortSchemaTokens([
    "wellKnown|opted_out",
    "gpp|CA|SaleOptOut|opted_out",
    "optanonConsent|opted_out",
    "usps|opted_out",
  ]);
  assert.deepEqual(tokens, [
    "usps|opted_out",
    "optanonConsent|opted_out",
    "wellKnown|opted_out",
    "gpp|CA|SaleOptOut|opted_out",
  ]);
});

test("sortSchemaTokens – US sorts before CA within gpp", () => {
  const tokens = sortSchemaTokens([
    "gpp|CA|SaleOptOut|opted_out",
    "gpp|US|SaleOptOut|opted_out",
  ]);
  assert.deepEqual(tokens, [
    "gpp|US|SaleOptOut|opted_out",
    "gpp|CA|SaleOptOut|opted_out",
  ]);
});

test("sortSchemaTokens – within same family and state, sorts by field order", () => {
  const tokens = sortSchemaTokens([
    "gpp|CA|TargetedAdvertisingOptOut|opted_out",
    buildSchemaToken({ family: "gpp", state: "CA", field: "SharingOptOut", status: "opted_out" }),
    "gpp|CA|SaleOptOut|opted_out",
  ]);
  assert.deepEqual(tokens, [
    "gpp|CA|SaleOptOut|opted_out",
    "gpp|CA|SharingOptOut|opted_out",
    "gpp|CA|TargetedAdvertisingOptOut|opted_out",
  ]);
});

test("sortSchemaTokens – does not mutate original array", () => {
  const original = ["wellKnown|opted_out", "usps|opted_out"];
  sortSchemaTokens(original);
  assert.deepEqual(original, ["wellKnown|opted_out", "usps|opted_out"]);
});

test("sortSchemaTokens – handles empty array", () => {
  assert.deepEqual(sortSchemaTokens([]), []);
});

test("sortSchemaTokens – falls back to string compare for malformed tokens", () => {
  const tokens = sortSchemaTokens(["zzz_token", "aaa_token"]);
  assert.deepEqual(tokens, ["aaa_token", "zzz_token"]);
});

// ─── isSchemaRowNonCompliant ──────────────────────────────────────────────────

test("isSchemaRowNonCompliant – returns true when usps is did_not_opt_out", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "did_not_opt_out" },
      optanonConsent: null,
      wellKnown: null,
      gpp: null,
    })
  );
  assert.equal(isSchemaRowNonCompliant(result), true);
});

test("isSchemaRowNonCompliant – returns true when optanonConsent is did_not_opt_out", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "opted_out" },
      optanonConsent: { status: "did_not_opt_out" },
      wellKnown: null,
      gpp: null,
    })
  );
  assert.equal(isSchemaRowNonCompliant(result), true);
});

test("isSchemaRowNonCompliant – returns true when wellKnown is did_not_opt_out", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({ wellKnown: { status: "did_not_opt_out" } })
  );
  assert.equal(isSchemaRowNonCompliant(result), true);
});

test("isSchemaRowNonCompliant – returns true when any gpp classification is did_not_opt_out", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "opted_out" },
      gpp: {
        classifications: [
          { state: "CA", field: "SaleOptOut", status: "opted_out" },
          { state: "CA", field: "SharingOptOut", status: "did_not_opt_out" },
        ],
      },
    })
  );
  assert.equal(isSchemaRowNonCompliant(result), true);
});

test("isSchemaRowNonCompliant – returns false when all entries are opted_out", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "opted_out" },
      optanonConsent: { status: "opted_out" },
      wellKnown: { status: "opted_out" },
      gpp: {
        classifications: [
          { state: "US", field: "SaleOptOut", status: "opted_out" },
        ],
      },
    })
  );
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("isSchemaRowNonCompliant – returns false for all-null sections (no privacy strings)", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: null,
      optanonConsent: null,
      wellKnown: null,
      gpp: null,
    })
  );
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("isSchemaRowNonCompliant – returns false for invalid_missing and not_applicable statuses", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "not_applicable" },
      optanonConsent: { status: "invalid_missing" },
      wellKnown: null,
      gpp: null,
    })
  );
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("isSchemaRowNonCompliant – returns false for empty entries (parse error case)", () => {
  const result = parseSchemaClassificationCell("{not-json");
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("isSchemaRowNonCompliant – returns false for null input", () => {
  assert.equal(isSchemaRowNonCompliant(null), false);
  assert.equal(isSchemaRowNonCompliant(undefined), false);
  assert.equal(isSchemaRowNonCompliant({}), false);
});

test("isSchemaRowNonCompliant – returns false for schemaResult with non-array entries", () => {
  assert.equal(isSchemaRowNonCompliant({ entries: "not-array" }), false);
});

// ─── Round-trip: buildSchemaToken → parseSchemaToken ─────────────────────────

test("round-trip: buildSchemaToken and parseSchemaToken are inverses for top-level", () => {
  const entry = { family: "usps", status: "did_not_opt_out" };
  const token = buildSchemaToken(entry);
  assert.deepEqual(parseSchemaToken(token), entry);
});

test("round-trip: buildSchemaToken and parseSchemaToken are inverses for gpp", () => {
  const entry = {
    family: "gpp",
    state: "CO",
    field: "SharingOptOut",
    status: "not_applicable",
  };
  const token = buildSchemaToken(entry);
  assert.deepEqual(parseSchemaToken(token), entry);
});


// ─── Verbatim CSV cells from Crawl_Data_CA - Aug2025.csv ─────────────────────
// These strings are copied exactly as they appear in the CSV produced by
// generate_compliance_column.py, exercising the full parsing pipeline.

test("CSV cell – yelp.com: usps null, optanonConsent opted_out, wellKnown opted_out, gpp null", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"yelp.com","usps":null,"optanonConsent":{"status":"opted_out"},"wellKnown":{"status":"opted_out"},"gpp":null}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.equal(result.parsed.site, "yelp.com");
  assert.deepEqual(result.tokens, ["optanonConsent|opted_out", "wellKnown|opted_out"]);
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("CSV cell – fandom.com: usps + optanonConsent opted_out, wellKnown null, gpp null", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"fandom.com","usps":{"status":"opted_out"},"optanonConsent":{"status":"opted_out"},"wellKnown":null,"gpp":null}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["usps|opted_out", "optanonConsent|opted_out"]);
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("CSV cell – buzzfeed.com: usps+optanon opted_out, gpp CA SaleOptOut+SharingOptOut opted_out", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"buzzfeed.com","usps":{"status":"opted_out"},"optanonConsent":{"status":"opted_out"},"wellKnown":null,"gpp":{"classifications":[{"state":"CA","field":"SaleOptOut","status":"opted_out"},{"state":"CA","field":"SharingOptOut","status":"opted_out"}]}}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, [
    "usps|opted_out",
    "optanonConsent|opted_out",
    "gpp|CA|SaleOptOut|opted_out",
    "gpp|CA|SharingOptOut|opted_out",
  ]);
  assert.equal(isSchemaRowNonCompliant(result), false);
  assert.equal(result.labels["gpp|CA|SaleOptOut|opted_out"], "GPP: CA Sale Opt Out (Opted Out)");
});

test("CSV cell – urbandictionary.com: usps only, did_not_opt_out → non-compliant", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"urbandictionary.com","usps":{"status":"did_not_opt_out"},"optanonConsent":null,"wellKnown":null,"gpp":null}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["usps|did_not_opt_out"]);
  assert.equal(isSchemaRowNonCompliant(result), true);
});

test("CSV cell – thehill.com: usps+optanon both did_not_opt_out → non-compliant", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"thehill.com","usps":{"status":"did_not_opt_out"},"optanonConsent":{"status":"did_not_opt_out"},"wellKnown":null,"gpp":null}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["usps|did_not_opt_out", "optanonConsent|did_not_opt_out"]);
  assert.equal(isSchemaRowNonCompliant(result), true);
});

test("CSV cell – cheatsheet.com: usps opted_out, GPP US all 3 fields did_not_opt_out → non-compliant", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"cheatsheet.com","usps":{"status":"opted_out"},"optanonConsent":null,"wellKnown":null,"gpp":{"classifications":[{"state":"US","field":"SaleOptOut","status":"did_not_opt_out"},{"state":"US","field":"SharingOptOut","status":"did_not_opt_out"},{"state":"US","field":"TargetedAdvertisingOptOut","status":"did_not_opt_out"}]}}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.equal(isSchemaRowNonCompliant(result), true);
  assert.deepEqual(result.tokens, [
    "usps|opted_out",
    "gpp|US|SaleOptOut|did_not_opt_out",
    "gpp|US|SharingOptOut|did_not_opt_out",
    "gpp|US|TargetedAdvertisingOptOut|did_not_opt_out",
  ]);
});

test("CSV cell – realtor.com: all sections null → no tokens, not non-compliant", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"realtor.com","usps":null,"optanonConsent":null,"wellKnown":null,"gpp":null}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, []);
  assert.equal(isSchemaRowNonCompliant(result), false);
});

test("CSV cell – $schema extra key is silently ignored", () => {
  const cell =
    '{"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"espn.com","usps":{"status":"opted_out"},"optanonConsent":{"status":"opted_out"},"wellKnown":null,"gpp":null}';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["usps|opted_out", "optanonConsent|opted_out"]);
});

test("CSV cell – whitespace-padded cell still parses cleanly", () => {
  const cell =
    '  {"$schema":"./compliance_classification_schema.json","schemaVersion":"1.0.0","site":"whitepages.com","usps":null,"optanonConsent":{"status":"opted_out"},"wellKnown":null,"gpp":null}  ';
  const result = parseSchemaClassificationCell(cell);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["optanonConsent|opted_out"]);
  assert.equal(isSchemaRowNonCompliant(result), false);
});

// ─── Official example JSON fixture files ──────────────────────────────────────
// Objects mirror the 4 .example.json files committed alongside the schema.

const FIXTURE_EXAMPLE = {
  $schema: "./compliance_classification_schema.json",
  schemaVersion: "1.0.0",
  site: "example.com",
  usps: { status: "opted_out" },
  optanonConsent: { status: "did_not_opt_out" },
  wellKnown: { status: "opted_out" },
  gpp: {
    classifications: [
      { state: "US", field: "SaleOptOut",                status: "opted_out"       },
      { state: "CA", field: "SaleOptOut",                status: "did_not_opt_out" },
      { state: "CA", field: "SharingOptOut",             status: "opted_out"       },
      { state: "CT", field: "TargetedAdvertisingOptOut", status: "invalid_missing" },
    ],
  },
};

const FIXTURE_FULLY_COMPLIANT = {
  $schema: "./compliance_classification_schema.json",
  schemaVersion: "1.0.0",
  site: "fully-compliant.com",
  usps: { status: "opted_out" },
  optanonConsent: { status: "opted_out" },
  wellKnown: { status: "opted_out" },
  gpp: {
    classifications: [
      { state: "US", field: "SaleOptOut",                status: "opted_out" },
      { state: "US", field: "SharingOptOut",             status: "opted_out" },
      { state: "CA", field: "SaleOptOut",                status: "opted_out" },
      { state: "CA", field: "SharingOptOut",             status: "opted_out" },
      { state: "CT", field: "SaleOptOut",                status: "opted_out" },
      { state: "CT", field: "TargetedAdvertisingOptOut", status: "opted_out" },
    ],
  },
};

const FIXTURE_GPP_EDGE_CASES = {
  $schema: "./compliance_classification_schema.json",
  schemaVersion: "1.0.0",
  site: "gpp-problems.com",
  usps: null,
  optanonConsent: { status: "invalid_missing" },
  wellKnown: null,
  gpp: {
    classifications: [
      { state: "US", field: "SaleOptOut",    status: "not_applicable"  },
      { state: "CA", field: "SaleOptOut",    status: "invalid_missing" },
      { state: "CA", field: "SharingOptOut", status: "did_not_opt_out" },
    ],
  },
};

const FIXTURE_USPS_WELLKNOWN_ONLY = {
  $schema: "./compliance_classification_schema.json",
  schemaVersion: "1.0.0",
  site: "usps-only-site.com",
  usps: { status: "did_not_opt_out" },
  optanonConsent: null,
  wellKnown: { status: "opted_out" },
  gpp: null,
};

test("fixture – compliance_classification_column.example.json: mixed compliance", () => {
  const result = parseSchemaClassificationCell(JSON.stringify(FIXTURE_EXAMPLE));
  assert.equal(result.parseError, null);
  assert.equal(isSchemaRowNonCompliant(result), true);
  assert.deepEqual(result.tokens, [
    "usps|opted_out",
    "optanonConsent|did_not_opt_out",
    "wellKnown|opted_out",
    "gpp|US|SaleOptOut|opted_out",
    "gpp|CA|SaleOptOut|did_not_opt_out",
    "gpp|CA|SharingOptOut|opted_out",
    "gpp|CT|TargetedAdvertisingOptOut|invalid_missing",
  ]);
  assert.equal(
    result.labels["gpp|CT|TargetedAdvertisingOptOut|invalid_missing"],
    "GPP: CT Targeted Advertising Opt Out (Invalid or Missing)"
  );
  assert.match(
    result.descriptions["gpp|CT|TargetedAdvertisingOptOut|invalid_missing"],
    /CT Targeted Advertising Opt Out/
  );
});

test("fixture – compliance_classification_column.fully_compliant.example.json: all opted_out", () => {
  const result = parseSchemaClassificationCell(JSON.stringify(FIXTURE_FULLY_COMPLIANT));
  assert.equal(result.parseError, null);
  assert.equal(isSchemaRowNonCompliant(result), false);
  // 3 top-level + 6 GPP = 9 tokens, all ending in |opted_out
  assert.equal(result.tokens.length, 9);
  assert.ok(result.tokens.every((t) => t.endsWith("|opted_out")));
  const gppTokens = result.tokens.filter((t) => t.startsWith("gpp|"));
  assert.ok(gppTokens[0].startsWith("gpp|US|"), "US should sort first");
});

test("fixture – compliance_classification_column.gpp_edge_cases.example.json: invalid_missing + did_not_opt_out", () => {
  const result = parseSchemaClassificationCell(JSON.stringify(FIXTURE_GPP_EDGE_CASES));
  assert.equal(result.parseError, null);
  assert.equal(isSchemaRowNonCompliant(result), true);
  assert.deepEqual(result.tokens, [
    "optanonConsent|invalid_missing",
    "gpp|US|SaleOptOut|not_applicable",
    "gpp|CA|SaleOptOut|invalid_missing",
    "gpp|CA|SharingOptOut|did_not_opt_out",
  ]);
  // Removing the did_not_opt_out entry should make it compliant
  const withoutDnoo = {
    ...FIXTURE_GPP_EDGE_CASES,
    gpp: {
      classifications: FIXTURE_GPP_EDGE_CASES.gpp.classifications.filter(
        (c) => c.status !== "did_not_opt_out"
      ),
    },
  };
  assert.equal(isSchemaRowNonCompliant(parseSchemaClassificationCell(JSON.stringify(withoutDnoo))), false);
});

test("fixture – compliance_classification_column.usps_wellknown_only.example.json: usps bad, wellKnown ok", () => {
  const result = parseSchemaClassificationCell(JSON.stringify(FIXTURE_USPS_WELLKNOWN_ONLY));
  assert.equal(result.parseError, null);
  assert.equal(isSchemaRowNonCompliant(result), true);
  assert.deepEqual(result.tokens, ["usps|did_not_opt_out", "wellKnown|opted_out"]);
  assert.equal(result.labels["usps|did_not_opt_out"], "USPS: Did Not Opt Out");
  assert.equal(result.labels["wellKnown|opted_out"], "Well-Known: Opted Out");
  assert.match(result.descriptions["usps|did_not_opt_out"], /USPS schema classification is "Did Not Opt Out"/);
});

// ─── Complex / stress scenarios ───────────────────────────────────────────────

test("complex – large GPP array: US + CA,CO,CT,VA × all 3 fields, all opted_out", () => {
  const states = ["US", "CA", "CO", "CT", "VA"];
  const fields = ["SaleOptOut", "SharingOptOut", "TargetedAdvertisingOptOut"];
  const classifications = [];
  for (const state of states) {
    for (const field of fields) {
      classifications.push({ state, field, status: "opted_out" });
    }
  }
  const result = parseSchemaClassificationCell(JSON.stringify({ gpp: { classifications } }));
  assert.equal(result.parseError, null);
  assert.equal(result.tokens.length, 15); // 5 × 3
  assert.equal(isSchemaRowNonCompliant(result), false);
  assert.ok(result.tokens[0].startsWith("gpp|US|"), "US should sort first");
  const nonUS = result.tokens.filter((t) => !t.startsWith("gpp|US|"));
  const statesInOrder = nonUS.map((t) => t.split("|")[1]);
  assert.deepEqual(statesInOrder, [...statesInOrder].sort());
});

test("complex – single did_not_opt_out among many opted_out GPP entries is enough for non-compliant", () => {
  const result = parseSchemaClassificationCell(
    JSON.stringify({
      usps: { status: "opted_out" },
      optanonConsent: { status: "opted_out" },
      gpp: {
        classifications: [
          { state: "US", field: "SaleOptOut",                status: "opted_out"       },
          { state: "CA", field: "SaleOptOut",                status: "opted_out"       },
          { state: "CA", field: "SharingOptOut",             status: "opted_out"       },
          { state: "CA", field: "TargetedAdvertisingOptOut", status: "opted_out"       },
          { state: "CO", field: "SaleOptOut",                status: "did_not_opt_out" }, // sole bad entry
          { state: "CT", field: "SaleOptOut",                status: "opted_out"       },
        ],
      },
    })
  );
  assert.equal(result.parseError, null);
  assert.equal(isSchemaRowNonCompliant(result), true);
  assert.ok(result.tokens.includes("gpp|CO|SaleOptOut|did_not_opt_out"));
});

test("complex – multiple families partially invalid, valid entries still collected", () => {
  const payload = JSON.stringify({
    usps: { status: "unknown_status" },       // bad → error, no usps token
    optanonConsent: { status: "opted_out" },  // fine
    wellKnown: { status: "invalid" },         // fine (wellKnown-specific)
    gpp: {
      classifications: [
        { state: "CA", field: "SaleOptOut",  status: "opted_out" }, // fine
        { state: "CA", field: "NoSuchField", status: "opted_out" }, // bad field
      ],
    },
  });
  const result = parseSchemaClassificationCell(payload);
  assert.ok(result.parseError, "should have parse errors");
  assert.match(result.parseError, /unsupported status/);
  assert.match(result.parseError, /unsupported field/);
  assert.ok(result.tokens.includes("optanonConsent|opted_out"));
  assert.ok(result.tokens.includes("wellKnown|invalid"));
  assert.ok(result.tokens.includes("gpp|CA|SaleOptOut|opted_out"));
  assert.ok(!result.tokens.some((t) => t.startsWith("usps|")));
});

test("complex – full payload as pre-parsed JS object (not a string) is accepted", () => {
  // parseJsonLike passes non-strings through unchanged; if the result is a plain
  // object parseSchemaClassificationCell should classify it directly.
  const obj = {
    usps: { status: "opted_out" },
    optanonConsent: { status: "did_not_opt_out" },
    wellKnown: null,
    gpp: null,
  };
  const result = parseSchemaClassificationCell(obj);
  assert.equal(result.parseError, null);
  assert.deepEqual(result.tokens, ["usps|opted_out", "optanonConsent|did_not_opt_out"]);
  assert.equal(isSchemaRowNonCompliant(result), true);
});

