-- The exact-existing job constraint is deferred until transaction commit. The
-- historical enqueue inserts a job before the verified-publication wrapper
-- fills request_fingerprint on that same row. PostgreSQL preserves the INSERT
-- event's original NEW tuple for a deferred row trigger, so validating NEW at
-- commit sees a null fingerprint even though the persisted job is complete.
-- Re-read the current row by the immutable job id and validate that final
-- transaction state instead. The permit and provider fences remain unchanged.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 911500001);

do $patch_exact_existing_deferred_job_lineage$
begin
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  execute $ddl$
create or replace function sellerpilot_private.guard_exact_existing_update_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_arguments jsonb;
  v_exact_surface boolean := false;
begin
  -- This is a deferred AFTER trigger. Always validate the final persisted row,
  -- not the stale NEW image captured by the earlier INSERT event.
  select current_job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs current_job
   where current_job.id = new.id;
  if not found then
    raise exception 'exact existing update job row unavailable'
      using errcode = '55000';
  end if;

  v_arguments := v_job.request_payload->'arguments';
  v_exact_surface :=
    (
      v_job.operation = 'listing.update'
      and (
        (v_job.channel = 'coupang' and v_job.listing_id =
          '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid)
        or (v_job.channel = 'elevenst' and v_job.listing_id =
          '363f3b81-f364-4f22-af4e-4920199904d0'::uuid)
        or (v_job.channel = 'ebay' and v_job.listing_id =
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid)
      )
    )
    or coalesce(v_arguments ? 'sellerpilotCoupangExactQaRecovery', false)
    or coalesce(v_arguments ? 'sellerpilotElevenstExactExistingPublication', false)
    or coalesce(v_arguments ? 'sellerpilotEbayExactExistingQaRecovery', false);
  if not v_exact_surface then return new; end if;

  if not exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
     where permit.update_job_id = v_job.id
  ) then
    return new;
  end if;

  if v_job.channel not in ('coupang', 'elevenst', 'ebay')
     or v_job.operation is distinct from 'listing.update'
     or v_job.environment is distinct from 'production'
     or not exists (
       select 1
         from sellerpilot_private.exact_existing_update_permits permit
        where permit.update_job_id = v_job.id
          and permit.update_attempt_id = v_job.attempt_id
          and permit.channel = v_job.channel
          and permit.listing_id = v_job.listing_id
          and permit.credential_id = v_job.credential_id
          and permit.seller_account_key = v_job.seller_account_key
          and permit.request_fingerprint = v_job.request_fingerprint
          and permit.arguments_sha256 = encode(extensions.digest(
                v_arguments::text, 'sha256'
              ), 'hex')
          and permit.arguments_bytes = octet_length(v_arguments::text)
          and permit.request_payload_sha256 = encode(extensions.digest(
                v_job.request_payload::text, 'sha256'
              ), 'hex')
          and permit.request_payload_bytes =
                octet_length(v_job.request_payload::text)
          and permit.invalidated_at is null
          and sellerpilot_private.exact_existing_update_arguments_valid(
                permit.channel, v_arguments, permit.release_sha,
                permit.request_fingerprint, permit.stock
              )
     )
  then
    raise exception 'exact existing update job lineage invalid'
      using errcode = '55000';
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'exact existing update job lineage invalid'
    using errcode = '55000';
end;
$function$
$ddl$;

  execute $ddl$
revoke all on function sellerpilot_private.guard_exact_existing_update_job()
  from public, anon, authenticated, service_role
$ddl$;
end;
$patch_exact_existing_deferred_job_lineage$;

-- Retire only the third proved Coupang pre-gateway rollback. There is no job
-- and therefore no provider mutation to reconcile. Preserve the exact failed
-- attempt binding and restore only this listing to operator-controlled retry.
do $reconcile_coupang_exact_deferred_insert_rollback$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_listing_id constant uuid :=
    '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid;
  v_attempt_id constant uuid :=
    '2459dfc2-c049-44dd-926f-402663334acd'::uuid;
  v_permit_id constant uuid :=
    '3db15496-9d88-4e92-9096-4662a9257a69'::uuid;
  v_release_sha constant text :=
    '3ec287082a91fd81b0f7abc57b90846a7a516450';
  v_safe_message constant text :=
    'Vercel 서버리스 채널 게이트웨이에서 안전하게 처리된 오류가 발생했습니다.';
  v_present_rows integer;
  v_updated_rows integer;
begin
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  select
    (select count(*) from sellerpilot_private.product_listings listing
      where listing.id = v_listing_id)
    +
    (select count(*) from sellerpilot_private.channel_operation_attempts attempt
      where attempt.id = v_attempt_id)
    +
    (select count(*) from sellerpilot_private.exact_existing_update_permits permit
      where permit.permit_id = v_permit_id)
    into v_present_rows;

  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 3 then
    raise exception 'COUPANG_EXACT_DEFERRED_INSERT_RECONCILIATION_INCOMPLETE'
      using errcode = '55000';
  end if;

  perform 1
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
     and attempt.owner_id = listing.owner_id
     and attempt.channel = listing.channel_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = attempt.credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = v_permit_id
     and permit.channel = listing.channel_key
     and permit.listing_id = listing.id
     and permit.product_id = listing.product_id
     and permit.owner_id = listing.owner_id
     and permit.credential_id = credential.id
     and permit.seller_account_key = listing.seller_account_key
     and permit.request_fingerprint = attempt.request_fingerprint
   where listing.id = v_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'coupang'
     and listing.remote_id = '16356981734'
     and listing.market = 'KR'
     and listing.target_id = 'KR'
     and listing.currency = 'KRW'
     and listing.price = 5000
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.operation_attempt_id = v_attempt_id
     and listing.last_error = v_safe_message
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status <> 'archived'
     and attempt.operation = 'listing.update'
     and attempt.status = 'failed'
     and attempt.http_status = 422
     and attempt.remote_id is null
     and attempt.safe_message = v_safe_message
     and attempt.gateway_write_required
     and attempt.pre_gateway_retryable
     and attempt.completed_at is not null
     and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
     and attempt.seller_account_key = listing.seller_account_key
     and credential.status = 'active'
     and credential.environment = 'production'
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
     and credential.last_check_status = 'passed'
     and credential.last_checked_at is not null
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and permit.release_sha = v_release_sha
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.arguments_sha256 is null
     and permit.arguments_bytes is null
     and permit.request_payload_sha256 is null
     and permit.request_payload_bytes is null
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp()
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
           or job.id = permit.update_job_id
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = v_listing_id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   for update of listing, product, attempt, credential, permit;

  if not found then
    raise exception 'COUPANG_EXACT_DEFERRED_INSERT_RECONCILIATION_MISMATCH'
      using errcode = '55000';
  end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.permit_id = v_permit_id
     and permit.channel = 'coupang'
     and permit.listing_id = v_listing_id
     and permit.release_sha = v_release_sha
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.bound_at is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at <= statement_timestamp()
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
     );

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_DEFERRED_INSERT_PERMIT_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.product_listings listing
     set failure_class = 'external_action'
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and listing.failure_class = 'retryable'
     and listing.last_error = v_safe_message;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_DEFERRED_INSERT_LISTING_RESTORE_FAILED'
      using errcode = '55000';
  end if;
end;
$reconcile_coupang_exact_deferred_insert_rollback$;

do $exact_existing_deferred_job_lineage_postimage$
declare
  v_definition text;
begin
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'from sellerpilot_private.channel_gateway_jobs current_job'
     ) = 0
     or pg_catalog.strpos(v_definition, 'where current_job.id = new.id') = 0
     or pg_catalog.strpos(v_definition, 'permit.request_fingerprint = v_job.request_fingerprint') = 0
     or pg_catalog.strpos(v_definition, 'permit.request_fingerprint = new.request_fingerprint') > 0
  then
    raise exception 'exact existing deferred job lineage postimage mismatch'
      using errcode = '55000';
  end if;
end;
$exact_existing_deferred_job_lineage_postimage$;

commit;
