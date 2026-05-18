import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizePeriod, buildManifest } from "./dataset-manifest.js";

// ─── normalizePeriod ──────────────────────────────────────────────────────────

test("normalizePeriod – single-month abbreviation", () => {
  assert.deepEqual(normalizePeriod("Aug2025"), {
    key: "Aug2025",
    label: "August 2025",
    sortKey: "2025-08",
  });
});

test("normalizePeriod – Aug and August produce the same canonical key", () => {
  assert.equal(normalizePeriod("Aug2025").key, normalizePeriod("August2025").key);
});

test("normalizePeriod – Apr and April produce the same canonical key", () => {
  assert.equal(normalizePeriod("Apr2026").key, normalizePeriod("April2026").key);
});

test("normalizePeriod – multi-month FebMar2025", () => {
  assert.deepEqual(normalizePeriod("FebMar2025"), {
    key: "FebMar2025",
    label: "Feb-Mar 2025",
    sortKey: "2025-02",
  });
});

test("normalizePeriod – three-month AugSeptOct2025", () => {
  assert.deepEqual(normalizePeriod("AugSeptOct2025"), {
    key: "AugSeptOct2025",
    label: "Aug-Sept-Oct 2025",
    sortKey: "2025-08",
  });
});

test("normalizePeriod – Sep and Sept and September all collapse to Sept", () => {
  assert.equal(normalizePeriod("Sep2025").key, "Sept2025");
  assert.equal(normalizePeriod("Sept2025").key, "Sept2025");
  assert.equal(normalizePeriod("September2025").key, "Sept2025");
});

test("normalizePeriod – unknown token returns null", () => {
  assert.equal(normalizePeriod("Foo2025"), null);
  assert.equal(normalizePeriod("FooBar2025"), null);
});

test("normalizePeriod – missing year returns null", () => {
  assert.equal(normalizePeriod("Aug"), null);
});

test("normalizePeriod – year only returns null", () => {
  assert.equal(normalizePeriod("2025"), null);
});

// ─── buildManifest ────────────────────────────────────────────────────────────

function makeFixture(tree) {
  const root = mkdtempSync(join(tmpdir(), "dataset-manifest-"));
  for (const [state, files] of Object.entries(tree)) {
    const stateDir = join(root, state);
    mkdirSync(stateDir, { recursive: true });
    for (const file of files) writeFileSync(join(stateDir, file), "");
  }
  return root;
}

test("buildManifest – discovers states and periods, sorted chronologically", () => {
  const root = makeFixture({
    CA: [
      "Crawl_Data_CA - May2025.csv",
      "Crawl_Data_CA - Dec2023.csv",
      "Crawl_Data_CA - Jan2026.csv",
    ],
  });
  try {
    const m = buildManifest(root);
    assert.deepEqual(m.states, ["CA"]);
    assert.deepEqual(
      m.periodsByState.CA.map((p) => p.key),
      ["Dec2023", "May2025", "Jan2026"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildManifest – normalizes April2026 → Apr2026 and stores original filename", () => {
  const root = makeFixture({
    NJ: ["Crawl_Data_NJ - April2026.csv"],
  });
  try {
    const m = buildManifest(root);
    assert.equal(m.periodsByState.NJ[0].key, "Apr2026");
    assert.equal(m.periodsByState.NJ[0].file, "Crawl_Data_NJ - April2026.csv");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildManifest – throws on duplicate canonical key within a state", () => {
  const root = makeFixture({
    CA: ["Crawl_Data_CA - Aug2025.csv", "Crawl_Data_CA - August2025.csv"],
  });
  try {
    assert.throws(() => buildManifest(root), /Duplicate period "Aug2025" in CA/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildManifest – skips PotentiallyNonCompliantSites files", () => {
  const root = makeFixture({
    CA: [
      "Crawl_Data_CA - May2025.csv",
      "Crawl_Data_CA - PotentiallyNonCompliantSitesMay2025.csv",
    ],
  });
  try {
    const m = buildManifest(root);
    assert.equal(m.periodsByState.CA.length, 1);
    assert.equal(m.periodsByState.CA[0].key, "May2025");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildManifest – warns on unrecognized period token and skips it", () => {
  const root = makeFixture({
    CA: ["Crawl_Data_CA - May2025.csv", "Crawl_Data_CA - FooBar2025.csv"],
  });
  try {
    const m = buildManifest(root);
    assert.equal(m.periodsByState.CA.length, 1);
    assert.equal(m.warnings.length, 1);
    assert.match(m.warnings[0], /FooBar2025/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildManifest – ignores non-state directories and non-CSV files", () => {
  const root = makeFixture({
    CA: ["Crawl_Data_CA - May2025.csv", "README.md"],
    notes: ["Crawl_Data_XX - May2025.csv"],
  });
  try {
    const m = buildManifest(root);
    assert.deepEqual(m.states, ["CA"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
