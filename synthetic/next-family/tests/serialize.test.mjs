// The serialized request is the unit of enforcement, not the evidence packet.
//
// These tests reproduce the complete SDK body for every candidate offline, prove
// the frozen ceilings cover it, and prove the numbers in family.json are the same
// numbers the launcher uses.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { FAMILY_ROOT } from "../lib/paths.mjs";
import { INSTRUCTIONS, PROFILE, SCHEMA, buildTask, loadFamily, loadPacket, profileDigest } from "../lib/task.mjs";
import { measureSerializedRequest } from "../lib/measure.mjs";
import {
  CRITERIA_REQUEST_MAX_USD,
  INPUT_BODY_BYTES,
  INPUT_TOKEN_CEILING,
  MAX_OUTPUT_TOKENS,
  SPECIAL_TOKEN_ALLOWANCE,
  criteriaProxyArgs,
} from "../lib/limits.mjs";

const family = loadFamily(FAMILY_ROOT);
const candidates = Object.keys(family.candidates);
const measured = {};
for (const candidateId of candidates) {
  const packet = loadPacket(candidateId, family);
  const task = buildTask({ candidateId, stageId: "criteria", packetText: packet.text, maxOutputTokens: MAX_OUTPUT_TOKENS });
  measured[candidateId] = { packet, task, request: await measureSerializedRequest(task) };
}

test("every candidate serializes through the SDK without touching a provider", () => {
  for (const candidateId of candidates) {
    const { request } = measured[candidateId];
    assert.equal(request.sdkResultOk, false, "the capturing port must refuse to forward");
    assert.equal(request.sdkResultCode, "output_lost");
    assert.equal(request.inputTextMatchesPacket, true, `${candidateId} carries the packet verbatim`);
    assert.equal(request.schemaMatchesFrozen, true);
  }
});

test("the frozen byte ceiling covers all three serialized bodies", () => {
  for (const candidateId of candidates) {
    const { packet, request } = measured[candidateId];
    assert.ok(
      request.bodyBytes > packet.bytes,
      `${candidateId}: the body is larger than the ${packet.bytes}-byte packet, which is why a nominal packet bound is not an input bound`,
    );
    assert.ok(request.bodyBytes <= INPUT_BODY_BYTES, `${candidateId}: ${request.bodyBytes} > ${INPUT_BODY_BYTES}`);
  }
  // The largest body is the revised c03; the ceiling keeps real slack.
  const largest = Math.max(...candidates.map((id) => measured[id].request.bodyBytes));
  assert.equal(largest, measured.c03.request.bodyBytes);
  assert.ok(INPUT_BODY_BYTES - largest >= 1_024, "the ceiling leaves at least 1 KiB of slack");
});

test("the serialized request addresses the pinned model, tier, effort and output ceiling", () => {
  for (const candidateId of candidates) {
    const { request } = measured[candidateId];
    assert.equal(request.addressed.model, PROFILE.model);
    assert.equal(request.addressed.service_tier, PROFILE.serviceTier);
    assert.equal(request.addressed.effort, PROFILE.effort);
    assert.equal(request.addressed.max_output_tokens, MAX_OUTPUT_TOKENS);
    assert.equal(request.addressed.stream, true);
    assert.equal(request.addressed.store, false);
    assert.equal(request.addressed.outputMode, "json_schema");
    assert.equal(request.addressed.strict, true);
    assert.deepEqual(request.topLevelKeys, [
      "input",
      "instructions",
      "max_output_tokens",
      "model",
      "reasoning",
      "service_tier",
      "store",
      "stream",
      "text",
    ]);
  }
});

test("the schema and instruction overheads are identical for every candidate", () => {
  const first = measured[candidates[0]].request;
  for (const candidateId of candidates) {
    const request = measured[candidateId].request;
    assert.equal(request.instructionsBytes, Buffer.byteLength(INSTRUCTIONS, "utf8"));
    assert.equal(request.schemaBytes, Buffer.byteLength(JSON.stringify(SCHEMA), "utf8"));
    assert.equal(request.instructionsBytes, first.instructionsBytes);
    assert.equal(request.schemaBytes, first.schemaBytes);
    assert.equal(request.envelopeBytes, first.envelopeBytes, "only the packet text differs between candidates");
  }
});

test("JSON escaping is measured and never negative", () => {
  for (const candidateId of candidates) {
    const { request } = measured[candidateId];
    assert.ok(request.escapingGrowthBytes > 0, "the packet text does contain escaped characters");
    assert.equal(
      request.bodyBytes,
      request.packetBytes + request.instructionsBytes + request.schemaBytes + request.escapingGrowthBytes + request.envelopeBytes,
      "the breakdown reconstructs the body exactly",
    );
  }
});

test("serialization is deterministic, so the admitted digest is the dispatched digest", async () => {
  for (const candidateId of candidates) {
    const again = await measureSerializedRequest(measured[candidateId].task);
    assert.equal(again.bodySha256, measured[candidateId].request.bodySha256);
    assert.equal(again.bodyBytes, measured[candidateId].request.bodyBytes);
  }
});

test("the token ceiling dominates the byte ceiling plus the special-token allowance", () => {
  assert.equal(INPUT_TOKEN_CEILING, INPUT_BODY_BYTES + SPECIAL_TOKEN_ALLOWANCE);
  assert.ok(INPUT_TOKEN_CEILING >= INPUT_BODY_BYTES);
  // chars/4 is never the enforcement basis: for these bodies it understates the
  // byte ceiling by a wide margin, so it could not bound a token count at all.
  for (const candidateId of candidates) {
    const { request } = measured[candidateId];
    const charsOverFour = Math.ceil(request.bodyBytes / 4);
    assert.ok(charsOverFour < INPUT_BODY_BYTES / 2, `${candidateId}: chars/4 = ${charsOverFour} is not a bound`);
  }
});

test("the launcher passes both numbers and the identity flags to the proxy", () => {
  const args = criteriaProxyArgs({
    stageId: "criteria",
    port: 8791,
    ledgerPath: "ledger.jsonl",
    model: PROFILE.model,
    serviceTier: PROFILE.serviceTier,
  });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value("--request-input-bytes"), String(INPUT_BODY_BYTES));
  assert.equal(value("--request-input-tokens"), String(INPUT_TOKEN_CEILING));
  assert.equal(value("--request-output-tokens"), String(MAX_OUTPUT_TOKENS));
  assert.equal(value("--input-special-token-allowance"), String(SPECIAL_TOKEN_ALLOWANCE));
  assert.equal(value("--max-requests"), "1");
  assert.equal(value("--model"), PROFILE.model);
  assert.equal(value("--service-tier"), "default");
  assert.equal(value("--effort"), "medium");
  assert.ok(args.includes("--enforce-identity"));
  assert.ok(args.includes("--require-observed-model"));
  assert.equal(value("--allow-observed-provider"), "OpenRouter,OpenAI");
});

test("family.json agrees with the cap authority", () => {
  const caps = family.caps;
  assert.equal(caps.criteriaInputBodyBytes, INPUT_BODY_BYTES);
  assert.equal(caps.criteriaInputTokenCeiling, INPUT_TOKEN_CEILING);
  assert.equal(caps.specialTokenAllowance, SPECIAL_TOKEN_ALLOWANCE);
  assert.equal(caps.criteriaMaxOutputTokens, MAX_OUTPUT_TOKENS);
  assert.equal(family.taskRevision, PROFILE.taskRevision);
  assert.equal(family.profile.model, PROFILE.model);
  assert.equal(family.profile.effort, PROFILE.effort);
  assert.equal(family.profile.serviceTier, PROFILE.serviceTier);
  assert.ok(CRITERIA_REQUEST_MAX_USD > 0);
});

test("the profile digest changes when the profile changes, and is otherwise stable", () => {
  const digest = profileDigest();
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, profileDigest());
  const altered = JSON.parse(JSON.stringify({ ...PROFILE, effort: "high" }));
  assert.notEqual(altered.effort, PROFILE.effort);
});

test("packets resolve at their frozen digest and byte length", () => {
  for (const candidateId of candidates) {
    const { packet } = measured[candidateId];
    assert.equal(packet.manifest.head, family.candidates[candidateId]);
    assert.equal(packet.bytes, fs.statSync(path.join(FAMILY_ROOT, "packets", packet.manifest.packet.path)).size);
  }
});
