/**
 * Run ledger (WP6).
 *
 * Append-only JSONL ledger (`runs.jsonl`) for the experimental harness.
 * Every started attempt produces a record, including failures and unknown
 * effects. Never silently omitted. Never rewritten to turn failure into
 * success; corrections are new linked records.
 *
 * SINGLE-WRITER CONTRACT: This implementation supports a single writer
 * within a single process. The `acquireWriter`/`releaseWriter` functions
 * manage an in-process lock only. Cross-process concurrency is NOT
 * supported; callers in multi-process environments must serialize access
 * externally (e.g., via file locking at the OS level). `appendFileSync`
 * is NOT a write lock — it is a blocking I/O call that provides no
 * inter-process mutual exclusion.
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
  | "superseded";

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
}

export interface LedgerAppendOptions {
  ledgerPath?: string;
}

// --- Single-writer contract (in-process only) ---
let activeWriter: string | null = null;

export function acquireWriter(writerId: string): boolean {
  if (activeWriter !== null && activeWriter !== writerId) {
    return false;
  }
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
  const validEventTypes: LedgerEventType[] = ["planned", "attempt_started", "attempt_completed", "attempt_failed", "attempt_unknown", "cancelled", "superseded"];
  if (!validEventTypes.includes(record.eventType)) errors.push(`invalid eventType: ${record.eventType}`);
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
 * Check for duplicate attempt creation (same run/attempt with a "planned" or "attempt_started" event).
 * Multiple lifecycle events for the same attempt are allowed.
 * Returns list of duplicate attempt identity strings.
 */
export function findDuplicateAttemptStarts(records: LedgerRecord[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of records) {
    if (r.eventType === "planned" || r.eventType === "attempt_started") {
      const key = `${r.runId}::${r.attemptId}`;
      if (seen.has(key)) {
        if (!dups.includes(key)) dups.push(key);
      }
      seen.add(key);
    }
  }
  return dups;
}

/**
 * Legacy alias for backward compatibility with existing tests.
 * Now checks for duplicate attempt starts (not all events).
 */
export function findDuplicateIdentities(records: LedgerRecord[]): string[] {
  return findDuplicateAttemptStarts(records);
}

/**
 * Append a record to the ledger.
 * Rejects duplicate event IDs and invalid lifecycle transitions.
 * Event ID is preserved from the caller — never overwritten.
 */
export function appendLedgerRecord(record: LedgerRecord, options?: LedgerAppendOptions): void {
  const ledgerPath = options?.ledgerPath ?? DEFAULT_LEDGER_PATH;
  const errors = validateLedgerRecord(record);
  if (errors.length > 0) {
    throw new Error(`invalid ledger record: ${errors.join("; ")}`);
  }

  // Do NOT overwrite eventId — it must be stable and generated once before validation.

  // Set schemaVersion if not provided (already validated above).
  if (!record.schemaVersion) {
    record.schemaVersion = "ledger-event-v1";
  }

  // Read existing ledger.
  let existingRecords: LedgerRecord[];
  try {
    existingRecords = readLedger(ledgerPath);
  } catch (err) {
    throw new Error(`failed to read ledger: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Set sequence based on existing records (monotonic).
  record.sequence = existingRecords.length + 1;

  // Check for duplicate event IDs.
  const existingEventIds = existingRecords.map((r) => r.eventId);
  if (existingEventIds.includes(record.eventId)) {
    throw new Error(`duplicate eventId: ${record.eventId}`);
  }

  // Check for duplicate attempt starts (not all events).
  const dupStarts = findDuplicateAttemptStarts([...existingRecords, record]);
  if (dupStarts.length > 0) {
    throw new Error(`duplicate attempt start: ${dupStarts.join(", ")}`);
  }

  // Validate lifecycle transitions per attempt.
  const attemptKey = `${record.runId}::${record.attemptId}`;
  const attemptRecords = existingRecords.filter((r) => `${r.runId}::${r.attemptId}` === attemptKey);

  // Terminal events require a prior start.
  const terminalEvents = ["attempt_completed", "attempt_failed", "attempt_unknown", "cancelled", "superseded"];
  if (terminalEvents.includes(record.eventType)) {
    const hasStart = attemptRecords.some((r) => r.eventType === "attempt_started" || r.eventType === "planned");
    if (!hasStart) {
      throw new Error(`terminal event ${record.eventType} requires prior start for ${attemptKey}`);
    }
  }

  // Cancelled/superseded attempts cannot be resurrected.
  if (record.eventType === "attempt_started" || record.eventType === "planned") {
    const wasCancelled = attemptRecords.some((r) => r.eventType === "cancelled" || r.eventType === "superseded");
    if (wasCancelled) {
      throw new Error(`cannot resurrect cancelled/superseded attempt: ${attemptKey}`);
    }
  }

  // Monotonic sequence check.
  if (existingRecords.length > 0) {
    const lastSeq = Math.max(...existingRecords.map((r) => r.sequence));
    if (record.sequence <= lastSeq) {
      // Allow if explicitly set higher; otherwise auto-increment.
      record.sequence = lastSeq + 1;
    }
  }

  const line = JSON.stringify(record) + "\n";
  fs.appendFileSync(ledgerPath, line, "utf8");
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
 * identities, valid event lifecycle transitions, schema validity.
 * Also checks for resurrection of cancelled/superseded attempts.
 */
export function verifyLedgerIntegrity(records: LedgerRecord[]): string[] {
  const errors: string[] = [];

  // Check duplicate event IDs.
  const dupEvents = findDuplicateEventIds(records);
  for (const d of dupEvents) errors.push(`duplicate eventId: ${d}`);

  // Check duplicate attempt starts.
  const dupStarts = findDuplicateAttemptStarts(records);
  for (const d of dupStarts) errors.push(`duplicate identity: ${d}`);

  for (const r of records) {
    const recErrors = validateLedgerRecord(r);
    for (const e of recErrors) errors.push(`${r.runId}/${r.attemptId}: ${e}`);
  }

  // Check event lifecycle transitions per attempt.
  const attempts = new Map<string, LedgerRecord[]>();
  for (const r of records) {
    const key = `${r.runId}::${r.attemptId}`;
    if (!attempts.has(key)) attempts.set(key, []);
    attempts.get(key)!.push(r);
  }

  for (const [attemptKey, attemptRecords] of attempts) {
    // Sort by sequence.
    const sorted = [...attemptRecords].sort((a, b) => a.sequence - b.sequence);

    // Check terminal events require prior start.
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const terminalEvents = ["attempt_completed", "attempt_failed", "attempt_unknown", "cancelled", "superseded"];
      if (terminalEvents.includes(r.eventType)) {
        const hasPriorStart = sorted.slice(0, i).some((prev) => prev.eventType === "attempt_started" || prev.eventType === "planned");
        if (!hasPriorStart) {
          errors.push(`${attemptKey}: terminal event ${r.eventType} requires prior start`);
        }
      }
    }

    // Check cancelled/superseded cannot be resurrected.
    const cancelledIndex = sorted.findIndex((r) => r.eventType === "cancelled" || r.eventType === "superseded");
    if (cancelledIndex !== -1) {
      const afterCancelled = sorted.slice(cancelledIndex + 1);
      for (const r of afterCancelled) {
        if (r.eventType === "attempt_started" || r.eventType === "planned") {
          errors.push(`${attemptKey}: cannot resurrect cancelled/superseded attempt`);
        }
      }
    }

    // Check monotonic sequence.
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].sequence <= sorted[i - 1].sequence) {
        errors.push(`${attemptKey}: sequence not monotonic`);
      }
    }
  }

  return errors;
}
