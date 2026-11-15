# M2-A Oracle Execution Protocol (WP2)

**Milestone:** M2-A (WP0–WP2), Task Verification experimental repository.
**License:** CC BY 4.0 (documentation).
**Status:** Implemented, executed, verified.

## Summary

Oracle `O-1` runs the four-HTTP-request behavioral oracle against each of the
four candidates, twice per candidate, in a fresh operating-system process per
pass, recording machine-readable receipts. Zero live model calls.

## Protocol steps

1. **Freeze `crit-v1`** text/digest and the explicit criterion/subclause →
   input/assertion mapping before building candidates (done in WP1).
2. **Build the four candidates** from the criteria; record oracle/fixture
   author overlap. The oracle is not tuned to make intended labels pass.
3. **Run each candidate pass in a fresh isolated process** with fixed runtime /
   configuration. Reset the audit sink per request; freeze observation/flush
   semantics. Capture requests, responses and audit deltas.
4. **Run the oracle twice per candidate.** Both passes must agree. Any
   disagreement stops fixture sealing; repeatability alone does not establish
   adequacy.
5. **Evaluate five assertion groups** (AC-1..AC-5) per candidate per pass.
6. **Persist machine-readable receipts** (versioned, reproducible provenance).

## Execution details

| Item | Value |
|---|---|
| Candidates | S1-C1, S1-C2, S1-C3, S1-C4 |
| Passes per candidate | 2 |
| Requests per pass | 4 (`P-active-a`, `P-active-b`, `P-missing`, `P-revoked`) |
| Total HTTP requests | 32 |
| Assertion groups per candidate per pass | 5 |
| Total assertion-group evaluations | 40 |
| Process isolation | Fresh child process per candidate pass |
| Audit reset | Per request, inside the child |
| Live model calls | 0 (model-free) |

## Fresh-process execution boundary

For each pass the parent:

1. Creates a throwaway workspace under `.candidates-work/` containing only the
   candidate's six application files, a `package.json` with `{"type":"module"}`,
   and the isolated runner `oracle/src/child-runner.ts`.
2. Launches `node --experimental-strip-types --permission
   --allow-fs-read=<workspace> child-runner.ts` with the workspace as the
   working directory.
3. Writes a JSON configuration document to the child's stdin.
4. Reads exactly one JSON document from the child's stdout and validates it
   against the contract.
5. Removes the workspace on success, failure, timeout and abort.

The permission model restricts the child to reads inside its workspace. The
child cannot read ground truth (`candidates/provenance.json`), scorer internals
(`oracle/src/assertions.ts`), sealed artifacts, sibling candidates, the fixture
source or unapproved repository files; those reads fail with
`ERR_ACCESS_DENIED`. The child receives only the request matrix, the candidate
id, and path probes — never expected criteria, labels or assertion logic.
Assertion evaluation stays in the parent.

### Child input contract

```json
{
  "mode": "run",
  "candidateId": "S1-C1",
  "requests": [{ "id": "P-active-a", "path": "/profile", "token": "token-active-a" }],
  "probePaths": [],
  "forbiddenPaths": []
}
```

`mode` is `run` for a normal pass, and `probe`, `hang`, `malformed` or `exit`
for isolation tests.

### Child output contract

```json
{
  "ok": true,
  "mode": "run",
  "candidateId": "S1-C1",
  "pid": 1234,
  "ppid": 1233,
  "stateProbe": { "markerSeen": false, "runCount": 1, "freshState": true },
  "workspaceFiles": ["app.ts", "..."],
  "payloadKeys": ["candidateId", "..."],
  "allowedReads": [{ "label": "app.ts", "path": "...", "accessible": true }],
  "forbidden": [{ "label": "ground-truth", "path": "...", "accessible": false, "code": "ERR_ACCESS_DENIED" }],
  "requests": [{ "requestId": "P-active-a", "statusCode": 200, "body": {}, "auditDelta": [] }]
}
```

The parent rejects a non-zero exit, malformed JSON, a contract violation,
timeout or abort with a typed `ChildExecutionError` and always cleans up.

## How a candidate is run

The child imports only its workspace's `app.ts` and `behavior.ts`, starts the
application on an ephemeral port, resets the audit sink before each request,
and records the response plus the audit delta. No parent experiment checkout,
sibling candidate, fixture module or oracle internal is imported into the
child. The candidate's served behavior is what is tested — the oracle observes
behavior, not source patterns.

## Results

Executed: all four candidates, two passes each, 32 HTTP requests, 40
assertion-group evaluations, both passes agree for every candidate:

- `S1-C1`: pass (all criteria satisfied)
- `S1-C2`: pass (all criteria satisfied)
- `S1-C3`: fail AC-3 (revoked token returns 200 instead of 401) — repeatable
- `S1-C4`: fail AC-4 (`role`/`internal` leaked in responses) — repeatable

Receipts: `.oracle-receipts/S1-C{n}-pass{1,2}.json` (one per pass) and
`.oracle-receipts/oracle-results.json` (versioned `oracleId O-1`,
`oracleVersion v1`).

## Repeatability vs adequacy

Both passes agree (repeatability). Repeatability alone does not establish
oracle adequacy; adequacy is separately demonstrated by the fault controls
(`m2-a-oracle-adequacy.md`).
