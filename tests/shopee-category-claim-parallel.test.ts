import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shopee category reads can claim beside orders.list without touching oauth rows", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260904181000_allow_shopee_category_reads_beside_orders.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /channel = 'shopee'/);
  assert.match(migration, /'categories\.suggest'/);
  assert.match(migration, /running\.operation in \([\s\S]*'orders\.list'/);
  assert.match(
    migration,
    /when job\.operation in \([\s\S]*'categories\.suggest'[\s\S]*then 0/,
  );
  assert.match(migration, /Shopee category read blocked by a running mutation/);
  assert.doesNotMatch(migration, /177eaf2e-3e28-4757-9521-16a517ee3b93/);
  assert.doesNotMatch(
    migration,
    /status = 'cancelled'[\s\S]*credential_refresh_in_flight = false/,
  );
});

test("Shopee category reads can pass a failed orders.list reconciliation without cancelling it", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260904190000_allow_shopee_category_reads_past_failed_orders_reconciliation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /unresolved.operation is distinct from 'oauth.exchange'/);
  assert.match(migration, /unresolved.provider_mutation_started_at is null/);
  assert.match(migration, /not coalesce\(unresolved.credential_refresh_in_flight, false\)/);
  assert.doesNotMatch(migration, /status = 'cancelled'/);
});

test("Shopee category reads can pass an unstarted refresh reconciliation without cancelling it", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260904193000_allow_shopee_category_reads_past_unstarted_refresh_reconciliation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /unresolved.operation is distinct from 'oauth.exchange'/);
  assert.match(migration, /unresolved.provider_mutation_started_at is null/);
  assert.doesNotMatch(
    migration,
    /not coalesce\(unresolved.credential_refresh_in_flight, false\)/,
  );
  assert.doesNotMatch(migration, /status = 'cancelled'/);
});
