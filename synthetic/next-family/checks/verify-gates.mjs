// Offline readiness gates for the D3-R1 batch.
//
//   node synthetic/next-family/checks/verify-gates.mjs
//
// Every gate is a real check with a real exit status; none is relaxed to pass. The
// script exits 1 if any gate fails, and prints the table the execution card and the
// closeout report quote.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { FAMILY_ROOT, RESEARCH_ROOT, SDK_LLM_DIST, proxyPath } from "../lib/paths.mjs";
import { loadFamily, loadPacket, profileDigest } from "../lib/task.mjs";
import { BATCH_MAX_USD, CRITERIA_REQUEST_MAX_USD, INPUT_BODY_BYTES, INPUT_TOKEN_CEILING, MAX_OUTPUT_TOKENS, OCR_REQUEST_MAX_USD, STAGE_PLAN } from "../lib/limits.mjs";
import { availableUsd, committedUsd, readState, totals, verifyHistorical } from "../lib/budget.mjs";
import { readIndex } from "../lib/attempt.mjs";
import { FIXTURE_REPO } from "../lib/paths.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const results = [];
const gate = (name, run) => {
  try {
    const detail = run();
    results.push({ name, ok: true, detail: detail ?? "" });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error?.message ?? error) });
  }
};

const family = loadFamily(FAMILY_ROOT);
const candidates = Object.keys(family.candidates);

gate("1. packets reproduce at their frozen digests", () => {
  const before = candidates.map((id) => loadPacket(id, family).sha256);
  execFileSync(process.execPath, [path.join(FAMILY_ROOT, "prepare.mjs"), "--all"], { encoding: "utf8" });
  const after = candidates.map((id) => loadPacket(id, family).sha256);
  if (before.join() !== after.join()) throw new Error("packet digests changed on regeneration");
  return before.map((digest) => digest.slice(0, 12)).join(" ");
});

gate("2. task statement and candidate commits match family.json", () => {
  const task = fs.readFileSync(path.join(FAMILY_ROOT, "TASK.md"));
  if (sha256(task) !== family.taskStatementSha256) throw new Error("TASK.md digest does not match family.json");
  for (const id of candidates) {
    const sha = family.candidates[id];
    execFileSync("git", ["-C", FIXTURE_REPO, "cat-file", "-e", `${sha}^{commit}`]);
    const subject = execFileSync("git", ["-C", FIXTURE_REPO, "log", "-1", "--format=%s", sha], { encoding: "utf8" }).trim();
    if (subject === "") throw new Error(`candidate ${id} has no commit`);
  }
  const heads = execFileSync("git", ["-C", FIXTURE_REPO, "branch", "--list", "candidate-*", "--format=%(objectname) %(refname:short)"], { encoding: "utf8" })
    .trim()
    .split("\n");
  return `task ${family.taskStatementSha256.slice(0, 12)}; heads ${heads.join(", ")}`;
});

gate("3. no evaluator material or role word inside a packet", () => {
  const banned = [/next-family\.oracle/i, /evaluator/i, /material_harm/i, /plausibly incomplete/i, /insufficient[- ]evidence/i, /complete control/i, /expected verdict/i];
  for (const id of candidates) {
    const packet = loadPacket(id, family);
    for (const pattern of banned) {
      if (pattern.test(packet.text)) throw new Error(`${id}: packet contains ${pattern}`);
    }
    if (!packet.text.includes("This document is the only task statement")) throw new Error(`${id}: task statement missing`);
  }
  return "role words, oracle names and verdicts absent";
});

gate("4. credential scan of tracked and working files", () => {
  // Only shapes that are actually credential material. A placeholder such as
  // `export OPENROUTER_API_KEY=...` and the deliberately synthetic sentinels used by
  // the offline tests are not matches.
  const patterns = [
    "sk-or-v1-[A-Za-z0-9]{16,}",
    "\\bsk-[A-Za-z0-9]{32,}",
    "OPENROUTER_API_KEY=[A-Za-z0-9_-]{20,}",
    "BEGIN (RSA |EC )?PRIVATE KEY",
    "Bearer [A-Za-z0-9._-]{32,}",
  ];
  const hits = [];
  for (const pattern of patterns) {
    const scan = spawnSync("git", ["-C", RESEARCH_ROOT, "grep", "-nI", "-E", pattern, "--", "."], { encoding: "utf8" });
    if (scan.status === 0 && scan.stdout.trim() !== "") hits.push(scan.stdout.trim().split("\n").slice(0, 3).join(" | "));
  }
  const untracked = execFileSync("git", ["-C", RESEARCH_ROOT, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(3).trim())
    .filter((file) => !file.includes("/repo/") && !file.endsWith(".bundle"));
  for (const file of untracked) {
    const full = path.join(RESEARCH_ROOT, file);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const pattern of patterns) if (new RegExp(pattern).test(text)) hits.push(`${file}: ${pattern}`);
  }
  if (hits.length > 0) throw new Error(`possible credential material: ${hits.join(" | ")}`);
  return `${untracked.length} new files scanned, no credential material`;
});

gate("5. historical A/B/C evidence is untouched", () => {
  const paths = ["synthetic/runs", "synthetic/inputs", "synthetic/requirements", "synthetic/metadata", "synthetic/artifacts", "synthetic/checks", "oracle", "oracle-observations-v1", "evidence-v1", "truth", "candidates", "baseline"];
  const dirty = execFileSync("git", ["-C", RESEARCH_ROOT, "status", "--porcelain", "--", ...paths], { encoding: "utf8" }).trim();
  if (dirty !== "") throw new Error(`historical paths modified: ${dirty.split("\n").slice(0, 5).join(" | ")}`);
  const reconciliation = JSON.parse(fs.readFileSync(path.join(RESEARCH_ROOT, "synthetic/runs/d12-recheck/reconciliation.json"), "utf8"));
  return `reconciliation total ${reconciliation.totals.conservativeUsd}, settled ${family.accounting.historicalSettledUsd}`;
});

gate("6. proxy resolves module-relatively and its own audit still passes", () => {
  const resolved = proxyPath();
  if (!resolved.endsWith(path.join("synthetic", "tooling", "openrouter-bounded-proxy.mjs"))) {
    throw new Error(`unexpected proxy path: ${resolved}`);
  }
  const selftest = spawnSync(process.execPath, [path.join(RESEARCH_ROOT, "synthetic/tooling/proxy-selftest.mjs")], { encoding: "utf8" });
  if (selftest.status !== 0 || !selftest.stdout.includes("RESULT: PASS")) throw new Error("proxy selftest failed");
  const audit = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", path.join(RESEARCH_ROOT, "synthetic/tooling/proxy-audit.test.mjs")],
    { encoding: "utf8" },
  );
  const passed = Number((audit.stdout.match(/ℹ pass (\d+)/u) ?? [])[1] ?? NaN);
  if (audit.status !== 0 || passed !== 20) throw new Error(`proxy audit failed (pass=${passed})`);
  return `selftest PASS, audit ${passed}/20`;
});

gate("7. every offline test file passes", () => {
  const files = ["proxy-path", "serialize", "proxy-limits", "budget", "attempt", "fixture"].map((name) =>
    path.join(FAMILY_ROOT, "tests", `${name}.test.mjs`),
  );
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-timeout=180000", ...files], {
    encoding: "utf8",
    env: (() => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      return env;
    })(),
  });
  const summary = (label) => Number((run.stdout.match(new RegExp(`ℹ ${label} (\\d+)`, "u")) ?? [])[1] ?? NaN);
  if (run.status !== 0) throw new Error(`tests failed: ${run.stdout.slice(-1200)}`);
  if (summary("fail") !== 0) throw new Error("a test reported failure");
  return `${summary("pass")} passing, ${summary("fail")} failing, ${summary("skipped")} skipped`;
});

gate("8. launcher admission works for all three candidates", () => {
  const lines = [];
  for (const id of candidates) {
    const run = spawnSync(process.execPath, [path.join(FAMILY_ROOT, "criteria-next.mjs"), id, "--dry-run"], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`${id} dry-run failed: ${run.stderr}`);
    const admission = JSON.parse(run.stdout);
    if (admission.dispatched !== false) throw new Error(`${id}: a dry run dispatched`);
    if (admission.serializedBody.bytes > INPUT_BODY_BYTES) throw new Error(`${id}: body exceeds the ceiling`);
    if (admission.duplicate !== null) throw new Error(`${id}: duplicate run key before the batch`);
    if (!admission.proxy.endsWith("openrouter-bounded-proxy.mjs")) throw new Error(`${id}: wrong proxy`);
    lines.push(`${id} ${admission.serializedBody.bytes}B ${admission.runKey.slice(0, 8)}`);
  }
  const noCreds = spawnSync(process.execPath, [path.join(FAMILY_ROOT, "criteria-next.mjs"), "c01"], {
    encoding: "utf8",
    env: (() => {
      const env = { ...process.env };
      delete env.OPENROUTER_API_KEY;
      delete env.OPENROUTER_BASE_URL;
      return env;
    })(),
  });
  if (noCreds.status !== 3 || !noCreds.stderr.includes("credentials_absent")) {
    throw new Error(`a run without a credential must refuse with exit 3, got ${noCreds.status}`);
  }
  return `${lines.join("; ")}; credential-less run refused`;
});

gate("9. budget arithmetic fits the authorization", () => {
  verifyHistorical(RESEARCH_ROOT);
  const state = totals(readState());
  if (state.newSpendUsd !== 0) throw new Error(`new-stage spend already recorded: ${state.newSpendUsd}`);
  const worstCase = Number((committedUsd() + BATCH_MAX_USD).toFixed(8));
  if (worstCase > 1) throw new Error(`batch worst case ${worstCase} exceeds 1.00`);
  if (BATCH_MAX_USD > availableUsd()) throw new Error("batch worst case exceeds the remaining envelope");
  if (readIndex().length !== 0) throw new Error("attempt ledger is not empty before the batch");
  return `4 x ${CRITERIA_REQUEST_MAX_USD} + ${STAGE_PLAN.ocrForwardedRequests} x ${OCR_REQUEST_MAX_USD} = ${BATCH_MAX_USD}; committed + batch = ${worstCase}`;
});

gate("10. frozen metadata is internally consistent", () => {
  if (family.caps.criteriaInputTokenCeiling !== INPUT_TOKEN_CEILING) throw new Error("caps drift");
  if (family.caps.criteriaMaxOutputTokens !== MAX_OUTPUT_TOKENS) throw new Error("output cap drift");
  if (!fs.existsSync(SDK_LLM_DIST)) throw new Error("pinned SDK entry missing");
  const oracle = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "evaluator", "ORACLE.json"), "utf8"));
  if (oracle.taskRevision !== family.taskRevision) throw new Error("oracle revision drift");
  for (const id of candidates) {
    if (oracle.roles[id].sha !== family.candidates[id]) throw new Error(`oracle role drift for ${id}`);
  }
  const receipts = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "checks", "RECEIPTS.json"), "utf8"));
  for (const id of candidates) {
    if (receipts.candidates[id].head !== family.candidates[id]) throw new Error(`receipt drift for ${id}`);
    if (receipts.candidates[id].suite.counts.skipped !== 0) throw new Error(`receipt has skips for ${id}`);
  }
  return `profile ${profileDigest().slice(0, 12)}; oracle and receipts agree`;
});

gate("11. M2 PR #2 repository is untouched", () => {
  const m2 = path.join(RESEARCH_ROOT, "..", "agent-teams-ai-task-verification-m2");
  const status = execFileSync("git", ["-C", m2, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (status !== "") throw new Error(`M2 working tree is dirty: ${status.split("\n").slice(0, 3).join(" | ")}`);
  const head = execFileSync("git", ["-C", m2, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return `clean at ${head.slice(0, 12)}`;
});

gate("12. the launcher has no credentialed egress outside the proxy", () => {
  const source = fs.readFileSync(path.join(FAMILY_ROOT, "criteria-next.mjs"), "utf8");
  // A credentialed metadata read is still a bypass of the bounded boundary, so the
  // check is on the whole source: one fetch, and it targets the loopback proxy.
  const foreign = (source.match(/https?:\/\/(?!127\.0\.0\.1)[^\s"'`)]+/gu) ?? []).filter(
    (url) => !url.startsWith("http://127.0.0.1"),
  );
  if (foreign.length > 0) throw new Error(`non-loopback URL in the launcher: ${foreign.join(", ")}`);
  if (!source.includes("const proxyUrl = `http://127.0.0.1:${port}/v1/responses`;")) {
    throw new Error("the loopback proxy URL is missing from the launcher");
  }
  const fetches = source.match(/\bfetch\(/gu) ?? [];
  if (fetches.length !== 1) throw new Error(`expected exactly one fetch in the launcher, found ${fetches.length}`);
  if (!source.includes("fetch(proxyUrl,")) throw new Error("the single fetch does not target the loopback proxy");
  return "one fetch, loopback only, no provider host";
});

const width = Math.max(...results.map((result) => result.name.length));
for (const result of results) {
  process.stdout.write(`${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(width)}  ${result.detail}\n`);
}
const failed = results.filter((result) => !result.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} gates passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
