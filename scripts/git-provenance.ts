/**
 * Deterministic Git identity and diff computation for candidate snapshots.
 *
 * Each candidate is materialized into a throwaway repository containing only
 * its base/head application files. Fixed author/committer identity and dates,
 * `core.autocrlf=false` and LF content make the tree/commit identities and the
 * diff reproducible across runs and platforms.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeText } from "../src/digest.ts";
import type { FileMap } from "./snapshot-defs.ts";

export interface GitIdentity {
  commit: string;
  tree: string;
}

export interface GitProvenance {
  base: GitIdentity;
  head: GitIdentity;
  diffStat: string;
  diffFull: string;
  files: string[];
}

const AUTHOR_NAME = "M2-A Provenance";
const AUTHOR_EMAIL = "m2-a-provenance@local.invalid";
const BASE_DATE = "2026-11-14T00:00:00 +0000";
const HEAD_DATE = "2026-11-14T00:00:01 +0000";

function gitEnv(date: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

function git(repo: string, args: string[], date?: string): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: date ? gitEnv(date) : process.env,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/** Remove every non-`.git` entry so a repository can be rewritten in place. */
function clearWorkingTree(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

/** Write a file map with LF line endings, creating parent directories. */
export function writeFileMap(dir: string, files: FileMap): void {
  for (const rel of Object.keys(files).sort()) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, normalizeText(files[rel]), "utf8");
  }
}

/**
 * Compute deterministic base/head commit and tree identities plus the
 * base-to-head diff for one candidate snapshot.
 */
export function computeGitProvenance(
  repoDir: string,
  baseFiles: FileMap,
  headFiles: FileMap,
  baseLabel: string,
  headLabel: string
): GitProvenance {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.mkdirSync(repoDir, { recursive: true });

  git(repoDir, ["init", "-q", "-b", "main"]);
  git(repoDir, ["config", "user.name", AUTHOR_NAME]);
  git(repoDir, ["config", "user.email", AUTHOR_EMAIL]);
  git(repoDir, ["config", "core.autocrlf", "false"]);
  git(repoDir, ["config", "core.eol", "lf"]);
  git(repoDir, ["config", "commit.gpgsign", "false"]);

  clearWorkingTree(repoDir);
  writeFileMap(repoDir, baseFiles);
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", `base: ${baseLabel}`], BASE_DATE);
  const baseCommit = git(repoDir, ["rev-parse", "HEAD"]);
  const baseTree = git(repoDir, ["rev-parse", "HEAD^{tree}"]);

  clearWorkingTree(repoDir);
  writeFileMap(repoDir, headFiles);
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", `head: ${headLabel}`], HEAD_DATE);
  const headCommit = git(repoDir, ["rev-parse", "HEAD"]);
  const headTree = git(repoDir, ["rev-parse", "HEAD^{tree}"]);

  const diffStat = normalizeText(git(repoDir, ["diff", "--stat", baseCommit, headCommit]));
  const diffFull = normalizeText(git(repoDir, ["diff", baseCommit, headCommit]));
  const files = git(repoDir, ["ls-tree", "-r", "--name-only", headCommit])
    .split("\n")
    .filter(Boolean);

  return {
    base: { commit: baseCommit, tree: baseTree },
    head: { commit: headCommit, tree: headTree },
    diffStat,
    diffFull,
    files,
  };
}
