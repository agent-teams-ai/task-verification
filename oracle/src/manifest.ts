/**
 * Oracle O-1 fixed values (WP2).
 *
 * Fixed caller identity, fixed token/user values and the deterministic request
 * fixtures used by every oracle pass. These values mirror the fixture's
 * deterministic initial state (`fixture/src/behavior.ts`) so the oracle is a
 * black-box behavioral check, not a source inspection.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

export const ORACLE_ID = "O-1";
export const ORACLE_VERSION = "v1";

/** Fixed caller identity asserted by the oracle. */
export const CALLER_ID = "verifier-caller-01";

/** Fixed request fixtures: the four HTTP requests per candidate per pass. */
export interface RequestFixture {
  id: string; // P-active-a | P-active-b | P-missing | P-revoked
  path: string;
  token?: string; // undefined => no bearer token (P-missing)
  expectedCallerId?: string;
  expectedEmail?: string;
}

export const REQUEST_FIXTURES: RequestFixture[] = [
  {
    id: "P-active-a",
    path: "/profile",
    token: "token-active-a",
    expectedCallerId: "caller-a",
    expectedEmail: "caller-a@example.example",
  },
  {
    id: "P-active-b",
    path: "/profile",
    token: "token-active-b",
    expectedCallerId: "caller-b",
    expectedEmail: "caller-b@example.example",
  },
  { id: "P-missing", path: "/profile" },
  { id: "P-revoked", path: "/profile", token: "token-revoked" },
];

/** Revocation-set token (member of the fixture's fixed revocation set). */
export const REVOKED_TOKEN = "token-revoked";

/** Profile fields that must never appear in any response body (AC-4). */
export const DENIED_FIELDS = ["role", "internal"] as const;

export type DeniedField = (typeof DENIED_FIELDS)[number];

/** Audit event/reason values asserted by AC-5. */
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";
