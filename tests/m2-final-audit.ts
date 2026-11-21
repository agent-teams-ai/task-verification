/**
 * M2 final acceptance audit (model-free, cross-platform).
 *
 * Two semantic boundaries that the corrective pass left open:
 *
 *   1. Profile B per-claim admission. The original reported claim, schema
 *      validity, execution admissibility, criteria-content validity, evidence
 *      resolution, candidate/snapshot binding, claim-specific support and
 *      consumer admission are separate dimensions. A claim is never exposed as
 *      `consumerAdmitted` when a mandatory gate fails, and the original claim
 *      and its diagnostics survive every rejection.
 *
 *   2. Profile A same-criterion/same-reference finding isolation. Two findings
 *      that share a mapped criterion and an evidence reference must not share
 *      one support judgment. Ambiguous duplicate mappings are refused for
 *      individual admission while both findings stay in accounting.
 *
 * Truth outcomes are never changed to make these pass.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";

import {
  buildResultContract,
  computeCoverage,
  type AssessmentRecord,
  type FindingRecord,
} from "../src/result-contract.ts";
import {
  claimSupportKey,
  scoreResult,
  type ArtifactRegistry,
  type RubricDecision,
  type TruthBinding,
} from "../src/scorer.ts";
import { artifactReference, buildArtifactRegistry, verifyArtifactRegistry } from "../src/artifact-registry.ts";
import { admitProfileAFindings } from "../src/profile-a-admission.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");
const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;
const CANDIDATE = "S1-FIX-audit";
const SNAPSHOT = H("audit-snapshot");
const APP = artifactReference("app.ts");

const SUPPORTING: RubricDecision = {
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

const TRUTH: Record<string, boolean> = {
  "AC-1": true,
  "AC-2": false,
  "AC-3": false,
  "AC-4": true,
  "AC-5": true,
};

function files(): { path: string; content: string }[] {
  return [
    { path: "app.ts", content: "export const profile = () => ({ id: 1 });\n" },
    { path: "serializer.ts", content: "export const s = () => ({ role: 'reviewer' });\n" },
  ];
}

function registryFor(options: { candidate?: string; snapshot?: string } = {}): ArtifactRegistry {
  return buildArtifactRegistry({
    binding: {
      candidateBinding: options.candidate ?? CANDIDATE,
      snapshotDigest: options.snapshot ?? SNAPSHOT,
    },
    files: files(),
    allowedPaths: files().map((f) => f.path),
  }).registry;
}

function contract(params: {
  assessments?: AssessmentRecord[];
  findings?: FindingRecord[];
  applicability?: "applicable" | "not_applicable" | "stale";
  criteriaTextDigest?: string;
}) {
  const assessments = params.assessments ?? [];
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-audit", expectedSubjectInventory: [...CRITERIA] },
    candidate: {
      repositoryMaterializationId: CANDIDATE,
      baseTreeIdentity: H("base"),
      headTreeIdentity: H("head"),
      runtimeSnapshotDigest: SNAPSHOT,
      opaqueFixtureId: CANDIDATE,
    },
    criteria: {
      authoredCriteriaRevision: "crit-v1",
      criteriaTextDigest: params.criteriaTextDigest ?? H("criteria"),
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: H("policy"),
    },
    profile: {
      profileId: "profile-b",
      configurationIdentity: "cfg",
      promptIdentity: "prompt",
      inputIdentity: "input",
      requestedModel: null,
      observedModel: null,
      reasoningConfiguration: {},
      adapterEntryIdentity: "adapter",
    },
    assessments,
    findings: params.findings ?? [],
    coverage: computeCoverage([...CRITERIA], assessments.map((a) => a.expectedCriterionId)),
    execution: {
      state: "completed",
      slotId: "slot-1",
      runId: "run-1",
      attemptId: "attempt-1",
      requestId: "req-1",
      sdkEffectCode: null,
      diagnostics: [],
      pendingEffects: [],
      cleanupStatus: "clean",
    },
    rawArtifact: {
      available: true,
      rawText: "{}",
      rawBytesDigest: H("{}"),
      rawUnavailableCause: null,
    },
    evidence: {
      producer: "oracle-O-1",
      candidateBinding: CANDIDATE,
      checkDefinition: H("check"),
      inputScope: "app.ts",
      environment: "node-test",
      observationOutcome: "complete",
      completeness: "complete",
      timestamps: ["2026-01-01T00:00:00Z"],
      references: [],
      applicability: params.applicability ?? "applicable",
      provenance: "fixture",
    },
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      cost: null,
      currency: null,
      requestedModel: null,
      observedModel: null,
      capacityObservations: [],
    },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  return rc;
}

function truthBinding(rc: ReturnType<typeof contract>): TruthBinding {
  return {
    canonicalCandidateId: CANDIDATE,
    anonymizedCandidateId: CANDIDATE,
    headApplicationDigest: SNAPSHOT,
    criteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriterionInventory: [...CRITERIA],
    truthVersion: "truth-v1",
    truthDigest: H("truth"),
    truthOutcomes: { ...TRUTH },
  };
}

function assessment(
  overrides: Partial<AssessmentRecord> & { expectedCriterionId: string },
): AssessmentRecord {
  return {
    present: true,
    originalReportedClaim: "satisfied",
    admittedConclusion: "satisfied",
    references: [APP],
    explanation: "because the route exists",
    diagnostics: [],
    ...overrides,
  };
}

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    findingId: "f-1",
    nativeComment: "AC-3: the profile route is missing.",
    normalizedFinding: "AC-3: the profile route is missing.",
    skipped: false,
    skipReason: null,
    qualityFlags: [],
    criterionMapping: "AC-3",
    references: [APP],
    ...overrides,
  };
}

function runB(params: {
  assessments: AssessmentRecord[];
  registry?: ArtifactRegistry;
  rubrics?: Record<string, RubricDecision>;
  applicability?: "applicable" | "not_applicable" | "stale";
  expectedCriteriaContentDigest?: string;
}) {
  const rc = contract({ assessments: params.assessments, applicability: params.applicability });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: params.rubrics ?? {},
    artifactRegistry: params.registry ?? registryFor(),
    expectedCriteriaContentDigest: params.expectedCriteriaContentDigest,
  });
  return { rc, scorer, claim: scorer.claimAdmissions[0], entry: scorer.reportedClaims.entries[0] };
}

function allClaimRubrics(): Record<string, RubricDecision> {
  const out: Record<string, RubricDecision> = {};
  for (const id of CRITERIA) out[claimSupportKey(id, APP)] = { ...SUPPORTING, criterionId: id };
  return out;
}

// --- 1. Profile B: no reference -------------------------------------------

test("M2 audit B: a satisfied conclusion with no reference is not consumer-admitted", () => {
  const { claim, entry, scorer } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3", references: [] })],
    rubrics: allClaimRubrics(),
  });
  assert.equal(claim.originalReportedClaim, "satisfied", "the original claim is retained");
  assert.equal(claim.parsedClaim, "satisfied", "reported-claim accounting is accurate");
  assert.equal(claim.referenceValid, false, "a claim with no reference has no valid evidence");
  assert.equal(claim.referenceSufficient, false, "a bare verdict is never sufficient");
  assert.equal(claim.semanticConclusionAdmitted, true, "the conclusion itself is admissible");
  assert.equal(claim.consumerAdmitted, false, "consumer admission requires evidence");
  assert.match(claim.reason, /no reference/);
  assert.ok(claim.diagnostics.some((d) => d.includes("cites no reference")), "diagnostics retained");
  assert.equal(entry.accounted, true);
  assert.equal(entry.consumerAdmitted, false);
  assert.equal(scorer.admission.admitted, false);
});

// --- 2. Profile B: missing artifact ---------------------------------------

test("M2 audit B: a claim citing an unresolvable artifact is not consumer-admitted", () => {
  const missing = artifactReference("missing.ts");
  const { claim, entry } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3", references: [missing] })],
    rubrics: { [claimSupportKey("AC-3", missing)]: { ...SUPPORTING, criterionId: "AC-3" } },
  });
  assert.equal(claim.originalReportedClaim, "satisfied");
  assert.equal(claim.referenceValid, false);
  assert.equal(claim.referenceSufficient, false);
  assert.equal(claim.consumerAdmitted, false);
  assert.ok(claim.diagnostics.some((d) => d.includes("not in artifact registry")));
  assert.equal(entry.accounted, true);
  assert.equal(entry.consumerAdmitted, false);
});

// --- 3. Profile B: invalid artifact digest ---------------------------------

test("M2 audit B: an artifact whose digest does not match its bytes never supports a claim", () => {
  const built = buildArtifactRegistry({
    binding: { candidateBinding: CANDIDATE, snapshotDigest: SNAPSHOT },
    files: files(),
    allowedPaths: files().map((f) => f.path),
  });
  // Tamper with the recorded digest: the bytes on disk no longer match it.
  const tampered: ArtifactRegistry = JSON.parse(JSON.stringify(built.registry));
  tampered.artifacts[APP].digest = H("not the app bytes");

  const verification = verifyArtifactRegistry({
    registry: tampered,
    files: files(),
    allowedPaths: files().map((f) => f.path),
    binding: { candidateBinding: CANDIDATE, snapshotDigest: SNAPSHOT },
  });
  assert.equal(verification.ok, false, "digest mismatch must fail verification");
  assert.ok(
    verification.rejected.some((r) => r.reference === APP && /digest/i.test(r.reason)),
    `expected a digest rejection, got ${JSON.stringify(verification.rejected)}`,
  );

  // Once the unverified artifact is excluded, the claim cannot be admitted.
  const verifiedRegistry: ArtifactRegistry = { artifacts: {} };
  const { claim } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    registry: verifiedRegistry,
    rubrics: allClaimRubrics(),
  });
  assert.equal(claim.referenceValid, false);
  assert.equal(claim.consumerAdmitted, false);
  assert.equal(claim.originalReportedClaim, "satisfied");
});

// --- 4. Profile B: wrong candidate binding ---------------------------------

test("M2 audit B: a claim citing another candidate's artifact is not consumer-admitted", () => {
  const { claim } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    registry: registryFor({ candidate: "S1-OTHER" }),
    rubrics: allClaimRubrics(),
  });
  assert.equal(claim.candidateBound, false);
  assert.equal(claim.snapshotBound, true);
  assert.equal(claim.referenceValid, false);
  assert.equal(claim.consumerAdmitted, false);
  assert.match(claim.reason, /candidate binding/);
  assert.equal(claim.originalReportedClaim, "satisfied", "the claim is preserved, not erased");
});

// --- 5. Profile B: wrong snapshot binding ----------------------------------

test("M2 audit B: a claim citing another snapshot's artifact is not consumer-admitted", () => {
  const { claim } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    registry: registryFor({ snapshot: H("other-snapshot") }),
    rubrics: allClaimRubrics(),
  });
  assert.equal(claim.candidateBound, true);
  assert.equal(claim.snapshotBound, false);
  assert.equal(claim.consumerAdmitted, false);
  assert.match(claim.reason, /snapshot binding/);
});

// --- 6. Profile B: stale criteria content ----------------------------------

test("M2 audit B: an unchanged revision label with changed criteria content rejects the claim", () => {
  const { claim, scorer } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    rubrics: allClaimRubrics(),
    expectedCriteriaContentDigest: H("edited criteria"),
  });
  assert.equal(claim.criteriaRevisionBound, true, "the label still matches");
  assert.equal(claim.criteriaContentBound, false, "the content does not");
  assert.equal(claim.consumerAdmitted, false);
  assert.match(claim.reason, /criteria content/);
  assert.equal(scorer.admission.admitted, false);
  assert.equal(claim.originalReportedClaim, "satisfied");
});

// --- 7. Profile B: inapplicable evidence -----------------------------------

test("M2 audit B: inapplicable evidence rejects every claim even with a perfect reference", () => {
  const { claim } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    rubrics: allClaimRubrics(),
    applicability: "stale",
  });
  assert.equal(claim.evidenceApplicable, false);
  assert.equal(claim.referenceValid, true, "the reference itself still resolves");
  assert.equal(claim.referenceSufficient, true);
  assert.equal(claim.consumerAdmitted, false);
  assert.match(claim.reason, /evidence not applicable/);
});

// --- 8. Profile B: unsupported and contradictory claims --------------------

test("M2 audit B: a claim with no support decision is valid mechanically but not sufficient", () => {
  const { claim } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    rubrics: {},
  });
  assert.equal(claim.referenceValid, true);
  assert.equal(claim.referenceSufficient, false);
  assert.equal(claim.consumerAdmitted, false);
  assert.match(claim.reason, /insufficient reference support/);
  assert.ok(claim.diagnostics.some((d) => d.includes("no semantic support decision")));
});

test("M2 audit B: a contradicting support decision never admits the claim", () => {
  const { claim } = runB({
    assessments: [assessment({ expectedCriterionId: "AC-3" })],
    rubrics: {
      [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3", contradictsClaim: true },
    },
  });
  assert.equal(claim.referenceValid, true);
  assert.equal(claim.referenceSufficient, false);
  assert.equal(claim.consumerAdmitted, false);
});

// --- 9. Profile B: duplicate / invalid criterion association ---------------

test("M2 audit B: a criterion claimed twice is reported, not merged, and not admitted", () => {
  const { scorer } = runB({
    assessments: [
      assessment({ expectedCriterionId: "AC-3" }),
      assessment({ expectedCriterionId: "AC-3", references: [artifactReference("serializer.ts")] }),
    ],
    rubrics: allClaimRubrics(),
  });
  assert.equal(scorer.claimAdmissions.length, 2, "both claims are retained");
  for (const claim of scorer.claimAdmissions) {
    assert.equal(claim.claimAssociationValid, false, "duplicate association is invalid");
    assert.equal(claim.consumerAdmitted, false);
    assert.equal(claim.originalReportedClaim, "satisfied");
    assert.ok(claim.diagnostics.some((d) => d.includes("claim association")));
  }
  assert.ok(scorer.coverage.duplicateIds.includes("AC-3"));
  assert.equal(scorer.admission.admitted, false);
});

// --- Profile A: same criterion + same reference ----------------------------

function runA(params: {
  findings: FindingRecord[];
  rubrics: Record<string, RubricDecision>;
  registry?: ArtifactRegistry;
  expectedCandidate?: string;
  expectedSnapshot?: string;
  expectedCriteriaContentDigest?: string;
}) {
  const rc = contract({ findings: params.findings });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: params.rubrics,
    artifactRegistry: params.registry ?? registryFor(),
  });
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer,
    registry: params.registry ?? registryFor(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: params.expectedCandidate ?? CANDIDATE,
    expectedSnapshotDigest: params.expectedSnapshot ?? SNAPSHOT,
    expectedCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: params.expectedCriteriaContentDigest ?? rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  return { rc, scorer, decision };
}

test("M2 audit A: one supported finding does not support another sharing criterion and reference", () => {
  const shared = {
    criterionMapping: "AC-3",
    references: [APP],
  };
  const { scorer, decision } = runA({
    findings: [
      finding({ findingId: "f-supported", ...shared }),
      finding({ findingId: "f-other", ...shared, nativeComment: "AC-3: nothing is validated here." }),
    ],
    // A decision bound to ONE finding, not a claim-level judgment for the pair.
    rubrics: {
      [claimSupportKey("AC-3", APP, "f-supported")]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-supported" },
    },
  });

  const supported = scorer.profileA.findings.find((f) => f.findingId === "f-supported")!;
  const other = scorer.profileA.findings.find((f) => f.findingId === "f-other")!;
  assert.equal(supported.semanticSupport, "supported", "the finding-scoped decision applies to its finding");
  assert.equal(other.semanticSupport, "unsupported", "the neighbouring finding inherits nothing");
  assert.equal(other.supportAmbiguous, true, "the shared pair is reported as ambiguous");
  assert.ok(
    other.diagnostics.some((d) => d.includes("ambiguous")),
    "the ambiguity is diagnosed, not hidden",
  );

  // Neither finding may be individually admitted: the criterion mapping is
  // duplicated, so admission refuses rather than picking one.
  const dSupported = decision.findings.find((f) => f.findingId === "f-supported")!;
  const dOther = decision.findings.find((f) => f.findingId === "f-other")!;
  assert.equal(dOther.admitted, false);
  assert.equal(dSupported.admitted, false, "a duplicate mapping is not silently attributed");
  assert.equal(dOther.semanticSupported, false);
  assert.deepEqual(decision.supportedDetections, [], "no supported detection from an ambiguous pair");
  assert.equal(dSupported.duplicateMapping, true);
  assert.match(dOther.reason, /duplicate|ambiguous/);
});

test("M2 audit A: duplicate findings are explicitly accounted for and both preserved", () => {
  const shared = { criterionMapping: "AC-3", references: [APP] };
  const { rc, decision, scorer } = runA({
    findings: [
      finding({ findingId: "f-a", ...shared }),
      finding({ findingId: "f-b", ...shared }),
    ],
    // Each finding carries its own support decision, so ambiguity is about the
    // mapping, not the support judgment.
    rubrics: {
      [claimSupportKey("AC-3", APP, "f-a")]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-a" },
      [claimSupportKey("AC-3", APP, "f-b")]: { ...SUPPORTING, criterionId: "AC-3", findingId: "f-b" },
    },
  });
  assert.equal(scorer.profileA.summary.duplicateMappings, 2);
  assert.equal(decision.findings.length, rc.findings.length, "every finding keeps a decision");
  assert.equal(decision.findings.every((f) => f.duplicateMapping), true);
  assert.equal(decision.admittedFindings, 0, "an ambiguous duplicate mapping is not admitted");
  assert.equal(decision.rejectedFindings, 2);
  for (const f of decision.findings) {
    assert.ok(f.findingId.length > 0);
    assert.ok(f.reason.length > 0);
  }
});

test("M2 audit A: a stale criteria content digest rejects individual findings", () => {
  const { decision } = runA({
    findings: [finding({ findingId: "f-stale" })],
    rubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    expectedCriteriaContentDigest: H("edited criteria"),
  });
  assert.equal(decision.admitted, false);
  assert.equal(decision.findings[0].criteriaContentBound, false);
  assert.equal(decision.findings[0].admitted, false);
  assert.match(decision.findings[0].reason, /criteria content/);
});

test("M2 audit A: wrong candidate and wrong snapshot bindings reject individual findings", () => {
  const { decision: wrongCandidate } = runA({
    findings: [finding({ findingId: "f-cand" })],
    rubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    expectedCandidate: "S1-OTHER",
  });
  assert.equal(wrongCandidate.findings[0].candidateBound, false);
  assert.equal(wrongCandidate.findings[0].admitted, false);

  const { decision: wrongSnapshot } = runA({
    findings: [finding({ findingId: "f-snap" })],
    rubrics: { [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" } },
    expectedSnapshot: H("other-snapshot"),
  });
  assert.equal(wrongSnapshot.findings[0].snapshotBound, false);
  assert.equal(wrongSnapshot.findings[0].admitted, false);
});

test("M2 audit A: rejected findings remain in original accounting", () => {
  const findings = [
    finding({ findingId: "f-mapped", references: [artifactReference("missing.ts")] }),
    finding({ findingId: "f-skipped", skipped: true, skipReason: "normalizer dropped it", references: [] }),
  ];
  const { rc, decision, scorer } = runA({
    findings,
    rubrics: {},
    expectedCriteriaContentDigest: H("edited criteria"),
  });
  assert.equal(decision.findings.length, rc.findings.length);
  assert.equal(scorer.profileA.summary.skipped, 1, "the skipped finding is still counted");
  assert.equal(scorer.profileA.summary.delivered, 1);
  const skipped = decision.findings.find((f) => f.findingId === "f-skipped")!;
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.admitted, false);
  const mapped = decision.findings.find((f) => f.findingId === "f-mapped")!;
  assert.equal(mapped.admitted, false);
  assert.equal(mapped.referenceValid, false);
  assert.ok(mapped.reason.length > 0, "the rejection carries a reason");
  assert.equal(decision.admittedFindings, 0);
});
