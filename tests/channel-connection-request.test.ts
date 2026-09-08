import assert from "node:assert/strict";
import test from "node:test";
import { requestChannelConnection } from "../lib/channel-connection-request";

test("OAuth request works without AbortSignal.timeout and retains request headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-only");
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    return Response.json({ status: "bound" });
  };
  try {
    const result = await requestChannelConnection("/test-only", { method: "POST", redirect: "error", headers: { authorization: "Bearer fixture-only" } });
    assert.equal(result.response.status, 200); assert.deepEqual(result.payload, { status: "bound" });
  } finally { globalThis.fetch = originalFetch; Object.defineProperty(AbortSignal, "timeout", { value: originalTimeout, configurable: true }); }
});

for (const phase of ["headers", "body"] as const) {
  test(`OAuth deadline aborts stalled ${phase} and never retries POST`, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = async (_input, init) => {
      calls++; signal = init?.signal;
      if (phase === "headers") return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } });
    };
    try {
      await assert.rejects(requestChannelConnection("/test-only", { method: "POST" }, 10), { name: "TimeoutError" });
      assert.equal(signal?.aborted, true); assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("OAuth rejection and invalid JSON are never retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ message: "denied" }, { status: 403 }); };
  try {
    assert.equal((await requestChannelConnection("/test-only", { method: "POST" })).response.status, 403);
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return new Response("bad json"); };
    await assert.rejects(requestChannelConnection("/test-only", { method: "POST" }), SyntaxError);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});
