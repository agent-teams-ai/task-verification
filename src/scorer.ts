/**
 * Independent offline scorer (WP5).
 *
 * Joins frozen Ground Truth ONLY after assessment output is fixed. Ground
 * Truth is never an input to the reviewer or deterministic baseline.
 *
 * Reports label agreement, reference validity, semantic support, coverage,
 * original polarity and execution state as SEPARATE dimensions — never
 * collapsed into a single score.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

export const SCORER_VERSION = "scorer-v1";
export const RUBRIC_VERSION = "rubric-v1";

// --- Rubric ---

export interface RubricDecision {
  referenceExists: boolean;
  tiedToCandidate: boolean;
  supportsBehavior: boolean;
  coversSubclauses: boolean;
  relevantCurrentApplicable: boolean;
  contradictsClaim: boolean;
}

export function evaluateRubric(params: {
  referenceExists: boolean;
  tiedToCandidate: boolean;
  supportsBehavior: boolean;
  coversSubclauses: boolean;
  relevantCurrentApplicable: boolean;
  contradictsClaim: boolean;
}): RubricDecision {
  return { ...params };
}

export function isReferenceSupporting(r: RubricDecision): boolean {
  return (
    r.referenceExists &&
    r.tiedToCandidate &&
    r.supportsBehavior &&
    r.coversSubclauses &&
    r.relevantCurrentApplicable &&
    !r.contradictsClaim
  );
}

// --- Scorer input/output ---

export interface ScorerInput {
  resultContract: import("./result-contract.ts").ResultContract;
  truthCandidateId: string; // for joining truth AFTER output is fixed
  truthOutcomes: Record<string, boolean>; // joined truth (post-hoc)
  referenceRubrics: Record<string, RubricDecision>; // per reference id
}

export interface LabelAgreement {
  criterionId: string;
  admittedConclusion: string | null;
  truthOutcome: boolean | null;
  agrees: boolean | null; // null if truth unavailable
}

export interface ReferenceValidity {
  criterionId: string;
  reference: string;
  exists: boolean;
  tiedToCandidate: boolean;
  valid: boolean;
}

export interface SemanticSupport {
  criterionId: string;
  reference: string;
  supporting: boolean;
}

export interface ScorerResult {
  scorerVersion: string;
  rubricVersion: string;
  candidateId: string;
  labelAgreement: LabelAgreement[];
  referenceValidity: ReferenceValidity[];
  semanticSupport: SemanticSupport[];
  coverage: import("./result-contract.ts").CoverageRecord;
  polarityPreserved: boolean;
  executionValid: boolean;
  diagnostics: string[];
}

export function scoreResult(input: ScorerInput): ScorerResult {
  const rc = input.resultContract;
  const diagnostics: string[] = [];

  // Label agreement: join truth (post-hoc).
  const labelAgreement: LabelAgreement[] = rc.assessments.map((a) => {
    const truth = input.truthOutcomes[a.expectedCriterionId];
    const admitted = a.admittedConclusion;
    // Agreement: admitted satisfied ↔ truth true; admitted violated ↔ truth false.
    let agrees: boolean | null = null;
    if (truth !== undefined && admitted !== null) {
      if (admitted === "satisfied") agrees = truth === true;
      else if (admitted === "violated") agrees = truth === false;
      else agrees = null; // inconclusive
    }
    return {
      criterionId: a.expectedCriterionId,
      admittedConclusion: admitted,
      truthOutcome: truth ?? null,
      agrees,
    };
  });

  // Reference validity.
  const referenceValidity: ReferenceValidity[] = [];
  const semanticSupport: SemanticSupport[] = [];
  for (const a of rc.assessments) {
    for (const ref of a.references) {
      const rubric = input.referenceRubrics[ref];
      const exists = rubric?.referenceExists ?? false;
      const tied = rubric?.tiedToCandidate ?? false;
      referenceValidity.push({
        criterionId: a.expectedCriterionId,
        reference: ref,
        exists,
        tiedToCandidate: tied,
        valid: exists && tied,
      });
      semanticSupport.push({
        criterionId: a.expectedCriterionId,
        reference: ref,
        supporting: rubric ? isReferenceSupporting(rubric) : false,
      });
    }
    // Empty references → unsupported.
    if (a.references.length === 0 && a.admittedConclusion !== null) {
      diagnostics.push(`${a.expectedCriterionId}: no references, unsupported`);
    }
  }

  // Polarity preserved: original reported claim must not be overwritten.
  const polarityPreserved = rc.assessments.every(
    (a) => a.originalReportedClaim === null || typeof a.originalReportedClaim === "string",
  );

  // Execution valid.
  const executionValid = rc.execution.state === "completed" || rc.execution.state === "partial";

  // Coverage diagnostics.
  if (rc.coverage.missingIds.length > 0) {
    diagnostics.push(`missing IDs: ${rc.coverage.missingIds.join(", ")}`);
  }
  if (rc.coverage.duplicateIds.length > 0) {
    diagnostics.push(`duplicate IDs: ${rc.coverage.duplicateIds.join(", ")}`);
  }
  if (rc.coverage.unknownIds.length > 0) {
    diagnostics.push(`unknown IDs: ${rc.coverage.unknownIds.join(", ")}`);
  }
  if (rc.coverage.invalidIds.length > 0) {
    diagnostics.push(`invalid IDs: ${rc.coverage.invalidIds.join(", ")}`);
  }

  // Profile B with complete inventory but >= 80% inconclusive → flagged.
  const totalAssessments = rc.assessments.length;
  const inconclusiveCount = rc.assessments.filter((a) => a.admittedConclusion === "inconclusive").length;
  if (totalAssessments > 0 && rc.coverage.wholeInventoryAdmitted && inconclusiveCount / totalAssessments >= 0.8) {
    diagnostics.push("profile B yields few usable assessments (>=80% inconclusive)");
  }

  // Failed/unknown execution must not acquire invented semantic verdict.
  if (rc.execution.state === "failed" || rc.execution.state === "unknown") {
    for (const a of rc.assessments) {
      if (a.admittedConclusion !== null) {
        diagnostics.push(`${a.expectedCriterionId}: execution ${rc.execution.state} but has admitted conclusion`);
      }
    }
  }

  return {
    scorerVersion: SCORER_VERSION,
    rubricVersion: RUBRIC_VERSION,
    candidateId: rc.candidate.repositoryMaterializationId,
    labelAgreement,
    referenceValidity,
    semanticSupport,
    coverage: rc.coverage,
    polarityPreserved,
    executionValid,
    diagnostics,
  };
}
