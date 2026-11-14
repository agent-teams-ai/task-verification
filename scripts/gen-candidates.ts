/**
 * Generate the four self-contained S1 candidate snapshots from the canonical
 * fixture source (WP1).
 *
 * Each snapshot is a disposable, reproducible materialization of one base/head
 * pair. `app.ts`, `types.ts` and `audit.ts` are copied verbatim from the
 * canonical `fixture/src/`; only `behavior.ts` is candidate-specific, so each
 * snapshot is isolated and self-contained (no imports from `fixture/`).
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, "..");
const FIXTURE_SRC = path.join(ROOT, "fixture", "src");
const CANDIDATES_DIR = path.join(ROOT, "candidates");
// (file sets are determined per variant by sharedFilesFor)

function sharedFilesFor(c: Candidate): string[] {
  if (c.variant === "delegate") {
    return ["app-delegate.ts", "authz.ts", "types.ts", "audit.ts"];
  }
  return ["app.ts", "types.ts", "audit.ts"];
}

function renameMapFor(c: Candidate): Record<string, string> {
  if (c.variant === "delegate") {
    return { "app-delegate.ts": "app.ts" };
  }
  return {};
}

interface Candidate {
  id: string;
  base: string;
  head: string;
  label: string;
  behavior: string;
  expected: Record<string, boolean>;
  /** "inline" => fixture/src/app.ts; "delegate" => fixture/src/app-delegate.ts + authz.ts */
  variant: "inline" | "delegate";
}

const CANDIDATES: Candidate[] = [
  {
    id: "S1-C1",
    base: "B0",
    head: "H1",
    label: "correct inline implementation",
    behavior: `{ revokeEnforced: true, revokeFieldCorrect: true, serializerIncludesRole: false }`,
    expected: { AC1: true, AC2: true, AC3: true, AC4: true, AC5: true },
    variant: "inline",
  },
  {
    id: "S1-C2",
    base: "B0",
    head: "H2",
    label: "correct alternative using unchanged helper",
    behavior: `{ revokeEnforced: true, revokeFieldCorrect: true, serializerIncludesRole: false }`,
    expected: { AC1: true, AC2: true, AC3: true, AC4: true, AC5: true },
    variant: "delegate",
  },
  {
    id: "S1-C3",
    base: "B0",
    head: "H3",
    label: "revoked-token behavioral violation",
    behavior: `{ revokeEnforced: true, revokeFieldCorrect: false, serializerIncludesRole: false }`,
    expected: { AC1: true, AC2: true, AC3: false, AC4: true, AC5: true },
    variant: "inline",
  },
  {
    id: "S1-C4",
    base: "B1",
    head: "H4",
    label: "serializer redaction violation",
    behavior: `{ revokeEnforced: true, revokeFieldCorrect: true, serializerIncludesRole: true }`,
    expected: { AC1: true, AC2: true, AC3: true, AC4: false, AC5: true },
    variant: "inline",
  },
];

function behaviorSource(c: Candidate): string {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Deterministic behavior configuration for this application snapshot.");
  lines.push(" * Generated from the canonical fixture behavior.");
  lines.push(" *");
  lines.push(" * Licensed under Apache 2.0. See LICENSE.");
  lines.push(" */");
  lines.push("");
  lines.push('import type { AppBehavior, AppDeps } from "./types.ts";');
  lines.push("");
  lines.push("/** Fixed valid tokens and their callers (deterministic initial state). */");
  lines.push("export const VALID_TOKENS: Map<string, { id: string; email: string }> = new Map([");
  lines.push('  ["token-active-a", { id: "caller-a", email: "caller-a@example.example" }],');
  lines.push('  ["token-active-b", { id: "caller-b", email: "caller-b@example.example" }],');
  // token-revoked is a valid token that is present in the revocation set, so
  // P-revoked exercises the revocation path (AC-3).
  lines.push('  ["token-revoked", { id: "caller-revoked", email: "caller-revoked@example.example" }],');
  lines.push("]);");
  lines.push("");
  lines.push("/** Fixed revocation set (deterministic initial state). */");
  lines.push("export const REVOKED_TOKENS: Set<string> = new Set([\"token-revoked\"]);");
  lines.push("");
  lines.push("/** Deterministic behavior for this application snapshot. */");
  lines.push("export function defaultBehavior(): AppBehavior {");
  lines.push(`  return ${c.behavior};`);
  lines.push("}");
  lines.push("");
  lines.push("/** Build deterministic initial deps for this candidate. */");
  lines.push("export function defaultDeps(behavior: AppBehavior): AppDeps {");
  lines.push("  return {");
  lines.push("    behavior,");
  lines.push("    validTokens: new Map(VALID_TOKENS),");
  lines.push("    revokedTokens: new Set(REVOKED_TOKENS),");
  lines.push("  };");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function treeDigest(dest: string): string {
  const walk = (d: string): string[] => {
    let out: string[] = [];
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        out = out.concat(walk(full));
      } else {
        out.push(path.relative(dest, full));
      }
    }
    return out;
  };
  const files = walk(dest).sort();
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update("\0");
    h.update(fs.readFileSync(path.join(dest, f), "utf8"));
    h.update("\0");
  }
  return h.digest("hex");
}

function writeCandidate(c: Candidate): void {
  const dest = path.join(CANDIDATES_DIR, c.id, "src");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const rename = renameMapFor(c);
  for (const file of sharedFilesFor(c)) {
    const target = rename[file] ?? file;
    fs.copyFileSync(path.join(FIXTURE_SRC, file), path.join(dest, target));
  }
  fs.writeFileSync(path.join(dest, "behavior.ts"), behaviorSource(c), "utf8");

  const manifest = {
    candidate: c.id,
    snapshotPair: c.base + " -> " + c.head,
    base: c.base,
    head: c.head,
    label: c.label,
    provenance: "generated from fixture/src by scripts/gen-candidates.ts",
    expectedCriteria: c.expected,
    behavior: c.behavior,
    sourceInventory: sharedFilesFor(c).map((f) => rename[f] ?? f).concat(["behavior.ts"]).sort(),
    sanitized: true,
    treeDigest: treeDigest(dest),
    generatedAt: new Date(Date.now()).toISOString(),
  };
  fs.writeFileSync(
    path.join(CANDIDATES_DIR, c.id, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
}

function main(): void {
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
  for (const c of CANDIDATES) {
    writeCandidate(c);
    const d = path.join(CANDIDATES_DIR, c.id, "src");
    console.log(
      "  " + c.id + ": " + c.base + " -> " + c.head + " | " + c.label + " | digest " + treeDigest(d).slice(0, 12)
    );
  }
  console.log("Generated " + CANDIDATES.length + " candidate snapshots under " + CANDIDATES_DIR);
}

main();
