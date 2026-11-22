// Criteria Assessment for the next-family batch, through the pinned Gateway SDK `/llm` path.
//
//   node criteria-next.mjs c01
//
// The same SDK entry (`createLlmClient()`), the same instructions text, the same JSON schema shape,
// the same model, the same requested service tier and reasoning effort as the frozen D1/D2 profile.
// The only differences are the requirement ids, the packet content and the head identity.
//
// The input is the frozen packet produced by prepare.mjs; this script does not select files itself.
// One attempt, no retry, no fallback. The bounded proxy holds the credential and enforces the
// request, byte and token ceilings. Nothing here runs during offline preparation.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SYN = path.resolve(HERE, "../..");
const PROXY = path.join(SYN, "tooling", "openrouter-bounded-proxy.mjs");
const SDK_DIST =
  "D:/Project/agent-teams-ai-task-verification-m2/.isolation-tmp/d12/sdk-src/packages/account-gateway/dist/llm/index.js";
const PORT = Number(process.env.CRITERIA_PORT ?? 8791);
const MODEL = "openai/gpt-6.1-terra";

const CRITERIA = ["C1", "C2", "C3", "C4", "C5"];

const MAX_IN = Number(process.env.CRITERIA_MAX_INPUT_TOKENS ?? 12000);
const MAX_OUT = Number(process.env.CRITERIA_MAX_OUTPUT_TOKENS ?? 2000);

const id = process.argv[2];
const family = JSON.parse(fs.readFileSync(path.join(HERE, "family.json"), "utf8"));
const head = family.candidates[id];
if (!head) {
  console.error(`usage: node criteria-next.mjs ${Object.keys(family.candidates).join("|")}`);
  process.exit(2);
}

const short = head.slice(0, 12);
const packetPath = path.join(HERE, "packets", `packet-${short}.md`);
const packetManifest = JSON.parse(fs.readFileSync(path.join(HERE, "packets", `packet-${short}.json`), "utf8"));
const input = fs.readFileSync(packetPath, "utf8");
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
if (sha256(input) !== packetManifest.packet.sha256) {
  console.error("FATAL: packet digest does not match its frozen manifest");
  process.exit(2);
}

if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_BASE_URL) {
  console.error("FATAL: OPENROUTER_API_KEY and OPENROUTER_BASE_URL must be set in this shell");
  process.exit(2);
}

// Frozen verbatim from the D1/D2 profile.
const instructions =
  "Assess each requirement in the frozen requirements document independently against the candidate " +
  "implementation. Use all provided repository content, including unchanged helper modules, and reason " +
  "about whether a caller can exercise each capability through the service. Do not infer missing " +
  "functionality solely from its absence in the diff. For each requirement return satisfied, violated or " +
  "inconclusive, with concrete evidence references (file and symbol or line), a short explanation, and " +
  "either an actionable correction or the evidence that is missing.";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      minItems: CRITERIA.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "status", "evidence", "explanation", "correction"],
        properties: {
          requirementId: { type: "string", enum: CRITERIA },
          status: { type: "string", enum: ["satisfied", "violated", "inconclusive"] },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "reference"],
              properties: { path: { type: "string" }, reference: { type: "string" } },
            },
          },
          explanation: { type: "string" },
          correction: { type: "string" },
        },
      },
    },
  },
};

const keyUsage = async () => {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    const body = await res.json();
    return String(body.data.usage);
  } catch {
    return "unavailable";
  }
};

const runsDir = path.join(HERE, "runs");
fs.mkdirSync(runsDir, { recursive: true });
const ledger = path.join(runsDir, `ledger-criteria-${id}.jsonl`);
fs.rmSync(ledger, { force: true });

const proxy = spawn(
  process.execPath,
  [
    PROXY,
    "--stage", `next-family-criteria-${id}`,
    "--port", String(PORT),
    "--max-requests", "1",
    "--max-input-tokens", String(MAX_IN),
    "--max-output-tokens", String(MAX_OUT),
    "--request-input-tokens", String(MAX_IN),
    "--request-output-tokens", String(MAX_OUT),
    "--request-timeout-ms", "150000",
    "--model", MODEL,
    "--service-tier", "default",
    "--effort", "medium",
    "--ledger", ledger,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let proxyOut = "";
proxy.stdout.on("data", (b) => (proxyOut += b.toString("utf8")));
proxy.stderr.on("data", (b) => (proxyOut += b.toString("utf8")));

const waitReady = async () => {
  for (let i = 0; i < 100; i += 1) {
    const ok = await new Promise((resolve) => {
      const { connect } = require("node:net");
      const s = connect(PORT, "127.0.0.1");
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("proxy did not become ready");
};

const before = await keyUsage();

try {
  await waitReady();
  const { createLlmClient } = await import(pathToFileURL(SDK_DIST).href);

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

  const connectExecution = () => ({
    async request(executionRef, req, { signal } = {}) {
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/responses`, {
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
    async close(executionRef, input_) {
      return { operationRef: input_.operationId, state: "applied" };
    },
  });

  const client = createLlmClient({ control, connectExecution });

  const task = {
    taskId: `next-family-criteria-${id}`,
    attempt: 1,
    profileId: "next-family-criteria",
    model: MODEL,
    accountRefs: ["openrouter-primary"],
    policy: { subjectRef: "synthetic-pilot", policyRevision: 1, bindingRevision: 1 },
    instructions,
    input,
    output: { mode: "json_schema", schema, strict: true },
    effort: "medium",
    maxOutputTokens: MAX_OUT,
    deadline: new Date(Date.now() + 240_000),
    decode: (value) => {
      const v = value;
      if (!v || !Array.isArray(v.assessments)) throw new Error("assessments missing");
      const ids = v.assessments.map((a) => a.requirementId);
      for (const c of CRITERIA) if (!ids.includes(c)) throw new Error(`missing ${c}`);
      if (new Set(ids).size !== ids.length) throw new Error("duplicate requirement id");
      return v;
    },
  };

  const started = Date.now();
  const result = await client.generate(task);
  const elapsedMs = Date.now() - started;
  const after = await keyUsage();

  const ledgerLines = fs.existsSync(ledger)
    ? fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  const forwarded = ledgerLines.filter((l) => l.decision === "forwarded");
  const chargedIn = forwarded.reduce((s, l) => s + (l.chargedInputTokens || 0), 0);
  const chargedOut = forwarded.reduce((s, l) => s + (l.chargedOutputTokens || 0), 0);

  const evidence = {
    schema: "next-family.criteria-assessment/v1",
    candidate: id,
    head,
    generatedAt: new Date().toISOString(),
    sdk: {
      package: "@agent-teams/account-gateway",
      version: "0.1.0",
      entry: "@agent-teams/account-gateway/llm -> createLlmClient()",
      mode: "caller-supplied control + execution ports (SDK encodes, streams and decodes)",
    },
    inputProfile: {
      packet: packetManifest.packet,
      rule: packetManifest.rule.revision,
      instructionsSha256: sha256(instructions),
      inputSha256: sha256(input),
    },
    requested: { model: MODEL, serviceTier: "default", effort: "medium", maxOutputTokens: MAX_OUT, outputMode: "json_schema", stream: true, store: false },
    result: result.ok
      ? { ok: true, usage: result.usage, receipt: result.receipt, cleanup: result.cleanup, value: result.value }
      : { ok: false, code: result.code, effect: result.effect, retry: result.retry, usage: result.usage, cleanup: result.cleanup },
    rawText: result.ok ? result.text : null,
    execution: {
      elapsedMs,
      inputBytes: forwarded.map((l) => l.inputBytes),
      forwardedRequests: forwarded.length,
      refusals: ledgerLines.filter((l) => l.decision === "refused").map((l) => l.code),
      charged: { inputTokens: chargedIn, outputTokens: chargedOut, usdConservative: Number(((chargedIn * 1.25) / 1e6 + (chargedOut * 5.0) / 1e6).toFixed(8)) },
      observedFromProxy: forwarded.map((l) => ({ status: l.status, model: l.observedModel, provider: l.observedProvider })),
    },
    providerKeyUsage: { before, after, delta: before !== "unavailable" && after !== "unavailable" ? Number((Number(after) - Number(before)).toFixed(8)) : "unavailable" },
  };

  fs.writeFileSync(path.join(runsDir, `criteria-assessment-${id}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  if (result.ok) fs.writeFileSync(path.join(runsDir, `criteria-output-${id}.txt`), `${result.text}\n`);
  console.log(JSON.stringify(evidence.result, null, 2));
} finally {
  proxy.kill("SIGKILL");
  fs.writeFileSync(path.join(runsDir, `criteria-proxy-${id}.log`), proxyOut);
}
