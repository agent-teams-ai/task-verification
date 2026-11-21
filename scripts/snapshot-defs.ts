/**
 * Authoritative candidate snapshot definitions (WP1).
 *
 * A candidate is an immutable base/head pair of application file maps. Every
 * derived artifact (reviewer files, Git identities, diff, oracle subject and
 * application digest) is computed from these maps, never reconstructed from a
 * separate working directory or a later mutable state.
 *
 * B0 and B1 share every file except `serializer.ts`. C1, C2 and C3 use B0;
 * C4 uses B1. Every head is the base map with only `app.ts` replaced, so the
 * unchanged base files (including the serializer) remain byte-identical.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type FileMap = Record<string, string>;

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, "..");
export const FIXTURE_SRC = path.join(REPO_ROOT, "fixture", "src");

/** Application files that make up a candidate snapshot (sorted). */
export const APPLICATION_FILE_NAMES = [
  "app.ts",
  "audit.ts",
  "authz.ts",
  "behavior.ts",
  "serializer.ts",
  "types.ts",
] as const;

export type BaseId = "B0" | "B1";
export type HeadId = "H1" | "H2" | "H3" | "H4";
export type CandidateId = "S1-C1" | "S1-C2" | "S1-C3" | "S1-C4";

export interface CandidateDef {
  id: CandidateId;
  base: BaseId;
  head: HeadId;
  label: string;
  expectedCriteria: Record<string, boolean>;
}

export const CANDIDATE_DEFS: CandidateDef[] = [
  {
    id: "S1-C1",
    base: "B0",
    head: "H1",
    label: "correct inline implementation",
    expectedCriteria: { AC1: true, AC2: true, AC3: true, AC4: true, AC5: true },
  },
  {
    id: "S1-C2",
    base: "B0",
    head: "H2",
    label: "correct alternative using unchanged helper",
    expectedCriteria: { AC1: true, AC2: true, AC3: true, AC4: true, AC5: true },
  },
  {
    id: "S1-C3",
    base: "B0",
    head: "H3",
    label: "revoked-token behavioral violation",
    expectedCriteria: { AC1: true, AC2: true, AC3: false, AC4: true, AC5: true },
  },
  {
    id: "S1-C4",
    base: "B1",
    head: "H4",
    label: "serializer redaction violation",
    expectedCriteria: { AC1: true, AC2: true, AC3: true, AC4: false, AC5: true },
  },
];

export const CANDIDATE_IDS: CandidateId[] = CANDIDATE_DEFS.map((c) => c.id);

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_SRC, name), "utf8");
}

/** Base B0: secure-by-default stub plus the unchanged application modules. */
export function b0Files(): FileMap {
  return {
    "app.ts": readFixture("app-stub.ts"),
    "audit.ts": readFixture("audit.ts"),
    "authz.ts": readFixture("authz.ts"),
    "behavior.ts": readFixture("behavior.ts"),
    "serializer.ts": readFixture("serializer.ts"),
    "types.ts": readFixture("types.ts"),
  };
}

/** Base B1: identical to B0 except for the content of the serializer. */
export function b1Files(): FileMap {
  return {
    ...b0Files(),
    "serializer.ts": readFixture("serializer-b1.ts"),
  };
}

export function baseFiles(base: BaseId): FileMap {
  return base === "B0" ? b0Files() : b1Files();
}

const HEAD_APP_SOURCE: Record<HeadId, string> = {
  H1: "app.ts",
  H2: "app-delegate.ts",
  H3: "app-revoked-bug.ts",
  // H4 is the same correct inline route as H1; the intended defect lives in
  // the unchanged B1 serializer it exposes.
  H4: "app.ts",
};

/** Head snapshot: the exact base map with only `app.ts` replaced. */
export function headFiles(def: CandidateDef): FileMap {
  return {
    ...baseFiles(def.base),
    "app.ts": readFixture(HEAD_APP_SOURCE[def.head]),
  };
}

export function candidateDef(candidateId: string): CandidateDef {
  const def = CANDIDATE_DEFS.find((c) => c.id === candidateId);
  if (!def) {
    throw new Error(`unknown candidate: ${candidateId}`);
  }
  return def;
}

export function baseFilesFor(candidateId: string): FileMap {
  return baseFiles(candidateDef(candidateId).base);
}

export function headFilesFor(candidateId: string): FileMap {
  return headFiles(candidateDef(candidateId));
}

export interface SnapshotEntry {
  def: CandidateDef;
  baseFiles: FileMap;
  headFiles: FileMap;
}

/** Build the complete immutable snapshot model in memory. */
export function buildSnapshotModel(): SnapshotEntry[] {
  return CANDIDATE_DEFS.map((def) => ({
    def,
    baseFiles: baseFiles(def.base),
    headFiles: headFiles(def),
  }));
}
