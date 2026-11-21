import * as crypto from "node:crypto";
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
  acquireWriter,
  releaseWriter,
  isWriterActive,
  withWriter,
  LEDGER_SCHEMA_VERSION,
  type LedgerRecord,
} from "../src/ledger.ts";
import {
  createCriteriaRevision,
  ct1Evaluate,
  ct2Evaluate,
  ct3Evaluate,
  isAssessmentCurrentForCriteria,
  createCriteriaTombstone,
  createRevisionAfterTombstone,
  consumerAdmit,
  type AssessmentBinding,
} from "../src/controls.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const IDS = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"];

function makeRecord(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  const baseRecord: LedgerRecord = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    sequence: 1,
    slotId: "slot-1",
    runId: "run-1",
    attemptId: "attempt-1",
    eventId: "evt-" + crypto.randomUUID(),
    eventType: "attempt_started",
    opaqueCandidateId: "S1-FIX-5ba5153fec57",
    profile: "profile-b",
    repetition: 1,
    seed: 42,
    subjectInventory: IDS,
    criterionInventory: IDS,
    baseTreeIdentity: H("base"),
    headTreeIdentity: H("head"),
    runtimeSnapshotDigest: H("snapshot"),
    criteriaRevision: "crit-v1",
    policyDigest: H("policy"),
    promptDigest: H("prompt"),
    inputDigest: H("input"),
    requestedModel: null,
    observedModel: null,
    reasoningConfiguration: {},
    adapterEntryIdentity: "adapter-1",
    startTimestamp: "2026-01-01T00:00:00Z",
    endTimestamp: null,
    executionState: "started",
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
  };
  return { ...baseRecord, ...overrides };
}

function freshLedger(name: string): string {
  const p = path.join(ROOT, ".isolation-tmp", name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return p;
}

function appendAll(ledgerPath: string, records: LedgerRecord[]): void {
  for (const record of records) appendLedgerRecord(record, { ledgerPath });
}

function withSequence(records: LedgerRecord[]): LedgerRecord[] {
  return records.map((r, i) => ({ ...r, sequence: i + 1 }));
}

interface ControlSide {
  assessmentId: string;
  criteriaRevision: string;
  candidateSnapshot: string;
  admitted: boolean;
  decision: { admitted: boolean; reason: string };
}

interface ControlAdmissionRecord {
  control: "CT-1" | "CT-2" | "CT-3";
  before: ControlSide;
  after: ControlSide;
}

const CONTROL_RECORDS: ControlAdmissionRecord[] = [];

function recordControl(record: ControlAdmissionRecord): void {
  CONTROL_RECORDS.push(record);
}

function side(binding: AssessmentBinding, decision: { admitted: boolean; reason: string }): ControlSide {
  return {
    assessmentId: binding.assessmentId,
    criteriaRevision: binding.criteriaRevision,
    candidateSnapshot: binding.candidateSnapshot,
    admitted: binding.admitted,
    decision: { admitted: decision.admitted, reason: decision.reason },
  };
}

// --- Basic ledger behaviour ---

test("WP6: ledger append and read round-trips", () => {
  const ledgerPath = freshLedger("wp6-ledger-roundtrip.jsonl");
  appendLedgerRecord(makeRecord(), { ledgerPath });
  const records = readLedger(ledgerPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].runId, "run-1");
  assert.equal(records[0].attemptId, "attempt-1");
  fs.unlinkSync(ledgerPath);
});

test("WP6: every started attempt is recorded including failures", () => {
  const ledgerPath = freshLedger("wp6-failures.jsonl");
  appendAll(ledgerPath, [
    makeRecord({ runId: "run-c", attemptId: "att-c" }),
    makeRecord({ runId: "run-f", attemptId: "att-f" }),
    makeRecord({ runId: "run-f", attemptId: "att-f", eventType: "attempt_failed", executionState: "failed", diagnostics: ["timeout"], endTimestamp: "2026-01-01T00:00:02Z" }),
    makeRecord({ runId: "run-u", attemptId: "att-u" }),
    makeRecord({ runId: "run-u", attemptId: "att-u", eventType: "attempt_unknown", executionState: "unknown", endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  const records = readLedger(ledgerPath);
  assert.equal(records.length, 5);
  assert.ok(records.some((r) => r.executionState === "failed"));
  assert.ok(records.some((r) => r.executionState === "unknown"));
  fs.unlinkSync(ledgerPath);
});

test("WP6: duplicate eventId append is rejected", () => {
  const ledgerPath = freshLedger("wp6-dup-event.jsonl");
  const rec = makeRecord();
  appendLedgerRecord(rec, { ledgerPath });
  assert.throws(() => appendLedgerRecord({ ...rec }, { ledgerPath }), /duplicate eventId/);
  fs.unlinkSync(ledgerPath);
});

test("WP6: duplicate run/attempt start append is rejected", () => {
  const ledgerPath = freshLedger("wp6-dup-attempt.jsonl");
  const key = { runId: "run-dup", attemptId: "att-dup" };
  appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }), { ledgerPath });
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }), { ledgerPath }),
    /duplicate attempt_started/,
  );
  assert.equal(findDuplicateIdentities([makeRecord({ ...key }), makeRecord({ ...key })]).length, 1);
  fs.unlinkSync(ledgerPath);
});

test("WP6: ledger validation rejects invalid records", () => {
  const rec = makeRecord({ slotId: "", runId: "", executionState: "bogus" as any, schemaVersion: "v0", baseTreeIdentity: "not-a-digest" });
  const errors = validateLedgerRecord(rec);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes("slotId")));
  assert.ok(errors.some((e) => e.includes("schemaVersion")));
  assert.ok(errors.some((e) => e.includes("executionState")));
  assert.ok(errors.some((e) => e.includes("baseTreeIdentity")));
});

test("WP6: ledger integrity verification accepts a valid history", () => {
  const records = withSequence([
    makeRecord({ runId: "run-2", attemptId: "attempt-2", eventType: "planned", executionState: "planned" }),
    makeRecord({ runId: "run-2", attemptId: "attempt-2", eventType: "attempt_started", executionState: "started" }),
    makeRecord({ runId: "run-2", attemptId: "attempt-2", eventType: "attempt_completed", executionState: "completed", endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  assert.deepEqual(verifyLedgerIntegrity(records), []);
});

test("WP6: stub status cannot be confused with a live model attempt", () => {
  const stub = makeRecord({ isStub: true });
  const live = makeRecord({ runId: "run-live", attemptId: "att-live", isStub: false, requestedModel: "gpt-4", observedModel: "gpt-4" });
  assert.deepEqual(validateLedgerRecord(stub), []);
  assert.deepEqual(validateLedgerRecord(live), []);
  assert.ok(validateLedgerRecord({ ...stub, requestedModel: "gpt-4" }).some((e) => e.includes("stub record")));
});

test("WP6: raw-unavailable state is preserved", () => {
  const rec = makeRecord({ rawArtifactRefs: [], rawUnavailableCause: "SDK timeout" });
  assert.equal(rec.rawUnavailableCause, "SDK timeout");
  assert.equal(rec.rawArtifactRefs.length, 0);
});

// --- Lifecycle ---

test("WP6: planned -> started -> completed is accepted", () => {
  const lp = freshLedger("wp6-lc-completed.jsonl");
  const key = { runId: "run-lc", attemptId: "att-lc" };
  appendAll(lp, [
    makeRecord({ ...key, eventType: "planned", executionState: "planned" }),
    makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }),
    makeRecord({ ...key, eventType: "attempt_completed", executionState: "completed", endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  const recs = readLedger(lp);
  assert.equal(recs.length, 3);
  assert.deepEqual(verifyLedgerIntegrity(recs), []);
  fs.unlinkSync(lp);
});

test("WP6: planned -> started -> failed is accepted and history is preserved", () => {
  const lp = freshLedger("wp6-lc-failed.jsonl");
  const key = { runId: "run-lc-f", attemptId: "att-lc-f" };
  appendAll(lp, [
    makeRecord({ ...key, eventType: "planned", executionState: "planned" }),
    makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }),
    makeRecord({ ...key, eventType: "attempt_failed", executionState: "failed", diagnostics: ["timeout"], endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  const recs = readLedger(lp);
  assert.equal(recs.length, 3);
  assert.equal(recs[2].executionState, "failed");
  assert.deepEqual(verifyLedgerIntegrity(recs), []);
  fs.unlinkSync(lp);
});

test("WP6: planned -> started -> unknown is accepted and history is preserved", () => {
  const lp = freshLedger("wp6-lc-unknown.jsonl");
  const key = { runId: "run-lc-u", attemptId: "att-lc-u" };
  appendAll(lp, [
    makeRecord({ ...key, eventType: "planned", executionState: "planned" }),
    makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }),
    makeRecord({ ...key, eventType: "attempt_unknown", executionState: "unknown", endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  const recs = readLedger(lp);
  assert.equal(recs[2].executionState, "unknown");
  assert.deepEqual(verifyLedgerIntegrity(recs), []);
  fs.unlinkSync(lp);
});

test("WP6: duplicate planned and duplicate started are rejected", () => {
  const lp = freshLedger("wp6-lc-dup.jsonl");
  const key = { runId: "run-lc-d", attemptId: "att-lc-d" };
  appendLedgerRecord(makeRecord({ ...key, eventType: "planned", executionState: "planned" }), { ledgerPath: lp });
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "planned", executionState: "planned" }), { ledgerPath: lp }),
    /duplicate planned/,
  );
  appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }), { ledgerPath: lp });
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }), { ledgerPath: lp }),
    /duplicate attempt_started/,
  );
  fs.unlinkSync(lp);
});

test("WP6: terminal without a real started is rejected", () => {
  const lp = freshLedger("wp6-lc-terminal-no-start.jsonl");
  const key = { runId: "run-lc-t", attemptId: "att-lc-t" };
  appendLedgerRecord(makeRecord({ ...key, eventType: "planned", executionState: "planned" }), { ledgerPath: lp });
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_completed", executionState: "completed", endTimestamp: "2026-01-01T00:00:02Z" }), { ledgerPath: lp }),
    /requires a real prior attempt_started/,
  );
  fs.unlinkSync(lp);
});

test("WP6: two terminal events are rejected", () => {
  const lp = freshLedger("wp6-lc-two-terminal.jsonl");
  const key = { runId: "run-lc-2t", attemptId: "att-lc-2t" };
  appendAll(lp, [
    makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }),
    makeRecord({ ...key, eventType: "attempt_completed", executionState: "completed", endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_failed", executionState: "failed", endTimestamp: "2026-01-01T00:00:03Z" }), { ledgerPath: lp }),
    /follows terminal event/,
  );
  fs.unlinkSync(lp);
});

test("WP6: cancelled/superseded attempts cannot be resurrected", () => {
  const lp = freshLedger("wp6-lc-resurrect.jsonl");
  const key = { runId: "run-lc-r", attemptId: "att-lc-r" };
  appendAll(lp, [
    makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }),
    makeRecord({ ...key, eventType: "cancelled", executionState: "cancelled", endTimestamp: "2026-01-01T00:00:02Z" }),
  ]);
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_started", executionState: "started" }), { ledgerPath: lp }),
    /duplicate attempt_started|follows terminal event/,
  );
  assert.throws(
    () => appendLedgerRecord(makeRecord({ ...key, eventType: "planned", executionState: "planned" }), { ledgerPath: lp }),
    /follows terminal event/,
  );
  fs.unlinkSync(lp);
});

test("WP6: started-before-dispatch leaves a visible incomplete attempt", () => {
  const lp = freshLedger("wp6-lc-interrupted.jsonl");
  const key = { runId: "run-lc-i", attemptId: "att-lc-i" };
  appendLedgerRecord(makeRecord({ ...key, eventType: "attempt_started", executionState: "started", cleanupStatus: "pending" }), { ledgerPath: lp });
  const recs = readLedger(lp);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].executionState, "started");
  assert.deepEqual(verifyLedgerIntegrity(recs), [], "an incomplete but valid attempt is not an integrity error");
  fs.unlinkSync(lp);
});

// --- Writer contract ---

test("WP6: only one active writer can append", () => {
  const lp = freshLedger("wp6-writer.jsonl");
  assert.equal(isWriterActive(), false);
  assert.equal(acquireWriter("writer-a"), true);
  assert.equal(isWriterActive(), true);
  assert.throws(
    () => appendLedgerRecord(makeRecord({ runId: "run-w", attemptId: "att-w" }), { ledgerPath: lp }),
    /already owns the ledger/,
  );
  assert.equal(acquireWriter("writer-b"), false, "second writer must not acquire");
  assert.equal(releaseWriter("writer-a"), true);
  assert.equal(isWriterActive(), false);
  if (fs.existsSync(lp)) fs.unlinkSync(lp);
});

test("WP6: append without ownership safely obtains and releases ownership", () => {
  const lp = freshLedger("wp6-writer-safe.jsonl");
  appendLedgerRecord(makeRecord({ runId: "run-w2", attemptId: "att-w2" }), { ledgerPath: lp });
  assert.equal(isWriterActive(), false, "anonymous append must release ownership");
  assert.equal(readLedger(lp).length, 1);
  fs.unlinkSync(lp);
});

test("WP6: withWriter releases ownership on throw", () => {
  assert.throws(() => withWriter("writer-x", () => { throw new Error("boom"); }));
  assert.equal(isWriterActive(), false);
});

// --- Malformed input and integrity ---

test("WP6: malformed/truncated JSONL is reported with line diagnostics", () => {
  const lp = freshLedger("wp6-malformed.jsonl");
  fs.writeFileSync(lp, '{"schemaVersion":"ledger-event-v1","sequence":1\n', "utf8");
  assert.throws(() => readLedger(lp), /malformed JSONL at line 1/);
  fs.unlinkSync(lp);
});

test("WP6: non-monotonic sequence ordering is detected", () => {
  const records = [
    makeRecord({ runId: "r", attemptId: "a", eventType: "attempt_started", executionState: "started", sequence: 2 }),
    makeRecord({ runId: "r", attemptId: "b", eventType: "attempt_started", executionState: "started", sequence: 1 }),
  ];
  assert.ok(verifyLedgerIntegrity(records).some((e) => e.includes("sequence not monotonic")));
});

test("WP6: invalid lifecycle transition is detected by integrity replay", () => {
  const records = withSequence([
    makeRecord({ runId: "r", attemptId: "a", eventType: "attempt_started", executionState: "started" }),
    makeRecord({ runId: "r", attemptId: "a", eventType: "planned", executionState: "planned" }),
  ]);
  assert.ok(verifyLedgerIntegrity(records).some((e) => e.includes("planned after attempt_started")));
});

test("WP6: invalid criteria revision lineage is detected", () => {
  const v1 = createCriteriaRevision("criteria text", null);
  const tombstone = (eventId: string, tombstoneOf: string, lineage: string): LedgerRecord =>
    makeRecord({
      eventId,
      runId: "crit",
      attemptId: "crit-a",
      eventType: "criteria_removed",
      executionState: "cancelled",
      criterionId: "AC-3",
      tombstoneOf,
      lineage,
    });

  const twice = withSequence([
    tombstone("evt-" + crypto.randomUUID(), v1.revisionId, "lineage-1"),
    tombstone("evt-" + crypto.randomUUID(), v1.revisionId, "lineage-2"),
  ]);
  assert.ok(verifyLedgerIntegrity(twice).some((e) => e.includes("tombstoned twice")));

  const resurrect = withSequence([
    tombstone("evt-" + crypto.randomUUID(), v1.revisionId, "lineage-1"),
    makeRecord({ runId: "r", attemptId: "a", eventType: "attempt_started", executionState: "started", criteriaRevision: v1.revisionId }),
  ]);
  assert.ok(verifyLedgerIntegrity(resurrect).some((e) => e.includes("resurrects removed criteria revision")));
});

test("WP6: invalid supersedes link and cycle are detected", () => {
  const missing = withSequence([
    makeRecord({ runId: "r", attemptId: "a", eventType: "criteria_removed", executionState: "cancelled", criterionId: "AC-3", tombstoneOf: "crit-old", lineage: "lineage-1", supersedes: "evt-does-not-exist" }),
  ]);
  assert.ok(verifyLedgerIntegrity(missing).some((e) => e.includes("target not found")));

  const a = "evt-" + crypto.randomUUID();
  const b = "evt-" + crypto.randomUUID();
  const cycle = withSequence([
    makeRecord({ eventId: a, runId: "r", attemptId: "a", eventType: "criteria_removed", executionState: "cancelled", criterionId: "AC-3", tombstoneOf: "crit-old", lineage: "lineage-1", supersededBy: b }),
    makeRecord({ eventId: b, runId: "r", attemptId: "b", eventType: "criteria_removed", executionState: "cancelled", criterionId: "AC-3", tombstoneOf: "crit-old-2", lineage: "lineage-2", supersededBy: a }),
  ]);
  assert.ok(verifyLedgerIntegrity(cycle).some((e) => e.includes("supersede cycle")));
});

// --- CT-1: criteria revision freshness ---

test("WP6 CT-1: delayed v1 assessment is rejected after v2 becomes current", () => {
  const v1 = createCriteriaRevision("criteria v1 text", null);
  const v2 = createCriteriaRevision("criteria v1 text\nAC-3 adds a timing obligation", v1.revisionId);
  assert.notEqual(v1.revisionId, v2.revisionId);

  const old: AssessmentBinding = {
    assessmentId: "ct1-old",
    criteriaRevision: v1.revisionId,
    candidateSnapshot: "snap-1",
    admitted: true,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-3"],
  };
  const before = consumerAdmit(old, v2, "snap-1", IDS, true, false);
  assert.equal(before.admitted, false);
  assert.equal(before.criteriaMatch, false);
  assert.equal(before.reason, "criteria revision mismatch");

  const v2Stub: AssessmentBinding = {
    assessmentId: "ct1-v2-stub",
    criteriaRevision: v2.revisionId,
    candidateSnapshot: "snap-1",
    admitted: true,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-1"],
  };
  const after = consumerAdmit(v2Stub, v2, "snap-1", IDS, true, false);
  assert.equal(after.admitted, true);
  recordControl({ control: "CT-1", before: side(old, before), after: side(v2Stub, after) });

  const helper = ct1Evaluate(v1, v2, old);
  assert.equal(helper.oldBoundToV1, true);
  assert.equal(helper.oldCannotBeCurrentForV2, true);
  assert.equal(isAssessmentCurrentForCriteria(old, v2.revisionId), false);
});

// --- CT-2: candidate snapshot binding ---

test("WP6 CT-2: evidence bound to another snapshot is stale and cannot satisfy", () => {
  const currentSnapshot = H("c2-current-head");
  const otherSnapshot = H("c1-other-head");
  const stale: AssessmentBinding = {
    assessmentId: "ct2-stale",
    criteriaRevision: "crit-v1",
    candidateSnapshot: otherSnapshot,
    admitted: true,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-1"],
  };
  const before = consumerAdmit(
    stale,
    { revisionId: "crit-v1", textDigest: H("criteria"), parentRevision: null },
    currentSnapshot,
    IDS,
    true,
    false,
  );
  assert.equal(before.admitted, false);
  assert.equal(before.snapshotMatch, false);
  assert.equal(before.reason, "snapshot mismatch");

  const current: AssessmentBinding = { ...stale, assessmentId: "ct2-current", candidateSnapshot: currentSnapshot };
  const after = consumerAdmit(
    current,
    { revisionId: "crit-v1", textDigest: H("criteria"), parentRevision: null },
    currentSnapshot,
    IDS,
    true,
    false,
  );
  assert.equal(after.admitted, true);
  recordControl({ control: "CT-2", before: side(stale, before), after: side(current, after) });

  const helper = ct2Evaluate(currentSnapshot, otherSnapshot, current);
  assert.equal(helper.mismatchDetected, true);
  assert.equal(helper.evidenceStale, false);
  assert.equal(helper.cannotSatisfy, true);
});

// --- CT-3: removal and re-addition ---

test("WP6 CT-3: real tombstone lineage prevents identical bytes from resurrecting v1", () => {
  const v1 = createCriteriaRevision("identical criteria bytes", null);
  const tombstone = createCriteriaTombstone({
    criterionId: "AC-3",
    removedRevisionId: v1.revisionId,
    removedTextDigest: v1.textDigest,
    removedAt: "2026-01-02T00:00:00Z",
  });
  const v3 = createRevisionAfterTombstone("identical criteria bytes", tombstone);
  assert.notEqual(v3.revisionId, v1.revisionId, "identical bytes must not resurrect v1");
  assert.equal(v3.textDigest, v1.textDigest, "identical text has identical digest");
  assert.equal(v3.parentRevision, tombstone.lineageId);

  const cancelled: AssessmentBinding = {
    assessmentId: "ct3-cancelled",
    criteriaRevision: v1.revisionId,
    candidateSnapshot: "snap",
    admitted: true,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-3"],
  };
  const before = consumerAdmit(cancelled, v3, "snap", IDS, true, true);
  assert.equal(before.admitted, false);
  assert.equal(before.lifecycleValid, false);
  assert.equal(isAssessmentCurrentForCriteria(cancelled, v3.revisionId), false);

  // Isolate the cancellation reason by keeping the current revision at v1.
  const cancelledSameRevision = consumerAdmit(cancelled, v1, "snap", IDS, true, true);
  assert.equal(cancelledSameRevision.reason, "cancelled or superseded");

  const v3Stub: AssessmentBinding = {
    assessmentId: "ct3-v3-stub",
    criteriaRevision: v3.revisionId,
    candidateSnapshot: "snap",
    admitted: true,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-1"],
  };
  const after = consumerAdmit(v3Stub, v3, "snap", IDS, true, false);
  assert.equal(after.admitted, true);
  recordControl({ control: "CT-3", before: side(cancelled, before), after: side(v3Stub, after) });

  const helper = ct3Evaluate(v1, v3, cancelled);
  assert.equal(helper.newRevisionCreated, true);
  assert.equal(helper.cancelledNeverCurrent, true);
});

test("WP6 CT-3: tombstone event is appended to the ledger and verified", () => {
  const v1 = createCriteriaRevision("criteria text", null);
  const tombstone = createCriteriaTombstone({
    criterionId: "AC-3",
    removedRevisionId: v1.revisionId,
    removedTextDigest: v1.textDigest,
    removedAt: "2026-01-02T00:00:00Z",
  });
  const lp = freshLedger("wp6-tombstone.jsonl");
  const rec = makeRecord({
    runId: "run-crit",
    attemptId: "crit-ac3",
    eventType: "criteria_removed",
    executionState: "cancelled",
    criterionId: tombstone.criterionId,
    tombstoneOf: tombstone.removedRevisionId,
    lineage: tombstone.lineageId,
  });
  rec.eventId = tombstone.eventId;
  appendLedgerRecord(rec, { ledgerPath: lp });
  const read = readLedger(lp);
  assert.equal(read[0].eventType, "criteria_removed");
  assert.equal(read[0].tombstoneOf, v1.revisionId);
  assert.deepEqual(verifyLedgerIntegrity(read), []);
  fs.unlinkSync(lp);
});

// --- Shared admission semantics ---

test("WP6 admission: admitted=false can never be overridden", () => {
  const notAdmitted: AssessmentBinding = {
    assessmentId: "a",
    criteriaRevision: "crit-v1",
    candidateSnapshot: "snap",
    admitted: false,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-1"],
  };
  const decision = consumerAdmit(notAdmitted, { revisionId: "crit-v1", textDigest: H("c"), parentRevision: null }, "snap", IDS, true, false);
  assert.equal(decision.admitted, false);
  assert.equal(decision.reason, "assessment not admitted");
});

test("WP6 admission: invalid or insufficient references are rejected when required", () => {
  const base: AssessmentBinding = {
    assessmentId: "a",
    criteriaRevision: "crit-v1",
    candidateSnapshot: "snap",
    admitted: true,
    reportedCriterionIds: IDS,
    admittedCriterionIds: ["AC-1"],
  };
  const rev = { revisionId: "crit-v1", textDigest: H("c"), parentRevision: null };
  assert.equal(consumerAdmit({ ...base, referenceValidity: false }, rev, "snap", IDS, true, false).reason, "invalid reference");
  assert.equal(consumerAdmit({ ...base, referenceSufficiency: false }, rev, "snap", IDS, true, false).reason, "insufficient reference support");
  assert.equal(consumerAdmit(base, rev, "snap", IDS, true, false).admitted, true);
});

test("WP6 criteria revision text digest is stable", () => {
  const r1 = createCriteriaRevision("same text", null);
  const r2 = createCriteriaRevision("same text", null);
  assert.equal(r1.textDigest, r2.textDigest);
  assert.equal(r1.revisionId, r2.revisionId);
});

test("WP6 criteria tombstone identity is stable for identical inputs", () => {
  const params = {
    criterionId: "AC-3",
    removedRevisionId: "crit-old",
    removedTextDigest: H("criteria"),
    removedAt: "2026-01-02T00:00:00Z",
  };
  const t1 = createCriteriaTombstone(params);
  const t2 = createCriteriaTombstone(params);
  assert.equal(t1.lineageId, t2.lineageId);
  assert.notEqual(t1.eventId, t2.eventId);
});

test("WP6 controls: before/after admission record is complete", () => {
  const p = path.join(ROOT, ".isolation-tmp", "control-admission-results.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(CONTROL_RECORDS, null, 2) + "\n", "utf8");
  const read = JSON.parse(fs.readFileSync(p, "utf8")) as ControlAdmissionRecord[];
  assert.deepEqual(read.map((r) => r.control), ["CT-1", "CT-2", "CT-3"]);
  for (const r of read) {
    assert.ok(r.before.assessmentId.length > 0);
    assert.ok(r.after.assessmentId.length > 0);
    assert.ok(r.before.decision.reason.length > 0);
    assert.ok(r.after.decision.reason.length > 0);
    assert.equal(r.before.decision.admitted, false, `${r.control} before must be rejected`);
    assert.equal(r.after.decision.admitted, true, `${r.control} after must be admitted`);
  }
});