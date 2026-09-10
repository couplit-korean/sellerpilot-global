import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();

test("current central archive mounts supplemental reads without replacing accepted channel panels", async () => {
  assert.ok(integratedRoot, "SELLERPILOT_INTEGRATED_ROOT is required");
  const archive = await readFile(resolve(integratedRoot, "app/cs/archive.tsx"), "utf8");
  assert.match(archive, /import \{ LazadaSupplementalReadPanel \} from "\.\/channels\/lazada\/supplemental-read";/u);
  assert.equal((archive.match(/<LazadaSupplementalReadPanel authenticatedFetch=\{authenticatedFetch\} \/>/gu) ?? []).length, 1);
  assert.match(archive, /<ElevenstReadStatePanel authenticatedFetch=\{authenticatedFetch\} \/>/u);
  assert.match(archive, /<ShopeeHistoryProgress authenticatedFetch=\{authenticatedFetch\} \/>/u);
  assert.match(archive, /<LazadaRawInbox authenticatedFetch=\{authenticatedFetch\} \/>/u);
  assert.match(archive, /<LazadaQuarantine authenticatedFetch=\{authenticatedFetch\} \/>/u);
});

test("supplemental SQL does not replace accepted multi-account or commerce-order contracts", async () => {
  assert.ok(integratedRoot, "SELLERPILOT_INTEGRATED_ROOT is required");
  const migration = await readFile(resolve(
    integratedRoot,
    "supabase/migrations/20260909165423_cs_lazada_supplemental_read_ledger.sql",
  ), "utf8");
  assert.doesNotMatch(migration, /channel_credentials_one_active|rotate_lazada_credential|enqueue_lazada_periodic_sync/iu);
  assert.doesNotMatch(migration, /channel_gateway_jobs|commerce_orders|cs_order_binding_is_exact/iu);
  assert.match(migration, /LAZADA_SUPPLEMENTAL_ALREADY_INSTALLED/u);
});
