/**
 * Oracle O-1 HTTP driver (WP2).
 *
 * Drives the four HTTP requests per candidate per pass against a live fixture
 * instance, captures responses and audit deltas, and evaluates the five
 * assertion groups. Deterministic reset per request; deterministic state
 * initialization per pass.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppDeps } from "../../fixture/src/types.ts";
import { REQUEST_FIXTURES } from "./manifest.ts";
import {
  type RequestResult,
  type AuditRecord,
  evaluateAll,
  type AssertionResult,
} from "./assertions.ts";

export interface PassResult {
  candidateId: string;
  pass: number;
  port: number;
  requests: RequestResult[];
  auditDeltas: Map<string, AuditRecord[]>;
  assertions: Map<string, AssertionResult>;
  passed: boolean;
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function requestOnce(port: number, path: string, token?: string): Promise<{ statusCode: number; body: string }> {
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

/** Build deterministic initial deps for a pass using the candidate's behavior. */
async function buildDeps(candidateAppPath: string): Promise<AppDeps> {
  const behaviorPath = path.join(path.dirname(candidateAppPath), "behavior.ts");
  const behaviorMod = await import(pathToFileURL(behaviorPath).href);
  const defaultBehavior = behaviorMod.defaultBehavior as () => { revokeEnforced: boolean; revokeFieldCorrect: boolean; serializerIncludesRole: boolean };
  const defaultDeps = behaviorMod.defaultDeps as (behavior: { revokeEnforced: boolean; revokeFieldCorrect: boolean; serializerIncludesRole: boolean }) => AppDeps;
  return defaultDeps(defaultBehavior());
}

/**
 * Run one complete oracle pass against the candidate application at
 * `candidateAppPath`. Returns a machine-readable pass result.
 */
export async function runPass(candidateAppPath: string, candidateId: string, pass: number): Promise<PassResult> {
  // Dynamically import the candidate's app (isolated snapshot; no parent
  // checkout, no sibling candidates, no oracle internals imported back).
  const mod = await import(pathToFileURL(candidateAppPath).href);
  const createApp = mod.createApp as (deps: AppDeps) => {
    get app(): import("node:http").Server;
    auditDelta(): AuditRecord[];
    reset(): void;
    stop(): Promise<void>;
    isListening: boolean;
  };

  const app = createApp(await buildDeps(candidateAppPath));
  await app.app.listen(0);
  const addr = app.app.address() as AddressInfo;
  const port = addr.port;

  const requests: RequestResult[] = [];
  const auditDeltas = new Map<string, AuditRecord[]>();

  for (const fx of REQUEST_FIXTURES) {
    // Deterministic reset per request.
    app.reset();
    const { statusCode, body } = await requestOnce(port, fx.path, fx.token);
    requests.push({ requestId: fx.id, statusCode, body: parseBody(body) });
    auditDeltas.set(fx.id, app.auditDelta());
  }

  await app.stop();

  const assertions = evaluateAll(
    new Map(requests.map((r) => [r.requestId, r])),
    auditDeltas.get("P-missing") ?? []
  );

  let passed = true;
  for (const [, a] of assertions) {
    if (!a.passed) {
      passed = false;
    }
  }

  return { candidateId, pass, port, requests, auditDeltas, assertions, passed };
}
