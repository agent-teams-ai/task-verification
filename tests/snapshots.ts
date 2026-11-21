/**
 * Snapshot integrity tests (M2-A maintainer correction 1).
 *
 * One authoritative snapshot model per candidate drives reviewer files, Git
 * identities, the diff, the oracle subject and the application digest. These
 * tests recompute every derived artifact from the recorded snapshot and verify
 * forward/reverse diff application, `.git` exclusion and deterministic
 * regeneration.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  applicationDigest,
  applicationDigestFromDir,
  normalizeText,
  readApplicationFiles,
} from "../src/digest.ts";
import {
  b0Files,
  b1Files,
  baseFilesFor,
  buildSnapshotModel,
  CANDIDATE_IDS,
  headFilesFor,
} from "../scripts/snapshot-defs.ts";
import { writeFileMap } from "../scripts/git-provenance.ts";
import { computeCandidateGitProvenance } from "../scripts/gen-candidates.ts";
import { buildReviewerMaterialization, MATERIALIZATION_ROOT } from "../src/materialization.ts";
import { candidateManifestPath, candidateSrcDir, provenancePath } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP_ROOT = path.join(ROOT, ".candidates-work", "snapshot-tests");

interface ProvenanceRecord {
  candidate: string;
  base: { id: string; commit: string; tree: string; applicationDigest: string };
  head: { id: string; commit: string; tree: string; applicationDigest: string };
  diffStat: string;
  diffFull: string;
  files: string[];
}

function readProvenance(): Record<string, ProvenanceRecord> {
  return JSON.parse(fs.readFileSync(provenancePath(), "utf8"));
}

function readManifest(candidateId: string): {
  baseApplicationDigest: string;
  headApplicationDigest: string;
} {
  return JSON.parse(fs.readFileSync(candidateManifestPath(candidateId), "utf8"));
}

function makeTempDir(prefix: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, prefix));
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "M2-A Snapshot Test",
      GIT_AUTHOR_EMAIL: "m2-a-snapshot@local.invalid",
      GIT_COMMITTER_NAME: "M2-A Snapshot Test",
      GIT_COMMITTER_EMAIL: "m2-a-snapshot@local.invalid",
      GIT_AUTHOR_DATE: "2026-11-14T00:00:00 +0000",
      GIT_COMMITTER_DATE: "2026-11-14T00:00:00 +0000",
    },
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function cleanup(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

function assertFileMapEqual(actual: Record<string, string>, expected: Record<string, string>, label: string): void {
  assert.deepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: file set`);
  for (const key of Object.keys(expected).sort()) {
    assert.strictEqual(normalizeText(actual[key]), normalizeText(expected[key]), `${label}/${key}: content`);
  }
}

describe("snapshot integrity", () => {
  test("recorded head identities, reviewer files and application digests come from one snapshot", () => {
    const provenance = readProvenance();
    for (const id of CANDIDATE_IDS) {
      const prov = provenance[id];
      const manifest = readManifest(id);
      const srcFiles = readApplicationFiles(candidateSrcDir(id));
      const modelHead = headFilesFor(id);
      const modelBase = baseFilesFor(id);

      assertFileMapEqual(srcFiles, modelHead, `${id} reviewer files`);
      assert.strictEqual(applicationDigest(srcFiles), prov.head.applicationDigest, `${id} head digest`);
      assert.strictEqual(applicationDigest(modelHead), prov.head.applicationDigest, `${id} model head digest`);
      assert.strictEqual(applicationDigest(modelBase), prov.base.applicationDigest, `${id} base digest`);
      assert.strictEqual(manifest.headApplicationDigest, prov.head.applicationDigest, `${id} manifest head digest`);
      assert.strictEqual(manifest.baseApplicationDigest, prov.base.applicationDigest, `${id} manifest base digest`);
      assert.deepStrictEqual(prov.files, Object.keys(modelHead).sort(), `${id} recorded head file list`);
      assert.deepStrictEqual(Object.keys(modelHead).sort(), Object.keys(modelBase).sort(), `${id} base/head file set`);
    }
  });

  test("materialized reviewer files match the recorded head snapshot and digest", () => {
    const provenance = readProvenance();
    for (const id of CANDIDATE_IDS) {
      const out = path.join(MATERIALIZATION_ROOT, "snapshot-integrity", id);
      const result = buildReviewerMaterialization(id, out);
      const head = headFilesFor(id);
      for (const file of Object.keys(head)) {
        assert.strictEqual(
          normalizeText(fs.readFileSync(path.join(out, file), "utf8")),
          normalizeText(head[file]),
          `${id}/${file}: materialized content`
        );
      }
      assert.strictEqual(result.headApplicationDigest, provenance[id].head.applicationDigest);
      assert.strictEqual(result.recordedHeadApplicationDigest, provenance[id].head.applicationDigest);
      cleanup(path.join(MATERIALIZATION_ROOT, "snapshot-integrity"));
    }
  });

  test("recorded diffs forward-apply to the head and reverse-apply to the exact base", () => {
    const provenance = readProvenance();
    for (const id of CANDIDATE_IDS) {
      const repo = makeTempDir(`apply-${id}-`);
      try {
        git(repo, ["init", "-q", "-b", "main"]);
        git(repo, ["config", "user.name", "M2-A Snapshot Test"]);
        git(repo, ["config", "user.email", "m2-a-snapshot@local.invalid"]);
        git(repo, ["config", "core.autocrlf", "false"]);
        writeFileMap(repo, baseFilesFor(id));
        git(repo, ["add", "-A"]);
        git(repo, ["commit", "-q", "-m", "base"]);

        const patchPath = path.join(makeTempDir(`patch-${id}-`), "candidate.diff");
        fs.writeFileSync(patchPath, provenance[id].diffFull + "\n", "utf8");

        git(repo, ["apply", "--check", patchPath]);
        git(repo, ["apply", patchPath]);
        assertFileMapEqual(readApplicationFiles(repo), headFilesFor(id), `${id} forward apply`);

        git(repo, ["apply", "-R", patchPath]);
        assertFileMapEqual(readApplicationFiles(repo), baseFilesFor(id), `${id} reverse apply`);
      } finally {
        cleanup(repo);
        cleanup(TMP_ROOT);
      }
    }
  });

  test("application digests exclude .git administrative metadata", () => {
    const appFiles = headFilesFor("S1-C1");
    const dirA = makeTempDir("git-a-");
    const dirB = makeTempDir("git-b-");
    try {
      writeFileMap(dirA, appFiles);
      writeFileMap(dirB, appFiles);
      fs.mkdirSync(path.join(dirA, ".git", "objects"), { recursive: true });
      fs.mkdirSync(path.join(dirB, ".git", "objects"), { recursive: true });
      fs.writeFileSync(path.join(dirA, ".git", "config"), "junk-a\n", "utf8");
      fs.writeFileSync(path.join(dirB, ".git", "config"), "different-junk-b\n", "utf8");

      const expected = applicationDigest(appFiles);
      assert.strictEqual(applicationDigestFromDir(dirA), expected);
      assert.strictEqual(applicationDigestFromDir(dirB), expected);
      assert.strictEqual(applicationDigestFromDir(dirA), applicationDigestFromDir(dirB));
      assert.ok(!Object.keys(readApplicationFiles(dirA)).some((f) => f.startsWith(".git")));
    } finally {
      cleanup(dirA);
      cleanup(dirB);
    }
  });

  test("repeated snapshot and Git generation is deterministic", () => {
    const provenance = readProvenance();
    const first = buildSnapshotModel();
    const second = buildSnapshotModel();
    assert.deepStrictEqual(first, second);

    for (const id of CANDIDATE_IDS) {
      const entry = first.find((e) => e.def.id === id);
      assert.ok(entry, `missing snapshot entry ${id}`);
      const repoA = makeTempDir(`det-a-${id}-`);
      const repoB = makeTempDir(`det-b-${id}-`);
      try {
        const a = computeCandidateGitProvenance(entry, repoA);
        const b = computeCandidateGitProvenance(entry, repoB);
        assert.deepStrictEqual(a, b, `${id} repeated Git generation`);
        assert.strictEqual(a.base.commit, provenance[id].base.commit, `${id} base commit`);
        assert.strictEqual(a.base.tree, provenance[id].base.tree, `${id} base tree`);
        assert.strictEqual(a.head.commit, provenance[id].head.commit, `${id} head commit`);
        assert.strictEqual(a.head.tree, provenance[id].head.tree, `${id} head tree`);
        assert.strictEqual(a.diffFull, provenance[id].diffFull, `${id} diff`);
      } finally {
        cleanup(repoA);
        cleanup(repoB);
        cleanup(TMP_ROOT);
      }
    }
  });

  test("C1/C2/C3 share B0 and C4 exposes an unchanged B1 serializer", () => {
    const b0Digests = ["S1-C1", "S1-C2", "S1-C3"].map((id) => applicationDigest(baseFilesFor(id)));
    assert.strictEqual(new Set(b0Digests).size, 1, "C1/C2/C3 base snapshots must be identical");
    assert.deepStrictEqual(baseFilesFor("S1-C1"), baseFilesFor("S1-C2"));
    assert.deepStrictEqual(baseFilesFor("S1-C1"), baseFilesFor("S1-C3"));

    const b0 = b0Files();
    const b1 = b1Files();
    for (const key of Object.keys(b0).sort()) {
      if (key === "serializer.ts") {
        assert.notStrictEqual(b0[key], b1[key], "B1 serializer content must differ from B0");
      } else {
        assert.strictEqual(b0[key], b1[key], `B0/B1 must agree on ${key}`);
      }
    }

    const c4Base = baseFilesFor("S1-C4");
    const c4Head = headFilesFor("S1-C4");
    assert.strictEqual(c4Head["serializer.ts"], c4Base["serializer.ts"], "C4 must not modify the serializer");
    assert.strictEqual(c4Head["serializer.ts"], b1["serializer.ts"], "C4 must expose the B1 serializer");
    assert.strictEqual(c4Head["app.ts"], headFilesFor("S1-C1")["app.ts"], "C4 head route equals the correct inline route");
    assert.notStrictEqual(c4Base["serializer.ts"], baseFilesFor("S1-C1")["serializer.ts"]);
  });

  test("all four head snapshots are distinct", () => {
    const digests = CANDIDATE_IDS.map((id) => applicationDigest(headFilesFor(id)));
    assert.strictEqual(new Set(digests).size, 4);
  });

  test("candidate snapshot directories contain no Git metadata", () => {
    for (const id of CANDIDATE_IDS) {
      assert.ok(!fs.existsSync(path.join(candidateSrcDir(id), ".git")));
    }
  });
});
