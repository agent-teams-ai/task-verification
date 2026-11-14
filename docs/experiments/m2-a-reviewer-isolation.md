# M2-A Reviewer Input Inventory and Isolation Report (WP1/WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Reviewer materialization/input-assembly foundations are implemented and
tested. Each materialization contains only the selected candidate's approved
application files plus base/head identities and the permitted diff; it excludes
the parent experiment checkout, sibling candidates, oracle source and
execution internals, reference answer files and ground-truth labels, and
unrelated Git branches/history.

## Materialization contents (per selected candidate)

Included:
- The selected candidate's application source: `src/{app,audit,behavior,types}.ts`
- `candidates/S1-Cn/MANIFEST.json`: candidate id, base/head identities, label, expected criteria, behavior, source inventory, sanitization flag, tree digest
- Base/head identities and permitted base-to-head diff (recorded in
  `candidates/provenance.json` from disposable sanitized git repos)

Excluded:
- Parent experiment checkout and its Git history
- Sibling candidates (`S1-C{1..4}\{n}`)
- Oracle source and execution internals (`oracle/src/`)
- Reference answer files and ground-truth labels (`truth-v1.json`, anonymization map, salt) — these belong to WP3 and are excluded from reviewer-supplied context
- Unrelated Git branches and history

## Isolation tested in M2-A (Profile B — `/llm`)

The exact assembled context was tested (`tests/isolation.ts`):

- Selected candidate materialization contains only the four approved
  application files.
- Sibling candidates and oracle source are not part of the reviewer-visible
  application tree.
- Reference artifacts (truth, salt, anonymization map, version manifest) are
  not in any candidate materialization.
- Candidate sources do not reference the `/llm` oracle entry, oracle source,
  or paths escaping the candidate tree.

For `/llm`, input assembly (criteria IDs/text, pinned base/head identities,
full head tree, complete base-to-head diff, PR title, cleaned description) is
verified to exclude public reference artifacts and oracle outputs.

## Profile A (managed OCR) — boundary prepared, not fully qualified

- A clear materialization boundary is prepared for later WP7 testing: only the
  selected application snapshot and permitted context.
- Full managed OCR tool-boundary qualification (loopback-only fake provider,
  network restrictions preventing OCR tools from reaching public reference
  artifact URLs via external URLs) is **deferred to WP7** and is NOT claimed
  as proven in M2-A.
- It is explicitly NOT claimed that merely not mounting reference files
  proves OCR tool/network isolation.

## Distinction documented

| Already tested in M2-A | Deferred to WP7 |
|---|---|
| Input assembly excludes reference artifacts (Profile B `/llm` assembled input checked) | Full enabled-tool and network isolation for managed OCR (fake provider + loopback + network restrictions) |
| Reviewer-visible file inventory and digest recorded | Loopback-only fake provider validation of OCR tool boundary |

## Public-artifact policy followed

Public availability of reference artifacts (fixture definitions, truth,
anonymization map, salt, version manifest) does **not** mean the reviewer
receives them as input or retrieves them through enabled tools during
evaluation. "Sealed" = frozen and excluded from the evaluated reviewer's
actual input and tool reach; it does not mean secret. The salt is
reproducibility data, not a credential.

The pilot is documented as public and reproducible, **not** previously unseen
by models; no claim is made that tasks are unaffected by public benchmark
exposure.
