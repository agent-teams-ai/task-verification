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

export interface AppDeps {
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
