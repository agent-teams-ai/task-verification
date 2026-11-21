# D1/D2 initial synthetic pilot — report

- Date: 2026-11-21
- Branch: `exp/synthetic-live-pilot-01` (experiment evidence only; PR #2 untouched)
- Authorization record: `AUTHORIZATION-D1-D2.md`
- Machine-readable record: `EXECUTION-RECORD.json`
- **Verdict: `BLOCKED — EXACT_COMPATIBILITY_ACCESS_OR_BUDGET_CAUSE`**

The Criteria Assessment path ran and produced a complete, frozen result. The ordinary OCR path was
**not dispatched**: its frozen invocation cannot complete inside the approved 20,000-byte transport
bound. No correction, no recheck and no Candidate B were created.

---

## 1. Repository and authorization state

| Check | Result |
| --- | --- |
| M2 HEAD | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4` — exact |
| M2 working tree | clean; branch `feat/m2-a-foundation-fixture-oracle` |
| PR #2 | `OPEN`, Draft, `headRefOid` = `996cdcb…` — not modified, not pushed |
| Experiment branch | `exp/synthetic-live-pilot-01` |
| Experiment HEAD before this run | `e4809ab399863f3fd56b00c6c8693f75b7b31a5c` (the reported `e4809ab…` value had 41 hex characters; the object is this commit) |
| Experiment tree before this run | clean |
| Frozen Base | `ce99b0d65d645124413a746ecb137b5497aad80f` — present |
| Frozen Candidate A | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` — present, `HEAD` of the fixture repository |
| Candidate B | **absent** (no ref, no commit, no tree) |
| Frozen digests | all four re-verified byte-identical (`ca868a3f…`, `9b48eb1b…`, `4ffebc0d…`, `85d60b7b…`) |

The maintainer's D1/D2 authorization is preserved verbatim in `AUTHORIZATION-D1-D2.md`, together with
the constraints it carries. Nothing frozen was modified to record it.

---

## 2. Gateway SDK `/llm` verification

This is the architecture finding the brief required before any criteria call.

### 2.1 Package and installed version

| Fact | Value |
| --- | --- |
| Package | `@agent-teams/account-gateway` |
| Version | `0.1.0` (`"private": true`; not published to any registry) |
| Entry used | `@agent-teams/account-gateway/llm` → `createLlmClient()` |
| Was it installed in this workspace? | **No.** `node_modules/@agent-teams` was absent and `require.resolve('@agent-teams/account-gateway/llm')` returned `MODULE_NOT_FOUND` |
| Reproduced from | `https://github.com/agent-teams-ai/account-gateway` at commit `539418d5935a9e336d480b128a1cdb93c1daa6e1`, tree `608b577e2da608b09d77ca2cf19661a82543185c` — both verified after checkout |
| Build | `node scripts/build.mjs` under **Node v24.21.0** and **pnpm 11.28.2** (the SDK's declared engine range `>=24.21.0 <25 \|\| >=26.10.0 <27`); exit 0, `dist/llm/index.js` produced |
| Version run | 0.1.0 from that build, not a substitute or a reimplementation |

No SDK interface was invented. The two injected ports below are the package's own declared ports.

### 2.2 Initialization arguments

```js
createLlmClient({
  control: { runAccess },        // ConsumerControlPort = Pick<ConsumerControlClient, "runAccess">
  connectExecution,              // ExecutionConnector = (grant) => { request, status, close }
  controlTimeoutMs?,             // 1..60000, default 10000 — bounds status/close only
  now?,                          // clock used for deadline admission
})
```

The client has **no configured host, URL or credential**. It calls `control.runAccess(intent)` to obtain
an admission document plus a bearer, and then calls the execution port with
`{ bearer, timeoutMs }`. In production `executionConnector({ origin, inferenceOrigin })` builds the
facade HTTP execution client per grant; the SDK also exports that connector.

**Scope note (material).** No account-gateway *service* is deployed in this environment, so the control
plane that issues admissions and owns account authority does not exist here. This run supplied the
control port locally (admission derived from the task's own intent, exactly as the M2 qualification
harness does) and supplied an execution port that performs the SDK-encoded request against the pilot's
loopback proxy. The SDK still performed every part it owns — request encoding, streaming, terminal
reduction, usage mapping, receipts and decoding. What the pilot does **not** have is the Gateway
service's server-side admission/accounting authority: the enforcing and accounting boundary for this
run is the bounded proxy, not the Gateway. If "through the existing Gateway SDK `/llm` path" is
intended to require a deployed Gateway control plane, that is not available here and would be a
separate access blocker.

### 2.3 `/llm` request and response contract

Request (`LlmTask`):

```
taskId, attempt, profileId, model, accountRefs[], policy{subjectRef, policyRevision, bindingRevision},
instructions, input (string | LlmMessage[]), output{mode:"json_schema"|"json_object"|"text", schema, strict},
effort?, maxOutputTokens, deadline (≤1h ahead), limits{outputBytes?}, decode?
```

Encoded body (`encodeResponsesRequest`): `model`, `instructions`, `input` as
`[{role, content:[{type:"input_text"|"output_text", text}]}]`, `stream:true`, `store:false`,
`service_tier:"default"`, `max_output_tokens`, `reasoning:{effort}` **only when an effort is given**,
and `text.format = {type:"json_schema", name:"codex_output_schema", strict, schema}`.

Response: the SSE stream is reduced to `Generation {status, incompleteReason, text, refused, usage,
observedModel, responseId}` and settled into
`LlmSuccess {ok, value, text, usage{inputTokens, outputTokens, cachedInputTokens, reasoningTokens},
receipt{executionRef, requestRef, accountRef, authorizationEpoch, taskId, attempt, profileId, model,
observedModel, responseId, requestSha256, outputSha256}, cleanup}`.

### 2.4 Model identifiers, reasoning and routing

| Item | Finding |
| --- | --- |
| Supported model identifiers | The SDK validates only that `model` is non-empty text. There is **no client-side allowlist**; model qualification is stated as gateway authority. `openai/gpt-6.1-terra` was accepted and served |
| Reasoning effort | `effort` ∈ `minimal\|low\|medium\|high\|xhigh\|max\|ultra`, sent only when present. `medium` was sent and accepted (provider reported 93 billed reasoning tokens) |
| Provider routing / fallback | One attempt = **one dispatch**. The library never retries and never falls back; `retry` is advice only (`never` / `same_attempt` / `new_attempt`) |
| Timeout | `task.deadline` drives an AbortController; the grant carries `timeoutMs = remaining + 1000`; `controlTimeoutMs` bounds status/close |
| Retries | none, at any layer |
| Token usage | Mapped from the provider's terminal event; a missing count stays `null` rather than a guess |
| Billing metadata | The SDK reports usage, not cost. Cost authority is the provider's own generation record |
| Can OpenRouter serve as upstream? | **Yes.** The execution port is an injected capability, and the request the SDK encoded was accepted by OpenRouter for the exact approved model with medium reasoning |

---

## 3. Provider and model settings — requested versus observed

| Field | Ordinary OCR | Criteria Assessment |
| --- | --- | --- |
| Engine | `open-code-review 1.13.1-rr.7` linux/amd64, SHA-256 `2f290fb4…4aaa29` | SDK `@agent-teams/account-gateway@0.1.0` (`/llm`) |
| Requested model | `openai/gpt-6.1-terra` | `openai/gpt-6.1-terra` |
| Observed model | **none — no request dispatched** | `openai/gpt-6.1-terra` (SDK receipt `observedModel`) |
| Provider-side model record | none | `openai/gpt-6.1-terra-20261026` |
| Requested provider | OpenRouter | OpenRouter |
| Observed provider | none | `OpenAI` (provider's own generation record) |
| Reasoning requested | `medium` (`reasoning.effort`) | `medium` (`effort`) |
| Reasoning accepted/observed | not observed | accepted; 93 billed reasoning tokens reported |
| Service tier | `default` | `default` (`service_tier` is hard-coded to `default` by the encoder) |
| Endpoint | `http://127.0.0.1:<port>/responses` → `https://openrouter.ai/api/v1/responses` | same proxy path |
| Fallback | none configured; managed mode rejects a non-loopback URL | none; one dispatch, no retry |
| Extra settings | rules `reviewrouter-managed-v1` unchanged, filtering unchanged (`--no-filter` not passed), background 2,605 chars | `output.mode=json_schema`, `strict`, `max_output_tokens=4000` |

The two observed names differ in a way that is expected and is not a substitution: the SDK reports the
model it saw in the response stream, while OpenRouter's generation record names the dated variant it
actually served and the upstream provider (`OpenAI`). Both are recorded rather than reconciled away.

---

## 4. Budget and enforcement

| Item | Value |
| --- | --- |
| Aggregate ceiling | USD 1.00 |
| Requests planned / used | 21 / **1** |
| Token ceilings planned (in/out) | 420,000 / 84,000 |
| Tokens used (authoritative) | 4,312 in / 578 out (93 of them reasoning) |
| Actual spend (provider record) | **USD 0.00827925** |
| Remaining budget | **USD 0.99172075** (≈ USD 0.992) |
| Proxy-modelled charge for that request | USD 0.04 (full reservation kept — see below) |

Enforcement before every request is the loopback proxy: request slot, then policy pin (`model`,
`service_tier`, `reasoning.effort`), then an atomic reservation at the maximum permitted request cost,
then forwarding. It refuses rather than clamps, and halts on a non-2xx, timeout, transport error or
absent usage. It cannot be bypassed by the SDK route: the SDK's execution port can reach only the
proxy, and the ledger and the provider generation record both show exactly one request.

### 4.1 A defect found by execution, and fixed

The first live request was charged the **full reservation** (20,000 in / 4,000 out = USD 0.04) and the
proxy halted with `usage_unreliable`, because it looked for `usage` in a parsed JSON body — but the
Responses API returns **SSE** when `stream:true`, so usage that was present was treated as absent.
The provider's own record shows the truth: 4,312 / 578 tokens, USD 0.00827925.

That is a violation of the accounting rule (authoritative usage existed and was not read), so it was
fixed: terminal usage is now taken from the streamed `response.completed` frame. The proxy audit grew
one regression test and passes **18/18** (was 17/17). The halt-on-absent-usage rule is unchanged and
still covered.

**The fix was committed after this request**, so the charge recorded in `evidence/ledger-criteria.jsonl`
is the pre-fix reservation, not a spend. The spend is the provider figure.

---

## 5. The input-width gate — the blocking finding

The approved transport bound is **20,000 bytes** of serialized request body, which proves
`tokens ≤ 20,000` because every token spans at least one byte. The frozen OCR invocation was run
offline against the proxy in `--offline` mode (`MODE=offline ./run-ocr.sh`) — a local stub, no provider,
no credential used, **zero spend** — to measure the real bodies rr.7 emits for Candidate A.

| Request | Bytes | Result |
| --- | --- | --- |
| 1 | 1,502 | forwarded (offline) |
| 2 | 15,842 | forwarded (offline) |
| 3 | 16,266 | forwarded (offline) |
| **4** | **20,645** | **refused `proxy_input_ceiling_exceeded`** |
| 5 | 18,188 | forwarded (offline) |
| 6 | 16,404 | forwarded (offline) |
| 7 | — | refused `request_cap` (rr.7 re-entering after the refusal) |

The first request fits comfortably. **One of the six required requests is 645 bytes (3.2%) over the
bound**, and the frozen brief forbids every available way to make it fit:

- truncating the frozen requirements — forbidden;
- dropping the unchanged context or the frozen reviewer-input contract — forbidden;
- silently raising the proxy ceiling — forbidden;
- using the `chars/4` estimate instead of a provable bound — explicitly not a bound.

A tokenizer-based bound was considered and rejected as not narrowly verifiable here: the model is
served through OpenRouter with no published tokenizer for this endpoint, so a token count could not be
proved before dispatch, and an unprovable estimate would weaken the ceiling the brief requires.

Consequence: the ordinary OCR stage cannot complete. It was **not dispatched**, so no budget was spent
on a run that could not produce a report. The stage remains armed (6 requests, 120,000 in / 24,000 out,
USD 0.24 worst case) and unspent.

---

## 6. Network and credential isolation

| Check | Result |
| --- | --- |
| Credential present in the execution process | **yes** (boolean test only; value never read into an artifact) |
| Credential in any ledger, log, report or commit | **no** — proxy audit test "the credential never reaches the ledger or the proxy output" passes |
| Provider key spending restriction | **not met** — the key limit is **USD 5.00**, not USD 1.00. The provider-side hard stop is therefore USD 5.00; the operative boundary is the proxy (USD 1.00 aggregate by construction). Lowering the key limit mutates the account beyond this run, so it was reported rather than changed |
| Old compromised key revoked | **unverified.** The current key reports `usage 0`, expiry `2026-11-28T17:15:38Z` and a distinct label — consistent with a rotated key, but this is not evidence that the old key was revoked; that needs the dashboard |
| OCR container credential isolation | not exercised live (stage blocked). The prepared design keeps the credential in a proxy container and joins the OCR container to its network namespace, so rr.7's only reachable inference endpoint is `127.0.0.1` and its environment is an explicit allowlist |
| SDK route cannot bypass accounting | **holds** — one dispatch, one ledger entry, one provider generation record |
| Credential printed or hashed into output | **no** |

---

## 7. Original ordinary checks

| Item | Value |
| --- | --- |
| Definition | `package.json#scripts.test` (the only check the project defines) |
| Command | `npm test` → `node --experimental-strip-types --test --test-concurrency=1 tests/*.test.ts` |
| Git SHA | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` |
| Tests | 21 |
| Passed / failed | 21 / 0 |
| Exit status | **0** |
| Output | `evidence/ordinary-checks.txt` |
| Hidden evaluator tests added to the suite | **no** |

---

## 8. Ordinary OCR — not dispatched

| Capture requested | State |
| --- | --- |
| Native OCR findings | none — not run |
| Normalized findings | none |
| Filtered / suppressed findings | none |
| Consumer-visible OCR report | none |
| Underlying inference requests | **0** |
| Usage and cost evidence | 0 / USD 0.00 |
| Requested settings | `openai/gpt-6.1-terra`, `service_tier=default`, `reasoning.effort=medium`, rules `reviewrouter-managed-v1` unchanged, filtering unchanged, background 2,605 chars |
| Observed settings | none (no dispatch) |
| `--no-filter` | not passed |
| Additional attempts to improve the result | none |

Nothing about the OCR path's quality is claimed. The refusal is a transport-width finding, not a
statement about the reviewer.

---

## 9. Criteria Assessment — findings

One request, 18,194 bytes, one dispatch, no retry. Raw text: `evidence/criteria-output.txt`; full
record: `evidence/criteria-assessment.json`.

| Requirement | Status | Evidence given | Explanation |
| --- | --- | --- | --- |
| **R1 — list records** | `satisfied` | `src/router.ts` (`handle: GET /records`); `src/records.ts` (`parseListQuery`, `matches`, `listRecords`); `tests/records.test.ts` | The service exposes a listing that applies the supported filters before pagination and reports the filtered total |
| **R2 — UTC formatting** | `satisfied` | `src/records.ts` (`listRecords: createdAt mapping`); `src/format.ts` (`toUtcIsoString`); `tests/records.test.ts` | Each returned timestamp is rendered through the shared UTC formatter |
| **R3 — CSV export** | `violated` | `src/router.ts` (only `GET /health` and `GET /records` are routed); `src/csv.ts` (`escapeCsvField`, `toCsvRow`); `tests/csv.test.ts` | The CSV helper exists and is unit-tested, but no service route produces a CSV export |

Actionable correction offered for R3: add a service-accessible CSV export that applies the listing's
`status` and `nameContains` filters, emits column headers, and uses the shared CSV helper to escape
fields.

The path did not infer the gap from the diff alone: it read the unchanged `src/csv.ts` and `src/store.ts`
context and the router before concluding that the helper's existence is not a capability.

---

## 10. Comparison — what can and cannot be said

| | Ordinary OCR | Criteria Assessment |
| --- | --- | --- |
| Ran | no — blocked before dispatch | yes, one request |
| Identified R1 / R2 | not established | satisfied / satisfied |
| Identified R3 gap | not established | violated, with a correction |
| False objections | not established | none raised |
| Inconclusive findings | not established | none |
| Feedback a coding agent could act on | not established | one concrete R3 correction |

**No comparison of reviewer capability is made.** With one path absent, any statement that the criteria
path found what the other missed would be an artifact of the OCR path never having been asked. No claim
of superiority is made, and the hidden evaluator was not consulted.

---

## 11. Checkpoint

Stopped after freezing what could be produced. No Candidate B, no correction, no recheck, no evaluator
material disclosed, no further model calls. The remaining budget is preserved for the correction and
recheck cycle.

## 12. Exact remaining cause

**The ordinary OCR invocation cannot complete inside the approved 20,000-byte transport bound:**
one of its six required requests is **20,645 bytes** (645 over), while the first request is 1,502 bytes.
Everything else for that stage is ready — verified binary, recovered rule text, unchanged filtering,
loopback-only managed config, a proxy that now reads streamed usage correctly, and enough budget
(USD 0.992 remaining) for all three planned OCR stages.

Two ways forward, both requiring the maintainer:

1. **Approve a wider bound for this fixture** (at least 20,645 bytes per request) together with the
   stage token cap that makes it safe. A 6-request stage at a 21,000-byte reservation costs at most
   USD 0.246 (126,000 input × USD 1/1M + 24,000 output × USD 5/1M), so the six-stage worst case becomes
   USD 0.858 — still inside USD 1.00 with USD 0.142 unused.
2. **Approve a narrower reviewer-input contract for the OCR path** (for example, the PR background
   without the full frozen requirements), which keeps the 20,000-byte bound but changes what the OCR
   path is shown and therefore what the comparison can fairly claim.

A third option — exact token-level enforcement — needs a tokenizer for the served endpoint that does
not exist publicly, so it is not offered as a quick fix.
