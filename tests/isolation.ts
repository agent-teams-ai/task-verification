/**
 * Reviewer input-isolation tests (WP1/WP2 responsibility).
 *
 * Verifies the assembled reviewer materialization contains only the selected
 * candidate's approved application files plus base/head identities and the
 * permitted diff, and excludes the parent experiment checkout, sibling
 * candidates, oracle source, and reference artifacts (truth/salt/anonymization
 * map). No live model calls.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("reviewer input isolation", () => {
  test("selected candidate materialization contains only approved application files", () => {
    const candidateId = "S1-C3";
    const src = path.join(ROOT, "candidates", candidateId, "src");
    const files = fs.readdirSync(src).sort();
    assert.deepStrictEqual(files, ["app.ts", "audit.ts", "behavior.ts", "types.ts"]);
    // Manifest records base/head identities and expected criteria (permitted context).
    const manifest = JSON.parse(read(path.join(src, "..", "MANIFEST.json")));
    assert.ok(["B0", "B1"].includes(manifest.base));
    assert.ok(/^H[1-4]$/.test(manifest.head));
    assert.deepStrictEqual(Object.keys(manifest.expectedCriteria), ["AC1", "AC2", "AC3", "AC4", "AC5"]);
  });

  test("assembled input excludes sibling candidates and oracle source", () => {
    const selected = "S1-C3";
    const selectedSrc = path.join(ROOT, "candidates", selected, "src");
    // The selected candidate's materialization is a single directory holding
    // only its own four application files; no sibling directory is nested inside it.
    const selectedFiles = fs.readdirSync(selectedSrc).sort();
    assert.deepStrictEqual(selectedFiles, ["app.ts", "audit.ts", "behavior.ts", "types.ts"]);
    assert.ok(!fs.existsSync(path.join(selectedSrc, "..", "S1-C1")), "sibling S1-C1 must not be inside selected materialization");
    assert.ok(!fs.existsSync(path.join(selectedSrc, "..", "S1-C4")), "sibling S1-C4 must not be inside selected materialization");

    // Oracle source must not be part of the reviewer-visible application tree.
    const oracleSrc = path.join(ROOT, "oracle", "src");
    assert.ok(fs.existsSync(oracleSrc), "oracle source exists in the repo (for WP2)");
    for (const f of fs.readdirSync(oracleSrc)) {
      assert.ok(!selectedFiles.includes(f), `oracle ${f} must not be among selected application files`);
    }
  });

  test("assembled input excludes reference artifacts (truth, salt, anonymization map)", () => {
    const referenceNames = ["truth-v1", "anonymization", "salt", "version-manifest", "gold-label"];
    const candidatesDir = path.join(ROOT, "candidates");
    const allFiles = fs.readdirSync(candidatesDir);
    for (const candidateDir of allFiles) {
      const dir = path.join(candidatesDir, candidateDir);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir, { recursive: true } as any)) {
        const lower = f.toLowerCase();
        for (const ref of referenceNames) {
          assert.ok(!lower.includes(ref), `reference artifact ${f} must not be in reviewer materialization`);
        }
      }
    }
  });

  test("parent experiment checkout is not referenced by candidate sources", () => {
    for (const id of ["S1-C1", "S1-C2", "S1-C3", "S1-C4"]) {
      const src = path.join(ROOT, "candidates", id, "src");
      for (const f of fs.readdirSync(src)) {
        const content = read(path.join(src, f));
        // Candidate sources are self-contained snapshots: no import of the
        // oracle package entry and no reference to the parent checkout's
        // layout outside the candidate's own files.
        assert.ok(!content.includes("/llm"), `${id}/${f} must not reference the /llm oracle entry`);
        assert.ok(!content.includes("oracle/src"), `${id}/${f} must not reference oracle source`);
        assert.ok(!content.includes("../.."), `${id}/${f} must not escape the candidate tree`);
      }
    }
  });
});
