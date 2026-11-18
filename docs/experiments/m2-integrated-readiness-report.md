# M2 Integrated Readiness Report (WP0–WP8)

Scope: **model-free**. No live model, inference API, external OCR provider or Gateway call was made.
No credential was used, nothing was spent, published or deployed. Live model evaluation remains
unauthorized (D1/D2).

## 1. Implementation identities

- **M2-A** — foundation, fixture, behavioural oracle (WP0–WP2): 4 candidates (C1–C4), 5 acceptance
  criteria (AC-1..AC-5), 83 tests.
- **M2-B** — Truth-v1, evidence packets, deterministic baseline (WP3–WP4): 51 tests.
- **M2-C** — ResultContract v1, independent scorer, run ledger, deterministic controls (WP5–WP6):
  29 tests (16 WP5 + 13 WP6).

These historical counts are unchanged.

## 2. Authoritative candidate snapshots (WP8 binding)

WP8 no longer builds a synthetic repository, copies candidate sources under `src/`, replaces
`src/app.ts` with a stub, or generates its own diff. Both Profile A and Profile B now consume the
official materialization:

| Candidate | Base | Base tree | Head | Head tree | Head application digest |
| --- | --- | --- | --- | --- | --- |
| S1-C1 | B0 `36eb1135d275…` | `e5960036ffe8…` | H1 `0d9786c0ef3c…` | `3f21da18d0eb…` | `327d0a9690ff70ed…` |
| S1-C2 | B0 `36eb1135d275…` | `e5960036ffe8…` | H2 `3b3ad3880497…` | `f7a8b91f9688…` | `229cd951be05…` |
| S1-C3 | B0 `36eb1135d275…` | `e5960036ffe8…` | H3 `1fda97c2cca6…` | `313c3e4a…` | `4fb700863d2a…` |
| S1-C4 | B1 `d27a2d92d427…` | `9d609f60…` | H4 `e3bed690778b…` | `17288abd…` | `e3700e622872…` |

- Identities are rebuilt from the authoritative file maps with the recorded deterministic Git
  recipe and then verified three ways: against the in-memory maps, against
  `candidates/provenance.json`, and by re-deriving commit/tree/digest/diff **from the repository
  bytes** (`git rev-parse`, `git ls-tree`, `git show`, `git diff`).
- A repository whose head commit is not the official head commit is rejected; a synthetic identity
  is never reported as a candidate identity.
- The reviewer input carries the official base tree, head tree and the exact official
  base-to-head diff; the diff paths are the official root-relative `app.ts`.
- The same Base/Head/Diff identity is passed through materialization → rendered OCR input → binary
  execution → native manifest → ResultContract → persisted readiness artifact, and re-verified after
  readback.

## 3. Profile A — all four candidates on the exact rr.7 binary

Per candidate: authoritative materialization → rendered reviewer input (≤ 8,000 characters, complete
task and all five criteria) → exact `ocr-v1.13.1-rr.7` binary → captured request at the fake provider
→ native output and manifest (with `resolved_base`/`resolved_head` equal to the official commits) →
pinned parser → pinned normalizer → native/normalized/skipped/dropped findings kept separately →
Profile A ResultContract (`assessments: []`, `satisfaction: not-applicable`) → Truth file SHA-256
(not a packet id) → byte-verified ArtifactRegistry → Profile A scoring → ledger lifecycle → Profile A
admission → persisted readiness artifact → readback with digest and identity verification.

**Fixed injected protocol responses.** The provider replies are fixed injected content used to
qualify the adapter, parser, normalizer, registry and admission path. They do not measure reviewer
reasoning or model quality. Each persisted artifact records
`providerMode: "fixed-injected-protocol-response"` and `modelQualityMeasured: false`.

## 4. Profile B — all four candidates through the exact packed SDK

For every candidate: authoritative snapshot → approved materialization and assembled Profile B input
→ the installed `@agent-teams/account-gateway@0.1.0` tarball → real `createLlmClient()` on the
`/llm` entry → loopback fake Responses provider → captured request/response → ResultContract
validation → original `ReportedClaimAccounting` → mechanical reference resolution against the
byte-verified registry → evidence sufficiency → persisted ledger lifecycle → shared consumer
admission → readiness artifact persisted, read back and digest-verified.

All four candidates: 1 dispatch, 1 persisted request identity before dispatch, `cleanup=closed`,
`receipt.requestSha256` equal to the bytes the provider received, 3 ledger events, admission
`admitted`.

## 5. Reference qualification and consumer admission

The empty `{ artifacts: {} }` registry is gone. A real registry is built from the authoritative head
snapshot bytes:

- every allowlisted application file is registered with a digest **recomputed from its bytes**;
- every entry is re-verified against the bytes and against the expected candidate and snapshot;
- entries are accepted only when the path is allowlisted, the digest matches, the entry is bound to
  the current candidate and snapshot, and it is an allowed, current, applicable source.

Positive controls: valid current C3 reference (AC-3, `app.ts`) and valid current C4 reference
(AC-4, `serializer.ts`) — both admitted, both supported detections.

Negative controls, all rejected with an explicit reason: wrong candidate, wrong snapshot, missing
reference, incorrect digest, stale (`current: false`), inapplicable (`applicable: false`), path
outside the allowlist, partial/contradictory semantic support, unsupported finding, unmapped
finding, out-of-scope finding, skipped finding.

A finding is **never** counted as a supported detection merely because Truth says the criterion is
violated. C1/C2/C4 map admissible-looking findings onto truth-satisfied criteria and produce **zero**
supported detections (they are false allegations); only C3's AC-3 finding, which clears mechanical
resolution, digest verification, binding, applicability and semantic support, is a supported
detection.

For Profile A no criterion verdict is fabricated: `admittedCriterionIds` is always empty. Admission
is represented as (a) review-execution admission and (b) per-finding admission, both derived from the
real scorer output and the verified registry. The persisted `AdmissionDecision` reads back unchanged.

## 6. Test totals (separate suites, not summed)

| # | Suite | Command | Platform | Result |
| --- | --- | --- | --- | --- |
| 1 | Main regression suite | `node --experimental-strip-types --test --test-concurrency=1 tests/*.ts` | win32/x64, Node 24.13.1 | **359 / 359 pass**, 0 fail, 0 skip |
| 2 | rr.7 WP7 suite | `OCR_RR7_DIR=/rr7 node --experimental-transform-types --test tests/rr7/wp7-rr7.test.ts` | Ubuntu 24.04 container, Node 24.13.1 | **16 / 16 pass** |
| 3 | WP8-A integrated Profile A | `OCR_RR7_DIR=/rr7 … tests/rr7/wp8-profile-a.test.ts` | Ubuntu 24.04 container, Node 24.13.1 | **6 / 6 pass** (C1–C4, 2 identity negatives, native unchanged-dependency read, out-of-scope refusal) |
| 4 | SDK qualification | `SDK_PROJECT_DIR=<isolated> node scripts/qualify-sdk.mjs` | win32/x64, Node 24.21.0 | **20 / 20 pass** |
| 5 | WP8-B integrated Profile B | `SDK_PROJECT_DIR=<isolated> node --experimental-strip-types scripts/qualify-profile-b.mjs` | win32/x64, Node 24.21.0 | **4 / 4 candidates admitted** |

Historical records preserved: main suite was 242/242, then 259/259; rr.7 suites were 18/18 (16 WP7 +
2 WP8-A), then 20/20 (16 + 4). The main suite is now 284/284: +17 for the authoritative snapshot,
registry and admission controls, and +25 from `tests/wp8-corrective.ts` (the M2 corrective pass), and the WP8-A suite is 6/6 after two native-scope tests were added. The suites above are counted
independently and are never summed.

### Targeted corrective pass (2026-11-18)

Four counterexamples from the maintainer review at `268d4ba` are fixed. The main suite grew from 299
to 359 (+22 exact reproductions in `tests/m2-corrective-repro.ts`, +27 gate-matrix cases in
`tests/m2-gate-matrix.ts`, +11 transcript negative controls in `tests/native-tool-transcript.ts`);
the rr.7 suites remain 22/22 (16 WP7 + 6 WP8-A). Details:

| Defect | Root cause | Correction | Regression |
| --- | --- | --- | --- |
| Profile A finding identity transfer | Admission joined raw findings to scored records through a `findingId`-keyed map (last write wins); the compatibility `referenceRubrics` path also ignored a foreign `findingId` | Findings carry an internal occurrence identity derived from run/attempt/candidate/snapshot/input identity plus native position; the join is one-to-one; decisions bound only to a colliding display id are refused as ambiguous; `referenceRubrics` applies the same identity restriction | `repro A1`–`A7b` |
| Profile B duplicate lost before admission | The decoder kept a duplicate only in `rawRecords`/diagnostics and dropped it from `assessments`, so coverage recomputed without it and the first claim was admitted | Every occurrence stays in `assessments` with an explicit conflict group and a classified kind (identical / conflicting / unclassified); the identity flows through contract coverage into per-claim and aggregate admission; no occurrence is admitted | `repro B1`, `repro B1x` (exact maintainer shape), `B2`–`B6` |
| Mandatory gates diverged | The aggregate used the contract's own revision label; Profile A omitted schema validity; contradictory evidence had no individual conflict state | One gate policy (`src/admission-gates.ts`) evaluates the same gate ids for per-finding, per-claim and aggregate decisions, with structured pass/fail, source and reason; aggregate admission is additionally gated on every claim being admitted | `repro C1`–`C5`, `gate matrix A/B` (14 gates, positive control, isolated failure, two simultaneous failures) |
| Transcript overstated observation | `contentReturned`, delivery and the content digest were derived from `scope.snapshot.headFiles[requested]`, so a call without a result still reported delivery | Content, bytes and digests come only from a matched observed tool output; delivery requires call → matching result by call identity → a captured request carrying both; expected snapshot content is reported separately; missing output is `unverified` | `tests/native-tool-transcript.ts` (10 negatives + positive) |

The additional gate clarifications are covered: a stale revision no longer yields an admitted finding or a
supported detection, and supporting-plus-contradicting evidence now rejects the individual claim with an
explicit conflict, matching the aggregate.

**Exact Profile B reproduction (maintainer input).** `repro B1x` uses the six records the maintainer
actually supplied: five ordinary expected assessments, one for each of AC-1…AC-5, then a sixth AC-3
record that contradicts the first AC-3 claim. It runs the real decoder → ResultContract → scorer
composition and asserts, in order:

| Criterion | Occurrence | Reported | References | Consumer admitted | Conflict |
| --- | --- | --- | --- | --- | --- |
| AC-1 | 1 (ordinary) | satisfied | `app.ts` | **true** | none |
| AC-2 | 2 (ordinary) | violated | `app.ts` | **true** | none |
| AC-3 | 3 (ordinary) | violated | `app.ts` | **false** | `conflicting-duplicate`, group `cc-…` |
| AC-4 | 4 (ordinary) | satisfied | `app.ts` | **true** | none |
| AC-5 | 5 (ordinary) | satisfied | `app.ts` | **true** | none |
| AC-3 | 6 (sixth) | satisfied | `serializer.ts` | **false** | same group as occurrence 3 |

The assertions are: six raw records and six occurrences retained; six per-claim decisions and six
reported-claim accounting entries; `AC-3` in both `decoded.duplicateIds` and
`coverage.duplicateIds`, with `wholeInventoryAdmitted=false`; one shared conflict group; both AC-3
occurrences rejected with `consumerAdmitted=false` and their original wording, references and
diagnostics intact; AC-1, AC-2, AC-4 and AC-5 individually `consumerAdmitted=true`; and the aggregate
rejected. The aggregate rejection is the coverage gate ("incomplete coverage", `duplicate IDs: AC-3` in
the aggregate diagnostics, primary failure `coverage-completeness`) plus the `claim-admission`
consistency gate — **it does not invalidate the four independent claim decisions**. The earlier
"all six refused" summary was inaccurate and is corrected here: six occurrences are preserved, the two
AC-3 conflicting occurrences are rejected, four unrelated valid criterion claims are admitted
individually, and the aggregate result is rejected.

### PR #349 development case (planning deliverable)

The pre-fix requirement source (`review-router-ai@6797745`), the immutable pre-fix candidate
(`review-router@056952b5`, adapter blob `5c0ed26…`) and the fix (`f87abf4`) are carded in amendment
v02. A model-free fake-provider probe against the pinned rr.7 binary shows the pre-fix `content` rule
key delivers neither the rule text nor the appended memory to the captured provider request, while the
post-fix `rule` key delivers both. This is development evidence only; no live comparison is
recommended.

### Corrective pass (2026-11-17)

The six maintainer-reproduced defects and two clarifications are fixed with regression coverage; see
`docs/experiments/m2-corrective-pass-report.md` for the root-cause-to-test mapping. Nothing in this
section changes the frozen Truth semantics: `truth/truth-v1.json` outcomes are untouched, and the C4
binding digest was updated only because the candidate's source comment changed during sanitation.

### Runtimes

| Purpose | Node | pnpm |
| --- | --- | --- |
| M2-A base test runtime (unchanged) | 24.13.1 | 9.15.0 |
| rr.7 qualification runtime | 24.13.1 | 9.15.0 |
| SDK qualification runtime | 24.21.0 | 11.28.2 |

The M2-A pin was not changed to satisfy the SDK engine range.

## 7. Provenance pins

| Artifact | Identity |
| --- | --- |
| Gateway SDK source | `agent-teams-ai/account-gateway@539418d5935a9e336d480b128a1cdb93c1daa6e1` (tree `608b577e2da6…`) |
| Gateway SDK tarball | 54,221 bytes, SHA-256 `dfa8fad3…9f00`, integrity `sha512-4KRoem4e…EtA==` (reproduced byte for byte) |
| Active OCR pin | `ocr-v1.13.1-rr.7`, 80,513,021 bytes, SHA-256 `2f290fb4…4aaa29` |
| Historical OCR pin | `ocr-v1.13.1-rr.6`, 80,513,363 bytes, SHA-256 `9dd5f115…d101ee5c` (preserved) |
| Parser/normalizer | `777genius/review-router@7a079c382d8e98b426ee90a6b3764be2a21b4c49` (blobs `5ba2ba5d…`, `43bcfa54…`, unchanged) |

Manifests: `docs/experiments/m2-sdk-qualification.manifest.json`,
`docs/experiments/m2-rr7-artifact.manifest.json`.

## 8. Status

| Item | Status |
| --- | --- |
| WP7 SDK qualification (fresh reproduction, supported runtime) | **COMPLETE** |
| WP7 rr.7 release + M2 qualification | **COMPLETE** for the defined over-claim-safe case set |
| WP8-A Profile A (C1–C4, authoritative snapshots, real references, real admission) | **COMPLETE** (corrected) |
| WP8-B Profile B (C1–C4, exact packed SDK, complete provider-bound input) | **COMPLETE** (corrected) |
| M2 corrective pass (6 defects + 2 clarifications) | **COMPLETE** — see `m2-corrective-pass-report.md` |
| M2 final audit (per-claim admission, Profile A finding isolation) | **COMPLETE** — see §9 |
| M2 targeted corrective pass (4 maintainer counterexamples) | **COMPLETE** — see §6 and `tests/m2-corrective-repro.ts` |
| Experiment amendment v02 (one development case card, PR #349) | **PROPOSED** — planning only; case classified `DEVELOPMENT EXAMPLE — NOT HELD-OUT MODEL-QUALITY EVIDENCE`; D1/D2 remain pending |
| Live model evaluation | **NOT STARTED** (unauthorized) |
| D1 live inference authorization | **PENDING** |
| D2 live evaluation budget | **PENDING** |

## 9. Claim-level admission and finding isolation (final audit)

### 9.1 Profile B: `admitted` is not consumer admission

The per-claim fields in `src/scorer.ts` are deliberately separate dimensions. The original reported
claim and its diagnostics survive every rejection; no dimension implies another.

| Dimension | Field | Meaning |
| --- | --- | --- |
| Original claim | `originalReportedClaim`, `parsedClaim` | Provider wording and its parsed polarity, retained even when rejected |
| Contract/schema validity | `contractValid` (`ScorerResult.contractValid`) | The result contract satisfies its schema |
| Execution admissibility | `executionAdmissible` | Execution state permits a semantic conclusion |
| Evidence applicability | `evidenceApplicable` | Producer evidence is applicable |
| Criteria revision | `criteriaRevisionBound` | The authored label matches the consumer's |
| Criteria content | `criteriaContentBound` | Content digest matches, independently of the label |
| Candidate / snapshot | `candidateBound`, `snapshotBound` | Every cited artifact names this candidate and snapshot |
| Evidence resolution | `referenceValid`, `referenceSufficient` | Artifacts resolve, and at least one semantically supports the claim |
| Claim association | `claimAssociationValid` | Criterion is in the inventory and claimed exactly once |
| Semantic conclusion | `semanticConclusionAdmitted` | An admissible conclusion exists (execution + conclusion) |
| **Consumer admission** | `consumerAdmitted` | **Every** mandatory gate above |

`LabelAgreement` and `ReportedClaimAccountingEntry` previously exposed a field named `admitted` that
meant only "an admissible semantic conclusion exists". That field is renamed
`semanticConclusionAdmitted`, and each carries `consumerAdmitted` plus
`consumerAdmissionReason`. A claim can therefore no longer be read as admitted while failing an
evidence, criteria-content or candidate-binding gate. `ScorerResult.claimAdmissions` is the
per-claim table; `ScorerResult.admission` remains the result-level decision and is unchanged in
meaning.

Profile B qualification records these per claim in `claims.json` per candidate and in `readiness.json`
(`claims.total`, `claims.consumerAdmitted`, `claims.rejected`, `claims.entries`), with the independent
consumer-side criteria revision and content digest supplied to the scorer rather than the contract's
own self-matching copies.

### 9.2 Profile A: same-criterion, same-reference isolation

Support is keyed `criterionId::reference`, optionally narrowed to a finding identity
(`claimSupportKey(criterionId, reference, findingId)`). Two findings with different IDs that share a
mapped criterion **and** an evidence reference are now handled explicitly:

- A finding-scoped decision (`RubricDecision.findingId`) supports only its own finding.
- When a pair is claimed by more than one finding and no finding-scoped decision exists, support is
  **refused** with an `ambiguous` reason; the finding records `supportAmbiguous` and is diagnosed.
- A criterion claimed by more than one delivered finding is `duplicateMapping`; admission refuses it
  for **every** such finding rather than attributing one finding's judgment to another.
- Both findings, their native comments, their diagnostics and the scorer's `delivered`/`skipped`
  counts are preserved; `supportedDetections` stays empty for an ambiguous pair.

The real rr.7 runs are unaffected: no candidate produces duplicate criterion mappings, so WP8-A
remains 6/6 and WP7 16/16 with the new gates active.

### 9.3 Audit regressions

`tests/m2-final-audit.ts` (15 tests) covers the nine Profile B negative scenarios (no reference,
missing artifact, invalid digest, wrong candidate, wrong snapshot, stale criteria content,
inapplicable evidence, unsupported/contradictory support, duplicate criterion association) and five
Profile A cases (cross-finding non-transfer, explicit duplicate accounting, stale criteria, wrong
candidate/snapshot, preservation of rejected findings). Each asserts the original claim is retained,
diagnostics are retained, accounting is accurate, evidence/support state is accurate and consumer
admission is false. Truth outcomes were not changed.

## 10. Known limitations

- Fake providers and fixed injected replies only; no model-quality claim is made.
- Production Gateway recovery, provider rate limits, billing behaviour and capacity are not tested.
- The rr.7 binary is Linux/amd64 only; its suites run on Ubuntu 24.04. Windows exercises the shared
  substrate, registry and admission logic, not the OCR binary.
- The `--network none` container plus an allowlisted child environment is the recorded network
  boundary; the binary's own egress is traced, but this is not an OS-level sandbox claim.

## 11. Zero live calls

- No live model/API/OCR/Gateway call.
- No credential loaded; the qualification refuses to run if a provider credential is present.
- No package publication, no deployment, no spending.
