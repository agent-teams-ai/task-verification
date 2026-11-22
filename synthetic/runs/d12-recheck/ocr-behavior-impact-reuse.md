# OCR Behavior/Impact task — reuse evaluation (source inspection only)

Source: `agent-teams-ai/open-code-review` at the qualified commit
`8a70944f567beba9ffc12d1153e33ef5fd60967d`, package `internal/behaviortask/`,
CLI wiring `cmd/opencodereview/analysis.go`, template `internal/config/template/behavior.go`.

No model call was made for this evaluation. Nothing was enabled in the frozen pilot and the
OCR binary was not modified.

## What exists today

| Capability | Finding |
| --- | --- |
| Entry point | `ocr review --from <base> [--to <head>] --analysis` (and `--commit <sha> --analysis`), combined through `internal/workflow` |
| Task shape | one read-only investigation using `llmloop.Task`; does not change `ocr review`/`scan`, start MCP, collect comments or execute repository code |
| Evidence model | every executed code/context read persists an **observation** with comparison identity, normalized arguments, returned-text hash, exact observed locations, truncation state and error classification |
| Broader investigation | `code_search`, `file_read`, `file_read_diff`, `file_find`, plus `context_read` over injected material, paginated inventory indexes (16 KiB default page, 64 KiB max) and existing observations |
| Preparation boundary | caller passes resolved SHAs to `PrepareInput`; the task receives the **full** authorized diff inventory including deletions and renames, and does **not** use Review's selected-file list. Credential-like paths, symlinks, excluded directories and unsupported paths are unavailable to reads, searches, enumeration and diffs |
| Output contract | `submit_analysis` only; v2 takes one `markdown` string (≤256 KiB, not whitespace-only) plus optional `declared_completion` ∈ {`complete`, `partial`, `unknown`} |
| Provenance in output | literal `[[obs-000001]]` markers; validation checks marker syntax and that each referenced ID exists in this run |
| Per-criterion verdicts | **no**. Markdown is not parsed into a semantic schema; there is no requirement model, no status enum per requirement, no evidence-per-requirement binding |
| Budget | analysis has no total token limit by default (`--analysis-max-tokens-budget 0`); `--max-tokens` bounds each prompt; at most one additional concurrent request |
| Managed mode | `--analysis` is explicitly rejected with `--reviewrouter-managed` (`cmd/opencodereview/analysis.go:35`) |
| Failure semantics | an analysis failure does not change review's exit status; usage is reported separately |

## Verdict as a reuse candidate

1. **Strongest existing asset for trustworthy requirement evidence.** The observation ledger is
   exactly the machine-checkable provenance a requirement verdict needs: identity, arguments, text
   hash, observed locations. A per-requirement verdict could cite observation ids instead of prose.
2. **It does not implement requirement verification.** It produces a maintainer brief, not one
   status per requirement, and its contract deliberately refuses a semantic schema. Claiming
   otherwise would misdescribe the component.
3. **Not usable in managed mode.** The frozen pilot runs `--reviewrouter-managed`; `--analysis` is
   rejected in that mode, so adopting it means changing the consumer mode, not a flag.
4. **Unbounded by default.** Its own budget defaults to unlimited; a bounded product path must set
   `--analysis-max-tokens-budget` and still reconciles only after the fact, unlike the pilot's
   pre-dispatch token reservation.

## Comparison with the alternatives

| Approach | Evidence provenance | Per-requirement verdict | Managed-mode compatible | Integration effort | Cost profile |
| --- | --- | --- | --- | --- | --- |
| Reuse Behavior/Impact as-is | strong (observation ledger) | no | no | high: new consumer contract, non-managed mode, budget policy | unbounded by default, one extra concurrent request |
| Separate bounded criteria call (tested) | none from the SDK; evidence is caller-assembled | yes, with evidence references | yes (existing `/llm` path) | low: one call, fixed instructions + schema | one request, ~USD 0.008 measured |
| Evidence-collection-first plus criteria call | mechanical, deterministic bundle | yes | yes | medium: deterministic file selection + check capture, then the same call | one request |

The smallest implementation that can deliver a per-requirement verdict today is therefore the
bounded criteria call; the Behavior/Impact task is the better long-term evidence engine, but
reusing it requires a new verdict contract and leaving managed mode, which is outside this
experiment's authorization.
