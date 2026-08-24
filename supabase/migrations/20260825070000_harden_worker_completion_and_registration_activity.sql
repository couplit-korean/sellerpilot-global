begin;

-- A completion callback must prove that the active worker token owns the
-- still-running, unexpired lease before the API performs any service-role
-- side effect. Extending the lease keeps another worker from reclaiming the
-- job while the callback stores normalized operational data.
create or replace function public.sellerpilot_service_begin_ai_job_completion(
  p_token_hash text,
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_updated integer;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return false; end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then return false; end if;

  update sellerpilot_private.ai_cli_jobs j
     set lease_expires_at = greatest(j.lease_expires_at, now() + interval '5 minutes')
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.lease_expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now()
   where id = v_token_id;
  return true;
end;
$$;

create or replace function public.sellerpilot_service_begin_channel_gateway_completion(
  p_token_hash text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_job record;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return null; end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then return null; end if;

  update sellerpilot_private.channel_gateway_jobs j
     set lease_expires_at = greatest(j.lease_expires_at, now() + interval '5 minutes')
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.lease_expires_at > now()
  returning j.id, j.credential_id, j.attempt_id, j.channel, j.operation, j.status, j.updated_at
       into v_job;
  if not found then return null; end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now()
   where id = v_token_id;

  return jsonb_build_object(
    'id', v_job.id,
    'credential_id', v_job.credential_id,
    'attempt_id', v_job.attempt_id,
    'channel', v_job.channel,
    'operation', v_job.operation,
    'status', v_job.status,
    'updated_at', v_job.updated_at
  );
end;
$$;

-- Ready means that AI analysis has finished and a human/channel selection is
-- pending. It is not an indefinitely running job. Terminal listing states are
-- also included so paused or intentionally excluded channels do not leave a
-- card spinning forever.
create or replace function public.sellerpilot_list_registration_activity(p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 300));
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return coalesce((
    with product_cards as (
      select
        'product:' || p.id::text as activity_id,
        p.id as product_id,
        p.name as product_name,
        p.external_code as product_code,
        p.sku,
        case
          when coalesce(l.running_count, 0) > 0 then 'publishing'
          when coalesce(l.blocked_count, 0) > 0 then 'blocked'
          when coalesce(l.failed_count, 0) > 0 then 'failed'
          when coalesce(l.total_count, 0) > 0 and coalesce(l.terminal_count, 0) = l.total_count then 'completed'
          when j.status in ('failed', 'cancelled') then 'failed'
          when j.status in ('queued', 'claimed', 'running') then 'analyzing'
          else 'ready'
        end as status,
        coalesce(j.created_at, l.started_at, p.created_at, p.updated_at) as started_at,
        greatest(p.updated_at, coalesce(j.updated_at, p.updated_at), coalesce(l.updated_at, p.updated_at)) as updated_at,
        case
          when coalesce(l.total_count, 0) > 0 and coalesce(l.terminal_count, 0) = l.total_count then
            greatest(
              coalesce(j.completed_at, j.updated_at, l.completed_at, l.updated_at, p.updated_at),
              coalesce(l.completed_at, l.updated_at, j.completed_at, j.updated_at, p.updated_at)
            )
          when coalesce(l.total_count, 0) = 0 and (j.status is null or j.status in ('succeeded', 'failed', 'cancelled')) then
            coalesce(j.completed_at, j.updated_at, p.updated_at)
          else null
        end as completed_at,
        coalesce(l.channels, '[]'::jsonb) as channels,
        coalesce(l.total_count, 0) as channel_count,
        coalesce(l.published_count, 0) as published_count,
        coalesce(l.failed_count, 0) as failed_count,
        coalesce(l.blocked_count, 0) as blocked_count,
        left(coalesce(l.last_message, j.error_message, ''), 1000) as message
      from sellerpilot_private.products p
      left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
      left join lateral (
        select
          count(*)::integer as total_count,
          count(*) filter (where pl.status in ('published', 'failed', 'paused', 'scope_excluded'))::integer as terminal_count,
          count(*) filter (where pl.status = 'published')::integer as published_count,
          count(*) filter (where pl.status = 'failed' and coalesce(pl.failure_class, 'retryable') <> 'external_action')::integer as failed_count,
          count(*) filter (where pl.status = 'failed' and pl.failure_class = 'external_action')::integer as blocked_count,
          count(*) filter (where pl.status in ('draft', 'queued'))::integer as running_count,
          min(coalesce(a.started_at, pl.updated_at)) as started_at,
          max(pl.updated_at) as updated_at,
          max(case when pl.status in ('published', 'failed', 'paused', 'scope_excluded') then coalesce(a.completed_at, pl.updated_at) end) as completed_at,
          (array_agg(coalesce(pl.last_error, a.safe_message) order by pl.updated_at desc)
            filter (where coalesce(pl.last_error, a.safe_message) is not null))[1] as last_message,
          jsonb_agg(jsonb_build_object(
            'channel', pl.channel_key,
            'channelCode', c.code,
            'channelName', c.name,
            'market', pl.market,
            'status', case when pl.status = 'failed' and pl.failure_class = 'external_action' then 'blocked' else pl.status end,
            'message', coalesce(pl.last_error, a.safe_message, ''),
            'updatedAt', pl.updated_at
          ) order by c.sort_order, pl.market, pl.target_id) as channels
        from sellerpilot_private.product_listings pl
        join sellerpilot_private.channels c on c.key = pl.channel_key
        left join sellerpilot_private.channel_operation_attempts a on a.id = pl.operation_attempt_id
        where pl.product_id = p.id
      ) l on true
      where p.status <> 'archived'
        and not p.demo
        and (p.ai_job_id is not null or coalesce(l.total_count, 0) > 0)
    ), orphan_jobs as (
      select
        'job:' || j.id::text as activity_id,
        null::uuid as product_id,
        left(coalesce(nullif(j.request_payload->'manual_fields'->>'productName', ''), nullif(j.request_payload->>'research_input', ''), '상품 분석'), 160) as product_name,
        'AI-' || upper(left(j.id::text, 8)) as product_code,
        coalesce(j.request_payload->'manual_fields'->>'sellerSku', '') as sku,
        case when j.status in ('queued', 'claimed', 'running') then 'analyzing' when j.status = 'succeeded' then 'ready' else 'failed' end as status,
        j.created_at as started_at,
        j.updated_at,
        case when j.status in ('succeeded', 'failed', 'cancelled') then coalesce(j.completed_at, j.updated_at) else null end as completed_at,
        '[]'::jsonb as channels,
        0 as channel_count,
        0 as published_count,
        case when j.status in ('failed', 'cancelled') then 1 else 0 end as failed_count,
        0 as blocked_count,
        left(coalesce(j.error_message, ''), 1000) as message
      from sellerpilot_private.ai_cli_jobs j
      where j.kind in ('product_studio', 'product_research')
        and not exists(select 1 from sellerpilot_private.products p where p.ai_job_id = j.id)
    ), cards as (
      select * from product_cards
      union all
      select * from orphan_jobs
    )
    select jsonb_agg(jsonb_build_object(
      'id', activity_id,
      'productId', product_id,
      'productName', product_name,
      'productCode', product_code,
      'sku', sku,
      'status', status,
      'startedAt', started_at,
      'updatedAt', updated_at,
      'completedAt', completed_at,
      'elapsedSeconds', greatest(0, extract(epoch from (coalesce(completed_at, now()) - started_at))::bigint),
      'channelCount', channel_count,
      'publishedCount', published_count,
      'failedCount', failed_count,
      'blockedCount', blocked_count,
      'channels', channels,
      'message', message
    ) order by updated_at desc)
    from (select * from cards order by updated_at desc limit v_limit) limited
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sellerpilot_service_begin_ai_job_completion(text, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_channel_gateway_completion(text, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_list_registration_activity(integer)
  from public, anon;

grant execute on function public.sellerpilot_service_begin_ai_job_completion(text, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_begin_channel_gateway_completion(text, uuid)
  to service_role;
grant execute on function public.sellerpilot_list_registration_activity(integer)
  to authenticated;

commit;
