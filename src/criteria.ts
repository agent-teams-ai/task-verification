/**
 * Criteria content binding (M2 corrective pass).
 *
 * A criteria *revision label* is an authored identity. It is not proof that the
 * criterion content is unchanged: the same label can be re-used after the text
 * of a criterion is edited. Assessments therefore bind to a digest over the
 * canonical captured criterion content (identifiers + complete text), while the
 * authored revision identity is retained separately for audit.
 *
 * Canonicalization reuses the repository's recursive canonical JSON serializer
 * (`src/canonical.ts`): object keys sorted at every level, array order
 * preserved, digest = SHA-256 over the canonical JSON form.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { canonicalDigest } from "./canonical.ts";

export const CRITERIA_SNAPSHOT_SCHEMA = "criteria-snapshot-v1";

export interface CapturedCriterion {
  id: string;
  text: string;
}

export interface CriteriaSnapshot {
  schema: string;
  /** Authored revision label. An identity, NOT a content fingerprint. */
  authoredRevision: string;
  /** Canonical criterion content, sorted by identifier. */
  criteria: CapturedCriterion[];
  /** SHA-256 over the canonical captured content. */
  contentDigest: string;
  /** Where this snapshot was captured from (audit only). */
  source: string;
}

export class CriteriaSnapshotError extends Error {
  readonly code = "invalid_criteria_snapshot";
  constructor(message: string) {
    super(message);
    this.name = "CriteriaSnapshotError";
  }
}

/**
 * Validate and sort criteria into canonical order (ascending identifier).
 * Duplicate identifiers, empty identifiers and empty text are rejected: a
 * digest over ambiguous content would not be a content fingerprint.
 */
export function canonicalCriteria(criteria: readonly CapturedCriterion[]): CapturedCriterion[] {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new CriteriaSnapshotError("criteria must be a non-empty array");
  }
  const seen = new Set<string>();
  const out: CapturedCriterion[] = [];
  for (const c of criteria) {
    if (c === null || typeof c !== "object") {
      throw new CriteriaSnapshotError("each criterion must be an object");
    }
    if (typeof c.id !== "string" || c.id.trim() === "") {
      throw new CriteriaSnapshotError("each criterion requires a non-empty id");
    }
    if (typeof c.text !== "string" || c.text.trim() === "") {
      throw new CriteriaSnapshotError(`criterion ${c.id} requires non-empty text`);
    }
    if (seen.has(c.id)) {
      throw new CriteriaSnapshotError(`duplicate criterion id: ${c.id}`);
    }
    seen.add(c.id);
    out.push({ id: c.id, text: c.text });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** SHA-256 over the canonical criterion identifiers and complete text. */
export function criteriaContentDigest(criteria: readonly CapturedCriterion[]): string {
  return canonicalDigest({
    schema: CRITERIA_SNAPSHOT_SCHEMA,
    criteria: canonicalCriteria(criteria),
  });
}

/**
 * Capture an expected criteria snapshot independently of any assessment under
 * evaluation. The returned digest is derived from content only.
 */
export function captureCriteriaSnapshot(params: {
  authoredRevision: string;
  criteria: readonly CapturedCriterion[];
  source: string;
}): CriteriaSnapshot {
  if (typeof params.authoredRevision !== "string" || params.authoredRevision.trim() === "") {
    throw new CriteriaSnapshotError("authoredRevision must be a non-empty string");
  }
  const criteria = canonicalCriteria(params.criteria);
  return {
    schema: CRITERIA_SNAPSHOT_SCHEMA,
    authoredRevision: params.authoredRevision,
    criteria,
    contentDigest: criteriaContentDigest(criteria),
    source: params.source,
  };
}

/** True when an assessment's submitted digest is the current content digest. */
export function criteriaContentMatches(submittedDigest: string, expected: CriteriaSnapshot): boolean {
  return typeof submittedDigest === "string" && submittedDigest === expected.contentDigest;
}

/**
 * Human-readable drift report between two captured snapshots. Used by the
 * stale-assessment regression to name exactly which criterion changed.
 */
export function describeCriteriaDrift(before: CriteriaSnapshot, after: CriteriaSnapshot): string[] {
  const drift: string[] = [];
  if (before.contentDigest === after.contentDigest) return drift;
  const beforeById = new Map(before.criteria.map((c) => [c.id, c.text]));
  const afterById = new Map(after.criteria.map((c) => [c.id, c.text]));
  for (const [id, text] of beforeById) {
    const now = afterById.get(id);
    if (now === undefined) drift.push(`${id}: removed`);
    else if (now !== text) drift.push(`${id}: text changed`);
  }
  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) drift.push(`${id}: added`);
  }
  if (drift.length === 0) drift.push("criteria order or extra semantic field changed");
  return drift;
}
