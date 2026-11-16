/**
 * Profile A managed OCR consumer adapter (WP7/WP8).
 *
 * This module is the actual M2 Profile A consumer path:
 *
 *   rendered M2 reviewer input
 *     -> caller-supplied managed OCR execution port (the exact rr.7 binary)
 *     -> pinned ReviewRouter outcome parser
 *     -> pinned ReviewRouter finding normalizer
 *     -> FindingRecord[] for ResultContract v1
 *
 * The pinned parser/normalizer modules are consumed verbatim; this module only
 * adapts their outputs to the M2 contract. It never invents a satisfied or
 * violated verdict from native comments: Profile A has findings, not criterion
 * conclusions.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { FindingRecord } from "./result-contract.ts";
import { runProfileA, type DispatchRecord, type ProfileAAdapterResult } from "./adapters.ts";

/**
 * Maximum rendered reviewer input, in characters. The upstream invocation
 * adapter rejects oversize input *before* provider dispatch; the same bound is
 * enforced here before the OCR process is started.
 */
export const MAX_OCR_INPUT_CHARS = 8000;

export class OcrInputTooLargeError extends Error {
  readonly code = "ocr_input_too_large";
  readonly length: number;
  constructor(length: number) {
    super(`OCR reviewer input exceeds ${MAX_OCR_INPUT_CHARS} characters (got ${length})`);
    this.name = "OcrInputTooLargeError";
    this.length = length;
  }
}

export function assertOcrInputBound(text: string): void {
  if (text.length > MAX_OCR_INPUT_CHARS) throw new OcrInputTooLargeError(text.length);
}

export interface OcrCriteria {
  id: string;
  text: string;
}

/** Deterministic reviewer-visible input shared by Profile A and Profile B. */
export interface OcrReviewerInputFields {
  candidateAlias: string;
  sourceIdentity: string;
  base: string;
  head: string;
  diff: string;
  task: string;
  criteria: readonly OcrCriteria[];
  background: string;
  rules: string;
}

export function renderOcrReviewerInput(fields: OcrReviewerInputFields): string {
  return [
    `Candidate alias: ${fields.candidateAlias}`,
    `Source identity: ${fields.sourceIdentity}`,
    `Base identity: ${fields.base}`,
    `Head identity: ${fields.head}`,
    `Task: ${fields.task}`,
    "Criteria:",
    ...fields.criteria.map((c) => `- ${c.id}: ${c.text}`),
    "Complete diff:",
    fields.diff,
    `Background: ${fields.background}`,
    `Rules: ${fields.rules}`,
  ].join("\n");
}

/** Native managed result shape consumed by the pinned parser (structural). */
export interface OcrNativeDocument {
  [key: string]: unknown;
}

export interface OcrParserPort {
  parseOcrNativeReviewResult(
    raw: unknown,
    admission: { baseSha: string; mergeBaseSha: string; headSha: string },
  ): {
    comments: readonly {
      path: string;
      content: string;
      suggestionCode: string | null;
      existingCode: string | null;
      startLine: number | null;
      endLine: number | null;
      category: string | null;
      severity: string | null;
    }[];
    manifest: { terminalState: string | null };
    outcome?: { runStopCause: string | null };
  };
  normalizeOcrFindings(input: {
    comments: readonly unknown[];
    assignedPaths?: readonly string[];
    headFiles: { get(path: string): string | undefined };
    diffPositions?: ReadonlyMap<string, ReadonlyMap<number, number>>;
  }): {
    findings: readonly FindingLike[];
    diagnostics: {
      skipped: readonly { index: number; reason: string }[];
      reasons: readonly string[];
      partialFlagsRequired: boolean;
    };
  };
}

export interface FindingLike {
  file: string;
  line: number;
  startLine?: number;
  endLine?: number;
  severity: "critical" | "major" | "minor";
  title: string;
  message: string;
  category: string;
  suggestion?: string;
}

export interface OcrExecutionPort {
  run(input: {
    requestId: string;
    reviewerInput: string;
    signal?: AbortSignal;
  }): Promise<{
    native: OcrNativeDocument;
    baseSha: string;
    mergeBaseSha: string;
    headSha: string;
    requestCount: number;
    diagnostics: string[];
  }>;
}

export interface OcrProfileAResult {
  requestId: string;
  findings: FindingRecord[];
  native: OcrNativeDocument | null;
  nativeComments: readonly unknown[];
  normalized: readonly FindingLike[];
  skipped: readonly { index: number; reason: string }[];
  diagnostics: string[];
  requestCount: number;
  terminalState: string | null;
  outcomeComplete: boolean;
  /** Profile A never produces criterion satisfaction verdicts. */
  assessments: [];
}

function mapCriterion(content: string, inventory: readonly string[]): string | null {
  const matches = content.match(/\bAC-\d+\b/gi);
  if (!matches) return null;
  for (const raw of matches) {
    const id = raw.toUpperCase();
    if (inventory.includes(id)) return id;
  }
  return null;
}

/**
 * Convert pinned-parser/normalizer output into M2 FindingRecords.
 *
 * Native comments are preserved verbatim and separately from the normalized
 * finding. Per-item skips keep the pinned normalizer's reason; they are never
 * silently dropped.
 */
export function mapOcrOutputToFindings(params: {
  nativeComments: readonly { content: string }[];
  normalized: readonly FindingLike[];
  skipped: readonly { index: number; reason: string }[];
  reasons: readonly string[];
  expectedCriterionIds: readonly string[];
}): FindingRecord[] {
  const { nativeComments, normalized, skipped, reasons, expectedCriterionIds } = params;
  const skippedByIndex = new Map(skipped.map((s) => [s.index, s.reason]));
  const findings: FindingRecord[] = [];
  let normalizedCursor = 0;
  for (let i = 0; i < nativeComments.length; i++) {
    const native = nativeComments[i];
    const skipReason = skippedByIndex.get(i);
    if (skipReason !== undefined) {
      findings.push({
        nativeComment: native.content,
        normalizedFinding: null,
        skipped: true,
        skipReason,
        qualityFlags: ["provider_warning", "context_inspection_incomplete"],
        criterionMapping: null,
        references: [],
      });
      continue;
    }
    const nf = normalized[normalizedCursor++];
    if (nf === undefined) {
      findings.push({
        nativeComment: native.content,
        normalizedFinding: null,
        skipped: false,
        skipReason: null,
        qualityFlags: [...reasons],
        criterionMapping: null,
        references: [],
      });
      continue;
    }
    findings.push({
      nativeComment: native.content,
      normalizedFinding: nf.message,
      skipped: false,
      skipReason: null,
      qualityFlags: [...reasons],
      criterionMapping: mapCriterion(nf.message, expectedCriterionIds),
      references: [],
    });
  }
  return findings;
}

/**
 * Execute one Profile A review through the real managed OCR execution port and
 * the pinned parser/normalizer. Dispatch identity is recorded before the OCR
 * process starts, and the process is invoked exactly once (no automatic retry).
 */
export async function runOcrProfileA(params: {
  requestId: string;
  reviewerInput: string;
  execution: OcrExecutionPort;
  parser: OcrParserPort;
  expectedCriterionIds: readonly string[];
  headFiles: { get(path: string): string | undefined };
  assignedPaths?: readonly string[];
  diffPositions?: ReadonlyMap<string, ReadonlyMap<number, number>>;
  dispatchLog: DispatchRecord[];
}): Promise<{ adapter: ProfileAAdapterResult; details: OcrProfileAResult }> {
  assertOcrInputBound(params.reviewerInput);
  let details: OcrProfileAResult | null = null;

  const adapter = await runProfileA({
    requestId: params.requestId,
    body: params.reviewerInput,
    dispatchLog: params.dispatchLog,
    provider: {
      async review({ requestId, body }) {
        assertOcrInputBound(body);
        const run = await params.execution.run({ requestId, reviewerInput: body });
        if (!run.native) {
          throw new Error(`managed OCR produced no native result: ${run.diagnostics.join("; ")}`);
        }
        const parsed = params.parser.parseOcrNativeReviewResult(run.native, {
          baseSha: run.baseSha,
          mergeBaseSha: run.mergeBaseSha,
          headSha: run.headSha,
        });
        const normalized = params.parser.normalizeOcrFindings({
          comments: parsed.comments,
          ...(params.assignedPaths ? { assignedPaths: params.assignedPaths } : {}),
          headFiles: params.headFiles,
          ...(params.diffPositions ? { diffPositions: params.diffPositions } : {}),
        });
        const findings = mapOcrOutputToFindings({
          nativeComments: parsed.comments,
          normalized: normalized.findings,
          skipped: normalized.diagnostics.skipped,
          reasons: normalized.diagnostics.reasons,
          expectedCriterionIds: params.expectedCriterionIds,
        });
        details = {
          requestId,
          findings,
          native: run.native,
          nativeComments: parsed.comments,
          normalized: normalized.findings,
          skipped: normalized.diagnostics.skipped,
          diagnostics: [...run.diagnostics],
          requestCount: run.requestCount,
          terminalState: parsed.manifest.terminalState,
          outcomeComplete: parsed.outcome?.runStopCause === null,
          assessments: [],
        };
        return {
          comments: parsed.comments.map((c) => ({
            path: c.path,
            content: c.content,
            ...(c.startLine !== null ? { line: c.startLine } : {}),
          })),
          findings,
          diagnostics: run.diagnostics,
        };
      },
    },
    normalize: () => ({ normalizedFinding: null, criterionMapping: null, qualityFlags: [] }),
  });

  if (!details) throw new Error("managed OCR adapter completed without details");
  return { adapter, details };
}
