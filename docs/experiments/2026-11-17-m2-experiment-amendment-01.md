# Experiment Amendment 2026-11-17-01 (D1 authorization scope)

| Field | Value |
| --- | --- |
| Amendment id | `exp-amendment-2026-11-17-01` |
| Schema | `m2.experiment-amendment/v1` |
| Amends | `2026-11-12-stage-a-b-experiment-plan.md` (Stage A/B plan) |
| Status | **PROPOSED** — planning deliverable |
| Authority | Not an M2 acceptance item; requires separate maintainer authorization before execution |

Versioning is independent of the M2 milestone documents. This amendment does not modify
`m2-integrated-readiness-report.md`, the frozen Truth, or any M2 acceptance criterion. It records
what a *next* experiment would need in order to move from model-free qualification to a bounded live
run.

## 1. What M2 established, and what it cannot establish

M2 is complete for its model-free scope: the fixture substrate, the frozen Truth, the scorer and
ledger, Profile A on the exact rr.7 binary and Profile B through the exact packed SDK, with real
reference artifacts and real consumer admission. Within that scope the pipeline is qualified end to
end, and the corrective pass removed six reproduced correctness defects.

M2 makes **no** claim about:

- whether a real reviewer model finds the injected defects,
- whether Profile A and Profile B agree on real model output,
- whether the criteria/claim binding survives realistic, verbose model prose,
- latency, token cost, or provider rate-limit behaviour.

Those are exactly the questions a live run would answer, and none of them can be answered by more
fake-provider work. Further model-free effort has diminishing returns.

## 2. Proposed change

Add a **bounded live-inference pilot** (D1) on the existing frozen fixture, with a spend envelope
(D2) that the maintainer sets before the first call.

| Dimension | Proposed value |
| --- | --- |
| Case set | The four existing candidates C1–C4 on authoritative snapshots, unchanged |
| Profiles | Profile A (rr.7 managed OCR) and Profile B (packed SDK), same inputs |
| Providers | One allowlisted provider per profile; no automatic fallback |
| Repeats | 3 per candidate per profile, to separate model variance from harness variance |
| Total calls | 24 inference calls (4 candidates × 2 profiles × 3 repeats), plus zero retries beyond the plan |
| Budget (D2) | A hard ceiling the maintainer approves in advance; execution stops at the ceiling, not at a "reasonable" point |
| Stopping rule | Stop on: budget ceiling, first unexplained identity mismatch, or any call that would leave the allowlisted provider |
| Evidence | Every request/response pair retained verbatim, plus the existing ledger, lifecycle records and admission decisions |

## 3. Controls that must be in place before the first call

1. **Authorization is explicit and separate.** D1 and D2 are recorded as granted, with a ceiling, or
   the pilot does not start. No call is made under an "implied" approval.
2. **The frozen Truth is not consulted by the reviewer path.** Truth is used only after the run, by
   the scorer, exactly as in the model-free suites.
3. **Failures stay failures.** A provider error, refusal or truncation is recorded as such; it is
   never retried into a passing result, and no test assertion is relaxed to accommodate it.
4. **Provider output is untrusted.** The decoder keeps its record-by-record behaviour, preserves
   provider references verbatim, and reports diagnostics rather than repairing them.
5. **Criteria binding stays content-addressed.** A live run may reveal that prose-heavy output trips
   the digest binding; that would be a finding to record, not a reason to fall back to revision
   labels.
6. **No production surface.** No deployment, no publishing, no tenant data, no credentials beyond
   the single allowlisted provider key held outside the repository.

## 4. Success and failure criteria (fixed before execution)

| Question | Success | Failure that still produces a usable result |
| --- | --- | --- |
| Does Profile A find the injected defects? | The expected finding is reported for each candidate | A miss is recorded as a reviewer-quality data point, not a harness defect |
| Do Profile A and Profile B agree? | Same criterion-level outcomes on ≥ 2 of 4 candidates | Systematic disagreement is recorded with the differing evidence references |
| Does claim-scoped support survive real prose? | No reference is applied to a claim it was not graded for | Any transfer observed is captured verbatim as a reproduction case |
| Is the run reproducible? | 3 repeats per case retained with per-repeat identity | Variance is reported; repeats are never averaged into a single "score" |

## 5. Explicit non-goals

- Not an expansion of M2 scope, and not a condition of M2 acceptance.
- Not a model-quality benchmark; 24 calls cannot rank models.
- Not a production readiness claim, a security review or a cost model.
- Not a reason to change the frozen Truth, the criteria content, or the admission rules.

## 6. Decisions required from the maintainer

1. Approve or reject D1 (live inference) for this bounded case set.
2. Set the D2 budget ceiling and confirm the 24-call plan fits it.
3. Name the single allowlisted provider and model per profile.
4. Confirm the evidence retention location and whether raw provider text may be stored.
5. Confirm that a partial or negative result will be published as-is.
