/**
 * Immutable artifact registry for reference resolution (WP8).
 *
 * A reference is only usable if it resolves to an approved immutable artifact
 * whose digest is *recomputed from the bytes actually present*. Nothing in this
 * module accepts a caller-supplied digest, existence flag or binding claim: the
 * digest is always derived from file content, and verification re-derives it.
 *
 * Reference syntax: `artifact://<repo-root-relative path>`.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";

import { normalizeText } from "./digest.ts";
import type { ArtifactEntry, ArtifactRegistry } from "./scorer.ts";

export const ARTIFACT_SCHEME = "artifact://";

export function artifactReference(repoPath: string): string {
  return ARTIFACT_SCHEME + repoPath.split("\\").join("/");
}

export function referencePath(reference: string): string | null {
  if (!reference.startsWith(ARTIFACT_SCHEME)) return null;
  const rel = reference.slice(ARTIFACT_SCHEME.length);
  if (rel === "" || rel.startsWith("/") || rel.split("/").includes("..")) return null;
  return rel;
}

/** SHA-256 over LF-normalized artifact bytes. */
export function artifactDigest(content: string | Buffer): string {
  const bytes = typeof content === "string" ? Buffer.from(normalizeText(content), "utf8") : content;
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export interface ArtifactFile {
  path: string;
  content: string;
}

export interface RegistryBinding {
  /** Candidate materialization identity this artifact belongs to. */
  candidateBinding: string;
  /** Exact application snapshot digest the artifact was taken from. */
  snapshotDigest: string;
}

export interface RegistryBuild {
  registry: ArtifactRegistry;
  /** reference -> path, derived from the reference itself. */
  pathByReference: Record<string, string>;
  /** reference -> digest recomputed from bytes. */
  digestByReference: Record<string, string>;
  /** Files that were not admitted to the registry, with the reason. */
  rejected: { path: string; reason: string }[];
}

/**
 * Build a registry from the authoritative snapshot's own bytes.
 *
 * Only paths that appear in `allowedPaths` are registered; every other file is
 * rejected and reported (never silently registered).
 */
export function buildArtifactRegistry(params: {
  binding: RegistryBinding;
  files: readonly ArtifactFile[];
  allowedPaths: readonly string[];
  criterionIdFor?: (path: string) => string | null;
  current?: boolean;
  applicable?: boolean;
}): RegistryBuild {
  const { binding, files, allowedPaths } = params;
  const criterionIdFor = params.criterionIdFor ?? (() => null);
  const registry: ArtifactRegistry = { artifacts: {} };
  const pathByReference: Record<string, string> = {};
  const digestByReference: Record<string, string> = {};
  const rejected: { path: string; reason: string }[] = [];

  const seen = new Set<string>();
  for (const file of files) {
    const rel = file.path.split("\\").join("/");
    if (!allowedPaths.includes(rel)) {
      rejected.push({ path: rel, reason: "path outside the application allowlist" });
      continue;
    }
    if (seen.has(rel)) {
      rejected.push({ path: rel, reason: "duplicate artifact path" });
      continue;
    }
    seen.add(rel);
    const reference = artifactReference(rel);
    const digest = artifactDigest(file.content);
    const entry: ArtifactEntry = {
      artifactId: `${binding.candidateBinding}:${rel}`,
      digest,
      candidateBinding: binding.candidateBinding,
      snapshotDigest: binding.snapshotDigest,
      criterionId: criterionIdFor(rel),
      allowedSource: true,
      current: params.current ?? true,
      applicable: params.applicable ?? true,
    };
    registry.artifacts[reference] = entry;
    pathByReference[reference] = rel;
    digestByReference[reference] = digest;
  }

  return { registry, pathByReference, digestByReference, rejected };
}

export interface RegistryVerification {
  ok: boolean;
  errors: string[];
  rejected: { reference: string; reason: string }[];
  /** Registry containing only entries that verified against the bytes. */
  accepted: ArtifactRegistry;
}

/**
 * Re-verify every registry entry against artifact bytes and the expected
 * candidate/snapshot binding.
 *
 * A registry entry is accepted only when all of these hold:
 *   - the reference names an allowlisted path,
 *   - the entry digest equals SHA-256 of the bytes currently on disk,
 *   - the entry is bound to the expected candidate and snapshot,
 *   - the entry is an allowed source and is current and applicable.
 */
export function verifyArtifactRegistry(params: {
  registry: ArtifactRegistry;
  files: readonly ArtifactFile[];
  allowedPaths: readonly string[];
  binding: RegistryBinding;
}): RegistryVerification {
  const { registry, files, allowedPaths, binding } = params;
  const byPath = new Map(files.map((f) => [f.path.split("\\").join("/"), f.content]));
  const accepted: ArtifactRegistry = { artifacts: {} };
  const errors: string[] = [];
  const rejected: { reference: string; reason: string }[] = [];

  for (const [reference, entry] of Object.entries(registry.artifacts)) {
    const reject = (reason: string): void => {
      rejected.push({ reference, reason });
      errors.push(`${reference}: ${reason}`);
    };

    const rel = referencePath(reference);
    if (rel === null) {
      reject("reference is not an artifact reference");
      continue;
    }
    if (!allowedPaths.includes(rel)) {
      reject("path outside the application allowlist");
      continue;
    }
    const content = byPath.get(rel);
    if (content === undefined) {
      reject("no artifact bytes for the referenced path");
      continue;
    }
    const actual = artifactDigest(content);
    if (actual !== entry.digest) {
      reject(`digest mismatch: registry ${entry.digest} != bytes ${actual}`);
      continue;
    }
    if (entry.candidateBinding !== binding.candidateBinding) {
      reject("candidate binding mismatch");
      continue;
    }
    if (entry.snapshotDigest !== binding.snapshotDigest) {
      reject("snapshot binding mismatch");
      continue;
    }
    if (!entry.allowedSource) {
      reject("source is not allowed");
      continue;
    }
    if (!entry.current) {
      reject("artifact is not current");
      continue;
    }
    if (!entry.applicable) {
      reject("artifact is not applicable");
      continue;
    }

    accepted.artifacts[reference] = entry;
  }

  return { ok: errors.length === 0, errors, rejected, accepted };
}
