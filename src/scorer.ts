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

import * as crypto from "node:crypto";

import { consumerAdmit, type AdmissionDecision, type AssessmentBinding } from "./controls.ts";
import {
  booleanGate,
  decide,
  evaluateRunGates,
  failGate,
  notApplicableGate,
  passGate,
  type GateResult,
} from "./admission-gates.ts";
import { validateResultContract } from "./result-contract.ts";
import type {
  AdmittedConclusion,
  AssessmentConflictKind,
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
  /**
   * Criterion this support judgment is about. A support decision is a judgment
   * about a specific claim, not about a file: the same artifact may support one
   * criterion and fail to support another that cites it.
   */
  criterionId?: string;
  /**
   * Finding/claim identity this judgment is about. Two Profile A findings can
   * share a criterion and an evidence reference while asserting different
   * things; a decision bound to one of them never supports the other.
   */
  findingId?: string;
  /**
   * Internal finding-occurrence identity this judgment is about. An external
   * `findingId` may collide, so a decision that must distinguish two
   * occurrences binds to the occurrence identity instead.
   */
  occurrenceId?: string;
  supportsBehavior: boolean;
  coversSubclauses: boolean;
  relevantCurrentApplicable: boolean;
  contradictsClaim: boolean;
}

/**
 * Support decisions are looked up per (criterion, reference) claim, optionally
 * narrowed to one finding identity. A shared evidence reference never transfers
 * a positive judgment to every assertion citing that file, and a judgment bound
 * to one finding never supports a different finding that happens to cite the
 * same criterion and reference.
 */
export function claimSupportKey(
  criterionId: string,
  reference: string,
  findingId?: string,
  occurrenceId?: string,
): string {
  const base = `${criterionId}::${reference}`;
  if (findingId === undefined) return base;
  const scoped = `${base}::${findingId}`;
  return occurrenceId === undefined ? scoped : `${scoped}@${occurrenceId}`;
}

/**
 * Authoritative occurrence provenance for one finding slot in the native
 * output. The identity is derived from the run, attempt, candidate, snapshot
 * and native output identity already present in the contract, plus the exact
 * position of the occurrence. It never trusts the display `findingId`, which
 * may be supplied externally, duplicated or absent.
 */
export interface FindingOccurrenceIdentity {
  occurrenceId: string;
  index: number;
  /** Complete provenance components were present and non-empty. */
  provenanceComplete: boolean;
  missingProvenance: string[];
}

export function findingOccurrenceIdentity(rc: ResultContract, index: number): FindingOccurrenceIdentity {
  const components: { name: string; value: string }[] = [
    { name: "execution.runId", value: rc.execution.runId },
    { name: "execution.attemptId", value: rc.execution.attemptId },
    { name: "candidate.repositoryMaterializationId", value: rc.candidate.repositoryMaterializationId },
    { name: "candidate.runtimeSnapshotDigest", value: rc.candidate.runtimeSnapshotDigest },
    { name: "profile.inputIdentity", value: rc.profile.inputIdentity },
  ];
  const missingProvenance = components
    .filter((c) => typeof c.value !== "string" || c.value.trim() === "")
    .map((c) => c.name);
  const digest = crypto
    .createHash("sha256")
    .update([...components.map((c) => c.value ?? ""), String(index)].join("\u0000"))
    .digest("hex");
  return {
    occurrenceId: `fo-${digest.slice(0, 16)}`,
    index,
    provenanceComplete: missingProvenance.length === 0,
    missingProvenance,
  };
}

interface SupportSource {
  /** Claim-scoped rubric decisions, keyed by `criterionId::reference`. */
  claimRubrics?: Record<string, RubricDecision>;
  /** @deprecated Reference-level decisions only apply when bound to the claim. */
  referenceRubrics?: Record<string, RubricDecision>;
}

interface ClaimSupportLookup {
  decision: RubricDecision | null;
  reason: string;
  /**
   * True when the pair (criterion, reference) is claimed by more than one
   * finding and no finding-scoped decision exists, so no individual support
   * judgment can be made without inventing one.
   */
  ambiguous?: boolean;
  /** Which binding the decision was resolved from. */
  decisionSource?: "occurrence" | "finding" | "claim" | "reference" | "none";
}

/** One finding's identities, as resolved by the scorer. */
export interface FindingSupportRef {
  findingId: string;
  occurrenceId: string;
  /**
   * True when the external `findingId` is shared by more than one finding
   * occurrence in this native output. A decision bound only to such an id
   * cannot identify which occurrence it is about.
   */
  findingIdAmbiguous: boolean;
}

/**
 * Resolve the semantic-support decision for ONE claim.
 *
 * Resolution is by finding OCCURRENCE, not by the display `findingId`. An
 * external id that is shared by several occurrences cannot select one of them,
 * so a decision bound only to that id is refused as ambiguous. A finding-scoped
 * decision that names the occurrence identity is usable even when the external
 * id collides.
 *
 * A reference-level entry is only usable when it explicitly names the criterion
 * AND does not name a different finding; otherwise the claim is unsupported
 * with an explanatory reason rather than inheriting another claim's judgment.
 */
function lookupClaimSupport(
  support: SupportSource,
  criterionId: string | null,
  reference: string,
  finding?: FindingSupportRef,
  sharedAcrossFindings?: readonly string[],
): ClaimSupportLookup {
  if (criterionId === null) {
    return {
      decision: null,
      reason: "no criterion mapping, so no claim-specific support decision applies",
      decisionSource: "none",
    };
  }

  const findingId = finding?.findingId;
  const occurrenceId = finding?.occurrenceId;
  const shared = sharedAcrossFindings !== undefined && sharedAcrossFindings.length > 1;
  const sharedReason = `criterion ${criterionId} and reference ${reference} are claimed by findings ${(sharedAcrossFindings ?? []).join(", ")}; a shared judgment cannot support each of them individually`;

  // 1. A decision bound to the exact occurrence is the only one that can always
  //    distinguish two occurrences.
  if (occurrenceId !== undefined) {
    const occurrenceScoped = support.claimRubrics?.[claimSupportKey(criterionId, reference, findingId, occurrenceId)];
    if (occurrenceScoped) {
      if (occurrenceScoped.occurrenceId !== undefined && occurrenceScoped.occurrenceId !== occurrenceId) {
        return {
          decision: null,
          reason: `support decision is bound to occurrence ${occurrenceScoped.occurrenceId}, not ${occurrenceId}`,
          decisionSource: "none",
        };
      }
      if (occurrenceScoped.findingId !== undefined && occurrenceScoped.findingId !== findingId) {
        return {
          decision: null,
          reason: `finding-scoped support decision is bound to finding ${occurrenceScoped.findingId}, not ${findingId}`,
          decisionSource: "none",
        };
      }
      return { decision: occurrenceScoped, reason: "occurrence-scoped support decision", decisionSource: "occurrence" };
    }
  }

  // 2. An external-id-bound decision is unusable when that id names several
  //    occurrences: accepting it would transfer support to a different one.
  if (finding !== undefined && finding.findingIdAmbiguous) {
    const scoped = support.claimRubrics?.[claimSupportKey(criterionId, reference, finding.findingId)];
    const claimLevel = support.claimRubrics?.[claimSupportKey(criterionId, reference)];
    if (scoped || (claimLevel && claimLevel.findingId === finding.findingId)) {
      return {
        decision: null,
        reason: `external finding id ${finding.findingId} identifies more than one finding occurrence; a decision bound to it cannot disambiguate them`,
        ambiguous: true,
        decisionSource: "none",
      };
    }
  }

  // 3. A uniquely bound finding-scoped decision.
  if (findingId !== undefined && !finding?.findingIdAmbiguous) {
    const scoped = support.claimRubrics?.[claimSupportKey(criterionId, reference, findingId)];
    if (scoped) {
      if (scoped.findingId !== undefined && scoped.findingId !== findingId) {
        return {
          decision: null,
          reason: `finding-scoped support decision is bound to finding ${scoped.findingId}, not ${findingId}`,
          decisionSource: "none",
        };
      }
      if (scoped.occurrenceId !== undefined && scoped.occurrenceId !== occurrenceId) {
        return {
          decision: null,
          reason: `support decision is bound to occurrence ${scoped.occurrenceId}, not ${occurrenceId ?? "the unnamed occurrence"}`,
          decisionSource: "none",
        };
      }
      return { decision: scoped, reason: "finding-scoped support decision", decisionSource: "finding" };
    }
  }

  // 4. A (criterion, reference) pair claimed by several occurrences never
  //    inherits one occurrence's judgment. Refuse rather than attribute.
  if (shared) {
    const claimLevel = support.claimRubrics?.[claimSupportKey(criterionId, reference)];
    if (claimLevel && claimLevel.findingId !== undefined && claimLevel.findingId !== findingId) {
      return {
        decision: null,
        reason: `support decision is bound to finding ${claimLevel.findingId}, not ${findingId ?? "the unnamed finding"}`,
        ambiguous: true,
        decisionSource: "none",
      };
    }
    return { decision: null, reason: sharedReason, ambiguous: true, decisionSource: "none" };
  }

  // 5. Claim-level decision. It must not name a different finding/occurrence.
  const claimed = support.claimRubrics?.[claimSupportKey(criterionId, reference)];
  if (claimed) {
    if (claimed.findingId !== undefined && claimed.findingId !== findingId) {
      return {
        decision: null,
        reason: `support decision is bound to finding ${claimed.findingId}, not ${findingId ?? "the unnamed finding"}`,
        ambiguous: shared,
        decisionSource: "none",
      };
    }
    if (claimed.occurrenceId !== undefined && claimed.occurrenceId !== occurrenceId) {
      return {
        decision: null,
        reason: `support decision is bound to occurrence ${claimed.occurrenceId}, not ${occurrenceId ?? "the unnamed occurrence"}`,
        ambiguous: shared,
        decisionSource: "none",
      };
    }
    return { decision: claimed, reason: "claim-scoped support decision", decisionSource: "claim" };
  }

  // 6. Compatibility reference-level decision. The same finding restriction
  //    applies: a decision that names a foreign finding never supports this one.
  const referenceLevel = support.referenceRubrics?.[reference];
  if (referenceLevel) {
    if (referenceLevel.findingId !== undefined && referenceLevel.findingId !== findingId) {
      return {
        decision: null,
        reason: `reference rubric is bound to finding ${referenceLevel.findingId}, not ${findingId ?? "the unnamed finding"}`,
        decisionSource: "none",
      };
    }
    if (referenceLevel.occurrenceId !== undefined && referenceLevel.occurrenceId !== occurrenceId) {
      return {
        decision: null,
        reason: `reference rubric is bound to occurrence ${referenceLevel.occurrenceId}, not ${occurrenceId ?? "the unnamed occurrence"}`,
        decisionSource: "none",
      };
    }
    if (referenceLevel.criterionId === criterionId) {
      if (shared) return { decision: null, reason: sharedReason, ambiguous: true, decisionSource: "none" };
      return {
        decision: referenceLevel,
        reason: "reference rubric explicitly bound to this criterion",
        decisionSource: "reference",
      };
    }
    if (referenceLevel.criterionId === undefined) {
      return {
        decision: null,
        reason: "reference-level rubric is not bound to a claim; a shared reference does not support every claim citing it",
        decisionSource: "none",
      };
    }
    return {
      decision: null,
      reason: `reference rubric is bound to criterion ${referenceLevel.criterionId}, not ${criterionId}`,
      decisionSource: "none",
    };
  }
  return { decision: null, reason: "no semantic support decision for this claim", decisionSource: "none" };
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
  /** Claim-scoped support decisions, keyed by `criterionId::reference`. */
  claimRubrics?: Record<string, RubricDecision>;
  /**
   * @deprecated Reference-level rubric decisions. Used only when the decision
   * explicitly names the criterion (`criterionId`); a file-level judgment is
   * never transferred across claims.
   */
  referenceRubrics?: Record<string, RubricDecision>;
  /** Human-review provenance for rubric decisions. */
  rubricReviews?: Record<string, RubricReview>;
  /** Immutable artifact registry used for mechanical reference resolution. */
  artifactRegistry?: ArtifactRegistry;
  /** @deprecated Retained for call compatibility; execution state governs admission. */
  executionBinding?: "preserve-claim" | "no-verdict";
  /**
   * Independently captured criteria CONTENT digest of the current criteria.
   * When supplied, shared consumer admission compares the assessment against
   * this digest instead of against the contract's own bound digest (which by
   * definition always matches itself).
   */
  expectedCriteriaContentDigest?: string;
  /**
   * Criteria revision label the consumer currently holds. When supplied,
   * per-claim admission compares against it instead of the contract's own
   * (self-matching) label.
   */
  expectedCriteriaRevision?: string;
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
  /**
   * True when an admissible semantic conclusion exists for this claim. This is
   * NOT consumer admission: it says nothing about reference validity, criteria
   * content, candidate/snapshot binding or claim association. Use
   * `consumerAdmitted` for the all-gates decision.
   */
  semanticConclusionAdmitted: boolean;
  /** Final per-claim consumer admission (every mandatory gate). */
  consumerAdmitted: boolean;
  consumerAdmissionReason: string;
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

/**
 * Per-claim admission for one Profile B assessment.
 *
 * The dimensions are kept separate on purpose: the original reported claim is
 * always retained, schema validity is not evidence validity, and no single
 * dimension implies consumer admission. Only `consumerAdmitted` means "this
 * claim may reach a consumer", and it is true only when every mandatory gate
 * passes.
 */
export interface ClaimAdmission {
  criterionId: string;
  /** The provider's original wording, retained even when the claim is rejected. */
  originalReportedClaim: string | null;
  parsedClaim: ParsedReportedClaim;
  /** The result contract satisfies its schema. */
  contractValid: boolean;
  /** Execution state permits a semantic conclusion. */
  executionAdmissible: boolean;
  /** Producer evidence is applicable to this review. */
  evidenceApplicable: boolean;
  /** Criteria revision label matches the consumer's current one. */
  criteriaRevisionBound: boolean;
  /** Criteria CONTENT matches, independently of the revision label. */
  criteriaContentBound: boolean;
  /** Every cited artifact names this candidate. */
  candidateBound: boolean;
  /** Every cited artifact names this runtime snapshot. */
  snapshotBound: boolean;
  /** Every cited artifact exists, is allowed, current, applicable and bound. */
  referenceValid: boolean;
  /** At least one cited artifact semantically supports the claim. */
  referenceSufficient: boolean;
  /** The criterion is in the expected inventory and claimed exactly once. */
  claimAssociationValid: boolean;
  /** An admissible semantic conclusion exists (execution + admitted conclusion). */
  semanticConclusionAdmitted: boolean;
  /** Final per-claim consumer admission. */
  consumerAdmitted: boolean;
  reason: string;
  /** Claim-level diagnostics retained for a rejected claim. */
  diagnostics: string[];
  /** Structured outcome of every mandatory gate for this claim. */
  gates: GateResult[];
  /** Identity of the first failing gate, when rejected. */
  primaryFailureGate: string | null;
  /** Duplicate/conflict state carried from the provider records. */
  conflictStatus: "none" | AssessmentConflictKind;
  /** Conflict-group identity shared by every occurrence of the conflicted criterion. */
  conflictGroup: string | null;
  /** A cited reference is explicitly marked as contradicting this claim. */
  evidenceConflict: boolean;
  /** References whose support decision marks them as contradicting. */
  contradictoryReferences: string[];
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
  /**
   * True when an admissible semantic conclusion exists for this claim. Not
   * consumer admission; see `consumerAdmitted`.
   */
  semanticConclusionAdmitted: boolean;
  /** Final per-claim consumer admission (every mandatory gate). */
  consumerAdmitted: boolean;
  consumerAdmissionReason: string;
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
  const normalized = claim
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.;:,!]+$/, "");
  if (normalized === "") return "unknown";

  // Explicit schema states first: an exact token is unambiguous.
  if (SATISFIED_STATES.has(normalized)) return "satisfied";
  if (VIOLATED_STATES.has(normalized)) return "violated";
  if (UNKNOWN_STATES.has(normalized)) return "unknown";

  // Negation takes precedence over any positive substring. `not satisfied`
  // asserts a violation; it must never be read as `satisfied`.
  const partiallySatisfied =
    /\b(partially|partly|half|mostly)\b[^.\n]{0,20}\bsatisf/.test(normalized) ||
    /\bnot\s+fully\s+satisf/.test(normalized);
  if (partiallySatisfied) return "unknown";

  const negatedSatisfied = /\b(not|never|no|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|didn'?t)\b[^.\n]{0,12}\bsatisf/.test(
    normalized,
  );
  const negatedViolated = /\b(not|never|no|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|didn'?t)\b[^.\n]{0,12}\bviolat/.test(
    normalized,
  );
  const hasUnsatisfied = /\bunsatisfied\b/.test(normalized);
  const hasViolated = /\bviolated\b/.test(normalized);
  const hasSatisfied = /\bsatisfied\b/.test(normalized);

  if (negatedSatisfied) return "violated";
  if (negatedViolated) return "satisfied";
  if (hasUnsatisfied) return "violated";
  if (hasViolated && !hasSatisfied) return "violated";
  if (hasSatisfied && !hasViolated) return "satisfied";
  // Conflicting or unrecognised wording stays unknown: it is never silently
  // converted into positive satisfaction.
  return "unknown";
}

const SATISFIED_STATES: ReadonlySet<string> = new Set([
  "satisfied",
  "pass",
  "passed",
  "met",
  "ok",
  "complete",
  "completed",
]);
const VIOLATED_STATES: ReadonlySet<string> = new Set([
  "violated",
  "unsatisfied",
  "not satisfied",
  "fail",
  "failed",
  "unmet",
  "not met",
  "missing",
]);
const UNKNOWN_STATES: ReadonlySet<string> = new Set([
  "partial",
  "partially satisfied",
  "partly satisfied",
  "inconclusive",
  "unknown",
  "unclear",
  "n/a",
  "na",
  "none",
]);

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
  /** Structured outcome of every run-level mandatory gate. */
  runGates: GateResult[];
  /**
   * Per-claim admission (Profile B). Each dimension is separate; only
   * `consumerAdmitted` means a claim may reach a consumer.
   */
  claimAdmissions: ClaimAdmission[];
  /** The result contract satisfied its schema. */
  contractValid: boolean;
  contractErrors: string[];
  diagnostics: string[];
  // Profile A finding scoring — structured output, no invented B-style verdicts.
  profileA: ProfileAOutput;
  // Independent original reported-claim accounting (WP5).
  reportedClaims: ReportedClaimAccounting;
}

export interface ProfileAFindingOutput {
  /** External display identity exactly as delivered (never rewritten). */
  findingId: string;
  /** Internal occurrence identity derived from run/candidate/snapshot/index. */
  occurrenceId: string;
  /** Position of this occurrence in the native output. */
  occurrenceIndex: number;
  /** The external findingId is shared by another occurrence. */
  findingIdAmbiguous: boolean;
  occurrenceProvenanceComplete: boolean;
  missingOccurrenceProvenance: string[];
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
  /**
   * True when this finding's (criterion, reference) pair is also claimed by
   * another finding and no finding-scoped support decision exists, so semantic
   * support cannot be attributed to this finding individually.
   */
  supportAmbiguous: boolean;
  /**
   * A cited reference explicitly contradicts this claim while another cited
   * reference supports it. The finding is not supported and is never admitted;
   * the references, their judgments and the diagnostics stay intact.
   */
  evidenceConflict: boolean;
  /** References whose explicit judgment is `contradictsClaim` for this claim. */
  contradictoryReferences: string[];
  truthComparison: "matches" | "contradicts" | "neutral" | "n/a";
  /**
   * This occurrence is counted in the summary as a supported detection. It is
   * true only when the finding passed every individual admission and support
   * gate the scorer can evaluate — delivered and mapped, resolved references,
   * no ambiguous support, no explicit evidence conflict, no duplicate criterion
   * claim, and established semantic support — and Truth records the mapped
   * criterion as violated. A supporting citation alone is never enough: an
   * explicitly contradicting citation cancels it, exactly as it does for
   * admission.
   */
  supportedDetection: boolean;
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
    /** Findings whose shared (criterion, reference) pair has no finding-scoped support decision. */
    ambiguousSupport: number;
    /** Findings carrying both a supporting and an explicitly contradicting reference. */
    evidenceConflicts: number;
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
  /** The artifact names this result contract's candidate materialization. */
  candidateBound: boolean;
  /** The artifact names this result contract's runtime snapshot. */
  snapshotBound: boolean;
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
      candidateBound: false,
      snapshotBound: false,
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
      candidateBound: false,
      snapshotBound: false,
      mechanicallyValid: false,
      reason: "reference not in artifact registry",
    };
  }
  const candidateBound = artifact.candidateBinding === rc.candidate.repositoryMaterializationId;
  const snapshotBound = artifact.snapshotDigest === rc.candidate.runtimeSnapshotDigest;
  const tied = candidateBound && snapshotBound;
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
    candidateBound,
    snapshotBound,
    mechanicallyValid,
    reason,
  };
}

interface ResolvedFindingReference extends ResolvedReference {
  supportsBehavior: boolean;
  /** An explicit judgment attached to this citation contradicts the claim. */
  contradictsClaim: boolean;
  /** Why this claim is or is not supported by this reference. */
  supportReason: string;
  /** The support judgment is ambiguous because the pair is shared by findings. */
  supportAmbiguous: boolean;
}

function resolveFindingReferences(
  refs: string[] | undefined,
  rc: ResultContract,
  registry: ArtifactRegistry | undefined,
  support: SupportSource,
  criterionId: string | null,
  finding?: FindingSupportRef,
  sharedPairs?: Map<string, string[]>,
): ResolvedFindingReference[] {
  const out: ResolvedFindingReference[] = [];
  for (const ref of refs ?? []) {
    const resolved = resolveReference(ref, rc, registry);
    const shared = criterionId === null ? undefined : sharedPairs?.get(claimSupportKey(criterionId, ref));
    const lookup = lookupClaimSupport(support, criterionId, ref, finding, shared);
    const supportsBehavior =
      resolved.mechanicallyValid && lookup.decision !== null && isReferenceSupporting(lookup.decision);
    // Contradiction is a separate, explicit judgment: a decision that merely
    // fails to support is not a contradiction, and an unresolvable reference is
    // never treated as one.
    const contradictsClaim =
      resolved.mechanicallyValid && lookup.decision !== null && lookup.decision.contradictsClaim;
    out.push({
      ...resolved,
      supportsBehavior,
      contradictsClaim,
      supportReason: lookup.reason,
      supportAmbiguous: lookup.ambiguous === true,
    });
  }
  return out;
}

/**
 * Per-claim admission. Every dimension is computed independently and reported
 * separately; `consumerAdmitted` is the only field that means "may reach a
 * consumer", and the original claim survives every rejection.
 */
function computeClaimAdmissions(ctx: {
  rc: ResultContract;
  runGates: readonly GateResult[];
  executionAdmissible: boolean;
  evidenceApplicable: boolean;
  expectedCriteriaRevision: string;
  expectedCriteriaContentDigest: string;
  registry: ArtifactRegistry | undefined;
  support: SupportSource;
}): ClaimAdmission[] {
  const { rc } = ctx;
  const duplicateIds = new Set(rc.coverage.duplicateIds);
  const unknownIds = new Set(rc.coverage.unknownIds);
  const claimsPerCriterion = new Map<string, number>();
  for (const a of rc.assessments) {
    claimsPerCriterion.set(a.expectedCriterionId, (claimsPerCriterion.get(a.expectedCriterionId) ?? 0) + 1);
  }

  return rc.assessments.map((a) => {
    const criterionId = a.expectedCriterionId;
    const diagnostics: string[] = [...(a.diagnostics ?? [])];
    const refs = a.references ?? [];
    const supporting: boolean[] = [];
    const contradictoryReferences: string[] = [];
    let candidateBound = refs.length > 0;
    let snapshotBound = refs.length > 0;
    let referenceValid = refs.length > 0;

    for (const ref of refs) {
      const resolved = resolveReference(ref, rc, ctx.registry);
      const lookup = lookupClaimSupport(ctx.support, criterionId, ref);
      supporting.push(resolved.mechanicallyValid && lookup.decision !== null && isReferenceSupporting(lookup.decision));
      if (resolved.mechanicallyValid && lookup.decision !== null && lookup.decision.contradictsClaim) {
        contradictoryReferences.push(ref);
      }
      if (!resolved.candidateBound) {
        candidateBound = false;
        diagnostics.push(`${criterionId}: reference ${ref} is bound to a different candidate`);
      }
      if (!resolved.snapshotBound) {
        snapshotBound = false;
        diagnostics.push(`${criterionId}: reference ${ref} is bound to a different snapshot`);
      }
      if (!resolved.mechanicallyValid) {
        referenceValid = false;
        diagnostics.push(`${criterionId}: reference ${ref} — ${resolved.reason}`);
      }
      if (resolved.mechanicallyValid && lookup.decision === null) {
        diagnostics.push(`${criterionId}: reference ${ref} — ${lookup.reason}`);
      }
    }

    const evidenceConflict = contradictoryReferences.length > 0 && supporting.some(Boolean);
    if (evidenceConflict) {
      diagnostics.push(
        `${criterionId}: contradictory evidence conflicts with the supporting reference(s): ${contradictoryReferences.join(", ")}`,
      );
    }

    // Semantic support is about the cited artifacts, not the conclusion string:
    // a missing conclusion is reported by its own `semantic-conclusion` gate.
    const referenceSufficient = supporting.some(Boolean) && !evidenceConflict;
    const semanticConclusionAdmitted = ctx.executionAdmissible && a.admittedConclusion !== null;
    const claimAssociationValid =
      rc.criteria.expectedCriterionIds.includes(criterionId) &&
      !duplicateIds.has(criterionId) &&
      !unknownIds.has(criterionId) &&
      (claimsPerCriterion.get(criterionId) ?? 0) === 1;
    const criteriaRevisionBound = rc.criteria.authoredCriteriaRevision === ctx.expectedCriteriaRevision;
    const criteriaContentBound = rc.criteria.criteriaTextDigest === ctx.expectedCriteriaContentDigest;
    const conflictStatus: "none" | AssessmentConflictKind = a.conflict?.kind ?? "none";
    const conflictGroup = a.conflict?.group ?? null;

    if (!claimAssociationValid) {
      diagnostics.push(`${criterionId}: claim association is not valid (duplicate, unknown or outside the inventory)`);
    }
    if (a.admittedConclusion !== null && refs.length === 0) {
      diagnostics.push(`${criterionId}: conclusion cites no reference`);
    }
    if (a.conflict) {
      diagnostics.push(`conflict group ${a.conflict.group} (${a.conflict.kind}): ${a.conflict.reason}`);
    }

    // Claim-level gates. Run-level gates are shared with the aggregate decision
    // and with Profile A, so the same mandatory gate cannot be enforced here and
    // omitted there.
    const claimGates: GateResult[] = [
      booleanGate({
        id: "claim-association",
        scope: "claim",
        passed: claimAssociationValid,
        source: "result-contract.assessments vs coverage/expected inventory",
        passReason: `criterion ${criterionId} is claimed exactly once and is in the expected inventory`,
        failReason: `invalid claim association (duplicate, unknown or outside the inventory) for ${criterionId}`,
      }),
      refs.length === 0
        ? notApplicableGate(
            "candidate-binding",
            "claim",
            "result-contract.assessments[].references",
            "the claim cites no reference to bind",
          )
        : booleanGate({
            id: "candidate-binding",
            scope: "claim",
            passed: candidateBound,
            source: "artifact registry candidateBinding",
            passReason: "every cited artifact is bound to this candidate",
            failReason: "candidate binding mismatch",
          }),
      refs.length === 0
        ? notApplicableGate(
            "snapshot-binding",
            "claim",
            "result-contract.assessments[].references",
            "the claim cites no reference to bind",
          )
        : booleanGate({
            id: "snapshot-binding",
            scope: "claim",
            passed: snapshotBound,
            source: "artifact registry snapshotDigest",
            passReason: "every cited artifact is bound to this snapshot",
            failReason: "snapshot binding mismatch",
          }),
      refs.length === 0
        ? failGate("reference-validity", "claim", "result-contract.assessments[].references", "conclusion cites no reference")
        : booleanGate({
            id: "reference-validity",
            scope: "claim",
            passed: referenceValid,
            source: "artifact registry resolution",
            passReason: "every cited artifact resolves as allowed, current and applicable",
            failReason: "invalid reference",
          }),
      booleanGate({
        id: "evidence-conflict",
        scope: "claim",
        passed: !evidenceConflict,
        source: "rubric contradictions",
        passReason: "no cited reference contradicts this claim",
        failReason: `contradictory evidence conflicts with supporting evidence: ${contradictoryReferences.join(", ")}`,
      }),
      booleanGate({
        id: "reference-sufficiency",
        scope: "claim",
        passed: referenceSufficient,
        source: "claim-scoped semantic support decisions",
        passReason: "at least one cited artifact semantically supports the claim",
        failReason: "insufficient reference support",
      }),
      booleanGate({
        id: "semantic-conclusion",
        scope: "claim",
        passed: semanticConclusionAdmitted,
        source: "result-contract.assessments[].admittedConclusion",
        passReason: "an admissible semantic conclusion exists",
        failReason: "no admitted semantic conclusion",
      }),
      a.conflict === undefined
        ? passGate("conflict-status", "claim", "provider duplicate classification", "no duplicate/conflict group")
        : failGate(
            "conflict-status",
            "claim",
            "provider duplicate classification",
            `criterion ${criterionId} is part of conflict group ${a.conflict.group} (${a.conflict.kind}); no occurrence is admitted`,
          ),
    ];

    const outcome = decide([...ctx.runGates, ...claimGates], "admitted");

    return {
      criterionId,
      originalReportedClaim: a.originalReportedClaim,
      parsedClaim: parseReportedClaim(a.originalReportedClaim),
      contractValid: ctx.runGates.find((g) => g.id === "contract-schema")?.status === "pass",
      executionAdmissible: ctx.executionAdmissible,
      evidenceApplicable: ctx.evidenceApplicable,
      criteriaRevisionBound,
      criteriaContentBound,
      candidateBound,
      snapshotBound,
      referenceValid,
      referenceSufficient,
      claimAssociationValid,
      semanticConclusionAdmitted,
      consumerAdmitted: outcome.admitted,
      reason: outcome.reason,
      diagnostics,
      gates: outcome.gates,
      primaryFailureGate: outcome.primaryFailureGate,
      conflictStatus,
      conflictGroup,
      evidenceConflict,
      contradictoryReferences,
    };
  });
}

function computeReportedClaimAccounting(
  rc: ResultContract,
  truthOutcomes: Record<string, boolean>,
  truthBindingValid: boolean,
  registry: ArtifactRegistry | undefined,
  admissible: boolean,
  claimAdmissions: readonly ClaimAdmission[],
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

  for (let index = 0; index < rc.assessments.length; index++) {
    const a = rc.assessments[index];
    const claimAdmission = claimAdmissions[index];
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
      const resolved = resolveFindingReferences(a.references, rc, registry, {}, a.expectedCriterionId);
      referenceValid = resolved.some((r) => r.mechanicallyValid);
    }

    const semanticConclusionAdmitted = admissible && a.admittedConclusion !== null;
    if (semanticConclusionAdmitted) admittedSemanticConclusions++;
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
      semanticConclusionAdmitted,
      consumerAdmitted: claimAdmission?.consumerAdmitted === true,
      consumerAdmissionReason: claimAdmission?.reason ?? "no claim admission computed",
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
  support: SupportSource,
  truthBindingValid: boolean,
): ProfileAOutput {
  const findings: ProfileAFindingOutput[] = [];
  const mappedFindings: { occurrenceId: string; findingId: string; criterionId: string }[] = [];

  // How many raw occurrences carry each external finding id. An id used by more
  // than one occurrence cannot identify any one of them.
  const findingIdCounts = new Map<string, number>();
  rc.findings.forEach((f, i) => {
    const id = f.findingId ?? `finding-${i}`;
    findingIdCounts.set(id, (findingIdCounts.get(id) ?? 0) + 1);
  });

  // Which delivered finding OCCURRENCES claim each (criterion, reference) pair.
  // Keying by occurrence (not by the colliding display id) keeps the sharing
  // accounting exact. A pair claimed by more than one occurrence cannot inherit
  // a single support judgment.
  const sharedPairs = new Map<string, string[]>();
  rc.findings.forEach((f, i) => {
    if (f.skipped) return;
    if (f.normalizedFinding === null && (f.nativeComment ?? "").trim().length > 0) return;
    const mapped = f.criterionMapping;
    if (mapped === null || mapped === undefined || !rc.criteria.expectedCriterionIds.includes(mapped)) return;
    const occurrenceId = findingOccurrenceIdentity(rc, i).occurrenceId;
    for (const ref of f.references ?? []) {
      const key = claimSupportKey(mapped, ref);
      const list = sharedPairs.get(key) ?? [];
      if (!list.includes(occurrenceId)) list.push(occurrenceId);
      sharedPairs.set(key, list);
    }
  });

  let deliveredCount = 0;
  let mappedCount = 0;
  let unmappedCount = 0;
  let outOfScopeCount = 0;
  let skippedCount = 0;
  let normalizationDroppedCount = 0;
  let falseAllegations = 0;

  for (let i = 0; i < rc.findings.length; i++) {
    const f = rc.findings[i];
    const findingId = f.findingId ?? `finding-${i}`;
    const occurrence = findingOccurrenceIdentity(rc, i);
    const occurrenceId = occurrence.occurrenceId;
    const findingIdAmbiguous = (findingIdCounts.get(findingId) ?? 0) > 1;
    const supportRef: FindingSupportRef = { findingId, occurrenceId, findingIdAmbiguous };
    const nativeComment = f.nativeComment;

    if (f.skipped) {
      skippedCount++;
      findings.push({
        findingId,
        occurrenceId,
        occurrenceIndex: i,
        findingIdAmbiguous,
        occurrenceProvenanceComplete: occurrence.provenanceComplete,
        missingOccurrenceProvenance: occurrence.missingProvenance,
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
        supportAmbiguous: false,
        evidenceConflict: false,
        contradictoryReferences: [],
        truthComparison: "n/a",
        supportedDetection: false,
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
        occurrenceId,
        occurrenceIndex: i,
        findingIdAmbiguous,
        occurrenceProvenanceComplete: occurrence.provenanceComplete,
        missingOccurrenceProvenance: occurrence.missingProvenance,
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
        supportAmbiguous: false,
        evidenceConflict: false,
        contradictoryReferences: [],
        truthComparison: "n/a",
        supportedDetection: false,
        qualityFlags: f.qualityFlags,
        diagnostics: ["normalization dropped the raw native finding"],
      });
      continue;
    }

    deliveredCount++;
    const findingDiagnostics: string[] = [];

    let mappingStatus: "mapped" | "unmapped" | "out-of-scope" = "unmapped";
    let criterionMapping: string | null = null;
    if (f.criterionMapping !== null && f.criterionMapping !== undefined) {
      const mappedId = f.criterionMapping;
      if (rc.criteria.expectedCriterionIds.includes(mappedId)) {
        mappingStatus = "mapped";
        criterionMapping = mappedId;
        mappedCount++;
        mappedFindings.push({ occurrenceId, findingId, criterionId: mappedId });
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

    // Support is resolved for THIS finding's mapped criterion only. A positive
    // judgment about the file never spreads to another finding/criterion.
    const resolvedRefs = resolveFindingReferences(
      f.references,
      rc,
      registry,
      support,
      criterionMapping,
      supportRef,
      sharedPairs,
    );
    // A colliding display id is diagnosed above, but support is only ambiguous
    // when resolution could not actually bind a judgment to this occurrence.
    const supportAmbiguous = resolvedRefs.some((r) => r.supportAmbiguous);
    if (findingIdAmbiguous) {
      findingDiagnostics.push(
        `external finding id ${findingId} is shared by ${findingIdCounts.get(findingId)} occurrences; a decision bound only to that id cannot disambiguate them`,
      );
    }
    if (resolvedRefs.some((r) => r.supportAmbiguous)) {
      findingDiagnostics.push(
        "semantic support is ambiguous: the criterion and reference are shared with another finding and no finding-scoped decision exists",
      );
    }
    for (const r of resolvedRefs) {
      findingDiagnostics.push(`reference ${r.reference}: ${r.reason}`);
      if (r.mechanicallyValid && !r.supportsBehavior) {
        findingDiagnostics.push(`criterion ${criterionMapping}: ${r.supportReason}`);
      }
    }

    let referenceValidity: "valid" | "invalid" | "unknown";
    if (resolvedRefs.length === 0) referenceValidity = "unknown";
    else if (resolvedRefs.some((r) => r.mechanicallyValid)) referenceValidity = "valid";
    else referenceValidity = "invalid";

    const anySupporting = resolvedRefs.some((r) => r.mechanicallyValid && r.supportsBehavior);
    const contradictoryReferences = resolvedRefs
      .filter((r) => r.mechanicallyValid && r.contradictsClaim)
      .map((r) => r.reference);
    // The same explicit-contradiction rule Profile B applies to a claim: a
    // supporting reference plus an explicitly contradicting one is a conflict,
    // not support. A positive reference never overrides the contradiction, and
    // a listed reference is never dropped. Only an explicit `contradictsClaim`
    // judgment triggers this; neutral or missing support never does.
    const evidenceConflict = contradictoryReferences.length > 0 && anySupporting;
    if (evidenceConflict) {
      findingDiagnostics.push(
        `explicit contradiction conflicts with the supporting reference(s): ${contradictoryReferences.join(", ")}`,
      );
    }

    let semanticSupport: "supported" | "unsupported" | "neutral";
    if (mappingStatus !== "mapped" || resolvedRefs.length === 0) semanticSupport = "neutral";
    else if (evidenceConflict) semanticSupport = "unsupported";
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
        // A supporting citation alone does not make this a detection. The
        // conflict and ambiguity gates are reported here; the duplicate-mapping
        // gate is only known after the pass below, so the positive diagnostic
        // is emitted there once every gate has been applied.
        if (evidenceConflict) {
          findingDiagnostics.push(
            `mapped to truth-violated criterion ${criterionMapping} → not a supported detection: explicit contradiction from ${contradictoryReferences.join(", ")}`,
          );
        } else if (supportAmbiguous) {
          findingDiagnostics.push(
            `mapped to truth-violated criterion ${criterionMapping} → not a supported detection: semantic support is ambiguous`,
          );
        } else if (!anySupporting) {
          findingDiagnostics.push(
            `mapped to truth-violated criterion ${criterionMapping} → detection without a supporting reference`,
          );
        }
      }
    } else if (mappingStatus === "mapped") {
      findingDiagnostics.push("truth binding invalid → truth comparison suspended");
    }

    // Accounting follows the gates, not the raw citation: an occurrence whose
    // support was rejected (conflict, ambiguity, absent support) is not counted
    // even when another cited reference is positive.
    const supportedDetection =
      truthComparison === "matches" && semanticSupport === "supported" && !supportAmbiguous;

    findings.push({
      findingId,
      occurrenceId,
      occurrenceIndex: i,
      findingIdAmbiguous,
      occurrenceProvenanceComplete: occurrence.provenanceComplete,
      missingOccurrenceProvenance: occurrence.missingProvenance,
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
      supportAmbiguous,
      evidenceConflict,
      contradictoryReferences,
      truthComparison,
      supportedDetection,
      qualityFlags: f.qualityFlags,
      diagnostics: findingDiagnostics,
    });
  }

  // Duplicate/conflicting mappings: a criterion may not be claimed by more than
  // one delivered finding. Keep every occurrence visible and flag it by
  // occurrence identity, so colliding external ids cannot mislabel one another.
  const byCriterion = new Map<string, { occurrenceId: string; findingId: string }[]>();
  for (const m of mappedFindings) {
    const list = byCriterion.get(m.criterionId) ?? [];
    list.push({ occurrenceId: m.occurrenceId, findingId: m.findingId });
    byCriterion.set(m.criterionId, list);
  }
  let duplicateMappings = 0;
  for (const [criterionId, members] of byCriterion) {
    if (members.length > 1) {
      duplicateMappings += members.length;
      const occurrences = members.map((m) => m.occurrenceId);
      for (const finding of findings) {
        if (occurrences.includes(finding.occurrenceId)) {
          finding.duplicateMapping = true;
          finding.diagnostics.push(
            `duplicate/conflicting mapping: criterion ${criterionId} claimed by ${members
              .map((m) => `${m.findingId} (${m.occurrenceId})`)
              .join(", ")}`,
          );
        }
      }
    }
  }

  // Supported-detection accounting is settled only after every gate has been
  // applied, so a duplicate criterion claim can never be counted and a counted
  // occurrence always has a truthful positive diagnostic.
  for (const finding of findings) {
    if (finding.duplicateMapping) {
      if (finding.supportedDetection) {
        finding.supportedDetection = false;
        finding.diagnostics.push(
          `mapped to truth-violated criterion ${finding.criterionMapping} → not a supported detection: the criterion is claimed by more than one delivered finding`,
        );
      }
      continue;
    }
    if (finding.supportedDetection) {
      finding.diagnostics.push(
        `mapped to truth-violated criterion ${finding.criterionMapping} → supported detection`,
      );
    }
  }
  const supportedDetectionCount = findings.filter((f) => f.supportedDetection).length;

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
      supportedDetections: supportedDetectionCount,
      duplicateMappings,
      ambiguousSupport: findings.filter((f) => f.supportAmbiguous).length,
      evidenceConflicts: findings.filter((f) => f.evidenceConflict).length,
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

  // --- Schema validity and per-claim admission ---
  // Contract validity is its own dimension: a schema-valid contract can still
  // carry claims that must not reach a consumer, and vice versa.
  const contractErrors = validateResultContract(rc);
  const contractValid = contractErrors.length === 0;
  if (!contractValid) diagnostics.push(`result contract invalid: ${contractErrors.join("; ")}`);

  const expectedCriteriaRevision = input.expectedCriteriaRevision ?? rc.criteria.authoredCriteriaRevision;
  const expectedCriteriaContentDigest =
    input.expectedCriteriaContentDigest ?? rc.criteria.criteriaTextDigest;
  // Run-level gates are evaluated once, from the same definitions Profile A and
  // the aggregate decision use.
  const runGates = evaluateRunGates({
    contractValid,
    contractErrors,
    executionState: execState,
    supersededBy,
    executionAdmissible: admissible,
    evidenceApplicability: rc.evidence.applicability,
    authoredCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaRevision,
    criteriaTextDigest: rc.criteria.criteriaTextDigest,
    expectedCriteriaContentDigest,
    candidateMaterializationId: rc.candidate.repositoryMaterializationId,
    // Profile B binds evidence per claim against the artifact registry; the
    // scorer has no separate expected candidate at result scope, so the run-level
    // gate is explicitly not applicable rather than compared with itself.
    expectedCandidateBinding: null,
    runtimeSnapshotDigest: rc.candidate.runtimeSnapshotDigest,
    expectedSnapshotDigest: null,
  });
  const claimAdmissions = computeClaimAdmissions({
    rc,
    runGates,
    executionAdmissible: admissible,
    evidenceApplicable: rc.evidence.applicability === "applicable",
    expectedCriteriaRevision,
    expectedCriteriaContentDigest,
    registry: input.artifactRegistry,
    support: input,
  });

  // --- Label agreement (only for admissible execution) ---
  const labelAgreement: LabelAgreement[] = rc.assessments.map((a, index) => {
    const truth = truthBindingValid ? tb.truthOutcomes[a.expectedCriterionId] ?? null : null;
    const parsed = parseReportedClaim(a.originalReportedClaim);
    const claim = claimAdmissions[index];

    if (!admissible) {
      return {
        criterionId: a.expectedCriterionId,
        admittedConclusion: null,
        reportedClaim: parsed,
        truthOutcome: truth,
        agrees: null,
        semanticConclusionAdmitted: false,
        consumerAdmitted: claim?.consumerAdmitted === true,
        consumerAdmissionReason: claim?.reason ?? "execution not admissible",
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
      semanticConclusionAdmitted: admittedConclusion !== null,
      consumerAdmitted: claim?.consumerAdmitted === true,
      consumerAdmissionReason: claim?.reason ?? "no claim admission computed",
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
      const lookup = lookupClaimSupport(input, a.expectedCriterionId, ref);
      const supporting =
        resolved.mechanicallyValid && lookup.decision !== null && isReferenceSupporting(lookup.decision);
      semanticSupport.push({
        criterionId: a.expectedCriterionId,
        reference: ref,
        supporting,
        reason: !resolved.mechanicallyValid
          ? resolved.reason
          : lookup.decision === null
            ? lookup.reason
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
    input,
    truthBindingValid,
  );

  // --- Reported-claim accounting ---
  const reportedClaims = computeReportedClaimAccounting(
    rc,
    tb.truthOutcomes,
    truthBindingValid,
    input.artifactRegistry,
    admissible,
    claimAdmissions,
  );

  // --- Shared consumer admission ---
  const evidenceApplicable = rc.evidence.applicability === "applicable";
  const lifecycleValid = execState !== "cancelled" && supersededBy === null;
  const cancelledOrSuperseded = !lifecycleValid;
  // Explicitly resolve reference validity/sufficiency from the immutable
  // artifact registry instead of relying on consumerAdmit() defaults.
  const hasAssessmentReferences = rc.assessments.some((a) => a.references.length > 0);
  const allRefsValid = hasAssessmentReferences
    ? rc.assessments.every((a) =>
        a.references.length === 0 ||
        a.references.every((ref) => {
          const rv = referenceValidity.find((x) => x.criterionId === a.expectedCriterionId && x.reference === ref);
          return !!rv && rv.valid;
        }),
      )
    : null;
  // A conclusion that asserts a polarity must cite at least one reference: a
  // bare verdict is never sufficient evidence.
  const conclusionsWithoutReferences = rc.assessments.filter(
    (a) => a.admittedConclusion !== null && a.references.length === 0,
  ).length;
  let allRefsSufficient: boolean | null = hasAssessmentReferences
    ? rc.assessments.every((a) =>
        a.references.length === 0 ||
        a.references.every((ref) => {
          const ss = semanticSupport.find((x) => x.criterionId === a.expectedCriterionId && x.reference === ref);
          return !!ss && ss.supporting;
        }),
      )
    : null;
  if (conclusionsWithoutReferences > 0) allRefsSufficient = false;

  const binding: AssessmentBinding = {
    assessmentId: rc.contractId,
    // The binding describes the ASSESSMENT's bounded identity; the consumer's
    // independent revision is supplied separately below.
    criteriaRevision: rc.criteria.authoredCriteriaRevision,
    criteriaTextDigest: rc.criteria.criteriaTextDigest,
    candidateSnapshot: rc.candidate.runtimeSnapshotDigest,
    admitted: admissible && rc.assessments.every((a) => a.admittedConclusion !== null),
    reportedCriterionIds: rc.coverage.presentIds,
    admittedCriterionIds: rc.assessments
      .filter((a) => a.admittedConclusion !== null)
      .map((a) => a.expectedCriterionId),
    referenceValidity: allRefsValid,
    referenceSufficiency: allRefsSufficient,
  };
  const admission = consumerAdmit(
    binding,
    {
      // Same independent revision the per-claim decisions use. Using the
      // contract's own label here made the aggregate admit a result whose every
      // claim was rejected for a stale revision.
      revisionId: expectedCriteriaRevision,
      // The current content digest is the independently captured one when the
      // caller supplies it; comparing the contract's digest to itself would
      // never detect edited criteria under an unchanged revision label.
      textDigest: expectedCriteriaContentDigest,
      parentRevision: null,
    },
    rc.candidate.runtimeSnapshotDigest,
    rc.criteria.expectedCriterionIds,
    evidenceApplicable,
    cancelledOrSuperseded,
    admissible,
  );
  // The aggregate decision must also agree with the per-claim decisions: a
  // result can never be admitted while one of its required claims failed a
  // mandatory gate.
  const claimConsistencyGate = booleanGate({
    id: "claim-admission",
    scope: "aggregate",
    passed: claimAdmissions.every((c) => c.consumerAdmitted),
    source: "claimAdmissions",
    passReason: "every claim passed its own mandatory gates",
    failReason: `at least one claim failed a mandatory gate: ${claimAdmissions
      .filter((c) => !c.consumerAdmitted)
      .map((c) => `${c.criterionId} (${c.primaryFailureGate ?? c.reason})`)
      .join(", ")}`,
  });
  const aggregateOutcome = decide([...(admission.gates ?? []), claimConsistencyGate], "admitted");
  const finalAdmission: AdmissionDecision = {
    ...admission,
    admitted: aggregateOutcome.admitted,
    reason: aggregateOutcome.reason,
    gates: aggregateOutcome.gates,
    primaryFailureGate: aggregateOutcome.primaryFailureGate,
  };
  if (!finalAdmission.admitted) diagnostics.push(`consumer admission rejected: ${finalAdmission.reason}`);

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
    admission: finalAdmission,
    runGates,
    claimAdmissions,
    contractValid,
    contractErrors,
    diagnostics,
    profileA: profileAOutput,
    reportedClaims,
  };
}