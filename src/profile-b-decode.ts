/**
 * Profile B provider-output decoding (M2 corrective pass).
 *
 * The integration must preserve what the provider actually returned:
 * criterion associations, polarity, evidence references and explanations. It
 * may validate, resolve and reject that output, but it must never invent a
 * reference or a favorable support judgment on the provider's behalf.
 *
 * Decoding is record-by-record so a malformed record cannot discard the valid
 * records around it: every rejected record keeps its own diagnostics and the
 * raw provider text is retained by the caller.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AdmittedConclusion, AssessmentRecord } from "./result-contract.ts";

export const PROFILE_B_DECODER_VERSION = "profile-b-decode-v1";

const CONCLUSIONS: readonly AdmittedConclusion[] = ["satisfied", "violated", "inconclusive"];

export interface ProfileBRecordDiagnostic {
  index: number;
  criterionId: string | null;
  errors: string[];
  /** The provider record exactly as returned (never rewritten). */
  raw: unknown;
}

export interface DecodedProfileB {
  decoderVersion: string;
  /** Records that were structurally usable, in provider order. */
  assessments: AssessmentRecord[];
  /** Exact provider records, in provider order. */
  rawRecords: unknown[];
  diagnostics: string[];
  recordDiagnostics: ProfileBRecordDiagnostic[];
  malformedCount: number;
  rejectedCount: number;
  duplicateIds: string[];
  unknownIds: string[];
  missingIds: string[];
  /** True when the payload could not be parsed as JSON at all. */
  unparseable: boolean;
}

/**
 * Decode a Profile B response. The provider's `references` and `explanation`
 * are copied verbatim; the decoder never substitutes its own.
 */
export function decodeProfileBAssessments(
  rawText: string,
  expectedCriterionIds: readonly string[],
): DecodedProfileB {
  const diagnostics: string[] = [];
  const recordDiagnostics: ProfileBRecordDiagnostic[] = [];
  const assessments: AssessmentRecord[] = [];
  const rawRecords: unknown[] = [];
  const duplicateIds: string[] = [];
  const unknownIds: string[] = [];
  const seen = new Set<string>();
  let malformedCount = 0;
  let rejectedCount = 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (err) {
    diagnostics.push(`profile B decode failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      decoderVersion: PROFILE_B_DECODER_VERSION,
      assessments: [],
      rawRecords: [],
      diagnostics,
      recordDiagnostics: [],
      malformedCount: 1,
      rejectedCount: 0,
      duplicateIds: [],
      unknownIds: [],
      missingIds: [...expectedCriterionIds],
      unparseable: true,
    };
  }

  const list =
    parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { assessments?: unknown }).assessments)
      ? ((parsed as { assessments: unknown[] }).assessments as unknown[])
      : null;
  if (list === null) {
    diagnostics.push("profile B decode failed: response must contain an assessments array");
    return {
      decoderVersion: PROFILE_B_DECODER_VERSION,
      assessments: [],
      rawRecords: [],
      diagnostics,
      recordDiagnostics: [],
      malformedCount: 1,
      rejectedCount: 0,
      duplicateIds: [],
      unknownIds: [],
      missingIds: [...expectedCriterionIds],
      unparseable: true,
    };
  }

  rawRecords.push(...list);

  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    const errors: string[] = [];
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      malformedCount++;
      recordDiagnostics.push({ index: i, criterionId: null, errors: ["record is not an object"], raw: rec });
      diagnostics.push(`assessments[${i}]: record is not an object`);
      continue;
    }
    const r = rec as Record<string, unknown>;
    const criterionId = typeof r.criterionId === "string" && r.criterionId.trim() !== "" ? r.criterionId : null;

    if (criterionId === null) errors.push("missing or invalid criterionId");
    if (typeof r.outcome !== "string" || !CONCLUSIONS.includes(r.outcome as AdmittedConclusion)) {
      errors.push(`outcome must be one of ${CONCLUSIONS.join(", ")}`);
    }
    const references = Array.isArray(r.references) ? r.references : null;
    if (references === null) errors.push("missing references array");
    else if (!references.every((x) => typeof x === "string")) errors.push("references must be strings");
    if (!("explanation" in r)) errors.push("missing explanation");

    if (errors.length > 0) {
      // Polarity/identity problems make the record unusable; references and
      // explanations are preserved even when incomplete.
      const fatal = errors.some(
        (e) => e.startsWith("missing or invalid criterionId") || e.startsWith("outcome must be"),
      );
      rejectedCount++;
      recordDiagnostics.push({ index: i, criterionId, errors, raw: rec });
      for (const e of errors) diagnostics.push(`assessments[${i}]${criterionId ? ` (${criterionId})` : ""}: ${e}`);
      if (fatal) continue;
    }

    if (criterionId === null) continue;
    if (seen.has(criterionId)) {
      duplicateIds.push(criterionId);
      rejectedCount++;
      recordDiagnostics.push({ index: i, criterionId, errors: ["duplicate criterionId"], raw: rec });
      diagnostics.push(`assessments[${i}] (${criterionId}): duplicate criterionId`);
      continue;
    }
    seen.add(criterionId);
    if (!expectedCriterionIds.includes(criterionId)) {
      unknownIds.push(criterionId);
      diagnostics.push(`assessments[${i}]: criterion ${criterionId} is not in the expected inventory`);
    }

    const explanation =
      typeof r.explanation === "string" ? r.explanation : r.explanation === null ? null : null;

    assessments.push({
      expectedCriterionId: criterionId,
      present: true,
      // The provider's own wording is preserved separately from its polarity.
      originalReportedClaim: typeof r.outcome === "string" ? r.outcome : null,
      admittedConclusion:
        typeof r.outcome === "string" && CONCLUSIONS.includes(r.outcome as AdmittedConclusion)
          ? (r.outcome as AdmittedConclusion)
          : null,
      // References are the provider's; the integration resolves and validates
      // them, and never adds one.
      references: Array.isArray(r.references) ? r.references.filter((x): x is string => typeof x === "string") : [],
      explanation,
      diagnostics: errors,
    });
  }

  const missingIds = expectedCriterionIds.filter((id) => !seen.has(id));
  if (missingIds.length > 0) diagnostics.push(`missing criterion IDs: ${missingIds.join(", ")}`);

  return {
    decoderVersion: PROFILE_B_DECODER_VERSION,
    assessments,
    rawRecords,
    diagnostics,
    recordDiagnostics,
    malformedCount,
    rejectedCount,
    duplicateIds,
    unknownIds,
    missingIds,
    unparseable: false,
  };
}
