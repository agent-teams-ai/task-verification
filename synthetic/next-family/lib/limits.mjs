// One source of truth for the batch ceilings, shared by the launcher, the proxy
// arguments, the execution card's numbers and the tests.
//
// Enforcement model (D3-R1 correction)
// ------------------------------------
// The D3 launcher passed `--request-input-tokens 16000` to a proxy whose `bytes`
// mode compares *serialized body bytes* against that number, so the real input
// ceiling was 16,000 bytes while the card advertised 16,000 tokens and a 65,536
// byte body. Every candidate packet serializes above 16,000 bytes (measured
// 23,214–23,830), hence the maintainer's `proxy_input_ceiling_exceeded` (413) on
// all three candidates.
//
// The corrected model keeps one provable relation and states it once:
//
//   billed input tokens  <=  serialized body bytes + SPECIAL_TOKEN_ALLOWANCE
//
// Why: the provider tokenizer is byte-level BPE with byte fallback, so every
// token it emits covers at least one byte of the prompt it tokenizes, and the only
// tokens covering no bytes are the conversation/format special tokens, whose count
// is bounded by the message and format structure the SDK emits. JSON escaping can
// only add bytes, so the prompt bytes the provider tokenizes are never more than
// the serialized body bytes (verified: 0 escaping growth for these packets, and
// growth can only be positive).
//
// Therefore the enforceable pair is: enforce `bodyBytes <= INPUT_BODY_BYTES`, and
// reserve/charge `INPUT_TOKEN_CEILING = INPUT_BODY_BYTES + SPECIAL_TOKEN_ALLOWANCE`
// tokens. The reservation is then a true upper bound on billed input tokens and is
// never below the number the proxy compares against the body.
//
// Limitation, stated rather than hidden: the exact tokenizer for
// `openai/gpt-6.1-terra` cannot be obtained offline, so this is a documented upper
// bound, not a token count. It is falsified on the first live reply if reported
// input exceeds the ceiling — the proxy charges reported usage and halts
// (`ceiling_breached_by_reported_usage`). `chars / 4` is never used for enforcement.

/**
 * Bytes of the complete serialized request body admitted for one criteria call.
 *
 * Measured serialized bodies for the frozen packets: c01 25,884 B, c02 25,741 B,
 * c03 26,427 B (packets 23,220 / 23,093 / 23,743 B plus the 556-byte instruction
 * block, the 668-byte schema and the envelope). 28,672 = 28 KiB covers the largest
 * with 2,245 bytes of slack and is not widened by any caller.
 */
export const INPUT_BODY_BYTES = 28_672;

/** Special/format tokens admitted on top of the byte-derived bound. */
export const SPECIAL_TOKEN_ALLOWANCE = 64;

/** Token ceiling per criteria request; reserved before forwarding, charged after. */
export const INPUT_TOKEN_CEILING = INPUT_BODY_BYTES + SPECIAL_TOKEN_ALLOWANCE;

/** Output ceiling per criteria request. */
export const MAX_OUTPUT_TOKENS = 2_500;

/** Reserved per-request cost. Cache-write input rate and output rate, worst case. */
export const PRICING = Object.freeze({
  inputUsdPerMillion: 1.25,
  outputUsdPerMillion: 5.0,
  cacheReadUsdPerMillion: 0.05,
  basis:
    "worst-case rate of the approved profile: every input token at the cache-write rate, every output token at the output rate; cache reads (0.05/M) are cheaper and are never assumed",
});

/** Stage limits of the frozen plan. */
export const STAGE_PLAN = Object.freeze({
  criteriaRequests: 3,
  correctionReserveRequests: 1,
  ocrForwardedRequests: 8,
  ocrInputBodyBytes: 15_936,
  ocrInputTokensPerRequest: 16_000,
  ocrOutputTokensPerRequest: 1_500,
  requestTimeoutMs: 150_000,
});

const usd = (value) => Number(value.toFixed(8));
export const inputCost = (tokens) => usd((tokens * PRICING.inputUsdPerMillion) / 1e6);
export const outputCost = (tokens) => usd((tokens * PRICING.outputUsdPerMillion) / 1e6);

/** Maximum billable cost of one criteria request: a reservation, not an estimate. */
export const CRITERIA_REQUEST_MAX_USD = usd(inputCost(INPUT_TOKEN_CEILING) + outputCost(MAX_OUTPUT_TOKENS));

/** Maximum cost of one OCR forwarded request at its own ceilings. */
export const OCR_REQUEST_MAX_USD = usd(
  inputCost(STAGE_PLAN.ocrInputTokensPerRequest) + outputCost(STAGE_PLAN.ocrOutputTokensPerRequest),
);

/** Worst case for the whole batch: 3 + 1 criteria calls and the OCR forwarding cap. */
export const BATCH_MAX_USD = usd(
  (STAGE_PLAN.criteriaRequests + STAGE_PLAN.correctionReserveRequests) * CRITERIA_REQUEST_MAX_USD +
    STAGE_PLAN.ocrForwardedRequests * OCR_REQUEST_MAX_USD,
);

/** Cost of an arbitrary request shape, used by tests and by the OCR stage. */
export function requestMaxUsd({ inputTokens, outputTokens }) {
  return usd(inputCost(inputTokens) + outputCost(outputTokens));
}

/**
 * Reservation charge when usage splits cached and uncached input.
 *
 * Cache reads are billed far below ordinary input, but a reservation never credits
 * them: every token named here is charged at the cache-write rate, so the estimate
 * cannot be lowered by a cheaper line item. Reasoning tokens are billed as output
 * and are therefore covered by `outputTokens`.
 */
export function worstCaseUsd({ inputTokens, outputTokens, cacheWriteTokens = 0, cacheReadTokens = 0 }) {
  return usd(inputCost(inputTokens + cacheWriteTokens + cacheReadTokens) + outputCost(outputTokens));
}

/** The proxy arguments that implement the criteria ceilings for one attempt. */
export function criteriaProxyArgs({ stageId, port, ledgerPath, model, serviceTier }) {
  return [
    "--stage",
    stageId,
    "--port",
    String(port),
    "--max-requests",
    "1",
    "--max-input-tokens",
    String(INPUT_TOKEN_CEILING),
    "--max-output-tokens",
    String(MAX_OUTPUT_TOKENS),
    "--request-input-bytes",
    String(INPUT_BODY_BYTES),
    "--request-input-tokens",
    String(INPUT_TOKEN_CEILING),
    "--request-output-tokens",
    String(MAX_OUTPUT_TOKENS),
    "--input-special-token-allowance",
    String(SPECIAL_TOKEN_ALLOWANCE),
    "--request-timeout-ms",
    String(STAGE_PLAN.requestTimeoutMs),
    "--model",
    model,
    "--service-tier",
    serviceTier,
    "--effort",
    "medium",
    "--enforce-identity",
    "--require-observed-model",
    "--allow-observed-provider",
    "OpenRouter,OpenAI",
    "--ledger",
    ledgerPath,
  ];
}
