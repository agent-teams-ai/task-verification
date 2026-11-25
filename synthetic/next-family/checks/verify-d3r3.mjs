// D3-R3 final verification. Model-free; no provider, no credential, no network.
//
//   node synthetic/next-family/checks/verify-d3r3.mjs
//
// Each gate reports PASS, PARTIAL or BLOCKED with the evidence it actually checked.
// A gate is never reported PASS on an assumption: where the decisive file is absent
// (the qualified OCR binary is large and is not committed) the gate says so.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FAMILY_ROOT, FIXTURE_REPO, RESEARCH_ROOT } from "../lib/paths.mjs";
import { PROFILE, profileDigest, sha256 } from "../lib/task.mjs";

const M2_ROOT = path.resolve(RESEARCH_ROOT, "..", "agent-teams-ai-task-verification-m2");
const RUNS = path.join(FAMILY_ROOT, "runs");
const ATTEMPTS = path.join(RUNS, "attempts");

const ORIGINAL_HEAD = "9367ce4e7dee40d076f654397fd535a09e2d6c3a";
const M2_HEAD = "996cdcb002f898a5b73ce8f9ce7931e6299b14e4";
const R2_REPORT_SHA = "a48b0afe5ce6e1345f93156fa2bc660e2209694aa1ed0d6a7dea0b88426939f3";
const R2_INDEX_SHA = "b06decb06d239cf1dcbfbe6e624c9f9db8d2ca4de020901ef70fde32c9732e1d";
const BINARY_SHA = "443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399";
const POLICY_SHA = "32c49219ac909d625860640baaf8dd32926b23e039301c0d33939b2bbacaaa50";
const PROFILE_PREFIX = "2a7532d7c604";

const git = (...args) => execFileSync("git", ["-C", RESEARCH_ROOT, ...args], { encoding: "utf8" }).trim();
const fixtureGit = (...args) => execFileSync("git", ["-C", FIXTURE_REPO, ...args], { encoding: "utf8" }).trim();
const fileSha = (file) => sha256(fs.readFileSync(file));

const results = [];
function gate(name, fn) {
  try {
    const { status, detail } = fn();
    results.push({ name, status, detail });
  } catch (error) {
    results.push({ name, status: "BLOCKED", detail: String(error?.message ?? error) });
  }
}

gate("1. original D3-R2 report and index are unmodified", () => {
  const report = fileSha(path.join(RUNS, "D3-R2-REPORT.md"));
  const index = fileSha(path.join(RUNS, "D3-R2-INDEX.json"));
  if (report !== R2_REPORT_SHA) throw new Error(`report digest changed: ${report}`);
  if (index !== R2_INDEX_SHA) throw new Error(`index digest changed: ${index}`);
  const dirty = git("diff", "--name-only", ORIGINAL_HEAD, "--", "synthetic/next-family/runs/D3-R2-REPORT.md", "synthetic/next-family/runs/D3-R2-INDEX.json", "synthetic/next-family/runs/attempts/att-c01-criteria-20261123T163938612Z-581a22", "synthetic/next-family/runs/attempts/att-c02-criteria-20261123T164030465Z-8577d2", "synthetic/next-family/runs/attempts/att-c03-criteria-20261123T164113224Z-6d96a7");
  if (dirty !== "") throw new Error(`original evidence modified: ${dirty}`);
  // index.jsonl may only gain lines: it is the append-only attempt index.
  const numstat = git("diff", "--numstat", ORIGINAL_HEAD, "--", "synthetic/next-family/runs/attempts/index.jsonl");
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, deleted] = line.split("\t");
    if (Number(deleted) !== 0) throw new Error(`index.jsonl lost ${deleted} line(s)`);
    if (Number(added) < 0) throw new Error(`index.jsonl diff unreadable: ${line}`);
  }
  return { status: "PASS", detail: `report ${report.slice(0, 12)}, index ${index.slice(0, 12)}, three D3-R2 attempts clean vs ${ORIGINAL_HEAD.slice(0, 7)}, index.jsonl additions only` };
});

gate("2. frozen candidates are unchanged", () => {
  const family = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "family.json"), "utf8"));
  const expected = {
    c01: "54623dccc8b138c9ad5a41fc0347cf49ba039c61",
    c02: "65f210381920fbfce032cf5ba8aaa440f3300162",
    c03: "18bbde350074d4afd8a3e3d52be31479c6ba85fc",
  };
  for (const [id, sha] of Object.entries(expected)) {
    if (family.candidates[id] !== sha) throw new Error(`${id} head drifted`);
    fixtureGit("cat-file", "-e", `${sha}^{commit}`);
  }
  const packets = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "packets", "packet-65f210381920.json"), "utf8"));
  if (packets.packet.sha256 !== "d38c0af7cc82" && !packets.packet.sha256.startsWith("d38c0af7cc82")) {
    // full digest comparison below is authoritative
  }
  const text = fs.readFileSync(path.join(FAMILY_ROOT, "packets", "packet-65f210381920.md"), "utf8");
  if (sha256(text) !== packets.packet.sha256) throw new Error("c02 packet no longer reproduces");
  return { status: "PASS", detail: `c01/c02/c03 commits present, family.json heads unchanged, c02 packet ${packets.packet.sha256.slice(0, 12)}` };
});

gate("3. derivative has a new immutable identity", () => {
  const d = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "derivatives", "c03r.json"), "utf8"));
  fixtureGit("cat-file", "-e", `${d.head}^{commit}`);
  if (d.head === d.parentHead) throw new Error("derivative did not create a new commit");
  const text = fs.readFileSync(path.join(FAMILY_ROOT, "packets", d.packet.path), "utf8");
  if (sha256(text) !== d.packet.sha256) throw new Error("derivative packet digest drifted");
  if (Buffer.byteLength(text, "utf8") !== d.packet.bytes) throw new Error("derivative packet bytes drifted");
  const parentOfHead = fixtureGit("rev-parse", `${d.head}^`).trim();
  if (parentOfHead !== d.parentHead) throw new Error(`derivative parent is ${parentOfHead}, not ${d.parentHead}`);
  return { status: "PASS", detail: `${d.head.slice(0, 12)} parent ${d.parentHead.slice(0, 12)}, packet ${d.packet.sha256.slice(0, 12)}` };
});

gate("4. OCR artifact digest matches the authorized binary", () => {
  const candidates = [
    process.env.RR_BIN,
    path.join(os.tmpdir(), "d3-ocr", "extracted", "opencodereview-linux-amd64"),
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  const record = JSON.parse(fs.readFileSync(path.join(RUNS, "d3-r3", "ocr", "preparation.json"), "utf8"));
  if (!found) {
    return {
      status: "PARTIAL",
      detail: `binary absent locally; recorded provenance ${record.comparator.artifactId} run ${record.comparator.runId} sha256 ${BINARY_SHA.slice(0, 12)} size ${record.comparator.binarySizeBytes}`,
    };
  }
  const digest = fileSha(found);
  const size = fs.statSync(found).size;
  if (digest !== BINARY_SHA) throw new Error(`binary digest ${digest} != authorized ${BINARY_SHA}`);
  if (size !== 87356967) throw new Error(`binary size ${size} != 87356967`);
  return { status: "PASS", detail: `${digest.slice(0, 12)} size ${size} (artifact ${record.comparator.artifactId}, source ${record.comparator.sourceCommit.slice(0, 7)})` };
});

gate("5. managed rule and filtering are unchanged", () => {
  const prep = JSON.parse(fs.readFileSync(path.join(RUNS, "d3-r3", "ocr", "preparation.json"), "utf8"));
  if (prep.managedPolicy.policyTextSha256 !== POLICY_SHA) throw new Error("policy wording changed");
  const frozen = JSON.parse(fs.readFileSync(path.join(RESEARCH_ROOT, "synthetic", "runs", "d12-initial-rr1", "rule.json"), "utf8"));
  const rule = JSON.parse(fs.readFileSync(path.join(RUNS, "d3-r3", "ocr", "rule-c02.json"), "utf8"));
  const frozenText = frozen.rules.find((r) => r.id === "reviewrouter-managed-v1").content;
  if (!rule.rules.every((entry) => entry.rule === frozenText)) throw new Error("rule text differs from the frozen policy");
  if (!Array.isArray(rule.reviewrouter_managed_paths) || rule.reviewrouter_managed_paths.length !== 7) throw new Error("assigned inventory changed");
  return { status: "PASS", detail: `policy ${POLICY_SHA.slice(0, 12)} byte-identical, 7 assigned paths, envelope reviewrouter_managed_paths` };
});

gate("6. inference ledgers are append-only", () => {
  const dirs = fs.readdirSync(ATTEMPTS).filter((name) => name.startsWith("att-"));
  const lines = fs.readFileSync(path.join(ATTEMPTS, "index.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  for (const dir of dirs) {
    for (const rel of ["attempt.json", "result.json", path.join("raw", "response.txt"), path.join("request", "ledger.jsonl")]) {
      const file = path.join(ATTEMPTS, dir, rel);
      if (!fs.existsSync(file)) throw new Error(`${dir}/${rel} missing`);
    }
  }
  const removed = git("log", "--diff-filter=D", "--name-only", ORIGINAL_HEAD, "--", "synthetic/next-family/runs/attempts");
  if (removed !== "") throw new Error(`evidence removed: ${removed}`);
  return { status: "PASS", detail: `${dirs.length} attempts, ${lines} index entries, no deleted record` };
});

gate("7. no budget violation", () => {
  const state = JSON.parse(fs.readFileSync(path.join(RUNS, "budget", "batch-guard.json"), "utf8"));
  const settled = state.reservations.reduce((sum, r) => sum + (r.settledUsd ?? 0), 0);
  const unresolved = state.reservations.filter((r) => r.state !== "settled").reduce((sum, r) => sum + r.maxUsd, 0);
  const committed = Math.max(state.historical.settledUsd, state.historical.conservativeUsd);
  const aggregate = committed + settled + unresolved;
  if (aggregate > state.approvedCeilingUsd) throw new Error(`aggregate ${aggregate} exceeds ${state.approvedCeilingUsd}`);
  return { status: "PASS", detail: `committed ${committed} + new ${settled.toFixed(8)} + unresolved ${unresolved} = ${aggregate.toFixed(8)} <= 1.00` };
});

gate("8. no uncontrolled retry", () => {
  const dirs = fs.readdirSync(ATTEMPTS).filter((name) => name.startsWith("att-"));
  for (const dir of dirs) {
    const result = JSON.parse(fs.readFileSync(path.join(ATTEMPTS, dir, "result.json"), "utf8"));
    if (result.execution.forwardedRequests !== 1) throw new Error(`${dir}: ${result.execution.forwardedRequests} forwarded requests`);
    if (result.execution.refusals.length !== 0) throw new Error(`${dir}: refusals ${result.execution.refusals.join(",")}`);
    if (result.execution.forwardedBodies !== 1) throw new Error(`${dir}: ${result.execution.forwardedBodies} bodies forwarded`);
  }
  return { status: "PASS", detail: `${dirs.length} attempts, exactly one forwarded request each, zero refusals` };
});

gate("9. no model or profile substitution", () => {
  const dirs = fs.readdirSync(ATTEMPTS).filter((name) => name.startsWith("att-"));
  for (const dir of dirs) {
    const result = JSON.parse(fs.readFileSync(path.join(ATTEMPTS, dir, "result.json"), "utf8"));
    if (!result.profileDigest.startsWith(PROFILE_PREFIX)) throw new Error(`${dir}: profile ${result.profileDigest}`);
    const observed = result.execution.observed;
    if (observed.length !== 1 || observed[0].model !== PROFILE.model) throw new Error(`${dir}: observed model ${JSON.stringify(observed)}`);
    if (observed[0].provider !== null && !["OpenRouter", "OpenAI"].includes(observed[0].provider)) throw new Error(`${dir}: provider ${observed[0].provider}`);
  }
  if (!profileDigest().startsWith(PROFILE_PREFIX)) throw new Error("current profile digest drifted");
  return { status: "PASS", detail: `${dirs.length} attempts at profile ${PROFILE_PREFIX}, model ${PROFILE.model}, tier ${PROFILE.serviceTier}, effort ${PROFILE.effort}; observed provider null (unverified)` };
});

gate("10. no evaluator material in reviewer inputs", () => {
  // The candidate's own head id legitimately appears in its packet; evaluator ids,
  // role words and frozen verdicts may not.
  const forbidden = [/\boracle\b/i, /insufficient-evidence/i, /plausibly-incomplete/i, /\bcomplete control\b/i, /att-c0/, /EXPECTED-c03r/];
  const files = [
    ...["54623dccc8b1", "65f210381920", "18bbde350074", "0d85551a83cb"].map((short) => path.join(FAMILY_ROOT, "packets", `packet-${short}.md`)),
    path.join(RUNS, "d3-r3", "ocr", "rule-c02.json"),
    path.join(RUNS, "d3-r3", "ocr", "background-c02.txt"),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of forbidden) if (pattern.test(text)) throw new Error(`${path.basename(file)} matches ${pattern}`);
  }
  const expected = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "derivatives", "EXPECTED-c03r.json"), "utf8"));
  const derivativePacket = fs.readFileSync(path.join(FAMILY_ROOT, "packets", "packet-0d85551a83cb.md"), "utf8");
  for (const verdict of Object.values(expected.expected)) {
    if (derivativePacket.includes(`"${verdict}"`)) throw new Error(`expected verdict "${verdict}" leaked into the derivative packet`);
  }
  return { status: "PASS", detail: `4 packets + rule + background clean; frozen expectations absent from the derivative packet` };
});

gate("11. historical A/B/C research is intact", () => {
  const dirty = git("diff", "--name-only", ORIGINAL_HEAD, "--", "synthetic/runs");
  if (dirty !== "") throw new Error(`historical evidence modified: ${dirty}`);
  const recon = JSON.parse(fs.readFileSync(path.join(RESEARCH_ROOT, "synthetic", "runs", "d12-recheck", "reconciliation.json"), "utf8"));
  const total = recon.totals?.conservativeUsd ?? recon.conservativeUsd ?? null;
  return { status: "PASS", detail: `synthetic/runs clean vs ${ORIGINAL_HEAD.slice(0, 7)}; reconciliation retained ${total ?? "see file"}` };
});

gate("12. M2 PR #2 is untouched", () => {
  const head = execFileSync("git", ["-C", M2_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", M2_ROOT, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (head !== M2_HEAD) throw new Error(`M2 HEAD is ${head}`);
  if (status !== "") throw new Error(`M2 working tree is dirty: ${status}`);
  return { status: "PASS", detail: `clean at ${head.slice(0, 12)}` };
});

gate("13. published evidence references resolve", () => {
  const report = fs.readFileSync(path.join(RUNS, "D3-R3-REPORT.md"), "utf8");
  const refs = [...report.matchAll(/`((?:synthetic|adjudication|derivatives)\/[^`]+)`/g)].map((m) => m[1]);
  const missing = refs.filter((ref) => !fs.existsSync(path.resolve(RESEARCH_ROOT, ref)));
  if (missing.length > 0) throw new Error(`unresolved: ${missing.join(", ")}`);
  return { status: "PASS", detail: `${refs.length} repository-relative references resolve` };
});

gate("14. repository state is clean after publication", () => {
  const status = git("status", "--porcelain");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (status !== "") return { status: "PARTIAL", detail: `uncommitted files present on ${branch}: ${status.split("\n").length}` };
  return { status: "PASS", detail: `clean on ${branch}` };
});

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) process.stdout.write(`${r.status.padEnd(8)}${r.name.padEnd(width + 2)}${r.detail}\n`);
const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
process.stdout.write(`\n${results.length} gates: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}\n`);
process.exit(results.some((r) => r.status === "BLOCKED") ? 1 : 0);
