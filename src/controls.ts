/**
 * Deterministic consumer controls CT-1 through CT-3 (WP6).
 *
 * Model-free controls exercising criteria revision freshness, candidate/
 * snapshot binding, and removal/re-addition revision identity. Uses fixed
 * stubs only; no model calls.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

// --- CT-1: Criteria revision freshness ---

export interface CriteriaRevision {
  revisionId: string;
  textDigest: string;
  parentRevision: string | null;
}

export function createCriteriaRevision(text: string, parent: string | null): CriteriaRevision {
  const textDigest = crypto.createHash("sha256").update(text).digest("hex");
  const revisionId = `crit-${crypto.createHash("sha256").update(textDigest + (parent ?? "root")).digest("hex").slice(0, 8)}`;
  return { revisionId, textDigest, parentRevision: parent };
}

/**
 * A criteria removal/tombstone event in the append-only criteria history. It is
 * NOT a lifecycle event for an attempt; it records that a criterion revision was
 * removed and establishes the lineage a replacement revision must descend from.
 */
export interface CriteriaTombstone {
  eventId: string;
  criterionId: string;
  removedRevisionId: string;
  removedTextDigest: string;
  removedAt: string;
  lineageId: string;
}

export function createCriteriaTombstone(params: {
  criterionId: string;
  removedRevisionId: string;
  removedTextDigest: string;
  removedAt: string;
}): CriteriaTombstone {
  const { criterionId, removedRevisionId, removedTextDigest, removedAt } = params;
  const lineageId = `crit-lineage-${crypto
    .createHash("sha256")
    .update(`${criterionId}\u0000${removedRevisionId}\u0000${removedAt}`)
    .digest("hex")
    .slice(0, 12)}`;
  const eventId = `evt-${crypto.randomUUID()}`;
  return { eventId, criterionId, removedRevisionId, removedTextDigest, removedAt, lineageId };
}

/**
 * Create the replacement criterion revision from a real tombstone event. The
 * replacement descends from the tombstone lineage, so identical bytes cannot
 * resurrect the removed revision identity.
 */
export function createRevisionAfterTombstone(text: string, tombstone: CriteriaTombstone): CriteriaRevision {
  return createCriteriaRevision(text, tombstone.lineageId);
}

export interface AssessmentBinding {
  assessmentId: string;
  criteriaRevision: string;
  candidateSnapshot: string;
  /** Whether this assessment was admitted by its producer. False can never be overridden. */
  admitted: boolean;
  reportedCriterionIds?: string[];
  admittedCriterionIds?: string[];
  /** Mechanical reference validity, when the policy requires references. */
  referenceValidity?: boolean | null;
  /** Semantic reference sufficiency, when the policy requires support. */
  referenceSufficiency?: boolean | null;
}

export function isAssessmentCurrentForCriteria(
  assessment: AssessmentBinding,
  currentRevision: string,
): boolean {
  return assessment.criteriaRevision === currentRevision;
}

export function isAssessmentCurrentForCandidate(
  assessment: AssessmentBinding,
  currentSnapshot: string,
): boolean {
  return assessment.candidateSnapshot === currentSnapshot;
}

// CT-1: old assessment bound to v1 cannot become current for v2.
export function ct1Evaluate(
  v1Revision: CriteriaRevision,
  v2Revision: CriteriaRevision,
  oldAssessment: AssessmentBinding,
): { oldBoundToV1: boolean; oldCannotBeCurrentForV2: boolean; v2RequiresNewRevision: boolean } {
  return {
    oldBoundToV1: oldAssessment.criteriaRevision === v1Revision.revisionId,
    oldCannotBeCurrentForV2: !isAssessmentCurrentForCriteria(oldAssessment, v2Revision.revisionId),
    v2RequiresNewRevision: v2Revision.revisionId !== v1Revision.revisionId,
  };
}

// --- CT-2: Candidate/snapshot binding ---

export function ct2Evaluate(
  currentSnapshot: string,
  mismatchedEvidenceSnapshot: string,
  assessment: AssessmentBinding,
): { mismatchDetected: boolean; evidenceStale: boolean; cannotSatisfy: boolean } {
  const mismatchDetected = mismatchedEvidenceSnapshot !== currentSnapshot;
  const evidenceStale = !isAssessmentCurrentForCandidate(assessment, currentSnapshot);
  return {
    mismatchDetected,
    evidenceStale,
    cannotSatisfy: mismatchDetected || evidenceStale,
  };
}

// --- CT-3: Removal and re-addition revision identity ---

export function ct3Evaluate(
  v1Revision: CriteriaRevision,
  v3Revision: CriteriaRevision,
  cancelledAssessment: AssessmentBinding,
): { newRevisionCreated: boolean; identicalBytesNotResurrected: boolean; cancelledNeverCurrent: boolean } {
  return {
    newRevisionCreated: v3Revision.revisionId !== v1Revision.revisionId,
    identicalBytesNotResurrected: v3Revision.revisionId !== v1Revision.revisionId,
    cancelledNeverCurrent: !isAssessmentCurrentForCriteria(cancelledAssessment, v3Revision.revisionId),
  };
}

// --- Shared consumer admission function ---

export interface AdmissionDecision {
  admitted: boolean;
  reason: string;
  criteriaMatch: boolean;
  snapshotMatch: boolean;
  lifecycleValid: boolean;
  coverageComplete: boolean;
  evidenceApplicable: boolean;
  reportedIdsValid: boolean;
  admittedIdsValid: boolean;
  assessmentAdmitted: boolean;
  referencesValid: boolean;
  referencesSufficient: boolean;
}

export function consumerAdmit(
  assessment: AssessmentBinding,
  currentCriteriaRevision: CriteriaRevision,
  currentSnapshot: string,
  expectedCriterionIds: string[],
  evidenceApplicable: boolean,
  cancelledOrSuperseded: boolean,
  lifecycleValid: boolean = !cancelledOrSuperseded,
): AdmissionDecision {
  const criteriaMatch = assessment.criteriaRevision === currentCriteriaRevision.revisionId;
  const snapshotMatch = assessment.candidateSnapshot === currentSnapshot;
  const lcValid = lifecycleValid && !cancelledOrSuperseded;

  // A producer that did not admit the assessment can never be overridden here.
  const assessmentAdmitted = assessment.admitted === true;

  // Reference validity/sufficiency are only enforced when explicitly supplied;
  // null/undefined means the policy does not require them for this control.
  const referencesValid = assessment.referenceValidity !== false;
  const referencesSufficient = assessment.referenceSufficiency !== false;

  // Real coverage check: reported IDs must exactly match expected inventory.
  const reportedIds = assessment.reportedCriterionIds ?? [];
  const admittedIds = assessment.admittedCriterionIds ?? [];

  const reportedSet = new Set(reportedIds);
  const expectedSet = new Set(expectedCriterionIds);

  // Coverage is complete only if every expected ID is reported, no duplicates, no unknowns.
  const reportedHasAll = expectedCriterionIds.every((id) => reportedSet.has(id));
  const reportedNoDuplicates = reportedIds.length === reportedSet.size;
  const reportedNoUnknowns = reportedIds.every((id) => expectedSet.has(id));
  const coverageComplete = reportedHasAll && reportedNoDuplicates && reportedNoUnknowns && expectedCriterionIds.length > 0;

  // Admitted IDs must be a subset of reported IDs and match expected inventory.
  const admittedHasNoUnknowns = admittedIds.every((id) => expectedSet.has(id));
  const admittedSubsetOfReported = admittedIds.every((id) => reportedSet.has(id));
  const admittedIdsValid = admittedHasNoUnknowns && admittedSubsetOfReported;

  const evidenceApp = evidenceApplicable;

  const admitted =
    criteriaMatch &&
    snapshotMatch &&
    lcValid &&
    assessmentAdmitted &&
    coverageComplete &&
    evidenceApp &&
    admittedIdsValid &&
    referencesValid &&
    referencesSufficient;

  let reason = "admitted";
  if (!criteriaMatch) reason = "criteria revision mismatch";
  else if (!snapshotMatch) reason = "snapshot mismatch";
  else if (!lcValid) reason = "cancelled or superseded";
  else if (!assessmentAdmitted) reason = "assessment not admitted";
  else if (!coverageComplete) reason = "incomplete coverage";
  else if (!evidenceApp) reason = "evidence not applicable";
  else if (!admittedIdsValid) reason = "invalid admitted IDs";
  else if (!referencesValid) reason = "invalid reference";
  else if (!referencesSufficient) reason = "insufficient reference support";

  return {
    admitted,
    reason,
    criteriaMatch,
    snapshotMatch,
    lifecycleValid: lcValid,
    coverageComplete,
    evidenceApplicable: evidenceApp,
    reportedIdsValid: coverageComplete,
    admittedIdsValid,
    assessmentAdmitted,
    referencesValid,
    referencesSufficient,
  };
}
