/**
 * Deterministic behavior configuration for this application snapshot.
 * Generated from the canonical fixture behavior.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AppBehavior, AppDeps } from "./types.ts";

/** Fixed valid tokens and their callers (deterministic initial state). */
export const VALID_TOKENS: Map<string, { id: string; email: string }> = new Map([
  ["token-active-a", { id: "caller-a", email: "caller-a@example.example" }],
  ["token-active-b", { id: "caller-b", email: "caller-b@example.example" }],
  ["token-revoked", { id: "caller-revoked", email: "caller-revoked@example.example" }],
]);

/** Fixed revocation set (deterministic initial state). */
export const REVOKED_TOKENS: Set<string> = new Set(["token-revoked"]);

/** Deterministic behavior for this application snapshot. */
export function defaultBehavior(): AppBehavior {
  return { revokeEnforced: true, revokeFieldCorrect: true, serializerIncludesRole: true };
}

/** Build deterministic initial deps for this candidate. */
export function defaultDeps(behavior: AppBehavior): AppDeps {
  return {
    behavior,
    validTokens: new Map(VALID_TOKENS),
    revokedTokens: new Set(REVOKED_TOKENS),
  };
}
