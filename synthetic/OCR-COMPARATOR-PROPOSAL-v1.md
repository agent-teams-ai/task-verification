# Fixed synthetic development OCR comparator — proposal v1

| Field | Value |
| --- | --- |
| Proposal id | `exp-ocr-comparator-2026-11-21-01` |
| Status | **PROPOSED — NOT APPROVED, NOT EXECUTED** |
| Label carried by every artifact | `FIXED SYNTHETIC DEVELOPMENT OCR COMPARATOR — NOT HISTORICAL PRODUCTION CONFIGURATION` |
| Inference performed while preparing this | **Zero.** No provider, model, OCR or Gateway call. |
| Approval required from | Iliya (comparator substitution + budget) |

## 1. Why a fixed comparator is needed

The ordinary OCR model is **not** a stored configuration. In
`production-t0-review-runner.ts:927` the runner resolves
`modelDispatchCapability?.model ?? runtimeEnv.CODEX_MODEL` and throws
`review_action_v2_ocr_model_missing` when neither is present. The dispatch capability is
the account gateway's admission document for the review being compared against, so the
historical model identity lives in a server-side admission record, not in any repository,
config file or prior invocation retained here. `~/.opencodereview/config.json` does not
exist on this host.

Inventing a historical model would fabricate the comparator. This proposal instead fixes a
**development** comparator explicitly, so the substitution is visible in every result.

## 2. Proposed fixed comparator

| Component | Proposed value | Source of the value |
| --- | --- | --- |
| Native binary | `open-code-review 1.13.1-rr.7 linux/amd64` | approved pin |
| Binary SHA-256 | `2f290fb407a5cb6fbe854cb6702b8c713325fce603a71c1be83f5284034aaa29` (80,513,021 bytes) | verified this phase |
| OCR model | `openai/gpt-6.1-terra` | approved model, not a historical OCR identity |
| Provider / route | OpenRouter, `POST {OPENROUTER_BASE_URL}/responses` | `openai-responses` protocol |
| Service tier | standard / `service_tier: "default"` | ReviewRouter emits this for `openai-responses`; flex is excluded |
| Reasoning effort | `medium` (`reasoning.effort`) | `--effort medium`; supported by the endpoint |
| Rule identity | `reviewrouter-managed-v1`, unchanged | recovered verbatim from `buildOcrControlledRuleText` |
| Filtering | unchanged — `--no-filter` is **not** passed | original normal policy |
| Normalization | unchanged — outcome schema `reviewrouter.ocr-outcome/v1` | pinned normalizer |
| Requirements to both paths | unchanged, `sha256:ca868a3f…6bde727f` | frozen reviewer input |

The only substituted variable is the **model**, because it is the only one whose original
value is not recorded anywhere.

## 3. Technical compatibility — established by inspection, not by inference

| Requirement | Finding |
| --- | --- |
| Custom provider support | Yes. `config set custom_providers.<name>.{url,protocol,api_key,model,timeout_sec,extra_body}` is a documented CLI surface; managed mode writes exactly that block with `provider: "reviewrouter"` and `custom_providers.reviewrouter`. |
| `openai-responses` protocol | Yes — the managed config builder emits `protocol: "openai-responses"` and rejects any other value for this path. |
| `service_tier` | Yes — built into `extra_body` for the OpenAI-Responses branch. |
| `reasoning.effort` | Yes — `extra_body.reasoning = { effort }`; `ocr review --effort low|medium|high` also accepted. |
| Managed rule file | Yes — `--rule` takes the recovered JSON (`merge_system_rule`, `include`, `rules[]`) with `--reviewrouter-managed --provider reviewrouter`. |
| Background bound | Yes — `--background-file` must stay ≤ 8000 characters (`OCR_BACKGROUND_HARD_CHAR_LIMIT`). |
| Managed mode requires loopback | Yes — `buildOcrManagedConfigJson` rejects a base URL that is not `http://127.0.0.1:<port>`. The provider credential therefore lives in a local proxy, never in the binary's config. |
| Filtering preserved | Yes — filtering is on by default; disabling it requires the explicit `--no-filter` flag, which this proposal forbids. |
| In-flight concurrency | Managed mode wraps the client in a run-wide permit: **at most one model call in flight**, so requests are countable in order. |

**Conclusion: technically supported without modifying OCR's normal policy.** No blocker was
found, so no alternative model or route is proposed. Nothing is switched silently.

## 4. Transport boundary (the enforcement point)

The binary's provider URL must be loopback, so the pilot inserts a bounded recording proxy
between rr.7 and OpenRouter:

```
rr.7 (managed) → http://127.0.0.1:<port>/responses → https://openrouter.ai/api/v1/responses
```

`synthetic/tooling/openrouter-bounded-proxy.mjs`:

- reads **only** `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`; it never falls back to
  `OPENAI_API_KEY` / `OPENAI_BASE_URL`, and refuses to start without them (fail closed);
- classifies traffic: only `POST /responses` and `POST /v1/responses` are inference. Any other
  path is `404` and never forwarded, so a non-inference call cannot consume or bypass budget;
- takes a request slot **before** forwarding and refuses request N+1 with `429`; the check and
  the increment are synchronous in one task, so concurrent requests cannot exceed the cap;
- pins `model`, `service_tier` and `reasoning.effort`; any other value is refused `400` with no
  forward, so a silent substitution cannot happen and cannot be billed;
- reserves the **maximum permitted request cost** (20,000 in + 4,000 out) atomically before
  forwarding, and reconciles the reservation to reported usage afterwards;
- refuses a caller-declared `max_output_tokens` above the pin (`413`) rather than clamping it,
  and injects the pin when the field is absent;
- charges reported usage when present and otherwise keeps the **full reservation** — never
  zero, never a floor;
- halts (`402` for every later request) when a forwarded response has no usage, or when the
  outcome is a non-2xx, timeout or transport error, because the cost is then unknowable;
- writes a JSONL ledger with stage, decision, model, tier, effort, estimates, reported usage,
  charged tokens, halt state and running totals — and **never** the credential, the request
  headers or the `Authorization` value.

Model-free proof, no provider contacted:

| Suite | Coverage | Result |
| --- | --- | --- |
| `proxy-audit.test.mjs` (15 tests, local stub upstream) | exact ceiling, concurrency, atomic token reservation, failed upstream, timeout, missing usage, oversized input, oversized declared output, budget exhaustion, unexpected model, unexpected tier, unexpected effort, credential redaction, non-inference classification, per-stage independence | **15/15 pass** |
| `proxy-selftest.mjs` (offline smoke) | cap `3` → `200,200,200,429`, output ceiling injected, every request charged, credential absent | **PASS** |

## 5. Native OCR request lifecycle — measured, not assumed

| Question | Finding |
| --- | --- |
| Is one invocation one request? | **No.** |
| Measured HTTP requests per managed review | **4** for the M2 finding case (`evidence.request_count === 4`), **5** for the release qualification finding case (`findingCase.http_requests === 5`) |
| Non-inference HTTP requests | None identified in managed mode; every recorded request carries a prompt body. Local git work is subprocess work (`--max-git-procs`), not provider traffic. |
| Tool calls that do not invoke the model | Tool execution itself is local, but each tool round can trigger a follow-up model call, so it consumes provider requests |
| Internal retries | Yes — the binary keeps an `ocr.llm-retry-report/v1` collector and the LLM client retries transient failures; a refusal is re-entered in the main-turn loop. `--timeout` explicitly covers "LLM requests and retries". |
| Can retries be disabled? | **No documented kill switch** in `ocr review --help`. Retries are bounded instead by the proxy request cap and `--timeout`. |
| Enforceable at the transport boundary? | **Yes** — the proxy cap is a hard, pre-forward refusal (proved above). |
| Usage/cost observable? | **Yes, twice**: per-request ledger (reported usage, else charged floor) and the authoritative `GET /api/v1/key` usage delta per key |
| Can the model exceed the expected count? | **Yes** — `--max-tools` permits tool rounds (minimum 50) and retries add attempts, so the binary alone cannot bound the count. The proxy cap is what bounds it. |

Consequence for the experiment: the request ceiling is expressed **per OCR invocation
against the proxy cap**, not per model "turn", and a cap breach is a stop condition, not a
retry.

## 5.1 What `--max-tokens-budget` actually measures

From the pinned source (`0001-managed-mode-core.patch`): the budget is compared against
`a.runner.TotalTokensUsed()` — **combined input + output** — and the check runs *before each review
round*, emitting `skipped round N of group "…": used X tokens exceeds budget Y` and latching a
`token_budget` stop.

Consequences, all of which the manifest records:

- it is **not** a per-request cap and **not** a USD cap;
- it can **overshoot by one round**, because the decision is taken between rounds and a group over
  budget is allowed one final round to submit findings;
- cache read/write counters exist separately and are **not** part of the compared metric, so a
  cache-heavy run can be cheaper than the number suggests — never more expensive.

It is therefore a **secondary brake**. The hard bound is the proxy's atomic reservation, which acts
before a request is forwarded.

## 6. Revised budget

Per-request ceilings: **20,000 input / 4,000 output tokens**, matching the frozen brief.
`gpt-6.1-terra` standard = USD 1.00 / 1M input, USD 5.00 / 1M output.

| # | Stage | Model calls | Request cap | Input tokens | Output tokens | Worst cost |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial OCR | `gpt-6.1-terra` | 6 | 120,000 | 24,000 | USD 0.24 |
| 2 | Initial criteria assessment | `gpt-6.1-terra` | 1 | 20,000 | 4,000 | USD 0.04 |
| 3 | Correction OCR | `gpt-6.1-terra` | 6 | 120,000 | 24,000 | USD 0.24 |
| 4 | Correction criteria assessment | `gpt-6.1-terra` | 1 | 20,000 | 4,000 | USD 0.04 |
| 5 | Recheck OCR | `gpt-6.1-terra` | 6 | 120,000 | 24,000 | USD 0.24 |
| 6 | Recheck criteria assessment | `gpt-6.1-terra` | 1 | 20,000 | 4,000 | USD 0.04 |
| | **Total** | | **21** | **420,000** | **84,000** | **USD 0.84** |

- The cap of 6 per OCR invocation is the measured worst case (5) plus one request of slack.
- Aggregate worst case **USD 0.84** against a hard **USD 1.00** ceiling leaves USD 0.16 unused.
- Per-invocation in-binary guard: `--max-tokens-budget 144000` (6 × 24,000 in+out), which is
  checked before every LLM round.
- Timeouts: 150 s per request, `--timeout 15` minutes per OCR invocation; aggregate wall clock
  ≤ 60 minutes (3 × 900 s + 3 × 150 s = 52.5 min, plus start/stop overhead).
- **No automatic retries at the pilot layer.** A transport failure is retried only by the
  binary's own loop, and every such attempt is counted by the proxy cap.
- Missing usage is charged at the floor, never zero.

If the maintainer prefers more headroom, the only lever that keeps the ceiling intact is a
lower per-request input ceiling (e.g. 16,000 tokens → USD 0.67 worst case); it changes the
frozen brief's ceiling and therefore needs explicit approval.

### 6.1 Correction workflow accounting

The six correction OCR requests and the one correction criteria request route through the same
proxy under their own stage labels, with their own caps, and are counted in the 21.

**Freebuff's own coding-agent inference is excluded.** It cannot be routed through or measured by
this proxy, so counting it as covered would be false and authorizing it would create uncontrolled
spend. The correction is therefore performed **manually by the operator**, after which the same OCR
and criteria stages re-run under their caps. The reviewer report and the recorded human decision
checkpoint are unchanged. No new orchestration is introduced.

### 6.2 Limits of the guarantee

- Request count is exact. Token cost is exact only where the provider reports usage; when it does
  not, the run **halts** rather than estimating.
- If a forwarded response is a non-2xx, a timeout or a transport error, the full reservation is
  kept and the run halts — no retry can re-enter through the proxy.
- The USD 1.00 ceiling is hard only while the proxy is the sole credentialed component **and** the
  key limit is USD 1.00. With the key limit still at USD 5.00 the correct claim is "USD 0.84 by
  construction, capped at USD 5.00 by the provider". Lowering the key limit is an approval item.
- The proxy cannot prove the binary opens no second egress. Managed mode rejects a non-loopback
  provider URL (source-verified) and the proxy is the only component holding the key, so no bypass
  path is known; running the container with no default route would make it structural.

## 7. What this proposal does not claim

- It does not claim `openai/gpt-6.1-terra` was ever the production OCR model.
- It does not claim model quality, latency or cost from any model-free evidence.
- It does not authorize execution. The manifest is `PREPARED`, not run.
