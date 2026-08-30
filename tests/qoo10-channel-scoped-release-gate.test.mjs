import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260831050000_channel_scoped_qoo10_publication_gate.sql",
  import.meta.url,
);
const providerChainMigrationUrl = new URL(
  "../supabase/migrations/20260831053500_rebind_qoo10_scoped_provider_mutation_chain.sql",
  import.meta.url,
);

test("Qoo10 gate is a forward-only post-CS migration and never repairs predecessor history", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.ok(
    "20260831050000" > "20260831033000",
    "Qoo10 gate must sort after the CS ledger migration",
  );
  assert.match(
    migration,
    /assumes the deployed schema objects from\s+-- 20260830222257 and 20260831010000 already exist/,
  );
  assert.doesNotMatch(
    migration,
    /supabase_migrations|schema_migrations|migration\s+repair/i,
    "forward migration must not forge history for already-present predecessor objects",
  );
  assert.match(
    migration,
    /alter function public\.sellerpilot_service_enqueue_listing_gateway_job\([\s\S]{0,120}rename to sellerpilot_310500_enqueue_listing_before_channel_gate/,
    "application requires the deployed 222257 wrapper chain to exist",
  );
});

test("Qoo10 scoped gate is installed closed and replaces every current mutation boundary atomically", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /pg_advisory_xact_lock\(193674993, 821065042\)/);
  assert.match(migration, /lock table sellerpilot_private\.channel_gateway_jobs\s+in share row exclusive mode/);
  assert.match(
    migration,
    /status in \('queued', 'running'\)[\s\S]{0,500}set is_open = false,[\s\S]{0,180}opened_channel = null/,
  );
  assert.match(
    migration,
    /create or replace function sellerpilot_private\.block_closed_listing_mutation_claim\(\)[\s\S]*listing_mutation_release_gate_is_effective\([\s\S]{0,80}coalesce\(new\.channel, old\.channel\)/,
  );
  assert.match(
    migration,
    /create function public\.sellerpilot_service_begin_gateway_provider_mutation[\s\S]*select job\.channel, job\.operation[\s\S]*listing_mutation_release_gate_is_effective\([\s\S]{0,40}v_channel/,
  );
  assert.match(
    migration,
    /sellerpilot_service_begin_serverless_gateway_provider_mutation[\s\S]*select job\.channel, job\.operation[\s\S]*listing_mutation_release_gate_is_effective\([\s\S]{0,40}v_channel/,
  );
  assert.match(
    migration,
    /alter function public\.sellerpilot_service_begin_gateway_provider_mutation\([\s\S]{0,80}rename to sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate/,
    "the post-CS token and inbound-generation fence must remain in the delegate chain",
  );
  assert.match(
    migration,
    /return public\.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate\(/,
  );
  assert.match(
    migration,
    /rename to sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate/,
  );
  assert.match(
    migration,
    /return public\.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate\(/,
  );
  assert.doesNotMatch(
    migration,
    /return public\.sellerpilot_300950_begin_(?:serverless_)?gateway_mutation_before_release_gate\(/,
    "Qoo10 forward migration must not bypass the newer CS provider-mutation fence",
  );
  assert.match(
    migration,
    /sellerpilot_service_reserve_and_enqueue_listing_create[\s\S]*listing_mutation_release_gate_is_effective\([\s\S]{0,40}p_channel/,
  );
  assert.match(
    migration,
    /sellerpilot_service_enqueue_listing_gateway_job[\s\S]*listing_mutation_release_gate_is_effective\([\s\S]{0,40}p_channel/,
  );
});

test("the final Qoo10 rollback exact-ledger fence remains between the outer gate and the verified enqueue predecessor", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /alter function public\.sellerpilot_service_enqueue_listing_gateway_job\([\s\S]{0,120}rename to sellerpilot_310500_enqueue_listing_before_channel_gate/,
  );
  assert.match(
    migration,
    /create or replace function public\.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence/,
  );
  assert.match(
    migration,
    /return public\.sellerpilot_310500_enqueue_listing_before_channel_gate\(/,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.sellerpilot_service_enqueue_listing_gateway_job/,
    "the final Qoo10 wrapper must be renamed and wrapped, never overwritten in place",
  );
  assert.match(
    migration,
    /revoke all on function\s+public\.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence[\s\S]{0,160}from public, anon, authenticated, service_role/,
  );
});

test("the channel predicate admits only the canonical seven and Qoo10 is the only scoped opener", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /when p_channel is null or p_channel not in \(\s*'qoo10', 'shopee', 'lazada', 'coupang',\s*'elevenst', 'smartstore', 'ebay'\s*\) then false/,
  );
  assert.match(migration, /p_channel is distinct from 'qoo10'/);
  assert.doesNotMatch(migration, /opened_channel = 'temu'/);
  assert.match(
    migration,
    /gate\.opened_channel is null or gate\.opened_channel = p_channel/,
    "unrelated adapter drift must not close a Qoo10-scoped gate",
  );
});

test("the Qoo10 provider-chain repair changes only the two internal 301100 delegates", async () => {
  const migration = await readFile(providerChainMigrationUrl, "utf8");

  assert.match(
    migration,
    /pg_advisory_xact_lock\(193674993, 821065042\)/,
    "installation must serialize with the provider-mutation boundary",
  );
  assert.match(migration, /requires a closed gate/);
  assert.match(migration, /listing mutation jobs must be terminal before chain repair/);
  assert.match(
    migration,
    /job\.status in \('queued', 'running', 'reconciliation_required'\)/,
    "the repair may not install over an unresolved provider outcome",
  );
  assert.equal(
    (migration.match(/create or replace function/g) ?? []).length,
    2,
    "only the generic and optional serverless internal delegates may be replaced",
  );
  assert.match(
    migration,
    /create or replace function\s+public\.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe/,
  );
  assert.match(
    migration,
    /create or replace function\s+public\.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe/,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function\s+public\.sellerpilot_service_begin_(?:serverless_)?gateway_provider_mutation/,
    "the public 310500 gate and 310330 CS fence must remain untouched",
  );
  assert.doesNotMatch(
    migration,
    /listing_mutation_release_gate_is_effective\(\s*\)/,
    "the repaired internal delegates must never reinterpret the scoped gate globally",
  );
  assert.equal(
    (migration.match(/listing_mutation_release_gate_is_effective\(\s*v_channel\s*\)/g) ?? []).length,
    2,
  );
  assert.match(
    migration,
    /return public\.sellerpilot_300950_begin_gateway_mutation_before_release_gate\(/,
  );
  assert.match(
    migration,
    /return public\.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate\(/,
  );
  assert.match(
    migration,
    /v_outer_exists is distinct from v_inner_exists[\s\S]*v_outer_exists is distinct from v_delegate_exists/,
    "partial serverless-chain drift must fail the migration",
  );
  assert.equal(
    (migration.match(/from public, anon, authenticated, service_role/g) ?? []).length,
    1,
  );
  assert.match(
    migration,
    /from public,anon,authenticated,service_role/,
  );
});
