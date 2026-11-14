/**
 * Authorization helper for the Task Verification fixture.
 *
 * Encapsulates token verification, revocation, profile serialization and
 * audit recording so that a candidate may delegate to this unchanged helper
 * rather than implementing the logic inline.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AppBehavior, Caller } from "./types.ts";
import { AuditSink } from "./audit.ts";

export const PROFILE_PATH = "/profile";

export function parseBearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth !== "string") {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return match ? match[1] : undefined;
}

export function verifyToken(token: string, validTokens: ReadonlyMap<string, Caller>): Caller | undefined {
  return validTokens.get(token);
}

export function isRevoked(token: string, behavior: AppBehavior, revokedTokens: ReadonlySet<string>): boolean {
  if (!behavior.revokeEnforced) {
    return false;
  }
  if (!behavior.revokeFieldCorrect) {
    return revokedTokens.has(token.length > 0 ? token.charAt(0) : token);
  }
  return revokedTokens.has(token);
}

export function serializeProfile(caller: Caller, behavior: AppBehavior): unknown {
  const profile: Record<string, unknown> = {
    id: caller.id,
    email: caller.email,
  };
  if (behavior.serializerIncludesRole) {
    profile.role = "reviewer";
    profile.internal = true;
  }
  return profile;
}

export function handleProfile(
  token: string | undefined,
  deps: { behavior: AppBehavior; validTokens: ReadonlyMap<string, Caller>; revokedTokens: ReadonlySet<string> },
  audit: AuditSink,
  path: string
): { statusCode: number; body: unknown } {
  const tokenPresent = token !== undefined;

  if (!tokenPresent) {
    audit.record("profile.access.denied", "missing_credential", path, false, undefined);
    return { statusCode: 401, body: { error: "missing_credential" } };
  }

  const caller = verifyToken(token, deps.validTokens);
  if (!caller) {
    audit.record("profile.access.denied", "unknown_token", path, true, undefined);
    return { statusCode: 401, body: { error: "unknown_token" } };
  }

  if (isRevoked(token, deps.behavior, deps.revokedTokens)) {
    audit.record("profile.access.denied", "token_revoked", path, true, caller.id);
    return { statusCode: 401, body: { error: "token_revoked" } };
  }

  const profile = serializeProfile(caller, deps.behavior);
  audit.record("profile.access.denied", "access_granted", path, true, caller.id);
  return { statusCode: 200, body: profile };
}

// (no extra types)
