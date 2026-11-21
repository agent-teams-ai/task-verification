/**
 * Reviewer input-isolation tests (M2-A P0).
 *
 * These tests exercise the ACTUAL materialization builder and Profile B
 * input builder outputs, not path-presence heuristics. They fail if a
 * candidate manifest, provenance file or reference-answer field is
 * accidentally added to reviewer-facing materialization or input.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildReviewerMaterialization,
  buildProfileBInput,
  FROZEN_CRITERIA,
  MATERIALIZATION_ROOT,
} from "../src/materialization.ts";

const TMP = MATERIALIZATION_ROOT;

function cleanup(p: string) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("reviewer input isolation (actual builder outputs)", () => {
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    test(`${candidateId}: materialized tree is exactly the allowlisted files`, () => {
      const out = path.join(TMP, candidateId, "mat");
      const res = buildReviewerMaterialization(candidateId, out);
      const actual = fs.readdirSync(out).sort();
      const expected = [...res.fileInventory].sort();
      assert.deepStrictEqual(actual, expected, `${candidateId} materialized tree mismatch`);
      // Exact file inventory matches.
      assert.deepStrictEqual(res.fileInventory, actual);
      // No manifest, provenance, oracle, or reference files.
      for (const f of actual) {
        assert.ok(!/MANIFEST|provenance|oracle|truth|salt|anonym/i.test(f), `${candidateId}: forbidden file ${f}`);
      }
      cleanup(out);
    });

    test(`${candidateId}: materialized application source has no candidate labels or answer annotations`, () => {
      const out = path.join(TMP, candidateId, "mat");
      buildReviewerMaterialization(candidateId, out);
      for (const f of fs.readdirSync(out)) {
        if (!f.endsWith(".ts")) continue;
        const content = fs.readFileSync(path.join(out, f), "utf8");
        assert.ok(!/S1-C[1-4]/.test(content), `${candidateId}/${f} contains candidate label`);
        assert.ok(!/expectedCriteria|expected criterion/i.test(content), `${candidateId}/${f} contains expected-criteria metadata`);
      }
      cleanup(out);
    });
  }

  test("Profile B serialized input contains only approved fields and complete criteria", () => {
    const input = buildProfileBInput("S1-C3");
    // Opaque id, not the candidate label.
    assert.ok(/^S1-FIX-[0-9a-f]{12}$/.test(input.opaqueCandidateId));
    // Criteria complete and verbatim.
    assert.deepStrictEqual(input.criteria.map((c) => c.id), ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"]);
    assert.strictEqual(input.criteria.length, FROZEN_CRITERIA.length);
    // Base/head identities present.
    assert.ok(input.baseIdentity.commit && input.baseIdentity.tree);
    assert.ok(input.headIdentity.commit && input.headIdentity.tree);
    // Complete diff present.
    assert.ok(input.baseToHeadDiff.includes("app.ts"));
    // Shared task metadata present.
    assert.ok(input.prTitle && input.prDescription);
    // Instruction to assess every expected ID.
    assert.ok(input.instruction.includes("AC-1..AC-5"));
    // No reference-answer fields anywhere in the serialized input.
    const serialized = JSON.stringify(input);
    for (const forbidden of ["expectedCriteria", "label", "provenance", "manifest", "S1-C3", "AC3: false", "AC-3: false", "violated", "correct inline", "expected criteria"]) {
      assert.ok(!serialized.includes(forbidden), `Profile B input leaked forbidden field/value: ${forbidden}`);
    }
  });

  test("Profile B headFiles are only the allowlisted application sources", () => {
    const input = buildProfileBInput("S1-C2");
    const paths = input.headFiles.map((f) => f.path).sort();
    assert.ok(paths.includes("app.ts"));
    assert.ok(paths.includes("authz.ts"));
    for (const f of paths) {
      assert.ok(["app.ts", "audit.ts", "behavior.ts", "types.ts", "authz.ts", "serializer.ts"].includes(f));
    }
  });

  test("reviewer-facing source contains no benchmark-answer hints", () => {
    const forbidden = [
      /S1-C[1-4]/,
      /unchanged helper/i,
      /delegate to this/i,
      /correct inline/i,
      /correct alternative/i,
      /behavioral violation/i,
      /omitted redaction/i,
      /revoked-token behavioral/i,
      /experimental scenario/i,
      /intended outcome/i,
    ];
    for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
      const out = path.join(TMP, candidateId, "hint-check");
      buildReviewerMaterialization(candidateId, out);
      for (const f of fs.readdirSync(out)) {
        if (!f.endsWith(".ts")) continue;
        const content = fs.readFileSync(path.join(out, f), "utf8");
        for (const rx of forbidden) {
          assert.ok(!rx.test(content), `${candidateId}/${f} contains forbidden hint ${rx}`);
        }
      }
      // cleanup
      try { fs.rmSync(path.join(TMP, candidateId, "hint-check"), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("materialization excludes parent checkout, sibling candidates, oracle source", () => {
    const out = path.join(TMP, "S1-C4", "mat");
    const res = buildReviewerMaterialization("S1-C4", out);
    // Inventory has no sibling/oracle/manifest/provenance files.
    for (const f of res.fileInventory) {
      assert.ok(!f.startsWith("S1-C"), `inventory contains sibling reference: ${f}`);
      assert.ok(!f.includes("oracle"), `inventory contains oracle: ${f}`);
      assert.ok(!f.includes("MANIFEST"), `inventory contains manifest: ${f}`);
      assert.ok(!f.includes("provenance"), `inventory contains provenance: ${f}`);
    }
    cleanup(out);
  });
});
