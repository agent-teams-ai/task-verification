# M2-A Candidate Snapshot Manifest (WP1)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Four candidate snapshots, each an immutable base/head file-map pair. A single
authoritative snapshot model (`scripts/snapshot-defs.ts`) is the source of every
derived artifact: reviewer-visible files, Git commit/tree identities, the
base-to-head diff, the oracle subject and the application digest. No derived
artifact is reconstructed from a separate working directory.

Reviewer-visible history contains only the selected sanitized base/head pair.
Branch names are not identities.

## Candidate matrix

| ID | Snapshot pair | Base | Head | Expected (AC-1..AC-5) | Provenance |
|---|---|---|---|---|---|
| `S1-C1` | base@B0 → head@H1 | B0 | H1 | ✅ ✅ ✅ ✅ ✅ | correct inline implementation |
| `S1-C2` | base@B0 → head@H2 | B0 | H2 | ✅ ✅ ✅ ✅ ✅ | correct alternative: route delegates to the unchanged `authz.ts` helper |
| `S1-C3` | base@B0 → head@H3 | B0 | H3 | ✅ ✅ ❌ ✅ ✅ | behavioral violation: revocation compare uses the caller id instead of the presented token |
| `S1-C4` | base@B1 → head@H4 | B1 | H4 | ✅ ✅ ✅ ❌ ✅ | omitted redaction: unchanged serializer includes `role` and `internal` |

## Snapshot structure

Every candidate snapshot contains the same six application files:

```
app.ts  audit.ts  authz.ts  behavior.ts  serializer.ts  types.ts
```

- **B0** is the shared base for C1, C2 and C3: a secure-by-default deny-all
  `app.ts` stub plus the unchanged `audit.ts`, `authz.ts`, `behavior.ts`,
  redacted `serializer.ts` and `types.ts`. C1/C2/C3 record the *same* base
  commit and tree (`55892353c3d8…` / `9926c46c14b1…`).
- **B1** differs from B0 in exactly one file: the content of the unchanged
  `serializer.ts` adds `role` and `internal`. Every other B1 file is
  byte-identical to B0.
- **H1–H4** are the base file map with only `app.ts` replaced. The unchanged
  base modules (including the serializer) stay byte-identical, so a head cannot
  silently alter a helper the base already contained.
  - H1: correct inline implementation.
  - H2: thin router that delegates to the unchanged `handleProfile` helper in
    `authz.ts`.
  - H3: inline implementation whose revocation check compares the caller id
    instead of the presented token, so revoked tokens pass.
  - H4: the same correct inline route as H1, exposing B1's unchanged serializer.

There are no behavior flags. The planted defects live in application code:
C3's wrong revocation compare in `app.ts`, and C4's `role`/`internal`
serialization from the unchanged B1 `serializer.ts`.

## Recorded identities (in `candidates/provenance.json`)

Each candidate has a disposable sanitized Git repository under
`.candidates-work/` (gitignored; not committed) with a base commit and a head
commit. Fixed author/committer identity and dates, `core.autocrlf=false` and LF
content make the identities and diff reproducible across runs and platforms.

| Candidate | Base commit | Base tree | Base application digest | Head commit | Head tree | Head application digest |
|---|---|---|---|---|---|---|
| `S1-C1` | `55892353c3d81a0bc8c8fc2c394f332c7ce3621e` | `9926c46c14b19a51664182992159f2b261ab0ff4` | `6cd7ce751d13288667d5f1136ade1b21061e62754378a963c58af45a6ceb9639` | `377332c9cab31550520291d3a4a32959c2726109` | `e03f4586783ccd11503874f50edb0c7b5b55642d` | `eff76066dcfb6a8c981f51e956f8f0f7e44c987ad3a1e4df542485137be25c89` |
| `S1-C2` | `55892353c3d81a0bc8c8fc2c394f332c7ce3621e` | `9926c46c14b19a51664182992159f2b261ab0ff4` | `6cd7ce751d13288667d5f1136ade1b21061e62754378a963c58af45a6ceb9639` | `3f6d04fb0df505113a30cb3c1a26a83647186faa` | `3edcc97a8e551ed4cf6177d33653b0daecff70d8` | `cd83f7c60958f28c7e84ec16811307bad17ac3b20d272a60ee5eb7f429fa2cef` |
| `S1-C3` | `55892353c3d81a0bc8c8fc2c394f332c7ce3621e` | `9926c46c14b19a51664182992159f2b261ab0ff4` | `6cd7ce751d13288667d5f1136ade1b21061e62754378a963c58af45a6ceb9639` | `21232077f4afec43b8fa2812ff99b2662842f5df` | `d4d7bbe93b94e7794785b04117ab5a364b919b45` | `20b6c1b150dbc848cb39148ef2b5eabf1a1c9e25dbfeba984e6c152c7ea80d63` |
| `S1-C4` | `16677e8adcadaed9a19c47505a4cd0f04ef4f009` | `eea17189454d7952116898c02c279b97d2e9cc10` | `a4d4836dc727ae8065079a1ae4ed25a7ec5dc788f929b74455d7933b32cb732f` | `9e0593d3c68e0bbc5ecbec2ee3c321edf63bb559` | `157867739fe9f22c9ad8c4b9a063364a2b8290ca` | `af93f879c98c792e833ee3917dfc6314df5ee3f3bd1ac2a0fb26cbb89edfb604` |

The **application digest** is SHA-256 over the sorted relative file paths and
LF-normalized file content, excluding `.git`. It is the identity used for
reviewer materialization and the oracle subject; it is independent of Git
administrative metadata.

Each recorded diff changes exactly one file (`app.ts`):

| Candidate | Changed files | Insertions | Deletions |
|---|---|---|---|
| `S1-C1` | `app.ts` | 68 | 9 |
| `S1-C2` | `app.ts` | 34 | 9 |
| `S1-C3` | `app.ts` | 65 | 9 |
| `S1-C4` | `app.ts` | 68 | 9 |

Every recorded diff forward-applies to the exact head file map and
reverse-applies to the exact base file map (verified by `tests/snapshots.ts`
using `git apply` / `git apply -R` in throwaway repositories).

## S1-C4 preserved difference

S1-C4 uses base B1 and head H4. Its `serializer.ts` is unchanged from B1, so
`serializeProfile` includes `role` and `internal`, and AC-4 is violated for the
approved reason (omitted redaction via unchanged serializer). It is not
normalized to B0, and no test asserts that the serializer changed.

## Criterion truth (per candidate)

Both polarity directions are present: two expected violations
(C3/AC-3 and C4/AC-4) and the remaining criterion outcomes satisfied.

## Files

- `candidates/S1-C{n}/src/{app,audit,authz,behavior,serializer,types}.ts` — self-contained snapshot source
- `candidates/S1-C{n}/MANIFEST.json` — candidate identity, expected criteria, base/head application digests
- `candidates/provenance.json` — base/head commit/tree identities, application digests and diffs
- `scripts/snapshot-defs.ts` — authoritative snapshot definitions
- `scripts/gen-candidates.ts` — deterministic generator (writes snapshots, manifests, provenance)
- `scripts/git-provenance.ts` — deterministic Git identity/diff computation
- `scripts/record-provenance.ts` — compatibility shim that calls the same generator
- `src/digest.ts` — application digest (sorted paths, LF content, excludes `.git`)
