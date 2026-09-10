-- Executable review draft only. This globally serializes refreshes for one
-- Shopee credential while allowing ordinary jobs for unrelated shops to run.
-- The provider POST is permitted only after the target-bound claim succeeds.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.ai_cli_worker_tokens') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)') is null
     or to_regprocedure('public.sellerpilot_service_begin_serverless_cs_credential_refresh(text,uuid,uuid)') is null
     or to_regprocedure('public.sellerpilot_service_prepare_serverless_cs_credential_refresh(text,uuid,uuid,jsonb,timestamp with time zone,boolean,boolean)') is null then
    raise exception 'SHOPEE_TARGET_REFRESH_CAS_PREIMAGE_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.cs_shopee_target_refresh_claims (
  credential_id uuid primary key references sellerpilot_private.channel_credentials(id) on delete cascade,
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete cascade,
  claim_token uuid not null,
  target_type text not null check (target_type in ('shop','merchant')),
  target_id text not null check (target_id ~ '^[1-9][0-9]{0,31}$'),
  base_credential_version integer not null check (base_credential_version > 0),
  status text not null check (status in ('active','recovery_preserved','prepared','conflict')),
  candidate_digest text check (candidate_digest is null or candidate_digest ~ '^[a-f0-9]{64}$'),
  preparation jsonb check (preparation is null or jsonb_typeof(preparation) = 'object'),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(job_id,claim_token,target_type,target_id)
);

alter table sellerpilot_private.cs_shopee_target_refresh_claims enable row level security;
revoke all on sellerpilot_private.cs_shopee_target_refresh_claims
  from public,anon,authenticated,service_role;

create function sellerpilot_private.shopee_target_refresh_merge_v1(
  p_base_payload jsonb,
  p_candidate_payload jsonb,
  p_target_type text,
  p_target_id text,
  p_recovery_only boolean default false
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_base_target jsonb;
  v_candidate_target jsonb;
  v_targets jsonb;
  v_result jsonb;
  v_target_key text;
begin
  if jsonb_typeof(p_base_payload) is distinct from 'object'
     or jsonb_typeof(p_candidate_payload) is distinct from 'object'
     or p_target_type not in ('shop','merchant')
     or coalesce(p_target_id,'') !~ '^[1-9][0-9]{0,31}$'
     or jsonb_typeof(p_base_payload->'shopee_targets') is distinct from 'array'
     or jsonb_typeof(p_candidate_payload->'shopee_targets') is distinct from 'array'
     or jsonb_array_length(p_base_payload->'shopee_targets') not between 1 and 8
     or jsonb_array_length(p_candidate_payload->'shopee_targets')
       is distinct from jsonb_array_length(p_base_payload->'shopee_targets')
     or octet_length(p_candidate_payload::text) > 32000 then
    raise exception 'SHOPEE_TARGET_REFRESH_PAYLOAD_INVALID' using errcode='22023';
  end if;

  if exists(
    select 1 from jsonb_array_elements(p_base_payload->'shopee_targets') entry(value)
     where jsonb_typeof(value) is distinct from 'object'
        or value->>'type' not in ('shop','merchant')
        or coalesce(value->>'id','') !~ '^[1-9][0-9]{0,31}$'
  ) or exists(
    select 1 from jsonb_array_elements(p_candidate_payload->'shopee_targets') entry(value)
     where jsonb_typeof(value) is distinct from 'object'
        or value->>'type' not in ('shop','merchant')
        or coalesce(value->>'id','') !~ '^[1-9][0-9]{0,31}$'
  ) or (select count(*) <> count(distinct ((value->>'type')||':'||(value->>'id')))
          from jsonb_array_elements(p_base_payload->'shopee_targets') entry(value))
     or (select count(*) <> count(distinct ((value->>'type')||':'||(value->>'id')))
          from jsonb_array_elements(p_candidate_payload->'shopee_targets') entry(value)) then
    raise exception 'SHOPEE_TARGET_REFRESH_TARGETS_INVALID' using errcode='22023';
  end if;

  select value into v_base_target
    from jsonb_array_elements(p_base_payload->'shopee_targets') entry(value)
   where value->>'type'=p_target_type and value->>'id'=p_target_id;
  select value into v_candidate_target
    from jsonb_array_elements(p_candidate_payload->'shopee_targets') entry(value)
   where value->>'type'=p_target_type and value->>'id'=p_target_id;
  if v_base_target is null or v_candidate_target is null
     or v_candidate_target-array['type','id','access_token','refresh_token','access_token_expires_at','refresh_token_expires_at'] <> '{}'::jsonb
     or length(coalesce(v_candidate_target->>'access_token','')) < 8
     or length(coalesce(v_candidate_target->>'refresh_token','')) < 8
     or length(coalesce(v_candidate_target->>'access_token_expires_at','')) < 20
     or length(coalesce(v_candidate_target->>'refresh_token_expires_at','')) < 20 then
    raise exception 'SHOPEE_TARGET_REFRESH_TARGET_INVALID' using errcode='22023';
  end if;

  if exists(
    select 1
      from jsonb_array_elements(p_base_payload->'shopee_targets') base(value)
      full join jsonb_array_elements(p_candidate_payload->'shopee_targets') candidate(value)
        on candidate.value->>'type'=base.value->>'type' and candidate.value->>'id'=base.value->>'id'
     where (coalesce(candidate.value->>'type',base.value->>'type')<>p_target_type
        or coalesce(candidate.value->>'id',base.value->>'id')<>p_target_id)
       and candidate.value is distinct from base.value
  ) then
    raise exception 'SHOPEE_TARGET_REFRESH_NON_TARGET_CHANGED' using errcode='23514';
  end if;

  -- Only the selected target mirrors and provider attestation may change.
  if (p_candidate_payload-array['shopee_targets','shop_id','merchant_id','access_token','refresh_token',
       'access_token_expires_at','refresh_token_expires_at','provider_account_subject',
       'provider_account_identity_version'])
       is distinct from
     (p_base_payload-array['shopee_targets','shop_id','merchant_id','access_token','refresh_token',
       'access_token_expires_at','refresh_token_expires_at','provider_account_subject',
       'provider_account_identity_version']) then
    raise exception 'SHOPEE_TARGET_REFRESH_CANDIDATE_WIDENED' using errcode='23514';
  end if;
  if p_candidate_payload->>'access_token' is distinct from v_candidate_target->>'access_token'
     or p_candidate_payload->>'refresh_token' is distinct from v_candidate_target->>'refresh_token'
     or p_candidate_payload->>'access_token_expires_at' is distinct from v_candidate_target->>'access_token_expires_at'
     or p_candidate_payload->>'refresh_token_expires_at' is distinct from v_candidate_target->>'refresh_token_expires_at' then
    raise exception 'SHOPEE_TARGET_REFRESH_MIRROR_INVALID' using errcode='23514';
  end if;
  v_target_key:=case when p_target_type='shop' then 'shop_id' else 'merchant_id' end;
  if p_candidate_payload->>v_target_key is distinct from p_target_id then
    raise exception 'SHOPEE_TARGET_REFRESH_MIRROR_INVALID' using errcode='23514';
  end if;

  select jsonb_agg(case when value->>'type'=p_target_type and value->>'id'=p_target_id
    then v_candidate_target else value end order by ordinal)
    into v_targets
    from jsonb_array_elements(p_base_payload->'shopee_targets') with ordinality entry(value,ordinal);
  v_result:=p_base_payload||jsonb_build_object(
    'shopee_targets',v_targets,v_target_key,p_target_id,
    'access_token',v_candidate_target->>'access_token',
    'refresh_token',v_candidate_target->>'refresh_token',
    'access_token_expires_at',v_candidate_target->>'access_token_expires_at',
    'refresh_token_expires_at',v_candidate_target->>'refresh_token_expires_at'
  );
  v_result:=v_result-case when p_target_type='shop' then 'merchant_id' else 'shop_id' end;
  if p_recovery_only then
    v_result:=v_result-array['provider_account_subject','provider_account_identity_version'];
  elsif p_candidate_payload ? 'provider_account_subject'
        and p_candidate_payload ? 'provider_account_identity_version' then
    v_result:=v_result||jsonb_build_object(
      'provider_account_subject',p_candidate_payload->>'provider_account_subject',
      'provider_account_identity_version',p_candidate_payload->>'provider_account_identity_version'
    );
  end if;
  return v_result;
end $$;

create function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_target_type text,p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_existing sellerpilot_private.cs_shopee_target_refresh_claims%rowtype;
  v_payload jsonb;
  v_inserted boolean:=false;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(p_token_hash,p_job_id,p_claim_token,true)
     or p_target_type not in ('shop','merchant')
     or coalesce(p_target_id,'') !~ '^[1-9][0-9]{0,31}$' then
    return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','ownership_lost');
  end if;
  select job.credential_id,credential.version,credential.vault_secret_id,decrypted.decrypted_secret::jsonb payload
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential on credential.id=job.credential_id
      and credential.channel='shopee' and credential.status='active'
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
   for update of job,credential;
  if not found then
    return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','conflict');
  end if;
  v_payload:=v_job.payload;
  if not exists(select 1 from jsonb_array_elements(v_payload->'shopee_targets') entry(value)
    where value->>'type'=p_target_type and value->>'id'=p_target_id) then
    return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','target_missing');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('sellerpilot:shopee-target-refresh:'||v_job.credential_id::text));
  select claim.* into v_existing from sellerpilot_private.cs_shopee_target_refresh_claims claim
   where claim.credential_id=v_job.credential_id for update;
  if found and v_existing.status in ('active','recovery_preserved')
     and v_existing.lease_expires_at>clock_timestamp()
     and (v_existing.job_id<>p_job_id or v_existing.claim_token<>p_claim_token
       or v_existing.target_type<>p_target_type or v_existing.target_id<>p_target_id) then
    return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','busy',
      'targetType',p_target_type,'targetId',p_target_id,'baseVersion',v_job.version);
  end if;
  if found and v_existing.job_id=p_job_id and v_existing.claim_token=p_claim_token
     and v_existing.target_type=p_target_type and v_existing.target_id=p_target_id
     and v_existing.status='active' and v_existing.lease_expires_at>clock_timestamp() then
    return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','reused',
      'targetType',p_target_type,'targetId',p_target_id,'baseVersion',v_existing.base_credential_version);
  end if;
  insert into sellerpilot_private.cs_shopee_target_refresh_claims(
    credential_id,job_id,claim_token,target_type,target_id,base_credential_version,status,lease_expires_at
  ) values(v_job.credential_id,p_job_id,p_claim_token,p_target_type,p_target_id,v_job.version,'active',clock_timestamp()+interval '5 minutes')
  on conflict(credential_id) do update set job_id=excluded.job_id,claim_token=excluded.claim_token,
    target_type=excluded.target_type,target_id=excluded.target_id,base_credential_version=excluded.base_credential_version,
    status='active',candidate_digest=null,preparation=null,lease_expires_at=excluded.lease_expires_at,
    updated_at=clock_timestamp();
  v_inserted:=true;
  if public.sellerpilot_service_begin_serverless_cs_credential_refresh(p_token_hash,p_job_id,p_claim_token) is not true then
    update sellerpilot_private.cs_shopee_target_refresh_claims set status='conflict',updated_at=clock_timestamp()
     where credential_id=v_job.credential_id and job_id=p_job_id and claim_token=p_claim_token;
    return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','conflict');
  end if;
  return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1',
    'status',case when v_inserted then 'acquired' else 'reused' end,
    'targetType',p_target_type,'targetId',p_target_id,'baseVersion',v_job.version);
end $$;

create function public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_target_type text,p_target_id text,
  p_candidate_payload jsonb,p_expires_at timestamptz default null,
  p_recovery_only boolean default false,p_oauth_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim sellerpilot_private.cs_shopee_target_refresh_claims%rowtype;
  v_job record;
  v_candidate_digest text;
  v_merged jsonb;
  v_preparation jsonb;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(p_token_hash,p_job_id,p_claim_token,true) then return null; end if;
  select claim.* into v_claim from sellerpilot_private.cs_shopee_target_refresh_claims claim
   where claim.job_id=p_job_id and claim.claim_token=p_claim_token
     and claim.target_type=p_target_type and claim.target_id=p_target_id
     and claim.status in ('active','recovery_preserved') and claim.lease_expires_at>clock_timestamp()
   for update;
  if not found then return jsonb_build_object('status','conflict'); end if;
  select job.credential_id,credential.version,decrypted.decrypted_secret::jsonb payload into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential on credential.id=job.credential_id
      and credential.channel='shopee' and credential.status='active'
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where job.id=p_job_id and job.claim_token=p_claim_token and job.status='running'
   for update of job,credential;
  if not found or v_job.credential_id<>v_claim.credential_id or v_job.version<>v_claim.base_credential_version then
    update sellerpilot_private.cs_shopee_target_refresh_claims set status='conflict',updated_at=clock_timestamp()
     where credential_id=v_claim.credential_id;
    return jsonb_build_object('status','conflict');
  end if;
  v_merged:=sellerpilot_private.shopee_target_refresh_merge_v1(
    v_job.payload,p_candidate_payload,p_target_type,p_target_id,p_recovery_only);
  v_candidate_digest:=encode(extensions.digest(convert_to(v_merged::text,'UTF8'),'sha256'),'hex');
  v_preparation:=public.sellerpilot_service_prepare_serverless_cs_credential_refresh(
    p_token_hash,p_job_id,p_claim_token,v_merged,p_expires_at,p_recovery_only,p_oauth_complete);
  if coalesce(v_preparation->>'status','') not in ('prepared','recovery_preserved') then
    update sellerpilot_private.cs_shopee_target_refresh_claims set status='conflict',
      candidate_digest=v_candidate_digest,preparation=v_preparation,updated_at=clock_timestamp()
     where credential_id=v_claim.credential_id;
    return v_preparation;
  end if;
  update sellerpilot_private.cs_shopee_target_refresh_claims set
    status=case when p_recovery_only then 'recovery_preserved' else 'prepared' end,
    candidate_digest=v_candidate_digest,preparation=v_preparation,
    lease_expires_at=case when p_recovery_only then clock_timestamp()+interval '5 minutes' else clock_timestamp() end,
    updated_at=clock_timestamp()
   where credential_id=v_claim.credential_id and job_id=p_job_id and claim_token=p_claim_token;
  return v_preparation||jsonb_build_object('targetType',p_target_type,'targetId',p_target_id,
    'baseVersion',v_claim.base_credential_version,'payloadDigest',v_candidate_digest);
end $$;

revoke all on function sellerpilot_private.shopee_target_refresh_merge_v1(jsonb,jsonb,text,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)
  to service_role;
revoke all on function public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text,jsonb,timestamptz,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text,jsonb,timestamptz,boolean,boolean)
  to service_role;

commit;
