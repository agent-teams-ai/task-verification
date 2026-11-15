# M2-C: Result Contract, Independent Scorer, Run Ledger and Deterministic Controls (WP5-WP6)

## Documentation

This document describes the M2-C (WP5-WP6) implementation for the Task Verification experiment.

## 1. ResultContract v1 Schema and Runtime Validation

The `ResultContract` (version `result-contract-v1`) represents the minimal experimental result contract for the Task Verification experiment. It is not a product-wide SDK schema.

### Schema

The contract consists of the following sections:

- **Subject**: `fixtureTaskId` and `expectedSubjectInventory`
- **Candidate**: `repositoryMaterializationId`, `baseTreeIdentity`, `headTreeIdentity`, `runtimeSnapshotDigest`, `opaqueFixtureId`
- **Criteria**: `authoredCriteriaRevision`, `criteriaTextDigest`, `expectedCriterionIds`, `criterionToCheckMapping`, `policyVersion`, `policyDigest`
- **Profile**: `profileId`, `configurationIdentity`, `promptIdentity`, `inputIdentity`, `requestedModel`, `observedModel`, `reasoningConfiguration`, `adapterEntryIdentity`
- **Assessments (Profile B)**: Array of `AssessmentRecord` with `expectedCriterionId`, `present`, `originalReportedClaim`, `admittedConclusion`, `references`, `explanation`, `diagnostics`
- **Findings (Profile A)**: Array of `FindingRecord` with `nativeComment`, `normalizedFinding`, `skipped`, `skipReason`, `qualityFlags`, `criterionMapping`
- **Coverage**: `expectedIds`, `presentIds`, `individuallyValidIds`, `missingIds`, `duplicateIds`, `unknownIds`, `invalidIds`, `wholeInventoryAdmitted`
- **Execution**: `state`, `slotId`, `runId`, `attemptId`, `requestId`, `sdkEffectCode`, `diagnostics`, `pendingEffects`, `cleanupStatus`
- **Raw Artifact**: `available`, `rawText`, `rawBytesDigest`, `rawUnavailableCause`
- **Evidence**: `producer`, `candidateBinding`, `checkDefinition`, `inputScope`, `environment`, `observationOutcome`, `completeness`, `timestamps`, `references`, `applicability`, `provenance`
- **Usage**: `inputTokens`, `outputTokens`, `totalTokens`, `durationMs`, `cost`, `currency`, `requestedModel`, `observedModel`, `capacityObservations`
- **Capacity**: `durableFactCapacity`, `retentionPolicy`

### Runtime Validation

`validateResultContract()` enforces schema compliance including:
- Structural validity (required fields present, arrays are arrays, enums have valid values)
- Cross-field consistency (e.g., `wholeInventoryAdmitted` agrees with recomputed result)
- Coverage recomputed from actual assessment IDs
- Usage fields: finite non-negative values or null
- Capacity values and explicit unknowns

## 2. Profile A vs Profile B Semantics

### Profile B (Assessments)

- Contains explicit `admittedConclusion`: `satisfied`, `violated`, or `inconclusive`
- Label agreement joined with Truth post-hoc
- Reference validity and semantic support evaluated separately
- Coverage computed from assessment IDs
- Original `originalReportedClaim` preserved, never overwritten
- ≥80% inconclusive flagging

### Profile A (Findings)

- Contains `FindingRecord` entries with native comments and normalized findings
- Distinguishes mapped, unmapped, and out-of-scope findings
- Unmapped findings remain visible, not treated as false allegations
- A finding mapped to a truth-satisfied criterion counts as a false allegation
- A supported finding mapped to a truth-violated criterion may count as supported detection
- Skipped findings preserved with reason, not counted as delivered
- Profile A silence = no finding, not an inconclusive B-style assessment
- Profile A satisfaction and criterion coverage marked not applicable

## 3. Original Claim vs Admitted Conclusion

- `originalReportedClaim`: The raw claim as originally reported, never overwritten or normalized
- `admittedConclusion`: The scored verdict (satisfied/violated/inconclusive) after Truth joining
- For failed/unknown execution: verdict suspended (null), claim preserved for reported-claim accounting
- Label agreement computed only when execution is valid and Truth binding is valid

## 4. Truth Binding and Post-Hoc Scoring Boundary

- Truth is joined **after** reviewer output is frozen and recorded
- `ScorerInput.truthCandidateId` must match `ResultContract.candidate.repositoryMaterializationId`
- Truth snapshot digest must match result contract candidate runtime snapshot digest
- Truth criteria revision must match result contract criteria authored revision
- Cross-candidate Truth data is rejected
- Wrong Truth binding produces validation error, not misleading label-agreement result
- Post-hoc: Truth is never an input to the reviewer or baseline

## 5. Mechanical Reference Validation vs Semantic-Support Review

### Mechanical Reference Validation

Determined independently from actual artifact metadata/content:
- Whether the reference resolves
- Whether the referenced artifact exists
- Whether it belongs to the declared Candidate
- Whether it belongs to the declared head/runtime snapshot
- Whether the reference path and artifact identity are valid
- Whether the source is current and applicable under the declared policy

These checks must NOT be accepted solely from caller-provided booleans.

### Semantic-Support Rubric

Frozen human-review rubric for:
- Whether the source actually supports the asserted behavior
- Whether every required subclause is covered
- Whether the reference is relevant to the original claim
- Whether it contradicts the claim

Where human review is used, retain the rubric version, decision, rationale and review provenance. Keep profile/repetition blinding where feasible.

### Test Requirements

- Existing but wrong-candidate reference is invalid
- Existing reference from a wrong snapshot is invalid
- Missing reference is invalid
- Existing and correctly tied but irrelevant reference is valid as a reference but unsupported semantically
- A reference covering only part of the criterion is not fully supporting
- A reference contradicting the claim is not supporting
- Invalid references do not erase original claim polarity

## 6. Scorer and Rubric Versions

- **Scorer version**: `scorer-v1`
- **Rubric version**: `rubric-v1`
- `evaluateRubric()`: evaluates `referenceExists`, `tiedToCandidate`, `supportsBehavior`, `coversSubclauses`, `relevantCurrentApplicable`, `contradictsClaim`
- `isReferenceSupporting(r)`: returns true only if all rubric conditions are met

## 7. Findings Mapping, Unmapped Findings and Skipped Findings

### Mapped Findings

- Have a `criterionMapping` pointing to a criterion ID
- If mapped to truth-satisfied criterion → false allegation
- If mapped to truth-violated criterion → supported detection

### Unmapped Findings

- Have `criterionMapping: null`
- Must remain visible and not automatically treated as false allegations
- Semantic support: neutral

### Skipped Findings

- Have `skipped: true` and `skipReason`
- Not counted as delivered findings (`deliveredCount` excludes skipped)
- Preserve reason and diagnostic

## 8. Run Ledger Event Schema and Lifecycle

The run ledger (`runs.jsonl`) uses an event-based model:

### Event Types

- `planned`: Initial planning event
- `attempt_started`: When an attempt begins
- `attempt_completed`: When an attempt completes successfully
- `attempt_failed`: When an attempt fails technically
- `attempt_unknown`: When execution state is unknown
- `cancelled`: When an attempt is cancelled
- `superseded`: When an attempt is superseded by a new revision

### Record Fields

- `eventId`: Unique UUID v4 identifier
- `runId`: Identifies the run
- `attemptId`: Identifies the attempt
- `executionState`: `planned` | `started` | `completed` | `failed` | `unknown` | `cancelled`
- `eventType`: One of the event types above
- `supersedes`/`supersededBy`: Links between related events

### Lifecycle Rules

- A new ledger starts with a `planned` or `attempt_started` event
- Terminal events require a prior `attempt_started`
- Duplicate event IDs are rejected
- Cancelled/superseded attempts cannot be resurrected
- Process termination after start leaves a visible incomplete attempt

### Integrity Checks

- `verifyLedgerIntegrity()` checks:
  - Unique event IDs
  - Attempt identity uniqueness rules
  - Valid event lifecycle transitions
  - Criteria revision parent/sequence lineage
  - Supersedes/supersededBy referential integrity
  - No cycles
  - No resurrection of cancelled/superseded attempts
  - Correct stub/live distinction
  - Record schema validity
  - Monotonic event ordering

## 9. Unique Event/Attempt Identities

- Each event has a unique `eventId` (UUID v4 format)
- `runId` and `attemptId` are stable identifiers
- Duplicate event IDs are rejected at append time
- Run/attempt identity duplication is checked by `findDuplicateIdentities()`

## 10. Single-Writer or Tested Multi-Writer Guarantees

- Pilot concurrency is one (per approved plan)
- Single-writer contract: only one process writes to the ledger at a time
- If multi-process writes are supported, a tested lock/transaction mechanism is provided
- Do not claim a write lock when none exists
- Malformed/truncated ledger records are detected with exact line diagnostics, not silently discarded

## 11. Criteria Revision Lineage

- `createCriteriaRevision(text, parent)`: creates a revision with parent lineage
- `revisionId` incorporates parent lineage: `crit-sha256(textDigest + (parent ?? "root")).slice(0, 8)`
- Identical text with different parent → distinct revisionId
- Text digest is stable: `sha256(text)` is the same for identical text
- `ct1Evaluate`: old v1 assessment cannot become current for v2
- `ct2Evaluate`: snapshot mismatch detected, evidence stale/inapplicable
- `ct3Evaluate`: re-addition creates new revision, cancelled never current

## 12. CT-1–CT-3 Before/After Identities and Decisions

### CT-1 — Criteria Revision Freshness

- Create v1 criteria record with revisionId `crit-xxx`
- Create v2 criteria record with edited AC-3 and revisionId `crit-yyy` (different from v1)
- Append v1 assessment with `criteriaRevision: v1.revisionId` and original ledger identity
- Supply the delayed v1 assessment after v2 becomes current
- Verify it remains historical and is rejected as current (admission denied)
- Create a v2 stub with complete sufficient coverage
- Verify only the v2 stub can be admitted

### CT-2 — Candidate/Snapshot Binding

- Use C2 current head snapshot
- Supply evidence explicitly bound to a different candidate snapshot
- Invoke the real shared admission function
- Verify evidence is stale/inapplicable (admission denied)
- Verify it cannot satisfy the current criterion
- Record before/after identities and the actual admission decision

### CT-3 — Removal and Re-Addition

- Create real v1 revision with parent lineage
- Append a removal/tombstone event
- Re-add identical criterion bytes as v3 using the real parent lineage/event identity
- Supply the delayed cancelled/superseded old assessment
- Verify it remains cancelled/superseded and cannot become current
- Supply a valid new v3 stub with sufficient coverage
- Verify it alone can be admitted

## 13. Test Results and Known Limitations

- 156 tests pass (10 suites): 22 WP5/WP6 tests + 124 M2-A/M2-B regression tests
- All WP5 tests pass: execution state semantics, Profile A finding scoring, rubric stability
- All WP6 tests pass: ledger append/read, failure recording, duplicate rejection, integrity, CT helpers
- Typecheck and declaration build pass
- CI: Ubuntu 24.04 and Windows 2022 both pass on push and PR runs
- Zero live model/API/OCR/Gateway calls

## 14. Zero Live Calls and Deferred WP7/WP8 Work

- No live model/API/OCR/Gateway calls
- WP7 (SDK/OCR fake-provider qualification) deferred
- WP8 (integrated readiness) deferred
- No package publication or deployment
- No credentials or provider setup

---
*Document generated from the M2-C implementation. Keep claims aligned with actual tests and implementation.*