-- Same research job and completion contract, with a token-bound Mac fallback.
begin;
create table sellerpilot_private.local_product_research_bindings (
 job_id uuid not null references sellerpilot_private.ai_cli_jobs(id) on delete cascade,
 claim_token uuid not null,
 worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
 primary key(job_id, claim_token)
);
revoke all on sellerpilot_private.local_product_research_bindings from public, anon, authenticated;
CREATE OR REPLACE FUNCTION sellerpilot_private.claim_product_research_runtime(p_worker_version text, p_runtime text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_result jsonb;
begin

  -- Recover any expired product_research lease, including a desktop claim
  -- left behind during cutover. The old claim nonce is cleared before this
  -- function can assign a new one, so a late desktop completion stays fenced.
  with expired as (
    update sellerpilot_private.ai_cli_jobs job
       set status = case when job.attempt_count >= 3 then 'failed' else 'queued' end,
           result_payload = null,
           error_message = case
             when job.attempt_count >= 3 then 'Server product research lease expired three times.'
             else null
           end,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           available_at = case
             when job.attempt_count >= 3 then job.available_at
             else clock_timestamp()
           end,
           completed_at = case
             when job.attempt_count >= 3 then clock_timestamp()
             else null
           end,
           updated_at = clock_timestamp()
     where job.kind = 'product_research'
       and job.status = 'running'
       and job.lease_expires_at <= clock_timestamp()
    returning job.id, job.status, job.attempt_count
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  )
  select
    case when expired.status = 'failed' then 'job_failed' else 'job_retried' end,
    expired.id,
    jsonb_build_object(
      'source', 'vercel_product_research',
      'reason', 'lease_expired',
      'attempt_count', expired.attempt_count,
      'terminal', expired.status = 'failed'
    )
  from expired;

  delete from sellerpilot_private.server_product_research_claims claim
   where not exists (
     select 1
       from sellerpilot_private.ai_cli_jobs job
      where job.id = claim.job_id
        and job.kind = 'product_research'
        and job.status = 'running'
        and job.worker_token_id is null
        and job.claim_token = claim.claim_token
        and job.lease_expires_at > clock_timestamp()
   );

  select job.id
    into v_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.kind = 'product_research'
     and job.status = 'queued'
     and coalesce(job.request_payload->>'research_runtime', 'vercel') = p_runtime
     and job.attempt_count < 3
     and job.available_at <= clock_timestamp()
   order by job.available_at, job.created_at
   for update skip locked
   limit 1;

  if v_job_id is null then return null; end if;

  insert into sellerpilot_private.server_product_research_claims (
    job_id, claim_token, claimed_at, lease_expires_at
  ) values (
    v_job_id,
    v_claim_token,
    clock_timestamp(),
    clock_timestamp() + interval '15 minutes'
  )
  on conflict (job_id) do update
    set claim_token = excluded.claim_token,
        claimed_at = excluded.claimed_at,
        lease_expires_at = excluded.lease_expires_at;

  update sellerpilot_private.ai_cli_jobs job
     set status = 'running',
         worker_token_id = null,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         available_at = clock_timestamp(),
         started_at = coalesce(job.started_at, clock_timestamp()),
         completed_at = null,
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.kind = 'product_research'
     and job.status = 'queued';
  if not found then
    raise exception 'server product research claim lost its row lock';
  end if;

  update sellerpilot_private.server_product_research_claims claim
     set lease_expires_at = (
       select job.lease_expires_at
         from sellerpilot_private.ai_cli_jobs job
        where job.id = v_job_id
     )
   where claim.job_id = v_job_id
     and claim.claim_token = v_claim_token;

  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  ) values (
    'job_claimed',
    v_job_id,
    jsonb_build_object(
      'source', 'vercel_product_research',
      'worker_version', left(coalesce(p_worker_version, ''), 80),
      'claim_scope', 'product_research'
    )
  );

  select jsonb_build_object(
    'id', job.id,
    'claim_token', job.claim_token,
    'kind', job.kind,
    'request', job.request_payload,
    'attempt_count', job.attempt_count,
    'claim_scope', 'server_product_research'
  )
    into v_result
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_job_id
     and job.status = 'running'
     and job.worker_token_id is null
     and job.claim_token = v_claim_token;
  if not found then
    raise exception 'server product research claim ownership mismatch';
  end if;
  return v_result;
end;
$function$
;
revoke all on function sellerpilot_private.claim_product_research_runtime(text,text) from public,anon,authenticated;
create or replace function public.sellerpilot_service_claim_product_research_ai_job(p_worker_version text default null)
returns jsonb language sql security definer set search_path='' as $$
 select sellerpilot_private.claim_product_research_runtime(p_worker_version, 'vercel');
$$;
CREATE OR REPLACE FUNCTION public.sellerpilot_service_release_product_research_ai_job(p_job_id uuid, p_claim_token uuid, p_safe_reason text, p_terminal boolean DEFAULT false, p_retry_after_seconds integer DEFAULT 60)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job record;
  v_receipt record;
  v_safe_reason text := lower(trim(coalesce(p_safe_reason, '')));
  v_retry_after_seconds integer := greatest(30, least(coalesce(p_retry_after_seconds, 60), 900));
  v_terminal boolean;
  v_handoff boolean;
  v_error_message text;
  v_fingerprint text;
begin
  if p_job_id is null or p_claim_token is null then return 'ownership_lost'; end if;
  if v_safe_reason !~ '^[a-z][a-z0-9_]{1,79}$' then
    raise exception 'invalid safe reason';
  end if;
  v_error_message := left('Server product research failed: ' || v_safe_reason, 500);
  v_fingerprint := sellerpilot_private.ai_completion_fingerprint(
    'failed',
    null,
    v_error_message
      || ':requested_terminal=' || coalesce(p_terminal, false)::text
      || ':retry_after_seconds=' || v_retry_after_seconds::text
  );

  select job.kind, job.status, job.worker_token_id, job.claim_token,
         job.lease_expires_at, job.attempt_count, job.request_payload
    into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
   for update;
  if not found then return 'ownership_lost'; end if;

  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.server_product_research_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token;
  if found then
    return case
      when v_receipt.status in ('queued', 'failed')
       and v_receipt.completion_fingerprint = v_fingerprint then v_receipt.status
      else 'ownership_lost'
    end;
  end if;

  if v_job.kind <> 'product_research'
     or v_job.status <> 'running'
     or v_job.worker_token_id is not null
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_expires_at <= clock_timestamp()
     or not exists (
       select 1
         from sellerpilot_private.server_product_research_claims claim
        where claim.job_id = p_job_id
          and claim.claim_token = p_claim_token
          and claim.lease_expires_at > clock_timestamp()
     ) then
    return 'ownership_lost';
  end if;

  v_handoff := coalesce(v_job.request_payload->>'research_runtime', 'vercel') = 'vercel'
    and v_safe_reason in ('gateway_rate_limited', 'gateway_billing_required', 'gateway_forbidden', 'gateway_authentication_error');
  v_terminal := (coalesce(p_terminal, false) and not v_handoff) or v_job.attempt_count >= 3;
  update sellerpilot_private.ai_cli_jobs job
     set status = case when v_terminal then 'failed' else 'queued' end,
         result_payload = null,
         request_payload = job.request_payload || jsonb_build_object(
           'research_runtime', case when v_handoff then 'local' else coalesce(job.request_payload->>'research_runtime', 'vercel') end,
           'research_retry_reason', v_safe_reason),
         error_message = v_error_message,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = case
           when v_terminal then job.available_at
           else clock_timestamp() + (v_retry_after_seconds * interval '1 second')
         end,
         completed_at = case when v_terminal then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where job.id = p_job_id;

  insert into sellerpilot_private.server_product_research_completion_receipts (
    job_id, claim_token, status, completion_fingerprint
  ) values (
    p_job_id,
    p_claim_token,
    case when v_terminal then 'failed' else 'queued' end,
    v_fingerprint
  );
  delete from sellerpilot_private.server_product_research_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token;
  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  ) values (
    case when v_terminal then 'job_failed' else 'job_retried' end,
    p_job_id,
    jsonb_build_object(
      'source', 'vercel_product_research',
      'reason', v_safe_reason,
      'retry_after_seconds', case when v_terminal then 0 else v_retry_after_seconds end,
      'attempt_count', v_job.attempt_count,
      'terminal', v_terminal
    )
  );
  return case when v_terminal then 'failed' else 'queued' end;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sellerpilot_get_ai_job(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', job.id,
    'kind', job.kind,
    'status', job.status,
    'result', job.result_payload,
    'error', job.error_message,
    'attempt_count', job.attempt_count,
    'available_at', job.available_at,
    'research_runtime', coalesce(job.request_payload->>'research_runtime', 'vercel'),
    'created_at', job.created_at,
    'started_at', job.started_at,
    'completed_at', job.completed_at,
    'updated_at', job.updated_at
  ) into v_result
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id
     and (job.created_by = auth.uid() or job.kind = 'product_studio');
  return v_result;
end;
$function$
;
create or replace function public.sellerpilot_service_local_product_research(
 p_token_hash text, p_action text, p_arguments jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_token uuid; v_job uuid; v_claim uuid; v_result jsonb; v_request jsonb;
begin
 select id into v_token from sellerpilot_private.ai_cli_worker_tokens
 where token_hash=p_token_hash and scope='ai' and status='active' and expires_at>clock_timestamp();
 if v_token is null then raise exception 'invalid worker token' using errcode='42501'; end if;
 if p_action='claim' then
   perform pg_catalog.pg_advisory_xact_lock(193674993,821065062);
   if exists(select 1 from sellerpilot_private.ai_cli_jobs
      where kind='product_research' and status='running' and lease_expires_at>clock_timestamp()
        and request_payload->>'research_runtime'='local') then return null; end if;
   v_result := sellerpilot_private.claim_product_research_runtime(left(p_arguments->>'p_worker_version',80),'local');
   if v_result is null then return null; end if;
   insert into sellerpilot_private.local_product_research_bindings values
     ((v_result->>'id')::uuid,(v_result->>'claim_token')::uuid,v_token);
   update sellerpilot_private.ai_cli_worker_tokens set last_seen_at=clock_timestamp() where id=v_token;
   return v_result;
 end if;
 v_job := (p_arguments->>'p_job_id')::uuid;
 v_claim := (p_arguments->>'p_claim_token')::uuid;
 if not exists(select 1 from sellerpilot_private.local_product_research_bindings
   where job_id=v_job and claim_token=v_claim and worker_token_id=v_token) then
   raise exception 'research claim ownership mismatch' using errcode='42501';
 end if;
 if p_action='complete' then
   return to_jsonb(public.sellerpilot_service_complete_product_research_ai_job(v_job,v_claim,p_arguments->'p_result_payload'));
 elsif p_action='release' then
   return to_jsonb(public.sellerpilot_service_release_product_research_ai_job(v_job,v_claim,
     p_arguments->>'p_safe_reason',coalesce((p_arguments->>'p_terminal')::boolean,false),60));
 elsif p_action='touch' then
   return to_jsonb(public.sellerpilot_service_touch_product_research_ai_job(v_job,v_claim));
 elsif p_action='context' then
   select request_payload into v_request from sellerpilot_private.ai_cli_jobs
   where id=v_job and claim_token=v_claim and status='running' and worker_token_id is null
     and lease_expires_at>clock_timestamp();
   if v_request is null then raise exception 'research lease expired' using errcode='42501'; end if;
   return v_request;
 end if;
 raise exception 'invalid research action' using errcode='22023';
end; $$;
revoke all on function public.sellerpilot_service_local_product_research(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_local_product_research(text,text,jsonb) to service_role;
commit;
