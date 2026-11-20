#!/usr/bin/env node
/**
 * Retain the targeted corrective-pass evidence (model-free).
 *
 * Writes `docs/experiments/m2-targeted-corrective-evidence/`:
 *
 *   - the Profile A collision reproduction (inputs, scored occurrences,
 *     admission decisions, supported detections),
 *   - the Profile B conflicting-duplicate reproduction (decoder groups, contract
 *     coverage, per-claim admission, aggregate gates),
 *   - the native tool transcript + captured request chain produced by the
 *     WP8-A suite, when those artifacts are present,
 *   - the PR #349 source/candidate identities and the deterministic
 *     memory-delivery probe result,
 *   - a per-file SHA-256 manifest.
 *
 * It reconstructs the two reproductions from the same public modules the tests
 * use, so the retained JSON is regenerable and not hand-edited.
 *
 * Usage: node --experimental-strip-types scripts/retain-targeted-corrective-evidence.mjs
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "experiments", "m2-targeted-corrective-evidence");
const TMP = path.join(ROOT, ".isolation-tmp");

const mod = async (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { buildResultContract, computeCoverage, validateResultContract } = await mod("src/result-contract.ts");
const { claimSupportKey, scoreResult } = await mod("src/scorer.ts");
const { artifactReference, buildArtifactRegistry } = await mod("src/artifact-registry.ts");
const { admitProfileAFindings } = await mod("src/profile-a-admission.ts");
const { decodeProfileBAssessments } = await mod("src/profile-b-decode.ts");

const H = (s) => crypto.createHash("sha256").update(s).digest("hex");
const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"];
const CANDIDATE = "S1-FIX-audit";
const SNAPSHOT = H("audit-snapshot");
const APP = artifactReference("app.ts");
const SERIALIZER = artifactReference("serializer.ts");
const SUPPORTING = {
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};
const TRUTH = { "AC-1": true, "AC-2": false, "AC-3": false, "AC-4": true, "AC-5": true };

const files = () => [
  { path: "app.ts", content: "export const profile = () => ({ id: 1 });\n" },
  { path: "serializer.ts", content: "export const s = () => ({ role: 'reviewer' });\n" },
];
const registry = () =>
  buildArtifactRegistry({
    binding: { candidateBinding: CANDIDATE, snapshotDigest: SNAPSHOT },
    files: files(),
    allowedPaths: files().map((f) => f.path),
  }).registry;

function contract({ assessments = [], findings = [] }) {
  return buildResultContract({
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
      criteriaTextDigest: H("criteria"),
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
    findings,
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
    rawArtifact: { available: true, rawText: "{}", rawBytesDigest: H("{}"), rawUnavailableCause: null },
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
      applicability: "applicable",
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
}

const truthBinding = (rc) => ({
  canonicalCandidateId: CANDIDATE,
  anonymizedCandidateId: CANDIDATE,
  headApplicationDigest: SNAPSHOT,
  criteriaRevision: rc.criteria.authoredCriteriaRevision,
  expectedCriterionInventory: [...CRITERIA],
  truthVersion: "truth-v1",
  truthDigest: H("truth"),
  truthOutcomes: { ...TRUTH },
});

function finding(overrides = {}) {
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

// --- Profile A collision reproduction --------------------------------------

function profileACollision() {
  const input = {
    findings: [
      finding({
        findingId: "f-1",
        criterionMapping: "AC-1",
        nativeComment: "AC-1: the profile route is missing.",
        normalizedFinding: "AC-1: the profile route is missing.",
      }),
      finding({
        findingId: "f-1",
        criterionMapping: "AC-3",
        nativeComment: "AC-3: the profile route is missing.",
        normalizedFinding: "AC-3: the profile route is missing.",
      }),
    ],
  };
  const rc = contract(input);
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: {},
    artifactRegistry: registry(),
  });
  const occurrenceOfSecond = scorer.profileA.findings[1].occurrenceId;
  const scorerWithSupport = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: {
      [claimSupportKey("AC-3", APP, "f-1", occurrenceOfSecond)]: {
        ...SUPPORTING,
        criterionId: "AC-3",
        findingId: "f-1",
        occurrenceId: occurrenceOfSecond,
      },
    },
    artifactRegistry: registry(),
  });
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer: scorerWithSupport,
    registry: registry(),
    allowedPaths: files().map((f) => f.path),
    expectedCandidateBinding: CANDIDATE,
    expectedSnapshotDigest: SNAPSHOT,
    expectedCriteriaRevision: rc.criteria.authoredCriteriaRevision,
    expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  return {
    schema: "m2.repro.profile-a-finding-collision/v1",
    note:
      "Two raw findings share the external id f-1. The first is AC-1/unsupported/contradicts; the second is AC-3/supported/matches. The join is by occurrence identity, so admission must not expose the second scored record for both.",
    contractValid: validateResultContract(rc).length === 0,
    rawFindings: input.findings,
    scoredOccurrences: scorerWithSupport.profileA.findings.map((f) => ({
      findingId: f.findingId,
      occurrenceId: f.occurrenceId,
      occurrenceIndex: f.occurrenceIndex,
      findingIdAmbiguous: f.findingIdAmbiguous,
      criterionMapping: f.criterionMapping,
      semanticSupport: f.semanticSupport,
      supportAmbiguous: f.supportAmbiguous,
      truthComparison: f.truthComparison,
      duplicateMapping: f.duplicateMapping,
    })),
    admission: {
      admitted: decision.admitted,
      admittedFindings: decision.admittedFindings,
      supportedDetections: decision.supportedDetections,
      supportedDetectionOccurrences: decision.supportedDetectionOccurrences,
      occurrencesOneToOne: decision.occurrencesOneToOne,
      findings: decision.findings.map((f) => ({
        findingId: f.findingId,
        occurrenceId: f.occurrenceId,
        criterionId: f.criterionId,
        semanticSupported: f.semanticSupported,
        admitted: f.admitted,
        supportedDetection: f.supportedDetection,
        primaryFailureGate: f.primaryFailureGate,
        reason: f.reason,
      })),
    },
  };
}

// --- Profile A explicit contradiction reproduction -------------------------

/**
 * The maintainer's paired Profile A case. Identical inputs in both halves; only
 * the second AC-3 reference's judgment changes:
 *
 *   A. reference A supports, reference B is neutral       -> admissible
 *   B. reference A supports, reference B contradictsClaim -> rejected
 */
function profileAContradiction() {
  const findings = [
    finding({
      findingId: "f-control",
      criterionMapping: "AC-1",
      nativeComment: "AC-1: the profile route is missing.",
      normalizedFinding: "AC-1: the profile route is missing.",
      references: [APP],
    }),
    finding({
      findingId: "f-pair",
      criterionMapping: "AC-3",
      references: [APP, SERIALIZER],
    }),
  ];
  const baseRubrics = {
    [claimSupportKey("AC-1", APP)]: { ...SUPPORTING, criterionId: "AC-1" },
    [claimSupportKey("AC-3", APP)]: { ...SUPPORTING, criterionId: "AC-3" },
  };

  const run = (rubrics) => {
    const rc = contract({ findings });
    const scorer = scoreResult({
      resultContract: rc,
      truthBinding: truthBinding(rc),
      claimRubrics: rubrics,
      artifactRegistry: registry(),
    });
    const decision = admitProfileAFindings({
      resultContract: rc,
      scorer,
      registry: registry(),
      allowedPaths: files().map((f) => f.path),
      expectedCandidateBinding: CANDIDATE,
      expectedSnapshotDigest: SNAPSHOT,
      expectedCriteriaRevision: rc.criteria.authoredCriteriaRevision,
      expectedCriteriaContentDigest: rc.criteria.criteriaTextDigest,
      expectedCriterionIds: [...CRITERIA],
    });
    return {
      scoredFindings: scorer.profileA.findings.map((f) => ({
        findingId: f.findingId,
        occurrenceId: f.occurrenceId,
        criterionMapping: f.criterionMapping,
        references: findings[f.occurrenceIndex].references,
        semanticSupport: f.semanticSupport,
        evidenceConflict: f.evidenceConflict,
        contradictoryReferences: f.contradictoryReferences,
        supportAmbiguous: f.supportAmbiguous,
        truthComparison: f.truthComparison,
        diagnostics: f.diagnostics,
      })),
      summary: scorer.profileA.summary,
      admission: {
        reviewAdmitted: decision.admitted,
        deliveredFindings: decision.deliveredFindings,
        admittedFindings: decision.admittedFindings,
        rejectedFindings: decision.rejectedFindings,
        supportedDetections: decision.supportedDetections,
        supportedDetectionOccurrences: decision.supportedDetectionOccurrences,
        findings: decision.findings.map((f) => ({
          findingId: f.findingId,
          occurrenceId: f.occurrenceId,
          criterionId: f.criterionId,
          references: f.references,
          semanticSupported: f.semanticSupported,
          evidenceConflict: f.evidenceConflict,
          contradictoryReferences: f.contradictoryReferences,
          admitted: f.admitted,
          supportedDetection: f.supportedDetection,
          primaryFailureGate: f.primaryFailureGate,
          reason: f.reason,
          gates: f.gates.filter((g) => g.scope === "claim" && g.status !== "not-applicable"),
        })),
      },
    };
  };

  return {
    schema: "m2.repro.profile-a-explicit-contradiction/v1",
    note:
      "Paired case with identical inputs. Case A: reference A supports AC-3 and reference B is neutral, so the finding stays admissible. Case B: the same reference B carries contradictsClaim=true, so the finding is rejected with an evidence-conflict gate and is not a supported detection. Original findings, references and diagnostics are preserved in both cases, and an unrelated AC-1 finding is unaffected.",
    inputs: { findings, criteria: [...CRITERIA], candidate: CANDIDATE, snapshot: SNAPSHOT },
    caseA_supportingPlusNeutral: run(baseRubrics),
    caseB_supportingPlusContradiction: run({
      ...baseRubrics,
      [claimSupportKey("AC-3", SERIALIZER)]: { ...SUPPORTING, criterionId: "AC-3", contradictsClaim: true },
    }),
  };
}

// --- Profile B conflicting duplicate reproduction --------------------------

function profileBDuplicate() {
  // The maintainer's exact six-record input: five ordinary expected assessments,
  // one per expected criterion AC-1..AC-5, then a sixth AC-3 record that
  // contradicts the first AC-3 claim. The first AC-3 occurrence is part of the
  // original five; the sixth is the duplicate conflicting occurrence.
  const rawReply = {
    assessments: [
      { criterionId: "AC-1", outcome: "satisfied", references: [APP], explanation: "AC-1 ok" },
      { criterionId: "AC-2", outcome: "violated", references: [APP], explanation: "AC-2 missing" },
      { criterionId: "AC-3", outcome: "violated", references: [APP], explanation: "AC-3 route missing" },
      { criterionId: "AC-4", outcome: "satisfied", references: [APP], explanation: "AC-4 ok" },
      { criterionId: "AC-5", outcome: "satisfied", references: [APP], explanation: "AC-5 ok" },
      { criterionId: "AC-3", outcome: "satisfied", references: [SERIALIZER], explanation: "AC-3 route exists" },
    ],
  };
  const decoded = decodeProfileBAssessments(JSON.stringify(rawReply), CRITERIA);
  const rc = contract({ assessments: decoded.assessments });
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(rc),
    claimRubrics: Object.fromEntries(CRITERIA.map((id) => [claimSupportKey(id, APP), { ...SUPPORTING, criterionId: id }])),
    artifactRegistry: registry(),
  });
  return {
    schema: "m2.repro.profile-b-conflicting-duplicate/v2",
    note:
      "The maintainer's exact six-record input: five ordinary expected assessments (AC-1..AC-5) plus a sixth conflicting AC-3 record. Six occurrences are preserved; the two AC-3 occurrences share one conflict group and are individually rejected; AC-1, AC-2, AC-4 and AC-5 are independently consumer-admitted; the aggregate is rejected.",
    rawReply,
    rawRecordCount: decoded.rawRecords.length,
    occurrenceCount: rc.assessments.length,
    decoder: {
      assessments: decoded.assessments.map((a) => ({
        criterionId: a.expectedCriterionId,
        originalReportedClaim: a.originalReportedClaim,
        references: a.references,
        explanation: a.explanation,
        conflict: a.conflict ?? null,
      })),
      duplicateIds: decoded.duplicateIds,
      conflicts: decoded.conflicts,
      recordDiagnostics: decoded.recordDiagnostics.map((d) => ({
        index: d.index,
        criterionId: d.criterionId,
        errors: d.errors,
        conflictGroup: d.conflictGroup ?? null,
        conflictKind: d.conflictKind ?? null,
      })),
    },
    contractCoverage: rc.coverage,
    diagnostics: scorer.diagnostics,
    claimAdmissions: scorer.claimAdmissions.map((c, i) => ({
      criterionId: c.criterionId,
      originalReportedClaim: c.originalReportedClaim,
      admittedConclusion: rc.assessments[i]?.admittedConclusion ?? null,
      references: rc.assessments[i]?.references ?? [],
      explanation: rc.assessments[i]?.explanation ?? null,
      consumerAdmitted: c.consumerAdmitted,
      claimAssociationValid: c.claimAssociationValid,
      conflictStatus: c.conflictStatus,
      conflictGroup: c.conflictGroup,
      primaryFailureGate: c.primaryFailureGate,
      reason: c.reason,
      diagnostics: c.diagnostics,
    })),
    claimAccounting: scorer.reportedClaims.entries.map((e) => ({
      criterionId: e.criterionId,
      originalReportedClaim: e.originalReportedClaim,
      accounted: e.accounted,
      consumerAdmitted: e.consumerAdmitted,
    })),
    aggregate: {
      admitted: scorer.admission.admitted,
      reason: scorer.admission.reason,
      primaryFailureGate: scorer.admission.primaryFailureGate,
      gates: scorer.admission.gates,
    },
  };
}

// --- PR #349 identities ----------------------------------------------------

const PR349 = {
  schema: "m2.pr349-development-case-sources/v1",
  classification: "DEVELOPMENT EXAMPLE — NOT INDEPENDENT MODEL-QUALITY EVIDENCE",
  requirementSource: {
    repository: "777genius/review-router-ai",
    commit: "6797745dd568149e6314cd44b24cb901de1819e2",
    commitDate: "2026-10-27T16:14:28Z",
    tree: "bf39355b9b5704cd5564d345c4f40466a586ec66",
    path: "ai-docs/plans/2026-10-23-hindsight-memory-replacement.md",
    blob: "940747b75122f7d079abbfa8f18cf0f5aa1e4991",
    sha256: "586446003338e3b40971145221a629256af2df9619cd663535ad1337863c5e3e",
    bytes: 83052,
    section: "§8 — requires integration into the actual T0 review path and the correct prompt/cache/replay/attestation inputs",
  },
  preFixCandidate: {
    repository: "777genius/review-router",
    commit: "056952b5a3d625fd1d19384942d452114804380f",
    commitDate: "2026-10-27T18:25:10Z",
    tree: "dc7da86a2b23d1c12fde90f39cf31628f988c58c",
    parent: "cb13109566b10813a90de31741c17df7ed0e9f2a",
    changedPaths: [
      ".github/workflows/reviewrouter-execution-reusable.yml",
      ".github/workflows/reviewrouter-interaction-reusable.yml",
      ".github/workflows/reviewrouter-runtime.yml",
      "AGENTS.md",
      "__tests__/unit/github/reusable-workflows.test.ts",
      "__tests__/unit/review-orchestration/production-t0-review-runner.test.ts",
    ],
    adapter: {
      path: "src/review-orchestration/infrastructure/ocr-review-invocation-adapter.ts",
      blob: "5c0ed267724567dd9b4173c64e873ecc8007d99c",
      sha256: "203da28e4b1082b122f29583e8e31e65e04efaec31d71d71a1fd8b9e48744740",
      bytes: 45875,
    },
  },
  fix: {
    commit: "f87abf4817bcee10a6be830c834cb599a971372f",
    commitDate: "2026-10-28T10:53:17Z",
    tree: "9af4977dad105af2413867bb3b4443c24538376e",
    parent: "056952b5a3d625fd1d19384942d452114804380f",
    subject: "fix(memory): deliver approved memory to OCR model requests",
    adapterChange: "+11/-5: translate the legacy `content` rule key into { path: '**', rule, merge_system_rule: true } before appending memory",
  },
};

// --- Write the bundle ------------------------------------------------------

function writeJson(name, value) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + "\n", "utf8");
}

fs.mkdirSync(OUT, { recursive: true });

writeJson("repro-profile-a-finding-collision.json", profileACollision());
writeJson("repro-profile-a-explicit-contradiction.json", profileAContradiction());
writeJson("repro-profile-b-conflicting-duplicate.json", profileBDuplicate());
writeJson("pr349-development-case-sources.json", PR349);

const probePath = path.join(TMP, "pr349", "memory-delivery-probe.json");
if (fs.existsSync(probePath)) {
  fs.copyFileSync(probePath, path.join(OUT, "pr349-memory-delivery-probe.json"));
}

const wp8aDir = path.join(TMP, "wp8a-evidence");
const transcript = path.join(wp8aDir, "S1-C3", "native-tool-transcript.jsonl");
if (fs.existsSync(transcript)) {
  fs.copyFileSync(transcript, path.join(OUT, "native-tool-transcript.jsonl"));
}
for (const scenario of ["unchanged-dependency-read", "out-of-scope-read"]) {
  const chain = path.join(wp8aDir, "S1-C3", `native-tool-chain-${scenario}.json`);
  if (fs.existsSync(chain)) fs.copyFileSync(chain, path.join(OUT, `native-tool-chain-${scenario}.json`));
  // The actual call arguments and tool-output payloads, when the run that
  // produced the transcript also retained them.
  const payloads = path.join(wp8aDir, "S1-C3", `native-tool-payloads-${scenario}.json`);
  if (fs.existsSync(payloads)) fs.copyFileSync(payloads, path.join(OUT, `native-tool-payloads-${scenario}.json`));
}

// Per-file manifest over everything in the bundle except the manifest itself.
const entries = fs
  .readdirSync(OUT)
  .filter((name) => name !== "MANIFEST.json")
  .sort()
  .map((name) => {
    const bytes = fs.readFileSync(path.join(OUT, name));
    return { path: name, bytes: bytes.length, sha256: H(bytes) };
  });
fs.writeFileSync(
  path.join(OUT, "MANIFEST.json"),
  JSON.stringify({ schema: "m2.targeted-corrective-evidence/v1", files: entries }, null, 2) + "\n",
  "utf8",
);

// Verify EVERY entry against the bytes on disk, not only the one just written.
// A stale digest left by an earlier run (the README drift) fails here.
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "MANIFEST.json"), "utf8"));
const mismatches = [];
for (const entry of manifest.files) {
  const bytes = fs.readFileSync(path.join(OUT, entry.path));
  if (bytes.length !== entry.bytes || H(bytes) !== entry.sha256) {
    mismatches.push(`${entry.path}: manifest ${entry.bytes}B/${entry.sha256.slice(0, 12)} != disk ${bytes.length}B/${H(bytes).slice(0, 12)}`);
  }
}
if (mismatches.length > 0) {
  throw new Error(`evidence manifest mismatch:\n${mismatches.join("\n")}`);
}
console.log(`retained ${entries.length} evidence files in ${path.relative(ROOT, OUT)}; verified ${entries.length}/${entries.length}`);
