begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
-- Restore the DB-attested seller lineage in the Mac Temu inquiry claim.
-- Provider access-token readback must still compare that lineage at runtime.
create function sellerpilot_private.hydrate_temu_local_cs_claim(p_claim jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;c sellerpilot_private.channel_credentials%rowtype;blocker text;
begin
 if p_claim is null or p_claim->>'channel'<>'temu' or p_claim->>'operation'<>'inquiries.list' then return p_claim;end if;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=(p_claim->>'id')::uuid
  and claim_token::text=p_claim->>'claim_token' and credential_id::text=p_claim->>'credential_id'
  and channel='temu' and operation='inquiries.list' and status='running' and lease_expires_at>clock_timestamp();
 if not found then raise exception 'TEMU_LOCAL_CLAIM_OWNERSHIP_LOST';end if;
 select * into c from sellerpilot_private.channel_credentials where id=j.credential_id and channel=j.channel and environment=j.environment;
 if not found or j.created_by is null or c.created_by is null or j.created_by<>c.created_by then
  blocker:='TEMU_JOB_CREDENTIAL_OWNER_MISMATCH';
 elsif coalesce(j.seller_account_key,'')!~'^[a-f0-9]{64}$' or j.seller_account_key is distinct from c.seller_account_key
  or c.seller_account_key_source is distinct from 'provider_certified_v1' or c.seller_account_verified_at is null
  or c.status<>'active' or (c.expires_at is not null and c.expires_at<=clock_timestamp()) then
  blocker:='TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED';
 end if;
 return p_claim||jsonb_build_object('credential_binding_context',case when blocker is not null then
  jsonb_build_object('contract','sellerpilot-cs-credential-context/1','status','blocked','blocker',blocker,'workerIdentityCompared',false)
 else jsonb_build_object('contract','sellerpilot-cs-credential-context/1','status','verified','credentialId',c.id,
  'sellerAccountKey',c.seller_account_key,'sellerAccountKeySource',c.seller_account_key_source,
  'sellerAccountVerifiedAt',c.seller_account_verified_at,'ownerBinding','job_credential_same_owner','workerIdentityCompared',false) end);
end $$;
revoke all on function sellerpilot_private.hydrate_temu_local_cs_claim(jsonb) from public,anon,authenticated,service_role;
do $guard$ begin
 if md5(pg_get_functiondef('public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure))<>'ef52739b54afbb11e5d7e37bc146a8ed' then raise exception 'TEMU_LOCAL_CLAIM_PREIMAGE_DRIFT';end if;
end $guard$;
alter function public.sellerpilot_claim_local_channel_executor_job(text,text,text,text) rename to sellerpilot_130730_claim_before_temu_context;
revoke all on function public.sellerpilot_130730_claim_before_temu_context(text,text,text,text) from public,anon,authenticated,service_role;
create function public.sellerpilot_claim_local_channel_executor_job(p_token_hash text,p_worker_version text,p_release_sha text,p_egress_ip_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return sellerpilot_private.hydrate_temu_local_cs_claim(public.sellerpilot_130730_claim_before_temu_context(p_token_hash,p_worker_version,p_release_sha,p_egress_ip_sha256));
end $$;
revoke all on function public.sellerpilot_claim_local_channel_executor_job(text,text,text,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_claim_local_channel_executor_job(text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
