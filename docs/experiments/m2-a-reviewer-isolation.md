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

Included (strict explicit allowlist, built by `src/materialization.ts`):
- The selected candidate's application source: `app.ts`, `audit.ts`, `behavior.ts`, `types.ts`, and (for S1-C2) `authz.ts`
- `base-head-identities.json`: base/head identities only (no manifest, no expected criteria, no behavior label)
- `base-to-head.diff`: the complete permitted base-to-head diff
- `criteria.json`: frozen criterion IDs and wording (`crit-v1`, AC-1..AC-5) only
- `task-metadata.json`: approved shared task/PR metadata

Excluded (never copied into reviewer materialization):
- `candidates/S1-Cn/MANIFEST.json` (candidate labels, expected criteria, behavior descriptions)
- `candidates/provenance.json` (reference mapping)
- Parent experiment checkout and its Git history
- Sibling candidates
- Oracle source and execution internals (`oracle/src/`)
- Reference answer files and ground-truth labels (`truth-v1.json`, anonymization map, salt)

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

## Opaque alias vs. anonymization (clarification)

The reviewer-facing identifier `S1-FIX-<12 hex>` produced by `opaqueId()` in
`src/materialization.ts` is a **reviewer-facing opaque alias**, not a
confidentiality or anonymization control:

- The salt used to derive it is public reproducibility data (not a secret).
- The mapping from candidate ID to alias is publicly reconstructable by any
  reader who applies the same salt and hash.
- No claim is made that the alias prevents a knowledgeable public reader from
  identifying a candidate, or that models have never seen the public fixture or
  reference data.

The alias exists to keep candidate labels out of the reviewer-facing
materialization and serialized Profile B input (input-field exclusion). It is
distinct from:

- **Input-field exclusion** (tested here): manifests, provenance, expected
  criteria, labels and behavior descriptions are never placed in reviewer
  materialization or Profile B input.
- **Filesystem/tool isolation** (tested here): only the allowlisted
  application files are materialized; sibling candidates, oracle source and
  parent checkout are excluded.
- **Network/tool isolation** (deferred to WP7): managed OCR tool and network
  boundary qualification is not claimed in M2-A.
- **Public availability and reproducibility**: all reference artifacts remain
  public; reproducibility is preserved.

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
