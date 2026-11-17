/**
 * Profile A consumer admission (WP8).
 *
 * Profile A produces *findings*, not criterion verdicts, so shared consumer
 * admission cannot be expressed as "every expected criterion was reported".
 * Fabricating admitted criterion IDs to satisfy that check would invent a
 * verdict Profile A never produced.
 *
 * This module therefore represents Profile A admission at the level the
 * contract actually has:
 *
 *   - review-execution admission (was this a real, completed review whose
 *     subject, criteria revision, snapshot and evidence are the current ones?), and
 *   - finding-level admission (does each delivered finding resolve to a
 *     byte-verified current artifact on the *same* candidate snapshot, and is
 *     its criterion mapping applicable?).
 *
 * Truth is consulted for exactly one thing: whether an *admitted, semantically
 * supported* finding points at a criterion that is in fact violated. A finding
 * is never counted as a supported detection because Truth says a criterion is
 * violated; it must clear mechanical reference resolution, digest verification,
 * binding, applicability and semantic support first.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { FindingRecord, ResultContract } from "./result-contract.ts";
import type { ArtifactRegistry, ProfileAFindingOutput, ScorerResult } from "./scorer.ts";
import { referencePath } from "./artifact-registry.ts";

export interface ProfileAFindingAdmission {
  findingId: string;
  delivered: boolean;
  skipped: boolean;
  normalizationDropped: boolean;
  mappingStatus: "mapped" | "unmapped" | "out-of-scope" | "invalid";
  criterionId: string | null;
  /** Mapped to a criterion in the frozen expected inventory. */
  criteriaApplicable: boolean;
  references: string[];
  /** Every reference resolved to a byte-verified, allowlisted artifact. */
  referenceValid: boolean;
  /** Every reference is bound to the current candidate and snapshot. */
  candidateBound: boolean;
  snapshotBound: boolean;
  /** Scorer semantic-support dimension for this finding. */
  semanticSupported: boolean;
  /** The assessment was produced against the current criteria CONTENT. */
  criteriaContentBound: boolean;
  executionComplete: boolean;
  /** Finding-level admission. */
  admitted: boolean;
  /** Admitted, mapped to a truth-violated criterion, with supporting evidence. */
  supportedDetection: boolean;
  reason: string;
}

export interface ProfileAAdmissionDecision {
  profile: "profile-a";
  /** Review execution admitted as completed, bound, applicable evidence. */
  admitted: boolean;
  reason: string;
  executionState: string;
  executionValid: boolean;
  criteriaApplicable: boolean;
  criteriaRevisionBound: boolean;
  /**
   * The submitted `criteriaTextDigest` equals the independently captured
   * content digest of the current criteria. False means the criteria content
   * has changed since this assessment was produced (stale), even if the
   * authored revision label is unchanged.
   */
  criteriaContentBound: boolean;
  candidateSnapshotBound: boolean;
  evidenceApplicable: boolean;
  deliveredFindings: number;
  admittedFindings: number;
  rejectedFindings: number;
  supportedDetections: string[];
  /** Profile A never admits criterion-level verdicts. Always empty. */
  admittedCriterionIds: string[];
  findings: ProfileAFindingAdmission[];
}

export interface ProfileAAdmissionInput {
  resultContract: ResultContract;
  scorer: ScorerResult;
  /** Byte-verified registry (only entries that passed verification). */
  registry: ArtifactRegistry;
  allowedPaths: readonly string[];
  expectedCandidateBinding: string;
  expectedSnapshotDigest: string;
  expectedCriteriaRevision: string;
  /** Digest over the independently captured expected criterion content. */
  expectedCriteriaContentDigest: string;
  expectedCriterionIds: readonly string[];
}

function byId(findings: readonly ProfileAFindingOutput[]): Map<string, ProfileAFindingOutput> {
  const map = new Map<string, ProfileAFindingOutput>();
  findings.forEach((f, i) => map.set(f.findingId ?? `finding-${i}`, f));
  return map;
}

/**
 * Derive Profile A admission from the real scorer output and the byte-verified
 * artifact registry. No caller-supplied admission booleans are accepted.
 */
export function admitProfileAFindings(input: ProfileAAdmissionInput): ProfileAAdmissionDecision {
  const { resultContract: rc, scorer, registry } = input;
  const outputs = byId(scorer.profileA.findings);
  const executionComplete = scorer.executionValid;
  const evidenceApplicable = rc.evidence.applicability === "applicable";
  const criteriaRevisionBound = rc.criteria.authoredCriteriaRevision === input.expectedCriteriaRevision;
  const criteriaContentBound = rc.criteria.criteriaTextDigest === input.expectedCriteriaContentDigest;
  const candidateSnapshotBound =
    rc.candidate.repositoryMaterializationId === input.expectedCandidateBinding &&
    rc.candidate.runtimeSnapshotDigest === input.expectedSnapshotDigest;

  const inventoryMatches =
    rc.criteria.expectedCriterionIds.length === input.expectedCriterionIds.length &&
    input.expectedCriterionIds.every((id) => rc.criteria.expectedCriterionIds.includes(id));

  const decisions: ProfileAFindingAdmission[] = [];

  for (let i = 0; i < rc.findings.length; i++) {
    const raw: FindingRecord = rc.findings[i];
    const findingId = raw.findingId ?? `finding-${i}`;
    const output = outputs.get(findingId);
    const references = [...(raw.references ?? [])];

    let referenceValid = references.length > 0;
    let candidateBound = references.length > 0;
    let snapshotBound = references.length > 0;
    const reasons: string[] = [];

    for (const ref of references) {
      const entry = registry.artifacts[ref];
      const rel = referencePath(ref);
      if (!entry) {
        referenceValid = false;
        reasons.push(`reference ${ref} does not resolve to a registered artifact`);
        continue;
      }
      if (rel === null || !input.allowedPaths.includes(rel)) {
        referenceValid = false;
        reasons.push(`reference ${ref} is outside the application allowlist`);
        continue;
      }
      if (!entry.allowedSource || !entry.current || !entry.applicable) {
        referenceValid = false;
        reasons.push(`reference ${ref} is not an allowed, current, applicable artifact`);
      }
      if (entry.candidateBinding !== input.expectedCandidateBinding) {
        candidateBound = false;
        reasons.push(`reference ${ref} is bound to a different candidate`);
      }
      if (entry.snapshotDigest !== input.expectedSnapshotDigest) {
        snapshotBound = false;
        reasons.push(`reference ${ref} is bound to a different snapshot`);
      }
    }
    if (references.length === 0) {
      reasons.push("finding cites no artifact reference");
    }

    // A reference is only valid *for this contract* when it also resolves to the
    // same candidate and the same snapshot; binding is part of validity, not a
    // separate nice-to-have.
    referenceValid = referenceValid && candidateBound && snapshotBound && references.length > 0;

    const mappingStatus = (output?.mappingStatus ?? "invalid") as ProfileAFindingAdmission["mappingStatus"];
    const criterionId = output?.criterionMapping ?? raw.criterionMapping ?? null;
    const criteriaApplicable =
      mappingStatus === "mapped" && criterionId !== null && input.expectedCriterionIds.includes(criterionId);
    const semanticSupported = output?.semanticSupport === "supported";

    if (mappingStatus === "unmapped") reasons.push("finding is not mapped to a criterion");
    if (mappingStatus === "out-of-scope") reasons.push("finding maps to a criterion outside the frozen inventory");
    if (mappingStatus === "invalid" && raw.skipped) reasons.push("finding was skipped by the normalizer");
    if (mappingStatus === "invalid" && !raw.skipped) reasons.push("finding is not a delivered, mappable finding");

    const delivered = output?.delivered === true;
    // A finding is admitted when it is a delivered, applicable finding whose
    // cited artifact is byte-verified, current, on this candidate snapshot, and
    // semantically sufficient. Insufficient evidence never passes admission.
    const admitted =
      delivered &&
      executionComplete &&
      evidenceApplicable &&
      criteriaApplicable &&
      criteriaContentBound &&
      referenceValid &&
      candidateBound &&
      snapshotBound &&
      semanticSupported;

    // Profile A has no criterion-level verdicts, so Truth is consulted through
    // the scorer's finding-level comparison ("matches" = the mapped criterion is
    // in fact violated). Mechanisms must still all pass first.
    const supportedDetection =
      admitted &&
      criteriaContentBound &&
      semanticSupported &&
      criterionId !== null &&
      scorer.truthBindingValid &&
      output?.truthComparison === "matches";

    let reason: string;
    if (!delivered) reason = raw.skipped ? "skipped" : "not delivered";
    else if (!executionComplete) reason = "execution not admissible";
    else if (!evidenceApplicable) reason = "evidence not applicable";
    else if (!criteriaContentBound) reason = "criteria content is stale for this assessment";
    else if (!criteriaApplicable) reason = reasons[reasons.length - 1] ?? "criterion not applicable";
    else if (!candidateBound) reason = "candidate binding mismatch";
    else if (!snapshotBound) reason = "snapshot binding mismatch";
    else if (!referenceValid) reason = reasons.filter((r) => r.startsWith("reference")).join("; ");
    else if (!semanticSupported) reason = "reference does not semantically support the finding";
    else reason = "admitted with supporting evidence";

    decisions.push({
      findingId,
      delivered,
      skipped: raw.skipped === true,
      normalizationDropped: output?.normalizationDropped === true,
      mappingStatus,
      criterionId,
      criteriaApplicable,
      references,
      referenceValid: referenceValid && references.length > 0,
      candidateBound: candidateBound && references.length > 0,
      snapshotBound: snapshotBound && references.length > 0,
      semanticSupported,
      criteriaContentBound,
      executionComplete,
      admitted,
      supportedDetection,
      reason,
    });
  }

  const admittedFindings = decisions.filter((d) => d.admitted).length;
  const deliveredCount = decisions.filter((d) => d.delivered).length;

  // Result-level admission is about the REVIEW EXECUTION: a completed run whose
  // subject, criteria revision, snapshot and evidence are the current ones and
  // whose every reported finding is represented as an explicit decision.
  // Whether each finding counts is the finding-level decision below.
  const resultAdmitted =
    executionComplete &&
    evidenceApplicable &&
    criteriaRevisionBound &&
    criteriaContentBound &&
    candidateSnapshotBound &&
    inventoryMatches &&
    decisions.length === rc.findings.length;

  let reason: string;
  if (!executionComplete) reason = "execution not admissible";
  else if (!evidenceApplicable) reason = "evidence not applicable";
  else if (!criteriaRevisionBound) reason = "criteria revision mismatch";
  else if (!criteriaContentBound) reason = "criteria content mismatch (stale assessment)";
  else if (!candidateSnapshotBound) reason = "candidate/snapshot binding mismatch";
  else if (!inventoryMatches) reason = "expected criterion inventory mismatch";
  else reason = "review execution admitted";

  return {
    profile: "profile-a",
    admitted: resultAdmitted,
    reason,
    executionState: scorer.executionState,
    executionValid: executionComplete,
    criteriaApplicable: criteriaApplicableAll(decisions),
    criteriaRevisionBound,
    criteriaContentBound,
    candidateSnapshotBound,
    evidenceApplicable,
    deliveredFindings: deliveredCount,
    admittedFindings,
    rejectedFindings: deliveredCount - admittedFindings,
    supportedDetections: decisions.filter((d) => d.supportedDetection).map((d) => d.findingId),
    admittedCriterionIds: [],
    findings: decisions,
  };
}

/** True when every delivered finding maps to an applicable criterion. */
function criteriaApplicableAll(decisions: readonly ProfileAFindingAdmission[]): boolean {
  const delivered = decisions.filter((d) => d.delivered);
  return delivered.length > 0 && delivered.every((d) => d.criteriaApplicable);
}
