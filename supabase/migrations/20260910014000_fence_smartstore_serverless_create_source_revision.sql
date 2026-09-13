-- Apply the existing SmartStore CREATE source fence to the serverless worker's
-- distinct provider-mutation RPC. The local-worker boundary was fenced by
-- 20260910010000; no job, listing, receipt, or provider row is mutated here.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- Match the gateway ledger -> SmartStore order used by the local boundary.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(193674993, 910010000);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    raise exception 'SMARTSTORE_SERVERLESS_CREATE_SOURCE_FENCE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

alter function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) rename to sp_60910014000_begin_serverless_before_smartstore;

revoke all on function
  public.sp_60910014000_begin_serverless_before_smartstore(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
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
  exact_smartstore_create boolean;
begin
  -- Keep this outer wrapper compatible with the local SmartStore fence and
  -- with the Shopee wrapper now beneath it. A single lock order prevents the
  -- two provider entry points from acquiring the same locks in reverse.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(193674993, 910010000);

  -- Deliberately identify the protected tuple by job id, not claim token.
  -- A wrong claim for an existing SmartStore CREATE must enter the predicate
  -- and fail closed rather than bypassing this wrapper as a non-SmartStore job.
  select job.channel = 'smartstore' and job.operation = 'listing.create'
    into exact_smartstore_create
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;

  if coalesce(exact_smartstore_create, false)
     and sellerpilot_private.smartstore_create_source_is_current(
       p_job_id, p_claim_token
     ) is not true then
    return false;
  end if;

  return public.sp_60910014000_begin_serverless_before_smartstore(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ) to service_role;

comment on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ) is
  'Serverless provider boundary. SmartStore listing.create must retain the immutable product, SKU, approved-detail, credential, owner and claim binding installed at enqueue; all other jobs delegate to the previously installed boundary chain.';

notify pgrst, 'reload schema';

commit;
