/**
 * Shared test helpers (WP0-WP2).
 *
 * Starts a fixture application instance and issues HTTP requests against it,
 * mirroring the oracle driver but asserting directly in tests.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as http from "node:http";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface AuditRecord {
  event: string;
  reason: string;
  path: string;
  tokenPresent: boolean;
  callerId?: string;
  timestamp: string;
}

export interface AppHandle {
  app: import("node:http").Server;
  stop: () => Promise<void>;
  port: number;
  reset: () => void;
  auditDelta: () => AuditRecord[];
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startApp(appModule: unknown, deps: unknown): Promise<AppHandle> {
  const mod = appModule as {
    createApp: (d: unknown) => AppHandle & { app: import("node:http").Server };
  };
  const app = mod.createApp(deps);
  await app.app.listen(0);
  const port = (app.app.address() as AddressInfo).port;
  return {
    app: app.app,
    stop: () => new Promise<void>((resolve) => app.app.close(() => resolve())),
    port,
    reset: app.reset,
    auditDelta: app.auditDelta,
  };
}

export function requestOnce(port: number, path: string, token?: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const req = http.request(
      { port, path, method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: data });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function candidateSrcDir(candidateId: string): string {
  return path.join(ROOT, "candidates", candidateId, "src");
}

export function candidateAppUrl(candidateId: string): string {
  return pathToFileURL(path.join(candidateSrcDir(candidateId), "app.ts")).href;
}

export function candidateBehaviorUrl(candidateId: string): string {
  return pathToFileURL(path.join(candidateSrcDir(candidateId), "behavior.ts")).href;
}
