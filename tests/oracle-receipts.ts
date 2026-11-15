/**
 * Persisted oracle receipt tests (M2-A maintainer correction 3).
 *
 * Runs all eight expected passes, reads the JSON receipts back from disk, and
 * verifies that `assertions` and `auditDeltas` are non-empty plain JSON
 * structures. Also verifies deterministic canonical receipt JSON across fresh
 * processes.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runPass } from "../oracle/src/driver.ts";
import {
  canonicalReceiptJson,
  CRITERIA,
  runOracle,
  semanticDigest,
  toReceipt,
  type PassReceipt,
} from "../oracle/src/run.ts";
import { candidateSrcDir } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPTS_DIR = path.join(ROOT, ".oracle-receipts");

const EXPECTED: Record<string, Record<string, boolean>> = {
  "S1-C1": { "AC-1": true, "AC-2": true, "AC-3": true, "AC-4": true, "AC-5": true },
  "S1-C2": { "AC-1": true, "AC-2": true, "AC-3": true, "AC-4": true, "AC-5": true },
  "S1-C3": { "AC-1": true, "AC-2": true, "AC-3": false, "AC-4": true, "AC-5": true },
  "S1-C4": { "AC-1": true, "AC-2": true, "AC-3": true, "AC-4": false, "AC-5": true },
};

function readReceipt(file: string): PassReceipt {
  return JSON.parse(fs.readFileSync(file, "utf8")) as PassReceipt;
}

describe("persisted oracle receipts", () => {
  test("all eight passes persist non-empty assertions and audit deltas", async () => {
    const { summary, receipts } = await runOracle({ receiptsDir: RECEIPTS_DIR });

    assert.strictEqual(summary.requestMatrix.totalHttpRequests, 32);
    assert.strictEqual(summary.requestMatrix.totalAssertionGroupEvaluations, 40);
    assert.strictEqual(receipts.length, 8);
    assert.strictEqual(summary.receiptFiles.length, 8);

    for (const receipt of receipts) {
      const file = path.join(RECEIPTS_DIR, `${receipt.candidateId}-pass${receipt.pass}.json`);
      assert.ok(fs.existsSync(file), `missing persisted receipt ${file}`);
      const persisted = readReceipt(file);

      // The persisted artifact is the actual consumed receipt.
      assert.deepStrictEqual(persisted, receipt, `${receipt.candidateId} pass${receipt.pass}: disk readback`);

      // assertions must be a populated plain object, never {}.
      assert.strictEqual(typeof persisted.assertions, "object");
      assert.ok(persisted.assertions !== null && !Array.isArray(persisted.assertions));
      assert.notStrictEqual(JSON.stringify(persisted.assertions), "{}");
      assert.deepStrictEqual(Object.keys(persisted.assertions).sort(), [...CRITERIA].sort());
      for (const criterionId of CRITERIA) {
        const assertion = persisted.assertions[criterionId];
        assert.strictEqual(assertion.criterionId, criterionId);
        assert.strictEqual(typeof assertion.passed, "boolean");
        assert.strictEqual(typeof assertion.detail, "string");
        assert.strictEqual(assertion.passed, EXPECTED[receipt.candidateId][criterionId]);
      }

      // auditDeltas must be a populated plain object with all four requests.
      assert.strictEqual(typeof persisted.auditDeltas, "object");
      assert.ok(persisted.auditDeltas !== null && !Array.isArray(persisted.auditDeltas));
      assert.notStrictEqual(JSON.stringify(persisted.auditDeltas), "{}");
      assert.deepStrictEqual(
        Object.keys(persisted.auditDeltas).sort(),
        ["P-active-a", "P-active-b", "P-missing", "P-revoked"]
      );
      const missing = persisted.auditDeltas["P-missing"];
      assert.ok(Array.isArray(missing));
      assert.strictEqual(missing.length, 1);
      assert.strictEqual(missing[0].event, "profile.access.denied");
      assert.strictEqual(missing[0].reason, "missing_credential");
      assert.strictEqual(missing[0].path, "/profile");
      assert.strictEqual(missing[0].tokenPresent, false);
      assert.ok(typeof missing[0].timestamp === "string" && missing[0].timestamp.length > 0);

      // Request observations are also persisted.
      assert.strictEqual(persisted.requests.length, 4);
      for (const request of persisted.requests) {
        assert.strictEqual(typeof request.requestId, "string");
        assert.strictEqual(typeof request.statusCode, "number");
      }

      assert.strictEqual(persisted.passed, Object.values(EXPECTED[receipt.candidateId]).every(Boolean));
      assert.strictEqual(typeof persisted.process.pid, "number");
      assert.strictEqual(typeof persisted.process.ppid, "number");
    }

    for (const verdict of summary.candidates) {
      assert.strictEqual(verdict.repeatable, true, `${verdict.candidateId} passes must agree`);
      assert.strictEqual(verdict.overallPassed, Object.values(EXPECTED[verdict.candidateId]).every(Boolean));
    }
  });

  test("repeated fresh-process runs produce deterministic canonical receipt JSON", async () => {
    const first = toReceipt(
      await runPass({ candidateId: "S1-C1", pass: 1, srcDir: candidateSrcDir("S1-C1") })
    );
    const second = toReceipt(
      await runPass({ candidateId: "S1-C1", pass: 2, srcDir: candidateSrcDir("S1-C1") })
    );

    assert.notStrictEqual(first.process.pid, second.process.pid, "each pass must use a fresh process");
    assert.strictEqual(semanticDigest(first), semanticDigest(second));
    assert.strictEqual(canonicalReceiptJson(first), canonicalReceiptJson(second));
    assert.notStrictEqual(
      JSON.stringify(first.execution),
      JSON.stringify(second.execution),
      "raw receipts retain volatile execution metadata"
    );

    // Canonical JSON round-trips through disk without losing structure.
    const file = path.join(RECEIPTS_DIR, "determinism-check.json");
    fs.writeFileSync(file, canonicalReceiptJson(first) + "\n", "utf8");
    const roundTrip = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual(roundTrip, JSON.parse(canonicalReceiptJson(second)));
  });
});
