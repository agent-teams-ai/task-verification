# M2-A Oracle Adequacy Assessment (WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Oracle adequacy is demonstrated by the four fault controls: the oracle must
reject intended behavioral faults while the unmodified fixture passes the same
assertion. Repeatability alone does not prove adequacy.

## Fault controls

Each fault was injected into a passing synthetic run, the affected criterion's
assertion was re-evaluated, and the fault was confirmed rejected. The
unmodified fixture passes the same assertion.

| # | Fault | Injected behavior | Expected affected criterion | Rejected? | Unmodified fixture passes? |
|---|---|---|---|---|---|
| 1 | Wrong caller identity | `P-active-a` body reports caller id `wrong-caller` instead of `caller-a` | AC-1 | ✅ Yes | ✅ Yes |
| 2 | Denial-field leakage | `P-missing` denial response body includes the sensitive `role` field | AC-4 | ✅ Yes | ✅ Yes |
| 3 | Missing audit entry | `P-missing` writes zero audit records (empty audit delta) | AC-5 | ✅ Yes | ✅ Yes |
| 4 | Duplicate audit entry | `P-missing` writes two audit records instead of exactly one | AC-5 | ✅ Yes | ✅ Yes |

Note: a single injected defect may trip more than one criterion (e.g. denial-
field leakage also trips AC-2 "no profile fields"); that does not make the
target criterion (AC-4) any less violated. The fault is rejected when its
target criterion fails.

## Demonstration method

For each fault: a fully passing baseline result was constructed (active
callers 200 with matching id/email; missing/revoked 401 with no profile
fields; no denied fields in any body; exactly one `profile.access.denied` /
`missing_credential` audit record for `P-missing`). The fault was injected,
the five assertion groups were re-evaluated, and the target criterion's
`passed` flag became `false`. The unmodified baseline passes all five
criteria.

This shows the checks discriminate the injected errors. These are model-free
oracle controls, not new benchmark candidates.

## Adequacy conclusion

The oracle:
- Observes actual HTTP behavior (status codes, bodies, audit deltas), not
  source-code patterns.
- Rejects all four injected behavioral faults on their target criteria.
- Passes the unmodified fixture on all criteria.
- Is repeatable (both passes agree for all four candidates).

Repeatability has been demonstrated; adequacy is supported by the fault
controls above. Resolved scope: per the plan, any oracle/criterion ambiguity
would stop fixture sealing; none was found.
