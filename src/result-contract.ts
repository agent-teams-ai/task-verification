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
 */
export function validateResultContract(rc: ResultContract): string[] {
  const errors: string[] = [];
  if (rc.version !== RESULT_CONTRACT_VERSION) errors.push(`bad version: ${rc.version}`);
  if (!rc.subject?.fixtureTaskId) errors.push("missing fixtureTaskId");
  if (!rc.candidate?.repositoryMaterializationId) errors.push("missing repositoryMaterializationId");
  if (!rc.criteria?.authoredCriteriaRevision) errors.push("missing authoredCriteriaRevision");
  if (!rc.profile?.profileId) errors.push("missing profileId");
  if (!Array.isArray(rc.assessments)) errors.push("assessments must be array");
  if (!Array.isArray(rc.findings)) errors.push("findings must be array");
  if (!rc.coverage) errors.push("missing coverage");
  if (!rc.execution) errors.push("missing execution");
  if (!rc.rawArtifact) errors.push("missing rawArtifact");
  // Coverage validation.
  if (rc.coverage) {
    const { expectedIds, presentIds, missingIds, duplicateIds } = rc.coverage;
    if (!Array.isArray(expectedIds)) errors.push("coverage.expectedIds must be array");
    // Verify missing/duplicate/unknown/invalid are disjoint from present.
    for (const id of presentIds) {
      if (missingIds.includes(id)) errors.push(`id ${id} in both present and missing`);
      if (duplicateIds.includes(id) && !presentIds.includes(id)) errors.push(`id ${id} in duplicate but not present`);
    }
  }
  // Execution state validation.
  const validStates: ExecutionState[] = ["completed", "partial", "cancelled", "failed", "unknown"];
  if (!validStates.includes(rc.execution?.state)) errors.push(`invalid execution state: ${rc.execution?.state}`);
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
