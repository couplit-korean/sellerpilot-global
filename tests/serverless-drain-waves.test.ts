import assert from "node:assert/strict";
import test from "node:test";
import { collectDrainWaves, SERVERLESS_DRAIN_MAX_WAVES, SERVERLESS_DRAIN_REFILL_BUDGET_MS } from "../lib/channels/serverless-drain-waves";

const done = { httpStatus: 200, status: "succeeded", claimed: 1, processed: 1 };
const idle = { httpStatus: 200, status: "idle", claimed: 0, processed: 0 };

test("refills after each channel releases its lease and stops at an empty wave", async () => {
  let calls = 0;
  let active = false;
  const results = await collectDrainWaves(async () => {
    assert.equal(active, false, "a new wave must await the prior completion");
    active = true;
    await Promise.resolve();
    active = false;
    return ++calls <= 3 ? [done, idle] : [idle, idle];
  });
  assert.equal(calls, 4);
  assert.equal(results.reduce((n, row) => n + row.processed, 0), 3);
});

test("an empty queue requires only one wave", async () => {
  let calls = 0;
  await collectDrainWaves(async () => { calls += 1; return [idle]; });
  assert.equal(calls, 1);
});

for (const failure of [
  { ...done, httpStatus: 503 },
  { ...done, processed: 0 },
  { ...done, status: "reconciliation_required" },
  { ...done, status: "failed" },
]) {
  test(`stops refilling after ${JSON.stringify(failure)}`, async () => {
    let calls = 0;
    const results = await collectDrainWaves(async () => { calls += 1; return [done, failure]; });
    assert.equal(calls, 1);
    assert.deepEqual(results, [done, failure], "keep the failure for the HTTP aggregate");
  });
}

test("does not launch more work after the refill deadline", async () => {
  let elapsed = 0;
  let calls = 0;
  await collectDrainWaves(async () => {
    calls += 1;
    elapsed += SERVERLESS_DRAIN_REFILL_BUDGET_MS;
    return [done];
  }, () => elapsed);
  assert.equal(calls, 1);
});

test("a frozen clock and perpetually busy queue are bounded", async () => {
  let calls = 0;
  await collectDrainWaves(async () => { calls += 1; return [done]; }, () => 0);
  assert.equal(calls, SERVERLESS_DRAIN_MAX_WAVES);
});
