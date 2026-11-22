// Emits the loopback managed config and the parser-corrected rule document for
// the rule-delivery probe. The five policy lines are byte-identical to the
// frozen rr.1 rule document; only the container shape changes, because the
// qualified 1.14.0-rr.1 native parser reads `rules[].path` + `rules[].rule`
// (internal/config/rules/system_rules.go ProjectRuleEntry) and enforces the
// admission inventory through `reviewrouter_managed_paths`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const syn = path.resolve(dir, "../../..");
const pr = JSON.parse(fs.readFileSync(path.join(syn, "synthetic", "metadata", "pr.json"), "utf8"));
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

const assignedPaths = pr.changedPaths.map((c) => c.path).sort();

// The frozen policy text, copied verbatim from the original rule document.
const original = JSON.parse(fs.readFileSync(path.join(dir, "rule-original.json"), "utf8"));
const ruleText = original.rules[0].content;
if (!original.rules[0].id.includes("reviewrouter-managed-v1")) throw new Error("unexpected original rule id");

const corrected = {
  reviewrouter_managed_paths: assignedPaths,
  rules: assignedPaths.map((p) => ({
    path: p,
    rule: ruleText,
    merge_system_rule: true,
    reviewrouter_exact_path: true,
  })),
};
const correctedText = `${JSON.stringify(corrected, null, 2)}\n`;

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

fs.mkdirSync(path.join(dir, "home", ".opencodereview"), { recursive: true });
fs.writeFileSync(path.join(dir, "home", ".opencodereview", "config.json"), JSON.stringify(config, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "rule-corrected.json"), correctedText);

const record = {
  schema: "d12.rule-delivery/v1",
  derivedFrom: "synthetic/runs/d12-initial-rr1/rule.json",
  originalRuleSha256: sha256(fs.readFileSync(path.join(dir, "rule-original.json"))),
  correctedRuleSha256: sha256(correctedText),
  policyTextSha256: sha256(ruleText),
  policyTextBytes: Buffer.byteLength(ruleText, "utf8"),
  assignedPaths,
  originalShape: {
    documentKeys: Object.keys(original),
    entryKeys: Object.keys(original.rules[0]),
    nativeEntryTagsAvailable: ["path", "rule", "merge_system_rule", "reviewrouter_exact_path"],
  },
  correctedShape: {
    documentKeys: Object.keys(corrected),
    entryKeys: Object.keys(corrected.rules[0]),
  },
  configSha256: sha256(JSON.stringify(config, null, 2) + "\n"),
};
fs.writeFileSync(path.join(dir, "rule-documents.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
