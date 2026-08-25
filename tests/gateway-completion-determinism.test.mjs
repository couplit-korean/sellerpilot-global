import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../app/api/channel-gateway/worker/complete/route.ts", import.meta.url);
const directSyncRouteUrl = new URL("../app/api/operations/sync/route.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql",
  import.meta.url,
);

test("gateway exact replay uses one immutable normalization timestamp and keeps derived payloads fenced", async () => {
  const [route, directSyncRoute, migration] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(directSyncRouteUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(migration, /coalesce\(job\.started_at, job\.created_at\) as normalization_timestamp/g);
  assert.equal((migration.match(/'normalization_timestamp', v_job\.normalization_timestamp/g) ?? []).length, 2);
  assert.match(route, /completionNormalizationTimestamp\(job\.normalization_timestamp\)/);
  assert.match(route, /normalizeChannelOrders\([\s\S]*normalizationTimestamp,[\s\S]*\)/);
  assert.match(route, /normalizeChannelInquiries\([\s\S]*normalizationTimestamp,[\s\S]*\)/);
  assert.match(route, /if \(!normalizationTimestamp\)[\s\S]*workerRpcErrorMessage\(503\)/);
  assert.match(directSyncRoute, /const syncNormalizationTimestamp = new Date\(\)\.toISOString\(\)/);
  assert.match(directSyncRoute, /normalizeChannelOrders\([\s\S]*syncNormalizationTimestamp/);
  assert.match(directSyncRoute, /normalizeChannelInquiries\(channel, operationResult, syncNormalizationTimestamp\)/);

  const fingerprint = migration.slice(
    migration.indexOf("create function sellerpilot_private.gateway_completion_fingerprint"),
    migration.indexOf("revoke all on function sellerpilot_private.gateway_completion_fingerprint"),
  );
  assert.match(fingerprint, /'orders', p_normalized_orders/);
  assert.match(fingerprint, /'inquiries', p_normalized_inquiries/);
  assert.match(migration, /gateway completion replay mismatch/);
});
