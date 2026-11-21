/**
 * M2 corrective-pass regressions (model-free, cross-platform).
 *
 * One test group per reproduced defect:
 *
 *   1. conservative claim parsing (`not satisfied` is never `satisfied`)
 *   2. claim/criterion-specific semantic support (a shared reference does not
 *      support every claim citing it)
 *   3. criteria CONTENT binding and the stale-assessment regression
 *   4. durable attempt persistence before dispatch, interruption retention
 *   5. complete Profile B provider-bound input
 *   6. provider-output preservation with valid partial records
 *
 * These run in the main suite on every platform: they need no provider, no
 * credential and no Linux-only binary.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  buildResultContract,
  computeCoverage,
  validateResultContract,
  type AssessmentRecord,
  type FindingRecord,
} from "../src/result-contract.ts";
import {
  claimSupportKey,
  parseReportedClaim,
  scoreResult,
  type ArtifactRegistry,
  type RubricDecision,
  type TruthBinding,
} from "../src/scorer.ts";
import { buildArtifactRegistry, artifactReference } from "../src/artifact-registry.ts";
import { admitProfileAFindings } from "../src/profile-a-admission.ts";
import { captureCriteriaSnapshot, criteriaContentDigest, describeCriteriaDrift } from "../src/criteria.ts";
import {
  persistPlanned,
  persistStarted,
  persistTerminal,
  readAttempt,
  verifyAttemptAtDispatch,
} from "../src/attempt-persistence.ts";
import { readLedger, verifyLedgerIntegrity } from "../src/ledger.ts";
import {
  buildProfileBInput,
  changedPathsFromDiff,
  renderProfileBRequestInput,
} from "../src/materialization.ts";
import { decodeProfileBAssessments } from "../src/profile-b-decode.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;

const SUPPORTING: RubricDecision = {
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const APP = artifactReference("app.ts");
const SERIALIZER = artifactReference("serializer.ts");

function appFiles(): { path: string; content: string }[] {
  return [
    { path: "app.ts", content: "export const profile = () => ({ id: 1 });\n" },
    { path: "serializer.ts", content: "export const s = () => ({ role: 'reviewer' });\n" },
    { path: "audit.ts", content: "export const audit = () => 1;\n" },
  ];
}

function registryFor(candidate = "S1-FIX-test", snapshot = H("snapshot")): ArtifactRegistry {
  return buildArtifactRegistry({
    binding: { candidateBinding: candidate, snapshotDigest: snapshot },
    files: appFiles(),
    allowedPaths: appFiles().map((f) => f.path),
  }).registry;
}

const CANDIDATE = "S1-FIX-test";
const SNAPSHOT = H("snapshot");
const TRUTH: Record<string, boolean> = { "AC-1": true, "AC-2": false, "AC-3": false, "AC-4": true, "AC-5": true };

function contract(params: {
  assessments?: AssessmentRecord[];
  findings?: FindingRecord[];
  criteriaTextDigest?: string;
  applicability?: "applicable" | "not_applicable" | "stale";
}) {
  const assessments = params.assessments ?? [];
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: [...CRITERIA] },
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
  assert.deepEqual(validateResultContract(rc), []);
  return rc;
}

function truthBinding(rc: ReturnType<typeof contract>): TruthBinding {
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
    explanation: "because",
    diagnostics: [],
    ...overrides,
  };
}

// --- 1. Conservative claim parsing -----------------------------------------

test("M2 corrective: conservative claim parsing never reads 'not satisfied' as satisfied", () => {
  assert.equal(parseReportedClaim("satisfied"), "satisfied");
  assert.equal(parseReportedClaim("SATISFIED"), "satisfied");
  assert.equal(parseReportedClaim("  Satisfied  "), "satisfied");
  assert.equal(parseReportedClaim("satisfied."), "satisfied");

  assert.equal(parseReportedClaim("not satisfied"), "violated");
  assert.equal(parseReportedClaim("Not Satisfied"), "violated");
  assert.equal(parseReportedClaim("not  satisfied"), "violated");
  assert.equal(parseReportedClaim("is not satisfied"), "violated");
  assert.equal(parseReportedClaim("the criterion is NOT satisfied"), "violated");
  assert.equal(parseReportedClaim("unsatisfied"), "violated");
  assert.equal(parseReportedClaim("violated"), "violated");

  assert.equal(parseReportedClaim("not violated"), "satisfied");

  assert.equal(parseReportedClaim("partially satisfied"), "unknown");
  assert.equal(parseReportedClaim("partly satisfied"), "unknown");
  assert.equal(parseReportedClaim("not fully satisfied"), "unknown");
  assert.equal(parseReportedClaim("inconclusive"), "unknown");
  assert.equal(parseReportedClaim("unknown"), "unknown");
  assert.equal(parseReportedClaim(""), "unknown");
  assert.equal(parseReportedClaim(null), "unknown");
  assert.equal(parseReportedClaim("maybe fine?"), "unknown");
});

test("M2 corrective: 'not satisfied' is accounted as a violation and its wording is preserved", () => {
  const rc = contract({
    assessments: [assessment({ expectedCriterionId: "AC-1", originalReportedClaim: "not satisfied" })],
  });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: { [claimSupportKey("AC-1", APP)]: { ...SUPPORTING, criterionId: "AC-1" } },
    artifactRegistry: registryFor(),
  });
  assert.equal(scorer.reportedClaims.entries[0].parsedClaim, "violated");
  assert.equal(scorer.reportedClaims.reportedSatisfied, 0);
  assert.equal(scorer.reportedClaims.reportedViolated, 1);
  // Truth says AC-1 is satisfied, so this is a false violation — not a pass.
  assert.equal(scorer.reportedClaims.falseViolation, 1);
  // The original wording is untouched.
  assert.equal(scorer.reportedClaims.entries[0].originalReportedClaim, "not satisfied");
  assert.equal(rc.assessments[0].originalReportedClaim, "not satisfied");
});

// --- 2. Claim-specific support ---------------------------------------------

/** One assessment per expected criterion, each citing its deciding artifact. */
function fullAssessments(overrides: Record<string, Partial<AssessmentRecord>> = {}): AssessmentRecord[] {
  return CRITERIA.map((id) =>
    assessment({
      expectedCriterionId: id,
      references: [id === "AC-4" ? SERIALIZER : APP],
      originalReportedClaim: "satisfied",
      ...(overrides[id] ?? {}),
    }),
  );
}

/** Claim-scoped support for every (criterion, deciding artifact) pair. */
function allClaimRubrics(): Record<string, RubricDecision> {
  const out: Record<string, RubricDecision> = {};
  for (const id of CRITERIA) {
    out[claimSupportKey(id, id === "AC-4" ? SERIALIZER : APP)] = { ...SUPPORTING, criterionId: id };
  }
  return out;
}

/**
 * The maintainer's scenario: AC-1 and AC-2 are different criteria whose claims
 * cite the SAME `artifact://app.ts`; the AC-1 claim is true and the AC-2 claim
 * is false (Truth says AC-2 is violated).
 */
function twoCriterionContract() {
  return contract({ assessments: fullAssessments() });
}

test("M2 corrective: a shared reference supports only the claim it was graded for", () => {
  const rc = twoCriterionContract();
  // Every claim is graded except the AC-2 claim about app.ts.
  const rubrics = allClaimRubrics();
  delete rubrics[claimSupportKey("AC-2", APP)];
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: rubrics,
    artifactRegistry: registryFor(),
  });

  const ac1 = scorer.semanticSupport.find((s) => s.criterionId === "AC-1")!;
  const ac2 = scorer.semanticSupport.find((s) => s.criterionId === "AC-2")!;
  assert.equal(ac1.supporting, true);
  assert.equal(ac2.supporting, false, "the false claim must not inherit the true claim's support");
  // Mechanical validity is unchanged for both: the file resolves, the CLAIM fails.
  assert.ok(scorer.referenceValidity.every((r) => r.valid));

  // Reported-claim accounting still records the false satisfactions
  // (AC-2 and AC-3 are both violated per Truth).
  assert.equal(scorer.reportedClaims.falseSatisfaction, 2);
  assert.equal(scorer.reportedClaims.entries[1].originalReportedClaim, "satisfied");
  assert.equal(rc.assessments[1].originalReportedClaim, "satisfied");

  // Admission rejects the result: not every claim's evidence is sufficient.
  assert.equal(scorer.admission.admitted, false);
  assert.equal(scorer.admission.referencesSufficient, false);
  assert.match(scorer.admission.reason, /insufficient reference support/);
});

test("M2 corrective: a reference-level rubric is never transferred to a claim", () => {
  const rc = twoCriterionContract();
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    // Legacy reference-only judgment: it names no criterion, so it cannot
    // support any claim citing app.ts.
    referenceRubrics: { [APP]: SUPPORTING },
    artifactRegistry: registryFor(),
  });
  const appClaims = scorer.semanticSupport.filter((s) => s.reference === APP);
  assert.equal(appClaims.length, 4);
  assert.deepEqual(
    appClaims.map((s) => s.supporting),
    [false, false, false, false],
  );
  assert.match(scorer.semanticSupport[0].reason, /not bound to a claim/);
  assert.equal(scorer.admission.admitted, false);
});

test("M2 corrective: two claim-scoped rubrics keep the result admitted while accounting stays honest", () => {
  const rc = twoCriterionContract();
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: allClaimRubrics(),
    artifactRegistry: registryFor(),
  });
  // Process-valid: both claims are individually supported...
  assert.equal(scorer.semanticSupport.every((s) => s.supporting), true);
  assert.equal(scorer.admission.admitted, true);
  // ...and the wrong claims are still reported as false satisfactions.
  assert.equal(scorer.reportedClaims.falseSatisfaction, 2);
  assert.equal(scorer.reportedClaims.correctReportedClaims, 3);
});

test("M2 corrective: a conclusion without references is not admitted", () => {
  const rc = contract({ assessments: fullAssessments({ "AC-1": { references: [] } }) });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: allClaimRubrics(),
    artifactRegistry: registryFor(),
  });
  assert.equal(scorer.admission.admitted, false);
  assert.match(scorer.admission.reason, /insufficient|invalid/);
  assert.ok(scorer.diagnostics.some((d) => d.includes("AC-1: no references")));
});

// --- 3. Criteria content binding and the stale regression -------------------

const CRITERIA_V1 = [
  { id: "AC-1", text: "GET /profile returns 200 with id and email." },
  { id: "AC-2", text: "GET /profile without a token returns 401." },
  { id: "AC-3", text: "Revoked tokens are rejected." },
  { id: "AC-4", text: "No response contains role or internal." },
  { id: "AC-5", text: "Each rejection writes exactly one audit record." },
];

function profileAFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    findingId: "f-1",
    nativeComment: "AC-3: the revocation list is never consulted.",
    normalizedFinding: "AC-3: the revocation list is never consulted.",
    skipped: false,
    skipReason: null,
    qualityFlags: [],
    criterionMapping: "AC-3",
    references: [APP],
    ...overrides,
  };
}

function profileADecision(params: {
  expected: ReturnType<typeof captureCriteriaSnapshot>;
  submittedDigest: string;
}) {
  const rc = contract({ findings: [profileAFinding()], criteriaTextDigest: params.submittedDigest });
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
    allowedPaths: ["app.ts", "serializer.ts", "audit.ts"],
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: SNAPSHOT,
    expectedCriteriaRevision: params.expected.authoredRevision,
    expectedCriteriaContentDigest: params.expected.contentDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  return { rc, scorer, decision };
}

test("M2 corrective: criteriaTextDigest is derived from content, not from the revision label", () => {
  const a = captureCriteriaSnapshot({ authoredRevision: "crit-v1", criteria: CRITERIA_V1, source: "test" });
  const b = captureCriteriaSnapshot({ authoredRevision: "crit-v1", criteria: CRITERIA_V1, source: "test" });
  assert.equal(a.contentDigest, b.contentDigest);
  assert.notEqual(a.contentDigest, H("crit-v1"), "the digest must not be a digest of the revision label");

  const edited = CRITERIA_V1.map((c) =>
    c.id === "AC-3" ? { ...c, text: "Revoked tokens are rejected within one second." } : c,
  );
  const c = captureCriteriaSnapshot({ authoredRevision: "crit-v1", criteria: edited, source: "test" });
  // Same authored label, same HEAD — different content digest.
  assert.equal(a.authoredRevision, c.authoredRevision);
  assert.notEqual(a.contentDigest, c.contentDigest);
  assert.deepEqual(describeCriteriaDrift(a, c), ["AC-3: text changed"]);
});

test("M2 corrective: an assessment produced against changed criteria content is stale and not admitted", () => {
  const captured = captureCriteriaSnapshot({ authoredRevision: "crit-v1", criteria: CRITERIA_V1, source: "test" });
  // The assessment carries the ORIGINAL content digest.
  const fresh = profileADecision({ expected: captured, submittedDigest: captured.contentDigest });
  assert.equal(fresh.decision.admitted, true, fresh.decision.reason);
  assert.equal(fresh.decision.criteriaContentBound, true);
  assert.equal(fresh.decision.findings[0].supportedDetection, true);

  // One criterion text changes; the revision label and HEAD stay identical.
  const edited = CRITERIA_V1.map((c) =>
    c.id === "AC-3" ? { ...c, text: "Revoked tokens are rejected within one second." } : c,
  );
  const recaptured = captureCriteriaSnapshot({ authoredRevision: "crit-v1", criteria: edited, source: "test" });
  const stale = profileADecision({ expected: recaptured, submittedDigest: captured.contentDigest });

  assert.equal(stale.decision.admitted, false);
  assert.equal(stale.decision.criteriaContentBound, false);
  assert.match(stale.decision.reason, /criteria content mismatch/);
  // A Profile A finding must not remain supported on stale criteria.
  assert.equal(stale.decision.findings[0].admitted, false);
  assert.equal(stale.decision.findings[0].supportedDetection, false);
  assert.deepEqual(stale.decision.supportedDetections, []);
  // Its original claims remain preserved for accounting and audit.
  assert.equal(stale.rc.findings[0].nativeComment, profileAFinding().nativeComment);
  assert.equal(stale.scorer.reportedClaims.entries.length, 0);
  assert.equal(stale.scorer.profileA.findings[0].nativeComment, profileAFinding().nativeComment);
});

test("M2 corrective: shared consumer admission rejects a stale criteria content digest", () => {
  const rc = contract({
    assessments: fullAssessments(),
    criteriaTextDigest: H("stale-criteria-content"),
  });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: allClaimRubrics(),
    // The independently captured current criteria content differs from what
    // this assessment was produced against.
    expectedCriteriaContentDigest: H("current-criteria-content"),
    artifactRegistry: registryFor(),
  });
  assert.equal(scorer.admission.criteriaContentMatch, false);
  assert.equal(scorer.admission.admitted, false);
  assert.match(scorer.admission.reason, /criteria content mismatch/);
});

// --- 4. Durable attempt persistence ----------------------------------------

function tmpLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-ledger-"));
  return path.join(dir, "runs.jsonl");
}

function attemptCtx(ledgerPath: string, requestIdentity = H("request-1")) {
  return {
    identity: {
      runId: "run-1",
      attemptId: "attempt-1",
      profile: "profile-a",
      candidateId: "S1-FIX-test",
      baseTreeIdentity: H("base"),
      headTreeIdentity: H("head"),
      runtimeSnapshotDigest: SNAPSHOT,
      criteriaAuthoredRevision: "crit-v1",
      criteriaContentDigest: H("criteria-content"),
      requestIdentity,
    },
    record: {
      slotId: "slot-1",
      repetition: 1,
      seed: 42,
      subjectInventory: [...CRITERIA],
      criterionInventory: [...CRITERIA],
      policyDigest: H("policy"),
      promptDigest: H("prompt"),
      requestedModel: "model",
      adapterEntryIdentity: "adapter",
      startTimestamp: "2026-01-01T00:00:00Z",
      requestIds: ["req-1"],
      diagnostics: [],
    },
    ledgerPath,
  };
}

test("M2 corrective: planned and started records persist to disk before dispatch", () => {
  const ledgerPath = tmpLedger();
  let dispatched = 0;
  const ctx = attemptCtx(ledgerPath);

  assert.equal(readLedger(ledgerPath).length, 0);
  persistPlanned(ctx);
  // Not yet dispatchable: only `planned` exists.
  assert.throws(() => verifyAttemptAtDispatch(ctx), /attempt_started record is missing/);
  persistStarted(ctx);

  // The durable identity is read FROM DISK at the dispatch boundary.
  const evidence = verifyAttemptAtDispatch(ctx);
  assert.equal(evidence.plannedPersisted, true);
  assert.equal(evidence.startedPersisted, true);
  assert.equal(evidence.verifiedAgainst.criteriaContentDigest, H("criteria-content"));
  dispatched++;
  assert.equal(dispatched, 1);

  const records = readLedger(ledgerPath);
  assert.deepEqual(
    records.map((r) => r.eventType),
    ["planned", "attempt_started"],
  );
  assert.deepEqual(verifyLedgerIntegrity(records), []);
  for (const r of records) {
    assert.equal(r.criteriaContentDigest, H("criteria-content"));
    assert.equal(r.inputDigest, H("request-1"));
    assert.equal(r.criteriaRevision, "crit-v1");
  }

  persistTerminal(ctx, "completed", { endTimestamp: "2026-01-01T00:00:01Z" });
  assert.deepEqual(
    readLedger(ledgerPath).map((r) => r.eventType),
    ["planned", "attempt_started", "attempt_completed"],
  );
});

test("M2 corrective: a dispatch-boundary identity mismatch blocks the dispatch", () => {
  const ledgerPath = tmpLedger();
  const ctx = attemptCtx(ledgerPath);
  persistPlanned(ctx);
  persistStarted(ctx);

  let dispatched = 0;
  const dispatch = (): void => {
    verifyAttemptAtDispatch(ctx, H("a different request"));
    dispatched++;
  };
  assert.throws(dispatch, /request identity/);
  assert.equal(dispatched, 0, "nothing may be dispatched on a mismatched identity");

  // Candidate/profile identity mismatches are refused too.
  const otherCandidate = attemptCtx(ledgerPath);
  otherCandidate.identity.candidateId = "S1-FIX-other";
  assert.throws(() => verifyAttemptAtDispatch(otherCandidate), /candidate/);

  const otherCriteria = attemptCtx(ledgerPath);
  otherCriteria.identity.criteriaContentDigest = H("other criteria");
  assert.throws(() => verifyAttemptAtDispatch(otherCriteria), /criteria content digest/);
});

test("M2 corrective: failure before dispatch leaves no successful-looking lifecycle", () => {
  const ledgerPath = tmpLedger();
  const ctx = attemptCtx(ledgerPath);
  // Pre-dispatch persistence itself fails (unwritable ledger) -> nothing dispatched.
  let dispatched = 0;
  const broken = { ...ctx, ledgerPath: path.join(os.tmpdir(), "does-not-exist", "runs.jsonl") };
  assert.throws(() => {
    persistPlanned(broken);
    dispatched++;
  });
  assert.equal(dispatched, 0);
});

test("M2 corrective: a failed dispatch is retained as a terminal failure", () => {
  const ledgerPath = tmpLedger();
  const ctx = attemptCtx(ledgerPath);
  persistPlanned(ctx);
  persistStarted(ctx);
  persistTerminal(ctx, "failed", { endTimestamp: "2026-01-01T00:00:01Z", diagnostics: ["provider refused"] });
  const records = readLedger(ledgerPath);
  assert.deepEqual(
    records.map((r) => r.eventType),
    ["planned", "attempt_started", "attempt_failed"],
  );
  assert.equal(records[2].executionState, "failed");
  assert.ok(records[2].diagnostics.some((d) => d.includes("provider refused")));
});

test("M2 corrective: an interrupted attempt survives a restart without a terminal record", () => {
  const ledgerPath = tmpLedger();
  const ctx = attemptCtx(ledgerPath);
  persistPlanned(ctx);
  persistStarted(ctx);
  // Process dies here: no terminal record is ever written.

  // A fresh read from the storage path (simulating restart) still sees it.
  const afterRestart = readAttempt(ledgerPath, "attempt-1");
  assert.deepEqual(
    afterRestart.map((r) => r.eventType),
    ["planned", "attempt_started"],
  );
  assert.equal(afterRestart[1].executionState, "started");
  assert.deepEqual(verifyLedgerIntegrity(readLedger(ledgerPath)), []);
  // It can still be closed out honestly after the restart.
  persistTerminal(ctx, "unknown", { endTimestamp: "2026-01-01T00:00:02Z", diagnostics: ["interrupted"] });
  assert.equal(readLedger(ledgerPath).at(-1)!.eventType, "attempt_unknown");
});

test("M2 corrective: a cancelled attempt is retained as cancelled", () => {
  const ledgerPath = tmpLedger();
  const ctx = attemptCtx(ledgerPath);
  persistPlanned(ctx);
  persistStarted(ctx);
  persistTerminal(ctx, "cancelled", { endTimestamp: "2026-01-01T00:00:01Z" });
  const records = readLedger(ledgerPath);
  assert.equal(records.at(-1)!.eventType, "cancelled");
  assert.equal(records.at(-1)!.executionState, "cancelled");
});

// --- 5. Complete Profile B provider-bound input ----------------------------

test("M2 corrective: the Profile B request carries every file, criterion, task, rule and scope field", () => {
  const input = buildProfileBInput("S1-C1");
  const rendered = renderProfileBRequestInput(input);
  const sent = JSON.parse(rendered);

  assert.equal(sent.schema, "profile-b-request-v1");
  assert.equal(sent.files.length, input.headFiles.length);
  for (const f of input.headFiles) {
    const delivered = sent.files.find((x: { path: string }) => x.path === f.path);
    assert.ok(delivered, `missing file ${f.path}`);
    assert.equal(delivered.content, f.content, `${f.path} content was altered`);
    assert.equal(delivered.changed, f.path === "app.ts", `${f.path} changed classification`);
    assert.equal(delivered.role, f.path === "app.ts" ? "changed" : "unchanged-dependency");
  }
  for (const c of input.criteria) {
    const delivered = sent.criteria.find((x: { id: string }) => x.id === c.id);
    assert.ok(delivered, `missing criterion ${c.id}`);
    assert.equal(delivered.text, c.text, `${c.id} text was replaced by an identifier`);
  }
  assert.equal(sent.task.title, input.prTitle);
  assert.equal(sent.task.description, input.prDescription);
  assert.equal(sent.task.background, input.background);
  assert.equal(sent.instructions, input.instruction);
  assert.equal(sent.rules, input.rules);
  assert.deepEqual(sent.changedFiles, ["app.ts"]);
  assert.deepEqual(
    sent.unchangedDependencies,
    ["audit.ts", "authz.ts", "behavior.ts", "serializer.ts", "types.ts"],
  );
  assert.equal(sent.diff, input.baseToHeadDiff);
  assert.ok(Array.isArray(sent.outputSchema.properties.assessments.items.required));
  assert.ok(sent.outputSchema.properties.assessments.items.required.includes("references"));
  assert.ok(sent.outputSchema.properties.assessments.items.required.includes("explanation"));
  // Not an identifier-only payload.
  assert.ok(rendered.length > 5000);
});

test("M2 corrective: changed-path assignment comes from the diff and is not widened", () => {
  const diff = [
    "diff --git a/app.ts b/app.ts",
    "--- a/app.ts",
    "+++ b/app.ts",
    "diff --git a/serializer.ts b/serializer.ts",
    "--- a/serializer.ts",
    "+++ b/serializer.ts",
  ].join("\n");
  assert.deepEqual(changedPathsFromDiff(diff), ["app.ts", "serializer.ts"]);
  assert.deepEqual(changedPathsFromDiff(""), []);
});

// --- 6. Provider output preservation ---------------------------------------

const VALID_REPLY = {
  assessments: [
    { criterionId: "AC-1", outcome: "satisfied", references: [APP], explanation: "route returns id and email" },
    { criterionId: "AC-2", outcome: "satisfied", references: [APP], explanation: "401 without token" },
  ],
};

test("M2 corrective: a fully valid provider reply is preserved verbatim", () => {
  const decoded = decodeProfileBAssessments(JSON.stringify(VALID_REPLY), CRITERIA);
  assert.equal(decoded.unparseable, false);
  assert.equal(decoded.assessments.length, 2);
  assert.deepEqual(decoded.assessments[0].references, [APP]);
  assert.equal(decoded.assessments[0].explanation, "route returns id and email");
  assert.equal(decoded.assessments[0].originalReportedClaim, "satisfied");
  assert.equal(decoded.assessments[1].explanation, "401 without token");
  assert.deepEqual(decoded.missingIds, ["AC-3", "AC-4", "AC-5"]);
});

test("M2 corrective: one malformed record does not discard the valid records", () => {
  const reply = {
    assessments: [
      VALID_REPLY.assessments[0],
      { criterionId: "AC-2", outcome: "banana", references: [APP], explanation: "bad polarity" },
      VALID_REPLY.assessments[1],
    ],
  };
  const decoded = decodeProfileBAssessments(JSON.stringify(reply), CRITERIA);
  assert.equal(decoded.assessments.length, 2, "valid partial records must remain available");
  // The malformed AC-2 record and its valid sibling both claimed AC-2, so the
  // criterion is now a duplicate whose disagreement cannot be classified.
  assert.equal(decoded.rejectedCount, 2);
  assert.equal(decoded.recordDiagnostics[0].index, 1);
  assert.ok(decoded.recordDiagnostics[0].errors.some((e) => e.includes("outcome must be")));
  assert.deepEqual(
    decoded.assessments.map((a) => a.expectedCriterionId),
    ["AC-1", "AC-2"],
  );
  assert.equal(decoded.assessments[0].conflict, undefined, "AC-1 is unaffected");
  assert.equal(decoded.assessments[1].conflict?.kind, "unclassified-duplicate");
  assert.deepEqual(decoded.assessments[1].conflict?.indexes, [1, 2]);
  // The raw rejected record is retained for diagnostics.
  assert.equal((decoded.recordDiagnostics[0].raw as { outcome: string }).outcome, "banana");
});

test("M2 corrective: missing references and missing explanations are diagnosed, not invented", () => {
  const reply = {
    assessments: [
      { criterionId: "AC-1", outcome: "satisfied", explanation: "no reference supplied" },
      { criterionId: "AC-2", outcome: "satisfied", references: [APP] },
    ],
  };
  const decoded = decodeProfileBAssessments(JSON.stringify(reply), CRITERIA);
  assert.equal(decoded.assessments.length, 2);
  assert.deepEqual(decoded.assessments[0].references, [], "no reference may be fabricated");
  assert.ok(decoded.diagnostics.some((d) => d.includes("missing references array")));
  assert.ok(decoded.diagnostics.some((d) => d.includes("missing explanation")));
  assert.equal(decoded.assessments[1].explanation, null);
  assert.equal(decoded.assessments[1].references.length, 1);
});

test("M2 corrective: invalid provider references are preserved and rejected by resolution", () => {
  const reply = {
    assessments: [
      { criterionId: "AC-1", outcome: "satisfied", references: ["artifact://nope.ts"], explanation: "unresolvable" },
      { criterionId: "AC-2", outcome: "satisfied", references: ["not-a-reference"], explanation: "wrong scheme" },
    ],
  };
  const decoded = decodeProfileBAssessments(JSON.stringify(reply), CRITERIA);
  assert.deepEqual(decoded.assessments[0].references, ["artifact://nope.ts"]);
  assert.deepEqual(decoded.assessments[1].references, ["not-a-reference"]);
  const rc = contract({ assessments: decoded.assessments });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: {
      [claimSupportKey("AC-1", "artifact://nope.ts")]: { ...SUPPORTING, criterionId: "AC-1" },
      [claimSupportKey("AC-2", "not-a-reference")]: { ...SUPPORTING, criterionId: "AC-2" },
    },
    artifactRegistry: registryFor(),
  });
  assert.ok(scorer.referenceValidity.every((r) => !r.valid));
  assert.equal(scorer.admission.admitted, false);
});

test("M2 corrective: duplicate and unknown criterion identifiers are reported, not merged", () => {
  const reply = {
    assessments: [
      { criterionId: "AC-1", outcome: "satisfied", references: [APP], explanation: "first" },
      { criterionId: "AC-1", outcome: "violated", references: [APP], explanation: "second" },
      { criterionId: "AC-99", outcome: "satisfied", references: [APP], explanation: "unknown" },
    ],
  };
  const decoded = decodeProfileBAssessments(JSON.stringify(reply), CRITERIA);
  assert.deepEqual(decoded.duplicateIds, ["AC-1"]);
  assert.deepEqual(decoded.unknownIds, ["AC-99"]);
  const ac1 = decoded.assessments.filter((a) => a.expectedCriterionId === "AC-1");
  assert.equal(ac1.length, 2, "neither occurrence may be merged or overwritten");
  assert.deepEqual(ac1.map((a) => a.explanation), ["first", "second"]);
  assert.deepEqual(ac1.map((a) => a.admittedConclusion), ["satisfied", "violated"]);
  assert.equal(ac1[0].conflict?.kind, "conflicting-duplicate");
  assert.equal(ac1[0].conflict?.group, ac1[1].conflict?.group, "both occurrences share one conflict group");
  assert.deepEqual(ac1[0].conflict?.indexes, [0, 1]);
});

test("M2 corrective: partial JSON yields diagnostics and no invented records", () => {
  const decoded = decodeProfileBAssessments('{"assessments":[{"criterionId":"AC-1","outcome":"sati', CRITERIA);
  assert.equal(decoded.unparseable, true);
  assert.equal(decoded.assessments.length, 0);
  assert.equal(decoded.malformedCount, 1);
  assert.ok(decoded.diagnostics.some((d) => d.includes("decode failed")));
  assert.deepEqual(decoded.missingIds, [...CRITERIA]);
});

test("M2 corrective: provider references and explanations round-trip exactly", () => {
  const explanation = 'line one\nline "two" — unicode ✓';
  const references = [APP, SERIALIZER];
  const reply = JSON.stringify({
    assessments: [{ criterionId: "AC-1", outcome: "violated", references, explanation }],
  });
  const decoded = decodeProfileBAssessments(reply, CRITERIA);
  assert.equal(decoded.assessments[0].explanation, explanation);
  assert.deepEqual(decoded.assessments[0].references, references);
  assert.deepEqual(decoded.rawRecords[0], {
    criterionId: "AC-1",
    outcome: "violated",
    references,
    explanation,
  });
});

// --- 7. Criteria digest helpers --------------------------------------------

test("M2 corrective: criteria digest rejects duplicate or empty content", () => {
  assert.throws(
    () => criteriaContentDigest([{ id: "AC-1", text: "a" }, { id: "AC-1", text: "b" }]),
    /duplicate criterion id/,
  );
  assert.throws(() => criteriaContentDigest([{ id: "AC-1", text: "  " }]), /non-empty text/);
  assert.throws(() => criteriaContentDigest([]), /non-empty array/);
});
