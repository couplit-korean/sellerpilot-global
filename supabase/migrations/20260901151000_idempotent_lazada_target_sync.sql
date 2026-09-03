-- One UI cache miss must converge on one active Malaysia seller discovery job.
-- The provider operation is read-only, but it may refresh an expiring OAuth
-- token, so duplicate browser retries must not create parallel refresh work.

begin;

with ranked as materialized (
  select
    job.id,
    job.status,
    row_number() over (
      partition by job.credential_id, lower(trim(job.request_payload->>'country'))
      order by
        case when job.status = 'running' then 0 else 1 end,
        job.created_at,
        job.id
    ) as duplicate_rank
  from sellerpilot_private.channel_gateway_jobs job
  where job.channel = 'lazada'
    and job.operation = 'shops.get'
    and job.attempt_id is null
    and job.status in ('queued', 'running')
    and lower(trim(job.request_payload->>'country')) = 'my'
)
update sellerpilot_private.channel_gateway_jobs job
   set status = 'cancelled',
       completed_at = clock_timestamp(),
       updated_at = clock_timestamp(),
       error_message = 'DUPLICATE_LAZADA_TARGET_SYNC_COMPACTED'
  from ranked
 where ranked.id = job.id
   and ranked.duplicate_rank > 1
   and ranked.status = 'queued';

create unique index if not exists channel_gateway_jobs_one_active_lazada_target_sync_idx
  on sellerpilot_private.channel_gateway_jobs (
    credential_id,
    (lower(trim(request_payload->>'country')))
  )
  where channel = 'lazada'
    and operation = 'shops.get'
    and attempt_id is null
    and status in ('queued', 'running')
    and lower(trim(request_payload->>'country')) = 'my';

create or replace function public.sellerpilot_enqueue_lazada_target_sync(
  p_credential_id uuid,
  p_country text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := lower(trim(coalesce(p_country, '')));
  v_existing_id uuid;
begin
  if p_credential_id is null or v_country <> 'my' then
    raise exception 'invalid Lazada target sync';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'sellerpilot:lazada:target-sync:' || p_credential_id::text || ':' || v_country
    )
  );

  select job.id
    into v_existing_id
    from sellerpilot_private.channel_gateway_jobs job
   where job.credential_id = p_credential_id
     and job.channel = 'lazada'
     and job.operation = 'shops.get'
     and job.attempt_id is null
     and job.status in ('queued', 'running', 'reconciliation_required')
     and job.request_payload = pg_catalog.jsonb_build_object('country', v_country)
   order by
     case job.status
       when 'reconciliation_required' then 0
       when 'running' then 1
       else 2
     end,
     job.created_at,
     job.id
   limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  return public.sellerpilot_enqueue_channel_gateway_job(
    p_credential_id,
    null,
    'lazada',
    'shops.get',
    pg_catalog.jsonb_build_object('country', v_country)
  );
end;
$$;

revoke all on function public.sellerpilot_enqueue_lazada_target_sync(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_lazada_target_sync(uuid, text)
  to service_role;

commit;
