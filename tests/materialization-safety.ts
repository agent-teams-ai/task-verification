/**
 * Materialization path-safety tests (M2-A corrective pass).
 *
 * Prove that buildReviewerMaterialization refuses unsafe output paths and
 * unsupported candidate IDs without deleting or altering protected files.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReviewerMaterialization,
  MATERIALIZATION_ROOT,
} from "../src/materialization.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("materialization path safety", () => {
  test("valid path under the materialization root works", () => {
    const out = path.join(MATERIALIZATION_ROOT, "safe-case", "mat");
    const res = buildReviewerMaterialization("S1-C1", out);
    assert.ok(fs.existsSync(res.outDir));
    assert.ok(res.fileInventory.includes("app.ts"));
    // cleanup
    fs.rmSync(path.join(MATERIALIZATION_ROOT, "safe-case"), { recursive: true, force: true });
  });

  test("rejects outDir equal to repository root", () => {
    assert.throws(() => buildReviewerMaterialization("S1-C1", ROOT), /unsafe materialization path/);
  });

  test("rejects outDir equal to candidates directory", () => {
    assert.throws(() => buildReviewerMaterialization("S1-C1", path.join(ROOT, "candidates")), /unsafe materialization path/);
  });

  test("rejects outDir outside materialization root", () => {
    assert.throws(() => buildReviewerMaterialization("S1-C1", path.join(ROOT, "definitely-outside")), /unsafe materialization path/);
  });

  test("rejects path traversal", () => {
    const traversal = path.join(MATERIALIZATION_ROOT, "x", "..", "..", "escaped");
    assert.throws(() => buildReviewerMaterialization("S1-C1", traversal), /unsafe materialization path/);
  });

  test("rejects unsupported candidate ID", () => {
    const out = path.join(MATERIALIZATION_ROOT, "bad-cand", "mat");
    assert.throws(() => buildReviewerMaterialization("S1-C999", out), /unsupported candidateId/);
  });

  test("rejects empty/invalid outDir", () => {
    assert.throws(() => buildReviewerMaterialization("S1-C1", ""), /outDir must be a non-empty string/);
  });

  test("symlink escape is rejected when supported", () => {
    // Create a symlink inside the root pointing outside.
    const linkDir = path.join(MATERIALIZATION_ROOT, "link-escape");
    const target = ROOT;
    try {
      fs.mkdirSync(MATERIALIZATION_ROOT, { recursive: true });
      if (fs.existsSync(linkDir)) fs.rmSync(linkDir, { recursive: true, force: true });
      fs.symlinkSync(target, linkDir, "dir");
      const out = path.join(linkDir, "mat");
      assert.throws(() => buildReviewerMaterialization("S1-C1", out), /unsafe materialization path/);
    } catch (e) {
      // Symlinks may not be supported (e.g. Windows without privileges); skip.
      if ((e as NodeJS.ErrnoException).code === "EPERM" || (e as NodeJS.ErrnoException).code === "ENOTSUP") {
        return;
      }
      throw e;
    } finally {
      try { fs.rmSync(linkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("protected files are not deleted by rejected calls", () => {
    const marker = path.join(ROOT, "candidates", "S1-C1", "src", "app.ts");
    const before = fs.readFileSync(marker, "utf8");
    try { buildReviewerMaterialization("S1-C1", ROOT); } catch { /* expected */ }
    const after = fs.readFileSync(marker, "utf8");
    assert.strictEqual(before, after);
  });
});