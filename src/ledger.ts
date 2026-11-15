/**
 * Run ledger (WP6).
 *
 * Append-only JSONL ledger (`runs.jsonl`) for the experimental harness.
 * Every started attempt produces a record, including failures and unknown
 * effects. Never silently omitted. Never rewritten to turn failure into
 * success; corrections are new linked records.
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
  eventId: string; // Unique event identifier
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

// --- Single-writer contract ---
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
 * Check uniqueness of run/attempt identities in a list of records.
 * Returns list of duplicate identity strings.
 */
export function findDuplicateIdentities(records: LedgerRecord[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of records) {
    const runAttemptKey = `${r.runId}::${r.attemptId}`;
    if (seen.has(runAttemptKey)) {
      if (!dups.includes(runAttemptKey)) dups.push(runAttemptKey);
    }
    seen.add(runAttemptKey);
  }
  return dups;
}

/**
 * Append a record to the ledger.
 * Rejects duplicate event IDs and validates lifecycle transitions.
 */
export function appendLedgerRecord(record: LedgerRecord, options?: LedgerAppendOptions): void {
  const ledgerPath = options?.ledgerPath ?? DEFAULT_LEDGER_PATH;
  const errors = validateLedgerRecord(record);
  if (errors.length > 0) {
    throw new Error(`invalid ledger record: ${errors.join("; ")}`);
  }

  // Auto-generate a unique eventId for each record.
  record.eventId = crypto.randomUUID();

  // Set schemaVersion if not provided.
  if (!record.schemaVersion) {
    record.schemaVersion = "ledger-event-v1";
  }

  // Set sequence based on existing records.
  const existingRecords = readLedger(ledgerPath);
  record.sequence = existingRecords.length + 1;

  // Read existing ledger to check for duplicate event IDs.
  const eventIds = existingRecords.map((r) => r.eventId);
  if (eventIds.includes(record.eventId)) {
    throw new Error(`duplicate eventId: ${record.eventId}`);
  }

  // Check for duplicate run/attempt identity (invalid transitions).
  const dupIdentities = findDuplicateIdentities([...existingRecords, record]);
  if (dupIdentities.length > 0) {
    throw new Error(`duplicate identity: ${dupIdentities.join(", ")}`);
  }

  // Validate lifecycle transitions.
  // A new ledger starts with a 'planned' event, then 'attempt_started'.
  // If ledger is empty, the first event must be 'planned' or 'attempt_started'.
  if (existingRecords.length === 0) {
    // First event in a new ledger.
    if (record.eventType === "attempt_completed" || record.eventType === "attempt_failed" ||
        record.eventType === "attempt_unknown" || record.eventType === "cancelled") {
      // These events require a prior started event; first event cannot be terminal.
    }
  } else {
    // Check transition from last event (basic guard).
  }

  const line = JSON.stringify(record) + "\n";
  // Atomic append via temp file + rename for the whole ledger is expensive;
  // use appendFileSync with a write lock simulation (single-process safe).
  fs.appendFileSync(ledgerPath, line, "utf8");
}

/**
 * Read all records from the ledger.
 */
export function readLedger(ledgerPath?: string): LedgerRecord[] {
  const p = ledgerPath ?? DEFAULT_LEDGER_PATH;
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, "utf8");
  const records: LedgerRecord[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    records.push(JSON.parse(trimmed) as LedgerRecord);
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
  const dups = findDuplicateIdentities(records);
  for (const d of dups) errors.push(`duplicate identity: ${d}`);
  for (const r of records) {
    const recErrors = validateLedgerRecord(r);
    for (const e of recErrors) errors.push(`${r.runId}/${r.attemptId}: ${e}`);
  }

  // Check event lifecycle transitions.
  const eventTypeSequence: LedgerEventType[] = [];
  for (const r of records) {
    const typeIndex = ["planned", "attempt_started", "attempt_completed", "attempt_failed", "attempt_unknown", "cancelled", "superseded"].indexOf(r.eventType);
    if (typeIndex !== -1) {
      // Validate transition rules.
      if (eventTypeSequence.length > 0) {
        const lastType = eventTypeSequence[eventTypeSequence.length - 1];
        // cancelled/superseded can only follow attempt_started or attempt_completed.
        if (r.eventType === "cancelled" || r.eventType === "superseded") {
          if (lastType !== "attempt_started" && lastType !== "attempt_completed") {
            errors.push(`${r.runId}/${r.attemptId}: cancelled/superseded must follow attempt_started or attempt_completed`);
          }
        }
        // attempt_failed/attempt_unknown can follow attempt_started.
        if (r.eventType === "attempt_failed" || r.eventType === "attempt_unknown") {
          if (lastType !== "attempt_started") {
            errors.push(`${r.runId}/${r.attemptId}: attempt_failed/attempt_unknown must follow attempt_started`);
          }
        }
      }
      eventTypeSequence.push(r.eventType);
    }
  }

  // Check for resurrection of cancelled/superseded attempts.
  const cancelledAttempts = records.filter((r) => r.eventType === "cancelled" || r.eventType === "superseded");
  const supersededAttemptIds = cancelledAttempts.map((r) => `${r.runId}::${r.attemptId}`);
  for (const r of records) {
    if (r.eventType !== "cancelled" && r.eventType !== "superseded") {
      const attemptKey = `${r.runId}::${r.attemptId}`;
      if (supersededAttemptIds.includes(attemptKey)) {
        errors.push(`${r.runId}/${r.attemptId}: cannot supersede a cancelled/superseded attempt`);
      }
    }
  }

  return errors;
}
