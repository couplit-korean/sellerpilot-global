-- Keep a provider-success completion retry from rotating the same OAuth
-- credential more than once. The job stores only a request fingerprint and
-- the resulting credential id; secret material remains in Vault.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists credential_refresh_fingerprint text,
  add column if not exists prepared_credential_id uuid,
  add column if not exists credential_refresh_prepared_at timestamptz,
  add column if not exists credential_refresh_recovery_vault_id uuid,
  add column if not exists credential_refresh_recovery_fingerprint text,
  add column if not exists credential_refresh_recovery_staged_at timestamptz,
  add column if not exists credential_refresh_in_flight boolean not null default false,
  add column if not exists credential_refresh_started_at timestamptz,
  add column if not exists oauth_request_vault_id uuid,
  add column if not exists oauth_request_fingerprint text,
  add column if not exists oauth_source_credential_id uuid,
  add column if not exists oauth_exchange_completed boolean not null default false,
  add column if not exists claim_token uuid;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_status_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')
  );

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_prepared_credential_fkey'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_prepared_credential_fkey
      foreign key (prepared_credential_id)
      references sellerpilot_private.channel_credentials(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_credential_refresh_state_check'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_credential_refresh_state_check check (
        (
          prepared_credential_id is null
          and credential_refresh_fingerprint is null
          and credential_refresh_prepared_at is null
        ) or (
          prepared_credential_id is not null
          and credential_refresh_fingerprint ~ '^[a-f0-9]{64}$'
          and credential_refresh_prepared_at is not null
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_credential_recovery_state_check'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_credential_recovery_state_check check (
        (
          credential_refresh_recovery_vault_id is null
          and credential_refresh_recovery_fingerprint is null
          and credential_refresh_recovery_staged_at is null
        ) or (
          credential_refresh_recovery_vault_id is not null
          and credential_refresh_recovery_fingerprint ~ '^[a-f0-9]{64}$'
          and credential_refresh_recovery_staged_at is not null
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_credential_refresh_flight_check'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_credential_refresh_flight_check check (
        credential_refresh_in_flight = (credential_refresh_started_at is not null)
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_oauth_completion_state_check'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_oauth_completion_state_check check (
        not oauth_exchange_completed or (
          operation = 'oauth.exchange'
          and prepared_credential_id is not null
          and credential_refresh_in_flight = false
          and credential_refresh_recovery_vault_id is null
        )
      );
  end if;

end $$;

-- Expired leases are safe to recover. A live provider call is not: if the
-- rollout finds either two live jobs for one logical credential or even one
-- live job on an inactive credential, abort the migration so operators can
-- stop the worker and drain those leases first.
with expired as (
  update sellerpilot_private.channel_gateway_jobs j
     set status = case
           when j.oauth_exchange_completed and not j.credential_refresh_in_flight then 'succeeded'
           when j.credential_refresh_in_flight
             or (
               j.operation = 'oauth.exchange'
               and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null)
             )
             or j.operation in (
             'listing.create', 'listing.update', 'listing.stop',
             'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
           ) then 'reconciliation_required'
           when j.attempt_count >= 4 then 'failed'
           else 'queued'
         end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = case
           when j.oauth_exchange_completed
             or j.credential_refresh_in_flight
             or (
               j.operation = 'oauth.exchange'
               and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null)
             )
             or j.operation in (
             'listing.create', 'listing.update', 'listing.stop',
             'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
           ) or j.attempt_count >= 4 then now()
           else null
         end,
         error_message = case
           when j.oauth_exchange_completed and not j.credential_refresh_in_flight then null
           when j.credential_refresh_in_flight then
             'Gateway credential refresh outcome requires reconciliation.'
           when j.operation = 'oauth.exchange'
             and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null) then
             'Gateway OAuth exchange was only partially staged; provider outcome requires reconciliation.'
           when j.operation in (
             'listing.create', 'listing.update', 'listing.stop',
             'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
           ) then 'Gateway write lease expired; provider outcome requires reconciliation.'
           when j.attempt_count >= 4 then 'Channel worker lease expired four times.'
           else j.error_message
         end,
         response_payload = case
           when j.oauth_exchange_completed and not j.credential_refresh_in_flight then
             jsonb_build_object(
               'ok', true,
               'channel', j.channel,
               'operation', 'oauth.exchange',
               'safeMessage', 'OAuth credential was durably staged before worker completion was interrupted.'
             )
           else j.response_payload
         end,
         updated_at = now()
   where j.status = 'running'
     and (j.lease_expires_at is null or j.lease_expires_at <= now())
  returning j.attempt_id, j.operation
), reconciled_attempts as (
  update sellerpilot_private.channel_operation_attempts a
     set status = 'manual_required',
         http_status = 409,
         safe_message = 'Gateway write lease expired; provider outcome requires reconciliation.',
         completed_at = now()
    from expired e
   where e.attempt_id = a.id
     and e.operation in (
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
     )
     and a.status in ('running', 'failed', 'manual_required')
  returning a.id
)
update sellerpilot_private.product_listings l
   set status = 'failed',
       last_error = 'Gateway write lease expired; provider outcome requires reconciliation.',
       failure_class = 'external_action',
       updated_at = now()
  from expired e
 where e.attempt_id = l.operation_attempt_id
   and e.operation in ('listing.create', 'listing.update', 'listing.stop');

do $$
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.status = 'running'
  ) then
    raise exception 'live gateway jobs must drain before claim nonce rollout';
  end if;
end $$;

-- OAuth authorization codes are bearer secrets and must never remain in the
-- ordinary job payload. Preserve only retryable queued grants in Vault; all
-- terminal grants are already consumed or invalid and are scrubbed outright.
do $$
declare
  v_job record;
  v_vault_id uuid;
begin
  for v_job in
    select j.id, j.channel, j.request_payload
      from sellerpilot_private.channel_gateway_jobs j
     where j.operation = 'oauth.exchange'
       and j.status = 'queued'
       and j.oauth_request_vault_id is null
     for update
  loop
    if jsonb_typeof(v_job.request_payload) <> 'object'
       or nullif(trim(v_job.request_payload->>'code'), '') is null then
      update sellerpilot_private.channel_gateway_jobs
         set status = 'failed',
             request_payload = '{}'::jsonb,
             error_message = 'Queued OAuth grant was missing its authorization code.',
             completed_at = now(),
             updated_at = now()
       where id = v_job.id;
      continue;
    end if;

    select vault.create_secret(
      v_job.request_payload::text,
      format('sellerpilot_gateway_oauth_%s_%s', v_job.id, gen_random_uuid()),
      'SellerPilot claim-bound OAuth request. Never expose outside the gateway worker.'
    ) into v_vault_id;

    update sellerpilot_private.channel_gateway_jobs
       set request_payload = jsonb_build_object('vaultBacked', true),
           oauth_request_vault_id = v_vault_id,
           oauth_source_credential_id = credential_id,
           oauth_request_fingerprint = encode(
             extensions.digest(
               jsonb_build_object(
                 'channel', v_job.channel,
                 'code', trim(v_job.request_payload->>'code')
               )::text,
               'sha256'
             ),
             'hex'
           ),
           updated_at = now()
     where id = v_job.id;
  end loop;

  delete from vault.secrets s
   using sellerpilot_private.channel_gateway_jobs j
   where s.id = j.oauth_request_vault_id
     and j.operation = 'oauth.exchange'
     and j.status not in ('queued', 'running')
     and j.oauth_request_vault_id is not null;

  update sellerpilot_private.channel_gateway_jobs
     set request_payload = request_payload - 'code',
         oauth_request_vault_id = null,
         oauth_source_credential_id = coalesce(oauth_source_credential_id, credential_id),
         oauth_request_fingerprint = coalesce(
           oauth_request_fingerprint,
           encode(extensions.digest(
             jsonb_build_object(
               'channel', channel,
               'code', coalesce(
                 nullif(trim(request_payload->>'code'), ''),
                 format('legacy-terminal:%s', id)
               )
             )::text,
             'sha256'
           ), 'hex')
         ),
         updated_at = now()
   where operation = 'oauth.exchange'
     and status not in ('queued', 'running')
     and (
       request_payload ? 'code'
       or oauth_request_fingerprint is null
       or oauth_source_credential_id is null
       or oauth_request_vault_id is not null
     );

  -- Collapse historical duplicate callback deliveries before installing the
  -- immutable replay key. Keep the strongest/oldest ledger row authoritative
  -- and terminalize every duplicate without retaining its grant secret.
  for v_job in
    select ranked.id, ranked.oauth_request_vault_id, ranked.oauth_request_fingerprint
      from (
        select j.id,
               j.oauth_request_vault_id,
               j.oauth_request_fingerprint,
               row_number() over (
                 partition by j.oauth_source_credential_id, j.oauth_request_fingerprint
                 order by case j.status
                   when 'succeeded' then 0
                   when 'reconciliation_required' then 1
                   when 'running' then 2
                   when 'queued' then 3
                   when 'failed' then 4
                   else 5
                 end,
                 j.created_at,
                 j.id
               ) as replay_rank
          from sellerpilot_private.channel_gateway_jobs j
         where j.operation = 'oauth.exchange'
      ) ranked
    where ranked.replay_rank > 1
  loop
    if v_job.oauth_request_vault_id is not null then
      delete from vault.secrets where id = v_job.oauth_request_vault_id;
    end if;
    update sellerpilot_private.channel_gateway_jobs
       set status = case when status in ('queued', 'running') then 'failed' else status end,
           request_payload = jsonb_build_object('vaultBacked', true),
           oauth_request_vault_id = null,
           oauth_request_fingerprint = encode(extensions.digest(
             format('%s:duplicate:%s', v_job.oauth_request_fingerprint, v_job.id),
             'sha256'
           ), 'hex'),
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           error_message = case
             when status in ('queued', 'running') then 'Duplicate OAuth callback was superseded by its authoritative ledger job.'
             else error_message
           end,
           completed_at = case when status in ('queued', 'running') then now() else completed_at end,
           updated_at = now()
     where id = v_job.id;
  end loop;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_oauth_request_state_check'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_oauth_request_state_check check (
        (
          operation <> 'oauth.exchange'
          and oauth_request_vault_id is null
          and oauth_request_fingerprint is null
          and oauth_source_credential_id is null
        ) or (
          operation = 'oauth.exchange'
          and oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
          and oauth_source_credential_id is not null
          and (
            status not in ('queued', 'running')
            or oauth_request_vault_id is not null
          )
        )
      ) not valid;
  end if;

  alter table sellerpilot_private.channel_gateway_jobs
    validate constraint channel_gateway_jobs_oauth_request_state_check;
end $$;

create unique index if not exists channel_gateway_jobs_oauth_grant_replay_idx
  on sellerpilot_private.channel_gateway_jobs (
    oauth_source_credential_id,
    oauth_request_fingerprint
  )
  where operation = 'oauth.exchange';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'channel_gateway_jobs_running_claim_token_check'
       and conrelid = 'sellerpilot_private.channel_gateway_jobs'::regclass
  ) then
    alter table sellerpilot_private.channel_gateway_jobs
      add constraint channel_gateway_jobs_running_claim_token_check
      check (status <> 'running' or claim_token is not null);
  end if;
end $$;

-- Move only queued work to the active credential. attempt_id deliberately
-- remains unchanged so its audit row identifies the original provider call.
update sellerpilot_private.channel_gateway_jobs j
   set credential_id = active_c.id,
       updated_at = now()
  from sellerpilot_private.channel_credentials old_c,
       sellerpilot_private.channel_credentials active_c
 where j.credential_id = old_c.id
   and j.status = 'queued'
   and old_c.status <> 'active'
   and active_c.channel = old_c.channel
   and active_c.environment = old_c.environment
   and active_c.status = 'active'
   and active_c.id <> old_c.id;

create unique index if not exists channel_gateway_jobs_one_running_per_credential_idx
  on sellerpilot_private.channel_gateway_jobs (credential_id)
  where status = 'running';

create or replace function public.sellerpilot_claim_channel_gateway_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  with expired as (
    update sellerpilot_private.channel_gateway_jobs j
       set status = case
             when j.oauth_exchange_completed and not j.credential_refresh_in_flight then 'succeeded'
             when j.credential_refresh_in_flight
               or (
                 j.operation = 'oauth.exchange'
                 and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null)
               )
               or j.operation in (
               'listing.create', 'listing.update', 'listing.stop',
               'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
             ) then 'reconciliation_required'
             when j.attempt_count >= 4 then 'failed'
             else 'queued'
           end,
           error_message = case
             when j.oauth_exchange_completed and not j.credential_refresh_in_flight then null
             when j.credential_refresh_in_flight then
               'Gateway credential refresh outcome requires reconciliation.'
             when j.operation = 'oauth.exchange'
               and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null) then
               'Gateway OAuth exchange was only partially staged; provider outcome requires reconciliation.'
             when j.operation in (
               'listing.create', 'listing.update', 'listing.stop',
               'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
             ) then 'Gateway write lease expired; provider outcome requires reconciliation.'
             when j.attempt_count >= 4 then 'Channel worker lease expired four times.'
             else j.error_message
           end,
           response_payload = case
             when j.oauth_exchange_completed and not j.credential_refresh_in_flight then
               jsonb_build_object(
                 'ok', true,
                 'channel', j.channel,
                 'operation', 'oauth.exchange',
                 'safeMessage', 'OAuth credential was durably staged before worker completion was interrupted.'
               )
             else j.response_payload
           end,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = case
             when j.oauth_exchange_completed
               or j.credential_refresh_in_flight
               or (
                 j.operation = 'oauth.exchange'
                 and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null)
               )
               or j.operation in (
               'listing.create', 'listing.update', 'listing.stop',
               'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
             ) or j.attempt_count >= 4 then now()
             else j.completed_at
           end,
           updated_at = now()
     where j.status = 'running'
       and (j.lease_expires_at is null or j.lease_expires_at < now())
    returning j.attempt_id, j.operation
  ), reconciled_attempts as (
    update sellerpilot_private.channel_operation_attempts a
       set status = 'manual_required',
           http_status = 409,
           safe_message = 'Gateway write lease expired; provider outcome requires reconciliation.',
           completed_at = now()
      from expired e
     where e.attempt_id = a.id
       and e.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
       )
       and a.status in ('running', 'failed', 'manual_required')
    returning a.id
  )
  update sellerpilot_private.product_listings l
     set status = 'failed',
         last_error = 'Gateway write lease expired; provider outcome requires reconciliation.',
         failure_class = 'external_action',
         updated_at = now()
    from expired e
   where e.attempt_id = l.operation_attempt_id
     and e.operation in ('listing.create', 'listing.update', 'listing.stop');

  -- A terminal OAuth grant has either been consumed or made unsafe by an
  -- uncertain provider call. Remove its encrypted request as part of the same
  -- claim transaction before any unrelated work can start.
  delete from vault.secrets s
   using sellerpilot_private.channel_gateway_jobs j
   where s.id = j.oauth_request_vault_id
     and j.operation = 'oauth.exchange'
     and j.status in ('succeeded', 'failed', 'cancelled', 'reconciliation_required')
     and j.oauth_request_vault_id is not null;

  update sellerpilot_private.channel_gateway_jobs j
     set oauth_request_vault_id = null,
         updated_at = now()
   where j.operation = 'oauth.exchange'
     and j.status in ('succeeded', 'failed', 'cancelled', 'reconciliation_required')
     and j.oauth_request_vault_id is not null;

  -- A lease may expire after a credential was rotated. Repoint only after the
  -- job is queued; a still-live provider call keeps its original credential.
  update sellerpilot_private.channel_gateway_jobs j
     set credential_id = active_c.id,
         updated_at = now()
    from sellerpilot_private.channel_credentials old_c,
         sellerpilot_private.channel_credentials active_c
   where j.credential_id = old_c.id
     and j.status = 'queued'
     and old_c.status <> 'active'
     and active_c.channel = old_c.channel
     and active_c.environment = old_c.environment
     and active_c.status = 'active'
     and active_c.id <> old_c.id;

  -- Lock the credential row with the job row. Concurrent claims skip every
  -- other queued job for that credential, while unrelated credentials remain
  -- independently claimable.
  select j.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c
      on c.id = j.credential_id
     and c.status = 'active'
   where j.status = 'queued'
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running
         join sellerpilot_private.channel_credentials running_c
           on running_c.id = running.credential_id
        where running_c.channel = c.channel
          and running_c.environment = c.environment
          and running.status = 'running'
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs unresolved
         join sellerpilot_private.channel_credentials unresolved_c
           on unresolved_c.id = unresolved.credential_id
        where unresolved_c.channel = c.channel
          and unresolved_c.environment = c.environment
          and unresolved.status = 'reconciliation_required'
          and (
            unresolved.credential_refresh_in_flight
            or unresolved.credential_refresh_recovery_vault_id is not null
            or (
              unresolved.operation = 'oauth.exchange'
              and unresolved.prepared_credential_id is not null
              and not unresolved.oauth_exchange_completed
            )
          )
     )
   order by
     case when j.prepared_credential_id is null then 1 else 0 end,
     case when j.attempt_id is null then 1 else 0 end,
     j.created_at,
     j.id
   for update of j, c skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();

  update sellerpilot_private.channel_gateway_jobs j
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = j.attempt_count + 1,
         lease_expires_at = now() + interval '15 minutes',
         started_at = coalesce(j.started_at, now()),
         error_message = null,
         updated_at = now()
   where j.id = v_job_id;

  select jsonb_build_object(
    'id', j.id,
    'claim_token', j.claim_token,
    'credential_id', j.credential_id,
    'channel', j.channel,
    'operation', j.operation,
    'environment', j.environment,
    'request', case
      when j.operation = 'oauth.exchange' then oauth_d.decrypted_secret::jsonb
      else j.request_payload
    end,
    'attempt_count', j.attempt_count,
    'credential', d.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
    left join vault.decrypted_secrets oauth_d on oauth_d.id = j.oauth_request_vault_id
   where j.id = v_job_id
     and c.status = 'active'
     and (j.operation <> 'oauth.exchange' or oauth_d.decrypted_secret is not null);

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs j
       set status = 'failed',
           error_message = 'Active credential could not be decrypted.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = now(),
           updated_at = now()
     where j.id = v_job_id;

    update sellerpilot_private.channel_operation_attempts a
       set status = 'failed',
           http_status = 422,
           safe_message = 'Active credential could not be decrypted.',
           completed_at = now()
      from sellerpilot_private.channel_gateway_jobs j
     where j.id = v_job_id
       and j.operation in ('listing.create', 'listing.update', 'listing.stop')
       and a.id = j.attempt_id
       and a.status in ('running', 'failed');

    update sellerpilot_private.product_listings l
       set status = 'failed',
           last_error = 'Active credential could not be decrypted.',
           failure_class = 'retryable',
           updated_at = now()
      from sellerpilot_private.channel_gateway_jobs j
     where j.id = v_job_id
       and j.operation in ('listing.create', 'listing.update', 'listing.stop')
       and l.operation_attempt_id = j.attempt_id;

    delete from vault.secrets s
     using sellerpilot_private.channel_gateway_jobs j
     where s.id = j.oauth_request_vault_id
       and j.id = v_job_id
       and j.oauth_request_vault_id is not null;
    update sellerpilot_private.channel_gateway_jobs
       set oauth_request_vault_id = null,
           updated_at = now()
     where id = v_job_id;
  end if;
  return v_result;
end;
$$;

drop function if exists public.sellerpilot_touch_channel_gateway_job(text, uuid, text);

create function public.sellerpilot_touch_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_worker_version text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_status text;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  -- Never revive an expired lease. Once ownership is lost, only the claim
  -- path may recover the job and assign a fresh lease to a worker.
  update sellerpilot_private.channel_gateway_jobs j
     set lease_expires_at = now() + interval '15 minutes',
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now()
  returning j.status into v_status;
  if found then return v_status; end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
     where j.id = p_job_id
  ) then
    return 'ownership_lost';
  end if;
  return null;
end;
$$;

drop function if exists public.sellerpilot_service_begin_channel_gateway_completion(text, uuid);

create function public.sellerpilot_service_begin_channel_gateway_completion(
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
  v_token_id uuid;
  v_job record;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null then
    return null;
  end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then return null; end if;

  update sellerpilot_private.channel_gateway_jobs j
     set lease_expires_at = greatest(j.lease_expires_at, now() + interval '5 minutes'),
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
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

create or replace function sellerpilot_private.gateway_external_write_observed(
  p_operation text,
  p_response_payload jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_response_payload->>'ok')::boolean, false) = false
     and p_operation in (
       'listing.create', 'listing.update', 'listing.stop', 'price.update',
       'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
     )
     and exists (
       select 1
         from jsonb_array_elements(
           case
             when jsonb_typeof(p_response_payload->'steps') = 'array' then p_response_payload->'steps'
             else '[]'::jsonb
           end
         ) step
        where (
          coalesce((step->>'ok')::boolean, false) = true
          or (
            coalesce(step->>'status', '') ~ '^[0-9]{3}$'
            and (
              (step->>'status')::integer = 408
              or (step->>'status')::integer between 500 and 599
            )
          )
        )
          and case p_operation
            when 'listing.create' then
              lower(coalesce(step->>'name', '')) in (
                'product-create', 'product-create-accepted', 'product-create-reconcile',
                'global-item-create', 'global-item-readback', 'publish-task-create',
                'published-item-readback', 'listing.create', '/product/create',
                'listing.resume', 'product-reconcile', 'goods-v3-add',
                'goods-reconcile', 'setnewgoods', 'offer', 'offer-reconcile',
                'publish', 'listing-image-upload'
              )
              or lower(coalesce(step->>'name', '')) like 'published-item-readback-%'
            when 'listing.update' then
              lower(coalesce(step->>'name', '')) in (
                'updategoods', 'editgoodscontents', 'listing.update', '/product/update',
                'product-update', 'offer-update', 'listing-image-upload'
              )
            when 'listing.stop' then
              lower(coalesce(step->>'name', '')) in (
                'stop-display', 'editgoodsstatus', 'listing.stop', '/product/deactivate',
                'sales-stop', 'status-stop', 'goods-off-shelf', 'offer-withdraw'
              )
            when 'price.update' then
              lower(coalesce(step->>'name', '')) in (
                'setgoodspriceqty', 'price.update', '/product/price_quantity/update',
                'price', 'bulk-price', 'offer-price'
              )
            when 'inventory.update' then
              lower(coalesce(step->>'name', '')) in (
                'setgoodspriceqty', 'inventory.update', '/product/price_quantity/update',
                'quantity', 'origin-product-stock', 'option-stock', 'goods-stock',
                'bulk-inventory'
              )
            when 'shipment.acknowledge' then
              lower(coalesce(step->>'name', '')) in (
                'seller-check', 'pack', 'acknowledgement', 'confirm'
              )
            when 'shipment.confirm' then
              lower(coalesce(step->>'name', '')) in (
                'setsendinginfo', 'shipment.confirm', 'pack', 'ready-to-ship',
                'invoice', 'dispatch', 'shipment-confirm', 'shipping-fulfillment'
              )
            else false
          end
     );
$$;

create or replace function sellerpilot_private.gateway_remote_create_observed(
  p_operation text,
  p_response_payload jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_operation = 'listing.create'
     and sellerpilot_private.gateway_external_write_observed(p_operation, p_response_payload);
$$;

drop function if exists public.sellerpilot_complete_channel_gateway_job(text, uuid, text, jsonb, text);

create function public.sellerpilot_complete_channel_gateway_job(
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
  v_external_write_observed boolean := false;
  v_effective_status text;
  v_credential_refresh_in_flight boolean := false;
  v_oauth_request_vault_id uuid;
  v_oauth_exchange_completed boolean := false;
begin
  if p_status not in ('succeeded', 'failed', 'reconciliation_required')
     or p_claim_token is null
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) <> 'object'
       or octet_length(p_response_payload::text) > 1000000
     )) then
    raise exception 'invalid channel gateway completion';
  end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select j.attempt_id, j.operation, j.channel, j.credential_refresh_in_flight,
         j.oauth_request_vault_id, j.oauth_exchange_completed
    into v_attempt_id, v_operation, v_channel, v_credential_refresh_in_flight,
         v_oauth_request_vault_id, v_oauth_exchange_completed
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now()
   for update;
  if not found then return false; end if;
  if v_credential_refresh_in_flight and p_status <> 'reconciliation_required' then
    return false;
  end if;
  if v_operation = 'oauth.exchange'
     and p_status = 'succeeded'
     and not v_oauth_exchange_completed then
    return false;
  end if;

  v_effective_status := p_status;
  if jsonb_typeof(p_response_payload) = 'object' then
    v_success := coalesce((p_response_payload->>'ok')::boolean, false);
    v_remote_id := left(nullif(trim(p_response_payload->>'remoteId'), ''), 240);
    v_public_url := left(nullif(trim(p_response_payload->>'publicUrl'), ''), 500);
    v_safe_message := left(coalesce(
      nullif(trim(p_response_payload->>'safeMessage'), ''),
      '채널 작업 결과가 저장됐습니다.'
    ), 1000);
    v_external_write_observed := sellerpilot_private.gateway_external_write_observed(
      v_operation,
      p_response_payload
    );
    if v_external_write_observed then
      v_effective_status := 'reconciliation_required';
      v_safe_message := '원격 판매채널 변경이 적용됐을 가능성이 있으나 식별값 또는 후속 조회를 확정하지 못했습니다. 판매자센터에서 수동 확인하기 전에는 같은 작업을 다시 실행할 수 없습니다.';
    end if;
  end if;

  update sellerpilot_private.channel_gateway_jobs j
     set status = v_effective_status,
         response_payload = case
           when v_effective_status in ('succeeded', 'reconciliation_required') then p_response_payload
           else null
         end,
         error_message = case
           when v_effective_status = 'failed' then left(coalesce(p_error_message, 'Channel worker failed.'), 500)
           when v_effective_status = 'reconciliation_required' then left(coalesce(
             case when v_external_write_observed then v_safe_message else null end,
             nullif(trim(p_error_message), ''),
             'Channel write outcome requires reconciliation.'
           ), 500)
           else null
         end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  if v_oauth_request_vault_id is not null then
    delete from vault.secrets where id = v_oauth_request_vault_id;
    update sellerpilot_private.channel_gateway_jobs
       set oauth_request_vault_id = null,
           updated_at = now()
     where id = p_job_id;
  end if;

  if v_effective_status = 'reconciliation_required' then
    v_safe_message := left(coalesce(
      case when v_external_write_observed then v_safe_message else null end,
      nullif(trim(p_error_message), ''),
      'Channel write outcome requires reconciliation.'
    ), 500);

    update sellerpilot_private.channel_operation_attempts a
       set status = 'manual_required',
           http_status = 409,
           remote_id = coalesce(v_remote_id, a.remote_id),
           safe_message = v_safe_message,
           completed_at = now()
     where a.id = v_attempt_id
       and a.status in ('running', 'failed', 'manual_required');

    if v_operation in ('listing.create', 'listing.update', 'listing.stop') then
      select l.id, l.product_id, l.owner_id
        into v_listing_id, v_product_id, v_owner_id
        from sellerpilot_private.product_listings l
       where l.operation_attempt_id = v_attempt_id
       limit 1;

      if v_listing_id is not null then
        update sellerpilot_private.product_listings l
           set status = 'failed',
               remote_id = coalesce(v_remote_id, l.remote_id),
               public_url = coalesce(v_public_url, l.public_url),
               last_error = v_safe_message,
               failure_class = 'external_action',
               published_at = case
                 when v_operation = 'listing.create' and v_remote_id is not null
                   then coalesce(l.published_at, now())
                 else l.published_at
               end,
               updated_at = now()
         where l.id = v_listing_id;

        insert into sellerpilot_private.operation_audit (
          owner_id, action, entity_type, entity_id, safe_detail
        ) values (
          v_owner_id,
          'gateway_listing_reconciliation_required',
          'product_listing',
          v_listing_id::text,
          jsonb_build_object(
            'attempt_id', v_attempt_id,
            'operation', v_operation,
            'channel', v_channel,
            'reason', case
              when v_external_write_observed then 'provider_mutation_observed'
              else 'provider_outcome_unknown'
            end
          )
        );
      end if;
    end if;
    return true;
  end if;

  if v_effective_status = 'failed'
     and v_attempt_id is not null then
    v_safe_message := left(coalesce(
      nullif(trim(p_error_message), ''),
      'Channel worker failed before a provider result was recorded.'
    ), 500);

    update sellerpilot_private.channel_operation_attempts a
       set status = 'failed',
           http_status = 422,
           safe_message = v_safe_message,
           completed_at = now()
     where a.id = v_attempt_id
       and a.status in ('running', 'failed');

    if v_operation in ('listing.create', 'listing.update', 'listing.stop') then
      select l.id, l.product_id, l.owner_id
        into v_listing_id, v_product_id, v_owner_id
        from sellerpilot_private.product_listings l
       where l.operation_attempt_id = v_attempt_id
       limit 1;

      if v_listing_id is not null then
        update sellerpilot_private.product_listings l
           set status = 'failed',
               last_error = v_safe_message,
               failure_class = 'retryable',
               updated_at = now()
         where l.id = v_listing_id;

        insert into sellerpilot_private.operation_audit (
          owner_id, action, entity_type, entity_id, safe_detail
        ) values (
          v_owner_id,
          'gateway_listing_failed',
          'product_listing',
          v_listing_id::text,
          jsonb_build_object(
            'attempt_id', v_attempt_id,
            'operation', v_operation,
            'channel', v_channel,
            'reason', 'worker_failed_before_recorded_provider_result'
          )
        );
      end if;
    end if;
    return true;
  end if;

  if v_attempt_id is null
     or v_effective_status <> 'succeeded'
     or jsonb_typeof(p_response_payload) <> 'object' then
    return true;
  end if;

  select coalesce((step->>'status')::integer, 422) into v_http_status
    from jsonb_array_elements(coalesce(p_response_payload->'steps', '[]'::jsonb)) step
   where coalesce((step->>'ok')::boolean, false) = false
   limit 1;
  v_http_status := coalesce(v_http_status, case when v_success then 200 else 422 end);

  update sellerpilot_private.channel_operation_attempts a
     set status = case
           when v_success then 'succeeded'
           else 'failed'
         end,
         http_status = v_http_status,
         remote_id = coalesce(v_remote_id, a.remote_id),
         safe_message = v_safe_message,
         completed_at = now()
     where a.id = v_attempt_id
     and a.status in ('running', 'failed');

  -- The exact gateway claim is the single ledger owner for every manual
  -- operation. Non-listing operations do not have a product-listing row, but
  -- their attempt must still leave `running` after either provider success or
  -- a structured provider rejection.
  if v_operation not in ('listing.create', 'listing.update', 'listing.stop') then
    return true;
  end if;

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
         public_url = case
           when v_success then coalesce(v_public_url, l.public_url)
           else l.public_url
         end,
         last_error = case when v_success then null else v_safe_message end,
         failure_class = case
           when v_success then null
           else 'retryable'
         end,
         published_at = case
           when v_success and v_operation in ('listing.create', 'listing.update') then coalesce(l.published_at, now())
           else l.published_at
         end,
         last_verified_at = case when v_success then now() else l.last_verified_at end,
         updated_at = now()
   where l.id = v_listing_id;

  if v_success and v_operation in ('listing.create', 'listing.update') then
    update sellerpilot_private.products p
       set status = 'active', updated_at = now()
     where p.id = v_product_id;
  end if;
  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_owner_id,
    case
      when v_success then 'gateway_listing_reconciled'
      else 'gateway_listing_failed'
    end,
    'product_listing',
    v_listing_id::text,
    jsonb_build_object(
      'attempt_id', v_attempt_id,
      'operation', v_operation,
      'channel', v_channel,
      'has_remote_id', v_remote_id is not null,
      'external_write_observed', false
    )
  );
  return true;
end;
$$;

drop function if exists public.sellerpilot_service_begin_gateway_credential_refresh(text, uuid, uuid);

create function public.sellerpilot_service_begin_gateway_credential_refresh(
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
  v_token_id uuid;
  v_updated integer;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_claim_token is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- This durable bit is written before the provider token fetch. If the
  -- process disappears after the provider rotates a refresh token, lease
  -- expiry becomes reconciliation and later jobs for the credential cannot
  -- retry the exchange automatically.
  update sellerpilot_private.channel_gateway_jobs j
     set credential_refresh_in_flight = true,
         credential_refresh_started_at = coalesce(j.credential_refresh_started_at, now()),
         updated_at = now()
   where j.id = p_job_id
     and j.channel in ('shopee', 'lazada', 'ebay')
     and j.status = 'running'
     and not j.oauth_exchange_completed
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

drop function if exists public.sellerpilot_service_prepare_gateway_credential_refresh(text, uuid, jsonb, timestamptz);
drop function if exists public.sellerpilot_service_prepare_gateway_credential_refresh(text, uuid, uuid, jsonb, timestamptz);
drop function if exists public.sellerpilot_service_prepare_gateway_credential_refresh(text, uuid, uuid, jsonb, timestamptz, boolean);
drop function if exists public.sellerpilot_service_prepare_gateway_credential_refresh(text, uuid, uuid, jsonb, timestamptz, boolean, boolean);

create function public.sellerpilot_service_prepare_gateway_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_recovery_only boolean default false,
  p_oauth_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job record;
  v_request_fingerprint text;
  v_refreshed_credential_id uuid;
  v_recovery_vault_id uuid;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_claim_token is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select
    j.id,
    j.channel,
    j.operation,
    j.credential_id,
    j.prepared_credential_id,
    j.credential_refresh_fingerprint,
    j.credential_refresh_recovery_vault_id,
    j.credential_refresh_recovery_fingerprint,
    j.credential_refresh_in_flight
  into v_job
    from sellerpilot_private.channel_gateway_jobs j
   where j.id = p_job_id
     and j.status = 'running'
     and j.worker_token_id = v_token_id
     and j.claim_token = p_claim_token
     and j.lease_expires_at > now()
   for update;
  if not found then return null; end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'payload', p_secret_payload,
      'expires_at', p_expires_at,
      'recovery_only', p_recovery_only
    )::text,
    'sha256'
  ), 'hex');

  if p_secret_payload is null
     or jsonb_typeof(p_secret_payload) <> 'object'
     or octet_length(p_secret_payload::text) > 32000
     or v_job.channel not in ('shopee', 'lazada', 'ebay')
     or (p_oauth_complete and (p_recovery_only or v_job.operation <> 'oauth.exchange')) then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- A Shopee main-account authorization returns a rotating token before the
  -- first shop-scoped token exists. It is not yet a usable channel credential,
  -- but losing it on a worker crash would consume the one-time OAuth grant.
  -- Preserve that intermediate snapshot in Vault under the exact live claim;
  -- it is never activated or handed to queued marketplace jobs.
  if p_recovery_only then
    if v_job.channel <> 'shopee'
       or v_job.operation <> 'oauth.exchange'
       or coalesce(p_secret_payload->>'partner_id', '') !~ '^[0-9]+$'
       or length(coalesce(p_secret_payload->>'partner_key', '')) < 16
       or coalesce(p_secret_payload->>'main_account_id', '') !~ '^[0-9]+$'
       or length(coalesce(p_secret_payload->>'main_account_access_token', '')) < 8
       or length(coalesce(p_secret_payload->>'main_account_refresh_token', '')) < 8
       or p_expires_at is null
       or p_expires_at <= now() then
      return jsonb_build_object('status', 'invalid');
    end if;

    if v_job.credential_refresh_recovery_vault_id is not null
       and v_job.credential_refresh_recovery_fingerprint = v_request_fingerprint then
      return jsonb_build_object('status', 'recovery_preserved', 'reused', true);
    end if;
    if not v_job.credential_refresh_in_flight then
      return jsonb_build_object('status', 'conflict');
    end if;

    select vault.create_secret(
      p_secret_payload::text,
      format('sellerpilot_gateway_recovery_%s_%s_%s', v_job.channel, v_job.id, gen_random_uuid()),
      'SellerPilot claim-bound OAuth recovery snapshot. Never expose outside manual reconciliation.'
    ) into v_recovery_vault_id;

    if v_job.credential_refresh_recovery_vault_id is not null then
      delete from vault.secrets where id = v_job.credential_refresh_recovery_vault_id;
    end if;

    update sellerpilot_private.channel_gateway_jobs j
       set credential_refresh_recovery_vault_id = v_recovery_vault_id,
           credential_refresh_recovery_fingerprint = v_request_fingerprint,
           credential_refresh_recovery_staged_at = now(),
           credential_refresh_in_flight = false,
           credential_refresh_started_at = null,
           updated_at = now()
     where j.id = v_job.id;

    return jsonb_build_object('status', 'recovery_preserved', 'reused', false);
  end if;

  if v_job.prepared_credential_id is not null
     and v_job.credential_refresh_fingerprint = v_request_fingerprint then
    if p_oauth_complete then
      update sellerpilot_private.channel_gateway_jobs j
         set oauth_exchange_completed = true,
             updated_at = now()
       where j.id = v_job.id
         and j.operation = 'oauth.exchange'
         and j.credential_refresh_in_flight = false
         and j.credential_refresh_recovery_vault_id is null;
      if not found then return jsonb_build_object('status', 'conflict'); end if;
    end if;
    return jsonb_build_object(
      'status', 'prepared',
      'credential_id', v_job.prepared_credential_id,
      'reused', true,
      'oauth_complete', p_oauth_complete
    );
  end if;
  if not v_job.credential_refresh_in_flight then
    return jsonb_build_object('status', 'conflict');
  end if;

  if v_job.channel = 'shopee' and (
    coalesce(p_secret_payload->>'partner_id', '') !~ '^[0-9]+$'
    or length(coalesce(p_secret_payload->>'partner_key', '')) < 16
    or coalesce(p_secret_payload->>'shop_id', '') !~ '^[0-9]+$'
    or length(coalesce(p_secret_payload->>'access_token', '')) < 8
    or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_job.channel = 'lazada' and (
    length(coalesce(p_secret_payload->>'access_token', '')) < 8
    or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
    or p_expires_at is null
    or p_expires_at <= now()
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_job.channel = 'ebay' and (
    length(coalesce(p_secret_payload->>'access_token', '')) < 8
    or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
    or length(coalesce(p_secret_payload->>'client_id', '')) < 3
    or length(coalesce(p_secret_payload->>'client_secret', '')) < 3
    or p_expires_at is null
    or p_expires_at <= now()
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform 1
    from sellerpilot_private.channel_credentials c
   where c.id = v_job.credential_id
     and c.channel = v_job.channel
     and c.status = 'active'
   for update;
  if not found then return jsonb_build_object('status', 'conflict'); end if;

  v_refreshed_credential_id := case v_job.channel
    when 'shopee' then public.sellerpilot_service_refresh_shopee(
      v_job.credential_id,
      p_secret_payload,
      p_expires_at
    )
    when 'lazada' then public.sellerpilot_service_refresh_lazada(
      v_job.credential_id,
      p_secret_payload,
      p_expires_at
    )
    when 'ebay' then public.sellerpilot_service_refresh_ebay(
      v_job.credential_id,
      p_secret_payload,
      p_expires_at
    )
  end;

  update sellerpilot_private.channel_gateway_jobs queued
     set credential_id = v_refreshed_credential_id,
         updated_at = now()
   where queued.credential_id = v_job.credential_id
     and queued.status = 'queued';

  if v_job.credential_refresh_recovery_vault_id is not null then
    delete from vault.secrets where id = v_job.credential_refresh_recovery_vault_id;
  end if;

  update sellerpilot_private.channel_gateway_jobs j
     set credential_id = v_refreshed_credential_id,
         prepared_credential_id = v_refreshed_credential_id,
         credential_refresh_fingerprint = v_request_fingerprint,
         credential_refresh_prepared_at = now(),
         credential_refresh_recovery_vault_id = null,
         credential_refresh_recovery_fingerprint = null,
         credential_refresh_recovery_staged_at = null,
         credential_refresh_in_flight = false,
         credential_refresh_started_at = null,
         oauth_exchange_completed = p_oauth_complete and v_job.operation = 'oauth.exchange',
         updated_at = now()
   where j.id = v_job.id;

  return jsonb_build_object(
    'status', 'prepared',
    'credential_id', v_refreshed_credential_id,
    'reused', false,
    'oauth_complete', p_oauth_complete and v_job.operation = 'oauth.exchange'
  );
end;
$$;

revoke all on function public.sellerpilot_claim_channel_gateway_job(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_channel_gateway_job(text, text)
  to service_role;
revoke all on function public.sellerpilot_touch_channel_gateway_job(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_touch_channel_gateway_job(text, uuid, uuid, text)
  to service_role;
revoke all on function public.sellerpilot_service_begin_channel_gateway_completion(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_channel_gateway_completion(text, uuid, uuid)
  to service_role;
revoke all on function sellerpilot_private.gateway_remote_create_observed(text, jsonb)
  from public, anon, authenticated;
revoke all on function sellerpilot_private.gateway_external_write_observed(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_complete_channel_gateway_job(text, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_channel_gateway_job(text, uuid, uuid, text, jsonb, text)
  to service_role;
revoke all on function public.sellerpilot_service_begin_gateway_credential_refresh(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_credential_refresh(text, uuid, uuid)
  to service_role;
revoke all on function public.sellerpilot_service_prepare_gateway_credential_refresh(text, uuid, uuid, jsonb, timestamptz, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_prepare_gateway_credential_refresh(text, uuid, uuid, jsonb, timestamptz, boolean, boolean)
  to service_role;

commit;
