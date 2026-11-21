/**
 * Oracle O-1 orchestration and persisted receipts (WP2).
 *
 * Runs every candidate pass in a fresh child process, evaluates assertions in
 * the parent, and persists plain-JSON receipts. Maps are never serialized
 * directly: assertion results and audit deltas are converted to explicit
 * JSON-safe objects before the receipt is written.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runPass, type PassExecution } from "./driver.ts";
import { REQUEST_FIXTURES } from "./manifest.ts";
import {
  evaluateAll,
  type AssertionResult,
  type AuditRecord,
  type RequestResult,
} from "./assertions.ts";

const RUN_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(RUN_DIR, "..", "..");
export const DEFAULT_RECEIPTS_DIR = path.join(REPO_ROOT, ".oracle-receipts");

export const CANDIDATE_IDS = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;
export const PASSES = 2;
export const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;

export interface PassReceipt {
  candidateId: string;
  pass: number;
  process: {
    pid: number;
    ppid: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  };
  requests: RequestResult[];
  auditDeltas: Record<string, AuditRecord[]>;
  assertions: Record<string, AssertionResult>;
  passed: boolean;
  execution: {
    durationMs: number;
    generatedAt: string;
  };
}

export interface CandidateVerdict {
  candidateId: string;
  expectedCriteria: Record<string, boolean>;
  passes: {
    pass: number;
    receiptFile: string;
    passed: boolean;
    assertions: Record<string, boolean>;
  }[];
  repeatable: boolean;
  overallPassed: boolean;
}

export interface FaultControl {
  fault: string;
  injectedBehavior: string;
  expectedAffectedCriterion: string;
  rejected: boolean;
  unmodifiedPasses: boolean;
}

export interface OracleSummary {
  oracleId: string;
  oracleVersion: string;
  criteria: string[];
  requestMatrix: {
    requestsPerCandidatePerPass: number;
    candidates: number;
    passes: number;
    totalHttpRequests: number;
    assertionGroupsPerCandidatePerPass: number;
    totalAssertionGroupEvaluations: number;
  };
  candidates: CandidateVerdict[];
  faultControls: FaultControl[];
  receiptFiles: string[];
  generatedAt: string;
}

export interface RunOracleOptions {
  receiptsDir?: string;
  candidates?: readonly string[];
  passes?: number;
  passTimeoutMs?: number;
}

export interface RunOracleResult {
  summary: OracleSummary;
  receipts: PassReceipt[];
}

export function toReceipt(execution: PassExecution): PassReceipt {
  return {
    candidateId: execution.candidateId,
    pass: execution.pass,
    process: {
      pid: execution.process.pid,
      ppid: execution.process.ppid,
      exitCode: execution.process.exitCode,
      signal: execution.process.signal,
    },
    requests: execution.requests,
    auditDeltas: execution.auditDeltas,
    assertions: execution.assertions,
    passed: execution.passed,
    execution: {
      durationMs: execution.durationMs,
      generatedAt: new Date(Date.now()).toISOString(),
    },
  };
}

/** Recursively sort object keys for stable serialization. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical receipt form: volatile execution metadata (PID, duration, wall
 * clock) and audit timestamps are removed so repeated runs compare equal.
 */
export function canonicalizeReceipt(receipt: PassReceipt): unknown {
  const clone = JSON.parse(JSON.stringify(receipt)) as PassReceipt;
  delete (clone as Partial<PassReceipt>).process;
  delete (clone as Partial<PassReceipt>).execution;
  // The pass ordinal is execution bookkeeping, not observed behavior.
  delete (clone as Partial<PassReceipt>).pass;
  for (const records of Object.values(clone.auditDeltas)) {
    for (const record of records) {
      delete (record as Partial<AuditRecord>).timestamp;
    }
  }
  return sortKeys(clone);
}

export function canonicalReceiptJson(receipt: PassReceipt): string {
  return JSON.stringify(canonicalizeReceipt(receipt));
}

export function semanticDigest(receipt: PassReceipt): string {
  return crypto.createHash("sha256").update(canonicalReceiptJson(receipt)).digest("hex");
}

/** Build a fully passing synthetic observation set for fault controls. */
function passingSynthetic(): {
  requests: RequestResult[];
  auditDeltas: Record<string, AuditRecord[]>;
} {
  const missing: AuditRecord = {
    event: "profile.access.denied",
    reason: "missing_credential",
    path: "/profile",
    tokenPresent: false,
    timestamp: new Date(Date.now()).toISOString(),
  };
  const requests: RequestResult[] = REQUEST_FIXTURES.map((fx) => {
    if (fx.id === "P-active-a") {
      return {
        requestId: fx.id,
        statusCode: 200,
        body: { id: "caller-a", email: "caller-a@example.example" },
      };
    }
    if (fx.id === "P-active-b") {
      return {
        requestId: fx.id,
        statusCode: 200,
        body: { id: "caller-b", email: "caller-b@example.example" },
      };
    }
    return { requestId: fx.id, statusCode: 401, body: {} };
  });
  return { requests, auditDeltas: { "P-missing": [missing] } };
}

function runFaultControl(
  fault: string,
  injectedBehavior: string,
  mutate: (requests: RequestResult[], auditDeltas: Record<string, AuditRecord[]>) => void,
  expectedAffectedCriterion: string
): FaultControl {
  const { requests, auditDeltas } = passingSynthetic();
  mutate(requests, auditDeltas);
  const results = new Map(requests.map((r) => [r.requestId, r]));
  const evaluated = evaluateAll(results, auditDeltas["P-missing"] ?? []);
  const affected = evaluated.get(expectedAffectedCriterion);
  const unmodified = passingSynthetic();
  const unmodifiedEvaluated = evaluateAll(
    new Map(unmodified.requests.map((r) => [r.requestId, r])),
    unmodified.auditDeltas["P-missing"] ?? []
  );
  return {
    fault,
    injectedBehavior,
    expectedAffectedCriterion,
    rejected: !affected?.passed,
    unmodifiedPasses: [...unmodifiedEvaluated.values()].every((a) => a.passed),
  };
}

function buildFaultControls(): FaultControl[] {
  return [
    runFaultControl(
      "wrong-caller-identity",
      "P-active-a response body reports caller id 'wrong-caller' instead of 'caller-a'",
      (requests) => {
        const activeA = requests.find((x) => x.requestId === "P-active-a");
        if (activeA) activeA.body = { id: "wrong-caller", email: "caller-a@example.example" };
      },
      "AC-1"
    ),
    runFaultControl(
      "denial-field-leakage",
      "P-missing denial response body includes the sensitive 'role' field",
      (requests) => {
        const missing = requests.find((x) => x.requestId === "P-missing");
        if (missing) missing.body = { error: "missing_credential", role: "reviewer" };
      },
      "AC-4"
    ),
    runFaultControl(
      "missing-audit-entry",
      "P-missing writes zero audit records (AC-5 audit delta is empty)",
      (_requests, auditDeltas) => {
        auditDeltas["P-missing"] = [];
      },
      "AC-5"
    ),
    runFaultControl(
      "duplicate-audit-entry",
      "P-missing writes two audit records instead of exactly one",
      (_requests, auditDeltas) => {
        const base = auditDeltas["P-missing"][0];
        auditDeltas["P-missing"] = [base, { ...base }];
      },
      "AC-5"
    ),
  ];
}

/** Run the complete two-pass oracle for every candidate and persist receipts. */
export async function runOracle(options: RunOracleOptions = {}): Promise<RunOracleResult> {
  const receiptsDir = options.receiptsDir ?? DEFAULT_RECEIPTS_DIR;
  const candidateIds = options.candidates ?? CANDIDATE_IDS;
  const passes = options.passes ?? PASSES;
  fs.mkdirSync(receiptsDir, { recursive: true });

  const receipts: PassReceipt[] = [];
  const verdicts: CandidateVerdict[] = [];
  const receiptFiles: string[] = [];

  for (const candidateId of candidateIds) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "candidates", candidateId, "MANIFEST.json"), "utf8")
    ) as { expectedCriteria: Record<string, boolean> };
    const candidateReceipts: PassReceipt[] = [];

    for (let pass = 1; pass <= passes; pass++) {
      const execution = await runPass({
        candidateId,
        pass,
        srcDir: path.join(REPO_ROOT, "candidates", candidateId, "src"),
        timeoutMs: options.passTimeoutMs,
      });
      const receipt = toReceipt(execution);
      const receiptFile = path.join(receiptsDir, `${candidateId}-pass${pass}.json`);
      fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n", "utf8");
      receipts.push(receipt);
      candidateReceipts.push(receipt);
      receiptFiles.push(receiptFile);
    }

    const first = candidateReceipts[0];
    const repeatable = candidateReceipts.every(
      (r) => semanticDigest(r) === semanticDigest(first)
    );
    verdicts.push({
      candidateId,
      expectedCriteria: manifest.expectedCriteria,
      passes: candidateReceipts.map((r) => ({
        pass: r.pass,
        receiptFile: path.join(receiptsDir, `${candidateId}-pass${r.pass}.json`),
        passed: r.passed,
        assertions: Object.fromEntries(
          Object.entries(r.assertions).map(([id, a]) => [id, a.passed])
        ),
      })),
      repeatable,
      overallPassed: candidateReceipts.every((r) => r.passed),
    });
  }

  const summary: OracleSummary = {
    oracleId: "O-1",
    oracleVersion: "v1",
    criteria: [...CRITERIA],
    requestMatrix: {
      requestsPerCandidatePerPass: REQUEST_FIXTURES.length,
      candidates: candidateIds.length,
      passes,
      totalHttpRequests: candidateIds.length * passes * REQUEST_FIXTURES.length,
      assertionGroupsPerCandidatePerPass: CRITERIA.length,
      totalAssertionGroupEvaluations: candidateIds.length * passes * CRITERIA.length,
    },
    candidates: verdicts,
    faultControls: buildFaultControls(),
    receiptFiles,
    generatedAt: new Date(Date.now()).toISOString(),
  };

  fs.writeFileSync(
    path.join(receiptsDir, "oracle-results.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8"
  );

  return { summary, receipts };
}
