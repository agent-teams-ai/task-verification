/**
 * Test-only faulty fixture variant: missing audit record (AC-5).
 * P-missing writes no audit record.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppDeps, AuditRecord } from "./types.ts";
import { AuditSink } from "./audit.ts";

export const PROFILE_PATH = "/profile";
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";
export const AUDIT_REASON_TOKEN_REVOKED = "token_revoked";
export const AUDIT_REASON_GRANTED = "access_granted";

function parseBearerToken(headers: IncomingMessage["headers"]): string | undefined {
  const auth = headers.authorization;
  if (typeof auth !== "string") return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  return match ? match[1] : undefined;
}

function serializeProfile(caller: { id: string; email: string }): unknown {
  return { id: caller.id, email: caller.email };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

export function createApp(deps: AppDeps) {
  const audit = new AuditSink();
  const app = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (req.method !== "GET" || path !== PROFILE_PATH) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const token = parseBearerToken(req.headers);
    if (!token) {
      // FAULT: no audit record written for P-missing.
      sendJson(res, 401, { error: "missing_credential" });
      return;
    }
    const caller = deps.validTokens.get(token);
    if (!caller) {
      audit.record(AUDIT_EVENT_DENIED, "unknown_token", path, true, undefined);
      sendJson(res, 401, { error: "unknown_token" });
      return;
    }
    if (deps.revokedTokens.has(token)) {
      audit.record(AUDIT_EVENT_DENIED, AUDIT_REASON_TOKEN_REVOKED, path, true, caller.id);
      sendJson(res, 401, { error: "token_revoked" });
      return;
    }
    const profile = serializeProfile(caller);
    audit.record(AUDIT_EVENT_DENIED, AUDIT_REASON_GRANTED, path, true, caller.id);
    sendJson(res, 200, profile);
  });
  let listening = false;
  return {
    get app() {
      return app;
    },
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
    stop(): Promise<void> {
      return new Promise<void>((resolve) => {
        app.close(() => {
          listening = false;
          resolve();
        });
      });
    },
    reset(): void {
      audit.reset();
    },
    auditDelta(): AuditRecord[] {
      return audit.delta().added;
    },
    auditAll(): ReadonlyArray<AuditRecord> {
      return audit.all();
    },
    get isListening(): boolean {
      return listening;
    },
  };
}
export type App = ReturnType<typeof createApp>;
