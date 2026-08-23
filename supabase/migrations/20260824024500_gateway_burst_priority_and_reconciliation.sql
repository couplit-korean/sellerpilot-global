-- Direct seller actions must not wait behind periodic reads. The gateway worker
-- can also finish after the browser request times out, so reconcile the final
-- provider result in the same transaction that completes the gateway job.

begin;
create or replace function public.sellerpilot_claim_channel_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_result jsonb;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now()
   for update;
  if v_token_id is null then raise exception 'invalid worker token' using errcode = '42501'; end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(), last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  update sellerpilot_private.channel_gateway_jobs
     set status = case when attempt_count >= 4 then 'failed' else 'queued' end,
         error_message = case when attempt_count >= 4 then 'Channel worker lease expired four times.' else error_message end,
         worker_token_id = null,
         lease_expires_at = null,
         completed_at = case when attempt_count >= 4 then now() else completed_at end,
         updated_at = now()
   where status = 'running' and lease_expires_at < now();

  select j.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs j
   where j.status = 'queued'
   order by case when j.attempt_id is null then 1 else 0 end, j.created_at
   for update skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  update sellerpilot_private.channel_gateway_jobs
     set status = 'running',
         worker_token_id = v_token_id,
         attempt_count = attempt_count + 1,
         lease_expires_at = now() + interval '3 minutes',
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_job_id;

  select jsonb_build_object(
    'id', j.id,
    'credential_id', j.credential_id,
    'channel', j.channel,
    'operation', j.operation,
    'environment', j.environment,
    'request', j.request_payload,
    'attempt_count', j.attempt_count,
    'credential', d.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where j.id = v_job_id
     and c.status = 'active';

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs
       set status = 'failed', error_message = 'Active credential could not be decrypted.',
           lease_expires_at = null, completed_at = now(), updated_at = now()
     where id = v_job_id;
  end if;
  return v_result;
end;
$$;
create or replace function public.sellerpilot_complete_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_token_id uuid;
  v_attempt_id uuid;
  v_operation text;
  v_updated integer;
  v_success boolean := false;
  v_remote_id text;
  v_public_url text;
  v_safe_message text;
  v_http_status integer;
  v_listing_id uuid;
  v_product_id uuid;
  v_owner_id uuid;
  v_channel text;
begin
  if p_status not in ('succeeded', 'failed')
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) <> 'object' or octet_length(p_response_payload::text) > 1000000
     )) then
    raise exception 'invalid channel gateway completion';
  end if;
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash and t.status = 'active' and t.expires_at > now();
  if v_token_id is null then raise exception 'invalid worker token' using errcode = '42501'; end if;

  select j.attempt_id, j.operation, j.channel
    into v_attempt_id, v_operation, v_channel
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id and j.status = 'running' and j.worker_token_id = v_token_id
   for update;
  if not found then return false; end if;

  update sellerpilot_private.channel_gateway_jobs
     set status = p_status,
         response_payload = case when p_status = 'succeeded' then p_response_payload else null end,
         error_message = case when p_status = 'failed' then left(coalesce(p_error_message, 'Channel worker failed.'), 500) else null end,
         lease_expires_at = null,
         completed_at = now(), updated_at = now()
   where id = p_job_id and status = 'running' and worker_token_id = v_token_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  if v_attempt_id is null
     or v_operation not in ('listing.create', 'listing.update', 'listing.stop')
     or p_status <> 'succeeded'
     or jsonb_typeof(p_response_payload) <> 'object' then
    return true;
  end if;

  v_success := coalesce((p_response_payload->>'ok')::boolean, false);
  v_remote_id := left(nullif(trim(p_response_payload->>'remoteId'), ''), 240);
  v_public_url := left(nullif(trim(p_response_payload->>'publicUrl'), ''), 500);
  v_safe_message := left(coalesce(nullif(trim(p_response_payload->>'safeMessage'), ''), '채널 작업 결과가 저장됐습니다.'), 1000);
  select coalesce((step->>'status')::integer, 422) into v_http_status
    from jsonb_array_elements(coalesce(p_response_payload->'steps', '[]'::jsonb)) step
   where coalesce((step->>'ok')::boolean, false) = false
   limit 1;
  v_http_status := coalesce(v_http_status, case when v_success then 200 else 422 end);

  update sellerpilot_private.channel_operation_attempts a
     set status = case when v_success then 'succeeded' else 'failed' end,
         http_status = v_http_status,
         remote_id = coalesce(v_remote_id, a.remote_id),
         safe_message = v_safe_message,
         completed_at = now()
   where a.id = v_attempt_id
     and (
       a.status = 'running'
       or (a.status = 'failed' and coalesce(a.safe_message, '') like '%응답 제한시간%')
     );

  select l.id, l.product_id, l.owner_id
    into v_listing_id, v_product_id, v_owner_id
    from sellerpilot_private.product_listings l
   where l.operation_attempt_id = v_attempt_id
   limit 1;
  if v_listing_id is null then return true; end if;

  update sellerpilot_private.product_listings l
     set status = case
       when not v_success then 'failed'
       when v_operation = 'listing.stop' then 'paused'
       else 'published'
     end,
         remote_id = coalesce(v_remote_id, l.remote_id),
         public_url = case when v_success then coalesce(v_public_url, l.public_url) else l.public_url end,
         last_error = case when v_success then null else v_safe_message end,
         failure_class = case when v_success then null else 'retryable' end,
         published_at = case
           when v_success and v_operation in ('listing.create', 'listing.update') then coalesce(l.published_at, now())
           else l.published_at
         end,
         last_verified_at = case when v_success then now() else l.last_verified_at end,
         updated_at = now()
   where l.id = v_listing_id;

  if v_success and v_operation in ('listing.create', 'listing.update') then
    update sellerpilot_private.products set status = 'active', updated_at = now() where id = v_product_id;
  end if;
  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (
    v_owner_id,
    case when v_success then 'gateway_listing_reconciled' else 'gateway_listing_failed' end,
    'product_listing',
    v_listing_id::text,
    jsonb_build_object('attempt_id', v_attempt_id, 'operation', v_operation, 'channel', v_channel, 'has_remote_id', v_remote_id is not null)
  );
  return true;
end;
$$;
-- Repair gateway jobs that completed after the original 45-second web request
-- had already marked the attempt as timed out.
with late_results as (
  select
    j.attempt_id,
    j.operation,
    coalesce((j.response_payload->>'ok')::boolean, false) as success,
    left(nullif(trim(j.response_payload->>'remoteId'), ''), 240) as remote_id,
    left(nullif(trim(j.response_payload->>'publicUrl'), ''), 500) as public_url,
    left(coalesce(nullif(trim(j.response_payload->>'safeMessage'), ''), '채널 작업 결과가 저장됐습니다.'), 1000) as safe_message
  from sellerpilot_private.channel_gateway_jobs j
  join sellerpilot_private.channel_operation_attempts a on a.id = j.attempt_id
  where j.status = 'succeeded'
    and j.attempt_id is not null
    and jsonb_typeof(j.response_payload) = 'object'
    and a.status = 'failed'
    and coalesce(a.safe_message, '') like '%응답 제한시간%'
)
update sellerpilot_private.channel_operation_attempts a
   set status = case when r.success then 'succeeded' else 'failed' end,
       http_status = case when r.success then 200 else 422 end,
       remote_id = coalesce(r.remote_id, a.remote_id),
       safe_message = r.safe_message,
       completed_at = now()
  from late_results r
 where a.id = r.attempt_id;
with late_results as (
  select
    j.attempt_id,
    j.operation,
    coalesce((j.response_payload->>'ok')::boolean, false) as success,
    left(nullif(trim(j.response_payload->>'remoteId'), ''), 240) as remote_id,
    left(nullif(trim(j.response_payload->>'publicUrl'), ''), 500) as public_url,
    left(coalesce(nullif(trim(j.response_payload->>'safeMessage'), ''), '채널 작업 결과가 저장됐습니다.'), 1000) as safe_message
  from sellerpilot_private.channel_gateway_jobs j
  where j.status = 'succeeded'
    and j.attempt_id is not null
    and jsonb_typeof(j.response_payload) = 'object'
)
update sellerpilot_private.product_listings l
   set status = case
       when not r.success then 'failed'
       when r.operation = 'listing.stop' then 'paused'
       else 'published'
     end,
       remote_id = coalesce(r.remote_id, l.remote_id),
       public_url = case when r.success then coalesce(r.public_url, l.public_url) else l.public_url end,
       last_error = case when r.success then null else r.safe_message end,
       failure_class = case when r.success then null else 'retryable' end,
       published_at = case when r.success and r.operation in ('listing.create', 'listing.update') then coalesce(l.published_at, now()) else l.published_at end,
       last_verified_at = case when r.success then now() else l.last_verified_at end,
       updated_at = now()
  from late_results r
 where l.operation_attempt_id = r.attempt_id
   and l.status = 'failed'
   and coalesce(l.last_error, '') like '%응답 제한시간%';
update sellerpilot_private.products p
   set status = 'active', updated_at = now()
 where exists (
   select 1 from sellerpilot_private.product_listings l
    where l.product_id = p.id and l.status = 'published'
 );
revoke all on function public.sellerpilot_claim_channel_gateway_job(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_channel_gateway_job(text, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_channel_gateway_job(text, text) to service_role;
grant execute on function public.sellerpilot_complete_channel_gateway_job(text, uuid, text, jsonb, text) to service_role;
commit;
