import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchChannelTargets,
  pendingChannelTargetRequestCount,
} from "../app/channel-target-client";
import { lazadaTargetSyncRequiredCode } from "../lib/channels/lazada-my-contract";
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

test("Lazada cache miss performs one typed sync and the next read uses the saved target", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const bodies: unknown[] = [];
  let targetSaved = false;
  let postCalls = 0;
  const credentialId = "21111111-1111-4111-8111-111111111111";
  try {
    globalThis.fetch = (async (_input, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "POST") {
        postCalls += 1;
        bodies.push(JSON.parse(String(init?.body ?? "null")));
        targetSaved = true;
        return Response.json({ targets: [{ targetId: "my-seller-1", marketCode: "MY" }] });
      }
      return targetSaved
        ? Response.json({ targets: [{ targetId: "my-seller-1", marketCode: "MY" }] })
        : Response.json({
            code: lazadaTargetSyncRequiredCode,
            channel: "lazada",
            credentialId,
            targets: [],
          }, { status: 409 });
    }) as typeof fetch;

    const first = await fetchChannelTargets("lazada", "typed-sync-token", { timeoutMs: 100 });
    assert.equal(first.ok, true);
    assert.equal(postCalls, 1);
    const second = await fetchChannelTargets("lazada", "typed-sync-token", { timeoutMs: 100 });
    assert.equal(second.ok, true);
    assert.equal(postCalls, 1);
    assert.deepEqual(methods, ["GET", "POST", "GET"]);
    assert.deepEqual(bodies, [{ channel: "lazada", credentialId }]);
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("channel target client never turns unrelated 409 or server/read errors into POST", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const testCase of [
      { status: 409, payload: { code: "LAZADA_MY_TARGET_MISMATCH" } },
      { status: 409, payload: { code: lazadaTargetSyncRequiredCode, channel: "lazada", targets: [] } },
      { status: 404, payload: { message: "missing" } },
      { status: 500, payload: { message: "failed" } },
      { status: 503, payload: { message: "unavailable" } },
    ]) {
      const methods: string[] = [];
      globalThis.fetch = (async (_input, init) => {
        methods.push(init?.method ?? "GET");
        return Response.json(testCase.payload, { status: testCase.status });
      }) as typeof fetch;
      const response = await fetchChannelTargets(
        "lazada",
        `no-post-${testCase.status}-${testCase.payload.code ?? "error"}`,
        { timeoutMs: 100 },
      );
      assert.equal(response.status, testCase.status);
      assert.deepEqual(methods, ["GET"]);
      assert.equal(pendingChannelTargetRequestCount(), 0);
    }
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

const exactShopeeCredentialId = "22222222-2222-4222-8222-222222222222";
const exactShopeeSelection = { targetId: "1719148844", marketCode: "SG" };

function exactShopeeTargetPayload(includeReceipt: boolean) {
  return {
    contractVersion: 2,
    channel: "shopee",
    credentialId: exactShopeeCredentialId,
    credentialVersion: 81,
    targets: [{
      credentialId: exactShopeeCredentialId,
      targetId: exactShopeeSelection.targetId,
      displayName: "gjrxn.sg",
      marketCode: "SG",
      locale: "en-SG",
      language: "English",
      currency: "SGD",
      status: "NORMAL",
    }],
    ...(includeReceipt ? {
      storeReceipt: {
        contractVersion: 2,
        credentialId: exactShopeeCredentialId,
        credentialVersion: 81,
        targetId: exactShopeeSelection.targetId,
        marketCode: "SG",
      },
    } : {}),
  };
}

test("exact Shopee SG cache miss performs one target-bound POST and accepts its v2 receipt", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  try {
    globalThis.fetch = (async (input, init) => {
      const method = init?.method ?? "GET";
      requests.push({
        url: String(input),
        method,
        body: method === "POST" ? JSON.parse(String(init?.body ?? "null")) : null,
      });
      if (method === "GET") {
        return Response.json({
          code: "SHOPEE_TARGET_CACHE_INCOMPLETE",
          channel: "shopee",
          credentialId: exactShopeeCredentialId,
          targets: [],
        }, { status: 409 });
      }
      return Response.json(exactShopeeTargetPayload(true));
    }) as typeof fetch;

    const response = await fetchChannelTargets("shopee", "exact-token", {
      timeoutMs: 100,
      selectedTarget: exactShopeeSelection,
    });
    assert.equal(response.ok, true);
    assert.deepEqual(requests, [
      {
        url: "/api/admin/channel-targets?channel=shopee&targetId=1719148844&marketCode=SG",
        method: "GET",
        body: null,
      },
      {
        url: "/api/admin/channel-targets?channel=shopee&targetId=1719148844&marketCode=SG",
        method: "POST",
        body: {
          channel: "shopee",
          credentialId: exactShopeeCredentialId,
          targetId: "1719148844",
          marketCode: "SG",
        },
      },
    ]);
    assert.deepEqual(await response.json(), exactShopeeTargetPayload(true));
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact Shopee SG bound v2 GET is used without a provider POST", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  try {
    globalThis.fetch = (async (_input, init) => {
      methods.push(init?.method ?? "GET");
      return Response.json(exactShopeeTargetPayload(false));
    }) as typeof fetch;
    const response = await fetchChannelTargets("shopee", "cached-exact-token", {
      timeoutMs: 100,
      selectedTarget: exactShopeeSelection,
    });
    assert.equal(response.ok, true);
    assert.deepEqual(methods, ["GET"]);
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact Shopee SG rejects an unbound synchronization response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      if ((init?.method ?? "GET") === "GET") {
        return Response.json({
          code: "SHOPEE_TARGET_CACHE_CREDENTIAL_MISMATCH",
          channel: "shopee",
          credentialId: exactShopeeCredentialId,
          targets: [],
        }, { status: 409 });
      }
      const unbound = exactShopeeTargetPayload(true);
      unbound.storeReceipt.targetId = "999999999";
      return Response.json(unbound);
    }) as typeof fetch;
    const response = await fetchChannelTargets("shopee", "unbound-exact-token", {
      timeoutMs: 100,
      selectedTarget: exactShopeeSelection,
    });
    assert.equal(response.status, 502);
    assert.equal(calls, 2);
    assert.equal((await response.json()).code, "SHOPEE_EXACT_TARGET_RESPONSE_UNBOUND");
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-SG Shopee reads remain legacy and never get coerced to the SG target", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  try {
    globalThis.fetch = (async (input, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Response.json({ targets: [{ targetId: "my-shop", marketCode: "MY" }] });
    }) as typeof fetch;
    const response = await fetchChannelTargets("shopee", "my-token", {
      timeoutMs: 100,
      selectedTarget: { targetId: "1719148844", marketCode: "MY" },
    });
    assert.equal(response.ok, true);
    assert.deepEqual(requests, ["GET /api/admin/channel-targets?channel=shopee"]);
    assert.equal(pendingChannelTargetRequestCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
