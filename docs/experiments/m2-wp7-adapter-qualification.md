# M2 WP7 — Adapter qualification (model-free)

Status: **COMPLETE (model-free scope)**

| Component | Status |
| --- | --- |
| Gateway SDK `@agent-teams/account-gateway` v0.1.0 | **QUALIFIED**, freshly reproduced from source and re-qualified under its supported runtime |
| Managed OCR `ocr-v1.13.1-rr.7` | **QUALIFIED** (release-level and M2-specific) |
| Model quality / live provider behaviour | **NOT EVALUATED** — unauthorized (D1/D2) |

No live model, provider, OCR, Gateway or credential call was made. No package was published and
nothing was deployed.

## 1. Gateway SDK provenance

| Fact | Value |
| --- | --- |
| Package | `@agent-teams/account-gateway` |
| Version | `0.1.0` (`"private": true`, not publishable to a registry) |
| Source repository | `https://github.com/agent-teams-ai/account-gateway` (public) |
| Pinned commit | `539418d5935a9e336d480b128a1cdb93c1daa6e1` (2026-11-11) |
| Source tree | `608b577e2da608b09d77ca2cf19661a82543185c` |
| Declared exports | `.`, `./contracts`, `./http`, `./get-modular`, `./llm` |
| Declared engines | `>=24.21.0 <25 \|\| >=26.10.0 <27` |
| Build command | `node scripts/build.mjs` (root workspace script; `tsc -p tsconfig.build.json`) |
| Pack command | `pnpm --dir packages/account-gateway pack --pack-destination <out>` |

`private: true` prevents registry publication; it does not prevent installing a locally packed
tarball.

### Correction of the earlier "source unavailable" conclusion

An earlier report concluded that the source repository and the local tarball were unavailable in
the environment. **That conclusion was incorrect and is superseded.** The repository is public, the
pinned commit is reachable, and its tree is exactly the tree recorded in the M1 plan. The earlier
statement is preserved here only as history; it is not a rerun and not evidence.

### Fresh reproduction (this qualification)

Performed with **Node `v24.21.0`** and **pnpm `11.28.2`** (the SDK's declared engine range), kept
separate from the M2-A base runtime (`24.13.1` / pnpm `9.15.0`), which is unchanged.

```
git clone https://github.com/agent-teams-ai/account-gateway.git
git checkout 539418d5935a9e336d480b128a1cdb93c1daa6e1     # tree 608b577e2da6…
pnpm@11.28.2 install --frozen-lockfile
node scripts/build.mjs
pnpm@11.28.2 --dir packages/account-gateway pack --pack-destination <out>
npm install <out>/agent-teams-account-gateway-0.1.0.tgz   # isolated qualification project
```

### Packed artifact identity — reproduced exactly

| Property | Approved value | Fresh reproduction (Windows) | Result |
| --- | --- | --- | --- |
| Tarball | `agent-teams-account-gateway-0.1.0.tgz` | same name | match |
| Size | `54,221` bytes | `54,221` bytes | **match** |
| SHA-256 | `dfa8fad3058813d4b0db52f3a05e347c0c8a531286bcbea2183554045e179f00` | identical | **match** |
| npm integrity | `sha512-4KRoem4eP1pVDHHy/ElDwoJvzIUY9MtTbAaCarPSg2mT+4I/tq05HHfg3yd+F5tC6S8ECRjtDALRA3/iW2hEtA==` | identical | **match** |

### One platform-byte investigation (documented, not silently replaced)

Rebuilding the same source on Linux with the default `core.autocrlf=false` produced
`54,109` bytes, and with `core.autocrlf=true` `54,221` bytes, but the SHA-256 did not match the
approved pin. Cause, established byte by byte:

- the approved tarball was packed from a checkout with **CRLF working-tree files**
  (`core.autocrlf=true`), which is why the un-normalised Linux checkout is 112 bytes smaller;
- at `core.autocrlf=true` the two tarballs have the **same size, an identical tar stream and
  byte-identical extracted content** (`diff -r` is empty; `tar -tvzf` listings match on mode, owner,
  size and normalised mtime);
- exactly **one byte** differs, at offset 9 — the gzip `OS` field (`0x0a` NTFS on Windows,
  `0x03` Unix on Linux).

Normalising that single byte reproduces the approved pin exactly:

```
linux  sha256            dd828049d12dac9bd37c492e639561733641047b90aca281a3c5b47f011e8c13
normalised (OS=0x0a)     dfa8fad3058813d4b0db52f3a05e347c0c8a531286bcbea2183554045e179f00
approved pin             dfa8fad3058813d4b0db52f3a05e347c0c8a531286bcbea2183554045e179f00
```

No approved value is replaced. CI reproduces the approved content (`core.autocrlf=true`, pinned
commit) and `scripts/verify-sdk-tarball.mjs` accepts the tarball only when the size matches and the
SHA-256 matches either raw or after normalising the gzip `OS` byte; any content or structural change
fails the check. The tarball is never published.

## 2. SDK qualification harness

`scripts/qualify-sdk.mjs` resolves `@agent-teams/account-gateway/llm` through the installed
package's `exports` map from `SDK_PROJECT_DIR` and invokes the **actual exported**
`createLlmClient()` — the real `/llm` entry point, not a generic `fetch()` stand-in. It injects the
control port (`runAccess`) and the execution port (`request`/`status`/`close`), and the execution
port performs a real `fetch` to a loopback fake Responses API (`http://127.0.0.1:<port>/v1/responses`),
so request encoding, stream decoding, usage mapping, receipt digesting and readback all run through
production SDK code.

Request identity is **appended to a file inside `runAccess`, before the transport port exists**, and
the ordering of `access` → `dispatch` is recorded and asserted.

### Fresh results — 20/20 passed under Node v24.21.0

| # | Scenario | Observed |
| --- | --- | --- |
| 1 | Successful bounded generation | `ok`, `cleanup=closed`, receipt `requestSha256`/`outputSha256`, usage 11/7 |
| 2 | Actual request body received by the loopback server | `model`, `stream=true`, `store=false`, `service_tier=default`, `max_output_tokens`, instructions, input text, `json_schema` format `codex_output_schema`, schema unchanged, no `reasoning` without an explicit effort |
| 3 | Request identity persisted before transport dispatch | identity file written in `runAccess`; `access.at <= dispatch.at` |
| 4 | Missing criterion IDs | rejected by consumer decode → `output_invalid`, effect `completed`, no raw text |
| 5 | Duplicate criterion IDs | `output_invalid` |
| 6 | Unknown criterion IDs | `output_invalid` |
| 7 | Partial valid records | accepted as a real partial result (2 records), nothing invented |
| 8 | Malformed JSON | `provider_failed` / `response_started`, exactly one dispatch |
| 9 | Truncated response | `output_truncated` |
| 10 | Refusal | `output_refused`, `retry.kind=never` |
| 11 | Unknown SDK effect | `effect_unknown` / `effect_unknown`, `mayDuplicateCost=true` (advice only) |
| 12 | Timeout | deadline expiry → code `deadline` |
| 13 | Cancellation | pre-dispatch `cancelled`/`not_dispatched` with zero dispatch; mid-flight abort → `cancelled`, one dispatch |
| 14 | Pending cleanup | unacknowledged close → `cleanup=pending` |
| 15 | Raw-unavailable state | failure carries no `text`/`value`; pre-dispatch failure carries no usage; success exposes text whose SHA-256 equals `receipt.outputSha256` |
| 16 | Readback mapping | lost stream classified from `status` readback → `output_lost` / `completed` |
| 17 | Configured caps | over-limit `maxOutputTokens`, deadline (too far / past), `outputBytes`, `attempt`, empty `accountRefs` → `invalid_task`/`not_dispatched`, no dispatch |
| 18 | No automatic inference retry | malformed, truncated and refusal modes each produce exactly one dispatch |
| 19 | No fallback/replay consuming another attempt | inference failures never advise `same_attempt`; identity stays `…-a3-r`; one dispatch |

Evidence is persisted as JSON (`SDK_QUALIFICATION_OUT`, default `sdk-qualification.json`) including
the installed entry path, package identity, per-scenario evidence and the environment block
(`liveProviderCalls: 0`, `credentialVariables: 0`, `published: false`, `loopbackOnly: true`).

### Scope limits

This qualifies the SDK consumer boundary offline. It does **not** qualify a live model, live Gateway
recovery, provider rate limits or model quality. Those remain D1/D2.

## 3. Managed OCR — rr.7 (owner-approved active pin)

Historical rr.6 provenance is preserved unchanged (release `ocr-v1.13.1-rr.6`,
size `80,513,363`, SHA-256 `9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c`,
Go 1.26.10). The active M2 pin is now `ocr-v1.13.1-rr.7`.

| Fact | Value |
| --- | --- |
| Approved release | `ocr-v1.13.1-rr.7` (binary reports `1.13.1-rr.7`) |
| Source repository | `agent-teams-ai/open-code-review` |
| Full source commit | `997293d17d2d4db08c942ecdd4d6fe0af91811a9` |
| Source tree | `8e19c7b5ecd86c7bd696aa088455bdbe6e563bf8` |
| Upstream base | `alibaba/open-code-review@8eb83340a487b1150af00701b94f01af97e4b4d6` (v1.13.1) |
| Toolchain | Go 1.26.11 (`go1.26.11`, CGO_ENABLED=0, goamd64=v1) |
| Build flags | `-trimpath -buildvcs=false -ldflags=-s -w` |
| Approved Linux/amd64 asset | `80,513,021` bytes; SHA-256 `2f290fb407a5cb6fbe854cb6702b8c713325fce603a71c1be83f5284034aaa29` |
| Parser/normalizer pin (unchanged) | `777genius/review-router@7a079c382d8e98b426ee90a6b3764be2a21b4c49` |
| Parser blob | `5ba2ba5ddfe52c93b0dc7d7514b1e0a3d7047698` |
| Normalizer blob | `43bcfa54ee3dedd50a18e2d8e8f9aaf5cd5a0a42` |

The asset, `MANIFEST` and `qualification.json` are retrieved and verified in CI (size, SHA-256 and
`--version`), and the binary runs on Ubuntu 24.04 (Linux/amd64) only, against a loopback fake
provider with an allowlisted child environment.

- **Release-level qualification** (the upstream four model-free cases) is recorded in
  `qualification.json` and asserted by `tests/rr7/wp7-rr7.test.ts`.
- **M2-specific qualification** (rendered M2 reviewer input ≤ 8,000 characters, pinned parser and
  normalizer, partial-group behaviour, cancellation, egress trace) runs in the same suite.

## 4. Status

| Work package | Status |
| --- | --- |
| WP7 Gateway SDK (model-free) | **QUALIFIED** — freshly reproduced and re-qualified |
| WP7 Managed OCR (rr.7) | **QUALIFIED** (model-free, loopback fake provider) |
| WP8 Profile A (rr.7) | **QUALIFIED** for all four candidates on authoritative snapshots |
| WP8 Profile B (packed SDK) | **QUALIFIED** for all four candidates through the exact tarball |
| WP7/WP8 overall | **COMPLETE (model-free scope)** |

No substitute binary or fake OCR replacement is used. Fixed injected provider responses qualify the
protocol/adapter/accounting path; they do not measure reviewer reasoning or model quality.
