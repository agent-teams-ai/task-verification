/**
 * Reviewer adapter boundaries (WP7/WP8).
 *
 * Thin, model-free adapters that sit at the injected provider boundary. They do
 * not know about any real provider, credential or Gateway. The caller injects a
 * port; these adapters record request identity before dispatch, enforce exactly
 * one dispatch (no automatic retry), and map the raw response to contract
 * records. Profile A returns native comments plus normalization/skip decisions;
 * Profile B returns decoded assessments.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AssessmentRecord, FindingRecord } from "./result-contract.ts";

export interface DispatchRecord {
  requestId: string;
  profile: "A" | "B";
  dispatchedAt: number;
}

/** Injected Profile B provider port. Called at most once per invocation. */
export interface ProfileBProviderPort {
  generate(input: { requestId: string; body: string; signal?: AbortSignal }): Promise<{
    text: string;
    observedModel: string | null;
  }>;
}

export interface ProfileBAdapterResult {
  requestId: string;
  rawText: string;
  observedModel: string | null;
  assessments: AssessmentRecord[];
  diagnostics: string[];
  dispatches: DispatchRecord[];
}

/**
 * Run one Profile B generation. Identity is recorded before dispatch; the
 * provider is invoked exactly once; a decode failure is a diagnostic, never a
 * retry and never an invented semantic verdict.
 */
export async function runProfileB(params: {
  requestId: string;
  body: string;
  provider: ProfileBProviderPort;
  decode: (text: string) => AssessmentRecord[];
  dispatchLog: DispatchRecord[];
  now?: () => number;
  signal?: AbortSignal;
  /**
   * Dispatch-boundary hook. Invoked after the request identity is fixed and
   * BEFORE the provider is called, so a caller can verify that this attempt is
   * already durably persisted. If it throws, nothing is dispatched.
   */
  beforeDispatch?: (dispatch: DispatchRecord) => void | Promise<void>;
}): Promise<ProfileBAdapterResult> {
  const now = params.now ?? Date.now;
  // Identity recorded before dispatch.
  const dispatch: DispatchRecord = { requestId: params.requestId, profile: "B", dispatchedAt: now() };
  params.dispatchLog.push(dispatch);
  if (params.beforeDispatch) await params.beforeDispatch(dispatch);

  const out = await params.provider.generate({
    requestId: params.requestId,
    body: params.body,
    signal: params.signal,
  });

  const diagnostics: string[] = [];
  let assessments: AssessmentRecord[] = [];
  try {
    assessments = params.decode(out.text);
  } catch (err) {
    diagnostics.push(`profile B decode failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    requestId: params.requestId,
    rawText: out.text,
    observedModel: out.observedModel,
    assessments,
    diagnostics,
    dispatches: [dispatch],
  };
}

/** One native OCR comment as returned by the managed reviewer. */
export interface NativeComment {
  path: string;
  line?: number;
  rule?: string;
  content: string;
  skipped?: boolean;
  skipReason?: string;
}

/** Injected Profile A OCR port. Called at most once per invocation. */
export interface ProfileAProviderPort {
  review(input: { requestId: string; body: string }): Promise<{
    comments: NativeComment[];
    /**
     * Optional fully-normalized findings produced by the real OCR consumer
     * adapter (pinned parser + normalizer). When present they are used
     * verbatim; the adapter does not re-normalize or invent verdicts.
     */
    findings?: FindingRecord[];
    diagnostics?: string[];
  }>;
}

export interface ProfileAAdapterResult {
  requestId: string;
  findings: FindingRecord[];
  dispatches: DispatchRecord[];
  diagnostics: string[];
}

/**
 * Run one Profile A review. Native comments are preserved verbatim in
 * `nativeComment`; normalization, skipping and criterion mapping are explicit
 * per finding. No B-style satisfied/violated verdict is produced here.
 */
export async function runProfileA(params: {
  requestId: string;
  body: string;
  provider: ProfileAProviderPort;
  normalize: (comment: NativeComment) => { normalizedFinding: string | null; criterionMapping: string | null; qualityFlags: string[] };
  dispatchLog: DispatchRecord[];
  now?: () => number;
  /**
   * Dispatch-boundary hook. Invoked after the request identity is fixed and
   * BEFORE the OCR process is started, so a caller can verify that this attempt
   * is already durably persisted. If it throws, nothing is dispatched.
   */
  beforeDispatch?: (dispatch: DispatchRecord) => void | Promise<void>;
}): Promise<ProfileAAdapterResult> {
  const now = params.now ?? Date.now;
  const dispatch: DispatchRecord = { requestId: params.requestId, profile: "A", dispatchedAt: now() };
  params.dispatchLog.push(dispatch);
  if (params.beforeDispatch) await params.beforeDispatch(dispatch);

  const out = await params.provider.review({ requestId: params.requestId, body: params.body });
  if (out.findings !== undefined) {
    return {
      requestId: params.requestId,
      findings: out.findings,
      dispatches: [dispatch],
      diagnostics: [...(out.diagnostics ?? [])],
    };
  }

  const findings: FindingRecord[] = [];
  const diagnostics: string[] = [...(out.diagnostics ?? [])];

  for (const c of out.comments) {
    const skipped = c.skipped === true;
    const norm = skipped
      ? { normalizedFinding: null, criterionMapping: null, qualityFlags: [] }
      : params.normalize(c);
    findings.push({
      nativeComment: c.content,
      normalizedFinding: norm.normalizedFinding,
      skipped,
      skipReason: skipped ? c.skipReason ?? "skipped by provider" : null,
      qualityFlags: norm.qualityFlags,
      criterionMapping: norm.criterionMapping,
      references: [],
    });
    if (skipped) diagnostics.push(`skipped finding: ${c.content}`);
  }

  return { requestId: params.requestId, findings, dispatches: [dispatch], diagnostics };
}