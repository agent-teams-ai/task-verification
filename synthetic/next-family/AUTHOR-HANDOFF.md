# feat(deliveries): idempotent delivery with retry and subscription lifecycle

<!--
Ordinary author handoff, supplied to the reviewer as normal author context.
It is a claim by the author, not evidence. The same text accompanies every candidate in this family;
only the commit identity differs.
-->

## What

`POST /deliveries` now enforces the payload limit, collapses duplicate submissions so a caller retry
does not enqueue twice, and returns `409` for a disabled subscription. The worker retries transient
failures with a growing delay and stops after three attempts.

## Notes

- Duplicate submissions are collapsed: a caller that retries the same submission gets the original
  delivery id back instead of a second queued delivery.
- Subscriptions whose target answers `410` are disabled and are not retried.
- Responses keep the existing JSON shape; no consumer change is required.

## Tests

`npm test` covers intake, the payload limit, duplicate submissions, retry outcomes and subscription
disabling.
