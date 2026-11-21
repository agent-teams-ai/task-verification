/**
 * Application-content digest helpers (M2-A snapshot integrity).
 *
 * A digest binds only the application files that form a candidate snapshot.
 * Git administrative metadata (`.git`) and experiment metadata (manifests,
 * provenance, expected labels) are deliberately excluded so that they cannot
 * influence the recorded application identity.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Normalize line endings so digests are stable across platforms. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * SHA-256 over a sorted map of relative path -> file content. Paths are
 * normalized to forward slashes and content to LF line endings.
 */
export function applicationDigest(files: Record<string, string>): string {
  const hash = crypto.createHash("sha256");
  for (const rel of Object.keys(files).sort()) {
    hash.update(rel.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(normalizeText(files[rel]));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Read every regular file below `dir` into a relative-path map. `.git`
 * directories are skipped, so Git administrative metadata never contributes
 * to an application digest.
 */
export function readApplicationFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(dir);
  return out;
}

/** Convenience wrapper: digest the application files below a directory. */
export function applicationDigestFromDir(dir: string): string {
  return applicationDigest(readApplicationFiles(dir));
}
