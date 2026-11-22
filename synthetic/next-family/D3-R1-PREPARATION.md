# D3-R1 — focused execution corrections

Record of the correction pass on `77a5eb1d2950facdefd2d3308c3b195336f77d53`, offline only.
No paid inference ran. No new task family, no strategy change, no provider or model change, no matrix
expansion, no production surface. M2 PR #2 (`996cdcb0…`) untouched and its working tree clean.

Context preserved: prior A/B/C evidence, USD 0.31639530 reconciled spend, original reports and model
outputs, qualified OCR `1.14.0-rr.1`, frozen managed policy and filtering. Revised materials are additive
(`history/superseded-v1/`, `history/superseded-c03/`) plus a new family revision, never a rewrite.

| # | Finding | Correction | Evidence |
| --- | --- | --- | --- |
| 2 | Proxy resolved beneath repository-root `tooling/` | `lib/paths.mjs` resolves the one canonical proxy module-relatively; no cwd, env or fallback | `tests/proxy-path.test.mjs` (7): tracked path, 4 working directories, URL with a space, repo-root `tooling/` refused, env override ignored, launcher has no `path.join(SYN,"tooling")` |
| 3 | Nominal packet size mistaken for request size | Serialized bodies reproduced through `createLlmClient()` with a fake port | `offline/measure-requests.mjs`: c01 25,884 B, c02 25,741 B, c03 26,427 B — all above the D3 16,000-byte bound, which is exactly the 413 the maintainer reproduced |
| 4 | Byte limit and token accounting disagreed | Separate `--request-input-bytes` (28,672) and `--request-input-tokens` (28,736 = bytes + 64 special tokens); the proxy refuses to start when the token ceiling cannot dominate the bytes | `tests/proxy-limits.test.mjs` (11), `tests/serialize.test.mjs` (12): exact ceiling admitted, +1 refused, concurrent cap, missing usage, usage above ceiling, startup refusal |
| 5 | Model/provider identity recorded but not checked | Request-side pinning (model, tier, effort, output ceiling) plus reply-side enforcement: observed model must equal the pinned id, a missing model halts, provider must be in the declared set, and the reply is withheld on mismatch | `tests/proxy-limits.test.mjs`: `proxy_policy_*`, `proxy_observed_model_mismatch`, `proxy_observed_model_missing`, `proxy_observed_provider_mismatch`, and a halted run that makes no second upstream call |
| 6 | Launcher deleted the ledger and overwrote output | Append-only attempts: unique id, `attempt.json`, per-attempt ledger, raw reply written first with `wx`, `result.json`, append-only `index.jsonl`; duplicate run key refused | `tests/attempt.test.mjs` (4), launcher `--dry-run` for all three candidates |
| 7 | No aggregate budget guard | `lib/budget.mjs`: `max(settled, conservative)` (never the sum), unreserved history re-verified against the reconciliation, atomic reservation under an exclusive lock, settle/unresolved semantics, cache lines never credited | `tests/budget.test.mjs` (9): reconciliation, no double count, corrected arithmetic, six-process concurrency (5 admitted, 1 refused), cache-write/read understatement |
| 8 | c03 tested a module-resolution defect | Workspace package `@fixture/delivery-core` created as a sibling of the fixture repo; c03 revised to `18bbde35…` so the retry path runs (17/17, 0 skipped); the boundary is declared in `TASK.md` and the README; the oracle keeps the same expectation | `tests/fixture.test.mjs`: retry path observed, classification absent from the commit and the packet, same tree fails with `ERR_MODULE_NOT_FOUND` only when the package is removed |
| 9 | C1/C3/C4 interaction unstated | `delivery-req-v2` states the validation order and the precedence; probe adds three precedence scenarios | `TASK.md`, `evaluator/ORACLE.json` (`precedence_interpretation`), `tests/fixture.test.mjs`: c01/c02/c03 all answer 413/409/413 as required and queue nothing |
| 10 | `checks/RESULTS.md` said "no signal" for C1/C2 | Rewritten: positive observations, uncovered clauses, the c03 skip as an availability gap, the input distinction and the unjustified conclusions | `checks/RESULTS.md`, `checks/raw-<commit>.txt`, `checks/RECEIPTS.json` |

## Corrected numbers

- Serialized bodies 25,884 / 25,741 / 26,427 B; admitted ceiling **28,672 B**, token ceiling **28,736**,
  output **2,500**.
- Per criteria request **USD 0.04842**; three calls plus the reserve **USD 0.19368**; OCR 8 × 0.0275 =
  **USD 0.22**; batch worst case **USD 0.41368**.
- Committed history **USD 0.55929** (settled 0.31639530 is its subset, never added); remaining
  **USD 0.44071**; aggregate worst case **0.97297 ≤ 1.00**, leaving USD 0.02703.
- OCR forwarding reduced from 10 to 8: at the corrected input ceiling ten forwards would make the batch
  USD 0.4482 and the aggregate USD 1.00749 > 1.00. No per-request limit was weakened.

## Offline decision

`node synthetic/next-family/checks/verify-gates.mjs` → **11/11 PASS**, including 44 passing offline tests,
the proxy's 20-test audit and its selftest, packet reproducibility, the leak gate, the credential scan, the
untouched historical evidence and the clean M2 tree.

**D3_R1_OFFLINE_READY.** No live request was made: `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` are
absent from this environment and no credential file exists in the workspace, so the launcher refuses with
exit 3 (`credentials_absent`) before any reservation. Live execution is pending access, not blocked by a
compatibility or budget problem.
