/**
 * Recursive canonical JSON serialization and digesting (WP4).
 *
 * Provides a deterministic, explicitly documented canonicalization contract
 * used for Evidence source digests and policy digests. Unlike
 * `JSON.stringify(value, Object.keys(value).sort(), 2)` (which only sorts the
 * top-level keys because a replacer array applies solely to the outermost
 * object), this serializer recursively sorts object keys at every nesting
 * level while preserving array order and JSON primitive types.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

/**
 * Recursively canonicalize a JSON-compatible value: object keys are sorted at
 * every nesting level, array order is preserved, and primitive types are
 * preserved. Unsupported values (undefined, functions, symbols, BigInt) are
 * rejected rather than silently omitted.
 */
export function canonicalize(value: unknown): unknown {
  if (value === undefined) {
    throw new Error("unsupported undefined value in canonical JSON");
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = canonicalize(record[key]);
  }
  return out;
}

/**
 * Serialize a value to canonical JSON: sorted object keys at every level,
 * arrays in order, two-space indentation, no trailing whitespace.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}

/**
 * SHA-256 digest (lowercase hex) of the canonical JSON form of a value.
 */
export function canonicalDigest(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}
