// WP7 SDK qualification: the exact packed `@agent-teams/account-gateway/llm`
// tarball, exercised through its real `createLlmClient()` `/llm` entry point
// against a loopback fake Responses API. No live model, provider, Gateway,
// credential or published package is involved.
//
// Usage (from the repository root, under the SDK's supported Node runtime):
//
//   SDK_PROJECT_DIR=<isolated install dir> node scripts/qualify-sdk.mjs
//
// `SDK_PROJECT_DIR` must contain the exact locally packed tarball installed as
// `@agent-teams/account-gateway`. Resolution goes through the package
// `exports` map, so the `./llm` subpath entry point is the one under test.
//
// Every scenario drives the real SDK and records the evidence it observed
// (request body actually received, ordering of access vs dispatch, outcome
// code, effect, cleanup, retry advice). Output is persisted as JSON.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const PROJECT_DIR = path.resolve(process.env.SDK_PROJECT_DIR ?? process.cwd());
const OUT_PATH = path.resolve(
  process.env.SDK_QUALIFICATION_OUT ?? path.join(PROJECT_DIR, "sdk-qualification.json"),
);
const IDENTITY_LOG = path.join(PROJECT_DIR, "request-identity.jsonl");

if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GATEWAY_TOKEN) {
  console.error("refusing to run: a provider credential is present in the environment");
  process.exit(2);
}

const requireFromProject = createRequire(path.join(PROJECT_DIR, "package.json"));
const llmEntry = requireFromProject.resolve("@agent-teams/account-gateway/llm");
const llm = await import(pathToFileURL(llmEntry).href);
const { createLlmClient } = llm;
// `./package.json` is not an exported subpath, so read the manifest from the
// installed package root derived from the resolved `./llm` entry point.
const installedRoot = path.resolve(path.dirname(llmEntry), "..", "..");
const installedPkg = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));

const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const results = [];
function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((evidence) => results.push({ name, ok: true, evidence: evidence ?? null }))
    .catch((e) => results.push({ name, ok: false, error: e.message }));
}

// --- loopback fake Responses server -----------------------------------------

function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const ev of events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  res.end();
}

function completedEvent(text, opts = {}) {
  const { model = "fake-model", id = "resp-1", usage = { input_tokens: 11, output_tokens: 7 }, refusal = false } = opts;
  const content = refusal ? [{ type: "refusal", refusal: "no" }] : [{ type: "output_text", text }];
  return { type: "response.completed", response: { id, model, output: [{ type: "message", content }], usage } };
}

function startFakeResponses() {
  return new Promise((resolve) => {
    const requests = [];
    const events = [];
    let mode = "complete";
    let payloadText = null;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString("utf8");
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = null;
      }
      requests.push({ method: req.method, url: req.url, body, payload, at: Date.now() });
      events.push({ kind: "dispatch", at: Date.now() });

      const text = payloadText ?? JSON.stringify({ assessments: [] });
      switch (mode) {
        case "malformed":
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end("data: { not json }\n\n");
          return;
        case "refusal":
          sse(res, [completedEvent("", { refusal: true })]);
          return;
        case "truncated":
          sse(res, [
            {
              type: "response.incomplete",
              response: {
                id: "r",
                model: "fake-model",
                incomplete_details: { reason: "max_output_tokens" },
                output: [],
                usage: {},
              },
            },
          ]);
          return;
        case "no-terminal":
          sse(res, [{ type: "response.output_text.delta", delta: "{" }]);
          return;
        case "stall":
          setTimeout(() => sse(res, [completedEvent(text)]), 3000);
          return;
        default:
          sse(res, [completedEvent(text)]);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        requests,
        events,
        setMode: (m, p) => {
          mode = m;
          payloadText = p ?? null;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// --- injected ports ---------------------------------------------------------

function makeControl(fake) {
  return {
    async runAccess(intent, options) {
      if (options?.signal?.aborted) {
        // Not reached in the cancellation scenarios: the SDK checks earlier.
      }
      // Persist request identity BEFORE any transport dispatch exists.
      fs.appendFileSync(
        IDENTITY_LOG,
        JSON.stringify({
          operationId: intent.operationId,
          invocationRef: intent.invocationRef,
          attemptRef: intent.attemptRef,
          accountRefs: intent.accountRefs,
          profileId: intent.profileId,
          limits: intent.limits,
          deadline: intent.deadline,
          at: Date.now(),
        }) + "\n",
      );
      fake.events.push({ kind: "access", at: Date.now() });
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
}

function makePorts(fake, opts = {}) {
  const control = opts.control ?? makeControl(fake);
  const connectExecution = () => ({
    async request(executionRef, req, { signal } = {}) {
      if (opts.requestThrows) throw new Error("transport link reset");
      const res = await fetch(`${fake.url}/v1/responses`, {
        method: "POST",
        body: req.body,
        headers: { "content-type": "application/json" },
        signal,
      });
      return {
        kind: "stream",
        requestRef: req.requestId,
        body: res.body,
        cancel: async () => {
          try {
            await res.body?.cancel();
          } catch {
            /* already consumed */
          }
        },
      };
    },
    async status(executionRef, requestId) {
      if (opts.statusThrows) throw new Error("status link reset");
      return opts.status ?? { requestRef: requestId, effect: "completed", status: "completed" };
    },
    async close(executionRef, input) {
      if (opts.closeThrows) throw new Error("close link reset");
      return opts.close ?? { operationRef: input.operationId, state: "applied" };
    },
  });
  return { control, connectExecution };
}

// --- task fixture -----------------------------------------------------------

const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"];
const SCHEMA = {
  type: "object",
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterionId: { type: "string" },
          outcome: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["criterionId", "outcome"],
      },
    },
  },
  required: ["assessments"],
};

function assessmentsFor(ids) {
  return ids.map((id) => ({ criterionId: id, outcome: "satisfied", explanation: "ok" }));
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
    input: "Assess AC-1..AC-5 for the supplied profile changes.",
    output: { mode: "json_schema", schema: SCHEMA },
    maxOutputTokens: 256,
    deadline: new Date(Date.now() + 60000),
    ...overrides,
  };
}

/** Consumer-side validation: every expected criterion exactly once. */
function strictDecode(expected) {
  return (value) => {
    const list = value?.assessments;
    if (!Array.isArray(list)) throw new Error("assessments must be an array");
    const ids = list.map((a) => a.criterionId);
    const missing = expected.filter((id) => !ids.includes(id));
    if (missing.length) throw new Error(`missing criterion IDs: ${missing.join(",")}`);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicates.length) throw new Error(`duplicate criterion IDs: ${duplicates.join(",")}`);
    const unknown = ids.filter((id) => !expected.includes(id));
    if (unknown.length) throw new Error(`unknown criterion IDs: ${unknown.join(",")}`);
    return list;
  };
}

const fake = await startFakeResponses();
const installedIdentity = {
  projectDir: PROJECT_DIR,
  entry: llmEntry,
  packageName: installedPkg.name,
  version: installedPkg.version,
  private: installedPkg.private,
  engines: installedPkg.engines,
  exports: Object.keys(installedPkg.exports ?? {}),
};

// 1. Successful bounded generation.
await record("success: bounded generation through the real /llm entry", async () => {
  fake.setMode("complete", JSON.stringify({ assessments: assessmentsFor(CRITERIA) }));
  const client = createLlmClient(makePorts(fake));
  const out = await client.generate(makeTask({ decode: strictDecode(CRITERIA) }));
  if (!out.ok) throw new Error(`expected success, got ${out.code}`);
  if (out.cleanup !== "closed") throw new Error(`cleanup ${out.cleanup}`);
  if (out.value.length !== 5) throw new Error("expected 5 assessments");
  if (!/^[0-9a-f]{64}$/.test(out.receipt.requestSha256)) throw new Error("bad requestSha256");
  if (!/^[0-9a-f]{64}$/.test(out.receipt.outputSha256)) throw new Error("bad outputSha256");
  if (out.receipt.taskId !== "qual-task" || out.receipt.attempt !== 1) throw new Error("bad receipt identity");
  if (out.receipt.model !== "fake-model") throw new Error("bad requested model");
  if (out.receipt.observedModel !== "fake-model") throw new Error("bad observed model");
  if (out.receipt.responseId !== "resp-1") throw new Error("bad response id");
  if (out.usage.inputTokens !== 11 || out.usage.outputTokens !== 7) throw new Error("bad usage");
  return {
    ok: true,
    cleanup: out.cleanup,
    receipt: out.receipt,
    usage: out.usage,
    valueCount: out.value.length,
  };
});

// 2. The actual request body received by the loopback server.
await record("request: loopback server receives the exact encoded Responses body", async () => {
  const sent = fake.requests[fake.requests.length - 1];
  if (!sent) throw new Error("no request was captured");
  const p = sent.payload;
  if (!p) throw new Error("request body was not JSON");
  const task = makeTask({ decode: strictDecode(CRITERIA) });
  if (p.model !== "fake-model") throw new Error("model");
  if (p.stream !== true) throw new Error("stream");
  if (p.store !== false) throw new Error("store");
  if (p.service_tier !== "default") throw new Error("service_tier");
  if (p.max_output_tokens !== 256) throw new Error("max_output_tokens");
  if (p.instructions !== task.instructions) throw new Error("instructions");
  if (p.input?.[0]?.content?.[0]?.text !== task.input) throw new Error("input text");
  if (p.text?.format?.type !== "json_schema") throw new Error("output format");
  if (p.text.format.name !== "codex_output_schema") throw new Error("output format name");
  if (p.text.format.strict !== true) throw new Error("strict");
  if (JSON.stringify(p.text.format.schema) !== JSON.stringify(SCHEMA)) throw new Error("schema not sent unchanged");
  if (p.reasoning !== undefined) throw new Error("reasoning sent without an explicit effort");
  return {
    bodySha256: sha256hex(sent.body),
    byteLength: Buffer.byteLength(sent.body),
    model: p.model,
    stream: p.stream,
    store: p.store,
    serviceTier: p.service_tier,
    maxOutputTokens: p.max_output_tokens,
    formatName: p.text.format.name,
  };
});

// 3. Request identity persisted before transport dispatch.
await record("identity: request identity is persisted before any transport dispatch", async () => {
  const lines = fs
    .readFileSync(IDENTITY_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const last = lines[lines.length - 1];
  if (!last) throw new Error("no persisted identity");
  if (last.invocationRef !== "qual-task" || last.attemptRef !== "a1") throw new Error("bad invocation/attempt ref");
  if (last.limits.requests !== 1 || last.limits.concurrency !== 1) throw new Error("bad configured caps in intent");
  const access = [...fake.events].reverse().find((e) => e.kind === "access");
  const dispatch = [...fake.events].reverse().find((e) => e.kind === "dispatch");
  if (!access || !dispatch) throw new Error("missing ordering evidence");
  if (!(access.at <= dispatch.at)) throw new Error("access did not precede dispatch");
  return { persistedIdentity: last, accessAt: access.at, dispatchAt: dispatch.at };
});

// 4-7. Consumer decode scenarios.
const decodeCases = [
  {
    name: "ids: missing criterion IDs are rejected as output_invalid",
    payload: assessmentsFor(["AC-1", "AC-3", "AC-4", "AC-5"]),
    expectError: /missing criterion IDs/,
  },
  {
    name: "ids: duplicate criterion IDs are rejected as output_invalid",
    payload: [...assessmentsFor(["AC-1", "AC-1", "AC-2", "AC-3", "AC-4", "AC-5"])],
    expectError: /duplicate criterion IDs/,
  },
  {
    name: "ids: unknown criterion IDs are rejected as output_invalid",
    payload: [...assessmentsFor(CRITERIA), { criterionId: "AC-99", outcome: "satisfied" }],
    expectError: /unknown criterion IDs/,
  },
];
for (const c of decodeCases) {
  await record(c.name, async () => {
    fake.setMode("complete", JSON.stringify({ assessments: c.payload }));
    const client = createLlmClient(makePorts(fake));
    const before = fake.requests.length;
    const out = await client.generate(makeTask({ taskId: "ids-task", decode: strictDecode(CRITERIA) }));
    if (out.ok) throw new Error("expected a decode rejection");
    if (out.code !== "output_invalid") throw new Error(`code ${out.code}`);
    if (out.effect !== "completed") throw new Error(`effect ${out.effect}`);
    if (out.text !== undefined) throw new Error("raw text exposed on failure");
    if (out.value !== undefined) throw new Error("value exposed on failure");
    if (fake.requests.length - before !== 1) throw new Error("more than one dispatch");
    return { code: out.code, effect: out.effect, cleanup: out.cleanup, retry: out.retry };
  });
}

await record("ids: partial valid records are preserved without invention", async () => {
  fake.setMode("complete", JSON.stringify({ assessments: assessmentsFor(["AC-1", "AC-2"]) }));
  const client = createLlmClient(makePorts(fake));
  const out = await client.generate(
    makeTask({
      taskId: "partial-task",
      decode: (value) => {
        const list = value.assessments;
        const ids = list.map((a) => a.criterionId);
        if (new Set(ids).size !== ids.length) throw new Error("duplicate");
        if (ids.some((id) => !CRITERIA.includes(id))) throw new Error("unknown");
        // Partial coverage is a real, reportable Profile B outcome.
        return list;
      },
    }),
  );
  if (!out.ok) throw new Error(`expected success, got ${out.code}`);
  if (out.value.length !== 2) throw new Error(`expected 2 records, got ${out.value.length}`);
  if (out.value.some((a) => !["AC-1", "AC-2"].includes(a.criterionId))) throw new Error("invented a record");
  return { valueCount: out.value.length, ids: out.value.map((a) => a.criterionId) };
});

// 8. Malformed JSON.
await record("transport: malformed provider JSON fails after one dispatch", async () => {
  fake.setMode("malformed");
  const client = createLlmClient(makePorts(fake));
  const before = fake.requests.length;
  const out = await client.generate(makeTask({ taskId: "malformed" }));
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "provider_failed") throw new Error(`code ${out.code}`);
  if (out.effect !== "response_started") throw new Error(`effect ${out.effect}`);
  if (fake.requests.length - before !== 1) throw new Error("dispatch count");
  return { code: out.code, effect: out.effect, cleanup: out.cleanup, retry: out.retry };
});

// 9. Truncated response.
await record("transport: truncated response maps to output_truncated", async () => {
  fake.setMode("truncated");
  const client = createLlmClient(makePorts(fake));
  const out = await client.generate(makeTask({ taskId: "truncated" }));
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "output_truncated") throw new Error(`code ${out.code}`);
  if (out.effect !== "completed") throw new Error(`effect ${out.effect}`);
  return { code: out.code, effect: out.effect, retry: out.retry, cleanup: out.cleanup };
});

// 10. Refusal.
await record("transport: refusal maps to output_refused with no retry advice", async () => {
  fake.setMode("refusal");
  const client = createLlmClient(makePorts(fake));
  const out = await client.generate(makeTask({ taskId: "refusal" }));
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "output_refused") throw new Error(`code ${out.code}`);
  if (out.retry.kind !== "never") throw new Error(`retry ${JSON.stringify(out.retry)}`);
  if (out.text !== undefined) throw new Error("raw text exposed");
  return { code: out.code, effect: out.effect, retry: out.retry, cleanup: out.cleanup };
});

// 11. Unknown SDK effect: transport loss with no usable readback.
await record("effect: unreadable transport loss yields effect_unknown", async () => {
  fake.setMode("complete");
  const client = createLlmClient(makePorts(fake, { requestThrows: true, statusThrows: true }));
  const out = await client.generate(makeTask({ taskId: "effect-unknown" }));
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "effect_unknown") throw new Error(`code ${out.code}`);
  if (out.effect !== "effect_unknown") throw new Error(`effect ${out.effect}`);
  if (out.retry.kind !== "new_attempt" || out.retry.mayDuplicateCost !== true) {
    throw new Error(`retry ${JSON.stringify(out.retry)}`);
  }
  return { code: out.code, effect: out.effect, retry: out.retry, cleanup: out.cleanup };
});

// 12. Timeout (task deadline).
await record("timeout: deadline expiry maps to the deadline code", async () => {
  fake.setMode("stall");
  const client = createLlmClient(makePorts(fake));
  const out = await client.generate(makeTask({ taskId: "timeout", deadline: new Date(Date.now() + 700) }));
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "deadline") throw new Error(`code ${out.code}`);
  return { code: out.code, effect: out.effect, retry: out.retry, cleanup: out.cleanup };
});

// 13. Cancellation.
await record("cancellation: pre-dispatch abort is cancelled/not_dispatched", async () => {
  fake.setMode("complete");
  const client = createLlmClient(makePorts(fake));
  const ac = new AbortController();
  ac.abort();
  const before = fake.requests.length;
  const out = await client.generate(makeTask({ taskId: "cancel-pre" }), { signal: ac.signal });
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "cancelled") throw new Error(`code ${out.code}`);
  if (out.effect !== "not_dispatched") throw new Error(`effect ${out.effect}`);
  if (fake.requests.length - before !== 0) throw new Error("dispatched after cancellation");
  return { code: out.code, effect: out.effect, cleanup: out.cleanup, dispatches: fake.requests.length - before };
});

await record("cancellation: mid-flight abort stops the attempt without a retry", async () => {
  fake.setMode("stall");
  const client = createLlmClient(makePorts(fake));
  const ac = new AbortController();
  const before = fake.requests.length;
  const p = client.generate(makeTask({ taskId: "cancel-mid", deadline: new Date(Date.now() + 20000) }), {
    signal: ac.signal,
  });
  const poll = setInterval(() => {
    if (fake.requests.length > before) {
      clearInterval(poll);
      ac.abort();
    }
  }, 10);
  const out = await p;
  clearInterval(poll);
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "cancelled") throw new Error(`code ${out.code}`);
  if (fake.requests.length - before !== 1) throw new Error("expected exactly one dispatch");
  return { code: out.code, effect: out.effect, cleanup: out.cleanup };
});

// 14. Pending cleanup.
await record("cleanup: unacknowledged close is reported as pending", async () => {
  fake.setMode("complete", JSON.stringify({ assessments: assessmentsFor(CRITERIA) }));
  const client = createLlmClient(
    makePorts(fake, { close: { operationRef: "not-the-close-id", state: "failed" } }),
  );
  const out = await client.generate(makeTask({ taskId: "pending-cleanup", decode: strictDecode(CRITERIA) }));
  if (!out.ok) throw new Error(`expected success, got ${out.code}`);
  if (out.cleanup !== "pending") throw new Error(`cleanup ${out.cleanup}`);
  return { cleanup: out.cleanup };
});

// 15. Raw-unavailable state.
await record("raw: failure exposes no raw output, success exposes the exact text", async () => {
  fake.setMode("truncated");
  const client = createLlmClient(makePorts(fake));
  const failed = await client.generate(makeTask({ taskId: "raw-unavailable" }));
  if (failed.ok) throw new Error("expected failure");
  if ("text" in failed) throw new Error("failure object carries raw text");
  if ("value" in failed) throw new Error("failure object carries a value");
  // Usage may only reflect what the stream actually reported; a pre-dispatch
  // failure must not carry usage at all.
  if (failed.usage !== null) {
    const fields = Object.values(failed.usage);
    if (fields.some((v) => v !== null && typeof v !== "number")) {
      throw new Error("failure usage is not a bounded observation");
    }
  }
  const preDispatch = await client.generate(makeTask({ taskId: "raw-unavailable-caps", maxOutputTokens: 0 }));
  if (preDispatch.ok) throw new Error("expected a pre-dispatch rejection");
  if (preDispatch.code !== "invalid_task") throw new Error(`pre-dispatch code ${preDispatch.code}`);
  if (preDispatch.usage !== null) throw new Error("pre-dispatch failure invents usage");

  fake.setMode("complete", JSON.stringify({ assessments: assessmentsFor(CRITERIA) }));
  const okOut = await client.generate(makeTask({ taskId: "raw-available", decode: strictDecode(CRITERIA) }));
  if (!okOut.ok) throw new Error("expected success");
  if (typeof okOut.text !== "string" || okOut.text.length === 0) throw new Error("success did not expose raw text");
  if (sha256hex(okOut.text) !== okOut.receipt.outputSha256) throw new Error("outputSha256 does not match the raw text");
  return {
    failureKeys: Object.keys(failed).sort(),
    rawUnavailable: true,
    failedUsage: failed.usage,
    preDispatchUsage: preDispatch.usage,
    successTextBytes: Buffer.byteLength(okOut.text),
  };
});

// 16. Readback mapping.
await record("readback: a lost stream is classified from the status readback", async () => {
  fake.setMode("complete");
  const client = createLlmClient(
    makePorts(fake, { requestThrows: true, status: { effect: "completed", status: "completed" } }),
  );
  const out = await client.generate(makeTask({ taskId: "readback" }));
  if (out.ok) throw new Error("expected failure");
  if (out.code !== "output_lost") throw new Error(`code ${out.code}`);
  if (out.effect !== "completed") throw new Error(`effect ${out.effect}`);
  return { code: out.code, effect: out.effect, retry: out.retry, cleanup: out.cleanup };
});

// 17. Configured caps.
await record("caps: SDK acceptance ceilings reject an over-limit task as invalid_task", async () => {
  const cases = [
    { label: "maxOutputTokens > LLM_MAX_OUTPUT_TOKENS", overrides: { maxOutputTokens: 100001 } },
    { label: "deadline beyond one hour", overrides: { deadline: new Date(Date.now() + 2 * 3600 * 1000) } },
    { label: "deadline in the past", overrides: { deadline: new Date(Date.now() - 1000) } },
    { label: "outputBytes above the output ceiling", overrides: { limits: { outputBytes: 8_388_609 } } },
    { label: "attempt below one", overrides: { attempt: 0 } },
    { label: "empty accountRefs", overrides: { accountRefs: [] } },
  ];
  const observed = [];
  for (const c of cases) {
    const client = createLlmClient(makePorts(fake));
    const before = fake.requests.length;
    const out = await client.generate(makeTask({ taskId: "caps", ...c.overrides }));
    if (out.ok) throw new Error(`${c.label}: expected rejection`);
    if (out.code !== "invalid_task") throw new Error(`${c.label}: code ${out.code}`);
    if (out.effect !== "not_dispatched") throw new Error(`${c.label}: effect ${out.effect}`);
    if (out.cleanup !== "not_needed") throw new Error(`${c.label}: cleanup ${out.cleanup}`);
    if (out.retry.kind !== "never") throw new Error(`${c.label}: retry ${JSON.stringify(out.retry)}`);
    if (fake.requests.length - before !== 0) throw new Error(`${c.label}: dispatched`);
    observed.push({ case: c.label, code: out.code, effect: out.effect });
  }
  return { ceilings: { outputTokens: 100000, deadlineMs: 3600000, outputBytes: 8388608 }, observed };
});

// 18. No automatic inference retry.
await record("retry: no automatic inference retry in any failure mode", async () => {
  const modes = ["malformed", "truncated", "refusal"];
  const observed = [];
  for (const mode of modes) {
    fake.setMode(mode);
    const client = createLlmClient(makePorts(fake));
    const before = fake.requests.length;
    const out = await client.generate(makeTask({ taskId: `no-retry-${mode}` }));
    if (out.ok) throw new Error(`${mode}: expected failure`);
    const dispatches = fake.requests.length - before;
    if (dispatches !== 1) throw new Error(`${mode}: ${dispatches} dispatches`);
    observed.push({ mode, code: out.code, dispatches });
  }
  return { observed };
});

// 19. No fallback/replay consuming another attempt.
await record("fallback: failures never replay the attempt or consume another one", async () => {
  const observed = [];
  for (const mode of ["malformed", "truncated", "no-terminal"]) {
    fake.setMode(mode);
    const client = createLlmClient(makePorts(fake));
    const before = fake.requests.length;
    const taskId = `no-fallback-${mode}`;
    const out = await client.generate(
      makeTask({ taskId, attempt: 3, deadline: new Date(Date.now() + 20000) }),
    );
    if (out.ok) throw new Error(`${mode}: expected failure`);
    if (out.retry.kind === "same_attempt") {
      throw new Error(`${mode}: inference failure must not advise an identical replay`);
    }
    // The attempt identity must stay a3: nothing consumed attempt 4.
    if (out.execution && out.execution.requestRef !== `${taskId}-a3-r`) {
      throw new Error(`${mode}: unexpected request identity ${out.execution.requestRef}`);
    }
    const dispatches = fake.requests.length - before;
    if (dispatches !== 1) throw new Error(`${mode}: ${dispatches} dispatches`);
    observed.push({ mode, code: out.code, retry: out.retry, dispatches, requestRef: out.execution?.requestRef ?? null });
  }
  return { observed };
});

await fake.close();

const failed = results.filter((r) => !r.ok);
const summary = {
  schema: "m2.sdk-qualification/v1",
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  installedIdentity,
  environment: {
    liveProviderCalls: 0,
    credentialVariables: 0,
    published: false,
    loopbackOnly: true,
  },
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  scenarios: results,
};
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : ` :: ${r.error}`}`);
console.log(`\nSDK qualification (${process.version}, ${summary.platform}): ${summary.passed}/${summary.total} passed`);
console.log(`evidence: ${OUT_PATH}`);
process.exit(failed.length ? 1 : 0);
