# D1/D2 initial synthetic pilot — QUALIFIED 1.14.0-rr.1 comparison report

- Date: 2026-11-21
- Comparator: **QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE**
- Branch: `exp/synthetic-live-pilot-01` (experiment evidence only; PR #2 untouched)
- Machine-readable record: `EXECUTION-RECORD.json`
- Artifact provenance: `evidence/artifact-provenance.json`
- Historical rr.7 stage (unchanged, preserved): `../d12-initial/`
- **Verdict: `INITIAL_COMPARISON_COMPLETE — AWAITING_ILIYA_FEEDBACK`**

This report is the original comparison for Iliya. It contains no evaluator annotation, no hidden
evaluator check, and no Candidate B. Recheck and correction are not started.

---

## 1. Qualified OCR artifact and provenance

Downloaded from CI run `44924052949` (workflow **Managed OCR CI**, event `push`, branch `main`,
conclusion `success`, job `verify` all steps `success`) in `agent-teams-ai/open-code-review` at commit
`8a70944f567beba9ffc12d1153e33ef5fd60967d`, tree `4b12dfb33be04127f0315303ccb01e8d158a882c`.

| Item | Value |
| --- | --- |
| Artifact name | `managed-ocr-8a70944f567beba9ffc12d1153e33ef5fd60967d` — exact match to the authorization |
| Artifact id / size | `14714439075` / 32,690,877 bytes (zip) |
| API zip digest | `sha256:aadbd95bf44983544df3da31c80bc13d5e4004be1a8602a3545e7ec36ee0e526` |
| Binary | `opencodereview-linux-amd64` |
| **Binary SHA-256** | **`443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399`** |
| Binary size | 87,356,967 bytes (matches `MANIFEST.binary_size_bytes`) |
| Platform / arch | linux / amd64, `goamd64=v1`, `CGO_ENABLED=0`, Go 1.26.11, statically linked ELF |
| Version | `1.14.0-rr.1` (stdio and `--version` both `open-code-review 1.14.0-rr.1 linux/amd64`, exit 0) |
| Outcome schema | `reviewrouter.ocr-outcome/v1` |
| CI qualification receipt | `passed: true`, `model_free: true`, 4/4 cases (openai-responses and anthropic × finding and missing-terminal) |
| Digest agreement | the `MANIFEST` value, the shipped `.sha256` file, and the local `sha256sum` all agree |

Authenticated against its own CI provenance: the `MANIFEST` binds the artifact to the source commit and
tree, and the run that produced it is the authorized run. No locally rebuilt substitute was used, and
the rr.7 digest was not assumed to apply.

Frozen identity for this stage (`COMPARATOR-IDENTITY.json`):

| Field | Value |
| --- | --- |
| Managed rules | `reviewrouter-managed-v1`, rule document `b3fd4702…` (620 B) — byte-identical to the rr.7 stage |
| Filtering | unchanged; `--no-filter` never passed; filter phase ran and completed |
| Requested model / provider | `openai/gpt-6.1-terra` / OpenRouter |
| Requested reasoning | `medium`; observed accepted (provider billed reasoning tokens) |
| Service tier | `default` (`service_tier` pinned by the proxy, hard-coded by the managed transport) |
| Background | 2,605 chars, `8a8a62ff…` — byte-identical to the rr.7 stage |
| Managed config | loopback-only, `2f1ef31e…` — no credential |
| Frozen Candidate A | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` |
| Frozen requirements | `ca868a3f…` |

---

## 2. Focused model-free compatibility verification

The candidate was run against the frozen fixture with a deterministic fake Responses provider behind
the audited proxy — no provider, no credential, no spend. The fake mirrors the shape of the
candidate's own CI qualification provider and is driven by the real diffs, grouping prompt, tool
schemas and filter contract captured from the candidate's own requests.

| Check | Result |
| --- | --- |
| CLI compatibility | all harness flags still exist and are accepted: `--reviewrouter-managed`, `--provider`, `--model`, `--rule`, `--background-file`, `--effort`, `--concurrency`, `--format`, `--audience`, `--timeout`, `--max-tokens-budget` |
| Managed configuration parsing | private 0600 config accepted; non-loopback URL rejected by construction; `extra_body` limited to `service_tier` + `reasoning` |
| `reviewrouter-managed-v1` serialization | rule document reproduced byte-identically; `include` paths became the review groups; findings were only ever raised on assigned paths |
| Normal filtering | filter phase ran (`approve_all_comments` / `report_incorrect_comments`), state `completed`, `filter_decision_valid: true`; a fixture comment the diff disproved was suppressed (4 emitted → 3 consumer-visible) |
| Native findings | `code_comment` tool calls produced normalized comments with `path`, `existing_code`, `start_line`/`end_line`, `category`, `severity`, `content` |
| Normalization contract | added-line anchoring resolved to line numbers; out-of-group or unmountable comments are not emitted |
| Consumer-visible contract | JSON result carries `status`, `comments`, `summary`, `tool_calls`, `groups`, `manifest`, `reviewrouter_outcome` |
| OpenAI Responses compatibility | SSE `response.completed` parsing, multi-turn tool loop, grouping JSON reply, terminal usage |
| Medium reasoning | `reasoning.effort = medium` present on every review request and preserved |
| Request interception | fake-request count == proxy forwarded count in every model-free run (1:1) |
| Retry accounting | no request was re-sent by the proxy; a text-only reply is treated by the engine as a failed turn and retried by the engine, which the request ledger counts |
| Exit / error semantics | `complete` + exit 0 on success; `failed` + exit 1 with `stop_cause: provider_error` when the upstream cannot answer |
| Shapes exercised | one group (6 requests, max body 29,509 B), one group with the context-tool loop (11 requests, max 40,636 B), per-file grouping (18 requests, max 22,595 B) |

No OCR engine or production adapter change was needed, and none was made. No assertion or filtering
policy was weakened.

Proxy audit: **20/20** (`evidence/proxy-audit.txt`), including the two new bound tests below.

---

## 3. Frozen inputs and policy

| Check | Result |
| --- | --- |
| Requirements `ca868a3f…` | unchanged |
| `pr.json` `9b48eb1b…` | unchanged |
| Reviewer input `4ffebc0d…` | unchanged |
| Ordinary checks evidence `85d60b7b…` | unchanged |
| Candidate A `23864e3…` | present, fixture `HEAD`; only `refs/heads/main` exists |
| Candidate B | **absent** (no ref, no object) |
| Rule / background / config digests | re-derived byte-identically: `b3fd4702…`, `8a8a62ff…`, `2f1ef31e…` |
| Ordinary checks | `npm test` at `23864e3`, 21/21 pass, exit 0 (from the rr.7 stage; Candidate A and the suite are unchanged) |
| `--no-filter` | never passed |
| Reviewer prompt tuning | none; no prompt was edited for either path |

---

## 4. The request-width blocker and how it was resolved

### 4.1 What the new candidate actually emits

Measured offline (`MODE=offline` against the loopback proxy — local stub, zero spend), under the
previously approved 20,000-byte bound:

| Request | Bytes | Under 20,000 B |
| --- | --- | --- |
| 1 (grouping) | 1,502 | yes |
| 2 | 17,161 | yes |
| 3 | 18,674 | yes |
| 4 | **21,964** | **no** |
| 5 | 19,507 | yes |
| 6 | 18,812 | yes |
| 7 | **22,102** | **no** |

The rr.7 numbers were not assumed: the candidate emits seven requests, not six, and two of them exceed
the older bound (+1,964 / +2,102 bytes).

### 4.2 Exact cause, from a live run

A first live dispatch was made under a 40,960-byte bound derived from the model-free shapes. Its
grouping completed into a **single 4-file group**, and its review turn issued **6 `file_read` and 1
`code_search`** context-tool calls. The engine appends tool results to the next turn, so bodies grew
1,502 → 24,884 → 29,450 → **47,334** bytes (+60.7% at the last step), where the bound refused the
request. `stop_cause: provider_error`, 0 findings, exit 1. Cause: **context-tool result accumulation
inside one review round**, not truncation or a rule change.

A model-free reproduction of that loop (4 `file_read` + 1 `code_search`, one call per turn) grows
29,513 → 33,170 → 34,611 → 38,340 → 39,397 → 40,636 bytes, confirming the mechanism.

### 4.3 The revised bound

- Per-request bound: **65,536 bytes (64 KiB)**, still enforced on the **serialized byte length**, so
  `tokens ≤ 65,536` is provable before dispatch. The `chars/4` estimate was not used as a bound.
- Headroom: 38% above the largest body ever observed (47,334 B) and 60% above the model-free peak.
- Nothing was truncated, dropped or re-prompted to fit: the frozen requirements, the unchanged
  context, the managed rules and normal filtering are exactly as frozen.

### 4.4 Cost arithmetic under the new bound (the enforceable mechanism)

Spending is bounded by the **aggregate stage token caps**, not by the request count or by observed
usage:

| Quantity | Value |
| --- | --- |
| Per-request reservation | 65,536 in + 4,000 out = USD 0.085536 |
| Stage caps (initial, recheck) | 240,000 input / 40,000 output tokens → **USD 0.40 per stage** |
| Criteria stage cap | 20,000 / 4,000 → USD 0.04 |
| Already spent before this stage | USD 0.00827925 |
| **Complete plan worst case** | 0.00827925 + 0.40 + 0.40 + 0.04 = **USD 0.84827925** |
| Maintainer ceiling | USD 1.00 → **fits, with USD 0.15172075 of slack** |

The request cap (24) is a truncation guard only: a measured per-file run needed 18 requests and the
single-group run 10, so 24 admits a complete legitimate run. Because the byte bound proves
`tokens ≤ 65,536` for every forwarded request, the aggregate caps bound total spend regardless of how
many requests occur.

Regression tests added to `tooling/proxy-audit.test.mjs`:

1. `the revised 64 KiB bound admits exactly 65,536 bytes and refuses 65,537` — also asserts the bound
   covers the largest measured body.
2. `the complete initial+recheck plan stays inside the approved aggregate ceiling` — asserts the
   reservation, the per-stage worst case (USD 0.40) and the plan total (USD 0.84827925 ≤ USD 1.00), and
   that the per-request ceiling stays below the stage aggregate.

---

## 5. Budget, actuals

| Item | Value |
| --- | --- |
| Aggregate ceiling | USD 1.00 |
| **Account-authoritative spend (provider key usage)** | **USD 0.09085455** |
| Remaining | **USD 0.90914545** |
| Criteria Assessment (1 request) | USD 0.00827925 |
| OCR attempt 1 (refused at 47,334 B, no report) | proxy-modelled USD 0.018601 |
| OCR attempt 2 (initial review, complete) | proxy-modelled USD 0.085926 |
| Sum of proxy-modelled charges | USD 0.11280625 (no prompt-cache discount modelled) |

The account figure is the cost of record. It is lower than the sum of the modelled charges because
35,411 input tokens of the successful run were prompt-cache reads, which the proxy prices at the
uncached rate.

Provider-side key limit is still **USD 5.00** (`limit: 5`, no reset). This is a provider hard stop, not
a USD 1.00 cap; the USD 1.00 aggregate boundary is enforced by the proxy. The old compromised key's
revocation remains **unverified** (needs dashboard evidence); the present key reports usage consistent
with this pilot's spend only.

---

## 6. Reconciliation of the previous live Criteria Assessment

Re-verified against the retained artifacts (`../d12-initial/evidence/`), not re-run:

| Recorded item | Verification |
| --- | --- |
| `createLlmClient()` from `@agent-teams/account-gateway/llm` | yes — `criteria-assessment.json` records the entry and the receipt |
| Model `openai/gpt-6.1-terra` | requested and `observedModel` both `openai/gpt-6.1-terra` |
| Input 4,312 / output 578 / reasoning 93 tokens | matches `result.usage` |
| Provider cost USD 0.00827925 | **independently confirmed**: the account usage before this stage read exactly `0.00827925` |
| R1 satisfied / R2 satisfied / R3 violated | matches the stored `value.assessments` |
| Candidate A unchanged | yes |
| Raw response and structured findings preserved | `criteria-output.txt`, `criteria-assessment.json` |

The request was **not** repeated because the OCR binary changed; its artifact stays valid for the
frozen fixture, and it counts in full toward the aggregate budget.

**Architectural limitation (unchanged and material).** No account-gateway *service* is deployed here,
so the SDK's control plane was supplied locally (admission derived from the task's own intent, as the
M2 qualification harness does) and its execution port was bound to the pilot's loopback proxy. The SDK
performed everything it owns — encoding, streaming, terminal reduction, usage mapping, receipts. What
does not exist here is the Gateway service's server-side admission and accounting authority: the
enforcing boundary for this pilot is the bounded proxy. This satisfies "separate Criteria Assessment
through the existing Gateway SDK `/llm` path using `createLlmClient()`" but it is **not** a deployed
Gateway integration, and it is not claimed as one.

---

## 7. Initial ordinary OCR result

Invocation: `review --reviewrouter-managed --provider reviewrouter --model openai/gpt-6.1-terra`,
`--from ce99b0d… --to 23864e3…`, `--rule rule.json`, `--background-file background.txt`,
`--effort medium`, `--concurrency 1`, `--format json`, `--audience agent`, `--timeout 20`,
`--max-tokens-budget 400000`. No `--no-filter`.

| Capture | Value |
| --- | --- |
| Terminal state / exit | `complete` / 0 |
| Grouping | completed — one group containing all four changed paths |
| Review rounds | configured 2, started 2, completed 2; `stop_cause: null` |
| Filter phase | `completed`, `filter_decision_valid: true` |
| Underlying inference requests | **10** (all forwarded, 0 refused) |
| Request bytes | 1,502 / 24,884 / 29,709 / 48,468 / 55,399 / 18,792 / 29,556 / 45,889 / **62,517** / 18,183 |
| Token usage | 70,346 input / 3,116 output; 35,411 cache-read |
| Tool calls | 19 total: `file_read` 14, `code_search` 2, `code_comment` 2, `file_find` 1 |
| Duration | 57,744 ms (58 s) |
| Observed model (per response stream) | `openai/gpt-6.1-terra`; provider name not present in the stream |
| Requested tier / effort | `default` / `medium` — pinned and enforced on every request |
| Native → consumer-visible | 4 findings delivered through 2 `code_comment` calls; **4 consumer-visible** |

The CLI's managed JSON exposes the post-filter comment set and the filter phase state, but not the
pre-filter set or a per-comment removal flag, so the number of comments submitted is not observable in
this artifact. The model-free stage demonstrates that the mechanism does remove provably-wrong
comments (4 → 3); for this run the filter completed with a valid decision and the visible count equals
the delivered finding count.

### Consumer-visible findings

| # | Path | Line | Category / severity | Finding |
| --- | --- | --- | --- | --- |
| 1 | `tests/records.test.ts` | 11 | maintainability / low | `function body(...): any` disables type checking for every response assertion in the suite |
| 2 | `tests/records.test.ts` | 64–68 | test / low | rejection tests never exercise `offset` or the upper limit bound, so removing those validations would still pass |
| 3 | `src/records.ts` | 46 | bug / medium | explicitly empty `limit=` / `offset=` / `status=` are treated as omitted, contradicting the stated 400 contract |
| 4 | `src/router.ts` | 28 | **bug / high** | **the required CSV export is not exposed by this router**; add an endpoint applying the listing's filters, shared UTC formatter, headers and escaped rows |

---

## 8. Comparison — ordinary OCR versus Criteria Assessment

Both paths were given the same frozen Candidate A and the same frozen requirements.

| | Ordinary OCR (1.14.0-rr.1) | Criteria Assessment (Gateway SDK `/llm`) |
| --- | --- | --- |
| Ran | yes — 10 requests, 58 s | yes — 1 request |
| R1 (list records) | not assessed as a requirement; the listing is treated as present | `satisfied`, with three file references |
| R2 (UTC formatting) | not assessed as a requirement | `satisfied`, with three file references |
| R3 (CSV export) | **identified as missing** — finding 4, severity high, actionable correction | **`violated`** — "the CSV helper exists and has unit tests, but no service route produces a CSV export" |
| Additional findings | 3 (one medium behaviour/contract defect, two low test-quality findings) | none |
| False objections | none — nothing claimed that the diff disproves | none |
| Inconclusive findings | none | none |
| Actionable correction offered | yes, for both R3 and the empty-parameter contract | yes, for R3 |
| Requirements checklist output | no — it emits review comments, not per-requirement statuses | yes — one status per requirement with evidence and correction |

**What can be said.** Both paths independently found the same real gap: the CSV export is required but
no route exposes it, while the helper and its unit tests exist. The criteria path states it as a
requirement status with evidence; the ordinary path states it as a high-severity review comment with a
concrete correction. Neither path was told what to look for.

**What cannot be said.** This is one fixture, one candidate and one run per path. The ordinary path
produces review comments rather than requirement verdicts, so "which path is better at requirement
verification" is not measurable here: they answer different questions, and each answered its own
question correctly on the one thing that mattered. No superiority is claimed for either path.

**Differences caused by the new OCR candidate.** rr.7 never produced a report for this fixture, so this
is the first ordinary-OCR result for Candidate A. The candidate's context-tool loop is materially more
active (14 `file_read` + 2 `code_search` + 1 `file_find`) than the 1.14.0-rr.1 model-free shapes
suggested, which is what drove the request width to 62,517 B.

---

## 9. Effort

| | One-time setup | Per run |
| --- | --- | --- |
| Ordinary OCR | artifact download + provenance authentication, model-free harness (fake Responses provider behind the audited proxy), bound revision and two new regression tests, stage scripts | 58 s, 10 requests, 70,346 in / 3,116 out, no operator interaction |
| Criteria Assessment | SDK clone, build under the declared Node/pnpm engines, control + execution ports, runner | 10.7 s, 1 request, 4,312 in / 578 out |

---

## 10. Limitations

1. **No deployed Gateway** — the SDK's control/accounting authority is local (see §6). The proxy is the
   enforcing boundary for both paths.
2. **Provider key limit USD 5.00**, not USD 1.00; the USD 1.00 aggregate bound is proxy-enforced only.
3. **Old compromised key revocation unverified** (requires the provider dashboard).
4. **Pre-filter finding count not exposed** by the CLI's managed output for the live run.
5. **Observed provider name is absent** from the OpenRouter stream; only the model name is observed
   (`openai/gpt-6.1-terra`). The dated provider-side record and upstream provider were available for
   the criteria call but not for OCR requests, because the proxy does not record response ids.
6. **Cost is account-authoritative, not per-request**: the proxy does not implement prompt-cache
   pricing, so modelled charges run above the true spend.
7. **Width bound is empirical, not analytic**: 64 KiB covers 38% growth beyond the largest observed
   body. A materially more tool-hungry run on this fixture could still exceed it; that would be a
   refusal, not a truncation.
8. **One attempt at the initial review succeeded after one refused dispatch**; no re-run was made to
   improve findings, and no finding was altered.

---

## 11. Checkpoint

Stopped here as instructed. No Candidate B, no correction, no recheck, no further inference, no
evaluator material consulted, no PR action. USD 0.90914545 remains, which covers the planned recheck
(USD 0.40 worst case) with margin.
