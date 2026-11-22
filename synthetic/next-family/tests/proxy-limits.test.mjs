// The bounded proxy is the only component that holds a credential and forwards.
// These tests drive it against a local stub upstream: no provider, no credential,
// no billable call.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { pathToFileURL } from "node:url";

import { FAMILY_ROOT, SDK_LLM_DIST, proxyPath } from "../lib/paths.mjs";
import { PROFILE, buildTask, loadFamily, loadPacket } from "../lib/task.mjs";
import { capturingExecution, measureSerializedRequest, offlineControl } from "../lib/measure.mjs";
import {
  INPUT_BODY_BYTES,
  INPUT_TOKEN_CEILING,
  MAX_OUTPUT_TOKENS,
  criteriaProxyArgs,
} from "../lib/limits.mjs";

const SENTINEL = "offline-sentinel-not-a-credential";
const family = loadFamily(FAMILY_ROOT);
const { createLlmClient } = await import(pathToFileURL(SDK_LLM_DIST).href);

function startStub(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls.push({ path: req.url, body });
      handler(req, res, body, calls.length);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const okReply = (extra = {}) =>
  JSON.stringify({
    id: "stub-1",
    model: PROFILE.model,
    provider: "OpenRouter",
    output: [],
    usage: { input_tokens: 1_000, output_tokens: 200 },
    ...extra,
  });

function startProxy({ stubPort, extra = [], port: fixedPort = 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-family-proxy-"));
  const ledger = path.join(dir, "ledger.jsonl");
  const args = [
    ...criteriaProxyArgs({
      stageId: "test-criteria",
      port: fixedPort,
      ledgerPath: ledger,
      model: PROFILE.model,
      serviceTier: PROFILE.serviceTier,
    }),
    // The launcher runs one proxy per attempt; these tests reuse one proxy for
    // several requests, so the *stage* budget is widened while every per-request
    // ceiling stays exactly what the launcher passes.
    "--max-input-tokens",
    "400000",
    "--max-output-tokens",
    "40000",
    "--upstream",
    `http://127.0.0.1:${stubPort}`,
    "--allow-insecure-upstream",
    ...extra,
  ];
  // The appearance order does not matter; later values win in the parser, so the
  // canonical arguments above stay authoritative unless a test overrides them.
  const child = spawn(process.execPath, [proxyPath(), ...args], {
    env: { PATH: process.env.PATH, OPENROUTER_API_KEY: SENTINEL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`proxy did not start: ${stderr}${stdout}`)), 6_000);
    child.stdout.on("data", () => {
      const match = stdout.match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({
          port: Number(match[1]),
          ledger,
          out: () => stdout + stderr,
          close: () => child.kill(),
          read: () =>
            fs.existsSync(ledger)
              ? fs
                  .readFileSync(ledger, "utf8")
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => JSON.parse(line))
              : [],
        });
      }
    });
  });
}

function startProxyExpectingExit(args) {
  const child = spawn(process.execPath, [proxyPath(), ...args], {
    env: { PATH: process.env.PATH, OPENROUTER_API_KEY: SENTINEL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve) => child.on("exit", (code) => resolve({ code, stderr })));
}

const post = (port, body) =>
  fetch(`http://127.0.0.1:${port}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const bodyOfExactBytes = (model, bytes) => {
  const prefix = JSON.stringify({ model, input: "" }).length;
  return JSON.stringify({ model, input: "a".repeat(bytes - prefix) });
};

const measuredBodies = {};
const bodies = {};
for (const candidateId of Object.keys(family.candidates)) {
  const packet = loadPacket(candidateId, family);
  const task = buildTask({ candidateId, stageId: "criteria", packetText: packet.text, maxOutputTokens: MAX_OUTPUT_TOKENS });
  measuredBodies[candidateId] = await measureSerializedRequest(task);
  let captured = null;
  const client = createLlmClient({
    control: offlineControl(),
    connectExecution: capturingExecution((body) => {
      captured = Buffer.from(body).toString("utf8");
    }),
  });
  await client.generate(task);
  if (captured === null) throw new Error(`no body captured for ${candidateId}`);
  bodies[candidateId] = captured;
  assert.equal(Buffer.byteLength(captured, "utf8"), measuredBodies[candidateId].bodyBytes);
}

test("all three real serialized bodies are admitted and charged as reported", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply());
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const statuses = {};
  for (const candidateId of Object.keys(bodies)) {
    const response = await post(proxy.port, bodies[candidateId]);
    statuses[candidateId] = response.status;
    assert.notEqual(await response.text(), "");
  }
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.deepEqual(statuses, { c01: 200, c02: 200, c03: 200 }, "the D3 413 must be gone");
  const forwarded = ledger.filter((line) => line.decision === "forwarded");
  assert.equal(forwarded.length, 3);
  assert.equal(stub.calls.length, 3);
  const expectedBytes = Object.values(bodies).map((body) => Buffer.byteLength(body, "utf8")).sort((a, b) => a - b);
  assert.deepEqual(
    forwarded.map((line) => line.inputBytes).sort((a, b) => a - b),
    expectedBytes,
    "each measured body was forwarded exactly once, at its measured size",
  );
  for (const line of forwarded) {
    assert.equal(line.bodyByteCeiling, INPUT_BODY_BYTES);
    assert.equal(line.inputTokenCeiling, INPUT_TOKEN_CEILING);
    assert.ok(line.inputBytes <= INPUT_BODY_BYTES);
    assert.equal(line.chargedInputTokens, 1_000, "reported usage is authoritative");
    assert.equal(line.chargedOutputTokens, 200);
    assert.equal(line.identityVerified, true);
    assert.equal(line.providerVerified, true);
    assert.equal(line.halted, null);
  }
});

test("the exact byte ceiling is admitted and one byte more is refused", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply());
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const atBound = bodyOfExactBytes(PROFILE.model, INPUT_BODY_BYTES);
  const overBound = bodyOfExactBytes(PROFILE.model, INPUT_BODY_BYTES + 1);
  assert.equal(Buffer.byteLength(atBound, "utf8"), INPUT_BODY_BYTES);
  assert.equal(Buffer.byteLength(overBound, "utf8"), INPUT_BODY_BYTES + 1);

  const admitted = await post(proxy.port, atBound);
  const refused = await post(proxy.port, overBound);
  await admitted.text();
  const refusedBody = await refused.json();
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(admitted.status, 200);
  assert.equal(refused.status, 413);
  assert.equal(refusedBody.error.code, "proxy_input_ceiling_exceeded");
  assert.equal(stub.calls.length, 1, "the over-bound body never reaches the upstream");
  const forwarded = ledger.filter((line) => line.decision === "forwarded");
  assert.equal(forwarded[0].inputBytes, INPUT_BODY_BYTES);
  const refusal = ledger.find((line) => line.decision === "refused");
  assert.equal(refusal.code, "proxy_input_ceiling_exceeded");
  assert.equal(refusal.bodyByteCeiling, INPUT_BODY_BYTES);
  assert.equal(refusal.inputTokenCeiling, INPUT_TOKEN_CEILING);
});

test("a token ceiling that cannot dominate the byte ceiling refuses to start", async () => {
  // The D3 configuration: a 16,000-token ceiling with 28,672 admitted bytes.
  const result = await startProxyExpectingExit([
    "--stage", "startup-check",
    "--max-requests", "1",
    "--request-input-bytes", String(INPUT_BODY_BYTES),
    "--request-input-tokens", "16000",
    "--input-special-token-allowance", "64",
    "--model", PROFILE.model,
  ]);
  assert.equal(result.code, 2, "the proxy must not start with an unfundable reservation");
  assert.match(result.stderr, /does not dominate the admitted body bytes/);
});

test("concurrent requests cannot exceed the request cap", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply());
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "1"] });
  const body = bodyOfExactBytes(PROFILE.model, 1_000);
  const responses = await Promise.all([1, 2, 3, 4, 5].map(() => post(proxy.port, body)));
  const statuses = responses.map((response) => response.status);
  await Promise.all(responses.map((response) => response.text()));
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(statuses.filter((status) => status === 200).length, 1, "exactly one request is forwarded");
  assert.equal(statuses.filter((status) => status === 429).length, 4);
  assert.equal(ledger.filter((line) => line.decision === "forwarded").length, 1);
  assert.equal(stub.calls.length, 1);
});

test("model, tier, effort and output substitution are refused before forwarding", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply());
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "8"] });
  const base = { model: PROFILE.model, input: "hello" };

  const wrongModel = await post(proxy.port, { ...base, model: "openai/gpt-6.1-terra-mini" });
  const wrongTier = await post(proxy.port, { ...base, service_tier: "flex" });
  const wrongEffort = await post(proxy.port, { ...base, reasoning: { effort: "high" } });
  const tooMuchOutput = await post(proxy.port, { ...base, max_output_tokens: MAX_OUTPUT_TOKENS + 1 });
  const bodies = await Promise.all([wrongModel, wrongTier, wrongEffort, tooMuchOutput].map((response) => response.json()));
  proxy.close();
  stub.close();

  assert.deepEqual(
    [wrongModel.status, wrongTier.status, wrongEffort.status, tooMuchOutput.status],
    [400, 400, 400, 413],
  );
  assert.deepEqual(
    bodies.map((body) => body.error.code),
    ["proxy_policy_model", "proxy_policy_service_tier", "proxy_policy_reasoning_effort", "proxy_output_ceiling_exceeded"],
  );
  assert.equal(stub.calls.length, 0, "no substituted request reaches the provider");
});

test("an observed model substitution halts the run and withholds the reply", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply({ model: "openai/gpt-6.1-terra-mini" }));
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const first = await post(proxy.port, { model: PROFILE.model, input: "hello" });
  const firstBody = await first.json();
  const second = await post(proxy.port, { model: PROFILE.model, input: "hello again" });
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(first.status, 502, "a substituted model is never handed to the caller");
  assert.equal(firstBody.error.code, "proxy_observed_model_mismatch");
  assert.equal(second.status, 402, "no retry, no fallback: the run is halted");
  assert.equal(stub.calls.length, 1, "no second upstream request");
  const forwarded = ledger.filter((line) => line.decision === "forwarded");
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].halted, "proxy_observed_model_mismatch");
  assert.equal(forwarded[0].identityVerified, false);
});

test("a missing observed model halts when identity verification is required", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "stub", output: [], usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const response = await post(proxy.port, { model: PROFILE.model, input: "hello" });
  const body = await response.json();
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(response.status, 502);
  assert.equal(body.error.code, "proxy_observed_model_missing");
  assert.equal(ledger.filter((line) => line.decision === "forwarded")[0].halted, "proxy_observed_model_missing");
});

test("a provider outside the declared set halts, a declared one is recorded", async () => {
  const allowed = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply({ provider: "OpenRouter" }));
  });
  const allowedProxy = await startProxy({ stubPort: allowed.port, extra: ["--max-requests", "2"] });
  const ok = await post(allowedProxy.port, { model: PROFILE.model, input: "hello" });
  await ok.text();
  const allowedLedger = allowedProxy.read();
  allowedProxy.close();
  await allowed.close();

  const other = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply({ provider: "AcmeServe" }));
  });
  const otherProxy = await startProxy({ stubPort: other.port, extra: ["--max-requests", "2"] });
  const blocked = await post(otherProxy.port, { model: PROFILE.model, input: "hello" });
  const blockedBody = await blocked.json();
  const blockedLedger = otherProxy.read();
  otherProxy.close();
  await other.close();

  assert.equal(ok.status, 200);
  assert.equal(allowedLedger.filter((line) => line.decision === "forwarded")[0].providerVerified, true);
  assert.equal(blocked.status, 502);
  assert.equal(blockedBody.error.code, "proxy_observed_provider_mismatch");
  assert.equal(blockedLedger.filter((line) => line.decision === "forwarded")[0].halted, "proxy_observed_provider_mismatch");
});

test("missing usage keeps the full reservation and halts further execution", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "stub", model: PROFILE.model, provider: "OpenRouter", output: [] }));
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const first = await post(proxy.port, { model: PROFILE.model, input: "hello" });
  await first.text();
  const second = await post(proxy.port, { model: PROFILE.model, input: "again" });
  await second.text();
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(first.status, 200);
  assert.equal(second.status, 402);
  const forwarded = ledger.filter((line) => line.decision === "forwarded");
  assert.equal(forwarded[0].usagePresent, false);
  assert.equal(forwarded[0].chargedInputTokens, INPUT_TOKEN_CEILING, "an unknown cost is never charged as zero");
  assert.equal(forwarded[0].chargedOutputTokens, MAX_OUTPUT_TOKENS);
  assert.equal(forwarded[0].halted, "usage_unreliable");
});

test("reported usage above the ceiling charges the truth and halts", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply({ usage: { input_tokens: INPUT_TOKEN_CEILING + 1, output_tokens: 10 } }));
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const first = await post(proxy.port, { model: PROFILE.model, input: "hello" });
  await first.text();
  const second = await post(proxy.port, { model: PROFILE.model, input: "again" });
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(second.status, 402);
  const forwarded = ledger.filter((line) => line.decision === "forwarded");
  assert.equal(forwarded[0].chargedInputTokens, INPUT_TOKEN_CEILING + 1);
  assert.equal(forwarded[0].halted, "ceiling_breached_by_reported_usage");
});

test("non-inference paths are never forwarded, so there is no bypass", async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(okReply());
  });
  const proxy = await startProxy({ stubPort: stub.port, extra: ["--max-requests", "4"] });
  const chat = await fetch(`http://127.0.0.1:${proxy.port}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: PROFILE.model, messages: [] }),
  });
  const key = await fetch(`http://127.0.0.1:${proxy.port}/key`);
  const ledger = proxy.read();
  proxy.close();
  stub.close();

  assert.equal(chat.status, 404);
  assert.equal(key.status, 404);
  assert.equal(stub.calls.length, 0);
  assert.equal(ledger.every((line) => line.decision === "refused"), true);
});
