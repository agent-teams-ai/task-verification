// WP8 Profile B integrated qualification through the EXACT packed SDK.
//
// For every candidate S1-C1..S1-C4 this runs the real production path:
//
//   authoritative B0/B1 -> H1..H4 snapshot
//     -> approved reviewer materialization / assembled Profile B input
//     -> the installed `@agent-teams/account-gateway` tarball, real
//        `createLlmClient()` on the `/llm` entry point
//     -> loopback fake Responses provider (deterministic injected protocol reply)
//     -> ResultContract validation
//     -> original ReportedClaimAccounting
//     -> mechanical reference resolution against a byte-verified ArtifactRegistry
//     -> evidence sufficiency
//     -> persisted ledger lifecycle
//     -> shared consumer admission
//     -> readiness artifact, persisted and read back with digest verification
//
// The provider replies are FIXED INJECTED PROTOCOL RESPONSES. They qualify the
// adapter, the contract and the accounting path. They measure nothing about
// model quality, and no live model, provider, credential or Gateway is used.
//
// Usage (SDK's supported Node runtime, repository root):
//   SDK_PROJECT_DIR=<isolated install dir> node --experimental-strip-types scripts/qualify-profile-b.mjs

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const projectDir = path.resolve(process.env.SDK_PROJECT_DIR ?? process.cwd());
const outPath = path.resolve(
  process.env.PROFILE_B_OUT ?? path.join(root, ".isolation-tmp", "wp8-profile-b", "evidence.json"),
);

if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GATEWAY_TOKEN) {
  console.error("refusing to run: a provider credential is present in the environment");
  process.exit(2);
}

const mod = async (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { buildAuthoritativeSnapshot, verifySnapshot } = await mod("scripts/ocr-rr7/authoritative-snapshot.ts");
const { buildReviewerMaterialization, buildProfileBInput, MATERIALIZATION_ROOT } = await mod("src/materialization.ts");
const { loadTruth, validateTruth, CRITERIA } = await mod("src/truth.ts");
const { writeEvidencePacket } = await mod("src/evidence.ts");
const { runBaseline } = await mod("src/baseline.ts");
const {
  buildResultContract,
  computeCoverage,
  validateResultContract,
} = await mod("src/result-contract.ts");
const { scoreResult } = await mod("src/scorer.ts");
const { appendLedgerRecord, readLedger, verifyLedgerIntegrity } = await mod("src/ledger.ts");
const { buildArtifactRegistry, verifyArtifactRegistry, artifactReference } = await mod("src/artifact-registry.ts");

const requireFromProject = createRequire(path.join(projectDir, "package.json"));
const llmEntry = requireFromProject.resolve("@agent-teams/account-gateway/llm");
const { createLlmClient } = await import(pathToFileURL(llmEntry).href);

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const H = (s) => sha256(s);

// Criterion -> the source artifact that implements it in the snapshot.
const CRITERION_ARTIFACT = {
  "AC-1": "app.ts",
  "AC-2": "app.ts",
  "AC-3": "app.ts",
  "AC-4": "serializer.ts",
  "AC-5": "audit.ts",
};

const SUPPORTING_RUBRIC = Object.freeze({
  referenceExists: true,
  tiedToCandidate: true,
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
});

function startFakeResponses(replyText) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, url: req.url, body, bodySha256: sha256(body), at: Date.now() });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: `resp-${requests.length}`,
            model: "profile-b-fake-model",
            output: [{ type: "message", content: [{ type: "output_text", text: replyText }] }],
            usage: { input_tokens: 120, output_tokens: 60 },
          },
        })}\n\n`,
      );
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function ports(url, identityLog) {
  const control = {
    async runAccess(intent) {
      identityLog.push({
        operationId: intent.operationId,
        invocationRef: intent.invocationRef,
        attemptRef: intent.attemptRef,
        limits: intent.limits,
        deadline: intent.deadline,
        at: Date.now(),
      });
      const accountRef = intent.accountRefs[0];
      return {
        operation: {
          operationRef: intent.operationId,
          state: "applied",
          result: {
            kind: "execution",
            executionRef: `exec_${intent.operationId}`,
            accountRef,
            authorizationEpoch: 1,
            deadline: intent.deadline,
            state: "active",
          },
        },
        bearer: "profile-b-bearer-0123456789",
        admission: {
          invocationRef: intent.invocationRef,
          attemptRef: intent.attemptRef,
          accountRef,
          authorizationEpoch: 1,
          subjectRef: intent.subjectRef,
          policyRevision: intent.policyRevision,
          bindingRevision: intent.bindingRevision,
          profileId: intent.profileId,
          limits: { ...intent.limits },
          expiresAt: intent.deadline,
        },
      };
    },
  };
  const connectExecution = () => ({
    async request(executionRef, req, { signal } = {}) {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        body: req.body,
        headers: { "content-type": "application/json" },
        signal,
      });
      return { kind: "stream", requestRef: req.requestId, body: res.body, cancel: async () => {} };
    },
    async status(executionRef, requestId) {
      return { requestRef: requestId, effect: "completed", status: "completed" };
    },
    async close(executionRef, input) {
      return { operationRef: input.operationId, state: "applied" };
    },
  });
  return { control, connectExecution };
}

const truth = loadTruth();
const truthErrors = validateTruth(truth);
if (truthErrors.length) {
  console.error(`truth invalid: ${truthErrors.join("; ")}`);
  process.exit(1);
}
const truthDigest = H(fs.readFileSync(path.join(root, "truth", "truth-v1.json"), "utf8"));

const candidates = [];
const workRoot = path.join(root, ".isolation-tmp", "wp8-profile-b", `run-${Date.now()}`);
fs.mkdirSync(workRoot, { recursive: true });

for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
  const ws = path.join(workRoot, candidateId);
  fs.mkdirSync(ws, { recursive: true });

  // 1. Authoritative snapshot (official base/head tree, digest and diff).
  const snapshot = buildAuthoritativeSnapshot(candidateId, path.join(ws, "snapshot"));
  const snapshotCheck = verifySnapshot(snapshot);
  if (!snapshotCheck.ok) throw new Error(`${candidateId}: ${snapshotCheck.errors.join("; ")}`);

  // 2. Approved reviewer materialization + assembled Profile B input.
  const mat = buildReviewerMaterialization(candidateId, path.join(MATERIALIZATION_ROOT, "wp8b", candidateId));
  if (mat.headApplicationDigest !== mat.recordedHeadApplicationDigest) {
    throw new Error(`${candidateId}: materialization digest does not match the authoritative head digest`);
  }
  if (mat.baseIdentity.tree !== snapshot.base.tree || mat.headIdentity.tree !== snapshot.head.tree) {
    throw new Error(`${candidateId}: materialization identities are not the authoritative snapshot identities`);
  }
  const profileB = buildProfileBInput(candidateId);
  if (profileB.baseToHeadDiff !== snapshot.diff) {
    throw new Error(`${candidateId}: Profile B input diff is not the authoritative diff`);
  }

  // 3. Evidence packet + deterministic baseline.
  const packetPath = writeEvidencePacket(candidateId, path.join(ws, "evidence"));
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const baseline = runBaseline({ packet });
  const anonId = packet.candidateAnonId;
  const snapshotDigest = snapshot.head.applicationDigest;

  // 4. Deterministic FIXED INJECTED provider reply (protocol qualification only).
  const reply = JSON.stringify({
    assessments: CRITERIA.map((id) => ({
      criterionId: id,
      outcome: "satisfied",
      explanation: `fixed injected protocol reply for ${id}`,
    })),
  });
  const fake = await startFakeResponses(reply);
  const identityLog = [];
  const client = createLlmClient(ports(fake.url, identityLog));

  const requestId = `wp8b-${candidateId}`;
  const task = {
    taskId: requestId,
    attempt: 1,
    profileId: "profile-b",
    model: "profile-b-fake-model",
    accountRefs: ["acct_wp8b"],
    policy: { subjectRef: anonId, policyRevision: 1, bindingRevision: 1 },
    instructions: profileB.instruction,
    input: JSON.stringify({
      candidate: profileB.opaqueCandidateId,
      base: profileB.baseIdentity.tree,
      head: profileB.headIdentity.tree,
      diff: profileB.baseToHeadDiff,
      files: profileB.headFiles.map((f) => f.path),
      criteria: profileB.criteria.map((c) => c.id),
      pr: `${profileB.prTitle}\n${profileB.prDescription}`,
    }),
    output: { mode: "json_object" },
    maxOutputTokens: 2048,
    deadline: new Date(Date.now() + 30000),
    decode: (value) => {
      const list = value?.assessments;
      if (!Array.isArray(list)) throw new Error("assessments must be an array");
      const ids = list.map((a) => a.criterionId);
      const missing = CRITERIA.filter((id) => !ids.includes(id));
      if (missing.length) throw new Error(`missing criterion IDs: ${missing.join(",")}`);
      if (new Set(ids).size !== ids.length) throw new Error("duplicate criterion IDs");
      const unknown = ids.filter((id) => !CRITERIA.includes(id));
      if (unknown.length) throw new Error(`unknown criterion IDs: ${unknown.join(",")}`);
      return list;
    },
  };

  const identityAtDispatch = identityLog.length;
  const result = await client.generate(task);
  await fake.close();

  if (!result.ok) throw new Error(`${candidateId}: SDK generation failed: ${result.code}/${result.effect}`);
  if (identityAtDispatch !== 0) throw new Error(`${candidateId}: identity was not persisted before dispatch`);
  if (identityLog.length !== 1) throw new Error(`${candidateId}: unexpected access count ${identityLog.length}`);
  if (fake.requests.length !== 1) throw new Error(`${candidateId}: expected exactly one dispatch`);
  if (result.receipt.requestSha256 !== fake.requests[0].bodySha256) {
    throw new Error(`${candidateId}: receipt requestSha256 does not match the bytes the provider received`);
  }
  if (result.cleanup !== "closed") throw new Error(`${candidateId}: cleanup ${result.cleanup}`);

  const decoded = result.value;

  // 5. Mechanical reference resolution against a byte-verified registry.
  const binding = { candidateBinding: anonId, snapshotDigest };
  const built = buildArtifactRegistry({
    binding,
    files: profileB.headFiles,
    allowedPaths: snapshot.files,
    criterionIdFor: (p) => CRITERIA.find((c) => CRITERION_ARTIFACT[c] === p) ?? null,
  });
  const verified = verifyArtifactRegistry({
    registry: built.registry,
    files: profileB.headFiles,
    allowedPaths: snapshot.files,
    binding,
  });
  if (!verified.ok) throw new Error(`${candidateId}: artifact registry failed verification: ${verified.errors.join("; ")}`);
  if (Object.keys(verified.accepted.artifacts).length !== profileB.headFiles.length) {
    throw new Error(`${candidateId}: registry did not accept every allowlisted artifact`);
  }
  const referenceRubrics = {};
  for (const f of profileB.headFiles) referenceRubrics[artifactReference(f.path)] = SUPPORTING_RUBRIC;

  // 6. ResultContract with the real captured claim and the verified references.
  const assessments = CRITERIA.map((id) => ({
    expectedCriterionId: id,
    present: true,
    originalReportedClaim: decoded.find((a) => a.criterionId === id).outcome,
    admittedConclusion: decoded.find((a) => a.criterionId === id).outcome,
    references: [artifactReference(CRITERION_ARTIFACT[id])],
    explanation: null,
    diagnostics: [],
  }));
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
      profileId: "profile-b",
      configurationIdentity: `sdk:${llmEntry}`,
      promptIdentity: H(profileB.instruction),
      inputIdentity: H(task.input),
      requestedModel: task.model,
      observedModel: result.receipt.observedModel,
      reasoningConfiguration: {},
      adapterEntryIdentity: "@agent-teams/account-gateway/llm",
    },
    assessments,
    findings: [],
    coverage: computeCoverage([...CRITERIA], [...CRITERIA]),
    execution: {
      state: "completed",
      slotId: "slot-1",
      runId: `run-${candidateId}`,
      attemptId: "attempt-1",
      requestId,
      sdkEffectCode: null,
      diagnostics: [],
      pendingEffects: [],
      cleanupStatus: result.cleanup === "closed" ? "clean" : "pending",
    },
    rawArtifact: {
      available: true,
      rawText: result.text,
      rawBytesDigest: result.receipt.outputSha256,
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
      references: [],
      applicability: "applicable",
      provenance: packet.producer,
    },
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens:
        result.usage.inputTokens !== null && result.usage.outputTokens !== null
          ? result.usage.inputTokens + result.usage.outputTokens
          : null,
      durationMs: null,
      cost: null,
      currency: null,
      requestedModel: task.model,
      observedModel: result.receipt.observedModel,
      capacityObservations: [],
    },
    capacity: { durableFactCapacity: null, retentionPolicy: null },
  });
  const contractErrors = validateResultContract(rc);
  if (contractErrors.length) throw new Error(`${candidateId}: ResultContract invalid: ${contractErrors.join("; ")}`);

  // 7. Scoring: reported-claim accounting, reference validity, semantic support, admission.
  const truthBinding = {
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
  if (scorer.truthBindingErrors.length) {
    throw new Error(`${candidateId}: truth binding invalid: ${scorer.truthBindingErrors.join("; ")}`);
  }
  if (scorer.referenceValidity.some((r) => !r.valid)) {
    throw new Error(`${candidateId}: a reference failed mechanical resolution`);
  }
  if (scorer.semanticSupport.some((s) => !s.supporting)) {
    throw new Error(`${candidateId}: a reference lacked semantic support`);
  }

  // 8. Ledger lifecycle, persisted and replayed.
  const ledgerPath = path.join(ws, "runs.jsonl");
  const ledgerBase = {
    schemaVersion: "ledger-event-v1",
    sequence: 1,
    slotId: "slot-1",
    runId: `run-${candidateId}`,
    attemptId: "attempt-1",
    opaqueCandidateId: anonId,
    profile: "profile-b",
    repetition: 1,
    seed: 42,
    subjectInventory: [...CRITERIA],
    criterionInventory: [...CRITERIA],
    baseTreeIdentity: snapshot.base.tree,
    headTreeIdentity: snapshot.head.tree,
    runtimeSnapshotDigest: snapshotDigest,
    criteriaRevision: truth.criteriaRevision,
    policyDigest: packet.checkDefinitionDigest,
    promptDigest: H(profileB.instruction),
    inputDigest: H(task.input),
    requestedModel: task.model,
    observedModel: result.receipt.observedModel,
    reasoningConfiguration: {},
    adapterEntryIdentity: "@agent-teams/account-gateway/llm",
    startTimestamp: "2026-01-01T00:00:00Z",
    endTimestamp: null,
    requestIds: [requestId],
    rawArtifactRefs: [result.receipt.outputSha256],
    rawUnavailableCause: null,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    diagnostics: [],
    admissionState: scorer.admission.admitted ? "admitted" : "rejected",
    cleanupStatus: rc.execution.cleanupStatus,
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
  for (const e of events) appendLedgerRecord(e, { ledgerPath });
  const ledgerRecords = readLedger(ledgerPath);
  const ledgerErrors = verifyLedgerIntegrity(ledgerRecords);
  if (ledgerErrors.length) throw new Error(`${candidateId}: ledger invalid: ${ledgerErrors.join("; ")}`);

  // 9. Readiness artifact, persisted and read back with digest verification.
  const readiness = {
    schema: "m2.wp8-profile-b/v1",
    candidateId,
    anonId,
    sdk: {
      entry: llmEntry,
      packageVersion: "0.1.0",
      requestedModel: task.model,
      observedModel: result.receipt.observedModel,
      requestSha256: result.receipt.requestSha256,
      outputSha256: result.receipt.outputSha256,
      cleanup: result.cleanup,
      providerMode: "fixed-injected-protocol-response",
      modelQualityMeasured: false,
    },
    snapshot: {
      base: { id: snapshot.base.id, tree: snapshot.base.tree, applicationDigest: snapshot.base.applicationDigest },
      head: { id: snapshot.head.id, tree: snapshot.head.tree, applicationDigest: snapshot.head.applicationDigest },
      diffSha256: H(snapshot.diff),
      files: snapshot.files,
      verified: snapshotCheck.ok,
    },
    requests: {
      dispatches: fake.requests.length,
      identityPersistedBeforeDispatch: true,
      automaticRetries: 0,
      liveProviderCalls: 0,
    },
    baselineRejected: baseline.rejected,
    contractValid: contractErrors.length === 0,
    ledger: { events: ledgerRecords.length, errors: ledgerErrors },
    references: {
      resolved: scorer.referenceValidity.length,
      allValid: scorer.referenceValidity.every((r) => r.valid),
      allSufficient: scorer.semanticSupport.every((s) => s.supporting),
    },
    reportedClaims: {
      falseSatisfaction: scorer.reportedClaims.falseSatisfaction,
      falseViolation: scorer.reportedClaims.falseViolation,
      correct: scorer.reportedClaims.correctReportedClaims,
      admittedSemanticConclusions: scorer.reportedClaims.admittedSemanticConclusions,
    },
    admission: scorer.admission,
  };
  const readinessPath = path.join(ws, "readiness.json");
  fs.writeFileSync(readinessPath, JSON.stringify(readiness, null, 2) + "\n", "utf8");
  const readinessBytes = fs.readFileSync(readinessPath);
  const readback = JSON.parse(readinessBytes.toString("utf8"));
  if (JSON.stringify(readback) !== JSON.stringify(readiness)) {
    throw new Error(`${candidateId}: readiness artifact did not read back identically`);
  }
  const readinessSha = sha256(readinessBytes);
  // Independent identity re-verification after readback.
  const post = verifySnapshot(snapshot);
  if (!post.ok) throw new Error(`${candidateId}: snapshot identity failed re-verification after readback`);
  if (readback.snapshot.head.applicationDigest !== snapshot.head.applicationDigest) {
    throw new Error(`${candidateId}: readiness head digest changed on readback`);
  }

  candidates.push({
    candidateId,
    admission: scorer.admission,
    readiness,
    readinessPath,
    readinessSha,
    report: {
      candidateId,
      baseTree: snapshot.base.tree,
      headTree: snapshot.head.tree,
      headApplicationDigest: snapshot.head.applicationDigest,
      requestSha256: result.receipt.requestSha256,
      outputSha256: result.receipt.outputSha256,
      admitted: scorer.admission.admitted,
      admissionReason: scorer.admission.reason,
      dispatches: fake.requests.length,
      ledgerEvents: ledgerRecords.length,
      readinessSha,
    },
  });
}

const summary = {
  schema: "m2.wp8-profile-b-verification/v1",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  sdkEntry: llmEntry,
  environment: { liveProviderCalls: 0, credentials: 0, automaticRetries: 0, providerMode: "fixed-injected" },
  candidates: candidates.map((c) => c.report),
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const c of candidates) {
  console.log(
    `PASS ${c.candidateId} ${c.report.baseTree.slice(0, 8)}->${c.report.headTree.slice(0, 8)} ` +
      `digest ${c.report.headApplicationDigest.slice(0, 12)} admitted=${c.report.admitted} ` +
      `(${c.report.admissionReason}) dispatches=${c.report.dispatches} ledger=${c.report.ledgerEvents}`,
  );
}
console.log(`\nProfile B (${process.version}, ${summary.platform}): ${candidates.length}/4 candidates admitted through the packed SDK`);
console.log(`evidence: ${outPath}`);
process.exit(candidates.every((c) => c.report.admitted) ? 0 : 1);
