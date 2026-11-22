// The frozen review profile and the exact task object handed to the Gateway SDK.
//
// One implementation is shared by the launcher, the offline serializer
// reproduction and the tests, so the measured request and the dispatched request
// cannot drift apart.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { PACKETS_DIR } from "./paths.mjs";

/** Pinned profile. Changing any field is a new profile digest. */
export const PROFILE = Object.freeze({
  provider: "OpenRouter",
  providerEndpoint: "openrouter",
  model: "openai/gpt-6.1-terra",
  serviceTier: "default",
  effort: "medium",
  outputMode: "json_schema",
  stream: true,
  store: false,
  sdk: "@agent-teams/account-gateway/llm -> createLlmClient()",
  sdkVersion: "0.1.0",
  taskRevision: "delivery-req-v2",
});

/**
 * Provider identities accepted in an upstream reply.
 *
 * OpenRouter reports the upstream provider that served the request. The pinned
 * profile means "whatever OpenRouter routes for this exact model id", so the only
 * substitution we can refuse is a *different model id*. The provider string is
 * recorded and must be one of the declared values; an unknown value halts the
 * batch instead of being accepted silently.
 */
export const ALLOWED_OBSERVED_PROVIDERS = Object.freeze(["OpenRouter", "OpenAI"]);

export const CRITERIA = Object.freeze(["C1", "C2", "C3", "C4", "C5"]);

/** Frozen verbatim from the D1/D2 profile; unchanged in D3-R1. */
export const INSTRUCTIONS =
  "Assess each requirement in the frozen requirements document independently against the candidate " +
  "implementation. Use all provided repository content, including unchanged helper modules, and reason " +
  "about whether a caller can exercise each capability through the service. Do not infer missing " +
  "functionality solely from its absence in the diff. For each requirement return satisfied, violated or " +
  "inconclusive, with concrete evidence references (file and symbol or line), a short explanation, and " +
  "either an actionable correction or the evidence that is missing.";

export const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      minItems: CRITERIA.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "status", "evidence", "explanation", "correction"],
        properties: {
          requirementId: { type: "string", enum: [...CRITERIA] },
          status: { type: "string", enum: ["satisfied", "violated", "inconclusive"] },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "reference"],
              properties: { path: { type: "string" }, reference: { type: "string" } },
            },
          },
          explanation: { type: "string" },
          correction: { type: "string" },
        },
      },
    },
  },
});

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Stable digest of everything that defines the review profile. */
export function profileDigest() {
  return sha256(
    JSON.stringify({
      profile: PROFILE,
      allowedObservedProviders: ALLOWED_OBSERVED_PROVIDERS,
      instructionsSha256: sha256(INSTRUCTIONS),
      schemaSha256: sha256(JSON.stringify(SCHEMA)),
      criteria: [...CRITERIA],
    }),
  );
}

export function loadFamily(familyRoot) {
  return JSON.parse(fs.readFileSync(path.join(familyRoot, "family.json"), "utf8"));
}

/** Reads a frozen packet and refuses to continue if it does not match its manifest. */
export function loadPacket(candidateId, family) {
  const head = family.candidates[candidateId];
  if (typeof head !== "string") throw new Error(`unknown candidate: ${candidateId}`);
  const short = head.slice(0, 12);
  const dir = PACKETS_DIR;
  const text = fs.readFileSync(path.join(dir, `packet-${short}.md`), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, `packet-${short}.json`), "utf8"));
  const digest = sha256(text);
  if (digest !== manifest.packet.sha256) {
    throw new Error(`packet digest does not match its frozen manifest for ${candidateId}`);
  }
  if (Buffer.byteLength(text, "utf8") !== manifest.packet.bytes) {
    throw new Error(`packet byte length does not match its frozen manifest for ${candidateId}`);
  }
  return { head, short, text, manifest, sha256: digest, bytes: manifest.packet.bytes };
}

export function decodeAssessments(value) {
  if (!value || !Array.isArray(value.assessments)) throw new Error("assessments missing");
  const ids = value.assessments.map((a) => a.requirementId);
  for (const criterion of CRITERIA) if (!ids.includes(criterion)) throw new Error(`missing ${criterion}`);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate requirement id");
  return value;
}

/**
 * The task object the SDK encodes. `maxOutputTokens` is the only free variable;
 * everything else is frozen.
 */
export function buildTask({ candidateId, stageId, attempt = 1, packetText, maxOutputTokens, now = Date.now() }) {
  const taskId = `next-family-${stageId}-${candidateId}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(taskId)) {
    throw new Error(`taskId is not admissible: ${taskId}`);
  }
  return {
    taskId,
    attempt,
    profileId: "next-family-criteria",
    model: PROFILE.model,
    accountRefs: ["openrouter-primary"],
    policy: { subjectRef: "synthetic-pilot", policyRevision: 1, bindingRevision: 1 },
    instructions: INSTRUCTIONS,
    input: packetText,
    output: { mode: "json_schema", schema: SCHEMA, strict: true },
    effort: PROFILE.effort,
    maxOutputTokens,
    deadline: new Date(now + 240_000),
    decode: decodeAssessments,
  };
}
