# Targeted corrective-pass evidence (2026-11-18)

Model-free evidence for the four counterexamples reported at `268d4ba`. No live model, provider, OCR
gateway or credential is involved; the native runs use the pinned rr.7 binary against the in-repo
loopback fake provider, offline.

| File | What it records | Regenerate with |
| --- | --- | --- |
| `repro-profile-a-finding-collision.json` | The maintainer's Profile A reproduction: two raw findings sharing external id `f-1` (AC-1 unsupported/contradicts, AC-3 supported/matches), each scored occurrence, the admission decision per occurrence, and the single supported detection. |
| `repro-profile-b-conflicting-duplicate.json` | The maintainer's exact Profile B reproduction: six raw provider records — five ordinary expected assessments (one each for AC-1…AC-5) plus a sixth AC-3 record that contradicts the first AC-3 claim. Records the decoder's conflict group, the contract coverage, all six claim decisions (two AC-3 rejected, AC-1/AC-2/AC-4/AC-5 admitted individually), the original reported-claim accounting and the aggregate outcome (rejected). |
| `native-tool-transcript.jsonl` | The rr.7 `file_read` transcript with observed-call/observed-result/request-inclusion states, observed content digests and separately reported expected snapshot digests. |
| `native-tool-chain-unchanged-dependency-read.json` | The captured provider request chain behind the verified `audit.ts` read: per-request body digests and the call/result item identities. |
| `native-tool-chain-out-of-scope-read.json` | The same chain for the denied out-of-scope reads. |
| `pr349-development-case-sources.json` | PR #349 requirement-source and immutable pre-fix candidate identities (commits, trees, blobs, sha256, changed paths). |
| `pr349-memory-delivery-probe.json` | The deterministic memory-delivery probe: pre-fix `content` rule key vs post-fix `rule` key, with the sentinel observed in 0 of 2 and 2 of 2 captured requests respectively. |
| `MANIFEST.json` | Per-file byte count and SHA-256 of every file above. |

Regeneration:

```bash
node --experimental-strip-types scripts/retain-targeted-corrective-evidence.mjs
```

The script rebuilds the two reproductions from the same public modules the tests use. The native
transcript and chain files come from the WP8-A run and are copied when present; the committed copies
are from one local run and will not match a later run's digests. The authoritative copy for a given
head is the CI artifact `wp8a-evidence` (`.isolation-tmp/wp8a-evidence/**`), whose manifest lists the
same files.

Test coverage for these artefacts lives in:

- `tests/m2-corrective-repro.ts` (exact reproductions, 22 tests)
- `tests/m2-gate-matrix.ts` (per-gate positive/negative/aggregate matrix, 27 tests)
- `tests/native-tool-transcript.ts` (10 negative controls + 1 positive, cross-platform)
- `tests/rr7/wp8-profile-a.test.ts` (the native runs that produce the transcript and chain)
