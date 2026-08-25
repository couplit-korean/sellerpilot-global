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
  assert.deepEqual(result, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }], state: "ready" });
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
  assert.deepEqual(result, { items: [], providers: [], state: "unavailable" });
});
