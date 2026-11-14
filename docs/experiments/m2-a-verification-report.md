# M2-A Verification Report (WP0–WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation); code/tests/tooling: Apache 2.0.
**Status:** Implemented, executed, verified; submitted as a separate Draft PR.
**Date:** 2026-11-14

## 1. Latest Milestone 1 PR head SHA and c8da23d inclusion

- PR #1 ("research: add Task Verification Stage A/B experiment plan") is **OPEN, Draft**, base=`main`, head=`research/milestone-1-experiment-plan-2026-11-12`.
- PR head SHA: `c8da23dc0bcd7328937d378e8abc91526764d5ec`
- `c8da23d` **is included**: it is the PR head itself (and the Milestone 1 branch head). Verified via `git ls-remote origin` and `gh pr view 1` (authenticated GitHub CLI).
- `refs/pull/1/head` = `c8da23dc0bcd7328937d378e8abc91526764d5ec`; `refs/pull/1/merge` = `e96c3dabd8c760e678dba17b9753cd0678b9fcc7` (PR still open, unmerged).
- Local `main` = `origin/main` = `12af17867adb84fea17f87825b4e01ea325d36d4`.

## 2. New M2-A branch and exact base

- Branch: `feat/m2-a-foundation-fixture-oracle`
- Base: `c8da23dc0bcd7328937d378e8abc91526764d5ec` (latest verified Milestone 1 PR head, since PR #1 is open and unmerged)
- PR #1 kept unchanged; a separate Draft PR opened with the Milestone 1 branch as its base. Neither PR merged.

## 3. Repository and GitHub identity

- Repository: `https://github.com/agent-teams-ai/task-verification` (owner `hassanbht`)
- Git identity (verified via `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` before every commit):
  `Hassan Behtooei <29015519+hassanbht@users.noreply.github.com>`
- `gh auth status --hostname github.com`: logged in as `hassanbht`, token scopes include `repo`.
- No global Git config modified; no `git -c user.name/email`; no `hassanbehtooei` identity; no force-push.

## 4. WP0 environment results

| Item | Result |
|---|---|
| Node runtime pinned | `24.13.1` (`engines.node`) — verified |
| pnpm pinned | `9.15.0` — verified (`pnpm --version`) |
| Strict TypeScript | `strict: true` in `tsconfig.json` — verified |
| TypeScript pinned | `7.0.2` (org standard: 7.0.2 or newer) — verified |
| Lockfile committed | `pnpm-lock.yaml` — committed, references `typescript` |
| Scripts work | `typecheck`, `build`, `test` all pass — verified |
| `@types/node` | `24.0.0` devDependency — installed |
| Type check | `tsc --noEmit` passes (exit 0) |
| Build | `tsc -p tsconfig.json` passes (exit 0), emits declarations |
| Tests | 36/36 pass via `node --experimental-strip-types --test tests/*.ts` |
| Docs Protocol tooling | Bootstrapped where supported (docs under `docs/experiments/`) |
| Package publication | None (WP0 scope excludes publication) |
| Gateway deployment | None |

## 5. SDK/OCR availability and exact failures

- `@agent-teams/account-gateway` v0.1.0 (commit `539418d…`): **private, not published; no packed archive retrievable**. Documented as unavailable; no fake archive or invented provenance. Not required for the model-free substrate.
- Managed OCR `ocr-v1.13.1-rr.6`: expected SHA-256 `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`, size 80,513,363 bytes (per S7/§3.3). Checked only; not rebuilt from Go source; no live OCR review. Its unavailability does not block WP1/WP2.
- No live model/API calls executed (verified: zero).

## 6. Fixture architecture

Minimal TypeScript HTTP service (`GET /profile`), ~200 lines core source, deterministic, JSON audit sink, fixed initial state, explicit reset, no external dependency, stable responses. See `m2-a-fixture.md`. Behavior driven by `AppBehavior` so all four candidates materialize from one canonical source.

## 7. Four candidate base/head identities and digests

Recorded in `candidates/provenance.json` (disposable sanitized git repos under `.candidates-work/`, gitignored):

| Candidate | Pair | Base tree | Head tree | Head tree digest |
|---|---|---|---|---|
| S1-C1 | B0 → H1 | `eb1d2c285ac6…` | `de21dca3ba5c…` | `6842ca2e9b21…` |
| S1-C2 | B0 → H2 | `eb1d2c285ac6…` | `de21dca3ba5c…` | `6842ca2e9b21…` |
| S1-C3 | B0 → H3 | `eb1d2c285ac6…` | `6ca598f0b305…` | `ce5ee66b47de…` |
| S1-C4 | B1 → H4 | `fedb29ca5a84…` | `c00efb7d7bad…` | `29f3497cde1a…` |

(Full commit SHAs and diffs in `candidates/provenance.json`.)

S1-C4 B1 difference preserved: uses base B1, serializer includes `role`, AC-4 violated, not normalized to B0.

## 8. crit-v1 criterion mapping

AC-1..AC-5 mapped one-to-one to five oracle assertion groups (AC-1..AC-5).
Full text preserved verbatim from the latest plan. See `m2-a-oracle-mapping.md`.

## 9. Oracle request and assertion totals

- 4 HTTP requests per candidate per pass (`P-active-a`, `P-active-b`, `P-missing`, `P-revoked`)
- 4 candidates × 2 passes × 4 requests = **32 HTTP requests**
- 5 assertion groups per candidate per pass × 4 candidates × 2 passes = **40 assertion-group evaluations**
- Not described as six probes; HTTP request count (32) distinct from assertion-group count (40).

## 10. Results of both oracle passes

| Candidate | Pass 1 | Pass 2 | Agree | Overall |
|---|---|---|---|---|
| S1-C1 | pass | pass | ✅ | pass |
| S1-C2 | pass | pass | ✅ | pass |
| S1-C3 | fail (AC-3) | fail (AC-3) | ✅ | fail |
| S1-C4 | fail (AC-4) | fail (AC-4) | ✅ | fail |

Both passes agree for every candidate. Diagnostics preserved for S1-C3/S1-C4; no expected result manually altered.

## 11. All four fault-control results

| Fault | Injected behavior | Affected criterion | Rejected? | Unmodified passes? |
|---|---|---|---|---|
| Wrong caller identity | `P-active-a` id = `wrong-caller` | AC-1 | ✅ Yes | ✅ Yes |
| Denial-field leakage | `P-missing` body includes `role` | AC-4 | ✅ Yes | ✅ Yes |
| Missing audit entry | `P-missing` audit delta empty | AC-5 | ✅ Yes | ✅ Yes |
| Duplicate audit entry | `P-missing` two audit records | AC-5 | ✅ Yes | ✅ Yes |

All four faults rejected on their target criteria; unmodified fixture passes.

## 12. Snapshot reproducibility results

- Candidate tree digests recorded in `MANIFEST.json` and reproduced exactly by tests (`tests/wp1.ts`, all pass).
- Reconstruction from sanitized material tested; each candidate directory is standalone.
- S1-C4 B1 difference confirmed (`serializerIncludesRole: true`).

## 13. Reviewer input-isolation results

- Each materialization includes only the selected candidate's approved files + base/head identities + permitted diff.
- Excludes parent checkout/history, sibling candidates, oracle source/internals, reference answers/ground truth, unrelated branches.
- Profile B (`/llm`) assembled input verified to exclude reference artifacts and oracle outputs (`tests/isolation.ts`, all pass).
- Profile A (managed OCR) boundary prepared but **not** fully qualified — deferred to WP7; not claimed as proven.

## 14. Public reference-artifact policy followed

Public artifacts (fixture definitions, truth, anonymization map, salt, version manifest, receipts) are public and reproducible. They are **excluded from reviewer input/tool reach**; "sealed" ≠ secret. Salt is reproducibility data, not a credential. No private repo, no GitHub Secrets, no private storage. Pilot documented as public and reproducible, not previously unseen.

## 15. Tests executed and exact results

36 tests, 36 pass, 0 fail:

- WP0 (8): runtime version, pnpm version, TS pin, strict TS, lockfile, typecheck, build, (docs tooling configured)
- WP1 (10): fixture startup, request/response, state reset, candidate isolation, B0/B1 identities, H1–H4 reconstruction, tree-digest reproducibility, S1-C4 B1 difference, sanitization/file inventory
- WP2 assertions (12): AC-1..AC-5 pass/fail behavior, fault control rejection, criterion coverage
- Oracle end-to-end (2): 32 requests / 40 assertions, two-pass repeatability
- Reviewer isolation (4): materialization contents, sibling/oracle exclusion, reference-artifact exclusion, parent-checkout non-reference

No unexecuted test is claimed as passed.

## 16. Historical S5/S7 evidence reused

- S5 (model-free evidence bundle): scope — 44 local checks, 14 upstream assertions, 12 loopback requests, 0 model calls; reused only as inspected, unexecuted intent; not re-verified as executed results.
- S7 (exact managed OCR receipts): scope — 10 managed review invocations, 1 version check, 14 loopback fake-provider POSTs, 9 parser assertions, 0 real provider calls; reused for its exact versions and scope (named native/parser behaviors). Reused as compatibility evidence only; does not qualify the full backend/Gateway route or live OCR.
- Neither set qualifies live model quality or the entire OCR/Gateway route.

## 17. Deferred WP3–WP8 items

WP3 canonical `truth-v1.json` packaging, anonymization/version-manifest; WP4 Evidence Packet; WP5 Scorer; WP6 Run Ledger/CT-1–CT-3; WP7 SDK/OCR fake-provider qualification (incl. OCR tool/network boundary); WP8 integrated readiness report. None implemented in M2-A.

## 18. Confirmation of zero live model/API calls

Zero live model/API calls made during M2-A. Verified: no `gh`/model invocations, no live OCR, no real credentials, no Gateway deployment.

## 19. Draft PR URL

Draft PR opened from `feat/m2-a-foundation-fixture-oracle` against `research/milestone-1-experiment-plan-2026-11-12` (the Milestone 1 branch). URL: to be recorded upon PR creation (PR #2).

## 20. Recommended next stage

Proceed to WP3–WP4 (M2-B): canonical `truth-v1.json` packaging, anonymization map, salt, version manifest, Evidence Packet, deterministic baseline, then WP5 Scorer — after WP7 OCR tool/network boundary qualification and live-execution gates (D1/D2) are resolved. Do not begin M2-B automatically; M2-A stops here after submission as a separate Draft PR.

## Stop-condition check

None triggered: c8da23d present in PR branch; criteria reconstructed; candidates reproducible; oracle passes agree; all fault controls reject; reviewer input excludes reference artifacts; git identity verified; no accepted methodology altered.
