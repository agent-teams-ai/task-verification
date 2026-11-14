/**
 * Reviewer materialization and Profile B input builder (M2-A P0).
 *
 * Builds the actual reviewer-facing materialization and the actual serialized
 * Profile B (/llm) input using a strict explicit allowlist. Public reference
 * artifacts (candidate manifests, provenance, expected criteria, labels,
 * behavior descriptions, truth map, salt, oracle source) are never copied into
 * the reviewer materialization and never appear in the serialized Profile B
 * input.
 *
 * Opaque reviewer-facing identifiers are derived from a salted digest. The salt
 * is public reproducibility data (not a secret); the resulting alias is a
 * reviewer-facing opaque identifier only. It is NOT a confidentiality control:
 * the public mapping can be reconstructed by any reader, and no claim is made
 * that a knowledgeable public reader cannot identify a candidate. See
 * docs/experiments/m2-a-reviewer-isolation.md.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES_DIR = path.join(ROOT, "candidates");
const PROVENANCE_PATH = path.join(CANDIDATES_DIR, "provenance.json");

// Dedicated, single materialization root. All generated materialization paths
// MUST resolve strictly below this directory. Nothing outside it is ever
// recursively deleted by this module.
export const MATERIALIZATION_ROOT = path.join(ROOT, ".materialization");

const ALLOWED_CANDIDATES = new Set(["S1-C1", "S1-C2", "S1-C3", "S1-C4"]);

// Public reproducibility salt (NOT a credential; kept outside reviewer materialization).
const SALT = "task-verification-m2-a-public-salt-2026-11-14";

// Frozen criterion IDs and wording (crit-v1), the only criteria data allowed in
// reviewer-facing materialization.
export const FROZEN_CRITERIA: { id: string; text: string }[] = [
  { id: "AC-1", text: "GET /profile with a valid, active bearer token returns 200 and a JSON body containing the caller's id and email." },
  { id: "AC-2", text: "GET /profile with no bearer token returns 401 and no profile fields." },
  { id: "AC-3", text: "GET /profile with a token present in the revocation list returns 401 and no profile fields." },
  { id: "AC-4", text: "No GET /profile response body contains the fields role or internal." },
  { id: "AC-5", text: "Each request rejected for missing credentials writes exactly one audit record with event = profile.access.denied and reason = missing_credential." },
];

// Strict explicit allowlist: only these application files may be materialized.
const ALLOWED_APP_FILES = ["app.ts", "audit.ts", "behavior.ts", "types.ts", "authz.ts"];

export interface MaterializationResult {
  outDir: string;
  fileInventory: string[];
  opaqueId: string;
  baseIdentity: { id: string; commit: string; tree: string };
  headIdentity: { id: string; commit: string; tree: string };
}

export function opaqueId(candidateId: string): string {
  return "S1-FIX-" + crypto.createHash("sha256").update(SALT + candidateId).digest("hex").slice(0, 12);
}

function loadProvenance(): Record<string, any> {
  return JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf8"));
}

function assertCandidate(candidateId: string): void {
  if (!ALLOWED_CANDIDATES.has(candidateId)) {
    throw new Error(`unsupported candidateId: ${candidateId}`);
  }
}

/**
 * Does a filesystem entry exist, including dangling symlinks? lstatSync does
 * NOT follow the link, so dangling links are reported as present.
 */
function entryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve and validate an output directory so that it is strictly inside
 * MATERIALIZATION_ROOT, defeating symlinks/junctions/reparse points at any
 * level, including dangling/broken links whose targets are absent.
 *
 * Strategy:
 *  1. Ensure MATERIALIZATION_ROOT exists and resolve it canonically. Reject
 *     if the root itself is a redirected symlink/junction.
 *  2. Resolve the absolute requested path.
 *  3. Walk upward until the deepest existing ancestor is found, using
 *     lstat-based existence so dangling links are not skipped.
 *  4. Component-by-component validation using lstatSync (not existsSync) so
 *     dangling links are detected. Distinguish genuinely absent components
 *     (ENOENT/ENOTDIR) from present-but-dangling links. Unexpected errors are
 *     not treated as safe.
 *  5. Canonicalize the deepest existing ancestor via realpathSync; reject if
 *     it fails (dangling) or if any link is found.
 *  6. Append non-existing trailing segments to the canonical ancestor.
 *  7. Verify strict containment below the canonical root (twice).
 *  8. Reject protected directories.
 *
 * No recursive deletion of arbitrary caller paths is performed; deletion
 * happens only after this validation, on the validated canonical path.
 */
function resolveSafeOutDir(outDir: string): string {
  if (typeof outDir !== "string" || outDir.trim() === "") {
    throw new Error("outDir must be a non-empty string");
  }

  // Ensure the dedicated root exists (only this root is ever created here).
  fs.mkdirSync(MATERIALIZATION_ROOT, { recursive: true });
  const rootReal = fs.realpathSync(MATERIALIZATION_ROOT);
  const rootLexical = path.resolve(MATERIALIZATION_ROOT);
  if (rootLexical.toLowerCase() !== rootReal.toLowerCase()) {
    throw new Error(`unsafe materialization root (must not be a symlink/junction): ${MATERIALIZATION_ROOT}`);
  }
  try {
    if (fs.lstatSync(MATERIALIZATION_ROOT).isSymbolicLink()) {
      throw new Error(`unsafe materialization root (symlink): ${MATERIALIZATION_ROOT}`);
    }
  } catch (e) {
    if (e instanceof Error && /unsafe materialization root/.test(e.message)) throw e;
  }

  const resolved = path.resolve(outDir);

  // Walk upward until the deepest existing ancestor is found.
  const segments: string[] = [];
  let cur = resolved;
  while (cur && cur !== path.dirname(cur) && !entryExists(cur)) {
    segments.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }

  // Component-by-component validation using lstatSync (dangling-aware).
  {
    const relResolved = path.relative(path.dirname(MATERIALIZATION_ROOT), resolved);
    const parts = relResolved.split(path.sep).filter(Boolean);
    let acc = path.dirname(MATERIALIZATION_ROOT);
    for (const part of parts) {
      acc = path.join(acc, part);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(acc);
      } catch (e: any) {
        if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
          // Genuinely absent component: stop walking.
          break;
        }
        // Unexpected error: do not assume safe.
        throw new Error(`unsafe materialization path (cannot inspect component): ${outDir}`);
      }
      // Entry exists (including dangling links). Reject symlinks/junctions.
      let isLink = st.isSymbolicLink();
      let realPath: string | null = null;
      try {
        realPath = fs.realpathSync(acc);
      } catch {
        // realpathSync fails for dangling links -> treat as link/unsafe.
        isLink = true;
      }
      if (realPath !== null && realPath.toLowerCase() !== path.resolve(acc).toLowerCase()) {
        isLink = true;
      }
      if (isLink) {
        if (path.resolve(acc).toLowerCase() !== rootLexical.toLowerCase()) {
          throw new Error(`unsafe materialization path (symlink/junction in path): ${outDir}`);
        }
      }
    }
  }

  let canonical: string;
  if (entryExists(cur)) {
    let rp: string;
    try {
      rp = fs.realpathSync(cur);
    } catch {
      // Dangling link at the ancestor level.
      throw new Error(`unsafe materialization path (symlink/junction in path): ${outDir}`);
    }
    canonical = path.join(rp, ...segments);
  } else {
    canonical = resolved;
  }

  // Strict containment check (1).
  const rel = path.relative(rootReal, canonical);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`unsafe materialization path (must be strictly inside ${MATERIALIZATION_ROOT}): ${outDir}`);
  }

  // Protected directories.
  const protectedDirs = [CANDIDATES_DIR, path.join(ROOT, "oracle"), path.join(ROOT, "fixture"), path.join(ROOT, "src")];
  if (canonical === path.resolve(ROOT)) {
    throw new Error(`unsafe materialization path (protected directory): ${outDir}`);
  }
  for (const pr of protectedDirs) {
    const r = path.resolve(pr);
    if (canonical === r || canonical.startsWith(r + path.sep)) {
      throw new Error(`unsafe materialization path (protected directory): ${outDir}`);
    }
  }

  // Defense in depth (2).
  const rel2 = path.relative(rootReal, canonical);
  if (rel2 === "" || rel2.startsWith("..") || path.isAbsolute(rel2)) {
    throw new Error(`unsafe materialization path (must be strictly inside ${MATERIALIZATION_ROOT}): ${outDir}`);
  }

  return canonical;
}

export function buildReviewerMaterialization(candidateId: string, outDir: string): MaterializationResult {
  assertCandidate(candidateId);
  const safeDir = resolveSafeOutDir(outDir);

  // Safe deletion: only the validated canonical path inside the dedicated root.
  fs.rmSync(safeDir, { recursive: true, force: true });
  fs.mkdirSync(safeDir, { recursive: true });

  const prov = loadProvenance();
  const cand = prov[candidateId];
  if (!cand) throw new Error(`unknown candidate ${candidateId}`);

  // 1. Copy only allowlisted application source files.
  const srcDir = path.join(CANDIDATES_DIR, candidateId, "src");
  const inventory: string[] = [];
  for (const f of fs.readdirSync(srcDir)) {
    if (!ALLOWED_APP_FILES.includes(f)) continue;
    const target = path.join(safeDir, f);
    fs.copyFileSync(path.join(srcDir, f), target);
    inventory.push(f);
  }
  inventory.sort();

  // 2. Write approved base/head identities (no manifest, no expected criteria, no behavior label).
  fs.writeFileSync(
    path.join(safeDir, "base-head-identities.json"),
    JSON.stringify(
      {
        base: { id: cand.base.id, commit: cand.base.commit, tree: cand.base.tree },
        head: { id: cand.head.id, commit: cand.head.commit, tree: cand.head.tree },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  inventory.push("base-head-identities.json");

  // 3. Write the permitted base-to-head diff (from provenance; not from candidate manifest).
  fs.writeFileSync(path.join(safeDir, "base-to-head.diff"), cand.diffFull + "\n", "utf8");
  inventory.push("base-to-head.diff");

  // 4. Write frozen criteria IDs and wording only (no candidate mapping).
  fs.writeFileSync(
    path.join(safeDir, "criteria.json"),
    JSON.stringify({ revision: "crit-v1", criteria: FROZEN_CRITERIA }, null, 2) + "\n",
    "utf8"
  );
  inventory.push("criteria.json");

  // 5. Write approved shared task/PR metadata (no candidate labels/expected outcomes).
  fs.writeFileSync(
    path.join(safeDir, "task-metadata.json"),
    JSON.stringify(
      {
        prTitle: "Add profile endpoint",
        prDescription: "Implements GET /profile with bearer-token authorization and audit logging.",
        sharedContext: "same for all candidates",
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  inventory.push("task-metadata.json");

  inventory.sort();
  return {
    outDir: safeDir,
    fileInventory: inventory,
    opaqueId: opaqueId(candidateId),
    baseIdentity: { id: cand.base.id, commit: cand.base.commit, tree: cand.base.tree },
    headIdentity: { id: cand.head.id, commit: cand.head.commit, tree: cand.head.tree },
  };
}

export interface ProfileBInput {
  opaqueCandidateId: string;
  criteria: { id: string; text: string }[];
  baseIdentity: { id: string; commit: string; tree: string };
  headIdentity: { id: string; commit: string; tree: string };
  headFiles: { path: string; content: string }[];
  baseToHeadDiff: string;
  prTitle: string;
  prDescription: string;
  instruction: string;
}

export function buildProfileBInput(candidateId: string): ProfileBInput {
  assertCandidate(candidateId);
  const prov = loadProvenance();
  const cand = prov[candidateId];
  if (!cand) throw new Error(`unknown candidate ${candidateId}`);

  const srcDir = path.join(CANDIDATES_DIR, candidateId, "src");
  const headFiles: { path: string; content: string }[] = [];
  for (const f of fs.readdirSync(srcDir)) {
    if (!ALLOWED_APP_FILES.includes(f)) continue;
    headFiles.push({ path: f, content: fs.readFileSync(path.join(srcDir, f), "utf8") });
  }

  return {
    opaqueCandidateId: opaqueId(candidateId),
    criteria: FROZEN_CRITERIA,
    baseIdentity: { id: cand.base.id, commit: cand.base.commit, tree: cand.base.tree },
    headIdentity: { id: cand.head.id, commit: cand.head.commit, tree: cand.head.tree },
    headFiles,
    baseToHeadDiff: cand.diffFull,
    prTitle: "Add profile endpoint",
    prDescription: "Implements GET /profile with bearer-token authorization and audit logging.",
    instruction: "Assess every expected criterion ID (AC-1..AC-5) against the supplied application context.",
  };
}
