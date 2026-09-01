-- Retire the one exact Coupang listing.update job that was durably enqueued
-- but could never be claimed because Coupang has no approved serverless
-- static egress. The provider boundary was never crossed. Preserve every
-- immutable request/credential fingerprint and hand the existing remote item
-- back to an operator for a manual WING update; never retry it automatically.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- Serialize with runtime canary/schedule activation before inspecting cron.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065060);
select pg_catalog.pg_advisory_xact_lock(193674993, 911600001);

-- Freeze every gateway mutation while the global unsafe-pending count and the
-- exact target row are proved. This does not block readers.
lock table sellerpilot_private.channel_gateway_jobs
  in share row exclusive mode;
lock table sellerpilot_private.operation_audit
  in share row exclusive mode;
lock table cron.job
  in share row exclusive mode;

-- The original permit state machine allowed expiration only before a job was
-- attached. Add one terminal state for this exact, already-attached permit.
-- All job, attempt, request, and payload hashes remain immutable for audit.
alter table sellerpilot_private.exact_existing_update_permits
  drop constraint exact_existing_update_permit_binding_check;

alter table sellerpilot_private.exact_existing_update_permits
  add constraint exact_existing_update_permit_binding_check check (
    (
      invalidated_at is null and invalidation_reason is null
      and (
        (
          update_job_id is null and update_attempt_id is null
          and arguments_sha256 is null and arguments_bytes is null
          and request_payload_sha256 is null and request_payload_bytes is null
          and bound_at is null and bound_worker_token_id is null
          and bound_claim_token is null and consumed_at is null
        ) or (
          update_job_id is not null and update_attempt_id is not null
          and arguments_sha256 ~ '^[a-f0-9]{64}$'
          and arguments_bytes between 100 and 128000
          and request_payload_sha256 ~ '^[a-f0-9]{64}$'
          and request_payload_bytes between 100 and 128000
          and (
            (
              bound_at is null and bound_worker_token_id is null
              and bound_claim_token is null and consumed_at is null
            ) or (
              bound_at is not null and bound_worker_token_id is not null
              and bound_claim_token is not null
              and (consumed_at is null or consumed_at >= bound_at)
            )
          )
        )
      )
    ) or (
      invalidated_at is not null
      and invalidation_reason = 'expired_before_job'
      and update_job_id is null and update_attempt_id is null
      and arguments_sha256 is null and arguments_bytes is null
      and request_payload_sha256 is null and request_payload_bytes is null
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
    ) or (
      permit_id = '0c07232d-4084-42ce-af09-b6da16235465'::uuid
      and channel = 'coupang'
      and listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
      and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
      and credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
      and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
      and release_sha = '71afb2e6e96d6f5eef7bf6f70dea380f5d1c2e9f'
      and request_fingerprint =
            '5f4e3bca5d2a82c111fa86b2838de44353fe4d11bedb34435f9912c41f71c4fb'
      and update_job_id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
      and update_attempt_id = '84afed0d-cc13-413d-b839-c35346f9b09f'::uuid
      and arguments_sha256 =
            '1054c64d400b65fc4214b15407a013c9b9a434fa4ac32374fb8203236954bf7b'
      and arguments_bytes = 20011
      and request_payload_sha256 =
            '7872552ce349e9101f94c80b669f6fe66aad596c92934482ad731b6080704a94'
      and request_payload_bytes = 20026
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
      and invalidated_at is not null
      and invalidated_at >= expires_at
      and invalidation_reason = 'unclaimed_static_egress'
    )
  );

create or replace function
  sellerpilot_private.guard_exact_existing_update_permit_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_mutable_fields constant text[] := array[
    'update_job_id', 'update_attempt_id', 'arguments_sha256',
    'arguments_bytes', 'request_payload_sha256', 'request_payload_bytes',
    'bound_at', 'bound_worker_token_id', 'bound_claim_token', 'consumed_at',
    'invalidated_at', 'invalidation_reason'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'exact existing update permits cannot be deleted'
      using errcode = '55000';
  end if;
  if to_jsonb(new) - v_mutable_fields is distinct from
       to_jsonb(old) - v_mutable_fields
  then
    raise exception 'exact existing update permit identity is immutable'
      using errcode = '55000';
  end if;

  if old.update_job_id is null
     and old.update_attempt_id is null
     and old.bound_at is null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.update_job_id is null
     and new.update_attempt_id is null
     and new.bound_at is null
     and new.consumed_at is null
     and new.invalidated_at is not null
     and new.invalidation_reason = 'expired_before_job'
     and old.expires_at <= statement_timestamp()
     and to_jsonb(new) - array['invalidated_at', 'invalidation_reason']
           is not distinct from
         to_jsonb(old) - array['invalidated_at', 'invalidation_reason']
  then return new; end if;

  if old.permit_id = '0c07232d-4084-42ce-af09-b6da16235465'::uuid
     and old.channel = 'coupang'
     and old.listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
     and old.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and old.credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
     and old.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and old.release_sha = '71afb2e6e96d6f5eef7bf6f70dea380f5d1c2e9f'
     and old.request_fingerprint =
           '5f4e3bca5d2a82c111fa86b2838de44353fe4d11bedb34435f9912c41f71c4fb'
     and old.update_job_id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
     and old.update_attempt_id = '84afed0d-cc13-413d-b839-c35346f9b09f'::uuid
     and old.arguments_sha256 =
           '1054c64d400b65fc4214b15407a013c9b9a434fa4ac32374fb8203236954bf7b'
     and old.arguments_bytes = 20011
     and old.request_payload_sha256 =
           '7872552ce349e9101f94c80b669f6fe66aad596c92934482ad731b6080704a94'
     and old.request_payload_bytes = 20026
     and old.bound_at is null and old.bound_worker_token_id is null
     and old.bound_claim_token is null and old.consumed_at is null
     and old.invalidated_at is null and old.invalidation_reason is null
     and old.expires_at <= statement_timestamp()
     and new.invalidated_at is not null
     and new.invalidated_at >= old.expires_at
     and new.invalidation_reason = 'unclaimed_static_egress'
     and to_jsonb(new) - array['invalidated_at', 'invalidation_reason']
           is not distinct from
         to_jsonb(old) - array['invalidated_at', 'invalidation_reason']
  then return new; end if;

  if old.update_job_id is null
     and old.update_attempt_id is null
     and old.arguments_sha256 is null
     and old.request_payload_sha256 is null
     and old.bound_at is null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.update_job_id is not null
     and new.update_attempt_id is not null
     and new.arguments_sha256 ~ '^[a-f0-9]{64}$'
     and new.arguments_bytes between 100 and 128000
     and new.request_payload_sha256 ~ '^[a-f0-9]{64}$'
     and new.request_payload_bytes between 100 and 128000
     and new.bound_at is null
     and new.consumed_at is null
     and new.invalidated_at is null
     and new.expires_at > statement_timestamp()
     and to_jsonb(new) - array[
           'update_job_id', 'update_attempt_id', 'arguments_sha256',
           'arguments_bytes', 'request_payload_sha256',
           'request_payload_bytes'
         ] is not distinct from
         to_jsonb(old) - array[
           'update_job_id', 'update_attempt_id', 'arguments_sha256',
           'arguments_bytes', 'request_payload_sha256',
           'request_payload_bytes'
         ]
  then return new; end if;

  if old.update_job_id is not null
     and old.update_attempt_id is not null
     and old.bound_at is null
     and old.bound_worker_token_id is null
     and old.bound_claim_token is null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.update_job_id = old.update_job_id
     and new.update_attempt_id = old.update_attempt_id
     and new.bound_at is not null
     and new.bound_at >= new.armed_at
     and new.bound_at < new.expires_at
     and new.bound_worker_token_id is not null
     and new.bound_claim_token is not null
     and new.consumed_at is null
     and new.invalidated_at is null
     and to_jsonb(new) - array[
           'bound_at', 'bound_worker_token_id', 'bound_claim_token'
         ] is not distinct from
         to_jsonb(old) - array[
           'bound_at', 'bound_worker_token_id', 'bound_claim_token'
         ]
  then return new; end if;

  if old.bound_at is not null
     and old.bound_worker_token_id is not null
     and old.bound_claim_token is not null
     and old.consumed_at is null
     and old.invalidated_at is null
     and new.bound_at = old.bound_at
     and new.bound_worker_token_id = old.bound_worker_token_id
     and new.bound_claim_token = old.bound_claim_token
     and new.consumed_at is not null
     and new.consumed_at >= new.bound_at
     and new.consumed_at < new.expires_at
     and new.invalidated_at is null
     and to_jsonb(new) - 'consumed_at' is not distinct from
         to_jsonb(old) - 'consumed_at'
  then return new; end if;

  raise exception 'exact existing update permit transition invalid'
    using errcode = '55000';
end;
$function$;

revoke all on function
  sellerpilot_private.guard_exact_existing_update_permit_transition()
  from public, anon, authenticated, service_role;

-- The exact job-lineage trigger is deferred. Its final-row image therefore
-- sees the permit retirement below; recognize only this exact cancelled job
-- and revalidate all stored request bytes before accepting the terminal row.
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
  select current_job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs current_job
   where current_job.id = new.id;
  if not found then
    raise exception 'exact existing update job row unavailable'
      using errcode = '55000';
  end if;

  v_arguments := v_job.request_payload->'arguments';

  if v_job.id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
     and v_job.channel = 'coupang'
     and v_job.operation = 'listing.update'
     and v_job.environment = 'production'
     and v_job.listing_id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
     and v_job.attempt_id = '84afed0d-cc13-413d-b839-c35346f9b09f'::uuid
     and v_job.credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
     and v_job.seller_account_key =
           'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     and v_job.request_fingerprint =
           '5f4e3bca5d2a82c111fa86b2838de44353fe4d11bedb34435f9912c41f71c4fb'
     and v_job.status = 'cancelled'
     and v_job.attempt_count = 0
     and v_job.worker_token_id is null
     and v_job.claim_token is null
     and v_job.lease_expires_at is null
     and v_job.started_at is null
     and v_job.provider_mutation_started_at is null
     and v_job.response_payload is null
     and v_job.completed_at is not null
     and v_job.created_by =
           '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     and v_job.created_at =
           '2026-09-01 05:10:35.344034+00'::timestamptz
     and not v_job.credential_refresh_in_flight
     and v_job.credential_refresh_started_at is null
     and v_job.credential_refresh_prepared_at is null
     and v_job.prepared_credential_id is null
     and v_job.credential_refresh_recovery_vault_id is null
     and v_job.oauth_provider_call_started_at is null
     and v_job.error_message =
           '쿠팡 API는 승인된 고정 egress가 없어 실행하지 않았습니다. 판매자 WING에서 기존 상품을 수동 수정하고 판매 상태를 확인해 주세요.'
     and exists (
       select 1
         from sellerpilot_private.exact_existing_update_permits permit
         join sellerpilot_private.channel_credentials credential
           on credential.id = permit.credential_id
        where permit.permit_id =
                '0c07232d-4084-42ce-af09-b6da16235465'::uuid
          and permit.update_job_id = v_job.id
          and permit.update_attempt_id = v_job.attempt_id
          and permit.release_sha =
                '71afb2e6e96d6f5eef7bf6f70dea380f5d1c2e9f'
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
          and permit.bound_at is null
          and permit.bound_worker_token_id is null
          and permit.bound_claim_token is null
          and permit.consumed_at is null
          and permit.invalidated_at is not null
          and permit.invalidation_reason = 'unclaimed_static_egress'
          and credential.id =
                '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
          and credential.environment = 'production'
          and credential.status = 'active'
          and credential.version = 1
          and credential.fingerprint = 'F95F4754AFAE'
          and credential.seller_account_key =
                'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
          and credential.seller_account_key_source =
                'credential_incarnation_v1'
          and credential.seller_account_verified_at =
                '2026-08-25 11:40:32.606508+00'::timestamptz
          and credential.last_checked_at =
                '2026-08-19 20:23:27.905445+00'::timestamptz
          and credential.last_check_status = 'passed'
          and credential.expires_at is null
          and credential.created_by =
                '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
          and permit.credential_version = credential.version
          and permit.credential_fingerprint = credential.fingerprint
          and permit.credential_account_source =
                credential.seller_account_key_source
          and permit.credential_verified_at =
                credential.seller_account_verified_at
          and permit.credential_expires_at is not distinct from
                credential.expires_at
          and permit.credential_last_checked_at is not distinct from
                credential.last_checked_at
          and permit.credential_last_check_status is not distinct from
                credential.last_check_status
     )
  then return new; end if;

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
$function$;

revoke all on function sellerpilot_private.guard_exact_existing_update_job()
  from public, anon, authenticated, service_role;

do $reconcile_exact_coupang_unclaimed_static_egress_job$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_job_created_by constant uuid :=
    '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_listing_id constant uuid :=
    '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid;
  v_credential_id constant uuid :=
    '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid;
  v_attempt_id constant uuid :=
    '84afed0d-cc13-413d-b839-c35346f9b09f'::uuid;
  v_job_id constant uuid :=
    'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid;
  v_permit_id constant uuid :=
    '0c07232d-4084-42ce-af09-b6da16235465'::uuid;
  v_release_sha constant text :=
    '71afb2e6e96d6f5eef7bf6f70dea380f5d1c2e9f';
  v_request_fingerprint constant text :=
    '5f4e3bca5d2a82c111fa86b2838de44353fe4d11bedb34435f9912c41f71c4fb';
  v_arguments_sha256 constant text :=
    '1054c64d400b65fc4214b15407a013c9b9a434fa4ac32374fb8203236954bf7b';
  v_request_payload_sha256 constant text :=
    '7872552ce349e9101f94c80b669f6fe66aad596c92934482ad731b6080704a94';
  v_seller_account_key constant text :=
    'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd';
  v_manual_message constant text :=
    '쿠팡 API는 승인된 고정 egress가 없어 실행하지 않았습니다. 판매자 WING에서 기존 상품을 수동 수정하고 판매 상태를 확인해 주세요.';
  v_runtime_status jsonb;
  v_schedule_count integer;
  v_distinct_schedule_count integer;
  v_active_schedule_count integer;
  v_audit_preimage_count integer;
  v_present_rows integer;
  v_updated_rows integer;
begin
  select
    (select count(*) from sellerpilot_private.product_listings listing
      where listing.id = v_listing_id)
    +
    (select count(*) from sellerpilot_private.channel_operation_attempts attempt
      where attempt.id = v_attempt_id)
    +
    (select count(*) from sellerpilot_private.channel_gateway_jobs job
      where job.id = v_job_id)
    +
    (select count(*)
       from sellerpilot_private.exact_existing_update_permits permit
      where permit.permit_id = v_permit_id)
    into v_present_rows;

  -- A clean migration replay changes no data. Any partial production tuple is
  -- a hard stop, not an invitation to infer or manufacture missing lineage.
  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 4 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_TUPLE_INCOMPLETE'
      using errcode = '55000';
  end if;

  -- The activation RPC uses the advisory lock acquired above. Lock the exact
  -- six schedule rows as well, then prove that none is active.
  select count(*)::integer,
         count(distinct schedule.jobname)::integer,
         count(*) filter (where schedule.active)::integer
    into v_schedule_count, v_distinct_schedule_count, v_active_schedule_count
    from (
      select job.jobname, job.active
        from cron.job job
       where job.jobname in (
         'sellerpilot-serverless-cs-wake-v1',
         'sellerpilot-product-research-v1',
         'sellerpilot-channel-sync-v1',
         'sellerpilot-competitor-prices-v1',
         'sellerpilot-kakao-notifications-v1',
         'sellerpilot-maintenance-v1'
       )
       for update
    ) schedule;

  select public.sellerpilot_service_serverless_cs_wakeup_status()
    into v_runtime_status;
  if v_schedule_count <> 6
     or v_distinct_schedule_count <> 6
     or v_active_schedule_count <> 0
     or v_runtime_status->>'configured' <> 'true'
     or v_runtime_status->>'version' <> 'serverless_runtime_v2'
     or v_runtime_status->>'scheduleCount' <> '6'
     or v_runtime_status->>'active' <> 'false'
     or v_runtime_status->'activeRelease' <> 'null'::jsonb
     or v_runtime_status->>'unsafePendingMutations' <> '1'
     or v_runtime_status->>'reconciliationRequiredMutations' <> '4'
  then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_PREFLIGHT_MISMATCH'
      using errcode = '55000';
  end if;

  select count(*)::integer
    into v_audit_preimage_count
    from sellerpilot_private.operation_audit audit
   where audit.action = 'coupang_unclaimed_static_egress_job_retired'
     and audit.entity_type = 'channel_gateway_job'
     and audit.entity_id = v_job_id::text;
  if v_audit_preimage_count <> 0 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_AUDIT_PREIMAGE_MISMATCH'
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
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = v_job_id
     and job.attempt_id = attempt.id
     and job.listing_id = listing.id
     and job.credential_id = attempt.credential_id
     and job.channel = listing.channel_key
     and job.operation = attempt.operation
     and job.seller_account_key = listing.seller_account_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = attempt.credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
    join sellerpilot_private.serverless_static_egress_policy egress_policy
      on egress_policy.channel = listing.channel_key
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = v_permit_id
     and permit.update_job_id = job.id
     and permit.update_attempt_id = attempt.id
     and permit.listing_id = listing.id
     and permit.product_id = product.id
     and permit.credential_id = credential.id
     and permit.owner_id = listing.owner_id
     and permit.seller_account_key = listing.seller_account_key
   where listing.id = v_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'coupang'
     and listing.remote_id = '16356981734'
     and listing.market = 'KR'
     and listing.target_id = 'KR'
     and listing.currency = 'KRW'
     and listing.price = 5000
     and listing.status = 'queued'
     and listing.failure_class is null
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.operation_attempt_id = v_attempt_id
     and listing.last_error is null
     and listing.remote_resources = '{}'::jsonb
     and listing.marketplace_sku is null
     and listing.provider_resource_id is null
     and listing.public_url =
           'https://www.coupang.com/vp/products/8596029479?vendorItemId=95962393877'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status <> 'archived'
     and attempt.id = v_attempt_id
     and attempt.credential_id = v_credential_id
     and attempt.operation = 'listing.update'
     and attempt.status = 'running'
     and attempt.http_status is null
     and attempt.remote_id is null
     and attempt.safe_message is null
     and attempt.started_at =
           '2026-09-01 05:10:24.356924+00'::timestamptz
     and attempt.completed_at is null
     and attempt.gateway_write_required
     and not attempt.pre_gateway_retryable
     and attempt.request_fingerprint = v_request_fingerprint
     and attempt.seller_account_key = v_seller_account_key
     and attempt.idempotency_key =
           'product-edit:ddccde35-9c58-4856-b673-d7aa27ce4220:7ffc6e46-3173-4695-9889-5fa1529765f1:e1f7beca-a124-4887-8536-6391f6aa017a'
     and job.environment = 'production'
     and job.status = 'queued'
     and job.attempt_count = 0
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.started_at is null
     and job.completed_at is null
     and job.provider_mutation_started_at is null
     and job.response_payload is null
     and job.error_message is null
     and job.created_by = v_job_created_by
     and job.created_at =
           '2026-09-01 05:10:35.344034+00'::timestamptz
     and job.request_fingerprint = v_request_fingerprint
     and encode(extensions.digest(
           (job.request_payload->'arguments')::text, 'sha256'
         ), 'hex') = v_arguments_sha256
     and octet_length((job.request_payload->'arguments')::text) = 20011
     and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') =
           v_request_payload_sha256
     and octet_length(job.request_payload::text) = 20026
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_prepared_at is null
     and job.prepared_credential_id is null
     and job.credential_refresh_recovery_vault_id is null
     and job.oauth_provider_call_started_at is null
     and credential.id = v_credential_id
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.version = 1
     and credential.fingerprint = 'F95F4754AFAE'
     and credential.seller_account_key = v_seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at =
           '2026-08-25 11:40:32.606508+00'::timestamptz
     and credential.last_checked_at =
           '2026-08-19 20:23:27.905445+00'::timestamptz
     and credential.last_check_status = 'passed'
     and credential.expires_at is null
     and credential.created_by = v_job_created_by
     and permit.channel = 'coupang'
     and permit.credential_version = credential.version
     and permit.credential_fingerprint = credential.fingerprint
     and permit.credential_account_source =
           credential.seller_account_key_source
     and permit.credential_verified_at =
           credential.seller_account_verified_at
     and permit.credential_expires_at is not distinct from credential.expires_at
     and permit.credential_last_checked_at is not distinct from
           credential.last_checked_at
     and permit.credential_last_check_status is not distinct from
           credential.last_check_status
     and permit.release_sha = v_release_sha
     and permit.request_fingerprint = v_request_fingerprint
     and permit.arguments_sha256 = v_arguments_sha256
     and permit.arguments_bytes = 20011
     and permit.request_payload_sha256 = v_request_payload_sha256
     and permit.request_payload_bytes = 20026
     and permit.armed_at =
           '2026-09-01 05:10:24.162179+00'::timestamptz
     and permit.expires_at =
           '2026-09-01 05:15:24.162179+00'::timestamptz
     and permit.expires_at <= statement_timestamp()
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and not egress_policy.enabled
     and public.sellerpilot_service_serverless_static_egress_status()
           ->> 'coupang' = 'false'
     and sellerpilot_private.active_serverless_runtime_release_sha() is null
     and (
       select count(*)::integer
         from cron.job schedule
        where schedule.jobname in (
          'sellerpilot-serverless-cs-wake-v1',
          'sellerpilot-product-research-v1',
          'sellerpilot-channel-sync-v1',
          'sellerpilot-competitor-prices-v1',
          'sellerpilot-kakao-notifications-v1',
          'sellerpilot-maintenance-v1'
        )
     ) = 6
     and (
       select count(*) filter (where schedule.active)::integer
         from cron.job schedule
        where schedule.jobname in (
          'sellerpilot-serverless-cs-wake-v1',
          'sellerpilot-product-research-v1',
          'sellerpilot-channel-sync-v1',
          'sellerpilot-competitor-prices-v1',
          'sellerpilot-kakao-notifications-v1',
          'sellerpilot-maintenance-v1'
        )
     ) = 0
     and not sellerpilot_private.serverless_static_egress_allowed('coupang')
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_job
        where other_job.attempt_id = v_attempt_id
          and other_job.id <> v_job_id
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_active
        where other_active.listing_id = v_listing_id
          and other_active.id <> v_job_id
          and other_active.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'price.update', 'inventory.update'
          )
          and other_active.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   for update of listing, product, attempt, job, credential, permit,
     egress_policy;

  if not found then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_PREFLIGHT_MISMATCH'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = v_manual_message,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.credential_id = v_credential_id
     and job.attempt_id = v_attempt_id
     and job.listing_id = v_listing_id
     and job.channel = 'coupang'
     and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.status = 'queued'
     and job.attempt_count = 0
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.started_at is null
     and job.completed_at is null
     and job.provider_mutation_started_at is null
     and job.response_payload is null
     and job.error_message is null
     and job.created_by = v_job_created_by
     and job.created_at =
           '2026-09-01 05:10:35.344034+00'::timestamptz
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_prepared_at is null
     and job.prepared_credential_id is null
     and job.credential_refresh_recovery_vault_id is null
     and job.oauth_provider_call_started_at is null
     and job.request_fingerprint = v_request_fingerprint
     and encode(extensions.digest(
           (job.request_payload->'arguments')::text, 'sha256'
         ), 'hex') = v_arguments_sha256
     and octet_length((job.request_payload->'arguments')::text) = 20011
     and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') =
           v_request_payload_sha256
     and octet_length(job.request_payload::text) = 20026;
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_JOB_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'unclaimed_static_egress'
   where permit.permit_id = v_permit_id
     and permit.update_job_id = v_job_id
     and permit.update_attempt_id = v_attempt_id
     and permit.release_sha = v_release_sha
     and permit.request_fingerprint = v_request_fingerprint
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at <= statement_timestamp();
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_PERMIT_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'manual_required',
         http_status = 409,
         safe_message = v_manual_message,
         completed_at = clock_timestamp()
   where attempt.id = v_attempt_id
     and attempt.status = 'running'
     and attempt.credential_id = v_credential_id
     and attempt.request_fingerprint = v_request_fingerprint
     and attempt.completed_at is null;
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_ATTEMPT_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.product_listings listing
     set status = 'failed',
         failure_class = 'external_action',
         last_error = v_manual_message,
         updated_at = clock_timestamp()
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and listing.status = 'queued'
     and listing.failure_class is null
     and listing.remote_id = '16356981734';
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_LISTING_RESTORE_FAILED'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    v_owner_id,
    'coupang_unclaimed_static_egress_job_retired',
    'channel_gateway_job',
    v_job_id::text,
    jsonb_build_object(
      'contract', 'coupang_unclaimed_static_egress_retirement_v1',
      'productId', v_product_id,
      'listingId', v_listing_id,
      'remoteId', '16356981734',
      'providerResourceId', '95962393877',
      'credentialId', v_credential_id,
      'credentialCreatedBy', v_job_created_by,
      'credentialVersion', 1,
      'credentialFingerprint', 'F95F4754AFAE',
      'credentialAccountSource', 'credential_incarnation_v1',
      'credentialVerifiedAt', '2026-08-25T11:40:32.606508Z',
      'credentialLastCheckedAt', '2026-08-19T20:23:27.905445Z',
      'credentialLastCheckStatus', 'passed',
      'credentialExpiresAt', null,
      'attemptId', v_attempt_id,
      'jobId', v_job_id,
      'jobCreatedBy', v_job_created_by,
      'permitId', v_permit_id,
      'releaseSha', v_release_sha,
      'requestFingerprint', v_request_fingerprint,
      'argumentsSha256', v_arguments_sha256,
      'requestPayloadSha256', v_request_payload_sha256,
      'previousJobStatus', 'queued',
      'terminalJobStatus', 'cancelled',
      'terminalAttemptStatus', 'manual_required',
      'terminalListingStatus', 'failed',
      'terminalFailureClass', 'external_action',
      'permitInvalidationReason', 'unclaimed_static_egress',
      'attemptCount', 0,
      'workerClaimed', false,
      'providerMutationStarted', false,
      'providerCallReplayed', false,
      'staticEgressAllowed', false,
      'runtimeActiveRelease', null,
      'runtimeSchedulesActive', false,
      'runtimeScheduleCount', 6,
      'runtimeDistinctScheduleCount', 6,
      'runtimePreimage', jsonb_build_object(
        'configured', (v_runtime_status->>'configured')::boolean,
        'version', v_runtime_status->>'version',
        'scheduleCount', (v_runtime_status->>'scheduleCount')::integer,
        'distinctScheduleCount', v_distinct_schedule_count,
        'active', (v_runtime_status->>'active')::boolean,
        'activeRelease', v_runtime_status->'activeRelease',
        'unsafePendingMutations',
          (v_runtime_status->>'unsafePendingMutations')::integer,
        'reconciliationRequiredMutations',
          (v_runtime_status->>'reconciliationRequiredMutations')::integer
      ),
      'auditPreimageCount', v_audit_preimage_count,
      'auditInsertExpectedCount', 1,
      'operatorAction', 'manual_coupang_wing_update'
    ),
    clock_timestamp()
  );
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_AUDIT_INSERT_FAILED'
      using errcode = '55000';
  end if;
end;
$reconcile_exact_coupang_unclaimed_static_egress_job$;

do $exact_coupang_unclaimed_static_egress_postimage$
declare
  v_manual_message constant text :=
    '쿠팡 API는 승인된 고정 egress가 없어 실행하지 않았습니다. 판매자 WING에서 기존 상품을 수동 수정하고 판매 상태를 확인해 주세요.';
  v_runtime_status jsonb;
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
  ) then
    select public.sellerpilot_service_serverless_cs_wakeup_status()
      into v_runtime_status;
    if v_runtime_status->>'configured' <> 'true'
     or v_runtime_status->>'version' <> 'serverless_runtime_v2'
     or v_runtime_status->>'scheduleCount' <> '6'
     or v_runtime_status->>'active' <> 'false'
     or v_runtime_status->'activeRelease' <> 'null'::jsonb
     or v_runtime_status->>'unsafePendingMutations' <> '0'
     or v_runtime_status->>'reconciliationRequiredMutations' <> '4'
     or sellerpilot_private.active_serverless_runtime_release_sha() is not null
     or public.sellerpilot_service_serverless_static_egress_status()
          ->> 'coupang' <> 'false'
     or (
       select count(*)::integer
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = 'coupang'
          and not policy.enabled
     ) <> 1
     or (
       select count(distinct schedule.jobname)::integer
         from cron.job schedule
        where schedule.jobname in (
          'sellerpilot-serverless-cs-wake-v1',
          'sellerpilot-product-research-v1',
          'sellerpilot-channel-sync-v1',
          'sellerpilot-competitor-prices-v1',
          'sellerpilot-kakao-notifications-v1',
          'sellerpilot-maintenance-v1'
        )
          and not schedule.active
     ) <> 6
    then
      raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_RUNTIME_POSTIMAGE_INVALID'
        using errcode = '55000';
    end if;
  end if;

  if exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
     ) and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
         join sellerpilot_private.channel_operation_attempts attempt
           on attempt.id = job.attempt_id
         join sellerpilot_private.product_listings listing
           on listing.id = job.listing_id
         join sellerpilot_private.exact_existing_update_permits permit
           on permit.update_job_id = job.id
          and permit.update_attempt_id = attempt.id
         join sellerpilot_private.channel_credentials credential
           on credential.id = job.credential_id
        where job.id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
          and job.status = 'cancelled'
          and job.attempt_count = 0
          and job.worker_token_id is null
          and job.claim_token is null
          and job.lease_expires_at is null
          and job.started_at is null
          and job.provider_mutation_started_at is null
          and job.response_payload is null
          and job.completed_at is not null
          and job.created_by =
                '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
          and job.created_at =
                '2026-09-01 05:10:35.344034+00'::timestamptz
          and not job.credential_refresh_in_flight
          and job.credential_refresh_started_at is null
          and job.credential_refresh_prepared_at is null
          and job.prepared_credential_id is null
          and job.credential_refresh_recovery_vault_id is null
          and job.oauth_provider_call_started_at is null
          and job.request_fingerprint =
                '5f4e3bca5d2a82c111fa86b2838de44353fe4d11bedb34435f9912c41f71c4fb'
          and encode(extensions.digest(
                (job.request_payload->'arguments')::text, 'sha256'
              ), 'hex') =
                '1054c64d400b65fc4214b15407a013c9b9a434fa4ac32374fb8203236954bf7b'
          and octet_length((job.request_payload->'arguments')::text) = 20011
          and encode(extensions.digest(
                job.request_payload::text, 'sha256'
              ), 'hex') =
                '7872552ce349e9101f94c80b669f6fe66aad596c92934482ad731b6080704a94'
          and octet_length(job.request_payload::text) = 20026
          and job.error_message = v_manual_message
          and attempt.id = '84afed0d-cc13-413d-b839-c35346f9b09f'::uuid
          and attempt.status = 'manual_required'
          and attempt.http_status = 409
          and attempt.safe_message = v_manual_message
          and attempt.completed_at is not null
          and listing.id = '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
          and listing.status = 'failed'
          and listing.failure_class = 'external_action'
          and listing.last_error = v_manual_message
          and listing.remote_id = '16356981734'
          and listing.remote_visibility = 'unknown'
          and listing.provider_status is null
          and listing.published_at is null
          and permit.permit_id =
                '0c07232d-4084-42ce-af09-b6da16235465'::uuid
          and credential.id =
                '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
          and credential.version = 1
          and credential.fingerprint = 'F95F4754AFAE'
          and credential.seller_account_key_source =
                'credential_incarnation_v1'
          and credential.seller_account_verified_at =
                '2026-08-25 11:40:32.606508+00'::timestamptz
          and credential.last_checked_at =
                '2026-08-19 20:23:27.905445+00'::timestamptz
          and credential.last_check_status = 'passed'
          and credential.expires_at is null
          and credential.created_by =
                '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
          and permit.credential_version = credential.version
          and permit.credential_fingerprint = credential.fingerprint
          and permit.credential_account_source =
                credential.seller_account_key_source
          and permit.credential_verified_at =
                credential.seller_account_verified_at
          and permit.credential_expires_at is not distinct from
                credential.expires_at
          and permit.credential_last_checked_at is not distinct from
                credential.last_checked_at
          and permit.credential_last_check_status is not distinct from
                credential.last_check_status
          and permit.invalidated_at is not null
          and permit.invalidation_reason = 'unclaimed_static_egress'
          and permit.bound_at is null
          and permit.bound_worker_token_id is null
          and permit.bound_claim_token is null
          and permit.consumed_at is null
          and (
            select count(*)::integer
              from sellerpilot_private.operation_audit audit
             where audit.action =
                     'coupang_unclaimed_static_egress_job_retired'
               and audit.entity_type = 'channel_gateway_job'
               and audit.entity_id = job.id::text
               and audit.safe_detail->>'contract' =
                     'coupang_unclaimed_static_egress_retirement_v1'
               and audit.safe_detail->>'providerCallReplayed' = 'false'
               and audit.safe_detail->>'providerMutationStarted' = 'false'
               and audit.safe_detail->>'jobCreatedBy' =
                     '21eb1892-0894-4f9f-b414-4c9464182dd6'
               and audit.safe_detail->>'credentialVersion' = '1'
               and audit.safe_detail->>'credentialCreatedBy' =
                     '21eb1892-0894-4f9f-b414-4c9464182dd6'
               and audit.safe_detail->>'credentialFingerprint' =
                     'F95F4754AFAE'
               and audit.safe_detail->>'credentialAccountSource' =
                     'credential_incarnation_v1'
               and audit.safe_detail->>'credentialVerifiedAt' =
                     '2026-08-25T11:40:32.606508Z'
               and audit.safe_detail->>'credentialLastCheckedAt' =
                     '2026-08-19T20:23:27.905445Z'
               and audit.safe_detail->>'credentialLastCheckStatus' = 'passed'
               and audit.safe_detail->'credentialExpiresAt' = 'null'::jsonb
               and audit.safe_detail->'runtimeActiveRelease' = 'null'::jsonb
               and audit.safe_detail->>'runtimeSchedulesActive' = 'false'
               and audit.safe_detail->>'runtimeScheduleCount' = '6'
               and audit.safe_detail->>'runtimeDistinctScheduleCount' = '6'
               and audit.safe_detail->'runtimePreimage'->>'configured' = 'true'
               and audit.safe_detail->'runtimePreimage'->>'version' =
                     'serverless_runtime_v2'
               and audit.safe_detail->'runtimePreimage'->>'scheduleCount' = '6'
               and audit.safe_detail->'runtimePreimage'
                     ->>'distinctScheduleCount' = '6'
               and audit.safe_detail->'runtimePreimage'->>'active' = 'false'
               and audit.safe_detail->'runtimePreimage'->'activeRelease' =
                     'null'::jsonb
               and audit.safe_detail->'runtimePreimage'
                     ->>'unsafePendingMutations' = '1'
               and audit.safe_detail->'runtimePreimage'
                     ->>'reconciliationRequiredMutations' = '4'
               and audit.safe_detail->>'auditPreimageCount' = '0'
               and audit.safe_detail->>'auditInsertExpectedCount' = '1'
          ) = 1
          and (
            select count(*)::integer
              from sellerpilot_private.operation_audit audit
             where audit.action =
                     'coupang_unclaimed_static_egress_job_retired'
               and audit.entity_type = 'channel_gateway_job'
               and audit.entity_id = job.id::text
          ) = 1
     )
  then
    raise exception 'COUPANG_UNCLAIMED_STATIC_EGRESS_POSTIMAGE_INVALID'
      using errcode = '55000';
  end if;
end;
$exact_coupang_unclaimed_static_egress_postimage$;

commit;
