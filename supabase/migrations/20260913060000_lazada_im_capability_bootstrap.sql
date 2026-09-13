begin;

do $$ begin
 if md5(pg_get_functiondef('public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)'::regprocedure))
   is distinct from '4799a49d0ffbf450ce44f391d1c58427'
  or to_regprocedure('public.sellerpilot_130600_record_cs_binding_before_im(text,uuid,uuid,jsonb)') is not null
  then raise exception 'LAZADA_IM_BINDING_PREIMAGE_DRIFT';end if;
end $$;

-- A commerce /seller/get grant does not prove IM access. Only a completed
-- exact IM diagnostic can admit the first history bootstrap for its country.
create function sellerpilot_private.lazada_im_secret_binding(p_secret jsonb,p_country text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_country text:=lower(p_country);v_im jsonb;v_main jsonb;v_seller text;
begin
 if v_country not in('my','sg','ph','th','vn','id')
  or p_secret->>'im_identity_source' is distinct from 'lazada.oauth_token'
  or jsonb_typeof(p_secret->'im_country_user_info') is distinct from 'array'
  or jsonb_typeof(p_secret->'country_user_info') is distinct from 'array'
  or coalesce(p_secret->>'im_app_key','')='' or coalesce(p_secret->>'im_access_token','')=''
  or coalesce(p_secret->>'im_refresh_token','')='' then return null;end if;
 for v_im in select value from jsonb_array_elements(p_secret->'im_country_user_info') loop
  if coalesce(v_im->>'seller_id','')!~'^[1-9][0-9]{0,31}$'
    or not exists(select 1 from jsonb_array_elements(p_secret->'country_user_info') m
      where lower(m->>'country')=lower(v_im->>'country') and m->>'seller_id'=v_im->>'seller_id') then return null;end if;
  if lower(v_im->>'country')=v_country then
   if v_seller is not null and v_seller<>v_im->>'seller_id' then return null;end if;
   v_seller:=v_im->>'seller_id';
  end if;
 end loop;
 if v_seller is null then return null;end if;
 return jsonb_build_object('contract','sellerpilot-lazada-im-capability/1','country',upper(v_country),'sellerId',v_seller,
  'appFingerprint',encode(extensions.digest(p_secret->>'im_app_key','sha256'),'hex'),
  'tokenFingerprint',encode(extensions.digest((p_secret->>'im_access_token')||E'\x1f'||(p_secret->>'im_refresh_token'),'sha256'),'hex'),
  'targetFingerprint',encode(extensions.digest(v_country||':'||v_seller,'sha256'),'hex'));
end $$;
revoke all on function sellerpilot_private.lazada_im_secret_binding(jsonb,text) from public,anon,authenticated,service_role;

create function sellerpilot_private.record_lazada_im_diagnostic_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;c sellerpilot_private.channel_credentials%rowtype;
 s jsonb;proof jsonb;expected jsonb;at_time timestamptz:=clock_timestamp();
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=new.job_id;
 if j.channel<>'lazada' or j.operation<>'diagnostic.test' or j.status<>'succeeded'
  or j.request_payload#>'{arguments,lazadaImCapabilityProbe}' is distinct from 'true'::jsonb then return new;end if;
 proof:=j.response_payload#>'{diagnostic,lazadaImCapability}';
 select * into c from sellerpilot_private.channel_credentials where id=j.credential_id
  and channel='lazada' and environment='production' and status='active'
  and seller_account_key=j.seller_account_key and seller_account_key_source='provider_certified_v1'
  and seller_account_verified_at is not null and created_by=j.created_by
  and (expires_at is null or expires_at>at_time);
 if not found or j.prepared_credential_id is distinct from j.credential_id
  or j.credential_refresh_in_flight or j.credential_refresh_recovery_vault_id is not null
  or j.response_payload->'ok' is distinct from 'true'::jsonb
  or j.response_payload#>>'{diagnostic,status}' is distinct from 'passed'
  or not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens t where t.id=new.worker_token_id
    and t.scope in('gateway','serverless_cs') and t.status='active' and t.expires_at>at_time)
  then raise exception 'LAZADA_IM_DIAGNOSTIC_COMPLETION_REQUIRED';end if;
 select decrypted_secret::jsonb into s from vault.decrypted_secrets where id=c.vault_secret_id;
 expected:=sellerpilot_private.lazada_im_secret_binding(s,j.request_payload#>>'{arguments,country}');
 if expected is null or (proof-'responseSha256'-'observedAt') is distinct from expected
  or coalesce(proof->>'responseSha256','')!~'^[a-f0-9]{64}$'
  or coalesce((proof->>'observedAt')::timestamptz between at_time-interval '5 minutes' and at_time+interval '1 minute',false) is not true
  or coalesce(nullif(s->>'im_access_token_expires_at','')::timestamptz>at_time,false) is not true
  then raise exception 'LAZADA_IM_DIAGNOSTIC_PROOF_MISMATCH';end if;
 update sellerpilot_private.cs_credential_capability_bindings set status='superseded',updated_at=at_time
  where credential_id=c.id and channel='lazada' and operation='inquiries.list' and status='active'
   and(app_fingerprint<>expected->>'appFingerprint' or token_fingerprint<>expected->>'tokenFingerprint'
     or country<>expected->>'country' or target_fingerprint<>expected->>'targetFingerprint');
 insert into sellerpilot_private.cs_credential_capability_bindings(credential_id,channel,operation,country,
  app_fingerprint,token_fingerprint,target_fingerprint,status,verified_job_id,verified_at,expires_at,updated_at)
 values(c.id,'lazada','inquiries.list',expected->>'country',expected->>'appFingerprint',expected->>'tokenFingerprint',
  expected->>'targetFingerprint','active',j.id,at_time,
  least(c.expires_at,nullif(s->>'im_access_token_expires_at','')::timestamptz),at_time)
 on conflict(credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint) do update set
  status='active',verified_job_id=excluded.verified_job_id,verified_at=excluded.verified_at,
  expires_at=excluded.expires_at,updated_at=excluded.updated_at;
 return new;
end $$;
revoke all on function sellerpilot_private.record_lazada_im_diagnostic_receipt() from public,anon,authenticated,service_role;
create trigger sellerpilot_lazada_im_diagnostic_receipt after insert on sellerpilot_private.gateway_completion_receipts
 for each row execute function sellerpilot_private.record_lazada_im_diagnostic_receipt();

-- Preserve the current Temu wrapper and its exact provider target checks.
alter function public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)
 rename to sellerpilot_130600_record_cs_binding_before_im;
revoke all on function public.sellerpilot_130600_record_cs_binding_before_im(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.sellerpilot_service_record_cs_credential_binding_v1(p_token_hash text,p_job_id uuid,p_claim_token uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;s jsonb;expected jsonb;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job_id;
 if j.channel='lazada' and coalesce(j.request_payload#>>'{arguments,kind}','') not in('product_review','product_review_readback') then
  select v.decrypted_secret::jsonb into s from sellerpilot_private.channel_credentials c
   join vault.decrypted_secrets v on v.id=c.vault_secret_id where c.id=j.credential_id;
  expected:=sellerpilot_private.lazada_im_secret_binding(s,p_evidence->>'country');
  if expected is null or p_evidence->>'appFingerprint' is distinct from expected->>'appFingerprint'
   or p_evidence->>'tokenFingerprint' is distinct from expected->>'tokenFingerprint'
   or p_evidence->'targetFingerprints' is distinct from jsonb_build_array(expected->>'targetFingerprint')
   then raise exception 'LAZADA_IM_BINDING_CREDENTIAL_MISMATCH';end if;
 end if;
 return public.sellerpilot_130600_record_cs_binding_before_im(p_token_hash,p_job_id,p_claim_token,p_evidence);
end $$;
revoke all on function public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
