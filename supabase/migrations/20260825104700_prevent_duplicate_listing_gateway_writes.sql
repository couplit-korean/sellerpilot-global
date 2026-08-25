-- Bind marketplace listing writes to one active gateway job. A browser timeout
-- is not a provider failure: the bound attempt remains running so the worker's
-- late completion can reconcile the same listing without a second remote call.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists listing_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_listing_fkey'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_listing_fkey
      foreign key (listing_id)
      references sellerpilot_private.product_listings(id)
      on delete restrict;
  end if;

  -- Legacy listing jobs do not identify their product-listing row. Applying
  -- the write fence while one is active or awaiting reconciliation would let a new listing-aware
  -- job race it, so fail closed until the worker has drained them.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation in ('listing.create', 'listing.update', 'listing.stop')
       and j.status in ('queued', 'running', 'reconciliation_required')
       and j.listing_id is null
  ) then
    raise exception 'legacy gateway listing jobs must drain before write-fence rollout';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.attempt_id is not null
       and j.status in ('queued', 'running', 'reconciliation_required')
     group by j.attempt_id
    having count(*) > 1
  ) then
    raise exception 'duplicate active gateway attempts must drain before write-fence rollout';
  end if;
end $$;

create unique index if not exists channel_gateway_jobs_one_active_per_listing_idx
  on sellerpilot_private.channel_gateway_jobs (listing_id)
  where listing_id is not null
    and status in ('queued', 'running', 'reconciliation_required')
    and operation in ('listing.create', 'listing.update', 'listing.stop');

create unique index if not exists channel_gateway_jobs_one_active_per_attempt_idx
  on sellerpilot_private.channel_gateway_jobs (attempt_id)
  where attempt_id is not null and status in ('queued', 'running', 'reconciliation_required');

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
  v_job_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
  v_attempt_owner_id uuid;
  v_listing record;
  v_existing_job_id uuid;
  v_existing_attempt_id uuid;
  v_existing_status text;
  v_existing_error text;
begin
  if p_listing_id is null
     or p_credential_id is null
     or p_attempt_id is null
     or p_channel not in ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu')
     or p_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid listing gateway job';
  end if;

  -- Every listing-aware enqueue takes this row lock first. This is the
  -- serialization point across different idempotency keys and attempts.
  select l.id,
         l.owner_id,
         l.channel_key,
         l.operation_attempt_id,
         l.remote_id,
         l.status
    into v_listing
    from sellerpilot_private.product_listings l
   where l.id = p_listing_id
     and l.channel_key = p_channel
   for update;
  if not found then raise exception 'product listing not found'; end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  select a.owner_id
    into v_attempt_owner_id
    from sellerpilot_private.channel_operation_attempts a
   where a.id = p_attempt_id
     and a.credential_id = p_credential_id
     and a.channel = p_channel
     and a.operation = p_operation
     and a.status = 'running'
   for update;
  if not found
     or not exists (
       select 1 from sellerpilot_private.admin_users a where a.user_id = v_attempt_owner_id
     )
     or not exists (
       select 1 from sellerpilot_private.admin_users a where a.user_id = v_listing.owner_id
     ) then
    raise exception 'running listing operation required';
  end if;

  select j.id, j.attempt_id, j.status, j.error_message
    into v_existing_job_id, v_existing_attempt_id, v_existing_status, v_existing_error
    from sellerpilot_private.channel_gateway_jobs j
   where j.status in ('queued', 'running', 'reconciliation_required')
     and j.operation in ('listing.create', 'listing.update', 'listing.stop')
     and (
       j.listing_id = p_listing_id
       or (
         v_listing.operation_attempt_id is not null
         and j.attempt_id = v_listing.operation_attempt_id
       )
     )
   order by case when j.status = 'running' then 0 else 1 end, j.created_at, j.id
   for update
   limit 1;

  if v_existing_job_id is not null then
    if v_existing_status = 'reconciliation_required' then
      update sellerpilot_private.product_listings l
         set status = 'failed',
             operation_attempt_id = v_existing_attempt_id,
             failure_class = 'external_action',
             last_error = coalesce(
               nullif(trim(v_existing_error), ''),
               '판매채널 작업 결과를 확정할 수 없어 수동 확인이 필요합니다.'
             ),
             updated_at = now()
       where l.id = p_listing_id;

      update sellerpilot_private.channel_operation_attempts a
         set status = 'manual_required',
             http_status = 409,
             safe_message = '판매채널 작업 결과를 확정할 수 없어 수동 확인이 필요합니다.',
             completed_at = coalesce(a.completed_at, now())
       where a.id = p_attempt_id
         and a.status = 'running';

      return jsonb_build_object(
        'status', 'reconciliation_required',
        'job_id', v_existing_job_id,
        'attempt_id', v_existing_attempt_id,
        'conflict_attempt_id', case when v_existing_attempt_id <> p_attempt_id then p_attempt_id else null end,
        'reused', true
      );
    end if;

    if v_existing_attempt_id = p_attempt_id then
      return jsonb_build_object(
        'status', 'queued',
        'job_id', v_existing_job_id,
        'attempt_id', v_existing_attempt_id,
        'reused', true
      );
    end if;

    -- This conflicting attempt never reached the provider: the listing row
    -- lock found an older active gateway job before inserting a new job. Close
    -- it as a safe conflict, not as a manual provider-reconciliation outcome.
    update sellerpilot_private.channel_operation_attempts a
       set status = 'failed',
           http_status = 409,
           safe_message = '동일 상품·채널 원격 작업이 이미 진행 중이어서 새 원격 호출을 실행하지 않았습니다.',
           completed_at = now()
     where a.id = p_attempt_id
       and a.status = 'running';

    return jsonb_build_object(
      'status', 'in_progress',
      'job_id', v_existing_job_id,
      'attempt_id', v_existing_attempt_id,
      'conflict_attempt_id', p_attempt_id,
      'reused', true
    );
  end if;

  -- Check the unresolved-job fence before validating the requested operation
  -- against the listing's current remote identity. A verified create can leave
  -- both remote_id and an active reconciliation job; rejecting it here would
  -- let the route's legacy failure completion overwrite external_action.
  if p_operation = 'listing.create'
     and nullif(trim(coalesce(v_listing.remote_id, '')), '') is not null then
    raise exception 'remote listing already exists';
  end if;
  if p_operation in ('listing.update', 'listing.stop')
     and nullif(trim(coalesce(v_listing.remote_id, '')), '') is null then
    raise exception 'remote listing required';
  end if;

  update sellerpilot_private.product_listings l
     set operation_attempt_id = p_attempt_id,
         status = case
           when p_operation = 'listing.stop' then l.status
           else 'queued'
         end,
         last_error = null,
         failure_class = null,
         updated_at = now()
   where l.id = p_listing_id;

  insert into sellerpilot_private.channel_gateway_jobs (
    id,
    credential_id,
    attempt_id,
    listing_id,
    channel,
    operation,
    environment,
    request_payload,
    created_by
  ) values (
    v_job_id,
    p_credential_id,
    p_attempt_id,
    p_listing_id,
    p_channel,
    p_operation,
    v_environment,
    p_request_payload,
    v_created_by
  );

  return jsonb_build_object(
    'status', 'queued',
    'job_id', v_job_id,
    'attempt_id', p_attempt_id,
    'reused', false
  );
end;
$$;

-- Keep the legacy/general enqueue available for read, sync, and diagnostics.
-- Every listing write must carry listing_id and
-- therefore cannot bypass the atomic listing write fence.
create or replace function public.sellerpilot_enqueue_channel_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'temu')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop', 'price.update', 'inventory.update',
       'orders.list', 'orders.get', 'inquiries.list', 'shipment.acknowledge', 'shipment.confirm'
     )
     or p_operation in ('listing.create', 'listing.update', 'listing.stop')
     or (p_channel in ('coupang', 'smartstore', 'temu') and p_operation in ('oauth.exchange', 'shops.get'))
     or (p_operation = 'competitor.search' and (p_channel <> 'elevenst' or p_attempt_id is not null))
     or (p_channel = 'elevenst' and p_operation not in (
       'diagnostic.test', 'competitor.search', 'categories.list', 'categories.suggest', 'categories.attributes',
       'categories.validate', 'listing.create', 'listing.stop', 'orders.list'
     ))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_attempt_id is not null and not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.credential_id = p_credential_id
       and a.channel = p_channel
       and a.operation = p_operation
       and a.status = 'running'
  ) then
    raise exception 'running channel operation required';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment, request_payload, created_by
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment, p_request_payload, v_created_by
  );
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(uuid, uuid, uuid, text, text, jsonb)
  to service_role;
revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb)
  to service_role;

commit;
