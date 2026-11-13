# Task Verification (experimental)

**Status: experimental, research-only. Not production-ready.**

This repository holds the experimental Task Verification research programme: checking whether an immutable deliverable meets explicitly supplied acceptance criteria, and reporting what is satisfied, violated or unverifiable.

## What this repository is not

- **No stable API or SDK.** Nothing here is a published contract; interfaces may change or disappear without notice.
- **No support commitment.** There is no service level, maintenance promise, or answer guarantee.
- **No production suitability claim.** Nothing here is qualified for production use, and no deployment is implied.
- **No package publication implied.** No npm package, image or release artifact is promised or produced by this repository.
- **No production integration implied.** ReviewRouter, Agent Teams Orchestrator and any other consumer remain unmodified unless a separate, explicitly authorised change says otherwise.

Descriptions of future work in the documents are proposals for review, not commitments.

## Current milestone

Milestone 1 is a planning and documentation milestone only: the [Stage A/B experiment plan](docs/experiments/2026-11-12-stage-a-b-experiment-plan.md). It specifies a proposed 39-review-run reviewer experiment (12 managed OCR review sessions and 27 single `/llm` calls); **none of those review runs has been executed**, and no model/API request has been made. There is no verification kernel, harness or transport qualification in this repository.

## Reading

- [Documentation map](docs/README.md)
- [Experiment plans](docs/experiments/README.md)
- [Stage A/B experiment plan, 2026-11-12](docs/experiments/2026-11-12-stage-a-b-experiment-plan.md)

Every material claim in the research documents is expected to carry a source class (accepted decision, implemented source, inspected test, executed model-free probe, CI receipt, live model evaluation, or explicit uncertainty label). Research sources live in [agent-teams-ai/engineering-research](https://github.com/agent-teams-ai/engineering-research); this repository does not restate them.

## Licensing

- **Code, tests and tooling:** Apache License 2.0 (see [LICENSE](LICENSE)). Contributors retain copyright in their contributions. Apache 2.0 covers original code, tests and tooling only.
- **Original Phase 0 report (external):** CC BY 4.0, with the agreed attribution. It is referenced, not reproduced here, and remains unchanged.
- **Research and planning documents in this repository:** these are **not** covered by Apache 2.0 by implication. The licence for the Markdown research and planning documents, and for the experiment results report, is an open owner decision; until it is recorded, do not redistribute them under any licence, including Apache 2.0 or CC BY 4.0.

## Contributing

This is an experimental research repository with an unstable public surface. Open an issue describing the evidence you want to add before sending substantial code; acceptance of contributions is at the maintainers' discretion and does not create a support relationship.
