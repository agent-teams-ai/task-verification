#!/usr/bin/env node
/**
 * Bounded, recording loopback proxy between the pinned rr.7 managed OCR binary
 * and OpenRouter.
 *
 * Managed mode forces the binary's provider URL to be loopback
 * (`http://127.0.0.1:<port>`), so this proxy is the only component that holds
 * the provider credential and the only place a request can be counted, capped
 * or priced.
 *
 * Enforcement model
 * -----------------
 * 1. Inference traffic is `POST /responses` (also `/v1/responses`). Anything
 *    else is non-inference: refused, not counted, never forwarded.
 * 2. Request slots are taken before forwarding. Check + increment is
 *    synchronous in a single task, so concurrent requests cannot exceed the cap.
 * 3. Token budget is reserved at the *maximum permitted request cost* before
 *    forwarding (per-request ceilings, not an estimate). Reservation is
 *    synchronous with the slot, so concurrent requests cannot overspend.
 * 4. On completion the reservation is reconciled to reported usage. Usage that
 *    is absent is never charged as zero or as a floor: the full reservation is
 *    kept and the proxy halts, because the cost is then unknowable.
 * 5. Non-2xx, timeout and transport error are ambiguous: full reservation kept,
 *    proxy halts. No retry can re-enter after a halt.
 *
 * Credential rules: reads OPENROUTER_API_KEY / OPENROUTER_BASE_URL only, never
 * OPENAI_*; never writes, logs, echoes or serializes the credential, and never
 * records request headers.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const num = (value, fallback) => (value === undefined ? fallback : Number(value));

const OFFLINE = Boolean(args.offline);
const INSECURE_UPSTREAM = Boolean(args['allow-insecure-upstream']);
const UPSTREAM_BASE = (args.upstream ?? process.env.OPENROUTER_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '');
const API_KEY = (process.env.OPENROUTER_API_KEY ?? '').trim();

const STAGE = typeof args.stage === 'string' ? args.stage : 'unlabelled';
const LEDGER = typeof args.ledger === 'string' ? args.ledger : null;
const PORT = num(args.port, 0);

const MAX_REQUESTS = num(args['max-requests'], 6);
const MAX_INPUT_TOKENS = num(args['max-input-tokens'], 120_000);
const MAX_OUTPUT_TOKENS = num(args['max-output-tokens'], 24_000);
const REQ_INPUT_CEILING = num(args['request-input-tokens'], 20_000);
const REQ_OUTPUT_CEILING = num(args['request-output-tokens'], 4_000);
const REQUEST_TIMEOUT_MS = num(args['request-timeout-ms'], 150_000);
// 'bytes' is the only provable mode: every token covers at least one byte, so
// bodyBytes <= 20000 implies tokenCount <= 20000. 'estimate' is chars/4 and is
// NOT a hard bound; it exists for offline fixtures only.
const INPUT_ENFORCEMENT = typeof args['input-enforcement'] === 'string' ? args['input-enforcement'] : 'bytes';
if (INPUT_ENFORCEMENT !== 'bytes' && INPUT_ENFORCEMENT !== 'estimate') {
  process.stderr.write('proxy: --input-enforcement must be bytes or estimate\n');
  process.exit(2);
}

const PINNED_MODEL = typeof args.model === 'string' ? args.model : 'openai/gpt-6.1-terra';
const PINNED_TIER = typeof args['service-tier'] === 'string' ? args['service-tier'] : 'default';
const PINNED_EFFORT = typeof args.effort === 'string' ? args.effort : 'medium';

for (const [name, value] of [
  ['max-requests', MAX_REQUESTS],
  ['max-input-tokens', MAX_INPUT_TOKENS],
  ['max-output-tokens', MAX_OUTPUT_TOKENS],
  ['request-input-tokens', REQ_INPUT_CEILING],
  ['request-output-tokens', REQ_OUTPUT_CEILING],
]) {
  if (!Number.isInteger(value) || value < 1) {
    process.stderr.write(`proxy: --${name} must be a positive integer\n`);
    process.exit(2);
  }
}

if (!OFFLINE) {
  if (API_KEY === '') {
    process.stderr.write('proxy: OPENROUTER_API_KEY is not set; refusing to start\n');
    process.exit(2);
  }
  const schemeOk = INSECURE_UPSTREAM
    ? /^https?:\/\/[^/]+/.test(UPSTREAM_BASE)
    : /^https:\/\/[^/]+/.test(UPSTREAM_BASE);
  if (!schemeOk) {
    process.stderr.write('proxy: upstream is not an https origin; refusing to start\n');
    process.exit(2);
  }
}

// Coarse guard against obviously oversized bodies. This is NOT a tokeniser and
// is never used as the charged amount.
const estimateTokens = (text) => (text.length === 0 ? 0 : Math.ceil(text.length / 4));

/**
 * Authoritative usage. A non-streamed reply carries `usage` at the top level; a
 * streamed Responses reply carries it in the terminal event (`response.completed`
 * / `response.incomplete`). Both are read here, last value wins, and an absent
 * value stays null so the caller keeps the reservation and halts.
 */
function usageFromBody(bodyText) {
  const usable = (u) => u !== null && typeof u === 'object' && !Array.isArray(u);
  try {
    const whole = JSON.parse(bodyText);
    if (usable(whole?.usage)) return whole.usage;
  } catch {
    /* streamed: fall through to the frame scan */
  }
  let usage = null;
  for (const line of bodyText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    try {
      const frame = JSON.parse(payload);
      const candidate = usable(frame?.usage) ? frame.usage : usable(frame?.response?.usage) ? frame.response.usage : null;
      if (candidate !== null) usage = candidate;
    } catch {
      /* a partial frame is not evidence */
    }
  }
  return usage;
}

/**
 * Evidence only: what the upstream said it actually served. Reads `model` and
 * `provider` from a JSON body or from the last SSE `data:` frame that carries
 * them. Never feeds enforcement, never invents a value: absent stays null.
 */
function observedIdentity(bodyText) {
  const pick = (value, out) => {
    if (value === null || typeof value !== 'object') return out;
    const inner = value.response !== null && typeof value.response === 'object' ? value.response : null;
    if (typeof value.model === 'string' && value.model !== '') out.model = value.model;
    if (typeof value.provider === 'string' && value.provider !== '') out.provider = value.provider;
    if (inner !== null) {
      if (typeof inner.model === 'string' && inner.model !== '') out.model = inner.model;
      if (typeof inner.provider === 'string' && inner.provider !== '') out.provider = inner.provider;
    }
    return out;
  };
  const out = { model: null, provider: null };
  try {
    pick(JSON.parse(bodyText), out);
    if (out.model !== null || out.provider !== null) return out;
  } catch {
    /* SSE or non-JSON: fall through to the frame scan */
  }
  for (const line of bodyText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    try {
      pick(JSON.parse(payload), out);
    } catch {
      /* a partial frame is not evidence */
    }
  }
  return out;
}

const state = {
  requests: 0,
  reservedInput: 0,
  reservedOutput: 0,
  chargedInput: 0,
  chargedOutput: 0,
  halted: null,
};

function record(entry) {
  if (LEDGER === null) return;
  fs.appendFileSync(
    LEDGER,
    `${JSON.stringify({ stage: STAGE, at: new Date().toISOString(), ...entry })}\n`,
    { mode: 0o600 }
  );
}

function refuse(res, status, code, extra = {}) {
  record({ decision: 'refused', code, ...extra });
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: code, type: 'proxy_budget', code } }));
}

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Non-inference traffic is distinguished and never forwarded.
  const inferencePath = req.url === '/responses' || req.url === '/v1/responses';
  if (!inferencePath) {
    record({ decision: 'refused', kind: 'non-inference', code: 'proxy_path_not_inference', path: req.url });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy_path_not_inference', type: 'proxy_boundary' } }));
    return;
  }
  if (req.method !== 'POST') {
    record({ decision: 'refused', kind: 'non-inference', code: 'proxy_method_not_allowed', method: req.method });
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy_method_not_allowed', type: 'proxy_boundary' } }));
    return;
  }

  const raw = await readBody(req).catch(() => null);
  if (raw === null) {
    refuse(res, 400, 'proxy_body_unreadable');
    return;
  }

  // ---- synchronous critical section: halt, slot, policy, reservation --------
  if (state.halted !== null) {
    refuse(res, 402, 'proxy_halted', { haltReason: state.halted });
    return;
  }
  if (state.requests >= MAX_REQUESTS) {
    refuse(res, 429, 'request_cap', { cap: MAX_REQUESTS });
    return;
  }
  // A halted or capped request never forwards, so it is not charged tokens.

  let parsed = null;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    parsed = null;
  }
  const text = raw.toString('utf8');
  const inputBytes = raw.length;
  const estIn = estimateTokens(text);

  // Policy pinning: a substituted model, tier or effort is refused, not billed.
  const model = parsed?.model ?? null;
  if (model !== PINNED_MODEL) {
    state.requests += 1;
    refuse(res, 400, 'proxy_policy_model', { attemptedModel: model, pinned: PINNED_MODEL });
    return;
  }
  const tier = parsed?.service_tier ?? null;
  if (tier !== null && tier !== PINNED_TIER) {
    state.requests += 1;
    refuse(res, 400, 'proxy_policy_service_tier', { attemptedTier: tier, pinned: PINNED_TIER });
    return;
  }
  const effort = parsed?.reasoning?.effort ?? null;
  if (effort !== null && effort !== PINNED_EFFORT) {
    state.requests += 1;
    refuse(res, 400, 'proxy_policy_reasoning_effort', { attemptedEffort: effort, pinned: PINNED_EFFORT });
    return;
  }

  // A caller-declared output ceiling above the pinned one is refused, not clamped.
  const declaredOutput = parsed?.max_output_tokens;
  if (typeof declaredOutput === 'number' && declaredOutput > REQ_OUTPUT_CEILING) {
    state.requests += 1;
    refuse(res, 413, 'proxy_output_ceiling_exceeded', {
      declaredOutput,
      ceiling: REQ_OUTPUT_CEILING,
    });
    return;
  }
  const overInput =
    INPUT_ENFORCEMENT === 'bytes' ? inputBytes > REQ_INPUT_CEILING : estIn > REQ_INPUT_CEILING;
  if (overInput) {
    state.requests += 1;
    refuse(res, 413, 'proxy_input_ceiling_exceeded', {
      enforcement: INPUT_ENFORCEMENT,
      inputBytes,
      estimatedInputTokens: estIn,
      ceiling: REQ_INPUT_CEILING,
    });
    return;
  }

  // Atomic reservation at the maximum permitted request cost. Committed spend
  // plus in-flight reservations plus this reservation must fit the stage cap.
  if (
    state.chargedInput + state.reservedInput + REQ_INPUT_CEILING > MAX_INPUT_TOKENS ||
    state.chargedOutput + state.reservedOutput + REQ_OUTPUT_CEILING > MAX_OUTPUT_TOKENS
  ) {
    state.requests += 1;
    refuse(res, 429, 'token_budget_exhausted', {
      chargedInputTokens: state.chargedInput,
      chargedOutputTokens: state.chargedOutput,
      reservedInput: state.reservedInput,
      reservedOutput: state.reservedOutput,
      inputCap: MAX_INPUT_TOKENS,
      outputCap: MAX_OUTPUT_TOKENS,
    });
    return;
  }

  state.requests += 1;
  state.reservedInput += REQ_INPUT_CEILING;
  state.reservedOutput += REQ_OUTPUT_CEILING;
  const slot = state.requests;
  const reservedIn = REQ_INPUT_CEILING;
  const reservedOut = REQ_OUTPUT_CEILING;

  let injectedOutput = null;
  if (parsed !== null && typeof parsed === 'object' && declaredOutput === undefined) {
    parsed.max_output_tokens = REQ_OUTPUT_CEILING;
    injectedOutput = REQ_OUTPUT_CEILING;
  }
  const payload = parsed === null ? raw : Buffer.from(JSON.stringify(parsed), 'utf8');
  // ---- end critical section -------------------------------------------------

  const settle = ({ status, usage, ambiguous, observed = { model: null, provider: null } }) => {
    state.reservedInput -= reservedIn;
    state.reservedOutput -= reservedOut;
    const usagePresent = usage !== null && usage !== undefined;
    // Reported usage is authoritative. When it is absent the reservation is
    // kept, and because the byte bound proves tokens <= ceiling the reservation
    // is a true upper bound rather than a guess.
    const chargedIn = usagePresent ? Number(usage.input_tokens ?? reservedIn) : reservedIn;
    const chargedOut = usagePresent ? Number(usage.output_tokens ?? reservedOut) : reservedOut;
    state.chargedInput += chargedIn;
    state.chargedOutput += chargedOut;
    // A reported value above the ceiling means the pre-forward guard was
    // incomplete for this request: charge the truth and stop.
    const ceilingBreached =
      chargedIn > REQ_INPUT_CEILING || chargedOut > REQ_OUTPUT_CEILING;
    if (ceilingBreached) state.halted = 'ceiling_breached_by_reported_usage';
    else if (ambiguous || !usagePresent) {
      state.halted = ambiguous ? 'ambiguous_upstream_outcome' : 'usage_unreliable';
    }
    record({
      i: slot,
      decision: 'forwarded',
      kind: 'inference',
      model,
      requestedServiceTier: tier,
      requestedEffort: effort,
      inputBytes,
      inputEnforcement: INPUT_ENFORCEMENT,
      inputTokensEstimate: estIn,
      injectedMaxOutputTokens: injectedOutput,
      status,
      observedModel: observed.model,
      observedProvider: observed.provider,
      usagePresent,
      usage,
      chargedInputTokens: chargedIn,
      chargedOutputTokens: chargedOut,
      halted: state.halted,
      totals: {
        requests: state.requests,
        chargedInputTokens: state.chargedInput,
        chargedOutputTokens: state.chargedOutput,
      },
    });
    return { chargedIn, chargedOut, usagePresent };
  };

  if (OFFLINE) {
    const usage = { input_tokens: estIn, output_tokens: 0 };
    settle({ status: 200, usage, ambiguous: false });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `offline-${slot}`, object: 'response', model, output: [], usage }));
    return;
  }

  const target = `${UPSTREAM_BASE}/responses`;
  const url = new URL(target);
  const client = url.protocol === 'https:' ? https : http;
  const upstream = await new Promise((resolve) => {
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${API_KEY}`,
          'content-length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks), timedOut: false }));
      }
    );
    request.on('timeout', () => {
      request.destroy();
      resolve({ status: 504, body: Buffer.from('{"error":{"message":"proxy_upstream_timeout"}}'), timedOut: true });
    });
    request.on('error', () =>
      resolve({ status: 502, body: Buffer.from('{"error":{"message":"proxy_upstream_error"}}'), timedOut: true })
    );
    request.end(payload);
  });

  const bodyText = upstream.body.toString('utf8');
  const usage = usageFromBody(bodyText);
  const status = upstream.status ?? 502;
  const ambiguous = Boolean(upstream.timedOut) || !(status >= 200 && status < 300);
  settle({ status, usage, ambiguous, observed: observedIdentity(bodyText) });

  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(bodyText);
});

server.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`proxy listening on http://127.0.0.1:${address.port}\n`);
  process.stdout.write(
    `proxy stage=${STAGE} requests=${MAX_REQUESTS} tokens=${MAX_INPUT_TOKENS}/${MAX_OUTPUT_TOKENS} ` +
      `per-request=${REQ_INPUT_CEILING}/${REQ_OUTPUT_CEILING} input-enforcement=${INPUT_ENFORCEMENT} ` +
      `model=${PINNED_MODEL} tier=${PINNED_TIER} effort=${PINNED_EFFORT} ledger=${LEDGER ?? '<disabled>'}\n`
  );
});
