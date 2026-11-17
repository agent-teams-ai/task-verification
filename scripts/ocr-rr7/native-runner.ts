// Spawns the exact managed OCR binary against an in-process loopback fake
// provider. Used by the WP7 rr.7 qualification and the WP8 Profile A
// integration. Linux/amd64 only: the approved artifact is a Linux binary.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startFakeProvider, SYNTHETIC_TOKEN, type CapturedRequest, type OcrScenario } from "./fake-provider.ts";
import { MAX_OCR_INPUT_CHARS, renderOcrReviewerInput } from "../../src/ocr-profile-a.ts";

export { MAX_OCR_INPUT_CHARS as OCR_INPUT_MAX_CHARS, renderOcrReviewerInput };

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

interface RunResult {
  code: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 30000);
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, signal: null, stdout, stderr: stderr + String(err) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, signal, stdout, stderr });
    });
  });
}

export function gitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "OCR qualification fixture",
    GIT_AUTHOR_EMAIL: "fixture@test.invalid",
    GIT_COMMITTER_NAME: "OCR qualification fixture",
    GIT_COMMITTER_EMAIL: "fixture@test.invalid",
  };
}

async function git(cwd: string, home: string, args: string[]): Promise<string> {
  const out = await run(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    { cwd, env: gitEnv(home), timeoutMs: 30000 }
  );
  if (out.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr}`);
  return out.stdout.trim();
}

export interface SyntheticRepo {
  repo: string;
  outDir: string;
  base: string;
  head: string;
  diff: string;
}

/**
 * Build a fresh synthetic git repository without any remote.
 *
 * `headFiles` / `baseFiles` map repository-relative paths to file contents.
 * Both commits are created locally; no remote is configured and no external
 * repository is contacted.
 */
export async function makeSyntheticRepo(options: {
  root: string;
  home: string;
  headFiles: Record<string, string>;
  baseFiles: Record<string, string>;
}): Promise<SyntheticRepo> {
  const { root, home, headFiles, baseFiles } = options;
  const repo = path.join(root, "repo");
  const outDir = path.join(root, "out");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  await git(repo, home, ["init", "-q"]);
  fs.writeFileSync(path.join(repo, ".gitignore"), "*.log\n", "utf8");

  const writeAll = (files: Record<string, string>): void => {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(repo, ...rel.split("/"));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf8");
    }
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".git") continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else {
          const rel = path.relative(repo, p).split(path.sep).join("/");
          if (rel !== ".gitignore" && !(rel in files)) fs.rmSync(p);
        }
      }
    };
    walk(repo);
  };

  writeAll(baseFiles);
  await git(repo, home, ["add", "-A"]);
  await git(repo, home, ["commit", "-qm", "base"]);
  const base = await git(repo, home, ["rev-parse", "HEAD"]);
  writeAll(headFiles);
  await git(repo, home, ["add", "-A"]);
  await git(repo, home, ["commit", "-qm", "head"]);
  const head = await git(repo, home, ["rev-parse", "HEAD"]);
  const diff = await git(repo, home, ["diff", "--no-color", base, head]);
  return { repo, outDir, base, head, diff };
}

export function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export interface ManagedOcrOptions {
  binary: string;
  root: string;
  repo: string;
  base: string;
  head: string;
  reviewerInput: string;
  rule: unknown;
  scenario?: OcrScenario;
  comments?: unknown[];
  timeoutMs?: number;
  cancelAfterFirstRequest?: boolean;
  model?: string;
  stracePath?: string;
  /** Provider delay for the `stall` scenario; defaults to 30000 ms. */
  stallMs?: number;
  /** Paths the fake provider asks the binary to read with its native tool. */
  readPaths?: string[];
}

export interface ManagedOcrEvidence {
  scenario: string;
  model: string;
  binary_sha256: string;
  binary_size: number;
  started_at: number;
  duration_ms: number;
  exit_code: number;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  requests: CapturedRequest[];
  request_count: number;
  provider_problem: string | null;
  native: any;
  native_error: string | null;
  stdout: string;
  stderr: string;
  env_allowlist: NodeJS.ProcessEnv;
  result_path: string;
  repo_base: string;
  repo_head: string;
  strace_path: string | null;
}

/**
 * Run the approved binary once. The child environment is an explicit
 * allowlist: no inherited provider endpoint, credential or telemetry setting.
 */
export async function runManagedOcr(options: ManagedOcrOptions): Promise<ManagedOcrEvidence> {
  const {
    binary,
    root,
    repo,
    base,
    head,
    reviewerInput,
    rule,
    scenario = "finding",
    comments = [],
    timeoutMs = 45000,
    cancelAfterFirstRequest = false,
    model = "rr7-fake-model",
    stracePath,
    stallMs = 30000,
    readPaths = [],
  } = options;

  if (reviewerInput.length > MAX_OCR_INPUT_CHARS) {
    throw new Error(`reviewer input exceeds ${MAX_OCR_INPUT_CHARS} characters (${reviewerInput.length})`);
  }

  const home = path.join(root, "home");
  const cfgDir = path.join(home, ".opencodereview");
  fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
  fs.chmodSync(cfgDir, 0o700);

  const fake = await startFakeProvider({ scenario, model, comments, stallMs, readPaths });
  const config = {
    provider: "reviewrouter",
    language: "en",
    telemetry: { enabled: false },
    custom_providers: {
      reviewrouter: {
        protocol: "openai-responses",
        url: fake.url,
        api_key: `Bearer ${SYNTHETIC_TOKEN}`,
        model,
        timeout_sec: 10,
        extra_body: { service_tier: "default", reasoning: { effort: "medium" } },
      },
    },
  };
  writePrivateJson(path.join(cfgDir, "config.json"), config);

  const rulePath = path.join(root, "rule.json");
  writePrivateJson(rulePath, rule);
  const resultPath = path.join(root, "result.json");

  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    OCR_ENABLE_TELEMETRY: "0",
    OCR_CONTENT_LOGGING: "0",
    OCR_RAW_LOGGING: "0",
  };

  const args = [
    "review",
    "--reviewrouter-managed",
    "--repo",
    repo,
    "--from",
    base,
    "--to",
    head,
    "--provider",
    "reviewrouter",
    "--model",
    model,
    "--rule",
    rulePath,
    "--effort",
    "medium",
    "--concurrency",
    "1",
    "--format",
    "json",
    "--audience",
    "agent",
    "--timeout",
    "1",
    "--max-tokens",
    "32768",
    "--output",
    resultPath,
    "--background",
    reviewerInput,
  ];

  const program = stracePath ? "strace" : binary;
  const programArgs = stracePath
    ? ["-f", "-e", "trace=openat,openat2,execve,connect", "-o", stracePath, binary, ...args]
    : args;

  const started = Date.now();
  let cancelled = false;
  const childResult = await new Promise<RunResult>((resolve) => {
    const child = spawn(program, programArgs, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let killTimer: NodeJS.Timeout | null = null;
    const deadline = setTimeout(() => {
      cancelled = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, timeoutMs);
    if (cancelAfterFirstRequest) {
      const poll = setInterval(() => {
        if (fake.requests.length >= 1) {
          clearInterval(poll);
          cancelled = true;
          try {
            process.kill(-child.pid!, "SIGTERM");
          } catch {}
          killTimer = setTimeout(() => {
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {}
          }, 2000);
        }
      }, 10);
    }
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: -1, signal: null, stdout, stderr: stderr + String(err) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: code ?? -1, signal, stdout, stderr });
    });
  });

  await fake.close();

  let native: any = null;
  let nativeError: string | null = null;
  if (fs.existsSync(resultPath)) {
    try {
      native = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    } catch (err) {
      nativeError = String(err);
    }
  } else {
    nativeError = "result JSON was not written";
  }

  const evidence: ManagedOcrEvidence = {
    scenario,
    model,
    binary_sha256: sha256(fs.readFileSync(binary)),
    binary_size: fs.statSync(binary).size,
    started_at: started,
    duration_ms: Date.now() - started,
    exit_code: childResult.code,
    signal: childResult.signal,
    cancelled,
    requests: fake.requests,
    request_count: fake.requests.length,
    provider_problem: fake.state.problem,
    native,
    native_error: nativeError,
    stdout: childResult.stdout,
    stderr: childResult.stderr,
    env_allowlist: env,
    result_path: resultPath,
    repo_base: base,
    repo_head: head,
    strace_path: stracePath ?? null,
  };
  fs.writeFileSync(path.join(root, "native-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}

export function tmpRoot(prefix = "rr7-case-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
