# D1/D2 — Final evidence audit and maintainer handoff

Status: **audit complete. One recommendation. No new inference, no new cases, no code changes to any reviewed component.**
Return code: `PRODUCT_DECISION_HANDOFF_READY — AWAITING_MAINTAINER_DIRECTION`

Frozen source report: `synthetic/runs/d12-recheck/REPORT-d12-decision.md` (unchanged; digest `612b8ed5…`).
This document audits it against the retained evidence and records one factual erratum. It does not
reinterpret any reviewer output, and no hidden evaluator material was consulted.

---

## 1. Published baseline — verified

| Item | Verified value |
| --- | --- |
| Branch | `exp/synthetic-live-pilot-01` |
| Branch HEAD | **`2c08a2f4f66e579fec33804260b359e4e5033caa`** |
| Remote `origin/exp/synthetic-live-pilot-01` | identical `2c08a2f4…` |
| Research commit | `896c4d4` (`2c08a2f` is its single child: manifest self-reference fix) |
| Candidate A | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` |
| Candidate B | `980a14cb5ac95cc917acf033dd74dc70e1a246f5` |
| Diagnostic C | `ec3240d74dc0a7114364b4204cc78f26100f3f8e` |
| M2 PR #2 | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, working tree clean, no commits from this work |
| `FREEZE.json` | 62 entries, **0 digest mismatches**, self-reference excluded |
| Hidden evaluator | `hiddenEvaluatorConsulted: false` — never read |

Branch content diff versus `f77e800`: only `synthetic/runs/d12-recheck/**`.

### Erratum E-1 (freeze metadata)

`FREEZE.json.experimentalHead` is `896c4d420712e766cdc40c1803072ef8f994d327`, while the published head
is `2c08a2f4…`. Both are correct for different things: `896c4d4` is the commit **whose contents** the
manifest froze; `2c08a2f` is the commit that **publishes** the manifest. The field name is ambiguous and
reads as a stale head. No digest is affected (the manifest excludes itself, verified), and no reviewer
output changes. Read `experimentalHead` as *contents-of-commit*, not *published-at*. The frozen
manifest is intentionally left untouched.

---

## 2. Requirement outcomes — reconciled from evidence

### Candidate A

| Obligation | Verdict | Evidence |
| --- | --- | --- |
| R1 list with requested filters and pagination | satisfied | 22-case model-free probe: `status=active`→4/6, `nameContains`→2/6, `limit=1`→1 item, `offset=5`→1 item, `status=active&limit=2&offset=1`→2 items, last partial page, total preserved pre-pagination |
| R2 UTC ISO-8601 via shared helper | satisfied | `src/records.ts` `listRecords` → `toUtcIsoString`; repo tests |
| R3 CSV export of the same filtered records | **violated** | public route `GET /records.csv` → **404**; only the helper existed (`src/csv.ts`) |
| Ordinary checks (`npm test`) | pass at A | frozen baseline |

Original Criteria Assessment: R1 satisfied, R2 satisfied, R3 violated — matches the probe on every clause.

### Candidate B

| Obligation | Verdict | Evidence (public route, model-free) |
| --- | --- | --- |
| R3 route + method | satisfied | `GET /records.csv` → 200 |
| R3 filtering (same filter set) | satisfied | `status=archived` rows `[rec-3, rec-4]` **identical** to listing ids |
| R3 whole filtered set, not one page | satisfied | 6 seeds < default page; export ignores `limit/offset` |
| R3 headers/columns | satisfied | header row `id,name,status,createdAt` |
| R3 escaping/delimiter | satisfied | shared `toCsvRow`/`escapeCsvField`; escaping assertions pass |
| R3 timestamps | satisfied | shared `toUtcIsoString`, UTC |
| R3 empty result | satisfied | header-only body |
| R3 error case | satisfied | bad `status` → 400 with `field` |
| R2 preserved | satisfied | shared formatter on both representations |
| R1 preserved (incl. specified boundaries) | satisfied | 22-case probe identical on A and B; focused tests cover offset/limit boundaries |
| Ordinary checks | pass | `npm test` **30/30**; proxy audit 20/20 |

Both reviewer paths on B: OCR produced **no requirement-level finding**, criteria returned R1/R2/R3
`satisfied`. The correction is established by the route probe and tests, **not** by the disappearance
of the OCR finding.

### Diagnostic C

`ec3240d` = B + one plausible wiring defect (`handle: GET /records.csv` validates the query, then calls
`exportRecordsCsv(parseListQuery({}))`). Model-free, **established before** the paid call:

| Assertion | Result |
| --- | --- |
| route present / content type / header | true / true / true |
| shared 400 still works | true |
| filters dropped | **true** — 6 rows exported where the listing filters to 2 |
| empty filter | 6 rows instead of 0 |

Criteria verdict: **R1 satisfied, R2 satisfied, R3 violated**, evidence naming `src/router.ts` and the
exact mechanism, correction "pass the result of `parseListQuery(request.query)`". Correct and anchored.

These are three correlated variants of one fixture. Nothing here is a detection-accuracy estimate.

---

## 3. R1 and the unsupported OCR objection

Frozen R1 is one sentence: *"The API must list records with the requested filters and pagination."* The
notes add that a requirement is satisfied only when a caller can exercise it. **There is no 400
requirement, no bound, and no default in the frozen text** — the probe records the same per case
(`stated400Obligation: "none in the frozen requirement"`).

- Empty `limit=`, empty `offset=`, both, and empty `status=` all return 200 with documented defaults.
  Their authority is labelled *"not specified by the frozen contract"*.
- The 400s that do occur (`limit=101`, `limit=0`, `limit=abc`, `offset=abc`, `status=deleted`) are all
  the candidate's own documented/implementation bounds, not frozen obligations.

**`UNSUPPORTED_OCR_OBJECTION` is fully justified.** R1's three material clauses — list, filters,
pagination — are each evidenced by the probe; `R1 satisfied` was supported by all material clauses, not
by an ID match. The verdict is not weakened by the empty-parameter case.

**Limitation recorded precisely:** R1's *default* pagination values (limit 20, offset 0) are
candidate-chosen, not contracted. "Requested pagination" is verified; "documented defaults" are verified
as the candidate's documented behaviour only, and no frozen clause depends on them. This does not create
a false acceptance.

---

## 4. Managed-rule delivery — audit of the correction

| | Original pilot | Corrected rerun |
| --- | --- | --- |
| Envelope | `merge_system_rule`, `include`, `rules[{id, content}]` (`b3fd4702…`) | `reviewrouter_managed_paths`, `rules[{path, rule, merge_system_rule, reviewrouter_exact_path}]` (`b3f14056…`) |
| Native parser | `ProjectRuleEntry{path, rule, merge_system_rule, reviewrouter_exact_path}`; admission demands `ExactPath && seen[path] && MergeSystemRule && Rule != ""` (`internal/config/rules/system_rules.go:206-217, 340`) | same |
| Policy text | `32c49219…`, 387 B, 5 lines | **byte-identical** |
| Delivered to model | **0 / 4** assigned paths | **4 / 4** |
| Evidence | deterministic render, policy text absent in every round | deterministic render: **+480 B on each of 6 review-bearing rounds**, opener unchanged (1,502 B) |
| Filtering policy | unchanged (no `--no-filter`) | unchanged |

Historical comparability: the original run is labelled *no-policy-delivered*, the corrected runs are
labelled *development regressions*. The original was not replaced. The two are not comparable as
policy-controlled reviews, and the decision report already says so.

### Production integration risk (recorded, not fixed)

The mismatch is proven at the **native parser**. The `id/content` + `include` envelope is preserved in
`rule-original.json`, but **its authoring builder is not present in the vendored ReviewRouter consumer
subset** in this workspace (the vendored tree contains only `ocr-review-outcome-contract.ts` and
`ocr-review-normalization.ts`). So whether the production rule builder is still incompatible, or whether
an unvendored adapter layer rewrites the envelope, **cannot be verified from this workspace**.

Consequence: if the production builder emits `id/content`, every managed review silently runs
*without* the intended policy — a trust-boundary defect of the same class as the pilot's. This is an open
integration risk for the ReviewRouter repository, not a finding about the OCR binary. No code was changed.

---

## 5. Native versus consumer-visible OCR — discrepancy resolved

The maintainer expected test-file findings might be filtered. They are not. Reproduced from the pinned
consumer source (`7a079c38…`):

- `normalizeOcrFindings` skips only on: unusable repository path, path outside `assignedPaths`, empty
  content/title, and span mapping failure. **No file-class rule, no severity threshold.**
- Severity map: `critical→critical`, `high→major`, `medium→minor`, `low→minor`; unknown → `minor` with a
  partial flag.
- `tests/records.test.ts` **is** in the assigned inventory, so the assigned-path gate does not exclude it.

| | Candidate A | Candidate B |
| --- | --- | --- |
| Native post-filter | 2 | 3 |
| Accepted by normalizer | 2 | 3 |
| Inline-placeable | 2 | **3** |
| Skipped / file-level-only | 0 / 0 | 0 / 0 |
| Visible on `tests/records.test.ts` | 1 minor | **3 minor** |

Resolution: the expectation was incorrect for this consumer version; the experiment's report was right.
The distinction is **inventory membership + payload validity**, not file class or severity. Native output
is not consumer-visible output until this normalization is applied — which the records do apply.

---

## 6. Verdict-count audit

| Run | Criterion verdicts | Non-empty evidence refs |
| --- | --- | --- |
| A (frozen) | 3 (R1 sat, R2 sat, R3 violated) | 3 / 3 / 3 |
| B | 3 (all satisfied) | 3 / 3 / 4 |
| C | 3 (R1 sat, R2 sat, R3 violated) | 3 / 3 / 4 |

`9/9` is **numerically correct as a count of 9 criterion verdicts over 3 correlated fixtures**, and the
frozen report already labels it a description, not an accuracy rate. Each verdict carries at least three
file/symbol references. What is *not* claimed: independent fixtures, a population, a confidence interval,
or that non-empty evidence is sufficient evidence.

---

## 7. Cost and execution reconciliation

| Claim | Audit |
| --- | --- |
| 50 forwarded | **confirmed** — 49 ledger entries + 1 initial criteria request recorded in `criteria-assessment.json` (4,312 in / 578 out) |
| 3 refused | **confirmed** — initial attempt 1 (47,334 B), B attempt 1 (68,917 B), B attempt 2 (69,877 B); none forwarded, none billable |
| 14 model-free | **confirmed** — 7 initial + 7 recheck offline preflights; proxy-local, never upstream |
| Conservative USD 0.55929 | **reproduced exactly** (all input at cache-write 1.25/M, all output at 5/M) |
| Authoritative USD 0.30584605 | **confirmed** provider `/key` reading after the final request |
| Remaining 0.69415395 | **confirmed** against the USD 1.00 experimental bound |
| Key limit USD 5.00 | **confirmed**; the 1.00 bound was enforced by the proxy, never by the provider |
| Cache reads | priced at 0.05/M by the provider, charged conservatively at 1.25/M — cannot understate |
| Cache writes | no "free write" assumption; every input token priced at 1.25/M |
| Reasoning output | `reasoningTokens` reported (89 / 93 / 67) and priced at the output rate |
| Failed B attempts' forwarded requests | included (6 and 5 forwarded, both charged) |

No later call exists: the last ledger entry is criteria C at 11:37; nothing was dispatched after it.

---

## 8. Recurring workflow cost and preparation

| Item | Recorded | Status |
| --- | --- | --- |
| Bundle files | changed files vs base (A 4, B 5, C 5) + fixed unchanged list (8 paths from `pr.json`) | measured |
| Selection rule | mechanical `git diff` + frozen metadata list | measured |
| Selector knew the defect | **yes** — the same person authored B and C | disclosed |
| Unchanged-code evidence | 8 fixed paths, always included | measured |
| Ordinary check evidence | **none supplied** to the model | measured |
| Manual preparation time | ~0 per run once written; assembly <1 s | **assembly measured, human time not measured** |
| OCR runtime | 47–69 s per stage | measured |
| Criteria runtime | 8.0–8.2 s | measured |
| Inference cost | ~USD 0.008–0.011 per criteria call at this fixture size | observed |
| Result processing | 1 structured object, 3 verdicts, 12 evidence refs | measured |
| Human review effort | not measured | **not measured** |

The ~USD 0.01 figure is an observation at ~24 KB of input on this fixture. Larger diffs, long context,
or tool loops scale input tokens directly and can hit the request bound (B already needed 74,631 B
against the 65,536 B pilot ceiling); missing runtime evidence cannot be recovered by a bigger bundle at
all.

---

## 9. Demonstrated product decisions

| # | Question | Classification | Evidence |
| --- | --- | --- | --- |
| 1 | Assessment found an unmet obligation OCR missed | **Not demonstrated** | On A, OCR *also* flagged the missing CSV route (`src/router.ts`, major). No candidate ran both paths where only the assessment found the gap |
| 2 | Justified positive assessment of corrected behaviour | **Demonstrated** | B: R3 satisfied citing route, `matches`, `CSV_COLUMNS`, shared helper; corroborated by the route probe |
| 3 | Helped reject an unsupported OCR objection | **Not demonstrated** | The rejection came from the frozen R1 text + the 22-case probe. The assessment never saw the objection (independent profile) |
| 4 | Detected the disconnected-behaviour diagnostic | **Demonstrated** | C: R3 violated, exact mechanism and correction |
| 5 | Useful missing-evidence handling | **Not demonstrated** | No case supplied absent evidence; Diagnostic B was skipped |
| 6 | Reduced human effort to understand completion | **Partially supported** | Per-requirement verdict + anchors + correction, vs 3 inline nits on B; **no measurement** |
| 7 | Ever issued an unsupported `satisfied` | **Not demonstrated** (none observed) | 3 runs, 9 verdicts; the property is untested, not proven |
| 8 | Decisions already established by deterministic tests | **Demonstrated** | A 404, B route/filters/escaping/UTC/empty/400, C filter drop, R1 filters+pagination — all from probes/tests |
| 9 | Genuinely required semantic reasoning | **Partially supported** | Mapping a defect to the right criterion and writing the correction; the underlying fact was check-established |
| 10 | Depended on manual context selection | **Demonstrated** | All three bundles hand-selected; no retrieval in the `/llm` path; C authored by the auditor |

**The load-bearing finding of this audit:** every behavioural fact behind every verdict was already
establishable deterministically. What the assessment added was **packaging and articulation** —
per-requirement status, anchored evidence, an actionable correction — not new discovery. Claiming more
would confuse a structured output with demonstrated value.

---

## 10. Directions

**A — Reuse existing OCR and check evidence.** Minimum: map assigned paths to criteria and render
existing findings + check results as an action list; never convert silence into `satisfied`. Reuses the
qualified binary, managed rules, the pinned consumer, the proxy. Failure modes: silence≠evidence; the 3
test-file nits on B are the noise floor; rule-delivery wiring must be verified or the review is
policy-free. Preparation: none. Review: per-comment triage. Cost: no extra inference. Not tested as a
workflow.

**B — Optional bounded Criteria Assessment.** Exercised end-to-end (3 calls, 9 verdicts) via the existing
Gateway SDK `/llm`. Unimplemented/unverified: mechanical bundle at scale, genuine missing-evidence
abstention, cost at larger diffs, any gate. Do not claim that instructing `inconclusive` produces
reliable abstention — it was never exercised.
**C — Improve evidence collection first.** Deterministic public-route checks, ordinary test results,
fixed unchanged context, reproducible selection. This is where every behavioural decision in this pilot
actually came from; it costs nothing and needs no model.

**Existing OCR Behavior/Impact task** (verified in source at `cmd/opencodereview/analysis.go:34-36`):
`--analysis` is **rejected** with `--reviewrouter-managed`; output is a Markdown brief with `[[obs-…]]`
provenance markers and a completion flag — **no criterion-level verdicts, no requirement model**. It is
the strongest existing asset for machine-checkable evidence, the weakest for verdicts, and unusable in
managed mode without changing the consumer mode. Not activated; engine unmodified.

---

## 11. Recommended single bounded next step

The previous recommendation was "one bounded assessment call per PR with a mechanical bundle and
mandatory inconclusive". **It survives, but only in a narrower and more defensible form**, because the
audit shows the decisions came from checks and the assessment packaged them:

> **Prototype an opt-in, advisory criterion assessment that consumes the deterministic check results
> alongside the code bundle, and is judged against a checks-only baseline.**

1. **Smallest code change** — one adapter that (a) calls the existing public-route/check runner, (b)
   assembles `{criteria, changed files, fixed unchanged list, check results}` as text, (c) makes **one**
   `/llm` call with the frozen instructions + JSON schema, (d) returns the object unmodified.
2. **Boundaries reused** — Gateway SDK `createLlmClient()`, the bounded proxy, M2 check contracts; no
   new retrieval, no orchestration, no OCR change.
3. **Inputs/outputs** — in: explicitly supplied criteria + code + check results. Out:
   `{requirementId, status ∈ {satisfied, violated, inconclusive}, evidence[{path, reference}],
   explanation, correction}`; displayed as advisory text only.
4. **Failure/abstention** — no checks and no decisive file ⇒ `inconclusive`; provider error ⇒ no output,
   no retry beyond one attempt; never blocks a PR.
5. **Minimum offline tests** — schema round-trip; bundle assembly golden file; abstention on empty
   evidence; no gate wiring; no network in unit tests.
6. **Success measurement** — on preregistered cases with known ground truth: does the assessment change
   a maintainer decision that checks alone did not? Count verdicts that contradict the checks and are
   **right**, and `satisfied` verdicts that are **wrong**.
7. **Stop/go** — GO only if it produces at least one *correct* decision the checks did not, with zero
   wrong `satisfied`. STOP if checks alone match it on every case.
8. **What reverses it** — a wrong `satisfied` on a runtime-only defect, or evidence that per-PR bundle
   maintenance costs more than comment triage → fall back to Direction A/C.

Alternatives if the maintainer prefers less machinery: **A** (findings-as-actions, no model) or **C**
(deterministic evidence only). Both are cheaper and already justified by this evidence.

---

## 12. Limitations and the most consequential open uncertainty

1. One fixture family; three correlated variants; `9/9` is a count, not accuracy.
2. The bundle was hand-selected by someone who knew the defects; no retrieval and no check results were supplied.
3. Genuine missing-evidence abstention was never tested.
4. The assisted profile (OCR + checks → assessment) was never run.
5. Candidate B's OCR stage used a revised request bound (131,072 B); A completed under 65,536 B.
6. OCR is nondeterministic (4 findings pre-correction, 2 after, same candidate).
7. Consumer-visible filtering was reproduced for this pinned consumer version only.
8. Provider settlement lags; per-stage deltas are not authoritative, the end-state `/key` read is.

**Most consequential uncertainty:** whether an advisory assessment adds a decision the deterministic
checks do not already provide. This pilot cannot answer it, because every behavioural fact was
established by checks before the model was asked, and the person selecting the evidence already knew the
defects. That is precisely what the proposed prototype's stop/go criterion exists to settle.

---

## 13. Evidence references

- `synthetic/runs/d12-recheck/REPORT-d12-decision.md` (`612b8ed5…`) — frozen decision report
- `synthetic/runs/d12-recheck/FREEZE.json` — 62 entries, 0 mismatches, self-reference excluded
- `synthetic/runs/d12-recheck/reconciliation.json` — cost/request reconciliation reproduced here
- `synthetic/runs/d12-recheck/consumer-view-A.json`, `consumer-view-B.json` — native vs visible
- `synthetic/runs/d12-recheck/criteria-assessment-B.json`, `criteria-assessment-C.json`
- `synthetic/runs/d12-initial/evidence/criteria-assessment.json` — frozen A assessment
- `synthetic/runs/d12-initial-rr1/ocr-result-live.json`, `ledger-live.jsonl` — frozen OCR
- `synthetic/runs/d12-recheck/ocr-result-A-live.json`, `ocr-result-B-live-revised.json`
- `synthetic/runs/d12-rr1-rulecheck/rule-documents.json`, `fake-requests-finding-{original,corrected}.jsonl`
- `synthetic/runs/d12-r1-probe/r1-contract-probe-{A,B}.json` — 22 cases per candidate
- `synthetic/runs/d12-recheck/candidate-b-route-evidence.json`, `diagnostic-c-route-evidence.json`
- `synthetic/runs/d12-recheck/ocr-behavior-impact-reuse.md`; source check `cmd/opencodereview/analysis.go:34-36`
- Pinned consumer: `777genius/review-router@7a079c38…` — `ocr-review-normalization.ts` (severity map, skip rules)

Not included in `FREEZE.json` by design: this handoff and the erratum below, which are post-freeze
analysis rather than reviewer output.
