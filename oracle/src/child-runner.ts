/**
 * Isolated candidate child process (WP2 process boundary).
 *
 * Runs inside a throwaway workspace containing only the candidate application
 * source plus this runner. It receives a JSON configuration on stdin, starts
 * the candidate application, performs the requested HTTP observations, and
 * writes one JSON document to stdout. Assertion evaluation stays in the parent.
 *
 * The parent launches this file with Node's permission model restricted to the
 * workspace, so ground truth, sealed artifacts, scorer internals, sibling
 * candidates and unapproved repository files are not readable here.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

type ChildMode = "run" | "probe" | "hang" | "malformed" | "exit";

interface RequestSpec {
  id: string;
  path: string;
  token?: string;
}

interface PathSpec {
  label: string;
  path: string;
}

interface ChildConfig {
  mode: ChildMode;
  candidateId: string;
  requests: RequestSpec[];
  probePaths: PathSpec[];
  forbiddenPaths: PathSpec[];
}

interface AuditRecord {
  event: string;
  reason: string;
  path: string;
  tokenPresent: boolean;
  callerId?: string;
  timestamp: string;
}

interface RequestObservation {
  requestId: string;
  statusCode: number;
  body: unknown;
  auditDelta: AuditRecord[];
}

interface PathObservation {
  label: string;
  path: string;
  accessible: boolean;
  code?: string;
}

interface ChildOutput {
  ok: boolean;
  mode: ChildMode;
  candidateId: string;
  pid: number;
  ppid: number;
  stateProbe: { markerSeen: boolean; runCount: number; freshState: boolean };
  workspaceFiles: string[];
  payloadKeys: string[];
  allowedReads: PathObservation[];
  forbidden: PathObservation[];
  requests: RequestObservation[];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function requestOnce(
  port: number,
  requestPath: string,
  token?: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const req = http.request({ port, path: requestPath, method: "GET", headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

function listWorkspaceFiles(): string[] {
  const root = process.cwd();
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

function probePath(spec: PathSpec): PathObservation {
  try {
    fs.readFileSync(spec.path);
    return { label: spec.label, path: spec.path, accessible: true };
  } catch (e) {
    return {
      label: spec.label,
      path: spec.path,
      accessible: false,
      code: (e as NodeJS.ErrnoException).code,
    };
  }
}

async function main(): Promise<void> {
  const config = JSON.parse(await readStdin()) as ChildConfig;

  // Process-local state marker: a fresh process always observes runCount === 1.
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__m2aRunCount = ((globals.__m2aRunCount as number | undefined) ?? 0) + 1;
  const stateProbe = {
    markerSeen: globals.__m2aMarker !== undefined,
    runCount: globals.__m2aRunCount as number,
    freshState: globals.__m2aRunCount === 1,
  };

  const workspaceFiles = listWorkspaceFiles();
  const payloadKeys = Object.keys(config).sort();
  const forbidden = config.forbiddenPaths.map(probePath);
  const allowedReads = [
    { label: "app.ts", path: path.join(process.cwd(), "app.ts") },
    { label: "behavior.ts", path: path.join(process.cwd(), "behavior.ts") },
  ].map(probePath);

  if (config.mode === "hang") {
    // Keep the process alive until the parent kills it.
    setInterval(() => undefined, 1000);
    return;
  }

  if (config.mode === "malformed") {
    process.stdout.write("this is not valid json\n");
    return;
  }

  if (config.mode === "exit") {
    process.stderr.write("intentional child failure\n");
    process.exit(3);
  }

  const baseOutput = {
    ok: true,
    mode: config.mode,
    candidateId: config.candidateId,
    pid: process.pid,
    ppid: process.ppid,
    stateProbe,
    workspaceFiles,
    payloadKeys,
    allowedReads,
    forbidden,
    requests: [] as RequestObservation[],
  };

  if (config.mode === "probe") {
    process.stdout.write(JSON.stringify(baseOutput));
    return;
  }

  const appMod = await import(pathToFileURL(path.join(process.cwd(), "app.ts")).href);
  const behaviorMod = await import(pathToFileURL(path.join(process.cwd(), "behavior.ts")).href);
  const deps = (behaviorMod.defaultDeps as () => unknown)();
  const app = (appMod.createApp as (d: unknown) => {
    start(port: number): Promise<AddressInfo>;
    stop(): Promise<void>;
    reset(): void;
    auditDelta(): AuditRecord[];
  })(deps);

  const address = await app.start(0);
  const requests: RequestObservation[] = [];
  for (const spec of config.requests) {
    app.reset();
    const { statusCode, body } = await requestOnce(address.port, spec.path, spec.token);
    requests.push({
      requestId: spec.id,
      statusCode,
      body: parseBody(body),
      auditDelta: app.auditDelta(),
    });
  }
  await app.stop();

  const output: ChildOutput = { ...baseOutput, requests };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err: unknown) => {
  process.stderr.write(`child-runner failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
