# D3-R2 — initial three-variant comparison (frozen, unannotated)

**Verdict: `D3_INITIAL_BATCH_COMPLETE — AWAITING_ILIYA_REVIEW`**

Frozen immediately after the three Criteria Assessment attempts completed. No correction round was
started, c02 was not repaired, c03 was not modified, and `evaluator/ORACLE.json` was **not consulted**
before this report was written. The raw provider replies below were written verbatim at dispatch, before
any parsing or annotation.

| | |
| --- | --- |
| Branch | `exp/synthetic-live-pilot-01` |
| Transport corrections | `58f0dee` (two defects fixed before any spend; see §3) |
| Frozen inputs | `delivery-req-v2`, profile digest `2a7532d7c604…` |
| M2 PR #2 | `996cdcb002f898a5b73ce8f9ce7931e6299b14e4`, clean |
| Comparator OCR | **not executed** (qualified `1.14.0-rr.1` unavailable, see §7) |
| Report reader | Iliya — this is his checkpoint |

---

## 1. Offline gates

`node synthetic/next-family/checks/verify-gates.mjs` → **12/12 PASS**, exit 0, run on the committed
state before dispatch:

```
PASS  1. packets reproduce at their frozen digests              2c607491fd99 d38c0af7cc82 89e4be23879a
PASS  2. task statement and candidate commits match family.json task ff243a43a8a7
PASS  3. no evaluator material or role word inside a packet     role words, oracle names, verdicts absent
PASS  4. credential scan of tracked and working files           0 new files scanned, no credential material
PASS  5. historical A/B/C evidence is untouched                 0.55929 / settled 0.3163953
PASS  6. proxy resolves module-relatively, audit passes         selftest PASS, audit 20/20
PASS  7. every offline test file passes                         52 passing, 0 failing, 0 skipped
PASS  8. launcher admission works for all three candidates      c01 25884B, c02 25741B, c03 26427B
PASS  9. budget arithmetic fits the authorization               4 x 0.04842 + 8 x 0.0275 = 0.41368
PASS 10. frozen metadata is internally consistent               profile 2a7532d7c604
PASS 11. M2 PR #2 repository is untouched                       clean at 996cdcb002f8
PASS 12. launcher has no credentialed egress outside the proxy  one fetch, loopback only
```

No assertion was relaxed to reach a pass. Gate 12 is new in this phase.

## 2. Credential readiness

Boolean-only checks, in the actual launcher's parent environment:

| Variable | Present | Length reported |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | 73 |
| `OPENROUTER_BASE_URL` | yes | 28 |

The value was never printed, read into evidence, hashed, logged or committed. Inheritance into the
launcher was proven by the launcher itself proceeding past its `credentials_absent` refusal (exit 3),
which it still performs when either variable is absent (gate 8).

## 3. Execution path

- Canonical proxy: `synthetic/tooling/openrouter-bounded-proxy.mjs`, resolved module-relative by
  `lib/paths.mjs` — no environment override, no fallback, no second location (gate 6).
- Criteria Assessment goes through the pinned Gateway SDK, `createLlmClient()`
  (`@agent-teams/account-gateway/llm`, `0.1.0`), with caller-supplied control and execution ports. The
  only egress the SDK can perform is the `request()` the launcher hands to `http://127.0.0.1:<port>/v1/responses`.
- **Two defects found during this admission pass and fixed before dispatch (`58f0dee`):**
  1. The launcher read the provider key's usage figure from `openrouter.ai/api/v1/key` directly. That
     request carries the credential and leaves the bounded boundary even though it is not inference. It
     was removed: the launcher now makes exactly one `fetch`, to the loopback proxy, and gate 12 fails
     the build if any non-loopback URL or a second fetch appears. Consequence, stated as a limitation:
     the provider's own billed total is not read independently in this phase.
  2. The proxy checked the byte ceiling on the *received* body and then forwarded a re-serialized payload
     that can grow (JSON round-trip, plus injection of a missing `max_output_tokens`). It now refuses a
     forwarded body above the ceiling (`proxy_forward_bytes_exceeded`) and records both lengths. Two
     existing fixtures that built an at-ceiling body without declaring an output ceiling were corrected
     to declare it, so forwarded bytes equal admitted bytes; the ceiling assertions themselves were
     unchanged.
- No retries: the SDK performs one attempt (`createLlmGenerator` never retries), the proxy runs
  `--max-requests 1` per attempt, and any halt refuses everything after. Each attempt recorded
  `forwardedRequests: 1` and `refusals: []`.
- Timeout: 150 s per request at the proxy; the SDK's own deadline is 240 s. No timeout occurred.
- Accounting of failures and refusals is in the proxy ledger; a non-2xx, timeout or absent usage keeps
  the full reservation and halts.

## 4. Model, provider and limits as actually enforced

| Item | Requested | Observed | Enforcement |
| --- | --- | --- | --- |
| Provider | OpenRouter | `null` in every reply | **Not pinned.** Streaming Responses replies name the model but not the upstream provider. Recorded as `null`, never as "verified". |
| Model | `openai/gpt-6.1-terra` | `openai/gpt-6.1-terra`, all three | Requested id refused pre-dispatch; observed id must match or the run halts and the reply is withheld. |
| Reasoning effort | `medium` | reasoning tokens billed (1,552 / 1,370 / 1,402) | `medium` refused pre-dispatch if changed. |
| Service tier | `default` | not reported | `default` refused pre-dispatch if changed. |
| Output ceiling | 2,500 tokens | 2,482 / 2,160 / 2,055 | Declared value above the ceiling refused pre-dispatch; a reported breach charges the truth and halts. |

**Token bound, verified rather than assumed.** The enforceable pair is serialized body ≤ 28,672 bytes and
input reservation 28,736 tokens (= bytes + 64 special-token allowance). The provider reported:

| candidate | body bytes | reserved input tokens | **reported input tokens** | ratio | reported output |
| --- | --- | --- | --- | --- | --- |
| c01 | 25,884 | 28,736 | **5,868** | 22.7 % of bytes | 2,482 |
| c02 | 25,741 | 28,736 | **5,811** | 22.6 % | 2,160 |
| c03 | 26,427 | 28,736 | **5,975** | 22.6 % | 2,055 |

Every reply came in at roughly a quarter of the byte bound, so the byte-derived ceiling was **not**
falsified and held with about 4.8× margin. It remains a documented upper bound, not a token count: the
exact tokenizer is not obtainable offline, and the proxy would have charged the truth and halted
(`ceiling_breached_by_reported_usage`) had it been exceeded. `chars / 4` was never used for enforcement.

## 5. Candidates and packet digests

| id | commit | packet bytes | packet sha256 (first 12) | serialized body sha256 (first 12) |
| --- | --- | --- | --- | --- |
| c01 | `54623dccc8b138c9ad5a41fc0347cf49ba039c61` | 23,220 | `2c607491fd99` | see `D3-R2-INDEX.json` |
| c02 | `65f210381920fbfce032cf5ba8aaa440f3300162` | 23,093 | `d38c0af7cc82` | see `D3-R2-INDEX.json` |
| c03 | `18bbde350074d4afd8a3e3d52be31479c6ba85fc` | 23,743 | `89e4be23879a` | see `D3-R2-INDEX.json` |

Same frozen criteria for all three, same rule `next-family-packet-rule-v1`, no per-candidate file
selection, no role words or expected verdicts in any packet (gate 3). c03's `@fixture/delivery-core`
boundary is declared in `TASK.md` v2 and the handoff. The evaluator-only expectation table was not
opened.

## 6. Attempts

| candidate | attempt id | state | forwarded requests | reported input | reported output | settled USD |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | `att-c01-criteria-20261123T163938612Z-581a22` | `completed` | 1 | 5,868 | 2,482 | 0.019745 |
| c02 | `att-c02-criteria-20261123T164030465Z-8577d2` | `completed` | 1 | 5,811 | 2,160 | 0.01806375 |
| c03 | `att-c03-criteria-20261123T164113224Z-6d96a7` | `completed` | 1 | 5,975 | 2,055 | 0.01774375 |

Each attempt directory holds `attempt.json` (admission), `request/ledger.jsonl` (the proxy's own records),
`raw/response.txt` (verbatim reply, written before parsing), `result.json` and `request/proxy.log`.
Nothing was deleted or overwritten; `index.jsonl` is append-only. The first receipt was checked against
the pre-dispatch assumptions (one request, usage present, inside both ceilings, identity verified) before
the next paid request was admitted. No attempt was rerun.

## 7. Criteria findings, as reported

Verdicts exactly as the assessor returned them. `violated` = 10, `satisfied` = 5, **`inconclusive` = 0**.

| id | C1 | C2 | C3 | C4 | C5 |
| --- | --- | --- | --- | --- | --- |
| c01 | violated | violated | violated | violated | satisfied |
| c02 | violated | violated | satisfied | violated | satisfied |
| c03 | violated | violated | satisfied | violated | satisfied |

What the assessor asserted:

- **c02.C1 (the intended signal) — found, with the right mechanism.** "Intake ignores the header and
  indexes by payload hash. The same key with different payloads creates multiple deliveries, while
  identical payloads without a key are incorrectly collapsed." Fix: index by the `Idempotency-Key`
  header and consult the index only when the header is present.
- **A single repeated accusation carries C2 and C4 on all three candidates**, including the complete
  control: that `attemptDelivery` does not check a terminal state on entry, so a later worker invocation
  re-attempts a delivery that already failed non-transiently (or was failed by a `410`). It is asserted
  with the same confidence for c01, c02 and c03.
- **c01 additionally gets C1 and C3 violations** from source reading: that only a lowercase header name
  is recognized and an empty key ignored (C1), and that an empty-string `subscriptionId` is rejected
  `400` before the payload-size check, so an oversized payload with that id receives `400` rather than
  `413` (C3).
- **c03.C2 is reported `violated`, not `inconclusive`**, while the explanation itself concedes "the
  provided material cannot establish the external policy's classifications or growing delays; the tests
  have no execution receipt". The correction text does name the resolving evidence ("verify the
  workspace policy source or provide execution evidence"), but the status is an accusation.
- **No assessment anywhere used `inconclusive`**, the status the profile provides for genuinely
  insufficient evidence and the one c03 exists to elicit.

Ordinary check receipts at review time (unchanged, `checks/RECEIPTS.json`): c01 17/17, c02 16/16,
c03 17/17, 0 skipped. They positively establish C3's two boundaries, C4's two clauses, C5, four of C2's
five clauses, and C1 on c01 and c03; they do not cover c02's C1 key-identity clause, the validation
order, or C2's delay growth. The assessor does not receive them, by design.

**Conflict to adjudicate at the checkpoint, not by me:** on c01 the receipts establish C1 and C4's two
clauses, yet the assessor reports both violated; and the C2/C4 "worker re-attempts a terminal delivery"
mechanism is not exercised by any receipt for any candidate. I have not inspected candidate source to
settle whether that mechanism is real, because that is the correction round Iliya has not authorized.

## 8. Ordinary OCR

**Not executed.** The qualified comparator is `open-code-review 1.14.0-rr.1`, linux/amd64, sha256
`443d7777…`, 87,356,967 B, artifact id 14714439075. It is not present on this machine: the only OCR
images available locally are `m2-ocr-rr7:local` and `m2-rr7:latest`, which are the superseded rr.7
build, and no `opencodereview-*` binary exists on disk. Docker is available, but the qualified artifact
is not, and the frozen card forbids substituting a comparator ("if unavailable, skip OCR and record the
limitation — never substitute"). The OCR column of the comparison is therefore **incomplete**, not empty
-and-passing. Consequence for the decision: this batch cannot measure whether ordinary OCR would have
found c02's C1 defect on its own, so the assessor's marginal value over OCR remains unmeasured.

## 9. Comparison

| Candidate | Ordinary checks | OCR | Criteria verdicts | Missing or incorrect evidence | Action for Iliya |
| --- | --- | --- | --- | --- | --- |
| c01 complete control | 17/17, 0 skipped; establishes C1, C3 boundaries, C4 clauses, C5, 4/5 of C2 | not run (comparator unavailable) | C1/C2/C3/C4 violated, C5 satisfied | The assessor's C1 and C4 violations conflict with executed receipts; the C2/C3 accusations rest on precedence and worker-invocation readings no receipt covers | Decide whether four violations on a known-complete implementation is tolerable noise for an advisory tool |
| c02 known idempotency defect | 16/16; its suite encodes the wrong collapse and omits the keyless case | not run | C1 violated, C2/C4 violated, C3/C5 satisfied | C1 is supported and correctly explained (payload hash instead of key); C2/C4 share the same uncovered mechanism as everywhere else | The real defect was caught for the right reason — weigh that against the false accusations |
| c03 missing-evidence control | 17/17, 0 skipped; retry path runs, classification outside the checkout | not run | C2 violated, C1/C4 violated, C3/C5 satisfied | C2 should be `inconclusive`; the assessor concedes the policy is unestablishable yet returns `violated`. The resolving evidence is named, so the correction text is usable even though the status is wrong | Decide whether an accusation plus a named evidence gap is acceptable, or whether `inconclusive` must be enforced |

Summary of the measured behaviour:

- **Supported completion:** c01.C5, c02.C3/C5, c03.C3/C5 — all consistent with receipts.
- **Supported violation:** c02.C1 only.
- **Useful uncertainty:** none produced. c03.C2 named the right missing evidence but mislabelled it.
- **Unsupported satisfaction:** none.
- **Unsupported violation:** c01.C1 and c01.C4 conflict with executed receipts; the C2/C4 mechanism is
  asserted identically for a correct and an incorrect candidate, so it does not discriminate.
- **Failed execution:** none — three attempts, three `completed`, zero refusals, zero retries.
- **Incomplete evidence:** the OCR comparator column.

## 10. Accounting

| Line | USD |
| --- | --- |
| Approved aggregate ceiling | 1.00000000 |
| Historical committed (settled 0.31639530 vs conservative 0.55929, `max`, never summed) | 0.55929000 |
| New settled, c01 + c02 + c03 | 0.05555250 |
| **Aggregate worst case now** | **0.61484250** |
| **Remaining authorization** | **0.38515750** |

Reservations were taken at the admitted maximum (0.04842 each) and settled to reported usage. All three
are `settled`; none is `unresolved`. The correction reserve (0.04842) was never reserved and remains
available. Actual spend was 13.4 % of the reserved maximum because reported input came in far below the
byte-derived reservation — the reservation was conservative, never binding.

## 11. Unchanged

Original A/B/C research evidence, `synthetic/runs/*`, D1/D2 authorization, the Gateway, the production
ReviewRouter and the OCR engine are untouched (gate 5). M2 PR #2 is clean at `996cdcb0…` (gate 11).
No new family, candidate, model, provider, strategy or matrix was introduced.

## 12. Limitations to carry into the decision

- Upstream provider routing is **unverified**: every reply reported `provider: null`. Requested identity,
  observed model id, the allowed set and a hard halt are enforced; upstream pinning is not claimed.
- The token bound is a documented upper bound that the first three replies confirmed with ~4.8× margin;
  it is not a tokenizer count.
- c01's reply used 2,482 of 2,500 output tokens — 18 tokens of headroom. A longer reply would have been
  truncated (`output_truncated`), not accommodated; the ceiling was not raised.
- The assessor receives no execution receipts by design, which is the most likely source of its C2/C4
  accusations; that is a property of the frozen profile, not a defect of this run.
- OCR is missing, so no OCR-vs-assessor comparison is possible from this batch.
- This batch says nothing about consumer publication, opt-in UI or Gateway deployment.

## 13. Status message for Iliya

> The three-variant batch ran clean: three attempts, one request each, no retries, no refusals, USD
> 0.05555250 spent, USD 0.38515750 of the authorization left. The assessor found c02's real idempotency
> defect for the right reason, but it also reported 10 of 15 obligations as violated, never used
> `inconclusive`, and put four violations on the complete control — including C1 and C4, which our own
> executed checks establish. c03's C2 came back `violated` while the explanation concedes the policy
> cannot be established from the packet. OCR could not run: the qualified `1.14.0-rr.1` binary is not on
> this machine and only the superseded rr.7 build is available, so substitution was refused. Raw,
> unannotated replies are frozen and indexed; nothing was corrected. Your call on whether this noise
> level is usable for an advisory tool.
