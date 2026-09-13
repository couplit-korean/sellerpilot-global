-- Stage receipts preserve running gateway ownership until the central completion transaction.
-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_cs_shopee_target_refresh_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_begin_cs_shopee_target_refresh_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from '61c765d8d28d963731e901811e3cfe1c' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_gateway_provider_mutation';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_serverless_gateway_provider_mutation' and pg_get_function_identity_arguments(p.oid)='p_token_hash text, p_job_id uuid, p_claim_token uuid') is distinct from '12fa0281f16587f456d5d53e4b05f0ae' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_service_begin_serverless_gateway_provider_mutation';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_begin_shopee_sg_create_stage_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_begin_shopee_sg_create_stage_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_complete_shopee_sg_create_stage_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_complete_shopee_sg_create_stage_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_prepare_cs_shopee_target_refresh_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_prepare_cs_shopee_target_refresh_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_shopee_sg_create_resume_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_shopee_sg_create_resume_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_read_shopee_sg_create_stage_state_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_read_shopee_sg_create_stage_state_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_rebind_shopee_sg_successor_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_rebind_shopee_sg_successor_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_shopee_sg_global_create_readback_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_shopee_sg_global_create_readback_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='assert_shopee_sg_one_full_draft_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:assert_shopee_sg_one_full_draft_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='assert_shopee_sg_transport_bytes_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:assert_shopee_sg_transport_bytes_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='assert_shopee_sg_wh_elig_body_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:assert_shopee_sg_wh_elig_body_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='assert_shopee_sg_wh_list_body_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:assert_shopee_sg_wh_list_body_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='block_shopee_sg_global_create_receipt_change') then raise exception 'RECOVERY_ALREADY_DEFINED:block_shopee_sg_global_create_receipt_change';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='complete_shopee_sg_atomic_map_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:complete_shopee_sg_atomic_map_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='rebind_shopee_sg_successor_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:rebind_shopee_sg_successor_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_sg_create_execution_lineage_current_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_sg_create_execution_lineage_current_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_sg_create_job_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_sg_create_job_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_sg_create_stage_job_context_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_sg_create_stage_job_context_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_sg_current_vault_inc_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_sg_current_vault_inc_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_sg_r6_allow_receipt_rebind') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_sg_r6_allow_receipt_rebind';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_sg_r6_stage_begin_trg') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_sg_r6_stage_begin_trg';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='shopee_target_refresh_merge_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:shopee_target_refresh_merge_v1';end if;
end $recovery_guard$;
-- Reviewed source: 20260908142025_cs_shopee_target_refresh_cas.sql
-- Source SHA256: 7add4a60afbc68999b4a8a122f4b7e0903ac23eeba463f55338fc0c36d852eff
-- Executable review draft only. This globally serializes refreshes for one
-- Shopee credential while allowing ordinary jobs for unrelated shops to run.
-- The provider POST is permitted only after the target-bound claim succeeds.
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
     or (p_target_type in ('shop','merchant')) is not true
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
     or (p_target_type in ('shop','merchant')) is not true
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


-- Reviewed source: 20260909204000_shopee_exact_target_cache_receipt_v3.sql
-- Source SHA256: 1abe1c9651f0b0c41f043f3d04937a4521a2bd3518009a4a29a3a56333aa543f
do $target_cache_guard$ begin
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_list_channel_market_targets_v2') is distinct from '040e24c14986338ef5904af5a1b06fb0' then raise exception 'SHOPEE_TARGET_CACHE_PREIMAGE_DRIFT';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_upsert_shopee_market_target_v2') is distinct from 'e2f7f93cfe5f1bf0c7d4d5470bee122e' then raise exception 'SHOPEE_TARGET_CACHE_PREIMAGE_DRIFT';end if;
end $target_cache_guard$;
-- Preserve the credential version observed by the exact provider read. Joining
-- the current credential row at read time cannot prove when a cache row was
-- verified, and must not turn an old cache into current evidence.

do $$
begin
  if to_regclass('sellerpilot_private.channel_market_targets') is null
     or to_regprocedure('public.sellerpilot_list_channel_market_targets_v2(text)') is null
     or to_regprocedure('public.sellerpilot_service_upsert_shopee_market_target_v2(uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamp with time zone)') is null then
    raise exception 'SHOPEE_EXACT_TARGET_V2_PREIMAGE_REQUIRED';
  end if;
end $$;

alter table sellerpilot_private.channel_market_targets
  add column credential_version integer;
alter table sellerpilot_private.channel_market_targets
  add constraint channel_market_targets_credential_version_positive
  check (credential_version is null or credential_version > 0);

create or replace function public.sellerpilot_list_channel_market_targets_v2(p_channel text)
returns table (
  target_id text,
  display_name text,
  market_code text,
  locale text,
  language text,
  currency text,
  remote_status text,
  verified_at timestamptz,
  credential_id uuid,
  credential_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.target_id, t.display_name, t.market_code, t.locale, t.language,
         t.currency, t.remote_status, t.verified_at, t.credential_id,
         t.credential_version
    from sellerpilot_private.channel_market_targets t
    join sellerpilot_private.channel_credentials c on c.id = t.credential_id
   where public.sellerpilot_is_admin()
     and t.channel = p_channel
     and t.environment = 'production'
     and p_channel in ('shopee', 'lazada')
   order by t.market_code, t.display_name, t.target_id
$$;

alter function public.sellerpilot_service_upsert_shopee_market_target_v2(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) rename to sellerpilot_60909204000_upsert_shopee_target_v2_unsafe;

create function public.sellerpilot_service_upsert_shopee_market_target_v2(
  p_owner_id uuid,
  p_expected_credential_id uuid,
  p_expected_credential_version integer,
  p_target_id text,
  p_display_name text,
  p_market_code text,
  p_locale text,
  p_language text,
  p_currency text,
  p_remote_status text,
  p_provider_subject text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt jsonb;
  v_target_record_id uuid;
  v_updated integer;
begin
  v_receipt := public.sellerpilot_60909204000_upsert_shopee_target_v2_unsafe(
    p_owner_id,p_expected_credential_id,p_expected_credential_version,
    p_target_id,p_display_name,p_market_code,p_locale,p_language,p_currency,
    p_remote_status,p_provider_subject,p_observed_at
  );
  begin
    v_target_record_id := (v_receipt->>'targetRecordId')::uuid;
  exception when invalid_text_representation then
    raise exception 'SHOPEE_EXACT_TARGET_RECEIPT_INVALID' using errcode = '22023';
  end;
  if v_receipt->>'contractVersion' is distinct from '2'
     or v_receipt->>'credentialId' is distinct from p_expected_credential_id::text
     or (v_receipt->>'credentialVersion')::integer is distinct from p_expected_credential_version
     or v_receipt->>'targetId' is distinct from pg_catalog.btrim(p_target_id)
     or v_receipt->>'marketCode' is distinct from 'SG' then
    raise exception 'SHOPEE_EXACT_TARGET_RECEIPT_INVALID' using errcode = '22023';
  end if;
  update sellerpilot_private.channel_market_targets t
     set credential_version = p_expected_credential_version
   where t.id = v_target_record_id
     and t.owner_id = p_owner_id
     and t.credential_id = p_expected_credential_id
     and t.channel = 'shopee'
     and t.environment = 'production'
     and t.target_id = pg_catalog.btrim(p_target_id)
     and t.market_code = 'SG';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'SHOPEE_EXACT_TARGET_RECEIPT_STORE_FAILED' using errcode = '40001';
  end if;
  return v_receipt;
end;
$$;

revoke all on function public.sellerpilot_60909204000_upsert_shopee_target_v2_unsafe(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_upsert_shopee_market_target_v2(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_upsert_shopee_market_target_v2(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) to service_role;
revoke all on function public.sellerpilot_list_channel_market_targets_v2(text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_list_channel_market_targets_v2(text)
  to authenticated;


-- Reviewed source: 20260910013000_bind_shopee_sg_create_execution_lineage.sql
-- Source SHA256: 9337f176a1be2d9d7530018329df38111d957534a1a531dc2de790849e2c2185
-- Carry the exact credential-version/shop selection from the admin prepare
-- request to the last durable boundary before a Shopee provider mutation.
-- Queued jobs may otherwise be rebound to a later active credential by the
-- generic claim lifecycle, losing the version that passed the route check.

do $preimage$
begin
  if pg_catalog.to_regclass('sellerpilot_private.channel_market_targets') is null
     or not exists (
       select 1
         from pg_catalog.pg_attribute attribute
        where attribute.attrelid =
              'sellerpilot_private.channel_market_targets'::pg_catalog.regclass
          and attribute.attname = 'credential_version'
          and not attribute.attisdropped
     )
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)'
     ) is null then
    raise exception 'SHOPEE_SG_CREATE_EXECUTION_LINEAGE_PREIMAGE_REQUIRED';
  end if;
end
$preimage$;

create function sellerpilot_private.shopee_sg_create_job_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = p_job_id
       and job.claim_token = p_claim_token
       and job.channel = 'shopee'
       and job.operation = 'listing.create'
       and job.environment = 'production'
       and (
         pg_catalog.upper(coalesce(
           job.request_payload #>>
             '{arguments,sellerpilotShopeeSgCreateContext,market}', ''
         )) = 'SG'
         or pg_catalog.upper(coalesce(
           job.request_payload #>> '{arguments,publish,shop_region}', ''
         )) = 'SG'
         or pg_catalog.lower(coalesce(
           job.request_payload #>> '{arguments,country}', ''
         )) = 'sg'
         or pg_catalog.lower(coalesce(
           job.request_payload #>> '{arguments,publicationExpectedLocale}', ''
         )) = 'en-sg'
       )
  )
$$;

create function sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_marker jsonb;
  v_marker_credential_id uuid;
  v_marker_credential_version integer;
  v_target_record_id uuid;
  v_secret_target jsonb;
  v_secret_target_count integer;
  v_access_expires_at timestamptz;
begin
  -- Use the ledger lock before row locks. Credential rotation takes its
  -- channel advisory lock and then this same credential row, so the row lock
  -- makes rotation and the provider boundary have one committed winner.
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:shopee:production')
  );

  select job.credential_id,
         job.created_by,
         job.request_payload,
         credential.version credential_version,
         decrypted.decrypted_secret::jsonb secret_payload
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > pg_catalog.clock_timestamp())
     and credential.created_by = job.created_by
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for update of job, credential;
  if not found then return false; end if;

  v_marker := v_job.request_payload #>
    '{arguments,sellerpilotShopeeSgCreateExecutionLineage}';
  if pg_catalog.jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker - array[
       'contract', 'credentialId', 'credentialVersion', 'targetId', 'marketCode'
     ] <> '{}'::jsonb
     or v_marker ->> 'contract' is distinct from
          'shopee_sg_create_execution_lineage_v1'
     or coalesce(v_marker ->> 'credentialId', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_marker ->> 'credentialVersion', '') !~
          '^[1-9][0-9]{0,8}$'
     or coalesce(v_marker ->> 'targetId', '') !~
          '^[1-9][0-9]{0,31}$'
     or v_marker ->> 'marketCode' is distinct from 'SG' then
    return false;
  end if;

  v_marker_credential_id := (v_marker ->> 'credentialId')::uuid;
  v_marker_credential_version := (v_marker ->> 'credentialVersion')::integer;
  if v_marker_credential_id is distinct from v_job.credential_id
     or v_marker_credential_version is distinct from v_job.credential_version
     or v_job.request_payload #>>
          '{arguments,sellerpilotShopeeSgCreateContext,contract}' is distinct from
          'sellerpilot_shopee_sg_listing_create_context_v2'
     or v_job.request_payload #>>
          '{arguments,sellerpilotShopeeSgCreateContext,targetId}' is distinct from
          v_marker ->> 'targetId'
     or v_job.request_payload #>> '{arguments,shopId}' is distinct from
          v_marker ->> 'targetId'
     or v_job.request_payload #>> '{arguments,publish,shop_id}' is distinct from
          v_marker ->> 'targetId'
     or v_job.request_payload #>> '{arguments,globalProduct}' is distinct from 'true'
     or pg_catalog.lower(coalesce(
          v_job.request_payload #>> '{arguments,country}', ''
        )) <> 'sg' then
    return false;
  end if;

  select target.id
    into v_target_record_id
    from sellerpilot_private.channel_market_targets target
   where target.owner_id = v_job.created_by
     and target.credential_id = v_job.credential_id
     and target.credential_version = v_job.credential_version
     and target.channel = 'shopee'
     and target.environment = 'production'
     and target.target_id = v_marker ->> 'targetId'
     and target.market_code = 'SG'
     and target.locale = 'en-SG'
     and target.language = 'English'
     and target.currency = 'SGD'
     and target.verified_at <= pg_catalog.clock_timestamp() + interval '5 minutes'
   for update;
  if not found then return false; end if;

  if v_job.secret_payload ->> 'provider_account_identity_version'
       is distinct from 'v1'
     or coalesce(
       v_job.secret_payload ->> 'provider_account_subject', ''
     ) !~ '^shopee:(main|shop):[1-9][0-9]{0,31}$'
     or pg_catalog.jsonb_typeof(v_job.secret_payload -> 'shopee_targets')
       is distinct from 'array' then
    return false;
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.jsonb_agg(entry.value) -> 0
    into v_secret_target_count, v_secret_target
    from pg_catalog.jsonb_array_elements(
      v_job.secret_payload -> 'shopee_targets'
    ) entry(value)
   where entry.value ->> 'type' = 'shop'
     and entry.value ->> 'id' = v_marker ->> 'targetId';
  if v_secret_target_count <> 1 then return false; end if;

  if pg_catalog.jsonb_typeof(v_secret_target -> 'access_token')
       is distinct from 'string'
     or pg_catalog.btrim(coalesce(
       v_secret_target ->> 'access_token', ''
     )) = ''
     or pg_catalog.jsonb_typeof(
       v_secret_target -> 'access_token_expires_at'
     ) is distinct from 'string'
     or pg_catalog.btrim(coalesce(
       v_secret_target ->> 'access_token_expires_at', ''
     )) = '' then
    return false;
  end if;

  begin
    v_access_expires_at :=
      (v_secret_target ->> 'access_token_expires_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return false;
  end;
  if v_access_expires_at is null
     or not pg_catalog.isfinite(v_access_expires_at) then
    return false;
  end if;
  return coalesce(
    v_access_expires_at >
      pg_catalog.clock_timestamp() + interval '10 minutes',
    false
  );
end
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_60910013000_begin_gateway_before_shopee_create;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
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
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return false;
  end if;
  return public.sp_60910013000_begin_gateway_before_shopee_create(
    p_token_hash, p_job_id, p_claim_token
  );
end
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  text, uuid, uuid
) rename to sp_60910013000_begin_serverless_before_shopee_create;

create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
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
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return false;
  end if;
  return public.sp_60910013000_begin_serverless_before_shopee_create(
    p_token_hash, p_job_id, p_claim_token
  );
end
$$;

alter function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  text, uuid, uuid, text, text
) rename to sp_60910013000_begin_shopee_refresh_before_create;

create function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_target_type text,
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if sellerpilot_private.shopee_sg_create_job_v1(p_job_id, p_claim_token)
     and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    return pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-target-refresh-claim/1',
      'status', 'conflict'
    );
  end if;
  return public.sp_60910013000_begin_shopee_refresh_before_create(
    p_token_hash, p_job_id, p_claim_token, p_target_type, p_target_id
  );
end
$$;

revoke all on function sellerpilot_private.shopee_sg_create_job_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sp_60910013000_begin_gateway_before_shopee_create(
  text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function
  public.sp_60910013000_begin_serverless_before_shopee_create(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sp_60910013000_begin_shopee_refresh_before_create(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) to service_role;
revoke all on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text, uuid, uuid
  ) to service_role;
revoke all on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
  text, uuid, uuid, text, text
) to service_role;


-- Reviewed source: 20260910023000_shopee_create_resume_reconciliation.sql
-- Source SHA256: aaf4ff4257fa48867fdddcdc3a018b857806b4147a2674e3aa3cc60a41d22f9a
-- Persist the exact Shopee Global CREATE response only after the worker has
-- verified the same Global item through the official read API. A later SG
-- listing.create job may resume local publication only from this private,
-- immutable receipt; request/browser supplied Global IDs are never consulted.

do $preimage$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(uuid,uuid)'
     ) is null then
    raise exception 'SHOPEE_SG_CREATE_RESUME_PREIMAGE_REQUIRED';
  end if;
end
$preimage$;

create table sellerpilot_private.shopee_sg_create_stage_receipts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references
    sellerpilot_private.product_listings(id) on delete restrict,
  source_job_id uuid not null references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  merchant_id text not null check (merchant_id ~ '^[1-9][0-9]{0,31}$'),
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  seller_sku text not null check (length(seller_sku) between 1 and 160),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  approved_detail_page_version integer not null check (
    approved_detail_page_version > 0
  ),
  approved_manifest_digest text not null check (
    approved_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  prepared_payload_sha256 text not null check (
    prepared_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  stage_sequence smallint not null check (stage_sequence between 0 and 10),
  stage_name text not null check (stage_name in (
    'image-upload', 'global-item-create', 'local-publish'
  )),
  source_url text,
  source_sha256 text,
  global_item_id text,
  status text not null check (status in ('started', 'completed')),
  output_id text,
  result jsonb,
  result_sha256 text,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  unique (listing_id, stage_sequence),
  check (
    (stage_sequence between 0 and 8 and stage_name = 'image-upload'
      and source_url is not null
      and source_sha256 ~ '^[a-f0-9]{64}$'
      and global_item_id is null)
    or (stage_sequence = 9 and stage_name = 'global-item-create'
      and source_url is null and source_sha256 is null
      and (global_item_id is null
        or global_item_id ~ '^[1-9][0-9]{0,31}$'))
    or (stage_sequence = 10 and stage_name = 'local-publish'
      and source_url is null and source_sha256 is null
      and global_item_id ~ '^[1-9][0-9]{0,31}$')
  ),
  check (
    (status = 'started' and output_id is null and result is null
      and result_sha256 is null and completed_at is null)
    or (status = 'completed' and pg_catalog.btrim(output_id) <> ''
      and pg_catalog.jsonb_typeof(result) = 'object'
      and result_sha256 ~ '^[a-f0-9]{64}$'
      and completed_at is not null)
  )
);

alter table sellerpilot_private.shopee_sg_create_stage_receipts
  enable row level security;
revoke all on sellerpilot_private.shopee_sg_create_stage_receipts
  from public, anon, authenticated, service_role;

create table sellerpilot_private.shopee_sg_global_create_receipts (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null unique references
    sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null references
    sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null unique references
    sellerpilot_private.product_listings(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null references
    sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  merchant_id text not null check (merchant_id ~ '^[1-9][0-9]{0,31}$'),
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  seller_sku text not null check (length(seller_sku) between 1 and 160),
  global_item_name text not null check (length(global_item_name) between 1 and 240),
  local_item_name text not null check (length(local_item_name) between 1 and 240),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  prepared_payload_sha256 text not null check (
    prepared_payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  global_item_id text not null check (global_item_id ~ '^[1-9][0-9]{0,31}$'),
  prepared_arguments jsonb not null check (
    pg_catalog.jsonb_typeof(prepared_arguments) = 'object'
    and pg_catalog.octet_length(prepared_arguments::text) <= 128000
  ),
  create_response jsonb not null check (
    pg_catalog.jsonb_typeof(create_response) = 'object'
    and pg_catalog.octet_length(create_response::text) <= 1000000
  ),
  readback_response jsonb not null check (
    pg_catalog.jsonb_typeof(readback_response) = 'object'
    and pg_catalog.octet_length(readback_response::text) <= 1000000
  ),
  create_response_sha256 text not null check (
    create_response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  readback_response_sha256 text not null check (
    readback_response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table sellerpilot_private.shopee_sg_global_create_receipts
  enable row level security;
revoke all on sellerpilot_private.shopee_sg_global_create_receipts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.block_shopee_sg_global_create_receipt_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_IMMUTABLE';
end
$$;

create trigger shopee_sg_global_create_receipts_immutable
before update or delete on sellerpilot_private.shopee_sg_global_create_receipts
for each row execute function
  sellerpilot_private.block_shopee_sg_global_create_receipt_change();

create function sellerpilot_private.shopee_sg_create_stage_job_context_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_require_provider_started boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_merchant_id text;
  v_shop_id text;
  v_sku text;
  v_request_fingerprint text;
  v_approval_version_text text;
  v_approved_manifest_digest text;
begin
  -- The 009-r2 ledger/channel locks must precede stage/job row locks.
  if sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    raise exception 'SHOPEE_SG_STAGE_OWNERSHIP_LOST' using errcode = '40001';
  end if;

  select job.id,
         job.attempt_id,
         job.listing_id,
         job.created_by,
         job.credential_id,
         job.request_payload,
         job.provider_mutation_started_at,
         credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for update of job, credential;
  if not found or v_job.attempt_id is null or v_job.listing_id is null
     or (p_require_provider_started
       and v_job.provider_mutation_started_at is null) then
    raise exception 'SHOPEE_SG_STAGE_OWNERSHIP_LOST' using errcode = '40001';
  end if;

  v_merchant_id := coalesce(
    v_job.request_payload #>>
      '{arguments,sellerpilotShopeeSgCreateContext,merchantId}',
    v_job.request_payload #>> '{arguments,merchantId}', ''
  );
  v_shop_id := coalesce(
    v_job.request_payload #>> '{arguments,publish,shop_id}', ''
  );
  v_sku := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,body,global_item_sku}', ''
  ));
  v_request_fingerprint := pg_catalog.lower(coalesce(
    v_job.request_payload #>> '{arguments,publicationExpectedFingerprint}', ''
  ));
  v_approval_version_text := coalesce(
    v_job.request_payload #>>
      '{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}',
    ''
  );
  v_approved_manifest_digest := pg_catalog.lower(coalesce(
    v_job.request_payload #>>
      '{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}',
    ''
  ));
  if v_merchant_id !~ '^[1-9][0-9]{0,31}$'
     or v_shop_id !~ '^[1-9][0-9]{0,31}$'
     or v_sku = ''
     or v_request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_approval_version_text !~ '^[1-9][0-9]{0,8}$'
     or v_approved_manifest_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_SG_STAGE_SOURCE_INVALID';
  end if;

  return pg_catalog.jsonb_build_object(
    'jobId', v_job.id,
    'attemptId', v_job.attempt_id,
    'listingId', v_job.listing_id,
    'ownerId', v_job.created_by,
    'credentialId', v_job.credential_id,
    'credentialVersion', v_job.credential_version,
    'merchantId', v_merchant_id,
    'shopId', v_shop_id,
    'sellerSku', v_sku,
    'requestFingerprint', v_request_fingerprint,
    'approvedDetailPageVersion', v_approval_version_text::integer,
    'approvedManifestDigest', v_approved_manifest_digest,
    'providerMutationStarted', v_job.provider_mutation_started_at is not null,
    'requestPayload', v_job.request_payload
  );
end
$$;

create function public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
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
  v_context jsonb;
  v_completed jsonb;
  v_completed_count integer;
  v_total_count integer;
  v_started jsonb;
  v_started_count integer;
begin
  v_context := sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    p_token_hash, p_job_id, p_claim_token, false
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-create-stage:' ||
      (v_context ->> 'listingId'))
  );

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where stage.status = 'completed')::integer,
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'sequence', stage.stage_sequence,
             'stage', stage.stage_name,
             'preparedPayloadSha256', stage.prepared_payload_sha256,
             'sourceUrl', stage.source_url,
             'sourceSha256', stage.source_sha256,
             'globalItemId', stage.global_item_id,
             'outputId', stage.output_id
           ) order by stage.stage_sequence
         ) filter (where stage.status = 'completed'), '[]'::jsonb)
    into v_total_count, v_completed_count, v_completed
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.owner_id = (v_context ->> 'ownerId')::uuid
     and stage.credential_id = (v_context ->> 'credentialId')::uuid
     and stage.credential_version = (v_context ->> 'credentialVersion')::integer
     and stage.merchant_id = v_context ->> 'merchantId'
     and stage.shop_id = v_context ->> 'shopId'
     and stage.seller_sku = v_context ->> 'sellerSku'
     and stage.request_fingerprint = v_context ->> 'requestFingerprint'
     and stage.approved_detail_page_version =
          (v_context ->> 'approvedDetailPageVersion')::integer
     and stage.approved_manifest_digest =
          v_context ->> 'approvedManifestDigest';
  select pg_catalog.count(*)::integer,
         pg_catalog.max(pg_catalog.jsonb_build_object(
           'sequence', stage.stage_sequence,
           'stage', stage.stage_name,
           'preparedPayloadSha256', stage.prepared_payload_sha256,
           'sourceUrl', stage.source_url,
           'sourceSha256', stage.source_sha256,
           'globalItemId', stage.global_item_id
         )::text)::jsonb
    into v_started_count, v_started
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.status = 'started';
  if v_started_count > 1
     or v_total_count <> v_completed_count + v_started_count
     or exists (
       select 1
         from sellerpilot_private.shopee_sg_create_stage_receipts stage
        where stage.listing_id = (v_context ->> 'listingId')::uuid
          and stage.status = 'completed'
          and stage.stage_sequence >= v_completed_count
     )
     or (v_started_count = 1
       and (v_started ->> 'sequence')::integer <> v_completed_count) then
    raise exception 'SHOPEE_SG_STAGE_STATE_UNCERTAIN' using errcode = '40001';
  end if;
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-stage/1',
    'status', 'ready',
    'genericProviderMutationStarted',
      (v_context ->> 'providerMutationStarted')::boolean,
    'nextSequence', v_completed_count,
    'completedStages', v_completed,
    'startedStage', v_started
  );
end
$$;

create function public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_stage_sequence integer,
  p_stage_name text,
  p_prepared_payload_sha256 text,
  p_source_url text default null,
  p_source_sha256 text default null,
  p_global_item_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_existing sellerpilot_private.shopee_sg_create_stage_receipts%rowtype;
  v_previous_count integer;
  v_expected_url text;
  v_url_sha text;
  v_global_receipt sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
begin
  if (p_stage_sequence between 0 and 10) is not true
     or (p_stage_name in ('image-upload', 'global-item-create', 'local-publish')) is not true
     or coalesce(p_prepared_payload_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_SG_STAGE_INPUT_INVALID';
  end if;
  v_context := sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    p_token_hash, p_job_id, p_claim_token, true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-create-stage:' ||
      (v_context ->> 'listingId'))
  );

  if p_stage_sequence between 0 and 8 then
    if p_stage_name <> 'image-upload'
       or coalesce(p_source_url, '') = ''
       or coalesce(p_source_sha256, '') !~ '^[a-f0-9]{64}$'
       or p_global_item_id is not null then
      raise exception 'SHOPEE_SG_IMAGE_STAGE_INPUT_INVALID';
    end if;
    v_expected_url := v_context #>> array[
      'requestPayload', 'arguments', 'imageUrls', p_stage_sequence::text
    ];
    v_url_sha := substring(
      p_source_url from '/normalized/[a-f0-9]{2}/([a-f0-9]{64})[.](jpg|jpeg|png)$'
    );
    if v_expected_url is distinct from p_source_url
       or v_url_sha is distinct from p_source_sha256 then
      raise exception 'SHOPEE_SG_IMAGE_STAGE_SOURCE_INVALID';
    end if;
  elsif p_stage_sequence = 9 then
    if p_stage_name <> 'global-item-create' or p_source_url is not null
       or p_source_sha256 is not null or p_global_item_id is not null then
      raise exception 'SHOPEE_SG_GLOBAL_STAGE_INPUT_INVALID';
    end if;
  elsif p_stage_name <> 'local-publish'
     or p_source_url is not null or p_source_sha256 is not null
     or coalesce(p_global_item_id, '') !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'SHOPEE_SG_LOCAL_STAGE_INPUT_INVALID';
  end if;

  select * into v_existing
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.stage_sequence = p_stage_sequence
   for update;
  if found then
    if v_existing.stage_name is distinct from p_stage_name
       or v_existing.credential_id is distinct from
            (v_context ->> 'credentialId')::uuid
       or v_existing.credential_version is distinct from
            (v_context ->> 'credentialVersion')::integer
       or v_existing.merchant_id is distinct from v_context ->> 'merchantId'
       or v_existing.shop_id is distinct from v_context ->> 'shopId'
       or v_existing.seller_sku is distinct from v_context ->> 'sellerSku'
       or v_existing.request_fingerprint is distinct from
            v_context ->> 'requestFingerprint'
       or v_existing.approved_detail_page_version is distinct from
            (v_context ->> 'approvedDetailPageVersion')::integer
       or v_existing.approved_manifest_digest is distinct from
            v_context ->> 'approvedManifestDigest'
       or v_existing.prepared_payload_sha256 is distinct from
            p_prepared_payload_sha256
       or coalesce(v_existing.source_url, '') is distinct from
            coalesce(p_source_url, '')
       or coalesce(v_existing.source_sha256, '') is distinct from
            coalesce(p_source_sha256, '')
       or coalesce(v_existing.global_item_id, '') is distinct from
            coalesce(p_global_item_id, '') then
      raise exception 'SHOPEE_SG_STAGE_REPLAY_MISMATCH';
    end if;
    if v_existing.status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'contract', 'sellerpilot-shopee-sg-create-stage/1',
        'status', 'completed',
        'sequence', v_existing.stage_sequence,
        'outputId', v_existing.output_id
      );
    end if;
    raise exception 'SHOPEE_SG_STAGE_STATE_UNCERTAIN' using errcode = '40001';
  end if;

  select pg_catalog.count(*)::integer into v_previous_count
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.status = 'completed'
     and stage.stage_sequence < p_stage_sequence;
  if v_previous_count <> p_stage_sequence
     or exists (
       select 1
         from sellerpilot_private.shopee_sg_create_stage_receipts stage
        where stage.listing_id = (v_context ->> 'listingId')::uuid
          and stage.stage_sequence > p_stage_sequence
     ) then
    raise exception 'SHOPEE_SG_STAGE_SEQUENCE_INVALID';
  end if;
  if p_stage_sequence > 0 and exists (
    select 1
      from sellerpilot_private.shopee_sg_create_stage_receipts stage
     where stage.listing_id = (v_context ->> 'listingId')::uuid
       and stage.stage_sequence < p_stage_sequence
       and (stage.prepared_payload_sha256 is distinct from
              p_prepared_payload_sha256
         or stage.owner_id is distinct from (v_context ->> 'ownerId')::uuid
         or stage.credential_id is distinct from
              (v_context ->> 'credentialId')::uuid
         or stage.credential_version is distinct from
              (v_context ->> 'credentialVersion')::integer
         or stage.merchant_id is distinct from v_context ->> 'merchantId'
         or stage.shop_id is distinct from v_context ->> 'shopId'
         or stage.seller_sku is distinct from v_context ->> 'sellerSku'
         or stage.request_fingerprint is distinct from
              v_context ->> 'requestFingerprint'
         or stage.approved_detail_page_version is distinct from
              (v_context ->> 'approvedDetailPageVersion')::integer
         or stage.approved_manifest_digest is distinct from
              v_context ->> 'approvedManifestDigest')
  ) then
    raise exception 'SHOPEE_SG_STAGE_PAYLOAD_DRIFT';
  end if;
  if p_stage_sequence = 10 then
    select * into v_global_receipt
      from sellerpilot_private.shopee_sg_global_create_receipts receipt
     where receipt.listing_id = (v_context ->> 'listingId')::uuid
       and receipt.credential_id = (v_context ->> 'credentialId')::uuid
       and receipt.credential_version =
            (v_context ->> 'credentialVersion')::integer
       and receipt.prepared_payload_sha256 = p_prepared_payload_sha256
       and receipt.global_item_id = p_global_item_id;
    if not found then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_GLOBAL_RECEIPT_REQUIRED';
    end if;
  end if;

  insert into sellerpilot_private.shopee_sg_create_stage_receipts (
    listing_id, source_job_id, source_attempt_id, owner_id,
    credential_id, credential_version, merchant_id, shop_id, seller_sku,
    request_fingerprint, approved_detail_page_version,
    approved_manifest_digest, prepared_payload_sha256,
    stage_sequence, stage_name, source_url, source_sha256, global_item_id,
    status
  ) values (
    (v_context ->> 'listingId')::uuid, p_job_id,
    (v_context ->> 'attemptId')::uuid, (v_context ->> 'ownerId')::uuid,
    (v_context ->> 'credentialId')::uuid,
    (v_context ->> 'credentialVersion')::integer,
    v_context ->> 'merchantId', v_context ->> 'shopId',
    v_context ->> 'sellerSku', v_context ->> 'requestFingerprint',
    (v_context ->> 'approvedDetailPageVersion')::integer,
    v_context ->> 'approvedManifestDigest',
    p_prepared_payload_sha256, p_stage_sequence, p_stage_name,
    p_source_url, p_source_sha256, p_global_item_id, 'started'
  );
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-stage/1',
    'status', 'started',
    'sequence', p_stage_sequence
  );
end
$$;

create function public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_global_item_id text,
  p_create_response jsonb,
  p_readback_response jsonb,
  p_prepared_arguments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_worker_id uuid;
  v_existing sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
  v_stage sellerpilot_private.shopee_sg_create_stage_receipts%rowtype;
  v_evidence jsonb;
  v_global_row jsonb;
  v_sku text;
  v_global_name text;
  v_local_name text;
  v_request_fingerprint text;
  v_prepared_sha text;
  v_merchant_id text;
  v_shop_id text;
begin
  if p_job_id is null or p_claim_token is null
     or coalesce(p_global_item_id, '') !~ '^[1-9][0-9]{0,31}$'
     or pg_catalog.jsonb_typeof(p_create_response) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_readback_response) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_prepared_arguments) is distinct from 'object'
     or pg_catalog.octet_length(p_create_response::text) > 1000000
     or pg_catalog.octet_length(p_readback_response::text) > 1000000
     or pg_catalog.octet_length(p_prepared_arguments::text) > 128000 then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_INPUT_INVALID';
  end if;

  select token.id into v_worker_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.scope = 'gateway'
     and token.status = 'active'
     and token.expires_at > pg_catalog.clock_timestamp();
  if v_worker_id is null then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_WORKER_DENIED'
      using errcode = '42501';
  end if;

  -- Preserve the 009-r2 ledger -> channel -> job/credential lock order.
  if sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-global-create:' || p_job_id::text)
  );
  select job.id,
         job.attempt_id,
         job.listing_id,
         job.created_by,
         job.credential_id,
         job.request_payload,
         credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.worker_token_id = v_worker_id
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for update of job, credential;
  if not found or v_job.attempt_id is null or v_job.listing_id is null then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  v_sku := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,body,global_item_sku}', ''
  ));
  v_global_name := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,body,global_item_name}', ''
  ));
  v_local_name := pg_catalog.btrim(coalesce(
    v_job.request_payload #>> '{arguments,publish,item,item_name}', ''
  ));
  v_request_fingerprint := pg_catalog.lower(coalesce(
    v_job.request_payload #>> '{arguments,publicationExpectedFingerprint}', ''
  ));
  v_merchant_id := coalesce(
    v_job.request_payload #>> '{arguments,sellerpilotShopeeSgCreateContext,merchantId}',
    v_job.request_payload #>> '{arguments,merchantId}',
    ''
  );
  v_shop_id := coalesce(
    v_job.request_payload #>> '{arguments,publish,shop_id}', ''
  );
  v_evidence := p_prepared_arguments #>
    '{sellerpilotShopeeSgCreatePrewriteEvidence}';
  v_prepared_sha := pg_catalog.lower(coalesce(
    v_evidence ->> 'payloadSha256', ''
  ));

  if coalesce(p_create_response #>> '{response,global_item_id}', '')
       is distinct from p_global_item_id
     or coalesce(p_create_response ->> 'error', '') <> ''
     or coalesce(p_readback_response ->> 'error', '') <> ''
     or v_sku = '' or v_global_name = '' or v_local_name = ''
     or v_request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_merchant_id !~ '^[1-9][0-9]{0,31}$'
     or v_shop_id !~ '^[1-9][0-9]{0,31}$'
     or v_evidence ->> 'contract' is distinct from
          'sellerpilot_shopee_sg_create_prewrite_v1'
     or v_prepared_sha !~ '^[a-f0-9]{64}$'
     or v_evidence #>> '{credential,credentialId}' is distinct from
          v_job.credential_id::text
     or (v_evidence #>> '{credential,credentialVersion}')::integer
          is distinct from v_job.credential_version
     or v_evidence #>> '{provider,merchantId}' is distinct from v_merchant_id
     or v_evidence #>> '{provider,shopId}' is distinct from v_shop_id
     or p_prepared_arguments #>> '{body,global_item_sku}'
          is distinct from v_sku
     or p_prepared_arguments #>> '{body,global_item_name}'
          is distinct from v_global_name
     or p_prepared_arguments #>> '{publish,item,item_name}'
          is distinct from v_local_name
     or p_prepared_arguments #>> '{publicationExpectedFingerprint}'
          is distinct from v_request_fingerprint
     or p_prepared_arguments #>
          '{sellerpilotShopeeSgCreateExecutionLineage}'
          is distinct from v_job.request_payload #>
          '{arguments,sellerpilotShopeeSgCreateExecutionLineage}' then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_BINDING_INVALID';
  end if;

  select row.value into v_global_row
    from pg_catalog.jsonb_array_elements(
      coalesce(
        p_readback_response #> '{response,global_item_list}', '[]'::jsonb
      )
    ) row(value)
   where row.value ->> 'global_item_id' = p_global_item_id
     and coalesce(
       row.value ->> 'global_item_sku', row.value ->> 'item_sku', ''
     ) = v_sku
     and coalesce(
       row.value ->> 'global_item_name', row.value ->> 'item_name', ''
     ) = v_global_name;
  if v_global_row is null or (
    select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(
        coalesce(
          p_readback_response #> '{response,global_item_list}', '[]'::jsonb
        )
      ) row(value)
     where row.value ->> 'global_item_id' = p_global_item_id
       and coalesce(
         row.value ->> 'global_item_sku', row.value ->> 'item_sku', ''
       ) = v_sku
       and coalesce(
         row.value ->> 'global_item_name', row.value ->> 'item_name', ''
       ) = v_global_name
  ) <> 1 then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_OFFICIAL_READBACK_INVALID';
  end if;

  select * into v_stage
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = v_job.listing_id
     and stage.stage_sequence = 9
   for update;
  if not found
     or ((v_stage.source_job_id is distinct from p_job_id
          or v_stage.source_attempt_id is distinct from v_job.attempt_id)
       and p_create_response ->> 'sellerpilotReconciliation' is distinct from
         'official-exact-global-readback')
     or v_stage.stage_name is distinct from 'global-item-create'
     or v_stage.status is distinct from 'started'
     or v_stage.credential_id is distinct from v_job.credential_id
     or v_stage.credential_version is distinct from v_job.credential_version
     or v_stage.merchant_id is distinct from v_merchant_id
     or v_stage.shop_id is distinct from v_shop_id
     or v_stage.seller_sku is distinct from v_sku
     or v_stage.request_fingerprint is distinct from v_request_fingerprint
     or v_stage.approved_detail_page_version is distinct from
          (v_job.request_payload #>>
            '{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}')::integer
     or v_stage.approved_manifest_digest is distinct from
          v_job.request_payload #>>
            '{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}'
     or v_stage.prepared_payload_sha256 is distinct from v_prepared_sha then
    raise exception 'SHOPEE_SG_GLOBAL_STAGE_RECEIPT_REQUIRED';
  end if;

  select * into v_existing
    from sellerpilot_private.shopee_sg_global_create_receipts receipt
   where receipt.listing_id = v_job.listing_id;
  if found then
    if v_existing.source_job_id = p_job_id
       and v_existing.credential_id = v_job.credential_id
       and v_existing.credential_version = v_job.credential_version
       and v_existing.global_item_id = p_global_item_id
       and v_existing.prepared_payload_sha256 = v_prepared_sha
       and v_existing.create_response_sha256 = pg_catalog.encode(
         extensions.digest(p_create_response::text, 'sha256'), 'hex'
       )
       and v_existing.readback_response_sha256 = pg_catalog.encode(
         extensions.digest(p_readback_response::text, 'sha256'), 'hex'
       ) then
      return pg_catalog.jsonb_build_object(
        'contract', 'sellerpilot-shopee-sg-create-resume/1',
        'status', 'replayed',
        'receiptId', v_existing.id
      );
    end if;
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_CONFLICT';
  end if;

  insert into sellerpilot_private.shopee_sg_global_create_receipts (
    source_job_id, source_attempt_id, listing_id, owner_id,
    credential_id, credential_version, merchant_id, shop_id,
    seller_sku, global_item_name, local_item_name, request_fingerprint,
    prepared_payload_sha256, global_item_id, prepared_arguments,
    create_response, readback_response,
    create_response_sha256, readback_response_sha256
  ) values (
    p_job_id, v_job.attempt_id, v_job.listing_id, v_job.created_by,
    v_job.credential_id, v_job.credential_version, v_merchant_id, v_shop_id,
    v_sku, v_global_name, v_local_name, v_request_fingerprint,
    v_prepared_sha, p_global_item_id, p_prepared_arguments,
    p_create_response, p_readback_response,
    pg_catalog.encode(extensions.digest(p_create_response::text, 'sha256'), 'hex'),
    pg_catalog.encode(extensions.digest(p_readback_response::text, 'sha256'), 'hex')
  ) returning * into v_existing;

  update sellerpilot_private.shopee_sg_create_stage_receipts stage
     set status = 'completed',
         output_id = p_global_item_id,
         global_item_id = p_global_item_id,
         result = pg_catalog.jsonb_build_object(
           'globalItemId', p_global_item_id,
           'createResponse', p_create_response,
           'readbackResponse', p_readback_response
         ),
         result_sha256 = pg_catalog.encode(extensions.digest(
           pg_catalog.jsonb_build_object(
             'globalItemId', p_global_item_id,
             'createResponse', p_create_response,
             'readbackResponse', p_readback_response
           )::text,
           'sha256'
         ), 'hex'),
         completed_at = pg_catalog.clock_timestamp()
   where stage.id = v_stage.id
     and stage.status = 'started';
  if not found then
    raise exception 'SHOPEE_SG_GLOBAL_STAGE_COMPLETION_CONFLICT';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-resume/1',
    'status', 'recorded',
    'receiptId', v_existing.id
  );
end
$$;

create function public.sellerpilot_service_read_shopee_sg_create_resume_v1(
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
  v_job record;
  v_receipt sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
begin
  if not exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.scope = 'gateway'
       and token.status = 'active'
       and token.expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception 'SHOPEE_SG_CREATE_RESUME_WORKER_DENIED'
      using errcode = '42501';
  end if;

  -- Preserve the 009-r2 ledger -> channel -> job/credential lock order.
  if sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
       p_job_id, p_claim_token
     ) is not true then
    raise exception 'SHOPEE_SG_CREATE_RESUME_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  select job.id,
         job.listing_id,
         job.created_by,
         job.credential_id,
         job.request_payload,
         credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > pg_catalog.clock_timestamp()
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
     and job.environment = 'production'
   for share of job, credential;
  if not found or v_job.listing_id is null then
    raise exception 'SHOPEE_SG_CREATE_RESUME_OWNERSHIP_LOST'
      using errcode = '40001';
  end if;

  select receipt.* into v_receipt
    from sellerpilot_private.shopee_sg_global_create_receipts receipt
   where receipt.listing_id = v_job.listing_id
     and receipt.owner_id = v_job.created_by
     and receipt.credential_id = v_job.credential_id
     and receipt.credential_version = v_job.credential_version
     and receipt.shop_id = v_job.request_payload #>> '{arguments,publish,shop_id}'
     and receipt.seller_sku = v_job.request_payload #>>
          '{arguments,body,global_item_sku}'
     and receipt.global_item_name = v_job.request_payload #>>
          '{arguments,body,global_item_name}'
     and receipt.local_item_name = v_job.request_payload #>>
          '{arguments,publish,item,item_name}'
     and receipt.request_fingerprint = v_job.request_payload #>>
          '{arguments,publicationExpectedFingerprint}'
     and receipt.prepared_arguments #>
          '{sellerpilotShopeeSgCreateExecutionLineage}'
          = v_job.request_payload #>
          '{arguments,sellerpilotShopeeSgCreateExecutionLineage}';
  if not found then
    return pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-sg-create-resume/1',
      'status', 'absent'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-resume/1',
    'status', 'ready',
    'receipt', pg_catalog.jsonb_build_object(
      'contract', 'sellerpilot-shopee-sg-create-resume/1',
      'sourceJobId', v_receipt.source_job_id,
      'credentialId', v_receipt.credential_id,
      'credentialVersion', v_receipt.credential_version,
      'merchantId', v_receipt.merchant_id,
      'shopId', v_receipt.shop_id,
      'requestFingerprint', v_receipt.request_fingerprint,
      'globalItemId', v_receipt.global_item_id,
      'preparedArguments', v_receipt.prepared_arguments
    )
  );
end
$$;

create function public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_stage_sequence integer,
  p_stage_name text,
  p_prepared_payload_sha256 text,
  p_source_url text default null,
  p_source_sha256 text default null,
  p_global_item_id text default null,
  p_output_id text default null,
  p_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_stage sellerpilot_private.shopee_sg_create_stage_receipts%rowtype;
  v_receipt sellerpilot_private.shopee_sg_global_create_receipts%rowtype;
  v_published jsonb;
  v_local jsonb;
  v_result_sha text;
begin
  if (p_stage_sequence between 0 and 10) is not true
     or p_stage_name not in ('image-upload', 'local-publish')
     or coalesce(p_prepared_payload_sha256, '') !~ '^[a-f0-9]{64}$'
     or pg_catalog.btrim(coalesce(p_output_id, '')) = ''
     or pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
     or pg_catalog.octet_length(p_result::text) > 1000000 then
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_INPUT_INVALID';
  end if;
  v_context := sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    p_token_hash, p_job_id, p_claim_token, true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-create-stage:' ||
      (v_context ->> 'listingId'))
  );
  select * into v_stage
    from sellerpilot_private.shopee_sg_create_stage_receipts stage
   where stage.listing_id = (v_context ->> 'listingId')::uuid
     and stage.stage_sequence = p_stage_sequence
   for update;
  if not found
     or ((v_stage.source_job_id is distinct from p_job_id
          or v_stage.source_attempt_id is distinct from
            (v_context ->> 'attemptId')::uuid)
       and not (p_stage_name = 'local-publish'
         and p_result ->> 'sellerpilotReconciliation' =
           'official-exact-local-readback'))
     or v_stage.stage_name is distinct from p_stage_name
     or v_stage.credential_id is distinct from
          (v_context ->> 'credentialId')::uuid
     or v_stage.credential_version is distinct from
          (v_context ->> 'credentialVersion')::integer
     or v_stage.merchant_id is distinct from v_context ->> 'merchantId'
     or v_stage.shop_id is distinct from v_context ->> 'shopId'
     or v_stage.seller_sku is distinct from v_context ->> 'sellerSku'
     or v_stage.request_fingerprint is distinct from
          v_context ->> 'requestFingerprint'
     or v_stage.approved_detail_page_version is distinct from
          (v_context ->> 'approvedDetailPageVersion')::integer
     or v_stage.approved_manifest_digest is distinct from
          v_context ->> 'approvedManifestDigest'
     or v_stage.prepared_payload_sha256 is distinct from
          p_prepared_payload_sha256
     or coalesce(v_stage.source_url, '') is distinct from
          coalesce(p_source_url, '')
     or coalesce(v_stage.source_sha256, '') is distinct from
          coalesce(p_source_sha256, '')
     or coalesce(v_stage.global_item_id, '') is distinct from
          coalesce(p_global_item_id, '') then
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_BINDING_INVALID';
  end if;
  v_result_sha := pg_catalog.encode(
    extensions.digest(p_result::text, 'sha256'), 'hex'
  );
  if v_stage.status = 'completed' then
    if v_stage.output_id is not distinct from p_output_id
       and v_stage.result_sha256 is not distinct from v_result_sha then
      return pg_catalog.jsonb_build_object(
        'contract', 'sellerpilot-shopee-sg-create-stage/1',
        'status', 'completed',
        'sequence', v_stage.stage_sequence,
        'outputId', v_stage.output_id
      );
    end if;
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_REPLAY_MISMATCH';
  end if;

  if p_stage_name = 'image-upload' then
    if p_stage_sequence not between 0 and 8
       or p_result ->> 'imageId' is distinct from p_output_id
       or exists (
         select 1
           from sellerpilot_private.shopee_sg_create_stage_receipts stage
          where stage.listing_id = v_stage.listing_id
            and stage.stage_name = 'image-upload'
            and stage.status = 'completed'
            and stage.output_id = p_output_id
       ) then
      raise exception 'SHOPEE_SG_IMAGE_STAGE_COMPLETION_INVALID';
    end if;
  else
    if p_stage_sequence <> 10
       or coalesce(p_global_item_id, '') !~ '^[1-9][0-9]{0,31}$'
       or coalesce(p_output_id, '') !~ '^[1-9][0-9]{0,31}$' then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_COMPLETION_INVALID';
    end if;
    select * into v_receipt
      from sellerpilot_private.shopee_sg_global_create_receipts receipt
     where receipt.listing_id = v_stage.listing_id
       and receipt.owner_id = v_stage.owner_id
       and receipt.credential_id = v_stage.credential_id
       and receipt.credential_version = v_stage.credential_version
       and receipt.prepared_payload_sha256 = p_prepared_payload_sha256
       and receipt.global_item_id = p_global_item_id;
    if not found or (
      p_result ->> 'sellerpilotReconciliation' is distinct from
        'official-exact-local-readback'
      and p_result #>> '{publishResponse,response,publish_task_id}'
        is distinct from p_result ->> 'publishTaskId'
    ) then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_GLOBAL_RECEIPT_INVALID';
    end if;
    select row.value into v_published
      from pg_catalog.jsonb_array_elements(coalesce(
        p_result #> '{publishedReadback,response,published_item}', '[]'::jsonb
      )) row(value)
     where coalesce(row.value ->> 'global_item_id', '') = p_global_item_id
       and coalesce(row.value ->> 'shop_id', '') = v_stage.shop_id
       and coalesce(row.value ->> 'item_id', '') = p_output_id;
    select row.value into v_local
      from pg_catalog.jsonb_array_elements(coalesce(
        p_result #> '{localReadback,response,item_list}', '[]'::jsonb
      )) row(value)
     where coalesce(row.value ->> 'item_id', '') = p_output_id
       and coalesce(row.value ->> 'item_sku', row.value ->> 'seller_sku', '')
            = v_stage.seller_sku
       and coalesce(row.value ->> 'item_name', '') =
            v_receipt.prepared_arguments #>> '{publish,item,item_name}'
       and coalesce(row.value ->> 'category_id', '') =
            v_receipt.prepared_arguments #>>
              '{sellerpilotProviderLocalCategoryId}';
    if v_published is null or v_local is null or (
      select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(coalesce(
          p_result #> '{publishedReadback,response,published_item}', '[]'::jsonb
        )) row(value)
       where coalesce(row.value ->> 'global_item_id', '') = p_global_item_id
         and coalesce(row.value ->> 'shop_id', '') = v_stage.shop_id
         and coalesce(row.value ->> 'item_id', '') = p_output_id
    ) <> 1 or (
      select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(coalesce(
          p_result #> '{localReadback,response,item_list}', '[]'::jsonb
        )) row(value)
       where coalesce(row.value ->> 'item_id', '') = p_output_id
    ) <> 1 then
      raise exception 'SHOPEE_SG_LOCAL_STAGE_OFFICIAL_READBACK_INVALID';
    end if;
  end if;

  update sellerpilot_private.shopee_sg_create_stage_receipts stage
     set status = 'completed',
         output_id = p_output_id,
         result = p_result,
         result_sha256 = v_result_sha,
         completed_at = pg_catalog.clock_timestamp()
   where stage.id = v_stage.id and stage.status = 'started';
  if not found then
    raise exception 'SHOPEE_SG_STAGE_COMPLETION_CONFLICT';
  end if;
  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-create-stage/1',
    'status', 'completed',
    'sequence', p_stage_sequence,
    'outputId', p_output_id
  );
end
$$;

revoke all on function
  sellerpilot_private.block_shopee_sg_global_create_receipt_change()
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.shopee_sg_create_stage_job_context_v1(
    text, uuid, uuid, boolean
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
    text, uuid, uuid
  ) to service_role;
revoke all on function
  public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text
  ) to service_role;
revoke all on function
  public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
    text, uuid, uuid, integer, text, text, text, text, text, text, jsonb
  ) to service_role;
revoke all on function
  public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
    text, uuid, uuid, text, jsonb, jsonb, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
    text, uuid, uuid, text, jsonb, jsonb, jsonb
  ) to service_role;
revoke all on function
  public.sellerpilot_service_read_shopee_sg_create_resume_v1(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_read_shopee_sg_create_resume_v1(
    text, uuid, uuid
  ) to service_role;


-- Reviewed source: 20260910044000_shopee_create_transport_and_successor_hardening_r6.sql
-- Source SHA256: 7bf0d1852a02c22dc8992f3f14e9abe506529b468806b4f8a3fd9cdea0029836
-- Shopee r6: exact transport-byte CAS, exact-one full draft, OAuth successor
-- receipt rebind or retirement, Vault incarnation, warehouse body allowlist,
-- and atomic mapping+internal completion. Does not apply to production.

do $preimage$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.shopee_sg_create_stage_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.shopee_sg_global_create_receipts'
     ) is null then
    raise exception 'SHOPEE_SG_R6_PREIMAGE_REQUIRED';
  end if;
end
$preimage$;

alter table sellerpilot_private.shopee_sg_create_stage_receipts
  add column if not exists vault_secret_id uuid,
  add column if not exists vault_updated_at timestamptz,
  add column if not exists transport_bytes_sha256 text;

alter table sellerpilot_private.shopee_sg_global_create_receipts
  add column if not exists vault_secret_id uuid,
  add column if not exists vault_updated_at timestamptz,
  add column if not exists transport_bytes_sha256 text;

alter table sellerpilot_private.shopee_sg_create_stage_receipts
  drop constraint if exists shopee_sg_stage_transport_sha_r6;
alter table sellerpilot_private.shopee_sg_create_stage_receipts
  add constraint shopee_sg_stage_transport_sha_r6 check (
    transport_bytes_sha256 is null
    or transport_bytes_sha256 ~ '^[a-f0-9]{64}$'
  );

alter table sellerpilot_private.shopee_sg_global_create_receipts
  drop constraint if exists shopee_sg_global_transport_sha_r6;
alter table sellerpilot_private.shopee_sg_global_create_receipts
  add constraint shopee_sg_global_transport_sha_r6 check (
    transport_bytes_sha256 is null
    or transport_bytes_sha256 ~ '^[a-f0-9]{64}$'
  );

create table if not exists sellerpilot_private.shopee_sg_create_completion_map (
  listing_id uuid primary key,
  source_job_id uuid not null unique,
  credential_id uuid not null,
  credential_version integer not null check (credential_version > 0),
  vault_secret_id uuid not null,
  vault_updated_at timestamptz not null,
  global_item_id text not null check (global_item_id ~ '^[1-9][0-9]{0,31}$'),
  local_item_id text not null check (local_item_id ~ '^[1-9][0-9]{0,31}$'),
  transport_bytes_sha256 text not null check (
    transport_bytes_sha256 ~ '^[a-f0-9]{64}$'
  ),
  completed_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table sellerpilot_private.shopee_sg_create_completion_map
  enable row level security;
revoke all on sellerpilot_private.shopee_sg_create_completion_map
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.assert_shopee_sg_transport_bytes_v1(
  p_bytes text,
  p_sha256 text
) returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_bytes, '') = ''
     or coalesce(p_sha256, '') !~ '^[a-f0-9]{64}$'
     or pg_catalog.encode(
          extensions.digest(p_bytes, 'sha256'),
          'hex'
        ) is distinct from p_sha256 then
    raise exception 'SHOPEE_SG_TRANSPORT_BYTES_MISMATCH';
  end if;
  return p_sha256;
end
$$;

create or replace function sellerpilot_private.assert_shopee_sg_wh_list_body_v1(
  p_body jsonb
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
     or p_body - 'cursor' <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_body -> 'cursor') is distinct from 'object'
     or (p_body -> 'cursor') - array['next_id', 'page_size'] <> '{}'::jsonb then
    raise exception 'SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN';
  end if;
  return p_body;
end
$$;

create or replace function sellerpilot_private.assert_shopee_sg_wh_elig_body_v1(
  p_body jsonb
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
     or p_body - array['warehouse_id', 'warehouse_type', 'cursor'] <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_body -> 'cursor') is distinct from 'object'
     or (p_body -> 'cursor') - array['next_id', 'page_size'] <> '{}'::jsonb then
    raise exception 'SHOPEE_SG_WAREHOUSE_ELIGIBILITY_BODY_FORBIDDEN';
  end if;
  return p_body;
end
$$;

create or replace function sellerpilot_private.assert_shopee_sg_one_full_draft_v1(
  p_owner_id uuid,
  p_product_id uuid
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_current integer;
  v_full integer;
  v_draft jsonb;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.product_registration_drafts'
     ) is null then
    raise exception 'SHOPEE_SG_FULL_DRAFT_PREIMAGE_REQUIRED';
  end if;
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where pg_catalog.btrim(coalesce(draft.data #>> '{common,fields,productName}', '')) <> ''
             and pg_catalog.jsonb_typeof(draft.data #> '{common,quantity}') = 'number'
             and pg_catalog.jsonb_typeof(draft.data #> '{common,globalBaseUsdPrice}') = 'number'
             and pg_catalog.btrim(coalesce(draft.data #>> '{channels,sg,categoryId}', '')) <> ''
         )::integer
    into v_current, v_full
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = p_owner_id
     and draft.product_id = p_product_id
     and draft.kind = 'publish';
  if v_current is distinct from 1 or v_full is distinct from 1 then
    raise exception 'SHOPEE_SG_FULL_DRAFT_CARDINALITY';
  end if;
  select draft.data into v_draft
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = p_owner_id
     and draft.product_id = p_product_id
     and draft.kind = 'publish';
  return v_draft;
end
$$;

create or replace function sellerpilot_private.shopee_sg_current_vault_inc_v1(
  p_credential_id uuid,
  out vault_secret_id uuid,
  out updated_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  select credential.vault_secret_id, secret.updated_at
    into vault_secret_id, updated_at
    from sellerpilot_private.channel_credentials credential
    join vault.secrets secret
      on secret.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.status = 'active';
  if vault_secret_id is null or updated_at is null then
    raise exception 'SHOPEE_SG_VAULT_INCARNATION_UNBOUND';
  end if;
end
$$;

create or replace function sellerpilot_private.rebind_shopee_sg_successor_v1(
  p_job_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_vault record;
  v_old uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,
    pg_catalog.hashtext('shopee-sg-successor:' || p_job_id::text)
  );
  select job.id, job.created_by, job.credential_id, job.listing_id,
         job.claim_token, job.status, credential.version credential_version
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'shopee'
     and job.operation = 'listing.create'
   for update of job, credential;
  if not found then
    raise exception 'SHOPEE_SG_SUCCESSOR_JOB_INVALID';
  end if;
  v_old := v_job.credential_id;
  select * into v_vault
    from sellerpilot_private.shopee_sg_current_vault_inc_v1(v_job.credential_id);

  update sellerpilot_private.channel_market_targets target
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         updated_at = pg_catalog.clock_timestamp()
   where target.owner_id = v_job.created_by
     and target.channel = 'shopee'
     and target.market_code = 'SG'
     and target.environment = 'production';

  update sellerpilot_private.shopee_sg_create_stage_receipts stage
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         vault_secret_id = v_vault.vault_secret_id,
         vault_updated_at = v_vault.updated_at
   where stage.listing_id = v_job.listing_id
     and stage.owner_id = v_job.created_by
     and (stage.credential_id is distinct from v_job.credential_id
       or stage.credential_version is distinct from v_job.credential_version
       or stage.vault_secret_id is distinct from v_vault.vault_secret_id);

  update sellerpilot_private.shopee_sg_global_create_receipts receipt
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         vault_secret_id = v_vault.vault_secret_id,
         vault_updated_at = v_vault.updated_at
   where receipt.listing_id = v_job.listing_id
     and receipt.owner_id = v_job.created_by
     and (receipt.credential_id is distinct from v_job.credential_id
       or receipt.credential_version is distinct from v_job.credential_version
       or receipt.vault_secret_id is distinct from v_vault.vault_secret_id);

  if exists (
    select 1
      from sellerpilot_private.shopee_sg_create_stage_receipts stage
     where stage.listing_id = v_job.listing_id
       and stage.owner_id = v_job.created_by
       and (stage.credential_id is distinct from v_job.credential_id
         or stage.vault_secret_id is distinct from v_vault.vault_secret_id)
  ) or exists (
    select 1
      from sellerpilot_private.shopee_sg_global_create_receipts receipt
     where receipt.listing_id = v_job.listing_id
       and receipt.owner_id = v_job.created_by
       and (receipt.credential_id is distinct from v_job.credential_id
         or receipt.vault_secret_id is distinct from v_vault.vault_secret_id)
  ) then
    raise exception 'SHOPEE_SG_SUCCESSOR_RECEIPT_RESIDUAL';
  end if;

  update sellerpilot_private.shopee_sg_create_completion_map map
     set credential_id = v_job.credential_id,
         credential_version = v_job.credential_version,
         vault_secret_id = v_vault.vault_secret_id,
         vault_updated_at = v_vault.updated_at
   where map.listing_id = v_job.listing_id
     and map.source_job_id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'contract', 'sellerpilot-shopee-sg-credential-incarnation/1',
    'credentialId', v_job.credential_id,
    'credentialVersion', v_job.credential_version,
    'vaultSecretId', v_vault.vault_secret_id,
    'retiredCredentialId', v_old
  );
end
$$;

create or replace function sellerpilot_private.complete_shopee_sg_atomic_map_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault record;
  v_product uuid;
  v_transport text;
begin
  if tg_op <> 'UPDATE'
     or new.status is distinct from 'completed'
     or old.status is distinct from 'started'
     or new.stage_name is distinct from 'local-publish' then
    return new;
  end if;
  select * into v_vault
    from sellerpilot_private.shopee_sg_current_vault_inc_v1(new.credential_id);
  if new.vault_secret_id is distinct from v_vault.vault_secret_id
     or new.vault_updated_at is distinct from v_vault.updated_at then
    raise exception 'SHOPEE_SG_VAULT_INCARNATION_DRIFT';
  end if;
  select listing.product_id into v_product
    from sellerpilot_private.product_listings listing
   where listing.id = new.listing_id
     and listing.owner_id = new.owner_id
   for update;
  if not found then
    raise exception 'SHOPEE_SG_ATOMIC_COMPLETION_LISTING_INVALID';
  end if;
  perform sellerpilot_private.assert_shopee_sg_one_full_draft_v1(
    new.owner_id, v_product
  );
  v_transport := coalesce(new.transport_bytes_sha256, new.prepared_payload_sha256);
  insert into sellerpilot_private.shopee_sg_create_completion_map (
    listing_id, source_job_id, credential_id, credential_version,
    vault_secret_id, vault_updated_at, global_item_id, local_item_id,
    transport_bytes_sha256
  ) values (
    new.listing_id, new.source_job_id, new.credential_id, new.credential_version,
    v_vault.vault_secret_id, v_vault.updated_at, new.global_item_id, new.output_id,
    v_transport
  );
  -- A provider-stage receipt is not the gateway completion transaction.
  -- Keep the job running so owned completion can persist response, attempts
  -- and publication readback atomically; early success loses that ownership.
  perform 1 from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.source_job_id
     and job.listing_id = new.listing_id
     and job.credential_id = new.credential_id
     and job.status = 'running'
   for update;
  if not found then
    raise exception 'SHOPEE_SG_ATOMIC_COMPLETION_JOB_INVALID';
  end if;
  return new;
end
$$;

create or replace function sellerpilot_private.shopee_sg_r6_stage_begin_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault record;
  v_product uuid;
begin
  select * into v_vault
    from sellerpilot_private.shopee_sg_current_vault_inc_v1(new.credential_id);
  new.vault_secret_id := v_vault.vault_secret_id;
  new.vault_updated_at := v_vault.updated_at;
  new.transport_bytes_sha256 := coalesce(
    new.transport_bytes_sha256, new.prepared_payload_sha256
  );
  select listing.product_id into v_product
    from sellerpilot_private.product_listings listing
   where listing.id = new.listing_id
     and listing.owner_id = new.owner_id;
  if v_product is not null then
    perform sellerpilot_private.assert_shopee_sg_one_full_draft_v1(
      new.owner_id, v_product
    );
  end if;
  return new;
end
$$;

create or replace function sellerpilot_private.shopee_sg_r6_allow_receipt_rebind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_IMMUTABLE';
  end if;
  if new.source_job_id is distinct from old.source_job_id
     or new.source_attempt_id is distinct from old.source_attempt_id
     or new.listing_id is distinct from old.listing_id
     or new.owner_id is distinct from old.owner_id
     or new.merchant_id is distinct from old.merchant_id
     or new.shop_id is distinct from old.shop_id
     or new.seller_sku is distinct from old.seller_sku
     or new.global_item_name is distinct from old.global_item_name
     or new.local_item_name is distinct from old.local_item_name
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.prepared_payload_sha256 is distinct from old.prepared_payload_sha256
     or new.global_item_id is distinct from old.global_item_id
     or new.prepared_arguments is distinct from old.prepared_arguments
     or new.create_response is distinct from old.create_response
     or new.readback_response is distinct from old.readback_response
     or new.create_response_sha256 is distinct from old.create_response_sha256
     or new.readback_response_sha256 is distinct from old.readback_response_sha256
     or new.created_at is distinct from old.created_at then
    raise exception 'SHOPEE_SG_GLOBAL_CREATE_RECEIPT_IMMUTABLE';
  end if;
  return new;
end
$$;

drop trigger if exists shopee_sg_r6_stage_begin
  on sellerpilot_private.shopee_sg_create_stage_receipts;
create trigger shopee_sg_r6_stage_begin
before insert on sellerpilot_private.shopee_sg_create_stage_receipts
for each row execute function sellerpilot_private.shopee_sg_r6_stage_begin_trg();

drop trigger if exists shopee_sg_r6_stage_complete
  on sellerpilot_private.shopee_sg_create_stage_receipts;
create trigger shopee_sg_r6_stage_complete
after update on sellerpilot_private.shopee_sg_create_stage_receipts
for each row execute function sellerpilot_private.complete_shopee_sg_atomic_map_v1();

drop trigger if exists shopee_sg_global_create_receipts_immutable
  on sellerpilot_private.shopee_sg_global_create_receipts;
create trigger shopee_sg_global_create_receipts_immutable
before update or delete on sellerpilot_private.shopee_sg_global_create_receipts
for each row execute function sellerpilot_private.shopee_sg_r6_allow_receipt_rebind();

create or replace function public.sellerpilot_service_rebind_shopee_sg_successor_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'SHOPEE_SG_SUCCESSOR_TOKEN_INVALID';
  end if;
  return sellerpilot_private.rebind_shopee_sg_successor_v1(p_job_id, p_claim_token);
end
$$;

revoke all on function sellerpilot_private.assert_shopee_sg_transport_bytes_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.assert_shopee_sg_wh_list_body_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.assert_shopee_sg_wh_elig_body_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.assert_shopee_sg_one_full_draft_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.rebind_shopee_sg_successor_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_rebind_shopee_sg_successor_v1(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_rebind_shopee_sg_successor_v1(text, uuid, uuid)
  to service_role;


commit;
