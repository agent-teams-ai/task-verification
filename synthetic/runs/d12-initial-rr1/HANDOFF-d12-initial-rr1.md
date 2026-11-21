# Handoff to Iliya — D1/D2 initial synthetic comparison

Status: **`ORIGINAL_REPORT_READY_FOR_ILIYA — HUMAN_CHECKPOINT`**
Date: 2026-11-21

This handoff is a pointer, not a substitute. The primary artifact is the original, unannotated
comparison report. Read it first:

> **`synthetic/runs/d12-initial-rr1/REPORT-d12-initial-rr1.md`**
> (`exp/synthetic-live-pilot-01`, committed in `efdc948`; blob `2654b63d92b7db3d27efffa4381ee917817a56c5`)
>
> Read it together with **`synthetic/runs/d12-initial-rr1/ERRATUM-d12-initial-rr1.md`** — four
> arithmetic/provenance corrections (stage worst case 0.40 → 0.44 and plan total 0.84827925 →
> 0.92827925; spend provenance wording; the modelled-vs-actual gap explanation; background 2,605 →
> 2,606 chars). No finding, verdict or conclusion changes.

## 1. Frozen Candidate A

`23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` — fixture `HEAD`, base
`ce99b0d65d645124413a746ecb137b5497aad80f`; the fixture repository contains exactly two commits.
**Candidate B does not exist** (no ref, no commit, no object).

## 2. Qualified OCR comparator

`QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE`
Binary SHA-256 `443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399`, 87,356,967 bytes,
`open-code-review 1.14.0-rr.1 linux/amd64`, from CI run 44924052949 (artifact
`managed-ocr-8a70944f567beba9ffc12d1153e33ef5fd60967d`, qualification 4/4 model-free, manifests and
shipped `.sha256` in silent agreement). The same binary is to be used for any authorized recheck.

## 3. Both paths found R3

- Ordinary OCR: `src/router.ts:28`, category `bug`, severity `high` — the required CSV export is not
  exposed by the router.
- Criteria Assessment: **R3 `violated`** — the CSV helper and its tests exist, but no route exports.
- Also from criteria: R1 `satisfied`, R2 `satisfied`.

Both paths detected the same omission in this one fixture. No general superiority is claimed, and none
should be read into it.

## 4. Additional OCR findings — your judgment needed

These are reported as stated by the comparator, with no false-positive classification applied:

1. `src/records.ts:46` — `bug` / `medium`: explicitly empty `limit=`, `offset=` and `status=` are
   treated as omitted, contradicting the stated 400 contract.
2. `tests/records.test.ts:11` — `maintainability` / `low`: `body(...): any` disables type checking for
   every response assertion in the suite.
3. `tests/records.test.ts:64–68` — `test` / `low`: the rejection tests never exercise `offset` or the
   upper limit bound, so removing those validations would still pass.

Original finding text, evidence and proposed corrections are quoted in report §7.

## 5. Requests and cost

| | Count / value |
| --- | --- |
| Criteria Assessment | 1 request, USD 0.00827925 (provider-reported) |
| OCR attempt 1 | 3 forwarded, **1 locally refused** at 47,334 B (never sent upstream), USD 0.0216425 |
| OCR attempt 2 | 10 forwarded, 0 refused, USD 0.0609328 |
| **Total forwarded inference requests** | **14** (13 OCR + 1 criteria) |
| **Actual cumulative spend** | **USD 0.09085455** (sum of provider-reported per-request costs) |
| Remaining of the USD 1.00 ceiling | **USD 0.90914545** |
| Proxy-modelled charges (no cache pricing) | USD 0.11280625 — informational only, not the cost of record |

The provider-side key limit was **USD 5.00** during execution. The USD 1.00 experimental ceiling was
enforced by the bounded proxy, not by the provider.

## 6. Key limitations

1. **No deployed Gateway service.** The criteria path used `createLlmClient()`, and the SDK owned
   encoding, streaming, terminal reduction and usage mapping, but the control plane and execution port
   were supplied locally. This is **not** an end-to-end deployment of the production Gateway control
   plane, and server-side Gateway admission/accounting did not exist here.
2. Provider key limit USD 5.00, not USD 1.00; the aggregate ceiling is proxy-enforced only.
3. Old compromised key revocation unverified (needs dashboard evidence).
4. Pre-filter comment count not exposed by the CLI's managed JSON for the live run.
5. Upstream provider name absent from the stream; only the model name is observed.
6. Cost is per-request provider-reported and settles with delay; the last in-run key snapshot read
   0.0733758.
7. The 64 KiB request bound is empirical (38% headroom over the largest observed body), not analytic.
8. One fixture, one candidate, one run per path.

## 7. Nothing has been corrected or rechecked

No correction implemented, no recheck executed, no Candidate B created, no hidden evaluator material
consulted, no evaluator annotation applied, no further inference after the initial stage, no PR action,
nothing pushed or published. PR #2 remains **OPEN** and Draft at
`996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, unchanged.

## 8. Decision requested

Which of the actionable comments should be returned for implementation? The candidates are the R3 CSV
export, the empty-parameter contract at `src/records.ts:46`, and the two test-quality notes. Not every
comment needs to be fixed, and no choice here is derived from hidden evaluator expectations.
