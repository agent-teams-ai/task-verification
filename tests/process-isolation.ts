/**
 * Fresh-process isolation tests (M2-A maintainer correction 4).
 *
 * These tests exercise the real child-process boundary: distinct PIDs, fresh
 * process-local state, a permission-restricted workspace, deterministic
 * timeout/abort/malformed/non-zero handling, and cleanup in every path.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChildExecutionError,
  readSourceDir,
  runChildProcess,
  runPass,
  type ChildConfig,
} from "../oracle/src/driver.ts";
import { candidateSrcDir } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C1_SOURCE = { candidateId: "S1-C1", files: readSourceDir(candidateSrcDir("S1-C1")) };

const FORBIDDEN = [
  { label: "sibling-candidate", path: path.join(ROOT, "candidates", "S1-C2", "src", "app.ts") },
  { label: "scorer-internals", path: path.join(ROOT, "oracle", "src", "assertions.ts") },
  { label: "ground-truth", path: path.join(ROOT, "candidates", "provenance.json") },
  { label: "fixture-source", path: path.join(ROOT, "fixture", "src", "app.ts") },
  { label: "unapproved-repo-file", path: path.join(ROOT, "docs", "experiments", "m2-a-candidates.md") },
];

function probeConfig(): ChildConfig {
  return {
    mode: "probe",
    candidateId: "S1-C1",
    requests: [],
    probePaths: [
      { label: "workspace-app", path: "app.ts" },
      { label: "workspace-behavior", path: "behavior.ts" },
    ],
    forbiddenPaths: FORBIDDEN,
  };
}

function assertCleaned(workspaceDir: string): void {
  assert.strictEqual(fs.existsSync(workspaceDir), false, `workspace not cleaned: ${workspaceDir}`);
}

describe("fresh-process isolation", () => {
  test("probe runs in a distinct child process with fresh local state", async () => {
    const first = await runChildProcess(C1_SOURCE, probeConfig());
    const second = await runChildProcess(C1_SOURCE, probeConfig());

    assert.notStrictEqual(first.pid, process.pid, "child must not be the parent process");
    assert.notStrictEqual(second.pid, process.pid, "child must not be the parent process");
    assert.notStrictEqual(first.pid, second.pid, "each execution must use a fresh process");
    assert.strictEqual(first.ppid, process.pid, "child parent must be the test process");
    assert.strictEqual(second.ppid, process.pid, "child parent must be the test process");

    for (const result of [first, second]) {
      assert.strictEqual(result.stateProbe.runCount, 1, "process-local state must start fresh");
      assert.strictEqual(result.stateProbe.freshState, true);
      assert.strictEqual(result.stateProbe.markerSeen, false);
      assert.strictEqual(result.workspaceRemoved, true);
      assertCleaned(result.workspaceDir);
    }
  });

  test("child workspace contains only the candidate source and the isolated runner", async () => {
    const result = await runChildProcess(C1_SOURCE, probeConfig());
    assert.deepStrictEqual(result.workspaceFiles, [
      "app.ts",
      "audit.ts",
      "authz.ts",
      "behavior.ts",
      "child-runner.ts",
      "package.json",
      "serializer.ts",
      "types.ts",
    ]);
    for (const file of result.workspaceFiles) {
      assert.ok(!/MANIFEST|provenance|oracle|assertions|truth|expected/i.test(file), `forbidden workspace file: ${file}`);
    }
    assert.deepStrictEqual(result.payloadKeys, [
      "candidateId",
      "forbiddenPaths",
      "mode",
      "probePaths",
      "requests",
    ]);
  });

  test("child can read its permitted inputs and cannot read forbidden files", async () => {
    const result = await runChildProcess(C1_SOURCE, probeConfig());

    for (const observation of result.allowedReads) {
      assert.strictEqual(observation.accessible, true, `permitted input blocked: ${observation.path}`);
    }

    assert.strictEqual(result.forbidden.length, FORBIDDEN.length);
    for (const observation of result.forbidden) {
      assert.strictEqual(observation.accessible, false, `forbidden file readable: ${observation.label}`);
      assert.strictEqual(observation.code, "ERR_ACCESS_DENIED", `${observation.label}: ${observation.code}`);
    }
  });

  test("each candidate pass runs in a fresh process and cleans its workspace", async () => {
    const c1 = await runPass({ candidateId: "S1-C1", pass: 1, srcDir: candidateSrcDir("S1-C1") });
    const c2 = await runPass({ candidateId: "S1-C2", pass: 1, srcDir: candidateSrcDir("S1-C2") });
    assert.notStrictEqual(c1.process.pid, c2.process.pid, "candidates must not share a process");
    assert.notStrictEqual(c1.process.pid, process.pid);
    assert.strictEqual(c1.process.workspaceRemoved, true);
    assert.strictEqual(c2.process.workspaceRemoved, true);
  });

  test("timeout is deterministic and cleans the workspace", async () => {
    await assert.rejects(
      runChildProcess(C1_SOURCE, { ...probeConfig(), mode: "hang" }, { timeoutMs: 400 }),
      (err: unknown) => {
        assert.ok(err instanceof ChildExecutionError);
        assert.strictEqual(err.kind, "timeout");
        assertCleaned(err.workspaceDir);
        return true;
      }
    );
  });

  test("abort is deterministic and cleans the workspace", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(
        runChildProcess(C1_SOURCE, { ...probeConfig(), mode: "hang" }, { signal: controller.signal }),
        (err: unknown) => {
          assert.ok(err instanceof ChildExecutionError);
          assert.strictEqual(err.kind, "aborted");
          assertCleaned(err.workspaceDir);
          return true;
        }
      );
    } finally {
      clearTimeout(timer);
    }
  });

  test("malformed child output is rejected and the workspace is cleaned", async () => {
    await assert.rejects(
      runChildProcess(C1_SOURCE, { ...probeConfig(), mode: "malformed" }),
      (err: unknown) => {
        assert.ok(err instanceof ChildExecutionError);
        assert.strictEqual(err.kind, "malformed-output");
        assertCleaned(err.workspaceDir);
        return true;
      }
    );
  });

  test("non-zero child exit is rejected with diagnostics and cleanup", async () => {
    await assert.rejects(
      runChildProcess(C1_SOURCE, { ...probeConfig(), mode: "exit" }),
      (err: unknown) => {
        assert.ok(err instanceof ChildExecutionError);
        assert.strictEqual(err.kind, "non-zero-exit");
        assert.strictEqual(err.exitCode, 3);
        assert.ok(err.stderr.includes("intentional child failure"));
        assertCleaned(err.workspaceDir);
        return true;
      }
    );
  });
});
