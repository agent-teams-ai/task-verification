/**
 * Durable attempt persistence at the dispatch boundary (M2 corrective pass).
 *
 * Both integrated profiles must persist the attempt BEFORE dispatch:
 *
 *   planned  -> persisted, read back from disk
 *   started  -> persisted, read back from disk
 *   dispatch -> the persisted identity is re-read and verified against the
 *               request about to be sent
 *   terminal -> completed / failed / cancelled / unknown, after execution
 *
 * A failed, cancelled, timed-out or interrupted attempt therefore remains
 * auditable: the append-only ledger retains the planned and started records even
 * when no terminal record was ever written. Nothing here invents a completed
 * lifecycle after the fact, and every read goes through the real storage path
 * (`readLedger`), never an in-memory mirror.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

import {
  appendLedgerRecord,
  readLedger,
  LEDGER_SCHEMA_VERSION,
  type LedgerExecutionState,
  type LedgerRecord,
} from "./ledger.ts";

/** Terminal execution states that may close a started attempt. */
export type TerminalState = "completed" | "failed" | "cancelled" | "unknown";

const TERMINAL_EVENT: Record<TerminalState, LedgerRecord["eventType"]> = {
  completed: "attempt_completed",
  failed: "attempt_failed",
  cancelled: "cancelled",
  unknown: "attempt_unknown",
};

const TERMINAL_LEDGER_STATE: Record<TerminalState, LedgerExecutionState> = {
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  unknown: "unknown",
};

/**
 * The identity fields that must agree between the persisted record and the
 * request being dispatched.
 */
export interface AttemptIdentity {
  runId: string;
  attemptId: string;
  profile: string;
  candidateId: string;
  /** Base/head source identity of the reviewed snapshot. */
  baseTreeIdentity: string;
  headTreeIdentity: string;
  runtimeSnapshotDigest: string;
  /** Authored criteria revision label. */
  criteriaAuthoredRevision: string;
  /** Digest over the canonical criterion content. */
  criteriaContentDigest: string;
  /** Identity/digest of the request being dispatched. */
  requestIdentity: string;
}

export interface AttemptRecordInput {
  slotId: string;
  repetition: number;
  seed: number | null;
  subjectInventory: string[];
  criterionInventory: string[];
  policyDigest: string;
  promptDigest: string;
  requestedModel: string | null;
  adapterEntryIdentity: string;
  startTimestamp: string;
  requestIds: string[];
  diagnostics?: string[];
}

export interface AttemptContext {
  identity: AttemptIdentity;
  record: AttemptRecordInput;
  ledgerPath: string;
}

/** Fields verified at the dispatch boundary, in a stable report shape. */
export interface DispatchIdentityEvidence {
  attemptId: string;
  ledgerPath: string;
  records: number;
  plannedPersisted: boolean;
  startedPersisted: boolean;
  requestIdentity: string;
  verifiedAgainst: AttemptIdentity;
}

function baseRecord(ctx: AttemptContext, eventType: LedgerRecord["eventType"], state: LedgerExecutionState): LedgerRecord {
  const { identity, record } = ctx;
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    sequence: 1, // derived by appendLedgerRecord
    slotId: record.slotId,
    runId: identity.runId,
    attemptId: identity.attemptId,
    eventId: `evt-${crypto.randomUUID()}`,
    opaqueCandidateId: identity.candidateId,
    profile: identity.profile,
    repetition: record.repetition,
    seed: record.seed,
    subjectInventory: [...record.subjectInventory],
    criterionInventory: [...record.criterionInventory],
    baseTreeIdentity: identity.baseTreeIdentity,
    headTreeIdentity: identity.headTreeIdentity,
    runtimeSnapshotDigest: identity.runtimeSnapshotDigest,
    criteriaRevision: identity.criteriaAuthoredRevision,
    criteriaContentDigest: identity.criteriaContentDigest,
    policyDigest: record.policyDigest,
    promptDigest: record.promptDigest,
    inputDigest: identity.requestIdentity,
    requestedModel: record.requestedModel,
    observedModel: null,
    reasoningConfiguration: {},
    adapterEntryIdentity: record.adapterEntryIdentity,
    startTimestamp: record.startTimestamp,
    endTimestamp: null,
    executionState: state,
    eventType,
    requestIds: [...record.requestIds],
    rawArtifactRefs: [],
    rawUnavailableCause: null,
    usage: {},
    diagnostics: [...(record.diagnostics ?? [])],
    admissionState: "pending",
    cleanupStatus: "unknown",
    isStub: false,
    supersededBy: null,
    supersedes: null,
  };
}

/** Read the ledger from disk and return the records for one attempt. */
export function readAttempt(ledgerPath: string, attemptId: string): LedgerRecord[] {
  return readLedger(ledgerPath).filter((r) => r.attemptId === attemptId);
}

/**
 * Persist the `planned` record. Throws (before any dispatch) when the ledger
 * cannot be persisted, so a failed pre-dispatch write can never leave a
 * successful-looking lifecycle behind.
 */
export function persistPlanned(ctx: AttemptContext): LedgerRecord {
  const rec = baseRecord(ctx, "planned", "planned");
  appendLedgerRecord(rec, { ledgerPath: ctx.ledgerPath });
  const persisted = readAttempt(ctx.ledgerPath, ctx.identity.attemptId);
  const planned = persisted.find((r) => r.eventType === "planned");
  if (!planned) {
    throw new Error(`attempt ${ctx.identity.attemptId}: planned record did not persist`);
  }
  assertIdentity(planned, ctx.identity, "planned");
  return planned;
}

/** Persist the `attempt_started` record and read it back from disk. */
export function persistStarted(ctx: AttemptContext): LedgerRecord {
  const rec = baseRecord(ctx, "attempt_started", "started");
  appendLedgerRecord(rec, { ledgerPath: ctx.ledgerPath });
  const persisted = readAttempt(ctx.ledgerPath, ctx.identity.attemptId);
  const started = persisted.find((r) => r.eventType === "attempt_started");
  if (!started) {
    throw new Error(`attempt ${ctx.identity.attemptId}: attempt_started record did not persist`);
  }
  assertIdentity(started, ctx.identity, "attempt_started");
  return started;
}

function assertIdentity(rec: LedgerRecord, identity: AttemptIdentity, eventType: string): void {
  const mismatches: string[] = [];
  if (rec.attemptId !== identity.attemptId) mismatches.push(`attemptId ${rec.attemptId} != ${identity.attemptId}`);
  if (rec.runId !== identity.runId) mismatches.push(`runId ${rec.runId} != ${identity.runId}`);
  if (rec.profile !== identity.profile) mismatches.push(`profile ${rec.profile} != ${identity.profile}`);
  if (rec.opaqueCandidateId !== identity.candidateId) {
    mismatches.push(`candidate ${rec.opaqueCandidateId} != ${identity.candidateId}`);
  }
  if (rec.baseTreeIdentity !== identity.baseTreeIdentity) mismatches.push("base tree identity");
  if (rec.headTreeIdentity !== identity.headTreeIdentity) mismatches.push("head tree identity");
  if (rec.runtimeSnapshotDigest !== identity.runtimeSnapshotDigest) mismatches.push("snapshot digest");
  if (rec.criteriaRevision !== identity.criteriaAuthoredRevision) mismatches.push("criteria authored revision");
  if (rec.criteriaContentDigest !== identity.criteriaContentDigest) mismatches.push("criteria content digest");
  if (rec.inputDigest !== identity.requestIdentity) mismatches.push("request identity");
  if (mismatches.length > 0) {
    throw new Error(`persisted ${eventType} record does not match the attempt identity: ${mismatches.join("; ")}`);
  }
}

/**
 * Verify — from disk — that this attempt is already durably planned and started
 * and that every identity field matches the request about to be dispatched.
 * Intended to be called at the real dispatch boundary, immediately before the
 * provider/OCR invocation.
 */
export function verifyAttemptAtDispatch(ctx: AttemptContext, requestIdentity?: string): DispatchIdentityEvidence {
  const identity: AttemptIdentity = requestIdentity
    ? { ...ctx.identity, requestIdentity }
    : ctx.identity;
  const persisted = readAttempt(ctx.ledgerPath, identity.attemptId);
  if (persisted.length === 0) {
    throw new Error(`attempt ${identity.attemptId}: no durable record exists at the dispatch boundary`);
  }
  const planned = persisted.find((r) => r.eventType === "planned");
  const started = persisted.find((r) => r.eventType === "attempt_started");
  if (!planned) throw new Error(`attempt ${identity.attemptId}: planned record is missing at dispatch`);
  if (!started) throw new Error(`attempt ${identity.attemptId}: attempt_started record is missing at dispatch`);
  assertIdentity(planned, identity, "planned");
  assertIdentity(started, identity, "attempt_started");
  if (persisted.some((r) => r.eventType === "attempt_completed" || r.eventType === "attempt_failed")) {
    throw new Error(`attempt ${identity.attemptId}: a terminal record already exists before dispatch`);
  }
  return {
    attemptId: identity.attemptId,
    ledgerPath: ctx.ledgerPath,
    records: persisted.length,
    plannedPersisted: true,
    startedPersisted: true,
    requestIdentity: identity.requestIdentity,
    verifiedAgainst: identity,
  };
}

/**
 * Persist the terminal record after execution. `rawArtifactRefs`,
 * `observedModel` and diagnostics are supplied by the caller from the real
 * response; nothing is synthesized.
 */
export function persistTerminal(
  ctx: AttemptContext,
  state: TerminalState,
  extra: {
    observedModel?: string | null;
    rawArtifactRefs?: string[];
    admissionState?: string;
    cleanupStatus?: string;
    endTimestamp: string;
    diagnostics?: string[];
    usage?: Record<string, unknown>;
    rawUnavailableCause?: string | null;
  },
): LedgerRecord {
  const rec = baseRecord(ctx, TERMINAL_EVENT[state], TERMINAL_LEDGER_STATE[state]);
  rec.endTimestamp = extra.endTimestamp;
  rec.observedModel = extra.observedModel ?? null;
  rec.rawArtifactRefs = [...(extra.rawArtifactRefs ?? [])];
  rec.admissionState = extra.admissionState ?? "pending";
  rec.cleanupStatus = extra.cleanupStatus ?? "unknown";
  rec.diagnostics = [...(ctx.record.diagnostics ?? []), ...(extra.diagnostics ?? [])];
  rec.usage = { ...(extra.usage ?? {}) };
  rec.rawUnavailableCause = extra.rawUnavailableCause ?? null;
  appendLedgerRecord(rec, { ledgerPath: ctx.ledgerPath });
  const persisted = readAttempt(ctx.ledgerPath, ctx.identity.attemptId);
  const terminal = persisted.find((r) => r.eventType === TERMINAL_EVENT[state]);
  if (!terminal) {
    throw new Error(`attempt ${ctx.identity.attemptId}: terminal ${state} record did not persist`);
  }
  return terminal;
}
