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
 * Mechanical reference validity is resolved from the immutable artifact
 * registry. Caller-supplied rubric booleans are never used as proof that a
 * reference exists or is bound to the declared candidate/snapshot.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { consumerAdmit, type AdmissionDecision, type AssessmentBinding } from "./controls.ts";
import type {
  AdmittedConclusion,
  ExecutionState,
  ResultContract,
} from "./result-contract.ts";

export const SCORER_VERSION = "scorer-v2";
export const RUBRIC_VERSION = "rubric-v1";

// --- Rubric ---

export interface RubricDecision {
  /** @deprecated Mechanical existence is resolved from the artifact registry. */
  referenceExists?: boolean;
  /** @deprecated Mechanical binding is resolved from the artifact registry. */
  tiedToCandidate?: boolean;
  supportsBehavior: boolean;
  coversSubclauses: boolean;
  relevantCurrentApplicable: boolean;
  contradictsClaim: boolean;
}

/** Human-review provenance for a semantic-support decision. */
export interface RubricReview {
  rubricVersion: string;
  reference: string;
  decision: RubricDecision;
  rationale: string;
  reviewer: string;
  /** True when the reviewer was blinded to profile/repetition labels. */
  blinded: boolean;
  reviewedAt: string | null;
}

export function evaluateRubric(params: {
  supportsBehavior: boolean;
  coversSubclauses: boolean;
  relevantCurrentApplicable: boolean;
  contradictsClaim: boolean;
}): RubricDecision {
  return {
    supportsBehavior: params.supportsBehavior,
    coversSubclauses: params.coversSubclauses,
    relevantCurrentApplicable: params.relevantCurrentApplicable,
    contradictsClaim: params.contradictsClaim,
  };
}

export function isReferenceSupporting(r: RubricDecision): boolean {
  return (
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
  resultContract: ResultContract;
  truthBinding: TruthBinding;
  /** Frozen semantic-support rubric, per reference id. */
  referenceRubrics: Record<string, RubricDecision>;
  /** Human-review provenance for rubric decisions. */
  rubricReviews?: Record<string, RubricReview>;
  /** Immutable artifact registry used for mechanical reference resolution. */
  artifactRegistry?: ArtifactRegistry;
  /** @deprecated Retained for call compatibility; execution state governs admission. */
  executionBinding?: "preserve-claim" | "no-verdict";
  /** When true, an invalid Truth binding throws instead of returning errors. */
  strictTruthBinding?: boolean;
}

export interface LabelAgreement {
  criterionId: string;
  /** Null when execution is not admissible or the Truth binding is invalid. */
  admittedConclusion: AdmittedConclusion | null;
  /** Parsed polarity of the ORIGINAL reported claim. */
  reportedClaim: ParsedReportedClaim;
  truthOutcome: boolean | null;
  /** Null when no admitted comparison is possible. */
  agrees: boolean | null;
  /** True when an admissible semantic conclusion exists. */
  admitted: boolean;
}

export interface ReferenceValidity {
  criterionId: string;
  reference: string;
  exists: boolean;
  tiedToCandidate: boolean;
  valid: boolean;
  reason: string;
}

export interface SemanticSupport {
  criterionId: string;
  reference: string;
  supporting: boolean;
  reason: string;
}

// --- Reported-claim accounting (WP5) ---
// Independent accounting of the ORIGINAL reported claim, kept separate from
// evidence admission, mechanical reference validity, semantic support and the
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
  admittedConclusion: AdmittedConclusion | null;
  referenceValid: boolean | null;
  executionState: ExecutionState;
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
  truthBindingValid: boolean;
  truthBindingErrors: string[];
  labelAgreement: LabelAgreement[];
  referenceValidity: ReferenceValidity[];
  semanticSupport: SemanticSupport[];
  rubricReviews: RubricReview[];
  coverage: import("./result-contract.ts").CoverageRecord;
  polarityPreserved: boolean;
  executionValid: boolean;
  executionState: ExecutionState;
  /** Shared deterministic consumer-admission decision for this result. */
  admission: AdmissionDecision;
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
  /** False for skipped findings and findings dropped by normalization. */
  delivered: boolean;
  skipped: boolean;
  skipReason: string | null;
  /** True when a raw native comment had no normalized finding. */
  normalizationDropped: boolean;
  mappingStatus: "mapped" | "unmapped" | "out-of-scope" | "invalid";
  criterionMapping: string | null;
  /** True when another delivered finding maps to the same criterion. */
  duplicateMapping: boolean;
  referenceValidity: "valid" | "invalid" | "unknown";
  semanticSupport: "supported" | "unsupported" | "neutral";
  truthComparison: "matches" | "contradicts" | "neutral" | "n/a";
  qualityFlags: string[];
  diagnostics: string[];
}

export interface ProfileAOutput {
  deliveredCount: number;
  findings: ProfileAFindingOutput[];
  /** Profile A does not produce criterion satisfaction verdicts. */
  satisfaction: "not-applicable";
  /** Profile A does not produce criterion coverage. */
  criterionCoverage: "not-applicable";
  summary: {
    delivered: number;
    mapped: number;
    unmapped: number;
    outOfScope: number;
    skipped: number;
    normalizationDropped: number;
    falseAllegations: number;
    supportedDetections: number;
    duplicateMappings: number;
    overallStatus: "complete" | "partial" | "inconclusive";
  };
}

// --- Helpers ---

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return false;
  return b.every((v) => set.has(v));
}

/** Completed/partial attempts are admissible; cancelled/superseded/failed/unknown are not. */
export function isAdmissibleExecution(state: ExecutionState, supersededBy?: string | null): boolean {
  if (supersededBy !== null && supersededBy !== undefined && supersededBy !== "") return false;
  return state === "completed" || state === "partial";
}

/**
 * Validate a Truth binding against the ResultContract. Returns structured
 * errors; an empty array means the binding may be joined.
 */
export function validateTruthBinding(rc: ResultContract, tb: TruthBinding): string[] {
  const errors: string[] = [];
  if (tb === null || typeof tb !== "object") return ["truth binding must be an object"];

  if (tb.canonicalCandidateId !== rc.candidate.repositoryMaterializationId) {
    errors.push(
      `truth candidate "${tb.canonicalCandidateId}" does not match result contract candidate "${rc.candidate.repositoryMaterializationId}"`,
    );
  }
  if (tb.anonymizedCandidateId !== rc.candidate.opaqueFixtureId) {
    errors.push(
      `truth anonymized candidate "${tb.anonymizedCandidateId}" does not match result contract opaqueFixtureId "${rc.candidate.opaqueFixtureId}"`,
    );
  }
  if (tb.headApplicationDigest !== rc.candidate.runtimeSnapshotDigest) {
    errors.push(
      `truth head digest "${tb.headApplicationDigest}" does not match result contract snapshot "${rc.candidate.runtimeSnapshotDigest}"`,
    );
  }
  if (tb.criteriaRevision !== rc.criteria.authoredCriteriaRevision) {
    errors.push(
      `truth criteria revision "${tb.criteriaRevision}" does not match result contract criteria "${rc.criteria.authoredCriteriaRevision}"`,
    );
  }

  if (!Array.isArray(tb.expectedCriterionInventory)) {
    errors.push("truth expectedCriterionInventory must be an array");
  } else {
    if (new Set(tb.expectedCriterionInventory).size !== tb.expectedCriterionInventory.length) {
      errors.push("truth expectedCriterionInventory contains duplicates");
    }
    if (!sameSet(tb.expectedCriterionInventory, rc.criteria.expectedCriterionIds)) {
      errors.push("truth criterion inventory does not match result contract expected criteria");
    }
  }

  if (tb.truthOutcomes === null || typeof tb.truthOutcomes !== "object" || Array.isArray(tb.truthOutcomes)) {
    errors.push("truth truthOutcomes must be an object");
  } else {
    const expected = new Set(rc.criteria.expectedCriterionIds);
    for (const [id, value] of Object.entries(tb.truthOutcomes)) {
      if (!expected.has(id)) errors.push(`truth outcome contains unknown criterion: ${id}`);
      if (typeof value !== "boolean") errors.push(`truth outcome for ${id} must be boolean`);
    }
    for (const id of rc.criteria.expectedCriterionIds) {
      if (!Object.prototype.hasOwnProperty.call(tb.truthOutcomes, id)) {
        errors.push(`truth outcome missing criterion: ${id}`);
      }
    }
  }

  if (typeof tb.truthVersion !== "string" || tb.truthVersion.trim() === "") {
    errors.push("missing truthVersion");
  }
  if (typeof tb.truthDigest !== "string" || tb.truthDigest.trim() === "") {
    errors.push("missing truthDigest");
  }

  return errors;
}

interface ResolvedReference {
  reference: string;
  exists: boolean;
  tiedToCandidate: boolean;
  mechanicallyValid: boolean;
  reason: string;
}

/**
 * Resolve one reference mechanically against the immutable artifact registry.
 * Never trusts caller-provided `referenceExists` / `tiedToCandidate` booleans.
 */
function resolveReference(
  ref: string,
  rc: ResultContract,
  registry: ArtifactRegistry | undefined,
): ResolvedReference {
  if (!registry) {
    return {
      reference: ref,
      exists: false,
      tiedToCandidate: false,
      mechanicallyValid: false,
      reason: "no artifact registry",
    };
  }
  const artifact = registry.artifacts[ref];
  if (!artifact) {
    return {
      reference: ref,
      exists: false,
      tiedToCandidate: false,
      mechanicallyValid: false,
      reason: "reference not in artifact registry",
    };
  }
  const tied =
    artifact.candidateBinding === rc.candidate.repositoryMaterializationId &&
    artifact.snapshotDigest === rc.candidate.runtimeSnapshotDigest;
  const mechanicallyValid = tied && artifact.allowedSource && artifact.current && artifact.applicable;

  let reason = "resolved and mechanically valid";
  if (!artifact.allowedSource) reason = "source not allowed";
  else if (!artifact.current) reason = "artifact not current";
  else if (!artifact.applicable) reason = "artifact not applicable";
  else if (!tied) reason = "candidate/snapshot binding mismatch";

  return {
    reference: ref,
    exists: true,
    tiedToCandidate: tied,
    mechanicallyValid,
    reason,
  };
}

interface ResolvedFindingReference extends ResolvedReference {
  supportsBehavior: boolean;
}

function resolveFindingReferences(
  refs: string[] | undefined,
  rc: ResultContract,
  registry: ArtifactRegistry | undefined,
  rubrics: Record<string, RubricDecision>,
): ResolvedFindingReference[] {
  const out: ResolvedFindingReference[] = [];
  for (const ref of refs ?? []) {
    const resolved = resolveReference(ref, rc, registry);
    const rubric = rubrics[ref];
    const supportsBehavior = resolved.mechanicallyValid && rubric ? isReferenceSupporting(rubric) : false;
    out.push({ ...resolved, supportsBehavior });
  }
  return out;
}

function computeReportedClaimAccounting(
  rc: ResultContract,
  truthOutcomes: Record<string, boolean>,
  truthBindingValid: boolean,
  registry: ArtifactRegistry | undefined,
  admissible: boolean,
): ReportedClaimAccounting {
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

    // Mechanical reference validity is a separate dimension and never erases
    // the original claim accounting.
    let referenceValid: boolean | null = null;
    if (a.references.length > 0) {
      const resolved = resolveFindingReferences(a.references, rc, registry, {});
      referenceValid = resolved.some((r) => r.mechanicallyValid);
    }

    const admitted = admissible && a.admittedConclusion !== null;
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
    completed: admissible ? rc.assessments.length : 0,
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
  rc: ResultContract,
  truthOutcomes: Record<string, boolean>,
  registry: ArtifactRegistry | undefined,
  rubrics: Record<string, RubricDecision>,
  truthBindingValid: boolean,
): ProfileAOutput {
  const findings: ProfileAFindingOutput[] = [];
  const mappedFindings: { findingId: string; criterionId: string }[] = [];
  let deliveredCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  let outOfScopeCount = 0;
  let skippedCount = 0;
  let normalizationDroppedCount = 0;
  let falseAllegations = 0;
  let supportedDetections = 0;

  for (let i = 0; i < rc.findings.length; i++) {
    const f = rc.findings[i];
    const findingId = f.findingId ?? `finding-${i}`;
    const nativeComment = f.nativeComment;

    if (f.skipped) {
      skippedCount++;
      findings.push({
        findingId,
        nativeComment,
        normalizedFinding: f.normalizedFinding,
        delivered: false,
        skipped: true,
        skipReason: f.skipReason,
        normalizationDropped: false,
        mappingStatus: "invalid",
        criterionMapping: f.criterionMapping,
        duplicateMapping: false,
        referenceValidity: "unknown",
        semanticSupport: "neutral",
        truthComparison: "n/a",
        qualityFlags: f.qualityFlags,
        diagnostics: [f.skipReason ? `skipped: ${f.skipReason}` : "skipped"],
      });
      continue;
    }

    const normalizationDropped = f.normalizedFinding === null && nativeComment.trim().length > 0;
    if (normalizationDropped) {
      normalizationDroppedCount++;
      findings.push({
        findingId,
        nativeComment,
        normalizedFinding: null,
        delivered: false,
        skipped: false,
        skipReason: null,
        normalizationDropped: true,
        mappingStatus: "invalid",
        criterionMapping: f.criterionMapping,
        duplicateMapping: false,
        referenceValidity: "unknown",
        semanticSupport: "neutral",
        truthComparison: "n/a",
        qualityFlags: f.qualityFlags,
        diagnostics: ["normalization dropped the raw native finding"],
      });
      continue;
    }

    deliveredCount++;
    const findingDiagnostics: string[] = [];
    const resolvedRefs = resolveFindingReferences(f.references, rc, registry, rubrics);
    for (const r of resolvedRefs) {
      findingDiagnostics.push(`reference ${r.reference}: ${r.reason}`);
    }

    let mappingStatus: "mapped" | "unmapped" | "out-of-scope" = "unmapped";
    let criterionMapping: string | null = null;
    if (f.criterionMapping !== null && f.criterionMapping !== undefined) {
      const mappedId = f.criterionMapping;
      if (rc.criteria.expectedCriterionIds.includes(mappedId)) {
        mappingStatus = "mapped";
        criterionMapping = mappedId;
        mappedCount++;
        mappedFindings.push({ findingId, criterionId: mappedId });
      } else {
        mappingStatus = "out-of-scope";
        criterionMapping = mappedId;
        outOfScopeCount++;
        findingDiagnostics.push(`mapped to criterion ${mappedId} not in the frozen inventory → out-of-scope`);
      }
    } else {
      unmappedCount++;
      findingDiagnostics.push("no criterion mapping");
    }

    let referenceValidity: "valid" | "invalid" | "unknown";
    if (resolvedRefs.length === 0) referenceValidity = "unknown";
    else if (resolvedRefs.some((r) => r.mechanicallyValid)) referenceValidity = "valid";
    else referenceValidity = "invalid";

    const anySupporting = resolvedRefs.some((r) => r.mechanicallyValid && r.supportsBehavior);
    let semanticSupport: "supported" | "unsupported" | "neutral";
    if (mappingStatus !== "mapped" || resolvedRefs.length === 0) semanticSupport = "neutral";
    else if (anySupporting) semanticSupport = "supported";
    else semanticSupport = "unsupported";

    let truthComparison: "matches" | "contradicts" | "neutral" | "n/a" = "neutral";
    if (mappingStatus === "mapped" && truthBindingValid) {
      if (truthOutcomes[criterionMapping!] === true) {
        truthComparison = "contradicts";
        falseAllegations++;
        findingDiagnostics.push(`mapped to truth-satisfied criterion ${criterionMapping} → false allegation`);
      } else {
        truthComparison = "matches";
        if (anySupporting) {
          supportedDetections++;
          findingDiagnostics.push(
            `mapped to truth-violated criterion ${criterionMapping} → supported detection`,
          );
        } else {
          findingDiagnostics.push(
            `mapped to truth-violated criterion ${criterionMapping} → detection without a supporting reference`,
          );
        }
      }
    } else if (mappingStatus === "mapped") {
      findingDiagnostics.push("truth binding invalid → truth comparison suspended");
    }

    findings.push({
      findingId,
      nativeComment,
      normalizedFinding: f.normalizedFinding,
      delivered: true,
      skipped: false,
      skipReason: null,
      normalizationDropped: false,
      mappingStatus,
      criterionMapping,
      duplicateMapping: false,
      referenceValidity,
      semanticSupport,
      truthComparison,
      qualityFlags: f.qualityFlags,
      diagnostics: findingDiagnostics,
    });
  }

  // Duplicate/conflicting mappings: a criterion may not be claimed by more than
  // one delivered finding. Keep both visible and flag them.
  const byCriterion = new Map<string, string[]>();
  for (const m of mappedFindings) {
    const list = byCriterion.get(m.criterionId) ?? [];
    list.push(m.findingId);
    byCriterion.set(m.criterionId, list);
  }
  let duplicateMappings = 0;
  for (const [criterionId, ids] of byCriterion) {
    if (ids.length > 1) {
      duplicateMappings += ids.length;
      for (const finding of findings) {
        if (ids.includes(finding.findingId)) {
          finding.duplicateMapping = true;
          finding.diagnostics.push(
            `duplicate/conflicting mapping: criterion ${criterionId} claimed by ${ids.join(", ")}`,
          );
        }
      }
    }
  }

  const overallStatus: "complete" | "partial" | "inconclusive" =
    deliveredCount === 0 && skippedCount === 0 && normalizationDroppedCount === 0
      ? "complete"
      : deliveredCount > 0
        ? "partial"
        : "partial";

  return {
    deliveredCount,
    findings,
    satisfaction: "not-applicable",
    criterionCoverage: "not-applicable",
    summary: {
      delivered: deliveredCount,
      mapped: mappedCount,
      unmapped: unmappedCount,
      outOfScope: outOfScopeCount,
      skipped: skippedCount,
      normalizationDropped: normalizationDroppedCount,
      falseAllegations,
      supportedDetections,
      duplicateMappings,
      overallStatus,
    },
  };
}

export function scoreResult(input: ScorerInput): ScorerResult {
  const rc = input.resultContract;
  const diagnostics: string[] = [];
  const referenceValidity: ReferenceValidity[] = [];
  const semanticSupport: SemanticSupport[] = [];
  const tb = input.truthBinding;

  // --- Truth binding validation (post-hoc join) ---
  const truthBindingErrors = validateTruthBinding(rc, tb);
  const truthBindingValid = truthBindingErrors.length === 0;
  for (const err of truthBindingErrors) diagnostics.push(`truth binding: ${err}`);
  if (input.strictTruthBinding && !truthBindingValid) {
    throw new Error(`invalid truth binding: ${truthBindingErrors.join("; ")}`);
  }

  // --- Execution admissibility ---
  const execState = rc.execution.state;
  const supersededBy = rc.execution.supersededBy ?? null;
  const admissible = isAdmissibleExecution(execState, supersededBy);
  if (!admissible) {
    diagnostics.push(
      `execution ${execState}${supersededBy ? ` (superseded by ${supersededBy})` : ""}: no admitted semantic verdict; original claim preserved`,
    );
  }

  // --- Label agreement (only for admissible execution) ---
  const labelAgreement: LabelAgreement[] = rc.assessments.map((a) => {
    const truth = truthBindingValid ? tb.truthOutcomes[a.expectedCriterionId] ?? null : null;
    const parsed = parseReportedClaim(a.originalReportedClaim);

    if (!admissible) {
      return {
        criterionId: a.expectedCriterionId,
        admittedConclusion: null,
        reportedClaim: parsed,
        truthOutcome: truth,
        agrees: null,
        admitted: false,
      };
    }

    const admittedConclusion = a.admittedConclusion;
    let agrees: boolean | null = null;
    if (truthBindingValid && truth !== null && admittedConclusion !== null) {
      if (admittedConclusion === "satisfied") agrees = truth === true;
      else if (admittedConclusion === "violated") agrees = truth === false;
      else agrees = null;
    }
    return {
      criterionId: a.expectedCriterionId,
      admittedConclusion,
      reportedClaim: parsed,
      truthOutcome: truth,
      agrees,
      admitted: admittedConclusion !== null,
    };
  });

  // --- Mechanical reference validity + semantic support (separate dimensions) ---
  for (const a of rc.assessments) {
    for (const ref of a.references) {
      const resolved = resolveReference(ref, rc, input.artifactRegistry);
      referenceValidity.push({
        criterionId: a.expectedCriterionId,
        reference: ref,
        exists: resolved.exists,
        tiedToCandidate: resolved.tiedToCandidate,
        valid: resolved.mechanicallyValid,
        reason: resolved.reason,
      });
      const rubric = input.referenceRubrics[ref];
      const supporting = resolved.mechanicallyValid && rubric ? isReferenceSupporting(rubric) : false;
      semanticSupport.push({
        criterionId: a.expectedCriterionId,
        reference: ref,
        supporting,
        reason: !resolved.mechanicallyValid
          ? resolved.reason
          : !rubric
            ? "no semantic rubric decision"
            : supporting
              ? "supports behavior and covers subclauses"
              : "does not fully support the claimed behavior",
      });
    }
    if (a.references.length === 0 && a.admittedConclusion !== null) {
      diagnostics.push(`${a.expectedCriterionId}: no references, unsupported`);
    }
  }

  // --- Profile A finding scoring ---
  const profileAOutput = computeProfileAOutput(
    rc,
    tb.truthOutcomes,
    input.artifactRegistry,
    input.referenceRubrics,
    truthBindingValid,
  );

  // --- Reported-claim accounting ---
  const reportedClaims = computeReportedClaimAccounting(
    rc,
    tb.truthOutcomes,
    truthBindingValid,
    input.artifactRegistry,
    admissible,
  );

  // --- Shared consumer admission ---
  const evidenceApplicable = rc.evidence.applicability === "applicable";
  const lifecycleValid = execState !== "cancelled" && supersededBy === null;
  const cancelledOrSuperseded = !lifecycleValid;
  const binding: AssessmentBinding = {
    assessmentId: rc.contractId,
    criteriaRevision: rc.criteria.authoredCriteriaRevision,
    candidateSnapshot: rc.candidate.runtimeSnapshotDigest,
    admitted: admissible && rc.assessments.every((a) => a.admittedConclusion !== null),
    reportedCriterionIds: rc.coverage.presentIds,
    admittedCriterionIds: rc.assessments
      .filter((a) => a.admittedConclusion !== null)
      .map((a) => a.expectedCriterionId),
  };
  const admission = consumerAdmit(
    binding,
    {
      revisionId: rc.criteria.authoredCriteriaRevision,
      textDigest: rc.criteria.criteriaTextDigest,
      parentRevision: null,
    },
    rc.candidate.runtimeSnapshotDigest,
    rc.criteria.expectedCriterionIds,
    evidenceApplicable,
    cancelledOrSuperseded,
    admissible,
  );
  if (!admission.admitted) diagnostics.push(`consumer admission rejected: ${admission.reason}`);

  // --- Polarity preserved ---
  const polarityPreserved = rc.assessments.every(
    (a) => a.originalReportedClaim === null || typeof a.originalReportedClaim === "string",
  );

  // --- Coverage diagnostics ---
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

  // --- Profile B with complete inventory but >= 80% inconclusive → flagged ---
  const totalAssessments = rc.assessments.length;
  const inconclusiveCount = rc.assessments.filter((a) => a.admittedConclusion === "inconclusive").length;
  if (
    totalAssessments > 0 &&
    rc.coverage.wholeInventoryAdmitted &&
    inconclusiveCount / totalAssessments >= 0.8
  ) {
    diagnostics.push("profile B yields few usable assessments (>=80% inconclusive)");
  }

  // --- Rubric review provenance ---
  const rubricReviews: RubricReview[] = Object.entries(input.rubricReviews ?? {}).map(([reference, review]) => ({
    rubricVersion: review.rubricVersion || RUBRIC_VERSION,
    reference: review.reference || reference,
    decision: review.decision,
    rationale: review.rationale,
    reviewer: review.reviewer,
    blinded: review.blinded === true,
    reviewedAt: review.reviewedAt ?? null,
  }));

  return {
    scorerVersion: SCORER_VERSION,
    rubricVersion: RUBRIC_VERSION,
    candidateId: rc.candidate.repositoryMaterializationId,
    truthBindingValid,
    truthBindingErrors,
    labelAgreement,
    referenceValidity,
    semanticSupport,
    rubricReviews,
    coverage: rc.coverage,
    polarityPreserved,
    executionValid: admissible,
    executionState: execState,
    admission,
    diagnostics,
    profileA: profileAOutput,
    reportedClaims,
  };
}