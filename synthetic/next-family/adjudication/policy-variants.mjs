// Model-free qualification of the c03 derivative's genuine uncertainty (D3-R3 §8B).
//
//   node --experimental-strip-types synthetic/next-family/adjudication/policy-variants.mjs <derivativeSha>
//
// The derivative delegates retry classification and delay to the workspace package
// `@fixture/delivery-core`, which is external to the reviewed checkout and is not in
// the reviewer packet. This script runs the *same* candidate tree against two
// different, individually legitimate implementations of that package and shows that
// the two produce different observable retry behaviour. The reviewer-visible packet
// is byte-identical in both runs.
//
// "Legitimate" here means: a plausible policy a workspace owner could author. One
// conforms to the authored C2 wording, the other does not. Nothing in the packet
// distinguishes them, which is exactly the evidence boundary c03 exists to test.
//
// Each variant runs in its own child process: the candidate imports the policy by a
// fixed specifier, so an in-process second variant would silently reuse the first
// module from the ESM cache.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FAMILY_ROOT } from "../lib/paths.mjs";
import { materialize } from "../lib/fixture.mjs";

const VARIANTS = {
  // Retry network errors and 5xx only; exponential growth. Conforms to C2.
  "conforming-5xx-only": `export type RetryDecision = "retry" | "final";
export function classify(status: number): RetryDecision {
  if (status === 0) return "retry";
  if (status >= 500 && status <= 599) return "retry";
  return "final";
}
export function nextDelayMs(attempt: number): number {
  return Math.min(100 * 2 ** (attempt - 1), 2_000);
}
`,
  // Treat 429 as transient as well; linear growth. A common but non-conforming reading.
  "transient-429-included": `export type RetryDecision = "retry" | "final";
export function classify(status: number): RetryDecision {
  if (status === 0) return "retry";
  if (status === 429) return "retry";
  if (status >= 500 && status <= 599) return "retry";
  return "final";
}
export function nextDelayMs(attempt: number): number {
  return Math.min(250 * attempt, 2_000);
}
`,
};

const [sha, variantName] = process.argv.slice(2);

if (!sha) {
  console.error("usage: policy-variants.mjs <derivativeSha>");
  process.exit(2);
}

/** Runs one variant in this process. Only used in the child. */
async function runVariant(name) {
  const source = VARIANTS[name];
  if (!source) throw new Error(`unknown variant: ${name}`);

  const tree = materialize(sha, { withWorkspacePackage: true, prefix: `d3-policy-${name}` });
  fs.writeFileSync(path.join(tree.root, "packages", "delivery-core", "src", "retry.ts"), source);

  const load = (p) => import(pathToFileURL(path.join(tree.repo, p)).href);
  const { handle } = await load("src/router.ts");
  const { DeliveryStore } = await load("src/store.ts");
  const { attemptDelivery } = await load("src/delivery.ts");

  const create = () => {
    const store = new DeliveryStore();
    store.addSubscription({ id: "sub-1", targetUrl: "https://example.test/hook", status: "active" });
    const id = JSON.parse(
      handle(store, {
        method: "POST",
        path: "/deliveries",
        headers: {},
        body: JSON.stringify({ subscriptionId: "sub-1", payload: "alpha" }),
      }).body,
    ).id;
    return { store, id };
  };

  const runs = {};
  for (const status of [500, 400, 429, 0]) {
    const { store, id } = create();
    let calls = 0;
    const stamps = [];
    const delivery = await attemptDelivery(store, id, async () => {
      calls += 1;
      stamps.push(Date.now());
      if (status === 0) throw new Error("connection reset");
      return status;
    });
    const gaps = stamps.slice(1).map((stamp, index) => stamp - stamps[index]);
    runs[`status_${status}`] = {
      targetCalls: calls,
      gapsMs: gaps,
      grows: gaps.length === 2 ? gaps[1] > gaps[0] : null,
      state: delivery?.state ?? null,
      attempts: delivery?.attempts ?? null,
    };
  }

  const { store, id } = create();
  const perInvocation = [];
  let total = 0;
  for (let i = 0; i < 2; i += 1) {
    let calls = 0;
    await attemptDelivery(store, id, async () => {
      calls += 1;
      total += 1;
      return 400;
    });
    perInvocation.push(calls);
  }
  runs.reentry_after_400 = { callsPerInvocation: perInvocation, totalTargetCalls: total, state: store.get(id)?.state ?? null };

  return { policySha256: crypto.createHash("sha256").update(source).digest("hex"), runs };
}

if (variantName) {
  const result = await runVariant(variantName);
  process.stdout.write(`${JSON.stringify({ variant: variantName, ...result })}\n`);
} else {
  const out = { schema: "d3-r3.policy-variants/v1", head: sha, variants: {} };
  for (const name of Object.keys(VARIANTS)) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", process.argv[1], sha, name], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`variant ${name} failed: ${child.stderr}`);
    const parsed = JSON.parse(child.stdout.trim().split("\n").pop());
    out.variants[parsed.variant] = { policySha256: parsed.policySha256, runs: parsed.runs };
  }

  const dir = path.join(FAMILY_ROOT, "adjudication", "reproductions");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "c03r-policy-variants.json");
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

  for (const [name, value] of Object.entries(out.variants)) {
    const r = value.runs;
    console.log(
      `${name} 500:${r.status_500.targetCalls}calls 400:${r.status_400.targetCalls}calls 429:${r.status_429.targetCalls}calls/${r.status_429.state} net:${r.status_0.targetCalls} gaps429=${JSON.stringify(r.status_429.gapsMs)} reentry=${JSON.stringify(r.reentry_after_400.callsPerInvocation)}`,
    );
  }
  console.log(`written ${path.relative(FAMILY_ROOT, file)}`);
}
