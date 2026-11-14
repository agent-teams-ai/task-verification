/**
 * WP1 fixture and candidate snapshot tests (model-free).
 *
 * Covers fixture startup, request/response behavior, state reset, candidate
 * isolation, base/head identities, tree-digest reproducibility, the S1-C4 B1
 * difference, and sanitization/file-inventory checks.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";
import {
  startApp,
  requestOnce,
  parseBody,
  candidateSrcDir,
  candidateAppUrl,
  candidateBehaviorUrl,
} from "./helpers.ts";

async function runCandidate(candidateId: string) {
  const appMod = await import(candidateAppUrl(candidateId));
  const behMod = await import(candidateBehaviorUrl(candidateId));
  const deps = behMod.defaultDeps(behMod.defaultBehavior());
  const app = await startApp(appMod, deps);
  const results: Record<string, { statusCode: number; body: unknown }> = {};
  const auditDeltas: Record<string, Array<{ event: string; reason: string; path: string; tokenPresent: boolean; callerId?: string; timestamp: string }>> = {};
  for (const [id, token] of [
    ["P-active-a", "token-active-a"],
    ["P-active-b", "token-active-b"],
    ["P-missing", undefined],
    ["P-revoked", "token-revoked"],
  ] as const) {
    app.reset();
    const { statusCode, body } = await requestOnce(app.port, "/profile", token);
    results[id] = { statusCode, body: parseBody(body) };
    auditDeltas[id] = app.auditDelta();
  }
  await app.stop();
  return { results, auditDeltas, behavior: behMod.defaultBehavior() };
}

function treeDigest(dir: string): string {
  const walk = (d: string): string[] => {
    let out: string[] = [];
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        out = out.concat(walk(full));
      } else {
        out.push(path.relative(dir, full));
      }
    }
    return out;
  };
  const files = walk(dir).sort();
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update("\0");
    h.update(fs.readFileSync(path.join(dir, f), "utf8"));
    h.update("\0");
  }
  return h.digest("hex");
}

describe("WP1 fixture and candidates", () => {
  test("fixture starts and serves GET /profile deterministically", async () => {
    const { results } = await runCandidate("S1-C1");
    assert.strictEqual(results["P-active-a"].statusCode, 200);
    assert.deepStrictEqual(results["P-active-a"].body, {
      id: "caller-a",
      email: "caller-a@example.example",
    });
    assert.strictEqual(results["P-active-b"].statusCode, 200);
    assert.deepStrictEqual(results["P-active-b"].body, {
      id: "caller-b",
      email: "caller-b@example.example",
    });
    assert.strictEqual(results["P-missing"].statusCode, 401);
    assert.deepStrictEqual(results["P-missing"].body, { error: "missing_credential" });
    assert.strictEqual(results["P-revoked"].statusCode, 401);
    assert.deepStrictEqual(results["P-revoked"].body, { error: "token_revoked" });
  });

  test("AC-4: no response body contains role or internal (S1-C1)", async () => {
    const { results } = await runCandidate("S1-C1");
    for (const [, r] of Object.entries(results)) {
      const body = r.body as Record<string, unknown>;
      assert.ok(!("role" in body), "role leaked");
      assert.ok(!("internal" in body), "internal leaked");
    }
  });

  test("AC-5: P-missing writes exactly one missing_credential audit record", async () => {
    const { auditDeltas } = await runCandidate("S1-C1");
    const delta = auditDeltas["P-missing"];
    assert.strictEqual(delta.length, 1);
    assert.strictEqual(delta[0].event, "profile.access.denied");
    assert.strictEqual(delta[0].reason, "missing_credential");
  });

  test("explicit reset clears the audit sink", async () => {
    const appMod = await import(candidateAppUrl("S1-C1"));
    const behMod = await import(candidateBehaviorUrl("S1-C1"));
    const app = await startApp(appMod, behMod.defaultDeps(behMod.defaultBehavior()));
    await requestOnce(app.port, "/profile");
    assert.strictEqual(app.auditDelta().length, 1);
    app.reset();
    assert.strictEqual(app.auditDelta().length, 0);
    await app.stop();
  });

  test("candidate sources are isolated and self-contained", async () => {
    for (const id of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
      const src = candidateSrcDir(id);
      const files = fs.readdirSync(src).sort();
      assert.deepStrictEqual(files, ["app.ts", "audit.ts", "behavior.ts", "types.ts"]);
      // No imports back into fixture/ or sibling candidates.
      for (const f of files) {
        const content = fs.readFileSync(path.join(src, f), "utf8");
        assert.ok(!content.includes("../../fixture"), `${id}/${f} references fixture/`);
        assert.ok(!content.includes("../candidates"), `${id}/${f} references sibling candidates`);
      }
    }
  });

  test("candidate tree digests reproduce from manifest", async () => {
    for (const id of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(candidateSrcDir(id), "..", "MANIFEST.json"), "utf8")
      );
      assert.strictEqual(treeDigest(candidateSrcDir(id)), manifest.treeDigest);
    }
  });

  test("S1-C1/S1-C2/S1-C3 use base B0; S1-C4 uses base B1", async () => {
    const manifests: Record<string, { base: string }> = {};
    for (const id of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
      manifests[id] = JSON.parse(
        fs.readFileSync(path.join(candidateSrcDir(id), "..", "MANIFEST.json"), "utf8")
      );
    }
    assert.strictEqual(manifests["S1-C1"].base, "B0");
    assert.strictEqual(manifests["S1-C2"].base, "B0");
    assert.strictEqual(manifests["S1-C3"].base, "B0");
    assert.strictEqual(manifests["S1-C4"].base, "B1");
  });

  test("S1-C4 preserves the B1 serializer difference (role leak, AC-4 violated)", async () => {
    const { results, behavior } = await runCandidate("S1-C4");
    assert.strictEqual(behavior.serializerIncludesRole, true);
    assert.deepStrictEqual(results["P-active-a"].body, {
      id: "caller-a",
      email: "caller-a@example.example",
      role: "reviewer",
      internal: true,
    });
    assert.deepStrictEqual(results["P-active-b"].body, {
      id: "caller-b",
      email: "caller-b@example.example",
      role: "reviewer",
      internal: true,
    });
  });

  test("S1-C3 violates AC-3: revoked token passes (200 instead of 401)", async () => {
    const { results } = await runCandidate("S1-C3");
    assert.strictEqual(results["P-revoked"].statusCode, 200, "C3 revoked token should pass");
  });

  test("H1-H4 heads are reconstructed with distinct tree digests", async () => {
    const digests: string[] = [];
    for (const id of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
      digests.push(treeDigest(candidateSrcDir(id)));
    }
    assert.strictEqual(new Set(digests).size, 4, "candidate head trees must be distinct");
  });
});
