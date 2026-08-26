import assert from "node:assert/strict";
import test from "node:test";
import { createPromiseGate, settleWithConcurrency } from "../lib/promise-pool";

test("large mobile photo batches preserve order and never exceed bounded concurrency", async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 100 }, (_, index) => index);
  const results = await settleWithConcurrency(items, 3, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, item % 2));
    active -= 1;
    if (item === 37) throw new Error("bad photo");
    return item * 2;
  });

  assert.equal(peak, 3);
  assert.equal(results.length, 100);
  assert.deepEqual(results[0], { status: "fulfilled", value: 0 });
  assert.equal(results[37].status, "rejected");
  assert.deepEqual(results[99], { status: "fulfilled", value: 198 });
});

test("invalid concurrency is rejected before any work starts", async () => {
  await assert.rejects(settleWithConcurrency([1], 0, async (value) => value), /positive integer/);
  assert.throws(() => createPromiseGate(0), /positive integer/);
});

test("shared promise gate bounds tasks submitted by independent callers", async () => {
  const gate = createPromiseGate(4);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(Array.from({ length: 22 }, (_, index) => gate(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, index % 3));
    active -= 1;
    return index;
  })));

  assert.equal(peak, 4);
  assert.deepEqual(results, Array.from({ length: 22 }, (_, index) => index));
});
