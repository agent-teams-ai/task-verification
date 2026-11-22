// The budget guard is the only thing standing between a plausible plan and a
// USD 1.00 ceiling. These tests pin the arithmetic, the no-double-counting rule,
// the settle/unresolved semantics and concurrent admission.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { FAMILY_ROOT, RESEARCH_ROOT } from "../lib/paths.mjs";
import { loadFamily } from "../lib/task.mjs";
import {
  BATCH_MAX_USD,
  CRITERIA_REQUEST_MAX_USD,
  INPUT_TOKEN_CEILING,
  MAX_OUTPUT_TOKENS,
  OCR_REQUEST_MAX_USD,
  PRICING,
  STAGE_PLAN,
  requestMaxUsd,
  worstCaseUsd,
} from "../lib/limits.mjs";
import {
  APPROVED_CEILING_USD,
  HISTORICAL,
  availableUsd,
  committedUsd,
  readState,
  reserve,
  settle,
  totals,
  verifyHistorical,
} from "../lib/budget.mjs";

const execFileAsync = promisify(execFile);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-family-budget-"));
const family = loadFamily(FAMILY_ROOT);

test("historical expenditure reconciles against the retained reconciliation", () => {
  const verified = verifyHistorical(RESEARCH_ROOT);
  assert.equal(verified.conservative, HISTORICAL.conservativeUsd);
  assert.equal(verified.remaining, 0.44071);
  assert.equal(verified.ceilingUsd, APPROVED_CEILING_USD);
  assert.equal(HISTORICAL.settledUsd, 0.3163953);
});

test("settled cost and its conservative envelope are never added together", () => {
  assert.equal(committedUsd(), 0.55929, "committed is the larger figure, not the sum");
  assert.equal(availableUsd(), 0.44071);
  assert.notEqual(committedUsd(), Number((HISTORICAL.settledUsd + HISTORICAL.conservativeUsd).toFixed(8)));
});

test("the corrected ceilings fit the approved authorization", () => {
  assert.equal(INPUT_TOKEN_CEILING, 28_736);
  assert.equal(CRITERIA_REQUEST_MAX_USD, 0.04842);
  assert.equal(OCR_REQUEST_MAX_USD, 0.0275);
  assert.equal((STAGE_PLAN.criteriaRequests + STAGE_PLAN.correctionReserveRequests) * CRITERIA_REQUEST_MAX_USD, 0.19368);
  assert.equal(STAGE_PLAN.ocrForwardedRequests * OCR_REQUEST_MAX_USD, 0.22);
  assert.equal(BATCH_MAX_USD, 0.41368);
  assert.ok(BATCH_MAX_USD <= availableUsd(), "the corrected worst case fits the remaining envelope");
  assert.ok(committedUsd() + BATCH_MAX_USD <= APPROVED_CEILING_USD);
  assert.equal(Number((committedUsd() + BATCH_MAX_USD).toFixed(8)), 0.97297);
});

test("the planned correction reserve survives the corrected input ceiling", () => {
  const threeCalls = STAGE_PLAN.criteriaRequests * CRITERIA_REQUEST_MAX_USD;
  const oneReserve = STAGE_PLAN.correctionReserveRequests * CRITERIA_REQUEST_MAX_USD;
  assert.ok(threeCalls + oneReserve + STAGE_PLAN.ocrForwardedRequests * OCR_REQUEST_MAX_USD <= availableUsd());
  // If OCR kept the D3 proposal of ten forwarded requests the batch would breach:
  const withTenOcr = threeCalls + oneReserve + 10 * OCR_REQUEST_MAX_USD;
  assert.ok(withTenOcr > availableUsd(), "ten OCR forwards no longer fit, which is why the cap is eight");
  assert.ok(availableUsd() - (threeCalls + oneReserve + STAGE_PLAN.ocrForwardedRequests * OCR_REQUEST_MAX_USD) > 0.02);
});

test("a reservation is admitted only when the aggregate worst case fits", () => {
  const dir = tempDir();
  const first = reserve({
    requestKey: "k1",
    attemptId: "att-1",
    candidateId: "c01",
    stageId: "criteria",
    maxUsd: CRITERIA_REQUEST_MAX_USD,
    inputTokens: INPUT_TOKEN_CEILING,
    outputTokens: MAX_OUTPUT_TOKENS,
    dir,
  });
  assert.equal(first.admitted, true);
  assert.equal(first.totals.aggregateWorstCaseUsd, Number((committedUsd() + CRITERIA_REQUEST_MAX_USD).toFixed(8)));

  const duplicate = reserve({
    requestKey: "k1",
    attemptId: "att-2",
    candidateId: "c01",
    stageId: "criteria",
    maxUsd: CRITERIA_REQUEST_MAX_USD,
    inputTokens: INPUT_TOKEN_CEILING,
    outputTokens: MAX_OUTPUT_TOKENS,
    dir,
  });
  assert.equal(duplicate.admitted, false);
  assert.equal(duplicate.reason, "duplicate_request_key");

  const understated = reserve({
    requestKey: "k2",
    attemptId: "att-3",
    candidateId: "c02",
    stageId: "criteria",
    maxUsd: 0.001,
    inputTokens: INPUT_TOKEN_CEILING,
    outputTokens: MAX_OUTPUT_TOKENS,
    dir,
  });
  assert.equal(understated.admitted, false);
  assert.equal(understated.reason, "reservation_understates_maximum");

  const over = reserve({
    requestKey: "k3",
    attemptId: "att-4",
    candidateId: "c03",
    stageId: "criteria",
    maxUsd: availableUsd(),
    inputTokens: Math.ceil((availableUsd() - 0.5) * 1e6),
    outputTokens: 10,
    dir,
  });
  assert.equal(over.admitted, false, "a request that would breach the ceiling is refused before dispatch");
  assert.equal(over.reason, "aggregate_ceiling");
});

test("settlement releases the unused reservation and missing usage does not", () => {
  const dir = tempDir();
  reserve({ requestKey: "a", attemptId: "att-a", candidateId: "c01", stageId: "criteria", maxUsd: CRITERIA_REQUEST_MAX_USD, inputTokens: INPUT_TOKEN_CEILING, outputTokens: MAX_OUTPUT_TOKENS, dir });
  reserve({ requestKey: "b", attemptId: "att-b", candidateId: "c02", stageId: "criteria", maxUsd: CRITERIA_REQUEST_MAX_USD, inputTokens: INPUT_TOKEN_CEILING, outputTokens: MAX_OUTPUT_TOKENS, dir });
  assert.equal(totals(readState(dir)).reservedUsd, 0.09684);

  const settled = settle({ requestKey: "a", chargedInputTokens: 1_000, chargedOutputTokens: 200, usageReliable: true, dir });
  assert.equal(settled.state, "settled");
  assert.equal(settled.settledUsd, requestMaxUsd({ inputTokens: 1_000, outputTokens: 200 }));

  const unresolved = settle({ requestKey: "b", chargedInputTokens: 0, chargedOutputTokens: 0, usageReliable: false, dir });
  assert.equal(unresolved.state, "unresolved");
  assert.equal(unresolved.heldUsd, CRITERIA_REQUEST_MAX_USD, "an unknown cost keeps the whole reservation");

  const state = totals(readState(dir));
  assert.equal(state.reservedUsd, 0);
  assert.equal(state.unresolvedUsd, CRITERIA_REQUEST_MAX_USD);
  assert.ok(state.remainingUsd < availableUsd());
  // Settling twice cannot double-count.
  const again = settle({ requestKey: "a", chargedInputTokens: 1_000, chargedOutputTokens: 200, usageReliable: true, dir });
  assert.equal(again.settled, false);
  assert.equal(again.reason, "already_settled");
});

test("concurrent admissions cannot over-reserve the remaining envelope", async () => {
  const dir = tempDir();
  const workers = 6;
  const maxUsd = 0.08;
  const inputTokens = 64_000;
  const outputTokens = 0;
  assert.ok(requestMaxUsd({ inputTokens, outputTokens }) === maxUsd);
  const helper = path.join(FAMILY_ROOT, "tests", "helpers", "reserve-child.mjs");
  assert.ok(fs.existsSync(helper));

  const results = await Promise.all(
    Array.from({ length: workers }, (_unused, index) =>
      execFileAsync(process.execPath, [helper, dir, `key-${index}`, String(maxUsd), String(inputTokens)], {
        encoding: "utf8",
      }).then(
        (out) => JSON.parse(out.stdout),
        (error) => ({ admitted: false, reason: "child_failed", stderr: String(error.stderr) }),
      ),
    ),
  );

  const admitted = results.filter((result) => result.admitted === true);
  const refused = results.filter((result) => result.admitted === false);
  assert.equal(admitted.length, 5, "floor(0.44071 / 0.08) = 5 requests fit");
  assert.equal(refused.length, 1);
  assert.ok(refused.every((result) => result.reason === "aggregate_ceiling"));
  const state = totals(readState(dir));
  assert.ok(state.newSpendUsd <= availableUsd() + 1e-9, "the guard never over-reserves");
  assert.equal(state.reservedUsd, Number((admitted.length * maxUsd).toFixed(8)));
});

test("cache writes, cache reads and reasoning are never understated", () => {
  const plain = worstCaseUsd({ inputTokens: 10_000, outputTokens: 1_000 });
  assert.equal(plain, Number(((10_000 * 1.25) / 1e6 + (1_000 * 5) / 1e6).toFixed(8)));
  // A cache-read split is charged at the full input rate, never at the 0.05/M read rate.
  const withCache = worstCaseUsd({ inputTokens: 8_000, cacheWriteTokens: 2_000, cacheReadTokens: 5_000, outputTokens: 1_000 });
  assert.equal(withCache, Number(((15_000 * 1.25) / 1e6 + (1_000 * 5) / 1e6).toFixed(8)));
  assert.ok(withCache > plain, "crediting the cache-read rate would have lowered the estimate");
  assert.equal(PRICING.cacheReadUsdPerMillion, 0.05);
  assert.equal(PRICING.inputUsdPerMillion, 1.25);
  // The reasoning block is billed as output, so an output ceiling covers it.
  assert.equal(MAX_OUTPUT_TOKENS, 2_500);
});

test("family.json accounting agrees with the guard", () => {
  assert.equal(family.accounting.approvedCeilingUsd, APPROVED_CEILING_USD);
  assert.equal(family.accounting.historicalSettledUsd, HISTORICAL.settledUsd);
  assert.equal(family.accounting.historicalConservativeUsd, HISTORICAL.conservativeUsd);
  assert.equal(family.caps.ocrForwardedRequests, STAGE_PLAN.ocrForwardedRequests);
  assert.equal(family.caps.criteriaRequests, STAGE_PLAN.criteriaRequests);
  assert.equal(family.caps.correctionReserveRequests, STAGE_PLAN.correctionReserveRequests);
  assert.equal(family.caps.pricingInputUsdPerMillion, 1.25);
  assert.equal(family.caps.pricingOutputUsdPerMillion, 5);
});
