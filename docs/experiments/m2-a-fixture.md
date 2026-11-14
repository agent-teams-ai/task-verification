# M2-A Fixture Architecture and Reproducibility (WP1)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation); fixture source/tests/tooling: Apache 2.0.
**Status:** Implemented, executed, verified.

## Summary

WP1 implements the owner-approved minimal TypeScript HTTP fixture in this
repository (no separate permanent fixture repository). It is a deterministic
authorization service with a JSON audit sink, fixed initial state and explicit
reset behavior.

## Fixture characteristics

| Property | Value |
|---|---|
| Service | Minimal TypeScript HTTP service (`node:http`), `GET /profile` only |
| Core application source | ~200 lines (`fixture/src/app.ts` + `behavior.ts`, `types.ts`, `audit.ts`) |
| Determinism | Fixed tokens, fixed revocation set, fixed caller identity; no randomness, no clocks in decisions |
| JSON audit sink | Append-only in-memory `AuditSink` with explicit `reset()` and `delta()` |
| Fixed initial state | `token-active-a`→caller-a, `token-active-b`→caller-b, `token-revoked`→caller-revoked (valid + revoked), revocation set `{token-revoked}` |
| Explicit reset | `reset()` clears the audit sink and delta cursor per request |
| No external dependency | Node standard library only (`node:http`, `node:net`) |
| Stable responses | Same request → same response, every time |

## Criteria frozen (revision `crit-v1`)

Exactly the five owner-approved criteria, text preserved verbatim from the
latest plan:

- **AC-1** `GET /profile` with a valid, active bearer token returns 200 and a JSON body containing the caller's `id` and `email`.
- **AC-2** `GET /profile` with no bearer token returns 401 and no profile fields.
- **AC-3** `GET /profile` with a token present in the revocation list returns 401 and no profile fields.
- **AC-4** No `GET /profile` response body contains the fields `role` or `internal`.
- **AC-5** Each request rejected for missing credentials writes exactly one audit record with `event = "profile.access.denied"` and `reason = "missing_credential"`.

AC-5 is intentionally scoped to the missing-credential path so its truth is
independent of AC-3 (per the plan's design correction).

## Request fixtures (oracle matrix)

Four HTTP requests per candidate per pass:
- `P-active-a` — `Bearer token-active-a` → expect 200, caller `caller-a`
- `P-active-b` — `Bearer token-active-b` → expect 200, caller `caller-b`
- `P-missing` — no Authorization header → expect 401, no profile fields
- `P-revoked` — `Bearer token-revoked` → expect 401, no profile fields

## Behavior variants

Behavior is driven by `AppBehavior` (`revokeEnforced`, `revokeFieldCorrect`,
`serializerIncludesRole`), so all four candidates materialize from one canonical
source with different variants:

| Variant | revokeEnforced | revokeFieldCorrect | serializerIncludesRole | Intended result |
|---|---|---|---|---|
| Correct (S1-C1 / S1-C2) | true | true | false | all criteria pass |
| S1-C3 (revocation defect) | true | **false** | false | AC-3 violated (revoked tokens pass via wrong-field compare) |
| S1-C4 (role leak) | true | true | **true** | AC-4 violated (`role`/`internal` serialized into responses) |

## Reproducibility

- Candidate snapshots are generated from the canonical fixture by
  `scripts/gen-candidates.ts` (deterministic; each candidate is self-contained,
  imports nothing from `fixture/` or siblings).
- Tree digests (SHA-256 over sorted file contents) are recorded in each
  `candidates/S1-Cn/MANIFEST.json` and reproduced exactly by
  `tests/wp1.ts` ("candidate tree digests reproduce from manifest").
- Reconstruction from sanitized material is tested: each candidate directory is
  a standalone materialization with its own file inventory (`app.ts`,
  `audit.ts`, `behavior.ts`, `types.ts`).

## Verification (WP1 tests, all pass)

Fixture startup, request/response behavior, state reset, candidate isolation,
B0/B1 snapshot identities, H1–H4 reconstruction, tree-digest reproducibility,
S1-C4 B1 difference, sanitization and file-inventory checks — see `tests/wp1.ts`
(10 tests, all pass).
