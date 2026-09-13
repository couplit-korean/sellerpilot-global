begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('sellerpilot_private.lazada_im_exact_oauth_sessions') is not null
     or to_regprocedure('public.sellerpilot_lazada_im_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_lazada_im_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb)') is not null then
    raise exception 'LAZADA_IM_EXACT_ALREADY_DEFINED';
  end if;
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.ai_cli_worker_tokens') is null
     or to_regclass('sellerpilot_private.local_channel_executor_routes') is null
     or to_regclass('sellerpilot_private.cs_credential_capability_bindings') is null
     or to_regprocedure('sellerpilot_private.worker_token_has_scope(text,text,boolean)') is null
     or to_regprocedure('sellerpilot_private.active_serverless_runtime_release_sha()') is null
     or to_regprocedure('sellerpilot_private.lazada_im_secret_binding(jsonb,text)') is null
     or to_regprocedure('public.sellerpilot_service_begin_gateway_credential_refresh(text,uuid,uuid)') is null
     or to_regprocedure('public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz,boolean,boolean)') is null
     or to_regprocedure('public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)') is null
     or not exists (
       select 1 from pg_catalog.pg_proc
       where oid = to_regprocedure('vault.create_secret(text,text,text,uuid)')
         and pronargdefaults >= 1 and prorettype = 'uuid'::regtype
     ) then
    raise exception 'LAZADA_IM_EXACT_DEPENDENCY_MISSING';
  end if;
end
$$;

create table sellerpilot_private.lazada_im_exact_oauth_sessions (
  id uuid primary key,
  actor_id uuid not null references auth.users(id),
  owner_id uuid not null references auth.users(id),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  source_version integer not null check (source_version > 0),
  source_fingerprint text not null,
  source_secret_hash text not null check (source_secret_hash ~ '^[a-f0-9]{64}$'),
  source_seller_account_key text not null check (source_seller_account_key ~ '^[a-f0-9]{64}$'),
  source_expires_at timestamptz,
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
  worker_issuer_id uuid references auth.users(id),
  release_sha text check (release_sha is null or release_sha ~ '^[a-f0-9]{40}$'),
  egress_ip_sha256 text check (egress_ip_sha256 is null or egress_ip_sha256 ~ '^[a-f0-9]{64}$'),
  worker_version text,
  approved_at timestamptz not null default clock_timestamp(),
  ready_until timestamptz,
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id),
  claim_token uuid unique,
  code_fingerprint text unique check (code_fingerprint is null or code_fingerprint ~ '^[a-f0-9]{64}$'),
  code_vault_id uuid,
  code_delivered_at timestamptz,
  provider_started_at timestamptz,
  recovery_vault_id uuid,
  recovery_hash text check (recovery_hash is null or recovery_hash ~ '^[a-f0-9]{64}$'),
  recovery_staged_at timestamptz,
  prepared_credential_id uuid references sellerpilot_private.channel_credentials(id),
  prepared_secret_hash text check (prepared_secret_hash is null or prepared_secret_hash ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz,
  phase text not null default 'prepared' check (phase in (
    'prepared','armed','bound','oauth_running','provider_started',
    'recovery_preserved','candidate_prepared','completed','review'
  )),
  check (expires_at > approved_at and expires_at <= approved_at + interval '15 minutes'),
  check ((worker_token_id is null and worker_issuer_id is null and release_sha is null
      and egress_ip_sha256 is null and worker_version is null)
    or (worker_token_id is not null and worker_issuer_id is not null and release_sha is not null
      and egress_ip_sha256 is not null
      and worker_version = 'sellerpilot-cli-worker/1.61+' || release_sha || '.' || left(egress_ip_sha256,11)))
);

create table sellerpilot_private.lazada_im_exact_oauth_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references sellerpilot_private.lazada_im_exact_oauth_sessions(id),
  job_id uuid references sellerpilot_private.channel_gateway_jobs(id),
  event_type text not null check (event_type in (
    'prepared','armed','code_bound','code_delivered','provider_started',
    'recovery_preserved','candidate_prepared','completed','review'
  )),
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  safe_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_detail) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create table sellerpilot_private.lazada_im_exact_oauth_readbacks (
  session_id uuid not null references sellerpilot_private.lazada_im_exact_oauth_sessions(id),
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  country text not null check (country in ('my','ph','sg','th','vn')),
  seller_id text not null,
  http_status integer not null check (http_status = 200),
  provider_code text not null check (provider_code = '0'),
  remote_request_id text not null check (length(remote_request_id) between 1 and 240),
  app_fingerprint text not null check (app_fingerprint ~ '^[a-f0-9]{64}$'),
  token_fingerprint text not null check (token_fingerprint ~ '^[a-f0-9]{64}$'),
  target_fingerprint text not null check (target_fingerprint ~ '^[a-f0-9]{64}$'),
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (session_id,country),
  unique (job_id,country)
);

alter table sellerpilot_private.lazada_im_exact_oauth_sessions enable row level security;
alter table sellerpilot_private.lazada_im_exact_oauth_events enable row level security;
alter table sellerpilot_private.lazada_im_exact_oauth_readbacks enable row level security;
revoke all on sellerpilot_private.lazada_im_exact_oauth_sessions,
  sellerpilot_private.lazada_im_exact_oauth_events,
  sellerpilot_private.lazada_im_exact_oauth_readbacks
  from public,anon,authenticated,service_role;
revoke all on sequence sellerpilot_private.lazada_im_exact_oauth_events_id_seq
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_exact_immutable_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'LAZADA_IM_EXACT_EVIDENCE_IMMUTABLE';
end
$$;
create trigger lazada_im_exact_events_immutable before update or delete
  on sellerpilot_private.lazada_im_exact_oauth_events for each row
  execute function sellerpilot_private.lazada_im_exact_immutable_evidence();
create trigger lazada_im_exact_readbacks_immutable before update or delete
  on sellerpilot_private.lazada_im_exact_oauth_readbacks for each row
  execute function sellerpilot_private.lazada_im_exact_immutable_evidence();
revoke all on function sellerpilot_private.lazada_im_exact_immutable_evidence()
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_exact_session_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array[
      'worker_token_id','worker_issuer_id','release_sha','egress_ip_sha256','worker_version',
      'ready_until','job_id','claim_token','code_fingerprint','code_vault_id',
      'code_delivered_at','provider_started_at','recovery_vault_id','recovery_hash',
      'recovery_staged_at','prepared_credential_id','prepared_secret_hash',
      'completed_at','phase'
    ]) is distinct from (to_jsonb(old) - array[
      'worker_token_id','worker_issuer_id','release_sha','egress_ip_sha256','worker_version',
      'ready_until','job_id','claim_token','code_fingerprint','code_vault_id',
      'code_delivered_at','provider_started_at','recovery_vault_id','recovery_hash',
      'recovery_staged_at','prepared_credential_id','prepared_secret_hash',
      'completed_at','phase'
    ])
    or (old.worker_token_id is not null and new.worker_token_id is distinct from old.worker_token_id)
    or (old.worker_issuer_id is not null and new.worker_issuer_id is distinct from old.worker_issuer_id)
    or (old.release_sha is not null and new.release_sha is distinct from old.release_sha)
    or (old.egress_ip_sha256 is not null and new.egress_ip_sha256 is distinct from old.egress_ip_sha256)
    or (old.worker_version is not null and new.worker_version is distinct from old.worker_version)
    or (old.job_id is not null and new.job_id is distinct from old.job_id)
    or (old.claim_token is not null and new.claim_token is distinct from old.claim_token)
    or (old.code_fingerprint is not null and new.code_fingerprint is distinct from old.code_fingerprint)
    or (old.code_vault_id is not null and new.code_vault_id is distinct from old.code_vault_id)
    or (old.code_delivered_at is not null and new.code_delivered_at is distinct from old.code_delivered_at)
    or (old.provider_started_at is not null and new.provider_started_at is distinct from old.provider_started_at)
    or (old.recovery_vault_id is not null and new.recovery_vault_id is distinct from old.recovery_vault_id)
    or (old.recovery_hash is not null and new.recovery_hash is distinct from old.recovery_hash)
    or (old.recovery_staged_at is not null and new.recovery_staged_at is distinct from old.recovery_staged_at)
    or (old.prepared_credential_id is not null and new.prepared_credential_id is distinct from old.prepared_credential_id)
    or (old.prepared_secret_hash is not null and new.prepared_secret_hash is distinct from old.prepared_secret_hash)
    or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception 'LAZADA_IM_EXACT_SESSION_IDENTITY_IMMUTABLE';
  end if;
  return new;
end
$$;
create trigger lazada_im_exact_session_identity before update
  on sellerpilot_private.lazada_im_exact_oauth_sessions for each row
  execute function sellerpilot_private.lazada_im_exact_session_guard();
revoke all on function sellerpilot_private.lazada_im_exact_session_guard()
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_exact_commerce_five_country(p_secret jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_secret) = 'object'
    and p_secret->>'account_platform' = 'seller_center'
    and jsonb_typeof(p_secret->'country_user_info') = 'array'
    and jsonb_array_length(p_secret->'country_user_info') = 5
    and not exists (
      select 1 from jsonb_array_elements(p_secret->'country_user_info') row
      where jsonb_typeof(row) <> 'object'
        or lower(coalesce(row->>'country','')) not in ('my','ph','sg','th','vn')
        or coalesce(row->>'seller_id','') !~ '^[1-9][0-9]{0,31}$'
        or coalesce(row->>'user_id','') !~ '^[1-9][0-9]{0,31}$'
    )
    and (select count(distinct lower(row->>'country')) from jsonb_array_elements(p_secret->'country_user_info') row) = 5
    and not exists (
      select 1 from (values
        ('my','300872000183'),('ph','501846640243'),('sg','1754224042'),
        ('th','101407248667'),('vn','201095728264')
      ) expected(country,seller_id)
      where not exists (
        select 1 from jsonb_array_elements(p_secret->'country_user_info') row
        where lower(row->>'country') = expected.country and row->>'seller_id' = expected.seller_id
      )
    )
$$;
revoke all on function sellerpilot_private.lazada_im_exact_commerce_five_country(jsonb)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_exact_five_country_identity(p_secret jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select sellerpilot_private.lazada_im_exact_commerce_five_country(p_secret)
    and p_secret->>'im_account_platform' = 'seller_center'
    and jsonb_typeof(p_secret->'im_country_user_info') = 'array'
    and jsonb_array_length(p_secret->'im_country_user_info') = 5
    and (not (p_secret ? 'im_country_user_info_list') or (
      jsonb_typeof(p_secret->'im_country_user_info_list') = 'array'
      and jsonb_array_length(p_secret->'im_country_user_info_list') = 5
    ))
    and not exists (
      select 1 from jsonb_array_elements(p_secret->'im_country_user_info') row
      where jsonb_typeof(row) <> 'object'
        or lower(coalesce(row->>'country','')) not in ('my','ph','sg','th','vn')
        or coalesce(row->>'seller_id','') !~ '^[1-9][0-9]{0,31}$'
        or not exists (
          select 1 from jsonb_array_elements(p_secret->'country_user_info') commerce
          where lower(commerce->>'country') = lower(row->>'country')
            and commerce->>'seller_id' = row->>'seller_id'
        )
    )
    and (select count(distinct lower(row->>'country')) from jsonb_array_elements(p_secret->'im_country_user_info') row) = 5
    and not exists (
      select 1 from (values
        ('my','300872000183'),('ph','501846640243'),('sg','1754224042'),
        ('th','101407248667'),('vn','201095728264')
      ) expected(country,seller_id)
      where not exists (
        select 1 from jsonb_array_elements(p_secret->'im_country_user_info') row
        where lower(row->>'country') = expected.country and row->>'seller_id' = expected.seller_id
      ) or ((p_secret ? 'im_country_user_info_list') and not exists (
        select 1 from jsonb_array_elements(p_secret->'im_country_user_info_list') row
        where lower(row->>'country') = expected.country and row->>'seller_id' = expected.seller_id
      ))
    )
$$;
revoke all on function sellerpilot_private.lazada_im_exact_five_country_identity(jsonb)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_exact_source(p_credential uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c sellerpilot_private.channel_credentials%rowtype;
  secret jsonb;
begin
  select * into c from sellerpilot_private.channel_credentials
  where id = p_credential and channel = 'lazada' and environment = 'production'
    and status = 'active' and (expires_at is null or expires_at > clock_timestamp())
    and seller_account_key is not null
    and seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
    and seller_account_verified_at is not null;
  if not found or not exists (
    select 1 from sellerpilot_private.admin_users a where a.user_id = c.created_by
  ) then raise exception 'LAZADA_IM_EXACT_SOURCE_INVALID'; end if;
  select decrypted_secret::jsonb into secret from vault.decrypted_secrets
  where id = c.vault_secret_id;
  if secret is null
     or secret->>'app_key' is distinct from '137451'
     or secret->>'im_app_key' is distinct from '137571'
     or secret->>'country' is distinct from 'my'
     or nullif(secret->>'app_secret','') is null
     or nullif(secret->>'im_app_secret','') is null
     or secret->>'provider_account_identity_version' is distinct from 'v1'
     or coalesce(secret->>'provider_account_subject','') !~ '^lazada:v1:[A-Za-z0-9_-]+$'
     or not sellerpilot_private.lazada_im_exact_commerce_five_country(secret) then
    raise exception 'LAZADA_IM_EXACT_SOURCE_IDENTITY_INVALID';
  end if;
  return jsonb_build_object(
    'ownerId',c.created_by,'version',c.version,'fingerprint',c.fingerprint,
    'secretHash',encode(extensions.digest(secret::text,'sha256'),'hex'),
    'expiresAt',c.expires_at,'sellerAccountKey',c.seller_account_key
  );
end
$$;
revoke all on function sellerpilot_private.lazada_im_exact_source(uuid)
  from public,anon,authenticated,service_role;

-- Recovery is intentionally less strict than activation. Once the provider
-- returns rotating tokens they must be durably recoverable even if its country
-- list or expiry fields are malformed. Only the source commerce/app material
-- and the returned token pair are admitted here; final stage validates identity
-- and expiry before calling the existing credential rotation helper.
create function sellerpilot_private.lazada_im_exact_recovery_valid(
  p_source jsonb,p_recovery jsonb
) returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_source) = 'object' and jsonb_typeof(p_recovery) = 'object'
    and (p_recovery - array[
      'im_access_token','im_refresh_token','im_access_token_expires_at',
      'im_refresh_token_expires_at','im_account_platform','im_country_user_info',
      'im_country_user_info_list','im_identity_source'
    ]) = (p_source - array[
      'im_access_token','im_refresh_token','im_access_token_expires_at',
      'im_refresh_token_expires_at','im_account_platform','im_country_user_info',
      'im_country_user_info_list','im_identity_source'
    ])
    and p_recovery->>'app_key' = '137451'
    and p_recovery->>'im_app_key' = '137571'
    and p_recovery->>'im_app_secret' = p_source->>'im_app_secret'
    and length(coalesce(p_recovery->>'im_access_token','')) >= 8
    and length(coalesce(p_recovery->>'im_refresh_token','')) >= 8
$$;
revoke all on function sellerpilot_private.lazada_im_exact_recovery_valid(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_exact_candidate_valid(
  p_source jsonb,p_candidate jsonb,p_recovery jsonb
) returns boolean language sql stable set search_path = '' as $$
  select jsonb_typeof(p_source) = 'object' and jsonb_typeof(p_candidate) = 'object'
    and jsonb_typeof(p_recovery) = 'object'
    and (p_candidate - array[
      'im_access_token','im_refresh_token','im_access_token_expires_at',
      'im_refresh_token_expires_at','im_account_platform','im_country_user_info',
      'im_country_user_info_list','im_identity_source'
    ]) = (p_source - array[
      'im_access_token','im_refresh_token','im_access_token_expires_at',
      'im_refresh_token_expires_at','im_account_platform','im_country_user_info',
      'im_country_user_info_list','im_identity_source'
    ])
    and (p_recovery - array[
      'im_access_token','im_refresh_token','im_access_token_expires_at',
      'im_refresh_token_expires_at','im_account_platform','im_country_user_info',
      'im_country_user_info_list','im_identity_source'
    ]) = (p_source - array[
      'im_access_token','im_refresh_token','im_access_token_expires_at',
      'im_refresh_token_expires_at','im_account_platform','im_country_user_info',
      'im_country_user_info_list','im_identity_source'
    ])
    and p_candidate->>'app_key' = '137451'
    and p_candidate->>'im_app_key' = '137571'
    and p_candidate->>'im_app_secret' = p_source->>'im_app_secret'
    and p_candidate->>'im_identity_source' = 'lazada.oauth_token'
    and length(coalesce(p_candidate->>'im_access_token','')) >= 8
    and length(coalesce(p_candidate->>'im_refresh_token','')) >= 8
    and p_candidate->>'im_access_token' = p_recovery->>'im_access_token'
    and p_candidate->>'im_refresh_token' = p_recovery->>'im_refresh_token'
    and coalesce(nullif(p_candidate->>'im_access_token_expires_at','')::timestamptz > clock_timestamp(),false)
    and coalesce(nullif(p_candidate->>'im_refresh_token_expires_at','')::timestamptz > clock_timestamp(),false)
    and sellerpilot_private.lazada_im_exact_five_country_identity(p_candidate)
$$;
revoke all on function sellerpilot_private.lazada_im_exact_candidate_valid(jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_lazada_im_exact_oauth_admin(
  p_action text,p_actor uuid,p_session uuid,p_credential uuid,
  p_state_hash text,p_request jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s sellerpilot_private.lazada_im_exact_oauth_sessions%rowtype;
  identity jsonb;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  v_job_id uuid;
  v_claim_id uuid;
  v_vault_id uuid;
  code text;
  code_fp text;
begin
  if current_setting('role',true) is distinct from 'service_role'
     or not exists (select 1 from sellerpilot_private.admin_users where user_id = p_actor) then
    raise exception 'LAZADA_IM_EXACT_ACTOR_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('prepare','start','status','bind')
     or p_session is null or p_credential is null
     or coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'LAZADA_IM_EXACT_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lazada-im-exact:' || p_credential::text,0));

  if p_action = 'prepare' then
    if p_request is distinct from '{}'::jsonb then raise exception 'LAZADA_IM_EXACT_PREPARE_INPUT_INVALID'; end if;
    identity := sellerpilot_private.lazada_im_exact_source(p_credential);
    if exists (select 1 from sellerpilot_private.lazada_im_exact_oauth_sessions
      where credential_id = p_credential and expires_at > clock_timestamp()
        and phase not in ('completed','review')) then
      raise exception 'LAZADA_IM_EXACT_SESSION_EXISTS';
    end if;
    insert into sellerpilot_private.lazada_im_exact_oauth_sessions(
      id,actor_id,owner_id,credential_id,source_version,source_fingerprint,
      source_secret_hash,source_seller_account_key,source_expires_at,state_hash
    ) values (
      p_session,p_actor,(identity->>'ownerId')::uuid,p_credential,
      (identity->>'version')::integer,identity->>'fingerprint',identity->>'secretHash',
      identity->>'sellerAccountKey',(identity->>'expiresAt')::timestamptz,p_state_hash
    );
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,event_type,evidence_hash,safe_detail)
    values (p_session,'prepared',encode(extensions.digest(p_request::text,'sha256'),'hex'),
      jsonb_build_object('actorId',p_actor,'ownerId',identity->>'ownerId','credentialId',p_credential,
        'sourceVersion',(identity->>'version')::integer,'sourceFingerprint',identity->>'fingerprint'));
    return jsonb_build_object('status','executor_required','sessionId',p_session);
  end if;

  select * into s from sellerpilot_private.lazada_im_exact_oauth_sessions
  where id = p_session for update;
  if not found or s.actor_id <> p_actor or s.credential_id <> p_credential
     or s.state_hash <> p_state_hash or s.expires_at <= clock_timestamp() then
    raise exception 'LAZADA_IM_EXACT_SESSION_INVALID';
  end if;
  if p_action = 'status' then
    return jsonb_build_object('status',s.phase,'sessionId',s.id);
  end if;
  identity := sellerpilot_private.lazada_im_exact_source(s.credential_id);
  if identity->>'ownerId' is distinct from s.owner_id::text
     or (identity->>'version')::integer <> s.source_version
     or identity->>'fingerprint' is distinct from s.source_fingerprint
     or identity->>'secretHash' is distinct from s.source_secret_hash
     or identity->>'sellerAccountKey' is distinct from s.source_seller_account_key
     or (identity->>'expiresAt')::timestamptz is distinct from s.source_expires_at then
    raise exception 'LAZADA_IM_EXACT_SOURCE_CHANGED';
  end if;
  select * into worker from sellerpilot_private.ai_cli_worker_tokens
  where id = s.worker_token_id and created_by = s.worker_issuer_id and scope = 'gateway'
    and status = 'active' and expires_at > clock_timestamp()
    and last_seen_at >= clock_timestamp() - interval '3 minutes'
    and last_version = s.worker_version;
  if not found or not sellerpilot_private.worker_token_has_scope(worker.token_hash,'gateway',true)
     or sellerpilot_private.active_serverless_runtime_release_sha() is distinct from s.release_sha
     or s.ready_until is null or s.ready_until <= clock_timestamp() then
    return jsonb_build_object('status','executor_required');
  end if;
  if p_action = 'start' then return jsonb_build_object('status','ready'); end if;
  if s.job_id is not null then raise exception 'LAZADA_IM_EXACT_CODE_ALREADY_BOUND'; end if;

  code := trim(coalesce(p_request->>'code',''));
  if (select count(*) from jsonb_object_keys(p_request)) <> 2
     or p_request->>'country' is distinct from 'cb'
     or length(code) not between 1 and 8000
     or (code ~ '^0_[0-9]+_' and split_part(code,'_',2) <> '137571') then
    raise exception 'LAZADA_IM_EXACT_CALLBACK_INVALID';
  end if;
  code_fp := encode(extensions.digest(jsonb_build_object(
    'appKey','137571','code',code,'country','cb'
  )::text,'sha256'),'hex');
  if exists (select 1 from sellerpilot_private.lazada_im_exact_oauth_sessions
    where code_fingerprint = code_fp) then raise exception 'LAZADA_IM_EXACT_CODE_REUSED'; end if;
  v_job_id := gen_random_uuid(); v_claim_id := gen_random_uuid();
  v_vault_id := vault.create_secret(jsonb_build_object(
    'code',code,'country','cb','lazadaImExactSession',s.id,
    'oauthPurpose','im_cross_border','codeDelivery','single','codeAppKey','137571'
  )::text,'sellerpilot-lazada-im-cb-' || v_job_id::text,
    'Claim-bound one-time Lazada IM cross-border OAuth code');
  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,created_by,channel,environment,operation,status,attempt_count,
    request_payload,worker_token_id,claim_token,lease_expires_at,created_at,started_at,
    updated_at,oauth_source_credential_id,oauth_request_vault_id,oauth_request_fingerprint,
    credential_refresh_in_flight,credential_refresh_started_at
  ) values (
    v_job_id,s.credential_id,s.owner_id,'lazada','production','oauth.exchange','running',1,
    '{"vaultBacked":true,"oauthPurpose":"im_cross_border","country":"cb"}',
    s.worker_token_id,v_claim_id,least(s.expires_at,clock_timestamp()+interval '3 minutes'),
    clock_timestamp(),clock_timestamp(),clock_timestamp(),s.credential_id,v_vault_id,code_fp,true,clock_timestamp()
  );
  update sellerpilot_private.lazada_im_exact_oauth_sessions set
    job_id = v_job_id,claim_token = v_claim_id,code_fingerprint = code_fp,
    code_vault_id = v_vault_id,phase = 'bound' where id = s.id;
  insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
  values (s.id,v_job_id,'code_bound',code_fp,jsonb_build_object(
    'appKey','137571','country','cb','codeDelivery','single','jobId',v_job_id,'claimToken',v_claim_id));
  return jsonb_build_object('status','bound','jobId',v_job_id);
end
$$;
revoke all on function public.sellerpilot_lazada_im_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_lazada_im_exact_oauth_admin(text,uuid,uuid,uuid,text,jsonb)
  to service_role;

create function public.sellerpilot_lazada_im_exact_oauth_worker(
  p_action text,p_session uuid,p_token_hash text,p_job uuid,p_claim uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s sellerpilot_private.lazada_im_exact_oauth_sessions%rowtype;
  worker sellerpilot_private.ai_cli_worker_tokens%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  source jsonb;
  request_secret jsonb;
  recovery jsonb;
  candidate jsonb;
  refresh jsonb;
  result_payload jsonb;
  readbacks jsonb;
  row_value jsonb;
  binding jsonb;
  prepared jsonb;
  vault_id uuid;
  payload_hash text;
  now_at timestamptz := clock_timestamp();
  country_count integer;
  route_count integer;
  inserted_route_count integer;
  disabled_route_count integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'LAZADA_IM_EXACT_ROLE_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('pulse','claim','heartbeat','begin','provider','stage','complete','review')
     or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'LAZADA_IM_EXACT_INPUT_INVALID';
  end if;
  select * into s from sellerpilot_private.lazada_im_exact_oauth_sessions
  where id = p_session for update;
  if not found or s.expires_at <= now_at or s.phase in ('completed','review')
     or not exists (select 1 from sellerpilot_private.admin_users where user_id = s.actor_id)
     or not exists (select 1 from sellerpilot_private.admin_users where user_id = s.owner_id) then
    raise exception 'LAZADA_IM_EXACT_SESSION_INVALID';
  end if;
  if coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true) then
    raise exception 'LAZADA_IM_EXACT_TOKEN_INVALID' using errcode = '42501';
  end if;
  select * into worker from sellerpilot_private.ai_cli_worker_tokens
  where token_hash = p_token_hash and scope = 'gateway' and status = 'active'
    and expires_at > now_at;
  if not found or not exists (
    select 1 from sellerpilot_private.admin_users where user_id = worker.created_by
  ) then raise exception 'LAZADA_IM_EXACT_TOKEN_INVALID' using errcode = '42501'; end if;

  if p_action = 'pulse' then
    if (select count(*) from jsonb_object_keys(p_payload)) <> 3
       or coalesce(p_payload->>'releaseSha','') !~ '^[a-f0-9]{40}$'
       or coalesce(p_payload->>'egressIpSha256','') !~ '^[a-f0-9]{64}$'
       or p_payload->>'workerVersion' is distinct from
         'sellerpilot-cli-worker/1.61+' || (p_payload->>'releaseSha') || '.' || left(p_payload->>'egressIpSha256',11)
       or sellerpilot_private.active_serverless_runtime_release_sha() is distinct from p_payload->>'releaseSha'
       or worker.last_seen_at < now_at - interval '3 minutes'
       or worker.last_version is distinct from p_payload->>'workerVersion'
       or not exists (
         select 1 from sellerpilot_private.local_channel_executor_routes route
         join sellerpilot_private.channel_credentials credential
           on credential.id = route.credential_id and credential.id = s.credential_id
          and credential.created_by = s.owner_id and credential.channel = 'lazada'
          and credential.environment = 'production' and credential.status = 'active'
          and (credential.expires_at is null or credential.expires_at > now_at)
          and credential.seller_account_key = route.seller_account_key
         where route.owner_id = s.owner_id and route.channel = 'lazada'
           and route.operation in ('diagnostic.test','inquiries.list','orders.list')
           and route.worker_token_id = worker.id
           and route.release_sha = p_payload->>'releaseSha'
           and route.egress_ip_sha256 = p_payload->>'egressIpSha256'
           and route.enabled and route.approved_at <= now_at and route.expires_at > now_at
           and exists (select 1 from sellerpilot_private.admin_users approver
             where approver.user_id = route.approved_by)
       )
       or (s.worker_token_id is not null and (
         s.worker_token_id is distinct from worker.id
         or s.worker_issuer_id is distinct from worker.created_by
         or s.release_sha is distinct from p_payload->>'releaseSha'
         or s.egress_ip_sha256 is distinct from p_payload->>'egressIpSha256'
         or s.worker_version is distinct from p_payload->>'workerVersion'
       )) then
      raise exception 'LAZADA_IM_EXACT_ATTESTATION_INVALID';
    end if;
    if sellerpilot_private.lazada_im_exact_source(s.credential_id)->>'secretHash' is distinct from s.source_secret_hash then
      raise exception 'LAZADA_IM_EXACT_SOURCE_CHANGED';
    end if;
    update sellerpilot_private.lazada_im_exact_oauth_sessions set
      worker_token_id = worker.id,worker_issuer_id = worker.created_by,
      release_sha = p_payload->>'releaseSha',egress_ip_sha256 = p_payload->>'egressIpSha256',
      worker_version = p_payload->>'workerVersion',
      ready_until = now_at + interval '45 seconds',phase = case when phase='prepared' then 'armed' else phase end
      where id = s.id;
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,event_type,evidence_hash,safe_detail)
    values (s.id,'armed',encode(extensions.digest(p_payload::text,'sha256'),'hex'),
      jsonb_build_object('workerTokenId',worker.id,'workerIssuerId',worker.created_by,
        'releaseSha',p_payload->>'releaseSha','egressIpSha256',p_payload->>'egressIpSha256'));
    return jsonb_build_object('status','armed');
  end if;

  if s.worker_token_id is distinct from worker.id
     or s.worker_issuer_id is distinct from worker.created_by
     or s.release_sha is null or s.egress_ip_sha256 is null or s.worker_version is null
     or worker.last_seen_at < now_at - interval '3 minutes'
     or worker.last_version is distinct from s.worker_version
     or sellerpilot_private.active_serverless_runtime_release_sha() is distinct from s.release_sha then
    raise exception 'LAZADA_IM_EXACT_ATTESTATION_DRIFT';
  end if;

  if p_action = 'claim' then
    if s.job_id is null then return jsonb_build_object('status','waiting'); end if;
    p_job := s.job_id; p_claim := s.claim_token;
  end if;
  select * into job from sellerpilot_private.channel_gateway_jobs
  where id = p_job and id = s.job_id and credential_id = coalesce(s.prepared_credential_id,s.credential_id)
    and created_by = s.owner_id and channel = 'lazada' and environment = 'production'
    and operation = 'oauth.exchange' and status = 'running' and attempt_count = 1
    and worker_token_id = worker.id and claim_token = p_claim and lease_expires_at > now_at
    and provider_mutation_started_at is null for update;
  if not found or job.oauth_source_credential_id is distinct from s.credential_id
     or job.oauth_request_vault_id is distinct from s.code_vault_id
     or job.oauth_request_fingerprint is distinct from s.code_fingerprint then
    raise exception 'LAZADA_IM_EXACT_CLAIM_INVALID';
  end if;

  if p_action = 'claim' then
    if s.code_delivered_at is not null then raise exception 'LAZADA_IM_EXACT_CODE_ALREADY_DELIVERED'; end if;
    if s.ready_until is null or s.ready_until <= now_at or s.provider_started_at is not null then
      raise exception 'LAZADA_IM_EXACT_NOT_READY';
    end if;
    select decrypted_secret::jsonb into request_secret from vault.decrypted_secrets where id = s.code_vault_id;
    select decrypted_secret::jsonb into source from vault.decrypted_secrets v
      join sellerpilot_private.channel_credentials c on c.vault_secret_id = v.id
      where c.id = s.credential_id and c.created_by = s.owner_id and c.status = 'active';
    if request_secret->>'lazadaImExactSession' is distinct from s.id::text
       or request_secret->>'oauthPurpose' is distinct from 'im_cross_border'
       or request_secret->>'codeDelivery' is distinct from 'single'
       or request_secret->>'country' is distinct from 'cb'
       or request_secret->>'codeAppKey' is distinct from '137571'
       or coalesce(request_secret->>'code','') = ''
       or encode(extensions.digest(jsonb_build_object('appKey','137571','code',request_secret->>'code','country','cb')::text,'sha256'),'hex') is distinct from s.code_fingerprint
       or encode(extensions.digest(source::text,'sha256'),'hex') is distinct from s.source_secret_hash then
      raise exception 'LAZADA_IM_EXACT_VAULT_BINDING_INVALID';
    end if;
    update sellerpilot_private.lazada_im_exact_oauth_sessions set
      code_delivered_at = now_at,phase = 'oauth_running' where id = s.id;
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
    values (s.id,job.id,'code_delivered',s.code_fingerprint,jsonb_build_object(
      'codeDelivery','single','appKey','137571','country','cb'));
    return jsonb_build_object('status','claimed','job',jsonb_build_object(
      'id',job.id,'claim_token',job.claim_token,'credential_id',job.credential_id,
      'channel','lazada','operation','oauth.exchange','environment','production','attempt_count',1,
      'request',jsonb_build_object('code',request_secret->>'code','country','cb',
        'lazadaImExactSession',s.id,'oauthPurpose','im_cross_border','codeDelivery','single'),
      'credential',source
    ));
  end if;
  if s.code_delivered_at is null then raise exception 'LAZADA_IM_EXACT_NOT_DELIVERED'; end if;
  if p_action = 'heartbeat' then
    update sellerpilot_private.channel_gateway_jobs set
      lease_expires_at = least(s.expires_at,now_at + interval '3 minutes'),updated_at = now_at
      where id = job.id;
    return jsonb_build_object('status','running');
  end if;
  if p_action = 'review' then
    result_payload := public.sellerpilot_service_complete_gateway_transaction(
      p_token_hash,job.id,job.claim_token,'reconciliation_required',null,
      'LAZADA_IM_EXACT_REVIEW_REQUIRED_NO_REPLAY',null,null,null,null
    );
    update sellerpilot_private.lazada_im_exact_oauth_sessions set phase = 'review' where id = s.id;
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
    values (s.id,job.id,'review',encode(extensions.digest(coalesce(result_payload,'{}'::jsonb)::text,'sha256'),'hex'),
      jsonb_build_object('providerStarted',s.provider_started_at is not null));
    return jsonb_build_object('status','review');
  end if;
  if p_action = 'begin' then
    if sellerpilot_private.lazada_im_exact_source(s.credential_id)->>'secretHash' is distinct from s.source_secret_hash
       and s.prepared_credential_id is null then raise exception 'LAZADA_IM_EXACT_SOURCE_CHANGED'; end if;
    if job.credential_refresh_in_flight is not true then
      if public.sellerpilot_service_begin_gateway_credential_refresh(p_token_hash,job.id,job.claim_token) is not true then
        raise exception 'LAZADA_IM_EXACT_BEGIN_FAILED';
      end if;
    end if;
    return jsonb_build_object('status','in_flight');
  end if;
  if p_action = 'provider' then
    if s.provider_started_at is not null or job.oauth_provider_call_started_at is not null then
      raise exception 'LAZADA_IM_EXACT_PROVIDER_RETRY_FORBIDDEN';
    end if;
    update sellerpilot_private.channel_gateway_jobs set
      oauth_provider_call_started_at = now_at,updated_at = now_at
    where id = job.id and credential_refresh_in_flight
      and credential_refresh_started_at is not null and oauth_request_vault_id = s.code_vault_id
      and credential_refresh_recovery_vault_id is null and prepared_credential_id is null
      and not oauth_exchange_completed;
    if not found then raise exception 'LAZADA_IM_EXACT_PROVIDER_FENCE_FAILED'; end if;
    update sellerpilot_private.lazada_im_exact_oauth_sessions set
      provider_started_at = now_at,phase = 'provider_started' where id = s.id;
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
    values (s.id,job.id,'provider_started',encode(extensions.digest(jsonb_build_object(
      'jobId',job.id,'claimToken',job.claim_token,'appKey','137571','codeFingerprint',s.code_fingerprint
    )::text,'sha256'),'hex'),jsonb_build_object('appKey','137571','retryAllowed',false));
    return jsonb_build_object('status','provider_started');
  end if;
  if p_action = 'stage' then
    if (select count(*) from jsonb_object_keys(p_payload)) <> 1
       or jsonb_typeof(p_payload->'refresh') is distinct from 'object'
       or (select count(*) from jsonb_object_keys(p_payload->'refresh')) <> 3 then
      raise exception 'LAZADA_IM_EXACT_STAGE_SHAPE_INVALID';
    end if;
    refresh := p_payload->'refresh'; candidate := refresh->'payload';
    if not (refresh ?& array['payload','expiresAt','recoveryOnly'])
       or jsonb_typeof(candidate) is distinct from 'object'
       or jsonb_typeof(refresh->'expiresAt') not in ('string','null')
       or jsonb_typeof(refresh->'recoveryOnly') is distinct from 'boolean'
       or s.provider_started_at is null then raise exception 'LAZADA_IM_EXACT_STAGE_INVALID'; end if;
    select decrypted_secret::jsonb into source from vault.decrypted_secrets v
      join sellerpilot_private.channel_credentials c on c.vault_secret_id = v.id where c.id = s.credential_id;
    if encode(extensions.digest(source::text,'sha256'),'hex') is distinct from s.source_secret_hash then
      raise exception 'LAZADA_IM_EXACT_SOURCE_CHANGED';
    end if;
    if (refresh->>'recoveryOnly')::boolean then
      if s.recovery_vault_id is not null then raise exception 'LAZADA_IM_EXACT_RECOVERY_ALREADY_STORED'; end if;
      if not sellerpilot_private.lazada_im_exact_recovery_valid(source,candidate) then
        raise exception 'LAZADA_IM_EXACT_RECOVERY_INVALID';
      end if;
      payload_hash := encode(extensions.digest(candidate::text,'sha256'),'hex');
      vault_id := vault.create_secret(candidate::text,
        'sellerpilot-lazada-im-cb-recovery-' || job.id::text,
        'Claim-bound raw Lazada IM access-token recovery; never activate without five-country proof');
      if not exists (select 1 from vault.decrypted_secrets
        where id = vault_id and encode(extensions.digest((decrypted_secret::jsonb)::text,'sha256'),'hex') = payload_hash) then
        raise exception 'LAZADA_IM_EXACT_RECOVERY_VAULT_FAILED';
      end if;
      update sellerpilot_private.lazada_im_exact_oauth_sessions set
        recovery_vault_id = vault_id,recovery_hash = payload_hash,recovery_staged_at = now_at,
        phase = 'recovery_preserved' where id = s.id;
      insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
      values (s.id,job.id,'recovery_preserved',payload_hash,jsonb_build_object(
        'appKey','137571','vaultStored',true,'recoveryOnly',true));
      return jsonb_build_object('status','recovery_preserved');
    end if;
    if s.recovery_vault_id is null or s.prepared_credential_id is not null then
      raise exception 'LAZADA_IM_EXACT_RECOVERY_REQUIRED';
    end if;
    if nullif(refresh->>'expiresAt','')::timestamptz is distinct from s.source_expires_at then
      raise exception 'LAZADA_IM_EXACT_COMMERCE_EXPIRY_CHANGED';
    end if;
    select decrypted_secret::jsonb into recovery from vault.decrypted_secrets where id = s.recovery_vault_id;
    if encode(extensions.digest(recovery::text,'sha256'),'hex') is distinct from s.recovery_hash
       or not sellerpilot_private.lazada_im_exact_candidate_valid(source,candidate,recovery) then
      raise exception 'LAZADA_IM_EXACT_CANDIDATE_INVALID';
    end if;
    prepared := public.sellerpilot_service_prepare_gateway_credential_refresh(
      p_token_hash,job.id,job.claim_token,candidate,
      nullif(refresh->>'expiresAt','')::timestamptz,false,true
    );
    if prepared->>'status' is distinct from 'prepared'
       or coalesce(prepared->>'credential_id','') !~ '^[0-9a-f-]{36}$' then
      raise exception 'LAZADA_IM_EXACT_PREPARE_FAILED';
    end if;
    select encode(extensions.digest((v.decrypted_secret::jsonb)::text,'sha256'),'hex')
      into payload_hash from sellerpilot_private.channel_credentials c
      join vault.decrypted_secrets v on v.id = c.vault_secret_id
      where c.id = (prepared->>'credential_id')::uuid and c.created_by = s.owner_id
        and c.channel = 'lazada' and c.environment = 'production' and c.status = 'active';
    if payload_hash is distinct from encode(extensions.digest(candidate::text,'sha256'),'hex') then
      raise exception 'LAZADA_IM_EXACT_PREPARED_PAYLOAD_MISMATCH';
    end if;
    update sellerpilot_private.lazada_im_exact_oauth_sessions set
      prepared_credential_id = (prepared->>'credential_id')::uuid,
      prepared_secret_hash = payload_hash,phase = 'candidate_prepared' where id = s.id;
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
    values (s.id,job.id,'candidate_prepared',payload_hash,jsonb_build_object(
      'credentialId',prepared->>'credential_id','recoveryHash',s.recovery_hash,'exactCountries',5));
    return jsonb_build_object('status','prepared','credentialId',prepared->>'credential_id');
  end if;
  if p_action = 'complete' then
    if (select count(*) from jsonb_object_keys(p_payload)) <> 1
       or jsonb_typeof(p_payload->'result') is distinct from 'object' then
      raise exception 'LAZADA_IM_EXACT_RESULT_INVALID';
    end if;
    result_payload := p_payload->'result'; readbacks := result_payload->'readbacks';
    if (select count(*) from jsonb_object_keys(result_payload)) <> 4
       or result_payload->'ok' is distinct from 'true'::jsonb
       or result_payload->>'channel' is distinct from 'lazada'
       or result_payload->>'operation' is distinct from 'oauth.exchange'
       or jsonb_typeof(readbacks) is distinct from 'array'
       or jsonb_array_length(readbacks) <> 5
       or s.provider_started_at is null or s.recovery_vault_id is null
       or s.prepared_credential_id is null or s.prepared_secret_hash is null
       or job.prepared_credential_id is distinct from s.prepared_credential_id
       or not job.oauth_exchange_completed then
      raise exception 'LAZADA_IM_EXACT_RESULT_INVALID';
    end if;
    if exists (
      select 1 from jsonb_array_elements(readbacks) row
      where jsonb_typeof(row) <> 'object'
        or (select count(*) from jsonb_object_keys(row)) <> 5
        or lower(coalesce(row->>'country','')) not in ('my','ph','sg','th','vn')
        or coalesce((row->>'httpStatus')::integer,0) <> 200
        or row->>'providerCode' is distinct from '0'
        or length(coalesce(row->>'remoteRequestId','')) not between 1 and 240
        or row->>'remoteRequestId' ~ '[[:cntrl:]]'
    ) or (select count(distinct lower(row->>'country')) from jsonb_array_elements(readbacks) row) <> 5
      or exists (
        select 1 from (values
          ('my','300872000183'),('ph','501846640243'),('sg','1754224042'),
          ('th','101407248667'),('vn','201095728264')
        ) expected(country,seller_id)
        where not exists (select 1 from jsonb_array_elements(readbacks) row
          where lower(row->>'country') = expected.country and row->>'sellerId' = expected.seller_id)
      ) then raise exception 'LAZADA_IM_EXACT_FIVE_READBACKS_REQUIRED'; end if;
    select decrypted_secret::jsonb into candidate from vault.decrypted_secrets v
      join sellerpilot_private.channel_credentials c on c.vault_secret_id = v.id
      where c.id = s.prepared_credential_id and c.created_by = s.owner_id
        and c.channel = 'lazada' and c.environment = 'production' and c.status = 'active'
        and c.seller_account_key = s.source_seller_account_key
        and c.seller_account_key_source = 'provider_certified_v1'
        and c.seller_account_verified_at is not null
        and (c.expires_at is null or c.expires_at > now_at);
    select decrypted_secret::jsonb into recovery from vault.decrypted_secrets where id = s.recovery_vault_id;
    if encode(extensions.digest(candidate::text,'sha256'),'hex') is distinct from s.prepared_secret_hash
       or encode(extensions.digest(recovery::text,'sha256'),'hex') is distinct from s.recovery_hash
       or candidate->>'im_access_token' is distinct from recovery->>'im_access_token'
       or candidate->>'im_refresh_token' is distinct from recovery->>'im_refresh_token'
       or not sellerpilot_private.lazada_im_exact_five_country_identity(candidate) then
      raise exception 'LAZADA_IM_EXACT_ACTIVE_TOKEN_MISMATCH';
    end if;
    result_payload := public.sellerpilot_service_complete_gateway_transaction(
      p_token_hash,job.id,job.claim_token,'succeeded',result_payload,null,null,null,null,null
    );
    if result_payload is null or result_payload->>'status' not in ('completed','completed_replay') then
      raise exception 'LAZADA_IM_EXACT_COMPLETION_FAILED';
    end if;
    if not exists (
      select 1 from sellerpilot_private.channel_gateway_jobs completed_job
      where completed_job.id = job.id and completed_job.status = 'succeeded'
        and completed_job.credential_id = s.prepared_credential_id
        and completed_job.prepared_credential_id = s.prepared_credential_id
        and completed_job.response_payload is not distinct from p_payload->'result'
        and completed_job.oauth_exchange_completed
    ) then raise exception 'LAZADA_IM_EXACT_COMPLETION_POSTIMAGE_INVALID'; end if;

    -- The shared refresh helper rotates the credential but intentionally does
    -- not copy fixed-egress approvals. Carry forward only the exact scope that
    -- authorized this session. Approval identity and time bounds are copied
    -- verbatim; any conflict or partial copy rolls back completion before the
    -- source routes are disabled.
    perform 1 from sellerpilot_private.local_channel_executor_routes route
    where route.owner_id = s.owner_id and route.channel = 'lazada'
      and route.credential_id = s.credential_id
      and route.seller_account_key = s.source_seller_account_key
      and route.worker_token_id = s.worker_token_id
      and route.release_sha = s.release_sha
      and route.egress_ip_sha256 = s.egress_ip_sha256
      and route.enabled and route.approved_at <= now_at and route.expires_at > now_at
      and exists (select 1 from sellerpilot_private.admin_users approver
        where approver.user_id = route.approved_by)
    for update;
    select count(*) into route_count
    from sellerpilot_private.local_channel_executor_routes route
    where route.owner_id = s.owner_id and route.channel = 'lazada'
      and route.credential_id = s.credential_id
      and route.seller_account_key = s.source_seller_account_key
      and route.worker_token_id = s.worker_token_id
      and route.release_sha = s.release_sha
      and route.egress_ip_sha256 = s.egress_ip_sha256
      and route.enabled and route.approved_at <= now_at and route.expires_at > now_at
      and exists (select 1 from sellerpilot_private.admin_users approver
        where approver.user_id = route.approved_by);
    if route_count < 1 then raise exception 'LAZADA_IM_EXACT_APPROVED_ROUTE_REQUIRED'; end if;
    if exists (select 1 from sellerpilot_private.local_channel_executor_routes route
      where route.owner_id = s.owner_id and route.channel = 'lazada'
        and route.credential_id = s.prepared_credential_id) then
      raise exception 'LAZADA_IM_EXACT_TARGET_ROUTE_CONFLICT';
    end if;
    insert into sellerpilot_private.local_channel_executor_routes(
      id,owner_id,channel,operation,credential_id,seller_account_key,
      worker_token_id,release_sha,egress_ip_sha256,approved_by,approved_at,
      expires_at,enabled,created_at
    ) select gen_random_uuid(),route.owner_id,route.channel,route.operation,
      s.prepared_credential_id,route.seller_account_key,route.worker_token_id,
      route.release_sha,route.egress_ip_sha256,route.approved_by,route.approved_at,
      route.expires_at,true,now_at
    from sellerpilot_private.local_channel_executor_routes route
    where route.owner_id = s.owner_id and route.channel = 'lazada'
      and route.credential_id = s.credential_id
      and route.seller_account_key = s.source_seller_account_key
      and route.worker_token_id = s.worker_token_id
      and route.release_sha = s.release_sha
      and route.egress_ip_sha256 = s.egress_ip_sha256
      and route.enabled and route.approved_at <= now_at and route.expires_at > now_at
      and exists (select 1 from sellerpilot_private.admin_users approver
        where approver.user_id = route.approved_by);
    get diagnostics inserted_route_count = row_count;
    if inserted_route_count <> route_count then raise exception 'LAZADA_IM_EXACT_ROUTE_COPY_INCOMPLETE'; end if;
    update sellerpilot_private.local_channel_executor_routes route set enabled = false
    where route.owner_id = s.owner_id and route.channel = 'lazada'
      and route.credential_id = s.credential_id
      and route.seller_account_key = s.source_seller_account_key
      and route.worker_token_id = s.worker_token_id
      and route.release_sha = s.release_sha
      and route.egress_ip_sha256 = s.egress_ip_sha256
      and route.enabled and route.approved_at <= now_at and route.expires_at > now_at
      and exists (select 1 from sellerpilot_private.admin_users approver
        where approver.user_id = route.approved_by);
    get diagnostics disabled_route_count = row_count;
    if disabled_route_count <> route_count then raise exception 'LAZADA_IM_EXACT_SOURCE_ROUTE_DISABLE_INCOMPLETE'; end if;
    update sellerpilot_private.cs_credential_capability_bindings set
      status = 'superseded',updated_at = now_at
    where credential_id = s.prepared_credential_id and channel = 'lazada'
      and operation = 'inquiries.list' and status = 'active';
    for row_value in select value from jsonb_array_elements(readbacks) loop
      binding := sellerpilot_private.lazada_im_secret_binding(candidate,row_value->>'country');
      if binding is null or binding->>'sellerId' is distinct from row_value->>'sellerId' then
        raise exception 'LAZADA_IM_EXACT_CAPABILITY_BINDING_INVALID';
      end if;
      insert into sellerpilot_private.lazada_im_exact_oauth_readbacks(
        session_id,job_id,credential_id,country,seller_id,http_status,provider_code,
        remote_request_id,app_fingerprint,token_fingerprint,target_fingerprint,evidence_hash
      ) values (
        s.id,job.id,s.prepared_credential_id,lower(row_value->>'country'),row_value->>'sellerId',
        200,'0',row_value->>'remoteRequestId',binding->>'appFingerprint',
        binding->>'tokenFingerprint',binding->>'targetFingerprint',
        encode(extensions.digest(row_value::text,'sha256'),'hex')
      );
      insert into sellerpilot_private.cs_credential_capability_bindings(
        credential_id,channel,operation,country,app_fingerprint,token_fingerprint,
        target_fingerprint,status,verified_job_id,verified_at,expires_at,updated_at
      ) values (
        s.prepared_credential_id,'lazada','inquiries.list',binding->>'country',
        binding->>'appFingerprint',binding->>'tokenFingerprint',binding->>'targetFingerprint',
        'active',job.id,now_at,least(
          (select expires_at from sellerpilot_private.channel_credentials where id = s.prepared_credential_id),
          nullif(candidate->>'im_access_token_expires_at','')::timestamptz
        ),now_at
      ) on conflict (credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint)
        do update set status='active',verified_job_id=excluded.verified_job_id,
          verified_at=excluded.verified_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
    end loop;
    select count(*) into country_count from sellerpilot_private.lazada_im_exact_oauth_readbacks
      where session_id = s.id and credential_id = s.prepared_credential_id;
    if country_count <> 5 then raise exception 'LAZADA_IM_EXACT_CAPABILITY_COUNT_INVALID'; end if;
    update sellerpilot_private.lazada_im_exact_oauth_sessions set
      completed_at = now_at,phase = 'completed' where id = s.id;
    insert into sellerpilot_private.lazada_im_exact_oauth_events(session_id,job_id,event_type,evidence_hash,safe_detail)
    values (s.id,job.id,'completed',encode(extensions.digest((p_payload->'result')::text,'sha256'),'hex'),
      jsonb_build_object('credentialId',s.prepared_credential_id,'countryCapabilityCount',5,
        'tokenFingerprint',binding->>'tokenFingerprint','carriedRouteCount',route_count));
    return jsonb_build_object('status','completed','credentialId',s.prepared_credential_id,'countries',5);
  end if;
  raise exception 'LAZADA_IM_EXACT_ACTION_INVALID';
end
$$;
revoke all on function public.sellerpilot_lazada_im_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_lazada_im_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb)
  to service_role;

comment on function public.sellerpilot_lazada_im_exact_oauth_worker(text,uuid,text,uuid,uuid,jsonb) is
  'One-shot Lazada IM cross-border OAuth. stage accepts exactly {refresh:{payload,expiresAt,recoveryOnly}}: recoveryOnly=true persists the raw provider access-token response in Vault and returns recovery_preserved; false requires unchanged commerce/app material plus the same recovered IM token and exact MY/PH/SG/TH/VN identities, then returns prepared. complete accepts exactly {result:{ok:true,channel:"lazada",operation:"oauth.exchange",readbacks:[{country:"my"|"ph"|"sg"|"th"|"vn",sellerId:string,httpStatus:200,providerCode:"0",remoteRequestId:string}]}} with exactly one row for each expected seller; success atomically records five country capabilities for the same active credential/token. A provider-started session cannot call provider again.';
comment on table sellerpilot_private.lazada_im_exact_oauth_events is
  'Append-only safe history for code issuance/consumption, provider boundary, raw-token Vault recovery, candidate preparation, completion, and review; authorization codes and raw tokens remain only in Vault.';

notify pgrst,'reload schema';
commit;
