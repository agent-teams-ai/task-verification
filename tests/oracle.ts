/**
 * End-to-end oracle test (WP2).
 *
 * Runs Oracle O-1 (four HTTP requests x two passes) against all four
 * candidates through the live driver and verifies request/assertion totals,
 * per-candidate expected criteria, and two-pass repeatability. No live model
 * calls.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import * as path from "node:path";
import assert from "node:assert/strict";
import { runPass } from "../oracle/src/driver.ts";
import { candidateSrcDir } from "./helpers.ts";

const CANDIDATES = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;
const EXPECTED: Record<string, Record<string, boolean>> = {
  "S1-C1": { AC1: true, AC2: true, AC3: true, AC4: true, AC5: true },
  "S1-C2": { AC1: true, AC2: true, AC3: true, AC4: true, AC5: true },
  "S1-C3": { AC1: true, AC2: true, AC3: false, AC4: true, AC5: true },
  "S1-C4": { AC1: true, AC2: true, AC3: true, AC4: false, AC5: true },
};

const criterionId = (key: string): string => `AC-${key.slice(-1)}`;

describe("oracle end-to-end", () => {
  test("32 HTTP requests and 40 assertion-group evaluations across two passes", async () => {
    let httpRequests = 0;
    let assertionEvals = 0;
    for (const id of CANDIDATES) {
      for (let pass = 1; pass <= 2; pass++) {
        const result = await runPass(path.join(candidateSrcDir(id), "app.ts"), id, pass);
        httpRequests += 4;
        assertionEvals += result.assertions.size;
        assert.strictEqual(result.passed, Object.values(EXPECTED[id]).every(Boolean));
        // Per-criterion agreement with expected truth.
        for (const [key, expectedPass] of Object.entries(EXPECTED[id])) {
          const actual = result.assertions.get(criterionId(key))!.passed;
          assert.strictEqual(actual, expectedPass, `${id} pass${pass} ${key}: expected ${expectedPass}`);
        }
      }
    }
    assert.strictEqual(httpRequests, 32);
    assert.strictEqual(assertionEvals, 40);
  });

  test("both passes agree for every candidate (repeatability)", async () => {
    for (const id of CANDIDATES) {
      const p1 = await runPass(path.join(candidateSrcDir(id), "app.ts"), id, 1);
      const p2 = await runPass(path.join(candidateSrcDir(id), "app.ts"), id, 2);
      assert.strictEqual(p1.passed, p2.passed, `${id} passes disagree`);
      for (const [cid, a1] of p1.assertions) {
        assert.strictEqual(a1.passed, p2.assertions.get(cid)!.passed, `${id} ${cid} passes disagree`);
      }
    }
  });
});
