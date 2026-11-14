---
id: experiments.stage-a-b-plan-2026-11-12
type: research
status: active
owner: research/maintainers
summary: Proposed Stage A/B pilot with 36 maximum review slots, three model-free controls, four sealed candidates, a deterministic evidence baseline and explicit live-execution gates.
---

# Task Verification — Stage A/B Experiment Plan

**Recorded 2026-11-12 (Europe/Kiev); source identities re-verified 2026-11-13; owner-review revision 2026-11-14 (Europe/Kyiv).** Milestone 1 is a planning artifact. This repository contains no implemented verification kernel, harness or live transport qualification. **Zero experimental live reviewer/model calls have been made.**

This revision explicitly replaces the earlier, unexecuted proposal of 39 review runs with **24 Stage A review slots plus 12 conditional Stage B slots: at most 36 scheduled reviewer attempts, with no automatic harness inference retries**. These comprise 12 managed OCR sessions and 24 single `/llm` calls if Stage B proceeds. The three freshness/applicability controls move to the model-free substrate; they need no inference. Underlying model/API requests inside OCR remain separately counted and unmeasured for this experiment. Historical fake-provider OCR probes in S7 are separate compatibility evidence, not any of these planned review slots.

The revision incorporates the 2026-11-13 critical audit and exact managed-binary evidence (S6/S7), corrects the oracle/scorer and resource accounting, and defines a bounded model-free Milestone 2. It does not adopt a production architecture or authorize live spending. The owner confirmed the documentation/code licence split on 2026-11-14; D8 below records that agreement.

Source classes used below are marked inline as `[A]` accepted decision, `[I]` implemented source inspected by this milestone, `[T]` test inspected but not executed, `[P]` executed model-free probe, `[C]` existing CI receipt inspected, `[E]` experimental model evaluation, `[U]` unverified assumption. **No `[E]` item exists yet**; that absence is the reason for the experiment.

## 1. Executive summary

**Recommendation: build the model-free substrate, then run the bounded comparison after its live-execution gates are resolved. Treat the result as a capability pilot, not a production architecture decision.**

1. **Profile B uses one bounded `/llm` criteria assessment over supplied context.** The reason is its structured result contract. S7 exercised the exact managed OCR release and found that criterion data in assistant text, extra `task_done` arguments and extra comment fields did not survive the native result/parser path `[P]`. The 8,000-character OCR background limit is a separate input constraint; the five short criteria here do not inherently exceed it. Complete rendered input still needs checking (§5).
2. **Profile A remains ordinary managed OCR.** Both profiles receive the same task and criteria text. They differ in instructions, retrieval mechanism and output contract. This is a whole-profile comparison; it cannot isolate the causal effect of supplying criteria or of changing a prompt.
3. **Use four new candidate snapshots.** The earlier synthetic HTTP examples demonstrated their own behaviour, not reviewer quality. Preserve their history and use the fresh `S1-C*` namespace (§4.6).
4. **Establish a bounded behavioral oracle before model evaluation.** Freeze the criterion-to-check mapping, examine its adequacy and seal the labels. Repeating a test establishes repeatability, not that the test captures the entire requirement.
5. **Compare recorded evidence with a deterministic baseline.** Stage A tests a TV-O2-like reviewer; conditional Stage B tests the effect of supplying machine observations to that reviewer, including whether it adds anything beyond the same evidence without a model.
6. **Keep the implementation small and portable.** Criteria, candidate identity, evidence admission and result policy belong in a small in-process core. OCR, Gateway and repository access belong in consumer adapters. ReviewRouter remains the intended first consumer. Its consumer application owns authorization and advisory publication policy; its publisher does not decide terminal task acceptance. Work Coordination retains the terminal authority defined by ADR-0072. No service, workflow platform, automatic correction loop or additional critic is selected here.

### 1.1 Mapping to the researched options

| Planned component | Relation to TV-O1–TV-O5 | What it establishes |
| --- | --- | --- |
| Profile A: ordinary OCR | existing comparator; not itself one of the five verification architectures | ordinary finding detection, false findings and execution behaviour on this fixture |
| Stage A Profile B: single `/llm` | bounded TV-O2-like experiment | explicit criterion assessment over fully supplied application context; no retrieval qualification |
| Conditional Stage B: B plus recorded evidence | bounded test of the TV-O1 evidence mechanism | effect of supplying admitted observations; no live CI ingestion or evidence-platform qualification |
| Deterministic policy over the same Stage B packet | zero-model baseline supporting the TV-O1 decision | which criteria already resolve under the declared sufficiency policy |
| TV-O3: combined ordinary and criteria review | not selected or tested | requires a supported retained criterion-result channel and ordinary-review quality/cost comparison |
| TV-O4: selective executable probes; TV-O5: additional critic | deferred | only justified by a concrete residual failure and a separate bounded evaluation |

The four candidates are four implementations of one task, **not four architecture options**. Ordinary OCR detecting C4 would show that it can detect that defect; it would not establish TV-O3's output contract or prove that criteria are unnecessary, since both profiles receive them.

**Predeclared interpretation.** If B cannot support definite conclusions from static context, test whether admissible machine observations resolve them. If the deterministic baseline already resolves every criterion and the model adds no useful correctness, report that result and prefer the simpler evidence policy for this fixture. If the model introduces errors despite sufficient evidence, report harm. None of these outcomes alone selects a universal architecture.

**Limits.** One synthetic HTTP fixture, four candidate snapshots and five primarily machine-observable criteria can measure coverage, selected violation detection, false findings, repeatability and the effect of the defined evidence. It cannot establish broad semantic verification, arbitrary-repository accuracy, production reliability, retrieval scalability or statistical significance. The 60 potential criterion observations per profile are clustered within four snapshots, not 60 independent tasks.

## 2. Scope and decision questions

| ID | Decision question | Primary measure | Answered by |
| --- | --- | --- | --- |
| DQ1 | Does the criteria reviewer assess the complete expected inventory? | present, missing, duplicate and invalid-ID counts | Stage A B |
| DQ2 | Does either profile falsely allege a violation, including when correct behaviour is in unchanged code? | mapped false findings / false violated claims | Stage A |
| DQ3 | Does either profile detect the selected revocation and omitted-redaction defects? | supported detection on C3/C4 | Stage A |
| DQ4 | Can B support `satisfied`, rather than merely emit that label? | oracle agreement, reference validity and support scored separately | Stage A B |
| DQ5 | Do recorded observations improve B, and does B improve on deterministic policy over those same observations? | per-cell correctness and error changes against sealed truth and zero-model baseline | conditional Stage B |
| DQ6 | How often does execution fail, and what resources does it use? | completed/attempted, requests, tokens, duration and actual quota/cost; durable-fact capacity separately | both stages |

Milestone 1 changes documentation only. Milestone 2 implements the bounded model-free substrate in §18. Live evaluation requires separate recorded route/model/usage authorization. Production integration, package publication, a stable SDK, a reusable evidence platform, automatic correction, new accounts/subscriptions, changes to accepted ADRs, changes to the Phase 0 report and unrelated ReviewRouter/Gateway repairs remain out of scope.

## 3. Source baseline with pinned revisions

### 3.1 Research inputs and their merge state

| Source | Pin | State at observation |
| --- | --- | --- |
| S1 Architecture and routing follow-up (2026-11-12) | `agent-teams-ai/engineering-research@35d8084292c745e2e5ea097bd9b6f5524c6fe3e1` | PR **#6 open**, not on `main` |
| S2 Five practical options (2026-11-11) | same commit | PR **#6 open**; TV-O1–TV-O5 identities preserved unchanged here |
| S3 Product and architecture vision (2026-11-10) | `70c680af8b66369a2975a9db21ae081a94f62a5c` | PR **#5 open**, not on `main` |
| S4 Evaluation proposal (2026-11-10) | same commit | PR **#5 open** |
| S5 Retained model-free evidence bundle | `35d8084…/evidence/experiments/task-verification-2026-11-12/` | Present: `README.md`, `manifest.json`, `review-rerun.json`, `snapshot/` |
| S6 Critical architecture and evidence audit (2026-11-13) | `agent-teams-ai/engineering-research@fa207e0111cea294378c57a0561ee4bb15591166` | later PR **#6 draft revision**; refines S1/S2 |
| S7 Exact managed OCR evidence (2026-11-13) | same commit, `evidence/experiments/task-verification-2026-11-13/ocr/` | frozen binary/source compatibility receipts, zero real provider calls |
| Original Phase 0 report | — | full canonical report unavailable in the inspected source set; partial import retained |

Two consequences follow, and both are limits on this plan rather than defects to fix here. First, the research drafts are **not accepted architecture decisions**; they contain direction, source findings and separately scoped evidence. Second, the routing follow-up's links resolve inside PR branches, not `main`.

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

Reconciliation of the two SHA pairs: within each repository the two recorded commits resolve to the same tree, so "Gateway `539418d…` + native `a19cbcb…`" and "Gateway `784f355…` + native `38674a1…`" are the **same code pair**. This plan pins the requested pair (`539418d…` / `a19cbcb…`) for reproduction and records both identities so a reader cannot mistake one for different code.

### 3.3 Managed OCR identity and the later exact-build evidence

| Fact | Value | Class |
| --- | --- | --- |
| Upstream build input | `alibaba/open-code-review@8eb83340a487b1150af00701b94f01af97e4b4d6` (v1.13.1) | `[I]` build recipe |
| Managed release | `ocr-v1.13.1-rr.6`; binary reports `1.13.1-rr.6` | `[I/P, S7]` |
| Patch/build source | 12 managed patches at ReviewRouter Action `7a079c382d8e98b426ee90a6b3764be2a21b4c49`; recipe specifies `go1.26.10` | `[I]` |
| Published Linux/amd64 asset | 80,513,363 bytes; SHA-256 `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c` | `[P, S7]` |
| Native outcome schema | `reviewrouter.ocr-outcome/v1` | `[I/P]` |
| Local bridge requirement | explicit local credential and loopback host; inherited endpoint env and `api_key_cmd` rejected | `[I]` patch 0003 |
| Background bound | 8,000-character cap; S7's 8,001-ASCII-character input rejected before a provider request | `[I/P]` |

S1 inspected result structures at upstream `6386895e7cfac419bd7a9cf4795e8b824a6e3ced`, which differed from the build input. **S7 closes that source gap for its named native/parser behaviours** using the published managed release and exact Action parser modules: 10 managed review invocations, one version check, 14 loopback fake-provider POSTs and 9 parser assertions, with zero real provider calls. Criterion-ledger loss, unchanged-file reads and selected partial/cancellation behaviour are now executed compatibility findings, not merely assumptions about the older upstream snapshot.

S7 did not rebuild the Go binary or execute the complete Action/backend/Gateway route. It did not qualify model quality, live usage or every OCR feature. Milestone 2 should verify and reuse this exact released asset on one supported platform, then check uncovered consumer boundaries. A source rebuild is necessary only if build reproducibility or a changed binary becomes the question; it is not a prerequisite added by this plan.

### 3.4 Gateway SDK identity

`@agent-teams/account-gateway` is version `0.1.0` with `"private": true` and explicit server-only subpath exports: `.`, `./contracts`, `./http`, `./get-modular`, `./llm` `[I]`. Engines are `>=24.21.0 <25 || >=26.10.0 <27`. `private: true` prevents publishing this package to the registry; it does not prevent installing a local packed tarball. The documented handoff uses a built packed archive with provenance (source commit/tree, archive bytes, SHA-256, npm integrity, versions and passed gates) `[I]`. `/http` and `/llm` are **package entry points, not HTTP routes**, and both block browser resolution `[I]`.

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
| `[P]` executed model-free probe | S5's earlier checks; S7's exact managed-binary and parser receipts | only the exercised component and input; never reviewer semantic accuracy |
| `[C]` CI receipt | runs above | scoped technical qualification |
| `[E]` live model evaluation | **none** | — |
| `[U]` unverified assumption | standalone live route availability, actual model usage, untested integration behaviour | must stay labelled until closed |

### 3.7 Recorded limitations

- The full canonical Phase 0 report was not available in the source set inspected by this milestone. Only the partial imported copy was available: S1/S2 record a 57,524-byte import with SHA-256 `e5ca71d6e57bcf34103e0b80f28550553c365b43a357da05ab2019725ff5ddfd`; **this milestone did not re-verify that byte count or digest**, and no missing content was reconstructed. The limitation can be revisited if the owner supplies the complete canonical report; nothing here treats it as permanent.
- Claims inherited from S1 about Sub2API tests retain their inspected, unexecuted status. S7 separately supplies exact managed OCR observations; neither class becomes a live integration result.
- This planning revision made no model/provider call, new OCR execution, package publication or Gateway deployment. It cites prior S7 executions as prior work.

## 4. Four-candidate matrix and ground-truth procedure

### 4.1 Fixture

Keep fixture source and definitions in this experimental repository; do not create a second permanent fixture repository. Milestone 2 materializes disposable Git repositories containing only the selected application base/head pair. Use a small TypeScript HTTP service, one pinned supported Node environment and a JSON audit sink. Maintained tooling follows the organization's engineering standard, including strict TypeScript 7.0.2 or newer; no framework or service is required.

The complete **reviewer-visible application tree** should fit one bounded `/llm` request. Verify the rendered bytes and the selected model's context/output allowance before live registration (§6.2); the SDK's 1 MiB ceiling alone does not establish model fit. Oracle code, gold labels, candidate-class descriptions, scorer and other candidates stay outside that tree.

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

Every candidate is an immutable application base/head tree pair materialized from the frozen fixture definitions; branch names are not identities. Reviewer-visible history contains only the selected sanitized base/head pair, without other candidates, oracle files or revealing commit messages.

| ID | Snapshot pair | Provenance | AC-1 | AC-2 | AC-3 | AC-4 | AC-5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `S1-C1` | `base@B0` → `head@H1` | correct inline implementation written for this experiment | ✅ | ✅ | ✅ | ✅ | ✅ |
| `S1-C2` | `base@B0` → `head@H2` | correct alternative: route delegates to **unchanged** helpers in `B0` for token verification, revocation and audit | ✅ | ✅ | ✅ | ✅ | ✅ |
| `S1-C3` | `base@B0` → `head@H3` | behavioral violation: revocation lookup reads the revocation set but compares it to the wrong field, so revoked tokens pass | ✅ | ✅ | ❌ | ✅ | ✅ |
| `S1-C4` | `base@B1` → `head@H4` | omitted redaction: the changed route newly exposes `serializeProfile(user)` from an unchanged serializer that includes `role` | ✅ | ✅ | ✅ | ❌ | ✅ |

`B1` differs from `B0` only in the content of the unchanged serializer, which is why C2 and C4 cannot share one baseline. That difference is a stated confounder (§4.5), not an accident: the pair is designed to test whether a reviewer's readiness to read unchanged context is applied in both directions.

Both polarity directions are present: six expected violations (`C3/AC-3`, `C4/AC-4`, × 3 repetitions) and 54 expected satisfied observations per profile.

### 4.3 Behavioral oracle and sealed truth

The oracle is independent of reviewer outputs. If the same person authors the fixture and oracle, record that overlap; do not claim independently authored human ground truth or that repeating a test removes experimenter bias.

1. Freeze `crit-v1` text/digest and an explicit criterion/subclause-to-input/assertion mapping before building candidates. Write the oracle from the criteria, not from model responses.
2. Build the four candidates from the criteria; record any oracle/fixture author overlap. Do not tune the oracle to make the intended labels pass.
3. Review oracle adequacy against the full wording. Exercise deliberate wrong-caller, denial-field-leak and missing/duplicate-audit behaviours to show the checks discriminate those errors. These are model-free oracle controls, not new benchmark candidates.
4. Run each candidate in a fresh isolated process with fixed runtime/configuration. Reset the audit sink per request; freeze its observation/flush semantics. Capture requests, responses and audit deltas.
5. Run the oracle twice per candidate. Any disagreement or criterion/oracle ambiguity stops fixture sealing (S4). Repeatability alone does not establish adequacy.
6. Seal `truth-v1.json` with per-candidate/per-criterion labels, assertion references, scope and digests. Seal the anonymization map separately. Neither file nor its labels enter a reviewer-visible checkout or prompt.

**Oracle O-1: four HTTP requests per candidate per pass, with five criterion assertion groups.**

| Input / assertion group | Required observation | Criterion coverage |
| --- | --- | --- |
| `P-active-a` and `P-active-b`: distinct valid active tokens with distinct expected callers | 200; returned `id` and `email` equal the authenticated caller's expected values, not merely present | AC-1 |
| `P-missing`: no bearer token | 401; no profile fields (`id`, `email`, `role`, `internal`) | AC-2 |
| `P-revoked`: a token in the fixed revocation set | 401; no profile fields | AC-3 |
| Field scan of **all four** responses, including denial responses | no `role` or `internal` object keys anywhere in the parsed response body | AC-4 |
| Audit delta for `P-missing` | exactly one new audit record, with `event = "profile.access.denied"` and `reason = "missing_credential"` | AC-5 |

Freeze concrete token/user values, initial state, request bodies, parsing rules and audit observation timing in the oracle manifest. A setup error, timeout or unreadable artifact is unavailable evidence, not a demonstrated behavioral violation.

**Truth is bounded.** These checks and source review establish the approved pilot labels under the declared fixture/input policy. Finite examples do not prove AC-4's universal wording for every possible input. Preserve that wording and the coverage limit; do not silently narrow it to successful responses or let a model generate its own expected truth. Any unresolved mismatch between a criterion and its oracle needs an explicit criterion-owner decision before sealing.

### 4.4 Per-candidate detail

**`S1-C1` — correct inline implementation.** *Representativeness:* an ordinary correct PR on which a verifier might falsely demand rework. *Confounders:* small diff makes inspection easy for both profiles. *Falsifier:* a delivered A finding alleging failure of an approved criterion, or B's false `violated` claim, is a false allegation unless the oracle is wrong (S4). Unrelated findings require separate review (§13.3).

**`S1-C2` — correct alternative with behaviour in unchanged code.** *Representativeness:* the follow-up's own P2 motivation — a reviewer that demands one implementation style fabricates a defect when the required behaviour already lives in an unchanged helper. *Confounders:* shares `B0` with C1 and C3, so any cross-candidate contamination must be prevented by fresh processes (§7.4). *Falsifier:* a `violated` outcome that cites the absent inline code as missing behaviour.

**`S1-C3` — demonstrated behavioural violation with an independent oracle.** *Representativeness:* a security-relevant defect whose truth is established by executing a request, not by reading intent. *Confounders:* the diff is visible, so this measures detection rather than discovery; it does not measure whether a reviewer *would* have found it without a criteria list. *Falsifier:* a `violated` outcome with no resolvable evidence reference does not count as detection (§13).

**`S1-C4` — omitted redaction involving unchanged context.** The changed route must introduce or aggravate the exposure; a wholly pre-existing defect would not match ordinary review's contract. OCR can legitimately read the helper and report the causal defect at the changed callsite. This case tests use of unchanged context, not whether ordinary review is structurally unable to discover missing requirements. Retain stock assigned-path normalization: a raw comment dropped because it targets an unassigned helper is logged as a normalization loss, not delivered detection or proven reasoning failure. A criterion reviewer that explicitly cannot establish the serializer's behaviour remains inconclusive; it has not made a false accusation.

### 4.5 Confounders carried by the design as a whole

| Confounder | Effect | Handling |
| --- | --- | --- |
| `C2` and `C4` use different baselines (`B0` vs `B1`) | cross-candidate comparison is not a controlled pair | analysed within-candidate against truth; never compared C2-vs-C4 |
| One task class (HTTP authorization), 5 criteria | no generalisation to other task shapes | every result is scoped to this fixture, stated in the report |
| Criteria are all machine-observable | a sufficient evidence policy may already resolve the fixture without a model | compare that deterministic baseline in Stage B; do not generalize to semantic-only requirements |
| Fixture is intended to fit inline | B receives context directly; A still chooses what to read | qualify rendered fit, record actual reads, report whole-profile comparison; large-repository retrieval is unmeasured |
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

### 4.7 Non-semantic failures and partial records

Execution, evidence and applicability failures do not establish a semantic violation. Exercise these mappings with fixed stubs in Milestone 2; if they occur live, retain the actual attempt and cause.

| Scenario | Injected condition | Required representation |
| --- | --- | --- |
| `X-1` | dispatch has an unknown effect | execution/effect unknown; no admitted semantic conclusion from that attempt; preserve original identity, no inference replay |
| `X-2` | truncated output | contract/execution diagnostic `output_truncated`; no invented completed assessment |
| `X-3` | expected criterion ID missing | explicit absent/inconclusive entry for that ID; preserve other individually valid records; full inventory admission fails |
| `X-4` | unresolved evidence reference | retain the reported claim for error analysis; evidence admission fails and the affected admitted conclusion remains inconclusive |

A resolvable but irrelevant reference is a separate support failure (§13). Duplicate/conflicting IDs invalidate the affected criterion instead of choosing a favourable entry. Unknown IDs remain diagnostics and never enlarge or shrink the expected inventory. The SDK's output-failure path may not expose raw text; record that absence honestly (§5, §11).

## 5. Reviewer profile comparison

Both profiles use the same captured base/head application basis, criteria text, PR title and cleaned description. Verify the shared source inventory and change information in each profile's materialization, and the task/criteria text in its actual model input; identical available information does not require identical wire requests or identical file reads. For A, the pinned production runner combines the PR title and cleaned description into OCR background text `[I]`; the managed CLI has no separate PR-description channel.

### Profile A — Ordinary Code Review

| Property | Value / qualification |
| --- | --- |
| Binary | released managed OCR `1.13.1-rr.6`, exact asset/hash from §3.3; verify rather than require a new Go build |
| Native rules | ordinary review rules and finding contract unchanged; pin configuration and record its digest |
| Model/settings | admitted model, reasoning configuration, concurrency, timeout and engine token budget recorded; actual live values remain D2 |
| Materialized input | selected base/head pair, diff and bounded background containing the complete PR/criteria text |
| Input preflight | verify a known criteria marker and the complete rendered payload/digest at a fake provider; reject over-cap input, never silently truncate |
| Context | workspace includes unchanged application files; record actual tool reads |
| Finding scope | defects introduced/aggravated by this change; stock assigned-path normalization applies |
| Route | planned managed OCR → local bridge → Action transport/backend relay → Gateway → native fork; source exists, standalone reuse is not yet authorized/qualified |
| Output | ordinary native comments and consumer-normalized findings, not criterion verdicts |
| Admission | hard contract/identity/model-attribution failures reject admission; some partial/degraded outcomes retain usable findings plus quality flags |

S7 identifies a legacy `id/content` rule-shape mismatch in the **legacy-Skills/no-memory** source branch. Captured native `path/rule` entries and the memory-conversion branch differ. Do not silently repair production or change prompt methodology in this pilot; select and record the intended existing rule path and check that the actual input carries it.

Score the chosen consumer-visible normalized result as Profile A's delivered finding output. Keep native comments, skipped comments and partial flags separately so transport/normalization loss cannot be described as a model reasoning error. A valid finding at C4's changed route may cite the unchanged serializer. Partial execution is reported independently from the validity of any retained finding.

### Profile B — Criteria-Focused Verification

| Property | Value |
| --- | --- |
| Interface | `@agent-teams/account-gateway/llm` → `createLlmClient(...).generate(...)` |
| Shape | one bounded generation per planned invocation; record execution cleanup as closed or pending, not automatically successful |
| Input | complete captured `crit-v1` IDs/text; pinned base/head identities; the full head application tree including unchanged files; the complete base-to-head diff with deleted/renamed-path information and changed content; the same PR title and cleaned description as A; instruction to assess every expected ID |
| Requested output | `output: { mode: "json_schema", schema }` with `assessments: [{ criterionId, outcome, evidenceRefs, explanation }]` |
| Decode/admission | bounded structural parsing returns valid records plus diagnostics; inventory completeness, duplicate/unknown IDs and references are checked separately |
| Inventory authority | expected IDs come from the captured authored snapshot, never model output |
| Outcomes | `satisfied` / `violated` / `inconclusive`; presence, reported claim and admitted conclusion remain distinguishable |
| Retrieval | no tools, repository search, second turn or conversation state |
| Retry | no automatic harness inference retry; failed attempts remain in the ledger |

For this text-only fixture, the full head files plus the complete diff must retain enough information to reconstruct the declared base application tree. Verify that against its recorded identity before live registration. A bare head tree or a base commit ID without its content is insufficient for the declared shared-context comparison. Include the whole rendered bundle in the existing byte/model-context preflight (§6.2); no additional model turn is introduced.

**Decoder boundary.** At the pinned SDK revision, JSON parsing or a throwing `decode` produces `output_invalid`; `LlmFailure` exposes no raw `text`/`value`. Therefore a decoder that throws for a missing expected ID cannot also promise to preserve the other records. Use a bounded admission report for parseable data, preserving valid entries while marking the whole inventory incomplete. Syntax failures/truncation remain SDK failures; set `raw_unavailable` when the SDK supplies no bytes. A new raw-stream capture adapter is not required for this milestone. If schema normalization helpers are used, check their interaction with this boundary rather than assuming they preserve partial records.

Provider schema enforcement is not trusted. Local checks remain mandatory; SDK success, a complete criterion result and final product acceptance are three different facts.

### Fairness and interpretation

| Dimension | Shared basis | Difference that must remain visible |
| --- | --- | --- |
| Candidate/task | same frozen application trees and complete PR/criteria text | A gets background plus tools; B gets the application text inline |
| Available source | same application scope | A chooses reads; B receives it directly |
| Model | use the same admitted model/effort where supported | any mismatch is a confounder, not a prompt effect |
| Execution | separately bounded and logged | OCR can make multiple calls; B makes one |
| Output | compare supported detection and false allegations | A returns findings; B returns explicit criterion assessments |
| Limits | pre-registered request/time/token ceilings | engine budgets and provider output caps are not interchangeable |

A's silence means **no delivered finding**, not satisfaction or a criterion-level abstention. Satisfaction, criterion coverage and inconclusive-rate metrics apply to B; their A entries are not applicable. B's lack of tools and the model's actual use of supplied source are part of the whole-profile comparison. No comparison may present an output-contract difference alone as superior semantic accuracy.

## 6. OCR and Gateway routes and limits

### 6.1 Managed OCR tool loop

The inspected ReviewRouter path is managed OCR → local bridge → Action transport → backend relay → Account Gateway → native Sub2API `[I, S1]`. Reuse this integration where its consumer authorization and supported interfaces allow it; no ready-made standalone public OCR session client was found.

Before a live Profile A invocation, its trusted adapter must:

1. Resolve an authorized experiment profile/account policy.
2. Retain a bounded execution identity and persist a distinct stable request identity before each dispatch, keeping allowed tool turns within that execution.
3. Give the child only an explicit loopback capability. The trusted adapter owns Gateway credentials; inherited endpoints and `api_key_cmd` remain rejected.
4. Preserve protocol bytes and full tool history; observe actual model/terminal facts separately from requested configuration.
5. Enforce per-request output bounds, session request/token/time limits and cancellation. S7's observed wire omitted a Gateway request ID and provider `max_output_tokens` despite a CLI token setting; native CLI settings alone do not establish these guarantees.
6. Preserve ambiguous effects under the original identity, use applicable readback without inference replay, and record closed/pending cleanup. Timeout or a readback 404 does not prove that inference never occurred.

The low-level `/http` entry exposes execution/control operations and raw byte streams, not a completed OCR session abstraction. Full route qualification is a gate for **Profile A already**, not something to defer merely because B uses `/llm`.

### 6.2 Single-call criteria reviewer

`/llm` is a server-side **package entry point**, not a URL route. It fits B's shape when context is supplied in advance. Documented kernel ceilings are request body ≤ 1 MiB, output tokens ≤ 100,000, output bytes ≤ 8 MiB and deadline at most one hour ahead `[I]`. They are acceptance ceilings, not this experiment's budget or the model's context window.

Check the complete rendered request, including instructions/schema, against the byte limit; independently check input plus reserved output/reasoning against the chosen model/profile limits. Reject unsupported input before dispatch. Do not silently truncate criteria, source or evidence. Until D2 and this preflight are recorded, fit is a design expectation, not an executed fact.

The entry does not retrieve missing files, maintain a tool session, automatically retry/fail over, or expose streamed partial output to its caller. It reduces one response into a result and cleanup state. Some runtime claims may remain inconclusive from static context; this is legitimate and is precisely what recorded evidence can address.

### 6.3 Direct Sub2API

No direct Sub2API experimental arm is selected. Gateway is the consistency default. If a concrete later routing question justifies direct ingress, use the organization's pinned fork `a19cbcbedda8eccbe82bb24224052a1e9eaab309` and explicitly state which Gateway capabilities are omitted.

Ordinary native ingress does not exercise the Gateway execution/grant/request-readback/close contract or its durable-fact accounting. Using the same fork does not automatically exercise its Gateway-mode lifetime protections. Provider/native quota behaviour must be established on its own. Adding this route now would add an integration variable without answering the selected criterion-verification question.

### 6.4 Current authorization and evidence state

| Item | State |
| --- | --- |
| Gateway-first direction | selected for this revised plan |
| Existing ReviewRouter route | source integration exists; standalone experiment access is not inferred from that fact |
| Live connection/profile/account authority | unresolved before live execution (D1); no account or subscription created |
| Model, reasoning and actual quota/spend ceiling | unresolved before live execution (D2) |
| SDK distribution | private/unpublished package; local packed installation with provenance is supported |
| Published managed OCR asset | exact asset checked in S7; this experiment still needs its own identity/input-adapter checks |
| End-to-end live OCR/Gateway route | unqualified by this planning revision or S7 |
| Gateway durable-fact units | service storage/capacity accounting, **not tokens, a subscription allowance or currency** |
| Model-free Milestone 2 | needs no live credentials, selected model or spending authorization; live inference allowance is zero |

Source and fake-provider evidence do not establish live model quality or actual provider cost.

## 7. Stage A run matrix

### 7.1 Matrix

4 candidates × 2 profiles × 3 isolated repetitions = **24 scheduled review slots**: 12 managed OCR sessions and 12 single `/llm` generations. These are repeated observations of four chosen candidates, not 24 independent tasks.

| Block | Planned slots |
| --- | --- |
| `S1-C1` × {A,B} × 3 | 6 |
| `S1-C2` × {A,B} × 3 | 6 |
| `S1-C3` × {A,B} × 3 | 6 |
| `S1-C4` × {A,B} × 3 | 6 |

### 7.2 Order

Generate and freeze an order from a recorded seed before the first live slot. Do not place all three repetitions of one candidate consecutively or all candidates of one profile in a single sweep. Do not redraw the order after seeing results.

### 7.3 Anonymization and sealing

Present candidates as `S1-FIX-<12 hex>` from a salted digest; reject collisions. Keep salt/mapping and gold labels outside reviewer-visible prompts, files, Git history and tool reach. The materialized repository contains only the selected application base/head pair with sanitized messages; no other branches, fixture labels, reference answers or oracle source. A public plan is not a reviewer input.

**Public reproducibility artifacts.** Keep the synthetic fixture definitions, canonical truth, anonymization map, salt and version manifest in this public experimental repository. No private repository, GitHub Secrets or private-storage provisioning gate is required for this pilot. Freeze their identities before evaluation. "Sealed" means frozen and excluded from the evaluated reviewer's supplied context and actual tool reach; it does not imply confidential storage. The salt provides neutral candidate IDs within that context and is reproducibility data, not a credential.

Sealing is an access/materialization property, not just hashing a file. Retain an auditable reviewer-visible file inventory and input digest. In the existing model-free qualification, verify that input assembly and enabled reviewer tools exclude the parent experiment checkout/history and retrieval of public reference artifacts, including via external URLs. For `/llm`, check the assembled input; for managed OCR, check its actual file/tool boundary with the fake provider. The deterministic baseline consumes only observations and the frozen sufficiency policy; the scorer joins gold labels after assessment outputs are fixed.

This is an openly specified pilot with controlled reviewer inputs. The candidate classes and intended labels are already public in §4.2; it does not establish that these tasks are previously unseen by a model or unaffected by public benchmark exposure.

### 7.4 Isolation

Each invocation starts with fresh process/workspace/session state and a fresh experiment attempt identity. No prior verdict, explanation, tool output or other candidate's history is supplied. This prevents intentional cross-run contamination; it does not make repeated trials statistically independent tasks or prove provider-cache isolation.

### 7.5 Minimum ledger

Record slot/run/attempt IDs, opaque candidate ID, profile, repetition, seed, subject and criterion inventories, candidate base/head and runtime snapshot identities, criteria/policy revision, prompt/input digest, requested and observed model, reasoning/configuration, timestamps, execution/request identities, available raw artifact refs/digests or explicit unavailability, usage, diagnostics, admission/completion and cleanup states. Record every OCR dispatch, not just its enclosing session. Gold labels are joined only by the scorer.

### 7.6 Failure accounting

Each started scheduled slot consumes its repetition, including technical failure. **No automatic harness inference retry.** Record attempted, completed, failed/unknown and unstarted slots separately; never silently replace a failed attempt with a successful one. A later rerun requires a separately recorded/budgeted batch.

OCR's internal tool turns are requests within one slot, not extra successful repetitions. Record all such requests and any engine retry behaviour; bound them in its adapter. The absence of retries in S7's two failure fixtures is not a universal guarantee about all native behaviours. Readback/cleanup operations do not authorize a fresh inference.

## 8. Conditional Stage B and deterministic baseline

Stage B adds **12 scheduled slots** = the same 4 candidates × 3 isolated repetitions, each B with a recorded evidence packet. Use fresh contexts without Stage A answers, the same frozen prompt except for its evidence input, and the same anonymization/order rules. If B proceeds, include all four candidates, not only cases that previously failed.

**Evidence packet.** Include producer identity, candidate/runtime snapshot, check-definition digest, inputs/scope, environment, observed outcome, completeness, observation time, artifact refs and the frozen criterion-to-check applicability/sufficiency mapping. Include factual observations, not the sealed gold-label table, candidate classes or reference explanations. A digest binds bytes, not producer trust or semantic coverage. A setup failure or generic green CI badge does not prove a criterion.

**Zero-model baseline.** Score the identical packet deterministically under the predeclared policy. An applicable observed violation of a required-behaviour assertion establishes that violation. A complete sufficient set of passing observations supports satisfaction only within the declared coverage. Missing, stale, inapplicable or technically failed required evidence leaves the affected criterion unresolved. This adds no model calls. All five criteria may resolve this way; that is a useful result.

**Pre-registered trigger.** Subject to working adapters and live limits, proceed if any of these occurs in Stage A B:

| Trigger | Condition |
| --- | --- |
| `B-1` | an inconclusive/absent assessment, or a definite claim that fails the §13 reference/support checks, for which the predefined packet contains sufficient applicable observations |
| `B-2` | a reported `violated` claim on any truth-satisfied criterion |
| `B-3` | a candidate/criterion's reported outcome varies across repetitions |
| `B-4` | a reported false `satisfied` or a known violation not detected |

A consistently all-satisfied reviewer triggers B-4; stability alone is not safety. Stable oracle-correct labels with resolvable but irrelevant references trigger B-1 when the predefined evidence is sufficient: label agreement cannot conceal missing support. Technical failures are retained separately and are not evidence that supplying facts fixes a broken route. Resolve systemic capability problems before conducting a semantic comparison; any protocol/configuration change requires a newly recorded experiment revision.

If no trigger occurs, skip B and report that the conditional rule was not met. This does not establish that machine evidence is generally unnecessary.

**Interpretation rule.** A correct-definite result is an **admitted, supported and oracle-correct** conclusion under §13, not merely a matching label. Report all per-candidate/per-criterion changes in correct definite answers, false satisfaction, false violation, inconclusive and unavailable outcomes. A positive pilot signal requires at least one cell to increase its correct-definite count and be correct in at least 2 of 3 B repetitions, a net increase in correct-definite outcomes overall, and no increase in false satisfaction or false alarms. At least one improvement must come from a substantive prior assessment, not merely recovery from an operational failure. Apply this aggregate rule only after both compared slot matrices have been fully attempted; after an early stop, report partial counts without declaring an aggregate benefit. Otherwise describe the result as mixed, unchanged or harmful. Show correct-to-wrong and correct-to-inconclusive changes even if an aggregate improves; these are descriptive comparisons of repeated trials, not causal proof or statistical significance.

Separately compare B with the deterministic baseline. Improvements already implied by that baseline are benefits of evidence availability, not demonstrated incremental value of a model. A model that replaces a sufficient machine-supported conclusion with a wrong claim causes harm.

## 9. Model-free controls and total accounting

CT-1–CT-3 are deterministic consumer-admission controls in Milestone 2. Use fixed valid, stale and delayed assessment stubs; no model decides freshness or candidate binding.

| ID | Inputs | Required observation |
| --- | --- | --- |
| `CT-1` | same C1 head, criteria edit from `crit-v1` to `crit-v2` (e.g. AC-3 adds a timing obligation), delayed old assessment | old result remains bound to v1 and cannot become current; new result needs the new revision and sufficient coverage |
| `CT-2` | C2 head plus evidence from an explicitly different snapshot | candidate mismatch makes evidence stale/inapplicable; it cannot satisfy AC-3 for the current snapshot |
| `CT-3` | criteria removed, then identical bytes re-added as `crit-v3`; delayed cancelled/superseded result | new revision/attempt identity; old result is never resurrected; a valid new stub can be admitted only for v3 |

Record before/after identities and the admission decision. Do not require CT-3 to reproduce a stochastic model outcome vector. A missing representation is a contract gap, not a reason to delete the control. These checks do not qualify production publication, actual Gateway recovery or whether a real model would be misled by stale facts.

**Revised accounting.**

| Category | Proposed maximum | Executed by this experiment |
| --- | --- | --- |
| Stage A review slots | 24 | 0 |
| Stage B review slots (conditional) | 12 | 0 |
| **Scheduled live reviewer attempts** | **36** | **0** |
| — managed OCR sessions | 12 | 0 |
| — single `/llm` generations | 24 | 0 |
| Model-free CT-1–CT-3 scenarios | 3 | 0 |
| Deterministic Stage B baseline | same four packets; no inference | 0 |
| Underlying OCR model/API requests | unknown; separately capped and metered | 0 |
| Capability qualification | separate receipts and resource ledger | 0 new executions here |

The original **39 = 24 + 12 + 3** proposal and S6's historical envelope were never executed; this owner-review revision deliberately moves the last three out of live inference. A slot is a scheduled reviewer attempt, not a model HTTP request. At most 24 single-call requests are counted directly; OCR requests and any separately authorized live qualification must be counted in addition. No retry/replacement is hidden inside the 36.

## 10. Model-free adapter qualification

Milestone 2 checks the actual experimental consumer boundaries with fixed responses, injected SDK control/execution ports and a loopback fake Responses provider. No real provider, credentials or Gateway deployment is required. Existing S7 receipts may be reused only for their exact versions and scope; record which gaps the new harness checks. Nothing in this section has been implemented by this planning revision.

| Case | Required check | Evidence boundary |
| --- | --- | --- |
| Shared input and A artifact identity | compare base/head identities, source inventory, complete diff, PR title, cleaned description and criteria digest across both materializations; verify B's head-plus-diff reconstructs the base; verify A's exact release/hash/configuration and complete background/rule input at the fake provider | checks the common basis and each materializer's delivery; actual file reads and model attention remain profile-dependent |
| A result path | normal completion, unchanged-file tool read and representative partial/cancel result; distinguish raw, normalized and skipped findings | reuse S7 where applicable; check the chosen consumer adapter's missing boundary |
| B success and partial inventory | exact packed SDK with injected ports; valid result/receipt; missing, duplicate and unknown IDs preserve diagnostics and individually usable entries | SDK success is distinct from complete inventory admission |
| B failures | malformed JSON, truncation, refusal, unknown effect and pending cleanup retain their actual SDK outcomes; missing raw text is explicit | no invented raw artifact or semantic verdict |
| Request identity and limits | adapter stores identity before dispatch; records all requests, configured caps and cancellation; no automatic inference replay | a fake readback tests mapping, not live durable custody |
| Freshness/evidence admission | CT-1–CT-3; stale, missing and unsupported references cannot become current sufficient evidence | deterministic consumer policy, not production publisher E2E |

The earlier 44 local checks and 14 pure-function assertions (S5) did not touch an OCR binary or Gateway. S7 did exercise the exact binary, but neither set qualifies the entire backend/Gateway route. Keep those scopes separate.

**Before live A:** qualify the chosen OCR route's authorization, per-request identity/caps, observed-model attribution, cancellation, readback and cleanup. **Before live B:** qualify its authorized SDK configuration and receipt/cleanup handling. Test consumer mappings offline first; record any required live qualification separately with its own authorized usage. Do not defer A's tool-loop requirements just because B is single-call, and do not turn offline port checks into a claim that production Gateway recovery has passed.

## 11. Result and evidence contract

Minimal experimental record; not a published SDK schema or a new product-wide kernel.

| Field | Content |
| --- | --- |
| `subject` | one fixture task and the independently captured expected subject inventory |
| `candidate` | repository/materialization identity, base/head trees, runtime snapshot digest, opaque fixture ID |
| `criteria` | authored revision/text digest, complete expected IDs, criterion-to-check mapping/policy version |
| `profile` | profile/config/prompt/input identities, requested and observed model, reasoning setting, adapter entry used |
| `assessments` (B) | expected criterion, present/absent, original reported claim, admitted `satisfied/violated/inconclusive` conclusion, references and explanation |
| `findings` (A) | native comments, consumer-visible normalized findings, skipped reasons and quality flags; no invented criterion verdicts |
| `coverage` (B) | expected/present/valid counts and missing/duplicate/unknown/invalid diagnostics; whole-result admission status |
| `execution` | completed/partial/cancelled/failed/unknown, attempt/request identities, SDK effect/code, diagnostics, unresolved effects and cleanup |
| `rawArtifacts` | available text/bytes and digests, or explicit `raw_unavailable` plus cause; no claim of raw SDK failure text |
| `evidence` | producer, candidate binding, check definition, input/scope/environment, observed outcome, completeness, time, refs, applicability and provenance |
| `usage` | actual requests, input/output/reasoning/cache tokens where exposed, duration, actual quota/currency if available; unknown values stay unknown |
| `capacity` | Gateway durable-fact occupancy/retention separately from inference usage |
| `scoring` | oracle agreement, reference resolution and semantic support as separate judgments; scorer version/diagnostics |

Three dimensions stay separate: **assessment**, **execution**, and **evidence applicability** (applicable/stale/unavailable/invalid/not-applicable). Partial execution does not invent a semantic violation; a supported violation of one criterion does not establish anything about the rest. An unresolved or invalid reference must not erase a reported false satisfaction from the evaluation ledger.

Verification provides evidence and assessments. **The consuming product owns acceptance/publication; Work Coordination remains the sole terminal work-completion authority under ADR-0072** `[A]`. No experiment result bypasses those boundaries.

## 12. Criteria freshness and candidate identity

| Event | Consequence |
| --- | --- |
| Code change / new head | new candidate identity; previous assessment remains historical |
| Same-head meaningful criteria edit | new criteria revision; previous assessment is stale even if code is unchanged |
| Criteria removal then re-addition | new revision identity; cancelled/superseded results cannot revive |
| Bot-generated display-only summary update | no new invocation if the captured authored criteria/input basis is unchanged |
| Evidence reuse | requires matching producer, candidate, check, environment and scope; re-evaluate sufficiency for the current criteria |
| Late reviewer result | bound to its original revision; never published as current merely because it finished last |
| Candidate changes during review | retain old result historically; a current conclusion needs the current basis |

Machine observations may remain reusable across a criteria edit, but sufficiency for the new criterion set must be reassessed. That reassessment can be deterministic; it need not always launch a model. PR head commit, synthetic merge commit (where a consumer uses one) and inspected runtime snapshot remain separate identities.

## 13. Metrics, support and denominators

### 13.1 Observation space

If all planned slots start, each profile has 4 candidates × 5 criteria × 3 repetitions = **60 matched detection opportunities**: 54 truth-satisfied and 6 truth-violated. Only B supplies criterion-level verdicts. Stage A has 24 planned slots, not 24 already attempted executions.

For an early stop, report planned, started, completed and unstarted counts explicitly. A started failed slot remains in operational and attempted-detection accounting; it is not silently replaced or described as a semantic model judgment. Give completed-only metrics as a clearly labelled secondary view.

The four snapshots are hand-selected cases from one fixture; the two negative cases give only six repeated negative trial opportunities. Repetition does not create independent requirements or tasks. Do not compute population confidence or significance from these counts as if they were an independent random sample.

### 13.2 Predeclared measures

| Measure | Rule / denominator |
| --- | --- |
| Supported detection (both profiles) | delivered supported finding (A) / supported violated conclusion (B) on a known violation; up to 6 planned negative opportunities per profile |
| Known violation not detected | all other started negative opportunities, with absent, unsupported and technical causes shown separately |
| False allegation (both) | any delivered finding mapped to a truth-satisfied criterion (A) / parseable reported false `violated` claim (B); up to 54 planned positive opportunities |
| False satisfaction (B) | any parseable reported `satisfied` claim on a truth-violated criterion; up to 6 negative opportunities; reference rejection does not hide it |
| Oracle-agreeing satisfaction (B) | reported `satisfied` on truth-satisfied criteria; up to 54 positive opportunities |
| Reference-valid satisfaction (B) | above plus nonempty references, every cited reference resolving to the declared snapshot/artifact |
| Supported satisfaction (B) | above plus the predeclared support rubric establishing the complete criterion/subclauses under the bounded policy |
| Unsupported claims (B) | empty, missing, invalid or irrelevant references; record original polarity and cause |
| Inconclusive/absent (B) | separate counts over expected IDs of started slots; include cause, do not conflate with explicit satisfaction |
| Coverage (B) | expected/present/individually valid IDs per slot, plus whole-inventory admission and diagnostics |
| Repeatability | 20 candidate/criterion cells per profile: A's delivered detection state, B's outcome/admission state; report the three observations |
| Cross-profile comparison | 20 matched candidate/criterion pairs with detection/false-finding counts; no modal-outcome κ between different output contracts |
| Execution reliability | completed/started, by profile; admission and pending cleanup shown separately |
| Resources | actual request counts, tokens, duration, observed-model mismatches and actual quota/cost; durable capacity separately |

Use one criterion observation per slot for the primary criterion measures. Multiple findings for one criterion are not extra independent samples. Duplicate/conflicting B records remain contract failures; retain any reported false claims in diagnostics rather than selecting the favourable value. Unparseable outputs have unknown semantic content, not assumed-correct labels.

### 13.3 Scorer and reference support

**A finding-to-criterion mapping must be fixed before trials.** It maps the asserted behaviour, not just a matching filename. Review ambiguous mappings without seeing profile/repetition labels where feasible. Retain unmapped findings separately: a real unrelated bug is not a false alarm solely because the five criteria do not describe it. Report out-of-scope findings and ordinary-review validity separately from the five-criterion comparison.

**Reference existence is not support.** A real file path can be irrelevant to a conclusion. Freeze a small rubric that checks the claimed behaviour, applicable source/observation and coverage of every required subclause. A blinded human review of this tiny output set is sufficient; no second LLM grader is selected. Record ambiguous support/scorer disputes rather than awarding an automatic positive.

A silence is no finding, not a B-style `inconclusive` verdict; A's satisfaction/criterion-coverage measures are **not applicable**. B with a complete inventory but at least 80% inconclusive outcomes is flagged as yielding few usable assessments; this is not evidence of safety.

Exercise the scorer offline with: correct label plus irrelevant existing reference; empty references; false satisfaction; false violation; missing/duplicate/unknown IDs; valid partial records; an out-of-scope genuine finding; and failed/unknown execution. Distinguish reviewer failure from scorer failure. Freeze the scorer/rubric before live runs and log any later correction with recomputation of the full affected set.

## 14. Resource limits and stopping conditions

### 14.1 Counts, capacity and inference usage

| Quantity | Meaning / limit |
| --- | --- |
| Model-free Milestone 2 | **0 live inference calls**, no live model spending |
| Planned live review slots | 24 Stage A + 12 conditional Stage B = at most 36 started attempts |
| Single-call B requests | 12 + 12 = at most 24, excluding separately authorized qualification |
| OCR sessions | 12; underlying request/token use unknown for this experiment and separately bounded |
| Automatic harness inference retries | 0; any later rerun is a separately recorded and budgeted batch |
| Concurrency | 1 for this pilot |
| Gateway durable-fact estimate | SDK README: execution 3 + prepare 1 + close 1, about 5 retained units per call under its request-retention assumptions; about 120 for 24 calls |
| Retained request facts | request unit releases only when `requestReadbackRetentionMs` is configured; transient/retained requests and other operations add occupancy |
| Capacity gate | check actual configured service/consumer/account headroom and retention; default capacity numbers are not a subscription or money budget |
| Input/output | request bytes and model context validated separately; no silent truncation |
| Proposed B output ceiling | at most 8,000 output tokens, subject to model/reasoning compatibility and a lower approved limit if needed |
| Deadline | finite predeclared per-call/session limits; SDK ceiling of one hour is not the recommended duration |

The approximate 120 units are **durable storage accounting**, not 120 inference credits or a currency estimate. There is no justified conversion from these units to dollars, tokens or subscription entitlement. The former 6,000-unit spending stop is removed. OCR's engine token budget is not proof of a provider output cap; the trusted adapter must establish the actual per-request/session limits.

### 14.2 Values required before any live execution

Record the authorized connection/profile/account, admitted model and reasoning, context allowance, provider output cap, OCR request/session token caps, deadlines, total request/token or actual subscription-quota limit, and an acceptable currency ceiling where charges can accrue. Include separately budgeted live qualification, any partial/unknown dispatch and pending usage readback. If currency is not directly metered, state that and enforce explicit request/token/quota limits; do not declare access free or unlimited.

Use the same model/effort for A and B where admitted and record any unavoidable difference. These live values are D1/D2 gates; their absence does not block completion of the model-free substrate.

### 14.3 Attempts and ambiguous effects

A failed started slot consumes its repetition and remains in the ledger. Never rerun a semantic result until a preferred answer appears. No automatic inference replay follows an ambiguous dispatch under either the original or a fresh identity. Preserve original effect/usage facts, perform applicable non-inference readback/cleanup and record unknown/pending state. SDK retry advice is information, not permission to spend.

### 14.4 Stops

| ID | Stop when |
| --- | --- |
| `S1` | 6 operationally failed/unknown Stage A slots, 3 such Stage B slots, or 2 consecutive slots fail for the same technical cause; stop earlier for a systemic contract/capability defect |
| `S2` | authorization/credential/policy error; no workaround or inference retry |
| `S3` | the next dispatch cannot fit the approved live request/token/quota/currency/time cap, or usage uncertainty prevents proving headroom; capacity exhaustion is an additional technical stop |
| `S4` | oracle repeatability fails, a criterion lacks a defensible oracle mapping, or fixture/gold/scorer inconsistency is discovered |
| `S5` | gold labels, candidate map or another run's answers reach a reviewer; affected observations become invalid and need a separately recorded plan |
| `S6` | the harness cannot represent a required identity/control or violates expected-inventory/freshness admission; record the contract gap before live execution |

Missing criteria, a single invalid output or ordinary model disagreement is recorded under the frozen scoring policy; it is not silently repaired with another call. Any stop reports unstarted slots separately.

## 15. Expected artifacts

| Artifact | Purpose / milestone |
| --- | --- |
| Frozen criteria, candidate application trees and oracle manifest | scope, input/assertion mapping and bounded sufficiency policy; Milestone 2 |
| `truth-v1.json`, anonymization map, salt and version manifest | public, versioned reference artifacts; frozen and excluded from reviewer inputs/tool reach |
| Reviewer-visible input inventories and prompt/config manifests | prove supplied context and isolation; live D1/D2 values frozen before live registration |
| `runs.jsonl` | every started attempt, including failures/unknown effects; stub runs explicitly labelled |
| Raw/normalized outputs | available bytes/text, digests and skipped diagnostics; explicit raw-unavailable state |
| `evidence-v1/` | factual recorded packets without the gold-label table; deterministic baseline uses exactly these packets |
| Scorer/rubric and offline receipts | planted-error discrimination, support checks, CT-1–CT-3 and same-packet baseline |
| Adapter qualification report | exact SDK/OCR identities, reused S7 receipts, new checks and unqualified live boundaries |
| Model-free substrate report | Milestone 2 deliverables, limits and readiness for live authorization |
| Later `metrics.md` and experiment report | live counts/results only after separately authorized execution; no stub result presented as model accuracy |

Do not commit credentials or compiled OCR assets. Retain the synthetic reference artifacts publicly for reproducibility, outside every reviewer-visible materialization and its tool reach (§7.3).

## 16. Risks and remaining dependencies

| ID | Risk / dependency | State and treatment |
| --- | --- | --- |
| R1 | Standalone live route/model/budget not authorized | blocks live calls only; D1/D2 |
| R2 | Historical inspected OCR revision differed from build input | S7 closes named binary/parser behaviours; complete consumer/backend route still unqualified |
| R3 | Fixture/oracle/scorer not implemented or sealed | model-free Milestone 2; adequacy review before labels are accepted |
| R4 | Full canonical Phase 0 report unavailable in inspected sources | revisitable if supplied; retain partial-import limitation without reconstruction |
| R5 | Research drafts are not accepted architecture decisions | use them as direction/evidence with their stated scope |
| R6 | Provider schema enforcement and SDK failure artifacts differ | mandatory consumer admission; preserve partial records and explicit raw unavailability |
| R7 | OCR background and model context have distinct bounds | test actual rendered input; short criteria can fit, arbitrary large inventories are unqualified |
| R8 | A model may misread sufficient evidence or accept an uncovered claim | deterministic same-packet baseline and explicit support/error metrics |
| R9 | Tiny fully machine-observable fixture | no broad semantic, retrieval or production claims |
| R10 | Repetitions are correlated within four selected candidates | per-cell counts; no statistical-significance claim |
| R11 | Docs Protocol/tooling authority not bootstrapped here | routine model-free Milestone 2 setup in a supported environment, following the org standard |
| R12 | Experimenter-authored prompt/oracle and candidate knowledge | record authorship overlap, seal labels, freeze rubric/prompt and review adequacy |
| R13 | Consumer normalization can drop a native finding | retain raw/skipped diagnostics; score delivered profile result and identify the lost boundary |

## 17. Decisions and their status after owner review

Technical choices below resolve the plan for the next model-free work; they do not authorize live calls or a production implementation. D8 separately records the owner's confirmed licence decision.

| ID | Decision | Status / selected direction |
| --- | --- | --- |
| D1 | Execution route | **Gateway-first selected.** Reuse supported ReviewRouter integration for A and the packed SDK for B. Actual standalone consumer/profile permission remains required before live use; no new account/pool/subscription selected |
| D2 | Model, reasoning, request/token/time/quota/currency limits | **Milestone 2: zero live calls.** Concrete live configuration remains an owner decision before qualification/evaluation, not a substrate prerequisite |
| D3 | B interface | **Selected:** one `/llm` assessment over supplied context; supported structured output is the reason, not a claim that the short criteria cannot fit OCR |
| D4 | Fixture and candidates | **Selected for this pilot:** four snapshots, five authored criteria, fixtures in this repository. Freeze inputs/oracle mapping in Milestone 2; bring back any substantive criterion ambiguity rather than quietly editing it |
| D5 | Truth and anonymization | **Selected:** reviewed bounded oracle; public, frozen truth/map/salt and version manifest; sanitized reviewer materialization with enforced input/tool boundaries and explicit overlap/coverage limits (§7.3). No private-storage prerequisite |
| D6 | Stage B and stops | **Selected:** §8 and §14, all four B candidates, deterministic baseline, no automatic harness inference retries, three offline controls |
| D7 | Docs/tooling bootstrap | **Included in Milestone 2:** minimal supported Docs Protocol setup and maintained strict TypeScript tooling under the org standard; not implemented by this docs-only revision |
| D8 | New research documents and results licence | **Confirmed by the owner on 2026-11-14:** CC BY 4.0 for original research/planning documents, experiment reports and original research results; Apache 2.0 for original code, tests and tooling. See [documentation licence notice](../../LICENSE-DOCS) |

The original Phase 0 report retains its agreed CC BY 4.0 attribution and remains unchanged. Original fixture implementations and test data forming part of the tests follow the code/tests licence; original research prose, explanatory tables and authored experiment results follow the documentation licence. Retained third-party sources and provider artifacts keep any applicable original notices and terms. Contributors retain copyright in their contributions; this agreement does not transfer authorship or relicense third-party material.

## 18. Next milestone: model-free experimental substrate

**Deliver a reproducible experimental substrate and its receipts, ending before the first live model call.** Do not build a general verification service or full production integration.

1. **Minimal repository setup and fixture.** Bootstrap the relevant Docs Protocol/tooling checks in a supported environment. Use maintained strict TypeScript per the org standard, one pinned runtime and the existing repository. Materialize the four sanitized application base/head pairs.
2. **Oracle and sealed ground truth.** Freeze criteria/input/assertion/sufficiency mapping; demonstrate the oracle rejects the planted behavioral faults; run each candidate twice; review unresolved scope; seal labels/map outside reviewer reach.
3. **Scorer and deterministic baseline.** Verify label, reference and support scoring separately against deliberately wrong fixed outputs, partial inventories and technical failures. Evaluate the same evidence packets without a model. Retain all error classes and expected IDs.
4. **Ledger and deterministic controls.** Record identity, raw availability, effect, usage and cleanup; exercise CT-1–CT-3 with valid/stale/delayed stubs. Freeze randomization, prompt and input manifests; mark live model/limit fields pending rather than invent them.
5. **Bounded adapters.** Use the exact packed `/llm` SDK with injected ports. Verify the existing managed OCR release asset and the experimental input/result boundaries with a loopback fake provider. Reuse scoped S7 evidence; add only checks needed for uncovered boundaries (§10), not a mandatory Go rebuild or a full Gateway deployment.
6. **Readiness report.** Record working artifacts, checks actually run, failed/unsupported cases, preserved source identities and the precise remaining live gates. Separate substrate readiness from authorization to execute.

**Exit criteria:** reviewed oracle mapping and reproducible labels; scorer catches planted false satisfaction/false violation and irrelevant references; deterministic baseline respects sufficiency/applicability; all three controls pass; exact SDK/OCR identities and relevant adapter mappings are recorded; no live model call occurs. If the oracle or contract exposes a substantive ambiguity, surface that concrete decision.

D1/D2 live credentials/model/spend choices are **not** required to finish this milestone. Before any later live qualification or Stage A, record them, freeze the final configuration and satisfy the relevant route gates. Milestone 2 completion does not itself authorize spending.

## Sources

Code and research evidence links use the pinned revisions in §3. The organization policy is a current policy link; its inspected blob is recorded below.

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

- S6 [Critical architecture and evidence audit, 2026-11-13](https://github.com/agent-teams-ai/engineering-research/blob/fa207e0111cea294378c57a0561ee4bb15591166/docs/studies/task-verification-critical-architecture-and-evidence-audit-2026-11-13.md) — later evidence/policy refinement; §9 here explicitly supersedes its historical 39-run envelope
- S7 [Exact managed OCR compatibility receipts](https://github.com/agent-teams-ai/engineering-research/blob/fa207e0111cea294378c57a0561ee4bb15591166/evidence/experiments/task-verification-2026-11-13/ocr/README.md) and [retained evidence](https://github.com/agent-teams-ai/engineering-research/tree/fa207e0111cea294378c57a0561ee4bb15591166/evidence/experiments/task-verification-2026-11-13/ocr) — 10 native review invocations, 14 fake POSTs, one version check, 9 parser assertions; zero real providers
- [Profile A background materialization](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/production-t0-review-runner.ts) and [finding normalization](https://github.com/777genius/review-router/blob/7a079c382d8e98b426ee90a6b3764be2a21b4c49/src/review-orchestration/infrastructure/ocr-review-normalization.ts)
- [SDK generation/decode settlement](https://github.com/agent-teams-ai/account-gateway/blob/539418d5935a9e336d480b128a1cdb93c1daa6e1/packages/account-gateway/src/features/llm/domain/generation.ts), [success/failure result contract](https://github.com/agent-teams-ai/account-gateway/blob/539418d5935a9e336d480b128a1cdb93c1daa6e1/packages/account-gateway/src/features/llm/domain/outcome.ts), [task ceilings](https://github.com/agent-teams-ai/account-gateway/blob/539418d5935a9e336d480b128a1cdb93c1daa6e1/packages/account-gateway/src/features/llm/domain/task.ts) and [injected ports](https://github.com/agent-teams-ai/account-gateway/blob/539418d5935a9e336d480b128a1cdb93c1daa6e1/packages/account-gateway/src/features/llm/application/ports.ts)
- [Organization engineering quality standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md) — inspected blob `9d4fc54d99249077bf6887be35a59ace1d5547bd`; maintained runtime tooling follows its strict TypeScript and architecture requirements

[Documentation map](../README.md)
