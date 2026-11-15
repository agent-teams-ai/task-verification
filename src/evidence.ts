/**
 * Evidence packet builder (WP4).
 *
 * Derived only from committed, sanitized Oracle observation-source artifacts
 * and the anonymization map. Never reads sealed truth artifacts or scorer
 * internals.
 *
 * Each Evidence item's `sourceRef` points to the actual committed observation
 * source (an HTTP response or audit record under `oracle-observations-v1/`),
 * never to a candidate application snapshot, which does not contain HTTP
 * responses or audit records. `sourceDigest` is the SHA-256 of the canonical
 * form of the exact referenced observation object, independently
 * recomputable from the referenced bytes. `observationPayload` embeds the
 * referenced observation so packets are self-contained, while the provenance
 * reference identifies the actual committed source.
 *
 * Observations are derived from actual per-request source data. A missing
 * source record is `unavailable`, never an inferred behavioral `fail`. Only
 * a valid, observed behavioral violation produces `fail`.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnonymizationMap } from "./truth.ts";
import {
  CRITERIA,
  FROZEN_CRITERION_CHECKS,
  checkDefinitionDigest,
} from "./baseline-policy.ts";
import { canonicalDigest, canonicalJson } from "./canonical.ts";
import {
  EVIDENCE_SCHEMA_VERSION,
  PACKET_VERSION,
  type EvidenceItem,
  type EvidencePacket,
  type EvidenceObservation,
  type ObservationPayload,
} from "./evidence-types.ts";
import {
  OBSERVATION_PASS,
  loadObservationSource,
  sourceRefDigest,
} from "./source-ref.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE_DIR = path.join(ROOT, "evidence-v1");

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
  timestamp?: string;
}

export interface BuildPacketOptions {
  candidateId: string;
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

function safeLoad(ref: string): unknown {
  try {
    return loadObservationSource(ref);
  } catch {
    return undefined;
  }
}

export function buildEvidencePacket(options: BuildPacketOptions): EvidencePacket {
  const { candidateId } = options;
  const aliasMap = loadAnonymizationMap() as { mapping: Record<string, string> };
  const anonId = aliasMap.mapping[candidateId];
  if (!anonId) throw new Error(`unknown candidate ${candidateId}`);

  const manifestPath = path.join(ROOT, "candidates", candidateId, "MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    headApplicationDigest: string;
  };
  const headDigest = manifest.headApplicationDigest;

  const evidence: EvidenceItem[] = [];
  let idx = 0;

  for (const cr of CRITERIA) {
    for (const reqId of FROZEN_CRITERION_CHECKS[cr]) {
      if (cr === "AC-1") {
        // Per-request observation: HTTP 200 + matching caller id/email.
        const ref = `oracle-observations-v1:${anonId}/${OBSERVATION_PASS}/requests/${reqId}.json#`;
        const referenced = safeLoad(ref) as { requestId?: string; statusCode?: number; body?: unknown } | undefined;
        const r = referenced as { requestId: string; statusCode: number; body: unknown } | undefined;
        const expectedId =
          reqId === "P-active-a" ? "caller-a" : reqId === "P-active-b" ? "caller-b" : undefined;
        const expectedEmail =
          reqId === "P-active-a" ? "caller-a@example.example" : "caller-b@example.example";

        let observation: EvidenceObservation = "unavailable";
        let payload: ObservationPayload;
        if (r && typeof r.statusCode === "number") {
          const body = r.body as Record<string, unknown> | undefined;
          const ok =
            r.statusCode === 200 &&
            body !== undefined &&
            typeof body === "object" &&
            body !== null &&
            body.id === expectedId &&
            body.email === expectedEmail;
          observation = ok ? "pass" : "fail";
          payload = {
            requestId: r.requestId,
            statusCode: r.statusCode,
            body: r.body,
            profileFieldsPresent: hasProfileFields(r.body),
            available: true,
          };
        } else {
          payload = { requestId: reqId, available: false };
        }

        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "http-response",
          sourceRef: ref,
          sourceDigest: referenced ? sourceRefDigest(ref) : canonicalDigest(payload),
          sourceLocation: `${reqId} response body (id and email)`,
          observation,
          observationPayload: (referenced as ObservationPayload) ?? { requestId: reqId, available: false },
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      } else if (cr === "AC-2" || cr === "AC-3") {
        // Per-request observation: HTTP 401 and no profile fields.
        const ref = `oracle-observations-v1:${anonId}/${OBSERVATION_PASS}/requests/${reqId}.json#`;
        const referenced = safeLoad(ref) as { requestId?: string; statusCode?: number; body?: unknown } | undefined;
        const r = referenced as { requestId: string; statusCode: number; body: unknown } | undefined;

        let observation: EvidenceObservation = "unavailable";
        let payload: ObservationPayload;
        if (r && typeof r.statusCode === "number") {
          const ok = r.statusCode === 401 && hasProfileFields(r.body).length === 0;
          observation = ok ? "pass" : "fail";
          payload = {
            requestId: r.requestId,
            statusCode: r.statusCode,
            body: r.body,
            profileFieldsPresent: hasProfileFields(r.body),
            available: true,
          };
        } else {
          payload = { requestId: reqId, available: false };
        }

        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "http-status",
          sourceRef: ref,
          sourceDigest: referenced ? sourceRefDigest(ref) : canonicalDigest(payload),
          sourceLocation: `${reqId} response status and body fields`,
          observation,
          observationPayload: (referenced as ObservationPayload) ?? { requestId: reqId, available: false },
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      } else if (cr === "AC-4") {
        // Field scan of this specific response for denied fields.
        const ref = `oracle-observations-v1:${anonId}/${OBSERVATION_PASS}/requests/${reqId}.json#`;
        const referenced = safeLoad(ref) as { requestId?: string; statusCode?: number; body?: unknown } | undefined;
        const r = referenced as { requestId: string; statusCode: number; body: unknown } | undefined;

        let observation: EvidenceObservation = "unavailable";
        let payload: ObservationPayload;
        if (r) {
          const denied = hasDeniedFields(r.body);
          observation = denied.length === 0 ? "pass" : "fail";
          payload = {
            requestId: r.requestId,
            body: r.body,
            deniedFieldsPresent: denied,
            available: true,
          };
        } else {
          payload = { requestId: reqId, available: false };
        }

        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "field-scan",
          sourceRef: ref,
          sourceDigest: referenced ? sourceRefDigest(ref) : canonicalDigest(payload),
          sourceLocation: `${reqId} response body (role/internal keys)`,
          observation,
          observationPayload: (referenced as ObservationPayload) ?? { requestId: reqId, available: false },
          provenance: `oracle O-1 pass 1, request ${reqId}`,
          applicability: "applicable",
          freshness: "fresh",
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          version: PACKET_VERSION,
        });
      } else if (cr === "AC-5") {
        // Audit delta: exactly one missing_credential record for P-missing.
        const ref = `oracle-observations-v1:${anonId}/${OBSERVATION_PASS}/audit/P-missing.json#`;
        const referenced = safeLoad(ref) as { requestId?: string; auditRecords?: AuditRecordObservation[] } | undefined;
        const auditRecords = referenced?.auditRecords ?? [];
        const auditAvailable = referenced !== undefined;
        const ok =
          auditAvailable &&
          auditRecords.length === 1 &&
          auditRecords[0]?.event === AUDIT_EVENT_DENIED &&
          auditRecords[0]?.reason === AUDIT_REASON_MISSING_CREDENTIAL;
        const observation: EvidenceObservation = auditAvailable ? (ok ? "pass" : "fail") : "unavailable";
        const payload: ObservationPayload = {
          requestId: "P-missing",
          auditRecords,
          auditRecordCount: auditRecords.length,
          available: auditAvailable,
        };

        evidence.push({
          evidenceId: `EV-${anonId}-${cr}-${reqId}-${idx++}`,
          candidateAnonId: anonId,
          criterionId: cr,
          evidenceType: "audit-delta",
          sourceRef: ref,
          sourceDigest: referenced ? sourceRefDigest(ref) : canonicalDigest(payload),
          sourceLocation: `${reqId} audit delta (exactly one missing_credential record)`,
          observation,
          observationPayload: (referenced as ObservationPayload) ?? { requestId: reqId, available: false },
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

  // Run-level timestamp: latest audit record timestamp, or null (never fabricated).
  const auditTimes: string[] = [];
  for (const e of evidence) {
    if (e.observationPayload.auditRecords) {
      for (const r of e.observationPayload.auditRecords) {
        if (r.timestamp) auditTimes.push(r.timestamp);
      }
    }
  }
  const runTs = auditTimes.length > 0 ? auditTimes.sort()[auditTimes.length - 1] : null;

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
    observationTime: runTs,
    completeness: "complete",
    artifactRefs: [
      `candidate-manifest:${anonId}`,
      `candidate-snapshot:${anonId}`,
      `evidence-v1:${anonId}.json`,
      `oracle-observations-v1:${anonId}`,
    ],
    criterionChecks,
    evidence,
    generatedAt: runTs,
  };

  return packet;
}

/**
 * Recompute an evidence item's source digest from its referenced source bytes
 * and compare it to the recorded sourceDigest. Independent of manifest
 * metadata.
 */
export function verifyItemSourceDigest(item: EvidenceItem): boolean {
  try {
    return item.sourceDigest === sourceRefDigest(item.sourceRef);
  } catch {
    return false;
  }
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
