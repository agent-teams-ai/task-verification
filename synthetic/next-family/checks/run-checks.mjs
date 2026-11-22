// Model-free receipts for the next-family batch.
//
//   node synthetic/next-family/checks/run-checks.mjs
//
// For every frozen candidate: run the repository's own suite in a materialized
// copy of the commit, run the evaluator behaviour probe against the same tree, and
// write the receipts under checks/. No model, no provider, no credential.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { FAMILY_ROOT } from "../lib/paths.mjs";
import { loadFamily, loadPacket } from "../lib/task.mjs";
import { materialize, runProbe, runSuite } from "../lib/fixture.mjs";

const family = loadFamily(FAMILY_ROOT);
const outDir = path.join(FAMILY_ROOT, "checks");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const summary = { schema: "next-family.checks/v2", generatedAt: new Date().toISOString(), candidates: {} };

for (const candidateId of Object.keys(family.candidates)) {
  const sha = family.candidates[candidateId];
  const short = sha.slice(0, 12);
  const packet = loadPacket(candidateId, family);
  const tree = materialize(sha, { withWorkspacePackage: candidateId === "c03" });

  const suite = runSuite(tree);
  fs.writeFileSync(path.join(outDir, `raw-${short}.txt`), suite.output);

  const probe = runProbe(tree.repo);
  fs.writeFileSync(path.join(outDir, `probe-${short}.json`), `${JSON.stringify(probe, null, 2)}\n`);

  summary.candidates[candidateId] = {
    head: sha,
    packet: { bytes: packet.bytes, sha256: packet.sha256 },
    suite: { status: suite.status, counts: suite.counts, receipt: `raw-${short}.txt` },
    probe: { receipt: `probe-${short}.json`, sha256: sha256(JSON.stringify(probe)) },
  };
  process.stdout.write(
    `${candidateId} ${short} suite=${JSON.stringify(suite.counts)} probe=${Object.keys(probe.scenarios).length} scenarios\n`,
  );
}

fs.writeFileSync(path.join(outDir, "RECEIPTS.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`receipts written to ${path.relative(FAMILY_ROOT, path.join(outDir, "RECEIPTS.json"))}\n`);
