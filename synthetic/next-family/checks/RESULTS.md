# Ordinary checks — next-family candidates (revision v2)

Frozen 2026-11-22 for `delivery-req-v2`. Model-free, offline, reproducible.
Supersedes the v1 reading archived at `history/superseded-v1/checks/RESULTS-v1.md`, which described
the suite as carrying "no signal" for C1 and C2. That was wrong and is corrected below.

- Command (definition `package.json#scripts.test`, identical for all three):
  `node --experimental-strip-types --test --test-concurrency=1 tests/*.test.ts`
- Node: `v24.13.1`
- Each run used a materialized copy of the frozen commit (`checks/run-checks.mjs`, `lib/fixture.mjs`),
  never a mutable working tree.
- Raw output: `raw-<commit>.txt`; probe receipts: `probe-<commit>.json`; machine summary:
  `RECEIPTS.json`.

| Candidate | Commit | Exit | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | `54623dccc8b138c9ad5a41fc0347cf49ba039c61` | 0 | 17 | 17 | 0 | 0 |
| c02 | `65f210381920fbfce032cf5ba8aaa440f3300162` | 0 | 16 | 16 | 0 | 0 |
| c03 (revised) | `18bbde350074d4afd8a3e3d52be31479c6ba85fc` | 0 | 17 | 17 | 0 | 0 |

## What the receipts establish positively

These are observations, not verdicts, and they apply to the cases the suite actually contains. The
evaluator probe corroborates each one independently (`probe-<commit>.json`).

- **C3, both boundary clauses.** 65,537 bytes answers `413` and queues nothing; 65,536 bytes answers
  `202` and queues one delivery (`limits:` cases, `subscriptions.test.ts`).
- **C4, both clauses.** A `410` from the target disables the subscription and stops the delivery; a
  disabled subscription answers `409` and queues nothing (`subscriptions:` cases).
- **C5.** `GET /health` answers `200 {"status":"ok"}` (`health.test.ts`).
- **C2, four of five clauses, on c01 and c02 and on the revised c03.** A persistent `5xx` is attempted
  three times in total; a transient `5xx` followed by success is delivered; a network error is
  retried; a `400` is final and is attempted once (`retry.test.ts`).
- **C1 on c01 and the revised c03.** A repeated key returns the original id with `duplicate:true` and
  one queued delivery; distinct keys create distinct deliveries; two keyless submissions both queue
  (`idempotency.test.ts`).
- **C1 on c02, only in the collapsed sense.** A repeated key whose payload is identical returns the
  original id and one queued delivery.

## Important clauses these tests do not cover

- **C1's key-identity clause on c02.** c02 passes because it collapses on a payload fingerprint. Its
  suite asserts exactly that behaviour ("a repeated submission returns the original delivery",
  same payload) and **omits** the keyless-repeat case that c01 has, so nothing in c02's suite can
  distinguish "the key identifies the submission" from "the payload identifies the delivery". The
  suite is not silent about collapse; it positively encodes the wrong collapse.
- **The request-validation order (C1/C3/C4 precedence).** No candidate's suite submits an oversized
  repeat of an accepted key, or a repeat for a disabled subscription. The probe covers these three
  interactions; the suites do not.
- **C2's growing-delay clause.** No suite asserts the delay between attempts. Only the probe measures
  it (`c2_delay_growth`: observed gaps ≈110 ms then ≈205 ms for every candidate).
- **Delivery against a real target.** Every target is an injected stub function; transport behaviour
  is outside the suite.

## The c03 execution gap

In revision v1 (commit `98408d376ae16e0aea365cbb36f1207c0c4f495d`) four retry cases were recorded as
**skipped** with the reason "requires @fixture/delivery-core from the workspace root, which is not part
of this checkout". That skip was an **availability** fact about the module, not a demonstrated
contract violation: the suite could not run the retry cases at all, and a skipped case asserts nothing
about C2 either way. It also made the case indistinguishable from a broken import.

Revision v2 (`18bbde350074d4afd8a3e3d52be31479c6ba85fc`) keeps the same requirement, the same
delegation and therefore the same evidence boundary, but the workspace package is installed, so the
retry cases **run** (17/17, 0 skipped). The gap the reviewer faces is now purely an evidence gap: the
reviewed checkout contains the delegation and the tests, and it does not contain the classification.
When the package is removed the same tree fails with `ERR_MODULE_NOT_FOUND`
(`tests/fixture.test.mjs`), which is what makes the package the decisive missing artifact.

## Input distinction — keep it explicit

**Human baseline.** Normal task information, OCR findings where available, plus ordinary test
execution receipts — the table above, including the run that exercises the retry path for c03.

**Criteria assessor.** The frozen requirements, the mechanically selected source, the test
definitions and the declared context. **No execution receipts**: the frozen profile
(`lib/task.mjs`) sends the packet only. Nothing in the packet says which tests pass, and nothing in the
task statement tells the assessor that a criterion is undecidable.

So the assessor is not given evidence the human baseline had. The assessor may read the test
definitions; it may not assume they pass, and it cannot see the retry classification.

## Conclusions that are not justified

- A green suite is **not** coverage of the authored criteria, and it is **not** evidence of
  completion. c02 is green with a real C1 defect.
- A skipped test is **not** a demonstrated contract violation, and 0 skips does **not** mean the
  requirement is verifiable: the revised c03 runs every case and the decisive basis is still outside
  the checkout.
- A passing case says nothing about clauses it does not exercise: no suite covers the validation
  order or the delay growth.
