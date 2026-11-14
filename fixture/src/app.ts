/**
 * Canonical Task Verification fixture application (WP1).
 *
 * Minimal, deterministic HTTP service: GET /profile with bearer-token
 * authorization, fixed initial state, explicit reset and a JSON audit sink.
 * Behavior is driven by `AppBehavior` so the four S1 candidates can be
 * materialized from one canonical source with different variants.
 *
 * Core application source is approximately 200 lines.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppBehavior, AppDeps, AuditRecord, RequestContext } from "./types.ts";
import { AuditSink } from "./audit.ts";

/** Fixed caller identity used by the oracle (WP2). */
export const FIXED_CALLER_ID = "verifier-caller-01";

/** Path served by the fixture. */
export const PROFILE_PATH = "/profile";

/** Audit events. */
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";
export const AUDIT_REASON_TOKEN_REVOKED = "token_revoked";
export const AUDIT_REASON_GRANTED = "access_granted";

function parseBearerToken(headers: IncomingMessage["headers"]): string | undefined {
  const auth = headers.authorization;
  if (typeof auth !== "string") {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  if (!match) {
    return undefined;
  }
  return match[1];
}

function serializeProfile(caller: { id: string; email: string }, behavior: AppBehavior): unknown {
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

function isRevoked(token: string, behavior: AppBehavior, revokedTokens: Set<string>): boolean {
  if (!behavior.revokeEnforced) {
    return false;
  }
  if (!behavior.revokeFieldCorrect) {
    /**
     * S1-C3 fault: the revocation lookup reads the revocation set but compares
     * against the wrong field (caller id instead of the token), so no revoked
     * token ever matches and revoked tokens incorrectly pass.
     */
    return revokedTokens.has(token.length > 0 ? token.charAt(0) : token);
  }
  return revokedTokens.has(token);
}

function makeContext(req: IncomingMessage): RequestContext {
  const url = new URL(req.url ?? "/", "http://localhost");
  return {
    method: req.method ?? "GET",
    url: req.url ?? "/",
    path: url.pathname,
    headers: req.headers,
  };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

/**
 * Create the HTTP application. Returns `{ app, audit, address, close }`.
 * `app` is a Node `http.Server` ready to `listen`.
 */
export function createApp(deps: AppDeps) {
  const audit = new AuditSink();

  const app = createServer((req: IncomingMessage, res: ServerResponse) => {
    const ctx = makeContext(req);

    // Only GET /profile is handled; everything else is 404.
    if (ctx.method !== "GET" || ctx.path !== PROFILE_PATH) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const token = parseBearerToken(req.headers);
    const tokenPresent = token !== undefined;

    // AC-2: missing credentials -> 401, no profile fields, one audit record.
    if (!tokenPresent) {
      audit.record(AUDIT_EVENT_DENIED, AUDIT_REASON_MISSING_CREDENTIAL, ctx.path, false, undefined);
      sendJson(res, 401, { error: "missing_credential" });
      return;
    }

    const caller = deps.validTokens.get(token);

    // Unknown token -> 401, no profile fields.
    if (!caller) {
      audit.record(AUDIT_EVENT_DENIED, "unknown_token", ctx.path, true, undefined);
      sendJson(res, 401, { error: "unknown_token" });
      return;
    }

    // AC-3: revoked token -> 401, no profile fields.
    if (isRevoked(token, deps.behavior, deps.revokedTokens)) {
      audit.record(AUDIT_EVENT_DENIED, AUDIT_REASON_TOKEN_REVOKED, ctx.path, true, caller.id);
      sendJson(res, 401, { error: "token_revoked" });
      return;
    }

    // AC-1: active token -> 200 with caller id and email.
    // AC-4: no role/internal unless serializerIncludesRole (S1-C4 violation).
    const profile = serializeProfile(caller, deps.behavior);
    audit.record(AUDIT_EVENT_DENIED, AUDIT_REASON_GRANTED, ctx.path, true, caller.id);
    sendJson(res, 200, profile);
  });

  let listening = false;

  return {
    get app() {
      return app;
    },
    get audit() {
      return audit;
    },
    /**
     * Start listening on `port`. Resolves with the bound address info.
     * Deterministic state initialization: audit sink is reset on start.
     */
    async start(port: number): Promise<AddressInfo> {
      audit.reset();
      return new Promise<AddressInfo>((resolve, reject) => {
        app.once("error", reject);
        app.listen(port, () => {
          listening = true;
          app.removeListener("error", reject);
          resolve(app.address() as AddressInfo);
        });
      });
    },
    /** Stop the server. */
    stop(): Promise<void> {
      return new Promise<void>((resolve) => {
        app.close(() => {
          listening = false;
          resolve();
        });
      });
    },
    /** Explicit reset behavior: clear audit sink and delta cursor. */
    reset(): void {
      audit.reset();
    },
    /** Capture the audit delta since the last delta/reset. */
    auditDelta(): AuditRecord[] {
      return audit.delta().added;
    },
    /** Snapshot every audit record recorded so far. */
    auditAll(): ReadonlyArray<AuditRecord> {
      return audit.all();
    },
    get isListening(): boolean {
      return listening;
    },
  };
}

export type App = ReturnType<typeof createApp>;
