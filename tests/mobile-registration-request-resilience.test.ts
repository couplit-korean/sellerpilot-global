import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchChannelTargets,
  pendingChannelTargetRequestCount,
} from "../app/channel-target-client";
import {
  createBoundedRequestSignal,
  OperationsSnapshotRequestCoordinator,
  waitForAbortablePromise,
} from "../app/operations-snapshot-request-coordinator";

function never<T>() {
  return new Promise<T>(() => undefined);
}

test("a bounded signal rejects a non-settling dependency with its timeout reason", async () => {
  const parent = new AbortController();
  const bounded = createBoundedRequestSignal(parent.signal, 5, "bounded request timed out");
  try {
    await assert.rejects(
      waitForAbortablePromise(never(), bounded.signal),
      (error: unknown) => error instanceof DOMException
        && error.name === "TimeoutError"
        && error.message === "bounded request timed out",
    );
  } finally {
    bounded.dispose();
  }
});

test("the snapshot coordinator releases a timed-out active promise so the same key can retry", async () => {
  const coordinator = new OperationsSnapshotRequestCoordinator();
  let attempts = 0;

  await assert.rejects(coordinator.run("same-range", async (request) => {
    attempts += 1;
    const bounded = createBoundedRequestSignal(request.signal, 5, "snapshot timed out");
    try {
      await waitForAbortablePromise(never(), bounded.signal);
    } finally {
      bounded.dispose();
    }
  }), /snapshot timed out/);

  await coordinator.run("same-range", async () => {
    attempts += 1;
  });
  assert.equal(attempts, 2);
});

test("a parent cancellation is forwarded without being changed into a timeout", async () => {
  const parent = new AbortController();
  const bounded = createBoundedRequestSignal(parent.signal, 1_000, "should not time out");
  const reason = new DOMException("range changed", "AbortError");
  const pending = waitForAbortablePromise(never(), bounded.signal);
  parent.abort(reason);
  try {
    await assert.rejects(pending, (error: unknown) => error === reason);
  } finally {
    bounded.dispose();
  }
});

test("channel target timeout clears the pending cache and an explicit retry performs a new request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (() => {
      calls += 1;
      return never<Response>();
    }) as typeof fetch;

    await assert.rejects(
      fetchChannelTargets("shopee", "first-token", { timeoutMs: 5 }),
      (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
    );
    assert.equal(pendingChannelTargetRequestCount(), 0);

    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ targets: [{ targetId: "shop-1" }] });
    }) as typeof fetch;
    const retry = await fetchChannelTargets("shopee", "first-token", { timeoutMs: 50 });
    assert.equal(retry.ok, true);
    assert.deepEqual(await retry.json(), { targets: [{ targetId: "shop-1" }] });
    assert.equal(calls, 2);
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent consumers share one channel target request and receive independent responses", async () => {
  const originalFetch = globalThis.fetch;
  let resolveFetch!: (response: Response) => void;
  let calls = 0;
  try {
    globalThis.fetch = (() => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolveFetch = resolve; });
    }) as typeof fetch;
    const first = fetchChannelTargets("lazada", "shared-token", { timeoutMs: 100 });
    const second = fetchChannelTargets("lazada", "shared-token", { timeoutMs: 100 });
    await Promise.resolve();
    resolveFetch(Response.json({ targets: [{ targetId: "seller-1" }] }));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.notStrictEqual(firstResponse, secondResponse);
    assert.deepEqual(await firstResponse.json(), await secondResponse.json());
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborting the only channel target consumer also releases its shared pending entry", async () => {
  const originalFetch = globalThis.fetch;
  const caller = new AbortController();
  try {
    globalThis.fetch = (() => never<Response>()) as typeof fetch;
    const pending = fetchChannelTargets("shopee", "abort-token", {
      signal: caller.signal,
      timeoutMs: 1_000,
    });
    caller.abort(new DOMException("component unmounted", "AbortError"));
    await assert.rejects(pending, /component unmounted/);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
