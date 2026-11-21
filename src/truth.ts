/**
 * Truth-v1 loader and validator (WP3).
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TRUTH_DIR = path.join(ROOT, "truth");
export const TRUTH_PATH = path.join(TRUTH_DIR, "truth-v1.json");
export const ANON_MAP_PATH = path.join(TRUTH_DIR, "anonymization-map.json");
export const SALT_PATH = path.join(TRUTH_DIR, "salt.txt");
export const MANIFEST_PATH = path.join(TRUTH_DIR, "version-manifest.json");

export const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;
export const CANDIDATES = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;

export interface TruthV1 {
  truthId: string;
  version: string;
  criteriaRevision: string;
  oracleId: string;
  oracleVersion: string;
  candidateOutcomes: Record<string, Record<string, boolean>>;
  assertionReferences: Record<string, string[]>;
  candidateHeadDigests: Record<string, string>;
  scope: string;
  publicArtifactPolicy: string;
}

export function loadTruth(): TruthV1 {
  return JSON.parse(fs.readFileSync(TRUTH_PATH, "utf8")) as TruthV1;
}

export function loadAnonymizationMap(): { mapping: Record<string, string> } {
  return JSON.parse(fs.readFileSync(ANON_MAP_PATH, "utf8")) as { mapping: Record<string, string> };
}

export function loadSalt(): string {
  return fs.readFileSync(SALT_PATH, "utf8").trim();
}

export function validateTruth(truth: TruthV1): string[] {
  const errors: string[] = [];
  if (truth.truthId !== "truth-v1") errors.push("bad truthId");
  if (truth.version !== "v1") errors.push("bad version");
  if (truth.criteriaRevision !== "crit-v1") errors.push("bad criteriaRevision");
  for (const c of CANDIDATES) {
    if (!truth.candidateOutcomes[c]) errors.push(`missing candidate ${c}`);
    else {
      for (const cr of CRITERIA) {
        if (typeof truth.candidateOutcomes[c][cr] !== "boolean") errors.push(`missing outcome ${c}/${cr}`);
      }
    }
  }
  for (const cr of CRITERIA) {
    if (!Array.isArray(truth.assertionReferences[cr])) errors.push(`missing assertion refs ${cr}`);
  }
  return errors;
}

/** Independent validation against M2-A oracle receipts on disk. */
export function validateTruthAgainstOracle(receiptsDir: string): string[] {
  const errors: string[] = [];
  const truth = loadTruth();
  for (const c of CANDIDATES) {
    const receiptPath = path.join(receiptsDir, `${c}-pass1.json`);
    if (!fs.existsSync(receiptPath)) { errors.push(`missing receipt ${c}`); continue; }
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as { assertions: Record<string, { passed: boolean }> };
    for (const cr of CRITERIA) {
      const oraclePassed = receipt.assertions[cr]?.passed;
      if (typeof oraclePassed !== "boolean") { errors.push(`no oracle assertion ${c}/${cr}`); continue; }
      if (oraclePassed !== truth.candidateOutcomes[c][cr]) {
        errors.push(`mismatch ${c}/${cr}: oracle=${oraclePassed} truth=${truth.candidateOutcomes[c][cr]}`);
      }
    }
  }
  return errors;
}
