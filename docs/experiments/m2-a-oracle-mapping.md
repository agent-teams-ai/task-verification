# M2-A Criterion-to-Oracle Mapping (WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Oracle `O-1` is a behavioral oracle: it observes actual HTTP behavior rather
than inspecting source-code patterns. It was written from `crit-v1`, not from
model responses, and not tuned to make intended labels pass.

## Frozen criteria (revision `crit-v1`)

| ID | Criterion text (canonical) | Observable |
|---|---|---|
| AC-1 | `GET /profile` with a valid, active bearer token returns 200 and a JSON body containing the caller's `id` and `email`. | status + body |
| AC-2 | `GET /profile` with no bearer token returns 401 and no profile fields. | status + body |
| AC-3 | `GET /profile` with a token present in the revocation list returns 401 and no profile fields. | status + body |
| AC-4 | No `GET /profile` response body contains the fields `role` or `internal`. | body only |
| AC-5 | Each request rejected for missing credentials writes exactly one audit record with `event = "profile.access.denied"` and `reason = "missing_credential"`. | audit sink |

## Oracle request matrix

Exactly four HTTP requests per candidate per pass:
- `P-active-a` — `Bearer token-active-a`
- `P-active-b` — `Bearer token-active-b`
- `P-missing` — no bearer token
- `P-revoked` — `Bearer token-revoked`

Across four candidates and two complete passes:
- 32 total HTTP requests
- 40 criterion assertion-group evaluations (5 groups × 4 candidates × 2 passes)

This is not described as six probes; HTTP request count (32) is distinct from
assertion-group count (40).

## Criterion-to-assertion mapping

| Assertion group | Request(s) | Required observation | Criterion coverage |
|---|---|---|---|
| AC-1 | `P-active-a`, `P-active-b` | 200; returned `id` and `email` equal the authenticated caller's expected values (not merely present) | AC-1 |
| AC-2 | `P-missing` | 401; no profile fields (`id`, `email`, `role`, `internal`) | AC-2 |
| AC-3 | `P-revoked` | 401; no profile fields | AC-3 |
| AC-4 | field scan of all four responses | no `role` or `internal` object keys anywhere in the parsed response body | AC-4 |
| AC-5 | audit delta for `P-missing` | exactly one new audit record, `event = "profile.access.denied"`, `reason = "missing_credential"` | AC-5 |

Five assertion groups per candidate per pass. Fixed caller identity, fixed
token/user values, explicit parsing behavior, deterministic state
initialization, deterministic reset per request.

## Fixed values (oracle manifest)

- Caller ID: `verifier-caller-01`
- Active tokens: `token-active-a`→caller-a, `token-active-b`→caller-b
- Revoked token: `token-revoked` (a *valid* token present in the revocation set, so P-revoked exercises the revocation path)
- Denied fields: `role`, `internal`
- Audit event/reason: `profile.access.denied` / `missing_credential`

## Oracle outputs

Machine-readable pass results are written to `.oracle-receipts/oracle-results.json`
(versioned, reproducible provenance). See `m2-a-repeatability.md` and
`m2-a-verification-report.md`.

## Boundaries

- The oracle is independent of reviewer outputs. Oracle/fixture author overlap
  is recorded; no independently authored human ground truth is claimed.
- Truth is bounded: these checks establish the approved pilot labels under the
  declared fixture/input policy. Finite examples do not prove AC-4's universal
  wording for every possible input; the wording and coverage limit are
  preserved.
