/**
 * HTTP-level fault-injection tests (M2-A P1).
 *
 * Exercises the actual Oracle fresh-process driver against test-only faulty
 * fixture variants (not the approved benchmark candidates). Each fault is
 * observed through a real test server, captured as HTTP response + audit delta,
 * and passed through the normal Oracle evaluation path. Demonstrates the
 * affected criterion fails while the unmodified fixture passes the same
 * assertion.
 *
 * Distinct from the assertion unit tests in tests/wp2.ts (which call
 * evaluateAll directly on synthetic objects).
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runPass } from "../oracle/src/driver.ts";
import { candidateSrcDir, faultSourceFiles } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FAULTS: { id: string; file: string; target: string }[] = [
  { id: "wrong-caller", file: "tests/faults/wrong-caller.ts", target: "AC-1" },
  { id: "denial-field-leak", file: "tests/faults/denial-field-leak.ts", target: "AC-4" },
  { id: "missing-audit", file: "tests/faults/missing-audit.ts", target: "AC-5" },
  { id: "duplicate-audit", file: "tests/faults/duplicate-audit.ts", target: "AC-5" },
];

describe("HTTP-level fault injection", () => {
  for (const f of FAULTS) {
    test(`${f.id}: affected criterion ${f.target} is rejected via the fresh-process driver`, async () => {
      const result = await runPass({
        candidateId: f.id,
        pass: 1,
        files: faultSourceFiles(path.join(ROOT, f.file)),
      });
      assert.strictEqual(result.assertions[f.target].passed, false, `${f.id}: ${f.target} should fail`);
    });
  }

  test("unmodified S1-C1 fixture passes all five criteria via the fresh-process driver", async () => {
    const result = await runPass({ candidateId: "S1-C1", pass: 1, srcDir: candidateSrcDir("S1-C1") });
    assert.strictEqual(result.passed, true);
    for (const [, a] of Object.entries(result.assertions)) {
      assert.strictEqual(a.passed, true);
    }
  });
});
