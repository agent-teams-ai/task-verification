# D4-P0 — Adaptive native OCR requirements investigator: architecture review and bounded qualification card

**Status: `D4_P0_ARCHITECTURE_PLAN_READY — AWAITING_ILIYA_SCOPE_APPROVAL`**

This document is a plan. Nothing in it is implemented, dispatched, paid for or authorized. It is a
critical response to the 2026-11-26 owner direction, not a defence of it, and not final architecture
approval.

| | |
| --- | --- |
| Branch | `exp/synthetic-live-pilot-01` (research only) |
| Base commit | `9c21a7b00c53243315fd86a7a921c76c6d6c69d4` (= `origin`, clean) |
| M2 PR #2 | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, draft, untouched |
| D3 raw outputs | unmodified; one bookkeeping residue recorded in Appendix A |
| Paid inference in this phase | none |
| New spend authorization | none; D3's remaining USD 0.36696625 is **not** an allowance |
| Reader | Iliya |

---

## 0. Executive execution card

**Independent verdict.** Native OCR reuse is feasible with a genuinely thin seam, and the
"package-private makes it invasive" objection is **not supported by the source**. `internal/llmloop`
already exposes a complete task API, and `internal/behaviortask` is an existing sibling package that
consumes it without a single edit to the loop. A Requirements task can be added the same way: one new
package, one new CLI file, one line in `root.go`. The real cost is not the loop — it is (a) a typed
criteria result contract that does not exist today, (b) incremental criterion persistence that does not
exist today, and (c) ~500 lines of read/search/authorization policy that `behaviortask` keeps private
and that must be re-expressed, not copied.

**What the source does *not* establish** (and therefore what this card does not promise): that one
session's first turn is cheaper than a two-pass adapter on simple tasks; that six requests suffice for a
cross-component obligation; that typed criteria improve the owner's decision; or that the managed OCR
channel admits a new subcommand. Each has a named smallest test in §1 and §11.

**Recommended scope**: Option A (native adaptive task), built as `internal/requirementstask`, reusing
`llmloop`, `internal/tool`, `internal/gitcmd`, `internal/session` and embedded prompts, with **zero
edits to shared upstream Go files except one registration line**. One realistic fixture first; the
second only on a stated trigger.

**Rough size**: 1,150–1,750 lines of new Requirements code, 180–260 lines of new CLI code, 900–1,400
lines of tests, 700–1,100 lines of fixture (plus 250–400 lines of probes). Shared-file delta: 1–3 lines.

**Numbers requested**: live ceiling **USD 0.90** for five fixed cases, per-case cap USD 0.20, 8 requests
and 120,000 aggregate tokens per case, 10 minutes per case. Expected actual USD 0.42–0.60.

**Stop condition**: if the extraction/adapter needs more than ~600 lines of shared-file edits, or two
consecutive fixture runs show the loop never uses a turn beyond the first in a way that changes a
criterion's state, the direction falls back to Option B (§5).

---

## 1. Architecture critique: does the selected direction survive inspection?

Ten questions, answered from source. "Established" means I read the code; "unproven" means the source
cannot settle it and a test is named.

| # | Question | Verdict from source | Smallest resolving test |
| --- | --- | --- | --- |
| 1 | Is one adaptive session materially simpler than separate fast/deep engines? | **Partly established.** One `llmloop.Task` and one template per run; a second engine would duplicate the driver in `internal/llmloop/loop.go` plus its own prompts, budget and submission path. Simpler in components, not proven cheaper in tokens: the D3 one-shot already needed 26,773 B for one turn. | Count provider requests for a trivial case; if it is 1 with no tool call, the "fast path" is the same session, not a second engine. |
| 2 | Can small tasks finish without paying for unnecessary read/search loops? | **Structurally established.** `runMainTask` returns as soon as a tool returns `Complete`; nothing forces a tool call before submission, and `EmptyResponseMessage` only fires when the model emits no tool call at all. | Fake provider that submits on turn 1: assert requests = 1, source ops = 0, state = `completed`. |
| 3 | Can complex tasks investigate relevant unchanged code without scanning the repository? | **Established as a capability, not as a policy.** `code_search` is always constrained: `searchPaths` enumerates `git ls-files --with-tree=<rev>` and batches per-path pathspecs, and `code_search.go` caps at 100 matches with an explicit truncation note. Nothing prevents the *model* from omitting `file_patterns` and spanning the whole tree, so the bound is budget, not relevance. | The 601-match fixture (§11, T5): unscoped search must truncate, scoped search must recover the wiring file, and bytes/unique files must be recorded. |
| 4 | Is the native reuse seam small enough to maintain across upstream updates? | **Yes for the loop, moderate for tool contracts.** `behaviortask` needs no `llmloop` change; but the newest maintained commit alone rewrote `internal/tool/code_search.go` (+75/−22) and `filereader.go` (+21), and truncation is detected by *string prefix* (`strings.HasPrefix(stripSide(content), "Note: Showing the first ")`). | Seam-equivalence test: run `file_read`/`code_search`/`file_find` through both packages on a fixture and compare truncation flags, locations and error classes. |
| 5 | Can accepted observations and partial criterion results be persisted safely before submission? | **Observations yes, criteria no.** `observationStore.append` writes and closes before the tool result returns, and a persistence error fails the task (`dispatch` returns `llmloop.Fail`). No criterion-level store exists anywhere in OCR. | Offline test: kill the provider after N findings; assert `findings.jsonl` holds exactly the accepted ones and the final state names the stop. |
| 6 | Can the existing Gateway/V4 interfaces solve the same problem with fewer code changes? | **No for multi-hop.** The Gateway contract is one bounded structured inference per execution with no tool loop (`LlmTask` in `account-gateway` has `instructions`/`input`/`output`/`deadline` and no tools). V4 has five read tools and durable cursors, but no assessment semantics, no criteria identity and no submission path; it would need a new orchestrator anyway. Fewer OCR changes, more new components. | Implement Option B's second pass against the D3 retained one-shot and measure whether it can answer a case whose decisive evidence was unknown before reading. |
| 7 | Does native OCR's package-private architecture make reuse disproportionately invasive? | **Refuted for the task API; confirmed for the tool layer.** `codeTools` and `observationStore` are unexported, but they are *ours to re-express* against the exported `internal/tool` providers and `gitcmd`. No `llmloop` edit is required, and no `behaviortask` edit either if we do not lift its internals. | Spike: build the read/search/observation layer for one fixture path and count the shared-file diff. Target: 1–3 lines. |
| 8 | Can terse task intent be interpreted without silently inventing mandatory requirements? | **Unproven.** Nothing in OCR models requirements at all today; `submit_analysis` is free Markdown with a self-declared `complete|partial|unknown`. The guarantee must come from a typed intent record plus a validator that cannot promote an ambiguous item (`§9`). | Three frozen intents (detailed, terse, ambiguous) replayed through a fake provider; assert the ambiguous item can never be emitted as mandatory. |
| 9 | Can the design distinguish unavailable evidence, source absence, unsupported claims and execution failure? | **Partially, and only with new fields.** `Observation.ErrorClass` already separates `unavailable`, `tool_error`, `timeout`, `canceled`, `unsupported_encoding`; truncation is a separate flag with a continuation hint. "No match" ≠ "no caller" is prompt guidance only. Nothing counts unassessed criteria or uninspected scope. | Schema test: a run with one failed read and one truncated search must produce distinct coverage fields, and no `satisfied` state for the unassessed criterion. |
| 10 | Can it remain useful when the budget expires halfway through a complex requirement? | **Structurally yes, semantically new.** `runGraceRound` runs a submission-only round after `StopMaxRounds`/`StopTokenBudget`, and `requestBudget.complete` exempts `FinalSubmission` from the block; `Result.ExecutionStatus` already reports `completed|partial|failed|skipped`. But a partial *criteria* result needs findings persisted before the reserve is spent — that is the main new engineering. | Offline: force `StopMaxRounds` after two of five criteria are adjudicated; assert `partial`, two findings retained with observation IDs, three explicitly `not_assessed`. |

### Assumptions this plan depends on, stated separately

- **A1** A model given a compact packet will choose one turn for simple cases (no measurement).
- **A2** 4–6 requests suffice for a cross-component obligation (owner hypothesis; unmeasured).
- **A3** Typed per-criterion results reduce reader work versus D3's Markdown brief (D3 measured the brief, not criteria).
- **A4** The managed OCR transport admits a new subcommand and accounts credits per request (not inspected here; Docker image is available, the channel is not).
- **A5** An ordinary-OCR baseline on the fixture is affordable and obtainable — D3 never obtained a live OCR comparator, so its cost is unknown, not cheap.

### Where I disagree with the selected direction

1. **"Reuse the observation system" is only half true.** Observations are reusable; *criteria* are not modelled anywhere. Roughly half the new code is result semantics, not investigation.
2. **The 300-round default is the wrong shape for this problem.** `behavior_template.json` sets `MAX_TOOL_REQUEST_TIMES: 300`, `MAX_TOKENS: 200000`. A requirements session needs a *small* round cap (8) and an aggregate token budget, because the bound that matters is cost, not rounds.
3. **Truncation is detected by parsing English.** Any reuse that copies `behaviortask/code.go`'s prefix checks inherits a brittle coupling to upstream prose. Prefer explicit provider result types where they exist, and assert the string contract in one seam test where they do not.
4. **A second fixture is not justified yet.** Two purpose-built projects before one measured case is how D3 accumulated controls without a live comparator. Start with one; the trigger for the second is in §10.

---

## 2. The actual native reuse seam

### 2.1 What exists (inspected at `8a70944f`)

| Component | Location | What it provides today |
| --- | --- | --- |
| Task contract | `internal/llmloop/task.go` | `Task{ToolDefs, ExecuteTool, MaxRounds, MaxContextTokens, MaxCompletionTokens, EmptyResponseMessage, Compression, Grace}`; `ToolExecutor` returns `ToolOutcome{Content, Action}` with `Continue|Complete|Fail`. |
| Driver | `internal/llmloop/loop.go` | `Run` → `runMainTask`: round budget, aggregate token budget check before dispatch, empty-round guard, three-zone compression at 60 %/80 %, `MainLoopStop` enum, grace round on spent budget, `FinalSubmission` bypass. |
| Working example | `internal/behaviortask/*` | A complete read-only investigation: preparation, authorized allowed-set, read/search/find/diff tools, append-only observations, a submission tool, budget wrapper, artifacts. |
| Code access | `internal/tool/{code_access,code_search,file_read,file_find,filereader}.go` | Revision-bound readers, Git-backed search with a 100-match cap and truncation note, name matching with a 100-result cap. |
| Session trace | `internal/session/history.go:165` `NewAnalysisTrace` | Creates a run-local trace with its own `trace.jsonl`; used by `behaviortask` without touching the review session enum. |
| Budget bridge | `internal/llm/budget.go` `FinalSubmissionClient`; `internal/behaviortask/budget.go` | Wraps the client so the aggregate budget blocks investigation but never the final submission. |
| Concurrency | `internal/workflow/run.go` | Runs review and analysis concurrently and joins them; a template for running requirements alongside review without changing review. |

### 2.2 What actually blocks a Requirements task today

Four concrete blockers, each with the smallest resolution:

1. **Submission is Markdown-only.** `submit_analysis` accepts `{markdown, declared_completion}` and validation checks only length, whitespace and `[[obs-…]]` citations. → New tool `submit_requirements` with a typed schema; no shared edit.
2. **The result schema is behaviour-specific.** `ocr.behavior-impact/v2` describes a comparison and a brief. → New `ocr.requirements/v1` alongside it; `workflow.Outcome` is untouched unless we later run both.
3. **The tool layer is private.** `codeTools`, `observationStore`, `readContext` live in `behaviortask`. → Re-express the ~500-line policy layer in the new package against exported `internal/tool` APIs; do **not** lift `behaviortask` internals.
4. **No command exists.** `root.go` registers eleven subcommands; `review --analysis` is the only entry to `behaviortask`. → One new command file plus one `AddCommand` line.

Nothing in `internal/llmloop` must change. That is the finding that decides the direction.

### 2.3 Package-level shape

```
internal/requirementstask/      NEW   (no import of behaviortask)
  result.go        typed contract + artifacts
  prepare.go       candidate binding, requirement bundle, changed inventory
  code.go          authorized allowed-set + tool registry
  search.go        scoped path batching
  observation.go   append-only store + paging
  budget.go        aggregate budget + submission reserve
  validate.go      submission schema, coverage, duplicate/stale rules
  runner.go        prompt assembly + llmloop wiring
  prompts/         system + task + final-round (embedded)
cmd/opencodereview/requirements.go  NEW  (flag parsing, artifact location, exit codes)
cmd/opencodereview/root.go           +1 line in init()
```

`internal/requirementstask` would import: `internal/llmloop`, `internal/llm`, `internal/tool`,
`internal/gitcmd`, `internal/diff`, `internal/model`, `internal/session`, `internal/config/allowlist`,
`internal/config/rules`, `github.com/google/jsonschema-go/jsonschema`. All are exported APIs already consumed
across package boundaries inside the module; `internal/` visibility is satisfied because the package
lives in the same module.

Deliberately **not** done: no import of `behaviortask` (avoids coupling to a package whose semantics are
"behaviour and impact" and whose internals upstream is actively editing), no second copy of the loop, no
plugin system, no separate long-lived fork.

---

## 3. Source-level change map

| Path | Current responsibility | Required change | New/existing | Shared upstream behaviour | Why necessary | Regression exposure | Expected upstream conflict | Size (lines) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `internal/requirementstask/result.go` | — | Typed result: candidate identity, requirement inventory, per-criterion states, coverage, execution, usage | new | no | No typed criteria contract exists | none | none (new path) | 180–250 |
| `internal/requirementstask/prepare.go` | — | Bind immutable head/base, task text digest, requirement bundle digest; read changed inventory via `git diff --name-status -z`; apply head `.gitignore` | new | no | Identity binding is the only defence against stale evidence | none | none | 150–220 |
| `internal/requirementstask/code.go` | — | Authorized allowed-set from `git ls-tree -r -z`, secret/symlink/unsupported exclusions, tool registry, location extraction | new | no | Reads must be revision-bound and authorized | none | low (mirrors `behaviortask/code.go`, actively edited upstream) | 180–240 |
| `internal/requirementstask/search.go` | — | Pathspec batching for scoped search; explicit truncation from provider contract | new | no | Whole-tree search must be bounded and observable | none | low | 110–160 |
| `internal/requirementstask/observation.go` | — | Append-only `observations.jsonl`; page replay; compact locations | new | no | Evidence must survive later turns and a partial stop | none | none | 150–200 |
| `internal/requirementstask/findings.go` | — | Append-only `findings.jsonl`: accepted criterion states bound to observation IDs + candidate digest | new | no | Partial results cannot be reconstructed from a final report | none | none | 120–180 |
| `internal/requirementstask/budget.go` | — | Aggregate token budget wrapper; submission reserve | new | no | Cost bound is the real limit | none | none | 90–130 |
| `internal/requirementstask/validate.go` | — | Submission schema, citation existence, duplicate/stale detection, coverage arithmetic | new | no | A valid JSON claim must not become an admitted fact | none | none | 160–230 |
| `internal/requirementstask/runner.go` | — | Prompt assembly, `llmloop.Task` construction, dispatch, artifact write, exit status | new | no | Composition point | none | none | 260–340 |
| `internal/requirementstask/prompts/{system,task,final_round}.md` | — | Requirements-specific instructions (evidence protocol, no invented obligations, partial honesty) | new | no | The behaviour prompt is about impact, not criteria | none | none | 90–150 |
| `cmd/opencodereview/requirements.go` | — | `ocr requirements --commit/--from/--to`, requirement file input, artifact directory, JSON/text output, budgets | new | no | Entry point | none | low (new file in a directory with 70 drifting files) | 180–260 |
| `cmd/opencodereview/root.go` | Subcommand registration | `rootCmd.AddCommand(requirementsCmd)` | existing | **yes** | Discovery | trivial | **very low** (init block is stable) | 1–3 |
| `internal/config/template/*` | Review/behaviour prompts and budgets | none — prompts embedded in the new package | — | no | Avoids editing a shared loader | none | none | 0 |
| `internal/tool/*` | Revision-bound readers and search | none (consume as-is) | existing | no | Reuse | — | **moderate contract drift** (see §4) | 0 |
| `internal/llmloop/*` | Investigation driver | none | existing | no | Reuse | — | none | 0 |

### Separate estimates

| Category | Handwritten lines (range) |
| --- | --- |
| New Requirements-specific code | 1,150–1,750 |
| Minimal shared OCR refactoring | 0 (target) — 120 if a typed truncation helper is later exported from `internal/tool` |
| CLI wiring | 180–260 new + 1–3 shared |
| Tests and fixture harness | 900–1,400 |
| Fixture project | 700–1,100 (+250–400 probes) |
| Transport/budget changes | 0 (budget wrapper is new code, not a transport change) |
| Documentation | 120–220 |

Unknowns, marked: the exact cost of prompt iteration (typically the largest hidden line count in a task
of this kind); whether `file_read_diff` alone is sufficient for changed-file context in a large fixture;
whether `jsonschema-go` handles a nested criteria schema without a hand-written decoder.

---

## 4. Upstream conflict exposure

Measured, not guessed:

| Datum | Value |
| --- | --- |
| Upstream `alibaba/open-code-review` main | `d4f568f71d3a9d5c5ec972791b1509e40cd31ad1` (2026-11-25) — unchanged since the last inspection |
| Sync baseline | `39515dca6161fb7fd176d87704b2b10e5f7a0c36` (2026-11-21) |
| Upstream drift baseline → main | **20 commits, 235 files** |
| Drift inside our seam (`internal/{llmloop,behaviortask,tool,config/template,llm,session}`, `cmd/opencodereview`) | **70 files** |
| Maintained `agent-teams-ai/open-code-review` main | `5da4f4f9f2ef08a3a9f0f77a09e7252ab3647a54`, exactly **1 commit** ahead of the pinned `8a70944f` |
| That commit's files | `internal/tool/code_search.go` (+75/−22), `file_find.go` (+1), `filereader.go` (+21), new `managed_context.go`, `internal/agent/agent.go`, `go.mod/go.sum`, docs, qualification tool |

Interpretation:

- **Merge conflicts on our work: near zero.** Every Requirements file is a new path; the only shared
  file is a three-line registration block.
- **Semantic drift: the real risk.** Two coupling points are prose contracts, not types: the search
  truncation note (`"Note: Showing the first …"`) and the file-read header (`IS_TRUNCATED: true`). Both
  are parsed by `behaviortask/code.go` today and would be re-parsed by us. Upstream rewrote
  `code_search.go` last commit.
- **Mitigation**: (1) one seam test that asserts both contracts on a fixture and fails loudly on sync;
  (2) prefer counting matches/locations from structured fields where the provider returns them; (3)
  treat the pinned commit as the qualification baseline and record any sync commit in the attempt.

---

## 5. Option A versus Option B

**Option A** — one bounded native task (recommended). **Option B** — a fixed two-pass adapter: bounded
source collection, then one scoped assessment, reusing the retained D3 one-shot Gateway runner
(`@agent-teams/account-gateway/llm`, `json_schema`, one request per pass).

| Criterion | A: native adaptive | B: fixed two-pass |
| --- | --- | --- |
| Total implementation complexity | 1,150–1,750 new lines + tests | 250–450 new lines (assessment already exists) |
| Shared upstream changes | 1–3 lines | 0–20 lines (reuse `llmloop` or the Gateway SDK directly) |
| Maintenance / merge exposure | new paths; contract drift on `internal/tool` | new orchestration outside OCR; two prompt stacks |
| Source-access reliability | `git`-bound readers, authorized allowed-set, revision recorded per observation | whatever the collector fetches; usually a hand-built packet |
| Multi-hop investigation | yes, budget-bounded | **no** — pass 2 cannot fetch what pass 1 did not anticipate |
| Evidence provenance | per-observation ID, revision, locations, hash | per-request input digest only |
| Partial result support | findings persisted per turn; grace submission | only the two fixed passes; a failed pass yields nothing |
| Budget enforceability | aggregate token budget + round cap + reserve, in one place | two independent budgets; the second is unconditional |
| Model-call overhead | 1 for simple, 4–6 for complex | always 2 (or 1 if the packet is hand-built) |
| Repeated prompt/context cost | grows per turn (context re-sent) | one large packet + one packet+evidence prompt (~2× packet) |
| Testability | real loop, fake provider, real git — deterministic | simpler; but multi-hop behaviour is untestable by construction |
| Reuse in ReviewRouter later | OCR-native task is a portable notion; tools are Git-bound | Gateway client already lives on the RR side |
| Requirements contract independence | typed contract owned by this package | same contract, but embedded in prompts |

**Why A by default**: B cannot satisfy the four requirements that make this research worth doing —
multi-hop discovery (§6), honest partial coverage after budget exhaustion (§5), per-criterion evidence
identity, and a single enforceable budget. B's cost advantage is real but it buys a mechanism whose
ceiling is the packet a human already had to assemble, which is exactly the reader effort D3 failed to
reduce.

**Concrete switch condition** (any one triggers the fallback, recorded with the evidence):
1. the seam spike needs **> 600 lines** of shared-file edits (not counting the new package), or
2. in **two consecutive** fixture cases the accepted result is reached on turn 1 with no tool call, *and*
   per-case cost is not lower than B's two requests, or
3. across the planned live subset, adding turns never changes a criterion's state in a case where the
   frozen expectation required multi-hop evidence, or
4. ordinary managed OCR regression cannot be kept green with the new command present.

---

## 6. Rough LOC and development complexity

| Work package | Lines (range) | Complexity |
| --- | --- | --- |
| Result contract + artifact writing | 180–250 | medium (schema design, M2-compatible states) |
| Preparation + identity binding | 150–220 | medium (Git plumbing, digests) |
| Authorized code access + search policy | 290–400 | **high** (security exclusions, truncation semantics) |
| Observation + finding persistence | 270–380 | medium (append-only, crash-visible) |
| Budget + reserve | 90–130 | low |
| Validation + coverage | 160–230 | **high** (duplicate/stale/absent rules) |
| Runner + prompts | 350–490 | medium |
| CLI | 180–260 | low–medium |
| Tests | 900–1,400 | medium |
| Fixture + probes | 950–1,500 | medium |
| **Total** | **≈ 3,500–5,300** | |

Confidence: medium on the code ranges (anchored on `behaviortask`'s actual 1,750 lines for a
narrower feature set), low on prompt-iteration effort, which is usually 20–40 % of a task like this and
is excluded above.

---

## 7. Adaptive session lifecycle

One run, one candidate, one requirements revision.

| Stage | What happens | Model call? |
| --- | --- | --- |
| 1. Bind candidate | Resolve `--commit` or `--from/--to` to full SHAs; reject short/ambiguous; record `comparison_id` = sha256 of (repo, mode, old, head). | no |
| 2. Bind requirements | Read task text + bundle; hash `requirements_sha256`; validate the requirement file against `ocr.requirements/v1`; refuse to start if any requirement lacks an authored source. | no |
| 3. Assemble initial context | Comparison manifest, changed inventory (path, status, excluded reason), requirement bundle, optional captured context with provenance. Oversized inventories become paged `context_read` indexes (as `behaviortask` does). | no |
| 4. First turn | System + task prompt; tools: `file_read`, `code_search`, `file_find`, `file_read_diff`, `context_read`, `record_finding`, `submit_requirements`. A sufficient packet may submit immediately. | yes (1) |
| 5. Investigate | Each read/search produces an observation with revision, locations, hash, truncation, error class. Batched: no call per file or per criterion. | yes (+1 per turn) |
| 6. Optional additional source | Model narrows by `file_patterns` or line range, or replays a paged context/observation. Bounded by source-op count and bytes. | same turn |
| 7. Persist findings | `record_finding` appends one criterion state to `findings.jsonl` with observation IDs and the candidate digest. Rejected if it cites a failed/absent observation, a different comparison, or an unknown criterion ID. | same turn |
| 8. Submit | `submit_requirements` is the only completion tool; the first valid submission is frozen. After a spent budget, a submission-only grace round with the reserve. | +1 (grace) |

Budget mechanics that already exist and are reused verbatim: round cap (`MaxRounds`), aggregate token
budget checked before each dispatch (`tokenBudgetExceeded`), three-zone compression, `StopMaxRounds` /
`StopTokenBudget` reporting, and the `FinalSubmission` bypass in `requestBudget.complete`.

New: `MaxRounds = 8` (not 300), `MaxTokensBudget = 120000` per run, reserve = 1 submission-only round,
source-op cap = 8 beyond the first turn, read page default 16 KiB (max 64 KiB), search cap from provider
(100).

---

## 8. Partial-result and evidence semantics

### Result states

| State | Meaning | Emitted when |
| --- | --- | --- |
| `completed` | Every mandatory criterion has a state, submission accepted, no budget stop, no error | normal completion |
| `partial_budget` | Submission accepted after `StopMaxRounds`/`StopTokenBudget`; some criteria explicitly `not_assessed` | grace round |
| `partial_unavailable` | Source needed for a criterion is unavailable (excluded, missing at revision, encoding, permission) | submission with `unavailable` evidence class on that criterion |
| `failed` | No valid submission; investigation error, provider error, persistence failure | `ExecutionStatus` `failed` |
| `cancelled` | Context cancelled before/at submission; retained findings are reported, nothing is invented | `context.Canceled` |
| `invalid_submission` | Model never produced a schema-valid submission inside the budget | submission rejected in grace |

Rules carried over deliberately from `behaviortask`: a self-declared `complete` never overrides a
program-recorded budget stop, a cancellation, a provider error or an artifact write failure; `completed`
means the loop accepted a submission, not that the investigation was complete.

### Failure matrix

| Event | Behaviour | Recorded as |
| --- | --- | --- |
| Context/tokens exhausted | Stop before dispatch; grace submission; unassessed criteria stay `not_assessed` | `partial_budget` + stop reason |
| Source read fails | Observation stored with `error_class`; model may retry once with a narrower range; the criterion cannot be `satisfied` from a failed read | `unavailable` observation, `inconclusive` criterion |
| Search truncated | Stored with `truncated: true` and the provider's continuation hint; model must narrow; the criterion may be `inconclusive` but never `absent` | coverage: `search_truncated` |
| Malformed model final output | Rejected with the validator's message; repairable inside the remaining rounds; grace invalid is not retried | `invalid_submission` if unrepaired |
| Final request cannot be dispatched | Findings retained; no assessment invented | `failed` with reason, findings still written |
| Cancellation after a saved finding | Findings file intact; result `cancelled`; no completion claim | `cancelled` |
| Same observation submitted twice | Deduplicated by content hash; the second citation is ignored, not counted twice | provenance count = unique IDs |
| Same criterion recorded twice with different states | Both retained in `findings.jsonl`; final submission must resolve, else criterion is emitted `conflicting` and the run is `partial` | `conflicting` |
| Stale candidate/source revision observed | Observation carries its revision; a citation whose revision ≠ bound head is rejected | validation error, criterion `inconclusive` |

If no valid incremental finding exists at stop, the result is `failed` or `partial` with an explicit
`not_assessed` inventory — never a manufactured partial completion.

---

## 9. Terse-input interpretation policy

`ocr requirements` accepts an ordinary sentence. The run produces an **intent record** that is frozen
before implementation results are read and is not editable afterwards:

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

Rules enforced by the validator, not by prompt text:

- `ambiguous` and `optional` can never carry `mandatory: true` or a blocking decision; they are emitted
  as an owner question or a suggestion.
- `necessary_implication` requires a non-empty `whyNecessary` naming the requested outcome or an
  existing contract; a design choice ("use a transaction") without a behavioural obligation is rejected.
- Every criterion has exactly one state from `satisfied | violated | inconclusive | not_assessed |
  conflicting | unavailable`, and `satisfied` requires at least one cited observation without an error.
- The candidate cannot contribute requirements: any requirement whose provenance is the changed files is
  rejected at validation (the implementation does not define its own acceptance).
- An owner clarification arrives as a **new requirement revision** with a new sha256; applicability is
  re-evaluated; nothing is silently weakened or expanded.

No extra model call is introduced. The intent record is produced in turn 1 by the same session that
investigates, and its digest is recorded before findings. The owner's expected meaning used for
evaluation is frozen separately in evaluator-only files and never enters model input.

Evaluation of this policy is offline first (three frozen intents), then observed live on one terse case.

---

## 10. Fixtures

### Preferred first fixture — `quota-service` (workflow/budget service)

Purpose-built, runnable, product-like; not a clone of Agent Teams or UAP; not a mock of the verifier.

- HTTP API: `POST /v1/admit`, `POST /v1/usage`, `GET /v1/policy`, `GET /healthz`.
- Persisted policy and usage state (SQLite via `database/sql`, migration file).
- Admission + authorization (subject, scope, limit).
- Background worker with recovery of interrupted work on start.
- Usage/limit enforcement with an explicit boundary (limit reached, limit exceeded).
- Tests with the project's own command (`go test ./...`).
- ~700–1,100 lines, single toolchain already required by the research environment.

Fixture specification to freeze before any model input:

| Item | Content |
| --- | --- |
| Base commit | recorded full SHA |
| Ordinary task description | one paragraph, natural, no checklist |
| Owner-authored requirements | separate frozen file + sha256, evaluator-only copy of expected meaning |
| Candidate variants | see below |
| Normal test command | `go test ./...` |
| Independent probes | separate small program invoking the HTTP API directly (no verifier coupling) |
| Source-selection rules | which files a correct investigation must touch at minimum, and which are irrelevant |
| Evidence boundaries | one criterion intentionally requires a runtime receipt the repository does not contain |
| Version/digest policy | base, head, requirement revision, prompt revision |
| Recurring maintenance | ~1 h per variant when the fixture's own behaviour changes |

Variants (smallest discriminating subset, seven scenarios):

| ID | Scenario | Purpose |
| --- | --- | --- |
| S1 | Fully correct, boundary cases verified | justified completion |
| S2 | Missing feature despite green tests | confirmed mandatory violation |
| S3 | Cross-component wiring defect (worker never re-arms after recovery) | **multi-hop discovery** |
| S4 | Genuine unavailable evidence (needs an execution receipt) | missing-evidence request |
| S5 | Short natural task ("make quota accounting reliable") | terse intent |
| S6 | Material ambiguity ("keep over-limit requests fast" — reject vs queue vs cap) | owner clarification |
| S7 | Equivalent behaviour under a moved/renamed path + irrelevant diff | context-selection fragility (**held out of prompt tuning**) |

Controls: S1 must be *independently* verified with the probes — D3's mistake was calling a control
complete on a green suite alone.

### Conditional second fixture — `plugin-cli` (only if triggered)

Justified only if `quota-service` cannot exercise all of: manifest parsing, compatibility/adapter
selection, filesystem state, retry/recovery across projects, and genuinely irrelevant modules that a
naive search would return. Trigger: if S3 and S7 in the first fixture are answered by single-hop reads
(i.e. the changed file already contains the decisive evidence), the first fixture has not qualified
multi-hop discovery and a second topology (CLI + adapter registry) is worth building. Otherwise skip it.

---

## 11. Model-free E2E qualification tests

Deterministic fake provider replies; real `llmloop`, real `internal/tool`, real git revisions; no
network, no credentials, no spend. Each test is engineering qualification only — it can never show
semantic quality.

| ID | Test | Assertion |
| --- | --- | --- |
| T1 | Ordinary managed OCR regression | `ocr review` and `ocr review --analysis` on a fixture produce byte-identical artifacts/exit codes versus the pinned baseline |
| T2 | Immutable candidate binding | submitting a head other than the bound head is rejected; observation revision ≠ bound head is rejected |
| T3 | Authorized source access | excluded, secret-like, symlink and unsupported paths are `unavailable` through read, search, find and enumeration |
| T4 | Observation identity and provenance | every observation has ID, revision, locations, content hash; citations resolve; uncited reports allowed but flagged |
| T5 | 601-match truncation regression | unscoped search of the fixture returns exactly 100 matches with the truncation note and matching-file count; the relevant `src/core/wiring.ts` is outside that page; `file_patterns: ["src/core/**"]` returns it; no-match, truncated, excluded and read-error remain four distinct states |
| T6 | Incomplete coverage | a run with two unread criteria emits `not_assessed` + `partial_*`; no `satisfied` |
| T7 | Typed final submission | invalid schema, unknown criterion ID, ambiguous marked mandatory, and implementation-derived requirement are each rejected with a distinct message |
| T8 | Incremental persistence | after N `record_finding` calls the file contains exactly N accepted entries; a rejected call appends nothing |
| T9 | Duplicate/stale handling | duplicate citation deduped; conflicting states preserved and reported; stale revision rejected |
| T10 | Hard limits | round cap, token budget, source-op cap and page size each stop the run at the declared point with the right stop reason |
| T11 | Submission reservation | with the budget already exhausted, one submission-only request still dispatches and is accepted |
| T12 | Cancellation and timeout | cancel after a saved finding → `cancelled`, findings intact; timeout → distinct reason |
| T13 | Invalid/missing final response | malformed JSON, then repair, then unrepaired → `invalid_submission`, no completion claim |
| T14 | Error and refusal accounting | provider HTTP error, refusal text, empty tool rounds → recorded, never counted as assessment |
| T15 | Baseline preservation | review path unchanged when the new command is present (no shared-state coupling) |
| T16 | Seam equivalence | `file_read`/`code_search`/`file_find` truncation flags, locations and error classes match between the new package and `behaviortask` on the same fixture |

If any shared extraction is ever proposed, add a disposable-worktree merge/rebase smoke test against the
then-current upstream main. Not performed in this phase: no upstream sync, no branch change.

---

## 12. Minimal planned live semantic evaluation (planning only)

Five fixed cases, one run each, predeclared expectations frozen before dispatch. Ordinary OCR plus the
project's own checks is the baseline; the D3 one-shot is used only where the packet genuinely applies.

| Case | Fixture | Mechanism(s) | Decision it resolves |
| --- | --- | --- | --- |
| L1 | S1 | adaptive + ordinary OCR | justified completion: does it avoid inventing defects? |
| L2 | S2 | adaptive + ordinary OCR | confirmed missing requirement: is it found and evidenced? |
| L3 | S3 | adaptive + ordinary OCR (**the multi-hop case**) | disconnected cross-component behaviour |
| L4 | S5 | adaptive only | terse natural request |
| L5 | S4 | adaptive only | honest insufficient evidence / partial under budget |

Not every mechanism on every case. S6 (ambiguity) is evaluated offline against the intent record first;
it goes live only if L1–L5 leave the ambiguity policy unexercised. S7 stays held out.

Capture per case: owner action expected vs produced; confirmed and missed violations; unsupported
satisfactions; unnecessary required corrections; missing-evidence requests; observation IDs and coverage;
false absence due to truncation; actual provider requests; repeated input bytes/tokens; usage and
reasoning tokens; wall time; manual setup and reader time; incremental cost over baseline.

No model result is its own ground truth. A small sample cannot establish population accuracy.

---

## 13. Numerical limits (planning envelope)

**Verified measured values** (from the retained D3 receipts):

| Quantity | Value |
| --- | --- |
| One-shot request body | 26,773 B (packet 24,078 B) |
| Tokens per one-shot request | 6,045 input / 2,127 output (1,204 reasoning) |
| Wall time | 35 s |
| Charged cost | USD 0.01819125 at input USD 1.25/M, output USD 5.00/M |
| D3-R2 average per reply | ≈ USD 0.0139 (4 replies, USD 0.05555250) |
| OCR default budgets | `MAX_TOKENS 200000`, `MAX_COMPLETION_TOKENS 16384`, `MAX_TOOL_REQUEST_TIMES 300` |
| OCR search cap / page size | 100 matches; 16 KiB default page, 64 KiB max |

**Conservative estimates** (stated assumptions: each turn re-sends context, +4–8 KB per turn, 1.5 k
output tokens per turn, no prompt-cache discount assumed):

| Shape | Requests | Input tokens | Output tokens | Cost (USD) |
| --- | --- | --- | --- | --- |
| Simple, turn-1 submission | 1 | 6,000 | 1,500 | 0.015–0.020 |
| Moderate | 2–3 | 12,000–26,000 | 3,000–4,500 | 0.045–0.070 |
| Complex | 4–6 | 44,000–66,000 | 6,000–9,000 | 0.09–0.15 |
| Worst allowed case (cap) | 8 | ≈104,000 | ≈12,000 | ≈0.19 |

**Proposed limits for the D4 live phase**

| Limit | Value |
| --- | --- |
| Requests per case | 8 maximum including the grace submission |
| Aggregate tokens per case | 120,000 |
| Context window | OCR default 200,000 (unchanged); prompt is ~10–20 % of it |
| Source operations | 8 beyond the first turn |
| Reads | page 16 KiB default, 64 KiB max; search 100 matches |
| Findings | ≤ 50 per run (fixture scale); 1 record per accepted criterion state |
| Wall time | 10 min per case, 60 min total |
| Per-case cost cap | USD 0.20 |
| **Total live ceiling** | **USD 0.90** (expected actual 0.42–0.60) |
| Abort | stop the batch if aggregate spend reaches USD 0.90 or any case fails twice |

D3's remaining USD 0.36696625 is **not** an allowance and is not drawn on. These figures are conservative
ledger estimates, not settled provider billing.

**Unknowns requiring preflight (no spend)**: the ordinary-OCR managed credit unit and per-request charge
(D3 never obtained a live comparator); whether the managed channel accepts a new subcommand; prompt-cache
read pricing; fixture test runtime.

---

## 14. Stop and fallback criteria

*Material failure* — any one ends the direction as proposed:

1. an unsupported `satisfied` on a mandatory requirement (including "complete" while a mandatory clause is unassessed);
2. a partial run reported as `completed`;
3. a stale or different candidate accepted as the assessed one;
4. ordinary managed OCR regression (`ocr review`, `ocr review --analysis`) in artifacts or exit status;
5. no actionable difference from ordinary OCR/checks on the multi-hop case, *and* no material reduction in reader work.

*Proportionate maintenance*: if the new package needs more than ~600 shared-file lines, or every upstream
sync breaks the seam test, the value does not justify the coupling → Option B.

*Cost*: if measured cost per complex case exceeds 2× the estimate in §13 without a demonstrated decision
difference, stop and re-scope to two cases.

*Scope*: the plan does not start the genuine-team-task phase, does not merge M2 PR #2, does not publish
anything, and does not change the OCR policy or reviewer context.

---

## 15. Recommendation and the decisions Iliya must make

**Recommendation**: approve **Option A scoped to one package and one fixture**, with the live envelope in
§13, and treat Option B as the recorded fallback with the switch condition in §5.

Exact decisions requested:

1. **Scope approval** — `internal/requirementstask` + `ocr requirements` + one fixture (`quota-service`), as mapped in §3, with a 1–3 line shared-file delta. Approve, or require the fallback first.
2. **Fixture scope** — one project now, second only on the §10 trigger. Approve, or require both up front (cost: +0.5–1 week, no measured benefit yet).
3. **Live authorization** — a *new* ceiling of USD 0.90 for five cases (expected 0.42–0.60), per-case 0.20, 8 requests, 120 k tokens, 10 min. D3's remainder is not reused.
4. **Baseline credential line** — confirm which account/credit line may run the ordinary-OCR comparator, or accept that L1–L3 run without an OCR column and say so in the report.
5. **Bookkeeping** — accept the D3 index residue in Appendix A as documented-and-closed rather than corrected in place.

Until 1–4 are answered: no implementation, no provider request, no fixture build against a live key, no
commit to a production repository.

---

## Appendix A — Bounded D3 bookkeeping item (documented, not corrected)

`synthetic/next-family/runs/D3-R3-INDEX.json` still reports:

```
"counts": { "confirmedRequiredViolations": 8, "confirmedMechanisms": 5, ... }
```

The corrected values, already published in `D3-R3-REPORT.md` (§ summary, erratum §14) and
`adjudication/ADJUDICATION.md`, are **7 confirmed required violations** and **2 mechanisms**; the `5`
referred to matrix claim rows, and `8` came from adding the clause-level `INSUFFICIENT_EVIDENCE` entry to
the seven violation rows.

This is a machine-index field left stale by the authorized erratum. It is recorded here as a bounded
bookkeeping residue. No D3 record is edited, no raw output is regenerated, and D3 is not reopened. The
next person who reads the index should read the report's 7/2.

## Appendix B — Repositories and exact commits examined

| Repository | Commit / state | How examined |
| --- | --- | --- |
| `agent-teams-ai/open-code-review` | `8a70944f567beba9ffc12d1153e33ef5fd60967d` (qualification baseline); main `5da4f4f9f2ef08a3a9f0f77a09e7252ab3647a54` (1 commit ahead) | GitHub tree/raw at the pinned commit; no local clone present; no branch change, no sync |
| `alibaba/open-code-review` (upstream) | main `d4f568f71d3a9d5c5ec972791b1509e40cd31ad1`; sync baseline `39515dca6161fb7fd176d87704b2b10e5f7a0c36` | GitHub API compare (20 commits, 235 files) |
| `agent-teams-ai/task-verification` | `9c21a7b00c53243315fd86a7a921c76c6d6c69d4` on `exp/synthetic-live-pilot-01`; M2 worktree `996cdcb` | local worktree, clean |
| `agent-teams-ai/account-gateway` | `c6d73002ac28bb11c3d2e88d135a05c7f2f06bd6` (`llm/domain/task.ts`) | raw file read; no local clone |
| `777genius/review-router` | `e3788de2ada1f33ca51db37426a5704a78efeb9b` (V4 contract + 5 read tools) | local clone, source read |
| Docker image | `m2-ocr-rr7:local` (binary `443d7777…`, 87,356,967 B, `open-code-review 1.14.0-rr.1 linux/amd64`) | retained D3 artifact record |

Reproduction note: the OCR source was read from the pinned commit because no local checkout exists on
this machine; the D3 binary image is local and was not exercised in this phase.
