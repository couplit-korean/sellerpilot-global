-- Queue Shopee and Lazada calls for the allowlisted local channel worker.
-- Credential material stays in Vault and is released only to an authenticated
-- worker over the server-only claim route.

begin;

create table sellerpilot_private.channel_gateway_jobs (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  attempt_id uuid references sellerpilot_private.channel_operation_attempts(id) on delete set null,
  channel text not null check (channel in ('shopee', 'lazada')),
  operation text not null check (operation in (
    'oauth.exchange',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'shipment.acknowledge', 'shipment.confirm'
  )),
  environment text not null check (environment in ('sandbox', 'production')),
  request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object' and octet_length(request_payload::text) <= 128000),
  response_payload jsonb
    check (response_payload is null or (jsonb_typeof(response_payload) = 'object' and octet_length(response_payload::text) <= 1000000)),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  error_message text,
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  lease_expires_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index channel_gateway_jobs_queue_idx
  on sellerpilot_private.channel_gateway_jobs (created_at)
  where status = 'queued';

create index channel_gateway_jobs_attempt_idx
  on sellerpilot_private.channel_gateway_jobs (attempt_id)
  where attempt_id is not null;

alter table sellerpilot_private.channel_gateway_jobs enable row level security;
revoke all on sellerpilot_private.channel_gateway_jobs from public, anon, authenticated;

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
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee', 'lazada')
     or p_operation not in (
       'oauth.exchange',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update', 'orders.list', 'orders.get',
       'shipment.acknowledge', 'shipment.confirm'
     )
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
   order by j.created_at
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
  v_updated integer;
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

  update sellerpilot_private.channel_gateway_jobs
     set status = p_status,
         response_payload = case when p_status = 'succeeded' then p_response_payload else null end,
         error_message = case when p_status = 'failed' then left(coalesce(p_error_message, 'Channel worker failed.'), 500) else null end,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where id = p_job_id and status = 'running' and worker_token_id = v_token_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_get_channel_gateway_job(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select jsonb_build_object(
    'id', j.id,
    'credential_id', j.credential_id,
    'attempt_id', j.attempt_id,
    'channel', j.channel,
    'operation', j.operation,
    'status', j.status,
    'response', j.response_payload,
    'error', j.error_message,
    'updated_at', j.updated_at
  )
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.sellerpilot_claim_channel_gateway_job(text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_channel_gateway_job(text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_get_channel_gateway_job(uuid) from public, anon, authenticated;

grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.sellerpilot_claim_channel_gateway_job(text, text) to service_role;
grant execute on function public.sellerpilot_complete_channel_gateway_job(text, uuid, text, jsonb, text) to service_role;
grant execute on function public.sellerpilot_get_channel_gateway_job(uuid) to service_role;

commit;
