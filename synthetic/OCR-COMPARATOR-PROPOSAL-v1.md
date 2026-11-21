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
- enforces a hard per-invocation request cap and refuses request N+1 with `429` **before**
  any upstream call, so a refused request cannot be billed;
- injects `max_output_tokens` when the caller omits it;
- charges every accepted response at `max(reported usage, floor)` — a 2xx response with
  missing usage fields is never treated as free;
- writes a JSONL ledger with method, model, byte counts, token accounting and status, and
  **never** the credential or the Authorization header.

Model-free proof (`synthetic/tooling/proxy-selftest.mjs`, offline mode, no provider contact):
cap `3` → statuses `200,200,200,429`; 3 accepted, 1 refused before forwarding; output ceiling
injected on every accepted request; every accepted request charged; credential absent from the
ledger. **PASS.**

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

## 6. Revised budget

Per-request ceilings: **20,000 input / 4,000 output tokens**, matching the frozen brief.
`gpt-6.1-terra` standard = USD 1.00 / 1M input, USD 5.00 / 1M output.

| # | Stage | Model calls | Request cap | Input tokens | Output tokens | Worst cost |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial OCR | `gpt-6.1-terra` | 6 | 120,000 | 24,000 | USD 0.24 |
| 2 | Initial criteria assessment | `gpt-6.1-terra` | 1 | 20,000 | 4,000 | USD 0.04 |
| 3 | Correction workflow (OCR + criteria) | `gpt-6.1-terra` | 7 | 140,000 | 28,000 | USD 0.28 |
| 4 | Recheck OCR | `gpt-6.1-terra` | 6 | 120,000 | 24,000 | USD 0.24 |
| 5 | Recheck criteria assessment | `gpt-6.1-terra` | 1 | 20,000 | 4,000 | USD 0.04 |
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

## 7. What this proposal does not claim

- It does not claim `openai/gpt-6.1-terra` was ever the production OCR model.
- It does not claim model quality, latency or cost from any model-free evidence.
- It does not authorize execution. The manifest is `PREPARED`, not run.
