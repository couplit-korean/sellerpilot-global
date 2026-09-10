begin;
set local lock_timeout='5s';
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('sellerpilot_private.exact_lazada_three_readback_proof(uuid)') and prosecdef and proconfig=array['search_path=""']::text[] and md5(regexp_replace(prosrc,'[[:space:]]+',' ','g'))='397857dd929e8539b71484771b6b0770') then raise exception 'LAZADA_EXACT_500_PROOF_PREIMAGE_MISMATCH';end if;
 if to_regclass('sellerpilot_private.lazada_same_account_oauth_boundary') is null then raise exception 'LAZADA_500_BOUNDARY_REQUIRED'; end if;
 if to_regclass('sellerpilot_private.lazada_exact_oauth_sessions') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'sellerpilot_lazada_exact_oauth_%') then raise exception 'LAZADA_EXACT_ALREADY_DEFINED'; end if;
end $$;
create table sellerpilot_private.lazada_exact_oauth_sessions(
 id uuid primary key, actor_id uuid not null references auth.users(id), owner_id uuid not null references auth.users(id),
 credential_id uuid not null references sellerpilot_private.channel_credentials(id), state_hash text not null unique check(state_hash~'^[a-f0-9]{64}$'),
 source_hash text not null, source_version integer not null check(source_version=5), source_expiry timestamptz,
 worker_issuer_id uuid references auth.users(id), worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),ready_until timestamptz,
 expires_at timestamptz not null default(clock_timestamp()+interval '15 minutes'),
 job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id), readback_job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id),
 prepared_hash text, prepared_id uuid references sellerpilot_private.channel_credentials(id), delivered_oauth boolean not null default false,
 delivered_readback boolean not null default false, provider_called boolean not null default false,
 phase text not null default 'prepared' check(phase in('prepared','bound','oauth_running','oauth_completed','readback_running','completed','review'))
);
alter table sellerpilot_private.lazada_exact_oauth_sessions enable row level security;
revoke all on sellerpilot_private.lazada_exact_oauth_sessions from public,anon,authenticated,service_role;
-- These rows capture original claim authority, never copies restored onto a
-- terminal job. Claim and completion evidence is insert-only, including for
-- service_role. No historical job is admitted to either table.
create table sellerpilot_private.lazada_exact_claims(
 job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
 session_id uuid not null references sellerpilot_private.lazada_exact_oauth_sessions(id),
 operation text not null check(operation in('oauth.exchange','shops.get')),
 credential_id uuid not null, credential_version integer not null,
 worker_issuer_id uuid not null references auth.users(id), worker_token_id uuid not null, claim_token uuid not null unique,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 allocated_at timestamptz not null default clock_timestamp(),
 unique(session_id,operation)
);
create table sellerpilot_private.lazada_exact_completions(
 job_id uuid primary key references sellerpilot_private.lazada_exact_claims(job_id),
 result_hash text not null check(result_hash~'^[a-f0-9]{64}$'),
 completion_hash text not null check(completion_hash~'^[a-f0-9]{64}$'),
 lease_checked_at timestamptz not null, lease_expires_at timestamptz not null,
 sealed_at timestamptz not null default clock_timestamp(),
 check(lease_checked_at<lease_expires_at)
);
alter table sellerpilot_private.lazada_exact_claims enable row level security;
alter table sellerpilot_private.lazada_exact_completions enable row level security;
revoke all on sellerpilot_private.lazada_exact_claims,sellerpilot_private.lazada_exact_completions from public,anon,authenticated,service_role;
create function sellerpilot_private.lazada_exact_immutable_evidence() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'LAZADA_EXACT_EVIDENCE_IMMUTABLE';end $$;
create trigger lazada_exact_claim_immutable before update or delete on sellerpilot_private.lazada_exact_claims for each row execute function sellerpilot_private.lazada_exact_immutable_evidence();
create trigger lazada_exact_completion_immutable before update or delete on sellerpilot_private.lazada_exact_completions for each row execute function sellerpilot_private.lazada_exact_immutable_evidence();
revoke all on function sellerpilot_private.lazada_exact_immutable_evidence() from public,anon,authenticated,service_role;
create function sellerpilot_private.lazada_exact_session_identity_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if (to_jsonb(new)-array['worker_token_id','worker_issuer_id','ready_until','job_id','readback_job_id','prepared_id','prepared_hash','delivered_oauth','delivered_readback','provider_called','phase']) is distinct from (to_jsonb(old)-array['worker_token_id','worker_issuer_id','ready_until','job_id','readback_job_id','prepared_id','prepared_hash','delivered_oauth','delivered_readback','provider_called','phase'])
 or(old.worker_issuer_id is not null and new.worker_issuer_id is distinct from old.worker_issuer_id)
 or(old.worker_token_id is not null and new.worker_token_id is distinct from old.worker_token_id)
 or(old.job_id is not null and new.job_id is distinct from old.job_id)
 or(old.readback_job_id is not null and new.readback_job_id is distinct from old.readback_job_id)
 or(old.prepared_hash is not null and new.prepared_hash is distinct from old.prepared_hash)
 or(old.prepared_id is not null and new.prepared_id is distinct from old.prepared_id)
 or(old.delivered_oauth and not new.delivered_oauth) or(old.delivered_readback and not new.delivered_readback) or(old.provider_called and not new.provider_called)
 then raise exception 'LAZADA_EXACT_SESSION_IDENTITY_IMMUTABLE';end if;return new;
end $$;
create trigger lazada_exact_session_identity before update on sellerpilot_private.lazada_exact_oauth_sessions for each row execute function sellerpilot_private.lazada_exact_session_identity_guard();
revoke all on function sellerpilot_private.lazada_exact_session_identity_guard() from public,anon,authenticated,service_role;
create or replace function sellerpilot_private.lazada_exact_completed_job_bound(p_job uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from sellerpilot_private.lazada_exact_claims e
 join sellerpilot_private.lazada_exact_oauth_sessions s on s.id=e.session_id
 join sellerpilot_private.lazada_exact_completions seal on seal.job_id=e.job_id
 join sellerpilot_private.channel_gateway_jobs j on j.id=e.job_id
 join sellerpilot_private.gateway_completion_receipts r on r.job_id=j.id and r.claim_token=e.claim_token and r.worker_token_id=e.worker_token_id
 join sellerpilot_private.channel_credentials c on c.id=s.prepared_id and c.id=j.credential_id
 join vault.decrypted_secrets active_secret on active_secret.id=c.vault_secret_id and encode(extensions.digest((active_secret.decrypted_secret::jsonb)::text,'sha256'),'hex')=s.prepared_hash
 join sellerpilot_private.channel_credentials src on src.id=s.credential_id
 join vault.decrypted_secrets d on d.id=src.vault_secret_id
 join sellerpilot_private.ai_cli_worker_tokens t on t.id=e.worker_token_id and t.id=s.worker_token_id and t.created_by=s.worker_issuer_id and e.worker_issuer_id=s.worker_issuer_id
 where e.job_id=p_job and s.owner_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c' and s.credential_id='e54fa95d-ddfd-414f-82e9-636a0d9ab07c' and s.source_version=5
 and src.created_by=s.owner_id and src.version=5 and src.status='revoked' and src.seller_account_key is null and src.seller_account_key_source='legacy_unattested'
 and encode(extensions.digest((d.decrypted_secret::jsonb)::text,'sha256'),'hex')=s.source_hash
 and src.expires_at is not distinct from s.source_expiry
 and c.created_by=s.owner_id and c.version=6 and c.channel='lazada' and c.environment='production' and c.status='active' and(c.expires_at is null or c.expires_at>clock_timestamp())
 and c.seller_account_key_source='provider_certified_v1'
 and sellerpilot_private.worker_token_has_scope(t.token_hash,'gateway',true) and t.scope='gateway' and t.status='active' and t.expires_at>seal.sealed_at
 and j.created_by=s.owner_id and j.channel='lazada' and j.environment='production' and j.operation=e.operation and j.status='succeeded' and j.attempt_count=1
 and j.worker_token_id is null and j.claim_token is null and j.lease_expires_at is null
 and j.provider_mutation_started_at is null and j.error_message is null
 and e.allocated_at<=seal.lease_checked_at and seal.lease_checked_at<seal.lease_expires_at and j.completed_at<seal.lease_expires_at and seal.lease_expires_at<=s.expires_at
 and seal.sealed_at>=j.completed_at and seal.sealed_at<s.expires_at
 and r.created_at>=j.completed_at and r.created_at<=seal.sealed_at
 and seal.result_hash=encode(extensions.digest(j.response_payload::text,'sha256'),'hex')
 and r.completion_fingerprint=seal.completion_hash
 and seal.completion_hash=sellerpilot_private.gateway_completion_fingerprint('succeeded',j.response_payload,null,null,null,null,null)
 and ((e.operation='oauth.exchange' and e.job_id=s.job_id and e.credential_id=s.credential_id and e.credential_version=5 and e.request_hash=j.oauth_request_fingerprint and j.oauth_source_credential_id=s.credential_id and j.prepared_credential_id=s.prepared_id and s.delivered_oauth and s.provider_called)
 or(e.operation='shops.get' and e.job_id=s.readback_job_id and e.credential_id=s.prepared_id and e.credential_version=c.version and e.request_hash=encode(extensions.digest(j.request_payload::text,'sha256'),'hex') and j.request_payload='{"country":"my"}'::jsonb and s.delivered_readback))
 );
$$;
revoke all on function sellerpilot_private.lazada_exact_completed_job_bound(uuid) from public,anon,authenticated,service_role;
create function sellerpilot_private.lazada_exact_source(p_credential uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c sellerpilot_private.channel_credentials%rowtype;s jsonb;
begin
 select * into c from sellerpilot_private.channel_credentials where id=p_credential and id='e54fa95d-ddfd-414f-82e9-636a0d9ab07c' and created_by='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c' and version=5 and channel='lazada' and environment='production' and status='active' and(expires_at is null or expires_at>clock_timestamp()) and seller_account_key_source='legacy_unattested' and seller_account_key is null and seller_account_verified_at is null;
 if not found then raise exception 'LAZADA_EXACT_SOURCE_INVALID';end if;
 select decrypted_secret::jsonb into s from vault.decrypted_secrets where id=c.vault_secret_id;
 if s->>'app_key' is distinct from '137451' or s->>'im_app_key' is distinct from '137571' or s->>'country' is distinct from 'my' or nullif(s->>'app_secret','') is null or nullif(s->>'im_app_secret','') is null or nullif(s->>'im_access_token','') is null or s?'provider_account_subject' then raise exception 'LAZADA_EXACT_APPS_INVALID';end if;
 return jsonb_build_object('hash',encode(extensions.digest(s::text,'sha256'),'hex'),'ownerId',c.created_by,'version',c.version,'expiresAt',c.expires_at);
end $$;
revoke all on function sellerpilot_private.lazada_exact_source(uuid) from public,anon,authenticated,service_role;
create function public.sellerpilot_lazada_exact_oauth_admin(p_action text,p_actor uuid,p_session uuid,p_credential uuid,p_state_hash text,p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sellerpilot_private.lazada_exact_oauth_sessions%rowtype;identity jsonb;t record;j uuid;c uuid;fp text;vaultid uuid;assigned timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' or not exists(select 1 from sellerpilot_private.admin_users where user_id=p_actor) then raise exception 'LAZADA_EXACT_ACTOR_DENIED' using errcode='42501';end if;
 if p_action is null or p_action not in('prepare','start','bind','status') or p_state_hash is null or p_state_hash!~'^[a-f0-9]{64}$' then raise exception 'LAZADA_EXACT_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('lazada-exact:'||p_credential::text,0));
 if p_action='prepare' then
  identity:=sellerpilot_private.lazada_exact_source(p_credential);
  if exists(select 1 from sellerpilot_private.lazada_exact_oauth_sessions where credential_id=p_credential and expires_at>clock_timestamp()) then raise exception 'LAZADA_EXACT_SESSION_EXISTS';end if;
  insert into sellerpilot_private.lazada_exact_oauth_sessions(id,actor_id,owner_id,credential_id,state_hash,source_hash,source_version,source_expiry)values(p_session,p_actor,(identity->>'ownerId')::uuid,p_credential,p_state_hash,identity->>'hash',5,(identity->>'expiresAt')::timestamptz);
  return jsonb_build_object('status','executor_required','sessionId',p_session);
 end if;
 select * into s from sellerpilot_private.lazada_exact_oauth_sessions where id=p_session for update;
 if not found or s.actor_id<>p_actor or s.credential_id<>p_credential or s.state_hash<>p_state_hash or s.expires_at<=clock_timestamp() then raise exception 'LAZADA_EXACT_SESSION_INVALID';end if;
 if p_action='status' then return jsonb_build_object('status',s.phase,'sessionId',s.id);end if;
 if s.job_id is not null then raise exception 'LAZADA_EXACT_CODE_ALREADY_BOUND';end if;
 identity:=sellerpilot_private.lazada_exact_source(p_credential);
 if identity->>'hash'<>s.source_hash or (identity->>'expiresAt')::timestamptz is distinct from s.source_expiry then raise exception 'LAZADA_EXACT_SOURCE_CHANGED';end if;
 select * into t from sellerpilot_private.ai_cli_worker_tokens where id=s.worker_token_id and created_by=s.worker_issuer_id and scope='gateway' and status='active' and expires_at>clock_timestamp() for share;
 if not found or not sellerpilot_private.worker_token_has_scope(t.token_hash,'gateway',true) or s.ready_until is null or s.ready_until<=clock_timestamp() then return jsonb_build_object('status','executor_required');end if;
 if p_action='start' then return jsonb_build_object('status','ready');end if;
 if jsonb_typeof(p_request) is distinct from 'object' or coalesce(p_request->>'code','')='' or length(p_request->>'code')>8000 or p_request->>'country' is distinct from 'my' or ((p_request->>'code')~'^0_[0-9]+_' and split_part(p_request->>'code','_',2)<>'137451') then raise exception 'LAZADA_EXACT_CALLBACK_INVALID';end if;
 -- Current generic enqueue still rejects the three immutable blockers.
 -- This narrow allocation calls the actual exact-three proof, locks the
 -- source row and preserves the ORIGINAL code-only fingerprint contract.
 perform 1 from sellerpilot_private.channel_credentials where id=s.credential_id for update;
 assigned:=clock_timestamp();fp:=encode(extensions.digest(jsonb_build_object('channel','lazada','code',trim(p_request->>'code'))::text,'sha256'),'hex');
 if sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(s.credential_id,s.owner_id,'production',fp,assigned) is distinct from 'd917f08b-1283-456e-930a-6042ec0b24a7'::uuid
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs where channel='lazada' and oauth_request_fingerprint=fp)
 then raise exception 'LAZADA_EXACT_FRESH_THREE_BLOCKER_PROOF_REQUIRED';end if;
 j:=gen_random_uuid();c:=gen_random_uuid();
 vaultid:=vault.create_secret(jsonb_build_object('code',trim(p_request->>'code'),'country','my','lazadaExactSession',s.id)::text,'sellerpilot_lazada_exact_'||j::text,'Claim-bound exact Lazada OAuth request');
 -- Conservative reservation fence is durable BEFORE delivering the code.
 -- Lease expiry must reconcile, never requeue for the obsolete general worker.
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,created_by,channel,environment,operation,status,attempt_count,request_payload,worker_token_id,claim_token,lease_expires_at,created_at,started_at,updated_at,oauth_source_credential_id,oauth_request_vault_id,oauth_request_fingerprint,credential_refresh_in_flight,credential_refresh_started_at)
 values(j,s.credential_id,s.owner_id,'lazada','production','oauth.exchange','running',1,'{"vaultBacked":true}',s.worker_token_id,c,least(s.expires_at,assigned+interval '3 minutes'),assigned,assigned,assigned,s.credential_id,vaultid,fp,true,assigned);
 insert into sellerpilot_private.lazada_exact_claims(job_id,session_id,operation,credential_id,credential_version,worker_issuer_id,worker_token_id,claim_token,request_hash) values(j,s.id,'oauth.exchange',s.credential_id,5,t.created_by,s.worker_token_id,c,fp);
 update sellerpilot_private.lazada_exact_oauth_sessions set job_id=j,phase='bound' where id=s.id;
 return jsonb_build_object('status','bound','jobId',j);
end $$;
revoke all on function public.sellerpilot_lazada_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_lazada_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb) to service_role;
create function public.sellerpilot_lazada_exact_oauth_worker(p_action text,p_session uuid,p_token_hash text,p_job uuid default null,p_claim uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sellerpilot_private.lazada_exact_oauth_sessions%rowtype;t record;j sellerpilot_private.channel_gateway_jobs%rowtype;secret jsonb;source jsonb;req jsonb;result jsonb;refresh jsonb;stores jsonb;store jsonb;subject text;canonical text;newid uuid;readid uuid;targetid uuid;oauth boolean;checked_at timestamptz;completion_hash text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'LAZADA_EXACT_ROLE_DENIED' using errcode='42501';end if;
 if p_action is null or p_action not in('pulse','claim','heartbeat','begin','provider','stage','complete','review') then raise exception 'LAZADA_EXACT_INPUT_INVALID';end if;
 select * into s from sellerpilot_private.lazada_exact_oauth_sessions where id=p_session for update;
 if not found or not exists(select 1 from sellerpilot_private.admin_users where user_id=s.actor_id) or s.expires_at<=clock_timestamp() or s.phase in('completed','review') then raise exception 'LAZADA_EXACT_SESSION_INVALID';end if;
 -- Reuse the deployed workspace gateway capability contract. The issuing
 -- administrator is provenance, not the credential owner or UI actor. This
 -- does not issue/reassign tokens or grant authority to unknown hashes/scopes.
 if coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$' or not sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true) then raise exception 'LAZADA_EXACT_TOKEN_INVALID';end if;
 select * into t from sellerpilot_private.ai_cli_worker_tokens where token_hash=p_token_hash and scope='gateway' and status='active' and expires_at>clock_timestamp() for share;
 if not found or(s.worker_token_id is not null and (s.worker_token_id<>t.id or s.worker_issuer_id is distinct from t.created_by)) then raise exception 'LAZADA_EXACT_TOKEN_INVALID';end if;
 if p_action='pulse' then
  if s.delivered_oauth then return jsonb_build_object('status','in_progress');end if;
  if sellerpilot_private.lazada_exact_source(s.credential_id)->>'hash'<>s.source_hash then raise exception 'LAZADA_EXACT_SOURCE_CHANGED';end if;
  if s.worker_token_id is null then
   insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail,occurred_at)
   values(s.owner_id,'lazada_exact_executor_bound','channel_credential',s.credential_id::text,jsonb_build_object('session_id',s.id,'actor_id',s.actor_id,'credential_owner_id',s.owner_id,'worker_token_id',t.id,'worker_issuer_id',t.created_by,'authority_contract','worker_token_has_scope:gateway'),clock_timestamp());
  end if;
  update sellerpilot_private.lazada_exact_oauth_sessions set worker_token_id=t.id,worker_issuer_id=t.created_by,ready_until=clock_timestamp()+interval '45 seconds' where id=s.id;return jsonb_build_object('status','armed');
 end if;
 if p_action='claim' then
  if s.job_id is null then return jsonb_build_object('status','waiting');end if;
  oauth:=s.readback_job_id is null;
  if (oauth and s.delivered_oauth) or (not oauth and s.delivered_readback) then raise exception 'LAZADA_EXACT_ALREADY_DELIVERED';end if;
  p_job:=case when oauth then s.job_id else s.readback_job_id end;
 else oauth:=p_job=s.job_id;end if;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job and id=case when oauth then s.job_id else s.readback_job_id end and worker_token_id=t.id and credential_id=coalesce(s.prepared_id,s.credential_id) and created_by=s.owner_id and channel='lazada' and environment='production' and operation=case when oauth then 'oauth.exchange' else 'shops.get' end and status='running' and attempt_count=1 and lease_expires_at>clock_timestamp() and provider_mutation_started_at is null for update;
 if not found or not exists(select 1 from sellerpilot_private.lazada_exact_claims e where e.job_id=j.id and e.session_id=s.id and e.claim_token=j.claim_token and e.worker_token_id=t.id and e.worker_issuer_id=s.worker_issuer_id and e.operation=j.operation and e.request_hash=case when oauth then j.oauth_request_fingerprint else encode(extensions.digest(j.request_payload::text,'sha256'),'hex') end) or (p_action<>'claim' and j.claim_token is distinct from p_claim) then raise exception 'LAZADA_EXACT_CLAIM_INVALID';end if;
 if p_action='claim' then
  select d.decrypted_secret::jsonb into secret from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=j.credential_id and c.created_by=s.owner_id and c.status='active' and(c.expires_at is null or c.expires_at>clock_timestamp());
  if secret is null then raise exception 'LAZADA_EXACT_CREDENTIAL_INVALID';end if;
  if oauth then
   if j.credential_id<>s.credential_id or j.oauth_source_credential_id<>s.credential_id or j.oauth_request_vault_id is null or s.provider_called or s.ready_until<=clock_timestamp() or encode(extensions.digest(secret::text,'sha256'),'hex')<>s.source_hash then raise exception 'LAZADA_EXACT_OAUTH_BINDING_INVALID';end if;
   select decrypted_secret::jsonb into req from vault.decrypted_secrets where id=j.oauth_request_vault_id;
   if req->>'lazadaExactSession' is distinct from s.id::text or req->>'country' is distinct from 'my' or coalesce(req->>'code','')='' or encode(extensions.digest(jsonb_build_object('channel','lazada','code',trim(req->>'code'))::text,'sha256'),'hex') is distinct from j.oauth_request_fingerprint then raise exception 'LAZADA_EXACT_VAULT_CODE_INVALID';end if;
  else
   if j.credential_id is distinct from s.prepared_id or encode(extensions.digest(secret::text,'sha256'),'hex') is distinct from s.prepared_hash then raise exception 'LAZADA_EXACT_READ_CREDENTIAL_INVALID';end if;
   req:=jsonb_build_object('country','my','lazadaExactSession',s.id);
  end if;
  update sellerpilot_private.lazada_exact_oauth_sessions set delivered_oauth=delivered_oauth or oauth,delivered_readback=delivered_readback or not oauth,phase=case when oauth then 'oauth_running' else 'readback_running' end where id=s.id;
  return jsonb_build_object('status','claimed','job',jsonb_build_object('id',j.id,'claim_token',j.claim_token,'credential_id',j.credential_id,'channel','lazada','operation',j.operation,'environment','production','attempt_count',1,'request',req,'credential',secret));
 end if;
 if (oauth and not s.delivered_oauth) or(not oauth and not s.delivered_readback) then raise exception 'LAZADA_EXACT_NOT_DELIVERED';end if;
 if p_action='heartbeat' then update sellerpilot_private.channel_gateway_jobs set lease_expires_at=least(s.expires_at,clock_timestamp()+interval '3 minutes'),updated_at=clock_timestamp() where id=j.id;return jsonb_build_object('status','running');end if;
 if p_action='review' then
  result:=public.sellerpilot_service_complete_gateway_transaction(p_token_hash,j.id,j.claim_token,'reconciliation_required',null,'LAZADA_EXACT_REVIEW_REQUIRED',null,null,null,null);
  update sellerpilot_private.lazada_exact_oauth_sessions set phase='review' where id=s.id;return jsonb_build_object('status','review');
 end if;
 if p_action in('begin','provider') and sellerpilot_private.lazada_exact_source(s.credential_id)->>'hash' is distinct from s.source_hash then raise exception 'LAZADA_EXACT_SOURCE_CHANGED';end if;
 if p_action='begin' and oauth and not s.provider_called then
  if public.sellerpilot_service_begin_gateway_credential_refresh(p_token_hash,j.id,j.claim_token) is not true then raise exception 'LAZADA_EXACT_BEGIN_FAILED';end if;return jsonb_build_object('status','in_flight');
 end if;
 if p_action='provider' and oauth and not s.provider_called then
  -- Existing public marker is serverless_cs-only. Do not broaden it: this
  -- exact session already validates the active gateway token, actor, owner,
  -- exact job/claim and lease. Preserve every durable provider-call predicate.
  update sellerpilot_private.channel_gateway_jobs set oauth_provider_call_started_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=j.id and credential_id=s.credential_id and oauth_source_credential_id=s.credential_id
    and credential_refresh_in_flight and started_at is not null and credential_refresh_started_at is not null
    and started_at<=credential_refresh_started_at and credential_refresh_started_at<=clock_timestamp()
    and oauth_provider_call_started_at is null and not oauth_exchange_completed and prepared_credential_id is null
    and credential_refresh_recovery_vault_id is null and oauth_request_vault_id is not null
    and oauth_request_fingerprint~'^[a-f0-9]{64}$' and request_payload='{"vaultBacked":true}'::jsonb;
  if not found then raise exception 'LAZADA_EXACT_PROVIDER_FENCE_FAILED';end if;
  update sellerpilot_private.lazada_exact_oauth_sessions set provider_called=true where id=s.id;return jsonb_build_object('status','provider_started');
 end if;
 if p_action='stage' and oauth and s.provider_called and s.prepared_id is null then
  refresh:=p_payload->'refresh';secret:=refresh->'payload';
  select d.decrypted_secret::jsonb into source from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=s.credential_id and c.created_by=s.owner_id and c.version=5 and c.status='active';
  if source is null or encode(extensions.digest(source::text,'sha256'),'hex')<>s.source_hash or not sellerpilot_private.lazada_same_account_oauth_evidence_v1(source,secret,'[{},{},{}]'::jsonb) or refresh->>'oauthComplete' is distinct from 'true' or coalesce((refresh->>'recoveryOnly')::boolean,false) then raise exception 'LAZADA_EXACT_STAGE_APPS_INVALID';end if;
  stores:=secret->'country_user_info';
  if secret->>'account_platform' is distinct from 'seller_center' or secret->>'provider_account_identity_version' is distinct from 'v1' or jsonb_typeof(stores) is distinct from 'array' or jsonb_array_length(stores) not between 1 and 6 then raise exception 'LAZADA_EXACT_PROVIDER_IDENTITY_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(stores) x where jsonb_typeof(x)<>'object' or coalesce(x->>'country','') not in('my','sg','ph','th','vn','id') or coalesce(x->>'seller_id','')!~'^[1-9][0-9]{0,31}$' or coalesce(x->>'user_id','')!~'^[1-9][0-9]{0,31}$') or (select count(distinct x->>'country') from jsonb_array_elements(stores)x)<>jsonb_array_length(stores) then raise exception 'LAZADA_EXACT_PROVIDER_STORES_INVALID';end if;
  select x into store from jsonb_array_elements(stores)x where x->>'country'='my';
  if store->>'seller_id' is distinct from '300872000183' or (nullif(store->>'short_code','') is not null and store->>'short_code'<>'MY4NNISR2D') then raise exception 'LAZADA_EXACT_SELLER_INVALID';end if;
  select string_agg(format('["%s","%s","%s"]',x->>'country',x->>'seller_id',x->>'user_id'),',' order by x->>'country') into canonical from jsonb_array_elements(stores)x;
  subject:='lazada:v1:'||translate(rtrim(replace(encode(convert_to('["seller_center",['||canonical||']]','UTF8'),'base64'),E'\n',''),'='),'+/','-_');
  if secret->>'provider_account_subject' is distinct from subject then raise exception 'LAZADA_EXACT_SUBJECT_INVALID';end if;
  result:=public.sellerpilot_service_prepare_gateway_credential_refresh(p_token_hash,j.id,j.claim_token,secret,(refresh->>'expiresAt')::timestamptz,false,true);
  if result->>'status' is distinct from 'prepared' then raise exception 'LAZADA_EXACT_STAGE_FAILED';end if;
  update sellerpilot_private.lazada_exact_oauth_sessions set prepared_id=(result->>'credential_id')::uuid,prepared_hash=(select encode(extensions.digest((d.decrypted_secret::jsonb)::text,'sha256'),'hex') from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=(result->>'credential_id')::uuid and c.created_by=s.owner_id and c.version=6) where id=s.id;return jsonb_build_object('status','prepared');
 end if;
 if p_action='complete' then
  checked_at:=clock_timestamp();req:=p_payload->'result';
  if req->>'ok' is distinct from 'true' or req->>'channel' is distinct from 'lazada' or req->>'operation' is distinct from j.operation then raise exception 'LAZADA_EXACT_RESULT_INVALID';end if;
  if oauth then
   if not s.provider_called or s.prepared_id is null or j.prepared_credential_id is distinct from s.prepared_id or not j.oauth_exchange_completed then raise exception 'LAZADA_EXACT_NOT_PREPARED';end if;
  else
   if jsonb_typeof(req->'steps') is distinct from 'array' or jsonb_array_length(req->'steps')<>1 or req#>>'{steps,0,name}' is distinct from 'seller-info' or req#>>'{steps,0,ok}' is distinct from 'true' or req#>>'{steps,0,data,code}' is distinct from '0' or coalesce((req#>>'{steps,0,status}')::integer,0) not between 200 and 299 or req#>>'{steps,0,data,data,seller_id}' is distinct from '300872000183' or req#>>'{steps,0,data,data,short_code}' is distinct from 'MY4NNISR2D' or req#>>'{steps,0,data,data,status}' is distinct from 'ACTIVE' then raise exception 'LAZADA_EXACT_READBACK_INVALID';end if;
  end if;
  -- Release only this read-only reservation after its exact signed GET was
  -- validated. No refresh/provider-write evidence is manufactured.
  if not oauth then update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=false,credential_refresh_started_at=null where id=j.id;end if;
  result:=public.sellerpilot_service_complete_gateway_transaction(p_token_hash,j.id,j.claim_token,'succeeded',req,null,null,null,null,null);
  if result->>'status' is distinct from 'completed' then raise exception 'LAZADA_EXACT_COMPLETION_FAILED';end if;
  completion_hash:=sellerpilot_private.gateway_completion_fingerprint('succeeded',req,null,null,null,null,null);
  if not exists(select 1 from sellerpilot_private.gateway_completion_receipts where job_id=j.id and claim_token=j.claim_token and worker_token_id=t.id and completion_fingerprint=completion_hash) then raise exception 'LAZADA_EXACT_RECEIPT_MISMATCH';end if;
  insert into sellerpilot_private.lazada_exact_completions(job_id,result_hash,completion_hash,lease_checked_at,lease_expires_at) values(j.id,encode(extensions.digest(req::text,'sha256'),'hex'),completion_hash,checked_at,j.lease_expires_at);
  if oauth then
   -- Only this newly completed exact OAuth may allocate this read-only job.
   -- Never exposes a queued row to the general worker/reaper.
   insert into sellerpilot_private.channel_gateway_jobs(credential_id,created_by,channel,environment,operation,status,attempt_count,request_payload,worker_token_id,claim_token,lease_expires_at,started_at,credential_refresh_in_flight,credential_refresh_started_at)
   values(s.prepared_id,s.owner_id,'lazada','production','shops.get','running',1,'{"country":"my"}',t.id,gen_random_uuid(),least(s.expires_at,clock_timestamp()+interval '3 minutes'),clock_timestamp(),true,clock_timestamp()) returning id into readid;
   insert into sellerpilot_private.lazada_exact_claims(job_id,session_id,operation,credential_id,credential_version,worker_issuer_id,worker_token_id,claim_token,request_hash)
   select readid,s.id,'shops.get',s.prepared_id,c.version,t.created_by,t.id,g.claim_token,encode(extensions.digest(g.request_payload::text,'sha256'),'hex') from sellerpilot_private.channel_gateway_jobs g join sellerpilot_private.channel_credentials c on c.id=g.credential_id where g.id=readid and c.version=6 and c.created_by=s.owner_id;
   if not found then raise exception 'LAZADA_EXACT_READBACK_VERSION_INVALID';end if;
   update sellerpilot_private.lazada_exact_oauth_sessions set readback_job_id=readid,phase='oauth_completed' where id=s.id;return jsonb_build_object('status','readback_ready','jobId',readid);
  end if;
  targetid:=public.sellerpilot_service_upsert_channel_market_target(s.owner_id,s.prepared_id,'lazada','300872000183','Couplet Seoul','MY','ms-MY','Bahasa Melayu','MYR','ACTIVE');
  if targetid is null then raise exception 'LAZADA_EXACT_TARGET_FAILED';end if;
  if exists(select 1 from sellerpilot_private.channel_gateway_jobs where id in('a976573f-a150-4061-a1c6-5e8e4880ba2b','d917f08b-1283-456e-930a-6042ec0b24a7','faee01e1-2d68-4f99-951c-15684822fc43') and status<>'cancelled') then
   update sellerpilot_private.lazada_exact_oauth_sessions set phase='review' where id=s.id;return jsonb_build_object('status','seller_verified_reconciliation_pending');
  end if;
  update sellerpilot_private.lazada_exact_oauth_sessions set phase='completed' where id=s.id;return jsonb_build_object('status','completed','sellerId','300872000183');
 end if;
 raise exception 'LAZADA_EXACT_ACTION_INVALID';
end $$;
revoke all on function public.sellerpilot_lazada_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_lazada_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb) to service_role;
commit;
