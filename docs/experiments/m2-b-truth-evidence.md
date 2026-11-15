# M2-B Truth-v1, Evidence Packet and Deterministic Baseline (WP3–WP4)

**Milestone:** M2-B (WP3–WP4), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation); code/tests/tooling: Apache 2.0.
**Status:** Implemented, executed, verified. Stacked Draft PR #3 on M2-A branch `feat/m2-a-foundation-fixture-oracle`.

## Summary

WP3 freezes the ground truth (`truth-v1.json`), publishes the anonymization
map and salt, and records a version manifest with checksums. WP4 builds the
factual evidence packets (`evidence-v1/`) and runs a deterministic baseline
over them. No live model/API/OCR/Gateway calls. M2-B is strictly WP3–WP4;
WP5–WP8 remain deferred.

## WP3 — Ground truth, anonymization and public references

### Artifacts (all public, frozen, versioned)

- `truth/truth-v1.json` — per-candidate/per-criterion labels under `crit-v1`,
  assertion references, scope, public-artifact policy, and head-application
  digests for all four candidates.
- `truth/anonymization-map.json` — candidate ID → `S1-FIX-<12 hex>` alias,
  derived from a salted SHA-256. References `truth/salt.txt`.
- `truth/salt.txt` — public reproducibility salt (NOT a credential or secret).
- `truth/version-manifest.json` — artifact versions, byte counts and SHA-256
  checksums for the three truth artifacts.

### Expected truth (crit-v1, preserved unchanged)

| Candidate | AC-1 | AC-2 | AC-3 | AC-4 | AC-5 |
|-----------|------|------|------|------|------|
| S1-C1     | pass | pass | pass | pass | pass |
| S1-C2     | pass | pass | pass | pass | pass |
| S1-C3     | pass | pass | fail | pass | pass |
| S1-C4     | pass | pass | pass | fail | pass |

Truth labels are independently validated against the M2-A oracle receipts
(`src/truth.ts`, `validateTruthAgainstOracle`). Truth outcomes are never
changed to suit implementation convenience.

### Reviewer exclusion

`truth-v1.json`, the anonymization map, salt and manifest are:
- excluded from reviewer materialization (verified by `tests/wp3.ts` against
  the actual `buildReviewerMaterialization` output);
- excluded from evidence packets and baseline input;
- never read by `src/evidence.ts` or `src/baseline.ts`;
- public reproducibility artifacts, not secrets.

## WP4 — Evidence packet

### Packet builder (`src/evidence.ts`)

Each candidate has one packet (`evidence-v1/S1-FIX-<12 hex>.json`), derived
from committed, sanitized Oracle observation-source artifacts and the
anonymization map. Packets are self-contained: each evidence item embeds the
referenced observation so reviewers do not need raw oracle receipts (which
remain outside reviewer access).

Per-evidence-item identity:
- `evidenceId` — `EV-<anonId>-<criterion>-<request>-<n>` (anonymized, no raw
  candidate ID).
- `sourceRef` — anonymous logical reference to the committed observation-source
  artifact, e.g. `oracle-observations-v1:S1-FIX-.../pass1/requests/P-active-a.json#`,
  resolvable from a clean checkout via `src/source-ref.ts`.
- `sourceDigest` — SHA-256 of the canonical form of the exact referenced
  observation object (`canonicalDigest`), independently recomputable from the
  referenced bytes via `sourceRefDigest`. Distinct from the packet-level
  `candidateSnapshotDigest`.
- `sourceLocation` — exact request/response field or audit record.
- `observation` — `pass`/`fail`/`unavailable` derived from actual per-request
  source data (AC-1: 200 + caller id/email; AC-2/AC-3: 401 + no profile
  fields; AC-4: denied-field field scan; AC-5: exactly one
  missing_credential audit record). Missing source records are `unavailable`,
  never an inferred `fail`.
- `applicability`/`freshness` — `applicable`/`fresh` for real observations.

Packet-level:
- `candidateSnapshotDigest` — head application digest (separate from per-item
  source digests).
- `checkDefinitionDigest` — SHA-256 of the frozen baseline policy, bound to
  `src/baseline-policy.ts`.
- `artifactRefs` — anonymous logical references resolvable from a clean
  checkout.
- Deterministic: `observationTime`/`generatedAt` derive from the latest audit
  record timestamp (run-level metadata), never wall clock; no fabricated
  timestamps. Stripped from canonical form for reproducibility comparison.

### Observation-source artifacts (`oracle-observations-v1/`)

Committed, sanitized artifacts derived from M2-A oracle receipts (pass 1):
- `oracle-observations-v1/<alias>/pass1/requests/<requestId>.json` —
  `{requestId, statusCode, body, profileFieldsPresent, deniedFieldsPresent,
  available}`.
- `oracle-observations-v1/<alias>/pass1/audit/P-missing.json` —
  `{requestId, auditRecords, auditRecordCount, available}`.
- `oracle-observations-v1/manifest.json` — version and per-file SHA-256
  checksums.

No raw `S1-C1`..`S1-C4` identifiers, ground-truth labels, scorer internals,
defect explanations or candidate-class descriptions. Raw receipts are not
committed.

### Deterministic baseline (`src/baseline.ts`)

Consumes a versioned evidence packet and the frozen criterion policy only:
- Never reads `truth-v1.json`, the anonymization map, salt, scorer internals,
  or another candidate's state (neutral import graph: `src/baseline.ts` does
  not import `src/truth.ts`).
- Never calls a model or external service.
- Validates the packet against the frozen policy before scoring and rejects
  malformed/incomplete packets. Enforces exact criterion-to-request coverage:
  AC-1 requires exactly one P-active-a and one P-active-b observation; AC-2
  exactly one P-missing; AC-3 exactly one P-revoked; AC-4 exactly one per
  request; AC-5 exactly one P-missing audit observation. Duplicate request
  IDs (even with distinct evidence IDs), missing, unexpected, or
  wrong-criterion request IDs are rejected. Count-only validation is not used.
- Outcome per criterion:
  - `satisfied`: all required observations present, applicable, fresh, valid,
    and passing under the frozen policy.
  - `violated`: at least one valid, applicable, fresh observation demonstrates
    a required-behavior violation.
  - `unresolved`: required evidence missing, technically unavailable, stale,
    inapplicable or insufficient. Never converted to `satisfied` or to a
    behavioral violation.
- Missing observations are `unavailable` → `unresolved`; actual failures
  (`fail`) → `violated`.

Baseline output (`baseline/baseline-results.json`) matches the observed
evidence: C1/C2 all satisfied; C3 AC-3 violated; C4 AC-4 violated — derived
without reading truth.

## Reproducibility

- Evidence packets regenerated from the same immutable source inputs produce
  byte-identical output (independent regeneration into two clean directories,
  SHA-256 compared).
- Baseline output is byte-identical across clean repetitions.
- Recursive canonical JSON (`src/canonical.ts`) sorts keys at every nesting
  level, preserves array order and primitive types, rejects unsupported
  values. Independently implemented test-side canonicalization agrees with
  production. Nested payload and audit-record mutations change the digest;
  key reordering does not.
- Determinism verified by `tests/wp4.ts`.

## Reviewer/baseline boundary

- Restricted child-process test (`tests/wp4.ts`): an actual fresh OS child
  process loads and executes the real production `runBaseline` on a real
  packet, with `--permission` allowlisting only the baseline import graph
  (`src/baseline.ts`, `src/evidence-types.ts`, `src/canonical.ts`,
  `src/baseline-policy.ts`, `src/source-ref.ts`) and the input packet. All
  forbidden reads (`truth/truth-v1.json`, `truth/anonymization-map.json`,
  `truth/salt.txt`, other candidate manifests/evidence, raw receipts) return
  `ERR_ACCESS_DENIED`. Child output matches the in-process baseline result.
- Reviewer materialization excludes truth artifacts and sibling candidates
  (verified against actual builder output).

## Verification

Full suite: all tests pass, 0 fail, 0 skipped. Strict typecheck and declaration
build pass. Fresh CI runs on Ubuntu 24.04 and Windows 2022 for the stacked
PR #3.

## Deferred work

WP5 (result contract/scorer), WP6 (run ledger/CT controls), WP7 (SDK/OCR
fake-provider qualification), WP8 (integrated readiness), live model/API/OCR/
Gateway calls, package publication. None are part of M2-B.
