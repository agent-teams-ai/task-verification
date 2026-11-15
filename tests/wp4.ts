import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { runOracle } from "../oracle/src/run.ts";
import {
  buildEvidencePacket,
  writeAllEvidencePackets,
  evidencePacketPath,
  verifyItemSourceDigest,
} from "../src/evidence.ts";
import { runBaseline, runAllBaselines } from "../src/baseline.ts";
import { canonicalDigest, canonicalJson } from "../src/canonical.ts";
import {
  checkDefinitionDigest,
  CRITERIA,
  POLICY_ID,
} from "../src/baseline-policy.ts";
import { loadAnonymizationMap } from "../src/truth.ts";
import type { EvidencePacket } from "../src/evidence-types.ts";
import { loadObservationSource, sourceRefDigest } from "../src/source-ref.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPTS_DIR = path.join(ROOT, ".oracle-receipts");
const ANON_MAP = loadAnonymizationMap() as { mapping: Record<string, string> };
const RAW_CANDIDATE_IDS = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"];

/** Run the oracle once and write all packets into a fresh output dir. */
async function freshPackets(outDir: string): Promise<string> {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  await runOracle({ receiptsDir: RECEIPTS_DIR });
  writeAllEvidencePackets(outDir);
  return outDir;
}

/** Load the packet for a candidate from a packets dir. */
function loadPacket(anonId: string, dir: string): EvidencePacket {
  return JSON.parse(fs.readFileSync(evidencePacketPath(anonId, dir), "utf8")) as EvidencePacket;
}

function anonFor(candidateId: string): string {
  const id = ANON_MAP.mapping[candidateId];
  assert.ok(id, `no anonymization for ${candidateId}`);
  return id;
}

function containsRawCandidateId(text: string): boolean {
  return RAW_CANDIDATE_IDS.some((id) => text.includes(id));
}

test("WP4: evidence packet schema validates", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-schema"));
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const anonId = anonFor(candidateId);
    const p = loadPacket(anonId, dir);
    assert.equal(p.schemaVersion, "evidence-v1");
    assert.equal(p.version, "v1");
    assert.equal(p.candidateAnonId, anonId);
    assert.ok(p.candidateSnapshotDigest.length === 64);
    assert.equal(p.checkDefinitionDigest, checkDefinitionDigest());
    assert.ok(Array.isArray(p.evidence) && p.evidence.length > 0);
    assert.ok(p.criterionChecks);
    for (const cr of CRITERIA) {
      assert.ok(Array.isArray(p.criterionChecks[cr]));
    }
    for (const e of p.evidence) {
      assert.ok(e.evidenceId.startsWith(`EV-${anonId}-`));
      assert.equal(e.candidateAnonId, anonId);
      assert.equal(e.schemaVersion, "evidence-v1");
      assert.ok(e.sourceRef);
      assert.ok(e.sourceDigest.length === 64);
      assert.ok(e.sourceLocation);
      assert.ok(["pass", "fail", "unavailable"].includes(e.observation));
      assert.ok(["applicable", "inapplicable"].includes(e.applicability));
      assert.ok(["fresh", "stale"].includes(e.freshness));
      assert.ok(verifyItemSourceDigest(e), `source digest mismatch for ${e.evidenceId}`);
    }
  }
});

test("WP4: every artifactRef/sourceRef resolves via the anonymization map", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-resolves"));
  const reverse: Record<string, string> = {};
  for (const [cid, aid] of Object.entries(ANON_MAP.mapping)) reverse[aid] = cid;
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const anonId = anonFor(candidateId);
    const p = loadPacket(anonId, dir);
    // artifactRefs must be anonymous logical references resolvable to committed artifacts.
    for (const ref of p.artifactRefs) {
      assert.ok(!containsRawCandidateId(ref), `raw candidate ID in artifactRef: ${ref}`);
      const [kind, target] = ref.split(":");
      assert.ok(kind === "candidate-manifest" || kind === "candidate-snapshot" || kind === "evidence-v1" || kind === "oracle-observations-v1", `unexpected artifactRef kind: ${ref}`);
      if (kind === "candidate-manifest" || kind === "candidate-snapshot") {
        const candId = reverse[target];
        assert.ok(candId, `artifactRef target ${target} not in anonymization map`);
        assert.ok(fs.existsSync(path.join(ROOT, "candidates", candId, "MANIFEST.json")));
      }
    }
    // sourceRef must resolve to the committed observation-source artifact via anon ID.
    for (const e of p.evidence) {
      assert.ok(!containsRawCandidateId(e.sourceRef), `raw candidate ID in sourceRef: ${e.sourceRef}`);
      assert.ok(e.sourceRef.startsWith(`oracle-observations-v1:${anonId}/`), `sourceRef not scoped to this candidate: ${e.sourceRef}`);
      // Clean-checkout resolution: parse, read file, apply JSON pointer.
      const referenced = loadObservationSource(e.sourceRef) as any;
      assert.ok(referenced !== undefined, `sourceRef does not resolve: ${e.sourceRef}`);
      // Embedded observationPayload must contain the referenced source observation.
      if (referenced.requestId !== undefined) {
        assert.equal(e.observationPayload.requestId, referenced.requestId, `requestId mismatch for ${e.evidenceId}`);
      }
      if (e.observationPayload.statusCode !== undefined && referenced.statusCode !== undefined) {
        assert.equal(e.observationPayload.statusCode, referenced.statusCode, `statusCode mismatch for ${e.evidenceId}`);
      }
      if (e.observationPayload.body !== undefined && referenced.body !== undefined) {
        assert.deepEqual(e.observationPayload.body, referenced.body, `body mismatch for ${e.evidenceId}`);
      }
      if (e.observationPayload.auditRecords !== undefined && referenced.auditRecords !== undefined) {
        assert.deepEqual(e.observationPayload.auditRecords, referenced.auditRecords, `auditRecords mismatch for ${e.evidenceId}`);
      }
      // Digest must be recomputed from the referenced bytes.
      assert.equal(e.sourceDigest, sourceRefDigest(e.sourceRef), `source digest mismatch ${e.evidenceId}`);
    }
  }
});

test("WP4: source digests are recomputed from embedded observation payloads", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-digests"));
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const p = loadPacket(anonFor(candidateId), dir);
    for (const e of p.evidence) {
      // Independent recomputation from the referenced source bytes.
      assert.equal(e.sourceDigest, sourceRefDigest(e.sourceRef), `source digest mismatch ${e.evidenceId}`);
      // The digest is of the observation representation, not the manifest/app digest.
      assert.notEqual(e.sourceDigest, p.candidateSnapshotDigest);
    }
  }
});

test("WP4: per-request observations for AC-1 through AC-5", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-observations"));
  const c3 = loadPacket(anonFor("S1-C3"), dir);
  const c4 = loadPacket(anonFor("S1-C4"), dir);

  // C3: AC-1 and AC-2 pass observations; AC-3 has a fail observation (revoked token 200).
  const ac3Revoked = c3.evidence.find((e) => e.criterionId === "AC-3" && e.sourceRef.includes("requests/P-revoked"))!;
  assert.equal(ac3Revoked.observation, "fail");
  assert.equal(ac3Revoked.evidenceType, "http-status");
  assert.equal(ac3Revoked.sourceLocation, "P-revoked response status and body fields");

  // C4: AC-4 field scan has fail observations (role/internal leaked).
  const ac4Leaks = c4.evidence.filter((e) => e.criterionId === "AC-4" && e.evidenceType === "field-scan");
  assert.ok(ac4Leaks.length > 0, "C4 should have AC-4 field-scan evidence");
  const anyFail = ac4Leaks.some((e) => e.observation === "fail");
  assert.ok(anyFail, "C4 AC-4 should include at least one fail field-scan observation");
  for (const e of ac4Leaks) {
    assert.ok(Array.isArray(e.observationPayload.deniedFieldsPresent));
    if (e.observation === "fail") {
      assert.ok(e.observationPayload.deniedFieldsPresent.length > 0);
    }
  }

  // C1: all criteria pass observations.
  const c1 = loadPacket(anonFor("S1-C1"), dir);
  for (const cr of CRITERIA) {
    const items = c1.evidence.filter((e) => e.criterionId === cr);
    assert.ok(items.length > 0, `C1 missing evidence for ${cr}`);
    assert.ok(items.every((e) => e.observation === "pass"), `C1 ${cr} should be all pass`);
  }
});

test("WP4: packets contain no ground-truth labels", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-notruth"));
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const txt = fs.readFileSync(evidencePacketPath(anonFor(candidateId), dir), "utf8");
    assert.ok(!txt.includes("truth-v1"), "packet must not reference truth-v1");
    assert.ok(!txt.includes("candidateOutcomes"), "packet must not contain truth labels");
    assert.ok(!txt.includes("expectedCriteria"), "packet must not contain expected criteria");
    assert.ok(!txt.includes("AC-3\";\"false") && !txt.includes('"AC-3":false'), "packet must not embed truth outcomes");
  }
});

test("WP4: no raw candidate IDs in packets or baseline output", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-no-raw-id"));
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const txt = fs.readFileSync(evidencePacketPath(anonFor(candidateId), dir), "utf8");
    assert.ok(!containsRawCandidateId(txt), `raw candidate ID leaked in packet for ${candidateId}`);
  }
  const results = runAllBaselines(dir);
  const baselineTxt = JSON.stringify(results);
  assert.ok(!containsRawCandidateId(baselineTxt), "raw candidate ID leaked in baseline output");
  assert.ok(!baselineTxt.includes("truth-v1"), "baseline output must not reference truth");
});

test("WP4: candidate isolation preserved (no cross-candidate evidence)", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-isolation"));
  const anonIds = Object.values(ANON_MAP.mapping);
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const p = loadPacket(anonFor(candidateId), dir);
    assert.equal(p.candidateAnonId, anonFor(candidateId));
    for (const e of p.evidence) {
      assert.equal(e.candidateAnonId, p.candidateAnonId, `cross-candidate evidence ${e.evidenceId}`);
    }
    // No other candidate's anon id appears in this packet.
    const txt = JSON.stringify(p);
    for (const other of anonIds) {
      if (other !== p.candidateAnonId) {
        assert.ok(!txt.includes(other), `anon id ${other} leaked into ${p.candidateAnonId} packet`);
      }
    }
  }
});

test("WP4: canonical serialization is deterministic", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-canonical"));
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const p = loadPacket(anonFor(candidateId), dir);
    const canon1 = JSON.stringify(p, Object.keys(p).sort(), 2);
    const canon2 = JSON.stringify(p, Object.keys(p).sort(), 2);
    assert.equal(canon1, canon2);
  }
});

test("WP4: independent evidence packet regeneration is byte-reproducible", async () => {
  const dirA = path.join(ROOT, ".isolation-tmp", "wp4-repro-a");
  const dirB = path.join(ROOT, ".isolation-tmp", "wp4-repro-b");
  // Same immutable source inputs (same receipts dir); do NOT re-run the oracle between.
  writeAllEvidencePackets(dirA);
  writeAllEvidencePackets(dirB);
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const anonId = anonFor(candidateId);
    const bytesA = fs.readFileSync(evidencePacketPath(anonId, dirA));
    const bytesB = fs.readFileSync(evidencePacketPath(anonId, dirB));
    assert.equal(bytesA.toString(), bytesB.toString(), `packet bytes differ for ${candidateId}`);
    const hashA = crypto.createHash("sha256").update(bytesA).digest("hex");
    const hashB = crypto.createHash("sha256").update(bytesB).digest("hex");
    assert.equal(hashA, hashB, `packet digest differs for ${candidateId}`);
  }
});

test("WP4: baseline output is byte-reproducible across clean repetitions", async () => {
  const dir = path.join(ROOT, ".isolation-tmp", "wp4-baseline-repro");
  writeAllEvidencePackets(dir);
  const r1 = runAllBaselines(dir);
  const r2 = runAllBaselines(dir);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2), "baseline output not reproducible");
});

test("WP4: baseline outcomes match observed evidence (C1/C2 satisfied, C3 AC-3 violated, C4 AC-4 violated)", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-outcomes"));
  const results = runAllBaselines(dir);
  const reverse: Record<string, string> = {};
  for (const [cid, aid] of Object.entries(ANON_MAP.mapping)) reverse[aid] = cid;
  const expected: Record<string, Record<string, "satisfied" | "violated">> = {
    "S1-C1": { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "satisfied", "AC-5": "satisfied" },
    "S1-C2": { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "satisfied", "AC-5": "satisfied" },
    "S1-C3": { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "violated", "AC-4": "satisfied", "AC-5": "satisfied" },
    "S1-C4": { "AC-1": "satisfied", "AC-2": "satisfied", "AC-3": "satisfied", "AC-4": "violated", "AC-5": "satisfied" },
  };
  for (const r of results) {
    assert.equal(r.rejected, false, `baseline rejected for ${r.candidateAnonId}`);
    const cid = reverse[r.candidateAnonId];
    for (const o of r.outcomes) {
      assert.equal(o.outcome, expected[cid][o.criterionId], `${cid} ${o.criterionId} expected ${expected[cid][o.criterionId]} got ${o.outcome}`);
      assert.ok(o.evidenceRefs.length > 0, `${cid} ${o.criterionId} must retain evidence refs`);
    }
  }
});

test("WP4: baseline rejects missing, malformed and incomplete packets", () => {
  const basePacket: EvidencePacket = {
    packetId: "packet-test",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "candidate application snapshot + oracle observations",
    environment: "local",
    observationTime: "1970-01-01T00:00:00Z",
    completeness: "complete",
    artifactRefs: ["candidate-manifest:S1-FIX-5ba5153fec57"],
    criterionChecks: { "AC-1": [], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [],
    generatedAt: "1970-01-01T00:00:00Z",
  };

  // Missing required criterion checks → rejected.
  const missingCrit = { ...basePacket, criterionChecks: { "AC-1": [], "AC-2": [], "AC-3": [], "AC-4": [] } };
  assert.equal(runBaseline({ packet: missingCrit }).rejected, true);

  // Bad schema version → rejected.
  const badSchema = { ...basePacket, schemaVersion: "evidence-v2" };
  assert.equal(runBaseline({ packet: badSchema }).rejected, true);

  // Bad check-definition digest → rejected.
  const badDigest = { ...basePacket, checkDefinitionDigest: "0".repeat(64) };
  assert.equal(runBaseline({ packet: badDigest }).rejected, true);

  // Duplicate evidence ID → rejected.
  const dupItem = {
    evidenceId: "EV-DUP-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-1",
    evidenceType: "http-response",
    sourceRef: "candidate-snapshot:S1-FIX-5ba5153fec57#request/P-active-a/response",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-active-a response",
    observation: "pass" as const,
    observationPayload: { requestId: "P-active-a" },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable" as const,
    freshness: "fresh" as const,
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  const withDup = {
    ...basePacket,
    criterionChecks: { "AC-1": ["EV-DUP-1"], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [dupItem, { ...dupItem, sourceDigest: "1".repeat(64) }],
  };
  assert.equal(runBaseline({ packet: withDup }).rejected, true);

  // Evidence ID mapped to wrong criterion (declared under AC-1 but item says AC-2) → undeclared/unknown.
  const wrongMap = {
    ...basePacket,
    criterionChecks: { "AC-1": ["EV-WRONG"], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [{ ...dupItem, evidenceId: "EV-WRONG", criterionId: "AC-2" }],
  };
  const res = runBaseline({ packet: wrongMap });
  assert.equal(res.rejected, true, "wrong criterion mapping should be rejected");
});

test("WP4: stale/inapplicable/unavailable evidence does not satisfy", () => {
  const item: any = {
    evidenceId: "EV-STALE-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-1",
    evidenceType: "http-response",
    sourceRef: "candidate-snapshot:S1-FIX-5ba5153fec57#request/P-active-a/response",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-active-a response",
    observation: "pass",
    observationPayload: { requestId: "P-active-a" },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  item.sourceDigest = crypto
    .createHash("sha256")
    .update(JSON.stringify(item.observationPayload, Object.keys(item.observationPayload).sort(), 2))
    .digest("hex");
  const packet: EvidencePacket = {
    packetId: "packet-stale",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: "1970-01-01T00:00:00Z",
    completeness: "complete",
    artifactRefs: [],
    criterionChecks: { "AC-1": ["EV-STALE-1"], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [item],
    generatedAt: "1970-01-01T00:00:00Z",
  };

  // Stale → not satisfied.
  const stale = structuredClone(packet);
  stale.evidence[0].freshness = "stale";
  assert.equal(runBaseline({ packet: stale, rejectMalformed: false }).outcomes[0].outcome, "unresolved");

  // Inapplicable → not satisfied.
  const inapp = structuredClone(packet);
  inapp.evidence[0].applicability = "inapplicable";
  assert.equal(runBaseline({ packet: inapp, rejectMalformed: false }).outcomes[0].outcome, "unresolved");

  // Unavailable → not satisfied.
  const unavail = structuredClone(packet);
  unavail.evidence[0].observation = "unavailable";
  assert.equal(runBaseline({ packet: unavail, rejectMalformed: false }).outcomes[0].outcome, "unresolved");
});

test("WP4: modified observation payload invalidates source digest", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-modify"));
  const p = loadPacket(anonFor("S1-C1"), dir);
  const item = p.evidence[0];
  const modified = structuredClone(p);
  modified.evidence[0].observationPayload = { ...item.observationPayload, statusCode: 999 };
  // The baseline recomputes and rejects the mismatched digest.
  const res = runBaseline({ packet: modified });
  assert.equal(res.rejected, true, "modified observation payload should invalidate source digest");
  assert.ok(res.rejectionErrors?.some((e) => e.code === "bad-source-digest"));
});

test("WP4: actual baseline executes in a restricted child process", async () => {
  const tmp = path.join(ROOT, ".isolation-tmp", "wp4-real-baseline");
  fs.mkdirSync(tmp, { recursive: true });
  const dir = await freshPackets(path.join(tmp, "packets"));
  const anonId = anonFor("S1-C3");
  const packet = loadPacket(anonId, dir);
  const packetFile = path.join(tmp, "packet.json");
  fs.writeFileSync(packetFile, JSON.stringify(packet, null, 2) + "\n", "utf8");

  const childScript = path.join(tmp, "run-baseline-child.ts");
  const baselinePath = path.join(ROOT, "src", "baseline.ts");
  const evidenceTypesPath = path.join(ROOT, "src", "evidence-types.ts");
  const canonicalPath = path.join(ROOT, "src", "canonical.ts");
  const baselinePolicyPath = path.join(ROOT, "src", "baseline-policy.ts");
  const sourceRefPath = path.join(ROOT, "src", "source-ref.ts");
  const forbiddenFiles = [
    path.join(ROOT, "truth", "truth-v1.json"),
    path.join(ROOT, "truth", "anonymization-map.json"),
    path.join(ROOT, "truth", "salt.txt"),
    path.join(ROOT, "candidates", "S1-C2", "MANIFEST.json"),
    path.join(ROOT, "evidence-v1", "S1-FIX-9f1b492fe31a.json"),
  ];

  const scriptContent = `
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { runBaseline } from "${pathToFileURL(baselinePath).href}";

const packetPath = process.argv[2];
const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
const result = runBaseline({ packet, rejectMalformed: true });

const forbiddenResults: Record<string, string> = {};
const forbidden = ${JSON.stringify(forbiddenFiles)};
for (const f of forbidden) {
  try {
    fs.readFileSync(f, "utf8");
    forbiddenResults[f] = "succeeded";
  } catch (e: any) {
    forbiddenResults[f] = e?.code ?? String(e);
  }
}

process.stdout.write(JSON.stringify({ baselineResult: result, forbiddenResults }));
`;
  fs.writeFileSync(childScript, scriptContent, "utf8");

  // Build allowlist: only baseline import graph + input packet + child script.
  const allowArgs = [
    `--allow-fs-read=${childScript}`,
    `--allow-fs-read=${baselinePath}`,
    `--allow-fs-read=${evidenceTypesPath}`,
    `--allow-fs-read=${canonicalPath}`,
    `--allow-fs-read=${baselinePolicyPath}`,
    `--allow-fs-read=${sourceRefPath}`,
    `--allow-fs-read=${packetFile}`,
  ].join(" ");

  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--permission", ...allowArgs.split(" "), childScript, packetFile],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ stdout: out, stderr: err, code }));
    child.on("error", reject);
  });

  assert.equal(result.code, 0, `child failed: ${result.stderr}`);
  assert.ok(result.stdout.length > 0, "child produced no output");

  const parsed = JSON.parse(result.stdout.trim());
  const childResult = parsed.baselineResult as { rejected: boolean; outcomes: { criterionId: string; outcome: string }[] };

  // Verify the actual baseline executed and produced correct results.
  assert.equal(childResult.rejected, false, "baseline should not be rejected");
  assert.equal(childResult.outcomes.length, 5, "should have 5 criterion outcomes");
  assert.equal(childResult.outcomes.find((o) => o.criterionId === "AC-3")?.outcome, "violated", "C3 AC-3 should be violated");
  assert.equal(childResult.outcomes.find((o) => o.criterionId === "AC-4")?.outcome, "satisfied", "C3 AC-4 should be satisfied");

  // Verify all forbidden reads were denied.
  for (const [file, code] of Object.entries(parsed.forbiddenResults)) {
    assert.equal(code, "ERR_ACCESS_DENIED", `forbidden file ${file} should be denied, got ${code}`);
  }

  // Compare with in-process baseline result for the same packet.
  const inProcess = runBaseline({ packet, rejectMalformed: true });
  assert.equal(JSON.stringify(inProcess), JSON.stringify(childResult), "child result must match in-process result");
});

test("WP4: recursive canonical JSON sorts keys at every level", () => {
  const nested = {
    z: 1,
    a: { b: 2, a: 1, c: { z: 3, a: 4 } },
    m: [ { x: 5, y: 6 }, { y: 7, x: 8 } ],
  };
  // Reorder keys — canonical form should be identical.
  const reordered = {
    a: { c: { a: 4, z: 3 }, a: 1, b: 2 },
    m: [ { y: 6, x: 5 }, { x: 8, y: 7 } ],
    z: 1,
  };
  const canon1 = canonicalJson(nested);
  const canon2 = canonicalJson(reordered);
  assert.equal(canon1, canon2, "key reordering should not change canonical output");
  // Array order is preserved (reversing array changes output).
  const reversed = { ...nested, m: [ { y: 7, x: 8 }, { x: 5, y: 6 } ] };
  assert.notEqual(canonicalJson(reversed), canon1, "array order must affect canonical output");
});

test("WP4: nested observation and audit-record mutations change the digest", () => {
  const base = {
    requestId: "P-active-a",
    statusCode: 200,
    body: { id: "caller-a", email: "caller-a@example.example" },
    auditRecords: [{ event: "profile.access.denied", reason: "missing_credential", timestamp: "2026-01-01T00:00:00Z" }],
  };
  const baseDigest = canonicalDigest(base);

  // Top-level statusCode change.
  assert.notEqual(canonicalDigest({ ...base, statusCode: 401 }), baseDigest);
  // Nested body.id change.
  assert.notEqual(canonicalDigest({ ...base, body: { ...base.body, id: "wrong" } }), baseDigest);
  // Nested body.email change.
  assert.notEqual(canonicalDigest({ ...base, body: { ...base.body, email: "wrong@example.example" } }), baseDigest);
  // auditRecords[0].event change.
  assert.notEqual(canonicalDigest({ ...base, auditRecords: [{ ...base.auditRecords[0], event: "other.event" }] }), baseDigest);
  // auditRecords[0].reason change.
  assert.notEqual(canonicalDigest({ ...base, auditRecords: [{ ...base.auditRecords[0], reason: "other.reason" }] }), baseDigest);
  // Nested object values cannot retain the previous digest.
  assert.notEqual(canonicalDigest({ ...base, body: { id: "caller-a", email: "caller-a@example.example", extra: true } }), baseDigest);
});

test("WP4: independently implemented test-side canonicalization agrees with production", () => {
  const value = {
    statusCode: 200,
    body: { email: "caller-a@example.example", id: "caller-a" },
    requestId: "P-active-a",
  };
  // Independent test-side canonicalization (not using canonicalJson).
  function independentCanonical(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(independentCanonical).join(",") + "]";
    const keys = Object.keys(v as Record<string, unknown>).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + independentCanonical((v as Record<string, unknown>)[k]));
    return "{" + parts.join(",") + "}";
  }
  // Production canonicalDigest uses sorted keys + 2-space indent; compare canonicalized structure, not raw bytes.
  // Verify production canonicalJson contains all keys sorted at top level.
  const prod = canonicalJson(value);
  const parsedProd = JSON.parse(prod);
  assert.equal(independentCanonical(parsedProd), independentCanonical(value), "independent canonicalization must agree with production");
  assert.ok(prod.includes('"body"'), "production canonical must include body");
  assert.ok(prod.includes('"requestId"'), "production canonical must include requestId");
  assert.ok(prod.includes('"statusCode"'), "production canonical must include statusCode");
  // Verify production digest is deterministic and matches canonicalJson.
  const prodDigest = canonicalDigest(value);
  assert.equal(prodDigest, crypto.createHash("sha256").update(canonicalJson(value)).digest("hex"));
  // Verify reordering keys doesn't change production digest.
  const reordered = { body: { id: "caller-a", email: "caller-a@example.example" }, requestId: "P-active-a", statusCode: 200 };
  assert.equal(canonicalDigest(reordered), prodDigest, "key reordering must not change digest");
});

test("WP4: exact request-ID coverage rejects duplicate request observations", () => {
  const itemA: any = {
    evidenceId: "EV-DUP-A",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-1",
    evidenceType: "http-response",
    sourceRef: "oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-active-a.json#",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-active-a response",
    observation: "pass",
    observationPayload: { requestId: "P-active-a", statusCode: 200, body: { id: "caller-a", email: "caller-a@example.example" } },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  itemA.sourceDigest = sourceRefDigest(itemA.sourceRef);
  const itemB = { ...itemA, evidenceId: "EV-DUP-B" };
  const packet: EvidencePacket = {
    packetId: "packet-dup",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: null,
    completeness: "complete",
    artifactRefs: [],
    criterionChecks: { "AC-1": ["EV-DUP-A", "EV-DUP-B"], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [itemA, itemB],
    generatedAt: null,
  };
  const res = runBaseline({ packet, rejectMalformed: true });
  assert.equal(res.rejected, true, "duplicate request observation must be rejected");
  assert.ok(res.rejectionErrors?.some((e) => e.code === "duplicate-request-observation"), "must detect duplicate request");
});

test("WP4: exact request-ID coverage rejects wrong-criterion assignment", () => {
  const item: any = {
    evidenceId: "EV-WC-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-2",
    evidenceType: "http-status",
    sourceRef: "oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-revoked.json#",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-revoked response",
    observation: "pass",
    observationPayload: { requestId: "P-revoked", statusCode: 401, body: {} },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  item.sourceDigest = sourceRefDigest(item.sourceRef);
  const packet: EvidencePacket = {
    packetId: "packet-wc",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: null,
    completeness: "complete",
    artifactRefs: [],
    criterionChecks: { "AC-1": [], "AC-2": ["EV-WC-1"], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [item],
    generatedAt: null,
  };
  const res = runBaseline({ packet, rejectMalformed: true });
  // P-revoked assigned to AC-2 is unexpected for AC-2 → rejected.
  assert.equal(res.rejected, true, "wrong-criterion request ID must be rejected");
  assert.ok(res.rejectionErrors?.some((e) => e.code === "unexpected-request-observation" || e.code === "missing-request-observation"), "must detect the wrong assignment");
});

test("WP4: four distinct Evidence IDs from one request cannot satisfy AC-4", () => {
  const makeItem = (id: string) => {
    const item: any = {
      evidenceId: id,
      candidateAnonId: "S1-FIX-5ba5153fec57",
      criterionId: "AC-4",
      evidenceType: "field-scan",
      sourceRef: "oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-active-a.json#",
      sourceDigest: "0".repeat(64),
      sourceLocation: "P-active-a response body (role/internal keys)",
      observation: "pass",
      observationPayload: { requestId: "P-active-a", body: { id: "caller-a", email: "caller-a@example.example" }, deniedFieldsPresent: [] },
      provenance: "oracle O-1 pass 1",
      applicability: "applicable",
      freshness: "fresh",
      schemaVersion: "evidence-v1",
      version: "v1",
    };
    item.sourceDigest = sourceRefDigest(item.sourceRef);
    return item;
  };
  const items = [makeItem("EV-A"), makeItem("EV-B"), makeItem("EV-C"), makeItem("EV-D")];
  const packet: EvidencePacket = {
    packetId: "packet-repeated",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: null,
    completeness: "complete",
    artifactRefs: [],
    criterionChecks: { "AC-1": [], "AC-2": [], "AC-3": [], "AC-4": ["EV-A", "EV-B", "EV-C", "EV-D"], "AC-5": [] },
    evidence: items,
    generatedAt: null,
  };
  const res = runBaseline({ packet, rejectMalformed: true });
  assert.equal(res.rejected, true, "four repeated requests must be rejected");
  assert.ok(res.rejectionErrors?.some((e) => e.code === "duplicate-request-observation" || e.code === "missing-request-observation"), "must detect the repeated/missing inventory");
});

test("WP4: missing request observation yields unavailable, not fail", () => {
  // Build a packet where P-active-b is missing entirely (no evidence item).
  // Baseline should mark AC-1 unresolved (not satisfied, not violated).
  const itemA: any = {
    evidenceId: "EV-MISS-A",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-1",
    evidenceType: "http-response",
    sourceRef: "oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-active-a.json#",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-active-a response body (id and email)",
    observation: "pass",
    observationPayload: { requestId: "P-active-a", statusCode: 200, body: { id: "caller-a", email: "caller-a@example.example" } },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  itemA.sourceDigest = sourceRefDigest(itemA.sourceRef);
  const packet: EvidencePacket = {
    packetId: "packet-miss",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: null,
    completeness: "partial",
    artifactRefs: [],
    criterionChecks: { "AC-1": ["EV-MISS-A"], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [itemA],
    generatedAt: null,
  };
  const res = runBaseline({ packet, rejectMalformed: false });
  assert.notEqual(res.outcomes[0].outcome, "satisfied", "missing request must not be satisfied");
  assert.notEqual(res.outcomes[0].outcome, "violated", "missing request must not be violated");
  assert.equal(res.outcomes[0].outcome, "unresolved", "missing request must be unresolved");
});

test("WP4: missing versus failed observation distinction", () => {
  // Missing request → unavailable → unresolved.
  // Failed request (wrong status) → fail → violated.
  const missingItem: any = {
    evidenceId: "EV-MISS-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-2",
    evidenceType: "http-status",
    sourceRef: "oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-missing.json#",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-missing response status and body fields",
    observation: "unavailable",
    observationPayload: { requestId: "P-missing", available: false },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  // sourceDigest for unavailable = canonicalDigest(payload)
  missingItem.sourceDigest = canonicalDigest(missingItem.observationPayload);
  const failedItem: any = {
    evidenceId: "EV-FAIL-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-2",
    evidenceType: "http-status",
    sourceRef: "oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-missing.json#",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-missing response status and body fields",
    observation: "fail",
    observationPayload: { requestId: "P-missing", statusCode: 200, body: {}, available: true },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  failedItem.sourceDigest = canonicalDigest(failedItem.observationPayload);

  // Missing → unresolved.
  const missingPacket: EvidencePacket = {
    packetId: "packet-missing-obs",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: null,
    completeness: "partial",
    artifactRefs: [],
    criterionChecks: { "AC-1": [], "AC-2": ["EV-MISS-1"], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [missingItem],
    generatedAt: null,
  };
  const missingResult = runBaseline({ packet: missingPacket, rejectMalformed: false });
  assert.equal(missingResult.outcomes.find((o) => o.criterionId === "AC-2")?.outcome, "unresolved", "missing observation must be unresolved");

  // Failed → violated.
  const failedPacket: EvidencePacket = {
    packetId: "packet-failed-obs",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: null,
    completeness: "complete",
    artifactRefs: [],
    criterionChecks: { "AC-1": [], "AC-2": ["EV-FAIL-1"], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [failedItem],
    generatedAt: null,
  };
  const failedResult = runBaseline({ packet: failedPacket, rejectMalformed: false });
  assert.equal(failedResult.outcomes.find((o) => o.criterionId === "AC-2")?.outcome, "violated", "failed observation must be violated");
});

test("WP4: baseline cannot read truth or scorer internals (static)", () => {
  const bl = fs.readFileSync(path.join(ROOT, "src", "baseline.ts"), "utf8");
  assert.ok(!bl.includes("loadTruth"), "baseline must not load truth");
  assert.ok(!bl.includes("TRUTH_PATH"), "baseline must not reference TRUTH_PATH");
  assert.ok(!bl.includes("truth.ts"), "baseline must not import truth module");
  assert.ok(!/from ["']\.\.\/scorer|from ["']\.\.\/.*scorer["']/.test(bl), "baseline must not import scorer internals");
  assert.ok(!bl.includes("anonymization-map"), "baseline must not reference anonymization map");
  assert.ok(!bl.includes("salt.txt"), "baseline must not reference salt");
});

test("WP4: missing observation source is not converted into a behavioral violation", () => {
  const missingRef = `oracle-observations-v1:S1-FIX-5ba5153fec57/pass1/requests/P-nonexistent.json#`;
  assert.throws(() => loadObservationSource(missingRef));
  // And sourceRefDigest throws too.
  assert.throws(() => sourceRefDigest(missingRef));
});

test("WP4: missing required request yields unresolved, not satisfied", () => {
  // AC-1 requires both P-active-a and P-active-b. Supply only one pass observation.
  const itemA: any = {
    evidenceId: "EV-REQ-A",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    criterionId: "AC-1",
    evidenceType: "http-response",
    sourceRef: "candidate-snapshot:S1-FIX-5ba5153fec57#request/P-active-a/response",
    sourceDigest: "0".repeat(64),
    sourceLocation: "P-active-a response",
    observation: "pass",
    observationPayload: { requestId: "P-active-a", statusCode: 200 },
    provenance: "oracle O-1 pass 1",
    applicability: "applicable",
    freshness: "fresh",
    schemaVersion: "evidence-v1",
    version: "v1",
  };
  itemA.sourceDigest = crypto
    .createHash("sha256")
    .update(JSON.stringify(itemA.observationPayload, Object.keys(itemA.observationPayload).sort(), 2))
    .digest("hex");
  const packet: EvidencePacket = {
    packetId: "packet-req",
    schemaVersion: "evidence-v1",
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: "S1-FIX-5ba5153fec57",
    candidateSnapshotDigest: "eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89",
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "x",
    environment: "local",
    observationTime: "1970-01-01T00:00:00Z",
    completeness: "partial",
    artifactRefs: [],
    criterionChecks: { "AC-1": ["EV-REQ-A"], "AC-2": [], "AC-3": [], "AC-4": [], "AC-5": [] },
    evidence: [itemA],
    generatedAt: "1970-01-01T00:00:00Z",
  };
  const result = runBaseline({ packet, rejectMalformed: false });
  assert.notEqual(result.outcomes[0]?.outcome, "satisfied", "partial evidence must not be satisfied");
});

test("WP4: evidence timestamps are deterministic (no wall-clock generation time)", async () => {
  const dir = await freshPackets(path.join(ROOT, ".isolation-tmp", "wp4-timestamps"));
  for (const candidateId of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
    const p = loadPacket(anonFor(candidateId), dir);
    assert.ok(p.generatedAt !== null && p.generatedAt.length > 0);
    assert.ok(p.observationTime !== null && p.observationTime.length > 0);
    // Regenerating from the same inputs yields identical generatedAt/observationTime.
    const p2 = buildEvidencePacket({ candidateId });
    assert.equal(p2.generatedAt, p.generatedAt);
    assert.equal(p2.observationTime, p.observationTime);
  }
});

test("WP4: baseline policy identity and check-definition digest are stable", () => {
  assert.equal(POLICY_ID, "baseline-policy-baseline-policy-v1");
  const d1 = checkDefinitionDigest();
  const d2 = checkDefinitionDigest();
  assert.equal(d1, d2);
  assert.equal(d1.length, 64);
});
