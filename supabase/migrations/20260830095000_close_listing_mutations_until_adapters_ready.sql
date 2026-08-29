-- Install a closed provider-mutation boundary before the verified publication
-- ledger and marketplace adapters. The gate starts closed and can only be
-- changed through the service-role RPC.

begin;

create table sellerpilot_private.listing_mutation_release_gate (
  singleton boolean primary key default true check (singleton),
  is_open boolean not null default false,
  opened_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint listing_mutation_release_gate_opened_at_check check (
    (is_open and opened_at is not null)
    or (not is_open and opened_at is null)
  )
);

alter table sellerpilot_private.listing_mutation_release_gate
  enable row level security;
revoke all on sellerpilot_private.listing_mutation_release_gate
  from public, anon, authenticated, service_role;

insert into sellerpilot_private.listing_mutation_release_gate (
  singleton, is_open, opened_at
) values (true, false, null);

-- Serialize installation with the existing listing enqueue boundary. The
-- table lock prevents a legacy caller from inserting between this audit and
-- replacement of the public enqueue functions. A pending provider mutation
-- must be explicitly drained or reconciled before this migration is retried.
do $$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.operation in (
       'listing.create', 'listing.update', 'listing.stop'
     )
       and job.status in ('queued', 'running')
  ) then
    raise exception
      'listing mutation jobs must drain before release-gate installation'
      using errcode = '55000';
  end if;
end;
$$;

-- Enqueue wrappers prevent new jobs while closed. Keep a second boundary on
-- the worker claim transition so a job queued while the gate was open cannot
-- begin a provider mutation after an operator closes the gate.
create function sellerpilot_private.block_closed_listing_mutation_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'queued'
     and new.status = 'running'
     and (
       old.operation in ('listing.create', 'listing.update', 'listing.stop')
       or new.operation in ('listing.create', 'listing.update', 'listing.stop')
     )
     and not coalesce((
       select gate.is_open
         from sellerpilot_private.listing_mutation_release_gate gate
        where gate.singleton
     ), false) then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.block_closed_listing_mutation_claim()
  from public, anon, authenticated, service_role;

create trigger block_closed_listing_mutation_claim
before update of status on sellerpilot_private.channel_gateway_jobs
for each row
execute function sellerpilot_private.block_closed_listing_mutation_claim();

-- A claim can be running for credential refresh and media preparation before
-- its first provider write. Recheck the gate at that exact mutation boundary,
-- serialized with the same advisory lock as gate changes. Whichever
-- transaction wins the lock defines the boundary: a close that commits first
-- blocks the mutation; a mutation already recorded before the close may finish
-- and must still complete its authoritative readback.
alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) rename to sellerpilot_300950_begin_gateway_mutation_before_release_gate;

revoke all on function
  public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.operation
    into v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;

  if v_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not coalesce((
       select gate.is_open
         from sellerpilot_private.listing_mutation_release_gate gate
        where gate.singleton
     ), false) then
    return false;
  end if;

  return public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_begin_gateway_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_gateway_provider_mutation(
    text, uuid, uuid
  ) to service_role;

-- The dedicated serverless gateway is optional in reduced/test deployments.
-- When present, wrap its mutation boundary with the same gate; when absent,
-- there is no serverless provider-write path to fence.
do $serverless_gate$
begin
  if to_regprocedure(
    'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
  ) is null then
    return;
  end if;

  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) rename to sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate';
  execute 'revoke all on function public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text, uuid, uuid) from public, anon, authenticated, service_role';
  execute $create$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid
    )
    returns boolean
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    declare
      v_operation text;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.operation
        into v_operation
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id;
      if not found then return false; end if;

      if v_operation in ('listing.create', 'listing.update', 'listing.stop')
         and not coalesce((
           select gate.is_open
             from sellerpilot_private.listing_mutation_release_gate gate
            where gate.singleton
         ), false) then
        return false;
      end if;

      return public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
        p_token_hash,
        p_job_id,
        p_claim_token
      );
    end;
    $function$
  $create$;
  execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) to service_role';
end;
$serverless_gate$;

create function public.sellerpilot_service_listing_mutation_release_gate_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'verified_publication_release_gate_v1',
    'open', gate.is_open,
    'state', case when gate.is_open then 'open' else 'closed' end,
    'openedAt', gate.opened_at,
    'updatedAt', gate.updated_at,
    'queuedOrRunning', (
      select count(*)::integer
        from sellerpilot_private.channel_gateway_jobs job
       where job.operation in (
         'listing.create', 'listing.update', 'listing.stop'
       )
         and job.status in ('queued', 'running')
    ),
    'reconciliationRequired', (
      select count(*)::integer
        from sellerpilot_private.channel_gateway_jobs job
       where job.operation in (
         'listing.create', 'listing.update', 'listing.stop'
       )
         and job.status = 'reconciliation_required'
    )
  )
  from sellerpilot_private.listing_mutation_release_gate gate
  where gate.singleton;
$$;

revoke all on function
  public.sellerpilot_service_listing_mutation_release_gate_status()
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_listing_mutation_release_gate_status()
  to service_role;

create function public.sellerpilot_service_set_listing_mutation_release_gate(
  p_open boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate sellerpilot_private.listing_mutation_release_gate%rowtype;
  v_queued_or_running integer;
  v_reconciliation_required integer;
begin
  if p_open is null then
    raise exception 'listing mutation release-gate state required'
      using errcode = '22004';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  select count(*) filter (
           where job.status in ('queued', 'running')
         )::integer,
         count(*) filter (
           where job.status = 'reconciliation_required'
         )::integer
    into v_queued_or_running, v_reconciliation_required
    from sellerpilot_private.channel_gateway_jobs job
   where job.operation in (
     'listing.create', 'listing.update', 'listing.stop'
   );

  if p_open and v_queued_or_running <> 0 then
    raise exception
      'listing mutation jobs must drain before release-gate activation'
      using errcode = '55000';
  end if;
  if p_open and v_reconciliation_required <> 0 then
    raise exception
      'listing mutation reconciliations must be resolved before release-gate activation'
      using errcode = '55000';
  end if;

  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = p_open,
         opened_at = case when p_open then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where gate.singleton
   returning gate.* into v_gate;

  if not found then
    raise exception 'listing mutation release-gate state missing'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'contract', 'verified_publication_release_gate_v1',
    'open', v_gate.is_open,
    'state', case when v_gate.is_open then 'open' else 'closed' end,
    'openedAt', v_gate.opened_at,
    'updatedAt', v_gate.updated_at,
    'queuedOrRunning', v_queued_or_running,
    'reconciliationRequired', v_reconciliation_required
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean)
  to service_role;

-- Both canonical enqueue functions are replaced after the gate state exists.
-- Their predecessors are not executable by any API role, so an old PostgREST
-- caller can only resolve the new fail-closed wrappers.
alter function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) rename to sellerpilot_300950_reserve_listing_before_release_gate;

revoke all on function
  public.sellerpilot_300950_reserve_listing_before_release_gate(
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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if not coalesce((
    select gate.is_open
      from sellerpilot_private.listing_mutation_release_gate gate
     where gate.singleton
  ), false) then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;

  return public.sellerpilot_300950_reserve_listing_before_release_gate(
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
end;
$$;

revoke all on function
  public.sellerpilot_service_reserve_and_enqueue_listing_create(
    uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_reserve_and_enqueue_listing_create(
    uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
  ) to service_role;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_300950_enqueue_listing_before_release_gate;

revoke all on function
  public.sellerpilot_300950_enqueue_listing_before_release_gate(
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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not coalesce((
       select gate.is_open
         from sellerpilot_private.listing_mutation_release_gate gate
        where gate.singleton
     ), false) then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;

  return public.sellerpilot_300950_enqueue_listing_before_release_gate(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ) to service_role;

comment on table sellerpilot_private.listing_mutation_release_gate is
  'Global fail-closed gate for provider listing.create/update/stop mutations.';
comment on function
  public.sellerpilot_service_set_listing_mutation_release_gate(boolean) is
  'Service-only switch for the verified publication adapter release gate.';

commit;
