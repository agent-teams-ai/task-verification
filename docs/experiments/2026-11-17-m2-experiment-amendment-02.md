# Experiment Amendment 2026-11-17-02 — bounded model-free feasibility case card

| Field | Value |
| --- | --- |
| Amendment id | `exp-amendment-2026-11-17-02` |
| Schema | `m2.experiment-amendment/v2` |
| Supersedes | `exp-amendment-2026-11-17-01` **for the proposed next-phase feasibility work only** |
| Amends | `2026-11-12-stage-a-b-experiment-plan.md` |
| Status | **PROPOSED — planning deliverable** |
| Authority | Not an M2 acceptance item. D1 and D2 remain separate pending authorizations. |
| Feasibility result | **NO LIVE COMPARISON RECOMMENDED YET** |

Amendment v01 is preserved unchanged at `2026-11-17-m2-experiment-amendment-01.md`. It is not
deleted, edited or reinterpreted. What v02 supersedes is only its *proposal*: v01 proposed a
24-inference-call live pilot across synthetic C1–C4 with a 36-attempt plan. That is withdrawn as a
next-phase design, because it would measure harness repeatability on candidates we built, not whether
a criteria assessment is useful to a consumer. Nothing here approves, requests or initiates live
evaluation.

## 1. The product question

For one defined class of ReviewRouter tasks, would an additional criteria assessment provide
supported and useful next actions beyond configured OCR and ordinary checks, at acceptable
preparation, execution and human-triage cost?

This is a question about **usefulness to a consumer**, not about model quality, harness behaviour or
protocol conformance. M2 already answers the last three within its model-free scope. It cannot answer
this one, and more synthetic runs will not answer it either: usefulness depends on whether a real
consumer's decision would change, which requires a real task, a real report reader and observations
that exist at review time.

## 2. Case eligibility gate

A case may be carded only when **all** of the following hold. Any failure disqualifies the case, and
the honest result is then "no eligible case".

| # | Gate | Why it matters |
| --- | --- | --- |
| G1 | The task's **original intent** is established from material that predates and is independent of the later fix | Otherwise the "requirement" is reconstructed from the answer, and any assessment that agrees with it is circular |
| G2 | The candidate version is **immutable** and identifiable (commit/tree/digest) | A moving target cannot bind evidence or support a replay |
| G3 | The observations a reviewer would have are **available at review time**, not reconstructed after the fix | Post-fix tests, later commits and evaluator-only Truth are not review-time evidence |
| G4 | There is a named **report reader** and a **consumer decision** that could change | Without a decision, "useful" has no referent |
| G5 | The case is **not purpose-built for this evaluation** | A candidate authored to exhibit a criteria gap proves only that we can author one |
| G6 | A **next action** can be named that the reader could actually take | An assessment that yields no action is a cost without a benefit |

### Case considered and rejected: PR #349

PR #349 is referenced in this work only as a **development example**. It is not carded, for these
reasons:

- **G1 fails.** The available material is a fix and its post-fix test. The original task intent is not
  independently established: there is no pre-fix requirement statement, issue text, review thread or
  criteria document in this repository, and no external source was retrieved to establish one.
  Deriving intent from the diff or from the test that accompanies the fix is exactly the circularity
  G1 excludes.
- **G2/G3 fail in the same move.** The candidate as it exists now is the fixed version. A post-fix
  test is a post-fix observation, and using it as the review-time signal would present the answer as
  the evidence.
- **G5 is at risk.** Any candidate we assemble from the fixed tree to demonstrate the gap would be
  purpose-built.

Therefore the case is not selected, and no card is filled with fabricated provenance. This is a
finding about available material, not a judgement about the task.

## 3. Case card (template, one case only)

The card below is the deliverable shape. Every field must be filled from independently verifiable
material; a field that cannot be established is recorded as **NOT ESTABLISHED** rather than
estimated. One case only — a second card is out of scope for this amendment.

| Field | Requirement | Status for the only considered case |
| --- | --- | --- |
| Task class | The ReviewRouter task family this case represents, described without reference to the fix | NOT ESTABLISHED (PR #349 excluded) |
| Intended report reader | The role that reads the report and owns the decision | NOT ESTABLISHED |
| Consumer decision that could change | The concrete decision (merge / request change / escalate / no action) and what would flip it | NOT ESTABLISHED |
| Useful next action | The action the reader takes on a supported assessment | NOT ESTABLISHED |
| Original task and criteria sources | Where the pre-fix intent and any criteria wording come from, with immutable references | NOT ESTABLISHED |
| Immutable candidate version | Commit/tree/application digest the review would run against | NOT ESTABLISHED |
| Changed files | The files the review would actually see as changed | NOT ESTABLISHED |
| Unchanged files | Dependencies a reviewer could read for context | NOT ESTABLISHED |
| Context-selection rule and actual context size | How context is chosen and the measured size (characters/tokens), not a target | NOT ESTABLISHED |
| Ordinary observations available at review time | Deterministic checks, configured rules, repository facts — each with its availability proof | NOT ESTABLISHED |
| Configured OCR rules and native findings | The configured rule set and what OCR actually returned, including silence | NOT ESTABLISHED |
| Evaluator-only Truth, later fixes and labels | Explicitly separated and marked as not review-time evidence | NOT ESTABLISHED |
| Expert preparation work | Hours/effort to prepare the case and criteria, measured | NOT ESTABLISHED |
| Recurring human-triage effort | Per-report triage cost, measured | NOT ESTABLISHED |

## 4. Comparator

The comparator is the one already defined in the original experiment plan: **Profile A as ordinary
OCR** — the configured OCR rule set and its native findings, with the plan's zero-model deterministic
baseline resolving what applicable observations can resolve (`2026-11-12-stage-a-b-experiment-plan.md`,
comparator row and "Zero-model baseline" section).

No new "OCR-plus-criteria" arm is introduced. The question is whether a criteria assessment adds
anything **beyond** that comparator, so the comparator must stay exactly as configured; adding a
criteria arm to it would presume the answer.

## 5. Advisory report specimen (shape only)

This specimen shows the report shape required by the decision rules. It uses the existing C1–C4
fixture because that is model-free and available, and it is explicitly **not** product-value evidence:
the candidates are synthetic and their Truth is evaluator-only.

```
raw response
  → checks available during review
    → consumer-visible report
```

| Step | C3 illustration | Evidential status |
| --- | --- | --- |
| Raw response | Provider claim: AC-3 "satisfied", citing `app.ts` | Fake-provider reply; not a model-quality observation |
| Checks available during review | Artifact resolution (digest, candidate/snapshot binding), configured OCR rule set, deterministic baseline observation | All available at review time and replayable |
| Consumer-visible report | "AC-3: reported satisfied; the cited artifact does not support this claim; no configured rule covers AC-3; recommend manual check" | Advisory only; no verdict is asserted |

### Three outcomes that must stay distinct

1. **An incorrect claim reaches the consumer.** The report repeats a provider claim that the
   available evidence does not support, with no caveat.
2. **An actually available rule intercepts it.** A configured OCR rule or deterministic check that
   exists at review time rejects or flags the claim. This is the interesting case: the additional
   criteria assessment is only valuable here if the available rule *did not already* catch it.
3. **Only evaluator Truth or human grading rejects it.** The claim looks acceptable to every
   review-time check and is only known to be wrong because we hold the answer. This is not a product
   benefit; counting it as one would be circular.

Collapsing these three into "detected/not detected" is the failure mode this amendment exists to
prevent.

## 6. B-only findings

When only Profile B produces a finding for a criterion, the investigation must inspect, in order:
the **raw input** actually sent, the **native OCR output**, the **normalized output**, and the
**skipped reasons**. OCR silence is never treated as satisfaction, and publication rules for skipped
findings are not bypassed: a skipped finding is reported as skipped, with its reason, not silently
promoted or dropped.

## 7. Decision rules

| Question | Rule |
| --- | --- |
| Smallest remaining adaptation gap | The single smallest change that would make one real case reviewable: a criteria source, a context-selection rule, or a report field. Name one, not a roadmap. |
| Observations needed before proceeding | For each mandatory field in §3: where it would come from and how its availability at review time is proven. |
| Stop conditions | Stop if G1 cannot be established; if the available rule set already decides the case; if the only evidence of incorrectness is evaluator Truth; or if preparation cost exceeds the value of the decision it informs. |
| Prefer a deterministic check or existing OCR route when | The observation is mechanical, already available at review time, and expressible as a configured rule. A criteria assessment is not justified merely because it is possible. |
| A small advisory criteria evaluation might be justified when | A real case has established intent (G1), an immutable candidate (G2), review-time observations (G3), a named reader and decision (G4), and the configured comparator demonstrably leaves the claim unresolved — outcome 2 or 3 above. |
| Costs to record | Preparation (expert hours to establish intent and criteria), execution (calls, latency, tokens), and human triage (minutes per report). Measure them; do not estimate them into a benefit. |
| Saved developer time | Not claimed unless measured in the case. No such measurement exists. |

## 8. Feasibility result

**NO LIVE COMPARISON RECOMMENDED YET.**

Reasons, in order of weight:

1. No eligible case exists in available material (G1 fails for the only candidate considered).
2. Without a case, the comparison would run on synthetic candidates, which is exactly the v01 design
   this amendment withdraws: it measures our fixture, not consumer usefulness.
3. The report shape, the three-outcome distinction and the cost model can all be exercised
   model-free first. Doing that is cheaper and it is a precondition for a meaningful live run.

## 9. What would justify a live comparison

Any one of these, established **before** any live call:

- A real task whose pre-fix intent and criteria can be cited from independent, immutable sources.
- A consumer decision that demonstrably changes on a supported advisory assessment, with the triage
  cost measured.
- Evidence that the configured comparator leaves a specific, named claim unresolved on that task,
  with the raw input, native output, normalized output and skipped reasons inspected.

Until then, the correct output of this phase is the model-free card and this result.

## 10. Prohibitions (binding on this amendment)

Amendment v02 does **not** and must not:

- propose 24 live calls on synthetic C1–C4 as evidence of product value;
- treat 36 attempts as a quota, target or success metric;
- request D1 or D2 approval as though the next-phase design were already accepted;
- initiate any live model or provider evaluation;
- add a production adapter or publisher;
- add a second reviewer;
- claim model quality, latency or cost benefit from fixed fake-provider responses;
- present evaluator-only Truth as review-time evidence.

D1 (live inference) and D2 (budget) remain **pending** and separately authorized. This document
neither grants nor assumes them.
