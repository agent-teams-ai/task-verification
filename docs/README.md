---
id: docs.index
type: index
status: active
owner: research/maintainers
summary: Navigation map for the experimental Task Verification research repository.
---

# Documentation

This repository holds experimental research documents. Markdown is the authority; there is no generated portal. Each document states its own status, and none of them is a production contract.

## Collections

| Collection | Contents |
| --- | --- |
| [Experiments](experiments/README.md) | Dated experiment plans and, once executed, their results |

## Reading rules

- Check a document's frontmatter `status` before acting on it. `active` means maintained research, not accepted product architecture.
- Distinguish claim classes: accepted decision, implemented source, inspected test, executed model-free probe, CI receipt, live model evaluation, unverified assumption. A probe or a CI receipt is not a live model evaluation.
- Source revisions are pinned in the documents. Do not silently replace a pinned revision with a moving branch head.
- Planning documents describe proposed invocations; a proposal is not an execution.
