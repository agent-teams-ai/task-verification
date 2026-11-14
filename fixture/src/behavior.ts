/**
 * Canonical fixture behavior (WP1).
 *
 * Default deterministic behavior (base B0): all criteria satisfied.
 * Candidate snapshots provide their own `src/behavior.ts` variant.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AppBehavior, AppDeps } from "./types.ts";

/** Fixed valid tokens and their callers (deterministic initial state). */
export const VALID_TOKENS: Map<string, { id: string; email: string }> = new Map([
  ["token-active-a", { id: "caller-a", email: "caller-a@example.example" }],
  ["token-active-b", { id: "caller-b", email: "caller-b@example.example" }],
  // token-revoked is a *valid* token that is present in the revocation set, so
  // P-revoked exercises the revocation path (AC-3) rather than failing at
  // "unknown token" before revocation is consulted.
  ["token-revoked", { id: "caller-revoked", email: "caller-revoked@example.example" }],
]);

/** Fixed revocation set (deterministic initial state). */
export const REVOKED_TOKENS: Set<string> = new Set(["token-revoked"]);

/** Build default deterministic behavior (all criteria satisfied). */
export function defaultBehavior(): AppBehavior {
  return {
    revokeEnforced: true,
    revokeFieldCorrect: true,
    serializerIncludesRole: false,
  };
}

/** Build deterministic initial deps. */
export function defaultDeps(behavior: AppBehavior): AppDeps {
  return {
    behavior,
    validTokens: new Map(VALID_TOKENS),
    revokedTokens: new Set(REVOKED_TOKENS),
  };
}
