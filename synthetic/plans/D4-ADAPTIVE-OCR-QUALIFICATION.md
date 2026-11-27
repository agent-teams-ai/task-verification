# D4-P0.1 — Adaptive native OCR requirements investigator: final decision package

**Status: `D4_P0_FINAL_PLAN_READY — AWAITING_ILIYA_DECISION`**

This document supersedes D4-P0 in place; it is the only D4 architecture proposal. Nothing here is
implemented, dispatched, paid for or authorized. It is an independent assessment of the 2026-11-26 owner
direction, not a defence of it.

| | |
| --- | --- |
| Branch | `exp/synthetic-live-pilot-01` (research only) |
| Base commit | `349c034770636682cd7a34969c60b035eca2a483` |
| OCR source examined | `agent-teams-ai/open-code-review` @ `8a70944f567beba9ffc12d1153e33ef5fd60967d` |
| M2 PR #2 | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, draft, untouched |
| D3 raw outputs | unmodified; one bookkeeping residue recorded in Appendix A |
| Paid inference in this phase | none |
| New spend authorization | none. D3's USD 0.36696625 is **not** an allowance (see §4.6) |
| Reader | Iliya |

---

## 0. Decision card

### 0.1 Selected mechanism, and the smallest credible fallback

**Selected: Option A — one adaptive native task** in a new `internal/requirementstask`, reusing
`internal/llmloop` unchanged, `internal/tool` providers directly, `internal/gitcmd`, `internal/session`
and prompts embedded in the new package. Verified feasible from source (§2). **Smallest credible
fallback: Option B — a fixed two-pass adapter** on the already-qualified `@agent-teams/account-gateway/llm`
single-request client (250–450 new lines, 2 requests per case, no multi-hop). Switch condition is
numerical (§2.5), not a preference.

### 0.2 D4-P1 scope (offline only, one tiny sample)

Prove eight things against a fake provider, real git and the real loop: registration; `llmloop.Task`
invocation; authorized source reading; immutable candidate identity; one finding persisted before the
next request; `partial` after a request-limit stop; no change to `ocr review` / `ocr review --analysis`
behaviour; shared delta ≤ 3 lines. No fixture project, no semantic evaluation, no spend. GO/STOP in §3.3.

### 0.3 P1 files and size

8 new Go files + 3 embedded prompt files (~880–1,180 lines) + 5 new test files (~560–750 lines) + **1 shared line** in
`cmd/opencodereview/root.go` `init()`. No `go.mod` change (`jsonschema-go v0.4.3` is already a direct
dependency). Full list in §3.2.

### 0.4 Conditional P2 / P3 scope

- **P2** (only on P1 GO): typed `ocr.requirements/v1` contract, intent record, incremental findings,
  coverage arithmetic, and the `quota-service` fixture with an independently qualified oracle.
- **P3** (only on P2 GO **and** a separate live authorization): 4 live cases, 5 requests each, USD 0.90
  worst case. One OCR comparator case only if its own USD 0.46 block is granted.

### 0.5 Fixture choice

`quota-service` — one purpose-built workflow/budget service, seven frozen scenarios of which **S7 is held
out of prompt tuning entirely**. A second fixture (`plugin-cli`) is **not** proposed; it has a measured
trigger (§12.2) and a measured cost.

### 0.6 Worst-case live budget

**USD 0.90** requested for 4 adaptive cases × USD 0.22, each 5 requests at 24,576 B input and 2,560
output tokens, 12 min per case. Expected actual **USD 0.15–0.28**. OCR comparator is a **separate**
USD 0.46 request, not inside the 0.90. The D4-P0 pairing of "5 cases × USD 0.20 within USD 0.90" is
arithmetically impossible and is withdrawn (§4.5).

### 0.7 OCR baseline accounting

No D3 OCR observation is reusable — the D3 OCR stage ended `BLOCKED`, so its finding set is *unobserved*,
not empty. A live OCR comparator on any realistic candidate costs **at least USD 0.306** structurally
(8 requests × 24,640 input tokens) and **USD 0.46** at the observed 12-request shape, because OCR's minimum
request width is ~19.6 KB of fixed prompt regardless of fixture size. It is therefore a separate
authorization, and if it is not granted the report **cannot claim** incremental value over ordinary OCR.

### 0.8 Owner decisions requested

1. **Scope** — approve P1 as specified in §3, or require Option B first.
2. **Budget** — authorize **USD 0.90** (4 cases, 5 requests, USD 0.22 each) as a *new, standalone* live
   ceiling; D3's remainder is not reused. Or state a different number and the code-halving consequence.
3. **OCR baseline** — separately authorize **USD 0.46** for one OCR comparator case, or accept a report
   with **no OCR column** and the limitation in §5.6.
4. **Transport** — confirm which credential/transport may run the adaptive cases. `--analysis` is barred
   from `--reviewrouter-managed` (verified), so the adaptive command cannot ride the managed channel
   without new integration; a plain provider key with its own cap is the alternative.
5. **Bookkeeping** — accept the D3 index residue in Appendix A as documented-and-closed.

### 0.9 Key uncertainties and stop conditions

Uncertain: whether 4 investigation rounds suffice for a cross-component obligation; whether a 24,576-byte
request carries enough context for turn 5; whether the owner reads typed criteria faster than D3's
Markdown brief; whether 4.4 bytes/token holds for this prompt shape (D3's ratio, not a tokenizer
guarantee). Stop conditions: unsupported `satisfied` on a mandatory requirement; partial reported as
`completed`; ordinary-OCR regression; > 100 shared-file lines or any edit to `llmloop`/`behaviortask`/
`tool`; no decision difference from checks/OCR on the multi-hop case.

---

## 1. What the source actually says: ten corrections to D4-P0

Every item is a claim in D4-P0 that inspection at `8a70944f` contradicts or sharpens. "Effect" states the
consequence for the architecture decision, not just for wording.

| # | D4-P0 claim | Verified source | Effect |
| --- | --- | --- | --- |
| C1 | The per-run token budget is a `llmloop.Task` field (`§2.1`, `§7` "New: MaxTokensBudget") | `Task` has `MaxRounds`, `MaxContextTokens`, `MaxCompletionTokens`, `Grace` only (`llmloop/task.go`). The aggregate budget is `Deps.MaxTokensBudget` (`loop.go:29`), checked before each round (`loop.go:378`), counting **input+output only** (`loop.go:174`) | Feasibility unchanged — the budget is native — but it is a **Runner/Deps** property, so the new package must construct a Runner, exactly as `behaviortask` does. The 120,000 figure must be attached to `Deps`, not to `Task` |
| C2 | "8 requests maximum **including** the grace submission" | The grace round runs **after** the round loop and issues its own request (`loop.go:517–521`, `runGraceRound`). Requests = `MaxRounds + 1` | A request cap of 6 means `MaxRounds = 5`. The D4-P0 text implied 7 |
| C3 | Round cap bounds requests | Memory compression issues additional LLM requests that are **not** counted by `MaxRounds`; it fires at 60 %/80 % of `MaxContextTokens` (`loop.go:640–690`) | Keep `MaxContextTokens = 200,000` and bound the conversation by tool-result bytes. Lowering `MaxContextTokens` would *add* uncounted spend — the opposite of a saving |
| C4 | "Reads: page 16 KiB default, 64 KiB max" | `file_read` renders up to **500 lines / 256 KiB per call**, 2,048 B per line, and takes no byte parameter at all (`tool/file_read.go:14–26`, `:117`) | 256 KiB ≈ 73k tokens at the conservative bound — **61 % of a 120k per-case budget in one call**. The requirements package must impose its own per-result byte cap *before* the result reaches the model, or no per-case token bound is real |
| C5 | "page 16 KiB / max 64 KiB" as a read limit | 16 KiB is `scopedPathBytes`, the Git **argv** batching limit (`behaviortask/search.go:14`); 64 KiB is the observation **page** ceiling (`observation.go` `readPage`, 4–65,536) | Two different limits were merged into one wrong one. The tool-limit table in §9 is corrected |
| C6 | "search cap from provider (100)" as if equivalent to `behaviortask` | Search is capped **twice**: the provider fetches 101 per file and caps 100 globally with its own note (`tool/code_search.go:18–19`, `:214–249`); `behaviortask/search.go` re-batches per path and caps 100 again with a *different* note | "Use the provider's truncation" is **not** parity with `behaviortask`. A new package must pick one contract and assert it; it must not claim behavioural identity by default |
| C7 | `internal/tool` can be consumed as-is for search | `tool.CodeSearchProvider` has **no allowed-set**: with empty `file_patterns` it greps every tracked file at the revision, including secret-like committed paths. The authorized set exists only in `behaviortask.searchPaths` | Path scoping is a **security** requirement, not a relevance nicety. Naive composition is unsafe; ~80–90 lines of scoping are mandatory (§2.2) |
| C8 | Assumption A4: "the managed OCR transport admits a new subcommand" | `--analysis` is explicitly rejected with `--reviewrouter-managed` (`cmd/opencodereview/analysis.go:33–36`): analysis runs a separate concurrent client, managed runs promise serialization and a complete receipt | **Contradicted for the analysis-shaped path.** The adaptive command cannot ride the managed channel without new integration. This is the sharpest remaining product question, and it makes the *funding transport* a P3 gate rather than a config detail |
| C9 | `github.com/google/jsonschema-go` proposed as an import (dependency risk) | Already a **direct** dependency at `v0.4.3` (`go.mod`) | Risk closed. P1 must still prove `go.mod`/`go.sum` are unchanged |
| C10 | "~500 lines of duplicated policy" | `behaviortask` policy files total 802 lines (`code.go` 266, `search.go` 171, `observation.go` 217, `budget.go` 100, `validate.go` 48), but revision binding, providers and name matching come from `internal/tool`, and the exclusion *rules* are exported library calls | Re-expression is **260–330 lines**, not 500. Duplication risk is real for scoping, observation storage and prose sniffing; absent for revision binding, providers and exclusion rules (§2.2) |

Two further facts, confirmed rather than corrected:

- `submit_analysis` accepts free Markdown with a self-declared `complete|partial|unknown`; validation
  checks length, whitespace and citation existence only (`behaviortask/validate.go`). No typed criteria
  contract exists anywhere in OCR. The new result schema is genuinely new work.
- `workflow.Run` already runs review and analysis concurrently on separate goroutines
  (`internal/workflow/run.go:23–35`), so "run requirements alongside review" needs no new concurrency
  design — but also gives no reason to do it.

**Feasibility verdict is unchanged by C1–C10.** No correction removes the seam; three (C4, C7, C8) add
mandatory work or a gate that D4-P0 did not carry.

---

## 2. The seam, re-verified

### 2.1 What composes directly

| Need | Exported surface at `8a70944f` | Lines to write |
| --- | --- | --- |
| Revision-bound readers for both sides | `tool.FileReader{RepoDir, Mode, Ref, Runner}`; `tool.NewComparisonCodeAccess(current, previous)` | ~20 |
| Read / search / find / diff providers | `tool.NewFileRead`, `tool.NewCodeSearch`, `tool.NewFileFind`, `tool.NewFileReadDiff`, `tool.CodeSearchProvider{Access}`, `tool.FileReadProvider{Access}` | ~15 |
| Name matching over an explicit path list | `tool.MatchFileNames(ctx, files, query, caseSensitive, limit, allowed)` | ~5 |
| Tool identity and registry | `tool.Tool`, `tool.NewRegistry`, `Provider`, `Freeze`, `NotAvailableMsg` | ~10 |
| Session trace | `session.NewAnalysisTrace` (used by `behaviortask` without touching the review enum) | ~5 |
| Budget interface | `llm.FinalSubmissionClient` (`FinalSubmission(ctx, req) (resp, budgetReached, err)`) | interface only |
| Loop | `llmloop.Task`, `Deps`, `ToolOutcome{Continue|Complete|Fail}` | 0 |

This is the finding that decides the direction: **no `llmloop` edit, no `behaviortask` edit, no `tool` edit
is required**, and the newest maintained commit (`5da4f4f9`) that rewrote `code_search.go` and
`filereader.go` does not touch any of these constructors' signatures.

### 2.2 What genuinely requires requirements-specific code, and what would duplicate

| Responsibility | Where it lives today | Compose? | New work | Duplication risk |
| --- | --- | --- | --- | --- |
| Immutable candidate digest | `behaviortask/code.go` (hash of repo/mode/old/head) | no export, but 3 lines | 5 | trivial |
| Authorized-set enumeration | `code.go` (`git ls-tree -r -z`) | no | ~30 | **real** — tree-format drift is silent |
| Secret / symlink / unsafe-path rules | `code.go` `safePath` | **rules are exported**: `allowedext.IsSecretPath`, `rules.FileFilter`, `diff.ProviderDirPrefix`, `fs.ValidPath` | ~45 glue | **glue only** — the rules are not duplicated |
| Scoped search batching | `search.go` `searchPaths`/`pathBatches` | no | 80–90 | **highest** |
| Search truncation detection | `code.go` (prefix `"Note: Showing the first "`) | no | ~20 + seam test | **real** — prose contract |
| Tool error classification | `code.go` (substrings `Error:` / `Warning:`) | no | ~10 | **real** — prose contract |
| Observation record + append-only store | `observation.go` | no | 90–120 | **real** |
| Location extraction / compaction | `code.go`, `observation.go` | no | ~50 | real |
| Aggregate budget + submission reserve | `budget.go` + `llm.FinalSubmissionClient` | interface exported, wrapper not | ~60 | medium (mirrors) |
| Submission validation | `validate.go` (Markdown only) | n/a | new typed | n/a — different semantics |

**Preferred small adapter, not a copy:** a `scope` type in the new package (~75 lines) built from the
exported rule helpers, plus a ~90-line `search` that reuses `tool.CodeSearchProvider` per authorized path
batch. Rejected alternatives, with their honest cost:

- *Import `behaviortask` to reuse `codeTools`* — impossible (unexported) and would couple the new task to
  a package upstream is actively editing. Rejected.
- *Extract scoping into `internal/tool` as an exported `tool.Scope`* — the cleanest long-term shape, but it
  is **+150 / −140 in `internal/tool` plus ~60 lines in `behaviortask/code.go`**, i.e. it edits the exact
  path that must stay byte-identical for the regression test. Not justified for P1; retained as the P2
  option **if** the seam test fails twice (§2.5 W2).

### 2.3 Shared-file delta

Verified: `cmd/opencodereview/root.go` registers all eleven commands in one `init()` block
(`root.go:51–66`). One `AddCommand` line there is the only shared change P1 needs. The repository has
per-command CLI-reference tests (`cli_reference_compare_docs_test.go`) for `session compare` and
`session export`, so an **undocumented** command does not fail a test — but the convention is 4–5 locale
docs per public command. Therefore P1 registers the command with `Hidden: true` and P2 flips it when docs
land. **This is a promise about P1 only, and P1 must confirm it before anyone repeats "one line".**

### 2.4 Size

| Category | Lines |
| --- | --- |
| P1 new code | 880–1,180 |
| P1 tests | 560–750 |
| Shared in P1 | 1 |
| P2 additions (contract, validation, intent, fixture, oracle, probes) | 1,600–2,600 |
| P2 tests | 800–1,200 |
| Total to a qualified P3 | ≈ 3,840–5,730 |

### 2.5 Switch condition to Option B (measured, any one)

- **W1** Shared delta > **100 lines**, or **any** edit to `internal/llmloop`, `internal/behaviortask` or
  `internal/tool`, measured by `git diff --stat 8a70944f -- <shared paths>`.
- **W2** The seam test must be edited on **2 consecutive** upstream syncs.
- **W3** In P2's oracle, the decisive witness for S3 lies **inside the changed inventory** (single-hop), so
  the fixture cannot discriminate multi-hop — the multi-hop premise is false. This does **not** trigger B;
  it triggers the second fixture (§12.2), because B also fails that case.
- **W4** Live: on **≥ 2 of 4** cases the accepted result arrives on request 1 with zero tool calls **and**
  per-case cost ≥ Option B's two-request cost (**USD 0.097**, from D3's 0.04842 reservation × 2). At that
  point A costs more and adapts less.

W1 is checkable in P1. W3 is checkable offline in P2. W4 is checkable only with spend, and only after an
explicit authorization.

---

## 3. Minimum implementation slice

### 3.1 D4-P1 — Native reuse spike (offline only)

One tiny deterministic sample: a 6-file synthetic commit (one changed file, one excluded secret-like file,
one 601-match search surface, one symlink) and a hand-written 2-criterion requirement record. Not the
quota fixture. Fake provider, real git, real `llmloop`.

### 3.2 Exact files

New (`internal/requirementstask/`):

| File | Contents | Lines |
| --- | --- | --- |
| `result.go` | `Result`, `Finding{CriterionID, State, ObservationIDs, ComparisonID}`, `Usage`, JSON encode | 110–140 |
| `scope.go` | `git ls-tree -r -z` allowed set, `safePath` from exported rule helpers, change inventory | 100–130 |
| `tools.go` | provider registry, per-result byte cap (8,192 B), `file_read`/`code_search`/`file_find`/`file_read_diff` execution, prose sniffing for truncation and `Error:` | 120–160 |
| `search.go` | authorized path batching from `file_patterns`, global match cap | 80–110 |
| `observation.go` | append-only `observations.jsonl`, IDs, compacted locations | 80–110 |
| `findings.go` | append-only `findings.jsonl`, candidate digest binding, dedupe | 70–100 |
| `runner.go` | `llmloop.Task` + `Deps` construction, budget wrapper, grace tools, submit tool, artifact write | 170–220 |
| `prompts/system.md`, `prompts/task.md`, `prompts/grace.md` | embedded | 60–90 |
| `cmd/opencodereview/requirements.go` | `--commit` / `--from` / `--to`, `--artifacts`, `--max-requests`, `--max-tokens`, `Hidden: true` | 90–120 |
| `cmd/opencodereview/root.go` | `rootCmd.AddCommand(requirementsCmd)` | **+1** |

Tests (same package unless noted):

| Test file | Asserts | Lines |
| --- | --- | --- |
| `scope_test.go` | secret/symlink/dir-prefix excluded through read, search, find; exhausted paths reported as `unavailable`; unscoped search never reaches a secret path | 120–160 |
| `search_test.go` | 601-match surface truncates at the declared cap with the declared note; scoped pattern recovers the wiring file; no-match / truncated / excluded / read-error are four distinct states | 120–160 |
| `runner_test.go` | fake provider submitting on turn 1 → exactly 1 request, 0 source ops, `completed`; forced `StopTokenBudget` → `partial`, findings retained, one grace request dispatched | 140–180 |
| `identity_test.go` | a head other than the bound head is rejected; an observation whose revision ≠ bound head cannot be cited | 80–110 |
| `regression_test.go` (`cmd/opencodereview`) | `ocr review` and `ocr review --analysis` on a fixed fixture produce byte-identical artifacts and exit codes with the new command registered | 100–140 |

### 3.3 Explicit GO / STOP

**GO to P2 only if all eight pass:**

| ID | Criterion | How |
| --- | --- | --- |
| G1 | A new package registers a task and runs it through `llmloop.Run` with a fake provider | test |
| G2 | The task reads and searches only authorized paths at the pinned revision; excluded paths return `unavailable` through all four tools | test |
| G3 | Candidate identity is immutable: a different head, or a citation from another revision, is rejected | test |
| G4 | One evidence-backed finding is **closed on disk before the next LLM request** (assert file state inside the fake provider's next call) | test |
| G5 | A request-limit stop returns `partial` with retained findings and one dispatched grace submission | test |
| G6 | `ocr review` and `ocr review --analysis` artifacts and exit codes are unchanged | test |
| G7 | Shared delta is ≤ 3 lines, all in `root.go` `init()`; no `go.mod`/`go.sum` change | `git diff --stat` |
| G8 | The tool-result byte cap holds: no single result exceeds 8,192 B, asserted on a 256 KiB file | test |

**STOP** (do not proceed to P2) if G3, G4, G6, G7 or G8 fails. **STOP to Option B** if G7 needs
> 100 lines or touches a shared package. G1/G2/G5 failing is a defect to fix, not a verdict.

P1 is not allowed to claim: that the model uses turns well, that 5 requests suffice, that typed criteria
help a reader, or that managed mode accepts the command. Those are P3/§5 questions.

### 3.4 D4-P2 — Minimal requirements implementation (conditional on P1 GO)

Add to the same package: `intent.go` (frozen intent record, `explicit | established_contract |
necessary_implication | ambiguous | optional`), `validate.go` (schema, coverage arithmetic, citation
revision match, no implementation-derived requirements), `artifacts.go` (result + findings + intent
digests). Build `quota-service` and qualify its oracle (§6). No second fixture unless W3 fires. No live
call. **STOP** if any mandatory criterion cannot be stated model-free by the oracle, or if the oracle
cannot distinguish `violated` from `inconclusive` on S2/S4.

### 3.5 D4-P3 — Bounded E2E evaluation (conditional on P2 GO **and** separate live authorization)

Four cases (§14), 5 requests each, USD 0.90 worst case. Do not run every mechanism against every case. No
permanent matrix. **STOP** at the first unsupported `satisfied`, the first `partial` reported as
`completed`, or an ordinary-OCR regression.

---

## 4. Budget reconciliation

### 4.1 Prices

| Quantity | Value | Status |
| --- | --- | --- |
| Input | USD 1.25 / M tokens | Frozen ledger rate (`runs/budget/batch-guard.json`), worst case: every input token at the cache-write rate |
| Output | USD 5.00 / M tokens | Same |
| Cache read | USD 0.05 / M | Recorded, **never assumed** when reserving |
| Model | `openai/gpt-6.1-terra`, effort medium | D3's approved profile |

**Unresolved assumption:** these are the rates D3's guard enforced on 2026-11-25. They were **not**
re-queried against a provider price page in this phase, and no tokenizer is available offline. If the
provider repriced after that date, every figure below is wrong by the same ratio. The byte→token
conversion (1 token ≥ 1 byte, as bytes + 64 special-token allowance) is D3's documented **upper bound**,
not an estimate; D3 measured 4.4 bytes/token on its actual prompt, which is why reservations run ~2.7×
settled cost.

### 4.2 Reservation per request (Option A)

| Field | Value |
| --- | --- |
| Serialized input ceiling (enforced) | **24,576 B** |
| Reserved input tokens | 24,640 (= bytes + 64) |
| Output ceiling | 2,560 tokens (`MaxCompletionTokens`) |
| Input cost | 24,640 × 1.25/M = 0.030800 |
| Output cost | 2,560 × 5/M = 0.012800 |
| **Reserved USD per request** | **0.043600 → reserve 0.044** |

### 4.3 Reservation table — cases

`MaxRounds = 4`, so worst case is 4 + 1 grace = **5 requests** per case.

| Case | Question | Max req | Max input tok | Max output tok | Cache-write treatment | OCR allowance | Worst USD | Expected USD | Time | Final-submission reserve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 (S1) | Justified completion; simple-task overhead | 5 | 123,200 | 12,800 | All input at 1.25/M; cache reads not credited | none | 0.22 | 0.03–0.05 | 10 min | 1 request (0.044) |
| L2 (S2) | Unmet mandatory requirement found and evidenced | 5 | 123,200 | 12,800 | same | none | 0.22 | 0.04–0.08 | 10 min | 1 request |
| L3 (S3) | Cross-component re-entry (the multi-hop case) | 5 | 123,200 | 12,800 | same | **separate block** | 0.22 | 0.09–0.15 | 12 min | 1 request |
| L4 (S5) | Terse natural-language task | 5 | 123,200 | 12,800 | same | none | 0.22 | 0.03–0.06 | 10 min | 1 request |
| **Sum of maxima** | | **20** | 492,800 | 51,200 | | | **0.88** | **0.15–0.28** | 42 min | |

- **Aggregate authorization requested: USD 0.90.** Sum of simultaneously authorized maxima 0.88;
  **0.02 remains unallocated and may not be spent** — it is a rounding margin, not a reserve.
- **No retry reserve.** A case that needs a 6th request stops as `partial_budget`, and that is recorded as
  a ceiling finding. Adding a retry for one case costs +0.044 and requires a new ceiling.
- **L5 (S4, missing evidence) is dropped from the live plan.** It is qualified offline in P2 (§6); if a
  live case hits `unavailable`, that is reported where it happens. Inflating to five cases costs 1.10 and
  would be a second overrun of the same kind as D4-P0's.
- `Deps.MaxTokensBudget = 120,000` **reported** tokens is retained as a runtime backstop. It is a different
  unit from the reserved 123,200 upper-bound tokens (4.4 bytes/token actual vs 1 byte/token bound), so it
  will not normally trip; it exists so a runaway context still halts.
- Per-request timeout 120 s; 5 requests = 10 min exactly. L3 gets 12 min because a 6th attempt is *not*
  funded and the case must finish or stop cleanly inside its wall clock.
- Batch wall ceiling 45 min; abort the batch at 0.90 aggregate spend or after a second softened case.

### 4.4 OCR comparator — separate block (not inside 0.90)

| Field | Value |
| --- | --- |
| Cases | **1** (S3 only — the decisive case) |
| Per request | 24,576 B body → 24,640 input tokens; 1,500 output |
| Per request cost | 24,640 × 1.25/M + 1,500 × 5/M = 0.038300 |
| Requests | 12 maximum (D3 observed 12 at 19,627–23,258 B) |
| **Worst case** | 12 × 0.0383 = **USD 0.46** |
| Structural minimum | 8 × 0.0383 = USD 0.306 |
| Separate authorization | **USD 0.46**, not drawn from the 0.90 |

If both blocks are granted the total live authorization is **USD 1.36**, which must be stated as such
rather than folded into one number.

### 4.5 Why the D4-P0 figures do not survive

| D4-P0 | Arithmetic | Correction |
| --- | --- | --- |
| 5 cases × USD 0.20 | = 1.00 > 0.90 | 4 cases × 0.22 = 0.88 |
| USD 0.20/case at 8 requests | 8 × 0.044 = 0.352 > 0.20 — the two limits are incompatible at any realistic request width | 5 requests/case; 0.22 cap |
| 8 requests "including grace" | grace is *outside* `MaxRounds` (C2) | `MaxRounds = 4` → 5 requests |
| 10 min/case at 150 s/request | 6 × 150 s = 15 min > 10 min | 120 s/request, 10–12 min/case |
| "Worst allowed case ≈ USD 0.19" | assumed 13k input tokens/request; turn 5 alone re-sends the whole conversation | 24,576 B/request ceiling, reserved as bytes |
| Expected 0.42–0.60 | assumed 6 requests at ~15k input | expected 0.15–0.28 from D3's settled/reserved ratio (0.376) |

Sanity check on the direction: Option A's live cost per case (0.22 worst, ~0.07 expected) is **~2.3×**
Option B's two-request cost (0.097 worst, 0.036 expected). That asymmetry is measured, not assumed, and it
is the reason W4 exists.

### 4.6 D3's remainder is not an allowance

Reconciled from the receipts, not re-derived: committed basis `max(settled 0.31639530, conservative
0.55929) = 0.55929`; D3 settled 4 × criteria attempts = `0.07374375`; aggregate worst case
`0.55929 + 0.07374375 = 0.63303375`; headroom to the program's USD 1.00 ceiling `0.36696625`. D3's own
authorized envelope was `0.41368` (4 × 0.04842 + 8 × 0.0275), of which the OCR part was never spent
because the comparator was `BLOCKED`. The 0.36696625 is unallocated program headroom, **not** a grant: it is
smaller than D3's own unused envelope, it was never authorized for D4, and using it would silently reopen a
closed batch guard. D4 therefore requests a new, standalone ceiling.

---

## 5. Ordinary OCR baseline

### 5.1 What can be reused

Nothing observational. D3's OCR stage ended `BLOCKED`: native findings, post-filter findings, normalized
comments and publication-eligible comments are all **unobserved**, explicitly not empty. What *is* reusable:

- the qualified binary record (`1.14.0-rr.1`, sha256 `443d7777…`, docker `linux/amd64`, image
  `m2-ocr-rr7:local` present on this machine);
- the preparation shapes (`rule-c02.json`, `background-c02.txt`, home config) as templates;
- the **measured request width** (1,641 B preamble, then 19,627–23,258 B per substantive request) — this is
  the single most useful D3 artifact for D4 budgeting, because it proves the cost floor.

### 5.2 When an invocation is necessary

Only when the report intends to claim *incremental value over ordinary OCR* on a case. It is **not**
necessary to describe the adaptive mechanism's internal behaviour, its partial output, or its cost.

### 5.3 Profile and environment availability

Available: model `openai/gpt-6.1-terra`, effort medium, reviewer settings, `1.14.0-rr.1` binary and Docker
image. **Not established:** the credit line. D3 never obtained a live OCR comparator, so there is no
qualified account, no per-request price for the managed unit, and no evidence that the managed channel
accepts the request shape at all (C8).

### 5.4 Its own reservation

Yes — USD 0.46 for one case, separate from the 0.90. The floor is not negotiable: 8 requests × 24,640
tokens = USD 0.306 merely to complete a structurally minimal run, because OCR's fixed per-request width
(~19.6 KB of prompt + rule + inventory) does not shrink with the fixture. A smaller fixture does **not**
make the comparator cheaper, and this is the reason D3 could not afford it inside a 15,936-byte cap.

### 5.5 Partial OCR execution

If an OCR run stops early, its outcome is `incomplete` — the D3 representation — never "OCR found nothing".
Any table cell for an incomplete comparator run is `not observed`, and an `incomplete` comparator may not
be used as evidence of a missed defect.

### 5.6 Incremental usefulness, and the claim that cannot be made

Per case, record three numbers, no composite score:

1. confirmed required violations found by A and not by the comparator (and vice versa);
2. owner-reader bytes needed to reach the same decision;
3. USD per confirmed required violation.

If no fair OCR baseline is obtained, the report **cannot** claim "the requirements task finds defects that
ordinary OCR misses". It may claim only "within a fixture where the project's own checks are green, the
task reached these decisions at this cost, with this evidence" — and the limitation must appear in the
first paragraph, not a footnote.

---

## 6. Fixture oracle qualification (model-free, before any model input)

`quota-service` is only usable if all of the following are established **without a model** and stored
under `evaluator/` (never in the packet):

| Evidence | Requirement | Why a green `go test` is not enough |
| --- | --- | --- |
| Declared-complete control (S1) | Every criterion driven through the HTTP API by a separate probe program; boundary values executed (`limit-1`, `limit`, `limit+1`) | D3 called a control complete on a green suite and was wrong about what the suite covered |
| Negative case (S2) | The missing feature is shown absent by executing the API (404/422/no-op), not by reading code | Absence in source is not absence in behaviour |
| API and state boundaries | Exact admit/reject and usage-increment rows recorded as probe output | Boundary drift is the most common fixture rot |
| Worker re-entry (S3) | Worker killed mid-item and restarted; re-arm observed in a probe log | The defect lives only in the re-entry path |
| Cross-component connection | Show the changed file alone cannot satisfy the criterion: the decisive witness path is outside the changed inventory | Otherwise the case is single-hop and discriminates nothing (W3) |
| Missing-evidence boundary (S4) | A tree-wide search for the runtime receipt is recorded as an oracle artifact proving it does not exist | "We could not find it" is not evidence of absence |
| Relevant ambiguity (S6) | Three implementable readings recorded, each with a distinguishable API behaviour | Ambiguity that cannot be resolved into behaviours is not testable |
| Identity | Full base/head SHAs, requirement-file sha256, per-file digests, and **two independent probe runs diffing empty** | Reproducibility is a property to demonstrate |

Additionally: expected results live only in `evaluator/`; the model-visible packet is generated from
`requirements/` + changed source and is mechanically checked for absence of evaluator strings; **S7 is
never used in prompt tuning** and is first exercised at P3.

The oracle is qualified by P2's own GO/STOP: if a mandatory criterion cannot be stated model-free, or if
`violated` and `inconclusive` cannot be distinguished on S2/S4, the fixture is not usable and P3 must not
start.

---

## 7. GO / STOP matrix

Engineering correctness and semantic quality are separate columns; a green engineering gate never implies
a semantic result.

| Gate | Condition | Kind | If not met |
| --- | --- | --- | --- |
| P1 GO | G1–G8 in §3.3 | engineering | fix, or STOP to B on G3/G4/G6/G7/G8 |
| P1 STOP → B | shared delta > 100 lines or any shared-package edit (W1) | engineering | Option B, recorded with the diff |
| P1 STOP → B | seam test needs edits on 2 consecutive syncs (W2) | engineering | Option B |
| P2 GO | Partial results, evidence binding and budget admission pass offline E2E; oracle qualified (§6) | engineering | do not start P3 |
| P2 STOP | A mandatory criterion cannot be stated model-free; or S3's witness is single-hop (W3) | fixture | build `plugin-cli`, or stop |
| P3 GO | Explicit live authorization, separately granted, with the §4 numbers | authorization | no spend |
| P3 STOP | Unsupported `satisfied` on a mandatory requirement, including "complete" while a mandatory clause is unassessed | semantic | end the direction as proposed |
| P3 STOP | A partial run reported as `completed` | semantic | end the direction |
| P3 STOP | Ordinary managed OCR regression in artifacts or exit status | engineering | revert the command |
| P3 STOP | Stale or different candidate accepted as the assessed one | integrity | end the direction |
| P3 RECOMMEND B | No actionable difference from checks/OCR on the multi-hop case **and** no material reader-work reduction (W4) | semantic | fall back to checks/OCR workflow |

Semantic quality cannot be established by any offline test in this plan. A green P1/P2 says the mechanism
is *correct*, never that it is *useful*.

---

## 8. Architecture critique retained (condensed)

| # | Question | Verdict | Smallest test |
| --- | --- | --- | --- |
| 1 | Is one adaptive session simpler than separate fast/deep engines? | **Partly.** One `Task`, one template. A second engine duplicates the driver. Not proven cheaper in tokens. | Count requests on a trivial case (§3.3 G1) |
| 2 | Can small tasks skip the loop? | **Structurally yes.** `runMainTask` returns on the first `Complete`; nothing forces a tool call. | Turn-1 submission → 1 request |
| 3 | Can complex tasks investigate without scanning? | **Capability, not policy.** Search is bounded by 100 matches and by budget, not by relevance. | 601-match surface (§3.3 G2) |
| 4 | Is the seam maintainable? | **Yes for the loop, moderate for prose contracts.** Two textual contracts (`"Note: Showing the first "`, `IS_TRUNCATED: true`) are parsed by string prefix. | Seam test (§3.3) |
| 5 | Can findings persist before submission? | **Observations yes, criteria no.** `append` writes and closes before the result returns; no criterion store exists. | G4 |
| 6 | Can Gateway/V4 replace it? | **No for multi-hop.** No tool loop in the gateway task; V4 has tools but no assessment semantics. | W3/W4 |
| 7 | Do package privates make reuse invasive? | **Refuted for the task API; confirmed for scoping and observation storage.** | G7 |
| 8 | Can terse intent avoid invented requirements? | **Unproven.** Nothing models requirements today; the guarantee must be a validator. | Three frozen intents in P2 |
| 9 | Can it distinguish absent / unavailable / failed? | **Only with new fields.** `Observation.ErrorClass` covers unavailable/tool_error/timeout/canceled/unsupported_encoding; nothing counts unassessed criteria. | Schema test in P2 |
| 10 | Is a partial result honest? | **Structurally yes, semantically new.** Grace round exists; criteria must be persisted first. | G5 |

**Assumptions, stated separately:** (A1) a compact packet yields a turn-1 submission — unmeasured;
(A2) 4–6 requests suffice for a cross-component obligation — owner hypothesis, unmeasured, and P3 now funds
only 4 investigation rounds; (A3) typed criteria reduce reader work — D3 measured the brief, not criteria;
(A4) **contradicted in part** (C8): the managed channel rejects the analysis-shaped path; (A5) an ordinary
OCR baseline is obtainable and affordable — cost now measured (§5.4), affordability unresolved.

**Where I disagree with the direction:** roughly half the new code is result semantics, not investigation;
the 300-round default is the wrong shape (a small round cap plus an aggregate budget is right); truncation
by English prose is a liability and should be isolated behind one seam test; and a second fixture before
one measured case repeats D3's pattern of accumulating controls without a comparator.

---

## 9. Adaptive session lifecycle

| Stage | What happens | Model call |
| --- | --- | --- |
| 1. Bind candidate | Resolve `--commit` or `--from/--to` to full SHAs; reject short/ambiguous; `comparison_id` = hash(repo, mode, old, head) | no |
| 2. Bind requirements | Read task text + bundle; `requirements_sha256`; refuse to start if a requirement lacks an authored source | no |
| 3. Assemble context | Manifest, changed inventory with excluded reasons, requirement bundle, captured context. Oversized inventories become paged indexes | no |
| 4. First turn | System + task prompt; tools `file_read`, `code_search`, `file_find`, `file_read_diff`, `context_read`, `record_finding`, `submit_requirements`. A sufficient packet may submit immediately | yes (1) |
| 5. Investigate | Each read/search yields an observation (revision, locations, hash, truncation, error class). Batched; no call per file or per criterion | +1/turn |
| 6. Narrow | `file_patterns` or line ranges; replay a paged observation | same turn |
| 7. Persist finding | `record_finding` appends one criterion state with observation IDs and the candidate digest; rejected on failed/absent observation, different comparison, unknown criterion | same turn |
| 8. Submit | `submit_requirements` is the only completion tool; first valid submission frozen. After a spent budget, one submission-only grace round | +1 |

**Corrected limits:** `MaxRounds = 4` (+1 grace = 5 requests); `Deps.MaxTokensBudget = 120,000` reported
tokens; `MaxContextTokens = 200,000` (unchanged, so compression never fires at these sizes); per-request
input ≤ 24,576 B and output ≤ 2,560 tokens; **per tool result ≤ 8,192 B** (the new cap that makes the input
ceiling real, C4); per read, line ranges only (the provider's own 500-line/256 KiB render is truncated by
our wrapper first); search: 100 matches at the provider, **40** returned to the model; findings ≤ 50.

---

## 10. Partial-result and evidence semantics

| State | Meaning | Emitted when |
| --- | --- | --- |
| `completed` | Every mandatory criterion has a state; submission accepted; no budget stop | normal |
| `partial_budget` | Accepted submission after `StopMaxRounds`/`StopTokenBudget`; some criteria `not_assessed` | grace round |
| `partial_unavailable` | A criterion's source is unavailable (excluded, missing, encoding, permission) | submission with `unavailable` evidence |
| `failed` | No valid submission: investigation, provider or persistence error | `ExecutionStatus failed` |
| `cancelled` | Cancelled before/at submission; retained findings reported | `context.Canceled` |
| `invalid_submission` | No schema-valid submission inside the budget | grace rejected |

Failure matrix (unchanged in substance from D4-P0): tokens exhausted → stop before dispatch → grace →
`partial_budget`; failed read → `unavailable` observation, criterion `inconclusive`, never `satisfied`;
truncated search → `search_truncated` coverage, never `absent`; malformed output → validator message,
repairable inside remaining rounds; final request undispatchable → `failed`, findings retained; duplicate
citation → deduped, not double-counted; conflicting states → both retained, criterion `conflicting`;
stale revision → rejected. If no valid finding exists at stop, the result is `failed`/`partial` with an
explicit `not_assessed` inventory — never a manufactured partial completion.

---

## 11. Terse-input interpretation policy

The run emits an intent record frozen before implementation results are read:

```json
{
  "schema": "ocr.requirements/v1",
  "task": {"text": "Make plugin updates reliable.", "sha256": "…", "revision": "owner-2026-11-30"},
  "candidate": {"mode": "range", "old": "…", "head": "…", "comparison_id": "…"},
  "intent": {"sha256": "…", "producedBy": "session-turn-1"},
  "requirements": [
    {"id": "R1", "class": "explicit", "text": "…", "provenance": {"source": "task_text", "quote": "…"}},
    {"id": "R2", "class": "established_contract", "text": "…", "provenance": {"source": "docs/plugins.md@head", "revision": "…"}},
    {"id": "R3", "class": "necessary_implication", "text": "…", "provenance": {"source": "base_behavior", "whyNecessary": "…"}},
    {"id": "R4", "class": "ambiguous", "text": "…", "provenance": {"source": "task_text", "alternatives": ["…", "…"]}},
    {"id": "R5", "class": "optional", "text": "…", "provenance": {"source": "reviewer_suggestion"}}
  ]
}
```

Enforced by the validator, not by prompt text: `ambiguous`/`optional` can never be mandatory or blocking;
`necessary_implication` requires a non-empty `whyNecessary` naming an outcome or contract, and a design
choice without a behavioural obligation is rejected; exactly one state per criterion from
`satisfied | violated | inconclusive | not_assessed | conflicting | unavailable`; `satisfied` requires a
cited observation without an error class; **a requirement whose provenance is the changed files is
rejected** (the implementation cannot define its own acceptance); an owner clarification is a **new
requirement revision** with a new sha256, re-evaluated, never silently weakened.

No extra model call: the intent record is produced in turn 1 by the same session, digested before findings.
The owner's expected meaning is frozen separately in `evaluator/` and never enters model input.

---

## 12. Fixtures

### 12.1 `quota-service` (one, purpose-built)

HTTP API (`POST /v1/admit`, `POST /v1/usage`, `GET /v1/policy`, `GET /healthz`), persisted policy and usage
(SQLite), admission with subject/scope/limit, a background worker with recovery of interrupted work, limit
enforcement with an explicit boundary, `go test ./...`. ~700–1,100 lines. Not a clone of Agent Teams or UAP.

| ID | Scenario | Purpose |
| --- | --- | --- |
| S1 | Fully correct, boundary cases executed | justified completion |
| S2 | Missing feature despite green tests | confirmed mandatory violation |
| S3 | Worker never re-arms after recovery | **multi-hop discovery** |
| S4 | Evidence genuinely absent (needs a runtime receipt) | missing-evidence request |
| S5 | Short natural task | terse intent |
| S6 | Material ambiguity (reject vs queue vs cap) | owner clarification |
| S7 | Equivalent behaviour at a moved path + irrelevant diff | context-selection fragility (**held out**) |

### 12.2 Conditional second fixture

`plugin-cli` only if W3 fires: S3's decisive witness turns out to be inside the changed inventory, so
`quota-service` cannot discriminate multi-hop. Cost: 0.5–1 week, no measured benefit yet. Otherwise skip.

---

## 13. Model-free E2E qualification tests (P2)

Deterministic fake provider; real loop, real tools, real git; no network, no credentials.

| ID | Test | Assertion |
| --- | --- | --- |
| T1 | Ordinary OCR regression | `ocr review` and `ocr review --analysis` byte-identical artifacts/exit codes vs pinned baseline |
| T2 | Immutable candidate | other head rejected; observation revision ≠ bound head rejected |
| T3 | Authorized access | excluded/secret/symlink/unsupported paths `unavailable` through read, search, find |
| T4 | Observation provenance | ID, revision, locations, hash; citations resolve |
| T5 | Truncation regression | 601 matches truncate at the declared cap; scoped search recovers the witness; four distinct states |
| T6 | Incomplete coverage | two unread criteria → `not_assessed` + `partial_*`, no `satisfied` |
| T7 | Typed submission | bad schema, unknown criterion, ambiguous-as-mandatory, implementation-derived requirement each rejected distinctly |
| T8 | Incremental persistence | N accepted findings on disk; a rejected call appends nothing |
| T9 | Duplicate/stale | dedupe, conflict preserved, stale rejected |
| T10 | Hard limits | round cap, token backstop, tool-result byte cap and result cap each stop at the declared point |
| T11 | Submission reserve | with the budget spent, one submission-only request still dispatches and is accepted |
| T12 | Cancellation/timeout | after a saved finding → `cancelled`, findings intact |
| T13 | Invalid final | malformed → repaired → unrepaired → `invalid_submission` |
| T14 | Error accounting | provider error, refusal, empty rounds recorded, never counted as assessment |
| T15 | Baseline preservation | review path unchanged with the command present |
| T16 | Seam equivalence | truncation flags, locations and error classes match the declared contract on the same fixture |

---

## 14. Minimal planned live evaluation

Four cases, one run each, expectations frozen before dispatch. Ordinary OCR plus the project's own checks
is the baseline; the D3 one-shot is used only where its packet genuinely applies.

| Case | Fixture | Mechanism | Question |
| --- | --- | --- | --- |
| L1 | S1 | adaptive | Does it avoid inventing defects on a correct candidate, at what cost? |
| L2 | S2 | adaptive | Is the unmet mandatory requirement found and evidenced? |
| L3 | S3 | adaptive (+ OCR **only if funded**) | Is disconnected cross-component behaviour found? |
| L4 | S5 | adaptive | Is a terse request interpreted without inventing obligations? |

Offline-only by design: S6 (ambiguity, via the intent record), S4 (missing evidence, via the oracle),
partial-budget behaviour (T10/T11), and S7 (held out entirely). Not every mechanism on every case; no
permanent matrix.

Per case record: expected vs produced owner action; confirmed and missed violations; unsupported
satisfactions; unnecessary required corrections; missing-evidence requests; observation IDs and coverage;
false absence due to truncation; actual requests; repeated input bytes/tokens; usage and reasoning tokens;
wall time; manual setup and reader time; incremental cost over baseline. **No model result is its own ground
truth, and four cases cannot establish population accuracy.**

---

## 15. Stop, fallback and scope

*Material failure* — any one ends the direction: unsupported `satisfied` on a mandatory requirement; a
partial run reported as `completed`; a stale or different candidate accepted; ordinary managed OCR
regression; no actionable difference from checks/OCR on the multi-hop case with no material reader-work
reduction.

*Proportionate maintenance*: > 100 shared-file lines (W1) or a seam test broken on two consecutive syncs
(W2) → Option B.

*Cost*: a complex case exceeding USD 0.22 with no demonstrated decision difference → stop; re-scope, do not
raise the ceiling.

*Scope*: this plan does not start the genuine-team-task phase, does not merge M2 PR #2, does not sync
upstream, does not modify maintained OCR source, and does not claim managed-mode compatibility.

---

## 16. Decisions Iliya must make

1. **Scope** — approve P1 exactly as §3.2/§3.3, or require Option B first.
2. **Live ceiling** — authorize USD 0.90 (4 cases × 0.22, 5 requests, 24,576 B input, 2,560 output,
   10–12 min) as a **new standalone** ceiling. If you want 5 cases, the arithmetic is 1.10; if you want a
   6th request per case, 1.06; if you want 8 requests, 1.41. Say the number you want, not the shape.
3. **OCR baseline** — authorize a separate USD 0.46 for one comparator case, or accept **no OCR column**
   and the limitation in §5.6.
4. **Transport/credential line** — which credential may run the adaptive cases, given that `--analysis` is
   barred from `--reviewrouter-managed` and the adaptive command would need its own provider access.
5. **Bookkeeping** — accept Appendix A as documented-and-closed.

Until 1–4 are answered: no implementation, no provider request, no fixture build against a live key, no
commit to a production repository, no D4-P1 start.

---

## Appendix A — Bounded D3 bookkeeping item (documented, not corrected)

`synthetic/next-family/runs/D3-R3-INDEX.json` still reports
`"counts": {"confirmedRequiredViolations": 8, "confirmedMechanisms": 5, …}`.
The published values (`D3-R3-REPORT.md` summary and erratum, `adjudication/ADJUDICATION.md`) are **7**
confirmed required violations and **2** mechanisms; the `5` counted matrix claim rows, and `8` added the
clause-level `INSUFFICIENT_EVIDENCE` entry to the seven violation rows. This is a machine-index field left
stale by the authorized erratum. It is recorded here as a bounded residue; no D3 record is edited and D3 is
not reopened. Read the report's 7/2.

## Appendix B — Repositories and exact commits examined

| Repository | Commit / state | How examined |
| --- | --- | --- |
| `agent-teams-ai/open-code-review` | `8a70944f567beba9ffc12d1153e33ef5fd60967d` (qualification baseline); maintained main `5da4f4f9f2ef08a3a9f0f77a09e7252ab3647a54` (1 commit ahead) | Raw files + contents API at the pinned commit: `internal/llmloop/{task,loop}.go`, `internal/behaviortask/{code,search,observation,budget,validate,result,runner}.go`, `internal/tool/{definitions,code_access,code_search,file_read,file_find,file_read_diff,filereader,stub}.go`, `internal/llm/budget.go`, `internal/workflow/run.go`, `cmd/opencodereview/{root,analysis}.go`, `go.mod`. No local clone, no branch change, no sync |
| `alibaba/open-code-review` (upstream) | main `d4f568f71d3a9d5c5ec972791b1509e40cd31ad1`; sync baseline `39515dca6161fb7fd176d87704b2b10e5f7a0c36` | GitHub API compare: 20 commits, 235 files; 70 in the seam directories |
| `agent-teams-ai/task-verification` | `349c034770636682cd7a34969c60b035eca2a483` on `exp/synthetic-live-pilot-01`; M2 worktree `996cdcb` | Local worktree; receipts re-read (`runs/budget/batch-guard.json`, `runs/attempts/att-c03r…/result.json`, `D3-R3-REPORT.md` §4) |
| `agent-teams-ai/account-gateway` | `c6d73002ac28bb11c3d2e88d135a05c7f2f06bd6` (`llm/domain/task.ts`) | Raw file read; no local clone |
| `777genius/review-router` | `e3788de2ada1f33ca51db37426a5704a78efeb9b` (V4 contract, 5 read tools) | Local clone |
| Docker image | `m2-ocr-rr7:local` (binary `443d7777…`, 87,356,967 B, `open-code-review 1.14.0-rr.1 linux/amd64`) | Retained D3 artifact record; not exercised in this phase |
