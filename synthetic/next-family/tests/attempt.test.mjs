// Attempt records must be append-only, and a duplicate execution must be impossible
// to start silently.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createAttempt,
  findDuplicate,
  finishAttempt,
  isTerminal,
  newAttemptId,
  readIndex,
  runKey,
  writeRawResponse,
} from "../lib/attempt.mjs";

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-family-attempts-"));

const packetOf = (bytes, digest) => ({
  bytes,
  sha256: digest,
  manifest: { packet: { path: `packet-${digest.slice(0, 12)}.md` } },
});

const base = (overrides = {}) => ({
  attemptId: "att-c01-criteria-20260101T000000000Z-abc123",
  candidateId: "c01",
  stageId: "criteria",
  key: runKey({ candidateId: "c01", stageId: "criteria", packetSha256: "a".repeat(64), profileDigest: "b".repeat(64), bodySha256: "c".repeat(64) }),
  packet: packetOf(23_220, "a".repeat(64)),
  profileDigest: "b".repeat(64),
  body: { bytes: 25_884, sha256: "c".repeat(64) },
  reservationUsd: 0.04842,
  ...overrides,
});

test("an attempt id is unique and never reused", () => {
  const first = newAttemptId({ candidateId: "c01", stageId: "criteria" });
  const second = newAttemptId({ candidateId: "c01", stageId: "criteria" });
  assert.notEqual(first, second);
  assert.match(first, /^att-c01-criteria-\d{8}T\d{9}Z-[0-9a-f]{6}$/);
});

test("a second attempt with the same run key is refused", () => {
  const root = tempRoot();
  createAttempt({ ...base(), root });
  assert.throws(() => createAttempt({ ...base({ attemptId: "att-c01-criteria-other" }), root }), /duplicate execution refused/);
  assert.equal(readIndex(root).length, 1, "the refused attempt left no record");
});

test("an existing attempt id cannot be overwritten", () => {
  const root = tempRoot();
  const attempt = base();
  createAttempt({ ...attempt, root });
  const other = { ...attempt, key: "d".repeat(64) };
  assert.throws(() => createAttempt({ ...other, root }), /attempt id already exists/);
  const record = JSON.parse(fs.readFileSync(path.join(root, attempt.attemptId, "attempt.json"), "utf8"));
  assert.equal(record.runKey, attempt.key, "the first record is intact");
});

test("a completed attempt cannot be resumed as a fresh run", () => {
  const root = tempRoot();
  createAttempt({ ...base(), root });
  finishAttempt(base().attemptId, { state: "completed", result: { ok: true }, root });
  assert.equal(isTerminal(base().attemptId, root), true);
  assert.throws(() => createAttempt({ ...base({ attemptId: "att-c01-criteria-resume" }), root }), /duplicate execution refused/);
  const states = readIndex(root).map((entry) => entry.state);
  assert.deepEqual(states, ["admitted", "completed"]);
});

test("the raw reply is written once and never rewritten", () => {
  const root = tempRoot();
  createAttempt({ ...base(), root });
  const file = writeRawResponse(base().attemptId, "{\"assessments\":[]}", root);
  assert.equal(fs.readFileSync(file, "utf8"), "{\"assessments\":[]}");
  assert.throws(() => writeRawResponse(base().attemptId, "replacement", root), /EEXIST/);
  assert.equal(fs.readFileSync(file, "utf8"), "{\"assessments\":[]}", "the first raw reply is preserved");
});

test("run keys separate stages, so an authorized recheck is a different run", () => {
  const first = runKey({ candidateId: "c02", stageId: "criteria", packetSha256: "a".repeat(64), profileDigest: "b".repeat(64), bodySha256: "c".repeat(64) });
  const recheck = runKey({ candidateId: "c02", stageId: "criteria-correction", packetSha256: "a".repeat(64), profileDigest: "b".repeat(64), bodySha256: "c".repeat(64) });
  assert.notEqual(first, recheck);
  const root = tempRoot();
  createAttempt({ ...base({ attemptId: "att-c02-criteria-x", candidateId: "c02", key: first }), root });
  const second = createAttempt({ ...base({ attemptId: "att-c02-criteria-correction-y", candidateId: "c02", stageId: "criteria-correction", key: recheck }), root });
  assert.equal(fs.existsSync(path.join(second.dir, "attempt.json")), true);
  assert.equal(findDuplicate(recheck, root).stageId, "criteria-correction");
});
