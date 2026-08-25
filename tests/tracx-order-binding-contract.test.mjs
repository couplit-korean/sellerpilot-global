import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TracX delivery requires a typed exact prelink and preserves the source order owner", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260826090700_add_explicit_tracx_order_bindings.sql", import.meta.url),
    "utf8",
  );
  const historicalRollout = migration.slice(
    migration.indexOf("-- Existing TracX orders are backfilled"),
    migration.indexOf("create or replace function public.sellerpilot_bind_tracx_order"),
  );
  const historicalCandidates = historicalRollout.slice(
    0,
    historicalRollout.indexOf("-- Attach an older unmatched event"),
  );
  const ingest = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_service_ingest_tracx_delivery"),
    migration.indexOf("revoke all on function public.sellerpilot_bind_tracx_order"),
  );
  const candidateLookup = ingest.slice(
    ingest.indexOf("-- PackingNo and RefOrderNo"),
    ingest.indexOf("v_event_key :="),
  );

  assert.match(migration, /create table if not exists sellerpilot_private\.tracx_order_bindings/);
  assert.match(migration, /set local lock_timeout = '5s'/);
  assert.match(migration, /set local statement_timeout = '120s'/);
  assert.match(migration, /tracx_seller_account_key text not null/);
  assert.match(migration, /unique \(tracx_seller_account_key, reference_kind, reference_value\)/);
  assert.match(migration, /foreign key \(order_id, order_owner_id\)[\s\S]*commerce_orders\(id, owner_id\)/);
  assert.match(historicalRollout, /binding_source[\s\S]*'historical_event_v1'/);
  assert.match(historicalRollout, /event_candidate_count = 1/);
  assert.match(historicalRollout, /order_identity_count = 1/);
  assert.match(historicalRollout, /reference_order_count = 1/);
  assert.match(historicalRollout, /nonterminal TracX orders require an exact typed binding before rollout/);
  assert.doesNotMatch(historicalCandidates, /external_order_id|tracking_number\s*=/);
  assert.match(migration, /create or replace function public\.sellerpilot_bind_tracx_order/);
  assert.match(migration, /for update;[\s\S]*pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /'replayed', true/);
  assert.match(migration, /'tracx_order_rebound'/);
  assert.match(migration, /previous_credential_id/);
  assert.match(migration, /delete from sellerpilot_private\.tracx_order_bindings binding[\s\S]*binding\.id = v_existing\.id/);
  assert.match(migration, /'rebound', true/);
  assert.match(migration, /v_order\.owner_id,[\s\S]*v_order\.channel_key,[\s\S]*v_credential\.environment/);
  assert.match(candidateLookup, /binding\.reference_kind = 'packing_no'[\s\S]*binding\.reference_value = v_packing/);
  assert.match(candidateLookup, /binding\.reference_kind = 'reference_order_no'[\s\S]*binding\.reference_value = v_reference/);
  assert.match(candidateLookup, /binding\.tracx_seller_account_key = v_credential_seller_account_key/);
  assert.match(candidateLookup, /credential_incarnation_v1'[\s\S]*binding\.bound_with_credential_id = p_credential_id/);
  assert.doesNotMatch(candidateLookup, /external_order_id|tracking_number\s*=/);
  assert.doesNotMatch(ingest, /credential\.created_by/);
  assert.match(ingest, /owner_id,[\s\S]*v_order_owner/);
  assert.match(ingest, /on conflict \(credential_id, event_key\) do update/);
  assert.match(ingest, /orders\.id = v_order_id[\s\S]*orders\.owner_id = v_order_owner/);
  assert.match(migration, /grant execute on function public\.sellerpilot_bind_tracx_order\(uuid, text, text\)[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on sellerpilot_private\.tracx_order_bindings[\s\S]*service_role/);
});

test("fulfillment exposes the explicit prelink before any marketplace shipment write", async () => {
  const [route, page, webhook] = await Promise.all([
    readFile(new URL("../app/api/admin/orders/fulfill/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhooks/tracx/delivery/route.ts", import.meta.url), "utf8"),
  ]);
  const processing = route.slice(
    route.indexOf("const processShipment = async"),
    route.indexOf("const processShipmentSafely"),
  );

  assert.match(route, /tracxReferenceKind: z\.enum\(\["packing_no", "reference_order_no"\]\)/);
  assert.match(route, /tracxReference: z\.string\(\)\.trim\(\)\.max\(240\)/);
  assert.match(processing, /admin\.userClient\.rpc\("sellerpilot_bind_tracx_order"/);
  assert.ok(processing.indexOf("sellerpilot_bind_tracx_order") < processing.indexOf("buildShipmentArguments"));
  assert.ok(processing.indexOf("sellerpilot_bind_tracx_order") < processing.indexOf("operation: \"shipment.confirm\""));
  assert.match(processing, /binding\?\.orderId !== shipment\.id \|\| binding\.referenceValue !== shipment\.tracxReference/);
  assert.match(processing, /판매채널 발송을 시작하지 않았습니다/);
  assert.match(page, /TracX 참조 종류 · 선택/);
  assert.match(page, /SmartShip 원문 그대로 입력/);
  assert.match(page, /tracxReferenceKind: rawTracxReferenceKind === "reference_order_no"/);
  assert.match(page, /matchingOrders\.length === 1 \? matchingOrders\[0\] : null/);
  assert.match(webhook, /x-tracx-timestamp/);
  assert.match(webhook, /verifyTracxWebhookSignature\(\{[\s\S]*timestamp,[\s\S]*signature/);
  assert.match(webhook, /process\.env\.TRACX_ALLOW_LEGACY_QUERY_TOKEN === "true"/);
});
