import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260831133000_expand_verified_publication_to_temu.sql", import.meta.url);

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
  assert.match(migration, /opened_channel is null[\s\S]*eight-channel global gate/);
  assert.doesNotMatch(migration, /p_operation = 'listing\.update' and p_channel = 'temu'/);
  assert.doesNotMatch(migration, /opened_channel = 'temu'/);
});
