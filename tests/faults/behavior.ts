/**
 * Test-only behavior configuration for fault-injection variants.
 * Provides the standard correct behavior so runPass can build deps.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AppBehavior, AppDeps } from "../../fixture/src/types.ts";

export const VALID_TOKENS = new Map([
  ["token-active-a", { id: "caller-a", email: "caller-a@example.example" }],
  ["token-active-b", { id: "caller-b", email: "caller-b@example.example" }],
  ["token-revoked", { id: "caller-revoked", email: "caller-revoked@example.example" }],
]);

export const REVOKED_TOKENS = new Set(["token-revoked"]);

export function defaultBehavior(): AppBehavior {
  return { revokeEnforced: true, revokeFieldCorrect: true, serializerIncludesRole: false };
}

export function defaultDeps(behavior: AppBehavior): AppDeps {
  return {
    behavior,
    validTokens: new Map(VALID_TOKENS),
    revokedTokens: new Set(REVOKED_TOKENS),
  };
}
