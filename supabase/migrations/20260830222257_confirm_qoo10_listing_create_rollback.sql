-- Convert one provider-uncertain Qoo10 create into a retryable update only
-- after an operator has independently observed the compensating S1 rollback.
-- The function is intentionally private and executable only by a superuser
-- (for example, an explicit Supabase SQL Editor maintenance transaction).

begin;

create table if not exists
  sellerpilot_private.qoo10_listing_create_rollback_confirmations (
    source_job_id uuid primary key,
    source_attempt_id uuid not null,
    listing_id uuid not null,
    credential_id uuid not null,
    request_fingerprint text not null
      check (request_fingerprint ~ '^[a-f0-9]{64}$'),
    credential_fingerprint text not null,
    seller_account_key text not null
      check (seller_account_key ~ '^[a-f0-9]{64}$'),
    remote_id text not null,
    bi_contents_no bigint not null check (bi_contents_no > 0),
    category_code text not null check (category_code ~ '^[0-9]{9}$'),
    retail_price_jpy bigint not null
      check (retail_price_jpy between 1 and 999999999),
    sell_price_jpy bigint not null
      check (sell_price_jpy between 1 and retail_price_jpy),
    quantity integer not null check (quantity between 1 and 99999999),
    shipping_no text not null check (shipping_no ~ '^[0-9]{1,20}$'),
    observed_provider_status text not null
      check (observed_provider_status in ('S1', '1')),
    previous_job_status text not null
      check (previous_job_status = 'reconciliation_required'),
    new_job_status text not null check (new_job_status = 'failed'),
    previous_attempt_status text not null
      check (previous_attempt_status = 'manual_required'),
    new_attempt_status text not null check (new_attempt_status = 'failed'),
    previous_listing_status text not null
      check (previous_listing_status = 'failed'),
    new_listing_status text not null check (new_listing_status = 'paused'),
    previous_failure_class text not null
      check (previous_failure_class = 'external_action'),
    new_failure_class text not null check (new_failure_class = 'retryable'),
    previous_remote_visibility text not null
      check (previous_remote_visibility = 'unknown'),
    new_remote_visibility text not null
      check (new_remote_visibility = 'non_public'),
    previous_provider_status text,
    new_provider_status text not null check (new_provider_status = 'S1'),
    requested_publication_intent text not null
      check (requested_publication_intent = 'live'),
    confirmed_at timestamptz not null
  );

alter table sellerpilot_private.qoo10_listing_create_rollback_confirmations
  enable row level security;
revoke all on table
  sellerpilot_private.qoo10_listing_create_rollback_confirmations
  from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.qoo10_listing_create_rollback_update_allowed(
    p_old jsonb,
    p_new jsonb,
    p_source_job_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_confirmation record;
begin
  if coalesce(p_source_job_id, '') !~ '^[0-9a-fA-F-]{36}$'
     or jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object' then
    return false;
  end if;

  select confirmation.*
    into v_confirmation
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = confirmation.source_job_id
    join sellerpilot_private.channel_operation_attempts source_attempt
      on source_attempt.id = confirmation.source_attempt_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = confirmation.credential_id
   where confirmation.source_job_id = p_source_job_id::uuid
     and confirmation.listing_id = (p_old->>'id')::uuid
     and confirmation.source_attempt_id = (p_old->>'operation_attempt_id')::uuid
     and confirmation.previous_job_status = 'reconciliation_required'
     and confirmation.new_job_status = 'failed'
     and confirmation.previous_attempt_status = 'manual_required'
     and confirmation.new_attempt_status = 'failed'
     and confirmation.previous_listing_status = 'failed'
     and confirmation.new_listing_status = 'paused'
     and confirmation.previous_failure_class = 'external_action'
     and confirmation.new_failure_class = 'retryable'
     and confirmation.previous_remote_visibility = 'unknown'
     and confirmation.new_remote_visibility = 'non_public'
     and confirmation.new_provider_status = 'S1'
     and confirmation.requested_publication_intent = 'live'
     and source_job.id = confirmation.source_job_id
     and source_job.attempt_id = confirmation.source_attempt_id
     and source_job.listing_id = confirmation.listing_id
     and source_job.credential_id = confirmation.credential_id
     and source_job.channel = 'qoo10'
     and source_job.operation = 'listing.create'
     and source_job.environment = 'production'
     and source_job.status = 'reconciliation_required'
     and source_job.request_fingerprint = confirmation.request_fingerprint
     and source_job.seller_account_key = confirmation.seller_account_key
     and source_job.response_payload->>'remoteId' = confirmation.remote_id
     and source_attempt.id = source_job.attempt_id
     and source_attempt.credential_id = source_job.credential_id
     and source_attempt.channel = source_job.channel
     and source_attempt.operation = source_job.operation
     and source_attempt.status = 'manual_required'
     and source_attempt.request_fingerprint = source_job.request_fingerprint
     and source_attempt.seller_account_key = source_job.seller_account_key
     and source_attempt.remote_id = confirmation.remote_id
     and credential.id = source_job.credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.fingerprint = confirmation.credential_fingerprint
     and credential.seller_account_key = confirmation.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     and p_old->>'channel_key' = 'qoo10'
     and p_old->>'status' = confirmation.previous_listing_status
     and p_old->>'failure_class' = confirmation.previous_failure_class
     and p_old->>'remote_visibility' = confirmation.previous_remote_visibility
     and p_old->>'requested_publication_intent'
           = confirmation.requested_publication_intent
     and p_old->>'remote_id' = confirmation.remote_id
     and (
       p_old->'seller_account_key' = 'null'::jsonb
       or p_old->>'seller_account_key' = confirmation.seller_account_key
     )
     and p_new->>'id' = p_old->>'id'
     and p_new->>'channel_key' = 'qoo10'
     and p_new->>'operation_attempt_id'
           = confirmation.source_attempt_id::text
     and p_new->>'status' = confirmation.new_listing_status
     and p_new->>'failure_class' = confirmation.new_failure_class
     and p_new->>'remote_visibility' = confirmation.new_remote_visibility
     and p_new->>'provider_status' = confirmation.new_provider_status
     and p_new->>'requested_publication_intent'
           = confirmation.requested_publication_intent
     and p_new->>'remote_id' = confirmation.remote_id
     and p_new->>'seller_account_key' = confirmation.seller_account_key
     and p_new->'published_at' = 'null'::jsonb
     and (p_new->>'last_verified_at')::timestamptz
           = confirmation.confirmed_at
     and p_new->>'last_error'
           = 'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요'
     and p_new - 'status' - 'seller_account_key' - 'remote_visibility'
           - 'provider_status' - 'published_at' - 'last_verified_at'
           - 'last_error' - 'failure_class' - 'updated_at'
       = p_old - 'status' - 'seller_account_key' - 'remote_visibility'
           - 'provider_status' - 'published_at' - 'last_verified_at'
           - 'last_error' - 'failure_class' - 'updated_at';

  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_listing_create_rollback_update_allowed(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

-- Extend the existing listing immutability trigger by one transaction-local
-- maintenance branch. The marker alone grants nothing: the helper above also
-- requires the exact source reconciliation row and the just-inserted audit.
do $qoo10_rollback_guard_patch$
declare
  v_definition text;
  v_before text;
  v_recovery_branch text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_create_rollback_source_job'', true), '''') is not null then
    if not sellerpilot_private.qoo10_listing_create_rollback_update_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_create_rollback_source_job'', true)
    ) then
      raise exception ''invalid Qoo10 listing create rollback recovery'';
    end if;
    return new;
  end if;';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_create_rollback_source_job'
     ) = 0 then
    -- The full production chain has the source-pending branch. A few bounded
    -- migration tests intentionally omit later publication-review migrations,
    -- so accept only the exact historical guard entry points that exist in
    -- this repository, newest first. The inserted recovery proof is identical
    -- for every supported predecessor.
    if pg_catalog.strpos(
         v_definition,
         'begin
  if nullif(current_setting(''sellerpilot.publication_source_pending_job'', true), '''') is not null then'
       ) > 0 then
      v_before := 'begin
  if nullif(current_setting(''sellerpilot.publication_source_pending_job'', true), '''') is not null then';
    elsif pg_catalog.strpos(
            v_definition,
            'begin
  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then'
          ) > 0 then
      v_before := 'begin
  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then';
    elsif pg_catalog.strpos(
            v_definition,
            'begin
  if current_setting(''sellerpilot.remote_publication_backfill'', true) = ''legacy-unverified-v1'' then'
          ) > 0 then
      v_before := 'begin
  if current_setting(''sellerpilot.remote_publication_backfill'', true) = ''legacy-unverified-v1'' then';
    elsif pg_catalog.strpos(v_definition, 'begin
  if old.seller_account_key is null') > 0 then
      v_before := 'begin
  if old.seller_account_key is null';
    else
      raise exception 'product listing Qoo10 rollback guard entry not found';
    end if;
    execute pg_catalog.replace(
      v_definition,
      v_before,
      v_recovery_branch || pg_catalog.replace(v_before, 'begin', '')
    );
  end if;
end;
$qoo10_rollback_guard_patch$;

create or replace function
  sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(
    p_session_user text,
    p_current_user text,
    p_function_owner text,
    p_session_is_superuser boolean
  )
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_session_is_superuser, false)
    or (
      p_session_user is not distinct from p_current_user
      and p_current_user is not distinct from p_function_owner
    )
$$;

revoke all on function
  sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(
    text, text, text, boolean
  ) from public, anon, authenticated, service_role;

create or replace function
  sellerpilot_private.confirm_qoo10_listing_create_rollback(
    p_source_job_id uuid,
    p_expected_remote_id text,
    p_expected_bi_contents_no bigint,
    p_observed_provider_status text
  )
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_superuser boolean := false;
  v_function_owner text;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_confirmation
    sellerpilot_private.qoo10_listing_create_rollback_confirmations%rowtype;
  v_category_code text;
  v_retail_price_jpy bigint;
  v_sell_price_jpy bigint;
  v_quantity integer;
  v_shipping_no text;
  v_preflight_total integer;
  v_preflight_valid integer;
  v_preflight_ordinal bigint;
  v_set_total integer;
  v_set_valid integer;
  v_set_ordinal bigint;
  v_edit_total integer;
  v_edit_valid integer;
  v_edit_ordinal bigint;
  v_detail_total integer;
  v_detail_valid integer;
  v_detail_ordinal bigint;
  v_rollback_total integer;
  v_rollback_valid integer;
  v_rollback_ordinal bigint;
  v_confirmed_at timestamptz := clock_timestamp();
  v_job_error constant text :=
    'QOO10_LISTING_CREATE_ROLLBACK_CONFIRMED: provider status S1; continue only with listing.update.';
  v_safe_message constant text :=
    'Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.';
  v_listing_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
begin
  select role.rolsuper
    into v_is_superuser
    from pg_catalog.pg_roles role
   where role.rolname = session_user;
  select owner.rolname
    into v_function_owner
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_roles owner
      on owner.oid = procedure.proowner
   where procedure.oid =
     'sellerpilot_private.confirm_qoo10_listing_create_rollback(uuid,text,bigint,text)'::regprocedure;
  if not sellerpilot_private.qoo10_rollback_confirmation_invoker_allowed(
    session_user,
    current_user,
    v_function_owner,
    v_is_superuser
  ) then
    raise exception 'direct function-owner SQL maintenance access required'
      using errcode = '42501';
  end if;

  if p_source_job_id is null
     or p_expected_remote_id is null
     or p_expected_remote_id <> trim(p_expected_remote_id)
     or p_expected_remote_id !~ '^[0-9]{1,40}$'
     or p_expected_bi_contents_no is null
     or p_expected_bi_contents_no <= 0
     or p_observed_provider_status is null
     or p_observed_provider_status not in ('S1', '1') then
    raise exception 'invalid Qoo10 rollback confirmation evidence'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select confirmation.*
    into v_confirmation
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
   where confirmation.source_job_id = p_source_job_id
   for update;
  if found then
    if v_confirmation.remote_id is distinct from p_expected_remote_id
       or v_confirmation.bi_contents_no
            is distinct from p_expected_bi_contents_no
       or v_confirmation.observed_provider_status
            is distinct from p_observed_provider_status then
      raise exception 'Qoo10 rollback confirmation evidence mismatch'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'status', 'confirmed',
      'replayed', true,
      'sourceJobId', v_confirmation.source_job_id,
      'attemptId', v_confirmation.source_attempt_id,
      'listingId', v_confirmation.listing_id,
      'remoteId', v_confirmation.remote_id,
      'biContentsNo', v_confirmation.bi_contents_no,
      'providerStatus', v_confirmation.new_provider_status,
      'confirmedAt', v_confirmation.confirmed_at
    );
  end if;

  select job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_source_job_id
   for update;
  if not found
     or v_job.channel <> 'qoo10'
     or v_job.operation <> 'listing.create'
     or v_job.environment <> 'production'
     or v_job.status <> 'reconciliation_required'
     or v_job.attempt_id is null
     or v_job.listing_id is null
     or v_job.credential_id is null
     or coalesce(v_job.request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or coalesce(v_job.seller_account_key, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(v_job.response_payload) is distinct from 'object'
     or v_job.response_payload->>'channel' is distinct from 'qoo10'
     or v_job.response_payload->>'operation'
          is distinct from 'listing.create'
     or v_job.response_payload->'ok' is distinct from 'false'::jsonb
     or v_job.response_payload->>'remoteId'
          is distinct from p_expected_remote_id
     or jsonb_typeof(v_job.response_payload->'steps')
          is distinct from 'array'
     or v_job.request_payload#>>'{arguments,publicationIntent}'
          is distinct from 'live'
     or v_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
          is distinct from v_job.request_fingerprint
     or jsonb_typeof(v_job.request_payload#>'{arguments,params}')
          is distinct from 'object'
     or jsonb_typeof(
          v_job.request_payload#>'{arguments,sellerpilotQoo10CreateContext}'
        ) is distinct from 'object'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,contract}'
          is distinct from 'sellerpilot_qoo10_listing_create_context_v1'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,market}'
          is distinct from 'JP'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,locale}'
          is distinct from 'ja-JP'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,currency}'
          is distinct from 'JPY'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,price}'
          is distinct from v_job.request_payload#>>'{arguments,params,ItemPrice}'
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,quantity}'
          is distinct from v_job.request_payload#>>'{arguments,params,ItemQty}' then
    raise exception 'source Qoo10 create job evidence mismatch'
      using errcode = '22023';
  end if;

  v_category_code := coalesce(
    v_job.request_payload#>>'{arguments,params,SecondSubCat}', ''
  );
  v_shipping_no := coalesce(
    v_job.request_payload#>>'{arguments,params,ShippingNo}', ''
  );
  if v_category_code !~ '^[0-9]{9}$'
     or v_shipping_no !~ '^[0-9]{1,20}$'
     or coalesce(
          v_job.request_payload#>>'{arguments,params,RetailPrice}', ''
        ) !~ '^[0-9]{1,9}$'
     or coalesce(
          v_job.request_payload#>>'{arguments,params,ItemPrice}', ''
        ) !~ '^[0-9]{1,9}$'
     or coalesce(
          v_job.request_payload#>>'{arguments,params,ItemQty}', ''
        ) !~ '^[0-9]{1,8}$' then
    raise exception 'source Qoo10 create commerce evidence mismatch'
      using errcode = '22023';
  end if;
  begin
    v_retail_price_jpy := (
      v_job.request_payload#>>'{arguments,params,RetailPrice}'
    )::bigint;
    v_sell_price_jpy := (
      v_job.request_payload#>>'{arguments,params,ItemPrice}'
    )::bigint;
    v_quantity := (
      v_job.request_payload#>>'{arguments,params,ItemQty}'
    )::integer;
  exception when others then
    raise exception 'source Qoo10 create commerce evidence mismatch'
      using errcode = '22023';
  end;
  if v_retail_price_jpy not between 1 and 999999999
     or v_sell_price_jpy not between 1 and v_retail_price_jpy
     or v_quantity not between 1 and 99999999 then
    raise exception 'source Qoo10 create commerce evidence mismatch'
      using errcode = '22023';
  end if;

  select attempt.*
    into v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_job.attempt_id
   for update;
  if not found
     or v_attempt.credential_id is distinct from v_job.credential_id
     or v_attempt.channel is distinct from v_job.channel
     or v_attempt.operation is distinct from v_job.operation
     or v_attempt.status is distinct from 'manual_required'
     or not v_attempt.gateway_write_required
     or v_attempt.pre_gateway_retryable
     or v_attempt.request_fingerprint is distinct from v_job.request_fingerprint
     or v_attempt.seller_account_key is distinct from v_job.seller_account_key
     or v_attempt.remote_id is distinct from p_expected_remote_id then
    raise exception 'source Qoo10 create attempt evidence mismatch'
      using errcode = '22023';
  end if;

  select listing.*
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_job.listing_id
   for update;
  if not found
     or v_listing.operation_attempt_id is distinct from v_attempt.id
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.remote_visibility is distinct from 'unknown'
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.remote_id is distinct from p_expected_remote_id
     or (
       v_listing.seller_account_key is not null
       and v_listing.seller_account_key <> v_job.seller_account_key
     ) then
    raise exception 'source Qoo10 listing evidence mismatch'
      using errcode = '22023';
  end if;

  select credential.*
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_job.credential_id
   for update;
  if not found
     or v_credential.channel is distinct from 'qoo10'
     or v_credential.environment is distinct from 'production'
     or v_credential.status is distinct from 'active'
     or (
       v_credential.expires_at is not null
       and v_credential.expires_at <= v_confirmed_at
     )
     or v_credential.seller_account_key is distinct from v_job.seller_account_key
     or v_credential.seller_account_key_source is null
     or v_credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     or v_credential.seller_account_verified_at is null
     or nullif(trim(v_credential.fingerprint), '') is null then
    raise exception 'source Qoo10 credential evidence mismatch'
      using errcode = '22023';
  end if;

  select
    count(*) filter (
      where lower(coalesce(entry.step->>'name', ''))
        = 'qoo10-create-contract-preflight'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', ''))
        = 'qoo10-create-contract-preflight'
        and entry.step->'ok' = 'true'::jsonb
        and entry.step#>>'{data,categoryCode}' = v_category_code
        and entry.step#>>'{data,price}' = v_sell_price_jpy::text
        and entry.step#>>'{data,quantity}' = v_quantity::text
        and entry.step#>>'{data,shippingNo}' = v_shipping_no
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', ''))
        = 'qoo10-create-contract-preflight'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'setnewgoods'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'setnewgoods'
        and entry.step->'ok' = 'true'::jsonb
        and entry.step#>>'{data,ResultObject,GdNo}' = p_expected_remote_id
        and coalesce(
              entry.step#>>'{data,ResultObject,BIContentsNo}', ''
            ) ~ '^[0-9]+$'
        and (entry.step#>>'{data,ResultObject,BIContentsNo}')::numeric
              = p_expected_bi_contents_no::numeric
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'setnewgoods'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'editgoodscontents'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'editgoodscontents'
        and entry.step->'ok' = 'true'::jsonb
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'editgoodscontents'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'detail-image-readback'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'detail-image-readback'
        and entry.step->'ok' = 'false'::jsonb
        and entry.step#>>'{data,detailImageCount}' = '8'
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'detail-image-readback'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'rollback-missing-detail'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'rollback-missing-detail'
        and entry.step->'ok' = 'true'::jsonb
        and entry.step#>>'{data,ResultCode}' = '0'
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'rollback-missing-detail'
    )
    into v_preflight_total, v_preflight_valid, v_preflight_ordinal,
         v_set_total, v_set_valid, v_set_ordinal,
         v_edit_total, v_edit_valid, v_edit_ordinal,
         v_detail_total, v_detail_valid, v_detail_ordinal,
         v_rollback_total, v_rollback_valid, v_rollback_ordinal
    from jsonb_array_elements(v_job.response_payload->'steps')
      with ordinality as entry(step, ordinality);

  if v_preflight_total <> 1 or v_preflight_valid <> 1
     or v_set_total <> 1 or v_set_valid <> 1
     or v_edit_total <> 1 or v_edit_valid <> 1
     or v_detail_total <> 1 or v_detail_valid <> 1
     or v_rollback_total <> 1 or v_rollback_valid <> 1
     or not (
       v_preflight_ordinal < v_set_ordinal
       and v_set_ordinal < v_edit_ordinal
       and v_edit_ordinal < v_detail_ordinal
       and v_detail_ordinal < v_rollback_ordinal
     ) then
    raise exception 'Qoo10 create and rollback steps evidence mismatch'
      using errcode = '22023';
  end if;

  insert into
    sellerpilot_private.qoo10_listing_create_rollback_confirmations (
      source_job_id,
      source_attempt_id,
      listing_id,
      credential_id,
      request_fingerprint,
      credential_fingerprint,
      seller_account_key,
      remote_id,
      bi_contents_no,
      category_code,
      retail_price_jpy,
      sell_price_jpy,
      quantity,
      shipping_no,
      observed_provider_status,
      previous_job_status,
      new_job_status,
      previous_attempt_status,
      new_attempt_status,
      previous_listing_status,
      new_listing_status,
      previous_failure_class,
      new_failure_class,
      previous_remote_visibility,
      new_remote_visibility,
      previous_provider_status,
      new_provider_status,
      requested_publication_intent,
      confirmed_at
    ) values (
      v_job.id,
      v_attempt.id,
      v_listing.id,
      v_credential.id,
      v_job.request_fingerprint,
      v_credential.fingerprint,
      v_job.seller_account_key,
      p_expected_remote_id,
      p_expected_bi_contents_no,
      v_category_code,
      v_retail_price_jpy,
      v_sell_price_jpy,
      v_quantity,
      v_shipping_no,
      p_observed_provider_status,
      v_job.status,
      'failed',
      v_attempt.status,
      'failed',
      v_listing.status,
      'paused',
      v_listing.failure_class,
      'retryable',
      v_listing.remote_visibility,
      'non_public',
      v_listing.provider_status,
      'S1',
      v_listing.requested_publication_intent,
      v_confirmed_at
    );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_create_rollback_source_job',
    v_job.id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set status = 'paused',
         seller_account_key = v_job.seller_account_key,
         remote_visibility = 'non_public',
         provider_status = 'S1',
         published_at = null,
         last_verified_at = v_confirmed_at,
         failure_class = 'retryable',
         last_error = v_listing_error,
         updated_at = v_confirmed_at
   where listing.id = v_listing.id
     and listing.operation_attempt_id = v_attempt.id
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.remote_visibility = 'unknown'
     and listing.requested_publication_intent = 'live'
     and listing.remote_id = p_expected_remote_id
     and (
       listing.seller_account_key is null
       or listing.seller_account_key = v_job.seller_account_key
     );
  if not found then
    raise exception 'Qoo10 listing rollback recovery update lost its fence'
      using errcode = '40001';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed',
         http_status = 409,
         remote_id = p_expected_remote_id,
         safe_message = v_safe_message,
         pre_gateway_retryable = false,
         completed_at = v_confirmed_at
   where attempt.id = v_attempt.id
     and attempt.status = 'manual_required'
     and attempt.credential_id = v_credential.id
     and attempt.request_fingerprint = v_job.request_fingerprint
     and attempt.seller_account_key = v_job.seller_account_key;
  if not found then
    raise exception 'Qoo10 create attempt rollback recovery lost its fence'
      using errcode = '40001';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'failed',
         error_message = v_job_error,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = coalesce(job.completed_at, v_confirmed_at),
         updated_at = v_confirmed_at
   where job.id = v_job.id
     and job.status = 'reconciliation_required'
     and job.attempt_id = v_attempt.id
     and job.listing_id = v_listing.id
     and job.credential_id = v_credential.id
     and job.request_fingerprint = v_attempt.request_fingerprint
     and job.seller_account_key = v_credential.seller_account_key
     and job.response_payload->>'remoteId' = p_expected_remote_id;
  if not found then
    raise exception 'Qoo10 source job rollback recovery lost its fence'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'status', 'confirmed',
    'replayed', false,
    'sourceJobId', v_job.id,
    'attemptId', v_attempt.id,
    'listingId', v_listing.id,
    'remoteId', p_expected_remote_id,
    'biContentsNo', p_expected_bi_contents_no,
    'providerStatus', 'S1',
    'confirmedAt', v_confirmed_at
  );
end;
$$;

revoke all on function
  sellerpilot_private.confirm_qoo10_listing_create_rollback(
    uuid, text, bigint, text
  ) from public, anon, authenticated, service_role;

comment on function
  sellerpilot_private.confirm_qoo10_listing_create_rollback(
    uuid, text, bigint, text
  ) is 'Direct owner or superuser SQL maintenance only: exact-evidence confirmation of a Qoo10 S1 create rollback that preserves the remote id and enables a later listing.update without issuing another create.';

-- The application may read only the bounded authorization result. It never
-- receives the rollback audit, source response, seller lineage digest, or any
-- credential material. Every mismatch returns the same identifier-free block.
create or replace function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    p_listing_id uuid,
    p_credential_id uuid,
    p_product_id uuid,
    p_market text,
    p_target_id text
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_contract constant text := 'qoo10_create_rollback_confirmation_v1';
begin
  if p_listing_id is null
     or p_credential_id is null
     or p_product_id is null
     or p_market is null
     or p_market <> trim(p_market)
     or p_market !~ '^[A-Z]{2}$'
     or p_target_id is null
     or p_target_id <> trim(p_target_id)
     or length(p_target_id) > 160 then
    return jsonb_build_object(
      'status', 'blocked',
      'contract', v_contract
    );
  end if;

  select listing.id as listing_id,
         listing.remote_id,
         listing.provider_status,
         confirmation.source_job_id,
         confirmation.category_code,
         confirmation.retail_price_jpy,
         confirmation.sell_price_jpy,
         confirmation.quantity,
         confirmation.shipping_no,
         confirmation.bi_contents_no
    into v_identity
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.product_listings listing
      on listing.id = confirmation.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = confirmation.credential_id
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = confirmation.source_job_id
    join sellerpilot_private.channel_operation_attempts source_attempt
      on source_attempt.id = confirmation.source_attempt_id
   where confirmation.listing_id = p_listing_id
     and confirmation.credential_id = p_credential_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'qoo10'
     and listing.market = p_market
     and listing.target_id = p_target_id
     and listing.status = 'paused'
     and listing.failure_class = 'retryable'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'non_public'
     and listing.provider_status = 'S1'
     and listing.published_at is null
     and listing.last_verified_at = confirmation.confirmed_at
     and listing.last_error =
       'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요'
     and listing.remote_id = confirmation.remote_id
     and listing.seller_account_key = confirmation.seller_account_key
     and listing.operation_attempt_id = confirmation.source_attempt_id
     and product.id = p_product_id
     and product.owner_id = listing.owner_id
     and not product.demo
     and product.status <> 'archived'
     and credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (
       credential.expires_at is null
       or credential.expires_at > statement_timestamp()
     )
     and credential.fingerprint = confirmation.credential_fingerprint
     and credential.seller_account_key = confirmation.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and confirmation.request_fingerprint ~ '^[a-f0-9]{64}$'
     and confirmation.observed_provider_status in ('S1', '1')
     and confirmation.previous_job_status = 'reconciliation_required'
     and confirmation.new_job_status = 'failed'
     and confirmation.previous_attempt_status = 'manual_required'
     and confirmation.new_attempt_status = 'failed'
     and confirmation.previous_listing_status = 'failed'
     and confirmation.new_listing_status = 'paused'
     and confirmation.previous_failure_class = 'external_action'
     and confirmation.new_failure_class = 'retryable'
     and confirmation.previous_remote_visibility = 'unknown'
     and confirmation.new_remote_visibility = 'non_public'
     and confirmation.new_provider_status = 'S1'
     and confirmation.requested_publication_intent = 'live'
     and source_job.id = confirmation.source_job_id
     and source_job.attempt_id = confirmation.source_attempt_id
     and source_job.listing_id = confirmation.listing_id
     and source_job.credential_id = confirmation.credential_id
     and source_job.channel = 'qoo10'
     and source_job.operation = 'listing.create'
     and source_job.environment = 'production'
     and source_job.status = 'failed'
     and source_job.error_message =
       'QOO10_LISTING_CREATE_ROLLBACK_CONFIRMED: provider status S1; continue only with listing.update.'
     and source_job.request_fingerprint = confirmation.request_fingerprint
     and source_job.seller_account_key = confirmation.seller_account_key
     and source_job.response_payload->>'channel' = 'qoo10'
     and source_job.response_payload->>'operation' = 'listing.create'
     and source_job.response_payload->'ok' = 'false'::jsonb
     and source_job.response_payload->>'remoteId' = confirmation.remote_id
     and source_job.request_payload#>>'{arguments,publicationIntent}' = 'live'
     and source_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
           = confirmation.request_fingerprint
     and source_job.request_payload#>>'{arguments,params,SecondSubCat}'
           = confirmation.category_code
     and source_job.request_payload#>>'{arguments,params,RetailPrice}'
           = confirmation.retail_price_jpy::text
     and source_job.request_payload#>>'{arguments,params,ItemPrice}'
           = confirmation.sell_price_jpy::text
     and source_job.request_payload#>>'{arguments,params,ItemQty}'
           = confirmation.quantity::text
     and source_job.request_payload#>>'{arguments,params,ShippingNo}'
           = confirmation.shipping_no
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,contract}'
           = 'sellerpilot_qoo10_listing_create_context_v1'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,market}'
           = 'JP'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,locale}'
           = 'ja-JP'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,currency}'
           = 'JPY'
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,price}'
           = confirmation.sell_price_jpy::text
     and source_job.request_payload#>>'{arguments,sellerpilotQoo10CreateContext,quantity}'
           = confirmation.quantity::text
     and jsonb_typeof(source_job.response_payload->'steps') = 'array'
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', ''))
          = 'qoo10-create-contract-preflight'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', ''))
          = 'qoo10-create-contract-preflight'
          and step->'ok' = 'true'::jsonb
          and step#>>'{data,categoryCode}' = confirmation.category_code
          and step#>>'{data,price}' = confirmation.sell_price_jpy::text
          and step#>>'{data,quantity}' = confirmation.quantity::text
          and step#>>'{data,shippingNo}' = confirmation.shipping_no
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'setnewgoods'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'setnewgoods'
          and step->'ok' = 'true'::jsonb
          and step#>>'{data,ResultObject,GdNo}' = confirmation.remote_id
          and step#>>'{data,ResultObject,BIContentsNo}'
                = confirmation.bi_contents_no::text
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'editgoodscontents'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'editgoodscontents'
          and step->'ok' = 'true'::jsonb
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'detail-image-readback'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'detail-image-readback'
          and step->'ok' = 'false'::jsonb
          and step#>>'{data,detailImageCount}' = '8'
     )
     and (
       select count(*)
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'rollback-missing-detail'
     ) = 1
     and exists (
       select 1
         from jsonb_array_elements(source_job.response_payload->'steps') step
        where lower(coalesce(step->>'name', '')) = 'rollback-missing-detail'
          and step->'ok' = 'true'::jsonb
          and step#>>'{data,ResultCode}' = '0'
     )
     and source_attempt.id = source_job.attempt_id
     and source_attempt.owner_id = listing.owner_id
     and source_attempt.credential_id = source_job.credential_id
     and source_attempt.channel = source_job.channel
     and source_attempt.operation = source_job.operation
     and source_attempt.status = 'failed'
     and source_attempt.http_status = 409
     and source_attempt.gateway_write_required
     and not source_attempt.pre_gateway_retryable
     and source_attempt.remote_id = confirmation.remote_id
     and source_attempt.request_fingerprint = source_job.request_fingerprint
     and source_attempt.seller_account_key = source_job.seller_account_key
     and source_attempt.safe_message =
       'Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.';

  if not found then
    return jsonb_build_object(
      'status', 'blocked',
      'contract', v_contract
    );
  end if;

  return jsonb_build_object(
    'status', 'allowed',
    'contract', v_contract,
    'listingId', v_identity.listing_id,
    'remoteId', v_identity.remote_id,
    'providerStatus', v_identity.provider_status,
    'sourceJobId', v_identity.source_job_id,
    'expectedState', jsonb_build_object(
      'categoryCode', v_identity.category_code,
      'retailPriceJpy', v_identity.retail_price_jpy,
      'sellPriceJpy', v_identity.sell_price_jpy,
      'quantity', v_identity.quantity,
      'shippingNo', v_identity.shipping_no,
      'biContentsNo', v_identity.bi_contents_no
    )
  );
exception when others then
  return jsonb_build_object(
    'status', 'blocked',
    'contract', v_contract
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

comment on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) is 'Service-only identifier-minimizing readback of an exact Qoo10 create rollback confirmation for a later listing.update preflight.';

-- A provider-declared UpdateGoods rejection can be retried only after a
-- separate read-only call proves that the exact confirmed S1 item, commerce
-- values, representative image, and eight detail images are unchanged. This
-- helper is also the trigger authorization for rewinding only the listing
-- pointer; the failed update job and attempt remain immutable audit evidence.
create or replace function
  sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(
    p_old jsonb,
    p_new jsonb,
    p_update_job_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fixed_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
begin
  if coalesce(p_update_job_id, '') !~ '^[0-9a-fA-F-]{36}$'
     or jsonb_typeof(p_old) <> 'object'
     or jsonb_typeof(p_new) <> 'object' then
    return false;
  end if;

  perform 1
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.channel_gateway_jobs update_job
      on update_job.id = p_update_job_id::uuid
    join sellerpilot_private.channel_operation_attempts update_attempt
      on update_attempt.id = update_job.attempt_id
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = confirmation.source_job_id
    join sellerpilot_private.channel_operation_attempts source_attempt
      on source_attempt.id = confirmation.source_attempt_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = confirmation.credential_id
   where confirmation.listing_id = (p_old->>'id')::uuid
     and confirmation.credential_id = update_job.credential_id
     and update_job.listing_id = confirmation.listing_id
     and update_job.channel = 'qoo10'
     and update_job.operation = 'listing.update'
     and update_job.environment = 'production'
     and update_job.status = 'succeeded'
     and update_job.request_fingerprint ~ '^[a-f0-9]{64}$'
     and update_job.seller_account_key = confirmation.seller_account_key
     and update_job.created_at >= confirmation.confirmed_at
     and jsonb_typeof(update_job.request_payload) = 'object'
     and update_job.request_payload#>'{arguments,sellerpilotQoo10RollbackUpdateRecovery}'
           = jsonb_build_object(
               'status', 'allowed',
               'contract', 'qoo10_create_rollback_confirmation_v1',
               'listingId', confirmation.listing_id,
               'remoteId', confirmation.remote_id,
               'providerStatus', 'S1',
               'sourceJobId', confirmation.source_job_id,
               'expectedState', jsonb_build_object(
                 'categoryCode', confirmation.category_code,
                 'retailPriceJpy', confirmation.retail_price_jpy,
                 'sellPriceJpy', confirmation.sell_price_jpy,
                 'quantity', confirmation.quantity,
                 'shippingNo', confirmation.shipping_no,
                 'biContentsNo', confirmation.bi_contents_no
               )
             )
     and update_job.request_payload#>>'{arguments,params,ItemCode}'
           = confirmation.remote_id
     and update_job.request_payload#>>'{arguments,publicationIntent}' = 'live'
     and update_job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
           = update_job.request_fingerprint
     and jsonb_typeof(update_job.response_payload) = 'object'
     and update_job.response_payload->'ok' = 'false'::jsonb
     and update_job.response_payload->>'channel' = 'qoo10'
     and update_job.response_payload->>'operation' = 'listing.update'
     and update_job.response_payload->>'remoteId' = confirmation.remote_id
     and jsonb_typeof(update_job.response_payload->'steps') = 'array'
     and jsonb_array_length(update_job.response_payload->'steps') = 2
     and lower(update_job.response_payload#>>'{steps,0,name}') = 'updategoods'
     and update_job.response_payload#>'{steps,0,ok}' = 'false'::jsonb
     and coalesce(update_job.response_payload#>>'{steps,0,status}', '')
           ~ '^[0-9]{3}$'
     and (update_job.response_payload#>>'{steps,0,status}')::integer
           between 200 and 299
     and coalesce(
           update_job.response_payload#>>'{steps,0,data,ResultCode}', ''
         ) ~ '^-?[0-9]+$'
     and (update_job.response_payload#>>'{steps,0,data,ResultCode}')::numeric
           not in (0, -9999)
     and coalesce(
           update_job.response_payload#>>'{steps,0,data,sellerpilotMutation}', ''
         ) <> 'accepted'
     and coalesce(
           update_job.response_payload#>>'{steps,0,data,sellerpilotReconciliationRequired}',
           'false'
         ) <> 'true'
     and lower(update_job.response_payload#>>'{steps,1,name}')
           = 'qoo10-rollback-update-rejection-s1-readback'
     and update_job.response_payload#>'{steps,1,ok}' = 'true'::jsonb
     and update_job.response_payload#>>'{steps,1,data,sellerpilotVerification}'
           = 'QOO10_ROLLBACK_UPDATE_REJECTION_S1_VERIFIED'
     and update_job.response_payload#>>'{steps,1,data,providerStatus}' = 'S1'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotExpectedProviderStatus}'
           = 'S1'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotExactDetailImageCount}'
           = '8'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,identityVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,statusVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,sellerCodeVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,localeVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,fingerprintVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,imageCountVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,sellerAccountIdentityVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,categoryVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,titleVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,shippingVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,retailPriceVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,priceQuantityVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,representativeImageVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,detailImageDigestVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,recoveryExpectationVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,sellPriceVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,quantityVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,confirmedBiCdnImageVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,detailImageUrlsVerified}'
           = 'true'
     and update_job.response_payload#>>'{steps,1,data,sellerpilotMutableVerification}'
           = 'LISTING_MUTABLE_FIELDS_VERIFIED'
     and update_attempt.id = update_job.attempt_id
     and update_attempt.credential_id = confirmation.credential_id
     and update_attempt.channel = 'qoo10'
     and update_attempt.operation = 'listing.update'
     and update_attempt.status = 'failed'
     and update_attempt.gateway_write_required
     and not update_attempt.pre_gateway_retryable
     and update_attempt.request_fingerprint = update_job.request_fingerprint
     and update_attempt.seller_account_key = confirmation.seller_account_key
     and source_job.id = confirmation.source_job_id
     and source_job.attempt_id = confirmation.source_attempt_id
     and source_job.listing_id = confirmation.listing_id
     and source_job.credential_id = confirmation.credential_id
     and source_job.channel = 'qoo10'
     and source_job.operation = 'listing.create'
     and source_job.status = 'failed'
     and source_attempt.id = confirmation.source_attempt_id
     and source_attempt.status = 'failed'
     and credential.id = confirmation.credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.fingerprint = confirmation.credential_fingerprint
     and credential.seller_account_key = confirmation.seller_account_key
     and p_old->>'id' = confirmation.listing_id::text
     and p_old->>'channel_key' = 'qoo10'
     and p_old->>'operation_attempt_id' = update_attempt.id::text
     and p_old->>'status' = 'failed'
     and p_old->>'failure_class' = 'retryable'
     and p_old->>'requested_publication_intent' = 'live'
     and p_old->>'remote_visibility' = 'non_public'
     and p_old->>'provider_status' = 'S1'
     and p_old->>'remote_id' = confirmation.remote_id
     and p_old->>'seller_account_key' = confirmation.seller_account_key
     and p_old->'published_at' = 'null'::jsonb
     and (p_old->>'last_verified_at')::timestamptz
           = confirmation.confirmed_at
     and p_new->>'id' = p_old->>'id'
     and p_new->>'channel_key' = 'qoo10'
     and p_new->>'operation_attempt_id' = confirmation.source_attempt_id::text
     and p_new->>'status' = 'paused'
     and p_new->>'failure_class' = 'retryable'
     and p_new->>'requested_publication_intent' = 'live'
     and p_new->>'remote_visibility' = 'non_public'
     and p_new->>'provider_status' = 'S1'
     and p_new->>'remote_id' = confirmation.remote_id
     and p_new->>'seller_account_key' = confirmation.seller_account_key
     and p_new->'published_at' = 'null'::jsonb
     and (p_new->>'last_verified_at')::timestamptz
           = confirmation.confirmed_at
     and p_new->>'last_error' = v_fixed_error
     and p_new - 'status' - 'operation_attempt_id' - 'last_error' - 'updated_at'
       = p_old - 'status' - 'operation_attempt_id' - 'last_error' - 'updated_at';

  return found;
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

do $qoo10_retry_restore_guard_patch$
declare
  v_definition text;
  v_before constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_create_rollback_source_job'', true), '''') is not null then';
  v_after constant text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_rollback_retry_job'', true), '''') is not null then
    if not sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_rollback_retry_job'', true)
    ) then
      raise exception ''invalid Qoo10 rollback update retry restore'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_create_rollback_source_job'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_rollback_retry_job'
     ) = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'product listing Qoo10 retry restore guard entry not found';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$qoo10_retry_restore_guard_patch$;

-- Route preflight is intentionally not the enqueue authority. Image
-- normalization and attempt creation happen after that read, so another
-- operation could otherwise change the listing before the gateway job is
-- inserted. Recheck the server-owned recovery binding while the exact ledger
-- rows are locked in the enqueue transaction, then delegate to the unchanged
-- verified-publication enqueue implementation.
alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence;

revoke all on function
  public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker jsonb := p_request_payload#>'{arguments,sellerpilotQoo10RollbackUpdateRecovery}';
  v_expected_state jsonb := p_request_payload#>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState}';
  v_marker_key_count integer := 0;
  v_expected_state_key_count integer := 0;
  v_recovery_state boolean := false;
  v_product_id uuid;
  v_market text;
  v_target_id text;
  v_identity jsonb;
  v_expected_identity jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_channel = 'qoo10' and p_operation = 'listing.update' then
    select listing.status = 'paused'
           and listing.failure_class = 'retryable'
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'non_public'
           and listing.provider_status = 'S1'
           and listing.published_at is null
      into v_recovery_state
      from sellerpilot_private.product_listings listing
     where listing.id = p_listing_id
       and listing.channel_key = 'qoo10'
     for update;
    if not found then
      raise exception 'QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH';
    end if;

    if v_recovery_state or v_marker is not null then
      if jsonb_typeof(v_marker) is distinct from 'object'
         or jsonb_typeof(v_marker->'status') is distinct from 'string'
         or jsonb_typeof(v_marker->'contract') is distinct from 'string'
         or jsonb_typeof(v_marker->'listingId') is distinct from 'string'
         or jsonb_typeof(v_marker->'remoteId') is distinct from 'string'
         or jsonb_typeof(v_marker->'providerStatus') is distinct from 'string'
         or jsonb_typeof(v_marker->'sourceJobId') is distinct from 'string'
         or jsonb_typeof(v_marker->'expectedState') is distinct from 'object'
         or v_marker->>'status' <> 'allowed'
         or v_marker->>'contract' <>
              'qoo10_create_rollback_confirmation_v1'
         or v_marker->>'providerStatus' <> 'S1'
         or coalesce(v_marker->>'listingId', '')
              !~ '^[0-9a-fA-F-]{36}$'
         or coalesce(v_marker->>'sourceJobId', '')
              !~ '^[0-9a-fA-F-]{36}$'
         or coalesce(v_marker->>'remoteId', '') !~ '^[0-9]{1,40}$'
         or jsonb_typeof(v_expected_state->'categoryCode')
              is distinct from 'string'
         or coalesce(v_expected_state->>'categoryCode', '') !~ '^[0-9]{9}$'
         or jsonb_typeof(v_expected_state->'retailPriceJpy')
              is distinct from 'number'
         or coalesce(v_expected_state->>'retailPriceJpy', '')
              !~ '^[1-9][0-9]{0,8}$'
         or jsonb_typeof(v_expected_state->'sellPriceJpy')
              is distinct from 'number'
         or coalesce(v_expected_state->>'sellPriceJpy', '')
              !~ '^[1-9][0-9]{0,8}$'
         or jsonb_typeof(v_expected_state->'quantity')
              is distinct from 'number'
         or coalesce(v_expected_state->>'quantity', '')
              !~ '^[1-9][0-9]{0,7}$'
         or jsonb_typeof(v_expected_state->'shippingNo')
              is distinct from 'string'
         or coalesce(v_expected_state->>'shippingNo', '')
              !~ '^[0-9]{1,20}$'
         or jsonb_typeof(v_expected_state->'biContentsNo')
              is distinct from 'number'
         or coalesce(v_expected_state->>'biContentsNo', '')
              !~ '^[1-9][0-9]{5,15}$' then
        raise exception 'QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH';
      end if;
      select count(*)
        into v_marker_key_count
        from jsonb_object_keys(v_marker);
      select count(*)
        into v_expected_state_key_count
        from jsonb_object_keys(v_expected_state);
      if v_marker_key_count <> 7
         or v_expected_state_key_count <> 6
         or (v_expected_state->>'sellPriceJpy')::bigint
              > (v_expected_state->>'retailPriceJpy')::bigint
         or (v_marker->>'listingId')::uuid <> p_listing_id
         or p_request_payload#>>'{arguments,params,ItemCode}'
              <> v_marker->>'remoteId'
         or p_request_payload#>>'{arguments,params,SecondSubCat}'
              <> v_expected_state->>'categoryCode'
         or p_request_payload#>>'{arguments,params,RetailPrice}'
              <> v_expected_state->>'retailPriceJpy'
         or p_request_payload#>>'{arguments,params,ShippingNo}'
              <> v_expected_state->>'shippingNo' then
        raise exception 'QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH';
      end if;

      select listing.product_id, listing.market, listing.target_id
        into v_product_id, v_market, v_target_id
        from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          confirmation
        join sellerpilot_private.product_listings listing
          on listing.id = confirmation.listing_id
        join sellerpilot_private.products product
          on product.id = listing.product_id
        join sellerpilot_private.channel_credentials credential
          on credential.id = confirmation.credential_id
        join sellerpilot_private.channel_gateway_jobs source_job
          on source_job.id = confirmation.source_job_id
        join sellerpilot_private.channel_operation_attempts source_attempt
          on source_attempt.id = confirmation.source_attempt_id
        join sellerpilot_private.channel_operation_attempts update_attempt
          on update_attempt.id = p_attempt_id
       where confirmation.listing_id = p_listing_id
         and confirmation.credential_id = p_credential_id
         and confirmation.source_job_id = (v_marker->>'sourceJobId')::uuid
         and confirmation.remote_id = v_marker->>'remoteId'
         and confirmation.new_provider_status = 'S1'
         and confirmation.category_code = v_expected_state->>'categoryCode'
         and confirmation.retail_price_jpy::text
               = v_expected_state->>'retailPriceJpy'
         and confirmation.sell_price_jpy::text
               = v_expected_state->>'sellPriceJpy'
         and confirmation.quantity::text = v_expected_state->>'quantity'
         and confirmation.shipping_no = v_expected_state->>'shippingNo'
         and confirmation.bi_contents_no::text
               = v_expected_state->>'biContentsNo'
         and listing.id = p_listing_id
         and listing.channel_key = 'qoo10'
         and listing.status = 'paused'
         and listing.failure_class = 'retryable'
         and listing.requested_publication_intent = 'live'
         and listing.remote_visibility = 'non_public'
         and listing.provider_status = 'S1'
         and listing.published_at is null
         and listing.remote_id = confirmation.remote_id
         and listing.seller_account_key = confirmation.seller_account_key
         and listing.operation_attempt_id = confirmation.source_attempt_id
         and listing.last_verified_at = confirmation.confirmed_at
         and listing.last_error =
           'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요'
         and product.owner_id = listing.owner_id
         and not product.demo
         and product.status <> 'archived'
         and credential.id = p_credential_id
         and credential.channel = 'qoo10'
         and credential.environment = 'production'
         and credential.status = 'active'
         and (
           credential.expires_at is null
           or credential.expires_at > statement_timestamp()
         )
         and credential.fingerprint = confirmation.credential_fingerprint
         and credential.seller_account_key = confirmation.seller_account_key
         and source_job.id = confirmation.source_job_id
         and source_job.status = 'failed'
         and source_job.attempt_id = confirmation.source_attempt_id
         and source_job.listing_id = confirmation.listing_id
         and source_job.credential_id = confirmation.credential_id
         and source_attempt.id = confirmation.source_attempt_id
         and source_attempt.status = 'failed'
         and source_attempt.credential_id = confirmation.credential_id
         and update_attempt.id = p_attempt_id
         and update_attempt.credential_id = p_credential_id
         and update_attempt.channel = 'qoo10'
         and update_attempt.operation = 'listing.update'
         and update_attempt.status = 'running'
       for update of confirmation, listing, product, credential,
         source_job, source_attempt, update_attempt;
      if not found then
        raise exception 'QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH';
      end if;

      v_identity :=
        public.sellerpilot_service_get_qoo10_rollback_update_identity(
          p_listing_id,
          p_credential_id,
          v_product_id,
          v_market,
          v_target_id
        );
      v_expected_identity := jsonb_build_object(
        'status', 'allowed',
        'contract', 'qoo10_create_rollback_confirmation_v1',
        'listingId', p_listing_id,
        'remoteId', v_marker->>'remoteId',
        'providerStatus', 'S1',
        'sourceJobId', (v_marker->>'sourceJobId')::uuid,
        'expectedState', v_expected_state
      );
      if v_identity is distinct from v_expected_identity then
        raise exception 'QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH';
      end if;
    end if;
  elsif v_marker is not null then
    raise exception 'QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH';
  end if;

  return public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is 'Effective-gated enqueue plus an atomic exact-ledger fence for the server-owned Qoo10 S1 create-rollback update recovery marker.';

-- Preserve the confirmation snapshot after a definite UpdateGoods rejection
-- only when a subsequent authoritative read proves that no field or provider
-- status changed. The generic completion still records the failed update job
-- and attempt; this wrapper rewinds only the listing's retry pointer.
alter function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) rename to sellerpilot_222257_complete_gateway_before_qoo10_retry_preserve;

revoke all on function
  public.sellerpilot_222257_complete_gateway_before_qoo10_retry_preserve(
    text, uuid, uuid, text, jsonb, text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_complete_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate boolean := false;
  v_completed boolean;
  v_retry_proof boolean := false;
  v_listing_id uuid;
  v_product_id uuid;
  v_owner_id uuid;
  v_source_attempt_id uuid;
  v_source_job_id uuid;
  v_confirmed_at timestamptz;
  v_prior_product_status text;
  v_fixed_error constant text :=
    'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요';
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select true,
         listing.id,
         listing.product_id,
         listing.owner_id,
         confirmation.source_attempt_id,
         confirmation.source_job_id,
         confirmation.confirmed_at,
         product.status
    into v_candidate,
         v_listing_id,
         v_product_id,
         v_owner_id,
         v_source_attempt_id,
         v_source_job_id,
         v_confirmed_at,
         v_prior_product_status
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts update_attempt
      on update_attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.listing_id = listing.id
     and confirmation.credential_id = job.credential_id
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.channel = 'qoo10'
     and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.request_payload#>'{arguments,sellerpilotQoo10RollbackUpdateRecovery}'
           = jsonb_build_object(
               'status', 'allowed',
               'contract', 'qoo10_create_rollback_confirmation_v1',
               'listingId', confirmation.listing_id,
               'remoteId', confirmation.remote_id,
               'providerStatus', 'S1',
               'sourceJobId', confirmation.source_job_id,
               'expectedState', jsonb_build_object(
                 'categoryCode', confirmation.category_code,
                 'retailPriceJpy', confirmation.retail_price_jpy,
                 'sellPriceJpy', confirmation.sell_price_jpy,
                 'quantity', confirmation.quantity,
                 'shippingNo', confirmation.shipping_no,
                 'biContentsNo', confirmation.bi_contents_no
               )
             )
     and update_attempt.id = job.attempt_id
     and update_attempt.status = 'running'
     and update_attempt.channel = 'qoo10'
     and update_attempt.operation = 'listing.update'
     and listing.operation_attempt_id = update_attempt.id
     and listing.status = 'queued'
     and listing.failure_class is null
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'non_public'
     and listing.provider_status = 'S1'
     and listing.remote_id = confirmation.remote_id
     and listing.seller_account_key = confirmation.seller_account_key
     and listing.published_at is null
     and listing.last_verified_at = confirmation.confirmed_at
   for update of job, update_attempt, listing, product, confirmation;

  v_completed :=
    public.sellerpilot_222257_complete_gateway_before_qoo10_retry_preserve(
      p_token_hash,
      p_job_id,
      p_claim_token,
      p_status,
      p_response_payload,
      p_error_message
    );
  if v_completed is not true or not coalesce(v_candidate, false) then
    return v_completed;
  end if;

  select true
    into v_retry_proof
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts update_attempt
      on update_attempt.id = job.attempt_id
   where job.id = p_job_id
     and job.listing_id = v_listing_id
     and job.status = 'succeeded'
     and job.response_payload->'ok' = 'false'::jsonb
     and job.response_payload->>'channel' = 'qoo10'
     and job.response_payload->>'operation' = 'listing.update'
     and job.response_payload->>'remoteId'
           = job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,remoteId}'
     and jsonb_typeof(job.response_payload->'steps') = 'array'
     and jsonb_array_length(job.response_payload->'steps') = 2
     and lower(job.response_payload#>>'{steps,0,name}') = 'updategoods'
     and job.response_payload#>'{steps,0,ok}' = 'false'::jsonb
     and coalesce(job.response_payload#>>'{steps,0,status}', '')
           ~ '^[0-9]{3}$'
     and (job.response_payload#>>'{steps,0,status}')::integer
           between 200 and 299
     and coalesce(job.response_payload#>>'{steps,0,data,ResultCode}', '')
           ~ '^-?[0-9]+$'
     and (job.response_payload#>>'{steps,0,data,ResultCode}')::numeric
           not in (0, -9999)
     and coalesce(
           job.response_payload#>>'{steps,0,data,sellerpilotMutation}', ''
         ) <> 'accepted'
     and coalesce(
           job.response_payload#>>'{steps,0,data,sellerpilotReconciliationRequired}',
           'false'
         ) <> 'true'
     and lower(job.response_payload#>>'{steps,1,name}')
           = 'qoo10-rollback-update-rejection-s1-readback'
     and job.response_payload#>'{steps,1,ok}' = 'true'::jsonb
     and job.response_payload#>>'{steps,1,data,sellerpilotVerification}'
           = 'QOO10_ROLLBACK_UPDATE_REJECTION_S1_VERIFIED'
     and job.response_payload#>>'{steps,1,data,providerStatus}' = 'S1'
     and job.response_payload#>>'{steps,1,data,sellerpilotExpectedProviderStatus}'
           = 'S1'
     and job.response_payload#>>'{steps,1,data,sellerpilotExactDetailImageCount}'
           = '8'
     and job.response_payload#>>'{steps,1,data,sellerpilotMutableVerification}'
           = 'LISTING_MUTABLE_FIELDS_VERIFIED'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,identityVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,statusVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,sellerCodeVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,localeVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,fingerprintVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,imageCountVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,sellerAccountIdentityVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,categoryVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,titleVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,shippingVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,retailPriceVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,priceQuantityVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,representativeImageVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,detailImageDigestVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,recoveryExpectationVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,sellPriceVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,quantityVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,confirmedBiCdnImageVerified}'
           = 'true'
     and job.response_payload#>>'{steps,1,data,sellerpilotPublicationChecks,detailImageUrlsVerified}'
           = 'true'
     and update_attempt.status = 'failed';

  if not coalesce(v_retry_proof, false) then return true; end if;

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_rollback_retry_job',
    p_job_id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set operation_attempt_id = v_source_attempt_id,
         status = 'paused',
         failure_class = 'retryable',
         remote_visibility = 'non_public',
         provider_status = 'S1',
         published_at = null,
         last_verified_at = v_confirmed_at,
         last_error = v_fixed_error,
         updated_at = clock_timestamp()
   where listing.id = v_listing_id;
  if not found then
    raise exception 'Qoo10 rollback update retry listing restore lost its fence'
      using errcode = '40001';
  end if;

  update sellerpilot_private.products product
     set status = v_prior_product_status,
         updated_at = clock_timestamp()
   where product.id = v_product_id;
  if not found then
    raise exception 'Qoo10 rollback update retry product restore lost its fence'
      using errcode = '40001';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner_id,
    'qoo10_rollback_update_rejected_retry_preserved',
    'product_listing',
    v_listing_id::text,
    jsonb_build_object(
      'update_job_id', p_job_id,
      'source_job_id', v_source_job_id,
      'source_attempt_id', v_source_attempt_id,
      'provider_status', 'S1',
      'remote_id_preserved', true,
      'provider_mutation_observed', false
    )
  );

  return true;
end;
$$;

revoke all on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) to service_role;

comment on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) is 'Canonical listing completion plus an exact Qoo10 explicit-rejection S1 proof that preserves only the confirmed update retry pointer.';

commit;
