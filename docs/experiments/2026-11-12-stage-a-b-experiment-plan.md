---
id: experiments.stage-a-b-plan-2026-11-12
type: research
status: active
owner: research/maintainers
summary: Proposed 39-review-run Stage A/B pilot experiment for Task Verification, with four sealed candidates, two reviewer profiles and explicit open decisions.
---

# Task Verification — Stage A/B Experiment Plan

**Recorded 2026-11-12 (Europe/Kiev). Source identities re-verified 2026-11-13.** Milestone 1 of the owner-approved Task Verification research programme. This is a **planning artifact**: no verification kernel, harness, transport qualification, live OCR run, model call or production integration exists. The experiment described here proposes **39 review-run executions; 0 have been executed**. Of those, 12 are managed OCR review sessions (Profile A) and 27 are single `/llm` calls (Stage A Profile B, conditional Stage B, controls). The number of underlying model/API requests inside one OCR session is **not established** by this plan and may exceed one per session.

Source classes used below are marked inline as `[A]` accepted decision, `[I]` implemented source inspected by this milestone, `[T]` test inspected but not executed, `[P]` executed model-free probe, `[C]` existing CI receipt inspected, `[E]` experimental model evaluation, `[U]` unverified assumption. **No `[E]` item exists yet**; that absence is the reason for the experiment.

## 1. Executive summary

**Recommendation: run Stage A as scoped, with three changes to its substrate, and do not treat its result as an architecture decision.**

1. **Profile B should be the bounded `/llm` criteria reviewer, not an OCR tool loop.** The managed OCR build cannot receive a complete criteria inventory through its background channel: it hard-aborts above 8,000 characters `[I]`. No supported criteria-result output contract exists in the inspected OCR result model `[U, carried from S1]`. The `/http` tool loop has no finished session client and no transport qualification `[I]`. Therefore Profile B = one `/llm` call over a fully materialized context bundle, with schema-validated per-criterion output. Consequence: **Stage A measures "criteria reviewer over supplied context" against "ordinary OCR", not "OCR with criteria" against "OCR without"**. A criteria-aware OCR profile remains unqualified and is explicitly out of Stage A.
2. **Stage A cannot test TV-O1.** TV-O1 is machine evidence plus a criteria reviewer. Stage A has no machine evidence; only the conditional Stage B introduces it, and only from recorded artifacts. Any post-Stage-A claim that TV-O1 was validated would be false. Stage A informs the *reviewer* question (TV-O2-like vs ordinary review); Stage B informs the *evidence* question.
3. **Do not reuse the 2026-11-12 synthetic HTTP examples as benchmark candidates, and do not reuse the identifiers `P1`, `P2`, `N1`, `N2`.** Those four examples are self-authored toy implementations whose 12 loopback requests measured their own behaviour and no reviewer `[P]`. The same four labels additionally carry *different* meanings in S4 and S1 (see §4.6). This plan defines four new candidates with a fresh `S1-C*` namespace.
4. **Ground truth must be behavioral and sealed before any reviewer runs.** The proposed fixture is small enough that every criterion is a black-box HTTP observation, so ground truth does not depend on reading the candidate's source and cannot be supplied by a model.
5. **Pre-register the metrics and the Stage B trigger before the first invocation.** At n=24 runs the experiment supports directional evidence only; an unregistered analysis would be unfalsifiable.
6. **The binding dependency is authorization, not design.** No model route is configured for a standalone consumer, and this milestone created no account or subscription `[U]`. Reusing the existing ReviewRouter test route is the cheapest path but is an owner decision (§17, D1).

**What would change this recommendation, stated in advance.** If Profile A detects the omission candidate (§4 C4) in the same repetitions as Profile B without any criteria inventory, the criteria inventory adds little for this candidate class and the simplest viable path (TV-O3-style single invocation) should be preferred over building a criteria channel. If Profile B cannot return *justified* `satisfied` outcomes because the criteria need runtime facts it cannot obtain, the correct next step is machine evidence (TV-O1) earlier than planned, not a better prompt.

**This is a narrow pilot, and it should be described as one.** One synthetic HTTP fixture, four candidate snapshots and five primarily machine-observable criteria can evaluate criterion coverage, detection of the selected behavioural violations, false-positive behaviour on the selected correct candidates, reviewer consistency across repeated executions, and the effect of supplying the defined recorded evidence. It cannot establish general pull-request review accuracy, broad semantic acceptance-criteria verification, performance on arbitrary repositories, production reliability, statistical significance, or the general effectiveness of a reusable evidence platform. The 60 per-profile criterion observations are **clustered within four candidate snapshots**; they are not 60 independent candidate samples, and no count in this plan should be read that way.

## 2. Scope and decision questions

| ID | Decision question | Primary measure | Answered by |
| --- | --- | --- | --- |
| DQ1 | Does a criteria-focused reviewer return a complete assessment for every expected criterion? | coverage, missing/duplicate/invalid ID counts | Stage A |
| DQ2 | Does it avoid fabricating findings against correct candidates, including correct implementations in unchanged code? | false-alarm rate on C1/C2 | Stage A |
| DQ3 | Does it detect a demonstrated behavioral violation and a demonstrable omission that ordinary diff-oriented review can miss? | detection rate on C3/C4 | Stage A |
| DQ4 | Can it justify `satisfied`, or does it only ever abstain? | justified-satisfied rate | Stage A |
| DQ5 | Does recorded machine evidence improve correctness or only change wording? | Δ correct outcomes on the sealed oracle | conditional Stage B |
| DQ6 | What does one verification cost and how often does it fail technically? | units, tokens, wall clock, completed/attempted | Stage A, Stage B |

Out of scope for this milestone and for the experiment it plans: kernel implementation, harness implementation, live OCR provisioning, live model evaluation, CI ingestion, package publication, stable SDK, production deployment, automatic correction, new accounts or subscriptions, amendments to accepted ADRs, changes to the Phase 0 report, and unrelated ReviewRouter or Account Gateway repairs.

## 3. Source baseline with pinned revisions

### 3.1 Research inputs and their merge state

| Source | Pin | State at observation |
| --- | --- | --- |
| S1 Architecture and routing follow-up (2026-11-12) | `agent-teams-ai/engineering-research@35d8084292c745e2e5ea097bd9b6f5524c6fe3e1` | PR **#6 open**, not on `main` |
| S2 Five practical options (2026-11-11) | same commit | PR **#6 open**; TV-O1–TV-O5 identities preserved unchanged here |
| S3 Product and architecture vision (2026-11-10) | `70c680af8b66369a2975a9db21ae081a94f62a5c` | PR **#5 open**, not on `main` |
| S4 Evaluation proposal (2026-11-10) | same commit | PR **#5 open** |
| S5 Retained model-free evidence bundle | `35d8084…/evidence/experiments/task-verification-2026-11-12/` | Present: `README.md`, `manifest.json`, `review-rerun.json`, `snapshot/` |
| Original Phase 0 report | — | **Not available.** Only the partial import referenced by S1/S2 is retained |

Two consequences follow, and both are limits on this plan rather than defects to fix here. First, the four research inputs are **unmerged drafts**, so nothing in them is an accepted decision; they are product/research direction. Second, the routing follow-up's links resolve inside PR branches, not `main`.

### 3.2 Verified source identities

Each row was re-resolved against the GitHub API during this milestone.

| Component | Commit | Tree | Verified facts |
| --- | --- | --- | --- |
| ReviewRouter Action | `7a079c382d8e98b426ee90a6b3764be2a21b4c49` | `ff2803694195…` | public repo `777genius/review-router`; committer date 2026-11-12T01:50:27Z; subject "fix: sync public action runtime" |
| ReviewRouter App | `8d697434ad220dfd3e580b190e311726aa8366ed` | `75c853dbed3b…` | public repo `777genius/review-router-ai`; 2026-11-12T04:46:46Z |
| Account Gateway (tested pair member, requested pin) | `539418d5935a9e336d480b128a1cdb93c1daa6e1` | `608b577e2da6…` | 2026-11-11T11:23:39Z; **same tree** as `main` `784f3550fe3b…` |
| Account Gateway `main` | `784f3550fe3b0d831a64b222445b520638cf22ac` | `608b577e2da6…` | 2026-11-11T15:50:18Z; identical code to the tested pin |
| Sub2API native (tested pair member) | `a19cbcbedda8eccbe82bb24224052a1e9eaab309` | `307e63d6a563…` | 2026-11-11T11:00:58Z; **same tree** as `main` `38674a127356…` |
| Sub2API `main` | `38674a127356bf24a8ff62ccd55a7d792886c168` | `307e63d6a563…` | 2026-11-11T11:44:53Z |

Reconciliation of the two SHA pairs: the differing commit IDs are squash/rebase artefacts over one tree, so "Gateway `539418d…` + native `a19cbcb…`" and "Gateway `784f355…` + native `38674a1…`" are the **same code pair**. This plan pins the requested pair (`539418d…` / `a19cbcb…`) for reproduction and records both identities so a reader cannot mistake one for different code.

### 3.3 Managed OCR build identity, and a source gap

| Fact | Value | Class |
| --- | --- | --- |
| Upstream repository pinned by the build recipe | `alibaba/open-code-review` at `8eb83340a487b1150af00701b94f01af97e4b4d6` (v1.13.1) | `[I]` `tools/ocr/build.sh` |
| Managed release version | `1.13.1-rr.6` | `[I]` |
| Go toolchain | `go1.26.10` | `[I]` |
| Outcome schema version emitted by the build | `reviewrouter.ocr-outcome/v1` | `[I]` |
| Upstream commit whose result/manifest model S1 inspected | `6386895e7cfac419bd7a9cf4795e8b824a6e3ced` | `[I, S1]` |
| Local bridge requirement | managed endpoint patch requires an explicit local credential, rejects inherited endpoint env, rejects `api_key_cmd`, requires a loopback host | `[I]` patch 0003 |
| Background text hard cap | 8,000 characters; 8,000 continues, 8,001 aborts | `[I]` + `[T]` upstream behaviour recorded in the adapter |

**Gap to close before Profile A runs (dependency R2):** the inspected upstream revision (`6386895…`) is not the revision the build compiles (`8eb83340…`). Every statement inherited from S1 about OCR's result model therefore describes a *different* upstream snapshot than the binary a Stage A run would execute. Either the same revision is inspected and built, or the plan's claims about OCR output semantics must be re-derived for `8eb83340…`.

### 3.4 Gateway SDK identity

`@agent-teams/account-gateway` is version `0.1.0` with `"private": true` and explicit server-only subpath exports: `.`, `./contracts`, `./http`, `./get-modular`, `./llm` `[I]`. Engines are `>=24.21.0 <25 || >=26.10.0 <27`. Because the package is private, an experimental consumer cannot `npm install` it; it must vendor a packed archive with a provenance record (source commit and tree, archive bytes, SHA-256, npm integrity, versions and passed gates) `[I]`. `/http` and `/llm` are **package entry points, not HTTP routes**, and both block browser resolution `[I]`.

`/llm` is documented as *one bounded model call*, it composes the consumer-control and execution clients, and it explicitly adds no retry, failover, replay, storage or logging; a multi-request session API "is deliberately not part of this entry yet" `[I]`. `/http` provides the lower-level execution operations (run access, request dispatch, status readback, close) whose streams are raw bytes that the client does not parse as SSE `[I]`.

### 3.5 Existing CI receipts

| Receipt | Verified state |
| --- | --- |
| `account-gateway` run `43011587978` "Pinned native client and public ingress qualification" | completed / success, head `539418d5935a`, 2026-11-11T11:23:43Z `[C]` |
| `account-gateway` run `43011587806` "Production full-stack E2E and bounded load" | completed / success, head `539418d5935a`, 2026-11-11T11:23:43Z `[C]` |

These are **inspected receipts for their own controlled scopes**. They were not launched by this milestone, their job logs were not audited here, and they do not qualify a live OCR invocation, a criteria-output contract, arbitrary live-provider throughput, or Task Verification. A successful receipt is never represented as a successful live OCR experiment.

### 3.6 Source hierarchy applied to this plan

| Claim class | Example used below | How it may be used |
| --- | --- | --- |
| `[A]` accepted decision | ADR-0072 names the sole terminal completion authority and the `completionEpoch` / `completionBasisRevision` / `candidateDigest` binding; ADR-0027 keeps Temporal behind product ports | boundary constraints only; not proof that behaviour is deployed |
| `[I]` implemented source | OCR argv construction, 8,000-character bound, Gateway entry points, package privacy | describes code as read at a pinned commit |
| `[T]` inspected, unexecuted test | OCR background boundary; upstream native regression tests | describes intent only; not an executed result |
| `[P]` executed model-free probe | the 44 named checks, 14 upstream assertions, 12 loopback requests | about the probe's own model; never about reviewer accuracy |
| `[C]` CI receipt | runs above | scoped technical qualification |
| `[E]` live model evaluation | **none** | — |
| `[U]` unverified assumption | Phase 0 import integrity, criteria-output support, model route availability | must stay labelled until closed |

### 3.7 Recorded limitations

- The full canonical Phase 0 report was not available in the source set inspected by this milestone. Only the partial imported copy was available: S1/S2 record a 57,524-byte import with SHA-256 `e5ca71d6e57bcf34103e0b80f28550553c365b43a357da05ab2019725ff5ddfd`; **this milestone did not re-verify that byte count or digest**, and no missing content was reconstructed. The limitation can be revisited if the owner supplies the complete canonical report; nothing here treats it as permanent.
- The upstream Sub2API tests and OCR result model were not re-read by this milestone; those claims are carried from S1 with their `[I]/[T]` status intact.
- No model call, OCR execution, package publication or Gateway deployment was performed.

## 4. Four-candidate matrix and ground-truth procedure

### 4.1 Fixture

One disposable, purpose-built service repository, `task-verification-fixtures` (to be created in Milestone 2 under the organization; **not** created here). It is a single Node 24 HTTP service of roughly 200 source lines with a JSON audit sink, plus one test file. It is deliberately small for two reasons: every criterion is black-box observable, and the whole repository fits inside one `/llm` request body (limit 1 MiB `[I]`), which removes repository-retrieval strategy as a confounder between profiles.

**Acceptance criteria snapshot (revision `crit-v1`).** Written before any candidate exists.

| ID | Criterion text (canonical) | Observable |
| --- | --- | --- |
| AC-1 | `GET /profile` with a valid, active bearer token returns 200 and a JSON body containing the caller's `id` and `email`. | status + body |
| AC-2 | `GET /profile` with no bearer token returns 401 and no profile fields. | status + body |
| AC-3 | `GET /profile` with a token present in the revocation list returns 401 and no profile fields. | status + body |
| AC-4 | No `GET /profile` response body contains the fields `role` or `internal`. | body only |
| AC-5 | Each request rejected for missing credentials writes exactly one audit record with `event = "profile.access.denied"` and `reason = "missing_credential"`. | audit sink |

AC-5 is intentionally scoped to the missing-credential path so that its truth is independent of AC-3: a candidate that fails revocation enforcement must not thereby make AC-5 ambiguous. This is a design correction adopted here because the alternative wording ("every denied request") makes satisfaction vacuous when a request that *should* be denied returns 200.

### 4.2 Candidate matrix

Every candidate is an immutable commit on a named branch of the fixture repository; the reviewed snapshot is the base/head tree pair, never a branch head name.

| ID | Snapshot pair | Provenance | AC-1 | AC-2 | AC-3 | AC-4 | AC-5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `S1-C1` | `base@B0` → `head@H1` | correct inline implementation written for this experiment | ✅ | ✅ | ✅ | ✅ | ✅ |
| `S1-C2` | `base@B0` → `head@H2` | correct alternative: route delegates to **unchanged** helpers in `B0` for token verification, revocation and audit | ✅ | ✅ | ✅ | ✅ | ✅ |
| `S1-C3` | `base@B0` → `head@H3` | behavioral violation: revocation lookup reads the revocation set but compares it to the wrong field, so revoked tokens pass | ✅ | ✅ | ❌ | ✅ | ✅ |
| `S1-C4` | `base@B1` → `head@H4` | omission: route returns `serializeProfile(user)` from an unchanged serializer that includes `role`; the required redaction is never implemented | ✅ | ✅ | ✅ | ❌ | ✅ |

`B1` differs from `B0` only in the content of the unchanged serializer, which is why C2 and C4 cannot share one baseline. That difference is a stated confounder (§4.5), not an accident: the pair is designed to test whether a reviewer's readiness to read unchanged context is applied in both directions.

Both polarity directions are present: six expected violations (`C3/AC-3`, `C4/AC-4`, × 3 repetitions) and 54 expected satisfied observations per profile.

### 4.3 Independent ground-truth procedure

The procedure is ordered so that truth cannot be reverse-engineered from a candidate's source or from any reviewer output.

1. Freeze `crit-v1` text and digest. Write the oracle **from the criteria only**, before any candidate exists.
2. Build the four candidates without consulting the oracle implementation beyond the criteria text.
3. Execute the oracle against each built candidate in a fresh container-like process on a fixed loopback port, capturing raw request/response bytes and the audit sink per probe.
4. Run it **twice** per candidate; a disagreement between runs invalidates the fixture and stops the experiment (stopping condition S4).
5. Seal `truth-v1.json` = `{candidateId → criterionId → satisfied|violated, probeRef, responseDigest}` in a file the harness never exposes to a reviewer, and digest it.
6. Generate the anonymous identifiers (§7.3) and keep the mapping in a separately sealed file.

**Behavioral oracle (O-1), six probes per candidate.** `P-valid` (200, `id`/`email` present), `P-missing` (401, no profile fields, plus audit record count/fields), `P-revoked` (401, no profile fields), `P-fields` (body field scan for `role`/`internal` on the 200 path). The oracle contains no reference to candidate source paths and no expected-outcome text readable by the reviewer.

**Why this truth is defensible for this fixture.** All five criteria are externally observable request/response properties. No criterion requires judgement about style, architecture or intent, so no model and no human adjudication is needed to establish truth. The plan does **not** claim this extends to criteria that are not machine-observable; §16 records that limitation rather than papering over it. If a reader rejects the fixture as too small, the minimal alternative is to keep all five criteria behavioural and enlarge only the surrounding repository with unchanged code that is irrelevant to the criteria — which preserves oracle validity at higher review cost.

### 4.4 Per-candidate detail

**`S1-C1` — correct inline implementation.** *Representativeness:* the ordinary "well done" PR; the class where a strict verifier is most likely to produce false rework. *Confounders:* small diff makes detection easy for both profiles. *Falsifier:* any `violated` outcome on C1 by either profile is a false alarm unless the oracle is wrong, which triggers stop S4.

**`S1-C2` — correct alternative with behaviour in unchanged code.** *Representativeness:* the follow-up's own P2 motivation — a reviewer that demands one implementation style fabricates a defect when the required behaviour already lives in an unchanged helper. *Confounders:* shares `B0` with C1 and C3, so any cross-candidate contamination must be prevented by fresh processes (§7.4). *Falsifier:* a `violated` outcome that cites the absent inline code as missing behaviour.

**`S1-C3` — demonstrated behavioural violation with an independent oracle.** *Representativeness:* a security-relevant defect whose truth is established by executing a request, not by reading intent. *Confounders:* the diff is visible, so this measures detection rather than discovery; it does not measure whether a reviewer *would* have found it without a criteria list. *Falsifier:* a `violated` outcome with no resolvable evidence reference does not count as detection (§13).

**`S1-C4` — demonstrable omission in unchanged code.** *Representativeness:* the case S3/S4 argue ordinary diff review cannot see — required redaction is absent, and the new route looks correct in isolation because it reuses an existing serializer. *Confounders:* an ordinary reviewer that happens to open the serializer may find it; that outcome is a legitimate result and would falsify the hypothesis that criteria are necessary for this class. *Falsifier:* an `inconclusive` outcome justified by "serializer not inspected" is an honest miss, not a false positive, and must be scored as one.

### 4.5 Confounders carried by the design as a whole

| Confounder | Effect | Handling |
| --- | --- | --- |
| `C2` and `C4` use different baselines (`B0` vs `B1`) | cross-candidate comparison is not a controlled pair | analysed within-candidate against truth; never compared C2-vs-C4 |
| One task class (HTTP authorization), 5 criteria | no generalisation to other task shapes | every result is scoped to this fixture, stated in the report |
| Criteria are all machine-observable | favourable to a verifier that cannot execute code | recorded as a limit; Stage B exists to probe the evidence direction |
| Fixture is small enough to inline | removes retrieval asymmetry, also removes realism | stated explicitly; large-repository behaviour is unmeasured |
| Model nondeterminism | repetitions are the only control | 3 repetitions, reported per cell, no smoothing |

### 4.6 Candidate identity reconciliation

Identifiers `P1`, `P2`, `N1`, `N2` are already used twice with different meanings and must not be extended:

| Identifier | S4 (2026-11-10) meaning | S1 synthetic probe (2026-11-12) meaning | This plan |
| --- | --- | --- | --- |
| `P1` | correct endpoint, auth checks, contract and tests | correct inline implementation | renamed `S1-C1` |
| `P2` | correct alternative implementation in an unchanged helper | correct unchanged helper | renamed `S1-C2` |
| `N1` | missing 401 behaviour (failing test) | missing-token defect in changed route | superseded by `S1-C3` (revocation, not missing token) |
| `N2` | required function entirely absent from the changed-file diff | revoked-token defect in unchanged helper | split into `S1-C3` (behaviour) and `S1-C4` (omission) |

No identifier is reused for two definitions. The synthetic HTTP examples' outcome table is an illustration of the fixture mechanism, not a benchmark result, and it is not evidence of reviewer accuracy.

### 4.7 The `inconclusive` pathway

Execution, evidence and applicability failures must never be reported as semantic violations. Four diagnostic scenarios are defined, each scored as `inconclusive` with a cause code, and each excluded from the false-alarm numerator:

| Scenario | Injected condition | Required result |
| --- | --- | --- |
| `X-1` | reviewer call fails after dispatch with an unknown effect | `execution: unknown`, criterion `inconclusive`, cause `effect_unknown`; **no replay under a fresh identity** |
| `X-2` | model output is truncated at the output limit | `execution: partial`, `inconclusive`, cause `output_truncated` |
| `X-3` | returned assessment omits an expected criterion ID | that criterion `inconclusive`, cause `missing_assessment`; other criteria keep their outcomes |
| `X-4` | evidence reference does not resolve in the sealed snapshot | criterion `inconclusive` for evidence purposes, cause `unresolvable_reference` |

`X-1` is exercised only if a real ambiguous loss occurs; it is not simulated with fake providers in Stage A.

## 5. Reviewer profile comparison

Both profiles receive the **same** candidate snapshot, the **same** criteria text, the **same** pull-request description (including the criteria section, exactly as production would present it), and the **same** repository checkout. What differs is the instruction, the output contract and the execution substrate.

### Profile A — Ordinary Code Review

| Property | Value | Class |
| --- | --- | --- |
| Binary | managed OCR `1.13.1-rr.6`, upstream `8eb83340…`, go1.26.10 | `[I]`, built in Milestone 2 |
| Build inputs | upstream tarball + `tools/ocr/patches` managed set | `[I]` |
| Model and settings | the authorized profile's admitted model; `--model`, `--concurrency`, `--timeout`, `--max-tokens-budget` passed explicitly and recorded per run | `[I]` argv; values are owner decisions (D2) |
| Materialized input | base/head tree pair, diff, PR description, optional background file (unused here) | `[I]` |
| Tool availability | full repository workspace access at the pinned head | `[I]` |
| Inspection scope | changed paths, per its own ordinary rules | `[I]` |
| Execution route | managed OCR → local bridge → Action transport → backend relay → Gateway → native Sub2API | `[I]` |
| Output semantics | review comments/findings about defects introduced or aggravated by the change; **no per-criterion verdicts** | `[I]` |
| Completeness behaviour | partial coverage and missing model attribution are rejected at admission (`no_model_requests`, `actual_model_missing`, partial flags) | `[I]` |

Profile A is **not weakened and not extended**: its prompt, rules, model and output shape stay as they are. It is scored on detection and false alarms only (§13.3), because demanding criterion verdicts from it would convert it into Profile B.

### Profile B — Criteria-Focused Verification

| Property | Value | Class |
| --- | --- | --- |
| Interface | `@agent-teams/account-gateway/llm` → `createLlmClient(...).generate(...)` | `[I]` |
| Execution shape | exactly one bounded model call per invocation, one execution per call, closed afterwards | `[I]` |
| Input | complete `crit-v1` inventory (IDs + text), the repository tree materialized into the request, the PR description, explicit instruction to assess every ID | `[I]` limits; design decision here |
| Output | `output: { mode: "json_schema", schema }` with `assessments: [{ criterionId, outcome, evidenceRefs[], explanation }]`; `decode` validates every expected ID is present, unique and inside the inventory | design decision |
| Inventory authority | expected ID list comes from the captured snapshot, **never** from the model output | requirement |
| Outcome domain | `satisfied` \| `violated` \| `inconclusive`, plus `assessmentState: present\|absent` recorded separately | design decision |
| Retrieval | none: no tool loop, no repository search, no second turn | `[I]` |
| Guarantees given up | no retry, no failover, no replay, no session continuity, no streaming consumption by the client | `[I]` |

`prepareStrictJsonSchema` is used when the provider requires closed objects; the helper's `decode` removes added nulls and validates against the original schema `[I]`. A provider that does not enforce schemas is a documented risk (§16 R6), which is why the consumer validates rather than trusting the model.

### Fairness ledger

| Dimension | Same | Different (must be reported, never attributed to prompt alone) |
| --- | --- | --- |
| Candidate snapshot | identical tree, identical checkout | — |
| Criteria snapshot | identical text and digest | — |
| Task information | identical PR description including criteria | — |
| Repository information | A may open any file; B receives the whole tree inline (complete for this fixture) | mechanism, not amount |
| Expected scope of inspection | whole fixture repository for both | — |
| Tool access | — | A has tools; B has none |
| Model context | — | A's engine-managed context vs B's single request |
| Execution architecture | — | multi-turn tool loop vs one call |
| Budgets | per-run ceilings in §14 | A's internal call count is unbounded by this plan |
| Prompt methodology | — | A's native rules vs B's criterion contract |
| Model calls | — | A: engine-chosen; B: exactly 1 |

**Two asymmetries are structural and cannot be removed by design.**

1. **Profile A cannot return `satisfied`.** No scoring may treat its silence as satisfaction (S3/S4 invariant), and no scoring may present B's satisfied count as a win. The headline comparison is therefore detection rate on the two violating candidates and false-alarm rate on the two correct candidates; justified-satisfaction is reported against a floor of zero for A and is *descriptive only*.
2. **Profile B has no tools.** If B misses something because it could not execute the code, that is a property of the single-call route, not of criteria-focused reasoning. Stage B exists partly to test whether evidence closes that gap.

An always-`inconclusive` reviewer is not allowed to look good: the metrics report inconclusive rate alongside detection, and §13.4 defines a "no usable assessment" flag for any profile whose coverage is complete but whose outcomes are ≥80% inconclusive.

## 6. OCR and Gateway route options, verified limits

### 6.1 Full managed OCR tool loop (`/http`)

The inspected route is managed OCR → local bridge → Action transport → ReviewRouter backend relay → Account Gateway → native Sub2API `[I, S1]`. The minimum composition for one complete invocation, as far as source inspection establishes it:

1. Resolve an authorized experiment profile/account set in the consumer boundary — **not available to this milestone** (§6.4).
2. Open one bounded execution and retain its intent and identity.
3. Start the managed OCR local bridge: the patch requires an explicit local credential, rejects inherited endpoint variables and `api_key_cmd`, and requires a loopback host `[I]`. The child receives the local capability; the trusted adapter owns Gateway access.
4. Assign and persist a stable request ID **before** each dispatch; reuse the same execution across the permitted tool turns.
5. Preserve protocol bytes and observe terminal/model facts separately — `/http` does not parse SSE, and requested-model metadata cannot substitute for observed attribution `[I]`; OCR's own admission rejects missing observed attribution `[I]`.
6. Propagate cancellation to held streams. After an ambiguous loss, read back the original identity and preserve any unresolved effect. A timeout or readback 404 does **not** prove that no model effect occurred `[I]`.
7. Close with the operation/readback contract (the `/llm` path bounds close at 10 seconds `[I]`; the `/http` path's close bound is a consumer decision) and retain unresolved cleanup facts.

Not claimed: a ready-made public OCR session client. None was found in the inspected source; the composition above is adapter work, and it is **not** part of Milestone 1.

### 6.2 Separate single-call criteria reviewer (`/llm`)

`createLlmClient(...).generate(...)` can satisfy Profile B **when the repository context is already supplied**, because the criteria text, the candidate tree and the output schema all fit inside the documented envelope: body ≤ 1 MiB, output tokens ≤ 100,000, output bytes ≤ 8 MiB, deadline ≤ 1 hour ahead `[I]`.

It cannot, without additional orchestration: retrieve files it was not given; investigate a disputed criterion in a second turn; maintain conversation state (`previous_response_id` is rejected on the native Responses path `[I, S1]`); consume streamed partial output (the client reduces the stream and returns one value); or retry safely (no retry/failover, and `retry: "new_attempt"` may duplicate cost `[I]`). Consequences for the plan: Profile B's context must be complete rather than searchable, and any criterion needing runtime facts will land in `inconclusive` — which is a legitimate, reportable result.

### 6.3 Direct Sub2API comparison (conditional, likely not worth it)

Only the pinned fork `a19cbcbedda8eccbe82bb24224052a1e9eaab309` may be used. What differs if a candidate is reviewed through Sub2API's ordinary ingress instead of the Gateway:

| Guarantee | Retained? | Basis |
| --- | --- | --- |
| Execution-scoped capability and server-recovered authority | **No** — standard native routes recover authority server-side, but the Gateway execution/grant/close contract is not exercised | `[I, S1]` |
| Stable execution identity, readback and close semantics | **No** | `[I]` `/http` is the contract that provides them |
| Durable usage accounting, budget enforcement | **No** | `[I]` Gateway accounts durable facts; a direct ingress is not accounted the same way |
| Native stream/settlement and cancellation protections | **Only inside native Gateway mode**; running the same fork through its ordinary ingress does not exercise them | `[I, S1]` |
| Model and provider compatibility | Same fork | `[I]` |

Recommendation: **do not** include a direct Sub2API arm in Stage A or B. It would add a third profile to a 24-run design, and its comparison value (does Gateway machinery change semantic outcomes?) is close to zero because the model payload is the same. Revisit only if a concrete question about Gateway-induced output differences appears.

### 6.4 Authorization, cost and what is verified

| Item | State |
| --- | --- |
| Existing ReviewRouter authorized test route | exists for ReviewRouter's own product flows; **reuse for a standalone experiment is not granted** (D1) |
| Standalone experiment authorization (profile/account set, policy, budget) | **not configured**; no account, pool or subscription was created |
| Model selection for either profile | **unresolved** (D2) |
| Gateway package availability | private `0.1.0`; consumable only as a vendored archive with provenance `[I]` |
| Token/unit cost in currency | **unresolved**: no authorized unit price; a subscription is metered by gateway units and rate limits, not free `[I, U]` |
| Live OCR binary built and qualified | **no** |
| Transport qualification | **no** (§10) |

Everything in the "verified" column of this document is source inspection, receipt inspection or model-free probe replay. Nothing is a live model evaluation.

## 7. Stage A run matrix

### 7.1 Matrix

4 candidates × 2 profiles × 3 independent repetitions = **24 review-run executions**: 12 managed OCR review sessions (Profile A) and 12 single `/llm` calls (Profile B).

| Block | Review runs |
| --- | --- |
| `S1-C1` × {A,B} × 3 | 6 |
| `S1-C2` × {A,B} × 3 | 6 |
| `S1-C3` × {A,B} × 3 | 6 |
| `S1-C4` × {A,B} × 3 | 6 |

### 7.2 Order and randomization

Execution order is randomized once, before the first run, from a recorded seed, with two constraints: the three repetitions of one candidate never run consecutively, and no profile runs all candidates in one sweep. The order and seed are committed with the run ledger before execution, so the sequence cannot be re-drawn after seeing results.

### 7.3 Anonymization

Each candidate is presented as `S1-FIX-<4 hex>` derived from `sha256(salt + candidateId)[0:4]`, with the salt sealed. Reviewers see that opaque ID, the PR description and the snapshot; they never see `C1..C4`, expected outcomes, criterion-to-candidate mapping, or other runs' outputs. The mapping file is opened only by the scorer.

### 7.4 Independence between runs

Each invocation is a fresh process and, for Profile B, a fresh execution with a new `taskId`/`attempt`. No conversation history, cached context, prior findings, or prior assessment is passed between runs. No reviewer sees a human-written reference explanation.

### 7.5 Per-run record (minimum)

`runId`, opaque candidate ID, profile ID, repetition index, seed, criteria revision and digest, candidate base/head tree IDs and digests, profile configuration (model, effort, limits, prompt digest), start/end timestamps, execution ID and request ID, raw output artifact path and digest, usage, diagnostics, completion state. The sealed truth is **not** part of this record.

### 7.6 Failure accounting

Attempted runs, completed runs, and abandoned runs are all reported. A run that fails for infrastructure reasons is retried **once** with a new attempt identity and both attempts stay in the ledger; a run whose dispatch status is ambiguous is never replayed (§14.4). Semantic outcomes are never "re-run to get a better one".

## 8. Conditional Stage B and its decision rule

Stage B adds **12 review-run executions** = 4 candidates × 3 repetitions, each a single `/llm` call, Profile B plus a recorded evidence bundle, same anonymization and order rules.

**Evidence bundle (recorded, not ingested live).** For each candidate, the artifacts the oracle already produced: producer identity, candidate snapshot digest, check definition digest, test scope, execution environment (runtime and fixture version), actual outcome, completeness, execution timestamp, artifact references, and the explicit criterion applicability mapping. A digest alone binds bytes and does not establish a trusted producer; a model statement that "tests passed" is never evidence; a genuine passing check establishes only the behaviour its approved oracle actually covers `[A/I]`.

**Pre-registered trigger.** Stage B proceeds if **any** of:

| Trigger | Condition | Hypothesis it addresses |
| --- | --- | --- |
| `B-1` | Stage A Profile B reports `inconclusive` on ≥ 8 of 60 criterion-observations for criteria that have an executed oracle | uncertainty is high where machine truth exists |
| `B-2` | Stage A Profile B reports a `violated` outcome on `C1` or `C2` that the sealed oracle marks satisfied | evidence could correct a false alarm |
| `B-3` | any criterion's outcome for a fixed candidate flips across the three repetitions | instability that evidence may reduce |

If none triggers, Stage B is **not** run, and the report records "recorded evidence not indicated by Stage A" instead of spending 12 invocations. This keeps the conditionality real rather than nominal.

**Success definition.** Evidence helps only if at least one criterion-observation moves to the oracle-correct outcome in ≥ 2 of 3 repetitions **and** no new `satisfied` appears on a criterion the oracle marks violated. A changed answer that is not more correct is recorded as "changed, not improved". Anchoring — the reviewer deferring to a green check that does not cover the criterion — is reported as harm, not benefit.

## 9. Control runs and total accounting

Three single-repetition control invocations, Profile B, reported separately and **excluded from the accuracy denominators** while remaining in the execution and cost totals.

| ID | Inputs | Hypothesis tested | Expected observation |
| --- | --- | --- | --- |
| `CT-1` | `S1-C1` snapshot + criteria revision `crit-v2` (AC-3 tightened to "revocation effective within 5 s") + the prior `crit-v1` assessment artifact | A meaningful criteria edit at the same HEAD invalidates the earlier assessment; the old result must not be presented as current | harness marks the prior result stale; the new assessment is bound to `crit-v2` |
| `CT-2` | `S1-C2` head snapshot + evidence produced for baseline `B0` where the revocation helper differed | Evidence bound to a different tree must not satisfy a criterion | evidence applicability `stale`; AC-3 not `satisfied` on evidence alone |
| `CT-3` | `S1-C1` snapshot + `crit-v1` removed and re-added with identical bytes as revision `crit-v3` | A new revision forces a fresh assessment; a cancelled or superseded result must not be resurrected | fresh assessment under `crit-v3`, outcome vector consistent with the Stage A `C1`/B runs |

Each control is one review run; it tests the *admission protocol plus model boundary*, not reviewer accuracy. If the Milestone 2 harness cannot represent "prior assessment artifact supplied with new criteria" (`CT-1`) or "evidence with mismatched tree identity" (`CT-2`), the control is recorded as a **contract gap** rather than deleted.

**Total accounting.**

| Category | Proposed | Executed |
| --- | --- | --- |
| Stage A | 24 | 0 |
| Stage B (conditional) | 12 | 0 |
| Controls | 3 | 0 |
| **Total review-run executions** | **39** | **0** |
| — of which managed OCR review sessions (Profile A) | 12 | 0 |
| — of which single `/llm` calls (Profile B, Stage B, controls) | 27 | 0 |
| Underlying model/API requests inside an OCR session | **not established** (may exceed one per session) | 0 |
| Capability qualification (separate) | not counted | 0 |

None of these review runs has been executed. A review run is the experimental unit; it is not the same thing as an underlying model/API request, and this plan can count the latter only for the 27 single-call executions. Capability qualification — transport checks, OCR build qualification, model admission checks — is accounted separately and is not part of the 39.

## 10. Model-free transport qualification proposal

Scope: one local harness plus a fake provider that emits native Responses SSE bytes, run under Node 24/26, without any real provider, credential or Gateway deployment. **Not implemented and not executed in this milestone.**

| ID | Case | Assertion |
| --- | --- | --- |
| `T1` | full-history multi-turn tool interaction (3 turns, one tool call round-trip) | each request body carries the complete prior history; no `previous_response_id` is sent |
| `T2` | stable request identity | the ID is persisted before dispatch and echoed by the readback; no run proceeds without it |
| `T3` | early EOF mid-stream | classified `partial`, never success; no fabricated terminal message |
| `T4` | cancellation | cancellation reaches the transport, the physical stream closes, and closure is recorded |
| `T5` | ambiguous dispatch (accepted, then closed before acknowledgement) | `effect_unknown`; readback attempted on the original identity; **no automatic replay** |
| `T6` | unresolved effects | preserved in the result as unresolved facts, not collapsed into failure or success |
| `T7` | close acknowledgement | execution closure recorded; pending cleanup surfaced when close is unacknowledged |
| `T8` | output-limit breach | classified `output_truncated`, not a semantic result |

**The 44 local architecture checks and the 14 upstream pure-function assertions are not evidence that this qualification passed** `[P]`. They exercised a synthetic in-process model and two extracted pure functions; neither touched a Gateway transport or an OCR binary.

**Smallest justified scope.** Run only `T1`, `T2`, `T5`, `T6` before a *OCR tool-loop* Profile B or any Stage B live-evidence route. If Milestone 2 stays on `/llm`, defer the whole set: `/llm` is a bounded single call whose own documented outcomes already distinguish truncation, invalid output and unknown effect `[I]`, so the transport qualification is not a prerequisite for Stage A. Qualification must not become a hidden second milestone.

## 11. Result and evidence contract

Minimal experimental record; a consumer contract, not a published schema.

| Field | Content |
| --- | --- |
| `candidate` | repository, base tree, head tree, snapshot digest, opaque fixture ID |
| `criteria` | revision, digest, complete expected `criterionIds[]` |
| `profile` | profile ID, model, reasoning effort, prompt/input digest, interface used (`/llm` or `/http`) |
| `assessments[]` | `criterionId`, `assessmentState` (`present`/`absent`), `outcome` (`satisfied`/`violated`/`inconclusive`), `evidenceRefs[]`, `explanation` |
| `coverage` | expected count, assessed count, missing, duplicate, invalid-ID counts |
| `execution` | `status` (`completed`/`partial`/`cancelled`/`failed`/`unknown`), attempt and request IDs, diagnostics, unresolved effects, cleanup state |
| `evidence[]` | producer, check definition, scope, environment, outcome, completeness, observed-at, applicability (`applicable`/`stale`/`unavailable`/`not_applicable`), provenance digest |
| `usage` | model calls, input/output tokens, observed model, requested model, gateway units, duration |

Three orthogonal dimensions, deliberately not flattened:

1. **Assessment** — `satisfied`, `violated`, `inconclusive`.
2. **Execution** — `completed`, `partial`, `cancelled`, `failed`, `unknown`.
3. **Applicability** — `applicable`, `stale`, `unavailable`, `invalid`, `not_applicable`.

A criterion may be demonstrably `violated` while another is `inconclusive` because its evidence is `unavailable`; both findings are preserved in the same record. **The verification component does not own final task acceptance** — that remains with Work Coordination under ADR-0072 `[A]`.

## 12. Criteria freshness and candidate identity

| Event | Consequence |
| --- | --- |
| Code change (new head) | new candidate identity; every prior assessment is historical |
| Same-HEAD criteria edit | new criteria revision; the previous assessment is stale even though the tree is unchanged |
| Criteria removal then re-addition | new revision with its own identity; a cancelled or superseded attempt is never resurrected |
| Bot-generated PR summary update | no new invocation; display-only change does not invalidate an assessment |
| Evidence reuse | permitted only when source, check definition, environment, scope and applicability still match |
| Stale reviewer result arriving late | bound to its original revision; presented as historical, never as current |
| Candidate changes during review | the earlier run's output is rejected; a new run is required |

Machine evidence may remain reusable across a criteria edit; **sufficiency for the new criterion set needs fresh assessment**. Three identities stay separate and are never aliased: the PR head commit, the synthetic merge commit (when a consumer builds one), and the runtime snapshot a reviewer actually inspected.

## 13. Metrics and denominators

### 13.1 Observation space

Per profile: 4 candidates × 5 criteria × 3 repetitions = **60 criterion-observations**, of which **54** are truth-`satisfied` and **6** are truth-`violated`. Both profiles: 120 observations. Review runs: 24 attempted.

These 60 observations are **clustered within four candidate snapshots** (5 criteria × 3 repetitions each). They are not 60 independent candidate samples, and no aggregate below should be read as if they were.

### 13.2 Formulas

| Metric | Formula | Denominator |
| --- | --- | --- |
| Detection rate (per profile) | observations with `outcome=violated` ∧ truth`satisfied=false` ∧ resolvable refs | 6 truth-violated observations |
| False-alarm rate | `outcome=violated` ∧ truth`satisfied=true` | 54 truth-satisfied observations |
| Miss rate | `outcome≠violated` ∧ truth`satisfied=false` (includes `inconclusive` and `absent`) | 6 |
| Justified satisfaction rate | `outcome=satisfied` ∧ truth`satisfied=true` ∧ every ref resolves in the sealed snapshot | 54 |
| Unjustified satisfaction count | `satisfied` with no resolvable ref, or `satisfied` on a truth-violated cell | reported as counts |
| Inconclusive rate | `outcome=inconclusive` | 60 |
| Coverage (per run) | distinct expected IDs assessed / 5 | mean, min, max over 12 runs |
| Missing / duplicate / invalid IDs | counts per run | 12 runs |
| Repeatability | cells (candidate, criterion, profile) whose 3 repetitions agree | 40 cells |
| Cross-profile agreement | cells where modal A = modal B | 40 cells (κ descriptive) |
| Execution reliability | completed / attempted | 24 runs, and 12 per profile |
| Duration | wall clock per run | median, range |
| Usage | model calls, input/output tokens, observed-vs-requested model mismatches | per run |
| Cost | gateway units summed; currency **unresolved** | per run and total |

### 13.3 Scoring rules that prevent flattering conclusions

- Profile A's silence produces `assessmentState=absent`, `outcome=inconclusive`, cause `no_assessment`. It is **never** counted as satisfaction, and A's justified-satisfaction is structurally 0.
- Detection requires a resolvable evidence reference. A `violated` verdict with no citation is unsupported and is reported separately.
- A profile whose coverage is complete but whose outcomes are ≥ 80% `inconclusive` is flagged "no usable assessment" and cannot be described as safe.
- Stage B is scored as improvement only against the sealed oracle, never against Stage A's own answers.

### 13.4 What this design cannot establish

With 24 review runs over one fixture, the effective independent sample is **four candidates in one task class**, and every rate above has a wide uncertainty range. Results are reported as counts and per-cell detail, with descriptive intervals only where useful and always labelled as such. **No statistical significance, no production-wide accuracy, and no ranking of models is claimed.** A `0/6` miss rate at n=6 is consistent with a large true miss rate.

## 14. Resource budgets and stopping conditions

### 14.1 Justified numerical limits

| Limit | Value | Basis |
| --- | --- | --- |
| Gateway units per `/llm` call | ~5 (execution 3 + prepare 1 + close 1) | `[I]` documented accounting |
| Known `/llm` executions only: Stage A Profile B / Stage B / controls | 12 + 12 + 3 = 27 single calls ≈ 135 units | arithmetic on the above; **excludes managed OCR usage entirely** |
| Managed OCR session usage (12 sessions) | **unmeasured; unresolved** | no OCR session has been executed, and its internal model-request count is not established |
| Share of default per-account limit (10,000 units ≈ 2,000 calls) | ≈ 1.4% | `[I]` documented defaults |
| Share of default consumer limit (100,000 units) | ≈ 0.14% | `[I]` |
| Request body | ≤ 1 MiB (fixture ≈ tens of KB) | `[I]` |
| Output per call | ≤ 8,000 tokens, well inside the 100,000 cap | plan choice within `[I]` |
| Deadline per call | ≤ 60 minutes (cap is 1 hour) | `[I]` + plan choice |
| Concurrency | 1 (strictly sequential) | plan choice: repetition independence, bounded side effects |
| Retries on infrastructure failure | at most 1 per run, new attempt identity, both recorded | plan choice |

### 14.2 Unresolved budget decisions

| Item | Why unresolved |
| --- | --- |
| OCR per-run token budget and subtask timeout | the engine accepts `--max-tokens-budget`/`--timeout`, but the authorized profile's approved values are an owner decision (D2) |
| Currency cost | no authorized unit price; subscription access is not free or unlimited `[U]` |
| Total spend ceiling in currency | depends on D1/D2 |
| Profile A's internal model call count and token usage | engine-owned; bounded only by the token budget; unmeasured, so no per-session figure is offered |
| Managed OCR gateway units | no OCR execution exists to measure them; the 135-unit estimate covers only the 27 `/llm` calls |

### 14.3 Retry versus reassessment

An execution retry repeats a dispatch after an infrastructure failure. A reassessment is a new semantic run with a new identity and is **not** a retry. They are never counted in the same bucket, and a failed execution never consumes a semantic repetition.

### 14.4 Ambiguous dispatch

An inference whose dispatch status is unknown is never automatically replayed under the original or a new identity. The run is closed as `unknown`, the unresolved effect is preserved, and the case is logged as `X-1`. This is a hard rule: the `/llm` contract explicitly marks a new attempt as possibly duplicating cost `[I]`.

### 14.5 Stopping conditions

| ID | Stop when |
| --- | --- |
| `S1` | infrastructure failure reaches 25% of attempted runs (6 of 24), or 2 consecutive runs fail for the same technical cause |
| `S2` | authorization, credential or policy error occurs — no retry, no workaround |
| `S3` | gateway usage attributable to the 27 `/llm` executions would exceed 6,000 units (about 44× the planned 135). This threshold does **not** bound managed OCR usage, which is unmeasured; OCR budget exhaustion is a separate owner decision (§14.2) |
| `S4` | the oracle disagrees with itself between the two pre-run executions on any candidate, or truth cannot be established for a criterion |
| `S5` | the sealed truth or anonymization map is exposed to a reviewer — the affected runs are void and re-planned |
| `S6` | the fixture or harness cannot represent a control input (`CT-1`/`CT-2`), which converts that control into a recorded contract gap |

## 15. Expected artifacts

| Artifact | Purpose |
| --- | --- |
| `truth-v1.json` (sealed, digested) | oracle output per candidate and criterion, with probe references |
| anonymization map (sealed) | opaque ID ↔ candidate |
| `runs.jsonl` | one record per attempt, including failures |
| raw reviewer outputs | unmodified responses, digested |
| `metrics.md` | the §13 tables with counts and denominators |
| `evidence-v1/` (Stage B only) | recorded evidence bundles with provenance |
| transport qualification report (§10) | future; counts as capability qualification, not as one of the 39 |
| `REPORT.md` | the milestone-2 result document, including everything not measured |

## 16. Risks, unknowns and dependencies

| ID | Risk / dependency | Current state |
| --- | --- | --- |
| R1 | No authorized model route for a standalone experiment | **blocking** (D1) |
| R2 | OCR inspected revision ≠ built revision (`6386895…` vs `8eb83340…`) | **open**; must close before Profile A is described precisely |
| R3 | Fixture repository not created; criteria text not yet owner-reviewed | planned for Milestone 2 |
| R4 | Full canonical Phase 0 report not available in the inspected source set; only a partial import is retained | revisitable if the owner supplies the complete report; nothing is reconstructed in the meantime |
| R5 | Four research inputs are unmerged drafts | nothing in them can be cited as an accepted decision |
| R6 | Provider schema enforcement is not guaranteed for every profile | consumer-side validation is mandatory; recorded per run |
| R7 | Criteria inventory would exceed the 8,000-character OCR background cap in any OCR-based profile | not triggered by the fixture; blocks reusing this design for long criteria |
| R8 | Anchoring: a green check may make a reviewer accept an uncovered criterion | measured as harm in Stage B, not assumed away |
| R9 | Fixture overfitting: one task class, five criteria | all conclusions scoped to the fixture |
| R10 | Model nondeterminism at n=3 | per-cell reporting; no smoothing |
| R11 | Windows host limitations for the Docs Protocol bootstrap | authority not initialized with the CLI; see §17 D7 |
| R12 | Reviewer prompt for Profile B is authored by the experimenter | prompt quality is a confounder; digest recorded, no tuning after first run |

## 17. Decisions requiring owner approval

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | Which authorized route may run the 27 `/llm` calls: the existing ReviewRouter test route, or a new experiment-scoped configuration | reuse the existing test route; no new account, pool or subscription |
| D2 | Model, reasoning effort, OCR token budget and subtask timeout, and a currency ceiling | one model for both profiles where the profile admits it; state any difference as a confounder |
| D3 | Confirm Profile B = `/llm` single call for Stage A (rather than an OCR tool loop) | confirm; it is the only route that can carry a complete inventory today |
| D4 | Approve the fixture repository, the five criteria and the four candidates | approve as written; edits invalidate `crit-v1` and require a new revision |
| D5 | Approve the sealed-truth procedure and the anonymization scheme | approve; a reviewer who sees truth voids the run |
| D6 | Approve the pre-registered Stage B trigger and the stop conditions | approve before execution, not after |
| D7 | Whether the repository should run the Docs Protocol CLI bootstrap (this milestone authored protocol-shaped Markdown without initializing the CLI authority) | decide in Milestone 2; the bootstrap is POSIX-first and was out of this milestone's scope |
| D8 | Licensing of this repository's research and planning documents and of the experiment results report. Already agreed: the original Phase 0 report is CC BY 4.0 with the agreed attribution, and Apache 2.0 covers original code, tests and tooling. Not yet agreed: the licence for the Markdown research documents and the results report | confirm the document/report licence explicitly; do not treat Apache 2.0 as covering Markdown by implication |

## 18. Recommended next milestone

**Milestone 2 — model-free experimental substrate.** Build and validate everything that cannot produce a false semantic claim, and stop before the first model call:

1. The fixture repository with `crit-v1` and the four candidates (§4).
2. The behavioral oracle, run twice per candidate, with `truth-v1.json` and its digest (§4.3).
3. The `/llm` Profile B harness with strict per-criterion admission, plus the Profile A build recipe from the pinned upstream and patch set (§3.3, §6.1).
4. The `runs.jsonl` ledger, anonymizer and scorer, exercised against a stub reviewer that returns fixed, deliberately wrong assessments — proving the scorer before any real output exists.
5. Resolution of D1–D3; otherwise stop.

Exit criteria for Milestone 2: the oracle reproduces itself, the scorer detects a planted false alarm and a planted miss, and Profile A's binary builds at the pinned revision. Only then does Stage A execution require a separate, explicit go-ahead with a spend ceiling.

## Sources

All source links use the pinned revisions in §3; documentation links can change independently.

- S1 [Task Verification architecture and routing follow-up, 2026-11-12](https://github.com/agent-teams-ai/engineering-research/blob/35d8084292c745e2e5ea097bd9b6f5524c6fe3e1/docs/studies/task-verification-architecture-and-routing-follow-up-2026-11-12.md)
- S2 [Five practical options, 2026-11-11](https://github.com/agent-teams-ai/engineering-research/blob/35d8084292c745e2e5ea097bd9b6f5524c6fe3e1/docs/studies/task-verification-five-practical-options-2026-11-11.md)
- S3 [Product and architecture vision, 2026-11-10](https://github.com/agent-teams-ai/engineering-research/blob/70c680af8b66369a2975a9db21ae081a94f62a5c/docs/studies/task-verification-vision-2026-11-10.md)
- S4 [Evaluation proposal, 2026-11-10](https://github.com/agent-teams-ai/engineering-research/blob/70c680af8b66369a2975a9db21ae081a94f62a5c/docs/studies/task-verification-evaluation-plan-2026-11-10.md)
- S5 [Model-free evidence bundle](https://github.com/agent-teams-ai/engineering-research/tree/35d8084292c745e2e5ea097bd9b6f5524c6fe3e1/evidence/experiments/task-verification-2026-11-12) — `manifest.json` records 44/0 local checks, 14 upstream assertions, 12 loopback requests, 0 model calls
- [OCR build recipe](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/tools/ocr/build.sh), [managed endpoint patch](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/tools/ocr/patches/0003-add-internal-llm-managed-endpoint.patch)
- [OCR managed run and admission](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/ocr-review-managed-run.ts), [invocation adapter and 8,000-character bound](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/ocr-review-invocation-adapter.ts), [Action runtime](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/codex-oauth/account-gateway-runtime.ts), [model transport](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/account-gateway-model-transport.ts)
- [Gateway SDK README](https://github.com/agent-teams-ai/account-gateway/blob/539418d5935a9e336d480b128a1cdb93c1daa6e1/packages/account-gateway/README.md) and [package exports](https://github.com/agent-teams-ai/account-gateway/blob/539418d5935a9e336d480b128a1cdb93c1daa6e1/packages/account-gateway/package.json)
- [Sub2API native public handler](https://github.com/agent-teams-ai/sub2api/blob/a19cbcbedda8eccbe82bb24224052a1e9eaab309/backend/internal/gatewaytransport/public.go), [wire validation](https://github.com/agent-teams-ai/sub2api/blob/a19cbcbedda8eccbe82bb24224052a1e9eaab309/backend/internal/gatewaytransport/wire.go), [Responses tests](https://github.com/agent-teams-ai/sub2api/blob/a19cbcbedda8eccbe82bb24224052a1e9eaab309/backend/internal/service/native_gateway_provider_responses_test.go), [lifetime tests](https://github.com/agent-teams-ai/sub2api/blob/a19cbcbedda8eccbe82bb24224052a1e9eaab309/backend/internal/service/native_gateway_lifetime_test.go)
- [ADR-0072](https://github.com/agent-teams-ai/agent-teams-orchestrator/blob/a34587b313e656eeb43d755b4a4f08c40dff2116/docs/decisions/0072-atomic-work-completion-evaluation.md) and [ADR-0027](https://github.com/agent-teams-ai/agent-teams-orchestrator/blob/a34587b313e656eeb43d755b4a4f08c40dff2116/docs/decisions/0027-temporal-as-run-orchestration-adapter.md)
- CI receipts: [native client and public ingress](https://github.com/agent-teams-ai/account-gateway/actions/runs/43011587978), [full-stack E2E and bounded load](https://github.com/agent-teams-ai/account-gateway/actions/runs/43011587806)

[Documentation map](../README.md)
