// One small batch-level admission guard.
//
// It answers a single question before every paid dispatch: if this request costs
// its maximum, does the aggregate stay inside the approved ceiling? It is not a
// billing service and it never talks to a provider; it is an append-only record of
// reservations and settlements plus an atomic reserve step.
//
// Accounting model (no double counting)
// -------------------------------------
//   approved ceiling            1.00
//   historical settled          0.31639530   (immutable, verified from the ledger)
//   historical conservative     0.55929      (superset: settled + unresolved and
//                                             settlement-lag reserve)
//   committed = max(settled, conservative) = 0.55929    <- never their sum
//   available = 1.00 - committed            = 0.44071
//
// A new request is admitted only if
//   committed + Σ unsettled reservations + Σ settled new stages + requestMax <= 1.00.
// A settled reservation keeps its settled amount and releases the rest; an
// unresolved one keeps its full reservation, because an unknown cost is never
// treated as zero.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { BUDGET_DIR } from "./paths.mjs";
import { PRICING, requestMaxUsd } from "./limits.mjs";

export const APPROVED_CEILING_USD = 1.0;

/** Frozen historical figures, verified against the retained reconciliation. */
export const HISTORICAL = Object.freeze({
  settledUsd: 0.3163953,
  conservativeUsd: 0.55929,
  reconciliationPath: "synthetic/runs/d12-recheck/reconciliation.json",
});

const usd = (value) => Number(Number(value).toFixed(8));

export function committedUsd(historical = HISTORICAL) {
  return usd(Math.max(historical.settledUsd, historical.conservativeUsd));
}

export function availableUsd(historical = HISTORICAL) {
  return usd(APPROVED_CEILING_USD - committedUsd(historical));
}

/** Reads the frozen reconciliation and proves the carried figure is still its total. */
export function verifyHistorical(researchRoot) {
  const file = path.join(researchRoot, HISTORICAL.reconciliationPath);
  const reconciliation = JSON.parse(fs.readFileSync(file, "utf8"));
  const conservative = usd(reconciliation?.totals?.conservativeUsd);
  if (conservative !== HISTORICAL.conservativeUsd) {
    throw new Error(
      `historical conservative total drifted: reconciliation says ${conservative}, frozen figure is ${HISTORICAL.conservativeUsd}`,
    );
  }
  const remaining = usd(reconciliation?.remaining?.conservativeUsd);
  if (remaining !== availableUsd()) {
    throw new Error(`historical remaining drifted: ${remaining} vs computed ${availableUsd()}`);
  }
  if (reconciliation?.ceilingUsd !== APPROVED_CEILING_USD) {
    throw new Error(`approved ceiling drifted: ${reconciliation?.ceilingUsd}`);
  }
  return { conservative, remaining, ceilingUsd: APPROVED_CEILING_USD, file: HISTORICAL.reconciliationPath };
}

function emptyGuard() {
  return {
    schema: "next-family.budget-guard/v1",
    approvedCeilingUsd: APPROVED_CEILING_USD,
    historical: { ...HISTORICAL, committedUsd: committedUsd() },
    pricing: PRICING,
    reservations: [],
    createdAt: new Date().toISOString(),
  };
}

const stateFiles = (dir) => ({ guard: path.join(dir, "batch-guard.json"), lock: path.join(dir, "batch-guard.lock") });

function readGuard(dir = BUDGET_DIR) {
  const { guard } = stateFiles(dir);
  if (!fs.existsSync(guard)) return emptyGuard();
  return JSON.parse(fs.readFileSync(guard, "utf8"));
}

function writeGuard(guard, dir = BUDGET_DIR) {
  const { guard: file } = stateFiles(dir);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(guard, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Bounded spin on an exclusive lock file, so concurrent admissions serialize. */
function withLock(dir, fn, { attempts = 400, sleepMs = 5 } = {}) {
  const { lock } = stateFiles(dir);
  fs.mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + attempts * sleepMs;
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      try {
        fs.writeSync(fd, String(process.pid));
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() > deadline) throw new Error("budget guard is locked by another admission");
      const until = Date.now() + sleepMs;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Totals of the new stages, computed from the reservation list. */
export function totals(guard) {
  const reservations = guard.reservations;
  const settled = reservations
    .filter((entry) => entry.state === "settled")
    .reduce((sum, entry) => sum + entry.settledUsd, 0);
  const unresolved = reservations
    .filter((entry) => entry.state === "unresolved")
    .reduce((sum, entry) => sum + entry.maxUsd, 0);
  const held = reservations
    .filter((entry) => entry.state === "reserved")
    .reduce((sum, entry) => sum + entry.maxUsd, 0);
  const newSpendUsd = usd(settled + unresolved + held);
  return {
    settledUsd: usd(settled),
    unresolvedUsd: usd(unresolved),
    reservedUsd: usd(held),
    newSpendUsd,
    aggregateWorstCaseUsd: usd(committedUsd() + newSpendUsd),
    remainingUsd: usd(APPROVED_CEILING_USD - committedUsd() - newSpendUsd),
  };
}

/**
 * Reserve the admitted maximum before forwarding. Refuses when the aggregate
 * worst case would exceed the ceiling, when the request key was already used, or
 * when the caller's own request maximum is not the one the guard recomputes.
 */
export function reserve({ requestKey, attemptId, candidateId, stageId, maxUsd, inputTokens, outputTokens, dir = BUDGET_DIR }) {
  const recomputed = requestMaxUsd({ inputTokens, outputTokens });
  return withLock(dir, () => {
    const guard = readGuard(dir);
    const existing = guard.reservations.find((entry) => entry.requestKey === requestKey);
    if (existing) {
      return { admitted: false, reason: "duplicate_request_key", existing, totals: totals(guard) };
    }
    if (usd(recomputed) > usd(maxUsd) + 1e-12) {
      return {
        admitted: false,
        reason: "reservation_understates_maximum",
        computed: recomputed,
        claimed: maxUsd,
        totals: totals(guard),
      };
    }
    const before = totals(guard);
    if (usd(before.aggregateWorstCaseUsd + maxUsd) > APPROVED_CEILING_USD + 1e-12) {
      return { admitted: false, reason: "aggregate_ceiling", requestedUsd: maxUsd, totals: before };
    }
    guard.reservations.push({
      requestKey,
      attemptId,
      candidateId,
      stageId,
      maxUsd: usd(maxUsd),
      state: "reserved",
      reservedAt: new Date().toISOString(),
    });
    writeGuard(guard, dir);
    return { admitted: true, requestedUsd: usd(maxUsd), totals: totals(guard) };
  });
}

/**
 * Settle one reservation against reported usage. Missing or unreliable usage keeps
 * the full reservation and marks it unresolved: an unknown cost is never zero.
 */
export function settle({ requestKey, chargedInputTokens, chargedOutputTokens, usageReliable, dir = BUDGET_DIR }) {
  return withLock(dir, () => {
    const guard = readGuard(dir);
    const entry = guard.reservations.find((item) => item.requestKey === requestKey);
    if (!entry) return { settled: false, reason: "unknown_request_key" };
    if (entry.state !== "reserved") return { settled: false, reason: `already_${entry.state}`, entry };
    if (!usageReliable || !Number.isFinite(chargedInputTokens) || !Number.isFinite(chargedOutputTokens)) {
      entry.state = "unresolved";
      entry.settledAt = new Date().toISOString();
      entry.note = "usage missing or unreliable; the full reservation is kept";
      writeGuard(guard, dir);
      return { settled: true, state: "unresolved", heldUsd: entry.maxUsd, totals: totals(guard) };
    }
    const settledUsd = requestMaxUsd({ inputTokens: chargedInputTokens, outputTokens: chargedOutputTokens });
    entry.state = "settled";
    entry.settledUsd = usd(Math.min(settledUsd, entry.maxUsd));
    entry.charged = { inputTokens: chargedInputTokens, outputTokens: chargedOutputTokens };
    entry.settledAt = new Date().toISOString();
    writeGuard(guard, dir);
    return { settled: true, state: "settled", settledUsd: entry.settledUsd, totals: totals(guard) };
  });
}

export function readState(dir = BUDGET_DIR) {
  return readGuard(dir);
}

export { withLock as _withLock };
