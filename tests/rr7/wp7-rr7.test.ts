/**
 * WP7 — actual managed OCR (ocr-v1.13.1-rr.7) qualification.
 *
 * Opt-in: runs only on Linux with the approved rr.7 assets mounted at
 * OCR_RR7_DIR. Executes the real binary against a loopback fake provider.
 * No live provider, credential, Gateway or model call is made.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertOcrInputBound, MAX_OCR_INPUT_CHARS, OcrInputTooLargeError } from "../../src/ocr-profile-a.ts";
import { runManagedOcr } from "../../scripts/ocr-rr7/native-runner.ts";
import {
  binaryIdentity,
  gitBlobSha1,
  makeCase,
  PARSER_COMMIT,
  PARSER_NORMALIZATION_BLOB,
  PARSER_OUTCOME_BLOB,
  pinnedParser,
  readManifest,
  readQualification,
  requireRr7,
  reviewerInput,
  ROOT,
  RR7_BINARY,
  RR7_RELEASE,
  RR7_SHA256,
  RR7_SIZE,
  RR7_SOURCE_COMMIT,
  RR7_SOURCE_TREE,
  ruleFor,
  runCase,
} from "./harness.ts";

test("RR7: approved artifact identity and build manifest", (t) => {
  if (!requireRr7(t)) return;
  const manifest = readManifest();
  const identity = binaryIdentity();

  assert.equal(manifest.manifest_schema, "open-code-review.build/v1");
  assert.equal(manifest.repository, "agent-teams-ai/open-code-review");
  assert.equal(manifest.source_commit, RR7_SOURCE_COMMIT);
  assert.equal(manifest.source_tree, RR7_SOURCE_TREE);
  assert.equal(manifest.upstream_repository, "alibaba/open-code-review");
  assert.equal(manifest.upstream_commit, "8eb83340a487b1150af00701b94f01af97e4b4d6");
  assert.equal(manifest.toolchain, "go1.26.11");
  assert.equal(manifest.goos, "linux");
  assert.equal(manifest.goarch, "amd64");
  assert.equal(manifest.goamd64, "v1");
  assert.equal(manifest.gofips140, "off");
  assert.equal(manifest.cgo_enabled, "0");
  assert.equal(manifest.release_version, RR7_RELEASE);
  assert.equal(manifest.outcome_schema_version, "reviewrouter.ocr-outcome/v1");
  assert.equal(manifest.binary_sha256, RR7_SHA256);
  assert.equal(Number(manifest.binary_size_bytes), RR7_SIZE);

  assert.equal(identity.size, RR7_SIZE, "actual binary size must match the manifest");
  assert.equal(identity.sha256, RR7_SHA256, "actual binary SHA-256 must match the manifest");
});

test("RR7: binary reports the pinned version", (t) => {
  if (!requireRr7(t)) return;
  const result = spawnSync(RR7_BINARY, ["--version"], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`open-code-review ${RR7_RELEASE.replace(/\./g, "\\.")}`));
  assert.match(result.stdout, /linux\/amd64/);
  assert.match(result.stdout, /alibaba\/open-code-review/);
});

test("RR7: qualification record covers four model-free cases", (t) => {
  if (!requireRr7(t)) return;
  const q = readQualification();
  assert.equal(q.schema_version, "opencodereview.managed-qualification/v1");
  assert.equal(q.release_version, RR7_RELEASE);
  assert.equal(q.source_commit, RR7_SOURCE_COMMIT);
  assert.equal(q.source_tree, RR7_SOURCE_TREE);
  assert.equal(q.binary_sha256, RR7_SHA256);
  assert.equal(q.outcome_schema_version, "reviewrouter.ocr-outcome/v1");
  assert.equal(q.model_free, true);
  assert.equal(q.passed, true);
  // The recorded boundary is loopback-only with an allowlisted environment;
  // it is not an OS network-isolation claim.
  assert.match(q.network_boundary, /loopback/);
  assert.match(q.network_boundary, /no OS network isolation/);
  assert.equal(q.qualification_cases.length, 4);
  for (const item of q.qualification_cases) {
    assert.equal(item.passed, true, item.name);
    assert.ok(item.http_requests >= 1);
    assert.ok(item.terminal_state === "complete" || item.terminal_state === "failed");
  }
  const findingCase = q.qualification_cases.find((c: any) => c.name === "openai-responses/finding");
  assert.equal(findingCase.http_requests, 5);
  assert.equal(findingCase.exit_code, 0);
  assert.equal(findingCase.findings, 1);
  assert.equal(findingCase.terminal_state, "complete");
});

test("RR7: parser and normalizer blobs match the pinned commit", (t) => {
  if (!requireRr7(t)) return;
  const dir = path.join(
    ROOT,
    "vendor/review-router",
    PARSER_COMMIT,
    "src/review-orchestration/infrastructure"
  );
  const outcome = fs.readFileSync(path.join(dir, "ocr-review-outcome-contract.ts"));
  const normalization = fs.readFileSync(path.join(dir, "ocr-review-normalization.ts"));
  assert.equal(gitBlobSha1(outcome), PARSER_OUTCOME_BLOB);
  assert.equal(gitBlobSha1(normalization), PARSER_NORMALIZATION_BLOB);
});

test("RR7: managed finding run is complete and grounded", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase();
  assert.equal(evidence.exit_code, 0, evidence.stderr);
  assert.equal(evidence.provider_problem, null);
  // Round 1: code_comment + task_done, filter, round 2: task_done.
  assert.equal(evidence.request_count, 4);
  assert.equal(evidence.native.status, "complete");
  assert.equal(evidence.native.manifest.schema_version, "ocr.run-manifest/v1");
  assert.equal(evidence.native.manifest.operation, "review");
  assert.equal(evidence.native.manifest.input.mode, "range");
  assert.equal(evidence.native.manifest.input.resolved_base, evidence.repo_base);
  assert.equal(evidence.native.manifest.input.resolved_head, evidence.repo_head);
  assert.equal(evidence.native.reviewrouter_outcome.schema_version, "reviewrouter.ocr-outcome/v1");
  assert.equal(evidence.native.reviewrouter_outcome.run_stop_cause, null);
  assert.equal(evidence.native.comments.length, 1);
  const comment = evidence.native.comments[0];
  assert.equal(comment.path, "src/calc.ts");
  assert.equal(comment.existing_code, "return a - b;");
  assert.equal(comment.start_line, 2);
  assert.equal(comment.end_line, 2);
  assert.equal(evidence.native.manifest.coverage.failed.length, 0);
});

test("RR7: unchanged run completes with no findings", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase({ scenario: "unchanged" });
  assert.equal(evidence.exit_code, 0, evidence.stderr);
  assert.equal(evidence.provider_problem, null);
  assert.equal(evidence.native.status, "complete");
  assert.equal(evidence.native.manifest.terminal_state, "complete");
  assert.deepEqual(evidence.native.comments, []);
  assert.equal(evidence.native.manifest.coverage.failed.length, 0);
});

test("RR7: partial multi-group run preserves completed groups and does not retry", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase({
    scenario: "partial",
    paths: ["src/calc.ts", "src/util.ts", "src/text.ts", "src/math.ts"],
    comments: [
      { path: "src/calc.ts", content: "AC-2: subtraction replaces addition.", existing_code: "return a - b;", severity: "high" },
      { path: "src/util.ts", content: "AC-2: operand order is reversed.", existing_code: "return b - a;", severity: "high" },
    ],
  });
  assert.equal(evidence.exit_code, 0);
  assert.equal(evidence.native.status, "partial");
  assert.equal(evidence.native.manifest.terminal_state, "partial");
  const failed = evidence.native.manifest.coverage.failed;
  assert.equal(failed.length, 1);
  assert.equal(failed[0].path, "src/util.ts");
  assert.equal(failed[0].classification, "provider");
  const completedPaths = evidence.native.manifest.coverage.completed.map((c: any) => c.path).sort();
  assert.deepEqual(completedPaths, ["src/calc.ts", "src/math.ts", "src/text.ts"]);
  const utilGroup = evidence.native.reviewrouter_outcome.groups.find((g: any) => g.paths.includes("src/util.ts"));
  assert.equal(utilGroup.main_completed, false);
  assert.equal(utilGroup.stop_cause, "provider_error");
  // Exactly one dispatch reached the failing group: no hidden retry.
  const utilRequests = evidence.requests.filter((r) => JSON.stringify(r.json?.input ?? "").includes('<file path=\\"src/util.ts\\">'));
  assert.equal(utilRequests.length, 1);
});

test("RR7: malformed terminal stream fails after exactly one request", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase({ scenario: "malformed" });
  assert.notEqual(evidence.exit_code, 0);
  assert.equal(evidence.request_count, 1);
  assert.equal(evidence.native.manifest.terminal_state, "failed");
  assert.ok(evidence.native.comments === null || evidence.native.comments.length === 0);
});

test("RR7: truncated stream fails after exactly one request", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase({ scenario: "truncated" });
  assert.notEqual(evidence.exit_code, 0);
  assert.equal(evidence.request_count, 1);
  assert.equal(evidence.native.manifest.terminal_state, "failed");
  assert.ok(evidence.native.comments === null || evidence.native.comments.length === 0);
});

test("RR7: refusal never yields a completed review or findings", async (t) => {
  if (!requireRr7(t)) return;
  // A refusal is a non-terminal assistant turn: the managed main loop asks
  // again rather than treating it as a finding. Record that actual behaviour
  // (it is a bounded retry loop, not a transport retry) without claiming a
  // single-dispatch outcome that the binary does not provide.
  const { evidence } = await runCase({ scenario: "refusal", paths: ["src/calc.ts"] });
  assert.notEqual(evidence.exit_code, 0);
  assert.ok(evidence.request_count > 1, "refusal is retried by the main turn loop");
  assert.equal(evidence.native.manifest.terminal_state, "failed");
  assert.ok(evidence.native.comments === null || evidence.native.comments.length === 0);
});

test("RR7: cancellation stops the run without retry", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase({
    scenario: "stall",
    cancelAfterFirstRequest: true,
    stallMs: 3000,
    timeoutMs: 10000,
  });
  assert.equal(evidence.cancelled, true);
  assert.equal(evidence.request_count, 1);
  assert.notEqual(evidence.exit_code, 0);
  if (evidence.native) {
    assert.notEqual(evidence.native.manifest?.terminal_state, "complete");
  }
});

test("RR7: child environment is an explicit allowlist and config is private", async (t) => {
  if (!requireRr7(t)) return;
  const marker = "RR7_PARENT_SECRET_MARKER";
  process.env.OCR_LLM_URL = "http://parent.invalid";
  process.env.RR7_PARENT_SECRET_MARKER = "leaked";
  try {
    const { fixture, evidence } = await runCase();
    assert.equal(evidence.env_allowlist.RR7_PARENT_SECRET_MARKER, undefined);
    assert.equal(evidence.env_allowlist.OCR_LLM_URL, undefined);
    const allowedOcrKeys = new Set(["OCR_ENABLE_TELEMETRY", "OCR_CONTENT_LOGGING", "OCR_RAW_LOGGING"]);
    for (const key of Object.keys(evidence.env_allowlist)) {
      if (key.startsWith("OCR_")) {
        assert.ok(allowedOcrKeys.has(key), `unexpected inherited ${key}`);
      }
      assert.ok(!/^OCR_LLM_/.test(key), `unexpected provider endpoint ${key}`);
      assert.ok(!/^(OPENAI|ANTHROPIC|CHATGPT|GATEWAY)_/.test(key), `unexpected provider credential ${key}`);
    }
    const configPath = path.join(fixture.root, "home", ".opencodereview", "config.json");
    const stat = fs.statSync(configPath);
    assert.equal(stat.mode & 0o777, 0o600, "managed OCR config must be private");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.provider, "reviewrouter");
    assert.equal(config.telemetry.enabled, false);
    const url = new URL(config.custom_providers.reviewrouter.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/");
    assert.equal(config.custom_providers.reviewrouter.protocol, "openai-responses");
    assert.equal(marker, "RR7_PARENT_SECRET_MARKER");
  } finally {
    delete process.env.OCR_LLM_URL;
    delete process.env.RR7_PARENT_SECRET_MARKER;
  }
});

test("RR7: repository input respects the 8000-character bound", async (t) => {
  if (!requireRr7(t)) return;
  assert.equal(MAX_OCR_INPUT_CHARS, 8000);
  assert.doesNotThrow(() => assertOcrInputBound("x".repeat(8000)));
  assert.throws(() => assertOcrInputBound("x".repeat(8001)), OcrInputTooLargeError);
  const fixture = await makeCase();
  await assert.rejects(
    runManagedOcr({
      binary: RR7_BINARY,
      root: fixture.root,
      repo: fixture.repo,
      base: fixture.base,
      head: fixture.head,
      reviewerInput: "x".repeat(8001),
      rule: ruleFor(["src/calc.ts", "src/util.ts"]),
    }),
    /exceeds 8000 characters/
  );
});

test("RR7: egress traces only loopback and never the sealed canary tree", async (t) => {
  if (!requireRr7(t)) return;
  const { fixture } = await runCase();
  const stracePath = path.join(fixture.root, "native.strace");
  const traced = await runManagedOcr({
    binary: RR7_BINARY,
    root: fixture.root,
    repo: fixture.repo,
    base: fixture.base,
    head: fixture.head,
    reviewerInput: reviewerInput(fixture.diff),
    rule: ruleFor(["src/calc.ts", "src/util.ts"]),
    scenario: "finding",
    comments: [
      { path: "src/calc.ts", content: "AC-2: subtraction replaces addition.", existing_code: "return a - b;", severity: "high" },
    ],
    stracePath,
    timeoutMs: 45000,
  });
  assert.equal(traced.exit_code, 0, traced.stderr);
  assert.equal(traced.native.status, "complete");
  const trace = fs.readFileSync(stracePath, "utf8");
  assert.ok(trace.length > 0);
  assert.ok(!trace.includes("/forbidden"), "child must never touch the sealed canary tree");
  const connects = trace.split(/\r?\n/).filter((line) => line.includes("connect("));
  assert.ok(connects.length > 0, "the run must make at least one loopback connection");
  for (const line of connects) {
    assert.match(line, /127\.0\.0\.1|AF_UNIX|AF_LOCAL|AF_NETLINK/, `non-loopback connect: ${line}`);
  }
});

test("RR7: pinned parser accepts real rr.7 output and rejects contract tampering", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase();
  const admission = { baseSha: evidence.repo_base, mergeBaseSha: evidence.repo_base, headSha: evidence.repo_head };
  const parsed = pinnedParser.parseOcrNativeReviewResult(evidence.native, admission);
  assert.equal(parsed.comments.length, 1);
  assert.equal(parsed.manifest.terminalState, "complete");
  assert.equal(parsed.outcome?.runStopCause ?? null, null);

  const badManifest = structuredClone(evidence.native);
  badManifest.manifest.input.resolved_head = "0".repeat(40);
  assert.throws(() => pinnedParser.parseOcrNativeReviewResult(badManifest, admission));

  const missingOutcome = structuredClone(evidence.native);
  delete missingOutcome.reviewrouter_outcome;
  assert.throws(() => pinnedParser.parseOcrNativeReviewResult(missingOutcome, admission));

  const unknownStop = structuredClone(evidence.native);
  unknownStop.reviewrouter_outcome.run_stop_cause = "not-a-real-stop";
  assert.throws(() => pinnedParser.parseOcrNativeReviewResult(unknownStop, admission));
});

test("RR7: pinned normalizer grounds native spans and flags unverified ones", async (t) => {
  if (!requireRr7(t)) return;
  const { evidence } = await runCase();
  const parsed = pinnedParser.parseOcrNativeReviewResult(evidence.native, {
    baseSha: evidence.repo_base,
    mergeBaseSha: evidence.repo_base,
    headSha: evidence.repo_head,
  });
  const headFiles = new Map([["src/calc.ts", "export function add(a: number, b: number) {\n  return a - b;\n}\n"]]);
  const normalized = pinnedParser.normalizeOcrFindings({
    comments: parsed.comments,
    assignedPaths: ["src/calc.ts"],
    headFiles,
  });
  assert.equal(normalized.findings.length, 1);
  const finding = normalized.findings[0];
  assert.equal(finding.file, "src/calc.ts");
  assert.equal(finding.line, 2);
  assert.equal(finding.severity, "major");
  assert.ok(finding.message.includes("subtracts"));

  const unverified = pinnedParser.normalizeOcrFindings({
    comments: parsed.comments.map((c) => ({ ...c, existingCode: "return not-present;" })),
    assignedPaths: ["src/calc.ts"],
    headFiles,
  });
  assert.equal(unverified.findings.length, 1);
  assert.ok(unverified.diagnostics.reasons.includes("unverified_native_span"));
});
