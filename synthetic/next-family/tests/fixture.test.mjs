// Fixture-level checks with no model in the loop.
//
// 1. Each candidate is materialized from its commit into a temporary directory, so
//    the suite runs against exactly the frozen tree and never mutates the fixture
//    repository.
// 2. The complete-control scenarios (C1–C5 plus the C1/C3/C4 precedence
//    interactions) are executed directly against each candidate.
// 3. The revised c03 is proved to be an evidence-boundary case, not a module
//    resolution defect: the external package resolves, the suite runs green, the
//    decisive classification is outside the reviewed checkout, and the same tree
//    fails with ERR_MODULE_NOT_FOUND only when that package is absent.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { FAMILY_ROOT, FIXTURE_REPO } from "../lib/paths.mjs";
import { loadFamily, loadPacket } from "../lib/task.mjs";

const family = loadFamily(FAMILY_ROOT);

const git = (...args) => execFileSync("git", ["-C", FIXTURE_REPO, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Write the exact tree of one commit into a fresh directory. */
function materialize(sha, { withWorkspacePackage = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `next-family-${sha.slice(0, 7)}-`));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const files = git("ls-tree", "-r", "--name-only", sha).split("\n").filter(Boolean);
  for (const file of files) {
    const target = path.join(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git("show", `${sha}:${file}`));
  }
  if (withWorkspacePackage) {
    // The workspace package is a sibling of the service repository, exactly as the
    // task statement declares.
    fs.cpSync(path.join(FAMILY_ROOT, "packages", "delivery-core"), path.join(root, "packages", "delivery-core"), {
      recursive: true,
    });
  }
  return { root, repo, files };
}

const loads = new Map();
async function loadCandidate(candidateId) {
  if (!loads.has(candidateId)) {
    const sha = family.candidates[candidateId];
    const tree = materialize(sha, { withWorkspacePackage: candidateId === "c03" });
    const load = (file) => import(pathToFileURL(path.join(tree.repo, file)).href);
    loads.set(candidateId, {
      sha,
      tree,
      router: await load("src/router.ts"),
      store: await load("src/store.ts"),
      delivery: await load("src/delivery.ts"),
    });
  }
  return loads.get(candidateId);
}

const seeded = (DeliveryStore) => {
  const store = new DeliveryStore();
  store.addSubscription({ id: "sub-1", targetUrl: "https://example.test/hook", status: "active" });
  return store;
};

const post = (handle, store, body, headers = {}) =>
  handle(store, { method: "POST", path: "/deliveries", headers, body: JSON.stringify(body) });

async function scenarios(candidateId) {
  const { router, store: storeModule, delivery } = await loadCandidate(candidateId);
  const { handle } = router;
  const { DeliveryStore } = storeModule;
  const { attemptDelivery } = delivery;
  const out = {};

  const fresh = () => seeded(DeliveryStore);
  const valid = (store, payload = "alpha", headers = {}) => post(handle, store, { subscriptionId: "sub-1", payload }, headers);

  {
    const store = fresh();
    const first = JSON.parse(valid(store, "alpha", { "idempotency-key": "k-1" }).body);
    const second = JSON.parse(valid(store, "alpha", { "idempotency-key": "k-1" }).body);
    out.c1_same_key_same_payload = { sameId: second.id === first.id, queued: store.queued().length };
  }
  {
    const store = fresh();
    const first = JSON.parse(valid(store, "alpha", { "idempotency-key": "k-1" }).body);
    const second = JSON.parse(valid(store, "alpha-two", { "idempotency-key": "k-1" }).body);
    out.c1_same_key_different_payload = { sameId: second.id === first.id, queued: store.queued().length };
  }
  {
    const store = fresh();
    valid(store, "alpha");
    valid(store, "alpha");
    out.c1_no_key_twice = { queued: store.queued().length };
  }
  // Precedence: C3 before C1 and before C4.
  {
    const store = fresh();
    valid(store, "alpha", { "idempotency-key": "k-9" });
    const oversizedRepeat = post(handle, store, { subscriptionId: "sub-1", payload: "x".repeat(65_537) }, { "idempotency-key": "k-9" });
    out.c1_c3_precedence = { status: oversizedRepeat.status, queued: store.queued().length };
  }
  {
    const store = fresh();
    const unknown = post(handle, store, { subscriptionId: "sub-missing", payload: "x".repeat(65_537) });
    out.c3_over_unknown_subscription = { status: unknown.status, queued: store.queued().length };
  }
  // Precedence: C4 before C1.
  {
    const store = fresh();
    valid(store, "alpha", { "idempotency-key": "k-7" });
    store.disableSubscription("sub-1");
    const repeat = valid(store, "alpha", { "idempotency-key": "k-7" });
    out.c1_c4_precedence = { status: repeat.status, queued: store.queued().length };
  }
  {
    const store = fresh();
    const created = JSON.parse(valid(store).body);
    let calls = 0;
    const deliveryRecord = await attemptDelivery(store, created.id, async () => {
      calls += 1;
      return 500;
    });
    out.c2_persistent_5xx = { targetCalls: calls, attempts: deliveryRecord?.attempts ?? null, state: deliveryRecord?.state ?? null };
  }
  // Delay growth: the gap before the third attempt must exceed the gap before the second.
  {
    const store = fresh();
    const created = JSON.parse(valid(store).body);
    const stamps = [];
    await attemptDelivery(store, created.id, async () => {
      stamps.push(Date.now());
      return 503;
    });
    out.c2_delay_growth = { gaps: stamps.slice(1).map((stamp, index) => stamp - stamps[index]), calls: stamps.length };
  }
  {
    const store = fresh();
    const created = JSON.parse(valid(store).body);
    let calls = 0;
    const deliveryRecord = await attemptDelivery(store, created.id, async () => {
      calls += 1;
      return 400;
    });
    out.c2_400_is_final = { targetCalls: calls, state: deliveryRecord?.state ?? null };
  }
  {
    const store = fresh();
    const created = JSON.parse(valid(store).body);
    let calls = 0;
    const deliveryRecord = await attemptDelivery(store, created.id, async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return 200;
    });
    out.c2_network_error_retried = { targetCalls: calls, state: deliveryRecord?.state ?? null };
  }
  {
    const store = fresh();
    const over = post(handle, store, { subscriptionId: "sub-1", payload: "x".repeat(65_537) });
    const at = post(handle, store, { subscriptionId: "sub-1", payload: "x".repeat(65_536) });
    out.c3_limits = { over: over.status, at: at.status, queued: store.queued().length };
  }
  {
    const store = fresh();
    const created = JSON.parse(valid(store).body);
    const deliveryRecord = await attemptDelivery(store, created.id, async () => 410);
    store.disableSubscription("sub-1");
    const intake = post(handle, store, { subscriptionId: "sub-1", payload: "alpha" });
    out.c4_lifecycle = {
      subscription: (store.getSubscription("sub-1")?.status ?? null),
      state: deliveryRecord?.state ?? null,
      intake: intake.status,
      queued: store.queued().length,
    };
  }
  {
    const health = handle(fresh(), { method: "GET", path: "/health", headers: {} });
    out.c5_health = { status: health.status, body: JSON.parse(health.body) };
  }
  return out;
}

const expected = JSON.parse(fs.readFileSync(path.join(FAMILY_ROOT, "evaluator", "ORACLE.json"), "utf8"));

test("the complete control satisfies every criterion, including the precedence interactions", async () => {
  const observed = await scenarios("c01");
  assert.deepEqual(observed.c1_same_key_different_payload, { sameId: true, queued: 1 });
  assert.deepEqual(observed.c1_no_key_twice, { queued: 2 });
  assert.deepEqual(observed.c1_c3_precedence, { status: 413, queued: 1 }, "C3 precedes C1");
  assert.deepEqual(observed.c3_over_unknown_subscription, { status: 413, queued: 0 }, "C3 precedes the subscription check");
  assert.deepEqual(observed.c1_c4_precedence, { status: 409, queued: 1 }, "C4 precedes C1");
  assert.deepEqual(observed.c2_persistent_5xx, { targetCalls: 3, attempts: 3, state: "failed" });
  assert.deepEqual(observed.c2_400_is_final, { targetCalls: 1, state: "failed" });
  assert.deepEqual(observed.c2_network_error_retried, { targetCalls: 2, state: "delivered" });
  assert.equal(observed.c2_delay_growth.calls, 3);
  assert.ok(
    observed.c2_delay_growth.gaps[1] > observed.c2_delay_growth.gaps[0],
    `the delay must grow: ${JSON.stringify(observed.c2_delay_growth.gaps)}`,
  );
  assert.deepEqual(observed.c3_limits, { over: 413, at: 202, queued: 1 });
  assert.equal(observed.c4_lifecycle.intake, 409);
  assert.equal(observed.c4_lifecycle.subscription, "disabled");
  assert.deepEqual(observed.c5_health, { status: 200, body: { status: "ok" } });
});

test("c02 collapses by payload, not by key, and keeps the precedence order", async () => {
  const observed = await scenarios("c02");
  assert.deepEqual(observed.c1_same_key_different_payload, { sameId: false, queued: 2 }, "the C1 defect");
  assert.deepEqual(observed.c1_no_key_twice, { queued: 1 }, "two keyless identical submissions collapse");
  assert.deepEqual(observed.c1_c3_precedence, { status: 413, queued: 1 });
  assert.deepEqual(observed.c1_c4_precedence, { status: 409, queued: 1 });
  assert.deepEqual(observed.c2_persistent_5xx, { targetCalls: 3, attempts: 3, state: "failed" });
  assert.equal(observed.c3_limits.over, 413);
  assert.equal(observed.c4_lifecycle.intake, 409);
});

test("the revised c03 runs its retry path and is inconclusive only for the withheld basis", async () => {
  const observed = await scenarios("c03");
  assert.deepEqual(observed.c2_persistent_5xx, { targetCalls: 3, attempts: 3, state: "failed" }, "not a resolution defect");
  assert.deepEqual(observed.c2_400_is_final, { targetCalls: 1, state: "failed" });
  assert.deepEqual(observed.c2_network_error_retried, { targetCalls: 2, state: "delivered" });
  assert.ok(observed.c2_delay_growth.gaps[1] > observed.c2_delay_growth.gaps[0]);
  assert.deepEqual(observed.c1_same_key_different_payload, { sameId: true, queued: 1 });
  assert.equal(observed.c3_limits.over, 413);
  assert.equal(observed.c4_lifecycle.intake, 409);
});

test("the decisive retry classification lives outside the reviewed checkout", () => {
  const sha = family.candidates.c03;
  const tracked = git("ls-tree", "-r", "--name-only", sha).split("\n").filter(Boolean);
  assert.equal(tracked.some((file) => file.startsWith("packages/")), false, "the workspace package is not in the commit");
  const pkg = path.join(FAMILY_ROOT, "packages", "delivery-core", "src", "retry.ts");
  assert.ok(fs.existsSync(pkg), "the package exists in the workspace, as declared");
  assert.ok(!fs.existsSync(path.join(FIXTURE_REPO, "packages")), "the package is not a directory of the service repository");

  const packet = loadPacket("c03", family).text;
  assert.ok(packet.includes("packages/delivery-core/src/retry.ts"), "the delegation call site is visible");
  assert.ok(packet.includes("@fixture/delivery-core"), "the dependency is declared in the task inputs");
  assert.ok(!/function classify\s*\(/.test(packet), "no classification implementation is provided");
  assert.ok(!/status >= 500 && status <= 599/.test(packet), "no threshold logic is provided");
  assert.ok(!packet.includes("nextInt"), "no evaluator helper leaked in");
});

test("without the workspace package the same tree fails, which is why the case needs a declared boundary", async () => {
  const sha = family.candidates.c03;
  const tree = materialize(sha, { withWorkspacePackage: false });
  const { attemptDelivery } = await import(pathToFileURL(path.join(tree.repo, "src", "delivery.ts")).href);
  const router = await import(pathToFileURL(path.join(tree.repo, "src", "router.ts")).href);
  const storeModule = await import(pathToFileURL(path.join(tree.repo, "src", "store.ts")).href);
  const store = seeded(storeModule.DeliveryStore);
  const created = JSON.parse(
    router.handle(store, {
      method: "POST",
      path: "/deliveries",
      headers: {},
      body: JSON.stringify({ subscriptionId: "sub-1", payload: "alpha" }),
    }).body,
  );
  await assert.rejects(
    () => attemptDelivery(store, created.id, async () => 500),
    (error) => error.code === "ERR_MODULE_NOT_FOUND",
    "the dependency is genuinely decisive",
  );
});

test("every candidate's own suite runs green with no skips", async () => {
  const receipts = {};
  for (const candidateId of Object.keys(family.candidates)) {
    const tree = materialize(family.candidates[candidateId], { withWorkspacePackage: candidateId === "c03" });
    const testFiles = tree.files.filter((file) => /^tests\/.+\.test\.ts$/.test(file));
    // The child must be a plain `node --test` run: inheriting this runner's test
    // context would make it skip its files instead of executing them.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_OPTIONS;
    const child = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--test", "--test-concurrency=1", ...testFiles],
      { cwd: tree.repo, encoding: "utf8", env: childEnv },
    );
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    assert.equal(child.status, 0, `${candidateId} suite exited ${child.status}: ${output.slice(-800)}`);
    const count = (label) => Number(output.match(new RegExp(`ℹ ${label} (\\d+)`, "u"))?.[1] ?? NaN);
    receipts[candidateId] = {
      tests: count("tests"),
      pass: count("pass"),
      fail: count("fail"),
      skipped: count("skipped"),
    };
    assert.equal(receipts[candidateId].fail, 0, `${candidateId} must not fail`);
    assert.equal(receipts[candidateId].skipped, 0, `${candidateId} must not skip: the retry path is available`);
    assert.equal(receipts[candidateId].pass, receipts[candidateId].tests);
  }
  assert.deepEqual(receipts.c01, { tests: 17, pass: 17, fail: 0, skipped: 0 });
  assert.deepEqual(receipts.c02, { tests: 16, pass: 16, fail: 0, skipped: 0 });
  assert.deepEqual(receipts.c03, { tests: 17, pass: 17, fail: 0, skipped: 0 });
});

test("the evaluator expectation matches the observed behaviour", async () => {
  const observed = await scenarios("c03");
  assert.equal(expected.expected.c03.C2, "inconclusive");
  assert.equal(observed.c2_persistent_5xx.targetCalls, 3, "the behaviour is satisfied; only the evidence is missing");
  assert.equal(expected.expected.c01.C1, "satisfied");
  assert.equal(expected.expected.c02.C1, "violated");
});
