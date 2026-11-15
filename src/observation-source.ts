/**
 * Oracle observation-source artifacts (WP4).
 *
 * Committed, sanitized observation-source artifacts derived from the retained
 * immutable M2-A oracle receipts. Each Evidence item's `sourceRef` points to
 * one of these artifacts (the actual HTTP response or audit record), never to
 * a candidate application snapshot, which does not contain HTTP responses or
 * audit records.
 *
 * Artifact layout (committed, resolvable from a clean checkout):
 *
 *   oracle-observations-v1/<anonymized-candidate>/pass1/requests/<requestId>.json
 *   oracle-observations-v1/<anonymized-candidate>/pass1/audit/<requestId>.json
 *   oracle-observations-v1/manifest.json
 *
 * Request files contain `{requestId, statusCode, body}`. Audit files contain
 * `{requestId, auditRecords: [...]}`. Raw candidate IDs (`S1-C1`..`S1-C4`)
 * never appear; only the approved `S1-FIX-<12 hex>` aliases are used. No
 * ground-truth labels, scorer internals, defect explanations or
 * candidate-class descriptions are included.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnonymizationMap } from "./truth.ts";
import { canonicalDigest } from "./canonical.ts";
import type { RequestObservation, AuditRecordObservation } from "./evidence-types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OBSERVATION_SOURCE_DIR = path.join(ROOT, "oracle-observations-v1");
export const OBSERVATION_SOURCE_SCHEMA_VERSION = "observation-source-v1";
export const OBSERVATION_PASS = "pass1";

export interface ObservationSourceManifest {
  schemaVersion: string;
  version: string;
  producer: string;
  source: string; // "m2-a-oracle-receipts pass 1"
  candidates: Record<string, { alias: string; checksums: Record<string, string> }>;
  generatedAt: string | null;
}

/** Parse a sourceRef into its components.
 * Format: oracle-observations-v1:<alias>/pass1/requests/<requestId>.json#
 *         oracle-observations-v1:<alias>/pass1/audit/<requestId>.json#
 */
export interface ParsedSourceRef {
  kind: "request" | "audit";
  alias: string;
  pass: string;
  requestId: string;
  filePath: string;
  jsonPointer: string;
}

export function parseSourceRef(ref: string): ParsedSourceRef {
  if (typeof ref !== "string" || !ref.startsWith("oracle-observations-v1:")) {
    throw new Error(`unsupported sourceRef scheme: ${ref}`);
  }
  const withoutScheme = ref.slice("oracle-observations-v1:".length);
  const [location, jsonPointer = "#"] = withoutScheme.split("#");
  const parts = location.split("/");
  // Expected: <alias>/pass1/<kind>/<requestId>.json
  if (parts.length !== 4) {
    throw new Error(`malformed sourceRef location: ${location}`);
  }
  const [alias, pass, kindDir, fileName] = parts;
  if (pass !== OBSERVATION_PASS) {
    throw new Error(`unsupported observation pass: ${pass}`);
  }
  let kind: "request" | "audit";
  if (kindDir === "requests") kind = "request";
  else if (kindDir === "audit") kind = "audit";
  else throw new Error(`unsupported source kind: ${kindDir}`);
  const requestId = fileName.replace(/\.json$/, "");
  if (!requestId) throw new Error(`missing requestId in sourceRef: ${ref}`);
  return { kind, alias, pass, requestId, filePath: path.join("oracle-observations-v1", location), jsonPointer };
}

export function observationSourceRoot(): string {
  return OBSERVATION_SOURCE_DIR;
}

export function candidateSourceDir(alias: string): string {
  return path.join(OBSERVATION_SOURCE_DIR, alias);
}

export function passDir(alias: string, pass: string): string {
  return path.join(candidateSourceDir(alias), pass);
}

export function requestsDir(alias: string, pass: string): string {
  return path.join(passDir(alias, pass), "requests");
}

export function auditsDir(alias: string, pass: string): string {
  return path.join(passDir(alias, pass), "audit");
}

export function requestSourcePath(alias: string, pass: string, requestId: string): string {
  return path.join(requestsDir(alias, pass), `${requestId}.json`);
}

export function auditSourcePath(alias: string, pass: string, requestId: string): string {
  return path.join(auditsDir(alias, pass), `${requestId}.json`);
}

export function manifestPath(): string {
  return path.join(OBSERVATION_SOURCE_DIR, "manifest.json");
}

/** Apply a simple JSON Pointer (RFC 6902) to a value. "#" means the whole value. */
export function applyJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "#") return value;
  const token = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  if (token === "") return value;
  const keys = token.split("/").map((k) =>
    k.replace(/~1/g, "/").replace(/~0/g, "~")
  );
  let current: unknown = value;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`cannot traverse JSON pointer ${pointer} at key ${key}`);
    }
    current = (current as Record<string, unknown>)[key];
    if (current === undefined) {
      throw new Error(`JSON pointer ${pointer} references undefined key ${key}`);
    }
  }
  return current;
}

/** Digest of the exact observation object referenced by a sourceRef. */
export function sourceRefDigest(ref: string): string {
  const parsed = parseSourceRef(ref);
  const file = fs.readFileSync(path.join(ROOT, parsed.filePath), "utf8");
  const doc = JSON.parse(file) as unknown;
  const referenced = applyJsonPointer(doc, parsed.jsonPointer);
  return canonicalDigest(referenced);
}

/** Load and resolve the observation object referenced by a sourceRef. */
export function loadObservationSource(ref: string): unknown {
  const parsed = parseSourceRef(ref);
  const file = fs.readFileSync(path.join(ROOT, parsed.filePath), "utf8");
  const doc = JSON.parse(file) as unknown;
  return applyJsonPointer(doc, parsed.jsonPointer);
}

/** Build sanitized observation-source artifacts from M2-A oracle receipts. */
export interface BuildObservationSourcesOptions {
  receiptsDir: string;
  aliasFor: (candidateId: string) => string;
}

export function buildObservationSources(options: BuildObservationSourcesOptions): string[] {
  const { receiptsDir, aliasFor } = options;
  const candidateIds = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;
  const requestIds = ["P-active-a", "P-active-b", "P-missing", "P-revoked"] as const;
  const written: string[] = [];

  for (const candidateId of candidateIds) {
    const alias = aliasFor(candidateId);
    const receiptPath = path.join(receiptsDir, `${candidateId}-pass1.json`);
    if (!fs.existsSync(receiptPath)) {
      throw new Error(`oracle receipt not found: ${receiptPath}`);
    }
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as {
      requests: RequestObservation[];
      auditDeltas: Record<string, AuditRecordObservation[]>;
    };

    // Detect duplicate request IDs in the receipt (ambiguous, never silently overwrite).
    const seen = new Set<string>();
    for (const r of receipt.requests) {
      if (seen.has(r.requestId)) {
        throw new Error(`duplicate requestId ${r.requestId} in receipt for ${candidateId}`);
      }
      seen.add(r.requestId);
    }
    const reqById = new Map(receipt.requests.map((r) => [r.requestId, r]));

    const reqDir = requestsDir(alias, OBSERVATION_PASS);
    const auditDir = auditsDir(alias, OBSERVATION_PASS);
    fs.mkdirSync(reqDir, { recursive: true });
    fs.mkdirSync(auditDir, { recursive: true });

    for (const requestId of requestIds) {
      const r = reqById.get(requestId);
      if (r) {
        const body = r.body as Record<string, unknown> | null;
        const profileFields: string[] = [];
        const deniedFields: string[] = [];
        if (body !== null && typeof body === "object") {
          for (const f of ["id", "email", "role", "internal"]) {
            if (f in (body as Record<string, unknown>)) profileFields.push(f);
          }
          for (const f of ["role", "internal"]) {
            if (f in (body as Record<string, unknown>)) deniedFields.push(f);
          }
        }
        const full = {
          requestId: r.requestId,
          statusCode: r.statusCode,
          body: r.body,
          profileFieldsPresent: profileFields,
          deniedFieldsPresent: deniedFields,
          available: true,
        };
        const file = path.join(reqDir, `${requestId}.json`);
        fs.writeFileSync(file, JSON.stringify(full, null, 2) + "\n", "utf8");
        written.push(file);
      }
    }
    const auditMissing = receipt.auditDeltas["P-missing"] ?? [];
    const auditFile = path.join(auditDir, "P-missing.json");
    fs.writeFileSync(
      auditFile,
      JSON.stringify({
        requestId: "P-missing",
        auditRecords: auditMissing,
        auditRecordCount: auditMissing.length,
        available: true,
      }, null, 2) + "\n",
      "utf8",
    );
    written.push(auditFile);
  }

  return written;
}

/** Write the observation-source manifest with version and per-file checksums. */
export function writeObservationSourceManifest(): string {
  const dir = OBSERVATION_SOURCE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const aliasMap = loadAnonymizationMap() as { mapping: Record<string, string> };
  const candidateIds = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;
  const requestIds = ["P-active-a", "P-active-b", "P-missing", "P-revoked"] as const;

  const candidates: Record<string, { alias: string; checksums: Record<string, string> }> = {};
  for (const candidateId of candidateIds) {
    const alias = aliasMap.mapping[candidateId];
    if (!alias) throw new Error(`no anonymization for ${candidateId}`);
    const checksums: Record<string, string> = {};
    for (const requestId of requestIds) {
      const reqFile = requestSourcePath(alias, OBSERVATION_PASS, requestId);
      if (fs.existsSync(reqFile)) {
        checksums[`requests/${requestId}.json`] = fileSha256(reqFile);
      }
    }
    const auditFile = auditSourcePath(alias, OBSERVATION_PASS, "P-missing");
    if (fs.existsSync(auditFile)) {
      checksums[`audit/P-missing.json`] = fileSha256(auditFile);
    }
    candidates[alias] = { alias, checksums };
  }

  const manifest: ObservationSourceManifest = {
    schemaVersion: OBSERVATION_SOURCE_SCHEMA_VERSION,
    version: "v1",
    producer: "oracle-O-1",
    source: "m2-a-oracle-receipts pass 1",
    candidates,
    generatedAt: null,
  };

  const manifestFile = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifestFile;
}

function fileSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
