// EVALUATOR MATERIAL — never part of a reviewer packet.
//
//   node --experimental-strip-types behavior-probe.mjs <candidate-checkout-dir>
//
// Establishes the expected external behaviour of one candidate directly, without
// inference. The results are the oracle for the batch; they are recorded under
// evaluator/ and never copied into packets/ or into any file a reviewer receives.
//
// The precedence scenarios exercise the `delivery-req-v2` validation order: C3 and
// C4 are answered before the idempotency index is consulted, so C1's duplicate
// guarantee only applies to submissions that reach step 4.
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node behavior-probe.mjs <candidate-checkout-dir>");
  process.exit(2);
}
const abs = path.resolve(dir);
const load = (p) => import(pathToFileURL(path.join(abs, p)).href);

const { handle } = await load("src/router.ts");
const { DeliveryStore } = await load("src/store.ts");
const { attemptDelivery } = await load("src/delivery.ts");

function seeded() {
  const store = new DeliveryStore();
  store.addSubscription({ id: "sub-1", targetUrl: "https://example.test/hook", status: "active" });
  return store;
}

function post(store, payload, headers = {}) {
  return handle(store, {
    method: "POST",
    path: "/deliveries",
    headers,
    body: JSON.stringify({ subscriptionId: "sub-1", payload }),
  });
}

function postRaw(store, body, headers = {}) {
  return handle(store, { method: "POST", path: "/deliveries", headers, body: JSON.stringify(body) });
}

const out = { checkout: abs, scenarios: {} };

function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((value) => {
      out.scenarios[name] = { ok: true, observed: value };
    })
    .catch((error) => {
      out.scenarios[name] = { ok: false, error: String(error?.code ?? error?.message ?? error) };
    });
}

await record("c1_same_key_same_payload", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  const second = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  return { sameId: second.id === first.id, duplicate: second.duplicate ?? null, queued: store.queued().length };
});

await record("c1_same_key_different_payload", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  const second = JSON.parse(post(store, "alpha-two", { "idempotency-key": "k-1" }).body);
  return { sameId: second.id === first.id, queued: store.queued().length };
});

await record("c1_no_key_twice", () => {
  const store = seeded();
  post(store, "alpha");
  post(store, "alpha");
  return { queued: store.queued().length };
});

await record("c2_persistent_5xx", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    return 500;
  });
  return { targetCalls: calls, attempts: delivery?.attempts ?? null, state: delivery?.state ?? null };
});

await record("c2_400_is_final", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    return 400;
  });
  return { targetCalls: calls, state: delivery?.state ?? null };
});

await record("c2_network_error_then_ok", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  let calls = 0;
  const delivery = await attemptDelivery(store, id, async () => {
    calls += 1;
    if (calls === 1) throw new Error("connection reset");
    return 200;
  });
  return { targetCalls: calls, state: delivery?.state ?? null };
});

await record("c2_delay_growth", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  const stamps = [];
  const delivery = await attemptDelivery(store, id, async () => {
    stamps.push(Date.now());
    return 503;
  });
  const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
  return { targetCalls: stamps.length, gapsMs: gaps, grows: gaps.length === 2 ? gaps[1] > gaps[0] : null, state: delivery?.state ?? null };
});

await record("c3_over_limit", () => {
  const store = seeded();
  const response = post(store, "x".repeat(65_537));
  return { status: response.status, queued: store.queued().length };
});

await record("c3_at_limit", () => {
  const store = seeded();
  const response = post(store, "x".repeat(65_536));
  return { status: response.status, queued: store.queued().length };
});

// Precedence interaction 1: an oversized repeat of an accepted key is a 413, not a 202.
await record("precedence_c3_over_c1", () => {
  const store = seeded();
  post(store, "alpha", { "idempotency-key": "k-9" });
  const repeat = post(store, "x".repeat(65_537), { "idempotency-key": "k-9" });
  return { status: repeat.status, queued: store.queued().length };
});

// Precedence interaction 2: size is checked before the subscription is consulted.
await record("precedence_c3_over_unknown_subscription", () => {
  const store = seeded();
  const response = postRaw(store, { subscriptionId: "sub-missing", payload: "x".repeat(65_537) });
  return { status: response.status, queued: store.queued().length };
});

// Precedence interaction 3: a repeat for a disabled subscription is a 409, not a 202.
await record("precedence_c4_over_c1", () => {
  const store = seeded();
  post(store, "alpha", { "idempotency-key": "k-7" });
  store.disableSubscription("sub-1");
  const repeat = post(store, "alpha", { "idempotency-key": "k-7" });
  return { status: repeat.status, queued: store.queued().length };
});

await record("c4_410_disables", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  const delivery = await attemptDelivery(store, id, async () => 410);
  return {
    subscriptionStatus: store.getSubscription("sub-1")?.status ?? null,
    state: delivery?.state ?? null,
    attempts: delivery?.attempts ?? null,
  };
});

await record("c4_disabled_intake", () => {
  const store = seeded();
  store.disableSubscription("sub-1");
  const response = post(store, "alpha");
  return { status: response.status, queued: store.queued().length };
});

await record("c5_health", () => {
  const response = handle(seeded(), { method: "GET", path: "/health", headers: {} });
  return { status: response.status, body: JSON.parse(response.body) };
});

console.log(JSON.stringify(out, null, 2));
