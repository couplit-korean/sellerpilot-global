-- Forward-only repair for the provider-mutation delegate chain installed by
-- 20260831050000. The public Qoo10-aware wrapper and the 20260831033000 CS
-- ownership/inbound-generation fence stay in place. Only the renamed
-- 20260830110000 delegates are rebound so their nested release decision uses
-- the concrete job channel instead of reinterpreting a Qoo10-only opening as
-- the seven-channel global gate.

begin;

do $chain_preflight$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if coalesce((
    select gate.is_open
      from sellerpilot_private.listing_mutation_release_gate gate
     where gate.singleton
  ), true) then
    raise exception 'Qoo10 provider-mutation chain repair requires a closed gate'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
   where job.operation in ('listing.create', 'listing.update', 'listing.stop')
       and job.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'listing mutation jobs must be terminal before chain repair'
      using errcode = '55000';
  end if;
  if to_regprocedure(
    'public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)'
  ) is null
     or to_regprocedure(
       'public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(text,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate(text,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'sellerpilot_private.listing_mutation_release_gate_is_effective(text)'
     ) is null
  then
    raise exception 'Qoo10 provider-mutation predecessor chain is missing'
      using errcode = '55000';
  end if;
end;
$chain_preflight$;

create or replace function
  public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(
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
  v_channel text;
  v_operation text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.channel, job.operation
    into v_channel, v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;
  if v_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       v_channel
     )
  then
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
  public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

-- The serverless worker is optional in reduced deployments. When its exact
-- predecessor chain exists, make the same narrow repair without creating a
-- second provider-write entry point.
do $serverless_chain_rebind$
declare
  v_outer_exists boolean := to_regprocedure(
    'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
  ) is not null;
  v_delegate_exists boolean := to_regprocedure(
    'public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(text,uuid,uuid)'
  ) is not null;
  v_inner_exists boolean := to_regprocedure(
    'public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)'
  ) is not null;
begin
  if v_outer_exists is distinct from v_inner_exists
     or v_outer_exists is distinct from v_delegate_exists
  then
    raise exception 'Qoo10 serverless provider-mutation chain drift detected'
      using errcode = '55000';
  end if;
  if not v_inner_exists then
    return;
  end if;
  if to_regprocedure(
    'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'
  ) is null then
    raise exception 'Qoo10 serverless provider-mutation predecessor is missing'
      using errcode = '55000';
  end if;
  execute $create$
    create or replace function
      public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(
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
      v_channel text;
      v_operation text;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.channel, job.operation
        into v_channel, v_operation
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id;
      if not found then return false; end if;
      if v_operation in ('listing.create', 'listing.update', 'listing.stop')
         and not sellerpilot_private.listing_mutation_release_gate_is_effective(
           v_channel
         )
      then
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
  execute 'revoke all on function public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid) from public,anon,authenticated,service_role';
end;
$serverless_chain_rebind$;

comment on function
  public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(
    text, uuid, uuid
  ) is
  'Internal 301100 delegate rebound after 310500: channel-aware listing gate, then the original provider-mutation marker.';

commit;
