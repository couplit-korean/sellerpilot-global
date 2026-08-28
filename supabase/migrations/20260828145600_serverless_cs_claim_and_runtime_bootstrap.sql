-- Provision a narrowly-scoped Vercel CS worker and let it claim only the
-- bounded inquiry operations implemented by the serverless gateway. Raw
-- gateway and scheduler tokens are derived by Vercel and never enter the
-- database; only their SHA-256 hashes and display fingerprints are persisted.

begin;

alter table sellerpilot_private.ai_cli_worker_tokens
  drop constraint if exists ai_cli_worker_tokens_scope_check;
alter table sellerpilot_private.ai_cli_worker_tokens
  add constraint ai_cli_worker_tokens_scope_check check (scope in (
    'ai', 'gateway', 'scheduler', 'legacy_combined',
    'serverless_cs', 'serverless_cs_scheduler'
  ));

create index if not exists channel_gateway_jobs_serverless_cs_queue_idx
  on sellerpilot_private.channel_gateway_jobs (created_at, id)
  where status = 'queued'
    and channel in ('ebay', 'coupang', 'smartstore')
    and operation in ('inquiries.list', 'inquiries.reply');

create or replace function sellerpilot_private.serverless_cs_job_is_owned(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_require_live_lease boolean default true
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
      join sellerpilot_private.channel_gateway_jobs job
        on job.worker_token_id = token.id
     where token.token_hash = p_token_hash
       and token.scope = 'serverless_cs'
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and job.id = p_job_id
       and job.claim_token = p_claim_token
       and job.channel in ('ebay', 'coupang', 'smartstore')
       and job.operation in ('inquiries.list', 'inquiries.reply')
       and (
         not p_require_live_lease
         or (
           job.status = 'running'
           and job.lease_expires_at > clock_timestamp()
         )
       )
  );
$$;

-- The atomic completion implementation is shared with the persistent worker.
-- It may accept a dedicated token only for the exact eligible job/claim it
-- owns (or its immutable completion receipt). This helper never authorizes a
-- claim and therefore cannot expose the generic gateway queue.
create or replace function sellerpilot_private.worker_token_may_complete_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and (
         token.scope in ('gateway', 'legacy_combined')
         or (
           token.scope = 'serverless_cs'
           and (
             exists (
               select 1
                 from sellerpilot_private.channel_gateway_jobs job
                where job.id = p_job_id
                  and job.worker_token_id = token.id
                  and job.claim_token = p_claim_token
                  and job.channel in ('ebay', 'coupang', 'smartstore')
                  and job.operation in ('inquiries.list', 'inquiries.reply')
             )
             or exists (
               select 1
                 from sellerpilot_private.gateway_completion_receipts receipt
                 join sellerpilot_private.channel_gateway_jobs job
                   on job.id = receipt.job_id
                where receipt.job_id = p_job_id
                  and receipt.worker_token_id = token.id
                  and receipt.claim_token = p_claim_token
                  and job.channel in ('ebay', 'coupang', 'smartstore')
                  and job.operation in ('inquiries.list', 'inquiries.reply')
             )
           )
         )
       )
  );
$$;

-- Preserve the proven atomic completion body byte-for-byte while extending
-- its token gate to the exact ownership helper above. The generic claimant is
-- intentionally not changed and continues to require the gateway scope.
do $migration$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
  v_old_guard constant text := E'not sellerpilot_private.worker_token_has_scope(\n       p_token_hash,\n       ''gateway'',\n       true\n     )';
  v_new_guard constant text := E'not sellerpilot_private.worker_token_may_complete_gateway_job(\n       p_token_hash,\n       p_job_id,\n       p_claim_token\n     )';
begin
  foreach v_signature in array array[
    'public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)',
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature::regprocedure)
      into v_definition;
    v_rewritten := replace(v_definition, v_old_guard, v_new_guard);
    v_rewritten := replace(
      v_rewritten,
      'worker_token.scope in (''gateway'', ''legacy_combined'')',
      'worker_token.scope in (''gateway'', ''legacy_combined'', ''serverless_cs'')'
    );
    if v_rewritten = v_definition
       or position(v_old_guard in v_rewritten) > 0
       or position(
         'worker_token.scope in (''gateway'', ''legacy_combined'')'
         in v_rewritten
       ) > 0 then
      raise exception 'expected gateway completion token guards were not found in %',
        v_signature;
    end if;
    execute v_rewritten;
  end loop;
end;
$migration$;

revoke all on function sellerpilot_private.serverless_cs_job_is_owned(
  text, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.worker_token_may_complete_gateway_job(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_claim_serverless_cs_job(
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
  -- Serialize with the existing gateway claim/completion lifecycle. The
  -- dedicated scope cannot reach the generic gateway claim and therefore
  -- cannot consume non-CS or unsupported marketplace work.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where token.id = v_token_id;

  -- A provider reply is a write. The existing inquiry-reply ledger trigger
  -- also enforces this transition, but spelling it out here prevents a future
  -- trigger refactor from turning an ambiguous send into an automatic retry.
  update sellerpilot_private.channel_gateway_jobs job
     set status = case
           when job.operation = 'inquiries.reply' then 'reconciliation_required'
           when job.attempt_count >= 4 then 'failed'
           else 'queued'
         end,
         error_message = case
           when job.operation = 'inquiries.reply'
             then 'Inquiry reply worker lease expired; provider outcome requires reconciliation.'
           when job.attempt_count >= 4
             then 'Serverless inquiry read lease expired four times.'
           else job.error_message
         end,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = case
           when job.operation = 'inquiries.reply' or job.attempt_count >= 4
             then clock_timestamp()
           else job.completed_at
         end,
         updated_at = clock_timestamp()
   where job.status = 'running'
     and (job.lease_expires_at is null or job.lease_expires_at <= clock_timestamp())
     and job.channel in ('ebay', 'coupang', 'smartstore')
     and job.operation in ('inquiries.list', 'inquiries.reply');

  -- A read lease can expire after credential rotation. Rebind only queued
  -- work, and only to the same attested seller account. The existing lineage
  -- trigger remains the final authority for every reassignment.
  update sellerpilot_private.channel_gateway_jobs job
     set credential_id = active_credential.id,
         updated_at = clock_timestamp()
    from sellerpilot_private.channel_credentials old_credential,
         sellerpilot_private.channel_credentials active_credential
   where job.credential_id = old_credential.id
     and job.status = 'queued'
     and job.channel in ('ebay', 'coupang', 'smartstore')
     and job.operation in ('inquiries.list', 'inquiries.reply')
     and old_credential.status <> 'active'
     and active_credential.channel = old_credential.channel
     and active_credential.environment = old_credential.environment
     and active_credential.status = 'active'
     and (active_credential.expires_at is null
       or active_credential.expires_at > clock_timestamp())
     and active_credential.seller_account_key is not distinct from
           job.seller_account_key
     and active_credential.id <> old_credential.id;

  select job.id
    into v_job_id
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = job.channel
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
   where job.status = 'queued'
     and job.channel in ('ebay', 'coupang', 'smartstore')
     and job.operation in ('inquiries.list', 'inquiries.reply')
     and job.seller_account_key is not distinct from
           credential.seller_account_key
     and (
       job.channel <> 'ebay'
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running
         join sellerpilot_private.channel_credentials running_credential
           on running_credential.id = running.credential_id
        where running_credential.channel = credential.channel
          and running_credential.environment = credential.environment
          and running.status = 'running'
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs unresolved
         join sellerpilot_private.channel_credentials unresolved_credential
           on unresolved_credential.id = unresolved.credential_id
        where unresolved_credential.channel = credential.channel
          and unresolved_credential.environment = credential.environment
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
     -- Preserve the eBay ASQ 100-second provider cooldown across runtimes.
     and not (
       job.channel = 'ebay'
       and job.operation = 'inquiries.reply'
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs recent_job
           cross join lateral jsonb_array_elements(
             case
               when jsonb_typeof(recent_job.response_payload->'steps') = 'array'
                 then recent_job.response_payload->'steps'
               else '[]'::jsonb
             end
           ) provider_step
          where recent_job.channel = 'ebay'
            and recent_job.operation = 'inquiries.reply'
            and recent_job.environment = job.environment
            and recent_job.seller_account_key = job.seller_account_key
            and recent_job.completed_at >= clock_timestamp() - interval '100 seconds'
            and (
              provider_step->>'status' = '429'
              or exists (
                select 1
                  from jsonb_array_elements(
                    case
                      when jsonb_typeof(provider_step#>'{data,errors}') = 'array'
                        then provider_step#>'{data,errors}'
                      else '[]'::jsonb
                    end
                  ) provider_error
                 where provider_error->>'errorCode' = '518'
              )
            )
       )
     )
   order by job.created_at, job.id
   for update of job, credential skip locked
   limit 1;
  if v_job_id is null then
    return null;
  end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         started_at = coalesce(job.started_at, clock_timestamp()),
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_job_id;

  select jsonb_build_object(
    'id', job.id,
    'claim_token', job.claim_token,
    'credential_id', job.credential_id,
    'channel', job.channel,
    'operation', job.operation,
    'environment', job.environment,
    'request', job.request_payload,
    'attempt_count', job.attempt_count,
    'credential', decrypted.decrypted_secret::jsonb
  )
    into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where job.id = v_job_id
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp());

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed',
           error_message = 'Active credential could not be decrypted.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where job.id = v_job_id;
  end if;

  return v_result;
end;
$$;

-- Compatibility alias for the first Vercel route revision. It intentionally
-- delegates to the now-generic bounded CS claimant so the route and database
-- can roll forward independently without reopening the full gateway queue.
create or replace function public.sellerpilot_claim_ebay_asq_serverless_job(
  p_token_hash text,
  p_worker_version text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.sellerpilot_claim_serverless_cs_job(
    p_token_hash,
    p_worker_version
  )
$$;

create or replace function public.sellerpilot_touch_serverless_cs_job(
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
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    if exists (
      select 1 from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id
    ) then
      return 'ownership_lost';
    end if;
    return null;
  end if;
  return public.sellerpilot_touch_channel_gateway_job(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_worker_version
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_serverless_cs_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    return false;
  end if;
  return public.sellerpilot_service_begin_gateway_credential_refresh(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

create or replace function public.sellerpilot_service_prepare_serverless_cs_credential_refresh(
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
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    return null;
  end if;
  return public.sellerpilot_service_prepare_gateway_credential_refresh(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_secret_payload,
    p_expires_at,
    p_recovery_only,
    p_oauth_complete
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_serverless_cs_provider_mutation(
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
  v_started boolean;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    return false;
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at = coalesce(
           job.provider_mutation_started_at,
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id = p_job_id
     and job.channel in ('ebay', 'coupang', 'smartstore')
     and job.operation = 'inquiries.reply'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
  returning true into v_started;

  return coalesce(v_started, false);
end;
$$;

create or replace function public.sellerpilot_service_serverless_cs_completion_context(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_may_complete_gateway_job(
    p_token_hash, p_job_id, p_claim_token
  ) then
    return null;
  end if;
  return public.sellerpilot_service_gateway_completion_context(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

create or replace function public.sellerpilot_service_complete_serverless_cs_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_may_complete_gateway_job(
    p_token_hash, p_job_id, p_claim_token
  ) then
    return jsonb_build_object('status', 'ownership_lost');
  end if;
  return public.sellerpilot_service_complete_gateway_transaction(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_status,
    p_response_payload,
    p_error_message,
    p_credential_refresh,
    p_normalized_orders,
    p_normalized_inquiries,
    p_diagnostic
  );
end;
$$;

create or replace function public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
  p_gateway_token_hash text,
  p_gateway_fingerprint text,
  p_scheduler_token_hash text,
  p_scheduler_fingerprint text,
  p_wake_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := clock_timestamp() + interval '365 days';
  v_owner_id uuid;
  v_gateway_token_id uuid;
  v_scheduler_token_id uuid;
  v_wake_vault_id uuid;
begin
  if coalesce(p_gateway_token_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_scheduler_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_gateway_token_hash = p_scheduler_token_hash
     or coalesce(p_gateway_fingerprint, '') !~ '^[A-F0-9]{12}$'
     or coalesce(p_scheduler_fingerprint, '') !~ '^[A-F0-9]{12}$'
     or coalesce(p_wake_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid serverless runtime metadata';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  lock table sellerpilot_private.ai_cli_worker_tokens
    in share row exclusive mode;

  select administrator.user_id
    into v_owner_id
    from sellerpilot_private.admin_users administrator
   order by administrator.created_at, administrator.user_id
   limit 1;
  if v_owner_id is null then
    raise exception 'administrator bootstrap owner required'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where (
       token.token_hash = p_gateway_token_hash
       and token.scope <> 'serverless_cs'
     ) or (
       token.token_hash = p_scheduler_token_hash
       and token.scope <> 'serverless_cs_scheduler'
     )
  ) then
    raise exception 'derived worker token hash already belongs to another scope'
      using errcode = '23505';
  end if;

  -- Rotate only the previous dedicated serverless claimant after it has
  -- drained. Persistent gateway workers and their non-CS leases are outside
  -- this bootstrap's scope and are never updated below.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = job.worker_token_id
     where job.status = 'running'
       and token.scope = 'serverless_cs'
       and token.token_hash <> p_gateway_token_hash
  ) then
    raise exception 'gateway worker leases must drain before token rotation'
      using errcode = '55000';
  end if;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked',
           revoked_at = coalesce(token.revoked_at, v_now)
     where token.scope in ('serverless_cs', 'serverless_cs_scheduler')
       and token.status = 'active'
       and token.token_hash <> case token.scope
             when 'serverless_cs' then p_gateway_token_hash
             else p_scheduler_token_hash
           end
    returning token.id, token.scope, token.fingerprint
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  )
  select
    'token_revoked',
    v_owner_id,
    revoked.id,
    jsonb_build_object(
      'reason', 'serverless_runtime_rotation',
      'scope', revoked.scope,
      'fingerprint', revoked.fingerprint
    )
  from revoked;

  select token.id
    into v_gateway_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_gateway_token_hash
     and token.scope = 'serverless_cs'
   for update;
  if v_gateway_token_id is null then
    insert into sellerpilot_private.ai_cli_worker_tokens (
      label, token_hash, fingerprint, status, scope, expires_at, created_by,
      activated_at
    ) values (
      'SellerPilot Vercel serverless CS gateway',
      p_gateway_token_hash,
      p_gateway_fingerprint,
      'active',
      'serverless_cs',
      v_expires_at,
      v_owner_id,
      v_now
    )
    returning id into v_gateway_token_id;
  else
    if exists (
      select 1
        from sellerpilot_private.ai_cli_worker_tokens token
       where token.id = v_gateway_token_id
         and token.status = 'pending'
    ) then
      raise exception 'pending rotation token cannot be bootstrapped independently'
        using errcode = '55000';
    end if;
    update sellerpilot_private.ai_cli_worker_tokens token
       set label = 'SellerPilot Vercel serverless CS gateway',
           fingerprint = p_gateway_fingerprint,
           status = 'active',
           expires_at = v_expires_at,
           revoked_at = null,
           activated_at = coalesce(token.activated_at, v_now)
     where token.id = v_gateway_token_id;
  end if;

  select token.id
    into v_scheduler_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_scheduler_token_hash
     and token.scope = 'serverless_cs_scheduler'
   for update;
  if v_scheduler_token_id is null then
    insert into sellerpilot_private.ai_cli_worker_tokens (
      label, token_hash, fingerprint, status, scope, expires_at, created_by,
      activated_at
    ) values (
      'SellerPilot Supabase serverless CS scheduler',
      p_scheduler_token_hash,
      p_scheduler_fingerprint,
      'active',
      'serverless_cs_scheduler',
      v_expires_at,
      v_owner_id,
      v_now
    )
    returning id into v_scheduler_token_id;
  else
    if exists (
      select 1
        from sellerpilot_private.ai_cli_worker_tokens token
       where token.id = v_scheduler_token_id
         and token.status = 'pending'
    ) then
      raise exception 'pending rotation token cannot be bootstrapped independently'
        using errcode = '55000';
    end if;
    update sellerpilot_private.ai_cli_worker_tokens token
       set label = 'SellerPilot Supabase serverless CS scheduler',
           fingerprint = p_scheduler_fingerprint,
           status = 'active',
           expires_at = v_expires_at,
           revoked_at = null,
           activated_at = coalesce(token.activated_at, v_now)
     where token.id = v_scheduler_token_id;
  end if;

  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  ) values
  (
    'token_issued',
    v_owner_id,
    v_gateway_token_id,
    jsonb_build_object(
      'reason', 'serverless_runtime_bootstrap_or_renewal',
      'scope', 'serverless_cs',
      'fingerprint', p_gateway_fingerprint,
      'renewed_at', v_now,
      'expires_at', v_expires_at
    )
  ),
  (
    'token_issued',
    v_owner_id,
    v_scheduler_token_id,
    jsonb_build_object(
      'reason', 'serverless_runtime_bootstrap_or_renewal',
      'scope', 'serverless_cs_scheduler',
      'fingerprint', p_scheduler_fingerprint,
      'renewed_at', v_now,
      'expires_at', v_expires_at
    )
  );

  select secret.id
    into v_wake_vault_id
    from vault.secrets secret
   where secret.name = 'sellerpilot_serverless_cs_wake_v1'
   order by secret.created_at desc, secret.id
   limit 1
   for update;
  if v_wake_vault_id is null then
    select vault.create_secret(
      p_wake_secret,
      'sellerpilot_serverless_cs_wake_v1',
      'Derived Vercel serverless CS wake bearer; rotate through service bootstrap only'
    ) into v_wake_vault_id;
  else
    perform vault.update_secret(
      v_wake_vault_id,
      p_wake_secret,
      'sellerpilot_serverless_cs_wake_v1',
      'Derived Vercel serverless CS wake bearer; rotate through service bootstrap only'
    );
  end if;

  return jsonb_build_object(
    'configured', true,
    'version', 'serverless_cs_v1',
    'fingerprints', jsonb_build_object(
      'gateway', p_gateway_fingerprint,
      'scheduler', p_scheduler_fingerprint
    )
  );
end;
$$;

revoke all on function public.sellerpilot_claim_serverless_cs_job(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_serverless_cs_job(text, text)
  to service_role;

revoke all on function public.sellerpilot_claim_ebay_asq_serverless_job(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_ebay_asq_serverless_job(text, text)
  to service_role;

revoke all on function public.sellerpilot_touch_serverless_cs_job(
  text, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_touch_serverless_cs_job(
  text, uuid, uuid, text
) to service_role;

revoke all on function
  public.sellerpilot_service_begin_serverless_cs_credential_refresh(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_serverless_cs_credential_refresh(
    text, uuid, uuid
  ) to service_role;

revoke all on function
  public.sellerpilot_service_prepare_serverless_cs_credential_refresh(
    text, uuid, uuid, jsonb, timestamptz, boolean, boolean
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_prepare_serverless_cs_credential_refresh(
    text, uuid, uuid, jsonb, timestamptz, boolean, boolean
  ) to service_role;

revoke all on function
  public.sellerpilot_service_begin_serverless_cs_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_serverless_cs_provider_mutation(
    text, uuid, uuid
  ) to service_role;

revoke all on function
  public.sellerpilot_service_serverless_cs_completion_context(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_serverless_cs_completion_context(
    text, uuid, uuid
  ) to service_role;

revoke all on function
  public.sellerpilot_service_complete_serverless_cs_transaction(
    text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_complete_serverless_cs_transaction(
    text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
  ) to service_role;

revoke all on function
  public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
    text, text, text, text, text
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
    text, text, text, text, text
  )
  to service_role;

comment on function public.sellerpilot_claim_serverless_cs_job(text, text) is
  'Claims at most one eBay, Coupang, or Smartstore inquiries.list/reply job for the bounded Vercel runtime.';
comment on function
  public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
    text, text, text, text, text
  ) is
  'Installs only dedicated serverless CS execution/scheduler hashes and the derived wake bearer; returns no secret material.';

commit;
