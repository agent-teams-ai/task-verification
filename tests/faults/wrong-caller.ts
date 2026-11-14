/**
 * Test-only faulty fixture variant: wrong caller identity (AC-1).
 * Injects a wrong caller id into the P-active-a response. Not a benchmark
 * candidate. Used by the HTTP-level fault-injection tests.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppBehavior, AppDeps, AuditRecord } from "../../fixture/src/types.ts";
import { AuditSink } from "../../fixture/src/audit.ts";

export const FIXED_CALLER_ID = "verifier-caller-01";
export const PROFILE_PATH = "/profile";
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";
export const AUDIT_REASON_TOKEN_REVOKED = "token_revoked";
export const AUDIT_REASON_GRANTED = "access_granted";

function parseBearerToken(h: IncomingMessage["headers"]): string | undefined {
  const auth = h.authorization;
  if (typeof auth !== "string") return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return m ? m[1] : undefined;
}
function serializeProfile(caller: { id: string; email: string }, b: AppBehavior): unknown {
  const p: Record<string, unknown> = { id: caller.id, email: caller.email };
  if (b.serializerIncludesRole) { p.role = "reviewer"; p.internal = true; }
  return p;
}
function isRevoked(t: string, b: AppBehavior, s: Set<string>): boolean {
  if (!b.revokeEnforced) return false;
  if (!b.revokeFieldCorrect) return s.has(t.length > 0 ? t.charAt(0) : t);
  return s.has(t);
}
function makeContext(req: IncomingMessage) { const u = new URL(req.url ?? "/", "http://localhost"); return { method: req.method ?? "GET", url: req.url ?? "/", path: u.pathname, headers: req.headers }; }
function sendJson(res: ServerResponse, sc: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(sc, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload).toString() });
  res.end(payload);
}

export function createApp(deps: AppDeps) {
  const audit = new AuditSink();
  const app = createServer((req, res) => {
    const ctx = makeContext(req);
    if (ctx.method !== "GET" || ctx.path !== PROFILE_PATH) { sendJson(res, 404, { error: "not found" }); return; }
    const token = parseBearerToken(req.headers);
    if (!token) { audit.record(AUDIT_EVENT_DENIED, AUDIT_REASON_MISSING_CREDENTIAL, ctx.path, false, undefined); sendJson(res, 401, { error: "missing_credential" }); return; }
    const caller = deps.validTokens.get(token);
    if (!caller) { audit.record(AUDIT_EVENT_DENIED, "unknown_token", ctx.path, true, undefined); sendJson(res, 401, { error: "unknown_token" }); return; }
    if (isRevoked(token, deps.behavior, deps.revokedTokens)) { audit.record(AUDIT_EVENT_DENIED, "token_revoked", ctx.path, true, caller.id); sendJson(res, 401, { error: "token_revoked" }); return; }
    // FAULT: wrong caller identity for token-active-a
    const reportedCaller = token === "token-active-a" ? { id: "wrong-caller", email: "caller-a@example.example" } : caller;
    const profile = serializeProfile(reportedCaller, deps.behavior);
    audit.record(AUDIT_EVENT_DENIED, "access_granted", ctx.path, true, caller.id);
    sendJson(res, 200, profile);
  });
  let listening = false;
  return {
    get app() { return app; },
    get audit() { return audit; },
    async start(port: number): Promise<AddressInfo> { audit.reset(); return new Promise((resolve, reject) => { app.once("error", reject); app.listen(port, () => { listening = true; app.removeListener("error", reject); resolve(app.address() as AddressInfo); }); }); },
    stop(): Promise<void> { return new Promise((resolve) => { app.close(() => { listening = false; resolve(); }); }); },
    reset(): void { audit.reset(); },
    auditDelta(): AuditRecord[] { return audit.delta().added; },
    auditAll(): ReadonlyArray<AuditRecord> { return audit.all(); },
    get isListening() { return listening; },
  };
}
export type App = ReturnType<typeof createApp>;
