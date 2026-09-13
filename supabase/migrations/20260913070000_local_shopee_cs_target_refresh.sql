begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
-- Reuse the tested per-shop refresh lock/CAS path for an approved Mac CS read.
-- Keep the existing cloud and exact Coupang ownership predicate unchanged.
do $guard$ begin
 if md5(pg_get_functiondef('sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)'::regprocedure)) is distinct from 'bd5d8f5897dbb2aa451ffdfb573401bd' then raise exception 'SHOPEE_CS_OWNERSHIP_PREIMAGE_DRIFT';end if;
end $guard$;
alter function sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean) rename to cs_owned_before_130700_local_shopee;
revoke all on function sellerpilot_private.cs_owned_before_130700_local_shopee(text,uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function sellerpilot_private.serverless_cs_job_is_owned(p_token_hash text,p_job_id uuid,p_claim_token uuid,p_require_live_lease boolean default true)
returns boolean language sql stable set search_path='' as $$
 select sellerpilot_private.cs_owned_before_130700_local_shopee(p_token_hash,p_job_id,p_claim_token,p_require_live_lease)
 or (p_require_live_lease and exists(
  select 1 from sellerpilot_private.channel_gateway_jobs j
  join sellerpilot_private.ai_cli_worker_tokens t on t.id=j.worker_token_id
  join sellerpilot_private.channel_credentials c on c.id=j.credential_id
  join sellerpilot_private.local_channel_executor_routes r on r.credential_id=c.id
   and r.worker_token_id=t.id and r.channel=j.channel and r.operation=j.operation
  where j.id=p_job_id and j.claim_token=p_claim_token and j.status='running'
   and j.lease_expires_at>clock_timestamp() and j.channel='shopee' and j.operation='inquiries.list'
   and t.token_hash=p_token_hash and t.scope='gateway' and t.status='active'
   and t.expires_at>clock_timestamp() and t.last_seen_at>clock_timestamp()-interval '3 minutes'
   and c.channel='shopee' and c.status='active' and c.environment='production'
   and (c.expires_at is null or c.expires_at>clock_timestamp())
   and c.created_by=j.created_by
   and c.seller_account_key=j.seller_account_key and c.seller_account_key=r.seller_account_key
   and c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null
   and r.enabled and r.approved_at<=clock_timestamp() and r.expires_at>clock_timestamp()
   and r.release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
   and r.egress_ip_sha256 ~ '^[a-f0-9]{64}$'
   and t.last_version='sellerpilot-cli-worker/1.61+'||r.release_sha||'.'||left(r.egress_ip_sha256,11)
   and exists(select 1 from sellerpilot_private.admin_users a where a.user_id=r.owner_id)
   and exists(select 1 from sellerpilot_private.admin_users a where a.user_id=t.created_by)
   and exists(select 1 from sellerpilot_private.admin_users a where a.user_id=r.approved_by)
   and exists(select 1 from sellerpilot_private.admin_users a where a.user_id=c.created_by)
 ));
$$;
revoke all on function sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
