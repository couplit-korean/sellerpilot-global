-- Extend the existing exact-evidence Qoo10 create-rollback confirmation
-- (20260830222257_confirm_qoo10_listing_create_rollback.sql) to also accept
-- a second, equally conservative rollback evidence shape: one where the
-- `detail-image-readback` step itself succeeded, but the subsequent
-- `GetItemDetailInfo-publication-readback` step could not verify the
-- published detail state (`QOO10_PUBLICATION_STATE_UNVERIFIED`), followed by
-- a successful `rollback-missing-detail` compensating suspend call. This is
-- the exact shape produced by the current qoo10 listing.create adapter for
-- job 687852dc-36de-4049-b170-bdf7839ccf2f (SellerCode
-- AUTO-780720401E2D4E4EA45F), independently observed on Qoo10 QSM as
-- GdNo 1217536689 in status "판매중지(판매자)" (seller-suspended / S1,
-- non-public). The original evidence shape (detail-image-readback itself
-- failing) remains accepted unchanged. This migration never calls Qoo10,
-- never retries the source job, and only widens the accepted read-only
-- evidence shape for the same superuser/function-owner-only SQL maintenance
-- path.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

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
  v_detail_ok integer;
  v_detail_ordinal bigint;
  v_readback_total integer;
  v_readback_valid integer;
  v_readback_ordinal bigint;
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
    count(*) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'detail-image-readback'
        and entry.step->'ok' = 'true'::jsonb
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', '')) = 'detail-image-readback'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', ''))
        = 'getitemdetailinfo-publication-readback'
    ),
    count(*) filter (
      where lower(coalesce(entry.step->>'name', ''))
        = 'getitemdetailinfo-publication-readback'
        and entry.step->'ok' = 'false'::jsonb
        and entry.step#>>'{data,ResultMsg}' = 'QOO10_PUBLICATION_STATE_UNVERIFIED'
    ),
    max(entry.ordinality) filter (
      where lower(coalesce(entry.step->>'name', ''))
        = 'getitemdetailinfo-publication-readback'
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
         v_detail_total, v_detail_valid, v_detail_ok, v_detail_ordinal,
         v_readback_total, v_readback_valid, v_readback_ordinal,
         v_rollback_total, v_rollback_valid, v_rollback_ordinal
    from jsonb_array_elements(v_job.response_payload->'steps')
      with ordinality as entry(step, ordinality);

  if v_preflight_total <> 1 or v_preflight_valid <> 1
     or v_set_total <> 1 or v_set_valid <> 1
     or v_edit_total <> 1 or v_edit_valid <> 1
     or v_detail_total <> 1
     or v_rollback_total <> 1 or v_rollback_valid <> 1
     or not (
       (
         -- Pattern A (original contract): detail-image-readback itself
         -- failed to verify the uploaded detail images, and no separate
         -- publication-state readback step is present.
         v_detail_valid = 1
         and v_readback_total = 0
         and v_preflight_ordinal < v_set_ordinal
         and v_set_ordinal < v_edit_ordinal
         and v_edit_ordinal < v_detail_ordinal
         and v_detail_ordinal < v_rollback_ordinal
       )
       or
       (
         -- Pattern B: detail-image-readback succeeded, but the subsequent
         -- GetItemDetailInfo publication-state readback could not verify
         -- the saved detail (QOO10_PUBLICATION_STATE_UNVERIFIED), which
         -- triggered the same compensating rollback-missing-detail suspend.
         v_detail_ok = 1
         and v_readback_total = 1 and v_readback_valid = 1
         and v_preflight_ordinal < v_set_ordinal
         and v_set_ordinal < v_edit_ordinal
         and v_edit_ordinal < v_detail_ordinal
         and v_detail_ordinal < v_readback_ordinal
         and v_readback_ordinal < v_rollback_ordinal
       )
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
  ) is 'Direct owner or superuser SQL maintenance only: exact-evidence confirmation of a Qoo10 S1 create rollback (accepts either a failed detail-image-readback, or a succeeded detail-image-readback followed by a failed GetItemDetailInfo publication-state readback) that preserves the remote id and enables a later listing.update without issuing another create.';

commit;
