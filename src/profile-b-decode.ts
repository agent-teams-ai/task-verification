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
 * Duplicate identity is a first-class state, not a decoder diagnostic that is
 * dropped before admission. If two provider records claim the same criterion,
 * BOTH are kept in `assessments` and both carry the same explicit conflict
 * group. Neither is selected as a winner, neither is admitted as an ordinary
 * claim, and the conflict identity travels through the result contract's
 * coverage into the scorer's per-claim and aggregate admission.
 *
 * Exact duplicates and conflicting duplicates are classified separately:
 *
 *   - `identical-duplicate`: every occurrence reports the same conclusion,
 *     references and explanation. Retained verbatim; still not individually
 *     admitted, because the provider asserted the criterion twice and the
 *     contract treats a repeated criterion as an invalid association.
 *   - `conflicting-duplicate`: the occurrences disagree on conclusion,
 *     references or explanation. This is a semantic conflict and is never
 *     reduced to a warning.
 *   - `unclassified-duplicate`: at least one occurrence is unusable, so the
 *     disagreement cannot be characterised. Treated conservatively as a
 *     conflict, because two records claimed the criterion and one of them
 *     cannot be inspected.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

import type {
  AdmittedConclusion,
  AssessmentConflict,
  AssessmentConflictKind,
  AssessmentRecord,
} from "./result-contract.ts";

export const PROFILE_B_DECODER_VERSION = "profile-b-decode-v2";

const CONCLUSIONS: readonly AdmittedConclusion[] = ["satisfied", "violated", "inconclusive"];

export interface ProfileBRecordDiagnostic {
  index: number;
  criterionId: string | null;
  errors: string[];
  /** The provider record exactly as returned (never rewritten). */
  raw: unknown;
  /** Conflict group this record belongs to, when it duplicates a criterion. */
  conflictGroup?: string;
  conflictKind?: AssessmentConflictKind;
}

export interface ProfileBConflictGroup {
  /** Shared group identity every member carries. */
  group: string;
  criterionId: string;
  kind: AssessmentConflictKind;
  /** Provider record positions, in provider order. */
  indexes: number[];
  /** Distinct conclusions observed in the group. */
  conclusions: string[];
  /** Distinct reference lists observed in the group. */
  referenceSets: string[][];
  /** Distinct explanations observed in the group. */
  explanations: (string | null)[];
}

export interface DecodedProfileB {
  decoderVersion: string;
  /**
   * Structurally usable records, in provider order. Duplicate occurrences are
   * INCLUDED and carry an explicit `conflict`; dropping them here is what made
   * the second claim disappear from admission.
   */
  assessments: AssessmentRecord[];
  /** Exact provider records, in provider order (malformed ones included). */
  rawRecords: unknown[];
  diagnostics: string[];
  recordDiagnostics: ProfileBRecordDiagnostic[];
  malformedCount: number;
  rejectedCount: number;
  duplicateIds: string[];
  unknownIds: string[];
  missingIds: string[];
  conflicts: ProfileBConflictGroup[];
  /** True when the payload could not be parsed as JSON at all. */
  unparseable: boolean;
}

function emptyResult(
  diagnostics: string[],
  expectedCriterionIds: readonly string[],
  decoderDiagnostic: string,
): DecodedProfileB {
  diagnostics.push(decoderDiagnostic);
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
    conflicts: [],
    unparseable: true,
  };
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
  const unknownIds: string[] = [];
  let malformedCount = 0;
  let rejectedCount = 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (err) {
    return emptyResult(
      diagnostics,
      expectedCriterionIds,
      `profile B decode failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const list =
    parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { assessments?: unknown }).assessments)
      ? ((parsed as { assessments: unknown[] }).assessments as unknown[])
      : null;
  if (list === null) {
    return emptyResult(
      diagnostics,
      expectedCriterionIds,
      "profile B decode failed: response must contain an assessments array",
    );
  }

  const rawRecords: unknown[] = [...list];

  interface Candidate {
    index: number;
    criterionId: string | null;
    raw: unknown;
    errors: string[];
    /** Identity/polarity problems make the record unusable as a claim. */
    fatal: boolean;
    usable: boolean;
    conclusion: AdmittedConclusion | null;
    references: string[];
    explanation: string | null;
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    const errors: string[] = [];
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
      malformedCount++;
      recordDiagnostics.push({ index: i, criterionId: null, errors: ["record is not an object"], raw: rec });
      diagnostics.push(`assessments[${i}]: record is not an object`);
      candidates.push({
        index: i,
        criterionId: null,
        raw: rec,
        errors: ["record is not an object"],
        fatal: true,
        usable: false,
        conclusion: null,
        references: [],
        explanation: null,
      });
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

    const fatal =
      criterionId === null ||
      typeof r.outcome !== "string" ||
      !CONCLUSIONS.includes(r.outcome as AdmittedConclusion);

    candidates.push({
      index: i,
      criterionId,
      raw: rec,
      errors,
      fatal,
      usable: !fatal,
      conclusion:
        typeof r.outcome === "string" && CONCLUSIONS.includes(r.outcome as AdmittedConclusion)
          ? (r.outcome as AdmittedConclusion)
          : null,
      references: Array.isArray(r.references) ? r.references.filter((x): x is string => typeof x === "string") : [],
      explanation: typeof r.explanation === "string" ? r.explanation : null,
    });
  }

  // --- Duplicate/conflict detection, before anything is filtered ------------
  // Grouping happens over every record that names a criterion, including
  // unusable ones, so a conflict can never be hidden by dropping one member.
  const groupsByCriterion = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.criterionId === null) continue;
    const list = groupsByCriterion.get(c.criterionId) ?? [];
    list.push(c);
    groupsByCriterion.set(c.criterionId, list);
  }

  const duplicateIds: string[] = [];
  const conflicts: ProfileBConflictGroup[] = [];
  const conflictByIndex = new Map<number, AssessmentConflict>();

  for (const [criterionId, members] of groupsByCriterion) {
    if (members.length < 2) continue;
    duplicateIds.push(criterionId);

    const indexes = members.map((m) => m.index).sort((a, b) => a - b);
    const conclusions = [...new Set(members.map((m) => m.conclusion ?? "<unusable>"))];
    const referenceSets = members.map((m) => [...m.references]);
    const explanations = members.map((m) => m.explanation);
    const distinctReferences = new Set(referenceSets.map((r) => JSON.stringify(r)));
    const distinctExplanations = new Set(explanations.map((e) => JSON.stringify(e)));

    let kind: AssessmentConflictKind;
    if (members.some((m) => !m.usable)) kind = "unclassified-duplicate";
    else if (
      conclusions.length === 1 &&
      distinctReferences.size === 1 &&
      distinctExplanations.size === 1
    ) {
      kind = "identical-duplicate";
    } else {
      kind = "conflicting-duplicate";
    }

    const group =
      "cc-" +
      crypto
        .createHash("sha256")
        .update(`${criterionId}\u0000${indexes.join(",")}`)
        .digest("hex")
        .slice(0, 12);

    const reason =
      kind === "identical-duplicate"
        ? `criterion reported ${members.length} times with identical conclusion, references and explanation`
        : kind === "conflicting-duplicate"
          ? `criterion reported ${members.length} times with conflicting conclusion, references or explanation`
          : `criterion reported ${members.length} times and at least one record is unusable, so the disagreement cannot be classified`;

    for (const m of members) {
      conflictByIndex.set(m.index, {
        group,
        kind,
        occurrences: members.length,
        indexes,
        reason,
      });
    }
    conflicts.push({
      group,
      criterionId,
      kind,
      indexes,
      conclusions,
      referenceSets,
      explanations,
    });

    diagnostics.push(
      `assessments: criterion ${criterionId} reported ${members.length} times (${kind}, group ${group}); no occurrence is admitted`,
    );
  }

  // --- Emit preserved assessments in provider order -------------------------
  const assessments: AssessmentRecord[] = [];
  for (const c of candidates) {
    const conflict = conflictByIndex.get(c.index);
    if (!c.usable) {
      // Identity/polarity problems make the record unusable as a claim; it is
      // retained in rawRecords and recordDiagnostics, and any conflict it takes
      // part in is preserved above.
      rejectedCount++;
      recordDiagnostics.push({
        index: c.index,
        criterionId: c.criterionId,
        errors: c.errors,
        raw: c.raw,
        ...(conflict ? { conflictGroup: conflict.group, conflictKind: conflict.kind } : {}),
      });
      for (const e of c.errors) {
        diagnostics.push(`assessments[${c.index}]${c.criterionId ? ` (${c.criterionId})` : ""}: ${e}`);
      }
      continue;
    }
    if (c.criterionId === null) continue;

    const recordErrors = [...c.errors];
    if (conflict) {
      recordErrors.push(`duplicate criterionId (${conflict.kind}, group ${conflict.group})`);
      rejectedCount++;
      recordDiagnostics.push({
        index: c.index,
        criterionId: c.criterionId,
        errors: recordErrors,
        raw: c.raw,
        conflictGroup: conflict.group,
        conflictKind: conflict.kind,
      });
    } else if (c.errors.length > 0) {
      // Non-fatal shape problems are preserved as diagnostics on a usable claim.
      rejectedCount++;
      recordDiagnostics.push({ index: c.index, criterionId: c.criterionId, errors: c.errors, raw: c.raw });
      for (const e of c.errors) diagnostics.push(`assessments[${c.index}] (${c.criterionId}): ${e}`);
    }

    if (!expectedCriterionIds.includes(c.criterionId)) {
      if (!unknownIds.includes(c.criterionId)) unknownIds.push(c.criterionId);
      diagnostics.push(`assessments[${c.index}]: criterion ${c.criterionId} is not in the expected inventory`);
    }

    assessments.push({
      expectedCriterionId: c.criterionId,
      present: true,
      // The provider's own wording is preserved separately from its polarity.
      originalReportedClaim: c.conclusion,
      admittedConclusion: c.conclusion,
      // References are the provider's; the integration resolves and validates
      // them, and never adds one.
      references: [...c.references],
      explanation: c.explanation,
      diagnostics: recordErrors,
      ...(conflict ? { conflict } : {}),
    });
  }

  const presentIds = new Set(candidates.filter((c) => c.criterionId !== null).map((c) => c.criterionId as string));
  const missingIds = expectedCriterionIds.filter((id) => !presentIds.has(id));
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
    conflicts,
    unparseable: false,
  };
}
