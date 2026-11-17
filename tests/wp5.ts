import * as crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCoverage,
  buildResultContract,
  validateResultContract,
  type ResultContract,
} from "../src/result-contract.ts";
import {
  scoreResult,
  claimSupportKey,
  evaluateRubric,
  isReferenceSupporting,
  isAdmissibleExecution,
  validateTruthBinding,
  SCORER_VERSION,
  RUBRIC_VERSION,
  type RubricDecision,
  type RubricReview,
  type TruthBinding,
} from "../src/scorer.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const SUPPORTING: RubricDecision = {
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const UNSUPPORTING: RubricDecision = {
  supportsBehavior: false,
  coversSubclauses: false,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const PARTIAL: RubricDecision = {
  supportsBehavior: true,
  coversSubclauses: false,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const CONTRADICTING: RubricDecision = {
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: true,
};

interface RcOverrides {
  claim?: string | null;
  admitted?: "satisfied" | "violated" | "inconclusive" | null;
  references?: string[];
  state?: "completed" | "partial" | "cancelled" | "failed" | "unknown";
  supersededBy?: string | null;
  findings?: ResultContract["findings"];
  expected?: string[];
  present?: string[];
  coverage?: ResultContract["coverage"];
  evidence?: ResultContract["evidence"];
  rawArtifact?: ResultContract["rawArtifact"];
  profile?: ResultContract["profile"];
}

function baseRc(overrides: RcOverrides = {}): ResultContract {
  const expected = overrides.expected ?? ["AC-1"];
  const present = overrides.present ?? ["AC-1"];
  return buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: [...expected] },
    candidate: {
      repositoryMaterializationId: "S1-FIX-5ba5153fec57",
      baseTreeIdentity: H("base"),
      headTreeIdentity: H("head"),
      runtimeSnapshotDigest: H("snapshot"),
      opaqueFixtureId: "opaque-1",
    },
    criteria: {
      authoredCriteriaRevision: "crit-v1",
      criteriaTextDigest: H("criteria"),
      expectedCriterionIds: expected,
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: H("policy"),
    },
    profile: overrides.profile ?? {
      profileId: "profile-b",
      configurationIdentity: "config-1",
      promptIdentity: "prompt-1",
      inputIdentity: "input-1",
      requestedModel: null,
      observedModel: null,
      reasoningConfiguration: {},
      adapterEntryIdentity: "adapter-1",
    },
    assessments: [
      {
        expectedCriterionId: expected[0],
        present: true,
        originalReportedClaim: overrides.claim === undefined ? "satisfied" : overrides.claim,
        admittedConclusion: overrides.admitted === undefined ? "satisfied" : overrides.admitted,
        references: overrides.references ?? [],
        explanation: null,
        diagnostics: [],
      },
    ],
    findings: overrides.findings ?? [],
    coverage: overrides.coverage ?? computeCoverage(expected, present),
    execution: {
      state: overrides.state ?? "completed",
      slotId: "slot-1",
      runId: "run-1",
      attemptId: "attempt-1",
      requestId: "req-1",
      sdkEffectCode: null,
      diagnostics: [],
      pendingEffects: [],
      cleanupStatus: "clean",
      supersededBy: overrides.supersededBy ?? null,
    },
    rawArtifact: overrides.rawArtifact ?? {
      available: true,
      rawText: "raw",
      rawBytesDigest: H("raw"),
      rawUnavailableCause: null,
    },
    evidence: overrides.evidence ?? {
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
      provenance: "prov",
    },
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      cost: null,
      currency: null,
      requestedModel: null,
      observedModel: null,
      capacityObservations: [],
    },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
}

function makeTruthBinding(rc: ResultContract, truthOutcomes: Record<string, boolean>): TruthBinding {
  return {
    canonicalCandidateId: rc.candidate.repositoryMaterializationId,
    anonymizedCandidateId: rc.candidate.opaqueFixtureId,
    headApplicationDigest: rc.candidate.runtimeSnapshotDigest,
    criteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriterionInventory: [...rc.criteria.expectedCriterionIds],
    truthVersion: "truth-v1",
    truthDigest: "digest",
    truthOutcomes,
  };
}

type RegistryOverride = Partial<import("../src/scorer.ts").ArtifactEntry>;

function makeRegistry(
  rc: ResultContract,
  overrides: Record<string, RegistryOverride> = {},
): import("../src/scorer.ts").ArtifactRegistry {
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

const clone = <T>(value: T): T => structuredClone(value);

// --- Result contract validation ---

test("WP5 contract: a well-formed contract validates", () => {
  assert.deepEqual(validateResultContract(baseRc()), []);
});

test("WP5 contract: rejects non-object input", () => {
  assert.ok(validateResultContract(null).length > 0);
  assert.ok(validateResultContract([]).length > 0);
  assert.ok(validateResultContract("nope").length > 0);
});

test("WP5 contract: rejects bad contractId and version", () => {
  const rc = clone(baseRc());
  (rc as any).contractId = "";
  (rc as any).version = "result-contract-v0";
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("contractId")));
  assert.ok(errors.some((e) => e.includes("bad version")));
});

test("WP5 contract: rejects malformed subject", () => {
  const rc = clone(baseRc());
  (rc as any).subject = { fixtureTaskId: "", expectedSubjectInventory: ["AC-1", "AC-1"] };
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("fixtureTaskId")));
  assert.ok(errors.some((e) => e.includes("duplicates")));
});

test("WP5 contract: rejects bad candidate digests", () => {
  const rc = clone(baseRc());
  (rc as any).candidate.baseTreeIdentity = "not-a-digest";
  (rc as any).candidate.runtimeSnapshotDigest = "";
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("baseTreeIdentity")));
  assert.ok(errors.some((e) => e.includes("runtimeSnapshotDigest")));
});

test("WP5 contract: rejects duplicate criteria and bad mapping", () => {
  const rc = clone(baseRc());
  (rc as any).criteria.expectedCriterionIds = ["AC-1", "AC-1"];
  (rc as any).criteria.criterionToCheckMapping = { "AC-1": "not-an-array" };
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("expectedCriterionIds contains duplicates")));
  assert.ok(errors.some((e) => e.includes("criterionToCheckMapping")));
});

test("WP5 contract: rejects malformed profile", () => {
  const rc = clone(baseRc());
  (rc as any).profile.promptIdentity = "";
  (rc as any).profile.reasoningConfiguration = [];
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("promptIdentity")));
  assert.ok(errors.some((e) => e.includes("reasoningConfiguration")));
});

test("WP5 contract: rejects malformed assessment records", () => {
  const rc = clone(baseRc());
  (rc as any).assessments[0].admittedConclusion = "maybe";
  (rc as any).assessments[0].references = "ref-1";
  (rc as any).assessments[0].originalReportedClaim = 42;
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("admittedConclusion")));
  assert.ok(errors.some((e) => e.includes("references must be an array")));
  assert.ok(errors.some((e) => e.includes("originalReportedClaim")));
});

test("WP5 contract: rejects malformed finding records", () => {
  const rc = clone(baseRc());
  (rc as any).findings = [
    { nativeComment: "", normalizedFinding: 5, skipped: true, skipReason: null, qualityFlags: [], criterionMapping: "AC-1" },
  ];
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("nativeComment")));
  assert.ok(errors.some((e) => e.includes("normalizedFinding")));
  assert.ok(errors.some((e) => e.includes("skipReason")));
});

test("WP5 contract: recomputes coverage and rejects stored contradictions", () => {
  const rc = clone(baseRc());
  (rc as any).coverage.wholeInventoryAdmitted = false;
  assert.ok(validateResultContract(rc).some((e) => e.includes("wholeInventoryAdmitted")));

  const rc2 = clone(baseRc());
  (rc2 as any).coverage.presentIds = ["AC-2"];
  assert.ok(validateResultContract(rc2).some((e) => e.includes("presentIds")));
});

test("WP5 contract: rejects malformed execution and raw artifact", () => {
  const rc = clone(baseRc());
  (rc as any).execution.state = "bogus";
  (rc as any).execution.slotId = "";
  (rc as any).rawArtifact = { available: true, rawText: null, rawBytesDigest: null, rawUnavailableCause: null };
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("execution state")));
  assert.ok(errors.some((e) => e.includes("slotId")));
  assert.ok(errors.some((e) => e.includes("available=true requires")));
});

test("WP5 contract: rejects malformed evidence, usage and capacity", () => {
  const rc = clone(baseRc());
  (rc as any).evidence.applicability = "maybe";
  (rc as any).evidence.timestamps = ["not-a-date"];
  (rc as any).usage.inputTokens = -1;
  (rc as any).usage.totalTokens = "many";
  (rc as any).capacity.retentionPolicy = 7;
  const errors = validateResultContract(rc);
  assert.ok(errors.some((e) => e.includes("applicability")));
  assert.ok(errors.some((e) => e.includes("timestamps")));
  assert.ok(errors.some((e) => e.includes("inputTokens")));
  assert.ok(errors.some((e) => e.includes("totalTokens")));
  assert.ok(errors.some((e) => e.includes("retentionPolicy")));
});

test("WP5 coverage: distinguishes missing, duplicate, unknown and invalid IDs", () => {
  const coverage = computeCoverage(["AC-1", "AC-2", "AC-3"], ["AC-1", "AC-1", "AC-4", "", null as unknown as string]);
  assert.deepEqual(coverage.missingIds, ["AC-2", "AC-3"]);
  assert.deepEqual(coverage.duplicateIds, ["AC-1"]);
  assert.deepEqual(coverage.unknownIds, ["AC-4"]);
  assert.equal(coverage.invalidIds.length, 2);
  assert.deepEqual(coverage.individuallyValidIds, []);
  assert.equal(coverage.wholeInventoryAdmitted, false);
});

// --- Scorer dimensions ---

test("WP5 scorer: separates label agreement, mechanical validity and semantic support", () => {
  const rc = baseRc({ references: ["ref-1"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: { "ref-1": UNSUPPORTING },
    artifactRegistry: makeRegistry(rc, { "ref-1": {} }),
  });
  assert.equal(result.labelAgreement[0].agrees, true);
  assert.equal(result.referenceValidity[0].valid, true);
  assert.equal(result.semanticSupport[0].supporting, false);
});

test("WP5 scorer: existing tied but irrelevant reference is mechanically valid and semantically unsupported", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["irrelevant"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { irrelevant: UNSUPPORTING },
    artifactRegistry: makeRegistry(rc, { irrelevant: {} }),
  });
  assert.equal(result.referenceValidity[0].valid, true);
  assert.equal(result.semanticSupport[0].supporting, false);
});

test("WP5 scorer: a contradicting reference is not supporting", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["contradicts"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { contradicts: CONTRADICTING },
    artifactRegistry: makeRegistry(rc, { contradicts: {} }),
  });
  assert.equal(result.referenceValidity[0].valid, true);
  assert.equal(result.semanticSupport[0].supporting, false);
});

test("WP5 scorer: partial subclause coverage is not fully supporting", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["partial"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { partial: PARTIAL },
    artifactRegistry: makeRegistry(rc, { partial: {} }),
  });
  assert.equal(result.semanticSupport[0].supporting, false);
});

test("WP5 scorer: wrong-candidate and wrong-snapshot references are invalid", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["wrong-candidate", "wrong-snapshot"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { "wrong-candidate": SUPPORTING, "wrong-snapshot": SUPPORTING },
    artifactRegistry: makeRegistry(rc, {
      "wrong-candidate": { candidateBinding: "S1-FIX-000000000000" },
      "wrong-snapshot": { snapshotDigest: H("other-snapshot") },
    }),
  });
  assert.ok(result.referenceValidity.every((r) => !r.valid));
});

test("WP5 scorer: missing reference is invalid, not silently valid", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["absent"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { absent: SUPPORTING },
    artifactRegistry: makeRegistry(rc, {}),
  });
  assert.equal(result.referenceValidity[0].valid, false);
  assert.equal(result.referenceValidity[0].reason, "reference not in artifact registry");
});

test("WP5 scorer: without an artifact registry references are not mechanically valid", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["ref-1"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { "ref-1": SUPPORTING },
  });
  assert.equal(result.referenceValidity[0].valid, false);
  assert.equal(result.referenceValidity[0].reason, "no artifact registry");
});

test("WP5 scorer: empty references remain unsupported", () => {
  const rc = baseRc({ references: [] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.ok(result.diagnostics.some((d) => d.includes("no references")));
});

test("WP5 scorer: rubric review provenance and blinding are preserved", () => {
  const rc = baseRc({ references: ["ref-1"] });
  const review: RubricReview = {
    rubricVersion: RUBRIC_VERSION,
    reference: "ref-1",
    decision: SUPPORTING,
    rationale: "covers every subclause",
    reviewer: "blind-reviewer",
    blinded: true,
    reviewedAt: "2026-11-15T00:00:00Z",
  };
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: { "ref-1": SUPPORTING },
    rubricReviews: { "ref-1": review },
    artifactRegistry: makeRegistry(rc, { "ref-1": {} }),
  });
  assert.equal(result.rubricReviews.length, 1);
  assert.equal(result.rubricReviews[0].blinded, true);
  assert.equal(result.rubricReviews[0].rationale, "covers every subclause");
});

// --- Execution-state semantics ---

test("WP5 execution: failed execution withholds the admitted verdict and preserves the claim", () => {
  const rc = baseRc({ claim: "this is a violated claim with details", admitted: "violated", state: "failed" });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.equal(result.executionValid, false);
  assert.equal(result.labelAgreement[0].admittedConclusion, null);
  assert.equal(result.labelAgreement[0].agrees, null);
  assert.equal(result.labelAgreement[0].admitted, false);
  assert.equal(result.labelAgreement[0].reportedClaim, "violated");
  assert.equal(result.reportedClaims.entries[0].parsedClaim, "violated");
  assert.equal(result.reportedClaims.entries[0].comparison, "false-violation");
  assert.equal(result.reportedClaims.entries[0].admitted, false);
  assert.ok(result.diagnostics.some((d) => d.includes("no admitted semantic verdict")));
  assert.equal(rc.assessments[0].originalReportedClaim, "this is a violated claim with details");
});

test("WP5 execution: unknown execution withholds the admitted verdict", () => {
  const rc = baseRc({ claim: "unclear claim", admitted: "inconclusive", state: "unknown" });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.equal(result.labelAgreement[0].admittedConclusion, null);
  assert.equal(result.labelAgreement[0].agrees, null);
  assert.equal(result.labelAgreement[0].reportedClaim, "unknown");
  assert.ok(result.diagnostics.some((d) => d.includes("execution unknown")));
});

test("WP5 execution: cancelled execution never becomes an admitted result", () => {
  const rc = baseRc({ state: "cancelled" });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.equal(result.executionValid, false);
  assert.equal(result.labelAgreement[0].admittedConclusion, null);
  assert.equal(result.admission.admitted, false);
});

test("WP5 execution: a superseded attempt is never admissible", () => {
  const rc = baseRc({ state: "completed", supersededBy: "attempt-2" });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.equal(result.executionValid, false);
  assert.equal(result.labelAgreement[0].agrees, null);
  assert.equal(result.admission.admitted, false);
});

test("WP5 execution: partial execution stays admissible but cannot imply whole-inventory completion", () => {
  const rc = baseRc({ state: "partial", expected: ["AC-1", "AC-2"], present: ["AC-1"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true, "AC-2": true }),
    referenceRubrics: {},
  });
  assert.equal(result.executionValid, true);
  assert.equal(result.coverage.wholeInventoryAdmitted, false);
  assert.equal(result.admission.admitted, false);
  assert.ok(result.diagnostics.some((d) => d.includes("incomplete coverage")));
});

test("WP5 execution: completed full-coverage result is admitted", () => {
  // A conclusion that asserts a polarity must cite a reference and carry support
  // for that specific claim; a bare verdict is never sufficient evidence.
  const rc = baseRc({ references: ["ref-1"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    claimRubrics: { [claimSupportKey("AC-1", "ref-1")]: { ...SUPPORTING, criterionId: "AC-1" } },
    artifactRegistry: makeRegistry(rc, { "ref-1": {} }),
  });
  assert.equal(result.executionValid, true);
  assert.equal(result.admission.admitted, true);
});

test("WP5 execution: isAdmissibleExecution helper", () => {
  assert.equal(isAdmissibleExecution("completed"), true);
  assert.equal(isAdmissibleExecution("partial"), true);
  assert.equal(isAdmissibleExecution("failed"), false);
  assert.equal(isAdmissibleExecution("unknown"), false);
  assert.equal(isAdmissibleExecution("cancelled"), false);
  assert.equal(isAdmissibleExecution("completed", "attempt-2"), false);
});

// --- Truth binding ---

test("WP5 truth: a valid binding joins and scores", () => {
  const rc = baseRc();
  const errors = validateTruthBinding(rc, makeTruthBinding(rc, { "AC-1": true }));
  assert.deepEqual(errors, []);
});

test("WP5 truth: C1 truth supplied for C3 is rejected", () => {
  const rc = baseRc();
  const tb = { ...makeTruthBinding(rc, { "AC-1": true }), canonicalCandidateId: "S1-FIX-000000000000" };
  const result = scoreResult({ resultContract: rc, truthBinding: tb, referenceRubrics: {} });
  assert.equal(result.truthBindingValid, false);
  assert.ok(result.truthBindingErrors.some((e) => e.includes("does not match result contract candidate")));
  assert.equal(result.labelAgreement[0].agrees, null);
  assert.equal(result.reportedClaims.entries[0].comparison, "truth-suspended");
});

test("WP5 truth: a different head digest is rejected", () => {
  const rc = baseRc();
  const tb = { ...makeTruthBinding(rc, { "AC-1": true }), headApplicationDigest: H("other-head") };
  const result = scoreResult({ resultContract: rc, truthBinding: tb, referenceRubrics: {} });
  assert.equal(result.truthBindingValid, false);
  assert.ok(result.truthBindingErrors.some((e) => e.includes("head digest")));
});

test("WP5 truth: a wrong criteria revision is rejected", () => {
  const rc = baseRc();
  const tb = { ...makeTruthBinding(rc, { "AC-1": true }), criteriaRevision: "crit-v2" };
  const result = scoreResult({ resultContract: rc, truthBinding: tb, referenceRubrics: {} });
  assert.equal(result.truthBindingValid, false);
  assert.ok(result.truthBindingErrors.some((e) => e.includes("criteria revision")));
});

test("WP5 truth: duplicate inventory and missing outcomes are rejected", () => {
  const rc = baseRc();
  const dup = { ...makeTruthBinding(rc, { "AC-1": true }), expectedCriterionInventory: ["AC-1", "AC-1"] };
  assert.ok(validateTruthBinding(rc, dup).some((e) => e.includes("duplicates")));

  const missing = makeTruthBinding(rc, {});
  assert.ok(validateTruthBinding(rc, missing).some((e) => e.includes("missing criterion")));
});

test("WP5 truth: strict mode throws on an invalid binding", () => {
  const rc = baseRc();
  const tb = { ...makeTruthBinding(rc, { "AC-1": true }), canonicalCandidateId: "S1-FIX-000000000000" };
  assert.throws(
    () => scoreResult({ resultContract: rc, truthBinding: tb, referenceRubrics: {}, strictTruthBinding: true }),
    /invalid truth binding/,
  );
});

// --- Profile A finding scoring ---

test("WP5 Profile A: supported finding on a known violation is a supported detection", () => {
  const rc = baseRc({
    claim: "satisfied",
    admitted: "satisfied",
    findings: [
      {
        findingId: "f-1",
        nativeComment: "AC-1 fails under load",
        normalizedFinding: "AC-1 fails under load",
        skipped: false,
        skipReason: null,
        qualityFlags: ["needs-review"],
        criterionMapping: "AC-1",
        references: ["ref-valid"],
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    // Support is declared for this exact claim (AC-1 citing ref-valid), not
    // for the reference in general.
    claimRubrics: { [claimSupportKey("AC-1", "ref-valid")]: { ...SUPPORTING, criterionId: "AC-1" } },
    artifactRegistry: makeRegistry(rc, { "ref-valid": {} }),
  });
  const f = result.profileA.findings[0];
  assert.equal(f.findingId, "f-1");
  assert.equal(f.mappingStatus, "mapped");
  assert.equal(f.truthComparison, "matches");
  assert.equal(f.referenceValidity, "valid");
  assert.equal(f.semanticSupport, "supported");
  assert.deepEqual(f.qualityFlags, ["needs-review"]);
  assert.equal(result.profileA.summary.supportedDetections, 1);
  assert.equal(result.profileA.satisfaction, "not-applicable");
  assert.equal(result.profileA.criterionCoverage, "not-applicable");
});

test("WP5 Profile A: finding mapped to a truth-satisfied criterion is a false allegation", () => {
  const rc = baseRc({
    findings: [
      {
        nativeComment: "AC-1 broken",
        normalizedFinding: "AC-1 broken",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "AC-1",
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  const f = result.profileA.findings[0];
  assert.equal(f.mappingStatus, "mapped");
  assert.equal(f.truthComparison, "contradicts");
  assert.notEqual(f.semanticSupport, "supported");
  assert.equal(result.profileA.summary.falseAllegations, 1);
});

test("WP5 Profile A: unmapped genuine finding stays visible and neutral", () => {
  const rc = baseRc({
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
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  const f = result.profileA.findings[0];
  assert.equal(f.mappingStatus, "unmapped");
  assert.equal(f.semanticSupport, "neutral");
  assert.equal(f.truthComparison, "neutral");
  assert.equal(result.profileA.summary.unmapped, 1);
});

test("WP5 Profile A: out-of-scope finding is visible and neutral", () => {
  const rc = baseRc({
    findings: [
      {
        nativeComment: "unrelated UI glitch",
        normalizedFinding: "button UI glitch",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "NONEXISTENT-AC",
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  const f = result.profileA.findings[0];
  assert.equal(f.mappingStatus, "out-of-scope");
  assert.equal(f.truthComparison, "neutral");
  assert.equal(result.profileA.summary.outOfScope, 1);
});

test("WP5 Profile A: skipped finding is not delivered and preserves its reason", () => {
  const rc = baseRc({
    findings: [
      {
        nativeComment: "duplicate check",
        normalizedFinding: "duplicate check",
        skipped: true,
        skipReason: "duplicate of an earlier finding",
        qualityFlags: [],
        criterionMapping: "AC-1",
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.equal(result.profileA.deliveredCount, 0);
  assert.equal(result.profileA.summary.skipped, 1);
  assert.equal(result.profileA.findings[0].skipped, true);
  assert.equal(result.profileA.findings[0].skipReason, "duplicate of an earlier finding");
  assert.ok(result.profileA.findings[0].diagnostics.some((d) => d.includes("duplicate")));
});

test("WP5 Profile A: missing/invalid reference stays invalid and cannot be supported", () => {
  const rc = baseRc({
    claim: "violated",
    admitted: "violated",
    findings: [
      {
        nativeComment: "AC-1 fails",
        normalizedFinding: "AC-1 fails",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "AC-1",
        references: ["missing"],
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { missing: SUPPORTING },
    artifactRegistry: makeRegistry(rc, {}),
  });
  const f = result.profileA.findings[0];
  assert.equal(f.referenceValidity, "invalid");
  assert.notEqual(f.semanticSupport, "supported");
});

test("WP5 Profile A: duplicate/conflicting mappings stay visible and flagged", () => {
  const rc = baseRc({
    findings: [
      {
        findingId: "f-1",
        nativeComment: "AC-1 fails",
        normalizedFinding: "AC-1 fails",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "AC-1",
      },
      {
        findingId: "f-2",
        nativeComment: "AC-1 fails again",
        normalizedFinding: "AC-1 fails again",
        skipped: false,
        skipReason: null,
        qualityFlags: [],
        criterionMapping: "AC-1",
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: {},
  });
  assert.equal(result.profileA.summary.duplicateMappings, 2);
  assert.ok(result.profileA.findings.every((f) => f.duplicateMapping));
  assert.ok(result.profileA.findings.every((f) => f.diagnostics.some((d) => d.includes("duplicate/conflicting"))));
});

test("WP5 Profile A: a raw native finding dropped by normalization is not delivered", () => {
  const rc = baseRc({
    findings: [
      {
        nativeComment: "raw comment that normalization dropped",
        normalizedFinding: null,
        skipped: false,
        skipReason: null,
        qualityFlags: ["normalization-loss"],
        criterionMapping: null,
      },
    ],
  });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  const f = result.profileA.findings[0];
  assert.equal(f.delivered, false);
  assert.equal(f.normalizationDropped, true);
  assert.equal(f.mappingStatus, "invalid");
  assert.equal(result.profileA.deliveredCount, 0);
  assert.equal(result.profileA.summary.normalizationDropped, 1);
  assert.deepEqual(f.qualityFlags, ["normalization-loss"]);
});

test("WP5 Profile A: silence means no finding, not an inconclusive B-style assessment", () => {
  const rc = baseRc();
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  assert.equal(result.profileA.deliveredCount, 0);
  assert.equal(result.profileA.findings.length, 0);
  assert.equal(result.profileA.summary.overallStatus, "complete");
  assert.equal(result.profileA.satisfaction, "not-applicable");
});

// --- Reported-claim accounting ---

test("WP5 accounting: false satisfaction is faithful even with an invalid reference", () => {
  const rc = baseRc({ claim: "satisfied", admitted: "satisfied", references: ["missing"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: {},
    artifactRegistry: makeRegistry(rc, {}),
  });
  const e = result.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-satisfaction");
  assert.equal(e.referenceValid, false);
  assert.equal(result.reportedClaims.falseSatisfaction, 1);
});

test("WP5 accounting: false satisfaction with unavailable evidence", () => {
  const rc = baseRc({ claim: "satisfied", admitted: "satisfied", references: ["ref-x"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: {},
    artifactRegistry: makeRegistry(rc, { "ref-x": { applicable: false } }),
  });
  const e = result.reportedClaims.entries[0];
  assert.equal(e.comparison, "false-satisfaction");
  assert.equal(e.referenceValid, false);
});

test("WP5 accounting: correct claim with an unsupported reference", () => {
  const rc = baseRc({ claim: "violated", admitted: "violated", references: ["ref-u"] });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: { "ref-u": UNSUPPORTING },
    artifactRegistry: makeRegistry(rc, { "ref-u": {} }),
  });
  const e = result.reportedClaims.entries[0];
  assert.equal(e.comparison, "agrees");
  assert.equal(e.referenceValid, true);
  assert.equal(result.semanticSupport[0].supporting, false);
});

test("WP5 accounting: failed execution without a parseable claim", () => {
  const rc = baseRc({ claim: null, admitted: null, state: "failed" });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": false }),
    referenceRubrics: {},
  });
  const e = result.reportedClaims.entries[0];
  assert.equal(e.parsedClaim, "unknown");
  assert.equal(e.accounted, false);
  assert.equal(result.reportedClaims.unparseableUnknownClaims, 1);
});

test("WP5 accounting: unparseable raw output is unknown, never invented", () => {
  const rc = baseRc({ claim: "the code maybe possibly broken??", admitted: "inconclusive" });
  const result = scoreResult({
    resultContract: rc,
    truthBinding: makeTruthBinding(rc, { "AC-1": true }),
    referenceRubrics: {},
  });
  const e = result.reportedClaims.entries[0];
  assert.equal(e.parsedClaim, "unknown");
  assert.equal(e.comparison, "unknown-claim");
  assert.equal(result.reportedClaims.correctReportedClaims, 0);
});

test("WP5 accounting: invalid truth binding suspends comparison but keeps the claim", () => {
  const rc = baseRc({ claim: "satisfied", admitted: "satisfied" });
  const tb = { ...makeTruthBinding(rc, { "AC-1": false }), headApplicationDigest: "WRONG" };
  const result = scoreResult({ resultContract: rc, truthBinding: tb, referenceRubrics: {} });
  const e = result.reportedClaims.entries[0];
  assert.equal(e.comparison, "truth-suspended");
  assert.equal(e.truthOutcome, null);
  assert.equal(e.parsedClaim, "satisfied");
  assert.equal(e.accounted, true);
  assert.equal(result.reportedClaims.falseSatisfaction, 0);
});

// --- Versions ---

test("WP5 versions: scorer and rubric versions are stable", () => {
  assert.equal(SCORER_VERSION, "scorer-v2");
  assert.equal(RUBRIC_VERSION, "rubric-v1");
  assert.equal(isReferenceSupporting(evaluateRubric(SUPPORTING)), true);
  assert.equal(isReferenceSupporting(evaluateRubric(PARTIAL)), false);
  assert.equal(isReferenceSupporting(evaluateRubric(CONTRADICTING)), false);
});