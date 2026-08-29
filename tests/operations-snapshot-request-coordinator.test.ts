import assert from "node:assert/strict";
import test from "node:test";
import {
  OperationsSnapshotRequestCoordinator,
  operationsSnapshotRangeKey,
  type OperationsSnapshotRequest,
  unavailableOperationsSnapshot,
} from "../app/operations-snapshot-request-coordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

test("a newer sales range aborts the old request and is the only result allowed to commit", async () => {
  const coordinator = new OperationsSnapshotRequestCoordinator();
  const oldRange = deferred();
  const newRange = deferred();
  const commits: string[] = [];
  let oldRequest: OperationsSnapshotRequest | null = null;

  const oldPromise = coordinator.run("old", async (request) => {
    oldRequest = request;
    await oldRange.promise;
    coordinator.commitIfCurrent(request, "new", () => commits.push("old"));
  });
  await Promise.resolve();

  const newPromise = coordinator.run("new", async (request) => {
    await newRange.promise;
    coordinator.commitIfCurrent(request, "new", () => commits.push("new"));
  });
  await Promise.resolve();

  assert.equal(oldRequest?.signal.aborted, true);
  oldRange.resolve();
  newRange.resolve();
  await Promise.all([oldPromise, newPromise]);
  assert.deepEqual(commits, ["new"]);
});

test("changing the selected range blocks an old response even before the replacement request starts", async () => {
  const coordinator = new OperationsSnapshotRequestCoordinator();
  const response = deferred();
  const commits: string[] = [];

  const requestPromise = coordinator.run("old", async (request) => {
    await response.promise;
    coordinator.commitIfCurrent(request, "new", () => commits.push("old"));
  });
  await Promise.resolve();
  response.resolve();
  await requestPromise;

  assert.deepEqual(commits, []);
});

test("concurrent refreshes for the same range share one request", async () => {
  const coordinator = new OperationsSnapshotRequestCoordinator();
  const response = deferred();
  let calls = 0;

  const first = coordinator.run("same", async () => {
    calls += 1;
    await response.promise;
  });
  const second = coordinator.run("same", async () => {
    calls += 1;
  });

  assert.strictEqual(second, first);
  await Promise.resolve();
  assert.equal(calls, 1);
  response.resolve();
  await first;
});

test("aborting an in-flight snapshot before a post-mutation reload guarantees a fresh same-range request", async () => {
  const coordinator = new OperationsSnapshotRequestCoordinator();
  const firstResponse = deferred();
  const calls: string[] = [];
  let firstRequest: OperationsSnapshotRequest | null = null;

  const first = coordinator.run("same", async (request) => {
    firstRequest = request;
    calls.push("before-mutation");
    await firstResponse.promise;
  });
  await Promise.resolve();

  coordinator.abortCurrent();
  const fresh = coordinator.run("same", async () => {
    calls.push("after-mutation");
  });

  assert.equal(firstRequest?.signal.aborted, true);
  assert.notStrictEqual(fresh, first);
  firstResponse.resolve();
  await Promise.allSettled([first, fresh]);
  assert.deepEqual(calls, ["before-mutation", "after-mutation"]);
});

test("sales range keys depend on dates rather than the preset label", () => {
  assert.equal(
    operationsSnapshotRangeKey({ from: "2026-08-01", to: "2026-08-25" }),
    operationsSnapshotRangeKey({ from: "2026-08-01", to: "2026-08-25" }),
  );
  assert.notEqual(
    operationsSnapshotRangeKey({ from: "2026-08-01", to: "2026-08-25" }),
    operationsSnapshotRangeKey({ from: "2026-08-02", to: "2026-08-25" }),
  );
});

test("transient failures retain the exact last-good snapshot and mark it stale", () => {
  const lastGood = { analyticsRange: "2026-08-01/2026-08-25" };
  const unavailable = unavailableOperationsSnapshot(lastGood, "일시적인 네트워크 오류입니다.", true);

  assert.strictEqual(unavailable.data, lastGood);
  assert.equal(unavailable.state, "unavailable");
  assert.match(unavailable.message, /마지막 정상 데이터를 유지합니다/);
});

test("authorization failures do not retain protected snapshot data", () => {
  const unavailable = unavailableOperationsSnapshot({ protected: true }, "다시 로그인해 주세요.", false);

  assert.equal(unavailable.data, null);
  assert.equal(unavailable.state, "unavailable");
  assert.doesNotMatch(unavailable.message, /마지막 정상 데이터/);
});
