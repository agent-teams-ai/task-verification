/**
 * One authoritative admission-gate policy (M2 targeted corrective pass).
 *
 * Before this module, Profile A proof-of-admission, Profile B per-claim
 * admission and the aggregate result decision each carried their own list of
 * mandatory booleans. The same documented gate could therefore be evaluated
 * from different observations in different paths — for example the aggregate
 * compared criteria against the contract's own revision label while every
 * claim compared against the consumer's independently captured one.
 *
 * This module defines the gate identities, their scope, and the single
 * pass/fail derivation. Every decision (per-finding, per-claim, aggregate)
 * evaluates the same gate definitions and reports the structured outcome, so a
 * gate cannot be silently omitted from one path and enforced in another:
 *
 *   - `evaluateRunGates` covers the gates that apply to the whole result
 *     (contract schema, execution admissibility, evidence applicability,
 *     criteria revision, criteria content, candidate and snapshot binding).
 *   - claim/finding gates (association, reference validity, reference
 *     sufficiency, semantic conclusion, conflict status, occurrence identity)
 *     are constructed with `gate(...)` so they carry the same identity,
 *     applicability, source and reason shape.
 *   - `decide` is the only place that turns gate outcomes into an admission.
 *
 * A gate is only skipped when it is genuinely not applicable to the decision
 * (for example a content digest the caller did not supply). "Not applicable"
 * is recorded explicitly, never inferred from a missing boolean.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

export const ADMISSION_GATE_POLICY = "m2-admission-gate-policy-v1";

export type AdmissionGateId =
  | "contract-schema"
  | "execution-state"
  | "evidence-applicability"
  | "criteria-revision"
  | "criteria-content-digest"
  | "candidate-binding"
  | "snapshot-binding"
  | "occurrence-identity"
  | "claim-association"
  | "reference-validity"
  | "reference-sufficiency"
  | "evidence-conflict"
  | "semantic-conclusion"
  | "conflict-status"
  | "coverage-completeness"
  | "assessment-admitted"
  | "claim-admission"
  | "admitted-ids";

export type GateScope = "run" | "claim" | "aggregate";

export type GateStatus = "pass" | "fail" | "not-applicable";

export interface GateResult {
  /** Stable gate identity; the same id means the same mandatory gate. */
  id: AdmissionGateId;
  scope: GateScope;
  /** False only when the decision genuinely does not depend on this gate. */
  applicable: boolean;
  status: GateStatus;
  /** The observation the decision was derived from (never a caller boolean). */
  source: string;
  /** Failure reason, or the passing observation. */
  reason: string;
}

export interface GateFailure {
  id: AdmissionGateId;
  reason: string;
  source: string;
}

export interface AdmissionOutcome {
  admitted: boolean;
  gates: GateResult[];
  failures: GateFailure[];
  /** First failure in gate order, or the admitting observation. */
  reason: string;
  /** Identity of the first failing gate, when rejected. */
  primaryFailureGate: AdmissionGateId | null;
}

/** Construct one gate outcome. Pass `status` explicitly; never infer it. */
export function gate(params: {
  id: AdmissionGateId;
  scope: GateScope;
  status: GateStatus;
  source: string;
  reason: string;
}): GateResult {
  return {
    id: params.id,
    scope: params.scope,
    applicable: params.status !== "not-applicable",
    status: params.status,
    source: params.source,
    reason: params.reason,
  };
}

export function passGate(
  id: AdmissionGateId,
  scope: GateScope,
  source: string,
  reason: string,
): GateResult {
  return gate({ id, scope, status: "pass", source, reason });
}

export function failGate(
  id: AdmissionGateId,
  scope: GateScope,
  source: string,
  reason: string,
): GateResult {
  return gate({ id, scope, status: "fail", source, reason });
}

export function notApplicableGate(
  id: AdmissionGateId,
  scope: GateScope,
  source: string,
  reason: string,
): GateResult {
  return gate({ id, scope, status: "not-applicable", source, reason });
}

export function booleanGate(params: {
  id: AdmissionGateId;
  scope: GateScope;
  passed: boolean;
  source: string;
  passReason: string;
  failReason: string;
}): GateResult {
  return params.passed
    ? passGate(params.id, params.scope, params.source, params.passReason)
    : failGate(params.id, params.scope, params.source, params.failReason);
}

/**
 * The single admission derivation. Every applicable gate must pass; a gate
 * that is not applicable is recorded but does not constrain the decision.
 */
export function decide(gates: readonly GateResult[], admittedReason = "admitted"): AdmissionOutcome {
  const failures: GateFailure[] = gates
    .filter((g) => g.applicable && g.status === "fail")
    .map((g) => ({ id: g.id, reason: g.reason, source: g.source }));
  const admitted = failures.length === 0 && gates.some((g) => g.applicable);
  return {
    admitted,
    gates: [...gates],
    failures,
    reason: admitted ? admittedReason : (failures[0]?.reason ?? "no applicable admission gate"),
    primaryFailureGate: admitted ? null : (failures[0]?.id ?? null),
  };
}

export interface RunGateContext {
  /** Schema validation result of the result contract being scored. */
  contractValid: boolean;
  contractErrors: readonly string[];
  executionState: string;
  supersededBy: string | null;
  executionAdmissible: boolean;
  evidenceApplicability: string;
  authoredCriteriaRevision: string;
  /** The consumer's independently captured revision, never the contract's own. */
  expectedCriteriaRevision: string;
  criteriaTextDigest: string;
  expectedCriteriaContentDigest: string;
  candidateMaterializationId: string;
  /** Null when the caller has no independent candidate expectation at this scope. */
  expectedCandidateBinding: string | null;
  runtimeSnapshotDigest: string;
  /** Null when the caller has no independent snapshot expectation at this scope. */
  expectedSnapshotDigest: string | null;
}

/**
 * Gates that apply to the whole result. Both profiles evaluate these through
 * this one function, so a stale revision or an invalid contract cannot pass in
 * one path while failing in another.
 */
export function evaluateRunGates(ctx: RunGateContext): GateResult[] {
  return [
    booleanGate({
      id: "contract-schema",
      scope: "run",
      passed: ctx.contractValid,
      source: "result-contract.validateResultContract",
      passReason: "result contract is schema-valid",
      failReason: `result contract is not schema-valid: ${ctx.contractErrors.join("; ")}`,
    }),
    booleanGate({
      id: "execution-state",
      scope: "run",
      passed: ctx.executionAdmissible,
      source: "result-contract.execution.state",
      passReason: `execution ${ctx.executionState} is admissible`,
      failReason: `execution not admissible (${ctx.executionState}${ctx.supersededBy ? `, superseded by ${ctx.supersededBy}` : ""})`,
    }),
    booleanGate({
      id: "evidence-applicability",
      scope: "run",
      passed: ctx.evidenceApplicability === "applicable",
      source: "result-contract.evidence.applicability",
      passReason: "evidence is applicable to this review",
      failReason: `evidence not applicable (${ctx.evidenceApplicability})`,
    }),
    booleanGate({
      id: "criteria-revision",
      scope: "run",
      passed: ctx.authoredCriteriaRevision === ctx.expectedCriteriaRevision,
      source: "result-contract.criteria.authoredCriteriaRevision vs consumer revision",
      passReason: "criteria revision label matches the consumer's current revision",
      failReason: `criteria revision mismatch (assessment ${ctx.authoredCriteriaRevision}, current ${ctx.expectedCriteriaRevision})`,
    }),
    booleanGate({
      id: "criteria-content-digest",
      scope: "run",
      passed: ctx.criteriaTextDigest === ctx.expectedCriteriaContentDigest,
      source: "result-contract.criteria.criteriaTextDigest vs captured criteria content",
      passReason: "criteria content digest matches the captured criteria content",
      failReason: "criteria content mismatch (stale criteria)",
    }),
    ctx.expectedCandidateBinding === null
      ? notApplicableGate(
          "candidate-binding",
          "run",
          "result-contract.candidate.repositoryMaterializationId",
          "no independent candidate expectation at result scope; binding is enforced per claim",
        )
      : booleanGate({
          id: "candidate-binding",
          scope: "run",
          passed: ctx.candidateMaterializationId === ctx.expectedCandidateBinding,
          source: "result-contract.candidate.repositoryMaterializationId",
          passReason: "candidate binding matches the expected materialization",
          failReason: `candidate binding mismatch (assessment ${ctx.candidateMaterializationId}, expected ${ctx.expectedCandidateBinding})`,
        }),
    ctx.expectedSnapshotDigest === null
      ? notApplicableGate(
          "snapshot-binding",
          "run",
          "result-contract.candidate.runtimeSnapshotDigest",
          "no independent snapshot expectation at result scope; binding is enforced per claim",
        )
      : booleanGate({
          id: "snapshot-binding",
          scope: "run",
          passed: ctx.runtimeSnapshotDigest === ctx.expectedSnapshotDigest,
          source: "result-contract.candidate.runtimeSnapshotDigest",
          passReason: "runtime snapshot matches the expected snapshot",
          failReason: `snapshot binding mismatch (assessment ${ctx.runtimeSnapshotDigest}, expected ${ctx.expectedSnapshotDigest})`,
        }),
  ];
}

/**
 * Aggregate coverage gate. Complete coverage is the existing contract for a
 * result-level admission; partial output is expressed per claim and never
 * upgrades a rejected claim to admitted.
 */
export function evaluateCoverageGate(params: {
  expectedCriterionIds: readonly string[];
  presentIds: readonly string[];
  duplicateIds: readonly string[];
  unknownIds: readonly string[];
  invalidIds: readonly string[];
}): GateResult {
  const expectedSet = new Set(params.expectedCriterionIds);
  const presentSet = new Set(params.presentIds);
  const reasons: string[] = [];
  if (params.expectedCriterionIds.length === 0) reasons.push("expected criterion inventory is empty");
  const missing = params.expectedCriterionIds.filter((id) => !presentSet.has(id));
  if (missing.length > 0) reasons.push(`missing criteria: ${missing.join(", ")}`);
  if (params.duplicateIds.length > 0) reasons.push(`duplicate criteria: ${params.duplicateIds.join(", ")}`);
  if (params.unknownIds.length > 0) reasons.push(`unknown criteria: ${params.unknownIds.join(", ")}`);
  if (params.invalidIds.length > 0) reasons.push(`invalid criteria: ${params.invalidIds.map(String).join(", ")}`);
  const unknownOutsideInventory = params.presentIds.filter((id) => !expectedSet.has(id));
  if (unknownOutsideInventory.length > 0 && params.unknownIds.length === 0) {
    reasons.push(`criteria outside the inventory: ${unknownOutsideInventory.join(", ")}`);
  }
  if (params.presentIds.length !== new Set(params.presentIds).size && params.duplicateIds.length === 0) {
    reasons.push("reported criteria contain duplicates");
  }
  return reasons.length === 0
    ? passGate("coverage-completeness", "aggregate", "result-contract.coverage", "coverage is complete")
    : failGate("coverage-completeness", "aggregate", "result-contract.coverage", `incomplete coverage (${reasons.join("; ")})`);
}
