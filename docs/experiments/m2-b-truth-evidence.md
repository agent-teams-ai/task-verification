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
from permitted artifacts and actual M2-A oracle observations only. Packets are
self-contained: each evidence item embeds the canonical observation payload so
reviewers do not need raw oracle receipts (which remain outside reviewer
access).

Per-evidence-item identity:
- `evidenceId` — `EV-<anonId>-<criterion>-<request>-<n>` (anonymized, no raw
  candidate ID).
- `sourceRef` — anonymous logical reference scoped to the candidate snapshot,
  e.g. `candidate-snapshot:S1-FIX-...#request/P-revoked/response`, resolvable
  via the anonymization map to committed candidate artifacts.
- `sourceDigest` — SHA-256 of the embedded canonical observation payload
  (the explicit observation representation), independently recomputed and
  verified (`verifyItemSourceDigest`). It is deliberately NOT the candidate
  application digest.
- `sourceLocation` — exact request/response field or audit record.
- `observation` — `pass`/`fail`/`unavailable` derived from actual per-request
  data (AC-1: 200 + caller id/email; AC-2/AC-3: 401 + no profile fields;
  AC-4: denied-field field scan; AC-5: exactly one missing_credential audit
  record).
- `applicability`/`freshness` — `applicable`/`fresh` for real observations.

Packet-level:
- `candidateSnapshotDigest` — head application digest (separate from per-item
  source digests).
- `checkDefinitionDigest` — SHA-256 of the frozen baseline policy, bound to
  `src/baseline-policy.ts`.
- `artifactRefs` — anonymous logical references (`candidate-manifest:<anon>`,
  `candidate-snapshot:<anon>`, `evidence-v1:<anon>.json`) resolvable from a
  clean checkout via the anonymization map; no `.oracle-receipts/` dependence.
- Deterministic: `observationTime`/`generatedAt` derive from the recorded
  observation timestamp, not wall clock; no `new Date()` in the payload.

### Deterministic baseline (`src/baseline.ts`)

Consumes a versioned evidence packet and the frozen criterion policy only:
- Never reads `truth-v1.json`, the anonymization map, salt, scorer internals,
  or another candidate's state.
- Never calls a model or external service.
- Validates the packet against the frozen policy before scoring and rejects
  malformed/incomplete packets (bad schema, bad policy digest, duplicate or
  unknown evidence IDs, cross-candidate evidence, source-digest mismatch,
  undeclared evidence) rather than silently treating them as complete.
- Outcome per criterion:
  - `satisfied`: all required observations present, applicable, fresh, valid,
    and passing under the frozen policy.
  - `violated`: at least one valid, applicable, fresh observation demonstrates
    a required-behavior violation.
  - `unresolved`: required evidence missing, technically unavailable, stale,
    inapplicable or insufficient.
- Missing/malformed evidence is never converted into `satisfied` or into a
  behavioral violation; insufficient evidence stays `unresolved`.

Baseline output (`baseline/baseline-results.json`) matches the observed
evidence: C1/C2 all satisfied; C3 AC-3 violated; C4 AC-4 violated — derived
without reading truth.

## Reproducibility

- Evidence packets regenerated from the same immutable source inputs produce
  byte-identical output (verified by independent regeneration into two clean
  directories and SHA-256 comparison).
- Baseline output is byte-identical across clean repetitions.
- Determinism verified by `tests/wp4.ts` (independent regeneration, canonical
  serialization, policy digest stability).

## Verification

Full suite: all tests pass, 0 fail, 0 skipped (includes 83 M2-A regression
tests plus WP3/WP4 tests). Strict typecheck and declaration build pass.
Fresh CI runs on Ubuntu 24.04 and Windows 2022 for the stacked PR #3:

- Commit SHA: `278128e8b33e806fe7042500389c200894a83858`
- Push CI run `43702048245`: success — `verify (ubuntu-24.04)`,
  `verify (windows-2022)`
- PR CI run `43702053758`: success — `verify (ubuntu-24.04)`,
  `verify (windows-2022)`

## Deferred work

WP5 (result contract/scorer), WP6 (run ledger/CT controls), WP7 (SDK/OCR
fake-provider qualification), WP8 (integrated readiness), live model/API/OCR/
Gateway calls, package publication. None are part of M2-B.
