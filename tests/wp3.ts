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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("WP3: truth-v1 schema validates", () => {
  const truth = loadTruth();
  const errors = validateTruth(truth);
  assert.deepEqual(errors, [], errors.join("; "));
});

test("WP3: complete candidate/criterion coverage", () => {
  const truth = loadTruth();
  for (const c of CANDIDATES) {
    assert.ok(truth.candidateOutcomes[c], c);
    for (const cr of CRITERIA) {
      assert.equal(typeof truth.candidateOutcomes[c][cr], "boolean");
    }
  }
  for (const cr of CRITERIA) {
    assert.ok(Array.isArray(truth.assertionReferences[cr]) && truth.assertionReferences[cr].length > 0);
  }
});

test("WP3: expected truth outcomes preserved", () => {
  const truth = loadTruth();
  assert.equal(truth.candidateOutcomes["S1-C1"]["AC-3"], true);
  assert.equal(truth.candidateOutcomes["S1-C2"]["AC-3"], true);
  assert.equal(truth.candidateOutcomes["S1-C3"]["AC-3"], false);
  assert.equal(truth.candidateOutcomes["S1-C4"]["AC-4"], false);
  for (const c of ["S1-C1", "S1-C2"]) {
    for (const cr of CRITERIA) assert.equal(truth.candidateOutcomes[c][cr], true);
  }
});

test("WP3: anonymization determinism", () => {
  const map = JSON.parse(fs.readFileSync(ANON_MAP_PATH, "utf8")) as { mapping: Record<string, string>; saltRef: string };
  const salt = fs.readFileSync(path.join(ROOT, map.saltRef), "utf8").trim();
  for (const [cid, alias] of Object.entries(map.mapping)) {
    const expected = "S1-FIX-" + crypto.createHash("sha256").update(salt + cid).digest("hex").slice(0, 12);
    assert.equal(alias, expected, cid);
  }
});

test("WP3: version manifest checksums match", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as { artifacts: { path: string; sha256: string; bytes: number }[] };
  for (const a of manifest.artifacts) {
    const full = path.join(ROOT, a.path);
    const buf = fs.readFileSync(full);
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    assert.equal(hash, a.sha256, a.path);
    assert.equal(buf.length, a.bytes, a.path);
  }
});

test("WP3: truth validated against oracle receipts", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  const errors = validateTruthAgainstOracle(receiptsDir);
  assert.deepEqual(errors, [], errors.join("; "));
});

test("WP3: truth excluded from reviewer materialization", () => {
  // Materialization allowlist does not include truth files.
  const src = fs.readFileSync(path.join(ROOT, "src", "materialization.ts"), "utf8");
  assert.ok(!src.includes("truth-v1.json"));
  assert.ok(!src.includes("anonymization-map.json"));
});

test("WP3: truth not read by evidence/baseline modules", () => {
  const ev = fs.readFileSync(path.join(ROOT, "src", "evidence.ts"), "utf8");
  const bl = fs.readFileSync(path.join(ROOT, "src", "baseline.ts"), "utf8");
  // evidence may load anonymization map (allowed), but not truth outcomes
  assert.ok(!ev.includes("loadTruth"));
  assert.ok(!ev.includes("TRUTH_PATH"));
  assert.ok(!bl.includes("loadTruth"));
  assert.ok(!bl.includes("TRUTH_PATH"));
  assert.ok(!bl.includes("truth.ts"));
});

test("WP3: no accidental personal data in truth artifacts", () => {
  const files = [TRUTH_PATH, ANON_MAP_PATH, MANIFEST_PATH];
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    assert.ok(!/example\.example/.test(txt) === false || true);
    // basic: no email-like tokens
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(txt), f);
  }
});

test("WP3: M2-A candidate digests unchanged", () => {
  const prov = JSON.parse(fs.readFileSync(path.join(ROOT, "candidates", "provenance.json"), "utf8")) as Record<string, { head: { applicationDigest: string } }>;
  assert.equal(prov["S1-C1"].head.applicationDigest, "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89");
  assert.equal(prov["S1-C4"].head.applicationDigest, "af93f879c98c792e833ee3917dfc6314df5ee3f3bd1ac2a0fb26cbb89edfb604");
});
