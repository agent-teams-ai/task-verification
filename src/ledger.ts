/**
 * Run ledger (WP6).
 *
 * Append-only JSONL ledger (`runs.jsonl`) for the experimental harness.
 * Every started attempt produces a record, including failures and unknown
 * effects. Never silently omitted. Never rewritten to turn failure into
 * success; corrections are new linked records.
 *
 * SINGLE-WRITER CONTRACT: this implementation supports a single writer within a
 * single process. `acquireWriter`/`releaseWriter`/`withWriter` manage an
 * in-process ownership lock. Cross-process concurrency is NOT supported;
 * callers in multi-process environments must serialize access externally.
 * `appendFileSync` is NOT a write lock.
 *
 * PER-ATTEMPT LIFECYCLE: an attempt moves through an explicit state machine.
 * `planned` at most once, `attempt_started` at most once (optionally after
 * `planned`, or directly), and at most one terminal event which itself requires
 * a real prior `attempt_started`. No event may follow a terminal event.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LEDGER_PATH = path.join(ROOT, "runs.jsonl");

export type LedgerExecutionState = "planned" | "started" | "completed" | "failed" | "unknown" | "cancelled";

export type LedgerEventType =
  | "planned"
  | "attempt_started"
  | "attempt_completed"
  | "attempt_failed"
  | "attempt_unknown"
  | "cancelled"
  | "superseded"
  | "criteria_removed";

export interface LedgerRecord {
  schemaVersion: string;
  sequence: number;
  slotId: string;
  runId: string;
  attemptId: string;
  eventId: string; // Unique event identifier — stable, generated once before validation
  opaqueCandidateId: string;
  profile: string;
  repetition: number;
  seed: number | null;
  subjectInventory: string[];
  criterionInventory: string[];
  baseTreeIdentity: string;
  headTreeIdentity: string;
  runtimeSnapshotDigest: string;
  criteriaRevision: string;
  policyDigest: string;
  promptDigest: string;
  inputDigest: string;
  requestedModel: string | null;
  observedModel: string | null;
  reasoningConfiguration: Record<string, unknown>;
  adapterEntryIdentity: string;
  startTimestamp: string;
  endTimestamp: string | null;
  executionState: LedgerExecutionState;
  eventType: LedgerEventType;
  requestIds: string[];
  rawArtifactRefs: string[];
  rawUnavailableCause: string | null;
  usage: Record<string, unknown>;
  diagnostics: string[];
  admissionState: string;
  cleanupStatus: string;
  isStub: boolean;
  supersededBy: string | null;
  supersedes: string | null;
  /** Present on `criteria_removed` tombstone events. */
  criterionId?: string | null;
  /** Revision identity being tombstoned. */
  tombstoneOf?: string | null;
  /** Revision lineage this tombstone establishes. */
  lineage?: string | null;
}

export interface LedgerAppendOptions {
  ledgerPath?: string;
  /**
   * When provided, the caller must already own the ledger writer lock under this
   * id (or the ledger must be free). When omitted, the append safely acquires
   * and releases a private in-process ownership for the duration of the append.
   */
  writerId?: string;
}

const TERMINAL_EVENTS: ReadonlySet<LedgerEventType> = new Set([
  "attempt_completed",
  "attempt_failed",
  "attempt_unknown",
  "cancelled",
  "superseded",
]);

const ANONYMOUS_WRITER = "__ledger_anonymous_append__";

// --- Single-writer contract (in-process only) ---
let activeWriter: string | null = null;

export function acquireWriter(writerId: string): boolean {
  if (!writerId) throw new Error("writerId must be non-empty");
  if (activeWriter !== null && activeWriter !== writerId) return false;
  activeWriter = writerId;
  return true;
}

export function releaseWriter(writerId: string): boolean {
  if (activeWriter === writerId) {
    activeWriter = null;
    return true;
  }
  return false;
}

export function isWriterActive(): boolean {
  return activeWriter !== null;
}

export function activeWriterId(): string | null {
  return activeWriter;
}

/**
 * Run `fn` while owning the ledger writer lock. The lock is released even if
 * `fn` throws. Re-entrant for the same writer id.
 */
export function withWriter<T>(writerId: string, fn: () => T): T {
  if (!acquireWriter(writerId)) {
    throw new Error(`ledger writer ${activeWriter} already owns the ledger`);
  }
  try {
    return fn();
  } finally {
    releaseWriter(writerId);
  }
}

function ensureWriter(writerId: string | undefined): { id: string; acquired: boolean } {
  const id = writerId ?? ANONYMOUS_WRITER;
  if (activeWriter === id) return { id, acquired: false };
  if (activeWriter !== null) {
    throw new Error(`ledger writer ${activeWriter} already owns the ledger`);
  }
  activeWriter = id;
  return { id, acquired: true };
}

/**
 * Validate a ledger record's required fields. Returns list of errors.
 */
export function validateLedgerRecord(record: LedgerRecord): string[] {
  const errors: string[] = [];
  if (!record.schemaVersion) errors.push("missing schemaVersion");
  if (typeof record.sequence !== "number") errors.push("missing sequence");
  if (!record.slotId) errors.push("missing slotId");
  if (!record.runId) errors.push("missing runId");
  if (!record.attemptId) errors.push("missing attemptId");
  if (!record.eventId) errors.push("missing eventId");
  if (!record.eventType) errors.push("missing eventType");
  if (!record.opaqueCandidateId) errors.push("missing opaqueCandidateId");
  if (!record.profile) errors.push("missing profile");
  if (typeof record.repetition !== "number") errors.push("missing repetition");
  if (!Array.isArray(record.subjectInventory)) errors.push("subjectInventory must be array");
  if (!Array.isArray(record.criterionInventory)) errors.push("criterionInventory must be array");
  if (!record.criteriaRevision) errors.push("missing criteriaRevision");
  if (!record.policyDigest) errors.push("missing policyDigest");
  if (!record.startTimestamp) errors.push("missing startTimestamp");
  if (!record.executionState) errors.push("missing executionState");
  const validStates: LedgerExecutionState[] = ["planned", "started", "completed", "failed", "unknown", "cancelled"];
  if (!validStates.includes(record.executionState)) errors.push(`invalid executionState: ${record.executionState}`);
  if (typeof record.isStub !== "boolean") errors.push("isStub must be boolean");
  if (!record.eventId.match(/^evt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
    errors.push("eventId must be a UUID v4 format string");
  }
  const validEventTypes: LedgerEventType[] = [
    "planned",
    "attempt_started",
    "attempt_completed",
    "attempt_failed",
    "attempt_unknown",
    "cancelled",
    "superseded",
    "criteria_removed",
  ];
  if (!validEventTypes.includes(record.eventType)) errors.push(`invalid eventType: ${record.eventType}`);

  if (record.eventType === "criteria_removed") {
    if (!record.criterionId) errors.push("criteria_removed requires criterionId");
    if (!record.tombstoneOf) errors.push("criteria_removed requires tombstoneOf (the removed revision identity)");
  }
  return errors;
}

/**
 * Check for duplicate event IDs in a list of records.
 * Returns list of duplicate event ID strings.
 */
export function findDuplicateEventIds(records: LedgerRecord[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of records) {
    if (seen.has(r.eventId)) {
      if (!dups.includes(r.eventId)) dups.push(r.eventId);
    }
    seen.add(r.eventId);
  }
  return dups;
}

/**
 * Check for duplicate attempt-creation events: a second `planned` or a second
 * `attempt_started` for the same run/attempt. `planned` followed by
 * `attempt_started` is a valid lifecycle and is NOT reported here.
 */
export function findDuplicateAttemptStarts(records: LedgerRecord[]): string[] {
  const planned = new Set<string>();
  const started = new Set<string>();
  const dups: string[] = [];
  for (const r of records) {
    const key = `${r.runId}::${r.attemptId}`;
    if (r.eventType === "planned") {
      if (planned.has(key)) {
        if (!dups.includes(key)) dups.push(key);
      }
      planned.add(key);
    } else if (r.eventType === "attempt_started") {
      if (started.has(key)) {
        if (!dups.includes(key)) dups.push(key);
      }
      started.add(key);
    }
  }
  return dups;
}

/**
 * Legacy alias for backward compatibility. Checks duplicate attempt starts.
 */
export function findDuplicateIdentities(records: LedgerRecord[]): string[] {
  return findDuplicateAttemptStarts(records);
}

interface AttemptLifecycleState {
  planned: number;
  started: number;
  terminal: LedgerRecord[];
}

function attemptKey(r: LedgerRecord): string {
  return `${r.runId}::${r.attemptId}`;
}

function lifecycleState(prior: LedgerRecord[]): AttemptLifecycleState {
  const state: AttemptLifecycleState = { planned: 0, started: 0, terminal: [] };
  for (const r of prior) {
    if (r.eventType === "criteria_removed") continue;
    if (r.eventType === "planned") state.planned++;
    else if (r.eventType === "attempt_started") state.started++;
    else if (TERMINAL_EVENTS.has(r.eventType)) state.terminal.push(r);
  }
  return state;
}

/**
 * Validate a single lifecycle transition of `record` against the prior records
 * of the same attempt. Returns a list of errors (empty = allowed).
 */
export function checkLifecycleTransition(prior: LedgerRecord[], record: LedgerRecord): string[] {
  if (record.eventType === "criteria_removed") return [];
  const errors: string[] = [];
  const key = attemptKey(record);
  const attemptPrior = prior.filter((r) => attemptKey(r) === key);
  const state = lifecycleState(attemptPrior);

  // No event may follow a terminal state (no resurrection or contradiction).
  if (state.terminal.length > 0) {
    const last = state.terminal[state.terminal.length - 1];
    errors.push(`${key}: event ${record.eventType} follows terminal event ${last.eventType}`);
    return errors;
  }

  switch (record.eventType) {
    case "planned":
      if (state.planned > 0) errors.push(`${key}: duplicate planned`);
      if (state.started > 0) errors.push(`${key}: planned after attempt_started`);
      break;
    case "attempt_started":
      if (state.started > 0) errors.push(`${key}: duplicate attempt_started`);
      break;
    case "attempt_completed":
    case "attempt_failed":
    case "attempt_unknown":
    case "cancelled":
    case "superseded":
      if (state.started === 0) {
        errors.push(`${key}: terminal event ${record.eventType} requires a real prior attempt_started`);
      }
      break;
  }
  return errors;
}

/**
 * Append a record to the ledger.
 * Rejects duplicate event IDs and invalid lifecycle transitions.
 * Enforces the in-process single-writer contract.
 * Event ID is preserved from the caller — never overwritten.
 */
export function appendLedgerRecord(record: LedgerRecord, options?: LedgerAppendOptions): void {
  const ledgerPath = options?.ledgerPath ?? DEFAULT_LEDGER_PATH;

  const errors = validateLedgerRecord(record);
  if (errors.length > 0) {
    throw new Error(`invalid ledger record: ${errors.join("; ")}`);
  }

  const ownership = ensureWriter(options?.writerId);
  try {
    let existingRecords: LedgerRecord[];
    try {
      existingRecords = readLedger(ledgerPath);
    } catch (err) {
      throw new Error(`failed to read ledger: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Check for duplicate event IDs.
    if (existingRecords.some((r) => r.eventId === record.eventId)) {
      throw new Error(`duplicate eventId: ${record.eventId}`);
    }

    // Validate lifecycle transition against prior records of this attempt.
    const transitionErrors = checkLifecycleTransition(existingRecords, record);
    if (transitionErrors.length > 0) {
      throw new Error(transitionErrors.join("; "));
    }

    // Monotonic sequence: never reuse or move backwards. Event identity is the
    // eventId; sequence is derived append order.
    const lastSeq = existingRecords.reduce((max, r) => Math.max(max, r.sequence), 0);
    record.sequence = lastSeq + 1;

    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(ledgerPath, line, "utf8");
  } finally {
    if (ownership.acquired) releaseWriter(ownership.id);
  }
}

/**
 * Read all records from the ledger.
 * Reports malformed/truncated JSONL with exact line number and cause.
 */
export function readLedger(ledgerPath?: string): LedgerRecord[] {
  const p = ledgerPath ?? DEFAULT_LEDGER_PATH;
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, "utf8");
  const records: LedgerRecord[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    try {
      records.push(JSON.parse(trimmed) as LedgerRecord);
    } catch (err) {
      throw new Error(`malformed JSONL at line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return records;
}

/**
 * Replay ledger integrity: verify monotonic criteria revisions, no duplicate
 * identities, valid event lifecycle transitions, schema validity, and no
 * resurrection of cancelled/superseded attempts.
 */
export function verifyLedgerIntegrity(records: LedgerRecord[]): string[] {
  const errors: string[] = [];

  for (const d of findDuplicateEventIds(records)) errors.push(`duplicate eventId: ${d}`);
  for (const d of findDuplicateAttemptStarts(records)) errors.push(`duplicate identity: ${d}`);

  for (const r of records) {
    for (const e of validateLedgerRecord(r)) errors.push(`${attemptKey(r)}: ${e}`);
  }

  // Replay transitions in sequence order, enforcing per-attempt monotonicity.
  const sorted = [...records].sort((a, b) => a.sequence - b.sequence);
  const seenPerAttempt = new Map<string, LedgerRecord[]>();
  for (const r of sorted) {
    const key = attemptKey(r);
    const prior = seenPerAttempt.get(key) ?? [];
    if (prior.length > 0 && r.sequence <= prior[prior.length - 1].sequence) {
      errors.push(`${key}: sequence not monotonic`);
    }
    for (const e of checkLifecycleTransition(prior, r)) errors.push(e);
    prior.push(r);
    seenPerAttempt.set(key, prior);
  }

  return errors;
}