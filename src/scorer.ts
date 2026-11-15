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

// --- Reported-claim accounting (WP5) ---
// Independent accounting of the ORIGINAL reported claim, kept separate from
// Evidence admission, mechanical reference validity, semantic support and the
// admitted semantic conclusion. Truth comparison is suspended when the Truth
// binding is invalid; it is never inferred from reference validity.

export type ParsedReportedClaim = "satisfied" | "violated" | "unknown";

export type ReportedClaimComparison =
  | "false-satisfaction"
  | "false-violation"
  | "agrees"
  | "unknown-claim"
  | "truth-suspended";

export interface ReportedClaimAccountingEntry {
  criterionId: string;
  originalReportedClaim: string | null;
  parsedClaim: ParsedReportedClaim;
  truthOutcome: boolean | null;
  comparison: ReportedClaimComparison;
  admittedConclusion: import("./result-contract.ts").AdmittedConclusion | null;
  referenceValid: boolean | null;
  executionState: import("./result-contract.ts").ExecutionState;
  /** True when the original claim is retained as a reported-claim observation. */
  accounted: boolean;
  /** True when an admissible semantic conclusion exists (execution valid + admitted). */
  admitted: boolean;
}

export interface ReportedClaimAccounting {
  attempted: number;
  completed: number;
  reportedSatisfied: number;
  reportedViolated: number;
  falseSatisfaction: number;
  falseViolation: number;
  correctReportedClaims: number;
  unparseableUnknownClaims: number;
  admittedSemanticConclusions: number;
  rejectedUnadmittedConclusions: number;
  truthComparisonSuspended: number;
  entries: ReportedClaimAccountingEntry[];
}

/**
 * Parse an original reported claim into a polarity without inventing one.
 * Accepts the canonical tokens and unambiguous prose; anything else is unknown.
 */
export function parseReportedClaim(claim: string | null | undefined): ParsedReportedClaim {
  if (claim === null || claim === undefined) return "unknown";
  const normalized = claim.trim().toLowerCase();
  if (normalized === "") return "unknown";
  if (normalized === "satisfied") return "satisfied";
  if (normalized === "violated") return "violated";
  const hasViolated = /\bviolated\b/.test(normalized);
  const hasSatisfied = /\bsatisfied\b/.test(normalized);
  if (hasViolated && !hasSatisfied) return "violated";
  if (hasSatisfied && !hasViolated) return "satisfied";
  return "unknown";
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
  // Independent original reported-claim accounting (WP5).
  reportedClaims: ReportedClaimAccounting;
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
  const profileAOutput: ProfileAOutput = computeProfileAOutput(
    rc,
    tb.truthOutcomes,
    input.artifactRegistry,
    input.referenceRubrics,
    truthBindingValid,
  );
  const reportedClaims = computeReportedClaimAccounting(
    rc,
    tb.truthOutcomes,
    truthBindingValid,
    input.artifactRegistry,
  );
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
    reportedClaims,
  };
}

interface ResolvedFindingReference {
  reference: string;
  exists: boolean;
  tiedToCandidate: boolean;
  mechanicallyValid: boolean;
  supportsBehavior: boolean;
  reason: string;
}

function resolveFindingReferences(
  refs: string[] | undefined,
  rc: import("./result-contract.ts").ResultContract,
  registry: ArtifactRegistry | undefined,
  rubrics: Record<string, RubricDecision>,
): ResolvedFindingReference[] {
  const out: ResolvedFindingReference[] = [];
  for (const ref of refs ?? []) {
    const rubric = rubrics[ref];
    if (registry) {
      const artifact = registry.artifacts[ref];
      if (!artifact) {
        out.push({ reference: ref, exists: false, tiedToCandidate: false, mechanicallyValid: false, supportsBehavior: false, reason: "reference not in artifact registry" });
        continue;
      }
      const tied = artifact.candidateBinding === rc.candidate.repositoryMaterializationId &&
        artifact.snapshotDigest === rc.candidate.runtimeSnapshotDigest;
      const mechanicallyValid = artifact.allowedSource && artifact.current && artifact.applicable && tied;
      const supportsBehavior = rubric ? isReferenceSupporting(rubric) : false;
      const reason = !artifact.allowedSource ? "source not allowed"
        : !artifact.current ? "artifact not current"
        : !artifact.applicable ? "artifact not applicable"
        : !tied ? "candidate/snapshot binding mismatch"
        : !supportsBehavior ? "reference does not support claimed behavior"
        : "resolved and supporting";
      out.push({ reference: ref, exists: true, tiedToCandidate: tied, mechanicallyValid, supportsBehavior, reason });
    } else {
      // Legacy path: rubric-provided booleans, no immutable registry.
      const exists = rubric?.referenceExists ?? false;
      const tied = rubric?.tiedToCandidate ?? false;
      const mechanicallyValid = exists && tied;
      const supportsBehavior = rubric ? isReferenceSupporting(rubric) : false;
      out.push({
        reference: ref,
        exists,
        tiedToCandidate: tied,
        mechanicallyValid,
        supportsBehavior,
        reason: !exists ? "reference missing" : !tied ? "not tied to candidate" : !supportsBehavior ? "does not support behavior" : "resolved and supporting",
      });
    }
  }
  return out;
}

function computeReportedClaimAccounting(
  rc: import("./result-contract.ts").ResultContract,
  truthOutcomes: Record<string, boolean>,
  truthBindingValid: boolean,
  registry: ArtifactRegistry | undefined,
): ReportedClaimAccounting {
  const executionValid = rc.execution.state === "completed" || rc.execution.state === "partial";
  const entries: ReportedClaimAccountingEntry[] = [];
  let reportedSatisfied = 0;
  let reportedViolated = 0;
  let falseSatisfaction = 0;
  let falseViolation = 0;
  let correctReportedClaims = 0;
  let unparseableUnknownClaims = 0;
  let admittedSemanticConclusions = 0;
  let rejectedUnadmittedConclusions = 0;
  let truthComparisonSuspended = 0;

  for (const a of rc.assessments) {
    const parsedClaim = parseReportedClaim(a.originalReportedClaim);
    if (parsedClaim === "satisfied") reportedSatisfied++;
    else if (parsedClaim === "violated") reportedViolated++;
    else unparseableUnknownClaims++;

    const hasTruth = truthBindingValid && Object.prototype.hasOwnProperty.call(truthOutcomes, a.expectedCriterionId);
    const truthOutcome = hasTruth ? truthOutcomes[a.expectedCriterionId] : null;

    let comparison: ReportedClaimComparison;
    if (!hasTruth) {
      comparison = "truth-suspended";
      truthComparisonSuspended++;
    } else if (parsedClaim === "unknown") {
      comparison = "unknown-claim";
    } else if (parsedClaim === "satisfied" && truthOutcome === false) {
      comparison = "false-satisfaction";
      falseSatisfaction++;
    } else if (parsedClaim === "violated" && truthOutcome === true) {
      comparison = "false-violation";
      falseViolation++;
    } else {
      comparison = "agrees";
      correctReportedClaims++;
    }

    // Mechanical reference validity is a separate dimension and never erases the
    // original claim accounting.
    let referenceValid: boolean | null = null;
    if (a.references.length > 0) {
      const resolved = resolveFindingReferences(a.references, rc, registry, {});
      referenceValid = resolved.some((r) => r.mechanicallyValid);
    }

    const admitted = executionValid && a.admittedConclusion !== null;
    if (admitted) admittedSemanticConclusions++;
    else rejectedUnadmittedConclusions++;

    entries.push({
      criterionId: a.expectedCriterionId,
      originalReportedClaim: a.originalReportedClaim,
      parsedClaim,
      truthOutcome,
      comparison,
      admittedConclusion: a.admittedConclusion,
      referenceValid,
      executionState: rc.execution.state,
      accounted: a.originalReportedClaim !== null && a.originalReportedClaim !== undefined,
      admitted,
    });
  }

  return {
    attempted: rc.assessments.length,
    completed: executionValid ? rc.assessments.length : 0,
    reportedSatisfied,
    reportedViolated,
    falseSatisfaction,
    falseViolation,
    correctReportedClaims,
    unparseableUnknownClaims,
    admittedSemanticConclusions,
    rejectedUnadmittedConclusions,
    truthComparisonSuspended,
    entries,
  };
}

function computeProfileAOutput(
  rc: import("./result-contract.ts").ResultContract,
  truthOutcomes: Record<string, boolean>,
  registry: ArtifactRegistry | undefined,
  rubrics: Record<string, RubricDecision>,
  truthBindingValid: boolean,
): ProfileAOutput {
  const findings: ProfileAFindingOutput[] = [];
  let deliveredCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  let outOfScopeCount = 0;
  let skippedCount = 0;

  for (const f of rc.findings) {
    if (f.skipped) {
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

    deliveredCount++;
    const nativeComment = f.nativeComment || "unnamed finding";
    const criterionMappingRaw = f.criterionMapping;
    const findingDiagnostics: string[] = [];

    // Resolve the finding's real references independently of Truth.
    const resolvedRefs = resolveFindingReferences(f.references, rc, registry, rubrics);
    for (const r of resolvedRefs) {
      findingDiagnostics.push(`reference ${r.reference}: ${r.reason}`);
    }

    let mappingStatus: "mapped" | "unmapped" | "out-of-scope" = "unmapped";
    let criterionMapping: string | null = null;

    if (criterionMappingRaw !== null && criterionMappingRaw !== undefined) {
      const mappedId = criterionMappingRaw;
      if (Object.prototype.hasOwnProperty.call(truthOutcomes, mappedId)) {
        mappingStatus = "mapped";
        criterionMapping = mappedId;
        mappedCount++;
      } else if (rc.criteria.expectedCriterionIds.includes(mappedId)) {
        // Known criterion but no Truth outcome — cannot compare.
        mappingStatus = "out-of-scope";
        outOfScopeCount++;
        criterionMapping = mappedId;
      } else {
        mappingStatus = "out-of-scope";
        outOfScopeCount++;
        criterionMapping = mappedId;
        findingDiagnostics.push(`mapped to criterion ${mappedId} not in truth inventory → out-of-scope`);
      }
    } else {
      unmappedCount++;
      findingDiagnostics.push("no criterion mapping");
    }

    // Reference validity is purely mechanical.
    let referenceValidity: "valid" | "invalid" | "unknown";
    if (resolvedRefs.length === 0) referenceValidity = "unknown";
    else if (resolvedRefs.some((r) => r.mechanicallyValid)) referenceValidity = "valid";
    else referenceValidity = "invalid";

    // Semantic support requires a real, mechanically valid, supporting reference.
    const anySupporting = resolvedRefs.some((r) => r.mechanicallyValid && r.supportsBehavior);
    let semanticSupport: "supported" | "unsupported" | "neutral";
    if (mappingStatus !== "mapped" || resolvedRefs.length === 0) semanticSupport = "neutral";
    else if (anySupporting) semanticSupport = "supported";
    else semanticSupport = "unsupported";

    // Truth comparison only for mapped findings; never implies reference validity.
    let truthComparison: "matches" | "contradicts" | "neutral" | "n/a" = "neutral";
    if (mappingStatus === "mapped" && truthBindingValid) {
      if (truthOutcomes[criterionMapping!] === true) {
        truthComparison = "contradicts"; // false allegation regardless of reference
        findingDiagnostics.push(`mapped to truth-satisfied criterion ${criterionMapping} → false allegation`);
      } else {
        truthComparison = "matches";
        findingDiagnostics.push(
          anySupporting
            ? `mapped to truth-violated criterion ${criterionMapping} → supported detection`
            : `mapped to truth-violated criterion ${criterionMapping} → detection without a supporting reference`,
        );
      }
    } else if (mappingStatus === "mapped") {
      findingDiagnostics.push("truth binding invalid → truth comparison suspended");
    }

    findings.push({
      findingId: nativeComment,
      nativeComment,
      normalizedFinding: f.normalizedFinding,
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

  const totalFound = findings.length;
  const overallStatus =
    totalFound > 0
      ? mappedCount > 0 || unmappedCount > 0
        ? "partial"
        : "inconclusive"
      : "complete";

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
