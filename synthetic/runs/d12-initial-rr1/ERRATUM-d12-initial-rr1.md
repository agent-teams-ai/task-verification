# Factual erratum — `REPORT-d12-initial-rr1.md`

- Date: 2026-11-21
- Subject report: `synthetic/runs/d12-initial-rr1/REPORT-d12-initial-rr1.md`
- Subject report blob at commit `efdc948`: `2654b63d92b7db3d27efffa4381ee917817a56c5`
- **Status of the subject report: unchanged.** This file is the only correction. The original report is
  preserved byte-for-byte and remains the primary artifact. Nothing below was written into it.
- Scope: arithmetic and provenance wording only. **No finding, verdict, comparison statement or
  limitation is retracted or reinterpreted, and no conclusion changes.**

This erratum was produced during a report-integrity checkpoint. It involved no inference, no
correction, no recheck, no evaluator material and no provider call.

---

## E1 — Stage worst-case arithmetic in §4.4 (and the matching record fields)

The subject report states:

> | Stage caps (initial, recheck) | 240,000 input / 40,000 output tokens → **USD 0.40 per stage** |
> | **Complete plan worst case** | 0.00827925 + 0.40 + 0.40 + 0.04 = **USD 0.84827925** |
> | Maintainer ceiling | USD 1.00 → **fits, with USD 0.15172075 of slack** |

The stage caps are correct (240,000 input / 40,000 output; confirmed in `run-ocr.sh` line 162,
`live-run-2.log` and `evidence/stage-summary-live.json`), and the price basis is the one the report
itself uses elsewhere (USD 1.00/M input, USD 5.00/M output — `run-ocr.sh` line 162 and the per-request
reservation `65,536 in + 4,000 out = USD 0.085536`). Under that basis a 240,000/40,000 stage costs
**USD 0.44**, not USD 0.40:

| Quantity | Report says | Correct value |
| --- | --- | --- |
| OCR stage worst case (240,000 in + 40,000 out) | USD 0.40 | **USD 0.44** (0.24 + 0.20) |
| Complete plan worst case (initial + recheck + criteria) | USD 0.84827925 | **USD 0.92827925** (0.00827925 + 0.44 + 0.44 + 0.04) |
| Slack under the USD 1.00 ceiling | USD 0.15172075 | **USD 0.07172075** |

**The conclusion is unaffected:** the complete two-stage plan plus the criteria stage and the spend
already incurred is USD 0.92827925, which still fits inside the maintainer's USD 1.00 ceiling, with
USD 0.07172075 of slack. The bound remains provable for the same reason as before — the per-request
byte ceiling proves `tokens ≤ 65,536` before dispatch, and the aggregate token caps bound each stage.

Cause of the error: the USD 0.40 figure and the USD 0.84827925 total were carried over from the
regression test `the complete initial+recheck plan stays inside the approved aggregate ceiling`
(`synthetic/tooling/proxy-audit.test.mjs:523-553`), whose constants describe a **200,000**-token input
stage:

```js
const OCR_STAGE = { maxInputTokens: 200_000, maxOutputTokens: 40_000 };   // -> 0.20 + 0.20 = 0.40
assert.equal(Number(ocrStageWorstCase.toFixed(6)), 0.4);
assert.equal(Number(totalWorstCase.toFixed(8)), 0.84827925);
```

The executed stage used 240,000 input tokens, so the test's constants are stale relative to the frozen
enforcement numbers even though the test passes. **The test was not modified in this checkpoint**,
because changing executable evidence during a report-integrity handoff would silently alter what
"20/20 passing" meant for the executed run. It is recorded here as a known, separate defect that needs
its own authorized fix (constants `200_000 → 240_000`, asserted values `0.4 → 0.44` and
`0.84827925 → 0.92827925`).

Also affected, same cause: `EXECUTION-RECORD.json` → `budget.plannedWorstCaseUsd`
(`initialOcr: 0.4`, `recheckOcr: 0.4`, `total: 0.84827925`) and `COMPARATOR-IDENTITY.json` →
`enforcement.stageWorstCaseUsd: 0.4`. The retained stage summary already carries the correct
`stageWorstCaseUsd: 0.44`.

---

## E2 — Provenance wording for the spend figure in §5

The subject report states:

> | **Account-authoritative spend (provider key usage)** | **USD 0.09085455** |

The **figure is exactly right**, but "provider key usage" is the wrong provenance label. No retained
key-usage read equals USD 0.09085455. The figure is the exact sum of the provider-reported per-request
`usage.cost` fields retained in the proxy ledgers, plus the criteria request:

| Component | Source | USD |
| --- | --- | --- |
| Criteria Assessment (1 request) | `evidence/../d12-initial/evidence/criteria-assessment.json` | 0.00827925 |
| OCR attempt 1 (3 forwarded requests: 0.000574 + 0.0121955 + 0.008873) | `evidence/ledger-live-attempt1.jsonl` | 0.0216425 |
| OCR attempt 2 (10 forwarded requests) | `evidence/ledger-live.jsonl` | 0.0609328 |
| **Total** | | **0.09085455** |
| Remaining of USD 1.00 | | **0.90914545** |

The key-usage reads taken *during* execution lag settled billing and are lower:

| Read point | Value |
| --- | --- |
| Before attempt 1 | 0.00827925 |
| After attempt 1 (usage had not yet settled; `delta: 0`) | 0.00827925 |
| Before attempt 2 (attempt 1's cost had settled) | 0.02992175 |
| After attempt 2 | 0.0733758 |

So the correct statement is: **USD 0.09085455 is the sum of provider-reported per-request costs** — the
most authoritative per-request record retained — and it exceeds the last key-usage snapshot taken during
the run (0.0733758) because provider key usage settles with delay. The remaining-budget figures
(0.90914545) are unaffected. The provider was **not** called during this checkpoint to re-read usage.

---

## E3 — Explanation of the gap between modelled and actual charges in §5

The subject report states:

> The account figure is the cost of record. It is lower than the sum of the modelled charges because
> 35,411 input tokens of the successful run were prompt-cache reads, which the proxy prices at the
> uncached rate.

The difference is real (0.11280625 modelled vs 0.09085455 actual = 0.0219517), and the cache-read
discount is its largest component, but it is **not the only** component: attempt 1 was *under*-modelled,
which this sentence does not disclose. The gap is a net of two opposing effects:

| Effect | Modelled | Actual | Difference |
| --- | --- | --- | --- |
| OCR attempt 2 — 35,411 cache-read tokens priced at the uncached rate by the proxy | 0.085926 | 0.0609328 | −0.0249932 (proxy over-charges) |
| OCR attempt 1 — 12,166 cache-*write* tokens priced at the base input rate by the proxy | 0.018601 | 0.0216425 | **+0.0030415 (proxy under-charges)** |
| Net | 0.11280625 | 0.09085455 | −0.0219517 |

Evidence, from `cost_details` in the ledgers: the provider billed attempt 1's cache-write input at
USD 1.25/M (e.g. request 3: 6,455 tokens → USD 0.008068) against the proxy's USD 1.00/M, and billed
attempt 2's cache reads at USD 0.05/M (e.g. request 8: 6,418 cached tokens → USD 0.0003209) against the
proxy's USD 1.00/M. The proxy models neither rate.

Corrected statement: the actual spend is below the modelled sum because the successful run's cache reads
were billed well below the uncached rate, partly offset by attempt 1's cache writes being billed above
the base input rate that the proxy models. The proxy's modelled charges are therefore **not a
conservative upper bound for cache-writing requests** — a point the report's §4.4 reservation does not
claim, but which readers of §5 should not be left to infer wrongly.

---

## E4 — Background length in §1

The subject report states `Background | 2,605 chars, 8a8a62ff…`. The file is **2,606 characters**
(2,616 bytes, UTF-8). The digest `8a8a62ff9a99bb6daab25a1bbf86a86a1e3264d387ce8bc4195c7b9056702e7a`
is correct and matches the file byte-for-byte, and the file is byte-identical to the rr.7 stage. Only
the character count is off by one. Same off-by-one in `EXECUTION-RECORD.json` → `fixture.background.chars`
(`2605`) and `COMPARATOR-IDENTITY.json` → `managedContract.backgroundChars` (`2605`);
`prepared-inputs.json` already records the correct `2606`.

---

## Verified accurate — checked in this checkpoint and not corrected

Each of the following was re-derived from the retained records, not re-run:

- Comparator identity: `QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE`, binary SHA-256
  `443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399`, 87,356,967 bytes, version
  `open-code-review 1.14.0-rr.1 linux/amd64`, CI run 44924052949, artifact
  `managed-ocr-8a70944f567beba9ffc12d1153e33ef5fd60967d`, qualification 4/4, silent digest agreement.
- Request counts: attempt 1 = 3 forwarded + **1 locally refused** (`proxy_input_ceiling_exceeded` at
  47,334 bytes against a 40,960-byte ceiling, never forwarded); attempt 2 = 10 forwarded, 0 refused;
  criteria = 1. **Total forwarded = 14**, total refused = 1.
- Per-attempt usage and the 0.11280625 modelled sum (0.00827925 + 0.018601 + 0.085926 = 0.11280625).
- Attempt 2 actuals: 70,346 input / 3,116 output / 35,411 cache-read, 19 tool calls
  (`file_read` 14, `code_search` 2, `code_comment` 2, `file_find` 1), 57,744 ms, 10 request bodies
  matching the report's list (max 62,517 B), `complete`, exit 0, filter `completed` /
  `filter_decision_valid: true`, 4 findings delivered = 4 consumer-visible.
- All four consumer-visible findings match `evidence/ocr-result-live.json` verbatim in path, line,
  category, severity and text, including the missing CSV export at `src/router.ts:28` (bug/high).
- Criteria verdicts: R1 `satisfied`, R2 `satisfied`, R3 `violated`;
  `criteria-assessment.json` records `createLlmClient()` via `@agent-teams/account-gateway/llm`,
  requested and observed model both `openai/gpt-6.1-terra`, usage 4,312 / 578 / 93 reasoning tokens,
  cost USD 0.00827925.
- Frozen digests: requirements `ca868a3f…` (`synthetic/requirements/RECORD-API-v1.md`), `pr.json`
  `9b48eb1b…` (`synthetic/metadata/pr.json`), reviewer input `4ffebc0d…`
  (`synthetic/inputs/REVIEWER-INPUT-v1.md`), ordinary-checks evidence `85d60b7b…`
  (`synthetic/checks/RESULTS-A.md`) — all four recomputed and identical.
- Fixture: `HEAD` = Candidate A `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9`, base
  `ce99b0d65d645124413a746ecb137b5497aad80f` present, exactly **2** commits in the whole fixture
  repository, single ref `refs/heads/main`, worktree clean → **Candidate B absent**.
- Ordinary checks: 21/21 pass, exit 0, from the preserved rr.7 evidence.
- Rule `b3fd4702…` (620 B) and config `2f1ef31e…` recomputed byte-identically; `--no-filter` not used.
- Proxy audit: 20/20 (`evidence/proxy-audit.txt`).
- Immaterial rounding only: §4.3 "60% above the model-free peak" is 61.3% (65,536 / 40,636); the
  statement is a conservative understatement and no change is made.

---

## Effect on the experiment

None of E1–E4 changes a finding, a verdict, a comparison statement, the request accounting, the actual
spend, or the feasibility conclusion. The subject report remains the primary artifact for Iliya, read
together with this erratum.
