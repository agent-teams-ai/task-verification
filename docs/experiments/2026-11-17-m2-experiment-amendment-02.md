# Experiment Amendment 2026-11-17-02 — one development case card (PR #349)

| Field | Value |
| --- | --- |
| Amendment id | `exp-amendment-2026-11-17-02` |
| Schema | `m2.experiment-amendment/v3` |
| Supersedes | `exp-amendment-2026-11-17-01` **for the proposed next-phase feasibility work only** |
| Amends | `2026-11-12-stage-a-b-experiment-plan.md` |
| Status | **PROPOSED — planning deliverable** |
| Authority | Not an M2 acceptance item. D1 and D2 remain separate pending authorizations. |
| Feasibility result | **NO LIVE COMPARISON RECOMMENDED YET** |
| Case classification | `DEVELOPMENT EXAMPLE — NOT INDEPENDENT MODEL-QUALITY EVIDENCE` |

**Execution boundary for this amendment.** Same as the M2 readiness report: the deterministic probe in
§4.2 ran the **real pinned rr.7 OCR binary against a fake model provider** (loopback, `--network none`,
no credential). The binary is real; the model is not. Nothing here evaluates a live LLM, the hosted
production OCR service, a complete production Gateway route, or provider latency/cost/quality. No
deployment or spending occurred.

Amendment v01 is preserved unchanged at `2026-11-17-m2-experiment-amendment-01.md`. It is not
deleted, edited or reinterpreted. What v02 supersedes is only its *proposal*: v01 proposed a
24-inference-call live pilot across synthetic C1–C4 with a 36-attempt plan. That is withdrawn as a
next-phase design, because it would measure harness repeatability on candidates we built, not whether
a criteria assessment is useful to a consumer. Nothing here approves, requests or initiates live
evaluation.

Changes from the previous v02 text, all corrections:

- §1 no longer implies that model-free M2 work qualifies model quality.
- §2 separates eligibility to **prepare a development case** from eligibility for an **independent
  evaluation**. The previous “all gates” entry rule and the “any one” rule in §9 contradicted each
  other; they now describe two different things.
- §3 is a completed case card for PR #349, built from the pre-fix requirement source and the
  immutable pre-fix candidate supplied in the maintainer review. The previous “no eligible case”
  conclusion was a statement about the material then available, and it is revised here.
- §4 records the actual provider-request boundary trace and a deterministic delivery check.
- §6 corrects the report-specimen wording: an artifact that does not establish a claim is not the
  same as a review-time check that refutes it.

## 1. The product question, and what M2 already answers

For one defined class of ReviewRouter tasks, would an additional criteria assessment provide
supported and useful next actions beyond the configured OCR rule set and ordinary checks, at
acceptable preparation, execution and human-triage cost?

M2 is model-free. Within its scope it qualifies **machinery and contracts**: the result contract,
per-claim and per-finding admission, evidence binding, deterministic controls, the native OCR
integration path, and the SDK qualification path. It does **not** qualify model quality, reviewer
reasoning, latency or cost, and nothing in this amendment should be read as such a claim.

Usefulness to a consumer is a different question again. It depends on whether a real reader's
decision would change, which requires a real task, a named reader, and observations that exist at
review time.

## 2. Two eligibility tracks

The previous text used one gate list for two different activities. They are separated here.

### 2.1 Eligibility to prepare a development/feasibility case

A **development case** is a worked example used to find the next engineering or measurement gap. It
is explicitly not evidence of model quality or product value. It may be prepared when:

| # | Requirement for preparing a development case | PR #349 status |
| --- | --- | --- |
| P1 | The original requirement or intent is citable from material that predates the fix | **Met** — memory replacement plan §8 at `6797745`, committed 27 October; fix dated 28 October |
| P2 | The candidate version is immutable and identifiable | **Met** — `056952b5…`, tree `dc7da86…` |
| P3 | The relevant code path can be inspected in that immutable version | **Met** — adapter blob `5c0ed26…` |
| P4 | The question can be stated as a specific observation gap | **Met** — see §4 |
| P5 | The case is labelled as development evidence and its known answer is disclosed | **Met** — this document |

A known answer (the later fix, a later oracle, or a review-time rule that turns out to be
sufficient) does **not** invalidate a development case. It limits the conclusions that may be drawn
from it. Finding that an existing deterministic check finishes the case is a successful research
result, not a failed experiment.

### 2.2 Eligibility for an independent evaluation

An **independent evaluation** claims something about usefulness or quality beyond this example. It
requires a named decision and a measurement plan before any live call: reported reader, the decision
that could change, the comparator as configured, the review-time observations, and the cost being
measured. A demonstrated benefit and measured triage savings are **outputs** of such an evaluation,
not entry conditions — requiring them in advance would make the evaluation impossible.

## 3. Development case card — PR #349 memory delivery

Classification: `DEVELOPMENT EXAMPLE — NOT INDEPENDENT MODEL-QUALITY EVIDENCE`.

| Field | Value |
| --- | --- |
| Task class | Review-time delivery of an approved workspace memory bundle into a managed OCR review invocation: the review must see the stored rule/memory text, not a filename or identifier. |
| Original requirement and provenance | `777genius/review-router-ai`, commit `6797745dd568149e6314cd44b24cb901de1819e2` (2026-10-27T16:14:28Z), tree `bf39355b9b5704cd5564d345c4f40466a586ec66`, file `ai-docs/plans/2026-10-23-hindsight-memory-replacement.md`, blob `940747b75122f7d079abbfa8f18cf0f5aa1e4991`, sha256 `586446003338e3b40971145221a629256af2df9619cd663535ad1337863c5e3e`, 83,052 bytes. §8 requires a paired change in `777genius/review-router` that adds memory retrieval to the **actual T0 review path** and includes the used bundle identity in the correct prompt/cache/replay/attestation inputs. |
| Intended report reader | The maintainer/PR author reading the machine review for a change to the memory path. |
| Decision that could change | Whether the review may be relied on as memory-consistent for this change (merge / hold), and whether the memory feature is safe to call integrated while the rule may not reach the model. |
| Useful next action | Add a provider-request-boundary regression for the rule document, fix the rule key, and re-run the review; or, before that, refuse the “memory delivered” claim. |
| Immutable pre-fix candidate | `777genius/review-router`, commit `056952b5a3d625fd1d19384942d452114804380f` (2026-10-27T18:25:10Z), tree `dc7da86a2b23d1c12fde90f39cf31628f988c58c`. Its parent is `cb13109566b10813a90de31741c17df7ed0e9f2a`. |
| Source digests | Adapter `src/review-orchestration/infrastructure/ocr-review-invocation-adapter.ts`, blob `5c0ed267724567dd9b4173c64e873ecc8007d99c`, sha256 `203da28e4b1082b122f29583e8e31e65e04efaec31d71d71a1fd8b9e48744740`, 45,875 bytes. Fix commit `f87abf4817bcee10a6be830c834cb599a971372f` (2026-10-28T10:53:17Z, tree `9af4977dad105af2413867bb3b4443c24538376e`), whose parent is the candidate above. |
| Changed-path assignment (candidate commit) | Six paths and no adapter change: `.github/workflows/reviewrouter-execution-reusable.yml`, `.github/workflows/reviewrouter-interaction-reusable.yml`, `.github/workflows/reviewrouter-runtime.yml`, `AGENTS.md`, `__tests__/unit/github/reusable-workflows.test.ts`, `__tests__/unit/review-orchestration/production-t0-review-runner.test.ts`. The adapter is therefore an unchanged dependency of the candidate, which is what makes the delivery question reviewable without touching it. |
| Fixed in | `f87abf4` changes the adapter (+11/−5) plus its unit and integration tests and generated `dist` output. It translates the legacy `content` rule key into a native `{ path: '**', rule, merge_system_rule: true }` rule before appending memory. |
| Unchanged dependencies | `buildOcrControlledRuleText` (the no-Skills managed rule), `appendOcrReviewMemory`, `boundOcrBackgroundText`, the rr.7 `--rule` / `--background` interface, and `ReviewMemorySession.current().renderedPrompt`. |
| Configured OCR comparator | Profile A as ordinary OCR: the configured rule set and native findings, with the plan's zero-model deterministic baseline (`2026-11-12-stage-a-b-experiment-plan.md`, comparator row and “Zero-model baseline”). No OCR-plus-criteria arm is added. |
| Native OCR findings / normalized / skipped | **NOT ESTABLISHED.** The historical review ran rr.4 and its native output, normalized output and skipped reasons were not retained. No value is inferred for them. |
| Stored rule/memory content | **Partially established.** The exact rule-document shape and the append location are established from the immutable adapter. The actual memory bytes rendered for that review are not retained, so no claim is made about their content. |
| Expected content at the provider boundary | The managed rule text followed by `\n\n` and the rendered memory, carried in a native `rule` entry that the OCR parser reads. |
| Actual observed pre-fix request contents | **NOT retained historically.** Reproduced deterministically for this card: see §4. The retained probe JSON is a **reported summary**, labelled `reported-summary-not-raw-request-evidence`; the raw captured request bodies were not kept. |
| Established implementation evidence | **Exists upstream, reused not re-implemented.** `777genius/review-router@f87abf4817bcee10a6be830c834cb599a971372f`, `__tests__/integration/ocr-managed/ocr-managed-real-cli.test.ts`, test `supplies approved memory to the actual managed OCR model request end to end` — see §4.4. |
| What is known | The pre-fix adapter appends memory to the `content` key of the managed rule entry; the pinned rr.7 parser does not read `content`, so neither the rule text nor the appended memory reaches the captured provider request (observed, §4). The fix moves the text to `rule`. |
| What is not known | Whether rr.4 behaved identically (only the fix commit's own comment and tests assert it); the rendered memory bytes; the historical native findings; the review reader's actual decision. |
| Expert preparation required | Not measured. Establishing the intent source, candidate and code path took one retrieval pass; no hours are recorded, so none are claimed. |
| Recurring human-triage effort | Not measured. No per-report triage claim is made. |

## 4. The remaining observation gap, and the deterministic answer

### 4.1 Trace

`Original requirement → configured rule/memory file → context loading → request assembly → SDK/transport serialization → captured provider request`

| Stage | Observation in the immutable pre-fix source |
| --- | --- |
| Requirement | Memory replacement plan §8 (see §3). |
| Rule assembly | `buildOcrControlledRuleText` emits `{ merge_system_rule: true, include: [...], rules: [{ id: 'reviewrouter-managed-v1', content: rule }] }`. |
| Memory append | `appendOcrReviewMemory` (pre-fix) picks `rule.rule` when present, otherwise `rule.content`, and appends `\n\n${memory}` to that key. In the no-Skills lane the key is `content`. |
| Invocation | `ruleText` is written to the run's rule path and passed to the binary as `--rule`; background text goes through `--background`. |
| Native parsing | The OCR parser reads `rule` entries. `content` is not a native rule key. |
| Transport | The binary serialises the parsed instructions into the provider request. |

The expected content is therefore lost at **rule-document interpretation inside the native binary** —
not at context selection, not at request assembly, not at SDK serialisation, and not for lack of a
retained observation. The adapter's own fix comment states the same cause.

### 4.2 Deterministic delivery check (executed: real binary, fake provider)

A local fake-provider check is sufficient for this task family. It was run against the pinned rr.7
binary — **real rr.7 OCR binary with a fake model provider** — offline (`--network none`), with no
credentials and no live model:

| Shape | Rule key carrying rule + memory | Memory sentinel in captured request | Managed rule text in captured request |
| --- | --- | --- | --- |
| Pre-fix document | `content` | **no** (0 of 2 requests) | **no** |
| Post-fix document | `rule` (`path: "**"`) | **yes** (both requests, indexes 0 and 1) | **yes** |

Both runs exited 0 with native status `complete` and no provider problem. The reviewer input supplied
through `--background` deliberately did **not** contain the rule text, so the observation is about the
rule document itself.

What this establishes: for the exact pre-fix rule document shape, the approved memory bytes do not
reach the provider request, while the post-fix shape delivers them. A request-boundary regression can
therefore decide this family without a live comparison, which is why none is recommended.

The retained file `docs/experiments/m2-targeted-corrective-evidence/pr349-memory-delivery-probe.json`
is a **summary of that execution**, not raw request evidence. It is labelled
`reported-summary-not-raw-request-evidence`: it records the sentinel presence per request index and the
rule-key shape, but it does not contain the captured request bodies. No raw request was retained for
this probe, and none is claimed.

**Probe harness not retained.** The local probe ran from a temporary, uncommitted harness, so no script
in this repository reproduces it end to end. What is retained is the summary above plus the immutable
source identities in `pr349-development-case-sources.json`. The reproducible implementation evidence
for this delivery question is the upstream regression in §4.4, not this probe; the probe is support for
the root-cause explanation and should not be cited as the verification.

What it does not establish: rr.4 behaviour (the probe uses the pinned rr.7 binary), any model's
comprehension of the delivered memory, or general product value. The historical review remains a
development example.

### 4.4 Established implementation evidence (existing upstream regression)

The request-boundary regression for this delivery family already exists in the fix commit and is
**reused, not re-implemented**:

| Field | Value |
| --- | --- |
| Repository | `777genius/review-router` |
| Commit | `f87abf4817bcee10a6be830c834cb599a971372f` |
| File | `__tests__/integration/ocr-managed/ocr-managed-real-cli.test.ts` |
| Test | `supplies approved memory to the actual managed OCR model request end to end` |
| Link | https://github.com/777genius/review-router/blob/f87abf4817bcee10a6be830c834cb599a971372f/__tests__/integration/ocr-managed/ocr-managed-real-cli.test.ts |

This is the implementation evidence for the delivery question. It is an integration regression against
the managed OCR request boundary, and it is the reason no second implementation of the same regression
is proposed here. The local deterministic probe in §4.2 remains an independent, model-free
reproduction of the cause; it is not needed as a substitute for that regression.

### 4.3 Check design (for reuse)

1. Start from the authoritative pre-fix rule/requirement source.
2. Build the rule document with the real request-construction path (no hand-written prompt string).
3. Run the native binary against a loopback fake provider; capture the serialized HTTP body.
4. Assert the required rule content is present as a parsed instruction, not merely as a filename or
   identifier.
5. Assert the candidate and request identity are bound correctly.
6. Assert the negative shape (legacy key) does not deliver the content, so the regression can fail.

A local prompt-builder object is not sufficient: only the captured request body answers the question.

## 5. Comparator

The comparator is the one already defined in the original experiment plan: **Profile A as ordinary
OCR** — the configured OCR rule set and its native findings, with the plan's zero-model deterministic
baseline resolving what applicable observations can resolve.

No new “OCR-plus-criteria” arm is introduced. The question is whether a criteria assessment adds
anything **beyond** that comparator, so the comparator must stay exactly as configured; adding a
criteria arm to it would presume the answer.

## 6. Advisory report specimen (shape only)

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
| Raw response | Provider claim: AC-3 “satisfied”, citing `app.ts` | Fake-provider reply; not a model-quality observation |
| Checks available during review | Artifact resolution (digest, candidate/snapshot binding), configured OCR rule set, deterministic baseline observation | All available at review time and replayable |
| Consumer-visible report | “AC-3: reported satisfied; available checks have not established support from the cited artifact; no configured rule covers AC-3; recommend manual check” | Advisory only; no verdict is asserted |

The wording is deliberately “available checks have not established support”. This report can only
say what the configured checks did or did not establish; it cannot claim an artifact “does not
support” a criterion unless a named review-time semantic check establishes that. Offline evaluator
Truth may grade a report, but it is not a product safeguard and cannot be counted as one.

### Three outcomes that must stay distinct

1. **An incorrect claim reaches the consumer.** The report repeats a provider claim that the
   available evidence does not support, with no caveat.
2. **An actually available rule intercepts it.** A configured OCR rule or deterministic check that
   exists at review time rejects or flags the claim. This is the interesting case: the additional
   criteria assessment is only valuable here if the available rule *did not already* catch it.
3. **Only evaluator Truth or human grading rejects it.** The claim looks acceptable to every
   review-time check and is only known to be wrong because we hold the answer. This is not a product
   benefit; counting it as one would be circular.

Collapsing these three into “detected/not detected” is the failure mode this amendment exists to
prevent.

## 7. B-only findings

When only Profile B produces a finding for a criterion, the investigation must inspect, in order:
the **raw input** actually sent, the **native OCR output**, the **normalized output**, and the
**skipped reasons**. OCR silence is never treated as satisfaction, and publication rules for skipped
findings are not bypassed: a skipped finding is reported as skipped, with its reason, not silently
promoted or dropped.

## 8. Decision rules

| Question | Rule |
| --- | --- |
| Smallest remaining adaptation gap | The smallest change that would make the next real case reviewable. For PR #349 the delivery gap is closed by the fix **and** the verification gap is already closed by the existing regression in §4.4. Nothing further is required for this case; do not propose a second implementation of that test. |
| Observations needed before proceeding | For each field in the card: where it came from, or an explicit NOT ESTABLISHED. |
| Stop conditions | Stop if P1 cannot be cited; if the available rule set already decides the case; if the only evidence of incorrectness is evaluator Truth; or if preparation cost exceeds the value of the decision it informs. |
| Prefer a deterministic check or existing OCR route when | The observation is mechanical, already available at review time, and expressible as a configured rule or request assertion. A criteria assessment is not justified merely because it is possible. |
| A bounded live comparison might be justified when | §2.2 is satisfied for a real case: named reader, decision, comparator as configured, review-time observations, and the comparator demonstrably leaves a named claim unresolved (outcome 2 or 3 above). |
| Costs to record | Preparation (expert hours to establish intent and criteria), execution (calls, latency, tokens), and human triage (minutes per report). Measure them; do not estimate them into a benefit. |
| Saved developer time | Not claimed unless measured in the case. No such measurement exists. |

## 9. Feasibility result

**NO LIVE COMPARISON RECOMMENDED YET.** This agrees with the previous conclusion but for corrected
reasons:

1. The development case is now preparable and prepared (§3), so the earlier “no requirement source”
   reason is withdrawn.
2. Its engineering question is answered deterministically at the provider-request boundary (§4). A
   live model call adds nothing to *this* question.
3. What no live comparison can supply here is the consumer-side measurement: a named reader, a
   decision that changes, and triage cost. Those are absent, and they are the actual precondition for
   an independent evaluation (§2.2).

**Scope of this conclusion.** `NO LIVE COMPARISON NEEDED FOR THIS DELIVERY QUESTION` is limited to
whether the approved memory/rule content reaches the actual request boundary. The existing
deterministic request test does **not** establish model comprehension, model reasoning quality,
general reviewer quality, general product value, or rr.7 compatibility beyond the environment the test
actually runs in. It does not resolve the broader Task Verification research question.

## 10. Practical ways forward

1. **Ship the request-boundary regression and stop there for this case.** One deterministic test on
   the rule document (pre-fix shape fails, fixed shape passes) closes the delivery family without
   spending inference. *Justified direction.*
2. **Extend the same boundary check to the memory-identity inputs** named in plan §8 — prompt,
   cache, replay and attestation — as one contract test each, still model-free. A natural follow-up,
   not required by this case.
3. **Prepare one real consumer case** under §2.2 (named reader, decision, measured triage) before
   any live comparison. This is the only route to a usefulness claim, and it is not available from
   the current material.

## 11. Prohibitions (binding on this amendment)

Amendment v02 does **not** and must not:

- propose 24 live calls on synthetic C1–C4 as evidence of product value;
- treat 36 attempts as a quota, target or success metric;
- request D1 or D2 approval as though the next-phase design were already accepted;
- initiate any live model or provider evaluation;
- add a production adapter or publisher;
- add a second reviewer;
- claim model quality, latency or cost benefit from fixed fake-provider responses;
- present evaluator-only Truth as review-time evidence;
- present this development case as held-out model-quality evidence.

D1 (live inference) and D2 (budget) remain **pending** and separately authorized. This document
neither grants nor assumes them.
