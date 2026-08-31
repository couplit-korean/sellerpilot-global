import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCompetitorResearchRetryPath,
  createCompetitorResearchPollingCoordinator,
  pollCompetitorResearch,
} from "../app/_publishing/competitor-research-polling";
import {
  registrationActivityNotificationTransition,
  registrationActivityNotifications,
  registrationActivityStatusMap,
  type RegistrationActivity,
} from "../app/_registration/registration-status";

type Provider = {
  status: "pending" | "searched" | "failed" | "unavailable";
  count: number;
  blockedReason?: "STATIC_EGRESS_REQUIRED";
};
type Item = { id: string };
const fetchedAt = "2026-08-31T03:00:00.000Z";

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
        fetchedAt,
      });
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    items: [{ id: "partial-3" }],
    providers: [{ status: "pending", count: 0 }],
    fetchedAt,
    state: "pending",
    retryAvailable: true,
  });
});

test("a later failed or invalid response preserves the last successful partial snapshot", async () => {
  let calls = 0;
  const partial = {
    items: [{ id: "confirmed" }],
    providers: [{ status: "pending" as const, count: 1 }],
    fetchedAt,
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

test("a structured static-egress failure remains visible in the unavailable UI state", async () => {
  const blockedProvider = {
    status: "unavailable" as const,
    count: 0,
    blockedReason: "STATIC_EGRESS_REQUIRED" as const,
  };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    maxAttempts: 1,
    fetcher: async () => jsonResponse(503, {
      items: [],
      providers: [blockedProvider],
      fetchedAt,
    }),
  });
  assert.deepEqual(result, {
    items: [],
    providers: [blockedProvider],
    fetchedAt,
    state: "unavailable",
    retryAvailable: true,
  });
});

test("polling consumes 207 partial success and preserves a real timestamp when a legacy payload omits it", async () => {
  const partialSuccess = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    maxAttempts: 1,
    fetcher: async () => jsonResponse(207, {
      items: [{ id: "confirmed" }],
      providers: [{ status: "searched", count: 1 }, { status: "failed", count: 0 }],
      fetchedAt,
    }),
  });
  assert.deepEqual(partialSuccess, {
    items: [{ id: "confirmed" }],
    providers: [{ status: "searched", count: 1 }, { status: "failed", count: 0 }],
    fetchedAt,
    state: "ready",
    retryAvailable: false,
  });

  const legacy = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    maxAttempts: 1,
    initialSnapshot: { items: [], providers: [], fetchedAt },
    fetcher: async () => jsonResponse(200, {
      items: [{ id: "legacy" }],
      providers: [{ status: "searched", count: 1 }],
    }),
  });
  assert.equal(legacy.fetchedAt, fetchedAt);
  assert.equal(legacy.items[0]?.id, "legacy");
});

test("registration sends confirmed structured identity while query-only admin search cannot assert exact", async () => {
  const path = buildCompetitorResearchRetryPath({
    productName: "브랜드 모델 500ml",
    brandName: "브랜드",
    manufacturer: "제조사",
    manufacturerPartNumber: "MFG-WH1000XM6-B",
    modelNumber: "WH-1000XM6",
    packageContents: "상품 6개",
    condition: "NEW",
    gtinStatus: "HAS_GTIN",
    gtin: "8801234567890",
  });
  const url = new URL(path, "https://sellerpilot.local");
  assert.equal(url.searchParams.get("productName"), "브랜드 모델 500ml");
  assert.equal(url.searchParams.get("brand"), "브랜드");
  assert.equal(url.searchParams.get("manufacturer"), "제조사");
  assert.equal(url.searchParams.get("manufacturerPartNumber"), "MFG-WH1000XM6-B");
  assert.equal(url.searchParams.get("modelNumber"), "WH-1000XM6");
  assert.equal(url.searchParams.get("packageContents"), "상품 6개");
  assert.equal(url.searchParams.get("condition"), "NEW");
  assert.equal(url.searchParams.get("gtin"), "8801234567890");

  const [route, ui] = await Promise.all([
    readFile(new URL("../app/api/admin/competitor-prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_publishing/competitor-price-v3-ui.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /identity \? \{ identity \} : undefined/);
  assert.match(route, /verifiedSameProduct: "matchTier" in item && item\.matchTier === "exact"/);
  assert.doesNotMatch(route, /verifiedSameProduct:\s*true/);
  assert.match(route, /status: partial \? 207 : 200/);
  assert.match(route, /competitorProviderApiStatuses\(registry, result\.providers\)/);
  assert.match(ui, /provider\.blockedReason === "STATIC_EGRESS_REQUIRED" \? "고정 egress 필요 · 조회 안 함"/);
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
          ? jsonResponse(202, { items: [{ id: "partial" }], providers: [{ status: "pending", count: 0 }], fetchedAt })
          : jsonResponse(200, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }], fetchedAt });
      }
      return jsonResponse(200, { items: [{ id: "current" }], providers: [{ status: "searched", count: 1 }], fetchedAt });
    },
    onSnapshot: (snapshot) => emitted.push(snapshot.items[0]?.id ?? "empty"),
  });

  const staleRun = coordinator.run("/stale");
  await Promise.resolve();
  const currentResult = await coordinator.run("/current");
  staleResponse.resolve(jsonResponse(200, { items: [{ id: "stale" }], providers: [{ status: "searched", count: 1 }], fetchedAt }));
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
  disposalResponse.resolve(jsonResponse(200, { items: [{ id: "disposed" }], providers: [{ status: "searched", count: 1 }], fetchedAt }));
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
    "상품 A · 11번가 · KR: 완료",
  ]);

  const unavailable = registrationActivityNotificationTransition(previous, [], "unavailable");
  assert.strictEqual(unavailable.statuses, previous);
  assert.deepEqual(unavailable.messages, []);
});

test("the scheduler sends provider-level outcomes to the snapshot completion RPC", async () => {
  const [source, runtime] = await Promise.all([
    readFile(new URL("../app/api/internal/competitor-prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/competitor-refresh-runtime.ts", import.meta.url), "utf8"),
  ]);
  const completion = source.slice(
    source.indexOf("sellerpilot_service_complete_competitor_price_refresh"),
    source.indexOf("const savedCount", source.indexOf("sellerpilot_service_complete_competitor_price_refresh")),
  );
  assert.match(source, /COMPETITOR_MATCHER_VERSION/);
  assert.match(source, /matcherVersion: COMPETITOR_MATCHER_VERSION/);
  assert.match(runtime, /\(searched\.sourceItems \?\? searched\.items\)[\s\S]*\.filter\(\(item\) => searchedProviders\.has\(item\.provider\)\)[\s\S]*\.map\(\(item\) => \(\{ \.\.\.item, matcherVersion \}\)\)/);
  assert.match(completion, /p_items: items/);
  assert.match(completion, /p_providers: providers/);
});

test("the matcher-version forward migration hides legacy automatic observations without deleting manual evidence", async () => {
  const [migration, v2Migration] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260827212726_fence_competitor_matcher_version.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260828003000_fence_competitor_matcher_v2.sql", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /add column if not exists matcher_version text/);
  assert.match(migration, /provider = 'manual'[\s\S]*matcher_version = 'strict-2026-08-27-v1'/);
  assert.match(migration, /cp\.provider = 'manual'[\s\S]*cp\.matcher_version = 'strict-2026-08-27-v1'[\s\S]*interval '7 days'/);
  assert.match(migration, /sellerpilot_service_record_competitor_prices\(\s*p_product_id uuid,\s*p_items jsonb\s*\)/);
  assert.match(migration, /v_provider <> 'manual'[\s\S]*v_matcher_version is distinct from 'strict-2026-08-27-v1'[\s\S]*raise exception 'invalid competitor matcher version'/);
  assert.match(migration, /matcher_version=excluded\.matcher_version/);
  assert.match(migration, /revoke all on function public\.sellerpilot_service_record_competitor_prices\(uuid,jsonb\)[\s\S]*from public,anon,authenticated,service_role[\s\S]*grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /delete from sellerpilot_private\.competitor_price_observations[\s\S]*matcher_version/);
  assert.match(v2Migration, /pg_get_functiondef/);
  assert.match(v2Migration, /strict-2026-08-27-v1/);
  assert.match(v2Migration, /strict-2026-08-28-v2/);
  assert.match(v2Migration, /expected competitor matcher version was not found/);
  assert.match(v2Migration, /drop index if exists sellerpilot_private\.competitor_prices_current_matcher_idx/);
  assert.doesNotMatch(v2Migration, /delete from sellerpilot_private\.competitor_price_observations/);
});

test("the provider snapshot migration removes the ambiguous three-argument completion RPC", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260825110200_refresh_competitor_price_snapshots.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /sellerpilot_service_complete_competitor_price_refresh\(\s*p_product_id uuid,\s*p_claim_token uuid,\s*p_items jsonb,\s*p_providers jsonb\s*\)/);
  assert.match(migration, /revoke all on function public\.sellerpilot_service_complete_competitor_price_refresh\(uuid, uuid, jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /drop function if exists public\.sellerpilot_service_complete_competitor_price_refresh\(uuid, uuid, jsonb\)/);
  assert.match(migration, /revoke all on function public\.sellerpilot_service_complete_competitor_price_refresh\(uuid, uuid, jsonb, jsonb\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to service_role/);
});

test("the marketplace web provider forward migration preserves the durable snapshot fence", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260827193102_enable_brave_marketplace_competitor_provider.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /competitor_price_observations_provider_check[\s\S]*'brave_marketplace_web'/);
  assert.match(migration, /v_provider not in \([\s\S]*'brave_marketplace_web'[\s\S]*'manual'/);
  assert.match(migration, /jsonb_array_length\(p_providers\) > 4/);
  assert.match(migration, /p_items is null[\s\S]*p_providers is null/);
  assert.match(migration, /jsonb_array_length\(p_providers\) < 1/);
  assert.doesNotMatch(migration, /'searched', 'unavailable', 'failed', 'pending'/);
  assert.match(migration, /not exists \([\s\S]*provider\.value->>'status' = 'searched'/);
  assert.match(migration, /count\(\*\) <> count\(distinct provider\.value->>'provider'\)/);
  assert.match(migration, /jsonb_array_length\(p_items\) = 0[\s\S]*provider\.value->>'count'[\s\S]*<> '0'/);
  assert.match(migration, /provider\.value->>'provider' = item\.value->>'provider'[\s\S]*provider\.value->>'status' = 'searched'/);
  assert.match(migration, /provider\.value->>'provider'[\s\S]*'brave_marketplace_web'/);
  assert.match(migration, /sellerpilot_service_record_competitor_prices[\s\S]*set search_path = ''/);
  assert.match(migration, /sellerpilot_service_complete_competitor_price_refresh[\s\S]*set search_path = ''/);
  const completion = migration.slice(migration.indexOf("sellerpilot_service_complete_competitor_price_refresh"));
  assert.ok(completion.indexOf("from sellerpilot_private.products") < completion.indexOf("from sellerpilot_private.competitor_price_refresh_claims"));
  assert.match(completion, /c\.claim_token = p_claim_token[\s\S]*for update/);
  assert.match(completion, /observation\.checked_at < now\(\) - interval '7 days'/);
  assert.match(completion, /revoke all[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to service_role/);
});
