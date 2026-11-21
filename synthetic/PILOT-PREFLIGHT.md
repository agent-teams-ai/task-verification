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

---

# Phase C1-R — environment inheritance and OCR readiness recovery — 2026-11-21

Status: **recovery executed; live inference still not authorized by the gates below.**

## 1. Environment inheritance — root cause, resolved

The tool shell is a descendant of the app's own runtime, not a separate container, remote shell or
detached worker. Observed chain (child → root), same timestamp for the whole chain:

| PID | Process | Started | Note |
| --- | --- | --- | --- |
| 9100 | `bash.exe` | 17:39:20 | the command for this phase |
| 22164 | `bun.exe` | 17:37:33 | app runtime: `…\@codebufffreebuff-desktop\resources\bun\bun.exe` |
| 21128 | `Freebuff.exe` | 17:37:33 | single app instance, argument = this workspace path |
| 19008 | `powershell.exe` | 17:37:15 | the launching shell |
| 2036 | `explorer.exe` | 14:14:28 | desktop session |

Consequences:

- Tool commands inherit the environment **captured when `Freebuff.exe` started**. A variable exported
  after that moment cannot reach them, and re-running the app while an instance is already up reuses
  the old environment.
- Inheritance is therefore proven, not assumed: this session's app was started from a PowerShell
  process (`19008`) that already held the variables, and all four are present in the tool process.
- The earlier failure is consistent with the app having been started before the variables existed
  (no surviving process remains from that instance, so the old environment cannot be re-read; the
  conclusion is drawn from the observed mechanism, not from that dead process).

Presence in the tool process (booleans only, values never printed): `OPENROUTER_API_KEY` true,
`OPENROUTER_BASE_URL` true, `OPENAI_API_KEY` true, `OPENAI_BASE_URL` true. The two `OPENAI_*`
variables duplicate the same value and the same URL.

**Correction to the section above.** The earlier `setx` recommendation is withdrawn. Process-scoped
variables in the launching shell are sufficient, and `setx` would persist the key at User scope for
an operation that needs it for one bounded run.

## 2. Verified launch procedure

In one PowerShell window, with the app fully quit first (not minimized to the tray):

```powershell
$env:OPENROUTER_API_KEY  = '<key>'
$env:OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
& "$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop\Freebuff.exe"
```

Then confirm presence by booleans only. Do **not** set `OPENAI_API_KEY` / `OPENAI_BASE_URL` (see §8).

## 3. OpenRouter authentication and catalog (non-inference)

| Check | Result |
| --- | --- |
| `GET /api/v1/key` | `200`; valid key, not free tier; expires `2026-11-25T08:09:16Z` |
| Key limit | USD 5.00, remaining 4.973486 |
| Workspace budget (effective) | limit USD 10.00, spend 7.803423, **remaining 2.196577** |
| `GET /api/v1/models/openai/gpt-6.1-terra/endpoints` | `200`; exact approved slug present |
| `POST /api/v1/responses` with `{}` | `400 invalid_prompt "No input provided"` — route exists, no model invoked |

Endpoint pricing for `openai/gpt-6.1-terra` (per 1M tokens):

| Provider | Tag | Tier | Input | Output |
| --- | --- | --- | --- | --- |
| OpenAI | `openai/flex` | flex | 0.50 | 2.50 |
| Azure | `azure` | standard | 1.00 | 5.00 |
| OpenAI | `openai` | standard | 1.00 | 5.00 |
| OpenAI | `openai/fast` | priority | 2.00 | 10.00 |

Supported parameters include `reasoning`, `reasoning_effort`, `max_tokens`, `verbosity`. Standard is
the default tier and flex is used only when requested, so `service_tier: "default"` pins the 1.00/5.00
row the ceiling was computed from. A flex route would halve the price and is excluded by the brief.

## 4. Linux OCR runtime

Docker Desktop 4.91.0, engine 29.8.0, `os=linux arch=x86_64`, context `desktop-linux`. Local image
`m2-ocr-rr7:local` starts and reports `Linux x86_64`. WSL2 lists only the `docker-desktop` distro
(stopped); no separate distro is required because the engine itself runs Linux containers.

## 5. rr.7 asset identity (unchanged)

`80,513,021` bytes, SHA-256 `2f290fb4…4aaa29`, ELF x86-64; reports
`open-code-review 1.13.1-rr.7 linux/amd64`. WP7 model-free suite re-run in the container with
`--network none` and a read-only checkout: **16/16 pass**.

## 6. Ordinary OCR configuration — still not recovered

Established: the comparator is **Profile A as ordinary OCR** (configured rule set, native findings,
zero-model deterministic baseline), and the rule document shape is
`{ merge_system_rule: true, include: [...], rules: [{ id, content }] }` with the pinned
`--rule` / `--background` interface.

Not established: the live OCR model slug and serving provider; the production managed rule text
(`buildOcrControlledRuleText` lives in `777genius/review-router`, not in this repository); the prompt
and background text; publication/filtering policy; and any retained native, normalized or skipped
output from the historical rr.4 review. No `~/.opencodereview/config.json` exists. The only model this
repository has ever pointed the binary at is the loopback fake (`rr7-fake-model`), which is not a live
comparator.

## 7. Request-accounting finding (blocks the current ceiling)

One rr.7 managed review is not one HTTP request: the binary issues a file-grouping call, main-turn
calls, a filtering round and a follow-up turn. Measured here: **4 requests** for the M2 finding case
(asserted by `tests/rr7/wp7-rr7.test.ts`) and **5** in the release qualification. A refusal is retried
by the binary's own main-turn loop. The brief's `≤2` initial OCR and `≤2` recheck OCR therefore cannot
hold for a live OCR comparator; the 8-request ceiling needs re-approval, or to be defined per
invocation rather than per HTTP request.

## 8. Model-free suites and credential presence

`tests/wp7.ts` asserts that no provider credential is set; with `OPENAI_API_KEY` present it fails
(`OPENAI_API_KEY must not be set`, verified with a dummy value in the container), and
`scripts/qualify-sdk.mjs` / `scripts/qualify-profile-b.mjs` exit `2` by the same guard. Only
`OPENROUTER_*` should be set, and `OPENAI_*` removed for model-free runs.

## 9. Zero inference, zero spend

Requests made: `/key` (twice), `/models`, `/models/openai/gpt-6.1-terra/endpoints`, and one empty-body
`POST /responses` validation probe. Key usage before and after is identical at `0.026513769`
(delta `0.000000000`). Every pilot ceiling is unspent.

## 10. Readiness matrix

| Gate | State | Evidence |
| --- | --- | --- |
| Key visible in the actual Agent tool process | **PASS** | booleans true; ancestry chain (§1) |
| Exact model `openai/gpt-6.1-terra` available | **PASS** | endpoints `200`, exact id |
| Responses route + medium reasoning | **PASS** | route `400 invalid_prompt`; `reasoning_effort` supported |
| Explicit base URL (no implicit fallback) | **PASS** | `OPENROUTER_BASE_URL` set; binary config carries the URL |
| Linux/amd64 OCR runtime ready | **PASS** | engine `linux/x86_64`; container run 16/16 |
| Pinned rr.7 identity | **PASS** | size, SHA-256, `--version` |
| Ordinary OCR comparator model + rules frozen | **FAIL** | §6 — no live model, rule text or prior output |
| Request ceiling fits the OCR path | **FAIL** | §7 — 4–5 HTTP requests per review vs `≤2` |
| Request counts observable | **PARTIAL** | harness counts exactly; live counting needs a proxy or key-usage delta |
| USD 1.00 ceiling enforceable | **PARTIAL** | pricing confirmed; enforcement needs a per-request cap or key-limit change (approval required) |
| Both paths receive the original requirements | **PARTIAL** | frozen in `inputs/REVIEWER-INPUT-v1.md`; same boundary verified model-free, not live |
| No evaluator material in reviewer context | **PARTIAL** | evaluator outside `repo/`; canary test passes model-free, not live |

Verdict: **BLOCKED_WITH_EXACT_REMAINING_CAUSE** — the missing M4 live OCR model and rule policy, and
the OCR request allowance in the brief.

---

# Phase C1-R re-run — independent verification pass, 2026-11-21

Re-executed the recovery to check the record above rather than restate it. **Zero inference requests,
zero tokens, zero spend.** Key usage before and after this pass is identical at `0.026513769` (delta
`0.000000000`). No model, provider, OCR or coding-agent call was made; the only network calls were
`/api/v1/key`, `/api/v1/models/openai/gpt-6.1-terra/endpoints` and a `HEAD`/range-`0-0` fetch of the
release asset.

## 1. Preserved state — re-verified

| Item | Value | Result |
| --- | --- | --- |
| M2 HEAD | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4` | unchanged (local = PR #2 head OID) |
| PR #2 | `OPEN`, `isDraft: true`, head `feat/m2-a-foundation-fixture-oracle` | unchanged |
| Synthetic branch | `exp/synthetic-live-pilot-01`, working tree clean | unchanged |
| Base | `ce99b0d65d645124413a746ecb137b5497aad80f`, tree `0f6c4d8ea79485091f98baf2bf9d216e4d100beb` | matches |
| Candidate A | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9`, tree `aa4af8c4b01304cd1efac0917a0e9cca56374108`, 4 changed paths / +212 −4 | matches |
| Requirements | `sha256:ca868a3f…6bde727f` | matches `DIGESTS.json` |
| `pr.json` / `RESULTS-A.md` / `REVIEWER-INPUT-v1.md` | `9b48eb1b…` / `85d60b7b…` / `4ffebc0d…` | all unchanged |
| Bundle | `git bundle verify` → 2 refs, complete history, sha1 | passes |
| Candidate B | fixture repo: 1 branch, 2 commits total | **absent** |
| Evaluator material in `repo/` | no reference to `evaluator/`, `EXPECTATIONS`, `r3-export` | none leaked |

Nothing frozen was regenerated or edited.

## 2. Root cause — reproduced, not inferred

Fresh ancestry walk of the tool shell during this pass (child → root):

| PID | Process | Started |
| --- | --- | --- |
| 4524 | `powershell.exe` (this probe) | 18:06:41 |
| 10856–18152 | `bash.exe` ×3 | 18:06:41 |
| 22164 | `bun.exe` (app runtime) | 17:37:33 |
| 21128 | `Freebuff.exe` | 17:37:33 |
| 19008 | `powershell.exe` (launching shell) | 17:37:15 |
| 2036 | `explorer.exe` | 14:14:28 |

The tool process is a plain descendant of the app runtime. There is no detached worker, no separate
container and no second environment: each tool command is a fresh child of `bun.exe`, so it inherits the
block **captured when `Freebuff.exe` started** at 17:37:33 from the PowerShell launcher at 17:37:15.
That is why a variable exported after the app started, or an app relaunched into an existing
single-instance process, cannot reach the tools. `setx` is still not required and not recommended.

## 3. Four corrections to the record above

**(a) The rr.7 asset was not present and had to be re-fetched.** `find` across the workspace found no
copy, the `m2-ocr-rr7:local` image does not contain it (it ships only Node plus the canary tree), and no
container or volume retained it — the earlier `/tmp/rr7` path was container-local and non-durable. It was
re-fetched from the pinned release and verified:

| Check | Result |
| --- | --- |
| Size | `80513021` bytes — matches `RR7_SIZE` |
| SHA-256 | `2f290fb407a5cb6fbe854cb6702b8c713325fce603a71c1be83f5284034aaa29` — matches the pin |
| Format | `ELF 64-bit LSB x86-64`, statically linked |
| Execution | runs in the Linux/amd64 container under `--network none` → `open-code-review 1.13.1-rr.7 linux/amd64` |

**(b) `OPENAI_API_KEY` is set in the current app process**, with the same value as
`OPENROUTER_API_KEY` (equal SHA-256; neither value is printed here). This contradicts §2 of the record
above and it **trips the model-free guard**: `tests/wp7.ts` asserts `process.env.OPENAI_API_KEY === undefined`
and `scripts/qualify-sdk.mjs` / `scripts/qualify-profile-b.mjs` exit `2` on the same condition. The guard
fails today. Only `OPENROUTER_*` should be exported; `OPENAI_*` must be unset before any model-free run.

**(c) The production OCR rule text *is* recoverable locally.** The previous section stated
`buildOcrControlledRuleText` lives only in `777genius/review-router` "not in this repository". A local
clone of that repository exists (`D:/Project/review-router`) and the function is at
`src/review-orchestration/infrastructure/ocr-review-invocation-adapter.ts:235`. It emits, verbatim:

```
ReviewRouter managed additive policy (reviewrouter-managed-v1).
Report only issues material to this change: introduced or aggravated by the base-to-head diff.
For every finding describe the causal base-to-head change that creates or worsens the issue.
Allowed finding scope is the reviewed changed paths assigned to this run.
<Write finding titles and messages in {language}, or in the repository language when unset.>
```

as `{ "merge_system_rule": true, "include": [<assigned paths, sorted>], "rules": [{ "id": "reviewrouter-managed-v1", "content": <the five lines> }] }`.
Background is hard-bounded at `OCR_BACKGROUND_HARD_CHAR_LIMIT = 8000` characters (8000 continues, 8001
aborts).

**(d) The ordinary OCR model is admitted per run, not configured.** In
`production-t0-review-runner.ts:927` the model is `modelDispatchCapability?.model ?? runtimeEnv.CODEX_MODEL`,
and the runner throws `review_action_v2_ocr_model_missing` when neither is present. The dispatch capability
comes from the account gateway's admission document (`dispatchJson`), i.e. from the server-side evidence of
the review being compared against — not from this repository, not from `~/.opencodereview/config.json`
(absent on this host) and not from any committed default. `src/control-plane/review-agent-profiles.json`
pins the OCR *agent* (`ocr-managed-v5`, `1.13.1-rr.6`, transports `account_gateway` + `provider_api`,
`contextGateway: false`) but never a model slug.

## 4. Ordinary OCR configuration — what is now established

| Component | Status | Value / source |
| --- | --- | --- |
| Engine | recovered | managed `opencodereview-linux-amd64`, mode `--reviewrouter-managed` |
| Agent profile | recovered | `ocr-managed-v5` (`1.13.1-rr.6`); M2 pin is `1.13.1-rr.7` |
| Wire protocol | recovered | `openai-responses` via `custom_providers.<name>.protocol`; `codex-responses` and `anthropic-messages` also supported |
| Transport | recovered | `account_gateway` (primary), `provider_api` (v5+) |
| Rule text + JSON shape | **recovered verbatim** | §3(c) |
| Background | partially | bounded at 8000 chars; the *content* per run is supplied by the caller and not committed |
| Native tool policy | recovered | `contextGateway: false` for the OCR agent; `context-tools.v1` (gateway, run-scoped credentials, ≤4 servers) applies to the Codex/Claude agents, not to OCR |
| Normalization / filtering | recovered | outcome schema `reviewrouter.ocr-outcome/v1`; normalizer pinned to `777genius/review-router@7a079c38`, `normalizationBlobSha1 43bcfa54…`, `outcomeContractBlobSha1 5ba2ba5d…`, `unchanged: true` |
| Provider request counting | recovered | 4 HTTP requests for the M2 finding case, 5 in the release qualification — one managed review is **not** one request |
| **Live model slug** | **NOT recoverable here** | admitted per run by the account gateway (§3(d)) |
| Pricing | **blocked on the model** | `gpt-6.1-terra` standard is USD 1.00/5.00 per 1M; the OCR model is unnamed so its price cannot be stated |
| Prior native output (rr.4/rr.6 review) | **absent** | no retained `~/.opencodereview/config.json`, no captured native findings |

## 5. Recovered OpenRouter facts (non-inference)

| Check | Result |
| --- | --- |
| `GET /api/v1/key` | `200`; `is_free_tier: false`; key limit USD 5.00; usage `0.026513769`; remaining `4.973486231`; **expires `2026-11-25T08:09:16Z`** |
| `GET /models/openai/gpt-6.1-terra/endpoints` | `200`; exact slug present, `context_length` 1,050,000 |
| Endpoint prices / 1M | `openai/flex` 0.50 / 2.50 · `azure` 1.00 / 5.00 · `openai` 1.00 / 5.00 · `openai/fast` 2.00 / 10.00 |
| Supported parameters | includes `reasoning`, `reasoning_effort`, `max_tokens`, `verbosity`, `response_format`, `tools` |
| Reasoning note | `medium` is selectable via `reasoning_effort`; the brief's ceiling uses the `openai` standard row, so `service_tier: "default"` must pin it |

## 6. Readiness matrix — re-run

| Gate | State | Evidence |
| --- | --- | --- |
| Key visible in the actual Agent tool process | **PASS** | all four present; ancestry §2 |
| Exact model `openai/gpt-6.1-terra` available | **PASS** | endpoints `200`, exact id |
| Correct Responses API routing | **PASS** | `POST /api/v1/responses` validation `400 invalid_prompt`; base URL explicit, no implicit fallback |
| Docker/WSL Linux/amd64 runtime | **PASS** | engine 29.8.0, `Os/Arch linux/amd64`, container `uname -m` = `x86_64` |
| Verified rr.7 asset identity | **PASS** (after re-fetch) | size + SHA-256 + `--version` §3(a) |
| Ordinary OCR comparator model frozen | **FAIL** | §3(d) — gateway-admitted per run |
| Ordinary OCR rules frozen | **PASS** | rule text + JSON shape recovered verbatim §3(c) |
| Request ceiling fits the OCR path | **FAIL** | 4–5 HTTP requests per review vs `≤2` |
| Both paths receive the original requirements | **PASS (frozen)** | `REVIEWER-INPUT-v1.md` `4ffebc0d…` |
| No evaluator material in reviewer context | **PASS (model-free)** | evaluator outside `repo/`; canary test green |
| Actual request counts observable | **PARTIAL** | harness + key-usage delta count exactly; no live proxy yet |
| USD 1.00 ceiling enforceable | **PARTIAL** | criteria path bounded by arithmetic (8 × 20k/4k on `gpt-6.1-terra` standard = USD 0.24 worst case); the OCR path cannot be priced until its model is named |
| Model-free suites runnable now | **FAIL** | `OPENAI_API_KEY` set trips the `tests/wp7.ts` guard §3(b) |

## 7. Exact remaining causes

1. **M4 — the ordinary OCR model.** Not a policy that can be re-derived: it is the model the account
gateway admitted for the review-time run, plus the rule/prompt the configuration used. Recovery requires
the gateway admission record or the interface, which is Iliya's input.
2. **The OCR request allowance.** Measured 4–5 HTTP requests per managed review against a brief limit of
`≤2` for the initial OCR call and `≤2` for the recheck. Either the ceiling is re-approved, or it is
expressed per *review invocation* rather than per HTTP request.

## 8. Two prepared options (no policy invented)

**Option A — request the original configuration from Iliya (preferred).** Ask for four items only: the
admitted OCR model slug, the rule set + background text used at review time, the retained native findings
for that snapshot, and confirmation of the tier (standard vs flex). With those, the comparator is the real
configuration and nothing is invented.

**Option B — one fixed OpenRouter development comparator (requires approval).** Only if A is impossible:
run the unchanged pinned rr.7 binary against `openrouter.ai/api/v1/responses` through its documented
`custom_providers` block, with one named model held constant, the recovered `reviewrouter-managed-v1` rule
text, `contextGateway: false`, and a recording proxy for per-request accounting. This is explicitly a
*development comparator*: it is not the historical ordinary OCR policy and must be labelled as such in
the result record. It cannot be executed before Iliya approves the substituted model.

## 9. Credential hygiene actions required before any live run

- The earlier failure is resolved; the launch procedure in §2 of the previous section is correct.
- **Unset `OPENAI_API_KEY` and `OPENAI_BASE_URL`** in the launching shell. They duplicate the OpenRouter
  values and break the model-free credential guard; exporting only `OPENROUTER_*` is sufficient.
- The key **expires 2026-11-25T08:09:16Z**, four days from this pass. A live pilot scheduled after that
  date needs a fresh key exported before the app starts.

**Verdict of this re-run: `BLOCKED_WITH_EXACT_REMAINING_CAUSE`** — the gateway-admitted ordinary OCR model
(M4), the OCR request allowance, and the `OPENAI_API_KEY` guard conflict. Environment inheritance, the
Responses route, the Linux runtime, the pinned asset and the rule text are all confirmed ready.

