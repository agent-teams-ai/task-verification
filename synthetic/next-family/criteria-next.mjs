// Criteria Assessment for the next-family batch, through the pinned Gateway SDK
// `/llm` path and the bounded proxy.
//
//   node synthetic/next-family/criteria-next.mjs c01 --dry-run
//   node synthetic/next-family/criteria-next.mjs c01
//   node synthetic/next-family/criteria-next.mjs c02 --stage criteria-correction --corrects <attemptId>
//
// Corrections in D3-R1, each traceable to a maintainer finding:
//
// 1. The proxy is resolved module-relative from `lib/paths.mjs`, never from the
//    working directory or a repository-root `tooling/` guess.
// 2. The admitted body is the *serialized* SDK request, measured offline through
//    `createLlmClient()` with a fake port; the byte ceiling and the token ceiling
//    are separate numbers and both are passed to the proxy.
// 3. Model, service tier, reasoning effort, output ceiling and provider identity
//    are enforced at the proxy; a mismatch halts and the reply is withheld.
// 4. Every attempt is a new append-only record with a unique id. Nothing is
//    deleted, no ledger is truncated and no earlier output is overwritten; a
//    duplicate run key is refused outright.
// 5. The aggregate budget guard reserves the admitted maximum before forwarding
//    and settles it against reported usage afterwards.
//
// The input is the frozen packet produced by prepare.mjs; this script selects no
// files itself. One attempt, no retry, no fallback, no model or provider switch.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FAMILY_ROOT, RESEARCH_ROOT, SDK_LLM_DIST, proxyPath } from "./lib/paths.mjs";
import { INSTRUCTIONS, PROFILE, buildTask, loadFamily, loadPacket, profileDigest, sha256 } from "./lib/task.mjs";
import { measureSerializedRequest } from "./lib/measure.mjs";
import {
  CRITERIA_REQUEST_MAX_USD,
  INPUT_BODY_BYTES,
  INPUT_TOKEN_CEILING,
  MAX_OUTPUT_TOKENS,
  criteriaProxyArgs,
} from "./lib/limits.mjs";
import { attemptDir, createAttempt, finishAttempt, findDuplicate, isTerminal, newAttemptId, runKey, writeRawResponse } from "./lib/attempt.mjs";
import { reserve, settle, verifyHistorical, availableUsd, committedUsd, readState, totals } from "./lib/budget.mjs";

const STAGES = new Set(["criteria", "criteria-correction"]);

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out.positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const candidateId = args.positional[0];
const stageId = typeof args.stage === "string" ? args.stage : "criteria";
const dryRun = Boolean(args["dry-run"]);

const fail = (code, message, exitCode = 3) => {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(exitCode);
};

if (typeof candidateId !== "string") fail("usage", "node criteria-next.mjs <c01|c02|c03> [--stage criteria]", 2);
if (!STAGES.has(stageId)) fail("usage", `--stage must be one of ${[...STAGES].join(", ")}`, 2);
if (!fs.existsSync(SDK_LLM_DIST)) fail("sdk_missing", `the pinned SDK entry is absent: ${SDK_LLM_DIST}`);

const family = loadFamily(FAMILY_ROOT);
const packet = loadPacket(candidateId, family);
const digest = profileDigest();
const task = buildTask({
  candidateId,
  stageId: stageId === "criteria-correction" ? "criteria-correction" : "criteria",
  packetText: packet.text,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
});

// ---- offline measurement of the exact serialized request --------------------
const measured = await measureSerializedRequest(task);
if (!measured.inputTextMatchesPacket) fail("packet_mismatch", "the serialized request does not carry the frozen packet verbatim");
if (!measured.schemaMatchesFrozen) fail("schema_mismatch", "the serialized request does not carry the frozen schema");
if (measured.bodyBytes > INPUT_BODY_BYTES) {
  fail(
    "input_ceiling_exceeded",
    `serialized body is ${measured.bodyBytes} bytes, above the ${INPUT_BODY_BYTES}-byte admitted ceiling; the packet is not truncated and nothing is dispatched`,
    4,
  );
}

const key = runKey({
  candidateId,
  stageId,
  packetSha256: packet.sha256,
  profileDigest: digest,
  bodySha256: measured.bodySha256,
});
const duplicate = findDuplicate(key);
const history = verifyHistorical(RESEARCH_ROOT);
const guardState = readState();
const guardTotals = totals(guardState);

const preview = {
  schema: "next-family.criteria-admission/v1",
  candidateId,
  head: packet.head,
  stageId,
  profile: PROFILE,
  profileDigest: digest,
  runKey: key,
  packet: { bytes: packet.bytes, sha256: packet.sha256 },
  serializedBody: {
    bytes: measured.bodyBytes,
    sha256: measured.bodySha256,
    instructionsBytes: measured.instructionsBytes,
    schemaBytes: measured.schemaBytes,
    envelopeBytes: measured.envelopeBytes,
    escapingGrowthBytes: measured.escapingGrowthBytes,
    maxOutputTokens: measured.addressed.max_output_tokens,
    effort: measured.addressed.effort,
    serviceTier: measured.addressed.service_tier,
    stream: measured.addressed.stream,
    store: measured.addressed.store,
  },
  ceilings: {
    bodyBytes: INPUT_BODY_BYTES,
    inputTokens: INPUT_TOKEN_CEILING,
    outputTokens: MAX_OUTPUT_TOKENS,
    requestMaxUsd: CRITERIA_REQUEST_MAX_USD,
  },
  budget: {
    approvedCeilingUsd: 1.0,
    historicalSettledUsd: history.conservative === null ? null : guardState.historical.settledUsd,
    historicalConservativeUsd: history.conservative,
    committedUsd: committedUsd(),
    availableUsd: availableUsd(),
    newStageTotals: guardTotals,
  },
  duplicate,
  proxy: proxyPath(),
};

if (dryRun) {
  process.stdout.write(`${JSON.stringify({ ...preview, dryRun: true, dispatched: false }, null, 2)}\n`);
  process.exit(0);
}

if (duplicate !== null) {
  fail("duplicate_execution", `${duplicate.attemptId} already ran this exact request (state ${duplicate.state}); use a new stage id for an authorized recheck`, 5);
}

if (stageId === "criteria-correction") {
  const corrects = typeof args.corrects === "string" ? args.corrects : null;
  if (corrects === null) fail("usage", "a correction requires --corrects <attemptId>", 2);
  if (!isTerminal(corrects)) fail("correction_target", `${corrects} is not a finished attempt`, 5);
  if (!corrects.includes(`-${candidateId}-`)) fail("correction_target", `${corrects} is not an attempt on ${candidateId}`, 5);
}

if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_BASE_URL) {
  fail(
    "credentials_absent",
    "OPENROUTER_API_KEY and OPENROUTER_BASE_URL must be set in this shell; nothing was dispatched and nothing was reserved",
  );
}

// ---- append-only attempt, then admission ------------------------------------
const attemptId = newAttemptId({ candidateId, stageId });
const { dir } = createAttempt({
  attemptId,
  candidateId,
  stageId,
  key,
  packet,
  profileDigest: digest,
  body: { bytes: measured.bodyBytes, sha256: measured.bodySha256 },
  reservationUsd: CRITERIA_REQUEST_MAX_USD,
  corrects: typeof args.corrects === "string" ? args.corrects : null,
});

const admission = reserve({
  requestKey: key,
  attemptId,
  candidateId,
  stageId,
  maxUsd: CRITERIA_REQUEST_MAX_USD,
  inputTokens: INPUT_TOKEN_CEILING,
  outputTokens: MAX_OUTPUT_TOKENS,
});
if (!admission.admitted) {
  finishAttempt(attemptId, {
    state: "refused",
    stopReason: admission.reason,
    result: { admission },
  });
  fail("budget_refused", `${admission.reason}: ${JSON.stringify(admission.totals)}`, 5);
}

const ledgerPath = path.join(dir, "request", "ledger.jsonl");
const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const port = Number(process.env.CRITERIA_PORT ?? (await freePort()));
const proxyUrl = `http://127.0.0.1:${port}/v1/responses`;
if (!/^http:\/\/127\.0\.0\.1:\d+\/v1\/responses$/.test(proxyUrl)) fail("proxy_origin", `not a loopback proxy origin: ${proxyUrl}`);

const proxy = (await import("node:child_process")).spawn(
  process.execPath,
  [proxyPath(), ...criteriaProxyArgs({ stageId, port, ledgerPath, model: PROFILE.model, serviceTier: PROFILE.serviceTier })],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let proxyOut = "";
proxy.stdout.on("data", (chunk) => (proxyOut += chunk.toString("utf8")));
proxy.stderr.on("data", (chunk) => (proxyOut += chunk.toString("utf8")));

const waitReady = async () => {
  for (let i = 0; i < 150; i += 1) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("proxy did not become ready");
};

// No credentialed egress outside the proxy (D3-R2 correction). This process used to
// read the provider key's usage figure from `openrouter.ai/api/v1/key` directly.
// That call carries the credential and leaves the bounded boundary even though it
// is not an inference request, so it is gone: the single fetch below targets the
// loopback proxy, and cost is reconciled from the proxy ledger's reported usage.

let exitCode = 0;
let stopReason = null;
const startedAt = new Date().toISOString();

try {
  await waitReady();
  const { createLlmClient } = await import(pathToFileURL(SDK_LLM_DIST).href);

  const control = {
    async runAccess(intent) {
      const accountRef = intent.accountRefs[0];
      const executionRef = `exec_${intent.operationId}`;
      return {
        operation: {
          operationRef: intent.operationId,
          state: "applied",
          result: { kind: "execution", executionRef, accountRef, authorizationEpoch: 1, deadline: intent.deadline, state: "active" },
        },
        bearer: "loopback-execution-bearer",
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

  let forwardedBodies = 0;
  const connectExecution = () => ({
    async request(executionRef, req, { signal } = {}) {
      // The body handed to the port must be the measured body, byte for byte.
      const bytes = Buffer.from(req.body);
      if (bytes.length !== measured.bodyBytes || sha256(bytes) !== measured.bodySha256) {
        throw new Error("serialized body changed after admission; refusing to forward");
      }
      forwardedBodies += 1;
      const res = await fetch(proxyUrl, {
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

  const client = createLlmClient({ control, connectExecution });
  const result = await client.generate(task);

  const rawText = typeof result.text === "string" ? result.text : "";
  if (rawText !== "") writeRawResponse(attemptId, rawText);

  const ledgerLines = fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  const forwarded = ledgerLines.filter((line) => line.decision === "forwarded");
  const refusals = ledgerLines.filter((line) => line.decision === "refused");
  const chargedIn = forwarded.reduce((sum, line) => sum + (line.chargedInputTokens ?? 0), 0);
  const chargedOut = forwarded.reduce((sum, line) => sum + (line.chargedOutputTokens ?? 0), 0);
  const usageReliable =
    forwarded.length === 1 && forwarded[0].status === 200 && forwarded[0].usagePresent === true && forwarded[0].halted === null;

  const settlement = settle({
    requestKey: key,
    chargedInputTokens: chargedIn,
    chargedOutputTokens: chargedOut,
    usageReliable,
  });

  const report = {
    schema: "next-family.criteria-report/v1",
    attemptId,
    candidateId,
    head: packet.head,
    stageId,
    startedAt,
    endedAt: new Date().toISOString(),
    profile: PROFILE,
    profileDigest: digest,
    inputProfile: {
      packet: { path: packet.manifest.packet.path, bytes: packet.bytes, sha256: packet.sha256 },
      rule: packet.manifest.rule.revision,
      instructionsSha256: sha256(INSTRUCTIONS),
      serializedBody: { bytes: measured.bodyBytes, sha256: measured.bodySha256 },
    },
    ceilings: { bodyBytes: INPUT_BODY_BYTES, inputTokens: INPUT_TOKEN_CEILING, outputTokens: MAX_OUTPUT_TOKENS },
    reservation: { maxUsd: CRITERIA_REQUEST_MAX_USD, admission },
    outcome: result.ok
      ? { ok: true, usage: result.usage, receipt: result.receipt, cleanup: result.cleanup, value: result.value }
      : { ok: false, code: result.code, effect: result.effect, retry: result.retry, usage: result.usage, cleanup: result.cleanup },
    execution: {
      forwardedBodies,
      forwardedRequests: forwarded.length,
      refusals: refusals.map((line) => line.code),
      charged: { inputTokens: chargedIn, outputTokens: chargedOut },
      settlement,
      observed: forwarded.map((line) => ({
        status: line.status,
        model: line.observedModel,
        provider: line.observedProvider,
        identityVerified: line.identityVerified,
        providerVerified: line.providerVerified,
        halted: line.halted,
      })),
    },
    transport: {
      directProviderEgress: false,
      credentialHolder: "bounded-proxy-only",
      note:
        "the launcher issues no credentialed request of its own; cost is reconciled from the proxy ledger's reported usage rather than from a direct provider account read",
    },
    rawResponsePath: rawText === "" ? null : `runs/attempts/${attemptId}/raw/response.txt`,
  };

  const state = result.ok ? "completed" : "failed";
  if (!result.ok) {
    stopReason = result.code;
    exitCode = 5;
  }
  if (forwarded.some((line) => line.halted !== null)) {
    stopReason = forwarded.find((line) => line.halted !== null).halted;
    exitCode = 4;
  }
  finishAttempt(attemptId, { state, stopReason, result: report });
  process.stdout.write(`${JSON.stringify({ attemptId, state, stopReason, report }, null, 2)}\n`);
} catch (error) {
  stopReason = "launcher_error";
  finishAttempt(attemptId, {
    state: "failed",
    stopReason,
    result: { error: String(error?.message ?? error), forwardedBodies },
  });
  process.stderr.write(`launcher_error: ${String(error?.message ?? error)}\n`);
  exitCode = 5;
} finally {
  proxy.kill("SIGKILL");
  fs.writeFileSync(path.join(dir, "request", "proxy.log"), proxyOut, { mode: 0o600 });
}

process.exit(exitCode);
