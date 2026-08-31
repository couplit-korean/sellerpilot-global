import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260831133000_expand_verified_publication_to_temu.sql", import.meta.url);
const exactCableMigrationUrl = new URL("../supabase/migrations/20260831146000_temu_exact_cable_clips.sql", import.meta.url);

test("Temu publication release is a forward-only migration after the deployed 132000 history", async () => {
  const names = (await readdir(new URL("../supabase/migrations/", import.meta.url))).sort();
  const current = names.indexOf("20260831133000_expand_verified_publication_to_temu.sql");
  const predecessor = names.indexOf("20260831132000_competitor_identity_lineage_fence.sql");
  assert.ok(current > predecessor);

  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /listing mutation jobs must be terminal before Temu publication release installation/);
  assert.match(migration, /listing_publication_reviews_channel_check[\s\S]*'ebay', 'temu'/);
  assert.match(migration, /listing_publication_adapter_release_channel_check[\s\S]*'ebay', 'temu'/);
  assert.match(migration, /values \(\s*'temu', false, null, null, null, clock_timestamp\(\)\s*\)/);
  assert.match(migration, /adapters\.ready_count = 8/);
  assert.match(migration, /p_operation = 'listing\.publication\.verify' and p_channel = 'temu'/);
  assert.match(migration, /in \('coupang','smartstore','elevenst','temu'\)/);
  assert.match(migration, /\{evidence,skuIdentityVerified\}' is distinct from 'true'/);
  assert.match(migration, /\{evidence,priceVerified\}' is distinct from 'true'/);
  assert.match(migration, /\{evidence,stockVerified\}' is distinct from 'true'/);
  assert.doesNotMatch(migration, /\{evidence,(?:imageOrderVerified|contentVerified|skuIdentityVerified|priceVerified|stockVerified|goodsIdVerified|externalGoodsIdVerified)\}'<>/);
  assert.match(migration, /temu_list_status_detail_stock_v2/);
  assert.match(migration, /temu\.local\.goods\.sku\.stock\.query/);
  assert.match(migration, /\{evidence,version\}' is distinct from 'temu_list_status_detail_stock_v2'/);
  assert.match(migration, /\{evidence,observedSkuCount\}' is distinct from/);
  assert.match(migration, /coalesce\(v_state#>'\{evidence,readbackMethods\}','\[\]'::jsonb\)/);
  assert.match(migration, /opened_channel is null[\s\S]*eight-channel global gate/);
  assert.doesNotMatch(migration, /p_operation = 'listing\.update' and p_channel = 'temu'/);
  assert.doesNotMatch(migration, /opened_channel = 'temu'/);
});

test("Temu exact cable release is a data-free forward fence after Smartstore egress", async () => {
  const names = (await readdir(new URL("../supabase/migrations/", import.meta.url))).sort();
  const current = names.indexOf("20260831146000_temu_exact_cable_clips.sql");
  const predecessor = names.indexOf("20260831145000_release_smartstore_from_static_egress.sql");
  assert.ok(current > predecessor);

  const migration = await readFile(exactCableMigrationUrl, "utf8");
  assert.match(migration, /20260831145000/);
  assert.match(migration, /sellerpilot_311430_reserve_before_ebay_exact_existing_qa_fence/);
  assert.match(migration, /ddccde35-9c58-4856-b673-d7aa27ce4220/);
  assert.match(migration, /QA-20260823-CC-001/);
  assert.match(migration, /TEMU_EXACT_CABLE_ACTIVE_CREDENTIAL_REQUIRED/);
  assert.match(migration, /TEMU_EXACT_CABLE_CONFIRMED_LEAF_REQUIRED/);
  assert.match(migration, /extCatName/);
  assert.match(migration, /costTemplate/);
  assert.match(migration, /p_price is distinct from 5000/);
  assert.match(migration, /product\.on_hand - product\.reserved = 1/);
  assert.match(migration, /v_sku->>'quantity' is distinct from '1'/);
  assert.match(migration, /jsonb_array_length\(v_carousel\) is distinct from 1/);
  assert.match(migration, /jsonb_array_length\(v_details\) is distinct from 8/);
  assert.match(migration, /temu_list_status_detail_stock_v3/);
  assert.match(migration, /representativeImageVerified/);
  assert.match(migration, /v_expected_scope_fingerprint/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_reserve_and_enqueue_listing_create[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /^\s*(?:insert|update|delete)\s+/im);
});
