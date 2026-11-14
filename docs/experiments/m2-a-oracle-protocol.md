# M2-A Oracle Execution Protocol (WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Oracle `O-1` execution protocol: run the four-HTTP-request behavioral oracle
against each of the four candidates, twice per candidate, in fresh isolated
processes, recording machine-readable pass results. Zero live model calls.

## Protocol steps

1. **Freeze `crit-v1`** text/digest and the explicit criterion/subclause →
   input/assertion mapping before building candidates (done in WP1).
2. **Build the four candidates** from the criteria; record oracle/fixture
   author overlap. The oracle is not tuned to make intended labels pass.
3. **Run each candidate in a fresh isolated process** with fixed runtime /
   configuration. Reset the audit sink per request; freeze observation/flush
   semantics. Capture requests, responses and audit deltas.
4. **Run the oracle twice per candidate.** Both passes must agree. Any
   disagreement stops fixture sealing; repeatability alone does not establish
   adequacy.
5. **Evaluate five assertion groups** (AC-1..AC-5) per candidate per pass.
6. **Record machine-readable pass results** (versioned, reproducible provenance).

## Execution details

| Item | Value |
|---|---|
| Candidates | S1-C1, S1-C2, S1-C3, S1-C4 |
| Passes per candidate | 2 |
| Requests per pass | 4 (`P-active-a`, `P-active-b`, `P-active-missing`, `P-revoked`) |
| Total HTTP requests | 32 |
| Assertion groups per candidate per pass | 5 |
| Total assertion-group evaluations | 40 |
| Process isolation | Fresh process per candidate; audit sink reset per request |
| Live model calls | 0 (model-free) |

## How a candidate is run

The oracle dynamically imports the candidate's isolated application snapshot
(`candidates/S1-Cn/src/app.ts`) together with the candidate's own behavior
(`candidates/S1-Cn/src/behavior.ts`). No parent experiment checkout, no
sibling candidates, no oracle internals are imported into the candidate. The
candidate's served behavior is what is tested — the oracle observes behavior,
not source patterns.

## Results

Executed: all four candidates, two passes each, 32 HTTP requests, 40
assertion-group evaluations, both passes agree for every candidate:

- `S1-C1`: pass (all criteria satisfied)
- `S1-C2`: pass (all criteria satisfied)
- `S1-C3`: fail AC-3 (revoked token returns 200 instead of 401) — repeatable
- `S1-C4`: fail AC-4 (`role`/`internal` leaked in responses) — repeatable

Receipt: `.oracle-receipts/oracle-results.json` (versioned `oracleId O-1`,
`oracleVersion v1`).

## Repeatability vs adequacy

Both passes agree (repeatability). Repeatability alone does not establish
oracle adequacy; adequacy is separately demonstrated by the fault controls
(`m2-a-oracle-adequacy.md`).
