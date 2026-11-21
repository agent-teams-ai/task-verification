/**
 * Shared Evidence Packet types (WP4).
 *
 * Neutral type definitions used by both the evidence packet builder and the
 * deterministic baseline. Intentionally free of any dependency on the WP3
 * Truth loader so the baseline import graph never touches sealed truth
 * artifacts, the anonymization map or salt.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

export const EVIDENCE_SCHEMA_VERSION = "evidence-v1";
export const PACKET_VERSION = "v1";

/** Canonical denied fields from the M2-A oracle manifest (crit-v1, AC-4). */
export const DENIED_FIELDS = ["role", "internal"] as const;

/** Audit event/reason asserted by AC-5. */
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";

export type EvidenceObservation = "pass" | "fail" | "unavailable";
export type EvidenceApplicability = "applicable" | "inapplicable";
export type EvidenceFreshness = "fresh" | "stale";

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
  available?: boolean;
}

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
  observationTime: string | null;
  completeness: "complete" | "partial";
  artifactRefs: string[];
  criterionChecks: Record<string, string[]>;
  evidence: EvidenceItem[];
  generatedAt: string | null;
}
