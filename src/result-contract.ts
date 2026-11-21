/**
 * Experimental result contract (WP5).
 *
 * Minimal, model-free result contract for the Task Verification experiment.
 * Not a product-wide SDK schema. Joins frozen Ground Truth only after
 * assessment output is fixed; never an input to the reviewer or baseline.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

export const RESULT_CONTRACT_VERSION = "result-contract-v1";

// --- Subject ---

export interface SubjectIdentity {
  fixtureTaskId: string;
  expectedSubjectInventory: string[];
}

// --- Candidate ---

export interface CandidateIdentity {
  repositoryMaterializationId: string;
  baseTreeIdentity: string;
  headTreeIdentity: string;
  runtimeSnapshotDigest: string;
  opaqueFixtureId: string;
}

// --- Criteria ---

export interface CriteriaIdentity {
  authoredCriteriaRevision: string;
  criteriaTextDigest: string;
  expectedCriterionIds: string[];
  criterionToCheckMapping: Record<string, string[]>;
  policyVersion: string;
  policyDigest: string;
}

// --- Profile ---

export interface ProfileIdentity {
  profileId: string;
  configurationIdentity: string;
  promptIdentity: string;
  inputIdentity: string;
  requestedModel: string | null;
  observedModel: string | null;
  reasoningConfiguration: Record<string, unknown>;
  adapterEntryIdentity: string;
}

// --- Assessment (Profile B) ---

export type AdmittedConclusion = "satisfied" | "violated" | "inconclusive";

export interface AssessmentRecord {
  expectedCriterionId: string;
  present: boolean;
  originalReportedClaim: string | null;
  admittedConclusion: AdmittedConclusion | null;
  references: string[];
  explanation: string | null;
  diagnostics: string[];
  /**
   * Explicit duplicate/conflict state assigned by the decoder. Every member of
   * a conflicting group carries the same group identity: no member is selected
   * as a winner and none is admitted as an ordinary claim.
   */
  conflict?: AssessmentConflict;
}

export type AssessmentConflictKind =
  | "identical-duplicate"
  | "conflicting-duplicate"
  | "unclassified-duplicate";

export interface AssessmentConflict {
  /** Conflict-group identity shared by every occurrence of the criterion. */
  group: string;
  kind: AssessmentConflictKind;
  /** Number of provider records claiming this criterion. */
  occurrences: number;
  /** Provider record positions in the raw response, in provider order. */
  indexes: number[];
  reason: string;
}

// --- Findings (Profile A) ---

export interface FindingRecord {
  /** Stable delivered-finding identity. Optional for backward compatibility. */
  findingId?: string;
  nativeComment: string;
  normalizedFinding: string | null;
  skipped: boolean;
  skipReason: string | null;
  qualityFlags: string[];
  criterionMapping: string | null;
  /**
   * Mechanical source references the finding relies on. Optional for backward
   * compatibility; when present the scorer resolves each against the immutable
   * artifact registry instead of trusting Truth agreement.
   */
  references?: string[];
}

// --- Coverage ---

export interface CoverageRecord {
  expectedIds: string[];
  presentIds: string[];
  individuallyValidIds: string[];
  missingIds: string[];
  duplicateIds: string[];
  unknownIds: string[];
  invalidIds: string[];
  wholeInventoryAdmitted: boolean;
}

// --- Execution ---

export type ExecutionState = "completed" | "partial" | "cancelled" | "failed" | "unknown";

export interface ExecutionRecord {
  state: ExecutionState;
  slotId: string;
  runId: string;
  attemptId: string;
  requestId: string;
  sdkEffectCode: string | null;
  diagnostics: string[];
  pendingEffects: string[];
  cleanupStatus: "clean" | "pending" | "failed" | "unknown";
  /** Present when the attempt was superseded by a later attempt. */
  supersededBy?: string | null;
}

// --- Raw artifact ---

export interface RawArtifactRecord {
  available: boolean;
  rawText: string | null;
  rawBytesDigest: string | null;
  rawUnavailableCause: string | null;
}

// --- Evidence ---

export interface EvidenceRecord {
  producer: string;
  candidateBinding: string;
  checkDefinition: string;
  inputScope: string;
  environment: string;
  observationOutcome: string;
  completeness: string;
  timestamps: string[];
  references: string[];
  applicability: string;
  provenance: string;
}

// --- Usage ---

export interface UsageRecord {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  cost: number | null;
  currency: string | null;
  requestedModel: string | null;
  observedModel: string | null;
  capacityObservations: string[];
}

// --- Capacity ---

export interface CapacityRecord {
  durableFactCapacity: string | null;
  retentionPolicy: string | null;
}

// --- Full contract ---

export interface ResultContract {
  contractId: string;
  version: string;
  subject: SubjectIdentity;
  candidate: CandidateIdentity;
  criteria: CriteriaIdentity;
  profile: ProfileIdentity;
  assessments: AssessmentRecord[];
  findings: FindingRecord[];
  coverage: CoverageRecord;
  execution: ExecutionRecord;
  rawArtifact: RawArtifactRecord;
  evidence: EvidenceRecord;
  usage: UsageRecord;
  capacity: CapacityRecord;
}

// --- Validation helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isFiniteNonNegativeOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

/** Git tree/commit ids are 40 hex chars; sha256 digests are 64. Accept either. */
function isDigestLike(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

const EXECUTION_STATES: readonly ExecutionState[] = ["completed", "partial", "cancelled", "failed", "unknown"];
const CLEANUP_STATES = ["clean", "pending", "failed", "unknown"] as const;
const ADMITTED_CONCLUSIONS: readonly AdmittedConclusion[] = ["satisfied", "violated", "inconclusive"];
const APPLICABILITY_VALUES = ["applicable", "stale", "unavailable", "invalid", "not-applicable"] as const;

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const v of a) counts.set(v, (counts.get(v) ?? 0) + 1);
  for (const v of b) {
    const n = counts.get(v) ?? 0;
    if (n === 0) return false;
    counts.set(v, n - 1);
  }
  return true;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return false;
  return b.every((v) => set.has(v));
}

/**
 * Validate a result contract.
 *
 * Returns a list of structured errors (empty = valid). The function never
 * throws on malformed nested input; every section is checked defensively.
 *
 * Coverage is recomputed from the actual assessment IDs and compared to the
 * stored coverage record. Missing, duplicate, unknown and invalid IDs are
 * distinguished. `wholeInventoryAdmitted` must agree with the recomputation.
 */
export function validateResultContract(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["result contract must be an object"];
  const rc = input;

  // 1. Contract identity and schema version.
  if (!isNonEmptyString(rc.contractId)) errors.push("missing or invalid contractId");
  if (rc.version !== RESULT_CONTRACT_VERSION) errors.push(`bad version: ${String(rc.version)}`);

  // 2. Subject identity and expected subject inventory.
  if (!isRecord(rc.subject)) {
    errors.push("subject must be an object");
  } else {
    const s = rc.subject;
    if (!isNonEmptyString(s.fixtureTaskId)) errors.push("missing or invalid subject.fixtureTaskId");
    if (!isStringArray(s.expectedSubjectInventory)) {
      errors.push("subject.expectedSubjectInventory must be an array of strings");
    } else if (new Set(s.expectedSubjectInventory).size !== s.expectedSubjectInventory.length) {
      errors.push("subject.expectedSubjectInventory contains duplicates");
    }
  }

  // 3. Candidate repository/materialization identity.
  if (!isRecord(rc.candidate)) {
    errors.push("candidate must be an object");
  } else {
    const c = rc.candidate;
    if (!isNonEmptyString(c.repositoryMaterializationId)) {
      errors.push("missing or invalid candidate.repositoryMaterializationId");
    }
    if (!isDigestLike(c.baseTreeIdentity)) errors.push("candidate.baseTreeIdentity must be a hex digest");
    if (!isDigestLike(c.headTreeIdentity)) errors.push("candidate.headTreeIdentity must be a hex digest");
    if (!isDigestLike(c.runtimeSnapshotDigest)) errors.push("candidate.runtimeSnapshotDigest must be a hex digest");
    if (!isNonEmptyString(c.opaqueFixtureId)) errors.push("missing or invalid candidate.opaqueFixtureId");
  }

  // 4. Criteria identity, exact inventory, mapping and policy.
  if (!isRecord(rc.criteria)) {
    errors.push("criteria must be an object");
  } else {
    const cr = rc.criteria;
    if (!isNonEmptyString(cr.authoredCriteriaRevision)) {
      errors.push("missing or invalid criteria.authoredCriteriaRevision");
    }
    if (!isDigestLike(cr.criteriaTextDigest)) errors.push("criteria.criteriaTextDigest must be a hex digest");
    if (!isStringArray(cr.expectedCriterionIds)) {
      errors.push("criteria.expectedCriterionIds must be an array of strings");
    } else if (new Set(cr.expectedCriterionIds).size !== cr.expectedCriterionIds.length) {
      errors.push("criteria.expectedCriterionIds contains duplicates");
    }
    if (!isRecord(cr.criterionToCheckMapping)) {
      errors.push("criteria.criterionToCheckMapping must be an object");
    } else {
      for (const [key, value] of Object.entries(cr.criterionToCheckMapping)) {
        if (!isStringArray(value)) {
          errors.push(`criteria.criterionToCheckMapping[${key}] must be an array of strings`);
        }
      }
    }
    if (!isNonEmptyString(cr.policyVersion)) errors.push("missing or invalid criteria.policyVersion");
    if (!isDigestLike(cr.policyDigest)) errors.push("criteria.policyDigest must be a hex digest");
  }

  // 5. Profile and configuration/prompt/input identities.
  if (!isRecord(rc.profile)) {
    errors.push("profile must be an object");
  } else {
    const p = rc.profile;
    if (!isNonEmptyString(p.profileId)) errors.push("missing or invalid profile.profileId");
    if (!isNonEmptyString(p.configurationIdentity)) {
      errors.push("missing or invalid profile.configurationIdentity");
    }
    if (!isNonEmptyString(p.promptIdentity)) errors.push("missing or invalid profile.promptIdentity");
    if (!isNonEmptyString(p.inputIdentity)) errors.push("missing or invalid profile.inputIdentity");
    if (!isNullableString(p.requestedModel)) errors.push("profile.requestedModel must be string or null");
    if (!isNullableString(p.observedModel)) errors.push("profile.observedModel must be string or null");
    if (!isRecord(p.reasoningConfiguration)) errors.push("profile.reasoningConfiguration must be an object");
    if (!isNonEmptyString(p.adapterEntryIdentity)) {
      errors.push("missing or invalid profile.adapterEntryIdentity");
    }
  }

  // 6. Assessment records: shape, enums, original claim preservation.
  const assessmentIds: string[] = [];
  if (!Array.isArray(rc.assessments)) {
    errors.push("assessments must be an array");
  } else {
    for (let i = 0; i < rc.assessments.length; i++) {
      const a: unknown = rc.assessments[i];
      if (!isRecord(a)) {
        errors.push(`assessments[${i}] must be an object`);
        continue;
      }
      if (!isNonEmptyString(a.expectedCriterionId)) {
        errors.push(`assessments[${i}].expectedCriterionId is required`);
      } else {
        assessmentIds.push(a.expectedCriterionId);
      }
      if (typeof a.present !== "boolean") errors.push(`assessments[${i}].present must be boolean`);
      if (!isNullableString(a.originalReportedClaim)) {
        errors.push(`assessments[${i}].originalReportedClaim must be string or null`);
      }
      if (
        a.admittedConclusion !== null &&
        !ADMITTED_CONCLUSIONS.includes(a.admittedConclusion as AdmittedConclusion)
      ) {
        errors.push(`assessments[${i}].admittedConclusion must be satisfied/violated/inconclusive or null`);
      }
      if (!isStringArray(a.references)) errors.push(`assessments[${i}].references must be an array of strings`);
      if (!isNullableString(a.explanation)) errors.push(`assessments[${i}].explanation must be string or null`);
      if (!isStringArray(a.diagnostics)) errors.push(`assessments[${i}].diagnostics must be an array of strings`);
    }
  }

  // 7. Finding records: shape, skipped reason, criterion mapping.
  if (!Array.isArray(rc.findings)) {
    errors.push("findings must be an array");
  } else {
    for (let i = 0; i < rc.findings.length; i++) {
      const f: unknown = rc.findings[i];
      if (!isRecord(f)) {
        errors.push(`findings[${i}] must be an object`);
        continue;
      }
      if (f.findingId !== undefined && !isNonEmptyString(f.findingId)) {
        errors.push(`findings[${i}].findingId must be a non-empty string when present`);
      }
      if (!isNonEmptyString(f.nativeComment)) errors.push(`findings[${i}].nativeComment must be a string`);
      if (!isNullableString(f.normalizedFinding)) {
        errors.push(`findings[${i}].normalizedFinding must be string or null`);
      }
      if (typeof f.skipped !== "boolean") errors.push(`findings[${i}].skipped must be boolean`);
      if (!isNullableString(f.skipReason)) errors.push(`findings[${i}].skipReason must be string or null`);
      if (f.skipped === true && !isNonEmptyString(f.skipReason)) {
        errors.push(`findings[${i}].skipReason must be a non-empty string when skipped`);
      }
      if (!isStringArray(f.qualityFlags)) errors.push(`findings[${i}].qualityFlags must be an array of strings`);
      if (!isNullableString(f.criterionMapping)) {
        errors.push(`findings[${i}].criterionMapping must be string or null`);
      }
      if (f.references !== undefined && !isStringArray(f.references)) {
        errors.push(`findings[${i}].references must be an array of strings when present`);
      }
    }
  }

  // 8. Coverage: recompute from actual assessment IDs and compare.
  if (!isRecord(rc.coverage)) {
    errors.push("missing coverage");
  } else {
    const cov = rc.coverage;
    const arrayFields = [
      "expectedIds",
      "presentIds",
      "individuallyValidIds",
      "missingIds",
      "duplicateIds",
      "unknownIds",
      "invalidIds",
    ] as const;
    for (const field of arrayFields) {
      if (!isStringArray(cov[field])) errors.push(`coverage.${field} must be an array of strings`);
    }
    if (typeof cov.wholeInventoryAdmitted !== "boolean") {
      errors.push("coverage.wholeInventoryAdmitted must be boolean");
    }

    const expected = isRecord(rc.criteria) && isStringArray(rc.criteria.expectedCriterionIds)
      ? rc.criteria.expectedCriterionIds
      : [];
    const recomputed = computeCoverage(expected, assessmentIds);

    if (isStringArray(cov.expectedIds) && !sameMultiset(cov.expectedIds, expected)) {
      errors.push("coverage.expectedIds disagrees with criteria.expectedCriterionIds");
    }
    if (isStringArray(cov.presentIds) && !sameMultiset(cov.presentIds, assessmentIds)) {
      errors.push("coverage.presentIds disagrees with assessment IDs");
    }
    if (isStringArray(cov.missingIds) && !sameSet(cov.missingIds, recomputed.missingIds)) {
      errors.push("coverage.missingIds disagrees with recomputed missing IDs");
    }
    if (isStringArray(cov.duplicateIds) && !sameSet(cov.duplicateIds, recomputed.duplicateIds)) {
      errors.push("coverage.duplicateIds disagrees with recomputed duplicate IDs");
    }
    if (isStringArray(cov.unknownIds) && !sameSet(cov.unknownIds, recomputed.unknownIds)) {
      errors.push("coverage.unknownIds disagrees with recomputed unknown IDs");
    }
    if (isStringArray(cov.invalidIds) && !sameSet(cov.invalidIds, recomputed.invalidIds)) {
      errors.push("coverage.invalidIds disagrees with recomputed invalid IDs");
    }
    if (isStringArray(cov.individuallyValidIds) && !sameMultiset(cov.individuallyValidIds, recomputed.individuallyValidIds)) {
      errors.push("coverage.individuallyValidIds disagrees with recomputed individually valid IDs");
    }
    if (typeof cov.wholeInventoryAdmitted === "boolean" && cov.wholeInventoryAdmitted !== recomputed.wholeInventoryAdmitted) {
      errors.push(
        `coverage: wholeInventoryAdmitted(${cov.wholeInventoryAdmitted}) disagrees with recomputed result(${recomputed.wholeInventoryAdmitted})`,
      );
    }
  }

  // 9. Execution state, identity fields and cleanup state.
  if (!isRecord(rc.execution)) {
    errors.push("execution must be an object");
  } else {
    const e = rc.execution;
    if (!EXECUTION_STATES.includes(e.state as ExecutionState)) {
      errors.push(`invalid execution state: ${String(e.state)}`);
    }
    if (!isNonEmptyString(e.slotId)) errors.push("missing or invalid execution.slotId");
    if (!isNonEmptyString(e.runId)) errors.push("missing or invalid execution.runId");
    if (!isNonEmptyString(e.attemptId)) errors.push("missing or invalid execution.attemptId");
    if (!isNonEmptyString(e.requestId)) errors.push("missing or invalid execution.requestId");
    if (!isNullableString(e.sdkEffectCode)) errors.push("execution.sdkEffectCode must be string or null");
    if (!isStringArray(e.diagnostics)) errors.push("execution.diagnostics must be an array of strings");
    if (!isStringArray(e.pendingEffects)) errors.push("execution.pendingEffects must be an array of strings");
    if (!CLEANUP_STATES.includes(e.cleanupStatus as (typeof CLEANUP_STATES)[number])) {
      errors.push(`invalid execution.cleanupStatus: ${String(e.cleanupStatus)}`);
    }
    if (e.supersededBy !== undefined && !isNullableString(e.supersededBy)) {
      errors.push("execution.supersededBy must be string or null when present");
    }
  }

  // 10. Raw artifact availability/digest/cause consistency.
  if (!isRecord(rc.rawArtifact)) {
    errors.push("rawArtifact must be an object");
  } else {
    const r = rc.rawArtifact;
    if (typeof r.available !== "boolean") errors.push("rawArtifact.available must be boolean");
    if (!isNullableString(r.rawText)) errors.push("rawArtifact.rawText must be string or null");
    if (!isNullableString(r.rawBytesDigest)) errors.push("rawArtifact.rawBytesDigest must be string or null");
    if (r.rawBytesDigest !== null && r.rawBytesDigest !== undefined && !isDigestLike(r.rawBytesDigest)) {
      errors.push("rawArtifact.rawBytesDigest must be a hex digest");
    }
    if (!isNullableString(r.rawUnavailableCause)) {
      errors.push("rawArtifact.rawUnavailableCause must be string or null");
    }
    if (r.available === true && r.rawText === null && r.rawBytesDigest === null) {
      errors.push("rawArtifact: available=true requires rawText or rawBytesDigest");
    }
    if (r.available === false && !isNonEmptyString(r.rawUnavailableCause)) {
      errors.push("rawArtifact: available=false requires rawUnavailableCause");
    }
  }

  // 11. Evidence metadata and applicability values.
  if (!isRecord(rc.evidence)) {
    errors.push("evidence must be an object");
  } else {
    const ev = rc.evidence;
    for (const field of [
      "producer",
      "candidateBinding",
      "checkDefinition",
      "inputScope",
      "environment",
      "observationOutcome",
      "completeness",
      "applicability",
      "provenance",
    ] as const) {
      if (!isNonEmptyString(ev[field])) errors.push(`missing or invalid evidence.${field}`);
    }
    if (!isStringArray(ev.timestamps) || !ev.timestamps.every((t) => isIsoTimestamp(t))) {
      errors.push("evidence.timestamps must be an array of ISO timestamps");
    }
    if (!isStringArray(ev.references)) errors.push("evidence.references must be an array of strings");
    if (!APPLICABILITY_VALUES.includes(ev.applicability as (typeof APPLICABILITY_VALUES)[number])) {
      errors.push(`invalid evidence.applicability: ${String(ev.applicability)}`);
    }
  }

  // 12. Usage: finite non-negative values or null.
  if (!isRecord(rc.usage)) {
    errors.push("usage must be an object");
  } else {
    const u = rc.usage;
    for (const field of ["inputTokens", "outputTokens", "totalTokens", "durationMs", "cost"] as const) {
      if (!isFiniteNonNegativeOrNull(u[field])) {
        errors.push(`usage.${field} must be finite non-negative or null`);
      }
    }
    if (!isNullableString(u.currency)) errors.push("usage.currency must be string or null");
    if (!isNullableString(u.requestedModel)) errors.push("usage.requestedModel must be string or null");
    if (!isNullableString(u.observedModel)) errors.push("usage.observedModel must be string or null");
    if (!isStringArray(u.capacityObservations)) {
      errors.push("usage.capacityObservations must be an array of strings");
    }
  }

  // 13. Capacity values and explicit unknowns.
  if (!isRecord(rc.capacity)) {
    errors.push("capacity must be an object");
  } else {
    const cap = rc.capacity;
    if (!isNullableString(cap.durableFactCapacity)) {
      errors.push("capacity.durableFactCapacity must be string or null");
    }
    if (!isNullableString(cap.retentionPolicy)) {
      errors.push("capacity.retentionPolicy must be string or null");
    }
  }

  return errors;
}

/**
 * Build a result contract from components.
 */
export function buildResultContract(params: {
  subject: SubjectIdentity;
  candidate: CandidateIdentity;
  criteria: CriteriaIdentity;
  profile: ProfileIdentity;
  assessments: AssessmentRecord[];
  findings: FindingRecord[];
  coverage: CoverageRecord;
  execution: ExecutionRecord;
  rawArtifact: RawArtifactRecord;
  evidence: EvidenceRecord;
  usage: UsageRecord;
  capacity: CapacityRecord;
}): ResultContract {
  return {
    contractId: crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 16),
    version: RESULT_CONTRACT_VERSION,
    ...params,
  };
}

/**
 * Compute coverage from expected and present IDs.
 *
 * - missing: expected IDs absent from present
 * - duplicate: valid IDs appearing more than once
 * - unknown: valid IDs not in expected
 * - invalid: present values that are not non-empty strings
 * - individuallyValid: expected, non-duplicate, valid IDs
 */
export function computeCoverage(expectedIds: string[], presentIds: string[]): CoverageRecord {
  const expected = Array.isArray(expectedIds) ? expectedIds : [];
  const present = Array.isArray(presentIds) ? presentIds : [];
  const expectedSet = new Set(expected);
  const presentSet = new Set(present.filter((id) => typeof id === "string"));

  const missingIds = expected.filter((id) => !presentSet.has(id));
  const unknownIds = present.filter((id) => typeof id === "string" && id.trim().length > 0 && !expectedSet.has(id));
  const invalidIds = present.filter((id) => typeof id !== "string" || id.trim().length === 0);

  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of present) {
    if (typeof id !== "string" || id.trim().length === 0) continue;
    if (seen.has(id)) {
      if (!duplicateIds.includes(id)) duplicateIds.push(id);
    }
    seen.add(id);
  }

  const individuallyValidIds = present.filter(
    (id) => typeof id === "string" && id.trim().length > 0 && expectedSet.has(id) && !duplicateIds.includes(id),
  ) as string[];

  const wholeInventoryAdmitted =
    expected.length > 0 &&
    missingIds.length === 0 &&
    duplicateIds.length === 0 &&
    unknownIds.length === 0 &&
    invalidIds.length === 0 &&
    present.length === expected.length;

  return {
    expectedIds: [...expected],
    presentIds: [...present],
    individuallyValidIds,
    missingIds,
    duplicateIds,
    unknownIds,
    invalidIds,
    wholeInventoryAdmitted,
  };
}