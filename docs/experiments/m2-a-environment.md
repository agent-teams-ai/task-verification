# M2-A Environment and Toolchain Foundation (WP0)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (research/experiment documentation).
**Status:** Implemented, executed, verified.

## Summary

WP0 establishes a minimal, deterministic, reproducible TypeScript development
environment for the model-free experimental substrate. No live model calls,
no package publication, no Gateway deployment, no OCR rebuild.

## Pinned toolchain

| Artifact | Pinned value | How verified |
|---|---|---|
| Node.js runtime | `24.13.1` | `process.versions.node` (test `tests/wp0.ts`) |
| pnpm | `9.15.0` | `pnpm --version` (global install via npm; test `tests/wp0.ts`) |
| TypeScript | `7.0.2` | `devDependencies.typescript` (org standard: strict TS 7.0.2 or newer) |
| `@types/node` | `24.0.0` | devDependency, for Node type declarations |
| Strict TypeScript | `strict: true` | `tsconfig.json` `compilerOptions.strict` |
| Lockfile | `pnpm-lock.yaml` | committed; references `typescript` |

`package.json` `engines`: `node 24.13.1`, `pnpm 9.15.0`. `"type": "module"`.

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `typecheck` | `tsc --noEmit -p tsconfig.json` | strict type check |
| `build` | `tsc -p tsconfig.json` | emit declarations (`emitDeclarationOnly`) |
| `test` | `node --experimental-strip-types --test tests/*.ts` | run all model-free tests |

Tests: 36/36 pass (WP0 ×8, WP1 ×10, WP2 ×12, oracle end-to-end ×2, reviewer isolation ×4).

## tsconfig highlights

`target ES2022`, `module Node16`, `moduleResolution Node16`, `strict true`,
`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`noImplicitReturns`, `skipLibCheck`, `resolveJsonModule`, `allowImportingTsExtensions`,
`emitDeclarationOnly`, `types: ["node"]`.

## Artifact availability (WP0 acceptance)

**Private Gateway SDK `@agent-teams/account-gateway` v0.1.0** (source commit
`539418d5935a9e336d480b128a1cdb93c1daa6e1`, tree `608b577e2da6…`):
private package (`"private": true`), not published. No exact packed archive was
retrievable in this environment; no fake archive was created and no provenance
was invented. Per the plan, this is documented as unavailable rather than
simulated. It is not required for the model-free substrate.

**Managed OCR artifact `ocr-v1.13.1-rr.6`**: expected SHA-256
`9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`,
expected size 80,513,363 bytes (per §3.3 / S7). Availability and checksum
were checked only; the asset was not rebuilt from Go source and no live OCR
review was executed. Its unavailability does not block WP1/WP2.

## What was deliberately NOT done (WP0 scope)

- No package publication.
- No Gateway deployment.
- No OCR rebuild.
- No `get-modular` addition (no design requirement).
- No duplication of organizational standards beyond the pinned strict TS tooling.

## Platform-specific limitations

- Windows PowerShell: `pnpm` installed globally via `npm install -g pnpm@9.15.0`;
  `corepack enable` was not permitted (EPERM on the Node installation
  directory), so pnpm was installed through npm instead.
- TypeScript `7.0.2` from the organization registry is used as the maintained
  strict TS per the org standard; `allowImportingTsExtensions` is enabled so
  `.ts` import specifiers resolve under both `tsc` and Node's type stripper.
