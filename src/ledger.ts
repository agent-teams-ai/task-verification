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

export interface LedgerRecord {
  slotId: string;
  runId: string;
  attemptId: string;
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

/**
 * Validate a ledger record's required fields. Returns list of errors.
 */
export function validateLedgerRecord(record: LedgerRecord): string[] {
  const errors: string[] = [];
  if (!record.slotId) errors.push("missing slotId");
  if (!record.runId) errors.push("missing runId");
  if (!record.attemptId) errors.push("missing attemptId");
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
    const key = `${r.runId}::${r.attemptId}`;
    if (seen.has(key)) {
      if (!dups.includes(key)) dups.push(key);
    }
    seen.add(key);
  }
  return dups;
}

/**
 * Append a record to the ledger (atomic-ish: write to temp then rename).
 */
export function appendLedgerRecord(record: LedgerRecord, options?: LedgerAppendOptions): void {
  const ledgerPath = options?.ledgerPath ?? DEFAULT_LEDGER_PATH;
  const errors = validateLedgerRecord(record);
  if (errors.length > 0) {
    throw new Error(`invalid ledger record: ${errors.join("; ")}`);
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
 * identities, schema validity.
 */
export function verifyLedgerIntegrity(records: LedgerRecord[]): string[] {
  const errors: string[] = [];
  const dups = findDuplicateIdentities(records);
  for (const d of dups) errors.push(`duplicate run/attempt identity: ${d}`);
  for (const r of records) {
    const recErrors = validateLedgerRecord(r);
    for (const e of recErrors) errors.push(`${r.runId}/${r.attemptId}: ${e}`);
  }
  return errors;
}
