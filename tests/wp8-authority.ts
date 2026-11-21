/**
 * WP8 authoritative snapshot, artifact-registry and admission controls.
 *
 * These run in the main suite on every platform (they need Git and the
 * authoritative fixture material, but not the Linux-only rr.7 binary).
 *
 * They prove that WP8 cannot pass while reviewing something other than the
 * official candidate snapshot, and that consumer admission is driven by
 * byte-verified artifacts rather than by caller-supplied booleans or by Truth.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAuthoritativeSnapshot,
  loadProvenanceRecord,
  readBackSnapshot,
  verifySnapshot,
} from "../scripts/ocr-rr7/authoritative-snapshot.ts";
import { applicationDigest } from "../src/digest.ts";
import {
  ARTIFACT_SCHEME,
  artifactDigest,
  artifactReference,
  buildArtifactRegistry,
  verifyArtifactRegistry,
} from "../src/artifact-registry.ts";
import { admitProfileAFindings } from "../src/profile-a-admission.ts";
import {
  claimSupportKey,
  scoreResult,
  type ArtifactRegistry,
  type RubricDecision,
  type TruthBinding,
} from "../src/scorer.ts";
import { captureCriteriaSnapshot } from "../src/criteria.ts";
import { buildResultContract, computeCoverage, validateResultContract, type FindingRecord } from "../src/result-contract.ts";
import { loadTruth, CRITERIA } from "../src/truth.ts";
import { FROZEN_CRITERIA, opaqueId } from "../src/materialization.ts";
import { headFilesFor } from "../scripts/snapshot-defs.ts";
import { assertOcrIdentityBinding, OcrIdentityMismatchError } from "../src/ocr-profile-a.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WS_ROOT = path.join(ROOT, ".isolation-tmp", "wp8-authority");
const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const CANDIDATES = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;

const SNAPSHOTS = new Map<string, ReturnType<typeof buildAuthoritativeSnapshot>>();

function snapshotFor(candidateId: string) {
  const existing = SNAPSHOTS.get(candidateId);
  if (existing) return existing;
  const root = path.join(WS_ROOT, `${candidateId}-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(root, { recursive: true });
  const snapshot = buildAuthoritativeSnapshot(candidateId, root);
  SNAPSHOTS.set(candidateId, snapshot);
  return snapshot;
}

const SUPPORTING: RubricDecision = {
  referenceExists: true,
  tiedToCandidate: true,
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

/** Independently captured expected criteria content (not taken from any result). */
const CAPTURED_CRITERIA = captureCriteriaSnapshot({
  authoredRevision: loadTruth().criteriaRevision,
  criteria: FROZEN_CRITERIA,
  source: "tests/wp8-authority.ts",
});

/**
 * Declare claim-scoped support for each (criterion, reference) pair a finding
 * actually asserts. A single reference-level judgment is deliberately NOT
 * spread across findings that cite the same file.
 */
function claimRubricsFor(
  findings: readonly FindingRecord[],
  decision: RubricDecision = SUPPORTING,
): Record<string, RubricDecision> {
  const out: Record<string, RubricDecision> = {};
  for (const f of findings) {
    if (f.criterionMapping === null) continue;
    for (const ref of f.references ?? []) {
      out[claimSupportKey(f.criterionMapping, ref)] = { ...decision, criterionId: f.criterionMapping };
    }
  }
  return out;
}

// --- Snapshot identity ------------------------------------------------------

test("WP8-A authority: every candidate reproduces the official Git identity and diff", () => {
  for (const candidateId of CANDIDATES) {
    const record = loadProvenanceRecord(candidateId);
    const snapshot = snapshotFor(candidateId);
    const verification = verifySnapshot(snapshot);

    assert.deepEqual(verification.errors, [], `${candidateId}: ${verification.errors.join("; ")}`);
    assert.equal(snapshot.base.commit, record.base.commit, `${candidateId}: base commit`);
    assert.equal(snapshot.head.commit, record.head.commit, `${candidateId}: head commit`);
    assert.equal(snapshot.base.tree, record.base.tree, `${candidateId}: base tree`);
    assert.equal(snapshot.head.tree, record.head.tree, `${candidateId}: head tree`);
    assert.equal(snapshot.base.applicationDigest, record.base.applicationDigest, `${candidateId}: base digest`);
    assert.equal(snapshot.head.applicationDigest, record.head.applicationDigest, `${candidateId}: head digest`);
    assert.deepEqual(snapshot.files, [...record.files].sort(), `${candidateId}: head inventory`);
    assert.equal(
      snapshot.diff.replace(/\n+$/, ""),
      record.diffFull.replace(/\n+$/, ""),
      `${candidateId}: diff`,
    );
    // Diff paths are repository-root relative (the official diff paths).
    const paths = [...snapshot.diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((m) => [m[1], m[2]]);
    assert.ok(paths.length > 0, `${candidateId}: diff has no file headers`);
    for (const p of paths) {
      assert.equal(p, "app.ts", `${candidateId}: unexpected diff path ${p}`);
    }
  }
});

test("WP8-A authority: readback derives the identities from repository bytes", () => {
  const snapshot = snapshotFor("S1-C4");
  const readback = readBackSnapshot(snapshot);
  assert.equal(readback.baseTree, loadProvenanceRecord("S1-C4").base.tree);
  assert.equal(readback.headTree, loadProvenanceRecord("S1-C4").head.tree);
  // The head tree bytes are the authoritative head file map, byte for byte.
  const authoritative = headFilesFor("S1-C4");
  assert.equal(applicationDigest(readback.headFiles), applicationDigest(authoritative));
  for (const rel of Object.keys(authoritative)) {
    assert.equal(readback.headFiles[rel], authoritative[rel].replace(/\r\n/g, "\n"), `head file ${rel}`);
  }
  // C4 uses base B1, whose serializer differs from B0's.
  assert.notEqual(
    snapshotFor("S1-C4").base.applicationDigest,
    snapshotFor("S1-C1").base.applicationDigest,
    "C4 must use base B1, not B0",
  );
});

test("WP8-A authority: a synthetic repository identity is rejected, not reported as the candidate", () => {
  const snapshot = snapshotFor("S1-C1");
  // A repository whose head commit was created by an ordinary (non-official)
  // recipe is a synthetic identity and must be rejected.
  const copy = path.join(path.dirname(snapshot.repo), `synthetic-${crypto.randomBytes(4).toString("hex")}`);
  fs.cpSync(snapshot.repo, copy, { recursive: true });
  const git = (args: string[]): string =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: copy, encoding: "utf8" }).trim();
  git(["checkout", "-q", snapshot.head.commit]);
  fs.writeFileSync(path.join(copy, "app.ts"), "// synthetic rewrite\n", "utf8");
  git(["add", "-A"]);
  git(["commit", "-qm", "synthetic head"]);
  const syntheticHead = git(["rev-parse", "HEAD"]);

  const tampered = {
    ...snapshot,
    repo: copy,
    head: { ...snapshot.head, commit: syntheticHead },
  };
  const verification = verifySnapshot(tampered);
  assert.equal(verification.ok, false, "a synthetic head must not verify as the candidate");
  assert.ok(
    verification.errors.some((e) => e.startsWith("head commit:") || e.startsWith("head tree:")),
    verification.errors.join("; "),
  );
  assert.notEqual(syntheticHead, loadProvenanceRecord("S1-C1").head.commit);
});

// --- Identity binding of rendered reviewer input ----------------------------

test("WP8-A authority: altered Base, Head or Diff is rejected by the Profile A path", () => {
  const snapshot = snapshotFor("S1-C3");
  const base = {
    candidateAlias: opaqueId("S1-C3"),
    sourceIdentity: "authoritative",
    base: snapshot.base.tree,
    head: snapshot.head.tree,
    diff: snapshot.diff,
    task: "Implement the profile endpoint.",
    criteria: [{ id: "AC-3", text: "revocation" }],
    background: "authority test",
    rules: "Report only issues introduced by the diff.",
  };
  const expected = { base: snapshot.base.tree, head: snapshot.head.tree, diff: snapshot.diff, allowedPaths: snapshot.files };

  assert.doesNotThrow(() => assertOcrIdentityBinding(base, expected));

  assert.throws(() => assertOcrIdentityBinding({ ...base, base: "f".repeat(40) }, expected), OcrIdentityMismatchError);
  assert.throws(() => assertOcrIdentityBinding({ ...base, head: "f".repeat(40) }, expected), OcrIdentityMismatchError);
  assert.throws(
    () =>
      assertOcrIdentityBinding(
        { ...base, diff: `${base.diff}\n+// altered reviewer-visible change\n` },
        expected,
      ),
    OcrIdentityMismatchError,
  );
});

test("WP8-A authority: a diff path outside the application allowlist is rejected", () => {
  const snapshot = snapshotFor("S1-C1");
  const expected = { base: snapshot.base.tree, head: snapshot.head.tree, diff: snapshot.diff, allowedPaths: ["app.ts"] };
  const widened = `${snapshot.diff}\ndiff --git a/truth/truth-v1.json b/truth/truth-v1.json\n`;
  assert.throws(
    () =>
      assertOcrIdentityBinding(
        {
          candidateAlias: opaqueId("S1-C1"),
          sourceIdentity: "authoritative",
          base: snapshot.base.tree,
          head: snapshot.head.tree,
          diff: widened,
          task: "t",
          criteria: [],
          background: "b",
          rules: "r",
        },
        expected,
      ),
    OcrIdentityMismatchError,
  );
});

// --- Real artifact registry -------------------------------------------------

function registryFor(candidateId: string, overrides: { snapshotDigest?: string } = {}) {
  const snapshot = snapshotFor(candidateId);
  const files = Object.entries(snapshot.headFiles).map(([p, content]) => ({ path: p, content }));
  const binding = {
    candidateBinding: opaqueId(candidateId),
    snapshotDigest: overrides.snapshotDigest ?? snapshot.head.applicationDigest,
  };
  const built = buildArtifactRegistry({ binding, files, allowedPaths: snapshot.files });
  const verified = verifyArtifactRegistry({ registry: built.registry, files, allowedPaths: snapshot.files, binding });
  return { snapshot, files, binding, built, verified, registry: built.registry };
}

test("WP8-A authority: registry digests are recomputed from bytes and verify", () => {
  for (const candidateId of ["S1-C3", "S1-C4"]) {
    const { snapshot, files, built, verified } = registryFor(candidateId);
    assert.deepEqual(built.rejected, [], `${candidateId}: no allowlisted file may be rejected`);
    assert.equal(verified.ok, true, verified.errors.join("; "));
    assert.equal(Object.keys(verified.accepted.artifacts).length, snapshot.files.length);
    for (const f of files) {
      const ref = artifactReference(f.path);
      assert.equal(verified.accepted.artifacts[ref].digest, artifactDigest(f.content));
      assert.equal(verified.accepted.artifacts[ref].candidateBinding, opaqueId(candidateId));
      assert.equal(verified.accepted.artifacts[ref].snapshotDigest, snapshot.head.applicationDigest);
      assert.ok(ref.startsWith(ARTIFACT_SCHEME));
    }
  }
});

test("WP8-A authority: registry rejects an incorrect digest, wrong snapshot and disallowed path", () => {
  const { registry, files, snapshot, binding } = registryFor("S1-C3");
  const ref = artifactReference("app.ts");

  const wrongDigest: ArtifactRegistry = structuredClone(registry);
  wrongDigest.artifacts[ref].digest = "0".repeat(64);
  const digestCheck = verifyArtifactRegistry({ registry: wrongDigest, files, allowedPaths: snapshot.files, binding });
  assert.equal(digestCheck.ok, false);
  assert.ok(digestCheck.errors.some((e) => e.includes("digest mismatch")), digestCheck.errors.join("; "));
  assert.equal(digestCheck.accepted.artifacts[ref], undefined, "a bad digest must not be accepted");

  const wrongSnapshot: ArtifactRegistry = structuredClone(registry);
  wrongSnapshot.artifacts[ref].snapshotDigest = "9".repeat(64);
  const snapshotCheck = verifyArtifactRegistry({
    registry: wrongSnapshot,
    files,
    allowedPaths: snapshot.files,
    binding,
  });
  assert.equal(snapshotCheck.ok, false);
  assert.ok(snapshotCheck.errors.some((e) => e.includes("snapshot binding mismatch")));

  const wrongCandidate: ArtifactRegistry = structuredClone(registry);
  wrongCandidate.artifacts[ref].candidateBinding = opaqueId("S1-C1");
  const candidateCheck = verifyArtifactRegistry({
    registry: wrongCandidate,
    files,
    allowedPaths: snapshot.files,
    binding,
  });
  assert.equal(candidateCheck.ok, false);
  assert.ok(candidateCheck.errors.some((e) => e.includes("candidate binding mismatch")));

  const stale: ArtifactRegistry = structuredClone(registry);
  stale.artifacts[ref].current = false;
  const staleCheck = verifyArtifactRegistry({ registry: stale, files, allowedPaths: snapshot.files, binding });
  assert.equal(staleCheck.ok, false);
  assert.ok(staleCheck.errors.some((e) => e.includes("not current")));

  const inapplicable: ArtifactRegistry = structuredClone(registry);
  inapplicable.artifacts[ref].applicable = false;
  const applicableCheck = verifyArtifactRegistry({
    registry: inapplicable,
    files,
    allowedPaths: snapshot.files,
    binding,
  });
  assert.equal(applicableCheck.ok, false);
  assert.ok(applicableCheck.errors.some((e) => e.includes("not applicable")));

  const outOfScope: ArtifactRegistry = structuredClone(registry);
  outOfScope.artifacts["artifact://truth/truth-v1.json"] = {
    artifactId: "truth",
    digest: H("truth"),
    candidateBinding: binding.candidateBinding,
    snapshotDigest: binding.snapshotDigest,
    criterionId: null,
    allowedSource: true,
    current: true,
    applicable: true,
  };
  const scopeCheck = verifyArtifactRegistry({
    registry: outOfScope,
    files,
    allowedPaths: snapshot.files,
    binding,
  });
  assert.equal(scopeCheck.ok, false);
  assert.ok(scopeCheck.errors.some((e) => e.includes("outside the application allowlist")));
});

// --- Profile A admission ----------------------------------------------------

function profileAContract(params: {
  candidateId: string;
  findings: FindingRecord[];
  snapshotDigest?: string;
  candidateBinding?: string;
  applicability?: "applicable" | "not_applicable";
}) {
  const snapshot = snapshotFor(params.candidateId);
  const truth = loadTruth();
  const anonId = opaqueId(params.candidateId);
  return buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: [...CRITERIA] },
    candidate: {
      repositoryMaterializationId: params.candidateBinding ?? anonId,
      baseTreeIdentity: snapshot.base.tree,
      headTreeIdentity: snapshot.head.tree,
      runtimeSnapshotDigest: params.snapshotDigest ?? snapshot.head.applicationDigest,
      opaqueFixtureId: params.candidateBinding ?? anonId,
    },
    criteria: {
      authoredCriteriaRevision: truth.criteriaRevision,
      criteriaTextDigest: CAPTURED_CRITERIA.contentDigest,
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: H("policy"),
    },
    profile: {
      profileId: "profile-a",
      configurationIdentity: "cfg",
      promptIdentity: "prompt",
      inputIdentity: "input",
      requestedModel: null,
      observedModel: null,
      reasoningConfiguration: {},
      adapterEntryIdentity: "ocr-rr7",
    },
    assessments: [],
    findings: params.findings,
    coverage: computeCoverage([...CRITERIA], []),
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
    rawArtifact: { available: true, rawText: "raw", rawBytesDigest: H("raw"), rawUnavailableCause: null },
    evidence: {
      producer: "oracle-O-1",
      candidateBinding: anonId,
      checkDefinition: H("check"),
      inputScope: "application",
      environment: "node-test/authority",
      observationOutcome: "complete",
      completeness: "complete",
      timestamps: ["2026-01-01T00:00:00Z"],
      references: [],
      applicability: params.applicability ?? "applicable",
      provenance: "oracle",
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

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    nativeComment: "AC-3: the revocation list is never consulted.",
    normalizedFinding: "AC-3: the revocation list is never consulted.",
    skipped: false,
    skipReason: null,
    qualityFlags: [],
    criterionMapping: "AC-3",
    references: [artifactReference("app.ts")],
    ...overrides,
  };
}

function truthBinding(candidateId: string): TruthBinding {
  const truth = loadTruth();
  const snapshot = snapshotFor(candidateId);
  return {
    canonicalCandidateId: opaqueId(candidateId),
    anonymizedCandidateId: opaqueId(candidateId),
    headApplicationDigest: snapshot.head.applicationDigest,
    criteriaRevision: truth.criteriaRevision,
    expectedCriterionInventory: [...CRITERIA],
    truthVersion: "truth-v1",
    truthDigest: H(fs.readFileSync(path.join(ROOT, "truth", "truth-v1.json"), "utf8")),
    truthOutcomes: truth.candidateOutcomes[candidateId],
  };
}

function admit(params: {
  candidateId: string;
  findings: FindingRecord[];
  registry?: ArtifactRegistry;
  /** Claim-scoped support decisions, keyed by `criterionId::reference`. */
  rubrics?: Record<string, RubricDecision>;
  allowedPaths?: string[];
}) {
  const candidateId = params.candidateId;
  const snapshot = snapshotFor(candidateId);
  const usedRegistry: ArtifactRegistry = params.registry ?? registryFor(candidateId).registry;
  const rc = profileAContract({ candidateId, findings: params.findings });
  assert.deepEqual(validateResultContract(rc), []);
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding: truthBinding(candidateId),
    claimRubrics: params.rubrics ?? claimRubricsFor(params.findings),
    artifactRegistry: usedRegistry,
  });
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer,
    registry: usedRegistry,
    allowedPaths: params.allowedPaths ?? snapshot.files,
    expectedCandidateBinding: opaqueId(candidateId),
    expectedSnapshotDigest: snapshot.head.applicationDigest,
    expectedCriteriaRevision: loadTruth().criteriaRevision,
    expectedCriteriaContentDigest: CAPTURED_CRITERIA.contentDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  return { rc, scorer, decision };
}

test("WP8-A admission: a valid current C3 finding is admitted and is a supported detection", () => {
  const { decision, scorer } = admit({ candidateId: "S1-C3", findings: [finding()] });
  assert.equal(decision.admitted, true, decision.reason);
  assert.equal(decision.admittedFindings, 1);
  assert.equal(decision.rejectedFindings, 0);
  assert.equal(decision.findings[0].referenceValid, true);
  assert.equal(decision.findings[0].semanticSupported, true);
  assert.equal(decision.findings[0].admitted, true);
  // Truth is violated for AC-3, and the finding clears every mechanical gate.
  assert.equal(decision.findings[0].supportedDetection, true);
  assert.deepEqual(decision.supportedDetections, [decision.findings[0].findingId]);
  // Profile A never admits criterion-level verdicts.
  assert.deepEqual(decision.admittedCriterionIds, []);
  assert.deepEqual(scorer.profileA.summary.mapped, 1);
  assert.equal(scorer.profileA.summary.supportedDetections, 1);
});

test("WP8-A admission: a valid current C4 finding is admitted and is a supported detection", () => {
  const ac4 = finding({
    nativeComment: "AC-4: the serializer exposes role.",
    normalizedFinding: "AC-4: the serializer exposes role.",
    criterionMapping: "AC-4",
    references: [artifactReference("serializer.ts")],
  });
  const { decision } = admit({ candidateId: "S1-C4", findings: [ac4] });
  assert.equal(decision.admitted, true, decision.reason);
  assert.equal(decision.findings[0].supportedDetection, true);
});

test("WP8-A admission: wrong-candidate reference is rejected", () => {
  const other = registryFor("S1-C1").registry;
  const { decision } = admit({ candidateId: "S1-C3", findings: [finding()], registry: other });
  assert.equal(decision.admittedFindings, 0);
  assert.equal(decision.findings[0].referenceValid, false);
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(decision.findings[0].supportedDetection, false);
  assert.match(decision.findings[0].reason, /candidate|snapshot/);
});

test("WP8-A admission: wrong-snapshot reference is rejected", () => {
  const wrongSnapshot = registryFor("S1-C3", { snapshotDigest: H("other snapshot") }).registry;
  const { decision } = admit({ candidateId: "S1-C3", findings: [finding()], registry: wrongSnapshot });
  assert.equal(decision.admittedFindings, 0);
  assert.equal(decision.findings[0].snapshotBound, false);
  assert.equal(decision.findings[0].admitted, false);
});

test("WP8-A admission: an invalid digest is rejected", () => {
  const registry = structuredClone(registryFor("S1-C3").registry);
  registry.artifacts[artifactReference("app.ts")].digest = "0".repeat(64);
  const { snapshot, files, binding } = registryFor("S1-C3");
  const verification = verifyArtifactRegistry({
    registry,
    files,
    allowedPaths: snapshot.files,
    binding,
  });
  assert.equal(verification.ok, false);
  const { decision } = admit({ candidateId: "S1-C3", findings: [finding()], registry: verification.accepted });
  assert.equal(decision.admittedFindings, 0);
  assert.equal(decision.findings[0].referenceValid, false);
});

test("WP8-A admission: stale or inapplicable evidence cannot be admitted", () => {
  const registry = structuredClone(registryFor("S1-C3").registry);
  registry.artifacts[artifactReference("app.ts")].current = false;
  const { decision } = admit({ candidateId: "S1-C3", findings: [finding()], registry });
  assert.equal(decision.findings[0].referenceValid, false);
  assert.equal(decision.findings[0].admitted, false);

  const inapplicable = admit({ candidateId: "S1-C3", findings: [finding()] });
  const rcInapplicable = profileAContract({ candidateId: "S1-C3", findings: [finding()], applicability: "not_applicable" });
  const scorerInapplicable = scoreResult({
    resultContract: rcInapplicable,
    truthBinding: truthBinding("S1-C3"),
    referenceRubrics: { [artifactReference("app.ts")]: SUPPORTING },
    artifactRegistry: registryFor("S1-C3").registry,
  });
  const decisionInapplicable = admitProfileAFindings({
    resultContract: rcInapplicable,
    scorer: scorerInapplicable,
    registry: registryFor("S1-C3").registry,
    allowedPaths: snapshotFor("S1-C3").files,
    expectedCandidateBinding: opaqueId("S1-C3"),
    expectedSnapshotDigest: snapshotFor("S1-C3").head.applicationDigest,
    expectedCriteriaRevision: loadTruth().criteriaRevision,
    expectedCriteriaContentDigest: CAPTURED_CRITERIA.contentDigest,
    expectedCriterionIds: [...CRITERIA],
  });
  assert.equal(decisionInapplicable.admitted, false);
  assert.equal(decisionInapplicable.evidenceApplicable, false);
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(inapplicable.decision.admitted, true);
});

test("WP8-A admission: a missing reference is not admitted", () => {
  const { decision } = admit({ candidateId: "S1-C3", findings: [finding({ references: [] })] });
  assert.equal(decision.findings[0].referenceValid, false);
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(decision.findings[0].supportedDetection, false);
  assert.equal(decision.admittedFindings, 0);

  const missing = admit({ candidateId: "S1-C3", findings: [finding({ references: ["artifact://nope.ts"] })] });
  assert.equal(missing.decision.findings[0].referenceValid, false);
  assert.equal(missing.decision.findings[0].admitted, false);
  assert.equal(missing.decision.admittedFindings, 0);
});

test("WP8-A admission: unsupported semantic evidence is not a supported detection", () => {
  const contradicting: RubricDecision = {
    referenceExists: true,
    tiedToCandidate: true,
    supportsBehavior: false,
    coversSubclauses: false,
    relevantCurrentApplicable: true,
    contradictsClaim: true,
  };
  const { decision, scorer } = admit({
    candidateId: "S1-C3",
    findings: [finding()],
    rubrics: claimRubricsFor([finding()], contradicting),
  });
  assert.equal(decision.findings[0].referenceValid, true, "mechanical resolution still succeeds");
  assert.equal(decision.findings[0].semanticSupported, false);
  assert.equal(decision.findings[0].supportedDetection, false);
  assert.equal(scorer.profileA.summary.supportedDetections, 0);
  // Truth still says AC-3 is violated; the finding is nevertheless unsupported.
  assert.equal(scorer.profileA.findings[0].truthComparison, "matches");
});

test("WP8-A admission: truth alone never creates a supported detection", () => {
  // An unmapped finding on a truth-violated candidate is not a detection.
  const { decision, scorer } = admit({
    candidateId: "S1-C3",
    findings: [finding({ criterionMapping: null })],
  });
  assert.equal(decision.findings[0].mappingStatus, "unmapped");
  assert.equal(decision.findings[0].admitted, false);
  assert.equal(decision.findings[0].supportedDetection, false);
  assert.equal(scorer.profileA.summary.unmapped, 1);
  assert.equal(scorer.profileA.summary.supportedDetections, 0);
});

test("WP8-A admission: unmapped, out-of-scope and skipped findings stay visible but unadmitted", () => {
  const { decision } = admit({
    candidateId: "S1-C3",
    findings: [
      finding({ criterionMapping: null }),
      finding({ criterionMapping: "AC-99" }),
      finding({ skipped: true, skipReason: "duplicate" }),
    ],
  });
  assert.equal(decision.findings[0].mappingStatus, "unmapped");
  assert.equal(decision.findings[1].mappingStatus, "out-of-scope");
  assert.equal(decision.findings[2].skipped, true);
  for (const f of decision.findings) {
    assert.equal(f.admitted, false, f.reason);
    assert.equal(f.supportedDetection, false);
  }
  // The review execution itself is still valid evidence; no finding is admitted.
  assert.equal(decision.admitted, true, decision.reason);
  assert.equal(decision.admittedFindings, 0);
  // The skipped finding is not "delivered", so it is counted as skipped rather
  // than as a rejected delivered finding.
  assert.equal(decision.deliveredFindings, 2);
  assert.equal(decision.rejectedFindings, 2);
  assert.equal(decision.findings.length, 3);
});
