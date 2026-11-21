/**
 * WP1 fixture and candidate snapshot tests (model-free).
 *
 * Covers fixture startup, request/response behavior, state reset, candidate
 * isolation, base/head identities, application-digest reproducibility, the
 * common B0 for C1/C2/C3, the unchanged C4 serializer and sanitization/file
 * inventory checks.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  startApp,
  requestOnce,
  parseBody,
  candidateSrcDir,
  candidateAppUrl,
  candidateBehaviorUrl,
  candidateManifestPath,
} from "./helpers.ts";
import { applicationDigestFromDir } from "../src/digest.ts";
import { baseFilesFor, headFilesFor } from "../scripts/snapshot-defs.ts";

const CANDIDATE_IDS = ["S1-C1", "S1-C2", "S1-C3", "S1-C4"] as const;

async function runCandidate(candidateId: string) {
  const appMod = await import(candidateAppUrl(candidateId));
  const behMod = await import(candidateBehaviorUrl(candidateId));
  const deps = behMod.defaultDeps();
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
  return { results, auditDeltas };
}

function readManifest(candidateId: string): {
  base: string;
  head: string;
  headApplicationDigest: string;
  baseApplicationDigest: string;
  expectedCriteria: Record<string, boolean>;
} {
  return JSON.parse(fs.readFileSync(candidateManifestPath(candidateId), "utf8"));
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
    const app = await startApp(appMod, behMod.defaultDeps());
    await requestOnce(app.port, "/profile");
    assert.strictEqual(app.auditDelta().length, 1);
    app.reset();
    assert.strictEqual(app.auditDelta().length, 0);
    await app.stop();
  });

  test("candidate sources are isolated and self-contained", () => {
    for (const id of CANDIDATE_IDS) {
      const src = candidateSrcDir(id);
      const files = fs.readdirSync(src).sort();
      assert.deepStrictEqual(
        files,
        ["app.ts", "audit.ts", "authz.ts", "behavior.ts", "serializer.ts", "types.ts"],
        `${id} file inventory mismatch`
      );
      for (const f of files) {
        const content = fs.readFileSync(path.join(src, f), "utf8");
        assert.ok(!content.includes("../../fixture"), `${id}/${f} references fixture/`);
        assert.ok(!content.includes("../candidates"), `${id}/${f} references sibling candidates`);
        assert.ok(!content.includes("S1-C"), `${id}/${f} references a candidate label`);
      }
    }
  });

  test("candidate application digests reproduce from the manifest", () => {
    for (const id of CANDIDATE_IDS) {
      const manifest = readManifest(id);
      assert.strictEqual(applicationDigestFromDir(candidateSrcDir(id)), manifest.headApplicationDigest);
    }
  });

  test("C1/C2/C3 share the identical B0 base; C4 uses B1", () => {
    const b0Digests = ["S1-C1", "S1-C2", "S1-C3"].map((id) => readManifest(id).baseApplicationDigest);
    assert.strictEqual(new Set(b0Digests).size, 1, "C1/C2/C3 must share one B0 application digest");
    assert.notStrictEqual(readManifest("S1-C4").baseApplicationDigest, b0Digests[0], "C4 base must differ");
    assert.strictEqual(readManifest("S1-C4").base, "B1");
  });

  test("C4 exposes the unchanged B1 serializer and violates AC-4", async () => {
    const base = baseFilesFor("S1-C4");
    const head = headFilesFor("S1-C4");
    assert.strictEqual(head["serializer.ts"], base["serializer.ts"], "C4 must not change the serializer");
    assert.notStrictEqual(base["serializer.ts"], baseFilesFor("S1-C1")["serializer.ts"], "B1 serializer must differ from B0");

    const { results } = await runCandidate("S1-C4");
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

  test("H1-H4 heads have distinct application digests", () => {
    const digests = CANDIDATE_IDS.map((id) => applicationDigestFromDir(candidateSrcDir(id)));
    assert.strictEqual(new Set(digests).size, 4, "candidate head trees must be distinct");
  });

  test("C1 and C2 produce the same behavior from different source structure", async () => {
    const c1 = await runCandidate("S1-C1");
    const c2 = await runCandidate("S1-C2");
    for (const id of ["P-active-a", "P-active-b", "P-missing", "P-revoked"]) {
      assert.deepStrictEqual(c1.results[id], c2.results[id], `behavioral mismatch on ${id}`);
    }
    const c1App = fs.readFileSync(path.join(candidateSrcDir("S1-C1"), "app.ts"), "utf8");
    const c2App = fs.readFileSync(path.join(candidateSrcDir("S1-C2"), "app.ts"), "utf8");
    assert.notStrictEqual(c1App, c2App, "C1 and C2 app.ts must differ");
    assert.ok(c2App.includes("./authz.ts"), "C2 app.ts must import the unchanged helper");
    assert.ok(!c1App.includes("./authz.ts"), "C1 app.ts must implement the flow inline");
  });

  test("C2 depends on the unchanged authz helper (not inlined)", () => {
    const c2Src = candidateSrcDir("S1-C2");
    const appContent = fs.readFileSync(path.join(c2Src, "app.ts"), "utf8");
    const helperContent = fs.readFileSync(path.join(c2Src, "authz.ts"), "utf8");
    assert.ok(helperContent.includes("handleProfile"), "helper must implement handleProfile");
    assert.ok(!appContent.includes("function handleProfile"), "app.ts must not inline handleProfile");
  });

  test("helper remains byte-identical across C2 base and head", () => {
    const base = baseFilesFor("S1-C2");
    const head = headFilesFor("S1-C2");
    assert.strictEqual(head["authz.ts"], base["authz.ts"]);
    assert.strictEqual(
      fs.readFileSync(path.join(candidateSrcDir("S1-C2"), "authz.ts"), "utf8"),
      base["authz.ts"]
    );
    assert.ok(!base["authz.ts"].includes("S1-C"), "helper must not reference candidate labels");
  });

  test("all heads are the base map with only app.ts replaced", () => {
    for (const id of CANDIDATE_IDS) {
      const base = baseFilesFor(id);
      const head = headFilesFor(id);
      const baseKeys = Object.keys(base).sort();
      const headKeys = Object.keys(head).sort();
      assert.deepStrictEqual(headKeys, baseKeys, `${id} head file set must match base`);
      for (const key of baseKeys) {
        if (key === "app.ts") {
          assert.notStrictEqual(head[key], base[key], `${id} app.ts must change`);
        } else {
          assert.strictEqual(head[key], base[key], `${id}/${key} must remain unchanged`);
        }
      }
    }
  });
});
