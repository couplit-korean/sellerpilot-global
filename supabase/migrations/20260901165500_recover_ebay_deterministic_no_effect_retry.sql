-- Allow one new UI-initiated eBay exact listing.update after proving that the
-- previous provider attempt had deterministic zero effect: its first and only
-- PUT was rejected by Inventory API error 25718 before the offer PUT ran.
-- The old job is terminal and is never reused or automatically retried.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000001);

alter table sellerpilot_private.exact_existing_update_permits
  add column retry_source_job_id uuid
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  add column retry_source_attempt_id uuid
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  add column retry_source_permit_id uuid
    references sellerpilot_private.exact_existing_update_permits(permit_id)
      on delete restrict,
  add column retry_source_response_sha256 text;

alter table sellerpilot_private.exact_existing_update_permits
  add constraint exact_existing_update_retry_lineage_check check (
    (
      retry_source_job_id is null
      and retry_source_attempt_id is null
      and retry_source_permit_id is null
      and retry_source_response_sha256 is null
    ) or (
      channel = 'ebay'
      and listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
      and retry_source_job_id =
            '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
      and retry_source_attempt_id =
            '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
      and retry_source_permit_id =
            'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
      and retry_source_response_sha256 ~ '^[a-f0-9]{64}$'
    )
  );

create unique index exact_existing_one_retry_per_source_job
  on sellerpilot_private.exact_existing_update_permits(retry_source_job_id)
  where retry_source_job_id is not null;

create function sellerpilot_private.ebay_exact_no_effect_source_is_proved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = job.attempt_id
      join sellerpilot_private.product_listings listing
        on listing.id = job.listing_id
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.permit_id =
             'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
       and permit.update_job_id = job.id
       and permit.update_attempt_id = attempt.id
       and permit.listing_id = listing.id
     where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
       and job.attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and job.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and job.credential_id =
             '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and job.channel = 'ebay'
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.status = 'succeeded'
       and job.attempt_count = 1
       and job.worker_token_id is not null
       and job.claim_token is not null
       and job.started_at =
             '2026-09-01 08:16:05+00'::timestamptz
       and job.provider_mutation_started_at =
             '2026-09-01 08:16:12.740995+00'::timestamptz
       and job.completed_at =
             '2026-09-01 08:16:15.994005+00'::timestamptz
       and job.provider_mutation_started_at >= job.started_at
       and job.completed_at >= job.provider_mutation_started_at
       and job.request_fingerprint =
             '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
       and encode(extensions.digest(
             (job.request_payload->'arguments')::text, 'sha256'
           ), 'hex') =
             '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
       and encode(extensions.digest(
             job.request_payload::text, 'sha256'
           ), 'hex') =
             '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
       and job.request_payload#>>
             '{arguments,sellerpilotEbayExactExistingQaRecovery,contract}' =
             'ebay_exact_existing_qa_recovery_v2'
       and jsonb_typeof(job.response_payload) = 'object'
       and job.response_payload->>'ok' = 'false'
       and job.response_payload->>'channel' = 'ebay'
       and job.response_payload->>'operation' = 'listing.update'
       and job.response_payload->>'remoteId' = '800551945442'
       and jsonb_typeof(job.response_payload->'steps') = 'array'
       and jsonb_array_length(job.response_payload->'steps') = 4
       and job.response_payload#>>'{steps,0,name}' =
             'offer-update-discovery-readback'
       and job.response_payload#>>'{steps,0,ok}' = 'true'
       and job.response_payload#>>'{steps,1,name}' =
             'offer-update-preflight-readback'
       and job.response_payload#>>'{steps,1,ok}' = 'true'
       and job.response_payload#>>'{steps,2,name}' =
             'inventory-item-update-preflight-readback'
       and job.response_payload#>>'{steps,2,ok}' = 'true'
       and job.response_payload#>>'{steps,3,name}' =
             'inventory-item-update'
       and job.response_payload#>>'{steps,3,ok}' = 'false'
       and job.response_payload#>>'{steps,3,status}' = '400'
       and job.response_payload#>>'{steps,3,data,errors,0,errorId}' = '25718'
       and job.response_payload#>>'{steps,3,data,errors,0,domain}' =
             'API_INVENTORY'
       and job.response_payload#>>'{steps,3,data,errors,0,category}' =
             'Request'
       and job.response_payload#>>'{steps,3,data,errors,0,message}' =
             'Invalid value for description. The length should be between 1 and 4000 characters.'
       and not jsonb_path_exists(
             job.response_payload,
             '$.steps[*] ? (@.name == "offer-update")'
           )
       and attempt.id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and attempt.status = 'failed'
       and attempt.http_status = 400
       and attempt.remote_id = '800551945442'
       and attempt.completed_at = job.completed_at
       and attempt.gateway_write_required
       and not attempt.pre_gateway_retryable
       and attempt.request_fingerprint = job.request_fingerprint
       and listing.id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and listing.owner_id =
             '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and listing.product_id =
             'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = 'ebay'
       and listing.status = 'failed'
       and listing.failure_class = 'retryable'
       and listing.operation_attempt_id = attempt.id
       and listing.remote_id = '800551945442'
       and listing.market = 'US'
       and listing.target_id = 'EBAY_US'
       and listing.marketplace_sku = 'QA-20260823-CC-001-US'
       and listing.provider_resource_id = '244042196011'
       and listing.currency = 'USD'
       and listing.price = 12.90
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'unknown'
       and listing.provider_status is null
       and listing.published_at is null
       and listing.seller_account_key =
             'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
       and permit.channel = 'ebay'
       and permit.release_sha =
             '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b'
       and permit.request_fingerprint = job.request_fingerprint
       and permit.arguments_sha256 =
             '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
       and permit.request_payload_sha256 =
             '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
       and permit.bound_at is not null
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_claim_token = job.claim_token
       and permit.consumed_at is not null
       and permit.consumed_at >= permit.bound_at
       and permit.consumed_at <= job.completed_at
       and (
         (
           permit.invalidated_at is null
           and permit.invalidation_reason is null
         ) or (
           permit.invalidated_at is not null
           and permit.invalidated_at >= permit.consumed_at
           and permit.invalidation_reason =
                 'ebay_deterministic_no_effect_400'
         )
       )
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_no_effect_source_is_proved()
  from public, anon, authenticated, service_role;

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
    ) or (
      permit_id = 'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
      and channel = 'ebay'
      and listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
      and update_job_id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
      and update_attempt_id = '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
      and release_sha = '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b'
      and request_fingerprint =
            '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
      and arguments_sha256 =
            '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
      and request_payload_sha256 =
            '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
      and bound_at is not null and bound_worker_token_id is not null
      and bound_claim_token is not null and consumed_at is not null
      and invalidated_at is not null
      and invalidated_at >= consumed_at
      and invalidation_reason = 'ebay_deterministic_no_effect_400'
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
     and old.update_job_id = 'f22d0a45-c887-4e3a-b1f8-60f02627e133'::uuid
     and old.update_attempt_id = '84afed0d-cc13-413d-b839-c35346f9b09f'::uuid
     and old.bound_at is null and old.consumed_at is null
     and old.invalidated_at is null
     and new.invalidated_at is not null
     and new.invalidated_at >= old.expires_at
     and new.invalidation_reason = 'unclaimed_static_egress'
     and to_jsonb(new) - array['invalidated_at', 'invalidation_reason']
           is not distinct from
         to_jsonb(old) - array['invalidated_at', 'invalidation_reason']
  then return new; end if;

  if old.permit_id = 'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
     and old.channel = 'ebay'
     and old.listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and old.update_job_id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
     and old.update_attempt_id = '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
     and old.bound_at is not null
     and old.bound_worker_token_id is not null
     and old.bound_claim_token is not null
     and old.consumed_at is not null
     and old.invalidated_at is null
     and new.invalidated_at is not null
     and new.invalidated_at >= old.consumed_at
     and new.invalidation_reason = 'ebay_deterministic_no_effect_400'
     and sellerpilot_private.ebay_exact_no_effect_source_is_proved()
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

create function sellerpilot_private.ebay_exact_no_effect_retry_available(
  p_credential_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.ebay_exact_no_effect_source_is_proved()
    and sellerpilot_private.ebay_exact_current_credential_is_valid(
          p_credential_id,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        )
    and not exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs active_job
       where active_job.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
         and active_job.operation in (
           'listing.create', 'listing.update', 'listing.stop'
         )
         and active_job.status in (
           'queued', 'running', 'reconciliation_required'
         )
    )
    and (
      not exists (
        select 1
          from sellerpilot_private.exact_existing_update_permits retry
         where retry.retry_source_job_id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
      ) or exists (
        select 1
          from sellerpilot_private.exact_existing_update_permits retry
         where retry.retry_source_job_id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
           and retry.credential_id = p_credential_id
           and retry.invalidated_at is null
           and retry.update_job_id is null
           and retry.update_attempt_id is null
           and retry.bound_at is null
           and retry.consumed_at is null
           and retry.expires_at > statement_timestamp()
           and sellerpilot_private.exact_existing_update_release_is_current(
                 'ebay', retry.release_sha
               )
      )
    ),
    false
  )
$$;

create function sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.ebay_exact_no_effect_source_is_proved()
    and exists (
      select 1
        from sellerpilot_private.exact_existing_update_permits permit
       where permit.permit_id = p_permit_id
         and permit.channel = 'ebay'
         and permit.listing_id =
               '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
         and permit.retry_source_job_id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and permit.retry_source_attempt_id =
               '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
         and permit.retry_source_permit_id =
               'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
         and permit.retry_source_response_sha256 = encode(
               extensions.digest((
                 select source_job.response_payload::text
                   from sellerpilot_private.channel_gateway_jobs source_job
                  where source_job.id = permit.retry_source_job_id
               ), 'sha256'), 'hex'
             )
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.ebay_exact_no_effect_retry_available(uuid),
  sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(uuid)
  from public, anon, authenticated, service_role;

do $patch_ebay_retry_pre_enqueue_lineage$
declare
  v_definition text;
  v_before text := $old$
           and listing.provider_resource_id = permit.provider_resource_id
           and listing.status = 'failed'
           and listing.failure_class = 'external_action'
           and listing.requested_publication_intent = 'live'$old$;
  v_after text := $new$
           and listing.provider_resource_id = permit.provider_resource_id
           and listing.status = 'failed'
           and (
             listing.failure_class = 'external_action'
             or (
               listing.failure_class = 'retryable'
               and sellerpilot_private.ebay_exact_no_effect_retry_permit_is_current(
                     permit.permit_id
                   )
             )
           )
           and listing.requested_publication_intent = 'live'$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.exact_existing_update_lineage_is_current(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'eBay no-effect retry lineage patch target missing'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_ebay_retry_pre_enqueue_lineage$;

create or replace function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    p_listing_id uuid,
    p_credential_id uuid,
    p_product_id uuid,
    p_market text,
    p_target_id text
  )
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'ebay_exact_existing_qa_recovery_v2',
    'phase', 'listing.update',
    'productId', product.id,
    'listingId', listing.id,
    'sourceAttemptId',
      '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid,
    'publicListingId', listing.remote_id,
    'market', listing.market,
    'marketplaceId', listing.target_id,
    'marketplaceSku', listing.marketplace_sku,
    'offerId', listing.provider_resource_id,
    'currency', listing.currency,
    'priceUsd', listing.price,
    'stock', product.on_hand,
    'credentialId', credential.id,
    'sellerAccountKey', listing.seller_account_key,
    'offerIdSource', 'immutable_lineage_attestation_v1',
    'sellerAccountLineage', 'validated_by_service_rpc'
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
    join sellerpilot_private.provider_listing_lineage_attestations attestation
      on attestation.listing_id = listing.id
    join sellerpilot_private.channel_gateway_jobs lineage_job
      on lineage_job.id = attestation.gateway_job_id
    join sellerpilot_private.channel_credentials lineage_credential
      on lineage_credential.id = attestation.credential_id
   where p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'ebay'
     and listing.remote_id = '800551945442'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.remote_resources = '{}'::jsonb
     and listing.status = 'failed'
     and (
       (
         listing.failure_class = 'external_action'
         and listing.operation_attempt_id =
               '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid
       ) or (
         listing.failure_class = 'retryable'
         and listing.operation_attempt_id =
               '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
         and sellerpilot_private.ebay_exact_no_effect_retry_available(
               p_credential_id
             )
       )
     )
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.currency = 'USD'
     and listing.price = 12.90
     and listing.market = 'US'
     and listing.target_id = 'EBAY_US'
     and trim(coalesce(p_market, '')) = 'US'
     and trim(coalesce(p_target_id, '')) = 'EBAY_US'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand between 1 and 999999
     and not product.demo
     and product.status <> 'archived'
     and listing.seller_account_key =
       'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and credential.seller_account_key = listing.seller_account_key
     and sellerpilot_private.ebay_exact_current_credential_is_valid(
       credential.id, listing.seller_account_key
     )
     and attestation.id = 'fc54f95c-3533-4dbd-820f-cb2dfaf018e7'::uuid
     and attestation.credential_id =
       'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1'::uuid
     and attestation.gateway_job_id =
       'fdff6983-1f08-4f51-a751-bc61b4bf7070'::uuid
     and attestation.channel = 'ebay'
     and attestation.environment = 'production'
     and attestation.seller_account_key = listing.seller_account_key
     and attestation.expected_remote_id = listing.remote_id
     and attestation.verified_remote_id = listing.remote_id
     and attestation.market = listing.market
     and attestation.target_id = listing.target_id
     and attestation.marketplace_sku = listing.marketplace_sku
     and attestation.provider_resource_id = listing.provider_resource_id
     and attestation.evidence_version = 'provider_listing_readback_v1'
     and attestation.evidence_digest =
       '3ba3464e14408e04967534e0227f01424378fc8b5b112ea05887769fecff781a'
     and attestation.verified_at is not null
     and lineage_job.id =
       'fdff6983-1f08-4f51-a751-bc61b4bf7070'::uuid
     and lineage_job.listing_id = listing.id
     and lineage_job.credential_id = attestation.credential_id
     and lineage_job.channel = 'ebay'
     and lineage_job.environment = 'production'
     and lineage_job.operation = 'listing.lineage.verify'
     and lineage_job.status = 'succeeded'
     and lineage_job.seller_account_key = listing.seller_account_key
     and lineage_credential.id =
       'a05a7f65-c3a7-4ec6-91ea-ae92ed9708c1'::uuid
     and lineage_credential.channel = 'ebay'
     and lineage_credential.environment = 'production'
     and lineage_credential.status = 'revoked'
     and lineage_credential.version = 84
     and lineage_credential.fingerprint = 'A48BC6BD3D4B'
     and lineage_credential.seller_account_key = listing.seller_account_key
     and lineage_credential.seller_account_key_source = 'provider_certified_v1'
     and lineage_credential.seller_account_verified_at is not null
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = listing.id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   limit 1
$$;

create or replace function public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    p_listing_id, p_credential_id, p_product_id, p_market, p_target_id
  )
$$;

revoke all on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;

create function public.sellerpilot_service_arm_ebay_no_effect_retry(
  p_channel text,
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_stock integer;
  v_version integer;
  v_fingerprint text;
  v_account_source text;
  v_verified_at timestamptz;
  v_expires_at timestamptz;
  v_last_checked_at timestamptz;
  v_last_check_status text;
  v_source_response_sha256 text;
  v_now timestamptz := clock_timestamp();
  v_permit sellerpilot_private.exact_existing_update_permits%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
  then raise exception 'service role required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 917000001);

  if p_channel is distinct from 'ebay'
     or p_listing_id is distinct from
          '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_request_fingerprint =
          '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
     or not sellerpilot_private.exact_existing_update_release_is_current(
          'ebay', p_release_sha
        )
     or not sellerpilot_private.ebay_exact_no_effect_retry_available(
          p_credential_id
        )
  then
    raise exception 'eBay deterministic no-effect retry identity invalid'
      using errcode = '55000';
  end if;

  select listing.owner_id, product.on_hand,
         credential.version, credential.fingerprint,
         credential.seller_account_key_source,
         credential.seller_account_verified_at, credential.expires_at,
         credential.last_checked_at, credential.last_check_status
    into v_owner_id, v_stock, v_version, v_fingerprint,
         v_account_source, v_verified_at, v_expires_at,
         v_last_checked_at, v_last_check_status
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
   where listing.id = p_listing_id
     and listing.owner_id =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and listing.product_id =
           'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.operation_attempt_id =
           '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
     and listing.remote_id = '800551945442'
     and listing.market = 'US' and listing.target_id = 'EBAY_US'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.currency = 'USD' and listing.price = 12.90
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null and listing.published_at is null
     and listing.seller_account_key =
           'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand between 1 and 999999
     and not product.demo and product.status <> 'archived'
     and sellerpilot_private.ebay_exact_current_credential_is_valid(
           credential.id, listing.seller_account_key
         )
   for share of listing, product, credential;
  if not found then
    raise exception 'eBay deterministic no-effect retry identity invalid'
      using errcode = '55000';
  end if;

  select * into v_permit
    from sellerpilot_private.exact_existing_update_permits permit
   where permit.retry_source_job_id =
         '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
   for update;
  if found then
    if v_permit.credential_id is distinct from p_credential_id
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.update_job_id is not null
       or v_permit.update_attempt_id is not null
       or v_permit.bound_at is not null
       or v_permit.consumed_at is not null
       or v_permit.invalidated_at is not null
       or v_permit.expires_at <= statement_timestamp()
    then
      raise exception 'eBay deterministic no-effect retry already consumed'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', 'exact_existing_update_permit_v1',
      'permitId', v_permit.permit_id, 'channel', v_permit.channel,
      'listingId', v_permit.listing_id,
      'releaseSha', v_permit.release_sha,
      'requestFingerprint', v_permit.request_fingerprint,
      'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
      'bound', false, 'reused', true
    );
  end if;

  select encode(extensions.digest(job.response_payload::text, 'sha256'), 'hex')
    into v_source_response_sha256
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = v_now,
         invalidation_reason = 'ebay_deterministic_no_effect_400'
   where permit.permit_id =
         'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.consumed_at is not null;
  if not found then
    raise exception 'eBay deterministic no-effect source permit unavailable'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.exact_existing_update_permits (
    channel, listing_id, product_id, credential_id, owner_id,
    market, target_id, remote_id, seller_sku, provider_resource_id,
    currency, price, stock, seller_account_key,
    credential_version, credential_fingerprint,
    credential_account_source, credential_verified_at,
    credential_expires_at, credential_last_checked_at,
    credential_last_check_status, snapshot_revision,
    snapshot_payload_sha256, snapshot_source_job_id,
    release_sha, request_fingerprint, armed_at, expires_at,
    retry_source_job_id, retry_source_attempt_id,
    retry_source_permit_id, retry_source_response_sha256
  ) values (
    'ebay', p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id, v_owner_id, 'US', 'EBAY_US', '800551945442',
    'QA-20260823-CC-001-US', '244042196011', 'USD', 12.90,
    v_stock,
    'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f',
    v_version, v_fingerprint, v_account_source, v_verified_at,
    v_expires_at, v_last_checked_at, v_last_check_status,
    null, null, null, p_release_sha, p_request_fingerprint,
    v_now, v_now + interval '5 minutes',
    '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid,
    '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid,
    'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid,
    v_source_response_sha256
  ) returning * into v_permit;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    v_owner_id,
    'ebay_deterministic_no_effect_retry_armed',
    'exact_existing_update_permit',
    v_permit.permit_id::text,
    jsonb_build_object(
      'contract', 'ebay_exact_no_effect_retry_v1',
      'listingId', p_listing_id,
      'sourceJobId', v_permit.retry_source_job_id,
      'sourceAttemptId', v_permit.retry_source_attempt_id,
      'sourcePermitId', v_permit.retry_source_permit_id,
      'sourceHttpStatus', 400,
      'sourceProviderErrorId', 25718,
      'sourceProviderEffect', 'deterministic_rejection_no_effect',
      'replacementPermitId', v_permit.permit_id,
      'requestFingerprint', p_request_fingerprint,
      'releaseSha', p_release_sha,
      'autoRetry', false,
      'oldJobReused', false
    ),
    v_now
  );

  return jsonb_build_object(
    'contract', 'exact_existing_update_permit_v1',
    'permitId', v_permit.permit_id, 'channel', v_permit.channel,
    'listingId', v_permit.listing_id,
    'releaseSha', v_permit.release_sha,
    'requestFingerprint', v_permit.request_fingerprint,
    'armedAt', v_permit.armed_at, 'expiresAt', v_permit.expires_at,
    'bound', false, 'reused', false
  );
end;
$$;

revoke all on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_arm_ebay_no_effect_retry(
  text, uuid, uuid, text, text
) to service_role;

do $patch_ebay_retry_enqueue_preimage$
declare
  v_definition text;
  v_before text := $old$
       and listing.operation_attempt_id =
         (v_marker->>'sourceAttemptId')::uuid
       and listing.seller_account_key = credential.seller_account_key$old$;
  v_after text := $new$
       and (
         listing.operation_attempt_id =
           (v_marker->>'sourceAttemptId')::uuid
         or (
           listing.operation_attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
           and listing.failure_class = 'retryable'
           and sellerpilot_private.ebay_exact_no_effect_retry_available(
                 p_credential_id
               )
         )
       )
       and listing.seller_account_key = credential.seller_account_key$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'eBay no-effect retry enqueue patch target missing'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$patch_ebay_retry_enqueue_preimage$;

create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
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
  v_retry jsonb :=
    p_request_payload#>'{arguments,sellerpilotEbayExactNoEffectRetry}';
  v_recovery_permit boolean;
begin
  if p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     and p_channel = 'ebay'
     and p_operation = 'listing.update'
  then
    select exists (
      select 1
        from sellerpilot_private.exact_existing_update_permits permit
       where permit.channel = 'ebay'
         and permit.listing_id = p_listing_id
         and permit.credential_id = p_credential_id
         and permit.retry_source_job_id =
               '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
         and permit.update_job_id is null
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
    ) into v_recovery_permit;
    if v_recovery_permit and (
         jsonb_typeof(v_retry) is distinct from 'object'
         or jsonb_object_length(v_retry) <> 7
         or v_retry->>'contract' is distinct from
              'ebay_exact_no_effect_retry_v1'
         or v_retry->>'sourceJobId' is distinct from
              '08e8cff9-5d7c-4992-b668-6d932aa5ff10'
         or v_retry->>'sourceAttemptId' is distinct from
              '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'
         or v_retry->>'sourcePermitId' is distinct from
              'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'
         or v_retry->>'sourceRequestFingerprint' is distinct from
              '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
         or v_retry->'providerErrorId' is distinct from '25718'::jsonb
         or v_retry->>'providerEffect' is distinct from
              'deterministic_rejection_no_effect'
       )
    then
      raise exception 'EBAY_EXACT_NO_EFFECT_RETRY_MARKER_REQUIRED'
        using errcode = '55000';
    end if;
    if not v_recovery_permit and v_retry is not null then
      raise exception 'EBAY_EXACT_NO_EFFECT_RETRY_MARKER_FORBIDDEN'
        using errcode = '55000';
    end if;
  end if;
  return public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
    p_listing_id, p_credential_id, p_attempt_id, p_channel,
    p_operation, p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

do $ebay_no_effect_retry_postimage$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, '08e8cff9-5d7c-4992-b668-6d932aa5ff10') = 0
     or pg_catalog.strpos(v_definition, '25718') = 0
     or pg_catalog.strpos(v_definition, 'p_request_fingerprint =') = 0
     or pg_catalog.strpos(v_definition, 'oldJobReused'', false') = 0
     or not exists (
       select 1
         from pg_catalog.pg_index index_row
        where index_row.indexrelid =
              'sellerpilot_private.exact_existing_one_retry_per_source_job'::regclass
          and index_row.indisunique
     )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)',
          'EXECUTE'
        )
  then
    raise exception 'eBay deterministic no-effect retry postimage invalid'
      using errcode = '55000';
  end if;
end;
$ebay_no_effect_retry_postimage$;

notify pgrst, 'reload schema';

commit;
