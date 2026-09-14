-- Official Open Platform log: one SG refresh was rejected before issuance.
-- Preserve the old job/status/error and target-claim evidence; never requeue it.
-- Existing approved Mac egress performs future exact-SG discovery. No OAuth,
-- scope expansion, provider request or new job is executed by this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preimages$
declare e record;
begin
 for e in select * from (values
 ('sellerpilot_private.serverless_gateway_job_allowed(text,text)','55429092dd3cc0c8ef77e3b4aa57aa7a'),
 ('sellerpilot_private.local_channel_executor_access(text,text)','2cc50f6d21ced9314839bcf0e800a90b'),
 ('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)','e39f070e5655bc6cc9516aa11d7a5ac9'),
 ('sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)','b1d542723830a3396b4eb272a27db7b1'),
 ('sellerpilot_private.shopee_sg_registration_refresh_job(uuid)','ebbb8ce767d6db6455964365b32c685d'),
 ('public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text,jsonb,timestamptz,boolean,boolean)','7686d69204f3cdbf406f3a37749881d7')
 ) x(signature,hash) loop
  if (select md5(prosrc) from pg_proc where oid=e.signature::regprocedure) is distinct from e.hash
  then raise exception 'SHOPEE_SG_LOCAL_DISCOVERY_PREIMAGE_DRIFT:%',e.signature;end if;
 end loop;
end $preimages$;

create table sellerpilot_private.shopee_sg_refresh_rejection_receipts(
 job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
 job_before jsonb not null,target_claim_before jsonb not null,official_response jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.shopee_sg_refresh_rejection_receipts enable row level security;
revoke all on sellerpilot_private.shopee_sg_refresh_rejection_receipts from public,anon,authenticated,service_role;

do $rejection$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;
 t sellerpilot_private.shopee_sg_registration_refresh_claims%rowtype;
begin
 perform pg_advisory_xact_lock(193674995,hashtext('shopee:production'));
 select * into j from sellerpilot_private.channel_gateway_jobs where id='4a45f463-bc16-41fe-847b-ce5dde2a0172' for update;
 select * into t from sellerpilot_private.shopee_sg_registration_refresh_claims where job_id=j.id and target_type='shop' and target_id='1719148844' for update;
 if md5(to_jsonb(j)::text) is distinct from 'cc286ccb94e8f20dcf87d90286563080'
 or j.credential_id is distinct from '550d04ed-1e86-44a3-85a0-12ba17ce2374'::uuid
 or j.status is distinct from 'reconciliation_required' or j.operation is distinct from 'shops.get'
 or j.request_payload is distinct from '{"shopId":"1719148844"}'::jsonb
 or j.error_message is distinct from 'serverless_cs_execution_failed'
 or j.credential_refresh_in_flight is distinct from true
 or j.credential_refresh_started_at is distinct from '2026-09-14T00:55:07.091392Z'::timestamptz
 or j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null
 or j.provider_mutation_started_at is not null or j.response_payload is not null
 or j.claim_token is not null or j.lease_expires_at is not null
 or t.job_id is null or t.status<>'active' or t.base_credential_version<>90 or t.credential_id is distinct from j.credential_id
 or t.lease_expires_at is distinct from '2026-09-14T01:00:07.182052Z'::timestamptz
 or t.candidate_digest is not null or t.preparation is not null or t.prepared_credential_id is not null
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs where channel='shopee' and environment='production' and status='running')
 or not exists(select 1 from sellerpilot_private.channel_credentials c
 join sellerpilot_private.shopee_sg_registration_credential_lineage l on l.credential_id=c.id
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where c.id=j.credential_id and c.version=90 and c.status='active'
 and c.created_by='5286e97b-40aa-406f-9690-5697cf28cbb0'
 and d.decrypted_secret::jsonb->>'provider_account_subject'='shopee:main:4940266'
 and d.decrypted_secret::jsonb->>'partner_id'='2031489'
 and encode(extensions.digest(d.decrypted_secret::jsonb::text,'sha256'),'hex')=l.payload_sha256 and t.source_payload_sha256=l.payload_sha256)
 then raise exception 'SHOPEE_SG_OFFICIAL_REJECTION_INCIDENT_DRIFT';end if;
 insert into sellerpilot_private.shopee_sg_refresh_rejection_receipts values(j.id,to_jsonb(j),to_jsonb(t),
 jsonb_build_object('source','Shopee Open Platform API Access Log','partnerId',2031489,'shopId','1719148844',
 'requestTime','2026-09-14T00:55:07Z','method','POST','path','/api/v2/auth/access_token/get',
 'httpStatus',403,'error','source_ip_undeclared','sourceIp','16.184.44.4',
 'providerRequestId','e3e3e7f35b66e2a3e590809314fc7700','tokenIssued',false),clock_timestamp());
 -- The CHECK equates the flag with started_at presence. Both change together;
 -- original values, status/error and full row are retained in the receipt.
 update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=false,credential_refresh_started_at=null where id=j.id;
 update sellerpilot_private.shopee_sg_registration_refresh_claims set status='conflict',updated_at=clock_timestamp()
 where job_id=t.job_id and target_type=t.target_type and target_id=t.target_id;
 if (select to_jsonb(x)-array['credential_refresh_in_flight','credential_refresh_started_at'] from sellerpilot_private.channel_gateway_jobs x where id=j.id)
 is distinct from (to_jsonb(j)-array['credential_refresh_in_flight','credential_refresh_started_at'])
 then raise exception 'SHOPEE_SG_OFFICIAL_REJECTION_HISTORY_CHANGED';end if;
end $rejection$;

-- Only this existing main-account lineage and SG shop can use the new tuple.
-- Check the actual claim's worker, current release, IP and approved route for
-- both queued claims and subsequent running refresh/completion ownership.
create function sellerpilot_private.shopee_sg_local_discovery_allowed(
 p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
) returns boolean language sql stable security definer set search_path='' as $body$
 select coalesce((select j.channel='shopee' and j.operation='shops.get' and j.environment='production'
 and j.status in('queued','running') and j.request_payload='{"shopId":"1719148844"}'::jsonb
 and sellerpilot_private.shopee_sg_registration_refresh_job(j.id)
 and t.scope='gateway' and t.status='active' and t.expires_at>clock_timestamp()
 and p_worker_version='sellerpilot-cli-worker/1.61+'||p_release_sha||'.'||left(p_egress_ip_sha256,11)
 and p_release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
 and (j.status='queued' or (j.worker_token_id=t.id and j.claim_token is not null and j.lease_expires_at>clock_timestamp()))
 and exists(select 1 from sellerpilot_private.admin_users where user_id=t.created_by)
 and exists(select 1 from sellerpilot_private.local_channel_executor_routes r
 where r.channel=j.channel and r.operation=j.operation and r.credential_id=j.credential_id
 and r.worker_token_id=t.id and r.seller_account_key=j.seller_account_key
 and r.enabled and r.approved_at<=clock_timestamp() and r.expires_at>clock_timestamp()
 and r.release_sha=p_release_sha and r.egress_ip_sha256=p_egress_ip_sha256
 and exists(select 1 from sellerpilot_private.admin_users where user_id=r.owner_id)
 and exists(select 1 from sellerpilot_private.admin_users where user_id=r.approved_by))
 from sellerpilot_private.channel_gateway_jobs j join sellerpilot_private.ai_cli_worker_tokens t on t.id=p_worker_token_id
 where j.id=p_job_id and j.credential_id=p_credential_id),false)
$body$;
revoke all on function sellerpilot_private.shopee_sg_local_discovery_allowed(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;

do $routing$
declare source text;patched text;con text;e record;
begin
 for e in select * from (values
 ('sellerpilot_private.serverless_gateway_job_allowed(text,text)',
  $old$  select not ($old$,$new$  select not (p_channel='shopee' and p_operation='shops.get') and not ($new$),
 ('sellerpilot_private.local_channel_executor_access(text,text)',
  $old$  select case$old$,$new$  select case when p_channel='shopee' and p_operation='shops.get' then 'read'$new$),
 ('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)',
  $old$and (j.operation in ('diagnostic.test', 'inquiries.list', 'orders.list')$old$,
  $new$and ((j.channel='shopee' and j.operation='shops.get') or j.operation in ('diagnostic.test', 'inquiries.list', 'orders.list')$new$),
 ('sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)',
  $old$begin
  if exists ($old$,
  $new$begin
  if exists(select 1 from sellerpilot_private.channel_gateway_jobs where id=p_job_id and channel='shopee' and operation='shops.get') then
    return sellerpilot_private.shopee_sg_local_discovery_allowed(p_job_id,p_credential_id,p_worker_token_id,p_worker_version,p_release_sha,p_egress_ip_sha256);
  end if;
  if exists ($new$)
 ) x(signature,needle,replacement) loop
  source:=pg_get_functiondef(e.signature::regprocedure);
  if (length(source)-length(replace(source,e.needle,'')))/length(e.needle)<>1 then raise exception 'SHOPEE_SG_LOCAL_ROUTING_ANCHOR_DRIFT:%',e.signature;end if;
  execute replace(source,e.needle,e.replacement);
 end loop;
 select pg_get_constraintdef(oid) into con from pg_constraint where conrelid='sellerpilot_private.local_channel_executor_routes'::regclass and conname='local_channel_executor_routes_operation_check';
 if md5(con) is distinct from 'd098f3dd27eb8f5a03d7859b119351e8' then raise exception 'SHOPEE_SG_LOCAL_ROUTE_CONSTRAINT_DRIFT';end if;
 alter table sellerpilot_private.local_channel_executor_routes drop constraint local_channel_executor_routes_operation_check;
 execute 'alter table sellerpilot_private.local_channel_executor_routes add constraint local_channel_executor_routes_operation_check CHECK ('||substring(con from 8 for length(con)-8)||$extra$ OR (channel='shopee' AND operation='shops.get'))$extra$;
end $routing$;

-- Inherit an existing operator approval without extending its time/IP/release.
do $route$
declare r sellerpilot_private.local_channel_executor_routes%rowtype;
begin
 select * into r from sellerpilot_private.local_channel_executor_routes where id='be59a2d7-a4b6-4b9c-9c46-d10cb8ec2eb9' for share;
 if r.id is null or r.channel<>'shopee' or r.operation<>'diagnostic.test' or r.credential_id<>'550d04ed-1e86-44a3-85a0-12ba17ce2374'
 or not r.enabled or r.approved_at>clock_timestamp() or r.expires_at<=clock_timestamp()
 or r.release_sha<>sellerpilot_private.active_serverless_runtime_release_sha()
 or r.egress_ip_sha256<>'92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01'
 then raise exception 'SHOPEE_SG_LOCAL_APPROVAL_DRIFT';end if;
 insert into sellerpilot_private.local_channel_executor_routes(id,owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,egress_ip_sha256,approved_by,approved_at,expires_at,enabled)
 values(gen_random_uuid(),r.owner_id,r.channel,'shops.get',r.credential_id,r.seller_account_key,r.worker_token_id,r.release_sha,r.egress_ip_sha256,r.approved_by,r.approved_at,r.expires_at,r.enabled);
end $route$;

-- A confirmed same-seller rotation inherits only still-live approvals from
-- this exact discovery's source. It never widens their channel/op/time/egress.
do $continuity$
declare source text;needle text;replacement text;
begin
 source:=pg_get_functiondef('public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text,jsonb,timestamptz,boolean,boolean)'::regprocedure);
 needle:=$old$ if result->>'status' not in('prepared','recovery_preserved') then return result;end if;$old$;
 replacement:=needle||$extra$
 if result->>'status'='prepared' and exists(select 1 from sellerpilot_private.channel_gateway_jobs g where g.id=p_job_id and g.operation='shops.get' and g.request_payload='{"shopId":"1719148844"}'::jsonb)
 and exists(select 1 from sellerpilot_private.shopee_sg_registration_credential_lineage l where l.credential_id=(result->>'credential_id')::uuid and l.predecessor_id=r.credential_id and l.source_job_id=p_job_id) then
  insert into sellerpilot_private.local_channel_executor_routes(id,owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,egress_ip_sha256,approved_by,approved_at,expires_at,enabled)
  select gen_random_uuid(),route.owner_id,route.channel,route.operation,(result->>'credential_id')::uuid,route.seller_account_key,route.worker_token_id,route.release_sha,route.egress_ip_sha256,route.approved_by,route.approved_at,route.expires_at,route.enabled
  from sellerpilot_private.local_channel_executor_routes route
  join sellerpilot_private.channel_credentials c on c.id=(result->>'credential_id')::uuid
  where route.credential_id=r.credential_id and route.channel='shopee' and route.enabled
  and route.operation in('shops.get','diagnostic.test','inquiries.list','orders.list','listing.create')
  and route.seller_account_key=c.seller_account_key and c.status='active'
  and route.worker_token_id=(select g.worker_token_id from sellerpilot_private.channel_gateway_jobs g where g.id=p_job_id)
  and route.approved_at<=clock_timestamp() and route.expires_at>clock_timestamp()
  and route.release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
  on conflict(owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,release_sha,egress_ip_sha256) do nothing;
 end if;
$extra$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'SHOPEE_SG_LOCAL_CONTINUITY_ANCHOR_DRIFT';end if;
 execute replace(source,needle,replacement);
end $continuity$;
notify pgrst,'reload schema';
commit;
