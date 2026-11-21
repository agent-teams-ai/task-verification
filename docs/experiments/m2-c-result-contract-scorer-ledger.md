# M2-C: Result Contract, Independent Scorer, Run Ledger and Deterministic Controls (WP5–WP6)

**Milestone:** M2-C (WP5–WP6), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented and verified on the consolidated M2 branch.
**Scope note:** This document covers M2-C only. WP7 (adapter/OCR qualification)
and WP8 (integrated readiness) are deferred in this scope. The consolidated
branch also contains WP7/WP8 implementation files; they are not claimed as M2-C
results here.

## 1. ResultContract v1 schema and runtime validation

The `ResultContract` (version `result-contract-v1`) is the minimal experimental
result contract for this experiment. It is not a product-wide SDK schema.

### Sections

- **Subject**: `fixtureTaskId`, `expectedSubjectInventory`
- **Candidate**: `repositoryMaterializationId`, `baseTreeIdentity`,
  `headTreeIdentity`, `runtimeSnapshotDigest`, `opaqueFixtureId`
- **Criteria**: `authoredCriteriaRevision`, `criteriaTextDigest`,
  `expectedCriterionIds`, `criterionToCheckMapping`, `policyVersion`,
  `policyDigest`
- **Profile**: `profileId`, `configurationIdentity`, `promptIdentity`,
  `inputIdentity`, `requestedModel`, `observedModel`,
  `reasoningConfiguration`, `adapterEntryIdentity`
- **Assessments (Profile B)**: `expectedCriterionId`, `present`,
  `originalReportedClaim`, `admittedConclusion`, `references`, `explanation`,
  `diagnostics`
- **Findings (Profile A)**: optional `findingId`, `nativeComment`,
  `normalizedFinding`, `skipped`, `skipReason`, `qualityFlags`,
  `criterionMapping`, optional `references`
- **Coverage**: `expectedIds`, `presentIds`, `individuallyValidIds`,
  `missingIds`, `duplicateIds`, `unknownIds`, `invalidIds`,
  `wholeInventoryAdmitted`
- **Execution**: `state`, `slotId`, `runId`, `attemptId`, `requestId`,
  `sdkEffectCode`, `diagnostics`, `pendingEffects`, `cleanupStatus`, optional
  `supersededBy`
- **Raw artifact**: `available`, `rawText`, `rawBytesDigest`,
  `rawUnavailableCause`
- **Evidence**: `producer`, `candidateBinding`, `checkDefinition`,
  `inputScope`, `environment`, `observationOutcome`, `completeness`,
  `timestamps`, `references`, `applicability`, `provenance`
- **Usage**: `inputTokens`, `outputTokens`, `totalTokens`, `durationMs`,
  `cost`, `currency`, `requestedModel`, `observedModel`,
  `capacityObservations`
- **Capacity**: `durableFactCapacity`, `retentionPolicy`

### Runtime validation

`validateResultContract(input: unknown): string[]` is defensive and never
throws on malformed nested input. It returns structured errors for:

- contract ID and `result-contract-v1` version
- subject identity and expected subject inventory (duplicates rejected)
- candidate repository/materialization identity and hex digest formats
- criteria revision, text digest, exact criterion inventory (duplicates
  rejected), criterion-to-check mapping and policy identity
- profile/configuration/prompt/input identities and unknown model fields
- assessment record shape, admitted-conclusion enum, original claim
  preservation, reference arrays and diagnostics
- finding record shape, skipped reason (required when skipped), criterion
  mapping and optional references
- coverage arrays and cross-field consistency
- execution state/cleanup enums, identity fields and optional supersession
- raw artifact availability/digest/cause consistency
- evidence metadata, ISO timestamps and applicability enum
- usage finite non-negative values or null
- capacity values and explicit unknowns

Coverage is recomputed from the actual assessment IDs and compared with the
stored record:

- `missingIds`: expected IDs absent from the assessments
- `duplicateIds`: valid IDs appearing more than once
- `unknownIds`: valid IDs outside the expected inventory
- `invalidIds`: present values that are not non-empty strings
- `individuallyValidIds`: expected, non-duplicate, valid IDs
- `wholeInventoryAdmitted`: requires exact multiset equality, no missing,
  duplicate, unknown or invalid IDs

A stored coverage record that disagrees with the recomputation is rejected.

## 2. Profile A vs Profile B semantics

### Profile B (assessments)

- Carries an explicit `admittedConclusion` (`satisfied`, `violated`,
  `inconclusive`) and the original `originalReportedClaim`.
- Label agreement is joined with Truth post-hoc and only when execution is
  admissible and the Truth binding is valid.
- Mechanical reference validity and semantic support are separate dimensions.
- Coverage is computed from assessment IDs.
- The original claim is never overwritten.
- A complete inventory that is ≥80% inconclusive is flagged.

### Profile A (findings)

- Delivers `FindingRecord` entries with native comments, normalized findings,
  quality flags and a predeclared `criterionMapping`.
- Distinguishes mapped, unmapped and out-of-scope findings.
- Unmapped findings remain visible and are not automatically false allegations.
- A delivered finding mapped to a truth-satisfied criterion is a false
  allegation.
- A supported finding mapped to a truth-violated criterion is a supported
  detection.
- Skipped findings are preserved with their reason and are not counted as
  delivered.
- A raw native finding dropped by normalization is preserved as a normalization
  loss and is not delivered.
- Duplicate/conflicting criterion mappings remain visible and are flagged.
- Profile A silence means no finding, not an inconclusive B-style assessment.
- `satisfaction` and `criterionCoverage` are reported as `not-applicable`.

## 3. Original claim vs admitted conclusion

- `originalReportedClaim`: the raw claim exactly as reported; never normalized
  or overwritten.
- `admittedConclusion`: the admitted semantic verdict after execution
  admissibility and Truth joining.
- For failed, unknown, cancelled or superseded execution, the scorer withholds
  an admitted semantic verdict (`admittedConclusion: null`,
  `agrees: null`, `admitted: false`) and preserves the parseable original claim
  in the reported-claim accounting.
- Execution failure is distinguished from semantic disagreement: a failed
  execution is never scored as "incorrect".

## 4. Truth binding and the post-hoc scoring boundary

Truth is joined only after the reviewer output is frozen and recorded. Truth
and the anonymization mapping never enter the reviewer materialization, the
Profile B serialized input or the deterministic baseline.

`validateTruthBinding(resultContract, truthBinding)` verifies:

- canonical candidate identity equals the result contract candidate
- approved anonymized identity equals the result contract opaque fixture ID
- head application digest equals the result contract runtime snapshot digest
- criteria revision equals the result contract authored revision
- expected criterion inventory is an array with no duplicates and exactly the
  frozen criterion set
- truth outcomes contain exactly the expected criterion IDs, with boolean values
- truth version and digest are present

An invalid binding produces structured `truthBindingErrors` and suspends label
agreement; it does not produce a misleading verdict. `strictTruthBinding: true`
makes the scorer throw instead.

## 5. Mechanical reference validation vs semantic-support review

### Mechanical reference validation

Resolved from the immutable artifact registry, never from caller-provided
`referenceExists`/`tiedToCandidate` booleans:

- the reference exists in the registry
- the artifact's candidate binding equals the result contract candidate
- the artifact's snapshot digest equals the result contract runtime snapshot
- the source is allowed, current and applicable under the declared policy

### Semantic-support rubric

The frozen human-review rubric decides:

- whether the source supports the asserted behavior
- whether every required subclause is covered
- whether the reference is relevant and current/applicable
- whether it contradicts the claim

Rubric reviews retain `rubricVersion`, decision, rationale, reviewer,
blinding flag and review timestamp. No second LLM grader is added.

## 6. Scorer and rubric versions

- **Scorer version**: `scorer-v2`
- **Rubric version**: `rubric-v1`

`scorer-v2` records the corrected execution-state semantics, the
mechanical/semantic split and the structured Profile A output. The rubric
principles are unchanged; only its provenance fields were added.

## 7. Findings mapping, unmapped findings and skipped findings

- **Mapped**: `criterionMapping` names a frozen criterion. Truth comparison is
  performed; a truth-satisfied mapping is a false allegation and a
  truth-violated mapping with a mechanically valid, semantically supporting
  reference is a supported detection.
- **Unmapped**: `criterionMapping` is null. The finding remains visible with
  neutral support and no truth comparison.
- **Out-of-scope**: `criterionMapping` names a criterion outside the frozen
  inventory. The finding remains visible and neutral.
- **Skipped**: `skipped: true` with a non-empty `skipReason`. Not counted as
  delivered; reason and diagnostic are preserved.
- **Normalization loss**: `normalizedFinding` is null for a non-empty native
  comment. Recorded as a normalization loss, not delivered.
- **Duplicate/conflicting mappings**: more than one delivered finding mapping
  to the same criterion is flagged; no favourable entry is selected.

The finding-to-criterion mapping is predeclared per finding before trials. The
M1 plan requires the mapping to be fixed in advance; it does not provide a
shared filename-based table.

## 8. Run ledger event schema and lifecycle

The run ledger (`runs.jsonl`) is an append-only JSONL event log with schema
version `ledger-event-v1`.

### Event types

`planned`, `attempt_started`, `attempt_completed`, `attempt_failed`,
`attempt_unknown`, `cancelled`, `superseded`, `criteria_removed`.

### Lifecycle

- `planned` at most once per attempt.
- `attempt_started` at most once per attempt.
- Exactly one terminal event, which requires a real prior `attempt_started`.
- No event may follow a terminal event.
- `criteria_removed` is a criteria-history tombstone, not an attempt lifecycle
  event.

### Append guarantees

- Duplicate `eventId` is rejected before append.
- Duplicate `planned` or `attempt_started` for the same `runId`/`attemptId` is
  rejected before append.
- A started event is persisted before dispatch; a process that dies before a
  terminal event leaves a visible incomplete attempt.
- `appendLedgerRecord()` assigns a strictly increasing `sequence`; event
  identity is the `eventId` and is never overwritten.
- Malformed/truncated JSONL is reported with the exact line number.

### Integrity checks

`verifyLedgerIntegrity()` verifies:

- record schema validity (required fields, enums, hex digests, ISO timestamps)
- unique event IDs
- attempt identity uniqueness rules
- monotonic sequence ordering
- valid per-attempt lifecycle transitions
- criteria revision tombstone uniqueness and lineage
- no resurrection of a tombstoned criteria revision
- `supersedes`/`supersededBy` referential integrity
- no supersede cycles
- no resurrection of cancelled/superseded attempts
- correct stub/live distinction (a stub may not claim a model)
- no resurrection of cancelled/superseded attempts

## 9. Unique event and attempt identities

- `eventId` is a UUID v4-format string, unique per event.
- `runId` and `attemptId` are stable attempt identifiers.
- `sequence` is a strictly increasing append-order integer.
- `slotId` identifies the execution slot.
- Duplicate event IDs and duplicate attempt starts are rejected at append time
  and by integrity replay.

## 10. Single-writer and multi-writer guarantees

- Pilot concurrency is one, per the approved plan.
- The ledger implements an **in-process single-writer** contract via
  `acquireWriter`/`releaseWriter`/`withWriter`.
- Cross-process concurrency is **not** supported. Callers in multi-process
  environments must serialize access externally. `appendFileSync` is not a
  write lock, and this implementation does not claim one.
- The limitation is explicit in the module documentation and tests.

## 11. Criteria revision lineage

- `createCriteriaRevision(text, parent)` derives
  `revisionId = crit-sha256(textDigest + parent).slice(0, 8)`.
- Identical text with a different parent yields a different revision ID.
- `createCriteriaTombstone()` records a removal event with a stable
  `lineageId` and a unique `eventId`.
- `createRevisionAfterTombstone(text, tombstone)` derives the replacement
  revision from the tombstone lineage, so identical bytes cannot resurrect the
  removed revision identity.

## 12. CT-1–CT-3 before/after identities and decisions

All three controls call the same `consumerAdmit()` used by the scorer's
result-admission path. The record is persisted to
`.isolation-tmp/control-admission-results.json` by the WP6 suite.

### CT-1 — criteria revision freshness

| Side | Assessment | Criteria revision | Snapshot | Admitted | Decision |
| --- | --- | --- | --- | --- | --- |
| before | `ct1-old` | `crit-663a5c87` | `snap-1` | true | false — `criteria revision mismatch` |
| after | `ct1-v2-stub` | `crit-6bfdabbd` | `snap-1` | true | true — `admitted` |

The delayed v1 assessment remains historical and cannot become current for v2.
Only the v2 stub with complete coverage is admitted.

### CT-2 — candidate/snapshot binding

| Side | Assessment | Criteria revision | Snapshot | Admitted | Decision |
| --- | --- | --- | --- | --- | --- |
| before | `ct2-stale` | `crit-v1` | `33ca2166…aed661` | true | false — `snapshot mismatch` |
| after | `ct2-current` | `crit-v1` | `2ffaacd1…7285f24` | true | true — `admitted` |

Evidence bound to a different candidate snapshot is stale/inapplicable and
cannot satisfy the current criterion.

### CT-3 — removal and re-addition

| Side | Assessment | Criteria revision | Snapshot | Admitted | Decision |
| --- | --- | --- | --- | --- | --- |
| before | `ct3-cancelled` | `crit-5c1f7699` | `snap` | true | false — `criteria revision mismatch` (also `lifecycleValid=false`) |
| after | `ct3-v3-stub` | `crit-04f984f4` | `snap` | true | true — `admitted` |

The old v1 assessment is bound to the removed revision and is cancelled; it
cannot become current for v3. The tombstone event is appended to the ledger and
passes integrity replay. Only the v3 stub with complete coverage is admitted.

## 13. Test results and known limitations

- **242 tests pass, 0 fail, 0 skipped** on the consolidated branch.
- WP5: execution-state semantics, Profile A finding scoring, Truth binding,
  mechanical/semantic separation and the malformed-input matrix.
- WP6: ledger append/read, duplicate rejection, integrity/lineage,
  malformed JSONL, single-writer behaviour and CT-1/CT-2/CT-3 admission.
- Typecheck and declaration build pass.
- CI: Ubuntu 24.04 and Windows 2022.

Known limitations:

- The ledger is single-writer within one process; cross-process locking is not
  implemented.
- `strictTruthBinding` is opt-in; by default an invalid binding is reported as
  structured errors and suspends label agreement.
- Profile A relies on a predeclared per-finding criterion mapping; no automatic
  filename-based mapping is inferred.
- The fixture's universal AC-4 wording remains bounded by the declared input
  policy; finite examples do not prove it for every possible input.

## 14. Zero live calls and deferred WP7/WP8 work

- No live model/API/OCR/Gateway calls were made.
- WP7 (SDK/OCR fake-provider qualification) is deferred in this M2-C scope.
- WP8 (integrated readiness) is deferred in this M2-C scope.
- No package publication or deployment.
- No credentials or provider setup.

---
*Keep claims aligned with the actual tests and implementation.*