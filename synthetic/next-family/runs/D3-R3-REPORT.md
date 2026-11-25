# D3-R3 — adjudication, qualified OCR recovery, conditional recheck and closeout

**Verdict: `D3_PARTIAL — EVIDENCE_OR_BUDGET_LIMIT_RECORDED`**

D3 closes with its product decision supported by reproduced evidence and one named evidence limit: the
ordinary-OCR comparator was recovered and verified but cannot complete inside the frozen OCR caps or the
remaining authorization, so the OCR column of the comparison stays empty rather than passing.

| | |
| --- | --- |
| Branch | `exp/synthetic-live-pilot-01` (research only; nothing pushed to a production repository) |
| Baseline at start | `9367ce4e7dee40d076f654397fd535a09e2d6c3a`, = `origin`, clean |
| M2 PR #2 | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, clean, untouched |
| Task family | `delivery-req-v2`, sha256 `ff243a43a8a7…` — unchanged |
| Adjudication | `synthetic/next-family/adjudication/ADJUDICATION.md` |
| Original D3-R2 report | `synthetic/next-family/runs/D3-R2-REPORT.md` (unmodified) |
| D3-R3 evidence commit | `498d724b4a66e7123017901aa6aac424fc02e1eb` (pushed `9367ce4..498d724`) |
| Reader | Iliya |

---

## 1. Baseline verified before anything changed

| Check | Result |
| --- | --- |
| Research HEAD full SHA | `9367ce4e7dee40d076f654397fd535a09e2d6c3a`, ancestor of and equal to `origin/exp/synthetic-live-pilot-01` |
| Working tree | clean at start |
| Original report / index digests | `a48b0afe5ce6…` / `b06decb06d23…`, reproduced before and after this pass |
| Frozen candidates | c01 `54623dcc…`, c02 `65f21038…`, c03 `18bbde35…` present, `family.json` heads unchanged |
| Frozen requirements | `delivery-req-v2` sha256 `ff243a43a8a7…` unchanged; the packet rule unchanged |
| Ledgers | `runs/attempts/index.jsonl` append-only; three settled reservations at start |
| M2 PR #2 | `996cdcb002f8…`, clean |
| Handoff document | `engineering-research` `2af993cd…`, section *D3-R2 decision checkpoint and structured-output reuse* read in full |

Nothing was corrected before the adjudication, and no candidate was modified.

## 2. Adjudication (model-free) — the substantive result

Full field-by-field record: `synthetic/next-family/adjudication/ADJUDICATION.md`. Reproductions:
`synthetic/next-family/adjudication/reproduce.mjs`,
`synthetic/next-family/adjudication/policy-variants.mjs`; receipts in the same directory.

| Class | Count | Claims |
| --- | --- | --- |
| `CONFIRMED_REQUIRED_VIOLATION` | 8 criterion rows (5 mechanisms) | c02.C1; C2 and C4 on c01, c02, c03 from one terminal re-entry mechanism |
| `SUPPORTED_SATISFACTION` | 5 | c01.C5, c02.C3, c02.C5, c03.C3, c03.C5 |
| `AMBIGUOUS_REQUIREMENT` | 3 | c01.C1, c03.C1 (header casing / empty key); c01.C3 (empty-string `subscriptionId` ordering) |
| `INSUFFICIENT_EVIDENCE` | 1 | c03.C2 clauses (a) transient classification and (d) growing delay — delegated to the external package |
| `OPTIONAL_REVIEW_OBSERVATION` | 3 | null-body `TypeError`; concurrent double-invocation lost update; empty-key normalisation |
| `UNSUPPORTED_MODEL_CLAIM` | 0 | — |

### 2A. c02.C1 — confirmed

`src/router.ts` indexes duplicates by `sha256(payload)` and never reads the headers. Reproduced: the same
key with two different payloads creates **two** deliveries (requirement: one), and two identical
**keyless** submissions collapse to **one** (requirement: two). The suite is 16/16 because it repeats
*the same payload*, which the fingerprint satisfies — it encodes the wrong collapse and omits the keyless
case. Preserved as a defect; c02 was not modified.

### 2B. C2/C4 terminal re-entry — confirmed on all three, one mechanism, two criterion hits

`attemptDelivery` checks only `attempts < MAX_ATTEMPTS`; it never checks the delivery state or the
subscription status. Reproduced on every frozen candidate:

- `400` once, then two more invocations → target called `[1,1,1]`, state `failed`, attempts `1,2,3`.
- `410` once, then two more invocations → target called `[1,1,1]`, subscription `disabled`.
- `pending()` after a terminal failure returns the failed delivery; it also returns delivered ones.
- A queued delivery for a **disabled** subscription is contacted and delivered.

Required distinctions:

1. **Demonstrated sequential re-entry defect** — yes. The provided worker entry point contacts the target
   again for a delivery that already failed non-transiently or was failed by a `410`.
2. **Hypothetical production scheduling** — not established, not claimed. The fixture has no scheduler.
3. **Separate concurrent-execution race** — reproduced separately (two parallel calls, two target calls,
   both writing `attempts:2`). Different mechanism, needs an authored concurrency obligation, not counted.
4. **Multiple criterion violations from one root cause** — yes: one defect, C2 + C4 per candidate. Counted
   as one mechanism and two criterion hits, never as two discoveries.

The derivative `0d85551a83cb` returns `[1,0,0]` on the identical reproductions, so the counterexample is
specific to the missing guard.

### 2C. c03.C2 — `violated` was justified

Of C2's four clauses, clause (b) "not retried for any other `4xx`" is demonstrably violated by re-entry;
(c) the three-attempt cap holds in the checkout; (a) classification and (d) delay are delegated to
`@fixture/delivery-core`, which is outside the checkout and outside the packet. One demonstrated
mandatory violation therefore justified the aggregate `violated` status while two clauses stayed unknown.

**This corrects D3-R2.** The earlier report said c03.C2 "should be `inconclusive`". That was wrong: it
asked for abstention without showing that no mandatory clause was violated. The unresolved
classification/delay evidence stays recorded separately and is the only genuinely uncertain control in
this family.

### 2D/2E. C1 header casing and C3 validation order — ambiguity, not defect

`Request.headers` is `Record<string, string | undefined>` and `TASK.md` puts transport out of scope, so no
case-insensitive guarantee is authored. Reproduced: only the exact lowercase non-empty key is honoured, so
`Idempotency-Key`/`IDEMPOTENCY-KEY`/`""`/`undefined` each create a second delivery on c01 and c03.
Empty-key validity is never defined. Classified `AMBIGUOUS_REQUIREMENT`; making it mandatory needs an
owner decision, which this pass did not invent.

The three intake implementations are byte-identical on the C3 path: `""` + oversized → `400` on c01, c02
and c03 alike. The original assessment gave c01 `violated` and c02/c03 `satisfied`. That is an internal
inconsistency of the assessment, not a code difference; the strict reading the c01 reply states ("a
present string") is defensible and would have made all three `violated`. The requirement does not define
the valid-submission domain for `subscriptionId`, so the criterion remains ambiguous.

### 2F. Outside the mandatory contract

Null JSON body throws `TypeError` instead of `400` on all three; concurrent invocations produce a lost
update; empty-key handling and defensive coding are advisories. None is promoted to a completion gate.

## 3. Corrected ground truth for the c01 "complete" control

This is the most consequential finding of the pass.

| c01 | D3-R2 read it as | Adjudicated |
| --- | --- | --- |
| C1 | conflicts with receipts | ambiguous (receipts never test a non-lowercase or empty key) |
| C2 | unsupported accusation | **confirmed violation** (re-entry after `400`) |
| C3 | unsupported accusation | ambiguous (defensible strict reading) |
| C4 | conflicts with receipts | **confirmed violation** (re-entry after `410`) |
| C5 | supported | supported |

The c01 suite passes 17/17 because it calls the worker once. A narrower passing test was treated as
disproof of a counterexample.

Implications:

1. **The family has no valid complete control.** `evaluator/ORACLE.json`'s c01 row is wrong on C2 and C4.
   The oracle was never proof that a fixture was complete.
2. **The original 10 `violated` verdicts are not 10 errors.** Seven are confirmed violations, three rest
   on a real requirement ambiguity, none is fabricated.
3. **`inconclusive` was not "missing".** Every D3-R2 criterion had either a contradiction or a supported
   satisfaction, so the status was correctly unused. The assessor's abstention works when nothing
   contradicts — demonstrated by the recheck in §6.
4. **The "noise level" question posed to Iliya at D3-R2 was the wrong question.** The right one is which
   verdicts survive model-free adjudication, and by that measure the batch was largely correct.

## 4. Qualified OCR comparator recovered

| Item | Value |
| --- | --- |
| Repository / run / artifact | `agent-teams-ai/open-code-review` / `44924052949` / `14714439075` (`managed-ocr-8a70944f…`) |
| Source commit | `8a70944f567beba9ffc12d1153e33ef5fd60967d` |
| Version / platform | `1.14.0-rr.1` / linux/amd64 |
| Binary | `opencodereview-linux-amd64`, **87,356,967 bytes** |
| SHA-256 | `443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399` — **matches the authorized digest** |
| Artifact status | not expired (expires 2026-12-21); retrieved and hashed, sidecar and `MANIFEST` agree |
| Execution | `docker --platform linux/amd64`, `open-code-review 1.14.0-rr.1 linux/amd64` |
| Qualification receipt | `qualification.json` in the same artifact: 4/4 cases passed, `model_free: true` |

Recorded in `synthetic/next-family/runs/d3-r3/ocr/artifact-verification.json`. Nothing was rebuilt and
rr.7 was not substituted. The binary is not committed (87 MB); the digest and provenance are.

## 5. OCR policy, consumer semantics and request-width preflight

Prepared: `synthetic/next-family/runners/prepare-ocr.mjs` → `synthetic/next-family/runs/d3-r3/ocr/`
(`rule-c02.json`, `background-c02.txt`, `home/.opencodereview/config.json`, `preparation.json`).

- Managed policy wording byte-identical to the frozen rr.1 policy (`32c49219ac90…`, 387 B); only the
  container shape is the corrected `reviewrouter_managed_paths` + `{path, rule, merge_system_rule,
  reviewrouter_exact_path}` envelope.
- Assigned inventory: c02's seven changed paths between base `c65bc83…` and head `65f21038…`.
- Background file: `TASK.md` verbatim (sha256 equals the frozen task digest). No evaluator material, no
  criteria-assessor findings, no adjudication text.
- Reviewer settings, model, effort, filtering and binary are the qualified ones.

**Measured shape (model-free, proxy `--offline`, no spend).** 12 forwarded requests:

| request | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bytes | 1,641 | 19,766 | 23,056 | 21,415 | 22,976 | 22,363 | 19,627 | 22,917 | 19,968 | 23,258 | 19,787 | 23,077 |

Receipt: `synthetic/next-family/runs/d3-r3/ocr/stage-summary-ocr-c02-offline.json`.

**The frozen cap cannot admit the comparator.** Every substantive request is 19,627–23,258 bytes against
the frozen 15,936-byte per-request limit — a factor of 1.23–1.46 too wide, before any tool-result growth.
Only the 1,641-byte preamble fits. The 12 observed requests also exceed the frozen 8-forwarded-request
cap. Honest limitation: the offline fake emits no tool calls, so this measurement is a **lower bound**,
not a tool-loop measurement; growth can only add bytes.

**Why the cap was not quietly widened.** Admissible minimum is 23,258 B (24,576 B to be safe), i.e. 24,640
input tokens per request. At the retry-free structural minimum of 8 requests (1 preamble + 7 file groups)
the worst case is 8 × (24,640 × 1.25/M + 1,500 × 5/M) = **USD 0.3064**, which would fit the remaining
authorization. At the 12 requests actually observed it is **USD 0.4596**, which does not. The historical
qualified live run reached 62,517 B per request and 10 requests (≈ USD 0.078 per request, ≈ USD 0.63 for
eight), also outside the remaining authorization. A completed run therefore cannot be *proven* safe — the
tool-loop growth is unmeasured — and widening a frozen per-request limit without approval would silently
change the comparator's policy, which the brief forbids.

**OCR stage outcome: `BLOCKED` — frozen 15,936-byte per-request cap and 8-request cap both below the
measured c02 shape; a lifted cap cannot be bounded within the remaining authorization.** Recorded as
**incomplete**, explicitly not as an empty finding set. Native findings, post-filter findings, normalized
comments and publication-eligible comments are therefore all unobserved for c02, and the deployed
publication path was not executed (it never was; the retained D1/D2 reconstruction remains the only
source-level evidence, and is not upgraded to a deployed observation).

## 6. Conditional single recheck

**Derivative.** `0d85551a83cbd87d3664a9de17b9c01990bacaf3` (`candidate-c03r`), parent c03, `+7` lines in
`src/delivery.ts`: `attemptDelivery` returns before contacting the target when the delivery is not
`queued` or the subscription is `disabled`. Manifest `synthetic/next-family/derivatives/c03r.json`;
expectations frozen before dispatch in `synthetic/next-family/derivatives/EXPECTED-c03r.json`. Nothing
removed, no requirement text changed, no production hardening, external policy untouched.

**Genuine uncertainty proven model-free**
(`synthetic/next-family/adjudication/reproductions/c03r-policy-variants.json`). Same
tree, same reviewer-visible packet, two legitimate external policies:

| Policy | 429 response | 400 | 500 | delay growth |
| --- | --- | --- | --- | --- |
| `conforming-5xx-only` | **1 call**, final — C2 satisfied | 1 call | 3 calls | 100/200 ms |
| `transient-429-included` | **3 calls**, failed — C2 violated | 1 call | 3 calls | 250/500 ms |

The packet cannot distinguish them: the policy is a dynamic import of a workspace sibling that is not in
the checkout. After the guard, no known mandatory contradiction remains. The recheck is therefore useful
and qualified; it was not spent to fish for an `inconclusive`.

**Dispatch (one request, no retry).** Attempt `att-c03r-criteria-recheck-20261125T185400406Z-3b7c21`,
profile digest `2a7532d7c604…` (unchanged), body 26,773 B ≤ 28,672, packet 24,078 B
`21938fd20764…`, model `openai/gpt-6.1-terra`, effort `medium`, tier `default`, provider observed `null`,
one forwarded request, zero refusals, 35 s, 6,045 input / 2,127 output (1,204 reasoning) tokens.

| Criterion | Result | Expected |
| --- | --- | --- |
| C1 | violated (header casing / empty key) | satisfied, ambiguity noted |
| C2 | **inconclusive** — names the external policy source or a retry receipt | inconclusive |
| C3 | satisfied (null-body remark inside the explanation) | satisfied |
| C4 | **satisfied** — cites "disabled-subscription entry guard" | satisfied |
| C5 | satisfied | satisfied |

Two flips are the real signal: on the identical criterion the verdict moved `violated → inconclusive` for
C2 and `violated → satisfied` for C4 **because the contradiction was removed and nothing else changed**.
C1 stayed `violated` across c03 and c03r because that code did not change. That is source-responsive
behaviour, not boilerplate.

C1 remains the ambiguity of §2D: under the frozen text it is not decidable, and the reply does not claim
a normalisation contract the interface declares.

The original frozen schema has one status and one correction string per criterion. It cannot express
"clause (b) violated, clause (a) unknown" independently; c03's D3-R2 reply carries both inside one status
and one correction. That limitation is recorded, not worked around, and the wire schema was **not**
changed for this recheck.

## 7. Accounting — settled, conservative and unverified kept apart

| Line | USD |
| --- | --- |
| Approved aggregate ceiling | 1.00000000 |
| Retained historical settled | 0.31639530 |
| Retained historical conservative envelope (committed basis, `max` — never summed with settled) | 0.55929000 |
| D3-R2 settled: c01 0.01974500 + c02 0.01806375 + c03 0.01774375 | 0.05555250 |
| D3-R3 settled: recheck | 0.01819125 |
| **New settled total (4 attempts)** | **0.07374375** |
| Active reservations / unresolved attempts | 0.00000000 / 0.00000000 |
| **Aggregate worst case** | **0.63303375** |
| **Remaining authorization** | **0.36696625** |

- The conservative ledger charge and an exact provider bill are **not** the same quantity. Each attempt's
  charge is reported usage at the worst-case rates (1.25/M input, 5/M output); no provider-reported cost
  field is retained, and the provider account was not read — reading it would require credentialed egress
  outside the bounded proxy, which D3-R2 removed deliberately.
- The maintainer's ~USD 0.05555025 for the three D3-R2 replies differs from the ledger's 0.05555250 by
  USD 0.00000225 (0.004 %). The difference is not explained by any retained artifact: there is no
  provider cost field and no account-level settlement record. It is recorded as an open reconciliation
  item, not smoothed away, and the larger ledger figure is the one carried.
- The correction reserve is now spent (it was this recheck); no reserve is double counted.
- USD 0.69415395 was never treated as an allowance, and the provider key's own limit is not authorization.

## 8. Product comparison at the same candidate and decision point

| | A. Ordinary checks | B. Criteria Assessment | C. Narrow combined presentation |
| --- | --- | --- | --- |
| Confirmed defects found | **0** on c01, c02, c03 | **7** (c02.C1; C2+C4 re-entry on all three) | 7, if the check receipts are shown beside the assessment |
| Supported completion | C3 boundaries, C4 intake, C5, 4/5 of C2, C1 on c01/c03 | 5 criteria, all corroborated | same |
| Missing-evidence behaviour | silent — a green suite cannot say "not covered" | c03.C2 `violated` (correct, clause b) then `inconclusive` after the fix | assessor's named gap is the usable part |
| Unsupported corrections | n/a | 3 criteria rest on an unstated acceptance condition (ambiguity, not fabrication) | must be labelled ambiguous, not asserted |
| Duplicate feedback | none | repeats the check coverage on C3/C5 verbatim | dedup is deterministic by identity only |
| Real scope of the checks | positive cases only; never calls the worker twice; c02's suite encodes the wrong collapse | reads all 13 files; no receipts | — |
| Manual preparation | none | 13-file rule, automatic; **~2 h expert** for this adjudication and the reproductions, which the assessment did not have | plus the same |
| Additional source investigation | none | 0 extra reads (Strategy A packet) | — |
| Model execution time | — | 38.0 s / 34.8 s / 33.6 s / 35.0 s | — |
| Inference requests | 0 | 4 total (3 + 1 recheck) | 4 |
| Costs | 0 | 0.07374375 settled, 0.63303375 aggregate worst case | same |
| What Iliya can decide | "the suite is green" — which was **wrong** for all three | which requirements to correct, and which evidence to request | both, with the ambiguity kept visible |

**Failed or incomplete executions:** OCR (blocked, §5). No failed inference attempt; no retry; no refusal.

**Duplicate feedback:** the assessor's C3/C5 findings restate what the suites already establish, and the
c02.C1 finding is invisible to those suites. Deduplicating passages is deterministic; grouping two
statements as one defect needs justified equivalence, which this pass did not assume.

**Do not over-read this.** Three synthetic candidates and one recheck cannot establish that the assessor
is generally superior to OCR; the OCR comparator never produced a finding here. JSON validity and
resolving source references are not factual correctness — c01.C1 and c01.C3 cite real lines and still
rest on an acceptance condition nobody authored.

### Structured output: five categories, kept apart

| Category | What it is | D3-R3 example |
| --- | --- | --- |
| Structural JSON validity | the frozen schema and parser accepted the reply | all five replies |
| Evidence-reference validity | cited path/symbol resolves at the frozen commit | all references resolve |
| Semantic evidence support | the cited material actually establishes the stated property | c02.C1 yes; c01.C1/C3 no (unstated condition) |
| Applicability and admission | whether the finding applies to this candidate and may act | re-entry applies to all three; concurrency is out of scope |
| Human-selected action | what Iliya chooses to correct or ask for | not automated |

Possible reuse without implementing it now: the existing Account Gateway `prepareStrictJsonSchema` +
`LlmTask.decode` pair already covers authoring/decoding (Zod 4 is already a Gateway dependency), and the
M2 result contract already separates facts from applicability. A future consumer would need a reviewed
clause decomposition of each authored requirement and a small deterministic conjunctive reducer —
`violated` on one demonstrated contradiction, `satisfied` only when every clause is supported, else
`inconclusive` — with missing/invalid execution kept outside the semantic verdict. No library, dependency,
second client, repair loop, schema change or new package was added in D3.

## 9. Recommendation — exactly one next step

**1. Continue with a narrowly scoped, optional advisory Criteria Assessment, restricted to gap detection
on authored requirements, and never as a completion gate.**

Reason: on this family it found a real, reproduced defect that the ordinary suites could not see, that the
frozen oracle had declared absent, and that the D3-R2 batch had been read as noise. Its one genuine
abstention appeared exactly when the contradiction was removed. That is the narrow benefit the
maintainer's decision rule asks for, and it is a gap-detection benefit, not positive-completion
qualification: c01 shows a "complete" label can be wrong in both the oracle and the model's favourable
readings.

Alternatives, supported but not recommended as the next step:

- **2. Reuse ordinary check evidence plus one targeted regression test per confirmed defect.** Cheap and
  deterministic, but it only exists after the defect is known — it cannot find the next one.
- **3. Stop on the missing OCR comparator capability.** Honest only if the marginal value over OCR is the
  decision; it cannot be measured until a complete qualified OCR run is possible, which needs either a
  wider authorized per-request limit or a smaller review envelope.

A genuine team task remains a **separately scoped** follow-up. It is justified by this evidence — ordinary
preparation, no defect-aware packet — but it is not started here.

## 10. Verification

`node synthetic/next-family/checks/verify-d3r3.mjs` — PASS/PARTIAL per gate, no gate claimed on an
assumption:

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Original D3-R2 report and index unmodified | PASS | digests reproduced; `runs/attempts` clean vs `9367ce4` |
| 2 | Frozen candidates unchanged | PASS | three commits present, `family.json` heads identical |
| 3 | Derivative has a new immutable identity | PASS | `0d85551a…` parent `18bbde35…`, packet digest frozen |
| 4 | OCR artifact matches the authorized binary | PASS | `443d7777…`, 87,356,967 B, re-hashed locally |
| 5 | Rules and filtering unchanged | PASS | policy `32c49219…` byte-identical, 7 assigned paths |
| 6 | Inference ledgers append-only | PASS | 4 attempts, no deleted record |
| 7 | No budget violation | PASS | 0.63303375 ≤ 1.00 |
| 8 | No uncontrolled retry | PASS | one forwarded request and one body per attempt, zero refusals |
| 9 | No model/profile substitution | PASS | profile `2a7532d7…`, model/tier/effort fixed; provider `null` recorded, not claimed |
| 10 | No evaluator material in reviewer inputs | PASS | 4 packets + rule + background clean |
| 11 | Historical A/B/C research intact | PASS | `synthetic/runs` clean vs `9367ce4` |
| 12 | M2 PR #2 untouched | PASS | clean at `996cdcb002f8` |
| 13 | Published evidence references resolve | PASS | every repository-relative reference in this report exists |
| 14 | Repository clean after publication | PASS | committed and pushed; see §11 |

`node synthetic/next-family/checks/verify-gates.mjs` still reports **10/12** with gates 8 and 9 failing:
both are *pre-dispatch* assertions (`duplicate === null`, `newSpend === 0`) that are false by design once
any batch has settled. Their post-batch equivalents are gates 8 and 7 above. No assertion was relaxed.

Model-free tests: 52 passing, 0 failing, 0 skipped, unchanged.

## 11. Durable evidence, publication and remaining uncertainty

Added by this pass (all in the research repository, branch `exp/synthetic-live-pilot-01`):

- `synthetic/next-family/adjudication/ADJUDICATION.md` and `reproduce.mjs` / `policy-variants.mjs` with
  `reproductions/*.json`
- `synthetic/next-family/derivatives/c03r.json`, `EXPECTED-c03r.json`, `packets/packet-0d85551a83cb.*`
- `synthetic/next-family/runners/prepare-ocr.mjs`, `runs/d3-r3/ocr/*` (rules, background, ledger, stage
  summaries, `artifact-verification.json`)
- `synthetic/next-family/runs/attempts/att-c03r-criteria-recheck-20261125T185400406Z-3b7c21` (raw reply written before parsing)
- `synthetic/next-family/checks/verify-d3r3.mjs`, this report, `D3-R3-INDEX.json`
- `synthetic/next-family/artifacts/notification-delivery-c03r.bundle` — the derivative commit and the
  revised c03 it descends from, so the frozen identity is retrievable from the published tree (the
  fixture checkout itself is ignored); `git bundle verify` reports a complete history

Not committed: the 87 MB OCR binary, the temporary c02 checkout, the temporary derivative clone.
No credential, no account identifier and no secret is in any added file (secret scan before publish).

**Most consequential remaining uncertainty.** Whether ordinary OCR would find c02's C1 defect, and the
terminal re-entry defect, on its own. The comparator is now recovered and verified but its request shape
(19.6–23.3 KB, 12 requests observed) exceeds the frozen 15,936-byte and 8-request caps, and the widened
cap cannot be bounded inside the remaining USD 0.36696625 once tool-loop growth is admitted. Until a
complete qualified OCR run is possible, the assessor's marginal value over ordinary OCR remains unmeasured
— and the recommendation above is a gap-detection recommendation, not an OCR-superiority claim.

## 12. What D3 does not claim

- No upstream-provider pinning: every reply reported `provider: null`.
- No production scheduling was demonstrated for the re-entry defect; only the entry point's behaviour.
- No deployed Gateway integration, no consumer publication, no merge, no Work authority.
- No generally superior assessor: one synthetic family, three candidates, one development recheck.
- No requirement amendment: the three ambiguities await an owner decision.
- No correction of c02 and no modification of c03.

## 13. Status for Iliya

> D3 closes `D3_PARTIAL — EVIDENCE_OR_BUDGET_LIMIT_RECORDED`. The adjudication reverses the D3-R2 reading:
> the "complete" control was not complete. `attemptDelivery` in all three candidates re-contacts the
> target after a terminal `400`/`410` (reproduced, `[1,1,1]`), so seven of the ten `violated` verdicts are
> confirmed defects and three rest on an ambiguity nobody authored; the oracle's c01 row is wrong, not the
> model. c02's idempotency defect is confirmed. The qualified `1.14.0-rr.1` comparator was recovered and
> verified at `443d7777…`, but its real c02 requests are 19.6–23.3 KB against a frozen 15,936-byte cap, so
> OCR is recorded incomplete rather than empty. The one authorized recheck on the fixed c03 derivative
> returned `inconclusive` for the genuinely unresolved criterion and flipped C4 to satisfied once the
> contradiction was gone — the abstention works. Spend: USD 0.07374375 new, USD 0.63303375 aggregate,
> USD 0.36696625 left. Recommendation: keep the assessment as a narrow optional gap detector, never as a
> completion gate. Your call on that, and on the three owner ambiguities in the adjudication.
