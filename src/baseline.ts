/**
 * Deterministic baseline (WP4).
 *
 * Consumes a versioned evidence packet and the frozen criterion policy only.
 * Never reads sealed truth artifacts, anonymization map or salt, scorer
 * internals, or another candidate's state. Never calls a model or external
 * service.
 *
 * The frozen policy (src/baseline-policy.ts) is the sole authority for what
 * evidence is required and sufficient per criterion. Individual packets must
 * not override it. The baseline validates the packet against the frozen policy
 * before scoring and rejects malformed or incomplete packets rather than
 * silently treating them as complete.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidencePacket } from "./evidence.ts";
import {
  BASELINE_POLICY_VERSION,
  CRITERIA,
  FROZEN_CRITERION_CHECKS,
  checkDefinitionDigest,
  POLICY_ID,
  type CriterionId,
  type ObservationStatus,
  type EvidenceApplicability,
  type EvidenceFreshness,
} from "./baseline-policy.ts";
import { verifyItemSourceDigest } from "./evidence.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_DIR = path.join(ROOT, "baseline");

export type BaselineOutcome = "satisfied" | "violated" | "unresolved";

export interface BaselineError {
  code: string;
  message: string;
  detail?: unknown;
}

export interface BaselineCriterionResult {
  criterionId: string;
  outcome: BaselineOutcome;
  rationale: string;
  evidenceRefs: string[];
  errors?: BaselineError[];
}

export interface BaselineResult {
  baselineId: string;
  version: string;
  policyId: string;
  policyVersion: string;
  candidateAnonId: string;
  candidateSnapshotDigest: string;
  outcomes: BaselineCriterionResult[];
  rejected: boolean;
  rejectionErrors?: BaselineError[];
}

export interface RunBaselineOptions {
  packet: EvidencePacket;
  rejectMalformed?: boolean;
}

const SUPPORTED_OBSERVATIONS: ObservationStatus[] = ["pass", "fail", "unavailable"];
const SUPPORTED_APPLICABILITY: EvidenceApplicability[] = ["applicable", "inapplicable"];
const SUPPORTED_FRESHNESS: EvidenceFreshness[] = ["fresh", "stale"];

function reject(code: string, message: string, detail?: unknown): BaselineError {
  return { code, message, detail };
}

function validatePacket(packet: EvidencePacket): BaselineError[] {
  const errors: BaselineError[] = [];

  if (packet.schemaVersion !== "evidence-v1") {
    errors.push(reject("bad-schema-version", `unsupported schemaVersion ${packet.schemaVersion}`));
  }
  if (packet.version !== "v1") {
    errors.push(reject("bad-packet-version", `unsupported packet version ${packet.version}`));
  }
  if (packet.checkDefinitionDigest !== checkDefinitionDigest()) {
    errors.push(
      reject(
        "bad-check-definition-digest",
        "packet checkDefinitionDigest does not match frozen policy digest",
        { expected: checkDefinitionDigest(), actual: packet.checkDefinitionDigest },
      ),
    );
  }
  if (typeof packet.candidateAnonId !== "string" || packet.candidateAnonId.length === 0) {
    errors.push(reject("bad-candidate-anon-id", "missing candidateAnonId"));
  }
  if (typeof packet.candidateSnapshotDigest !== "string" || packet.candidateSnapshotDigest.length === 0) {
    errors.push(reject("bad-candidate-snapshot-digest", "missing candidateSnapshotDigest"));
  }

  // Every required criterion must be declared exactly once.
  const declared = Object.keys(packet.criterionChecks ?? {});
  for (const cr of CRITERIA) {
    if (!(cr in (packet.criterionChecks ?? {}))) {
      errors.push(reject("missing-criterion-checks", `missing criterion checks for ${cr}`));
    }
  }
  for (const cr of declared) {
    if (!CRITERIA.includes(cr as CriterionId)) {
      errors.push(reject("unknown-criterion", `unknown criterion in criterionChecks: ${cr}`));
    }
  }

  // Evidence IDs: no duplicates, all belong to this packet's candidate, map to
  // their declared criterion, and correspond exactly to actual Evidence IDs.
  const seenIds = new Set<string>();
  const actualIds = new Set<string>();
  const criterionToEvidenceIds = new Map<string, Set<string>>();
  for (const e of packet.evidence) {
    actualIds.add(e.evidenceId);
    if (seenIds.has(e.evidenceId)) {
      errors.push(reject("duplicate-evidence-id", `duplicate evidenceId: ${e.evidenceId}`));
    }
    seenIds.add(e.evidenceId);
    if (e.candidateAnonId !== packet.candidateAnonId) {
      errors.push(
        reject(
          "cross-candidate-evidence",
          `evidence ${e.evidenceId} references candidate ${e.candidateAnonId} but packet is ${packet.candidateAnonId}`,
        ),
      );
    }
    if (!CRITERIA.includes(e.criterionId as CriterionId)) {
      errors.push(reject("unknown-criterion", `evidence ${e.evidenceId} unknown criterion ${e.criterionId}`));
    }
    if (!SUPPORTED_OBSERVATIONS.includes(e.observation as ObservationStatus)) {
      errors.push(
        reject("bad-observation", `evidence ${e.evidenceId} unsupported observation ${e.observation}`),
      );
    }
    if (!SUPPORTED_APPLICABILITY.includes(e.applicability as EvidenceApplicability)) {
      errors.push(
        reject("bad-applicability", `evidence ${e.evidenceId} unsupported applicability ${e.applicability}`),
      );
    }
    if (!SUPPORTED_FRESHNESS.includes(e.freshness as EvidenceFreshness)) {
      errors.push(reject("bad-freshness", `evidence ${e.evidenceId} unsupported freshness ${e.freshness}`));
    }
    if (!verifyItemSourceDigest(e)) {
      errors.push(reject("bad-source-digest", `evidence ${e.evidenceId} sourceDigest mismatch`));
    }
    let ids = criterionToEvidenceIds.get(e.criterionId);
    if (!ids) {
      ids = new Set();
      criterionToEvidenceIds.set(e.criterionId, ids);
    }
    ids.add(e.evidenceId);
  }

  // criterionChecks must correspond exactly to actual Evidence IDs per criterion.
  for (const cr of CRITERIA) {
    const declaredIds = new Set(packet.criterionChecks[cr] ?? []);
    const actualIdsForCr = criterionToEvidenceIds.get(cr) ?? new Set<string>();
    for (const id of declaredIds) {
      if (!actualIds.has(id)) {
        errors.push(reject("unknown-evidence-id", `criterion ${cr} declares unknown evidenceId ${id}`));
      }
    }
    for (const id of actualIdsForCr) {
      if (!declaredIds.has(id)) {
        errors.push(reject("undeclared-evidence-id", `criterion ${cr} has evidence ${id} not in criterionChecks`));
      }
    }
  }

  return errors;
}

function scoreCriterion(cr: CriterionId, packet: EvidencePacket): BaselineCriterionResult {
  const items = packet.evidence.filter((e) => e.criterionId === cr);
  const applicableFresh = items.filter(
    (e) => e.applicability === "applicable" && e.freshness === "fresh",
  );
  const contradictions = applicableFresh.filter((e) => e.observation === "fail");
  const passes = applicableFresh.filter((e) => e.observation === "pass");
  const required = FROZEN_CRITERION_CHECKS[cr] ?? [];
  const requiredCount = required.length;

  let outcome: BaselineOutcome;
  let rationale: string;

  if (contradictions.length > 0) {
    outcome = "violated";
    rationale = `Applicable observed violation(s): ${contradictions
      .map((e) => e.evidenceId)
      .join(", ")}.`;
  } else if (
    applicableFresh.length > 0 &&
    passes.length === applicableFresh.length &&
    applicableFresh.length >= requiredCount
  ) {
    outcome = "satisfied";
    rationale = `All required applicable fresh observations pass: ${passes
      .map((e) => e.evidenceId)
      .join(", ")}.`;
  } else {
    const unavailable = items.filter(
      (e) =>
        e.observation === "unavailable" || e.freshness === "stale" || e.applicability === "inapplicable",
    );
    rationale = `Insufficient/unavailable/stale/inapplicable evidence; required=${requiredCount}, passes=${passes.length}, contradictions=${contradictions.length}, unavailable=${unavailable.length}.`;
    outcome = "unresolved";
  }

  return {
    criterionId: cr,
    outcome,
    rationale,
    evidenceRefs: items.map((e) => e.evidenceId),
  };
}

export function runBaseline(options: RunBaselineOptions): BaselineResult {
  const { packet, rejectMalformed = true } = options;
  const validationErrors = validatePacket(packet);

  if (validationErrors.length > 0) {
    if (rejectMalformed) {
      return {
        baselineId: "baseline-v1",
        version: "v1",
        policyId: POLICY_ID,
        policyVersion: BASELINE_POLICY_VERSION,
        candidateAnonId: packet.candidateAnonId ?? "",
        candidateSnapshotDigest: packet.candidateSnapshotDigest ?? "",
        outcomes: [],
        rejected: true,
        rejectionErrors: validationErrors,
      };
    }
    // Non-rejecting mode: still score what can be scored, marking unresolved.
  }

  const outcomes = CRITERIA.map((cr) => scoreCriterion(cr, packet));
  return {
    baselineId: "baseline-v1",
    version: "v1",
    policyId: POLICY_ID,
    policyVersion: BASELINE_POLICY_VERSION,
    candidateAnonId: packet.candidateAnonId,
    candidateSnapshotDigest: packet.candidateSnapshotDigest,
    outcomes,
    rejected: false,
  };
}

export function runAllBaselines(evidenceDir?: string): BaselineResult[] {
  const dir = evidenceDir ?? path.join(ROOT, "evidence-v1");
  const results: BaselineResult[] = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith("S1-FIX-"));
  for (const f of files.sort()) {
    const packet = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as EvidencePacket;
    results.push(runBaseline({ packet, rejectMalformed: true }));
  }
  return results;
}
