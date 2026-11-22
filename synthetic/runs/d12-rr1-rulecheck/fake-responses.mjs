#!/usr/bin/env node
// Deterministic, model-free OpenAI Responses provider for the D1/D2 compatibility
// stage of the QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE.
//
// Shapes mirror the candidate's own CI qualification provider
// (tools/managed/qualification/main.go at the qualified commit), extended to the
// real frozen fixture so the grouping contract, managed tool loop, filtering
// phase, findings/normalization and terminal-state contracts are exercised with
// no provider, no credential and no spend.
//
// Modes:
//   onegroup -> grouping reply puts every changed file in a single group
//   split    -> grouping reply puts each changed file in its own group
//
// Every request body is captured (bounded) to --capture. Never touches a
// credential.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, token, i, all) => {
    if (!token.startsWith('--')) return acc;
    const next = all[i + 1];
    acc.push([token.slice(2), next === undefined || next.startsWith('--') ? true : next]);
    return acc;
  }, []),
);

const PORT = Number(args.port ?? 8901);
const OUT = args.out ?? '/run';
const MODE = args.mode ?? 'onegroup';
const MODEL = args.model ?? 'openai/gpt-6.1-terra';
const CAPTURE = typeof args.capture === 'string' ? args.capture : path.join(OUT, 'fake-requests.jsonl');
const ADDED = fs.existsSync(path.join(OUT, 'added-lines.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'added-lines.json'), 'utf8'))
  : {};

fs.rmSync(CAPTURE, { force: true });

let served = 0;
const commentedGroups = new Set();
const readsByGroup = new Map();
const CONTEXT_CALLS = args.context === 'true' || args.context === true;

const sse = (res, body) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: response.completed\ndata: ${JSON.stringify(body)}\n\n`);
};

const messageItem = (n, text) => ({
  type: 'message',
  id: `msg_${n}`,
  status: 'completed',
  role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }],
});

const callItem = (n, name, callArgs) => ({
  type: 'function_call',
  id: `fc_${n}`,
  call_id: `call_${n}`,
  name,
  arguments: JSON.stringify(callArgs),
});

const textOf = (body) =>
  Array.isArray(body?.input)
    ? body.input.map((m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''))).join('\n')
    : String(body?.input ?? '');

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    served += 1;
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const tools = Array.isArray(body?.tools) ? body.tools.map((t) => t?.name).filter(Boolean) : [];
    const text = textOf(body);
    const groupPaths = [...text.matchAll(/<file path="([^"]+)">/g)].map((m) => m[1]);
    const indexed = [...text.matchAll(/\[(\d+)\]\s+\S+\s+(\S+)/g)].map((m) => ({ index: Number(m[1]), path: m[2] }));

    fs.appendFileSync(
      CAPTURE,
      `${JSON.stringify({
        i: served,
        bytes: Buffer.byteLength(raw, 'utf8'),
        model: body?.model ?? null,
        serviceTier: body?.service_tier ?? null,
        reasoning: body?.reasoning ?? null,
        stream: body?.stream ?? null,
        store: body?.store ?? null,
        maxOutputTokens: body?.max_output_tokens ?? null,
        promptCacheKey: body?.prompt_cache_key ?? null,
        tools,
        groupPaths,
        body: raw.length > 400_000 ? `${raw.slice(0, 400_000)}<truncated>` : raw,
        toolSchemas: Array.isArray(body?.tools) ? body.tools : [],
      })}\n`,
    );

    if (req.url !== '/responses' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fake_provider_route' } }));
      return;
    }
    if (body?.model !== MODEL) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fake_provider_model_mismatch', got: body?.model ?? null } }));
      return;
    }

    const base = {
      id: `resp_${served}`,
      object: 'response',
      status: 'completed',
      model: MODEL,
      usage: { input_tokens: 1200, output_tokens: 60, total_tokens: 1260 },
    };

    // ---- grouping turn: plain-text JSON array of groups --------------------
    if (tools.length === 0) {
      const groups =
        MODE === 'split'
          ? indexed.map(({ index, path: p }) => ({ label: p, files: [index] }))
          : [{ label: 'records listing api', files: indexed.map((e) => e.index) }];
      sse(res, { type: 'response.completed', response: { ...base, output: [messageItem(served, JSON.stringify(groups))] } });
      return;
    }

    // ---- filtering phase ---------------------------------------------------
    // The candidate lists the candidate comments as a JSON array under
    // "### Review Comments". A comment whose subject is not in this diff is the
    // one case the filter is allowed to remove, so the fixture rejects exactly
    // the README comment and approves everything else.
    if (tools.includes('approve_all_comments')) {
      const section = text.split('### Review Comments')[1] ?? '';
      let candidates = [];
      const start = section.indexOf('[');
      if (start >= 0) {
        let depth = 0;
        for (let i = start; i < section.length; i += 1) {
          if (section[i] === '[') depth += 1;
          else if (section[i] === ']') {
            depth -= 1;
            if (depth === 0) {
              try {
                candidates = JSON.parse(section.slice(start, i + 1));
              } catch {
                candidates = [];
              }
              break;
            }
          }
        }
      }
      const removable = Array.isArray(candidates)
        ? candidates.filter((c) => typeof c?.path === 'string' && /README\.md$/.test(c.path)).map((c) => c.id)
        : [];
      if (removable.length > 0) {
        sse(res, {
          type: 'response.completed',
          response: {
            ...base,
            output: [
              callItem(served, 'report_incorrect_comments', {
                analysis: removable.map((id) => `${id}: the README table line it targets is not in this diff`),
                comment_ids: removable,
              }),
            ],
          },
        });
        return;
      }
      sse(res, { type: 'response.completed', response: { ...base, output: [callItem(served, 'approve_all_comments', {})] } });
      return;
    }

    // ---- main review turn --------------------------------------------------
    const groupKey = groupPaths.slice().sort().join(',');
    // Reproduce the context-tool loop the live run performed (6 file_read plus
    // one code_search) one call per turn, so the resulting body growth is
    // measured model-free rather than guessed.
    if (CONTEXT_CALLS && tools.includes('file_read')) {
      const read = readsByGroup.get(groupKey) ?? 0;
      if (read < Math.min(groupPaths.length, 6)) {
        readsByGroup.set(groupKey, read + 1);
        sse(res, {
          type: 'response.completed',
          response: { ...base, output: [callItem(served, 'file_read', { file_path: groupPaths[read] })] },
        });
        return;
      }
      if (read === Math.min(groupPaths.length, 6) && tools.includes('code_search')) {
        readsByGroup.set(groupKey, read + 1);
        sse(res, {
          type: 'response.completed',
          response: { ...base, output: [callItem(served, 'code_search', { search_text: 'toUtcIsoString' })] },
        });
        return;
      }
    }
    if (tools.includes('code_comment') && !commentedGroups.has(groupKey)) {
      commentedGroups.add(groupKey);
      // One finding per reviewed file, so the filter phase has a genuine
      // keep/reject decision to make and the suppressed finding is observable.
      const comments = groupPaths
        .filter((p) => ADDED[p])
        .map((p) => ({
          path: p,
          existing_code: ADDED[p],
          category: 'bug',
          severity: /README\.md$/.test(p) ? 'low' : 'medium',
          content: /README\.md$/.test(p)
            ? 'Deterministic fixture finding on documentation: the endpoint table is claimed to omit a route.'
            : 'Deterministic compatibility finding emitted by the model-free fixture provider.',
        }));
      if (comments.length > 0) {
        sse(res, {
          type: 'response.completed',
          response: { ...base, output: [callItem(served, 'code_comment', { comments })] },
        });
        return;
      }
    }
    sse(res, {
      type: 'response.completed',
      response: { ...base, output: [callItem(served, 'task_done', { state: 'DONE' })] },
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`fake-responses listening on http://127.0.0.1:${PORT} mode=${MODE} capture=${CAPTURE}\n`);
});
