/**
 * Frozen deterministic baseline sufficiency policy (WP4).
 *
 * This policy is the sole authority for what evidence is required to satisfy
 * each criterion. It is versioned and has a canonical digest so evidence
 * packets can be bound to a specific policy revision. Individual evidence
 * packets must NOT override or redefine this policy.
 *
 * The policy maps each criterion (crit-v1) to the request observations that
 * are required and sufficient for that criterion under the M2-A oracle matrix:
 *   AC-1: P-active-a and P-active-b (HTTP 200 + matching caller id/email)
 *   AC-2: P-missing (HTTP 401, no profile fields)
 *   AC-3: P-revoked (HTTP 401, no profile fields)
 *   AC-4: all four responses scanned for `role`/`internal` keys
 *   AC-5: P-missing audit delta (exactly one missing_credential record)
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

/** Baseline policy identifier. */
export const BASELINE_POLICY_VERSION = "baseline-policy-v1";

/** Criterion IDs asserted by the oracle, in evaluation order. */
export const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;
export type CriterionId = (typeof CRITERIA)[number];

/** Request fixture IDs in the oracle matrix. */
export const REQUEST_IDS = ["P-active-a", "P-active-b", "P-missing", "P-revoked"] as const;
export type RequestId = (typeof REQUEST_IDS)[number];

/**
 * Frozen criterion-to-check applicability/sufficiency mapping.
 * Keyed by criterion ID, valued by the request IDs whose observations are
 * required and sufficient to evaluate that criterion.
 */
export const FROZEN_CRITERION_CHECKS: Record<CriterionId, RequestId[]> = {
  "AC-1": ["P-active-a", "P-active-b"],
  "AC-2": ["P-missing"],
  "AC-3": ["P-revoked"],
  "AC-4": ["P-active-a", "P-active-b", "P-missing", "P-revoked"],
  "AC-5": ["P-missing"],
} as const;

/**
 * Recursively sort object keys for stable serialization.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical digest of the frozen policy. Evidence packets must carry a
 * matching `checkDefinitionDigest`.
 */
export function checkDefinitionDigest(): string {
  return crypto.createHash("sha256").update(JSON.stringify(sortKeys(FROZEN_CRITERION_CHECKS))).digest("hex");
}

/** Human-readable policy identity stored in packets and baseline output. */
export const POLICY_ID = `baseline-policy-${BASELINE_POLICY_VERSION}`;

/** Observation status values. */
export type ObservationStatus = "pass" | "fail" | "unavailable";

/** Evidence applicability values. */
export type EvidenceApplicability = "applicable" | "inapplicable";

/** Evidence freshness values. */
export type EvidenceFreshness = "fresh" | "stale";
