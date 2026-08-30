-- The pending-publication rollout replaced the canonical listing.create
-- wrapper with the effective release gate, but delegated directly to the
-- 300950 predecessor. That skipped the verified publication contract and the
-- atomic requested_publication_intent write introduced by 301000. Preserve
-- the stronger effective gate while restoring the verified enqueue ledger for
-- every listing channel.

begin;

create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create(
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

  if not sellerpilot_private.listing_mutation_release_gate_is_effective() then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;

  perform sellerpilot_private.assert_verified_listing_enqueue_contract(
    'listing.create',
    p_request_payload,
    p_request_fingerprint,
    null
  );

  v_result := public.sellerpilot_300950_reserve_listing_before_release_gate(
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
       and listing.operation_attempt_id = p_attempt_id
       and listing.channel_key = p_channel;
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

comment on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) is 'Effective-gated listing.create reservation with verified publication contract, exact queued lineage, and atomic safe_test/live intent ledger.';

-- The same 301100 replacement also bypassed the 301000 update/stop wrapper.
-- Restore persisted-intent inheritance and the exact attempt fingerprint while
-- retaining the effective release gate before any predecessor is called.
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
  v_intent text;
  v_requested_intent text;
  v_request_fingerprint text;
  v_payload jsonb := p_request_payload;
  v_result jsonb;
  v_job_id uuid;
  v_bound_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective()
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;

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

  v_result := public.sellerpilot_300950_enqueue_listing_before_release_gate(
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

comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is 'Effective-gated listing.update/stop enqueue with persisted publication intent, verified contract, and exact attempt fingerprint lineage.';

commit;
