# M2-A Candidate Snapshot Manifest (WP1)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Four candidate snapshots, each an immutable base/head tree pair materialized
from the frozen fixture definitions. Reviewer-visible history contains only the
selected sanitized base/head pair. Branch names are not identities.

## Candidate matrix

| ID | Snapshot pair | Base | Head | Expected (AC-1..AC-5) | Provenance |
|---|---|---|---|---|---|
| `S1-C1` | base@B0 → head@H1 | B0 | H1 | ✅ ✅ ✅ ✅ ✅ | correct inline implementation |
| `S1-C2` | base@B0 → head@H2 | B0 | H2 | ✅ ✅ ✅ ✅ ✅ | correct alternative: behavior in unchanged helpers |
| `S1-C3` | base@B0 → head@H3 | B0 | H3 | ✅ ✅ ❌ ✅ ✅ | behavioral violation: revoked tokens pass (wrong-field compare) |
| `S1-C4` | base@B1 → head@H4 | B1 | H4 | ✅ ✅ ✅ ❌ ✅ | omitted redaction: serializer includes `role` |

`B1` differs from `B0` only in the content of the unchanged serializer
(`serializerIncludesRole: true`), which is the stated confounder — C2 and C4
cannot share one baseline. The intentional S1-C4 difference is preserved: it
uses base B1, its serializer includes `role`, AC-4 remains violated, and it is
not normalized to B0.

## Recorded identities (per candidate, in `candidates/provenance.json`)

Each candidate has a disposable sanitized git repository under
`.candidates-work/` (gitignored; not committed) with a base commit and a head
commit. Recorded: base commit/tree identity, head commit/tree identity,
base-to-head diff, source inventory, sanitization flag, tree digest.

Example (`S1-C3`):
- Base: `B0@2a779b144631` (tree `becd373786…`), behavior all-correct
- Head: `H3@d48c8bf57be2` (tree `5e443ab5304b…`), behavior `revokeFieldCorrect: false`
- Diff: `behavior.ts` `revokeFieldCorrect: true → false` (+ app.ts stub→full)
- Head tree digest: `ce5ee66b47de20bbf649d811f5844835861a85084c810a2252d745d2752fbf50`

Full identities and diffs are in `candidates/provenance.json`.

## S1-C4 preserved difference

S1-C4 uses base B1 (`serializerIncludesRole: true`) and head H4. Its
`serializeProfile` includes `role` and `internal`, so AC-4 is violated for the
approved reason (omitted redaction via unchanged serializer). It is not
normalized to B0.

## Criterion truth (per candidate)

Both polarity directions are present: two expected violations
(C3/AC-3 and C4/AC-4) and 54 expected satisfied observations per profile (4
candidates × 5 criteria − 2 violations = 18 per pass × 3… ; per the plan, 6
planned negative and 54 positive criterion opportunities per profile over the
planned review matrix).

## Files

- `candidates/S1-C{n}/src/{app,audit,behavior,types}.ts` — self-contained snapshot source
- `candidates/S1-C{n}/MANIFEST.json` — candidate identity, expected criteria, tree digest
- `candidates/provenance.json` — base/head commit/tree identities and diffs
- `scripts/gen-candidates.ts` — deterministic snapshot generator
- `scripts/record-provenance.ts` — disposable git-repo provenance recorder
