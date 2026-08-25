import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN_ID = "d0f39ad6-e4af-4b7e-965d-9e0a324f2fab";
const SECOND_ADMIN_ID = "1173e28d-9b03-46cc-a207-b68a780e95c7";
const NON_ADMIN_ID = "9753c228-73b7-4e1f-8cad-b6635c32ba7f";
const JOB_ID = "b231a1ac-7c2f-48bc-b2e4-8ad6db2902b7";
const CANCEL_JOB_ID = "95303cb5-f3ba-49b6-9bd4-7c5e558f0b14";
const RESEARCH_JOB_ID = "e659cfbc-0f80-44a5-94e8-f011ec53e67f";
const REGEN_JOB_ID = "bc02b888-5531-426a-9a87-32a8c0e356e2";
const DUPLICATE_SKU_JOB_ID = "6c7f9651-f0dd-48f7-8fe4-51335c404aef";
const CLAIM_PREPARATION_JOB_ID = "0da0295f-d85b-4d5e-a938-853b49f5ea32";
const STALE_AI_JOB_ID = "7c64df91-bd91-49bf-a141-1485bcbead3d";
const SHARED_PRODUCT_ID = "4a346497-84c8-4ccd-bf14-8f06f990a2f7";
const TOKEN_HASH = "a".repeat(64);
const SECOND_WORKER_TOKEN_HASH = "e".repeat(64);

const supabaseCompatibilityLayer = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamptz not null default now()
);
create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
)
returns uuid
language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets (id, secret, name, description)
  values (v_id, new_secret, new_name, new_description);
  return v_id;
end;
$$;
create or replace view vault.decrypted_secrets as
select id, secret as decrypted_secret from vault.secrets;
create or replace function vault.delete_secret(secret_id uuid)
returns void
language sql
as $$ delete from vault.secrets where id = secret_id $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(path text)
returns text[]
language sql
immutable
as $$ select string_to_array(path, '/') $$;

create schema if not exists extensions;
create or replace function extensions.digest(value text, algorithm text)
returns bytea
language sql
immutable
as $$ select convert_to(md5(value || algorithm), 'UTF8') $$;
`;

function withoutUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "");
}

async function setClaims(db, role = "authenticated") {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN_ID]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

function aiClaimAssetPaths(jobId, claimToken) {
  const prefix = `results/${jobId}/claims/${claimToken}`;
  return {
    hero: `${prefix}/hero.png`,
    square: `${prefix}/thumbnail-square.png`,
    portrait: `${prefix}/thumbnail-portrait.png`,
    wide: `${prefix}/thumbnail-wide.png`,
    "detail-overview": `${prefix}/detail-overview.png`,
    "detail-feature": `${prefix}/detail-feature.png`,
    "detail-use": `${prefix}/detail-use.png`,
    "detail-package": `${prefix}/detail-package.png`,
  };
}

test("Supabase migrations apply in order and core RPC flows persist safely", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);

    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.deepEqual(migrationNames, [
      "20260816060000_channel_credentials_and_roles.sql",
      "20260816065848_sellerpilot_ai_cli_jobs.sql",
      "20260816103854_ai_operations_controls.sql",
      "20260816104732_operations_core.sql",
      "20260816110000_lazada_token_refresh.sql",
      "20260816120321_expand_channel_connectors.sql",
      "20260816133601_add_shopee_connector.sql",
      "20260816145605_channel_category_catalog.sql",
      "20260817001500_live_operations_snapshot.sql",
      "20260817003000_fix_pgcrypto_schema.sql",
      "20260817004500_product_publish_workflow.sql",
      "20260817045529_fix_service_role_rpc_guards.sql",
      "20260817054039_channel_gateway_queue.sql",
      "20260817060625_channel_target_discovery.sql",
      "20260817061531_localized_market_listings.sql",
      "20260817061650_channel_market_targets.sql",
      "20260817062221_market_listing_ledger.sql",
      "20260817184000_channel_oauth_state_store.sql",
      "20260817184500_fix_oauth_state_service_guards.sql",
      "20260817190000_require_product_intake_fields.sql",
      "20260817191500_allow_admin_oauth_state_for_global_credentials.sql",
      "20260817203000_route_coupang_through_local_gateway.sql",
      "20260817213000_add_temu_and_route_naver.sql",
      "20260818040000_filter_published_listing_badges.sql",
      "20260818041000_share_channel_targets_across_admins.sql",
      "20260818043000_keep_stopped_products_relistable.sql",
      "20260818170000_reject_blocked_categories.sql",
      "20260818171500_personal_data_retention.sql",
      "20260819110000_category_learning_history.sql",
      "20260819150000_inventory_sync_ledger.sql",
      "20260819170000_preserve_failed_listing_remote_id.sql",
      "20260819203000_list_published_product_destinations.sql",
      "20260820050000_channel_order_sync.sql",
      "20260820053500_channel_inquiry_sync.sql",
      "20260820090000_product_research_cli.sql",
      "20260820132000_backfill_channel_sync_counts.sql",
      "20260820143000_share_operations_workspace_across_admins.sql",
      "20260820144500_add_elevenst_margin_scenarios.sql",
      "20260820152000_android_push_notifications.sql",
      "20260820170000_periodic_channel_sync.sql",
      "20260820173000_worker_periodic_sync_auth.sql",
      "20260820180000_activate_elevenst_credentials.sql",
      "20260821100000_order_fulfillment_workflow.sql",
      "20260821101500_operations_accuracy_inventory_ui.sql",
      "20260821102500_order_product_linking.sql",
      "20260821103000_support_reply_cli.sql",
      "20260821103500_shared_inventory_workflow.sql",
      "20260821104500_shared_listing_completion.sql",
      "20260821105500_order_amount_listing_fallback.sql",
      "20260821106000_fix_ai_prune_job_id_ambiguity.sql",
      "20260821110000_harden_oauth_rotation_and_cleanup_lints.sql",
      "20260821113000_scope_push_deliveries_to_owner.sql",
      "20260821123000_enable_elevenst_order_sync.sql",
      "20260821130000_commerce_operations_v2.sql",
      "20260821133000_marketplace_links_cancellations_and_stock_accuracy.sql",
      "20260821134500_public_listing_health.sql",
      "20260821141500_preserve_terminal_order_state.sql",
      "20260822050435_temu_orders_shipping_aftersales.sql",
      "20260822103042_close_untracked_inventory_failures.sql",
      "20260822105620_unique_ai_asset_regeneration_history.sql",
      "20260822130000_enable_manual_inquiry_operations.sql",
      "20260822133000_reduce_runtime_sync_noise.sql",
      "20260822140000_harden_runtime_retention.sql",
      "20260822153000_tracx_logistics_tracking.sql",
      "20260822210000_channel_catalog_inventory_mirror.sql",
      "20260823232744_show_domestic_listing_categories.sql",
      "20260824023835_registration_activity_and_product_edit.sql",
      "20260824024500_gateway_burst_priority_and_reconciliation.sql",
      "20260824052000_deduplicate_manual_periodic_sync.sql",
      "20260824053000_verified_listing_price_sync.sql",
      "20260824054000_fix_kakao_notification_database_lints.sql",
      "20260824055000_remove_inventory_sync_unused_variable.sql",
      "20260824141500_enable_elevenst_channel_operations.sql",
      "20260824154500_enable_elevenst_listing_workflow.sql",
      "20260824180000_preserve_image_roles_for_regeneration.sql",
      "20260824190000_enforce_unique_generated_shots.sql",
      "20260824191500_fix_asset_regeneration_audit_count.sql",
      "20260825011500_preserve_authoritative_inventory.sql",
      "20260825070000_harden_worker_completion_and_registration_activity.sql",
      "20260825071000_harden_order_shipment_ledger_integrity.sql",
      "20260825080000_competitor_price_provider_provenance.sql",
      "20260825084500_product_listing_published_identity.sql",
      "20260825095020_bound_lazada_im_bootstrap_attempts.sql",
      "20260825095022_normalize_product_edit_stock_range.sql",
      "20260825103015_compensate_unprepared_ai_worker_claims.sql",
      "20260825104500_prepare_gateway_credential_refresh.sql",
      "20260825104600_kakao_notification_delivery_lifecycle.sql",
      "20260825104700_prevent_duplicate_listing_gateway_writes.sql",
      "20260825104800_expose_listing_attempt_generation.sql",
      "20260825104900_resource_bound_gateway_writes.sql",
      "20260825105000_external_mutation_delivery_fences.sql",
      "20260825105100_harden_kakao_oauth_and_test_delivery.sql",
    ]);
    for (const name of migrationNames) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }
    const temuFulfillmentMigration = await readFile(
      new URL("20260822050435_temu_orders_shipping_aftersales.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(temuFulfillmentMigration));
    const tracxLogisticsMigration = await readFile(
      new URL("20260822153000_tracx_logistics_tracking.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(tracxLogisticsMigration));

    const serviceOnlyFunctions = [
      "public.sellerpilot_decrypt_credential(uuid)",
      "public.sellerpilot_record_credential_test(uuid,text,text)",
      "public.sellerpilot_get_active_credential_secret(text,text)",
      "public.sellerpilot_service_refresh_lazada(uuid,jsonb,timestamp with time zone)",
      "public.sellerpilot_service_refresh_ebay(uuid,jsonb,timestamp with time zone)",
      "public.sellerpilot_service_refresh_shopee(uuid,jsonb,timestamp with time zone)",
      "public.sellerpilot_service_complete_channel_operation(uuid,text,integer,text,text)",
      "public.sellerpilot_claim_ai_job(text,text)",
      "public.sellerpilot_complete_ai_job(text,uuid,uuid,text,jsonb,text)",
      "public.sellerpilot_prune_ai_jobs(timestamp with time zone,integer)",
      "public.sellerpilot_touch_ai_job(text,uuid,uuid,text)",
      "public.sellerpilot_service_complete_product_listing(uuid,uuid,text,boolean,text,text)",
      "public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)",
      "public.sellerpilot_claim_channel_gateway_job(text,text)",
      "public.sellerpilot_touch_channel_gateway_job(text,uuid,uuid,text)",
      "public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)",
      "public.sellerpilot_get_channel_gateway_job(uuid)",
      "public.sellerpilot_service_upsert_channel_market_target(uuid,uuid,text,text,text,text,text,text,text,text)",
      "public.sellerpilot_service_store_channel_oauth_state(uuid,uuid,text,text)",
      "public.sellerpilot_service_claim_channel_oauth_state(uuid,text,text)",
      "public.sellerpilot_service_reject_category_assignment(uuid,text,text,text)",
      "public.sellerpilot_prune_personal_data(timestamp with time zone)",
      "public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)",
      "public.sellerpilot_service_ingest_orders(uuid,text,jsonb)",
      "public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)",
      "public.sellerpilot_service_consume_lazada_im_bootstrap(uuid)",
      "public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid,uuid,boolean)",
      "public.sellerpilot_service_complete_inventory_sync_item(uuid,uuid,uuid,boolean,integer,text)",
      "public.sellerpilot_service_claim_push_deliveries(integer)",
      "public.sellerpilot_service_finish_push_delivery(uuid,text,text)",
      "public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)",
      "public.sellerpilot_service_validate_worker_token(text,text)",
      "public.sellerpilot_service_begin_ai_job_completion(text,uuid,uuid)",
      "public.sellerpilot_service_release_ai_job_claim(text,uuid,uuid,text,integer)",
      "public.sellerpilot_service_begin_channel_gateway_completion(text,uuid,uuid)",
      "public.sellerpilot_service_begin_gateway_credential_refresh(text,uuid,uuid)",
      "public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamp with time zone,boolean,boolean)",
      "public.sellerpilot_service_claim_kakao_notifications(integer,integer)",
      "public.sellerpilot_service_claim_kakao_notifications(integer)",
      "public.sellerpilot_service_begin_kakao_notification_send(uuid,uuid)",
      "public.sellerpilot_service_release_kakao_notification_claim(uuid,uuid,text,integer)",
      "public.sellerpilot_service_complete_kakao_notification(uuid,uuid,text,text)",
      "public.sellerpilot_service_complete_kakao_notification(uuid,boolean,text)",
      "public.sellerpilot_service_sweep_stale_kakao_notifications()",
      "public.sellerpilot_service_prune_runtime_noise(timestamp with time zone)",
      "public.sellerpilot_service_complete_tracx_operation(uuid,boolean,text,text)",
      "public.sellerpilot_service_ingest_tracx_delivery(uuid,jsonb)",
      "public.sellerpilot_service_record_order_shipment_failure(uuid,uuid,text,text)",
      "public.sellerpilot_service_enqueue_resource_gateway_job(uuid,uuid,text,text,jsonb,text,text,text,uuid,uuid,uuid,text,text)",
      "public.sellerpilot_service_fail_inventory_sync_item_prewrite(uuid,uuid,uuid,text)",
      "public.sellerpilot_service_sweep_stale_tracx_mutations()",
      "public.sellerpilot_service_claim_tracx_mutation(uuid,uuid,text,text,text,text)",
      "public.sellerpilot_service_begin_tracx_mutation(uuid,text)",
      "public.sellerpilot_service_complete_tracx_mutation(uuid,text,text,text,text)",
      "public.sellerpilot_service_sweep_stale_lazada_replies()",
      "public.sellerpilot_service_claim_lazada_reply(uuid,uuid,text)",
      "public.sellerpilot_service_begin_lazada_reply(uuid,text)",
      "public.sellerpilot_service_complete_lazada_reply(uuid,text,text,text,text)",
    ];
    for (const signature of serviceOnlyFunctions) {
      assert.equal(
        await scalar(db, "select has_function_privilege('authenticated', $1, 'EXECUTE')", [signature]),
        false,
      );
      assert.equal(
        await scalar(db, "select has_function_privilege('service_role', $1, 'EXECUTE')", [signature]),
        true,
      );
      const definition = await scalar(db, "select pg_get_functiondef($1::regprocedure)", [signature]);
      assert.doesNotMatch(definition, /request\.jwt\.claim\.role/);
    }

    await db.query("insert into auth.users (id, email) values ($1, 'admin@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Migration Test Admin')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into auth.users (id, email) values ($1, 'second-admin@example.test'), ($2, 'non-admin@example.test')",
      [SECOND_ADMIN_ID, NON_ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Second Migration Test Admin')",
      [SECOND_ADMIN_ID],
    );
    await setClaims(db);
    assert.equal(await scalar(db, "select public.sellerpilot_is_admin()"), true);

    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'qoo10', 'production', '{"certification_key":"test-only"}'::jsonb,
        now() + interval '30 days', 90, 30, 7
      )`,
    );
    assert.match(credentialId, /^[0-9a-f-]{36}$/i);
    const credentialRows = await db.query("select * from public.sellerpilot_list_credentials()");
    assert.equal(credentialRows.rows.length, 1);
    assert.equal(credentialRows.rows[0].channel, "qoo10");
    assert.equal("vault_secret_id" in credentialRows.rows[0], false);

    await setClaims(db, "service_role");
    const secret = await scalar(
      db,
      "select public.sellerpilot_get_active_credential_secret('qoo10', 'production')",
    );
    assert.equal(secret.secret_payload.certification_key, "test-only");
    const periodicQueued = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'qoo10', 'orders.list',
        '{"periodicKey":"orders","arguments":{"params":{"ShippingStat":"1"}}}'::jsonb,
        5
      )`,
    );
    assert.equal(periodicQueued.status, "queued");
    const periodicDeduplicated = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'qoo10', 'orders.list',
        '{"periodicKey":"orders","arguments":{"params":{"ShippingStat":"2"}}}'::jsonb,
        5
      )`,
    );
    assert.equal(periodicDeduplicated.status, "already_pending");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [periodicQueued.jobId],
    );
    await db.query(
      "select public.sellerpilot_record_credential_test($1, 'passed', 'read-only diagnostic passed')",
      [credentialId],
    );

    const lazadaCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'lazada', 'production',
        '{"app_key":"test-app","app_secret":"test-secret","access_token":"old-access-token","refresh_token":"old-refresh-token"}'::jsonb,
        now() + interval '180 days', 30, 14, 0
      )`,
    );
    await setClaims(db, "service_role");
    const refreshedCredentialId = await scalar(
      db,
      `select public.sellerpilot_service_refresh_lazada(
        $1,
        '{"app_key":"test-app","app_secret":"test-secret","access_token":"new-access-token","refresh_token":"new-refresh-token"}'::jsonb,
        now() + interval '180 days'
      )`,
      [lazadaCredentialId],
    );
    assert.notEqual(refreshedCredentialId, lazadaCredentialId);
    const refreshedSecret = await scalar(
      db,
      "select public.sellerpilot_get_active_credential_secret('lazada', 'production')",
    );
    assert.equal(refreshedSecret.secret_payload.access_token, "new-access-token");
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_consume_lazada_im_bootstrap($1)", [refreshedCredentialId]),
      true,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_consume_lazada_im_bootstrap($1)", [refreshedCredentialId]),
      false,
    );
    const lazadaBootstrapJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'inquiries.list',
        '{"arguments":{"bootstrap":true,"startTime":1787616000000,"pageSize":20,"sessionLimit":100}}'::jsonb
      )`,
      [refreshedCredentialId],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'running', claim_token = gen_random_uuid(), started_at = now() where id = $1",
      [lazadaBootstrapJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_record_lazada_im_bootstrap_result($1, $2, false)",
        [lazadaBootstrapJobId, refreshedCredentialId],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select lazada_im_bootstrap_succeeded_at is null
           from sellerpilot_private.channel_sync_state
          where owner_id = $1 and channel_key = 'lazada' and data_type = 'inquiries'`,
        [ADMIN_ID],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_record_lazada_im_bootstrap_result($1, $2, true)",
        [lazadaBootstrapJobId, refreshedCredentialId],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select lazada_im_bootstrap_attempted_at is not null as attempted,
                lazada_im_bootstrap_succeeded_at is not null as succeeded,
                last_succeeded_at is null as ordinary_sync_still_separate
           from sellerpilot_private.channel_sync_state
          where owner_id = $1 and channel_key = 'lazada' and data_type = 'inquiries'`,
        [ADMIN_ID],
      )).rows,
      [{ attempted: true, succeeded: true, ordinary_sync_still_separate: true }],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [lazadaBootstrapJobId],
    );
    const lazadaNonBootstrapJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'inquiries.list', '{"arguments":{"bootstrap":false}}'::jsonb
      )`,
      [refreshedCredentialId],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'running', claim_token = gen_random_uuid(), started_at = now() where id = $1",
      [lazadaNonBootstrapJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_record_lazada_im_bootstrap_result($1, $2, true)",
        [lazadaNonBootstrapJobId, refreshedCredentialId],
      ),
      false,
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [lazadaNonBootstrapJobId],
    );

    const oauthStateHash = "c".repeat(64);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_store_channel_oauth_state($1, $2, 'lazada', $3)",
        [SECOND_ADMIN_ID, refreshedCredentialId, oauthStateHash],
      ),
      true,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_store_channel_oauth_state($1, $2, 'lazada', $3)",
        [NON_ADMIN_ID, refreshedCredentialId, "d".repeat(64)],
      ),
      /invalid oauth state request/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_claim_channel_oauth_state($1, 'lazada', $2)",
        [ADMIN_ID, oauthStateHash],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_claim_channel_oauth_state($1, 'lazada', $2)",
        [SECOND_ADMIN_ID, oauthStateHash],
      ),
      refreshedCredentialId,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_claim_channel_oauth_state($1, 'lazada', $2)",
        [SECOND_ADMIN_ID, oauthStateHash],
      ),
      null,
    );

    await setClaims(db);
    for (const channel of ["coupang", "elevenst", "smartstore", "ebay", "temu"]) {
      const id = await scalar(
        db,
        "select public.sellerpilot_rotate_credential($1, 'production', $2::jsonb, now() + interval '180 days', 90, 30, 0)",
        [channel, JSON.stringify({ key: `${channel}-test-key`, access_token: "old-access-token", refresh_token: "old-refresh-token", client_id: "test-client", client_secret: "test-secret" })],
      );
      assert.match(id, /^[0-9a-f-]{36}$/i);
    }
    await setClaims(db, "service_role");
    const ebayActive = await scalar(db, "select public.sellerpilot_get_active_credential_secret('ebay', 'production')");
    const refreshedEbayId = await scalar(
      db,
      `select public.sellerpilot_service_refresh_ebay(
        $1,
        '{"client_id":"test-client","client_secret":"test-secret","access_token":"new-ebay-access-token","refresh_token":"old-refresh-token"}'::jsonb,
        now() + interval '180 days'
      )`,
      [ebayActive.credential_id],
    );
    assert.notEqual(refreshedEbayId, ebayActive.credential_id);
    const refreshedEbay = await scalar(db, "select public.sellerpilot_get_active_credential_secret('ebay', 'production')");
    assert.equal(refreshedEbay.secret_payload.access_token, "new-ebay-access-token");

    await setClaims(db);
    const operationFingerprint = "b".repeat(64);
    const claimedOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'orders-20260816-page-0001', $2)",
      [credentialId, operationFingerprint],
    );
    assert.equal(claimedOperation.duplicate, false);
    assert.equal(claimedOperation.status, "running");
    const duplicateOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'orders-20260816-page-0001', $2)",
      [credentialId, operationFingerprint],
    );
    assert.equal(duplicateOperation.duplicate, true);
    assert.equal(duplicateOperation.attempt_id, claimedOperation.attempt_id);
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_channel_operation($1, 'succeeded', 200, 'remote-1', 'read completed')",
        [claimedOperation.attempt_id],
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_operation_attempts where id = $1", [claimedOperation.attempt_id]),
      "succeeded",
    );

    await setClaims(db);
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('test worker', $1, 'AAAAAAAAAAAA', now() + interval '30 days')",
      [TOKEN_HASH],
    );
    const shopeeCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production',
        '{"partner_id":"2031489","partner_key":"test-partner-key-long","shop_id":"123456789","access_token":"test-access-token","refresh_token":"test-refresh-token"}'::jsonb,
        now() + interval '365 days', 90, 30, 0
      )`,
    );
    const shopeeAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'categories.list', 'shopee-categories-migration-0001', $2)",
      [shopeeCredentialId, "d".repeat(64)],
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_validate_worker_token($1, 'migration-test/1.9')", [TOKEN_HASH]),
      true,
    );
    const gatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, $2, 'shopee', 'categories.list', '{\"arguments\":{\"shopId\":\"123456789\"}}'::jsonb)",
      [shopeeCredentialId, shopeeAttempt.attempt_id],
    );
    const gatewayClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/1.2')",
      [TOKEN_HASH],
    );
    assert.equal(gatewayClaim.id, gatewayJobId);
    assert.equal(gatewayClaim.credential.partner_key, "test-partner-key-long");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_channel_gateway_job($1, $2, $3, 'migration-test/gateway-heartbeat')",
        [TOKEN_HASH, gatewayJobId, gatewayClaim.claim_token],
      ),
      "running",
    );
    assert.equal(
      await scalar(
        db,
        "select lease_expires_at >= now() + interval '14 minutes' from sellerpilot_private.channel_gateway_jobs where id = $1",
        [gatewayJobId],
      ),
      true,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_touch_channel_gateway_job($1, $2, $3, 'migration-test/gateway-invalid-token')",
        ["f".repeat(64), gatewayJobId, gatewayClaim.claim_token],
      ),
      /invalid worker token/,
    );
    const gatewayOwnerTokenId = await scalar(
      db,
      "select worker_token_id from sellerpilot_private.channel_gateway_jobs where id = $1",
      [gatewayJobId],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set worker_token_id = null where id = $1",
      [gatewayJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_channel_gateway_job($1, $2, $3, 'migration-test/gateway-wrong-owner')",
        [TOKEN_HASH, gatewayJobId, gatewayClaim.claim_token],
      ),
      "ownership_lost",
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set worker_token_id = $2, lease_expires_at = now() - interval '1 second' where id = $1",
      [gatewayJobId, gatewayOwnerTokenId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_channel_gateway_job($1, $2, $3, 'migration-test/gateway-expired')",
        [TOKEN_HASH, gatewayJobId, gatewayClaim.claim_token],
      ),
      "ownership_lost",
    );
    assert.equal(
      await scalar(
        db,
        "select lease_expires_at <= now() from sellerpilot_private.channel_gateway_jobs where id = $1",
        [gatewayJobId],
      ),
      true,
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() + interval '15 minutes' where id = $1",
      [gatewayJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_channel_gateway_completion($1, $2, $3)",
        ["b".repeat(64), gatewayJobId, gatewayClaim.claim_token],
      ),
      null,
    );
    const ownedGatewayJob = await scalar(
      db,
      "select public.sellerpilot_service_begin_channel_gateway_completion($1, $2, $3)",
      [TOKEN_HASH, gatewayJobId, gatewayClaim.claim_token],
    );
    assert.equal(ownedGatewayJob.id, gatewayJobId);
    assert.equal(ownedGatewayJob.status, "running");
    const gatewayResponse = {
      ok: true,
      channel: "shopee",
      operation: "categories.list",
      steps: [{ name: "categories", ok: true, status: 200, data: { response: { category_list: [] } } }],
      safeMessage: "Shopee category read completed.",
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_channel_gateway_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, gatewayJobId, gatewayClaim.claim_token, JSON.stringify(gatewayResponse)],
      ),
      true,
    );
    const gatewaySnapshot = await scalar(db, "select public.sellerpilot_get_channel_gateway_job($1)", [gatewayJobId]);
    assert.equal(gatewaySnapshot.status, "succeeded");
    assert.equal(gatewaySnapshot.response.operation, "categories.list");

    await setClaims(db);
    const refreshPreparationAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'categories.list', 'shopee-refresh-preparation-0001', $2)",
      [shopeeCredentialId, "9".repeat(64)],
    );
    const crossJobAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'categories.list', 'shopee-refresh-cross-job-0002', $2)",
      [shopeeCredentialId, "8".repeat(64)],
    );
    await setClaims(db, "service_role");
    const refreshPreparationJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, $2, 'shopee', 'categories.list', '{\"arguments\":{\"language\":\"en\"}}'::jsonb)",
      [shopeeCredentialId, refreshPreparationAttempt.attempt_id],
    );
    const crossJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, $2, 'shopee', 'categories.list', '{\"arguments\":{\"language\":\"ko\"}}'::jsonb)",
      [shopeeCredentialId, crossJobAttempt.attempt_id],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set created_at = created_at - interval '1 minute' where id = $1",
      [refreshPreparationJobId],
    );
    const simultaneousClaims = await Promise.all([
      scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/simultaneous-a')", [TOKEN_HASH]),
      scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/simultaneous-b')", [TOKEN_HASH]),
    ]);
    const claimedForCredential = simultaneousClaims.filter(Boolean);
    assert.equal(claimedForCredential.length, 1);
    assert.equal(claimedForCredential[0].id, refreshPreparationJobId);
    assert.equal(simultaneousClaims.filter((claim) => claim === null).length, 1);
    const refreshPreparationClaim = claimedForCredential[0];
    await assert.rejects(
      db.query(
        "update sellerpilot_private.channel_gateway_jobs set status = 'running', claim_token = gen_random_uuid() where id = $1",
        [crossJobId],
      ),
      /duplicate key|unique constraint/i,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id = $1", [crossJobId]),
      "queued",
    );
    await setClaims(db);
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('secondary test worker', $1, 'EEEEEEEEEEEE', now() + interval '30 days')",
      [SECOND_WORKER_TOKEN_HASH],
    );
    await setClaims(db, "service_role");
    const refreshPayload = {
      partner_id: "2031489",
      partner_key: "test-partner-key-long",
      shop_id: "123456789",
      access_token: "prepared-access-token",
      refresh_token: "prepared-refresh-token",
    };
    const refreshExpiresAt = "2099-01-01T00:00:00.000Z";
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
        [SECOND_WORKER_TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token, JSON.stringify(refreshPayload), refreshExpiresAt],
      ),
      null,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'revoked', revoked_at = now() where token_hash = $1",
      [SECOND_WORKER_TOKEN_HASH],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'active', revoked_at = null where token_hash = $1",
      [TOKEN_HASH],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
        ["f".repeat(64), refreshPreparationJobId, refreshPreparationClaim.claim_token, JSON.stringify(refreshPayload), refreshExpiresAt],
      ),
      /invalid worker token/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
        [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token],
      ),
      true,
    );
    const firstPreparation = await scalar(
      db,
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
      [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token, JSON.stringify(refreshPayload), refreshExpiresAt],
    );
    assert.equal(firstPreparation.status, "prepared");
    assert.equal(firstPreparation.reused, false);
    assert.match(firstPreparation.credential_id, /^[0-9a-f-]{36}$/i);

    const retriedPreparation = await scalar(
      db,
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
      [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token, JSON.stringify(refreshPayload), refreshExpiresAt],
    );
    assert.deepEqual(retriedPreparation, {
      status: "prepared",
      credential_id: firstPreparation.credential_id,
      reused: true,
      oauth_complete: false,
    });
    const progressiveRefreshPayload = {
      ...refreshPayload,
      access_token: "different-access-token",
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
        [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token],
      ),
      true,
    );
    const progressivePreparation = await scalar(
      db,
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
      [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token, JSON.stringify(progressiveRefreshPayload), refreshExpiresAt],
    );
    assert.equal(progressivePreparation.status, "prepared");
    assert.equal(progressivePreparation.reused, false);
    assert.notEqual(progressivePreparation.credential_id, firstPreparation.credential_id);
    assert.deepEqual(
      (await db.query(
        `select prepared_credential_id::text,
                credential_refresh_fingerprint ~ '^[a-f0-9]{64}$' as fingerprint_recorded,
                credential_refresh_prepared_at is not null as prepared_at_recorded
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [refreshPreparationJobId],
      )).rows,
      [{
        prepared_credential_id: progressivePreparation.credential_id,
        fingerprint_recorded: true,
        prepared_at_recorded: true,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select j.status,
                j.credential_id::text as active_credential_id,
                j.attempt_id::text,
                a.credential_id::text as attempted_with_credential_id
           from sellerpilot_private.channel_gateway_jobs j
           join sellerpilot_private.channel_operation_attempts a on a.id = j.attempt_id
          where j.id = $1`,
        [crossJobId],
      )).rows,
      [{
        status: "queued",
        active_credential_id: progressivePreparation.credential_id,
        attempt_id: crossJobAttempt.attempt_id,
        attempted_with_credential_id: shopeeCredentialId,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select count(*)::integer as credential_count,
                count(*) filter (where status = 'active')::integer as active_count,
                max(version)::integer as max_version
           from sellerpilot_private.channel_credentials
          where channel = 'shopee' and environment = 'production'`,
      )).rows,
      [{ credential_count: 3, active_count: 1, max_version: 3 }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)
           from sellerpilot_private.credential_audit
          where credential_id = $1 and action = 'token_refreshed'`,
        [progressivePreparation.credential_id],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select j.credential_id::text as active_credential_id,
                j.attempt_id::text,
                a.credential_id::text as attempted_with_credential_id
           from sellerpilot_private.channel_gateway_jobs j
           join sellerpilot_private.channel_operation_attempts a on a.id = j.attempt_id
          where j.id = $1`,
        [refreshPreparationJobId],
      )).rows,
      [{
        active_credential_id: progressivePreparation.credential_id,
        attempt_id: refreshPreparationAttempt.attempt_id,
        attempted_with_credential_id: shopeeCredentialId,
      }],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [refreshPreparationJobId],
    );
    const reclaimedRefreshJob = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/credential-preparation-reclaim')",
      [TOKEN_HASH],
    );
    assert.equal(reclaimedRefreshJob.id, refreshPreparationJobId);
    assert.equal(reclaimedRefreshJob.credential_id, progressivePreparation.credential_id);
    assert.equal(reclaimedRefreshJob.credential.access_token, progressiveRefreshPayload.access_token);
    assert.notEqual(reclaimedRefreshJob.claim_token, refreshPreparationClaim.claim_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_channel_gateway_job($1, $2, $3, 'migration-test/stale-gateway-heartbeat')",
        [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token],
      ),
      "ownership_lost",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_channel_gateway_completion($1, $2, $3)",
        [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
        [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token, JSON.stringify(refreshPayload), refreshExpiresAt],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_channel_gateway_job($1, $2, $3, 'failed', null, 'stale-completion')",
        [TOKEN_HASH, refreshPreparationJobId, refreshPreparationClaim.claim_token],
      ),
      false,
    );
    const reclaimedPreparation = await scalar(
      db,
      "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
      [TOKEN_HASH, refreshPreparationJobId, reclaimedRefreshJob.claim_token, JSON.stringify(progressiveRefreshPayload), refreshExpiresAt],
    );
    assert.equal(reclaimedPreparation.credential_id, progressivePreparation.credential_id);
    assert.equal(reclaimedPreparation.reused, true);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_channel_gateway_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, refreshPreparationJobId, reclaimedRefreshJob.claim_token, JSON.stringify(gatewayResponse)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [refreshPreparationJobId],
      ),
      "succeeded",
    );
    const claimedCrossJob = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/cross-job-after-refresh')",
      [TOKEN_HASH],
    );
    assert.equal(claimedCrossJob.id, crossJobId);
    assert.equal(claimedCrossJob.credential_id, progressivePreparation.credential_id);
    assert.equal(claimedCrossJob.credential.access_token, progressiveRefreshPayload.access_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_channel_gateway_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, crossJobId, claimedCrossJob.claim_token, JSON.stringify(gatewayResponse)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
        [TOKEN_HASH, refreshPreparationJobId, reclaimedRefreshJob.claim_token, JSON.stringify(refreshPayload), refreshExpiresAt],
      ),
      null,
    );
    await setClaims(db);
    const uncertainWriteAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'inventory.update', 'shopee-uncertain-inventory-0001', $2)",
      [progressivePreparation.credential_id, "7".repeat(64)],
    );
    await setClaims(db, "service_role");
    const uncertainWriteEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_resource_gateway_job(
        $1, $2, 'shopee', 'inventory.update',
        '{"arguments":{"itemId":123,"stock":4}}'::jsonb,
        'listing_mutation', $3, $4
      )`,
      [progressivePreparation.credential_id, uncertainWriteAttempt.attempt_id, "6".repeat(64), "7".repeat(64)],
    );
    const uncertainWriteJobId = uncertainWriteEnqueue.job_id;
    const uncertainWriteClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/uncertain-write')",
      [TOKEN_HASH],
    );
    assert.equal(uncertainWriteClaim.id, uncertainWriteJobId);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_channel_gateway_job($1, $2, $3, 'reconciliation_required', null, 'Provider response was lost after inventory write.')",
        [TOKEN_HASH, uncertainWriteJobId, uncertainWriteClaim.claim_token],
      ),
      true,
    );
    const uncertainWriteSnapshot = await scalar(
      db,
      "select public.sellerpilot_get_channel_gateway_job($1)",
      [uncertainWriteJobId],
    );
    assert.equal(uncertainWriteSnapshot.id, uncertainWriteJobId);
    assert.equal(uncertainWriteSnapshot.status, "reconciliation_required");
    assert.equal(uncertainWriteSnapshot.error, "Provider response was lost after inventory write.");
    assert.equal(uncertainWriteSnapshot.response, null);
    assert.equal(uncertainWriteSnapshot.attempt_id, uncertainWriteAttempt.attempt_id);
    assert.deepEqual(
      (await db.query(
        "select status, http_status, safe_message from sellerpilot_private.channel_operation_attempts where id = $1",
        [uncertainWriteAttempt.attempt_id],
      )).rows,
      [{
        status: "manual_required",
        http_status: 409,
        safe_message: "Provider response was lost after inventory write.",
      }],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_channel_gateway_job($1, $2, $3, 'migration-test/reconciliation-terminal')",
        [TOKEN_HASH, uncertainWriteJobId, uncertainWriteClaim.claim_token],
      ),
      "ownership_lost",
    );

    const refreshCrashJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, null, 'shopee', 'diagnostic.test', '{}'::jsonb)",
      [progressivePreparation.credential_id],
    );
    const refreshBlockedJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, null, 'shopee', 'categories.list', '{\"arguments\":{}}'::jsonb)",
      [progressivePreparation.credential_id],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set created_at=created_at-interval '2 minutes' where id=$1",
      [refreshCrashJobId],
    );
    const refreshCrashClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/refresh-crash')",
      [TOKEN_HASH],
    );
    assert.equal(refreshCrashClaim.id, refreshCrashJobId);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1,$2,$3)",
      [TOKEN_HASH, refreshCrashJobId, refreshCrashClaim.claim_token],
    ), true);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
      [refreshCrashJobId],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/refresh-must-not-retry')", [TOKEN_HASH]),
      null,
    );
    assert.deepEqual((await db.query(
      `select status,credential_refresh_in_flight,error_message
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [refreshCrashJobId],
    )).rows[0], {
      status: "reconciliation_required",
      credential_refresh_in_flight: true,
      error_message: "Gateway credential refresh outcome requires reconciliation.",
    });
    assert.equal(await scalar(
      db,
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [refreshBlockedJobId],
    ), "queued");
    // Test-only cleanup simulates an operator resolving the credential outcome
    // so unrelated migration assertions can continue on this shared fixture.
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='cancelled',credential_refresh_in_flight=false,
              credential_refresh_started_at=null,completed_at=now()
        where id=any($1::uuid[])`,
      [[refreshCrashJobId, refreshBlockedJobId]],
    );
    await setClaims(db);
    const requiredManualFields = {
      researchInput: "https://example.test/product/1 흰색 도자기 머그컵 상세정보",
      productName: "AI 생성 테스트 상품",
      sellerSku: "AI-REQUIRED-001",
      categoryHint: "도자기 머그컵",
      brandName: "No Brand",
      manufacturer: "테스트 공급처",
      countryOfOrigin: "대한민국",
      material: "도자기 100%",
      packageContents: "머그컵 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 12900,
      currency: "KRW",
      stock: 2,
      weightKg: 0.35,
      packageLengthCm: 12,
      packageWidthCm: 12,
      packageHeightCm: 10,
      shippingFeeKrw: 0,
      shippingRule: "기본 배송",
      packagingRule: "파손 방지 포장",
      description: "실제 사진과 입력값을 교차검증하는 흰색 도자기 머그컵입니다.",
      productUrl: "https://example.test/product/1",
      imageRightsConfirmed: true,
      productFactsConfirmed: true,
    };
    const requestPayload = {
      image_paths: [`${ADMIN_ID}/${JOB_ID}/input/hero.jpg`],
      image_specs: [{ name: "hero.jpg", role: "main", originalWidth: 1200, originalHeight: 1200, width: 1200, height: 1200, bytes: 120000, mediaType: "image/jpeg", fit: "contain" }],
      manual_fields: requiredManualFields,
      description: "실제 상품 분석 테스트",
      product_url: "https://example.test/product/1",
      research_input: requiredManualFields.researchInput,
    };

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [CLAIM_PREPARATION_JOB_ID, JSON.stringify({
        ...requestPayload,
        image_paths: [`${ADMIN_ID}/${CLAIM_PREPARATION_JOB_ID}/input/hero.jpg`],
      })],
    );
    await setClaims(db, "service_role");
    const preparationClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/preparation-release')",
      [TOKEN_HASH],
    );
    assert.equal(preparationClaim.id, CLAIM_PREPARATION_JOB_ID);
    assert.equal(preparationClaim.attempt_count, 1);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_ai_job_claim($1, $2, $3, 'wrong-owner', 60)",
        ["b".repeat(64), CLAIM_PREPARATION_JOB_ID, preparationClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.ai_cli_jobs where id = $1", [CLAIM_PREPARATION_JOB_ID]),
      "running",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_ai_job_claim($1, $2, $3, 'source_image_signing_failed', 60)",
        [TOKEN_HASH, CLAIM_PREPARATION_JOB_ID, preparationClaim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status,
                attempt_count,
                preparation_failure_count,
                worker_token_id is null as worker_released,
                lease_expires_at is null as lease_released,
                available_at > now() as retry_delayed,
                started_at is null as never_started
           from sellerpilot_private.ai_cli_jobs
          where id = $1`,
        [CLAIM_PREPARATION_JOB_ID],
      )).rows,
      [{
        status: "queued",
        attempt_count: 0,
        preparation_failure_count: 1,
        worker_released: true,
        lease_released: true,
        retry_delayed: true,
        never_started: true,
      }],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_ai_job($1, 'migration-test/delay-check')", [TOKEN_HASH]),
      null,
    );

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set available_at = now() - interval '1 second' where id = $1",
      [CLAIM_PREPARATION_JOB_ID],
    );
    const secondPreparationClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/preparation-release-2')",
      [TOKEN_HASH],
    );
    assert.equal(secondPreparationClaim.id, CLAIM_PREPARATION_JOB_ID);
    assert.equal(secondPreparationClaim.attempt_count, 1);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_ai_job_claim($1, $2, $3, 'result_upload_signing_failed', 60)",
        [TOKEN_HASH, CLAIM_PREPARATION_JOB_ID, secondPreparationClaim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, preparation_failure_count
           from sellerpilot_private.ai_cli_jobs
          where id = $1`,
        [CLAIM_PREPARATION_JOB_ID],
      )).rows,
      [{ status: "queued", attempt_count: 0, preparation_failure_count: 2 }],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set available_at = now() - interval '1 second' where id = $1",
      [CLAIM_PREPARATION_JOB_ID],
    );
    const terminalPreparationClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/preparation-release-3')",
      [TOKEN_HASH],
    );
    assert.equal(terminalPreparationClaim.id, CLAIM_PREPARATION_JOB_ID);
    assert.equal(terminalPreparationClaim.attempt_count, 1);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_ai_job_claim($1, $2, $3, 'comparison_image_signing_failed', 60)",
        [TOKEN_HASH, CLAIM_PREPARATION_JOB_ID, terminalPreparationClaim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status,
                attempt_count,
                preparation_failure_count,
                error_message,
                worker_token_id is null as worker_released,
                lease_expires_at is null as lease_released,
                completed_at is not null as completed
           from sellerpilot_private.ai_cli_jobs
          where id = $1`,
        [CLAIM_PREPARATION_JOB_ID],
      )).rows,
      [{
        status: "failed",
        attempt_count: 0,
        preparation_failure_count: 3,
        error_message: "Claim preparation failed three times: comparison_image_signing_failed",
        worker_released: true,
        lease_released: true,
        completed: true,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)
           from sellerpilot_private.ai_cli_audit
          where job_id = $1
            and action = 'job_retried'
            and safe_detail->>'source' = 'claim_preparation'
            and (safe_detail->>'retry_after_seconds')::integer = 60
            and (safe_detail->>'terminal')::boolean = false`,
        [CLAIM_PREPARATION_JOB_ID],
      ),
      2,
    );
    assert.deepEqual(
      (await db.query(
        `select safe_detail->>'reason' as reason,
                (safe_detail->>'preparation_failure_count')::integer as preparation_failure_count,
                (safe_detail->>'terminal')::boolean as terminal
           from sellerpilot_private.ai_cli_audit
          where job_id = $1
            and action = 'job_failed'
            and safe_detail->>'source' = 'claim_preparation'`,
        [CLAIM_PREPARATION_JOB_ID],
      )).rows,
      [{ reason: "comparison_image_signing_failed", preparation_failure_count: 3, terminal: true }],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set available_at = now() - interval '1 second' where id = $1",
      [CLAIM_PREPARATION_JOB_ID],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_ai_job($1, 'migration-test/preparation-terminal')", [TOKEN_HASH]),
      null,
    );
    await db.query("delete from sellerpilot_private.ai_cli_audit where job_id = $1", [CLAIM_PREPARATION_JOB_ID]);
    await db.query("delete from sellerpilot_private.ai_cli_jobs where id = $1", [CLAIM_PREPARATION_JOB_ID]);

    await setClaims(db);
    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [CLAIM_PREPARATION_JOB_ID, JSON.stringify({
        ...requestPayload,
        image_paths: [`${ADMIN_ID}/${CLAIM_PREPARATION_JOB_ID}/input/hero.jpg`],
      })],
    );
    await setClaims(db, "service_role");
    const deterministicFailureClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/deterministic-failure')",
      [TOKEN_HASH],
    );
    assert.equal(deterministicFailureClaim.id, CLAIM_PREPARATION_JOB_ID);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'failed', null, 'invalid_asset_regeneration_payload')",
        [TOKEN_HASH, CLAIM_PREPARATION_JOB_ID, deterministicFailureClaim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status,
                error_message,
                preparation_failure_count,
                lease_expires_at is null as lease_released,
                completed_at is not null as completed
           from sellerpilot_private.ai_cli_jobs
          where id = $1`,
        [CLAIM_PREPARATION_JOB_ID],
      )).rows,
      [{
        status: "failed",
        error_message: "invalid_asset_regeneration_payload",
        preparation_failure_count: 0,
        lease_released: true,
        completed: true,
      }],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_cli_audit where job_id = $1 and action = 'job_failed'",
        [CLAIM_PREPARATION_JOB_ID],
      ),
      1,
    );
    await db.query("delete from sellerpilot_private.ai_cli_audit where job_id = $1", [CLAIM_PREPARATION_JOB_ID]);
    await db.query("delete from sellerpilot_private.ai_cli_jobs where id = $1", [CLAIM_PREPARATION_JOB_ID]);
    await setClaims(db);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [STALE_AI_JOB_ID, JSON.stringify({
        ...requestPayload,
        image_paths: [`${ADMIN_ID}/${STALE_AI_JOB_ID}/input/hero.jpg`],
      })],
    );
    await setClaims(db, "service_role");
    const staleAiClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/stale-ai-first')",
      [TOKEN_HASH],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [STALE_AI_JOB_ID],
    );
    const currentAiClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/stale-ai-reclaim-same-token')",
      [TOKEN_HASH],
    );
    assert.equal(currentAiClaim.id, STALE_AI_JOB_ID);
    assert.notEqual(currentAiClaim.claim_token, staleAiClaim.claim_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_ai_job($1, $2, $3, 'migration-test/stale-ai-heartbeat')",
        [TOKEN_HASH, STALE_AI_JOB_ID, staleAiClaim.claim_token],
      ),
      "ownership_lost",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)",
        [TOKEN_HASH, STALE_AI_JOB_ID, staleAiClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_ai_job_claim($1, $2, $3, 'stale-release', 60)",
        [TOKEN_HASH, STALE_AI_JOB_ID, staleAiClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'failed', null, 'stale-completion')",
        [TOKEN_HASH, STALE_AI_JOB_ID, staleAiClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_touch_ai_job($1, $2, $3, 'migration-test/current-ai-heartbeat')",
        [TOKEN_HASH, STALE_AI_JOB_ID, currentAiClaim.claim_token],
      ),
      "running",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'failed', null, 'same-token stale claim fenced')",
        [TOKEN_HASH, STALE_AI_JOB_ID, currentAiClaim.claim_token],
      ),
      true,
    );
    await db.query("delete from sellerpilot_private.ai_cli_audit where job_id = $1", [STALE_AI_JOB_ID]);
    await db.query("delete from sellerpilot_private.ai_cli_jobs where id = $1", [STALE_AI_JOB_ID]);
    await setClaims(db);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [JOB_ID, JSON.stringify(requestPayload)],
    );

    await setClaims(db, "service_role");
    const claimed = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/1.0')",
      [TOKEN_HASH],
    );
    assert.equal(claimed.id, JOB_ID);
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)", ["b".repeat(64), JOB_ID, claimed.claim_token]),
      false,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)", [TOKEN_HASH, JOB_ID, claimed.claim_token]),
      true,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_touch_ai_job($1, $2, $3, 'migration-test/1.0')", [TOKEN_HASH, JOB_ID, claimed.claim_token]),
      "running",
    );
    const resultPayload = {
      mode: "cli",
      title: "AI 생성 테스트 상품",
      detail_copy: "상품 사실정보를 반영한 테스트 결과",
      asset_storage_paths: aiClaimAssetPaths(JOB_ID, claimed.claim_token),
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, JSON.stringify(resultPayload)],
      ),
      true,
    );
    const automaticallyReconciledProductId = await scalar(
      db,
      "select id from sellerpilot_private.products where ai_job_id = $1",
      [JOB_ID],
    );
    assert.match(automaticallyReconciledProductId, /^[0-9a-f-]{36}$/i);

    await setClaims(db);
    const readyRegistrationActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(20)");
    const readyRegistrationCard = readyRegistrationActivity.find((activity) => activity.productId === automaticallyReconciledProductId);
    const completedAnalysisSeconds = Number(await scalar(
      db,
      "select greatest(0, extract(epoch from (completed_at - created_at))::bigint) from sellerpilot_private.ai_cli_jobs where id = $1",
      [JOB_ID],
    ));
    assert.equal(readyRegistrationCard.status, "ready");
    assert.notEqual(readyRegistrationCard.completedAt, null);
    assert.equal(readyRegistrationCard.elapsedSeconds, completedAnalysisSeconds);

    const duplicateSkuRequest = {
      ...requestPayload,
      image_paths: [`${ADMIN_ID}/${DUPLICATE_SKU_JOB_ID}/input/hero.jpg`],
    };
    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [DUPLICATE_SKU_JOB_ID, JSON.stringify(duplicateSkuRequest)],
    );
    await setClaims(db, "service_role");
    const duplicateSkuClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/duplicate-sku')",
      [TOKEN_HASH],
    );
    assert.equal(duplicateSkuClaim.id, DUPLICATE_SKU_JOB_ID);
    const duplicateSkuResult = {
      ...resultPayload,
      asset_storage_paths: aiClaimAssetPaths(DUPLICATE_SKU_JOB_ID, duplicateSkuClaim.claim_token),
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, DUPLICATE_SKU_JOB_ID, duplicateSkuClaim.claim_token, JSON.stringify(duplicateSkuResult)],
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.ai_cli_jobs where id = $1", [DUPLICATE_SKU_JOB_ID]),
      "succeeded",
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.products where ai_job_id = $1", [DUPLICATE_SKU_JOB_ID]),
      0,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.operation_audit where entity_id = $1 and action = 'product_reconciliation_blocked'", [DUPLICATE_SKU_JOB_ID]),
      1,
    );

    await setClaims(db);
    const aiProductId = await scalar(
      db,
      "select public.sellerpilot_create_product_from_ai_v2($1)",
      [JOB_ID],
    );
    assert.match(aiProductId, /^[0-9a-f-]{36}$/i);
    assert.equal(aiProductId, automaticallyReconciledProductId);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_create_asset_regeneration_job($1, $2, $3, 'detail-use')",
        [REGEN_JOB_ID, JOB_ID, aiProductId],
      ),
      REGEN_JOB_ID,
    );
    assert.equal(
      await scalar(
        db,
        "select case when request_payload->'comparison_asset_paths'->>'hero' = $2 then 1 else 0 end from sellerpilot_private.ai_cli_jobs where id = $1",
        [REGEN_JOB_ID, resultPayload.asset_storage_paths.hero],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select (safe_detail->>'comparison_asset_count')::integer from sellerpilot_private.ai_cli_audit where job_id = $1 and action = 'job_queued' order by occurred_at desc limit 1",
        [REGEN_JOB_ID],
      ),
      8,
    );
    assert.equal(await scalar(db, "select sku from sellerpilot_private.products where id = $1", [aiProductId]), "AI-REQUIRED-001");
    const competitorMarketplaces = ["smartstore", "coupang", "elevenst", "qoo10", "shopee", "lazada", "ebay", "temu", "other"];
    const competitorItems = Array.from({ length: 27 }, (_, index) => ({
      provider: "naver_shopping",
      externalId: `competitor-${index + 1}`,
      title: `동일 상품 가격 후보 ${index + 1}`,
      url: `https://marketplace.example.test/products/${index + 1}`,
      imageUrl: `https://marketplace.example.test/images/${index + 1}.jpg`,
      mallName: `테스트 판매처 ${index + 1}`,
      marketplace: competitorMarketplaces[index % competitorMarketplaces.length],
      price: 10_000 + index,
      currency: "KRW",
    }));
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_record_competitor_prices($1, $2::jsonb)",
        [aiProductId, JSON.stringify(competitorItems)],
      ),
      27,
    );
    const competitorMarketplaceCounts = await db.query(
      `select marketplace, count(*)::integer as count
         from sellerpilot_private.competitor_price_observations
        where product_id = $1
        group by marketplace
        order by marketplace`,
      [aiProductId],
    );
    assert.deepEqual(
      competitorMarketplaceCounts.rows,
      [...competitorMarketplaces].sort().map((marketplace) => ({ marketplace, count: 3 })),
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_record_competitor_prices(
          $1,
          '[{"externalId":"competitor-invalid-market","title":"잘못된 채널 후보","url":"https://marketplace.example.test/products/invalid","imageUrl":"","mallName":"알 수 없는 판매처","marketplace":"unknown-market","price":9999}]'::jsonb
        )`,
        [aiProductId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select marketplace from sellerpilot_private.competitor_price_observations where product_id = $1 and external_id = 'competitor-invalid-market'",
        [aiProductId],
      ),
      "other",
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_record_competitor_prices(
          $1,
          '[{"provider":"ebay_browse","externalId":"competitor-1","title":"Kellogg Choco Chex 570g","url":"https://www.ebay.com/itm/competitor-1","imageUrl":"","mallName":"eBay","marketplace":"ebay","price":12.5,"currency":"USD"}]'::jsonb
        )`,
        [aiProductId],
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        "select provider,currency,price::text from sellerpilot_private.competitor_price_observations where product_id=$1 and external_id='competitor-1' order by provider",
        [aiProductId],
      )).rows,
      [
        { provider: "ebay_browse", currency: "USD", price: "12.50" },
        { provider: "naver_shopping", currency: "KRW", price: "10000.00" },
      ],
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_record_competitor_prices(
          $1,
          '[{"provider":"unknown_provider","externalId":"invalid-provider","title":"잘못된 공급자","url":"https://example.test/invalid","mallName":"invalid","marketplace":"other","price":1,"currency":"KRW"}]'::jsonb
        )`,
        [aiProductId],
      ),
      /invalid competitor provider/,
    );
    await setClaims(db);
    await assert.rejects(
      db.query(
        `select public.sellerpilot_save_product_category_assignment(
          $1, 'ai-job-category-test', 'AI 생성 테스트 상품', 'coupang', 'production', 'KR',
          '63955', array['생활용품','세제','표백제','분말형'], true, 0.98,
          'channel_recommendation',
          '[{"id":"quantity","name":"수량","required":true}]'::jsonb,
          '{}'::jsonb, '{"verifiedBy":"channel_api"}'::jsonb, true
        )`,
        [aiProductId],
      ),
      /category confirmation requires an active leaf and every required attribute/,
    );
    const categoryAssignmentId = await scalar(
      db,
      `select public.sellerpilot_save_product_category_assignment(
        $1, 'ai-job-category-test', 'AI 생성 테스트 상품', 'coupang', 'production', 'KR',
        '63955', array['생활용품','세제','표백제','분말형'], true, 0.98,
        'channel_recommendation',
        '[{"id":"quantity","name":"수량","required":true}]'::jsonb,
        '{"quantity":"1개"}'::jsonb, '{"verifiedBy":"channel_api"}'::jsonb, true
      )`,
      [aiProductId],
    );
    assert.match(categoryAssignmentId, /^[0-9a-f-]{36}$/i);
    const categoryAssignments = await db.query("select * from public.sellerpilot_list_product_category_assignments('ai-job-category-test')");
    assert.equal(categoryAssignments.rows.length, 1);
    assert.equal(categoryAssignments.rows[0].status, "confirmed");
    assert.deepEqual(categoryAssignments.rows[0].missing_required_attributes, []);
    const elevenstCategoryAssignmentId = await scalar(
      db,
      `select public.sellerpilot_save_product_category_assignment(
        $1, 'elevenst-category-test', '부착형 케이블 정리 클립 6개 세트', 'elevenst', 'production', 'Korea · OPEN API',
        '1341821', array['생활잡화','정리소품','케이블 정리소품'], true, 0.99,
        'official_tree_search', '[]'::jsonb, '{}'::jsonb, '{"verifiedBy":"channel_api"}'::jsonb, true
      )`,
      [aiProductId],
    );
    assert.match(elevenstCategoryAssignmentId, /^[0-9a-f-]{36}$/i);
    const elevenstCredentialId = await scalar(
      db,
      "select id from public.sellerpilot_list_credentials() where channel = 'elevenst' and status = 'active' limit 1",
    );
    const elevenstPreparedListingId = await scalar(
      db,
      "select public.sellerpilot_prepare_product_market_listing($1, 'elevenst', 'listing.create', '', '', 'KRW', 5000)",
      [aiProductId],
    );
    assert.match(elevenstPreparedListingId, /^[0-9a-f-]{36}$/i);
    const elevenstAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'elevenst', 'listing.create', 'elevenst-listing-migration-0001', $2)",
      [elevenstCredentialId, "e".repeat(64)],
    );
    await setClaims(db, "service_role");
    const elevenstGatewayEnqueue = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'elevenst', 'listing.create', '{\"arguments\":{\"verificationOnly\":true}}'::jsonb)",
      [elevenstPreparedListingId, elevenstCredentialId, elevenstAttempt.attempt_id],
    );
    const elevenstGatewayJobId = elevenstGatewayEnqueue.job_id;
    assert.equal(elevenstGatewayEnqueue.status, "queued");
    assert.equal(elevenstGatewayEnqueue.reused, false);
    assert.match(elevenstGatewayJobId, /^[0-9a-f-]{36}$/i);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'running',
              claim_token = gen_random_uuid(),
              worker_token_id = (select id from sellerpilot_private.ai_cli_worker_tokens where token_hash = $2),
              attempt_count = 1,
              lease_expires_at = now() - interval '1 second',
              started_at = now() - interval '16 minutes'
        where id = $1`,
      [elevenstGatewayJobId, TOKEN_HASH],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/expired-listing-write')",
        [TOKEN_HASH],
      ),
      null,
    );
    assert.deepEqual(
      (await db.query(
        "select status, error_message, worker_token_id, lease_expires_at from sellerpilot_private.channel_gateway_jobs where id = $1",
        [elevenstGatewayJobId],
      )).rows,
      [{
        status: "reconciliation_required",
        error_message: "Gateway write lease expired; provider outcome requires reconciliation.",
        worker_token_id: null,
        lease_expires_at: null,
      }],
    );
    assert.deepEqual(
      (await db.query(
        "select status, http_status, safe_message from sellerpilot_private.channel_operation_attempts where id = $1",
        [elevenstAttempt.attempt_id],
      )).rows,
      [{
        status: "manual_required",
        http_status: 409,
        safe_message: "Gateway write lease expired; provider outcome requires reconciliation.",
      }],
    );
    assert.deepEqual(
      (await db.query(
        "select status, failure_class, last_error from sellerpilot_private.product_listings where id = $1",
        [elevenstPreparedListingId],
      )).rows,
      [{
        status: "failed",
        failure_class: "external_action",
        last_error: "Gateway write lease expired; provider outcome requires reconciliation.",
      }],
    );
    const elevenstCompetitorJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, null, 'elevenst', 'competitor.search', '{\"primary\":\"첵스초코 570g\",\"aliases\":[\"Kellogg Choco Chex 570g\"],\"displayPerQuery\":30}'::jsonb)",
      [elevenstCredentialId],
    );
    assert.match(elevenstCompetitorJobId, /^[0-9a-f-]{36}$/i);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [elevenstCompetitorJobId],
    );
    await setClaims(db);
    const publishContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [aiProductId]);
    assert.equal(publishContext.product.id, aiProductId);
    assert.equal(publishContext.manualFields.sellerSku, "AI-REQUIRED-001");
    assert.equal(publishContext.imageSpecs[0].width, 1200);
    assert.equal(publishContext.assignments.length, 2);
    assert.equal(publishContext.assignments.some((assignment) => assignment.channel === "elevenst" && assignment.categoryId === "1341821"), true);
    await db.query(
      "update sellerpilot_private.products set on_hand = 0, product_facts = jsonb_set(product_facts, '{stock}', '100'::jsonb, true) where id = $1",
      [aiProductId],
    );
    const editedManualFields = {
      ...requiredManualFields,
      productName: "AI 생성 테스트 상품 설명 수정",
      description: "현재 품절 재고를 유지하면서 상품 설명과 표시정보만 수정한 검증 데이터입니다.",
      stock: 0,
    };
    assert.equal(
      await scalar(db, "select public.sellerpilot_update_product_details($1, $2::jsonb)", [aiProductId, JSON.stringify(editedManualFields)]),
      true,
    );
    assert.equal(await scalar(db, "select on_hand from sellerpilot_private.products where id = $1", [aiProductId]), 0);
    assert.equal(await scalar(db, "select (product_facts->>'stock')::integer from sellerpilot_private.products where id = $1", [aiProductId]), 0);
    assert.equal(
      await scalar(db, "select request_payload->'manual_fields'->>'productName' from sellerpilot_private.ai_cli_jobs where id = $1", [JOB_ID]),
      requiredManualFields.productName,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_update_product_details($1, $2::jsonb)",
        [aiProductId, JSON.stringify({ ...editedManualFields, stock: 999999 })],
      ),
      true,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_update_product_details($1, $2::jsonb)",
        [aiProductId, JSON.stringify({ ...editedManualFields, stock: 1000000 })],
      ),
      /invalid product details/,
    );
    await db.query("update sellerpilot_private.products set on_hand = 2 where id = $1", [aiProductId]);
    assert.equal(await scalar(db, "select (product_facts->>'stock')::integer from sellerpilot_private.products where id = $1", [aiProductId]), 2);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_update_product_details($1, $2::jsonb)",
        [aiProductId, JSON.stringify({ ...editedManualFields, stock: 0 })],
      ),
      true,
    );
    assert.equal(await scalar(db, "select on_hand from sellerpilot_private.products where id = $1", [aiProductId]), 2);
    assert.equal(await scalar(db, "select (product_facts->>'stock')::integer from sellerpilot_private.products where id = $1", [aiProductId]), 2);
    const coupangCredentialId = await scalar(
      db,
      "select id from public.sellerpilot_list_credentials() where channel = 'coupang' and status = 'active' limit 1",
    );
    const preparedListingId = await scalar(
      db,
      "select public.sellerpilot_prepare_product_listing($1, 'coupang', 'listing.create', 'KRW', 25000)",
      [aiProductId],
    );
    assert.match(preparedListingId, /^[0-9a-f-]{36}$/i);
    const listingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.create', 'listing-ai-product-coupang-0001', $2)",
      [coupangCredentialId, "c".repeat(64)],
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_channel_operation($1, 'succeeded', 200, 'remote-product-1', 'listing completed')",
        [listingAttempt.attempt_id],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_listing($1, $2, 'listing.create', true, 'remote-product-1', 'listing completed')",
        [preparedListingId, listingAttempt.attempt_id],
      ),
      true,
    );
    await setClaims(db);
    const updatePreparedListingId = await scalar(
      db,
      "select public.sellerpilot_prepare_product_listing($1, 'coupang', 'listing.update', 'KRW', 26000)",
      [aiProductId],
    );
    assert.equal(updatePreparedListingId, preparedListingId);
    const failedUpdateAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.update', 'listing-ai-product-coupang-update-failure-0001', $2)",
      [coupangCredentialId, "f".repeat(64)],
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_channel_operation($1, 'failed', 422, null, 'one channel failed')",
        [failedUpdateAttempt.attempt_id],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_product_listing($1, $2, 'listing.update', false, null, 'one channel failed')",
        [updatePreparedListingId, failedUpdateAttempt.attempt_id],
      ),
      true,
    );
    await setClaims(db);
    const failedUpdateContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [aiProductId]);
    const failedPublishedListing = failedUpdateContext.listings.find((listing) => listing.id === preparedListingId);
    assert.equal(failedPublishedListing.status, "failed");
    assert.equal(failedPublishedListing.remoteId, "remote-product-1");
    assert.match(failedPublishedListing.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
    const mixedRegistrationActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(20)");
    const mixedRegistrationCard = mixedRegistrationActivity.find((activity) => activity.productId === aiProductId);
    assert.equal(mixedRegistrationCard.status, "blocked");
    assert.notEqual(mixedRegistrationCard.completedAt, null);
    await db.query(
      "update sellerpilot_private.product_listings set status = 'failed', failure_class = 'retryable', last_error = 'second channel failed', updated_at = now() where id = $1",
      [elevenstPreparedListingId],
    );
    const terminalRegistrationActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(20)");
    const terminalRegistrationCard = terminalRegistrationActivity.find((activity) => activity.productId === aiProductId);
    assert.equal(terminalRegistrationCard.status, "failed");
    assert.notEqual(terminalRegistrationCard.completedAt, null);
    await db.query(
      "update sellerpilot_private.product_listings set status = 'paused', failure_class = null, last_error = null, updated_at = now() where id = $1",
      [preparedListingId],
    );
    await db.query(
      "update sellerpilot_private.product_listings set status = 'scope_excluded', failure_class = null, last_error = null, updated_at = now() where id = $1",
      [elevenstPreparedListingId],
    );
    const intentionallyStoppedActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(20)");
    const intentionallyStoppedCard = intentionallyStoppedActivity.find((activity) => activity.productId === aiProductId);
    assert.equal(intentionallyStoppedCard.status, "completed");
    assert.notEqual(intentionallyStoppedCard.completedAt, null);
    assert.deepEqual(
      new Set(intentionallyStoppedCard.channels.map((channel) => channel.status)),
      new Set(["paused", "scope_excluded"]),
    );
    await db.query(
      "update sellerpilot_private.product_listings set status = 'published', failure_class = null, last_error = null, updated_at = now() where id = $1",
      [preparedListingId],
    );
    await db.query(
      "update sellerpilot_private.product_listings set status = 'queued', failure_class = null, last_error = null, updated_at = now() where id = $1",
      [elevenstPreparedListingId],
    );
    await assert.rejects(
      db.query("select public.sellerpilot_seed_demo_operations()"),
      /demo data is disabled/,
    );

    const pushSubscriptionId = await scalar(
      db,
      "select public.sellerpilot_upsert_push_subscription($1, $2, $3, 'Android Migration Test', '테스트 Android')",
      ["https://push.example.test/subscriptions/admin-device", "p".repeat(88), "a".repeat(24)],
    );
    assert.match(pushSubscriptionId, /^[0-9a-f-]{36}$/i);
    const pushSubscription = await scalar(
      db,
      "select public.sellerpilot_get_push_subscription($1)",
      ["https://push.example.test/subscriptions/admin-device"],
    );
    assert.equal(pushSubscription.id, pushSubscriptionId);
    assert.equal(pushSubscription.enabled, true);

    await db.query(
      `insert into sellerpilot_private.commerce_orders (
        owner_id, external_order_id, channel_key, customer_name, product_id, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo
      ) values ($1, 'REAL-ORDER-1', 'qoo10', '실고객', $2, 'AI 생성 테스트 상품', 1, 32000, 'KRW', 32000, 'paid', now(), false)`,
      [ADMIN_ID, aiProductId],
    );
    await db.query(
      `insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, demo
      ) values ($1, 'REAL-TICKET-1', 'qoo10', '실고객', '실제 문의', '배송 상태 확인', 'waiting', 2, now(), false)`,
      [ADMIN_ID],
    );
    const shipmentFailureOrderId = await scalar(
      db,
      "select id from sellerpilot_private.commerce_orders where external_order_id = 'REAL-ORDER-1'",
    );
    await setClaims(db, "service_role");
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_record_order_shipment_failure($1, $2, 'LEX', 'safe shipment failure')",
        [NON_ADMIN_ID, shipmentFailureOrderId],
      ),
      /invalid shipment failure record/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_record_order_shipment_failure($1, $2, 'LEX', 'safe shipment failure without tracking')",
        [ADMIN_ID, shipmentFailureOrderId],
      ),
      true,
    );
    const persistedShipmentFailure = await db.query(
      `select status, shipping_carrier, tracking_number, last_shipment_error
         from sellerpilot_private.commerce_orders
        where id = $1`,
      [shipmentFailureOrderId],
    );
    assert.deepEqual(persistedShipmentFailure.rows[0], {
      status: "paid",
      shipping_carrier: "LEX",
      tracking_number: null,
      last_shipment_error: "safe shipment failure without tracking",
    });
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit where owner_id = $1 and entity_id = $2 and action = 'shipment_failed'",
        [ADMIN_ID, shipmentFailureOrderId],
      ),
      1,
    );

    // Every current-version write claim is resumable only before its durable
    // gateway job exists. Once enqueued, the same attempt is returned as an
    // in-progress duplicate and a changed idempotency key cannot bypass the
    // remote-resource fence.
    await setClaims(db);
    const resumableInventoryClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'inventory.update', 'resource-resume-inventory-0001', $2)",
      [coupangCredentialId, "1".repeat(64)],
    );
    const resumedBeforeEnqueue = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'inventory.update', 'resource-resume-inventory-0001', $2)",
      [coupangCredentialId, "1".repeat(64)],
    );
    assert.equal(resumedBeforeEnqueue.duplicate, false);
    assert.equal(resumedBeforeEnqueue.attempt_id, resumableInventoryClaim.attempt_id);
    await setClaims(db, "service_role");
    const resourceInventoryEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_resource_gateway_job(
        $1, $2, 'coupang', 'inventory.update', '{"arguments":{"remoteId":"SAFE-1","quantity":7}}'::jsonb,
        'listing_mutation', $3, $4, $5
      )`,
      [coupangCredentialId, resumableInventoryClaim.attempt_id, "2".repeat(64), "1".repeat(64), preparedListingId],
    );
    await setClaims(db);
    const duplicateAfterEnqueue = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'inventory.update', 'resource-resume-inventory-0001', $2)",
      [coupangCredentialId, "1".repeat(64)],
    );
    assert.equal(duplicateAfterEnqueue.duplicate, true);
    await setClaims(db, "service_role");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'failed', error_message = 'explicit provider rejection', completed_at = now() where id = $1",
      [resourceInventoryEnqueue.job_id],
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_operation_attempts where id = $1", [resumableInventoryClaim.attempt_id]),
      "failed",
    );

    // A shipment acknowledgement only records the provider acknowledgement;
    // it must never promote a paid order to shipped.
    await setClaims(db);
    const acknowledgeClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'shipment.acknowledge', 'resource-order-ack-0001', $2)",
      [credentialId, "3".repeat(64)],
    );
    await setClaims(db, "service_role");
    const acknowledgeEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_resource_gateway_job(
        $1, $2, 'qoo10', 'shipment.acknowledge', '{"arguments":{"orderNo":"REAL-ORDER-1"}}'::jsonb,
        'order_shipment', $3, $4, null, null, $5, 'LEX', 'TRACK-ACK-1'
      )`,
      [credentialId, acknowledgeClaim.attempt_id, "4".repeat(64), "3".repeat(64), shipmentFailureOrderId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', response_payload = '{"ok":true,"safeMessage":"acknowledged"}'::jsonb,
              completed_at = now()
        where id = $1`,
      [acknowledgeEnqueue.job_id],
    );
    assert.deepEqual(
      (await db.query(
        "select status, shipment_write_status from sellerpilot_private.commerce_orders where id = $1",
        [shipmentFailureOrderId],
      )).rows[0],
      { status: "paid", shipment_write_status: "succeeded" },
    );

    await setClaims(db);
    const tracxCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'tracx', 'production',
        '{"api_key":"tracx-test-key","webhook_secret":"12345678901234567890123456789012"}'::jsonb,
        null, 90, 30, 0
      )`,
    );
    assert.match(tracxCredentialId, /^[0-9a-f-]{36}$/i);
    const tracxClaim = await scalar(
      db,
      "select public.sellerpilot_claim_tracx_operation($1, 'tracking.get', 'tracx-tracking-read-0001', $2)",
      [tracxCredentialId, "e".repeat(64)],
    );
    assert.equal(tracxClaim.duplicate, false);
    const tracxDuplicate = await scalar(
      db,
      "select public.sellerpilot_claim_tracx_operation($1, 'tracking.get', 'tracx-tracking-read-0001', $2)",
      [tracxCredentialId, "e".repeat(64)],
    );
    assert.equal(tracxDuplicate.duplicate, true);
    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    const sharedAdminTracxClaim = await scalar(
      db,
      "select public.sellerpilot_claim_tracx_operation($1, 'shipping.get', 'tracx-shared-admin-read-001', $2)",
      [tracxCredentialId, "f".repeat(64)],
    );
    assert.equal(sharedAdminTracxClaim.duplicate, false);
    await setClaims(db, "service_role");
    const tracxSecret = await scalar(db, "select public.sellerpilot_get_active_credential_secret('tracx', 'production')");
    assert.equal(tracxSecret.secret_payload.api_key, "tracx-test-key");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_tracx_operation($1, true, '0', 'SmartShip read passed')",
        [tracxClaim.attempt_id],
      ),
      true,
    );

    const tracxMutation = await scalar(
      db,
      `select public.sellerpilot_service_claim_tracx_mutation(
        $1, $2, 'orders.cancel', 'tracx-cancel-write-0001', $3, $4
      )`,
      [ADMIN_ID, tracxCredentialId, "5".repeat(64), "6".repeat(64)],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_tracx_mutation($1, $2)",
        [tracxMutation.attempt_id, "5".repeat(64)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_tracx_mutation($1, $2, 'reconciliation_required', 'PROVIDER_OUTCOME_UNKNOWN', 'manual verification required')",
        [tracxMutation.attempt_id, "5".repeat(64)],
      ),
      true,
    );
    const fencedTracxMutation = await scalar(
      db,
      `select public.sellerpilot_service_claim_tracx_mutation(
        $1, $2, 'orders.cancel', 'tracx-cancel-write-0002', $3, $4
      )`,
      [ADMIN_ID, tracxCredentialId, "7".repeat(64), "6".repeat(64)],
    );
    assert.equal(fencedTracxMutation.status, "reconciliation_required");
    assert.equal(fencedTracxMutation.attempt_id, tracxMutation.attempt_id);
    const tracxDeliveryEvent = {
      PackingNo: "PACK-1",
      TrackingNo: "TRACK-1",
      RefOrderNo: "REAL-ORDER-1",
      DeliveryCompanyCode: "0002",
      StatusCode: "D4",
      StatusDesc: "Delivered",
      Date: "2026-08-22 14:00:00+09",
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_tracx_delivery($1, $2::jsonb)",
        [tracxCredentialId, JSON.stringify(tracxDeliveryEvent)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_tracx_delivery($1, $2::jsonb)",
        [tracxCredentialId, JSON.stringify(tracxDeliveryEvent)],
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.tracx_delivery_events where tracking_no = 'TRACK-1'"),
      1,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.commerce_orders where external_order_id = 'REAL-ORDER-1'"),
      "delivered",
    );
    await db.query(
      `delete from sellerpilot_private.push_notification_outbox
        where order_id = (
          select id from sellerpilot_private.commerce_orders
           where owner_id = $1 and external_order_id = 'REAL-ORDER-1'
        ) and event_type = 'shipping'`,
      [ADMIN_ID],
    );
    await setClaims(db);
    await db.query(
      `insert into sellerpilot_private.products (
        id, owner_id, external_code, sku, name, description, status,
        on_hand, reserved, reorder_point, cost_krw, demo
      ) values ($1, $2, 'SHARED-PRODUCT-1', 'SHARED-SKU-1', '다른 관리자 생성 상품',
        '승인된 관리자 전체 공유 검증', 'active', 20, 0, 5, 12000, false)`,
      [SHARED_PRODUCT_ID, SECOND_ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.commerce_orders (
        owner_id, external_order_id, channel_key, customer_name, product_id, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo
      ) values ($1, 'SHARED-ORDER-1', 'qoo10', '공유고객', $2,
        '다른 관리자 생성 상품', 1, 21000, 'KRW', 21000, 'paid', now() + interval '1 second', false)`,
      [SECOND_ADMIN_ID, SHARED_PRODUCT_ID],
    );
    await db.query(
      `insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, demo
      ) values ($1, 'SHARED-TICKET-1', 'qoo10', '공유고객', '공유 문의',
        '다른 관리자가 수집한 문의', 'waiting', 1, now() + interval '1 second', false)`,
      [SECOND_ADMIN_ID],
    );

    await setClaims(db, "service_role");
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_ingest_orders($1, 'qoo10', '[]'::jsonb)", [credentialId]),
      0,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', '[]'::jsonb)", [credentialId]),
      0,
    );
    assert.equal(
      await scalar(db, "select imported_count from sellerpilot_private.channel_sync_state where owner_id = $1 and channel_key = 'qoo10' and data_type = 'orders'", [ADMIN_ID]),
      1,
    );
    assert.equal(
      await scalar(db, "select imported_count from sellerpilot_private.channel_sync_state where owner_id = $1 and channel_key = 'qoo10' and data_type = 'inquiries'", [ADMIN_ID]),
      1,
    );
    await setClaims(db);

    const snapshot = await scalar(db, "select public.sellerpilot_get_operations_snapshot()");
    assert.equal(snapshot.products.length, 2);
    assert.equal(snapshot.orders.length, 2);
    assert.equal(snapshot.tickets.length, 2);
    assert.equal(snapshot.products.every((product) => product.demo === false), true);
    assert.equal(snapshot.orders.every((order) => order.demo === false), true);
    assert.equal(snapshot.tickets.every((ticket) => ticket.demo === false), true);
    assert.equal(snapshot.summary.orderCount, 2);
    assert.equal(snapshot.summary.openTicketCount, 2);
    assert.equal(snapshot.channelMetrics.find((channel) => channel.channelKey === "qoo10").credentialStatus, "active");
    const aiProduct = snapshot.products.find((product) => product.id === aiProductId);
    assert.equal(aiProduct.demo, false);
    assert.equal(aiProduct.status, "low_stock");
    assert.deepEqual(aiProduct.listingChannels, ["C"]);
    assert.equal(aiProduct.aiHeroPath, resultPayload.asset_storage_paths.hero);
    assert.equal(snapshot.products.some((product) => product.id === SHARED_PRODUCT_ID), true);
    const sharedPublishContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [SHARED_PRODUCT_ID]);
    assert.equal(sharedPublishContext.product.id, SHARED_PRODUCT_ID);
    assert.equal(sharedPublishContext.ownerId, SECOND_ADMIN_ID);

    const sharedCategoryAssignmentId = await scalar(
      db,
      `select public.sellerpilot_save_product_category_assignment(
        $1, 'shared-product-category-test', '다른 관리자 생성 상품', 'qoo10', 'production', 'JP',
        '320000001', array['생활','테스트'], true, 1,
        'seller_selected', '[]'::jsonb, '{}'::jsonb, '{"verifiedBy":"test"}'::jsonb, true
      )`,
      [SHARED_PRODUCT_ID],
    );
    assert.match(sharedCategoryAssignmentId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select owner_id from sellerpilot_private.product_category_assignments where id = $1", [sharedCategoryAssignmentId]),
      SECOND_ADMIN_ID,
    );
    const sharedListingId = await scalar(
      db,
      "select public.sellerpilot_prepare_product_listing($1, 'qoo10', 'listing.create', 'JPY', 1800)",
      [SHARED_PRODUCT_ID],
    );
    assert.match(sharedListingId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select owner_id from sellerpilot_private.product_listings where id = $1", [sharedListingId]),
      SECOND_ADMIN_ID,
    );

    const sharedOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'shared-operation-key-0001', $2)",
      [credentialId, "d".repeat(64)],
    );
    assert.equal(sharedOperation.duplicate, false);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [SECOND_ADMIN_ID]);
    const duplicateSharedOperation = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'orders.list', 'shared-operation-key-0001', $2)",
      [credentialId, "d".repeat(64)],
    );
    assert.equal(duplicateSharedOperation.duplicate, true);
    assert.equal(duplicateSharedOperation.attempt_id, sharedOperation.attempt_id);
    await setClaims(db);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_research', $2::jsonb)",
      [RESEARCH_JOB_ID, JSON.stringify({ research_input: "https://example.test/product/1 또는 흰색 도자기 머그컵 설명" })],
    );
    assert.equal(await scalar(db, "select kind from sellerpilot_private.ai_cli_jobs where id = $1", [RESEARCH_JOB_ID]), "product_research");

    const firstOrderId = snapshot.orders.find((order) => order.externalOrderId === "SHARED-ORDER-1").id;
    const firstTicketId = snapshot.tickets.find((ticket) => ticket.externalTicketId === "SHARED-TICKET-1").id;
    assert.equal(
      await scalar(db, "select public.sellerpilot_update_order_status($1, 'ready_to_ship')", [firstOrderId]),
      true,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.push_notification_outbox where event_key = $1", [`order:${firstOrderId}:status:ready_to_ship`]),
      1,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.push_notification_deliveries where subscription_id = $1", [pushSubscriptionId]),
      1,
    );
    await setClaims(db, "service_role");
    const claimedPush = await db.query("select * from public.sellerpilot_service_claim_push_deliveries(10)");
    assert.equal(claimedPush.rows.length, 1);
    assert.equal(claimedPush.rows.every((delivery) => delivery.endpoint === "https://push.example.test/subscriptions/admin-device"), true);
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_finish_push_delivery($1, 'sent', null)", [claimedPush.rows[0].delivery_id]),
      true,
    );
    await setClaims(db);
    assert.equal(
      await scalar(db, "select public.sellerpilot_update_ticket($1, 'resolved', '답변 저장 검증')", [firstTicketId]),
      true,
    );

    const lazadaReplyTicketId = await scalar(
      db,
      `insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, demo
      ) values ($1, 'lazada-im:reply-fence-session', 'lazada', 'Lazada customer',
        'Reply fence', 'Please answer', 'waiting', 2, now(), false)
      returning id`,
      [ADMIN_ID],
    );
    const replyFingerprint = await scalar(
      db,
      "select encode(extensions.digest(trim('확인했습니다'), 'sha256'), 'hex')",
    );
    await setClaims(db, "service_role");
    const replyClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_lazada_reply($1, $2, $3)",
      [ADMIN_ID, lazadaReplyTicketId, replyFingerprint],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_begin_lazada_reply($1, $2)", [replyClaim.attempt_id, replyFingerprint]),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_lazada_reply($1, $2, 'reconciliation_required', null, 'provider outcome unknown')",
        [replyClaim.attempt_id, replyFingerprint],
      ),
      true,
    );
    const changedReplyFingerprint = await scalar(
      db,
      "select encode(extensions.digest(trim('다른 답변'), 'sha256'), 'hex')",
    );
    const fencedReply = await scalar(
      db,
      "select public.sellerpilot_service_claim_lazada_reply($1, $2, $3)",
      [ADMIN_ID, lazadaReplyTicketId, changedReplyFingerprint],
    );
    assert.equal(fencedReply.status, "reconciliation_required");
    assert.equal(fencedReply.attempt_id, replyClaim.attempt_id);
    assert.deepEqual(
      (await db.query(
        "select status, reply_delivery_status from sellerpilot_private.support_tickets where id = $1",
        [lazadaReplyTicketId],
      )).rows[0],
      { status: "waiting", reply_delivery_status: "reconciliation_required" },
    );
    const acceptedReplyTicketId = await scalar(
      db,
      `insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, demo
      ) values ($1, 'lazada-im:accepted-reply-session', 'lazada', 'Lazada customer 2',
        'Accepted reply', 'Please answer too', 'waiting', 2, now(), false)
      returning id`,
      [ADMIN_ID],
    );
    const acceptedClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_lazada_reply($1, $2, $3)",
      [ADMIN_ID, acceptedReplyTicketId, replyFingerprint],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_begin_lazada_reply($1, $2)", [acceptedClaim.attempt_id, replyFingerprint]),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_lazada_reply($1, $2, 'succeeded', '확인했습니다', 'reply accepted')",
        [acceptedClaim.attempt_id, replyFingerprint],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        "select status, reply_draft, reply_delivery_status from sellerpilot_private.support_tickets where id = $1",
        [acceptedReplyTicketId],
      )).rows[0],
      { status: "resolved", reply_draft: "확인했습니다", reply_delivery_status: "succeeded" },
    );

    const marginScenarioId = await scalar(
        db,
        "select public.sellerpilot_save_margin_scenario('마진 검증', 'qoo10', '{\"cost\":10000}'::jsonb, '{\"margin\":22.5}'::jsonb)",
    );
    assert.match(marginScenarioId, /^[0-9a-f-]{36}$/i);
    const marginScenarios = await scalar(db, "select public.sellerpilot_list_margin_scenarios(5)");
    assert.equal(marginScenarios.length, 1);
    assert.equal(marginScenarios[0].channelKey, "qoo10");
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [marginScenarioId]), true);
    const elevenstMarginScenarioId = await scalar(
      db,
      "select public.sellerpilot_save_margin_scenario('11번가 마진 검증', 'elevenst', '{\"cost\":12000}'::jsonb, '{\"margin\":20}'::jsonb)",
    );
    assert.match(elevenstMarginScenarioId, /^[0-9a-f-]{36}$/i);
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [elevenstMarginScenarioId]), true);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [CANCEL_JOB_ID, JSON.stringify(requestPayload)],
    );
    assert.equal(await scalar(db, "select public.sellerpilot_cancel_ai_job($1)", [CANCEL_JOB_ID]), true);
    assert.equal(await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [CANCEL_JOB_ID]), true);
    const jobs = await db.query("select * from public.sellerpilot_list_ai_jobs(10)");
    assert.equal(jobs.rows.length, 5);
    assert.equal(jobs.rows.some((job) => job.id === DUPLICATE_SKU_JOB_ID && job.status === "succeeded"), true);
    assert.equal(jobs.rows.some((job) => job.status === "succeeded" && job.has_hero), true);
    assert.equal(jobs.rows.some((job) => job.kind === "product_research"), true);
    assert.equal(jobs.rows.some((job) => job.kind === "product_asset_regeneration"), true);
  } finally {
    await db.close();
  }
});

test("AI claim nonce rollout fails closed for live work and recovers expired leases", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const nonceMigrationName = "20260825103015_compensate_unprepared_ai_worker_claims.sql";
    const earlierMigrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql") && name < nonceMigrationName)
      .sort();
    for (const name of earlierMigrationNames) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }

    await db.query("insert into auth.users (id, email) values ($1, 'ai-rollout@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'AI Rollout Admin')",
      [ADMIN_ID],
    );
    const workerTokenId = await scalar(
      db,
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, expires_at, created_by
       ) values ('AI rollout worker', $1, 'AAAAAAAAAAAA', 'active', now() + interval '1 day', $2)
       returning id`,
      [TOKEN_HASH, ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, attempt_count, worker_token_id,
         lease_expires_at, created_by, started_at
       ) values ($1, 'product_studio', 'running', '{}'::jsonb, 1, $2,
                 now() + interval '15 minutes', $3, now())`,
      [STALE_AI_JOB_ID, workerTokenId, ADMIN_ID],
    );

    const nonceMigration = await readFile(new URL(nonceMigrationName, migrationUrl), "utf8");
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(nonceMigration)),
      /live AI jobs must drain before claim nonce rollout/,
    );
    await db.exec("rollback");
    assert.equal(
      await scalar(
        db,
        `select count(*) from information_schema.columns
          where table_schema = 'sellerpilot_private'
            and table_name = 'ai_cli_jobs'
            and column_name = 'claim_token'`,
      ),
      0,
    );

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [STALE_AI_JOB_ID],
    );
    await db.exec(withoutUnavailableExtensions(nonceMigration));
    assert.deepEqual(
      (await db.query(
        `select status,
                worker_token_id is null as worker_released,
                claim_token is null as claim_released,
                lease_expires_at is null as lease_released
           from sellerpilot_private.ai_cli_jobs
          where id = $1`,
        [STALE_AI_JOB_ID],
      )).rows,
      [{ status: "queued", worker_released: true, claim_released: true, lease_released: true }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from pg_constraint
          where conname = 'ai_cli_jobs_running_claim_token_check'
            and conrelid = 'sellerpilot_private.ai_cli_jobs'::regclass`,
      ),
      1,
    );
  } finally {
    await db.close();
  }
});

test("gateway credential serialization rollout fails closed for live work and repairs only expired leases", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const preparationMigrationName = "20260825104500_prepare_gateway_credential_refresh.sql";
    const earlierMigrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql") && name < preparationMigrationName)
      .sort();
    for (const name of earlierMigrationNames) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }

    await db.query("insert into auth.users (id, email) values ($1, 'rollout-admin@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Rollout Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('rollout worker', $1, 'AAAAAAAAAAAA', now() + interval '30 days')",
      [TOKEN_HASH],
    );
    const oldCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production',
        '{"partner_id":"2031489","partner_key":"rollout-partner-key-long","shop_id":"123456789","access_token":"rollout-old-access","refresh_token":"rollout-old-refresh"}'::jsonb,
        now() + interval '365 days', 90, 30, 0
      )`,
    );
    const attempts = [];
    for (let index = 0; index < 3; index += 1) {
      attempts.push(await scalar(
        db,
        "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'categories.list', $2, $3)",
        [oldCredentialId, `rollout-operation-${index}`, String(index + 1).repeat(64)],
      ));
    }

    await setClaims(db, "service_role");
    const jobIds = [];
    for (const [index, attempt] of attempts.entries()) {
      jobIds.push(await scalar(
        db,
        "select public.sellerpilot_enqueue_channel_gateway_job($1, $2, 'shopee', 'categories.list', $3::jsonb)",
        [oldCredentialId, attempt.attempt_id, JSON.stringify({ arguments: { rollout: index } })],
      ));
    }
    const firstLegacyClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'rollout/legacy-a')",
      [TOKEN_HASH],
    );
    const secondLegacyClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'rollout/legacy-b')",
      [TOKEN_HASH],
    );
    assert.notEqual(firstLegacyClaim.id, secondLegacyClaim.id);
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.channel_gateway_jobs where credential_id = $1 and status = 'running'",
        [oldCredentialId],
      ),
      2,
    );

    const preparationMigration = await readFile(new URL(preparationMigrationName, migrationUrl), "utf8");
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(preparationMigration)),
      /live gateway jobs must drain before claim nonce rollout/,
    );
    await db.exec("rollback");
    assert.deepEqual(
      (await db.query(
        `select count(*)::integer as total,
                count(*) filter (where status = 'running')::integer as running,
                count(*) filter (where status = 'queued')::integer as queued
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[]) and credential_id = $2`,
        [jobIds, oldCredentialId],
      )).rows,
      [{ total: 3, running: 2, queued: 1 }],
    );

    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [firstLegacyClaim.id],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(preparationMigration)),
      /live gateway jobs must drain before claim nonce rollout/,
    );
    await db.exec("rollback");
    assert.deepEqual(
      (await db.query(
        `select count(*)::integer as total,
                count(*) filter (where status = 'running')::integer as running,
                count(*) filter (where status = 'queued')::integer as queued,
                count(*) filter (where status = 'queued' and worker_token_id is null)::integer as released
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[]) and credential_id = $2`,
        [jobIds, oldCredentialId],
      )).rows,
      [{ total: 3, running: 2, queued: 1, released: 1 }],
    );

    const activeCredentialId = await scalar(
      db,
      `select public.sellerpilot_service_refresh_shopee(
        $1,
        '{"partner_id":"2031489","partner_key":"rollout-partner-key-long","shop_id":"123456789","access_token":"rollout-new-access","refresh_token":"rollout-new-refresh"}'::jsonb,
        '2099-01-01T00:00:00Z'::timestamptz
      )`,
      [oldCredentialId],
    );
    assert.notEqual(activeCredentialId, oldCredentialId);
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.channel_gateway_jobs where credential_id = $1 and status in ('queued', 'running')",
        [oldCredentialId],
      ),
      3,
    );

    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [secondLegacyClaim.id],
    );
    await db.exec(withoutUnavailableExtensions(preparationMigration));
    assert.deepEqual(
      (await db.query(
        `select count(*)::integer as total,
                count(*) filter (where status = 'running')::integer as running,
                count(*) filter (where status = 'queued')::integer as queued,
                count(*) filter (where status = 'queued' and worker_token_id is null)::integer as released
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[]) and credential_id = $2`,
        [jobIds, activeCredentialId],
      )).rows,
      [{ total: 3, running: 0, queued: 3, released: 3 }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)
           from sellerpilot_private.channel_gateway_jobs j
           join sellerpilot_private.channel_operation_attempts a on a.id = j.attempt_id
          where j.id = any($1::uuid[])
            and j.credential_id = $2
            and a.credential_id = $3`,
        [jobIds, activeCredentialId, oldCredentialId],
      ),
      3,
    );
    const reclaimed = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'rollout/reclaim')",
      [TOKEN_HASH],
    );
    assert.equal(jobIds.includes(reclaimed.id), true);
    assert.equal(reclaimed.credential_id, activeCredentialId);
    assert.equal(reclaimed.credential.access_token, "rollout-new-access");
    assert.deepEqual(
      (await db.query(
        `select count(*)::integer as total,
                count(*) filter (where status = 'running')::integer as running,
                count(*) filter (where status = 'queued')::integer as queued
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[]) and credential_id = $2`,
        [jobIds, activeCredentialId],
      )).rows,
      [{ total: 3, running: 1, queued: 2 }],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'rollout/still-blocked')", [TOKEN_HASH]),
      null,
    );
    const queuedJobId = await scalar(
      db,
      "select id from sellerpilot_private.channel_gateway_jobs where id = any($1::uuid[]) and status = 'queued' limit 1",
      [jobIds],
    );
    await assert.rejects(
      db.query("update sellerpilot_private.channel_gateway_jobs set status = 'running', claim_token = gen_random_uuid() where id = $1", [queuedJobId]),
      /duplicate key|unique constraint/i,
    );
  } finally {
    await db.close();
  }
});

test("Kakao deliveries use atomic ownership leases and never auto-reclaim a send that may have happened", async () => {
  const db = new PGlite();
  const deliveryOwnerIds = [
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
    ADMIN_ID,
    "99999999-9999-4999-8999-999999999999",
  ];
  const deliveryIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  const legacyDeliveryIds = [
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
  ];
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const lifecycleMigrationName = "20260825104600_kakao_notification_delivery_lifecycle.sql";
    const lifecycleMigrationIndex = migrationNames.indexOf(lifecycleMigrationName);
    assert.ok(lifecycleMigrationIndex >= 0);
    for (const name of migrationNames.slice(0, lifecycleMigrationIndex)) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }

    await db.query("insert into auth.users (id, email) values ($1, 'kakao-lifecycle@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Kakao Lifecycle Admin')",
      [ADMIN_ID],
    );
    for (const [index, ownerId] of deliveryOwnerIds.entries()) {
      if (ownerId === ADMIN_ID) continue;
      await db.query(
        "insert into auth.users (id, email) values ($1, $2)",
        [ownerId, `kakao-lifecycle-${index}@example.test`],
      );
      await db.query(
        "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, $2)",
        [ownerId, `Kakao Lifecycle Admin ${index}`],
      );
    }
    await setClaims(db, "service_role");
    const integrationId = await scalar(
      db,
      `select public.sellerpilot_service_store_kakao_integration(
        $1, $2::jsonb, 'kakao-lifecycle-user', 'Lifecycle Test', now() + interval '1 day'
      )`,
      [ADMIN_ID, JSON.stringify({ access_token: "test-access-token", refresh_token: "test-refresh-token" })],
    );
    assert.match(integrationId, /^[0-9a-f-]{36}$/i);
    for (const [index, ownerId] of deliveryOwnerIds.entries()) {
      if (ownerId === ADMIN_ID) continue;
      assert.match(
        await scalar(
          db,
          `select public.sellerpilot_service_store_kakao_integration(
            $1, $2::jsonb, $3, $4, now() + interval '1 day'
          )`,
          [
            ownerId,
            JSON.stringify({ access_token: `test-access-token-${index}`, refresh_token: `test-refresh-token-${index}` }),
            `kakao-lifecycle-user-${index}`,
            `Lifecycle Test ${index}`,
          ],
        ),
        /^[0-9a-f-]{36}$/i,
      );
    }
    for (const [index, id] of legacyDeliveryIds.entries()) {
      await db.query(
        `insert into sellerpilot_private.kakao_notification_deliveries (
          id, owner_id, event_key, event_type, title, body, link_path
        ) values ($1, $2, $3, 'test', 'Legacy lifecycle', 'Rollout bridge test', '/')`,
        [id, ADMIN_ID, `legacy-lifecycle:${index}`],
      );
    }

    for (const name of migrationNames.slice(lifecycleMigrationIndex)) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }
    assert.equal(
      await scalar(
        db,
        `select count(*)
           from sellerpilot_private.kakao_notification_deliveries
          where id = any($1::uuid[])
            and legacy_completion_eligible_until > now()
            and legacy_completion_eligible_until <= now() + interval '90 seconds'`,
        [legacyDeliveryIds],
      ),
      2,
    );
    assert.equal((await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10)")).rows.length, 0);
    assert.equal((await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 60)")).rows.length, 0);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, true, null)",
        [legacyDeliveryIds[0]],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, true, null)",
        [legacyDeliveryIds[0]],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, false, 'CONFLICT')",
        [legacyDeliveryIds[0]],
      ),
      false,
    );
    await db.query(
      "update sellerpilot_private.kakao_notification_deliveries set legacy_completion_eligible_until = now() - interval '1 second' where id = $1",
      [legacyDeliveryIds[1]],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, false, 'LATE_LEGACY_COMPLETION')",
        [legacyDeliveryIds[1]],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_sweep_stale_kakao_notifications()",
      ),
      1,
    );
    assert.equal((await db.query(
      "select * from public.sellerpilot_service_claim_kakao_notifications(1, 60)",
    )).rows.length, 0);
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.kakao_notification_deliveries where id = $1",
        [legacyDeliveryIds[1]],
      ),
      "reconciliation_required",
    );
    assert.equal(await scalar(db, "select public.sellerpilot_service_sweep_stale_kakao_notifications()"), 0);
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_service_claim_kakao_notifications(integer)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_service_claim_kakao_notifications(integer)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_service_complete_kakao_notification(uuid,boolean,text)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_service_complete_kakao_notification(uuid,boolean,text)', 'EXECUTE')",
      ),
      true,
    );

    for (const [index, id] of deliveryIds.entries()) {
      await db.query(
        `insert into sellerpilot_private.kakao_notification_deliveries (
          id, owner_id, event_key, event_type, title, body, link_path
        ) values ($1, $2, $3, 'test', 'Lifecycle', 'Atomic claim test', '/')`,
        [id, deliveryOwnerIds[index], `lifecycle:${index}`],
      );
    }
    assert.equal((await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10)")).rows.length, 0);

    const claimSql = "select * from public.sellerpilot_service_claim_kakao_notifications(2, 60)";
    const [firstClaimBatch, secondClaimBatch] = await Promise.all([
      db.query(claimSql),
      db.query(claimSql),
    ]);
    const claimed = [...firstClaimBatch.rows, ...secondClaimBatch.rows];
    assert.equal(firstClaimBatch.rows.length, 2);
    assert.equal(secondClaimBatch.rows.length, 2);
    assert.equal(claimed.length, 4);
    assert.equal(new Set(claimed.map((row) => row.id)).size, 4);
    assert.equal(claimed.every((row) => /^[0-9a-f-]{36}$/i.test(row.claim_token)), true);
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, count(*)::integer as deliveries
           from sellerpilot_private.kakao_notification_deliveries
          where id = any($1::uuid[])
          group by status, attempt_count`,
        [deliveryIds],
      )).rows,
      [{ status: "preparing", attempt_count: 1, deliveries: 4 }],
    );

    const [sentDelivery, exhaustedDelivery, reclaimedDelivery, uncertainDelivery] = claimed;
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [sentDelivery.id, "99999999-9999-4999-8999-999999999999"],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [sentDelivery.id, sentDelivery.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [sentDelivery.id, sentDelivery.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'sent', null)",
        [sentDelivery.id, sentDelivery.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'sent', null)",
        [sentDelivery.id, sentDelivery.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'reconciliation_required', 'CONFLICT')",
        [sentDelivery.id, sentDelivery.claim_token],
      ),
      false,
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, sent_at is not null as sent_recorded
           from sellerpilot_private.kakao_notification_deliveries where id = $1`,
        [sentDelivery.id],
      )).rows,
      [{ status: "sent", attempt_count: 1, sent_recorded: true }],
    );

    let exhaustedToken = exhaustedDelivery.claim_token;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assert.equal(
        await scalar(
          db,
          "select public.sellerpilot_service_release_kakao_notification_claim($1, $2, 'KAKAO_REFRESH_FAILED', 15)",
          [exhaustedDelivery.id, exhaustedToken],
        ),
        true,
      );
      assert.equal(
        await scalar(
          db,
          "select public.sellerpilot_service_release_kakao_notification_claim($1, $2, 'KAKAO_REFRESH_FAILED', 15)",
          [exhaustedDelivery.id, exhaustedToken],
        ),
        true,
      );
      if (attempt < 3) {
        await db.query(
          "update sellerpilot_private.kakao_notification_deliveries set available_at = now() - interval '1 second' where id = $1",
          [exhaustedDelivery.id],
        );
        const retriedClaim = (await db.query(
          "select * from public.sellerpilot_service_claim_kakao_notifications(1, 60)",
        )).rows[0];
        assert.equal(retriedClaim.id, exhaustedDelivery.id);
        assert.notEqual(retriedClaim.claim_token, exhaustedToken);
        exhaustedToken = retriedClaim.claim_token;
      }
    }
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, completed_at is not null as completed
           from sellerpilot_private.kakao_notification_deliveries where id = $1`,
        [exhaustedDelivery.id],
      )).rows,
      [{ status: "failed", attempt_count: 3, completed: true }],
    );
    assert.equal((await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(1, 60)")).rows.length, 0);

    await db.query(
      "update sellerpilot_private.kakao_notification_deliveries set lease_expires_at = now() - interval '1 second' where id = $1",
      [reclaimedDelivery.id],
    );
    const reclaimed = (await db.query(
      "select * from public.sellerpilot_service_claim_kakao_notifications(1, 60)",
    )).rows[0];
    assert.equal(reclaimed.id, reclaimedDelivery.id);
    assert.notEqual(reclaimed.claim_token, reclaimedDelivery.claim_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [reclaimed.id, reclaimedDelivery.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [reclaimed.id, reclaimed.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'reconciliation_required', 'KAKAO_DELIVERY_OUTCOME_UNKNOWN')",
        [reclaimed.id, reclaimed.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'reconciliation_required', 'KAKAO_DELIVERY_OUTCOME_UNKNOWN')",
        [reclaimed.id, reclaimed.claim_token],
      ),
      true,
    );

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [uncertainDelivery.id, uncertainDelivery.claim_token],
      ),
      true,
    );
    assert.equal((await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 60)")).rows.length, 0);
    await db.query(
      "update sellerpilot_private.kakao_notification_deliveries set lease_expires_at = now() - interval '1 second' where id = $1",
      [uncertainDelivery.id],
    );
    assert.equal(await scalar(db, "select public.sellerpilot_service_sweep_stale_kakao_notifications()"), 1);
    assert.equal(await scalar(db, "select public.sellerpilot_service_sweep_stale_kakao_notifications()"), 0);
    assert.equal((await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 60)")).rows.length, 0);
    assert.deepEqual(
      (await db.query(
        `select id::text, status
           from sellerpilot_private.kakao_notification_deliveries
          where id in ($1, $2)
          order by id`,
        [reclaimed.id, uncertainDelivery.id],
      )).rows,
      [
        { id: reclaimed.id, status: "reconciliation_required" },
        { id: uncertainDelivery.id, status: "reconciliation_required" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    await setClaims(db);
    const notificationSettings = await scalar(db, "select public.sellerpilot_get_notification_settings()");
    assert.equal(notificationSettings.deliveryHealth.reconciliationRequired, 2);
    assert.equal(notificationSettings.deliveryHealth.sending, 0);
    await setClaims(db, "service_role");

    const claimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_service_claim_kakao_notifications(integer,integer)'::regprocedure)",
    );
    assert.match(claimDefinition, /FOR UPDATE OF d SKIP LOCKED/i);
    assert.doesNotMatch(claimDefinition, /DEFAULT/i);
    assert.equal(
      await scalar(
        db,
        "select to_regprocedure('public.sellerpilot_service_claim_kakao_notifications(integer)') is not null",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select to_regprocedure('public.sellerpilot_service_complete_kakao_notification(uuid,boolean,text)') is not null",
      ),
      true,
    );
  } finally {
    await db.close();
  }
});

test("OAuth grants are Vault-backed, exact-replayable, and scrubbed after terminal completion", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }

    await db.query("insert into auth.users (id, email) values ($1, 'oauth-admin@example.test')", [ADMIN_ID]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'OAuth Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('oauth worker', $1, 'AAAAAAAAAAAA', now() + interval '30 days')",
      [TOKEN_HASH],
    );
    const sourceCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'ebay', 'production',
        '{"client_id":"oauth-client","client_secret":"oauth-secret","ru_name":"oauth-redirect","access_token":"old-access-token","refresh_token":"old-refresh-token"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const sandboxCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'ebay', 'sandbox',
        '{"client_id":"sandbox-client","client_secret":"sandbox-secret","ru_name":"sandbox-redirect","access_token":"sandbox-access-token","refresh_token":"sandbox-refresh-token"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const lazadaCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'lazada', 'production',
        '{"app_key":"test-app","app_secret":"test-secret","access_token":"lazada-access-token","refresh_token":"lazada-refresh-token"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );

    await setClaims(db, "service_role");
    const authorizationCode = "test-one-time-authorization-code";
    const oauthJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'ebay', 'oauth.exchange',
        jsonb_build_object('code', $2::text, 'callbackAttempt', 1)
      )`,
      [sourceCredentialId, authorizationCode],
    );
    assert.deepEqual(
      (await db.query(
        `select request_payload ? 'code' as plaintext_code_stored,
                request_payload->>'vaultBacked' as vault_backed,
                oauth_request_vault_id is not null as vault_reference,
                oauth_request_fingerprint ~ '^[a-f0-9]{64}$' as fingerprinted,
                oauth_source_credential_id::text as source_credential_id
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [oauthJobId],
      )).rows,
      [{
        plaintext_code_stored: false,
        vault_backed: "true",
        vault_reference: true,
        fingerprinted: true,
        source_credential_id: sourceCredentialId,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from vault.secrets s
          join sellerpilot_private.channel_gateway_jobs j on j.oauth_request_vault_id = s.id
         where j.id = $1 and (s.secret::jsonb)->>'code' = $2::text`,
        [oauthJobId, authorizationCode],
      ),
      1,
    );

    // Non-secret callback metadata may vary on an HTTP replay; the immutable
    // source credential + authorization code still identifies one grant.
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_enqueue_channel_gateway_job(
          $1, null, 'ebay', 'oauth.exchange',
          jsonb_build_object('code', $2::text, 'callbackAttempt', 2)
        )`,
        [sourceCredentialId, authorizationCode],
      ),
      oauthJobId,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_enqueue_channel_gateway_job(
          $1, null, 'ebay', 'oauth.exchange', '{"code":"different-unresolved-code"}'::jsonb
        )`,
        [sourceCredentialId],
      ),
      /unresolved OAuth exchange already exists/,
    );

    const claim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-vault')",
      [TOKEN_HASH],
    );
    assert.equal(claim.id, oauthJobId);
    assert.equal(claim.request.code, authorizationCode);
    assert.equal(
      await scalar(
        db,
        "select request_payload ? 'code' from sellerpilot_private.channel_gateway_jobs where id = $1",
        [oauthJobId],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
        [TOKEN_HASH, oauthJobId, claim.claim_token],
      ),
      true,
    );
    const prepared = await scalar(
      db,
      `select public.sellerpilot_service_prepare_gateway_credential_refresh(
        $1, $2, $3,
        '{"client_id":"oauth-client","client_secret":"oauth-secret","ru_name":"oauth-redirect","access_token":"new-access-token","refresh_token":"new-refresh-token"}'::jsonb,
        '2099-01-01T00:00:00.000Z'::timestamptz,
        false,
        true
      )`,
      [TOKEN_HASH, oauthJobId, claim.claim_token],
    );
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.oauth_complete, true);
    assert.notEqual(prepared.credential_id, sourceCredentialId);
    assert.equal(await scalar(
      db,
      "select oauth_exchange_completed from sellerpilot_private.channel_gateway_jobs where id = $1",
      [oauthJobId],
    ), true);
    // Simulate the process disappearing after the full credential stage but
    // before the terminal completion HTTP response. The next claim sweep must
    // recover success from the durable marker, never exchange the code again.
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [oauthJobId],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-terminal-recovery')", [TOKEN_HASH]),
      null,
    );
    assert.deepEqual(
      (await db.query(
        `select status,
                oauth_request_vault_id is null as grant_scrubbed,
                request_payload ? 'code' as plaintext_code_stored,
                response_payload ? 'credentialPayload' as credential_payload_stored
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [oauthJobId],
      )).rows,
      [{
        status: "succeeded",
        grant_scrubbed: true,
        plaintext_code_stored: false,
        credential_payload_stored: false,
      }],
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where secret::jsonb->>'code' = $1", [authorizationCode]),
      0,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_enqueue_channel_gateway_job(
          $1, null, 'ebay', 'oauth.exchange', jsonb_build_object('code', $2::text)
        )`,
        [sourceCredentialId, authorizationCode],
      ),
      oauthJobId,
    );

    // Losing the provider response after the pre-fetch uncertainty marker is
    // never auto-retried. Keep this case on sandbox so it cannot mask the
    // independent production partial-stage fence below.
    const inFlightJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'ebay', 'oauth.exchange', '{"code":"response-lost-code"}'::jsonb
      )`,
      [sandboxCredentialId],
    );
    const inFlightClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-response-lost')",
      [TOKEN_HASH],
    );
    assert.equal(inFlightClaim.id, inFlightJobId);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
      [TOKEN_HASH, inFlightJobId, inFlightClaim.claim_token],
    ), true);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [inFlightJobId],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-response-lost-sweep')", [TOKEN_HASH]),
      null,
    );
    assert.deepEqual((await db.query(
      `select status, credential_refresh_in_flight,
              oauth_request_vault_id is null as grant_scrubbed
         from sellerpilot_private.channel_gateway_jobs where id = $1`,
      [inFlightJobId],
    )).rows, [{ status: "reconciliation_required", credential_refresh_in_flight: true, grant_scrubbed: true }]);

    const partialJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'ebay', 'oauth.exchange', '{"code":"partial-stage-code"}'::jsonb
      )`,
      [prepared.credential_id],
    );
    const partialClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-partial')",
      [TOKEN_HASH],
    );
    assert.equal(partialClaim.id, partialJobId);
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
      [TOKEN_HASH, partialJobId, partialClaim.claim_token],
    ), true);
    const partialPrepared = await scalar(
      db,
      `select public.sellerpilot_service_prepare_gateway_credential_refresh(
        $1, $2, $3,
        '{"client_id":"oauth-client","client_secret":"oauth-secret","ru_name":"oauth-redirect","access_token":"partial-access-token","refresh_token":"partial-refresh-token"}'::jsonb,
        '2099-01-01T00:00:00.000Z'::timestamptz,
        false,
        false
      )`,
      [TOKEN_HASH, partialJobId, partialClaim.claim_token],
    );
    assert.equal(partialPrepared.oauth_complete, false);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [partialJobId],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-partial-sweep')", [TOKEN_HASH]),
      null,
    );
    assert.deepEqual((await db.query(
      `select status, oauth_exchange_completed,
              oauth_request_vault_id is null as grant_scrubbed
         from sellerpilot_private.channel_gateway_jobs where id = $1`,
      [partialJobId],
    )).rows, [{ status: "reconciliation_required", oauth_exchange_completed: false, grant_scrubbed: true }]);

    // An unresolved partial production exchange blocks later production work
    // for the same logical channel even though credential rotation changed its
    // UUID. Unrelated channel/environment work remains independently claimable.
    const blockedEbayJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'ebay', 'diagnostic.test', '{}'::jsonb
      )`,
      [partialPrepared.credential_id],
    );
    const unrelatedLazadaJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'diagnostic.test', '{}'::jsonb
      )`,
      [lazadaCredentialId],
    );
    const unrelatedClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/oauth-blocker')",
      [TOKEN_HASH],
    );
    assert.equal(unrelatedClaim.id, unrelatedLazadaJobId);
    assert.deepEqual((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
      [blockedEbayJobId],
    )).rows, [{ status: "queued" }]);
  } finally {
    await db.close();
  }
});
