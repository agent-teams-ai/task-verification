#!/usr/bin/env node
/**
 * Offline audit of the bounded proxy. No provider is contacted: every test uses
 * a local stub upstream via --allow-insecure-upstream.
 *
 * Failure policy for this suite: a failing assertion is left failing. Guards are
 * never relaxed to make a test pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROXY = fileURLToPath(new URL('./openrouter-bounded-proxy.mjs', import.meta.url));
const SENTINEL = 'audit-sentinel-credential-value';
const MODEL = 'openai/gpt-6.1-terra';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `proxy-audit-${name}-`));

function startStub(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push({ path: req.url, body });
      handler(req, res, body, calls.length);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function startProxy(args) {
  const ledger = path.join(tmp('ledger'), 'ledger.jsonl');
  const child = spawn(process.execPath, [PROXY, '--ledger', ledger, ...args], {
    env: { PATH: process.env.PATH, OPENROUTER_API_KEY: SENTINEL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`proxy did not start: ${stderr}`)), 10_000);
    child.stdout.on('data', () => {
      const match = stdout.match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({
          port: Number(match[1]),
          ledger,
          out: () => stdout + stderr,
          close: () => child.kill(),
          read: () =>
            fs.existsSync(ledger)
              ? fs
                  .readFileSync(ledger, 'utf8')
                  .trim()
                  .split('\n')
                  .filter(Boolean)
                  .map((line) => JSON.parse(line))
              : [],
        });
      }
    });
  });
}

const upstreamArgs = (stubPort, extra = []) => [
  '--upstream',
  `http://127.0.0.1:${stubPort}`,
  '--allow-insecure-upstream',
  ...extra,
];

function post(port, body, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const okUsage = (i = 1) => ({ model: MODEL, input: `request ${i}`, max_output_tokens: 100 });

test('exact request ceiling: N+1 is refused before forwarding', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '3', '--stage', 'ocr']));
  const statuses = [];
  for (let i = 1; i <= 4; i += 1) statuses.push((await post(proxy.port, okUsage(i))).status);
  proxy.close();
  stub.close();
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  assert.equal(stub.calls.length, 3, 'the refused request must never reach the upstream');
});

test('concurrent requests cannot exceed the request cap', async () => {
  const stub = await startStub((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
    }, 40);
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '3']));
  const results = await Promise.all(Array.from({ length: 8 }, (_v, i) => post(proxy.port, okUsage(i))));
  const statuses = results.map((r) => r.status);
  proxy.close();
  stub.close();
  assert.equal(statuses.filter((s) => s === 200).length, 3);
  assert.equal(statuses.filter((s) => s === 429).length, 5);
  assert.equal(stub.calls.length, 3);
});

test('atomic token reservation blocks concurrent overspend', async () => {
  const stub = await startStub((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ usage: { input_tokens: 20000, output_tokens: 4000 } }));
    }, 40);
  });
  // 45,000 input cap admits two 20,000 reservations, never three.
  const proxy = await startProxy(
    upstreamArgs(stub.port, ['--max-requests', '8', '--max-input-tokens', '45000'])
  );
  const results = await Promise.all(Array.from({ length: 6 }, (_v, i) => post(proxy.port, okUsage(i))));
  const statuses = results.map((r) => r.status);
  proxy.close();
  stub.close();
  assert.equal(statuses.filter((s) => s === 200).length, 2, `statuses=${statuses.join(',')}`);
  assert.equal(statuses.filter((s) => s === 429).length, 4);
  assert.equal(stub.calls.length, 2);
});

test('failed upstream response consumes budget and halts', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream_failed' } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const first = await post(proxy.port, okUsage());
  const second = await post(proxy.port, okUsage(2));
  const ledger = proxy.read();
  proxy.close();
  stub.close();
  assert.equal(first.status, 500);
  assert.equal(second.status, 402, 'no retry may pass a halted proxy');
  assert.equal(stub.calls.length, 1);
  const forwarded = ledger.filter((l) => l.decision === 'forwarded');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].chargedInputTokens, 20000, 'ambiguous outcome keeps the full reservation');
  assert.equal(forwarded[0].chargedOutputTokens, 4000);
});

test('timeout after forwarding charges the reservation and halts', async () => {
  const stub = await startStub((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
    }, 600);
  });
  const proxy = await startProxy(
    upstreamArgs(stub.port, ['--max-requests', '6', '--request-timeout-ms', '120'])
  );
  const first = await post(proxy.port, okUsage());
  const second = await post(proxy.port, okUsage(2));
  const ledger = proxy.read();
  proxy.close();
  stub.close();
  assert.equal(first.status, 504);
  assert.equal(second.status, 402);
  const forwarded = ledger.filter((l) => l.decision === 'forwarded');
  assert.equal(forwarded[0].chargedInputTokens, 20000);
  assert.equal(forwarded[0].halted, 'ambiguous_upstream_outcome');
});

test('missing usage is never charged as zero or a floor', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'no-usage', object: 'response' }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const first = await post(proxy.port, okUsage());
  const second = await post(proxy.port, okUsage(2));
  const ledger = proxy.read();
  proxy.close();
  stub.close();
  assert.equal(first.status, 200);
  assert.equal(second.status, 402, 'unknown cost must stop further execution');
  const forwarded = ledger.filter((l) => l.decision === 'forwarded');
  assert.equal(forwarded[0].usagePresent, false);
  assert.equal(forwarded[0].chargedInputTokens, 20000);
  assert.equal(forwarded[0].chargedOutputTokens, 4000);
  assert.equal(forwarded[0].halted, 'usage_unreliable');
});

test('streamed terminal usage is authoritative and does not halt the stage', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      'event: response.output_text.delta\ndata: ' +
        JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' }) +
        '\n\n',
    );
    res.end(
      'event: response.completed\ndata: ' +
        JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'resp_sse',
            model: MODEL,
            provider: 'openai',
            usage: {
              input_tokens: 1234,
              output_tokens: 56,
              output_tokens_details: { reasoning_tokens: 7 },
            },
          },
        }) +
        '\n\n',
    );
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const first = await post(proxy.port, okUsage());
  const second = await post(proxy.port, okUsage(2));
  const ledger = proxy.read();
  proxy.close();
  stub.close();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200, 'reported usage must not stop the stage');
  const forwarded = ledger.filter((l) => l.decision === 'forwarded');
  assert.equal(forwarded[0].usagePresent, true);
  assert.equal(forwarded[0].chargedInputTokens, 1234);
  assert.equal(forwarded[0].chargedOutputTokens, 56);
  assert.equal(forwarded[0].observedModel, MODEL);
  assert.equal(forwarded[0].observedProvider, 'openai');
  assert.equal(forwarded[0].halted, null);
});

test('oversized input is refused before forwarding', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const huge = { model: MODEL, input: 'x'.repeat(20000 * 4 + 100) };
  const response = await post(proxy.port, huge);
  proxy.close();
  stub.close();
  assert.equal(response.status, 413);
  assert.equal(stub.calls.length, 0);
});

test('a caller-declared output ceiling above the pin is refused', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const response = await post(proxy.port, { model: MODEL, input: 'small', max_output_tokens: 9000 });
  proxy.close();
  stub.close();
  assert.equal(response.status, 413);
  assert.equal(stub.calls.length, 0);
});

test('aggregate token budget exhaustion refuses before forwarding', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 20000, output_tokens: 4000 } }));
  });
  const proxy = await startProxy(
    upstreamArgs(stub.port, ['--max-requests', '6', '--max-input-tokens', '25000'])
  );
  const first = await post(proxy.port, okUsage());
  const second = await post(proxy.port, okUsage(2));
  const body = await second.json();
  proxy.close();
  stub.close();
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(body.error.code, 'token_budget_exhausted');
  assert.equal(stub.calls.length, 1);
});

test('an unexpected model is refused and never billed', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const response = await post(proxy.port, { model: 'openai/gpt-5-mini', input: 'x' });
  const body = await response.json();
  proxy.close();
  stub.close();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'proxy_policy_model');
  assert.equal(stub.calls.length, 0);
});

test('an unexpected service tier is refused and never billed', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const response = await post(proxy.port, { model: MODEL, input: 'x', service_tier: 'flex' });
  const body = await response.json();
  proxy.close();
  stub.close();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'proxy_policy_service_tier');
  assert.equal(stub.calls.length, 0);
});

test('an unexpected reasoning effort is refused and never billed', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const response = await post(proxy.port, {
    model: MODEL,
    input: 'x',
    reasoning: { effort: 'high' },
  });
  const body = await response.json();
  proxy.close();
  stub.close();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'proxy_policy_reasoning_effort');
  assert.equal(stub.calls.length, 0);
});

test('the credential never reaches the ledger or the proxy output', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 5, output_tokens: 2 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '2']));
  await post(proxy.port, okUsage(), { authorization: `Bearer ${SENTINEL}` });
  await post(proxy.port, okUsage(2), { authorization: `Bearer ${SENTINEL}` });
  const ledgerText = fs.readFileSync(proxy.ledger, 'utf8');
  const captured = JSON.stringify(stub.calls);
  proxy.close();
  stub.close();
  assert.ok(!ledgerText.includes(SENTINEL), 'ledger must not contain the credential');
  assert.ok(!proxy.out().includes(SENTINEL), 'proxy output must not contain the credential');
  assert.ok(!captured.includes(SENTINEL), 'the caller-supplied Authorization header is replaced, not forwarded');
});

test('non-inference traffic is refused and does not consume request budget', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '1']));
  const models = await fetch(`http://127.0.0.1:${proxy.port}/models`, { method: 'POST' });
  const ok = await post(proxy.port, okUsage());
  proxy.close();
  stub.close();
  assert.equal(models.status, 404);
  assert.equal(ok.status, 200, 'a non-inference call must not consume the inference budget');
});

test('per-stage budgets are independent and labelled', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  const ledgerDir = tmp('stage');
  const ledgerPath = path.join(ledgerDir, 'stage.jsonl');
  const runStage = async (stage) => {
    const child = spawn(
      process.execPath,
      [
        PROXY,
        '--upstream',
        `http://127.0.0.1:${stub.port}`,
        '--allow-insecure-upstream',
        '--stage',
        stage,
        '--max-requests',
        '2',
        '--ledger',
        ledgerPath,
      ],
      { env: { PATH: process.env.PATH, OPENROUTER_API_KEY: SENTINEL }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const port = await new Promise((resolve) => {
      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const match = buffer.match(/127\.0\.0\.1:(\d+)/);
        if (match) resolve(Number(match[1]));
      });
    });
    const statuses = [];
    for (let i = 1; i <= 3; i += 1) statuses.push((await post(port, okUsage(i))).status);
    child.kill();
    return statuses;
  };
  const initial = await runStage('initial-ocr');
  const recheck = await runStage('recheck-ocr');
  const lines = fs
    .readFileSync(ledgerPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  stub.close();
  assert.deepEqual(initial, [200, 200, 429], 'initial OCR stage enforces its own cap');
  assert.deepEqual(recheck, [200, 200, 429], 'recheck stage does not inherit or share the cap');
  assert.equal(lines.filter((l) => l.stage === 'initial-ocr').length, 3);
  assert.equal(lines.filter((l) => l.stage === 'recheck-ocr').length, 3);
});

test('the input ceiling is enforced on bytes, so the token bound is provable', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  // ~25,000 bytes but only ~6,250 by the chars/4 estimate: an estimate-based
  // guard would forward this, a byte-based bound refuses it.
  const body = { model: MODEL, input: 'a'.repeat(25_000) };
  const strict = await startProxy(upstreamArgs(stub.port, ['--max-requests', '4']));
  const est = await startProxy(
    upstreamArgs(stub.port, ['--max-requests', '4', '--input-enforcement', 'estimate'])
  );
  const strictResponse = await post(strict.port, body);
  const estResponse = await post(est.port, body);
  strict.close();
  est.close();
  stub.close();
  assert.equal(strictResponse.status, 413, 'bytes mode must refuse 25,000 bytes');
  assert.equal(estResponse.status, 200, 'estimate mode would have forwarded it — hence the byte default');
});

test('reported usage above the per-request ceiling halts the run', async () => {
  const stub = await startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ usage: { input_tokens: 25000, output_tokens: 9000 } }));
  });
  const proxy = await startProxy(upstreamArgs(stub.port, ['--max-requests', '6']));
  const first = await post(proxy.port, okUsage());
  const second = await post(proxy.port, okUsage(2));
  const ledger = proxy.read();
  proxy.close();
  stub.close();
  assert.equal(first.status, 200);
  assert.equal(second.status, 402, 'a ceiling breach must stop further execution');
  const forwarded = ledger.filter((l) => l.decision === 'forwarded');
  assert.equal(forwarded[0].chargedInputTokens, 25000, 'the truth is charged, not the reservation');
  assert.equal(forwarded[0].chargedOutputTokens, 9000);
  assert.equal(forwarded[0].halted, 'ceiling_breached_by_reported_usage');
});
