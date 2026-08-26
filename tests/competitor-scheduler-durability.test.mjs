import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("periodic competitor work does not block the worker that must claim its 11st gateway job", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const periodicStart = worker.indexOf("if (canRunPeriodicChannelSync({");
  const periodicSection = worker.slice(
    periodicStart,
    worker.indexOf("if (canRunGatewayClaim({", periodicStart),
  );

  assert.match(worker, /let periodicCompetitorRequest = null/);
  assert.match(worker, /function startPeriodicCompetitorRefresh\(\)/);
  assert.match(worker, /periodicCompetitorRequest = api\([\s\S]{0,180}58_000/);
  assert.match(worker, /if \(periodicCompetitorRequest\) return/);
  assert.match(periodicSection, /now: Date\.now\(\)/);
  assert.match(periodicSection, /schedulerBackoffUntil: authBackoffUntil\.scheduler/);
  assert.match(periodicSection, /startPeriodicCompetitorRefresh\(\);/);
  assert.doesNotMatch(periodicSection, /await startPeriodicCompetitorRefresh/);
  assert.doesNotMatch(periodicSection, /Promise\.all\([\s\S]*competitor-prices/);
  assert.ok(worker.indexOf("startPeriodicCompetitorRefresh();") < worker.indexOf('api("/api/channel-gateway/worker/claim"'));
});

test("competitor scheduler migration owns due products and deduplicates exact 11st reads", async () => {
  const [migration, gateway, adminRoute, internalRoute, competitorLibrary] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260825105200_durable_competitor_price_refresh.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/competitor-prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/competitor-prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/competitor-prices.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /competitor_price_refresh_claims/);
  assert.match(migration, /lease_expires_at is not null and lease_expires_at > claimed_at/);
  assert.match(migration, /for update of p skip locked/);
  assert.match(migration, /order by case[\s\S]*resume_job\.status = 'succeeded'[\s\S]*resume_job\.completed_at >= clock_timestamp\(\) - interval '30 minutes'[\s\S]*then 0 else 1[\s\S]*refresh_state\.last_attempted_at nulls first/);
  assert.match(migration, /on conflict \(product_id\) do update[\s\S]*claim_token is null[\s\S]*lease_expires_at <= clock_timestamp\(\)/);
  assert.match(migration, /sellerpilot_service_complete_competitor_price_refresh/);
  const completion = migration.slice(migration.indexOf("sellerpilot_service_complete_competitor_price_refresh"), migration.indexOf("sellerpilot_service_release_competitor_price_refresh"));
  assert.ok(completion.indexOf("from sellerpilot_private.products") < completion.indexOf("from sellerpilot_private.competitor_price_refresh_claims"));
  assert.match(completion, /c\.claim_token = p_claim_token[\s\S]*for update/);
  assert.match(migration, /channel_gateway_jobs_competitor_active_dedupe_idx/);
  assert.match(migration, /j\.status in \('queued', 'running'\)/);
  assert.match(migration, /j\.status = 'succeeded'[\s\S]{0,120}j\.completed_at >= clock_timestamp\(\) - interval '30 minutes'/);
  assert.match(gateway, /sellerpilot_enqueue_competitor_search_job/);
  assert.match(gateway, /p_product_id: input\.productId \?\? null/);
  assert.match(gateway, /p_claim_token: input\.claimToken \?\? null/);
  assert.doesNotMatch(
    gateway.slice(gateway.indexOf("export async function executeCompetitorSearchViaChannelGateway")),
    /p_operation: "competitor\.search"/,
  );
  assert.match(adminRoute, /result\.pending \? 202/);
  assert.match(adminRoute, /authenticateAdminRequest\(request, \{ timeoutMs: COMPETITOR_RPC_TIMEOUT_MS \}\)/);
  assert.match(adminRoute, /COMPETITOR_PROVIDER_BUDGET_MS = 32_000/);
  assert.match(internalRoute, /COMPETITOR_PROVIDER_BUDGET_MS = 32_000/);
  assert.match(internalRoute, /productId: product\.product_id, claimToken: product\.claim_token/);
  assert.match(competitorLibrary, /provider\.search\(effectivePrimary, effectiveAliases, displayPerQuery, context\)/);
  assert.ok((competitorLibrary.match(/AbortSignal\.timeout\(15_000\)/g) ?? []).length >= 3);
});
