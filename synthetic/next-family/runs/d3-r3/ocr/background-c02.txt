# Notification delivery — task statement v2

- Revision: `delivery-req-v2`
- Supersedes: `delivery-req-v1` — same family, same five requirements. v2 adds the request-validation
  order (C1/C3/C4 precedence) and states which material is external to this repository.
- Frozen: before any candidate in this family was created; revised 2026-11-22, before any inference on
  this family.
- Applies to: the notification delivery service in this repository

This document is the only task statement the reviewer receives. It is written by the task owner and is
not adjusted to a candidate or to a reviewer.

## Context

The service already owns subscriptions, an in-memory delivery queue and a worker entry point
(`attemptDelivery`) that performs one attempt against the subscription's target URL. Callers submit
deliveries through `POST /deliveries`.

## Provided and external material

Provided with this review: this repository's tracked source, tests and package manifests, this task
statement, and the author's handoff.

External to this repository: the retry policy — which target statuses count as transient, and how long
the delay between attempts is — is owned by the workspace package `@fixture/delivery-core` at
`../packages/delivery-core`, a sibling of this repository. It is a legitimate workspace dependency: it
is installed in the workspace, the service resolves it at run time, and the ordinary checks use it. It
is not part of this repository's checkout and it is not shipped with the reviewed material.

Not provided with this review: the source of `@fixture/delivery-core`, and any execution receipt or
run output produced by running this repository's checks.

If a requirement cannot be settled from the provided material, name what would settle it.

## Requirements

**C1 — Idempotent submission**
A submission carrying an `Idempotency-Key` header creates at most one delivery for that key. The key
identifies the caller's submission and not its content: two submissions carrying the same key but
different payloads are still one delivery. Within the valid-submission domain, a repeat with the same
key is answered with `202` and the delivery id created for that key, and adds no second item to the
queue. A submission without the header always creates a new delivery.

**C2 — Retry policy**
A delivery is retried when an attempt fails transiently: a `5xx` response from the target, a network
error, or a timeout. It is not retried for any other `4xx` response. At most three attempts are made in
total, and the delay between attempts must grow.

**C3 — Payload limit**
A submission whose payload exceeds 65,536 bytes is answered with `413` and is not queued. A payload of
exactly 65,536 bytes is accepted. The size check happens before the subscription is consulted, so an
oversized payload is answered `413` even when the subscription does not exist (`404`) or is disabled
(`409`).

**C4 — Subscription lifecycle**
When the target answers `410 Gone`, the subscription is disabled and the delivery is not retried. While
a subscription is disabled, `POST /deliveries` for it is answered with `409` and nothing is queued —
including a repeat that carries a previously accepted `Idempotency-Key`.

**C5 — Health contract**
`GET /health` continues to answer `200` with `{"status":"ok"}`.

## Request validation order

Intake runs these checks in order, and each is answered before the idempotency index is consulted:

1. Body shape: a missing or non-string `subscriptionId` or `payload` answers `400`.
2. Payload size: more than 65,536 bytes answers `413` (C3).
3. Subscription: unknown answers `404`; disabled answers `409` (C4).
4. Idempotency: a repeat of a key already accepted answers `202` with the original delivery id (C1).

So C3 and C4 take precedence over C1, and C1's duplicate guarantee applies only to submissions that
reach step 4. A repeat is therefore not answered `202` when it is oversized (`413`) or addressed to a
disabled subscription (`409`), and in neither case is anything queued or a key recorded.

## Out of scope

Persistence, authentication, transport concerns, deployment and performance work.

## Ordinary checks

`npm test` — the repository's own suite. It is the only check the project defines.
