/**
 * Authoritative candidate snapshot materialization for WP8.
 *
 * WP8 must exercise the *official* candidate snapshots: the base/head file
 * maps, Git tree/commit identities, application digests and base-to-head diff
 * that `scripts/gen-candidates.ts` recorded in `candidates/provenance.json`.
 *
 * This module rebuilds those identities from the authoritative file maps with
 * the same deterministic Git recipe, then verifies them three ways:
 *
 *   1. against the in-memory file maps (application digest), and
 *   2. against the recorded provenance record (commit, tree, digest, diff), and
 *   3. by re-deriving every identity *from the Git repository bytes*
 *      (`git rev-parse`, `git ls-tree`, `git show`, `git diff`).
 *
 * No synthetic commit is ever reported as a candidate identity: if the
 * deterministic recipe does not reproduce the recorded identity the build
 * throws. A throwaway repository whose base/head commits differ from the
 * recorded ones is not a candidate materialization.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { applicationDigest, normalizeText } from "../../src/digest.ts";
import { computeGitProvenance } from "../git-provenance.ts";
import {
  APPLICATION_FILE_NAMES,
  baseFilesFor,
  candidateDef,
  headFilesFor,
  REPO_ROOT,
  type FileMap,
} from "../snapshot-defs.ts";

export const PROVENANCE_PATH = path.join(REPO_ROOT, "candidates", "provenance.json");

/** The reviewer materialization allowlist (application files only). */
export const AUTHORITATIVE_APP_FILES: readonly string[] = [...APPLICATION_FILE_NAMES];

export interface SnapshotIdentity {
  id: string;
  commit: string;
  tree: string;
  applicationDigest: string;
}

export interface AuthoritativeSnapshot {
  candidateId: string;
  /** Throwaway repository holding exactly the base and head commits. */
  repo: string;
  base: SnapshotIdentity;
  head: SnapshotIdentity;
  /** Exact official base-to-head diff. */
  diff: string;
  diffStat: string;
  /** Official head inventory (application files, repo-root relative). */
  files: string[];
  baseFiles: FileMap;
  headFiles: FileMap;
}

export interface ProvenanceRecord {
  candidate: string;
  snapshotPair: string;
  base: { id: string; commit: string; tree: string; applicationDigest: string };
  head: { id: string; commit: string; tree: string; applicationDigest: string };
  diffStat: string;
  diffFull: string;
  files: string[];
}

export function loadProvenanceRecord(candidateId: string): ProvenanceRecord {
  const all = JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf8")) as Record<string, ProvenanceRecord>;
  const record = all[candidateId];
  if (!record) throw new Error(`no provenance record for ${candidateId}`);
  return record;
}

function gitEnv(date: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

function git(repo: string, args: string[], date?: string): string {
  return gitRaw(repo, args, date).trim();
}

/**
 * Run git and return stdout verbatim. File content and diffs must never be
 * trimmed: trailing newlines are part of the application bytes and therefore
 * part of the recorded digest.
 */
function gitRaw(repo: string, args: string[], date?: string): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: date ? gitEnv(date) : process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Canonical diff comparison form: LF line endings, single trailing newline. */
export function canonicalDiff(diff: string): string {
  return normalizeText(diff).replace(/\n+$/, "");
}

/**
 * Re-derive the commit/tree identities, file inventory, per-file bytes and
 * diff from the repository that was actually created. This is the independent
 * readback: nothing here trusts the maps that were used to build the repo.
 */
export function readBackSnapshot(snapshot: AuthoritativeSnapshot): {
  baseCommit: string;
  baseTree: string;
  headCommit: string;
  headTree: string;
  files: string[];
  baseFiles: FileMap;
  headFiles: FileMap;
  diff: string;
  baseApplicationDigest: string;
  headApplicationDigest: string;
} {
  const baseCommit = git(snapshot.repo, ["rev-parse", snapshot.base.commit]);
  const headCommit = git(snapshot.repo, ["rev-parse", snapshot.head.commit]);
  const baseTree = git(snapshot.repo, ["rev-parse", `${baseCommit}^{tree}`]);
  const headTree = git(snapshot.repo, ["rev-parse", `${headCommit}^{tree}`]);
  const files = git(snapshot.repo, ["ls-tree", "-r", "--name-only", headCommit])
    .split("\n")
    .filter(Boolean)
    .sort();
  const readTree = (commit: string): FileMap => {
    const out: FileMap = {};
    for (const rel of files) {
      out[rel] = normalizeText(gitRaw(snapshot.repo, ["show", `${commit}:${rel}`]));
    }
    return out;
  };
  const baseFiles = readTree(baseCommit);
  const headFiles = readTree(headCommit);
  const diff = normalizeText(gitRaw(snapshot.repo, ["diff", "--no-color", baseCommit, headCommit]));
  return {
    baseCommit,
    baseTree,
    headCommit,
    headTree,
    files,
    baseFiles,
    headFiles,
    diff,
    baseApplicationDigest: applicationDigest(baseFiles),
    headApplicationDigest: applicationDigest(headFiles),
  };
}

export interface SnapshotVerification {
  ok: boolean;
  errors: string[];
  readback: ReturnType<typeof readBackSnapshot>;
}

/** Verify every recorded identity against the repository bytes. */
export function verifySnapshot(snapshot: AuthoritativeSnapshot): SnapshotVerification {
  const record = loadProvenanceRecord(snapshot.candidateId);
  const readback = readBackSnapshot(snapshot);
  const errors: string[] = [];

  if (readback.baseCommit !== record.base.commit) {
    errors.push(`base commit: repo ${readback.baseCommit} != recorded ${record.base.commit}`);
  }
  if (readback.headCommit !== record.head.commit) {
    errors.push(`head commit: repo ${readback.headCommit} != recorded ${record.head.commit}`);
  }
  if (readback.baseTree !== record.base.tree) {
    errors.push(`base tree: repo ${readback.baseTree} != recorded ${record.base.tree}`);
  }
  if (readback.headTree !== record.head.tree) {
    errors.push(`head tree: repo ${readback.headTree} != recorded ${record.head.tree}`);
  }
  if (readback.baseApplicationDigest !== record.base.applicationDigest) {
    errors.push(
      `base application digest: repo ${readback.baseApplicationDigest} != recorded ${record.base.applicationDigest}`,
    );
  }
  if (readback.headApplicationDigest !== record.head.applicationDigest) {
    errors.push(
      `head application digest: repo ${readback.headApplicationDigest} != recorded ${record.head.applicationDigest}`,
    );
  }
  if (canonicalDiff(readback.diff) !== canonicalDiff(record.diffFull)) {
    errors.push("base-to-head diff differs from the recorded official diff");
  }
  const expectedFiles = [...record.files].sort();
  if (JSON.stringify(readback.files) !== JSON.stringify(expectedFiles)) {
    errors.push(`head inventory: repo ${JSON.stringify(readback.files)} != recorded ${JSON.stringify(expectedFiles)}`);
  }
  for (const name of readback.files) {
    if (!AUTHORITATIVE_APP_FILES.includes(name)) {
      errors.push(`head inventory contains a file outside the application allowlist: ${name}`);
    }
  }

  return { ok: errors.length === 0, errors, readback };
}

/**
 * Build the official base/head repository for one candidate and assert that it
 * reproduces the recorded identities exactly.
 *
 * @param candidateId  One of S1-C1..S1-C4.
 * @param root         Fresh directory used for the throwaway repository.
 */
export function buildAuthoritativeSnapshot(candidateId: string, root: string): AuthoritativeSnapshot {
  const def = candidateDef(candidateId);
  const baseFiles = baseFilesFor(candidateId);
  const headFiles = headFilesFor(candidateId);
  const record = loadProvenanceRecord(candidateId);

  // 1. Digest check on the authoritative maps, before any Git work.
  const baseDigest = applicationDigest(baseFiles);
  const headDigest = applicationDigest(headFiles);
  if (baseDigest !== record.base.applicationDigest) {
    throw new Error(
      `${candidateId}: base application digest ${baseDigest} != recorded ${record.base.applicationDigest}`,
    );
  }
  if (headDigest !== record.head.applicationDigest) {
    throw new Error(
      `${candidateId}: head application digest ${headDigest} != recorded ${record.head.applicationDigest}`,
    );
  }

  // 2. Rebuild the identities with the same deterministic recipe the
  //    provenance record was generated with (identical author/committer
  //    identity, dates and commit messages).
  const repo = path.join(root, "repo");
  fs.mkdirSync(root, { recursive: true });
  const built = computeGitProvenance(
    repo,
    baseFiles,
    headFiles,
    `${def.base} (deny-all stub)`,
    `${def.head} (${def.id})`,
  );

  const snapshot: AuthoritativeSnapshot = {
    candidateId,
    repo,
    base: {
      id: def.base,
      commit: built.base.commit,
      tree: built.base.tree,
      applicationDigest: baseDigest,
    },
    head: {
      id: def.head,
      commit: built.head.commit,
      tree: built.head.tree,
      applicationDigest: headDigest,
    },
    diff: normalizeText(built.diffFull),
    diffStat: built.diffStat,
    files: [...built.files].sort(),
    baseFiles,
    headFiles,
  };

  // 3. Independent verification from the repository bytes.
  const verification = verifySnapshot(snapshot);
  if (!verification.ok) {
    throw new Error(
      `${candidateId}: rebuilt snapshot does not reproduce the official identity:\n  ` +
        verification.errors.join("\n  "),
    );
  }
  return snapshot;
}

/** Root used by callers that only need a scratch directory. */
export function snapshotRoot(root: string): string {
  return path.resolve(root);
}

/** Convenience: the official diff with the trailing newline the repo records. */
export function officialDiff(snapshot: AuthoritativeSnapshot): string {
  return snapshot.diff;
}

export const PROVENANCE_FILE = PROVENANCE_PATH;
export const REPO = REPO_ROOT;
export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
