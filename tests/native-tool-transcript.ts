/**
 * Native transcript extractor: observed-output requirements and negative
 * controls (M2 targeted corrective pass).
 *
 * These run without the rr.7 binary. They exercise the exact extractor used by
 * the WP8-A suite with controlled captured-request inputs, so every way the
 * receipt could overstate what it observed is asserted here:
 *
 *   - a requested path without a tool result,
 *   - a tool call whose result is missing,
 *   - a result with a different call identity,
 *   - a result that belongs to another run,
 *   - a result that no captured request carries,
 *   - another result carrying similar content,
 *   - content differing by one byte from the expectation,
 *   - a denied path,
 *   - a forged/reconstructed tool-output record,
 *   - the one valid positive case.
 *
 * Only the exact chain call -> matching result -> captured request containing
 * both may produce `contentIncludedInCapturedFakeProviderRequest = true`.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";

import {
  nativeToolTranscript,
  parseFileReadOutput,
  type CapturedProviderRequest,
  type TranscriptScope,
} from "../src/native-tool-transcript.ts";

const H = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const APP_CONTENT = "export const profile = () => ({ id: 1 });\n";
const OTHER_CONTENT = "export const other = () => ({ id: 2 });\n";

function fileReadOutput(path: string, content: string): string {
  const lines = content.replace(/\n$/, "").split("\n");
  const body = lines.map((line, i) => `${i + 1}|${line}`).join("\n");
  return [
    `File: ${path} (Total lines: ${lines.length})`,
    "IS_TRUNCATED: false",
    `LINE_RANGE: 1-${lines.length}`,
    body,
    "",
  ].join("\n");
}

function scope(overrides: Partial<TranscriptScope> = {}): TranscriptScope {
  return {
    candidateId: "S1-C3",
    scenario: "unchanged-dependency-read",
    repositoryFiles: ["app.ts", "audit.ts"],
    changedPaths: ["app.ts"],
    expectedFiles: { "app.ts": APP_CONTENT, "audit.ts": OTHER_CONTENT },
    snapshot: {
      baseCommit: "0".repeat(40),
      headCommit: "1".repeat(40),
      headApplicationDigest: H("snapshot"),
    },
    ...overrides,
  };
}

function request(index: number, input: unknown[]): CapturedProviderRequest {
  const json = { input };
  return { index, bodyText: JSON.stringify(json), json };
}

function call(callId: string, path: string): Record<string, unknown> {
  return { type: "function_call", call_id: callId, name: "file_read", arguments: JSON.stringify({ file_path: path }) };
}

function output(callId: string, text: string): Record<string, unknown> {
  return { type: "function_call_output", call_id: callId, output: text };
}

/** A full, valid chain: call + result in the same captured request body. */
function validRequests(callId = "call_1", path = "app.ts", content = APP_CONTENT): CapturedProviderRequest[] {
  return [
    request(0, [{ role: "user", content: "review" }]),
    request(1, [
      { role: "user", content: "review" },
      call(callId, path),
      output(callId, fileReadOutput(path, content)),
    ]),
  ];
}

function onlyLine(lines: Record<string, unknown>[]): Record<string, unknown> {
  assert.equal(lines.length, 1, `expected exactly one transcript line, got ${JSON.stringify(lines)}`);
  return lines[0];
}

// --- Positive control ------------------------------------------------------

test("native transcript: a read whose result is carried in the next captured request is verified", () => {
  const line = onlyLine(nativeToolTranscript({ requests: validRequests(), scope: scope() }));
  assert.equal(line.toolCallObserved, true);
  assert.equal(line.toolResultObserved, true);
  assert.equal(line.toolResultSource, "captured-request");
  assert.equal(line.includedInCapturedFakeProviderRequest, true);
  assert.equal(line.inclusionRequestIndex, 1);
  assert.equal(line.deliveryStatus, "verified");
  assert.equal(line.status, "success");
  assert.equal(line.contentReturned, true);
  assert.equal(line.contentIncludedInCapturedFakeProviderRequest, true);
  // Observed content, not the expectation.
  assert.equal(line.observedContentSha256, H(APP_CONTENT));
  assert.equal(line.expectedSnapshotSha256, H(APP_CONTENT));
  assert.equal(line.contentMatchesExpectedSnapshot, true);
  assert.equal(line.observedContentBytes, Buffer.byteLength(APP_CONTENT, "utf8"));
});

// --- Negatives -------------------------------------------------------------

test("native transcript: a path mentioned in a request without any tool call yields nothing", () => {
  const requests = [
    request(0, [{ role: "user", content: "please read app.ts" }]),
    request(1, [{ role: "user", content: "please read app.ts" }]),
  ];
  assert.deepEqual(nativeToolTranscript({ requests, scope: scope() }), []);
});

test("native transcript: a tool call with no matching result is unverified, never delivered", () => {
  const requests = [
    request(0, [{ role: "user", content: "review" }]),
    request(1, [{ role: "user", content: "review" }, call("call_1", "app.ts")]),
  ];
  const line = onlyLine(nativeToolTranscript({ requests, scope: scope() }));
  assert.equal(line.toolCallObserved, true);
  assert.equal(line.toolResultObserved, false);
  assert.equal(line.deliveryStatus, "unverified");
  assert.equal(line.includedInCapturedFakeProviderRequest, false);
  assert.equal(line.contentReturned, false);
  assert.equal(line.contentIncludedInCapturedFakeProviderRequest, false);
  assert.match(String(line.unverifiedReason), /no tool result/);
});

test("native transcript: a result with a different call identity does not satisfy the call", () => {
  const requests = [
    request(1, [{ role: "user", content: "review" }, call("call_1", "app.ts"), output("call_2", fileReadOutput("app.ts", APP_CONTENT))]),
  ];
  const line = onlyLine(nativeToolTranscript({ requests, scope: scope() }));
  assert.equal(line.toolResultObserved, false);
  assert.equal(line.deliveryStatus, "unverified");
  assert.equal(line.contentIncludedInCapturedFakeProviderRequest, false);
});

test("native transcript: a result observed in another run is ignored", () => {
  const requests = [request(1, [{ role: "user", content: "review" }, call("call_1", "app.ts")])];
  const runId = `ocr-${H(requests[0].bodyText).slice(0, 12)}`;
  const line = onlyLine(
    nativeToolTranscript({
      requests,
      scope: scope(),
      observedResults: [
        { callId: "call_1", output: fileReadOutput("app.ts", APP_CONTENT), runId: `${runId}-other` },
      ],
    }),
  );
  assert.equal(line.toolResultObserved, false);
  assert.equal(line.deliveryStatus, "unverified");
});

test("native transcript: a result no captured request carries is observed but not included", () => {
  const requests = [request(1, [{ role: "user", content: "review" }, call("call_1", "app.ts")])];
  const runId = `ocr-${H(requests[0].bodyText).slice(0, 12)}`;
  const line = onlyLine(
    nativeToolTranscript({
      requests,
      scope: scope(),
      observedResults: [{ callId: "call_1", output: fileReadOutput("app.ts", APP_CONTENT), runId }],
    }),
  );
  assert.equal(line.toolResultObserved, true);
  assert.equal(line.toolResultSource, "observed-tool-result");
  assert.equal(line.includedInCapturedFakeProviderRequest, false);
  assert.equal(line.deliveryStatus, "not-included");
  assert.equal(line.contentIncludedInCapturedFakeProviderRequest, false, "an unshipped result delivers nothing");
  assert.match(String(line.unverifiedReason), /not carried/);
});

test("native transcript: another tool result's similar content never attaches to this call", () => {
  const requests = [
    request(1, [
      { role: "user", content: "review" },
      call("call_1", "app.ts"),
      call("call_2", "audit.ts"),
      output("call_2", fileReadOutput("audit.ts", OTHER_CONTENT)),
    ]),
  ];
  const lines = nativeToolTranscript({ requests, scope: scope() });
  const app = lines.find((l) => l.requestedPath === "app.ts")!;
  const audit = lines.find((l) => l.requestedPath === "audit.ts")!;
  assert.equal(app.toolResultObserved, false);
  assert.equal(app.contentIncludedInCapturedFakeProviderRequest, false);
  assert.equal(audit.toolResultObserved, true);
  assert.equal(audit.contentReturned, true);
  assert.equal(audit.observedContentSha256, H(OTHER_CONTENT));
});

test("native transcript: content differing by one byte is delivered but flagged as unexpected", () => {
  const nearly = APP_CONTENT.replace("id: 1", "id: 2");
  const line = onlyLine(nativeToolTranscript({ requests: validRequests("call_1", "app.ts", nearly), scope: scope() }));
  assert.equal(line.deliveryStatus, "verified");
  assert.equal(line.observedContentSha256, H(nearly));
  assert.equal(line.expectedSnapshotSha256, H(APP_CONTENT));
  assert.equal(line.contentMatchesExpectedSnapshot, false, "the observed bytes are not the expected bytes");
});

test("native transcript: a denied read returns no content and asserts no delivery", () => {
  const denial =
    'Error executing tool file_read: file "/etc/passwd" not found: git show ' +
    "1".repeat(40) +
    ":/etc/passwd: exit status 128: fatal: path '/etc/passwd' exists on disk, but not in HEAD";
  const requests = [
    request(1, [
      { role: "user", content: "review" },
      call("call_1", "/etc/passwd"),
      output("call_1", denial),
    ]),
  ];
  const line = onlyLine(nativeToolTranscript({ requests, scope: scope() }));
  assert.equal(line.status, "denied");
  assert.equal(line.classification, "out-of-scope");
  assert.equal(line.contentReturned, false);
  assert.equal(line.observedContentBytes, 0);
  assert.equal(line.observedContentSha256, null);
  assert.equal(line.deliveryStatus, "denied");
  assert.equal(line.contentIncludedInCapturedFakeProviderRequest, false);
  assert.ok(String(line.diagnostic).length > 0);
});

test("native transcript: a forged tool-output record with no observed call never establishes delivery", () => {
  const requests = [request(1, [{ role: "user", content: "review" }, call("call_1", "app.ts")])];
  const runId = `ocr-${H(requests[0].bodyText).slice(0, 12)}`;
  const lines = nativeToolTranscript({
    requests,
    scope: scope(),
    observedResults: [
      { callId: "call_forged", output: fileReadOutput("app.ts", APP_CONTENT), runId },
    ],
  });
  const line = onlyLine(lines);
  assert.equal(line.toolCallId, "call_1", "only the observed call is transcribed");
  assert.equal(line.toolResultObserved, false);
  assert.equal(line.deliveryStatus, "unverified");
  assert.equal(line.contentIncludedInCapturedFakeProviderRequest, false);
});

test("native transcript: structured file-read parsing rejects non-file payloads", () => {
  assert.equal(parseFileReadOutput("Error executing tool file_read"), null);
  assert.equal(parseFileReadOutput("some prose about app.ts"), null);
  assert.equal(parseFileReadOutput(""), null);
  const parsed = parseFileReadOutput(fileReadOutput("app.ts", APP_CONTENT));
  assert.ok(parsed);
  assert.equal(parsed.path, "app.ts");
  assert.equal(parsed.truncated, false);
  assert.deepEqual(parsed.lineRange, [1, 1]);
  assert.equal(parsed.content, APP_CONTENT);
});
