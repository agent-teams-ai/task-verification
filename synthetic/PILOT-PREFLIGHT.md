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

---

# OpenRouter preflight re-check — 2026-11-21 (BLOCKED, no request sent)

Re-run of Phases 0–3 after the maintainer announced an OpenRouter credential. **No inference request,
no HTTP request of any kind and no model catalog call was made.** Requests: 0. Tokens: 0. Spend: USD 0.00.

## Phase 0 — preflight and immutability (PASS)

| Check | Result |
| --- | --- |
| M2 local HEAD | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4` |
| PR #2 state | `OPEN`, `isDraft: true`, head ref `feat/m2-a-foundation-fixture-oracle`, head OID `996cdcb` (local = remote = PR head) |
| Synthetic branch | `exp/synthetic-live-pilot-01` at `62f8ea3`, working tree clean, unpushed |
| Base identity | `ce99b0d65d645124413a746ecb137b5497aad80f`, tree `0f6c4d8e…` |
| Candidate A identity | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9`, tree `aa4af8c4…`, 4 changed paths / 212 insertions |
| Bundle integrity | `git bundle verify`: 2 refs, complete history, sha1 |
| Requirements digest | `ca868a3fcc2a9100eabda736c48a8e107125a1f5a8477eede3665be96bde727f` — matches `DIGESTS.json` |
| Reviewer input manifest | unchanged (`4ffebc0d…`), unchanged `pr.json` (`9b48eb1b…`), unchanged `checks/RESULTS-A.md` (`85d60b7b…`) |
| Evaluator-only material | `synthetic/evaluator/` (`EXPECTATIONS.md`, `r3-export.test.ts`) still outside `repo/`, unreferenced by `pr.json` |
| Candidate B | **absent** — the fixture repo has one branch and exactly 2 commits |

Nothing frozen was modified: Candidate A, the requirements and the reviewer inputs are byte-identical.

## Phase 1 — OpenRouter environment detection (STOP)

No provider credential is visible to this process:

- The tool environment holds 69 variables; **none** matches `*key*`, `*token*`, `*openai*` or
  `*openrouter*` (names only; no value was read or printed).
- `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `GATEWAY_TOKEN` and
  `OCR_API_KEY` are all unset — in the process environment **and** at Windows `User` and `Machine`
  scope, so a fresh child shell cannot inherit them either.

Per Phase 1 this is a stop condition, so Phases 2 and 5–7 did not run. No repository `.env` was sought
or created, and no credential was created, copied or echoed.

## Phase 2 — model availability (NOT PERFORMED)

Not attempted. Consequently nothing is claimed about `openai/gpt-6.1-terra`, about the Responses route
at `POST https://openrouter.ai/api/v1/responses`, about `reasoning.effort=medium`, or about live
OpenRouter pricing. No substitute route, model or provider was tried.

## Phase 3 — OCR path preflight (binary present; policy missing)

| Item | Finding |
| --- | --- |
| Pinned asset | present at `/tmp/rr7/opencodereview-linux-amd64` |
| SHA-256 | `2f290fb407a5cb6fbe854cb6702b8c713325fce603a71c1be83f5284034aaa29` — **matches** the CI pin |
| Size | `80513021` bytes — **matches** `RR7_SIZE` |
| Format | ELF 64-bit x86-64, statically linked → Linux/amd64 only |
| Linux host | Docker Desktop 29.8.0 installed, Linux engine **not running**; WSL has only the `docker-desktop` distro, stopped |
| Endpoint override | supported: `custom_providers.<name>.{protocol: "openai-responses", url, api_key, model, timeout_sec, extra_body}` in `~/.opencodereview/config.json`, invoked with `review --reviewrouter-managed --provider … --model … --effort medium` |
| Original M1 OCR policy | **not recorded anywhere in this repository.** The only configuration is the WP7/WP8-A loopback fake (`provider: reviewrouter`, `model: rr7-fake-model`, `modelQualityMeasured: false`). No production OCR provider, model or rule set is retained, and `~/.opencodereview/config.json` does not exist on this host |
| Price / usage observability | undeterminable until the OCR model is named; the model/provider pair is the missing input |

So the binary and the endpoint mechanism are ready, but the **ordinary OCR policy itself** (its model,
provider account and rule set — the pilot proposal's M4, owned by "maintainer + OCR configuration
owner") is a maintainer input that does not exist here. Selecting one would mean inventing the policy
the run is supposed to hold constant, which Phase 3 forbids.

## Phase 4 — budget (unchanged, unspent)

| Limit | Value | Used |
| --- | --- | --- |
| Underlying inference requests | 8 | 0 |
| Initial OCR / Criteria requests | 2 / 1 | 0 / 0 |
| Correction / recheck OCR / recheck Criteria | 2 / 2 / 1 | 0 / 0 / 0 |
| Input / output tokens per request | 20,000 / 4,000 | — |
| Total input / output tokens | 120,000 / 24,000 | 0 / 0 |
| Per-request timeout | 150 s | — |
| Wall clock | 30 min | 0 min |
| Aggregate spend | USD 1.00 | USD 0.00 |

No retry, replay or ambiguous request occurred, because no request was sent.

## The two exact missing inputs

1. **Credential visibility.** `OPENROUTER_API_KEY` must exist in the environment of *this Agent
   process*, not only in a terminal the user opened. Because tool commands are fresh children of the
   app, the key has to be set before the app starts: `setx OPENROUTER_API_KEY "<key>"` (persists at
   `User` scope) plus a full quit and relaunch of the desktop app, or the app launched from a shell
   that already exports it.
2. **The ordinary OCR policy (M4).** The OCR model slug, the provider account that serves it, and the
   review rule set that ordinary OCR publishes under. With those three, the pinned binary can be run
   unchanged in a Linux container against OpenRouter's Responses endpoint through its documented
   `custom_providers` block, with a local recording proxy supplying per-request usage for accounting.

Until both exist, Phases 2 and 5–7 stay unstarted and the pilot makes no comparative claim.
