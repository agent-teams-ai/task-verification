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
| Application source | Six files, ≈340 lines: `app.ts`, `audit.ts`, `authz.ts`, `behavior.ts`, `serializer.ts`, `types.ts` |
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

## Base and head structure

The canonical fixture sources in `fixture/src/` feed one authoritative snapshot
model (`scripts/snapshot-defs.ts`). A snapshot is a file map, not a directory
copy.

| Source | Role |
|---|---|
| `app-stub.ts` | B0 `app.ts`: secure-by-default deny-all stub (no profile route) |
| `app.ts` | H1/H4 `app.ts`: correct inline implementation |
| `app-delegate.ts` | H2 `app.ts`: thin router delegating to the unchanged `authz.ts` helper |
| `app-revoked-bug.ts` | H3 `app.ts`: wrong-field revocation compare (revoked tokens pass) |
| `serializer.ts` | B0/H1–H3 redacted serializer |
| `serializer-b1.ts` | B1 serializer, including `role` and `internal` |
| `audit.ts`, `authz.ts`, `behavior.ts`, `types.ts` | Unchanged shared modules |

`B0` and `B1` share every file except `serializer.ts`. Every head is its base
map with only `app.ts` replaced, so unchanged helpers (including the serializer)
remain byte-identical. There are no behavior flags; the planted defects live in
application code.

| Candidate | Base | Head `app.ts` | Intended result |
|---|---|---|---|
| S1-C1 | B0 | correct inline | all criteria pass |
| S1-C2 | B0 | delegate to `authz.ts` | all criteria pass |
| S1-C3 | B0 | wrong revocation compare | AC-3 violated (revoked token returns 200) |
| S1-C4 | B1 | correct inline | AC-4 violated (unchanged serializer leaks `role`/`internal`) |

## Reproducibility

- One authoritative generator, `scripts/gen-candidates.ts`, builds the in-memory
  snapshot model and derives reviewer files, Git identities, diffs, manifests
  and application digests from it. `scripts/record-provenance.ts` is a
  compatibility shim over the same generator.
- The application digest (`src/digest.ts`) is SHA-256 over sorted relative
  paths and LF-normalized content, excluding `.git`. It is recorded in each
  `candidates/S1-Cn/MANIFEST.json` and `candidates/provenance.json`, and is
  recomputed from the reviewer-visible files by `src/materialization.ts`.
- Git identities use a fixed author/committer and fixed dates with
  `core.autocrlf=false`, so commit and tree hashes reproduce across runs and
  platforms.
- The recorded diff forward-applies to the head file map and reverse-applies to
  the exact base file map (`git apply` / `git apply -R`).
- Each candidate directory is standalone: it imports nothing from `fixture/` or
  a sibling candidate.

## Verification (WP1 and snapshot tests, all pass)

`tests/wp1.ts` (14 tests): fixture startup, request/response behavior, state
reset, candidate isolation, B0/B1 structure, C4 unchanged serializer and AC-4
violation, C3 AC-3 violation, C1/C2 behavioral equivalence, C2 structural
difference and helper dependency, head-equals-base-plus-app.

`tests/snapshots.ts` (8 tests): one-snapshot derivation of reviewer files,
identities and digests; materialized files match the recorded head; recorded
diffs forward/reverse apply; `.git` exclusion; deterministic regeneration;
C1/C2/C3 share B0 and C4 exposes an unchanged B1 serializer; distinct heads; no
Git metadata in snapshot directories.
