/**
 * Oracle O-1 driver: fresh-process execution boundary (WP2).
 *
 * Every candidate observation runs in a fresh operating-system process inside a
 * throwaway workspace. The parent writes only the candidate application source
 * and the isolated runner into the workspace, launches Node with the permission
 * model restricted to that workspace, and validates the child's JSON output.
 *
 * Assertion evaluation stays in the parent, so the child never receives ground
 * truth or scorer internals.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "../../src/digest.ts";
import { REQUEST_FIXTURES } from "./manifest.ts";
import {
  evaluateAll,
  type AssertionResult,
  type AuditRecord,
  type RequestResult,
} from "./assertions.ts";

const DRIVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DRIVER_DIR, "..", "..");
const WORK_ROOT = path.join(REPO_ROOT, ".candidates-work");
const CHILD_RUNNER_SOURCE = path.join(DRIVER_DIR, "child-runner.ts");

export type ChildMode = "run" | "probe" | "hang" | "malformed" | "exit";

export interface RequestSpec {
  id: string;
  path: string;
  token?: string;
}

export interface PathSpec {
  label: string;
  path: string;
}

export interface ChildConfig {
  mode: ChildMode;
  candidateId: string;
  requests: RequestSpec[];
  probePaths: PathSpec[];
  forbiddenPaths: PathSpec[];
}

export interface ChildRequestObservation {
  requestId: string;
  statusCode: number;
  body: unknown;
  auditDelta: AuditRecord[];
}

export interface PathObservation {
  label: string;
  path: string;
  accessible: boolean;
  code?: string;
}

export interface ChildOutput {
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
  requests: ChildRequestObservation[];
}

export interface ChildProcessResult extends ChildOutput {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  workspaceDir: string;
  workspaceRemoved: boolean;
}

export type ChildFailureKind =
  | "timeout"
  | "aborted"
  | "non-zero-exit"
  | "malformed-output"
  | "spawn-error";

export class ChildExecutionError extends Error {
  readonly kind: ChildFailureKind;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly workspaceDir: string;

  constructor(
    kind: ChildFailureKind,
    message: string,
    details: {
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stdout?: string;
      stderr?: string;
      workspaceDir: string;
    }
  ) {
    super(message);
    this.name = "ChildExecutionError";
    this.kind = kind;
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.workspaceDir = details.workspaceDir;
  }
}

export interface CandidateSource {
  candidateId: string;
  files: Record<string, string>;
}

export interface ChildRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PassExecution {
  candidateId: string;
  pass: number;
  process: {
    pid: number;
    ppid: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    workspaceRemoved: boolean;
  };
  requests: RequestResult[];
  auditDeltas: Record<string, AuditRecord[]>;
  assertions: Record<string, AssertionResult>;
  passed: boolean;
  durationMs: number;
}

/** Read a candidate source directory into a file map. */
export function readSourceDir(srcDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files[entry.name] = fs.readFileSync(path.join(srcDir, entry.name), "utf8");
  }
  return files;
}

function createWorkspace(files: Record<string, string>): string {
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(WORK_ROOT, "child-"));
  for (const rel of Object.keys(files).sort()) {
    const target = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, normalizeText(files[rel]), "utf8");
  }
  fs.writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ type: "module" }, null, 2) + "\n",
    "utf8"
  );
  fs.copyFileSync(CHILD_RUNNER_SOURCE, path.join(workspace, "child-runner.ts"));
  return workspace;
}

function validateOutput(parsed: unknown): parsed is ChildOutput {
  if (parsed === null || typeof parsed !== "object") return false;
  const out = parsed as Partial<ChildOutput>;
  return (
    out.ok === true &&
    typeof out.pid === "number" &&
    typeof out.ppid === "number" &&
    typeof out.candidateId === "string" &&
    Array.isArray(out.requests) &&
    Array.isArray(out.workspaceFiles) &&
    Array.isArray(out.payloadKeys) &&
    Array.isArray(out.forbidden)
  );
}

/**
 * Run one child process with a validated input/output contract.
 *
 * The workspace is removed on success, failure, timeout and abort.
 */
export async function runChildProcess(
  source: CandidateSource,
  config: ChildConfig,
  options: ChildRunOptions = {}
): Promise<ChildProcessResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const workspaceDir = createWorkspace(source.files);
  const startedAt = Date.now();

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let aborted = false;

  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--permission",
      `--allow-fs-read=${workspaceDir}`,
      path.join(workspaceDir, "child-runner.ts"),
    ],
    {
      cwd: workspaceDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  const onAbort = (): void => {
    aborted = true;
    child.kill("SIGKILL");
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  child.stdin.on("error", () => {
    /* the child may exit before reading stdin; reported via exit status */
  });
  child.stdin.write(JSON.stringify(config));
  child.stdin.end();

  return await new Promise<ChildProcessResult>((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      return true;
    };

    child.on("error", (err) => {
      if (!finish()) return;
      reject(
        new ChildExecutionError("spawn-error", `failed to spawn child: ${err.message}`, {
          workspaceDir,
          stdout,
          stderr,
        })
      );
    });

    child.on("close", (code, signal) => {
      if (!finish()) return;
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        reject(
          new ChildExecutionError("timeout", `child exceeded ${timeoutMs}ms`, {
            exitCode: code,
            signal,
            workspaceDir,
            stdout,
            stderr,
          })
        );
        return;
      }
      if (aborted) {
        reject(
          new ChildExecutionError("aborted", "child execution was aborted", {
            exitCode: code,
            signal,
            workspaceDir,
            stdout,
            stderr,
          })
        );
        return;
      }
      if (code !== 0) {
        reject(
          new ChildExecutionError(
            "non-zero-exit",
            `child exited with code ${String(code)} (signal ${String(signal)})`,
            { exitCode: code, signal, workspaceDir, stdout, stderr }
          )
        );
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        reject(
          new ChildExecutionError("malformed-output", "child stdout was not valid JSON", {
            exitCode: code,
            signal,
            workspaceDir,
            stdout,
            stderr,
          })
        );
        return;
      }
      if (!validateOutput(parsed)) {
        reject(
          new ChildExecutionError("malformed-output", "child output failed contract validation", {
            exitCode: code,
            signal,
            workspaceDir,
            stdout,
            stderr,
          })
        );
        return;
      }

      resolve({
        ...parsed,
        exitCode: code,
        signal,
        stdout,
        stderr,
        durationMs,
        workspaceDir,
        workspaceRemoved: true,
      });
    });
  });
}

export interface RunPassOptions extends ChildRunOptions {
  candidateId: string;
  pass: number;
  srcDir?: string;
  files?: Record<string, string>;
}

/** Run one oracle pass in a fresh child process. */
export async function runPass(options: RunPassOptions): Promise<PassExecution> {
  const files = options.files ?? (options.srcDir ? readSourceDir(options.srcDir) : undefined);
  if (!files) {
    throw new Error("runPass requires either srcDir or files");
  }
  if (!files["app.ts"]) {
    throw new Error("candidate source is missing app.ts");
  }
  if (!files["behavior.ts"]) {
    throw new Error("candidate source is missing behavior.ts");
  }

  const execution = await runChildProcess(
    { candidateId: options.candidateId, files },
    {
      mode: "run",
      candidateId: options.candidateId,
      requests: REQUEST_FIXTURES.map((fx) => ({ id: fx.id, path: fx.path, token: fx.token })),
      probePaths: [],
      forbiddenPaths: [],
    },
    { timeoutMs: options.timeoutMs, signal: options.signal }
  );

  const requestMap = new Map<string, RequestResult>();
  const auditDeltas: Record<string, AuditRecord[]> = {};
  for (const observed of execution.requests) {
    requestMap.set(observed.requestId, {
      requestId: observed.requestId,
      statusCode: observed.statusCode,
      body: observed.body,
    });
    auditDeltas[observed.requestId] = observed.auditDelta;
  }

  const evaluated = evaluateAll(requestMap, auditDeltas["P-missing"] ?? []);
  const assertions: Record<string, AssertionResult> = {};
  for (const [criterionId, result] of evaluated) {
    assertions[criterionId] = result;
  }

  return {
    candidateId: options.candidateId,
    pass: options.pass,
    process: {
      pid: execution.pid,
      ppid: execution.ppid,
      exitCode: execution.exitCode,
      signal: execution.signal,
      workspaceRemoved: execution.workspaceRemoved,
    },
    requests: [...requestMap.values()],
    auditDeltas,
    assertions,
    passed: Object.values(assertions).every((a) => a.passed),
    durationMs: execution.durationMs,
  };
}
