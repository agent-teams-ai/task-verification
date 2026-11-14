# M2-A Repeatability Receipts (WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

The oracle was run twice per candidate for all four candidates. Both passes
agree for every candidate. Repeatability is recorded separately from oracle
adequacy (repeatability alone does not prove adequacy; adequacy is shown by
the fault controls in `m2-a-oracle-adequacy.md`).

## Execution totals

| Quantity | Value |
|---|---|
| Candidates | 4 (S1-C1, S1-C2, S1-C3, S1-C4) |
| Passes per candidate | 2 |
| Requests per pass | 4 |
| Total HTTP requests | 32 |
| Assertion groups per candidate per pass | 5 (AC-1..AC-5) |
| Total assertion-group evaluations | 40 |
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
(omitted redaction via unchanged serializer on base B1). Repeatable across both
passes.

## Machine-readable receipt

`.oracle-receipts/oracle-results.json` — versioned receipt:
- `oracleId`: `O-1`
- `oracleVersion`: `v1`
- `requestMatrix`: 4 requests/candidate/pass, 4 candidates, 2 passes, 32 total
  HTTP requests, 5 assertion groups/candidate/pass, 40 total assertion-group
  evaluations
- `candidates`: per-candidate pass/fail, expected criteria
- `faultControls`: all four rejected
- `generatedAt`: ISO-8601 UTC timestamp

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
