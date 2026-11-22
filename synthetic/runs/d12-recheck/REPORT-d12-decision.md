# D1/D2 — Feedback, correction, recheck, targeted diagnostic and product decision

Status: **complete for the authorized scope. One product recommendation, no production implementation.**
Supersedes the unexecuted columns of `REPORT-d12-feedback-cycle.md`; that report and
`REPORT-d12-initial-rr1.md` are preserved unchanged as historical records.

Return code: `BOUNDED_RESEARCH_COMPLETE — PRODUCT_RECOMMENDATION_READY`

---

## 0. What changed since the blocked report

The blocked report ended because the provider credential was unreachable. It became reachable in this
session's environment, so the planned paid work ran. Three things happened that the blocked report
could not know:

1. The corrected rule document **does** deliver the policy text — proven by byte-level diff of the
   deterministic render and by the live stage.
2. Candidate B's managed OCR **cannot complete under the pilot's 65,536-byte request bound**: two
   attempts were refused mid-run at 68,917 B and 69,877 B. It completed only under a verified revised
   bound (131,072 B), recorded as a development-regression harness change.
3. The independent Criteria Assessment was **correct on all three candidates** (9/9 requirement
   verdicts), including a disconnected-behaviour variant it had never seen.

---

## 1. Executed stages

| Stage | Requests | Refused | Input tok | Output tok | Max body | Conservative USD | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| initial OCR attempt 1 (frozen) | 3 | 1 | 12,491 | 1,222 | 47,334 (refused) | 0.02172375 | failed at the then-current bound |
| initial OCR (frozen) | 10 | 0 | 70,346 | 3,116 | 62,517 | 0.10351250 | complete, 4 comments |
| initial Criteria Assessment (frozen) | 1 | 0 | 4,312 | 578 | — | 0.00828000 | R1 sat, R2 sat, R3 violated |
| recheck OCR **A**, corrected rules | 10 | 0 | 76,591 | 2,729 | 64,768 | 0.10938375 | complete, 2 comments |
| recheck OCR **B** attempt 1 | 6 | 1 | 47,553 | 2,751 | 68,917 (refused) | 0.07319625 | failed, not used as evidence |
| recheck OCR **B** attempt 2 | 5 | 1 | 38,314 | 2,683 | 69,877 (refused) | 0.06130750 | failed, not used as evidence |
| recheck OCR **B**, revised bound | 13 | 0 | 113,172 | 3,904 | 74,631 | 0.16098500 | complete, 3 comments |
| recheck Criteria **B** | 1 | 0 | 5,869 | 603 | 24,239 | 0.01035125 | all three satisfied |
| Diagnostic A: Criteria **C** | 1 | 0 | 5,900 | 635 | 24,389 | 0.01055000 | R1 sat, R2 sat, R3 **violated** |

Plus 14 model-free offline requests (transport preflights; proxy-local, never forwarded upstream,
never billed).

Runtime: OCR 47–69 s per stage; criteria 8.0–8.2 s per call.

Settings held identical throughout: `openai/gpt-6.1-terra`, service tier `default`, reasoning effort
`medium`, qualified binary `1.14.0-rr.1` (`443d7777…`), `--reviewrouter-managed`, ordinary filtering
(no `--no-filter`), concurrency 1, `--audience agent`, requirements `record-api-req-v1`
(`ca868a3f…`), same background template, same criteria instructions (`1c30edd0…`) and JSON schema.

---

## 2. Was the intended policy actually delivered? (final answer)

**No, it was not — in the frozen initial stage. Yes, it is now, after a harness-only fix.**

| Fact | Evidence |
| --- | --- |
| Frozen rule document shape | `merge_system_rule`, `include`, `rules[{id, content}]` |
| Native parser contract | `rules[{path, rule, merge_system_rule, reviewrouter_exact_path}]` |
| Parse of the frozen document | `content` is not `rule`; entries carry no `path`; `include` is force-include, not an inventory → **0 of 4 assigned paths carried rule text** |
| Deterministic render, frozen doc | policy text present in **0 of 4** review rounds |
| Deterministic render, corrected doc | policy text present in **4 of 4** review rounds |
| Byte-level proof | corrected render adds exactly **+480 B** to every one of the 6 review-bearing rounds (17,161→17,641; 18,674→19,154; 21,964→22,444 …), opener unchanged at 1,502 B |
| Live corroboration | corrected live stage's round bodies are consistent with that +480 B block |

Policy text (`32c49219…`, 387 B, 5 lines) is **byte-identical** in both documents; only the envelope
and the per-entry tags changed. No approved wording and no filtering policy was modified.

Consequence: the frozen initial OCR ran **without** the managed policy. Its findings are retained as
historical observations, not as policy-controlled reviews; the corrected runs are labelled
development regressions, and A→B is compared **within** the corrected pair.

---

## 3. Native OCR versus ReviewRouter-visible OCR

Pinned consumer `777genius/review-router@7a079c38…` (`ocr-review-outcome-contract.ts` +
`ocr-review-normalization.ts`), deterministic reconstruction, both candidates:

| | Candidate A | Candidate B |
| --- | --- | --- |
| Contract parse | accepted | accepted |
| A. native post-filter | 2 findings | 3 findings |
| B. accepted by normalizer | 2 | 3 |
| C. inline-placeable | 2 | 3 |
| D. skipped / file-level only | 0 / 0 | 0 / 0 |
| Severity mapping | low→minor ×1, high→major ×1 | low→minor ×3 |
| Visible on `tests/records.test.ts` | 1 (minor) | **3 (minor)** |

**The `tests/records.test.ts` findings are not excluded.** No assigned-path rejection, no comment
filtering, no severity suppression. On Candidate B the entire ReviewRouter-visible output is three
minor test-quality suggestions — all three are inline and all three reach users.

This is a reconstruction of the consumer boundary, not a claim that the CLI's own JSON equals what a
ReviewRouter user sees; it is what the pinned consumer would make of that JSON.

---

## 4. `src/records.ts:46` (empty `limit=`/`offset=`) — unchanged classification

`UNSUPPORTED_OCR_OBJECTION`. The frozen R1 states no 400 obligation for empty parameters, so no
numeric threshold or status requirement can be imported without inventing one. `R1 satisfied` stands;
no R1 change entered Candidate B.

Additional evidence obtained this cycle: under correct policy delivery the medium-severity
`src/records.ts` objection **did not reproduce at all** (A produced 2 findings, neither on
`records.ts`). Run-to-run instability, not a contract violation.

---

## 5. Candidate B — implementation and independent verification

- Commit `980a14cb5ac95cc917acf033dd74dc70e1a246f5`, descendant of frozen A
  (`23864e3c877f2b34bbbdd90c4527ef46eb19cbd9`, tree `aa4af8c4…` unchanged).
- Diff A→B: 4 files, +145/−1. `GET /records.csv`, whole filtered set, `id,name,status,createdAt`,
  shared `matches`/`parseListQuery`/`toCsvRow`/`escapeCsvField`/`toUtcIsoString`, `text/csv`,
  header-only empty result, shared 400 for bad parameters.
- `npm test` 30/30; proxy audit 20/20; public-route probe: A 404, B 200 with exact CSV body, filters,
  escaping, UTC timestamps, empty result and 400 field reporting.
- Information the implementer needed: original report (for the R3 gap), frozen requirements,
  source inspection of the existing helpers, existing tests. **The feedback alone was actionable** —
  no human clarification was required, and no assumption had to be invented.

---

## 6. A→B recheck: both frozen reviewer paths

### Ordinary managed OCR (corrected rule delivery)

| | A | B |
| --- | --- | --- |
| Findings | `tests/records.test.ts` minor; **`src/router.ts` major — missing CSV export route** | 3 × `tests/records.test.ts` minor |
| Requirement-level signal | yes, R3 gap, with an actionable correction | none |
| Terminal state | complete | complete |

The A finding is a correct, useful action: it names the missing capability and prescribes the fix. The
B output contains no requirement-level signal; its three findings are test-coverage/style nits that a
reviewer must triage.

**A disappeared finding is not proof of correction.** Correction is established only by the
public-route probe (§5) and by the criteria path (§7).

### Independent Criteria Assessment (Profile B, unchanged prompt)

| | A (frozen) | B (recheck) | C (diagnostic) |
| --- | --- | --- | --- |
| R1 | satisfied | satisfied | satisfied |
| R2 | satisfied | satisfied | satisfied |
| R3 | **violated** — "CSV helper exists … no service route produces a CSV export" | **satisfied** — route, shared filters, whole set, shared helper | **violated** — "route discards the caller's parsed query" |
| Evidence anchors | router, records, csv, tests | router, records, csv, tests | router (`parseListQuery({})`), records, csv, tests |
| Verdict correct | yes | yes | yes |

9 of 9 requirement verdicts were correct across three correlated candidates of one fixture family.
That is **not** an accuracy estimate; the variants are not independent observations.

---

## 7. Optional diagnostics

**Diagnostic A — disconnected behaviour — RAN (1 of the authorized 2).**

- Question: can verification catch a capability that looks complete in the diff but does not deliver
  the required result to the consumer?
- Frozen input: Candidate C `ec3240d74dc0a7114364b4204cc78f26100f3f8e`, parent B, one plausible wiring
  defect — the CSV route validates the caller's query and then exports `parseListQuery({})`.
- Expected behaviour, established model-free *before* any paid call: route present, `text/csv`, correct
  header, shared 400 still working, **filters dropped** — `status=archived` exports 6 rows while the
  listing filters to 2; `nameContains=no such record` exports 6 rows instead of 0.
- Control: Candidate B under the identical profile (filters applied, `satisfied`).
- Result: the assessment named the exact defect (`handle: GET /records.csv validates request.query but
  calls exportRecordsCsv(parseListQuery({}))`), cited the right files, and prescribed the correct fix.
  It did **not** invent functionality and did not return an unjustified `satisfied`.
- Cost: 1 request, USD 0.01055 conservative, 8.2 s.

**Diagnostic B — insufficient evidence / no natural review location — SKIPPED.**

The C case resolved the remaining product question (does a bounded assessment verify delivery, not just
code presence?) without OCR. Diagnostic B would test the opposite failure mode — an unjustified
`satisfied` when evidence is genuinely absent — and the fixture has no obligation that is unreachable
from the supplied bundle, so the case would have had to be constructed rather than observed. Cost was
available (USD 0.69416 authoritative); the value was not. This is recorded as an evidence limitation
(§10), not as a passing result.

OCR + checks + assisted assessment (the alternative input profile) was therefore **not tested** and is
not claimed anywhere in this report.

---

## 8. Evidence assembly: what was actually automatic

| Question | Answer |
| --- | --- |
| Source files included | every file changed against base `ce99b0d` (A: 4, B: 5, C: 5) |
| Unchanged files included | fixed list from `metadata/pr.json`: `package.json`, `src/csv.ts`, `src/format.ts`, `src/store.ts`, `tests/csv.test.ts`, `tests/format.test.ts`, `tests/store.test.ts`, `tsconfig.json` |
| Check results included | **none** — the assessment never sees `npm test` output |
| OCR findings included | **none** — independent profile by design |
| Omitted | runtime behaviour, executed checks, anything outside the two lists |
| Who selected | the harness, mechanically from `git diff` + the frozen metadata list |
| Did the selector know the defect? | yes — I built B and C, so I knew where to look. The selection rule is defect-independent (diff + fixed list), but I chose the rule and the fixed list |
| Manual effort | ~0 per run once written; the bundle is 21.5 KB of code and is assembled in <1 s |
| Automated retrieval available | none inside the Gateway SDK `/llm` call: it encodes, streams and decodes; it does not fetch or execute |
| Did the model request missing context? | no; it answered from the bundle |
| Could the missing context be collected mechanically? | yes — the public route check in §5/§7 is deterministic and cheap, and neither reviewer path receives it |

**Central limitation:** correct conclusions depended on a bundle that a human selected, and on defect
knowledge to design the cases. Do not attribute the verdict quality to autonomous model capability.

---

## 9. Reuse of the upstream OCR Behavior/Impact work

Source inspection only (`ocr-behavior-impact-reuse.md`), no execution, `--analysis` untouched.

- It has genuine observation provenance and broader read scope, which would help *collect* evidence.
- It produces **no per-criterion verdicts**, and managed mode explicitly rejects `--analysis`, so it
  cannot be turned on inside the frozen pilot.
- Compared with a bounded criteria call: far more integration effort, no requirement coverage, and it
  would not have changed any verdict in §6.
- It is **not** a requirement verifier today, and this report does not claim it is.

---

## 10. Budget and reconciliation

Verified public prices for `openai/gpt-6.1-terra`: input 1.00, cache read 0.05, **cache write 1.25**,
output 5.00 per million; the ≥272k-prompt override (2.00 / 7.50) is unreachable under the byte bound.

Conservative accounting prices **every input token at the cache-write rate** and every output token at
the output rate, so it can never understate a bill:

| | Value |
| --- | --- |
| Provider-authoritative spend, start | USD 0.09085455 |
| Provider-authoritative spend, end | **USD 0.30584605** |
| Authoritative delta this cycle | USD 0.21499150 |
| Conservative worst-case total | USD 0.55929 |
| Remaining against the USD 1.00 ceiling (conservative) | **USD 0.44071** |
| Remaining against the USD 1.00 ceiling (authoritative) | **USD 0.69415395** |
| Provider key limit (verified, not assumed) | **USD 5.00**, remaining USD 4.69415395 |
| Requests | **50 forwarded, 3 refused** (plus 14 model-free offline) |

Admission was enforced by the proxy, not estimated: slot and reservation are taken synchronously
before forwarding, the reservation is the maximum permitted request cost, absent usage keeps the full
reservation and halts, non-2xx/timeout is treated as ambiguous (full reservation, halt), and a
reported usage above the ceiling halts the stage. Reservation arithmetic used:
`charged + reserved + requestCeiling ≤ stageCap`.

Refusals never forwarded, so a refused request is not billable. Provider settlement lags, so per-call
before/after deltas are shown in the raw records but are not used as the authoritative total.

`reconciliation.json` (this directory) reproduces all of the above from the retained ledgers.

---

## 11. Product comparison

| | Ordinary OCR alone | Independent Criteria Assessment | OCR + checks + assisted assessment | Evidence / check collection |
| --- | --- | --- | --- | --- |
| Correct violation detection | 1/1 on A (R3, with correction); nothing needed on B | 3/3 candidates, 9/9 verdicts, incl. disconnected behaviour | **not tested** | detects both defects deterministically when run |
| Incorrect `satisfied` | n/a (no verdicts) | 0 observed (n=3, correlated) | not tested | n/a |
| Unsupported objections | 1 in the pre-correction run (empty parameter), non-reproducing | 0 | not tested | n/a |
| Missing-evidence handling | none — silence is indistinguishable from success | can name missing evidence; not exercised | not tested | n/a |
| Execution failures | 2 of 3 B stages refused at the request bound | 0 of 3 | — | 0 |
| Context assembly effort | none manual, but the rule wiring itself was defective | ~21.5 KB bundle, mechanical, ~1 s; selector chosen by a human | — | hand-written per case |
| Human review effort | high: triage 3 minor test nits to find zero requirement signal | low: status + evidence + correction per requirement | — | low, but per-PR |
| Runtime | 47–69 s | 8.0–8.2 s | — | ms |
| Paid cost per run | 0.10–0.16 | **0.008–0.011** | — | 0 |
| Reproducibility | nondeterministic; A gave 4 findings pre-correction and 2 after | same prompt/schema; one sample per candidate | — | fully deterministic |

Reading: OCR is a diff-local code reviewer. It produced one genuinely useful requirement action (A) and
otherwise produced test-file noise that is fully visible to users. The bounded assessment produced
correct, anchored, actionable per-requirement verdicts for about a cent and eight seconds — but only
over an evidence bundle a human assembled, and only where the defect is visible in that bundle.

---

## 12. Directions

**A. Reuse existing OCR and ordinary check evidence more effectively.**
Value: turns already-paid OCR output into requirement-level signal instead of inline nits. Reuses the
qualified binary, managed rules, the pinned consumer and the existing proxy. Smallest implementation:
map each requirement to its assigned paths, and mark a requirement "no comment" rather than "satisfied"
when OCR returns nothing — a reporting change, not an engine change. Failure modes: silence is not
evidence; the three visible B nits show the noise floor; rule-delivery wiring must be verified or the
review is policy-free. Preparation: near zero. Review: still per-comment triage. Cost: no extra
inference. Would change: if most PRs have findings that map cleanly to requirements, this is enough.

**B. Add a separate lightweight, bounded requirement assessment.** ← recommended
Value: per-requirement `satisfied`/`violated`/`inconclusive` with evidence and a correction — the only
tested path that gave an actionable verdict per requirement, including a behavioural defect. Reuses the
existing Gateway SDK `/llm` path, the frozen requirements document and the diff-based bundle. Smallest
implementation: one call per PR, fixed instructions and JSON schema, mechanical bundle (changed files +
a declared unchanged list), one attempt, hard caps. Failure modes: a human-selected bundle can omit the
decisive file; a defect visible only at runtime can still be called `satisfied`; correlated single-fixture
evidence is not an accuracy guarantee. Preparation: the unchanged-context list must be maintained.
Review: low. Runtime ~8 s, cost ~USD 0.01. Would change: a demonstrated runtime-only violation that the
bundle cannot express — that moves work to direction C.

**C. Improve evidence collection and verification contracts first.**
Value: makes "verified" mean executed, not read. Reuses the public route and the project's own checks.
Smallest implementation: attach the ordinary check result and a deterministic public-route probe to the
assessment input. Failure modes: check theatre (green unrelated tests), harness cost per PR, and the
bundle grows toward the request bound — B already needed 74,631 B against a 65,536 B limit. Preparation:
per-project probe wiring. Review: low. Runtime: ms + one call. Would change: if most real defects are
runtime-only, this becomes the prerequisite rather than the follow-on.

---

## 13. Recommendation (one next action)

**Ship direction B as the smallest useful thing: one bounded requirement-assessment call per PR, with a
mechanically assembled evidence bundle, a fixed prompt/schema, and a mandatory `inconclusive` when
evidence is absent — do not build C first, but do attach the check result as soon as B is in use.**

Rationale from evidence, not extrapolation: B was the only path that produced a correct, actionable,
anchored verdict for every requirement on every candidate tested (9/9), at ~1 % of OCR's cost and ~10 %
of its runtime, and it caught the disconnected-behaviour defect without any hint. OCR's own
contribution is real but narrow (one missing-capability finding) and its visible output on a correct
candidate is entirely test-file noise.

The two findings that would change this recommendation: (i) a runtime-only violation that the bundle
cannot express, missed with `satisfied` — then C comes first; (ii) evidence that per-PR bundle
maintenance costs more than comment triage — then A is enough.

---

## 14. Validation checklist

- Frozen A unchanged: `23864e3…`, tree `aa4af8c4b01304cd1efac0917a0e9cca56374108`.
- Candidate B separate: `980a14c…`, descendant of A, unchanged by this cycle.
- Original report preserved: `REPORT-d12-initial-rr1.md`, `REPORT-d12-feedback-cycle.md`, `ERRATUM…` untouched.
- Both reviewer paths kept frozen settings: same model, tier, effort, binary, requirements, filtering.
- Managed-rule delivery checked: yes — deterministic render + byte delta + live stage.
- ReviewRouter-visible filtering evaluated: yes — 0 skipped, all findings visible.
- Behaviour tested through the public route: A 404 vs B 200 CSV, filters/escaping/UTC/empty/400; C's
  dropped filters proven before the paid call.
- All paid calls inside USD 1.00: conservative 0.55929, authoritative 0.30584605.
- Cache writes and reasoning output priced in: yes (input at the cache-write rate, output at the output rate).
- No credentials in the branch: secret scan run before commit (§15).
- M2 PR #2 untouched: `996cdcb`, clean, no commits from this cycle.
- rr.7 historical evidence untouched.
- Hidden evaluator: **never read**. No prompt, correction or case design was influenced by it.

---

## 15. Limitations

1. One fixture family. A, B and C are correlated variants; 9/9 verdicts is a description, not an accuracy rate.
2. The assessment bundle is human-selected and contains no check results; a runtime-only defect could still be reported `satisfied`.
3. Diagnostic B (missing evidence) was not run, so "avoids an unjustified `satisfied` when evidence is absent" is **unverified**.
4. The assisted profile (OCR + checks → assessment) was not tested; no cost or quality claim is made for it.
5. Candidate B's OCR stage ran under a revised verified bound (131,072 B / 262,144–24,000 tokens) because its bundle exceeded 65,536 B. A's stage was complete at 0 refusals under the frozen bound, but the two runs are not byte-cap identical.
6. OCR is nondeterministic: the frozen initial stage produced 4 findings, the corrected-delivery A stage produced 2 on the same candidate.
7. Provider settlement lags; the authoritative figure is the end-state `/key` usage, and per-stage deltas in the raw records can be incomplete.
