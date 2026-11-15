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

export interface TruthBinding {
  canonicalCandidateId: string;
  anonymizedCandidateId: string;
  headApplicationDigest: string;
  criteriaRevision: string;
  expectedCriterionInventory: string[];
  truthVersion: string;
  truthDigest: string;
  truthOutcomes: Record<string, boolean>;
}

export interface ArtifactRegistry {
  artifacts: Record<string, ArtifactEntry>;
}

export interface ArtifactEntry {
  artifactId: string;
  digest: string;
  candidateBinding: string;
  snapshotDigest: string;
  criterionId: string | null;
  allowedSource: boolean;
  current: boolean;
  applicable: boolean;
}

export interface ScorerInput {
  resultContract: import("./result-contract.ts").ResultContract;
  truthBinding: TruthBinding; // for joining truth AFTER output is fixed
  referenceRubrics: Record<string, RubricDecision>; // per reference id
  // Execution state binding — separates technical failure from semantic verdict.
  executionBinding?: "preserve-claim" | "no-verdict";
  // Mechanical reference resolver — resolves references against immutable artifact registry.
  artifactRegistry?: ArtifactRegistry;
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
  // Profile A finding scoring — structured output, no invented B-style verdicts.
  profileA: ProfileAOutput;
}

export interface ProfileAFindingOutput {
  findingId: string;
  nativeComment: string;
  normalizedFinding: string | null;
  skipped: boolean;
  skipReason: string | null;
  mappingStatus: "mapped" | "unmapped" | "out-of-scope" | "invalid";
  criterionMapping: string | null; // criterion ID if mapped, null otherwise
  referenceValidity: "valid" | "invalid" | "unknown";
  semanticSupport: "supported" | "unsupported" | "neutral";
  truthComparison: "matches" | "contradicts" | "neutral" | "n/a";
  diagnostics: string[];
}

export interface ProfileAOutput {
  deliveredCount: number;
  findings: ProfileAFindingOutput[];
  summary: {
    mapped: number;
    unmapped: number;
    outOfScope: number;
    skipped: number;
    overallStatus: "complete" | "partial" | "inconclusive";
  };
}

function executionBindingToAgrees(
  binding: "preserve-claim" | "no-verdict",
  claim: string | null,
): boolean | null {
  // "preserve-claim": keep the original claim visible; verdict suspended.
  // "no-verdict": no verdict, no claim preservation.
  if (binding === "no-verdict") return null;
  // binding === "preserve-claim":
  // If there is an actual parseable claim, label it as a reported-claim metric
  // (return null for the agreement verdict, but the claim itself is preserved).
  // If there is no claim (null/undefined), the verdict is also suspended.
  if (claim !== null && claim !== undefined) {
    // There is an original reported claim — preserve it, do not invent a verdict.
    return null;
  }
  // No parseable claim; verdict suspended.
  return null;
}

export function scoreResult(input: ScorerInput): ScorerResult {
  const rc = input.resultContract;
  const diagnostics: string[] = [];
  const referenceValidity: ReferenceValidity[] = [];
  const tb = input.truthBinding;

  // --- Truth binding validation ---
  // Ground Truth must only be joined after reviewer output is frozen and recorded.
  // Validate all Truth binding fields against the ResultContract.
  const truthBindingErrors: string[] = [];

  // 1. Match Truth candidate to ResultContract candidate.
  if (tb.canonicalCandidateId !== rc.candidate.repositoryMaterializationId) {
    truthBindingErrors.push(
      `truth candidate "${tb.canonicalCandidateId}" does not match result contract candidate "${rc.candidate.repositoryMaterializationId}"`,
    );
  }

  // 2. Match the approved anonymized identity.
  if (tb.anonymizedCandidateId !== rc.candidate.opaqueFixtureId) {
    truthBindingErrors.push(
      `truth anonymized candidate "${tb.anonymizedCandidateId}" does not match result contract opaqueFixtureId "${rc.candidate.opaqueFixtureId}"`,
    );
  }

  // 3. Match the head snapshot digest.
  if (tb.headApplicationDigest !== rc.candidate.runtimeSnapshotDigest) {
    truthBindingErrors.push(
      `truth head digest "${tb.headApplicationDigest}" does not match result contract snapshot "${rc.candidate.runtimeSnapshotDigest}"`,
    );
  }

  // 4. Match criteria revision.
  if (tb.criteriaRevision !== rc.criteria.authoredCriteriaRevision) {
    truthBindingErrors.push(
      `truth criteria revision "${tb.criteriaRevision}" does not match result contract criteria "${rc.criteria.authoredCriteriaRevision}"`,
    );
  }

  // 5. Validate exact criterion inventory and unique labels.
  const expectedSet = new Set(rc.criteria.expectedCriterionIds);
  if (tb.expectedCriterionInventory.length !== rc.criteria.expectedCriterionIds.length ||
      !tb.expectedCriterionInventory.every((id) => expectedSet.has(id))) {
    truthBindingErrors.push(
      `truth criterion inventory does not match result contract expected criteria`,
    );
  }

  // 6. Reject duplicate, missing or unknown Truth criteria.
  const truthOutcomeKeys = Object.keys(tb.truthOutcomes);
  const truthOutcomeSet = new Set(truthOutcomeKeys);
  if (truthOutcomeKeys.length !== truthOutcomeSet.size) {
    truthBindingErrors.push("truth outcomes contain duplicate criterion IDs");
  }
  for (const id of truthOutcomeKeys) {
    if (!expectedSet.has(id)) {
      truthBindingErrors.push(`truth outcome contains unknown criterion: ${id}`);
    }
  }
  for (const id of rc.criteria.expectedCriterionIds) {
    if (!truthOutcomeSet.has(id)) {
      truthBindingErrors.push(`truth outcome missing criterion: ${id}`);
    }
  }

  // Add all truth binding errors to diagnostics.
  for (const err of truthBindingErrors) {
    diagnostics.push(err);
  }

  const truthBindingValid = truthBindingErrors.length === 0;

  // --- Execution state check first ---
  const execState = rc.execution.state;
  const executionFailedOrUnknown = execState === "failed" || execState === "unknown";

  // Label agreement: only compute when execution did not fail/unknown.
  // When execution failed/unknown, we preserve the original claim as a reported-claim
  // metric rather than computing an admitted label-agreement verdict.
  const labelAgreement: LabelAgreement[] = rc.assessments.map((a) => {
    const truth = tb.truthOutcomes[a.expectedCriterionId];
    const admitted = a.admittedConclusion;

    if (!truthBindingValid) {
      // Truth binding is invalid — suspend the label-agreement verdict.
      // The original claim is retained for reported-claim accounting.
      const claim = a.originalReportedClaim;
      return {
        criterionId: a.expectedCriterionId,
        admittedConclusion: admitted,
        truthOutcome: truth ?? null,
        // Label as null when truth binding is invalid — the verdict is suspended,
        // not "incorrect". The original claim is retained for reported-claim accounting.
        agrees: executionBindingToAgrees(input.executionBinding || "preserve-claim", claim),
      };
    }

    if (executionFailedOrUnknown) {
      // For failed/unknown execution: preserve the original reported claim as a
      // separately identifiable observation; do NOT compute an invented admitted
      // semantic verdict. Record the execution state as a diagnostic.
      const claim = a.originalReportedClaim;
      return {
        criterionId: a.expectedCriterionId,
        admittedConclusion: admitted,
        truthOutcome: truth ?? null,
        // Label as null when execution failed/unknown — the verdict is suspended,
        // not "incorrect". The original claim is retained for reported-claim accounting.
        agrees: executionBindingToAgrees(input.executionBinding || "preserve-claim", claim),
      };
    }

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

  // --- Profile A finding scoring ---
  // Iterate over delivered FindingRecord entries. Preserve native comments,
  // normalized findings, skipped status and quality flags. Distinguish mapped,
  // unmapped and out-of-scope findings. Unmapped findings remain visible and
  // must not automatically be treated as false allegations. A delivered finding
  // mapped to a truth-satisfied criterion counts as a false allegation. A supported
  // finding mapped to a truth-violated criterion may count as supported detection.
  // A skipped finding must not be counted as a delivered finding; preserve its
  // reason and diagnostic. Profile A silence means no finding, not an inconclusive
  // B-style assessment. Profile A satisfaction and criterion coverage marked not
  // applicable.
  const profileAOutput: ProfileAOutput = computeProfileAOutput(rc, tb.truthOutcomes);
  const semanticSupport: SemanticSupport[] = [];
  for (const a of rc.assessments) {
    for (const ref of a.references) {
      // Mechanical validation: resolve against artifact registry if available.
      let mechExists = false;
      let mechTied = false;
      let mechValid = false;
      if (input.artifactRegistry) {
        const artifact = input.artifactRegistry.artifacts[ref];
        if (artifact) {
          mechExists = true;
          mechTied = artifact.candidateBinding === rc.candidate.repositoryMaterializationId &&
                     artifact.snapshotDigest === rc.candidate.runtimeSnapshotDigest;
          mechValid = mechExists && mechTied && artifact.allowedSource && artifact.current && artifact.applicable;
        }
      } else {
        // Fall back to rubric-provided booleans (legacy path).
        const rubric = input.referenceRubrics[ref];
        mechExists = rubric?.referenceExists ?? false;
        mechTied = rubric?.tiedToCandidate ?? false;
        mechValid = mechExists && mechTied;
      }
      const rubric = input.referenceRubrics[ref];
      referenceValidity.push({
        criterionId: a.expectedCriterionId,
        reference: ref,
        exists: mechExists,
        tiedToCandidate: mechTied,
        valid: mechValid,
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
    profileA: profileAOutput,
  };
}

function computeProfileAOutput(
  rc: import("./result-contract.ts").ResultContract,
  truthOutcomes: Record<string, boolean>,
): ProfileAOutput {
  const findings: ProfileAFindingOutput[] = [];
  let deliveredCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  let outOfScopeCount = 0;
  let skippedCount = 0;

  for (const f of rc.findings) {
    const skip = f.skipped;
    if (skip) {
      skippedCount++;
      findings.push({
        findingId: f.nativeComment || `finding-${findings.length}`,
        nativeComment: f.nativeComment,
        normalizedFinding: f.normalizedFinding,
        skipped: true,
        skipReason: f.skipReason,
        mappingStatus: "unmapped",
        criterionMapping: null,
        referenceValidity: "unknown",
        semanticSupport: "neutral",
        truthComparison: "n/a",
        diagnostics: f.skipReason !== null ? [`skipped: ${f.skipReason}`] : ["skipped"],
      });
      continue;
    }

    // Delivered (non-skipped) finding.
    deliveredCount++;
    const nativeComment = f.nativeComment || "unnamed finding";
    const normalized = f.normalizedFinding;
    const criterionMappingRaw = f.criterionMapping;

    // Determine mapping status.
    let mappingStatus: "mapped" | "unmapped" | "out-of-scope" = "unmapped";
    let criterionMapping: string | null = null;
    let referenceValidity: "valid" | "invalid" | "unknown" = "unknown";
    let semanticSupport: "supported" | "unsupported" | "neutral" = "unsupported";
    let truthComparison: "matches" | "contradicts" | "neutral" | "n/a" = "n/a";
    const findingDiagnostics: string[] = [];

    // Check if there's a criterion mapping.
    if (criterionMappingRaw !== null && criterionMappingRaw !== undefined) {
      // Check if the mapped criterion exists in truth outcomes.
      const mappedId = criterionMappingRaw;
      if (truthOutcomes.hasOwnProperty(mappedId)) {
        mappingStatus = "mapped";
        criterionMapping = mappedId;
        mappedCount++;

        // Truth comparison: if mapped to a truth-satisfied criterion, this is a
        // false allegation. If mapped to a truth-violated criterion, it may count
        // as supported detection.
        if (truthOutcomes[mappedId] === true) {
          // Finding mapped to truth-satisfied criterion → false allegation.
          truthComparison = "contradicts"; // or "matches" depending on the finding content
          referenceValidity = "valid";
          // The finding's claim opposes the truth → unsupported semantically.
          semanticSupport = "unsupported";
          findingDiagnostics.push(`mapped to truth-satisfied criterion ${mappedId} → false allegation`);
        } else {
          // Mapped to truth-violated criterion → may count as supported detection.
          truthComparison = "matches";
          referenceValidity = "valid";
          semanticSupport = "supported";
          findingDiagnostics.push(`mapped to truth-violated criterion ${mappedId} → supported detection`);
        }
      } else {
        // Mapped to a criterion not in truth outcomes → out-of-scope.
        mappingStatus = "out-of-scope";
        outOfScopeCount++;
        truthComparison = "neutral";
        referenceValidity = "invalid";
        semanticSupport = "neutral";
        findingDiagnostics.push(`mapped to criterion ${mappedId} not in truth outcomes → out-of-scope`);
      }
    } else {
      // No criterion mapping → unmapped.
      unmappedCount++;
      // Unmapped findings must remain visible and must not automatically be
      // treated as false allegations.
      truthComparison = "neutral";
      referenceValidity = "unknown";
      // Check if there are references that might give some semantic info.
      if (rc.assessments.length > 0 && rc.assessments[0].references.length > 0) {
        semanticSupport = "unsupported";
        truthComparison = "neutral";
        findingDiagnostics.push("unmapped finding with no criterion mapping");
      } else {
        semanticSupport = "neutral";
        truthComparison = "neutral";
        findingDiagnostics.push("unmapped finding with no criterion mapping or references");
      }
    }

    findings.push({
      findingId: nativeComment,
      nativeComment,
      normalizedFinding: normalized,
      skipped: false,
      skipReason: null,
      mappingStatus,
      criterionMapping,
      referenceValidity,
      semanticSupport,
      truthComparison,
      diagnostics: findingDiagnostics,
    });
  }

  // Profile A silence means no finding, not an inconclusive B-style assessment.
  // If there are no findings at all, delivery count is 0.
  const totalFound = findings.length;
  const overallStatus =
    totalFound > 0
      ? mappedCount > 0 || unmappedCount > 0
        ? "partial"
        : "inconclusive"
      : "complete"; // no findings = complete (nothing to report)

  return {
    deliveredCount,
    findings,
    summary: {
      mapped: mappedCount,
      unmapped: unmappedCount,
      outOfScope: outOfScopeCount,
      skipped: skippedCount,
      overallStatus,
    },
  };
}
