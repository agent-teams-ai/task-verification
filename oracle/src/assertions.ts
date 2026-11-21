/**
 * Oracle O-1 criterion assertions (WP2).
 *
 * Pure behavioral checks over actual HTTP responses and audit deltas. The
 * oracle observes behavior; it does not inspect source code patterns.
 *
 * Five assertion groups per candidate per pass:
 *   AC-1 (P-active-a/b), AC-2 (P-missing), AC-3 (P-revoked),
 *   AC-4 (field scan of all four responses), AC-5 (P-missing audit delta).
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { REQUEST_FIXTURES } from "./manifest.ts";

/** Expected caller/email for each active request fixture, keyed by request ID. */
export const REQUEST_FIXTURE_BY_ID: Record<string, { expectedCallerId?: string; expectedEmail?: string }> = Object.fromEntries(
  REQUEST_FIXTURES.map((fx) => [fx.id, { expectedCallerId: fx.expectedCallerId, expectedEmail: fx.expectedEmail }])
);

export interface RequestResult {
  requestId: string;
  statusCode: number;
  body: unknown;
}

export interface AuditRecord {
  event: string;
  reason: string;
  path: string;
  tokenPresent: boolean;
  callerId?: string;
  timestamp: string;
}

export interface AssertionResult {
  criterionId: string;
  passed: boolean;
  detail: string;
}

/** The criterion IDs asserted by the oracle, in evaluation order. */
export const CRITERION_IDS = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;
export type CriterionId = (typeof CRITERION_IDS)[number];

/** Body contains none of the denied (sensitive) fields. AC-2 / AC-3 / AC-4. */
function hasNoDeniedFields(body: unknown): boolean {
  if (body === null || typeof body !== "object") {
    return true;
  }
  const obj = body as Record<string, unknown>;
  for (const field of ["role", "internal"]) {
    if (field in obj) {
      return false;
    }
  }
  return true;
}

/** Body has no profile fields at all (id, email, role, internal). */
function hasNoProfileFields(body: unknown): boolean {
  if (body === null || typeof body !== "object") {
    return true;
  }
  const obj = body as Record<string, unknown>;
  for (const field of ["id", "email", "role", "internal"]) {
    if (field in obj) {
      return false;
    }
  }
  return true;
}

/**
 * AC-1: P-active-a and P-active-b return 200 with the authenticated caller's
 * `id` and `email` equal to the expected values (not merely present).
 */
export function assertAC1(results: Map<string, RequestResult>): AssertionResult {
  const failures: string[] = [];
  for (const fx of ["P-active-a", "P-active-b"] as const) {
    const r = results.get(fx);
    if (!r) {
      failures.push(`${fx}: no response`);
      continue;
    }
    if (r.statusCode !== 200) {
      failures.push(`${fx}: expected 200, got ${r.statusCode}`);
      continue;
    }
    const body = r.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      failures.push(`${fx}: body is not an object`);
      continue;
    }
    const fxInfo = REQUEST_FIXTURE_BY_ID[fx];
    const expectedId = fxInfo.expectedCallerId;
    const expectedEmail = fxInfo.expectedEmail;
    if (body.id !== expectedId) {
      failures.push(`${fx}: expected id=${expectedId}, got ${JSON.stringify(body.id)}`);
    }
    if (body.email !== expectedEmail) {
      failures.push(`${fx}: expected email=${expectedEmail}, got ${JSON.stringify(body.email)}`);
    }
  }
  return {
    criterionId: "AC-1",
    passed: failures.length === 0,
    detail: failures.length === 0 ? "active callers return 200 with matching id and email" : failures.join("; "),
  };
}

/** AC-2: P-missing returns 401 and no profile fields. */
export function assertAC2(results: Map<string, RequestResult>): AssertionResult {
  const r = results.get("P-missing");
  if (!r) {
    return { criterionId: "AC-2", passed: false, detail: "P-missing: no response" };
  }
  if (r.statusCode !== 401) {
    return { criterionId: "AC-2", passed: false, detail: `expected 401, got ${r.statusCode}` };
  }
  if (!hasNoProfileFields(r.body)) {
    return { criterionId: "AC-2", passed: false, detail: "response body contains profile fields" };
  }
  return { criterionId: "AC-2", passed: true, detail: "missing credentials return 401 with no profile fields" };
}

/** AC-3: P-revoked returns 401 and no profile fields. */
export function assertAC3(results: Map<string, RequestResult>): AssertionResult {
  const r = results.get("P-revoked");
  if (!r) {
    return { criterionId: "AC-3", passed: false, detail: "P-revoked: no response" };
  }
  if (r.statusCode !== 401) {
    return { criterionId: "AC-3", passed: false, detail: `expected 401, got ${r.statusCode}` };
  }
  if (!hasNoProfileFields(r.body)) {
    return { criterionId: "AC-3", passed: false, detail: "response body contains profile fields" };
  }
  return { criterionId: "AC-3", passed: true, detail: "revoked token returns 401 with no profile fields" };
}

/** AC-4: no response body (all four) contains `role` or `internal`. */
export function assertAC4(results: Map<string, RequestResult>): AssertionResult {
  const failures: string[] = [];
  for (const [requestId, r] of results) {
    if (!hasNoDeniedFields(r.body)) {
      failures.push(`${requestId}: body contains denied field(s)`);
    }
  }
  return {
    criterionId: "AC-4",
    passed: failures.length === 0,
    detail: failures.length === 0 ? "no response body leaks role or internal" : failures.join("; "),
  };
}

/** AC-5: P-missing audit delta is exactly one denied/missing_credential record. */
export function assertAC5(auditDelta: AuditRecord[]): AssertionResult {
  if (auditDelta.length !== 1) {
    return {
      criterionId: "AC-5",
      passed: false,
      detail: `expected exactly 1 audit record for P-missing, got ${auditDelta.length}`,
    };
  }
  const rec = auditDelta[0];
  if (rec.event !== "profile.access.denied") {
    return {
      criterionId: "AC-5",
      passed: false,
      detail: `expected event profile.access.denied, got ${rec.event}`,
    };
  }
  if (rec.reason !== "missing_credential") {
    return {
      criterionId: "AC-5",
      passed: false,
      detail: `expected reason missing_credential, got ${rec.reason}`,
    };
  }
  return {
    criterionId: "AC-5",
    passed: true,
    detail: "P-missing writes exactly one profile.access.denied/missing_credential audit record",
  };
}

/** Evaluate all five assertion groups. Returns results keyed by criterion ID. */
export function evaluateAll(
  results: Map<string, RequestResult>,
  auditDelta: AuditRecord[],
): Map<string, AssertionResult> {
  const out = new Map<string, AssertionResult>();
  out.set("AC-1", assertAC1(results));
  out.set("AC-2", assertAC2(results));
  out.set("AC-3", assertAC3(results));
  out.set("AC-4", assertAC4(results));
  out.set("AC-5", assertAC5(auditDelta));
  return out;
}
