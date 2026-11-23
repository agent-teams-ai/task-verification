# Execution card — next task family (revision 3)

Revision 2 was frozen 2026-11-22 as **D3-R1**, offline preparation only; at that freeze **no paid
inference had been run on this family**. Revision 3 is the D3-R2 admission pass: two transport defects
found while verifying the live path are corrected in §8 and §10, and gate 12 now machine-checks the
no-bypass property in §12. Repo `agent-teams-ai/task-verification`, branch
`exp/synthetic-live-pilot-01`. M2 PR #2 (`996cdcb002f898a5b73ce8f9ce7931e6299b14e4`) untouched.

Revision 1 was rejected in review for eight specific defects; each is corrected here and recorded in
`D3-R1-PREPARATION.md`. The decision the batch must support is unchanged: for the human reader, choose
between *return for implementation*, *request specific evidence*, or *accept justified completion* — and
say whether a second model call earns its place next to ordinary OCR and the project's own checks.

## 1. Task

`feat(deliveries): idempotent delivery with retry and subscription lifecycle` in a small
notification-delivery service (TypeScript, Node's own test runner, 5 source files, 5 test files).

Task statement `TASK.md`, revision **`delivery-req-v2`**, sha256
`ff243a43a8a74a52679c0673984c0725d8d4ef75dae062e9397c7293280fe3eb`. v2 adds the request-validation
order and the declaration of external material; the five obligations are unchanged from v1.

| ID | Authored obligation (abridged) |
| --- | --- |
| C1 | An `Idempotency-Key` identifies the **submission, not the content**: same key → one delivery, `202` and the original id; no key → always a new delivery. Applies inside the valid-submission domain (§5). |
| C2 | Retry only on transient failure (`5xx`, network error, timeout), never on other `4xx`; at most three attempts; the delay grows. |
| C3 | Payload > 65,536 bytes → `413`, not queued; exactly 65,536 bytes accepted; checked before the subscription. |
| C4 | `410` from the target disables the subscription and is not retried; a disabled subscription answers `409` and queues nothing, including a keyed repeat. |
| C5 | `GET /health` still answers `200 {"status":"ok"}`. |

## 2. Variants (roles are evaluator-only)

| id | commit | role |
| --- | --- | --- |
| c01 | `54623dccc8b138c9ad5a41fc0347cf49ba039c61` | complete |
| c02 | `65f210381920fbfce032cf5ba8aaa440f3300162` | plausibly incomplete (C1) |
| c03 | `18bbde350074d4afd8a3e3d52be31479c6ba85fc` | insufficient evidence (C2) |

Base `c65bc835ca35b94fd0de3e3c0cc2c8d459b556de`. Model-visible material carries only `base`/`head`
commit ids — no role word, no expected verdict, no filename hint.

**c03 was revised before any inference.** The v1 commit `98408d37…` imported a workspace module that did
not exist anywhere, so its retry cases could not run at all: `ERR_MODULE_NOT_FOUND`, four skipped tests.
That made the case a deterministic resolution defect rather than an evidence boundary. The revision
keeps the same task, the same family, the same delegation and the same intent; the workspace package
`@fixture/delivery-core` (`synthetic/next-family/packages/delivery-core`) now exists as a sibling of the
fixture repository, so the retry path **runs** (17/17, 0 skipped) while the classification stays outside
the reviewed checkout. `family.json` and `evaluator/ORACLE.json` record the superseded commit and why.

## 3. Strategy

**Strategy A — reproducible evidence packet**, unchanged. All 13 eligible files fit one declared rule, so
there is no expert selection and no recurring human preparation per case. Only A is built.

## 4. Automatic inputs and what the request actually costs

`prepare.mjs` — rule `next-family-packet-rule-v1`: include `README.md`, `package.json`, `tsconfig.json`,
`src/**/*.ts`, `tests/**/*.ts`; exclude `node_modules/**`, `.git/**`, `*.lock`; max 24,576 B per file; max
98,304 B per packet; **no truncation**. File list from `git ls-tree` at the frozen commit.

| candidate | packet | serialized body | instructions | schema | escaping | envelope |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | 23,220 B | **25,884 B** | 556 B | 668 B | 1,116 B | 324 B |
| c02 | 23,093 B | **25,741 B** | 556 B | 668 B | 1,100 B | 324 B |
| c03 | 23,743 B | **26,427 B** | 556 B | 668 B | 1,136 B | 324 B |

Measured through `createLlmClient()` with a fake execution port (`offline/measure-requests.mjs`,
`lib/measure.mjs`): the body the SDK hands the transport, not an estimate. A nominal 21–24 KB packet is
**not** the request: the SDK wraps it in `input[0].content[0].text`, adds instructions, the JSON schema,
the reasoning block, `store:false`, `stream:true`, `service_tier`, `max_output_tokens` and JSON escaping.

This is the arithmetic D3 got wrong: revision 1 advertised 16,000 tokens and a 65,536-byte body while the
launcher passed `--request-input-tokens 16000` to a proxy that compares *bytes*, so the real bound was
16,000 bytes and every candidate exceeded it (`proxy_input_ceiling_exceeded`, 413 on all three).

## 5. Requirement precedence (correction)

Validation order, frozen in `TASK.md`: (1) body shape → `400`; (2) payload size → `413`; (3) subscription
→ `404`/`409`; (4) idempotency → `202`. So **C3 and C4 take precedence over C1**: a repeat that is
oversized is `413`, a repeat for a disabled subscription is `409`, and neither queues anything or records
a key. C1's duplicate guarantee applies to submissions that reach step 4, and C1 keeps its full
key-identity clause there. c01 remains a valid complete control: the probe observes `413`/`409` for both
precedence interactions and `202` + one queued delivery for an ordinary repeat.

## 6. Manual inputs

- `TASK.md` v2 and `AUTHOR-HANDOFF.md` v2, written before any candidate existed (handoff updated only by
  the same declarations that v2 adds).
- The decision to use a bounded synthetic family.
- Nothing per-candidate: no hand-picked file list, no defect-aware inclusion.

## 7. Baseline at review time

- Ordinary checks (materialized copies, `checks/run-checks.mjs`): c01 17/17, c02 16/16, c03 17/17, **0
  skipped**. Receipts `checks/raw-<commit>.txt`, summary `checks/RECEIPTS.json`.
- `checks/RESULTS.md` now states what those receipts do and do not establish. They positively establish
  C3's two boundaries, C4's two clauses, C5, four of C2's five clauses, and C1 on c01/c03. They do not
  cover C1's key-identity clause for c02 (whose suite encodes the wrong collapse and omits the keyless
  case), the validation order, or C2's delay growth.
- **Input distinction.** Human baseline: normal task information, OCR findings where available, plus
  ordinary test execution receipts. Criteria assessor: frozen requirements, mechanically selected source,
  test definitions and declared context — **no execution receipts**. Nothing in the packet says which
  tests pass.
- Ordinary OCR: one run planned on c02 only, comparator `1.14.0-rr.1` with the corrected `path/rule`
  envelope. Not run in this phase.

## 8. Model settings and identity enforcement

OpenRouter · `openai/gpt-6.1-terra` · reasoning `medium` · service tier `default` ·
`@agent-teams/account-gateway/llm` `createLlmClient()` with caller-supplied control/execution ports ·
`json_schema` strict · stream · `store:false`. Profile digest `2a7532d7c604…`.
OCR: qualified `1.14.0-rr.1`; if unavailable, skip OCR and record the limitation — never substitute.

Enforced, in layers, before or around the one dispatch:

| Check | Where | On mismatch |
| --- | --- | --- |
| Requested model id | proxy, before forwarding | `400 proxy_policy_model`, not forwarded |
| Service tier | proxy, before forwarding | `400 proxy_policy_service_tier` |
| Reasoning effort | proxy, before forwarding | `400 proxy_policy_reasoning_effort` |
| Output ceiling | proxy, before forwarding | `413 proxy_output_ceiling_exceeded` |
| Serialized body | launcher, at the port | bytes/digest differ from admission → no forward |
| Observed model | proxy, on the reply | `502 proxy_observed_model_mismatch`, body withheld, run halted |
| Observed model absent | proxy, on the reply | `502 proxy_observed_model_missing`, run halted (`--require-observed-model`) |
| Observed provider | proxy, on the reply | `502 proxy_observed_provider_mismatch`; allowed set `OpenRouter,OpenAI` |
| Retries / fallback | nowhere | `--max-requests 1` per attempt; the SDK performs one attempt; a halt refuses everything after |

**No credentialed egress outside the proxy (revision 3).** The launcher used to read the provider key's
usage figure from `openrouter.ai/api/v1/key` before and after the call. That request carries the
credential and leaves the bounded boundary even though it is not inference, so it is removed: the
launcher now performs exactly one `fetch`, to `http://127.0.0.1:<port>/v1/responses`, and gate 12 fails
the batch if any non-loopback URL or a second fetch appears in its source. Cost is therefore reconciled
from the proxy ledger's reported usage rather than from a direct provider account read; the trade-off is
that the provider's own billed total is not independently read in this phase.

**Stated limitation.** Provider and model identity are reported *after* the provider runs; the interface
offers no way to pin an upstream provider before dispatch. What we can enforce is the requested identity
on the wire, the absence of substitution in the reply, an allowed-provider set, and a hard halt on any
mismatch — which is what the tests demonstrate. This is reported as a limitation, not as upstream
pinning.

## 9. Attempts are append-only (correction)

Revision 1 deleted an existing ledger and overwrote its output. Now every attempt is a new directory
`runs/attempts/<attemptId>/` with `attempt.json` (admission: candidate, stage, packet digest, body digest,
profile digest, reservation), `request/ledger.jsonl` (the proxy's own records), `raw/response.txt` (the
verbatim reply, written **before** any parsing or annotation, `wx` flag), `result.json` and
`request/proxy.log`. `runs/attempts/index.jsonl` appends every state change. Nothing is deleted or
rewritten; `mkdir` without `recursive` plus an `wx` flag make a repeated id an error; a **duplicate run
key** (candidate + stage + packet + profile + body digests) refuses a second execution outright. A
recheck is a new stage id with a new attempt id, and a correction must name the attempt it corrects.

## 10. Execution plan and numerical caps

1. Three independent Criteria Assessments: c01, c02, c03 (one proxy process, one request each).
2. At most one bounded correction/recheck, only if a verdict is unsupported by the packet, and only after
   Iliya's checkpoint.
3. One OCR stage on c02, at most 8 forwarded requests.

| Item | Cap |
| --- | --- |
| Criteria requests | 3 (+1 correction reserve) |
| **Criteria serialized body** | **28,672 B** (28 KiB), byte-enforced |
| **Criteria input tokens** | **28,736** (= 28,672 + 64 special-token allowance), reserved before forwarding |
| Criteria output per request | 2,500 tokens |
| OCR forwarded requests | **8** (was 10) |
| OCR per request | 15,936 B body / 16,000 tokens in, 1,500 out |
| Pricing | 1.25/M input (cache-write worst case), 5.00/M output, cache reads 0.05/M never assumed |
| Per-request reservation | USD 0.04842 (criteria), USD 0.0275 (OCR) |
| **Worst-case billable** | 4 × 0.04842 + 8 × 0.0275 = **USD 0.41368** |
| Remaining envelope | USD 0.44071 |
| **Aggregate worst case** | 0.55929 + 0.41368 = **USD 0.97297 ≤ 1.00** |
| Per-request timeout | 150 s |
| Wall time | criteria ≤ 10 min, OCR ≤ 25 min, batch ≤ 40 min |

Enforceable-limit statement. The proxy enforces **body bytes**, and it enforces them twice: on the
received body, and again on the exact payload it forwards (`proxy_forward_bytes_exceeded`), because
re-serialization or the injected output ceiling can grow a body after the first check (revision 3). The
token ceiling is the byte ceiling plus a special-token allowance, valid because a byte-level BPE tokenizer emits tokens that each cover at least
one byte, and only format special tokens cover none. The exact tokenizer for `openai/gpt-6.1-terra` cannot
be obtained offline, so this is a documented upper bound, not a token count; it is falsified empirically
on the first live reply, where the proxy charges reported usage and halts
(`ceiling_breached_by_reported_usage`). `chars / 4` is never used for enforcement.

Why 8 OCR forwards instead of 10: at 28,736 input tokens per criteria call, ten OCR forwards make the
batch worst case USD 0.4482, and 0.55929 + 0.4482 = USD 1.00749 > 1.00. The OCR cap is reduced; no
per-request safety limit is weakened and no usage is invented.

## 11. Cumulative accounting

- 49 billable ledger entries, settled: **USD 0.30811605**; initial criteria call **0.00827925** →
  **USD 0.31639530** settled.
- Conservative reconciled envelope carried forward: **USD 0.55929** (settled plus the unresolved and
  settlement-lag allowance). Remaining **USD 0.44071**. USD 0.69415395 is **not** an allowance.
- Committed basis = `max(settled, conservative)` = 0.55929; settled and its envelope are **never added**.
- Guard (`lib/budget.mjs`, state `runs/budget/batch-guard.json`): before each dispatch it loads the frozen
  historical figures, every earlier reservation, resolves completed reservations, keeps unresolved charges
  at full reservation, adds in-flight reservations, computes this request's maximum, refuses if the
  aggregate exceeds 1.00, and reserves atomically under an exclusive lock before forwarding. Concurrent
  admissions cannot over-reserve (tested with six child processes: five of six USD 0.08 admissions fit).
- `verifyHistorical()` re-reads `synthetic/runs/d12-recheck/reconciliation.json` and fails if the carried
  figure drifts. The provider key's USD 5.00 limit is not treated as authorization.

## 12. Readiness gates

`node synthetic/next-family/checks/verify-gates.mjs` — **12/12 PASS** (exit 0) at revision 3:

1. Packets reproduce at their frozen digests. 2. Task digest and candidate commits match `family.json`.
3. No evaluator material or role word inside a packet. 4. Credential scan clean (tracked + new files).
5. Historical A/B/C evidence untouched. 6. Proxy resolves module-relatively; its selftest passes and its
20-test audit still passes. 7. All 52 offline tests pass, 0 skipped. 8. Launcher admission works for all
three candidates and a credential-less run refuses with exit 3. 9. Budget arithmetic fits the
authorization, with an empty attempt ledger. 10. Frozen metadata is internally consistent (caps, oracle,
receipts). 11. The M2 repository is clean at `996cdcb0…`. 12. The launcher makes exactly one fetch, to the loopback
proxy, with no provider host anywhere in its source.

## 13. Expected decisions (evaluator-only, `evaluator/ORACLE.json`)

| id | C1 | C2 | C3 | C4 | C5 |
| --- | --- | --- | --- | --- | --- |
| c01 | satisfied | satisfied | satisfied | satisfied | satisfied |
| c02 | **violated** | satisfied | satisfied | satisfied | satisfied |
| c03 | satisfied | **inconclusive** | satisfied | satisfied | satisfied |

Precedence expectations, all three candidates: oversized repeat of an accepted key → `413` with one
queued; repeat for a disabled subscription → `409` with one queued; oversized payload for an unknown
subscription → `413`. c03's C2 must name the resolving evidence: the source of `@fixture/delivery-core`
(`../packages/delivery-core`), or an execution receipt that exercises the retry path. Material harm:
`satisfied` on c02.C1; `satisfied` on c03.C2; `violated` on c03.C2 without a demonstrated contradiction;
`202` where the validation order requires `413`/`409`.

## 14. Risks and limitations

- c02's C1 defect is visible to a careful source reader; finding it still counts as useful, but it is not
  evidence of reasoning depth.
- c03's C2 may be reported `violated` rather than `inconclusive`, because the delegation looks like a
  missing implementation. That outcome is measured, not corrected, and it is the failure this case exists
  to expose.
- The token bound is conditional on a byte-level BPE tokenizer; the first live reply verifies or falsifies
  it, and a falsification halts the batch.
- Upstream provider pinning cannot be enforced before dispatch; only the requested identity, the observed
  identity and a halt are enforceable.
- Ordinary OCR may find c02's defect on its own, which would reduce the assessor's marginal value; the
  comparator's availability is unverified in this phase.
- The packet rule excludes oversized or generated files; not exercised here (0 exclusions), so this batch
  says nothing about repositories where the rule would exclude decisive source.
- Consumer publication, opt-in UI and Gateway deployment remain unqualified. This batch informs a
  mechanism choice only.
- Iliya remains the report reader: the correction reserve is spent only at his checkpoint, never
  automatically.

## Reproduce

```
node synthetic/next-family/prepare.mjs --all                 # rebuild packets
node synthetic/next-family/offline/measure-requests.mjs       # serialized bodies, no provider
node synthetic/next-family/checks/run-checks.mjs              # suites + probes, no provider
node synthetic/next-family/checks/verify-gates.mjs            # 11 offline gates
node synthetic/next-family/criteria-next.mjs c01 --dry-run    # admission preview, no dispatch
```
