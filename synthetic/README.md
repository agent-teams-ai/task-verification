# Synthetic live pilot — Record Management API fixture

Branch: `exp/synthetic-live-pilot-01`, based on the corrected M2 commit `996cdcb`.
This tree is **not** part of M2 and is never merged into PR #2.

## Status

**Initial review not run — blocked at provider preflight (C1).** See `PILOT-PREFLIGHT.md`.
No model or provider request was made; 0 tokens, USD 0.00.

## Contents

| Path | What it is |
| --- | --- |
| `requirements/RECORD-API-v1.md` | Frozen task statement both reviewer paths receive (digest in `metadata/DIGESTS.json`). |
| `repo/` | Nested Git repository with two immutable commits: Base `ce99b0d`, Candidate A `23864e3`. Not tracked by this branch (its bundle is). |
| `artifacts/record-api.bundle` | Complete-history bundle of the fixture repository (`git bundle verify` passes). |
| `metadata/pr.json` | PR shape: title, body, base/head SHA, changed paths, unchanged-context manifest, ordinary check definition. |
| `metadata/DIGESTS.json` | Base/head tree and commit digests, requirements digest. |
| `inputs/REVIEWER-INPUT-v1.md` | Exactly what each reviewer path was frozen to receive. |
| `checks/RESULTS-A.md` | Ordinary checks on Candidate A: command, definition digest, exit status, output. |
| `evaluator/` | Evaluator-only expectations and hidden R3 check. Never reviewer-visible. |
| `PILOT-PREFLIGHT.md` | Provider-connection preflight result and the exact blocker. |

## Fixture identities

| Item | Value |
| --- | --- |
| Requirements revision | `record-api-req-v1` |
| Requirements SHA-256 | `ca868a3fcc2a9100eabda736c48a8e107125a1f5a8477eede3665be96bde727f` |
| Base commit | `ce99b0d65d645124413a746ecb137b5497aad80f` |
| Candidate A commit | `23864e3c877f2b34bbbdd90c4527ef46eb19cbd9` |
| Candidate B | **not created** — only after initial outputs are frozen and Iliya records the feedback |

## Deliberate defect

Candidate A implements R1 and R2. The CSV escaping helper (`src/csv.ts`) is present and unchanged in
the Base snapshot; the end-to-end R3 export capability is absent. Nothing in the candidate repository
names the omission, and no ordinary test covers it.
