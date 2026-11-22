# Runbook — the blocked A→B recheck

Status: **not executed**. The provider credential is not present in any environment this session
can reach (`OPENROUTER_API_KEY` absent from the process environment, the user environment, the
machine environment and the shared terminal). No paid request was dispatched. Every command below
is model-free until the two exports succeed.

## 1. Provide the credential (never paste it into chat)

In the right-side terminal, or any shell that will run the commands:

```bash
export OPENROUTER_API_KEY=...            # the pilot's own key, typed locally
export OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

The key is read by the bounded proxy and by the SDK runner only; it is never written to a file,
logged, echoed or committed. Do not add `setx`: the value stays in the shell.

## 2. Ordinary OCR, corrected rule delivery

```bash
cd synthetic/runs/d12-recheck
LABEL=A bash run-ocr.sh                 # Candidate A, corrected rule document
LABEL=B TO=980a14cb5ac95cc917acf033dd74dc70e1a246f5 bash run-ocr.sh
```

Each stage reserves at most USD 0.345 at conservative prices (180,000 input / 24,000 output tokens,
input priced at the cache-write rate), writes `stage-summary-ocr-<label>-live.json`,
`ledger-ocr-<label>-live.jsonl`, `ocr-result-<label>-live.json` and the provider key usage
before/after.

## 3. Criteria recheck on Candidate B

```bash
node criteria.mjs B
```

One request, one attempt; proxy caps 20,000 input / 4,000 output tokens; worst case USD 0.045.

## 4. What to check afterwards

| Question | Evidence |
| --- | --- |
| Did the policy text reach every review round? | `ledger-ocr-*-live.jsonl` exists; compare `maxInputBytes` with the frozen 62,517 B and confirm `inputBytes` grew by the policy block (387 B × 4 rounds) |
| Did OCR stop reporting the R3 gap? | `ocr-result-B-live.json` → `comments`; no finding on `src/router.ts` for CSV |
| Did criteria recognise the correction? | `criteria-assessment-B.json` → `result.value.assessments`; R3 expected `satisfied` with `src/router.ts` evidence |
| Did either path invent new objections? | new findings on `src/csv.ts`, `src/format.ts`, `src/store.ts`, `tests/csv.test.ts` |
| Spend | `providerKeyUsage.delta` per stage; reconcile against USD 0.09085455 spent and the USD 1.00 ceiling |

Budget already reserved for this run: USD 0.735 worst case, leaving USD 0.17414545 for at most one
small diagnostic case.

## 5. Order of operations that must not change

Freeze both recheck outputs before consulting `synthetic/evaluator/`. The hidden check and
expectations are not reviewer input and must not influence any prompt, correction or case design.
