/**
 * Evidence packet builder (WP4).
 *
 * Derived only from permitted experimental artifacts and actual oracle
 * observations. Never reads sealed truth artifacts or scorer internals.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnonymizationMap } from "./truth.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE_DIR = path.join(ROOT, "evidence-v1");
export const EVIDENCE_SCHEMA_VERSION = "evidence-v1";

export type EvidenceObservation = "pass" | "fail" | "unavailable";
export type EvidenceApplicability = "applicable" | "inapplicable";
export type EvidenceFreshness = "fresh" | "stale";

export interface EvidenceItem {
  evidenceId: string;
  candidateAnonId: string;
  criterionId: string;
  evidenceType: string;
  sourceRef: string;
  sourceDigest: string;
  sourceLocation: string;
  observation: EvidenceObservation;
  provenance: string;
  applicability: EvidenceApplicability;
  freshness: EvidenceFreshness;
  schemaVersion: string;
  version: string;
}

export interface EvidencePacket {
  packetId: string;
  schemaVersion: string;
  version: string;
  producer: string;
  candidateAnonId: string;
  candidateSnapshotDigest: string;
  runtime: string;
  checkDefinitionDigest: string;
  inputsScope: string;
  environment: string;
  observationTime: string;
  completeness: "complete" | "partial";
  artifactRefs: string[];
  criterionChecks: Record<string, string[]>;
  evidence: EvidenceItem[];
  generatedAt: string;
}

function sha256Text(t: string): string {
  return crypto.createHash("sha256").update(t).digest("hex");
}

const CRITERIA = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"] as const;

/** Criterion -> required request observations (applicability mapping). */
export const CRITERION_CHECKS: Record<string, string[]> = {
  "AC-1": ["P-active-a", "P-active-b"],
  "AC-2": ["P-missing"],
  "AC-3": ["P-revoked"],
  "AC-4": ["P-active-a", "P-active-b", "P-missing", "P-revoked"],
  "AC-5": ["P-missing"],
};

export interface BuildPacketOptions {
  candidateId: string;
  receiptsDir?: string;
}

export function buildEvidencePacket(options: BuildPacketOptions): EvidencePacket {
  const { candidateId } = options;
  const receiptsDir = options.receiptsDir ?? path.join(ROOT, ".oracle-receipts");
  const anonMap = loadAnonymizationMap() as { mapping: Record<string, string> };
  const anonId = anonMap.mapping[candidateId];
  if (!anonId) throw new Error(`unknown candidate ${candidateId}`);

  const manifestPath = path.join(ROOT, "candidates", candidateId, "MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    headApplicationDigest: string;
  };
  const headDigest = manifest.headApplicationDigest;

  // Use pass-1 receipt for observations.
  const receiptPath = path.join(receiptsDir, `${candidateId}-pass1.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as {
    requests: { requestId: string; statusCode: number; body: unknown }[];
    auditDeltas: Record<string, { event: string; reason: string }[]>;
    assertions: Record<string, { passed: boolean; detail: string }>;
  };

  const reqById = new Map(receipt.requests.map((r) => [r.requestId, r]));
  const auditMissing = receipt.auditDeltas["P-missing"] ?? [];

  const evidence: EvidenceItem[] = [];
  let idx = 0;
  for (const cr of CRITERIA) {
    for (const reqId of CRITERION_CHECKS[cr]) {
      const r = reqById.get(reqId);
      // Determine observation: for AC-4 field scan uses all responses; mark pass/fail per assertion.
      const assertionPassed = receipt.assertions[cr]?.passed === true;
      // Per-request observation: unavailable if request missing
      let observation: EvidenceObservation = "unavailable";
      if (r) {
        // A request observation is "pass" if the criterion assertion passed for its required request set; but evidence item records request-level outcome.
        // We record the assertion-level pass/fail replicated per required request for traceability.
        observation = assertionPassed ? "pass" : "fail";
      }
      const srcRef = `candidates/${candidateId}/src/app.ts`;
      const item: EvidenceItem = {
        evidenceId: `EV-${candidateId}-${cr}-${reqId}-${idx++}`,
        candidateAnonId: anonId,
        criterionId: cr,
        evidenceType: "http-observation",
        sourceRef: srcRef,
        sourceDigest: manifest.headApplicationDigest,
        sourceLocation: `${reqId} response`,
        observation,
        provenance: `oracle O-1 pass 1, request ${reqId}`,
        applicability: "applicable",
        freshness: "fresh",
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        version: "v1",
      };
      // Special: audit evidence for AC-5
      if (cr === "AC-5" && reqId === "P-missing") {
        item.evidenceType = "audit-observation";
        item.sourceLocation = "P-missing audit delta";
        const ok = auditMissing.length === 1 && auditMissing[0]?.event === "profile.access.denied" && auditMissing[0]?.reason === "missing_credential";
        item.observation = ok ? "pass" : "fail";
      }
      // AC-4 field scan: observation based on assertion
      if (cr === "AC-4") {
        item.evidenceType = "field-scan";
        item.sourceLocation = "all four responses";
      }
      // AC-2/AC-3 status check
      if (cr === "AC-2" || cr === "AC-3") {
        item.evidenceType = "http-status";
      }
      if (cr === "AC-1") {
        item.evidenceType = "http-body";
      }
      evidence.push(item);
    }
  }

  const criterionChecks: Record<string, string[]> = {};
  for (const cr of CRITERIA) {
    criterionChecks[cr] = evidence.filter((e) => e.criterionId === cr).map((e) => e.evidenceId);
  }

  const packet: EvidencePacket = {
    packetId: `packet-${anonId}`,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    version: "v1",
    producer: "oracle-O-1",
    candidateAnonId: anonId,
    candidateSnapshotDigest: headDigest,
    runtime: "node-24.13.1",
    checkDefinitionDigest: sha256Text(JSON.stringify(CRITERION_CHECKS)),
    inputsScope: "candidate application snapshot + oracle observations",
    environment: "local",
    observationTime: new Date().toISOString(),
    completeness: "complete",
    artifactRefs: [`candidates/${candidateId}/MANIFEST.json`, `.oracle-receipts/${candidateId}-pass1.json`],
    criterionChecks,
    evidence,
    generatedAt: new Date().toISOString(),
  };

  return packet;
}

export function writeEvidencePacket(candidateId: string, outDir?: string): string {
  const dir = outDir ?? EVIDENCE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const packet = buildEvidencePacket({ candidateId });
  const anonMap = loadAnonymizationMap() as { mapping: Record<string, string> };
  const anonId = anonMap.mapping[candidateId];
  const file = path.join(dir, `${anonId}.json`);
  fs.writeFileSync(file, JSON.stringify(packet, null, 2) + "\n", "utf8");
  return file;
}

export function writeAllEvidencePackets(outDir?: string): string[] {
  const dir = outDir ?? EVIDENCE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const ids = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"];
  return ids.map((id) => writeEvidencePacket(id, dir));
}
