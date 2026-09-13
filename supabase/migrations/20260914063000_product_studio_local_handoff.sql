-- Continue an exact failed Gateway attempt through the existing local Studio
-- worker without creating another job or changing its source/result lineage.
-- Definition baseline verified against production and 20260830122000.
begin;

do $$
begin
  if (select md5(prosrc) from pg_proc
       where oid = 'public.sellerpilot_claim_product_ai_job(text,text)'::regprocedure)
       is distinct from '4b38e0cf4b6cb006dbb6b35a48ee9af4' then
    raise exception 'product studio claimer definition drifted before local handoff migration';
  end if;
end;
$$;

create or replace function public.sellerpilot_claim_product_ai_job(
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
  v_running_jobs integer;
  v_result jsonb;
  v_context jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  select token.id
    into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'ai'
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

  -- Claims from different Vercel invocations and temporarily overlapping AI
  -- tokens must share one admission decision. Completion never takes this lock:
  -- a concurrent completion can only free capacity, never exceed the bound.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065061);

  update sellerpilot_private.ai_cli_jobs job
     set status = case when job.attempt_count >= 3 then 'failed' else 'queued' end,
         error_message = case
           when job.attempt_count >= 3 then 'CLI worker lease expired three times.'
           else job.error_message
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
           else job.completed_at
         end,
         updated_at = clock_timestamp()
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running'
     and job.lease_expires_at < clock_timestamp();

  select count(*)::integer
    into v_running_jobs
    from sellerpilot_private.ai_cli_jobs job
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'running';
  -- One Studio job already owns three independent three-wide remote lanes, so
  -- admitting a second job would exceed the verified nine-call process bound.
  if v_running_jobs >= 1 then return null; end if;

  select job.id
    into v_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.kind in ('product_studio', 'product_asset_regeneration')
     and job.status = 'queued'
     -- Both Mac and Vercel use this RPC. Only Vercel must skip a job explicitly
     -- handed to the existing local worker; keep the shared one-job bound.
     and (coalesce(p_worker_version, '') not like 'sellerpilot-vercel-product-studio/%'
          or coalesce(job.request_payload->>'studio_runtime', '') <> 'local')
     and job.available_at <= clock_timestamp()
   order by job.available_at, job.created_at
   for update skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.ai_cli_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '15 minutes',
         available_at = clock_timestamp(),
         started_at = coalesce(job.started_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.status = 'queued';
  if not found then
    raise exception 'product AI job claim lost its row lock';
  end if;

  insert into sellerpilot_private.ai_cli_audit (
    action, worker_token_id, job_id, safe_detail
  ) values (
    'job_claimed',
    v_token_id,
    v_job_id,
    jsonb_build_object(
      'worker_version', left(coalesce(p_worker_version, ''), 80),
      'claim_scope', 'product'
    )
  );

  select jsonb_build_object(
           'id', job.id,
           'owner_id', job.created_by,
           'claim_token', job.claim_token,
           'kind', job.kind,
           'request', job.request_payload,
           'attempt_count', job.attempt_count,
           'claim_scope', 'product',
           'revision_fallback_authorized', exists (
             select 1
               from sellerpilot_private.product_ai_revisions revision
              where job.kind = 'product_studio'
                and revision.job_id = job.id
                and revision.status = 'pending'
                and revision.actor_user_id = job.created_by
                and job.request_payload @> jsonb_build_object(
                  'revision_product_id', revision.product_id,
                  'revision_base_ai_job_id', revision.base_ai_job_id,
                  'revision_base_product_updated_at', revision.base_product_updated_at,
                  'revision_mode', 'replace_product_assets',
                  'auto_publish', false
                )
           )
         ),
         job.terminal_image_failure_context
    into v_result, v_context
    from sellerpilot_private.ai_cli_jobs job
   where job.id = v_job_id
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = v_claim_token;
  if not found then
    raise exception 'claimed product AI job ownership mismatch';
  end if;
  if v_context is not null then
    v_result := v_result || jsonb_build_object(
      'terminal_image_failure_context', v_context
    );
  end if;
  return v_result;
end;
$$;

create function public.sellerpilot_handoff_product_studio_to_local(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_owner_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job record;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'ai'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  if p_job_id is null or p_claim_token is null or p_owner_id is null
     or coalesce(p_reason, '') not in (
       'gateway_forbidden', 'gateway_authentication_error',
       'gateway_billing_required', 'gateway_customer_verification_required',
       'gateway_rate_limited'
     ) then return false; end if;

  -- AI worker credentials are intentionally shared by administrator-owned jobs.
  -- The immutable job owner, active worker and exact lease/claim identify the
  -- transfer; token.created_by and token.last_version are not job ownership.
  select job.request_payload into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
     and job.created_by = p_owner_id
     and job.kind = 'product_studio'
     and job.request_payload @> '{"reuse_first_draft_assets":true}'::jsonb
     and not (job.request_payload ?| array['revision_product_id', 'revision_base_ai_job_id', 'revision_mode'])
     and not exists (select 1 from sellerpilot_private.product_ai_revisions revision where revision.job_id = job.id)
     and job.status = 'running'
     and job.worker_token_id = v_token_id
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and job.result_payload is null
     and coalesce(job.request_payload->>'studio_runtime', '') <> 'local'
   for update;
  if not found then return false; end if;

  update sellerpilot_private.ai_cli_jobs
     set status = 'queued',
         request_payload = jsonb_set(v_job.request_payload, '{studio_runtime}', '"local"'::jsonb, true),
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         available_at = clock_timestamp(),
         completed_at = null,
         error_message = p_reason,
         updated_at = clock_timestamp()
   where id = p_job_id;
  -- Keep attempt_count, existing source paths, receipts, result and terminal
  -- context unchanged. The next Mac claim obtains a fresh claim token.
  insert into sellerpilot_private.ai_cli_audit (action, worker_token_id, job_id, safe_detail)
  values ('job_retried', v_token_id, p_job_id, jsonb_build_object(
    'reason', p_reason, 'handoff', 'server-to-local', 'previous_claim_token', p_claim_token
  ));
  return true;
end;
$$;

revoke all on function public.sellerpilot_claim_product_ai_job(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_product_ai_job(text, text) to service_role;
revoke all on function public.sellerpilot_handoff_product_studio_to_local(text, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_handoff_product_studio_to_local(text, uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
