-- Parent-reviewed apply only. No general claimant, reaper or historical job repair.
begin;
create table sellerpilot_private.shopee_exact_oauth_sessions (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 credential_id uuid not null references sellerpilot_private.channel_credentials(id),
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 identity jsonb not null, worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
 ready_until timestamptz, expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes'),
 job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id), delivered boolean not null default false
);
alter table sellerpilot_private.shopee_exact_oauth_sessions enable row level security;
revoke all on sellerpilot_private.shopee_exact_oauth_sessions from public,anon,authenticated,service_role;

create function sellerpilot_private.shopee_exact_oauth_identity(p_credential uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; ids jsonb; v_account text;
begin
 select d.decrypted_secret::jsonb,c.seller_account_key into s,v_account
 from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where c.id=p_credential and c.created_by=p_owner and c.channel='shopee' and c.environment='production' and c.status='active';
 if s is null or s->>'partner_id' is distinct from '2031489' or s->>'shop_id' is distinct from '1719148844'
 or coalesce(s->>'main_account_id','') !~ '^[0-9]+$' or jsonb_typeof(s->'shop_ids') is distinct from 'array' then
 raise exception 'SHOPEE_EXACT_IDENTITY_REQUIRED'; end if;
 select jsonb_agg(id order by id) into ids from (select distinct value #>> '{}' id from jsonb_array_elements(s->'shop_ids')) x;
 if jsonb_array_length(ids)<>8 or not ids ? '1719148844' or exists(select 1 from jsonb_array_elements_text(ids) x where x !~ '^[0-9]+$') then
 raise exception 'SHOPEE_EXACT_EIGHT_SHOPS_REQUIRED'; end if;
 return jsonb_build_object('partner_id',s->>'partner_id','shop_id',s->>'shop_id','main_account_id',s->>'main_account_id',
 'shop_ids',ids,'seller_account_key',v_account,'provider_account_subject',s->>'provider_account_subject');
end $$;
revoke all on function sellerpilot_private.shopee_exact_oauth_identity(uuid,uuid) from public,anon,authenticated,service_role;

create function public.sellerpilot_shopee_exact_oauth_admin(p_action text,p_owner uuid,p_session uuid,p_credential uuid,p_state_hash text,p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sellerpilot_private.shopee_exact_oauth_sessions%rowtype; v_identity jsonb; v_job uuid; v_claim uuid; v_authorization_expires timestamptz; t record;
begin
 if p_action is null or p_action not in ('prepare','start','bind') or p_owner is null or p_session is null or p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' then raise exception 'SHOPEE_EXACT_REQUEST_INVALID'; end if;
 if not exists(select 1 from sellerpilot_private.admin_users where user_id=p_owner) then raise exception 'SHOPEE_EXACT_OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('shopee-exact:'||p_credential::text,0));
 v_identity:=sellerpilot_private.shopee_exact_oauth_identity(p_credential,p_owner);
 if p_action='prepare' then
   if exists(select 1 from sellerpilot_private.shopee_exact_oauth_sessions where owner_id=p_owner and credential_id=p_credential and expires_at>clock_timestamp()) then raise exception 'SHOPEE_EXACT_SESSION_EXISTS'; end if;
   insert into sellerpilot_private.shopee_exact_oauth_sessions(id,owner_id,credential_id,state_hash,identity) values(p_session,p_owner,p_credential,p_state_hash,v_identity);
   return jsonb_build_object('status','executor_required','sessionId',p_session);
 end if;
 select * into s from sellerpilot_private.shopee_exact_oauth_sessions where id=p_session for update;
 if not found or s.owner_id<>p_owner or s.credential_id<>p_credential or s.state_hash<>p_state_hash or s.expires_at<=clock_timestamp() or s.identity<>v_identity then raise exception 'SHOPEE_EXACT_SESSION_INVALID'; end if;
 select * into t from sellerpilot_private.ai_cli_worker_tokens where id=s.worker_token_id and created_by=p_owner and scope='gateway' and status='active' and expires_at>clock_timestamp() for update;
 if not found or s.ready_until is null or s.ready_until<=clock_timestamp() then return jsonb_build_object('status','executor_required'); end if;
 if s.job_id is not null then raise exception 'SHOPEE_EXACT_CODE_ALREADY_BOUND'; end if;
 if p_action='start' then return jsonb_build_object('status','ready','partnerId',s.identity->>'partner_id'); end if;
 if jsonb_typeof(p_request) is distinct from 'object' or coalesce(p_request->>'code','')='' or length(p_request->>'code')>8000
 or p_request->>'mainAccountId' is distinct from s.identity->>'main_account_id' then raise exception 'SHOPEE_EXACT_CALLBACK_IDENTITY_INVALID'; end if;
 -- Existing enqueue keeps its recon/credential fences. The new queued row is
 -- atomically assigned before commit: no generic claimant can observe it queued.
 select expires_at into v_authorization_expires from sellerpilot_private.channel_credentials where id=p_credential;
 if v_authorization_expires is null then raise exception 'SHOPEE_EXACT_AUTHORIZATION_EXPIRY_REQUIRED'; end if;
 v_job:=public.sellerpilot_enqueue_channel_gateway_job(p_credential,null,'shopee','oauth.exchange',
 jsonb_build_object('code',p_request->>'code','mainAccountId',s.identity->>'main_account_id','authorizationExpiresAt',v_authorization_expires,'shopeeExactSession',p_session));
 v_claim:=gen_random_uuid();
 update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=s.worker_token_id,claim_token=v_claim,
 attempt_count=1,lease_expires_at=clock_timestamp()+interval '3 minutes',started_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=v_job and credential_id=p_credential and created_by=p_owner and channel='shopee' and operation='oauth.exchange'
 and environment='production' and status='queued' and attempt_count=0 and provider_mutation_started_at is null
 and oauth_source_credential_id=p_credential and oauth_request_vault_id is not null
 and exists(select 1 from vault.decrypted_secrets d where d.id=oauth_request_vault_id and d.decrypted_secret::jsonb->>'shopeeExactSession'=p_session::text);
 if not found then raise exception 'SHOPEE_EXACT_FRESH_JOB_REQUIRED'; end if;
 update sellerpilot_private.shopee_exact_oauth_sessions set job_id=v_job where id=p_session;
 return jsonb_build_object('status','bound','jobId',v_job);
end $$;
revoke all on function public.sellerpilot_shopee_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_shopee_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb) to service_role;

create function public.sellerpilot_shopee_exact_oauth_worker(p_action text,p_session uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sellerpilot_private.shopee_exact_oauth_sessions%rowtype; t record; j record; secret jsonb; oauth_request jsonb;
begin
 if p_action is null or p_action not in ('pulse','claim') then raise exception 'SHOPEE_EXACT_REQUEST_INVALID'; end if;
 select * into s from sellerpilot_private.shopee_exact_oauth_sessions where id=p_session for update;
 if not found or s.expires_at<=clock_timestamp() then raise exception 'SHOPEE_EXACT_SESSION_INVALID'; end if;
 select * into t from sellerpilot_private.ai_cli_worker_tokens where token_hash=p_token_hash and scope='gateway' and status='active' and expires_at>clock_timestamp() and created_by=s.owner_id for update;
 if not found or (s.worker_token_id is not null and s.worker_token_id<>t.id) then raise exception 'SHOPEE_EXACT_TOKEN_INVALID'; end if;
 if s.identity<>sellerpilot_private.shopee_exact_oauth_identity(s.credential_id,s.owner_id) then raise exception 'SHOPEE_EXACT_IDENTITY_CHANGED'; end if;
 if p_action='pulse' then
   if s.delivered then raise exception 'SHOPEE_EXACT_ALREADY_DELIVERED'; end if;
   update sellerpilot_private.shopee_exact_oauth_sessions set worker_token_id=t.id,ready_until=clock_timestamp()+interval '45 seconds' where id=s.id;
   return jsonb_build_object('status','armed','sessionId',s.id);
 end if;
 if s.job_id is null then return jsonb_build_object('status','waiting'); end if;
 if s.delivered or s.ready_until is null or s.ready_until<=clock_timestamp() then raise exception 'SHOPEE_EXACT_CLAIM_EXPIRED'; end if;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=s.job_id and worker_token_id=t.id and credential_id=s.credential_id
 and created_by=s.owner_id and channel='shopee' and operation='oauth.exchange' and environment='production'
 and status='running' and attempt_count=1 and lease_expires_at>clock_timestamp() and provider_mutation_started_at is null
 and oauth_source_credential_id=s.credential_id and oauth_request_vault_id is not null for update;
 if not found then raise exception 'SHOPEE_EXACT_JOB_INVALID'; end if;
 select d.decrypted_secret::jsonb into oauth_request from vault.decrypted_secrets d where d.id=j.oauth_request_vault_id;
 if oauth_request is null or oauth_request->>'shopeeExactSession' is distinct from s.id::text
 or oauth_request->>'mainAccountId' is distinct from s.identity->>'main_account_id'
 or coalesce(oauth_request->>'code','')='' then raise exception 'SHOPEE_EXACT_VAULT_REQUEST_INVALID'; end if;
 select d.decrypted_secret::jsonb into secret from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id where c.id=s.credential_id;
 update sellerpilot_private.shopee_exact_oauth_sessions set delivered=true where id=s.id;
 return jsonb_build_object('status','claimed','job',jsonb_build_object('id',j.id,'claim_token',j.claim_token,'credential_id',j.credential_id,
 'channel',j.channel,'operation',j.operation,'environment',j.environment,'request',oauth_request,'attempt_count',j.attempt_count,'credential',secret));
end $$;
revoke all on function public.sellerpilot_shopee_exact_oauth_worker(text,uuid,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_shopee_exact_oauth_worker(text,uuid,text) to service_role;
-- Dedicated lease only: never call generic touch/claim or mutate token metadata.
create function public.sellerpilot_shopee_exact_oauth_heartbeat(p_session uuid,p_token_hash text,p_job uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s sellerpilot_private.shopee_exact_oauth_sessions%rowtype; t record;
begin
 select * into s from sellerpilot_private.shopee_exact_oauth_sessions where id=p_session for update;
 if not found or not s.delivered or s.job_id is distinct from p_job or s.expires_at<=clock_timestamp() then raise exception 'SHOPEE_EXACT_SESSION_INVALID'; end if;
 select * into t from sellerpilot_private.ai_cli_worker_tokens where id=s.worker_token_id
 and token_hash=p_token_hash and created_by=s.owner_id and scope='gateway'
 and status='active' and expires_at>clock_timestamp() for share;
 if not found then raise exception 'SHOPEE_EXACT_TOKEN_INVALID'; end if;
 update sellerpilot_private.channel_gateway_jobs j
 set lease_expires_at=least(s.expires_at,clock_timestamp()+interval '3 minutes'),updated_at=clock_timestamp()
 where j.id=p_job and j.claim_token=p_claim and j.worker_token_id=t.id and j.created_by=s.owner_id
 and j.channel='shopee' and j.environment='production' and j.operation='oauth.exchange'
 and j.oauth_source_credential_id=s.credential_id and j.status='running' and j.attempt_count=1
 and j.lease_expires_at>clock_timestamp();
 if not found then raise exception 'SHOPEE_EXACT_LEASE_LOST'; end if;
 return jsonb_build_object('status','running');
end $$;
revoke all on function public.sellerpilot_shopee_exact_oauth_heartbeat(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sellerpilot_shopee_exact_oauth_heartbeat(uuid,text,uuid,uuid) to service_role;

commit;
