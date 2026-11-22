// Public-route verification of Candidate B's R3 correction, model-free.
//
// A is loaded from a clean tree extracted from commit 23864e3; B is the fixture
// worktree at its current HEAD. Both are exercised only through handle().
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const syn = path.resolve(dir, "../..");
const repo = path.join(syn, "repo");
const aTree = path.join(syn, "..", ".isolation-tmp", "d12", "a-tree");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });

const load = async (root) => (await import(pathToFileURL(path.join(root, "src", "router.ts")).href)).handle;
const handleA = await load(aTree);
const handleB = await load(repo);

const probe = (handle) => {
  const out = {};
  for (const [label, path_, query] of [
    ["plain", "/records.csv", {}],
    ["status-filter", "/records.csv", { status: "archived" }],
    ["empty-result", "/records.csv", { nameContains: "no such record" }],
    ["bad-status", "/records.csv", { status: "deleted" }],
    ["listing", "/records", { status: "archived" }],
  ]) {
    const res = handle({ method: "GET", path: path_, query });
    out[label] = { status: res.status, contentType: res.headers["content-type"] ?? null, body: res.body };
  }
  return out;
};

const a = probe(handleA);
const b = probe(handleB);

const record = {
  schema: "d12.candidate-b-route-evidence/v1",
  operator: "model-free; public handle() route; no model, provider or network",
  candidateA: "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9",
  candidateB: git("rev-parse", "HEAD").trim(),
  candidateBTree: git("rev-parse", "HEAD^{tree}").trim(),
  diffStat: git("diff", "--stat", "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9..HEAD").trim(),
  A: a,
  B: b,
  behavioralAssertions: {
    a_routeAbsent: a.plain.status === 404,
    b_routePresent: b.plain.status === 200,
    b_contentType: b.plain.contentType === "text/csv; charset=utf-8",
    b_headerRow: b.plain.body.split("\n")[0] === "id,name,status,createdAt",
    b_rowsMatchListing: b["status-filter"].body.trimEnd().split("\n").length === a.listing.body && false,
    b_filteredRows: b["status-filter"].body.trimEnd().split("\n").slice(1).map((l) => l.split(",")[0]),
    listingFilteredIds: JSON.parse(a.listing.body).items.map((i) => i.id),
    b_emptyResultIsHeaderOnly: b["empty-result"].body === "id,name,status,createdAt\n",
    b_badStatusRefused: b["bad-status"].status === 400 && JSON.parse(b["bad-status"].body).field === "status",
  },
};
record.behavioralAssertions.b_rowsMatchListing =
  JSON.stringify(record.behavioralAssertions.b_filteredRows) ===
  JSON.stringify(record.behavioralAssertions.listingFilteredIds);

fs.writeFileSync(path.join(dir, "candidate-b-route-evidence.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record.behavioralAssertions, null, 2));
console.log("--- B plain body ---");
console.log(b.plain.body);
