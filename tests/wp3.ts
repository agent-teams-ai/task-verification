import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runOracle } from "../oracle/src/run.ts";
import {
  loadTruth,
  validateTruth,
  validateTruthAgainstOracle,
  TRUTH_PATH,
  ANON_MAP_PATH,
  MANIFEST_PATH,
  CANDIDATES,
  CRITERIA,
} from "../src/truth.ts";
import { buildReviewerMaterialization } from "../src/materialization.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("WP3: truth-v1 schema validates", () => {
  const truth = loadTruth();
  const errors = validateTruth(truth);
  assert.deepEqual(errors, [], errors.join("; "));
});

test("WP3: complete candidate/criterion coverage", () => {
  const truth = loadTruth();
  for (const c of CANDIDATES) {
    assert.ok(truth.candidateOutcomes[c], `missing candidate ${c}`);
    for (const cr of CRITERIA) {
      assert.equal(typeof truth.candidateOutcomes[c][cr], "boolean", `${c}/${cr}`);
    }
  }
  for (const cr of CRITERIA) {
    assert.ok(
      Array.isArray(truth.assertionReferences[cr]) && truth.assertionReferences[cr].length > 0,
      `missing assertion refs ${cr}`,
    );
  }
});

test("WP3: expected truth outcomes preserved", () => {
  const truth = loadTruth();
  assert.equal(truth.candidateOutcomes["S1-C1"]["AC-3"], true);
  assert.equal(truth.candidateOutcomes["S1-C2"]["AC-3"], true);
  assert.equal(truth.candidateOutcomes["S1-C3"]["AC-3"], false);
  assert.equal(truth.candidateOutcomes["S1-C4"]["AC-4"], false);
  for (const c of ["S1-C1", "S1-C2"]) {
    for (const cr of CRITERIA) assert.equal(truth.candidateOutcomes[c][cr], true, `${c}/${cr}`);
  }
});

test("WP3: valid head-application digests for all four candidates", () => {
  const truth = loadTruth();
  const prov = JSON.parse(
    fs.readFileSync(path.join(ROOT, "candidates", "provenance.json"), "utf8"),
  ) as Record<string, { head: { applicationDigest: string } }>;
  for (const c of CANDIDATES) {
    assert.equal(
      truth.candidateHeadDigests[c],
      prov[c].head.applicationDigest,
      `head digest mismatch for ${c}`,
    );
  }
});

test("WP3: assertion references match frozen M2-A criterion mapping", () => {
  const truth = loadTruth();
  const expected: Record<string, string[]> = {
    "AC-1": ["P-active-a", "P-active-b"],
    "AC-2": ["P-missing"],
    "AC-3": ["P-revoked"],
    "AC-4": ["P-active-a", "P-active-b", "P-missing", "P-revoked"],
    "AC-5": ["P-missing"],
  };
  for (const cr of CRITERIA) {
    assert.deepEqual(truth.assertionReferences[cr], expected[cr], `${cr} assertion references`);
  }
});

test("WP3: non-empty scope and public-artifact policy", () => {
  const truth = loadTruth();
  assert.ok(typeof truth.scope === "string" && truth.scope.length > 0);
  assert.ok(typeof truth.publicArtifactPolicy === "string" && truth.publicArtifactPolicy.length > 0);
  assert.ok(truth.publicArtifactPolicy.includes("excluded from reviewer"));
});

test("WP3: anonymization determinism", () => {
  const map = JSON.parse(fs.readFileSync(ANON_MAP_PATH, "utf8")) as {
    mapping: Record<string, string>;
    saltRef: string;
  };
  const salt = fs.readFileSync(path.join(ROOT, map.saltRef), "utf8").trim();
  const expected: Record<string, string> = {};
  for (const c of CANDIDATES) {
    expected[c] =
      "S1-FIX-" + crypto.createHash("sha256").update(salt + c).digest("hex").slice(0, 12);
  }
  assert.deepEqual(map.mapping, expected);
  // All four candidates present, no extras.
  assert.deepEqual(Object.keys(map.mapping).sort(), CANDIDATES.slice().sort());
});

test("WP3: version manifest validates artifact inventory, bytes and checksums", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    artifacts: { path: string; sha256: string; bytes: number }[];
  };
  const paths = manifest.artifacts.map((a) => a.path);
  assert.ok(paths.includes("truth/truth-v1.json"));
  assert.ok(paths.includes("truth/anonymization-map.json"));
  assert.ok(paths.includes("truth/salt.txt"));
  // No duplicate artifact paths.
  assert.deepEqual([...new Set(paths)].length, paths.length);
  for (const a of manifest.artifacts) {
    const full = path.join(ROOT, a.path);
    assert.ok(fs.existsSync(full), `manifest artifact missing: ${a.path}`);
    const buf = fs.readFileSync(full);
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    assert.equal(hash, a.sha256, `checksum mismatch ${a.path}`);
    assert.equal(buf.length, a.bytes, `byte count mismatch ${a.path}`);
  }
});

test("WP3: truth labels cross-checked against actual Oracle receipts", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  const errors = validateTruthAgainstOracle(receiptsDir);
  assert.deepEqual(errors, [], errors.join("; "));
});

test("WP3: public synthetic artifacts contain no credentials or personal data", () => {
  const files = [TRUTH_PATH, ANON_MAP_PATH, MANIFEST_PATH];
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const secretRe = /(password|secret|token|key)\s*[:=]\s*\S+/i;
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    assert.ok(!emailRe.test(txt), `email found in ${f}`);
    assert.ok(!secretRe.test(txt), `secret-like value found in ${f}`);
  }
});

test("WP3: truth excluded from actual reviewer materialization", () => {
  for (const c of CANDIDATES) {
    const result = buildReviewerMaterialization(
      c,
      path.join(ROOT, ".materialization", `wp3-materialization-${c}`),
    );
    const inventory = result.fileInventory;
    assert.ok(
      !inventory.some((name) => name.includes("truth-v1") || name.includes("anonymization")),
      `${c} materialization must not contain truth artifacts`,
    );
    // Only allowlisted application files plus metadata files.
    const allowed = new Set([
      "app.ts",
      "audit.ts",
      "authz.ts",
      "behavior.ts",
      "serializer.ts",
      "types.ts",
      "base-head-identities.json",
      "base-to-head.diff",
      "criteria.json",
      "task-metadata.json",
    ]);
    for (const name of inventory) {
      assert.ok(allowed.has(name), `unexpected materialized file ${name} for ${c}`);
    }
    fs.rmSync(result.outDir, { recursive: true, force: true });
  }
});

test("WP3: other candidate artifacts absent from a materialization", () => {
  const result = buildReviewerMaterialization(
    "S1-C1",
    path.join(ROOT, ".materialization", "wp3-other-candidates"),
  );
  const dir = result.outDir;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const content = fs.readFileSync(path.join(dir, entry), "utf8");
    assert.ok(!content.includes("S1-C2"), "S1-C2 must not leak into S1-C1 materialization");
    assert.ok(!content.includes("S1-C3"), "S1-C3 must not leak into S1-C1 materialization");
    assert.ok(!content.includes("S1-C4"), "S1-C4 must not leak into S1-C1 materialization");
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("WP3: evidence and baseline modules do not read truth outcomes (static)", () => {
  const ev = fs.readFileSync(path.join(ROOT, "src", "evidence.ts"), "utf8");
  const bl = fs.readFileSync(path.join(ROOT, "src", "baseline.ts"), "utf8");
  assert.ok(!ev.includes("loadTruth"), "evidence.ts must not load truth");
  assert.ok(!ev.includes("TRUTH_PATH"), "evidence.ts must not reference TRUTH_PATH");
  assert.ok(!bl.includes("loadTruth"), "baseline.ts must not load truth");
  assert.ok(!bl.includes("TRUTH_PATH"), "baseline.ts must not reference TRUTH_PATH");
  assert.ok(!bl.includes("truth.ts"), "baseline.ts must not import truth.ts");
});
