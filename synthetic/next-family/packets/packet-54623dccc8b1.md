# Task statement (delivery-req-v1)

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

# Author handoff

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

# Commit identity

base c65bc835ca35b94fd0de3e3c0cc2c8d459b556de
head 54623dccc8b138c9ad5a41fc0347cf49ba039c61

# Candidate repository content

Every file listed below is the exact content of the candidate commit under the declared selection rule (next-family-packet-rule-v1).

### README.md
# Notification Delivery

A small in-process notification delivery service. It owns subscriptions, a delivery queue and a
worker entry point that attempts a queued delivery against the subscription's target URL.

## Layout

| Path | Purpose |
| --- | --- |
| `src/router.ts` | Request handling for `/health` and `/deliveries`. |
| `src/delivery.ts` | Delivery creation and the worker entry point. |
| `src/store.ts` | In-memory subscriptions, deliveries and the delivery queue. |
| `src/types.ts` | Shared types. |

## Usage

```ts
const store = new DeliveryStore();
store.addSubscription({ id: "sub-1", targetUrl: "https://example.test/hook", status: "active" });

// HTTP intake
handle({ method: "POST", path: "/deliveries", headers: {}, body: JSON.stringify({ subscriptionId: "sub-1", payload: "hello" }) });

// Worker
await attemptDelivery(store, "dlv-1", async (url, payload) => 200);
```

## Tests

`npm test`

### package.json
{
  "name": "notification-delivery",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Synthetic notification delivery service used as a frozen task fixture.",
  "scripts": {
    "test": "node --experimental-strip-types --test --test-concurrency=1 tests/*.test.ts"
  }
}

### src/delivery.ts
import { backoffMs, MAX_ATTEMPTS } from "./limits.ts";
import type { DeliveryStore } from "./store.ts";
import type { Delivery } from "./types.ts";

/** Attempts one delivery against the subscription target and returns the target status. */
export interface DeliveryTarget {
  (targetUrl: string, payload: string): Promise<number>;
}

/** A status the target itself returned, or 0 for a network error or timeout. */
export function isRetryableStatus(status: number): boolean {
  if (status === 0) return true;
  if (status >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function enqueueDelivery(
  store: DeliveryStore,
  subscriptionId: string,
  payload: string,
): Delivery {
  return store.enqueue(subscriptionId, payload);
}

export async function attemptDelivery(
  store: DeliveryStore,
  deliveryId: string,
  target: DeliveryTarget,
): Promise<Delivery | undefined> {
  const delivery = store.get(deliveryId);
  if (!delivery) return undefined;

  const subscription = store.getSubscription(delivery.subscriptionId);
  if (!subscription) return undefined;

  while (delivery.attempts < MAX_ATTEMPTS) {
    delivery.attempts += 1;

    let status = 0;
    try {
      status = await target(subscription.targetUrl, delivery.payload);
    } catch {
      status = 0;
    }
    delivery.lastStatus = status;

    if (status >= 200 && status < 300) {
      delivery.state = "delivered";
      return delivery;
    }

    if (status === 410) {
      store.disableSubscription(subscription.id);
      delivery.state = "failed";
      return delivery;
    }

    if (!isRetryableStatus(status)) {
      delivery.state = "failed";
      return delivery;
    }

    if (delivery.attempts < MAX_ATTEMPTS) {
      await sleep(backoffMs(delivery.attempts));
    }
  }

  delivery.state = "failed";
  return delivery;
}

### src/limits.ts
/** Delivery intake and retry policy. */
export const MAX_PAYLOAD_BYTES = 65_536;

/** Total attempts for one delivery, including the first. */
export const MAX_ATTEMPTS = 3;

/** Delay before the next attempt, in milliseconds. */
export function backoffMs(attempt: number): number {
  return Math.min(100 * 2 ** (attempt - 1), 2_000);
}

### src/router.ts
import { enqueueDelivery } from "./delivery.ts";
import { MAX_PAYLOAD_BYTES } from "./limits.ts";
import type { DeliveryStore } from "./store.ts";
import type { Request, Response } from "./types.ts";

export function json(status: number, value: unknown): Response {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  };
}

interface DeliveryBody {
  subscriptionId?: unknown;
  payload?: unknown;
}

export function handle(store: DeliveryStore, request: Request): Response {
  if (request.method === "GET" && request.path === "/health") {
    return json(200, { status: "ok" });
  }

  if (request.method === "POST" && request.path === "/deliveries") {
    let parsed: DeliveryBody;
    try {
      parsed = request.body ? (JSON.parse(request.body) as DeliveryBody) : {};
    } catch {
      return json(400, { error: "body must be JSON" });
    }

    if (typeof parsed.subscriptionId !== "string" || parsed.subscriptionId === "") {
      return json(400, { error: "subscriptionId is required" });
    }
    if (typeof parsed.payload !== "string") {
      return json(400, { error: "payload is required" });
    }

    const payloadBytes = Buffer.byteLength(parsed.payload, "utf8");
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      return json(413, { error: "payload too large", limitBytes: MAX_PAYLOAD_BYTES });
    }

    const subscription = store.getSubscription(parsed.subscriptionId);
    if (!subscription) {
      return json(404, { error: "subscription not found" });
    }
    if (subscription.status === "disabled") {
      return json(409, { error: "subscription disabled" });
    }

    const key = request.headers["idempotency-key"];
    if (typeof key === "string" && key !== "") {
      const existing = store.lookupIdempotency(key);
      if (existing) {
        const delivery = store.get(existing);
        return json(202, { id: existing, state: delivery?.state ?? "queued", duplicate: true });
      }
    }

    const delivery = enqueueDelivery(store, subscription.id, parsed.payload);
    if (typeof key === "string" && key !== "") {
      store.rememberIdempotency(key, delivery.id);
    }
    return json(202, { id: delivery.id, state: delivery.state });
  }

  return json(404, { error: "not found" });
}

### src/store.ts
import type { Delivery, Subscription } from "./types.ts";

/**
 * In-memory subscriptions, deliveries, the delivery queue and the idempotency index.
 *
 * `get()` returns the live delivery record so the worker can record attempts on it;
 * `getSubscription()` returns a copy.
 */
export class DeliveryStore {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly deliveries = new Map<string, Delivery>();
  private readonly idempotency = new Map<string, string>();
  private readonly queue: string[] = [];
  private nextId = 1;

  addSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  getSubscription(id: string): Subscription | undefined {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription } : undefined;
  }

  disableSubscription(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (subscription) subscription.status = "disabled";
  }

  lookupIdempotency(key: string): string | undefined {
    return this.idempotency.get(key);
  }

  rememberIdempotency(key: string, deliveryId: string): void {
    this.idempotency.set(key, deliveryId);
  }

  get(id: string): Delivery | undefined {
    return this.deliveries.get(id);
  }

  enqueue(subscriptionId: string, payload: string): Delivery {
    const delivery: Delivery = {
      id: `dlv-${this.nextId++}`,
      subscriptionId,
      payload,
      attempts: 0,
      state: "queued",
    };
    this.deliveries.set(delivery.id, delivery);
    this.queue.push(delivery.id);
    return delivery;
  }

  queued(): string[] {
    return [...this.queue];
  }

  pending(): Delivery[] {
    return this.queue
      .map((id) => this.deliveries.get(id))
      .filter((delivery): delivery is Delivery => Boolean(delivery));
  }
}

### src/types.ts
export type SubscriptionStatus = "active" | "disabled";

export interface Subscription {
  id: string;
  targetUrl: string;
  status: SubscriptionStatus;
}

export type DeliveryState = "queued" | "delivered" | "failed";

export interface Delivery {
  id: string;
  subscriptionId: string;
  payload: string;
  attempts: number;
  state: DeliveryState;
  lastStatus?: number;
}

export interface Request {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: string;
}

### tests/deliveries.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { attemptDelivery } from "../src/delivery.ts";
import { handle } from "../src/router.ts";
import { DeliveryStore } from "../src/store.ts";

function seeded(): DeliveryStore {
  const store = new DeliveryStore();
  store.addSubscription({
    id: "sub-1",
    targetUrl: "https://example.test/hook",
    status: "active",
  });
  return store;
}

function post(
  store: DeliveryStore,
  payload: unknown,
  headers: Record<string, string | undefined> = {},
) {
  return handle(store, {
    method: "POST",
    path: "/deliveries",
    headers,
    body: JSON.stringify(payload),
  });
}

test("deliveries: a valid submission is queued", () => {
  const store = seeded();
  const response = post(store, { subscriptionId: "sub-1", payload: "hello" });
  assert.equal(response.status, 202);
  assert.equal(JSON.parse(response.body).state, "queued");
  assert.equal(store.queued().length, 1);
});

test("deliveries: an unknown subscription is rejected", () => {
  const store = seeded();
  const response = post(store, { subscriptionId: "sub-missing", payload: "hello" });
  assert.equal(response.status, 404);
  assert.equal(store.queued().length, 0);
});

test("deliveries: a missing payload is rejected", () => {
  const store = seeded();
  assert.equal(post(store, { subscriptionId: "sub-1" }).status, 400);
  assert.equal(store.queued().length, 0);
});

test("deliveries: the worker records the target status", async () => {
  const store = seeded();
  const created = JSON.parse(
    post(store, { subscriptionId: "sub-1", payload: "hello" }).body,
  );
  const delivery = await attemptDelivery(store, created.id, async () => 204);
  assert.equal(delivery?.state, "delivered");
  assert.equal(delivery?.attempts, 1);
  assert.equal(delivery?.lastStatus, 204);
});

### tests/health.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { handle } from "../src/router.ts";
import { DeliveryStore } from "../src/store.ts";

test("health: GET /health reports ok", () => {
  const response = handle(new DeliveryStore(), {
    method: "GET",
    path: "/health",
    headers: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: "ok" });
});

test("health: an unknown route is a 404", () => {
  const response = handle(new DeliveryStore(), {
    method: "GET",
    path: "/unknown",
    headers: {},
  });
  assert.equal(response.status, 404);
});

### tests/idempotency.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { handle } from "../src/router.ts";
import { DeliveryStore } from "../src/store.ts";

function seeded(): DeliveryStore {
  const store = new DeliveryStore();
  store.addSubscription({
    id: "sub-1",
    targetUrl: "https://example.test/hook",
    status: "active",
  });
  return store;
}

function post(
  store: DeliveryStore,
  payload: unknown,
  headers: Record<string, string | undefined> = {},
) {
  return handle(store, {
    method: "POST",
    path: "/deliveries",
    headers,
    body: JSON.stringify(payload),
  });
}

test("idempotency: a repeated key returns the original delivery", () => {
  const store = seeded();
  const first = post(store, { subscriptionId: "sub-1", payload: "hello" }, { "idempotency-key": "k-1" });
  const second = post(store, { subscriptionId: "sub-1", payload: "hello" }, { "idempotency-key": "k-1" });

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  const firstBody = JSON.parse(first.body);
  const secondBody = JSON.parse(second.body);
  assert.equal(secondBody.id, firstBody.id);
  assert.equal(secondBody.duplicate, true);
  assert.equal(store.queued().length, 1);
});

test("idempotency: distinct keys create distinct deliveries", () => {
  const store = seeded();
  const first = JSON.parse(post(store, { subscriptionId: "sub-1", payload: "hello" }, { "idempotency-key": "k-1" }).body);
  const second = JSON.parse(post(store, { subscriptionId: "sub-1", payload: "hello" }, { "idempotency-key": "k-2" }).body);
  assert.notEqual(second.id, first.id);
  assert.equal(store.queued().length, 2);
});

test("idempotency: a submission without a key is always queued", () => {
  const store = seeded();
  post(store, { subscriptionId: "sub-1", payload: "hello" });
  post(store, { subscriptionId: "sub-1", payload: "hello" });
  assert.equal(store.queued().length, 2);
});

### tests/retry.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { attemptDelivery } from "../src/delivery.ts";
import { handle } from "../src/router.ts";
import { DeliveryStore } from "../src/store.ts";

function queued(): { store: DeliveryStore; id: string } {
  const store = new DeliveryStore();
  store.addSubscription({
    id: "sub-1",
    targetUrl: "https://example.test/hook",
    status: "active",
  });
  const created = JSON.parse(
    handle(store, {
      method: "POST",
      path: "/deliveries",
      headers: {},
      body: JSON.stringify({ subscriptionId: "sub-1", payload: "hello" }),
    }).body,
  );
  return { store, id: created.id };
}

test("retry: a persistent 5xx is attempted at most three times", async () => {
  const { store, id } = queued();
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    return 500;
  });
  assert.equal(calls, 3);
  assert.equal(delivery?.attempts, 3);
  assert.equal(delivery?.state, "failed");
});

test("retry: a transient failure followed by success is delivered", async () => {
  const { store, id } = queued();
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    return calls === 1 ? 503 : 200;
  });
  assert.equal(calls, 2);
  assert.equal(delivery?.state, "delivered");
});

test("retry: a network error is retried", async () => {
  const { store, id } = queued();
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    if (calls === 1) throw new Error("connection reset");
    return 202;
  });
  assert.equal(calls, 2);
  assert.equal(delivery?.state, "delivered");
});

test("retry: a 400 is final and is not retried", async () => {
  const { store, id } = queued();
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    return 400;
  });
  assert.equal(calls, 1);
  assert.equal(delivery?.state, "failed");
});

### tests/subscriptions.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { attemptDelivery } from "../src/delivery.ts";
import { handle } from "../src/router.ts";
import { DeliveryStore } from "../src/store.ts";

function seeded(): DeliveryStore {
  const store = new DeliveryStore();
  store.addSubscription({
    id: "sub-1",
    targetUrl: "https://example.test/hook",
    status: "active",
  });
  return store;
}

function post(store: DeliveryStore, payload: unknown) {
  return handle(store, {
    method: "POST",
    path: "/deliveries",
    headers: {},
    body: JSON.stringify(payload),
  });
}

test("subscriptions: a 410 from the target disables the subscription", async () => {
  const store = seeded();
  const created = JSON.parse(post(store, { subscriptionId: "sub-1", payload: "hello" }).body);
  await attemptDelivery(store, created.id, async () => 410);
  assert.equal(store.getSubscription("sub-1")?.status, "disabled");
});

test("subscriptions: a disabled subscription rejects further deliveries", () => {
  const store = seeded();
  store.disableSubscription("sub-1");
  const response = post(store, { subscriptionId: "sub-1", payload: "hello" });
  assert.equal(response.status, 409);
  assert.equal(store.queued().length, 0);
});

test("limits: an oversized payload is rejected with 413 and is not queued", () => {
  const store = seeded();
  const response = post(store, { subscriptionId: "sub-1", payload: "x".repeat(65_537) });
  assert.equal(response.status, 413);
  assert.equal(store.queued().length, 0);
});

test("limits: a payload exactly at the limit is accepted", () => {
  const store = seeded();
  const response = post(store, { subscriptionId: "sub-1", payload: "x".repeat(65_536) });
  assert.equal(response.status, 202);
  assert.equal(store.queued().length, 1);
});

### tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}

# Declared selection rule and exclusions

include: README.md, package.json, tsconfig.json, src/**/*.ts, tests/**/*.ts
exclude: node_modules/**, .git/**, *.lock
max file bytes: 24576

Files present at the candidate but not included:

- (none)
