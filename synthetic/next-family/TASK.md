# Notification delivery — task statement v1

- Revision: `delivery-req-v1`
- Frozen: before any candidate in this family was created
- Applies to: the notification delivery service in this repository

This document is the only task statement the reviewer receives. It is written by the task owner
and is not adjusted to a candidate or to a reviewer.

## Context

The service already owns subscriptions, an in-memory delivery queue and a worker entry point
(`attemptDelivery`) that performs one attempt against the subscription's target URL. Callers submit
deliveries through `POST /deliveries`.

## Requirements

**C1 — Idempotent submission**
A submission carrying an `Idempotency-Key` header must create at most one delivery for that key.
A repeat with the same key must be answered with `202` and the delivery id created for that key, and
must not add a second item to the queue. A submission without the header always creates a new
delivery. The key identifies the caller's submission and not its content: two submissions that carry
the same key but different payloads are still one delivery.

**C2 — Retry policy**
A delivery is retried when an attempt fails transiently: a `5xx` response from the target, a network
error, or a timeout. It is not retried for any other `4xx` response. At most three attempts are made
in total, and the delay between attempts must grow.

**C3 — Payload limit**
A submission whose payload exceeds 65,536 bytes is answered with `413` and is not queued. A payload
of exactly 65,536 bytes is accepted.

**C4 — Subscription lifecycle**
When the target answers `410 Gone`, the subscription is disabled and the delivery is not retried.
While a subscription is disabled, `POST /deliveries` for it is answered with `409` and nothing is
queued.

**C5 — Health contract**
`GET /health` continues to answer `200` with `{"status":"ok"}`.

## Out of scope

Persistence, authentication, transport concerns, deployment and performance work.

## Ordinary checks

`npm test` — the repository's own suite. It is the only check the project defines.
