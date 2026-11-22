# D3 closeout erratum — accounting, publication and interpretation

Appends to `HANDOFF-d12-product-decision.md` (commit `ed514ae`). This is the one closeout record for
the A/B/C study. The frozen reports, their digests and `FREEZE.json` are unchanged; this file is
post-freeze analysis and is deliberately not listed in the manifest (the manifest excludes itself and
anything written after it).

No model output was reinterpreted, no request was made, and no verdict was recomputed.

---

## E1 — The USD 0.01054925 gap is settlement timing on the final C call

Verified by summing the per-request `usage.cost` recorded in the **distinct** billable ledgers
(`d12-initial-rr1/evidence/*` and `d12-recheck/*`; the four files duplicated at
`d12-initial-rr1/` were excluded from the sum):

| Ledger | Forwarded | Settled USD |
| --- | --- | --- |
| `d12-initial-rr1/evidence/ledger-live-attempt1.jsonl` | 3 | 0.02164250 |
| `d12-initial-rr1/evidence/ledger-live.jsonl` | 10 | 0.06093280 |
| `d12-recheck/ledger-criteria-B.jsonl` | 1 | 0.01035050 |
| `d12-recheck/ledger-criteria-C.jsonl` | 1 | 0.01054925 |
| `d12-recheck/ledger-ocr-A-live.jsonl` | 10 | 0.05573645 |
| `d12-recheck/ledger-ocr-B-live-attempt1.jsonl` | 6 | 0.03684875 |
| `d12-recheck/ledger-ocr-B-live-attempt2.jsonl` | 5 | 0.03764595 |
| `d12-recheck/ledger-ocr-B-live-revised.jsonl` | 13 | 0.07440985 |
| **Total** | **49** | **0.30811605** |

The initial criteria call has no ledger line; its usage lives in
`d12-initial/evidence/criteria-assessment.json` and `d12-initial/EXECUTION-RECORD.json`
(4,312 in / 578 out, provider cost **0.00827925**).

- `0.30811605 + 0.00827925 = 0.31639530`
- `0.31639530 − 0.30584605 (key snapshot) = 0.01054925` — **exactly** the C criteria charge.

Two independent records corroborate settlement lag rather than an omitted entry:

1. `reconciliation.json` records `providerDelta: 0` for `diagnostic-criteria-C` while the same record
   carries a non-zero upstream cost of 0.01054925 from the response itself.
2. The rr1 stage read a `/key` delta of `0.04345405` for a call charged `0.085926` — the same endpoint
   under-reporting a settled charge by roughly half.

Conclusion: provider settlement timing of the last call. No ledger entry is missing, no charge is
counted twice, and the key snapshot is preserved as the historical figure it was.

**Carried forward for admission:** conservative reconciled upper bound **USD 0.55929** (all input at
the cache-write rate, every forwarded attempt included), leaving **USD 0.44071** of the USD 1.00
authorisation. USD 0.69415395 is withdrawn as an allowance: the key's USD 5.00 limit is not this
experiment's ceiling.

---

## E2 — The 12 unpublished evidence paths were ignored by a `.gitignore` rule

The remote audit resolved 50 of 62 declared entries. The unresolved 12 are exactly the `*.log`
entries of `synthetic/runs/d12-recheck/`, and `git check-ignore -v` attributes every one of them to
`.gitignore:4` (`*.log`):

`criteria-proxy-B.log`, `criteria-proxy-C.log`, `ocr-stderr-A-live.log`, `ocr-stderr-A-offline.log`,
`ocr-stderr-B-live-attempt1.log`, `ocr-stderr-B-live-attempt2.log`, `ocr-stderr-B-live-revised.log`,
and the five empty `ocr-stdout-*.log` files.

They therefore existed locally, were **not** withheld for privacy or safety, are not broken
references, and are not unavailable. They were published with `git add -f`, byte-for-byte, so every
declared digest still verifies. Re-verification after publication: 62 manifest entries, 62 resolved
with matching size and sha256, 0 missing, 0 mismatched, `hiddenEvaluatorConsulted: false`.

`FREEZE.json` was not edited — publishing the files makes its references resolvable without re-freezing.

---

## E3 — Consumer publication is a later stage than inline placement

The pinned chain, read at `7a079c38…`, is:

1. **Native findings** per work slot.
2. **OCR normalization** (`ocr-review-normalization.ts`): severity map `critical→critical`,
   `high→major`, `medium→minor`, `low→minor`, unknown→`minor` with a partial flag.
3. **Dedupe + consensus** in `LegacyReviewProjectionPolicyAdapter.selectCurrent`, with
   `retainBelowAgreement: true` — "Keep insufficiently corroborated findings visible in the summary.
   Inline placement enforces the threshold separately."
4. **`FindingFilter` runs inside that same selection**, before projection and therefore before
   publication: `new FindingFilter().filter(consensus, query.diff, …)`.
5. **Projection** builds the published summary; **inline placement** is a separate step that can
   decline a finding (`legacy synthesis did not select inline placement`).

The filter's test-file branch drops findings on test files and test infrastructure and keeps only
`isTrueSecurityIssue`. So **non-security findings on test files are excluded before publication**, not
merely from inline placement. A finding being inline-visible in a reconstructed view does not mean it
reaches the consumer.

What this study actually established about Candidate B: three findings on `tests/records.test.ts` were
inline-visible in the normalized view (`consumer-view-B.json`). Under the pinned policy those three
are non-security test-file findings and would be filtered out before publication. The deployed
publication path was **not executed**; this reconstruction is source-derived.

One limit, stated rather than assumed: the adapter passes `isProducerClassifiedBug`, and whether that
option bypasses the test-file branch in `finding-filter.ts` was not established from the source
inspected. It does not change the conclusion for these three findings, which OCR classified as
`bug`/`maintainability` on a test path, but it is not claimed to be a general rule.

---

## E4 — R1: three different contracts, one verdict

| Artifact | What it says about empty parameters |
| --- | --- |
| Frozen `R1` (`record-api-req-v1`) | "The API must list records with the requested filters and pagination." No `400` clause, no bound, no default, nothing about empty values. |
| PR description | "An unusable `limit`, `offset` or `status` is answered with `400` and the offending field." Does not distinguish *absent* from *explicitly empty*. |
| Candidate code (22-case probe) | `limit=`, `offset=`, `status=` → `200` with defaults (probe labels these "not specified by the frozen contract"); `limit=101`, `0`, `-1`, `1.5`, `abc` → `400`. Behaviour is identical on A and B. |

The OCR objection in the frozen initial run was: *"Explicitly empty pagination values such as `limit=`
and `offset=` are silently treated as omitted, despite the stated contract that unusable values return
400. The status check below also accepts `status=`."* (severity `medium`, `src/records.ts`).

Correct reading:

- `R1 satisfied` is supported **against the frozen criterion**, and the case for it is unaffected.
- "The OCR objection is unsupported" holds **only** when the frozen criterion is named as the
  contract. Against the PR description — which the same reviewer received — the comment is a
  defensible observation about an unspecified edge (empty value versus absent), not a refuted one.
- Frozen `R1` is **not** amended to add a `400` or empty-value obligation. The PR body is author
  context, not owner criteria.

---

## E5 — What the assessor received, and what the probes were worth

The Criteria Assessment received the frozen requirements and repository source at the candidate. It
did **not** receive executed check results, OCR findings, or the later 22-case contract probe. Its
positive verdicts were reached from source, so describing it as "merely formatting check results" is
wrong in both directions: it had no results to format, and the results did not exist yet.

Symmetrically, the later bespoke probes (`r1-contract-probe-{A,B}.json`, `candidate-b-route-evidence`,
`diagnostic-c-route-evidence`) were written by us after the fact. They corroborate behaviour; they are
not free ordinary baseline evidence available at the original decision point, and they must not be
presented as evidence the reader had.

---

## Scope

This erratum changes no verdict, no digest and no original report. It resolves the accounting question,
publishes the omitted logs, states the publication chain and its one open sub-question, and separates
the three R1 contracts. The next batch (`synthetic/next-family/EXECUTION-CARD.md`) is prepared
separately and is not a retroactive gate on this closeout.
