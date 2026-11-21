# D1/D2 authorization record — first bounded synthetic development pilot

- Recorded: 2026-11-21
- Recorded by: the agent, from the maintainer's message in this session
- Branch: `exp/synthetic-live-pilot-01` (experiment evidence only; PR #2 untouched)
- Scope of this record: the authorization text and the constraints it carries. No requirement,
  fixture, Candidate A, evaluator path or reviewer input was modified to record it.

## Verbatim authorization

The following is the maintainer's authorization, preserved exactly:

```
The maintainer has explicitly approved D1/D2 for the first bounded synthetic development pilot.

Approved:

- Pinned rr.7 binary.
- Existing managed OCR rules and normal filtering policy, unchanged.
- OpenRouter provider.
- Model `openai/gpt-6.1-terra`.
- Aggregate USD 1.00 ceiling across all inference.
- Frozen original requirements and Candidate A.
- Ordinary managed OCR comparator.
- Separate Criteria Assessment through the existing Gateway SDK `/llm` path using `createLlmClient()`.

The maintainer remains the sole human report reader.

Do not request redundant approval for this already-authorized scope.

Do not switch to Codex OAuth for this first experiment. That option is for future repeated experiments.
```

## Constraints carried by the same authorization

| Constraint | Recorded as |
| --- | --- |
| Frozen material is immutable | requirements `ca868a3f…6bde727f`, `pr.json` `9b48eb1b…0c1bcf`, reviewer input `4ffebc0d…dbaf88`, ordinary checks `85d60b7b…f9b26d`; Base `ce99b0d…`, Candidate A `23864e3…` |
| Candidate B | must not exist — verified absent |
| PR #2 | must not be modified or pushed — M2 tree clean at `996cdcb…` |
| Hidden evaluator | not modified, not exposed to either reviewer path, not used to judge the initial reports |
| Credentials | boolean presence only; no value read, printed, hashed into an artifact or committed |
| Ceiling | USD 1.00 aggregate across every inference path, including billable compatibility checks |
| Checkpoint | stop after both initial reviewer reports are frozen; no correction, no recheck |

## What was executed under this authorization

| Item | State |
| --- | --- |
| Ordinary checks on Candidate A | **executed** — 21/21, exit 0 |
| Criteria Assessment (1 request) | **executed** — via `createLlmClient()`, USD 0.00827925 |
| Initial ordinary OCR | **not dispatched** — blocked before the first live request; see `REPORT-d12-initial.md` §5 and §8 |
| Correction / recheck | not started (checkpoint) |
