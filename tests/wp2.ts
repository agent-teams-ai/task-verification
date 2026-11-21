/**
 * WP2 behavioral oracle tests (model-free).
 *
 * Exercises the pure criterion assertions (AC-1..AC-5), the four fault
 * controls (wrong caller, denial-field leakage, missing audit entry,
 * duplicate audit entry) and criterion-to-assertion coverage. No live model
 * calls.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAll,
  type AssertionResult,
  type RequestResult,
  type AuditRecord,
} from "../oracle/src/assertions.ts";

function req(id: string, statusCode: number, body: unknown): RequestResult {
  return { requestId: id, statusCode, body };
}

const missingAudit: AuditRecord[] = [
  { event: "profile.access.denied", reason: "missing_credential", path: "/profile", tokenPresent: false, timestamp: "t" },
];

describe("WP2 oracle assertions", () => {
  test("AC-1: active callers return 200 with matching id and email", () => {
    const results = new Map([
      ["P-active-a", req("P-active-a", 200, { id: "caller-a", email: "caller-a@example.example" })],
      ["P-active-b", req("P-active-b", 200, { id: "caller-b", email: "caller-b@example.example" })],
    ]);
    const r = evaluateAll(results, []) as Map<string, AssertionResult>;
    assert.strictEqual(r.get("AC-1")!.passed, true);
  });

  test("AC-1 fails when a caller id does not match", () => {
    const results = new Map([
      ["P-active-a", req("P-active-a", 200, { id: "wrong-caller", email: "caller-a@example.example" })],
      ["P-active-b", req("P-active-b", 200, { id: "caller-b", email: "caller-b@example.example" })],
    ]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-1")!.passed, false);
  });

  test("AC-2: missing credentials return 401 with no profile fields", () => {
    const results = new Map([["P-missing", req("P-missing", 401, {})]]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-2")!.passed, true);
  });

  test("AC-2 fails when the denial body contains profile fields", () => {
    const results = new Map([["P-missing", req("P-missing", 401, { error: "x", role: "reviewer" })]]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-2")!.passed, false);
  });

  test("AC-3: revoked token returns 401 with no profile fields", () => {
    const results = new Map([["P-revoked", req("P-revoked", 401, {})]]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-3")!.passed, true);
  });

  test("AC-3 fails when a revoked token passes (200)", () => {
    const results = new Map([["P-revoked", req("P-revoked", 200, { id: "caller-revoked", email: "x@example.example" })]]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-3")!.passed, false);
  });

  test("AC-4: no response body leaks role or internal", () => {
    const results = new Map([
      ["P-active-a", req("P-active-a", 200, { id: "a", email: "a@example.example" })],
      ["P-active-b", req("P-active-b", 200, { id: "b", email: "b@example.example" })],
      ["P-missing", req("P-missing", 401, {})],
      ["P-revoked", req("P-revoked", 401, {})],
    ]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-4")!.passed, true);
  });

  test("AC-4 fails when any body contains role or internal", () => {
    const results = new Map([
      ["P-active-a", req("P-active-a", 200, { id: "a", email: "a@example.example", role: "reviewer" })],
      ["P-active-b", req("P-active-b", 200, { id: "b", email: "b@example.example" })],
      ["P-missing", req("P-missing", 401, {})],
      ["P-revoked", req("P-revoked", 401, {})],
    ]);
    const r = evaluateAll(results, []);
    assert.strictEqual(r.get("AC-4")!.passed, false);
  });

  test("AC-5: P-missing writes exactly one missing_credential audit record", () => {
    const results = new Map([["P-missing", req("P-missing", 401, {})]]);
    const r = evaluateAll(results, missingAudit);
    assert.strictEqual(r.get("AC-5")!.passed, true);
  });

  test("AC-5 fails on missing and duplicate audit entries", () => {
    const results = new Map([["P-missing", req("P-missing", 401, {})]]);
    assert.strictEqual(evaluateAll(results, []).get("AC-5")!.passed, false);
    const duplicate = [
      missingAudit[0],
      { ...missingAudit[0], timestamp: "t2" },
    ];
    assert.strictEqual(evaluateAll(results, duplicate).get("AC-5")!.passed, false);
  });

  test("criterion-to-assertion coverage: exactly AC-1..AC-5", () => {
    const results = new Map([
      ["P-active-a", req("P-active-a", 200, { id: "a", email: "a@example.example" })],
      ["P-active-b", req("P-active-b", 200, { id: "b", email: "b@example.example" })],
      ["P-missing", req("P-missing", 401, {})],
      ["P-revoked", req("P-revoked", 401, {})],
    ]);
    const r = evaluateAll(results, missingAudit);
    const ids = [...r.keys()].sort();
    assert.deepStrictEqual(ids, ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"]);
    for (const [, a] of r) {
      assert.ok(typeof a.passed === "boolean" && typeof a.detail === "string");
    }
  });

  test("fault controls: each injected defect is rejected on its target criterion", () => {
    const base = new Map([
      ["P-active-a", req("P-active-a", 200, { id: "caller-a", email: "caller-a@example.example" })],
      ["P-active-b", req("P-active-b", 200, { id: "caller-b", email: "caller-b@example.example" })],
      ["P-missing", req("P-missing", 401, {})],
      ["P-revoked", req("P-revoked", 401, {})],
    ]);
    // Unmodified passes all five.
    assert.ok([...evaluateAll(base, missingAudit).values()].every((a) => a.passed));

    // Wrong caller identity -> AC-1 rejected.
    const wrongCaller = new Map(base);
    wrongCaller.set("P-active-a", req("P-active-a", 200, { id: "wrong-caller", email: "caller-a@example.example" }));
    assert.strictEqual(evaluateAll(wrongCaller, missingAudit).get("AC-1")!.passed, false);

    // Denial-field leakage -> AC-4 rejected (P-missing body contains role).
    const denialLeak = new Map(base);
    denialLeak.set("P-missing", req("P-missing", 401, { error: "missing_credential", role: "reviewer" }));
    assert.strictEqual(evaluateAll(denialLeak, missingAudit).get("AC-4")!.passed, false);

    // Missing audit entry -> AC-5 rejected.
    assert.strictEqual(evaluateAll(base, []).get("AC-5")!.passed, false);

    // Duplicate audit entry -> AC-5 rejected.
    assert.strictEqual(evaluateAll(base, [...missingAudit, { ...missingAudit[0], timestamp: "t2" }]).get("AC-5")!.passed, false);
  });
});
