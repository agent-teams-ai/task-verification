/**
 * WP8-A — Profile A integrated execution against the EXACT rr.7 binary and the
 * AUTHORITATIVE candidate snapshots.
 *
 * Opt-in: runs only on Linux with the approved rr.7 assets (OCR_RR7_DIR).
 *
 * For every candidate S1-C1..S1-C4 the reviewed subject is the official
 * B0/B1 -> H1..H4 materialization: the recorded Git trees/commits, the official
 * application snapshot digest, the exact official base-to-head diff and exactly
 * the allowlisted application files. Nothing here invents a synthetic commit,
 * substitutes a stub for `app.ts`, or generates an unrelated diff: a synthetic
 * repository is never reported as a candidate identity.
 *
 * The provider replies are FIXED INJECTED PROTOCOL RESPONSES used to qualify
 * the adapter, the parser/normalizer, the artifact registry and the admission
 * path. They measure nothing about reviewer reasoning or model quality.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import {
  buildAuthoritativeSnapshot,
  verifySnapshot,
  type AuthoritativeSnapshot,
} from "../../scripts/ocr-rr7/authoritative-snapshot.ts";
import {
  buildReviewerMaterialization,
  FROZEN_CRITERIA,
  MATERIALIZATION_ROOT,
  opaqueId,
} from "../../src/materialization.ts";
import { loadTruth, validateTruth, CRITERIA } from "../../src/truth.ts";
import { writeEvidencePacket } from "../../src/evidence.ts";
import { runBaseline } from "../../src/baseline.ts";
import {
  buildResultContract,
  computeCoverage,
  validateResultContract,
  type ExecutionRecord,
  type FindingRecord,
} from "../../src/result-contract.ts";
import { scoreResult, type RubricDecision, type TruthBinding } from "../../src/scorer.ts";
import { appendLedgerRecord, readLedger, verifyLedgerIntegrity } from "../../src/ledger.ts";
import { admitProfileAFindings, type ProfileAAdmissionDecision } from "../../src/profile-a-admission.ts";
import { artifactReference, buildArtifactRegistry, verifyArtifactRegistry } from "../../src/artifact-registry.ts";
import {
  MAX_OCR_INPUT_CHARS,
  renderOcrReviewerInput,
  runOcrProfileA,
  type OcrReviewerInputFields,
} from "../../src/ocr-profile-a.ts";
import { runManagedOcr, tmpRoot } from "../../scripts/ocr-rr7/native-runner.ts";
import { pinnedParser, requireRr7, RR7_BINARY, ROOT } from "./harness.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const SUPPORTING: RubricDecision = {
  referenceExists: true,
  tiedToCandidate: true,
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
};

// A frozen rubric decision asserting the cited artifact does NOT support a
// violation claim for that criterion. Declared input, never derived from Truth.
const NON_SUPPORTING: RubricDecision = {
  referenceExists: true,
  tiedToCandidate: true,
  supportsBehavior: false,
  coversSubclauses: false,
  relevantCurrentApplicable: true,
  contradictsClaim: true,
};

interface InjectedFinding {
  criterion: string | null;
  content: string;
}

/**
 * Fixed injected protocol findings per candidate. C3's comment names the
 * criterion that is actually violated; C1/C2/C4 name a criterion that Truth
 * reports as satisfied, so a naive "Truth says violated" reading would be wrong.
 */
const INJECTED: Record<string, InjectedFinding[]> = {
  "S1-C1": [{ criterion: "AC-2", content: "AC-2: the missing-credential path does not return 401 without profile fields." }],
  "S1-C2": [{ criterion: "AC-2", content: "AC-2: the delegated handler answers before the credential check." }],
  "S1-C3": [{ criterion: "AC-3", content: "AC-3: the revocation list is never consulted before serving the profile." }],
  "S1-C4": [
    { criterion: "AC-2", content: "AC-2: the credential check answers after the profile is serialized." },
    { criterion: null, content: "The helper naming here could be clearer." },
  ],
};

interface CandidateRun {
  snapshot: AuthoritativeSnapshot;
  reviewerInput: string;
  details: Awaited<ReturnType<typeof runOcrProfileA>>["details"];
  findings: FindingRecord[];
  decision: ProfileAAdmissionDecision;
  admissionPersisted: ProfileAAdmissionDecision;
  readiness: Record<string, unknown>;
  readinessSha: string;
  ledgerEvents: number;
  requestCount: number;
  scorer: ReturnType<typeof scoreResult>;
}

async function runCandidate(candidateId: string): Promise<CandidateRun> {
  const ws = tmpRoot(`wp8a-${candidateId}-`);
  const truth = loadTruth();
  assert.deepEqual(validateTruth(truth), []);

  // 1. Authoritative snapshot: official base/head trees, digest and diff.
  const snapshot = buildAuthoritativeSnapshot(candidateId, path.join(ws, "snapshot"));
  const snapshotCheck = verifySnapshot(snapshot);
  assert.equal(snapshotCheck.ok, true, snapshotCheck.errors.join("; "));

  // 2. Approved reviewer materialization must be the SAME snapshot.
  const mat = buildReviewerMaterialization(candidateId, path.join(MATERIALIZATION_ROOT, "wp8a", `${candidateId}-${path.basename(ws)}`));
  assert.equal(mat.baseIdentity.tree, snapshot.base.tree, `${candidateId}: materialization base tree`);
  assert.equal(mat.headIdentity.tree, snapshot.head.tree, `${candidateId}: materialization head tree`);
  assert.equal(mat.baseIdentity.commit, snapshot.base.commit);
  assert.equal(mat.headIdentity.commit, snapshot.head.commit);
  assert.equal(mat.headApplicationDigest, mat.recordedHeadApplicationDigest);
  assert.equal(mat.headApplicationDigest, snapshot.head.applicationDigest);

  // 3. Exactly the allowlisted inventory: the six application files.
  assert.deepEqual(
    [...snapshot.files].sort(),
    ["app.ts", "audit.ts", "authz.ts", "behavior.ts", "serializer.ts", "types.ts"],
    `${candidateId}: application inventory`,
  );

  // 4. Reviewer input carrying the authoritative identities and official diff.
  const fields: OcrReviewerInputFields = {
    candidateAlias: mat.opaqueId,
    sourceIdentity: `authoritative ${snapshot.base.id}..${snapshot.head.id}`,
    base: snapshot.base.tree,
    head: snapshot.head.tree,
    diff: snapshot.diff,
    task: "Implement GET /profile with bearer-token authorization and audit logging.",
    criteria: FROZEN_CRITERIA,
    background: "model-free Profile A qualification against the authoritative snapshot",
    rules: "Report only issues introduced by the base-to-head diff.",
  };
  const reviewerInput = renderOcrReviewerInput(fields);
  assert.ok(reviewerInput.length <= MAX_OCR_INPUT_CHARS, `${candidateId}: reviewer input ${reviewerInput.length}`);
  // Complete task and complete criteria text.
  for (const c of FROZEN_CRITERIA) {
    assert.ok(reviewerInput.includes(`${c.id}: ${c.text}`), `${candidateId}: missing criterion ${c.id}`);
  }
  assert.ok(reviewerInput.includes("Implement GET /profile"), `${candidateId}: missing task`);

  // 5. Evidence packet + deterministic baseline.
  const packetPath = writeEvidencePacket(candidateId, path.join(ws, "evidence"));
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const baseline = runBaseline({ packet });
  assert.equal(baseline.rejected, false, `${candidateId}: baseline rejected the packet`);
  const anonId = packet.candidateAnonId;
  const snapshotDigest = snapshot.head.applicationDigest;

  // 6. Byte-verified artifact registry bound to this candidate and snapshot.
  const artifactFiles = Object.entries(snapshot.headFiles).map(([p, content]) => ({ path: p, content }));
  const binding = { candidateBinding: anonId, snapshotDigest };
  const built = buildArtifactRegistry({ binding, files: artifactFiles, allowedPaths: snapshot.files });
  const verified = verifyArtifactRegistry({
    registry: built.registry,
    files: artifactFiles,
    allowedPaths: snapshot.files,
    binding,
  });
  assert.deepEqual(built.rejected, [], `${candidateId}: allowlisted file rejected`);
  assert.equal(verified.ok, true, `${candidateId}: ${verified.errors.join("; ")}`);

  // 7. Real rr.7 execution through the Profile A adapter with identity binding.
  const anchor =
    snapshot.headFiles["app.ts"]
      .split("\n")
      .find((l) => l.includes("missing_credential")) ??
    snapshot.headFiles["app.ts"].split("\n").find((l) => l.trim().length > 0) ??
    "";
  const comments = INJECTED[candidateId].map((f) => ({
    path: "app.ts",
    content: f.content,
    existing_code: anchor,
    severity: "high",
  }));

  const dispatchLog: { requestId: string; profile: "A" | "B"; dispatchedAt: number }[] = [];
  const { details } = await runOcrProfileA({
    requestId: `wp8a-${candidateId}`,
    reviewerInput,
    reviewerFields: fields,
    identity: { base: snapshot.base.tree, head: snapshot.head.tree, diff: snapshot.diff, allowedPaths: snapshot.files },
    execution: {
      async run({ reviewerInput: ri }) {
        const ev = await runManagedOcr({
          binary: RR7_BINARY,
          root: ws,
          repo: snapshot.repo,
          base: snapshot.base.commit,
          head: snapshot.head.commit,
          reviewerInput: ri,
          rule: {
            merge_system_rule: true,
            include: [...snapshot.files],
            rules: [{ id: "rr7-wp8a", content: "Report only issues introduced by the base-to-head diff." }],
          },
          scenario: "finding",
          comments,
        });
        assert.equal(ev.exit_code, 0, `${candidateId}: ${ev.stderr}`);
        assert.equal(ev.native.status, "complete", candidateId);
        // The native manifest must report the authoritative commits.
        assert.equal(ev.native.manifest.input.resolved_base, snapshot.base.commit, `${candidateId}: resolved base`);
        assert.equal(ev.native.manifest.input.resolved_head, snapshot.head.commit, `${candidateId}: resolved head`);
        return {
          native: ev.native,
          baseSha: ev.repo_base,
          mergeBaseSha: ev.repo_base,
          headSha: ev.repo_head,
          requestCount: ev.request_count,
          diagnostics: ev.native_error ? [ev.native_error] : [],
        };
      },
    },
    parser: pinnedParser,
    expectedCriterionIds: [...CRITERIA],
    headFiles: new Map(Object.entries(snapshot.headFiles)),
    assignedPaths: [...snapshot.files],
    dispatchLog,
  });

  assert.equal(dispatchLog.length, 1, `${candidateId}: exactly one dispatch`);
  assert.equal(details.terminalState, "complete");
  assert.ok(details.requestCount >= 1);

  // 8. Attach the finding's cited source artifact (mechanical reference).
  const findings: FindingRecord[] = [];
  let normalizedCursor = 0;
  for (const f of details.findings) {
    const deliveredOrSkipped = f.skipped || f.normalizedFinding !== null;
    const normalized = deliveredOrSkipped && !f.skipped ? details.normalized[normalizedCursor++] : undefined;
    const file = normalized?.file ?? "app.ts";
    const exists = snapshot.files.includes(file);
    findings.push({ ...f, references: exists ? [artifactReference(file)] : [] });
  }
  assert.ok(findings.length >= INJECTED[candidateId].length, `${candidateId}: lost findings`);

  // 9. ResultContract: Profile A carries findings, never criterion verdicts.
  const execution: ExecutionRecord = {
    state: "completed",
    slotId: "slot-1",
    runId: `run-${candidateId}`,
    attemptId: "attempt-1",
    requestId: `wp8a-${candidateId}`,
    sdkEffectCode: null,
    diagnostics: [],
    pendingEffects: [],
    cleanupStatus: "clean",
  };
  const rc = buildResultContract({
    subject: { fixtureTaskId: "task-1", expectedSubjectInventory: [...CRITERIA] },
    candidate: {
      repositoryMaterializationId: anonId,
      baseTreeIdentity: snapshot.base.tree,
      headTreeIdentity: snapshot.head.tree,
      runtimeSnapshotDigest: snapshotDigest,
      opaqueFixtureId: anonId,
    },
    criteria: {
      authoredCriteriaRevision: truth.criteriaRevision,
      criteriaTextDigest: H(truth.criteriaRevision),
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: packet.checkDefinitionDigest,
    },
    profile: {
      profileId: "profile-a",
      configurationIdentity: "rr7-managed",
      promptIdentity: H(fields.rules),
      inputIdentity: H(reviewerInput),
      requestedModel: "rr7-fake-model",
      observedModel: "rr7-fake-model",
      reasoningConfiguration: { effort: "medium" },
      adapterEntryIdentity: "ocr-v1.13.1-rr.7",
    },
    assessments: [],
    findings,
    coverage: computeCoverage([...CRITERIA], []),
    execution,
    rawArtifact: {
      available: true,
      rawText: JSON.stringify(details.native),
      rawBytesDigest: H(JSON.stringify(details.native)),
      rawUnavailableCause: null,
    },
    evidence: {
      producer: "oracle-O-1",
      candidateBinding: anonId,
      checkDefinition: packet.checkDefinitionDigest,
      inputScope: packet.inputsScope,
      environment: packet.environment,
      observationOutcome: "complete",
      completeness: packet.completeness,
      timestamps: packet.observationTime ? [packet.observationTime] : [],
      references: Object.keys(verified.accepted.artifacts),
      applicability: "applicable",
      provenance: packet.producer,
    },
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      cost: null,
      currency: null,
      requestedModel: "rr7-fake-model",
      observedModel: "rr7-fake-model",
      capacityObservations: [],
    },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  assert.deepEqual(validateResultContract(rc), [], `${candidateId}: contract invalid`);

  // 10. Scoring with the real registry; Truth digest is the Truth file SHA-256.
  const truthDigest = H(fs.readFileSync(path.join(ROOT, "truth", "truth-v1.json"), "utf8"));
  assert.notEqual(truthDigest, packet.packetId, `${candidateId}: truth digest must not be a packet id`);
  const referenceRubrics: Record<string, RubricDecision> = {
    [artifactReference("app.ts")]: candidateId === "S1-C3" ? SUPPORTING : NON_SUPPORTING,
    [artifactReference("serializer.ts")]: NON_SUPPORTING,
  };
  const truthBinding: TruthBinding = {
    canonicalCandidateId: anonId,
    anonymizedCandidateId: anonId,
    headApplicationDigest: snapshotDigest,
    criteriaRevision: truth.criteriaRevision,
    expectedCriterionInventory: [...CRITERIA],
    truthVersion: "truth-v1",
    truthDigest,
    truthOutcomes: truth.candidateOutcomes[candidateId],
  };
  const scorer = scoreResult({
    resultContract: rc,
    truthBinding,
    referenceRubrics,
    artifactRegistry: verified.accepted,
  });
  assert.deepEqual(scorer.truthBindingErrors, []);
  assert.ok(scorer.profileA.deliveredCount >= 1, `${candidateId}: no finding delivered`);

  // 11. Profile A admission derived from the real scorer output.
  const decision = admitProfileAFindings({
    resultContract: rc,
    scorer,
    registry: verified.accepted,
    allowedPaths: snapshot.files,
    expectedCandidateBinding: anonId,
    expectedSnapshotDigest: snapshotDigest,
    expectedCriteriaRevision: truth.criteriaRevision,
    expectedCriterionIds: [...CRITERIA],
  });

  if (candidateId === "S1-C3") {
    // C3 is the only candidate whose injected finding maps to a violated
    // criterion with supporting evidence.
    assert.equal(decision.admitted, true, decision.reason);
    const supported = decision.findings.filter((f) => f.supportedDetection);
    assert.equal(supported.length, 1, `${candidateId}: expected exactly one supported detection`);
    assert.equal(supported[0].criterionId, "AC-3");
    assert.equal(supported[0].referenceValid, true);
    assert.equal(supported[0].semanticSupported, true);
    assert.deepEqual(scorer.profileA.summary.supportedDetections, 1);
  } else {
    // Truth reports every criterion satisfied, so nothing may be a supported
    // detection; C1/C2's mapped finding is a false allegation.
    assert.deepEqual(decision.supportedDetections, [], `${candidateId}: invented a supported detection`);
    assert.equal(scorer.profileA.summary.falseAllegations >= 1, true, `${candidateId}: expected a false allegation`);
  }
  assert.deepEqual(decision.admittedCriterionIds, [], `${candidateId}: fabricated criterion verdicts`);

  // 12. Ledger lifecycle, persisted and replayed.
  const ledgerPath = path.join(ws, "runs.jsonl");
  const ledgerBase = {
    schemaVersion: "ledger-event-v1",
    sequence: 1,
    slotId: "slot-1",
    runId: `run-${candidateId}`,
    attemptId: "attempt-1",
    opaqueCandidateId: anonId,
    profile: "profile-a",
    repetition: 1,
    seed: 42,
    subjectInventory: [...CRITERIA],
    criterionInventory: [...CRITERIA],
    baseTreeIdentity: snapshot.base.tree,
    headTreeIdentity: snapshot.head.tree,
    runtimeSnapshotDigest: snapshotDigest,
    criteriaRevision: truth.criteriaRevision,
    policyDigest: packet.checkDefinitionDigest,
    promptDigest: H(fields.rules),
    inputDigest: H(reviewerInput),
    requestedModel: "rr7-fake-model",
    observedModel: "rr7-fake-model",
    reasoningConfiguration: { effort: "medium" },
    adapterEntryIdentity: "ocr-v1.13.1-rr.7",
    startTimestamp: "2026-01-01T00:00:00Z",
    endTimestamp: null,
    requestIds: [`wp8a-${candidateId}`],
    rawArtifactRefs: [H(JSON.stringify(details.native))],
    rawUnavailableCause: null,
    usage: {},
    diagnostics: [],
    admissionState: decision.admitted ? "admitted" : "rejected",
    cleanupStatus: "clean",
    isStub: false,
    supersededBy: null,
    supersedes: null,
  };
  const events = [
    { ...ledgerBase, eventId: `evt-${crypto.randomUUID()}`, eventType: "planned", executionState: "planned" },
    { ...ledgerBase, eventId: `evt-${crypto.randomUUID()}`, eventType: "attempt_started", executionState: "started" },
    {
      ...ledgerBase,
      eventId: `evt-${crypto.randomUUID()}`,
      eventType: "attempt_completed",
      executionState: "completed",
      endTimestamp: "2026-01-01T00:00:01Z",
    },
  ];
  for (const e of events) appendLedgerRecord(e as never, { ledgerPath });
  const ledgerRecords = readLedger(ledgerPath);
  assert.deepEqual(verifyLedgerIntegrity(ledgerRecords), [], `${candidateId}: ledger invalid`);
  assert.equal(ledgerRecords.length, 3);

  // 13. Persist the readiness artifact (identities + decision) and read it back.
  const readiness = {
    schema: "m2.wp8-profile-a/v1",
    candidateId,
    anonId,
    snapshot: {
      base: { id: snapshot.base.id, commit: snapshot.base.commit, tree: snapshot.base.tree, digest: snapshot.base.applicationDigest },
      head: { id: snapshot.head.id, commit: snapshot.head.commit, tree: snapshot.head.tree, digest: snapshot.head.applicationDigest },
      diffSha256: H(snapshot.diff),
      files: snapshot.files,
      verified: snapshotCheck.ok,
    },
    materialization: {
      inventory: mat.fileInventory,
      baseTree: mat.baseIdentity.tree,
      headTree: mat.headIdentity.tree,
      headApplicationDigest: mat.headApplicationDigest,
    },
    ocr: {
      binary: "ocr-v1.13.1-rr.7",
      requestCount: details.requestCount,
      terminalState: details.terminalState,
      nativeFindings: details.nativeComments.length,
      normalizedFindings: details.normalized.length,
      skipped: details.skipped.length,
      dropped: details.findings.filter((f) => !f.skipped && f.normalizedFinding === null).length,
      providerMode: "fixed-injected-protocol-response",
      modelQualityMeasured: false,
      liveProviderCalls: 0,
      automaticRetries: 0,
    },
    references: {
      registryEntries: Object.keys(verified.accepted.artifacts).length,
      resolved: scorer.referenceValidity.length,
      allValid: scorer.referenceValidity.every((r) => r.valid),
    },
    truthDigest,
    contractValid: true,
    ledger: { events: ledgerRecords.length, errors: [] as string[] },
    admission: decision,
  };
  const readinessPath = path.join(ws, "readiness.json");
  fs.writeFileSync(readinessPath, JSON.stringify(readiness, null, 2) + "\n", "utf8");
  const readinessBytes = fs.readFileSync(readinessPath);
  const admissionPersisted = JSON.parse(readinessBytes.toString("utf8")).admission as ProfileAAdmissionDecision;
  assert.deepEqual(admissionPersisted, decision, `${candidateId}: admission changed on readback`);

  // Independent identity re-verification after readback.
  const post = verifySnapshot(snapshot);
  assert.equal(post.ok, true, `${candidateId}: identity failed after readback`);
  const persisted = JSON.parse(readinessBytes.toString("utf8"));
  assert.equal(persisted.snapshot.base.tree, loadProvenanceTree(candidateId, "base"));
  assert.equal(persisted.snapshot.head.tree, loadProvenanceTree(candidateId, "head"));
  assert.equal(persisted.materialization.headApplicationDigest, persisted.snapshot.head.digest);

  // Sealing: the materialization never contains sealed material.
  for (const f of mat.fileInventory) {
    for (const bad of ["truth", "scorer", "oracle", "anonymization", "provenance", "MANIFEST"]) {
      assert.ok(!f.toLowerCase().includes(bad.toLowerCase()), `${candidateId}: sealed material ${f}`);
    }
  }

  return {
    snapshot,
    reviewerInput,
    details,
    findings,
    decision,
    admissionPersisted,
    readiness: persisted,
    readinessSha: H(readinessBytes.toString("utf8")),
    ledgerEvents: ledgerRecords.length,
    requestCount: details.requestCount,
    scorer,
  };
}

function loadProvenanceTree(candidateId: string, side: "base" | "head"): string {
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, "candidates", "provenance.json"), "utf8"));
  return all[candidateId][side].tree;
}

test("WP8-A: Profile A runs the exact rr.7 binary end-to-end for S1-C1", async (t) => {
  if (!requireRr7(t)) return;
  const run = await runCandidate("S1-C1");
  assert.equal(run.decision.admitted, true, run.decision.reason);
  assert.equal(run.ledgerEvents, 3);
  assert.equal(run.readiness.contractValid, true);
  assert.equal((run.readiness.ocr as Record<string, unknown>).liveProviderCalls, 0);
  assert.equal((run.readiness.ocr as Record<string, unknown>).modelQualityMeasured, false);
});

test("WP8-A: Profile A runs the exact rr.7 binary for C2, C3 and C4 on authoritative snapshots", async (t) => {
  if (!requireRr7(t)) return;
  for (const candidateId of ["S1-C2", "S1-C3", "S1-C4"]) {
    const run = await runCandidate(candidateId);
    assert.equal(run.snapshot.head.tree, loadProvenanceTree(candidateId, "head"), `${candidateId}: head tree`);
    assert.equal(run.snapshot.base.tree, loadProvenanceTree(candidateId, "base"), `${candidateId}: base tree`);
    assert.equal(run.decision.admitted, true, `${candidateId}: ${run.decision.reason}`);
    assert.deepEqual(run.admissionPersisted, run.decision, `${candidateId}: admission drift`);
    assert.equal(run.scorer.profileA.satisfaction, "not-applicable", `${candidateId}: Profile A verdict invented`);
  }
});

test("WP8-A: a changed Base/Head/Diff identity is rejected before the binary runs", async (t) => {
  if (!requireRr7(t)) return;
  const ws = tmpRoot("wp8a-negative-");
  const snapshot = buildAuthoritativeSnapshot("S1-C3", path.join(ws, "snapshot"));
  const fields: OcrReviewerInputFields = {
    candidateAlias: opaqueId("S1-C3"),
    sourceIdentity: "authoritative",
    base: snapshot.base.tree,
    head: snapshot.head.tree,
    diff: snapshot.diff,
    task: "Implement GET /profile.",
    criteria: FROZEN_CRITERIA,
    background: "negative control",
    rules: "Report only issues introduced by the diff.",
  };
  const identity = {
    base: snapshot.base.tree,
    head: snapshot.head.tree,
    diff: snapshot.diff,
    allowedPaths: snapshot.files,
  };
  const dispatchLog: { requestId: string; profile: "A" | "B"; dispatchedAt: number }[] = [];
  let dispatched = 0;
  const execution = {
    async run(): Promise<never> {
      dispatched++;
      throw new Error("the OCR binary must not run for a mismatched identity");
    },
  };

  for (const tampered of [
    { ...fields, base: "0".repeat(40) },
    { ...fields, head: "0".repeat(40) },
    { ...fields, diff: `${fields.diff}\n+// injected change\n` },
  ]) {
    await assert.rejects(
      runOcrProfileA({
        requestId: "negative",
        reviewerInput: renderOcrReviewerInput(tampered),
        reviewerFields: tampered,
        identity,
        execution,
        parser: pinnedParser,
        expectedCriterionIds: [...CRITERIA],
        headFiles: new Map(Object.entries(snapshot.headFiles)),
        assignedPaths: [...snapshot.files],
        dispatchLog,
      }),
      /authoritative identity/,
    );
  }
  assert.equal(dispatched, 0, "no execution may occur for a rejected identity");
});

test("WP8-A: the pinned parser rejects a native manifest with a different head identity", async (t) => {
  if (!requireRr7(t)) return;
  const ws = tmpRoot("wp8a-parser-negative-");
  const snapshot = buildAuthoritativeSnapshot("S1-C1", path.join(ws, "snapshot"));
  const ev = await runManagedOcr({
    binary: RR7_BINARY,
    root: ws,
    repo: snapshot.repo,
    base: snapshot.base.commit,
    head: snapshot.head.commit,
    reviewerInput: renderOcrReviewerInput({
      candidateAlias: opaqueId("S1-C1"),
      sourceIdentity: "authoritative",
      base: snapshot.base.tree,
      head: snapshot.head.tree,
      diff: snapshot.diff,
      task: "t",
      criteria: FROZEN_CRITERIA,
      background: "b",
      rules: "r",
    }),
    rule: { merge_system_rule: true, include: ["app.ts"], rules: [{ id: "r", content: "r" }] },
    scenario: "unchanged",
  });
  assert.equal(ev.exit_code, 0, ev.stderr);
  const admission = { baseSha: snapshot.base.commit, mergeBaseSha: snapshot.base.commit, headSha: snapshot.head.commit };
  assert.doesNotThrow(() => pinnedParser.parseOcrNativeReviewResult(ev.native, admission));
  assert.throws(() =>
    pinnedParser.parseOcrNativeReviewResult(ev.native, {
      ...admission,
      headSha: "0".repeat(40),
    }),
  );
});
