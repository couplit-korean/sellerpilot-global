-- Separate a requested publication intent from the state that was actually
-- read back from the marketplace. A successful HTTP mutation is not proof that
-- an item is orderable, and a safe draft must never be counted as published.

begin;

alter table sellerpilot_private.product_listings
  add column if not exists requested_publication_intent text not null default 'safe_test',
  add column if not exists remote_visibility text not null default 'unknown',
  add column if not exists provider_status text,
  add column if not exists remote_resources jsonb not null default '{}'::jsonb,
  add column if not exists remote_created_at timestamptz;

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_publication_intent_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_publication_intent_check
  check (requested_publication_intent in ('safe_test', 'live'));

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_remote_visibility_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_remote_visibility_check
  check (remote_visibility in (
    'unknown', 'non_public', 'pending_review', 'live', 'withdrawn', 'rejected'
  ));

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_provider_status_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_provider_status_check
  check (
    provider_status is null
    or (
      length(trim(provider_status)) between 1 and 160
      and provider_status !~ '[[:cntrl:]]'
    )
  );

alter table sellerpilot_private.product_listings
  drop constraint if exists product_listings_remote_resources_check;
alter table sellerpilot_private.product_listings
  add constraint product_listings_remote_resources_check
  check (
    jsonb_typeof(remote_resources) = 'object'
    and octet_length(remote_resources::text) <= 65536
  );

-- Provider resource shapes differ by channel. Match the exact remote identity
-- against bounded JSON values (never object keys or substrings), mirroring the
-- server contract while remaining independent of channel-specific field names.
create or replace function sellerpilot_private.jsonb_contains_exact_scalar(
  p_value jsonb,
  p_expected text,
  p_depth integer default 0
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_found boolean := false;
begin
  if p_depth > 6 or p_expected = '' then return false; end if;
  if jsonb_typeof(p_value) in ('string', 'number') then
    return p_value#>>'{}' = p_expected;
  elsif jsonb_typeof(p_value) = 'array' then
    select exists (
      select 1
        from jsonb_array_elements(p_value) entry(value)
       where sellerpilot_private.jsonb_contains_exact_scalar(
         entry.value,
         p_expected,
         p_depth + 1
       )
    ) into v_found;
  elsif jsonb_typeof(p_value) = 'object' then
    select exists (
      select 1
        from jsonb_each(p_value) entry(key, value)
       where sellerpilot_private.jsonb_contains_exact_scalar(
         entry.value,
         p_expected,
         p_depth + 1
       )
    ) into v_found;
  end if;
  return v_found;
end;
$$;

revoke all on function
  sellerpilot_private.jsonb_contains_exact_scalar(jsonb, text, integer)
  from public, anon, authenticated, service_role;

-- Keep the trigger's one-shot rollout exception deliberately small. The
-- validator compares the complete OLD/NEW rows and permits only the exact
-- deterministic downgrade performed below; setting the transaction marker
-- can never authorize an arbitrary listing mutation.
create or replace function sellerpilot_private.legacy_remote_publication_downgrade_allowed(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language sql
stable
strict
set search_path = ''
as $$
  with expected as (
    select p_old->>'status' as old_status,
           (
             nullif(trim(coalesce(p_old->>'remote_id', '')), '') is not null
             or nullif(trim(coalesce(p_old->>'published_at', '')), '') is not null
           ) as has_legacy_publication_claim
  )
  select p_new = p_old || jsonb_build_object(
    'requested_publication_intent', case
      when expected.has_legacy_publication_claim
        or expected.old_status = 'published'
        or nullif(trim(coalesce(p_old->>'published_at', '')), '') is not null
        then 'live'
      else 'safe_test'
    end,
    'status', case
      when expected.has_legacy_publication_claim then 'failed'
      else expected.old_status
    end,
    'remote_visibility', 'unknown',
    'provider_status', null,
    'remote_resources', '{}'::jsonb,
    'remote_created_at', null,
    'published_at', null,
    'last_verified_at', case
      when expected.has_legacy_publication_claim then null
      else p_old->'last_verified_at'
    end,
    'failure_class', case
      when expected.has_legacy_publication_claim
        then to_jsonb('external_action'::text)
      else p_old->'failure_class'
    end,
    'last_error', case
      when expected.has_legacy_publication_claim
        then to_jsonb('기존 원격 상품 기록은 검증된 공개 상태 증거가 없어 판매자센터 재조회가 필요합니다.'::text)
      else p_old->'last_error'
    end,
    'updated_at', to_jsonb(statement_timestamp())
  )
    from expected
$$;

revoke all on function
  sellerpilot_private.legacy_remote_publication_downgrade_allowed(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Product listing identity is normally immutable behind an exact terminal
-- gateway job. Install a one-transaction maintenance branch before touching
-- historical rows so the rollout can downgrade an old workflow-success claim
-- even when its seller/attempt lineage is no longer reconstructable. The
-- branch permits only the deterministic fields and values below; table ACLs
-- remain revoked and the marker is local to this migration transaction.
do $migration$
declare
  v_definition text;
  v_before text := 'begin
  if old.seller_account_key is null';
  v_after text := 'begin
  if current_setting(''sellerpilot.remote_publication_backfill'', true) = ''legacy-unverified-v1'' then
    if not sellerpilot_private.legacy_remote_publication_downgrade_allowed(
      to_jsonb(old),
      to_jsonb(new)
    ) then
      raise exception ''invalid legacy remote publication downgrade'';
    end if;
    return new;
  end if;

  if old.seller_account_key is null';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilot.remote_publication_backfill')
       = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'product listing seller lineage guard entry not found';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$migration$;

select pg_catalog.set_config(
  'sellerpilot.remote_publication_backfill',
  'legacy-unverified-v1',
  true
);

-- Historical `published` meant that the workflow/HTTP mutation succeeded; it
-- did not prove marketplace visibility. Preserve the requested live intent,
-- but downgrade every historical publication claim to a manual readback fence.
-- Never manufacture verified live/non-public evidence during a migration.
insert into sellerpilot_private.operation_audit (
  owner_id, action, entity_type, entity_id, safe_detail
)
select listing.owner_id,
       'listing_legacy_publication_downgraded',
       'product_listing',
       listing.id::text,
       jsonb_build_object(
         'prior_status', listing.status,
         'prior_published_at', listing.published_at,
         'had_remote_identity',
           nullif(trim(coalesce(listing.remote_id, '')), '') is not null,
         'reason', 'verified_remote_readback_required'
       )
  from sellerpilot_private.product_listings listing
 where (
     nullif(trim(coalesce(listing.remote_id, '')), '') is not null
     or listing.published_at is not null
   );

update sellerpilot_private.product_listings listing
   set requested_publication_intent = case
         when nullif(trim(coalesce(listing.remote_id, '')), '') is not null
           or listing.status = 'published'
           or listing.published_at is not null
           then 'live'
         else 'safe_test'
       end,
       status = case
         when nullif(trim(coalesce(listing.remote_id, '')), '') is not null
           or listing.published_at is not null
           then 'failed'
         else listing.status
       end,
       remote_visibility = 'unknown',
       provider_status = null,
       remote_resources = '{}'::jsonb,
       remote_created_at = null,
       published_at = null,
       last_verified_at = case
         when nullif(trim(coalesce(listing.remote_id, '')), '') is not null
           or listing.published_at is not null
           then null
         else listing.last_verified_at
       end,
       failure_class = case
         when nullif(trim(coalesce(listing.remote_id, '')), '') is not null
           or listing.published_at is not null
           then 'external_action'
         else listing.failure_class
       end,
       last_error = case
         when nullif(trim(coalesce(listing.remote_id, '')), '') is not null
           or listing.published_at is not null
           then '기존 원격 상품 기록은 검증된 공개 상태 증거가 없어 판매자센터 재조회가 필요합니다.'
         else listing.last_error
       end,
       updated_at = statement_timestamp();

select pg_catalog.set_config(
  'sellerpilot.remote_publication_backfill',
  '',
  true
);

insert into sellerpilot_private.operation_audit (
  owner_id, action, entity_type, entity_id, safe_detail
)
select product.owner_id,
       'product_legacy_publication_downgraded',
       'product',
       product.id::text,
       jsonb_build_object(
         'prior_status', product.status,
         'reason', 'verified_remote_readback_required'
       )
  from sellerpilot_private.products product
 where product.status = 'active'
   and not exists (
     select 1
       from sellerpilot_private.product_listings listing
      where listing.product_id = product.id
        and listing.requested_publication_intent = 'live'
        and listing.remote_visibility = 'live'
        and listing.published_at is not null
   );

update sellerpilot_private.products product
   set status = 'draft',
       updated_at = clock_timestamp()
 where product.status = 'active'
   and not exists (
     select 1
       from sellerpilot_private.product_listings listing
      where listing.product_id = product.id
        and listing.requested_publication_intent = 'live'
        and listing.remote_visibility = 'live'
        and listing.published_at is not null
   );

create index if not exists product_listings_remote_visibility_idx
  on sellerpilot_private.product_listings (
    product_id, remote_visibility, requested_publication_intent, updated_at desc
  );

create index if not exists product_listings_remote_reconciliation_idx
  on sellerpilot_private.product_listings (owner_id, updated_at desc)
  where failure_class = 'external_action'
    and remote_visibility = 'unknown';

-- Preserve the stable claim timestamp used by order/inquiry normalization,
-- while exposing a separate listing-only boundary taken from the exact
-- provider-mutation fence. A readback captured after claim but before the
-- provider write must never certify a listing mutation.
alter function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) rename to sellerpilot_301000_gateway_completion_context_pre_publication_boundary;

revoke all on function
  public.sellerpilot_301000_gateway_completion_context_pre_publication_boundary(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_gateway_completion_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_operation text;
  v_provider_mutation_started_at timestamptz;
begin
  v_context := public.sellerpilot_301000_gateway_completion_context_pre_publication_boundary(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
  if v_context is null then return null; end if;

  v_operation := v_context->>'operation';
  if v_operation not in ('listing.create', 'listing.update', 'listing.stop') then
    return v_context;
  end if;

  select job.provider_mutation_started_at
    into v_provider_mutation_started_at
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.operation = v_operation;
  if not found then return null; end if;

  return v_context || jsonb_build_object(
    'publication_verification_boundary',
    v_provider_mutation_started_at
  );
end;
$$;

revoke all on function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) to service_role;

-- Apply the provider-certified state after the legacy gateway completion has
-- atomically settled its job and attempt rows. The caller passes the prior row
-- so a definite pre-write update/stop rejection can retain an already verified
-- remote listing, while an uncertain write is always downgraded and fenced.
create or replace function sellerpilot_private.apply_verified_remote_listing_completion(
  p_job_id uuid,
  p_listing_id uuid,
  p_operation text,
  p_terminal_status text,
  p_error_message text,
  p_prior_listing jsonb,
  p_prior_product_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing record;
  v_job record;
  v_job_bound boolean := false;
  v_response_payload jsonb;
  v_request_arguments jsonb;
  v_state jsonb;
  v_visibility text := 'unknown';
  v_provider_status text;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_evidence jsonb;
  v_resources jsonb;
  v_remote_resources jsonb := '{}'::jsonb;
  v_locale text;
  v_fingerprint text;
  v_image_count integer;
  v_expected_locale text;
  v_expected_fingerprint text;
  v_expected_image_count integer;
  v_response_remote_id text;
  v_publication_fulfilled boolean;
  v_job_boundary_at timestamptz;
  v_state_valid boolean := false;
  v_result_ok boolean := false;
  v_prior_visibility text;
  v_prior_provider_status text;
  v_prior_resources jsonb;
  v_prior_remote_created_at timestamptz;
  v_prior_published_at timestamptz;
  v_prior_verified_at timestamptz;
  v_has_prior_remote boolean := false;
  v_effective_error text;
  v_action text;
begin
  if p_listing_id is null
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or p_terminal_status not in ('succeeded', 'failed', 'reconciliation_required')
     or p_prior_listing is null
     or jsonb_typeof(p_prior_listing) <> 'object' then
    raise exception 'invalid verified remote listing completion';
  end if;

  select listing.id, listing.owner_id, listing.product_id, listing.remote_id,
         listing.channel_key, listing.requested_publication_intent, listing.status,
         listing.remote_visibility, listing.provider_status,
         listing.remote_resources, listing.remote_created_at,
         listing.published_at, listing.last_verified_at
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id
   for update;
  if not found then
    raise exception 'product listing not found';
  end if;

  if p_job_id is not null then
    select job.id, job.listing_id, job.channel, job.operation, job.status,
           job.request_payload, job.response_payload, job.request_fingerprint,
           job.created_at, job.started_at, job.provider_mutation_started_at
      into v_job
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = p_job_id
     for update;
    v_job_bound := found
      and v_job.listing_id is not distinct from p_listing_id
      and v_job.channel is not distinct from v_listing.channel_key
      and v_job.operation is not distinct from p_operation
      and v_job.status is not distinct from p_terminal_status;
  end if;
  if v_job_bound then
    v_response_payload := v_job.response_payload;
    v_request_arguments := v_job.request_payload->'arguments';
    v_job_boundary_at := v_job.provider_mutation_started_at;
  end if;

  v_prior_visibility := coalesce(
    nullif(p_prior_listing->>'remote_visibility', ''),
    'unknown'
  );
  v_prior_provider_status := nullif(
    trim(coalesce(p_prior_listing->>'provider_status', '')),
    ''
  );
  v_prior_resources := case
    when jsonb_typeof(p_prior_listing->'remote_resources') = 'object'
      then p_prior_listing->'remote_resources'
    else '{}'::jsonb
  end;
  begin
    v_prior_remote_created_at := nullif(
      p_prior_listing->>'remote_created_at',
      ''
    )::timestamptz;
  exception when others then
    v_prior_remote_created_at := null;
  end;
  begin
    v_prior_published_at := nullif(
      p_prior_listing->>'published_at',
      ''
    )::timestamptz;
  exception when others then
    v_prior_published_at := null;
  end;
  begin
    v_prior_verified_at := nullif(
      p_prior_listing->>'last_verified_at',
      ''
    )::timestamptz;
  exception when others then
    v_prior_verified_at := null;
  end;
  v_has_prior_remote := nullif(trim(coalesce(
    p_prior_listing->>'remote_id',
    ''
  )), '') is not null;

  v_result_ok := v_job_bound
    and p_terminal_status = 'succeeded'
    and jsonb_typeof(v_response_payload) = 'object'
    and jsonb_typeof(v_response_payload->'ok') = 'boolean'
    and coalesce((v_response_payload->>'ok')::boolean, false);
  v_state := v_response_payload->'remoteState';

  if v_job_bound
     and jsonb_typeof(v_response_payload) = 'object'
     and jsonb_typeof(v_request_arguments) = 'object'
     and jsonb_typeof(v_state) = 'object' then
    v_visibility := coalesce(v_state->>'visibility', 'unknown');
    v_provider_status := nullif(trim(coalesce(
      v_state->>'providerStatus',
      ''
    )), '');
    v_evidence := v_state->'evidence';
    v_resources := v_state->'resources';
    v_locale := nullif(trim(coalesce(v_state->>'locale', '')), '');
    v_fingerprint := lower(coalesce(v_state->>'fingerprint', ''));
    v_expected_locale := nullif(trim(coalesce(
      v_request_arguments->>'publicationExpectedLocale',
      ''
    )), '');
    v_expected_fingerprint := lower(coalesce(
      v_request_arguments->>'publicationExpectedFingerprint',
      ''
    ));
    v_response_remote_id := nullif(trim(coalesce(
      v_response_payload->>'remoteId',
      ''
    )), '');
    begin
      if jsonb_typeof(v_state->'imageCount') = 'number'
         and (v_state->>'imageCount') ~ '^[0-9]{1,3}$' then
        v_image_count := (v_state->>'imageCount')::integer;
      end if;
      if jsonb_typeof(v_request_arguments->'publicationExpectedImageCount')
           = 'number'
         and (v_request_arguments->>'publicationExpectedImageCount')
           ~ '^[0-9]{1,3}$' then
        v_expected_image_count := (
          v_request_arguments->>'publicationExpectedImageCount'
        )::integer;
      end if;
      if jsonb_typeof(v_response_payload->'publicationFulfilled')
           = 'boolean' then
        v_publication_fulfilled := (
          v_response_payload->>'publicationFulfilled'
        )::boolean;
      end if;
      v_verified_at := nullif(v_state->>'verifiedAt', '')::timestamptz;
      if nullif(v_state->>'createdAt', '') is not null then
        v_created_at := (v_state->>'createdAt')::timestamptz;
      end if;
    exception when others then
      v_verified_at := null;
      v_created_at := null;
      v_image_count := null;
    end;

    v_state_valid := v_response_payload->>'publicationStateContract'
        = 'verified_remote_state_v1'
      and v_request_arguments->>'publicationStateContract'
        = 'verified_remote_state_v1'
      and v_response_payload->>'channel' = v_listing.channel_key
      and v_response_payload->>'operation' = p_operation
      and jsonb_typeof(v_state->'verified') = 'boolean'
      and coalesce((v_state->>'verified')::boolean, false)
      and v_visibility in (
        'non_public', 'pending_review', 'live', 'withdrawn', 'rejected'
      )
      and v_provider_status is not null
      and length(v_provider_status) <= 160
      and v_provider_status !~ '[[:cntrl:]]'
      and v_verified_at is not null
      and v_job_boundary_at is not null
      and v_verified_at >= v_job_boundary_at
      and v_verified_at <= clock_timestamp() + interval '5 minutes'
      and jsonb_typeof(v_evidence) = 'object'
      and v_evidence <> '{}'::jsonb
      and octet_length(v_evidence::text) <= 32768
      and jsonb_typeof(v_evidence->'identityVerified') = 'boolean'
      and coalesce((v_evidence->>'identityVerified')::boolean, false)
      and jsonb_typeof(v_evidence->'statusVerified') = 'boolean'
      and coalesce((v_evidence->>'statusVerified')::boolean, false)
      and jsonb_typeof(v_evidence->'localeVerified') = 'boolean'
      and coalesce((v_evidence->>'localeVerified')::boolean, false)
      and jsonb_typeof(v_evidence->'fingerprintVerified') = 'boolean'
      and coalesce((v_evidence->>'fingerprintVerified')::boolean, false)
      and jsonb_typeof(v_evidence->'imageCountVerified') = 'boolean'
      and coalesce((v_evidence->>'imageCountVerified')::boolean, false)
      and jsonb_typeof(v_resources) = 'object'
      and v_resources <> '{}'::jsonb
      and octet_length(v_resources::text) <= 32768
      and v_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
      and v_expected_locale = v_locale
      and v_fingerprint ~ '^[a-f0-9]{64}$'
      and v_expected_fingerprint = v_fingerprint
      and v_job.request_fingerprint = v_fingerprint
      and v_image_count between 0 and 64
      and v_expected_image_count between 0 and 64
      and v_image_count >= v_expected_image_count
      and v_response_remote_id is not null
      and length(v_response_remote_id) <= 240
      and v_listing.remote_id is not distinct from v_response_remote_id
      and sellerpilot_private.jsonb_contains_exact_scalar(
        v_resources,
        v_response_remote_id
      )
      and case
        when p_operation = 'listing.stop' then
          not (v_request_arguments ? 'publicationIntent')
          and not (v_response_payload ? 'publicationIntent')
          and (
            (v_visibility in ('non_public', 'withdrawn')
              and v_publication_fulfilled is true)
            or (v_visibility = 'live'
              and v_publication_fulfilled is false)
            or (v_visibility = 'rejected'
              and not v_result_ok
              and v_publication_fulfilled is false)
          )
        when v_request_arguments->>'publicationIntent'
               = v_listing.requested_publication_intent
         and v_response_payload->>'publicationIntent'
               = v_listing.requested_publication_intent then
          case
            when v_visibility = 'rejected' and not v_result_ok
              then v_publication_fulfilled is false
            when v_listing.requested_publication_intent = 'safe_test'
              then (
                v_visibility in ('non_public', 'withdrawn')
                  and v_publication_fulfilled is true
              ) or (
                v_visibility = 'live'
                  and v_publication_fulfilled is false
              )
            when v_visibility = 'live'
              then v_publication_fulfilled is true
            when v_visibility = 'pending_review'
              then v_publication_fulfilled is false
            else false
          end
        else false
      end;

    if v_state_valid then
      v_remote_resources := jsonb_build_object(
        'resources', v_resources,
        'verification', jsonb_build_object(
          'verifiedAt', v_verified_at,
          'evidence', v_evidence,
          'locale', v_locale,
          'fingerprint', v_fingerprint,
          'imageCount', v_image_count
        )
      );
      if octet_length(v_remote_resources::text) > 65536 then
        v_state_valid := false;
        v_remote_resources := '{}'::jsonb;
      end if;
    end if;
  end if;

  v_effective_error := left(coalesce(
    nullif(trim(p_error_message), ''),
    nullif(trim(v_response_payload->>'safeMessage'), ''),
    '원격 판매 상태를 검증하지 못했습니다.'
  ), 1000);

  -- A verified exposure is more important than the transport classifier. The
  -- worker deliberately reports an intent mismatch as reconciliation_required
  -- because a provider mutation was observed, but that must not erase the
  -- authoritative readback proving that the item is still live.
  if v_state_valid
     and p_operation = 'listing.stop'
     and v_visibility = 'live' then
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           remote_visibility = 'live',
           provider_status = v_provider_status,
           remote_resources = v_remote_resources,
           remote_created_at = coalesce(
             v_created_at,
             v_prior_remote_created_at
           ),
           published_at = case
             when v_listing.requested_publication_intent = 'live'
               then coalesce(v_prior_published_at, v_verified_at)
             else null
           end,
           last_verified_at = v_verified_at,
           last_error = '중지 요청 후에도 원격 상품이 공개 상태로 확인됐습니다. 판매자센터에서 수동 중지해야 합니다.',
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_stop_remote_live_detected';

  elsif v_state_valid
        and p_operation in ('listing.create', 'listing.update')
        and v_listing.requested_publication_intent = 'safe_test'
        and v_visibility = 'live' then
    -- A safe-test request that unexpectedly became live is a confirmed remote
    -- exposure, but it is not an authorized publication. Fence all retries and
    -- require an operator to withdraw it; never count it as published.
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           remote_visibility = 'live',
           provider_status = v_provider_status,
           remote_resources = v_remote_resources,
           remote_created_at = coalesce(
             v_created_at,
             v_prior_remote_created_at
           ),
           published_at = null,
           last_verified_at = v_verified_at,
           last_error = '안전 등록 요청이 원격에서 공개 상태로 확인됐습니다. 즉시 판매자센터에서 비공개 처리해야 합니다.',
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_safe_test_exposure_detected';

  elsif p_terminal_status = 'reconciliation_required' then
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           requested_publication_intent = coalesce(
             nullif(p_prior_listing->>'requested_publication_intent', ''),
             'safe_test'
           ),
           remote_visibility = 'unknown',
           provider_status = null,
           remote_resources = '{}'::jsonb,
           remote_created_at = null,
           published_at = null,
           last_verified_at = null,
           last_error = v_effective_error,
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_remote_state_reconciliation_required';

  elsif not v_result_ok then
    if p_operation in ('listing.update', 'listing.stop')
       and v_has_prior_remote
       and v_prior_visibility <> 'unknown' then
      update sellerpilot_private.product_listings listing
         set status = 'failed',
             requested_publication_intent = coalesce(
               nullif(p_prior_listing->>'requested_publication_intent', ''),
               'safe_test'
             ),
             remote_visibility = v_prior_visibility,
             provider_status = v_prior_provider_status,
             remote_resources = v_prior_resources,
             remote_created_at = v_prior_remote_created_at,
             published_at = v_prior_published_at,
             last_verified_at = v_prior_verified_at,
             last_error = v_effective_error,
             failure_class = 'retryable',
             updated_at = clock_timestamp()
       where listing.id = p_listing_id;
      v_action := 'listing_remote_state_preserved_after_rejection';
    else
      update sellerpilot_private.product_listings listing
         set status = 'failed',
             requested_publication_intent = coalesce(
               nullif(p_prior_listing->>'requested_publication_intent', ''),
               'safe_test'
             ),
             remote_visibility = case
               when v_state_valid and v_visibility = 'rejected'
                 then 'rejected'
               else 'unknown'
             end,
             provider_status = case
               when v_state_valid then v_provider_status else null end,
             remote_resources = case
               when v_state_valid then v_remote_resources else '{}'::jsonb end,
             remote_created_at = case
               when v_state_valid then v_created_at else null end,
             published_at = null,
             last_verified_at = case
               when v_state_valid then v_verified_at else null end,
             last_error = v_effective_error,
             failure_class = case
               when v_state_valid
                and v_visibility = 'rejected'
                and v_response_remote_id is not null
                 then 'external_action'
               else 'retryable'
             end,
             updated_at = clock_timestamp()
       where listing.id = p_listing_id;
      v_action := 'listing_remote_state_rejected';
    end if;

  elsif not v_state_valid then
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           requested_publication_intent = coalesce(
             nullif(p_prior_listing->>'requested_publication_intent', ''),
             'safe_test'
           ),
           remote_visibility = 'unknown',
           provider_status = null,
           remote_resources = '{}'::jsonb,
           remote_created_at = null,
           published_at = null,
           last_verified_at = null,
           last_error = '원격 작업은 응답했지만 공개 상태, 언어, 이미지 또는 읽기 증거를 검증하지 못했습니다.',
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_remote_state_unverified';

  elsif v_visibility = 'live'
        and v_listing.requested_publication_intent = 'live' then
    update sellerpilot_private.product_listings listing
       set status = 'published',
           remote_visibility = 'live',
           provider_status = v_provider_status,
           remote_resources = v_remote_resources,
           remote_created_at = coalesce(
             v_created_at,
             v_prior_remote_created_at
           ),
           published_at = coalesce(
             v_prior_published_at,
             v_verified_at
           ),
           last_verified_at = v_verified_at,
           last_error = null,
           failure_class = null,
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_remote_live_verified';

  elsif v_visibility in ('non_public', 'pending_review', 'withdrawn') then
    update sellerpilot_private.product_listings listing
       set status = 'paused',
           remote_visibility = v_visibility,
           provider_status = v_provider_status,
           remote_resources = v_remote_resources,
           remote_created_at = coalesce(
             v_created_at,
             v_prior_remote_created_at
           ),
           published_at = case
             when v_listing.requested_publication_intent = 'live'
              and (
                v_visibility = 'withdrawn'
                or p_operation = 'listing.stop'
              )
               then v_prior_published_at
             else null
           end,
           last_verified_at = v_verified_at,
           last_error = null,
           failure_class = null,
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_remote_non_public_verified';

  elsif v_visibility = 'rejected' then
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           remote_visibility = 'rejected',
           provider_status = v_provider_status,
           remote_resources = v_remote_resources,
           remote_created_at = coalesce(
             v_created_at,
             v_prior_remote_created_at
           ),
           published_at = null,
           last_verified_at = v_verified_at,
           last_error = v_effective_error,
           failure_class = case
             when nullif(trim(coalesce(v_listing.remote_id, '')), '')
               is not null then 'external_action'
             else 'retryable'
           end,
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_remote_rejected_verified';

  else
    -- This branch is deliberately fail-closed for any future state/intent
    -- combination that passes the structural validator but has no explicit
    -- publication transition above.
    update sellerpilot_private.product_listings listing
       set status = 'failed',
           remote_visibility = 'unknown',
           provider_status = null,
           remote_resources = '{}'::jsonb,
           remote_created_at = null,
           published_at = null,
           last_verified_at = null,
           last_error = '원격 상품 상태 조합을 안전하게 분류하지 못했습니다.',
           failure_class = 'external_action',
           updated_at = clock_timestamp()
     where listing.id = p_listing_id;
    v_action := 'listing_remote_state_unclassified';
  end if;

  update sellerpilot_private.products product
     set status = case
           when exists (
             select 1
               from sellerpilot_private.product_listings live_listing
              where live_listing.product_id = product.id
                and live_listing.requested_publication_intent = 'live'
                and live_listing.remote_visibility = 'live'
                and live_listing.published_at is not null
           ) then 'active'
           when product.status = 'active' then 'draft'
           when p_prior_product_status = 'active' then 'draft'
           else product.status
         end,
         updated_at = clock_timestamp()
   where product.id = v_listing.product_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    v_action,
    'product_listing',
    p_listing_id::text,
    jsonb_build_object(
      'operation', p_operation,
      'terminal_status', p_terminal_status,
      'requested_intent', v_listing.requested_publication_intent,
      'verified', v_state_valid,
      'remote_visibility', case
        when v_state_valid then v_visibility else 'unknown' end,
      'provider_status', case
        when v_state_valid then v_provider_status else null end
    )
  );

  return v_action;
end;
$$;

revoke all on function sellerpilot_private.apply_verified_remote_listing_completion(
  uuid, uuid, text, text, text, jsonb, text
) from public, anon, authenticated, service_role;

-- The release gate controls when a mutation may run; this contract controls
-- what may enter the queue after the gate opens. Keep it private so every
-- service-role caller must pass through the final public enqueue wrappers.
create function sellerpilot_private.assert_verified_listing_enqueue_contract(
  p_operation text,
  p_request_payload jsonb,
  p_request_fingerprint text,
  p_expected_intent text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_arguments jsonb;
  v_intent text;
  v_locale text;
  v_expected_fingerprint text;
  v_expected_image_count_text text;
begin
  if coalesce(jsonb_typeof(p_request_payload) <> 'object', true)
     or coalesce(
       jsonb_typeof(p_request_payload->'arguments') <> 'object',
       true
     ) then
    raise exception 'invalid verified listing publication contract'
      using errcode = '22023';
  end if;
  v_arguments := p_request_payload->'arguments';
  v_locale := coalesce(v_arguments->>'publicationExpectedLocale', '');
  v_expected_fingerprint := coalesce(
    v_arguments->>'publicationExpectedFingerprint',
    ''
  );
  v_expected_image_count_text := coalesce(
    v_arguments->>'publicationExpectedImageCount',
    ''
  );

  if coalesce(
       jsonb_typeof(v_arguments->'publicationStateContract') <> 'string',
       true
     )
     or v_arguments->>'publicationStateContract'
       <> 'verified_remote_state_v1'
     or coalesce(
       jsonb_typeof(v_arguments->'publicationExpectedLocale') <> 'string',
       true
     )
     or v_locale is distinct from trim(v_locale)
     or length(v_locale) not between 2 and 35
     or v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
     or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or coalesce(
       jsonb_typeof(
         v_arguments->'publicationExpectedFingerprint'
       ) <> 'string',
       true
     )
     or v_expected_fingerprint !~ '^[a-f0-9]{64}$'
     or v_expected_fingerprint is distinct from p_request_fingerprint
     or coalesce(
       jsonb_typeof(
         v_arguments->'publicationExpectedImageCount'
       ) <> 'number',
       true
     )
     or coalesce(
       v_expected_image_count_text !~ '^(0|[1-9][0-9]?)$',
       true
     )
     or v_expected_image_count_text::integer not between 0 and 64 then
    raise exception 'invalid verified listing publication contract'
      using errcode = '22023';
  end if;

  if (
       p_operation in ('listing.create', 'listing.update')
       and v_expected_image_count_text <> '8'
     )
     or (
       p_operation = 'listing.stop'
       and v_expected_image_count_text <> '0'
     ) then
    raise exception 'invalid verified listing publication image count'
      using errcode = '22023';
  end if;

  if p_operation in ('listing.create', 'listing.update') then
    v_intent := v_arguments->>'publicationIntent';
    if coalesce(
         jsonb_typeof(v_arguments->'publicationIntent') <> 'string',
         true
       )
       or v_intent not in ('safe_test', 'live')
       or (
         p_expected_intent is not null
         and v_intent is distinct from p_expected_intent
       ) then
      raise exception 'invalid verified listing publication intent'
        using errcode = '22023';
    end if;
  elsif p_operation = 'listing.stop' then
    if v_arguments ? 'publicationIntent' then
      raise exception 'listing stop publication intent is forbidden'
        using errcode = '22023';
    end if;
  else
    raise exception 'invalid verified listing publication operation'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function
  sellerpilot_private.assert_verified_listing_enqueue_contract(
    text, jsonb, text, text
  ) from public, anon, authenticated, service_role;

-- The older resource fence treated a fingerprint without a resource key as
-- SQL UNKNOWN. Make the listing exception explicit so new listing jobs can
-- carry the completion fingerprint while legacy rows remain deployable.
alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_write_resource_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_write_resource_check check (
    (
      write_resource_kind is null
      and write_resource_key is null
      and request_fingerprint is null
      and inventory_item_id is null
      and order_id is null
      and shipment_carrier is null
      and shipment_tracking is null
    ) or coalesce((
      listing_id is not null
      and operation in ('listing.create', 'listing.update', 'listing.stop')
      and write_resource_kind is null
      and write_resource_key is null
      and request_fingerprint ~ '^[a-f0-9]{64}$'
      and inventory_item_id is null
      and order_id is null
      and shipment_carrier is null
      and shipment_tracking is null
    ), false) or coalesce((
      write_resource_kind in ('listing_mutation', 'order_shipment')
      and write_resource_key ~ '^[a-f0-9]{64}$'
      and request_fingerprint ~ '^[a-f0-9]{64}$'
      and (
        shipment_carrier is null
        or length(shipment_carrier) between 1 and 40
      )
      and (
        shipment_tracking is null
        or length(shipment_tracking) <= 100
      )
    ), false)
  ) not valid;

-- Record safe_test/live on the exact listing reservation. Contract-less
-- rolling callers fail closed instead of manufacturing a safe default.
alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_301000_reserve_listing_pre_intent;

revoke all on function public.sellerpilot_301000_reserve_listing_pre_intent(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent text := nullif(trim(
    p_request_payload#>>'{arguments,publicationIntent}'
  ), '');
  v_result jsonb;
  v_listing_id uuid;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform sellerpilot_private.assert_verified_listing_enqueue_contract(
    'listing.create',
    p_request_payload,
    p_request_fingerprint,
    null
  );

  v_result := public.sellerpilot_301000_reserve_listing_pre_intent(
    p_product_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_market,
    p_target_id,
    p_currency,
    p_price,
    p_request_fingerprint,
    p_request_payload
  );

  if v_result->>'status' = 'queued' then
    if coalesce(v_result->>'job_id', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_result->>'listing_id', '')
         !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'reserved publication job lineage missing';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;
    v_listing_id := (v_result->>'listing_id')::uuid;
    perform 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_job_id
       and job.listing_id = v_listing_id
       and job.attempt_id = p_attempt_id
       and job.channel = p_channel
       and job.operation = 'listing.create'
       and job.status in ('queued', 'running')
       and job.request_payload = p_request_payload
       and job.request_fingerprint = p_request_fingerprint;
    if not found then
      raise exception 'reserved publication job lineage mismatch';
    end if;
  end if;

  if v_result->>'status' = 'queued'
     and coalesce((v_result->>'reused')::boolean, false) is false
     and coalesce(v_result->>'listing_id', '')
       ~ '^[0-9a-fA-F-]{36}$' then
    v_listing_id := (v_result->>'listing_id')::uuid;
    update sellerpilot_private.product_listings listing
       set requested_publication_intent = v_intent,
           remote_visibility = 'unknown',
           provider_status = null,
           remote_resources = '{}'::jsonb,
           remote_created_at = null,
           published_at = null,
           last_verified_at = null,
           updated_at = clock_timestamp()
     where listing.id = v_listing_id
       and listing.operation_attempt_id = p_attempt_id;
    if not found then
      raise exception 'reserved publication intent lineage mismatch';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

-- A content update inherits the listing's persisted publication intent. It may
-- not silently turn a staged listing live or turn a live listing into a test.
-- Stop is visibility-driven and preserves the same listing intent unchanged.
alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_301000_enqueue_listing_pre_intent;

revoke all on function public.sellerpilot_301000_enqueue_listing_pre_intent(
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
  v_intent text;
  v_requested_intent text;
  v_request_fingerprint text;
  v_payload jsonb := p_request_payload;
  v_result jsonb;
  v_job_id uuid;
  v_bound_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_operation = 'listing.create' then
    raise exception 'ATOMIC_LISTING_CREATE_REQUIRED';
  end if;
  select attempt.request_fingerprint
    into v_request_fingerprint
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = p_attempt_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = p_channel
     and attempt.operation = p_operation
     and attempt.status = 'running'
   for update;
  if not found then raise exception 'running listing operation required'; end if;

  if p_operation = 'listing.update' then
    select listing.requested_publication_intent
      into v_intent
      from sellerpilot_private.product_listings listing
     where listing.id = p_listing_id
       and listing.channel_key = p_channel
     for update;
    if not found then raise exception 'product listing not found'; end if;
    if jsonb_typeof(p_request_payload) <> 'object'
       or (
         p_request_payload ? 'arguments'
         and jsonb_typeof(p_request_payload->'arguments') <> 'object'
       ) then
      raise exception 'invalid listing update payload';
    end if;
    v_requested_intent := nullif(trim(
      p_request_payload#>>'{arguments,publicationIntent}'
    ), '');
    if v_requested_intent is not null
       and v_requested_intent is distinct from v_intent then
      raise exception 'listing update publication intent mismatch';
    end if;
    v_payload := jsonb_set(
      p_request_payload,
      '{arguments}',
      coalesce(p_request_payload->'arguments', '{}'::jsonb)
        || jsonb_build_object('publicationIntent', v_intent),
      true
    );
  end if;

  perform sellerpilot_private.assert_verified_listing_enqueue_contract(
    p_operation,
    v_payload,
    v_request_fingerprint,
    case when p_operation = 'listing.update' then v_intent else null end
  );

  v_result := public.sellerpilot_301000_enqueue_listing_pre_intent(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    v_payload
  );
  if v_result->>'status' = 'queued' then
    if coalesce(v_result->>'job_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'verified publication job lineage missing';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;
    select job.id
      into v_bound_job_id
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_job_id
       and job.listing_id = p_listing_id
       and job.attempt_id = p_attempt_id
       and job.channel = p_channel
       and job.operation = p_operation
       and job.status = 'running'
       and job.request_payload = v_payload
       and job.request_fingerprint = v_request_fingerprint;
    if found then return v_result; end if;

    update sellerpilot_private.channel_gateway_jobs job
       set request_fingerprint = v_request_fingerprint,
           updated_at = clock_timestamp()
     where job.id = v_job_id
       and job.listing_id = p_listing_id
       and job.attempt_id = p_attempt_id
       and job.channel = p_channel
       and job.operation = p_operation
       and job.status = 'queued'
       and job.request_payload = v_payload
       and (
         job.request_fingerprint is null
         or job.request_fingerprint = v_request_fingerprint
       )
    returning job.id into v_bound_job_id;
    if v_bound_job_id is null then
      raise exception 'verified publication job lineage mismatch';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

-- The serialized public gateway wrapper remains the canonical completion RPC.
-- Its private predecessor performs all existing OAuth/job/attempt fencing;
-- this wrapper then corrects the listing ledger in the same transaction.
create or replace function public.sellerpilot_complete_channel_gateway_job(
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
  v_job record;
  v_prior_listing jsonb;
  v_prior_product_status text;
  v_completed boolean;
  v_terminal_status text;
  v_terminal_error text;
  v_terminal_response jsonb;
  v_listing_action text;
  v_reconciliation_message text :=
    '원격 상품 작업 응답은 수신했지만 이 작업 이후의 검증된 게시 상태로 확정하지 못했습니다.';
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select job.listing_id, job.attempt_id, job.operation
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
   for update;

  if found and v_job.listing_id is not null
     and v_job.operation in ('listing.create', 'listing.update', 'listing.stop') then
    select to_jsonb(listing), product.status
      into v_prior_listing, v_prior_product_status
      from sellerpilot_private.product_listings listing
      join sellerpilot_private.products product on product.id = listing.product_id
     where listing.id = v_job.listing_id
     for update of listing, product;
  end if;

  v_completed := public.sellerpilot_11820_complete_gateway_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_status,
    p_response_payload,
    p_error_message
  );
  if v_completed is not true
     or v_prior_listing is null
     or v_job.listing_id is null then
    return v_completed;
  end if;

  select job.status, job.error_message, job.response_payload
    into v_terminal_status, v_terminal_error, v_terminal_response
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;

  v_listing_action := sellerpilot_private.apply_verified_remote_listing_completion(
    p_job_id,
    v_job.listing_id,
    v_job.operation,
    v_terminal_status,
    coalesce(v_terminal_error, p_error_message),
    v_prior_listing,
    v_prior_product_status
  );

  -- The legacy completion settles the transport job before the verified
  -- publication ledger is applied. Never leave that transport status exposed
  -- as succeeded when the exact listing result was fenced by this transaction.
  -- A definite provider rejection has `ok = false` and keeps its existing
  -- retry semantics; this downgrade is for claimed publication success only.
  if v_terminal_status = 'succeeded'
     and v_job.operation in ('listing.create', 'listing.update', 'listing.stop')
     and v_job.attempt_id is not null
     and (
       case
         when jsonb_typeof(v_terminal_response->'ok') = 'boolean'
           then coalesce((v_terminal_response->>'ok')::boolean, false)
         else false
       end
     )
     and v_listing_action not in (
       'listing_remote_live_verified',
       'listing_remote_non_public_verified'
     ) then
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'reconciliation_required',
           error_message = v_reconciliation_message,
           completed_at = coalesce(job.completed_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where job.id = p_job_id
       and job.status = 'succeeded';
    if not found then
      raise exception 'verified listing completion status changed'
        using errcode = '40001';
    end if;

    update sellerpilot_private.channel_operation_attempts attempt
       set status = 'manual_required',
           http_status = 409,
           safe_message = v_reconciliation_message,
           completed_at = clock_timestamp()
     where attempt.id = v_job.attempt_id
       and attempt.status in (
         'running', 'succeeded', 'failed', 'manual_required'
       );
    if not found then
      raise exception 'verified listing attempt status missing'
        using errcode = '40001';
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) to service_role;

-- Keep the legacy direct completion signature for rolling deployments, but it
-- has no normalized provider readback. A claimed success therefore becomes a
-- manual reconciliation state instead of manufacturing a published listing.
alter function public.sellerpilot_service_complete_product_listing(
  uuid, uuid, text, boolean, text, text
) rename to sellerpilot_301000_complete_listing_pre_remote_state;

revoke all on function public.sellerpilot_301000_complete_listing_pre_remote_state(
  uuid, uuid, text, boolean, text, text
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_product_listing(
  p_listing_id uuid,
  p_attempt_id uuid,
  p_operation text,
  p_success boolean,
  p_remote_id text,
  p_safe_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_listing jsonb;
  v_prior_product_status text;
  v_completed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select to_jsonb(listing), product.status
    into v_prior_listing, v_prior_product_status
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product on product.id = listing.product_id
   where listing.id = p_listing_id
   for update of listing, product;

  v_completed := public.sellerpilot_301000_complete_listing_pre_remote_state(
    p_listing_id,
    p_attempt_id,
    p_operation,
    p_success,
    p_remote_id,
    p_safe_message
  );
  if v_completed is not true or v_prior_listing is null then
    return v_completed;
  end if;

  perform sellerpilot_private.apply_verified_remote_listing_completion(
    null,
    p_listing_id,
    p_operation,
    case when p_success then 'succeeded' else 'failed' end,
    p_safe_message,
    v_prior_listing,
    v_prior_product_status
  );
  return true;
end;
$$;

revoke all on function public.sellerpilot_service_complete_product_listing(
  uuid, uuid, text, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_complete_product_listing(
  uuid, uuid, text, boolean, text, text
) to service_role;

-- An idempotent duplicate is useful only when it returns the same verified
-- visibility evidence as the original response. Do not let a duplicate
-- attempt collapse back to an ambiguous `ok: true` plus remote ID.
alter function public.sellerpilot_claim_channel_operation(
  uuid, text, text, text, text
) rename to sellerpilot_301000_claim_channel_operation_pre_remote_state;

revoke all on function
  public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
    uuid, text, text, text, text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_claim_channel_operation(
  p_credential_id uuid,
  p_channel text,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_attempt_id uuid;
  v_job record;
  v_listing_id uuid;
  v_remote_state jsonb;
  v_publication_intent text;
  v_contract_attempt boolean := false;
begin
  v_result := public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
    p_credential_id,
    p_channel,
    p_operation,
    p_idempotency_key,
    p_request_fingerprint
  );

  if coalesce((v_result->>'duplicate')::boolean, false) is not true
     or v_result->>'status' <> 'succeeded'
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or coalesce(v_result->>'attempt_id', '')
       !~ '^[0-9a-fA-F-]{36}$' then
    return v_result;
  end if;
  v_attempt_id := (v_result->>'attempt_id')::uuid;

  -- Resolve the immutable gateway result owned by this exact idempotency
  -- attempt. The mutable listing row may already point at a later update/stop
  -- attempt and must never rewrite an older replay result.
  select job.listing_id, job.channel, job.operation, job.status,
         job.request_payload, job.response_payload
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.attempt_id = v_attempt_id
     and job.channel = p_channel
     and job.operation = p_operation
   order by job.created_at desc, job.id
   limit 1;
  if not found or v_job.listing_id is null then
    return v_result || jsonb_build_object(
      'publication_intent', 'invalid',
      'remote_state', null,
      'listing_id', null,
      'legacy_publication_result', false
    );
  end if;
  v_listing_id := v_job.listing_id;
  if not exists (
    select 1
      from sellerpilot_private.product_listings listing
     where listing.id = v_listing_id
       and listing.channel_key = p_channel
  ) then
    return v_result || jsonb_build_object(
      'publication_intent', 'invalid',
      'remote_state', null,
      'listing_id', v_listing_id,
      'legacy_publication_result', false
    );
  end if;

  v_contract_attempt :=
    v_job.request_payload#>>'{arguments,publicationStateContract}'
      = 'verified_remote_state_v1'
    or v_job.request_payload#>>'{arguments,publicationIntent}'
      in ('safe_test', 'live');

  if v_contract_attempt
     and v_job.status = 'succeeded'
     and jsonb_typeof(v_job.response_payload) = 'object'
     and v_job.response_payload->>'ok' = 'true'
     and v_job.response_payload->>'publicationStateContract'
       = 'verified_remote_state_v1'
     and jsonb_typeof(v_job.response_payload->'remoteState') = 'object' then
    v_remote_state := v_job.response_payload->'remoteState';
    if p_operation in ('listing.create', 'listing.update') then
      v_publication_intent := coalesce(
        nullif(v_job.response_payload->>'publicationIntent', ''),
        nullif(
          v_job.request_payload#>>'{arguments,publicationIntent}',
          ''
        ),
        'invalid'
      );
    end if;
  end if;

  return v_result || jsonb_build_object(
    'publication_intent', case
      when not v_contract_attempt then null
      when p_operation = 'listing.stop' then null
      else coalesce(v_publication_intent, 'invalid')
    end,
    'remote_state', v_remote_state,
    'listing_id', v_listing_id,
    'legacy_publication_result', not v_contract_attempt
  );
end;
$$;

revoke all on function public.sellerpilot_claim_channel_operation(
  uuid, text, text, text, text
) from public, anon, service_role;
grant execute on function public.sellerpilot_claim_channel_operation(
  uuid, text, text, text, text
) to authenticated;

-- Permit a successful safe create/update to settle as paused only when the
-- exact terminal gateway payload contains verified non-public readback. The
-- existing immutable seller-lineage checks remain unchanged.
do $migration$
declare
  v_definition text;
  v_before text := '(new.status = ''paused'' and v_attempt.operation <> ''listing.stop'')';
  v_after text := '(new.status = ''paused'' and v_attempt.operation <> ''listing.stop'' and not (v_attempt.operation in (''listing.create'', ''listing.update'') and v_job.response_payload#>>''{remoteState,verified}'' = ''true'' and v_job.response_payload#>>''{remoteState,visibility}'' in (''non_public'', ''pending_review'', ''withdrawn'')))';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_after) > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'product listing seller lineage pause guard not found';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$migration$;

revoke all on function sellerpilot_private.guard_product_listing_seller_lineage()
  from public, anon, authenticated, service_role;

-- Extend the existing authenticated publish context without exposing seller
-- account lineage or raw gateway payloads.
alter function public.sellerpilot_get_product_publish_context(uuid)
  rename to sellerpilot_get_product_publish_context_pre_remote_state;

revoke all on function
  public.sellerpilot_get_product_publish_context_pre_remote_state(uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_get_product_publish_context(
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_listings jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  v_result := public.sellerpilot_get_product_publish_context_pre_remote_state(
    p_product_id
  );
  if v_result is null then return null; end if;

  select coalesce(
    jsonb_agg(
      entry.value || jsonb_build_object(
        'requestedPublicationIntent', listing.requested_publication_intent,
        'remoteVisibility', listing.remote_visibility,
        'providerStatus', listing.provider_status,
        'remoteResources', listing.remote_resources,
        'remoteCreatedAt', listing.remote_created_at,
        'remoteVerifiedAt', listing.last_verified_at
      ) order by entry.ordinality
    ),
    '[]'::jsonb
  )
    into v_listings
    from jsonb_array_elements(coalesce(v_result->'listings', '[]'::jsonb))
      with ordinality as entry(value, ordinality)
    left join sellerpilot_private.product_listings listing
      on listing.id::text = entry.value->>'id';

  return jsonb_set(v_result, '{listings}', v_listings, true);
end;
$$;

revoke all on function public.sellerpilot_get_product_publish_context(uuid)
  from public, anon, service_role;
grant execute on function public.sellerpilot_get_product_publish_context(uuid)
  to authenticated;

-- Registration progress uses the same sanitized truth. Preserve every
-- existing activity-card field, replace only product-card channel rows, and
-- count publication only when both intent and verified visibility are live.
alter function public.sellerpilot_list_registration_activity(integer)
  rename to sellerpilot_list_registration_activity_pre_remote_state;

revoke all on function
  public.sellerpilot_list_registration_activity_pre_remote_state(integer)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_list_registration_activity(
  p_limit integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_augmented jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  v_result := public.sellerpilot_list_registration_activity_pre_remote_state(
    p_limit
  );

  select coalesce(
    jsonb_agg(
      case
        when entry.value->>'id' like 'product:%'
         and coalesce(entry.value->>'productId', '')
           ~ '^[0-9a-fA-F-]{36}$' then
          entry.value || jsonb_build_object(
            'publishedCount', (
              select count(*)
                from sellerpilot_private.product_listings published_listing
               where published_listing.product_id =
                       (entry.value->>'productId')::uuid
                 and published_listing.requested_publication_intent = 'live'
                 and published_listing.remote_visibility = 'live'
                 and published_listing.published_at is not null
            ),
            'channels', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'channel', listing.channel_key,
                  'channelCode', channel.code,
                  'channelName', channel.name,
                  'market', listing.market,
                  'status', case
                    when listing.status = 'failed'
                     and listing.failure_class = 'external_action'
                      then 'blocked'
                    when listing.status = 'queued' and attempt.id is null
                      then 'draft'
                    else listing.status
                  end,
                  'message', coalesce(
                    listing.last_error,
                    attempt.safe_message,
                    ''
                  ),
                  'updatedAt', listing.updated_at,
                  'requestedPublicationIntent',
                    listing.requested_publication_intent,
                  'remoteVisibility', listing.remote_visibility,
                  'providerStatus', listing.provider_status,
                  'remoteCreatedAt', listing.remote_created_at,
                  'remoteVerifiedAt', listing.last_verified_at
                )
                order by channel.sort_order, listing.market, listing.target_id
              )
                from sellerpilot_private.product_listings listing
                join sellerpilot_private.channels channel
                  on channel.key = listing.channel_key
                left join sellerpilot_private.channel_operation_attempts attempt
                  on attempt.id = listing.operation_attempt_id
               where listing.product_id =
                       (entry.value->>'productId')::uuid
            ), '[]'::jsonb)
          )
        else entry.value
      end
      order by entry.ordinality
    ),
    '[]'::jsonb
  ) into v_augmented
    from jsonb_array_elements(coalesce(v_result, '[]'::jsonb))
      with ordinality as entry(value, ordinality);
  return v_augmented;
end;
$$;

revoke all on function public.sellerpilot_list_registration_activity(integer)
  from public, anon, service_role;
grant execute on function public.sellerpilot_list_registration_activity(integer)
  to authenticated;

commit;
