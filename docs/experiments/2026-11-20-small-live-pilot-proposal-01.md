# Small live pilot proposal 01 — criteria assessment against configured OCR and checks (2026-11-20)

| Field | Value |
| --- | --- |
| Proposal id | `exp-pilot-2026-11-20-01` |
| Status | **PROPOSED — NOT AUTHORIZED, NOT EXECUTED** |
| Authority | Requires explicit maintainer approval **and** D1 (live inference) **and** D2 (budget) authorizations. None has been granted. |
| Supersedes | Nothing. Amendment v02 (`2026-11-17-m2-experiment-amendment-02.md`) remains the case-card record; this is a separate planning deliverable. |
| Scope | One real task, one advisory report, one human decision, one recheck. |
| Live calls in this task | **Zero.** Preparing this document made no provider/model/OCR call, loaded no credential, spent nothing and deployed nothing. |

This document is a request for approval, not a record of work. Nothing in it authorizes execution, and
reading it as approval would be a misreading. Its job is to be specific enough that the maintainer can
say yes or no to a bounded spend without further design work.

## 1. The question

For **one** real review task, does an additional criteria assessment produce a next action that the
configured OCR rule set and ordinary checks did not already produce, at a preparation and triage cost
that is acceptable for one reader decision?

This is deliberately narrower than "does the product work". It cannot answer whether the product is
valuable in general, whether a model reasons well, or whether either profile is better.

## 2. Case selection

### 2.1 Result of the selection attempt

**No eligible real case exists in the material available to this task.** The proposal therefore states
the exact missing inputs rather than inventing a task. Executing without them would produce an
unfalsifiable report, which is the failure mode amendment v02 §6 exists to prevent.

No case has been selected. **No repository, PR, snapshot, OCR output or check result has been identified
for this pilot**, and none is implied anywhere below. The six items are the inputs a selected case would
have to provide, and each one has a named supplier.

| # | Missing input (required before any live call) | Who must supply it | Why it cannot be substituted |
| --- | --- | --- | --- |
| M1 | Repository plus PR/task URL | Maintainer (repository owner with review authority) | The reader's decision is about a real change; a synthetic task has no reader. |
| M2 | Immutable **pre-review** base SHA and head SHA | Maintainer supplies the SHAs; the pilot operator freezes and records them | A post-fix head is a known answer. The snapshot must predate the review being evaluated. |
| M3 | Original task/requirement source (issue, plan section or commit message) at a citable identity | Maintainer, or the author of the linked issue/plan the change claims to satisfy | Criteria must be derived from what was required, not from what was eventually built. |
| M4 | Review-time configured OCR rules and their native findings for that snapshot | Maintainer together with whoever owned the OCR configuration at review time | This is the comparator. Re-deriving it later with different rules measures a different configuration. |
| M5 | Ordinary check results available at review time (baseline observations, deterministic gate outcomes) | Maintainer together with the CI/check owner for that snapshot | Needed to decide whether the criteria pass added anything beyond checks that already existed. |
| M6 | Named intended report reader and the decision they own | Maintainer names the reader; the reader accepts and records the decision | Value is defined by a decision changing. Without a reader there is no decision to inform. |

**Execution is blocked until all six are supplied and frozen.** M1 fixes the case, M2 fixes the snapshot,
M3 fixes the criteria source, M4 and M5 fix the comparator, and M6 fixes who decides. If the maintainer
supplies M1–M6, this proposal can be executed without redesign: the limits, trace and measurements below
are already fixed. If any of M1–M6 stays unavailable, the correct outcome is **no pilot**, not a
substitute task.

### 2.2 Candidates considered and rejected

| Candidate | Why it is not eligible |
| --- | --- |
| Synthetic C1–C4 fixture candidates | They are ours. Their Truth is evaluator-only, and no human reader has a decision about them. |
| PR #349 memory delivery (`777genius/review-router@056952b5`) | `DEVELOPMENT EXAMPLE — NOT INDEPENDENT MODEL-QUALITY EVIDENCE`. Its question is already answered deterministically at the request boundary by the existing regression at `f87abf4`, so a criteria assessment has no gap to fill. Using it would be a historical known-answer case. |
| PR #2 in this repository | The current work product; the reviewer and the author are the same person, so no independent reader decision exists. |

## 3. The decision, and what counts as useful

The reader owns one decision after reading the advisory report: **hold the change, request specific
missing evidence, or proceed as reviewed.** The report is advisory; it never merges, completes work, or
publishes anything.

The criteria assessment earns value only if it adds at least one of:

1. **A supported new actionable issue** that ordinary OCR and the existing checks did not already report,
   with a cited artifact and a named criterion.
2. **A useful request for missing evidence** — a specific, obtainable item whose absence blocks a
   justified conclusion the reader would otherwise have to guess at.
3. **A justified correction** — an issue that contradicts a specific existing finding or check result,
   with the contradiction named.

Not value: a different report structure, a restatement of an existing finding, a new finding on a
non-required criterion, or anything only offline Truth knows is wrong.

## 4. Comparator and the evidence available at review time

**Comparator = the configured OCR rule set (Profile A as ordinary OCR) plus the existing deterministic
checks.** No second OCR model and no extra OCR-plus-criteria arm is added. The pilot arm is the criteria
assessment alone.

The table below is **conditional on a selected case**. For every row, the "current" cell describes today's
state, not an observation about a task: nothing here records an OCR finding, a check outcome or a case.

| Input | Currently supplied for a selected case? | Expected to be available only after | Source / owner |
| --- | --- | --- | --- |
| Original task and derived criteria | **No — no case selected** | M1–M6 provided and frozen; criteria then derived and frozen before the run | M3 (requirement source) → criteria derived by the pilot operator |
| Base and head code, immutable | **No — no case selected** | M2 provided and frozen | M2 (maintainer) → snapshot frozen by the pilot operator |
| Changed files (complete text) | **No — no snapshot exists** | M2 frozen | Materialization from the recorded diff (pilot operator) |
| Relevant unchanged files | **No — no snapshot exists** | M2 frozen, then read on demand | Native tool reads, same boundary as WP8-A (pilot operator) |
| Task/PR background | **No — no case selected** | M1 and M3 supplied | M1/M3 (maintainer) |
| Configured OCR rules | **No — no review-time output captured** | M4 supplied for that snapshot | M4 (maintainer + OCR configuration owner) |
| Ordinary check results | **No — no review-time output captured** | M5 supplied for that snapshot | M5 (maintainer + CI/check owner) |
| Evidence actually available to the reviewer | **No — no snapshot exists** | M2 + M4 + M5 frozen | Artifacts resolvable in the snapshot (maintainer and pilot operator) |
| Later fixes / evaluator Truth / known answers | **Must stay unavailable** | Never before the decision; withheld until the decision is recorded | Withholding control (pilot operator) |

## 5. One route and model, with hard limits

**Recommendation: OpenAI Responses API, `gpt-6.2-sol`, `reasoning.effort=medium`, through the existing
packed SDK path (`@agent-teams/account-gateway@0.1.0` → `createLlmClient()`), which Profile B already
qualifies.**

Why this route and model: the request assembly, capture and ResultContract path are already implemented
and tested against a loopback provider, so the pilot adds a live endpoint — not a new integration. On the
model, the official selection guide's default for API workflows is GPT-6.2 Sol at medium reasoning effort,
and its own example for that pairing is "fixing bugs and adding features in an existing codebase, or
drafting documents for review" — which is this bounded code/review task. The earlier candidate
`gpt-5-mini` is **deprecated** (shutdown 2026-12-11, replacement `gpt-6.1-terra`), so it is no longer a
defensible choice for a pilot that may run after that date.

Pricing used for the ceiling — official model page and pricing page, **Standard** processing tier, short
context (≤272K input tokens), checked 2026-11-20 and confirmed equal on both pages:
`gpt-6.2-sol` — **USD 2.00 / 1M input tokens, USD 10.00 / 1M output tokens**, USD 0.10 / 1M cached input.

| Limit | Proposed value |
| --- | --- |
| Provider / route | OpenAI, Responses API (no batch, no fine-tune, no tools beyond the fixed read-only file reader) |
| Exact model | `gpt-6.2-sol` |
| Reasoning effort | `medium` (`reasoning.effort`; the model rejects `none`) |
| Account / model availability | **Not assumed.** Model access, account tier and credentials must be confirmed at execution time; if unavailable, stop rather than substitute |
| Input token ceiling | 40,000 per request |
| Output token ceiling | 4,000 per request |
| Maximum model requests | **2 total** (1 assessment + 1 transport retry; no semantic retry, no re-prompt) |
| Retry policy | Retry once only on transport/5xx failure, sending identical request bytes; never retry a 4xx, a refusal, or an invalid answer |
| Per-request timeout | 150 s |
| Total wall-clock ceiling | 20 min from dispatch to final recheck |
| Spend ceiling | **USD 0.50** |
| Worst-case input tokens | 2 × 40,000 = 80,000 → 0.08 M × USD 2.00/1M = **USD 0.16** |
| Worst-case output tokens | 2 × 4,000 = 8,000 → 0.008 M × USD 10.00/1M = **USD 0.08** |
| Total token estimate (Standard) | **USD 0.24** worst case |
| Credential handling | `OPENAI_API_KEY` supplied by the maintainer to the qualification process only; never in the repository, logs, artifacts or report |

**What the USD 0.24 estimate excludes.** The figure is **Standard processing only, for model tokens only**.
It excludes any optional Fast processing (twice the Standard rate), Ultrafast, Batch, hosted or billable
tools (web search, file search, containers such as hosted shell or code interpreter), and any applicable
regional-processing or FedRAMP surcharge (a 10% uplift for models released on or after 2026-03-05). None
of those is proposed for use. The 40,000-input ceiling also keeps both requests far below the 272K
short-context threshold, where input and output rates rise — so the short-context Standard rates above are
the correct ones for this calculation.

These are **proposed limits, not authorization**. Model availability, account tier and pricing must be
re-confirmed against the official model and pricing pages immediately before any authorized execution; if
any of them cannot be confirmed, the run stops and the ceiling is re-approved rather than adjusted
silently. The USD 0.50 hard ceiling is preserved unchanged; USD 0.24 is the arithmetic worst case, not a
budget to spend.

## 6. One report → one human action → one recheck

1. **Prepare** (model-free): freeze the snapshot, derive criteria, capture the configured OCR rules and
   their native findings, and record the ordinary check results. Nothing is inferred later.
2. **Dispatch once** through the packed SDK with the limits in §5. The raw response, the captured
   request bytes, the token counts and the request identity are retained.
3. **Validate** the response against the ResultContract, then score it. Mechanical resolution, digest,
   binding and applicability checks run as they do today. Semantic support is *not* resolved by the
   product; unsupported or unknown claims are reported with the wording **"available checks have not
   established support"**.
4. **One advisory report** for the reader: per-criterion claim, cited artifact, whether an available
   check established support, and up to three proposed next actions, each labelled supported new issue /
   evidence request / justified correction.
5. **One recorded human decision** by the named reader (M6), time-boxed to 20 minutes: hold, request
   evidence, or proceed — with a one-line reason. The decision is recorded before the evaluation team
   looks at Truth or the later fix.
6. **One recheck** on the same immutable snapshot using the **same** ordinary checks. Comparison is
   explicit: did the reader's chosen action follow from an item the comparator did not already carry?
7. **One result record**: the measurements in §7, the decision, and the recheck outcome.

No automatic merge, no automatic Work completion, no production publisher, no second reviewer.

## 7. What will be measured (not claimed in advance)

| Measure | How |
| --- | --- |
| Useful new supported findings | Counted against the comparator's existing findings, item by item |
| Duplicate findings already in OCR/checks | Counted, reported as duplicates |
| False objections | Counted, each with the check that should have caught it |
| Unresolved criteria | Counted, with the missing evidence named |
| Useful evidence requests | Counted, and whether the reader could actually obtain the item |
| Justified corrections | Counted, with the contradicted finding named |
| Human decision/action | Recorded verbatim before Truth is consulted |
| Recheck outcome | Same checks, same snapshot, explicit comparison |
| Preparation effort | Recorded in hours by the person who did it |
| Human triage time | Measured stopwatch minutes per report |
| Model request count | From the dispatch log |
| Input/output tokens | From the provider response, retained |
| Elapsed time | Dispatch → decision → recheck |
| Actual spend | Only if an approved live run occurs; otherwise "not incurred" |

Demonstrated benefit and measured savings are **outcomes of the pilot, not entry conditions**. No saved
developer time is claimed here, because none has been measured.

## 8. Stop and approval rules

**Do not start unless** all of: M1–M6 supplied; D1 and D2 granted; the exact model and price re-checked
on the day; the comparator's review-time outputs captured and frozen; the reader named and available.

**Stop immediately, record the failure, and do not substitute** if any of: a missing M-input; the
comparator already reports the candidate issue (the criteria arm adds nothing); spend, model or pricing
cannot be confirmed; a credential is present in the environment outside the approved path; the request
exceeds the input/output/token/wall-clock ceilings; the second attempt also fails; or the reader becomes
unavailable before recording a decision.

**Prefer the simpler existing route instead** when the observation is mechanical and expressible as a
configured OCR rule or a deterministic request assertion — as with PR #349, where the existing
`f87abf4` regression already decides the delivery question and no live call is needed.

**Approval record.** Execution requires the maintainer to approve, in writing: this proposal id, the
route and model, the request cap, the spend ceiling, and the named reader. Until then this pilot is
**not authorized**, D1 and D2 remain **PENDING**, and no live provider, OCR or Gateway call may be made.

## 9. Explicit non-authorizations

This proposal does not authorize: any live model/provider/OCR/Gateway call; any credential use; any
deployment, publication or spend; any automatic merge or terminal Work completion; any change to M2
acceptance status; any model-quality, latency or cost claim from the existing fake-provider evidence.

## 10. References

- Model page — <https://developers.openai.com/api/docs/models/gpt-6.2-sol> (endpoints, context limits,
  reasoning-effort constraint, Standard pricing USD 2.00 in / USD 10.00 out per 1M tokens).
- Pricing — <https://developers.openai.com/api/docs/pricing> (Standard, Batch, Flex, Fast, Ultrafast tiers;
  tool and surcharge notes).
- Model selection — <https://developers.openai.com/api/docs/guides/model-selection> (GPT-6.2 Sol at
  medium reasoning effort as the default starting point for API workflows).
- Deprecations — <https://developers.openai.com/api/docs/deprecations> (`gpt-5-mini` deprecated, shutdown
  2026-12-11, listed replacement `gpt-6.1-terra`).
- Amendment v02 — `2026-11-17-m2-experiment-amendment-02.md` (comparator, scoring boundary, stop rules).

All four OpenAI pages were read on 2026-11-20 while preparing this revision. Reading documentation is not
a live model call, and no availability, quota or entitlement was tested.
