import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// WP7: Adapter qualification status.
//
// The Gateway SDK was qualified offline against the exact pinned source and a
// locally packed tarball; see docs/experiments/m2-wp7-adapter-qualification.md
// and scripts/qualify-sdk.mjs. The managed OCR binary (ocr-v1.13.1-rr.6) is
// NOT available in this environment, so Profile A is BLOCKED. These tests assert
// the recorded evidence and the model-free constraints. They do not claim a
// qualification that was not performed, and they do not substitute a fake OCR.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "docs/experiments/m2-wp7-adapter-qualification.md");

test("WP7: qualification report records SDK qualification and OCR blocker", () => {
  assert.ok(fs.existsSync(REPORT), "WP7 qualification report must exist");
  const text = fs.readFileSync(REPORT, "utf8");
  assert.match(text, /@agent-teams\/account-gateway/);
  assert.match(text, /539418d5935a9e336d480b128a1cdb93c1daa6e1/);
  assert.match(text, /dfa8fad3058813d4b0db52f3a05e347c0c8a531286bcbea2183554045e179f00/);
  assert.match(text, /10\/10 passed/);
  assert.match(text, /ocr-v1\.13\.1-rr\.6/);
  assert.match(text, /9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c/);
  assert.match(text, /BLOCKED/);
});

test("WP7: qualification harness is present and targets the real /llm entry", () => {
  const harness = path.join(ROOT, "scripts/qualify-sdk.mjs");
  assert.ok(fs.existsSync(harness), "SDK qualification harness must exist");
  const text = fs.readFileSync(harness, "utf8");
  assert.match(text, /@agent-teams\/account-gateway\/llm/);
  assert.match(text, /createLlmClient/);
  assert.match(text, /127\.0\.0\.1/);
});

test("WP7: no credentials are loaded", () => {
  const credVars = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GATEWAY_TOKEN", "OCR_API_KEY"];
  for (const v of credVars) {
    assert.equal(process.env[v], undefined, `${v} must not be set`);
  }
});

test("WP7: model-free constraint is explicit", () => {
  const text = fs.readFileSync(REPORT, "utf8");
  assert.match(text, /No live model, provider, OCR, Gateway or credential call was made/);
  assert.match(text, /No package was published/);
  // The OCR section must remain a blocker, not a silent substitution.
  assert.match(text, /No substitute binary or fake OCR replacement is used/);
});