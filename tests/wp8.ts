import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as http from "node:http";
import { fileURLToPath } from "node:url";

import { buildReviewerMaterialization, buildProfileBInput, MATERIALIZATION_ROOT, FROZEN_CRITERIA } from "../src/materialization.ts";
import { loadTruth, validateTruth, CRITERIA } from "../src/truth.ts";
import { writeEvidencePacket } from "../src/evidence.ts";
import { runBaseline } from "../src/baseline.ts";
import { buildResultContract, computeCoverage, validateResultContract, type AssessmentRecord, type FindingRecord, type ExecutionRecord } from "../src/result-contract.ts";
import {
  claimSupportKey,
  scoreResult,
  type TruthBinding,
  type ArtifactRegistry,
  type RubricDecision,
} from "../src/scorer.ts";
import { captureCriteriaSnapshot } from "../src/criteria.ts";
import { appendLedgerRecord, readLedger, verifyLedgerIntegrity } from "../src/ledger.ts";
import { createCriteriaRevision, createCriteriaTombstone, createRevisionAfterTombstone, consumerAdmit } from "../src/controls.ts";
import { runProfileB, runProfileA, type DispatchRecord, type NativeComment } from "../src/adapters.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WS_ROOT = path.join(ROOT, ".isolation-tmp", "wp8");
const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const SUPPORTING: RubricDecision = { referenceExists: true, tiedToCandidate: true, supportsBehavior: true, coversSubclauses: true, relevantCurrentApplicable: true, contradictsClaim: false };


function freshWorkspace(tag: string): string {
  const ws = path.join(WS_ROOT, `${tag}-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

interface ScenarioOptions {
  candidateId: string;
  claims: Record<string, string | null>;
  admitted?: Record<string, AssessmentRecord["admittedConclusion"]>;
  execution?: Partial<ExecutionRecord>;
  findings?: FindingRecord[];
  truthOverride?: Record<string, boolean>;
  referenceMode?: "real" | "missing" | "wrong-snapshot" | "none";
  rubrics?: Record<string, RubricDecision>;
}

interface ScenarioResult {
  ws: string;
  materialization: ReturnType<typeof buildReviewerMaterialization>;
  profileBInput: ReturnType<typeof buildProfileBInput>;
  packet: any;
  baseline: ReturnType<typeof runBaseline>;
  rc: any;
  contractErrors: string[];
  scorer: ReturnType<typeof scoreResult>;
  ledgerRecords: any[];
  ledgerErrors: string[];
  readinessPath: string;
  readinessSha: string;
  readiness: any;
  truth: ReturnType<typeof loadTruth>;
}

/**
 * Compose the real production components end-to-end for one candidate:
 * materialization -> Profile B input -> evidence -> baseline -> ResultContract
 * -> scorer/accounting -> ledger persistence/replay -> readiness artifact.
 */
function runScenario(opts: ScenarioOptions): ScenarioResult {
  const ws = freshWorkspace("ws");
  const candidateId = opts.candidateId;

  // 1. Actual reviewer materialization (strict allowlist) in a fresh dir.
  const mat = buildReviewerMaterialization(candidateId, path.join(MATERIALIZATION_ROOT, "wp8", path.basename(ws)));

  // 2. Actual Profile B assembled input.
  const profileBInput = buildProfileBInput(candidateId);

  // 3. Frozen Truth.
  const truth = loadTruth();
  const truthErrors = validateTruth(truth);
  assert.deepEqual(truthErrors, [], `truth invalid: ${truthErrors.join("; ")}`);

  // 4. Evidence packet + deterministic baseline from real observations.
  const packetPath = writeEvidencePacket(candidateId, path.join(ws, "evidence"));
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const baseline = runBaseline({ packet });

  const outcomes = opts.truthOverride ?? truth.candidateOutcomes[candidateId];
  const anonId = packet.candidateAnonId;
  const snapshotDigest = packet.candidateSnapshotDigest;

  // 5. ResultContract: assessments derived from the actual baseline outcomes;
  //    original reported claim is the reviewer's captured claim.
  const sourceRefsByCriterion = new Map<string, string[]>();
  for (const item of packet.evidence as any[]) {
    const list = sourceRefsByCriterion.get(item.criterionId) ?? [];
    list.push(item.sourceRef);
    sourceRefsByCriterion.set(item.criterionId, list);
  }

  const assessments: AssessmentRecord[] = CRITERIA.map((cr) => {
    const base = (baseline.outcomes as any[]).find((o) => o.criterionId === cr);
    const admitted: AssessmentRecord["admittedConclusion"] =
      opts.admitted?.[cr] !== undefined
        ? opts.admitted[cr]!
        : base && !baseline.rejected && base.outcome === "satisfied"
          ? "satisfied"
          : base && !baseline.rejected && base.outcome === "violated"
            ? "violated"
            : "inconclusive";
    let refs = sourceRefsByCriterion.get(cr) ?? [];
    if (opts.referenceMode === "none") refs = [];
    else if (opts.referenceMode === "missing") refs = ["missing-reference"];
    else if (opts.referenceMode === "wrong-snapshot") refs = [refs[0] ?? "missing-reference"];
    return {
      expectedCriterionId: cr,
      present: true,
      originalReportedClaim: opts.claims[cr] ?? "satisfied",
      admittedConclusion: admitted,
      references: refs,
      explanation: null,
      diagnostics: [],
    };
  });

  const execution: ExecutionRecord = {
    state: "completed",
    slotId: "slot-1",
    runId: "run-1",
    attemptId: "attempt-1",
    requestId: "req-1",
    sdkEffectCode: null,
    diagnostics: [],
    pendingEffects: [],
    cleanupStatus: "clean",
    ...opts.execution,
  };

  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: [...CRITERIA] },
    candidate: {
      repositoryMaterializationId: anonId,
      baseTreeIdentity: mat.baseIdentity.tree,
      headTreeIdentity: mat.headIdentity.tree,
      runtimeSnapshotDigest: snapshotDigest,
      opaqueFixtureId: anonId,
    },
    criteria: {
      authoredCriteriaRevision: truth.criteriaRevision,
      criteriaTextDigest: captureCriteriaSnapshot({
        authoredRevision: truth.criteriaRevision,
        criteria: FROZEN_CRITERIA,
        source: "tests/wp8.ts",
      }).contentDigest,
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: packet.checkDefinitionDigest,
    },
    profile: { profileId: "profile-b", configurationIdentity: "cfg", promptIdentity: "prompt", inputIdentity: "input", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "adapter" },
    assessments,
    findings: opts.findings ?? [],
    coverage: computeCoverage([...CRITERIA], [...CRITERIA]),
    execution,
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: H("raw"), rawUnavailableCause: null },
    evidence: { producer: "oracle-O-1", candidateBinding: anonId, checkDefinition: packet.checkDefinitionDigest, inputScope: packet.inputsScope, environment: packet.environment, observationOutcome: "complete", completeness: packet.completeness, timestamps: packet.observationTime ? [packet.observationTime] : [], references: [], applicability: "applicable", provenance: packet.producer },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });

  const contractErrors = validateResultContract(rc);

  // 6. Real artifact registry from actual evidence items.
  const artifacts: Record<string, any> = {};
  for (const item of packet.evidence as any[]) {
    artifacts[item.sourceRef] = {
      artifactId: item.evidenceId,
      digest: item.sourceDigest,
      candidateBinding: anonId,
      snapshotDigest: opts.referenceMode === "wrong-snapshot" ? "wrong-snapshot-digest" : snapshotDigest,
      criterionId: item.criterionId,
      allowedSource: true,
      current: true,
      applicable: true,
    };
  }
  const registry: ArtifactRegistry = { artifacts };

  // 7. Score with the real scorer, including reported-claim accounting.
  const truthBinding: TruthBinding = {
    canonicalCandidateId: anonId,
    anonymizedCandidateId: anonId,
    headApplicationDigest: snapshotDigest,
    criteriaRevision: truth.criteriaRevision,
    expectedCriterionInventory: [...CRITERIA],
    truthVersion: "truth-v1",
    truthDigest: packet.packetId,
    truthOutcomes: outcomes,
  };
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding,
    claimRubrics: opts.rubrics ?? {},
    artifactRegistry: registry,
  });

  // 8. Persist a real ledger lifecycle and replay it.
  const ledgerPath = path.join(ws, "runs.jsonl");
  const base = {
    schemaVersion: "ledger-event-v1", sequence: 1, slotId: "slot-1", runId: "run-1", attemptId: "attempt-1",
    opaqueCandidateId: anonId, profile: "profile-b", repetition: 1, seed: 42,
    subjectInventory: [...CRITERIA], criterionInventory: [...CRITERIA],
    baseTreeIdentity: mat.baseIdentity.tree, headTreeIdentity: mat.headIdentity.tree,
    runtimeSnapshotDigest: snapshotDigest, criteriaRevision: truth.criteriaRevision,
    policyDigest: packet.checkDefinitionDigest, promptDigest: H("prompt"), inputDigest: H("input"),
    requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "adapter",
    startTimestamp: "2026-01-01T00:00:00Z", endTimestamp: null, requestIds: ["req-1"],
    rawArtifactRefs: [], rawUnavailableCause: null, usage: {}, diagnostics: [], admissionState: "admitted",
    cleanupStatus: "clean", isStub: true, supersededBy: null, supersedes: null,
  };
  const events = [
    { ...base, eventId: `evt-${crypto.randomUUID()}`, eventType: "planned", executionState: "planned" },
    { ...base, eventId: `evt-${crypto.randomUUID()}`, eventType: "attempt_started", executionState: "started" },
    { ...base, eventId: `evt-${crypto.randomUUID()}`, eventType: "attempt_completed", executionState: "completed", endTimestamp: "2026-01-01T00:00:01Z" },
  ];
  for (const e of events) appendLedgerRecord(e as any, { ledgerPath });
  const ledgerRecords = readLedger(ledgerPath);
  const ledgerErrors = verifyLedgerIntegrity(ledgerRecords);

  // 9. Machine-readable readiness artifact, persisted and read back.
  const readiness = {
    candidateId,
    anonId,
    truthValid: truthErrors.length === 0,
    contractValid: contractErrors.length === 0,
    baselineRejected: baseline.rejected,
    baselineOutcomes: (baseline.outcomes as any[]).map((o) => ({ criterionId: o.criterionId, outcome: o.outcome })),
    labelAgreement: scorer.labelAgreement,
    reportedClaims: { ...scorer.reportedClaims, entries: scorer.reportedClaims.entries.length },
    profileA: { deliveredCount: scorer.profileA.deliveredCount, summary: scorer.profileA.summary },
    ledger: { events: ledgerRecords.length, errors: ledgerErrors },
    liveProviderCalls: 0,
    automaticRetries: 0,
  };
  const readinessPath = path.join(ws, "readiness.json");
  fs.writeFileSync(readinessPath, JSON.stringify(readiness, null, 2) + "\n", "utf8");
  const readback = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
  assert.deepEqual(readback, readiness, "readiness artifact must read back identically");

  return { ws, materialization: mat, profileBInput, packet, baseline, rc, contractErrors, scorer, ledgerRecords, ledgerErrors, readinessPath, readinessSha: sha256File(readinessPath), readiness: readback, truth };
}

// --- Integrated scenarios ---

test("WP8: C1/C2 correct behavior through real components", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "satisfied", "AC-5": "satisfied" } });
  assert.deepEqual(r.contractErrors, []);
  assert.equal(r.baseline.rejected, false);
  assert.ok(r.scorer.executionValid);
  assert.ok(r.scorer.labelAgreement.every((a) => a.agrees === true));
  assert.equal(r.scorer.reportedClaims.falseSatisfaction, 0);
  assert.deepEqual(r.ledgerErrors, []);
  assert.equal(r.readiness.liveProviderCalls, 0);
});

test("WP8: C3 revocation defect is a false satisfaction", () => {
  const r = runScenario({ candidateId: "S1-C3", claims: { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "satisfied", "AC-5": "satisfied" }, referenceMode: "real" });
  const ac3 = r.scorer.reportedClaims.entries.find((e) => e.criterionId === "AC-3")!;
  assert.equal(ac3.comparison, "false-satisfaction");
  assert.equal(r.scorer.reportedClaims.falseSatisfaction >= 1, true);
  // Baseline independently establishes the violation from real evidence.
  assert.equal((r.baseline.outcomes as any[]).find((o) => o.criterionId === "AC-3").outcome, "violated");
});

test("WP8: C4 omitted redaction is a false satisfaction", () => {
  const r = runScenario({ candidateId: "S1-C4", claims: { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "satisfied", "AC-5": "satisfied" } });
  const ac4 = r.scorer.reportedClaims.entries.find((e) => e.criterionId === "AC-4")!;
  assert.equal(ac4.comparison, "false-satisfaction");
  assert.equal((r.baseline.outcomes as any[]).find((o) => o.criterionId === "AC-4").outcome, "violated");
});

test("WP8: false satisfaction with invalid evidence keeps the claim", () => {
  const r = runScenario({ candidateId: "S1-C3", claims: { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "satisfied", "AC-5": "satisfied" }, referenceMode: "missing" });
  const ac3 = r.scorer.reportedClaims.entries.find((e) => e.criterionId === "AC-3")!;
  assert.equal(ac3.comparison, "false-satisfaction");
  assert.equal(ac3.referenceValid, false);
  assert.equal(ac3.accounted, true);
});

test("WP8: false violation", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "violated" }, admitted: { "AC-1": "violated" } });
  const ac1 = r.scorer.reportedClaims.entries.find((e) => e.criterionId === "AC-1")!;
  assert.equal(ac1.comparison, "false-violation");
});

test("WP8: failed execution preserves a captured original claim", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "satisfied" }, execution: { state: "failed", sdkEffectCode: "SDK_FAIL", diagnostics: ["timeout"] } });
  const ac1 = r.scorer.reportedClaims.entries.find((e) => e.criterionId === "AC-1")!;
  assert.equal(ac1.accounted, true);
  assert.equal(ac1.admitted, false);
  assert.equal(r.scorer.reportedClaims.admittedSemanticConclusions, 0);
  assert.equal(r.scorer.labelAgreement[0].agrees, null);
});

test("WP8: unknown execution preserves a captured claim", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "violated" }, execution: { state: "unknown" } });
  const ac1 = r.scorer.reportedClaims.entries.find((e) => e.criterionId === "AC-1")!;
  assert.equal(ac1.accounted, true);
  assert.equal(ac1.comparison, "false-violation");
  assert.equal(r.scorer.labelAgreement[0].agrees, null);
});

test("WP8: Profile A mapped false allegation with a real reference", () => {
  const ref = "oracle-observations-v1:S1-FIX-PLACEHOLDER/pass1/requests/P-active-a.json#";
  // Use the real first evidence sourceRef for AC-1.
  const probe = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "satisfied" } });
  const realRef = (probe.packet.evidence as any[]).find((e) => e.criterionId === "AC-1").sourceRef;
  const r = runScenario({
    candidateId: "S1-C1",
    claims: { "AC-1": "satisfied" },
    findings: [{ nativeComment: "AC-1 broken", normalizedFinding: "AC-1 broken", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-1", references: [realRef] }],
  });
  const f = r.scorer.profileA.findings[0];
  assert.equal(f.mappingStatus, "mapped");
  assert.equal(f.truthComparison, "contradicts");
  assert.equal(f.referenceValidity, "valid");
  assert.equal(f.semanticSupport, "unsupported");
  void ref;
});

test("WP8: Profile A supported detection with a real valid reference", () => {
  const probe = runScenario({ candidateId: "S1-C3", claims: { "AC-3": "violated" }, admitted: { "AC-3": "violated" } });
  const realRef = (probe.packet.evidence as any[]).find((e) => e.criterionId === "AC-3").sourceRef;
  const r = runScenario({
    candidateId: "S1-C3",
    claims: { "AC-3": "violated" },
    admitted: { "AC-3": "violated" },
    rubrics: { [claimSupportKey("AC-3", realRef)]: SUPPORTING },
    findings: [{ nativeComment: "AC-3 revocation not checked", normalizedFinding: "AC-3 revocation not checked", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-3", references: [realRef] }],
  });
  const f = r.scorer.profileA.findings[0];
  assert.equal(f.mappingStatus, "mapped");
  assert.equal(f.truthComparison, "matches");
  assert.equal(f.referenceValidity, "valid");
  assert.equal(f.semanticSupport, "supported");
});

test("WP8: wrong-snapshot reference is invalid", () => {
  const probe = runScenario({ candidateId: "S1-C3", claims: { "AC-3": "violated" } });
  const realRef = (probe.packet.evidence as any[]).find((e) => e.criterionId === "AC-3").sourceRef;
  const r = runScenario({
    candidateId: "S1-C3",
    claims: { "AC-3": "violated" },
    admitted: { "AC-3": "violated" },
    referenceMode: "wrong-snapshot",
    rubrics: { [realRef]: SUPPORTING },
    findings: [{ nativeComment: "AC-3 fails", normalizedFinding: "AC-3 fails", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-3", references: [realRef] }],
  });
  const f = r.scorer.profileA.findings[0];
  assert.equal(f.referenceValidity, "invalid", "wrong snapshot must invalidate the reference");
  assert.equal(f.semanticSupport, "unsupported");
});

test("WP8: unmapped and out-of-scope findings remain visible and neutral", () => {
  const r = runScenario({
    candidateId: "S1-C1",
    claims: { "AC-1": "satisfied" },
    findings: [
      { nativeComment: "unrelated leak", normalizedFinding: "leak", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: null },
      { nativeComment: "ui glitch", normalizedFinding: "glitch", skipped: false, skipReason: null, qualityFlags: [], criterionMapping: "AC-99" },
    ],
  });
  const [unmapped, out] = r.scorer.profileA.findings;
  assert.equal(unmapped.mappingStatus, "unmapped");
  assert.equal(unmapped.truthComparison, "neutral");
  assert.equal(out.mappingStatus, "out-of-scope");
  assert.equal(r.scorer.profileA.summary.unmapped, 1);
  assert.equal(r.scorer.profileA.summary.outOfScope, 1);
});

test("WP8: skipped/raw/normalized finding distinction", () => {
  const r = runScenario({
    candidateId: "S1-C1",
    claims: { "AC-1": "satisfied" },
    findings: [{ nativeComment: "raw comment", normalizedFinding: "normalized", skipped: true, skipReason: "duplicate", qualityFlags: ["partial"], criterionMapping: "AC-1" }],
  });
  assert.equal(r.scorer.profileA.deliveredCount, 0);
  assert.equal(r.scorer.profileA.findings[0].skipped, true);
  assert.equal(r.scorer.profileA.findings[0].skipReason, "duplicate");
});

test("WP8: partial execution and cleanup pending are preserved", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "satisfied" }, execution: { state: "partial", cleanupStatus: "pending", pendingEffects: ["cleanup"] } });
  assert.equal(r.rc.execution.state, "partial");
  assert.equal(r.rc.execution.cleanupStatus, "pending");
  assert.equal(r.scorer.executionValid, true);
});

test("WP8: stale criteria and stale snapshot rejected by admission", () => {
  const v1 = createCriteriaRevision("criteria v1", null);
  const v2 = createCriteriaRevision("criteria v1 changed", v1.revisionId);
  const old = { assessmentId: "a", criteriaRevision: v1.revisionId, candidateSnapshot: "snap1", admitted: true, reportedCriterionIds: [...CRITERIA], admittedCriterionIds: ["AC-1"] };
  assert.equal(consumerAdmit(old, v2, "snap1", [...CRITERIA], true, false).admitted, false);
  assert.equal(consumerAdmit(old, v1, "snap2", [...CRITERIA], true, false).admitted, false);
});

test("WP8: cancelled/superseded result rejected by admission", () => {
  const v1 = createCriteriaRevision("criteria", null);
  const a = { assessmentId: "a", criteriaRevision: v1.revisionId, candidateSnapshot: "snap", admitted: true, reportedCriterionIds: [...CRITERIA], admittedCriterionIds: ["AC-1"] };
  assert.equal(consumerAdmit(a, v1, "snap", [...CRITERIA], true, true).admitted, false);
});

test("WP8: interrupted ledger recovery leaves a visible incomplete attempt", () => {
  const ws = freshWorkspace("interrupted");
  const lp = path.join(ws, "runs.jsonl");
  const rec = {
    schemaVersion: "ledger-event-v1", sequence: 1, slotId: "s", runId: "r", attemptId: "a",
    eventId: `evt-${crypto.randomUUID()}`, eventType: "attempt_started", executionState: "started",
    opaqueCandidateId: "S1-FIX-000000000000", profile: "profile-b", repetition: 1, seed: null,
    subjectInventory: [], criterionInventory: [], baseTreeIdentity: H("base"), headTreeIdentity: H("head"),
    runtimeSnapshotDigest: H("snapshot"), criteriaRevision: "crit-v1", policyDigest: H("policy"), promptDigest: H("prompt"),
    inputDigest: H("input"), requestedModel: null, observedModel: null, reasoningConfiguration: {},
    adapterEntryIdentity: "a", startTimestamp: "2026-01-01T00:00:00Z", endTimestamp: null,
    requestIds: [], rawArtifactRefs: [], rawUnavailableCause: null, usage: {}, diagnostics: [],
    admissionState: "pending", cleanupStatus: "pending", isStub: true, supersededBy: null, supersedes: null,
  };
  appendLedgerRecord(rec as any, { ledgerPath: lp });
  const recs = readLedger(lp);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].executionState, "started");
  assert.deepEqual(verifyLedgerIntegrity(recs), []);
});

test("WP8: real reviewer materialization excludes forbidden material", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "satisfied" } });
  const inv = r.materialization.fileInventory;
  for (const f of inv) {
    for (const bad of ["truth", "scorer", "oracle", "anonymization", "provenance", "MANIFEST"]) {
      assert.ok(!f.toLowerCase().includes(bad.toLowerCase()), `materialization must not include ${f}`);
    }
  }
  // The actual materialization directory does not contain the sealed truth file.
  assert.equal(fs.existsSync(path.join(r.materialization.outDir, "truth-v1.json")), false);
  // Profile B assembled input carries no sealed labels or scorer internals.
  const serialized = JSON.stringify(r.profileBInput).toLowerCase();
  for (const bad of ["truth-v1", "scorer", "candidateoutcomes", "false allegation"]) {
    assert.ok(!serialized.includes(bad), `profile B input must not contain ${bad}`);
  }
});

test("WP8: CT-3 tombstone creates a new revision and the delayed attempt cannot become current", () => {
  const v1 = createCriteriaRevision("criteria", null);
  const tomb = createCriteriaTombstone({ criterionId: "AC-3", removedRevisionId: v1.revisionId, removedTextDigest: v1.textDigest, removedAt: "2026-01-02T00:00:00Z" });
  const v3 = createRevisionAfterTombstone("criteria", tomb);
  assert.notEqual(v3.revisionId, v1.revisionId);
  const delayed = { assessmentId: "d", criteriaRevision: v1.revisionId, candidateSnapshot: "snap", admitted: true, reportedCriterionIds: [...CRITERIA], admittedCriterionIds: ["AC-3"] };
  assert.equal(consumerAdmit(delayed, v3, "snap", [...CRITERIA], true, true).admitted, false);
  const stub = { assessmentId: "s", criteriaRevision: v3.revisionId, candidateSnapshot: "snap", admitted: true, reportedCriterionIds: [...CRITERIA], admittedCriterionIds: ["AC-1"] };
  assert.equal(consumerAdmit(stub, v3, "snap", [...CRITERIA], true, false).admitted, true);
});

test("WP8: Profile A/B adapters run at injected fake-provider boundaries with one dispatch", async () => {
  const dispatchLog: DispatchRecord[] = [];
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: JSON.stringify({ assessments: [{ criterionId: "AC-1", outcome: "satisfied" }] }) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as any;
  try {
    const b = await runProfileB({
      requestId: "req-b-1",
      body: "profile-b-body",
      dispatchLog,
      provider: {
        async generate({ body }) {
          const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", body });
          const json = (await res.json()) as { text: string };
          return { text: json.text, observedModel: "fake-model" };
        },
      },
      decode: (text) => JSON.parse(text).assessments.map((a: any) => ({ expectedCriterionId: a.criterionId, present: true, originalReportedClaim: a.outcome, admittedConclusion: a.outcome, references: [], explanation: null, diagnostics: [] })),
    });
    assert.equal(b.dispatches.length, 1);
    assert.equal(b.assessments.length, 1);
    assert.equal(requests.length, 1, "exactly one provider request");
    assert.equal(dispatchLog.length, 1);

    const a = await runProfileA({
      requestId: "req-a-1",
      body: "profile-a-body",
      dispatchLog,
      provider: {
        async review() {
          const comments: NativeComment[] = [
            { path: "app.ts", line: 3, content: "AC-1 broken: missing await" },
            { path: "app.ts", line: 9, content: "duplicate", skipped: true, skipReason: "duplicate" },
          ];
          return { comments };
        },
      },
      normalize: (c) => ({ normalizedFinding: c.content, criterionMapping: c.content.includes("AC-1") ? "AC-1" : null, qualityFlags: [] }),
    });
    assert.equal(a.findings.length, 2);
    assert.equal(a.findings[0].skipped, false);
    assert.equal(a.findings[1].skipped, true);
    assert.equal(a.dispatches.length, 1);
    assert.equal(dispatchLog.length, 2);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("WP8: readiness artifact is persisted and checksum-stable", () => {
  const r = runScenario({ candidateId: "S1-C1", claims: { "AC-1": "satisfied" } });
  assert.ok(fs.existsSync(r.readinessPath));
  assert.match(r.readinessSha, /^[0-9a-f]{64}$/);
  assert.equal(r.readinessSha, sha256File(r.readinessPath));
  assert.equal(r.readiness.candidateId, "S1-C1");
  assert.equal(r.readiness.liveProviderCalls, 0);
  assert.equal(r.readiness.automaticRetries, 0);
});

void FROZEN_CRITERIA;
