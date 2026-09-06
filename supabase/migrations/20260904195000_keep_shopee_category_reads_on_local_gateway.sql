-- Operator-verified 2026-09-04: Shopee global_product/get_category returns
-- 200 from the Mac whitelist IP but Vercel drain IPs rotate
-- (54.116.35.135, then 3.39.244.7) and fail source_ip_undeclared. Do not
-- buy Static IP. Keep oauth.exchange and category tree/attribute/validate
-- reads off the serverless claimant so the local gateway worker can run
-- them from the already-whitelisted Mac address. Other authenticated Shopee
-- reads stay on serverless.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

drop index if exists
  sellerpilot_private.channel_gateway_jobs_one_running_mutation_scope_idx;
create unique index
  channel_gateway_jobs_one_running_mutation_scope_idx
  on sellerpilot_private.channel_gateway_jobs (channel, environment)
  where status = 'running'
    and not (
      (
        channel = 'coupang'
        and operation in ('orders.list', 'inquiries.list')
      )
      or (
        channel = 'shopee'
        and operation in (
          'categories.list', 'categories.suggest',
          'categories.attributes', 'categories.validate'
        )
      )
    );

create or replace function
  sellerpilot_private.guard_channel_gateway_running_parallelism()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_running integer;
  v_mutating integer;
begin
  if new.status <> 'running'
     or (
       tg_op = 'UPDATE'
       and old.status = 'running'
       and old.channel = new.channel
       and old.environment = new.environment
       and old.operation = new.operation
     ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    193674995,
    pg_catalog.hashtext(new.channel || ':' || new.environment)
  );

  select count(*),
         count(*) filter (where running.operation not in (
           'orders.list', 'inquiries.list'
         ))
    into v_running, v_mutating
    from sellerpilot_private.channel_gateway_jobs running
   where running.channel = new.channel
     and running.environment = new.environment
     and running.status = 'running'
     and running.id <> new.id;

  if new.channel = 'coupang'
     and new.operation in ('orders.list', 'inquiries.list') then
    if v_running >= 2 or v_mutating > 0 then
      raise exception using
        errcode = 'SPC02',
        message = 'Coupang read concurrency limit reached';
    end if;
  elsif new.channel = 'shopee'
     and new.operation in (
       'categories.list', 'categories.suggest',
       'categories.attributes', 'categories.validate'
     ) then
    if v_mutating > 0 then
      raise exception using
        errcode = 'SPC02',
        message = 'Shopee category read blocked by a running mutation';
    end if;
  elsif v_running > 0 then
    raise exception using
      errcode = 'SPC02',
      message = 'channel gateway running operation already exists';
  end if;

  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_channel_gateway_running_parallelism()
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sellerpilot_183000_claim_serverless_gateway_unsafe(p_token_hash text, p_worker_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
  v_coupang_reads_waiting boolean := false;
  v_coupang_read_environment text;
  v_coupang_read_slot integer := 0;
  v_updated integer := 0;
begin
  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for share;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- Opportunistically recover expired leases before applying the running-job
  -- fence below. The reaper uses pg_try_advisory_xact_lock, so exactly one
  -- concurrent claimant does the bounded sweep while every loser continues
  -- immediately to SKIP LOCKED claiming. Reads are safely requeued; an expired
  -- provider mutation keeps the existing reconciliation-required rule.
  perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);

  -- The Vercel drain starts several independent claim transactions at once.
  -- Two non-blocking transaction slots let two Coupang reads advance in the
  -- same wake without allowing every concurrent claimant to race through the
  -- running-count predicate. While a read wave is queued, claimants that miss
  -- both slots simply consider other channels; Coupang mutations wait for the
  -- bounded read wave to empty and retain their single-writer fence.
  select queued_read.environment
    into v_coupang_read_environment
    from sellerpilot_private.channel_gateway_jobs queued_read
    join sellerpilot_private.channel_credentials queued_credential
      on queued_credential.id = queued_read.credential_id
     and queued_credential.channel = queued_read.channel
     and queued_credential.status = 'active'
     and (
       queued_credential.expires_at is null
       or queued_credential.expires_at > clock_timestamp()
     )
   where queued_read.status = 'queued'
     and queued_read.channel = 'coupang'
     and queued_read.operation in ('orders.list', 'inquiries.list')
     and queued_read.seller_account_key is not distinct from
           queued_credential.seller_account_key
     and sellerpilot_private.serverless_static_egress_allowed('coupang')
   order by queued_read.created_at, queued_read.id
   limit 1;
  v_coupang_reads_waiting := v_coupang_read_environment is not null;

  if v_coupang_reads_waiting then
    if pg_catalog.pg_try_advisory_xact_lock(
      193674996,
      pg_catalog.hashtext(
        'coupang:' || v_coupang_read_environment || ':read-slot-1'
      )
    ) then
      v_coupang_read_slot := 1;
    elsif pg_catalog.pg_try_advisory_xact_lock(
      193674996,
      pg_catalog.hashtext(
        'coupang:' || v_coupang_read_environment || ':read-slot-2'
      )
    ) then
      v_coupang_read_slot := 2;
    end if;
  end if;

  -- FOR SHARE keeps concurrent claimers compatible while preventing token
  -- revocation from racing credential disclosure. The first immediate touch
  -- records worker version/last-seen. Scheduled maintenance remains a second
  -- recovery path and never serializes this SKIP LOCKED claim path.

  -- Rebind only queued work to an active credential for the exact same seller.
  -- A live provider call always keeps the credential incarnation it claimed.
  update sellerpilot_private.channel_gateway_jobs job
     set credential_id = active_credential.id,
         updated_at = clock_timestamp()
    from sellerpilot_private.channel_credentials old_credential,
         sellerpilot_private.channel_credentials active_credential
   where job.credential_id = old_credential.id
     and job.status = 'queued'
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
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
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
     and (
       job.channel not in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')
       or sellerpilot_private.serverless_static_egress_allowed(job.channel)
       or (
         job.channel = 'shopee'
         and job.operation not in (
           'oauth.exchange',
           'categories.list', 'categories.suggest',
           'categories.attributes', 'categories.validate'
         )
       )
     )
     and job.seller_account_key is not distinct from
           credential.seller_account_key
     and (
       job.channel <> 'ebay'
       or job.operation = 'oauth.exchange'
       or (
         job.operation = 'diagnostic.test'
         and credential.seller_account_key is null
         and credential.seller_account_key_source = 'legacy_unattested'
         and credential.seller_account_verified_at is null
       )
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )
     and (
       job.channel <> 'shopee'
       or job.operation = 'oauth.exchange'
       or (
         job.operation = 'diagnostic.test'
         and credential.seller_account_key is null
         and credential.seller_account_key_source = 'legacy_unattested'
         and credential.seller_account_verified_at is null
       )
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )
     and (
       (
         job.channel = 'coupang'
         and job.operation in ('orders.list', 'inquiries.list')
         and job.environment = v_coupang_read_environment
         and v_coupang_read_slot > 0
         and (
           select count(*)
             from sellerpilot_private.channel_gateway_jobs running
            where running.channel = credential.channel
              and running.environment = credential.environment
              and running.status = 'running'
         ) < 2
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs running
            where running.channel = credential.channel
              and running.environment = credential.environment
              and running.status = 'running'
              and running.operation not in ('orders.list', 'inquiries.list')
         )
       )
       or (
         not (
           job.channel = 'coupang'
           and job.operation in ('orders.list', 'inquiries.list')
         )
         and (
           job.channel <> 'coupang'
           or not v_coupang_reads_waiting
           or job.environment is distinct from v_coupang_read_environment
         )
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs running
            where running.channel = credential.channel
              and running.environment = credential.environment
              and running.status = 'running'
              and not (
                job.channel = 'shopee'
                and job.operation in (
                  'categories.list', 'categories.suggest',
                  'categories.attributes', 'categories.validate'
                )
                and running.operation in (
                  'orders.list', 'inquiries.list',
                  'categories.list', 'categories.suggest',
                  'categories.attributes', 'categories.validate'
                )
              )
         )
       )
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
          and not (
            job.channel = 'shopee'
            and job.operation in (
              'categories.list', 'categories.suggest',
              'categories.attributes', 'categories.validate'
            )
            and unresolved.operation is distinct from 'oauth.exchange'
            and unresolved.provider_mutation_started_at is null
          )
     )
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
   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)
         then 0
       else 1
     end,
     case when job.prepared_credential_id is null then 1 else 0 end,
     case when job.attempt_id is null then 1 else 0 end,
     case
       when job.operation in (
         'inquiries.reply',
         'categories.list', 'categories.suggest',
         'categories.attributes', 'categories.validate'
       ) then 0
       when coalesce(job.request_payload->>'periodicKey', '') like 'inquiries:history:%'
         or nullif(job.request_payload #>> '{arguments,sellerpilotHistoryRunId}', '') is not null
         then 2
       else 1
     end,
     job.created_at,
     job.id
   for update of job skip locked
   for share of credential
   limit 1;
  if v_job_id is null then
    return null;
  end if;

  v_claim_token := gen_random_uuid();
  begin
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
    get diagnostics v_updated = row_count;
  exception
    -- A concurrent claimant may have filled the channel slot after this
    -- transaction evaluated its snapshot. This is ordinary empty-capacity,
    -- not a worker/database failure; every unrelated SQL error still escapes.
    when sqlstate 'SPC02' then
      return null;
  end;
  if v_updated <> 1 then
    return null;
  end if;

  select jsonb_build_object(
    'id', job.id,
    'claim_token', job.claim_token,
    'credential_id', job.credential_id,
    'channel', job.channel,
    'operation', job.operation,
    'environment', job.environment,
    'request', case
      when job.operation = 'oauth.exchange'
        then oauth_request.decrypted_secret::jsonb
      else job.request_payload
    end,
    'attempt_count', job.attempt_count,
    'credential', credential_secret.decrypted_secret::jsonb
  )
    into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join vault.decrypted_secrets credential_secret
      on credential_secret.id = credential.vault_secret_id
    left join vault.decrypted_secrets oauth_request
      on oauth_request.id = job.oauth_request_vault_id
   where job.id = v_job_id
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and (
       job.operation <> 'oauth.exchange'
       or oauth_request.decrypted_secret is not null
     );

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed',
           error_message = 'Active credential or OAuth request could not be decrypted.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where job.id = v_job_id;

    delete from vault.secrets secret
     using sellerpilot_private.channel_gateway_jobs job
     where secret.id = job.oauth_request_vault_id
       and job.id = v_job_id
       and job.oauth_request_vault_id is not null;
    update sellerpilot_private.channel_gateway_jobs job
       set oauth_request_vault_id = null,
           updated_at = clock_timestamp()
     where job.id = v_job_id
       and job.oauth_request_vault_id is not null;
  end if;

  return v_result;
end;
$function$
;

commit;
