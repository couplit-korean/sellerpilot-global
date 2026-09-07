-- Route the single queued Coupang provider-live GET verifier through the
-- attested local executor without widening any marketplace write lane.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local timezone='UTC';

select pg_catalog.pg_advisory_xact_lock(1637578093,8072038);

do $preflight$
declare
 claim_definition text;
 allowed_definition text;
 job sellerpilot_private.channel_gateway_jobs%rowtype;
 run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
begin
 if pg_catalog.to_regprocedure(
      'public.sellerpilot_claim_local_channel_executor_before_coupang_get(text,text,text,text)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'sellerpilot_private.local_channel_executor_job_allowed_before_coupang_get(uuid,uuid,uuid,text,text,text)'
    ) is not null then
  raise exception 'COUPANG_EXACT_LIVE_LOCAL_CLAIM_ALREADY_PATCHED'
   using errcode='55000';end if;
 select pg_catalog.pg_get_functiondef(
  'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
 ) into claim_definition;
 select pg_catalog.pg_get_functiondef(
  'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
 ) into allowed_definition;
 if pg_catalog.md5(claim_definition)<>'dfee387ced728c18835a3f0d506a4ffc'
    or pg_catalog.strpos(allowed_definition,
      'SMARTSTORE_LOCAL_UPDATE_REMOTE_IDENTITY')=0
    or pg_catalog.strpos(allowed_definition,
      'LISTING_CREATE_UNBOUND_SELLER_LINEAGE')=0
    or pg_catalog.strpos(allowed_definition,
      'local_channel_executor_route_is_current')=0
 then raise exception 'COUPANG_EXACT_LIVE_LOCAL_CLAIM_PREIMAGE_DRIFT'
  using errcode='55000';end if;

 select * into job from sellerpilot_private.channel_gateway_jobs
  where id='86d2cb63-d382-4cc9-8153-654cf7ccec80' for update;
 select * into run from sellerpilot_private.coupang_exact_live_verify_runs
  where verifier_job_id='86d2cb63-d382-4cc9-8153-654cf7ccec80' for share;
 if job.id is null or run.verifier_job_id is null
    or (select count(*) from sellerpilot_private.coupang_exact_live_verify_runs)<>1
    or run.source_job_id is distinct from
      '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
    or run.source_attempt_id is distinct from
      'd771421b-f408-4f75-addd-03879393fab8'::uuid
    or run.listing_id is distinct from
      'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    or run.remote_id is distinct from '16375780938'
    or sellerpilot_private.coupang_exact_live_verifier_job_matches(job) is not true
    or sellerpilot_private.coupang_exact_live_source_current() is not true
    or job.status is distinct from 'queued'
    or job.attempt_id is not null
    or job.provider_mutation_started_at is not null
    or job.write_resource_kind is not null or job.write_resource_key is not null
    or job.worker_token_id is not null or job.claim_token is not null
    or job.lease_expires_at is not null
    or job.credential_refresh_in_flight is not false
    or job.credential_refresh_recovery_vault_id is not null
    or job.prepared_credential_id is not null
    or job.oauth_exchange_completed is not false
    or exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts)
 then raise exception 'COUPANG_EXACT_LIVE_LOCAL_CLAIM_SOURCE_DRIFT'
  using errcode='55000';end if;
end
$preflight$;

create table sellerpilot_private.coupang_exact_live_local_claim_routes(
 job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id)
  on delete restrict
  check(job_id='86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid),
 credential_id uuid not null references sellerpilot_private.channel_credentials(id)
  on delete restrict
  check(credential_id='32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid),
 worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id)
  on delete restrict,
 owner_id uuid not null check(
  owner_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
 ),
 channel text not null check(channel='coupang'),
 operation text not null check(operation='listing.publication.verify'),
 seller_account_key text not null check(
  seller_account_key=
   'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
 ),
 source_read_route_id uuid not null references
  sellerpilot_private.local_channel_executor_routes(id) on delete restrict,
 release_sha text not null check(release_sha~'^[a-f0-9]{40}$'),
 egress_ip_sha256 text not null check(egress_ip_sha256~'^[a-f0-9]{64}$'),
 activated_by uuid not null check(
  activated_by='21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
 ),
 activated_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null check(expires_at>activated_at)
);
alter table sellerpilot_private.coupang_exact_live_local_claim_routes
 enable row level security;
revoke all on sellerpilot_private.coupang_exact_live_local_claim_routes
 from public,anon,authenticated,service_role;

create function public.sellerpilot_service_activate_exact_coupang_live_local_claim(
 p_worker_token_id uuid,p_release_sha text,p_egress_ip_sha256 text
)returns jsonb language plpgsql security definer set search_path='' as $$
declare job sellerpilot_private.channel_gateway_jobs%rowtype;
 run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
 attempt sellerpilot_private.channel_operation_attempts%rowtype;
 listing sellerpilot_private.product_listings%rowtype;
 credential sellerpilot_private.channel_credentials%rowtype;
 token sellerpilot_private.ai_cli_worker_tokens%rowtype;
 source_route sellerpilot_private.local_channel_executor_routes%rowtype;
begin
 if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
  raise exception 'service role required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(1637578093,8072038);
 select * into job from sellerpilot_private.channel_gateway_jobs
  where id='86d2cb63-d382-4cc9-8153-654cf7ccec80' for update;
 select * into run from sellerpilot_private.coupang_exact_live_verify_runs
  where verifier_job_id=job.id for share;
 select * into attempt from sellerpilot_private.channel_operation_attempts
  where id=run.source_attempt_id for update;
 select * into listing from sellerpilot_private.product_listings
  where id=run.listing_id for update;
 select * into credential from sellerpilot_private.channel_credentials
  where id=job.credential_id for update;
 select * into token from sellerpilot_private.ai_cli_worker_tokens
  where id=p_worker_token_id for update;
 select * into source_route
 from sellerpilot_private.local_channel_executor_routes route
 where route.owner_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
  and route.channel='coupang'
  and route.operation in('categories.attributes','categories.validate')
  and route.credential_id=job.credential_id
  and route.seller_account_key=job.seller_account_key
  and route.worker_token_id=token.id
  and route.egress_ip_sha256=p_egress_ip_sha256
  and route.enabled and route.approved_at<=clock_timestamp()
  and route.expires_at>clock_timestamp()
 order by route.expires_at desc,route.id
 for update limit 1;
 if coalesce(p_release_sha,'')!~'^[a-f0-9]{40}$'
    or coalesce(p_egress_ip_sha256,'')!~'^[a-f0-9]{64}$'
    or sellerpilot_private.active_serverless_runtime_release_sha()
      is distinct from p_release_sha
    or job.status is distinct from 'queued'
    or job.attempt_id is not null
    or job.provider_mutation_started_at is not null
    or job.write_resource_kind is not null or job.write_resource_key is not null
    or job.worker_token_id is not null or job.claim_token is not null
    or job.lease_expires_at is not null
    or job.credential_refresh_in_flight is not false
    or job.credential_refresh_recovery_vault_id is not null
    or job.prepared_credential_id is not null
    or job.oauth_exchange_completed is not false
    or sellerpilot_private.coupang_exact_live_verifier_job_matches(job) is not true
    or sellerpilot_private.coupang_exact_live_source_current() is not true
    or (select count(*) from sellerpilot_private.coupang_exact_live_verify_runs)<>1
    or run.source_job_id is distinct from
      '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
    or run.source_attempt_id is distinct from
      'd771421b-f408-4f75-addd-03879393fab8'::uuid
    or run.listing_id is distinct from
      'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    or run.remote_id is distinct from '16375780938'
    or attempt.id is distinct from
      'd771421b-f408-4f75-addd-03879393fab8'::uuid
    or attempt.owner_id is distinct from
      '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    or listing.id is distinct from
      'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    or listing.owner_id is distinct from attempt.owner_id
    or exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts)
    or credential.id is distinct from
      '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
    or credential.channel is distinct from 'coupang'
    or credential.environment is distinct from 'production'
    or credential.status is distinct from 'active'
    or (credential.expires_at is not null
      and credential.expires_at<=clock_timestamp())
    or credential.last_check_status is distinct from 'passed'
    or credential.seller_account_key is distinct from job.seller_account_key
    or credential.seller_account_key_source not in(
      'provider_certified_v1','credential_incarnation_v1'
    )
    or credential.created_by is distinct from job.created_by
    or token.id is null or token.scope is distinct from 'gateway'
    or token.status is distinct from 'active'
    or token.expires_at<=clock_timestamp()
    or not exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=credential.created_by)
    or not exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=token.created_by)
    or source_route.id is null
    or source_route.owner_id is distinct from attempt.owner_id
    or not exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=source_route.owner_id)
    or not exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=source_route.approved_by)
    or not exists(
      select 1 from sellerpilot_private.serverless_static_egress_policy policy
      where policy.channel='coupang' and policy.enabled is false
    )
 then raise exception 'COUPANG_EXACT_LIVE_LOCAL_CLAIM_ACTIVATION_DENIED'
  using errcode='55000';end if;
 insert into sellerpilot_private.coupang_exact_live_local_claim_routes(
  job_id,credential_id,worker_token_id,owner_id,channel,operation,
  seller_account_key,source_read_route_id,release_sha,egress_ip_sha256,
  activated_by,activated_at,expires_at
 )values(job.id,credential.id,token.id,attempt.owner_id,'coupang',
  'listing.publication.verify',job.seller_account_key,source_route.id,
  p_release_sha,p_egress_ip_sha256,job.created_by,clock_timestamp(),
  source_route.expires_at)
 on conflict(job_id) do update set
  credential_id=excluded.credential_id,
  worker_token_id=excluded.worker_token_id,
  owner_id=excluded.owner_id,
  channel=excluded.channel,
  operation=excluded.operation,
  seller_account_key=excluded.seller_account_key,
  source_read_route_id=excluded.source_read_route_id,
  release_sha=excluded.release_sha,
  egress_ip_sha256=excluded.egress_ip_sha256,
  activated_by=excluded.activated_by,
  activated_at=excluded.activated_at,
  expires_at=excluded.expires_at;
 return jsonb_build_object(
  'contract','coupang_exact_live_local_claim_route_v1',
  'jobId',job.id,'releaseSha',p_release_sha,
  'egressIpSha256',p_egress_ip_sha256,'activated',true,
  'providerMutationPerformed',false
 );
end
$$;
revoke all on function public.sellerpilot_service_activate_exact_coupang_live_local_claim(
 uuid,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_activate_exact_coupang_live_local_claim(
 uuid,text,text
) to service_role;

create function sellerpilot_private.coupang_exact_live_local_claim_allowed(
 p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,
 p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
)returns boolean language plpgsql stable security definer set search_path='' as $$
declare job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
 select * into job from sellerpilot_private.channel_gateway_jobs
 where id=p_job_id and credential_id=p_credential_id;
 return coalesce(
  p_job_id='86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
  and current_setting('sellerpilot.coupang_exact_live_local_claim',true)=p_job_id::text
  and sellerpilot_private.active_serverless_runtime_release_sha()=p_release_sha
  and p_egress_ip_sha256~'^[a-f0-9]{64}$'
  and p_worker_version='sellerpilot-cli-worker/1.61+'||p_release_sha||'.'||pg_catalog.left(p_egress_ip_sha256,11)
  and job.status='queued' and job.environment='production'
  and job.attempt_id is null and job.provider_mutation_started_at is null
  and job.write_resource_kind is null and job.write_resource_key is null
  and job.worker_token_id is null and job.claim_token is null
  and job.lease_expires_at is null
  and job.credential_refresh_in_flight is false
  and job.credential_refresh_recovery_vault_id is null
  and job.prepared_credential_id is null
  and job.oauth_exchange_completed is false
  and sellerpilot_private.coupang_exact_live_verifier_job_matches(job)
  and sellerpilot_private.coupang_exact_live_source_current()
  and (select count(*) from sellerpilot_private.coupang_exact_live_verify_runs)=1
  and exists(
   select 1 from sellerpilot_private.coupang_exact_live_verify_runs run
   where run.verifier_job_id=job.id
    and run.source_job_id='25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
    and run.source_attempt_id='d771421b-f408-4f75-addd-03879393fab8'::uuid
    and run.listing_id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
    and run.remote_id='16375780938'
  )
  and not exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts)
  and exists(
   select 1 from sellerpilot_private.channel_credentials credential
   where credential.id=job.credential_id
    and credential.id='32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
    and credential.channel='coupang' and credential.environment='production'
    and credential.status='active'
    and (credential.expires_at is null or credential.expires_at>clock_timestamp())
    and credential.last_check_status='passed'
    and credential.seller_account_key=job.seller_account_key
    and credential.seller_account_key_source in(
      'provider_certified_v1','credential_incarnation_v1'
    )
    and credential.created_by=job.created_by
    and exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=credential.created_by)
  )
  and exists(
   select 1 from sellerpilot_private.ai_cli_worker_tokens token
   where token.id=p_worker_token_id and token.scope='gateway'
    and token.status='active' and token.expires_at>clock_timestamp()
    and token.last_seen_at>=clock_timestamp()-interval '3 minutes'
    and token.last_version=p_worker_version
    and exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=token.created_by)
  )
  and exists(
   select 1
   from sellerpilot_private.coupang_exact_live_local_claim_routes exact_route
   join sellerpilot_private.local_channel_executor_routes route
    on route.id=exact_route.source_read_route_id
    and route.owner_id=exact_route.owner_id
    and route.channel='coupang'
    and route.operation in('categories.attributes','categories.validate')
    and route.credential_id=exact_route.credential_id
    and route.seller_account_key=exact_route.seller_account_key
    and route.worker_token_id=exact_route.worker_token_id
    and route.egress_ip_sha256=exact_route.egress_ip_sha256
    and route.enabled and route.approved_at<=clock_timestamp()
    and route.expires_at>clock_timestamp()
   where exact_route.job_id=job.id
    and exact_route.credential_id=job.credential_id
    and exact_route.worker_token_id=p_worker_token_id
    and exact_route.owner_id=
      '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and exact_route.channel='coupang'
    and exact_route.operation='listing.publication.verify'
    and exact_route.seller_account_key=job.seller_account_key
    and exact_route.release_sha=p_release_sha
    and exact_route.egress_ip_sha256=p_egress_ip_sha256
    and exact_route.expires_at>clock_timestamp()
    and exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=route.owner_id)
    and exists(select 1 from sellerpilot_private.admin_users admin
      where admin.user_id=route.approved_by)
  )
  and exists(
   select 1 from sellerpilot_private.serverless_static_egress_policy policy
   where policy.channel='coupang' and policy.enabled is false
  ),false
 );
exception when others then return false;end
$$;
revoke all on function sellerpilot_private.coupang_exact_live_local_claim_allowed(
 uuid,uuid,uuid,text,text,text
) from public,anon,authenticated,service_role;

alter function sellerpilot_private.local_channel_executor_job_allowed(
 uuid,uuid,uuid,text,text,text
) rename to local_channel_executor_job_allowed_before_coupang_get;
revoke all on function sellerpilot_private.local_channel_executor_job_allowed_before_coupang_get(
 uuid,uuid,uuid,text,text,text
) from public,anon,authenticated,service_role;

create function sellerpilot_private.local_channel_executor_job_allowed(
 p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,
 p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
)returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(
  sellerpilot_private.coupang_exact_live_local_claim_allowed(
   p_job_id,p_credential_id,p_worker_token_id,p_worker_version,
   p_release_sha,p_egress_ip_sha256
  ) or sellerpilot_private.local_channel_executor_job_allowed_before_coupang_get(
   p_job_id,p_credential_id,p_worker_token_id,p_worker_version,
   p_release_sha,p_egress_ip_sha256
  ),false
 )
$$;
revoke all on function sellerpilot_private.local_channel_executor_job_allowed(
 uuid,uuid,uuid,text,text,text
) from public,anon,authenticated,service_role;

alter function public.sellerpilot_claim_local_channel_executor_job(
 text,text,text,text
) rename to sellerpilot_claim_local_channel_executor_before_coupang_get;
revoke all on function public.sellerpilot_claim_local_channel_executor_before_coupang_get(
 text,text,text,text
) from public,anon,authenticated,service_role;

create function public.sellerpilot_claim_local_channel_executor_job(
 p_token_hash text,p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
)returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_marker text;result jsonb;
begin
 prior_marker:=coalesce(current_setting(
  'sellerpilot.coupang_exact_live_local_claim',true
 ),'');
 if coalesce(p_release_sha,'')~'^[a-f0-9]{40}$'
    and sellerpilot_private.active_serverless_runtime_release_sha()=p_release_sha then
  perform pg_catalog.set_config('sellerpilot.coupang_exact_live_local_claim',
   '86d2cb63-d382-4cc9-8153-654cf7ccec80',true);
 else
  perform pg_catalog.set_config('sellerpilot.coupang_exact_live_local_claim','',true);
 end if;
 begin
  result:=public.sellerpilot_claim_local_channel_executor_before_coupang_get(
   p_token_hash,p_worker_version,p_release_sha,p_egress_ip_sha256
  );
 exception when others then
  perform pg_catalog.set_config('sellerpilot.coupang_exact_live_local_claim',
   prior_marker,true);
  raise;
 end;
 perform pg_catalog.set_config('sellerpilot.coupang_exact_live_local_claim',
  prior_marker,true);
 return result;
end
$$;
revoke all on function public.sellerpilot_claim_local_channel_executor_job(
 text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_claim_local_channel_executor_job(
 text,text,text,text
) to service_role;

comment on function public.sellerpilot_claim_local_channel_executor_job(
 text,text,text,text
) is 'Preserves every existing local executor claim rule and additionally admits only exact GET-only Coupang verifier 86d2cb63-d382-4cc9-8153-654cf7ccec80 after its active runtime release, token, credential and current egress route are atomically attested.';

notify pgrst,'reload schema';
commit;
