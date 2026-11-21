/**
 * WP0 environment and toolchain tests (model-free).
 *
 * Verifies the pinned runtime, package manager, strict TypeScript tooling and
 * committed lockfile. No live model calls.
 *
 * Cross-platform: pnpm is resolved per-OS without shell interpolation; the
 * TypeScript CLI is invoked through the current Node executable using its
 * JavaScript entry point so no .CMD shim or `cmd` is required on POSIX.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC_ENTRY = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Resolve the pnpm version cross-platform without shell interpolation. */
function pnpmVersion(): string {
  if (process.platform === "win32") {
    // On Windows the pnpm shim is a .cmd; invoke through cmd with a fixed,
    // trusted literal (no untrusted interpolation).
    return execFileSync("cmd", ["/c", "pnpm --version"], { encoding: "utf8" }).trim();
  }
  // On POSIX, invoke the pnpm executable directly.
  return execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
}

/** Invoke the TypeScript CLI through the current Node executable. */
function runTsc(args: string[]): string {
  return execFileSync(process.execPath, [TSC_ENTRY, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe("WP0", () => {
  test("runtime version is exactly the pinned Node 24.13.1", () => {
    assert.strictEqual(process.versions.node, "24.13.1");
  });

  test("pnpm is installed and at the pinned version", () => {
    assert.strictEqual(pnpmVersion(), "9.15.0");
  });

  test("package.json pins TypeScript 7.0.2 as a devDependency", () => {
    const pkg = readJson(path.join(ROOT, "package.json")) as { devDependencies?: Record<string, string> };
    assert.strictEqual(pkg.devDependencies?.typescript, "7.0.2");
  });

  test("tsconfig enables strict TypeScript", () => {
    const tsconfig = readJson(path.join(ROOT, "tsconfig.json")) as { compilerOptions?: Record<string, unknown> };
    assert.strictEqual(tsconfig.compilerOptions?.strict, true);
  });

  test("lockfile is committed and references TypeScript", () => {
    assert.ok(fs.existsSync(path.join(ROOT, "pnpm-lock.yaml")));
    const lock = fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
    assert.ok(lock.includes("typescript"));
  });

  test("typecheck script passes (tsc --noEmit)", () => {
    const out = runTsc(["--noEmit", "-p", "tsconfig.json"]);
    assert.strictEqual(out.trim(), "");
  });

  test("declaration build (build:types) emits without error", () => {
    runTsc(["-p", "tsconfig.json"]);
    assert.ok(fs.existsSync(path.join(ROOT, "dist")));
  });
});