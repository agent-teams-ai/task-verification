#!/usr/bin/env node
/**
 * Model-free proof that the bounded proxy enforces its request cap and records
 * accounting without exposing the credential.
 *
 * Runs entirely offline: the proxy is started with --offline, so no provider is
 * contacted and no inference occurs. The credential is set to an obviously
 * synthetic sentinel and is never sent anywhere.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SENTINEL = 'selftest-not-a-credential';
const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-selftest-')), 'ledger.jsonl');

const proxy = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('./openrouter-bounded-proxy.mjs', import.meta.url)),
    '--offline',
    '--max-requests',
    '3',
    '--ledger',
    ledger,
  ],
  {
    env: { PATH: process.env.PATH, OPENROUTER_API_KEY: SENTINEL },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

const port = await new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error('selftest: proxy did not start')), 10_000);
  proxy.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const match = buffer.match(/127\.0\.0\.1:(\d+)/);
    if (match) {
      clearTimeout(timer);
      resolve(Number(match[1]));
    }
  });
  proxy.stderr.on('data', (chunk) => process.stderr.write(chunk));
});

const call = (i) =>
  fetch(`http://127.0.0.1:${port}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-capability' },
    body: JSON.stringify({ model: 'openai/gpt-6.1-terra', input: `selftest request ${i}` }),
  });

const statuses = [];
for (let i = 1; i <= 4; i += 1) statuses.push((await call(i)).status);
proxy.kill();

assert.deepEqual(statuses, [200, 200, 200, 429], `expected cap at 3, got ${statuses.join(',')}`);

const lines = fs
  .readFileSync(ledger, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));

const accepted = lines.filter((line) => line.status === 200);
const refused = lines.filter(
  (line) => line.decision === 'refused' && line.code === 'request_cap'
);

assert.equal(accepted.length, 3, 'exactly three requests may reach the upstream');
assert.equal(refused.length, 1, 'the fourth request must be refused before forwarding');
assert.ok(
  lines.every((line) => typeof line.i !== 'number' || line.injectedMaxOutputTokens === 4000),
  'the output ceiling must be injected on every accepted request'
);
assert.ok(
  accepted.every((line) => line.chargedInputTokens > 0),
  'every accepted request must be charged even when usage is absent'
);

const ledgerText = fs.readFileSync(ledger, 'utf8');
assert.ok(!ledgerText.includes(SENTINEL), 'the credential must never appear in the ledger');

process.stdout.write(
  [
    `statuses: ${statuses.join(',')}`,
    `accepted: ${accepted.length}, refused-before-forward: ${refused.length}`,
    `charged input tokens: ${accepted.reduce((sum, line) => sum + line.chargedInputTokens, 0)}`,
    `output ceiling injected: ${accepted.every((line) => line.injectedMaxOutputTokens === 4000)}`,
    'credential present in ledger: false',
    'provider contacted: false (offline mode)',
    'RESULT: PASS',
  ].join('\n') + '\n'
);
