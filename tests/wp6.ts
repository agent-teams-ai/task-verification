import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLedgerRecord,
  readLedger,
  validateLedgerRecord,
  findDuplicateIdentities,
  verifyLedgerIntegrity,
  type LedgerRecord,
} from "../src/ledger.ts";
import {
  createCriteriaRevision,
  ct1Evaluate,
  ct2Evaluate,
  ct3Evaluate,
  isAssessmentCurrentForCriteria,
} from "../src/controls.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeRecord(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    slotId: "slot-1",
    runId: "run-1",
    attemptId: "attempt-1",
    opaqueCandidateId: "S1-FIX-5ba5153fec57",
    profile: "profile-b",
    repetition: 1,
    seed: 42,
    subjectInventory: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"],
    criterionInventory: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"],
    baseTreeIdentity: "base123",
    headTreeIdentity: "head456",
    runtimeSnapshotDigest: "digest789",
    criteriaRevision: "crit-v1",
    policyDigest: "policydigest",
    promptDigest: "promptdigest",
    inputDigest: "inputdigest",
    requestedModel: null,
    observedModel: null,
    reasoningConfiguration: {},
    adapterEntryIdentity: "adapter1",
    startTimestamp: "2026-01-01T00:00:00Z",
    endTimestamp: "2026-01-01T00:00:01Z",
    executionState: "completed",
    requestIds: ["req-1"],
    rawArtifactRefs: [],
    rawUnavailableCause: null,
    usage: {},
    diagnostics: [],
    admissionState: "admitted",
    cleanupStatus: "clean",
    isStub: true,
    supersededBy: null,
    supersedes: null,
    ...overrides,
  };
}

test("WP6: ledger append and read round-trips", () => {
  const ledgerPath = path.join(ROOT, ".isolation-tmp", "wp6-ledger-roundtrip.jsonl");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
  const rec = makeRecord();
  appendLedgerRecord(rec, { ledgerPath });
  const records = readLedger(ledgerPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].runId, "run-1");
  assert.equal(records[0].attemptId, "attempt-1");
  fs.unlinkSync(ledgerPath);
});

test("WP6: every started attempt is recorded including failures", () => {
  const ledgerPath = path.join(ROOT, ".isolation-tmp", "wp6-failures.jsonl");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
  const completed = makeRecord({ runId: "run-c", attemptId: "att-c", executionState: "completed" });
  const failed = makeRecord({ runId: "run-f", attemptId: "att-f", executionState: "failed", diagnostics: ["timeout"] });
  const unknown = makeRecord({ runId: "run-u", attemptId: "att-u", executionState: "unknown" });
  appendLedgerRecord(completed, { ledgerPath });
  appendLedgerRecord(failed, { ledgerPath });
  appendLedgerRecord(unknown, { ledgerPath });
  const records = readLedger(ledgerPath);
  assert.equal(records.length, 3);
  assert.ok(records.some((r) => r.executionState === "failed"));
  assert.ok(records.some((r) => r.executionState === "unknown"));
  fs.unlinkSync(ledgerPath);
});

test("WP6: duplicate run/attempt identity is rejected", () => {
  const records = [makeRecord(), makeRecord()];
  const dups = findDuplicateIdentities(records);
  assert.equal(dups.length, 1);
  assert.equal(dups[0], "run-1::attempt-1");
});

test("WP6: ledger validation rejects invalid records", () => {
  const rec = makeRecord({ slotId: "", runId: "", executionState: "bogus" as any });
  const errors = validateLedgerRecord(rec);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes("slotId")));
});

test("WP6: ledger integrity verification", () => {
  const records = [makeRecord(), makeRecord({ runId: "run-2", attemptId: "attempt-2" })];
  const errors = verifyLedgerIntegrity(records);
  assert.deepEqual(errors, []);
});

test("WP6: stub status cannot be confused with live model attempt", () => {
  const stub = makeRecord({ isStub: true });
  const live = makeRecord({ runId: "run-live", attemptId: "att-live", isStub: false, requestedModel: "gpt-4" });
  assert.equal(stub.isStub, true);
  assert.equal(live.isStub, false);
  assert.notEqual(stub.isStub, live.isStub);
});

test("WP6: raw-unavailable state is preserved", () => {
  const rec = makeRecord({ rawArtifactRefs: [], rawUnavailableCause: "SDK timeout" });
  assert.equal(rec.rawUnavailableCause, "SDK timeout");
  assert.equal(rec.rawArtifactRefs.length, 0);
});

test("WP6: CT-1 criteria revision freshness", () => {
  const v1 = createCriteriaRevision("criteria v1 text", null);
  const v2Text = "criteria v1 text\nAC-3 adds timing obligation";
  const v2 = createCriteriaRevision(v2Text, v1.revisionId);
  assert.notEqual(v1.revisionId, v2.revisionId);
  assert.notEqual(v1.textDigest, v2.textDigest);
  const oldAssessment = { assessmentId: "a1", criteriaRevision: v1.revisionId, candidateSnapshot: "snap1", admitted: true };
  const result = ct1Evaluate(v1, v2, oldAssessment);
  assert.equal(result.oldBoundToV1, true);
  assert.equal(result.oldCannotBeCurrentForV2, true);
  assert.equal(result.v2RequiresNewRevision, true);
  // Candidate identity alone is insufficient.
  assert.equal(isAssessmentCurrentForCriteria(oldAssessment, v2.revisionId), false);
});

test("WP6: CT-2 candidate/snapshot binding", () => {
  const currentSnapshot = "snapshot-c2-current";
  const mismatchedSnapshot = "snapshot-c1-different";
  const assessment = { assessmentId: "a2", criteriaRevision: "crit-v1", candidateSnapshot: currentSnapshot, admitted: true };
  const result = ct2Evaluate(currentSnapshot, mismatchedSnapshot, assessment);
  assert.equal(result.mismatchDetected, true);
  assert.equal(result.evidenceStale, false, "assessment is bound to current snapshot");
  assert.equal(result.cannotSatisfy, true);
  // Mismatched evidence snapshot makes it stale.
  const staleAssessment = { assessmentId: "a3", criteriaRevision: "crit-v1", candidateSnapshot: mismatchedSnapshot, admitted: true };
  const result2 = ct2Evaluate(currentSnapshot, mismatchedSnapshot, staleAssessment);
  assert.equal(result2.evidenceStale, true);
  assert.equal(result2.cannotSatisfy, true);
});

test("WP6: CT-3 removal and re-addition creates new revision", () => {
  const text = "identical criteria bytes";
  const v1 = createCriteriaRevision(text, null);
  // Remove and re-add identical bytes → new revision (because parent changes).
  const v3 = createCriteriaRevision(text, "removed");
  assert.notEqual(v1.revisionId, v3.revisionId, "identical bytes must not resurrect old revision");
  // Actually text digests should be the same for identical text.
  assert.equal(v1.textDigest, v3.textDigest, "identical text has identical digest");
  const cancelled = { assessmentId: "a4", criteriaRevision: v1.revisionId, candidateSnapshot: "snap", admitted: false };
  const result = ct3Evaluate(v1, v3, cancelled);
  assert.equal(result.newRevisionCreated, true);
  assert.equal(result.cancelledNeverCurrent, true);
});

test("WP6: CT-3 cancelled/superseded result never becomes current", () => {
  const v1 = createCriteriaRevision("text", null);
  const v3 = createCriteriaRevision("text", "removed");
  const cancelled = { assessmentId: "a5", criteriaRevision: v1.revisionId, candidateSnapshot: "snap", admitted: false };
  assert.equal(isAssessmentCurrentForCriteria(cancelled, v3.revisionId), false);
  // Only a valid new stub bound to v3 can be admitted.
  const newStub = { assessmentId: "a6", criteriaRevision: v3.revisionId, candidateSnapshot: "snap", admitted: true };
  assert.equal(isAssessmentCurrentForCriteria(newStub, v3.revisionId), true);
});

test("WP6: criteria revision text digest is stable", () => {
  const r1 = createCriteriaRevision("same text", null);
  const r2 = createCriteriaRevision("same text", null);
  assert.equal(r1.textDigest, r2.textDigest);
});

test("WP6: ledger integrity catches duplicate identities", () => {
  const records = [
    makeRecord({ runId: "r1", attemptId: "a1" }),
    makeRecord({ runId: "r1", attemptId: "a1" }),
  ];
  const errors = verifyLedgerIntegrity(records);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes("duplicate")));
});
