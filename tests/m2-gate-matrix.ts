/**
 * Mandatory admission-gate matrix (M2 targeted corrective pass).
 *
 * For every mandatory gate the same three things are asserted:
 *
 *   1. a positive control admits normally,
 *   2. failing ONLY that gate rejects the affected individual decision, and the
 *      reported failure identifies that exact gate, and
 *   3. the aggregate decision follows the documented policy, while an unrelated
 *      valid claim/finding keeps its correct accounting.
 *
 * Policy under test:
 *
 *   - Profile B: the result is admitted only when coverage is complete and every
 *     claim passed every applicable gate. A claim-level failure therefore also
 *     rejects the aggregate, and an admitted aggregate implies every claim was
 *     admitted.
 *   - Profile A: the review-execution decision depends on the run-level gates,
 *     the frozen criterion inventory and the one-to-one occurrence join. A
 *     finding-level failure does NOT reject the review (partial coverage is
 *     explicit), but the finding is never admitted and never becomes a
 *     supported detection.
 *
 * Two simultaneous gate failures are also checked, so a later failure cannot
 * mask an earlier mandatory one.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";

import {
  buildResultContract,
  computeCoverage,
  type AssessmentRecord,
  type FindingRecord,
  type ResultContract,
} from "../src/result-contract.ts";
import {
  claimSupportKey,
  scoreResult,
  type ArtifactRegistry,
  type RubricDecision,
  type TruthBinding,
} from "../src/scorer.ts";
import { artifactReference, buildArtifactRegistry } from "../src/artifact-registry.ts";
import { admitProfileAFindings } from "../src/profile-a-admission.ts";
import { ADMISSION_GATE_POLICY } from "../src/admission-gates.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;
const CANDIDATE = "S1-FIX-audit";
const SNAPSHOT = H("audit-snapshot");
const APP = artifactReference("app.ts");
const SERIALIZER = artifactReference("serializer.ts");
const MISSING = artifactReference("missing.ts");

const SUPPORTING: RubricDecision = {
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const TRUTH: Record<string, boolean> = {
  "AC-1": true,
  "AC-2": false,
  "AC-3": false,
  "AC-4": true,
  "AC-5": true,
};

function files(): { path: string; content: string }[] {
  return [
    { path: "app.ts", content: "export const profile = () => ({ id: 1 });\n" },
    { path: "serializer.ts", content: "export const s = () => ({ role: 'reviewer' });\n" },
  ];
}

function registryFor(options: { candidate?: string; snapshot?: string } = {}): ArtifactRegistry {
  return buildArtifactRegistry({
    binding: {
      candidateBinding: options.candidate ?? CANDIDATE,
      snapshotDigest: options.snapshot ?? SNAPSHOT,
    },
    files: files(),
    allowedPaths: files().map((f) => f.path),
  }).registry;
}

function contract(params: {
  assessments?: AssessmentRecord[];
  findings?: FindingRecord[];
  applicability?: "applicable" | "not_applicable" | "stale";
  criteriaTextDigest?: string;
}): ResultContract {
  const assessments = params.assessments ?? [];
  return buildResultContract({
    subject: { fixtureTaskId: "task-matrix", expectedSubjectInventory: [...CRITERIA] },
    candidate: {
      repositoryMaterializationId: CANDIDATE,
      baseTreeIdentity: H("base"),
      headTreeIdentity: H("head"),
      runtimeSnapshotDigest: SNAPSHOT,
      opaqueFixtureId: CANDIDATE,
    },
    criteria: {
      authoredCriteriaRevision: "crit-v1",
      criteriaTextDigest: params.criteriaTextDigest ?? H("criteria"),
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: H("policy"),
    },
    profile: {
      profileId: "profile-b",
      configurationIdentity: "cfg",
      promptIdentity: "prompt",
      inputIdentity: "input",
      requestedModel: null,
      observedModel: null,
      reasoningConfiguration: {},
      adapterEntryIdentity: "adapter",
    },
    assessments,
    findings: params.findings ?? [],
    coverage: computeCoverage([...CRITERIA], assessments.map((a) => a.expectedCriterionId)),
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
    rawArtifact: { available: true, rawText: "{}", rawBytesDigest: H("{}"), rawUnavailableCause: null },
    evidence: {
      producer: "oracle-O-1",
      candidateBinding: CANDIDATE,
      checkDefinition: H("check"),
      inputScope: "app.ts",
      environment: "node-test",
      observationOutcome: "complete",
      completeness: "complete",
      timestamps: ["2026-01-01T00:00:00Z"],
      references: [],
      applicability: params.applicability ?? "applicable",
      provenance: "fixture",
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

function truthBinding(rc: ResultContract): TruthBinding {
  return {
    canonicalCandidateId: CANDIDATE,
    anonymizedCandidateId: CANDIDATE,
    headApplicationDigest: SNAPSHOT,
    criteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriterionInventory: [...CRITERIA],
    truthVersion: "truth-v1",
    truthDigest: H("truth"),
    truthOutcomes: { ...TRUTH },
  };
}

function assessment(overrides: Partial<AssessmentRecord> & { expectedCriterionId: string }): AssessmentRecord {
  return {
    present: true,
    originalReportedClaim: "satisfied",
    admittedConclusion: "satisfied",
    references: [APP],
    explanation: "because the route exists",
    diagnostics: [],
    ...overrides,
  };
}

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    findingId: "f-1",
    nativeComment: "AC-3: the profile route is missing.",
    normalizedFinding: "AC-3: the profile route is missing.",
    skipped: false,
    skipReason: null,
    qualityFlags: [],
    criterionMapping: "AC-3",
    references: [APP],
    ...overrides,
  };
}

function fullRubrics(): Record<string, RubricDecision> {
  const out: Record<string, RubricDecision> = {};
  for (const id of CRITERIA) out[claimSupportKey(id, APP)] = { ...SUPPORTING, criterionId: id };
  return out;
}

/** AC-1 is the unrelated valid control; AC-3 is the claim under test. */
function validAssessments(): AssessmentRecord[] {
  return [
    assessment({ expectedCriterionId: "AC-1" }),
    assessment({ expectedCriterionId: "AC-3" }),
  ];
}

function runB(params: {
  rc?: ResultContract;
  assessments?: AssessmentRecord[];
  rubrics?: Record<string, RubricDecision>;
  registry?: ArtifactRegistry;
  applicability?: "applicable" | "not_applicable" | "stale";
  expectedCriteriaRevision?: string;
  expectedCriteriaContentDigest?: string;
}) {
  const rc = params.rc ?? contract({ assessments: params.assessments ?? validAssessments(), applicability: params.applicability });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: params.rubrics ?? fullRubrics(),
    artifactRegistry: params.registry ?? registryFor(),
    expectedCriteriaRevision: params.expectedCriteriaRevision,
    expectedCriteriaContentDigest: params.expectedCriteriaContentDigest,
  });
  return { rc, scorer };
}

function claim(scorer: ReturnType<typeof scoreResult>, criterionId: string) {
  return scorer.claimAdmissions.find((c) => c.criterionId === criterionId)!;
}

assert.equal(ADMISSION_GATE_POLICY, "m2-admission-gate-policy-v1");

// ---------------------------------------------------------------------------
// Positive control
// ---------------------------------------------------------------------------

test("gate matrix B: the positive control admits both claims and stays rejected only for incomplete coverage", () => {
  const { scorer } = runB({});
  assert.equal(claim(scorer, "AC-1").consumerAdmitted, true);
  assert.equal(claim(scorer, "AC-3").consumerAdmitted, true);
  assert.equal(scorer.admission.admitted, false, "coverage of 2/5 criteria is partial by policy");
  assert.equal(scorer.admission.primaryFailureGate, "coverage-completeness");
});

// ---------------------------------------------------------------------------
// Per-gate failures
// ---------------------------------------------------------------------------

interface Case {
  gate: string;
  /** Fragments the failure reason must contain. */
  reason: RegExp;
  /** The unrelated control claim stays admitted (run gates invalidate all). */
  controlAdmitted: boolean;
  build(): { rc?: ResultContract; assessments?: AssessmentRecord[]; rubrics?: Record<string, RubricDecision>; registry?: ArtifactRegistry; applicability?: "applicable" | "not_applicable" | "stale"; expectedCriteriaRevision?: string; expectedCriteriaContentDigest?: string };
}

const CASES: Case[] = [
  {
    gate: "contract-schema",
    reason: /schema-valid/,
    controlAdmitted: false,
    build: () => {
      const rc = contract({ assessments: validAssessments() });
      rc.contractId = "";
      return { rc };
    },
  },
  {
    gate: "execution-state",
    reason: /execution not admissible/,
    controlAdmitted: false,
    build: () => {
      const rc = contract({ assessments: validAssessments() });
      rc.execution.state = "failed";
      return { rc };
    },
  },
  {
    gate: "evidence-applicability",
    reason: /evidence not applicable/,
    controlAdmitted: false,
    build: () => ({ assessments: validAssessments(), applicability: "stale" as const }),
  },
  {
    gate: "criteria-revision",
    reason: /criteria revision mismatch/,
    controlAdmitted: false,
    build: () => ({ assessments: validAssessments(), expectedCriteriaRevision: "crit-v2" }),
  },
  {
    gate: "criteria-content-digest",
    reason: /criteria content mismatch/,
    controlAdmitted: false,
    build: () => ({ assessments: validAssessments(), expectedCriteriaContentDigest: H("edited criteria") }),
  },
  {
    gate: "candidate-binding",
    reason: /candidate binding mismatch/,
    controlAdmitted: true,
    build: () => {
      // Only AC-3's artifact belongs to another candidate; AC-1 stays valid.
      const registry = registryFor();
      registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], candidateBinding: "S1-OTHER" };
      return {
        assessments: [
          assessment({ expectedCriterionId: "AC-1" }),
          assessment({ expectedCriterionId: "AC-3", references: [SERIALIZER] }),
        ],
        rubrics: { ...fullRubrics(), [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3" } },
        registry,
      };
    },
  },
  {
    gate: "snapshot-binding",
    reason: /snapshot binding mismatch/,
    controlAdmitted: true,
    build: () => {
      const registry = registryFor();
      registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], snapshotDigest: H("other-snapshot") };
      return {
        assessments: [
          assessment({ expectedCriterionId: "AC-1" }),
          assessment({ expectedCriterionId: "AC-3", references: [SERIALIZER] }),
        ],
        rubrics: { ...fullRubrics(), [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3" } },
        registry,
      };
    },
  },
  {
    gate: "claim-association",
    reason: /invalid claim association/,
    controlAdmitted: true,
    build: () => ({
      assessments: [
        assessment({ expectedCriterionId: "AC-1" }),
        assessment({ expectedCriterionId: "AC-3", explanation: "one" }),
        assessment({ expectedCriterionId: "AC-3", explanation: "two", admittedConclusion: "violated", originalReportedClaim: "violated" }),
      ],
    }),
  },
  {
    gate: "reference-validity",
    reason: /not current|invalid reference/,
    controlAdmitted: true,
    build: () => {
      // The artifact resolves and is bound, but is no longer current: only the
      // reference-validity gate fails.
      const registry = registryFor();
      registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], current: false };
      return {
        assessments: [
          assessment({ expectedCriterionId: "AC-1" }),
          assessment({ expectedCriterionId: "AC-3", references: [SERIALIZER] }),
        ],
        rubrics: { ...fullRubrics(), [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3" } },
        registry,
      };
    },
  },
  {
    gate: "reference-sufficiency",
    reason: /insufficient reference support|no semantic support/,
    controlAdmitted: true,
    build: () => ({
      assessments: [assessment({ expectedCriterionId: "AC-1" }), assessment({ expectedCriterionId: "AC-3" })],
      rubrics: { [claimSupportKey("AC-1", APP)]: { ...SUPPORTING, criterionId: "AC-1" } },
    }),
  },
  {
    gate: "semantic-conclusion",
    reason: /no admitted semantic conclusion/,
    controlAdmitted: true,
    build: () => ({
      assessments: [
        assessment({ expectedCriterionId: "AC-1" }),
        assessment({ expectedCriterionId: "AC-3", admittedConclusion: null }),
      ],
    }),
  },
  {
    gate: "evidence-conflict",
    reason: /contradictory evidence/,
    controlAdmitted: true,
    build: () => ({
      assessments: [
        assessment({ expectedCriterionId: "AC-1" }),
        assessment({ expectedCriterionId: "AC-3", references: [APP, SERIALIZER] }),
      ],
      rubrics: {
        ...fullRubrics(),
        [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3", contradictsClaim: true },
      },
    }),
  },
  {
    gate: "conflict-status",
    reason: /conflict group/,
    controlAdmitted: true,
    build: () => ({
      assessments: [
        assessment({ expectedCriterionId: "AC-1" }),
        assessment({
          expectedCriterionId: "AC-3",
          conflict: { group: "cc-matrix", kind: "conflicting-duplicate", occurrences: 2, indexes: [1, 2], reason: "matrix fixture" },
        }),
      ],
    }),
  },
];

for (const c of CASES) {
  test(`gate matrix B: failing only ${c.gate} rejects the claim and the aggregate, and names the gate`, () => {
    const { scorer } = runB(c.build());
    const affected = claim(scorer, "AC-3");
    assert.equal(affected.consumerAdmitted, false, `AC-3 must reject on ${c.gate}`);
    assert.equal(affected.primaryFailureGate, c.gate, `the failure must identify ${c.gate}`);
    assert.match(affected.reason, c.reason);
    const gateOutcomes = affected.gates.filter((g) => g.id === c.gate);
    assert.ok(gateOutcomes.length > 0, "the gate outcome must be reported");
    assert.equal(
      gateOutcomes.some((g) => g.status === "fail"),
      true,
      `the ${c.gate} gate must be recorded as failed`,
    );

    const control = claim(scorer, "AC-1");
    assert.equal(control.consumerAdmitted, c.controlAdmitted, `AC-1 expectation for ${c.gate}`);
    assert.equal(control.originalReportedClaim, "satisfied", "the original claim is still accounted for");

    assert.equal(scorer.admission.admitted, false, `the aggregate must follow ${c.gate}`);
  });
}

test("gate matrix B: a pure coverage failure rejects the aggregate while every present claim stays admitted", () => {
  const { scorer } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-1" }), assessment({ expectedCriterionId: "AC-3" })],
  });
  assert.equal(claim(scorer, "AC-1").consumerAdmitted, true);
  assert.equal(claim(scorer, "AC-3").consumerAdmitted, true);
  assert.equal(scorer.admission.admitted, false);
  assert.equal(scorer.admission.primaryFailureGate, "coverage-completeness");
  assert.match(scorer.admission.reason, /incomplete coverage/);
});

test("gate matrix B: two simultaneous failures are both reported and neither is masked", () => {
  const { scorer } = runB({
    assessments: [
      assessment({ expectedCriterionId: "AC-1" }),
      assessment({ expectedCriterionId: "AC-3", references: [MISSING] }),
    ],
    expectedCriteriaRevision: "crit-v2",
  });
  const affected = claim(scorer, "AC-3");
  assert.equal(affected.consumerAdmitted, false);
  const failing = affected.gates.filter((g) => g.status === "fail").map((g) => g.id);
  assert.ok(failing.includes("criteria-revision"), `expected criteria-revision, got ${failing.join(", ")}`);
  assert.ok(failing.includes("reference-validity"), `expected reference-validity, got ${failing.join(",")}`);
  // The first mandatory failure in policy order is the one reported.
  assert.equal(affected.primaryFailureGate, "criteria-revision");
  assert.equal(scorer.admission.admitted, false);
});

// ---------------------------------------------------------------------------
// Profile A matrix
// ---------------------------------------------------------------------------

function runA(params: {
  findings?: FindingRecord[];
  rubrics?: Record<string, RubricDecision>;
  registry?: ArtifactRegistry;
  applicability?: "applicable" | "not_applicable" | "stale";
  criteriaTextDigest?: string;
  expectedCriteriaRevision?: string;
  expectedSnapshot?: string;
  executionState?: "completed" | "partial" | "cancelled" | "failed" | "unknown";
}) {
  const rc = contract({
    findings: params.findings ?? [finding()],
    applicability: params.applicability,
    criteriaTextDigest: params.criteriaTextDigest,
  });
  if (params.executionState !== undefined) rc.execution.state = params.executionState;
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: params.rubrics ?? { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    artifactRegistry: params.registry ?? registryFor(),
  });
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer,
    registry: params.registry ?? registryFor(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: params.expectedSnapshot ?? SNAPSHOT,
    expectedCriteriaRevision: params.expectedCriteriaRevision ?? rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  return { rc, scorer, decision };
}

test("gate matrix A: the positive control admits the finding and the review", () => {
  const { decision } = runA({});
  assert.equal(decision.admitted, true);
  assert.equal(decision.findings[0].admitted, true);
  assert.equal(decision.findings[0].reviewAdmitted, true);
  assert.equal(decision.findings[0].gates.every((g) => g.status !== "fail"), true);
});

// The contract-schema case needs a mutated contract, so it is asserted directly.
test("gate matrix A: an invalid contract rejects the review and the finding", () => {
  const rc = contract({ findings: [finding()] });
  rc.contractId = "";
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    artifactRegistry: registryFor(),
  });
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer,
    registry: registryFor(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: SNAPSHOT,
    expectedCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  assert.equal(decision.findings[0].primaryFailureGate, "contract-schema");
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(decision.admitted, false);
  assert.equal(decision.primaryFailureGate, "contract-schema");
});

const A_RUN_CASES: { gate: string; reason: RegExp; build(): Parameters<typeof runA>[0] }[] = [
  {
    gate: "execution-state",
    reason: /execution not admissible/,
    build: () => ({ findings: [finding()], executionState: "cancelled" as const }),
  },
  {
    gate: "evidence-applicability",
    reason: /evidence not applicable/,
    build: () => ({ findings: [finding()], applicability: "stale" as const }),
  },
  {
    gate: "criteria-revision",
    reason: /criteria revision mismatch/,
    build: () => ({ findings: [finding()], expectedCriteriaRevision: "crit-v2" }),
  },
];

for (const c of A_RUN_CASES) {
  test(`gate matrix A: failing only ${c.gate} rejects the finding, the detection and the review`, () => {
    const { decision } = runA(c.build());
    const d = decision.findings[0];
    assert.equal(d.admitted, false);
    assert.equal(d.primaryFailureGate, c.gate, `the failure must identify ${c.gate}`);
    assert.match(d.reason, c.reason);
    assert.equal(d.supportedDetection, false);
    assert.equal(decision.admitted, false);
    assert.deepEqual(decision.supportedDetections, []);
    assert.equal(decision.primaryFailureGate, c.gate);
  });
}

// Reference binding is a claim-level gate for Profile A: the review subject is
// still the expected candidate, but the finding's evidence is not.
const A_CLAIM_CASES: { gate: string; reason: RegExp; build(): Parameters<typeof runA>[0] }[] = [
  {
    gate: "candidate-binding",
    reason: /candidate binding mismatch/,
    build: () => {
      const registry = registryFor();
      registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], candidateBinding: "S1-OTHER" };
      return { findings: [finding({ references: [SERIALIZER] })], registry };
    },
  },
  {
    gate: "snapshot-binding",
    reason: /snapshot binding mismatch/,
    build: () => {
      const registry = registryFor();
      registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], snapshotDigest: H("other-snapshot") };
      return { findings: [finding({ references: [SERIALIZER] })], registry };
    },
  },
];

for (const c of A_CLAIM_CASES) {
  test(`gate matrix A: failing only ${c.gate} rejects the finding but not the review subject`, () => {
    const { decision } = runA(c.build());
    const d = decision.findings[0];
    assert.equal(d.admitted, false);
    assert.equal(d.primaryFailureGate, c.gate);
    assert.match(d.reason, c.reason);
    assert.equal(d.supportedDetection, false);
    assert.equal(decision.admitted, true, "the review subject is still the expected candidate");
    assert.deepEqual(decision.supportedDetections, []);
  });
}

// A claim-level failure keeps the review admitted (explicit partial coverage),
// but the affected finding is never admitted and never becomes a detection.
test("gate matrix A: a claim-level failure keeps the review admitted but yields no detection", () => {
  const registry = registryFor();
  registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], applicable: false };
  const { decision } = runA({
    findings: [finding({ findingId: "f-not-applicable", references: [SERIALIZER] })],
    rubrics: { [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3" } },
    registry,
  });
  const d = decision.findings[0];
  assert.equal(d.primaryFailureGate, "reference-validity");
  assert.equal(d.admitted, false);
  assert.equal(d.reviewAdmitted, true);
  assert.equal(decision.admitted, true, "one rejected finding does not invalidate the review");
  assert.deepEqual(decision.supportedDetections, [], "partial coverage never implies admission");
});

test("gate matrix A: a claim-level failure does not affect an unrelated valid finding", () => {
  const registry = registryFor();
  registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], current: false };
  const { decision } = runA({
    findings: [
      finding({ findingId: "f-bad", criterionMapping: "AC-3", references: [SERIALIZER] }),
      finding({ findingId: "f-good", criterionMapping: "AC-1", nativeComment: "AC-1: ok", normalizedFinding: "AC-1: ok" }),
    ],
    rubrics: {
      [claimSupportKey("AC-1", APP)]: { ...SUPPORTING, criterionId: "AC-1" },
      [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3" },
    },
    registry,
  });
  const good = decision.findings.find((f) => f.findingId === "f-good")!;
  const bad = decision.findings.find((f) => f.findingId === "f-bad")!;
  assert.equal(bad.admitted, false);
  assert.equal(good.admitted, true, "an independent finding keeps its own admission");
  assert.equal(decision.admittedFindings, 1);
  assert.equal(decision.rejectedFindings, 1);
  assert.deepEqual(decision.supportedDetections, [], "AC-1 is satisfied in Truth, so it is not a detection");
});

test("gate matrix A: duplicate mapping rejects both findings without rejecting the review", () => {
  const shared = { criterionMapping: "AC-3", references: [APP] };
  const { decision } = runA({
    findings: [
      finding({ findingId: "f-a", ...shared }),
      finding({ findingId: "f-b", ...shared, nativeComment: "AC-3: also missing." }),
    ],
    rubrics: {
      [claimSupportKey("AC-3", APP, "f-a")]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-a" },
    },
  });
  assert.equal(decision.findings.every((f) => f.primaryFailureGate === "claim-association"), true);
  assert.equal(decision.admittedFindings, 0);
  assert.equal(decision.admitted, true, "the review itself is still admissible");
  assert.deepEqual(decision.supportedDetections, []);
});

test("gate matrix A: two simultaneous failures are both reported", () => {
  const registry = registryFor();
  registry.artifacts[SERIALIZER] = { ...registry.artifacts[SERIALIZER], current: false };
  const { decision } = runA({
    findings: [finding({ findingId: "f-two", references: [SERIALIZER] })],
    rubrics: { [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3" } },
    registry,
    expectedCriteriaRevision: "crit-v2",
  });
  const d = decision.findings[0];
  const failing = d.gates.filter((g) => g.status === "fail").map((g) => g.id);
  assert.ok(failing.includes("criteria-revision"));
  assert.ok(failing.includes("reference-validity"));
  assert.equal(d.primaryFailureGate, "criteria-revision");
  assert.equal(decision.admitted, false);
});
