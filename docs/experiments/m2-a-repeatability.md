# M2-A Repeatability Receipts (WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

The oracle was run twice per candidate for all four candidates, each pass in a
fresh operating-system process. Both passes agree for every candidate.
Repeatability is recorded separately from oracle adequacy (repeatability alone
does not prove adequacy; adequacy is shown by the fault controls in
`m2-a-oracle-adequacy.md`).

## Execution totals

| Quantity | Value |
|---|---|
| Candidates | 4 (S1-C1, S1-C2, S1-C3, S1-C4) |
| Passes per candidate | 2 |
| Requests per pass | 4 |
| Total HTTP requests | 32 |
| Assertion groups per candidate per pass | 5 (AC-1..AC-5) |
| Total assertion-group evaluations | 40 |
| Fresh child processes | 8 (one per candidate pass) |
| Live model calls | 0 |

## Per-candidate two-pass results

| Candidate | Pass 1 | Pass 2 | Agree | Overall | Expected truth (AC-1..AC-5) |
|---|---|---|---|---|---|
| S1-C1 | pass | pass | ✅ | pass | pass pass pass pass pass |
| S1-C2 | pass | pass | ✅ | pass | pass pass pass pass pass |
| S1-C3 | fail (AC-3) | fail (AC-3) | ✅ | fail | pass pass fail pass pass |
| S1-C4 | fail (AC-4) | fail (AC-4) | ✅ | fail | pass pass pass fail pass |

S1-C3 fails AC-3: the revoked token returns 200 instead of 401 (wrong-field
revocation compare). Repeatable across both passes.
S1-C4 fails AC-4: `role` and `internal` are serialized into active responses
(omitted redaction via the unchanged serializer on base B1). Repeatable across
both passes.

## Persisted receipts

Each pass writes one JSON receipt to `.oracle-receipts/S1-C{n}-pass{1,2}.json`.
Receipts are plain JSON: `assertions` is an object keyed by criterion id and
`auditDeltas` is an object keyed by request id, each holding an array of audit
records. Neither field is ever serialized from a `Map`, so neither can collapse
to `{}`.

A receipt contains:

- `candidateId`, `pass`
- `process`: child `pid`, `ppid`, `exitCode`, `signal`
- `requests`: four request observations (`requestId`, `statusCode`, `body`)
- `auditDeltas`: per-request audit record arrays
- `assertions`: per-criterion `{ criterionId, passed, detail }`
- `passed`
- `execution`: `durationMs`, `generatedAt` (volatile metadata)

The aggregate `.oracle-receipts/oracle-results.json` records the request
matrix (32 HTTP requests, 40 assertion-group evaluations), per-candidate
two-pass verdicts, repeatability, and the four fault controls.

## Deterministic comparison

Repeated runs are compared through a canonical form that strips volatile
execution metadata before hashing:

- the child `process` block (PIDs, exit code, signal),
- `execution` (`durationMs`, `generatedAt`),
- the pass ordinal,
- audit-record `timestamp`.

`canonicalReceiptJson()` sorts object keys and `semanticDigest()` hashes the
canonical JSON. Two fresh processes running the same candidate therefore
produce the same semantic digest while their raw receipts retain distinct PIDs
and wall-clock metadata. Raw receipts are not claimed to be byte-identical.

## Repeatability vs adequacy

Both passes agree (repeatability demonstrated). Repeatability alone does not
establish oracle adequacy; adequacy is separately demonstrated by the four
fault controls (`m2-a-oracle-adequacy.md`), all of which reject their intended
defects while the unmodified fixture passes.

## Criterion-to-assertion coverage

Five assertion groups per candidate per pass: AC-1, AC-2, AC-3, AC-4, AC-5
(40 total assertion-group evaluations across 4 candidates × 2 passes). HTTP
request count (32) is distinct from assertion-group count (40); this is not
described as six probes.

## Verification

`tests/oracle-receipts.ts` (2 tests) runs all eight passes, reads every receipt
back from disk, verifies that `assertions` and `auditDeltas` are populated
plain JSON objects with the expected keys and values, and verifies that two
fresh processes produce the same canonical receipt JSON and semantic digest
while their raw execution metadata differs.
