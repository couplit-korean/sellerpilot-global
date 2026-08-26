import assert from "node:assert/strict";
import test from "node:test";
import { createConcurrencyGate } from "../scripts/worker-concurrency-gate.mjs";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("concurrency gate runs at most the configured count and grants queued work FIFO", async () => {
  const gate = createConcurrencyGate(2);
  const started = [];
  const finish = new Map();
  const heldTask = (name) => gate.run(() => new Promise((resolve) => {
    started.push(name);
    finish.set(name, resolve);
  }));

  const first = heldTask("first");
  const second = heldTask("second");
  const third = heldTask("third");
  const fourth = heldTask("fourth");
  await nextTurn();

  assert.deepEqual(started, ["first", "second"]);
  assert.equal(gate.activeCount, 2);
  assert.equal(gate.pendingCount, 2);

  finish.get("second")("second-result");
  assert.equal(await second, "second-result");
  await nextTurn();
  assert.deepEqual(started, ["first", "second", "third"]);
  assert.equal(gate.activeCount, 2);
  assert.equal(gate.pendingCount, 1);

  finish.get("first")("first-result");
  assert.equal(await first, "first-result");
  await nextTurn();
  assert.deepEqual(started, ["first", "second", "third", "fourth"]);

  finish.get("third")("third-result");
  finish.get("fourth")("fourth-result");
  assert.deepEqual(await Promise.all([third, fourth]), ["third-result", "fourth-result"]);
  assert.equal(gate.activeCount, 0);
  assert.equal(gate.pendingCount, 0);
});

test("a queued abort is removed without consuming a slot", async () => {
  const gate = createConcurrencyGate(1);
  let finishFirst;
  const first = gate.run(() => new Promise((resolve) => { finishFirst = resolve; }));
  await nextTurn();

  const controller = new AbortController();
  const reason = new Error("lease lost");
  const cancelled = gate.run(async () => "must-not-run", { signal: controller.signal });
  await nextTurn();
  assert.equal(gate.pendingCount, 1);

  controller.abort(reason);
  await assert.rejects(cancelled, (error) => error === reason);
  assert.equal(gate.activeCount, 1);
  assert.equal(gate.pendingCount, 0);

  finishFirst("done");
  assert.equal(await first, "done");
  assert.equal(gate.activeCount, 0);
});

test("a failed task releases its slot for the next waiter", async () => {
  const gate = createConcurrencyGate(1);
  let rejectFirst;
  const first = gate.run(() => new Promise((resolve, reject) => { rejectFirst = reject; }));
  const second = gate.run(async () => "second-ran");
  await nextTurn();
  assert.equal(gate.pendingCount, 1);

  rejectFirst(new Error("first failed"));
  await assert.rejects(first, /first failed/);
  assert.equal(await second, "second-ran");
  assert.equal(gate.activeCount, 0);
  assert.equal(gate.pendingCount, 0);
});

test("concurrency gate rejects invalid limits", () => {
  for (const limit of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createConcurrencyGate(limit), /1 이상의 정수/);
  }
});
