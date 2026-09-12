begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Reviewed live definition from sqaoqucxakebqkiygdxb; never overwrite drift.
do $preimage$
begin
  if (select md5(pg_get_functiondef(p.oid)) from pg_proc p
      where p.oid = to_regprocedure('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'))
      is distinct from 'e68e1dbde4841d9554ef84f4f756a994' then
    raise exception 'LOCAL_READ_CLAIM_PREIMAGE_CHANGED';
  end if;
end $preimage$;

create or replace function sellerpilot_private.claim_local_channel_executor_read_job(
  p_token_hash text, p_worker_version text, p_release_sha text, p_egress_ip_sha256 text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_token_id uuid;
  v_candidate record;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash and t.status = 'active' and t.expires_at > now();
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  -- Only existing, independently authorized read jobs are eligible. Skip busy
  -- channels and deferred rate budgets before choosing the oldest candidate.
  for v_candidate in
    select j.id, j.channel, j.environment
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.channel_credentials c
        on c.id = j.credential_id and c.status = 'active'
     where j.status = 'queued'
       and j.operation in ('diagnostic.test', 'inquiries.list', 'orders.list')
       and j.environment = 'production'
       and (j.rate_not_before is null or j.rate_not_before <= clock_timestamp())
       and sellerpilot_private.local_channel_executor_access(j.channel, j.operation) = 'read'
       and sellerpilot_private.local_channel_executor_job_allowed(
         j.id, c.id, v_token_id, p_worker_version, p_release_sha, p_egress_ip_sha256)
       and not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs running
          where running.channel = j.channel and running.environment = j.environment
            and running.status = 'running'
       )
     order by j.created_at, j.id
     limit 16
     for update of j, c skip locked
  loop
    -- Same lock as guard_channel_gateway_running_parallelism. A competing
    -- runtime cannot start a second job between the final check and UPDATE.
    if not pg_catalog.pg_try_advisory_xact_lock(
      193674995, pg_catalog.hashtext(v_candidate.channel || ':' || v_candidate.environment)
    ) then continue; end if;
    if exists (
      select 1 from sellerpilot_private.channel_gateway_jobs running
       where running.channel = v_candidate.channel
         and running.environment = v_candidate.environment and running.status = 'running'
    ) then continue; end if;
    v_job_id := v_candidate.id;
    exit;
  end loop;
  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.channel_gateway_jobs j
     set status = 'running', worker_token_id = v_token_id, claim_token = v_claim_token,
         attempt_count = j.attempt_count + 1,
         lease_expires_at = now() + interval '15 minutes',
         started_at = coalesce(j.started_at, now()), error_message = null, updated_at = now()
   where j.id = v_job_id and j.status = 'queued';
  if not found then return null; end if;

  select jsonb_build_object(
    'id', j.id, 'claim_token', j.claim_token, 'credential_id', j.credential_id,
    'channel', j.channel, 'operation', j.operation, 'environment', j.environment,
    'request', j.request_payload, 'attempt_count', j.attempt_count,
    'credential', d.decrypted_secret::jsonb, 'seller_account_key', c.seller_account_key
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where j.id = v_job_id and c.status = 'active';
  if v_result is null then
    raise exception 'LOCAL_READ_CREDENTIAL_UNAVAILABLE';
  end if;
  return v_result;
end
$function$;

revoke all on function sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)
  from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
