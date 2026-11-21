/**
 * Task Verification fixture application (delegating variant).
 *
 * Thin HTTP router that delegates profile handling to the unchanged
 * authorization helper in `authz.ts`.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppDeps, AuditRecord } from "./types.ts";
import { AuditSink } from "./audit.ts";
import { PROFILE_PATH, handleProfile } from "./authz.ts";

export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";
export const AUDIT_REASON_TOKEN_REVOKED = "token_revoked";
export const AUDIT_REASON_GRANTED = "access_granted";

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

  const app = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method !== "GET" || path !== PROFILE_PATH) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const auth = req.headers.authorization;
    const match = typeof auth === "string" ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
    const token = match ? match[1] : undefined;
    const result = handleProfile(token, deps, audit, path);
    sendJson(res, result.statusCode, result.body);
  });

  let listening = false;

  return {
    get app() {
      return app;
    },
    get audit() {
      return audit;
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
