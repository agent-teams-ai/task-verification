# Ordinary checks — next-family candidates

Frozen 2026-11-22. Model-free, offline, reproducible.

- Command (definition `package.json#scripts.test`, identical for all three):
  `node --experimental-strip-types --test --test-concurrency=1 tests/*.test.ts`
- Node: `v24.13.1`
- Raw output: `raw-<commit>.txt` in this directory.

| Candidate | Commit | Exit | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | `54623dccc8b138c9ad5a41fc0347cf49ba039c61` | 0 | 17 | 17 | 0 | 0 |
| c02 | `65f210381920fbfce032cf5ba8aaa440f3300162` | 0 | 16 | 16 | 0 | 0 |
| c03 | `98408d376ae16e0aea365cbb36f1207c0c4f495d` | 0 | 17 | 13 | 0 | 4 |

## What the receipts are worth

All three candidates pass the only check the project defines. The suite therefore carries no signal
about C1 on either candidate and no signal about C2 on any candidate:

- c02's suite collapses duplicates only through the same payload, so the C1 defect is not exercised.
- c03's four skipped cases are the retry cases; each skip is recorded with the reason
  `requires @fixture/delivery-core from the workspace root, which is not part of this checkout`.

A green suite here is not coverage of the authored criteria, and it is not evidence of completion.
The skips are also the honest, ordinary record of the C2 evidence gap in c03 — the reviewer is meant
to notice them, not to treat them as a failure of execution.

## Reproduction

```
git -C synthetic/next-family/repo worktree add --detach /tmp/c01 54623dccc8b138c9ad5a41fc0347cf49ba039c61
cd /tmp/c01 && npm test
```

The receipts were produced in detached worktrees of the fixture repository so that the checked-out
tree is exactly the frozen commit.
