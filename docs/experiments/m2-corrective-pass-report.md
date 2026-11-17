# M2 Corrective Pass (2026-11-17)

Scope: the six correctness defects reproduced by the maintainer plus two clarifications, on
`feat/m2-a-foundation-fixture-oracle` (PR #2, kept open and in Draft). Model-free only: no live
model, provider, OCR or Gateway call, no credentials, no deployment, no spending. D1/D2 remain
unauthorized.

The frozen Truth was not altered to make anything pass. `truth/truth-v1.json` outcomes and the
C1–C3 identities are byte-identical to the previous revision; the only truth-file change is the C4
**binding** digest, forced by defect 6 (see §3).

## 1. Defects, root causes and fixes

| # | Defect | Root cause | Fix | Regression tests |
| --- | --- | --- | --- | --- |
| 1 | `not satisfied` was scored as satisfied | `parseReportedClaim` matched the affirmative token before negation, so any string containing "satisfied" resolved to `satisfied`; `partially satisfied` did the same | Negation-first precedence in `src/scorer.ts`: `not satisfied`/`unsatisfied`/`not met` → `violated`; `partially satisfied`/`partly`/`partial` → `unknown`; provider wording preserved verbatim | `wp8-corrective` "conservative claim parsing…", "'not satisfied' is accounted as a violation…" |
| 2 | A reference rubric supported a claim it was not graded for, and a reference-level decision could become a criterion decision | Rubrics were keyed by reference alone (`referenceRubrics`), so support was global across claims, and a reference-only decision was promoted to the criterion level | Support now resolves per `claimSupportKey(criterionId, reference)` via `claimRubrics`/`lookupClaimSupport`; a reference-only decision is **refused**, never transferred; conclusions without references set `referencesSufficient=false` | "a shared reference supports only the claim it was graded for", "a reference-level rubric is never transferred to a claim", "two claim-scoped rubrics…", "a conclusion without references is not admitted" |
| 3 | Criteria changes were invisible when the revision label was unchanged | Binding used `authoredCriteriaRevision`, a human label, as if it identified content | `src/criteria.ts` computes `criteriaContentDigest` from canonical JSON (`authoredCriteriaRevision` stays a separate label). Scorer exposes `expectedCriteriaContentDigest`; `AssessmentBinding.criteriaTextDigest` drives `criteriaContentMatch` in admission; Profile A records per-finding and result `criteriaContentBound`, so a stale finding cannot be admitted or supported | "criteriaTextDigest is derived from content, not from the revision label", "…produced against changed criteria content is stale and not admitted", "shared consumer admission rejects a stale criteria content digest", "criteria digest rejects duplicate or empty content" |
| 4 | Attempt lifecycle was asserted, not observed: verify ran after dispatch and records lived in memory | `planned`/`started` were written to a local structure; the ledger and lifecycle could look successful after a dispatch that never happened | `src/attempt-persistence.ts` persists `planned` → `started` to disk, `verifyAttemptAtDispatch` reads the record back at the dispatch boundary (wired through the new `beforeDispatch` hook in `src/adapters.ts` and `src/ocr-profile-a.ts`) and blocks on identity mismatch, and terminal states are persisted for success, failure, cancellation and interruption | "planned and started records persist to disk before dispatch", "a dispatch-boundary identity mismatch blocks the dispatch", "failure before dispatch leaves no successful-looking lifecycle", "a failed dispatch is retained as a terminal failure", "an interrupted attempt survives a restart…", "a cancelled attempt is retained as cancelled" |
| 5 | Profile B never received the full reviewer input, and decoding dropped valid data | `ProfileBInput` carried no background/rules/changed-file/unchanged-dependency context; the decoder treated a malformed record as a failed inventory and rewrote provider-supplied references | `src/materialization.ts` gains `background`, `rules`, `changedFiles`, `unchangedDependencies`, `PROFILE_B_OUTPUT_SCHEMA`, `changedPathsFromDiff` and `renderProfileBRequestInput`; `src/profile-b-decode.ts` decodes record by record, preserving provider references and explanations verbatim and reporting duplicates, unknown IDs, missing references and missing explanations as diagnostics. `scripts/qualify-profile-b.mjs` parses the captured provider payload field by field before accepting it | "the Profile B request carries every file, criterion, task, rule and scope field", "changed-path assignment comes from the diff and is not widened", "a fully valid provider reply is preserved verbatim", "one malformed record does not discard the valid records", "missing references and missing explanations are diagnosed, not invented", "invalid provider references are preserved and rejected by resolution", "duplicate and unknown criterion identifiers are reported, not merged", "partial JSON yields diagnostics and no invented records", "provider references and explanations round-trip exactly" |
| 6 | The C4 candidate explained its own injected defect | A comment in `fixture/src/serializer-b1.ts` described the defect the oracle was supposed to find | Comment removed; C1–C4 candidates and provenance regenerated from the sanitized fixture. Behaviour is unchanged: the diff is still `app.ts` only, and the C4 outcomes are identical | Candidate regeneration asserted by `tests/` snapshot identity; see §3 |

### Clarifications

- **Reference-level rubrics are deprecated, not silently upgraded.** `referenceRubrics` still
  parses, but support is resolved per claim; a reference-level decision is refused rather than
  applied to the criterion. This is a resolution rule, not a schema deletion.
- **Sanitation changes a binding, not an expectation.** Removing the comment changed the C4 head
  tree, so the C4 binding digest had to be updated. The expected outcomes were not touched.

## 2. C4 sanitation reconciliation

| Item | After sanitation |
| --- | --- |
| Base commit / tree | `97b9f5f97ad4` / `22b92389dd2c` |
| Head commit / tree | `3f25ac8032ef` / `4b53b1f319e2` |
| Head content digest | `97969adc5248…` (was `8f5f2ab0…`) |
| Changed files | `app.ts` only, as before |
| C1–C3 candidate identities | unchanged (`e5960036…` base for all three) |
| `truth-v1.json` C4 outcomes | unchanged |

`truth/version-manifest.json` records the refreshed C4 binding next to the untouched outcomes.

## 3. Measured evidence

Each command below was run in this pass; suites are counted independently and never summed.

| Suite | Command | Platform | Result |
| --- | --- | --- | --- |
| Main regression | `node --experimental-strip-types --test --test-concurrency=1 tests/*.ts` | win32/x64, Node 24.13.1 | **284 / 284 pass**, 0 fail |
| Typecheck | `pnpm run typecheck` and `npx tsc --noEmit -p tsconfig.rr7.json` | win32/x64 | clean |
| rr.7 WP7 | `OCR_RR7_DIR=/rr7 node --experimental-transform-types --test --test-concurrency=1 tests/rr7/wp7-rr7.test.ts` | Ubuntu 24.04 container `m2-rr7`, `--network none` | **16 / 16 pass** |
| WP8-A Profile A | `OCR_RR7_DIR=/rr7 … tests/rr7/wp8-profile-a.test.ts` | same container | **6 / 6 pass** |
| WP8-B Profile B | `SDK_PROJECT_DIR=<isolated> node --experimental-strip-types scripts/qualify-profile-b.mjs` | win32/x64, Node 24.21.0 | **4 / 4 admitted**, `inputComplete=true`, `refsPreserved=true` |
| SDK qualification | `SDK_PROJECT_DIR=<isolated> node scripts/qualify-sdk.mjs` | win32/x64, Node 24.21.0 | **20 / 20 pass** |

The Profile B run recorded, per candidate: the ledger was written before dispatch, every file,
criterion, rule and scope field was present in the captured provider request, provider references
and explanations round-tripped, and the per-candidate finding counts were C3 1/1, C1 0/1, C2 0/1,
C4 0/0 with false-satisfied and false-violated both recorded.

### WP8-A coverage added in this pass

- A **real native `file_read`** of an unchanged dependency (`audit.ts`): the fake provider asks the
  binary to read it, and the assertion checks the real file content arrives in a later request. This
  replaced an assumption that unchanged files are pre-sent — they are not; they are read on demand.
- An **out-of-scope read** (`../outside-secret.ts`, `/etc/passwd`) through the same native tool. The
  request is recorded, but no out-of-scope content (sentinel, `root:x:0`) reaches the provider or the
  native result, and no out-of-scope file block is delivered.

### Local versus hosted

The results above are **local** runs on the maintainer workstation (Windows host; Ubuntu 24.04
container for the rr.7 suites). Hosted CI is a different execution: it downloads the release asset
and verifies size/SHA-256/`--version` on `ubuntu-24.04`, then runs the same suites and uploads
`wp8a-evidence` and `wp8b-evidence`. A green local run is not a green CI run; both are reported.

## 4. Known limitations

- Fake providers and fixed injected replies only. No model-quality, reasoning or latency claim.
- The rr.7 binary is Linux/amd64 only; Windows exercises the shared substrate, registry and
  admission logic, not the binary.
- `--network none` plus an allowlisted child environment is the recorded boundary; the binary's own
  egress is traced, but this is not an OS-level sandbox claim.
- No live provider, Gateway, OCR model, spend or deployment is exercised anywhere in this pass.
