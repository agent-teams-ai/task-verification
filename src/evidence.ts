/**
 * Evidence packet builder (WP4).
 *
 * Derived only from permitted experimental artifacts and actual oracle
 * observations. Never reads sealed truth artifacts or scorer internals.
 *
 * Each committed packet is self-contained and factual: it embeds the actual
 * per-request observation payload so reviewers do not need raw oracle
 * receipts (which remain outside reviewer access). Per-item source references
 * use the approved anonymized candidate identity and a documented canonical
 * observation representation whose digest is recomputed and verified
 * independently of any manifest metadata.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnonymizationMap } from "./truth.ts";
import {
  CRITERIA,
  FROZEN_CRITERION_CHECKS,
  checkDefinitionDigest,
  type EvidenceApplicability,
  type EvidenceFreshness,
} from "./baseline-policy.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE_DIR = path.join(ROOT, "evidence-v1");
export const EVIDENCE_SCHEMA_VERSION = "evidence-v1";

export const PACKET_VERSION = "v1";

/** Canonical denied fields from the M2-A oracle manifest (crit-v1, AC-4). */
export const DENIED_FIELDS = ["role", "internal"] as const;

/** Audit event/reason asserted by AC-5. */
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";

export interface RequestObservation {
  requestId: string;
  statusCode: number;
  body: unknown;
}

export interface AuditRecordObservation {
  event: string;
  reason: string;
  path: string;
  tokenPresent: boolean;
  callerId?: string;
  timestamp: string;
}

export interface ObservationPayload {
  requestId?: string;
  statusCode?: number;
  body?: unknown;
  deniedFieldsPresent?: string[];
  profileFieldsPresent?: string[];
  auditRecords?: AuditRecordObservation[];
  auditRecordCount?: number;
  fieldScanRequests?: string[];
  timestamp?: string;
}

export type EvidenceObservation = "pass" | "fail" | "unavailable";

export interface EvidenceItem {
  evidenceId: string;
  candidateAnonId: string;
  criterionId: string;
  evidenceType: string;
  sourceRef: string;
  sourceDigest: string;
  sourceLocation: string;
  observation: EvidenceObservation;
  observationPayload: ObservationPayload;
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

/** Canonical JSON with sorted keys for stable serialization and digesting. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort(), 2);
}

/** Digest of a canonical observation payload (explicit observation representation). */
function observationDigest(payload: ObservationPayload): string {
  return sha256Text(canonicalJson(payload));
}

/**
 * Anonymous logical reference to the candidate snapshot artifact under
 * observation. Resolves via the anonymization map to the committed candidate
 * directory; contains no raw candidate ID.
 */
function candidateSnapshotRef(anonId: string, suffix: string): string {
  return `candidate-snapshot:${anonId}#${suffix}`;
}

/** Deterministic temporal metadata derived from observations, not wall clock. */
function observationTimestamp(receipt: {
  auditDeltas: Record<string, AuditRecordObservation[]>;
}): string {
  const missing = receipt.auditDeltas["P-missing"] ?? [];
  if (missing.length > 0 && missing[0]?.timestamp) return missing[0].timestamp;
  return "1970-01-01T00:00:00Z";
}

function hasDeniedFields(body: unknown): string[] {
  const found: string[] = [];
  if (body === null || typeof body !== "object") return found;
  const obj = body as Record<string, unknown>;
  for (const field of DENIED_FIELDS) {
    if (field in obj) found.push(field);
  }
  return found;
}

function hasProfileFields(body: unknown): string[] {
  const found: string[] = [];
  if (body === null || typeof body !== "object") return found;
  const obj = body as Record<string, unknown>;
  for (const field of ["id", "email", "role", "internal"]) {
    if (field in obj) found.push(field);
  }
  return found;
}

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

  const receiptPath = path.join(receiptsDir, `${candidateId}-pass1.json`);
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`oracle receipt not found: ${receiptPath}`);
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as {
    requests: RequestObservation[];
    auditDeltas: Record<string, AuditRecordObservation[]>;
    assertions: Record<string, { passed: boolean; detail: string }>;
  };

  const reqById = new Map(receipt.requests.map((r) => [r.requestId, r]));
  const auditMissing = receipt.auditDeltas["P-missing"] ?? [];
  const obsTime = observationTimestamp(receipt);

  const evidence: EvidenceItem[] = [];
  let idx = 0;

  for (const cr of CRITERIA) {
    for (const reqId of FROZEN_CRITERION_CHECKS[cr]) {
      const r = reqById.get(reqId);

      if (cr === "AC-1") {
        // Per-request observation: HTTP 200 + matching caller id/email.
        const body = r?.body as Record<string, unknown> | undefined;
        const expectedId =
          reqId === "P-active-a" ? "caller-a" : reqId === "P-active-b" ? "caller-b" : undefined;
        const expectedEmail =
          reqId === "P-active-a" ? "caller-a@example.example" : "caller-b@example.example";
        const ok =
          r !== undefined &&
          r.statusCode === 200 &&
          body !== undefined &&
          typeof body === "object" &&
          body !== null &&
          body.id === expectedId &&
          body.email === expectedEmail;
        const payload: ObservationPayload = {
          requestId: reqId,
          statusCode: r?.statusCode,
          body: r?.body,
          profileFieldsPresent: hasProfileFields(r?.body),
          timestamp: obsTime,
        };
        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "http-response",
          sourceRef: candidateSnapshotRef(anonId, `request/${reqId}/response`),
          sourceDigest: observationDigest(payload),
          sourceLocation: `${reqId} response body (id and email)`,
          observation: ok ? "pass" : "fail",
          observationPayload: payload,
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      } else if (cr === "AC-2" || cr === "AC-3") {
        // Per-request observation: HTTP 401 and no profile fields.
        const ok =
          r !== undefined &&
          r.statusCode === 401 &&
          hasProfileFields(r.body).length === 0;
        const payload: ObservationPayload = {
          requestId: reqId,
          statusCode: r?.statusCode,
          body: r?.body,
          profileFieldsPresent: hasProfileFields(r?.body),
          timestamp: obsTime,
        };
        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "http-status",
          sourceRef: candidateSnapshotRef(anonId, `request/${reqId}/response`),
          sourceDigest: observationDigest(payload),
          sourceLocation: `${reqId} response status and body fields`,
          observation: ok ? "pass" : "fail",
          observationPayload: payload,
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      } else if (cr === "AC-4") {
        // Field scan of this specific response for denied fields.
        const denied = r ? hasDeniedFields(r.body) : [];
        const ok = r !== undefined && denied.length === 0;
        const payload: ObservationPayload = {
          requestId: reqId,
          body: r?.body,
          deniedFieldsPresent: denied,
          timestamp: obsTime,
        };
        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "field-scan",
          sourceRef: candidateSnapshotRef(anonId, `request/${reqId}/response`),
          sourceDigest: observationDigest(payload),
          sourceLocation: `${reqId} response body (role/internal keys)`,
          observation: ok ? "pass" : "fail",
          observationPayload: payload,
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      } else if (cr === "AC-5") {
        // Audit delta: exactly one missing_credential record for P-missing.
        const ok =
          auditMissing.length === 1 &&
          auditMissing[0]?.event === AUDIT_EVENT_DENIED &&
          auditMissing[0]?.reason === AUDIT_REASON_MISSING_CREDENTIAL;
        const payload: ObservationPayload = {
          requestId: "P-missing",
          auditRecords: auditMissing,
          auditRecordCount: auditMissing.length,
          timestamp: obsTime,
        };
        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "audit-delta",
          sourceRef: candidateSnapshotRef(anonId, `request/${reqId}/audit-delta`),
          sourceDigest: observationDigest(payload),
          sourceLocation: `${reqId} audit delta (exactly one missing_credential record)`,
          observation: ok ? "pass" : "fail",
          observationPayload: payload,
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      }
    }
  }

  const criterionChecks: Record<string, string[]> = {};
  for (const cr of CRITERIA) {
    criterionChecks[cr] = evidence.filter((e) => e.criterionId === cr).map((e) => e.evidenceId);
  }

  const temporal = obsTime;
  const packet: EvidencePacket = {
    packetId: `packet-${anonId}`,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    version: PACKET_VERSION,
    producer: "oracle-O-1",
    candidateAnonId: anonId,
    candidateSnapshotDigest: headDigest,
    runtime: "node-24.13.1",
    checkDefinitionDigest: checkDefinitionDigest(),
    inputsScope: "candidate application snapshot + oracle observations",
    environment: "local",
    observationTime: temporal,
    completeness: "complete",
    artifactRefs: [
      `candidate-manifest:${anonId}`,
      `candidate-snapshot:${anonId}`,
      `evidence-v1:${anonId}.json`,
    ],
    criterionChecks,
    evidence,
    generatedAt: temporal,
  };

  return packet;
}

/**
 * Recompute an evidence item's source digest from its embedded observation
 * payload and compare it to the recorded sourceDigest. This is the independent
 * hash validation: it hashes the actual observation representation, not
 * manifest metadata.
 */
export function verifyItemSourceDigest(item: EvidenceItem): boolean {
  return item.sourceDigest === observationDigest(item.observationPayload);
}

/**
 * Canonical packet form with volatile operational metadata stripped, used for
 * byte-stable reproducibility comparison across independent regenerations.
 */
export function canonicalPacketJson(packet: EvidencePacket): string {
  const clone = JSON.parse(JSON.stringify(packet)) as EvidencePacket;
  delete (clone as Partial<EvidencePacket>).generatedAt;
  delete (clone as Partial<EvidencePacket>).observationTime;
  return canonicalJson(clone);
}

export function writeEvidencePacket(candidateId: string, outDir?: string): string {
  const dir = outDir ?? EVIDENCE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const packet = buildEvidencePacket({ candidateId });
  const file = path.join(dir, `${packet.candidateAnonId}.json`);
  fs.writeFileSync(file, JSON.stringify(packet, null, 2) + "\n", "utf8");
  return file;
}

export function writeAllEvidencePackets(outDir?: string): string[] {
  const dir = outDir ?? EVIDENCE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const ids = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"];
  return ids.map((id) => writeEvidencePacket(id, dir));
}

export function evidencePacketPath(anonId: string, dir?: string): string {
  return path.join(dir ?? EVIDENCE_DIR, `${anonId}.json`);
}
