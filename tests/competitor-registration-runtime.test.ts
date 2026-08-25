import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCompetitorResearchPollingCoordinator,
  pollCompetitorResearch,
} from "../app/_publishing/competitor-research-polling";
import {
  registrationActivityNotificationTransition,
  registrationActivityNotifications,
  registrationActivityStatusMap,
  type RegistrationActivity,
} from "../app/_registration/registration-status";

type Provider = { status: "pending" | "searched"; count: number };
type Item = { id: string };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function activity(status: RegistrationActivity["status"], channelStatus: string): RegistrationActivity {
  return {
    id: "activity-one",
    productId: "product-one",
    productName: "상품 A",
    productCode: "PRODUCT-A",
    sku: "SKU-A",
    status,
    startedAt: "2026-08-25T01:00:00.000Z",
    updatedAt: "2026-08-25T01:01:00.000Z",
    completedAt: status === "completed" ? "2026-08-25T01:01:00.000Z" : null,
    elapsedSeconds: 60,
    channelCount: 1,
    publishedCount: channelStatus === "published" ? 1 : 0,
    failedCount: channelStatus === "failed" ? 1 : 0,
    blockedCount: channelStatus === "blocked" ? 1 : 0,
    channels: [{
      channel: "elevenst",
      channelCode: "11",
      channelName: "11번가",
      market: "KR",
      status: channelStatus,
      message: "",
      updatedAt: "2026-08-25T01:01:00.000Z",
    }],
    message: "",
  };
}

test("competitor polling is capped at three attempts and exposes an explicit retry state", async () => {
  let calls = 0;
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    maxAttempts: 99,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return jsonResponse(202, {
        items: [{ id: `partial-${calls}` }],
        providers: [{ status: "pending", count: 0 }],
      });
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    items: [{ id: "partial-3" }],
    providers: [{ status: "pending", count: 0 }],
    state: "pending",
    retryAvailable: true,
  });
});

test("a later failed or invalid response preserves the last successful partial snapshot", async () => {
  let calls = 0;
  const partial = {
    items: [{ id: "confirmed" }],
    providers: [{ status: "pending" as const, count: 1 }],
  };
  const snapshots: Array<{ items: Item[]; state: string }> = [];
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(202, partial)
        : jsonResponse(502, { items: [], providers: [] });
    },
    onSnapshot: (snapshot) => snapshots.push({ items: snapshot.items, state: snapshot.state }),
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { ...partial, state: "unavailable", retryAvailable: true });
  assert.deepEqual(snapshots, [
    { items: partial.items, state: "pending" },
    { items: partial.items, state: "unavailable" },
  ]);

  const malformed = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    initialSnapshot: partial,
    fetcher: async () => jsonResponse(200, { message: "invalid contract" }),
  });
  assert.deepEqual(malformed, { ...partial, state: "unavailable", retryAvailable: true });
});

test("the polling coordinator fences stale responses, supports same-input retry, and stops after disposal", async () => {
  const staleResponse = deferredResponse();
  const disposalResponse = deferredResponse();
  const inputs: string[] = [];
  const emitted: string[] = [];
  let staleSignal: AbortSignal | null = null;
  let retryCalls = 0;
  const coordinator = createCompetitorResearchPollingCoordinator<Item, Provider>({
    delayMs: 0,
    fetcher: async (input, init) => {
      inputs.push(input);
      if (input === "/stale") {
        staleSignal = init?.signal ?? null;
        return staleResponse.promise;
      }
      if (input === "/dispose") return disposalResponse.promise;
      if (input === "/retry") {
        retryCalls += 1;
        return retryCalls <= 3
          ? jsonResponse(202, { items: [{ id: "partial" }], providers: [{ status: "pending", count: 0 }] })
          : jsonResponse(200, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }] });
      }
      return jsonResponse(200, { items: [{ id: "current" }], providers: [{ status: "searched", count: 1 }] });
    },
    onSnapshot: (snapshot) => emitted.push(snapshot.items[0]?.id ?? "empty"),
  });

  const staleRun = coordinator.run("/stale");
  await Promise.resolve();
  const currentResult = await coordinator.run("/current");
  staleResponse.resolve(jsonResponse(200, { items: [{ id: "stale" }], providers: [{ status: "searched", count: 1 }] }));
  assert.equal(await staleRun, null);
  assert.equal(staleSignal?.aborted, true);
  assert.equal(currentResult?.items[0]?.id, "current");
  assert.deepEqual(emitted, ["current"]);

  const pendingResult = await coordinator.run("/retry");
  assert.equal(pendingResult?.retryAvailable, true);
  assert.equal(coordinator.retryAvailable, true);
  const retriedResult = await coordinator.retry();
  assert.equal(retriedResult?.items[0]?.id, "settled");
  assert.equal(coordinator.retryAvailable, false);
  assert.equal(inputs.filter((input) => input === "/retry").length, 4);

  const disposedRun = coordinator.run("/dispose");
  await Promise.resolve();
  coordinator.dispose();
  disposalResponse.resolve(jsonResponse(200, { items: [{ id: "disposed" }], providers: [{ status: "searched", count: 1 }] }));
  assert.equal(await disposedRun, null);
  assert.equal(await coordinator.run("/after-dispose"), null);
  assert.ok(!emitted.includes("disposed"));
});

test("channel transitions notify while the aggregate remains publishing without duplicating terminal aggregate events", () => {
  const initial = activity("publishing", "queued");
  const previous = registrationActivityStatusMap([initial]);
  const channelCompleted = activity("publishing", "published");
  assert.deepEqual(registrationActivityNotifications(previous, [channelCompleted]), [
    "상품 A · 11번가 · KR: 완료",
  ]);

  const aggregateCompleted = activity("completed", "published");
  assert.deepEqual(registrationActivityNotifications(previous, [aggregateCompleted]), [
    "상품 A: 등록 완료",
  ]);

  const unavailable = registrationActivityNotificationTransition(previous, [], "unavailable");
  assert.strictEqual(unavailable.statuses, previous);
  assert.deepEqual(unavailable.messages, []);
});

test("the scheduler sends provider-level outcomes to the snapshot completion RPC", async () => {
  const source = await readFile(
    new URL("../app/api/internal/competitor-prices/route.ts", import.meta.url),
    "utf8",
  );
  const completion = source.slice(
    source.indexOf("sellerpilot_service_complete_competitor_price_refresh"),
    source.indexOf("const savedCount", source.indexOf("sellerpilot_service_complete_competitor_price_refresh")),
  );
  assert.match(completion, /p_items: items/);
  assert.match(completion, /p_providers: searched\.providers/);
});
