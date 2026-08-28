import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260828142500_list_latest_product_margin_scenarios.sql",
  import.meta.url,
);

test("latest margin scenario RPC is admin-only, product-linked, channel-partitioned, and bounded", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /sellerpilot_list_latest_margin_scenarios/);
  assert.match(migration, /margin_scenarios_product_channel_created_idx/);
  assert.match(migration, /public\.sellerpilot_is_admin\(\)/);
  assert.match(migration, /scenario\.product_id is not null/);
  assert.match(migration, /partition by scenario\.product_id, scenario\.channel_key/);
  assert.match(migration, /order by scenario\.created_at desc, scenario\.id desc/);
  assert.match(migration, /p_product_id is null or scenario\.product_id = p_product_id/);
  assert.match(migration, /product\.status <> 'archived'/);
  assert.match(migration, /not product\.demo/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit, 400\), 50\), 400\)/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /owner_id = auth\.uid\(\)/);
});

test("operations and product routes prefer complete lineage coverage with a bounded recent fallback", async () => {
  const [snapshot, readiness, productRoute] = await Promise.all([
    readFile(new URL("../app/api/operations/snapshot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/product-readiness/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/margin-scenarios/route.ts", import.meta.url), "utf8"),
  ]);

  for (const route of [snapshot, readiness, productRoute]) {
    assert.match(route, /sellerpilot_list_margin_scenarios/);
    assert.match(route, /sellerpilot_list_latest_margin_scenarios/);
    assert.match(route, /resolveMarginScenarioRows/);
  }
  assert.match(productRoute, /productIdSchema = z\.string\(\)\.uuid\(\)/);
  assert.match(productRoute, /scenario\.productId === productId\.data/);
  assert.match(productRoute, /"cache-control": "no-store, max-age=0"/);
});
