# Ordinary checks — Candidate A

Candidate: `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` (base `ce99b0d65d645124413a746ecb137b5497aad80f`).

## Definition

| Field | Value |
| --- | --- |
| Definition | `package.json#scripts.test` |
| Command | `node --experimental-strip-types --test --test-concurrency=1 tests/*.test.ts` |
| Definition digest (SHA-256 of the scripts object) | `759ae4ff1d9e57e0cfc9d781bb9dfd768f6a806b28e50bbbd3e9a50ec1b0b68e` |
| Revision | the candidate's own committed suite at `23864e3`; not added or edited for the pilot |
| Working directory | `synthetic/repo` |

These are the only checks the project defines. No check was added, hidden or modified for the pilot.

## Result — Candidate A

Exit status **0**.

```
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Covered: the four Base formatter tests, the six Base CSV helper tests, the two Base store tests, and
nine `records` tests (default listing, status filter, case-insensitive `nameContains`, `limit`/`offset`
paging with pre-pagination `total`, UTC rendering of a `+02:00` and a `-05:00` instant, rejected
`limit`, rejected `status`, documented defaults, `total` before pagination).

Failed, skipped or unavailable: none. No test in the candidate suite exercises a CSV export.

## Result — Base (context)

Exit status **0**: `tests 12, pass 12, fail 0` at `ce99b0d`.

## Evaluator-only check (not an ordinary check)

`synthetic/evaluator/r3-export.test.ts` exits **1** on Candidate A with `404 !== 200` for
`GET /records/export`. It is not part of the candidate repository, is not in the ordinary suite, and
was not shown to any reviewer path.
