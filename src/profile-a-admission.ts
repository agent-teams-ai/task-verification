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
 * Findings are joined to scorer output by INTERNAL OCCURRENCE IDENTITY, never
 * by the external `findingId`. The external id may be absent, supplied by the
 * provider, or shared by several findings; joining on it transferred one
 * finding's scored conclusion (and therefore its support) to a different raw
 * finding. The occurrence identity is derived from the run, attempt, candidate,
 * snapshot and native input identity plus the finding's exact position in the
 * native output, so the join is one-to-one by construction. The external id is
 * preserved verbatim for diagnostics and reporting.
 *
 * Every mandatory gate is evaluated through the shared admission-gate policy in
 * `admission-gates.ts`, so a gate enforced for Profile B or for aggregate
 * admission cannot be silently omitted here.
 *
 * Truth is consulted for exactly one thing: whether an *admitted, semantically
 * supported* finding points at a criterion that is in fact violated. A finding
 * is never counted as a supported detection because Truth says a criterion is
 * violated; it must clear contract validity, execution admissibility, evidence
 * applicability, criteria revision/content binding, occurrence identity,
 * mechanical reference resolution, digest verification, binding, applicability
 * and semantic support first.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { FindingRecord, ResultContract } from "./result-contract.ts";
import {
  booleanGate,
  decide,
  evaluateRunGates,
  failGate,
  notApplicableGate,
  passGate,
  type AdmissionGateId,
  type GateResult,
} from "./admission-gates.ts";
import {
  findingOccurrenceIdentity,
  type ArtifactRegistry,
  type ProfileAFindingOutput,
  type ScorerResult,
} from "./scorer.ts";
import { referencePath } from "./artifact-registry.ts";

export interface ProfileAFindingAdmission {
  /** External display identity as delivered (never rewritten). */
  findingId: string;
  /** Internal occurrence identity used for the one-to-one scorer join. */
  occurrenceId: string;
  /** Position of this occurrence in the native output. */
  occurrenceIndex: number;
  /** The external findingId is shared by another occurrence. */
  findingIdAmbiguous: boolean;
  /** A scored record was found for exactly this occurrence. */
  occurrenceResolved: boolean;
  delivered: boolean;
  skipped: boolean;
  normalizationDropped: boolean;
  mappingStatus: "mapped" | "unmapped" | "out-of-scope" | "invalid";
  criterionId: string | null;
  /**
   * Another delivered finding maps to the same criterion. An ambiguous
   * duplicate mapping is never individually admitted; both findings are kept.
   */
  duplicateMapping: boolean;
  /**
   * The (criterion, reference) pair is shared with another finding and no
   * occurrence-scoped support decision exists, so support cannot be attributed
   * to this finding individually.
   */
  supportAmbiguous: boolean;
  /** Mapped to a criterion in the frozen expected inventory. */
  criteriaApplicable: boolean;
  references: string[];
  /** Every reference resolved to a byte-verified, allowlisted artifact. */
  referenceValid: boolean;
  /** Every reference is bound to the current candidate and snapshot. */
  candidateBound: boolean;
  snapshotBound: boolean;
  /** Scorer semantic-support dimension for this occurrence. */
  semanticSupported: boolean;
  /** The assessment was produced against the current criteria CONTENT. */
  criteriaContentBound: boolean;
  executionComplete: boolean;
  /** The review-execution decision this finding's admission depends on. */
  reviewAdmitted: boolean;
  /** Finding-level admission: every applicable run and finding gate passed. */
  admitted: boolean;
  /**
   * Admitted, inside an admitted review, mapped to a truth-violated criterion,
   * with supporting evidence. A rejected review never yields one.
   */
  supportedDetection: boolean;
  /** Structured outcome of every gate evaluated for this finding. */
  gates: GateResult[];
  primaryFailureGate: AdmissionGateId | null;
  reason: string;
}

export interface ProfileAAdmissionDecision {
  profile: "profile-a";
  /** Review execution admitted as completed, bound, applicable evidence. */
  admitted: boolean;
  reason: string;
  executionState: string;
  executionValid: boolean;
  contractValid: boolean;
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
  /** Every raw finding received exactly one decision from its own occurrence. */
  occurrencesOneToOne: boolean;
  deliveredFindings: number;
  admittedFindings: number;
  rejectedFindings: number;
  supportedDetections: string[];
  /** Occurrence identities of the supported detections. */
  supportedDetectionOccurrences: string[];
  /** Profile A never admits criterion-level verdicts. Always empty. */
  admittedCriterionIds: string[];
  findings: ProfileAFindingAdmission[];
  /** Structured outcome of every run-level and review-level gate. */
  gates: GateResult[];
  primaryFailureGate: AdmissionGateId | null;
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

/**
 * Derive Profile A admission from the real scorer output and the byte-verified
 * artifact registry. No caller-supplied admission booleans are accepted.
 */
export function admitProfileAFindings(input: ProfileAAdmissionInput): ProfileAAdmissionDecision {
  const { resultContract: rc, scorer, registry } = input;

  // --- Run-level gates (shared definitions, evaluated from observations) ---
  const runGates = evaluateRunGates({
    contractValid: scorer.contractValid,
    contractErrors: scorer.contractErrors,
    executionState: rc.execution.state,
    supersededBy: rc.execution.supersededBy ?? null,
    executionAdmissible: scorer.executionValid,
    evidenceApplicability: rc.evidence.applicability,
    authoredCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaRevision: input.expectedCriteriaRevision,
    criteriaTextDigest: rc.criteria.criteriaTextDigest,
    expectedCriteriaContentDigest: input.expectedCriteriaContentDigest,
    candidateMaterializationId: rc.candidate.repositoryMaterializationId,
    expectedCandidateBinding: input.expectedCandidateBinding,
    runtimeSnapshotDigest: rc.candidate.runtimeSnapshotDigest,
    expectedSnapshotDigest: input.expectedSnapshotDigest,
  });
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

  // --- Occurrence join: raw finding i <-> the scored record for occurrence i ---
  const scoredOccurrenceCounts = new Map<string, number>();
  for (const f of scorer.profileA.findings) {
    scoredOccurrenceCounts.set(f.occurrenceId, (scoredOccurrenceCounts.get(f.occurrenceId) ?? 0) + 1);
  }
  const scoredByOccurrence = new Map<string, ProfileAFindingOutput>();
  for (const f of scorer.profileA.findings) {
    if (!scoredByOccurrence.has(f.occurrenceId)) scoredByOccurrence.set(f.occurrenceId, f);
  }

  const decisions: ProfileAFindingAdmission[] = [];

  for (let i = 0; i < rc.findings.length; i++) {
    const raw: FindingRecord = rc.findings[i];
    const expectedOccurrence = findingOccurrenceIdentity(rc, i);
    const occurrenceId = expectedOccurrence.occurrenceId;
    const scored = scoredByOccurrence.get(occurrenceId);
    const occurrenceUnique = (scoredOccurrenceCounts.get(occurrenceId) ?? 0) === 1;
    const occurrenceResolved =
      scored !== undefined &&
      occurrenceUnique &&
      expectedOccurrence.provenanceComplete &&
      scored.occurrenceProvenanceComplete &&
      // The scored record must be the same occurrence, not merely a same-index
      // neighbourhood: its external id must be the raw record's delivery.
      scored.occurrenceIndex === i;

    const findingId = raw.findingId ?? `finding-${i}`;
    const output = scored;
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

    // `referenceValid` reports resolution of the artifact itself; candidate and
    // snapshot binding are separate gates (and are also part of the combined
    // `referenceValid` field reported to consumers below).

    const mappingStatus = (output?.mappingStatus ?? "invalid") as ProfileAFindingAdmission["mappingStatus"];
    const criterionId = output?.criterionMapping ?? raw.criterionMapping ?? null;
    const criteriaApplicable =
      mappingStatus === "mapped" && criterionId !== null && input.expectedCriterionIds.includes(criterionId);
    const semanticSupported = output?.semanticSupport === "supported";
    const supportAmbiguous = output?.supportAmbiguous === true;
    const duplicateMapping = output?.duplicateMapping === true;
    const findingIdAmbiguous = output?.findingIdAmbiguous === true;

    // --- Finding-level gates -------------------------------------------------
    const occurrenceGate = occurrenceResolved
      ? passGate(
          "occurrence-identity",
          "claim",
          "scorer.profileA.findings[].occurrenceId",
          `occurrence ${occurrenceId} at native position ${i} resolved exactly once`,
        )
      : failGate(
          "occurrence-identity",
          "claim",
          "scorer.profileA.findings[].occurrenceId",
          !expectedOccurrence.provenanceComplete
            ? `finding occurrence provenance is incomplete (${expectedOccurrence.missingProvenance.join(", ")})`
            : output === undefined
              ? "no scored record was produced for this finding occurrence"
              : !occurrenceUnique
                ? "duplicate occurrence identity in the scored output"
                : scored?.occurrenceProvenanceComplete === false
                  ? "the scored occurrence carries incomplete provenance"
                  : "the scored record does not belong to this occurrence",
        );

    const associationReason = duplicateMapping
      ? "duplicate/conflicting criterion mapping across findings"
      : !criteriaApplicable
        ? mappingStatus === "mapped"
          ? "criterion is outside the frozen inventory"
          : mappingStatus === "unmapped"
            ? "finding is not mapped to a criterion"
            : mappingStatus === "out-of-scope"
              ? "finding maps to a criterion outside the frozen inventory"
              : raw.skipped
                ? "finding was skipped by the normalizer"
                : "finding is not a delivered, mappable finding"
        : `finding maps to applicable criterion ${criterionId}`;
    const associationGate = booleanGate({
      id: "claim-association",
      scope: "claim",
      passed: criteriaApplicable && !duplicateMapping,
      source: "scorer.profileA.findings[].criterionMapping",
      passReason: associationReason,
      failReason: associationReason,
    });

    const candidateBindingGate =
      references.length === 0
        ? notApplicableGate(
            "candidate-binding",
            "claim",
            "artifact registry candidateBinding",
            "the finding cites no reference to bind",
          )
        : booleanGate({
            id: "candidate-binding",
            scope: "claim",
            passed: candidateBound,
            source: "artifact registry candidateBinding",
            passReason: "every cited artifact is bound to this candidate",
            failReason: "candidate binding mismatch",
          });
    const snapshotBindingGate =
      references.length === 0
        ? notApplicableGate(
            "snapshot-binding",
            "claim",
            "artifact registry snapshotDigest",
            "the finding cites no reference to bind",
          )
        : booleanGate({
            id: "snapshot-binding",
            scope: "claim",
            passed: snapshotBound,
            source: "artifact registry snapshotDigest",
            passReason: "every cited artifact is bound to this snapshot",
            failReason: "snapshot binding mismatch",
          });

    const referenceValidityGate =
      references.length === 0
        ? failGate(
            "reference-validity",
            "claim",
            "artifact registry",
            reasons.filter((r) => r.startsWith("reference")).join("; ") || "finding cites no artifact reference",
          )
        : referenceValid
          ? passGate(
              "reference-validity",
              "claim",
              "artifact registry",
              "every cited artifact is byte-verified, allowlisted, current and applicable",
            )
          : failGate(
              "reference-validity",
              "claim",
              "artifact registry",
              reasons.filter((r) => r.startsWith("reference")).join("; ") || "invalid reference",
            );

    const sufficiencyGate = supportAmbiguous
      ? failGate(
          "reference-sufficiency",
          "claim",
          "occurrence-scoped semantic support",
          "semantic support is ambiguous for this finding",
        )
      : semanticSupported
        ? passGate(
            "reference-sufficiency",
            "claim",
            "occurrence-scoped semantic support",
            "a cited artifact supports this occurrence's claim",
          )
        : failGate(
            "reference-sufficiency",
            "claim",
            "occurrence-scoped semantic support",
            "reference does not semantically support the finding",
          );

    const findingGates: GateResult[] = [
      occurrenceGate,
      associationGate,
      candidateBindingGate,
      snapshotBindingGate,
      referenceValidityGate,
      sufficiencyGate,
    ];
    const outcome = decide([...runGates, ...findingGates]);

    const supportedDetection =
      outcome.admitted &&
      scorer.truthBindingValid &&
      output?.truthComparison === "matches" &&
      criterionId !== null;

    decisions.push({
      findingId,
      occurrenceId,
      occurrenceIndex: i,
      findingIdAmbiguous,
      occurrenceResolved,
      delivered: output?.delivered === true,
      skipped: raw.skipped === true,
      normalizationDropped: output?.normalizationDropped === true,
      mappingStatus,
      criterionId,
      duplicateMapping,
      supportAmbiguous,
      criteriaApplicable,
      references,
      referenceValid: referenceValid && candidateBound && snapshotBound && references.length > 0,
      candidateBound: candidateBound && references.length > 0,
      snapshotBound: snapshotBound && references.length > 0,
      semanticSupported,
      criteriaContentBound,
      executionComplete,
      reviewAdmitted: false,
      admitted: outcome.admitted,
      supportedDetection,
      gates: outcome.gates,
      primaryFailureGate: outcome.primaryFailureGate,
      reason: outcome.reason,
    });
  }

  const occurrencesOneToOne =
    decisions.length === rc.findings.length &&
    new Set(decisions.map((d) => d.occurrenceId)).size === decisions.length &&
    decisions.every((d) => d.occurrenceResolved);

  // Result-level admission is about the REVIEW EXECUTION: a completed run whose
  // subject, criteria revision, snapshot and evidence are the current ones and
  // whose every reported finding is represented as an explicit decision.
  // Whether each finding counts is the finding-level decision below, so one
  // missing criterion never invalidates another independently valid finding.
  const reviewGates: GateResult[] = [
    ...runGates,
    booleanGate({
      id: "claim-association",
      scope: "aggregate",
      passed: inventoryMatches,
      source: "result-contract.criteria.expectedCriterionIds",
      passReason: "the expected criterion inventory matches the frozen inventory",
      failReason: "expected criterion inventory mismatch",
    }),
    booleanGate({
      id: "occurrence-identity",
      scope: "aggregate",
      passed: occurrencesOneToOne,
      source: "admitted finding decisions",
      passReason: "every raw finding resolved to exactly one of its own scored occurrences",
      failReason: "a raw finding did not resolve to exactly one scored occurrence",
    }),
  ];
  const reviewOutcome = decide(reviewGates, "review execution admitted");

  // The review decision is a precondition for consumable per-finding admission
  // and for any supported detection. A rejected review is never reported as a
  // current supported detection, even when a finding's own gates passed.
  const findings = decisions.map((d) => ({
    ...d,
    reviewAdmitted: reviewOutcome.admitted,
    admitted: d.admitted && reviewOutcome.admitted,
    supportedDetection: d.supportedDetection && reviewOutcome.admitted,
  }));
  const admittedAfterReview = findings.filter((d) => d.admitted).length;
  const deliveredAfterReview = findings.filter((d) => d.delivered).length;

  return {
    profile: "profile-a",
    admitted: reviewOutcome.admitted,
    reason: reviewOutcome.reason,
    executionState: scorer.executionState,
    executionValid: executionComplete,
    contractValid: scorer.contractValid,
    criteriaApplicable: criteriaApplicableAll(findings),
    criteriaRevisionBound,
    criteriaContentBound,
    candidateSnapshotBound,
    evidenceApplicable,
    occurrencesOneToOne,
    deliveredFindings: deliveredAfterReview,
    admittedFindings: admittedAfterReview,
    rejectedFindings: deliveredAfterReview - admittedAfterReview,
    supportedDetections: findings.filter((d) => d.supportedDetection).map((d) => d.findingId),
    supportedDetectionOccurrences: findings.filter((d) => d.supportedDetection).map((d) => d.occurrenceId),
    admittedCriterionIds: [],
    findings,
    gates: reviewOutcome.gates,
    primaryFailureGate: reviewOutcome.primaryFailureGate,
  };
}

/** True when every delivered finding maps to an applicable criterion. */
function criteriaApplicableAll(decisions: readonly ProfileAFindingAdmission[]): boolean {
  const delivered = decisions.filter((d) => d.delivered);
  return delivered.length > 0 && delivered.every((d) => d.criteriaApplicable);
}
