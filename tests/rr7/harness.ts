/**
 * Shared harness for the opt-in ocr-v1.13.1-rr.7 suites.
 *
 * These tests execute the exact Linux/amd64 managed OCR binary against an
 * in-process loopback fake provider. They are not part of the default
 * `npm test` glob: they require a Linux host/container and the rr.7 assets,
 * supplied through OCR_RR7_DIR (default /rr7).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";

import { makeSyntheticRepo, runManagedOcr, sha256, tmpRoot, type ManagedOcrEvidence } from "../../scripts/ocr-rr7/native-runner.ts";
import type { OcrParserPort } from "../../src/ocr-profile-a.ts";
import { parseOcrNativeReviewResult } from "../../vendor/review-router/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/ocr-review-outcome-contract.ts";
import { normalizeOcrFindings } from "../../vendor/review-router/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/ocr-review-normalization.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RR7_DIR = process.env.OCR_RR7_DIR ?? "/rr7";
export const RR7_BINARY = path.join(RR7_DIR, "opencodereview-linux-amd64");
export const RR7_MANIFEST = path.join(RR7_DIR, "MANIFEST");
export const RR7_QUALIFICATION = path.join(RR7_DIR, "qualification.json");
export const RR7_RELEASE = "1.13.1-rr.7";
export const RR7_TAG = "ocr-v1.13.1-rr.7";
export const RR7_SOURCE_COMMIT = "997293d17d2d4db08c942ecdd4d6fe0af91811a9";
export const RR7_SOURCE_TREE = "8e19c7b5ecd86c7bd696aa088455bdbe6e563bf8";
export const RR7_SHA256 = "2f290fb407a5cb6fbe854cb6702b8c713325fce603a71c1be83f5284034aaa29";
export const RR7_SIZE = 80_513_021;
export const PARSER_COMMIT = "7a079c382d8e98b426ee90a6b3764be2a21b4c49";
export const PARSER_OUTCOME_BLOB = "5ba2ba5ddfe52c93b0dc7d7514b1e0a3d7047698";
export const PARSER_NORMALIZATION_BLOB = "43bcfa54ee3dedd50a18e2d8e8f9aaf5cd5a0a42";

export function rr7Available(): boolean {
  return process.platform === "linux" && fs.existsSync(RR7_BINARY);
}

/** Skip the test, with a visible reason, when the approved asset is absent. */
export function requireRr7(t: TestContext): boolean {
  if (!rr7Available()) {
    t.skip(`rr.7 assets unavailable (platform=${process.platform}, binary=${RR7_BINARY})`);
    return false;
  }
  return true;
}

export function readManifest(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(RR7_MANIFEST, "utf8").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

export function readQualification(): any {
  return JSON.parse(fs.readFileSync(RR7_QUALIFICATION, "utf8"));
}

/** Git blob SHA-1 for arbitrary bytes (what `git hash-object` records). */
export function gitBlobSha1(buffer: Buffer): string {
  return createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
}

export const pinnedParser: OcrParserPort = {
  parseOcrNativeReviewResult(raw, admission) {
    return parseOcrNativeReviewResult(raw, admission) as unknown as ReturnType<
      OcrParserPort["parseOcrNativeReviewResult"]
    >;
  },
  normalizeOcrFindings(input) {
    return normalizeOcrFindings({
      ...input,
      comments: input.comments as never,
    }) as unknown as ReturnType<OcrParserPort["normalizeOcrFindings"]>;
  },
};

export interface FixtureCase {
  root: string;
  repo: string;
  base: string;
  head: string;
  diff: string;
  outDir: string;
}

export const BASE_FILES: Record<string, string> = {
  "src/calc.ts": "export function add(a: number, b: number) {\n  return a + b;\n}\n",
  "src/util.ts": "export function sub(a: number, b: number) {\n  return a - b;\n}\n",
  "src/text.ts": "export function label(value: string) {\n  return value.trim();\n}\n",
  "src/math.ts": "export function mul(a: number, b: number) {\n  return a * b;\n}\n",
};

const HEAD_FILES: Record<string, string> = {
  "src/calc.ts": "export function add(a: number, b: number) {\n  return a - b;\n}\n",
  "src/util.ts": "export function sub(a: number, b: number) {\n  return b - a;\n}\n",
  "src/text.ts": "export function label(value: string) {\n  return value;\n}\n",
  "src/math.ts": "export function mul(a: number, b: number) {\n  return a + b;\n}\n",
};

export function headFilesFor(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of paths) {
    const head = HEAD_FILES[rel];
    assert.ok(head, `no head fixture for ${rel}`);
    out[rel] = head;
  }
  return out;
}

export const DEFAULT_PATHS = ["src/calc.ts", "src/util.ts"];

export async function makeCase(paths: string[] = DEFAULT_PATHS): Promise<FixtureCase> {
  const root = tmpRoot("rr7-case-");
  const home = path.join(root, "home");
  const baseFiles: Record<string, string> = {};
  for (const rel of paths) {
    assert.ok(BASE_FILES[rel], `no base fixture for ${rel}`);
    baseFiles[rel] = BASE_FILES[rel];
  }
  const headFiles = headFilesFor(paths);
  const repoInfo = await makeSyntheticRepo({ root, home, baseFiles, headFiles });
  return { root, ...repoInfo };
}

export function reviewerInput(diff: string, criteria: string[] = ["AC-2"]): string {
  return [
    "Candidate alias: S1-FIX-TEST",
    "Source identity: fixture",
    "Base identity: fixture-base",
    "Head identity: fixture-head",
    "Task: implement the profile changes without regressions.",
    "Criteria:",
    ...criteria.map((id) => `- ${id}: frozen criterion ${id}`),
    "Complete diff:",
    diff,
    "Background: synthetic model-free qualification fixture.",
    "Rules: report only issues introduced by the diff.",
  ].join("\n");
}

export function ruleFor(paths: string[]): unknown {
  return {
    merge_system_rule: true,
    include: paths,
    rules: [{ id: "rr7-qualification", content: "Report only issues introduced by the base-to-head diff." }],
  };
}

export interface RunCaseOptions {
  scenario?: Parameters<typeof runManagedOcr>[0]["scenario"];
  paths?: string[];
  comments?: unknown[];
  cancelAfterFirstRequest?: boolean;
  timeoutMs?: number;
  stallMs?: number;
  stracePath?: string;
}

export async function runCase(options: RunCaseOptions = {}): Promise<{
  fixture: FixtureCase;
  evidence: ManagedOcrEvidence;
}> {
  const paths = options.paths ?? DEFAULT_PATHS;
  const fixture = await makeCase(paths);
  const evidence = await runManagedOcr({
    binary: RR7_BINARY,
    root: fixture.root,
    repo: fixture.repo,
    base: fixture.base,
    head: fixture.head,
    reviewerInput: reviewerInput(fixture.diff),
    rule: ruleFor(paths),
    scenario: options.scenario ?? "finding",
    comments: options.comments ?? [
      {
        path: "src/calc.ts",
        content: "AC-2: the new expression subtracts instead of adding.",
        existing_code: "return a - b;",
        severity: "high",
      },
    ],
    ...(options.cancelAfterFirstRequest ? { cancelAfterFirstRequest: true } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.stallMs !== undefined ? { stallMs: options.stallMs } : {}),
    ...(options.stracePath ? { stracePath: options.stracePath } : {}),
  });
  return { fixture, evidence };
}

export function binaryIdentity(): { size: number; sha256: string } {
  const bytes = fs.readFileSync(RR7_BINARY);
  return { size: bytes.length, sha256: sha256(bytes) };
}
