/**
 * Canonical Task Verification fixture types (WP1).
 *
 * Minimal HTTP service implementing GET /profile with bearer-token
 * authorization, a JSON audit sink and deterministic fixed state.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { IncomingHttpHeaders } from "node:http";

export interface Profile {
  id: string;
  email: string;
  role?: string;
  internal?: boolean;
}

export interface Caller {
  id: string;
  email: string;
}

export interface AppBehavior {
  /**
   * Whether revocation is enforced. When false, revoked tokens incorrectly
   * pass (models the S1-C3 behavioral violation). Governs AC-3.
   */
  revokeEnforced: boolean;
  /**
   * Whether revocation lookup compares the correct token field. When false,
   * the lookup reads the revocation set but compares against the wrong
   * field, so revoked tokens pass (models S1-C3). Governs AC-3.
   */
  revokeFieldCorrect: boolean;
  /**
   * Whether the serialized profile includes sensitive `role`/`internal`
   * fields. When true, every response body leaks those fields (models
   * S1-C4). Governs AC-4.
   */
  serializerIncludesRole: boolean;
}

export interface AppDeps {
  behavior: AppBehavior;
  validTokens: Map<string, Caller>;
  revokedTokens: Set<string>;
}

export interface AuditRecord {
  event: string;
  reason: string;
  path: string;
  tokenPresent: boolean;
  callerId?: string;
  timestamp: string;
}

export interface AuditDelta {
  added: AuditRecord[];
  count: number;
}

export interface RequestContext {
  method: string;
  url: string;
  path: string;
  headers: IncomingHttpHeaders;
}

export interface ResponsePayload {
  statusCode: number;
  body: unknown;
}
