// Criteria Assessment recheck through the pinned Gateway SDK `/llm` path.
//
//   node criteria.mjs B
//
// Same SDK entry (`createLlmClient()`), same instructions, same JSON schema, same
// model, same requested service tier and reasoning effort, and the same input
// profile as the frozen initial call. The only differences are the candidate
// content and the head identity; the changed-file inventory is computed from the
// candidate's own diff against the frozen base, which is the same rule the
// initial profile used.
//
// One attempt, no retry, no fallback. The bounded proxy holds the credential and
// enforces request, byte and token ceilings.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const LABEL = (process.argv[2] ?? "").toUpperCase();
if (!["A", "B"].includes(LABEL)) {
  console.error("usage: node criteria.mjs A|B");
  process.exit(2);
}

const SDK_DIST = "D:/Project/agent-teams-ai-task-verification-m2/.isolation-tmp/d12/sdk-src/packages/account-gateway/dist/llm/index.js";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SYN = path.resolve(dir, "../..");
const PROXY = path.join(SYN, "tooling", "openrouter-bounded-proxy.mjs");
const repo = path.join(SYN, "repo");
const PORT = 8788;
const MODEL = "openai/gpt-6.1-terra";
const BASE = "ce99b0d65d645124413a746ecb137b5497aad80f";
const HEADS = { A: "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9", B: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
const HEAD = HEADS[LABEL];

if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_BASE_URL) {
  console.error("FATAL: OPENROUTER_API_KEY and OPENROUTER_BASE_URL must be set in this shell");
  process.exit(2);
}

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const show = (rev, p) => git("show", `${rev}:${p}`);

const requirements = fs.readFileSync(path.join(SYN, "requirements", "RECORD-API-v1.md"), "utf8");
const pr = JSON.parse(fs.readFileSync(path.join(SYN, "metadata", "pr.json"), "utf8"));
if (sha256(requirements) !== "ca868a3fcc2a9100eabda736c48a8e107125a1f5a8477eede3665be96bde727f") {
  throw new Error("requirements digest changed");
}

// Same input profile rule as the initial call: every file changed by the
// candidate against the frozen base, plus the frozen unchanged context.
const changedPaths = git("diff", "--name-only", BASE, HEAD).trim().split("\n").filter(Boolean).sort();
const unchangedPaths = pr.unchangedContext.map((c) => c.path);
const changed = changedPaths.map((p) => ({ path: p, body: show(HEAD, p) }));
const unchanged = unchangedPaths.map((p) => ({ path: p, body: show(HEAD, p) }));
const filesBlock = [
  ...changed.map((f) => `### ${f.path} (changed)\n${f.body}`),
  ...unchanged.map((f) => `### ${f.path} (unchanged)\n${f.body}`),
].join("\n\n");

const input = [
  `# Frozen requirements (record-api-req-v1)\n\n${requirements}`,
  `# Pull request\n\nTitle: ${pr.title}\n\n${pr.body}`,
  `# Commit identity\n\nbase ${BASE}\nhead ${HEAD}`,
  `# Repository content at the candidate\n\n${filesBlock}`,
].join("\n\n");

// Frozen verbatim from the initial stage.
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
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "status", "evidence", "explanation", "correction"],
        properties: {
          requirementId: { type: "string", enum: ["R1", "R2", "R3"] },
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

const ledger = path.join(dir, `ledger-criteria-${LABEL}.jsonl`);
fs.rmSync(ledger, { force: true });

const proxy = spawn(
  process.execPath,
  [
    PROXY,
    "--stage", `d12-recheck-criteria-${LABEL}`,
    "--port", String(PORT),
    "--max-requests", "1",
    "--max-input-tokens", "20000",
    "--max-output-tokens", "4000",
    "--request-input-tokens", "20000",
    "--request-output-tokens", "4000",
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
    taskId: `d12-recheck-criteria-${LABEL}`,
    attempt: 1,
    profileId: "synthetic-d12-criteria",
    model: MODEL,
    accountRefs: ["openrouter-primary"],
    policy: { subjectRef: "synthetic-pilot", policyRevision: 1, bindingRevision: 1 },
    instructions,
    input,
    output: { mode: "json_schema", schema, strict: true },
    effort: "medium",
    maxOutputTokens: 4000,
    deadline: new Date(Date.now() + 240_000),
    decode: (value) => {
      const v = value;
      if (!v || !Array.isArray(v.assessments)) throw new Error("assessments missing");
      const ids = v.assessments.map((a) => a.requirementId);
      for (const id of ["R1", "R2", "R3"]) if (!ids.includes(id)) throw new Error(`missing ${id}`);
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
    schema: "d12.criteria-assessment/v1",
    label: LABEL,
    generatedAt: new Date().toISOString(),
    sdk: {
      package: "@agent-teams/account-gateway",
      version: "0.1.0",
      entry: "@agent-teams/account-gateway/llm -> createLlmClient()",
      distPath: SDK_DIST.replace(SYN, "<repo>"),
      mode: "caller-supplied control + execution ports (SDK encodes, streams and decodes)",
    },
    inputProfile: { changedPaths, unchangedPaths, instructionsSha256: sha256(instructions), inputSha256: sha256(input), head: HEAD },
    requested: { model: MODEL, serviceTier: "default", effort: "medium", maxOutputTokens: 4000, outputMode: "json_schema", stream: true, store: false },
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
    proxyArgs: { maxRequests: 1, maxInputTokens: 20000, maxOutputTokens: 4000, requestInputCeilingBytes: 20000 },
  };

  fs.writeFileSync(path.join(dir, `criteria-assessment-${LABEL}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  if (result.ok) fs.writeFileSync(path.join(dir, `criteria-output-${LABEL}.txt`), `${result.text}\n`);
  console.log(JSON.stringify(evidence.result, null, 2));
} finally {
  proxy.kill("SIGKILL");
  fs.writeFileSync(path.join(dir, `criteria-proxy-${LABEL}.log`), proxyOut);
}
