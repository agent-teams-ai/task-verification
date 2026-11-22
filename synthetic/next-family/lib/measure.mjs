// Offline reproduction of the complete serialized request body.
//
// The body is captured from the *actual* SDK path: `createLlmClient()` encodes the
// task and hands the bytes to the execution port. The port here is a fake that
// records the bytes and then fails, so nothing leaves the machine: no proxy, no
// provider, no credential, no billable call.
//
// A nominal evidence packet of ~21 KB is not the request body. The SDK wraps the
// packet as `input[0].content[0].text`, adds `instructions`, the JSON schema, the
// reasoning block and the envelope, and JSON-escapes all of it. Those bytes are
// what the proxy sees and what the input ceiling must cover.
import { pathToFileURL } from "node:url";

import { SDK_LLM_DIST } from "./paths.mjs";
import { INSTRUCTIONS, SCHEMA, jsonBytes, sha256 } from "./task.mjs";

let sdkMemo = null;
async function sdk() {
  if (sdkMemo === null) sdkMemo = await import(pathToFileURL(SDK_LLM_DIST).href);
  return sdkMemo;
}

/** The control port accepts the intent and returns a well-formed execution grant. */
export function offlineControl() {
  return {
    async runAccess(intent) {
      const accountRef = intent.accountRefs[0];
      const executionRef = `exec_${intent.operationId}`;
      return {
        operation: {
          operationRef: intent.operationId,
          state: "applied",
          result: {
            kind: "execution",
            executionRef,
            accountRef,
            authorizationEpoch: 1,
            deadline: intent.deadline,
            state: "active",
          },
        },
        bearer: "offline-capture-bearer",
        admission: {
          invocationRef: intent.invocationRef,
          attemptRef: intent.attemptRef,
          accountRef,
          authorizationEpoch: 1,
          subjectRef: intent.subjectRef,
          policyRevision: intent.policyRevision,
          bindingRevision: intent.bindingRevision,
          profileId: intent.profileId,
          limits: { ...intent.limits },
          expiresAt: intent.deadline,
        },
      };
    },
  };
}

/**
 * Capture the exact body the SDK would send, then refuse to send it.
 * `onBody` may throw; that throw is the only way this fake fails.
 */
export function capturingExecution(onBody) {
  return () => ({
    async request(executionRef, req) {
      await onBody(req.body, req);
      throw new Error("offline-capture: no request was forwarded");
    },
    async status(executionRef, requestId) {
      return { requestRef: requestId, effect: "completed", status: "completed" };
    },
    async close(executionRef, input) {
      return { operationRef: input.operationId, state: "applied" };
    },
  });
}

/** Structural breakdown of one encoded body, all measured, nothing estimated. */
export function describeBody(bodyBytes, packetText) {
  const body = Buffer.from(bodyBytes);
  const parsed = JSON.parse(body.toString("utf8"));
  const inputText = parsed.input?.[0]?.content?.[0]?.text ?? "";
  const rawContentBytes =
    Buffer.byteLength(packetText, "utf8") +
    Buffer.byteLength(INSTRUCTIONS, "utf8") +
    jsonBytes(SCHEMA);

  return {
    bodyBytes: body.length,
    bodySha256: sha256(body),
    packetBytes: Buffer.byteLength(packetText, "utf8"),
    serializedInputTextBytes: Buffer.byteLength(inputText, "utf8"),
    inputTextMatchesPacket: inputText === packetText,
    instructionsBytes: Buffer.byteLength(parsed.instructions ?? "", "utf8"),
    schemaBytes: parsed.text?.format?.schema === undefined ? null : jsonBytes(parsed.text.format.schema),
    schemaMatchesFrozen: JSON.stringify(parsed.text?.format?.schema) === JSON.stringify(SCHEMA),
    envelopeBytes: body.length - rawContentBytes - escapingGrowth(body, packetText),
    escapingGrowthBytes: escapingGrowth(body, packetText),
    addressed: {
      model: parsed.model,
      service_tier: parsed.service_tier,
      effort: parsed.reasoning?.effort ?? null,
      max_output_tokens: parsed.max_output_tokens,
      stream: parsed.stream,
      store: parsed.store,
      outputMode: parsed.text?.format?.type ?? "text",
      strict: parsed.text?.format?.strict ?? null,
      schemaName: parsed.text?.format?.name ?? null,
    },
    topLevelKeys: Object.keys(parsed).sort(),
  };
}

/** Bytes JSON escaping adds on top of the raw content the body carries. */
function escapingGrowth(body, packetText) {
  const parsed = JSON.parse(body.toString("utf8"));
  // Only the carried text can grow: the schema is already a JSON value built from
  // plain identifiers, so its serialization is its measurement.
  const growthOfText = (value) =>
    Buffer.byteLength(JSON.stringify(value), "utf8") - 2 - Buffer.byteLength(value, "utf8");
  return growthOfText(packetText) + growthOfText(parsed.instructions ?? "");
}

/**
 * Serialize one task exactly as the SDK does and return its measurement.
 * Also returns the SDK's own admission bound for the body that it reported to the
 * control port (`limits.requestBytes`), which is the maximum applicable input bound
 * above our frozen ceiling.
 */
export async function measureSerializedRequest(task) {
  const { createLlmClient } = await sdk();
  const captured = [];
  let admissionRequestBytes = null;
  const control = offlineControl();
  const originalRunAccess = control.runAccess;
  control.runAccess = async (intent) => {
    admissionRequestBytes = intent.limits?.requestBytes ?? null;
    return originalRunAccess(intent);
  };
  const client = createLlmClient({ control, connectExecution: capturingExecution((body) => captured.push(body)) });
  const result = await client.generate(task);
  if (captured.length !== 1) throw new Error(`expected exactly one serialized body, captured ${captured.length}`);
  const description = describeBody(captured[0], task.input);
  return {
    ...description,
    admissionRequestBytes,
    sdkResultOk: result.ok === true,
    sdkResultCode: result.ok === true ? null : result.code,
  };
}
