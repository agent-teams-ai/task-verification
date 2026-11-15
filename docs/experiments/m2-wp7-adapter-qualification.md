# M2 WP7 — Adapter qualification (model-free)

Status: **PARTIAL**
- Gateway SDK: **QUALIFIED (model-free)** against the exact approved source and a locally packed tarball.
- Managed OCR: **BLOCKED** — the exact approved release asset is not accessible in this environment.

No live model, provider, OCR, Gateway or credential call was made. No package was published.

## 1. Gateway SDK provenance

| Fact | Value |
| --- | --- |
| Package | `@agent-teams/account-gateway` |
| Version | `0.1.0` (`"private": true`, not publishable to a registry) |
| Source repository | `agent-teams-ai/account-gateway` (public) |
| Pinned commit | `539418d5935a9e336d480b128a1cdb93c1daa6e1` (2026-11-11) |
| Declared exports | `.`, `./contracts`, `./http`, `./get-modular`, `./llm` |
| Declared engines | `>=24.21.0 <25 \|\| >=26.10.0 <27` |

The package is private (no registry publication), but its source is public, so the exact pinned
source was cloned and built locally. `private: true` prevents publication; it does not prevent a
local packed install.

### Build and pack

Commands (from the pinned source checkout):

```
pnpm install --frozen-lockfile --filter "@agent-teams/account-gateway..."
pnpm run build            # node scripts/build.mjs -> packages/account-gateway/dist
pnpm --dir packages/account-gateway pack --pack-destination <out>
```

Observed engine warning (recorded, not fatal):

```
WARN Unsupported engine: wanted {"node":">=24.21.0 <25 || >=26.10.0 <27"} (current: {"node":"v24.13.1","pnpm":"9.15.0"})
```

### Packed artifact identity

| Property | Value |
| --- | --- |
| Tarball | `agent-teams-account-gateway-0.1.0.tgz` |
| Size | `54,221` bytes |
| SHA-256 | `dfa8fad3058813d4b0db52f3a05e347c0c8a531286bcbea2183554045e179f00` |
| npm integrity | `sha512-4KRoem4eP1pVDHHy/ElDwoJvzIUY9MtTbAaCarPSg2mT+4I/tq05HHfg3yd+F5tC6S8ECRjtDALRA3/iW2hEtA==` |

The tarball was installed into an isolated project (`npm install <tarball>`), which emitted only
`EBADENGINE` warnings for the local Node `24.13.1` runtime. The package resolved and imported.

## 2. SDK qualification harness

The harness (`scripts/qualify-sdk.mjs`) invokes the **actual exported `/llm` entry**
(`createLlmClient`) with:

- the approved control port (`runAccess`) and execution port (`request`/`status`/`close`) injected;
- a real local loopback fake Responses API server (`http://127.0.0.1:<port>/v1/responses`);
- the exact request body captured by the fake provider before dispatch;
- no real provider, credential or Gateway.

The fake execution port performs a real `fetch` to the loopback server, so response handling,
stream decoding, usage mapping, receipt digesting and readback run through production code.

### Results — 10/10 passed

| Check | Outcome |
| --- | --- |
| Exports and `/llm` entry identity | pass |
| Success: receipt (`requestSha256`, `outputSha256`), usage, cleanup | pass |
| No automatic retry (exactly one provider dispatch) | pass |
| Cancellation before dispatch → `cancelled` / `not_dispatched`, zero dispatch | pass |
| Decode rejection → `output_invalid`, no raw text exposed | pass |
| Duplicate/unknown criterion IDs are a consumer decode concern | pass |
| Malformed SSE → single dispatch, mapped failure | pass |
| Refusal → single dispatch, mapped failure | pass |
| Truncated/incomplete → single dispatch, mapped failure | pass |
| No terminal event → single dispatch, mapped outcome | pass |

Observed SDK failure codes exercised: `output_invalid`, `output_refused`, `output_truncated`,
`provider_failed`, `output_lost`, `effect_unknown`, `cancelled`. In every failure case the fake
provider recorded **exactly one** dispatch; the SDK exposes no raw failure text.

### Scope limits

This qualifies the SDK consumer boundary offline. It does **not** qualify a live model, live
Gateway recovery, provider rate limits or model quality. Those remain D1/D2.

## 3. Managed OCR blocker

| Fact | Value |
| --- | --- |
| Approved release | `ocr-v1.13.1-rr.6` (binary reports `1.13.1-rr.6`) |
| Upstream build input | `alibaba/open-code-review@8eb83340a487b1150af00701b94f01af97e4b4d6` (v1.13.1) |
| Patch/build source | ReviewRouter Action `7a079c382d8e98b426ee90a6b3764be2a21b4c49`; recipe `go1.26.10` |
| Approved Linux/amd64 asset | `80,513,363` bytes; SHA-256 `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c` |

The exact release asset and its source repository are **not accessible** from this environment.

Commands and observed results:

```
gh release view ocr-v1.13.1-rr.6 --repo agent-teams-ai/engineering-research
  -> release not found

gh repo view agent-teams-ai/ReviewRouter --json name,visibility
  -> GraphQL: Could not resolve to a Repository with the name 'agent-teams-ai/ReviewRouter'

gh repo view agent-teams-ai/open-code-review --json name,visibility
  -> GraphQL: Could not resolve to a Repository with the name 'agent-teams-ai/open-code-review'

Get-Command open-code-review / ocr
  -> (not found on PATH)

npm view @agent-teams/account-gateway version
  -> E404 (private package; expected)

# Scoped filesystem search in Downloads, TEMP and the project tree for
# *ocr-v1.13.1* / open-code-review returned no matching asset.
```

### What is needed from the maintainer (Iliya)

To finish WP7 Profile A qualification, provide one of:

1. The exact `ocr-v1.13.1-rr.6` Linux/amd64 release asset (or a private release URL/token), so the
   expected size `80,513,363` bytes and SHA-256
   `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c` can be verified; or
2. Access to the `ReviewRouter` repository/release that publishes it; or
3. The managed binary plus its Action parser modules at the pinned commit.

Until then the managed OCR consumer adapter cannot be exercised against the real binary, and WP7
Profile A remains **BLOCKED**. No substitute binary or fake OCR replacement is used.

## 4. Status

| Work package | Status |
| --- | --- |
| WP7 Gateway SDK (model-free) | QUALIFIED |
| WP7 Managed OCR | BLOCKED (exact artifact inaccessible) |
| **WP7 overall** | **PARTIAL** |