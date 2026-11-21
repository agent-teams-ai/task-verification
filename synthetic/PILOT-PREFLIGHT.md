# C1 provider-access preflight — BLOCKED

Date: 2026-11-21. Scope: the single bounded synthetic experiment authorized by the maintainer.

**Result: STOPPED BEFORE ANY LIVE REQUEST.** No model, provider, OCR or coding-agent call was made.
Requests: 0. Input tokens: 0. Output tokens: 0. Spend: USD 0.00.

## What was checked

| # | C1 requirement | Finding | Evidence |
| --- | --- | --- | --- |
| 1 | Locate the existing authorized provider/SDK connection | **None exists in this workspace.** | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GATEWAY_TOKEN`, `OCR_API_KEY` are all unset (only the names were inspected, never values); no `.env`/`.dev.vars` file exists; `vendor/review-router/…` contains a README and three source files, no client or credential; no signed-in provider CLI (`codex`, `claude`, `gemini` absent). |
| 2 | Confirm `gpt-6.1-terra` is available through that connection | **Cannot be confirmed — no connection to ask.** The only local model runtime is Ollama, which serves `qwen3.5:4b`, `qwen2.5:7b-instruct`, `bge-m3:latest`, `qwen3-embedding:0.6b` and cannot serve an OpenAI model. | `ollama list` |
| 3 | Confirm `reasoning.effort=medium` | **Not verifiable.** No Responses-API route exists to send the parameter, and no adapter in this repository binds `gpt-6.1-terra`. | repository search: no provider client, no model id |
| 4 | Confirm the route is the Responses API | **Not verifiable** for the same reason. | as above |
| 5 | Identify the ordinary OCR configured provider and model | **No local OCR configuration exists.** `~/.opencodereview/config.json` is absent, and the approved OCR asset is a Linux amd64 release (`opencodereview-linux-amd64`) fetched and exercised only in CI; there is no local binary to run. | `~/.opencodereview/config.json` exists: false; `.github/workflows/ci.yml` rr7-ocr job |
| 6 | Determine actual pricing for all model routes, including OCR | **Only the maintainer-supplied rate is available** (`gpt-6.1-terra`: USD 1 / 1M input, USD 5 / 1M output). No authoritative live rate could be confirmed for the criteria route, and none at all for OCR, because no provider account or OCR installation exists here. C2 requires stopping when actual prices cannot be established. | — |
| 7 | Confirm usage and request counts can be observed | **Not confirmable.** There is no provider console, no usage endpoint and no adapter emitting usage records for a live call. | — |

## Exact missing connection

No authorized OpenAI Responses API credential for `gpt-6.1-terra` is present on this machine or in
this repository. Either of the following would unblock the experiment:

1. an `OPENAI_API_KEY` (or the project's `GATEWAY_TOKEN`) supplied for this run through the
   environment of the process that would perform it, with access to `gpt-6.1-terra`; or
2. an already-authorized adapter/gateway endpoint that serves `gpt-6.1-terra` and reports usage.

The ordinary OCR path additionally needs a platform on which the approved
`opencodereview-linux-amd64` asset and its configuration exist (its CI container satisfies this; this
Windows host does not).

## Hard limits (unchanged, unspent)

| Limit | Value | Used |
| --- | --- | --- |
| Total inference requests | 8 | 0 |
| Input tokens / request | 20,000 | 0 |
| Output tokens / request | 4,000 | 0 |
| Total input / output tokens | 120,000 / 24,000 | 0 / 0 |
| Per-request timeout | 150 s | — |
| Wall clock | 30 min | 0 min |
| Spend | USD 1.00 | USD 0.00 |

No retry, replay or ambiguity occurred because no request was sent. Nothing was spent, and no
credential was created, read or printed.
