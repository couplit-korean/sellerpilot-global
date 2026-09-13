-- A fresh administrator-approved grant may supersede an uncertain older grant
-- only after the new same-seller credential and normal completion receipt exist.
-- Never replay an old code, invent a provider outcome, or clear a listing write.
begin;

do $$
begin
  if md5(pg_get_functiondef('public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)'::regprocedure))
      <> 'c55863b99dd2f95fce035c79c91d1fdf' then
    raise exception 'eBay fresh OAuth predecessor changed';
  end if;
end $$;

create table sellerpilot_private.ebay_fresh_oauth_sessions (
  job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
  source_credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  source_version integer not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[A-F0-9]{12}$'),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  source_subject_sha256 text not null check (source_subject_sha256 ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id),
  code_fingerprint text not null unique check (code_fingerprint ~ '^[a-f0-9]{64}$'),
  include_messages boolean not null,
  superseded_job_ids uuid[] not null,
  created_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  new_credential_id uuid references sellerpilot_private.channel_credentials(id)
);
alter table sellerpilot_private.ebay_fresh_oauth_sessions enable row level security;
revoke all on sellerpilot_private.ebay_fresh_oauth_sessions from public, anon, authenticated, service_role;

create function public.sellerpilot_service_claim_ebay_fresh_oauth(
  p_token_hash text, p_release_id text, p_actor_id uuid,
  p_credential_id uuid, p_code text, p_include_messages boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_worker_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_claim_token uuid := gen_random_uuid();
  v_code_fingerprint text;
  v_secret jsonb;
  v_request jsonb;
  v_vault_id uuid;
  v_runtime jsonb;
  v_blocker record;
  v_blockers uuid[] := '{}';
  v_existing record;
begin
  if auth.role() is distinct from 'service_role'
      or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
      or coalesce(p_release_id, '') !~ '^[a-f0-9]{40}$'
      or p_actor_id is null or p_credential_id is null
      or length(coalesce(trim(p_code), '')) not between 8 and 8000
      or p_include_messages is null then
    raise exception 'invalid fresh eBay authorization' using errcode = '42501';
  end if;
  if not exists (select 1 from sellerpilot_private.admin_users where user_id=p_actor_id) then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(193674993, 821065042);
  perform pg_advisory_xact_lock(hashtext('sellerpilot:ebay:production'));
  v_runtime := public.sellerpilot_service_serverless_cs_wakeup_status();
  if v_runtime->>'activeRelease' is distinct from p_release_id
      or v_runtime->'active' is distinct from 'true'::jsonb then
    return jsonb_build_object('status','runtime_unavailable');
  end if;
  select id into v_worker_id from sellerpilot_private.ai_cli_worker_tokens
   where token_hash=p_token_hash and scope='serverless_cs'
     and status='active' and expires_at>clock_timestamp() for update;
  if v_worker_id is null then raise exception 'active serverless worker required' using errcode='42501'; end if;

  v_code_fingerprint := encode(extensions.digest(
    jsonb_build_object('channel','ebay','code',trim(p_code))::text,'sha256'),'hex');
  -- Check every incarnation, including historical jobs created before this path.
  select id,status into v_existing from sellerpilot_private.channel_gateway_jobs
   where channel='ebay' and operation='oauth.exchange'
     and oauth_request_fingerprint=v_code_fingerprint order by created_at limit 1;
  if found then
    return jsonb_build_object('status','already_submitted','jobId',v_existing.id,'jobStatus',v_existing.status,
      'finalized',exists(select 1 from sellerpilot_private.ebay_fresh_oauth_sessions s
        join sellerpilot_private.gateway_completion_receipts r on r.job_id=s.job_id
        where s.job_id=v_existing.id and s.finalized_at is not null
          and s.source_credential_id=p_credential_id and s.actor_id=p_actor_id));
  end if;
  select * into v_credential from sellerpilot_private.channel_credentials
   where id=p_credential_id and channel='ebay' and environment='production'
     and status='active' and seller_account_key_source='provider_certified_v1'
     and seller_account_key is not null and seller_account_verified_at is not null
   for update;
  if not found then return jsonb_build_object('status','source_unavailable'); end if;
  select decrypted_secret::jsonb into v_secret from vault.decrypted_secrets where id=v_credential.vault_secret_id;
  if coalesce(v_secret->>'provider_account_subject','') not like 'ebay:eias:%'
      or length(coalesce(v_secret->>'client_id',''))<3
      or length(coalesce(v_secret->>'client_secret',''))<3 then
    return jsonb_build_object('status','source_unavailable');
  end if;
  -- All older uncertainties stay intact during token exchange. The only
  -- admissible barrier is a same-owner/seller terminal OAuth without a token
  -- snapshot or prepared successor. Other uncertainty still requires recovery.
  for v_blocker in
    select j.* from sellerpilot_private.channel_gateway_jobs j
     where j.channel='ebay' and j.environment='production'
       and (j.status='running'
         or (j.status='queued' and j.operation='oauth.exchange')
         or (j.status='reconciliation_required' and
           (j.credential_refresh_in_flight or j.credential_refresh_recovery_vault_id is not null
             or (j.operation='oauth.exchange' and j.prepared_credential_id is not null and not j.oauth_exchange_completed)
             or j.provider_mutation_started_at is not null)))
     for update
  loop
    if v_blocker.status is distinct from 'reconciliation_required'
      or v_blocker.operation is distinct from 'oauth.exchange'
      or v_blocker.created_by is distinct from v_credential.created_by
      or v_blocker.seller_account_key is distinct from v_credential.seller_account_key
      or v_blocker.credential_id is distinct from v_credential.id
      or v_blocker.attempt_id is not null or v_blocker.listing_id is not null
      or v_blocker.provider_mutation_started_at is not null
      or v_blocker.credential_refresh_recovery_vault_id is not null
      or v_blocker.prepared_credential_id is not null
      or v_blocker.response_payload is not null or v_blocker.oauth_exchange_completed
      or not exists (select 1 from sellerpilot_private.gateway_completion_receipts where job_id=v_blocker.id) then
      return jsonb_build_object('status','other_uncertainty_pending');
    end if;
    v_blockers := array_append(v_blockers,v_blocker.id);
  end loop;
  v_request := jsonb_build_object('code',trim(p_code),'includeMessages',p_include_messages);
  select vault.create_secret(v_request::text,
    'sellerpilot_ebay_fresh_oauth_'||v_job_id::text,
    'Single-use claim-bound eBay authorization. Never expose to logs.') into v_vault_id;
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,channel,operation,environment,request_payload,
    oauth_request_vault_id,oauth_request_fingerprint,oauth_source_credential_id,
    created_by,status,worker_token_id,claim_token,attempt_count,started_at,lease_expires_at
  ) values (v_job_id,v_credential.id,'ebay','oauth.exchange','production',
    jsonb_build_object('vaultBacked',true),v_vault_id,v_code_fingerprint,v_credential.id,
    v_credential.created_by,'running',v_worker_id,v_claim_token,1,clock_timestamp(),clock_timestamp()+interval '3 minutes');
  insert into sellerpilot_private.ebay_fresh_oauth_sessions (
    job_id,source_credential_id,source_version,source_fingerprint,seller_account_key,
    source_subject_sha256,actor_id,code_fingerprint,include_messages,superseded_job_ids
  ) values (v_job_id,v_credential.id,v_credential.version,v_credential.fingerprint,
    v_credential.seller_account_key,encode(extensions.digest(v_secret->>'provider_account_subject','sha256'),'hex'),
    p_actor_id,v_code_fingerprint,p_include_messages,v_blockers);
  update sellerpilot_private.ai_cli_worker_tokens set last_seen_at=clock_timestamp(),
    last_version='sellerpilot-vercel-gateway/2.0+'||p_release_id where id=v_worker_id;
  return jsonb_build_object('status','claimed','job',jsonb_build_object(
    'id',v_job_id,'claim_token',v_claim_token,'credential_id',v_credential.id,
    'channel','ebay','operation','oauth.exchange','environment','production',
    'request',v_request,'credential',v_secret,'attempt_count',1,
    'seller_account_key',v_credential.seller_account_key));
end $$;

alter function public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)
  rename to sellerpilot_130520_prepare_before_ebay_fresh;
revoke all on function public.sellerpilot_130520_prepare_before_ebay_fresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_prepare_gateway_credential_refresh(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_secret_payload jsonb,
  p_expires_at timestamptz default null,p_recovery_only boolean default false,p_oauth_complete boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session sellerpilot_private.ebay_fresh_oauth_sessions%rowtype;
begin
  select * into v_session from sellerpilot_private.ebay_fresh_oauth_sessions where job_id=p_job_id;
  if found and not coalesce(p_recovery_only,false) then
    if p_oauth_complete is distinct from true
      or p_secret_payload is null
      or encode(extensions.digest(p_secret_payload->>'provider_account_subject','sha256'),'hex')
        is distinct from v_session.source_subject_sha256
      or (v_session.include_messages and not (
        string_to_array(coalesce(p_secret_payload->>'scopes',''),' ') @>
        array['https://api.ebay.com/oauth/api_scope/commerce.message'])) then
      raise exception 'fresh eBay same-seller authorization proof required' using errcode='42501';
    end if;
  end if;
  return public.sellerpilot_130520_prepare_before_ebay_fresh(
    p_token_hash,p_job_id,p_claim_token,p_secret_payload,p_expires_at,p_recovery_only,p_oauth_complete);
end $$;

create function public.sellerpilot_service_finalize_ebay_fresh_oauth(p_token_hash text,p_job_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_session sellerpilot_private.ebay_fresh_oauth_sessions%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_new sellerpilot_private.channel_credentials%rowtype;
  v_secret jsonb;
  v_old_id uuid;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(193674993,821065042);
  select * into v_session from sellerpilot_private.ebay_fresh_oauth_sessions where job_id=p_job_id for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  -- Terminal jobs intentionally clear their lease owner. The immutable receipt
  -- retains the exact finishing worker/claim and is authoritative after finish.
  select j.* into v_job from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.gateway_completion_receipts r on r.job_id=j.id and r.claim_token=p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens t on t.id=r.worker_token_id
   where j.id=p_job_id and t.token_hash=p_token_hash
    and t.scope='serverless_cs' and t.status='active' and t.expires_at>clock_timestamp()
    and j.status='succeeded' and j.oauth_exchange_completed
    and not j.credential_refresh_in_flight and j.credential_refresh_recovery_vault_id is null
    and j.prepared_credential_id=j.credential_id and j.response_payload->>'operation'='oauth.exchange'
    and j.response_payload->'ok'='true'::jsonb for update of j;
  if not found then return jsonb_build_object('status','completion_required'); end if;
  select * into v_new from sellerpilot_private.channel_credentials
   where id=v_job.credential_id and status='active' and channel='ebay'
    and seller_account_key=v_session.seller_account_key and seller_account_key_source='provider_certified_v1'
    and seller_account_verified_at is not null and version>v_session.source_version;
  if not found then return jsonb_build_object('status','same_seller_required'); end if;
  select decrypted_secret::jsonb into v_secret from vault.decrypted_secrets where id=v_new.vault_secret_id;
  if encode(extensions.digest(v_secret->>'provider_account_subject','sha256'),'hex') is distinct from v_session.source_subject_sha256 then
    return jsonb_build_object('status','same_seller_required');
  end if;
  if v_session.finalized_at is not null then
    return jsonb_build_object('status','finalized','credentialId',v_session.new_credential_id,'reused',true);
  end if;
  foreach v_old_id in array v_session.superseded_job_ids loop
    update sellerpilot_private.channel_gateway_jobs set status='cancelled',
      credential_refresh_in_flight=false,credential_refresh_started_at=null,
      error_message='Superseded by a completed fresh same-seller authorization; prior exchange outcome remains unknown.',
      updated_at=clock_timestamp()
     where id=v_old_id and status='reconciliation_required' and operation='oauth.exchange' and channel='ebay'
      and credential_id=v_session.source_credential_id and seller_account_key=v_session.seller_account_key
      and prepared_credential_id is null and credential_refresh_recovery_vault_id is null
      and provider_mutation_started_at is null and response_payload is null and not oauth_exchange_completed
      and attempt_id is null and listing_id is null;
    if not found then raise exception 'prior eBay authorization changed; preserve all uncertainties'; end if;
    v_count := v_count+1;
  end loop;
  update sellerpilot_private.ebay_fresh_oauth_sessions set finalized_at=clock_timestamp(),new_credential_id=v_new.id where job_id=p_job_id;
  return jsonb_build_object('status','finalized','credentialId',v_new.id,'superseded',v_count,'reused',false);
end $$;

-- Keep supersession in the completion transaction even if the HTTP callback
-- response is lost. The explicit finalization RPC also supports safe readback.
create function sellerpilot_private.finalize_ebay_fresh_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_token_hash text; v_result jsonb;
begin
  if exists (select 1 from sellerpilot_private.ebay_fresh_oauth_sessions s
      join sellerpilot_private.channel_gateway_jobs j on j.id=s.job_id
      where s.job_id=new.job_id and j.status='succeeded') then
    select token_hash into v_token_hash from sellerpilot_private.ai_cli_worker_tokens where id=new.worker_token_id;
    v_result:=public.sellerpilot_service_finalize_ebay_fresh_oauth(v_token_hash,new.job_id,new.claim_token);
    if v_result->>'status' is distinct from 'finalized' then
      raise exception 'fresh eBay receipt could not finalize same-seller authorization';
    end if;
  end if;
  return new;
end $$;
revoke all on function sellerpilot_private.finalize_ebay_fresh_receipt() from public,anon,authenticated,service_role;
create trigger finalize_ebay_fresh_oauth_after_receipt after insert
  on sellerpilot_private.gateway_completion_receipts for each row
  execute function sellerpilot_private.finalize_ebay_fresh_receipt();

revoke all on function public.sellerpilot_service_claim_ebay_fresh_oauth(text,text,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_finalize_ebay_fresh_oauth(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_claim_ebay_fresh_oauth(text,text,uuid,uuid,text,boolean) to service_role;
grant execute on function public.sellerpilot_service_finalize_ebay_fresh_oauth(text,uuid,uuid) to service_role;
grant execute on function public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean) to service_role;
notify pgrst,'reload schema';
commit;
