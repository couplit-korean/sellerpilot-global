import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260828210000_non_cs_release_integrity.sql", import.meta.url);
const routeUrl = new URL("../app/api/internal/maintenance/route.ts", import.meta.url);

test("scheduled and opportunistic gateway recovery use a nonblocking lock and fail-close uncertain writes", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const block = migration.slice(
    migration.indexOf("-- BEGIN:stale-channel-gateway-reaper"),
    migration.indexOf("-- END:stale-channel-gateway-reaper"),
  );
  assert.match(block, /sellerpilot_service_reap_stale_channel_gateway_jobs/);
  assert.match(block, /pg_try_advisory_xact_lock\(193674993, 821065043\)/);
  assert.doesNotMatch(block, /perform pg_catalog\.pg_advisory_xact_lock\(193674993, 82106504[23]\)/);
  assert.match(block, /status = 'running'[\s\S]*lease_expires_at is not null[\s\S]*lease_expires_at <= v_now/);
  assert.match(block, /provider_mutation_started_at is not null/);
  assert.match(block, /'listing\.create'[\s\S]*'inventory\.update'[\s\S]*'inquiries\.reply'[\s\S]*'shipment\.confirm'/);
  assert.match(block, /v_status := 'reconciliation_required'/);
  assert.match(block, /attempt_count >= 4[\s\S]*v_status := 'failed'/);
  assert.match(block, /else[\s\S]*v_status := 'queued'/);
  assert.match(block, /delete from vault\.secrets/);
  assert.match(block, /failure_class = 'external_action'/);
  assert.match(block, /job\.credential_id/);
  assert.match(block, /v_job\.operation in \('orders\.list', 'inquiries\.list'\)[\s\S]*sellerpilot_service_mark_channel_sync\(/);
  assert.match(block, /set search_path = ''/);
  assert.match(block, /revoke all on function public\.sellerpilot_service_reap_stale_channel_gateway_jobs\(integer\)[\s\S]*from public, anon, authenticated/);
  assert.match(block, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(block, /request\.jwt\.claim\.role/);
  assert.doesNotMatch(block, /sellerpilot_claim_channel_gateway_job\(/);
  assert.match(
    migration,
    /sellerpilot_claim_serverless_gateway_job[\s\S]*sellerpilot_service_reap_stale_channel_gateway_jobs\(100\)/,
  );
});

test("maintenance reports bounded gateway recovery without blocking unrelated cleanup", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /const STALE_GATEWAY_RECOVERY_LIMIT = 100/);
  assert.match(route, /const MAINTENANCE_SUPABASE_TIMEOUT_MS = 8_000/);
  assert.match(route, /global: \{ fetch: createBoundedSupabaseFetch\(MAINTENANCE_SUPABASE_TIMEOUT_MS\) \}/);
  assert.match(route, /sellerpilot_service_reap_stale_channel_gateway_jobs/);
  assert.match(route, /total !== retried \+ failed \+ reconciliationRequired \+ oauthCompleted/);
  assert.match(route, /const \[staleAiJobsRecovery, staleGatewayJobsRecovery, stalePushDeliveryRecovery\] = await Promise\.all\(\[\s*expireStaleAiJobs\(serviceClient\),\s*reapStaleGatewayJobs\(serviceClient\),\s*reapStalePushDeliveries\(serviceClient\),\s*\]\);/);
  assert.match(route, /!staleAiJobsRecovery\.ok \|\| !staleGatewayJobsRecovery\.ok \|\| !stalePushDeliveryRecovery\.ok/);
  assert.ok((route.match(/staleGatewayJobsRecovery,/g) ?? []).length >= 6);
  assert.match(route, /sellerpilot_service_claim_marketplace_normalized_asset_cleanup/);
  assert.match(route, /sellerpilot_service_complete_marketplace_normalized_asset_cleanup/);
  assert.match(route, /candidate\.bucket !== "sellerpilot-marketplace"/);
  assert.match(route, /marketplaceStorageCleanup\.failed/);
  assert.match(route, /marketplaceStorageRequeued/);
});
