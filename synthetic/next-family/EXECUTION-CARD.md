# Execution card — next task family

Frozen 2026-11-22, **offline preparation only**. No paid inference has been run on this family.
Repo `agent-teams-ai/task-verification`, branch `exp/synthetic-live-pilot-01`. M2 PR #2 untouched.

Decision this batch must support: for the human reader, choose between *return for implementation*,
*request specific evidence*, or *accept justified completion* — and say whether a second model call
earns its place next to ordinary OCR and the project's own checks.

## 1. Task

`feat(deliveries): idempotent delivery with retry and subscription lifecycle` in a small
notification-delivery service (TypeScript, Node's own test runner, 5 source files, 5 test files).

Chosen because it is an ordinary feature task: authored criteria, a normal author handoff, a green
ordinary suite, and obligations that are partly source-decidable and partly execution-dependent. It is
not the studied CSV/record-API family, and it is not a historical production reconstruction.

## 2. Frozen criteria

`TASK.md`, revision `delivery-req-v1`, sha256 `c7acd7d573424d721ee9345c76082c0368b5a82e4f31c79627f8a670b149692a`.

| ID | Authored obligation (abridged) |
| --- | --- |
| C1 | An `Idempotency-Key` identifies the **submission, not the content**: same key → one delivery, `202` and the original id; no key → always a new delivery. |
| C2 | Retry only on transient failure (`5xx`, network error, timeout), never on other `4xx`; at most three attempts; the delay grows. |
| C3 | Payload > 65,536 bytes → `413`, not queued; exactly 65,536 bytes accepted. |
| C4 | `410` from the target disables the subscription and is not retried; a disabled subscription answers `409` and queues nothing. |
| C5 | `GET /health` still answers `200 {"status":"ok"}`. |

## 3. Variants (roles are evaluator-only)

| id | commit | role |
| --- | --- | --- |
| c01 | `54623dccc8b138c9ad5a41fc0347cf49ba039c61` | complete |
| c02 | `65f210381920fbfce032cf5ba8aaa440f3300162` | plausibly incomplete (C1) |
| c03 | `98408d376ae16e0aea365cbb36f1207c0c4f495d` | insufficient evidence (C2) |

Base `c65bc835ca35b94fd0de3e3c0cc2c8d459b556de`. Model-visible material carries only `base`/`head`
commit ids — no role word, no expected verdict, no filename hint.

## 4. Strategy

**Strategy A — reproducible evidence packet.** All 13 eligible files total ~21 KB, so the declared
rule already covers the whole relevant repository: no expert selection, therefore no recurring
human preparation per case. Bounded requirement-led reading (Strategy B) would add a reader, extra
requests and a per-case cost to obtain material that already fits in one packet. Only A is built.

## 5. Automatic inputs

`prepare.mjs` — rule `next-family-packet-rule-v1`: include `README.md`, `package.json`,
`tsconfig.json`, `src/**/*.ts`, `tests/**/*.ts`; exclude `node_modules/**`, `.git/**`, `*.lock`;
max 24,576 B per file; max 98,304 B per packet; **no truncation** (over-limit files are excluded,
whole, and recorded). File list comes from `git ls-tree` at the frozen commit.

Result: 13 files, 0 exclusions, 20,604–21,185 bytes per packet. The same rule produced all three.

## 6. Manual inputs

- `TASK.md` and `AUTHOR-HANDOFF.md`, written once before any candidate existed.
- The decision to use a bounded synthetic family (no suitable real task was available).
- Nothing per-candidate: no hand-picked file list, no defect-aware inclusion.

## 7. Baseline at review time

- Ordinary checks: c01 17/17, c02 16/16, c03 13 pass + 4 skipped (`checks/RESULTS.md`).
- The author handoff — a claim, not evidence.
- Ordinary OCR: **one** run planned on c02 only, comparator `1.14.0-rr.1` with the corrected
  `path/rule` rule envelope. Only c02, because there the reader's decision (correct vs accept) is at
  stake. Not run in this phase.
- Not given to the baseline: bespoke probes, criterion-to-check mappings, evaluator answers.

## 8. Model settings

OpenRouter · `openai/gpt-6.1-terra` · reasoning `medium` · service tier `default` ·
`@agent-teams/account-gateway/llm` `createLlmClient()` with local control/execution ports (real SDK
use, not a deployed Gateway route) · `json_schema` strict · stream · `store:false`.
Observed model must equal requested; otherwise stop and record. No fallback model, no provider switch.
OCR: qualified `1.14.0-rr.1` development candidate; if unavailable, skip OCR and record the baseline
limitation — never substitute a different comparator.

## 9. Execution plan

1. Three criteria assessments, one per candidate, packet input only.
2. Only if a verdict is unsupported by the packet: **one** bounded correction/recheck on that
   candidate, recorded as a new profile version.
3. One OCR stage on c02.

No second OCR, no second strategy, no model sweep, no matrix.

## 10. Numerical caps

| Item | Cap |
| --- | --- |
| Criteria requests | 3 (+1 correction reserve) |
| Criteria input per request | 16,000 tokens (body ≤ 65,536 B, byte-enforced) |
| Criteria output per request | 2,500 tokens |
| Criteria aggregate | 64,000 in / 10,000 out (incl. reserve) |
| OCR forwarded requests | 10 |
| OCR input per request | 16,000 tokens |
| OCR output per request | 1,500 tokens |
| OCR stage aggregate | 160,000 in / 15,000 out |
| Source reads | 0 extra (packet is fixed); packet build is local, 13 files |
| Per-request timeout | 150 s |
| Wall time | criteria ≤ 10 min, OCR ≤ 25 min, batch ≤ 40 min |
| **Worst-case billable** | criteria 0.0975 + reserve 0.0325 + OCR 0.275 = **USD 0.405** |
| Correction/recheck reserve | 1 criteria call, USD 0.0325 (inside the 0.405) |

Worst case assumes every request hits its cap at the cache-write input rate (1.25/M) — the same
conservative model used for the A/B/C reconciliation. Requests over a cap are refused before dispatch
and are not billable; a refusal is recorded, never retried blindly.

## 11. Cumulative accounting

- 49 billable ledger entries, settled: **USD 0.30811605**.
- Initial criteria call (no ledger line): **USD 0.00827925** → **USD 0.31639530**.
- Key snapshot **USD 0.30584605** = 0.31639530 − **0.01054925**, the final C call (settlement lag).
- Conservative reconciled upper bound carried forward: **USD 0.55929**; remaining allowance
  **USD 0.44071**. (USD 0.69415395 is *not* a verified allowance.)
- Reservation check: 0.55929 + 0.405 = **0.96429 ≤ 1.00**; on the settled figure
  0.31639530 + 0.405 = **0.72140**.

## 12. Readiness gates (all must pass before any paid request)

1. Packet digest equals its manifest and `family.json`.
2. Recorded check receipts reproduce (`npm test` per candidate).
3. Grep gate: no role word, oracle verdict or evaluator path inside `packets/`.
4. Credential, bounded proxy and SDK dist reachable; provider `/key` read before and after, value
   never printed or committed; balance and pricing re-confirmed.
5. Each admitted request's reserved maximum ≤ the remaining allowance.
6. Observed provider/model equals requested.
7. OCR comparator identity and corrected rule envelope verified; otherwise skip OCR and record.
8. Iliya reads the frozen reports **before** any oracle comparison.

## 13. Expected decisions (evaluator-only, `evaluator/ORACLE.json`)

| id | C1 | C2 | C3 | C4 | C5 |
| --- | --- | --- | --- | --- | --- |
| c01 | satisfied | satisfied | satisfied | satisfied | satisfied |
| c02 | **violated** | satisfied | satisfied | satisfied | satisfied |
| c03 | satisfied | **inconclusive** | satisfied | satisfied | satisfied |

c03's C2 must name the resolving evidence: the workspace package `packages/delivery-core/src/retry.ts`,
or a retry execution receipt. Material harm: `satisfied` on c02.C1 or c03.C2; `violated` on c03.C2
without a demonstrated contradiction in the permitted evidence.

## 14. Risks

- c02's C1 defect is visible to a careful source reader, so the assessor may find it rather than
  reason about it — that still counts as useful, but it is not evidence of reasoning depth.
- c03's C2 may be reported `violated` instead of `inconclusive` because the import cannot resolve.
  That outcome is measured, not corrected.
- Ordinary OCR may find c02's defect on its own, which would reduce the assessor's marginal value.
  That is a legitimate result of the batch.
- The packet rule excludes oversized or generated files; not exercised here (0 exclusions), so this
  batch says nothing about repositories where the rule would exclude decisive source.
- Consumer publication, opt-in UI and Gateway deployment remain unqualified. This batch informs a
  mechanism choice only.

## Reproduce the preparation

```
node synthetic/next-family/prepare.mjs --all
```

**Automatic or manual?** The file selection is genuinely automatic: `git ls-tree` at the frozen
commit filtered by a declared rule, with exclusions recorded. The manual work is the task statement
and the author handoff, written once, plus the choice of a synthetic family.
