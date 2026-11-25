// Model-free adjudication reproductions for the D3-R3 defect review.
//
//   node --experimental-strip-types synthetic/next-family/adjudication/reproduce.mjs <candidateId> <sha> [--no-workspace-package]
//
// Materializes the frozen candidate commit into a temporary tree (exactly as the
// ordinary receipts do), imports its own modules, and drives the public intake and
// worker entry points. No model, no provider, no credential, no network.
//
// Every scenario is written verbatim to JSON. Nothing here reads evaluator
// material: the expectations live in the adjudication document, and these files
// are the behaviour, not the answer key.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FAMILY_ROOT } from "../lib/paths.mjs";
import { materialize } from "../lib/fixture.mjs";

const [candidateId, sha] = process.argv.slice(2);
const noWorkspacePackage = process.argv.includes("--no-workspace-package");
if (!candidateId || !sha) {
  console.error("usage: reproduce.mjs <candidateId> <sha> [--no-workspace-package]");
  process.exit(2);
}

const tree = materialize(sha, {
  withWorkspacePackage: candidateId.startsWith("c03") && !noWorkspacePackage,
  prefix: "d3-adjudication",
});
const load = (p) => import(pathToFileURL(path.join(tree.repo, p)).href);

const { handle } = await load("src/router.ts");
const { DeliveryStore } = await load("src/store.ts");
const { attemptDelivery } = await load("src/delivery.ts");

const out = {
  schema: "d3-r3.adjudication-reproduction/v1",
  candidateId,
  head: sha,
  workspacePackagePresent: candidateId.startsWith("c03") && !noWorkspacePackage,
  generatedAt: new Date().toISOString(),
  scenarios: {},
};

function seeded() {
  const store = new DeliveryStore();
  store.addSubscription({ id: "sub-1", targetUrl: "https://example.test/hook", status: "active" });
  return store;
}

const post = (store, payload, headers = {}) =>
  handle(store, {
    method: "POST",
    path: "/deliveries",
    headers,
    body: JSON.stringify({ subscriptionId: "sub-1", payload }),
  });

const postRaw = (store, body, headers = {}) =>
  handle(store, { method: "POST", path: "/deliveries", headers, body: JSON.stringify(body) });

const postText = (store, body, headers = {}) =>
  handle(store, { method: "POST", path: "/deliveries", headers, body });

function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((observed) => {
      out.scenarios[name] = { ok: true, observed };
    })
    .catch((error) => {
      out.scenarios[name] = {
        ok: false,
        error: String(error?.code ?? error?.message ?? error),
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
      };
    });
}

/** Repeated worker invocations after a terminal result, counting target calls per invocation. */
async function reentry(status, invocations = 3) {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  const callsPerInvocation = [];
  const attemptsAfter = [];
  const stateAfter = [];
  const lastStatusAfter = [];
  for (let i = 0; i < invocations; i += 1) {
    let calls = 0;
    const delivery = await attemptDelivery(store, id, async () => {
      calls += 1;
      return status;
    });
    callsPerInvocation.push(calls);
    attemptsAfter.push(delivery?.attempts ?? null);
    stateAfter.push(delivery?.state ?? null);
    lastStatusAfter.push(delivery?.lastStatus ?? null);
  }
  return {
    firstStatus: status,
    callsPerInvocation,
    totalTargetCalls: callsPerInvocation.reduce((a, b) => a + b, 0),
    attemptsAfter,
    stateAfter,
    lastStatusAfter,
    subscriptionStatus: store.getSubscription("sub-1")?.status ?? null,
    queuedAfter: store.queued().length,
    pendingAfter: store.pending().map((d) => ({ id: d.id, state: d.state, attempts: d.attempts })),
  };
}

// ---- 2A: c02 idempotency-key identity -------------------------------------
await record("c1_same_key_same_payload", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  const secondResponse = post(store, "alpha", { "idempotency-key": "k-1" });
  const second = JSON.parse(secondResponse.body);
  return { firstId: first.id, secondId: second.id, sameId: second.id === first.id, secondStatus: secondResponse.status, queued: store.queued().length };
});

await record("c1_same_key_different_payload", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  const secondResponse = post(store, "alpha-two", { "idempotency-key": "k-1" });
  const second = JSON.parse(secondResponse.body);
  return {
    firstId: first.id,
    secondId: second.id,
    sameId: second.id === first.id,
    secondStatus: secondResponse.status,
    deliveries: store.pending().map((d) => ({ id: d.id, payloadSha: crypto.createHash("sha256").update(d.payload).digest("hex").slice(0, 8) })),
    queued: store.queued().length,
  };
});

await record("c1_no_key_identical_payloads", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha").body);
  const second = JSON.parse(post(store, "alpha").body);
  return { firstId: first.id, secondId: second.id, distinctIds: first.id !== second.id, queued: store.queued().length };
});

await record("c1_no_key_different_payloads", () => {
  const store = seeded();
  post(store, "alpha");
  post(store, "beta");
  return { queued: store.queued().length };
});

// ---- 2D: header casing and empty key --------------------------------------
await record("c1_header_mixed_case", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "Idempotency-Key": "k-1" }).body);
  const second = JSON.parse(post(store, "alpha", { "Idempotency-Key": "k-1" }).body);
  return { firstId: first.id, secondId: second.id, sameId: second.id === first.id, queued: store.queued().length };
});

await record("c1_header_upper_case", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "IDEMPOTENCY-KEY": "k-1" }).body);
  const second = JSON.parse(post(store, "alpha", { "IDEMPOTENCY-KEY": "k-1" }).body);
  return { firstId: first.id, secondId: second.id, sameId: second.id === first.id, queued: store.queued().length };
});

await record("c1_header_lower_case", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  const second = JSON.parse(post(store, "alpha", { "idempotency-key": "k-1" }).body);
  return { firstId: first.id, secondId: second.id, sameId: second.id === first.id, queued: store.queued().length };
});

await record("c1_empty_key_twice", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": "" }).body);
  const second = JSON.parse(post(store, "alpha", { "idempotency-key": "" }).body);
  return { firstId: first.id, secondId: second.id, sameId: second.id === first.id, queued: store.queued().length };
});

await record("c1_undefined_header_value", () => {
  const store = seeded();
  const first = JSON.parse(post(store, "alpha", { "idempotency-key": undefined }).body);
  const second = JSON.parse(post(store, "alpha", { "idempotency-key": undefined }).body);
  return { firstId: first.id, secondId: second.id, sameId: second.id === first.id, queued: store.queued().length };
});

// ---- 2B: terminal delivery re-entry ---------------------------------------
await record("c1_reentry_after_400", async () => ({ ...(await reentry(400)), subscriptionNote: "single subscription" }));
await record("c3_reentry_after_410", async () => reentry(410));
await record("c2_reentry_after_410_already_disabled", async () => {
  const store = seeded();
  store.disableSubscription("sub-1");
  const delivery = store.enqueue("sub-1", "alpha");
  let calls = 0;
  const result = await attemptDelivery(store, delivery.id, async () => {
    calls += 1;
    return 200;
  });
  return { targetCalls: calls, state: result?.state ?? null, subscriptionStatus: store.getSubscription("sub-1")?.status ?? null };
});
await record("c2_reentry_after_5xx_exhaustion", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  const callsPerInvocation = [];
  for (let i = 0; i < 2; i += 1) {
    let calls = 0;
    await attemptDelivery(store, id, async () => {
      calls += 1;
      return 500;
    });
    callsPerInvocation.push(calls);
  }
  return { callsPerInvocation, totalTargetCalls: callsPerInvocation.reduce((a, b) => a + b, 0) };
});
await record("c2_terminal_pending_includes_failed", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  await attemptDelivery(store, id, async () => 400);
  return { pendingIds: store.pending().map((d) => d.id), pendingStates: store.pending().map((d) => d.state), queued: store.queued().length };
});
await record("c2_delivered_pending_includes_delivered", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  await attemptDelivery(store, id, async () => 200);
  return { pendingStates: store.pending().map((d) => d.state), queued: store.queued().length };
});
await record("c2_two_deliveries_one_terminal_one_queued", async () => {
  const store = seeded();
  const failedId = JSON.parse(post(store, "alpha").body).id;
  await attemptDelivery(store, failedId, async () => 400);
  JSON.parse(post(store, "beta").body);
  return { pending: store.pending().map((d) => ({ id: d.id, state: d.state, attempts: d.attempts })) };
});

// ---- 2F context: concurrent invocation (a different mechanism) -------------
await record("concurrent_two_invocations_same_delivery", async () => {
  const store = seeded();
  const id = JSON.parse(post(store, "alpha").body).id;
  let calls = 0;
  const target = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return 400;
  };
  const [a, b] = await Promise.all([attemptDelivery(store, id, target), attemptDelivery(store, id, target)]);
  return { targetCalls: calls, attemptsAfter: [a?.attempts ?? null, b?.attempts ?? null], state: store.get(id)?.state ?? null };
});

// ---- 2E: C3 validation precedence ----------------------------------------
await record("c3_empty_string_subscription_oversized", () => {
  const store = seeded();
  const response = postRaw(store, { subscriptionId: "", payload: "x".repeat(65_537) });
  return { status: response.status, body: response.body, queued: store.queued().length };
});
await record("c3_empty_string_subscription_at_limit", () => {
  const store = seeded();
  const response = postRaw(store, { subscriptionId: "", payload: "x".repeat(65_536) });
  return { status: response.status, queued: store.queued().length };
});
await record("c3_missing_subscription_oversized", () => {
  const store = seeded();
  const response = postRaw(store, { payload: "x".repeat(65_537) });
  return { status: response.status, queued: store.queued().length };
});
await record("c3_non_string_subscription_oversized", () => {
  const store = seeded();
  const response = postRaw(store, { subscriptionId: 7, payload: "x".repeat(65_537) });
  return { status: response.status, queued: store.queued().length };
});
await record("c3_unknown_subscription_oversized", () => {
  const store = seeded();
  const response = postRaw(store, { subscriptionId: "sub-missing", payload: "x".repeat(65_537) });
  return { status: response.status, queued: store.queued().length };
});
await record("c3_disabled_subscription_oversized", () => {
  const store = seeded();
  store.disableSubscription("sub-1");
  const response = postRaw(store, { subscriptionId: "sub-1", payload: "x".repeat(65_537) });
  return { status: response.status, queued: store.queued().length };
});

// ---- 2F: null JSON body property-access fault -----------------------------
await record("null_body", () => {
  const store = seeded();
  const response = postText(store, "null");
  return { status: response.status, body: response.body };
});
await record("array_body", () => {
  const store = seeded();
  const response = postText(store, "[]");
  return { status: response.status, body: response.body };
});
await record("number_body", () => {
  const store = seeded();
  const response = postText(store, "5");
  return { status: response.status, body: response.body };
});
await record("empty_body", () => {
  const store = seeded();
  const response = postText(store, "");
  return { status: response.status, body: response.body };
});

const outDir = path.join(FAMILY_ROOT, "adjudication", "reproductions");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${candidateId}${noWorkspacePackage ? "-no-workspace-package" : ""}.json`);
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

const lines = Object.entries(out.scenarios).map(
  ([name, value]) => `${name} ${value.ok ? JSON.stringify(value.observed) : `ERROR ${value.error}`}`,
);
console.log(`${candidateId} ${sha.slice(0, 12)} workspacePackage=${out.workspacePackagePresent}`);
for (const line of lines) console.log(`  ${line}`);
console.log(`written ${path.relative(FAMILY_ROOT, file)}`);
