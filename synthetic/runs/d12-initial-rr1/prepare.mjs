// Prepares the frozen live-OCR inputs for the D1/D2 initial stage.
// No provider is contacted and no credential is read.
//
// The rule document is reproduced by the approved builder's own code path:
// buildOcrControlledRuleText({ language, assignedPaths }) is
//   { merge_system_rule: true, include: [...assignedPaths].sort(),
//     rules: [{ id: 'reviewrouter-managed-v1', content: <5 lines> }] }
// serialized with JSON.stringify(..., null, 2) plus a trailing newline.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: prepare.mjs <run-dir>");
  process.exit(2);
}
const syn = path.resolve(runDir, "../../..");
const repo = path.join(syn, "synthetic", "repo");
const BASE = "ce99b0d65d645124413a746ecb137b5497aad80f";
const HEAD = "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9";
const PROXY_PORT = 8787;
const MODEL = "openai/gpt-6.1-terra";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const read = (...p) => fs.readFileSync(path.join(syn, ...p), "utf8");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });

// Frozen material, re-verified against the recorded digests.
const requirements = read("synthetic", "requirements", "RECORD-API-v1.md");
const pr = JSON.parse(read("synthetic", "metadata", "pr.json"));
const expected = {
  requirements: "ca868a3fcc2a9100eabda736c48a8e107125a1f5a8477eede3665be96bde727f",
  pr: "9b48eb1b7c31af0becbe5d49a0fd507cbd450f222d4ce4a5c04120be610c1bcf",
};
if (sha256(requirements) !== expected.requirements) throw new Error("requirements digest changed");
if (sha256(read("synthetic", "metadata", "pr.json")) !== expected.pr) throw new Error("pr.json digest changed");
if (git("rev-parse", "HEAD").trim() !== HEAD) throw new Error("fixture HEAD is not Candidate A");
if (git("cat-file", "-t", "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9").trim() !== "commit") throw new Error("Candidate A absent");
try {
  git("cat-file", "-t", "candidate-b");
  throw new Error("Candidate B exists");
} catch (err) {
  if (String(err).includes("Candidate B exists")) throw err;
}

// ---- rule document -------------------------------------------------------
const assignedPaths = pr.changedPaths.map((c) => c.path);
const language = null; // unset -> repository language, the builder's default branch
const ruleLines = [
  "ReviewRouter managed additive policy (reviewrouter-managed-v1).",
  "Report only issues material to this change: introduced or aggravated by the base-to-head diff.",
  "For every finding describe the causal base-to-head change that creates or worsens the issue.",
  "Allowed finding scope is the reviewed changed paths assigned to this run.",
  language !== null
    ? `Write finding titles and messages in ${language}.`
    : "Write finding titles and messages in the repository language.",
].join("\n");
const ruleText = `${JSON.stringify(
  {
    merge_system_rule: true,
    include: [...assignedPaths].sort(),
    rules: [{ id: "reviewrouter-managed-v1", content: ruleLines }],
  },
  null,
  2,
)}\n`;

// ---- background text (<= 8000 chars) -------------------------------------
const background = [
  `# Pull request\n\nTitle: ${pr.title}\n\n${pr.body}`,
  `# Commit identity\n\nbase ${BASE}\nhead ${HEAD}\nrefs ${pr.baseRef}..${pr.headRef}`,
  `# Frozen requirements (record-api-req-v1)\n\n${requirements}`,
].join("\n\n");
const OCR_BACKGROUND_HARD_CHAR_LIMIT = 8000;
if (background.length > OCR_BACKGROUND_HARD_CHAR_LIMIT) {
  throw new Error(`background is ${background.length} chars, above the 8000 limit`);
}

// ---- managed provider config: loopback only, no credential ---------------
const config = {
  provider: "reviewrouter",
  telemetry: { enabled: false },
  custom_providers: {
    reviewrouter: {
      protocol: "openai-responses",
      url: `http://127.0.0.1:${PROXY_PORT}`,
      // Not a provider credential: the loopback proxy authenticates upstream
      // itself and ignores inbound authorization.
      api_key: "Bearer loopback-proxy-no-credential",
      model: MODEL,
      timeout_sec: 150,
      // Managed mode allows only these two extra_body keys; the proxy injects
      // the approved per-request output ceiling (4000) when it is absent.
      extra_body: { service_tier: "default", reasoning: { effort: "medium" } },
    },
  },
};

fs.mkdirSync(path.join(runDir, "home", ".opencodereview"), { recursive: true });
fs.writeFileSync(path.join(runDir, "home", ".opencodereview", "config.json"), JSON.stringify(config, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "rule.json"), ruleText);
fs.writeFileSync(path.join(runDir, "background.txt"), background);

const prep = {
  schema: "d12.ocr-inputs/v1",
  preparedAt: new Date().toISOString(),
  fixture: { base: BASE, candidateA: HEAD, candidateB: "absent", repoHead: git("rev-parse", "HEAD").trim() },
  frozen: {
    requirementsSha256: sha256(requirements),
    prJsonSha256: expected.pr,
    completedPaths: pr.changedPaths.map((c) => c.path),
  },
  ocr: {
    binary: "opencodereview-linux-amd64",
    ruleId: "reviewrouter-managed-v1",
    ruleSha256: sha256(ruleText),
    ruleBytes: Buffer.byteLength(ruleText, "utf8"),
    includePaths: [...assignedPaths].sort(),
    languageSetting: language,
    backgroundSha256: sha256(background),
    backgroundChars: background.length,
    model: MODEL,
    protocol: "openai-responses",
    serviceTier: "default",
    reasoningEffort: "medium",
    filtering: "unchanged (no --no-filter)",
    proxyPort: PROXY_PORT,
    configSha256: sha256(JSON.stringify(config, null, 2) + "\n"),
  },
};
fs.writeFileSync(path.join(runDir, "prepared-inputs.json"), JSON.stringify(prep, null, 2) + "\n");
console.log(JSON.stringify(prep, null, 2));
