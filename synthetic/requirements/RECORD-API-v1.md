# Record Management API — frozen requirements v1

- Revision: `record-api-req-v1`
- Frozen: 2026-11-14, before the Candidate A snapshot was created
- Applies to: the synthetic Record Management API fixture in this pilot

This document is the complete task statement both reviewer paths receive. It is frozen: the
candidate is not adjusted to it later, and it is not adjusted to a reviewer.

## Context

The service already owns an in-memory record store (`src/store.ts`), a shared UTC timestamp formatter
(`src/format.ts`) and a shared CSV escaping helper (`src/csv.ts`). Records carry an id, a name, a
status (`active` / `archived`) and a creation timestamp stored with an explicit non-UTC offset.

## Requirements

**R1 — List records**
The API must list records with the requested filters and pagination.

**R2 — UTC date formatting**
Record timestamps must be returned as UTC ISO-8601 using the existing shared formatting helper.

**R3 — CSV export**
The API must export the same filtered records as CSV, including correct headers and escaping, using
the existing CSV escaping helper.

## Notes on reading the requirements

- "The same filtered records" means the export applies the same filter set the listing supports.
- R2 and R3 name existing helpers. Using them is part of the requirement; reimplementing their
  behaviour elsewhere does not satisfy it, and the helper's own existence is not evidence that an
  end-to-end capability exists.
- A requirement is satisfied only when a caller can exercise the capability through the service.

## Out of scope

Persistence, authentication, transport concerns, deployment and performance work.

## Ordinary checks

`npm test` — the repository's own test suite. It is the only check the project defines.
