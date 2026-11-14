/**
 * Task Verification fixture application (delegating variant).
 *
 * Thin HTTP router that delegates profile handling to the authorization
 * helper in `authz.ts`.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppDeps, AuditRecord } from "./types.ts";
import { AuditSink } from "./audit.ts";
import {
  PROFILE_PATH,
  parseBearerToken,
  handleProfile,
} from "./authz.ts";

export const FIXED_CALLER_ID = "verifier-caller-01";
export const AUDIT_EVENT_DENIED = "profile.access.denied";
export const AUDIT_REASON_MISSING_CREDENTIAL = "missing_credential";
export const AUDIT_REASON_TOKEN_REVOKED = "token_revoked";
export const AUDIT_REASON_GRANTED = "access_granted";

export function createApp(deps: AppDeps) {
  const audit = new AuditSink();

  const app = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method !== "GET" || path !== PROFILE_PATH) {
      const payload = JSON.stringify({ error: "not found" });
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload).toString(),
      });
      res.end(payload);
      return;
    }

    const token = parseBearerToken(req.headers);
    const result = handleProfile(
      token,
      { behavior: deps.behavior, validTokens: deps.validTokens, revokedTokens: deps.revokedTokens },
      audit,
      path
    );

    const payload = JSON.stringify(result.body);
    res.writeHead(result.statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload).toString(),
    });
    res.end(payload);
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
