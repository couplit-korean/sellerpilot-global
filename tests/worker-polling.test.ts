import assert from "node:assert/strict";
import test from "node:test";
import { jitterWorkerPollMs, nextWorkerIdlePollMs } from "../lib/worker-polling";

test("idle worker polling backs off from five seconds to a thirty-second ceiling", () => {
  const values = [5_000];
  for (let index = 0; index < 8; index += 1) {
    values.push(nextWorkerIdlePollMs(values.at(-1) ?? 0, 5_000, 30_000));
  }
  assert.deepEqual(values, [5_000, 8_000, 12_800, 20_480, 30_000, 30_000, 30_000, 30_000, 30_000]);
});

test("worker poll jitter remains bounded and deterministic for tests", () => {
  assert.equal(jitterWorkerPollMs(5_000, 0), 4_500);
  assert.equal(jitterWorkerPollMs(5_000, 0.5), 5_000);
  assert.equal(jitterWorkerPollMs(5_000, 1), 5_501);
  assert.equal(jitterWorkerPollMs(Number.NaN, Number.NaN), 1);
});
