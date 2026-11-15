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

export interface AssessmentBinding {
  assessmentId: string;
  criteriaRevision: string;
  candidateSnapshot: string;
  admitted: boolean;
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
