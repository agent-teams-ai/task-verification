#!/usr/bin/env node
/**
 * Bounded, recording loopback proxy between the pinned rr.7 managed OCR binary
 * and OpenRouter.
 *
 * Topology (required by the managed contract): the binary's `custom_providers`
 * URL must be loopback (`http://127.0.0.1:<port>`), so this proxy is the only
 * component that ever holds the provider credential. It is therefore also the
 * transport boundary where request count is enforced and usage is recorded.
 *
 * Credential rules:
 * - Reads OPENROUTER_API_KEY and OPENROUTER_BASE_URL only.
 * - Never falls back to OPENAI_API_KEY / OPENAI_BASE_URL.
 * - Never writes, logs, echoes or serializes the credential: the ledger records
 *   only method, path, model, byte counts, token accounting and status.
 *
 * Enforcement:
 * - Hard request cap (--max-requests). Request N+1 is refused with 429 and is
 *   never forwarded upstream, so it cannot cost anything.
 * - Injects `max_output_tokens` when the caller did not set one.
 * - Charging policy: reported `usage` when present, otherwise the declared
 *   per-request ceiling. `chargedTokens` is always max(reported, floor) so a
 *   response with missing usage fields is never treated as free.
 *
 * Usage:
 *   node openrouter-bounded-proxy.mjs --max-requests 6 --ledger <path>
 *   node openrouter-bounded-proxy.mjs --offline --max-requests 3   (self-test)
 */

import http from 'node:http';
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

const UPSTREAM_BASE = (args.upstream ?? process.env.OPENROUTER_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '');
const API_KEY = (process.env.OPENROUTER_API_KEY ?? '').trim();
const OFFLINE = Boolean(args.offline);
const MAX_REQUESTS = Number(args['max-requests'] ?? 6);
const MAX_OUTPUT_TOKENS = Number(args['max-output-tokens'] ?? 4000);
const MAX_INPUT_TOKENS = Number(args['max-input-tokens'] ?? 20000);
const LEDGER = typeof args.ledger === 'string' ? args.ledger : null;
const PORT = Number(args.port ?? 0);

if (!Number.isInteger(MAX_REQUESTS) || MAX_REQUESTS < 1) {
  process.stderr.write('proxy: --max-requests must be a positive integer\n');
  process.exit(2);
}

// Fail closed. A proxy without an upstream or credential is a silent bypass.
if (!OFFLINE) {
  if (API_KEY === '') {
    process.stderr.write('proxy: OPENROUTER_API_KEY is not set; refusing to start\n');
    process.exit(2);
  }
  if (!/^https:\/\/[^/]+/.test(UPSTREAM_BASE)) {
    process.stderr.write('proxy: OPENROUTER_BASE_URL is not an https origin; refusing to start\n');
    process.exit(2);
  }
}

// Coarse input estimate only (never authoritative). Used to refuse a request
// that is obviously over the ceiling before it can be billed.
const estimateTokens = (text) => (text.length === 0 ? 0 : Math.ceil(text.length / 4));

let requestCount = 0;
let chargedIn = 0;
let chargedOut = 0;

function record(entry) {
  if (LEDGER === null) return;
  fs.appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
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
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy_method_not_allowed' } }));
    return;
  }

  const raw = await readBody(req).catch(() => null);
  if (raw === null) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy_body_unreadable' } }));
    return;
  }

  // Hard cap: refuse before any upstream call, so the request cannot be billed.
  if (requestCount >= MAX_REQUESTS) {
    record({ i: null, refused: 'request_cap', cap: MAX_REQUESTS, at: new Date().toISOString() });
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'proxy_request_cap_exceeded', type: 'proxy_budget', code: 'request_cap' },
      })
    );
    return;
  }

  requestCount += 1;
  const index = requestCount;

  let parsed = null;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    parsed = null;
  }

  const estIn = estimateTokens(raw.toString('utf8'));
  if (estIn > MAX_INPUT_TOKENS) {
    record({ i: index, refused: 'input_ceiling', estimatedInputTokens: estIn, cap: MAX_INPUT_TOKENS });
    res.writeHead(413, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'proxy_input_ceiling_exceeded', type: 'proxy_budget' } }));
    return;
  }

  // Deterministic output ceiling; recorded so the manifest can prove it.
  let injectedOutput = null;
  if (parsed !== null && typeof parsed === 'object' && parsed.max_output_tokens === undefined) {
    parsed.max_output_tokens = MAX_OUTPUT_TOKENS;
    injectedOutput = MAX_OUTPUT_TOKENS;
  }
  const forwardBody = parsed === null ? raw : Buffer.from(JSON.stringify(parsed), 'utf8');

  const base = { i: index, model: parsed?.model ?? null, inputTokensEstimate: estIn };

  if (OFFLINE) {
    const usage = { input_tokens: estIn, output_tokens: 0 };
    record({
      ...base,
      status: 200,
      offline: true,
      usage,
      chargedInputTokens: estIn,
      chargedOutputTokens: 0,
      injectedMaxOutputTokens: injectedOutput,
    });
    chargedIn += estIn;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ id: `offline-${index}`, object: 'response', model: base.model, output: [], usage })
    );
    return;
  }

  const target = `${UPSTREAM_BASE}/responses`;
  const upstream = http
    ? await new Promise((resolve) => {
        const url = new URL(target);
        const client = (url.protocol === 'https:' ? import('node:https') : import('node:http'));
        client.then((mod) => {
          const request = mod.request(
            {
              protocol: url.protocol,
              hostname: url.hostname,
              port: url.port || (url.protocol === 'https:' ? 443 : 80),
              path: `${url.pathname}${url.search}`,
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${API_KEY}`,
                'content-length': Buffer.byteLength(forwardBody),
              },
              timeout: 150_000,
            },
            (response) => {
              const chunks = [];
              response.on('data', (chunk) => chunks.push(chunk));
              response.on('end', () =>
                resolve({ status: response.statusCode, body: Buffer.concat(chunks) })
              );
            }
          );
          request.on('timeout', () => request.destroy(new Error('proxy_upstream_timeout')));
          request.on('error', (error) => resolve({ status: 502, body: Buffer.from(String(error)) }));
          request.end(forwardBody);
        });
      })
    : null;

  const status = upstream?.status ?? 502;
  const bodyText = upstream?.body?.toString('utf8') ?? '';

  let usage = null;
  try {
    const decoded = JSON.parse(bodyText);
    usage = decoded?.usage ?? null;
  } catch {
    usage = null;
  }

  // Never treat a successful response as free because usage was absent.
  const chargedInput = Math.max(Number(usage?.input_tokens ?? 0), estIn);
  const chargedOutput = Math.max(Number(usage?.output_tokens ?? 0), 0);
  chargedIn += chargedInput;
  chargedOut += chargedOutput;

  record({
    ...base,
    status,
    usage,
    usagePresent: usage !== null,
    chargedInputTokens: chargedInput,
    chargedOutputTokens: chargedOutput,
    injectedMaxOutputTokens: injectedOutput,
    totalRequestsSoFar: requestCount,
    chargedInputTokensTotal: chargedIn,
    chargedOutputTokensTotal: chargedOut,
  });

  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(bodyText);
});

server.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`proxy listening on http://127.0.0.1:${address.port}\n`);
  process.stdout.write(`proxy max-requests=${MAX_REQUESTS} ledger=${LEDGER ?? '<disabled>'}\n`);
});
