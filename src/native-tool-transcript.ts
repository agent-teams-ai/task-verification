/**
 * Native OCR tool transcript (M2 targeted corrective pass).
 *
 * The rr.7 binary performs its own `file_read` calls. Both the call and its
 * result are carried in the captured Responses-API request bodies, so the
 * transcript is extracted from what the binary actually did rather than
 * reconstructed from an expectation.
 *
 * A requested path is not evidence that a file was read. A tool call is not
 * evidence that a result was returned. A result existing somewhere in the run
 * is not evidence that it was carried in a provider request. Delivery is only
 * asserted after this chain is established:
 *
 *   observed tool call -> matching observed tool result (same call identity)
 *     -> a captured provider request body that contains BOTH the call item and
 *        that exact result item
 *
 * Content bytes and digests are computed from the observed tool output, never
 * from the expected snapshot. The expected snapshot content is reported
 * separately, clearly labelled, and only compared.
 *
 * Because this experiment uses a fake provider, the final state is named
 * `includedInCapturedFakeProviderRequest`. It does not claim that a live
 * external provider or model received anything.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

export const NATIVE_TRANSCRIPT_SCHEMA = "m2.native-tool-transcript/v2";

export interface CapturedProviderRequest {
  index: number;
  bodyText: string;
  json: any;
}

export interface TranscriptSnapshotIdentity {
  baseCommit: string;
  headCommit: string;
  headApplicationDigest: string;
}

export interface TranscriptScope {
  candidateId: string;
  scenario: string;
  /** Every file in the reviewed repository. */
  repositoryFiles: readonly string[];
  changedPaths: readonly string[];
  /** Expected file content by repository path — an expectation, not an observation. */
  expectedFiles: Readonly<Record<string, string>>;
  snapshot: TranscriptSnapshotIdentity;
}

/**
 * A tool result observed outside the captured request stream (for example a
 * native tool-result log). It is only usable when its run identity matches the
 * captured run and the call identity was actually observed; otherwise it is
 * treated as unrelated and never establishes delivery.
 */
export interface ObservedToolResult {
  callId: string;
  output: string;
  runId: string;
}

export type TranscriptStatus = "success" | "denied" | "unknown";

export type TranscriptDeliveryStatus = "verified" | "denied" | "not-included" | "unverified";

export interface ParsedFileReadOutput {
  path: string | null;
  totalLines: number | null;
  truncated: boolean;
  lineRange: [number, number] | null;
  content: string;
  lineCount: number;
}

const FILE_HEADER = /^File:\s*(.+?)\s*\(Total lines:\s*(\d+)\)$/;
const LINE_RANGE = /^LINE_RANGE:\s*(\d+)-(\d+)$/;
const NUMBERED_LINE = /^(\d+)\|(.*)$/;

/**
 * Parse the rr.7 `file_read` output format:
 *
 *   File: audit.ts (Total lines: 50)
 *   IS_TRUNCATED: false
 *   LINE_RANGE: 1-50
 *   1|/**
 *   2| * ...
 *
 * Returns null when the payload is not a file-read output at all (for example a
 * denial message), so no caller can attribute file content to it.
 */
export function parseFileReadOutput(output: string): ParsedFileReadOutput | null {
  if (typeof output !== "string" || output.length === 0) return null;
  const lines = output.split("\n");
  let header: RegExpMatchArray | null = null;
  let cursor = 0;
  for (; cursor < lines.length && cursor < 6; cursor++) {
    header = FILE_HEADER.exec(lines[cursor]);
    if (header) break;
  }
  if (!header) return null;

  let truncated = false;
  let lineRange: [number, number] | null = null;
  const body: string[] = [];
  for (let i = cursor + 1; i < lines.length; i++) {
    const line = lines[i];
    if (body.length === 0) {
      if (/^IS_TRUNCATED:\s*(true|false)$/.test(line)) {
        truncated = line.endsWith("true");
        continue;
      }
      const range = LINE_RANGE.exec(line);
      if (range) {
        lineRange = [Number(range[1]), Number(range[2])];
        continue;
      }
    }
    const numbered = NUMBERED_LINE.exec(line);
    if (numbered) {
      body.push(numbered[2]);
      continue;
    }
    // A trailing blank line is the transport's, not file content.
    if (line === "" && i === lines.length - 1) break;
    // Anything else means this is not a faithful numbered file payload.
    return null;
  }
  if (body.length === 0) return null;

  // A trailing empty numbered line is the editor's phantom last line (the file
  // ends with a newline after the previous line), not an extra blank line. Drop
  // it so the reconstruction is byte-exact against the file the tool read.
  const trailingBlank = body.length > 1 && body[body.length - 1] === "";
  const contentLines = trailingBlank ? body.slice(0, -1) : body;
  const content = contentLines.length === 0 ? "" : `${contentLines.join("\n")}\n`;
  return {
    path: header[1] ?? null,
    totalLines: Number(header[2]),
    truncated,
    lineRange,
    content,
    lineCount: contentLines.length,
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

interface Call {
  requestIndex: number;
  callId: string;
  toolName: string | null;
  requestedPath: string;
}

interface ResultOccurrence {
  callId: string;
  output: string;
  requestIndex: number;
  source: "captured-request" | "observed-tool-result";
}

function callItems(request: CapturedProviderRequest): any[] {
  const input = request.json?.input;
  return Array.isArray(input) ? input : [];
}

function classifyPath(requested: string, scope: TranscriptScope): "changed" | "unchanged" | "out-of-scope" {
  const normalized = requested.split("\\").join("/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return "out-of-scope";
  if (!scope.repositoryFiles.includes(normalized)) return "out-of-scope";
  return scope.changedPaths.includes(normalized) ? "changed" : "unchanged";
}

/**
 * Build transcript lines from captured provider requests. Only a fully
 * correlated positive read yields a verified content-inclusion line; a missing
 * result, a mismatched call identity, or a result absent from every captured
 * request is reported as unverified / not-included instead.
 */
export function nativeToolTranscript(options: {
  requests: readonly CapturedProviderRequest[];
  scope: TranscriptScope;
  observedResults?: readonly ObservedToolResult[];
}): Record<string, unknown>[] {
  const { requests, scope } = options;
  const runId = `ocr-${sha256(requests[0]?.bodyText ?? "").slice(0, 12)}`;

  const calls: Call[] = [];
  const callById = new Map<string, Call>();
  const resultByCallId = new Map<string, ResultOccurrence>();
  const firstCallRequest = new Map<string, number>();

  for (const request of requests) {
    const items = callItems(request);
    for (const item of items) {
      if (item?.type === "function_call" && typeof item.call_id === "string") {
        if (!firstCallRequest.has(item.call_id)) firstCallRequest.set(item.call_id, request.index);
        if (callById.has(item.call_id)) continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(item.arguments ?? "{}")) as Record<string, unknown>;
        } catch {
          args = {};
        }
        const requested = typeof args.file_path === "string" ? args.file_path : "";
        const call: Call = {
          requestIndex: request.index,
          callId: item.call_id,
          toolName: typeof item.name === "string" ? item.name : null,
          requestedPath: requested,
        };
        calls.push(call);
        callById.set(item.call_id, call);
      }
      if (item?.type === "function_call_output" && typeof item.call_id === "string") {
        if (resultByCallId.has(item.call_id)) continue;
        resultByCallId.set(item.call_id, {
          callId: item.call_id,
          output: typeof item.output === "string" ? item.output : "",
          requestIndex: request.index,
          source: "captured-request",
        });
      }
    }
  }

  // Externally observed results are only accepted when they belong to this run.
  for (const observed of options.observedResults ?? []) {
    if (observed.runId !== runId) continue;
    if (!callById.has(observed.callId)) continue;
    if (resultByCallId.has(observed.callId)) continue;
    resultByCallId.set(observed.callId, {
      callId: observed.callId,
      output: observed.output,
      requestIndex: -1,
      source: "observed-tool-result",
    });
  }

  // A result is included only if one captured request body carries BOTH the call
  // item and that exact result item. This is a structural check on the parsed
  // request, not a substring search over the serialized body.
  const inclusionRequest = new Map<string, number>();
  for (const call of calls) {
    const result = resultByCallId.get(call.callId);
    if (!result) continue;
    for (const request of requests) {
      if (request.index < call.requestIndex) continue;
      const items = callItems(request);
      const hasCall = items.some(
        (item) => item?.type === "function_call" && item.call_id === call.callId,
      );
      const hasResult = items.some(
        (item) =>
          item?.type === "function_call_output" &&
          item.call_id === call.callId &&
          typeof item.output === "string" &&
          item.output === result.output,
      );
      if (hasCall && hasResult) {
        inclusionRequest.set(call.callId, request.index);
        break;
      }
    }
  }

  const lines: Record<string, unknown>[] = [];

  for (const call of calls) {
    const result = resultByCallId.get(call.callId);
    const includedAt = inclusionRequest.get(call.callId);
    const included = includedAt !== undefined;
    const output = result?.output ?? "";
    const denied = /^Error executing tool/.test(output);
    const status: TranscriptStatus = result === undefined ? "unknown" : denied ? "denied" : "success";
    const parsed = status === "success" ? parseFileReadOutput(output) : null;
    const contentReturned = parsed !== null && parsed.content.length > 0;

    const expected = Object.prototype.hasOwnProperty.call(scope.expectedFiles, call.requestedPath)
      ? scope.expectedFiles[call.requestedPath]
      : null;
    const observedContentSha = contentReturned ? sha256(parsed.content) : null;
    const expectedSha = expected === null ? null : sha256(expected);
    const contentMatchesExpectedSnapshot =
      contentReturned && expected !== null ? observedContentSha === expectedSha : null;

    const deliveryStatus: TranscriptDeliveryStatus =
      result === undefined
        ? "unverified"
        : !included
          ? "not-included"
          : denied
            ? "denied"
            : contentReturned
              ? "verified"
              : "not-included";

    const unverifiedReason =
      result === undefined
        ? "no tool result with this call identity was observed; delivery is unknown"
        : !included
          ? "the observed tool result is not carried in any captured provider request with its call"
          : null;

    lines.push({
      schema: NATIVE_TRANSCRIPT_SCHEMA,
      runId,
      candidateId: scope.candidateId,
      scenario: scope.scenario,
      snapshot: scope.snapshot,
      requestIndex: call.requestIndex,
      toolName: call.toolName,
      toolCallId: call.callId,
      requestedPath: call.requestedPath,
      classification: classifyPath(call.requestedPath, scope),

      // --- Facts, each established separately --------------------------------
      toolCallObserved: true,
      toolResultObserved: result !== undefined,
      toolResultSource: result?.source ?? null,
      toolResultRequestIndex: result && result.requestIndex >= 0 ? result.requestIndex : null,
      includedInCapturedFakeProviderRequest: included,
      inclusionRequestIndex: includedAt ?? null,
      deliveryStatus,

      // --- Content, derived ONLY from the observed tool output ---------------
      status,
      contentReturned,
      contentIncludedInCapturedFakeProviderRequest: contentReturned && included,
      observedOutputBytes: result === undefined ? 0 : byteLength(output),
      observedOutputSha256: result === undefined ? null : sha256(output),
      observedContentBytes: contentReturned ? byteLength(parsed.content) : 0,
      observedContentSha256: observedContentSha,

      // --- Expected snapshot content: an expectation, labelled as such -------
      expectedSnapshotBytes: expected === null ? 0 : byteLength(expected),
      expectedSnapshotSha256: expectedSha,
      contentMatchesExpectedSnapshot,

      diagnostic: denied ? output.slice(0, 400) : null,
      denialReason: denied ? "native tool refused to read the requested path" : null,
      unverifiedReason,
    });
  }

  return lines;
}

/**
 * Compact, content-free record of the captured provider request chain: which
 * items each request carried, their call identities, and the digest of every
 * observed tool output. This is the event chain behind the transcript, retained
 * without duplicating file contents.
 */
export function nativeToolChain(
  requests: readonly CapturedProviderRequest[],
  scope: TranscriptScope,
): Record<string, unknown> {
  const runId = `ocr-${sha256(requests[0]?.bodyText ?? "").slice(0, 12)}`;
  return {
    schema: "m2.native-tool-chain/v1",
    runId,
    candidateId: scope.candidateId,
    scenario: scope.scenario,
    snapshot: scope.snapshot,
    requests: requests.map((request) => {
      const items = callItems(request);
      return {
        index: request.index,
        bodyBytes: byteLength(request.bodyText),
        bodySha256: sha256(request.bodyText),
        items: items
          .map((item) => {
            if (item?.type === "function_call") {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(String(item.arguments ?? "{}")) as Record<string, unknown>;
              } catch {
                args = {};
              }
              return {
                type: "function_call",
                callId: item.call_id ?? null,
                name: item.name ?? null,
                requestedPath: typeof args.file_path === "string" ? args.file_path : null,
              };
            }
            if (item?.type === "function_call_output") {
              const output = typeof item.output === "string" ? item.output : "";
              return {
                type: "function_call_output",
                callId: item.call_id ?? null,
                outputBytes: byteLength(output),
                outputSha256: sha256(output),
              };
            }
            return { type: (item?.type as string) ?? null };
          })
          .filter((item) => item.type !== null),
      };
    }),
  };
}

/** Summary counters for the retained evidence manifest. */
export function summarizeTranscript(lines: readonly Record<string, unknown>[]): {
  lines: number;
  verifiedContentInclusions: number;
  denied: number;
  unverified: number;
  notIncluded: number;
  contentMatchesExpectedSnapshot: number;
} {
  return {
    lines: lines.length,
    verifiedContentInclusions: lines.filter(
      (l) => l.contentIncludedInCapturedFakeProviderRequest === true,
    ).length,
    denied: lines.filter((l) => l.deliveryStatus === "denied").length,
    unverified: lines.filter((l) => l.deliveryStatus === "unverified").length,
    notIncluded: lines.filter((l) => l.deliveryStatus === "not-included").length,
    contentMatchesExpectedSnapshot: lines.filter((l) => l.contentMatchesExpectedSnapshot === true).length,
  };
}
