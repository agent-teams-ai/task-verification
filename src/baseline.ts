/**
 * Deterministic baseline (WP4).
 *
 * Consumes a versioned evidence packet and the frozen criterion policy only.
 * Never reads sealed truth artifacts, scorer internals, or another candidate's state.
 * Never calls a model or external service.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidencePacket } from "./evidence.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_DIR = path.join(ROOT, "baseline");
export const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;

export type BaselineOutcome = "satisfied" | "violated" | "unresolved";

export interface BaselineCriterionResult {
  criterionId: string;
  outcome: BaselineOutcome;
  rationale: string;
  evidenceRefs: string[];
}

export interface BaselineResult {
  baselineId: string;
  version: string;
  candidateAnonId: string;
  candidateSnapshotDigest: string;
  outcomes: BaselineCriterionResult[];
}

export function runBaseline(packet: EvidencePacket): BaselineResult {
  const outcomes: BaselineCriterionResult[] = [];
  for (const cr of CRITERIA) {
    const ids = packet.criterionChecks[cr] ?? [];
    const items = packet.evidence.filter((e) => e.criterionId === cr);
    const applicableFresh = items.filter((e) => e.applicability === "applicable" && e.freshness === "fresh");
    const contradictions = applicableFresh.filter((e) => e.observation === "fail");
    const passes = applicableFresh.filter((e) => e.observation === "pass");
    const unavailable = items.filter((e) => e.observation === "unavailable" || e.freshness === "stale" || e.applicability === "inapplicable");

    let outcome: BaselineOutcome;
    let rationale: string;
    if (contradictions.length > 0) {
      outcome = "violated";
      rationale = `Applicable observed violation(s): ${contradictions.map((e) => e.evidenceId).join(", ")}.`;
    } else if (applicableFresh.length > 0 && passes.length === applicableFresh.length && unavailable.length === 0 && applicableFresh.length >= (packet.criterionChecks[cr]?.length ?? 1)) {
      outcome = "satisfied";
      rationale = `All required applicable fresh observations pass: ${passes.map((e) => e.evidenceId).join(", ")}.`;
    } else {
      outcome = "unresolved";
      rationale = `Insufficient/unavailable/stale/inapplicable evidence; passes=${passes.length}, contradictions=${contradictions.length}, unavailable=${unavailable.length}.`;
    }
    outcomes.push({
      criterionId: cr,
      outcome,
      rationale,
      evidenceRefs: ids,
    });
  }
  return {
    baselineId: "baseline-v1",
    version: "v1",
    candidateAnonId: packet.candidateAnonId,
    candidateSnapshotDigest: packet.candidateSnapshotDigest,
    outcomes,
  };
}

export function runAllBaselines(evidenceDir?: string): BaselineResult[] {
  const dir = evidenceDir ?? EVIDENCE_DIR_PLACEHOLDER();
  const results: BaselineResult[] = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith("S1-FIX-"));
  for (const f of files.sort()) {
    const packet = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as EvidencePacket;
    results.push(runBaseline(packet));
  }
  return results;
}

function EVIDENCE_DIR_PLACEHOLDER(): string {
  return path.join(ROOT, "evidence-v1");
}
