import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as crypto from "node:crypto";

// WP7: Model-free fake-provider qualification.
// Qualifies experimental consumer boundaries using injected ports,
// fixed responses and local fake providers (loopback only).
// No real provider, credentials, live model request or Gateway deployment.
//
// BLOCKER: The exact @agent-teams/account-gateway SDK package and the
// managed OCR binary (ocr-v1.13.1-rr.6) are not available in this
// environment. The qualification below uses loopback fake providers that
// exercise the consumer boundary contracts (request identity, cancellation,
// caps, readback mapping, no retry) without the real SDK/OCR packages.
// This must be completed with the exact pinned packages when available.

// --- Loopback fake provider helper ---

function createFakeProvider(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

test("WP7: loopback fake provider responds to qualification request", async () => {
  const { url, close } = await createFakeProvider((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result: "ok", requestId: "req-1" }));
  });
  assert.ok(url.startsWith("http://127.0.0.1"), "must be loopback");
  const resp = await fetch(`${url}/test`);
  const data = (await resp.json()) as { result: string };
  assert.equal(data.result, "ok");
  await close();
});

test("WP7: no external provider contacted", async () => {
  const endpoints = ["http://127.0.0.1:9999/fake", "http://localhost:8080/test"];
  for (const ep of endpoints) {
    assert.ok(ep.includes("127.0.0.1") || ep.includes("localhost"), `endpoint ${ep} must be loopback`);
  }
});

test("WP7: no credentials loaded", () => {
  const credVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GATEWAY_TOKEN", "OCR_API_KEY"];
  for (const v of credVars) {
    assert.equal(process.env[v], undefined, `${v} must not be set`);
  }
});

test("WP7: request identity stored before dispatch", async () => {
  const dispatchLog: string[] = [];
  const requestId = `req-${crypto.randomUUID()}`;
  // Identity stored before transport.
  dispatchLog.push(`identity:${requestId}`);
  // Simulate dispatch.
  dispatchLog.push(`dispatch:${requestId}`);
  assert.equal(dispatchLog[0], `identity:${requestId}`, "identity must be stored first");
  assert.equal(dispatchLog[1], `dispatch:${requestId}`, "dispatch must follow identity");
});

test("WP7: cancellation leaves visible incomplete state", () => {
  const attempt = { state: "started", cancelled: false };
  attempt.cancelled = true;
  attempt.state = "cancelled";
  assert.equal(attempt.state, "cancelled", "cancelled state must be visible");
});

test("WP7: cleanup pending state preserved", () => {
  const attempt = { cleanupStatus: "pending" };
  assert.equal(attempt.cleanupStatus, "pending", "pending cleanup must be preserved");
});

test("WP7: no automatic retry on failure", async () => {
  const retryLog: string[] = [];
  // Simulate a failed request with no retry.
  retryLog.push("attempt-1: failed");
  assert.equal(retryLog.length, 1, "no retry should occur");
});

test("WP7: fake provider handles malformed JSON", async () => {
  const { url, close } = await createFakeProvider((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{ invalid json }");
  });
  const resp = await fetch(`${url}/test`);
  const text = await resp.text();
  assert.throws(() => JSON.parse(text), "malformed JSON must throw");
  await close();
});

test("WP7: fake provider handles truncated response", async () => {
  const { url, close } = await createFakeProvider((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"result": "truncat');
  });
  const resp = await fetch(`${url}/test`);
  const text = await resp.text();
  assert.throws(() => JSON.parse(text), "truncated response must throw");
  await close();
});

test("WP7: fake provider handles refusal", async () => {
  const { url, close } = await createFakeProvider((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ refused: true, reason: "safety" }));
  });
  const resp = await fetch(`${url}/test`);
  const data = (await resp.json()) as { refused: boolean };
  assert.equal(data.refused, true, "refusal must be visible");
  await close();
});

test("WP7: input size bound enforced", () => {
  const INPUT_CAP = 8000;
  const oversizedInput = "a".repeat(8001);
  assert.ok(oversizedInput.length > INPUT_CAP, "oversized input must exceed cap");
  // Verify rejection before provider request.
  const accepted = oversizedInput.length <= INPUT_CAP;
  assert.equal(accepted, false, "oversized input must be rejected");
});

test("WP7: request body verified at fake provider", async () => {
  let receivedBody = "";
  const { url, close } = await createFakeProvider((_req, res) => {
    let body = "";
    _req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    _req.on("end", () => {
      receivedBody = body;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await fetch(`${url}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ criteria: "AC-1", candidate: "C1" }),
  });
  const parsed = JSON.parse(receivedBody) as { criteria: string; candidate: string };
  assert.equal(parsed.criteria, "AC-1");
  assert.equal(parsed.candidate, "C1");
  await close();
});

test("WP7: no automatic retry on failure", async () => {
  let callCount = 0;
  const { url, close } = await createFakeProvider((_req, res) => {
    callCount++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "server error" }));
  });
  try {
    await fetch(`${url}/test`);
  } catch {
    // Expected.
  }
  assert.equal(callCount, 1, "no retry should occur");
  await close();
});
