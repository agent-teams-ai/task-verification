/**
 * Source-reference resolution and digesting (WP4).
 *
 * Neutral module: resolves `oracle-observations-v1:<alias>/...json#pointer`
 * references to committed observation-source artifacts and computes their
 * canonical digests. Does NOT depend on the WP3 Truth loader, so the
 * deterministic baseline import graph stays free of sealed truth artifacts.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest } from "./canonical.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const OBSERVATION_PASS = "pass1";

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

export function loadObservationSource(ref: string): unknown {
  const parsed = parseSourceRef(ref);
  const file = fs.readFileSync(path.join(ROOT, parsed.filePath), "utf8");
  const doc = JSON.parse(file) as unknown;
  return applyJsonPointer(doc, parsed.jsonPointer);
}

export function sourceRefDigest(ref: string): string {
  const parsed = parseSourceRef(ref);
  const file = fs.readFileSync(path.join(ROOT, parsed.filePath), "utf8");
  const doc = JSON.parse(file) as unknown;
  const referenced = applyJsonPointer(doc, parsed.jsonPointer);
  return canonicalDigest(referenced);
}

export function verifyObservationPayload(ref: string, payload: unknown): boolean {
  try {
    const referenced = loadObservationSource(ref) as any;
    if (referenced === null || typeof referenced !== "object" || Array.isArray(referenced)) return false;
    const p = payload as Record<string, unknown>;
    if (referenced.requestId !== undefined && p.requestId !== undefined && p.requestId !== referenced.requestId) return false;
    if (referenced.statusCode !== undefined && p.statusCode !== undefined && p.statusCode !== referenced.statusCode) return false;
    if (referenced.body !== undefined && p.body !== undefined && JSON.stringify(p.body) !== JSON.stringify(referenced.body)) return false;
    if (referenced.auditRecords !== undefined && p.auditRecords !== undefined && JSON.stringify(p.auditRecords) !== JSON.stringify(referenced.auditRecords)) return false;
    return true;
  } catch {
    return false;
  }
}
