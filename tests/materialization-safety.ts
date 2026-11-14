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

  test("symlink escape is rejected when supported", (t) => {
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
        t.skip("directory links not supported on this platform");
        return;
      }
      throw e;
    } finally {
      try { fs.rmSync(linkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  function makeDirLink(linkPath: string, targetPath: string): boolean {
    try {
      if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
      if (process.platform === "win32") {
        fs.symlinkSync(targetPath, linkPath, "junction");
      } else {
        fs.symlinkSync(targetPath, linkPath, "dir");
      }
      return true;
    } catch {
      return false;
    }
  }

  test("deep nested path behind a symlink/junction is rejected", (t) => {
    const external = path.join(ROOT, ".external-target-deep");
    const link = path.join(MATERIALIZATION_ROOT, "link-escape-deep");
    const out = path.join(MATERIALIZATION_ROOT, "link-escape-deep", "new", "nested", "mat");
    fs.mkdirSync(MATERIALIZATION_ROOT, { recursive: true });
    fs.mkdirSync(external, { recursive: true });
    const created = makeDirLink(link, external);
    if (!created) {
      fs.rmSync(external, { recursive: true, force: true });
      t.skip("directory links not supported on this platform");
      return;
    }
    const beforeExternal = fs.readdirSync(external);
    let threw = false;
    try {
      buildReviewerMaterialization("S1-C1", out);
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, "deep nested symlink path must be rejected");
    // No directory/file created in external target.
    const afterExternal = fs.readdirSync(external);
    assert.deepStrictEqual(afterExternal, beforeExternal, "external target must remain untouched");
    assert.ok(!fs.existsSync(path.join(external, "new")), "no nested dir created in external target");
    // cleanup
    try { fs.rmSync(link, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(external, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("materialization root itself as symlink/junction is rejected", (t) => {
    // Temporarily rename real root, create link in its place, then restore.
    const root = MATERIALIZATION_ROOT;
    const backup = root + ".backup-real";
    const external = path.join(ROOT, ".external-root-target");
    // Back up existing root contents (copy) then remove root.
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(root)) {
      fs.cpSync(root, backup, { recursive: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
    fs.mkdirSync(external, { recursive: true });
    const created = makeDirLink(root, external);
    if (!created) {
      if (fs.existsSync(backup)) { fs.cpSync(backup, root, { recursive: true }); fs.rmSync(backup, { recursive: true, force: true }); }
      fs.rmSync(external, { recursive: true, force: true });
      t.skip("directory links not supported on this platform");
      return;
    }
    let threw = false;
    try {
      buildReviewerMaterialization("S1-C1", path.join(root, "mat"));
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, "symlinked materialization root must be rejected");
    // restore
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    if (fs.existsSync(backup)) { fs.cpSync(backup, root, { recursive: true }); fs.rmSync(backup, { recursive: true, force: true }); }
    fs.rmSync(external, { recursive: true, force: true });
  });

  test("protected files are not deleted by rejected calls", () => {
    const marker = path.join(ROOT, "candidates", "S1-C1", "src", "app.ts");
    const before = fs.readFileSync(marker, "utf8");
    try { buildReviewerMaterialization("S1-C1", ROOT); } catch { /* expected */ }
    const after = fs.readFileSync(marker, "utf8");
    assert.strictEqual(before, after);
  });
});