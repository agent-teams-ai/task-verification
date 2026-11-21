# Reviewer input freeze v1 — frozen, not sent

This is the exact material each reviewer path was frozen to receive for Candidate A. It was assembled
and hashed **before** any review attempt. Nothing was sent: the run stopped at the provider preflight
(`PILOT-PREFLIGHT.md`).

## Shared material (both paths)

| Item | Path | Digest |
| --- | --- | --- |
| Frozen requirements | `synthetic/requirements/RECORD-API-v1.md` | `sha256:ca868a3f…6bde727f` |
| PR description, title, base/head identity | `synthetic/metadata/pr.json` | see `metadata/` |
| Base commit | `ce99b0d65d645124413a746ecb137b5497aad80f` (tree `0f6c4d8e…`) | — |
| Candidate A commit | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` (tree `aa4af8c4…`) | — |
| Changed paths | `README.md`, `src/records.ts`, `src/router.ts`, `tests/records.test.ts` | per-file SHA-256 in `pr.json` |
| Unchanged context | `package.json`, `tsconfig.json`, `src/csv.ts`, `src/format.ts`, `src/store.ts`, `tests/csv.test.ts`, `tests/format.test.ts`, `tests/store.test.ts` | per-file SHA-256 in `pr.json` |

No file outside this list was offered to a path.

## Path 1 — ordinary OCR

Receives, under its own unchanged configuration and publication policy: the Candidate A repository
content (changed and unchanged files as listed), the PR title and description, the base/head
identities, and the frozen requirements if its normal input includes them. Its rules, prompt,
native filtering and publication policy would not be modified.

**Not received:** `synthetic/evaluator/` (expectations, hidden check), the missing-capability note,
Candidate B.

## Path 2 — criteria assessment (`gpt-6.1-terra`, `reasoning.effort=medium`)

Receives: the complete frozen requirements, the PR title/description, the Candidate A identities, and
the source needed to reason about the implementation (all changed files plus `src/csv.ts`,
`src/format.ts`, `src/store.ts`, `package.json`). The requested output is one assessment per
requirement (R1, R2, R3) with status, evidence references and reasoning.

**Not received:** `synthetic/evaluator/`, the missing-capability note, the hidden check, Candidate B,
any Truth label or expected answer.

## Separation

`evaluator/EXPECTATIONS.md` and `evaluator/r3-export.test.ts` live outside `repo/`, are not referenced
from `metadata/pr.json`, and are applied only after initial outputs are frozen. The hidden check fails
on Candidate A (`404 !== 200`), as designed.
