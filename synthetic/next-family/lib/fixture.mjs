// Materialize a frozen candidate commit into a temporary directory and run its own
// suite there.
//
// The fixture repository is never mutated: the tree is written file by file from
// `git ls-tree`/`git show`, so what runs is exactly the frozen commit. The
// workspace package that c03 delegates to is copied beside the checkout, because
// that is where the service resolves it — a sibling of the service repository.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FAMILY_ROOT, FIXTURE_REPO } from "./paths.mjs";

export const git = (...args) =>
  execFileSync("git", ["-C", FIXTURE_REPO, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function materialize(sha, { withWorkspacePackage = false, prefix = "next-family-tree" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${sha.slice(0, 7)}-`));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const files = git("ls-tree", "-r", "--name-only", sha).split("\n").filter(Boolean);
  for (const file of files) {
    const target = path.join(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git("show", `${sha}:${file}`));
  }
  if (withWorkspacePackage) {
    fs.cpSync(path.join(FAMILY_ROOT, "packages", "delivery-core"), path.join(root, "packages", "delivery-core"), {
      recursive: true,
    });
  }
  return { root, repo, files };
}

/** Run the repository's own suite exactly as its package.json defines it. */
export function runSuite({ repo, files }) {
  const testFiles = files.filter((file) => /^tests\/.+\.test\.ts$/.test(file));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "--test-concurrency=1", ...testFiles],
    { cwd: repo, encoding: "utf8", env },
  );
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const count = (label) => Number(output.match(new RegExp(`ℹ ${label} (\\d+)`, "u"))?.[1] ?? NaN);
  return {
    status: child.status,
    output,
    counts: { tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped") },
  };
}

export function runProbe(repo) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(FAMILY_ROOT, "evaluator", "behavior-probe.mjs"), repo],
    { encoding: "utf8", env },
  );
  if (child.status !== 0) throw new Error(`behavior probe failed: ${child.stderr}`);
  return JSON.parse(child.stdout);
}
