/**
 * Authorization helper for the Task Verification fixture.
 *
 * Encapsulates token verification, revocation, profile serialization and
 * audit recording for the profile endpoint. Base B0 provides this helper; the
 * delegating candidate head imports it without modifying it.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { Caller } from "./types.ts";
import { AuditSink } from "./audit.ts";
import { serializeProfile } from "./serializer.ts";

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

export function isRevoked(token: string, revokedTokens: ReadonlySet<string>): boolean {
  return revokedTokens.has(token);
}

export function handleProfile(
  token: string | undefined,
  deps: { validTokens: ReadonlyMap<string, Caller>; revokedTokens: ReadonlySet<string> },
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

  if (isRevoked(token, deps.revokedTokens)) {
    audit.record("profile.access.denied", "token_revoked", path, true, caller.id);
    return { statusCode: 401, body: { error: "token_revoked" } };
  }

  const profile = serializeProfile(caller);
  audit.record("profile.access.denied", "access_granted", path, true, caller.id);
  return { statusCode: 200, body: profile };
}
