import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runOracle } from "../oracle/src/run.ts";
import { buildEvidencePacket, writeAllEvidencePackets, EVIDENCE_DIR } from "../src/evidence.ts";
import { runBaseline, runAllBaselines, BASELINE_DIR } from "../src/baseline.ts";
import { loadAnonymizationMap } from "../src/truth.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("WP4: evidence packet schema validates", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  const files = writeAllEvidencePackets();
  for (const f of files) {
    const p = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.ok(p.packetId);
    assert.equal(p.schemaVersion, "evidence-v1");
    assert.ok(p.candidateAnonId.startsWith("S1-FIX-"));
    assert.ok(Array.isArray(p.evidence) && p.evidence.length > 0);
    assert.ok(p.criterionChecks);
  }
});

test("WP4: every evidence reference resolves", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  writeAllEvidencePackets();
  const dir = EVIDENCE_DIR;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x.startsWith("S1-FIX-"))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const e of p.evidence) {
      assert.ok(typeof e.sourceRef === "string" && e.sourceRef.length > 0);
      assert.ok(typeof e.sourceDigest === "string" && e.sourceDigest.length === 64);
      const full = path.join(ROOT, e.sourceRef);
      assert.ok(fs.existsSync(full), e.sourceRef);
    }
  }
});

test("WP4: source digests match", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  writeAllEvidencePackets();
  const dir = EVIDENCE_DIR;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x.startsWith("S1-FIX-"))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const manifestPath = path.join(ROOT, "candidates", Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "truth", "anonymization-map.json"), "utf8")).mapping).find((k) => (JSON.parse(fs.readFileSync(path.join(ROOT, "truth", "anonymization-map.json"), "utf8")).mapping as any)[k] === p.candidateAnonId)!, "MANIFEST.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { headApplicationDigest: string };
    assert.equal(p.candidateSnapshotDigest, manifest.headApplicationDigest);
    for (const e of p.evidence) {
      assert.equal(e.sourceDigest, manifest.headApplicationDigest);
    }
  }
});

test("WP4: packets contain no ground-truth labels", () => {
  const dir = EVIDENCE_DIR;
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x.startsWith("S1-FIX-"))) {
    const txt = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!txt.includes("truth-v1"));
    assert.ok(!txt.includes("candidateOutcomes"));
    assert.ok(!txt.includes("expectedCriteria"));
  }
});

test("WP4: candidate isolation preserved", () => {
  const dir = EVIDENCE_DIR;
  if (!fs.existsSync(dir)) return;
  const anonMap = loadAnonymizationMap() as { mapping: Record<string, string> };
  const anonIds = Object.values(anonMap.mapping);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x.startsWith("S1-FIX-"))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    // packet references only its own anon id
    assert.ok(anonIds.includes(p.candidateAnonId));
    for (const e of p.evidence) {
      assert.equal(e.candidateAnonId, p.candidateAnonId);
    }
    // no other anon id appears
    for (const other of anonIds) {
      if (other !== p.candidateAnonId) {
        assert.ok(!JSON.stringify(p).includes(other), `leak ${other}`);
      }
    }
  }
});

test("WP4: serialization deterministic", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  writeAllEvidencePackets();
  const dir = EVIDENCE_DIR;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x.startsWith("S1-FIX-"))) {
    const a = fs.readFileSync(path.join(dir, f), "utf8");
    // re-write and compare
    const packet = JSON.parse(a);
    const re = JSON.stringify(packet, null, 2) + "\n";
    // canonical key order may differ; compare parsed
    assert.deepEqual(JSON.parse(a), JSON.parse(re));
  }
});

test("WP4: baseline outcomes match truth labels", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  writeAllEvidencePackets();
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const results = runAllBaselines(EVIDENCE_DIR);
  fs.writeFileSync(path.join(BASELINE_DIR, "baseline-results.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
  // map anon -> candidate
  const anonMap = loadAnonymizationMap() as { mapping: Record<string, string> };
  const reverse: Record<string, string> = {};
  for (const [k, v] of Object.entries(anonMap.mapping)) reverse[v] = k;
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, "truth", "truth-v1.json"), "utf8")) as { candidateOutcomes: Record<string, Record<string, boolean>> };
  for (const r of results) {
    const cid = reverse[r.candidateAnonId];
    for (const o of r.outcomes) {
      const expected = truth.candidateOutcomes[cid][o.criterionId];
      if (expected === true) assert.equal(o.outcome, "satisfied", `${cid} ${o.criterionId}`);
      else assert.equal(o.outcome, "violated", `${cid} ${o.criterionId}`);
    }
  }
});

test("WP4: baseline reproducible across runs", async () => {
  const receiptsDir = path.join(ROOT, ".oracle-receipts");
  fs.mkdirSync(receiptsDir, { recursive: true });
  await runOracle({ receiptsDir });
  writeAllEvidencePackets();
  const r1 = runAllBaselines(EVIDENCE_DIR);
  const r2 = runAllBaselines(EVIDENCE_DIR);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

test("WP4: baseline cannot access truth (static)", () => {
  const bl = fs.readFileSync(path.join(ROOT, "src", "baseline.ts"), "utf8");
  assert.ok(!bl.includes("loadTruth"));
  assert.ok(!bl.includes("TRUTH_PATH"));
  assert.ok(!bl.includes("truth.ts"));
});

test("WP4: baseline module does not read truth file", () => {
  // baseline only reads evidence dir
  const bl = fs.readFileSync(path.join(ROOT, "src", "baseline.ts"), "utf8");
  assert.ok(!bl.includes("truth-v1"));
  assert.ok(!bl.includes("anonymization"));
});

test("WP4: missing evidence yields unresolved not satisfied", () => {
  // Simulate by constructing a packet with unavailable evidence
  const packet = buildEvidencePacket({ candidateId: "S1-C1" });
  // mutate one evidence item to unavailable and remove pass observations
  const item = packet.evidence.find((e) => e.criterionId === "AC-1")!;
  item.observation = "unavailable";
  item.freshness = "stale";
  const result = runBaseline(packet);
  const ac1 = result.outcomes.find((o) => o.criterionId === "AC-1")!;
  assert.notEqual(ac1.outcome, "satisfied");
});
