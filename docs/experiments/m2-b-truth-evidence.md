# M2-B Truth-v1, Evidence Packet and Deterministic Baseline (WP3–WP4)

**Milestone:** M2-B (WP3–WP4), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation); code/tests/tooling: Apache 2.0.
**Status:** Implemented, executed, verified.

## Summary

WP3 freezes the ground truth (`truth-v1.json`), publishes the anonymization map
and salt, and records a version manifest with checksums. WP4 builds the
factual evidence packets (`evidence-v1/`) and runs a deterministic baseline
over them. No live model/API/OCR/Gateway calls.

## WP3 artifacts

- `truth/truth-v1.json` — per-candidate/per-criterion labels under `crit-v1`.
- `truth/anonymization-map.json` — candidate ID → `S1-FIX-<12 hex>` alias.
- `truth/salt.txt` — public reproducibility salt (not a credential).
- `truth/version-manifest.json` — artifact versions and SHA-256 checksums.

Expected truth: C1/C2 all pass; C3 AC-3 fails; C4 AC-4 fails. Independently
validated against M2-A oracle receipts.

## WP4 artifacts

- `evidence-v1/S1-FIX-*.json` — one packet per candidate (4 packets), derived
  from permitted artifacts and oracle observations only.
- `baseline/baseline-results.json` — deterministic baseline outcomes.

Evidence items carry provenance, source ref, source digest, observation
(`pass`/`fail`/`unavailable`), applicability and freshness. Packets contain no
ground-truth labels and no scorer internals.

## Deterministic baseline

Consumes the evidence packet and frozen criterion policy only. Never reads
`truth-v1.json`. Outcome per criterion: `satisfied` (all required fresh
observations pass), `violated` (any applicable observed violation), or
`unresolved` (missing/stale/inapplicable/failed evidence). Missing evidence is
never converted to satisfied.

## Reproducibility

Baseline output is byte-identical across repeated runs. Evidence packets are
regenerated deterministically from the same versioned sources.

## Verification

83 (M2-A) + 21 (M2-B) = 104 tests, all pass. Typecheck and declaration build
pass. CI pending on push.
