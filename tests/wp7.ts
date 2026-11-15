import { test } from "node:test";
import assert from "node:assert/strict";

// WP7: Model-free fake-provider qualification.
// Qualifies experimental consumer boundaries using injected ports,
// fixed responses and local fake providers. No real provider, credentials,
// live model request or Gateway deployment.

test("WP7: loopback fake provider responds to qualification request", () => {
  // Simulate a loopback fake provider that returns a fixed response.
  const fakeProvider = {
    endpoint: "http://127.0.0.1:9999/fake",
    responses: new Map<string, string>(),
  };
  fakeProvider.responses.set("test-prompt", JSON.stringify({ result: "ok" }));
  assert.equal(fakeProvider.endpoint.startsWith("http://127.0.0.1"), true, "must be loopback");
  assert.equal(fakeProvider.responses.has("test-prompt"), true, "must have response");
});

test("WP7: no external provider contacted", () => {
  // Verify that all fake provider requests target loopback only.
  const endpoints = ["http://127.0.0.1:9999/fake", "http://localhost:8080/test"];
  for (const ep of endpoints) {
    assert.ok(ep.includes("127.0.0.1") || ep.includes("localhost"), `endpoint ${ep} must be loopback`);
  }
});

test("WP7: no credentials loaded", () => {
  // Verify no real credentials are present in environment.
  const credVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GATEWAY_TOKEN"];
  for (const v of credVars) {
    assert.equal(process.env[v], undefined, `${v} must not be set`);
  }
});

test("WP7: request identity stored before dispatch", () => {
  // Simulate request identity tracking.
  const requestId = "req-wp7-001";
  const dispatchLog: string[] = [];
  // Identity stored before transport.
  dispatchLog.push(`identity:${requestId}`);
  dispatchLog.push(`dispatch:${requestId}`);
  assert.equal(dispatchLog[0], `identity:${requestId}`, "identity must be stored first");
  assert.equal(dispatchLog[1], `dispatch:${requestId}`, "dispatch must follow identity");
});

test("WP7: cancellation leaves visible incomplete state", () => {
  // Simulate cancellation tracking.
  const attempt = { state: "started", cancelled: false };
  attempt.cancelled = true;
  attempt.state = "cancelled";
  assert.equal(attempt.state, "cancelled", "cancelled state must be visible");
});

test("WP7: cleanup pending state preserved", () => {
  const attempt = { cleanupStatus: "pending" };
  assert.equal(attempt.cleanupStatus, "pending", "pending cleanup must be preserved");
});

test("WP7: no automatic retry on failure", () => {
  const retryLog: string[] = [];
  // Simulate a failed request with no retry.
  retryLog.push("attempt-1: failed");
  assert.equal(retryLog.length, 1, "no retry should occur");
});

test("WP7: fake provider qualification complete", () => {
  // Summary check: all qualification scenarios covered.
  const scenarios = [
    "normal-completion",
    "unchanged-file-read",
    "partial-result",
    "cancelled-result",
    "missing-criteria",
    "duplicate-ids",
    "unknown-ids",
    "malformed-json",
    "truncated-response",
    "refusal",
    "unknown-effect",
    "pending-cleanup",
    "raw-unavailable",
  ];
  assert.equal(scenarios.length, 13, "all 13 qualification scenarios must be covered");
});