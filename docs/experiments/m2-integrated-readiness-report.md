# M2 Integrated Readiness Report (WP0–WP8)

Scope: **model-free**. No live model, inference API, external OCR provider or Gateway call was made.
No credential was used, nothing was spent, published or deployed. Live model evaluation remains
unauthorized (D1/D2).

## 1. Implementation identities

- **M2-A** — foundation, fixture, behavioural oracle (WP0–WP2): 4 candidates (C1–C4), 5 acceptance
  criteria (AC-1..AC-5), 83 tests.
- **M2-B** — Truth-v1, evidence packets, deterministic baseline (WP3–WP4): 51 tests.
- **M2-C** — ResultContract v1, independent scorer, run ledger, deterministic controls (WP5–WP6):
  29 tests (16 WP5 + 13 WP6).

These historical counts are unchanged.

## 2. Authoritative candidate snapshots (WP8 binding)

WP8 no longer builds a synthetic repository, copies candidate sources under `src/`, replaces
`src/app.ts` with a stub, or generates its own diff. Both Profile A and Profile B now consume the
official materialization:

| Candidate | Base | Base tree | Head | Head tree | Head application digest |
| --- | --- | --- | --- | --- | --- |
| S1-C1 | B0 `36eb1135d275…` | `e5960036ffe8…` | H1 `0d9786c0ef3c…` | `3f21da18d0eb…` | `327d0a9690ff70ed…` |
| S1-C2 | B0 `36eb1135d275…` | `e5960036ffe8…` | H2 `3b3ad3880497…` | `f7a8b91f9688…` | `229cd951be05…` |
| S1-C3 | B0 `36eb1135d275…` | `e5960036ffe8…` | H3 `1fda97c2cca6…` | `313c3e4a…` | `4fb700863d2a…` |
| S1-C4 | B1 `d27a2d92d427…` | `9d609f60…` | H4 `e3bed690778b…` | `17288abd…` | `e3700e622872…` |

- Identities are rebuilt from the authoritative file maps with the recorded deterministic Git
  recipe and then verified three ways: against the in-memory maps, against
  `candidates/provenance.json`, and by re-deriving commit/tree/digest/diff **from the repository
  bytes** (`git rev-parse`, `git ls-tree`, `git show`, `git diff`).
- A repository whose head commit is not the official head commit is rejected; a synthetic identity
  is never reported as a candidate identity.
- The reviewer input carries the official base tree, head tree and the exact official
  base-to-head diff; the diff paths are the official root-relative `app.ts`.
- The same Base/Head/Diff identity is passed through materialization → rendered OCR input → binary
  execution → native manifest → ResultContract → persisted readiness artifact, and re-verified after
  readback.

## 3. Profile A — all four candidates on the exact rr.7 binary

Per candidate: authoritative materialization → rendered reviewer input (≤ 8,000 characters, complete
task and all five criteria) → exact `ocr-v1.13.1-rr.7` binary → captured request at the fake provider
→ native output and manifest (with `resolved_base`/`resolved_head` equal to the official commits) →
pinned parser → pinned normalizer → native/normalized/skipped/dropped findings kept separately →
Profile A ResultContract (`assessments: []`, `satisfaction: not-applicable`) → Truth file SHA-256
(not a packet id) → byte-verified ArtifactRegistry → Profile A scoring → ledger lifecycle → Profile A
admission → persisted readiness artifact → readback with digest and identity verification.

**Fixed injected protocol responses.** The provider replies are fixed injected content used to
qualify the adapter, parser, normalizer, registry and admission path. They do not measure reviewer
reasoning or model quality. Each persisted artifact records
`providerMode: "fixed-injected-protocol-response"` and `modelQualityMeasured: false`.

## 4. Profile B — all four candidates through the exact packed SDK

For every candidate: authoritative snapshot → approved materialization and assembled Profile B input
→ the installed `@agent-teams/account-gateway@0.1.0` tarball → real `createLlmClient()` on the
`/llm` entry → loopback fake Responses provider → captured request/response → ResultContract
validation → original `ReportedClaimAccounting` → mechanical reference resolution against the
byte-verified registry → evidence sufficiency → persisted ledger lifecycle → shared consumer
admission → readiness artifact persisted, read back and digest-verified.

All four candidates: 1 dispatch, 1 persisted request identity before dispatch, `cleanup=closed`,
`receipt.requestSha256` equal to the bytes the provider received, 3 ledger events, admission
`admitted`.

## 5. Reference qualification and consumer admission

The empty `{ artifacts: {} }` registry is gone. A real registry is built from the authoritative head
snapshot bytes:

- every allowlisted application file is registered with a digest **recomputed from its bytes**;
- every entry is re-verified against the bytes and against the expected candidate and snapshot;
- entries are accepted only when the path is allowlisted, the digest matches, the entry is bound to
  the current candidate and snapshot, and it is an allowed, current, applicable source.

Positive controls: valid current C3 reference (AC-3, `app.ts`) and valid current C4 reference
(AC-4, `serializer.ts`) — both admitted, both supported detections.

Negative controls, all rejected with an explicit reason: wrong candidate, wrong snapshot, missing
reference, incorrect digest, stale (`current: false`), inapplicable (`applicable: false`), path
outside the allowlist, partial/contradictory semantic support, unsupported finding, unmapped
finding, out-of-scope finding, skipped finding.

A finding is **never** counted as a supported detection merely because Truth says the criterion is
violated. C1/C2/C4 map admissible-looking findings onto truth-satisfied criteria and produce **zero**
supported detections (they are false allegations); only C3's AC-3 finding, which clears mechanical
resolution, digest verification, binding, applicability and semantic support, is a supported
detection.

For Profile A no criterion verdict is fabricated: `admittedCriterionIds` is always empty. Admission
is represented as (a) review-execution admission and (b) per-finding admission, both derived from the
real scorer output and the verified registry. The persisted `AdmissionDecision` reads back unchanged.

## 6. Test totals (separate suites, not summed)

| # | Suite | Command | Platform | Result |
| --- | --- | --- | --- | --- |
| 1 | Main regression suite | `node --experimental-strip-types --test --test-concurrency=1 tests/*.ts` | win32/x64, Node 24.13.1 | **259 / 259 pass**, 0 fail, 0 skip |
| 2 | rr.7 WP7 suite | `OCR_RR7_DIR=/rr7 node --experimental-transform-types --test tests/rr7/wp7-rr7.test.ts` | Ubuntu 24.04 container, Node 24.13.1 | **16 / 16 pass** |
| 3 | WP8-A integrated Profile A | `OCR_RR7_DIR=/rr7 … tests/rr7/wp8-profile-a.test.ts` | Ubuntu 24.04 container, Node 24.13.1 | **4 / 4 pass** (C1–C4 + 2 identity negatives) |
| 4 | SDK qualification | `SDK_PROJECT_DIR=<isolated> node scripts/qualify-sdk.mjs` | win32/x64, Node 24.21.0 | **20 / 20 pass** |
| 5 | WP8-B integrated Profile B | `SDK_PROJECT_DIR=<isolated> node --experimental-strip-types scripts/qualify-profile-b.mjs` | win32/x64, Node 24.21.0 | **4 / 4 candidates admitted** |

Historical records preserved: main suite was 242/242; rr.7 suites were 18/18 (16 WP7 + 2 WP8-A). The
main suite gained 17 tests (authoritative snapshot, registry and admission controls), and the WP8-A
suite grew from 2 to 4 tests. The suites above are counted independently.

### Runtimes

| Purpose | Node | pnpm |
| --- | --- | --- |
| M2-A base test runtime (unchanged) | 24.13.1 | 9.15.0 |
| rr.7 qualification runtime | 24.13.1 | 9.15.0 |
| SDK qualification runtime | 24.21.0 | 11.28.2 |

The M2-A pin was not changed to satisfy the SDK engine range.

## 7. Provenance pins

| Artifact | Identity |
| --- | --- |
| Gateway SDK source | `agent-teams-ai/account-gateway@539418d5935a9e336d480b128a1cdb93c1daa6e1` (tree `608b577e2da6…`) |
| Gateway SDK tarball | 54,221 bytes, SHA-256 `dfa8fad3…9f00`, integrity `sha512-4KRoem4e…EtA==` (reproduced byte for byte) |
| Active OCR pin | `ocr-v1.13.1-rr.7`, 80,513,021 bytes, SHA-256 `2f290fb4…4aaa29` |
| Historical OCR pin | `ocr-v1.13.1-rr.6`, 80,513,363 bytes, SHA-256 `9dd5f115…d101ee5c` (preserved) |
| Parser/normalizer | `777genius/review-router@7a079c382d8e98b426ee90a6b3764be2a21b4c49` (blobs `5ba2ba5d…`, `43bcfa54…`, unchanged) |

Manifests: `docs/experiments/m2-sdk-qualification.manifest.json`,
`docs/experiments/m2-rr7-artifact.manifest.json`.

## 8. Status

| Item | Status |
| --- | --- |
| WP7 SDK qualification (fresh reproduction, supported runtime) | **COMPLETE** |
| WP7 rr.7 release + M2 qualification | **COMPLETE** for the defined over-claim-safe case set |
| WP8-A Profile A (C1–C4, authoritative snapshots, real references, real admission) | **COMPLETE** |
| WP8-B Profile B (C1–C4, exact packed SDK) | **COMPLETE** |
| Live model evaluation | **NOT STARTED** (unauthorized) |
| D1 live inference authorization | **PENDING** |
| D2 live evaluation budget | **PENDING** |

## 9. Known limitations

- Fake providers and fixed injected replies only; no model-quality claim is made.
- Production Gateway recovery, provider rate limits, billing behaviour and capacity are not tested.
- The rr.7 binary is Linux/amd64 only; its suites run on Ubuntu 24.04. Windows exercises the shared
  substrate, registry and admission logic, not the OCR binary.
- The `--network none` container plus an allowlisted child environment is the recorded network
  boundary; the binary's own egress is traced, but this is not an OS-level sandbox claim.

## 10. Zero live calls

- No live model/API/OCR/Gateway call.
- No credential loaded; the qualification refuses to run if a provider credential is present.
- No package publication, no deployment, no spending.
