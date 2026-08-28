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
const DEDUPED_REGEN_REQUEST_ID = "c4f3296b-42ec-457d-b1cf-b5200662f354";
const CROSS_OWNER_REGEN_JOB_ID = "9c392f1f-f0de-45bb-a127-42605bc7422b";
const OWNER_FENCE_REGEN_JOB_ID = "80672f50-4424-44ee-9921-60e52d21ef8b";
const EXPANDED_REGEN_JOB_ID = "d48c945e-4e48-4d35-b783-a8a831de4ac0";
const DUPLICATE_SKU_JOB_ID = "6c7f9651-f0dd-48f7-8fe4-51335c404aef";
const CLAIM_PREPARATION_JOB_ID = "0da0295f-d85b-4d5e-a938-853b49f5ea32";
const STALE_AI_JOB_ID = "7c64df91-bd91-49bf-a141-1485bcbead3d";
const PRUNE_JOB_ID = "fb641eaf-7de3-4958-ad08-6d064a99fb59";
const UNSAFE_PRUNE_JOB_ID = "6a4d7635-cb87-4d24-ae93-f5cd8ee9c855";
const PRODUCT_REVISION_JOB_ID = "3743031d-f49f-4cac-a44a-28e997f1dfc4";
const NEXT_PRODUCT_REVISION_JOB_ID = "6bf1f902-3298-4c9c-ab55-9670b838706d";
const STALE_PRODUCT_REVISION_JOB_ID = "3a7780db-a4cb-46d6-a74a-5d71388e6838";
const ABANDONED_PRODUCT_REVISION_JOB_ID = "231326b1-884d-4757-bcae-2a50ce559839";
const PRIVATE_RESEARCH_RETRY_JOB_ID = "2b90a2d7-3754-4b65-89c6-c386967a90cc";
const RETRY_CLOCK_JOB_ID = "55261a19-9394-4d0c-a8b5-8d6d53dc88f0";
const SHARED_PRODUCT_ID = "4a346497-84c8-4ccd-bf14-8f06f990a2f7";
const READINESS_FAILED_JOB_ID = "617d6da4-d646-4625-ad8a-0c18eab7f3c6";
const TOKEN_HASH = "a".repeat(64);
const SECOND_WORKER_TOKEN_HASH = "e".repeat(64);
const AI_SCOPED_TOKEN_HASH = "b".repeat(64);
const GATEWAY_SCOPED_TOKEN_HASH = "c".repeat(64);
const SCHEDULER_SCOPED_TOKEN_HASH = "d".repeat(64);
const LEGACY_CROSS_TOKEN_HASH = "f".repeat(64);
const PENDING_AI_TOKEN_HASH = "1".repeat(64);
const PENDING_GATEWAY_TOKEN_HASH = "2".repeat(64);
const PENDING_SCHEDULER_TOKEN_HASH = "3".repeat(64);
const LEGACY_SCOPE_RETIREMENT_MIGRATION = "20260828150000_remove_legacy_combined_worker_scope.sql";

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
create or replace function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null
)
returns void
language sql
as $$
  update vault.secrets
     set secret = coalesce(new_secret, secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description)
   where id = secret_id
$$;

create schema if not exists net;
create table if not exists net.http_request_queue (
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
);
create table if not exists net._http_response (
  id bigint primary key,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer default 1000
)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into net.http_request_queue (
    url, body, params, headers, timeout_milliseconds
  ) values (
    $1, $2, $3, $4, $5
  ) returning id into v_id;
  return v_id;
end;
$$;

create schema if not exists cron;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create table if not exists cron.job_run_details (
  runid bigint generated always as identity primary key,
  jobid bigint not null,
  end_time timestamptz
);
create or replace function cron.schedule(
  job_name text,
  job_schedule text,
  job_command text
)
returns bigint
language plpgsql
as $$
declare v_job_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, job_schedule, job_command)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command = excluded.command
  returning jobid into v_job_id;
  return v_job_id;
end;
$$;
create or replace function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language sql
as $$
  update cron.job
     set schedule = coalesce($2, cron.job.schedule),
         command = coalesce($3, cron.job.command),
         active = coalesce($6, cron.job.active)
   where jobid = $1
$$;

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
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function setClaims(db, role = "authenticated", userId = ADMIN_ID) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
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
    "detail-routine": `${prefix}/detail-routine.png`,
    "detail-scale": `${prefix}/detail-scale.png`,
    "detail-storage": `${prefix}/detail-storage.png`,
    "detail-context": `${prefix}/detail-context.png`,
    "detail-material": `${prefix}/detail-material.png`,
    "detail-dimensions": `${prefix}/detail-dimensions.png`,
    "detail-contents": `${prefix}/detail-contents.png`,
    "detail-care": `${prefix}/detail-care.png`,
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
      "20260825105200_durable_competitor_price_refresh.sql",
      "20260825110000_enable_channel_inquiry_replies.sql",
      "20260825110100_fix_registration_activity_running_state.sql",
      "20260825110200_refresh_competitor_price_snapshots.sql",
      "20260825110300_fence_tracx_delivery_matching.sql",
      "20260825111757_harden_inquiry_reply_delivery_fence.sql",
      "20260825111800_bind_listing_seller_accounts.sql",
      "20260825111810_harden_inquiry_reply_account_lineage.sql",
      "20260825111820_serialize_gateway_ledger_transactions.sql",
      "20260825111830_backfill_verified_static_listing_lineage.sql",
      "20260825111840_provider_listing_readback_rebind.sql",
      "20260825111850_preserve_succeeded_inquiry_reply_sync.sql",
      "20260826090000_scope_worker_tokens_and_idempotent_ai_completion.sql",
      "20260826090100_queue_ai_storage_cleanup.sql",
      "20260826090200_persist_product_detail_pages.sql",
      "20260826090300_bind_tracx_delivery_owner.sql",
      "20260826090400_atomic_gateway_completion_side_effects.sql",
      "20260826090500_atomic_worker_token_set_rotation.sql",
      "20260826090600_isolate_inventory_sync_generations.sql",
      "20260826090700_add_explicit_tracx_order_bindings.sql",
      "20260826090800_suppress_legacy_shopee_order_sync.sql",
      "20260826090900_atomic_product_photo_revision.sql",
      "20260826091000_dedupe_asset_regeneration_and_activity.sql",
      "20260826091100_bound_registration_activity_query.sql",
      "20260826091200_fence_periodic_sync_reconciliation.sql",
      "20260826091300_preserve_studio_source_uploads.sql",
      "20260826091400_preserve_asset_regeneration_manual_fields.sql",
      "20260826212116_harden_detail_pipeline_lineage.sql",
      "20260826221500_allow_verification_ribbon_detail_block.sql",
      "20260827000726_authorize_live_ai_result_uploads.sql",
      "20260827011228_reset_registration_activity_retry_clock.sql",
      "20260827025330_harden_shopee_shipment_lineage_and_ack_semantics.sql",
      "20260827075654_cross_product_setting_comparisons.sql",
      "20260827181100_allow_legacy_ai_cross_product_bridge.sql",
      "20260827193102_enable_brave_marketplace_competitor_provider.sql",
      "20260827212726_fence_competitor_matcher_version.sql",
      "20260827235328_expire_stale_non_cs_ai_jobs.sql",
      "20260828001000_expose_product_readiness_facts.sql",
      "20260828002000_fix_stale_ai_service_secret_guard.sql",
      "20260828003000_fence_competitor_matcher_v2.sql",
      "20260828004000_persist_terminal_image_failure_context.sql",
      "20260828123100_allow_validated_animated_gif_detail_block.sql",
      "20260828130000_isolate_product_ai_worker_claim.sql",
      "20260828135000_server_product_research_runtime.sql",
      "20260828135100_fix_server_product_research_secret_guard.sql",
      "20260828141000_enable_ebay_asq_inquiry_reply_lineage.sql",
      "20260828142500_list_latest_product_margin_scenarios.sql",
      "20260828143500_harden_worker_token_activation_lease_fence.sql",
      "20260828144000_bind_ebay_asq_marketplace_and_rate_limit.sql",
      "20260828145000_compact_legacy_periodic_gateway_reads.sql",
      "20260828145500_persist_elevenst_listing_update_snapshots.sql",
      "20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql",
      "20260828145700_schedule_serverless_cs_wakeup.sql",
      "20260828145800_extend_smartstore_customer_inquiry_reply_fence.sql",
      "20260828145900_durable_korean_inquiry_history_backfill.sql",
      "20260828145950_extend_serverless_cs_qoo10_inquiries.sql",
      LEGACY_SCOPE_RETIREMENT_MIGRATION,
      "20260828194000_fix_serverless_cs_vault_lookup_lock.sql",
      "20260828200500_gate_serverless_static_egress.sql",
      "20260828201500_cleanup_static_egress_queued_reads.sql",
    ]);
    for (const name of migrationNames) {
      if (name === LEGACY_SCOPE_RETIREMENT_MIGRATION) continue;
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      try {
        await db.exec(withoutUnavailableExtensions(sql));
      } catch (error) {
        if (error instanceof Error) {
          const position = "position" in error ? ` at ${String(error.position)}` : "";
          error.message = `${name}${position}: ${error.message}`;
        }
        throw error;
      }
    }
    const detailPipelineLineageMigration = await readFile(
      new URL("20260826212116_harden_detail_pipeline_lineage.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(detailPipelineLineageMigration));
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from pg_proc procedure
           join pg_namespace namespace on namespace.oid = procedure.pronamespace
          where namespace.nspname = 'public'
            and procedure.proname = 'sellerpilot_get_product_publish_context_pre_classification_evidence'`,
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_get_product_publish_context_pre_classification_evidence(uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_get_product_publish_context_pre_classification_evidence(uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_get_product_publish_context(uuid)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_get_product_publish_context(uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_get_product_publish_context(uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_260826_complete_ai_job_once(text,uuid,uuid,text,jsonb,text)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_service_stage_ai_result_uploads(text,uuid,uuid,text[])', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select to_regclass('sellerpilot_private.commerce_orders_tracx_reference_idx') is not null"),
      true,
    );
    assert.equal(
      await scalar(db, "select to_regclass('sellerpilot_private.commerce_orders_tracx_tracking_idx') is not null"),
      true,
    );
    for (const indexName of [
      "sellerpilot_private.products_registration_activity_updated_idx",
      "sellerpilot_private.product_listings_registration_activity_updated_idx",
      "sellerpilot_private.product_listings_registration_activity_product_idx",
      "sellerpilot_private.ai_cli_jobs_registration_studio_updated_idx",
      "sellerpilot_private.ai_cli_jobs_registration_asset_updated_idx",
      "sellerpilot_private.product_ai_revisions_registration_activity_updated_idx",
    ]) {
      assert.equal(await scalar(db, "select to_regclass($1) is not null", [indexName]), true);
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_list_registration_activity(integer)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_list_registration_activity(integer)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select exists (
           select 1
             from information_schema.columns
            where table_schema = 'sellerpilot_private'
              and table_name = 'ai_cli_jobs'
              and column_name = 'retry_started_at'
         )`,
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_retry_ai_job(uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_retry_ai_job(uuid)', 'EXECUTE')",
      ),
      true,
    );
    const boundedRegistrationActivityDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_list_registration_activity(integer)'::regprocedure)",
    );
    assert.match(boundedRegistrationActivityDefinition, /recent_listing_probe[\s\S]*limit v_listing_probe_limit/i);
    assert.match(boundedRegistrationActivityDefinition, /recent_studio_job_probe[\s\S]*limit v_job_probe_limit/i);
    assert.match(boundedRegistrationActivityDefinition, /retry_started_at/i);
    assert.doesNotMatch(
      boundedRegistrationActivityDefinition,
      /sellerpilot_list_registration_activity_pre_image_activity/i,
    );
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
    const tracxDeliveryFenceMigration = await readFile(
      new URL("20260825110300_fence_tracx_delivery_matching.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(tracxDeliveryFenceMigration));
    const tracxOwnerFenceMigration = await readFile(
      new URL("20260826090300_bind_tracx_delivery_owner.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(tracxOwnerFenceMigration));
    const tracxExplicitBindingMigration = await readFile(
      new URL("20260826090700_add_explicit_tracx_order_bindings.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(tracxExplicitBindingMigration));
    const shipmentLineageMigration = await readFile(
      new URL("20260827025330_harden_shopee_shipment_lineage_and_ack_semantics.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(shipmentLineageMigration));
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_get_inventory_sync_run(uuid,uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_get_inventory_sync_run(uuid,uuid)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_bind_tracx_order(uuid,text,text)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_bind_tracx_order(uuid,text,text)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_bind_tracx_order(uuid,text,text)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_enqueue_periodic_sync_without_identity_gate(text,text,jsonb,integer)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_enqueue_periodic_sync_without_identity_gate(text,text,jsonb,integer)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_list_shopee_connection_status()', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_list_shopee_connection_status()', 'EXECUTE')",
      ),
      true,
    );

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
      "public.sellerpilot_service_claim_ai_storage_cleanup(integer,integer)",
      "public.sellerpilot_service_complete_ai_storage_cleanup(uuid,text[],text)",
      "public.sellerpilot_service_stage_ai_result_uploads(text,uuid,uuid,text[])",
      "public.sellerpilot_service_authorize_ai_result_upload(text,uuid,uuid,text,text)",
      "public.sellerpilot_service_get_cross_product_setting_comparisons(text,uuid,uuid,integer)",
      "public.sellerpilot_service_activate_worker_token_set(uuid,jsonb)",
      "public.sellerpilot_service_abort_worker_token_set(uuid,jsonb)",
      "public.sellerpilot_service_expire_pending_worker_token_sets()",
      "public.sellerpilot_touch_ai_job(text,uuid,uuid,text)",
      "public.sellerpilot_service_complete_product_listing(uuid,uuid,text,boolean,text,text)",
      "public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)",
      "public.sellerpilot_claim_channel_gateway_job(text,text)",
      "public.sellerpilot_touch_channel_gateway_job(text,uuid,uuid,text)",
      "public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)",
      "public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)",
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
      "public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)",
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
      "public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)",
      "public.sellerpilot_service_fail_inventory_sync_item_prewrite(uuid,uuid,uuid,text)",
      "public.sellerpilot_service_sweep_stale_tracx_mutations()",
      "public.sellerpilot_service_claim_tracx_mutation(uuid,uuid,text,text,text,text)",
      "public.sellerpilot_service_begin_tracx_mutation(uuid,text)",
      "public.sellerpilot_service_complete_tracx_mutation(uuid,text,text,text,text)",
      "public.sellerpilot_service_sweep_stale_lazada_replies()",
      "public.sellerpilot_service_claim_due_competitor_products(integer,integer)",
      "public.sellerpilot_service_record_competitor_prices(uuid,jsonb)",
      "public.sellerpilot_service_complete_competitor_price_refresh(uuid,uuid,jsonb,jsonb)",
      "public.sellerpilot_service_release_competitor_price_refresh(uuid,uuid)",
      "public.sellerpilot_enqueue_competitor_search_job(uuid,text,jsonb,integer,uuid,uuid)",
    ];
    assert.equal(
      await scalar(
        db,
        "select to_regprocedure('public.sellerpilot_service_complete_competitor_price_refresh(uuid,uuid,jsonb)') is null",
      ),
      true,
    );
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
    const resultUploadStagingDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_service_stage_ai_result_uploads(text,uuid,uuid,text[])'::regprocedure)",
    );
    assert.match(resultUploadStagingDefinition, /FOR UPDATE/i);
    const resultUploadAuthorizationDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_service_authorize_ai_result_upload(text,uuid,uuid,text,text)'::regprocedure)",
    );
    assert.match(resultUploadAuthorizationDefinition, /FOR UPDATE/i);
    assert.match(resultUploadAuthorizationDefinition, /kind = 'product_studio'/i);
    assert.match(resultUploadAuthorizationDefinition, /kind = 'product_asset_regeneration'/i);
    assert.match(resultUploadAuthorizationDefinition, /request_payload/i);
    for (const signature of [
      "public.sellerpilot_service_claim_lazada_reply(uuid,uuid,text)",
      "public.sellerpilot_service_begin_lazada_reply(uuid,text)",
      "public.sellerpilot_service_complete_lazada_reply(uuid,text,text,text,text)",
      "public.sellerpilot_prepare_product_market_listing(uuid,text,text,text,text,text,numeric)",
      "public.sellerpilot_prepare_product_listing(uuid,text,text,text,numeric)",
    ]) {
      assert.equal(
        await scalar(db, "select has_function_privilege('authenticated', $1, 'EXECUTE')", [signature]),
        false,
      );
      assert.equal(
        await scalar(db, "select has_function_privilege('service_role', $1, 'EXECUTE')", [signature]),
        false,
      );
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

    const inventoryReplayProductId = await scalar(
      db,
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, description, status, on_hand,
         reserved, reorder_point, cost_krw, demo
       ) values (
         $1, 'INVENTORY-REPLAY-001', 'INVENTORY-REPLAY-001',
         '재고 세대 격리 테스트 상품', '이전 멱등키가 최신 재고 작업을 읽지 않는지 검증합니다.',
         'active', 6, 1, 1, 1000, false
      ) returning id`,
      [ADMIN_ID],
    );
    const inventoryListingAttempt = await scalar(
      db,
      `select public.sellerpilot_claim_channel_operation(
        $1, 'qoo10', 'listing.create', 'inventory-replay-listing-0001', $2
      )`,
      [credentialId, "f".repeat(64)],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         owner_id, product_id, channel_key, market, target_id, remote_id,
         status, currency, price, published_at, operation_attempt_id
       ) values ($1, $2, 'qoo10', 'JP', '', 'inventory-replay-remote-1',
         'published', 'JPY', 1500, now(), $3)`,
      [ADMIN_ID, inventoryReplayProductId, inventoryListingAttempt.attempt_id],
    );

    const oldInventoryKey = "inventory-replay-old-0001";
    const oldInventoryRun = await scalar(
      db,
      "select public.sellerpilot_start_inventory_sync($1, 7, $2)",
      [inventoryReplayProductId, oldInventoryKey],
    );
    assert.equal(oldInventoryRun.status, "running");
    assert.equal(oldInventoryRun.tasks.length, 1);
    assert.equal(oldInventoryRun.tasks[0].status, "pending");

    const pendingInventoryReplay = await scalar(
      db,
      "select public.sellerpilot_start_inventory_sync($1, 7, $2)",
      [inventoryReplayProductId, oldInventoryKey],
    );
    assert.equal(pendingInventoryReplay.runId, oldInventoryRun.runId);
    assert.equal(pendingInventoryReplay.tasks[0].id, oldInventoryRun.tasks[0].id);
    assert.equal(pendingInventoryReplay.tasks[0].status, "pending");

    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_fail_inventory_sync_item_prewrite($1, $2, null, 'test prewrite failure')",
        [oldInventoryRun.runId, oldInventoryRun.tasks[0].id],
      ),
      true,
    );
    await setClaims(db);

    const completedInventoryReplay = await scalar(
      db,
      "select public.sellerpilot_start_inventory_sync($1, 7, $2)",
      [inventoryReplayProductId, oldInventoryKey],
    );
    assert.equal(completedInventoryReplay.runId, oldInventoryRun.runId);
    assert.equal(completedInventoryReplay.status, "failed");
    assert.equal(completedInventoryReplay.tasks[0].status, "failed");

    const newInventoryRun = await scalar(
      db,
      "select public.sellerpilot_start_inventory_sync($1, 9, 'inventory-replay-new-0002')",
      [inventoryReplayProductId],
    );
    assert.notEqual(newInventoryRun.runId, oldInventoryRun.runId);
    assert.equal(newInventoryRun.tasks.length, 1);
    assert.notEqual(newInventoryRun.tasks[0].id, oldInventoryRun.tasks[0].id);
    assert.equal(newInventoryRun.tasks[0].status, "pending");

    const staleCompletedReplay = await scalar(
      db,
      "select public.sellerpilot_start_inventory_sync($1, 7, $2)",
      [inventoryReplayProductId, oldInventoryKey],
    );
    assert.equal(staleCompletedReplay.runId, oldInventoryRun.runId);
    assert.equal(staleCompletedReplay.status, "failed");
    assert.equal(staleCompletedReplay.requestedOnHand, 7);
    assert.deepEqual(
      staleCompletedReplay.tasks.map((task) => task.id),
      [oldInventoryRun.tasks[0].id],
    );
    assert.equal(
      staleCompletedReplay.tasks.some((task) => task.id === newInventoryRun.tasks[0].id),
      false,
    );
    assert.deepEqual(
      (await db.query(
        `select r.status as run_status, i.status as task_status
           from sellerpilot_private.inventory_sync_runs r
           join sellerpilot_private.inventory_sync_items i on i.run_id = r.id
          where r.id = $1`,
        [newInventoryRun.runId],
      )).rows,
      [{ run_status: "running", task_status: "pending" }],
    );
    assert.equal(
      await scalar(
        db,
        "select on_hand from sellerpilot_private.products where id = $1",
        [inventoryReplayProductId],
      ),
      9,
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_get_inventory_sync_run($1, $2)",
        [inventoryReplayProductId, oldInventoryRun.runId],
      )).runId,
      oldInventoryRun.runId,
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_get_inventory_sync($1)",
        [inventoryReplayProductId],
      )).runId,
      newInventoryRun.runId,
    );

    await setClaims(db, "authenticated", NON_ADMIN_ID);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_get_inventory_sync_run($1, $2)",
        [inventoryReplayProductId, oldInventoryRun.runId],
      ),
      null,
    );
    await setClaims(db);
    await db.query(
      "delete from sellerpilot_private.operation_audit where entity_type = 'product' and entity_id = $1",
      [inventoryReplayProductId],
    );
    await db.query(
      "delete from sellerpilot_private.products where id = $1",
      [inventoryReplayProductId],
    );
    await db.query(
      "delete from sellerpilot_private.channel_operation_attempts where id = $1",
      [inventoryListingAttempt.attempt_id],
    );

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
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set scope = 'legacy_combined' where token_hash = $1",
      [TOKEN_HASH],
    );
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('AI scoped worker', $1, 'BBBBBBBBBBBB', now() + interval '30 days', 'ai')",
      [AI_SCOPED_TOKEN_HASH],
    );
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('Gateway scoped worker', $1, 'CCCCCCCCCCCC', now() + interval '30 days', 'gateway')",
      [GATEWAY_SCOPED_TOKEN_HASH],
    );
    await db.query(
      "select public.sellerpilot_issue_ai_worker_token('Scheduler scoped worker', $1, 'DDDDDDDDDDDD', now() + interval '30 days', 'scheduler')",
      [SCHEDULER_SCOPED_TOKEN_HASH],
    );
    await setClaims(db, "service_role");
    await assert.rejects(
      db.query(
        "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/ai-cannot-claim-gateway')",
        [AI_SCOPED_TOKEN_HASH],
      ),
      /invalid worker token/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_claim_ai_job($1, 'migration-test/gateway-cannot-claim-ai')",
        [GATEWAY_SCOPED_TOKEN_HASH],
      ),
      /invalid worker token/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_validate_worker_token($1, 'migration-test/ai-not-scheduler')",
        [AI_SCOPED_TOKEN_HASH],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_validate_worker_token($1, 'migration-test/scheduler')",
        [SCHEDULER_SCOPED_TOKEN_HASH],
      ),
      true,
    );
    await setClaims(db);
    const shopeeCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production',
        '{"partner_id":"2031489","partner_key":"test-partner-key-long","shop_id":"123456789","access_token":"test-access-token","refresh_token":"test-refresh-token","provider_account_identity_version":"v1","provider_account_subject":"shopee:shop:123456789"}'::jsonb,
        now() + interval '365 days', 90, 30, 0
      )`,
    );
    assert.deepEqual(
      (await db.query(
        "select seller_account_key, seller_account_key_source from sellerpilot_private.channel_credentials where id = $1",
        [shopeeCredentialId],
      )).rows,
      [{ seller_account_key: null, seller_account_key_source: "legacy_unattested" }],
    );
    await setClaims(db, "service_role");
    const queuedLegacyShopeeOrder = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'shopee', 'orders.list',
        '{"periodicKey":"orders","arguments":{"shopId":"123456789"}}'::jsonb
      )`,
      [shopeeCredentialId],
    );
    const shopeeOrdersBeforeReconnectGate = await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where credential_id = $1 and operation = 'orders.list'",
      [shopeeCredentialId],
    );
    const legacyShopeePeriodic = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'shopee', 'orders.list',
        '{"periodicKey":"orders","arguments":{"shopId":"123456789"}}'::jsonb,
        5
      )`,
    );
    assert.equal(legacyShopeePeriodic.status, "reconnect_required");
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where credential_id = $1 and operation = 'orders.list'",
        [shopeeCredentialId],
      ),
      shopeeOrdersBeforeReconnectGate,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [queuedLegacyShopeeOrder],
      ),
      "cancelled",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.operation_audit
          where action = 'shopee_periodic_order_sync_suppressed'
            and entity_id = $1`,
        [queuedLegacyShopeeOrder],
      ),
      1,
    );
    assert.match(
      await scalar(
        db,
        "select last_error from sellerpilot_private.channel_sync_state where owner_id = $1 and channel_key = 'shopee' and data_type = 'orders'",
        [ADMIN_ID],
      ),
      /OAuth 재연동/,
    );
    await setClaims(db);
    assert.deepEqual(
      (await db.query(
        "select connection_status from public.sellerpilot_list_shopee_connection_status() where credential_id = $1",
        [shopeeCredentialId],
      )).rows,
      [{ connection_status: "oauth_reconnect_required" }],
    );
    await setClaims(db, "authenticated", NON_ADMIN_ID);
    assert.equal(
      await scalar(db, "select count(*)::integer from public.sellerpilot_list_shopee_connection_status()"),
      0,
    );
    await setClaims(db);
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

    const atomicSyncJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, attempt_id, channel, operation, environment,
         request_payload, created_by
       )
       select $1, null, 'shopee', 'orders.list', environment,
              '{"arguments":{"query":{"time_range_field":"create_time"}}}'::jsonb,
              created_by
         from sellerpilot_private.channel_credentials
        where id = $1
       returning id`,
      [shopeeCredentialId],
    );
    const atomicSyncClaim = await scalar(db, "select gen_random_uuid()");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'running',
              worker_token_id = (
                select id from sellerpilot_private.ai_cli_worker_tokens
                 where token_hash = $2
              ),
              claim_token = $3,
              lease_expires_at = now() + interval '15 minutes',
              started_at = '2026-08-26T03:04:05Z'::timestamptz
        where id = $1`,
      [atomicSyncJobId, TOKEN_HASH, atomicSyncClaim],
    );
    const atomicRunningContext = await scalar(
      db,
      "select public.sellerpilot_service_gateway_completion_context($1, $2, $3)",
      [TOKEN_HASH, atomicSyncJobId, atomicSyncClaim],
    );
    assert.equal(atomicRunningContext.status, "running");
    assert.equal(atomicRunningContext.normalization_timestamp, "2026-08-26T03:04:05+00:00");
    const atomicSyncResponse = {
      ok: true,
      channel: "shopee",
      operation: "orders.list",
      steps: [{ name: "orders", ok: true, status: 200, data: { response: { order_list: [] } } }],
      continuation: {
        reason: "page_cap_reached",
        arguments: {
          query: { time_range_field: "create_time", cursor: "next-page-cursor" },
          sellerpilotPaginationDepth: 1,
        },
      },
      safeMessage: "Shopee order chunk completed.",
    };
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_gateway_transaction(
          $1, $2, $3, 'succeeded', $4::jsonb, null,
          null, '{}'::jsonb, null, null
        )`,
        [TOKEN_HASH, atomicSyncJobId, atomicSyncClaim, JSON.stringify(atomicSyncResponse)],
      ),
      /normalized order payload required/,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.channel_gateway_jobs where id = $1", [atomicSyncJobId]),
      "running",
    );
    assert.equal(
      Number(await scalar(
        db,
        "select count(*) from sellerpilot_private.channel_gateway_jobs where request_payload->>'continuationOf' = $1",
        [atomicSyncJobId],
      )),
      0,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_gateway_transaction(
          $1, $2, $3, 'succeeded', $4::jsonb, null,
          null, '[]'::jsonb, null, null
        )`,
        [AI_SCOPED_TOKEN_HASH, atomicSyncJobId, atomicSyncClaim, JSON.stringify(atomicSyncResponse)],
      ),
      /invalid atomic gateway completion/,
    );
    const atomicSyncCompletion = await scalar(
      db,
      `select public.sellerpilot_service_complete_gateway_transaction(
        $1, $2, $3, 'succeeded', $4::jsonb, null,
        null, '[]'::jsonb, null, null
      )`,
      [TOKEN_HASH, atomicSyncJobId, atomicSyncClaim, JSON.stringify(atomicSyncResponse)],
    );
    assert.equal(atomicSyncCompletion.status, "completed");
    assert.match(atomicSyncCompletion.continuationJobId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      (await db.query(
        `select status,
                request_payload->'arguments'->'query'->>'cursor' as cursor,
                request_payload->'arguments'->>'sellerpilotPaginationDepth' as depth
           from sellerpilot_private.channel_gateway_jobs
          where request_payload->>'continuationOf' = $1`,
        [atomicSyncJobId],
      )).rows,
      [{ status: "queued", cursor: "next-page-cursor", depth: "1" }],
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_sync_state where channel_key = 'shopee' and data_type = 'orders'",
      ),
      "queued",
    );
    const atomicReplayContext = await scalar(
      db,
      "select public.sellerpilot_service_gateway_completion_context($1, $2, $3)",
      [TOKEN_HASH, atomicSyncJobId, atomicSyncClaim],
    );
    assert.equal(atomicReplayContext.status, "completed_replay");
    assert.equal(atomicReplayContext.normalization_timestamp, atomicRunningContext.normalization_timestamp);
    const atomicReplay = await scalar(
      db,
      `select public.sellerpilot_service_complete_gateway_transaction(
        $1, $2, $3, 'succeeded', $4::jsonb, null,
        null, '[]'::jsonb, null, null
      )`,
      [TOKEN_HASH, atomicSyncJobId, atomicSyncClaim, JSON.stringify(atomicSyncResponse)],
    );
    assert.equal(atomicReplay.status, "completed");
    assert.equal(atomicReplay.replayed, true);
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_gateway_transaction(
          $1, $2, $3, 'succeeded', $4::jsonb, null,
          null, '[]'::jsonb, null, null
        )`,
        [TOKEN_HASH, atomicSyncJobId, atomicSyncClaim, JSON.stringify({ ...atomicSyncResponse, safeMessage: "mismatched replay" })],
      ),
      /gateway completion replay mismatch/,
    );
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where request_payload->>'continuationOf' = $1",
      [atomicSyncJobId],
    );

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
      provider_account_identity_version: "v1",
      provider_account_subject: "shopee:shop:123456789",
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
    const uncertainWriteProductId = await scalar(
      db,
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, description, status, on_hand, reserved,
         reorder_point, cost_krw, demo
       ) values (
         $1, 'UNCERTAIN-WRITE-001', 'UNCERTAIN-WRITE-001', '전송 결과 확인 테스트 상품',
         '외부 등록 응답이 끊긴 경우 재전송하지 않는지 검증합니다.', 'draft', 4, 0, 0, 1, false
       ) returning id`,
      [ADMIN_ID],
    );
    await setClaims(db, "service_role");
    await scalar(
      db,
      "select public.sellerpilot_service_upsert_channel_market_target($1,$2,'shopee','test-shop-uncertain','Uncertain test shop','KR','ko-KR','Korean','KRW','NORMAL')",
      [ADMIN_ID, progressivePreparation.credential_id],
    );
    await setClaims(db);
    await scalar(
      db,
      `select public.sellerpilot_save_product_category_assignment(
        $1, 'shopee-uncertain-category', '전송 결과 확인 테스트 상품',
        'shopee', 'production', 'KR', '100001', array['테스트'], true, 1,
        'seller_selected', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, true
      )`,
      [uncertainWriteProductId],
    );
    const uncertainWriteAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'listing.create', 'shopee-uncertain-listing-0001', $2)",
      [progressivePreparation.credential_id, "7".repeat(64)],
    );
    await setClaims(db, "service_role");
    const uncertainWriteEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
        $1, $2, $3, 'shopee', 'KR', 'test-shop-uncertain', 'KRW', 1000, $4,
        '{"arguments":{"shopId":"test-shop-uncertain","merchantSku":"UNCERTAIN-1","stock":4}}'::jsonb
      )`,
      [
        uncertainWriteProductId,
        progressivePreparation.credential_id,
        uncertainWriteAttempt.attempt_id,
        "7".repeat(64),
      ],
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
        "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
        [TOKEN_HASH, uncertainWriteJobId, uncertainWriteClaim.claim_token],
      ),
      true,
    );
    const foreignSellerRefreshPayload = {
      ...progressiveRefreshPayload,
      access_token: "foreign-seller-access-token",
      refresh_token: "foreign-seller-refresh-token",
      provider_account_subject: "shopee:shop:987654321",
    };
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_prepare_gateway_credential_refresh($1, $2, $3, $4::jsonb, $5::timestamptz)",
        [TOKEN_HASH, uncertainWriteJobId, uncertainWriteClaim.claim_token, JSON.stringify(foreignSellerRefreshPayload), refreshExpiresAt],
      ),
      { status: "identity_mismatch" },
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.channel_credentials c
          join vault.decrypted_secrets s on s.id = c.vault_secret_id
         where s.decrypted_secret::jsonb->>'provider_account_subject' = 'shopee:shop:987654321'`,
      ),
      0,
    );
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
    await db.query("delete from sellerpilot_private.channel_gateway_jobs where id = $1", [uncertainWriteJobId]);
    await db.query("delete from sellerpilot_private.products where id = $1", [uncertainWriteProductId]);
    await db.query("delete from sellerpilot_private.channel_operation_attempts where id = $1", [uncertainWriteAttempt.attempt_id]);
    await db.query(
      "delete from sellerpilot_private.channel_market_targets where credential_id = $1 and target_id = 'test-shop-uncertain'",
      [progressivePreparation.credential_id],
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

    await setClaims(db, "service_role");
    const shopeeLineageOrder = {
      externalOrderId: "SHOPEE-LINEAGE-ORDER-1",
      customerName: "Shopee test buyer",
      productName: "Shopee lineage test product",
      quantity: 1,
      amount: 1200,
      currency: "KRW",
      amountKrw: 1200,
      status: "paid",
      orderedAt: "2026-08-27T00:00:00.000Z",
      providerContext: { orderSn: "SHOPEE-LINEAGE-ORDER-1", shopId: "123456789" },
    };
    assert.deepEqual(
      (await db.query(
        `select status, seller_account_key_source,
                seller_account_key is not null as has_seller_account_key,
                seller_account_verified_at is not null as verified
           from sellerpilot_private.channel_credentials where id = $1`,
        [progressivePreparation.credential_id],
      )).rows[0],
      {
        status: "active",
        seller_account_key_source: "provider_certified_v1",
        has_seller_account_key: true,
        verified: true,
      },
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_orders($1, 'shopee', $2::jsonb)",
        [progressivePreparation.credential_id, JSON.stringify([shopeeLineageOrder])],
      ),
      1,
    );
    const shopeeLineageContext = await scalar(
      db,
      `select provider_context
         from sellerpilot_private.commerce_orders
        where owner_id = $1 and channel_key = 'shopee'
          and external_order_id = 'SHOPEE-LINEAGE-ORDER-1'`,
      [ADMIN_ID],
    );
    assert.equal(shopeeLineageContext.shopId, "123456789");
    assert.equal(shopeeLineageContext.sourceCredentialId, progressivePreparation.credential_id);
    assert.match(shopeeLineageContext.sellerAccountKey, /^[a-f0-9]{64}$/);

    await setClaims(db);
    const shopeePreflightAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'shipment.acknowledge', 'shopee-lineage-preflight-0001', $2)",
      [progressivePreparation.credential_id, "8".repeat(64)],
    );
    const shopeeWrongShopAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'shopee', 'shipment.acknowledge', 'shopee-lineage-preflight-wrong-shop-0001', $2)",
      [progressivePreparation.credential_id, "9".repeat(64)],
    );
    const shopeeLineageOrderId = await scalar(
      db,
      `select id from sellerpilot_private.commerce_orders
        where owner_id = $1 and channel_key = 'shopee'
          and external_order_id = 'SHOPEE-LINEAGE-ORDER-1'`,
      [ADMIN_ID],
    );
    await setClaims(db, "service_role");
    const shopeePreflightJob = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_resource_gateway_job(
        $1, $2, 'shopee', 'shipment.acknowledge',
        '{"arguments":{"shopId":"123456789","query":{"order_sn":"SHOPEE-LINEAGE-ORDER-1"}}}'::jsonb,
        'order_shipment', $3, $4, null, null, $5, 'SPX', 'SHOPEE-PREFLIGHT-TRACK'
      )`,
      [
        progressivePreparation.credential_id,
        shopeePreflightAttempt.attempt_id,
        "a".repeat(64),
        "8".repeat(64),
        shopeeLineageOrderId,
      ],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"safeMessage":"shipping parameter verified"}'::jsonb,
              completed_at = now()
        where id = $1`,
      [shopeePreflightJob.job_id],
    );
    assert.deepEqual(
      (await db.query(
        `select status, shipment_write_status, tracking_number, last_shipment_at
           from sellerpilot_private.commerce_orders where id = $1`,
        [shopeeLineageOrderId],
      )).rows[0],
      {
        status: "paid",
        shipment_write_status: "pending",
        tracking_number: null,
        last_shipment_at: null,
      },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit where entity_id = $1 and action = 'shipment_preflight_verified'",
        [shopeeLineageOrderId],
      ),
      1,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_enqueue_resource_gateway_job(
          $1, $2, 'shopee', 'shipment.acknowledge',
          '{"arguments":{"shopId":"987654321","query":{"order_sn":"SHOPEE-LINEAGE-ORDER-1"}}}'::jsonb,
          'order_shipment', $3, $4, null, null, $5, 'SPX', 'SHOPEE-WRONG-SHOP'
        )`,
        [
          progressivePreparation.credential_id,
          shopeeWrongShopAttempt.attempt_id,
          "b".repeat(64),
          "9".repeat(64),
          shopeeLineageOrderId,
        ],
      ),
      /Shopee shipment request order lineage mismatch/,
    );
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where id = $1",
      [shopeePreflightJob.job_id],
    );
    await db.query(
      "delete from sellerpilot_private.channel_operation_attempts where id = any($1::uuid[])",
      [[shopeePreflightAttempt.attempt_id, shopeeWrongShopAttempt.attempt_id]],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_ingest_orders($1, 'shopee', $2::jsonb)",
        [progressivePreparation.credential_id, JSON.stringify([{
          ...shopeeLineageOrder,
          providerContext: { orderSn: "SHOPEE-LINEAGE-ORDER-1", shopId: "987654321" },
        }])],
      ),
      /Shopee order shop lineage mismatch/,
    );
    const foreignShopeeCredentialId = await scalar(
      db,
      "select public.sellerpilot_service_refresh_shopee($1, $2::jsonb, $3::timestamptz)",
      [progressivePreparation.credential_id, JSON.stringify({
        ...progressiveRefreshPayload,
        shop_id: "987654321",
        provider_account_subject: "shopee:shop:987654321",
      }), refreshExpiresAt],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_ingest_orders($1, 'shopee', $2::jsonb)",
        [foreignShopeeCredentialId, JSON.stringify([{
          ...shopeeLineageOrder,
          providerContext: { orderSn: "SHOPEE-LINEAGE-ORDER-1", shopId: "987654321" },
        }])],
      ),
      /Shopee existing order credential lineage mismatch/,
    );
    await db.query(
      `delete from sellerpilot_private.commerce_orders
        where owner_id = $1 and channel_key = 'shopee'
          and external_order_id = 'SHOPEE-LINEAGE-ORDER-1'`,
      [ADMIN_ID],
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

    const crossProductCurrentJobId = "70000000-0000-4000-8000-000000000001";
    const crossProductCurrentClaim = "70000000-0000-4000-8000-000000000002";
    const crossProductCurrentRegenerationJobId = "70000000-0000-4000-8000-000000000003";
    const crossProductCurrentRegenerationClaim = "70000000-0000-4000-8000-000000000004";
    const crossProductLegacyJobId = "70000000-0000-4000-8000-000000000005";
    const crossProductLegacyClaim = "70000000-0000-4000-8000-000000000006";
    const crossProductSourceJobIds = Array.from(
      { length: 9 },
      (_, index) => `7100000${index}-0000-4000-8000-000000000001`,
    );
    const crossProductProductIds = Array.from(
      { length: 9 },
      (_, index) => `7200000${index}-0000-4000-8000-000000000001`,
    );
    const crossProductClaims = Array.from(
      { length: 9 },
      (_, index) => `7300000${index}-0000-4000-8000-000000000001`,
    );
    for (let index = 0; index < crossProductSourceJobIds.length; index += 1) {
      const sourceJobId = crossProductSourceJobIds[index];
      const productId = crossProductProductIds[index];
      const result = {
        mode: "cli",
        product: { category: "일반식품", name: `교차 비교 상품 ${index}` },
        asset_storage_paths: aiClaimAssetPaths(sourceJobId, crossProductClaims[index]),
      };
      await db.query(
        `insert into sellerpilot_private.ai_cli_jobs (
           id, kind, status, request_payload, result_payload, created_by,
           created_at, completed_at, updated_at
         ) values (
           $1, 'product_studio', 'succeeded', '{}'::jsonb, $2::jsonb, $3,
           now() - ($4 * interval '1 minute'),
           now() - ($4 * interval '1 minute'),
           now() - ($4 * interval '1 minute')
         )`,
        [sourceJobId, JSON.stringify(result), ADMIN_ID, index + 1],
      );
      await db.query(
        `insert into sellerpilot_private.products (
           id, owner_id, external_code, sku, name, description, ai_job_id,
           status, demo, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, '', $6, 'active', false,
           now() - ($7 * interval '1 minute'),
           now() - ($7 * interval '1 minute')
         )`,
        [productId, ADMIN_ID, `CROSS-${index}`, `CROSS-SKU-${index}`, `교차 비교 상품 ${index}`, sourceJobId, index + 1],
      );
    }

    const crossProductRegenerationJobId = "74000000-0000-4000-8000-000000000001";
    const crossProductRegenerationClaim = "74000000-0000-4000-8000-000000000002";
    const regeneratedPortraitPath = aiClaimAssetPaths(
      crossProductRegenerationJobId,
      crossProductRegenerationClaim,
    ).portrait;
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, result_payload, created_by,
         created_at, completed_at, updated_at
       ) values (
         $1, 'product_asset_regeneration', 'succeeded', $2::jsonb, $3::jsonb, $4,
         now(), now(), now()
       )`,
      [
        crossProductRegenerationJobId,
        JSON.stringify({
          source_job_id: crossProductSourceJobIds[0],
          source_product_id: crossProductProductIds[0],
          asset_id: "portrait",
        }),
        JSON.stringify({
          mode: "asset-regeneration",
          asset_storage_paths: { portrait: regeneratedPortraitPath },
        }),
        ADMIN_ID,
      ],
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set result_payload = jsonb_set(result_payload, '{asset_storage_paths,portrait}', to_jsonb($2::text), true)
        where id = $1`,
      [crossProductSourceJobIds[0], regeneratedPortraitPath],
    );

    const crossOwnerSourceJobId = "75000000-0000-4000-8000-000000000001";
    const crossOwnerProductId = "75000000-0000-4000-8000-000000000002";
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, result_payload, created_by, completed_at
       ) values ($1, 'product_studio', 'succeeded', '{}'::jsonb, $2::jsonb, $3, now())`,
      [crossOwnerSourceJobId, JSON.stringify({
        mode: "cli",
        product: { category: "일반식품", name: "다른 소유자 상품" },
        asset_storage_paths: aiClaimAssetPaths(crossOwnerSourceJobId, "75000000-0000-4000-8000-000000000003"),
      }), SECOND_ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.products (
         id, owner_id, external_code, sku, name, ai_job_id, status, demo
       ) values ($1, $2, 'CROSS-OWNER', 'CROSS-OWNER-SKU', '다른 소유자 상품', $3, 'active', false)`,
      [crossOwnerProductId, SECOND_ADMIN_ID, crossOwnerSourceJobId],
    );

    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'active', revoked_at = null where token_hash = $1",
      [AI_SCOPED_TOKEN_HASH],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, created_by, worker_token_id,
         claim_token, lease_expires_at, started_at
       ) select $1, 'product_studio', 'running', '{}'::jsonb, $2, token.id,
                $3, now() + interval '15 minutes', now()
           from sellerpilot_private.ai_cli_worker_tokens token
          where token.token_hash = $4`,
      [crossProductCurrentJobId, ADMIN_ID, crossProductCurrentClaim, AI_SCOPED_TOKEN_HASH],
    );
    await setClaims(db, "service_role");
    const crossProductComparisons = await scalar(
      db,
      "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
      [AI_SCOPED_TOKEN_HASH, crossProductCurrentJobId, crossProductCurrentClaim],
    );
    assert.equal(crossProductComparisons.version, 1);
    assert.equal(crossProductComparisons.productCount, 8);
    assert.equal(crossProductComparisons.assetCount, 64);
    assert.equal(crossProductComparisons.products.length, 8);
    assert.equal(crossProductComparisons.products.some((product) => product.sourceJobId === crossOwnerSourceJobId), false);
    assert.ok(crossProductComparisons.products.every((product) => Object.keys(product.assets).length === 8));
    const regeneratedComparison = crossProductComparisons.products.find(
      (product) => product.sourceJobId === crossProductSourceJobIds[0],
    );
    assert.equal(regeneratedComparison?.assets.portrait, regeneratedPortraitPath);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
        [AI_SCOPED_TOKEN_HASH, crossProductCurrentJobId, "70000000-0000-4000-8000-000000000099"],
      ),
      null,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
        [GATEWAY_SCOPED_TOKEN_HASH, crossProductCurrentJobId, crossProductCurrentClaim],
      ),
      /invalid worker token/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
        [TOKEN_HASH, crossProductCurrentJobId, crossProductCurrentClaim],
      ),
      /invalid worker token/,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'revoked', revoked_at = now() where token_hash = $1",
      [TOKEN_HASH],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at,
         created_by, created_at, rotation_set_id
       ) values (
         'Bounded legacy cross-product bridge', $1, 'FFFFFFFFFFFF', 'active',
         'legacy_combined', timestamptz '2026-09-01 17:43:09+00',
         $2, timestamptz '2026-08-25 00:00:00+00', null
       )`,
      [LEGACY_CROSS_TOKEN_HASH, ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, created_by, worker_token_id,
         claim_token, lease_expires_at, started_at
       ) select $1, 'product_studio', 'running', '{}'::jsonb, $2, token.id,
                $3, now() + interval '15 minutes', now()
           from sellerpilot_private.ai_cli_worker_tokens token
          where token.token_hash = $4`,
      [crossProductLegacyJobId, ADMIN_ID, crossProductLegacyClaim, LEGACY_CROSS_TOKEN_HASH],
    );
    const legacyBridgeOpen = await scalar(
      db,
      "select clock_timestamp() < timestamptz '2026-09-01 17:44:00+00'",
    );
    if (legacyBridgeOpen) {
      const legacyComparisons = await scalar(
        db,
        "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
        [LEGACY_CROSS_TOKEN_HASH, crossProductLegacyJobId, crossProductLegacyClaim],
      );
      assert.equal(legacyComparisons.productCount, 8);
      assert.equal(legacyComparisons.assetCount, 64);
      await db.query(
        "update sellerpilot_private.ai_cli_worker_tokens set expires_at = now() - interval '1 second' where token_hash = $1",
        [LEGACY_CROSS_TOKEN_HASH],
      );
    }
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
        [LEGACY_CROSS_TOKEN_HASH, crossProductLegacyJobId, crossProductLegacyClaim],
      ),
      /invalid worker token/,
    );
    await db.query(
      "delete from sellerpilot_private.ai_cli_jobs where id = $1",
      [crossProductLegacyJobId],
    );
    await db.query(
      "delete from sellerpilot_private.ai_cli_worker_tokens where token_hash = $1",
      [LEGACY_CROSS_TOKEN_HASH],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'active', revoked_at = null where token_hash = $1",
      [TOKEN_HASH],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, created_by, worker_token_id,
         claim_token, lease_expires_at, started_at
       ) select $1, 'product_asset_regeneration', 'running', $2::jsonb, $3, token.id,
                $4, now() + interval '15 minutes', now()
           from sellerpilot_private.ai_cli_worker_tokens token
          where token.token_hash = $5`,
      [
        crossProductCurrentRegenerationJobId,
        JSON.stringify({
          source_job_id: crossProductSourceJobIds[0],
          source_product_id: crossProductProductIds[0],
          asset_id: "detail-context",
        }),
        ADMIN_ID,
        crossProductCurrentRegenerationClaim,
        AI_SCOPED_TOKEN_HASH,
      ],
    );
    const regenerationCrossProductComparisons = await scalar(
      db,
      "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
      [AI_SCOPED_TOKEN_HASH, crossProductCurrentRegenerationJobId, crossProductCurrentRegenerationClaim],
    );
    assert.equal(regenerationCrossProductComparisons.productCount, 8);
    assert.equal(regenerationCrossProductComparisons.assetCount, 64);
    assert.equal(
      regenerationCrossProductComparisons.products.some(
        (product) => product.sourceJobId === crossProductSourceJobIds[0],
      ),
      false,
    );
    assert.ok(regenerationCrossProductComparisons.products.every(
      (product) => product.sceneIdentity.category === "일반식품"
        && product.sceneIdentity.name.startsWith("교차 비교 상품 "),
    ));
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set request_payload = jsonb_set(request_payload, '{source_product_id}', to_jsonb($2::text), true)
        where id = $1`,
      [crossProductCurrentRegenerationJobId, crossOwnerProductId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_get_cross_product_setting_comparisons($1, $2, $3, 8)",
        [AI_SCOPED_TOKEN_HASH, crossProductCurrentRegenerationJobId, crossProductCurrentRegenerationClaim],
      ),
      null,
    );
    await db.query(
      "delete from sellerpilot_private.products where id = any($1::uuid[])",
      [[...crossProductProductIds, crossOwnerProductId]],
    );
    await db.query(
      "delete from sellerpilot_private.ai_cli_jobs where id = any($1::uuid[])",
      [[
        crossProductCurrentJobId,
        crossProductCurrentRegenerationJobId,
        crossProductRegenerationJobId,
        crossOwnerSourceJobId,
        ...crossProductSourceJobIds,
      ]],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'revoked', revoked_at = now() where token_hash = $1",
      [AI_SCOPED_TOKEN_HASH],
    );

    await setClaims(db);
    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [RETRY_CLOCK_JOB_ID, JSON.stringify({
        ...requestPayload,
        image_paths: [`${ADMIN_ID}/${RETRY_CLOCK_JOB_ID}/input/hero.jpg`],
        manual_fields: {
          ...requestPayload.manual_fields,
          productName: "재시도 경과시간 테스트 상품",
          sellerSku: "QA-RETRY-CLOCK",
        },
      })],
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status = 'failed',
              attempt_count = 1,
              created_at = clock_timestamp() - interval '1 day',
              started_at = clock_timestamp() - interval '23 hours',
              completed_at = clock_timestamp() - interval '22 hours',
              updated_at = clock_timestamp() - interval '22 hours'
        where id = $1`,
      [RETRY_CLOCK_JOB_ID],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [RETRY_CLOCK_JOB_ID]),
      true,
    );
    const queuedRetryClock = (await db.query(
      `select extract(epoch from created_at)::bigint as created_epoch,
              extract(epoch from retry_started_at)::bigint as retry_epoch,
              started_at is null as claim_not_started
         from sellerpilot_private.ai_cli_jobs
        where id = $1`,
      [RETRY_CLOCK_JOB_ID],
    )).rows[0];
    const queuedRetryActivities = await scalar(
      db,
      "select public.sellerpilot_list_registration_activity(20)",
    );
    const queuedRetryCard = queuedRetryActivities.find(
      (activity) => activity.id === `job:${RETRY_CLOCK_JOB_ID}`,
    );
    assert.equal(queuedRetryCard.status, "analyzing");
    assert.equal(queuedRetryClock.claim_not_started, true);
    assert.ok(queuedRetryClock.retry_epoch - queuedRetryClock.created_epoch > 80_000);
    assert.ok(Math.abs(Date.parse(queuedRetryCard.startedAt) / 1_000 - queuedRetryClock.retry_epoch) <= 1);
    assert.ok(queuedRetryCard.elapsedSeconds < 60);

    await setClaims(db, "service_role");
    const retryClockClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/retry-clock')",
      [TOKEN_HASH],
    );
    assert.equal(retryClockClaim.id, RETRY_CLOCK_JOB_ID);
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set started_at = clock_timestamp() - interval '7 seconds',
              updated_at = clock_timestamp()
        where id = $1`,
      [RETRY_CLOCK_JOB_ID],
    );
    const claimedRetryEpoch = Number(await scalar(
      db,
      "select extract(epoch from started_at)::bigint from sellerpilot_private.ai_cli_jobs where id = $1",
      [RETRY_CLOCK_JOB_ID],
    ));
    await setClaims(db);
    const runningRetryActivities = await scalar(
      db,
      "select public.sellerpilot_list_registration_activity(20)",
    );
    const runningRetryCard = runningRetryActivities.find(
      (activity) => activity.id === `job:${RETRY_CLOCK_JOB_ID}`,
    );
    assert.equal(runningRetryCard.status, "analyzing");
    assert.ok(Math.abs(Date.parse(runningRetryCard.startedAt) / 1_000 - claimedRetryEpoch) <= 1);
    assert.ok(runningRetryCard.elapsedSeconds >= 7 && runningRetryCard.elapsedSeconds < 60);
    const auditedRetryEpoch = Number(await scalar(
      db,
      `select extract(epoch from max(occurred_at))::bigint
         from sellerpilot_private.ai_cli_audit
        where job_id = $1
          and action = 'job_retried'
          and safe_detail->>'source' = 'admin_ui'`,
      [RETRY_CLOCK_JOB_ID],
    ));
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set retry_started_at = null where id = $1",
      [RETRY_CLOCK_JOB_ID],
    );
    const retryClockMigration = await readFile(
      new URL("20260827011228_reset_registration_activity_retry_clock.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(retryClockMigration));
    assert.equal(
      Number(await scalar(
        db,
        "select extract(epoch from retry_started_at)::bigint from sellerpilot_private.ai_cli_jobs where id = $1",
        [RETRY_CLOCK_JOB_ID],
      )),
      auditedRetryEpoch,
    );
    await db.query("delete from sellerpilot_private.ai_cli_audit where job_id = $1", [RETRY_CLOCK_JOB_ID]);
    await db.query("delete from sellerpilot_private.ai_cli_jobs where id = $1", [RETRY_CLOCK_JOB_ID]);

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
    const stalePartialResultPath = `results/${STALE_AI_JOB_ID}/claims/${staleAiClaim.claim_token}/hero.png`;
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_stage_ai_result_uploads($1, $2, $3, array[$4]::text[])",
        [TOKEN_HASH, STALE_AI_JOB_ID, staleAiClaim.claim_token, stalePartialResultPath],
      ),
      true,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_stage_ai_result_uploads($1, $2, $3, array[$4]::text[])",
        [GATEWAY_SCOPED_TOKEN_HASH, STALE_AI_JOB_ID, staleAiClaim.claim_token, stalePartialResultPath],
      ),
      /invalid worker token/,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_result_upload_staging where job_id = $1 and claim_token = $2",
        [STALE_AI_JOB_ID, staleAiClaim.claim_token],
      ),
      1,
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
    const currentHeroResultPath = `results/${STALE_AI_JOB_ID}/claims/${currentAiClaim.claim_token}/hero.png`;
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_authorize_ai_result_upload($1, $2, $3, 'hero', $4)",
        [TOKEN_HASH, STALE_AI_JOB_ID, currentAiClaim.claim_token, currentHeroResultPath],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_authorize_ai_result_upload($1, $2, $3, 'hero', $4)",
        [
          TOKEN_HASH,
          STALE_AI_JOB_ID,
          currentAiClaim.claim_token,
          `results/${STALE_AI_JOB_ID}/claims/${currentAiClaim.claim_token}/wrong.png`,
        ],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.ai_result_upload_staging where job_id = $1 and claim_token = $2 and object_path = $3",
        [STALE_AI_JOB_ID, currentAiClaim.claim_token, currentHeroResultPath],
      ),
      1,
    );
    await db.query(
      "delete from sellerpilot_private.ai_result_upload_staging where job_id = $1 and claim_token = $2 and object_path = $3",
      [STALE_AI_JOB_ID, currentAiClaim.claim_token, currentHeroResultPath],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_result_upload_staging where job_id = $1 and claim_token = $2",
        [STALE_AI_JOB_ID, staleAiClaim.claim_token],
      ),
      0,
    );
    assert.deepEqual(
      (await db.query(
        `select status,
                available_at > now() + interval '2 hours' as after_upload_token_expiry,
                last_error
           from sellerpilot_private.ai_storage_cleanup_queue
          where object_path = $1`,
        [stalePartialResultPath],
      )).rows,
      [{ status: "queued", after_upload_token_expiry: true, last_error: "partial_result_upload_cleanup" }],
    );
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
    await db.query(
      "update sellerpilot_private.ai_storage_cleanup_queue set available_at = now() - interval '1 second' where object_path = $1",
      [stalePartialResultPath],
    );
    const partialUploadCleanupClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_ai_storage_cleanup(10, 120)",
    );
    assert.deepEqual(partialUploadCleanupClaim.paths, [stalePartialResultPath]);
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_ai_storage_cleanup($1, array[$2]::text[], null)",
        [partialUploadCleanupClaim.claimToken, stalePartialResultPath],
      ),
      { removed: 1, requeued: 0 },
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
    const stagedSuccessfulResultPaths = Object.values(aiClaimAssetPaths(JOB_ID, claimed.claim_token));
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_stage_ai_result_uploads($1, $2, $3, $4::text[])",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, stagedSuccessfulResultPaths],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_result_upload_staging where job_id = $1 and claim_token = $2",
        [JOB_ID, claimed.claim_token],
      ),
      stagedSuccessfulResultPaths.length,
    );
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
      product: {
        name: "AI 생성 테스트 상품",
        category: "생활",
        classification: {
          displayName: "일반 생활용품",
          verificationStatus: "verified",
          evidence: "판매자가 제공한 포장 라벨과 상품 정보를 교차 확인함",
          isHealthFunctionalFood: false,
        },
      },
      design: { heroCopy: "검증된 상세페이지", palette: { primary: "#111827" } },
      thumbnail: { title: "AI 생성 테스트 상품" },
      warnings: ["migration-test-warning"],
      localizedListings: [{ title: "publish-context에서 제외될 현지화 데이터" }],
      asset_storage_paths: aiClaimAssetPaths(JOB_ID, claimed.claim_token),
    };
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [
          TOKEN_HASH,
          JOB_ID,
          claimed.claim_token,
          JSON.stringify({
            ...resultPayload,
            asset_storage_paths: Object.fromEntries(
              Object.entries(resultPayload.asset_storage_paths).slice(0, 8),
            ),
          }),
        ],
      ),
      /invalid studio asset claim paths/,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.ai_cli_jobs where id = $1", [JOB_ID]),
      "running",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, JSON.stringify(resultPayload)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_result_upload_staging where job_id = $1",
        [JOB_ID],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_storage_cleanup_queue where object_path = any($1::text[])",
        [stagedSuccessfulResultPaths],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, JSON.stringify(resultPayload)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, JSON.stringify({ ...resultPayload, title: "mismatched retry" })],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_job_completion_receipts where job_id = $1",
        [JOB_ID],
      ),
      1,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'revoked', revoked_at = now() where token_hash = $1",
      [TOKEN_HASH],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token],
      ),
      false,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, JSON.stringify(resultPayload)],
      ),
      /invalid worker token/,
    );
    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set status = 'active', revoked_at = null, expires_at = now() - interval '1 second'
        where token_hash = $1`,
      [TOKEN_HASH],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token],
      ),
      false,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token, JSON.stringify(resultPayload)],
      ),
      /invalid worker token/,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set expires_at = now() + interval '30 days' where token_hash = $1",
      [TOKEN_HASH],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_ai_job_completion($1, $2, $3)",
        [TOKEN_HASH, JOB_ID, claimed.claim_token],
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
    await db.query(
      "update sellerpilot_private.products set owner_id = $2 where id = $1",
      [aiProductId, SECOND_ADMIN_ID],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_create_asset_regeneration_job($1, $2, $3, 'detail-care')",
        [OWNER_FENCE_REGEN_JOB_ID, JOB_ID, aiProductId],
      ),
      /source product does not match studio job/,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.ai_cli_jobs where id = $1",
        [OWNER_FENCE_REGEN_JOB_ID],
      ),
      0,
    );
    await db.query(
      "update sellerpilot_private.products set owner_id = $2 where id = $1",
      [aiProductId, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_create_asset_regeneration_job($1, $2, $3, 'detail-care')",
        [EXPANDED_REGEN_JOB_ID, JOB_ID, aiProductId],
      ),
      EXPANDED_REGEN_JOB_ID,
    );
    await setClaims(db, "service_role");
    const expandedRegenerationClaim = await scalar(
      db,
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/expanded-regeneration')",
      [TOKEN_HASH],
    );
    assert.equal(expandedRegenerationClaim.id, EXPANDED_REGEN_JOB_ID);
    const expandedRegenerationPath = `results/${EXPANDED_REGEN_JOB_ID}/claims/${expandedRegenerationClaim.claim_token}/detail-care.png`;
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_authorize_ai_result_upload($1, $2, $3, 'detail-care', $4)",
        [TOKEN_HASH, EXPANDED_REGEN_JOB_ID, expandedRegenerationClaim.claim_token, expandedRegenerationPath],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_authorize_ai_result_upload($1, $2, $3, 'hero', $4)",
        [
          TOKEN_HASH,
          EXPANDED_REGEN_JOB_ID,
          expandedRegenerationClaim.claim_token,
          `results/${EXPANDED_REGEN_JOB_ID}/claims/${expandedRegenerationClaim.claim_token}/hero.png`,
        ],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_stage_ai_result_uploads($1, $2, $3, array[$4]::text[])",
        [TOKEN_HASH, EXPANDED_REGEN_JOB_ID, expandedRegenerationClaim.claim_token, expandedRegenerationPath],
      ),
      true,
    );
    const expandedRegenerationResult = {
      mode: "asset-regeneration",
      assetId: "detail-care",
      sourceJobId: JOB_ID,
      asset_storage_paths: { "detail-care": expandedRegenerationPath },
    };
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set created_by = $2 where id = $1",
      [EXPANDED_REGEN_JOB_ID, SECOND_ADMIN_ID],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [
          TOKEN_HASH,
          EXPANDED_REGEN_JOB_ID,
          expandedRegenerationClaim.claim_token,
          JSON.stringify(expandedRegenerationResult),
        ],
      ),
      /asset regeneration source owner mismatch/,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.ai_cli_jobs where id = $1",
        [EXPANDED_REGEN_JOB_ID],
      ),
      "running",
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set created_by = $2 where id = $1",
      [EXPANDED_REGEN_JOB_ID, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_complete_ai_job($1, $2, $3, 'succeeded', $4::jsonb, null)",
        [
          TOKEN_HASH,
          EXPANDED_REGEN_JOB_ID,
          expandedRegenerationClaim.claim_token,
          JSON.stringify(expandedRegenerationResult),
        ],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select result_payload->'asset_storage_paths'->>'detail-care' from sellerpilot_private.ai_cli_jobs where id = $1",
        [JOB_ID],
      ),
      expandedRegenerationPath,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.ai_result_upload_staging where job_id = $1",
        [EXPANDED_REGEN_JOB_ID],
      ),
      0,
    );
    await db.query(
      "delete from sellerpilot_private.ai_cli_audit where job_id = $1",
      [EXPANDED_REGEN_JOB_ID],
    );
    await db.query(
      "delete from sellerpilot_private.ai_cli_jobs where id = $1",
      [EXPANDED_REGEN_JOB_ID],
    );
    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_create_asset_regeneration_job($1, $2, $3, 'detail-use')",
        [CROSS_OWNER_REGEN_JOB_ID, JOB_ID, aiProductId],
      ),
      /source studio job not found/,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_cli_jobs where id = $1", [CROSS_OWNER_REGEN_JOB_ID]),
      0,
    );
    await setClaims(db);
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
        "select public.sellerpilot_create_asset_regeneration_job($1, $2, $3, 'detail-use')",
        [DEDUPED_REGEN_REQUEST_ID, JOB_ID, aiProductId],
      ),
      REGEN_JOB_ID,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_cli_jobs where id = $1", [DEDUPED_REGEN_REQUEST_ID]),
      0,
    );
    const activeRegenerationActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(300)");
    const activeRegenerationCard = activeRegenerationActivity.find((activity) => activity.id === `asset:${REGEN_JOB_ID}`);
    assert.equal(activeRegenerationCard?.status, "analyzing");
    assert.equal(activeRegenerationCard?.productId, aiProductId);
    assert.match(activeRegenerationCard?.message ?? "", /외부 자동 게시 없음/);
    assert.equal(
      await scalar(
        db,
        "select case when request_payload->'comparison_asset_paths'->>'hero' = $2 then 1 else 0 end from sellerpilot_private.ai_cli_jobs where id = $1",
        [REGEN_JOB_ID, resultPayload.asset_storage_paths.hero],
      ),
      1,
    );
    assert.deepEqual(
      await scalar(
        db,
        "select request_payload->'manual_fields' from sellerpilot_private.ai_cli_jobs where id = $1",
        [REGEN_JOB_ID],
      ),
      requiredManualFields,
    );
    assert.equal(
      await scalar(
        db,
        "select (safe_detail->>'comparison_asset_count')::integer from sellerpilot_private.ai_cli_audit where job_id = $1 and action = 'job_queued' order by occurred_at desc limit 1",
        [REGEN_JOB_ID],
      ),
      16,
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
      matcherVersion: "strict-2026-08-28-v2",
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
          '[{"externalId":"competitor-invalid-market","title":"잘못된 채널 후보","url":"https://marketplace.example.test/products/invalid","imageUrl":"","mallName":"알 수 없는 판매처","marketplace":"unknown-market","price":9999,"matcherVersion":"strict-2026-08-28-v2"}]'::jsonb
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
          '[{"provider":"ebay_browse","externalId":"competitor-1","title":"Kellogg Choco Chex 570g","url":"https://www.ebay.com/itm/competitor-1","imageUrl":"","mallName":"eBay","marketplace":"ebay","price":12.5,"currency":"USD","matcherVersion":"strict-2026-08-28-v2"}]'::jsonb
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
    await setClaims(db, "service_role");
    await db.query(
      "update sellerpilot_private.products set competitor_checked_at = null where id = $1",
      [aiProductId],
    );
    const firstCompetitorClaims = await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    );
    assert.equal(firstCompetitorClaims.rows.length, 1);
    assert.equal(firstCompetitorClaims.rows[0].product_id, aiProductId);
    assert.match(firstCompetitorClaims.rows[0].claim_token, /^[0-9a-f-]{36}$/i);
    const competitorClaimToken = firstCompetitorClaims.rows[0].claim_token;
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)")).rows.length,
      0,
    );

    const competitorGatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 570g', '[\"Kellogg Choco Chex 570g\"]'::jsonb, 30, $2, $3)",
      [elevenstCredentialId, aiProductId, competitorClaimToken],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 570g', '[\"Kellogg Choco Chex 570g\"]'::jsonb, 30, $2, $3)",
        [elevenstCredentialId, aiProductId, competitorClaimToken],
      ),
      competitorGatewayJobId,
    );
    const linkedCompetitorGateway = (await db.query(
      "select gateway_job_id, gateway_periodic_key from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
      [aiProductId],
    )).rows[0];
    assert.equal(linkedCompetitorGateway.gateway_job_id, competitorGatewayJobId);
    assert.match(linkedCompetitorGateway.gateway_periodic_key, /^competitor:v1:[0-9a-f]{64}$/);
    await assert.rejects(
      db.query(
        "update sellerpilot_private.competitor_price_refresh_claims set gateway_periodic_key = null where product_id = $1",
        [aiProductId],
      ),
      /competitor_price_refresh_claims_gateway_check/,
    );
    await assert.rejects(
      db.query(
        "update sellerpilot_private.competitor_price_refresh_claims set gateway_periodic_key = 'malformed-key' where product_id = $1",
        [aiProductId],
      ),
      /competitor_price_refresh_claims_gateway_check/,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs where credential_id = $1 and operation = 'competitor.search' and request_payload->>'periodicKey' is not null",
        [elevenstCredentialId],
      ),
      1,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"channel":"elevenst","operation":"competitor.search","items":[]}'::jsonb,
              completed_at = now(),
              updated_at = now()
        where id = $1`,
      [competitorGatewayJobId],
    );
    await db.query(
      "update sellerpilot_private.competitor_price_refresh_claims set claimed_at = now() - interval '91 seconds', lease_expires_at = now() - interval '1 second' where product_id = $1",
      [aiProductId],
    );
    const resumedCompetitorClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(resumedCompetitorClaim.product_id, aiProductId);
    assert.notEqual(resumedCompetitorClaim.claim_token, competitorClaimToken);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 570g', '[\"Kellogg Choco Chex 570g\"]'::jsonb, 30, $2, $3)",
        [elevenstCredentialId, aiProductId, competitorClaimToken],
      ),
      /active competitor refresh claim required/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 570g', '[\"Kellogg Choco Chex 570g\"]'::jsonb, 30, $2, $3)",
        [elevenstCredentialId, aiProductId, resumedCompetitorClaim.claim_token],
      ),
      competitorGatewayJobId,
    );
    const differentCompetitorJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 570g 1+1', '[\"Kellogg Choco Chex 570g twin pack\"]'::jsonb, 30)",
      [elevenstCredentialId],
    );
    assert.notEqual(differentCompetitorJobId, competitorGatewayJobId);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [differentCompetitorJobId],
    );
    const staleCompetitorJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 오래된 응답 검증', '[]'::jsonb, 30)",
      [elevenstCredentialId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"channel":"elevenst","operation":"competitor.search","items":[]}'::jsonb,
              completed_at = now() - interval '31 minutes',
              updated_at = now()
        where id = $1`,
      [staleCompetitorJobId],
    );
    const afterStaleCompetitorJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 오래된 응답 검증', '[]'::jsonb, 30)",
      [elevenstCredentialId],
    );
    assert.notEqual(afterStaleCompetitorJobId, staleCompetitorJobId);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"channel":"elevenst","operation":"competitor.search"}'::jsonb,
              completed_at = now(),
              updated_at = now()
        where id = $1`,
      [afterStaleCompetitorJobId],
    );
    const afterMalformedCompetitorJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 오래된 응답 검증', '[]'::jsonb, 30)",
      [elevenstCredentialId],
    );
    assert.notEqual(afterMalformedCompetitorJobId, afterStaleCompetitorJobId);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [afterMalformedCompetitorJobId],
    );

    await db.query(
      `insert into sellerpilot_private.competitor_price_observations (
         product_id, provider, external_id, title, product_url, image_url,
         mall_name, marketplace, price, currency, checked_at
       ) values
         ($1, 'elevenst_product_search', 'obsolete-elevenst', '이전 11번가 결과',
          'https://www.11st.co.kr/products/111', null, '11번가', 'elevenst', 8900, 'KRW', now() - interval '1 day'),
         ($1, 'elevenst_product_search', 'legacy-elevenst-strawberry', '첵스초코 딸기맛 350g',
          'https://www.11st.co.kr/products/legacy-strawberry', null, '11번가', 'elevenst', 6900, 'KRW', now() - interval '1 hour'),
         ($1, 'elevenst_product_search', 'legacy-elevenst-cup', '첵스초코 컵 40g',
          'https://www.11st.co.kr/products/legacy-cup', null, '11번가', 'elevenst', 1900, 'KRW', now() - interval '1 hour'),
         ($1, 'elevenst_product_search', 'legacy-elevenst-mixed', '첵스초코 혼합 2종 세트',
          'https://www.11st.co.kr/products/legacy-mixed', null, '11번가', 'elevenst', 12900, 'KRW', now() - interval '1 hour'),
         ($1, 'ebay_browse', 'obsolete-ebay', '오래된 eBay 결과',
          'https://www.ebay.com/itm/obsolete-ebay', null, 'eBay', 'ebay', 14, 'USD', now() - interval '8 days'),
         ($1, 'ebay_browse', 'legacy-ebay-fresh', 'Legacy automatic eBay candidate',
          'https://www.ebay.com/itm/legacy-ebay-fresh', null, 'eBay', 'ebay', 13, 'USD', now() - interval '1 hour'),
         ($1, 'manual', 'manual-reference', '수동 기준 가격',
          'https://manual.example.test/products/reference', null, '수동 확인', 'other', 12345, 'KRW', now() - interval '30 days')`,
      [aiProductId],
    );

    await setClaims(db);
    const matcherFencedOperations = await scalar(
      db,
      "select public.sellerpilot_get_product_operations_v2($1)",
      [aiProductId],
    );
    assert.equal(matcherFencedOperations.competitorPrices.some((item) => item.title === "수동 기준 가격"), true);
    assert.equal(matcherFencedOperations.competitorPrices.some((item) => item.title === "첵스초코 딸기맛 350g"), false);
    assert.equal(matcherFencedOperations.competitorPrices.some((item) => item.title === "첵스초코 컵 40g"), false);
    assert.equal(matcherFencedOperations.competitorPrices.some((item) => item.title === "첵스초코 혼합 2종 세트"), false);
    assert.equal(matcherFencedOperations.competitorPrices.some((item) => item.title === "Legacy automatic eBay candidate"), false);
    await setClaims(db, "service_role");

    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_record_competitor_prices($1, null::jsonb)",
        [aiProductId],
      ),
      /invalid competitor prices/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_record_competitor_prices(
          $1,
          '[{"provider":"elevenst_product_search","externalId":"unversioned-result","title":"Unversioned automatic result","url":"https://www.11st.co.kr/products/unversioned-result","mallName":"11번가","marketplace":"elevenst","price":7900,"currency":"KRW"}]'::jsonb
        )`,
        [aiProductId],
      ),
      /invalid competitor matcher version/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_record_competitor_prices(
          $1,
          '[{"provider":"ebay_browse","externalId":"future-matcher","title":"Kellogg Choco Chex 570g","url":"https://www.ebay.com/itm/future-matcher","mallName":"eBay","marketplace":"ebay","price":12,"currency":"USD","matcherVersion":"strict-unknown"}]'::jsonb
        )`,
        [aiProductId],
      ),
      /invalid competitor matcher version/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, null::jsonb,
          '[{"provider":"elevenst_product_search","status":"searched","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, '[]'::jsonb, null::jsonb)",
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, '[]'::jsonb, '[]'::jsonb)",
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"pending","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"failed","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"searched","count":1,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"searched","count":0,"marketplaces":["elevenst"]},{"provider":"elevenst_product_search","status":"failed","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2,
          '[{"provider":"brave_marketplace_web","externalId":"unsearched-item","title":"Kellogg Choco Chex 570g","url":"https://www.temu.com/kellogg-choco-chex-g-601099999999998.html","imageUrl":"","mallName":"Temu","marketplace":"temu","price":11.5,"currency":"USD"}]'::jsonb,
          '[{"provider":"brave_marketplace_web","status":"failed","count":0,"marketplaces":["shopee","lazada","temu"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      /invalid competitor refresh snapshot/,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_refresh_claims where product_id = $1 and claim_token = $2",
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      1,
    );

    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2,
          '[{"provider":"elevenst_product_search","externalId":"durable-competitor-1","title":"첵스초코 570g","url":"https://www.11st.co.kr/products/123","imageUrl":"","mallName":"11번가","marketplace":"elevenst","price":7900,"currency":"KRW","matcherVersion":"strict-2026-08-28-v2"},{"provider":"brave_marketplace_web","externalId":"www.temu.com:601099999999999","title":"Kellogg Choco Chex 570g","url":"https://www.temu.com/kellogg-choco-chex-g-601099999999999.html","imageUrl":"","mallName":"Temu","marketplace":"temu","price":11.5,"currency":"USD","matcherVersion":"strict-2026-08-28-v2"}]'::jsonb,
          '[{"provider":"naver_shopping","status":"unavailable","count":0,"marketplaces":["smartstore"]},{"provider":"elevenst_product_search","status":"searched","count":1,"marketplaces":["elevenst"]},{"provider":"ebay_browse","status":"failed","count":0,"marketplaces":["ebay"]},{"provider":"brave_marketplace_web","status":"searched","count":1,"marketplaces":["shopee","lazada","temu"]}]'::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token],
      ),
      2,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id = $1 and external_id in ('obsolete-elevenst', 'obsolete-ebay')",
        [aiProductId],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id = $1 and external_id = 'manual-reference'",
        [aiProductId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id = $1 and external_id = 'legacy-ebay-fresh' and matcher_version is null",
        [aiProductId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id = $1 and matcher_version = 'strict-2026-08-28-v2' and external_id in ('durable-competitor-1', 'www.temu.com:601099999999999')",
        [aiProductId],
      ),
      2,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.competitor_price_refresh_claims where product_id = $1 and claim_token is not null", [aiProductId]),
      0,
    );
    assert.deepEqual(
      (await db.query(
        "select gateway_job_id, gateway_periodic_key from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
        [aiProductId],
      )).rows[0],
      { gateway_job_id: null, gateway_periodic_key: null },
    );
    assert.equal(
      await scalar(db, "select last_attempted_at is not null from sellerpilot_private.competitor_price_refresh_claims where product_id = $1", [aiProductId]),
      true,
    );
    assert.equal(
      await scalar(db, "select competitor_checked_at is not null from sellerpilot_private.products where id = $1", [aiProductId]),
      true,
    );
    await setClaims(db);
    const freshCompetitorOperations = await scalar(
      db,
      "select public.sellerpilot_get_product_operations_v2($1)",
      [aiProductId],
    );
    assert.equal(freshCompetitorOperations.competitorPrices.some((item) => item.title === "수동 기준 가격"), true);
    assert.equal(freshCompetitorOperations.competitorPrices.some((item) => item.title === "Kellogg Choco Chex 570g"), true);
    assert.equal(freshCompetitorOperations.competitorPrices.some((item) => item.title === "오래된 eBay 결과"), false);
    assert.equal(freshCompetitorOperations.competitorPrices.some((item) => item.title === "Legacy automatic eBay candidate"), false);
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"searched","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, competitorClaimToken],
      ),
      -1,
    );

    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const retentionCompetitorClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    const retentionGatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, '첵스초코 보존 정리', '[]'::jsonb, 30, $2, $3)",
      [elevenstCredentialId, aiProductId, retentionCompetitorClaim.claim_token],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"channel":"elevenst","operation":"competitor.search","items":[]}'::jsonb,
              completed_at = now() - interval '31 days',
              updated_at = now() - interval '31 days'
        where id = $1`,
      [retentionGatewayJobId],
    );
    await db.query("delete from sellerpilot_private.channel_gateway_jobs where id = $1", [retentionGatewayJobId]);
    const retainedRefreshLink = (await db.query(
      "select gateway_job_id, gateway_periodic_key from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
      [aiProductId],
    )).rows[0];
    assert.equal(retainedRefreshLink.gateway_job_id, null);
    assert.match(retainedRefreshLink.gateway_periodic_key, /^competitor:v1:[0-9a-f]{64}$/);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_competitor_price_refresh($1, $2)",
        [aiProductId, retentionCompetitorClaim.claim_token],
      ),
      true,
    );

    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const fairnessProductId = await scalar(
      db,
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, description, status, on_hand, reserved,
         reorder_point, cost_krw, demo, competitor_monitor_enabled, competitor_checked_at
       ) values (
         $1, 'COMPETITOR-FAIRNESS-001', 'COMPETITOR-FAIRNESS-001', '경쟁가 공정성 테스트 상품',
         '실패한 첫 상품 뒤의 다음 상품도 선택되는지 검증합니다.', 'draft', 1, 0, 0, 1,
         false, true, null
       ) returning id`,
      [ADMIN_ID],
    );
    const fairCompetitorClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(fairCompetitorClaim.product_id, fairnessProductId);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_competitor_price_refresh($1, $2)",
        [fairnessProductId, fairCompetitorClaim.claim_token],
      ),
      true,
    );
    await db.query("delete from sellerpilot_private.products where id = $1", [fairnessProductId]);

    const expiringCompetitorClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 30)",
    )).rows[0];
    await db.query(
      "update sellerpilot_private.competitor_price_refresh_claims set claimed_at = now() - interval '31 seconds', lease_expires_at = now() - interval '1 second' where product_id = $1",
      [aiProductId],
    );
    const reclaimedCompetitorClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(reclaimedCompetitorClaim.product_id, aiProductId);
    assert.notEqual(reclaimedCompetitorClaim.claim_token, expiringCompetitorClaim.claim_token);
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"searched","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, expiringCompetitorClaim.claim_token],
      ),
      -1,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_competitor_price_refresh($1, $2)",
        [aiProductId, expiringCompetitorClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"elevenst_product_search","status":"searched","count":0,"marketplaces":["elevenst"]}]'::jsonb
        )`,
        [aiProductId, reclaimedCompetitorClaim.claim_token],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_release_competitor_price_refresh($1, $2)",
        [aiProductId, reclaimedCompetitorClaim.claim_token],
      ),
      false,
    );
    await setClaims(db);
    const elevenstAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'elevenst', 'listing.create', 'elevenst-listing-migration-0001', $2)",
      [elevenstCredentialId, "e".repeat(64)],
    );
    await setClaims(db, "service_role");
    const elevenstGatewayEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
        $1, $2, $3, 'elevenst', '', '', 'KRW', 5000, $4,
        '{"arguments":{"verificationOnly":true}}'::jsonb
      )`,
      [aiProductId, elevenstCredentialId, elevenstAttempt.attempt_id, "e".repeat(64)],
    );
    const elevenstPreparedListingId = elevenstGatewayEnqueue.listing_id;
    assert.match(elevenstPreparedListingId, /^[0-9a-f-]{36}$/i);
    const elevenstGatewayJobId = elevenstGatewayEnqueue.job_id;
    assert.equal(elevenstGatewayEnqueue.status, "queued");
    assert.equal(elevenstGatewayEnqueue.reused, false);
    assert.match(elevenstGatewayJobId, /^[0-9a-f-]{36}$/i);
    await setClaims(db);
    const preparedRegistrationActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(20)");
    const preparedRegistrationCard = preparedRegistrationActivity.find((activity) => activity.productId === aiProductId);
    assert.equal(preparedRegistrationCard.status, "publishing");
    assert.equal(preparedRegistrationCard.completedAt, null);
    assert.equal(preparedRegistrationCard.channels[0].status, "queued");
    await setClaims(db, "service_role");
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
    const detailPageV1 = {
      root: { props: { title: "AI 생성 테스트 상품 상세" } },
      content: [
        {
          type: "HeroBlock",
          props: {
            id: "hero-1",
            title: "검증된 상세페이지",
            imageUrl: "sellerpilot-asset://hero",
          },
        },
        {
          type: "VerificationRibbonBlock",
          props: {
            id: "verification-1",
            classification: "일반식품",
            verificationStatus: "verified",
            evidence: "판매자 제공 상품 라벨",
          },
        },
        {
          type: "CtaBlock",
          props: { id: "cta-1", title: "지금 확인하세요" },
        },
      ],
    };
    const savedDetailV1 = await scalar(
      db,
      "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, null)",
      [aiProductId, JSON.stringify(detailPageV1)],
    );
    assert.equal(savedDetailV1.version, 1);
    assert.deepEqual(savedDetailV1.data, detailPageV1);
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [aiProductId]),
      savedDetailV1,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 0)",
        [aiProductId, JSON.stringify(detailPageV1)],
      ),
      /DETAIL_PAGE_VERSION_CONFLICT/,
    );
    const detailPageV2 = {
      ...detailPageV1,
      content: detailPageV1.content.map((block) => (
        block.type === "CtaBlock"
          ? { ...block, props: { ...block.props, title: "수정된 CTA" } }
          : block
      )),
    };
    const savedDetailV2 = await scalar(
      db,
      "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 1)",
      [aiProductId, JSON.stringify(detailPageV2)],
    );
    assert.equal(savedDetailV2.version, 2);
    const animatedGifBlock = {
      type: "AnimatedGifBlock",
      props: {
        id: "gif-1",
        gifUrl: "https://media.example.com/product-motion.gif",
        posterUrl: "https://media.example.com/product-motion.webp",
        alt: "상품 사용 장면 애니메이션",
        caption: "상품의 움직임을 짧게 보여주는 보조 이미지",
        tone: "light",
      },
    };
    const detailPageWithGif = {
      ...detailPageV2,
      content: [...detailPageV2.content, animatedGifBlock],
    };
    await db.exec("begin");
    try {
      const savedDetailWithGif = await scalar(
        db,
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
        [aiProductId, JSON.stringify(detailPageWithGif)],
      );
      assert.equal(savedDetailWithGif.version, 3);
      assert.deepEqual(savedDetailWithGif.data, detailPageWithGif);
      assert.deepEqual(
        await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [aiProductId]),
        savedDetailWithGif,
      );
    } finally {
      await db.exec("rollback");
    }
    const invalidGifBlocks = [
      {
        ...animatedGifBlock,
        props: { ...animatedGifBlock.props, gifUrl: "https://localhost/private.gif" },
      },
      {
        ...animatedGifBlock,
        props: { ...animatedGifBlock.props, gifUrl: "https://127.1/private.gif" },
      },
      {
        ...animatedGifBlock,
        props: { ...animatedGifBlock.props, gifUrl: "https://0x7f.1/private.gif" },
      },
      {
        ...animatedGifBlock,
        props: { ...animatedGifBlock.props, gifUrl: "https://media.example.com/download?format=.gif" },
      },
      {
        ...animatedGifBlock,
        props: { ...animatedGifBlock.props, gifUrl: "https://media.example.com/download#.gif" },
      },
      {
        ...animatedGifBlock,
        props: { ...animatedGifBlock.props, id: 123, alt: 123, caption: true },
      },
    ];
    for (const invalidGifBlock of invalidGifBlocks) {
      await db.exec("begin");
      try {
        await assert.rejects(
          db.query(
            "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
            [aiProductId, JSON.stringify({
              ...detailPageV2,
              content: [...detailPageV2.content, invalidGifBlock],
            })],
          ),
          /DETAIL_PAGE_INVALID/,
        );
      } finally {
        await db.exec("rollback");
      }
    }
    await assert.rejects(
      db.query(
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
        [aiProductId, JSON.stringify({ root: {}, content: [{ type: "ScriptBlock", props: { id: "unsafe" } }] })],
      ),
      /DETAIL_PAGE_INVALID/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
        [aiProductId, JSON.stringify({
          root: {},
          content: Array.from({ length: 65 }, (_, index) => ({
            type: "StoryBlock",
            props: { id: `story-${index}` },
          })),
        })],
      ),
      /DETAIL_PAGE_INVALID/,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
        [aiProductId, JSON.stringify({
          root: { oversized: "x".repeat(262144) },
          content: [],
        })],
      ),
      /DETAIL_PAGE_INVALID/,
    );
    const detailAudit = (
      await db.query(
        `select safe_detail
           from sellerpilot_private.operation_audit
          where action = 'product_detail_page_saved' and entity_id = $1
          order by occurred_at desc
          limit 1`,
        [aiProductId],
      )
    ).rows[0].safe_detail;
    assert.deepEqual(Object.keys(detailAudit).sort(), ["block_count", "document_bytes", "version"]);
    assert.equal(detailAudit.version, 2);
    assert.equal(JSON.stringify(detailAudit).includes("수정된 CTA"), false);

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set created_by = $2 where id = $1",
      [JOB_ID, SECOND_ADMIN_ID],
    );
    const mismatchedClassificationContext = await scalar(
      db,
      "select public.sellerpilot_get_product_publish_context($1)",
      [aiProductId],
    );
    assert.equal(mismatchedClassificationContext.classification, null);
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set created_by = $2 where id = $1",
      [JOB_ID, ADMIN_ID],
    );
    const publishContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [aiProductId]);
    assert.equal(publishContext.product.id, aiProductId);
    assert.equal(publishContext.manualFields.sellerSku, "AI-REQUIRED-001");
    assert.equal(publishContext.imageSpecs[0].width, 1200);
    assert.equal(publishContext.assignments.length, 2);
    assert.equal(publishContext.assignments.some((assignment) => assignment.channel === "elevenst" && assignment.categoryId === "1341821"), true);
    assert.deepEqual(publishContext.detailPage.data, detailPageV2);
    assert.equal(publishContext.detailPage.version, 2);
    assert.deepEqual(publishContext.classification, resultPayload.product.classification);
    assert.deepEqual(Object.keys(publishContext.studioResult).sort(), ["design", "mode", "product", "thumbnail", "warnings"]);
    assert.equal(publishContext.studioResult.mode, "cli");
    assert.equal("asset_storage_paths" in publishContext.studioResult, false);
    assert.equal("localizedListings" in publishContext.studioResult, false);
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
    const listingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.create', 'listing-ai-product-coupang-0001', $2)",
      [coupangCredentialId, "c".repeat(64)],
    );
    await setClaims(db, "service_role");
    const listingGatewayEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
        $1, $2, $3, 'coupang', '', '', 'KRW', 25000, $4, '{}'::jsonb
      )`,
      [aiProductId, coupangCredentialId, listingAttempt.attempt_id, "c".repeat(64)],
    );
    const preparedListingId = listingGatewayEnqueue.listing_id;
    assert.match(preparedListingId, /^[0-9a-f-]{36}$/i);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = $2::jsonb,
              completed_at = now()
        where id = $1`,
      [listingGatewayEnqueue.job_id, JSON.stringify({
        ok: true,
        channel: "coupang",
        operation: "listing.create",
        remoteId: "remote-product-1",
        safeMessage: "listing completed",
        steps: [{ name: "listing-readback", ok: true, status: 200, data: {} }],
      })],
    );
    await db.query(
      "update sellerpilot_private.channel_operation_attempts set status='succeeded', http_status=200, remote_id='remote-product-1', safe_message='listing completed', completed_at=now() where id=$1",
      [listingAttempt.attempt_id],
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
    const productCountBeforeRevision = await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.products where owner_id = $1",
      [ADMIN_ID],
    );
    const gatewayCountBeforeRevision = await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs",
    );
    const listingBeforeRevision = (await db.query(
      "select id, product_id, remote_id, marketplace_sku from sellerpilot_private.product_listings where id = $1",
      [preparedListingId],
    )).rows[0];
    const revisionManualFields = {
      ...editedManualFields,
      productName: "AI 생성 테스트 상품 사진 리비전",
      packageContents: "상품 1개",
      stock: 0,
    };
    const revisionPayload = {
      description: revisionManualFields.description,
      product_url: revisionManualFields.productUrl,
      research_input: revisionManualFields.researchInput,
      manual_fields: revisionManualFields,
      image_paths: [`${ADMIN_ID}/${PRODUCT_REVISION_JOB_ID}/input/001.jpg`],
      image_specs: [{
        name: "replacement-main.jpg",
        role: "main",
        originalWidth: 1800,
        originalHeight: 1800,
        width: 1200,
        height: 1200,
        bytes: 120000,
        mediaType: "image/jpeg",
        fit: "contain",
      }],
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify(revisionPayload)],
      ),
      PRODUCT_REVISION_JOB_ID,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify(revisionPayload)],
      ),
      PRODUCT_REVISION_JOB_ID,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_cli_jobs where id = $1", [PRODUCT_REVISION_JOB_ID]),
      1,
    );
    assert.equal(
      await scalar(db, "select ai_job_id from sellerpilot_private.products where id = $1", [aiProductId]),
      JOB_ID,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.products where owner_id = $1", [ADMIN_ID]),
      productCountBeforeRevision,
    );
    const pendingRevisionActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(300)");
    const pendingRevisionCard = pendingRevisionActivity.find((activity) => activity.id === `revision:${PRODUCT_REVISION_JOB_ID}`);
    assert.equal(pendingRevisionCard?.status, "analyzing");
    assert.equal(pendingRevisionCard?.productId, aiProductId);
    assert.match(pendingRevisionCard?.message ?? "", /외부 판매채널에는 자동 게시하지 않습니다/);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [NEXT_PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify({
          ...revisionPayload,
          image_paths: [`${ADMIN_ID}/${NEXT_PRODUCT_REVISION_JOB_ID}/input/001.jpg`],
        })],
      ),
      /PRODUCT_REVISION_ALREADY_PENDING/,
    );

    const revisionResult = {
      ...resultPayload,
      product: { ...resultPayload.product, name: revisionManualFields.productName },
      asset_storage_paths: aiClaimAssetPaths(PRODUCT_REVISION_JOB_ID, "784346eb-2788-4783-97da-451344fed051"),
    };
    // An accepted inventory write changes on_hand, product_facts.stock and
    // updated_at after the photo revision is queued. It must not look like a
    // conflicting text/detail edit or cause the safe revision fence to fail.
    await db.query(
      "update sellerpilot_private.products set on_hand = 3, updated_at = updated_at + interval '1 second' where id = $1",
      [aiProductId],
    );
    // An exact replay stays idempotent even when a safe inventory write has
    // advanced product.updated_at since the original revision was accepted.
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify(revisionPayload)],
      ),
      PRODUCT_REVISION_JOB_ID,
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, created_by, status, error_message, completed_at
       ) values ($1, 'product_research', '{}'::jsonb, $2, 'failed', 'test-only failure', now())`,
      [PRIVATE_RESEARCH_RETRY_JOB_ID, ADMIN_ID],
    );
    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    const nextRevisionPayload = {
      ...revisionPayload,
      image_paths: [`${SECOND_ADMIN_ID}/${NEXT_PRODUCT_REVISION_JOB_ID}/input/001.jpg`],
    };
    const completionAndNextRevision = await Promise.allSettled([
      db.query(
        "update sellerpilot_private.ai_cli_jobs set status = 'succeeded', result_payload = $2::jsonb, completed_at = now() where id = $1",
        [PRODUCT_REVISION_JOB_ID, JSON.stringify(revisionResult)],
      ),
      db.query(
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [NEXT_PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify(nextRevisionPayload)],
      ),
    ]);
    assert.equal(completionAndNextRevision[0].status, "fulfilled");
    if (completionAndNextRevision[1].status === "rejected") {
      assert.match(String(completionAndNextRevision[1].reason), /PRODUCT_REVISION_ALREADY_PENDING/);
      assert.equal(
        await scalar(
          db,
          "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
          [NEXT_PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify(nextRevisionPayload)],
        ),
        NEXT_PRODUCT_REVISION_JOB_ID,
      );
    }
    const sharedStudioJob = await scalar(
      db,
      "select public.sellerpilot_get_ai_job($1)",
      [PRODUCT_REVISION_JOB_ID],
    );
    assert.equal(sharedStudioJob.id, PRODUCT_REVISION_JOB_ID);
    assert.equal(sharedStudioJob.kind, "product_studio");
    assert.equal("request_payload" in sharedStudioJob, false);
    assert.equal(
      await scalar(db, "select public.sellerpilot_get_ai_job($1)", [PRIVATE_RESEARCH_RETRY_JOB_ID]),
      null,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [PRIVATE_RESEARCH_RETRY_JOB_ID]),
      false,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_create_product_from_ai_v2($1)",
        [PRIVATE_RESEARCH_RETRY_JOB_ID],
      ),
      /AI_PRODUCT_STUDIO_JOB_NOT_FOUND/,
    );
    await setClaims(db, "authenticated", NON_ADMIN_ID);
    await assert.rejects(
      db.query("select public.sellerpilot_get_ai_job($1)", [PRODUCT_REVISION_JOB_ID]),
      /administrator access required/,
    );
    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    await db.query(
      "delete from sellerpilot_private.ai_cli_jobs where id = $1",
      [PRIVATE_RESEARCH_RETRY_JOB_ID],
    );
    assert.deepEqual(
      (await db.query(
        "select id, product_id, remote_id, marketplace_sku from sellerpilot_private.product_listings where id = $1",
        [preparedListingId],
      )).rows[0],
      listingBeforeRevision,
    );
    assert.deepEqual(
      (await db.query(
        "select id, ai_job_id, name, on_hand, (product_facts->>'stock')::integer as facts_stock, detail_page_data, detail_page_version from sellerpilot_private.products where id = $1",
        [aiProductId],
      )).rows[0],
      {
        id: aiProductId,
        ai_job_id: PRODUCT_REVISION_JOB_ID,
        name: revisionManualFields.productName,
        on_hand: 3,
        facts_stock: 3,
        detail_page_data: null,
        detail_page_version: 0,
      },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.products where owner_id = $1", [ADMIN_ID]),
      productCountBeforeRevision,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"),
      gatewayCountBeforeRevision,
    );
    const appliedRevisionState = await scalar(
      db,
      "select public.sellerpilot_get_product_revision_state($1, $2)",
      [aiProductId, PRODUCT_REVISION_JOB_ID],
    );
    assert.equal(appliedRevisionState.jobId, PRODUCT_REVISION_JOB_ID);
    assert.equal(appliedRevisionState.productId, aiProductId);
    assert.equal(appliedRevisionState.status, "applied");
    assert.equal(appliedRevisionState.autoPublish, false);
    assert.equal(appliedRevisionState.remoteSkuOrOptionMutation, false);
    const appliedRevisionActivity = await scalar(db, "select public.sellerpilot_list_registration_activity(300)");
    const appliedRevisionCard = appliedRevisionActivity.find((activity) => activity.id === `revision:${PRODUCT_REVISION_JOB_ID}`);
    assert.equal(appliedRevisionCard?.status, "completed");
    assert.match(appliedRevisionCard?.message ?? "", /판매채널 이미지·옵션·SKU는 자동 변경하지 않았습니다/);
    assert.equal(
      await scalar(db, "select public.sellerpilot_create_product_from_ai_v2($1)", [JOB_ID]),
      aiProductId,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_create_product_from_ai_v2($1)", [PRODUCT_REVISION_JOB_ID]),
      aiProductId,
    );
    assert.deepEqual(
      (await db.query(
        "select previous_detail_page_data, previous_detail_page_version, retain_previous_assets_until > now() + interval '29 days' as retained from sellerpilot_private.product_ai_revisions where job_id = $1",
        [PRODUCT_REVISION_JOB_ID],
      )).rows[0],
      { previous_detail_page_data: detailPageV2, previous_detail_page_version: 2, retained: true },
    );
    assert.ok(Number(await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.ai_storage_cleanup_queue where last_error = 'superseded_product_revision_retention' and available_at > now() + interval '29 days'",
    )) >= 9);
    assert.equal(
      await scalar(
        db,
        "select (safe_detail->>'auto_publish')::boolean from sellerpilot_private.operation_audit where action = 'product_revision_applied' and entity_id = $1 order by occurred_at desc limit 1",
        [aiProductId],
      ),
      false,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [NEXT_PRODUCT_REVISION_JOB_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_job_completion_receipts (
         job_id, worker_token_id, claim_token, status, completion_fingerprint
       ) select $1, token.id, gen_random_uuid(), 'failed', $3
           from sellerpilot_private.ai_cli_worker_tokens token
          where token.token_hash = $2`,
      [NEXT_PRODUCT_REVISION_JOB_ID, TOKEN_HASH, "a".repeat(64)],
    );
    await setClaims(db);
    assert.equal(
      await scalar(db, "select public.sellerpilot_retry_ai_job($1)", [NEXT_PRODUCT_REVISION_JOB_ID]),
      true,
    );
    assert.deepEqual(
      (await db.query(
        "select status, attempt_count, preparation_failure_count, claim_token from sellerpilot_private.ai_cli_jobs where id = $1",
        [NEXT_PRODUCT_REVISION_JOB_ID],
      )).rows[0],
      { status: "queued", attempt_count: 0, preparation_failure_count: 0, claim_token: null },
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.ai_job_completion_receipts where job_id = $1", [NEXT_PRODUCT_REVISION_JOB_ID]),
      0,
    );
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.product_ai_revisions where job_id = $1", [NEXT_PRODUCT_REVISION_JOB_ID]),
      "pending",
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [NEXT_PRODUCT_REVISION_JOB_ID],
    );

    const staleRevisionPayload = {
      ...revisionPayload,
      image_paths: [`${ADMIN_ID}/${STALE_PRODUCT_REVISION_JOB_ID}/input/001.jpg`],
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [STALE_PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify(staleRevisionPayload)],
      ),
      STALE_PRODUCT_REVISION_JOB_ID,
    );
    const laterManualEdit = {
      ...revisionManualFields,
      productName: "리비전 접수 후 별도 저장한 상품명",
      description: "사진 리비전이 진행되는 동안 별도로 저장한 최신 상품 설명을 덮어쓰지 않는지 확인합니다.",
      stock: 2,
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_update_product_details($1, $2::jsonb)",
        [aiProductId, JSON.stringify(laterManualEdit)],
      ),
      true,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set status = 'succeeded', result_payload = $2::jsonb, completed_at = now() where id = $1",
      [STALE_PRODUCT_REVISION_JOB_ID, JSON.stringify({
        ...revisionResult,
        asset_storage_paths: aiClaimAssetPaths(STALE_PRODUCT_REVISION_JOB_ID, "a19ae9d1-a544-4a12-96fd-b89501a03f89"),
      })],
    );
    assert.deepEqual(
      (await db.query(
        "select name, ai_job_id from sellerpilot_private.products where id = $1",
        [aiProductId],
      )).rows[0],
      { name: laterManualEdit.productName, ai_job_id: PRODUCT_REVISION_JOB_ID },
    );
    assert.deepEqual(
      (await db.query(
        "select status, failure_reason is not null as has_reason from sellerpilot_private.product_ai_revisions where job_id = $1",
        [STALE_PRODUCT_REVISION_JOB_ID],
      )).rows[0],
      { status: "failed", has_reason: true },
    );

    const abandonedPaths = [`${ADMIN_ID}/${ABANDONED_PRODUCT_REVISION_JOB_ID}/input/001.jpg`];
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_abandon_uncreated_product_revision_job($1, $2, $3::jsonb)",
        [aiProductId, ABANDONED_PRODUCT_REVISION_JOB_ID, JSON.stringify(abandonedPaths)],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.ai_storage_cleanup_queue where object_path = $1 and last_error = 'unconfirmed_product_revision_upload'",
        [abandonedPaths[0]],
      ),
      1,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_create_product_revision_job($1, $2, $3::jsonb)",
        [ABANDONED_PRODUCT_REVISION_JOB_ID, aiProductId, JSON.stringify({
          ...revisionPayload,
          image_paths: abandonedPaths,
        })],
      ),
      /PRODUCT_REVISION_JOB_ABANDONED/,
    );
    await setClaims(db);
    const otherCoupangCredentialId = await scalar(
      db,
      "select public.sellerpilot_rotate_credential('coupang', 'sandbox', $1::jsonb, now() + interval '180 days', 90, 30, 0)",
      [JSON.stringify({ key: "other-coupang-test-key" })],
    );
    await setClaims(db, "service_role");
    await scalar(
      db,
      "select public.sellerpilot_enqueue_channel_gateway_job($1, null, 'coupang', 'diagnostic.test', '{}'::jsonb)",
      [otherCoupangCredentialId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_validate_listing_write_lineage($1,$2,$3,'coupang','listing.update','','')",
        [preparedListingId, otherCoupangCredentialId, aiProductId],
      ),
      "seller_account_mismatch",
    );
    await setClaims(db);
    const crossAccountAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.update', 'listing-ai-product-coupang-cross-account-0001', $2)",
      [otherCoupangCredentialId, "7".repeat(64)],
    );
    await setClaims(db, "service_role");
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.update', '{}'::jsonb)",
        [preparedListingId, otherCoupangCredentialId, crossAccountAttempt.attempt_id],
      ),
      /product listing seller account mismatch|gateway listing seller account mismatch/,
    );
    await setClaims(db);
    const updatePreparedListingId = preparedListingId;
    const failedUpdateAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.update', 'listing-ai-product-coupang-update-failure-0001', $2)",
      [coupangCredentialId, "f".repeat(64)],
    );
    await setClaims(db, "service_role");
    const failedUpdateGatewayEnqueue = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.update', '{}'::jsonb)",
      [updatePreparedListingId, coupangCredentialId, failedUpdateAttempt.attempt_id],
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='failed', error_message='one channel failed', completed_at=now() where id=$1",
      [failedUpdateGatewayEnqueue.job_id],
    );
    await db.query(
      "update sellerpilot_private.channel_operation_attempts set status='failed', http_status=422, safe_message='one channel failed', completed_at=now() where id=$1",
      [failedUpdateAttempt.attempt_id],
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
    await setClaims(db);
    const stopListingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.stop', 'listing-ai-product-coupang-stop-0001', $2)",
      [coupangCredentialId, "9".repeat(64)],
    );
    await setClaims(db, "service_role");
    const stopListingGatewayEnqueue = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.stop', '{}'::jsonb)",
      [preparedListingId, coupangCredentialId, stopListingAttempt.attempt_id],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',
              response_payload=$2::jsonb,
              completed_at=now()
        where id=$1`,
      [stopListingGatewayEnqueue.job_id, JSON.stringify({
        ok: true,
        channel: "coupang",
        operation: "listing.stop",
        remoteId: "remote-product-1",
        safeMessage: "listing stopped",
        steps: [{ name: "listing.stop", ok: true, status: 200, data: {} }],
      })],
    );
    await db.query(
      "update sellerpilot_private.channel_operation_attempts set status='succeeded', http_status=200, remote_id='remote-product-1', safe_message='listing stopped', completed_at=now() where id=$1",
      [stopListingAttempt.attempt_id],
    );
    await db.query(
      "update sellerpilot_private.product_listings set status='paused', failure_class=null, last_error=null, updated_at=now() where id=$1",
      [preparedListingId],
    );
    await setClaims(db);
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
    await setClaims(db);
    const resumeListingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'coupang', 'listing.update', 'listing-ai-product-coupang-resume-0001', $2)",
      [coupangCredentialId, "8".repeat(64)],
    );
    await setClaims(db, "service_role");
    const resumeListingGatewayEnqueue = await scalar(
      db,
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.update', '{}'::jsonb)",
      [preparedListingId, coupangCredentialId, resumeListingAttempt.attempt_id],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',
              response_payload=$2::jsonb,
              completed_at=now()
        where id=$1`,
      [resumeListingGatewayEnqueue.job_id, JSON.stringify({
        ok: true,
        channel: "coupang",
        operation: "listing.update",
        remoteId: "remote-product-1",
        safeMessage: "listing resumed",
        steps: [{ name: "listing-readback", ok: true, status: 200, data: {} }],
      })],
    );
    await db.query(
      "update sellerpilot_private.channel_operation_attempts set status='succeeded', http_status=200, remote_id='remote-product-1', safe_message='listing resumed', completed_at=now() where id=$1",
      [resumeListingAttempt.attempt_id],
    );
    await db.query(
      "update sellerpilot_private.product_listings set status='published', failure_class=null, last_error=null, updated_at=now() where id=$1",
      [preparedListingId],
    );
    await setClaims(db);
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
        $1, $2, 'coupang', 'inventory.update', '{"arguments":{"vendorItemId":"remote-product-1","quantity":7}}'::jsonb,
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
    const shipmentAcknowledgeOrderId = await scalar(
      db,
      `insert into sellerpilot_private.commerce_orders (
        owner_id, external_order_id, channel_key, customer_name, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo
      ) values (
        $1, 'REAL-ORDER-ACK-1', 'qoo10', '발주확인 테스트 구매자', '발주확인 테스트 상품',
        1, 1000, 'KRW', 1000, 'paid', now(), false
      ) returning id`,
      [ADMIN_ID],
    );
    const lastShipmentAtBeforeAcknowledge = await scalar(
      db,
      "select last_shipment_at::text from sellerpilot_private.commerce_orders where id = $1",
      [shipmentAcknowledgeOrderId],
    );
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
        $1, $2, 'qoo10', 'shipment.acknowledge', '{"arguments":{"orderNo":"REAL-ORDER-ACK-1"}}'::jsonb,
        'order_shipment', $3, $4, null, null, $5, 'LEX', 'TRACK-ACK-1'
      )`,
      [credentialId, acknowledgeClaim.attempt_id, "4".repeat(64), "3".repeat(64), shipmentAcknowledgeOrderId],
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
        `select status, shipment_write_status, tracking_number,
                last_shipment_at::text as last_shipment_at
           from sellerpilot_private.commerce_orders where id = $1`,
        [shipmentAcknowledgeOrderId],
      )).rows[0],
      {
        status: "paid",
        shipment_write_status: "pending",
        tracking_number: null,
        last_shipment_at: lastShipmentAtBeforeAcknowledge,
      },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit where entity_id = $1 and action = 'shipment_acknowledged'",
        [shipmentAcknowledgeOrderId],
      ),
      1,
    );
    await setClaims(db);
    const confirmClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'shipment.confirm', 'resource-order-confirm-0001', $2)",
      [credentialId, "5".repeat(64)],
    );
    await setClaims(db, "service_role");
    const confirmEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_resource_gateway_job(
        $1, $2, 'qoo10', 'shipment.confirm', '{"arguments":{"params":{"OrderNo":"REAL-ORDER-ACK-1"}}}'::jsonb,
        'order_shipment', $3, $4, null, null, $5, 'LEX', 'TRACK-CONFIRM-1'
      )`,
      [credentialId, confirmClaim.attempt_id, "6".repeat(64), "5".repeat(64), shipmentAcknowledgeOrderId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', response_payload = '{"ok":true,"safeMessage":"confirmed"}'::jsonb,
              completed_at = now()
        where id = $1`,
      [confirmEnqueue.job_id],
    );
    assert.deepEqual(
      (await db.query(
        `select status, shipment_write_status, tracking_number,
                last_shipment_at is not null as last_shipment_at_recorded
           from sellerpilot_private.commerce_orders where id = $1`,
        [shipmentAcknowledgeOrderId],
      )).rows[0],
      {
        status: "shipped",
        shipment_write_status: "succeeded",
        tracking_number: "TRACK-CONFIRM-1",
        last_shipment_at_recorded: true,
      },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.operation_audit where entity_id = $1 and action = 'shipment_confirmed'",
        [shipmentAcknowledgeOrderId],
      ),
      1,
    );
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where order_id = $1",
      [shipmentAcknowledgeOrderId],
    );
    await db.query(
      "delete from sellerpilot_private.channel_operation_attempts where id = any($1::uuid[])",
      [[acknowledgeClaim.attempt_id, confirmClaim.attempt_id]],
    );
    await db.query(
      "delete from sellerpilot_private.commerce_orders where id = $1",
      [shipmentAcknowledgeOrderId],
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
    const crossOwnerCollisionOrderId = await scalar(
      db,
      `insert into sellerpilot_private.commerce_orders (
         owner_id, external_order_id, channel_key, customer_name, product_id, product_name,
         quantity, amount, currency, amount_krw, status, ordered_at, demo, tracking_number
       ) values (
         $1, 'REAL-ORDER-1', 'shopee', 'TracX 다른 소유자 고객', $2, 'TracX 명시 연결 상품',
         1, 10000, 'KRW', 10000, 'shipped', now(), false, 'SHARED-TRACK-1'
       ) returning id`,
      [SECOND_ADMIN_ID, aiProductId],
    );
    await db.query(
      "update sellerpilot_private.commerce_orders set tracking_number = 'SHARED-TRACK-1' where id = $1",
      [shipmentFailureOrderId],
    );

    // Any approved administrator may bind an exact shared-workspace order, but
    // its source credential owner remains authoritative. The TracX credential
    // and the actor were both created as ADMIN_ID; this order belongs to the
    // second administrator's Shopee credential lineage.
    await setClaims(db);
    const explicitTracxBinding = await scalar(
      db,
      "select public.sellerpilot_bind_tracx_order($1, 'packing_no', 'PACK-OWNER-2')",
      [crossOwnerCollisionOrderId],
    );
    assert.equal(explicitTracxBinding.orderId, crossOwnerCollisionOrderId);
    assert.equal(explicitTracxBinding.orderOwnerId, SECOND_ADMIN_ID);
    assert.equal(explicitTracxBinding.sourceChannel, "shopee");
    assert.equal(explicitTracxBinding.replayed, false);
    const boundOrderUpdatedAt = await scalar(
      db,
      "select updated_at::text from sellerpilot_private.commerce_orders where id = $1",
      [crossOwnerCollisionOrderId],
    );
    const replayedTracxBinding = await scalar(
      db,
      "select public.sellerpilot_bind_tracx_order($1, 'packing_no', 'PACK-OWNER-2')",
      [crossOwnerCollisionOrderId],
    );
    assert.equal(replayedTracxBinding.bindingId, explicitTracxBinding.bindingId);
    assert.equal(replayedTracxBinding.replayed, true);
    assert.equal(
      await scalar(
        db,
        "select updated_at::text from sellerpilot_private.commerce_orders where id = $1",
        [crossOwnerCollisionOrderId],
      ),
      boundOrderUpdatedAt,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_bind_tracx_order($1, 'packing_no', 'PACK-OWNER-2')",
        [shipmentFailureOrderId],
      ),
      /already bound to another order/,
    );
    await db.query(
      "update sellerpilot_private.commerce_orders set logistics_reference = 'PREEXISTING-OTHER-REF' where id = $1",
      [shipmentFailureOrderId],
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_bind_tracx_order($1, 'packing_no', 'PACK-UNIQUE-BUT-UNSAFE')",
        [shipmentFailureOrderId],
      ),
      /logistics binding conflicts with existing provider/,
    );
    await db.query(
      "update sellerpilot_private.commerce_orders set logistics_reference = null where id = $1",
      [shipmentFailureOrderId],
    );

    await setClaims(db, "service_role");
    // Marketplace order numbers and tracking numbers collide across owners and
    // channels. Neither value is an eligible binding key on its own.
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_ingest_tracx_delivery(
          $1,
          '{"RefOrderNo":"REAL-ORDER-1","TrackingNo":"SHARED-TRACK-1","StatusCode":"D3","StatusDesc":"Out for delivery","Date":"2026-08-22 13:30:00+09"}'::jsonb
        )`,
        [tracxCredentialId],
      ),
      false,
    );
    assert.deepEqual(
      (await db.query(
        `select id::text, owner_id::text, channel_key, logistics_provider,
                logistics_reference, delivery_status_code
           from sellerpilot_private.commerce_orders
          where id = any($1::uuid[])
          order by owner_id`,
        [[shipmentFailureOrderId, crossOwnerCollisionOrderId]],
      )).rows.map((row) => ({
        ...row,
        delivery_status_code: row.delivery_status_code ?? null,
      })),
      [
        {
          id: crossOwnerCollisionOrderId,
          owner_id: SECOND_ADMIN_ID,
          channel_key: "shopee",
          logistics_provider: "tracx",
          logistics_reference: "PACK-OWNER-2",
          delivery_status_code: null,
        },
        {
          id: shipmentFailureOrderId,
          owner_id: ADMIN_ID,
          channel_key: "qoo10",
          logistics_provider: null,
          logistics_reference: null,
          delivery_status_code: null,
        },
      ].sort((left, right) => left.owner_id.localeCompare(right.owner_id)),
    );

    const tracxDeliveryEvent = {
      PackingNo: "PACK-OWNER-2",
      TrackingNo: "SHARED-TRACK-1",
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
    assert.deepEqual(
      (await db.query(
        `select event.owner_id::text, event.order_id::text, event.binding_id::text
           from sellerpilot_private.tracx_delivery_events event
          where event.packing_no = 'PACK-OWNER-2'`,
      )).rows,
      [{
        owner_id: SECOND_ADMIN_ID,
        order_id: crossOwnerCollisionOrderId,
        binding_id: explicitTracxBinding.bindingId,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select id::text, status, delivery_status_code
           from sellerpilot_private.commerce_orders
          where id = any($1::uuid[])
          order by id`,
        [[shipmentFailureOrderId, crossOwnerCollisionOrderId]],
      )).rows,
      [
        { id: shipmentFailureOrderId, status: "paid", delivery_status_code: null },
        { id: crossOwnerCollisionOrderId, status: "delivered", delivery_status_code: "D4" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    // Rotating a static TracX credential creates a new credential incarnation.
    // A callback authenticated by that new secret must not inherit an older
    // binding merely because both credentials use the production environment.
    await setClaims(db);
    const rotatedTracxCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'tracx', 'production',
        '{"api_key":"tracx-rotated-test-key","webhook_secret":"abcdefghijklmnopqrstuvwxyz123456"}'::jsonb,
        null, 90, 30, 7
      )`,
    );
    assert.match(rotatedTracxCredentialId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(
        db,
        `select old_credential.seller_account_key <> new_credential.seller_account_key
           from sellerpilot_private.channel_credentials old_credential
           join sellerpilot_private.channel_credentials new_credential on new_credential.id = $2
          where old_credential.id = $1`,
        [tracxCredentialId, rotatedTracxCredentialId],
      ),
      true,
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_ingest_tracx_delivery(
          $1,
          '{"PackingNo":"PACK-OWNER-2","StatusCode":"D3","StatusDesc":"Wrong incarnation","Date":"2026-08-22 15:00:00+09"}'::jsonb
        )`,
        [rotatedTracxCredentialId],
      ),
      false,
    );
    assert.deepEqual(
      (await db.query(
        `select owner_id::text, order_id::text, binding_id::text
           from sellerpilot_private.tracx_delivery_events
          where credential_id = $1 and packing_no = 'PACK-OWNER-2'`,
        [rotatedTracxCredentialId],
      )).rows,
      [{ owner_id: null, order_id: null, binding_id: null }],
    );
    await setClaims(db);
    const reboundTracxBinding = await scalar(
      db,
      "select public.sellerpilot_bind_tracx_order($1, 'packing_no', 'PACK-OWNER-2')",
      [crossOwnerCollisionOrderId],
    );
    assert.equal(reboundTracxBinding.rebound, true);
    assert.equal(reboundTracxBinding.replayed, false);
    assert.notEqual(reboundTracxBinding.bindingId, explicitTracxBinding.bindingId);
    assert.deepEqual(
      (await db.query(
        `select logistics_provider, logistics_reference
           from sellerpilot_private.commerce_orders where id = $1`,
        [crossOwnerCollisionOrderId],
      )).rows,
      [{ logistics_provider: "tracx", logistics_reference: "PACK-OWNER-2" }],
    );
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_ingest_tracx_delivery(
          $1,
          '{"PackingNo":"PACK-OWNER-2","StatusCode":"D3","StatusDesc":"Old incarnation rejected","Date":"2026-08-22 15:15:00+09"}'::jsonb
        )`,
        [tracxCredentialId],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_ingest_tracx_delivery(
          $1,
          '{"PackingNo":"PACK-OWNER-2","StatusCode":"D4","StatusDesc":"Rebound incarnation accepted","Date":"2026-08-22 15:30:00+09"}'::jsonb
        )`,
        [rotatedTracxCredentialId],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)
           from sellerpilot_private.operation_audit
          where entity_type = 'order' and entity_id = $1
            and action = 'tracx_order_rebound'`,
        [crossOwnerCollisionOrderId],
      ),
      1,
    );
    await db.query(
      "delete from sellerpilot_private.push_notification_outbox where order_id = $1",
      [crossOwnerCollisionOrderId],
    );
    await db.query(
      "delete from sellerpilot_private.tracx_delivery_events where packing_no = 'PACK-OWNER-2' or reference_order_no = 'REAL-ORDER-1'",
    );
    await db.query(
      "delete from sellerpilot_private.operation_audit where entity_type = 'order' and entity_id = $1",
      [crossOwnerCollisionOrderId],
    );
    await db.query(
      "delete from sellerpilot_private.commerce_orders where id = $1",
      [crossOwnerCollisionOrderId],
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
    assert.equal(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [SHARED_PRODUCT_ID]),
      null,
    );
    const crossOwnerPublishContext = await scalar(
      db,
      "select public.sellerpilot_get_product_publish_context($1)",
      [SHARED_PRODUCT_ID],
    );
    assert.equal(crossOwnerPublishContext.product.id, SHARED_PRODUCT_ID);
    assert.deepEqual(crossOwnerPublishContext.detailPage, { data: null, version: 0, updatedAt: null });
    assert.equal(crossOwnerPublishContext.studioResult, null);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, null)",
        [SHARED_PRODUCT_ID, JSON.stringify({ root: {}, content: [] })],
      ),
      null,
    );
    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [SHARED_PRODUCT_ID]),
      { productId: SHARED_PRODUCT_ID, data: null, version: 0, updatedAt: null },
    );
    await db.query(
      "update sellerpilot_private.products set status = 'archived' where id = $1",
      [SHARED_PRODUCT_ID],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [SHARED_PRODUCT_ID]),
      null,
    );
    const archivedPublishContext = await scalar(
      db,
      "select public.sellerpilot_get_product_publish_context($1)",
      [SHARED_PRODUCT_ID],
    );
    assert.deepEqual(archivedPublishContext.detailPage, { data: null, version: 0, updatedAt: null });
    assert.equal(archivedPublishContext.studioResult, null);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, null)",
        [SHARED_PRODUCT_ID, JSON.stringify({ root: {}, content: [] })],
      ),
      null,
    );
    await db.query(
      "update sellerpilot_private.products set status = 'active', demo = true where id = $1",
      [SHARED_PRODUCT_ID],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [SHARED_PRODUCT_ID]),
      null,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [SHARED_PRODUCT_ID]),
      null,
    );
    await db.query(
      "update sellerpilot_private.products set demo = false where id = $1",
      [SHARED_PRODUCT_ID],
    );
    await setClaims(db);
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

    // Product readiness facts must remain product-specific and ledger-backed.
    // Historical category confirmations can coexist under different source_ref
    // values, so the snapshot must select only the newest row per channel/market.
    await db.query(
      `update sellerpilot_private.products
          set product_facts = coalesce(product_facts, '{}'::jsonb) ||
              '{"sellingPrice":21500,"currency":"KRW","categoryHint":"일반식품"}'::jsonb
        where id = $1`,
      [aiProductId],
    );
    await db.query(
      `update sellerpilot_private.products
          set product_facts = coalesce(product_facts, '{}'::jsonb) ||
              '{"sellingPrice":"19.95","currency":"usd","categoryHint":"테스트 상품군"}'::jsonb
        where id = $1`,
      [SHARED_PRODUCT_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, error_message, created_by,
         created_at, completed_at, updated_at
       ) values (
         $1, 'product_research', 'failed', jsonb_build_object('source_product_id', $2::text),
         'SECRET RAW PROVIDER ERROR MUST NOT REACH OPERATIONS SNAPSHOT', $3,
         now() + interval '2 seconds', now() + interval '2 seconds', now() + interval '2 seconds'
       )`,
      [READINESS_FAILED_JOB_ID, aiProductId, ADMIN_ID],
    );
    const readinessListingId = await scalar(
      db,
      `insert into sellerpilot_private.product_listings (
         owner_id, product_id, channel_key, status, currency, price,
         failure_class, last_error, updated_at
       ) values (
         $1, $2, 'qoo10', 'failed', 'JPY', 2100,
         'external_action', 'SECRET RAW LISTING ERROR MUST NOT REACH READINESS FACTS',
         now() + interval '1 second'
       ) returning id`,
      [ADMIN_ID, aiProductId],
    );
    await db.query(
      `insert into sellerpilot_private.product_category_assignments (
         owner_id, product_id, source_ref, product_name, channel, environment,
         market, category_id, category_path, is_leaf, confidence,
         classification_source, status, confirmed_at, created_at, updated_at
       ) values
         ($1, $2, 'readiness-qoo10-old', 'AI readiness product', 'qoo10', 'production',
          'JP', 'OLD-CATEGORY', array['이전','카테고리'], true, 1,
          'seller_selected', 'confirmed', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours'),
         ($1, $2, 'readiness-qoo10-new', 'AI readiness product', 'qoo10', 'production',
          'JP', 'NEW-CATEGORY', array['최신','카테고리'], true, 1,
          'seller_selected', 'confirmed', now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour'),
         ($1, $2, 'readiness-shopee-new', 'AI readiness product', 'shopee', 'production',
          'MY', 'SHOPEE-CATEGORY', array['Shopee','Confirmed'], true, 1,
          'seller_selected', 'confirmed', now() - interval '30 minutes', now() - interval '30 minutes', now() - interval '30 minutes')`,
      [ADMIN_ID, aiProductId],
    );

    const snapshot = await scalar(db, "select public.sellerpilot_get_operations_snapshot()");
    const readinessFacts = await scalar(db, "select public.sellerpilot_get_product_readiness_facts()");
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
    assert.equal(aiProduct.aiHeroPath, revisionResult.asset_storage_paths.hero);
    const aiReadiness = readinessFacts.find((facts) => facts.productId === aiProductId);
    assert.equal(aiReadiness.baseSellingPrice, 21500);
    assert.equal(aiReadiness.baseCurrency, "KRW");
    assert.equal(aiReadiness.categoryHint, "일반식품");
    assert.equal(aiReadiness.marginState, "missing");
    assert.equal(aiReadiness.latestError, "AI 상품 분석 실패 · 등록 진행에서 다시 시도해 주세요.");
    assert.equal(aiReadiness.latestErrorKind, "analysis");
    assert.equal(JSON.stringify(aiReadiness).includes("SECRET RAW PROVIDER ERROR"), false);
    assert.equal(JSON.stringify(aiReadiness).includes("SECRET RAW LISTING ERROR"), false);
    assert.equal(
      new Set(aiReadiness.confirmedCategories.map((category) => `${category.channelKey}:${category.market}`)).size,
      aiReadiness.confirmedCategories.length,
    );
    assert.deepEqual(
      aiReadiness.confirmedCategories
        .filter((category) => category.channelKey === "qoo10" || category.channelKey === "shopee")
        .map((category) => [category.channelKey, category.market, category.categoryId]),
      [["qoo10", "JP", "NEW-CATEGORY"], ["shopee", "MY", "SHOPEE-CATEGORY"]],
    );
    assert.equal(snapshot.products.some((product) => product.id === SHARED_PRODUCT_ID), true);
    const sharedReadiness = readinessFacts.find((facts) => facts.productId === SHARED_PRODUCT_ID);
    assert.equal(sharedReadiness.baseSellingPrice, 19.95);
    assert.equal(sharedReadiness.baseCurrency, "USD");
    assert.equal(sharedReadiness.categoryHint, "테스트 상품군");
    assert.deepEqual(sharedReadiness.confirmedCategories, []);
    await db.query(
      "update sellerpilot_private.product_listings set updated_at = now() + interval '3 seconds' where id = $1",
      [readinessListingId],
    );
    const listingNewerReadiness = await scalar(db, "select public.sellerpilot_get_product_readiness_facts()");
    const listingNewerAiFacts = listingNewerReadiness.find((facts) => facts.productId === aiProductId);
    assert.equal(listingNewerAiFacts.latestError, "채널 카테고리·권한 확인이 필요합니다.");
    assert.equal(listingNewerAiFacts.latestErrorKind, "external_action");
    const sharedPublishContext = await scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [SHARED_PRODUCT_ID]);
    assert.equal(sharedPublishContext.product.id, SHARED_PRODUCT_ID);
    assert.equal(sharedPublishContext.ownerId, SECOND_ADMIN_ID);
    assert.deepEqual(sharedPublishContext.detailPage, { data: null, version: 0, updatedAt: null });
    assert.equal(sharedPublishContext.studioResult, null);

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
    const sharedListingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'listing.create', 'shared-listing-create-0001', $2)",
      [credentialId, "b".repeat(64)],
    );
    await setClaims(db, "service_role");
    const sharedListingEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
        $1, $2, $3, 'qoo10', '', '', 'JPY', 1800, $4,
        '{"arguments":{"verificationOnly":true}}'::jsonb
      )`,
      [SHARED_PRODUCT_ID, credentialId, sharedListingAttempt.attempt_id, "b".repeat(64)],
    );
    const sharedListingId = sharedListingEnqueue.listing_id;
    assert.match(sharedListingId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select owner_id from sellerpilot_private.product_listings where id = $1", [sharedListingId]),
      SECOND_ADMIN_ID,
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now() where id = $1",
      [sharedListingEnqueue.job_id],
    );
    await setClaims(db);

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

    await setClaims(db, "service_role");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'reconciliation_required',
              created_at = now() - interval '6 minutes',
              updated_at = now() - interval '6 minutes',
              error_message = 'test-only uncertain OAuth refresh'
        where id = $1`,
      [periodicQueued.jobId],
    );
    const reconciliationJobCount = await scalar(
      db,
      `select count(*)::integer
         from sellerpilot_private.channel_gateway_jobs
        where credential_id = $1
          and channel = 'qoo10'
          and operation = 'orders.list'
          and request_payload->>'periodicKey' = 'orders'`,
      [credentialId],
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fencedPeriodic = await scalar(
        db,
        `select public.sellerpilot_service_enqueue_periodic_sync(
          'qoo10', 'orders.list',
          '{"periodicKey":"orders","arguments":{"params":{"ShippingStat":"9"}}}'::jsonb,
          5
        )`,
      );
      assert.equal(fencedPeriodic.status, "reconciliation_required");
      assert.equal(fencedPeriodic.jobId, periodicQueued.jobId);
    }
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.channel_gateway_jobs
          where credential_id = $1
            and channel = 'qoo10'
            and operation = 'orders.list'
            and request_payload->>'periodicKey' = 'orders'`,
        [credentialId],
      ),
      reconciliationJobCount,
    );

    await setClaims(db);
    const replacementQoo10CredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'qoo10', 'production', '{"certification_key":"replacement-test-only"}'::jsonb,
        now() + interval '30 days', 90, 30, 7
      )`,
    );
    assert.notEqual(replacementQoo10CredentialId, credentialId);
    await setClaims(db, "service_role");
    const replacementPeriodic = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'qoo10', 'orders.list',
        '{"periodicKey":"orders","arguments":{"params":{"ShippingStat":"9"}}}'::jsonb,
        5
      )`,
    );
    assert.equal(replacementPeriodic.status, "queued");
    assert.notEqual(replacementPeriodic.jobId, periodicQueued.jobId);
    assert.equal(
      await scalar(
        db,
        "select credential_id::text from sellerpilot_private.channel_gateway_jobs where id = $1",
        [replacementPeriodic.jobId],
      ),
      replacementQoo10CredentialId,
    );
    await setClaims(db);

    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_research', $2::jsonb)",
      [RESEARCH_JOB_ID, JSON.stringify({ research_input: "https://example.test/product/1 또는 흰색 도자기 머그컵 설명" })],
    );
    assert.equal(await scalar(db, "select kind from sellerpilot_private.ai_cli_jobs where id = $1", [RESEARCH_JOB_ID]), "product_research");
    const nonImageClaimToken = "49717699-1470-4bda-b8a0-2d70980e42c7";
    await setClaims(db, "service_role");
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status = 'running',
              worker_token_id = (select id from sellerpilot_private.ai_cli_worker_tokens where token_hash = $2),
              claim_token = $3,
              lease_expires_at = now() + interval '5 minutes'
        where id = $1`,
      [RESEARCH_JOB_ID, TOKEN_HASH, nonImageClaimToken],
    );
    const nonImageHeroPath = `results/${RESEARCH_JOB_ID}/claims/${nonImageClaimToken}/hero.png`;
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_authorize_ai_result_upload($1, $2, $3, 'hero', $4)",
        [TOKEN_HASH, RESEARCH_JOB_ID, nonImageClaimToken, nonImageHeroPath],
      ),
      false,
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set kind = 'support_reply' where id = $1",
      [RESEARCH_JOB_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_authorize_ai_result_upload($1, $2, $3, 'hero', $4)",
        [TOKEN_HASH, RESEARCH_JOB_ID, nonImageClaimToken, nonImageHeroPath],
      ),
      false,
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set kind = 'product_research',
              status = 'queued',
              worker_token_id = null,
              claim_token = null,
              lease_expires_at = null
        where id = $1`,
      [RESEARCH_JOB_ID],
    );
    await setClaims(db);
    const activityWithoutResearchDraft = await scalar(db, "select public.sellerpilot_list_registration_activity(300)");
    assert.equal(activityWithoutResearchDraft.some((activity) => activity.id === `job:${RESEARCH_JOB_ID}`), false);

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

    const legacyMarginScenarioId = await scalar(
        db,
        `select public.sellerpilot_save_margin_scenario(
          '다른 관리자 생성 상품', 'qoo10',
          '{"cost":10000,"productName":"다른 관리자 생성 상품"}'::jsonb,
          '{"margin":22.5}'::jsonb
        )`,
    );
    assert.match(legacyMarginScenarioId, /^[0-9a-f-]{36}$/i);
    const linkedMarginScenarioId = await scalar(
      db,
      `select public.sellerpilot_save_margin_scenario(
        '공유 상품 직접 계산', 'qoo10',
        jsonb_build_object('cost', 12000, 'productId', $1::text),
        '{"margin":18.25}'::jsonb
      )`,
      [SHARED_PRODUCT_ID],
    );
    assert.match(linkedMarginScenarioId, /^[0-9a-f-]{36}$/i);
    await db.query(
      "update sellerpilot_private.margin_scenarios set created_at = now() - interval '2 days' where id = $1",
      [linkedMarginScenarioId],
    );
    const noiseMarginScenarioIds = [];
    for (let index = 0; index < 6; index += 1) {
      const scenarioId = await scalar(
        db,
        `select public.sellerpilot_save_margin_scenario(
          $1, 'qoo10', jsonb_build_object('productId', $2::text), jsonb_build_object('margin', $3::numeric)
        )`,
        [`최근 계산 ${index + 1}`, aiProductId, 20 + index],
      );
      noiseMarginScenarioIds.push(scenarioId);
      await db.query(
        "update sellerpilot_private.margin_scenarios set created_at = now() + ($2::integer * interval '1 second') where id = $1",
        [scenarioId, index],
      );
    }
    const marginScenarios = await scalar(db, "select public.sellerpilot_list_margin_scenarios(5)");
    assert.equal(marginScenarios.length, 5);
    assert.equal(marginScenarios.some((scenario) => scenario.id === linkedMarginScenarioId), false);
    const linkedProductMarginScenarios = await scalar(
      db,
      "select public.sellerpilot_list_latest_margin_scenarios($1, 50)",
      [SHARED_PRODUCT_ID],
    );
    assert.deepEqual(
      linkedProductMarginScenarios.map((scenario) => [scenario.channelKey, scenario.id]),
      [["qoo10", linkedMarginScenarioId]],
    );
    const marginReadiness = await scalar(db, "select public.sellerpilot_get_product_readiness_facts()");
    const sharedMarginReadiness = marginReadiness.find((facts) => facts.productId === SHARED_PRODUCT_ID);
    const aiMarginReadiness = marginReadiness.find((facts) => facts.productId === aiProductId);
    assert.equal(sharedMarginReadiness.marginState, "calculated");
    assert.equal(sharedMarginReadiness.marginPercent, 18.25);
    assert.equal(sharedMarginReadiness.marginChannelKey, "qoo10");
    assert.equal(aiMarginReadiness.marginState, "calculated");
    assert.equal(aiMarginReadiness.marginPercent, 25);

    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    const sharedAdminScenarios = await scalar(db, "select public.sellerpilot_list_margin_scenarios(50)");
    assert.equal(sharedAdminScenarios.some((scenario) => scenario.id === linkedMarginScenarioId && scenario.productId === SHARED_PRODUCT_ID), true);
    assert.equal(sharedAdminScenarios.some((scenario) => scenario.id === legacyMarginScenarioId && scenario.productId === null), true);
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [noiseMarginScenarioIds[0]]), true);
    assert.deepEqual(
      (await db.query(
        `select owner_id::text, safe_detail->>'scenario_owner_id' as scenario_owner_id
           from sellerpilot_private.operation_audit
          where action = 'scenario_deleted' and entity_id = $1
          order by occurred_at desc limit 1`,
        [noiseMarginScenarioIds[0]],
      )).rows,
      [{ owner_id: SECOND_ADMIN_ID, scenario_owner_id: ADMIN_ID }],
    );
    await setClaims(db, "authenticated", NON_ADMIN_ID);
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_save_margin_scenario(
          '비관리자 계산', 'qoo10', jsonb_build_object('productId', $1::text), '{"margin":1}'::jsonb
        )`,
        [aiProductId],
      ),
      /invalid margin scenario/,
    );
    await setClaims(db);
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [legacyMarginScenarioId]), true);
    assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [linkedMarginScenarioId]), true);
    for (const scenarioId of noiseMarginScenarioIds.slice(1)) {
      assert.equal(await scalar(db, "select public.sellerpilot_delete_margin_scenario($1)", [scenarioId]), true);
    }
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
    assert.equal(jobs.rows.length, 8);
    assert.equal(jobs.rows.some((job) => job.id === PRODUCT_REVISION_JOB_ID && job.status === "succeeded"), true);
    assert.equal(jobs.rows.some((job) => job.id === STALE_PRODUCT_REVISION_JOB_ID && job.status === "succeeded"), true);
    assert.equal(jobs.rows.some((job) => job.id === DUPLICATE_SKU_JOB_ID && job.status === "succeeded"), true);
    assert.equal(jobs.rows.some((job) => job.status === "succeeded" && job.has_hero), true);
    assert.equal(jobs.rows.some((job) => job.kind === "product_research"), true);
    assert.equal(jobs.rows.some((job) => job.kind === "product_asset_regeneration"), true);

    const pruneInputPath = `${ADMIN_ID}/${PRUNE_JOB_ID}/input/source.jpg`;
    const pruneResultPath = `results/${PRUNE_JOB_ID}/claims/0dfb1a8a-20a4-4b26-8caf-8ac10e18ba07/hero.png`;
    const protectedSourceInputPath = requestPayload.image_paths[0];
    const protectedRegeneratedPath = `results/${REGEN_JOB_ID}/claims/9bb52c9a-9bfd-4517-b6ac-06f8a5ea443c/detail-use.png`;
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set result_payload = jsonb_set(
                result_payload,
                '{asset_storage_paths,detail-use}',
                to_jsonb($2::text),
                true
              ),
              completed_at = now() - interval '31 days',
              updated_at = now() - interval '31 days'
        where id = $1`,
      [JOB_ID, protectedRegeneratedPath],
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status = 'succeeded',
              result_payload = jsonb_build_object(
                'mode', 'asset-regeneration',
                'assetId', 'detail-use',
                'sourceJobId', $2::text,
                'asset_storage_paths', jsonb_build_object('detail-use', $3::text)
              ),
              completed_at = now() - interval '31 days',
              updated_at = now() - interval '31 days'
        where id = $1`,
      [REGEN_JOB_ID, JOB_ID, protectedRegeneratedPath],
    );
    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [PRUNE_JOB_ID, JSON.stringify({ ...requestPayload, image_paths: [pruneInputPath] })],
    );
    await setClaims(db, "service_role");
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status = 'failed',
              result_payload = jsonb_build_object(
                'asset_storage_paths', jsonb_build_object('hero', $2::text)
              ),
              error_message = 'retention migration test',
              completed_at = now() - interval '31 days',
              updated_at = now() - interval '31 days'
        where id = $1`,
      [PRUNE_JOB_ID, pruneResultPath],
    );
    await setClaims(db);
    await db.query(
      "select public.sellerpilot_create_ai_job($1, 'product_studio', $2::jsonb)",
      [UNSAFE_PRUNE_JOB_ID, JSON.stringify({
        ...requestPayload,
        image_paths: [`${ADMIN_ID}/${UNSAFE_PRUNE_JOB_ID}/input/source.jpg`],
      })],
    );
    await setClaims(db, "service_role");
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status = 'failed',
              request_payload = jsonb_set(
                request_payload,
                '{image_paths}',
                '["legacy/unsafe-input.jpg"]'::jsonb
              ),
              error_message = 'unsafe legacy retention migration test',
              completed_at = now() - interval '32 days',
              updated_at = now() - interval '32 days'
        where id = $1`,
      [UNSAFE_PRUNE_JOB_ID],
    );
    const prunedJobs = await db.query(
      "select * from public.sellerpilot_prune_ai_jobs(now() - interval '30 days', 10)",
    );
    assert.deepEqual(prunedJobs.rows, [{
      job_id: PRUNE_JOB_ID,
      input_paths: [pruneInputPath],
      result_paths: [pruneResultPath],
    }]);
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.ai_cli_jobs where id = $1", [PRUNE_JOB_ID]),
      0,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.ai_cli_jobs where id = $1", [UNSAFE_PRUNE_JOB_ID]),
      1,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.ai_cli_jobs where id = any($1::uuid[])", [[JOB_ID, REGEN_JOB_ID]]),
      2,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_storage_cleanup_queue where object_path = any($1::text[]) and available_at > now() + interval '29 days'",
        [[protectedSourceInputPath, protectedRegeneratedPath]],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_storage_cleanup_queue where object_path = 'legacy/unsafe-input.jpg'",
      ),
      0,
    );
    assert.deepEqual(
      (await db.query(
        `select object_path
           from sellerpilot_private.ai_storage_cleanup_queue
          where object_path = any($1::text[])
          order by object_path`,
        [[pruneInputPath, pruneResultPath]],
      )).rows.map((row) => row.object_path),
      [pruneInputPath, pruneResultPath].sort(),
    );
    const cleanupClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_ai_storage_cleanup(10, 120)",
    );
    assert.equal(cleanupClaim.bucket, "sellerpilot-ai");
    assert.deepEqual(cleanupClaim.paths, [abandonedPaths[0], pruneInputPath, pruneResultPath].sort());
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_ai_storage_cleanup($1, array[$2]::text[], 'storage_remove_partial')",
        [cleanupClaim.claimToken, pruneInputPath],
      ),
      { removed: 1, requeued: 2 },
    );
    await db.query(
      "update sellerpilot_private.ai_storage_cleanup_queue set available_at = now() - interval '1 second' where object_path = any($1::text[])",
      [[abandonedPaths[0], pruneResultPath]],
    );
    const retryCleanupClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_ai_storage_cleanup(10, 120)",
    );
    assert.deepEqual(retryCleanupClaim.paths, [abandonedPaths[0], pruneResultPath].sort());
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_ai_storage_cleanup($1, array[$2,$3]::text[], null)",
        [retryCleanupClaim.claimToken, pruneResultPath, abandonedPaths[0]],
      ),
      { removed: 2, requeued: 0 },
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.ai_storage_cleanup_queue where available_at <= now()"),
      0,
    );
    assert.ok(Number(await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.ai_storage_cleanup_queue where available_at > now() + interval '29 days'",
    )) >= 9);

    await setClaims(db);
    for (const signature of [
      "public.sellerpilot_issue_ai_worker_token(text,text,text,timestamp with time zone)",
      "public.sellerpilot_issue_ai_worker_token(text,text,text,timestamp with time zone,text)",
    ]) {
      assert.equal(
        await scalar(db, "select has_function_privilege('authenticated', $1, 'EXECUTE')", [signature]),
        false,
      );
    }
    const activeBeforeRotation = (await db.query(
      `select scope, token_hash
         from sellerpilot_private.ai_cli_worker_tokens
        where status = 'active'
          and scope in ('ai', 'gateway', 'scheduler', 'legacy_combined')
        order by scope`,
    )).rows;
    const pendingProof = {
      ai: PENDING_AI_TOKEN_HASH,
      gateway: PENDING_GATEWAY_TOKEN_HASH,
      scheduler: PENDING_SCHEDULER_TOKEN_HASH,
    };
    const pendingMetadata = Object.fromEntries(Object.entries(pendingProof).map(([scope, tokenHash], index) => [scope, {
      tokenHash,
      fingerprint: String(index + 1).repeat(12),
    }]));
    const pendingSet = await scalar(
      db,
      `select public.sellerpilot_issue_pending_worker_token_set(
        'Atomic worker rotation', $1::jsonb, now() + interval '30 days'
      )`,
      [JSON.stringify(pendingMetadata)],
    );
    assert.equal(pendingSet.status, "pending");
    assert.match(pendingSet.tokenSetId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_cli_worker_tokens where rotation_set_id = $1 and status = 'pending'",
        [pendingSet.tokenSetId],
      ),
      3,
    );
    assert.deepEqual((await db.query(
      `select scope, token_hash
         from sellerpilot_private.ai_cli_worker_tokens
        where status = 'active'
          and scope in ('ai', 'gateway', 'scheduler', 'legacy_combined')
        order by scope`,
    )).rows, activeBeforeRotation);

    await setClaims(db, "service_role");
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_activate_worker_token_set($1, $2::jsonb)",
        [pendingSet.tokenSetId, JSON.stringify({ ...pendingProof, gateway: "f".repeat(64) })],
      ),
      { status: "invalid" },
    );
    const activatedSet = await scalar(
      db,
      "select public.sellerpilot_service_activate_worker_token_set($1, $2::jsonb)",
      [pendingSet.tokenSetId, JSON.stringify(pendingProof)],
    );
    assert.deepEqual(activatedSet, {
      status: "activated",
      tokenSetId: pendingSet.tokenSetId,
      replayed: false,
    });
    assert.deepEqual((await db.query(
      `select scope, token_hash
         from sellerpilot_private.ai_cli_worker_tokens
        where status = 'active'
        order by scope`,
    )).rows, Object.entries(pendingProof).map(([scope, token_hash]) => ({ scope, token_hash })));
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_activate_worker_token_set($1, $2::jsonb)",
        [pendingSet.tokenSetId, JSON.stringify(pendingProof)],
      ),
      { status: "activated", tokenSetId: pendingSet.tokenSetId, replayed: true },
    );

    await setClaims(db);
    const abortProof = { ai: "4".repeat(64), gateway: "5".repeat(64), scheduler: "6".repeat(64) };
    const abortMetadata = Object.fromEntries(Object.entries(abortProof).map(([scope, tokenHash], index) => [scope, {
      tokenHash,
      fingerprint: String(index + 4).repeat(12),
    }]));
    const abortSet = await scalar(
      db,
      "select public.sellerpilot_issue_pending_worker_token_set('Abort worker rotation', $1::jsonb, now() + interval '30 days')",
      [JSON.stringify(abortMetadata)],
    );
    await setClaims(db, "service_role");
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_abort_worker_token_set($1, $2::jsonb)",
        [abortSet.tokenSetId, null],
      ),
      { status: "invalid" },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.ai_cli_worker_tokens where rotation_set_id = $1 and status = 'pending'",
        [abortSet.tokenSetId],
      ),
      3,
    );
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_abort_worker_token_set($1, $2::jsonb)",
        [abortSet.tokenSetId, JSON.stringify(abortProof)],
      ),
      { status: "aborted", tokenSetId: abortSet.tokenSetId, replayed: false },
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.ai_cli_worker_tokens where rotation_set_id = $1 and status = 'revoked'", [abortSet.tokenSetId]),
      3,
    );
    assert.deepEqual((await db.query(
      "select scope, token_hash from sellerpilot_private.ai_cli_worker_tokens where status = 'active' order by scope",
    )).rows, Object.entries(pendingProof).map(([scope, token_hash]) => ({ scope, token_hash })));

    await setClaims(db);
    const expiryProof = { ai: "7".repeat(64), gateway: "8".repeat(64), scheduler: "9".repeat(64) };
    const expiryMetadata = Object.fromEntries(Object.entries(expiryProof).map(([scope, tokenHash], index) => [scope, {
      tokenHash,
      fingerprint: String(index + 7).repeat(12),
    }]));
    const expirySet = await scalar(
      db,
      "select public.sellerpilot_issue_pending_worker_token_set('Expire worker rotation', $1::jsonb, now() + interval '30 days')",
      [JSON.stringify(expiryMetadata)],
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set activation_expires_at = now() - interval '1 second' where rotation_set_id = $1",
      [expirySet.tokenSetId],
    );
    await setClaims(db, "service_role");
    assert.equal(await scalar(db, "select public.sellerpilot_service_expire_pending_worker_token_sets()"), 3);
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.ai_cli_worker_tokens where rotation_set_id = $1 and status = 'revoked'", [expirySet.tokenSetId]),
      3,
    );

    // A large historical studio ledger must not make the activity RPC scan
    // and JSON-build every orphan job. The function probes a fixed newest-first
    // window, preserves the response contract, and still enforces admin access.
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, error_message, created_by,
         created_at, completed_at, updated_at
       )
       select gen_random_uuid(),
              'product_studio',
              'failed',
              jsonb_build_object(
                'manual_fields', jsonb_build_object(
                  'productName', '과거 성능 검증 상품 ' || series.value::text,
                  'sellerSku', 'PERF-' || series.value::text
                )
              ),
              'historical test-only failure',
              $1,
              now() - interval '30 days' - series.value * interval '1 second',
              now() - interval '30 days' - series.value * interval '1 second',
              now() - interval '30 days' - series.value * interval '1 second'
         from generate_series(1, 12000) as series(value)`,
      [ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, description, status,
         on_hand, reserved, reorder_point, cost_krw, demo, updated_at
       )
       select $1,
              'BOUND-EMPTY-' || series.value::text,
              'BOUND-EMPTY-' || series.value::text,
              '최근 활동 없는 상품 ' || series.value::text,
              '활동 후보 슬롯을 소진하지 않아야 하는 테스트 상품',
              'active', 0, 0, 0, 0, false,
              clock_timestamp()
         from generate_series(1, 700) as series(value)`,
      [ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, error_message, created_by,
         created_at, completed_at, updated_at
       )
       select gen_random_uuid(),
              'product_studio',
              'failed',
              jsonb_build_object(
                'manual_fields', jsonb_build_object(
                  'productName', '후보 경계 상품 ' || series.value::text,
                  'sellerSku', 'BOUND-ACTIVE-' || series.value::text
                )
              ),
              'bounded candidate test-only failure',
              $1,
              now() - interval '60 days' - series.value * interval '1 second',
              now() - interval '60 days' - series.value * interval '1 second',
              now() - interval '60 days' - series.value * interval '1 second'
         from generate_series(1, 50) as series(value)`,
      [ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, description, ai_job_id, status,
         on_hand, reserved, reorder_point, cost_krw, demo, updated_at
       )
       select $1,
              job.request_payload->'manual_fields'->>'sellerSku',
              job.request_payload->'manual_fields'->>'sellerSku',
              job.request_payload->'manual_fields'->>'productName',
              '더 최근의 활동 없는 상품 뒤에서도 조회되어야 하는 테스트 상품',
              job.id, 'active', 0, 0, 0, 0, false,
              clock_timestamp() + interval '1 hour'
         from sellerpilot_private.ai_cli_jobs job
        where job.request_payload->'manual_fields'->>'sellerSku' like 'BOUND-ACTIVE-%'`,
      [ADMIN_ID],
    );
    await db.exec("analyze sellerpilot_private.ai_cli_jobs");
    await db.exec("analyze sellerpilot_private.products");
    await db.exec("set statement_timeout = '5s'");
    await setClaims(db);
    const boundedActivity = await scalar(
      db,
      "select public.sellerpilot_list_registration_activity(160)",
    );
    await db.exec("reset statement_timeout");
    assert.equal(boundedActivity.length, 160);
    assert.equal(new Set(boundedActivity.map((activity) => activity.id)).size, boundedActivity.length);
    assert.equal(
      boundedActivity.every((activity) => [
        "id", "productId", "productName", "productCode", "sku", "status",
        "startedAt", "updatedAt", "completedAt", "elapsedSeconds", "channelCount",
        "publishedCount", "failedCount", "blockedCount", "channels", "message",
      ].every((key) => Object.hasOwn(activity, key))),
      true,
    );
    const boundedCandidateActivity = await scalar(
      db,
      "select public.sellerpilot_list_registration_activity(50)",
    );
    assert.equal(
      boundedCandidateActivity.filter((activity) => activity.productCode.startsWith("BOUND-ACTIVE-")).length,
      50,
    );
    await setClaims(db, "authenticated", NON_ADMIN_ID);
    await assert.rejects(
      db.query("select public.sellerpilot_list_registration_activity(160)"),
      /administrator access required/,
    );
    // Retiring the combined rollout bridge is intentionally deferred until
    // the end of this integration flow. An operating legacy worker must keep
    // working when no complete replacement set exists, and the migration must
    // leave every function and token untouched on that failed attempt.
    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set status = 'revoked', revoked_at = clock_timestamp()
        where scope in ('ai', 'gateway', 'scheduler')
          and status = 'active'`,
    );
    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set status = 'active', revoked_at = null,
              expires_at = clock_timestamp() + interval '30 days'
        where token_hash = $1
          and scope = 'legacy_combined'`,
      [TOKEN_HASH],
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.worker_token_has_scope($1, 'gateway', true)",
        [TOKEN_HASH],
      ),
      true,
    );

    const legacyScopeRetirementSql = withoutUnavailableExtensions(
      await readFile(new URL(LEGACY_SCOPE_RETIREMENT_MIGRATION, migrationUrl), "utf8"),
    );
    assert.match(
      legacyScopeRetirementSql,
      /count\(distinct token\.scope\) = 3/,
    );
    assert.match(legacyScopeRetirementSql, /token\.last_seen_at is not null/);
    assert.match(legacyScopeRetirementSql, /token\.last_seen_at >= token\.activated_at/);
    assert.match(legacyScopeRetirementSql, /token\.scope = p_scope/);
    assert.doesNotMatch(
      legacyScopeRetirementSql,
      /token\.scope\s+in\s*\(\s*p_scope\s*,\s*'legacy_combined'/i,
    );
    assert.match(legacyScopeRetirementSql, /from sellerpilot_private\.ai_cli_jobs job/);
    assert.match(legacyScopeRetirementSql, /from sellerpilot_private\.channel_gateway_jobs job/);
    assert.match(legacyScopeRetirementSql, /job\.status = 'running'/);
    assert.match(legacyScopeRetirementSql, /legacy_combined worker leases must drain before token retirement/);
    assert.doesNotMatch(
      legacyScopeRetirementSql,
      /support_tickets|inquiry_reply|complete_channel_gateway/i,
    );
    await assert.rejects(
      db.exec(legacyScopeRetirementSql),
      /active heartbeat-verified scoped worker token set required before retiring legacy_combined/,
    );
    await db.exec("rollback").catch(() => undefined);
    assert.deepEqual(
      (await db.query(
        `select status, revoked_at is null as not_revoked
           from sellerpilot_private.ai_cli_worker_tokens
          where token_hash = $1`,
        [TOKEN_HASH],
      )).rows,
      [{ status: "active", not_revoked: true }],
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.worker_token_has_scope($1, 'gateway', true)",
        [TOKEN_HASH],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_worker_tokens
          where scope in ('ai', 'gateway', 'scheduler')
            and status = 'active'`,
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_audit
          where action = 'token_revoked'
            and safe_detail->>'reason' = 'legacy_combined_retired'`,
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select to_regprocedure('public.sellerpilot_20260828_claim_product_ai_job_scoped_once(text,text)') is null",
      ),
      true,
    );

    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set status = 'active', revoked_at = null,
              expires_at = clock_timestamp() + interval '30 days'
        where token_hash = any($1::text[])
          and scope in ('ai', 'gateway', 'scheduler')`,
      [Object.values(pendingProof)],
    );
    assert.deepEqual(
      (await db.query(
        `select rotation_set_id::text as rotation_set_id,
                array_agg(scope order by scope) as scopes
           from sellerpilot_private.ai_cli_worker_tokens
          where token_hash = any($1::text[])
            and status = 'active'
          group by rotation_set_id`,
        [Object.values(pendingProof)],
      )).rows.map((row) => row.scopes),
      [["ai", "gateway", "scheduler"]],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_worker_tokens
          where token_hash = any($1::text[])
            and last_seen_at is not null
            and last_seen_at >= activated_at`,
        [Object.values(pendingProof)],
      ),
      0,
    );
    await assert.rejects(
      db.exec(legacyScopeRetirementSql),
      (error) => {
        assert.equal(error.code, "55000");
        assert.match(
          error.message,
          /active heartbeat-verified scoped worker token set required before retiring legacy_combined/,
        );
        return true;
      },
    );
    await db.exec("rollback").catch(() => undefined);
    assert.deepEqual(
      (await db.query(
        `select status, revoked_at is null as not_revoked
           from sellerpilot_private.ai_cli_worker_tokens
          where token_hash = $1`,
        [TOKEN_HASH],
      )).rows,
      [{ status: "active", not_revoked: true }],
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.worker_token_has_scope($1, 'gateway', true)",
        [TOKEN_HASH],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_audit
          where action = 'token_revoked'
            and safe_detail->>'reason' = 'legacy_combined_retired'`,
      ),
      0,
    );
    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set last_seen_at = activated_at
        where token_hash = any($1::text[])
          and status = 'active'
          and scope in ('ai', 'gateway', 'scheduler')`,
      [Object.values(pendingProof)],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_worker_tokens
          where token_hash = any($1::text[])
            and last_seen_at is not null
            and last_seen_at >= activated_at`,
        [Object.values(pendingProof)],
      ),
      3,
    );

    await setClaims(db, "service_role");
    await db.exec(legacyScopeRetirementSql);
    assert.deepEqual(
      (await db.query(
        `select status, revoked_at is not null as revoked
           from sellerpilot_private.ai_cli_worker_tokens
          where token_hash = $1`,
        [TOKEN_HASH],
      )).rows,
      [{ status: "revoked", revoked: true }],
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.ai_cli_worker_tokens
            set status = 'active', revoked_at = null
          where token_hash = $1`,
        [TOKEN_HASH],
      ),
      /ai_cli_worker_tokens_no_active_legacy_combined_check/,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.ai_cli_audit
          where worker_token_id = (
                  select id from sellerpilot_private.ai_cli_worker_tokens
                   where token_hash = $1
                )
            and action = 'token_revoked'
            and safe_detail->>'reason' = 'legacy_combined_retired'`,
        [TOKEN_HASH],
      ),
      1,
    );
    for (const scope of ["ai", "gateway", "scheduler"]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.worker_token_has_scope($1, $2, true)",
          [TOKEN_HASH, scope],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.worker_token_has_scope($1, 'ai', true)",
        [pendingProof.ai],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.worker_token_has_scope($1, 'gateway', true)",
        [pendingProof.gateway],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_validate_worker_token($1, 'migration-test/strict-scheduler')",
        [TOKEN_HASH],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_validate_worker_token($1, 'migration-test/strict-scheduler')",
        [pendingProof.scheduler],
      ),
      true,
    );
    for (const claimSql of [
      "select public.sellerpilot_claim_channel_gateway_job($1, 'migration-test/legacy-retired')",
      "select public.sellerpilot_claim_ai_job($1, 'migration-test/legacy-retired')",
      "select public.sellerpilot_claim_product_ai_job($1, 'migration-test/legacy-retired')",
    ]) {
      await assert.rejects(db.query(claimSql, [TOKEN_HASH]), /invalid worker token/);
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_20260828_claim_product_ai_job_scoped_once(text,text)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_claim_product_ai_job(text,text)', 'EXECUTE')",
      ),
      true,
    );
  } finally {
    await db.close();
  }
});

test("Korean inquiry history runs are durable, idempotent, paginated, retryable, and serverless-owned", async () => {
  const db = new PGlite();
  const legacyHash = "4".repeat(64);
  const serverlessHash = "5".repeat(64);
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql") && name < LEGACY_SCOPE_RETIREMENT_MIGRATION)
      .sort();
    for (const name of migrationNames) {
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }

    await db.query(
      "insert into auth.users (id, email) values ($1, 'history-admin@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'History Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    for (const channel of ["coupang", "smartstore"]) {
      await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          $1, 'production', $2::jsonb,
          now() + interval '180 days', 90, 30, 0
        )`,
        [channel, JSON.stringify({
          key: `${channel}-history-test-key`,
          access_token: `${channel}-history-access`,
          refresh_token: `${channel}-history-refresh`,
          client_id: `${channel}-history-client`,
          client_secret: `${channel}-history-secret`,
        })],
      );
    }

    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_start_inquiry_history_backfill(integer)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_start_inquiry_history_backfill(integer)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from information_schema.columns
          where table_schema = 'sellerpilot_private'
            and table_name = 'inquiry_history_backfill_runs'
            and column_name ~ '(customer|message|body|subject|order|provider_response)'`,
      ),
      0,
    );

    const run = await scalar(
      db,
      "select public.sellerpilot_start_inquiry_history_backfill(30)",
    );
    assert.equal(run.status, "queued");
    assert.equal(run.expectedInitialJobs, 27);
    assert.equal(run.totalJobs, 27);
    assert.equal(run.queuedJobs, 27);
    assert.equal(run.succeededJobs, 0);
    assert.equal(run.failedJobs, 0);
    assert.equal(run.reused, false);
    assert.equal(run.retriedJobs, 0);
    assert.deepEqual(
      (await db.query(
        `select channel, count(*)::integer as count
           from sellerpilot_private.channel_gateway_jobs
          where request_payload #>> '{arguments,sellerpilotHistoryRunId}' = $1
          group by channel
          order by channel`,
        [run.runId],
      )).rows,
      [
        { channel: "coupang", count: 25 },
        { channel: "smartstore", count: 2 },
      ],
    );

    const reused = await scalar(
      db,
      "select public.sellerpilot_start_inquiry_history_backfill(30)",
    );
    assert.equal(reused.runId, run.runId);
    assert.equal(reused.reused, true);
    assert.equal(reused.retriedJobs, 0);
    assert.equal(reused.totalJobs, 27);

    // A seven-day range gives Coupang and Smartstore the same human-readable
    // product slice key. Channel lineage must still keep both initial jobs
    // distinct instead of rejecting the whole atomic backfill transaction.
    const sevenDayRun = await scalar(
      db,
      "select public.sellerpilot_start_inquiry_history_backfill(7)",
    );
    assert.equal(sevenDayRun.expectedInitialJobs, 7);
    assert.equal(sevenDayRun.totalJobs, 7);
    assert.deepEqual(
      (await db.query(
        `select channel, count(*)::integer as count
           from sellerpilot_private.channel_gateway_jobs
          where request_payload #>> '{arguments,sellerpilotHistoryRunId}' = $1
          group by channel
          order by channel`,
        [sevenDayRun.runId],
      )).rows,
      [
        { channel: "coupang", count: 5 },
        { channel: "smartstore", count: 2 },
      ],
    );

    const parent = (await db.query(
      `select id::text, credential_id::text, channel, operation, environment,
              created_by::text
         from sellerpilot_private.channel_gateway_jobs
        where request_payload #>> '{arguments,sellerpilotHistoryRunId}' = $1
        order by created_at, id
        limit 1`,
      [run.runId],
    )).rows[0];
    const continuationId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, attempt_id, channel, operation, environment,
         request_payload, created_by
       ) values (
         gen_random_uuid(), $1::uuid, null, $2::text, $3::text, $4::text,
         jsonb_build_object(
           'arguments', jsonb_build_object('pageNum', 2),
           'periodicKey', 'continuation:test-history',
           'continuationOf', $5::text
         ),
         $6::uuid
       ) returning id`,
      [
        parent.credential_id,
        parent.channel,
        parent.operation,
        parent.environment,
        parent.id,
        parent.created_by,
      ],
    );
    assert.deepEqual(
      (await db.query(
        `select request_payload #>> '{arguments,sellerpilotHistoryRunId}' as run_id,
                request_payload #>> '{arguments,sellerpilotHistoryItemKey}' as item_key
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [continuationId],
      )).rows,
      [{
        run_id: run.runId,
        item_key: await scalar(
          db,
          `select request_payload #>> '{arguments,sellerpilotHistoryItemKey}'
             from sellerpilot_private.channel_gateway_jobs
            where id = $1`,
          [parent.id],
        ),
      }],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', completed_at = clock_timestamp()
        where id = $1`,
      [parent.id],
    );
    const firstSliceOnly = await scalar(
      db,
      "select public.sellerpilot_get_inquiry_history_backfill($1)",
      [run.runId],
    );
    assert.equal(firstSliceOnly.status, "running");
    assert.equal(firstSliceOnly.totalJobs, 28);
    assert.equal(firstSliceOnly.succeededJobs, 1);
    assert.equal(firstSliceOnly.queuedJobs, 27);
    assert.equal(firstSliceOnly.completedAt, null);

    const failedJobId = await scalar(
      db,
      `select id
         from sellerpilot_private.channel_gateway_jobs
        where request_payload #>> '{arguments,sellerpilotHistoryRunId}' = $1
          and status = 'queued'
        order by created_at, id
        limit 1`,
      [run.runId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'failed', attempt_count = 1,
              error_message = 'bounded test read failure',
              completed_at = clock_timestamp()
        where id = $1`,
      [failedJobId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', completed_at = clock_timestamp()
        where request_payload #>> '{arguments,sellerpilotHistoryRunId}' = $1
          and status = 'queued'`,
      [run.runId],
    );
    const failed = await scalar(
      db,
      "select public.sellerpilot_get_inquiry_history_backfill($1)",
      [run.runId],
    );
    assert.equal(failed.status, "failed");
    assert.equal(failed.succeededJobs, 27);
    assert.equal(failed.failedJobs, 1);
    assert.notEqual(failed.completedAt, null);

    const retried = await scalar(
      db,
      "select public.sellerpilot_start_inquiry_history_backfill(30)",
    );
    assert.equal(retried.runId, run.runId);
    assert.equal(retried.reused, true);
    assert.equal(retried.retriedJobs, 1);
    assert.equal(retried.status, "running");
    assert.equal(retried.queuedJobs, 1);
    assert.equal(retried.failedJobs, 0);
    assert.equal(retried.completedAt, null);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', completed_at = clock_timestamp()
        where id = $1`,
      [failedJobId],
    );
    const complete = await scalar(
      db,
      "select public.sellerpilot_get_inquiry_history_backfill($1)",
      [run.runId],
    );
    assert.equal(complete.status, "succeeded");
    assert.equal(complete.totalJobs, 28);
    assert.equal(complete.succeededJobs, 28);
    assert.equal(complete.progressPercent, 100);
    assert.notEqual(complete.completedAt, null);

    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, expires_at, created_by, scope
       ) values
         ('history legacy worker', $1, '444444444444', 'active',
          clock_timestamp() + interval '1 day', $3, 'legacy_combined'),
         ('history serverless worker', $2, '555555555555', 'active',
          clock_timestamp() + interval '1 day', $3, 'serverless_cs')`,
      [legacyHash, serverlessHash, ADMIN_ID],
    );
    await setClaims(db, "service_role");
    const currentRead = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'coupang', 'inquiries.list',
        '{"periodicKey":"inquiries:claim-isolation-current","arguments":{"kind":"product","query":{"pageNum":1}}}'::jsonb,
        5
      )`,
    );
    assert.equal(currentRead.status, "queued");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'history-test/generic-blocked')",
        [legacyHash],
      ),
      null,
    );
    const serverlessClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_cs_job($1, 'history-test/serverless')",
      [serverlessHash],
    );
    assert.equal(serverlessClaim.id, currentRead.jobId);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', worker_token_id = null,
              claim_token = null, lease_expires_at = null,
              completed_at = clock_timestamp()
        where id = $1`,
      [currentRead.jobId],
    );
    await db.query(
      `update sellerpilot_private.ai_cli_worker_tokens
          set expires_at = clock_timestamp() - interval '1 second'
        where token_hash = $1`,
      [serverlessHash],
    );
    const blockedByExpiredActive = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'smartstore', 'inquiries.list',
        '{"periodicKey":"inquiries:claim-isolation-expired","arguments":{"kind":"customer","query":{"page":1}}}'::jsonb,
        5
      )`,
    );
    assert.equal(blockedByExpiredActive.status, "queued");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'history-test/expired-serverless-blocks-generic')",
        [legacyHash],
      ),
      null,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_claim_serverless_cs_job($1, 'history-test/expired-serverless')",
        [serverlessHash],
      ),
      /invalid worker token/,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [blockedByExpiredActive.jobId],
      ),
      "queued",
    );
  } finally {
    await db.close();
  }
});

test("static egress gate closes history and pre-gate reads without touching replies or commerce ledgers", async () => {
  const db = new PGlite();
  const migrationName = "20260828200500_gate_serverless_static_egress.sql";
  const cleanupMigrationName = "20260828201500_cleanup_static_egress_queued_reads.sql";
  const serverlessHash = "6".repeat(64);
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql")
        && name !== migrationName
        && name !== cleanupMigrationName)
      .sort();
    for (const name of migrationNames) {
      if (name === LEGACY_SCOPE_RETIREMENT_MIGRATION) continue;
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }

    await db.query(
      "insert into auth.users (id, email) values ($1, 'static-egress-admin@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Static Egress Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    const credentials = new Map();
    for (const channel of ["coupang", "smartstore"]) {
      const credentialId = await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          $1, 'production', $2::jsonb,
          now() + interval '180 days', 90, 30, 0
        )`,
        [channel, JSON.stringify({
          access_key: `${channel}-access`,
          secret_key: `${channel}-secret`,
          vendor_id: `${channel}-vendor`,
          client_id: `${channel}-client`,
          client_secret: `${channel}-client-secret`,
          token_type: "SELF",
        })],
      );
      credentials.set(channel, credentialId);
    }
    const activeRun = await scalar(
      db,
      "select public.sellerpilot_start_inquiry_history_backfill(30)",
    );
    assert.equal(activeRun.status, "queued");
    assert.equal(activeRun.queuedJobs, 27);

    const untouchedProductId = await scalar(
      db,
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, status, on_hand, cost_krw, demo
       ) values ($1, 'STATIC-EGRESS-PRODUCT', 'STATIC-EGRESS-SKU',
         '고정 egress 정리 비대상 상품', 'active', 3, 1000, false)
       returning id`,
      [ADMIN_ID],
    );
    const untouchedOrderId = await scalar(
      db,
      `insert into sellerpilot_private.commerce_orders (
         owner_id, external_order_id, channel_key, customer_name, product_id,
         product_name, quantity, amount, currency, amount_krw, status, ordered_at, demo
       ) values ($1, 'STATIC-EGRESS-ORDER', 'coupang', '정리 비대상 주문 고객', $2,
         '고정 egress 정리 비대상 상품', 1, 3000, 'KRW', 3000, 'paid', now(), false)
       returning id`,
      [ADMIN_ID, untouchedProductId],
    );

    await setClaims(db, "service_role");
    const coupangCredentialId = credentials.get("coupang");
    assert.equal(typeof coupangCredentialId, "string");
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_ingest_inquiries(
          $1, 'coupang', $2::jsonb
        )`,
        [coupangCredentialId, JSON.stringify([{
          externalTicketId: "product:987654321",
          customerName: "정리 비대상 문의 고객",
          subject: "정리 비대상 답변",
          message: "답변 작업은 그대로 남아야 합니다.",
          status: "waiting",
          priority: 2,
          receivedAt: "2026-08-28T00:00:00.000Z",
        }])],
      ),
      1,
    );
    const untouchedTicketId = await scalar(
      db,
      `select id
         from sellerpilot_private.support_tickets
        where owner_id = $1
          and channel_key = 'coupang'
          and external_ticket_id = 'product:987654321'`,
      [ADMIN_ID],
    );
    const untouchedReplyJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'coupang', '정리 비대상 답변입니다.', $2::jsonb
      )`,
      [untouchedTicketId, JSON.stringify({
        arguments: {
          kind: "product",
          inquiryId: "987654321",
          reply: "정리 비대상 답변입니다.",
        },
      })],
    );
    const untaggedRead = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'coupang', 'inquiries.list',
        '{"periodicKey":"inquiries:pre-gate-untagged-cleanup","arguments":{"kind":"product","query":{"pageNum":1}}}'::jsonb,
        5
      )`,
    );
    assert.equal(untaggedRead.status, "queued");
    const cleanupWorkerId = await scalar(
      db,
      `insert into sellerpilot_private.ai_cli_worker_tokens (
       label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values ('pre-gate cleanup ownership', $1, '888888888888', 'revoked',
         'gateway', clock_timestamp() + interval '1 day', $2)
       returning id`,
      ["8".repeat(64), ADMIN_ID],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set worker_token_id = $2,
              claim_token = '88888888-8888-4888-8888-888888888888',
              lease_expires_at = clock_timestamp() + interval '10 minutes'
        where id = $1 and status = 'queued'`,
      [untaggedRead.jobId, cleanupWorkerId],
    );
    await setClaims(db);

    await db.exec(await readFile(new URL(migrationName, migrationUrl), "utf8"));
    const blocked = await scalar(
      db,
      "select public.sellerpilot_get_inquiry_history_backfill($1)",
      [activeRun.runId],
    );
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedReason, "STATIC_EGRESS_REQUIRED");
    assert.equal(blocked.queuedJobs, 0);
    assert.equal(blocked.runningJobs, 0);
    assert.equal(blocked.failedJobs, 0);
    assert.deepEqual(
      (await db.query(
        `select status, error_message, count(*)::integer as count
           from sellerpilot_private.channel_gateway_jobs
          where request_payload #>> '{arguments,sellerpilotHistoryRunId}' = $1
          group by status, error_message`,
        [activeRun.runId],
      )).rows,
      [{ status: "failed", error_message: "STATIC_EGRESS_REQUIRED", count: 27 }],
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [untaggedRead.jobId],
      ),
      "queued",
    );

    const cleanupSql = await readFile(new URL(cleanupMigrationName, migrationUrl), "utf8");
    const historyBeforeCleanup = (await db.query(
      `select status, blocked_reason, total_jobs, queued_jobs, running_jobs,
              succeeded_jobs, failed_jobs, completed_at, updated_at
         from sellerpilot_private.inquiry_history_backfill_runs
        where id = $1`,
      [activeRun.runId],
    )).rows[0];
    const replyBeforeCleanup = (await db.query(
      `select status, error_message, worker_token_id, claim_token,
              lease_expires_at, completed_at, updated_at
         from sellerpilot_private.channel_gateway_jobs
        where id = $1`,
      [untouchedReplyJobId],
    )).rows[0];
    const ticketBeforeCleanup = await scalar(
      db,
      "select to_jsonb(ticket) from sellerpilot_private.support_tickets ticket where id = $1",
      [untouchedTicketId],
    );
    const productBeforeCleanup = await scalar(
      db,
      "select to_jsonb(product) from sellerpilot_private.products product where id = $1",
      [untouchedProductId],
    );
    const orderBeforeCleanup = await scalar(
      db,
      "select to_jsonb(orders) from sellerpilot_private.commerce_orders orders where id = $1",
      [untouchedOrderId],
    );

    await db.exec(cleanupSql);
    const cleanedRead = (await db.query(
      `select status, error_message, worker_token_id, claim_token,
              lease_expires_at, completed_at, updated_at
         from sellerpilot_private.channel_gateway_jobs
        where id = $1`,
      [untaggedRead.jobId],
    )).rows[0];
    assert.equal(cleanedRead.status, "failed");
    assert.equal(cleanedRead.error_message, "STATIC_EGRESS_REQUIRED");
    assert.equal(cleanedRead.worker_token_id, null);
    assert.equal(cleanedRead.claim_token, null);
    assert.equal(cleanedRead.lease_expires_at, null);
    assert.ok(cleanedRead.completed_at);
    assert.deepEqual(
      (await db.query(
        `select status, blocked_reason, total_jobs, queued_jobs, running_jobs,
                succeeded_jobs, failed_jobs, completed_at, updated_at
           from sellerpilot_private.inquiry_history_backfill_runs
          where id = $1`,
        [activeRun.runId],
      )).rows[0],
      historyBeforeCleanup,
    );
    assert.deepEqual(
      (await db.query(
        `select status, error_message, worker_token_id, claim_token,
                lease_expires_at, completed_at, updated_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [untouchedReplyJobId],
      )).rows[0],
      replyBeforeCleanup,
    );
    assert.deepEqual(
      await scalar(db, "select to_jsonb(ticket) from sellerpilot_private.support_tickets ticket where id = $1", [untouchedTicketId]),
      ticketBeforeCleanup,
    );
    assert.deepEqual(
      await scalar(db, "select to_jsonb(product) from sellerpilot_private.products product where id = $1", [untouchedProductId]),
      productBeforeCleanup,
    );
    assert.deepEqual(
      await scalar(db, "select to_jsonb(orders) from sellerpilot_private.commerce_orders orders where id = $1", [untouchedOrderId]),
      orderBeforeCleanup,
    );

    await db.exec(cleanupSql);
    assert.deepEqual(
      (await db.query(
        `select status, error_message, worker_token_id, claim_token,
                lease_expires_at, completed_at, updated_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [untaggedRead.jobId],
      )).rows[0],
      cleanedRead,
    );
    const jobCountBeforeRetry = await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs",
    );
    await assert.rejects(
      scalar(db, "select public.sellerpilot_start_inquiry_history_backfill(30)"),
      /STATIC_EGRESS_REQUIRED/,
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"),
      jobCountBeforeRetry,
    );

    await setClaims(db, "service_role");
    const blockedEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'coupang', 'inquiries.list',
        '{"periodicKey":"inquiries:static-egress-test","arguments":{"kind":"product","query":{"pageNum":1}}}'::jsonb,
        5
      )`,
    );
    assert.equal(blockedEnqueue.status, "fixed_egress_required");
    assert.equal(blockedEnqueue.blockedReason, "STATIC_EGRESS_REQUIRED");
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_serverless_static_egress_status()"),
      { coupang: false, smartstore: false },
    );
    const jobCountBeforeBlockedReply = await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs",
    );
    for (const channel of ["coupang", "smartstore"]) {
      await assert.rejects(
        scalar(
          db,
          `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
            '11111111-1111-4111-8111-111111111111', $1,
            '전송하지 않는 테스트 답변', '{}'::jsonb
          )`,
          [channel],
        ),
        /STATIC_EGRESS_REQUIRED/,
      );
    }
    assert.equal(
      await scalar(db, "select count(*)::integer from sellerpilot_private.channel_gateway_jobs"),
      jobCountBeforeBlockedReply,
    );

    await db.query(
      "update sellerpilot_private.serverless_static_egress_policy set enabled = true, updated_at = clock_timestamp()",
    );
    const queued = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'coupang', 'inquiries.list',
        '{"periodicKey":"inquiries:static-egress-enabled","arguments":{"kind":"product","query":{"pageNum":1}}}'::jsonb,
        5
      )`,
    );
    assert.equal(queued.status, "queued");
    const genericGatewayHash = "7".repeat(64);
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values ('generic gateway must not claim Korean CS', $1, '777777777777',
         'active', 'gateway', clock_timestamp() + interval '1 day', $2)`,
      [genericGatewayHash, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'static-egress/generic-no-fallback')",
        [genericGatewayHash],
      ),
      null,
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values ('static egress serverless worker', $1, '666666666666',
         'active', 'serverless_cs', clock_timestamp() + interval '1 day', $2)`,
      [serverlessHash, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_cs_job($1, 'static-egress/no-header')",
        [serverlessHash],
      ),
      null,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"coupang,smartstore"}',
        false
      )`,
    );
    const claimed = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_cs_job($1, 'static-egress/enabled')",
      [serverlessHash],
    );
    assert.equal(
      [untouchedReplyJobId, queued.jobId].includes(claimed.id),
      true,
    );
    assert.equal(claimed.channel, "coupang");
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
      "select public.sellerpilot_issue_ai_worker_token('oauth worker', $1, 'AAAAAAAAAAAA', now() + interval '30 days', 'gateway')",
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
        '{"client_id":"oauth-client","client_secret":"oauth-secret","ru_name":"oauth-redirect","access_token":"new-access-token","refresh_token":"new-refresh-token","provider_account_identity_version":"v1","provider_account_subject":"ebay:eias:immutable-test-eias-token"}'::jsonb,
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
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_prepare_gateway_credential_refresh(
          $1, $2, $3,
          '{"client_id":"sandbox-client","client_secret":"sandbox-secret","ru_name":"sandbox-redirect","access_token":"recovered-access-token","refresh_token":"recovered-refresh-token","provider_account_identity_version":"v1","provider_account_subject":"ebay:eias:unverified-stale-subject"}'::jsonb,
          '2099-01-01T00:00:00.000Z'::timestamptz,
          true,
          false
        )`,
        [TOKEN_HASH, inFlightJobId, inFlightClaim.claim_token],
      ),
      { status: "invalid" },
    );
    assert.equal(
      await scalar(
        db,
        "select credential_refresh_recovery_vault_id is null from sellerpilot_private.channel_gateway_jobs where id = $1",
        [inFlightJobId],
      ),
      true,
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_prepare_gateway_credential_refresh(
          $1, $2, $3,
          '{"client_id":"sandbox-client","client_secret":"sandbox-secret","ru_name":"sandbox-redirect","access_token":"recovered-access-token","refresh_token":"recovered-refresh-token"}'::jsonb,
          '2099-01-01T00:00:00.000Z'::timestamptz,
          true,
          false
        )`,
        [TOKEN_HASH, inFlightJobId, inFlightClaim.claim_token],
      ),
      { status: "recovery_preserved", reused: false },
    );
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
              credential_refresh_recovery_vault_id is not null as recovery_preserved,
              oauth_request_vault_id is null as grant_scrubbed
         from sellerpilot_private.channel_gateway_jobs where id = $1`,
      [inFlightJobId],
    )).rows, [{
      status: "reconciliation_required",
      credential_refresh_in_flight: false,
      recovery_preserved: true,
      grant_scrubbed: true,
    }]);

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
        '{"client_id":"oauth-client","client_secret":"oauth-secret","ru_name":"oauth-redirect","access_token":"partial-access-token","refresh_token":"partial-refresh-token","provider_account_identity_version":"v1","provider_account_subject":"ebay:eias:immutable-test-eias-token"}'::jsonb,
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
    assert.equal(await scalar(
      db,
      "select public.sellerpilot_service_begin_gateway_credential_refresh($1, $2, $3)",
      [TOKEN_HASH, unrelatedLazadaJobId, unrelatedClaim.claim_token],
    ), true);
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_prepare_gateway_credential_refresh(
          $1, $2, $3,
          '{"app_key":"test-app","app_secret":"test-secret","access_token":"lazada-recovered-access","refresh_token":"lazada-recovered-refresh","country_user_info":[{"country":"my","seller_id":"1001","user_id":"2001"}],"account_platform":"seller_center"}'::jsonb,
          '2099-01-01T00:00:00.000Z'::timestamptz,
          true,
          false
        )`,
        [TOKEN_HASH, unrelatedLazadaJobId, unrelatedClaim.claim_token],
      ),
      { status: "recovery_preserved", reused: false },
    );
    assert.equal(
      await scalar(
        db,
        "select credential_refresh_recovery_vault_id is not null from sellerpilot_private.channel_gateway_jobs where id = $1",
        [unrelatedLazadaJobId],
      ),
      true,
    );
    assert.deepEqual((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
      [blockedEbayJobId],
    )).rows, [{ status: "queued" }]);
  } finally {
    await db.close();
  }
});

test("TracX binding rollout backfills only exact typed credential evidence and blocks unsafe live orders", async () => {
  const db = new PGlite();
  const ownerId = "90a86908-8eb1-4b84-99f6-00d9b8db1fc1";
  const exactOrderId = "4594552f-c965-4b64-b62b-0b4974bf745f";
  const ambiguousOrderId = "12f00de7-63b6-49d7-92bb-81bf22fcba6e";
  const unsafeOrderId = "4f6bd5f6-2ab5-42bd-99b1-272788efac82";
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const rolloutName = "20260826090700_add_explicit_tracx_order_bindings.sql";
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql") && name < rolloutName)
      .sort();
    for (const name of migrationNames) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }

    await db.query("insert into auth.users (id, email) values ($1, 'tracx-rollout@example.test')", [ownerId]);
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'TracX Rollout Admin')",
      [ownerId],
    );
    await setClaims(db, "authenticated", ownerId);
    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'tracx', 'production',
        '{"api_key":"rollout-test-key","webhook_secret":"12345678901234567890123456789012"}'::jsonb,
        null, 90, 30, 7
      )`,
    );

    await db.query(
      `insert into sellerpilot_private.commerce_orders (
        id, owner_id, external_order_id, channel_key, customer_name, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo,
        logistics_provider, logistics_reference
      ) values
        ($1, $3, 'EXACT-MARKETPLACE-ORDER', 'qoo10', 'Exact customer', 'Exact product',
         1, 1000, 'KRW', 1000, 'shipped', now() - interval '2 days', false,
         'tracx', 'HIST-PACK-EXACT'),
        ($2, $3, 'AMBIGUOUS-MARKETPLACE-ORDER', 'qoo10', 'Ambiguous customer', 'Ambiguous product',
         1, 1000, 'KRW', 1000, 'delivered', now() - interval '2 days', false,
         'tracx', 'HIST-AMBIGUOUS')`,
      [exactOrderId, ambiguousOrderId, ownerId],
    );
    await setClaims(db, "service_role", ownerId);
    await db.query(
      `insert into sellerpilot_private.tracx_delivery_events (
        owner_id, credential_id, event_key, packing_no, tracking_no,
        reference_order_no, status_code, status_desc, event_at, order_id
      ) values
        ($1, $2, $3, 'HIST-PACK-EXACT', 'HIST-TRACK-EXACT', null,
         'D4', 'Delivered exact', now() - interval '1 day', null),
        ($1, $2, $4, 'HIST-AMBIGUOUS', null, 'HIST-AMBIGUOUS',
         'D4', 'Ambiguous namespaces', now() - interval '1 day', null)`,
      [ownerId, credentialId, "8".repeat(64), "9".repeat(64)],
    );

    const rollout = withoutUnavailableExtensions(
      await readFile(new URL(rolloutName, migrationUrl), "utf8"),
    );
    await db.exec(rollout);

    assert.deepEqual(
      (await db.query(
        `select binding.order_id::text,
                binding.order_owner_id::text,
                binding.reference_kind,
                binding.reference_value,
                binding.bound_with_credential_id::text,
                binding.binding_source,
                binding.created_by::text
           from sellerpilot_private.tracx_order_bindings binding`,
      )).rows,
      [{
        order_id: exactOrderId,
        order_owner_id: ownerId,
        reference_kind: "packing_no",
        reference_value: "HIST-PACK-EXACT",
        bound_with_credential_id: credentialId,
        binding_source: "historical_event_v1",
        created_by: null,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select event.order_id::text, event.owner_id::text,
                event.binding_id is not null as bound
           from sellerpilot_private.tracx_delivery_events event
          where event.packing_no = 'HIST-PACK-EXACT'`,
      )).rows,
      [{ order_id: exactOrderId, owner_id: ownerId, bound: true }],
    );
    assert.deepEqual(
      (await db.query(
        `select status, tracking_number, delivery_status_code
           from sellerpilot_private.commerce_orders where id = $1`,
        [exactOrderId],
      )).rows,
      [{ status: "delivered", tracking_number: "HIST-TRACK-EXACT", delivery_status_code: "D4" }],
    );
    assert.deepEqual(
      (await db.query(
        `select event.order_id::text, event.binding_id::text
           from sellerpilot_private.tracx_delivery_events event
          where event.packing_no = 'HIST-AMBIGUOUS'`,
      )).rows,
      [{ order_id: null, binding_id: null }],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.tracx_order_bindings where order_id = $1",
        [ambiguousOrderId],
      ),
      0,
    );

    await db.query(
      `insert into sellerpilot_private.commerce_orders (
        id, owner_id, external_order_id, channel_key, customer_name, product_name,
        quantity, amount, currency, amount_krw, status, ordered_at, demo,
        logistics_provider, logistics_reference
      ) values (
        $1, $2, 'UNSAFE-MARKETPLACE-ORDER', 'qoo10', 'Unsafe customer', 'Unsafe product',
        1, 1000, 'KRW', 1000, 'ready_to_ship', now(), false,
        'tracx', 'UNKNOWN-UNTYPED-REFERENCE'
      )`,
      [unsafeOrderId, ownerId],
    );
    await assert.rejects(db.exec(rollout), /nonterminal TracX orders require an exact typed binding before rollout/);
    await db.exec("rollback").catch(() => undefined);
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.commerce_orders where id = $1", [unsafeOrderId]),
      1,
    );
    assert.equal(
      await scalar(db, "select count(*) from sellerpilot_private.tracx_order_bindings where order_id = $1", [unsafeOrderId]),
      0,
    );
  } finally {
    await db.close();
  }
});
