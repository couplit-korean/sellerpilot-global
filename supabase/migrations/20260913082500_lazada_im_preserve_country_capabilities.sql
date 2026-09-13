begin;

-- Country diagnostics share an IM token. Preserve another country's proof only
-- when its own seller target and the current app/token fingerprints still match.
-- This does not infer grants for countries missing from the OAuth response.
do $$ begin
 if md5(pg_get_functiondef('sellerpilot_private.record_lazada_im_diagnostic_receipt()'::regprocedure))
   is distinct from '2a42586ac025cc51757f193a5c63db52' then
  raise exception 'LAZADA_IM_COUNTRY_CAPABILITY_PREIMAGE_DRIFT';
 end if;
end $$;

CREATE OR REPLACE FUNCTION sellerpilot_private.record_lazada_im_diagnostic_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or target_fingerprint is distinct from
       sellerpilot_private.lazada_im_secret_binding(s,country)->>'targetFingerprint');
 insert into sellerpilot_private.cs_credential_capability_bindings(credential_id,channel,operation,country,
  app_fingerprint,token_fingerprint,target_fingerprint,status,verified_job_id,verified_at,expires_at,updated_at)
 values(c.id,'lazada','inquiries.list',expected->>'country',expected->>'appFingerprint',expected->>'tokenFingerprint',
  expected->>'targetFingerprint','active',j.id,at_time,
  least(c.expires_at,nullif(s->>'im_access_token_expires_at','')::timestamptz),at_time)
 on conflict(credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint) do update set
  status='active',verified_job_id=excluded.verified_job_id,verified_at=excluded.verified_at,
  expires_at=excluded.expires_at,updated_at=excluded.updated_at;
 return new;
end $function$;

revoke all on function sellerpilot_private.record_lazada_im_diagnostic_receipt() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
