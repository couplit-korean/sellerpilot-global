import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260905014600_expose_qoo10_completion_rpc_with_short_name.sql",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/products/[id]/qoo10-shipping-s1-release/route.ts",
  import.meta.url,
);

const longSourceName = "sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get";
const truncatedName = longSourceName.slice(0, 63);
const shortName = "sellerpilot_service_complete_qoo10_s1_activation_from_get";

test("14600 renames the PostgreSQL-truncated completion RPC to a PostgREST-safe name", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.ok(longSourceName.length > 63);
  assert.equal(truncatedName, "sellerpilot_service_complete_qoo10_shipping_s1_activation_from_");
  assert.ok(shortName.length <= 63);
  assert.match(sql, new RegExp(`alter function[\\s\\S]*${truncatedName}\\(`, "u"));
  assert.match(sql, new RegExp(`rename to ${shortName}`, "u"));
  assert.match(sql, new RegExp(`grant execute on function[\\s\\S]*${shortName}`, "u"));
  assert.match(sql, /qoo10_shipping_s1_completion_release_is_current/u);
  assert.match(sql, /providerMutationExecuted'',false/u);
  assert.doesNotMatch(sql, /update\s+sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(sql, /EditGoodsStatus/u);
});

test("the admin route calls only the PostgREST-safe completion RPC name", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(route, new RegExp(shortName, "u"));
  assert.doesNotMatch(route, new RegExp(`"${longSourceName}"`, "u"));
});
