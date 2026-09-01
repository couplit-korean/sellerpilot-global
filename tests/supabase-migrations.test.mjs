import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const REVISION_FALLBACK_SPOOF_JOB_ID = "df3ce09d-ad1f-4388-99d8-16cd7d6da6fb";
const NEXT_PRODUCT_REVISION_JOB_ID = "6bf1f902-3298-4c9c-ab55-9670b838706d";
const STALE_PRODUCT_REVISION_JOB_ID = "3a7780db-a4cb-46d6-a74a-5d71388e6838";
const ABANDONED_PRODUCT_REVISION_JOB_ID = "231326b1-884d-4757-bcae-2a50ce559839";
const PRIVATE_RESEARCH_RETRY_JOB_ID = "2b90a2d7-3754-4b65-89c6-c386967a90cc";
const RETRY_CLOCK_JOB_ID = "55261a19-9394-4d0c-a8b5-8d6d53dc88f0";
const SHARED_PRODUCT_ID = "4a346497-84c8-4ccd-bf14-8f06f990a2f7";
const READINESS_FAILED_JOB_ID = "617d6da4-d646-4625-ad8a-0c18eab7f3c6";
const LOCAL_NON_PRODUCT_CLAIM_JOB_ID = "4e28db19-c6bf-47e7-b5ce-6e1f73ca3f9d";
const LOCAL_PRODUCT_FENCE_JOB_ID = "a8727399-727f-483c-b4bd-f2c9fd236da1";
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
const SHOPEE_STATIC_EGRESS_MIGRATION = "20260830200000_require_static_egress_for_shopee.sql";
const CS_REPLY_LEDGER_MIGRATION = "20260831033000_add_cs_message_delivery_ledger.sql";
const QOO10_SCOPED_GATE_MIGRATION =
  "20260831050000_channel_scoped_qoo10_publication_gate.sql";
const QOO10_SCOPED_PROVIDER_CHAIN_MIGRATION =
  "20260831053500_rebind_qoo10_scoped_provider_mutation_chain.sql";
const QOO10_ADULTYN_RECONCILIATION_MIGRATION =
  "20260831055000_reconcile_exact_qoo10_adultyn_rejection.sql";
const QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION =
  "20260831056000_allow_exact_qoo10_adultyn_retry_identity.sql";
const QOO10_EXACT_PREPROVIDER_RESUME_MIGRATION =
  "20260831056500_resume_exact_qoo10_preprovider_job.sql";
const QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION =
  "20260831056600_correct_exact_qoo10_resume_payload_contract.sql";
const QOO10_EXACT_S1_ACTIVATION_MIGRATION =
  "20260831056700_recover_exact_qoo10_s1_activation.sql";
const QOO10_EXACT_S1_VERIFIER_OVERLAP_MIGRATION =
  "20260831056800_allow_exact_qoo10_s1_verifier_overlap.sql";
const QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION =
  "20260831056900_accept_exact_qoo10_heading_normalization.sql";
const QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION =
  "20260831057000_retire_stale_qoo10_s1_verifier.sql";
const QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION =
  "20260831057100_prioritize_exact_qoo10_s1_activation_claim.sql";
const QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION =
  "20260831057200_allow_exact_qoo10_s1_activation_provider_boundary.sql";
const QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION =
  "20260831057300_retire_failed_exact_qoo10_s1_activation_permit.sql";
const TEMU_PUBLICATION_RELEASE_MIGRATION =
  "20260831133000_expand_verified_publication_to_temu.sql";
const COMPETITOR_PRICE_V3_MIGRATION =
  "20260831130000_competitor_price_v3.sql";
const COMPETITOR_MATCH_REVIEW_MIGRATION =
  "20260831131000_competitor_match_review_ledger.sql";
const COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION =
  "20260831131500_retire_pre_v3_competitor_search_queue.sql";
const COMPETITOR_QUEUE_RETIREMENT_PRODUCTION_DIGESTS = {
  queueDigest: "cf636a14eb69f3260e1eb24077da87bd8f7d479d1e467303e51535955b3c3ed4",
  fullRows: "a02c9210ce1be866bf721835b948ca09649505772f5c2783856d9c56001a8c82",
  requestPayloads: "06a78b54eaa1a1782a5a1fa7b11b78eb781bedc7e34c570621ce0aa135734d9e",
  linkages: "6a3e43d2c15c6f72f9919a10785170aa004e156ede2060c311ab1fb5e0309565",
};
const COMPETITOR_IDENTITY_LINEAGE_MIGRATION =
  "20260831132000_competitor_identity_lineage_fence.sql";
const SMARTSTORE_EXACT_QA_RECOVERY_MIGRATION =
  "20260831132018_smartstore_exact_qa_recovery_fence.sql";
const COUPANG_EXACT_QA_RECOVERY_MIGRATION =
  "20260831140000_coupang_exact_qa_recovery_fence.sql";
const EBAY_EXACT_EXISTING_QA_RECOVERY_MIGRATION =
  "20260831143000_ebay_exact_existing_qa_recovery_fence.sql";
const QOO10_EXACT_LOCALIZATION_V2_MIGRATION =
  "20260831144000_generalize_qoo10_exact_localization_s1_activation.sql";
const SMARTSTORE_NONSTATIC_EGRESS_MIGRATION =
  "20260831145000_release_smartstore_from_static_egress.sql";
const TEMU_EXACT_CABLE_MIGRATION =
  "20260831146000_temu_exact_cable_clips.sql";
const QOO10_EXACT_CLOSED_GATE_REACHABILITY_MIGRATION =
  "20260831195108_reach_exact_qoo10_localization_through_closed_gate.sql";
const SMARTSTORE_EXACT_CLOSED_GATE_PERMIT_MIGRATION =
  "20260901053500_allow_exact_smartstore_update_through_closed_gate.sql";
const SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION =
  "20260901070000_correct_smartstore_representative_filename.sql";
const EXACT_EXISTING_CLOSED_GATE_PERMIT_MIGRATION =
  "20260901080000_allow_exact_existing_updates_through_closed_gate.sql";
const QOO10_RELEASE_STATUS_RECORD_INITIALIZATION_MIGRATION =
  "20260901081000_initialize_qoo10_release_status_records.sql";
const EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MIGRATION =
  "20260901081500_backfill_exact_domestic_market_targets.sql";
const EBAY_CURRENT_CREDENTIAL_FENCE_MIGRATION =
  "20260901082000_bind_ebay_exact_update_to_current_active_credential.sql";
const COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_MIGRATION =
  "20260901082500_reconcile_coupang_exact_pre_gateway_failure.sql";
const QOO10_NO_REMOTE_EFFECT_RECONCILIATION_MIGRATION =
  "20260901083000_reconcile_exact_qoo10_uncertain_no_remote_effect.sql";
const QOO10_NO_EFFECT_LEGACY_PAYLOAD_MIGRATION =
  "20260901084000_bind_qoo10_no_effect_legacy_fac9_payload.sql";
const QOO10_PARTIAL_MANUAL_RECONCILIATION_MIGRATION =
  "20260901085000_reconcile_qoo10_partial_manual_activation.sql";
const SMARTSTORE_STATIC_EGRESS_RESTORATION_MIGRATION =
  "20260901120000_restore_smartstore_static_egress_fence.sql";
const ELEVENST_MANUAL_LIVE_RECONCILIATION_MIGRATION =
  "20260901130000_reconcile_exact_elevenst_manual_live_readback.sql";
const EXACT_EXISTING_ENQUEUED_LINEAGE_PHASE_MIGRATION =
  "20260901140000_fix_exact_update_enqueued_lineage_phase.sql";
const EXACT_EXISTING_DEFERRED_JOB_LINEAGE_MIGRATION =
  "20260901150000_fix_exact_update_deferred_job_lineage.sql";
const LAZADA_TARGET_SYNC_DEDUPLICATION_MIGRATION =
  "20260901151000_idempotent_lazada_target_sync.sql";
const COUPANG_UNCLAIMED_STATIC_EGRESS_RECONCILIATION_MIGRATION =
  "20260901160000_reconcile_exact_coupang_unclaimed_static_egress_job.sql";
const EBAY_EXACT_QA_RPC_EXPOSURE_MIGRATION =
  "20260901163000_expose_ebay_exact_qa_recovery_rpc.sql";
const EBAY_SERVERLESS_LISTING_UPDATE_MIGRATION =
  "20260901164500_expose_ebay_serverless_listing_update.sql";
const EBAY_DETERMINISTIC_NO_EFFECT_RETRY_MIGRATION =
  "20260901165500_recover_ebay_deterministic_no_effect_retry.sql";
const EBAY_NO_EFFECT_TERMINAL_PROOF_CORRECTION_MIGRATION =
  "20260901165700_correct_ebay_no_effect_terminal_source_proof.sql";
const EBAY_EXACT_PRE_GATEWAY_RETRY_MIGRATION =
  "20260901165800_recover_ebay_exact_pre_gateway_retry.sql";
const EBAY_EXACT_CREDENTIAL_ROTATION_MIGRATION =
  "20260901165900_recover_ebay_exact_credential_rotation.sql";
const SMARTSTORE_ACTIVE_IDENTITY_ALIGNMENT_MIGRATION =
  "20260901171000_align_smartstore_exact_active_identity.sql";
const SHOPEE_SG_EXISTING_ADOPTION_MIGRATION =
  "20260901171500_adopt_exact_shopee_sg_existing_item.sql";
const LAZADA_EXACT_LIVE_ADOPTION_MIGRATION =
  "20260901173000_adopt_exact_lazada_live_listing.sql";
const EXACT_ADOPTION_COMPLETION_MERGE_MIGRATION =
  "20260901173100_merge_shopee_lazada_exact_adoption_completion.sql";
const TEMU_EXACT_EXISTING_ACTIVE_ADOPTION_MIGRATION =
  "20260901173200_exact_temu_existing_active_adoption.sql";
const TEMU_EXACT_CREDENTIAL_CERTIFICATION_MIGRATION =
  "20260901173300_certify_exact_temu_existing_adoption_credential.sql";
const QOO10_ALREADY_LIVE_ADOPTION_MIGRATION =
  "20260901173400_adopt_exact_qoo10_already_live_readback.sql";
const QOO10_ADOPTED_LOCALIZATION_UPDATE_MIGRATION =
  "20260901173500_fence_exact_qoo10_adopted_localization_update.sql";
const QOO10_ADOPTION_CREDENTIAL_LINEAGE_FIX_MIGRATION =
  "20260901173600_align_exact_qoo10_adoption_credential_lineage.sql";
const EBAY_EXACT_CONTENT_FENCE_MIGRATION =
  "20260901040027_harden_ebay_exact_existing_qa_language_and_image_fence.sql";
const ELEVENST_EXACT_SNAPSHOT_FORWARD_MIGRATION =
  "20260901044230_recover_exact_elevenst_snapshot_forward.sql";
const EBAY_EXACT_PROVIDER_COPY_MIGRATION =
  "20260901050509_preserve_ebay_exact_provider_copy.sql";
const ELEVENST_SNAPSHOT_RECOVERY_MIGRATION =
  "20260831054000_recover_elevenst_listing_snapshot.sql";
const UNRECORDED_QOO10_SCHEMA_MIGRATIONS = new Set([
  "20260830222257_confirm_qoo10_listing_create_rollback.sql",
  "20260831010000_resolve_exact_qoo10_origin_type_rejection.sql",
]);
const PUBLICATION_RELEASE_SHA = "a".repeat(40);

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
create or replace function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
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
    $1, null, $2, $3, $4
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
as $$
  select case
    when lower(algorithm) = 'sha256'
      then sha256(convert_to(value, 'UTF8'))
    else convert_to(md5(value || algorithm), 'UTF8')
  end
$$;
create or replace function extensions.digest(value bytea, algorithm text)
returns bytea
language sql
immutable
as $$
  select case
    when lower(algorithm) = 'sha256' then sha256(value)
    else sha256(value || convert_to(algorithm, 'UTF8'))
  end
$$;
`;

function withoutUnavailableExtensions(sql, { injectQoo10History = true } = {}) {
  const normalized = sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
  if (!injectQoo10History) return normalized;
  const isHeadingNormalization = normalized.includes(
    "exact Qoo10 heading-normalization migration history drifted",
  );
  const isStaleVerifierRetirement = normalized.includes(
    "exact Qoo10 verifier retirement migration history drifted",
  );
  const isExactActivationClaimPriority = normalized.includes(
    "exact Qoo10 activation priority migration history drifted",
  );
  const isExactActivationProviderBoundary = normalized.includes(
    "exact Qoo10 S1 provider-boundary preimage drifted",
  );
  const isFailedPreproviderPermitRetirement = normalized.includes(
    "exact Qoo10 failed-permit migration history drifted",
  );
  const isPreV3CompetitorQueueRetirement = normalized.includes(
    "competitor queue retirement migration history drifted",
  );
  if (
    !isHeadingNormalization
    && !isStaleVerifierRetirement
    && !isExactActivationClaimPriority
    && !isExactActivationProviderBoundary
    && !isFailedPreproviderPermitRetirement
    && !isPreV3CompetitorQueueRetirement
  ) return normalized;
  const retirementPredecessor = isStaleVerifierRetirement
    ? ",\n      ('20260831056900','{}'::text[],'accept_exact_qoo10_heading_normalization')"
    : "";
  const claimPriorityPredecessors = isExactActivationClaimPriority
    ? ",\n      ('20260831056900','{}'::text[],'accept_exact_qoo10_heading_normalization')"
      + ",\n      ('20260831057000','{}'::text[],'retire_stale_qoo10_s1_verifier')"
    : "";
  const providerBoundaryPredecessors = isExactActivationProviderBoundary
    ? ",\n      ('20260831056900','{}'::text[],'accept_exact_qoo10_heading_normalization')"
      + ",\n      ('20260831057000','{}'::text[],'retire_stale_qoo10_s1_verifier')"
      + ",\n      ('20260831057100','{}'::text[],'prioritize_exact_qoo10_s1_activation_claim')"
    : "";
  const failedPermitPredecessors = isFailedPreproviderPermitRetirement
    ? ",\n      ('20260831056900','{}'::text[],'accept_exact_qoo10_heading_normalization')"
      + ",\n      ('20260831057000','{}'::text[],'retire_stale_qoo10_s1_verifier')"
      + ",\n      ('20260831057100','{}'::text[],'prioritize_exact_qoo10_s1_activation_claim')"
      + ",\n      ('20260831057200','{}'::text[],'allow_exact_qoo10_s1_activation_provider_boundary')"
    : "";
  const competitorQueuePredecessors = isPreV3CompetitorQueueRetirement
    ? ",\n      ('20260831130000','{}'::text[],'competitor_price_v3')"
      + ",\n      ('20260831131000','{}'::text[],'competitor_match_review_ledger')"
    : "";
  return `
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[] not null default '{}'::text[],
      name text
    );
    insert into supabase_migrations.schema_migrations(version,statements,name)
    values
      ('20260831056700','{}'::text[],'recover_exact_qoo10_s1_activation'),
      ('20260831056800','{}'::text[],'allow_exact_qoo10_s1_verifier_overlap')${retirementPredecessor}${claimPriorityPredecessors}${providerBoundaryPredecessors}${failedPermitPredecessors}${competitorQueuePredecessors}
    on conflict (version) do nothing;
    ${normalized}
  `;
}

// This one broad integration flow deliberately exercises the historical
// pre-retirement combined-worker bridge and then applies 150000 itself near
// the end. Keep only that historical fixture on the pre-final scope contract;
// serverless-runtime-release-fence-migration.test.mjs applies and executes the
// real final fence against both the observed production shape and live leases.
function withoutFinalStrictWorkerScopeFence(sql) {
  const start = sql.indexOf("-- BEGIN:strict-worker-scope-final-fence");
  const endMarker = "-- END:strict-worker-scope-final-fence";
  const end = sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "final strict worker-scope fence must be present");
  const historical = `${sql.slice(0, start)}${sql.slice(end + endMarker.length)}`
    .replace(
      "token.scope = 'gateway'\n         or (\n           token.scope = 'serverless_cs'",
      "token.scope in ('gateway', 'legacy_combined')\n         or (\n           token.scope = 'serverless_cs'",
    )
    .replace(
      "where token.token_hash = p_token_hash\n     and token.scope = 'ai'\n     and token.status = 'active'\n     and token.expires_at > clock_timestamp()\n   for update;",
      "where token.token_hash = p_token_hash\n     and token.scope in ('ai', 'legacy_combined')\n     and token.status = 'active'\n     and token.expires_at > clock_timestamp()\n   for update;",
    );
  assert.match(historical, /token\.scope in \('gateway', 'legacy_combined'\)/);
  assert.match(historical, /token\.scope in \('ai', 'legacy_combined'\)/);
  return historical;
}

async function setClaims(db, role = "authenticated", userId = ADMIN_ID) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function competitorQueueRetirementDigests(db) {
  return (await db.query(`
    select
      count(*)::integer as "targetCount",
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.status || ':' || target.periodic_key,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as "queueDigest",
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.row_sha,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as "fullRows",
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.request_sha,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as "requestPayloads",
      encode(extensions.digest(coalesce(string_agg(
        target.id::text || ':' || target.link_count::text || ':' ||
          target.linkage_sha,
        ',' order by target.id
      ), ''), 'sha256'), 'hex') as linkages
    from (
      select
        job.id,
        job.status,
        coalesce(job.request_payload->>'periodicKey', '') periodic_key,
        encode(extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex') row_sha,
        encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') request_sha,
        coalesce(linkage.link_count, 0) link_count,
        coalesce(linkage.linkage_sha,
          encode(extensions.digest('', 'sha256'), 'hex')) linkage_sha
      from sellerpilot_private.channel_gateway_jobs job
      cross join lateral (
        select count(*) link_count,
               encode(extensions.digest(coalesce(string_agg(
                 claim.product_id::text || ':' ||
                   coalesce(claim.gateway_periodic_key, ''),
                 ',' order by claim.product_id
               ), ''), 'sha256'), 'hex') linkage_sha
          from sellerpilot_private.competitor_price_refresh_claims claim
         where claim.gateway_job_id = job.id
      ) linkage
      where job.channel='elevenst'
        and job.operation='competitor.search'
        and job.status in ('queued','running')
    ) target
  `)).rows[0];
}

async function attestPublicationRelease(
  db,
  releaseSha = PUBLICATION_RELEASE_SHA,
  channels = [
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu",
  ],
) {
  for (const channel of channels) {
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready($1,true,$2)",
      [channel, releaseSha],
    );
  }
  await db.query(
    "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
    [releaseSha],
  );
}

async function activatePublicationRuntimeRelease(db, releaseSha = PUBLICATION_RELEASE_SHA) {
  await db.query(
    `insert into sellerpilot_private.serverless_runtime_canary_receipts (
       release_id, passed_at, consumed_at
     ) values ($1, clock_timestamp(), clock_timestamp())`,
    [releaseSha],
  );
  await db.query(
    `update cron.job
        set active = true
      where jobname in (
        'sellerpilot-serverless-cs-wake-v1',
        'sellerpilot-product-research-v1',
        'sellerpilot-channel-sync-v1',
        'sellerpilot-competitor-prices-v1',
        'sellerpilot-kakao-notifications-v1',
        'sellerpilot-maintenance-v1'
      )`,
  );
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

function aiClaimAssetDigests(paths) {
  return Object.fromEntries(Object.entries(paths).map(([role, path]) => [
    role,
    createHash("sha256").update(path, "utf8").digest("hex"),
  ]));
}

test("Supabase migrations apply in order and core RPC flows persist safely", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);
    await db.exec(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text primary key,
        statements text[] not null default '{}'::text[],
        name text
      );
    `);

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
      "20260828210000_non_cs_release_integrity.sql",
      "20260829031000_bound_server_product_studio_concurrency.sql",
      "20260829080000_create_manual_mvp_products.sql",
      "20260829080317_fail_closed_overseas_listing_create.sql",
      "20260829114703_accept_server_product_research_completion.sql",
      "20260829165803_enforce_category_publication_environment_and_market.sql",
      "20260830052516_allow_legacy_ebay_diagnostic_attestation.sql",
      "20260830054851_certify_provider_identity_on_service_refresh.sql",
      "20260830062415_recover_exact_lazada_credential_snapshot.sql",
      "20260830090000_recover_product_research_context.sql",
      "20260830095000_close_listing_mutations_until_adapters_ready.sql",
      "20260830100000_verified_remote_publication_ledger.sql",
      "20260830110000_pending_publication_reverification.sql",
      "20260830114500_approve_exact_detail_image_manifest.sql",
      "20260830121000_listing_publication_verification_source.sql",
      "20260830122000_attest_product_revision_fallback.sql",
      "20260830123000_bind_immutable_ebay_offer_identity.sql",
      "20260830132944_allow_failed_ebay_lineage_discovery.sql",
      "20260830141500_unblock_shopee_identity_reauthorization.sql",
      "20260830171000_discard_rejected_lazada_recovery_for_oauth.sql",
      "20260830183000_allow_fresh_lazada_oauth_past_safe_refresh_reconciliation.sql",
      "20260830200000_require_static_egress_for_shopee.sql",
      "20260830203000_record_lazada_oauth_provider_call_boundary.sql",
      "20260830204000_allow_fresh_lazada_oauth_past_oauth_reconciliation.sql",
      "20260830205000_restore_verified_listing_intent_after_effective_gate.sql",
      "20260830212500_retry_failed_pre_gateway_listing_attempts.sql",
      "20260830222257_confirm_qoo10_listing_create_rollback.sql",
      "20260831010000_resolve_exact_qoo10_origin_type_rejection.sql",
      CS_REPLY_LEDGER_MIGRATION,
      "20260831040000_rebind_ebay_periodic_inquiry_reads.sql",
      "20260831045000_gate_temu_periodic_inquiry_static_egress.sql",
      QOO10_SCOPED_GATE_MIGRATION,
      "20260831052500_reconcile_exact_qoo10_preprovider_gate_denial.sql",
      QOO10_SCOPED_PROVIDER_CHAIN_MIGRATION,
      ELEVENST_SNAPSHOT_RECOVERY_MIGRATION,
      QOO10_ADULTYN_RECONCILIATION_MIGRATION,
      QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION,
      QOO10_EXACT_PREPROVIDER_RESUME_MIGRATION,
      QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION,
      QOO10_EXACT_S1_ACTIVATION_MIGRATION,
      QOO10_EXACT_S1_VERIFIER_OVERLAP_MIGRATION,
      QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION,
      QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION,
      QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION,
      QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION,
      QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION,
      COMPETITOR_PRICE_V3_MIGRATION,
      COMPETITOR_MATCH_REVIEW_MIGRATION,
      COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION,
      COMPETITOR_IDENTITY_LINEAGE_MIGRATION,
      SMARTSTORE_EXACT_QA_RECOVERY_MIGRATION,
      TEMU_PUBLICATION_RELEASE_MIGRATION,
      COUPANG_EXACT_QA_RECOVERY_MIGRATION,
      EBAY_EXACT_EXISTING_QA_RECOVERY_MIGRATION,
      QOO10_EXACT_LOCALIZATION_V2_MIGRATION,
      SMARTSTORE_NONSTATIC_EGRESS_MIGRATION,
      TEMU_EXACT_CABLE_MIGRATION,
      QOO10_EXACT_CLOSED_GATE_REACHABILITY_MIGRATION,
      EBAY_EXACT_CONTENT_FENCE_MIGRATION,
      ELEVENST_EXACT_SNAPSHOT_FORWARD_MIGRATION,
      EBAY_EXACT_PROVIDER_COPY_MIGRATION,
      SMARTSTORE_EXACT_CLOSED_GATE_PERMIT_MIGRATION,
      SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION,
      EXACT_EXISTING_CLOSED_GATE_PERMIT_MIGRATION,
      QOO10_RELEASE_STATUS_RECORD_INITIALIZATION_MIGRATION,
      EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MIGRATION,
      EBAY_CURRENT_CREDENTIAL_FENCE_MIGRATION,
      COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_MIGRATION,
      QOO10_NO_REMOTE_EFFECT_RECONCILIATION_MIGRATION,
      QOO10_NO_EFFECT_LEGACY_PAYLOAD_MIGRATION,
      QOO10_PARTIAL_MANUAL_RECONCILIATION_MIGRATION,
      "20260901090000_fix_coupang_exact_sanitized_enqueue_contract.sql",
      SMARTSTORE_STATIC_EGRESS_RESTORATION_MIGRATION,
      "20260901125000_fix_coupang_exact_item_match_binding.sql",
      ELEVENST_MANUAL_LIVE_RECONCILIATION_MIGRATION,
      EXACT_EXISTING_ENQUEUED_LINEAGE_PHASE_MIGRATION,
      EXACT_EXISTING_DEFERRED_JOB_LINEAGE_MIGRATION,
      LAZADA_TARGET_SYNC_DEDUPLICATION_MIGRATION,
      COUPANG_UNCLAIMED_STATIC_EGRESS_RECONCILIATION_MIGRATION,
      EBAY_EXACT_QA_RPC_EXPOSURE_MIGRATION,
      EBAY_SERVERLESS_LISTING_UPDATE_MIGRATION,
      EBAY_DETERMINISTIC_NO_EFFECT_RETRY_MIGRATION,
      EBAY_NO_EFFECT_TERMINAL_PROOF_CORRECTION_MIGRATION,
      EBAY_EXACT_PRE_GATEWAY_RETRY_MIGRATION,
      EBAY_EXACT_CREDENTIAL_ROTATION_MIGRATION,
      SMARTSTORE_ACTIVE_IDENTITY_ALIGNMENT_MIGRATION,
      SHOPEE_SG_EXISTING_ADOPTION_MIGRATION,
      LAZADA_EXACT_LIVE_ADOPTION_MIGRATION,
      EXACT_ADOPTION_COMPLETION_MERGE_MIGRATION,
      TEMU_EXACT_EXISTING_ACTIVE_ADOPTION_MIGRATION,
      TEMU_EXACT_CREDENTIAL_CERTIFICATION_MIGRATION,
      QOO10_ALREADY_LIVE_ADOPTION_MIGRATION,
      QOO10_ADOPTED_LOCALIZATION_UPDATE_MIGRATION,
      QOO10_ADOPTION_CREDENTIAL_LINEAGE_FIX_MIGRATION,
    ]);
    assert.ok(
      migrationNames.indexOf(CS_REPLY_LEDGER_MIGRATION)
        < migrationNames.indexOf(QOO10_SCOPED_GATE_MIGRATION),
      "Qoo10 scoped gate must replay after the CS reply ledger",
    );
    assert.ok(
      migrationNames.indexOf(
        "20260831040000_rebind_ebay_periodic_inquiry_reads.sql",
      ) < migrationNames.indexOf(QOO10_SCOPED_GATE_MIGRATION),
      "Qoo10 scoped gate must replay after the eBay periodic inquiry rebind",
    );
    assert.ok(
      migrationNames.indexOf(
        "20260831045000_gate_temu_periodic_inquiry_static_egress.sql",
      ) < migrationNames.indexOf(QOO10_SCOPED_GATE_MIGRATION),
      "Qoo10 scoped gate must replay after the Temu periodic inquiry gate",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_SCOPED_GATE_MIGRATION)
        < migrationNames.indexOf(QOO10_SCOPED_PROVIDER_CHAIN_MIGRATION),
      "Qoo10 provider chain repair must replay after the scoped gate",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_SCOPED_PROVIDER_CHAIN_MIGRATION)
        < migrationNames.indexOf(QOO10_ADULTYN_RECONCILIATION_MIGRATION),
      "Qoo10 AdultYN exact reconciliation must replay after the provider-chain repair",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_ADULTYN_RECONCILIATION_MIGRATION)
        < migrationNames.indexOf(QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION),
      "Qoo10 AdultYN retry identity must replay after the exact reconciliation",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_PREPROVIDER_RESUME_MIGRATION),
      "exact Qoo10 pre-provider resume must replay after retry identity",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_PREPROVIDER_RESUME_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION),
      "corrected Qoo10 payload contract must replay after the one-shot resume",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_S1_ACTIVATION_MIGRATION),
      "exact Qoo10 S1 activation recovery must replay after the corrected source contract",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_S1_ACTIVATION_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_S1_VERIFIER_OVERLAP_MIGRATION),
      "the exact verifier overlap repair must replay after its recovery contract",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_S1_VERIFIER_OVERLAP_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION),
      "Qoo10 heading normalization must replay after the verifier overlap repair",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION)
        < migrationNames.indexOf(QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION),
      "stale Qoo10 verifier retirement must replay after heading normalization",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION),
      "exact Qoo10 activation claim priority must replay after stale verifier retirement",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION),
      "exact Qoo10 provider-boundary repair must replay after claim priority",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION)
        < migrationNames.indexOf(QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION),
      "failed pre-provider permit retirement must replay after provider-boundary admission",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION)
        < migrationNames.indexOf(COMPETITOR_PRICE_V3_MIGRATION)
        && migrationNames.indexOf(COMPETITOR_PRICE_V3_MIGRATION)
          < migrationNames.indexOf(COMPETITOR_MATCH_REVIEW_MIGRATION)
        && migrationNames.indexOf(COMPETITOR_MATCH_REVIEW_MIGRATION)
          < migrationNames.indexOf(COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION)
        && migrationNames.indexOf(COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION)
          < migrationNames.indexOf(COMPETITOR_IDENTITY_LINEAGE_MIGRATION)
        && migrationNames.indexOf(COMPETITOR_IDENTITY_LINEAGE_MIGRATION)
          < migrationNames.indexOf(SMARTSTORE_EXACT_QA_RECOVERY_MIGRATION)
        && migrationNames.indexOf(SMARTSTORE_EXACT_QA_RECOVERY_MIGRATION)
          < migrationNames.indexOf(TEMU_PUBLICATION_RELEASE_MIGRATION)
        && migrationNames.indexOf(TEMU_PUBLICATION_RELEASE_MIGRATION)
          < migrationNames.indexOf(COUPANG_EXACT_QA_RECOVERY_MIGRATION),
      "competitor v3, review ledger, queue retirement, identity fence, Smartstore recovery, Temu publication, and Coupang recovery fence must replay after Qoo10 573 in order",
    );
    assert.ok(
      migrationNames.indexOf(TEMU_EXACT_CABLE_MIGRATION)
        < migrationNames.indexOf(QOO10_EXACT_CLOSED_GATE_REACHABILITY_MIGRATION)
        && migrationNames.indexOf(QOO10_EXACT_CLOSED_GATE_REACHABILITY_MIGRATION)
          < migrationNames.indexOf(EBAY_EXACT_CONTENT_FENCE_MIGRATION)
        && migrationNames.indexOf(EBAY_EXACT_CONTENT_FENCE_MIGRATION)
          < migrationNames.indexOf(ELEVENST_EXACT_SNAPSHOT_FORWARD_MIGRATION)
        && migrationNames.indexOf(ELEVENST_EXACT_SNAPSHOT_FORWARD_MIGRATION)
          < migrationNames.indexOf(EBAY_EXACT_PROVIDER_COPY_MIGRATION)
        && migrationNames.indexOf(EBAY_EXACT_PROVIDER_COPY_MIGRATION)
          < migrationNames.indexOf(SMARTSTORE_EXACT_CLOSED_GATE_PERMIT_MIGRATION)
        && migrationNames.indexOf(SMARTSTORE_EXACT_CLOSED_GATE_PERMIT_MIGRATION)
          < migrationNames.indexOf(SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION),
      "eBay content, 11st snapshot, eBay provider copy, Smartstore permit, and its representative filename correction must replay in deployed order",
    );
    assert.ok(
      migrationNames.indexOf(SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION)
        < migrationNames.indexOf(EXACT_EXISTING_CLOSED_GATE_PERMIT_MIGRATION),
      "Coupang, 11st, and eBay exact one-time permits must replay after the Smartstore representative filename correction",
    );
    assert.ok(
      migrationNames.indexOf(EXACT_EXISTING_CLOSED_GATE_PERMIT_MIGRATION)
        < migrationNames.indexOf(QOO10_RELEASE_STATUS_RECORD_INITIALIZATION_MIGRATION),
      "Qoo10 release status record initialization must replay after all 080000 exact permits",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_RELEASE_STATUS_RECORD_INITIALIZATION_MIGRATION)
        < migrationNames.indexOf(EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MIGRATION),
      "the exact domestic market-target repair must replay after the deployed 081000 status initialization",
    );
    assert.ok(
      migrationNames.indexOf(EXACT_DOMESTIC_MARKET_TARGET_BACKFILL_MIGRATION)
        < migrationNames.indexOf(EBAY_CURRENT_CREDENTIAL_FENCE_MIGRATION),
      "eBay rotating credential fence must replay after the exact domestic market-target repair",
    );
    assert.ok(
      migrationNames.indexOf(EBAY_CURRENT_CREDENTIAL_FENCE_MIGRATION)
        < migrationNames.indexOf(COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_MIGRATION),
      "Coupang proved pre-gateway reconciliation must replay after the current eBay credential fence",
    );
    assert.ok(
      migrationNames.indexOf(COUPANG_UNCLAIMED_STATIC_EGRESS_RECONCILIATION_MIGRATION)
        < migrationNames.indexOf(EBAY_EXACT_QA_RPC_EXPOSURE_MIGRATION),
      "the short eBay PostgREST RPC must replay after the latest committed exact-job reconciliation",
    );
    assert.ok(
      migrationNames.indexOf(EBAY_EXACT_QA_RPC_EXPOSURE_MIGRATION)
        < migrationNames.indexOf(EBAY_SERVERLESS_LISTING_UPDATE_MIGRATION),
      "the eBay serverless update pair must replay only after the exact identity RPC and provider fences",
    );
    assert.ok(
      migrationNames.indexOf(EBAY_SERVERLESS_LISTING_UPDATE_MIGRATION)
        < migrationNames.indexOf(EBAY_DETERMINISTIC_NO_EFFECT_RETRY_MIGRATION)
        && migrationNames.indexOf(EBAY_DETERMINISTIC_NO_EFFECT_RETRY_MIGRATION)
          < migrationNames.indexOf(
            EBAY_NO_EFFECT_TERMINAL_PROOF_CORRECTION_MIGRATION,
          )
        && migrationNames.indexOf(
          EBAY_NO_EFFECT_TERMINAL_PROOF_CORRECTION_MIGRATION,
        ) < migrationNames.indexOf(EBAY_EXACT_PRE_GATEWAY_RETRY_MIGRATION)
        && migrationNames.indexOf(EBAY_EXACT_PRE_GATEWAY_RETRY_MIGRATION)
          < migrationNames.indexOf(EBAY_EXACT_CREDENTIAL_ROTATION_MIGRATION),
      "the one-shot eBay retry, terminal proof correction, exact pre-gateway recovery, and current-credential rotation must replay after the source job can execute",
    );
    assert.ok(
      migrationNames.indexOf(EBAY_EXACT_CREDENTIAL_ROTATION_MIGRATION)
        < migrationNames.indexOf(SHOPEE_SG_EXISTING_ADOPTION_MIGRATION),
      "Shopee SG existing-item adoption must wrap the final deployed lineage completion chain",
    );
    assert.ok(
      migrationNames.indexOf(SHOPEE_SG_EXISTING_ADOPTION_MIGRATION)
        < migrationNames.indexOf(LAZADA_EXACT_LIVE_ADOPTION_MIGRATION)
        && migrationNames.indexOf(LAZADA_EXACT_LIVE_ADOPTION_MIGRATION)
          < migrationNames.indexOf(EXACT_ADOPTION_COMPLETION_MERGE_MIGRATION)
        && migrationNames.indexOf(EXACT_ADOPTION_COMPLETION_MERGE_MIGRATION)
          < migrationNames.indexOf(TEMU_EXACT_EXISTING_ACTIVE_ADOPTION_MIGRATION)
        && migrationNames.indexOf(TEMU_EXACT_EXISTING_ACTIVE_ADOPTION_MIGRATION)
          < migrationNames.indexOf(TEMU_EXACT_CREDENTIAL_CERTIFICATION_MIGRATION),
      "the forward completion merger and Temu exact adoption pair must replay after the already-applied Lazada migration",
    );
    assert.ok(
      migrationNames.indexOf(COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_MIGRATION)
        < migrationNames.indexOf(QOO10_NO_REMOTE_EFFECT_RECONCILIATION_MIGRATION),
      "Qoo10 no-effect reconciliation must replay after the Coupang pre-gateway reconciliation",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_NO_REMOTE_EFFECT_RECONCILIATION_MIGRATION)
        < migrationNames.indexOf(QOO10_NO_EFFECT_LEGACY_PAYLOAD_MIGRATION),
      "Qoo10 legacy no-effect payload repair must replay after the base no-effect contract",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_NO_EFFECT_LEGACY_PAYLOAD_MIGRATION)
        < migrationNames.indexOf(QOO10_PARTIAL_MANUAL_RECONCILIATION_MIGRATION),
      "Qoo10 partial/manual reconciliation must supersede the rejected no-effect path",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_PARTIAL_MANUAL_RECONCILIATION_MIGRATION)
        < migrationNames.indexOf(SMARTSTORE_STATIC_EGRESS_RESTORATION_MIGRATION),
      "Smartstore fixed-egress correction must replay after the current Qoo10 production chain",
    );
    assert.ok(
      migrationNames.indexOf(TEMU_EXACT_CREDENTIAL_CERTIFICATION_MIGRATION)
        < migrationNames.indexOf(QOO10_ALREADY_LIVE_ADOPTION_MIGRATION),
      "the exact Qoo10 already-live adoption must replay after the Temu credential certification",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_ALREADY_LIVE_ADOPTION_MIGRATION)
        < migrationNames.indexOf(QOO10_ADOPTED_LOCALIZATION_UPDATE_MIGRATION),
      "the exact Qoo10 content-only localization permit must replay after the immutable already-live adoption",
    );
    assert.ok(
      migrationNames.indexOf(QOO10_ADOPTED_LOCALIZATION_UPDATE_MIGRATION)
        < migrationNames.indexOf(QOO10_ADOPTION_CREDENTIAL_LINEAGE_FIX_MIGRATION),
      "the exact Qoo10 credential lineage correction must replay after the adopted localization fence",
    );
    assert.ok(
      migrationNames.indexOf(EBAY_EXACT_CONTENT_FENCE_MIGRATION)
        < migrationNames.indexOf(ELEVENST_EXACT_SNAPSHOT_FORWARD_MIGRATION),
      "11st exact snapshot repair must replay forward of the complete deployed chain without reapplying its historical recovery migration",
    );
    let shopeeStaticEgressMigration;
    let smartstoreNonstaticEgressMigration;
    let qoo10ProviderBoundaryOuterPreimage;
    let qoo10ProviderBoundaryJobPreimage;
    let fullSchemaQueueFixture;
    for (const name of migrationNames) {
      if (name === LEGACY_SCOPE_RETIREMENT_MIGRATION) continue;
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      if (name === SHOPEE_STATIC_EGRESS_MIGRATION) {
        shopeeStaticEgressMigration = source;
        continue;
      }
      if (name === SMARTSTORE_NONSTATIC_EGRESS_MIGRATION) {
        smartstoreNonstaticEgressMigration = source;
      }
      let sql = name === "20260828210000_non_cs_release_integrity.sql"
        ? withoutFinalStrictWorkerScopeFence(source)
        : source;
      if (name === QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION) {
        await db.query(
          "delete from supabase_migrations.schema_migrations where version = '20260831056800'",
        );
        await assert.rejects(
          db.exec(withoutUnavailableExtensions(sql, { injectQoo10History: false })),
          /migration history drifted/,
          "heading normalization must fail closed without exact predecessor history",
        );
        await db.exec("rollback");
        await db.query(
          `insert into supabase_migrations.schema_migrations(version,statements,name)
           values ('20260831056800','{}'::text[],'allow_exact_qoo10_s1_verifier_overlap')`,
        );
        await db.exec(
          "grant execute on function sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text) to authenticated",
        );
        await assert.rejects(
          db.exec(withoutUnavailableExtensions(sql, { injectQoo10History: false })),
          /function preimage drifted/,
          "heading normalization must fail closed when a private preimage ACL drifts",
        );
        await db.exec("rollback");
        await db.exec(
          "revoke all on function sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text) from authenticated",
        );
      }
      if (name === QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION) {
        await db.query(
          "delete from supabase_migrations.schema_migrations where version = '20260831056900'",
        );
        await assert.rejects(
          db.exec(withoutUnavailableExtensions(sql, { injectQoo10History: false })),
          /migration history drifted/,
          "stale verifier retirement must fail closed without heading-normalization history",
        );
        await db.exec("rollback");
        await db.query(
          `insert into supabase_migrations.schema_migrations(version,statements,name)
           values ('20260831056900','{}'::text[],'accept_exact_qoo10_heading_normalization')`,
        );
      }
      if (name === QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION) {
        await db.query(
          "delete from supabase_migrations.schema_migrations where version = '20260831057000'",
        );
        await assert.rejects(
          db.exec(withoutUnavailableExtensions(sql, { injectQoo10History: false })),
          /migration history drifted/,
          "activation claim priority must fail closed without stale-verifier retirement history",
        );
        await db.exec("rollback");
        await db.query(
          `insert into supabase_migrations.schema_migrations(version,statements,name)
           values ('20260831057000','{}'::text[],'retire_stale_qoo10_s1_verifier')`,
        );
      }
      if (name === QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select encode(extensions.digest(pg_get_functiondef(
              'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
            ),'sha256'),'hex')`,
          ),
          "0c5c70e952cba84608b59bc04930d3627d49412d2a8d132f4d72d7f48ca0f407",
          "572 must see the exact original bounded serverless marker",
        );
        qoo10ProviderBoundaryOuterPreimage = await scalar(
          db,
          `select pg_get_functiondef(
            'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
          )`,
        );
        qoo10ProviderBoundaryJobPreimage = (
          await db.query(`
            select id::text,status,provider_mutation_started_at,updated_at
              from sellerpilot_private.channel_gateway_jobs order by id
          `)
        ).rows;
        await db.query(
          "delete from supabase_migrations.schema_migrations where version = '20260831057100'",
        );
        await assert.rejects(
          db.exec(withoutUnavailableExtensions(sql, { injectQoo10History: false })),
          /provider-boundary preimage drifted/,
          "provider-boundary repair must fail closed without claim-priority history",
        );
        await db.exec("rollback");
        await db.query(
          `insert into supabase_migrations.schema_migrations(version,statements,name)
           values ('20260831057100','{}'::text[],'prioritize_exact_qoo10_s1_activation_claim')`,
        );
      }
      if (name === QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION) {
        await db.query(
          "delete from supabase_migrations.schema_migrations where version = '20260831057200'",
        );
        await assert.rejects(
          db.exec(withoutUnavailableExtensions(sql, { injectQoo10History: false })),
          /failed-permit migration history drifted/,
          "failed pre-provider permit retirement must fail closed without 572 history",
        );
        await db.exec("rollback");
        await db.query(
          `insert into supabase_migrations.schema_migrations(version,statements,name)
           values ('20260831057200','{}'::text[],'allow_exact_qoo10_s1_activation_provider_boundary')`,
        );
      }
      if (name === QOO10_SCOPED_GATE_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in ('20260830222257', '20260831010000')`,
          ),
          0,
          "predecessor Qoo10 objects must not require forged migration history",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version = '20260831033000'`,
          ),
          1,
          "CS ledger migration must be recorded before the Qoo10 forward migration",
        );
        assert.equal(
          await scalar(
            db,
            "select to_regclass('sellerpilot_private.qoo10_listing_create_rollback_confirmations')::text",
          ),
          "sellerpilot_private.qoo10_listing_create_rollback_confirmations",
        );
        assert.equal(
          await scalar(
            db,
            "select to_regclass('sellerpilot_private.qoo10_listing_update_rejection_observations')::text",
          ),
          "sellerpilot_private.qoo10_listing_update_rejection_observations",
        );
        assert.equal(
          await scalar(
            db,
            `select to_regprocedure(
              'public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(uuid,uuid,uuid,text,text,jsonb)'
            ) is not null`,
          ),
          true,
          "deployed 222257 wrapper object must exist even though its history row does not",
        );
        assert.equal(
          await scalar(
            db,
            "select to_regclass('sellerpilot_private.support_reply_deliveries')::text",
          ),
          "sellerpilot_private.support_reply_deliveries",
          "CS ledger objects must already exist before the Qoo10 gate",
        );
      }
      if (name === QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION) {
        assert.deepEqual(
          (await db.query(
            `select
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
               ),'sha256'),'hex') identity_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
               ),'sha256'),'hex') internal_enqueue_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
               ),'sha256'),'hex') outer_enqueue_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
               ),'sha256'),'hex') claim_sha`,
          )).rows,
          [{
            identity_sha: "5db53e5f921c497df1faf8b9c3ff1b4f68bad873763c80e8f35d882fbfc78dab",
            internal_enqueue_sha: "4b62884414366a00f2729bf775aa355628b6b2a2b8020fc5eca3509340d306e2",
            outer_enqueue_sha: "b1e6272328e57f3bf012ddd2ff4bcde0972a4b08cce23e09d41278b39c934412",
            claim_sha: "6be63710e119958b8df3da93a7035c90975181898a2da8247e84b75f8581edac",
          }],
          "Qoo10 retry identity must patch only the exact observed function pre-images",
        );
      }
      if (name === COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION) {
        const ownerId = "92000000-0000-4000-8000-000000000001";
        await db.query(
          "insert into auth.users(id,email) values ($1,'queue-retirement-full-schema@example.test')",
          [ownerId],
        );
        await db.query(
          "insert into sellerpilot_private.admin_users(user_id,display_name) values ($1,'Queue retirement full-schema fixture')",
          [ownerId],
        );
        await setClaims(db, "authenticated", ownerId);
        const credentialId = await scalar(
          db,
          `select public.sellerpilot_rotate_credential(
             'elevenst','production',
             '{"key":"queue-retirement-fixture","access_token":"fixture-access","refresh_token":"fixture-refresh","client_id":"fixture-client","client_secret":"fixture-secret"}'::jsonb,
             now() + interval '180 days',90,30,0
           )`,
        );
        const vaultSecretId = await scalar(
          db,
          "select vault_secret_id from sellerpilot_private.channel_credentials where id=$1",
          [credentialId],
        );
        await db.query(
          `insert into sellerpilot_private.channel_gateway_jobs (
             id,credential_id,channel,operation,environment,request_payload,
             status,created_by,created_at,updated_at
           )
           select
             ('93000000-0000-4000-8000-' || lpad(series.n::text,12,'0'))::uuid,
             $1,'elevenst','competitor.search','production',
             jsonb_build_object(
               'primary','전체 스키마 큐 검증 ' || series.n::text,
               'periodicKey','competitor:v1:full-schema-' || lpad(series.n::text,2,'0')
             ),
             'queued',$2,
             '2026-08-31T03:00:00Z'::timestamptz + series.n * interval '1 second',
             '2026-08-31T03:00:00Z'::timestamptz + series.n * interval '1 second'
           from generate_series(1,19) series(n)`,
          [credentialId, ownerId],
        );
        const digests = await competitorQueueRetirementDigests(db);
        assert.equal(digests.targetCount, 19);
        for (const [key, productionDigest] of Object.entries(
          COMPETITOR_QUEUE_RETIREMENT_PRODUCTION_DIGESTS,
        )) {
          assert.equal(
            sql.split(productionDigest).length - 1,
            1,
            `${key} production digest must have one migration declaration`,
          );
          sql = sql.replace(productionDigest, digests[key]);
        }
        fullSchemaQueueFixture = {
          ownerId,
          credentialId,
          vaultSecretId,
          digests,
        };
      }
      try {
        await db.exec(withoutUnavailableExtensions(sql));
      } catch (error) {
        if (error instanceof Error) {
          const position = "position" in error ? ` at ${String(error.position)}` : "";
          error.message = `${name}${position}: ${error.message}`;
        }
        throw error;
      }
      if (!UNRECORDED_QOO10_SCHEMA_MIGRATIONS.has(name)) {
        const version = name.match(/^\d+/)?.[0];
        assert.ok(version, `migration version missing from ${name}`);
        await db.query(
          `insert into supabase_migrations.schema_migrations (
             version, statements, name
           ) values ($1, '{}'::text[], $2)`,
          [version, name.replace(/^\d+_/, "").replace(/\.sql$/, "")],
        );
      }
      if (name === SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION) {
        const definition = await scalar(
          db,
          `select pg_get_functiondef(
            'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'::regprocedure
          )`,
        );
        assert.match(
          definition,
          /\/thumbnail-square\[\.\]png\$/u,
          "the chronological replay must finish on the canonical representative filename",
        );
        assert.doesNotMatch(
          definition,
          /\/square\[\.\]png\$/u,
          "the legacy representative filename must not survive the forward correction",
        );
        assert.deepEqual(
          (await db.query(
            `select p.provolatile = 'i' as immutable,
                    not p.prosecdef as invoker,
                    p.proconfig = array['search_path=""']::text[] as empty_path,
                    not has_function_privilege('public',p.oid,'EXECUTE') as public_closed,
                    not has_function_privilege('anon',p.oid,'EXECUTE') as anon_closed,
                    not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_closed,
                    not has_function_privilege('service_role',p.oid,'EXECUTE') as service_closed
               from pg_proc p
              where p.oid =
                'sellerpilot_private.smartstore_exact_qa_update_arguments_valid(jsonb,text)'::regprocedure`,
          )).rows,
          [{
            immutable: true,
            invoker: true,
            empty_path: true,
            public_closed: true,
            anon_closed: true,
            authenticated_closed: true,
            service_closed: true,
          }],
        );
      }
      if (name === QOO10_SCOPED_PROVIDER_CHAIN_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in ('20260830222257', '20260831010000')`,
          ),
          0,
          "Qoo10 forward migration must leave predecessor history gaps untouched",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831033000', '20260831050000', '20260831052500',
                '20260831053500'
              )`,
          ),
          4,
          "CS, Qoo10 gate, exact reconciliation, then provider-chain repair must be the recorded tail",
        );
      }
      if (name === QOO10_ADULTYN_RECONCILIATION_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831033000', '20260831050000', '20260831052500',
                '20260831053500', '20260831055000'
              )`,
          ),
          5,
          "Qoo10 AdultYN reconciliation must be the fifth recorded release-tail migration",
        );
        assert.equal(
          await scalar(
            db,
            "select to_regclass('sellerpilot_private.qoo10_adultyn_rejection_reconciliations')::text",
          ),
          "sellerpilot_private.qoo10_adultyn_rejection_reconciliations",
        );
      }
      if (name === QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831033000', '20260831050000', '20260831052500',
                '20260831053500', '20260831055000', '20260831056000'
              )`,
          ),
          6,
          "Qoo10 AdultYN retry identity must be the sixth recorded release-tail migration",
        );
        assert.equal(
          await scalar(
            db,
            `select to_regprocedure(
              'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)'
            ) is not null`,
          ),
          true,
        );
        assert.deepEqual(
          (await db.query(
            `select
               encode(extensions.digest(pg_get_functiondef(
                 'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)'::regprocedure
               ),'sha256'),'hex') helper_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
               ),'sha256'),'hex') identity_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
               ),'sha256'),'hex') internal_enqueue_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
               ),'sha256'),'hex') outer_enqueue_sha,
               encode(extensions.digest(pg_get_functiondef(
                 'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
               ),'sha256'),'hex') claim_sha`,
          )).rows,
          [{
            helper_sha: "56c165eb8e08ba67192944b9b7ac9a18687d74cde3327e62568d4c9459660a34",
            identity_sha: "c47e80ae0fbe9f872383d1a1e1412053f00106e809055b7b1ff82af86a843256",
            internal_enqueue_sha: "ce0e788743b15eb7fc40b5b8a102da6bbc5f3fd5cebb7ac2f85ad2baa99b7bfd",
            outer_enqueue_sha: "b1e6272328e57f3bf012ddd2ff4bcde0972a4b08cce23e09d41278b39c934412",
            claim_sha: "6be63710e119958b8df3da93a7035c90975181898a2da8247e84b75f8581edac",
          }],
          "Qoo10 retry identity must preserve the outer enqueue and claim boundaries byte-exactly",
        );
        assert.deepEqual(
          (await db.query(
            `select
               has_function_privilege('service_role',
                 'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)','EXECUTE') identity_service,
               has_function_privilege('authenticated',
                 'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)','EXECUTE') identity_user,
               has_function_privilege('service_role',
                 'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)','EXECUTE') internal_service,
               has_function_privilege('service_role',
                 'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)','EXECUTE') outer_service,
               has_function_privilege('authenticated',
                 'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)','EXECUTE') claim_user,
               bool_and(pg_get_userbyid(p.proowner)='postgres'
                 and p.prosecdef and p.proconfig=array['search_path=""']::text[]) boundaries_hardened
              from pg_proc p
             where p.oid in (
               'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure,
               'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
               'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
               'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
             )
             group by identity_service,identity_user,internal_service,outer_service,claim_user`,
          )).rows,
          [{
            identity_service: true,
            identity_user: false,
            internal_service: false,
            outer_service: true,
            claim_user: true,
            boundaries_hardened: true,
          }],
        );
      }
      if (name === QOO10_EXACT_PREPROVIDER_RESUME_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831033000', '20260831050000', '20260831052500',
                '20260831053500', '20260831055000', '20260831056000',
                '20260831056500'
              )`,
          ),
          7,
          "exact Qoo10 pre-provider resume must be the seventh recorded release-tail migration",
        );
        assert.equal(
          await scalar(
            db,
            `select to_regclass(
              'sellerpilot_private.qoo10_exact_preprovider_resume_permits'
            )::text`,
          ),
          "sellerpilot_private.qoo10_exact_preprovider_resume_permits",
        );
        assert.equal(
          await scalar(
            db,
            `select to_regprocedure(
              'public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(uuid,text)'
            ) is not null`,
          ),
          true,
        );
      }
      if (name === QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831033000', '20260831050000', '20260831052500',
                '20260831053500', '20260831055000', '20260831056000',
                '20260831056500', '20260831056600'
              )`,
          ),
          8,
          "corrected Qoo10 payload contract must be the eighth recorded release-tail migration",
        );
        const correctedLineage = await scalar(
          db,
          `select pg_get_functiondef(
            'sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)'::regprocedure
          )`,
        );
        assert.match(correctedLineage, /\? 'ItemPrice'/);
        assert.match(correctedLineage, /\? 'ItemQty'/);
        assert.doesNotMatch(correctedLineage, /params,ItemPrice.*= '1871'/);
        assert.doesNotMatch(correctedLineage, /params,ItemQty.*= '1'/);
      }
      if (name === QOO10_EXACT_S1_ACTIVATION_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831033000', '20260831050000', '20260831052500',
                '20260831053500', '20260831055000', '20260831056000',
                '20260831056500', '20260831056600', '20260831056700'
              )`,
          ),
          9,
          "exact Qoo10 S1 recovery must be the ninth recorded release-tail migration",
        );
        assert.equal(
          await scalar(
            db,
            `select to_regclass(
              'sellerpilot_private.qoo10_exact_s1_activation_permits'
            )::text`,
          ),
          "sellerpilot_private.qoo10_exact_s1_activation_permits",
        );
        assert.equal(
          await scalar(
            db,
            `select sellerpilot_private.serverless_gateway_job_allowed(
              'qoo10','listing.activate'
            )`,
          ),
          true,
        );
        assert.equal(
          await scalar(
            db,
            `select sellerpilot_private.serverless_gateway_job_allowed(
              'smartstore','listing.activate'
            )`,
          ),
          false,
        );
        for (const signature of [
          "public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)",
          "public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)",
          "public.sellerpilot_service_listing_mutation_release_gate_status()",
        ]) {
          assert.match(
            await scalar(
              db,
              "select pg_get_functiondef($1::regprocedure)",
              [signature],
            ),
            /qoo10_exact_s1_source_reconciliation_resolved/,
            `${signature} must discount only the exact completed S2 recovery`,
          );
        }
        assert.equal(
          await scalar(
            db,
            `select to_regprocedure(
              'sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb)'
            ) is not null`,
          ),
          true,
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.qoo10_exact_s1_verifier_runs`,
          ),
          0,
          "applying the migration must not enqueue the read-only verifier",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.channel_gateway_jobs
              where operation = 'listing.activate'`,
          ),
          0,
          "applying the migration must never arm or execute the remote activation",
        );
        assert.match(
          await scalar(
            db,
            `select pg_get_functiondef(
              'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
            )`,
          ),
          /sellerpilot\.qoo10_s1_activation_apply[\s\S]*qoo10_exact_s1_activation_listing_update_allowed/,
          "only the exact terminal S2 outcome may project the listing live",
        );
      }
      if (name === QOO10_EXACT_S1_VERIFIER_OVERLAP_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in ('20260831056700','20260831056800')`,
          ),
          2,
          "the overlap repair must be recorded only after the exact S1 contract",
        );
        const overlapIndex = await scalar(
          db,
          `select pg_get_indexdef(
            'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass
          )`,
        );
        assert.match(overlapIndex, /sellerpilotQoo10ExactS1Recovery/);
        assert.match(overlapIndex, /qoo10_exact_s1_verifier_v1/);
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.qoo10_exact_s1_verifier_runs`,
          ),
          0,
          "the overlap repair must not enqueue a verifier",
        );
      }
      if (name === QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in ('20260831056700','20260831056800','20260831056900')`,
          ),
          3,
          "heading normalization must be recorded after both exact S1 predecessors",
        );
        assert.equal(
          await scalar(
            db,
            `select sellerpilot_private.qoo10_canonical_provider_detail_html(
              '<h1 class="x">A</h1><H6>B</H6><h10>C</h10><h1x>D</h1x>'
            )`,
          ),
          '<p class="x">A</p><p>B</p><h10>C</h10><h1x>D</h1x>',
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.qoo10_exact_s1_verifier_runs`,
          ),
          0,
          "heading normalization must not enqueue a verifier",
        );
        assert.deepEqual(
          (await db.query(`
            select p.oid::regprocedure::text signature,
                   md5(pg_get_functiondef(p.oid)) definition_md5,
                   owner.rolname owner, language.lanname language,
                   p.prosecdef security_definer,
                   p.provolatile::text volatility,
                   p.proisstrict is_strict,
                   p.proconfig,
                   p.proacl::text acl
              from pg_proc p
              join pg_roles owner on owner.oid = p.proowner
              join pg_language language on language.oid = p.prolang
             where p.oid in (
               'sellerpilot_private.qoo10_canonical_provider_detail_html(text)'::regprocedure,
               'sellerpilot_private.qoo10_exact_item_matches_source_056700(jsonb,jsonb,text)'::regprocedure,
               'sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text)'::regprocedure,
               'sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(jsonb,jsonb)'::regprocedure,
               'sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb)'::regprocedure,
               'sellerpilot_private.record_exact_qoo10_s1_observation_056700(uuid)'::regprocedure,
               'sellerpilot_private.record_exact_qoo10_s1_observation(uuid)'::regprocedure,
               'sellerpilot_private.record_exact_qoo10_s1_activation_outcome_056700(uuid)'::regprocedure,
               'sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid)'::regprocedure
             ) order by signature
          `)).rows,
          [
            ["sellerpilot_private.qoo10_canonical_provider_detail_html(text)", "2358f7ae5587ddd59704765cbac80781", "sql", false, "i", true],
            ["sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb)", "1b0d96703b785506cf4b3259643ed229", "sql", false, "i", true],
            ["sellerpilot_private.qoo10_exact_activation_expectation_valid_056700(jsonb,jsonb)", "e95a6199eeaf4c221f8e6becb002ddd7", "plpgsql", false, "i", true],
            ["sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text)", "9690d249290d6f051f29e7e0d71b88ed", "sql", false, "i", true],
            ["sellerpilot_private.qoo10_exact_item_matches_source_056700(jsonb,jsonb,text)", "a65d39b1f056f34332657260f15893df", "plpgsql", false, "i", true],
            ["sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid)", "11c0a9842f2526613a86b85b04f86e93", "plpgsql", true, "v", false],
            ["sellerpilot_private.record_exact_qoo10_s1_activation_outcome_056700(uuid)", "ce1ac826ef39b81d72586851a688acc1", "plpgsql", true, "v", false],
            ["sellerpilot_private.record_exact_qoo10_s1_observation(uuid)", "5fd11c7e55ce6f3044195ca66451f707", "plpgsql", true, "v", false],
            ["sellerpilot_private.record_exact_qoo10_s1_observation_056700(uuid)", "599d15b0056323c4f1d240b2e9e9cb0e", "plpgsql", true, "v", false],
          ].map(([signature, definition_md5, language, security_definer, volatility, is_strict]) => ({
            signature,
            definition_md5,
            owner: "postgres",
            language,
            security_definer,
            volatility,
            is_strict,
            proconfig: ['search_path=""'],
            acl: "{postgres=X/postgres}",
          })),
          "heading normalization must leave the exact pinned private function postimage",
        );
      }
      if (name === QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831056700','20260831056800','20260831056900','20260831057000'
              )`,
          ),
          4,
          "stale verifier retirement must be recorded after all exact S1 predecessors",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.channel_gateway_jobs
              where id in (
                'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
                'ea191079-3016-4851-9f0c-4ce4281c1364'::uuid
              )`,
          ),
          0,
          "a clean replay must not synthesize production-only gateway jobs",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.qoo10_exact_s1_verifier_runs`,
          ),
          0,
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.operation_audit
              where action = 'qoo10_s1_verifier_retired_for_recheck'`,
          ),
          0,
          "a clean replay must not fabricate a production retirement audit",
        );
      }
      if (name === QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831056700','20260831056800','20260831056900',
                '20260831057000','20260831057100'
              )`,
          ),
          5,
          "claim priority must be recorded after all exact S1 predecessors",
        );
        const localClaimDefinition = await scalar(
          db,
          `select pg_get_functiondef(
            'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
          )`,
        );
        const serverlessClaimDefinition = await scalar(
          db,
          `select pg_get_functiondef(
            'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
          )`,
        );
        assert.match(
          localClaimDefinition,
          /order by\s+case\s+when sellerpilot_private\.qoo10_exact_s1_activation_claim_priority\(j\.id\)[\s\S]*case when j\.prepared_credential_id is null/,
          "local claimant must place exact fresh activation before its unchanged generic order",
        );
        assert.match(
          serverlessClaimDefinition,
          /order by\s+case\s+when sellerpilot_private\.qoo10_exact_s1_activation_claim_priority\(job\.id\)[\s\S]*case when job\.prepared_credential_id is null/,
          "serverless claimant must place exact fresh activation before its unchanged generic order",
        );
        assert.match(localClaimDefinition, /serverless_gateway_job_allowed/);
        assert.match(serverlessClaimDefinition, /serverless_static_egress_allowed/);
        assert.deepEqual(
          (await db.query(`
            select
              encode(extensions.digest(replace(pg_get_functiondef(
                'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
              ), E'   order by\n     case\n       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)\n         then 0\n       else 1\n     end,\n     case when j.prepared_credential_id is null then 1 else 0 end,', E'   order by\n     case when j.prepared_credential_id is null then 1 else 0 end,'), 'sha256'), 'hex') local_pre_sha,
              encode(extensions.digest(replace(pg_get_functiondef(
                'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
              ), E'   order by\n     case\n       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)\n         then 0\n       else 1\n     end,\n     case when job.prepared_credential_id is null then 1 else 0 end,', E'   order by\n     case when job.prepared_credential_id is null then 1 else 0 end,'), 'sha256'), 'hex') serverless_pre_sha,
              encode(extensions.digest(pg_get_functiondef(
                'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
              ), 'sha256'), 'hex') local_sha,
              encode(extensions.digest(pg_get_functiondef(
                'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
              ), 'sha256'), 'hex') serverless_sha
          `)).rows,
          [{
            local_pre_sha: "01f86b17fb6a84e4fd02c62ccabeb83dc599cb00604c3da093f742878df5bce7",
            serverless_pre_sha: "2de41863d8e2f495c5c96562eaf7014a726aebf876427722ea3a06443a2b7c24",
            local_sha: "e66c646d6af44e4c3429c85c151b8a04083c4d61f61dc9b38fdd0538659b3b45",
            serverless_sha: "03eaf14f7368f92f36c45c1f2b6b910df55e1ab8bb62b9f28d278e74f9d59677",
          }],
          "claim priority full function postimages must stay pinned",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.channel_gateway_jobs
              where operation = 'listing.activate'`,
          ),
          0,
          "claim-priority migration must not enqueue or claim an activation",
        );
      }
      if (name === QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831056700','20260831056800','20260831056900',
                '20260831057000','20260831057100','20260831057200'
              )`,
          ),
          6,
          "provider-boundary repair must be recorded after all exact S1 predecessors",
        );
        assert.equal(
          await scalar(
            db,
            `select encode(extensions.digest(pg_get_functiondef(
              'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
            ),'sha256'),'hex')`,
          ),
          "968b6336c02432bd790445b90902548f6182e3b4128d2c533151d95c90347b06",
          "the innermost serverless provider marker postimage must stay pinned",
        );
        assert.equal(
          await scalar(
            db,
            `select pg_get_functiondef(
              'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
            )`,
          ),
          qoo10ProviderBoundaryOuterPreimage,
          "572 must not replace the public permit/consume wrapper",
        );
        assert.deepEqual(
          (
            await db.query(`
              select id::text,status,provider_mutation_started_at,updated_at
                from sellerpilot_private.channel_gateway_jobs order by id
            `)
          ).rows,
          qoo10ProviderBoundaryJobPreimage,
          "572 must not mutate or synthesize any gateway job",
        );
        assert.equal(
          await scalar(
            db,
            `select not exists (
              select 1 from (values
                ('public'::name),('anon'::name),('authenticated'::name),
                ('service_role'::name)
              ) role(role_name)
              where has_function_privilege(
                role.role_name,
                'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)',
                'EXECUTE'
              )
            )`,
          ),
          true,
          "the internal provider marker must remain uncallable by API roles",
        );
      }
      if (name === QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in (
                '20260831056700','20260831056800','20260831056900',
                '20260831057000','20260831057100','20260831057200',
                '20260831057300'
              )`,
          ),
          7,
          "failed-permit retirement must be recorded after all exact S1 predecessors",
        );
        assert.equal(
          await scalar(
            db,
            `select encode(extensions.digest(pg_get_functiondef(
              'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
            ),'sha256'),'hex')`,
          ),
          "968b6336c02432bd790445b90902548f6182e3b4128d2c533151d95c90347b06",
          "573 must preserve the exact 572 provider-boundary postimage",
        );
        assert.equal(
          await scalar(
            db,
            "select count(*) from sellerpilot_private.qoo10_exact_s1_activation_permits",
          ),
          0,
          "schema replay must not synthesize a production activation permit",
        );
        assert.equal(
          await scalar(
            db,
            "select count(*) from sellerpilot_private.qoo10_exact_s1_activation_outcomes",
          ),
          0,
          "schema replay must not synthesize a production activation outcome",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from pg_constraint
              where conrelid = 'sellerpilot_private.qoo10_exact_s1_activation_outcomes'::regclass
                and conname in (
                  'qoo10_exact_s1_activation_outcomes_source_job_id_key',
                  'qoo10_exact_s1_activation_outcomes_listing_id_key'
                )`,
          ),
          0,
          "source/listing uniqueness must move to evidence-aware partial indexes",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from pg_indexes
              where schemaname='sellerpilot_private'
                and indexname in (
                  'qoo10_exact_s1_one_decisive_source_outcome',
                  'qoo10_exact_s1_one_decisive_listing_outcome'
                )`,
          ),
          2,
          "both decisive-terminal partial indexes must exist",
        );
      }
      if (name === COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION) {
        assert.ok(fullSchemaQueueFixture);
        assert.equal(
          await scalar(
            db,
            `select count(*) from supabase_migrations.schema_migrations
              where version in ('20260831130000','20260831131000','20260831131500')`,
          ),
          3,
          "queue retirement must be recorded after both exact v3 predecessors",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from information_schema.columns
              where table_schema='sellerpilot_private'
                and table_name='competitor_price_refresh_claims'
                and column_name='identity_fingerprint'`,
          ),
          0,
          "queue retirement must run before the identity lineage column exists",
        );
        assert.deepEqual(
          (await db.query(`
            select
              encode(extensions.digest(pg_get_functiondef(
                'sellerpilot_private.valid_competitor_v3_item(jsonb)'::regprocedure
              ), 'sha256'), 'hex') valid_v3_sha,
              encode(extensions.digest(pg_get_functiondef(
                'sellerpilot_private.record_competitor_prices(uuid,jsonb,boolean)'::regprocedure
              ), 'sha256'), 'hex') record_v3_sha,
              encode(extensions.digest(pg_get_functiondef(
                'public.sellerpilot_review_competitor_match(uuid,text,timestamptz,uuid,text,jsonb,text,uuid)'::regprocedure
              ), 'sha256'), 'hex') review_sha,
              encode(extensions.digest(pg_get_functiondef(
                'sellerpilot_private.reject_competitor_match_review_mutation()'::regprocedure
              ), 'sha256'), 'hex') append_only_sha
          `)).rows,
          [{
            valid_v3_sha: "00e53e6b85ade85504c1096d10c39e07facb872870bb654a72a44ff04ae0a784",
            record_v3_sha: "c68a53700e658c8c630aeeda624f848140fd879d5f0aeb2f6e6a94e5775d80b5",
            review_sha: "dfe1cfa9e4a4222efbc8cca749393b224d1b9397c08dc570d7fe545052d01222",
            append_only_sha: "8b6072ac2402977ae7425e3f73e96a95c4147fca4894a8ce596ca80129ffce27",
          }],
          "queue retirement must pin the actual 130/131 executable postimages",
        );
        assert.equal(
          await scalar(
            db,
            `select
               (select relrowsecurity
                  from pg_class
                 where oid='sellerpilot_private.competitor_match_review_events'::regclass)
               and exists (
                 select 1 from pg_trigger
                  where tgrelid='sellerpilot_private.competitor_match_review_events'::regclass
                    and tgname='competitor_match_review_events_append_only'
                    and not tgisinternal and tgenabled <> 'D'
               )`,
          ),
          true,
          "review ledger RLS and append-only trigger must match the pinned predecessor boundary",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from sellerpilot_private.channel_gateway_jobs
              where channel='elevenst' and operation='competitor.search'
                and status in ('queued','running')`,
          ),
          0,
          "full-schema retirement must leave no active competitor search rows",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from sellerpilot_private.operation_audit
              where action='competitor_search_queue_retired_before_identity_v3'
                and safe_detail->>'queueDigest'=$1
                and safe_detail->>'queueFullRowsDigest'=$2
                and safe_detail->>'queueRequestPayloadsDigest'=$3
                and safe_detail->>'queueLinkagesDigest'=$4`,
            [
              fullSchemaQueueFixture.digests.queueDigest,
              fullSchemaQueueFixture.digests.fullRows,
              fullSchemaQueueFixture.digests.requestPayloads,
              fullSchemaQueueFixture.digests.linkages,
            ],
          ),
          19,
          "all full-schema rows must retain the exact aggregate preimage evidence",
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from sellerpilot_private.channel_gateway_jobs
              where created_by=$1 and status='cancelled'
                and error_message='COMPETITOR_SEARCH_RETIRED_BEFORE_IDENTITY_V3'
                and attempt_count=0 and started_at is null`,
            [fullSchemaQueueFixture.ownerId],
          ),
          19,
          "the real 130/131 schema must retire all 19 untouched reads atomically",
        );
        await db.query(
          `delete from sellerpilot_private.operation_audit
            where action='competitor_search_queue_retired_before_identity_v3'
              and owner_id=$1`,
          [fullSchemaQueueFixture.ownerId],
        );
        await db.query(
          "delete from sellerpilot_private.channel_gateway_jobs where created_by=$1",
          [fullSchemaQueueFixture.ownerId],
        );
        await db.query(
          "delete from sellerpilot_private.credential_audit where actor_user_id=$1",
          [fullSchemaQueueFixture.ownerId],
        );
        await db.query(
          "delete from sellerpilot_private.channel_credentials where id=$1",
          [fullSchemaQueueFixture.credentialId],
        );
        await db.query(
          "select vault.delete_secret($1)",
          [fullSchemaQueueFixture.vaultSecretId],
        );
        await db.query(
          "delete from sellerpilot_private.admin_users where user_id=$1",
          [fullSchemaQueueFixture.ownerId],
        );
        await db.query(
          "delete from auth.users where id=$1",
          [fullSchemaQueueFixture.ownerId],
        );
        assert.equal(
          await scalar(
            db,
            `select count(*) from sellerpilot_private.channel_gateway_jobs
              where created_by=$1`,
            [fullSchemaQueueFixture.ownerId],
          ),
          0,
          "full-schema queue fixture must not leak into later migration checks",
        );
      }
    }
    assert.equal(typeof shopeeStaticEgressMigration, "string");
    assert.equal(typeof smartstoreNonstaticEgressMigration, "string");
    const listingReleaseGate = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(listingReleaseGate.contract, "verified_publication_release_gate_v1");
    assert.equal(listingReleaseGate.open, false);
    assert.equal(listingReleaseGate.state, "closed");
    assert.equal(listingReleaseGate.queuedOrRunning, 0);
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_service_set_listing_mutation_release_gate(boolean)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_service_set_listing_mutation_release_gate(boolean)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)', 'EXECUTE')",
      ),
      true,
    );
    await attestPublicationRelease(db);
    await activatePublicationRuntimeRelease(db);
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      ["b".repeat(40)],
    );
    await assert.rejects(
      () => scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      ),
      /exact release/,
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      [PUBLICATION_RELEASE_SHA],
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
      ["b".repeat(40)],
    );
    await assert.rejects(
      () => scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      ),
      /exact release/,
    );
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_rechecker_ready(true,$1)",
      [PUBLICATION_RELEASE_SHA],
    );
    await assert.rejects(
      () => scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true)",
      ),
      /exact listing publication release required/,
    );
    const openedListingReleaseGate = await scalar(
      db,
      "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
      [PUBLICATION_RELEASE_SHA],
    );
    assert.equal(openedListingReleaseGate.open, true);
    assert.equal(openedListingReleaseGate.effectiveOpen, true);
    assert.equal(openedListingReleaseGate.openedRelease, PUBLICATION_RELEASE_SHA);
    assert.equal(openedListingReleaseGate.queuedOrRunning, 0);
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',false,null)",
    );
    const invalidatedListingReleaseGate = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(invalidatedListingReleaseGate.open, false);
    assert.equal(invalidatedListingReleaseGate.effectiveOpen, false);
    await db.query(
      "select public.sellerpilot_service_set_listing_publication_adapter_ready('qoo10',true,$1)",
      [PUBLICATION_RELEASE_SHA],
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      )).effectiveOpen,
      true,
    );
    const detailPipelineLineageMigration = await readFile(
      new URL("20260826212116_harden_detail_pipeline_lineage.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(detailPipelineLineageMigration));
    const detailImageManifestMigration = await readFile(
      new URL("20260830114500_approve_exact_detail_image_manifest.sql", migrationUrl),
      "utf8",
    );
    await db.exec(withoutUnavailableExtensions(detailImageManifestMigration));
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
    const registrationActivityDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_list_registration_activity(integer)'::regprocedure)",
    );
    const boundedRegistrationActivityDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_list_registration_activity_pre_remote_state(integer)'::regprocedure)",
    );
    assert.match(boundedRegistrationActivityDefinition, /recent_listing_probe[\s\S]*limit v_listing_probe_limit/i);
    assert.match(boundedRegistrationActivityDefinition, /recent_studio_job_probe[\s\S]*limit v_job_probe_limit/i);
    assert.match(boundedRegistrationActivityDefinition, /retry_started_at/i);
    assert.doesNotMatch(
      boundedRegistrationActivityDefinition,
      /sellerpilot_list_registration_activity_pre_image_activity/i,
    );
    assert.match(registrationActivityDefinition, /sellerpilot_list_registration_activity_pre_remote_state/i);
    assert.match(registrationActivityDefinition, /requestedPublicationIntent/);
    assert.match(registrationActivityDefinition, /remoteVisibility/);
    assert.match(registrationActivityDefinition, /providerStatus/);
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
      "public.sellerpilot_service_claim_push_deliveries(integer,integer)",
      "public.sellerpilot_service_begin_push_delivery(uuid,uuid)",
      "public.sellerpilot_service_finish_push_delivery(uuid,text,text)",
      "public.sellerpilot_service_finish_push_delivery(uuid,uuid,text,text)",
      "public.sellerpilot_service_reap_stale_push_deliveries(integer)",
      "public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)",
      "public.sellerpilot_service_validate_worker_token(text,text)",
      "public.sellerpilot_service_begin_ai_job_completion(text,uuid,uuid)",
      "public.sellerpilot_service_release_ai_job_claim(text,uuid,uuid,text,integer)",
      "public.sellerpilot_service_begin_channel_gateway_completion(text,uuid,uuid)",
      "public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)",
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
      "public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)",
      "public.sellerpilot_claim_serverless_gateway_job(text,text)",
      "public.sellerpilot_claim_serverless_cs_job(text,text)",
      "public.sellerpilot_touch_serverless_cs_job(text,uuid,uuid,text)",
      "public.sellerpilot_service_begin_serverless_cs_credential_refresh(text,uuid,uuid)",
      "public.sellerpilot_service_prepare_serverless_cs_credential_refresh(text,uuid,uuid,jsonb,timestamp with time zone,boolean,boolean)",
      "public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)",
      "public.sellerpilot_service_begin_serverless_cs_provider_mutation(text,uuid,uuid)",
      "public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)",
      "public.sellerpilot_service_complete_serverless_cs_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)",
      "public.sellerpilot_service_serverless_static_egress_status()",
      "public.sellerpilot_service_register_marketplace_normalized_asset_refs(uuid,uuid,text,text,text,text[])",
      "public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded(uuid,text[])",
      "public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(integer,integer)",
      "public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(uuid,text[],text)",
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
    for (const signature of [
      "sellerpilot_private.serverless_gateway_job_allowed(text,text)",
      "sellerpilot_private.serverless_static_egress_allowed(text)",
      "sellerpilot_private.sanitize_oauth_gateway_response_payload()",
      "sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)",
      "sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid)",
      "sellerpilot_private.guard_channel_gateway_running_parallelism()",
      "sellerpilot_private.retain_current_marketplace_normalized_asset_refs()",
      "public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)",
      "public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(
          await scalar(db, "select has_function_privilege($1, $2, 'EXECUTE')", [role, signature]),
          false,
        );
      }
    }
    for (const table of [
      "sellerpilot_private.serverless_static_egress_policy",
      "sellerpilot_private.marketplace_normalized_assets",
      "sellerpilot_private.marketplace_normalized_asset_refs",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(
          await scalar(
            db,
            "select has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE')",
            [role, table],
          ),
          false,
        );
      }
    }
    const expectedServerlessGatewayPairs = [
      "coupang:categories.attributes",
      "coupang:categories.list",
      "coupang:categories.suggest",
      "coupang:categories.validate",
      "coupang:diagnostic.test",
      "coupang:inquiries.list",
      "coupang:inquiries.reply",
      "coupang:inventory.update",
      "coupang:listing.create",
      "coupang:listing.stop",
      "coupang:listing.update",
      "coupang:orders.get",
      "coupang:orders.list",
      "coupang:shipment.acknowledge",
      "coupang:shipment.confirm",
      "ebay:categories.attributes",
      "ebay:categories.list",
      "ebay:categories.suggest",
      "ebay:categories.validate",
      "ebay:diagnostic.test",
      "ebay:inquiries.list",
      "ebay:inquiries.reply",
      "ebay:inventory.update",
      "ebay:listing.create",
      "ebay:listing.lineage.verify",
      "ebay:listing.update",
      "ebay:oauth.exchange",
      "ebay:orders.get",
      "ebay:orders.list",
      "ebay:shipment.confirm",
      "elevenst:categories.attributes",
      "elevenst:categories.list",
      "elevenst:categories.suggest",
      "elevenst:categories.validate",
      "elevenst:competitor.search",
      "elevenst:diagnostic.test",
      "elevenst:listing.create",
      "elevenst:listing.stop",
      "elevenst:listing.update",
      "elevenst:orders.list",
      "lazada:categories.attributes",
      "lazada:categories.list",
      "lazada:categories.suggest",
      "lazada:categories.validate",
      "lazada:diagnostic.test",
      "lazada:inquiries.list",
      "lazada:inquiries.reply",
      "lazada:inventory.update",
      "lazada:listing.create",
      "lazada:listing.lineage.verify",
      "lazada:listing.stop",
      "lazada:listing.update",
      "lazada:oauth.exchange",
      "lazada:orders.get",
      "lazada:orders.list",
      "lazada:shipment.acknowledge",
      "lazada:shipment.confirm",
      "lazada:shops.get",
      "qoo10:categories.attributes",
      "qoo10:categories.list",
      "qoo10:categories.suggest",
      "qoo10:categories.validate",
      "qoo10:diagnostic.test",
      "qoo10:inquiries.list",
      "qoo10:inquiries.reply",
      "qoo10:inventory.update",
      "qoo10:listing.create",
      "qoo10:listing.lineage.verify",
      "qoo10:listing.stop",
      "qoo10:listing.update",
      "qoo10:orders.get",
      "qoo10:orders.list",
      "qoo10:shipment.acknowledge",
      "qoo10:shipment.confirm",
      "shopee:categories.attributes",
      "shopee:categories.list",
      "shopee:categories.suggest",
      "shopee:categories.validate",
      "shopee:diagnostic.test",
      "shopee:inventory.update",
      "shopee:listing.create",
      "shopee:listing.lineage.verify",
      "shopee:listing.stop",
      "shopee:listing.update",
      "shopee:oauth.exchange",
      "shopee:orders.get",
      "shopee:orders.list",
      "shopee:shipment.acknowledge",
      "shopee:shipment.confirm",
      "shopee:shops.get",
      "smartstore:categories.attributes",
      "smartstore:categories.list",
      "smartstore:categories.suggest",
      "smartstore:categories.validate",
      "smartstore:diagnostic.test",
      "smartstore:inquiries.list",
      "smartstore:inquiries.reply",
      "smartstore:inventory.update",
      "smartstore:listing.create",
      "smartstore:listing.stop",
      "smartstore:listing.update",
      "smartstore:orders.get",
      "smartstore:orders.list",
      "smartstore:shipment.acknowledge",
      "smartstore:shipment.confirm",
      "temu:categories.attributes",
      "temu:categories.list",
      "temu:categories.suggest",
      "temu:categories.validate",
      "temu:diagnostic.test",
      "temu:inquiries.list",
      "temu:inventory.update",
      "temu:listing.create",
      "temu:listing.stop",
      "temu:orders.get",
      "temu:orders.list",
      "temu:shipment.confirm",
    ];
    assert.deepEqual(
      (await db.query(
        `with channels(channel) as (
           values ('qoo10'), ('shopee'), ('lazada'), ('coupang'),
                  ('elevenst'), ('temu'), ('smartstore'), ('ebay')
         ), operations(operation) as (
           values ('diagnostic.test'),
                  ('categories.list'), ('categories.suggest'),
                  ('categories.attributes'), ('categories.validate'),
                  ('orders.list'), ('orders.get'),
                  ('inquiries.list'), ('inquiries.reply'),
                  ('shops.get'), ('competitor.search'),
                  ('listing.lineage.verify'),
                  ('listing.create'), ('listing.update'), ('listing.stop'),
                  ('price.update'), ('inventory.update'),
                  ('shipment.acknowledge'), ('shipment.confirm'),
                  ('oauth.exchange')
         )
         select channel || ':' || operation as pair
           from channels cross join operations
          where sellerpilot_private.serverless_gateway_job_allowed(channel, operation)
          order by pair`,
      )).rows.map((row) => row.pair),
      expectedServerlessGatewayPairs,
    );
    assert.equal(
      await scalar(
        db,
        "select to_regclass('sellerpilot_private.channel_gateway_jobs_serverless_gateway_queue_idx') is not null",
      ),
      true,
    );
    for (const index of [
      "marketplace_normalized_assets_cleanup_idx",
      "marketplace_normalized_assets_lease_idx",
      "marketplace_normalized_asset_refs_scope_idx",
      "marketplace_normalized_asset_refs_attempt_idx",
      "marketplace_normalized_asset_refs_object_idx",
      "marketplace_normalized_asset_refs_owner_idx",
      "channel_gateway_jobs_one_running_mutation_scope_idx",
      "channel_gateway_jobs_running_scope_idx",
    ]) {
      assert.equal(
        await scalar(
          db,
          "select to_regclass('sellerpilot_private.' || $1) is not null",
          [index],
        ),
        true,
      );
    }
    const serverlessClaimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure)",
    );
    const legacyServerlessClaimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure)",
    );
    const priorSafeLazadaClaimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_204000_claim_serverless_gateway_unsafe(text,text)'::regprocedure)",
    );
    assert.match(
      serverlessClaimDefinition,
      /lock table sellerpilot_private\.gateway_completion_receipts/i,
    );
    assert.match(serverlessClaimDefinition, /safe_lazada_oauth_claim_blocker/i);
    assert.match(serverlessClaimDefinition, /interval '25 minutes'/i);
    assert.match(serverlessClaimDefinition, /sellerpilot_204000_claim_serverless_gateway_unsafe/i);
    assert.match(
      serverlessClaimDefinition,
      /perform pg_catalog\.pg_advisory_xact_lock/i,
    );
    assert.match(
      priorSafeLazadaClaimDefinition,
      /sellerpilot_183000_claim_serverless_gateway_unsafe/i,
    );
    assert.ok(
      (priorSafeLazadaClaimDefinition.match(/safe_lazada_oauth_claim_blocker/g) ?? [])
        .length >= 3,
    );
    assert.match(legacyServerlessClaimDefinition, /for update of job skip locked/i);
    assert.match(legacyServerlessClaimDefinition, /for share of credential/i);
    assert.doesNotMatch(
      legacyServerlessClaimDefinition,
      /perform pg_catalog\.pg_advisory_xact_lock/i,
    );
    assert.match(
      legacyServerlessClaimDefinition,
      /pg_try_advisory_xact_lock\([\s\S]*193674996[\s\S]*read-slot-1[\s\S]*pg_try_advisory_xact_lock\([\s\S]*193674996[\s\S]*read-slot-2/i,
    );
    assert.match(
      legacyServerlessClaimDefinition,
      /sellerpilot_service_reap_stale_channel_gateway_jobs\(100\)/i,
    );
    assert.match(
      legacyServerlessClaimDefinition,
      /when sqlstate 'SPC02' then[\s\S]*return null/i,
    );
    const runningParallelismDefinition = await scalar(
      db,
      "select pg_get_functiondef('sellerpilot_private.guard_channel_gateway_running_parallelism()'::regprocedure)",
    );
    assert.match(runningParallelismDefinition, /errcode = 'SPC02'/i);
    assert.equal(
      await scalar(
        db,
        `select count(*) = 1
           from pg_catalog.pg_trigger
          where tgrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
            and tgname = 'sellerpilot_sanitize_oauth_gateway_response_payload'
            and not tgisinternal`,
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select to_regclass('sellerpilot_private.channel_gateway_jobs_one_running_per_credential_idx') is null",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) = 1
           from pg_catalog.pg_trigger
          where tgrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
            and tgname = 'guard_channel_gateway_running_parallelism'
            and not tgisinternal`,
      ),
      true,
    );
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_serverless_static_egress_status()"),
      { coupang: false, elevenst: false, shopee: false, smartstore: false, temu: false },
    );
    assert.doesNotMatch(
      await scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_claim_serverless_cs_job(text,text)'::regprocedure)",
      ),
      /sellerpilot_claim_serverless_gateway_job/i,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          "select has_table_privilege($1, 'sellerpilot_private.competitor_price_refresh_claims', 'SELECT,UPDATE')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'sellerpilot_private.valid_competitor_provider_snapshot(jsonb)', 'EXECUTE')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'public.sellerpilot_get_product_operations_v2_pre_provider_state(uuid)', 'EXECUTE')",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_get_product_operations_v2(uuid)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('anon', 'public.sellerpilot_get_product_operations_v2(uuid)', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_get_product_operations_v2(uuid)', 'EXECUTE')",
      ),
      false,
    );
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

    await db.exec("begin");
    try {
      const temuActivationCredentialId = await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          'temu', 'production', '{"app_key":"claim-test-only"}'::jsonb,
          now() + interval '30 days', 90, 30, 7
        )`,
      );
      const activationClaim = await scalar(
        db,
        `select public.sellerpilot_claim_channel_operation(
          $1, 'temu', 'listing.activate', 'temu-activation:${"1".repeat(64)}', $2
        )`,
        [temuActivationCredentialId, "2".repeat(64)],
      );
      assert.equal(activationClaim.status, "running");
      assert.equal(activationClaim.duplicate, false);
      assert.equal(
        await scalar(
          db,
          `select gateway_write_required
             from sellerpilot_private.channel_operation_attempts
            where id=$1`,
          [activationClaim.attempt_id],
        ),
        true,
        "Temu activation claim must be provider-write classified",
      );
      const duplicateActivationClaim = await scalar(
        db,
        `select public.sellerpilot_claim_channel_operation(
          $1, 'temu', 'listing.activate', 'temu-activation:${"1".repeat(64)}', $2
        )`,
        [temuActivationCredentialId, "2".repeat(64)],
      );
      assert.equal(duplicateActivationClaim.status, "running");
      assert.equal(duplicateActivationClaim.duplicate, false);
      assert.equal(duplicateActivationClaim.attempt_id, activationClaim.attempt_id);
      assert.equal(
        await scalar(
          db,
          `select count(*)::integer
             from sellerpilot_private.channel_operation_attempts
            where channel='temu' and operation='listing.activate'
              and idempotency_key='temu-activation:${"1".repeat(64)}'`,
        ),
        1,
        "a repeated pre-gateway Temu activation claim must resume one attempt",
      );
      await assert.rejects(
        db.query(
          `select public.sellerpilot_claim_channel_operation(
            $1, 'qoo10', 'listing.activate', 'qoo10-activation-${"3".repeat(32)}', $2
          )`,
          [temuActivationCredentialId, "4".repeat(64)],
        ),
        /invalid channel operation/,
        "listing.activate must remain rejected for every non-Temu claim",
      );
    } finally {
      await db.exec("rollback");
    }

    await db.exec("begin");
    try {
      // The core-flow fixture intentionally replays the older v1 approval
      // migration above to test its compatibility wrapper after the full
      // chronological chain. Isolate this Temu-v2 activation behavior from
      // that synthetic post-replay constraint; the chronological dynamic
      // Temu suite exercises the real v2 constraint unchanged.
      await db.exec(
        "alter table sellerpilot_private.products drop constraint products_detail_page_approval_check",
      );
      const sellerAccountKey = "5".repeat(64);
      const createFingerprint = "6".repeat(64);
      const activationFingerprint = "7".repeat(64);
      const manifestDigest = "8".repeat(64);
      const goodsId = "9007199254740993";
      const externalGoodsId = "SP-TEMU-ACTIVATION-GENERATION-TEST";
      const assetImages = Array.from({ length: 8 }, (_, index) => ({
        role: `detail-${index + 1}`,
        path: `products/temu-activation/detail-${index + 1}.jpg`,
        sourceSha256: String(index + 1).repeat(64),
      }));
      const assetBinding = {
        contract: "sellerpilot_publication_asset_binding_v1",
        providerImageSurface: "detail_content",
        approvedDetailPageVersion: 1,
        approvedManifestDigest: manifestDigest,
        approvedDetailImages: assetImages.map((image) => ({
          role: image.role,
          approvedObjectPath: image.path,
          approvedSourceSha256: image.sourceSha256,
        })),
      };
      const detailImage = assetImages.map((image) => `https://assets.example.test/${image.path}`);
      const sourceArguments = {
        publicationIntent: "safe_test",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedImageCount: 8,
        publicationExpectedFingerprint: createFingerprint,
        sellerpilotPublicationAssetBinding: assetBinding,
        body: {
          goodsBasic: {
            externalGoodsId,
            goodsName: "Temu 승격 세대 테스트 상품",
            goodsDesc: "승인된 한국어 상세 설명",
            detailImage,
          },
        },
      };
      const temuCredentialId = await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          'temu', 'production', '{"app_key":"activation-generation-test"}'::jsonb,
          now() + interval '30 days', 90, 30, 7
        )`,
      );
      await db.exec("set local session_replication_role = replica");
      await db.query(
        `update sellerpilot_private.channel_credentials
            set seller_account_key=$2,
                seller_account_key_source='provider_certified_v1',
                seller_account_verified_at=clock_timestamp()
          where id=$1`,
        [temuCredentialId, sellerAccountKey],
      );
      await db.exec("set local session_replication_role = origin");
      await attestPublicationRelease(db);
      await activatePublicationRuntimeRelease(db);
      await db.query(
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      );
      await db.query(
        `update sellerpilot_private.serverless_static_egress_policy
            set enabled=true,updated_at=clock_timestamp()
          where channel='temu'`,
      );
      await scalar(
        db,
        `select set_config(
          'request.headers','{"x-sellerpilot-static-egress-channels":"temu"}',true
        )`,
      );
      const sourceAttempt = await scalar(
        db,
        `select public.sellerpilot_claim_channel_operation(
          $1,'temu','listing.create','temu-source-create-${"9".repeat(48)}',$2
        )`,
        [temuCredentialId, createFingerprint],
      );
      await db.exec("set local session_replication_role = replica");
      const productId = await scalar(
        db,
        `insert into sellerpilot_private.products (
           owner_id,external_code,sku,name,description,status,on_hand,reserved,
           reorder_point,cost_krw,demo,detail_page_version,
           detail_page_data,detail_page_updated_at,
           detail_page_approved_version,detail_page_image_manifest
         ) values (
           $1,'TEMU-ACTIVATION-GENERATION','TEMU-ACTIVATION-GENERATION',
           'Temu 승격 세대 테스트 상품','승인된 한국어 상세 설명','active',10,0,
           1,1000,false,1,'{}'::jsonb,clock_timestamp(),1,$2::jsonb
         ) returning id`,
        [ADMIN_ID, JSON.stringify({
          contract: "sellerpilot_detail_image_manifest_v2",
          algorithm: "sha256",
          digest: manifestDigest,
          images: assetImages,
        })],
      );
      const listingId = await scalar(
        db,
        `insert into sellerpilot_private.product_listings (
           owner_id,product_id,channel_key,market,target_id,remote_id,status,
           currency,price,operation_attempt_id,last_verified_at,
           requested_publication_intent,remote_visibility,provider_status,
           remote_resources,seller_account_key
         ) values (
           $1,$2,'temu','KR','',$3::text,'paused','KRW',10000,$4,
           clock_timestamp(),'safe_test','non_public','OFF_SHELF',
           jsonb_build_object('resources',jsonb_build_object(
             'goodsId',$3::text,'externalGoodsId',$5::text
           )),$6
         ) returning id`,
        [ADMIN_ID, productId, goodsId, sourceAttempt.attempt_id, externalGoodsId, sellerAccountKey],
      );
      const sourceJobId = await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id,attempt_id,listing_id,channel,operation,environment,
           request_payload,response_payload,status,seller_account_key,
           request_fingerprint,created_by,provider_mutation_started_at,
           started_at,completed_at,updated_at
         ) values (
           $1,$2,$3,'temu','listing.create','production',
           jsonb_build_object('arguments',$4::jsonb),$5::jsonb,'succeeded',$6,$7,$8,
           clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp()
         ) returning id`,
        [
          temuCredentialId,
          sourceAttempt.attempt_id,
          listingId,
          JSON.stringify(sourceArguments),
          JSON.stringify({
            ok: true,
            publicationFulfilled: true,
            publicationIntent: "safe_test",
            remoteId: goodsId,
            remoteState: {
              verified: true,
              visibility: "non_public",
              locale: "ko-KR",
              fingerprint: createFingerprint,
              imageCount: 8,
              resources: { goodsId, externalGoodsId },
            },
          }),
          sellerAccountKey,
          createFingerprint,
          ADMIN_ID,
        ],
      );
      await db.query(
        `update sellerpilot_private.channel_operation_attempts
            set status='succeeded',remote_id=$2,completed_at=clock_timestamp()
          where id=$1`,
        [sourceAttempt.attempt_id, goodsId],
      );
      await db.exec("set local session_replication_role = origin");

      const firstContext = await scalar(
        db,
        `select sellerpilot_private.temu_activation_context(
          $1,$2,$3,$4,'KR',''
        )`,
        [ADMIN_ID, productId, listingId, temuCredentialId],
      );
      assert.equal(firstContext.status, "allowed");
      assert.equal(firstContext.activationGeneration, 1);
      assert.match(firstContext.claimIdempotencyKey, /^temu-activation:[a-f0-9]{64}$/);
      const firstClaim = await scalar(
        db,
        `select public.sellerpilot_claim_channel_operation(
          $1,'temu','listing.activate',$2,$3
        )`,
        [temuCredentialId, firstContext.claimIdempotencyKey, activationFingerprint],
      );
      const firstArguments = {
        ...firstContext.arguments,
        publicationExpectedFingerprint: activationFingerprint,
      };
      await scalar(
        db,
        `select set_config('request.jwt.claim.role','service_role',true)`,
      );
      const firstEnqueue = await scalar(
        db,
        `select public.sellerpilot_service_enqueue_temu_activation(
          $1,$2,$3,jsonb_build_object('arguments',$4::jsonb)
        )`,
        [listingId, temuCredentialId, firstClaim.attempt_id, JSON.stringify(firstArguments)],
      );
      assert.equal(firstEnqueue.status, "queued");
      assert.equal(
        await scalar(
          db,
          `select sellerpilot_private.temu_activation_context(
            $1,$2,$3,$4,'KR',''
          ) is null`,
          [ADMIN_ID, productId, listingId, temuCredentialId],
        ),
        true,
        "an active activation permit must not mint a second claim generation",
      );

      await db.exec("set local session_replication_role = replica");
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status='failed',error_message='synthetic pre-provider failure',
                completed_at=clock_timestamp(),updated_at=clock_timestamp()
          where id=$1`,
        [firstEnqueue.job_id],
      );
      await db.query(
        `update sellerpilot_private.temu_listing_activation_permits
            set terminal_status='failed',completed_at=clock_timestamp()
          where activation_job_id=$1 and consumed_at is null`,
        [firstEnqueue.job_id],
      );
      await db.query(
        `update sellerpilot_private.channel_operation_attempts
            set status='failed',safe_message='synthetic pre-provider failure',
                completed_at=clock_timestamp()
          where id=$1`,
        [firstClaim.attempt_id],
      );
      await db.query(
        `update sellerpilot_private.product_listings
            set status='paused',operation_attempt_id=$2,
                requested_publication_intent='safe_test',remote_visibility='non_public'
          where id=$1`,
        [listingId, sourceAttempt.attempt_id],
      );
      await db.exec("set local session_replication_role = origin");
      await scalar(db, "select set_config('request.jwt.claim.role','authenticated',true)");
      const secondContext = await scalar(
        db,
        `select sellerpilot_private.temu_activation_context(
          $1,$2,$3,$4,'KR',''
        )`,
        [ADMIN_ID, productId, listingId, temuCredentialId],
      );
      assert.equal(secondContext.activationGeneration, 2);
      assert.notEqual(secondContext.claimIdempotencyKey, firstContext.claimIdempotencyKey);
      const secondClaim = await scalar(
        db,
        `select public.sellerpilot_claim_channel_operation(
          $1,'temu','listing.activate',$2,$3
        )`,
        [temuCredentialId, secondContext.claimIdempotencyKey, "a".repeat(64)],
      );
      assert.notEqual(secondClaim.attempt_id, firstClaim.attempt_id);
      await scalar(db, "select set_config('request.jwt.claim.role','service_role',true)");
      const secondEnqueue = await scalar(
        db,
        `select public.sellerpilot_service_enqueue_temu_activation(
          $1,$2,$3,jsonb_build_object(
            'arguments',jsonb_set($4::jsonb,'{publicationExpectedFingerprint}',to_jsonb($5::text))
          )
        )`,
        [listingId, temuCredentialId, secondClaim.attempt_id, JSON.stringify(secondContext.arguments), "a".repeat(64)],
      );
      assert.equal(secondEnqueue.status, "queued");
      assert.notEqual(secondEnqueue.job_id, sourceJobId);
      assert.equal(
        await scalar(
          db,
          `select count(*)::integer
             from sellerpilot_private.temu_listing_activation_permits
            where listing_id=$1`,
          [listingId],
        ),
        2,
        "only a new DB-owned generation may enqueue after a proven pre-provider failure",
      );
    } finally {
      await db.exec("rollback");
      await setClaims(db);
    }

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
    const firstLazadaTargetSyncJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_lazada_target_sync($1, 'my')",
      [refreshedCredentialId],
    );
    const reusedLazadaTargetSyncJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_lazada_target_sync($1, 'MY')",
      [refreshedCredentialId],
    );
    assert.equal(reusedLazadaTargetSyncJobId, firstLazadaTargetSyncJobId);
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.channel_gateway_jobs
          where credential_id = $1
            and channel = 'lazada'
            and operation = 'shops.get'
            and status in ('queued', 'running')`,
        [refreshedCredentialId],
      ),
      1,
    );
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_enqueue_lazada_target_sync($1, 'sg')",
        [refreshedCredentialId],
      ),
      /invalid Lazada target sync/,
    );
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'public.sellerpilot_enqueue_lazada_target_sync(uuid,text)', 'EXECUTE')",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_enqueue_lazada_target_sync(uuid,text)', 'EXECUTE')",
      ),
      true,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', completed_at = now(), updated_at = now()
        where id = $1`,
      [firstLazadaTargetSyncJobId],
    );
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
    const periodicJobCountBeforeStaticEgressChecks = await scalar(
      db,
      "select count(*)::integer from sellerpilot_private.channel_gateway_jobs",
    );
    for (const channel of ["coupang", "smartstore", "temu"]) {
      const blockedInquiry = await scalar(
        db,
        `select public.sellerpilot_service_enqueue_periodic_sync(
          $1, 'inquiries.list',
          jsonb_build_object(
            'periodicKey', 'inquiries:final-static-egress-' || $1,
            'arguments', '{}'::jsonb
          ),
          5
        )`,
        [channel],
      );
      assert.equal(blockedInquiry.status, "fixed_egress_required", channel);
      assert.equal(blockedInquiry.blockedReason, "STATIC_EGRESS_REQUIRED");
    }
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.channel_gateway_jobs",
      ),
      periodicJobCountBeforeStaticEgressChecks,
    );
    assert.equal(
      await scalar(
        db,
        "select enabled from sellerpilot_private.serverless_static_egress_policy where channel = 'smartstore'",
      ),
      false,
      "the retained Smartstore policy row must not be enabled by the forward migration",
    );
    await scalar(db, "select set_config('request.headers', '{}', false)");
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.serverless_static_egress_allowed('smartstore')",
      ),
      false,
    );
    for (const channel of ["coupang", "elevenst", "temu"]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.serverless_static_egress_allowed($1)",
          [channel],
        ),
        false,
      );
    }
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')`,
    );
    for (const channel of ["coupang", "smartstore", "elevenst", "temu"]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.serverless_static_egress_allowed($1)",
          [channel],
        ),
        false,
        `${channel} must still require the runtime header when its DB policy is enabled`,
      );
    }
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"coupang,smartstore,elevenst,temu,shopee"}',
        false
      )`,
    );
    for (const channel of ["coupang", "smartstore", "elevenst", "temu"]) {
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.serverless_static_egress_allowed($1)",
          [channel],
        ),
        true,
      );
    }
    await scalar(db, "select set_config('request.headers', '{}', false)");
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = false, updated_at = clock_timestamp()
        where channel in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')`,
    );
    assert.match(
      await scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)'::regprocedure)",
      ),
      /sellerpilot_310450_enqueue_periodic_sync_unsafe/,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege(
            $1,
            'public.sellerpilot_310450_enqueue_periodic_sync_unsafe(text,text,jsonb,integer)',
            'EXECUTE'
          )`,
          [role],
        ),
        false,
      );
    }
    for (const [role, expected] of [
      ["anon", false],
      ["authenticated", false],
      ["service_role", true],
    ]) {
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege(
            $1,
            'public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)',
            'EXECUTE'
          )`,
          [role],
        ),
        expected,
      );
    }
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel = 'temu'`,
    );
    const queuedTemuInquiry = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'temu', 'inquiries.list',
        '{"periodicKey":"inquiries:temu-static-egress-enabled","arguments":{"pageNumber":1}}'::jsonb,
        5
      )`,
    );
    assert.equal(queuedTemuInquiry.status, "queued");
    const deduplicatedTemuInquiry = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'temu', 'inquiries.list',
        '{"periodicKey":"inquiries:temu-static-egress-enabled","arguments":{"pageNumber":1}}'::jsonb,
        5
      )`,
    );
    assert.equal(deduplicatedTemuInquiry.status, "already_pending");
    assert.equal(deduplicatedTemuInquiry.jobId, queuedTemuInquiry.jobId);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
        where id = $1 and status = 'queued'`,
      [queuedTemuInquiry.jobId],
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = false, updated_at = clock_timestamp()
        where channel = 'temu'`,
    );
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

    const legacyEbayInquiry = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'ebay', 'inquiries.list',
        '{"periodicKey":"inquiries:lineage-rebind-test","arguments":{"pageNumber":1,"entriesPerPage":25}}'::jsonb,
        5
      )`,
    );
    assert.equal(legacyEbayInquiry.status, "queued");
    assert.equal(
      await scalar(
        db,
        "select seller_account_key is null from sellerpilot_private.channel_gateway_jobs where id = $1",
        [legacyEbayInquiry.jobId],
      ),
      true,
    );
    await db.query(
      `update vault.secrets secret
          set secret = (
            secret.secret::jsonb ||
            '{"provider_account_identity_version":"v1","provider_account_subject":"ebay:eias:test-seller"}'::jsonb
          )::text
         from sellerpilot_private.channel_credentials credential
        where credential.id = $1
          and secret.id = credential.vault_secret_id`,
      [refreshedEbayId],
    );
    await db.query(
      `update sellerpilot_private.channel_credentials
          set seller_account_key = repeat('0', 64),
              seller_account_key_source = 'provider_certified_v1',
              seller_account_verified_at = clock_timestamp()
        where id = $1`,
      [refreshedEbayId],
    );
    const certifiedEbaySellerKey = await scalar(
      db,
      "select seller_account_key from sellerpilot_private.channel_credentials where id = $1",
      [refreshedEbayId],
    );
    assert.match(certifiedEbaySellerKey, /^[a-f0-9]{64}$/);
    const reboundEbayInquiry = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'ebay', 'inquiries.list',
        '{"periodicKey":"inquiries:lineage-rebind-test","arguments":{"pageNumber":1,"entriesPerPage":25}}'::jsonb,
        5
      )`,
    );
    assert.equal(reboundEbayInquiry.status, "queued");
    assert.notEqual(reboundEbayInquiry.jobId, legacyEbayInquiry.jobId);
    assert.deepEqual(
      (await db.query(
        `select id::text, status, error_message,
                coalesce(seller_account_key = $2, false) as rebound
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[])
          order by (id = $3::uuid) desc, id`,
        [
          [legacyEbayInquiry.jobId, reboundEbayInquiry.jobId],
          certifiedEbaySellerKey,
          legacyEbayInquiry.jobId,
        ],
      )).rows,
      [
        {
          id: legacyEbayInquiry.jobId,
          status: "cancelled",
          error_message: "EBAY_PERIODIC_INQUIRY_LINEAGE_REBIND_REQUIRED",
          rebound: false,
        },
        {
          id: reboundEbayInquiry.jobId,
          status: "queued",
          error_message: null,
          rebound: true,
        },
      ],
    );
    const reboundPeriodicKey = await scalar(
      db,
      `select request_payload->>'periodicKey'
         from sellerpilot_private.channel_gateway_jobs where id = $1`,
      [reboundEbayInquiry.jobId],
    );
    assert.match(reboundPeriodicKey, /^ebay-inquiries:v1:[a-f0-9]{32}$/);
    assert.notEqual(reboundPeriodicKey, "inquiries:lineage-rebind-test");
    assert.deepEqual(
      await scalar(
        db,
        `select request_payload->'arguments'
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [reboundEbayInquiry.jobId],
      ),
      { pageNumber: 1, entriesPerPage: 25 },
    );
    assert.equal(
      await scalar(
        db,
        `select has_function_privilege(
          'service_role',
          'public.sellerpilot_310400_enqueue_periodic_sync_unsafe(text,text,jsonb,integer)',
          'EXECUTE'
        )`,
      ),
      false,
    );
    const deduplicatedReboundEbayInquiry = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_periodic_sync(
        'ebay', 'inquiries.list',
        '{"periodicKey":"inquiries:lineage-rebind-test","arguments":{"pageNumber":1,"entriesPerPage":25}}'::jsonb,
        5
      )`,
    );
    assert.equal(deduplicatedReboundEbayInquiry.status, "already_pending");
    assert.equal(deduplicatedReboundEbayInquiry.jobId, reboundEbayInquiry.jobId);
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.operation_audit
          where action = 'ebay_periodic_inquiry_lineage_rebind'
            and entity_id = $1`,
        [legacyEbayInquiry.jobId],
      ),
      1,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
        where id = $1`,
      [reboundEbayInquiry.jobId],
    );

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

    const staleGatewayCredentialIds = {
      retry: await scalar(
        db,
        "select id from sellerpilot_private.channel_credentials where channel = 'coupang' and status = 'active' limit 1",
      ),
      fail: refreshedCredentialId,
      listing: credentialId,
      reply: await scalar(
        db,
        "select id from sellerpilot_private.channel_credentials where channel = 'smartstore' and status = 'active' limit 1",
      ),
      live: await scalar(
        db,
        "select id from sellerpilot_private.channel_credentials where channel = 'temu' and status = 'active' limit 1",
      ),
      oauthCompleted: refreshedEbayId,
      oauthPartial: shopeeCredentialId,
    };
    const staleSyncStateBefore = (await db.query(
      `select to_jsonb(sync_state) as snapshot
         from sellerpilot_private.channel_sync_state sync_state
        where owner_id = $1
          and ((channel_key = 'coupang' and data_type = 'orders')
            or (channel_key = 'lazada' and data_type = 'inquiries'))
        order by channel_key, data_type`,
      [ADMIN_ID],
    )).rows.map((row) => row.snapshot);
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_mark_channel_sync($1, 'coupang', 'orders', 'queued', null)", [staleGatewayCredentialIds.retry]),
      true,
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_service_mark_channel_sync($1, 'lazada', 'inquiries', 'queued', null)", [staleGatewayCredentialIds.fail]),
      true,
    );

    await setClaims(db);
    const staleListingProductId = await scalar(
      db,
      `insert into sellerpilot_private.products (
         owner_id, external_code, sku, name, description, status, on_hand,
         reserved, reorder_point, cost_krw, demo
       ) values (
         $1, 'STALE-REAPER-LISTING-001', 'STALE-REAPER-LISTING-001',
         '만료 등록 작업 테스트 상품', '만료된 원격 등록을 재전송하지 않는지 검증합니다.',
         'draft', 2, 0, 0, 100, false
       ) returning id`,
      [ADMIN_ID],
    );
    const staleListingAttempt = await scalar(
      db,
      "select public.sellerpilot_claim_channel_operation($1, 'qoo10', 'listing.create', 'stale-reaper-listing-0001', $2)",
      [credentialId, "6".repeat(64)],
    );
    const staleListingId = await scalar(
      db,
      `insert into sellerpilot_private.product_listings (
         owner_id, product_id, channel_key, market, target_id, status,
         currency, price, operation_attempt_id
       ) values ($1, $2, 'qoo10', 'JP', '', 'queued', 'JPY', 1200, $3)
       returning id`,
      [ADMIN_ID, staleListingProductId, staleListingAttempt.attempt_id],
    );

    await setClaims(db, "service_role");
    const staleGatewayJobIds = {
      retry: await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, attempt_id, channel, operation, environment,
           request_payload, created_by, status, worker_token_id, claim_token,
           attempt_count, lease_expires_at, started_at
         ) select id, null, channel, 'orders.list', environment,
                  '{"arguments":{"staleReaperTest":"retry"}}'::jsonb, created_by,
                  'running', $2, gen_random_uuid(), 1, now() - interval '1 minute',
                  now() - interval '20 minutes'
             from sellerpilot_private.channel_credentials where id = $1
         returning id`,
        [staleGatewayCredentialIds.retry, gatewayOwnerTokenId],
      ),
      fail: await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, attempt_id, channel, operation, environment,
           request_payload, created_by, status, worker_token_id, claim_token,
           attempt_count, lease_expires_at, started_at
         ) select id, null, channel, 'inquiries.list', environment,
                  '{"arguments":{"staleReaperTest":"fail"}}'::jsonb, created_by,
                  'running', $2, gen_random_uuid(), 4, now() - interval '1 minute',
                  now() - interval '20 minutes'
             from sellerpilot_private.channel_credentials where id = $1
         returning id`,
        [staleGatewayCredentialIds.fail, gatewayOwnerTokenId],
      ),
      listing: await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, attempt_id, listing_id, channel, operation, environment,
           request_payload, created_by, status, worker_token_id, claim_token,
           attempt_count, lease_expires_at, started_at, provider_mutation_started_at
         ) select id, $2, $3, channel, 'listing.create', environment,
                  '{"arguments":{"staleReaperTest":"listing"}}'::jsonb, created_by,
                  'running', $4, gen_random_uuid(), 1, now() - interval '1 minute',
                  now() - interval '20 minutes', now() - interval '10 minutes'
             from sellerpilot_private.channel_credentials where id = $1
         returning id`,
        [staleGatewayCredentialIds.listing, staleListingAttempt.attempt_id, staleListingId, gatewayOwnerTokenId],
      ),
      reply: await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, attempt_id, channel, operation, environment,
           request_payload, created_by, status, worker_token_id, claim_token,
           attempt_count, lease_expires_at, started_at, provider_mutation_started_at
         ) select id, null, channel, 'inquiries.reply', environment,
                  '{"arguments":{"reply":"stale reaper test"}}'::jsonb, created_by,
                  'running', $2, gen_random_uuid(), 1, now() - interval '1 minute',
                  now() - interval '20 minutes', now() - interval '10 minutes'
             from sellerpilot_private.channel_credentials where id = $1
         returning id`,
        [staleGatewayCredentialIds.reply, gatewayOwnerTokenId],
      ),
      live: await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, attempt_id, channel, operation, environment,
           request_payload, created_by, status, worker_token_id, claim_token,
           attempt_count, lease_expires_at, started_at
         ) select id, null, channel, 'diagnostic.test', environment,
                  '{}'::jsonb, created_by, 'running', $2, gen_random_uuid(), 1,
                  now() + interval '15 minutes', now()
             from sellerpilot_private.channel_credentials where id = $1
         returning id`,
        [staleGatewayCredentialIds.live, gatewayOwnerTokenId],
      ),
    };

    staleGatewayJobIds.oauthCompleted = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'ebay', 'oauth.exchange', '{"code":"stale-reaper-completed-oauth"}'::jsonb
      )`,
      [staleGatewayCredentialIds.oauthCompleted],
    );
    staleGatewayJobIds.oauthPartial = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'shopee', 'oauth.exchange', '{"code":"stale-reaper-partial-oauth"}'::jsonb
      )`,
      [staleGatewayCredentialIds.oauthPartial],
    );
    const staleOauthVaultIds = (await db.query(
      `select oauth_request_vault_id::text as id
         from sellerpilot_private.channel_gateway_jobs
        where id = any($1::uuid[])
        order by id`,
      [[staleGatewayJobIds.oauthCompleted, staleGatewayJobIds.oauthPartial]],
    )).rows.map((row) => row.id);
    assert.equal(staleOauthVaultIds.length, 2);
    assert.equal(
      await scalar(db, "select count(*)::integer from vault.secrets where id = any($1::uuid[])", [staleOauthVaultIds]),
      2,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'running', worker_token_id = $2, claim_token = gen_random_uuid(),
              attempt_count = 1, lease_expires_at = now() - interval '1 minute',
              started_at = now() - interval '20 minutes',
              prepared_credential_id = credential_id,
              credential_refresh_fingerprint = repeat('a', 64),
              credential_refresh_prepared_at = now() - interval '10 minutes',
              oauth_exchange_completed = true
        where id = $1`,
      [staleGatewayJobIds.oauthCompleted, gatewayOwnerTokenId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'running', worker_token_id = $2, claim_token = gen_random_uuid(),
              attempt_count = 1, lease_expires_at = now() - interval '1 minute',
              started_at = now() - interval '20 minutes',
              credential_refresh_in_flight = true,
              credential_refresh_started_at = now() - interval '10 minutes'
        where id = $1`,
      [staleGatewayJobIds.oauthPartial, gatewayOwnerTokenId],
    );
    const staleGatewayRecovery = await scalar(
      db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(100)",
    );
    assert.deepEqual(staleGatewayRecovery, {
      retried: 1,
      failed: 1,
      reconciliationRequired: 3,
      oauthCompleted: 1,
      total: 6,
    });
    assert.deepEqual(
      (await db.query(
        `select id::text, status, oauth_request_vault_id is null as grant_scrubbed
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[])`,
        [Object.values(staleGatewayJobIds)],
      )).rows.map((row) => [row.id, row.status, row.grant_scrubbed]).sort(),
      [
        [staleGatewayJobIds.fail, "failed", true],
        [staleGatewayJobIds.listing, "reconciliation_required", true],
        [staleGatewayJobIds.live, "running", true],
        [staleGatewayJobIds.oauthCompleted, "succeeded", true],
        [staleGatewayJobIds.oauthPartial, "reconciliation_required", true],
        [staleGatewayJobIds.reply, "reconciliation_required", true],
        [staleGatewayJobIds.retry, "queued", true],
      ].sort(),
    );
    assert.equal(
      await scalar(db, "select count(*)::integer from vault.secrets where id = any($1::uuid[])", [staleOauthVaultIds]),
      0,
    );
    assert.deepEqual(
      (await db.query(
        "select status, http_status from sellerpilot_private.channel_operation_attempts where id = $1",
        [staleListingAttempt.attempt_id],
      )).rows,
      [{ status: "manual_required", http_status: 409 }],
    );
    assert.deepEqual(
      (await db.query(
        "select status, failure_class, last_error from sellerpilot_private.product_listings where id = $1",
        [staleListingId],
      )).rows,
      [{
        status: "failed",
        failure_class: "external_action",
        last_error: "Gateway write lease expired; provider outcome requires reconciliation.",
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select data_type, status, last_error
           from sellerpilot_private.channel_sync_state
          where owner_id = $1
            and ((channel_key = 'coupang' and data_type = 'orders')
              or (channel_key = 'lazada' and data_type = 'inquiries'))
          order by channel_key, data_type`,
        [ADMIN_ID],
      )).rows,
      [
        { data_type: "orders", status: "queued", last_error: null },
        { data_type: "inquiries", status: "failed", last_error: "Channel worker lease expired four times." },
      ],
    );
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(100)"),
      { retried: 0, failed: 0, reconciliationRequired: 0, oauthCompleted: 0, total: 0 },
    );
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status = 'cancelled', completed_at = now(), worker_token_id = null, claim_token = null, lease_expires_at = null where id = $1",
      [staleGatewayJobIds.live],
    );
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where id = any($1::uuid[])",
      [Object.values(staleGatewayJobIds)],
    );
    await db.query("delete from sellerpilot_private.product_listings where id = $1", [staleListingId]);
    await db.query("delete from sellerpilot_private.products where id = $1", [staleListingProductId]);
    await db.query("delete from sellerpilot_private.channel_operation_attempts where id = $1", [staleListingAttempt.attempt_id]);
    await db.query(
      `delete from sellerpilot_private.channel_sync_state
        where owner_id = $1
          and ((channel_key = 'coupang' and data_type = 'orders')
            or (channel_key = 'lazada' and data_type = 'inquiries'))`,
      [ADMIN_ID],
    );
    for (const snapshot of staleSyncStateBefore) {
      await db.query(
        `insert into sellerpilot_private.channel_sync_state
         select restored.*
           from jsonb_populate_record(
             null::sellerpilot_private.channel_sync_state,
             $1::jsonb
           ) restored`,
        [JSON.stringify(snapshot)],
      );
    }

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
      /duplicate key|unique constraint|running operation already exists/i,
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
        $5::jsonb
      )`,
      [
        uncertainWriteProductId,
        progressivePreparation.credential_id,
        uncertainWriteAttempt.attempt_id,
        "7".repeat(64),
        JSON.stringify({
          arguments: {
            shopId: "test-shop-uncertain",
            merchantSku: "UNCERTAIN-1",
            stock: 4,
            publicationIntent: "safe_test",
            publicationStateContract: "verified_remote_state_v1",
            publicationExpectedLocale: "ko-KR",
            publicationExpectedFingerprint: "7".repeat(64),
            publicationExpectedImageCount: 8,
          },
        }),
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
      const sourcePaths = aiClaimAssetPaths(sourceJobId, crossProductClaims[index]);
      const result = {
        mode: "cli",
        product: { category: "일반식품", name: `교차 비교 상품 ${index}` },
        asset_storage_paths: sourcePaths,
        asset_storage_sha256s: aiClaimAssetDigests(sourcePaths),
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
          asset_storage_sha256s: {
            portrait: createHash("sha256")
              .update(regeneratedPortraitPath, "utf8")
              .digest("hex"),
          },
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
    const crossOwnerPaths = aiClaimAssetPaths(
      crossOwnerSourceJobId,
      "75000000-0000-4000-8000-000000000003",
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, status, request_payload, result_payload, created_by, completed_at
       ) values ($1, 'product_studio', 'succeeded', '{}'::jsonb, $2::jsonb, $3, now())`,
      [crossOwnerSourceJobId, JSON.stringify({
        mode: "cli",
        product: { category: "일반식품", name: "다른 소유자 상품" },
        asset_storage_paths: crossOwnerPaths,
        asset_storage_sha256s: aiClaimAssetDigests(crossOwnerPaths),
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
    const crossProductCurrentPaths = aiClaimAssetPaths(
      crossProductCurrentJobId,
      crossProductCurrentClaim,
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status='succeeded',
              result_payload=$2::jsonb,
              completed_at=now(),
              lease_expires_at=null
        where id=$1`,
      [crossProductCurrentJobId, JSON.stringify({
        asset_storage_paths: crossProductCurrentPaths,
        asset_storage_sha256s: aiClaimAssetDigests(crossProductCurrentPaths),
      })],
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
    const completedAssetPaths = aiClaimAssetPaths(JOB_ID, claimed.claim_token);
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
      asset_storage_paths: completedAssetPaths,
      asset_storage_sha256s: aiClaimAssetDigests(completedAssetPaths),
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
    const duplicateSkuPaths = aiClaimAssetPaths(
      DUPLICATE_SKU_JOB_ID,
      duplicateSkuClaim.claim_token,
    );
    const duplicateSkuResult = {
      ...resultPayload,
      asset_storage_paths: duplicateSkuPaths,
      asset_storage_sha256s: aiClaimAssetDigests(duplicateSkuPaths),
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
      asset_storage_sha256s: {
        "detail-care": createHash("sha256")
          .update(expandedRegenerationPath, "utf8")
          .digest("hex"),
      },
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
    const operationsBeforeProviderSnapshot = await scalar(
      db,
      "select public.sellerpilot_get_product_operations_v2($1)",
      [aiProductId],
    );
    assert.deepEqual(operationsBeforeProviderSnapshot.competitorProviders, []);
    assert.equal(operationsBeforeProviderSnapshot.competitorProvidersFetchedAt, null);
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
    assert.equal(firstCompetitorClaims.rows[0].identity.productName, requiredManualFields.productName);
    assert.equal(firstCompetitorClaims.rows[0].identity.brand, requiredManualFields.brandName);
    assert.equal(firstCompetitorClaims.rows[0].identity.packageContents, requiredManualFields.packageContents);
    const competitorClaimToken = firstCompetitorClaims.rows[0].claim_token;
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)")).rows.length,
      0,
    );

    const competitorGatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, $4, $5::jsonb, 30, $2, $3)",
      [elevenstCredentialId, aiProductId, competitorClaimToken,
        firstCompetitorClaims.rows[0].query,
        JSON.stringify(firstCompetitorClaims.rows[0].aliases)],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_enqueue_competitor_search_job($1, $4, $5::jsonb, 30, $2, $3)",
        [elevenstCredentialId, aiProductId, competitorClaimToken,
          firstCompetitorClaims.rows[0].query,
          JSON.stringify(firstCompetitorClaims.rows[0].aliases)],
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
        "select public.sellerpilot_enqueue_competitor_search_job($1, $4, $5::jsonb, 30, $2, $3)",
        [elevenstCredentialId, aiProductId, competitorClaimToken,
          firstCompetitorClaims.rows[0].query,
          JSON.stringify(firstCompetitorClaims.rows[0].aliases)],
      ),
      /active competitor refresh claim required/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_enqueue_competitor_search_job($1, $4, $5::jsonb, 30, $2, $3)",
        [elevenstCredentialId, aiProductId, resumedCompetitorClaim.claim_token,
          resumedCompetitorClaim.query,
          JSON.stringify(resumedCompetitorClaim.aliases)],
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
          '[{"provider":"elevenst_product_search","status":"failed","count":0,"marketplaces":["ebay"]}]'::jsonb
        )`,
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
          '[{"provider":"elevenst_product_search","status":"failed","count":1,"marketplaces":["elevenst"]}]'::jsonb
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
    assert.deepEqual(
      (await db.query(
        "select latest_providers, providers_fetched_at from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
        [aiProductId],
      )).rows[0],
      { latest_providers: [], providers_fetched_at: null },
    );
    await assert.rejects(
      db.query(
        `update sellerpilot_private.competitor_price_refresh_claims
            set latest_providers = '[{"provider":"elevenst_product_search","status":"pending","count":0,"marketplaces":["elevenst"]}]'::jsonb,
                providers_fetched_at = now()
          where product_id = $1`,
        [aiProductId],
      ),
      /competitor_price_refresh_claims_provider_snapshot_check/,
    );

    const completedCompetitorProviders = [
      { provider: "naver_shopping", status: "unavailable", count: 0, marketplaces: ["smartstore", "coupang", "elevenst", "qoo10", "other"] },
      { provider: "elevenst_product_search", status: "searched", count: 1, marketplaces: ["elevenst"] },
      { provider: "ebay_browse", status: "failed", count: 0, marketplaces: ["ebay"] },
      { provider: "brave_marketplace_web", status: "searched", count: 1, marketplaces: ["shopee", "lazada", "temu"] },
    ];
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2,
          '[{"provider":"elevenst_product_search","externalId":"durable-competitor-1","title":"첵스초코 570g","url":"https://www.11st.co.kr/products/123","imageUrl":"","mallName":"11번가","marketplace":"elevenst","price":7900,"currency":"KRW","matcherVersion":"strict-2026-08-28-v2"},{"provider":"brave_marketplace_web","externalId":"www.temu.com:601099999999999","title":"Kellogg Choco Chex 570g","url":"https://www.temu.com/kellogg-choco-chex-g-601099999999999.html","imageUrl":"","mallName":"Temu","marketplace":"temu","price":11.5,"currency":"USD","matcherVersion":"strict-2026-08-28-v2"}]'::jsonb,
          $3::jsonb
        )`,
        [aiProductId, resumedCompetitorClaim.claim_token, JSON.stringify(completedCompetitorProviders)],
      ),
      2,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id = $1 and external_id in ('obsolete-elevenst', 'obsolete-ebay')",
        [aiProductId],
      ),
      2,
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
    const persistedProviderState = (await db.query(
      "select latest_providers, providers_fetched_at from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
      [aiProductId],
    )).rows[0];
    assert.deepEqual(persistedProviderState.latest_providers, completedCompetitorProviders);
    const persistedProviderFetchedAt = new Date(persistedProviderState.providers_fetched_at);
    assert.equal(Number.isNaN(persistedProviderFetchedAt.getTime()), false);
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
    assert.deepEqual(
      (({ provider, preserved }) => ({ provider, preserved }))(
        freshCompetitorOperations.competitorPrices.find((item) => item.title === "첵스초코 570g"),
      ),
      { provider: "elevenst_product_search", preserved: false },
    );
    assert.deepEqual(
      (({ provider, preserved }) => ({ provider, preserved }))(
        freshCompetitorOperations.competitorPrices.find((item) => item.title === "수동 기준 가격"),
      ),
      { provider: "manual", preserved: false },
    );
    assert.equal(
      freshCompetitorOperations.competitorPrices.some((item) => item.provider === "naver_shopping" && item.preserved === true),
      true,
    );
    assert.deepEqual(freshCompetitorOperations.competitorProviders, completedCompetitorProviders);
    assert.equal(
      new Date(freshCompetitorOperations.competitorProvidersFetchedAt).toISOString(),
      persistedProviderFetchedAt.toISOString(),
    );
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
    const providerStateAfterStaleCompletion = (await db.query(
      "select latest_providers, providers_fetched_at from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
      [aiProductId],
    )).rows[0];
    assert.deepEqual(providerStateAfterStaleCompletion.latest_providers, completedCompetitorProviders);
    assert.equal(
      new Date(providerStateAfterStaleCompletion.providers_fetched_at).toISOString(),
      persistedProviderFetchedAt.toISOString(),
    );

    const v3ObservedAt = "2026-08-31T03:00:00.000Z";
    const v3Candidate = {
      provider: "naver_shopping",
      externalId: "v3-mug-white-1",
      title: "No Brand 흰색 도자기 머그컵 1개",
      url: "https://smartstore.naver.com/example/products/v3-mug-white-1",
      imageUrl: "",
      mallName: "테스트 스마트스토어",
      marketplace: "smartstore",
      price: 10_000,
      currency: "KRW",
      matcherVersion: "strict-2026-08-31-v3",
      matchScore: 100,
      matchTier: "exact",
      matchEvidence: [
        { code: "brand_exact", attribute: "brand", expected: "No Brand", actual: "No Brand", source: "provider_structured" },
        { code: "name_exact", attribute: "productName", expected: "흰색 도자기 머그컵", actual: "흰색 도자기 머그컵", source: "listing_title" },
      ],
      mismatchEvidence: [],
      priceComponents: {
        itemPrice: { status: "known", amount: 10_000, currency: "KRW", krwAmount: 10_000 },
        requiredOptionSurcharge: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
        shipping: { status: "known", amount: 3_000, currency: "KRW", krwAmount: 3_000 },
        taxAndDuty: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
        discount: { status: "known", amount: 100, currency: "KRW", krwAmount: 100 },
      },
      totalPurchasePrice: { amount: 12_900, currency: "KRW", krwAmount: 12_900 },
      exchangeRate: null,
      unitPrice: {
        amount: 12_900,
        currency: "KRW",
        krwAmount: 12_900,
        quantity: { value: 1, unit: "item" },
      },
      canonicalUrl: "https://smartstore.naver.com/example/products/v3-mug-white-1",
      provenance: [{
        provider: "naver_shopping",
        marketplace: "smartstore",
        externalId: "v3-mug-white-1",
        url: "https://smartstore.naver.com/example/products/v3-mug-white-1",
        collectedAt: v3ObservedAt,
      }],
      observedAt: v3ObservedAt,
      inventoryStatus: "in_stock",
    };
    const v3Providers = [{
      provider: "naver_shopping",
      status: "searched",
      count: 1,
      marketplaces: ["smartstore", "coupang", "elevenst", "qoo10", "other"],
    }];
    const preservedV2AndManualCount = await scalar(
      db,
      `select count(*)::integer
         from sellerpilot_private.competitor_price_observations
        where product_id = $1
          and (provider = 'manual' or matcher_version = 'strict-2026-08-28-v2')`,
      [aiProductId],
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'sellerpilot_private.record_competitor_prices(uuid,jsonb,boolean)', 'EXECUTE')",
      ),
      false,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_record_competitor_prices($1, $2::jsonb)",
        [aiProductId, JSON.stringify([v3Candidate])],
      ),
      /competitor v3 observations require refresh completion/,
    );

    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const v3Claim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(v3Claim.product_id, aiProductId);
    const missingMatchScore = structuredClone(v3Candidate);
    delete missingMatchScore.matchScore;
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, $3::jsonb, $4::jsonb)",
        [aiProductId, v3Claim.claim_token, JSON.stringify([missingMatchScore]), JSON.stringify(v3Providers)],
      ),
      /invalid competitor refresh snapshot/,
    );
    const invalidUnknownExchange = structuredClone(v3Candidate);
    invalidUnknownExchange.priceComponents.shipping = {
      status: "unknown",
      amount: null,
      currency: "KRW",
      krwAmount: null,
    };
    invalidUnknownExchange.totalPurchasePrice = null;
    invalidUnknownExchange.unitPrice = null;
    invalidUnknownExchange.exchangeRate = { provider: "unvalidated" };
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.valid_competitor_v3_item($1::jsonb)",
        [JSON.stringify({ ...invalidUnknownExchange, exchangeRate: null })],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.valid_competitor_v3_item($1::jsonb)",
        [JSON.stringify({
          ...invalidUnknownExchange,
          exchangeRate: null,
          unitPrice: v3Candidate.unitPrice,
        })],
      ),
      false,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, $3::jsonb, $4::jsonb)",
        [aiProductId, v3Claim.claim_token, JSON.stringify([invalidUnknownExchange]), JSON.stringify(v3Providers)],
      ),
      /invalid competitor refresh snapshot/,
    );
    const inconsistentFx = {
      ...v3Candidate,
      price: 10,
      currency: "USD",
      priceComponents: {
        itemPrice: { status: "known", amount: 10, currency: "USD", krwAmount: 13_000 },
        requiredOptionSurcharge: { status: "known", amount: 0, currency: "USD", krwAmount: 0 },
        shipping: { status: "known", amount: 2, currency: "USD", krwAmount: 2_600 },
        taxAndDuty: { status: "known", amount: 0, currency: "USD", krwAmount: 0 },
        discount: { status: "known", amount: 0, currency: "USD", krwAmount: 0 },
      },
      totalPurchasePrice: { amount: 12, currency: "USD", krwAmount: 9_999 },
      exchangeRate: {
        provider: "synthetic-fx",
        quotedAt: v3ObservedAt,
        rate: 1_300,
        fromCurrency: "USD",
        toCurrency: "KRW",
      },
      unitPrice: null,
    };
    const foreignWithoutFx = {
      ...inconsistentFx,
      priceComponents: Object.fromEntries(Object.entries(inconsistentFx.priceComponents).map(([key, component]) => [
        key,
        { ...component, krwAmount: null },
      ])),
      totalPurchasePrice: { amount: 12, currency: "USD", krwAmount: null },
      exchangeRate: null,
    };
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.valid_competitor_v3_item($1::jsonb)",
        [JSON.stringify(foreignWithoutFx)],
      ),
      true,
    );
    const badKrwComponent = structuredClone(v3Candidate);
    badKrwComponent.priceComponents.shipping.krwAmount = 2_999;
    const badKrwUnit = structuredClone(v3Candidate);
    badKrwUnit.unitPrice.krwAmount = 12_899;
    const validForeignFx = {
      ...inconsistentFx,
      totalPurchasePrice: { amount: 12, currency: "USD", krwAmount: 15_600 },
      unitPrice: {
        amount: 6,
        currency: "USD",
        krwAmount: 7_800,
        quantity: { value: 1, unit: "item" },
      },
    };
    const badFxComponent = structuredClone(validForeignFx);
    badFxComponent.priceComponents.shipping.krwAmount = 2_599;
    const badFxUnit = structuredClone(validForeignFx);
    badFxUnit.unitPrice.krwAmount = 7_799;
    assert.equal(
      await scalar(db, "select sellerpilot_private.valid_competitor_v3_item($1::jsonb)", [JSON.stringify(validForeignFx)]),
      true,
    );
    for (const invalidKrwPayload of [badKrwComponent, badKrwUnit, badFxComponent, badFxUnit]) {
      assert.equal(
        await scalar(db, "select sellerpilot_private.valid_competitor_v3_item($1::jsonb)", [JSON.stringify(invalidKrwPayload)]),
        false,
      );
    }
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, $3::jsonb, $4::jsonb)",
        [aiProductId, v3Claim.claim_token, JSON.stringify([inconsistentFx]), JSON.stringify(v3Providers)],
      ),
      /invalid competitor refresh snapshot/,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_refresh_claims where product_id = $1 and claim_token = $2",
        [aiProductId, v3Claim.claim_token],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, $3::jsonb, $4::jsonb)",
        [aiProductId, v3Claim.claim_token, JSON.stringify([v3Candidate]), JSON.stringify(v3Providers)],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.competitor_price_observations
          where product_id = $1
            and (provider = 'manual' or matcher_version = 'strict-2026-08-28-v2')`,
        [aiProductId],
      ),
      preservedV2AndManualCount,
    );

    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const repeatedProviderClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(repeatedProviderClaim.product_id, aiProductId);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, '[]'::jsonb, $3::jsonb)",
        [aiProductId, repeatedProviderClaim.claim_token, JSON.stringify([{ ...v3Providers[0], count: 0 }])],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.competitor_price_observations where product_id = $1 and matcher_version = 'strict-2026-08-31-v3'",
        [aiProductId],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.competitor_price_observations
          where product_id = $1
            and (provider = 'manual' or matcher_version = 'strict-2026-08-28-v2')`,
        [aiProductId],
      ),
      preservedV2AndManualCount,
    );

    for (let iteration = 0; iteration < 40; iteration += 1) {
      const collectedAt = new Date(Date.parse(v3ObservedAt) + ((iteration + 1) * 1_000)).toISOString();
      const repeatedCandidate = {
        ...v3Candidate,
        observedAt: collectedAt,
        provenance: [{
          ...v3Candidate.provenance[0],
          url: `${v3Candidate.provenance[0].url}?utm_cycle=${iteration + 1}`,
          collectedAt,
        }],
      };
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.record_competitor_prices($1, $2::jsonb, true)",
          [aiProductId, JSON.stringify([repeatedCandidate])],
        ),
        1,
      );
    }
    const deduplicatedV3Observation = (await db.query(
      `select count(*) over ()::integer as row_count,
              jsonb_array_length(provenance)::integer as provenance_count,
              provenance->0->>'collectedAt' as collected_at,
              provenance->0->>'url' as provenance_url,
              match_tier, match_score::text, price_components, total_purchase_price,
              exchange_rate, unit_price, inventory_status
         from sellerpilot_private.competitor_price_observations
        where product_id = $1
          and matcher_version = 'strict-2026-08-31-v3'
          and canonical_url = $2`,
      [aiProductId, v3Candidate.canonicalUrl],
    )).rows[0];
    assert.deepEqual(
      {
        rowCount: deduplicatedV3Observation.row_count,
        provenanceCount: deduplicatedV3Observation.provenance_count,
        matchTier: deduplicatedV3Observation.match_tier,
        matchScore: deduplicatedV3Observation.match_score,
        inventoryStatus: deduplicatedV3Observation.inventory_status,
      },
      {
        rowCount: 1,
        provenanceCount: 1,
        matchTier: "exact",
        matchScore: "100.00",
        inventoryStatus: "in_stock",
      },
    );
    assert.equal(
      deduplicatedV3Observation.collected_at,
      new Date(Date.parse(v3ObservedAt) + (40 * 1_000)).toISOString(),
    );
    assert.equal(deduplicatedV3Observation.provenance_url, `${v3Candidate.provenance[0].url}?utm_cycle=40`);
    assert.equal(deduplicatedV3Observation.price_components.shipping.amount, 3_000);
    assert.equal(deduplicatedV3Observation.total_purchase_price.krwAmount, 12_900);
    assert.equal(deduplicatedV3Observation.exchange_rate, null);
    assert.equal(deduplicatedV3Observation.unit_price.quantity.value, 1);

    const sharedCanonicalUrl = "https://market.example.test/products/shared-mug";
    const rawNaverCandidate = {
      ...v3Candidate,
      externalId: "naver-shared-mug",
      url: sharedCanonicalUrl,
      marketplace: "other",
      canonicalUrl: sharedCanonicalUrl,
      provenance: [{
        provider: "naver_shopping",
        marketplace: "other",
        externalId: "naver-shared-mug",
        url: sharedCanonicalUrl,
        collectedAt: v3ObservedAt,
      }],
    };
    const rawBraveCandidate = {
      ...rawNaverCandidate,
      provider: "brave_marketplace_web",
      externalId: "brave-shared-mug",
      marketplace: "temu",
      price: 20_000,
      priceComponents: {
        itemPrice: { status: "known", amount: 20_000, currency: "KRW", krwAmount: 20_000 },
        requiredOptionSurcharge: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
        shipping: { status: "known", amount: 3_000, currency: "KRW", krwAmount: 3_000 },
        taxAndDuty: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
        discount: { status: "known", amount: 100, currency: "KRW", krwAmount: 100 },
      },
      totalPurchasePrice: { amount: 22_900, currency: "KRW", krwAmount: 22_900 },
      unitPrice: {
        amount: 22_900,
        currency: "KRW",
        krwAmount: 22_900,
        quantity: { value: 1, unit: "item" },
      },
      provenance: [{
        provider: "brave_marketplace_web",
        marketplace: "temu",
        externalId: "brave-shared-mug",
        url: sharedCanonicalUrl,
        collectedAt: v3ObservedAt,
      }],
    };
    const rawProviderSnapshot = [
      { ...v3Providers[0], count: 1 },
      {
        provider: "brave_marketplace_web",
        status: "searched",
        count: 1,
        marketplaces: ["shopee", "lazada", "temu"],
      },
    ];
    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const rawProviderClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, $3::jsonb, $4::jsonb)",
        [
          aiProductId,
          rawProviderClaim.claim_token,
          JSON.stringify([rawNaverCandidate, rawBraveCandidate]),
          JSON.stringify(rawProviderSnapshot),
        ],
      ),
      2,
    );
    assert.deepEqual(
      (await db.query(
        `select provider, external_id, price::text, provenance->0->>'provider' as provenance_provider
           from sellerpilot_private.competitor_price_observations
          where product_id = $1 and matcher_version = 'strict-2026-08-31-v3' and canonical_url = $2
          order by provider`,
        [aiProductId, sharedCanonicalUrl],
      )).rows,
      [
        { provider: "brave_marketplace_web", external_id: "brave-shared-mug", price: "20000.00", provenance_provider: "brave_marketplace_web" },
        { provider: "naver_shopping", external_id: "naver-shared-mug", price: "10000.00", provenance_provider: "naver_shopping" },
      ],
    );

    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const braveEmptyClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_competitor_price_refresh($1, $2, '[]'::jsonb, $3::jsonb)",
        [aiProductId, braveEmptyClaim.claim_token, JSON.stringify([
          { ...v3Providers[0], status: "failed", count: 0 },
          { ...rawProviderSnapshot[1], count: 0 },
        ])],
      ),
      0,
    );
    assert.deepEqual(
      (await db.query(
        `select provider, external_id, price::text, provenance->0->>'provider' as provenance_provider
           from sellerpilot_private.competitor_price_observations
          where product_id = $1 and matcher_version = 'strict-2026-08-31-v3' and canonical_url = $2`,
        [aiProductId, sharedCanonicalUrl],
      )).rows,
      [{ provider: "naver_shopping", external_id: "naver-shared-mug", price: "10000.00", provenance_provider: "naver_shopping" }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.competitor_price_observations
          where product_id = $1
            and (provider = 'manual' or matcher_version = 'strict-2026-08-28-v2')`,
        [aiProductId],
      ),
      preservedV2AndManualCount,
    );

    await setClaims(db);
    const v3Operations = await scalar(
      db,
      "select public.sellerpilot_get_product_operations_v2($1)",
      [aiProductId],
    );
    const v3Operation = v3Operations.competitorPrices.find((item) => item.canonicalUrl === sharedCanonicalUrl);
    assert.equal(v3Operation.matcherVersion, "strict-2026-08-31-v3");
    assert.equal(v3Operation.externalId, "naver-shared-mug");
    assert.equal(v3Operation.matchEvidence[0].source, "provider_structured");
    assert.equal(v3Operation.totalPurchasePrice.krwAmount, 12_900);
    assert.equal(v3Operations.competitorPrices.some((item) => item.provider === "manual"), true);

    await setClaims(db, "service_role");
    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const expiredV3Claim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 30)",
    )).rows[0];
    await db.query(
      "update sellerpilot_private.competitor_price_refresh_claims set claimed_at = now() - interval '31 seconds', lease_expires_at = now() - interval '1 second' where product_id = $1",
      [aiProductId],
    );
    const providerStateBeforeExpiredCompletion = (await db.query(
      "select latest_providers, providers_fetched_at from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
      [aiProductId],
    )).rows[0];
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"naver_shopping","status":"failed","count":0,"marketplaces":["smartstore","coupang","elevenst","qoo10","other"]}]'::jsonb
        )`,
        [aiProductId, expiredV3Claim.claim_token],
      ),
      -1,
    );
    assert.deepEqual(
      (await db.query(
        "select latest_providers, providers_fetched_at from sellerpilot_private.competitor_price_refresh_claims where product_id = $1",
        [aiProductId],
      )).rows[0],
      providerStateBeforeExpiredCompletion,
    );
    const reclaimedV3Claim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    assert.equal(reclaimedV3Claim.product_id, aiProductId);
    assert.notEqual(reclaimedV3Claim.claim_token, expiredV3Claim.claim_token);
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          '[{"provider":"naver_shopping","status":"failed","count":0,"marketplaces":["smartstore","coupang","elevenst","qoo10","other"]}]'::jsonb
        )`,
        [aiProductId, reclaimedV3Claim.claim_token],
      ),
      0,
    );

    await db.query("update sellerpilot_private.products set competitor_checked_at = null where id = $1", [aiProductId]);
    const retentionCompetitorClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_due_competitor_products(1, 90)",
    )).rows[0];
    const retentionGatewayJobId = await scalar(
      db,
      "select public.sellerpilot_enqueue_competitor_search_job($1, $4, $5::jsonb, 30, $2, $3)",
      [elevenstCredentialId, aiProductId, retentionCompetitorClaim.claim_token,
        retentionCompetitorClaim.query,
        JSON.stringify(retentionCompetitorClaim.aliases)],
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
    const terminalCompetitorProviders = [
      { provider: "naver_shopping", status: "unavailable", count: 0, marketplaces: ["smartstore", "coupang", "elevenst", "qoo10", "other"] },
      { provider: "elevenst_product_search", status: "failed", count: 0, marketplaces: ["elevenst"] },
      { provider: "ebay_browse", status: "failed", count: 0, marketplaces: ["ebay"] },
      { provider: "brave_marketplace_web", status: "unavailable", count: 0, marketplaces: ["shopee", "lazada", "temu"] },
    ];
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_competitor_price_refresh(
          $1, $2, '[]'::jsonb,
          $3::jsonb
        )`,
        [aiProductId, reclaimedCompetitorClaim.claim_token, JSON.stringify(terminalCompetitorProviders)],
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
    const terminalCompetitorOperations = await scalar(
      db,
      "select public.sellerpilot_get_product_operations_v2($1)",
      [aiProductId],
    );
    assert.deepEqual(terminalCompetitorOperations.competitorProviders, terminalCompetitorProviders);
    assert.equal(Number.isNaN(new Date(terminalCompetitorOperations.competitorProvidersFetchedAt).getTime()), false);
    assert.notEqual(
      new Date(terminalCompetitorOperations.competitorProvidersFetchedAt).toISOString(),
      persistedProviderFetchedAt.toISOString(),
    );
    assert.deepEqual(
      (({ provider, preserved }) => ({ provider, preserved }))(
        terminalCompetitorOperations.competitorPrices.find((item) => item.title === "첵스초코 570g"),
      ),
      { provider: "elevenst_product_search", preserved: true },
    );
    assert.deepEqual(
      (({ provider, preserved }) => ({ provider, preserved }))(
        terminalCompetitorOperations.competitorPrices.find((item) => item.title === "Kellogg Choco Chex 570g" && item.marketplace === "temu"),
      ),
      { provider: "brave_marketplace_web", preserved: true },
    );
    assert.deepEqual(
      (({ provider, preserved }) => ({ provider, preserved }))(
        terminalCompetitorOperations.competitorPrices.find((item) => item.title === "수동 기준 가격"),
      ),
      { provider: "manual", preserved: false },
    );
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
        $5::jsonb
      )`,
      [
        aiProductId,
        elevenstCredentialId,
        elevenstAttempt.attempt_id,
        "e".repeat(64),
        JSON.stringify({
          arguments: {
            verificationOnly: true,
            publicationIntent: "safe_test",
            publicationStateContract: "verified_remote_state_v1",
            publicationExpectedLocale: "ko-KR",
            publicationExpectedFingerprint: "e".repeat(64),
            publicationExpectedImageCount: 8,
          },
        }),
      ],
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
    const approvedDetailRoles = [
      "detail-overview",
      "detail-feature",
      "detail-use",
      "detail-package",
      "detail-routine",
      "detail-dimensions",
      "detail-contents",
      "detail-care",
    ];
    const approvedAssetStoragePaths = await scalar(
      db,
      "select result_payload->'asset_storage_paths' from sellerpilot_private.ai_cli_jobs where id = $1",
      [JOB_ID],
    );
    await db.query(
      `insert into storage.objects (bucket_id, name)
       select 'sellerpilot-ai', asset.value
         from jsonb_each_text($1::jsonb) asset`,
      [JSON.stringify(approvedAssetStoragePaths)],
    );
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
        ...approvedDetailRoles.map((role, index) => ({
          type: "ImageStoryBlock",
          props: {
            id: `image-${index + 1}`,
            imageUrl: `sellerpilot-asset://${role}`,
            imageRole: role,
            imageAlt: `AI 생성 테스트 상품 상세 이미지 ${index + 1}`,
          },
        })),
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
    assert.equal(savedDetailV1.approvedVersion, 1);
    assert.equal(savedDetailV1.imageManifest.contract, "sellerpilot_detail_image_manifest_v1");
    assert.equal(savedDetailV1.imageManifest.algorithm, "sha256");
    assert.deepEqual(savedDetailV1.imageManifest.images.map((image) => image.role), approvedDetailRoles);
    assert.deepEqual(savedDetailV1.imageManifest.images.map((image) => image.path), approvedDetailRoles.map((role) => approvedAssetStoragePaths[role]));
    const expectedDetailManifestDigest = createHash("sha256").update(
      approvedDetailRoles.map((role) => `${role}\t${approvedAssetStoragePaths[role]}`).join("\n"),
      "utf8",
    ).digest("hex");
    assert.equal(savedDetailV1.imageManifest.digest, expectedDetailManifestDigest);
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
    assert.equal(savedDetailV2.approvedVersion, 2);
    assert.equal(savedDetailV2.imageManifest.digest, expectedDetailManifestDigest);
    await db.exec("begin");
    try {
      await db.query(
        "update sellerpilot_private.products set detail_page_data = jsonb_set(detail_page_data, '{root}', '{\"changed\":true}'::jsonb, true) where id = $1",
        [aiProductId],
      );
      assert.deepEqual(
        (await db.query(
          "select detail_page_approved_version, detail_page_image_manifest from sellerpilot_private.products where id = $1",
          [aiProductId],
        )).rows[0],
        { detail_page_approved_version: 0, detail_page_image_manifest: null },
      );
    } finally {
      await db.exec("rollback");
    }
    assert.equal(
      Object.keys(approvedAssetStoragePaths).filter((role) => role.startsWith("detail-")).length,
      12,
      "the full twelve-role Studio asset ledger remains intact while the page approves eight",
    );
    const detailImageBlocks = detailPageV2.content.filter((block) => block.type === "ImageStoryBlock");
    const invalidExactEightDocuments = [
      {
        ...detailPageV2,
        content: detailPageV2.content.filter((block) => block.props.id !== "image-8"),
      },
      {
        ...detailPageV2,
        content: [
          ...detailPageV2.content,
          {
            type: "ImageStoryBlock",
            props: {
              id: "image-9",
              imageUrl: "sellerpilot-asset://detail-scale",
              imageRole: "detail-scale",
              imageAlt: "허용되지만 아홉 번째인 상세 이미지",
            },
          },
        ],
      },
      {
        ...detailPageV2,
        content: detailPageV2.content.map((block) => (
          block.props.id === "image-2"
            ? {
                ...block,
                props: {
                  ...block.props,
                  imageUrl: detailImageBlocks[0].props.imageUrl,
                  imageRole: detailImageBlocks[0].props.imageRole,
                },
              }
            : block
        )),
      },
      {
        ...detailPageV2,
        content: detailPageV2.content.map((block) => (
          block.props.id === "image-1"
            ? { ...block, props: { ...block.props, imageUrl: "https://cdn.example.com/detail.png" } }
            : block
        )),
      },
      {
        ...detailPageV2,
        content: detailPageV2.content.map((block) => (
          block.props.id === "image-1"
            ? { ...block, props: { ...block.props, imageUrl: "sellerpilot-asset://hero", imageRole: "hero" } }
            : block
        )),
      },
      {
        ...detailPageV2,
        content: detailPageV2.content.map((block) => (
          block.props.id === "image-1"
            ? { ...block, props: { ...block.props, imageAlt: "   " } }
            : block
        )),
      },
      {
        ...detailPageV2,
        content: detailPageV2.content.map((block) => (
          block.props.id === "image-1"
            ? { ...block, props: { ...block.props, imageRole: "detail-feature" } }
            : block
        )),
      },
    ];
    for (const invalidDocument of invalidExactEightDocuments) {
      await db.exec("begin");
      try {
        await assert.rejects(
          db.query(
            "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
            [aiProductId, JSON.stringify(invalidDocument)],
          ),
          /DETAIL_PAGE_INVALID/,
        );
      } finally {
        await db.exec("rollback");
      }
    }
    await db.exec("begin");
    try {
      await db.query(
        "delete from storage.objects where bucket_id = 'sellerpilot-ai' and name = $1",
        [approvedAssetStoragePaths["detail-care"]],
      );
      await assert.rejects(
        db.query(
          "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, 2)",
          [aiProductId, JSON.stringify(detailPageV2)],
        ),
        /DETAIL_PAGE_ASSETS_UNRESOLVED/,
      );
    } finally {
      await db.exec("rollback");
    }
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
    assert.deepEqual(Object.keys(detailAudit).sort(), ["block_count", "document_bytes", "image_count", "manifest_digest", "version"]);
    assert.equal(detailAudit.version, 2);
    assert.equal(detailAudit.image_count, 8);
    assert.equal(detailAudit.manifest_digest, expectedDetailManifestDigest);
    assert.equal(JSON.stringify(detailAudit).includes("수정된 CTA"), false);

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set created_by = $2 where id = $1",
      [JOB_ID, SECOND_ADMIN_ID],
    );
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_get_product_publish_context($1)",
        [aiProductId],
      ),
      /PRODUCT_CONTENT_LINEAGE_UNVERIFIED/,
    );
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
    assert.equal(publishContext.detailPage.approvedVersion, 2);
    assert.equal(publishContext.detailPage.imageManifest.digest, expectedDetailManifestDigest);
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
        $1, $2, $3, 'coupang', '', '', 'KRW', 25000, $4, $5::jsonb
      )`,
      [
        aiProductId,
        coupangCredentialId,
        listingAttempt.attempt_id,
        "c".repeat(64),
        JSON.stringify({
          arguments: {
            publicationIntent: "safe_test",
            publicationStateContract: "verified_remote_state_v1",
            publicationExpectedLocale: "ko-KR",
            publicationExpectedFingerprint: "c".repeat(64),
            publicationExpectedImageCount: 8,
          },
        }),
      ],
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
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'active', revoked_at = null where token_hash = $1",
      [AI_SCOPED_TOKEN_HASH],
    );
    await setClaims(db, "service_role");
    const revisionMarkerMismatches = [
      ["revision_product_id", SHARED_PRODUCT_ID],
      ["revision_base_ai_job_id", null],
      ["revision_base_product_updated_at", "2000-01-01T00:00:00.000Z"],
      ["revision_mode", "replace_product_copy_only"],
      ["auto_publish", true],
    ];
    for (const [marker, value] of revisionMarkerMismatches) {
      await db.exec("begin");
      try {
        await db.query(
          `update sellerpilot_private.ai_cli_jobs
              set request_payload = jsonb_set(request_payload, $2::text[], $3::jsonb, true),
                  available_at = timestamptz '1900-01-01 00:00:00+00'
            where id = $1`,
          [PRODUCT_REVISION_JOB_ID, [marker], JSON.stringify(value)],
        );
        const markerMismatchClaim = await scalar(
          db,
          "select public.sellerpilot_claim_product_ai_job($1, 'migration-test/revision-marker-mismatch')",
          [AI_SCOPED_TOKEN_HASH],
        );
        assert.equal(markerMismatchClaim.id, PRODUCT_REVISION_JOB_ID);
        assert.equal(
          markerMismatchClaim.revision_fallback_authorized,
          false,
          `${marker} must be exact before the claim can attest revision fallback`,
        );
      } finally {
        await db.exec("rollback");
      }
    }

    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, created_by, status, available_at, created_at
       )
       select $1, 'product_studio', job.request_payload, job.created_by, 'queued',
              timestamptz '1900-01-01 00:00:00+00', timestamptz '1900-01-01 00:00:00+00'
         from sellerpilot_private.ai_cli_jobs job
        where job.id = $2`,
      [REVISION_FALLBACK_SPOOF_JOB_ID, PRODUCT_REVISION_JOB_ID],
    );
    const spoofClaim = await scalar(
      db,
      "select public.sellerpilot_claim_product_ai_job($1, 'migration-test/revision-spoof')",
      [AI_SCOPED_TOKEN_HASH],
    );
    assert.equal(spoofClaim.id, REVISION_FALLBACK_SPOOF_JOB_ID);
    assert.equal(spoofClaim.revision_fallback_authorized, false);
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set status = 'failed', error_message = 'test-only unattested revision marker job',
              completed_at = clock_timestamp(), lease_expires_at = null
        where id = $1`,
      [REVISION_FALLBACK_SPOOF_JOB_ID],
    );

    await db.query(
      "update sellerpilot_private.ai_cli_jobs set available_at = timestamptz '1900-01-02 00:00:00+00' where id = $1",
      [PRODUCT_REVISION_JOB_ID],
    );
    const attestedRevisionClaim = await scalar(
      db,
      "select public.sellerpilot_claim_product_ai_job($1, 'migration-test/revision-attested')",
      [AI_SCOPED_TOKEN_HASH],
    );
    assert.equal(attestedRevisionClaim.id, PRODUCT_REVISION_JOB_ID);
    assert.equal(attestedRevisionClaim.revision_fallback_authorized, true);
    assert.equal(attestedRevisionClaim.request.revision_mode, "replace_product_assets");
    assert.equal(attestedRevisionClaim.request.revision_product_id, aiProductId);
    assert.equal(attestedRevisionClaim.request.revision_base_ai_job_id, JOB_ID);
    assert.equal(attestedRevisionClaim.request.auto_publish, false);
    assert.equal(
      attestedRevisionClaim.request.revision_base_product_updated_at,
      await scalar(
        db,
        "select to_jsonb(base_product_updated_at)#>>'{}' from sellerpilot_private.product_ai_revisions where job_id = $1",
        [PRODUCT_REVISION_JOB_ID],
      ),
    );
    await db.query(
      "update sellerpilot_private.ai_cli_worker_tokens set status = 'revoked', revoked_at = clock_timestamp() where token_hash = $1",
      [AI_SCOPED_TOKEN_HASH],
    );
    await setClaims(db);
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

    const revisionAssetPaths = aiClaimAssetPaths(
      PRODUCT_REVISION_JOB_ID,
      "784346eb-2788-4783-97da-451344fed051",
    );
    const revisionResult = {
      ...resultPayload,
      product: { ...resultPayload.product, name: revisionManualFields.productName },
      asset_storage_paths: revisionAssetPaths,
      asset_storage_sha256s: aiClaimAssetDigests(revisionAssetPaths),
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
        "select id, ai_job_id, name, on_hand, (product_facts->>'stock')::integer as facts_stock, detail_page_data, detail_page_version, detail_page_approved_version, detail_page_image_manifest from sellerpilot_private.products where id = $1",
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
        detail_page_approved_version: 0,
        detail_page_image_manifest: null,
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
    const staleRevisionAssetPaths = aiClaimAssetPaths(
      STALE_PRODUCT_REVISION_JOB_ID,
      "a19ae9d1-a544-4a12-96fd-b89501a03f89",
    );
    await db.query(
      "update sellerpilot_private.ai_cli_jobs set status = 'succeeded', result_payload = $2::jsonb, completed_at = now() where id = $1",
      [STALE_PRODUCT_REVISION_JOB_ID, JSON.stringify({
        ...revisionResult,
        asset_storage_paths: staleRevisionAssetPaths,
        asset_storage_sha256s: aiClaimAssetDigests(staleRevisionAssetPaths),
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
        "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.update', $4::jsonb)",
        [preparedListingId, otherCoupangCredentialId, crossAccountAttempt.attempt_id, JSON.stringify({
          arguments: {
            publicationIntent: "safe_test",
            publicationStateContract: "verified_remote_state_v1",
            publicationExpectedLocale: "ko-KR",
            publicationExpectedFingerprint: "7".repeat(64),
            publicationExpectedImageCount: 8,
          },
        })],
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
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.update', $4::jsonb)",
      [updatePreparedListingId, coupangCredentialId, failedUpdateAttempt.attempt_id, JSON.stringify({
        arguments: {
          publicationIntent: "safe_test",
          publicationStateContract: "verified_remote_state_v1",
          publicationExpectedLocale: "ko-KR",
          publicationExpectedFingerprint: "f".repeat(64),
          publicationExpectedImageCount: 8,
        },
      })],
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
    assert.equal(failedPublishedListing.publishedAt, null);
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
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.stop', $4::jsonb)",
      [preparedListingId, coupangCredentialId, stopListingAttempt.attempt_id, JSON.stringify({
        arguments: {
          publicationStateContract: "verified_remote_state_v1",
          publicationExpectedLocale: "ko-KR",
          publicationExpectedFingerprint: "9".repeat(64),
          publicationExpectedImageCount: 0,
        },
      })],
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
      "select public.sellerpilot_service_enqueue_listing_gateway_job($1, $2, $3, 'coupang', 'listing.update', $4::jsonb)",
      [preparedListingId, coupangCredentialId, resumeListingAttempt.attempt_id, JSON.stringify({
        arguments: {
          publicationIntent: "safe_test",
          publicationStateContract: "verified_remote_state_v1",
          publicationExpectedLocale: "ko-KR",
          publicationExpectedFingerprint: "8".repeat(64),
          publicationExpectedImageCount: 8,
        },
      })],
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
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_get_product_publish_context($1)",
        [SHARED_PRODUCT_ID],
      ),
      /PRODUCT_CONTENT_LINEAGE_UNVERIFIED/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, null)",
        [SHARED_PRODUCT_ID, JSON.stringify(detailPageV2)],
      ),
      null,
    );
    await setClaims(db, "authenticated", SECOND_ADMIN_ID);
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [SHARED_PRODUCT_ID]),
      {
        productId: SHARED_PRODUCT_ID,
        data: null,
        version: 0,
        approvedVersion: 0,
        imageManifest: null,
        updatedAt: null,
      },
    );
    await db.query(
      "update sellerpilot_private.products set status = 'archived' where id = $1",
      [SHARED_PRODUCT_ID],
    );
    assert.equal(
      await scalar(db, "select public.sellerpilot_get_product_detail_page($1)", [SHARED_PRODUCT_ID]),
      null,
    );
    await assert.rejects(
      scalar(
        db,
        "select public.sellerpilot_get_product_publish_context($1)",
        [SHARED_PRODUCT_ID],
      ),
      /PRODUCT_CONTENT_LINEAGE_UNVERIFIED/,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_save_product_detail_page($1, $2::jsonb, null)",
        [SHARED_PRODUCT_ID, JSON.stringify(detailPageV2)],
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
    await assert.rejects(
      scalar(db, "select public.sellerpilot_get_product_publish_context($1)", [SHARED_PRODUCT_ID]),
      /PRODUCT_CONTENT_LINEAGE_UNVERIFIED/,
    );

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
        $5::jsonb
      )`,
      [
        SHARED_PRODUCT_ID,
        credentialId,
        sharedListingAttempt.attempt_id,
        "b".repeat(64),
        JSON.stringify({
          arguments: {
            verificationOnly: true,
            publicationIntent: "safe_test",
            publicationStateContract: "verified_remote_state_v1",
            publicationExpectedLocale: "ja-JP",
            publicationExpectedFingerprint: "b".repeat(64),
            publicationExpectedImageCount: 8,
          },
        }),
      ],
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
    const firstTicketInboundKey = await scalar(
      db,
      "select latest_inbound_key from sellerpilot_private.support_tickets where id = $1",
      [firstTicketId],
    );
    await assert.rejects(
      scalar(db, "select public.sellerpilot_update_ticket($1, 'resolved', '답변 저장 검증', $2)", [firstTicketId, firstTicketInboundKey]),
      /REMOTE_REPLY_SUCCESS_REQUIRED/,
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
    assert.equal(jobs.rows.length, 9);
    assert.equal(jobs.rows.some((job) => (
      job.id === REVISION_FALLBACK_SPOOF_JOB_ID && job.status === "failed"
    )), true);
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
          set status = 'succeeded',
              result_payload = jsonb_build_object(
                'mode', 'asset-regeneration',
                'assetId', 'detail-use',
                'sourceJobId', $2::text,
                'asset_storage_paths', jsonb_build_object('detail-use', $3::text),
                'asset_storage_sha256s', jsonb_build_object(
                  'detail-use', encode(extensions.digest($3::text, 'sha256'), 'hex')
                )
              ),
              completed_at = now() - interval '31 days',
              updated_at = now() - interval '31 days'
        where id = $1`,
      [REGEN_JOB_ID, JOB_ID, protectedRegeneratedPath],
    );
    await db.query(
      `update sellerpilot_private.ai_cli_jobs
          set completed_at = now() - interval '31 days',
              updated_at = now() - interval '31 days'
        where id = $1`,
      [JOB_ID],
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
      "select public.sellerpilot_claim_local_ai_job($1, 'migration-test/legacy-retired')",
      "select public.sellerpilot_claim_product_ai_job($1, 'migration-test/legacy-retired')",
    ]) {
      await assert.rejects(db.query(claimSql, [TOKEN_HASH]), /invalid worker token/);
    }
    await db.query(
      `insert into sellerpilot_private.ai_cli_jobs (
         id, kind, request_payload, status, available_at, created_at, created_by
       ) values
         ($1, 'support_reply', '{}'::jsonb, 'queued', timestamp with time zone '2000-01-01', timestamp with time zone '2000-01-01', $3),
         ($2, 'product_studio', '{}'::jsonb, 'queued', timestamp with time zone '1999-01-01', timestamp with time zone '1999-01-01', $3)`,
      [LOCAL_NON_PRODUCT_CLAIM_JOB_ID, LOCAL_PRODUCT_FENCE_JOB_ID, ADMIN_ID],
    );
    const localNonProductClaim = await scalar(
      db,
      "select public.sellerpilot_claim_local_ai_job($1, 'migration-test/local-non-product')",
      [pendingProof.ai],
    );
    assert.equal(localNonProductClaim.id, LOCAL_NON_PRODUCT_CLAIM_JOB_ID);
    assert.equal(localNonProductClaim.kind, "support_reply");
    assert.equal(localNonProductClaim.claim_scope, "local_non_product");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.ai_cli_jobs where id = $1",
        [LOCAL_PRODUCT_FENCE_JOB_ID],
      ),
      "queued",
    );
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
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_claim_local_ai_job(text,text)', 'EXECUTE')",
      ),
      true,
    );

    const csInboundKey = `qoo10:${"9".repeat(64)}`;
    const csExternalTicketId = "qoo10:MSG:90001:1";
    const csInquiry = {
      externalTicketId: csExternalTicketId,
      customerName: "CS 원장 테스트 고객",
      subject: "CS 원장 연결 검증",
      message: "배송 상태를 확인해 주세요.",
      status: "waiting",
      providerStatus: "waiting",
      priority: 2,
      receivedAt: "2026-08-31T00:00:00.000Z",
      inboundKey: csInboundKey,
      remoteMessageId: "1",
      providerContext: { inquiryType: "MSG", questionNo: "90001", sequenceNo: "1" },
      replyContext: { inquiryType: "MSG", questionNo: "90001", sequenceNo: "1" },
      ticketKind: "conversation",
    };
    await setClaims(db, "service_role");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
        [replacementQoo10CredentialId, JSON.stringify([csInquiry])],
      ),
      1,
    );
    const csTicketId = await scalar(
      db,
      `select id from sellerpilot_private.support_tickets
        where owner_id = $1 and channel_key = 'qoo10' and external_ticket_id = $2`,
      [ADMIN_ID, csExternalTicketId],
    );
    assert.deepEqual(
      (await db.query(
        `select channel_account_id::text, provider_status, latest_inbound_key,
                provider_context->>'questionNo' as question_no
           from sellerpilot_private.support_tickets where id = $1`,
        [csTicketId],
      )).rows[0],
      {
        channel_account_id: replacementQoo10CredentialId,
        provider_status: "waiting",
        latest_inbound_key: csInboundKey,
        question_no: "90001",
      },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.support_inbound_messages where ticket_id = $1",
        [csTicketId],
      ),
      1,
    );

    await db.query(
      `update sellerpilot_private.support_tickets
          set status = 'in_progress', priority = 5, resolved_at = null
        where id = $1`,
      [csTicketId],
    );
    await setClaims(db, "service_role");
    await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [replacementQoo10CredentialId, JSON.stringify([{ ...csInquiry, priority: 1 }])],
    );
    assert.deepEqual(
      (await db.query(
        "select status, priority, resolved_at from sellerpilot_private.support_tickets where id = $1",
        [csTicketId],
      )).rows[0],
      { status: "in_progress", priority: 5, resolved_at: null },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.support_inbound_messages where ticket_id = $1",
        [csTicketId],
      ),
      1,
    );

    await db.query(
      `update sellerpilot_private.support_tickets
          set status = 'resolved', priority = 4, resolved_at = '2026-08-31T00:10:00.000Z'
        where id = $1`,
      [csTicketId],
    );
    await setClaims(db, "service_role");
    await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [replacementQoo10CredentialId, JSON.stringify([csInquiry])],
    );
    assert.deepEqual(
      (await db.query(
        "select status, priority, resolved_at::text from sellerpilot_private.support_tickets where id = $1",
        [csTicketId],
      )).rows[0],
      { status: "resolved", priority: 4, resolved_at: "2026-08-31 00:10:00+00" },
    );

    const csNewInboundKey = `qoo10:${"8".repeat(64)}`;
    await setClaims(db, "service_role");
    await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [replacementQoo10CredentialId, JSON.stringify([{
        ...csInquiry,
        message: "새 고객 메시지입니다.",
        receivedAt: "2026-08-31T00:11:00.000Z",
        inboundKey: csNewInboundKey,
        remoteMessageId: "2",
        priority: 1,
        providerContext: { inquiryType: "MSG", questionNo: "90001", sequenceNo: "1" },
        replyContext: { inquiryType: "MSG", questionNo: "90001", sequenceNo: "1" },
      }])],
    );
    assert.deepEqual(
      (await db.query(
        "select status, priority, resolved_at from sellerpilot_private.support_tickets where id = $1",
        [csTicketId],
      )).rows[0],
      { status: "waiting", priority: 4, resolved_at: null },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.support_inbound_messages where ticket_id = $1",
        [csTicketId],
      ),
      2,
    );

    const csReply = "배송 상태를 확인해 안내드리겠습니다.";
    const csReplyJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
        $1, 'qoo10', $2, $3::jsonb
      )`,
      [csTicketId, csReply, JSON.stringify({ sellerpilotExpectedInboundKey: csNewInboundKey, arguments: { params: {
        inq_type: "MSG", question_no: "90001", seq_no: "1", contents: csReply,
      } } })],
    );
    await setClaims(db);
    const csContext = await scalar(
      db,
      "select public.sellerpilot_get_ticket_reply_context_v2($1)",
      [csTicketId],
    );
    assert.equal(csContext.environment, "production");
    assert.equal(csContext.provider_context.questionNo, "90001");
    const queuedCsDelivery = await scalar(
      db,
      "select public.sellerpilot_get_inquiry_reply_delivery($1, $2)",
      [csTicketId, csReplyJobId],
    );
    assert.equal(queuedCsDelivery.status, "queued");
    assert.equal(queuedCsDelivery.ticketId, csTicketId);
    assert.equal(queuedCsDelivery.inboundKey, csNewInboundKey);
    const csWorkerTokenId = await scalar(
      db,
      `select id from sellerpilot_private.ai_cli_worker_tokens
        where scope = 'gateway' and status = 'active' order by created_at desc limit 1`,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'running', worker_token_id = $2,
              claim_token = '91919191-9191-4191-8191-919191919191',
              lease_expires_at = now() + interval '10 minutes', started_at = now()
        where id = $1`,
      [csReplyJobId, csWorkerTokenId],
    );
    const csThirdInboundKey = `qoo10:${"7".repeat(64)}`;
    await setClaims(db, "service_role");
    await scalar(
      db,
      "select public.sellerpilot_service_ingest_inquiries($1, 'qoo10', $2::jsonb)",
      [replacementQoo10CredentialId, JSON.stringify([{
        ...csInquiry,
        message: "답변 실행 중 도착한 최신 고객 메시지입니다.",
        receivedAt: "2026-08-31T00:12:00.000Z",
        inboundKey: csThirdInboundKey,
        remoteMessageId: "3",
      }])],
    );
    await setClaims(db);
    assert.equal((await scalar(db, "select public.sellerpilot_get_cs_workspace_snapshot()"))
      .tickets.find((ticket) => ticket.ticketId === csTicketId)?.delivery, null);
    await assert.rejects(
      scalar(db, `select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1, 'qoo10', $2, $3::jsonb)`, [
        csTicketId,
        "새 세대 답변",
        JSON.stringify({ sellerpilotExpectedInboundKey: csThirdInboundKey, arguments: { params: {
          inq_type: "MSG", question_no: "90001", seq_no: "1", contents: "새 세대 답변",
        } } }),
      ]),
      /INQUIRY_REPLY_RECONCILIATION_REQUIRED/,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"remoteId":"90001","safeMessage":"reply accepted"}'::jsonb,
              completed_at = now()
        where id = $1`,
      [csReplyJobId],
    );
    const succeededCsDelivery = await scalar(
      db,
      "select public.sellerpilot_get_inquiry_reply_delivery($1, $2)",
      [csTicketId, csReplyJobId],
    );
    assert.equal(succeededCsDelivery.status, "succeeded");
    assert.equal(succeededCsDelivery.inboundKey, csNewInboundKey);
    assert.deepEqual(
      (await db.query("select status, provider_status, latest_inbound_key, last_delivery_job_id from sellerpilot_private.support_tickets where id = $1", [csTicketId])).rows[0],
      { status: "waiting", provider_status: "waiting", latest_inbound_key: csThirdInboundKey, last_delivery_job_id: null },
    );
    const csReplyB = "최신 문의를 확인했습니다.";
    const csReplyJobB = await scalar(
      db,
      `select public.sellerpilot_enqueue_inquiry_reply_gateway_job($1, 'qoo10', $2, $3::jsonb)`,
      [csTicketId, csReplyB, JSON.stringify({ sellerpilotExpectedInboundKey: csThirdInboundKey, arguments: { params: {
        inq_type: "MSG", question_no: "90001", seq_no: "1", contents: csReplyB,
      } } })],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'running', worker_token_id = $2,
              claim_token = '92929292-9292-4292-8292-929292929292',
              lease_expires_at = now() + interval '10 minutes', started_at = now()
        where id = $1`,
      [csReplyJobB, csWorkerTokenId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded', response_payload = '{"ok":true,"remoteId":"90001-b"}'::jsonb,
              completed_at = now()
        where id = $1`,
      [csReplyJobB],
    );
    const csWorkspace = await scalar(db, "select public.sellerpilot_get_cs_workspace_snapshot()");
    assert.equal(
      csWorkspace.tickets.find((ticket) => ticket.ticketId === csTicketId)?.delivery?.status,
      "succeeded",
    );
    assert.equal(csWorkspace.tickets.find((ticket) => ticket.ticketId === csTicketId)?.delivery?.inboundKey, csThirdInboundKey);
    assert.deepEqual(
      (await db.query("select status, provider_status, latest_inbound_key from sellerpilot_private.support_tickets where id = $1", [csTicketId])).rows[0],
      { status: "resolved", provider_status: "answered", latest_inbound_key: csThirdInboundKey },
    );
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.support_reply_deliveries where ticket_id = $1", [csTicketId]), 2);

    await db.exec(withoutUnavailableExtensions(shopeeStaticEgressMigration));
    await db.exec(withoutUnavailableExtensions(smartstoreNonstaticEgressMigration));
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_serverless_static_egress_status()"),
      { coupang: false, elevenst: false, shopee: false, temu: false },
    );
    assert.match(
      await scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure)",
      ),
      /job\.channel not in \('coupang', 'smartstore', 'elevenst', 'temu', 'shopee'\)/i,
    );
    assert.match(
      await scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure)",
      ),
      /j\.channel = 'shopee'[\s\S]*serverless_gateway_job_allowed\([\s\S]*j\.channel in \('coupang', 'smartstore', 'elevenst', 'temu'\)/i,
    );
    assert.deepEqual(
      (await db.query(`
        select
          encode(extensions.digest(pg_get_functiondef(
            'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
          ),'sha256'),'hex') local_sha,
          encode(extensions.digest(pg_get_functiondef(
            'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
          ),'sha256'),'hex') serverless_sha
      `)).rows,
      [{
        local_sha: "e607d71cbb12ac1f987b721781ac1520fba1720447e7511aac744ff8d48f3f1f",
        serverless_sha: "ffbb9fa90c827171641f17a0ab5dde49ff6251c509a29b56d99da713433229e3",
      }],
      "delayed clean replay must converge to the observed production claim postimages",
    );
    const firstShopeeStaticEgressStatus = await scalar(
      db,
      "select public.sellerpilot_service_serverless_static_egress_status()",
    );
    await db.exec(withoutUnavailableExtensions(shopeeStaticEgressMigration));
    await db.exec(withoutUnavailableExtensions(smartstoreNonstaticEgressMigration));
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_serverless_static_egress_status()"),
      firstShopeeStaticEgressStatus,
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel = 'shopee'`,
    );
    await scalar(db, "select set_config('request.headers', '{}', false)");
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.serverless_static_egress_allowed('shopee')",
      ),
      false,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"shopee"}',
        false
      )`,
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.serverless_static_egress_allowed('shopee')",
      ),
      true,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'sellerpilot_private.serverless_static_egress_allowed(text)', 'EXECUTE')",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('authenticated', 'public.sellerpilot_service_serverless_static_egress_status()', 'EXECUTE')",
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_service_serverless_static_egress_status()', 'EXECUTE')",
      ),
      true,
    );

    // The exact Temu existing-item path may enqueue only after a certified
    // credential, approved 8-image manifest, and runtime static-egress proof.
    await setClaims(db);
    const temuAdoptionCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'temu', 'production',
        '{"app_key":"temu-adoption","app_secret":"secret","access_token":"token"}'::jsonb,
        now() + interval '30 days', 90, 30, 7
      )`,
    );
    const adoptionManifestDigest = "9".repeat(64);
    // This shared fixture intentionally replayed the older 301145 manifest
    // migration above. Restore the chronological 301210 v2 constraint before
    // exercising the later exact-adoption migration.
    await db.exec(`
      alter table sellerpilot_private.products
        drop constraint products_detail_page_approval_check;
      alter table sellerpilot_private.products
        add constraint products_detail_page_approval_check check (
          (detail_page_approved_version = 0 and detail_page_image_manifest is null)
          or (
            detail_page_data is not null
            and detail_page_version > 0
            and detail_page_approved_version = detail_page_version
            and jsonb_typeof(detail_page_image_manifest) = 'object'
            and detail_page_image_manifest->>'contract' in (
              'sellerpilot_detail_image_manifest_v1',
              'sellerpilot_detail_image_manifest_v2'
            )
            and detail_page_image_manifest->>'algorithm' = 'sha256'
            and detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
            and jsonb_typeof(detail_page_image_manifest->'images') = 'array'
            and jsonb_array_length(detail_page_image_manifest->'images') = 8
          )
        );
    `);
    await db.query(
      `insert into sellerpilot_private.products (
         id,owner_id,external_code,sku,name,description,status,on_hand,reserved,
         reorder_point,cost_krw,demo,detail_page_version,detail_page_data,
         detail_page_updated_at,detail_page_approved_version,
         detail_page_image_manifest
       ) values (
         'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,
         'TEMU-EXISTING-ACTIVE-QA','QA-20260823-CC-001',
         '테무 기존 활성 상품','테무 기존 활성 상품 결속 테스트','active',1,0,
         0,1000,false,1,'{}'::jsonb,clock_timestamp(),1,$2::jsonb
       )`,
      [ADMIN_ID, JSON.stringify({
        contract: "sellerpilot_detail_image_manifest_v2",
        algorithm: "sha256",
        digest: adoptionManifestDigest,
        images: Array.from({ length: 8 }, (_, index) => ({
          role: `detail-${index + 1}`,
          path: `results/temu-adoption/detail-${index + 1}.png`,
          sha256: String(index + 1).repeat(64).slice(0, 64),
        })),
      })],
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled=true,updated_at=clock_timestamp()
        where channel='temu'`,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers','{"x-sellerpilot-static-egress-channels":"temu"}',false
      )`,
    );
    await setClaims(db, "service_role");
    const credentialBeforeCertification = (await db.query(
      `select status,version,vault_secret_id,seller_account_key,
              seller_account_key_source
         from sellerpilot_private.channel_credentials
        where id=$1`,
      [temuAdoptionCredentialId],
    )).rows[0];
    assert.equal(credentialBeforeCertification.seller_account_key_source, "credential_incarnation_v1");
    const certificationQueued = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_temu_exact_credential_certification(
        'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,$2
      )`,
      [temuAdoptionCredentialId, ADMIN_ID],
    );
    assert.equal(certificationQueued.status, "queued");
    assert.equal(certificationQueued.credentialRotated, false);
    const adoptionWorkerTokenId = await scalar(
      db,
      "select id from sellerpilot_private.ai_cli_worker_tokens order by created_at,id limit 1",
    );
    assert.equal(typeof adoptionWorkerTokenId, "string");
    const providerMallId = "1024";
    const certifiedTemuSellerAccountKey = createHash("sha256")
      .update(`temu\u001fproduction\u001ftemu:mall:${providerMallId}`, "utf8")
      .digest("hex");
    const certificationObservedAt = new Date().toISOString();
    const certificationObservation = {
      contract: "temu_exact_credential_identity_observation_v1",
      verified: true,
      mallId: providerMallId,
      sellerSubject: `temu:mall:${providerMallId}`,
      sellerAccountKey: certifiedTemuSellerAccountKey,
      apiScopeDigest: "c".repeat(64),
      apiScopeCount: 2,
      observedAt: certificationObservedAt,
      digest: "d".repeat(64),
    };
    const certificationResponse = {
      ok: true,
      channel: "temu",
      operation: "listing.publication.verify",
      steps: [{
        name: "temu-credential-certification-account",
        ok: true,
        status: 200,
        data: {
          sellerpilotVerification: "TEMU_CREDENTIAL_PROVIDER_IDENTITY_VERIFIED",
          sellerpilotNoWriteConfirmed: true,
          sellerpilotNoSecretStored: true,
          sellerpilotTemuCredentialIdentity: certificationObservation,
        },
      }],
    };
    await db.exec("set session_replication_role = replica");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',attempt_count=1,worker_token_id=$2,
              claim_token='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              started_at=clock_timestamp()-interval '1 second',
              completed_at=clock_timestamp(),response_payload=$3::jsonb,
              updated_at=clock_timestamp()
        where id=$1`,
      [certificationQueued.jobId, adoptionWorkerTokenId, JSON.stringify(certificationResponse)],
    );
    await db.query(
      `insert into sellerpilot_private.gateway_completion_receipts (
         job_id,claim_token,worker_token_id,completion_fingerprint
       ) values (
         $1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$2,$3
       )`,
      [certificationQueued.jobId, adoptionWorkerTokenId, "e".repeat(64)],
    );
    await db.exec("set session_replication_role = origin");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs set status=status where id=$1`,
      [certificationQueued.jobId],
    );
    const certificationReady = await scalar(
      db,
      `select public.sellerpilot_service_temu_exact_credential_certification_status(
        'ddccde35-9c58-4856-b673-d7aa27ce4220',$1
      )`,
      [ADMIN_ID],
    );
    assert.equal(certificationReady.status, "ready");
    assert.match(certificationReady.observationDigest, /^[a-f0-9]{64}$/);
    assert.notEqual(certificationReady.observationDigest, certificationObservation.digest);
    const certificationCommitted = await scalar(
      db,
      `select public.sellerpilot_service_commit_temu_exact_credential_certification(
        'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,$2,$3
      )`,
      [certificationQueued.reviewId, certificationReady.observationDigest, ADMIN_ID],
    );
    assert.equal(certificationCommitted.status, "committed");
    assert.equal(certificationCommitted.providerWritePerformed, false);
    assert.equal(certificationCommitted.credentialRotated, false);
    assert.deepEqual(
      (await db.query(
        `select status,version,vault_secret_id,seller_account_key,
                seller_account_key_source
           from sellerpilot_private.channel_credentials
          where id=$1`,
        [temuAdoptionCredentialId],
      )).rows,
      [{
        status: credentialBeforeCertification.status,
        version: credentialBeforeCertification.version,
        vault_secret_id: credentialBeforeCertification.vault_secret_id,
        seller_account_key: certifiedTemuSellerAccountKey,
        seller_account_key_source: "provider_certified_v1",
      }],
    );
    const adoptionQueued = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_temu_exact_existing_adoption(
        'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,$2
      )`,
      [temuAdoptionCredentialId, ADMIN_ID],
    );
    assert.equal(adoptionQueued.status, "queued");
    assert.equal(adoptionQueued.reused, false);
    assert.equal(
      (await scalar(
        db,
        `select public.sellerpilot_service_enqueue_temu_exact_existing_adoption(
          'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,$2
        )`,
        [temuAdoptionCredentialId, ADMIN_ID],
      )).jobId,
      adoptionQueued.jobId,
    );
    assert.deepEqual(
      (await db.query(
        `select channel,operation,status,listing_id,attempt_id,
                request_payload#>'{arguments,sellerpilotReadOnly}' as read_only,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id=$1`,
        [adoptionQueued.jobId],
      )).rows,
      [{
        channel: "temu",
        operation: "listing.publication.verify",
        status: "queued",
        listing_id: null,
        attempt_id: null,
        read_only: true,
        provider_mutation_started_at: null,
      }],
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_commit_temu_exact_existing_adoption(
          'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,$2,$3
        )`,
        [adoptionQueued.reviewId, "a".repeat(64), ADMIN_ID],
      ),
      /FRESH_DIGEST_CONFIRMATION_REQUIRED/,
    );
    const adoptionObservedAt = new Date().toISOString();
    const adoptionObservation = {
      contract: "temu_exact_existing_active_observation_v1",
      verified: true,
      goodsId: "608570473054515",
      skuId: "123896921649274",
      externalGoodsId: "QA-TEMU-EXISTING-001",
      externalSkuId: "QA-TEMU-EXISTING-001-SKU",
      providerStatus: "statusName=ACTIVE",
      visibility: "live",
      locale: "ko-KR",
      currency: "KRW",
      price: "5000",
      stock: 1,
      goodsName: "케이블 정리 클립 테스트 상품",
      goodsDesc: "케이블을 깔끔하게 정리하는 한국어 상세 설명입니다.",
      bulletPoints: ["책상과 차량에서 사용할 수 있습니다."],
      representativeImages: ["https://assets.example.test/temu-adoption/hero.jpg"],
      detailImages: Array.from(
        { length: 8 },
        (_, index) => `https://assets.example.test/temu-adoption/detail-${index + 1}.jpg`,
      ),
      observedAt: adoptionObservedAt,
      digest: "a".repeat(64),
    };
    const adoptionResponse = {
      ok: true,
      channel: "temu",
      operation: "listing.publication.verify",
      remoteId: "608570473054515",
      steps: [
        { name: "temu-existing-adoption-detail", ok: true, status: 200, data: {} },
        { name: "temu-existing-adoption-status", ok: true, status: 200, data: {} },
        { name: "temu-existing-adoption-stock", ok: true, status: 200, data: {} },
        { name: "temu-existing-adoption-list", ok: true, status: 200, data: {} },
        {
          name: "temu-existing-adoption-observation",
          ok: true,
          status: 200,
          data: {
            sellerpilotVerification: "TEMU_EXISTING_ACTIVE_OBSERVATION_VERIFIED",
            sellerpilotNoWriteConfirmed: true,
            sellerpilotTemuExistingAdoptionObservation: adoptionObservation,
          },
        },
      ],
    };
    await db.exec("set session_replication_role = replica");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='succeeded',attempt_count=1,worker_token_id=$2,
              claim_token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              started_at=clock_timestamp()-interval '1 second',
              completed_at=clock_timestamp(),response_payload=$3::jsonb,
              updated_at=clock_timestamp()
        where id=$1`,
      [adoptionQueued.jobId, adoptionWorkerTokenId, JSON.stringify(adoptionResponse)],
    );
    await db.query(
      `insert into sellerpilot_private.gateway_completion_receipts (
         job_id,claim_token,worker_token_id,completion_fingerprint
       ) values (
         $1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$2,$3
       )`,
      [adoptionQueued.jobId, adoptionWorkerTokenId, "b".repeat(64)],
    );
    await db.exec("set session_replication_role = origin");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status=status
        where id=$1`,
      [adoptionQueued.jobId],
    );
    const adoptionReady = await scalar(
      db,
      `select public.sellerpilot_service_temu_exact_existing_adoption_status(
        'ddccde35-9c58-4856-b673-d7aa27ce4220',$1
      )`,
      [ADMIN_ID],
    );
    assert.equal(adoptionReady.status, "ready");
    assert.match(adoptionReady.observationDigest, /^[a-f0-9]{64}$/);
    assert.notEqual(adoptionReady.observationDigest, adoptionObservation.digest);
    const adoptionCommitted = await scalar(
      db,
      `select public.sellerpilot_service_commit_temu_exact_existing_adoption(
        'ddccde35-9c58-4856-b673-d7aa27ce4220',$1,$2,$3
      )`,
      [adoptionQueued.reviewId, adoptionReady.observationDigest, ADMIN_ID],
    );
    assert.equal(adoptionCommitted.status, "committed");
    assert.equal(adoptionCommitted.providerWritePerformed, false);
    assert.deepEqual(
      (await db.query(
        `select remote_id,marketplace_sku,status,currency,price::text,
                requested_publication_intent,remote_visibility,
                seller_account_key,
                remote_resources#>>'{verification,observationDigest}' as digest
           from sellerpilot_private.product_listings
          where id=$1`,
        [adoptionCommitted.listingId],
      )).rows,
      [{
        remote_id: "608570473054515",
        marketplace_sku: "QA-TEMU-EXISTING-001-SKU",
        status: "published",
        currency: "KRW",
        price: "5000.00",
        requested_publication_intent: "live",
        remote_visibility: "live",
        seller_account_key: certifiedTemuSellerAccountKey,
        digest: adoptionReady.observationDigest,
      }],
    );
  } finally {
    await db.close();
  }
});

test("Temu pending activation patches the exact production chain without 310540 history", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);
    await db.exec(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text primary key,
        statements text[] not null default '{}'::text[],
        name text
      );
    `);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql")
        && name <= TEMU_PUBLICATION_RELEASE_MIGRATION
        && name !== ELEVENST_SNAPSHOT_RECOVERY_MIGRATION)
      .sort();
    for (const name of migrationNames) {
      if (name === LEGACY_SCOPE_RETIREMENT_MIGRATION) continue;
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      let sql = name === "20260828210000_non_cs_release_integrity.sql"
        ? withoutFinalStrictWorkerScopeFence(source)
        : source;
      if (name === TEMU_PUBLICATION_RELEASE_MIGRATION) {
        assert.equal(
          await scalar(
            db,
            `select to_regprocedure(
              'public.sellerpilot_310540_listing_publication_verification_source(text,uuid,uuid)'
            )`,
          ),
          null,
        );
        assert.deepEqual(
          (await db.query(`
            select
              md5(pg_get_functiondef(
                'sellerpilot_private.register_pending_listing_publication_review(uuid)'::regprocedure
              )) register_md5,
              md5(pg_get_functiondef(to_regprocedure(
                'public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(text,uuid,uuid)'
              ))) source_md5,
              md5(pg_get_functiondef(
                'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'::regprocedure
              )) current_md5
          `)).rows,
          [{
            register_md5: "ebca2a9602ffc003a80f68eeed874c99",
            source_md5: "e3f30aa629b5a1a2bb4f46a3722ec115",
            current_md5: "4765c255abb7e84d7054c56b4cb1fc3d",
          }],
          "the production-gap replay must reach the observed rolled-back preimage",
        );
        const registrarPatch = sql.match(
          /do \$temu_pending_review_registrar\$[\s\S]*?\$temu_pending_review_registrar\$;/,
        )?.[0];
        assert.ok(registrarPatch);
        await db.exec(registrarPatch);
        assert.equal(
          await scalar(
            db,
            `select md5(pg_get_functiondef(
              'sellerpilot_private.register_pending_listing_publication_review(uuid)'::regprocedure
            ))`,
          ),
          "ffc6745ae02af71c199772a685746d37",
          "the earlier 133000 registrar statement must produce statement 63's exact preimage",
        );
      }
      await db.exec(withoutUnavailableExtensions(sql));
      if (!UNRECORDED_QOO10_SCHEMA_MIGRATIONS.has(name)) {
        const version = name.match(/^\d+/)?.[0];
        assert.ok(version);
        await db.query(
          `insert into supabase_migrations.schema_migrations (
             version, statements, name
           ) values ($1, '{}'::text[], $2)`,
          [version, name.replace(/^\d+_/, "").replace(/\.sql$/, "")],
        );
      }
    }
    assert.equal(
      await scalar(
        db,
        `select count(*) from supabase_migrations.schema_migrations
          where version in ('20260831054000','20260831133000')`,
      ),
      1,
      "133000 must apply without fabricating or repairing 310540 history",
    );
    assert.deepEqual(
      (await db.query(`
        select
          strpos(pg_get_functiondef(to_regprocedure(
            'public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(text,uuid,uuid)'
          )), '''listing.create'', ''listing.update'', ''listing.activate''') > 0
            source_patched,
          md5(pg_get_functiondef(
            'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'::regprocedure
          )) current_md5,
          strpos(pg_get_functiondef(
            'sellerpilot_private.register_pending_listing_publication_review(uuid)'::regprocedure
          ), '''listing.create'', ''listing.update'', ''listing.activate''') > 0
            registrar_patched
      `)).rows,
      [{
        source_patched: true,
        current_md5: "4765c255abb7e84d7054c56b4cb1fc3d",
        registrar_patched: true,
      }],
      "only the exact gap predecessor and private sources may be patched",
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
  const finalMigrationName = "20260828210000_non_cs_release_integrity.sql";
  const publicationReviewMigrationName = "20260830110000_pending_publication_reverification.sql";
  const publicationSourceMigrationName = "20260830121000_listing_publication_verification_source.sql";
  const lazadaSafeOauthMigrationName =
    "20260830183000_allow_fresh_lazada_oauth_past_safe_refresh_reconciliation.sql";
  const shopeeStaticEgressMigrationName =
    "20260830200000_require_static_egress_for_shopee.sql";
  const lazadaProviderMarkerMigrationName =
    "20260830203000_record_lazada_oauth_provider_call_boundary.sql";
  const lazadaOauthReauthorizationMigrationName =
    "20260830204000_allow_fresh_lazada_oauth_past_oauth_reconciliation.sql";
  const temuStaticEgressMigrationName =
    "20260831045000_gate_temu_periodic_inquiry_static_egress.sql";
  const qoo10ScopedReleaseGateMigrationName =
    "20260831050000_channel_scoped_qoo10_publication_gate.sql";
  const qoo10ScopedProviderChainMigrationName =
    "20260831053500_rebind_qoo10_scoped_provider_mutation_chain.sql";
  const elevenstSnapshotRecoveryMigrationName =
    "20260831054000_recover_elevenst_listing_snapshot.sql";
  const serverlessHash = "6".repeat(64);
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql")
        && name !== migrationName
        && name !== cleanupMigrationName
        && name !== finalMigrationName
        && name !== publicationReviewMigrationName
        && name !== publicationSourceMigrationName
        && name !== lazadaSafeOauthMigrationName
        && name !== shopeeStaticEgressMigrationName
        && name !== lazadaProviderMarkerMigrationName
        && name !== lazadaOauthReauthorizationMigrationName
        && name !== temuStaticEgressMigrationName
        && name !== qoo10ScopedReleaseGateMigrationName
        && name !== qoo10ScopedProviderChainMigrationName
        && name !== QOO10_ADULTYN_RETRY_IDENTITY_MIGRATION
        && name !== QOO10_EXACT_PREPROVIDER_RESUME_MIGRATION
        && name !== QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION
        && name !== QOO10_EXACT_S1_ACTIVATION_MIGRATION
        && name !== QOO10_EXACT_S1_VERIFIER_OVERLAP_MIGRATION
        && name !== QOO10_EXACT_HEADING_NORMALIZATION_MIGRATION
        && name !== QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION
        && name !== QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION
        && name !== QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION
        && name !== QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION
        && name !== TEMU_PUBLICATION_RELEASE_MIGRATION
        && name !== QOO10_EXACT_LOCALIZATION_V2_MIGRATION
        && name !== QOO10_EXACT_CLOSED_GATE_REACHABILITY_MIGRATION
        && name !== SMARTSTORE_EXACT_CLOSED_GATE_PERMIT_MIGRATION
        && name !== SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION
        && name !== EXACT_EXISTING_CLOSED_GATE_PERMIT_MIGRATION
        && name !== QOO10_RELEASE_STATUS_RECORD_INITIALIZATION_MIGRATION
        && name !== EBAY_CURRENT_CREDENTIAL_FENCE_MIGRATION
        && name !== QOO10_NO_REMOTE_EFFECT_RECONCILIATION_MIGRATION
        && name !== QOO10_NO_EFFECT_LEGACY_PAYLOAD_MIGRATION
        && name !== QOO10_PARTIAL_MANUAL_RECONCILIATION_MIGRATION
        && name !== SMARTSTORE_STATIC_EGRESS_RESTORATION_MIGRATION
        && name !== COMPETITOR_IDENTITY_LINEAGE_MIGRATION
        && name !== SMARTSTORE_NONSTATIC_EGRESS_MIGRATION
        && name !== TEMU_EXACT_CABLE_MIGRATION
        && name !== COUPANG_UNCLAIMED_STATIC_EGRESS_RECONCILIATION_MIGRATION
        && name !== EBAY_SERVERLESS_LISTING_UPDATE_MIGRATION
        && name !== EBAY_DETERMINISTIC_NO_EFFECT_RETRY_MIGRATION
        && name !== EBAY_NO_EFFECT_TERMINAL_PROOF_CORRECTION_MIGRATION
        && name !== EBAY_EXACT_PRE_GATEWAY_RETRY_MIGRATION
        && name !== EBAY_EXACT_CREDENTIAL_ROTATION_MIGRATION
        && name !== TEMU_EXACT_EXISTING_ACTIVE_ADOPTION_MIGRATION
        && name !== TEMU_EXACT_CREDENTIAL_CERTIFICATION_MIGRATION
        && name !== QOO10_ALREADY_LIVE_ADOPTION_MIGRATION
        && name !== QOO10_ADOPTED_LOCALIZATION_UPDATE_MIGRATION
        && name !== QOO10_ADOPTION_CREDENTIAL_LINEAGE_FIX_MIGRATION
        && name !== elevenstSnapshotRecoveryMigrationName)
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
          providerStatus: "waiting",
          priority: 2,
          receivedAt: "2026-08-28T00:00:00.000Z",
          remoteMessageId: "987654321",
          inboundKey: `coupang:${"7".repeat(64)}`,
          providerContext: { kind: "product", inquiryId: "987654321" },
          replyContext: { kind: "product", inquiryId: "987654321" },
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
        sellerpilotExpectedInboundKey: `coupang:${"7".repeat(64)}`,
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

    await db.exec(withoutUnavailableExtensions(
      await readFile(new URL(finalMigrationName, migrationUrl), "utf8"),
    ));
    await db.exec(withoutUnavailableExtensions(
      await readFile(new URL(temuStaticEgressMigrationName, migrationUrl), "utf8"),
    ));

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
      { coupang: false, elevenst: false, smartstore: false, temu: false },
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
      if (
        name === QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION
        || name === QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION
      ) continue;
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

test("competitor provider-state migration persists terminal truth behind the completion claim fence", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260828210000_non_cs_release_integrity.sql", import.meta.url),
    "utf8",
  );
  const validator = migration.slice(
    migration.indexOf("create or replace function sellerpilot_private.valid_competitor_provider_snapshot"),
    migration.indexOf("revoke all on function sellerpilot_private.valid_competitor_provider_snapshot"),
  );
  const completion = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_service_complete_competitor_price_refresh"),
    migration.indexOf("revoke all on function public.sellerpilot_service_complete_competitor_price_refresh"),
  );
  const getter = migration.slice(
    migration.indexOf("create or replace function public.sellerpilot_get_product_operations_v2"),
    migration.indexOf("revoke all on function public.sellerpilot_get_product_operations_v2(uuid)"),
  );

  assert.match(migration, /add column latest_providers jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /add column providers_fetched_at timestamptz/);
  assert.match(migration, /competitor_price_refresh_claims_provider_snapshot_check/);
  assert.match(validator, /'searched', 'unavailable', 'failed'/);
  assert.doesNotMatch(validator, /and exists \(/);
  assert.match(validator, /provider\.value->>'status' in \('unavailable', 'failed'\)[\s\S]*count/);
  assert.match(validator, /provider\.value->'marketplaces'[\s\S]*'brave_marketplace_web'/);
  assert.match(completion, /not sellerpilot_private\.valid_competitor_provider_snapshot\(p_providers\)/);
  assert.match(completion, /latest_providers = p_providers,[\s\S]*providers_fetched_at = clock_timestamp\(\)[\s\S]*c\.claim_token = p_claim_token/);
  assert.match(getter, /'competitorProviders', coalesce\(v_providers, '\[\]'::jsonb\)/);
  assert.match(getter, /'competitorProvidersFetchedAt', v_providers_fetched_at/);
  assert.match(getter, /'provider', observation\.provider/);
  assert.match(getter, /'preserved', case[\s\S]*observation\.provider = 'manual' then false[\s\S]*provider\.value->>'status' = 'searched'/);
  assert.match(getter, /jsonb_set\(v_result, '\{competitorPrices\}', v_prices, true\)/);
  assert.match(migration, /revoke all on sellerpilot_private\.competitor_price_refresh_claims[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\.sellerpilot_service_complete_competitor_price_refresh[\s\S]*grant execute[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.sellerpilot_get_product_operations_v2\(uuid\)[\s\S]*grant execute[\s\S]*to authenticated/);
});

test("bounded serverless gateway claims Vault OAuth and fixed-egress writes with exact fences", async () => {
  const db = new PGlite();
  const serverlessHash = "4".repeat(64);
  const genericGatewayHash = "5".repeat(64);
  const authorizationCode = "serverless-oauth-code-never-stored-in-job-json";
  const legacyEbayDiagnosticMigrationName =
    "20260830052516_allow_legacy_ebay_diagnostic_attestation.sql";
  const providerIdentityCertificationMigrationName =
    "20260830054851_certify_provider_identity_on_service_refresh.sql";
  const shopeeIdentityMigrationName =
    "20260830141500_unblock_shopee_identity_reauthorization.sql";
  const lazadaSafeOauthMigrationName =
    "20260830183000_allow_fresh_lazada_oauth_past_safe_refresh_reconciliation.sql";
  const shopeeStaticEgressMigrationName =
    "20260830200000_require_static_egress_for_shopee.sql";
  const lazadaProviderMarkerMigrationName =
    "20260830203000_record_lazada_oauth_provider_call_boundary.sql";
  const lazadaOauthReauthorizationMigrationName =
    "20260830204000_allow_fresh_lazada_oauth_past_oauth_reconciliation.sql";
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    let legacyEbayDiagnosticMigration;
    let providerIdentityCertificationMigration;
    let shopeeIdentityMigration;
    let lazadaSafeOauthMigration;
    let shopeeStaticEgressMigration;
    let smartstoreNonstaticEgressMigration;
    let lazadaProviderMarkerMigration;
    let lazadaOauthReauthorizationMigration;
    let qoo10StaleVerifierRetirementMigration;
    for (const name of migrationNames) {
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      if (name === SMARTSTORE_NONSTATIC_EGRESS_MIGRATION) {
        smartstoreNonstaticEgressMigration = source;
      }
      if (name === legacyEbayDiagnosticMigrationName) {
        legacyEbayDiagnosticMigration = source;
      } else if (name === providerIdentityCertificationMigrationName) {
        providerIdentityCertificationMigration = source;
      } else if (name === shopeeIdentityMigrationName) {
        shopeeIdentityMigration = source;
      } else if (name === lazadaSafeOauthMigrationName) {
        lazadaSafeOauthMigration = source;
      } else if (name === shopeeStaticEgressMigrationName) {
        shopeeStaticEgressMigration = source;
      } else if (name === lazadaProviderMarkerMigrationName) {
        lazadaProviderMarkerMigration = source;
      } else if (name === lazadaOauthReauthorizationMigrationName) {
        lazadaOauthReauthorizationMigration = source;
      } else if (name === QOO10_STALE_VERIFIER_RETIREMENT_MIGRATION) {
        qoo10StaleVerifierRetirementMigration = source;
      } else if (
        name === QOO10_EXACT_S1_CLAIM_PRIORITY_MIGRATION
        || name === QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION
        || name === QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION
        || name === TEMU_PUBLICATION_RELEASE_MIGRATION
        || name === QOO10_EXACT_LOCALIZATION_V2_MIGRATION
        || name === QOO10_EXACT_CLOSED_GATE_REACHABILITY_MIGRATION
        || name === SMARTSTORE_EXACT_CLOSED_GATE_PERMIT_MIGRATION
        || name === SMARTSTORE_REPRESENTATIVE_FILENAME_MIGRATION
        || name === EXACT_EXISTING_CLOSED_GATE_PERMIT_MIGRATION
        || name === QOO10_RELEASE_STATUS_RECORD_INITIALIZATION_MIGRATION
        || name === EBAY_CURRENT_CREDENTIAL_FENCE_MIGRATION
        || name === COUPANG_EXACT_PRE_GATEWAY_RECONCILIATION_MIGRATION
        || name === QOO10_NO_REMOTE_EFFECT_RECONCILIATION_MIGRATION
        || name === QOO10_NO_EFFECT_LEGACY_PAYLOAD_MIGRATION
        || name === QOO10_PARTIAL_MANUAL_RECONCILIATION_MIGRATION
        || name === TEMU_EXACT_CABLE_MIGRATION
        || name === COUPANG_UNCLAIMED_STATIC_EGRESS_RECONCILIATION_MIGRATION
        || name === EBAY_SERVERLESS_LISTING_UPDATE_MIGRATION
        || name === EBAY_DETERMINISTIC_NO_EFFECT_RETRY_MIGRATION
        || name === EBAY_NO_EFFECT_TERMINAL_PROOF_CORRECTION_MIGRATION
        || name === EBAY_EXACT_PRE_GATEWAY_RETRY_MIGRATION
        || name === EBAY_EXACT_CREDENTIAL_ROTATION_MIGRATION
        || name === TEMU_EXACT_EXISTING_ACTIVE_ADOPTION_MIGRATION
        || name === TEMU_EXACT_CREDENTIAL_CERTIFICATION_MIGRATION
        || name === QOO10_ALREADY_LIVE_ADOPTION_MIGRATION
        || name === QOO10_ADOPTED_LOCALIZATION_UPDATE_MIGRATION
        || name === QOO10_ADOPTION_CREDENTIAL_LINEAGE_FIX_MIGRATION
      ) {
        // This fixture deliberately applies the 204000 Lazada wrapper after
        // the exact-S1 recovery migration, unlike chronological production.
        // The 571/572 exact-chain, later Temu release, and exact no-effect
        // migrations are covered by the chronological full replay and must not
        // bless this synthetic wrapper or stale-verifier postimage before 57000
        // is applied below.
      } else {
        await db.exec(withoutUnavailableExtensions(source));
      }
    }
    assert.equal(typeof legacyEbayDiagnosticMigration, "string");
    assert.equal(typeof providerIdentityCertificationMigration, "string");
    assert.equal(typeof shopeeIdentityMigration, "string");
    assert.equal(typeof lazadaSafeOauthMigration, "string");
    assert.equal(typeof shopeeStaticEgressMigration, "string");
    assert.equal(typeof smartstoreNonstaticEgressMigration, "string");
    assert.equal(typeof lazadaProviderMarkerMigration, "string");
    assert.equal(typeof lazadaOauthReauthorizationMigration, "string");
    assert.equal(typeof qoo10StaleVerifierRetirementMigration, "string");
    await attestPublicationRelease(db, PUBLICATION_RELEASE_SHA, [
      "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay",
    ]);
    await activatePublicationRuntimeRelease(db);
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      )).open,
      true,
      "this provider-mutation fixture must explicitly open the release gate",
    );

    await db.query(
      "insert into auth.users (id, email) values ($1, 'serverless-gateway@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Serverless Gateway Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    let ebayCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'ebay', 'production',
        '{"client_id":"serverless-client","client_secret":"serverless-secret","ru_name":"serverless-redirect","access_token":"old-access","refresh_token":"old-refresh"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const temuCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'temu', 'production',
        '{"app_key":"temu-app","app_secret":"temu-secret","access_token":"temu-access"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const smartstoreCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'smartstore', 'production',
        '{"client_id":"smartstore-client","client_secret":"smartstore-secret"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const legacyShopeeCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production',
        '{"partner_id":"2031489","partner_key":"serverless-partner-secret","main_account_id":"4940266","shop_id":"1719148844","merchant_id":"5511564","access_token":"legacy-shop-access","refresh_token":"legacy-shop-refresh"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );

    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
       id, credential_id, channel, operation, environment, status,
         request_payload, created_by, attempt_count,
         oauth_request_fingerprint, oauth_source_credential_id,
         credential_refresh_in_flight, credential_refresh_started_at,
         completed_at, error_message, created_at, updated_at
       ) values (
         'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid,
         $1, 'shopee', 'oauth.exchange', 'production',
         'reconciliation_required', '{}'::jsonb, $2, 1,
         repeat('e', 64), $1, true,
         clock_timestamp() - interval '4 days',
         clock_timestamp() - interval '4 days',
         '채널 인증 갱신 즉시 보존 실패 · HTTP 400',
         clock_timestamp() - interval '4 days',
         clock_timestamp() - interval '4 days'
       )`,
      [legacyShopeeCredentialId, ADMIN_ID],
    );
    const legacyShopeeDiagnosticId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by, created_at
       ) values (
         $1, 'shopee', 'diagnostic.test', 'production', '{}'::jsonb, $2,
         clock_timestamp() + interval '1 minute'
       ) returning id`,
      [legacyShopeeCredentialId, ADMIN_ID],
    );
    const blockedLegacyShopeeCategoryId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by, created_at
       ) values (
         $1, 'shopee', 'categories.suggest', 'production',
         '{"arguments":{"globalProduct":true,"language":"en","query":{"item_name":"Cable clips"}}}'::jsonb,
         $2, clock_timestamp() + interval '2 minutes'
       ) returning id`,
      [legacyShopeeCredentialId, ADMIN_ID],
    );
    const blockedLegacyOrdersId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by, created_at
       ) values (
         $1, 'ebay', 'orders.list', 'production',
         '{"arguments":{"fromDate":"2026-08-27","toDate":"2026-08-28"}}'::jsonb,
         $2, clock_timestamp() - interval '3 minutes'
       ) returning id`,
      [ebayCredentialId, ADMIN_ID],
    );
    const legacyDiagnosticRows = (await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by, created_at
       ) values
         ($1, 'ebay', 'diagnostic.test', 'production', '{}'::jsonb, $2,
          clock_timestamp() - interval '2 minutes'),
         ($1, 'ebay', 'diagnostic.test', 'production', '{}'::jsonb, $2,
          clock_timestamp() - interval '1 minute')
       returning id, created_at`,
      [ebayCredentialId, ADMIN_ID],
    )).rows.sort((left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
    const olderLegacyDiagnosticId = legacyDiagnosticRows[0].id;
    const newestLegacyDiagnosticId = legacyDiagnosticRows[1].id;
    assert.deepEqual(
      (await db.query(
        `select seller_account_key, seller_account_key_source,
                seller_account_verified_at
           from sellerpilot_private.channel_credentials
          where id = $1`,
        [ebayCredentialId],
      )).rows,
      [{
        seller_account_key: null,
        seller_account_key_source: "legacy_unattested",
        seller_account_verified_at: null,
      }],
    );

    await db.exec(withoutUnavailableExtensions(legacyEbayDiagnosticMigration));
    assert.deepEqual(
      (await db.query(
        `select id::text, status, error_message
           from sellerpilot_private.channel_gateway_jobs
          where id = any($1::uuid[])
          order by created_at`,
        [[olderLegacyDiagnosticId, newestLegacyDiagnosticId]],
      )).rows,
      [
        {
          id: olderLegacyDiagnosticId,
          status: "cancelled",
          error_message: "Superseded by a newer queued eBay identity diagnostic.",
        },
        { id: newestLegacyDiagnosticId, status: "queued", error_message: null },
      ],
    );
    await db.exec(withoutUnavailableExtensions(shopeeIdentityMigration));
    assert.deepEqual(
      (await db.query(
        `select status, credential_refresh_in_flight,
                credential_refresh_started_at is null as refresh_start_cleared,
                prepared_credential_id is null as prepared_clear,
                credential_refresh_recovery_vault_id is null as recovery_clear,
                oauth_exchange_completed,
                provider_mutation_started_at is null as provider_mutation_clear,
                error_message
           from sellerpilot_private.channel_gateway_jobs
          where id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid`,
      )).rows,
      [{
        status: "cancelled",
        credential_refresh_in_flight: false,
        refresh_start_cleared: true,
        prepared_clear: true,
        recovery_clear: true,
        oauth_exchange_completed: false,
        provider_mutation_clear: true,
        error_message: "Cancelled after exact evidence confirmed no provider or credential mutation.",
      }],
    );

    await db.exec(withoutUnavailableExtensions(shopeeIdentityMigration));
    assert.deepEqual(
      (await db.query(
        `select status, credential_refresh_in_flight,
                credential_refresh_started_at is null as refresh_start_cleared,
                completed_at is not null as completed,
                error_message
           from sellerpilot_private.channel_gateway_jobs
          where id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid`,
      )).rows,
      [{
        status: "cancelled",
        credential_refresh_in_flight: false,
        refresh_start_cleared: true,
        completed: true,
        error_message: "Cancelled after exact evidence confirmed no provider or credential mutation.",
      }],
      "the exact cancelled shape must make a second migration execution a no-op",
    );
    await db.exec(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message = null
        where id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid`,
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(shopeeIdentityMigration)),
      /no longer matches exact cancelled evidence/,
      "a replay must reject an inexact cancelled shape",
    );
    await db.exec("rollback");
    await db.exec(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message =
            'Cancelled after exact evidence confirmed no provider or credential mutation.'
        where id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid`,
    );

    const resetObservedShopeeOauthBlocker = async () => {
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status = 'reconciliation_required',
                credential_refresh_in_flight = true,
                credential_refresh_started_at = clock_timestamp() - interval '4 days',
                credential_refresh_fingerprint = null,
                prepared_credential_id = null,
                credential_refresh_prepared_at = null,
                credential_refresh_recovery_vault_id = null,
                credential_refresh_recovery_fingerprint = null,
                credential_refresh_recovery_staged_at = null,
                oauth_request_vault_id = null,
                oauth_request_fingerprint = repeat('e', 64),
                oauth_source_credential_id = credential_id,
                oauth_exchange_completed = false,
                provider_mutation_started_at = null,
                worker_token_id = null,
                claim_token = null,
                lease_expires_at = null,
                error_message = '채널 인증 갱신 즉시 보존 실패 · HTTP 400'
          where id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid`,
      );
    };
    await db.exec(
      `alter table sellerpilot_private.channel_gateway_jobs
         drop constraint channel_gateway_jobs_oauth_request_state_check`,
    );
    for (const nullableGuardColumn of [
      "oauth_request_fingerprint",
      "oauth_source_credential_id",
      "error_message",
    ]) {
      await resetObservedShopeeOauthBlocker();
      await db.exec(
        `update sellerpilot_private.channel_gateway_jobs
            set ${nullableGuardColumn} = null
          where id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid`,
      );
      await assert.rejects(
        db.exec(withoutUnavailableExtensions(shopeeIdentityMigration)),
        /no longer matches exact no-mutation evidence/,
        `${nullableGuardColumn}=NULL must never bypass the bounded cleanup guard`,
      );
      await db.exec("rollback");
    }
    await resetObservedShopeeOauthBlocker();
    await db.exec(withoutUnavailableExtensions(shopeeIdentityMigration));
    await db.exec(
      `alter table sellerpilot_private.channel_gateway_jobs
         add constraint channel_gateway_jobs_oauth_request_state_check check (
           (
             operation <> 'oauth.exchange'
             and oauth_request_vault_id is null
             and oauth_request_fingerprint is null
             and oauth_source_credential_id is null
           ) or (
             operation = 'oauth.exchange'
             and oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
             and oauth_source_credential_id is not null
             and (
               status not in ('queued', 'running')
               or oauth_request_vault_id is not null
             )
           )
         ) not valid;
       alter table sellerpilot_private.channel_gateway_jobs
         validate constraint channel_gateway_jobs_oauth_request_state_check;`,
    );

    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values
         ('bounded serverless gateway', $1, '444444444444', 'active',
          'serverless_cs', clock_timestamp() + interval '1 day', $3),
         ('generic fallback probe', $2, '555555555555', 'active',
          'gateway', clock_timestamp() + interval '1 day', $3)`,
      [serverlessHash, genericGatewayHash, ADMIN_ID],
    );
    await setClaims(db, "service_role");

    const diagnosticClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/legacy-ebay-diagnostic')",
      [serverlessHash],
    );
    assert.equal(diagnosticClaim.id, newestLegacyDiagnosticId);
    assert.equal(diagnosticClaim.channel, "ebay");
    assert.equal(diagnosticClaim.operation, "diagnostic.test");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [blockedLegacyOrdersId],
      ),
      "queued",
      "non-diagnostic eBay work must remain fenced before provider attestation",
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
          $1, $2, $3
        )`,
        [serverlessHash, newestLegacyDiagnosticId, diagnosticClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_begin_serverless_cs_credential_refresh(
          $1, $2, $3
        )`,
        [serverlessHash, newestLegacyDiagnosticId, diagnosticClaim.claim_token],
      ),
      true,
    );
    const stableEbayProviderSubject = "ebay:eias:serverless-diagnostic-owner";
    const diagnosticCredentialPayload = {
      client_id: "serverless-client",
      client_secret: "serverless-secret",
      ru_name: "serverless-redirect",
      access_token: "diagnostic-refreshed-access-token",
      refresh_token: "diagnostic-refreshed-refresh-token",
      provider_account_identity_version: "v1",
      provider_account_subject: stableEbayProviderSubject,
    };
    const diagnosticExpiresAt = "2099-01-01T00:00:00.000Z";
    // Opaque sb_secret_* requests run as the service_role database role but
    // do not populate this legacy JWT GUC. Keep this exact production shape
    // so provider identity certification cannot regress to legacy_unattested.
    await db.query("select set_config('request.jwt.claim.role', '', false)");
    const diagnosticCompletion = await scalar(
      db,
      `select public.sellerpilot_service_complete_serverless_cs_transaction(
        $1, $2, $3, 'succeeded', $4::jsonb, null, $5::jsonb,
        null, null, $6::jsonb
      )`,
      [
        serverlessHash,
        newestLegacyDiagnosticId,
        diagnosticClaim.claim_token,
        JSON.stringify({
          ok: true,
          channel: "ebay",
          operation: "diagnostic.test",
          steps: [],
          safeMessage: "Synthetic eBay provider identity diagnostic passed",
        }),
        JSON.stringify({
          payload: diagnosticCredentialPayload,
          expiresAt: diagnosticExpiresAt,
          recoveryOnly: false,
          oauthComplete: false,
        }),
        JSON.stringify({
          status: "passed",
          message: "Synthetic stable EIASToken attestation",
        }),
      ],
    );
    assert.equal(diagnosticCompletion.status, "completed");
    assert.notEqual(diagnosticCompletion.credentialId, ebayCredentialId);
    assert.deepEqual(
      (await db.query(
        `select credential.seller_account_key,
                credential.seller_account_key_source,
                credential.seller_account_verified_at,
                secret.decrypted_secret::jsonb->>'provider_account_identity_version' as identity_version,
                length(secret.decrypted_secret::jsonb->>'provider_account_subject') > 10 as has_provider_subject
           from sellerpilot_private.channel_credentials credential
           join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
          where credential.id = $1`,
        [diagnosticCompletion.credentialId],
      )).rows,
      [{
        seller_account_key: null,
        seller_account_key_source: "legacy_unattested",
        seller_account_verified_at: null,
        identity_version: "v1",
        has_provider_subject: true,
      }],
      "the pre-fix production shape must be reproduced before exact repair",
    );
    await db.exec(withoutUnavailableExtensions(providerIdentityCertificationMigration));
    await db.exec(withoutUnavailableExtensions(lazadaSafeOauthMigration));
    const diagnosticCredential = (await db.query(
      `select id::text, status, seller_account_key,
              seller_account_key_source,
              seller_account_verified_at is not null as seller_account_verified,
              last_check_status
         from sellerpilot_private.channel_credentials
        where id = $1`,
      [diagnosticCompletion.credentialId],
    )).rows[0];
    assert.equal(diagnosticCredential.status, "active");
    assert.match(diagnosticCredential.seller_account_key, /^[a-f0-9]{64}$/);
    assert.equal(
      diagnosticCredential.seller_account_key_source,
      "provider_certified_v1",
    );
    assert.equal(diagnosticCredential.seller_account_verified, true);
    assert.equal(diagnosticCredential.last_check_status, "passed");
    assert.deepEqual(
      (await db.query(
        `select secret.decrypted_secret::jsonb->>'provider_account_identity_version' as identity_version,
                length(secret.decrypted_secret::jsonb->>'provider_account_subject') > 10 as has_provider_subject
           from sellerpilot_private.channel_credentials credential
           join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
          where credential.id = $1`,
        [diagnosticCompletion.credentialId],
      )).rows,
      [{ identity_version: "v1", has_provider_subject: true }],
    );
    assert.deepEqual(
      (await db.query(
        `select status, credential_id::text
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [newestLegacyDiagnosticId],
      )).rows,
      [{ status: "succeeded", credential_id: diagnosticCompletion.credentialId }],
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_credentials where id = $1",
        [ebayCredentialId],
      ),
      "revoked",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', completed_at = clock_timestamp(),
              error_message = 'Synthetic pre-attestation fence probe completed.',
              updated_at = clock_timestamp()
        where id = $1 and status = 'queued'`,
      [blockedLegacyOrdersId],
    );
    ebayCredentialId = diagnosticCompletion.credentialId;

    const shopeeDiagnosticClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/legacy-shopee-diagnostic')",
      [serverlessHash],
    );
    assert.equal(shopeeDiagnosticClaim.id, legacyShopeeDiagnosticId);
    assert.equal(shopeeDiagnosticClaim.channel, "shopee");
    assert.equal(shopeeDiagnosticClaim.operation, "diagnostic.test");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [blockedLegacyShopeeCategoryId],
      ),
      "queued",
      "legacy Shopee category work must remain fenced before provider identity attestation",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', worker_token_id = null, claim_token = null,
              lease_expires_at = null, completed_at = clock_timestamp(),
              error_message = 'Synthetic Shopee identity diagnostic claim probe completed.',
              updated_at = clock_timestamp()
        where id = $1 and status = 'running'`,
      [legacyShopeeDiagnosticId],
    );

    const oauthJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'ebay', 'oauth.exchange', jsonb_build_object('code', $2::text)
      )`,
      [ebayCredentialId, authorizationCode],
    );
    assert.deepEqual(
      (await db.query(
        `select request_payload ? 'code' as plaintext_code_stored,
                request_payload = '{"vaultBacked":true}'::jsonb as vault_marker_only,
                oauth_request_vault_id is not null as vault_reference
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [oauthJobId],
      )).rows,
      [{ plaintext_code_stored: false, vault_marker_only: true, vault_reference: true }],
    );
    const oauthClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/serverless-gateway')",
      [serverlessHash],
    );
    assert.equal(oauthClaim.id, oauthJobId);
    assert.equal(oauthClaim.channel, "ebay");
    assert.equal(oauthClaim.operation, "oauth.exchange");
    assert.equal(oauthClaim.request.code, authorizationCode);
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
        `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
          $1, $2, $3
        )`,
        [serverlessHash, oauthJobId, oauthClaim.claim_token],
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_begin_serverless_cs_credential_refresh(
          $1, $2, $3
        )`,
        [serverlessHash, oauthJobId, oauthClaim.claim_token],
      ),
      true,
    );
    const oauthCredentialPayload = {
      client_id: "serverless-client",
      client_secret: "serverless-secret",
      ru_name: "serverless-redirect",
      access_token: "serverless-new-access-token",
      refresh_token: "serverless-new-refresh-token",
      provider_account_identity_version: "v1",
      provider_account_subject: stableEbayProviderSubject,
    };
    const oauthCredentialRefresh = {
      payload: oauthCredentialPayload,
      expiresAt: "2099-01-01T00:00:00.000Z",
      recoveryOnly: false,
      oauthComplete: true,
    };
    const oauthPrepared = await scalar(
      db,
      `select public.sellerpilot_service_prepare_serverless_cs_credential_refresh(
        $1, $2, $3, $4::jsonb, $5::timestamptz, false, true
      )`,
      [
        serverlessHash,
        oauthJobId,
        oauthClaim.claim_token,
        JSON.stringify(oauthCredentialPayload),
        oauthCredentialRefresh.expiresAt,
      ],
    );
    assert.equal(oauthPrepared.status, "prepared");
    assert.equal(oauthPrepared.oauth_complete, true);

    const unsafeOAuthResponse = {
      ok: true,
      channel: "ebay",
      operation: "oauth.exchange",
      credentialPayload: oauthCredentialPayload,
      nestedProviderResponse: {
        refresh_token: "nested-refresh-token-must-not-persist",
      },
      expiresAt: oauthCredentialRefresh.expiresAt,
      safeMessage: "eBay OAuth 교환 완료",
    };
    const oauthCompletionArguments = [
      serverlessHash,
      oauthJobId,
      oauthClaim.claim_token,
      JSON.stringify(unsafeOAuthResponse),
      JSON.stringify(oauthCredentialRefresh),
    ];
    const oauthCompletion = await scalar(
      db,
      `select public.sellerpilot_service_complete_serverless_cs_transaction(
        $1, $2, $3, 'succeeded', $4::jsonb, null, $5::jsonb,
        null, null, null
      )`,
      oauthCompletionArguments,
    );
    assert.equal(oauthCompletion.status, "completed");
    assert.equal(
      await scalar(
        db,
        "select seller_account_key from sellerpilot_private.channel_credentials where id = $1",
        [oauthCompletion.credentialId],
      ),
      diagnosticCredential.seller_account_key,
      "the same stable eBay provider subject must keep the certified lineage",
    );
    assert.deepEqual(
      (await db.query(
        `select status,
                oauth_request_vault_id is null as oauth_grant_scrubbed,
                response_payload
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [oauthJobId],
      )).rows,
      [{
        status: "succeeded",
        oauth_grant_scrubbed: true,
        response_payload: {
          channel: "ebay",
          expiresAt: oauthCredentialRefresh.expiresAt,
          ok: true,
          operation: "oauth.exchange",
          safeMessage: "eBay OAuth 교환 완료",
        },
      }],
    );
    assert.doesNotMatch(
      JSON.stringify((await db.query(
        "select response_payload from sellerpilot_private.channel_gateway_jobs where id = $1",
        [oauthJobId],
      )).rows[0]?.response_payload),
      /credentialPayload|access_token|refresh_token|nested-refresh-token/i,
    );
    assert.equal(
      (await scalar(
        db,
        `select public.sellerpilot_service_complete_serverless_cs_transaction(
          $1, $2, $3, 'succeeded', $4::jsonb, null, $5::jsonb,
          null, null, null
        )`,
        oauthCompletionArguments,
      )).replayed,
      true,
    );

    await db.exec(withoutUnavailableExtensions(shopeeStaticEgressMigration));
    await db.exec(withoutUnavailableExtensions(smartstoreNonstaticEgressMigration));
    await db.exec(withoutUnavailableExtensions(lazadaProviderMarkerMigration));
    await db.exec(withoutUnavailableExtensions(lazadaOauthReauthorizationMigration));
    await db.exec(withoutUnavailableExtensions(qoo10StaleVerifierRetirementMigration));
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_serverless_static_egress_status()"),
      { coupang: false, elevenst: false, shopee: false, temu: false },
    );
    const shopeeFixedEgressCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production',
        '{"partner_id":"2031489","partner_key":"fixed-egress-secret","shop_id":"1719148844","access_token":"fixed-egress-access","refresh_token":"fixed-egress-refresh","provider_account_identity_version":"v1","provider_account_subject":"shopee:shop:1719148844"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const shopeeFixedEgressJobIds = new Map();
    for (const operation of [
      "inquiries.list",
      "diagnostic.test",
    ]) {
      shopeeFixedEgressJobIds.set(operation, await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, channel, operation, environment, request_payload, created_by
         ) values (
           $1, 'shopee', $2, 'production', '{}'::jsonb, $3
         ) returning id`,
        [shopeeFixedEgressCredentialId, operation, ADMIN_ID],
      ));
    }
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'test/no-local-shopee-fallback')",
        [genericGatewayHash],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/no-shopee-egress-policy')",
        [serverlessHash],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.channel_gateway_jobs
          where id in ($1, $2)
            and status = 'queued'`,
        [
          shopeeFixedEgressJobIds.get("inquiries.list"),
          shopeeFixedEgressJobIds.get("diagnostic.test"),
        ],
      ),
      2,
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel = 'shopee'`,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"shopee"}',
        false
      )`,
    );
    const allowedShopeeClaims = new Map([
      [shopeeFixedEgressJobIds.get("diagnostic.test"), "diagnostic.test"],
    ]);
    for (let index = 0; index < 1; index += 1) {
      const claim = await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, $2)",
        [serverlessHash, `test/shopee-static-egress-allowed-${index + 1}`],
      );
      assert.equal(claim.channel, "shopee");
      assert.equal(allowedShopeeClaims.get(claim.id), claim.operation);
      allowedShopeeClaims.delete(claim.id);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status = 'cancelled', worker_token_id = null, claim_token = null,
                lease_expires_at = null, completed_at = clock_timestamp(),
                error_message = $2,
                updated_at = clock_timestamp()
          where id = $1 and status = 'running'`,
        [claim.id, `Synthetic Shopee static-egress allowed claim ${index + 1} completed.`],
      );
    }
    assert.equal(allowedShopeeClaims.size, 0);
    assert.deepEqual(
      (await db.query(
        `select operation, status
           from sellerpilot_private.channel_gateway_jobs
          where id = $1
          order by operation`,
        [
          shopeeFixedEgressJobIds.get("inquiries.list"),
        ],
      )).rows,
      [
        { operation: "inquiries.list", status: "queued" },
      ],
    );
    assert.deepEqual(
      (await db.query(
        `select operation,
                sellerpilot_private.serverless_gateway_job_allowed(
                  'shopee', operation
                ) as serverless_allowed
           from (values
             ('price.update'),
             ('inquiries.list'),
             ('inquiries.reply'),
             ('listing.create'),
             ('diagnostic.test')
           ) operations(operation)
          order by operation`,
      )).rows,
      [
        { operation: "diagnostic.test", serverless_allowed: true },
        { operation: "inquiries.list", serverless_allowed: false },
        { operation: "inquiries.reply", serverless_allowed: false },
        { operation: "listing.create", serverless_allowed: true },
        { operation: "price.update", serverless_allowed: false },
      ],
    );
    assert.match(
      await scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure)",
      ),
      /j\.channel = 'shopee'[\s\S]*or \([\s\S]*serverless_gateway_job_allowed/i,
      "the persistent claimant must block Shopee before consulting the operation allowlist",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'test/no-local-shopee-unsupported-fallback')",
        [genericGatewayHash],
      ),
      null,
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = false, updated_at = clock_timestamp()
        where channel = 'shopee'`,
    );

    // This intentionally non-chronological fixture skips the later Temu
    // publication release migration. Re-attest the seven-channel release at
    // the exact point where its legacy Temu fixed-egress probe crosses the
    // listing mutation claim fence; credential/identity setup above may have
    // conservatively closed the global gate.
    await attestPublicationRelease(db, PUBLICATION_RELEASE_SHA, [
      "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay",
    ]);
    await activatePublicationRuntimeRelease(db);
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      )).effectiveOpen,
      true,
    );

    const temuJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, request_payload, created_by
       ) values (
         $1, 'temu', 'listing.create', 'production',
         '{"arguments":{"goodsName":"fixed-egress-contract-probe"}}'::jsonb, $2
       ) returning id`,
      [temuCredentialId, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'test/no-local-fixed-egress-fallback')",
        [genericGatewayHash],
      ),
      null,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/no-egress-policy')",
        [serverlessHash],
      ),
      null,
    );

    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel = 'temu'`,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"temu,unknown"}',
        false
      )`,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/unknown-egress-header')",
        [serverlessHash],
      ),
      null,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"temu"}',
        false
      )`,
    );
    await assert.rejects(
      db.query(
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/fixed-egress-denied')",
        [serverlessHash],
      ),
      /LISTING_MUTATION_RELEASE_GATE_CLOSED/,
      "static egress must not bypass the canonical seven-channel publication gate",
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
          $1, $2, $3
        )`,
        [serverlessHash, temuJobId, "00000000-0000-4000-8000-000000009999"],
      ),
      false,
      "Temu must stay blocked at the provider boundary too",
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [temuJobId],
      ),
      "queued",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status='cancelled',completed_at=clock_timestamp(),
              error_message='Temu publication is outside the verified seven-channel release.'
        where id=$1 and status='queued'`,
      [temuJobId],
    );

    await scalar(db, "select set_config('request.headers', '{}', false)");
    const smartstoreNonstaticJobs = new Map(
      (await db.query(
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, channel, operation, environment,
           request_payload, created_by, created_at
         ) values
           ($1, 'smartstore', 'listing.update', 'production',
            '{"arguments":{"listingId":"smartstore-nonstatic-listing-probe"}}'::jsonb,
            $2, clock_timestamp() + interval '10 minutes'),
           ($1, 'smartstore', 'orders.list', 'production',
            '{"arguments":{"fromDate":"2026-08-30","toDate":"2026-08-31"}}'::jsonb,
            $2, clock_timestamp() + interval '11 minutes'),
           ($1, 'smartstore', 'inquiries.reply', 'production',
            '{"arguments":{"kind":"customer","inquiryNo":"90001","reply":"nonstatic claim probe"}}'::jsonb,
            $2, clock_timestamp() + interval '12 minutes')
         returning id::text, operation`,
        [smartstoreCredentialId, ADMIN_ID],
      )).rows.map((row) => [row.id, row.operation]),
    );
    for (let index = 0; index < 3; index += 1) {
      const claim = await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, $2)",
        [serverlessHash, `test/smartstore-nonstatic-${index + 1}`],
      );
      assert.equal(claim.channel, "smartstore");
      assert.equal(smartstoreNonstaticJobs.get(claim.id), claim.operation);
      smartstoreNonstaticJobs.delete(claim.id);
      await db.query(
        `update sellerpilot_private.channel_gateway_jobs
            set status = 'cancelled', worker_token_id = null,
                claim_token = null, lease_expires_at = null,
                completed_at = clock_timestamp(),
                error_message = 'Smartstore non-static claim fixture completed.',
                updated_at = clock_timestamp()
          where id = $1 and status = 'running'`,
        [claim.id],
      );
    }
    assert.equal(
      smartstoreNonstaticJobs.size,
      0,
      "Smartstore listing update, read, and CS jobs must all claim without a static-egress header",
    );

    const ordersJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment, request_payload, created_by
       ) values (
         $1, 'ebay', 'orders.list', 'production',
         '{"arguments":{"fromDate":"2026-08-27","toDate":"2026-08-28"}}'::jsonb, $2
       ) returning id`,
      [oauthCompletion.credentialId, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_channel_gateway_job($1, 'test/no-local-orders-fallback')",
        [genericGatewayHash],
      ),
      null,
    );
    const ordersClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/serverless-orders')",
      [serverlessHash],
    );
    assert.equal(ordersClaim.id, ordersJobId);
    assert.equal(ordersClaim.channel, "ebay");
    assert.equal(ordersClaim.operation, "orders.list");
    const ordersCompletion = await scalar(
      db,
      `select public.sellerpilot_service_complete_serverless_cs_transaction(
        $1, $2, $3, 'succeeded',
        '{"ok":true,"channel":"ebay","operation":"orders.list","steps":[],"safeMessage":"No orders in the bounded range"}'::jsonb,
        null, null, '[]'::jsonb, null, null
      )`,
      [serverlessHash, ordersJobId, ordersClaim.claim_token],
    );
    assert.equal(ordersCompletion.status, "completed");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [ordersJobId],
      ),
      "succeeded",
    );
    assert.deepEqual(
      await scalar(db, "select public.sellerpilot_service_serverless_static_egress_status()"),
      { coupang: false, elevenst: false, shopee: false, temu: true },
    );
  } finally {
    await db.close();
  }
});

test("marketplace normalized assets are reserved before upload and cleaned with retained-listing fences", async () => {
  const db = new PGlite();
  const retainedDigest = "a".repeat(64);
  const orphanDigest = "b".repeat(64);
  const retainedPath = `normalized/aa/${retainedDigest}.jpg`;
  const orphanPath = `normalized/bb/${orphanDigest}.jpg`;
  const retainedProductId = "10000000-0000-4000-8000-000000000201";
  const orphanProductId = "10000000-0000-4000-8000-000000000202";
  const retainedAttemptId = "10000000-0000-4000-8000-000000000211";
  const orphanAttemptId = "10000000-0000-4000-8000-000000000212";
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }

    await db.query(
      "insert into auth.users (id, email) values ($1, 'marketplace-assets@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Marketplace Assets Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'qoo10', 'production',
        '{"api_key":"marketplace-assets-key","seller_id":"marketplace-assets-seller"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.products (
         id, owner_id, external_code, sku, name, status, demo
       ) values
         ($1, $3, 'asset-retained-product', 'ASSET-RETAINED', 'Retained asset product', 'active', false),
         ($2, $3, 'asset-orphan-product', 'ASSET-ORPHAN', 'Orphan asset product', 'active', false)`,
      [retainedProductId, orphanProductId, ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts (
         id, owner_id, credential_id, channel, operation,
         idempotency_key, request_fingerprint, status
       ) values
         ($1, $3, $4, 'qoo10', 'listing.create',
          'marketplace-asset-retained-attempt', $5, 'running'),
         ($2, $3, $4, 'qoo10', 'listing.create',
          'marketplace-asset-orphan-attempt', $6, 'running')`,
      [
        retainedAttemptId,
        orphanAttemptId,
        ADMIN_ID,
        credentialId,
        "c".repeat(64),
        "d".repeat(64),
      ],
    );

    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_register_marketplace_normalized_asset_refs(
          $1, $2, 'qoo10', 'JP', 'shop-main', array[$3]::text[]
        )`,
        [retainedAttemptId, retainedProductId, retainedPath],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select asset.status, asset.uploaded_at is null as upload_pending,
                ref.upload_confirmed_at is null as ref_pending
           from sellerpilot_private.marketplace_normalized_assets asset
           join sellerpilot_private.marketplace_normalized_asset_refs ref
             on ref.object_path = asset.object_path
          where asset.object_path = $1`,
        [retainedPath],
      )).rows,
      [{ status: "reserved", upload_pending: true, ref_pending: true }],
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded(
          $1, array[$2]::text[]
        )`,
        [retainedAttemptId, retainedPath],
      ),
      true,
    );
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set status = 'succeeded', completed_at = clock_timestamp()
        where id = $1`,
      [retainedAttemptId],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         owner_id, product_id, channel_key, remote_id, status,
         market, target_id, operation_attempt_id
       ) values ($1, $2, 'qoo10', 'REMOTE-ASSET-RETAINED', 'published',
         'JP', 'shop-main', $3)`,
      [ADMIN_ID, retainedProductId, retainedAttemptId],
    );
    assert.equal(
      await scalar(
        db,
        `select retained_by_listing
           from sellerpilot_private.marketplace_normalized_asset_refs
          where attempt_id = $1 and object_path = $2`,
        [retainedAttemptId, retainedPath],
      ),
      true,
    );

    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_register_marketplace_normalized_asset_refs(
          $1, $2, 'qoo10', 'JP', 'shop-orphan', array[$3]::text[]
        )`,
        [orphanAttemptId, orphanProductId, orphanPath],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_mark_marketplace_normalized_assets_uploaded(
          $1, array[$2]::text[]
        )`,
        [orphanAttemptId, orphanPath],
      ),
      true,
    );
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set status = 'failed', completed_at = clock_timestamp()
        where id = $1`,
      [orphanAttemptId],
    );
    await db.query(
      `update sellerpilot_private.marketplace_normalized_assets
          set cleanup_after = clock_timestamp() - interval '1 second'
        where object_path = any($1::text[])`,
      [[retainedPath, orphanPath]],
    );

    const firstClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(10, 120)",
    );
    assert.deepEqual(firstClaim.paths, [orphanPath]);
    assert.equal(firstClaim.bucket, "sellerpilot-marketplace");
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
          $1, array[]::text[], 'storage_remove_failed'
        )`,
        [firstClaim.claimToken],
      ),
      { removed: 0, requeued: 1 },
    );
    await db.query(
      `update sellerpilot_private.marketplace_normalized_assets
          set cleanup_after = clock_timestamp() - interval '1 second'
        where object_path = $1`,
      [orphanPath],
    );
    const retryClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(10, 120)",
    );
    assert.deepEqual(retryClaim.paths, [orphanPath]);
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
          $1, array[$2]::text[], null
        )`,
        [retryClaim.claimToken, orphanPath],
      ),
      { removed: 1, requeued: 0 },
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.marketplace_normalized_assets where object_path = $1",
        [orphanPath],
      ),
      0,
    );

    await db.query(
      "update sellerpilot_private.products set status = 'archived' where id = $1",
      [retainedProductId],
    );
    await db.query(
      `update sellerpilot_private.marketplace_normalized_assets
          set cleanup_after = clock_timestamp() - interval '1 second'
        where object_path = $1`,
      [retainedPath],
    );
    const archivedClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_marketplace_normalized_asset_cleanup(10, 120)",
    );
    assert.deepEqual(archivedClaim.paths, [retainedPath]);
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
          $1, array[$2]::text[], null
        )`,
        [archivedClaim.claimToken, retainedPath],
      ),
      { removed: 1, requeued: 0 },
    );
  } finally {
    await db.close();
  }
});

test("bounded serverless gateway can hold five independent channel claims without a global claim lock", async () => {
  const db = new PGlite();
  const serverlessHash = "6".repeat(64);
  const channels = ["qoo10", "shopee", "lazada", "coupang", "smartstore"];
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }
    const claimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure)",
    );
    const fastPathIndex = claimDefinition.indexOf("-- Keep ordinary channel drains");
    const advisoryIndex = claimDefinition.indexOf(
      "perform pg_catalog.pg_advisory_xact_lock",
    );
    assert.ok(fastPathIndex >= 0 && fastPathIndex < advisoryIndex);
    assert.match(
      claimDefinition.slice(fastPathIndex, advisoryIndex),
      /sellerpilot_204000_claim_serverless_gateway_unsafe/i,
    );
    const activationExpiryDefinition = await scalar(
      db,
      "select pg_get_functiondef('sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim()'::regprocedure)",
    );
    const normalizedActivationExpiryDefinition = activationExpiryDefinition.toLowerCase();
    const activationExpiryFastPath = normalizedActivationExpiryDefinition.indexOf("if not exists");
    const activationExpiryLock = normalizedActivationExpiryDefinition.indexOf(
      "perform pg_catalog.pg_advisory_xact_lock",
    );
    assert.ok(
      activationExpiryFastPath >= 0
        && activationExpiryLock > activationExpiryFastPath,
      "ordinary claims must return before the Qoo10 recovery advisory lock when no exact expired activation exists",
    );
    assert.match(
      activationExpiryDefinition.slice(activationExpiryFastPath, activationExpiryLock),
      /permit\.invalidated_at IS NULL[\s\S]*permit\.expires_at <= statement_timestamp\(\)[\s\S]*job\.status = 'queued'[\s\S]*job\.operation = 'listing\.activate'[\s\S]*RETURN 0/i,
    );

    await db.query(
      "insert into auth.users (id, email) values ($1, 'five-serverless-claims@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Five Claims Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    const credentialIds = [];
    for (const channel of channels) {
      credentialIds.push(await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          $1, 'production', jsonb_build_object('access_token', $1 || '-five-claim-token'),
          now() + interval '365 days', 180, 30, 0
        )`,
        [channel],
      ));
    }
    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values (
         'five bounded gateway claims', $1, '666666666666', 'active',
         'serverless_cs', clock_timestamp() + interval '1 day', $2
       )`,
      [serverlessHash, ADMIN_ID],
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel in ('coupang', 'smartstore', 'shopee')`,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"coupang,smartstore,shopee"}',
        false
      )`,
    );
    for (let index = 0; index < channels.length; index += 1) {
      await db.query(
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, channel, operation, environment,
           request_payload, created_by
         ) values ($1, $2, 'diagnostic.test', 'production', '{}'::jsonb, $3)`,
        [credentialIds[index], channels[index], ADMIN_ID],
      );
    }

    const claims = await Promise.all(channels.map((_, index) => scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, $2)",
      [serverlessHash, `test/five-claims/${index}`],
    )));
    assert.equal(claims.every(Boolean), true);
    assert.equal(new Set(claims.map((claim) => claim.id)).size, 5);
    assert.deepEqual(
      claims.map((claim) => claim.channel).sort(),
      [...channels].sort(),
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.channel_gateway_jobs
          where status = 'running'
            and worker_token_id is not null
            and claim_token is not null`,
      ),
      5,
    );
  } finally {
    await db.close();
  }
});

test("Coupang bounded reads drain nine jobs per window and opportunistic reaping never reclaims a mutation", async () => {
  const db = new PGlite();
  const serverlessHash = "7".repeat(64);
  const readOperations = new Set(["orders.list", "inquiries.list"]);
  const completeRead = async (claim) => scalar(
    db,
    `select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1, $2, $3, 'succeeded', $4::jsonb, null, null,
      $5::jsonb, $6::jsonb, null
    )`,
    [
      serverlessHash,
      claim.id,
      claim.claim_token,
      JSON.stringify({
        ok: true,
        channel: "coupang",
        operation: claim.operation,
        steps: [],
        safeMessage: "Synthetic bounded Coupang read",
      }),
      claim.operation === "orders.list" ? "[]" : null,
      claim.operation === "inquiries.list" ? "[]" : null,
    ],
  );
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }
    await attestPublicationRelease(db);
    await activatePublicationRuntimeRelease(db);
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      )).open,
      true,
      "this mutation-reaping fixture must explicitly open the release gate",
    );

    await db.query(
      "insert into auth.users (id, email) values ($1, 'coupang-read-capacity@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Coupang Capacity Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);
    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'coupang', 'production',
        '{"access_key":"bounded-coupang-access","secret_key":"bounded-coupang-secret","vendor_id":"A00000000"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values (
         'bounded Coupang read capacity', $1, '777777777777', 'active',
         'serverless_cs', clock_timestamp() + interval '1 day', $2
       )`,
      [serverlessHash, ADMIN_ID],
    );
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel = 'coupang'`,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"coupang"}',
        false
      )`,
    );

    const queuedIds = [];
    for (const operation of [
      "orders.list",
      "inquiries.list",
      "orders.list",
      "listing.stop",
    ]) {
      queuedIds.push(await scalar(
        db,
        `insert into sellerpilot_private.channel_gateway_jobs (
           credential_id, channel, operation, environment,
           request_payload, created_by
         ) values ($1, 'coupang', $2, 'production', '{}'::jsonb, $3)
         returning id`,
        [credentialId, operation, ADMIN_ID],
      ));
    }

    const firstWave = await Promise.all([0, 1].map((index) => scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, $2)",
      [serverlessHash, `test/coupang-capacity/${index}`],
    )));
    assert.equal(firstWave.every((claim) => readOperations.has(claim?.operation)), true);
    assert.equal(new Set(firstWave.map((claim) => claim.id)).size, 2);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/coupang-capacity/full')",
        [serverlessHash],
      ),
      null,
    );
    assert.equal(2 * 5 >= 9, true, "two read slots at one wake/minute must drain nine jobs per five minutes");

    assert.equal((await completeRead(firstWave[0])).status, "completed");
    const replacementRead = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/coupang-capacity/replacement')",
      [serverlessHash],
    );
    assert.equal(readOperations.has(replacementRead.operation), true);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/coupang-write-still-fenced')",
        [serverlessHash],
      ),
      null,
    );

    assert.equal((await completeRead(firstWave[1])).status, "completed");
    assert.equal((await completeRead(replacementRead)).status, "completed");
    const mutationClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/coupang-mutation-after-reads')",
      [serverlessHash],
    );
    assert.equal(mutationClaim.id, queuedIds[3]);
    assert.equal(mutationClaim.operation, "listing.stop");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at = clock_timestamp() - interval '1 second'
        where id = $1`,
      [mutationClaim.id],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/expired-mutation-not-reclaimed')",
        [serverlessHash],
      ),
      null,
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [mutationClaim.id],
      )).rows,
      [{ status: "reconciliation_required", attempt_count: 1 }],
    );

    const expiredReadId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by
       ) values ($1, 'coupang', 'orders.list', 'production', '{}'::jsonb, $2)
       returning id`,
      [credentialId, ADMIN_ID],
    );
    const expiredReadClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/expired-read-first-claim')",
      [serverlessHash],
    );
    assert.equal(expiredReadClaim.id, expiredReadId);
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at = clock_timestamp() - interval '1 second'
        where id = $1`,
      [expiredReadId],
    );
    const reclaimedRead = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/expired-read-reclaimed')",
      [serverlessHash],
    );
    assert.equal(reclaimedRead.id, expiredReadId);
    assert.notEqual(reclaimedRead.claim_token, expiredReadClaim.claim_token);
    assert.equal(reclaimedRead.attempt_count, 2);
    assert.equal((await completeRead(reclaimedRead)).status, "completed");

    // PGlite has one backend, so force the exact capacity SQLSTATE from a
    // second trigger. The claimant must convert only that expected race into
    // an empty claim and leave the selected row queued for a later wake.
    await db.exec(`
      create function sellerpilot_private.test_force_gateway_capacity_race()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if new.status = 'running'
           and new.request_payload->>'forceCapacityRace' = 'true' then
          raise exception using
            errcode = 'SPC02',
            message = 'synthetic capacity race';
        end if;
        return new;
      end;
      $$;
      create trigger aaa_test_force_gateway_capacity_race
      before update of status
      on sellerpilot_private.channel_gateway_jobs
      for each row execute function
        sellerpilot_private.test_force_gateway_capacity_race();
    `);
    const capacityRaceId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by
       ) values (
         $1, 'coupang', 'orders.list', 'production',
         '{"forceCapacityRace":"true"}'::jsonb, $2
       ) returning id`,
      [credentialId, ADMIN_ID],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/capacity-race-null')",
        [serverlessHash],
      ),
      null,
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, claim_token
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [capacityRaceId],
      )).rows,
      [{ status: "queued", attempt_count: 0, claim_token: null }],
    );
    await db.exec(`
      drop trigger aaa_test_force_gateway_capacity_race
        on sellerpilot_private.channel_gateway_jobs;
      drop function sellerpilot_private.test_force_gateway_capacity_race();
    `);
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where id = $1",
      [capacityRaceId],
    );

    const [reaperDefinition, reaperPreTemuDefinition] = await Promise.all([
      scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)'::regprocedure)",
      ),
      scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_133000_reap_gateway_before_temu_publication(integer)'::regprocedure)",
      ),
    ]);
    assert.match(reaperPreTemuDefinition, /pg_try_advisory_xact_lock\(193674993, 821065043\)/i);
    assert.doesNotMatch(reaperPreTemuDefinition, /pg_advisory_xact_lock\(193674993, 821065042\)/i);
    assert.match(reaperDefinition, /sellerpilot_133000_reap_gateway_before_temu_publication/);
    assert.match(reaperDefinition, /finalize_reaped_temu_publication_jobs/);

    // PGlite exposes one backend, so model the try-lock loser by returning the
    // reaper's exact zero-work payload. The claimant must ignore that outcome
    // and continue to the queued job without a blocking advisory acquisition.
    await db.exec(`
      create or replace function public.sellerpilot_service_reap_stale_channel_gateway_jobs(
        p_limit integer default 100
      ) returns jsonb
      language sql
      security definer
      set search_path = ''
      as $$
        select '{"retried":0,"failed":0,"reconciliationRequired":0,"oauthCompleted":0,"total":0}'::jsonb
      $$
    `);
    const loserProbeId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by
       ) values ($1, 'coupang', 'diagnostic.test', 'production', '{}'::jsonb, $2)
       returning id`,
      [credentialId, ADMIN_ID],
    );
    const loserProbe = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/reaper-try-lock-loser')",
      [serverlessHash],
    );
    assert.equal(loserProbe.id, loserProbeId);
  } finally {
    await db.close();
  }
});

test("push delivery leases retry only before provider send and reconcile every uncertain outcome", async () => {
  const db = new PGlite();
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }

    const pushServiceSignatures = [
      "public.sellerpilot_service_claim_push_deliveries(integer)",
      "public.sellerpilot_service_claim_push_deliveries(integer,integer)",
      "public.sellerpilot_service_begin_push_delivery(uuid,uuid)",
      "public.sellerpilot_service_finish_push_delivery(uuid,text,text)",
      "public.sellerpilot_service_finish_push_delivery(uuid,uuid,text,text)",
      "public.sellerpilot_service_reap_stale_push_deliveries(integer)",
    ];
    for (const signature of pushServiceSignatures) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege('anon', $1, 'EXECUTE')",
          [signature],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege('authenticated', $1, 'EXECUTE')",
          [signature],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege('service_role', $1, 'EXECUTE')",
          [signature],
        ),
        true,
      );
    }
    const pushReaperDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_service_reap_stale_push_deliveries(integer)'::regprocedure)",
    );
    assert.match(pushReaperDefinition, /for update skip locked[\s\S]*limit p_limit/i);
    assert.doesNotMatch(pushReaperDefinition, /advisory_(?:xact_)?lock/i);
    assert.match(
      await scalar(
        db,
        "select pg_get_functiondef('public.sellerpilot_service_claim_push_deliveries(integer,integer)'::regprocedure)",
      ),
      /sellerpilot_service_reap_stale_push_deliveries\(25\)/i,
    );

    await db.query(
      "insert into auth.users (id, email) values ($1, 'push-lease-fence@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Push Lease Admin')",
      [ADMIN_ID],
    );
    await setClaims(db, "service_role");
    const subscriptionId = await scalar(
      db,
      `insert into sellerpilot_private.push_subscriptions (
         owner_id, endpoint, endpoint_hash, p256dh, auth_secret, device_label
       ) values (
         $1, 'https://push.example.test/subscriptions/lease-fence', $2,
         'push-lease-p256dh-material', 'push-lease-auth', 'Push Lease Device'
       ) returning id`,
      [ADMIN_ID, "8".repeat(64)],
    );
    const insertDelivery = async (suffix) => scalar(
      db,
      `with notification as (
         insert into sellerpilot_private.push_notification_outbox (
           owner_id, event_key, event_type, title, body, target_url
         ) values (
           $1, $2, 'purchase', 'Push lease test', 'Bounded delivery', '/?view=orders'
         ) returning id
       )
       insert into sellerpilot_private.push_notification_deliveries (
         notification_id, subscription_id
       ) select notification.id, $3 from notification
       returning id`,
      [ADMIN_ID, `push-lease:${suffix}:${crypto.randomUUID()}`, subscriptionId],
    );

    const firstInsertedId = await insertDelivery("pre-send");
    const secondInsertedId = await insertDelivery("post-send");
    const firstClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_push_deliveries(1, 60)",
    )).rows[0];
    const secondClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_push_deliveries(1, 60)",
    )).rows[0];
    assert.deepEqual(
      [firstClaim.delivery_id, secondClaim.delivery_id].sort(),
      [firstInsertedId, secondInsertedId].sort(),
    );
    const safeRetryId = firstClaim.delivery_id;
    const uncertainId = secondClaim.delivery_id;
    assert.equal(typeof firstClaim.claim_token, "string");
    assert.notEqual(firstClaim.lease_expires_at, null);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_push_delivery($1, $2)",
        [secondClaim.delivery_id, secondClaim.claim_token],
      ),
      true,
    );
    await db.query(
      `update sellerpilot_private.push_notification_deliveries
          set lease_expires_at = clock_timestamp() - interval '1 second'
        where id = any($1::uuid[])`,
      [[safeRetryId, uncertainId]],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_push_delivery($1, $2)",
        [safeRetryId, firstClaim.claim_token],
      ),
      false,
      "an expired preparing lease must never begin an external send",
    );
    assert.deepEqual(
      await scalar(
        db,
        "select public.sellerpilot_service_reap_stale_push_deliveries(10)",
      ),
      { retried: 1, reconciliationRequired: 1, total: 2 },
    );
    assert.deepEqual(
      (await db.query(
        `select id::text, status, claim_token, claim_protocol,
                provider_send_started_at is not null as provider_started,
                reconciliation_required_at is not null as reconciliation_marked
           from sellerpilot_private.push_notification_deliveries
          where id = any($1::uuid[])
          order by id`,
        [[safeRetryId, uncertainId]],
      )).rows,
      [
        {
          id: safeRetryId,
          status: "failed",
          claim_token: null,
          claim_protocol: null,
          provider_started: false,
          reconciliation_marked: false,
        },
        {
          id: uncertainId,
          status: "reconciliation_required",
          claim_token: null,
          claim_protocol: null,
          provider_started: true,
          reconciliation_marked: true,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const retryClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_push_deliveries(10, 60)",
    )).rows;
    assert.equal(retryClaim.length, 1);
    assert.equal(retryClaim[0].delivery_id, safeRetryId);
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_finish_push_delivery(
          $1, $2, 'sent', null
        )`,
        [safeRetryId, firstClaim.claim_token],
      ),
      false,
      "a stale completion must not cross the replacement claim token",
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_finish_push_delivery(
          $1, $2, 'sent', null
        )`,
        [retryClaim[0].delivery_id, retryClaim[0].claim_token],
      ),
      false,
      "a fenced success must not complete before begin is durable",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_push_delivery($1, $2)",
        [retryClaim[0].delivery_id, retryClaim[0].claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_finish_push_delivery(
          $1, 'sent', null
        )`,
        [retryClaim[0].delivery_id],
      ),
      false,
      "the legacy completion must not bypass a fenced-v2 claim token",
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_finish_push_delivery(
          $1, $2, 'sent', null
        )`,
        [retryClaim[0].delivery_id, retryClaim[0].claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.push_notification_deliveries where id = $1",
        [safeRetryId],
      ),
      "sent",
    );

    const legacyUncertainId = await insertDelivery("legacy-uncertain");
    const legacyClaim = (await db.query(
      "select * from public.sellerpilot_service_claim_push_deliveries(1)",
    )).rows[0];
    assert.equal(legacyClaim.delivery_id, legacyUncertainId);
    assert.deepEqual(
      (await db.query(
        `select status, claim_protocol,
                provider_send_started_at is not null as provider_started
           from sellerpilot_private.push_notification_deliveries
          where id = $1`,
        [legacyUncertainId],
      )).rows,
      [{ status: "sending", claim_protocol: "legacy_v1", provider_started: true }],
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_finish_push_delivery(
          $1, 'failed', 'legacy transport outcome unknown'
        )`,
        [legacyUncertainId],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.push_notification_deliveries where id = $1",
        [legacyUncertainId],
      ),
      "reconciliation_required",
    );
    assert.equal(
      (await db.query(
        "select * from public.sellerpilot_service_claim_push_deliveries(10, 60)",
      )).rows.length,
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select to_regclass('sellerpilot_private.push_notification_deliveries_expired_lease_idx') is not null",
      ),
      true,
    );
  } finally {
    await db.close();
  }
});

test("exact Lazada recovery certifies only its fingerprinted Vault snapshot and requeues one read", async () => {
  const db = new PGlite();
  const exactJobId = "5ac7a12f-94d5-451f-bd47-3b07d86c21b8";
  const exactStaleJobId = "ad891738-693a-44e4-b0bc-f19539b6e980";
  const productionCredentialId = "e54fa95d-ddfd-414f-82e9-636a0d9ab07c";
  const productionStaleRequestSha256 = "a8d59a7fdd78fa570a68150e3ea3dfba4c3d5ba8e24d9458a818e15db38400c9";
  const exactStaleCreatedAt = "2026-08-25T12:55:20.426414Z";
  const exactRecoveryMigrationName = "20260830062415_recover_exact_lazada_credential_snapshot.sql";
  const rejectedRecoveryCleanupMigrationName =
    "20260830171000_discard_rejected_lazada_recovery_for_oauth.sql";
  const recoveryTokenHash = "6".repeat(64);
  const recoveryPayload = {
    app_key: "lazada-recovery-app",
    app_secret: "lazada-recovery-secret",
    country: "my",
    access_token: "preserved-rotated-access-token",
    refresh_token: "preserved-rotated-refresh-token",
    access_token_expires_at: "2098-12-01T00:00:00.000Z",
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
    country_user_info: [{
      country: "my",
      seller_id: "1001",
      user_id: "2001",
    }],
  };
  const requestPayload = {
    periodicKey: "orders",
    arguments: { queryParams: { limit: "50" } },
  };
  const staleRequestPayload = {
    periodicKey: "orders-stale-fixture",
    arguments: { queryParams: { limit: "25" } },
  };
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const exactRecoveryMigrationIndex = migrationNames.indexOf(exactRecoveryMigrationName);
    assert.ok(exactRecoveryMigrationIndex > 0);
    for (const name of migrationNames.slice(0, exactRecoveryMigrationIndex)) {
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(source));
    }

    await db.query(
      "insert into auth.users (id, email) values ($1, 'lazada-recovery@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Lazada Recovery Admin')",
      [ADMIN_ID],
    );
    await setClaims(db);

    let versionFiveCredentialId;
    for (let version = 1; version <= 5; version += 1) {
      versionFiveCredentialId = await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          'lazada', 'production', $1::jsonb,
          '2099-01-01T00:00:00.000Z'::timestamptz,
          90, 30, 0
        )`,
        [JSON.stringify({
          app_key: "lazada-recovery-app",
          app_secret: "lazada-recovery-secret",
          country: "my",
          access_token: `legacy-access-token-v${version}`,
          refresh_token: `legacy-refresh-token-v${version}`,
          access_token_expires_at: "2098-11-01T00:00:00.000Z",
          refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
        })],
      );
    }
    assert.equal(
      await scalar(
        db,
        "select version from sellerpilot_private.channel_credentials where id = $1",
        [versionFiveCredentialId],
      ),
      5,
    );
    assert.deepEqual(
      (await db.query(
        `select status, seller_account_key, seller_account_key_source,
                seller_account_verified_at
           from sellerpilot_private.channel_credentials
          where id = $1`,
        [versionFiveCredentialId],
      )).rows,
      [{
        status: "active",
        seller_account_key: null,
        seller_account_key_source: "legacy_unattested",
        seller_account_verified_at: null,
      }],
    );

    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values (
         'exact Lazada recovery', $1, '666666666666', 'active', 'gateway',
         clock_timestamp() + interval '1 day', $2
       )`,
      [recoveryTokenHash, ADMIN_ID],
    );
    const recoveryVaultId = await scalar(
      db,
      `select vault.create_secret(
        $1::jsonb::text,
        $2,
        'Synthetic exact Lazada recovery snapshot.'
      )`,
      [
        JSON.stringify(recoveryPayload),
        `sellerpilot_gateway_recovery_lazada_${exactJobId}_fixture`,
      ],
    );
    const recoveryFingerprint = await scalar(
      db,
      `select encode(extensions.digest(
        jsonb_build_object(
          'payload', $1::jsonb,
          'expires_at', $2::timestamptz,
          'recovery_only', true
        )::text,
        'sha256'
      ), 'hex')`,
      [JSON.stringify(recoveryPayload), recoveryPayload.refresh_token_expires_at],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, attempt_id, channel, operation, environment,
         request_payload, status, error_message, created_by, completed_at,
         credential_refresh_recovery_vault_id,
         credential_refresh_recovery_fingerprint,
         credential_refresh_recovery_staged_at
       ) values (
         $1, $2, null, 'lazada', 'orders.list', 'production', $3::jsonb,
         'reconciliation_required', 'LAZADA_ACCOUNT_IDENTITY_INVALID', $4,
         clock_timestamp(), $5, $6, clock_timestamp()
       )`,
      [
        exactJobId,
        versionFiveCredentialId,
        JSON.stringify(requestPayload),
        ADMIN_ID,
        recoveryVaultId,
        recoveryFingerprint,
      ],
    );

    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, attempt_id, listing_id, channel, operation,
         environment, request_payload, status, attempt_count, created_by,
         created_at, updated_at
       ) values (
         $1, $2, null, null, 'lazada', 'orders.list', 'production', $3::jsonb,
         'queued', 0, $4, $5::timestamptz, $5::timestamptz
       )`,
      [
        exactStaleJobId,
        versionFiveCredentialId,
        JSON.stringify(staleRequestPayload),
        ADMIN_ID,
        exactStaleCreatedAt,
      ],
    );
    const fixtureStaleRequestSha256 = await scalar(
      db,
      `select encode(extensions.digest($1::jsonb::text, 'sha256'), 'hex')`,
      [JSON.stringify(staleRequestPayload)],
    );
    let exactRecoverySql = await readFile(
      new URL(exactRecoveryMigrationName, migrationUrl),
      "utf8",
    );
    assert.match(exactRecoverySql, new RegExp(productionCredentialId, "g"));
    assert.match(exactRecoverySql, new RegExp(productionStaleRequestSha256, "g"));
    assert.match(exactRecoverySql, /p_reason is null/);
    exactRecoverySql = exactRecoverySql
      .replaceAll(productionCredentialId, versionFiveCredentialId)
      .replaceAll(productionStaleRequestSha256, fixtureStaleRequestSha256);
    await db.exec(withoutUnavailableExtensions(exactRecoverySql));
    for (const name of migrationNames.slice(exactRecoveryMigrationIndex + 1)) {
      if (
        name === rejectedRecoveryCleanupMigrationName
        || name === COMPETITOR_PRE_V3_QUEUE_RETIREMENT_MIGRATION
      ) continue;
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(source));
    }

    // A referenced snapshot is insufficient when its durable fingerprint is
    // not exact. The claim must leave both the job and Vault row untouched.
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_recovery_fingerprint = $2
        where id = $1`,
      [exactJobId, "7".repeat(64)],
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_claim_exact_lazada_recovery(
          $1, $2, 'test/fingerprint-mismatch'
        )`,
        [recoveryTokenHash, exactJobId],
      ),
      { status: "state_mismatch" },
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [exactStaleJobId],
      ),
      "queued",
      "an invalid recovery snapshot must not clean even the exact stale read",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_exact_stale_read_cancelled'
            and entity_id = $1`,
        [exactStaleJobId],
      ),
      0,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_recovery_fingerprint = $2
        where id = $1`,
      [exactJobId, recoveryFingerprint],
    );

    const conflictingJobId = await scalar(
      db,
      `insert into sellerpilot_private.channel_gateway_jobs (
         credential_id, channel, operation, environment,
         request_payload, created_by
       ) values (
         $1, 'lazada', 'orders.list', 'production',
         '{"periodicKey":"different-order-window"}'::jsonb, $2
       ) returning id`,
      [versionFiveCredentialId, ADMIN_ID],
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_claim_exact_lazada_recovery(
          $1, $2, 'test/conflicting-work'
        )`,
        [recoveryTokenHash, exactJobId],
      ),
      { status: "state_mismatch" },
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, worker_token_id, claim_token,
                lease_expires_at, started_at, completed_at, error_message,
                provider_mutation_started_at,
                created_at = $2::timestamptz as created_unchanged,
                updated_at = $2::timestamptz as updated_unchanged,
                encode(extensions.digest(request_payload::text, 'sha256'), 'hex')
                  as request_sha256
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactStaleJobId, exactStaleCreatedAt],
      )).rows,
      [{
        status: "queued",
        attempt_count: 0,
        worker_token_id: null,
        claim_token: null,
        lease_expires_at: null,
        started_at: null,
        completed_at: null,
        error_message: null,
        provider_mutation_started_at: null,
        created_unchanged: true,
        updated_unchanged: true,
        request_sha256: fixtureStaleRequestSha256,
      }],
      "a third active job must prevent the exact cleanup from changing state",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_exact_stale_read_cancelled'
            and entity_id = $1`,
        [exactStaleJobId],
      ),
      0,
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      1,
      "the third-job conflict must not touch the recovery Vault snapshot",
    );
    assert.deepEqual(
      (await db.query(
        `select status, worker_token_id, claim_token, lease_expires_at,
                error_message, credential_refresh_recovery_vault_id::text as recovery_vault_id
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        status: "reconciliation_required",
        worker_token_id: null,
        claim_token: null,
        lease_expires_at: null,
        error_message: "LAZADA_ACCOUNT_IDENTITY_INVALID",
        recovery_vault_id: recoveryVaultId,
      }],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', completed_at = clock_timestamp(),
              error_message = 'Synthetic conflicting work removed.'
        where id = $1 and status = 'queued'`,
      [conflictingJobId],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message = 'Gateway write lease expired; provider outcome requires reconciliation.'
        where id = $1`,
      [exactJobId],
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_claim_exact_lazada_recovery(
          $1, $2, 'test/unattested-generic-reaper-error'
        )`,
        [recoveryTokenHash, exactJobId],
      ),
      { status: "state_mismatch" },
      "the generic lease error alone must never authorize exact recovery",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_credential_recovery_claimed'
            and entity_id = $1`,
        [exactJobId],
      ),
      0,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message = 'LAZADA_ACCOUNT_IDENTITY_INVALID'
        where id = $1`,
      [exactJobId],
    );

    const firstClaim = await scalar(
      db,
      `select public.sellerpilot_service_claim_exact_lazada_recovery(
        $1, $2, 'test/transient-read'
      )`,
      [recoveryTokenHash, exactJobId],
    );
    assert.equal(firstClaim.status, "claimed");
    assert.equal(firstClaim.id, exactJobId);
    assert.equal(firstClaim.operation, "orders.list");
    assert.equal(firstClaim.credential.access_token, recoveryPayload.access_token);
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, worker_token_id, claim_token,
                lease_expires_at, started_at, provider_mutation_started_at,
                prepared_credential_id, credential_refresh_recovery_vault_id,
                oauth_exchange_completed, response_payload,
                completed_at is not null as completed,
                updated_at = completed_at as timestamps_bound,
                encode(extensions.digest(request_payload::text, 'sha256'), 'hex')
                  as request_sha256
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactStaleJobId],
      )).rows,
      [{
        status: "cancelled",
        attempt_count: 0,
        worker_token_id: null,
        claim_token: null,
        lease_expires_at: null,
        started_at: null,
        provider_mutation_started_at: null,
        prepared_credential_id: null,
        credential_refresh_recovery_vault_id: null,
        oauth_exchange_completed: false,
        response_payload: null,
        completed: true,
        timestamps_bound: true,
        request_sha256: fixtureStaleRequestSha256,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_exact_stale_read_cancelled'
            and entity_id = $1
            and safe_detail->>'request_sha256' = $2
            and safe_detail->>'provider_call_started' = 'false'
            and safe_detail->>'provider_mutation_started' = 'false'`,
        [exactStaleJobId, fixtureStaleRequestSha256],
      ),
      1,
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      1,
      "the exact stale cleanup must not touch the recovery Vault snapshot",
    );
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_abort_exact_lazada_recovery(
          $1, $2, $3, $4::text
        )`,
        [recoveryTokenHash, exactJobId, firstClaim.claim_token, null],
      ),
      /invalid exact Lazada recovery abort/,
    );
    assert.deepEqual(
      (await db.query(
        `select status, claim_token::text,
                credential_refresh_recovery_vault_id::text as recovery_vault_id,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        status: "running",
        claim_token: firstClaim.claim_token,
        recovery_vault_id: recoveryVaultId,
        provider_mutation_started_at: null,
      }],
      "a NULL abort reason must leave the live claim and snapshot untouched",
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_abort_exact_lazada_recovery(
          $1, $2, $3, 'provider_read_transient'
        )`,
        [recoveryTokenHash, exactJobId, firstClaim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status, error_message,
                credential_refresh_recovery_vault_id::text as recovery_vault_id,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        status: "reconciliation_required",
        error_message: "LAZADA_ACCOUNT_IDENTITY_INVALID",
        recovery_vault_id: recoveryVaultId,
        provider_mutation_started_at: null,
      }],
    );

    const expiredClaim = await scalar(
      db,
      `select public.sellerpilot_service_claim_exact_lazada_recovery(
        $1, $2, 'test/pre-prepare-lease-expiry'
      )`,
      [recoveryTokenHash, exactJobId],
    );
    assert.equal(expiredClaim.status, "claimed");
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_exact_stale_read_cancelled'
            and entity_id = $1`,
        [exactStaleJobId],
      ),
      1,
      "replaying the exact cleanup must not duplicate its audit or state change",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at = clock_timestamp() - interval '1 second'
        where id = $1
          and status = 'running'
          and claim_token = $2`,
      [exactJobId, expiredClaim.claim_token],
    );
    const prePrepareReaped = await scalar(
      db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(10)",
    );
    assert.equal(prePrepareReaped.retried, 0);
    assert.equal(prePrepareReaped.reconciliationRequired, 1);
    assert.deepEqual(
      (await db.query(
        `select status, error_message, worker_token_id, claim_token,
                lease_expires_at, prepared_credential_id,
                credential_refresh_recovery_vault_id::text as recovery_vault_id,
                credential_refresh_in_flight, provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        status: "reconciliation_required",
        error_message: "Gateway write lease expired; provider outcome requires reconciliation.",
        worker_token_id: null,
        claim_token: null,
        lease_expires_at: null,
        prepared_credential_id: null,
        recovery_vault_id: recoveryVaultId,
        credential_refresh_in_flight: false,
        provider_mutation_started_at: null,
      }],
      "the ordinary reaper must preserve the exact pre-prepare snapshot",
    );

    const claim = await scalar(
      db,
      `select public.sellerpilot_service_claim_exact_lazada_recovery(
        $1, $2, 'test/reclaim-after-pre-prepare-reaper'
      )`,
      [recoveryTokenHash, exactJobId],
    );
    assert.equal(claim.status, "claimed");
    assert.notEqual(claim.claim_token, expiredClaim.claim_token);
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      1,
    );
    // Even if another privileged caller incorrectly marks this read as a
    // provider mutation during the remote-read window, preparation fails
    // closed and leaves the snapshot intact. Roll the synthetic marker back
    // so the legitimate read-only recovery can continue in this fixture.
    await db.exec("begin");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1, $2, $3)",
        [recoveryTokenHash, exactJobId, claim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_prepare_exact_lazada_recovery(
          $1, $2, $3, $4::jsonb
        )`,
        [
          recoveryTokenHash,
          exactJobId,
          claim.claim_token,
          JSON.stringify({
            code: "0",
            data: { seller_id: "1001", short_code: "MYSHOP1", status: "ACTIVE" },
          }),
        ],
      ),
      { status: "state_mismatch" },
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      1,
    );
    await db.exec("rollback");

    const mismatched = await scalar(
      db,
      `select public.sellerpilot_service_prepare_exact_lazada_recovery(
        $1, $2, $3, $4::jsonb
      )`,
      [
        recoveryTokenHash,
        exactJobId,
        claim.claim_token,
        JSON.stringify({
          code: "0",
          data: { seller_id: "9999", short_code: "MYSHOP1", status: "ACTIVE" },
        }),
      ],
    );
    assert.deepEqual(mismatched, { status: "identity_mismatch" });
    assert.deepEqual(
      (await db.query(
        `select credential_id::text, prepared_credential_id,
                credential_refresh_recovery_vault_id::text as recovery_vault_id,
                credential_refresh_in_flight, provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        credential_id: versionFiveCredentialId,
        prepared_credential_id: null,
        recovery_vault_id: recoveryVaultId,
        credential_refresh_in_flight: false,
        provider_mutation_started_at: null,
      }],
    );

    // Match an opaque sb_secret_* service request: database authorization is
    // service-only, but this legacy JWT GUC is absent. Certification must come
    // from the exact live claim marker installed by migration 54851.
    await db.query("select set_config('request.jwt.claim.role', '', false)");
    const prepared = await scalar(
      db,
      `select public.sellerpilot_service_prepare_exact_lazada_recovery(
        $1, $2, $3, $4::jsonb
      )`,
      [
        recoveryTokenHash,
        exactJobId,
        claim.claim_token,
        JSON.stringify({
          code: "0",
          data: { seller_id: "1001", short_code: "MYSHOP1", status: "ACTIVE" },
        }),
      ],
    );
    assert.equal(prepared.status, "prepared");
    const versionSixCredentialId = prepared.credentialId;
    assert.match(versionSixCredentialId, /^[0-9a-f-]{36}$/);

    const expectedSubject = `lazada:v1:${Buffer.from(JSON.stringify([
      "seller_center",
      [["my", "1001", "2001"]],
    ]), "utf8").toString("base64url")}`;
    const expectedSellerAccountKey = createHash("sha256")
      .update(`lazada\x1fproduction\x1f${expectedSubject}`, "utf8")
      .digest("hex");
    const preparedState = (await db.query(
      `select credential.id::text, credential.version, credential.status,
              credential.seller_account_key,
              credential.seller_account_key_source,
              credential.seller_account_verified_at is not null as seller_verified,
              credential.last_check_status,
              secret.decrypted_secret::jsonb->>'provider_account_subject' as provider_subject,
              secret.decrypted_secret::jsonb->>'provider_account_identity_version' as identity_version,
              secret.decrypted_secret::jsonb->>'account_platform' as account_platform,
              secret.decrypted_secret::jsonb#>>'{country_user_info,0,short_code}' as short_code
         from sellerpilot_private.channel_credentials credential
         join vault.decrypted_secrets secret on secret.id = credential.vault_secret_id
        where credential.id = $1`,
      [versionSixCredentialId],
    )).rows[0];
    assert.equal(preparedState.version, 6);
    assert.equal(preparedState.status, "active");
    assert.equal(preparedState.seller_account_key, expectedSellerAccountKey);
    assert.equal(preparedState.seller_account_key_source, "provider_certified_v1");
    assert.equal(preparedState.seller_verified, true);
    assert.equal(preparedState.last_check_status, "passed");
    assert.equal(preparedState.provider_subject, expectedSubject);
    assert.equal(preparedState.identity_version, "v1");
    assert.equal(preparedState.account_platform, "seller_center");
    assert.equal(preparedState.short_code, "MYSHOP1");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_credentials where id = $1",
        [versionFiveCredentialId],
      ),
      "revoked",
    );
    assert.deepEqual(
      (await db.query(
        `select credential_id::text, prepared_credential_id::text,
                credential_refresh_recovery_vault_id,
                credential_refresh_recovery_fingerprint,
                credential_refresh_recovery_staged_at,
                credential_refresh_in_flight, credential_refresh_started_at,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        credential_id: versionSixCredentialId,
        prepared_credential_id: versionSixCredentialId,
        credential_refresh_recovery_vault_id: null,
        credential_refresh_recovery_fingerprint: null,
        credential_refresh_recovery_staged_at: null,
        credential_refresh_in_flight: false,
        credential_refresh_started_at: null,
        provider_mutation_started_at: null,
      }],
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      0,
      "the exact snapshot is deleted only by the atomic certified rotation",
    );

    // If the prepare RPC committed but its HTTP acknowledgement was lost, the
    // ordinary lease reaper sees a certified v6, no recovery snapshot, and no
    // provider mutation. It safely queues this same read instead of creating a
    // second credential or returning it to reconciliation. Roll back this
    // simulated timeout so the normal finish path can be asserted below too.
    await db.exec("begin");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set lease_expires_at = clock_timestamp() - interval '1 second'
        where id = $1`,
      [exactJobId],
    );
    const reaped = await scalar(
      db,
      "select public.sellerpilot_service_reap_stale_channel_gateway_jobs(10)",
    );
    assert.equal(reaped.retried, 1);
    assert.equal(reaped.reconciliationRequired, 0);
    assert.deepEqual(
      (await db.query(
        `select status, credential_id::text, prepared_credential_id::text,
                error_message, credential_refresh_recovery_vault_id,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        status: "queued",
        credential_id: versionSixCredentialId,
        prepared_credential_id: versionSixCredentialId,
        error_message: null,
        credential_refresh_recovery_vault_id: null,
        provider_mutation_started_at: null,
      }],
    );
    await db.exec("rollback");

    const finished = await scalar(
      db,
      `select public.sellerpilot_service_finish_exact_lazada_recovery(
        $1, $2, $3
      )`,
      [recoveryTokenHash, exactJobId, claim.claim_token],
    );
    assert.equal(finished.status, "requeued");
    assert.match(finished.replacementJobId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      (await db.query(
        `select status, error_message, worker_token_id, claim_token,
                lease_expires_at, provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [exactJobId],
      )).rows,
      [{
        status: "cancelled",
        error_message: "LAZADA_CREDENTIAL_RECOVERED_READ_REQUEUED",
        worker_token_id: null,
        claim_token: null,
        lease_expires_at: null,
        provider_mutation_started_at: null,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select credential_id::text, channel, operation, environment, status,
                seller_account_key, request_payload->>'periodicKey' as periodic_key,
                request_payload->>'credentialRecoverySourceJobId' as source_job_id
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [finished.replacementJobId],
      )).rows,
      [{
        credential_id: versionSixCredentialId,
        channel: "lazada",
        operation: "orders.list",
        environment: "production",
        status: "queued",
        seller_account_key: preparedState.seller_account_key,
        periodic_key: "orders",
        source_job_id: exactJobId,
      }],
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_finish_exact_lazada_recovery(
          $1, $2, $3
        )`,
        [recoveryTokenHash, exactJobId, claim.claim_token],
      ),
      { status: "state_mismatch" },
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.channel_gateway_jobs
          where request_payload->>'credentialRecoverySourceJobId' = $1`,
        [exactJobId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where entity_id = $1
            and action = 'lazada_credential_recovery_requeued'`,
        [exactJobId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        `select has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_claim_exact_lazada_recovery(text,uuid,text)',
          'EXECUTE'
        )`,
      ),
      false,
    );
    assert.equal(
      await scalar(
        db,
        `select has_function_privilege(
          'service_role',
          'public.sellerpilot_service_claim_exact_lazada_recovery(text,uuid,text)',
          'EXECUTE'
        )`,
      ),
      true,
    );

    const replacementClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'test/replacement')",
      [recoveryTokenHash],
    );
    assert.equal(replacementClaim.id, finished.replacementJobId);
    assert.equal(replacementClaim.operation, "orders.list");
    assert.equal(replacementClaim.credential_id, versionSixCredentialId);
  } finally {
    await db.close();
  }
});

test("rejected Lazada recovery cleanup is bound to one unclaimed OAuth discard", async () => {
  const migration = await readFile(new URL(
    "../supabase/migrations/20260830171000_discard_rejected_lazada_recovery_for_oauth.sql",
    import.meta.url,
  ), "utf8");

  assert.match(
    migration,
    /5ac7a12f-94d5-451f-bd47-3b07d86c21b8[\s\S]*705b572c-1e08-4f56-a74a-bc1fb53175ae/,
  );
  assert.match(
    migration,
    /LAZADA_RECOVERY_SNAPSHOT_REJECTED[\s\S]*provider_mutation_started_at is null/,
  );
  assert.match(
    migration,
    /observed Lazada OAuth exchange no longer matches exact unclaimed evidence/,
  );
  assert.match(
    migration,
    /clock_timestamp\(\) < v_oauth_created_at \+ interval '25 minutes'/,
  );
  assert.match(
    migration,
    /'payload', v_recovery_secret[\s\S]*'recovery_only', true[\s\S]*v_recovery_snapshot_sha256 is distinct from[\s\S]*credential_refresh_recovery_fingerprint/,
  );
  assert.match(
    migration,
    /'channel', 'lazada'[\s\S]*'code', trim\(v_oauth_secret->>'code'\)[\s\S]*v_oauth_fingerprint is distinct from[\s\S]*oauth_request_fingerprint/,
  );
  assert.match(
    migration,
    /delete from vault\.secrets secret[\s\S]*secret\.id = v_recovery_vault_id[\s\S]*delete from vault\.secrets secret[\s\S]*secret\.id = v_oauth_vault_id/,
  );
  assert.match(
    migration,
    /lock table vault\.secrets[\s\S]*in share row exclusive mode/,
  );
  assert.ok(
    migration.indexOf("lock table vault.secrets") <
      migration.indexOf("from vault.secrets secret"),
    "the Vault table lock must precede the first Vault read",
  );
  assert.doesNotMatch(migration, /for update of secret/);
  assert.match(
    migration,
    /lazada_rejected_recovery_discarded_for_reauthorization[\s\S]*recovery_snapshot_discarded', true[\s\S]*oauth_code_discarded', true/,
  );
  assert.match(
    migration,
    /lazada_oauth_discarded_outside_safe_window[\s\S]*oauth_code_sent_to_provider', false/,
  );
  assert.match(
    migration,
    /provider_mutation_started', false[\s\S]*credential_rotated_during_cleanup', false/,
  );
  assert.match(
    migration,
    /v_recovery_job\.created_by is distinct from v_oauth_job\.created_by[\s\S]*v_source_credential\.created_by/,
  );
  assert.match(
    migration,
    /jsonb_object_keys\(audit\.safe_detail\)[\s\S]*\) = 17[\s\S]*jsonb_object_keys\(audit\.safe_detail\)[\s\S]*\) = 11/,
  );
  assert.match(
    migration,
    /runtime_first_seller_reauthorization[\s\S]*runtime_inactive_outside_safe_window/,
  );
  assert.doesNotMatch(
    migration,
    /update sellerpilot_private\.channel_credentials[\s\S]*set status/,
  );
});

test("rejected Lazada recovery cleanup discards both exact unusable snapshots", async () => {
  const db = new PGlite();
  const migrationName =
    "20260830171000_discard_rejected_lazada_recovery_for_oauth.sql";
  const recoveryJobId = "5ac7a12f-94d5-451f-bd47-3b07d86c21b8";
  const freshOauthJobId = "705b572c-1e08-4f56-a74a-bc1fb53175ae";
  const recoveryVaultId = "312705aa-9a16-4c2e-bc3a-32e743ec41e6";
  const productionOauthVaultId = "d5462aa4-bc3d-4258-8f6a-e0b19d6cef79";
  const productionCredentialId = "e54fa95d-ddfd-414f-82e9-636a0d9ab07c";
  const productionRecoverySha =
    "ba9a002eeee680dc5224aff75a3797f2c0e643b21f8433768c7684db11adf8c5";
  const productionOauthSha =
    "80195afdac6cc858bc28a90503910ef16f1ae1cfd80e906a3206e8d5192b475d";
  const productionOauthCreatedAt = "2026-08-30T07:49:58.027035Z";
  const recoveryRequest = { arguments: {} };
  const oauthRequest = { vaultBacked: true };
  const recoveryExpiresAt = "2099-01-01T00:00:00.000Z";
  const recoveryPayload = {
    access_token: "rejected-access-token-fixture",
    refresh_token: "rejected-refresh-token-fixture",
    refresh_token_expires_at: recoveryExpiresAt,
  };
  const oauthCode = "fresh-lazada-authorization-code";
  const oauthCreatedAt = new Date(Date.now() - 26 * 60_000).toISOString();
  const serverlessTokenHash = "9".repeat(64);

  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      if (name === migrationName) continue;
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(source));
    }

    await db.query(
      "insert into auth.users (id, email) values ($1, 'lazada-cleanup@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into auth.users (id, email) values ($1, 'lazada-cleanup-other@example.test')",
      [SECOND_ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Lazada Cleanup Admin')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Other Cleanup Admin')",
      [SECOND_ADMIN_ID],
    );
    await setClaims(db);

    let versionFiveCredentialId;
    for (let version = 1; version <= 5; version += 1) {
      versionFiveCredentialId = await scalar(
        db,
        `select public.sellerpilot_rotate_credential(
          'lazada', 'production', $1::jsonb,
          '2099-01-01T00:00:00.000Z'::timestamptz,
          90, 30, 0
        )`,
        [JSON.stringify({
          app_key: "cleanup-app",
          app_secret: "cleanup-secret",
          country: "my",
          access_token: `cleanup-access-v${version}`,
          refresh_token: `cleanup-refresh-v${version}`,
        })],
      );
    }

    await setClaims(db, "service_role");
    await db.query(
      `insert into vault.secrets (id, secret, name, description)
       values ($1, $2, $3, 'Exact rejected recovery fixture.')`,
      [
        recoveryVaultId,
        JSON.stringify(recoveryPayload),
        `sellerpilot_gateway_recovery_lazada_${recoveryJobId}_fixture`,
      ],
    );
    const freshOauthVaultId = await scalar(
      db,
      `select vault.create_secret($1, $2, 'Fresh OAuth fixture.')`,
      [
        JSON.stringify({ code: oauthCode }),
        `sellerpilot_gateway_oauth_${freshOauthJobId}_fixture`,
      ],
    );
    const recoveryRequestSha = await scalar(
      db,
      "select encode(extensions.digest($1::jsonb::text, 'sha256'), 'hex')",
      [JSON.stringify(recoveryRequest)],
    );
    const oauthRequestSha = await scalar(
      db,
      "select encode(extensions.digest($1::jsonb::text, 'sha256'), 'hex')",
      [JSON.stringify(oauthRequest)],
    );
    const recoveryFingerprint = await scalar(
      db,
      `select encode(extensions.digest(
        jsonb_build_object(
          'payload', $1::jsonb,
          'expires_at', $2::timestamptz,
          'recovery_only', true
        )::text,
        'sha256'
      ), 'hex')`,
      [JSON.stringify(recoveryPayload), recoveryExpiresAt],
    );
    const oauthFingerprint = await scalar(
      db,
      `select encode(extensions.digest(
        jsonb_build_object(
          'channel', 'lazada',
          'code', trim($1)
        )::text,
        'sha256'
      ), 'hex')`,
      [oauthCode],
    );

    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, channel, operation, environment, request_payload,
         status, error_message, created_by, attempt_count, created_at,
         started_at, completed_at, updated_at,
         credential_refresh_recovery_vault_id,
         credential_refresh_recovery_fingerprint,
         credential_refresh_recovery_staged_at
       ) values (
         $1, $2, 'lazada', 'orders.list', 'production', $3::jsonb,
         'reconciliation_required', 'LAZADA_RECOVERY_SNAPSHOT_REJECTED',
         $4, 1, '2026-08-25T12:54:05.823863Z'::timestamptz,
         '2026-08-25T12:54:41.356793Z'::timestamptz,
         '2026-08-30T07:42:13.312764Z'::timestamptz,
         '2026-08-30T07:42:13.312764Z'::timestamptz,
         $5, $6,
         '2026-08-25T12:54:43.000000Z'::timestamptz
       )`,
      [
        recoveryJobId,
        versionFiveCredentialId,
        JSON.stringify(recoveryRequest),
        ADMIN_ID,
        recoveryVaultId,
        recoveryFingerprint,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, channel, operation, environment, request_payload,
         status, created_by, attempt_count, created_at, updated_at,
         oauth_request_vault_id, oauth_request_fingerprint,
         oauth_source_credential_id
       ) values (
         $1, $2, 'lazada', 'oauth.exchange', 'production', $3::jsonb,
         'queued', $4, 0,
         $6::timestamptz,
         $6::timestamptz,
         $5, $7, $2
       )`,
      [
        freshOauthJobId,
        versionFiveCredentialId,
        JSON.stringify(oauthRequest),
        ADMIN_ID,
        freshOauthVaultId,
        oauthCreatedAt,
        oauthFingerprint,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.operation_audit (
         owner_id, action, entity_type, entity_id, safe_detail, occurred_at
       ) values
       ($1, 'lazada_credential_recovery_claimed', 'channel_gateway_job', $2,
        jsonb_build_object(
          'recovery_snapshot_sha256', $3::text,
          'provider_mutation_started', false
        ),
        '2026-08-30T07:42:09Z'::timestamptz),
       ($1, 'lazada_credential_recovery_preserved', 'channel_gateway_job', $2,
        '{"reason":"snapshot_rejected","recovery_snapshot_preserved":true,"provider_mutation_started":false}'::jsonb,
        '2026-08-30T07:42:13Z'::timestamptz)`,
      [ADMIN_ID, recoveryJobId, recoveryFingerprint],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values (
         'exact OAuth unblock probe', $1, '999999999999', 'active',
         'serverless_cs', clock_timestamp() + interval '1 day', $2
       )`,
      [serverlessTokenHash, ADMIN_ID],
    );

    const migrationSource = await readFile(new URL(migrationName, migrationUrl), "utf8");
    const renderMigration = (createdAt) => migrationSource
      .replaceAll(productionCredentialId, versionFiveCredentialId)
      .replaceAll(productionRecoverySha, recoveryRequestSha)
      .replaceAll(productionOauthSha, oauthRequestSha)
      .replaceAll(productionOauthVaultId, freshOauthVaultId)
      .replaceAll(productionOauthCreatedAt, createdAt);
    const migration = renderMigration(oauthCreatedAt);

    const safeWindowCreatedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_at = $2::timestamptz,
              updated_at = $2::timestamptz
        where id = $1`,
      [freshOauthJobId, safeWindowCreatedAt],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(renderMigration(safeWindowCreatedAt))),
      /observed Lazada OAuth exchange no longer matches exact unclaimed evidence/,
      "a still-fresh authorization code must not be discarded",
    );
    await db.exec("rollback");
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id in ($1, $2)", [
        recoveryVaultId,
        freshOauthVaultId,
      ]),
      2,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_at = $2::timestamptz,
              updated_at = $2::timestamptz
        where id = $1`,
      [freshOauthJobId, oauthCreatedAt],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_by = $2
        where id = $1`,
      [freshOauthJobId, SECOND_ADMIN_ID],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /Lazada rejected recovery cleanup evidence is incomplete/,
      "cross-owner OAuth evidence must not be discarded",
    );
    await db.exec("rollback");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_by = $2
        where id = $1`,
      [freshOauthJobId, ADMIN_ID],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set oauth_request_fingerprint = repeat('c', 64)
        where id = $1`,
      [freshOauthJobId],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /observed Lazada OAuth exchange no longer matches exact unclaimed evidence/,
    );
    await db.exec("rollback");
    assert.equal(
      await scalar(
        db,
        "select status from sellerpilot_private.channel_gateway_jobs where id = $1",
        [recoveryJobId],
      ),
      "reconciliation_required",
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      1,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set oauth_request_fingerprint = $2
        where id = $1`,
      [freshOauthJobId, oauthFingerprint],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_recovery_fingerprint = repeat('d', 64)
        where id = $1`,
      [recoveryJobId],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /observed Lazada recovery no longer matches exact rejected evidence/,
    );
    await db.exec("rollback");
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
            and entity_id = $1`,
        [recoveryJobId],
      ),
      0,
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_recovery_fingerprint = $2
        where id = $1`,
      [recoveryJobId, recoveryFingerprint],
    );

    await db.exec(withoutUnavailableExtensions(migration));

    assert.deepEqual(
      (await db.query(
        `select status, error_message,
                credential_refresh_recovery_vault_id,
                credential_refresh_recovery_fingerprint,
                credential_refresh_recovery_staged_at,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [recoveryJobId],
      )).rows,
      [{
        status: "cancelled",
        error_message: "LAZADA_REJECTED_RECOVERY_DISCARDED_FOR_REAUTHORIZATION",
        credential_refresh_recovery_vault_id: null,
        credential_refresh_recovery_fingerprint: null,
        credential_refresh_recovery_staged_at: null,
        provider_mutation_started_at: null,
      }],
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [recoveryVaultId]),
      0,
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [freshOauthVaultId]),
      0,
    );
    assert.deepEqual(
      (await db.query(
        `select status, error_message, attempt_count, oauth_request_vault_id::text,
                oauth_exchange_completed, provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [freshOauthJobId],
      )).rows,
      [{
        status: "cancelled",
        error_message: "LAZADA_OAUTH_CODE_DISCARDED_OUTSIDE_SAFE_WINDOW",
        attempt_count: 0,
        oauth_request_vault_id: null,
        oauth_exchange_completed: false,
        provider_mutation_started_at: null,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select version, status, seller_account_key_source,
                seller_account_verified_at
           from sellerpilot_private.channel_credentials
          where id = $1`,
        [versionFiveCredentialId],
      )).rows,
      [{
        version: 5,
        status: "active",
        seller_account_key_source: "legacy_unattested",
        seller_account_verified_at: null,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
            and entity_id = $1
            and safe_detail->>'fresh_oauth_job_id' = $2
            and safe_detail->>'provider_mutation_started' = 'false'
            and safe_detail->>'recovery_snapshot_discarded' = 'true'`,
        [recoveryJobId, freshOauthJobId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_oauth_discarded_outside_safe_window'
            and entity_id = $1
            and safe_detail->>'oauth_code_sent_to_provider' = 'false'
            and safe_detail->>'provider_mutation_started' = 'false'`,
        [freshOauthJobId],
      ),
      1,
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message = 'TAMPERED_TERMINAL_EVIDENCE'
        where id = $1`,
      [recoveryJobId],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /exact Lazada cleanup no longer matches terminal evidence/,
    );
    await db.exec("rollback");
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set error_message = 'LAZADA_REJECTED_RECOVERY_DISCARDED_FOR_REAUTHORIZATION'
        where id = $1`,
      [recoveryJobId],
    );

    await db.query(
      `update sellerpilot_private.operation_audit
          set safe_detail = safe_detail || '{"unexpected":true}'::jsonb
        where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
          and entity_id = $1`,
      [recoveryJobId],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /exact Lazada cleanup no longer matches terminal evidence/,
      "terminal audit key sets must remain exact",
    );
    await db.exec("rollback");
    await db.query(
      `update sellerpilot_private.operation_audit
          set safe_detail = safe_detail - 'unexpected'
        where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
          and entity_id = $1`,
      [recoveryJobId],
    );

    await db.query(
      `update sellerpilot_private.operation_audit
          set safe_detail = jsonb_set(
            safe_detail,
            '{reason}',
            '"tampered-replay-reason"'::jsonb
          )
        where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
          and entity_id = $1`,
      [recoveryJobId],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /exact Lazada cleanup no longer matches terminal evidence/,
      "terminal audit values must remain exact when the key count is unchanged",
    );
    await db.exec("rollback");
    await db.query(
      `update sellerpilot_private.operation_audit
          set safe_detail = jsonb_set(
            safe_detail,
            '{reason}',
            '"runtime_first_seller_reauthorization"'::jsonb
          )
        where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
          and entity_id = $1`,
      [recoveryJobId],
    );

    await db.query(
      `insert into sellerpilot_private.operation_audit (
         owner_id, action, entity_type, entity_id, safe_detail, occurred_at
       ) values (
         $1, 'lazada_rejected_recovery_discarded_for_reauthorization',
         'channel_gateway_job', $2, '{}'::jsonb, clock_timestamp()
       )`,
      [ADMIN_ID, recoveryJobId],
    );
    await assert.rejects(
      db.exec(withoutUnavailableExtensions(migration)),
      /exact Lazada cleanup no longer matches terminal evidence/,
      "a contradictory duplicate terminal audit must fail replay",
    );
    await db.exec("rollback");
    await db.query(
      `delete from sellerpilot_private.operation_audit
        where owner_id = $1
          and action = 'lazada_rejected_recovery_discarded_for_reauthorization'
          and entity_id = $2
          and safe_detail = '{}'::jsonb`,
      [ADMIN_ID, recoveryJobId],
    );

    await db.exec(withoutUnavailableExtensions(migration));
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_rejected_recovery_discarded_for_reauthorization'
            and entity_id = $1`,
        [recoveryJobId],
      ),
      1,
      "replaying the migration must accept only its exact terminal evidence",
    );

    const terminalEvidence = JSON.stringify((await db.query(
      `select job.error_message, audit.safe_detail
         from sellerpilot_private.channel_gateway_jobs job
         join sellerpilot_private.operation_audit audit
           on audit.entity_id = job.id::text
          and audit.action in (
            'lazada_rejected_recovery_discarded_for_reauthorization',
            'lazada_oauth_discarded_outside_safe_window'
          )
        where job.id in ($1, $2)`,
      [recoveryJobId, freshOauthJobId],
    )).rows);
    assert.doesNotMatch(terminalEvidence, /rejected-access-token-fixture/);
    assert.doesNotMatch(terminalEvidence, /rejected-refresh-token-fixture/);
    assert.doesNotMatch(terminalEvidence, /fresh-lazada-authorization-code/);

    const oauthClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/no-expired-oauth-claim')",
      [serverlessTokenHash],
    );
    assert.equal(oauthClaim, null);
  } finally {
    await db.close();
  }
});

test("fresh certified Lazada OAuth supersedes only one safe older read refresh", async () => {
  const db = new PGlite();
  const migrationName =
    "20260830183000_allow_fresh_lazada_oauth_past_safe_refresh_reconciliation.sql";
  const blockerJobId = "a976573f-a150-4061-a1c6-5e8e4880ba2b";
  const tokenHash = "7".repeat(64);
  const staleCode = "stale-unclaimed-lazada-oauth-code";
  const failedCode = "fresh-definite-failure-lazada-code";
  const enqueueStaleCode = "stale-lazada-code-before-new-callback";
  const successCode = "fresh-provider-certified-lazada-code";
  const providerSubject = `lazada:v1:${"A".repeat(64)}`;
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.equal(migrationNames.includes(migrationName), true);
    for (const name of migrationNames) {
      if (
        name === QOO10_EXACT_S1_PROVIDER_BOUNDARY_MIGRATION
        || name === QOO10_FAILED_PREPROVIDER_PERMIT_RETIREMENT_MIGRATION
      ) continue;
      const source = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(source));
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'sellerpilot_private.safe_lazada_oauth_refresh_blocker(uuid)', 'EXECUTE')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'sellerpilot_private.safe_lazada_oauth_claim_blocker(uuid)', 'EXECUTE')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'sellerpilot_private.discard_stale_unclaimed_lazada_oauth(uuid,text)', 'EXECUTE')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, 'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)', 'EXECUTE')",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', 'public.sellerpilot_claim_serverless_gateway_job(text,text)', 'EXECUTE')",
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) = 1 from pg_catalog.pg_trigger
          where tgrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
            and tgname = 'supersede_safe_lazada_refresh_after_oauth'
            and not tgisinternal`,
      ),
      true,
    );
    const safeLazadaClaimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure)",
    );
    assert.match(
      safeLazadaClaimDefinition,
      /lock table sellerpilot_private\.channel_gateway_jobs[\s\S]*lock table sellerpilot_private\.channel_credentials[\s\S]*lock table vault\.secrets/i,
    );
    assert.match(
      safeLazadaClaimDefinition,
      /lock table sellerpilot_private\.gateway_completion_receipts[\s\S]*select oauth\.id/i,
      "receipt evidence must be fenced before candidate selection",
    );
    assert.match(
      safeLazadaClaimDefinition,
      /sellerpilot_204000_claim_serverless_gateway_unsafe/i,
    );
    const priorSafeLazadaClaimDefinition = await scalar(
      db,
      "select pg_get_functiondef('public.sellerpilot_204000_claim_serverless_gateway_unsafe(text,text)'::regprocedure)",
    );
    assert.ok(
      (priorSafeLazadaClaimDefinition.match(/safe_lazada_oauth_claim_blocker/g) ?? [])
        .length >= 3,
      "the delegated claimant must recheck the exact OAuth predicate before and after all claim fences",
    );
    const safeLazadaCandidateDefinition = await scalar(
      db,
      "select pg_get_functiondef('sellerpilot_private.safe_lazada_oauth_claim_blocker(uuid)'::regprocedure)",
    );
    assert.equal(
      await scalar(
        db,
        `select provolatile
           from pg_catalog.pg_proc
          where oid = 'sellerpilot_private.safe_lazada_oauth_claim_blocker(uuid)'::regprocedure`,
      ),
      "v",
    );
    assert.match(safeLazadaCandidateDefinition, /pg_catalog\.left/i);
    assert.match(safeLazadaCandidateDefinition, /pg_catalog\.right/i);
    assert.doesNotMatch(safeLazadaCandidateDefinition, /secret\.name\s+like/i);

    await db.query(
      "insert into auth.users (id, email) values ($1, 'safe-lazada-oauth@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Safe Lazada OAuth Admin')",
      [ADMIN_ID],
    );
    await setClaims(db, "service_role");
    const sourceCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'lazada', 'production', $1::jsonb,
        '2099-01-01T00:00:00Z'::timestamptz, 90, 30, 0
      )`,
      [JSON.stringify({
        app_key: "safe-lazada-app",
        app_secret: "safe-lazada-secret",
        country: "my",
        access_token: "legacy-lazada-access-token",
        refresh_token: "legacy-lazada-refresh-token",
        provider_account_subject: providerSubject,
        provider_account_identity_version: "v1",
      })],
    );
    const sourceIdentity = (await db.query(
      `select seller_account_key, seller_account_key_source,
              seller_account_verified_at is not null as provider_certified
         from sellerpilot_private.channel_credentials
        where id=$1`,
      [sourceCredentialId],
    )).rows[0];
    assert.match(sourceIdentity.seller_account_key, /^[a-f0-9]{64}$/);
    assert.equal(sourceIdentity.seller_account_key_source, "provider_certified_v1");
    assert.equal(sourceIdentity.provider_certified, true);

    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values (
         'safe Lazada OAuth claim', $1, '777777777777', 'active',
         'serverless_cs', clock_timestamp() + interval '1 day', $2
       )`,
      [tokenHash, ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, channel, operation, environment, request_payload,
         status, error_message, created_by, attempt_count,
         created_at, started_at, completed_at, updated_at,
         credential_refresh_in_flight, credential_refresh_started_at
       ) values (
         $1, $2, 'lazada', 'orders.list', 'production',
         '{"arguments":{"queryParams":{"limit":"50"}}}'::jsonb,
         'reconciliation_required', 'serverless_cs_execution_failed', $3, 1,
         clock_timestamp() - interval '20 minutes',
         clock_timestamp() - interval '10 minutes',
         clock_timestamp() - interval '5 minutes',
         clock_timestamp() - interval '5 minutes',
         true, clock_timestamp() - interval '9 minutes'
       )`,
      [blockerJobId, sourceCredentialId, ADMIN_ID],
    );

    const staleJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'oauth.exchange', jsonb_build_object('code', $2::text)
      )`,
      [sourceCredentialId, staleCode],
    );
    const staleVaultId = await scalar(
      db,
      "select oauth_request_vault_id from sellerpilot_private.channel_gateway_jobs where id = $1",
      [staleJobId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_at = clock_timestamp() - interval '26 minutes',
              updated_at = clock_timestamp() - interval '26 minutes'
        where id = $1`,
      [staleJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/stale-lazada-oauth')",
        [tokenHash],
      ),
      null,
    );
    assert.deepEqual(
      (await db.query(
        `select status, error_message, oauth_request_vault_id
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [staleJobId],
      )).rows,
      [{
        status: "cancelled",
        error_message: "LAZADA_OAUTH_CODE_DISCARDED_OUTSIDE_SAFE_WINDOW",
        oauth_request_vault_id: null,
      }],
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where id = $1", [staleVaultId]),
      0,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_stale_unclaimed_oauth_discarded'
            and entity_id = $1
            and safe_detail->>'provider_call_started' = 'false'
            and safe_detail->>'provider_mutation_started' = 'false'
            and safe_detail->>'oauth_code_discarded' = 'true'`,
        [staleJobId],
      ),
      1,
    );

    // A stale OAuth row whose Vault material is already missing is not safe to
    // auto-delete. It must continue to block Lazada, but the shared claimant
    // must still advance an unrelated channel instead of returning global
    // idle forever.
    await setClaims(db);
    const unrelatedCredentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'shopee', 'production', $1::jsonb,
        '2099-01-01T00:00:00Z'::timestamptz, 90, 30, 0
      )`,
      [JSON.stringify({
        partner_id: "2031489",
        partner_key: "unrelated-shopee-partner-key",
        shop_id: "123456789",
        access_token: "unrelated-shopee-access-token",
        refresh_token: "unrelated-shopee-refresh-token",
      })],
    );
    await setClaims(db, "service_role");
    const malformedStaleJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'oauth.exchange',
        jsonb_build_object('code', 'malformed-stale-lazada-code')
      )`,
      [sourceCredentialId],
    );
    const malformedStaleVaultId = await scalar(
      db,
      `select oauth_request_vault_id
         from sellerpilot_private.channel_gateway_jobs where id = $1`,
      [malformedStaleJobId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_at = clock_timestamp() - interval '26 minutes',
              updated_at = clock_timestamp() - interval '26 minutes'
        where id = $1`,
      [malformedStaleJobId],
    );
    await db.query("delete from vault.secrets where id = $1", [malformedStaleVaultId]);
    await db.query(
      `update sellerpilot_private.serverless_static_egress_policy
          set enabled = true, updated_at = clock_timestamp()
        where channel = 'shopee'`,
    );
    await scalar(
      db,
      `select set_config(
        'request.headers',
        '{"x-sellerpilot-static-egress-channels":"shopee"}',
        false
      )`,
    );
    const unrelatedJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'shopee', 'diagnostic.test', '{}'::jsonb
      )`,
      [unrelatedCredentialId],
    );
    const unrelatedClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/unrelated-after-malformed-stale')",
      [tokenHash],
    );
    assert.equal(
      unrelatedClaim.id,
      unrelatedJobId,
      "an unsafe stale Lazada row must not starve unrelated channel claims",
    );
    assert.equal(unrelatedClaim.channel, "shopee");
    assert.equal(
      (await scalar(
        db,
        `select public.sellerpilot_service_complete_serverless_cs_transaction(
          $1, $2, $3, 'failed', null, 'synthetic unrelated completion',
          null, null, null, null
        )`,
        [tokenHash, unrelatedJobId, unrelatedClaim.claim_token],
      )).status,
      "completed",
    );
    assert.equal(
      await scalar(
        db,
        `select status from sellerpilot_private.channel_gateway_jobs
          where id = $1`,
        [malformedStaleJobId],
      ),
      "queued",
      "unsafe stale Lazada evidence must remain untouched",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'cancelled', oauth_request_vault_id = null,
              error_message = 'synthetic malformed stale cleanup',
              completed_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = $1 and status = 'queued'`,
      [malformedStaleJobId],
    );

    const failedJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'oauth.exchange', jsonb_build_object('code', $2::text)
      )`,
      [sourceCredentialId, failedCode],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_started_at = started_at - interval '1 second'
        where id = $1`,
      [blockerJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/impossible-lazada-refresh-chronology')",
        [tokenHash],
      ),
      null,
      "a refresh marker predating its claimed job must never qualify as safe",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set credential_refresh_started_at = started_at + interval '1 minute'
        where id = $1`,
      [blockerJobId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set provider_mutation_started_at = clock_timestamp()
        where id = $1`,
      [blockerJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/unsafe-lazada-blocker')",
        [tokenHash],
      ),
      null,
      "a provider mutation marker must keep the original global fence closed",
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, worker_token_id, claim_token
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [failedJobId],
      )).rows,
      [{
        status: "queued",
        attempt_count: 0,
        worker_token_id: null,
        claim_token: null,
      }],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set provider_mutation_started_at = null
        where id = $1`,
      [blockerJobId],
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.safe_lazada_oauth_refresh_blocker($1)",
        [failedJobId],
      ),
      blockerJobId,
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.safe_lazada_oauth_claim_blocker($1)",
        [failedJobId],
      ),
      blockerJobId,
    );
    const failedClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/failed-lazada-oauth')",
      [tokenHash],
    );
    assert.equal(failedClaim.id, failedJobId);
    assert.equal(failedClaim.operation, "oauth.exchange");
    assert.equal(failedClaim.request.code, failedCode);
    assert.equal(
      (await scalar(
        db,
        `select public.sellerpilot_service_complete_serverless_cs_transaction(
          $1, $2, $3, 'failed', null, 'provider_rejected_before_exchange',
          null, null, null, null
        )`,
        [tokenHash, failedJobId, failedClaim.claim_token],
      )).status,
      "completed",
    );
    assert.deepEqual(
      (await db.query(
        `select status, credential_refresh_in_flight
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [blockerJobId],
      )).rows,
      [{ status: "reconciliation_required", credential_refresh_in_flight: true }],
      "a failed OAuth exchange must not clear the older uncertainty",
    );

    const enqueueStaleJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'oauth.exchange', jsonb_build_object('code', $2::text)
      )`,
      [sourceCredentialId, enqueueStaleCode],
    );
    const enqueueStaleVaultId = await scalar(
      db,
      "select oauth_request_vault_id from sellerpilot_private.channel_gateway_jobs where id = $1",
      [enqueueStaleJobId],
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set created_at = clock_timestamp() - interval '26 minutes',
              updated_at = clock_timestamp() - interval '26 minutes'
        where id = $1`,
      [enqueueStaleJobId],
    );
    const successJobId = await scalar(
      db,
      `select public.sellerpilot_enqueue_channel_gateway_job(
        $1, null, 'lazada', 'oauth.exchange', jsonb_build_object('code', $2::text)
      )`,
      [sourceCredentialId, successCode],
    );
    assert.deepEqual(
      (await db.query(
        `select status, error_message, oauth_request_vault_id
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [enqueueStaleJobId],
      )).rows,
      [{
        status: "cancelled",
        error_message: "LAZADA_OAUTH_CODE_DISCARDED_OUTSIDE_SAFE_WINDOW",
        oauth_request_vault_id: null,
      }],
      "a different new callback must release an exact expired enqueue fence",
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from vault.secrets where id = $1",
        [enqueueStaleVaultId],
      ),
      0,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action = 'lazada_stale_unclaimed_oauth_discarded'
            and entity_id = $1
            and safe_detail->>'superseded_by_different_authorization' = 'true'`,
        [enqueueStaleJobId],
      ),
      1,
    );
    const successVault = (await db.query(
      `select job.oauth_request_vault_id as id, secret.name
         from sellerpilot_private.channel_gateway_jobs job
         join vault.secrets secret on secret.id = job.oauth_request_vault_id
        where job.id = $1`,
      [successJobId],
    )).rows[0];
    await db.query(
      "update vault.secrets set name = replace(name, '_', 'X') where id = $1",
      [successVault.id],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/wrong-vault-name')",
        [tokenHash],
      ),
      null,
      "LIKE wildcard lookalikes must never qualify as a Vault-backed OAuth grant",
    );
    assert.deepEqual(
      (await db.query(
        `select status, attempt_count, worker_token_id, claim_token
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [successJobId],
      )).rows,
      [{
        status: "queued",
        attempt_count: 0,
        worker_token_id: null,
        claim_token: null,
      }],
    );
    await db.query(
      "update vault.secrets set name = $2 where id = $1",
      [successVault.id, successVault.name],
    );
    const successClaim = await scalar(
      db,
      "select public.sellerpilot_claim_serverless_gateway_job($1, 'test/success-lazada-oauth')",
      [tokenHash],
    );
    assert.equal(successClaim.id, successJobId);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_serverless_cs_credential_refresh($1,$2,$3)",
        [tokenHash, successJobId, successClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_service_mark_lazada_oauth_provider_call_started(
          $1, $2, $3
        )`,
        [tokenHash, successJobId, successClaim.claim_token],
      ),
      true,
    );
    const refreshPayload = {
      app_key: "safe-lazada-app",
      app_secret: "safe-lazada-secret",
      country: "my",
      access_token: "certified-lazada-access-token",
      refresh_token: "certified-lazada-refresh-token",
      provider_account_subject: providerSubject,
      provider_account_identity_version: "v1",
      country_user_info: [{ country: "my", seller_id: "1001", user_id: "2001" }],
    };
    const completion = await scalar(
      db,
      `select public.sellerpilot_service_complete_serverless_cs_transaction(
        $1, $2, $3, 'succeeded', $4::jsonb, null, $5::jsonb,
        null, null, null
      )`,
      [
        tokenHash,
        successJobId,
        successClaim.claim_token,
        JSON.stringify({
          ok: true,
          channel: "lazada",
          operation: "oauth.exchange",
          safeMessage: "Lazada OAuth exchange completed.",
        }),
        JSON.stringify({
          payload: refreshPayload,
          expiresAt: "2099-01-01T00:00:00Z",
          recoveryOnly: false,
          oauthComplete: true,
        }),
      ],
    );
    assert.equal(completion.status, "completed");

    const successRow = (await db.query(
      `select job.status, job.oauth_exchange_completed,
              job.prepared_credential_id, job.credential_id,
              credential.status as credential_status,
              credential.seller_account_key_source,
              credential.seller_account_verified_at is not null as provider_certified
         from sellerpilot_private.channel_gateway_jobs job
         join sellerpilot_private.channel_credentials credential
           on credential.id = job.credential_id
        where job.id = $1`,
      [successJobId],
    )).rows[0];
    assert.equal(successRow.status, "succeeded");
    assert.equal(successRow.oauth_exchange_completed, true);
    assert.equal(successRow.prepared_credential_id, successRow.credential_id);
    assert.equal(successRow.credential_status, "active");
    assert.equal(successRow.seller_account_key_source, "provider_certified_v1");
    assert.equal(successRow.provider_certified, true);
    assert.deepEqual(
      (await db.query(
        `select status, error_message, credential_refresh_in_flight,
                credential_refresh_started_at, prepared_credential_id,
                credential_refresh_recovery_vault_id,
                provider_mutation_started_at
           from sellerpilot_private.channel_gateway_jobs where id = $1`,
        [blockerJobId],
      )).rows,
      [{
        status: "cancelled",
        error_message:
          "LAZADA_REFRESH_RECONCILIATION_SUPERSEDED_BY_CERTIFIED_OAUTH",
        credential_refresh_in_flight: false,
        credential_refresh_started_at: null,
        prepared_credential_id: null,
        credential_refresh_recovery_vault_id: null,
        provider_mutation_started_at: null,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.operation_audit
          where action =
            'lazada_refresh_reconciliation_superseded_by_certified_oauth'
            and entity_id = $1
            and safe_detail->>'oauth_job_id' = $2
            and safe_detail->>'credential_only_supersession' = 'true'
            and safe_detail->>'legacy_source_identity_exception' = 'false'
            and safe_detail->>'identity_continuity_verified' = 'true'
            and safe_detail->>'listing_identity_relinked' = 'false'
            and safe_detail->>'provider_mutation_started' = 'false'
            and safe_detail->>'oauth_provider_certified' = 'true'`,
        [blockerJobId, successJobId],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        `select count(*) from sellerpilot_private.channel_gateway_jobs
          where channel = 'lazada' and operation = 'oauth.exchange'
            and status = 'queued' and oauth_request_vault_id is not null`,
      ),
      0,
      "successful replacement must leave no older queued OAuth Vault request",
    );
  } finally {
    await db.close();
  }
});

test("Qoo10 create rollback confirmation is exact, atomic, idempotent, and releases only listing.update", async () => {
  const db = new PGlite();
  const migrationName =
    "20260830222257_confirm_qoo10_listing_create_rollback.sql";
  const productId = "10000000-0000-4000-8000-000000000301";
  const listingId = "10000000-0000-4000-8000-000000000302";
  const attemptId = "10000000-0000-4000-8000-000000000303";
  const sourceJobId = "10000000-0000-4000-8000-000000000304";
  const unknownJobId = "10000000-0000-4000-8000-000000000305";
  const sharedJobCreatorId = "10000000-0000-4000-8000-000000000306";
  const remoteId = "1217336970";
  const biContentsNo = 8461402963;
  const requestFingerprint = "8".repeat(64);
  const differentFingerprint = "9".repeat(64);
  const staleFingerprint = "6".repeat(64);
  const stopFingerprint = "5".repeat(64);
  const mismatchedAccountKey = "7".repeat(64);
  const functionSignature =
    "sellerpilot_private.confirm_qoo10_listing_create_rollback(uuid,text,bigint,text)";
  const identityFunctionSignature =
    "public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)";
  const requestPayload = {
    arguments: {
      publicationStateContract: "verified_remote_state_v1",
      publicationIntent: "live",
      publicationExpectedLocale: "ja-JP",
      publicationExpectedFingerprint: requestFingerprint,
      publicationExpectedImageCount: 8,
      sellerpilotQoo10CreateContext: {
        contract: "sellerpilot_qoo10_listing_create_context_v1",
        productId,
        sku: "QOO10-ROLLBACK-SKU",
        sourceCurrency: "KRW",
        sourcePrice: 17000,
        market: "JP",
        locale: "ja-JP",
        currency: "JPY",
        price: 1871,
        quantity: 1,
      },
      params: {
        SecondSubCat: "320002604",
        RetailPrice: "1871",
        ItemPrice: "1871",
        ItemQty: "1",
        ShippingNo: "0",
      },
    },
  };
  const responsePayload = {
    ok: false,
    channel: "qoo10",
    operation: "listing.create",
    remoteId,
    safeMessage: "Qoo10 publication readback failed after a verified rollback.",
    steps: [
      {
        name: "qoo10-create-contract-preflight",
        ok: true,
        status: 200,
        data: {
          categoryCode: "320002604",
          price: 1871,
          quantity: 1,
          shippingNo: "0",
        },
      },
      { name: "seller-account-readback", ok: true, status: 200, data: {} },
      { name: "category-readback", ok: true, status: 200, data: {} },
      { name: "shipping-readback", ok: true, status: 200, data: {} },
      { name: "representative-image-upload", ok: true, status: 200, data: {} },
      {
        name: "SetNewGoods",
        ok: true,
        status: 200,
        data: {
          ResultCode: 0,
          ResultObject: { GdNo: remoteId, BIContentsNo: biContentsNo },
        },
      },
      {
        name: "EditGoodsContents",
        ok: true,
        status: 200,
        data: { ResultCode: 0, ResultMsg: "SUCCESS" },
      },
      {
        name: "detail-image-readback",
        ok: false,
        status: 200,
        data: {
          ResultCode: 0,
          ResultMsg: "QOO10_DETAIL_IMAGE_READBACK_MISSING",
          detailImageCount: 8,
        },
      },
      {
        name: "rollback-missing-detail",
        ok: true,
        status: 200,
        data: { ResultCode: 0, ResultMsg: "SUCCESS" },
      },
    ],
  };
  const confirm = (jobId, expectedRemoteId, expectedBiContentsNo, status) =>
    scalar(
      db,
      `select sellerpilot_private.confirm_qoo10_listing_create_rollback(
        $1, $2, $3::bigint, $4
      )`,
      [jobId, expectedRemoteId, expectedBiContentsNo, status],
    );
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const migrationNames = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.equal(migrationNames.includes(migrationName), true);
    for (const name of migrationNames) {
      await db.exec(withoutUnavailableExtensions(
        await readFile(new URL(name, migrationUrl), "utf8"),
      ));
    }

    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, $2, 'EXECUTE')",
          [role, functionSignature],
        ),
        false,
        `${role} must not execute the SQL-editor-only recovery function`,
      );
      assert.equal(
        await scalar(
          db,
          `select has_function_privilege(
            $1,
            'sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(text,text,text,boolean)',
            'EXECUTE'
          )`,
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          `select has_table_privilege(
            $1,
            'sellerpilot_private.qoo10_listing_create_rollback_confirmations',
            'SELECT,INSERT,UPDATE,DELETE'
          )`,
          [role],
        ),
        false,
        `${role} must not access the private rollback audit`,
      );
    }
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1, $2, 'EXECUTE')",
          [role, identityFunctionSignature],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role', $1, 'EXECUTE')",
        [identityFunctionSignature],
      ),
      true,
      "only service_role may read the bounded application update identity",
    );
    assert.deepEqual(
      (await db.query(
        `select security_definer, search_path_locked, private_schema
           from (
             select procedure.prosecdef as security_definer,
                    cardinality(procedure.proconfig) = 1
                      and procedure.proconfig[1] in (
                        'search_path=', 'search_path=""'
                      ) as search_path_locked,
                    namespace.nspname = 'sellerpilot_private' as private_schema
               from pg_catalog.pg_proc procedure
               join pg_catalog.pg_namespace namespace
                 on namespace.oid = procedure.pronamespace
              where procedure.oid = $1::regprocedure
           ) definition`,
        [functionSignature],
      )).rows,
      [{ security_definer: true, search_path_locked: true, private_schema: true }],
    );
    assert.deepEqual(
      (await db.query(
        `select security_definer, search_path_locked, public_schema
           from (
             select procedure.prosecdef as security_definer,
                    cardinality(procedure.proconfig) = 1
                      and procedure.proconfig[1] in (
                        'search_path=', 'search_path=""'
                      ) as search_path_locked,
                    namespace.nspname = 'public' as public_schema
               from pg_catalog.pg_proc procedure
               join pg_catalog.pg_namespace namespace
                 on namespace.oid = procedure.pronamespace
              where procedure.oid = $1::regprocedure
           ) definition`,
        [identityFunctionSignature],
      )).rows,
      [{ security_definer: true, search_path_locked: true, public_schema: true }],
      "the service identity RPC must lock its definer search path",
    );
    const recoveryDefinition = await scalar(
      db,
      "select pg_get_functiondef($1::regprocedure)",
      [functionSignature],
    );
    assert.match(recoveryDefinition, /rolsuper[\s\S]*pg_roles[\s\S]*session_user/i);
    const invokerDefinition = await scalar(
      db,
      `select pg_get_functiondef(
        'sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(text,text,text,boolean)'::regprocedure
      )`,
    );
    assert.match(
      invokerDefinition,
      /p_session_user\s+is not distinct from\s+p_current_user[\s\S]*p_current_user\s+is not distinct from\s+p_function_owner/i,
      "hosted Supabase SQL Editor uses a direct postgres owner session even when postgres is not rolsuper",
    );
    assert.match(
      await scalar(
        db,
        "select pg_get_functiondef('sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure)",
      ),
      /sellerpilot\.qoo10_create_rollback_source_job[\s\S]*qoo10_listing_create_rollback_update_allowed/i,
    );
    assert.deepEqual(
      (await db.query(
        `select column_name
           from information_schema.columns
          where table_schema = 'sellerpilot_private'
            and table_name = 'qoo10_listing_create_rollback_confirmations'
            and column_name ~ '(^|_)(payload|response|secret|token)($|_)'
          order by column_name`,
      )).rows,
      [],
      "the audit may store only the bounded request digest, never raw payloads or secrets",
    );

    await db.query(
      "insert into auth.users (id, email) values ($1, 'qoo10-rollback@example.test')",
      [ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.admin_users (user_id, display_name)
       values ($1, 'Qoo10 Rollback Admin')`,
      [ADMIN_ID],
    );
    await db.query(
      "insert into auth.users (id, email) values ($1, 'qoo10-shared-job-creator@example.test')",
      [sharedJobCreatorId],
    );
    await db.query(
      `insert into sellerpilot_private.admin_users (user_id, display_name)
       values ($1, 'Qoo10 Shared Job Creator')`,
      [sharedJobCreatorId],
    );
    await setClaims(db);
    const credentialId = await scalar(
      db,
      `select public.sellerpilot_rotate_credential(
        'qoo10', 'production',
        '{"api_key":"qoo10-rollback-key","seller_id":"qoo10-rollback-seller"}'::jsonb,
        now() + interval '365 days', 180, 30, 0
      )`,
    );
    const credentialIdentity = (await db.query(
      `select seller_account_key, seller_account_key_source
         from sellerpilot_private.channel_credentials
        where id = $1`,
      [credentialId],
    )).rows[0];
    assert.match(credentialIdentity.seller_account_key, /^[a-f0-9]{64}$/);
    assert.equal(
      credentialIdentity.seller_account_key_source,
      "credential_incarnation_v1",
    );

    await setClaims(db, "service_role");
    await db.query(
      `insert into sellerpilot_private.products (
         id, owner_id, external_code, sku, name, status, demo
       ) values (
         $1, $2, 'QOO10-ROLLBACK-PRODUCT', 'QOO10-ROLLBACK-SKU',
         'Qoo10 rollback recovery fixture', 'draft', false
       )`,
      [productId, ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts (
         id, owner_id, credential_id, channel, operation,
         idempotency_key, request_fingerprint, status, http_status,
         remote_id, safe_message, gateway_write_required,
         pre_gateway_retryable, completed_at
       ) values (
         $1, $2, $3, 'qoo10', 'listing.create',
         'qoo10-rollback-source-attempt-0001', $4, 'manual_required', 409,
         $5, 'Provider outcome requires reconciliation.', true,
         false, clock_timestamp()
       )`,
      [attemptId, ADMIN_ID, credentialId, requestFingerprint, remoteId],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id, owner_id, product_id, channel_key, market, target_id,
         remote_id, status, currency, price, operation_attempt_id,
         seller_account_key, failure_class, requested_publication_intent,
         remote_visibility, provider_status, last_error, published_at
       ) values (
         $1, $2, $3, 'qoo10', 'JP', '',
         $4, 'failed', 'JPY', 500, $5,
         null, 'external_action', 'live',
         'unknown', 'S2', 'Provider outcome requires reconciliation.', null
       )`,
      [listingId, ADMIN_ID, productId, remoteId, attemptId],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, credential_id, attempt_id, listing_id, channel, operation,
         environment, request_payload, response_payload, status,
         error_message, request_fingerprint, created_by, attempt_count,
         provider_mutation_started_at, started_at, completed_at, updated_at
       ) values (
         $1, $2, $3, $4, 'qoo10', 'listing.create',
         'production', $5::jsonb, $6::jsonb, 'reconciliation_required',
         'Provider outcome requires reconciliation.', $7, $8, 1,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '3 minutes',
         clock_timestamp() - interval '1 minute', clock_timestamp()
       )`,
      [
        sourceJobId,
        credentialId,
        attemptId,
        listingId,
        JSON.stringify(requestPayload),
        JSON.stringify(responsePayload),
        requestFingerprint,
        sharedJobCreatorId,
      ],
    );
    assert.equal(
      await scalar(
        db,
        "select seller_account_key from sellerpilot_private.channel_gateway_jobs where id = $1",
        [sourceJobId],
      ),
      credentialIdentity.seller_account_key,
    );
    assert.deepEqual(
      (await db.query(
        `select job.created_by::text as job_creator,
                attempt.owner_id::text as attempt_owner,
                listing.owner_id::text as listing_owner
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id = job.attempt_id
           join sellerpilot_private.product_listings listing
             on listing.id = job.listing_id
          where job.id = $1`,
        [sourceJobId],
      )).rows,
      [{
        job_creator: sharedJobCreatorId,
        attempt_owner: ADMIN_ID,
        listing_owner: ADMIN_ID,
      }],
      "a shared admin may create the job, while attempt ownership remains the listing authority",
    );

    await assert.rejects(
      confirm(unknownJobId, remoteId, biContentsNo, "S1"),
      /source Qoo10 create job evidence mismatch/,
      "a different source job must fail closed",
    );
    await assert.rejects(
      confirm(sourceJobId, "1217336971", biContentsNo, "S1"),
      /source Qoo10 create job evidence mismatch/,
      "the remote id must match the response and all ledgers",
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo + 1, "S1"),
      /steps evidence mismatch/,
      "BIContentsNo must match the SetNewGoods evidence",
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S2"),
      /invalid Qoo10 rollback confirmation evidence/,
      "only an independently observed S1 or 1 rollback status is accepted",
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload = jsonb_set(
            response_payload, '{steps,7,data,detailImageCount}', '7'::jsonb
          )
        where id = $1`,
      [sourceJobId],
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S1"),
      /steps evidence mismatch/,
      "an inexact eight-image readback must reject recovery",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload = $2::jsonb
        where id = $1`,
      [sourceJobId, JSON.stringify(responsePayload)],
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload = jsonb_set(
            response_payload, '{steps,7,ok}', 'true'::jsonb
          )
        where id = $1`,
      [sourceJobId],
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S1"),
      /steps evidence mismatch/,
      "a successful detail readback followed by rollback is contradictory and must reject recovery",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload = $2::jsonb
        where id = $1`,
      [sourceJobId, JSON.stringify(responsePayload)],
    );

    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set status = 'failed'
        where id = $1`,
      [attemptId],
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S1"),
      /attempt evidence mismatch/,
      "the source attempt must still be manual_required",
    );
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set status = 'manual_required'
        where id = $1`,
      [attemptId],
    );

    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set request_fingerprint = $2
        where id = $1`,
      [attemptId, differentFingerprint],
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S1"),
      /attempt evidence mismatch/,
      "the source job and attempt fingerprints must be identical",
    );
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set request_fingerprint = $2
        where id = $1`,
      [attemptId, requestFingerprint],
    );

    await db.exec(
      `alter table sellerpilot_private.channel_operation_attempts
         disable trigger guard_attempt_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set seller_account_key = $2
        where id = $1`,
      [attemptId, mismatchedAccountKey],
    );
    await db.exec(
      `alter table sellerpilot_private.channel_operation_attempts
         enable trigger guard_attempt_seller_lineage`,
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S1"),
      /attempt evidence mismatch/,
      "a different seller account lineage must reject recovery",
    );
    await db.exec(
      `alter table sellerpilot_private.channel_operation_attempts
         disable trigger guard_attempt_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set seller_account_key = $2
        where id = $1`,
      [attemptId, credentialIdentity.seller_account_key],
    );
    await db.exec(
      `alter table sellerpilot_private.channel_operation_attempts
         enable trigger guard_attempt_seller_lineage`,
    );

    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set remote_id = '1217336971'
        where id = $1`,
      [listingId],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         enable trigger guard_product_listing_seller_lineage`,
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "S1"),
      /listing evidence mismatch/,
      "a different listing identity must reject recovery",
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set remote_id = $2
        where id = $1`,
      [listingId, remoteId],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         enable trigger guard_product_listing_seller_lineage`,
    );

    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.qoo10_listing_create_rollback_confirmations",
      ),
      0,
      "every rejected probe must roll back without creating audit evidence",
    );

    // Hosted Supabase reports session_user=current_user='postgres' in SQL
    // Editor while pg_roles.rolsuper is false. Exercise that identity contract
    // independently from PGlite's non-demotable bootstrap superuser.
    assert.equal(
      await scalar(
        db,
        `select sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(
          'postgres', 'postgres', 'postgres', false
        )`,
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(
          'authenticator', 'postgres', 'postgres', false
        )`,
      ),
      false,
      "PostgREST must not inherit the direct SQL Editor maintenance path",
    );
    assert.equal(
      await scalar(
        db,
        `select sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(
          'maintenance_super', 'postgres', 'postgres', true
        )`,
      ),
      true,
    );

    const confirmed = await confirm(
      sourceJobId,
      remoteId,
      biContentsNo,
      "S1",
    );
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.replayed, false);
    assert.equal(confirmed.sourceJobId, sourceJobId);
    assert.equal(confirmed.attemptId, attemptId);
    assert.equal(confirmed.listingId, listingId);
    assert.equal(confirmed.remoteId, remoteId);
    assert.equal(confirmed.biContentsNo, biContentsNo);
    assert.equal(confirmed.providerStatus, "S1");

    const recovered = (await db.query(
      `select job.status as job_status,
              job.error_message as job_error,
              job.response_payload,
              attempt.status as attempt_status,
              attempt.http_status,
              attempt.remote_id as attempt_remote_id,
              attempt.safe_message,
              listing.status as listing_status,
              listing.remote_id as listing_remote_id,
              listing.seller_account_key,
              listing.requested_publication_intent,
              listing.remote_visibility,
              listing.provider_status,
              listing.published_at,
              listing.last_verified_at is not null as listing_verified,
              listing.failure_class,
              listing.last_error,
              product.status as product_status
         from sellerpilot_private.channel_gateway_jobs job
         join sellerpilot_private.channel_operation_attempts attempt
           on attempt.id = job.attempt_id
         join sellerpilot_private.product_listings listing
           on listing.id = job.listing_id
         join sellerpilot_private.products product
           on product.id = listing.product_id
        where job.id = $1`,
      [sourceJobId],
    )).rows[0];
    assert.deepEqual(recovered, {
      job_status: "failed",
      job_error:
        "QOO10_LISTING_CREATE_ROLLBACK_CONFIRMED: provider status S1; continue only with listing.update.",
      response_payload: responsePayload,
      attempt_status: "failed",
      http_status: 409,
      attempt_remote_id: remoteId,
      safe_message:
        "Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.",
      listing_status: "paused",
      listing_remote_id: remoteId,
      seller_account_key: credentialIdentity.seller_account_key,
      requested_publication_intent: "live",
      remote_visibility: "non_public",
      provider_status: "S1",
      published_at: null,
      listing_verified: true,
      failure_class: "retryable",
      last_error:
        "Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요",
      product_status: "draft",
    });
    assert.deepEqual(
      (await db.query(
        `select source_job_id::text, source_attempt_id::text,
                listing_id::text, credential_id::text,
                request_fingerprint, seller_account_key, remote_id,
                bi_contents_no, category_code, retail_price_jpy,
                sell_price_jpy, quantity, shipping_no,
                observed_provider_status,
                previous_job_status, new_job_status,
                previous_attempt_status, new_attempt_status,
                previous_listing_status, new_listing_status,
                previous_failure_class, new_failure_class,
                previous_remote_visibility, new_remote_visibility,
                previous_provider_status, new_provider_status,
                requested_publication_intent,
                confirmed_at is not null as confirmed
           from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          where source_job_id = $1`,
        [sourceJobId],
      )).rows,
      [{
        source_job_id: sourceJobId,
        source_attempt_id: attemptId,
        listing_id: listingId,
        credential_id: credentialId,
        request_fingerprint: requestFingerprint,
        seller_account_key: credentialIdentity.seller_account_key,
        remote_id: remoteId,
        bi_contents_no: biContentsNo,
        category_code: "320002604",
        retail_price_jpy: 1871,
        sell_price_jpy: 1871,
        quantity: 1,
        shipping_no: "0",
        observed_provider_status: "S1",
        previous_job_status: "reconciliation_required",
        new_job_status: "failed",
        previous_attempt_status: "manual_required",
        new_attempt_status: "failed",
        previous_listing_status: "failed",
        new_listing_status: "paused",
        previous_failure_class: "external_action",
        new_failure_class: "retryable",
        previous_remote_visibility: "unknown",
        new_remote_visibility: "non_public",
        previous_provider_status: "S2",
        new_provider_status: "S1",
        requested_publication_intent: "live",
        confirmed: true,
      }],
    );

    const replay = await confirm(sourceJobId, remoteId, biContentsNo, "S1");
    assert.equal(replay.status, "confirmed");
    assert.equal(replay.replayed, true);
    assert.equal(
      await scalar(
        db,
        "select count(*)::integer from sellerpilot_private.qoo10_listing_create_rollback_confirmations where source_job_id = $1",
        [sourceJobId],
      ),
      1,
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo + 1, "S1"),
      /confirmation evidence mismatch/,
      "an idempotent replay must reject changed BI evidence",
    );
    await assert.rejects(
      confirm(sourceJobId, remoteId, biContentsNo, "1"),
      /confirmation evidence mismatch/,
      "an idempotent replay preserves the exact observed status representation",
    );

    const lookupIdentity = (input = {}) => scalar(
      db,
      `select public.sellerpilot_service_get_qoo10_rollback_update_identity(
        $1, $2, $3, $4, $5
      )`,
      [
        input.listingId ?? listingId,
        input.credentialId ?? credentialId,
        input.productId ?? productId,
        input.market ?? "JP",
        input.targetId ?? "",
      ],
    );
    assert.deepEqual(
      await lookupIdentity(),
      {
        status: "allowed",
        contract: "qoo10_create_rollback_confirmation_v1",
        listingId,
        remoteId,
        providerStatus: "S1",
        sourceJobId,
        expectedState: {
          categoryCode: "320002604",
          retailPriceJpy: 1871,
          sellPriceJpy: 1871,
          quantity: 1,
          shippingNo: "0",
          biContentsNo,
        },
      },
    );
    await db.exec(
      "alter table sellerpilot_private.channel_gateway_jobs disable trigger user",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload = jsonb_set(
            response_payload, '{steps,7,ok}', 'true'::jsonb
          )
        where id = $1`,
      [sourceJobId],
    );
    await db.exec(
      "alter table sellerpilot_private.channel_gateway_jobs enable trigger user",
    );
    assert.deepEqual(
      await lookupIdentity(),
      {
        status: "blocked",
        contract: "qoo10_create_rollback_confirmation_v1",
      },
      "the application identity must fail closed if source detail evidence drifts to a contradictory success",
    );
    await db.exec(
      "alter table sellerpilot_private.channel_gateway_jobs disable trigger user",
    );
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set response_payload = $2::jsonb
        where id = $1`,
      [sourceJobId, JSON.stringify(responsePayload)],
    );
    await db.exec(
      "alter table sellerpilot_private.channel_gateway_jobs enable trigger user",
    );
    assert.equal((await lookupIdentity()).status, "allowed");
    const blockedIdentity = {
      status: "blocked",
      contract: "qoo10_create_rollback_confirmation_v1",
    };
    assert.deepEqual(
      await lookupIdentity({ credentialId: unknownJobId }),
      blockedIdentity,
      "a different credential must return an identifier-free block",
    );
    assert.deepEqual(
      await lookupIdentity({ productId: unknownJobId }),
      blockedIdentity,
      "a different product must return an identifier-free block",
    );
    assert.deepEqual(
      await lookupIdentity({ market: "KR" }),
      blockedIdentity,
      "a different market must return an identifier-free block",
    );
    assert.deepEqual(
      await lookupIdentity({ targetId: "different-target" }),
      blockedIdentity,
      "a different target must return an identifier-free block",
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set provider_status = 'S2'
        where id = $1`,
      [listingId],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         enable trigger guard_product_listing_seller_lineage`,
    );
    assert.deepEqual(
      await lookupIdentity(),
      blockedIdentity,
      "any current listing-state drift must return an identifier-free block",
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set provider_status = 'S1'
        where id = $1`,
      [listingId],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         enable trigger guard_product_listing_seller_lineage`,
    );
    assert.equal((await lookupIdentity()).status, "allowed");

    await attestPublicationRelease(db);
    await activatePublicationRuntimeRelease(db);
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_set_listing_mutation_release_gate(true,$1)",
        [PUBLICATION_RELEASE_SHA],
      )).open,
      true,
    );
    const recoveryBinding = {
      status: "allowed",
      contract: "qoo10_create_rollback_confirmation_v1",
      listingId,
      remoteId,
      providerStatus: "S1",
      sourceJobId,
      expectedState: {
        categoryCode: "320002604",
        retailPriceJpy: 1871,
        sellPriceJpy: 1871,
        quantity: 1,
        shippingNo: "0",
        biContentsNo,
      },
    };
    const recoveryPayload = (fingerprint, shippingNo = "0") => {
      const binding = structuredClone(recoveryBinding);
      binding.expectedState.shippingNo = shippingNo;
      return {
        arguments: {
          ...requestPayload.arguments,
          params: {
            ...requestPayload.arguments.params,
            ItemCode: remoteId,
            ShippingNo: shippingNo,
          },
          publicationExpectedFingerprint: fingerprint,
          sellerpilotQoo10RollbackUpdateRecovery: binding,
        },
      };
    };

    // The route preflight may succeed and then lose a race to a stop/update
    // before enqueue. The DB transaction must recheck the source-attempt
    // binding under row lock and create no stale activation job.
    await setClaims(db);
    const staleUpdateAttempt = await scalar(
      db,
      `select public.sellerpilot_claim_channel_operation(
        $1, 'qoo10', 'listing.update',
        'qoo10-rollback-stale-update-0001', $2
      )`,
      [credentialId, staleFingerprint],
    );
    const laterStopAttempt = await scalar(
      db,
      `select public.sellerpilot_claim_channel_operation(
        $1, 'qoo10', 'listing.stop',
        'qoo10-rollback-later-stop-0001', $2
      )`,
      [credentialId, stopFingerprint],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set operation_attempt_id = $2,
              updated_at = clock_timestamp()
        where id = $1`,
      [listingId, laterStopAttempt.attempt_id],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         enable trigger guard_product_listing_seller_lineage`,
    );
    await setClaims(db, "service_role");
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
          $1, $2, $3, 'qoo10', 'listing.update', $4::jsonb
        )`,
        [
          listingId,
          credentialId,
          staleUpdateAttempt.attempt_id,
          JSON.stringify(recoveryPayload(staleFingerprint)),
        ],
      ),
      /QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH/,
      "a stale route authorization must not survive a newer listing operation",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.channel_gateway_jobs
          where attempt_id = $1`,
        [staleUpdateAttempt.attempt_id],
      ),
      0,
      "TOCTOU rejection must leave no gateway job",
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set operation_attempt_id = $2,
              updated_at = clock_timestamp()
        where id = $1`,
      [listingId, attemptId],
    );
    await db.exec(
      `alter table sellerpilot_private.product_listings
         enable trigger guard_product_listing_seller_lineage`,
    );

    await setClaims(db);
    const updateAttempt = await scalar(
      db,
      `select public.sellerpilot_claim_channel_operation(
        $1, 'qoo10', 'listing.update',
        'qoo10-rollback-followup-update-0001', $2
      )`,
      [credentialId, differentFingerprint],
    );
    assert.equal(updateAttempt.status, "running");
    assert.equal(updateAttempt.duplicate, false);
    const tamperedRecoveryPayloads = [
      ["remote item", (payload) => {
        payload.arguments.params.ItemCode = "9999999999";
      }],
      ["category", (payload) => {
        payload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.categoryCode = "320002605";
      }],
      ["retail price", (payload) => {
        payload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.retailPriceJpy = 1872;
      }],
      ["sell price", (payload) => {
        payload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.sellPriceJpy = 1870;
      }],
      ["quantity", (payload) => {
        payload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.quantity = 2;
      }],
      ["shipping", (payload) => {
        payload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.shippingNo = "1";
      }],
      ["BI content", (payload) => {
        payload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.biContentsNo += 1;
      }],
    ];
    for (const [label, mutate] of tamperedRecoveryPayloads) {
      const payload = structuredClone(recoveryPayload(differentFingerprint));
      mutate(payload);
      await setClaims(db, "service_role");
      await assert.rejects(
        scalar(
          db,
          `select public.sellerpilot_service_enqueue_listing_gateway_job(
            $1, $2, $3, 'qoo10', 'listing.update', $4::jsonb
          )`,
          [
            listingId,
            credentialId,
            updateAttempt.attempt_id,
            JSON.stringify(payload),
          ],
        ),
        /QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH/,
        `${label} drift must fail closed before gateway enqueue`,
      );
    }
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.channel_gateway_jobs
          where attempt_id = $1`,
        [updateAttempt.attempt_id],
      ),
      0,
      "all tampered recovery bindings must leave no gateway job",
    );
    await setClaims(db, "service_role");
    const updateEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1, $2, $3, 'qoo10', 'listing.update', $4::jsonb
      )`,
      [
        listingId,
        credentialId,
        updateAttempt.attempt_id,
        JSON.stringify(recoveryPayload(differentFingerprint)),
      ],
    );
    assert.equal(updateEnqueue.status, "queued");
    assert.equal(updateEnqueue.reused, false);
    assert.deepEqual(
      (await db.query(
        `select operation, count(*)::integer as count
           from sellerpilot_private.channel_gateway_jobs
          where listing_id = $1
          group by operation
          order by operation`,
        [listingId],
      )).rows,
      [
        { operation: "listing.create", count: 1 },
        { operation: "listing.update", count: 1 },
      ],
      "recovery must release one update without issuing a duplicate create",
    );

    const retryWorkerTokenHash = "4".repeat(64);
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens (
         label, token_hash, fingerprint, status, scope, expires_at, created_by
       ) values (
         'Qoo10 rollback retry proof', $1, '444444444444', 'active',
         'gateway', clock_timestamp() + interval '1 day', $2
       )`,
      [retryWorkerTokenHash, ADMIN_ID],
    );
    const updateClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'test/qoo10-retry-proof')",
      [retryWorkerTokenHash],
    );
    assert.equal(updateClaim.id, updateEnqueue.job_id);
    assert.equal(updateClaim.operation, "listing.update");
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
        [retryWorkerTokenHash, updateClaim.id, updateClaim.claim_token],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select status, failure_class, remote_visibility, provider_status,
                operation_attempt_id::text, published_at,
                last_verified_at is not null as verified
           from sellerpilot_private.product_listings where id = $1`,
        [listingId],
      )).rows,
      [{
        status: "queued",
        failure_class: null,
        remote_visibility: "non_public",
        provider_status: "S1",
        operation_attempt_id: updateAttempt.attempt_id,
        published_at: null,
        verified: true,
      }],
    );
    const explicitRejectionResponse = {
      ok: false,
      channel: "qoo10",
      operation: "listing.update",
      remoteId,
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      safeMessage: "Qoo10 UpdateGoods explicitly rejected the request; S1 remained exact.",
      steps: [
        {
          name: "UpdateGoods",
          ok: false,
          status: 200,
          data: {
            ResultCode: -99,
            ResultMsg: "ProductionPlaceTypeは必須です。",
          },
        },
        {
          name: "qoo10-rollback-update-rejection-s1-readback",
          ok: true,
          status: 200,
          data: {
            providerStatus: "S1",
            sellerpilotExpectedProviderStatus: "S1",
            sellerpilotExactDetailImageCount: 8,
            sellerpilotVerification: "QOO10_ROLLBACK_UPDATE_REJECTION_S1_VERIFIED",
            sellerpilotMutableVerification: "LISTING_MUTABLE_FIELDS_VERIFIED",
            sellerpilotPublicationChecks: {
              identityVerified: true,
              statusVerified: true,
              sellerCodeVerified: true,
              localeVerified: true,
              fingerprintVerified: true,
              imageCountVerified: true,
              sellerAccountIdentityVerified: true,
              categoryVerified: true,
              titleVerified: true,
              shippingVerified: true,
              retailPriceVerified: true,
              priceQuantityVerified: true,
              representativeImageVerified: true,
              detailImageDigestVerified: true,
              recoveryExpectationVerified: true,
              sellPriceVerified: true,
              quantityVerified: true,
              confirmedBiCdnImageVerified: true,
              detailImageUrlsVerified: true,
            },
          },
        },
      ],
    };
    const rejectedRetryProofMutations = [
      ["sellerCodeVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.sellerCodeVerified = false;
      }],
      ["localeVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.localeVerified = false;
      }],
      ["fingerprintVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.fingerprintVerified = false;
      }],
      ["imageCountVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.imageCountVerified = false;
      }],
      ["sellerAccountIdentityVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.sellerAccountIdentityVerified = false;
      }],
      ["recoveryExpectationVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.recoveryExpectationVerified = false;
      }],
      ["sellPriceVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.sellPriceVerified = false;
      }],
      ["quantityVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.quantityVerified = false;
      }],
      ["confirmedBiCdnImageVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.confirmedBiCdnImageVerified = false;
      }],
      ["detailImageUrlsVerified", (response) => {
        response.steps[1].data.sellerpilotPublicationChecks.detailImageUrlsVerified = false;
      }],
      ["mutable verification", (response) => {
        response.steps[1].data.sellerpilotMutableVerification = "MISMATCH";
      }],
    ];
    for (const [label, mutate] of rejectedRetryProofMutations) {
      await db.exec("begin");
      try {
        const response = structuredClone(explicitRejectionResponse);
        mutate(response);
        assert.equal(
          await scalar(
            db,
            `select public.sellerpilot_complete_channel_gateway_job(
              $1,$2,$3,'succeeded',$4::jsonb,null
            )`,
            [
              retryWorkerTokenHash,
              updateClaim.id,
              updateClaim.claim_token,
              JSON.stringify(response),
            ],
          ),
          true,
        );
        assert.deepEqual(
          (await db.query(
            `select status, operation_attempt_id::text
               from sellerpilot_private.product_listings
              where id = $1`,
            [listingId],
          )).rows,
          [{ status: "failed", operation_attempt_id: updateAttempt.attempt_id }],
          `${label} must not restore the confirmed source retry pointer`,
        );
        assert.equal(
          await scalar(
            db,
            `select count(*)::integer
               from sellerpilot_private.operation_audit
              where action = 'qoo10_rollback_update_rejected_retry_preserved'
                and entity_id = $1`,
            [listingId],
          ),
          0,
          `${label} must leave no retry-preserved audit`,
        );
      } finally {
        await db.exec("rollback");
      }
    }
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_complete_channel_gateway_job(
          $1,$2,$3,'succeeded',$4::jsonb,null
        )`,
        [
          retryWorkerTokenHash,
          updateClaim.id,
          updateClaim.claim_token,
          JSON.stringify(explicitRejectionResponse),
        ],
      ),
      true,
    );
    assert.deepEqual(
      (await db.query(
        `select listing.status, listing.failure_class,
                listing.remote_visibility, listing.provider_status,
                listing.operation_attempt_id::text,
                listing.published_at, listing.last_error,
                update_attempt.status as update_attempt_status,
                update_job.status as update_job_status
           from sellerpilot_private.product_listings listing
           join sellerpilot_private.channel_operation_attempts update_attempt
             on update_attempt.id = $2
           join sellerpilot_private.channel_gateway_jobs update_job
             on update_job.id = $3
          where listing.id = $1`,
        [listingId, updateAttempt.attempt_id, updateClaim.id],
      )).rows,
      [{
        status: "paused",
        failure_class: "retryable",
        remote_visibility: "non_public",
        provider_status: "S1",
        operation_attempt_id: attemptId,
        published_at: null,
        last_error:
          "Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요",
        update_attempt_status: "failed",
        update_job_status: "succeeded",
      }],
      "an explicit rejection plus exact S1 readback must preserve the confirmed retry pointer without erasing failed audit rows",
    );
    assert.equal((await lookupIdentity()).status, "allowed");
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.operation_audit
          where action = 'qoo10_rollback_update_rejected_retry_preserved'
            and entity_id = $1`,
        [listingId],
      ),
      1,
    );

    await db.query(
      `insert into
         sellerpilot_private.qoo10_listing_update_rejection_observations (
           update_job_id,update_attempt_id,source_job_id,source_attempt_id,
           listing_id,credential_id,remote_id,response_sha256,
           provider_rejection_code,provider_rejection_reason,provider_status,
           observed_origin_type,observed_origin,observed_retail_price_jpy,
           observed_sell_price_jpy,observed_quantity,source_shipping_no,
           observed_shipping_no,observed_detail_image_count,
           provider_mutation_accepted,observed_at
         )
       select job.id,job.attempt_id,$2,$3,$4,$5,$6,
              encode(extensions.digest(job.response_payload::text,'sha256'),'hex'),
              '-99','ProductionPlaceType_required','S1','2','CN',1871,1871,1,
              '0','806971',8,false,job.completed_at
         from sellerpilot_private.channel_gateway_jobs job
        where job.id=$1`,
      [
        updateClaim.id,
        sourceJobId,
        attemptId,
        listingId,
        credentialId,
        remoteId,
      ],
    );
    const observedRecoveryBinding = structuredClone(recoveryBinding);
    observedRecoveryBinding.expectedState.shippingNo = "806971";
    await db.exec("set role service_role");
    try {
      assert.deepEqual(
        await lookupIdentity(),
        observedRecoveryBinding,
        "the service-role identity RPC must consume the private observed delivery group",
      );
    } finally {
      await db.exec("reset role");
    }

    await setClaims(db);
    const retryAttempt = await scalar(
      db,
      `select public.sellerpilot_claim_channel_operation(
        $1, 'qoo10', 'listing.update',
        'qoo10-rollback-followup-update-0002', $2
      )`,
      [credentialId, "3".repeat(64)],
    );
    await setClaims(db, "service_role");
    const retryEnqueue = await scalar(
      db,
      `select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1, $2, $3, 'qoo10', 'listing.update', $4::jsonb
      )`,
      [
        listingId,
        credentialId,
        retryAttempt.attempt_id,
        JSON.stringify(recoveryPayload("3".repeat(64), "806971")),
      ],
    );
    assert.equal(retryEnqueue.status, "queued");
    assert.deepEqual(
      (await db.query(
        `select operation, count(*)::integer as count
           from sellerpilot_private.channel_gateway_jobs
          where listing_id = $1
          group by operation
          order by operation`,
        [listingId],
      )).rows,
      [
        { operation: "listing.create", count: 1 },
        { operation: "listing.update", count: 2 },
      ],
      "a proven explicit rejection may enqueue another update but never a second create",
    );
    assert.equal(
      await scalar(
        db,
        `select request_payload#>>
                  '{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}'
           from sellerpilot_private.channel_gateway_jobs where id=$1`,
        [retryEnqueue.job_id],
      ),
      "806971",
    );

    const secondUpdateClaim = await scalar(
      db,
      "select public.sellerpilot_claim_channel_gateway_job($1, 'test/qoo10-observed-shipping-proof')",
      [retryWorkerTokenHash],
    );
    assert.equal(secondUpdateClaim.id, retryEnqueue.job_id);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_gateway_provider_mutation($1,$2,$3)",
        [
          retryWorkerTokenHash,
          secondUpdateClaim.id,
          secondUpdateClaim.claim_token,
        ],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        `select public.sellerpilot_complete_channel_gateway_job(
          $1,$2,$3,'succeeded',$4::jsonb,null
        )`,
        [
          retryWorkerTokenHash,
          secondUpdateClaim.id,
          secondUpdateClaim.claim_token,
          JSON.stringify(explicitRejectionResponse),
        ],
      ),
      true,
      "completion must validate the observed 806971 recovery state through the real retry helper",
    );
    assert.deepEqual(
      (await db.query(
        `select status,failure_class,remote_visibility,provider_status,
                operation_attempt_id::text,last_error
           from sellerpilot_private.product_listings where id=$1`,
        [listingId],
      )).rows,
      [{
        status: "paused",
        failure_class: "retryable",
        remote_visibility: "non_public",
        provider_status: "S1",
        operation_attempt_id: attemptId,
        last_error:
          "Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요",
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer
           from sellerpilot_private.operation_audit
          where action='qoo10_rollback_update_rejected_retry_preserved'
            and entity_id=$1`,
        [listingId],
      ),
      2,
    );
  } finally {
    await db.close();
  }
});
