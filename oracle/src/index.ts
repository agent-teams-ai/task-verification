/**
 * Oracle O-1 command-line entry point (WP2).
 *
 * No live model calls. Model-free and deterministic.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runOracle } from "./run.ts";

export async function main(): Promise<void> {
  const { summary, receipts } = await runOracle();

  console.log(
    `Oracle O-1 v1 results (${summary.requestMatrix.totalHttpRequests} HTTP requests, ${summary.requestMatrix.totalAssertionGroupEvaluations} assertion-group evaluations)`
  );
  for (const candidate of summary.candidates) {
    console.log(
      `  ${candidate.candidateId}: pass1=${candidate.passes[0]?.passed} pass2=${candidate.passes[1]?.passed} repeatable=${candidate.repeatable} overall=${candidate.overallPassed} | expected=${JSON.stringify(candidate.expectedCriteria)}`
    );
    for (const receipt of receipts.filter((r) => r.candidateId === candidate.candidateId)) {
      for (const [criterionId, assertion] of Object.entries(receipt.assertions)) {
        if (!assertion.passed) {
          console.log(
            `    FAIL ${candidate.candidateId} pass${receipt.pass} ${criterionId}: ${assertion.detail}`
          );
        }
      }
    }
  }
  console.log("Fault controls:");
  for (const fault of summary.faultControls) {
    console.log(
      `  ${fault.fault}: affected=${fault.expectedAffectedCriterion} rejected=${fault.rejected} unmodifiedPasses=${fault.unmodifiedPasses}`
    );
  }
  console.log(`Receipts written to ${path.dirname(summary.receiptFiles[0])}`);
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
