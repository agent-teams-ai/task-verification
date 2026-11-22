// Module-relative locations for the next-family batch.
//
// Every path here is derived from this module's own URL, never from
// `process.cwd()`. That is the correction for D3-R1: the D3 launcher resolved the
// proxy as `<research-root>/tooling/...` (repository root), but the tracked proxy
// lives at `synthetic/tooling/...`. A cwd- or repo-root-relative guess breaks as
// soon as the launcher is started from another directory or the repository root
// gains a second `tooling/` directory.
//
// There is exactly one accepted proxy location. There is no environment
// override, no search path and no fallback: if the canonical file is absent, the
// resolver throws instead of silently using some other proxy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `<repo>/synthetic/next-family/lib` */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `<repo>/synthetic/next-family` */
export const FAMILY_ROOT = path.resolve(HERE, "..");
/** `<repo>/synthetic` */
export const SYNTHETIC_ROOT = path.resolve(FAMILY_ROOT, "..");
/** `<repo>` */
export const RESEARCH_ROOT = path.resolve(SYNTHETIC_ROOT, "..");

export const PACKETS_DIR = path.join(FAMILY_ROOT, "packets");
export const RUNS_DIR = path.join(FAMILY_ROOT, "runs");
export const ATTEMPTS_DIR = path.join(RUNS_DIR, "attempts");
export const BUDGET_DIR = path.join(RUNS_DIR, "budget");
export const FIXTURE_REPO = path.join(FAMILY_ROOT, "repo");

/** The pinned Gateway SDK entry (`@agent-teams/account-gateway/llm`). */
export const SDK_LLM_DIST = path.join(
  RESEARCH_ROOT,
  "..",
  "agent-teams-ai-task-verification-m2",
  ".isolation-tmp",
  "d12",
  "sdk-src",
  "packages",
  "account-gateway",
  "dist",
  "llm",
  "index.js",
);

/**
 * Resolve the bounded proxy relative to a module URL.
 *
 * `moduleUrl` defaults to this module, i.e. `synthetic/next-family/lib/paths.mjs`;
 * the proxy is its sibling at `<repo>/synthetic/tooling/…`. The shape check makes
 * a mis-resolved path (repository-root `tooling/`, a package copy, a renamed
 * file) a hard error rather than a silently different boundary.
 */
export function resolveProxyPath(moduleUrl = import.meta.url) {
  const moduleFile = fileURLToPath(moduleUrl);
  const candidate = path.resolve(path.dirname(moduleFile), "..", "..", "tooling", "openrouter-bounded-proxy.mjs");

  const toolingDir = path.dirname(candidate);
  const syntheticDir = path.dirname(toolingDir);
  if (path.basename(candidate) !== "openrouter-bounded-proxy.mjs") {
    throw new Error(`proxy path is not the tracked proxy: ${candidate}`);
  }
  if (path.basename(toolingDir) !== "tooling" || path.basename(syntheticDir) !== "synthetic") {
    throw new Error(`proxy path is not beneath synthetic/tooling: ${candidate}`);
  }
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    throw new Error(`the bounded proxy is missing at its canonical module-relative location: ${candidate}`);
  }
  if (!stat.isFile()) throw new Error(`the bounded proxy is not a file: ${candidate}`);
  return fs.realpathSync(candidate);
}

/** Resolved once, lazily, so an import never fails just because the proxy is absent. */
let proxyMemo = null;
export function proxyPath() {
  if (proxyMemo === null) proxyMemo = resolveProxyPath();
  return proxyMemo;
}
