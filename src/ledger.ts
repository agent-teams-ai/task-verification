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

export const LEDGER_SCHEMA_VERSION = "ledger-event-v1";

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

const EVENT_EXECUTION: Record<LedgerEventType, readonly LedgerExecutionState[]> = {
  planned: ["planned"],
  attempt_started: ["started"],
  attempt_completed: ["completed"],
  attempt_failed: ["failed"],
  attempt_unknown: ["unknown"],
  cancelled: ["cancelled"],
  superseded: ["cancelled"],
  criteria_removed: ["cancelled"],
};

const VALID_EVENT_TYPES: readonly LedgerEventType[] = [
  "planned",
  "attempt_started",
  "attempt_completed",
  "attempt_failed",
  "attempt_unknown",
  "cancelled",
  "superseded",
  "criteria_removed",
];

const VALID_EXECUTION_STATES: readonly LedgerExecutionState[] = [
  "planned",
  "started",
  "completed",
  "failed",
  "unknown",
  "cancelled",
];

const VALID_CLEANUP_STATES = ["clean", "pending", "failed", "unknown"] as const;

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

// --- Validation helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Git tree/commit ids are 40 hex chars; sha256 digests are 64. Accept either. */
function isDigestLike(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isIntegerAtLeastZero(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validate a ledger record's required fields. Returns list of errors.
 * Accepts unknown input and never throws on malformed values.
 */
export function validateLedgerRecord(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["ledger record must be an object"];
  const record = input;

  if (record.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  }
  if (!isIntegerAtLeastZero(record.sequence) || record.sequence < 1) errors.push("sequence must be a positive integer");
  if (!isNonEmptyString(record.slotId)) errors.push("missing or invalid slotId");
  if (!isNonEmptyString(record.runId)) errors.push("missing or invalid runId");
  if (!isNonEmptyString(record.attemptId)) errors.push("missing or invalid attemptId");
  if (!isNonEmptyString(record.eventId)) errors.push("missing or invalid eventId");
  if (!VALID_EVENT_TYPES.includes(record.eventType as LedgerEventType)) {
    errors.push(`invalid eventType: ${String(record.eventType)}`);
  }
  if (!isNonEmptyString(record.opaqueCandidateId)) errors.push("missing or invalid opaqueCandidateId");
  if (!isNonEmptyString(record.profile)) errors.push("missing or invalid profile");
  if (!isIntegerAtLeastZero(record.repetition)) errors.push("repetition must be a non-negative integer");
  if (!isStringArray(record.subjectInventory)) errors.push("subjectInventory must be an array of strings");
  if (!isStringArray(record.criterionInventory)) errors.push("criterionInventory must be an array of strings");
  if (!isDigestLike(record.baseTreeIdentity)) errors.push("baseTreeIdentity must be a hex digest");
  if (!isDigestLike(record.headTreeIdentity)) errors.push("headTreeIdentity must be a hex digest");
  if (!isDigestLike(record.runtimeSnapshotDigest)) errors.push("runtimeSnapshotDigest must be a hex digest");
  if (!isNonEmptyString(record.criteriaRevision)) errors.push("missing or invalid criteriaRevision");
  if (!isDigestLike(record.policyDigest)) errors.push("policyDigest must be a hex digest");
  if (!isDigestLike(record.promptDigest)) errors.push("promptDigest must be a hex digest");
  if (!isDigestLike(record.inputDigest)) errors.push("inputDigest must be a hex digest");
  if (!isNullableString(record.requestedModel)) errors.push("requestedModel must be string or null");
  if (!isNullableString(record.observedModel)) errors.push("observedModel must be string or null");
  if (!isRecord(record.reasoningConfiguration)) errors.push("reasoningConfiguration must be an object");
  if (!isNonEmptyString(record.adapterEntryIdentity)) errors.push("missing or invalid adapterEntryIdentity");
  if (!isIsoTimestamp(record.startTimestamp)) errors.push("startTimestamp must be an ISO timestamp");
  if (!isNullableString(record.endTimestamp)) errors.push("endTimestamp must be string or null");
  if (record.endTimestamp !== null && record.endTimestamp !== undefined && !isIsoTimestamp(record.endTimestamp)) {
    errors.push("endTimestamp must be an ISO timestamp");
  }
  if (!VALID_EXECUTION_STATES.includes(record.executionState as LedgerExecutionState)) {
    errors.push(`invalid executionState: ${String(record.executionState)}`);
  }
  if (!VALID_CLEANUP_STATES.includes(record.cleanupStatus as (typeof VALID_CLEANUP_STATES)[number])) {
    errors.push(`invalid cleanupStatus: ${String(record.cleanupStatus)}`);
  }
  if (!isStringArray(record.requestIds)) errors.push("requestIds must be an array of strings");
  if (!isStringArray(record.rawArtifactRefs)) errors.push("rawArtifactRefs must be an array of strings");
  if (!isNullableString(record.rawUnavailableCause)) errors.push("rawUnavailableCause must be string or null");
  if (!isRecord(record.usage)) errors.push("usage must be an object");
  if (!isStringArray(record.diagnostics)) errors.push("diagnostics must be an array of strings");
  if (!isNonEmptyString(record.admissionState)) errors.push("missing or invalid admissionState");
  if (typeof record.isStub !== "boolean") errors.push("isStub must be boolean");
  if (!isNullableString(record.supersededBy)) errors.push("supersededBy must be string or null");
  if (!isNullableString(record.supersedes)) errors.push("supersedes must be string or null");

  if (!isNonEmptyString(record.eventId) || !/^evt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.eventId)) {
    errors.push("eventId must be a UUID v4 format string");
  }

  // Event type must be consistent with the recorded execution state.
  if (VALID_EVENT_TYPES.includes(record.eventType as LedgerEventType)) {
    const allowed = EVENT_EXECUTION[record.eventType as LedgerEventType];
    if (VALID_EXECUTION_STATES.includes(record.executionState as LedgerExecutionState) && !allowed.includes(record.executionState as LedgerExecutionState)) {
      errors.push(`eventType ${record.eventType} requires executionState in {${allowed.join(",")}}`);
    }
  }

  // Stub/live distinction: a stub must not claim a live model.
  if (record.isStub === true && (record.requestedModel !== null || record.observedModel !== null)) {
    errors.push("stub record must not claim a requested/observed model");
  }

  if (record.eventType === "criteria_removed") {
    if (!isNonEmptyString(record.criterionId)) errors.push("criteria_removed requires criterionId");
    if (!isNonEmptyString(record.tombstoneOf)) {
      errors.push("criteria_removed requires tombstoneOf (the removed revision identity)");
    }
    if (!isNonEmptyString(record.lineage)) errors.push("criteria_removed requires lineage");
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

    // Reject duplicate event IDs before appending.
    if (existingRecords.some((r) => r.eventId === record.eventId)) {
      throw new Error(`duplicate eventId: ${record.eventId}`);
    }

    // Reject a duplicate run/attempt start before appending.
    if (record.eventType === "planned" || record.eventType === "attempt_started") {
      const key = attemptKey(record);
      if (existingRecords.some((r) => attemptKey(r) === key && r.eventType === record.eventType)) {
        throw new Error(`duplicate ${record.eventType} for ${key}`);
      }
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
 * Replay ledger integrity: verify unique event IDs, attempt identity uniqueness,
 * valid lifecycle transitions, criteria revision lineage, supersedes/supersededBy
 * referential integrity, no cycles, no resurrection of cancelled/superseded
 * attempts, stub/live distinction, record schema validity and monotonic event
 * ordering.
 */
export function verifyLedgerIntegrity(records: LedgerRecord[]): string[] {
  const errors: string[] = [];

  // 1. Record schema validity.
  for (const r of records) {
    for (const e of validateLedgerRecord(r)) errors.push(`${attemptKey(r)}: ${e}`);
  }

  // 2. Unique event IDs.
  for (const d of findDuplicateEventIds(records)) errors.push(`duplicate eventId: ${d}`);

  // 3. Attempt identity uniqueness rules.
  for (const d of findDuplicateAttemptStarts(records)) errors.push(`duplicate identity: ${d}`);

  // 4. Monotonic event ordering: sequence must be unique and strictly
  // increasing in file order.
  for (let i = 1; i < records.length; i++) {
    if (records[i].sequence <= records[i - 1].sequence) {
      errors.push(
        `sequence not monotonic at index ${i}: ${records[i - 1].sequence} -> ${records[i].sequence}`,
      );
    }
  }

  // 5. Per-attempt lifecycle transitions in sequence order.
  const sorted = [...records].sort((a, b) => a.sequence - b.sequence);
  const seenPerAttempt = new Map<string, LedgerRecord[]>();
  for (const r of sorted) {
    const key = attemptKey(r);
    const prior = seenPerAttempt.get(key) ?? [];
    for (const e of checkLifecycleTransition(prior, r)) errors.push(e);
    prior.push(r);
    seenPerAttempt.set(key, prior);
  }

  // 6. Supersedes/supersededBy referential integrity and cycle detection.
  const byEventId = new Map<string, LedgerRecord>();
  for (const r of records) byEventId.set(r.eventId, r);

  const supersedeEdges = new Map<string, string[]>();
  for (const r of records) {
    const targets: string[] = [];
    if (r.supersedes) targets.push(r.supersedes);
    if (r.supersededBy) targets.push(r.supersededBy);
    if (targets.length > 0) supersedeEdges.set(r.eventId, targets);
    for (const target of targets) {
      if (target === r.eventId) {
        errors.push(`${attemptKey(r)}: supersedes/supersededBy self-reference`);
      } else if (!byEventId.has(target)) {
        errors.push(`${attemptKey(r)}: supersedes/supersededBy target not found: ${target}`);
      }
    }
    if (r.supersedes && r.supersededBy) {
      errors.push(`${attemptKey(r)}: record cannot both supersede and be superseded`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (visiting.has(id)) {
      errors.push(`supersede cycle: ${[...stack, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of supersedeEdges.get(id) ?? []) visit(next, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of supersedeEdges.keys()) visit(id, []);

  // 7. Criteria revision lineage: tombstones are unique, are not repeated, and
  // a removed revision may not reappear in a later record.
  const tombstoned = new Set<string>();
  const lineages = new Set<string>();
  for (const r of sorted) {
    if (r.eventType === "criteria_removed") {
      const removed = r.tombstoneOf;
      if (removed) {
        if (tombstoned.has(removed)) {
          errors.push(`criteria revision tombstoned twice: ${removed}`);
        }
        tombstoned.add(removed);
      }
      const lineage = r.lineage;
      if (lineage) {
        if (lineages.has(lineage)) errors.push(`duplicate criteria lineage: ${lineage}`);
        lineages.add(lineage);
      }
    } else if (r.criteriaRevision && tombstoned.has(r.criteriaRevision)) {
      errors.push(`${attemptKey(r)}: resurrects removed criteria revision ${r.criteriaRevision}`);
    }
  }

  return errors;
}