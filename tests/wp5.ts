import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCoverage, buildResultContract, validateResultContract } from "../src/result-contract.ts";
import { scoreResult, evaluateRubric, isReferenceSupporting, SCORER_VERSION, RUBRIC_VERSION } from "../src/scorer.ts";

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
  const result = scoreResult({ resultContract: rc, truthCandidateId: "S1-C1", truthOutcomes: truth, referenceRubrics: rubrics });
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
  const result = scoreResult({ resultContract: rc, truthCandidateId: "S1-C1", truthOutcomes: { "AC-1": true }, referenceRubrics: rubrics });
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
  const result = scoreResult({ resultContract: rc, truthCandidateId: "S1-C1", truthOutcomes: { "AC-1": true }, referenceRubrics: {} });
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
  const falseSat = scoreResult({ resultContract: makeRc("satisfied"), truthCandidateId: "S1-C3", truthOutcomes: { "AC-1": false }, referenceRubrics: {} });
  assert.equal(falseSat.labelAgreement[0].agrees, false, "false satisfaction must be recorded");
  // False violation: admitted violated, truth true.
  const falseVio = scoreResult({ resultContract: makeRc("violated"), truthCandidateId: "S1-C1", truthOutcomes: { "AC-1": true }, referenceRubrics: {} });
  assert.equal(falseVio.labelAgreement[0].agrees, false, "false violation must be recorded");
});

test("WP5: missing/duplicate/unknown/invalid IDs are separate diagnostics", () => {
  const coverage = computeCoverage(["AC-1", "AC-2", "AC-3"], ["AC-1", "AC-1", "AC-4", "AC-5"]);
  assert.deepEqual(coverage.missingIds, ["AC-2", "AC-3"]);
  assert.deepEqual(coverage.duplicateIds, ["AC-1"]);
  assert.deepEqual(coverage.unknownIds, ["AC-4", "AC-5"]);
  assert.equal(coverage.wholeInventoryAdmitted, false);
});

test("WP5: failed/unknown execution does not acquire invented semantic verdict", () => {
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: ["AC-1"] },
    candidate: { repositoryMaterializationId: "S1-FIX-5ba5153fec57", baseTreeIdentity: "b", headTreeIdentity: "h", runtimeSnapshotDigest: "d", opaqueFixtureId: "o" },
    criteria: { authoredCriteriaRevision: "crit-v1", criteriaTextDigest: "d", expectedCriterionIds: ["AC-1"], criterionToCheckMapping: {}, policyVersion: "v1", policyDigest: "pd" },
    profile: { profileId: "pb", configurationIdentity: "c", promptIdentity: "p", inputIdentity: "i", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "a" },
    assessments: [{ expectedCriterionId: "AC-1", present: true, originalReportedClaim: "satisfied", admittedConclusion: "satisfied", references: [], explanation: null, diagnostics: [] }],
    findings: [],
    coverage: computeCoverage(["AC-1"], ["AC-1"]),
    execution: { state: "failed", slotId: "s", runId: "r", attemptId: "a", requestId: "req", sdkEffectCode: "SDK_FAIL", diagnostics: ["error"], pendingEffects: [], cleanupStatus: "clean" },
    rawArtifact: { available: false, rawText: null, rawBytesDigest: null, rawUnavailableCause: "timeout" },
    evidence: { producer: "p", candidateBinding: "c", checkDefinition: "cd", inputScope: "is", environment: "e", observationOutcome: "pass", completeness: "complete", timestamps: [], references: [], applicability: "applicable", provenance: "prov" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const result = scoreResult({ resultContract: rc, truthCandidateId: "S1-C1", truthOutcomes: { "AC-1": true }, referenceRubrics: {} });
  assert.ok(result.diagnostics.some((d) => d.includes("execution failed")), "failed execution must be diagnosed");
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
  const result = scoreResult({ resultContract: rc, truthCandidateId: "S1-C1", truthOutcomes: { "AC-1": true }, referenceRubrics: {} });
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
