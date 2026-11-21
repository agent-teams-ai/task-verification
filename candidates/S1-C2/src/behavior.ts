/**
 * Deterministic initial state for the Task Verification fixture (WP1).
 *
 * Base snapshot B0 uses this module unchanged; every candidate head inherits
 * it. It contains only fixed tokens, the fixed revocation set and a factory
 * for isolated dependency objects.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AppDeps } from "./types.ts";

/** Fixed valid tokens and their callers (deterministic initial state). */
export const VALID_TOKENS: Map<string, { id: string; email: string }> = new Map([
  ["token-active-a", { id: "caller-a", email: "caller-a@example.example" }],
  ["token-active-b", { id: "caller-b", email: "caller-b@example.example" }],
  // token-revoked is a valid token that is present in the revocation set, so
  // the revoked-token request reaches the revocation check rather than failing
  // earlier as an unknown token.
  ["token-revoked", { id: "caller-revoked", email: "caller-revoked@example.example" }],
]);

/** Fixed revocation set (deterministic initial state). */
export const REVOKED_TOKENS: Set<string> = new Set(["token-revoked"]);

/** Build deterministic initial deps. */
export function defaultDeps(): AppDeps {
  return {
    validTokens: new Map(VALID_TOKENS),
    revokedTokens: new Set(REVOKED_TOKENS),
  };
}
