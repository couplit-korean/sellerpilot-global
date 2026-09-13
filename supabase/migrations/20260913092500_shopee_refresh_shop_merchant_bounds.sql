begin;

-- Eight shops may coexist with separately authenticated merchant targets.
-- Preserve the original per-type maximum and all exact-target/CAS checks.
do $$ begin
 if md5(pg_get_functiondef('sellerpilot_private.shopee_target_refresh_merge_v1(jsonb,jsonb,text,text,boolean)'::regprocedure))
   is distinct from '6b2219e99b58d971ef9e3966d8524319' then raise exception 'SHOPEE_REFRESH_BOUNDS_PREIMAGE_DRIFT'; end if;
end $$;

CREATE OR REPLACE FUNCTION sellerpilot_private.shopee_target_refresh_merge_v1(p_base_payload jsonb, p_candidate_payload jsonb, p_target_type text, p_target_id text, p_recovery_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or jsonb_array_length(p_base_payload->'shopee_targets') not between 1 and 16
     or (select count(*) from jsonb_array_elements(p_base_payload->'shopee_targets') t
          where t->>'type'='shop') > 8
     or (select count(*) from jsonb_array_elements(p_base_payload->'shopee_targets') t
          where t->>'type'='merchant') > 8
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
end $function$;
revoke all on function sellerpilot_private.shopee_target_refresh_merge_v1(jsonb,jsonb,text,text,boolean) from public,anon,authenticated,service_role;

-- A lease timeout does not settle a possibly consumed rotating token. Keep the
-- previous claim until its durable result is reconciled or a new credential is
-- authorized; a later CS job must not silently replace that lineage and retry.
create function sellerpilot_private.guard_shopee_unresolved_refresh_claim()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.job_id,new.claim_token,new.target_type,new.target_id)
      is distinct from (old.job_id,old.claim_token,old.target_type,old.target_id)
    and exists(select 1 from sellerpilot_private.channel_gateway_jobs j
      where j.id=old.job_id and j.credential_refresh_in_flight) then
  raise exception 'SHOPEE_PRIOR_REFRESH_RECONCILIATION_REQUIRED' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function sellerpilot_private.guard_shopee_unresolved_refresh_claim() from public,anon,authenticated,service_role;
create trigger sellerpilot_guard_shopee_unresolved_refresh_claim
 before update on sellerpilot_private.cs_shopee_target_refresh_claims
 for each row execute function sellerpilot_private.guard_shopee_unresolved_refresh_claim();
notify pgrst,'reload schema';
commit;
