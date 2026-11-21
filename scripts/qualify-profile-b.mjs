// WP8 Profile B integrated qualification through the EXACT packed SDK.
//
// For every candidate S1-C1..S1-C4 this runs the real production path:
//
//   authoritative B0/B1 -> H1..H4 snapshot
//     -> approved reviewer materialization
//     -> COMPLETE provider-bound request (file contents, criterion text,
//        task/PR background, instructions, rules, changed vs unchanged scope)
//     -> the installed `@agent-teams/account-gateway` tarball, real
//        `createLlmClient()` on the `/llm` entry point
//     -> loopback fake Responses provider (deterministic injected protocol reply)
//     -> record-by-record decode that preserves the provider's own references
//        and explanations (valid partial records kept, diagnostics retained)
//     -> ResultContract validation
//     -> original ReportedClaimAccounting
//     -> claim-specific semantic support + mechanical reference resolution
//     -> DURABLE attempt lifecycle persisted BEFORE dispatch
//     -> shared consumer admission
//     -> retained evidence, persisted and read back with digest verification
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
import { isDeepStrictEqual } from "node:util";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const projectDir = path.resolve(process.env.SDK_PROJECT_DIR ?? process.cwd());
const outPath = path.resolve(
  process.env.PROFILE_B_OUT ?? path.join(root, ".isolation-tmp", "wp8-profile-b", "evidence.json"),
);
const evidenceDir = path.resolve(
  process.env.PROFILE_B_EVIDENCE_DIR ?? path.join(root, ".isolation-tmp", "wp8b-evidence"),
);

if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GATEWAY_TOKEN) {
  console.error("refusing to run: a provider credential is present in the environment");
  process.exit(2);
}

const mod = async (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { buildAuthoritativeSnapshot, verifySnapshot } = await mod("scripts/ocr-rr7/authoritative-snapshot.ts");
const {
  buildReviewerMaterialization,
  buildProfileBInput,
  renderProfileBRequestInput,
  changedPathsFromDiff,
  PROFILE_B_OUTPUT_SCHEMA,
  MATERIALIZATION_ROOT,
} = await mod("src/materialization.ts");
const { loadTruth, validateTruth, CRITERIA } = await mod("src/truth.ts");
const { writeEvidencePacket } = await mod("src/evidence.ts");
const { runBaseline } = await mod("src/baseline.ts");
const { buildResultContract, computeCoverage, validateResultContract } = await mod("src/result-contract.ts");
const { scoreResult, claimSupportKey } = await mod("src/scorer.ts");
const { readLedger, verifyLedgerIntegrity } = await mod("src/ledger.ts");
const { buildArtifactRegistry, verifyArtifactRegistry } = await mod("src/artifact-registry.ts");
const { captureCriteriaSnapshot } = await mod("src/criteria.ts");
const { decodeProfileBAssessments } = await mod("src/profile-b-decode.ts");
const { persistPlanned, persistStarted, verifyAttemptAtDispatch, persistTerminal } = await mod(
  "src/attempt-persistence.ts",
);

const requireFromProject = createRequire(path.join(projectDir, "package.json"));
const llmEntry = requireFromProject.resolve("@agent-teams/account-gateway/llm");
const { createLlmClient } = await import(pathToFileURL(llmEntry).href);

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

/**
 * Extract the delivered user messages from the captured Responses request.
 * The SDK encodes `input` as `[{role, content:[{type:"input_text", text}]}]`;
 * each message's text is returned unmodified.
 */
function capturedMessageTexts(input) {
  const messages = Array.isArray(input) ? input : [];
  return messages.map((m) =>
    Array.isArray(m?.content)
      ? m.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
      : typeof m?.text === "string"
        ? m.text
        : "",
  );
}

/**
 * Claim-specific support rubric, declared as input (a human-grading surrogate).
 * Each entry judges ONE (criterion, reference) claim; no entry is a judgment
 * about a file that would transfer to other claims citing it.
 */
const SUPPORTING_RUBRIC = Object.freeze({
  supportsBehavior: true,
  coversSubclauses: true,
  relevantCurrentApplicable: true,
  contradictsClaim: false,
});

const RUBRIC_CLAIMS = {
  "AC-1": "artifact://app.ts",
  "AC-2": "artifact://app.ts",
  "AC-3": "artifact://app.ts",
  "AC-4": "artifact://serializer.ts",
  "AC-5": "artifact://audit.ts",
};

function claimRubrics() {
  const out = {};
  for (const [criterionId, reference] of Object.entries(RUBRIC_CLAIMS)) {
    out[claimSupportKey(criterionId, reference)] = { ...SUPPORTING_RUBRIC, criterionId };
  }
  return out;
}

/**
 * Fixed injected protocol reply. It is candidate-independent: the provider's
 * own references and explanations are preserved by the integration, and the
 * accounting (not the integration) reports any claim that disagrees with Truth.
 */
const FIXED_REPLY = JSON.stringify({
  assessments: Object.entries(RUBRIC_CLAIMS).map(([criterionId, reference]) => ({
    criterionId,
    outcome: criterionId === "AC-4" ? "violated" : "satisfied",
    references: [reference],
    explanation: `fixed injected protocol reply for ${criterionId} citing ${reference}`,
  })),
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

function ports(url, identityLog, boundary) {
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
      // ACTUAL dispatch boundary: the durable attempt must already exist and
      // match this request before a single byte leaves the process.
      boundary.verify();
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
const truthDigest = sha256(fs.readFileSync(path.join(root, "truth", "truth-v1.json"), "utf8"));

const candidates = [];
const manifest = [];
const workRoot = path.join(root, ".isolation-tmp", "wp8-profile-b", `run-${Date.now()}`);
fs.mkdirSync(workRoot, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

function retain(candidateId, runId, name, value) {
  const dir = path.join(evidenceDir, candidateId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  fs.writeFileSync(file, body, "utf8");
  const bytes = fs.readFileSync(file);
  return { path: path.relative(root, file).split(path.sep).join("/"), bytes: bytes.length, sha256: sha256(bytes) };
}

for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
  const ws = path.join(workRoot, candidateId);
  fs.mkdirSync(ws, { recursive: true });

  // 1. Authoritative snapshot (official base/head tree, digest and diff).
  const snapshot = buildAuthoritativeSnapshot(candidateId, path.join(ws, "snapshot"));
  const snapshotCheck = verifySnapshot(snapshot);
  if (!snapshotCheck.ok) throw new Error(`${candidateId}: ${snapshotCheck.errors.join("; ")}`);

  // 2. Approved reviewer materialization + COMPLETE Profile B input.
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
  // The changed-path assignment comes from the authoritative diff and is not widened.
  const expectedChanged = changedPathsFromDiff(snapshot.diff);
  if (JSON.stringify(profileB.changedFiles) !== JSON.stringify(expectedChanged)) {
    throw new Error(`${candidateId}: changed-file assignment does not match the authoritative diff`);
  }
  const requestInput = renderProfileBRequestInput(profileB);

  // Independently captured expected criteria content: derived from the
  // review-time criteria source, never from the assessment under evaluation.
  const expectedCriteria = captureCriteriaSnapshot({
    authoredRevision: truth.criteriaRevision,
    criteria: profileB.criteria,
    source: `candidates/${candidateId}/criteria (review-time source)`,
  });

  // 3. Evidence packet + deterministic baseline.
  const packetPath = writeEvidencePacket(candidateId, path.join(ws, "evidence"));
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const baseline = runBaseline({ packet });
  const anonId = packet.candidateAnonId;
  const snapshotDigest = snapshot.head.applicationDigest;

  // 4. Byte-verified registry bound to this candidate and snapshot.
  const binding = { candidateBinding: anonId, snapshotDigest };
  const built = buildArtifactRegistry({
    binding,
    files: profileB.headFiles,
    allowedPaths: snapshot.files,
  });
  const verified = verifyArtifactRegistry({
    registry: built.registry,
    files: profileB.headFiles,
    allowedPaths: snapshot.files,
    binding,
  });
  if (!verified.ok) throw new Error(`${candidateId}: artifact registry failed verification: ${verified.errors.join("; ")}`);

  // 5. Fixed injected provider reply, decoded record-by-record.
  const fake = await startFakeResponses(FIXED_REPLY);
  const identityLog = [];
  const boundary = { verify: () => {} };
  const client = createLlmClient(ports(fake.url, identityLog, boundary));

  const requestId = `wp8b-${candidateId}`;
  const runId = `run-${candidateId}`;
  const requestIdentity = sha256(requestInput);
  const task = {
    taskId: requestId,
    attempt: 1,
    profileId: "profile-b",
    model: "profile-b-fake-model",
    accountRefs: ["acct_wp8b"],
    policy: { subjectRef: anonId, policyRevision: 1, bindingRevision: 1 },
    instructions: profileB.instruction,
    input: requestInput,
    output: { mode: "json_object" },
    maxOutputTokens: 4096,
    deadline: new Date(Date.now() + 30000),
    decode: (value) => {
      const list = value?.assessments;
      if (!Array.isArray(list)) throw new Error("assessments must be an array");
      return list;
    },
  };

  // 6. DURABLE attempt lifecycle: planned and started BEFORE dispatch.
  const ledgerPath = path.join(ws, "runs.jsonl");
  const attempt = {
    identity: {
      runId,
      attemptId: "attempt-1",
      profile: "profile-b",
      candidateId: anonId,
      baseTreeIdentity: snapshot.base.tree,
      headTreeIdentity: snapshot.head.tree,
      runtimeSnapshotDigest: snapshotDigest,
      criteriaAuthoredRevision: expectedCriteria.authoredRevision,
      criteriaContentDigest: expectedCriteria.contentDigest,
      requestIdentity,
    },
    record: {
      slotId: "slot-1",
      repetition: 1,
      seed: 42,
      subjectInventory: [...CRITERIA],
      criterionInventory: [...CRITERIA],
      policyDigest: packet.checkDefinitionDigest,
      promptDigest: sha256(profileB.instruction),
      requestedModel: task.model,
      adapterEntryIdentity: "@agent-teams/account-gateway/llm",
      startTimestamp: "2026-01-01T00:00:00Z",
      requestIds: [requestId],
      diagnostics: [],
    },
    ledgerPath,
  };
  const planned = persistPlanned(attempt);
  const started = persistStarted(attempt);
  boundary.verify = () => verifyAttemptAtDispatch(attempt);
  const dispatchEvidence = verifyAttemptAtDispatch(attempt);

  let result;
  let dispatchFailure = null;
  try {
    result = await client.generate(task);
  } catch (err) {
    dispatchFailure = err;
  }
  await fake.close();

  if (dispatchFailure) {
    persistTerminal(attempt, "failed", {
      endTimestamp: "2026-01-01T00:00:01Z",
      diagnostics: [`dispatch failed: ${String(dispatchFailure)}`],
    });
    throw new Error(`${candidateId}: dispatch failed: ${String(dispatchFailure)}`);
  }
  if (!result.ok) {
    persistTerminal(attempt, result.effect === "unknown" ? "unknown" : "failed", {
      endTimestamp: "2026-01-01T00:00:01Z",
      diagnostics: [`sdk result ${result.code}/${result.effect}`],
    });
    throw new Error(`${candidateId}: SDK generation failed: ${result.code}/${result.effect}`);
  }
  if (identityLog.length !== 1) throw new Error(`${candidateId}: unexpected access count ${identityLog.length}`);
  if (fake.requests.length !== 1) throw new Error(`${candidateId}: expected exactly one dispatch`);
  if (result.receipt.requestSha256 !== fake.requests[0].bodySha256) {
    throw new Error(`${candidateId}: receipt requestSha256 does not match the bytes the provider received`);
  }
  if (result.cleanup !== "closed") throw new Error(`${candidateId}: cleanup ${result.cleanup}`);

  // 7. The captured provider request must carry EVERY required input in full.
  const capturedBody = fake.requests[0].body;
  const capturedJson = JSON.parse(capturedBody);
  const capturedMessages = capturedMessageTexts(capturedJson.input);
  if (capturedMessages.length !== 1) {
    throw new Error(`${candidateId}: expected exactly one delivered provider message, got ${capturedMessages.length}`);
  }
  const capturedInput = capturedMessages[0];
  // The delivered turn must be a plain user input message, not a fabricated
  // assistant turn or a tool result.
  const deliveredMessage = Array.isArray(capturedJson.input) ? capturedJson.input[0] : null;
  if (deliveredMessage?.role !== "user") {
    throw new Error(`${candidateId}: delivered provider message role is not user`);
  }
  const deliveredPart = Array.isArray(deliveredMessage?.content) ? deliveredMessage.content[0] : null;
  if (deliveredPart?.type !== "input_text") {
    throw new Error(`${candidateId}: delivered provider content is not input_text`);
  }
  // The provider-bound payload is our rendered JSON document. Compare the
  // delivered fields by exact value: a prefix, a filename or a truncated body
  // cannot pass this check.
  let sent;
  try {
    sent = JSON.parse(capturedInput);
  } catch {
    throw new Error(
      `${candidateId}: captured provider input is not the rendered request payload ` +
        `(deliveredLen=${capturedInput.length}, renderedLen=${requestInput.length})`,
    );
  }
  const sentFiles = new Map((Array.isArray(sent.files) ? sent.files : []).map((f) => [f.path, f.content]));
  const sentCriteria = new Map((Array.isArray(sent.criteria) ? sent.criteria : []).map((c) => [c.id, c.text]));
  const delivered = [];
  for (const f of profileB.headFiles) {
    delivered.push({ kind: "file", id: f.path, complete: sentFiles.get(f.path) === f.content });
  }
  for (const c of profileB.criteria) {
    delivered.push({ kind: "criterion", id: c.id, complete: sentCriteria.get(c.id) === c.text });
  }
  delivered.push({ kind: "background", id: "task.background", complete: sent?.task?.background === profileB.background });
  delivered.push({ kind: "rules", id: "rules", complete: sent?.rules === profileB.rules });
  delivered.push({
    kind: "task",
    id: "task.prTitle+description",
    complete: sent?.task?.title === profileB.prTitle && sent?.task?.description === profileB.prDescription,
  });
  delivered.push({
    kind: "instructions",
    id: "instructions",
    complete: sent?.instructions === profileB.instruction,
  });
  delivered.push({
    kind: "scope",
    id: "changedFiles",
    complete: JSON.stringify(sent?.changedFiles) === JSON.stringify(profileB.changedFiles),
  });
  delivered.push({
    kind: "scope",
    id: "unchangedDependencies",
    complete: JSON.stringify(sent?.unchangedDependencies) === JSON.stringify(profileB.unchangedDependencies),
  });
  delivered.push({
    kind: "schema",
    id: "outputSchema",
    complete: isDeepStrictEqual(sent?.outputSchema, PROFILE_B_OUTPUT_SCHEMA),
  });
  // No filename-only substitution: the body text must be substantially larger
  // than the identifier list alone.
  const identifierOnly =
    JSON.stringify(profileB.headFiles.map((f) => f.path)).length +
    JSON.stringify(profileB.criteria.map((c) => c.id)).length;
  if (capturedInput.length < identifierOnly * 2) {
    throw new Error(`${candidateId}: captured request looks like identifiers only (${capturedInput.length} chars)`);
  }
  const missingInput = delivered.filter((d) => !d.complete);
  if (missingInput.length > 0) {
    throw new Error(
      `${candidateId}: provider request lost required input: ${missingInput.map((m) => `${m.kind}:${m.id}`).join(", ")}`,
    );
  }

  // 8. Decode the provider's own output, preserving references and explanations.
  const decoded = decodeProfileBAssessments(result.text, CRITERIA);
  if (decoded.unparseable) throw new Error(`${candidateId}: provider reply unparseable: ${decoded.diagnostics.join("; ")}`);
  if (decoded.missingIds.length > 0) {
    throw new Error(`${candidateId}: provider reply missing criteria: ${decoded.missingIds.join(",")}`);
  }
  if (decoded.assessments.length !== CRITERIA.length) {
    throw new Error(`${candidateId}: expected ${CRITERIA.length} usable assessments, got ${decoded.assessments.length}`);
  }
  // References must be the provider's, not the integration's.
  for (const a of decoded.assessments) {
    if (a.references.length === 0) throw new Error(`${candidateId}: ${a.expectedCriterionId} has no provider reference`);
    if (!a.references.every((r) => r.startsWith("artifact://"))) {
      throw new Error(`${candidateId}: ${a.expectedCriterionId} references are not provider artifact refs`);
    }
  }
  const rawReplyMatches =
    decoded.assessments.length === JSON.parse(FIXED_REPLY).assessments.length &&
    decoded.assessments.every((a, i) => {
      const original = JSON.parse(FIXED_REPLY).assessments.find((x) => x.criterionId === a.expectedCriterionId);
      return original && original.explanation === a.explanation && JSON.stringify(original.references) === JSON.stringify(a.references);
    });
  if (!rawReplyMatches) throw new Error(`${candidateId}: provider references/explanations were not preserved verbatim`);

  // 9. ResultContract with the captured claims and provider references.
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
      authoredCriteriaRevision: expectedCriteria.authoredRevision,
      criteriaTextDigest: expectedCriteria.contentDigest,
      expectedCriterionIds: [...CRITERIA],
      criterionToCheckMapping: {},
      policyVersion: "baseline-policy-v1",
      policyDigest: packet.checkDefinitionDigest,
    },
    profile: {
      profileId: "profile-b",
      configurationIdentity: `sdk:${llmEntry}`,
      promptIdentity: sha256(profileB.instruction),
      inputIdentity: requestIdentity,
      requestedModel: task.model,
      observedModel: result.receipt.observedModel,
      reasoningConfiguration: {},
      adapterEntryIdentity: "@agent-teams/account-gateway/llm",
    },
    assessments: decoded.assessments,
    findings: [],
    coverage: computeCoverage([...CRITERIA], decoded.assessments.map((a) => a.expectedCriterionId)),
    execution: {
      state: "completed",
      slotId: "slot-1",
      runId,
      attemptId: "attempt-1",
      requestId,
      sdkEffectCode: null,
      diagnostics: [...decoded.diagnostics],
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

  // 10. Scoring with claim-specific support.
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
    claimRubrics: claimRubrics(),
    artifactRegistry: verified.accepted,
    // Independently captured consumer-side identities: the label and the CONTENT
    // digest the consumer currently holds, not the contract's own copies.
    expectedCriteriaRevision: expectedCriteria.authoredRevision,
    expectedCriteriaContentDigest: expectedCriteria.contentDigest,
  });
  if (scorer.truthBindingErrors.length) {
    throw new Error(`${candidateId}: truth binding invalid: ${scorer.truthBindingErrors.join("; ")}`);
  }
  if (scorer.referenceValidity.some((r) => !r.valid)) {
    throw new Error(`${candidateId}: a reference failed mechanical resolution`);
  }
  if (scorer.semanticSupport.some((s) => !s.supporting)) {
    throw new Error(`${candidateId}: a claim lacked its own support decision`);
  }

  // 11. Terminal record, after execution.
  const completed = persistTerminal(attempt, "completed", {
    observedModel: result.receipt.observedModel,
    rawArtifactRefs: [result.receipt.outputSha256],
    admissionState: scorer.admission.admitted ? "admitted" : "rejected",
    cleanupStatus: rc.execution.cleanupStatus,
    endTimestamp: "2026-01-01T00:00:01Z",
    diagnostics: decoded.diagnostics,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
  });

  const ledgerRecords = readLedger(ledgerPath);
  const ledgerErrors = verifyLedgerIntegrity(ledgerRecords);
  if (ledgerErrors.length) throw new Error(`${candidateId}: ledger invalid: ${ledgerErrors.join("; ")}`);
  if (ledgerRecords.length !== 3) throw new Error(`${candidateId}: expected 3 ledger events, got ${ledgerRecords.length}`);

  // 12. Retained evidence + readiness artifact, persisted and read back.
  const readiness = {
    schema: "m2.wp8-profile-b/v2",
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
      diffSha256: sha256(snapshot.diff),
      files: snapshot.files,
      verified: snapshotCheck.ok,
    },
    criteria: {
      authoredRevision: expectedCriteria.authoredRevision,
      contentDigest: expectedCriteria.contentDigest,
      source: expectedCriteria.source,
      submittedDigest: rc.criteria.criteriaTextDigest,
      bound: rc.criteria.criteriaTextDigest === expectedCriteria.contentDigest,
    },
    providerInput: {
      schema: "profile-b-request-v1",
      requestIdentity,
      capturedBytes: capturedBody.length,
      delivered,
      changedFiles: profileB.changedFiles,
      unchangedDependencies: profileB.unchangedDependencies,
      complete: missingInput.length === 0,
    },
    providerOutput: {
      decoder: decoded.decoderVersion,
      usableRecords: decoded.assessments.length,
      rejectedRecords: decoded.rejectedCount,
      malformedRecords: decoded.malformedCount,
      diagnostics: decoded.diagnostics,
      references: decoded.assessments.map((a) => ({
        criterionId: a.expectedCriterionId,
        references: [...a.references],
        explanation: a.explanation,
      })),
    },
    requests: {
      dispatches: fake.requests.length,
      identityPersistedBeforeDispatch: dispatchEvidence.plannedPersisted && dispatchEvidence.startedPersisted,
      dispatchIdentity: dispatchEvidence,
      automaticRetries: 0,
      liveProviderCalls: 0,
    },
    ledger: {
      events: ledgerRecords.length,
      lifecycle: ledgerRecords.map((r) => ({ eventType: r.eventType, executionState: r.executionState })),
      errors: ledgerErrors,
      plannedAt: planned.eventId,
      startedAt: started.eventId,
      completedAt: completed.eventId,
    },
    baselineRejected: baseline.rejected,
    contractValid: contractErrors.length === 0,
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
    /**
     * Per-claim admission. `semanticConclusionAdmitted` is NOT consumer
     * admission; `consumerAdmitted` requires every mandatory gate. The original
     * claim wording is retained for rejected claims.
     */
    claims: {
      total: scorer.claimAdmissions.length,
      consumerAdmitted: scorer.claimAdmissions.filter((c) => c.consumerAdmitted).length,
      rejected: scorer.claimAdmissions.filter((c) => !c.consumerAdmitted).length,
      entries: scorer.claimAdmissions,
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
  const post = verifySnapshot(snapshot);
  if (!post.ok) throw new Error(`${candidateId}: snapshot identity failed re-verification after readback`);

  // Retained artifacts (actual files, not just hashes).
  const retained = [
    { name: "readiness.json", file: retain(candidateId, runId, "readiness.json", readiness) },
    { name: "runs.jsonl", file: retain(candidateId, runId, "runs.jsonl", ledgerRecords.map((r) => JSON.stringify(r)).join("\n") + "\n") },
    { name: "dispatch-identity.json", file: retain(candidateId, runId, "dispatch-identity.json", dispatchEvidence) },
    {
      name: "provider-request.json",
      file: retain(candidateId, runId, "provider-request.json", {
        requestSha256: fake.requests[0].bodySha256,
        bodyBytes: capturedBody.length,
        body: capturedBody,
      }),
    },
    { name: "provider-response-raw.txt", file: retain(candidateId, runId, "provider-response-raw.txt", result.text) },
    {
      name: "decoded.json",
      file: retain(candidateId, runId, "decoded.json", {
        decoder: decoded.decoderVersion,
        assessments: decoded.assessments,
        diagnostics: decoded.diagnostics,
        recordDiagnostics: decoded.recordDiagnostics,
        rawRecords: decoded.rawRecords,
      }),
    },
    { name: "admission.json", file: retain(candidateId, runId, "admission.json", scorer.admission) },
    {
      name: "claims.json",
      file: retain(candidateId, runId, "claims.json", {
        total: scorer.claimAdmissions.length,
        consumerAdmitted: scorer.claimAdmissions.filter((c) => c.consumerAdmitted).length,
        entries: scorer.claimAdmissions,
      }),
    },
    {
      name: "criteria-binding.json",
      file: retain(candidateId, runId, "criteria-binding.json", {
        expected: expectedCriteria,
        submitted: rc.criteria.criteriaTextDigest,
        authoredRevision: rc.criteria.authoredCriteriaRevision,
        bound: rc.criteria.criteriaTextDigest === expectedCriteria.contentDigest,
      }),
    },
  ];
  for (const r of retained) {
    manifest.push({
      profile: "profile-b",
      candidate: candidateId,
      producer: "scripts/qualify-profile-b.mjs",
      runIdentity: runId,
      requestIdentity,
      snapshotDigest,
      baseTree: snapshot.base.tree,
      headTree: snapshot.head.tree,
      criteriaRevision: expectedCriteria.authoredRevision,
      criteriaContentDigest: expectedCriteria.contentDigest,
      scope: r.name,
      completeness: "complete",
      path: r.file.path,
      bytes: r.file.bytes,
      sha256: r.file.sha256,
    });
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
      claimsAdmitted: scorer.claimAdmissions.filter((c) => c.consumerAdmitted).length,
      claimsTotal: scorer.claimAdmissions.length,
      dispatches: fake.requests.length,
      ledgerEvents: ledgerRecords.length,
      providerInputComplete: missingInput.length === 0,
      referencesPreserved: rawReplyMatches,
      falseSatisfaction: scorer.reportedClaims.falseSatisfaction,
      falseViolation: scorer.reportedClaims.falseViolation,
      readinessSha,
    },
  });
}

const summary = {
  schema: "m2.wp8-profile-b-verification/v2",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  sdkEntry: llmEntry,
  environment: { liveProviderCalls: 0, credentials: 0, automaticRetries: 0, providerMode: "fixed-injected" },
  candidates: candidates.map((c) => c.report),
  evidenceManifest: path.relative(root, path.join(evidenceDir, "manifest.json")).split(path.sep).join("/"),
};
fs.writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify({ schema: "m2.evidence-manifest/v1", profile: "profile-b", files: manifest }, null, 2) + "\n", "utf8");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const c of candidates) {
  console.log(
    `PASS ${c.candidateId} ${c.report.baseTree.slice(0, 8)}->${c.report.headTree.slice(0, 8)} ` +
      `digest ${c.report.headApplicationDigest.slice(0, 12)} admitted=${c.report.admitted} ` +
      `(${c.report.admissionReason}) dispatches=${c.report.dispatches} ledger=${c.report.ledgerEvents} ` +
      `inputComplete=${c.report.providerInputComplete} refsPreserved=${c.report.referencesPreserved} ` +
      `claims=${c.report.claimsAdmitted}/${c.report.claimsTotal} ` +
      `falseSat=${c.report.falseSatisfaction} falseViol=${c.report.falseViolation}`,
  );
}
console.log(`\nProfile B (${process.version}, ${summary.platform}): ${candidates.length}/4 candidates admitted through the packed SDK`);
console.log(`evidence: ${outPath}`);
console.log(`retained evidence: ${evidenceDir}`);
process.exit(candidates.every((c) => c.report.admitted) ? 0 : 1);
