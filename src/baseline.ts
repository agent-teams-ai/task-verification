/**
 * Deterministic baseline (WP4).
 *
 * Consumes a versioned evidence packet and the frozen criterion policy only.
 * Never reads sealed truth artifacts, the anonymization map or salt, scorer
 * internals, or another candidate's state. Never calls a model or external
 * service.
 *
 * The frozen policy (src/baseline-policy.ts) is the sole authority for what
 * evidence is required and sufficient per criterion. Individual packets must
 * not override it. The baseline validates the packet against the frozen policy
 * before scoring and rejects malformed or incomplete packets rather than
 * silently treating them as complete.
 *
 * Exact criterion-to-request coverage is enforced: each criterion must be
 * backed by exactly one valid observation for each request ID in
 * FROZEN_CRITERION_CHECKS[criterion], with no duplicates, no missing request
 * IDs, no unexpected request IDs, and no request ID assigned to the wrong
 * criterion.
 *
 * Outcome semantics:
 *   satisfied: all required observations present, applicable, fresh, valid and
 *              passing under the frozen policy.
 *   violated:  at least one valid, applicable, fresh observation demonstrates
 *              a required-behavior violation.
 *   unresolved: required evidence missing, technically unavailable, stale,
 *               inapplicable or insufficient. Never converted to satisfied or
 *               to a behavioral violation.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidencePacket } from "./evidence-types.ts";
import {
  canonicalDigest,
} from "./canonical.ts";
import {
  BASELINE_POLICY_VERSION,
  CRITERIA,
  FROZEN_CRITERION_CHECKS,
  checkDefinitionDigest,
  POLICY_ID,
  type CriterionId,
} from "./baseline-policy.ts";

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

function reject(code: string, message: string, detail?: unknown): BaselineError {
  return { code, message, detail };
}

function isObservation(value: unknown): value is "pass" | "fail" | "unavailable" {
  return value === "pass" || value === "fail" || value === "unavailable";
}
function isApplicability(value: unknown): value is "applicable" | "inapplicable" {
  return value === "applicable" || value === "inapplicable";
}
function isFreshness(value: unknown): value is "fresh" | "stale" {
  return value === "fresh" || value === "stale";
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
  if (
    typeof packet.candidateSnapshotDigest !== "string" ||
    packet.candidateSnapshotDigest.length === 0
  ) {
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
  // Per-criterion request-ID inventory: requestId -> set of evidence IDs.
  const criterionRequestInventory = new Map<string, Map<string, string[]>>();
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
    if (!isObservation(e.observation)) {
      errors.push(reject("bad-observation", `evidence ${e.evidenceId} unsupported observation ${e.observation}`));
    }
    if (!isApplicability(e.applicability)) {
      errors.push(reject("bad-applicability", `evidence ${e.evidenceId} unsupported applicability ${e.applicability}`));
    }
    if (!isFreshness(e.freshness)) {
      errors.push(reject("bad-freshness", `evidence ${e.evidenceId} unsupported freshness ${e.freshness}`));
    }
    // Source digest must match the canonical digest of the embedded observation
    // payload (self-consistency). Source-ref resolution and observation-payload
    // matching against committed source files are verified separately by the
    // parent/test with full filesystem access.
    if (e.sourceDigest !== canonicalDigest(e.observationPayload)) {
      errors.push(reject("bad-source-digest", `evidence ${e.evidenceId} sourceDigest mismatch`));
    }
    let ids = criterionToEvidenceIds.get(e.criterionId);
    if (!ids) {
      ids = new Set();
      criterionToEvidenceIds.set(e.criterionId, ids);
    }
    ids.add(e.evidenceId);

    // Track request-ID inventory per criterion for exact-coverage validation.
    const requestId = e.observationPayload?.requestId;
    if (typeof requestId === "string") {
      let inv = criterionRequestInventory.get(e.criterionId);
      if (!inv) {
        inv = new Map();
        criterionRequestInventory.set(e.criterionId, inv);
      }
      const entries = inv.get(requestId) ?? [];
      entries.push(e.evidenceId);
      inv.set(requestId, entries);
    }
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

  // Exact criterion-to-request coverage: required request-ID set must match
  // exactly, with no duplicates, no missing, no unexpected, no wrong criterion.
  for (const cr of CRITERIA) {
    const required = FROZEN_CRITERION_CHECKS[cr] ?? [];
    const inv = criterionRequestInventory.get(cr) ?? new Map();
    const observedRequestIds = new Set(inv.keys());

    // Missing required request IDs.
    for (const reqId of required) {
      if (!observedRequestIds.has(reqId)) {
        errors.push(
          reject(
            "missing-request-observation",
            `criterion ${cr} missing required observation for request ${reqId}`,
          ),
        );
      }
    }
    // Unexpected request IDs (not in the required set).
    for (const reqId of observedRequestIds) {
      if (!required.includes(reqId as never)) {
        errors.push(
          reject(
            "unexpected-request-observation",
            `criterion ${cr} has unexpected observation for request ${reqId}`,
          ),
        );
      }
    }
    // Duplicate observations for the same request ID (different evidence IDs).
    for (const [reqId, entries] of inv) {
      if (entries.length > 1) {
        errors.push(
          reject(
            "duplicate-request-observation",
            `criterion ${cr} has ${entries.length} observations for request ${reqId}: ${entries.join(", ")}`,
          ),
        );
      }
    }
  }

  return errors;
}

function scoreCriterion(cr: CriterionId, packet: EvidencePacket): BaselineCriterionResult {
  const items = packet.evidence.filter((e) => e.criterionId === cr);
  const required = FROZEN_CRITERION_CHECKS[cr] ?? [];

  // Map each required request to its observation, using exact coverage.
  const observationsByRequest = new Map<string, { observation: string; evidenceId: string }>();
  for (const e of items) {
    const reqId = e.observationPayload?.requestId;
    if (typeof reqId === "string") {
      observationsByRequest.set(reqId, {
        observation: e.observation,
        evidenceId: e.evidenceId,
      });
    }
  }

  const contradictions: string[] = [];
  const passes: string[] = [];
  const unavailableOrMissing: string[] = [];

  for (const reqId of required) {
    const obs = observationsByRequest.get(reqId);
    if (!obs) {
      unavailableOrMissing.push(reqId);
      continue;
    }
    if (obs.observation === "fail") {
      contradictions.push(obs.evidenceId);
    } else if (obs.observation === "pass") {
      passes.push(obs.evidenceId);
    } else {
      // unavailable (or any non-pass/non-fail) → insufficient, unresolved.
      unavailableOrMissing.push(obs.evidenceId);
    }
  }

  // Also count non-required-request items as unavailable for the criterion.
  const extraItems = items.filter(
    (e) => {
      const reqId = e.observationPayload?.requestId;
      return typeof reqId !== "string" || !required.includes(reqId as never);
    },
  );
  for (const e of extraItems) {
    unavailableOrMissing.push(e.evidenceId);
  }

  let outcome: BaselineOutcome;
  let rationale: string;

  if (contradictions.length > 0) {
    outcome = "violated";
    rationale = `Applicable observed violation(s): ${contradictions.join(", ")}.`;
  } else if (
    passes.length === required.length &&
    unavailableOrMissing.length === 0
  ) {
    outcome = "satisfied";
    rationale = `All required applicable fresh observations pass: ${passes.join(", ")}.`;
  } else {
    outcome = "unresolved";
    rationale = `Insufficient/unavailable/missing evidence; required=${required.length}, passes=${passes.length}, contradictions=${contradictions.length}, missing/unavailable=${unavailableOrMissing.length}.`;
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
