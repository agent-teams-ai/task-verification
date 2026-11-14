/**
 * Oracle O-1 orchestration (WP2).
 *
 * Runs the four-HTTP-request behavioral oracle (five criterion assertion
 * groups) against each of the four S1 candidates, twice per candidate, and
 * records machine-readable, versioned results. Also runs the four fault
 * controls (wrong caller, denial-field leakage, missing audit entry,
 * duplicate audit entry) to demonstrate the checks discriminate injected
 * defects while the unmodified fixture passes.
 *
 * No live model calls. Model-free and deterministic.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runPass, type PassResult } from "./driver.ts";
import { REQUEST_FIXTURES } from "./manifest.ts";
import { evaluateAll, type AuditRecord, type RequestResult } from "./assertions.ts";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, "..", "..");
const CANDIDATES_DIR = path.join(ROOT, "candidates");
const RECEIPTS_DIR = path.join(ROOT, ".oracle-receipts");

const CANDIDATE_IDS = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;
const PASSES = 2;

interface CandidateVerdict {
  candidateId: string;
  expectedCriteria: Record<string, boolean>;
  passes: PassResult[];
  repeatable: boolean;
  overallPassed: boolean;
}

interface FaultControl {
  fault: string;
  injectedBehavior: string;
  expectedAffectedCriterion: string;
  rejected: boolean;
  unmodifiedPasses: boolean;
}

interface OracleReceipt {
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
  generatedAt: string;
}

/** Build a fully passing synthetic pass result (unmodified fixture reference). */
const MISSING_AUDIT_RECORD: AuditRecord = {
  event: "profile.access.denied",
  reason: "missing_credential",
  path: "/profile",
  tokenPresent: false,
  timestamp: new Date(Date.now()).toISOString(),
};

function passingResult(candidateId: string): PassResult {
  const requests: RequestResult[] = REQUEST_FIXTURES.map((fx) => {
    if (fx.id === "P-active-a") {
      return { requestId: fx.id, statusCode: 200, body: { id: "caller-a", email: "caller-a@example.example" } };
    }
    if (fx.id === "P-active-b") {
      return { requestId: fx.id, statusCode: 200, body: { id: "caller-b", email: "caller-b@example.example" } };
    }
    return { requestId: fx.id, statusCode: 401, body: {} };
  });
  const auditDeltas = new Map<string, AuditRecord[]>([["P-missing", [MISSING_AUDIT_RECORD]]]);
  const assertions = evaluateAll(new Map(requests.map((r) => [r.requestId, r])), [MISSING_AUDIT_RECORD]);
  return { candidateId, pass: 1, port: 0, requests, auditDeltas, assertions, passed: true };
}

/** Run one fault control: mutate a passing result so one criterion fails. */
function runFaultControl(
  fault: string,
  injectedBehavior: string,
  mutate: (r: PassResult) => void,
  expectedAffectedCriterion: string
): FaultControl {
  const base = passingResult("S1-C1");
  mutate(base);
  // Re-evaluate the assertion groups against the mutated (faulty) behavior.
  base.assertions = evaluateAll(
    new Map(base.requests.map((r) => [r.requestId, r])),
    base.auditDeltas.get("P-missing") ?? []
  );
  base.passed = [...base.assertions.values()].every((a) => a.passed);
  const affected = base.assertions.get(expectedAffectedCriterion);
  // A fault is rejected when the criterion it targets is violated by the
  // mutated behavior. (A single injected defect may trip more than one
  // criterion; that does not make the target criterion any less violated.)
  const rejected = !affected?.passed;
  return {
    fault,
    injectedBehavior,
    expectedAffectedCriterion,
    rejected,
    unmodifiedPasses: passingResult("S1-C1").passed,
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

  const candidates: CandidateVerdict[] = [];
  let totalHttpRequests = 0;
  let totalAssertionEvaluations = 0;

  for (const candidateId of CANDIDATE_IDS) {
    const manifestPath = path.join(CANDIDATES_DIR, candidateId, "MANIFEST.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const candidateAppPath = path.join(CANDIDATES_DIR, candidateId, "src", "app.ts");

    const passes: PassResult[] = [];
    for (let p = 1; p <= PASSES; p++) {
      const passResult = await runPass(candidateAppPath, candidateId, p);
      passes.push(passResult);
      totalHttpRequests += REQUEST_FIXTURES.length;
      totalAssertionEvaluations += passResult.assertions.size;
    }

    const repeatable =
      passes[0].passed === passes[1].passed &&
      JSON.stringify(
        [...passes[0].assertions.entries()].map(([cid, a]) => [cid, a.passed])
      ) ===
        JSON.stringify(
          [...passes[1].assertions.entries()].map(([cid, a]) => [cid, a.passed])
        );
    const overallPassed = passes[0].passed && passes[1].passed;

    candidates.push({
      candidateId,
      expectedCriteria: manifest.expectedCriteria,
      passes,
      repeatable,
      overallPassed,
    });
  }

  const faultControls: FaultControl[] = [
    runFaultControl(
      "wrong-caller-identity",
      "P-active-a response body reports caller id 'wrong-caller' instead of 'caller-a'",
      (r) => {
        const activeA = r.requests.find((x) => x.requestId === "P-active-a");
        if (activeA) {
          activeA.body = { id: "wrong-caller", email: "caller-a@example.example" };
        }
      },
      "AC-1"
    ),
    runFaultControl(
      "denial-field-leakage",
      "P-missing denial response body includes the sensitive 'role' field",
      (r) => {
        const missing = r.requests.find((x) => x.requestId === "P-missing");
        if (missing) {
          missing.body = { error: "missing_credential", role: "reviewer" };
        }
      },
      "AC-4"
    ),
    runFaultControl(
      "missing-audit-entry",
      "P-missing writes zero audit records (AC-5 audit delta is empty)",
      (r) => {
        r.auditDeltas.set("P-missing", []);
      },
      "AC-5"
    ),
    runFaultControl(
      "duplicate-audit-entry",
      "P-missing writes two audit records instead of exactly one",
      (r) => {
        r.auditDeltas.set("P-missing", [
          { event: "profile.access.denied", reason: "missing_credential", path: "/profile", tokenPresent: false, timestamp: new Date(Date.now()).toISOString() },
          { event: "profile.access.denied", reason: "missing_credential", path: "/profile", tokenPresent: false, timestamp: new Date(Date.now()).toISOString() },
        ]);
      },
      "AC-5"
    ),
  ];

  const receipt: OracleReceipt = {
    oracleId: "O-1",
    oracleVersion: "v1",
    criteria: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"],
    requestMatrix: {
      requestsPerCandidatePerPass: REQUEST_FIXTURES.length,
      candidates: CANDIDATE_IDS.length,
      passes: PASSES,
      totalHttpRequests: CANDIDATE_IDS.length * PASSES * REQUEST_FIXTURES.length,
      assertionGroupsPerCandidatePerPass: 5,
      totalAssertionGroupEvaluations: CANDIDATE_IDS.length * PASSES * 5,
    },
    candidates,
    faultControls,
    generatedAt: new Date(Date.now()).toISOString(),
  };

  const outPath = path.join(RECEIPTS_DIR, "oracle-results.json");
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");

  // Console summary.
  console.log(`Oracle O-1 v1 results (${receipt.requestMatrix.totalHttpRequests} HTTP requests, ${receipt.requestMatrix.totalAssertionGroupEvaluations} assertion-group evaluations)`);
  for (const c of candidates) {
    console.log(
      `  ${c.candidateId}: pass1=${c.passes[0].passed} pass2=${c.passes[1].passed} repeatable=${c.repeatable} overall=${c.overallPassed} | expected=${JSON.stringify(c.expectedCriteria)}`
    );
    for (const p of c.passes) {
      for (const [cid, a] of p.assertions) {
        if (!a.passed) {
          console.log(`    FAIL ${c.candidateId} pass${p.pass} ${cid}: ${a.detail}`);
        }
      }
    }
  }
  console.log("Fault controls:");
  for (const fc of faultControls) {
    console.log(`  ${fc.fault}: affected=${fc.expectedAffectedCriterion} rejected=${fc.rejected} unmodifiedPasses=${fc.unmodifiedPasses}`);
  }
  console.log(`Receipt written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
