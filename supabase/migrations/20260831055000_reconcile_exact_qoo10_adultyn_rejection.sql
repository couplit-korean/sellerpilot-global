-- Resolve one exact Qoo10 listing.update after UpdateGoods explicitly rejected
-- the request because AdultYN was absent. This is a forward-only, one-shot
-- reconciliation: it never calls Qoo10, never changes the immutable request,
-- response, provider marker, completion receipt, or product, and never retries
-- the rejected gateway job.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

create table if not exists
  sellerpilot_private.qoo10_adultyn_rejection_reconciliations (
    job_id uuid primary key,
    attempt_id uuid not null unique,
    listing_id uuid not null,
    product_id uuid not null,
    credential_id uuid not null,
    source_job_id uuid not null,
    source_attempt_id uuid not null,
    baseline_update_job_id uuid not null,
    baseline_response_sha256 text not null,
    remote_id text not null,
    request_fingerprint text not null,
    request_sha256 text not null,
    response_sha256 text not null,
    provider_rejection_code text not null,
    provider_rejection_message text not null,
    provider_status text not null,
    remote_visibility text not null,
    item_title text not null,
    adult_yn text not null,
    origin_type text not null,
    origin_code text not null,
    retail_price_jpy bigint not null,
    quantity integer not null,
    shipping_no text not null,
    detail_image_count integer not null,
    mismatch_paths text[] not null,
    provider_changed_date text not null,
    provider_observed_at timestamptz not null,
    previous_listing_updated_at timestamptz not null,
    provider_mutation_accepted boolean not null,
    provider_call_replayed boolean not null,
    reconciled_at timestamptz not null,
    constraint qoo10_adultyn_reconcile_job_fkey foreign key (job_id)
      references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_attempt_fkey foreign key (attempt_id)
      references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_listing_fkey foreign key (listing_id)
      references sellerpilot_private.product_listings(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_product_fkey foreign key (product_id)
      references sellerpilot_private.products(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_credential_fkey foreign key (credential_id)
      references sellerpilot_private.channel_credentials(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_source_job_fkey foreign key (source_job_id)
      references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_source_attempt_fkey foreign key (source_attempt_id)
      references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_baseline_job_fkey foreign key (baseline_update_job_id)
      references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
    constraint qoo10_adultyn_reconcile_exact_target_check check (
      job_id = 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid
      and attempt_id = 'c19956d8-67d3-465b-90cd-a41b9123ad4e'::uuid
      and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
      and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
      and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
      and source_job_id = '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid
      and source_attempt_id = '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid
      and baseline_update_job_id = '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid
      and baseline_response_sha256 =
        '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
      and remote_id = '1217336970'
    ),
    constraint qoo10_adultyn_reconcile_exact_request_check check (
      request_fingerprint = '388a0ed6bed7d1537ee0b4792429b1c796daabe12303681348b5634d1d37b3f9'
      and request_sha256 = 'c74ae7bafc7e884b04fd30012f30a834495df4b0cf1e97969dd860f6e878da5e'
      and response_sha256 = 'ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad'
    ),
    constraint qoo10_adultyn_reconcile_exact_observation_check check (
      provider_rejection_code = '-99'
      and provider_rejection_message = 'AdultYNは必須です。'
      and provider_status = 'S1'
      and remote_visibility = 'non_public'
      and item_title = '貼り付け式ケーブル整理クリップ6個セット'
      and adult_yn = 'N'
      and origin_type = '2'
      and origin_code = 'CN'
      and retail_price_jpy = 1871
      and quantity = 1
      and shipping_no = '806971'
      and detail_image_count = 8
      and mismatch_paths = array['ItemDescription.text', 'Keyword']::text[]
      and provider_changed_date = '2026-08-30 21:57:11'
      and provider_observed_at = '2026-08-30 21:32:29.567929+00'::timestamptz
      and not provider_mutation_accepted
      and not provider_call_replayed
    )
  );

alter table sellerpilot_private.qoo10_adultyn_rejection_reconciliations
  enable row level security;
revoke all on table sellerpilot_private.qoo10_adultyn_rejection_reconciliations
  from public, anon, authenticated, service_role;

do $qoo10_adultyn_evidence_schema_postimage$
declare
  v_columns text[];
  v_constraints text[];
  v_table_oid oid :=
    'sellerpilot_private.qoo10_adultyn_rejection_reconciliations'::regclass;
begin
  select array_agg(
           attribute.attname || ':'
             || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
             || ':' || attribute.attnotnull::text
             || ':' || attribute.atthasdef::text
           order by attribute.attnum
         )
    into v_columns
    from pg_catalog.pg_attribute attribute
   where attribute.attrelid = v_table_oid
     and attribute.attnum > 0
     and not attribute.attisdropped;
  if v_columns is distinct from array[
    'job_id:uuid:true:false', 'attempt_id:uuid:true:false',
    'listing_id:uuid:true:false', 'product_id:uuid:true:false',
    'credential_id:uuid:true:false', 'source_job_id:uuid:true:false',
    'source_attempt_id:uuid:true:false',
    'baseline_update_job_id:uuid:true:false',
    'baseline_response_sha256:text:true:false', 'remote_id:text:true:false',
    'request_fingerprint:text:true:false', 'request_sha256:text:true:false',
    'response_sha256:text:true:false',
    'provider_rejection_code:text:true:false',
    'provider_rejection_message:text:true:false',
    'provider_status:text:true:false', 'remote_visibility:text:true:false',
    'item_title:text:true:false', 'adult_yn:text:true:false',
    'origin_type:text:true:false', 'origin_code:text:true:false',
    'retail_price_jpy:bigint:true:false', 'quantity:integer:true:false',
    'shipping_no:text:true:false', 'detail_image_count:integer:true:false',
    'mismatch_paths:text[]:true:false',
    'provider_changed_date:text:true:false',
    'provider_observed_at:timestamp with time zone:true:false',
    'previous_listing_updated_at:timestamp with time zone:true:false',
    'provider_mutation_accepted:boolean:true:false',
    'provider_call_replayed:boolean:true:false',
    'reconciled_at:timestamp with time zone:true:false'
  ]::text[] then
    raise exception 'Qoo10 AdultYN evidence column post-image mismatch'
      using errcode = '55000';
  end if;

  select array_agg(constraint_row.conname || ':' || constraint_row.contype::text
                   order by constraint_row.conname)
    into v_constraints
    from pg_catalog.pg_constraint constraint_row
   where constraint_row.conrelid = v_table_oid;
  if v_constraints is distinct from array[
    'qoo10_adultyn_reconcile_attempt_fkey:f',
    'qoo10_adultyn_reconcile_baseline_job_fkey:f',
    'qoo10_adultyn_reconcile_credential_fkey:f',
    'qoo10_adultyn_reconcile_exact_observation_check:c',
    'qoo10_adultyn_reconcile_exact_request_check:c',
    'qoo10_adultyn_reconcile_exact_target_check:c',
    'qoo10_adultyn_reconcile_job_fkey:f',
    'qoo10_adultyn_reconcile_listing_fkey:f',
    'qoo10_adultyn_reconcile_product_fkey:f',
    'qoo10_adultyn_reconcile_source_attempt_fkey:f',
    'qoo10_adultyn_reconcile_source_job_fkey:f',
    'qoo10_adultyn_rejection_reconciliations_attempt_id_key:u',
    'qoo10_adultyn_rejection_reconciliations_pkey:p'
  ]::text[] then
    raise exception 'Qoo10 AdultYN evidence constraint post-image mismatch'
      using errcode = '55000';
  end if;
end;
$qoo10_adultyn_evidence_schema_postimage$;

create or replace function
  sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'qoo10_exact_adultyn_rejection_restore_v1',
    'job_id', 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid,
    'attempt_id', 'c19956d8-67d3-465b-90cd-a41b9123ad4e'::uuid,
    'listing_id', '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid,
    'product_id', 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'credential_id', '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid,
    'source_job_id', '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid,
    'source_attempt_id', '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid,
    'baseline_update_job_id', '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid,
    'baseline_response_sha256',
      '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f',
    'remote_id', '1217336970',
    'request_sha256', 'c74ae7bafc7e884b04fd30012f30a834495df4b0cf1e97969dd860f6e878da5e',
    'response_sha256', 'ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad',
    'provider_rejection_code', '-99',
    'provider_rejection_message', 'AdultYNは必須です。',
    'provider_status', 'S1',
    'adult_yn', 'N',
    'detail_image_count', 8,
    'mismatch_paths', jsonb_build_array('ItemDescription.text', 'Keyword'),
    'previous_job_status', 'reconciliation_required',
    'new_job_status', 'succeeded',
    'previous_attempt_status', 'manual_required',
    'new_attempt_status', 'failed',
    'previous_listing_status', 'failed',
    'new_listing_status', 'paused',
    'previous_failure_class', 'external_action',
    'new_failure_class', 'retryable',
    'provider_mutation_accepted', false,
    'provider_call_replayed', false,
    'raw_request_preserved', true,
    'raw_response_preserved', true,
    'completion_receipts_preserved', true,
    'retry_operation', 'listing.update'
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
  from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.qoo10_exact_adultyn_rejection_restore_allowed(
    p_old jsonb,
    p_new jsonb,
    p_job_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listing_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 확인 완료 · AdultYN 포함 listing.update 재시도 필요';
begin
  if p_job_id is distinct from 'c25d3154-4110-4a25-9659-8e56aacf1b8d'
     or jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object' then
    return false;
  end if;

  perform 1
    from sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
    join sellerpilot_private.channel_gateway_jobs job on job.id = evidence.job_id
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = evidence.attempt_id
    join sellerpilot_private.qoo10_listing_create_rollback_confirmations confirmation
      on confirmation.source_job_id = evidence.source_job_id
     and confirmation.source_attempt_id = evidence.source_attempt_id
     and confirmation.listing_id = evidence.listing_id
     and confirmation.credential_id = evidence.credential_id
     and confirmation.remote_id = evidence.remote_id
    join sellerpilot_private.qoo10_listing_update_rejection_observations
      baseline_observation
      on baseline_observation.update_job_id = evidence.baseline_update_job_id
     and baseline_observation.source_job_id = evidence.source_job_id
     and baseline_observation.source_attempt_id = evidence.source_attempt_id
     and baseline_observation.listing_id = evidence.listing_id
     and baseline_observation.credential_id = evidence.credential_id
     and baseline_observation.remote_id = evidence.remote_id
     and baseline_observation.response_sha256 = evidence.baseline_response_sha256
    join sellerpilot_private.operation_audit audit
      on audit.action = 'qoo10_exact_adultyn_rejection_reconciled'
     and audit.entity_type = 'channel_gateway_job'
     and audit.entity_id = evidence.job_id::text
     and audit.owner_id = (p_old->>'owner_id')::uuid
     and audit.safe_detail is not distinct from
       sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
   where evidence.job_id = 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid
     and evidence.attempt_id = 'c19956d8-67d3-465b-90cd-a41b9123ad4e'::uuid
     and evidence.listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and evidence.response_sha256 =
       'ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad'
     and evidence.baseline_response_sha256 =
       '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
     and not evidence.provider_mutation_accepted
     and not evidence.provider_call_replayed
     and baseline_observation.update_attempt_id =
       'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid
     and baseline_observation.provider_rejection_code = '-99'
     and baseline_observation.provider_rejection_reason =
       'ProductionPlaceType_required'
     and baseline_observation.provider_status = 'S1'
     and baseline_observation.observed_origin_type = '2'
     and baseline_observation.observed_origin = 'CN'
     and baseline_observation.observed_retail_price_jpy = 1871
     and baseline_observation.observed_sell_price_jpy = 1871
     and baseline_observation.observed_quantity = 1
     and baseline_observation.source_shipping_no = '0'
     and baseline_observation.observed_shipping_no = '806971'
     and baseline_observation.observed_detail_image_count = 8
     and not baseline_observation.provider_mutation_accepted
     and baseline_observation.observed_at =
       '2026-08-30 15:06:13.213314+00'::timestamptz
     and job.status = 'succeeded'
     and job.error_message is null
     and attempt.status = 'failed'
     and attempt.http_status = 200
     and attempt.remote_id = evidence.remote_id
     and p_old->>'id' = evidence.listing_id::text
     and p_old->>'product_id' = evidence.product_id::text
     and p_old->>'channel_key' = 'qoo10'
     and p_old->>'operation_attempt_id' = evidence.attempt_id::text
     and p_old->>'status' = 'failed'
     and p_old->>'failure_class' = 'external_action'
     and p_old->>'requested_publication_intent' = 'live'
     and p_old->>'remote_visibility' = 'unknown'
     and p_old->'provider_status' = 'null'::jsonb
     and p_old->>'remote_id' = evidence.remote_id
     and p_old->'published_at' = 'null'::jsonb
     and (p_old->>'updated_at')::timestamptz = evidence.previous_listing_updated_at
     and p_new->>'id' = p_old->>'id'
     and p_new->>'product_id' = p_old->>'product_id'
     and p_new->>'owner_id' = p_old->>'owner_id'
     and p_new->>'channel_key' = 'qoo10'
     and p_new->>'operation_attempt_id' = evidence.source_attempt_id::text
     and p_new->>'status' = 'paused'
     and p_new->>'failure_class' = 'retryable'
     and p_new->>'requested_publication_intent' = 'live'
     and p_new->>'remote_visibility' = 'non_public'
     and p_new->>'provider_status' = 'S1'
     and p_new->>'remote_id' = evidence.remote_id
     and p_new->'published_at' = 'null'::jsonb
     and (p_new->>'last_verified_at')::timestamptz = evidence.provider_observed_at
     and p_new->>'last_error' = v_listing_error
     and (p_new->>'updated_at')::timestamptz = evidence.reconciled_at
     and p_new - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'remote_visibility' - 'provider_status' - 'last_verified_at'
           - 'last_error' - 'updated_at'
       = p_old - 'operation_attempt_id' - 'status' - 'failure_class'
           - 'remote_visibility' - 'provider_status' - 'last_verified_at'
           - 'last_error' - 'updated_at';

  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_adultyn_rejection_restore_allowed(jsonb,jsonb,text)
  from public, anon, authenticated, service_role;

-- Add one transaction-local guard branch before the prior exact pre-provider
-- branch. Reconstructing the predecessor must remove the branch byte-exactly.
do $qoo10_adultyn_guard_patch$
declare
  v_definition text;
  v_predecessor text;
  v_anchor constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_preprovider_gate_job'', true), '''') is not null then';
  v_patched constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_adultyn_rejection_job'', true), '''') is not null then
    if not sellerpilot_private.qoo10_exact_adultyn_rejection_restore_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_exact_adultyn_rejection_job'', true)
    ) then
      raise exception ''invalid exact Qoo10 AdultYN rejection restore'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_exact_preprovider_gate_job'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;

  if pg_catalog.strpos(
       v_definition, 'sellerpilot.qoo10_exact_adultyn_rejection_job'
     ) = 0 then
    if sellerpilot_private.qoo10_definition_occurrences(v_definition, v_anchor) <> 1 then
      raise exception 'Qoo10 AdultYN guard predecessor mismatch' using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_anchor, v_patched);
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict v_definition;
  if sellerpilot_private.qoo10_definition_occurrences(v_definition, v_patched) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition, 'sellerpilot.qoo10_exact_adultyn_rejection_job'
     ) <> 2
     or sellerpilot_private.qoo10_definition_occurrences(
       v_definition,
       'sellerpilot_private.qoo10_exact_adultyn_rejection_restore_allowed('
     ) <> 1 then
    raise exception 'Qoo10 AdultYN guard partial post-image' using errcode = '55000';
  end if;
  v_predecessor := pg_catalog.replace(v_definition, v_patched, v_anchor);
  if sellerpilot_private.qoo10_definition_occurrences(v_predecessor, v_anchor) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
       v_predecessor, 'sellerpilot.qoo10_exact_adultyn_rejection_job'
     ) <> 0 then
    raise exception 'Qoo10 AdultYN guard reconstruction mismatch' using errcode = '55000';
  end if;
end;
$qoo10_adultyn_guard_patch$;

do $qoo10_adultyn_catalog_postimage$
declare
  v_owner oid;
  v_signature text;
begin
  select table_class.relowner into strict v_owner
    from pg_catalog.pg_class table_class
   where table_class.oid =
     'sellerpilot_private.qoo10_adultyn_rejection_reconciliations'::regclass;

  foreach v_signature in array array[
    'sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()',
    'sellerpilot_private.qoo10_exact_adultyn_rejection_restore_allowed(jsonb,jsonb,text)'
  ] loop
    if exists (
      select 1
        from aclexplode(coalesce(
          (select procedure.proacl from pg_catalog.pg_proc procedure
            where procedure.oid = v_signature::regprocedure),
          acldefault('f', v_owner)
        )) acl
       where acl.grantee <> v_owner
    ) then
      raise exception 'Qoo10 AdultYN helper ACL mismatch: %', v_signature
        using errcode = '55000';
    end if;
  end loop;

  if exists (
       select 1
         from aclexplode(coalesce(
           (select table_class.relacl from pg_catalog.pg_class table_class
             where table_class.oid =
               'sellerpilot_private.qoo10_adultyn_rejection_reconciliations'::regclass),
           acldefault('r', v_owner)
         )) acl
        where acl.grantee <> v_owner
     )
     or not exists (
       select 1 from pg_catalog.pg_class table_class
        where table_class.oid =
          'sellerpilot_private.qoo10_adultyn_rejection_reconciliations'::regclass
          and table_class.relrowsecurity
     ) then
    raise exception 'Qoo10 AdultYN evidence table ACL mismatch' using errcode = '55000';
  end if;
end;
$qoo10_adultyn_catalog_postimage$;

do $qoo10_exact_adultyn_reconcile$
declare
  v_job_id constant uuid := 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid;
  v_attempt_id constant uuid := 'c19956d8-67d3-465b-90cd-a41b9123ad4e'::uuid;
  v_listing_id constant uuid := '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid;
  v_product_id constant uuid := 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_credential_id constant uuid := '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  v_source_job_id constant uuid := '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid;
  v_source_attempt_id constant uuid := '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid;
  v_baseline_job_id constant uuid := '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid;
  v_remote_id constant text := '1217336970';
  v_seller_key constant text :=
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46';
  v_request_fingerprint constant text :=
    '388a0ed6bed7d1537ee0b4792429b1c796daabe12303681348b5634d1d37b3f9';
  v_request_sha constant text :=
    'c74ae7bafc7e884b04fd30012f30a834495df4b0cf1e97969dd860f6e878da5e';
  v_response_sha constant text :=
    'ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad';
  v_original_error constant text :=
    'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: AdultYNは必須です。';
  v_attempt_message constant text :=
    'Qoo10 UpdateGoods 명시 거부 · AdultYN 누락 확인 · provider acceptance 없음 · S1 비공개 readback 유지';
  v_listing_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 확인 완료 · AdultYN 포함 listing.update 재시도 필요';
  v_observed_at constant timestamptz :=
    '2026-08-30 21:32:29.567929+00'::timestamptz;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_confirmation sellerpilot_private.qoo10_listing_create_rollback_confirmations%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_item jsonb;
  v_receipts_before jsonb;
  v_receipts_after jsonb;
  v_product_before jsonb;
  v_job_after jsonb;
  v_attempt_after jsonb;
  v_listing_after jsonb;
  v_reconciled_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 1415336750);

  if not exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job where job.id = v_job_id
  ) then
    return;
  end if;

  lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
  lock table sellerpilot_private.channel_operation_attempts in share row exclusive mode;
  lock table sellerpilot_private.product_listings in share row exclusive mode;
  lock table sellerpilot_private.operation_audit in share row exclusive mode;
  lock table sellerpilot_private.gateway_completion_receipts in share row exclusive mode;
  lock table sellerpilot_private.qoo10_adultyn_rejection_reconciliations
    in share row exclusive mode;

  select job.* into strict v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = v_job_id for update;
  select attempt.* into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_attempt_id for update;
  select listing.* into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_listing_id for update;
  select confirmation.* into strict v_confirmation
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations confirmation
   where confirmation.source_job_id = v_source_job_id for update;
  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_credential_id for update;
  select to_jsonb(product) into strict v_product_before
    from sellerpilot_private.products product
   where product.id = v_product_id for update;
  select coalesce(jsonb_agg(to_jsonb(receipt) order by receipt.job_id), '[]'::jsonb)
    into v_receipts_before
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = v_job_id;

  if v_job.id is distinct from v_job_id
     or v_job.attempt_id is distinct from v_attempt_id
     or v_job.listing_id is distinct from v_listing_id
     or v_job.credential_id is distinct from v_credential_id
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.environment is distinct from 'production'
     or v_job.request_fingerprint is distinct from v_request_fingerprint
     or v_job.seller_account_key is distinct from v_seller_key
     or v_job.created_at is distinct from '2026-08-30 21:29:28.87921+00'::timestamptz
     or v_job.started_at is distinct from '2026-08-30 21:32:19.498509+00'::timestamptz
     or v_job.provider_mutation_started_at is distinct from
       '2026-08-30 21:32:22.585567+00'::timestamptz
     or v_job.completed_at is distinct from v_observed_at
     or encode(extensions.digest(v_job.request_payload::text, 'sha256'), 'hex')
       is distinct from v_request_sha
     or encode(extensions.digest(v_job.response_payload::text, 'sha256'), 'hex')
       is distinct from v_response_sha then
    raise exception 'exact Qoo10 AdultYN job evidence mismatch' using errcode = '55000';
  end if;

  if v_job.request_payload#>>'{arguments,params,ItemCode}' is distinct from v_remote_id
     or v_job.request_payload#>>'{arguments,params,SecondSubCat}' is distinct from '320000542'
     or v_job.request_payload#>>'{arguments,params,ProductionPlaceType}' is distinct from '2'
     or v_job.request_payload#>>'{arguments,params,ProductionPlace}' is distinct from 'CN'
     or v_job.request_payload#>>'{arguments,params,RetailPrice}' is distinct from '1871'
     or v_job.request_payload#>>'{arguments,params,ShippingNo}' is distinct from '806971'
     or (v_job.request_payload#>'{arguments,params}') ? 'AdultYN'
     or (v_job.request_payload#>'{arguments,params}') ? 'AudultYN'
     or v_job.request_payload#>>'{arguments,publicationIntent}' is distinct from 'live'
     or v_job.request_payload#>>'{arguments,publicationExpectedLocale}' is distinct from 'ja-JP'
     or v_job.request_payload#>>'{arguments,publicationExpectedImageCount}' is distinct from '8'
     or v_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
       is distinct from v_request_fingerprint
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,sourceJobId}'
       is distinct from v_source_job_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,listingId}'
       is distinct from v_listing_id::text
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,remoteId}'
       is distinct from v_remote_id then
    raise exception 'exact Qoo10 AdultYN-missing request mismatch' using errcode = '55000';
  end if;

  if v_job.response_payload->'ok' is distinct from 'false'::jsonb
     or v_job.response_payload->>'channel' is distinct from 'qoo10'
     or v_job.response_payload->>'operation' is distinct from 'listing.update'
     or v_job.response_payload->>'remoteId' is distinct from v_remote_id
     or jsonb_typeof(v_job.response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(v_job.response_payload->'steps') is distinct from 2
     or lower(v_job.response_payload#>>'{steps,0,name}') is distinct from 'updategoods'
     or v_job.response_payload#>'{steps,0,ok}' is distinct from 'false'::jsonb
     or v_job.response_payload#>>'{steps,0,status}' is distinct from '200'
     or v_job.response_payload#>>'{steps,0,data,ResultCode}' is distinct from '-99'
     or v_job.response_payload#>>'{steps,0,data,ResultMsg}' is distinct from 'AdultYNは必須です。'
     or (v_job.response_payload#>'{steps,0,data}') ? 'ResultObject'
     or lower(v_job.response_payload#>>'{steps,1,name}') is distinct from
       'qoo10-rollback-update-rejection-s1-readback'
     or v_job.response_payload#>'{steps,1,ok}' is distinct from 'false'::jsonb
     or v_job.response_payload#>>'{steps,1,data,ResultMsg}' is distinct from
       'QOO10_PUBLICATION_STATE_UNVERIFIED'
     or v_job.response_payload#>>'{steps,1,data,sellerpilotVerification}' is distinct from
       'QOO10_ROLLBACK_UPDATE_REJECTION_S1_UNVERIFIED'
     or v_job.response_payload#>>'{steps,1,data,providerStatus}' is distinct from 'S1'
     or v_job.response_payload#>>'{steps,1,data,actualImageCount}' is distinct from '8'
     or v_job.response_payload#>'{steps,1,data,sellerpilotMismatchPaths}' is distinct from
       '["ItemDescription.text", "Keyword"]'::jsonb then
    raise exception 'exact Qoo10 AdultYN rejection response mismatch' using errcode = '55000';
  end if;

  v_item := v_job.response_payload#>'{steps,1,data,ResultObject}';
  if jsonb_typeof(v_item) = 'array' and jsonb_array_length(v_item) = 1 then
    v_item := v_item->0;
  end if;
  if jsonb_typeof(v_item) is distinct from 'object'
     or coalesce(v_item->>'ItemNo', v_item->>'ItemCode', v_item->>'GdNo')
       is distinct from v_remote_id
     or coalesce(v_item->>'ItemStatus', v_item->>'Status') is distinct from 'S1'
     or v_item->>'ItemTitle' is distinct from '貼り付け式ケーブル整理クリップ6個セット'
     or v_item->>'AdultYN' is distinct from 'N'
     or v_item->>'ProductionPlaceType' is distinct from '2'
     or v_item->>'ProductionPlace' is distinct from 'CN'
     or (v_item->>'RetailPrice')::numeric is distinct from 1871::numeric
     or (v_item->>'ItemQty')::numeric is distinct from 1::numeric
     or v_item->>'ShippingNo' is distinct from '806971'
     or v_item->>'ChangedDate' is distinct from '2026-08-30 21:57:11' then
    raise exception 'exact Qoo10 unchanged S1 AdultYN readback mismatch' using errcode = '55000';
  end if;

  -- Reapplication is accepted only for the exact complete post-state.
  if v_job.status = 'succeeded' then
    if v_job.error_message is not null
       or v_attempt.status is distinct from 'failed'
       or v_attempt.http_status is distinct from 200
       or v_attempt.remote_id is distinct from v_remote_id
       or v_attempt.safe_message is distinct from v_attempt_message
       or not exists (
         select 1 from sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
          where evidence.job_id = v_job_id
            and evidence.attempt_id = v_attempt_id
            and evidence.baseline_update_job_id = v_baseline_job_id
            and evidence.baseline_response_sha256 =
              '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
            and evidence.response_sha256 = v_response_sha
            and not evidence.provider_mutation_accepted
            and not evidence.provider_call_replayed
       )
       or (select count(*) from sellerpilot_private.operation_audit audit
            where audit.action = 'qoo10_exact_adultyn_rejection_reconciled'
              and audit.entity_type = 'channel_gateway_job'
              and audit.entity_id = v_job_id::text
              and audit.safe_detail is not distinct from
                sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()) <> 1 then
      raise exception 'partial exact Qoo10 AdultYN reconciliation state' using errcode = '55000';
    end if;
    return;
  end if;

  if not exists (
    select 1 from sellerpilot_private.listing_mutation_release_gate gate
     where gate.singleton and not gate.is_open and gate.opened_at is null
       and gate.opened_release_sha is null and gate.opened_channel is null
  ) or sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10') then
    raise exception 'exact Qoo10 AdultYN reconciliation requires closed gate'
      using errcode = '55000';
  end if;

  if v_job.status is distinct from 'reconciliation_required'
     or v_job.error_message is distinct from v_original_error
     or v_job.updated_at is distinct from v_observed_at
     or v_job.attempt_count is distinct from 1
     or v_job.worker_token_id is not null
     or v_job.claim_token is not null
     or v_job.lease_expires_at is not null
     or v_attempt.id is distinct from v_attempt_id
     or v_attempt.owner_id is distinct from v_listing.owner_id
     or v_attempt.credential_id is distinct from v_credential_id
     or v_attempt.channel is distinct from 'qoo10'
     or v_attempt.operation is distinct from 'listing.update'
     or v_attempt.status is distinct from 'manual_required'
     or v_attempt.http_status is distinct from 409
     or v_attempt.remote_id is distinct from v_remote_id
     or v_attempt.safe_message is distinct from v_original_error
     or not v_attempt.gateway_write_required
     or v_attempt.pre_gateway_retryable
     or v_attempt.request_fingerprint is distinct from v_request_fingerprint
     or v_attempt.seller_account_key is distinct from v_seller_key
     or v_listing.product_id is distinct from v_product_id
     or v_listing.operation_attempt_id is distinct from v_attempt_id
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.remote_visibility is distinct from 'unknown'
     or v_listing.provider_status is not null
     or v_listing.remote_id is distinct from v_remote_id
     or v_listing.seller_account_key is distinct from v_seller_key
     or v_listing.published_at is not null
     or v_listing.last_error is distinct from v_original_error
     or v_credential.channel is distinct from 'qoo10'
     or v_credential.environment is distinct from 'production'
     or v_credential.status is distinct from 'active'
     or v_credential.seller_account_key is distinct from v_seller_key
     or v_confirmation.source_attempt_id is distinct from v_source_attempt_id
     or v_confirmation.listing_id is distinct from v_listing_id
     or v_confirmation.credential_id is distinct from v_credential_id
     or v_confirmation.remote_id is distinct from v_remote_id
     or v_confirmation.bi_contents_no is distinct from 8461402963
     or v_confirmation.category_code is distinct from '320000542'
     or v_confirmation.retail_price_jpy is distinct from 1871
     or v_confirmation.sell_price_jpy is distinct from 1871
     or v_confirmation.quantity is distinct from 1
     or v_confirmation.shipping_no is distinct from '0'
     or v_confirmation.confirmed_at is distinct from
       '2026-08-30 14:51:26.505498+00'::timestamptz then
    raise exception 'exact Qoo10 AdultYN unresolved state mismatch' using errcode = '55000';
  end if;

  if not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs baseline_job
        where baseline_job.id = v_baseline_job_id
          and baseline_job.listing_id = v_listing_id
          and baseline_job.credential_id = v_credential_id
          and baseline_job.channel = 'qoo10'
          and baseline_job.operation = 'listing.update'
          and baseline_job.status = 'succeeded'
     )
     or not exists (
       select 1
         from sellerpilot_private.qoo10_listing_update_rejection_observations
           baseline_observation
        where baseline_observation.update_job_id = v_baseline_job_id
          and baseline_observation.update_attempt_id =
            'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid
          and baseline_observation.source_job_id = v_source_job_id
          and baseline_observation.source_attempt_id = v_source_attempt_id
          and baseline_observation.listing_id = v_listing_id
          and baseline_observation.credential_id = v_credential_id
          and baseline_observation.remote_id = v_remote_id
          and baseline_observation.response_sha256 =
            '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
          and baseline_observation.provider_rejection_code = '-99'
          and baseline_observation.provider_rejection_reason =
            'ProductionPlaceType_required'
          and baseline_observation.provider_status = 'S1'
          and baseline_observation.observed_origin_type = '2'
          and baseline_observation.observed_origin = 'CN'
          and baseline_observation.observed_retail_price_jpy = 1871
          and baseline_observation.observed_sell_price_jpy = 1871
          and baseline_observation.observed_quantity = 1
          and baseline_observation.source_shipping_no = '0'
          and baseline_observation.observed_shipping_no = '806971'
          and baseline_observation.observed_detail_image_count = 8
          and not baseline_observation.provider_mutation_accepted
          and baseline_observation.observed_at =
            '2026-08-30 15:06:13.213314+00'::timestamptz
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs later_job
        where later_job.listing_id = v_listing_id
          and later_job.operation in ('listing.create','listing.update','listing.stop')
          and later_job.created_at > v_job.created_at
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = v_listing_id
          and active_job.operation in ('listing.create','listing.update','listing.stop')
          and active_job.status in ('queued','running','reconciliation_required')
          and active_job.id <> v_job_id
     )
     or exists (
       select 1 from sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
        where evidence.job_id = v_job_id or evidence.attempt_id = v_attempt_id
     )
     or exists (
       select 1 from sellerpilot_private.operation_audit audit
        where audit.action = 'qoo10_exact_adultyn_rejection_reconciled'
          and audit.entity_type = 'channel_gateway_job'
          and audit.entity_id = v_job_id::text
     ) then
    raise exception 'exact Qoo10 AdultYN baseline observation or mutation ledger mismatch'
      using errcode = '55000';
  end if;

  v_reconciled_at := clock_timestamp();

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'succeeded', error_message = null, updated_at = v_reconciled_at
   where job.id = v_job_id and to_jsonb(job) is not distinct from to_jsonb(v_job);
  if not found then
    raise exception 'exact Qoo10 AdultYN job CAS lost' using errcode = '40001';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed', http_status = 200, safe_message = v_attempt_message
   where attempt.id = v_attempt_id
     and to_jsonb(attempt) is not distinct from to_jsonb(v_attempt);
  if not found then
    raise exception 'exact Qoo10 AdultYN attempt CAS lost' using errcode = '40001';
  end if;

  insert into sellerpilot_private.qoo10_adultyn_rejection_reconciliations (
    job_id, attempt_id, listing_id, product_id, credential_id,
    source_job_id, source_attempt_id, baseline_update_job_id,
    baseline_response_sha256, remote_id,
    request_fingerprint, request_sha256, response_sha256,
    provider_rejection_code, provider_rejection_message, provider_status,
    remote_visibility, item_title, adult_yn, origin_type, origin_code,
    retail_price_jpy, quantity, shipping_no, detail_image_count,
    mismatch_paths, provider_changed_date, provider_observed_at,
    previous_listing_updated_at, provider_mutation_accepted,
    provider_call_replayed, reconciled_at
  ) values (
    v_job_id, v_attempt_id, v_listing_id, v_product_id, v_credential_id,
    v_source_job_id, v_source_attempt_id, v_baseline_job_id,
    '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f',
    v_remote_id,
    v_request_fingerprint, v_request_sha, v_response_sha,
    '-99', 'AdultYNは必須です。', 'S1', 'non_public',
    '貼り付け式ケーブル整理クリップ6個セット', 'N', '2', 'CN',
    1871, 1, '806971', 8, array['ItemDescription.text', 'Keyword']::text[],
    '2026-08-30 21:57:11', v_observed_at, v_listing.updated_at,
    false, false, v_reconciled_at
  );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    'qoo10_exact_adultyn_rejection_reconciled',
    'channel_gateway_job',
    v_job_id::text,
    sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
  );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_exact_adultyn_rejection_job', v_job_id::text, true
  );
  update sellerpilot_private.product_listings listing
     set operation_attempt_id = v_source_attempt_id,
         status = 'paused',
         failure_class = 'retryable',
         remote_visibility = 'non_public',
         provider_status = 'S1',
         published_at = null,
         last_verified_at = v_observed_at,
         last_error = v_listing_error,
         updated_at = v_reconciled_at
   where listing.id = v_listing_id
     and to_jsonb(listing) is not distinct from to_jsonb(v_listing);
  if not found then
    raise exception 'exact Qoo10 AdultYN listing CAS lost' using errcode = '40001';
  end if;

  select to_jsonb(job) into strict v_job_after
    from sellerpilot_private.channel_gateway_jobs job where job.id = v_job_id;
  select to_jsonb(attempt) into strict v_attempt_after
    from sellerpilot_private.channel_operation_attempts attempt where attempt.id = v_attempt_id;
  select to_jsonb(listing) into strict v_listing_after
    from sellerpilot_private.product_listings listing where listing.id = v_listing_id;
  select coalesce(jsonb_agg(to_jsonb(receipt) order by receipt.job_id), '[]'::jsonb)
    into v_receipts_after
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id = v_job_id;

  if v_receipts_after is distinct from v_receipts_before
     or v_job_after - 'status' - 'error_message' - 'updated_at'
       is distinct from to_jsonb(v_job) - 'status' - 'error_message' - 'updated_at'
     or v_job_after->>'status' is distinct from 'succeeded'
     or v_job_after->'error_message' is distinct from 'null'::jsonb
     or v_attempt_after - 'status' - 'http_status' - 'safe_message'
       is distinct from to_jsonb(v_attempt) - 'status' - 'http_status' - 'safe_message'
     or v_attempt_after->>'status' is distinct from 'failed'
     or v_attempt_after->>'http_status' is distinct from '200'
     or v_listing_after - 'operation_attempt_id' - 'status' - 'failure_class'
          - 'remote_visibility' - 'provider_status' - 'published_at'
          - 'last_verified_at' - 'last_error' - 'updated_at'
       is distinct from to_jsonb(v_listing) - 'operation_attempt_id' - 'status'
          - 'failure_class' - 'remote_visibility' - 'provider_status'
          - 'published_at' - 'last_verified_at' - 'last_error' - 'updated_at'
     or v_listing_after->>'operation_attempt_id' is distinct from v_source_attempt_id::text
     or v_listing_after->>'status' is distinct from 'paused'
     or v_listing_after->>'failure_class' is distinct from 'retryable'
     or v_listing_after->>'remote_visibility' is distinct from 'non_public'
     or v_listing_after->>'provider_status' is distinct from 'S1'
     or (select to_jsonb(product) from sellerpilot_private.products product
          where product.id = v_product_id) is distinct from v_product_before
     or (select count(*) from sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
          where evidence.job_id = v_job_id and evidence.attempt_id = v_attempt_id
            and evidence.baseline_update_job_id = v_baseline_job_id
            and evidence.baseline_response_sha256 =
              '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
            and evidence.response_sha256 = v_response_sha
            and not evidence.provider_mutation_accepted
            and not evidence.provider_call_replayed) <> 1
     or (select count(*) from sellerpilot_private.operation_audit audit
          where audit.action = 'qoo10_exact_adultyn_rejection_reconciled'
            and audit.entity_type = 'channel_gateway_job'
            and audit.entity_id = v_job_id::text
            and audit.safe_detail is not distinct from
              sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()) <> 1 then
    raise exception 'exact Qoo10 AdultYN evidence postcondition failed' using errcode = '55000';
  end if;
end;
$qoo10_exact_adultyn_reconcile$;

commit;
