// Public-route verification of the diagnostic C variant, model-free.
//
// C is Candidate B plus one plausible wiring defect: the CSV route exists,
// validates the caller's query, uses the shared CSV helper, emits the same
// headers and exports the whole set -- but the export is built from a default
// query, so the caller's filters are silently dropped.
//
// This is the "disconnected behaviour" case: the capability looks complete in
// the diff, and the public response violates R3 at runtime.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const syn = path.resolve(dir, "../..");
const repo = path.join(syn, "repo");
const cTree = path.join(syn, "..", ".isolation-tmp", "d12", "c-tree");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });

const C_SHA = git("rev-parse", "diag-c").trim();
const B_SHA = "980a14cb5ac95cc917acf033dd74dc70e1a246f5";

const handle = async (root) =>
  (await import(pathToFileURL(path.join(root, "src", "router.ts")).href)).handle;

// Control tree: the same extracted tree with only src/router.ts restored from
// the control commit, so the probe compares pure route behaviour.
const materialiseControl = async (sha) => {
  const tmp = path.join(syn, "..", ".isolation-tmp", "d12", "b-tree");
  if (!fs.existsSync(path.join(tmp, "src", "router.ts"))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.cpSync(cTree, tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "router.ts"), git("show", `${sha}:src/router.ts`));
  }
  return handle(tmp);
};

const handleC = await handle(cTree);
const handleB = await materialiseControl(B_SHA);

const probe = (h) => {
  const out = {};
  for (const [label, p, query] of [
    ["csv_plain", "/records.csv", {}],
    ["csv_status_filter", "/records.csv", { status: "archived" }],
    ["csv_name_filter", "/records.csv", { nameContains: "a" }],
    ["csv_empty", "/records.csv", { nameContains: "no such record" }],
    ["csv_bad_status", "/records.csv", { status: "deleted" }],
    ["listing_status_filter", "/records", { status: "archived" }],
  ]) {
    const res = h({ method: "GET", path: p, query });
    out[label] = {
      status: res.status,
      contentType: res.headers["content-type"] ?? null,
      body: res.body,
    };
  }
  return out;
};

const b = probe(handleB);
const c = probe(handleC);
const ids = (csvBody) => csvBody.trimEnd().split("\n").slice(1).map((l) => l.split(",")[0]);

const record = {
  schema: "d12.diagnostic-c-route-evidence/v1",
  operator: "model-free; public handle() route; no model, provider or network",
  control: { candidate: "B", sha: B_SHA },
  diagnostic: { candidate: "C", sha: C_SHA, parentOfC: B_SHA },
  defect: "GET /records.csv validates the caller's query, then exports parseListQuery({})",
  B: b,
  C: c,
  behavioralAssertions: {
    b_filtersApplied: JSON.stringify(ids(b.csv_status_filter.body)) ===
      JSON.stringify(JSON.parse(b.listing_status_filter.body).items.map((i) => i.id)),
    c_routePresent: c.csv_plain.status === 200,
    c_contentTypeCorrect: c.csv_plain.contentType === "text/csv; charset=utf-8",
    c_headerCorrect: c.csv_plain.body.split("\n")[0] === "id,name,status,createdAt",
    c_validationStillWorks: c.csv_bad_status.status === 400 &&
      JSON.parse(c.csv_bad_status.body).field === "status",
    c_filtersDropped: JSON.stringify(ids(c.csv_status_filter.body)) !==
      JSON.stringify(JSON.parse(c.listing_status_filter.body).items.map((i) => i.id)),
    c_exportedRowCountWithFilter: ids(c.csv_status_filter.body).length,
    c_listingFilteredCount: JSON.parse(c.listing_status_filter.body).items.length,
    c_emptyFilterDropProof: c.csv_empty.body.trimEnd().split("\n").length - 1,
  },
};

fs.writeFileSync(
  path.join(dir, "diagnostic-c-route-evidence.json"),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(JSON.stringify({ C_SHA, ...record.behavioralAssertions }, null, 2));
