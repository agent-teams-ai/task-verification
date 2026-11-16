# Pinned ReviewRouter parser/normalization modules

These two files are **verbatim, byte-identical** copies of the consumer modules
from the exact approved Action commit:

- Repository: <https://github.com/777genius/review-router>
- Commit: `7a079c382d8e98b426ee90a6b3764be2a21b4c49`
- Directory: `src/review-orchestration/infrastructure/`

| File | Git blob SHA-1 | SHA-256 |
| --- | --- | --- |
| `ocr-review-outcome-contract.ts` | `5ba2ba5ddfe52c93b0dc7d7514b1e0a3d7047698` | `b927b7ac10dc305f417cba1ec4230b8da3f6796d8ee2df7054d4bf08336c84b7` |
| `ocr-review-normalization.ts` | `43bcfa54ee3dedd50a18e2d8e8f9aaf5cd5a0a42` | `0dd1b7a792139c71141ccc742747390f6583e49dda5eb9a42059f4e52ed01818` |

The Git blob identities were verified from the parser repository commit, not by
assuming an unchanged local copy:

```
git ls-tree 7a079c382d8e98b426ee90a6b3764be2a21b4c49 -- \
  src/review-orchestration/infrastructure/ocr-review-outcome-contract.ts \
  src/review-orchestration/infrastructure/ocr-review-normalization.ts
```

The copies are consumed read-only by the WP7/WP8 qualification tests. They are
not edited, reformatted or re-exported. The only supplied shim is a type-only
`vendor/review-router/types.ts` module (`Finding`, `Severity`), which is erased
at runtime; it does not change the pinned source bytes.

Licensed under the ReviewRouter MIT license. See the upstream repository for the
license text and attribution.
