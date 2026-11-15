import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCoverage, buildResultContract, validateResultContract } from "../src/result-contract.ts";
import { scoreResult, evaluateRubric, isReferenceSupporting, SCORER_VERSION, RUBRIC_VERSION } from "../src/scorer.ts";
import type { TruthBinding } from "../src/scorer.ts";

function makeTruthBinding(rc: any, truthOutcomes: Record<string, boolean>): TruthBinding {
  return {
    canonicalCandidateId: rc.candidate.repositoryMaterializationId,
    anonymizedCandidateId: rc.candidate.opaqueFixtureId,
    headApplicationDigest: rc.candidate.runtimeSnapshotDigest,
    criteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriterionInventory: rc.criteria.expectedCriterionIds,
    truthVersion: "truth-v1",
    truthDigest: "digest",
    truthOutcomes,
  };
}

type RegistryOverride = Partial<import("../src/scorer.ts").ArtifactEntry>;

function makeRegistry(rc: any, overrides: Record<string, RegistryOverride> = {}): import("../src/scorer.ts").ArtifactRegistry {
  const artifacts: Record<string, import("../src/scorer.ts").ArtifactEntry> = {};
  for (const [ref, ov] of Object.entries(overrides)) {
    artifacts[ref] = {
      artifactId: ref,
      digest: `digest-${ref}`,
      candidateBinding: rc.candidate.repositoryMaterializationId,
      snapshotDigest: rc.candidate.runtimeSnapshotDigest,
      criterionId: null,
      allowedSource: true,
      current: true,
      applicable: true,
      ...ov,
    };
  }
  return { artifacts };
}

const SUPPORTING_RUBRIC: import("../src/scorer.ts").RubricDecision = {
  referenceExists: true,
  tiedToCandidate: true,
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const UNSUPPORTING_RUBRIC: import("../src/scorer.ts").RubricDecision = {
  referenceExists: true,
  tiedToCandidate: true,
  supportsBehavior: false,
  coversSubclauses: false,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

function makeClaimRc(params: {
  claim: string | null;
  admitted: any;
  references?: string[];
  state?: string;
  findings?: any[];
}): any {
  return buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: params.claim, admittedConclusion: params.admitted, references: params.references ?? [], explanation: null, diagnostics: [] }],
    findings: params.findings ?? [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: (params.state ?? "completed") as any, slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
}

test("WP5: result contract validates", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: {
      repositoryMaterializationId: "S1-FIX-5ba5153fec57",
      baseTreeIdentity: "base123",
      headTreeIdentity: "head456",
      runtimeSnapshotDigest: "digest789",
      opaqueFixtureId: "opaque1",
    },
    criteria: {
      authoredCriteriaRevision: "crit-v1",
      criteriaTextDigest: "digest",
      expectedCriterionIds: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"],
      criterionToCheckMapping: { "AC-1": ["P-active-a", "P-active-b"] },
      policyVersion: "baseline-policy-v1",
      policyDigest: "policydigest",
    },
    profile: {
      profileId: "profile-b",
      configurationIdentity: "config1",
      promptIdentity: "prompt1",
      inputIdentity: "input1",
      requestedModel: null,
      observedModel: null,
      reasoningConfiguration: {},
      adapterEntryIdentity: "adapter1",
    },
    assessments: [
      {
        expectedCriterionId: "AC-1",
        present: true,
        originalReportedClaim: "satisfied",
        admittedConclusion: "satisfied",
        references: ["ref-1"],
        explanation: "all pass",
        diagnostics: [],
      },
    ],
    findings: [],
    coverage: computeCoverage(["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"], ["AC-1"]),
    execution: {
      state: "completed",
      slotId: "slot-1",
      runId: "run-1",
      attemptId: "attempt-1",
      requestId: "req-1",
      sdkEffectCode: null,
      diagnostics: [],
      pendingEffects: [],
      cleanupStatus: "clean",
    },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "digest", rawUnavailableCause: null },
    evidence: {
      producer: "oracle-O-1",
      candidateBinding: "S1-FIX-5ba5153fec57",
      checkDefinition: "checkdef",
      inputScope: "scope",
      environment: "local",
      observationOutcome: "pass",
      completeness: "complete",
      timestamps: [],
      references: [],
      applicability: "applicable",
      provenance: "provenance",
    },
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: 100,
      cost: null,
      currency: null,
      requestedModel: null,
      observedModel: null,
      capacityObservations: [],
    },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const errors = validateResultContract(rc);
  assert.deepEqual(errors, [], errors.join("; "));
});

test("WP5: scorer separates label agreement, reference validity and semantic support", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: ["ref-1"], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const truth: Record<string, boolean> = { "AC-1": true };
  const rubrics: Record<string, import("../src/scorer.ts").RubricDecision> = {
    "ref-1": { referenceExists: true, tiedToCandidate: true, supportsBehavior: false, coversSubclauses: false, relevantCurrentApplicable: true, contradictsClaim: false },
  };
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, truth), referenceRubrics: rubrics });
  // Label agreement: AC-1 satisfied, truth true → agrees.
  assert.equal(result.labelAgreement[0].agrees, true);
  // Reference validity: ref-1 exists and tied → valid.
  assert.equal(result.referenceValidity[0].valid, true);
  // Semantic support: ref-1 does not support behavior → not supporting.
  assert.equal(result.semanticSupport[0].supporting, false);
  // These are separate dimensions — label agrees but support is false.
});

test("WP5: correct label with irrelevant reference is not supported", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: ["irrelevant-ref"], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const rubrics: Record<string, import("../src/scorer.ts").RubricDecision> = {
    "irrelevant-ref": { referenceExists: true, tiedToCandidate: true, supportsBehavior: false, coversSubclauses: false, relevantCurrentApplicable: true, contradictsClaim: false },
  };
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: rubrics });
  assert.equal(result.labelAgreement[0].agrees, true, "label should agree");
  assert.equal(result.semanticSupport[0].supporting, false, "irrelevant ref should not support");
});

test("WP5: empty references remain unsupported", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {} });
  assert.equal(result.diagnostics.some((d) => d.includes("no references")), true, "empty refs should be flagged");
});

test("WP5: false satisfaction and false violation are recorded", () => {
  const makeRc = (claim: string) => buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: claim, admittedConclusion: claim as any, references: ["ref-1"], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  // False satisfaction: admitted satisfied, truth false.
  const rcSat = makeRc("satisfied");
  const falseSat = scoreResult({ resultContract: rcSat, truthBinding: makeTruthBinding(rcSat, { "AC-1": false }), referenceRubrics: {} });
  assert.equal(falseSat.labelAgreement[0].agrees, false, "false satisfaction must be recorded");
  // False violation: admitted violated, truth true.
  const rcVio = makeRc("violated");
  const falseVio = scoreResult({ resultContract: rcVio, truthBinding: makeTruthBinding(rcVio, { "AC-1": true }), referenceRubrics: {} });
  assert.equal(falseVio.labelAgreement[0].agrees, false, "false violation must be recorded");
});

test("WP5: missing/duplicate/unknown/invalid IDs are separate diagnostics", () => {
  const coverage = computeCoverage(["AC-1", "AC-2", "AC-3"], ["AC-1", "AC-1", "AC-4", "AC-5"]);
  assert.deepEqual(coverage.missingIds, ["AC-2", "AC-3"]);
  assert.deepEqual(coverage.duplicateIds, ["AC-1"]);
  assert.deepEqual(coverage.unknownIds, ["AC-4", "AC-5"]);
  assert.equal(coverage.wholeInventoryAdmitted, false);
});

test("WP5: failed execution preserves claim and suspends verdict", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "this is a violated claim with details", admittedConclusion: "violated", references: [], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "failed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: "SDK_FAIL", diagnostics: ["error"], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: false, rawText: null, rawBytesDigest: null, rawUnavailableCause: "timeout" },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  // Use executionBinding "preserve-claim" to retain the original claim.
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  // Verdict should be suspended (null), not invented.
  assert.equal(result.labelAgreement[0].agrees, null, "failed execution verdict must be suspended, not invented");
  // Original claim must be preserved as a reported-claim observation.
  assert.equal(result.labelAgreement[0].admittedConclusion, "violated", "admitted conclusion preserved");
  // Diagnostic must record the execution failure.
  assert.ok(result.diagnostics.some((d) => d.includes("execution failed")), "failed execution must be diagnosed");
  // Original claim must not be overwritten.
  assert.equal(rc.assessments[0].originalReportedClaim, "this is a violated claim with details");
});

test("WP5: unknown execution preserves claim and suspends verdict", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "unclear claim", admittedConclusion: "inconclusive", references: [], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "unknown", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  // Verdict suspended for unknown execution.
  assert.equal(result.labelAgreement[0].agrees, null, "unknown execution verdict must be suspended");
  // Original claim preserved.
  assert.equal(result.labelAgreement[0].admittedConclusion, "inconclusive", "admitted conclusion preserved");
  // Diagnostic must record the execution state.
  assert.ok(result.diagnostics.some((d) => d.includes("execution unknown")), "unknown execution must be diagnosed");
});

test("WP5: original claim is never overwritten", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "this is a violated claim with details", admittedConclusion: "violated", references: [], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  assert.equal(rc.assessments[0].originalReportedClaim, "this is a violated claim with details");
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {} });
  assert.equal(result.polarityPreserved, true);
});

test("WP5: rubric version and scorer version are stable", () => {
  assert.equal(SCORER_VERSION, "scorer-v1");
  assert.equal(RUBRIC_VERSION, "rubric-v1");
  const r = evaluateRubric({ referenceExists: true, tiedToCandidate: true, supportsBehavior: true, coversSubclauses: true, relevantCurrentApplicable: true, contradictsClaim: false });
  assert.equal(isReferenceSupporting(r), true);
  const r2 = evaluateRubric({ referenceExists: true, tiedToCandidate: true, supportsBehavior: true, coversSubclauses: false, relevantCurrentApplicable: true, contradictsClaim: false });
  assert.equal(isReferenceSupporting(r2), false, "partial subclause coverage should not support");
});

// Profile A finding scoring tests.
test("WP5: Profile A finding mapped to truth-violated criterion is supported detection", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [
      {
        nativeComment: "finding-AC-1-violated",
        normalizedFinding: "AC-1 fails under load",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "AC-1",
        references: ["ref-valid"],
      },
    ],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  // truthOutcomes: { "AC-1": false } means the criterion is violated (not satisfied).
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: {
      "ref-valid": { referenceExists: true, tiedToCandidate: true, supportsBehavior: true, coversSubclauses: true, relevantCurrentApplicable: true, contradictsClaim: false },
    },
    artifactRegistry: makeRegistry(rc, { "ref-valid": {} }),
    executionBinding: "preserve-claim",
  });
  // Finding mapped to truth-violated criterion with a valid supporting reference → supported detection.
  const finding = result.profileA.findings[0];
  assert.equal(finding.mappingStatus, "mapped", "finding should be mapped to AC-1");
  assert.equal(finding.truthComparison, "matches", "finding on violated criterion should match truth");
  assert.equal(finding.referenceValidity, "valid", "real reference must resolve");
  assert.equal(finding.semanticSupport, "supported", "valid supporting reference → supported detection");
  assert.equal(result.profileA.summary.mapped, 1, "one mapped finding");
  assert.equal(result.profileA.summary.outOfScope, 0, "no out-of-scope findings");
});

test("WP5: Profile A finding mapped to truth-satisfied criterion is false allegation", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [
      {
        nativeComment: "finding-AC-1-satisfied",
        normalizedFinding: "AC-1 works correctly",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "AC-1",
      },
    ],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  // Finding mapped to truth-satisfied criterion → false allegation, even with no reference.
  const finding = result.profileA.findings[0];
  assert.equal(finding.mappingStatus, "mapped", "finding should be mapped to AC-1");
  assert.equal(finding.truthComparison, "contradicts", "finding on satisfied criterion should contradict (false allegation)");
  assert.notEqual(finding.semanticSupport, "supported", "false allegation must never be supported");
  assert.equal(result.profileA.summary.mapped, 1, "one mapped finding");
});

test("WP5: Profile A unmapped genuine finding remains visible", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [
      {
        nativeComment: "unrelated memory leak in module X",
        normalizedFinding: "module X has a memory leak",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: null,
      },
    ],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  // Unmapped finding must remain visible and not be treated as false allegation.
  const finding = result.profileA.findings[0];
  assert.equal(finding.mappingStatus, "unmapped", "unmapped finding should have mappingStatus=unmapped");
  assert.equal(finding.semanticSupport, "neutral", "unmapped finding should be neutral");
  assert.equal(result.profileA.summary.unmapped, 1, "one unmapped finding");
  // Should not be counted as a false allegation.
  assert.ok(!result.profileA.findings.some((f) => f.truthComparison === "contradicts"), "unmapped finding should not be contradiction");
});

test("WP5: Profile A out-of-scope finding", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [
      {
        nativeComment: "unrelated UI glitch on button",
        normalizedFinding: "button UI glitch observed",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "NONEXISTENT-AC",
      },
    ],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  const finding = result.profileA.findings[0];
  assert.equal(finding.mappingStatus, "out-of-scope", "finding mapped to nonexistent criterion should be out-of-scope");
  assert.equal(finding.truthComparison, "neutral", "out-of-scope finding should be neutral");
  assert.equal(result.profileA.summary.outOfScope, 1, "one out-of-scope finding");
});

test("WP5: Profile A skipped finding not counted as delivered", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [
      {
        nativeComment: "duplicate check",
        normalizedFinding: "duplicate check, skip",
        skipped: true,
        skipReason: "duplicate check, already recorded",
        qualityFlags: [],
        criterionMapping: "AC-1",
      },
    ],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  // Skipped finding should not be counted as delivered.
  assert.equal(result.profileA.deliveredCount, 0, "skipped finding should not count as delivered");
  assert.equal(result.profileA.summary.skipped, 1, "one skipped finding");
  // The skipped finding should be in the findings list.
  assert.equal(result.profileA.findings.length, 1, "skipped finding should still appear in output");
  assert.equal(result.profileA.findings[0].skipped, true, "finding should be marked skipped");
});

test("WP5: Profile A no findings / silence means no finding", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "completed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: null, diagnostics: [], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: "d", rawUnavailableCause: null },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  // Silence means no finding, not an inconclusive B-style assessment.
  assert.equal(result.profileA.deliveredCount, 0, "no findings = deliveredCount=0");
  assert.equal(result.profileA.findings.length, 0, "no findings in output");
  assert.equal(result.profileA.summary.overallStatus, "complete", "silence = complete status");
});

// --- Reported-claim accounting (WP5) ---

test("WP5 accounting: false satisfaction with missing reference", () => {
  const rc = makeClaimRc({ claim: "satisfied", admitted: "satisfied", references: [] });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: {} });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.parsedClaim, "satisfied");
  assert.equal(e.comparison, "false-satisfaction");
  assert.equal(r.reportedClaims.falseSatisfaction, 1);
  assert.equal(e.referenceValid, null, "no reference means no mechanical validity claim");
});

test("WP5 accounting: false satisfaction with invalid reference", () => {
  const rc = makeClaimRc({ claim: "satisfied", admitted: "satisfied", references: ["missing-ref"] });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: {}, artifactRegistry: makeRegistry(rc, {}) });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-satisfaction", "invalid reference must not erase the false satisfaction");
  assert.equal(e.referenceValid, false);
  assert.equal(r.reportedClaims.falseSatisfaction, 1);
});

test("WP5 accounting: false satisfaction with unavailable evidence", () => {
  const rc = makeClaimRc({ claim: "satisfied", admitted: "satisfied", references: ["ref-x"] });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: {}, artifactRegistry: makeRegistry(rc, { "ref-x": { applicable: false } }) });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-satisfaction");
  assert.equal(e.referenceValid, false, "inapplicable evidence is not valid");
});

test("WP5 accounting: false violation with invalid reference", () => {
  const rc = makeClaimRc({ claim: "violated", admitted: "violated", references: ["nope"] });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, artifactRegistry: makeRegistry(rc, {}) });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-violation");
  assert.equal(e.referenceValid, false);
});

test("WP5 accounting: correct claim with unsupported reference", () => {
  const rc = makeClaimRc({ claim: "violated", admitted: "violated", references: ["ref-u"] });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: { "ref-u": UNSUPPORTING_RUBRIC }, artifactRegistry: makeRegistry(rc, { "ref-u": {} }) });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "agrees");
  assert.equal(e.referenceValid, true, "reference resolves");
  assert.equal(r.semanticSupport[0].supporting, false, "but is not semantically supporting");
  assert.equal(r.reportedClaims.correctReportedClaims, 1);
});

test("WP5 accounting: failed execution with captured false claim", () => {
  const rc = makeClaimRc({ claim: "satisfied", admitted: "satisfied", references: [], state: "failed" });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-satisfaction", "captured claim is still accounted");
  assert.equal(e.accounted, true);
  assert.equal(e.admitted, false, "no admissible semantic verdict");
  assert.equal(r.reportedClaims.falseSatisfaction, 1);
  assert.equal(r.reportedClaims.admittedSemanticConclusions, 0);
  assert.equal(r.reportedClaims.rejectedUnadmittedConclusions, 1);
});

test("WP5 accounting: failed execution without a parseable claim", () => {
  const rc = makeClaimRc({ claim: null, admitted: null, references: [], state: "failed" });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.parsedClaim, "unknown");
  assert.equal(e.accounted, false);
  assert.equal(r.reportedClaims.unparseableUnknownClaims, 1);
  assert.equal(r.reportedClaims.reportedSatisfied, 0);
});

test("WP5 accounting: unknown execution with a captured claim", () => {
  const rc = makeClaimRc({ claim: "violated", admitted: "inconclusive", references: [], state: "unknown" });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, executionBinding: "preserve-claim" });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-violation");
  assert.equal(e.accounted, true);
  assert.equal(e.admitted, false);
});

test("WP5 accounting: invalid Truth binding suspends comparison but keeps claim", () => {
  const rc = makeClaimRc({ claim: "satisfied", admitted: "satisfied", references: [] });
  const tb = { ...makeTruthBinding(rc, { "AC-1": false }), headApplicationDigest: "WRONG" };
  const r = scoreResult({ resultContract: rc, truthBinding: tb, referenceRubrics: {} });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.comparison, "truth-suspended");
  assert.equal(e.truthOutcome, null);
  assert.equal(e.parsedClaim, "satisfied", "original claim is preserved");
  assert.equal(e.accounted, true);
  assert.equal(r.reportedClaims.truthComparisonSuspended, 1);
  assert.equal(r.reportedClaims.falseSatisfaction, 0, "no Truth comparison when binding invalid");
});

test("WP5 accounting: unparseable raw output is unknown, never invented", () => {
  const rc = makeClaimRc({ claim: "the code maybe possibly broken??", admitted: "inconclusive", references: [] });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {} });
  const e = r.reportedClaims.entries[0];
  assert.equal(e.parsedClaim, "unknown");
  assert.equal(e.comparison, "unknown-claim");
  assert.equal(r.reportedClaims.correctReportedClaims, 0);
  assert.equal(r.reportedClaims.falseSatisfaction, 0);
});

// --- Profile A reference-aware scoring ---

test("WP5 Profile A: truth-satisfied mapped finding stays false allegation with invalid reference", () => {
  const rc = makeClaimRc({
    claim: "satisfied", admitted: "satisfied", references: [],
    findings: [{ nativeComment: "AC-1 broken", normalizedFinding: "AC-1 broken", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-1", references: ["bad-ref"] }],
  });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {}, artifactRegistry: makeRegistry(rc, {}) });
  const f = r.profileA.findings[0];
  assert.equal(f.referenceValidity, "invalid");
  assert.equal(f.truthComparison, "contradicts", "invalid reference cannot become valid");
  assert.notEqual(f.semanticSupport, "supported");
});

test("WP5 Profile A: supported detection requires a real valid reference", () => {
  const rc = makeClaimRc({
    claim: "violated", admitted: "violated", references: [],
    findings: [{ nativeComment: "AC-1 fails", normalizedFinding: "AC-1 fails", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-1", references: ["good-ref"] }],
  });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: { "good-ref": SUPPORTING_RUBRIC }, artifactRegistry: makeRegistry(rc, { "good-ref": {} }) });
  const f = r.profileA.findings[0];
  assert.equal(f.referenceValidity, "valid");
  assert.equal(f.semanticSupport, "supported");
  assert.equal(f.truthComparison, "matches");
});

test("WP5 Profile A: wrong-candidate and wrong-snapshot references are invalid", () => {
  const rc = makeClaimRc({
    claim: "violated", admitted: "violated", references: [],
    findings: [{ nativeComment: "AC-1 fails", normalizedFinding: "AC-1 fails", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-1", references: ["wrong-candidate", "wrong-snapshot"] }],
  });
  const r = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { "wrong-candidate": SUPPORTING_RUBRIC, "wrong-snapshot": SUPPORTING_RUBRIC },
    artifactRegistry: makeRegistry(rc, {
      "wrong-candidate": { candidateBinding: "S1-FIX-000000000000" },
      "wrong-snapshot": { snapshotDigest: "other-snapshot" },
    }),
  });
  const f = r.profileA.findings[0];
  assert.equal(f.referenceValidity, "invalid");
  assert.equal(f.semanticSupport, "unsupported", "truth violation does not make an invalid reference support");
});

test("WP5 Profile A: missing reference is invalid, not silently valid", () => {
  const rc = makeClaimRc({
    claim: "violated", admitted: "violated", references: [],
    findings: [{ nativeComment: "AC-1 fails", normalizedFinding: "AC-1 fails", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-1", references: ["absent"] }],
  });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": false }), referenceRubrics: { absent: SUPPORTING_RUBRIC }, artifactRegistry: makeRegistry(rc, {}) });
  const f = r.profileA.findings[0];
  assert.equal(f.referenceValidity, "invalid");
  assert.equal(f.semanticSupport, "unsupported");
});

test("WP5 Profile A: unmapped genuine finding remains neutral and visible", () => {
  const rc = makeClaimRc({
    claim: "satisfied", admitted: "satisfied", references: [],
    findings: [{ nativeComment: "unrelated leak", normalizedFinding: "leak in X", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: null }],
  });
  const r = scoreResult({ resultContract: rc, truthBinding: makeTruthBinding(rc, { "AC-1": true }), referenceRubrics: {} });
  const f = r.profileA.findings[0];
  assert.equal(f.mappingStatus, "unmapped");
  assert.equal(f.truthComparison, "neutral");
  assert.equal(f.semanticSupport, "neutral");
  assert.equal(r.profileA.summary.unmapped, 1);
});
