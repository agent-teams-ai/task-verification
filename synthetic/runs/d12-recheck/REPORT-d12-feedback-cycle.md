# D1/D2 feedback cycle — rule delivery, Candidate B, and the blocked recheck

- Date: 2026-11-22
- Branch: `exp/synthetic-live-pilot-01` (experiment evidence only; PR #2 untouched)
- Frozen Candidate A: `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` (unchanged)
- Candidate B: `980a14cb5ac95cc917acf033dd74dc70e1a246f5` (descendant of A)
- Qualified comparator: `1.14.0-rr.1`, binary SHA-256 `443d7777…`, source `8a70944f…`
- Original report: `../d12-initial-rr1/REPORT-d12-initial-rr1.md` — **not modified**
- **Verdict: `BLOCKED — EXACT_ACCESS_COMPATIBILITY_OR_BUDGET_CAUSE`**
  (provider credential absent; the A→B recheck could not be dispatched)

No paid request was made in this phase. USD 0.09085455 spent, USD 0.90914545 remaining.

---

## 1. State verified before any work

| Item | Value |
| --- | --- |
| M2 HEAD / worktree | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, clean |
| Experiment HEAD before this phase | `edd985c190475f6ef2d12803e6c2f17eabff17e1`, clean |
| Fixture | A present at `23864e3`; base `ce99b0d` present; worktree clean before B |
| Frozen digests | requirements `ca868a3f…`, `pr.json` `9b48eb1b…`, reviewer input `4ffebc0d…`, checks `RESULTS-A.md` `85d60b7b…` — all recomputed identical |
| rr.7 stage | `../d12-initial/` untouched |
| rr.1 stage | `../d12-initial-rr1/` untouched (this phase writes only to new directories) |

---

## 2. Managed-rule delivery — **the policy text did not reach the model**

This is a confirmed contract mismatch, proven three ways.

**2.1 Rule document shape.** The frozen pilot document (`rule.json`, `b3fd4702…`, 620 B) is

```json
{ "merge_system_rule": true, "include": [4 paths], "rules": [{ "id": "reviewrouter-managed-v1", "content": "5 policy lines" }] }
```

**2.2 Native parser contract** (source at the qualified commit `8a70944f…`,
`internal/config/rules/system_rules.go`):

```go
type ProjectRuleEntry struct {
    Path            string `json:"path"`
    Rule            string `json:"rule"`
    MergeSystemRule bool   `json:"merge_system_rule,omitempty"`
    ExactPath       bool   `json:"reviewrouter_exact_path,omitempty"`
}
type ProjectRule struct {
    Rules        []ProjectRuleEntry `json:"rules"`
    ManagedPaths *[]string          `json:"reviewrouter_managed_paths,omitempty"`
    Include      []string           `json:"include,omitempty"`
    Exclude      []string           `json:"exclude,omitempty"`
}
```

`encoding/json` drops `id` and `content`; `matchProjectRuleEntry` skips an entry whose `Rule` is
empty and whose entry-level `MergeSystemRule` is false. Two further consequences:

- the document-level `merge_system_rule` is also an unknown key, so no system-rule merge happened;
- `include` is a **force-include, not an allowlist** (`internal/agent/selection.go`), so the
  "assigned changed paths" inventory was **not** enforced by admission; only
  `reviewrouter_managed_paths` creates that inventory.

The upstream managed qualification harness has the same shape
(`tools/managed/qualification/main.go:277`) and asserts nothing about rule text in the payload, so
the CI qualification passes while the policy is silently dropped. Its stated purpose is
managed-process and protocol behaviour, not rule delivery, so this is a coverage gap rather than a
contradiction of the qualification receipt.

**2.3 Model-bound payloads.**

| Capture | Review-round payloads | Payloads containing any policy line |
| --- | --- | --- |
| `../d12-initial-rr1/fake-requests-onegroup.jsonl` | 9 | **0** |
| `../d12-initial-rr1/fake-requests-probe.jsonl` | — | **0** |
| `../d12-initial-rr1/fake-requests-split.jsonl` | — | **0** |

**2.4 Deterministic model-free repair probe** (`../d12-rr1-rulecheck/`, no provider, no credential,
no spend): same binary, same invocation, same five policy lines, only the document shape changed.

| Variant | Requests | Review rounds | Payloads carrying the policy text |
| --- | --- | --- | --- |
| Original document (`rule-original.json`, `b3fd4702…`) | 6 | 4 | **0** |
| Parser-correct document (`rule-corrected.json`, `b3f14056…`) | 6 | 4 | **4** |

In the corrected variant the text arrives inside the merged `## System-Specific Rules (Mandatory)` /
`## User-Specific Rules (Mandatory)` block. Evidence: `../d12-rr1-rulecheck/rule-delivery.json`.

**2.5 What this does to the original result.** The initial OCR observation is preserved but is **not**
a policy-controlled review: the "report only issues material to this change" rule was absent. It
found the R3 gap and two test-quality notes without that instruction, which makes its precision
*understated* rather than overstated by the policy. Any later run with the corrected wiring is a
**corrected development regression**, not the same experimental observation. The original report and
erratum are unchanged.

---

## 3. Native versus ReviewRouter-visible findings

Deterministic reconstruction with the pinned consumer modules
(`777genius/review-router@7a079c38…`, byte-identical copies in M2 `vendor/`) applied to
`../d12-initial-rr1/ocr-result-live.json`. Evidence: `consumer-view.json`.

| Stage | Count |
| --- | --- |
| A. Native post-filter findings delivered by the CLI | 4 |
| B. Accepted by `parseOcrNativeReviewResult` + `normalizeOcrFindings` | 4 |
| C. Inline-placeable (span verified inside the current diff) | 4 |
| D. Skipped / file-level only | 0 / 0 |

Severity mapping applied by the consumer: `high→major`, `medium→minor`, `low→minor`. The two
low-severity findings on `tests/records.test.ts` (lines 11 and 64–68) are **not excluded**: both pass
the assigned-inventory check, both anchors are verified added lines, and both are publishable inline
as `minor`. The native titles and messages are preserved.

Nothing outside the pinned modules was applied. Any further product-side visibility policy (for
example a severity floor) lives in ReviewRouter and is not represented here, so this artifact must
not be read as "what every ReviewRouter user sees" — only as what the pinned consumer accepts.

Product consequence: 2 of 4 visible comments are test-quality notes that no requirement makes
material, and one (`src/records.ts:46`) is the objection resolved in §4. Half the visible surface is
triage cost that does not advance a requirement decision.

---

## 4. The empty-parameter finding — `UNSUPPORTED_OCR_OBJECTION`

Frozen contract text for R1 is exactly: "The API must list records with the requested filters and
pagination." The document states no numeric bounds and **no 400 obligation of any kind**. The
candidate's own README documents `limit` default 20 / maximum 100 and `offset` default 0.

Model-free probe through the public route, 22 cases, identical on A and B
(`../d12-r1-probe/r1-contract-probe-{A,B}.json`):

| Case | Observed |
| --- | --- |
| missing parameters | 200, limit 20, offset 0, total 6 |
| `limit=` empty, `offset=` empty, both, `status=` empty | 200, documented defaults, total 6 |
| `limit=1`, `limit=100` | 200 |
| `limit=0`, `limit=101`, `limit=abc`, `limit=-1`, `limit=1.5` | 400 with `field: "limit"` |
| `offset=0`, `offset=5`, `offset=99`, `offset=MAX_SAFE_INTEGER` | 200, correct paging/past-the-end |
| `offset=abc`, `status=deleted` | 400 with the right field |
| `status=active&limit=2&offset=1`, `limit=2&offset=5` | 200, correct rows |

Classification: **`UNSUPPORTED_OCR_OBJECTION`**. The finding asserts a "stated 400 contract" for
explicitly empty values; the frozen requirements state no such thing, and treating an empty value as
omitted is a defensible reading of "requested filters". The behaviour is under-specified, not wrong.

Consequences, as the brief requires:

- the original Criteria Assessment `R1 satisfied` verdict **stands** and is **not** reclassified as
  `INCORRECT_SATISFIED_ASSESSMENT`;
- no R1 behaviour change entered Candidate B;
- the objection is recorded, not silently adopted, and not resolved in the reviewer's favour.

---

## 5. Candidate B

Commit `980a14cb5ac95cc917acf033dd74dc70e1a246f5`, parent A, `+145 / −1` across four files:
`README.md`, `src/records.ts`, `src/router.ts`, `tests/records-export.test.ts` (new). A's commit and
tree `aa4af8c4…` are unchanged. Patch: `candidate-b.patch`; bundle with A and B:
`../artifacts/record-api-B.bundle`.

**What was implemented, and only from the frozen contract.** `GET /records.csv` applies the listing's
`status`/`nameContains` filter set (the requirement note defines "the same filtered records" as "the
same filter set the listing supports") over the whole filtered set, emits the
`id,name,status,createdAt` header, escapes every field through `toCsvRow` (the existing helper, not a
reimplementation), formats every timestamp through `toUtcIsoString`, returns
`text/csv; charset=utf-8` with status 200, returns the header alone for an empty result, and reuses
`parseListQuery` so unusable filters keep the listing's 400 shape.

**Independently verified, not inferred from green tests** (`candidate-b-route-evidence.json`):

| Assertion | Result |
| --- | --- |
| A: `/records.csv` absent | `404` |
| B: `/records.csv` present | `200`, `text/csv; charset=utf-8` |
| Header row | `id,name,status,createdAt` |
| Filtered export rows equal the listing's filtered ids | `["rec-3","rec-4"]` both |
| Escaping | `rec-5,"Access review, follow-up"`; `rec-6,"Audit ""export"" sample"` |
| UTC formatting | `2026-02-03T02:05:06.000Z`, `2026-02-06T14:59:59.000Z` |
| Empty result | header only |
| Unusable filter | `400`, `field: "status"` |
| R2 unchanged | listing tests still pass, UTC assertions unchanged |

Ordinary checks: **30/30 pass** (`npm test`, exit 0; 21 previous + 9 new). Proxy/limit audit:
**20/20 pass**.

**Information the implementer needed:** the original report (to know what was missing), the frozen
requirements (to bound the columns/filters/formats), and source inspection of `src/csv.ts`,
`src/format.ts`, `src/store.ts` and the existing tests (conventions). No human explanation was
required for R3: the initial finding named the route-level gap and the correction precisely. One
assumption had to be made and is recorded: the requirement does not name the route or decide whether
the export paginates; `GET /records.csv` over the whole filtered set was chosen and documented.

---

## 6. Cost model, corrected and re-priced

Provider prices verified against the public model listing (2026-11-22):

| Category | USD / 1M tokens |
| --- | --- |
| prompt (uncached) | 1.00 |
| completion | 5.00 |
| cache read | 0.05 |
| cache write | 1.25 |
| **override at ≥272,000 prompt tokens** | 2.00 prompt / 7.50 completion / 0.10 read / 2.50 write |

The override cannot trigger: the request byte ceiling proves ≤65,536 tokens per request and the stage
cap is 180,000, both below 272,000.

The initial plan priced input at the cache-blind 1.00/M, understating a cache-write-heavy request by
25%. Corrected, conservative reservation:

| Quantity | Value |
| --- | --- |
| per-request reservation (65,536 in + 4,000 out) | **USD 0.10192** |
| OCR stage caps 180,000 / 24,000 | **USD 0.345** |
| criteria stage 20,000 / 4,000 | **USD 0.045** |
| two OCR stages + criteria | **USD 0.735** |
| remaining before this phase | USD 0.90914545 → **fits, USD 0.17414545 left** |

The engine's own 400,000-token budget is a second, looser guard; the proxy's token reservation is the
enforcing boundary and it reserves the full per-request ceiling before forwarding. Deterministic
model-free regression tests for these numbers replaced the stale `200_000`-token plan test
(`synthetic/tooling/proxy-audit.test.mjs`, 20/20). The provider-side key limit remains **USD 5.00**;
the USD 1.00 ceiling is enforced by the proxy, not by OpenRouter.

---

## 7. The recheck — blocked at access, not at budget

`OPENROUTER_API_KEY` is absent from the process environment, the user environment, the machine
environment and the shared terminal; `OPENROUTER_BASE_URL` likewise. No credential file exists in
the project. Nothing was dispatched, so no recheck observation exists.

Consequence: the corrected-wiring OCR runs on A and B and the criteria recheck on B are **prepared,
priced, and unexecuted**. `RUNBOOK-unblock-recheck.md` holds the exact commands; `prepare.mjs` has
already verified the corrected rule digest, the byte-identical A background, the managed config
digest and the budget admission, and the corrected rule document has been proven to deliver its text
(§2.4).

Optional diagnostic cases (Disconnected behavior, Insufficient evidence) were **not run**: the brief
makes the A→B cycle a precondition, and no test was designed to consume budget ahead of it.

---

## 8. Evidence assembly — what the initial result actually depended on

| Question | Initial Criteria Assessment (A) | Ordinary OCR (A) |
| --- | --- | --- |
| Files included | all changed files plus `src/csv.ts`, `src/format.ts`, `src/store.ts`, `package.json` | repository content via its own context tools (14 `file_read`, 2 `code_search`, 1 `file_find`) |
| Who selected them | the harness, from the frozen reviewer-input contract | the model, at runtime |
| Did the selector know the defect | yes — the frozen profile pre-listed the helpers R2/R3 name | no |
| Check results included | no | no |
| Retrieval available to the model | none: the Gateway SDK `/llm` call does not retrieve or execute | yes |
| Manual preparation effort | assembling the frozen bundle, once per stage | artifact provenance, harness, bounds |
| Model asked for missing context | no | yes, through tools |

So the criteria path's correct `R3 violated` depended on a human knowing to include the helpers; the
model could not have discovered the service route surface on its own. That limitation is central to
the recommendation: correctness of a verdict is only as trustworthy as the mechanical completeness of
its evidence bundle.

---

## 9. Product comparison

| | Ordinary OCR alone | Independent Criteria Assessment | OCR + checks + assisted assessment | Evidence-collection/check improvements |
| --- | --- | --- | --- | --- |
| Tested | yes (A, policy-ineffective) | yes (A) | **no** — not executed | **no** — not executed |
| Correct violation detection | yes (R3, high, with correction) | yes (R3 `violated`, with correction) | — | — |
| Incorrect `satisfied` verdicts | n/a (no verdicts) | 0 on R1/R2 | — | — |
| Unsupported objections | 1 (`records.ts:46`) | 0 | — | — |
| Requirement-material precision | 1 of 4 visible comments | 1 of 1 verdict correct | — | — |
| Missing-evidence handling | not applicable | schema supports `inconclusive`; unused here | — | — |
| Execution failures | 1 refusal (47,334 B > 40,960) then success | none | — | — |
| Context assembly effort | none per run; one-time harness | manual bundle, once | — | — |
| Human review effort | triage 4 comments (2 test-quality, 1 unsupported) | read 3 verdicts | — | — |
| Runtime | 58 s, 10 requests | 10.7 s, 1 request | — | — |
| Paid cost | USD 0.085926 modelled / share of 0.09085455 authoritative | USD 0.00827925 | reserved USD 0.345 + 0.045 | — |
| Reproducibility limits | one fixture, one candidate, policy not delivered | one fixture, manually assembled evidence | — | — |

The unexecuted columns are the honest gap: whether either path tracks a *correction* is not measured.

---

## 10. Recommendation

**Where requirement verification produces a useful, trustworthy action.** At the point where a pull
request claims to satisfy a named requirement and the reviewer must answer "yes / no / cannot tell,
with evidence". On this fixture both paths found the one material gap, but only the criteria path
produced that answer directly; the OCR path produced four comments that a human must triage into
that answer, half of them unrelated to any requirement.

**Smallest implementation that delivers the value — direction B, with C as its first component:**

1. **Mechanical evidence bundle (C).** From the candidate diff, deterministically include every
   changed file, every file the requirement text names by path or symbol, and the ordinary check
   output. No human choice, no "remember to add the helper".
2. **One bounded criteria call (B).** The existing Gateway SDK `/llm` path, fixed instructions, the
   existing three-value schema, one request, pre-dispatch token reservation. Measured USD 0.008 and
   ~11 s.
3. **Render the verdict as a check result.** Per-requirement status, evidence references and either a
   correction or the missing evidence — the artifact the reviewer acts on.

Do not build a per-requirement engine inside OCR: its managed mode rejects `--analysis`, its output
contract deliberately refuses a semantic schema, and its strength (tool-using investigation with an
observation ledger) is better used later as the evidence engine behind a separate verdict contract.

**Trust failure modes to design against:** a mechanically incomplete bundle producing a confident
wrong `satisfied` (the dominant risk, and the reason step 1 is not optional); treating absence from
the diff as absence of capability; and reusing a stale verdict after the candidate changes.

**Evidence that would change this recommendation:** if the blocked recheck shows the criteria path
marking R3 `violated` on corrected code, or inventing a new objection on the helpers, then
verdict-level trust is not established and the recommendation moves to direction C alone
(evidence/check contracts first). If OCR stops reporting R3 while criteria still reports it, that is
evidence OCR tracks corrections better than its comment-level precision suggested.

Until that run exists, this recommendation is **provisional**: one fixture, one candidate pair, one
path with policy-ineffective delivery, and no correction-tracking measurement.

---

## 11. Limitations

1. The A→B recheck did not run: no credential. Everything about correction-tracking is unmeasured.
2. The initial OCR observation is not policy-controlled (§2); it must not be cited as evidence that
   the managed rules improve precision.
3. One fixture, one candidate pair. No accuracy, precision or recall figure is claimed, and the
   synthetic variants are correlated, not independent samples.
4. No deployed Gateway service; the SDK's control plane was supplied locally, as recorded originally.
5. The consumer reconstruction covers the pinned modules only, not ReviewRouter's full product policy.
6. The Behavior/Impact evaluation is source inspection; it was not executed and `--analysis` was not
   enabled.
7. The upstream managed qualification harness does not assert rule delivery; that gap is reported, not
   fixed (fixing it would modify the qualified consumer).
