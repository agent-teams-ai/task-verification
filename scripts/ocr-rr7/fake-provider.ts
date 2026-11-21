// Loopback fake provider for the managed OpenCodeReview (rr.7) qualification.
//
// The real Linux/amd64 OCR binary is pointed at this server through its private
// HOME config. No external provider, credential or network endpoint is used.
// Every request is captured verbatim so the M2 harness can verify the rendered
// reviewer input and prove that no automatic retry happened.

import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

export const SYNTHETIC_TOKEN = "rr7-synthetic-loopback-token-0123456789";

export type OcrScenario =
  | "finding"
  | "unchanged"
  | "partial"
  | "malformed"
  | "truncated"
  | "refusal"
  | "stall";

export interface CapturedRequest {
  index: number;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  json: any;
  at: number;
}

export interface FakeProviderOptions {
  scenario?: OcrScenario;
  model?: string;
  comments?: unknown[];
  stallMs?: number;
  requestLimit?: number;
  /**
   * File paths the reviewer asks the binary to read with its own `file_read`
   * tool, one per main turn, before finishing. This exercises the real native
   * read path (including paths outside the repository).
   */
  readPaths?: string[];
}

export interface FakeProvider {
  url: string;
  requests: CapturedRequest[];
  state: {
    mainTurns: number;
    mainTurnsByKey: Record<string, number>;
    groupingCalls: number;
    filtered: number;
    closed: boolean;
    problem: string | null;
    expectedFailures: string[];
  };
  close(): Promise<void>;
}

function toolNames(json: any): string[] {
  const tools = Array.isArray(json?.tools) ? json.tools : [];
  return tools.map((t: any) => t?.name ?? t?.function?.name).filter(Boolean);
}

/** Concatenate every string in the Responses `input` payload. */
function inputText(json: any): string {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item);
    }
  };
  walk(json?.input);
  return out.join("\n");
}

/** Stable identity of a review group: the sorted paths in its `<review_files>` block. */
function groupKey(json: any): string | null {
  const paths = [...inputText(json).matchAll(/<file path="([^"]+)">/g)].map((m) => m[1]);
  if (paths.length === 0) return null;
  return [...new Set(paths)].sort().join(",");
}

/** File-list indices from the grouping prompt, in prompt order. */
function groupingFiles(json: any): { index: number; path: string }[] {
  const files: { index: number; path: string }[] = [];
  for (const line of inputText(json).split("\n")) {
    // Format: `[0] MODIFIED   src/calc.ts (+1/-1)`.
    const match = /^\[(\d+)\]\s+\S+\s+(\S+)\s+\(\+\d+\/-\d+\)$/.exec(line.trim());
    if (match) files.push({ index: Number(match[1]), path: match[2] });
  }
  return files;
}

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function functionCall(name: string, args: unknown) {
  return {
    type: "function_call",
    id: `fc_${crypto.randomUUID()}`,
    call_id: `call_${crypto.randomUUID()}`,
    name,
    arguments: JSON.stringify(args),
  };
}

function textOutput(text: string) {
  return {
    type: "message",
    id: `msg_${crypto.randomUUID()}`,
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

/**
 * Starts the fake provider. Returns the bare base URL (the managed client
 * appends `/responses`), the captured requests and a close function.
 */
export async function startFakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const {
    scenario = "finding",
    model = "rr7-fake-model",
    comments = [],
    stallMs = 30000,
    requestLimit = 24,
    readPaths = [],
  } = options;
  const requests: CapturedRequest[] = [];
  const state = {
    mainTurns: 0,
    mainTurnsByKey: {} as Record<string, number>,
    groupingCalls: 0,
    filtered: 0,
    closed: false,
    problem: null as string | null,
    expectedFailures: [] as string[],
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bodyText = Buffer.concat(chunks).toString("utf8");
    let json: any = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = null;
    }
    requests.push({
      index: requests.length,
      method: req.method ?? "",
      path: req.url ?? "",
      headers: { ...req.headers },
      bodyText,
      json,
      at: Date.now(),
    });

    const fail = (message: string, status = 400): void => {
      if (!state.problem) state.problem = message;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fixture rejected request" } }));
    };

    if (requests.length > requestLimit) return fail("request budget exceeded");
    if (req.method !== "POST" || req.url !== "/responses") return fail("route mismatch");
    if (req.headers.authorization !== `Bearer ${SYNTHETIC_TOKEN}`) return fail("synthetic auth mismatch", 401);
    if (req.headers["x-api-key"]) return fail("unexpected x-api-key");
    if (!json || json.model !== model) return fail("model mismatch");
    if (json.stream !== true) return fail("managed Responses transport must stream");
    if ("temperature" in json || "top_p" in json) return fail("sampling parameter leaked");

    const names = toolNames(json);

    if (scenario === "malformed") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: response.completed\ndata: {"type":"response.completed","response":');
      res.end();
      return;
    }
    if (scenario === "truncated") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, "response.output_text.delta", { type: "response.output_text.delta", delta: "{" });
      res.end();
      return;
    }
    if (scenario === "refusal") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, "response.completed", {
        type: "response.completed",
        response: {
          id: `resp_${crypto.randomUUID()}`,
          model,
          status: "completed",
          output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot review this." }] }],
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        },
      });
      res.end();
      return;
    }
    if (scenario === "stall") {
      await new Promise((resolve) => setTimeout(resolve, stallMs));
    }

    let output: unknown[];
    if (names.includes("approve_all_comments")) {
      state.filtered += 1;
      output = [functionCall("approve_all_comments", {})];
    } else if (names.includes("task_done")) {
      const key = groupKey(json) ?? "default";
      const turn = state.mainTurnsByKey[key] ?? 0;
      state.mainTurnsByKey[key] = turn + 1;
      state.mainTurns += 1;

      // Partial multi-group run: the group containing util.ts fails on every
      // attempt so a retry could never turn the failure into a success. The
      // harness asserts that exactly one request reached this group.
      if (scenario === "partial" && key.split(",").includes("src/util.ts")) {
        if (!state.expectedFailures.includes(key)) state.expectedFailures.push(key);
        return fail("fixture partial group failure", 500);
      }

      const keyPaths = key.split(",").filter(Boolean);
      const groupComments =
        scenario === "unchanged"
          ? []
          : key === "default"
            ? comments
            : comments.filter((c) => keyPaths.includes(String((c as { path?: unknown })?.path ?? "")));
      if (turn < readPaths.length && names.includes("file_read")) {
        // Ask the binary to read this path with its own native tool. The read
        // result arrives in the next request body.
        output = [functionCall("file_read", { file_path: readPaths[turn] })];
      } else {
        output =
          turn === 0 && groupComments.length > 0
            ? [functionCall("code_comment", { comments: groupComments })]
            : [functionCall("task_done", {})];
      }
    } else {
      // Grouping call: no review tools are offered. Return a partition that
      // keeps a below-threshold change set in one group, or, for the partial
      // scenario, one file per group so one group can fail independently.
      state.groupingCalls += 1;
      const files = groupingFiles(json);
      const groups =
        scenario === "partial"
          ? files.map((f) => ({ label: f.path, files: [f.index] }))
          : [{ label: "fixture group", files: files.map((f) => f.index) }];
      output = [textOutput(JSON.stringify(groups))];
    }

    res.writeHead(200, { "content-type": "text/event-stream" });
    sse(res, "response.output_text.delta", { type: "response.output_text.delta", delta: "reviewing" });
    sse(res, "response.completed", {
      type: "response.completed",
      response: {
        id: `resp_${crypto.randomUUID()}`,
        object: "response",
        status: "completed",
        model,
        output,
        usage: { input_tokens: 41, output_tokens: 9, total_tokens: 50 },
      },
    });
    res.end();
    res.on("close", () => {
      state.closed = true;
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
