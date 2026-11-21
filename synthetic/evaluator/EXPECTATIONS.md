# Evaluator-only expectations — NOT reviewer-visible

Revision: `record-api-eval-v1`
Fixture: synthetic Record Management API, Candidate A.

This file and `r3-export.test.ts` are evaluator material. They are never included in reviewer input,
never referenced from the PR metadata, and are applied only after the initial review outputs are
frozen.

## Expected answer

| Requirement | Expected status | Basis |
| --- | --- | --- |
| R1 — list records with filters and pagination | **satisfied** | `src/records.ts` implements `parseListQuery` and `listRecords`; `src/router.ts` dispatches `GET /records`; `tests/records.test.ts` covers filters, pagination and totals. |
| R2 — UTC ISO-8601 via the shared helper | **satisfied** | `listRecords` maps every `createdAt` through `toUtcIsoString` from the unchanged `src/format.ts`; the test asserts a `+02:00` and a `-05:00` instant come back as UTC. |
| R3 — CSV export via the shared escaping helper | **violated** | `src/csv.ts` exists and exports `escapeCsvField` / `toCsvRow`, but no module assembles an export, no route serves it, and no caller reaches it. `GET /records/export` returns 404. |

## Deliberate distinction

The CSV helper is **present and inspectable** in the immutable Base snapshot. The missing thing is the
end-to-end export capability: headers, row assembly over the filtered set, and a route. A review that
reports "the CSV escaping helper is missing" is factually wrong; a review that reports "no CSV export
capability exists" is correct.

## Candidate B (not created)

Candidate B would be a new commit on top of Candidate A adding `src/export.ts` (header row + rows from
the filtered set, using `toCsvRow`) and `GET /records/export` returning `text/csv`. It is created only
after the initial review outputs are frozen and Iliya has recorded the feedback to return. Candidate A
is never altered.

## Hidden check

`evaluator/r3-export.test.ts` imports the candidate router and asserts the export response. It fails
on Candidate A by design. It is not part of the ordinary project suite and is not placed in the
candidate repository.
