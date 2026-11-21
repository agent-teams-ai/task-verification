/**
 * EVALUATOR-ONLY hidden check for R3. Never given to a reviewer path.
 *
 * Usage: node --experimental-strip-types synthetic/evaluator/r3-export.test.ts
 * Run against the candidate working tree; it must fail on Candidate A.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handle } from "../repo/src/router.ts";

const EXPECTED_HEADER = "id,name,status,createdAt";

test("R3: CSV export is served with the filtered rows", () => {
  const response = handle({
    method: "GET",
    path: "/records/export",
    query: { status: "archived" },
  });
  assert.equal(response.status, 200, "the export route must exist");
  assert.match(response.headers["content-type"] ?? "", /^text\/csv/);
  const lines = response.body.replace(/\r\n$/, "").split("\r\n");
  assert.equal(lines[0], EXPECTED_HEADER);
  assert.equal(lines.length, 3, "header plus the two archived records");
  assert.match(lines[1], /^rec-3,Incident 2026-011,archived,2026-02-05T00:30:00\.000Z$/);
});

test("R3: CSV escaping comes from the shared helper", () => {
  const response = handle({
    method: "GET",
    path: "/records/export",
    query: { nameContains: "audit" },
  });
  assert.equal(response.status, 200);
  assert.ok(
    response.body.includes('"Audit ""export"" sample"'),
    "a field with quotes must be escaped by the existing helper",
  );
});

test("R3: the export applies the same filters as the listing", () => {
  const response = handle({
    method: "GET",
    path: "/records/export",
    query: { status: "active", nameContains: "review" },
  });
  assert.equal(response.status, 200);
  const lines = response.body.replace(/\r\n$/, "").split("\r\n");
  assert.equal(lines.length, 3, "header plus the two matching active records");
});
