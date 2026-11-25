// Prepare the ordinary-OCR comparator inputs for the original frozen c02.
//
//   node synthetic/next-family/runners/prepare-ocr.mjs
//
// Model-free. Builds the rule document in the corrected `1.14.0-rr.1` envelope
// (`reviewrouter_managed_paths` + per-path `{path, rule, merge_system_rule,
// reviewrouter_exact_path}`), the background file (the authored task statement,
// verbatim), and the loopback provider config the engine reads from `$HOME`.
//
// Nothing here contains evaluator material, criteria-assessor findings or the
// oracle. The rule wording is the frozen ReviewRouter managed policy copied
// byte-for-byte from the retained rr.1 stage; only the container shape changes,
// which is the correction the maintainer accepted in `d12-rr1-rulecheck`.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { FAMILY_ROOT, RESEARCH_ROOT } from "../lib/paths.mjs";

const OUT = path.join(FAMILY_ROOT, "runs", "d3-r3", "ocr");
fs.mkdirSync(OUT, { recursive: true });

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const family = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "family.json"), "utf8"));
const head = family.candidates.c02;
const base = family.base;

const git = (...args) =>
  execFileSync("git", ["-C", path.join(FAMILY_ROOT, "repo"), ...args], { encoding: "utf8" }).trim();

const assignedPaths = git("diff", "--name-only", base, head)
  .split("\n")
  .filter(Boolean)
  .sort();

// The frozen managed policy, byte-identical to the retained rr.1 rule document.
const frozenRulePath = path.join(RESEARCH_ROOT, "synthetic", "runs", "d12-initial-rr1", "rule.json");
const frozenRule = JSON.parse(fs.readFileSync(frozenRulePath, "utf8"));
const policy = frozenRule.rules.find((entry) => entry.id === "reviewrouter-managed-v1");
if (!policy) throw new Error("the frozen managed policy is missing from the retained rule document");
const policyText = policy.content;

const ruleDocument = {
  reviewrouter_managed_paths: assignedPaths,
  rules: assignedPaths.map((p) => ({
    path: p,
    rule: policyText,
    merge_system_rule: true,
    reviewrouter_exact_path: true,
  })),
};
const ruleText = `${JSON.stringify(ruleDocument, null, 2)}\n`;
fs.writeFileSync(path.join(OUT, "rule-c02.json"), ruleText);

// The authored requirements, verbatim. No adjudication text, no expected verdict.
const taskText = fs.readFileSync(path.join(FAMILY_ROOT, "TASK.md"), "utf8");
fs.writeFileSync(path.join(OUT, "background-c02.txt"), taskText);

const config = {
  provider: "reviewrouter",
  telemetry: { enabled: false },
  custom_providers: {
    reviewrouter: {
      protocol: "openai-responses",
      url: "http://127.0.0.1:8787",
      api_key: "Bearer loopback-proxy-no-credential",
      model: "openai/gpt-6.1-terra",
      timeout_sec: 150,
      extra_body: { service_tier: "default", reasoning: { effort: "medium" } },
    },
  },
};
const configText = `${JSON.stringify(config, null, 2)}\n`;
fs.mkdirSync(path.join(OUT, "home", ".opencodereview"), { recursive: true });
fs.writeFileSync(path.join(OUT, "home", ".opencodereview", "config.json"), configText);

const record = {
  schema: "d3-r3.ocr-preparation/v1",
  candidate: "c02",
  head,
  base,
  comparator: {
    version: "1.14.0-rr.1",
    binarySha256: "443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399",
    binarySizeBytes: 87356967,
    artifactId: 14714439075,
    runId: 44924052949,
    sourceCommit: "8a70944f567beba9ffc12d1153e33ef5fd60967d",
  },
  assignedPaths,
  managedPolicy: {
    id: policy.id,
    sourceDocument: "synthetic/runs/d12-initial-rr1/rule.json",
    policyTextSha256: sha256(policyText),
    policyTextBytes: Buffer.byteLength(policyText, "utf8"),
    wordingChanged: false,
  },
  digests: {
    ruleDocumentSha256: sha256(ruleText),
    backgroundSha256: sha256(taskText),
    configSha256: sha256(configText),
  },
  leakCheck: {
    containsRoleWords: /complete|incomplete|insufficient-evidence|oracle/i.test(ruleText),
    note: "the rule text and the authored task statement only; no evaluator ids, roles or expected verdicts",
  },
};
fs.writeFileSync(path.join(OUT, "preparation.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
