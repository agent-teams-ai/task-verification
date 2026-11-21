#!/usr/bin/env node
/**
 * Freeze the synthetic PR material from real Git identities.
 *
 * Writes `synthetic/metadata/pr.json` (PR shape, changed paths, unchanged
 * context, ordinary check definition) and `synthetic/metadata/DIGESTS.json`.
 *
 * Usage: node synthetic/tools/manifests.mjs <base-sha> <head-sha>
 */
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.join(ROOT, "repo");
const OUT = path.join(ROOT, "metadata");

const [baseSha, headSha] = process.argv.slice(2);
if (!baseSha || !headSha) {
  console.error("usage: manifests.mjs <base-sha> <head-sha>");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).replace(/\r\n/g, "\n");

const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function blob(sha, file) {
  try {
    return git("show", `${sha}:${file}`);
  } catch {
    return null;
  }
}

const changedPaths = git("diff", "--name-status", baseSha, headSha)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, file] = line.split("\t");
    return { status, path: file, sha256: sha256(blob(headSha, file) ?? "") };
  });

const headFiles = git("ls-tree", "-r", "--name-only", headSha).trim().split("\n").filter(Boolean);
const changedSet = new Set(changedPaths.map((c) => c.path));
const unchangedContext = headFiles
  .filter((f) => !changedSet.has(f))
  .map((file) => ({ path: file, sha256: sha256(blob(headSha, file) ?? "") }));

const packageJson = JSON.parse(blob(headSha, "package.json"));

const pr = {
  schema: "synthetic.pilot.pr/v1",
  fixture: "record-management-api",
  title: "feat(records): add filtered, paginated record listing",
  body: [
    "## What",
    "",
    "Adds `GET /records`, which lists records from the existing in-memory store with the requested",
    "filters (`status`, `nameContains`) and pagination (`limit`, `offset`). `total` reports the size of",
    "the filtered set before pagination.",
    "",
    "## Notes",
    "",
    "- Timestamps are rendered through the existing `toUtcIsoString` helper, so responses are UTC",
    "  ISO-8601 regardless of the offset stored on the record.",
    "- An unusable `limit`, `offset` or `status` is answered with `400` and the offending field.",
    "",
    "## Tests",
    "",
    "`npm test` covers filters, pagination, totals, UTC rendering and the two rejection paths.",
  ].join("\n"),
  baseSha,
  headSha,
  baseRef: git("rev-parse", "--abbrev-ref", "main").trim() === "" ? null : "main",
  headRef: "candidate-a",
  baseCommitSubject: git("log", "-1", "--format=%s", baseSha).trim(),
  headCommitSubject: git("log", "-1", "--format=%s", headSha).trim(),
  baseCommittedAt: git("log", "-1", "--format=%cI", baseSha).trim(),
  headCommittedAt: git("log", "-1", "--format=%cI", headSha).trim(),
  changedPaths,
  unchangedContext,
  ordinaryChecks: {
    definition: "package.json#scripts.test",
    command: packageJson.scripts.test,
    checkDefinitionDigest: sha256(JSON.stringify(packageJson.scripts)),
    source: "the candidate repository's own suite",
  },
  requirements: {
    path: "synthetic/requirements/RECORD-API-v1.md",
    revision: "record-api-req-v1",
  },
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "pr.json"), `${JSON.stringify(pr, null, 2)}\n`);

const digests = {
  schema: "synthetic.pilot.digests/v1",
  baseSha,
  headSha,
  trees: {
    base: git("rev-parse", `${baseSha}^{tree}`).trim(),
    head: git("rev-parse", `${headSha}^{tree}`).trim(),
  },
  commits: {
    base: sha256(git("cat-file", "commit", baseSha)),
    head: sha256(git("cat-file", "commit", headSha)),
  },
  requirements: {
    path: "synthetic/requirements/RECORD-API-v1.md",
    sha256: sha256(fs.readFileSync(path.join(ROOT, "requirements", "RECORD-API-v1.md"), "utf8")),
  },
};
fs.writeFileSync(path.join(OUT, "DIGESTS.json"), `${JSON.stringify(digests, null, 2)}\n`);

console.log(`changed ${changedPaths.length}, unchanged ${unchangedContext.length}`);
console.log(JSON.stringify(digests, null, 2));
