import assert from "node:assert/strict";
import test from "node:test";
import { pollCompetitorResearch } from "../app/_publishing/competitor-research-polling";

type Provider = { status: "pending" | "searched"; count: number };
type Item = { id: string };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("competitor research polls a pending gateway result and publishes the settled snapshot", async () => {
  let calls = 0;
  const snapshots: string[] = [];
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(202, { items: [], providers: [{ status: "pending", count: 0 }] })
        : jsonResponse(200, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }] });
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot.state),
  });

  assert.equal(calls, 2);
  assert.deepEqual(snapshots, ["pending", "ready"]);
  assert.deepEqual(result, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }], state: "ready", retryAvailable: false });
});

test("competitor research stops after a bounded number of pending responses", async () => {
  let calls = 0;
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    maxAttempts: 3,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return jsonResponse(202, { items: [], providers: [{ status: "pending", count: 0 }] });
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.state, "pending");
  assert.equal(result.retryAvailable, true);
});

test("competitor research aborts its backoff when the publishing screen closes", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    pollCompetitorResearch<Item, Provider>({
      input: "/api/admin/competitor-prices?query=test",
      signal: controller.signal,
      delayMs: 5_000,
      fetcher: async () => {
        calls += 1;
        return jsonResponse(202, { items: [], providers: [{ status: "pending", count: 0 }] });
      },
      onSnapshot: () => controller.abort(),
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("competitor research fails closed on a malformed successful response", async () => {
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    fetcher: async () => jsonResponse(200, { message: "missing contract" }),
  });
  assert.deepEqual(result, { items: [], providers: [], state: "unavailable", retryAvailable: true });
});

test("a later 5xx keeps the last valid partial competitor snapshot", async () => {
  let calls = 0;
  const partial = { items: [{ id: "confirmed" }], providers: [{ status: "pending" as const, count: 0 }] };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(202, partial)
        : jsonResponse(502, { items: [], providers: [{ status: "searched", count: 0 }] });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { ...partial, state: "unavailable", retryAvailable: true });
});

test("a manual retry preserves the displayed snapshot when its first request fails", async () => {
  const initialSnapshot = { items: [{ id: "confirmed" }], providers: [{ status: "searched" as const, count: 1 }] };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    initialSnapshot,
    fetcher: async () => { throw new TypeError("network unavailable"); },
  });

  assert.deepEqual(result, { ...initialSnapshot, state: "unavailable", retryAvailable: true });
});

test("competitor research bounds a fetcher that never settles", async () => {
  const snapshots: string[] = [];
  const startedAt = Date.now();
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=stalled-fetch",
    signal: new AbortController().signal,
    maxAttempts: 1,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => await new Promise<Response>(() => undefined),
    onSnapshot: (snapshot) => snapshots.push(snapshot.state),
  });

  assert.deepEqual(result, { items: [], providers: [], state: "unavailable", retryAvailable: true });
  assert.deepEqual(snapshots, ["unavailable"]);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("competitor research bounds a response body that never settles", async () => {
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=stalled-body",
    signal: new AbortController().signal,
    maxAttempts: 1,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>(() => undefined),
    }) as Response,
  });

  assert.equal(result.state, "unavailable");
  assert.equal(result.retryAvailable, true);
});

test("a timed-out late response cannot publish a stale competitor snapshot", async () => {
  let resolveResponse: ((response: Response) => void) | null = null;
  const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  const snapshots: string[] = [];
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=late",
    signal: new AbortController().signal,
    maxAttempts: 1,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => await response,
    onSnapshot: (snapshot) => snapshots.push(snapshot.state),
  });
  resolveResponse?.(jsonResponse(200, { items: [{ id: "too-late" }], providers: [{ status: "searched", count: 1 }] }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(result.state, "unavailable");
  assert.deepEqual(snapshots, ["unavailable"]);
});

test("parent abort stops a stalled competitor attempt without retrying", async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=closed",
    signal: controller.signal,
    maxAttempts: 3,
    perAttemptTimeoutMs: 60_000,
    fetcher: async () => {
      calls += 1;
      return await new Promise<Response>(() => undefined);
    },
  });
  controller.abort(new DOMException("상품 등록 화면을 닫았습니다.", "AbortError"));

  await assert.rejects(promise, (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(calls, 1);
});

test("a timeout preserves the last valid partial competitor snapshot", async () => {
  let calls = 0;
  const partial = { items: [{ id: "confirmed" }], providers: [{ status: "pending" as const, count: 1 }] };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=partial-timeout",
    signal: new AbortController().signal,
    maxAttempts: 2,
    delayMs: 0,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(202, partial);
      return await new Promise<Response>(() => undefined);
    },
  });

  assert.deepEqual(result, { ...partial, state: "unavailable", retryAvailable: true });
});
