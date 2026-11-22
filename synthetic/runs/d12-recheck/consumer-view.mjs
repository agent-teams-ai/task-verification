// Deterministic offline reconstruction of what the pinned ReviewRouter consumer
// makes of the native OCR result. No model, provider or network.
//
// Consumer modules are the pinned, byte-identical copies from
// 777genius/review-router@7a079c382d8e98b426ee90a6b3764be2a21b4c49
// (vendor/review-router/<commit>/src/review-orchestration/infrastructure/).
//
// Stages reconstructed:
//   A. native findings as delivered by the CLI's managed JSON (post-filter set)
//   B. findings accepted by the pinned normalizer
//   C. findings the consumer can place inline (verified current-diff span)
//   D. findings skipped or downgraded, with the documented reason
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const syn = path.resolve(dir, "../..");
const repo = path.join(syn, "repo");
const VENDOR = "D:/Project/agent-teams-ai-task-verification-m2/vendor/review-router/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure";
const BASE = "ce99b0d65d645124413a746ecb137b5497aad80f";
const HEAD = "23864e3c877f2b34bbbdd90c4527ef46eb19cbd9";

const { parseOcrNativeReviewResult } = await import(pathToFileURL(path.join(VENDOR, "ocr-review-outcome-contract.ts")).href);
const { normalizeOcrFindings } = await import(pathToFileURL(path.join(VENDOR, "ocr-review-normalization.ts")).href);

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const resultPath = process.argv[2] ?? path.join(syn, "runs", "d12-initial-rr1", "ocr-result-live.json");
const raw = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const pr = JSON.parse(fs.readFileSync(path.join(syn, "metadata", "pr.json"), "utf8"));
const assignedPaths = pr.changedPaths.map((c) => c.path);

// Authorized HEAD content and current-diff positions for one file.
function diffPositionsFor(file) {
  const diff = git("diff", "--unified=0", BASE, HEAD, "--", file);
  const positions = new Map();
  let position = 0;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      position = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      positions.set(position, position);
      position += 1;
    }
  }
  return positions;
}

const headFiles = new Map(assignedPaths.map((p) => [p, git("show", `${HEAD}:${p}`)]));
const diffPositions = new Map(assignedPaths.map((p) => [p, diffPositionsFor(p)]));

// The CLI's managed JSON is parsed by the pinned boundary parser first: a native
// result the consumer would reject never reaches normalization.
let parsed;
let contractError = null;
try {
  parsed = parseOcrNativeReviewResult(raw, { baseSha: BASE, mergeBaseSha: BASE, headSha: HEAD });
} catch (error) {
  contractError = { name: error?.name, message: String(error?.message), issues: error?.issues ?? null };
}

const nativeComments = parsed ? parsed.comments : [];
const normalized = parsed
  ? normalizeOcrFindings({ comments: nativeComments, assignedPaths, headFiles, diffPositions })
  : null;

const describe = (c) => ({
  path: c.path,
  startLine: c.startLine,
  endLine: c.endLine,
  severity: c.severity,
  category: c.category,
  contentFirstLine: c.content.split("\n")[0].slice(0, 160),
});

const record = {
  schema: "d12.consumer-view/v1",
  operator: "deterministic offline reconstruction; pinned ReviewRouter consumer modules; no model, provider or network",
  consumerPin: {
    repository: "777genius/review-router",
    commit: "7a079c382d8e98b426ee90a6b3764be2a21b4c49",
    modules: ["ocr-review-outcome-contract.ts", "ocr-review-normalization.ts"],
    sha256: {
      outcomeContract: "b927b7ac10dc305f417cba1ec4230b8da3f6796d8ee2df7054d4bf08336c84b7",
      normalization: "0dd1b7a792139c71141ccc742747390f6583e49dda5eb9a42059f4e52ed01818",
    },
  },
  sourceResult: path.relative(syn, resultPath).replace(/\\/g, "/"),
  assignedPaths,
  contract: contractError ? { accepted: false, ...contractError } : { accepted: true },
  A_nativePostFilter: nativeComments.map(describe),
  B_acceptedByNormalizer: normalized ? normalized.findings.map((f) => ({ ...f, message: undefined, title: f.title })) : null,
  C_inlinePlaceable: normalized
    ? normalized.findings
        .filter((f) => typeof f.line === "number" && f.line > 0)
        .map((f) => ({ file: f.file, line: f.line, startLine: f.startLine, endLine: f.endLine, severity: f.severity, title: f.title }))
    : null,
  D_skippedOrDowngraded: normalized
    ? {
        skipped: normalized.diagnostics.skipped,
        reasons: normalized.diagnostics.reasons,
        fileLevelOnly: normalized.findings.filter((f) => !(typeof f.line === "number" && f.line > 0)).map((f) => ({ file: f.file, title: f.title })),
        severityDowngrades: normalized.findings
          .map((f, i) => ({ file: f.file, title: f.title, native: nativeComments[i]?.severity ?? null, consumer: f.severity }))
          .filter((x) => x.native !== null && x.native !== x.consumer),
      }
    : null,
  lowSeverityOnTestFile: normalized
    ? normalized.findings
        .filter((f) => f.file === "tests/records.test.ts")
        .map((f) => ({ file: f.file, line: f.line, severity: f.severity, title: f.title }))
    : null,
};
fs.writeFileSync(path.join(dir, "consumer-view.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
