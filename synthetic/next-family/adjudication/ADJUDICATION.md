# D3-R3 — model-free defect adjudication

Adjudication of the disputed claims in the frozen D3-R2 batch against the original candidate commits and
the original inputs. Model-free: no inference, no evaluator annotation read before the original results
were frozen, no candidate modified.

| | |
| --- | --- |
| Frozen requirements | `TASK.md`, revision `delivery-req-v2`, sha256 `ff243a43a8a7…` (not revised in this pass) |
| Candidates | c01 `54623dccc8b1…`, c02 `65f210381920…`, c03 `18bbde350074…` |
| Base | `c65bc835ca35b94fd0de3e3c0cc2c8d459b556de` |
| Reproductions | `synthetic/next-family/adjudication/reproduce.mjs`, `synthetic/next-family/adjudication/policy-variants.mjs`; receipts in `synthetic/next-family/adjudication/reproductions/` |
| Original replies | `runs/attempts/att-c01…`, `att-c02…`, `att-c03…` — unmodified |
| Matrix | §2G |

## 0. Method, evidence classes and the caller boundary

Each claim is recorded with the fields the maintainer required: frozen requirement text, the mandatory
clause relied on, the actual implementation, the original model claim, a concrete counterexample or
source evidence, whether the behaviour was reproduced through an authorized test, the actual
caller/transport boundary, existing check coverage, the conclusion, the accepted action and the
unresolved uncertainty.

Three evidence classes are kept separate, and every row says which one it uses:

- **Reproduced** — the frozen commit materialized into a temporary tree and driven through its own
  exported entry points (`node --experimental-strip-types synthetic/next-family/adjudication/reproduce.mjs <id> <sha>`).
  No working tree was mutated; `lib/fixture.mjs` writes the tree file by file from `git ls-tree`.
- **Source inspection** — the frozen blob, quoted by file and symbol.
- **Retained receipt** — `checks/raw-<commit>.txt`, `checks/probe-<commit>.json`, `evaluator/ORACLE.json`.

**Caller boundary, stated once.** The service provides `POST /deliveries` (intake) and
`attemptDelivery(store, deliveryId, target)` (the worker entry point named in `TASK.md`), over an
in-memory `DeliveryStore` whose only queue accessor is `queued()`/`pending()`. The fixture contains **no
scheduler**: nothing in the provided material decides when a second invocation happens. So a defect
demonstrated by calling `attemptDelivery` twice is a defect *of the provided entry point* — it accepts a
terminal delivery and contacts the target — but it is **not** evidence that production traffic would
re-enter automatically. Both statements are recorded, and the second is never upgraded into a finding.

A passing test over a narrower scenario is not treated as disproof of a counterexample anywhere below.

---

## 2A. c02 C1 — idempotency-key identity

**Frozen requirement (C1).** "A submission carrying an `Idempotency-Key` header creates at most one
delivery for that key. The key identifies the caller's submission and not its content: two submissions
carrying the same key but different payloads are still one delivery. Within the valid-submission domain,
a repeat with the same key is answered with `202` and the delivery id created for that key, and adds no
second item to the queue. A submission without the header always creates a new delivery."

**Mandatory clauses.** (i) key identity, not content; (ii) a headerless submission always creates a
delivery.

**Actual implementation** (`65f210381920`, `src/router.ts`).
```ts
function deliveryFingerprint(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
// ...
const key = deliveryFingerprint(parsed.payload);
const existing = store.lookupIdempotency(key);
if (existing) { /* 202 with the original id */ }
const delivery = enqueueDelivery(store, subscription.id, parsed.payload);
store.rememberIdempotency(key, delivery.id);
```
The request headers are never read on this path.

**Original model claim.** "Intake ignores the header and indexes by payload hash. The same key with
different payloads creates multiple deliveries, while identical payloads without a key are incorrectly
collapsed."

**Counterexample (reproduced).**

| Scenario | c01 | c02 | Requirement |
| --- | --- | --- | --- |
| same key `k-1`, payloads `alpha` then `alpha-two` | 1 id, 1 queued | **2 ids, 2 queued** | one delivery |
| no header, `alpha` twice | 2 ids, 2 queued | **1 id, 1 queued** | two deliveries |
| same key `k-1`, same payload twice | 1 id, 1 queued | 1 id, 1 queued | one delivery |

Receipts: `synthetic/next-family/adjudication/reproductions/c01.json` and its c02 sibling, scenarios `c1_same_key_different_payload`,
`c1_no_key_identical_payloads`.

**Caller boundary.** `handle(store, { method:"POST", path:"/deliveries", headers, body })`. `headers` is
`Record<string, string | undefined>`; c02 reads none of it. No transport normalisation is involved: the
reproduction passes the same plain object the suite passes.

**Existing check coverage.** c02's suite is 16/16 and **positively encodes the wrong behaviour**: its
"repeated submission returns the original delivery" case repeats *the same payload*, which the fingerprint
satisfies, and it omits the keyless-repeat case that c01 has. `checks/RESULTS.md` already records this.

**Conclusion.** `CONFIRMED_REQUIRED_VIOLATION`, both clauses, independently reproduced. This is the one
finding D3-R2 rated correctly and for the right mechanism.

**Accepted action.** Preserve as a confirmed defect of the frozen c02; do **not** modify c02 (the OCR
comparator reviews it unchanged). The correction for any downstream fix is to index by the
`Idempotency-Key` value and to consult/record the index only when the header is present.

**Unresolved uncertainty.** None that affects the verdict. Header-present-but-empty is a separate
ambiguity, adjudicated in 2D.

---

## 2B. C2 / C4 — terminal delivery re-entry

**Frozen requirement (C2).** "A delivery is retried when an attempt fails transiently: a `5xx` response
from the target, a network error, or a timeout. It is not retried for any other `4xx` response. At most
three attempts are made in total, and the delay between attempts must grow."

**Frozen requirement (C4).** "When the target answers `410 Gone`, the subscription is disabled and the
delivery is not retried. While a subscription is disabled, `POST /deliveries` for it is answered with
`409` and nothing is queued — including a repeat that carries a previously accepted `Idempotency-Key`."

**Mandatory clauses relied on.** C2: "It is not retried for any other `4xx` response." C4: "the delivery
is not retried" after a `410`.

**Actual implementation** (identical in all three commits, `src/delivery.ts`).
```ts
const delivery = store.get(deliveryId);
if (!delivery) return undefined;
const subscription = store.getSubscription(delivery.subscriptionId);
if (!subscription) return undefined;

while (delivery.attempts < MAX_ATTEMPTS) {   // no terminal-state check on entry
  delivery.attempts += 1;
  // ... target(...)
  if (status === 410) { store.disableSubscription(...); delivery.state = "failed"; return delivery; }
  if (!isRetryableStatus(status)) { delivery.state = "failed"; return delivery; }
}
```
`src/store.ts` `pending()` maps **every** queued id, so a `failed` and even a `delivered` delivery stays in
the worker-visible list.

**Original model claims.** c01: "A 400 marks the delivery failed, but a subsequent call to attemptDelivery
attempts it again because the entry point does not check its terminal state. Pending also retains the
delivery." c02 and c03 assert the same mechanism, with the same confidence.

**Counterexample (reproduced, three sequential invocations).**

| Scenario | c01 | c02 | c03 | Requirement |
| --- | --- | --- | --- | --- |
| `400` once, then two more invocations | calls `[1,1,1]`, state `failed`, attempts `1,2,3` | same | same | not retried |
| `410` once, then two more invocations | calls `[1,1,1]`, subscription `disabled`, attempts `1,2,3` | same | same | not retried |
| `pending()` after a terminal `400` | `[dlv-1 failed attempts:1]` | same | same | — |
| `pending()` after a delivery | `[delivered]` | same | same | — |
| disabled subscription, queued delivery, target `200` | **delivered** | same | same | not contacted |

Receipts: `c1_reentry_after_400`, `c3_reentry_after_410`, `c2_reentry_after_410_already_disabled`,
`c2_terminal_pending_includes_failed`, `c2_delivered_pending_includes_delivered` in each
`synthetic/next-family/adjudication/reproductions/c01.json` and the c02/c03 siblings. The derivative `0d85551a83cb` returns `[1,0,0]` for both re-entry
scenarios — the same reproductions falsify the fixed tree, so the counterexample is specific to the
missing guard rather than to the harness.

**Caller boundary.** `attemptDelivery` is the worker entry point the task statement names. The only
queue accessor hands out terminal deliveries. Nothing documents "call this at most once per delivery".
A legitimate caller — including the queue-driven worker the store implies — can produce the second call.

**Existing check coverage.** No suite invokes the worker twice; the evaluator probe invokes it once per
scenario. `checks/RESULTS.md` already lists the uncovered clauses. The receipts therefore neither
establish nor contradict the counterexample — they are simply silent, which is why D3-R2 read the
accusation as unsupported.

**Conclusion.** `CONFIRMED_REQUIRED_VIOLATION` for **C2 and C4 on c01, c02 and c03**, from one shared
root cause. The four required distinctions:

1. **Demonstrated sequential re-entry defect** — yes, reproduced: the entry point contacts the target
   again for a delivery that already failed non-transiently or was failed by a `410`.
2. **Hypothetical production scheduling** — not established and not claimed. The fixture has no
   scheduler; a real worker's re-entry policy is outside the provided material.
3. **Separate concurrent-execution race** — reproduced separately (`concurrent_two_invocations_same_delivery`:
   two parallel calls, two target calls, both recording `attempts:2`, a lost update). It is a **different
   mechanism** requiring an authored concurrency obligation; it is not counted as a criterion violation.
4. **Multiple criterion violations from one root cause** — yes: one defect, two criterion hits. It is
   recorded as `C2 violation + C4 violation from one mechanism`, not as two independent discoveries.

**Accepted action.** Keep the finding. It changes the ground truth for c01 (see §3). Do not implement
generalised concurrency protection; no authored requirement covers it.

**Unresolved uncertainty.** Whether a production queue re-invokes the worker after a terminal failure.
Resolving it needs the scheduler, which is not in the repository or the packet.

---

## 2C. c03 C2 — composite requirement and the missing external policy

The original c03 verdict was `violated`, while its explanation conceded that "the provided material cannot
establish the external policy's classifications or growing delays".

**Independently required clauses of C2.** (a) retried on `5xx`/network error/timeout; (b) not retried for
any other `4xx`; (c) at most three attempts in total; (d) the delay between attempts grows.

| Clause | Status in c03 | Basis |
| --- | --- | --- |
| (a) transient retry | **unverified** | delegated to `policy.classify`, imported from `../../packages/delivery-core/src/retry.ts`, absent from the checkout and the packet |
| (b) other `4xx` final | **demonstrably violated** | re-entry (2B): a delivery failed by a non-transient `4xx` is attempted again by a later invocation |
| (c) three attempts | satisfied in the checkout | `MAX_ATTEMPTS = 3` loop |
| (d) growing delay | **unverified** | delegated to `policy.nextDelayMs` |

So the aggregate `violated` **was justified** by clause (b) even though (a) and (d) remain unknown.

**Conclusion.** The c03.C2 status is `CONFIRMED_REQUIRED_VIOLATION` (via clause (b)). D3-R2's
recommendation that c03.C2 "should be `inconclusive`" is **corrected**: it asked for `inconclusive`
without demonstrating that no mandatory clause was violated, which the re-entry counterexample now
provides.

**Accepted action.** None on the frozen c03. Separately recorded, not merged into the status:

- **Unverified classification rules** — which statuses the installed policy treats as transient.
  Resolution: the package source at `../packages/delivery-core`, or an execution receipt that exercises
  the retry path with the package present.
- **Unverified delay/backoff rules** — whether the delay grows. Same resolution.

**Unresolved uncertainty.** Whether the installed policy conforms to (a) and (d). The recheck derivative
(§8B of the brief) isolates exactly this and is the only place an `inconclusive` status is correct.

---

## 2D. C1 — header casing and empty key

**Frozen requirement.** C1 speaks of "a submission carrying an `Idempotency-Key` header" and "the key".
It does not define header-name normalisation, and `TASK.md` puts **transport concerns out of scope**.

**Interface.** `src/types.ts`:
```ts
export interface Request {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: string;
}
```
A plain string-keyed map. Nothing declares case-insensitive lookup, and no normalisation step exists
between the caller and `handle`.

**Reproduced behaviour.** Recognised only when the map contains the exact key `idempotency-key` with a
non-empty string value.

| Representation | c01 | c02 | c03 |
| --- | --- | --- | --- |
| `idempotency-key: k-1` twice | 1 delivery | 1 delivery (fingerprint) | 1 delivery |
| `Idempotency-Key: k-1` twice | **2 deliveries** | 1 (fingerprint) | **2 deliveries** |
| `IDEMPOTENCY-KEY: k-1` twice | **2 deliveries** | 1 (fingerprint) | **2 deliveries** |
| `idempotency-key: ""` twice | **2 deliveries** | 1 (fingerprint) | **2 deliveries** |
| `idempotency-key: undefined` twice | **2 deliveries** | 1 (fingerprint) | **2 deliveries** |

**Analysis.** HTTP header names are case-insensitive *at the transport layer*, and the task explicitly
excludes transport from the reviewed scope. Whether `handle` may therefore assume an already-normalised
map is not stated anywhere. Likewise, an empty header value is "present" syntactically but the requirement
never says whether it is inside the valid-submission domain; c01/c03 treat it as absent and index nothing.

**Conclusion.** `AMBIGUOUS_REQUIREMENT`. The implementation behaviour is demonstrated and stable; the
acceptance condition is not authored.

**Accepted action.** Keep as an ambiguity, not a confirmed violation. A mandatory verdict requires an owner
decision adding either "header names are matched case-insensitively inside the handler" or "the handler
may assume normalised lowercase names", and either "an empty key is a key" or "an empty key is invalid".
Do **not** invent that acceptance condition here.

**Unresolved uncertainty.** The owner decision above.

---

## 2E. C3 — validation precedence

**Frozen requirement.** C3: "A submission whose payload exceeds 65,536 bytes is answered with `413` … The
size check happens before the subscription is consulted". Order: "1. Body shape: a missing or non-string
`subscriptionId` or `payload` answers `400`. 2. Payload size: more than 65,536 bytes answers `413` (C3).
3. Subscription … 4. Idempotency …".

**Reproduced behaviour** (identical code in all three — `typeof parsed.subscriptionId !== "string" || parsed.subscriptionId === ""`)

| Submission | c01 | c02 | c03 |
| --- | --- | --- | --- |
| `subscriptionId: ""` + 65,537-byte payload | `400` | `400` | `400` |
| `subscriptionId: ""` + 65,536-byte payload | `400` | `400` | `400` |
| missing `subscriptionId` + oversized | `400` | `400` | `400` |
| non-string `subscriptionId` + oversized | `400` | `400` | `400` |
| unknown subscription + oversized | `413` | `413` | `413` |
| disabled subscription + oversized | `413` | `413` | `413` |

**Analysis.** The requirement's step 1 names "missing or non-string". An empty string is a *present
string*, so a strict reading puts `""` past step 1 and lets step 2 decide — under which all three
candidates answer `400` where `413` is required. An equally defensible reading treats `""` as a shape
failure at step 1, which makes the code correct as written. The task never defines the valid-submission
domain for `subscriptionId`, so the requirement, not the code, is under-specified.

**Why equivalent code received different verdicts.** The three intake implementations are byte-identical
on this path; only c02's idempotency block differs. c01.C3 was `violated` while c02.C3 and c03.C3 were
`satisfied`. That is an inconsistency **inside the original assessment**, not a difference between
candidates. Note that the c01 reply states the ambiguity explicitly ("An empty subscriptionId is a present
string under the specified body-shape rule"), which is the strict reading; the same strict reading applied
to c02/c03 would have produced `violated` there too.

**Conclusion.** `AMBIGUOUS_REQUIREMENT` — with the important consequence that the assessment is
internally inconsistent on identical code, and that the *original* c01.C3 verdict is defensible under one
reading of the frozen text.

**Accepted action.** Preserve the ambiguity; do not amend `delivery-req-v2` after observing the assessment.

**Unresolved uncertainty / owner decision.** Is an empty `subscriptionId` a body-shape failure (step 1) or
a valid string that must reach the size check (step 2)? Answering it makes the criterion decidable without
changing any code.

---

## 2F. Observations outside the mandatory contract

Recorded here so they are not silently promoted to completion criteria.

| Observation | Evidence | Class |
| --- | --- | --- |
| A JSON `null` body throws `TypeError: Cannot read properties of null (reading 'subscriptionId')` instead of answering `400` | `null_body` in every reproduction file | `OPTIONAL_REVIEW_OBSERVATION` — the shape rule names missing/non-string *fields*, not a non-object document; no clause requires a `400` for `null` |
| Two concurrent invocations both contact the target and both write `attempts:2` (lost update) | `concurrent_two_invocations_same_delivery` | `OPTIONAL_REVIEW_OBSERVATION` — needs an authored concurrency obligation; the sequential guard does not address it |
| Empty-key normalisation, defensive header handling, extra tests | 2D | `OPTIONAL_REVIEW_OBSERVATION` |
| `pending()` never removes delivered/failed ids | 2B | optional as a queue-hygiene remark; **not** optional as evidence for C2/C4 re-entry, which is already established through the entry point |

---

## 2G. Adjudication matrix

| # | Claim | Class | Evidence | Required next action |
| --- | --- | --- | --- | --- |
| 1 | c02.C1 indexes by payload hash | `CONFIRMED_REQUIRED_VIOLATION` | repro `c1_same_key_different_payload` (2 deliveries), `c1_no_key_identical_payloads` (1 delivery) | keep defect; fix downstream by keying on the header |
| 2 | c01.C2 re-entry after terminal `4xx` | `CONFIRMED_REQUIRED_VIOLATION` | repro `c1_reentry_after_400` calls `[1,1,1]` | correct the c01 ground truth; c01 is not complete |
| 3 | c01.C4 re-entry after `410` | `CONFIRMED_REQUIRED_VIOLATION` (same root cause as #2) | repro `c3_reentry_after_410` calls `[1,1,1]`, subscription disabled | count once as a mechanism, twice as criterion hits |
| 4 | c02.C2 / c02.C4 re-entry | `CONFIRMED_REQUIRED_VIOLATION` | same reproductions | as #2/#3 |
| 5 | c03.C2 / c03.C4 re-entry | `CONFIRMED_REQUIRED_VIOLATION` | same reproductions; derivative `[1,0,0]` falsifies the fixed tree | as #2/#3 |
| 6 | c03.C2 absent external policy | `INSUFFICIENT_EVIDENCE` for clauses (a)/(d) — **does not** make the aggregate `violated` wrong | `src/delivery.ts` `loadRetryPolicy`; `policy-variants.json` (1 vs 3 calls for the same `429`) | request the package source or a retry execution receipt |
| 7 | c01.C1 / c03.C1 header-case and empty key | `AMBIGUOUS_REQUIREMENT`; behaviour demonstrated | repro header matrix | owner decision on normalisation and empty-key validity |
| 8 | c01.C3 empty-string `subscriptionId` ordering | `AMBIGUOUS_REQUIREMENT`; identical code in c01/c02/c03 | repro `c3_empty_string_subscription_oversized` → `400` on all three | owner decision on the valid-input domain; the original verdicts are internally inconsistent |
| 9 | c01.C5, c02.C3, c02.C5, c03.C3, c03.C5 | `SUPPORTED_SATISFACTION` | probe + suite receipts | none |
| 10 | null-body `TypeError` | `OPTIONAL_REVIEW_OBSERVATION` | `null_body` | advisory only |
| 11 | concurrent double-invocation | `OPTIONAL_REVIEW_OBSERVATION` | `concurrent_two_invocations_same_delivery` | advisory only; no requirement authorises the fix |

No claim is classified `UNSUPPORTED_MODEL_CLAIM`. The three ambiguous rows are not "unsupported": the
model's reading is defensible, it is simply not decidable from the frozen text.

---

## 3. Corrected ground truth for the "complete" control

D3-R2 treated c01 as a known-complete control and read four `violated` verdicts on it as evidence of
assessor noise. The adjudication changes that:

| c01 criterion | D3-R2 reading | Adjudicated |
| --- | --- | --- |
| C1 | "conflicts with executed receipts" | **ambiguous** — receipts never exercise a non-lowercase or empty key |
| C2 | unsupported | **confirmed violation** (re-entry after `400`) |
| C3 | unsupported | **ambiguous** — the stated strict reading is defensible |
| C4 | "conflicts with executed receipts" | **confirmed violation** (re-entry after `410`) |
| C5 | supported | supported |

The c01 suite passes 17/17 because it never calls the worker twice. `checks/RESULTS.md` already said the
receipts do not cover re-entry; D3-R2 nevertheless treated the receipts as contradicting the accusation.
A narrower passing test was allowed to stand in for disproof — exactly the error the maintainer warned
about.

Consequences, carried into the final report:

1. The family has **no valid complete control**. `evaluator/ORACLE.json`'s c01 row ("satisfied" on all
   five) is wrong on C2 and C4. The oracle is not proof that a fixture was complete.
2. The original batch's 10 `violated` verdicts are not 10 errors. Seven are confirmed violations, three
   rest on a genuine requirement ambiguity, and none is a fabricated defect.
3. The absence of `inconclusive` in D3-R2 was **not** an inability to abstain: every criterion in that
   batch had either a contradiction or a supported satisfaction. Once the single confirmed contradiction
   is removed (derivative `0d85551a83cb`), the same profile returns `inconclusive` and names the right
   missing evidence — see the recheck section of `runs/D3-R3-REPORT.md`.

## 4. Reproduce

```bash
node --experimental-strip-types synthetic/next-family/adjudication/reproduce.mjs c01 54623dccc8b138c9ad5a41fc0347cf49ba039c61
node --experimental-strip-types synthetic/next-family/adjudication/reproduce.mjs c02 65f210381920fbfce032cf5ba8aaa440f3300162
node --experimental-strip-types synthetic/next-family/adjudication/reproduce.mjs c03 18bbde350074d4afd8a3e3d52be31479c6ba85fc
node --experimental-strip-types synthetic/next-family/adjudication/policy-variants.mjs 0d85551a83cbd87d3664a9de17b9c01990bacaf3
```

Each run materializes the frozen commit into a temporary directory; nothing in `repo/` changes. The
reproductions write only to `synthetic/next-family/adjudication/reproductions/`.

## 5. What this document is not

It is not newly observed autonomous assessor accuracy. It is a human-authored, model-free interpretation
of the same evidence the assessor saw, written after the original results were frozen. It does not
authorise a correction of c02, a change to c03, a requirement amendment, or any production change.
