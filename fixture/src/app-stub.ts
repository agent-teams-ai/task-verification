/**
 * Base (pre-feature) stub application: secure-by-default deny-all.
 *
 * This is the base snapshot application. The feature under review adds the
 * GET /profile route; the stub never serves profile data.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppDeps, AuditRecord } from "./types.ts";

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

export function createApp(_deps: AppDeps) {
  const app = createServer((_req: IncomingMessage, res: ServerResponse) => {
    sendJson(res, 401, { error: "not_implemented" });
  });

  let listening = false;

  return {
    get app() {
      return app;
    },
    async start(port: number): Promise<AddressInfo> {
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
      /* no audit sink in the stub */
    },
    auditDelta(): AuditRecord[] {
      return [];
    },
    auditAll(): ReadonlyArray<AuditRecord> {
      return [];
    },
    get isListening(): boolean {
      return listening;
    },
  };
}

export type App = ReturnType<typeof createApp>;
