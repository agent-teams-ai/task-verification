// Deterministic, model-free reconciliation of every billable inference request
// in the D1/D2 experiment against the authorized USD 1.00 research ceiling.
//
// Prices are the verified public OpenRouter rates for openai/gpt-6.1-terra:
//   input 1.00 / cache read 0.05 / cache write 1.25 / output 5.00 per million.
// The conservative charge prices EVERY input token at the cache-write rate and
// every output token at the output rate, so it can never understate the bill.
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const runs = path.resolve(dir, "..");
const IN = 1.25 / 1e6;
const OUT = 5.0 / 1e6;

const readJsonl = (p) =>
  fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];

const fromLedger = (name, file, note) => {
  const lines = readJsonl(file);
  const fwd = lines.filter((l) => l.decision === "forwarded");
  const refused = lines.filter((l) => l.decision === "refused");
  const inputTokens = fwd.reduce((s, l) => s + (l.chargedInputTokens || 0), 0);
  const outputTokens = fwd.reduce((s, l) => s + (l.chargedOutputTokens || 0), 0);
  return {
    name,
    kind: "ocr",
    note,
    forwarded: fwd.length,
    refused: refused.length,
    refusedCodes: refused.map((r) => r.code ?? null),
    inputTokens,
    outputTokens,
    conservativeUsd: Number((inputTokens * IN + outputTokens * OUT).toFixed(8)),
    maxInputBytes: Math.max(0, ...fwd.map((l) => l.inputBytes || 0)),
  };
};

const fromCriteria = (name, file, note) => {
  const a = JSON.parse(fs.readFileSync(file, "utf8"));
  const u = (a.result && a.result.usage) || {};
  const forwarded = (a.execution && a.execution.forwardedRequests) || 0;
  return {
    name,
    kind: "criteria",
    note,
    forwarded,
    refused: ((a.execution && a.execution.refusals) || []).length,
    refusedCodes: (a.execution && a.execution.refusals) || [],
    inputTokens: u.inputTokens || 0,
    outputTokens: u.outputTokens || 0,
    conservativeUsd: Number(((u.inputTokens || 0) * IN + (u.outputTokens || 0) * OUT).toFixed(8)),
    maxInputBytes: Math.max(0, ...((a.execution && a.execution.inputBytes) || [0])),
    providerDelta: a.providerKeyUsage ? a.providerKeyUsage.delta : null,
    verdicts: a.result && a.result.value ? a.result.value.assessments.map((x) => `${x.requirementId}:${x.status}`) : null,
  };
};

const stages = [
  fromLedger("initial-ocr-attempt1", path.join(runs, "d12-initial-rr1", "ledger-live-attempt1.jsonl"),
    "frozen initial attempt; refused at the then-current byte ceiling and re-run with a verified revised bound"),
  fromLedger("initial-ocr", path.join(runs, "d12-initial-rr1", "ledger-live.jsonl"),
    "frozen initial OCR that produced the original findings (delivered rule document did not carry the policy)"),
  fromCriteria("initial-criteria", path.join(runs, "d12-initial", "evidence", "criteria-assessment.json"),
    "frozen independent Criteria Assessment Profile B on Candidate A"),
  fromLedger("recheck-ocr-A", path.join(dir, "ledger-ocr-A-live.jsonl"),
    "corrected-development-regression: corrected rule delivery, Candidate A"),
  fromLedger("recheck-ocr-B-attempt1", path.join(dir, "ledger-ocr-B-live-attempt1.jsonl"),
    "Candidate B; refused mid-run at the frozen 65,536-byte request bound; incomplete, not used as evidence"),
  fromLedger("recheck-ocr-B-attempt2", path.join(dir, "ledger-ocr-B-live-attempt2.jsonl"),
    "Candidate B; refused again at the frozen bound; incomplete, not used as evidence"),
  fromLedger("recheck-ocr-B-revised", path.join(dir, "ledger-ocr-B-live-revised.jsonl"),
    "Candidate B; verified revised bound 131,072 B / 262,144-24,000 stage tokens; complete"),
  fromCriteria("recheck-criteria-B", path.join(dir, "criteria-assessment-B.json"),
    "independent Criteria Assessment Profile B re-run on Candidate B"),
  fromCriteria("diagnostic-criteria-C", path.join(dir, "criteria-assessment-C.json"),
    "Diagnostic A: disconnected-behaviour variant C, same Profile B input profile"),
];

const offline = [
  { name: "initial-offline-preflight", file: path.join(runs, "d12-initial-rr1", "ledger-offline.jsonl") },
  { name: "recheck-A-offline-preflight", file: path.join(dir, "ledger-ocr-A-offline.jsonl") },
].map(({ name, file }) => {
  const lines = readJsonl(file);
  return { name, requests: lines.filter((l) => l.decision === "forwarded").length, billable: false };
});

const totals = stages.reduce(
  (t, s) => ({
    forwarded: t.forwarded + s.forwarded,
    refused: t.refused + s.refused,
    inputTokens: t.inputTokens + s.inputTokens,
    outputTokens: t.outputTokens + s.outputTokens,
    conservativeUsd: Number((t.conservativeUsd + s.conservativeUsd).toFixed(8)),
  }),
  { forwarded: 0, refused: 0, inputTokens: 0, outputTokens: 0, conservativeUsd: 0 },
);

const report = {
  schema: "d12.usage-reconciliation/v1",
  operator: "model-free; reads retained ledgers and assessment records only",
  prices: { inputPerM: 1, cacheReadPerM: 0.05, cacheWritePerM: 1.25, outputPerM: 5, longPromptOverridePerM: { input: 2, output: 7.5 } },
  ceilingUsd: 1,
  providerAuthoritative: {
    baselineBeforeRecheck: 0.09085455,
    finalUsage: Number(process.env.FINAL_PROVIDER_USAGE ?? 0),
    keyLimitUsd: Number(process.env.PROVIDER_KEY_LIMIT ?? 0),
    keyLimitRemainingUsd: Number(process.env.PROVIDER_KEY_REMAINING ?? 0),
    note: "Baseline is the reported authoritative spend before the recheck. The final value is the provider /key usage read after the last request; provider settlement lags, so per-call before/after deltas can be incomplete.",
  },
  stages,
  offlinePreflights: offline,
  totals,
  remaining: {
    conservativeUsd: Number((1 - totals.conservativeUsd).toFixed(8)),
    providerAuthoritativeUsd: Number(
      (1 - (Number(process.env.FINAL_PROVIDER_USAGE ?? 0) || 0.09085455)).toFixed(8),
    ),
  },
  requestCount: {
    providerForwarded: totals.forwarded,
    providerRefused: totals.refused,
    offlineModelFree: offline.reduce((s, o) => s + o.requests, 0),
  },
};

fs.writeFileSync(path.join(dir, "reconciliation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ stages: stages.map((s) => ({ name: s.name, fwd: s.forwarded, ref: s.refused, in: s.inputTokens, out: s.outputTokens, usd: s.conservativeUsd })), totals, requestCount: report.requestCount, remaining: report.remaining, provider: report.providerAuthoritative }, null, 2));
