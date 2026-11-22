// Model-free probe of the frozen R1 contract through the public service route.
//
// Every case calls the fixture's own `handle()` with a synthetic request, so the
// observed values are public-route behaviour. No model, no provider, no network.
//
// The frozen requirements (record-api-req-v1) oblige R1 to list records with the
// requested filters and pagination. They state no numeric bounds and no error
// behaviour for empty parameter values; the candidate's own README documents
// limit default 20 / max 100 and offset default 0. Each case is therefore marked
// with the authority for its expectation, not assumed.
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repoDir = process.env.REPO_DIR ?? path.join(dir, "../../repo");
const { pathToFileURL } = await import("node:url");
const { handle } = await import(pathToFileURL(path.join(repoDir, "src", "router.ts")).href);

const CASES = [
  { name: "no parameters", query: {}, authority: "frozen R1 (list) + documented defaults" },
  { name: "empty limit=", query: { limit: "" }, authority: "not specified by the frozen contract" },
  { name: "empty offset=", query: { offset: "" }, authority: "not specified by the frozen contract" },
  { name: "empty limit= and offset=", query: { limit: "", offset: "" }, authority: "not specified by the frozen contract" },
  { name: "empty status=", query: { status: "" }, authority: "not specified by the frozen contract" },
  { name: "status=active", query: { status: "active" }, authority: "frozen R1 (requested filters)" },
  { name: "nameContains trimmed and case-insensitive", query: { nameContains: "  ACCESS REVIEW " }, authority: "frozen R1 (requested filters)" },
  { name: "limit=1", query: { limit: "1" }, authority: "frozen R1 (pagination)" },
  { name: "documented maximum limit=100", query: { limit: "100" }, authority: "candidate README (documented bound)" },
  { name: "limit just above documented maximum (101)", query: { limit: "101" }, authority: "candidate README (documented bound)" },
  { name: "limit=0", query: { limit: "0" }, authority: "candidate implementation (minimum bound)" },
  { name: "limit=abc", query: { limit: "abc" }, authority: "candidate implementation (malformed)" },
  { name: "limit=-1", query: { limit: "-1" }, authority: "candidate implementation (malformed)" },
  { name: "limit=1.5", query: { limit: "1.5" }, authority: "candidate implementation (malformed)" },
  { name: "offset=0", query: { offset: "0" }, authority: "frozen R1 (pagination)" },
  { name: "offset=5", query: { offset: "5" }, authority: "frozen R1 (pagination)" },
  { name: "offset beyond the filtered set", query: { offset: "99" }, authority: "frozen R1 (pagination past the end)" },
  { name: "offset=max safe integer", query: { offset: String(Number.MAX_SAFE_INTEGER) }, authority: "candidate implementation (upper bound)" },
  { name: "offset=abc", query: { offset: "abc" }, authority: "candidate implementation (malformed)" },
  { name: "status=deleted", query: { status: "deleted" }, authority: "candidate implementation (unknown enum)" },
  { name: "status=active&limit=2&offset=1", query: { status: "active", limit: "2", offset: "1" }, authority: "frozen R1 (filters plus pagination together)" },
  { name: "limit=2&offset=5", query: { limit: "2", offset: "5" }, authority: "frozen R1 (last partial page)" },
];

const results = CASES.map((entry) => {
  const response = handle({ method: "GET", path: "/records", query: entry.query });
  let payload = null;
  try {
    payload = JSON.parse(response.body);
  } catch {
    payload = null;
  }
  return {
    name: entry.name,
    query: entry.query,
    authority: entry.authority,
    status: response.status,
    contentType: response.headers["content-type"] ?? null,
    limit: payload?.limit ?? null,
    offset: payload?.offset ?? null,
    total: payload?.total ?? null,
    itemIds: Array.isArray(payload?.items) ? payload.items.map((item) => item.id) : null,
    field: payload?.field ?? null,
    error: payload?.error ?? null,
  };
});

const record = {
  schema: "d12.r1-contract-probe/v1",
  operator: "model-free; fixture handle() called directly; no model, provider or network",
  fixture: {
    reviewedTree: repoDir,
    candidateA: "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9",
    route: "GET /records",
    frozenRequirements: "synthetic/requirements/RECORD-API-v1.md",
    requirementsSha256: "ca868a3fcc2a9100eabda736c48a8e107125a1f5a8477eede3665be96bde727f",
  },
  obligationText: {
    R1: "The API must list records with the requested filters and pagination.",
    statedBounds: "none in the frozen requirement",
    documentedByCandidate: "limit defaults to 20 and may not exceed 100; offset defaults to 0",
    stated400Obligation: "none in the frozen requirement",
  },
  cases: results,
};
fs.writeFileSync(path.join(dir, process.env.OUT ?? "r1-contract-probe.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
