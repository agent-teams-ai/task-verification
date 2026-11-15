# M2-A Verification Report (WP0–WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation); code/tests/tooling: Apache 2.0.
**Status:** Implemented, executed, verified; submitted as a separate Draft PR.
**Date:** 2026-11-15 (corrective pass 2)

## 1. Latest Milestone 1 PR head SHA and c8da23d inclusion

- PR #1 ("research: add Task Verification Stage A/B experiment plan") is **OPEN, Draft**, base=`main`, head=`research/milestone-1-experiment-plan-2026-11-12`.
- PR head SHA: `c8da23dc0bcd7328937d378e8abc91526764d5ec`
- `c8da23d` **is included**: it is the PR head itself (and the Milestone 1 branch head). Verified via `git ls-remote origin` and `gh pr view 1` (authenticated GitHub CLI).
- `refs/pull/1/head` = `c8da23dc0bcd7328937d378e8abc91526764d5ec`; `refs/pull/1/merge` = `e96c3dabd8c760e678dba17b9753cd0678b9fcc7` (PR still open, unmerged).
- Local `main` = `origin/main` = `12af17867adb84fea17f87825b4e01ea325d36d4`.

## 2. New M2-A branch and exact base

- Branch: `feat/m2-a-foundation-fixture-oracle`
- Base: `c8da23dc0bcd7328937d378e8abc91526764d5ec` (latest verified Milestone 1 PR head, since PR #1 is open and unmerged)
- PR #1 kept unchanged; a separate Draft PR (#2) is open with the Milestone 1 branch as its base. Neither PR is merged.

## 3. Repository and GitHub identity

- Repository: `https://github.com/agent-teams-ai/task-verification` (owner `hassanbht`)
- Git identity (verified via `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` before every commit):
  `Hassan Behtooei <29015519+hassanbht@users.noreply.github.com>`
- `gh auth status --hostname github.com`: logged in as `hassanbht`, token scopes include `repo`.
- No global Git config modified; no `git -c user.name/email`; no `hassanbehtooei` identity; no force-push, amend or rebase.

## 4. WP0 environment results

| Item | Result |
|---|---|
| Node runtime pinned | `24.13.1` (`engines.node`) — verified |
| pnpm pinned | `9.15.0` — verified (`pnpm --version`) |
| Strict TypeScript | `strict: true` in `tsconfig.json` — verified |
| TypeScript pinned | `7.0.2` (org standard: 7.0.2 or newer) — verified |
| Lockfile committed | `pnpm-lock.yaml` — committed, references `typescript` |
| Scripts work | `typecheck`, `build:types`, `test` all pass — verified |
| `@types/node` | `24.0.0` devDependency — installed |
| Type check | `tsc --noEmit` passes (exit 0) |
| Declaration build | `tsc -p tsconfig.json` passes (exit 0), emits declarations |
| Tests | 83 tests, 83 pass, 0 fail, 0 skipped |
| Docs Protocol tooling | Bootstrapped where supported (docs under `docs/experiments/`) |
| Package publication | None (WP0 scope excludes publication) |
| Gateway deployment | None |

## 5. SDK/OCR availability and exact failures

- `@agent-teams/account-gateway` v0.1.0 (commit `539418d…`): **private, not published; no packed archive retrievable**. Documented as unavailable; no fake archive or invented provenance. Not required for the model-free substrate.
- Managed OCR `ocr-v1.13.1-rr.6`: expected SHA-256 `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`, size 80,513,363 bytes (per S7/§3.3). Checked only; not rebuilt from Go source; no live OCR review. Its unavailability does not block WP1/WP2.
- No live model/API calls executed (verified: zero).

## 6. Fixture architecture

Minimal TypeScript HTTP service (`GET /profile`), six application files (≈340
lines), deterministic, JSON audit sink, fixed initial state, explicit reset, no
external dependency, stable responses. There are no behavior flags: the planted
defects live in application code. See `m2-a-fixture.md`.

## 7. Four candidate base/head identities and digests

Recorded in `candidates/provenance.json` (disposable sanitized Git repositories
under `.candidates-work/`, gitignored). Full values:

| Candidate | Pair | Base commit | Base tree | Head commit | Head tree | Head application digest |
|---|---|---|---|---|---|---|
| S1-C1 | B0 → H1 | `55892353c3d8…` | `9926c46c14b1…` | `377332c9cab3…` | `e03f4586783c…` | `eff76066dcfb…` |
| S1-C2 | B0 → H2 | `55892353c3d8…` | `9926c46c14b1…` | `3f6d04fb0df5…` | `3edcc97a8e55…` | `cd83f7c60958…` |
| S1-C3 | B0 → H3 | `55892353c3d8…` | `9926c46c14b1…` | `21232077f4af…` | `d4d7bbe93b94…` | `20b6c1b150db…` |
| S1-C4 | B1 → H4 | `16677e8adcad…` | `eea17189454d…` | `9e0593d3c68e…` | `157867739fe9…` | `af93f879c98c…` |

C1, C2 and C3 record the identical B0 base commit/tree and base application
digest (`6cd7ce751d13…`). C4 uses B1. Full 40/64-character values are in
`candidates/provenance.json` and `candidates/S1-Cn/MANIFEST.json`.

S1-C4 B1 difference preserved: it uses base B1, its unchanged serializer
includes `role` and `internal`, AC-4 is violated, and it is not normalized to B0.

## 8. crit-v1 criterion mapping

AC-1..AC-5 map one-to-one to five oracle assertion groups (AC-1..AC-5). Full
text is preserved verbatim from the latest plan. See `m2-a-oracle-mapping.md`.

## 9. Oracle request and assertion totals

- 4 HTTP requests per candidate per pass (`P-active-a`, `P-active-b`, `P-missing`, `P-revoked`)
- 4 candidates × 2 passes × 4 requests = **32 HTTP requests**
- 5 assertion groups per candidate per pass × 4 candidates × 2 passes = **40 assertion-group evaluations**
- Not described as six probes; HTTP request count (32) is distinct from assertion-group count (40).

## 10. Results of both oracle passes

| Candidate | Pass 1 | Pass 2 | Agree | Overall |
|---|---|---|---|---|
| S1-C1 | pass | pass | ✅ | pass |
| S1-C2 | pass | pass | ✅ | pass |
| S1-C3 | fail (AC-3) | fail (AC-3) | ✅ | fail |
| S1-C4 | fail (AC-4) | fail (AC-4) | ✅ | fail |

Both passes agree for every candidate. Diagnostics preserved for S1-C3/S1-C4;
no expected result was manually altered. Each pass ran in a fresh child
process (8 distinct PIDs).

## 11. All four fault-control results

| Fault | Injected behavior | Affected criterion | Rejected? | Unmodified passes? |
|---|---|---|---|---|
| Wrong caller identity | `P-active-a` id = `wrong-caller` | AC-1 | ✅ Yes | ✅ Yes |
| Denial-field leakage | `P-missing` body includes `role` | AC-4 | ✅ Yes | ✅ Yes |
| Missing audit entry | `P-missing` audit delta empty | AC-5 | ✅ Yes | ✅ Yes |
| Duplicate audit entry | `P-missing` two audit records | AC-5 | ✅ Yes | ✅ Yes |

All four faults are rejected on their target criteria; the unmodified fixture
passes. A second, HTTP-level exercise runs four test-only faulty applications
through the same fresh-process driver (`tests/faults-http.ts`, 5 tests) and
rejects the same target criteria.

## 12. Snapshot integrity (maintainer finding 1)

One authoritative immutable snapshot per candidate drives every derived
artifact:

- `scripts/snapshot-defs.ts` defines B0/B1 file maps and each head as
  base-with-only-`app.ts`-replaced.
- `scripts/gen-candidates.ts` derives reviewer files, Git identities, diffs,
  manifests and application digests from that same model.
- `src/digest.ts` computes the application digest over sorted relative paths
  and LF-normalized content, excluding `.git`.
- `src/materialization.ts` recomputes the digest from the files it actually
  materialized and compares it with the recorded snapshot digest.

Verified by `tests/snapshots.ts` (8 tests):

- recorded head identities, reviewer files and digests all come from one
  snapshot;
- materialized reviewer files match the recorded head and digest;
- every recorded diff forward-applies to the exact head and reverse-applies to
  the exact base;
- `.git` administrative metadata is excluded from the digest;
- repeated snapshot/Git generation is deterministic;
- C1/C2/C3 share B0 and C4 exposes an unchanged B1 serializer;
- all four head snapshots are distinct;
- candidate snapshot directories contain no Git metadata.

## 13. C2/C4 structure (maintainer finding 2)

- C1, C2 and C3 share the identical B0 base (same commit, tree and application
  digest).
- C2's `app.ts` is a thin router that delegates to the unchanged `authz.ts`
  helper; it does not inline `handleProfile`.
- C4's `serializer.ts` is byte-identical between base B1 and head H4. The only
  changed file is `app.ts`. Tests assert that the serializer is unchanged and
  that AC-4 is still violated with `role` and `internal` present.
- All heads are the base map with only `app.ts` replaced, so no head silently
  modifies an unchanged base module.

## 14. Oracle receipts (maintainer finding 3)

- Each pass persists `.oracle-receipts/S1-C{n}-pass{1,2}.json`.
- `assertions` and `auditDeltas` are plain JSON objects, never serialized from
  `Map` instances; they cannot collapse to `{}`.
- `tests/oracle-receipts.ts` (2 tests) runs all eight passes, reads every
  receipt back from disk, and verifies populated assertions (all five criteria
  with `criterionId`, boolean `passed`, `detail`) and audit deltas (all four
  request keys, with one `missing_credential` record for `P-missing`).
- Repeated fresh processes produce identical canonical receipt JSON and
  semantic digests after stripping volatile PID/duration/wall-clock fields and
  audit timestamps. Raw receipts retain distinct execution metadata.

## 15. Fresh-process isolation (maintainer finding 4)

- Every candidate pass runs in a fresh OS process inside a throwaway workspace
  containing only the candidate's application files, a `package.json`, and the
  isolated runner.
- Node runs with `--permission --allow-fs-read=<workspace>`. Reads of ground
  truth, scorer internals, sibling candidates, fixture source and unapproved
  repository files fail with `ERR_ACCESS_DENIED`.
- The child receives only the request matrix, candidate id and path probes;
  expected criteria and assertion logic stay in the parent.
- The parent validates the child output contract and handles timeout, abort,
  non-zero exit and malformed output with a typed error, always removing the
  workspace.
- `tests/process-isolation.ts` (8 tests) verifies distinct child PIDs, fresh
  process-local state, workspace inventory, permitted/forbidden reads,
  per-candidate fresh processes, and cleanup on success, timeout, abort,
  malformed output and non-zero exit.
- Runs on both Ubuntu 24.04 and Windows 2022 via the CI matrix.

## 16. Reviewer input-isolation results

- Each materialization includes only the selected candidate's allowlisted
  application files (including `serializer.ts`) plus base/head identities and
  the permitted diff.
- It excludes the parent checkout/history, sibling candidates, oracle
  source/internals, reference answers/ground truth and unrelated branches.
- Profile B (`/llm`) assembled input is verified to exclude reference artifacts
  and oracle outputs (`tests/isolation.ts`, 12 tests).
- Materialization path safety (`tests/materialization-safety.ts`, 12 tests)
  rejects traversal/escape, protected paths, unsupported candidates, dangling
  symlinks, deep nested links, a redirected root and junction/reparse points.
  This preserves the earlier dangling-symlink/reparse-point correction.
- Profile A (managed OCR) tool/network boundary is **not** qualified in M2-A.
  It is deferred to later live evaluation and is not a prerequisite for the
  model-free M2-B work.

## 17. Public reference-artifact policy followed

Public artifacts (fixture definitions, truth, anonymization map, salt, version
manifest, receipts) are public and reproducible. They are **excluded from
reviewer input/tool reach**; "sealed" ≠ secret. Salt is reproducibility data,
not a credential. No private repo, no GitHub Secrets, no private storage. The
pilot is documented as public and reproducible, not previously unseen.

## 18. Tests executed and exact results

83 tests, 83 pass, 0 fail, 0 skipped (10 suites; the shared helper module `tests/helpers.ts` contributes one file-level pass). Command: `node --experimental-strip-types --test --test-concurrency=1 tests/*.ts`.

- WP0 (7): runtime version, pnpm version, TS pin, strict TS, lockfile, typecheck, declaration build.
- WP1 (14): fixture startup, request/response, state reset, candidate isolation, digests, B0/B1 structure, C4 unchanged serializer and AC-4 violation, C3 AC-3 violation, C1/C2 behavioral equivalence, C2 structural difference and helper dependency, head-equals-base-plus-app.
- WP2 assertions (12): AC-1..AC-5 pass/fail behavior, fault-control rejection, criterion coverage.
- HTTP-level fault injection (5): four faulty applications rejected through the fresh-process driver plus unmodified C1 passing.
- Oracle end-to-end (2): 32 requests / 40 assertion-group evaluations, two-pass repeatability, 8 distinct PIDs.
- Persisted oracle receipts (2): all eight receipts read back from disk with populated `assertions`/`auditDeltas`; deterministic canonical JSON.
- Fresh-process isolation (8): PIDs, fresh state, workspace inventory, permitted/forbidden reads, timeout, abort, malformed output, non-zero exit.
- Reviewer input isolation (12): exact materialized tree, no labels/answer annotations, Profile B input fields, allowlist, parent/sibling/oracle exclusion, reference-artifact exclusion.
- Materialization path safety (12): valid output, traversal/escape, protected paths, unsupported candidates, dangling/deep links, redirected root, junction/reparse points.
- Snapshot integrity (8): one-snapshot derivation, materialized match, forward/reverse diff, `.git` exclusion, deterministic regeneration, B0/B1 structure, distinct heads, no Git metadata.

No unexecuted test is claimed as passed.

## 19. Historical S5/S7 evidence reused

- S5 (model-free evidence bundle): scope — 44 local checks, 14 upstream assertions, 12 loopback requests, 0 model calls; reused only as inspected, unexecuted intent; not re-verified as executed results.
- S7 (exact managed OCR receipts): scope — 10 managed review invocations, 1 version check, 14 loopback fake-provider POSTs, 9 parser assertions, 0 real provider calls; reused for its exact versions and scope (named native/parser behaviors). Reused as compatibility evidence only; it does not qualify the full backend/Gateway route or live OCR.
- Neither set qualifies live model quality or the entire OCR/Gateway route.

## 20. M2-B prerequisites (WP3–WP4)

The next milestone is model-free: canonical `truth-v1.json` packaging,
anonymization map, salt, version manifest, Evidence Packet and deterministic
baseline (WP3–WP4), followed by the deterministic scorer.

- WP7 SDK/OCR fake-provider qualification and live-execution authorization
  (D1/D2 credentials, model and spend choices) are **not** prerequisites for
  M2-B. They are gates for later live qualification and Stage A only.
- No live model/API/OCR/Gateway call is required or made in M2-B.
- M2-B is not started automatically; M2-A stops here after submission as a
  separate Draft PR.

## 21. Confirmation of zero live model/API calls

Zero live model/API calls were made during M2-A. Verified: no model
invocations, no live OCR, no real credentials, no Gateway deployment.

## 22. Draft PR

- PR #2: `https://github.com/agent-teams-ai/task-verification/pull/2`
- Head branch: `feat/m2-a-foundation-fixture-oracle`
- Base: `research/milestone-1-experiment-plan-2026-11-12`
- State: OPEN, Draft. CI runs typecheck, declaration build and the full test
  suite on Ubuntu 24.04 and Windows 2022; run identities are recorded on PR #2.

## Corrective pass 1 (P0/P1)

- **Isolation:** strict explicit allowlist builder assembles reviewer
  materialization and the serialized Profile B input. Manifests, provenance,
  expected criteria/labels/behavior are excluded. Opaque reviewer-facing
  identifiers (`S1-FIX-<12 hex>`). Tests inspect the exact materialized tree and
  serialized input.
- **C2:** distinct delegating implementation (thin router + unchanged
  `authz.ts` helper), proven by tests.
- **HTTP-level fault controls:** four test-only faulty applications exercised
  through the Oracle driver.
- **WP0 tests:** exact Node version, pnpm resolution, TypeScript CLI invocation
  without shell shims.
- **Build semantics:** `build:types` is declaration-only.
- **Audit timestamps:** repeatability compares behavioral outcomes only.
- **CI:** Ubuntu + Windows matrix with pinned Node/pnpm and `--frozen-lockfile`.

## Corrective pass 2 (maintainer findings)

1. **Snapshot integrity.** Replaced the two divergent pipelines with one
   authoritative snapshot model and a single generator. Reviewer files, Git
   identities, diff, oracle subject and application digest now derive from the
   same content; `.git` is excluded; diffs forward/reverse apply; regeneration
   is deterministic. Evidence: `tests/snapshots.ts`.
2. **C2/C4 structure.** C1/C2/C3 share the identical B0 base; C2 uses the
   unchanged `authz.ts` helper; C4's serializer is unchanged from B1 and the
   head only exposes it. Tests prove the serializer is unchanged and AC-4 is
   still violated. Evidence: `tests/wp1.ts`, `tests/snapshots.ts`.
3. **Oracle receipts.** `assertions` and `auditDeltas` are persisted as plain
   JSON, read back from disk, and verified for all eight passes. Canonical
   receipt JSON is deterministic across fresh processes while the 32 HTTP
   requests, 40 assertion-group evaluations and two-pass repeatability are
   preserved. Evidence: `tests/oracle-receipts.ts`.
4. **Fresh-process isolation.** Each candidate pass runs in a fresh OS process
   with a validated stdin/stdout contract and a permission-restricted
   workspace. Ground truth, sealed artifacts, scorer internals, sibling
   candidates and unapproved repo files are unreadable; timeout, abort,
   non-zero exit and malformed output are handled; cleanup runs on every path.
   Evidence: `tests/process-isolation.ts`, `tests/faults-http.ts`.

Materialization safety (dangling links, deep nested links, redirected root,
junctions/reparse points) is preserved and re-verified. No accepted criterion
or truth outcome was altered.

## Stop-condition check

None triggered: `c8da23d` is present in the PR branch; criteria reconstructed;
candidates reproducible; oracle passes agree; all fault controls reject;
reviewer input excludes reference artifacts; candidate execution is isolated;
Git identity verified; no accepted methodology altered.
