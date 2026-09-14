-- Exact SG registration continuation for main4940266, shop1719148844 and
-- merchant5511564. No old job, token, target claim or provider outcome is reset.
-- Evidence reviewed 2026-09-14: 145 inquiry jobs use shop-only refresh; old
-- orders943 is shop-only; listing99 failed in the preceding shop identity step;
-- merchant-capable category344 failed before the current merchant issue time.
-- Later global-category receipts7fa/711 are HTTP200. Old jobs lack execution
-- SHA/token receipts: this is bounded code+ledger evidence, not provider success
-- for a new refresh. Every new uncertain exchange remains fenced.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_11820_prepare_refresh_unsafe(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)'::regprocedure)
 is distinct from '720f723ce1e1f87dc9e633192155d0f9' then raise exception 'SHOPEE_SG_CORE_PREPARE_PREIMAGE_DRIFT';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure) is distinct from '805c08c3a73270392247723a31a30015' then raise exception 'SHOPEE_SG_REFRESH_PREIMAGE_DRIFT:sellerpilot_183000_claim_serverless_gateway_unsafe';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure) is distinct from '07d7f615bd74e7818af84c83ba49b152' then raise exception 'SHOPEE_SG_REFRESH_PREIMAGE_DRIFT:sellerpilot_11820_claim_gateway_unsafe';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)'::regprocedure) is distinct from 'f5eb6e00a9293c217adf71bfbc0b04e6' then raise exception 'SHOPEE_SG_REFRESH_PREIMAGE_DRIFT:sellerpilot_service_begin_cs_shopee_target_refresh_v1';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_service_prepare_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text,jsonb,timestamp with time zone,boolean,boolean)'::regprocedure) is distinct from '0876ea3e03f466a392f9c0179978ebce' then raise exception 'SHOPEE_SG_REFRESH_PREIMAGE_DRIFT:sellerpilot_service_prepare_cs_shopee_target_refresh_v1';end if;
 if (select md5(prosrc) from pg_proc where oid='sellerpilot_private.shopee_target_refresh_merge_v1(jsonb,jsonb,text,text,boolean)'::regprocedure) is distinct from '13c88937465d2340dd45909539322f12' then raise exception 'SHOPEE_SG_REFRESH_PREIMAGE_DRIFT:shopee_target_refresh_merge_v1';end if;
 if pg_get_functiondef('public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)'::regprocedure) is distinct from $preimage$CREATE OR REPLACE FUNCTION public.sellerpilot_service_prepare_gateway_credential_refresh(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_secret_payload jsonb, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_recovery_only boolean DEFAULT false, p_oauth_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
$preimage$ then raise exception 'SHOPEE_SG_SHARED_PREPARE_PREIMAGE_DRIFT';end if;
end $guard$;

create table sellerpilot_private.shopee_sg_registration_credential_lineage(
 credential_id uuid primary key references sellerpilot_private.channel_credentials(id),
 predecessor_id uuid references sellerpilot_private.channel_credentials(id),
 source_job_id uuid references sellerpilot_private.channel_gateway_jobs(id),
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create table sellerpilot_private.shopee_sg_registration_prior_fences(
 job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
 record_sha256 text not null check(record_sha256 ~ '^[a-f0-9]{64}$')
);
create table sellerpilot_private.shopee_sg_registration_refresh_claims(
 job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id),
 claim_token uuid not null,
 credential_id uuid not null references sellerpilot_private.channel_credentials(id),
 base_credential_version integer not null check(base_credential_version>0),
 target_type text not null,target_id text not null,
 source_payload_sha256 text not null check(source_payload_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null check(status in('active','recovery_preserved','prepared','conflict')),
 candidate_digest text,preparation jsonb,prepared_credential_id uuid,
 lease_expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(job_id,target_type,target_id),
 check((target_type='shop' and target_id='1719148844') or(target_type='merchant' and target_id='5511564'))
);
alter table sellerpilot_private.shopee_sg_registration_credential_lineage enable row level security;
alter table sellerpilot_private.shopee_sg_registration_prior_fences enable row level security;
alter table sellerpilot_private.shopee_sg_registration_refresh_claims enable row level security;
revoke all on sellerpilot_private.shopee_sg_registration_credential_lineage,
 sellerpilot_private.shopee_sg_registration_prior_fences,sellerpilot_private.shopee_sg_registration_refresh_claims
 from public,anon,authenticated,service_role;

create function sellerpilot_private.shopee_sg_prior_fence_sha256(p_job_id uuid)
returns text language sql stable security definer set search_path='' as $body$
 select encode(extensions.digest(to_jsonb(j)::text||coalesce(d.decrypted_secret,'')||coalesce(r.decrypted_secret,'')||
 coalesce((select to_jsonb(t)::text from sellerpilot_private.cs_shopee_target_refresh_claims t where t.job_id=j.id),''),'sha256'),'hex')
 from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.channel_credentials c on c.id=j.credential_id
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 left join vault.decrypted_secrets r on r.id=j.credential_refresh_recovery_vault_id where j.id=p_job_id
$body$;

-- Freeze the reviewed records, not a blanket channel exception. Unknown/new
-- uncertainty, changed recovery evidence and changed claims never match.
insert into sellerpilot_private.shopee_sg_registration_prior_fences
 select j.id,sellerpilot_private.shopee_sg_prior_fence_sha256(j.id)
 from sellerpilot_private.channel_gateway_jobs j
 where j.channel='shopee' and j.environment='production' and j.status='reconciliation_required'
 and(j.credential_refresh_in_flight or j.credential_refresh_recovery_vault_id is not null
 or(j.operation='oauth.exchange' and j.prepared_credential_id is not null and not j.oauth_exchange_completed));
do $incident$ begin
 if (select count(*) from sellerpilot_private.shopee_sg_registration_prior_fences)<>148
 or (select encode(extensions.digest(string_agg(job_id::text||':'||record_sha256,',' order by job_id),'sha256'),'hex')
 from sellerpilot_private.shopee_sg_registration_prior_fences) is distinct from '01fa0c4fbf8a537d911488eedb441b923e06458524015b1e4301d3617897ab2c'
 then raise exception 'SHOPEE_SG_PRIOR_EVIDENCE_DRIFT';end if;
end $incident$;
insert into sellerpilot_private.shopee_sg_registration_credential_lineage(credential_id,payload_sha256)
 select c.id,encode(extensions.digest(d.decrypted_secret::jsonb::text,'sha256'),'hex')
 from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where c.id='550d04ed-1e86-44a3-85a0-12ba17ce2374' and c.version=90 and c.status='active'
 and c.channel='shopee' and c.environment='production'
 and c.created_by='5286e97b-40aa-406f-9690-5697cf28cbb0'
 and c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null
 and d.decrypted_secret::jsonb->>'provider_account_subject'='shopee:main:4940266'
 and d.decrypted_secret::jsonb->>'provider_account_identity_version'='v1'
 and exists(select 1 from jsonb_array_elements(d.decrypted_secret::jsonb->'shopee_targets')t
 where t->>'type'='shop' and t->>'id'='1719148844' and t->>'access_token_expires_at'='2026-09-13T22:20:51.319Z')
 and exists(select 1 from jsonb_array_elements(d.decrypted_secret::jsonb->'shopee_targets')t
 where t->>'type'='merchant' and t->>'id'='5511564' and t->>'access_token_expires_at'='2026-09-04T13:39:52.351Z');
do $source$ begin
 if(select count(*) from sellerpilot_private.shopee_sg_registration_credential_lineage)<>1
 then raise exception 'SHOPEE_SG_SOURCE_LINEAGE_DRIFT';end if;
end $source$;

create function sellerpilot_private.shopee_sg_registration_refresh_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $body$
 select exists(
 select 1 from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.channel_credentials c on c.id=j.credential_id
 join sellerpilot_private.shopee_sg_registration_credential_lineage l on l.credential_id=c.id
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 cross join lateral(select case when j.operation='listing.publication.verify'
 then j.request_payload#>'{arguments,sellerpilotPublicationSource,sourceArguments}'
 else j.request_payload->'arguments' end a) args
 where j.id=p_job_id and j.channel='shopee' and j.environment='production'
 and c.channel=j.channel and c.environment=j.environment and c.status='active'
 and(c.expires_at is null or c.expires_at>clock_timestamp())
 and j.seller_account_key=c.seller_account_key and c.seller_account_key_source='provider_certified_v1'
 and c.seller_account_verified_at is not null
 -- Shared admins legitimately operate credentials owned by another admin.
 and exists(select 1 from sellerpilot_private.admin_users where user_id=j.created_by)
 and exists(select 1 from sellerpilot_private.admin_users where user_id=c.created_by)
 and d.decrypted_secret::jsonb->>'provider_account_subject'='shopee:main:4940266'
 and encode(extensions.digest(d.decrypted_secret::jsonb::text,'sha256'),'hex')=l.payload_sha256
 and(
 (j.operation='shops.get' and j.request_payload->>'shopId'='1719148844')
 or(j.operation in('categories.list','categories.suggest','categories.attributes','categories.validate')
 and coalesce(a->>'shopId',a->>'shop_id')='1719148844'
 and coalesce(a->>'merchantId',a->>'merchant_id','5511564')='5511564'
 and lower(coalesce(a->>'country','sg'))='sg')
 or(j.operation in('listing.create','listing.get','listing.publication.verify','listing.lineage.verify')
 and coalesce(a->>'shopId',a->>'shop_id',a#>>'{publish,shop_id}')='1719148844'
 and coalesce(a->>'merchantId',a->>'merchant_id','5511564')='5511564'
 and lower(coalesce(a->>'country','sg'))='sg'
 and exists(select 1 from sellerpilot_private.product_listings p where p.id=j.listing_id
 and p.product_id='c0bdb493-6447-41bf-af0a-46a3da7a75a8'))
 ))
$body$;

-- No correlated decrypt/hash call inside the148-row fence. Claimants use the
-- result through an uncorrelated SELECT InitPlan, once per claim statement.
create function sellerpilot_private.shopee_sg_registration_unblocked_job_ids()
returns uuid[] language plpgsql stable security definer set search_path='' as $body$
declare evidence_matches boolean;ids uuid[];
begin
 with evidence as materialized(
  select e.job_id,e.record_sha256,j as job_row,c.vault_secret_id,j.credential_refresh_recovery_vault_id recovery_id,
  (select to_jsonb(t)::text from sellerpilot_private.cs_shopee_target_refresh_claims t where t.job_id=j.id) target_claim
  from sellerpilot_private.shopee_sg_registration_prior_fences e
  left join sellerpilot_private.channel_gateway_jobs j on j.id=e.job_id
  left join sellerpilot_private.channel_credentials c on c.id=j.credential_id
 ), secret_ids as materialized(
  select vault_secret_id id from evidence union select recovery_id from evidence where recovery_id is not null
 ), secrets as materialized(
  select d.id,d.decrypted_secret from vault.decrypted_secrets d join secret_ids wanted on wanted.id=d.id
 )
 select count(*)=148 and coalesce(bool_and(e.record_sha256=encode(extensions.digest(
  to_jsonb(e.job_row)::text||coalesce(d.decrypted_secret,'')||coalesce(r.decrypted_secret,'')||coalesce(e.target_claim,''),
  'sha256'),'hex')),false) into evidence_matches
 from evidence e left join secrets d on d.id=e.vault_secret_id left join secrets r on r.id=e.recovery_id;
 if evidence_matches is not true then return array[]::uuid[];end if;
 if exists(select 1 from sellerpilot_private.channel_gateway_jobs j
  where j.channel='shopee' and j.environment='production' and j.status='reconciliation_required'
  and(j.credential_refresh_in_flight or j.credential_refresh_recovery_vault_id is not null
   or(j.operation='oauth.exchange' and j.prepared_credential_id is not null and not j.oauth_exchange_completed))
  and not exists(select 1 from sellerpilot_private.shopee_sg_registration_prior_fences e where e.job_id=j.id))
 then return array[]::uuid[];end if;
 select coalesce(array_agg(j.id),array[]::uuid[]) into ids
 from sellerpilot_private.channel_gateway_jobs j
 where case when j.channel='shopee' and j.environment='production' and j.status in('queued','running')
  and j.operation in('shops.get','categories.list','categories.suggest','categories.attributes','categories.validate',
   'listing.create','listing.get','listing.publication.verify','listing.lineage.verify')
  then sellerpilot_private.shopee_sg_registration_refresh_job(j.id) else false end;
 return ids;
end $body$;

create function sellerpilot_private.shopee_sg_registration_refresh_owned(p_token_hash text,p_job_id uuid,p_claim_token uuid)
returns boolean language sql stable security definer set search_path='' as $body$
 select sellerpilot_private.serverless_cs_job_is_owned(p_token_hash,p_job_id,p_claim_token,true)
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.ai_cli_worker_tokens t on t.id=j.worker_token_id
 join sellerpilot_private.local_channel_executor_routes r on r.credential_id=j.credential_id
 and r.worker_token_id=t.id and r.channel=j.channel and r.operation=j.operation
 where j.id=p_job_id and j.claim_token=p_claim_token and j.status='running' and j.lease_expires_at>clock_timestamp()
 and t.token_hash=p_token_hash and t.scope='gateway' and t.status='active' and t.expires_at>clock_timestamp()
 and sellerpilot_private.shopee_sg_registration_refresh_job(j.id)
 and sellerpilot_private.local_channel_executor_job_allowed(j.id,j.credential_id,t.id,t.last_version,r.release_sha,r.egress_ip_sha256))
$body$;

CREATE OR REPLACE FUNCTION public.sg134000_prior_begin(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_target_type text, p_target_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
exception when sqlstate '55000' then
  -- Convert only our proven non-transient fence rejection. The subtransaction
  -- rolls back the attempted claim replacement; the prior lineage survives.
  if sqlerrm <> 'SHOPEE_PRIOR_REFRESH_RECONCILIATION_REQUIRED' then
    raise;
  end if;
  return jsonb_build_object(
    'contract','sellerpilot-shopee-target-refresh-claim/1',
    'status','conflict',
    'reason','prior_refresh_reconciliation_required'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.sg134000_prior_target_prepare(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_target_type text, p_target_id text, p_candidate_payload jsonb, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_recovery_only boolean DEFAULT false, p_oauth_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.sg134000_prior_prepare(p_token_hash text, p_job_id uuid, p_claim_token uuid, p_secret_payload jsonb, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_recovery_only boolean DEFAULT false, p_oauth_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

do $claim_patch$
declare signature text;body text;next_body text;alias text;
begin
 foreach signature in array array['public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)',
 'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'] loop
 body:=pg_get_functiondef(signature::regprocedure);
 alias:=case when signature like '%183000%' then 'job' else 'j' end;
 next_body:=regexp_replace(body,'(and unresolved.status = ''reconciliation_required'')',
 E'\\1 and not ('||alias||'.id = any ((select sellerpilot_private.shopee_sg_registration_unblocked_job_ids())::uuid[]) and unresolved.id in (select job_id from sellerpilot_private.shopee_sg_registration_prior_fences))');
 if next_body=body or (length(body)-length(replace(body,'and unresolved.status = ''reconciliation_required''','')))
 /length('and unresolved.status = ''reconciliation_required''')<>1 then
 raise exception 'SHOPEE_SG_CLAIM_PATCH_DRIFT';end if;
 execute next_body;
 end loop;
end $claim_patch$;

create or replace function public.sellerpilot_service_prepare_gateway_credential_refresh(
 p_token_hash text,p_job_id uuid,p_claim_token uuid,p_secret_payload jsonb,
 p_expires_at timestamptz default null,p_recovery_only boolean default false,p_oauth_complete boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare scoped boolean;source_id uuid;old_payload jsonb;result jsonb;new_id uuid;stored jsonb;new_hash text;target_claim record;
begin
 scoped:=sellerpilot_private.shopee_sg_registration_refresh_job(p_job_id);
 if scoped then
  select j.credential_id,d.decrypted_secret::jsonb into source_id,old_payload
  from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.channel_credentials c on c.id=j.credential_id
  join vault.decrypted_secrets d on d.id=c.vault_secret_id where j.id=p_job_id;
  if p_oauth_complete then raise exception 'SHOPEE_SG_OAUTH_NOT_AUTHORIZED';end if;
  if p_expires_at is distinct from(old_payload->>'authorization_expires_at')::timestamptz
  then raise exception 'SHOPEE_SG_AUTHORIZATION_EXPIRY_CHANGED';end if;
  if old_payload->'shopee_targets' is distinct from p_secret_payload->'shopee_targets' then
   select r.target_type,r.target_id into target_claim from sellerpilot_private.shopee_sg_registration_refresh_claims r
   where r.job_id=p_job_id and r.claim_token=p_claim_token and r.credential_id=source_id
   and r.status in('active','recovery_preserved') and r.lease_expires_at>clock_timestamp();
   if not found then raise exception 'SHOPEE_SG_TARGET_CLAIM_REQUIRED';end if;
   -- Also validate direct shared-RPC calls: a target claim is never authority
   -- to replace another shop's tokens or the merchant/main account identity.
   p_secret_payload:=sellerpilot_private.shopee_target_refresh_merge_v1(
    old_payload,p_secret_payload,target_claim.target_type,target_claim.target_id,p_recovery_only);
  else
   if(old_payload-array['shop_id','merchant_id','access_token','refresh_token',
      'access_token_expires_at','refresh_token_expires_at','shopee_shop_identities'])
    is distinct from(p_secret_payload-array['shop_id','merchant_id','access_token','refresh_token',
      'access_token_expires_at','refresh_token_expires_at','shopee_shop_identities'])
    or(coalesce(old_payload->'shopee_shop_identities','{}'::jsonb)-'1719148844')
    is distinct from(coalesce(p_secret_payload->'shopee_shop_identities','{}'::jsonb)-'1719148844') then
    raise exception 'SHOPEE_SG_IDENTITY_METADATA_WIDENED';
   end if;
   if not exists(select 1 from jsonb_array_elements(old_payload->'shopee_targets') t
   where (t->>'type',t->>'id') in(('shop','1719148844'),('merchant','5511564'))
   and((t->>'type'='shop' and p_secret_payload->>'shop_id'=t->>'id' and not(p_secret_payload ? 'merchant_id'))
    or(t->>'type'='merchant' and p_secret_payload->>'merchant_id'=t->>'id' and not(p_secret_payload ? 'shop_id')))
   and t->>'access_token'=p_secret_payload->>'access_token'
   and t->>'refresh_token'=p_secret_payload->>'refresh_token'
   and t->>'access_token_expires_at'=p_secret_payload->>'access_token_expires_at'
   and t->>'refresh_token_expires_at'=p_secret_payload->>'refresh_token_expires_at') then
    raise exception 'SHOPEE_SG_TARGET_PROJECTION_MISMATCH';
   end if;
  end if;
 end if;
 result:=public.sg134000_prior_prepare(p_token_hash,p_job_id,p_claim_token,p_secret_payload,p_expires_at,p_recovery_only,p_oauth_complete);
 if scoped and result->>'status'='prepared' then
  new_id:=(result->>'credential_id')::uuid;
  select d.decrypted_secret::jsonb into stored from sellerpilot_private.channel_credentials c
  join vault.decrypted_secrets d on d.id=c.vault_secret_id
  join sellerpilot_private.channel_credentials source on source.id=source_id
  where c.id=new_id and c.status='active' and c.channel='shopee' and c.environment='production'
  and c.created_by=source.created_by and c.seller_account_key=source.seller_account_key
  and c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null;
  if stored is null or stored->>'provider_account_subject' is distinct from 'shopee:main:4940266'
  then raise exception 'SHOPEE_SG_PREPARED_LINEAGE_MISMATCH';end if;
  new_hash:=encode(extensions.digest(stored::text,'sha256'),'hex');
  if exists(select 1 from sellerpilot_private.shopee_sg_registration_credential_lineage where credential_id=new_id and payload_sha256<>new_hash)
  then raise exception 'SHOPEE_SG_PREPARED_DIGEST_MISMATCH';end if;
  insert into sellerpilot_private.shopee_sg_registration_credential_lineage(credential_id,predecessor_id,source_job_id,payload_sha256)
  values(new_id,source_id,p_job_id,new_hash) on conflict(credential_id) do nothing;
 end if;
 return result;
end $body$;

create or replace function public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
 p_token_hash text,p_job_id uuid,p_claim_token uuid,p_target_type text,p_target_id text
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare j record;r sellerpilot_private.shopee_sg_registration_refresh_claims%rowtype;h text;
begin
 if not sellerpilot_private.shopee_sg_registration_refresh_job(p_job_id) then
 return public.sg134000_prior_begin(p_token_hash,p_job_id,p_claim_token,p_target_type,p_target_id);end if;
 if not((p_target_type='shop' and p_target_id='1719148844') or(p_target_type='merchant' and p_target_id='5511564'))
 or not sellerpilot_private.shopee_sg_registration_refresh_owned(p_token_hash,p_job_id,p_claim_token)
 then return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','ownership_lost');end if;
 if sellerpilot_private.shopee_sg_create_job_v1(p_job_id,p_claim_token)
 and sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(p_job_id,p_claim_token) is not true
 then return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','conflict');end if;
 perform pg_advisory_xact_lock(193674993,821065042);
 select g.*,c.version,l.payload_sha256 into j from sellerpilot_private.channel_gateway_jobs g
 join sellerpilot_private.channel_credentials c on c.id=g.credential_id
 join sellerpilot_private.shopee_sg_registration_credential_lineage l on l.credential_id=c.id
 where g.id=p_job_id and g.claim_token=p_claim_token and g.status='running' and g.lease_expires_at>clock_timestamp()
 for update of g,c;
 if not found then return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','conflict');end if;
 -- The lease is not permission to retry a rotating token. A prior uncertain
 -- SG/merchant exchange remains a hard fence even after its worker disappears.
 if not(p_job_id=any(sellerpilot_private.shopee_sg_registration_unblocked_job_ids()))
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs prior
 where prior.channel='shopee' and prior.environment='production' and prior.id<>p_job_id and prior.status='running')
 then return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','conflict');end if;
 select * into r from sellerpilot_private.shopee_sg_registration_refresh_claims
 where job_id=p_job_id and target_type=p_target_type and target_id=p_target_id for update;
 if found then
  if r.claim_token<>p_claim_token or r.credential_id<>j.credential_id or r.base_credential_version<>j.version
  or r.source_payload_sha256<>j.payload_sha256 or r.lease_expires_at<=clock_timestamp()
  or r.status not in('active','recovery_preserved') then
  return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status','conflict');end if;
 else
  insert into sellerpilot_private.shopee_sg_registration_refresh_claims(
   job_id,claim_token,credential_id,base_credential_version,target_type,target_id,source_payload_sha256,status,lease_expires_at)
  values(p_job_id,p_claim_token,j.credential_id,j.version,p_target_type,p_target_id,j.payload_sha256,'active',least(j.lease_expires_at,clock_timestamp()+interval '5 minutes'));
 end if;
 if public.sellerpilot_service_begin_gateway_credential_refresh(p_token_hash,p_job_id,p_claim_token) is not true
 then raise exception 'SHOPEE_SG_REFRESH_OWNERSHIP_LOST';end if;
 return jsonb_build_object('contract','sellerpilot-shopee-target-refresh-claim/1','status',case when r.job_id is null then 'acquired' else 'reused' end,
 'targetType',p_target_type,'targetId',p_target_id,'baseVersion',j.version);
end $body$;

create or replace function public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(
 p_token_hash text,p_job_id uuid,p_claim_token uuid,p_target_type text,p_target_id text,p_candidate_payload jsonb,
 p_expires_at timestamptz default null,p_recovery_only boolean default false,p_oauth_complete boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare r sellerpilot_private.shopee_sg_registration_refresh_claims%rowtype;j record;merged jsonb;result jsonb;h text;
begin
 select * into r from sellerpilot_private.shopee_sg_registration_refresh_claims
 where job_id=p_job_id and target_type=p_target_type and target_id=p_target_id for update;
 if not found then return public.sg134000_prior_target_prepare(p_token_hash,p_job_id,p_claim_token,p_target_type,p_target_id,p_candidate_payload,p_expires_at,p_recovery_only,p_oauth_complete);end if;
 -- A lost HTTP response must not force another rotating-token exchange.
 -- Return the exact already committed preparation only to the same live
 -- claimant and identical candidate; never reactivate the old credential.
 if r.status='prepared' and r.claim_token=p_claim_token and not p_recovery_only and not p_oauth_complete
 and sellerpilot_private.shopee_sg_registration_refresh_owned(p_token_hash,p_job_id,p_claim_token)
 and exists(select 1 from sellerpilot_private.channel_gateway_jobs g
 where g.id=p_job_id and g.credential_id=r.prepared_credential_id) then
  select d.decrypted_secret::jsonb payload into j from sellerpilot_private.channel_credentials c
  join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=r.credential_id;
  if encode(extensions.digest(j.payload::text,'sha256'),'hex')=r.source_payload_sha256 then
   merged:=sellerpilot_private.shopee_target_refresh_merge_v1(j.payload,p_candidate_payload,p_target_type,p_target_id,false);
   if encode(extensions.digest(merged::text,'sha256'),'hex')=r.candidate_digest then
    return r.preparation||jsonb_build_object('reused',true,'targetType',p_target_type,'targetId',p_target_id,
     'baseVersion',r.base_credential_version,'payloadDigest',r.candidate_digest);
   end if;
  end if;
  return jsonb_build_object('status','conflict');
 end if;
 if r.claim_token<>p_claim_token or r.status not in('active','recovery_preserved') or r.lease_expires_at<=clock_timestamp()
 or not sellerpilot_private.shopee_sg_registration_refresh_owned(p_token_hash,p_job_id,p_claim_token)
 then return jsonb_build_object('status','conflict');end if;
 select g.credential_id,c.version,d.decrypted_secret::jsonb payload into j
 from sellerpilot_private.channel_gateway_jobs g join sellerpilot_private.channel_credentials c on c.id=g.credential_id
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where g.id=p_job_id and g.claim_token=p_claim_token and g.status='running' and g.lease_expires_at>clock_timestamp()
 and c.status='active' for update of g,c;
 if not found or j.credential_id<>r.credential_id or j.version<>r.base_credential_version
 or encode(extensions.digest(j.payload::text,'sha256'),'hex')<>r.source_payload_sha256
 then return jsonb_build_object('status','conflict');end if;
 merged:=sellerpilot_private.shopee_target_refresh_merge_v1(j.payload,p_candidate_payload,p_target_type,p_target_id,p_recovery_only);
 h:=encode(extensions.digest(merged::text,'sha256'),'hex');
 result:=public.sellerpilot_service_prepare_gateway_credential_refresh(p_token_hash,p_job_id,p_claim_token,merged,p_expires_at,p_recovery_only,p_oauth_complete);
 if result->>'status' not in('prepared','recovery_preserved') then return result;end if;
 update sellerpilot_private.shopee_sg_registration_refresh_claims set
 status=case when p_recovery_only then 'recovery_preserved' else 'prepared' end,
 candidate_digest=h,preparation=result,prepared_credential_id=case when result->>'status'='prepared' then(result->>'credential_id')::uuid else null end,
 lease_expires_at=case when p_recovery_only then clock_timestamp()+interval '5 minutes' else clock_timestamp() end,updated_at=clock_timestamp()
 where job_id=p_job_id and target_type=p_target_type and target_id=p_target_id;
 return result||jsonb_build_object('targetType',p_target_type,'targetId',p_target_id,'baseVersion',r.base_credential_version,'payloadDigest',h);
end $body$;


-- Existing store CHECK accepts shop projections only. A merchant projection
-- is accepted solely under the same live independent SG registration claim;
-- no other merchant, consumer or generic OAuth path obtains this exception.
do $merchant_store$
declare body text;needle text;replacement text;
begin
 body:=pg_get_functiondef('public.sellerpilot_11820_prepare_refresh_unsafe(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)'::regprocedure);
 needle:='or coalesce(p_secret_payload->>''shop_id'', '''') !~ ''^[0-9]+$''';
 replacement:=$replace$or (coalesce(p_secret_payload->>'shop_id', '') !~ '^[0-9]+$'
 and not coalesce((p_secret_payload->>'merchant_id'='5511564'
 and exists(select 1 from sellerpilot_private.shopee_sg_registration_refresh_claims sg
 where sg.job_id=p_job_id and sg.claim_token=p_claim_token and sg.credential_id=v_job.credential_id
 and sg.target_type='merchant' and sg.target_id='5511564' and sg.status in('active','recovery_preserved')
 and sg.lease_expires_at>clock_timestamp()
 and sellerpilot_private.shopee_sg_registration_refresh_job(p_job_id))),false))$replace$;
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 then
 raise exception 'SHOPEE_SG_CORE_PREPARE_CHECK_DRIFT';end if;
 execute replace(body,needle,replacement);
end $merchant_store$;

revoke all on function public.sg134000_prior_begin(text,uuid,uuid,text,text),
 public.sg134000_prior_target_prepare(text,uuid,uuid,text,text,jsonb,timestamptz,boolean,boolean),
 public.sg134000_prior_prepare(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)
 from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.shopee_sg_prior_fence_sha256(uuid),
 sellerpilot_private.shopee_sg_registration_refresh_job(uuid),
 sellerpilot_private.shopee_sg_registration_unblocked_job_ids(),
 sellerpilot_private.shopee_sg_registration_refresh_owned(text,uuid,uuid)
 from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
