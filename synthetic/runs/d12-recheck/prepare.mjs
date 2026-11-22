// Prepares the corrected-development-regression stage inputs.
//
// Two things differ from the frozen rr.1 stage, and only two:
//   1. the rule document uses the qualified native parser's contract
//      (`reviewrouter_managed_paths` + `rules[].path`/`rules[].rule`), because the
//      frozen document's `rules[].id`/`rules[].content` keys were ignored and its
//      `include` was a force-include, so the policy text never reached the model;
//   2. the budget arithmetic prices input at the dearest observed rate (cache
//      write, USD 1.25/M) and holds two OCR stages plus one criteria stage inside
//      the remaining balance.
//
// The five policy lines, the background template, the managed config, the model,
// the reasoning effort, the service tier and the filtering policy are unchanged.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const runDir = path.resolve(process.argv[2] ?? path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const syn = path.resolve(runDir, "../..");
const repo = path.join(syn, "repo");
const BASE = "ce99b0d65d645124413a746ecb137b5497aad80f";
const CANDIDATE_A = "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9";
const PROXY_PORT = 8787;
const MODEL = "openai/gpt-6.1-terra";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const read = (...p) => fs.readFileSync(path.join(syn, ...p), "utf8");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });

const requirements = read("requirements", "RECORD-API-v1.md");
const pr = JSON.parse(read("metadata", "pr.json"));
if (sha256(requirements) !== "ca868a3fcc2a9100eabda736c48a8e107125a1f5a8477eede3665be96bde727f") {
  throw new Error("requirements digest changed");
}
if (sha256(read("metadata", "pr.json")) !== "9b48eb1b7c31af0becbe5d49a0fd507cbd450f222d4ce4a5c04120be610c1bcf") {
  throw new Error("pr.json digest changed");
}
if (git("cat-file", "-t", CANDIDATE_A).trim() !== "commit") throw new Error("Candidate A absent");
const candidateB = git("rev-parse", "HEAD").trim();
if (git("status", "--porcelain").trim() !== "") throw new Error("fixture worktree is not clean");

// ---- rule document: the frozen policy text in the parser's own shape --------
const frozenRule = JSON.parse(fs.readFileSync(path.join(syn, "runs", "d12-initial-rr1", "rule.json"), "utf8"));
if (sha256(fs.readFileSync(path.join(syn, "runs", "d12-initial-rr1", "rule.json"))) !==
    "b3fd4702808db2f21f49fa8c4f8c9527f520d8c9f72e42af7d57ea26716acd0c") {
  throw new Error("frozen rr.1 rule document changed");
}
const policyText = frozenRule.rules[0].content;
const assignedPaths = pr.changedPaths.map((c) => c.path).sort();
const ruleText = `${JSON.stringify(
  {
    reviewrouter_managed_paths: assignedPaths,
    rules: assignedPaths.map((p) => ({
      path: p,
      rule: policyText,
      merge_system_rule: true,
      reviewrouter_exact_path: true,
    })),
  },
  null,
  2,
)}\n`;
if (sha256(ruleText) !== "b3f14056c29c3587b03be3880abc063caec6d1e12f4a2f4964c5e8b6e4a6b0a5") {
  throw new Error("corrected rule document is not the verified one");
}
fs.writeFileSync(path.join(runDir, "rule-corrected.json"), ruleText);

// ---- background: identical template, head identity of the reviewed candidate -
function background(head) {
  return [
    `# Pull request\n\nTitle: ${pr.title}\n\n${pr.body}`,
    `# Commit identity\n\nbase ${BASE}\nhead ${head}\nrefs ${pr.baseRef}..${pr.headRef}`,
    `# Frozen requirements (record-api-req-v1)\n\n${requirements}`,
  ].join("\n\n");
}
const backgroundA = background(CANDIDATE_A);
const backgroundB = background(candidateB);
if (sha256(backgroundA) !== "8a8a62ff9a99bb6daab25a1bbf86a86a1e3264d387ce8bc4195c7b9056702e7a") {
  throw new Error("Candidate A background is not byte-identical to the frozen stage");
}
for (const [label, text] of [["A", backgroundA], ["B", backgroundB]]) {
  if (text.length > 8000) throw new Error(`background ${label} is ${text.length} chars, above the 8000 limit`);
  fs.writeFileSync(path.join(runDir, `background-${label}.txt`), text);
}

// ---- managed provider config: loopback only, no credential -----------------
const config = {
  provider: "reviewrouter",
  telemetry: { enabled: false },
  custom_providers: {
    reviewrouter: {
      protocol: "openai-responses",
      url: `http://127.0.0.1:${PROXY_PORT}`,
      api_key: "Bearer loopback-proxy-no-credential",
      model: MODEL,
      timeout_sec: 150,
      extra_body: { service_tier: "default", reasoning: { effort: "medium" } },
    },
  },
};
const configText = `${JSON.stringify(config, null, 2)}\n`;
if (sha256(configText) !== "2f1ef31e5ad9ce5ff5ce139aea20517ca223120c64fc0cbbf1c91382353ff2bf") {
  throw new Error("managed config is not the frozen one");
}
fs.mkdirSync(path.join(runDir, "home", ".opencodereview"), { recursive: true });
fs.writeFileSync(path.join(runDir, "home", ".opencodereview", "config.json"), configText);

// ---- budget arithmetic (conservative) --------------------------------------
const INPUT_USD_PER_TOKEN = 1.25 / 1e6; // dearest observed input rate: prompt-cache write
const OUTPUT_USD_PER_TOKEN = 5.0 / 1e6;
const stage = (i, o) => i * INPUT_USD_PER_TOKEN + o * OUTPUT_USD_PER_TOKEN;
const OCR = { maxInputTokens: 180_000, maxOutputTokens: 24_000 };
const CRITERIA = { maxInputTokens: 20_000, maxOutputTokens: 4_000 };
const SPENT_USD = 0.09085455;
const REMAINING_USD = Number((1.0 - SPENT_USD).toFixed(8));

const record = {
  schema: "d12.corrected-stage/v1",
  generatedAt: new Date().toISOString(),
  changeFromFrozenStage: [
    "rule document now uses reviewrouter_managed_paths + rules[].path/rule with merge_system_rule and reviewrouter_exact_path",
    "OCR stage caps reduced to 180,000 input / 24,000 output tokens so two OCR stages plus the criteria stage fit the remaining budget at conservative prices",
  ],
  unchanged: {
    policyTextSha256: sha256(policyText),
    policyTextBytes: Buffer.byteLength(policyText, "utf8"),
    assignedPaths,
    backgroundTemplate: "identical; only the head identity differs for Candidate B",
    backgroundASha256: sha256(backgroundA),
    backgroundBSha256: sha256(backgroundB),
    managedConfigSha256: sha256(configText),
    requirementsSha256: sha256(requirements),
    model: MODEL,
    reasoningEffort: "medium",
    serviceTier: "default",
    filtering: "unchanged (no --no-filter)",
    requestByteCeiling: 65_536,
    requestOutputCeiling: 4_000,
  },
  candidates: { base: BASE, candidateA: CANDIDATE_A, candidateB },
  budget: {
    ceilingUsd: 1.0,
    spentUsd: SPENT_USD,
    remainingUsd: REMAINING_USD,
    prices: { inputUncachedPerM: 1.0, inputCacheWritePerM: 1.25, inputCacheReadPerM: 0.05, outputPerM: 5.0 },
    reservationPricePerInputToken: INPUT_USD_PER_TOKEN,
    reservationPricePerOutputToken: OUTPUT_USD_PER_TOKEN,
    perRequestReservationUsd: Number(stage(65_536, 4_000).toFixed(8)),
    ocrStageWorstCaseUsd: Number(stage(OCR.maxInputTokens, OCR.maxOutputTokens).toFixed(8)),
    criteriaStageWorstCaseUsd: Number(stage(CRITERIA.maxInputTokens, CRITERIA.maxOutputTokens).toFixed(8)),
    plannedTotalUsd: Number((stage(OCR.maxInputTokens, OCR.maxOutputTokens) * 2 + stage(CRITERIA.maxInputTokens, CRITERIA.maxOutputTokens)).toFixed(8)),
    fits: stage(OCR.maxInputTokens, OCR.maxOutputTokens) * 2 + stage(CRITERIA.maxInputTokens, CRITERIA.maxOutputTokens) <= REMAINING_USD,
    ocrCaps: OCR,
    criteriaCaps: CRITERIA,
  },
};
if (!record.budget.fits) throw new Error("the complete recheck plan does not fit the remaining budget");
fs.writeFileSync(path.join(runDir, "prepared-stage.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
