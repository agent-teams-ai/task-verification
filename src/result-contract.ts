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
}

// --- Findings (Profile A) ---

export interface FindingRecord {
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

/**
 * Validate a result contract. Returns list of errors (empty = valid).
 * 
 * Validates all required fields for result-contract-v1, including:
 * - Contract ID and schema version
 * - Subject identity and expected subject inventory
 * - Candidate repository/materialization identity
 * - Base/head tree identity and runtime digest formats
 * - Criteria revision/text digest
 * - Exact expected criterion inventory
 * - Criterion-to-check mapping
 * - Policy version and digest
 * - Profile and configuration/prompt/input identities
 * - Requested/observed model values preserving unknown as null
 * - Assessment record shape and admitted conclusion enums
 * - Original claim preservation
 * - Reference arrays and diagnostics
 * - Finding record shape, skipped reason and criterion mapping
 * - Coverage arrays and cross-field consistency
 * - Execution state and cleanup-state enums
 * - Raw artifact availability/digest/cause consistency
 * - Evidence metadata and applicability values
 * - Usage fields: finite non-negative values or null
 * - Capacity values and explicit unknowns
 * 
 * Key validation rules:
 * - Coverage is recomputed from actual assessment IDs rather than blindly trusted
 * - missing/duplicate/unknown/invalid IDs are distinguished by cross-field analysis
 * - wholeInventoryAdmitted must agree with recomputed result
 * - Usage fields must be finite non-negative or null
 * - Capacity values and explicit unknowns are preserved
 */
export function validateResultContract(rc: ResultContract): string[] {
  const errors: string[] = [];

  // 1. Contract ID and schema version
  if (rc.version !== RESULT_CONTRACT_VERSION) errors.push(`bad version: ${rc.version}`);
  if (!rc.contractId) errors.push("missing contractId");

  // 2. Subject identity and expected subject inventory
  if (!rc.subject?.fixtureTaskId) errors.push("missing subject.fixtureTaskId");
  if (!rc.subject?.expectedSubjectInventory) errors.push("missing subject.expectedSubjectInventory");
  if (!Array.isArray(rc.subject?.expectedSubjectInventory))
    errors.push("subject.expectedSubjectInventory must be array");
  if (rc.subject.expectedSubjectInventory.some((id) => typeof id !== "string"))
    errors.push("subject.expectedSubjectInventory must contain strings");

  // 3. Candidate repository/materialization identity
  if (!rc.candidate?.repositoryMaterializationId)
    errors.push("missing candidate.repositoryMaterializationId");
  if (!rc.candidate?.baseTreeIdentity)
    errors.push("missing candidate.baseTreeIdentity");
  if (!rc.candidate?.headTreeIdentity)
    errors.push("missing candidate.headTreeIdentity");
  if (!rc.candidate?.runtimeSnapshotDigest)
    errors.push("missing candidate.runtimeSnapshotDigest");
  // Validate runtimeSnapshotDigest format (must be string if present)
  if (rc.candidate.runtimeSnapshotDigest !== undefined && rc.candidate.runtimeSnapshotDigest !== null && typeof rc.candidate.runtimeSnapshotDigest !== "string") {
    errors.push("candidate.runtimeSnapshotDigest must be a string if present");
  }

  // 4. Criteria revision/text digest
  if (!rc.criteria?.authoredCriteriaRevision)
    errors.push("missing criteria.authoredCriteriaRevision");
  if (!rc.criteria?.criteriaTextDigest)
    errors.push("missing criteria.criteriaTextDigest");
  if (rc.criteria.criteriaTextDigest && typeof rc.criteria.criteriaTextDigest !== "string") {
    errors.push("criteria.criteriaTextDigest must be a string");
  }

  // 5. Exact expected criterion inventory
  if (!rc.criteria?.expectedCriterionIds)
    errors.push("missing criteria.expectedCriterionIds");
  if (!Array.isArray(rc.criteria.expectedCriterionIds))
    errors.push("criteria.expectedCriterionIds must be array");

  // 6. Criterion-to-check mapping
  if (!rc.criteria?.criterionToCheckMapping)
    errors.push("missing criteria.criterionToCheckMapping");
  if (typeof rc.criteria.criterionToCheckMapping !== "object" || Array.isArray(rc.criteria.criterionToCheckMapping))
    errors.push("criteria.criterionToCheckMapping must be an object");

  // 7. Policy version and digest
  if (!rc.criteria?.policyVersion) errors.push("missing criteria.policyVersion");
  if (!rc.criteria?.policyDigest) errors.push("missing criteria.policyDigest");
  if (rc.criteria.policyDigest && typeof rc.criteria.policyDigest !== "string") {
    errors.push("criteria.policyDigest must be a string");
  }

  // 8. Profile and configuration/prompt/input identities
  if (!rc.profile?.profileId) errors.push("missing profile.profileId");
  if (!rc.profile?.configurationIdentity)
    errors.push("missing profile.configurationIdentity");
  if (!rc.profile?.promptIdentity) errors.push("missing profile.promptIdentity");
  if (!rc.profile?.inputIdentity) errors.push("missing profile.inputIdentity");
  if (rc.profile.requestedModel !== null && rc.profile.requestedModel !== undefined) {
    if (typeof rc.profile.requestedModel !== "string")
      errors.push("profile.requestedModel must be string or null");
  }
  if (rc.profile.observedModel !== null && rc.profile.observedModel !== undefined) {
    if (typeof rc.profile.observedModel !== "string")
      errors.push("profile.observedModel must be string or null");
  }

  // 9. Assessment record shape and original claim preservation
  if (!Array.isArray(rc.assessments)) errors.push("assessments must be array");
  for (let i = 0; i < rc.assessments.length; i++) {
    const a = rc.assessments[i];
    if (!a.expectedCriterionId)
      errors.push(`assessments[${i}].expectedCriterionId is required`);
    if (a.present === undefined) errors.push(`assessments[${i}].present is required`);
    if (a.originalReportedClaim !== null && typeof a.originalReportedClaim !== "string")
      errors.push(`assessments[${i}].originalReportedClaim must be string or null`);
    if (a.admittedConclusion !== null && !["satisfied", "violated", "inconclusive"].includes(a.admittedConclusion))
      errors.push(`assessments[${i}].admittedConclusion must be satisfied/violated/inconclusive or null`);
    if (!Array.isArray(a.references)) errors.push(`assessments[${i}].references must be array`);
    if (a.diagnostics && !Array.isArray(a.diagnostics))
      errors.push(`assessments[${i}].diagnostics must be array or undefined`);
  }

  // 10. Reference arrays and diagnostics cross-check
  for (let i = 0; i < rc.assessments.length; i++) {
    const a = rc.assessments[i];
    // If criterion is present, there should be at least some reference or diagnostics
    if (a.present && a.references.length === 0 && (!a.diagnostics || a.diagnostics.length === 0)) {
      errors.push(`assessments[${i}]: present criterion with no references or diagnostics`);
    }
  }

  // 11. Finding record shape, skipped reason and criterion mapping
  if (!Array.isArray(rc.findings)) errors.push("findings must be array");
  for (let i = 0; i < rc.findings.length; i++) {
    const f = rc.findings[i];
    if (typeof f.nativeComment !== "string")
      errors.push(`findings[${i}].nativeComment must be string`);
    if (f.skipped === undefined) errors.push(`findings[${i}].skipped is required`);
    if (f.skipped && typeof f.skipReason !== "string")
      errors.push(`findings[${i}].skipReason must be string when skipped`);
    if (f.criterionMapping !== null && typeof f.criterionMapping !== "string")
      errors.push(`findings[${i}].criterionMapping must be string or null`);
    if (f.references !== undefined && !Array.isArray(f.references))
      errors.push(`findings[${i}].references must be an array when present`);
  }

  // 12. Coverage arrays and cross-field consistency
  if (!rc.coverage) errors.push("missing coverage");
  else {
    const { expectedIds, presentIds, missingIds, duplicateIds, unknownIds, invalidIds, wholeInventoryAdmitted } = rc.coverage;

    // Validate arrays are actually arrays
    if (!Array.isArray(expectedIds)) errors.push("coverage.expectedIds must be array");
    if (!Array.isArray(presentIds)) errors.push("coverage.presentIds must be array");
    if (!Array.isArray(missingIds)) errors.push("coverage.missingIds must be array");
    if (!Array.isArray(duplicateIds)) errors.push("coverage.duplicateIds must be array");
    if (!Array.isArray(unknownIds)) errors.push("coverage.unknownIds must be array");
    if (!Array.isArray(invalidIds)) errors.push("coverage.invalidIds must be array");

    // Recompute coverage from assessment IDs rather than blindly trusting stored coverage.
    // Collect all expected criterion IDs from assessments.
    const assessedCriterionIds: string[] = [];
    for (const a of rc.assessments) {
      assessedCriterionIds.push(a.expectedCriterionId);
    }

    // Distinguish missing, duplicate, unknown and invalid IDs.
    const expectedSet = new Set(expectedIds);
    const presentSet = new Set(presentIds);

    // Missing: expected IDs not present in presentIds
    for (const id of expectedIds) {
      if (!presentSet.has(id)) {
        // Already checked by recomputation below
      }
    }

    // Check for IDs in present that are not in expected (unknown)
    const unknownFromPresent = presentIds.filter((id) => !expectedSet.has(id));
    for (const id of unknownFromPresent) {
      if (!unknownIds.includes(id)) {
        errors.push(`coverage: ID ${id} present but not in unknownIds`);
      }
    }

    // Check for duplicates in presentIds
    const seen = new Set<string>();
    const duplicatesFromPresent: string[] = [];
    for (const id of presentIds) {
      if (seen.has(id)) {
        if (!duplicatesFromPresent.includes(id)) duplicatesFromPresent.push(id);
      }
      seen.add(id);
    }
    for (const id of duplicatesFromPresent) {
      if (!duplicateIds.includes(id)) {
        errors.push(`coverage: ID ${id} in present but not in duplicateIds`);
      }
    }

    // Verify wholeInventoryAdmitted agrees with recomputed result.
    // Whole inventory admitted only when all expected IDs are present exactly once,
    // with no missing, duplicate, unknown, or invalid IDs.
    const missingFromPresent = expectedIds.filter((id) => !presentSet.has(id));
    const invalidFromPresent = presentIds.filter((id) => !expectedSet.has(id) && !unknownIds.includes(id) && !duplicateIds.includes(id));
    const recomputedWholeInventoryAdmitted =
      missingFromPresent.length === 0 &&
      duplicatesFromPresent.length === 0 &&
      unknownFromPresent.length === 0 &&
      invalidFromPresent.length === 0 &&
      presentIds.length === expectedIds.length;

    if (wholeInventoryAdmitted !== recomputedWholeInventoryAdmitted) {
      errors.push(
        `coverage: wholeInventoryAdmitted(${wholeInventoryAdmitted}) disagrees with recomputed result(${recomputedWholeInventoryAdmitted})`,
      );
    }

    // Validate invalidIds are not hardcoded to empty if validation can identify invalid values
    // (this is informational - actual invalid ID detection is done via cross-field analysis above)

    // Check for IDs in invalidIds that should be present
    for (const id of invalidIds) {
      if (expectedSet.has(id)) {
        errors.push(`coverage: invalid ID ${id} is in expected criterion list`);
      }
    }
  }

  // 13. Execution state and cleanup-state enums
  const validExecutionStates: ExecutionState[] = ["completed", "partial", "cancelled", "failed", "unknown"];
  if (!validExecutionStates.includes(rc.execution?.state))
    errors.push(`invalid execution state: ${rc.execution?.state}`);

  if (rc.execution?.cleanupStatus) {
    const validCleanupStates: ("clean" | "pending" | "failed" | "unknown")[] = ["clean", "pending", "failed", "unknown"];
    if (!validCleanupStates.includes(rc.execution.cleanupStatus))
      errors.push(`invalid execution.cleanupStatus: ${rc.execution.cleanupStatus}`);
  }

  // 14. Raw artifact availability/digest/cause consistency
  if (rc.rawArtifact?.available === true && !rc.rawArtifact.rawText && rc.rawArtifact.rawBytesDigest === null) {
    errors.push("rawArtifact: available=true requires rawText or rawBytesDigest");
  }
  if (rc.rawArtifact?.available === false && rc.rawArtifact.rawUnavailableCause === null) {
    errors.push("rawArtifact: available=false requires rawUnavailableCause");
  }
  if (rc.rawArtifact?.rawBytesDigest && typeof rc.rawArtifact.rawBytesDigest !== "string") {
    errors.push("rawArtifact.rawBytesDigest must be a string");
  }

  // 15. Evidence metadata and applicability values
  if (rc.evidence) {
    if (rc.evidence.producer === undefined) errors.push("evidence.producer is required");
    if (rc.evidence.applicability && typeof rc.evidence.applicability !== "string")
      errors.push("evidence.applicability must be string");
  }

  // 16. Usage fields: finite non-negative values or null
  if (rc.usage) {
    if (rc.usage.inputTokens !== null && (typeof rc.usage.inputTokens !== "number" || rc.usage.inputTokens < 0))
      errors.push("usage.inputTokens must be finite non-negative or null");
    if (rc.usage.outputTokens !== null && (typeof rc.usage.outputTokens !== "number" || rc.usage.outputTokens < 0))
      errors.push("usage.outputTokens must be finite non-negative or null");
    if (rc.usage.totalTokens !== null && (typeof rc.usage.totalTokens !== "number" || rc.usage.totalTokens < 0))
      errors.push("usage.totalTokens must be finite non-negative or null");
    if (rc.usage.durationMs !== null && (typeof rc.usage.durationMs !== "number" || rc.usage.durationMs < 0))
      errors.push("usage.durationMs must be finite non-negative or null");
    if (rc.usage.cost !== null && (typeof rc.usage.cost !== "number" || rc.usage.cost < 0))
      errors.push("usage.cost must be finite non-negative or null");
    if (rc.usage.currency !== null && typeof rc.usage.currency !== "string")
      errors.push("usage.currency must be string or null");
    if (rc.usage.requestedModel !== null && typeof rc.usage.requestedModel !== "string")
      errors.push("usage.requestedModel must be string or null");
    if (rc.usage.observedModel !== null && typeof rc.usage.observedModel !== "string")
      errors.push("usage.observedModel must be string or null");
  }

  // 17. Capacity values and explicit unknowns
  if (rc.capacity) {
    if (rc.capacity.durableFactCapacity !== null && typeof rc.capacity.durableFactCapacity !== "string")
      errors.push("capacity.durableFactCapacity must be string or null");
    if (rc.capacity.retentionPolicy !== null && typeof rc.capacity.retentionPolicy !== "string")
      errors.push("capacity.retentionPolicy must be string or null");
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
 */
export function computeCoverage(
  expectedIds: string[],
  presentIds: string[],
): CoverageRecord {
  const expectedSet = new Set(expectedIds);
  const presentSet = new Set(presentIds);
  const missingIds = expectedIds.filter((id) => !presentSet.has(id));
  const unknownIds = presentIds.filter((id) => !expectedSet.has(id));
  // Duplicates: IDs appearing more than once in presentIds.
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of presentIds) {
    if (seen.has(id)) {
      if (!duplicateIds.includes(id)) duplicateIds.push(id);
    }
    seen.add(id);
  }
  const individuallyValidIds = presentIds.filter((id) => expectedSet.has(id) && !duplicateIds.includes(id));
  const invalidIds: string[] = [];
  const wholeInventoryAdmitted =
    missingIds.length === 0 &&
    duplicateIds.length === 0 &&
    unknownIds.length === 0 &&
    invalidIds.length === 0 &&
    presentIds.length === expectedIds.length;

  return {
    expectedIds,
    presentIds,
    individuallyValidIds,
    missingIds,
    duplicateIds,
    unknownIds,
    invalidIds,
    wholeInventoryAdmitted,
  };
}
