import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  migration: new URL("../supabase/migrations/20260826090800_suppress_legacy_shopee_order_sync.sql", import.meta.url),
  route: new URL("../app/api/internal/channel-sync/route.ts", import.meta.url),
  credentialCenter: new URL("../app/api-credential-center.tsx", import.meta.url),
  styles: new URL("../app/operations-system.css", import.meta.url),
};

test("legacy Shopee identity pauses only periodic order reads and exposes a reconnect state", async () => {
  const [migration, route, credentialCenter, styles] = await Promise.all(
    Object.values(files).map((url) => readFile(url, "utf8")),
  );

  assert.match(migration, /p_channel = 'shopee' and p_operation = 'orders\.list'/);
  assert.match(migration, /seller_account_key_source is distinct from 'provider_certified_v1'/);
  assert.match(migration, /'status', 'reconnect_required'/);
  assert.match(migration, /j\.operation = 'orders\.list'/);
  assert.match(migration, /j\.status = 'queued'/);
  assert.match(migration, /j\.attempt_count = 0/);
  assert.match(migration, /j\.attempt_id is null/);
  assert.match(migration, /request_payload->>'periodicKey'/);
  assert.match(migration, /'shopee_periodic_order_sync_suppressed'/);
  assert.doesNotMatch(migration, /j\.operation = 'inquiries\.list'[\s\S]{0,240}status = 'cancelled'/);
  assert.match(migration, /sellerpilot_enqueue_periodic_sync_without_identity_gate/);
  assert.match(migration, /sellerpilot_list_shopee_connection_status/);
  assert.doesNotMatch(migration, /update[\s\S]{0,160}seller_account_key\s*=/i);

  assert.match(route, /status: "queued" \| "already_pending" \| "not_connected" \| "reconnect_required" \| "failed"/);
  assert.match(route, /reconnectRequired/);
  assert.match(credentialCenter, /sellerpilot_list_shopee_connection_status/);
  assert.match(credentialCenter, /OAuth 재연동 필요/);
  assert.match(credentialCenter, /쇼피 주문 자동 동기화를 중지했습니다/);
  assert.match(credentialCenter, /status_unavailable/);
  assert.match(credentialCenter, /주문 자동 동기화 상태를 정상으로 간주하지 않습니다/);
  assert.match(credentialCenter, /previousConnectionStatusById/);
  assert.match(credentialCenter, /resolveShopeeConnectionStatus/);
  assert.match(styles, /\.connection-state\.reconnect/);
});
