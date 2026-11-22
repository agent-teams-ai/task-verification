// Append-only attempt records for the next-family batch.
//
// Every execution attempt owns a directory keyed by a unique attempt id and is
// written once: `attempt.json` at admission, `result.json` at the end, plus the
// proxy's own request ledger and the immutable raw reply. Nothing is deleted, no
// earlier attempt is renamed, and no directory is reused: `mkdir` without
// `recursive` makes a repeated attempt id an error rather than an overwrite.
//
// Duplicate execution is detectable because each attempt also appends a line to
// `index.jsonl` carrying its run key — the digest of everything that makes two
// executions the same run (candidate, stage, packet digest, profile digest,
// serialized body digest). A second attempt with the same run key is refused; a
// genuine recheck uses a new stage id and therefore a new run key.
//
// `root` is injectable so tests never touch the real ledger directory.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ATTEMPTS_DIR } from "./paths.mjs";

const indexPath = (root) => path.join(root, "index.jsonl");

export function runKey({ candidateId, stageId, packetSha256, profileDigest, bodySha256 }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ candidateId, stageId, packetSha256, profileDigest, bodySha256 }))
    .digest("hex");
}

export function newAttemptId({ candidateId, stageId, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  return `att-${candidateId}-${stageId}-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

export function readIndex(root = ATTEMPTS_DIR) {
  const file = indexPath(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Any earlier attempt with the same run key makes this execution a duplicate. */
export function findDuplicate(key, root = ATTEMPTS_DIR) {
  return readIndex(root).find((entry) => entry.runKey === key) ?? null;
}

function appendIndex(entry, root) {
  fs.mkdirSync(root, { recursive: true });
  fs.appendFileSync(indexPath(root), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/**
 * Create the attempt directory and record admission. Throws when the id already
 * exists or when the run key has been used, so a duplicate can never overwrite or
 * resume silently.
 */
export function createAttempt({
  attemptId,
  candidateId,
  stageId,
  key,
  packet,
  profileDigest,
  body,
  reservationUsd,
  corrects = null,
  root = ATTEMPTS_DIR,
}) {
  fs.mkdirSync(root, { recursive: true });
  const duplicate = findDuplicate(key, root);
  if (duplicate !== null) {
    throw new Error(
      `duplicate execution refused: ${duplicate.attemptId} already has this run key (state ${duplicate.state})`,
    );
  }
  const dir = path.join(root, attemptId);
  try {
    fs.mkdirSync(dir, { recursive: false });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`attempt id already exists: ${attemptId}`);
    throw error;
  }
  fs.mkdirSync(path.join(dir, "request"), { recursive: false });

  const record = {
    schema: "next-family.attempt/v1",
    attemptId,
    candidateId,
    stageId,
    runKey: key,
    corrects,
    createdAt: new Date().toISOString(),
    input: {
      packet: { path: packet.manifest.packet.path, bytes: packet.bytes, sha256: packet.sha256 },
      serializedBody: { bytes: body.bytes, sha256: body.sha256 },
      profileDigest,
    },
    reservationUsd,
    state: "admitted",
  };
  fs.writeFileSync(path.join(dir, "attempt.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  appendIndex({ attemptId, runKey: key, candidateId, stageId, state: "admitted", at: record.createdAt }, root);
  return { dir, record };
}

export function attemptDir(attemptId, root = ATTEMPTS_DIR) {
  return path.join(root, attemptId);
}

/** The raw reply is written once, verbatim, before anything is parsed or annotated. */
export function writeRawResponse(attemptId, text, root = ATTEMPTS_DIR) {
  const file = path.join(attemptDir(attemptId, root), "raw", "response.txt");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600, flag: "wx" });
  return file;
}

export function finishAttempt(attemptId, { state, result, stopReason = null, root = ATTEMPTS_DIR }) {
  const dir = attemptDir(attemptId, root);
  const file = path.join(dir, "result.json");
  fs.writeFileSync(
    file,
    `${JSON.stringify({ schema: "next-family.attempt-result/v1", attemptId, state, stopReason, ...result }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  appendIndex({ attemptId, state, stopReason, at: new Date().toISOString() }, root);
  return file;
}

export function isTerminal(attemptId, root = ATTEMPTS_DIR) {
  const dir = attemptDir(attemptId, root);
  if (!fs.existsSync(dir)) return false;
  return fs.existsSync(path.join(dir, "result.json"));
}
