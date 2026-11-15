// WP7 SDK qualification: real @agent-teams/account-gateway/llm with injected
// control/execution ports and a loopback fake Responses API. No live provider.
import http from "node:http";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createLlmClient } from "@agent-teams/account-gateway/llm";

const results = [];
function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((e) => results.push({ name, ok: false, error: e.message }));
}

function startFakeResponses(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString("utf8");
      let payload = null;
      try { payload = JSON.parse(body); } catch { payload = null; }
      requests.push({ method: req.method, url: req.url, body, payload });
      handler(req, res, payload, requests);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const ev of events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  res.end();
}

function completedEvent(text, { model = "fake-model", id = "resp-1", usage = { input_tokens: 11, output_tokens: 7 }, refusal = false } = {}) {
  const content = refusal
    ? [{ type: "refusal", refusal: "no" }]
    : [{ type: "output_text", text }];
  return { type: "response.completed", response: { id, model, output: [{ type: "message", content }], usage } };
}

function makePorts(fakeUrl) {
  const control = {
    async runAccess(intent) {
      const accountRef = intent.accountRefs[0];
      const executionRef = `exec_${intent.operationId}`;
      return {
        operation: {
          operationRef: intent.operationId,
          state: "applied",
          result: {
            kind: "execution",
            executionRef,
            accountRef,
            authorizationEpoch: 1,
            deadline: intent.deadline,
            state: "active",
          },
        },
        bearer: "qualification-bearer-token-0123456789",
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
    async request(executionRef, req) {
      const res = await fetch(`${fakeUrl}/v1/responses`, { method: "POST", body: req.body });
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

function makeTask(overrides = {}) {
  return {
    taskId: "qual-task",
    attempt: 1,
    profileId: "profile-b",
    model: "fake-model",
    accountRefs: ["acct_qual"],
    policy: { subjectRef: "subj_qual", policyRevision: 1, bindingRevision: 1 },
    instructions: "Assess every criterion.",
    input: "AC-1..AC-5",
    output: { mode: "json_schema", schema: { type: "object" } },
    maxOutputTokens: 256,
    deadline: new Date(Date.now() + 30000),
    ...overrides,
  };
}

const jsonText = JSON.stringify({ assessments: [{ criterionId: "AC-1", outcome: "satisfied", evidenceRefs: [], explanation: "ok" }] });

await record("SDK: exports and identity", async () => {
  const mod = await import("@agent-teams/account-gateway/llm");
  assert.equal(typeof mod.createLlmClient, "function");
  assert.equal(typeof mod.executionConnector, "function");
});

const fake = await startFakeResponses((req, res, payload, requests) => {
  const mode = req.headers["x-fake-mode"] || "complete";
  if (mode === "malformed") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("data: { not json }\n\n");
    return;
  }
  if (mode === "refusal") { sse(res, [completedEvent("", { refusal: true })]); return; }
  if (mode === "truncated") { sse(res, [{ type: "response.incomplete", response: { id: "r", model: "fake-model", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: {} } }]); return; }
  if (mode === "no-terminal") { sse(res, [{ type: "response.output_text.delta", delta: "{" }]); return; }
  if (mode === "slow") { setTimeout(() => sse(res, [completedEvent(jsonText)]), 5000); return; }
  sse(res, [completedEvent(jsonText)]);
});

await record("SDK: success returns receipt, usage and cleanup", async () => {
  const { control, connectExecution } = makePorts(fake.url);
  const client = createLlmClient({ control, connectExecution });
  const task = makeTask();
  const out = await client.generate(task);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.cleanup, "closed");
  assert.match(out.receipt.requestSha256, /^[0-9a-f]{64}$/);
  assert.match(out.receipt.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(out.receipt.taskId, "qual-task");
  assert.equal(out.receipt.attempt, 1);
  assert.equal(out.value.assessments[0].criterionId, "AC-1");
  assert.ok(fake.requests.length >= 1);
  const sent = fake.requests[fake.requests.length - 1].payload;
  assert.equal(sent.model, "fake-model");
  assert.equal(sent.stream, true);
  assert.equal(sent.max_output_tokens, 256);
});

await record("SDK: no automatic retry (exactly one provider request)", async () => {
  const { control, connectExecution } = makePorts(fake.url);
  const client = createLlmClient({ control, connectExecution });
  const before = fake.requests.length;
  const out = await client.generate(makeTask({ attempt: 2 }));
  assert.equal(out.ok, true);
  assert.equal(fake.requests.length - before, 1, "exactly one provider dispatch");
});

await record("SDK: cancellation before dispatch -> cancelled/not_dispatched", async () => {
  const { control, connectExecution } = makePorts(fake.url);
  const client = createLlmClient({ control, connectExecution });
  const ac = new AbortController();
  ac.abort();
  const before = fake.requests.length;
  const out = await client.generate(makeTask({ taskId: "cancelled" }), { signal: ac.signal });
  assert.equal(out.ok, false);
  assert.equal(out.code, "cancelled");
  assert.equal(out.effect, "not_dispatched");
  assert.equal(fake.requests.length - before, 0, "no dispatch after cancellation");
});

await record("SDK: decode rejection -> output_invalid, raw text not exposed", async () => {
  const { control, connectExecution } = makePorts(fake.url);
  const client = createLlmClient({ control, connectExecution });
  const out = await client.generate(makeTask({
    taskId: "decode",
    decode: () => { throw new Error("missing AC-2"); },
  }));
  assert.equal(out.ok, false);
  assert.equal(out.code, "output_invalid");
  assert.equal(out.text, undefined, "SDK failure exposes no raw text");
});

await record("SDK: duplicate/unknown criterion IDs are a consumer decode concern", async () => {
  const { control, connectExecution } = makePorts(fake.url);
  const client = createLlmClient({ control, connectExecution });
  const seen = [];
  const out = await client.generate(makeTask({
    taskId: "ids",
    decode: (v) => {
      const ids = v.assessments.map((a) => a.criterionId);
      seen.push(...ids);
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      if (dup.length) throw new Error("duplicate");
      return v;
    },
  }));
  assert.equal(out.ok, true);
  assert.deepEqual(seen, ["AC-1"]);
});

await fake.close();

// Mode-specific server for failure cases that need headers.
const modeServer = await startFakeResponses((req, res) => {
  const mode = req.headers["x-fake-mode"];
  if (mode === "malformed") { res.writeHead(200); res.end("data: { not json }\n\n"); return; }
  if (mode === "refusal") { sse(res, [completedEvent("", { refusal: true })]); return; }
  if (mode === "truncated") { sse(res, [{ type: "response.incomplete", response: { id: "r", model: "m", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: {} } }]); return; }
  if (mode === "no-terminal") { sse(res, [{ type: "response.output_text.delta", delta: "{" }]); return; }
  sse(res, [completedEvent(jsonText)]);
});

// Re-run the mode-driven cases against modeServer using a header-injecting fetch.
function headerPorts(baseUrl, mode) {
  const control = {
    async runAccess(intent) {
      const accountRef = intent.accountRefs[0];
      return {
        operation: { operationRef: intent.operationId, state: "applied", result: { kind: "execution", executionRef: `exec_${intent.operationId}`, accountRef, authorizationEpoch: 1, deadline: intent.deadline, state: "active" } },
        bearer: "qualification-bearer-token-0123456789",
        admission: { invocationRef: intent.invocationRef, attemptRef: intent.attemptRef, accountRef, authorizationEpoch: 1, subjectRef: intent.subjectRef, policyRevision: intent.policyRevision, bindingRevision: intent.bindingRevision, profileId: intent.profileId, limits: { ...intent.limits }, expiresAt: intent.deadline },
      };
    },
  };
  const connectExecution = () => ({
    async request(executionRef, req) {
      const res = await fetch(`${baseUrl}/v1/responses`, { method: "POST", body: req.body, headers: { "x-fake-mode": mode } });
      return { kind: "stream", requestRef: req.requestId, body: res.body, cancel: async () => {} };
    },
    async status(executionRef, requestId) { return { requestRef: requestId, effect: "completed", status: "completed" }; },
    async close(executionRef, input) { return { operationRef: input.operationId, state: "applied" }; },
  });
  return { control, connectExecution };
}

for (const mode of ["malformed", "refusal", "truncated", "no-terminal"]) {
  await record(`SDK[${mode}]: single dispatch and mapped outcome`, async () => {
    const ports = headerPorts(modeServer.url, mode);
    const client = createLlmClient(ports);
    const before = modeServer.requests.length;
    const out = await client.generate(makeTask({ taskId: `m-${mode}` }));
    assert.equal(out.ok, false);
    assert.equal(modeServer.requests.length - before, 1);
    assert.ok(["output_invalid","output_refused","output_truncated","provider_failed","output_lost","effect_unknown"].includes(out.code), out.code);
  });
}

await modeServer.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : " :: " + r.error}`);
console.log(`\nSDK qualification: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
process.exit(failed.length ? 1 : 0);
