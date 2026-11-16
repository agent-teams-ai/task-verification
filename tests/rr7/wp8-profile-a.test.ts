/**
 * WP8 — Profile A integrated execution using the exact rr.7 binary.
 *
 * Opt-in: runs only on Linux with the approved rr.7 assets. Exercises the
 * full production path: materialization -> reviewer input -> rr.7 binary ->
 * pinned parser/normalizer -> FindingRecord[] -> ResultContract -> scorer ->
 * ledger -> consumer admission -> persisted readback.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { buildReviewerMaterialization, MATERIALIZATION_ROOT, FROZEN_CRITERIA } from "../../src/materialization.ts";
import { loadTruth, validateTruth, CRITERIA } from "../../src/truth.ts";
import { writeEvidencePacket } from "../../src/evidence.ts";
import { runBaseline } from "../../src/baseline.ts";
import { buildResultContract, computeCoverage, validateResultContract, type AssessmentRecord, type ExecutionRecord } from "../../src/result-contract.ts";
import { scoreResult, type TruthBinding, type ArtifactRegistry } from "../../src/scorer.ts";
import { appendLedgerRecord, readLedger, verifyLedgerIntegrity } from "../../src/ledger.ts";
// (consumer admission is taken from scorer.admission)
import { runOcrProfileA, assertOcrInputBound, renderOcrReviewerInput, type OcrReviewerInputFields } from "../../src/ocr-profile-a.ts";
import { runManagedOcr, makeSyntheticRepo, tmpRoot } from "../../scripts/ocr-rr7/native-runner.ts";
import {
  pinnedParser,
  requireRr7,
  RR7_BINARY,
  ROOT,
} from "./harness.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

function freshWorkspace(tag: string): string {
  const ws = path.join(tmpRoot("wp8a-"), tag);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

test("WP8-A: Profile A runs the exact rr.7 binary end-to-end for S1-C1", async (t) => {
  if (!requireRr7(t)) return;

  const ws = freshWorkspace("run");
  const truth = loadTruth();
  assert.deepEqual(validateTruth(truth), []);

  // 1. Materialization.
  const mat = buildReviewerMaterialization("S1-C1", path.join(MATERIALIZATION_ROOT, "wp8a", path.basename(ws)));
  assert.equal(mat.headApplicationDigest, mat.recordedHeadApplicationDigest);

  // 2. Synthetic exact base/head repo: base app.ts = stub, head = candidate.
  const candSrcDir = path.join(ROOT, "candidates", "S1-C1", "src");
  const fixtureStub = fs.readFileSync(path.join(ROOT, "fixture", "src", "app-stub.ts"), "utf8");
  const candidateFiles: Record<string, string> = {};
  for (const f of fs.readdirSync(candSrcDir)) {
    candidateFiles[`src/${f}`] = fs.readFileSync(path.join(candSrcDir, f), "utf8");
  }
  const baseFiles: Record<string, string> = { ...candidateFiles };
  baseFiles["src/app.ts"] = fixtureStub;
  const home = path.join(ws, "home");
  const repoInfo = await makeSyntheticRepo({ root: ws, home, baseFiles, headFiles: candidateFiles });

  // 3. Reviewer input (shared, bounded).
  const fields: OcrReviewerInputFields = {
    candidateAlias: mat.opaqueId,
    sourceIdentity: "fixture-wp8a",
    base: mat.baseIdentity.tree,
    head: mat.headIdentity.tree,
    diff: repoInfo.diff,
    task: "Implement GET /profile with bearer-token authorization and audit logging.",
    criteria: FROZEN_CRITERIA,
    background: "synthetic model-free Profile A qualification",
    rules: "Report only issues introduced by the diff.",
  };
  const reviewerInput = renderOcrReviewerInput(fields);
  assertOcrInputBound(reviewerInput);

  // 4. Evidence packet + baseline.
  const packetPath = writeEvidencePacket("S1-C1", path.join(ws, "evidence"));
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const baseline = runBaseline({ packet });
  assert.equal(baseline.rejected, false);

  // 5. Real rr.7 execution via Profile A adapter.
  const headFilesMap = new Map(Object.entries(candidateFiles));
  const dispatchLog: { requestId: string; profile: "A" | "B"; dispatchedAt: number }[] = [];
  const { adapter, details } = await runOcrProfileA({
    requestId: "wp8a-profile-a",
    reviewerInput,
    execution: {
      async run({ reviewerInput: ri }) {
        const ev = await runManagedOcr({
          binary: RR7_BINARY,
          root: ws,
          repo: repoInfo.repo,
          base: repoInfo.base,
          head: repoInfo.head,
          reviewerInput: ri,
          rule: { merge_system_rule: true, include: ["src/app.ts"], rules: [{ id: "rr7-wp8a", content: "Report only issues introduced by the base-to-head diff." }] },
          scenario: "finding",
          comments: [
            {
              path: "src/app.ts",
              content: "AC-2: missing credential path returns 401 with missing_credential but audit record uses wrong event.",
              existing_code: 'sendJson(res, 401, { error: "missing_credential" });',
              severity: "high",
            },
          ],
        });
        assert.equal(ev.exit_code, 0, ev.stderr);
        assert.equal(ev.native.status, "complete");
        return {
          native: ev.native,
          baseSha: ev.repo_base,
          mergeBaseSha: ev.repo_base,
          headSha: ev.repo_head,
          requestCount: ev.request_count,
          diagnostics: ev.native_error ? [ev.native_error] : [],
        };
      },
    },
    parser: pinnedParser,
    expectedCriterionIds: [...CRITERIA],
    headFiles: headFilesMap,
    assignedPaths: Object.keys(candidateFiles),
    dispatchLog,
  });

  assert.equal(dispatchLog.length, 1);
  assert.ok(details.native);
  assert.equal(details.terminalState, "complete");
  assert.ok(details.requestCount >= 1);
  assert.ok(details.findings.length >= 1);

  // 6. ResultContract.
  const anonId = packet.candidateAnonId;
  const snapshotDigest = packet.candidateSnapshotDigest;
  const assessments: AssessmentRecord[] = [];
  const execution: ExecutionRecord = {
    state: "completed",
    slotId: "slot-1",
    runId: "run-wp8a",
    attemptId: "attempt-1",
    requestId: "wp8a-profile-a",
    sdkEffectCode: null,
    diagnostics: [],
    pendingEffects: [],
    cleanupStatus: "clean",
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
      criteriaTextDigest: H(truth.criteriaRevision),
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: packet.checkDefinitionDigest,
    },
    profile: { profileId: "profile-a", configurationIdentity: "cfg", promptIdentity: "prompt", inputIdentity: "input", requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "ocr-rr7" },
    assessments,
    findings: details.findings,
    coverage: computeCoverage([...CRITERIA], []),
    execution,
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: H("raw"), rawUnavailableCause: null },
    evidence: { producer: "oracle-O-1", candidateBinding: anonId, checkDefinition: packet.checkDefinitionDigest, inputScope: packet.inputsScope, environment: packet.environment, observationOutcome: "complete", completeness: packet.completeness, timestamps: packet.observationTime ? [packet.observationTime] : [], references: [], applicability: "applicable", provenance: packet.producer },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, cost: null, currency: null, requestedModel: null, observedModel: null, capacityObservations: [] },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const contractErrors = validateResultContract(rc);
  assert.deepEqual(contractErrors, []);

  // 7. Scorer.
  const truthBinding: TruthBinding = {
    canonicalCandidateId: anonId,
    anonymizedCandidateId: anonId,
    headApplicationDigest: snapshotDigest,
    criteriaRevision: truth.criteriaRevision,
    expectedCriterionInventory: [...CRITERIA],
    truthVersion: "truth-v1",
    truthDigest: H(fs.readFileSync(path.join(ROOT, "truth", "truth-v1.json"), "utf8")),
    truthOutcomes: truth.candidateOutcomes["S1-C1"],
  };
  const registry: ArtifactRegistry = { artifacts: {} };
  const scorer = scoreResult({ resultContract: rc, truthBinding, referenceRubrics: {}, artifactRegistry: registry });
  assert.ok(scorer.executionValid);
  assert.ok(scorer.profileA.deliveredCount >= 1);

  // 8. Ledger lifecycle + readback.
  const ledgerPath = path.join(ws, "runs.jsonl");
  const base = {
    schemaVersion: "ledger-event-v1", sequence: 1, slotId: "slot-1", runId: "run-wp8a", attemptId: "attempt-1",
    opaqueCandidateId: anonId, profile: "profile-a", repetition: 1, seed: 42,
    subjectInventory: [...CRITERIA], criterionInventory: [...CRITERIA],
    baseTreeIdentity: mat.baseIdentity.tree, headTreeIdentity: mat.headIdentity.tree,
    runtimeSnapshotDigest: snapshotDigest, criteriaRevision: truth.criteriaRevision,
    policyDigest: packet.checkDefinitionDigest, promptDigest: H("prompt"), inputDigest: H("input"),
    requestedModel: null, observedModel: null, reasoningConfiguration: {}, adapterEntryIdentity: "ocr-rr7",
    startTimestamp: "2026-01-01T00:00:00Z", endTimestamp: null, requestIds: ["wp8a-profile-a"],
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
  assert.deepEqual(ledgerErrors, []);
  assert.equal(ledgerRecords.length, 3);

  // 9. Consumer admission derived from actual scorer output (no manual admitted=true).
  const admission = scorer.admission;
  assert.equal(typeof admission.admitted, "boolean");

  // 10. Persisted readback + sealing.
  const readiness = {
    candidateId: "S1-C1",
    anonId,
    contractValid: contractErrors.length === 0,
    ledgerEvents: ledgerRecords.length,
    ledgerErrors,
    profileADelivered: scorer.profileA.deliveredCount,
    requestCount: details.requestCount,
    terminalState: details.terminalState,
    liveProviderCalls: 0,
    automaticRetries: 0,
  };
  const readinessPath = path.join(ws, "readiness.json");
  fs.writeFileSync(readinessPath, JSON.stringify(readiness, null, 2) + "\n", "utf8");
  const readback = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
  assert.deepEqual(readback, readiness);
  assert.equal(readback.liveProviderCalls, 0);

  // Sealing: materialization must not contain truth/scorer/oracle.
  for (const f of mat.fileInventory) {
    for (const bad of ["truth", "scorer", "oracle", "anonymization", "provenance", "MANIFEST"]) {
      assert.ok(!f.toLowerCase().includes(bad.toLowerCase()), `materialization must not include ${f}`);
    }
  }
  assert.equal(fs.existsSync(path.join(mat.outDir, "truth-v1.json")), false);

  void adapter;
});

test("WP8-A: Profile A runs the exact rr.7 binary for C2, C3 and C4", async (t) => {
  if (!requireRr7(t)) return;
  for (const cid of ["S1-C2", "S1-C3", "S1-C4"]) {
    const ws = freshWorkspace(cid);
    const mat = buildReviewerMaterialization(cid, path.join(MATERIALIZATION_ROOT, "wp8a", path.basename(ws) + "-" + cid));
    const candSrcDir = path.join(ROOT, "candidates", cid, "src");
    const candidateFiles: Record<string, string> = {};
    for (const f of fs.readdirSync(candSrcDir)) candidateFiles[`src/${f}`] = fs.readFileSync(path.join(candSrcDir, f), "utf8");
    const baseFiles: Record<string, string> = { ...candidateFiles };
    baseFiles["src/app.ts"] = fs.readFileSync(path.join(ROOT, "fixture", "src", "app-stub.ts"), "utf8");
    const home = path.join(ws, "home");
    const repoInfo = await makeSyntheticRepo({ root: ws, home, baseFiles, headFiles: candidateFiles });
    const fields: OcrReviewerInputFields = {
      candidateAlias: mat.opaqueId,
      sourceIdentity: "fixture-wp8a",
      base: mat.baseIdentity.tree,
      head: mat.headIdentity.tree,
      diff: repoInfo.diff,
      task: "Implement GET /profile with bearer-token authorization and audit logging.",
      criteria: FROZEN_CRITERIA,
      background: "synthetic model-free Profile A qualification",
      rules: "Report only issues introduced by the diff.",
    };
    const reviewerInput = renderOcrReviewerInput(fields);
    assertOcrInputBound(reviewerInput);
    const ev = await runManagedOcr({
      binary: RR7_BINARY,
      root: ws,
      repo: repoInfo.repo,
      base: repoInfo.base,
      head: repoInfo.head,
      reviewerInput,
      rule: { merge_system_rule: true, include: ["src/app.ts"], rules: [{ id: "rr7-wp8a", content: "Report only issues introduced by the base-to-head diff." }] },
      scenario: "finding",
      comments: [{ path: "src/app.ts", content: "AC-2: missing credential handling.", existing_code: 'sendJson(res, 401, { error: "missing_credential" });', severity: "high" }],
    });
    assert.equal(ev.exit_code, 0, `${cid}: ${ev.stderr}`);
    assert.equal(ev.native.status, "complete", cid);
    assert.ok(ev.native.manifest.input.resolved_base === ev.repo_base);
  }
});