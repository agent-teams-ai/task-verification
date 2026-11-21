/**
 * M2 targeted corrective pass — the maintainer's exact reproductions.
 *
 * Each test reproduces a counterexample reported on `268d4ba` using the same
 * pure fixture constructors the review used, then asserts the corrected
 * outcome. The fixtures are ordinary result contracts: no Truth outcome is
 * changed and no identifier is silently renumbered.
 *
 *   1. Profile A: support transferred between FINDINGS that share an external
 *      `findingId` (last-write-wins map keyed by the display id), plus the
 *      compatibility `referenceRubrics` path that ignored a foreign findingId.
 *   2. Profile B: a conflicting duplicate was retained in raw diagnostics but
 *      dropped before the contract, so coverage recomputed without it and the
 *      first claim was admitted with no duplicate diagnostic.
 *   3. Profile A/B mandatory gates diverged: the aggregate used the contract's
 *      own revision, and Profile A omitted schema validity from admission.
 *   4. Native transcript: content delivery was inferred from the expected
 *      snapshot instead of an observed tool result (see
 *      `tests/native-tool-transcript.ts` for the negative controls).
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
  type ScorerResult,
  type TruthBinding,
} from "../src/scorer.ts";
import { artifactReference, buildArtifactRegistry } from "../src/artifact-registry.ts";
import { admitProfileAFindings } from "../src/profile-a-admission.ts";
import { decodeProfileBAssessments } from "../src/profile-b-decode.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;
const CANDIDATE = "S1-FIX-audit";
const SNAPSHOT = H("audit-snapshot");
const APP = artifactReference("app.ts");
const SERIALIZER = artifactReference("serializer.ts");

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
  criteriaRevision?: string;
  inputIdentity?: string;
}): ResultContract {
  const assessments = params.assessments ?? [];
  return buildResultContract({
    subject: { fixtureTaskId: "task-audit", expectedSubjectInventory: [...CRITERIA] },
    candidate: {
      repositoryMaterializationId: CANDIDATE,
      baseTreeIdentity: H("base"),
      headTreeIdentity: H("head"),
      runtimeSnapshotDigest: SNAPSHOT,
      opaqueFixtureId: CANDIDATE,
    },
    criteria: {
      authoredCriteriaRevision: params.criteriaRevision ?? "crit-v1",
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
      inputIdentity: params.inputIdentity ?? "input",
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
    rawArtifact: {
      available: true,
      rawText: "{}",
      rawBytesDigest: H("{}"),
      rawUnavailableCause: null,
    },
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

function assessment(
  overrides: Partial<AssessmentRecord> & { expectedCriterionId: string },
): AssessmentRecord {
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

function allClaimRubrics(): Record<string, RubricDecision> {
  const out: Record<string, RubricDecision> = {};
  for (const id of CRITERIA) out[claimSupportKey(id, APP)] = { ...SUPPORTING, criterionId: id };
  return out;
}

function scoreA(params: {
  findings: FindingRecord[];
  rubrics: Record<string, RubricDecision>;
  referenceRubrics?: Record<string, RubricDecision>;
  registry?: ArtifactRegistry;
  criteriaRevision?: string;
  inputIdentity?: string;
  expectedCriteriaRevision?: string;
}) {
  const rc = contract({
    findings: params.findings,
    criteriaRevision: params.criteriaRevision,
    inputIdentity: params.inputIdentity,
  });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: params.rubrics,
    referenceRubrics: params.referenceRubrics,
    artifactRegistry: params.registry ?? registryFor(),
    expectedCriteriaRevision: params.expectedCriteriaRevision,
  });
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer,
    registry: params.registry ?? registryFor(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: SNAPSHOT,
    expectedCriteriaRevision: params.expectedCriteriaRevision ?? rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  return { rc, scorer, decision };
}

// ===========================================================================
// 1. Profile A — finding identity can no longer transfer support
// ===========================================================================

test("repro A1 (maintainer): two findings sharing one external id get their own scored conclusions and support", () => {
  // First: AC-1, unsupported, Truth says AC-1 is satisfied → `contradicts`.
  // Second: AC-3, supported, Truth says AC-3 is violated → `matches`.
  const findings: FindingRecord[] = [
    finding({
      findingId: "f-1",
      criterionMapping: "AC-1",
      nativeComment: "AC-1: the profile route is missing.",
      normalizedFinding: "AC-1: the profile route is missing.",
    }),
    finding({
      findingId: "f-1",
      criterionMapping: "AC-3",
      nativeComment: "AC-3: the profile route is missing.",
      normalizedFinding: "AC-3: the profile route is missing.",
    }),
  ];
  // One occurrence-scoped decision for the AC-3 occurrence only.
  const first = scoreA({
    findings,
    rubrics: {},
  });
  const occurrences = first.scorer.profileA.findings.map((f) => f.occurrenceId);
  assert.equal(new Set(occurrences).size, 2, "each occurrence has its own internal identity");
  assert.equal(first.scorer.profileA.findings.filter((f) => f.findingIdAmbiguous).length, 2);

  const second = scoreA({
    findings,
    rubrics: {
      [claimSupportKey("AC-3", APP, "f-1", occurrences[1])]: {
        ...SUPPORTING,
        criterionId: "AC-3",
        findingId: "f-1",
        occurrenceId: occurrences[1],
      },
    },
  });

  const scored = second.scorer.profileA.findings;
  assert.equal(scored[0].criterionMapping, "AC-1");
  assert.equal(scored[0].semanticSupport, "unsupported", "the first occurrence inherits nothing");
  assert.equal(scored[0].truthComparison, "contradicts");
  assert.equal(scored[1].criterionMapping, "AC-3");
  assert.equal(scored[1].semanticSupport, "supported");
  assert.equal(scored[1].truthComparison, "matches");

  const d = second.decision.findings;
  assert.equal(d.length, 2, "both raw findings keep a decision");
  assert.notEqual(d[0].occurrenceId, d[1].occurrenceId);
  assert.equal(d[0].criterionId, "AC-1", "the first admission is not the second scored record");
  assert.equal(d[0].admitted, false, "the unsupported occurrence is not admitted");
  assert.equal(d[0].supportedDetection, false);
  assert.equal(d[0].semanticSupported, false);
  assert.equal(d[1].criterionId, "AC-3");
  assert.equal(d[1].admitted, true);
  assert.equal(d[1].supportedDetection, true);
  assert.deepEqual(second.decision.supportedDetections, ["f-1"], "one detection, not two");
  assert.equal(second.decision.supportedDetectionOccurrences.length, 1);
  assert.equal(second.decision.admittedFindings, 1);
});

test("repro A1b (maintainer): an explicit `finding-1` colliding with a generated id still joins one-to-one", () => {
  const findings: FindingRecord[] = [
    finding({ findingId: "finding-1", criterionMapping: "AC-1" }),
    // Unnamed second finding at index 1 → generated id `finding-1` as well.
    { ...finding({ criterionMapping: "AC-3" }), findingId: undefined },
  ];
  const { scorer, decision } = scoreA({ findings, rubrics: {} });
  const occurrences = scorer.profileA.findings.map((f) => f.occurrenceId);
  assert.equal(scorer.profileA.findings.length, 2);
  assert.equal(new Set(occurrences).size, 2, "the generated id collision does not collapse the occurrences");
  assert.equal(scorer.profileA.findings.every((f) => f.findingId === "finding-1"), true);
  assert.equal(scorer.profileA.findings.every((f) => f.findingIdAmbiguous), true);
  // Each raw finding is joined to its own scored record, not to the last one.
  assert.equal(decision.findings[0].criterionId, "AC-1");
  assert.equal(decision.findings[1].criterionId, "AC-3");
  assert.equal(decision.findings[0].occurrenceId, occurrences[0]);
  assert.equal(decision.findings[1].occurrenceId, occurrences[1]);
  assert.equal(decision.findings.every((f) => f.admitted === false), true, "no occurrence is admitted without its own support");
});

test("repro A2: the same external id in different candidates keeps distinct occurrence provenance", () => {
  const runFor = (inputIdentity: string) => {
    const rc = contract({ findings: [finding({ findingId: "f-dup" })], inputIdentity });
    const scorer = scoreResult({
      resultContract: rc,
      truthBinding: truthBinding(rc),
      claimRubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
      artifactRegistry: registryFor(),
    });
    return admitProfileAFindings({
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
  };
  const one = runFor("candidate-one-input");
  const two = runFor("candidate-two-input");
  assert.equal(one.findings[0].admitted, true);
  assert.equal(two.findings[0].admitted, true);
  assert.notEqual(
    one.findings[0].occurrenceId,
    two.findings[0].occurrenceId,
    "occurrence provenance includes the native input identity",
  );
});

test("repro A3: colliding ids on the same criterion are both refused, never transferred", () => {
  const { decision } = scoreA({
    findings: [
      finding({ findingId: "f-collide", criterionMapping: "AC-3" }),
      finding({ findingId: "f-collide", criterionMapping: "AC-3", nativeComment: "AC-3: nothing is validated." }),
    ],
    rubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
  });
  assert.equal(decision.findings.length, 2);
  assert.equal(decision.findings.every((f) => f.duplicateMapping), true);
  assert.equal(decision.findings.every((f) => f.admitted === false), true);
  assert.equal(decision.findings.every((f) => f.supportAmbiguous), true, "a shared judgment is never attributed");
  assert.deepEqual(decision.supportedDetections, []);
  assert.equal(decision.admittedFindings, 0);
});

test("repro A4: a rubric that only names the external id cannot disambiguate a collision", () => {
  const { scorer, decision } = scoreA({
    findings: [
      finding({ findingId: "f-dup", criterionMapping: "AC-1" }),
      finding({ findingId: "f-dup", criterionMapping: "AC-3" }),
    ],
    // `claimSupportKey(criterion, reference)` with no finding scope, plus a
    // finding-scoped entry that names the colliding display id.
    rubrics: {
      [claimSupportKey("AC-3", APP, "f-dup")]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-dup" },
    },
  });
  const ac3 = scorer.profileA.findings.find((f) => f.criterionMapping === "AC-3")!;
  assert.equal(ac3.semanticSupport, "unsupported", "the ambiguous decision is refused");
  assert.equal(ac3.supportAmbiguous, true);
  assert.ok(
    ac3.diagnostics.some((d) => d.includes("identifies more than one finding occurrence")),
    "the ambiguity is diagnosed",
  );
  const d3 = decision.findings.find((f) => f.criterionId === "AC-3")!;
  assert.equal(d3.admitted, false);
  assert.equal(d3.primaryFailureGate, "reference-sufficiency");
  assert.equal(d3.findingIdAmbiguous, true);
});

test("repro A5: a uniquely bound finding-scoped decision is valid", () => {
  const { decision } = scoreA({
    findings: [finding({ findingId: "f-unique", criterionMapping: "AC-3" })],
    rubrics: {
      [claimSupportKey("AC-3", APP, "f-unique")]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-unique" },
    },
  });
  assert.equal(decision.findings[0].semanticSupported, true);
  assert.equal(decision.findings[0].admitted, true);
  assert.equal(decision.supportedDetections.length, 1);
});

test("repro A6: missing occurrence provenance rejects the finding and records the reason", () => {
  const { rc, scorer } = scoreA({
    findings: [finding({ findingId: "f-prov", criterionMapping: "AC-3" })],
    rubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    inputIdentity: "",
  });
  assert.equal(scorer.contractValid, false, "an empty native input identity is not schema-valid");
  // Simulate a scorer whose occurrence join is unavailable for this finding.
  const orphaned: ScorerResult = {
    ...scorer,
    profileA: {
      ...scorer.profileA,
      findings: scorer.profileA.findings.map((f) => ({ ...f, occurrenceId: "fo-unrelated", occurrenceIndex: 99 })),
    },
  };
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer: orphaned,
    registry: registryFor(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: SNAPSHOT,
    expectedCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  assert.equal(decision.occurrencesOneToOne, false);
  assert.equal(decision.findings[0].occurrenceResolved, false);
  assert.equal(decision.findings[0].admitted, false);
  // The empty input identity also breaks the contract schema, which precedes
  // the occurrence gate; both failures are recorded, not hidden.
  assert.equal(decision.findings[0].primaryFailureGate, "contract-schema");
  assert.equal(
    decision.findings[0].gates.some((g) => g.id === "occurrence-identity" && g.status === "fail"),
    true,
  );
  assert.equal(decision.admitted, false);
  assert.match(decision.findings[0].reason, /schema-valid/);
});

test("repro A6b: duplicate occurrence provenance is rejected rather than collapsed", () => {
  const { rc, scorer } = scoreA({
    findings: [
      finding({ findingId: "f-a", criterionMapping: "AC-3" }),
      finding({ findingId: "f-b", criterionMapping: "AC-3" }),
    ],
    rubrics: {},
  });
  const collapsed: ScorerResult = {
    ...scorer,
    profileA: {
      ...scorer.profileA,
      findings: scorer.profileA.findings.map((f) => ({ ...f, occurrenceId: "fo-same" })),
    },
  };
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer: collapsed,
    registry: registryFor(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: SNAPSHOT,
    expectedCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  assert.equal(decision.findings.every((f) => f.occurrenceResolved === false), true);
  assert.equal(decision.findings.every((f) => f.admitted === false), true);
  assert.equal(decision.occurrencesOneToOne, false);
});

test("repro A7 (maintainer): a referenceRubrics decision naming a foreign finding never supports this one", () => {
  const { decision } = scoreA({
    findings: [finding({ findingId: "f-one", criterionMapping: "AC-3" })],
    rubrics: {},
    referenceRubrics: {
      [APP]: { ...SUPPORTING, criterionId: "AC-3", findingId: "not-f-one" },
    },
  });
  assert.equal(decision.findings[0].semanticSupported, false);
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(decision.supportedDetections.length, 0);
});

test("repro A7b: a referenceRubrics decision bound to this exact finding is usable", () => {
  const { decision } = scoreA({
    findings: [finding({ findingId: "f-one", criterionMapping: "AC-3" })],
    rubrics: {},
    referenceRubrics: { [APP]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-one" } },
  });
  assert.equal(decision.findings[0].semanticSupported, true);
  assert.equal(decision.findings[0].admitted, true);
});

// ===========================================================================
// 2. Profile B — duplicate identity survives decoding → contract → admission
// ===========================================================================

const FIXED_REPLY = JSON.stringify({
  assessments: [
    { criterionId: "AC-1", outcome: "satisfied", references: [APP], explanation: "AC-1 ok" },
    { criterionId: "AC-2", outcome: "violated", references: [APP], explanation: "AC-2 missing" },
    { criterionId: "AC-4", outcome: "satisfied", references: [APP], explanation: "AC-4 ok" },
    { criterionId: "AC-5", outcome: "satisfied", references: [APP], explanation: "AC-5 ok" },
  ],
});

/** The real decoding composition: decoder → contract coverage → scorer. */
function runBFromRawReply(raw: string) {
  const decoded = decodeProfileBAssessments(raw, [...CRITERIA]);
  const rc = contract({ assessments: decoded.assessments });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: allClaimRubrics(),
    artifactRegistry: registryFor(),
  });
  return { decoded, rc, scorer };
}

test("repro B1 (maintainer): a sixth conflicting record survives decoding, coverage and admission", () => {
  const raw = JSON.stringify({
    assessments: [
      ...JSON.parse(FIXED_REPLY).assessments,
      { criterionId: "AC-3", outcome: "satisfied", references: [APP], explanation: "AC-3 satisfied" },
      { criterionId: "AC-3", outcome: "violated", references: [SERIALIZER], explanation: "AC-3 violated" },
    ],
  });
  const { decoded, rc, scorer } = runBFromRawReply(raw);

  assert.deepEqual(decoded.duplicateIds, ["AC-3"], "decoder reports the duplicate");
  assert.deepEqual(rc.coverage.duplicateIds, ["AC-3"], "the identity survives into the contract");
  assert.equal(decoded.assessments.filter((a) => a.expectedCriterionId === "AC-3").length, 2);

  const ac3 = scorer.claimAdmissions.filter((c) => c.criterionId === "AC-3");
  assert.equal(ac3.length, 2, "both occurrences reach per-claim admission");
  for (const claim of ac3) {
    assert.equal(claim.claimAssociationValid, false);
    assert.equal(claim.consumerAdmitted, false);
    assert.equal(claim.conflictStatus, "conflicting-duplicate");
    assert.equal(claim.evidenceConflict, false, "the conflict is about the duplicate claim, not the evidence");
    assert.ok(claim.conflictGroup && claim.conflictGroup.startsWith("cc-"));
    assert.ok(claim.diagnostics.some((d) => d.includes("claim association")));
    assert.ok(claim.diagnostics.some((d) => d.includes("conflict group")));
  }
  assert.equal(ac3[0].conflictGroup, ac3[1].conflictGroup, "both occurrences share one conflict group");
  assert.equal(scorer.admission.admitted, false, "aggregate reflects the conflict");
  assert.equal(scorer.admission.primaryFailureGate, "coverage-completeness");

  // Unrelated valid criteria stay individually usable.
  for (const id of ["AC-1", "AC-2", "AC-4", "AC-5"]) {
    const claim = scorer.claimAdmissions.find((c) => c.criterionId === id)!;
    assert.equal(claim.consumerAdmitted, true, `${id} is independent and valid`);
    assert.equal(claim.conflictStatus, "none");
  }
  // Original claims are all preserved.
  assert.equal(rc.assessments.length, 6);
  assert.deepEqual(
    rc.assessments.map((a) => a.originalReportedClaim),
    ["satisfied", "violated", "satisfied", "satisfied", "satisfied", "violated"],
  );
});

test("repro B1x (maintainer, exact): five ordinary assessments for AC-1..AC-5 plus a sixth conflicting AC-3", () => {
  // The maintainer's actual reproduction shape. The first AC-3 occurrence is
  // one of the five ordinary expected assessments; the sixth record is the
  // duplicate AC-3 occurrence that contradicts it. Same composition as
  // `repro B1`: decoder → ResultContract → scorer.
  const raw = JSON.stringify({
    assessments: [
      { criterionId: "AC-1", outcome: "satisfied", references: [APP], explanation: "AC-1 ok" },
      { criterionId: "AC-2", outcome: "violated", references: [APP], explanation: "AC-2 missing" },
      { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "AC-3 route missing" },
      { criterionId: "AC-4", outcome: "satisfied", references: [APP], explanation: "AC-4 ok" },
      { criterionId: "AC-5", outcome: "satisfied", references: [APP], explanation: "AC-5 ok" },
      { criterionId: "AC-3", outcome: "satisfied", references: [SERIALIZER], explanation: "AC-3 route exists" },
    ],
  });
  const { decoded, rc, scorer } = runBFromRawReply(raw);

  // 1. Six raw provider records retained, none rewritten or dropped.
  assert.equal(decoded.rawRecords.length, 6, "six raw provider records are retained");
  assert.equal(decoded.assessments.length, 6, "six usable occurrences survive decoding");
  assert.equal(rc.assessments.length, 6, "six occurrences reach the ResultContract");

  // 2. All six occurrences reach the accounting and admission stages.
  assert.equal(scorer.claimAdmissions.length, 6, "six per-claim admission decisions");
  assert.equal(scorer.reportedClaims.attempted, 6);
  assert.equal(scorer.reportedClaims.entries.length, 6, "six accounting entries");

  // 3./4. The duplicate identity survives decoding and contract coverage.
  assert.deepEqual(decoded.duplicateIds, ["AC-3"], "the decoder reports AC-3 as duplicated");
  assert.deepEqual(rc.coverage.duplicateIds, ["AC-3"], "contract coverage preserves AC-3");
  assert.equal(rc.coverage.wholeInventoryAdmitted, false, "a duplicated criterion is not complete coverage");

  // Provider order is preserved: AC-3 at index 2 (ordinary) and index 5 (sixth).
  assert.deepEqual(
    rc.assessments.map((a) => a.expectedCriterionId),
    ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-3"],
  );

  const ac3 = scorer.claimAdmissions.filter((c) => c.criterionId === "AC-3");
  assert.equal(ac3.length, 2, "both AC-3 occurrences reach per-claim admission");

  // 5. Both occurrences belong to one conflict group, classified as conflicting.
  assert.ok(ac3[0].conflictGroup && ac3[0].conflictGroup.startsWith("cc-"));
  assert.equal(ac3[0].conflictGroup, ac3[1].conflictGroup, "both occurrences share one conflict group");
  assert.equal(ac3[0].conflictStatus, "conflicting-duplicate");
  assert.equal(ac3[1].conflictStatus, "conflicting-duplicate");

  // 6. Neither is consumer-admitted.
  for (const claim of ac3) {
    assert.equal(claim.consumerAdmitted, false, "a conflicted occurrence is never admitted");
    assert.equal(claim.claimAssociationValid, false, "one criterion claimed twice is not a valid association");
    assert.equal(claim.evidenceConflict, false, "the conflict is about the duplicate claim, not the evidence");
    assert.equal(claim.primaryFailureGate, "claim-association");
  }

  // 7. Original wording, status, references and diagnostics are retained.
  assert.equal(rc.assessments[2].originalReportedClaim, "violated");
  assert.equal(rc.assessments[2].admittedConclusion, "violated");
  assert.deepEqual(rc.assessments[2].references, [APP]);
  assert.equal(rc.assessments[2].explanation, "AC-3 route missing");
  assert.equal(rc.assessments[5].originalReportedClaim, "satisfied");
  assert.equal(rc.assessments[5].admittedConclusion, "satisfied");
  assert.deepEqual(rc.assessments[5].references, [SERIALIZER]);
  assert.equal(rc.assessments[5].explanation, "AC-3 route exists");
  assert.equal(ac3[0].originalReportedClaim, "violated");
  assert.equal(ac3[1].originalReportedClaim, "satisfied");
  for (const claim of ac3) {
    assert.ok(claim.diagnostics.some((d) => d.includes("claim association")));
    assert.ok(claim.diagnostics.some((d) => d.includes("conflict group")));
    assert.ok(claim.reason.length > 0);
  }

  // 8. The four unrelated criteria stay individually consumer-admitted.
  for (const id of ["AC-1", "AC-2", "AC-4", "AC-5"]) {
    const claim = scorer.claimAdmissions.filter((c) => c.criterionId === id);
    assert.equal(claim.length, 1);
    assert.equal(claim[0].consumerAdmitted, true, `${id} is independent and passes its own gates`);
    assert.equal(claim[0].conflictStatus, "none");
    assert.equal(claim[0].claimAssociationValid, true);
  }

  // 9. The aggregate is rejected because the required result carries a
  // duplicate/conflicting criterion — not by invalidating the other claims.
  assert.equal(scorer.admission.admitted, false, "the aggregate refuses the duplicated result");
  assert.equal(scorer.admission.primaryFailureGate, "coverage-completeness");
  const coverageGate = scorer.admission.gates?.find((g) => g.id === "coverage-completeness");
  assert.equal(coverageGate?.status, "fail");
  assert.match(coverageGate?.reason ?? "", /incomplete coverage/);
  assert.ok(
    scorer.diagnostics.includes("duplicate IDs: AC-3"),
    "the aggregate records AC-3 as the duplicated/conflicting criterion",
  );
  const claimGate = scorer.admission.gates?.find((g) => g.id === "claim-admission");
  assert.equal(claimGate?.status, "fail", "the aggregate also records that not every claim was admitted");
  assert.match(claimGate?.reason ?? "", /AC-3/);

  // 10. Original reported-claim accounting still contains all six occurrences.
  assert.deepEqual(
    scorer.reportedClaims.entries.map((e) => e.criterionId),
    ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-3"],
  );
  assert.deepEqual(
    scorer.reportedClaims.entries.map((e) => e.originalReportedClaim),
    ["satisfied", "violated", "violated", "satisfied", "satisfied", "satisfied"],
  );
  assert.equal(scorer.reportedClaims.entries.every((e) => e.accounted), true);
  assert.deepEqual(
    scorer.reportedClaims.entries.map((e) => e.consumerAdmitted),
    [true, true, false, true, true, false],
  );
});

test("repro B2: identical duplicates and conflicting duplicates are classified separately", () => {
  const identical = runBFromRawReply(
    JSON.stringify({
      assessments: [
        { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "same" },
        { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "same" },
      ],
    }),
  );
  assert.equal(identical.decoded.conflicts[0].kind, "identical-duplicate");
  assert.equal(identical.scorer.claimAdmissions.length, 2);
  assert.equal(identical.scorer.claimAdmissions.every((c) => c.conflictStatus === "identical-duplicate"), true);
  assert.equal(identical.scorer.claimAdmissions.every((c) => c.consumerAdmitted === false), true);

  const conflicting = runBFromRawReply(
    JSON.stringify({
      assessments: [
        { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "one" },
        { criterionId: "AC-3", outcome: "satisfied", references: [APP], explanation: "two" },
      ],
    }),
  );
  assert.equal(conflicting.decoded.conflicts[0].kind, "conflicting-duplicate");
  assert.equal(conflicting.scorer.claimAdmissions.every((c) => c.consumerAdmitted === false), true);
});

test("repro B3: same criterion, different references and conflicting conclusions", () => {
  const { decoded, scorer } = runBFromRawReply(
    JSON.stringify({
      assessments: [
        { criterionId: "AC-3", outcome: "satisfied", references: [APP], explanation: "route exists" },
        { criterionId: "AC-3", outcome: "violated", references: [SERIALIZER], explanation: "route missing" },
      ],
    }),
  );
  assert.equal(decoded.conflicts[0].kind, "conflicting-duplicate");
  assert.deepEqual(decoded.conflicts[0].referenceSets, [[APP], [SERIALIZER]]);
  assert.equal(scorer.claimAdmissions.length, 2);
  assert.equal(scorer.claimAdmissions.every((c) => c.consumerAdmitted === false), true);
});

test("repro B4: a duplicate with one malformed member is unclassified and still refuses admission", () => {
  const { decoded, scorer } = runBFromRawReply(
    JSON.stringify({
      assessments: [
        { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "valid" },
        { criterionId: "AC-3", outcome: "banana", references: [APP], explanation: "malformed" },
      ],
    }),
  );
  assert.equal(decoded.conflicts[0].kind, "unclassified-duplicate");
  assert.equal(decoded.recordDiagnostics.some((d) => d.conflictKind === "unclassified-duplicate"), true);
  const ac3 = scorer.claimAdmissions.filter((c) => c.criterionId === "AC-3");
  assert.equal(ac3.length, 1, "the usable occurrence is preserved");
  assert.equal(ac3[0].consumerAdmitted, false);
  assert.equal(ac3[0].conflictStatus, "unclassified-duplicate");
});

test("repro B5: three records where two conflict leave the independent criterion usable", () => {
  const { decoded, scorer } = runBFromRawReply(
    JSON.stringify({
      assessments: [
        { criterionId: "AC-1", outcome: "satisfied", references: [APP], explanation: "independent" },
        { criterionId: "AC-3", outcome: "satisfied", references: [APP], explanation: "one" },
        { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "two" },
      ],
    }),
  );
  assert.equal(decoded.conflicts.length, 1);
  assert.equal(decoded.conflicts[0].criterionId, "AC-3");
  assert.equal(decoded.conflicts[0].indexes.length, 2);
  const independent = scorer.claimAdmissions.find((c) => c.criterionId === "AC-1")!;
  assert.equal(independent.consumerAdmitted, true);
  assert.equal(independent.conflictStatus, "none");
  assert.equal(scorer.claimAdmissions.filter((c) => c.criterionId === "AC-3").length, 2);
  assert.equal(scorer.admission.admitted, false);
});

test("repro B6: a conflicting group is never admitted even when one member passes every individual gate", () => {
  const { scorer } = runBFromRawReply(
    JSON.stringify({
      assessments: [
        { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "supported" },
        { criterionId: "AC-3", outcome: "satisfied", references: [APP], explanation: "contradicts" },
      ],
    }),
  );
  for (const claim of scorer.claimAdmissions) {
    // Every non-conflict dimension is individually perfect.
    assert.equal(claim.referenceValid, true);
    assert.equal(claim.referenceSufficient, true);
    assert.equal(claim.semanticConclusionAdmitted, true);
    assert.equal(claim.evidenceConflict, false);
    assert.equal(claim.consumerAdmitted, false, "conflict-status rejects the occurrence");
    assert.equal(claim.gates.find((g) => g.id === "conflict-status")?.status, "fail");
  }
  assert.equal(scorer.admission.admitted, false);
});

// ===========================================================================
// 3. Mandatory gates must agree across individual and aggregate decisions
// ===========================================================================

test("repro C1 (maintainer): an independent expected revision rejects claims AND the aggregate", () => {
  const rc = contract({ assessments: [assessment({ expectedCriterionId: "AC-1" })] });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: allClaimRubrics(),
    artifactRegistry: registryFor(),
    // Contract says crit-v1 (unchanged content); the consumer holds crit-v2.
    expectedCriteriaRevision: "crit-v2",
  });
  const claim = scorer.claimAdmissions[0];
  assert.equal(claim.criteriaRevisionBound, false);
  assert.equal(claim.consumerAdmitted, false);
  assert.equal(claim.primaryFailureGate, "criteria-revision");
  assert.equal(scorer.admission.criteriaMatch, false);
  assert.equal(scorer.admission.admitted, false, "the aggregate must not admit a stale result");
  assert.equal(scorer.admission.primaryFailureGate, "criteria-revision");
});

test("repro C2 (maintainer): an invalid contract rejects review and finding admission, and yields no detection", () => {
  const rc = contract({ findings: [finding({ findingId: "f-1", criterionMapping: "AC-3" })] });
  rc.contractId = "";
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    artifactRegistry: registryFor(),
  });
  assert.equal(scorer.contractValid, false);
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
  assert.equal(decision.admitted, false);
  assert.equal(decision.primaryFailureGate, "contract-schema");
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(decision.findings[0].primaryFailureGate, "contract-schema");
  assert.deepEqual(decision.supportedDetections, []);
});

test("repro C3: a stale revision rejects the review and cannot yield a current supported detection", () => {
  const rc = contract({ findings: [finding({ findingId: "f-stale", criterionMapping: "AC-3" })] });
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
    expectedCriteriaRevision: "crit-v2",
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  assert.equal(decision.criteriaRevisionBound, false);
  assert.equal(decision.admitted, false);
  assert.equal(decision.primaryFailureGate, "criteria-revision");
  assert.equal(decision.findings[0].admitted, false, "a rejected review does not expose an admitted finding");
  assert.equal(decision.findings[0].reviewAdmitted, false);
  assert.deepEqual(decision.supportedDetections, [], "no current supported detection from a stale review");
});

test("repro C4 (maintainer): supporting plus explicitly contradicting evidence is an individual conflict", () => {
  const rc = contract({
    assessments: [assessment({ expectedCriterionId: "AC-3", references: [APP, SERIALIZER] })],
  });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: {
      [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" },
      [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3", contradictsClaim: true },
    },
    artifactRegistry: registryFor(),
  });
  const claim = scorer.claimAdmissions[0];
  assert.equal(claim.referenceValid, true);
  assert.equal(claim.referenceSufficient, false);
  assert.equal(claim.evidenceConflict, true);
  assert.deepEqual(claim.contradictoryReferences, [SERIALIZER]);
  assert.equal(claim.consumerAdmitted, false);
  assert.equal(claim.primaryFailureGate, "evidence-conflict");
  assert.ok(claim.diagnostics.some((d) => d.includes("contradictory evidence")));
  assert.equal(scorer.admission.admitted, false, "aggregate agrees with the individual decision");
});

test("repro C5: an admitted aggregate always implies every claim passed its own gates", () => {
  const rc = contract({
    assessments: [
      assessment({ expectedCriterionId: "AC-1" }),
      assessment({ expectedCriterionId: "AC-2", originalReportedClaim: "violated", admittedConclusion: "violated" }),
    ],
  });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: allClaimRubrics(),
    artifactRegistry: registryFor(),
  });
  // The fixture covers only two of five criteria, so the aggregate is partial.
  assert.equal(scorer.admission.admitted, false);
  const allAdmitted = scorer.claimAdmissions.every((c) => c.consumerAdmitted);
  assert.equal(allAdmitted, true);
  assert.equal(
    scorer.admission.gates?.some((g) => g.id === "coverage-completeness" && g.status === "fail"),
    true,
    "the aggregate fails the coverage gate, and says so",
  );
});

test("repro C6 (maintainer): supporting plus neutral stays admissible; supporting plus an explicit contradiction does not", () => {
  // Both halves use the same finding ids, candidate, snapshot and references.
  // Only the SECOND AC-3 reference's judgment changes between them, and one
  // unrelated AC-1 finding is present throughout as a control.
  const findings: FindingRecord[] = [
    finding({
      findingId: "f-control",
      criterionMapping: "AC-1",
      nativeComment: "AC-1: the profile route is missing.",
      normalizedFinding: "AC-1: the profile route is missing.",
      references: [APP],
    }),
    finding({
      findingId: "f-pair",
      criterionMapping: "AC-3",
      references: [APP, SERIALIZER],
    }),
  ];
  const baseRubrics: Record<string, RubricDecision> = {
    [claimSupportKey("AC-1", APP)]: { ...SUPPORTING, criterionId: "AC-1" },
    [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" },
  };

  // --- Case A: reference A supports, reference B is neutral ---------------
  const neutral = scoreA({ findings, rubrics: baseRubrics });
  const neutralFinding = neutral.scorer.profileA.findings[1];
  assert.equal(neutralFinding.criterionMapping, "AC-3");
  assert.equal(neutralFinding.semanticSupport, "supported", "a neutral second reference does not disturb support");
  assert.equal(neutralFinding.evidenceConflict, false);
  assert.deepEqual(neutralFinding.contradictoryReferences, []);
  assert.equal(neutralFinding.supportAmbiguous, false);

  const neutralDecision = neutral.decision.findings[1];
  assert.equal(neutralDecision.admitted, true, "supporting plus neutral remains admissible");
  assert.equal(neutralDecision.primaryFailureGate, null);
  assert.equal(neutralDecision.semanticSupported, true);
  assert.equal(neutralDecision.supportedDetection, true);
  assert.deepEqual(neutralDecision.references, [APP, SERIALIZER], "both references are preserved");
  assert.equal(
    neutralDecision.gates.find((g) => g.id === "evidence-conflict")?.status,
    "pass",
    "the conflict gate passes when no reference contradicts the claim",
  );
  assert.deepEqual(neutral.decision.supportedDetections, ["f-pair"]);
  assert.equal(neutral.decision.admittedFindings, 2);
  // Case A accounting: one admitted detection, and the scorer summary agrees.
  assert.equal(neutralFinding.supportedDetection, true, "the admitted pair is counted");
  assert.equal(neutral.scorer.profileA.summary.supportedDetections, 1);
  assert.equal(neutral.scorer.profileA.summary.evidenceConflicts, 0);
  assert.equal(neutral.decision.supportedDetections.length, 1);

  // --- Case B: reference A supports, reference B explicitly contradicts ---
  const conflicting = scoreA({
    findings,
    rubrics: {
      ...baseRubrics,
      [claimSupportKey("AC-3", SERIALIZER)]: {
        ...SUPPORTING,
        criterionId: "AC-3",
        contradictsClaim: true,
      },
    },
  });
  const conflictFinding = conflicting.scorer.profileA.findings[1];
  assert.equal(conflictFinding.criterionMapping, "AC-3");
  assert.equal(conflictFinding.semanticSupport, "unsupported", "a positive reference never overrides a contradiction");
  assert.notEqual(conflictFinding.semanticSupport, "neutral", "an explicit contradiction is not neutralised");
  assert.equal(conflictFinding.supportAmbiguous, false);
  assert.equal(conflictFinding.evidenceConflict, true);
  assert.deepEqual(conflictFinding.contradictoryReferences, [SERIALIZER], "the contradicting reference is named");
  assert.ok(
    conflictFinding.diagnostics.some((d) => d.includes("explicit contradiction")),
    "the conflict is diagnosed on the original finding",
  );
  // The original finding and every reference survive the rejection.
  assert.equal(conflictFinding.findingId, "f-pair");
  assert.equal(conflictFinding.nativeComment, "AC-3: the profile route is missing.");
  assert.deepEqual(conflictFinding.normalizedFinding, "AC-3: the profile route is missing.");

  const conflictDecision = conflicting.decision.findings[1];
  assert.equal(conflictDecision.findingId, "f-pair");
  assert.deepEqual(conflictDecision.references, [APP, SERIALIZER], "the contradictory reference is not discarded");
  assert.equal(conflictDecision.evidenceConflict, true);
  assert.deepEqual(conflictDecision.contradictoryReferences, [SERIALIZER]);
  assert.equal(conflictDecision.semanticSupported, false);
  assert.equal(conflictDecision.admitted, false, "the contradictory finding is not admitted as supported");
  assert.equal(conflictDecision.supportedDetection, false, "it is not a supported detection");
  assert.equal(conflictDecision.primaryFailureGate, "evidence-conflict");
  const conflictGate = conflictDecision.gates.find((g) => g.id === "evidence-conflict");
  assert.equal(conflictGate?.status, "fail");
  assert.ok(String(conflictGate?.reason).includes(SERIALIZER), "the gate names the contradicting reference");
  assert.match(conflictDecision.reason, /contradictory evidence/);
  assert.deepEqual(
    conflicting.decision.supportedDetections,
    [],
    "the contradictory finding is excluded from supported detections",
  );
  assert.equal(conflicting.decision.supportedDetectionOccurrences.length, 0);
  // Case B accounting: rejected by its own admission gates, so the scorer
  // summary must not count it either, and no diagnostic may claim it was one.
  assert.equal(conflictFinding.supportedDetection, false, "the contradictory occurrence is not counted");
  assert.equal(conflicting.scorer.profileA.summary.supportedDetections, 0, "summary agrees with admission");
  assert.equal(conflicting.decision.supportedDetections.length, 0);
  assert.equal(conflicting.scorer.profileA.summary.evidenceConflicts, 1);
  // Original scoring accounting is preserved: both findings delivered, both
  // mapped, and the control finding's false allegation unchanged.
  assert.equal(conflicting.scorer.profileA.summary.delivered, 2);
  assert.equal(conflicting.scorer.profileA.summary.mapped, 2);
  assert.equal(conflicting.scorer.profileA.summary.falseAllegations, 1);
  assert.ok(
    !conflictFinding.diagnostics.some((d) => d.includes("→ supported detection")),
    "a rejected finding emits no supported-detection diagnostic",
  );
  const accountingReason = conflictFinding.diagnostics.find((d) => d.includes("not a supported detection"));
  assert.ok(accountingReason, "the accounting decision is explained on the finding");
  assert.ok(
    accountingReason.includes(SERIALIZER),
    `the accounting reason names the contradictory reference: ${accountingReason}`,
  );
  // Finding-level accounting keeps both findings: one rejected, one admitted.
  assert.equal(conflicting.decision.findings.length, 2);
  assert.equal(conflicting.decision.deliveredFindings, 2);
  assert.equal(conflicting.decision.admittedFindings, 1);
  assert.equal(conflicting.decision.rejectedFindings, 1);

  // --- The unrelated finding is unaffected in both cases ------------------
  for (const [label, run] of [
    ["neutral", neutral],
    ["conflicting", conflicting],
  ] as const) {
    const control = run.decision.findings[0];
    assert.equal(control.findingId, "f-control", label);
    assert.equal(control.criterionId, "AC-1", label);
    assert.equal(control.evidenceConflict, false, label);
    assert.equal(control.admitted, true, `${label}: an unrelated finding keeps its decision`);
  }
  assert.equal(neutral.decision.findings[0].reason, conflicting.decision.findings[0].reason);
  // Review-execution admission is a separate decision from finding admission:
  // one rejected finding does not invalidate the review, per existing policy.
  assert.equal(conflicting.decision.admitted, neutral.decision.admitted);

  // The paired accounting table this correction exists to guarantee.
  assert.deepEqual(
    [
      { case: "supporting + neutral", admitted: neutralDecision.admitted, count: neutral.scorer.profileA.summary.supportedDetections },
      { case: "supporting + contradictory", admitted: conflictDecision.admitted, count: conflicting.scorer.profileA.summary.supportedDetections },
    ],
    [
      { case: "supporting + neutral", admitted: true, count: 1 },
      { case: "supporting + contradictory", admitted: false, count: 0 },
    ],
  );
});
