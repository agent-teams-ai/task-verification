# Targeted corrective-pass evidence (2026-11-18, updated 2026-11-20)

Evidence for the maintainer-reported counterexamples at `268d4ba` and for the focused Profile A
contradiction correction. **Real rr.7 OCR binary with a fake model provider**: the native runs use the
pinned rr.7 binary against the in-repo loopback fake provider, offline. No live model, hosted OCR
gateway or credential is involved, and nothing was deployed or spent. The binary is real; the model
behind it is not.

| File | What it records | Regenerate with |
| --- | --- | --- |
| `repro-profile-a-finding-collision.json` | The maintainer's Profile A reproduction: two raw findings sharing external id `f-1` (AC-1 unsupported/contradicts, AC-3 supported/matches), each scored occurrence, the admission decision per occurrence, and the single supported detection. | the generator script |
| `repro-profile-a-explicit-contradiction.json` | The paired Profile A contradiction case. **Case A**: reference `app.ts` supports AC-3 and reference `serializer.ts` is neutral → `supported`, admitted, supported detection. **Case B**: identical inputs, `serializer.ts` carries `contradictsClaim: true` → `evidenceConflict`, `semanticSupport: unsupported`, `evidence-conflict` gate, not admitted, no supported detection. An unrelated AC-1 finding is unchanged in both halves. | the generator script |
| `repro-profile-b-conflicting-duplicate.json` | The maintainer's exact Profile B reproduction: six raw provider records — five ordinary expected assessments (one each for AC-1…AC-5) plus a sixth AC-3 record that contradicts the first AC-3 claim. Records the decoder's conflict group, the contract coverage, all six claim decisions (two AC-3 rejected, AC-1/AC-2/AC-4/AC-5 admitted individually), the original reported-claim accounting and the aggregate outcome (rejected). | the generator script |
| `native-tool-transcript.jsonl` | The rr.7 `file_read` transcript with observed-call/observed-result/request-inclusion states, observed content digests and separately reported expected snapshot digests. | the WP8-A suite |
| `native-tool-payloads-unchanged-dependency-read.json` | **The actual payload**: the exact `function_call` arguments and `function_call_output` text for the `audit.ts` read, with call identity, the captured request that carried both (index and body digest), the parsed file-read content and its digest, and the expected-snapshot digest as a **separate** field. | the WP8-A suite |
| `native-tool-payloads-out-of-scope-read.json` | The same for both refused reads (`../outside-secret.ts`, `/etc/passwd`): the exact denial text the native tool returned, with `parsedFileRead: null` and no repository content. | the WP8-A suite |
| `native-tool-chain-unchanged-dependency-read.json` | The captured provider request chain behind the verified `audit.ts` read: per-request body digests and the call/result item identities. | the WP8-A suite |
| `native-tool-chain-out-of-scope-read.json` | The same chain for the denied out-of-scope reads. | the WP8-A suite |
| `pr349-development-case-sources.json` | PR #349 requirement-source and immutable pre-fix candidate identities (commits, trees, blobs, sha256, changed paths). | the generator script |
| `pr349-memory-delivery-probe.json` | The deterministic memory-delivery probe summary: pre-fix `content` rule key vs post-fix `rule` key, with the sentinel observed in 0 of 2 and 2 of 2 captured requests respectively. **Labelled `reported-summary-not-raw-request-evidence`** — a summary of a prior execution, not a captured raw request. | the generator script |
| `MANIFEST.json` | Per-file byte count and SHA-256 of every file above, verified against the bytes on disk when generated. | the generator script |

## Native tool payload retention

The transcript and chain files establish *correlation*: they prove a call was observed, a result with
that call identity was observed, and a captured request carried both. They do not let a reader inspect
what the tool returned, because they retain digests rather than bytes. The `native-tool-payloads-*.json`
files close that gap:

- **Retained:** the exact `arguments` string of each `function_call`, the exact `function_call_output`
  text, the call identity and tool name, the requested path and its classification, the index and
  SHA-256 of the captured request that carried both, the parsed file-read content with its own digest,
  and the run/candidate/snapshot identity.
- **Not synthesized:** nothing is reconstructed from the expected snapshot. `expectedSnapshotContentSha256`
  is a separate field, and a call with no observed result is recorded as `result: null` with an
  `unresolvedReason` rather than being filled in. `source` is fixed to
  `captured-fake-provider-request-items`.
- **Not claimed:** these payloads are the output of the real rr.7 binary driven by fixed injected
  provider replies. They say nothing about a live model's behaviour, comprehension or quality.

## Provenance of the native files

The committed transcript, chain and payload files are the **exact bytes** produced by hosted CI run
`44816538987` (push event, head `fb80001cb1422feca839fe4e7939fa9b96ae9269`, `ubuntu-latest`, WP8-A 6/6),
downloaded from the `wp8a-evidence` artifact and copied here unchanged. All five files therefore belong
to one run: runIds and per-request digests are internally consistent, and the transcript's digests match
the payload digests. Re-running the suite locally or in CI produces new runIds and new digests; the
authoritative copy for any given head is that head's CI artifact.

## Regeneration

```bash
node --experimental-strip-types scripts/retain-targeted-corrective-evidence.mjs
```

The script rebuilds the three reproductions from the same public modules the tests use, copies the
native transcript/chain/payload files when present in `.isolation-tmp/wp8a-evidence/S1-C3/`, writes
`MANIFEST.json` from the files on disk, and then verifies every manifest entry against those bytes —
failing on any stale size or digest instead of writing a manifest that disagrees with the archive.

Test coverage for these artefacts lives in:

- `tests/m2-corrective-repro.ts` (exact reproductions incl. the paired contradiction case, 23 tests)
- `tests/m2-gate-matrix.ts` (per-gate positive/negative/aggregate matrix, 27 tests)
- `tests/native-tool-transcript.ts` (11 negative controls + 3 payload-retention assertions)
- `tests/rr7/wp8-profile-a.test.ts` (the native runs that produce the transcript, chain and payloads)
