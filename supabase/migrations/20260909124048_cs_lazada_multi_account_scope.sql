-- Integration-owned forward migration proposal. Do not apply from the Lazada
-- worktree. This removes only Lazada's global active-credential assumption and
-- adds exact credential contracts for connection metadata and periodic reads.
begin;

do $migration$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.channel_sync_state') is null
     or to_regclass('sellerpilot_private.cs_credential_capability_bindings') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null
     or to_regprocedure('sellerpilot_private.lazada_im_lock_current_ticket_action_v1(uuid,uuid)') is null then
    raise exception 'LAZADA_MULTI_ACCOUNT_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('public.sellerpilot_list_active_lazada_credentials()') is not null
     or to_regprocedure('public.sellerpilot_rotate_lazada_credential(uuid,text,jsonb,timestamptz,integer,integer,integer)') is not null
     or to_regprocedure('public.sellerpilot_service_enqueue_lazada_periodic_sync(uuid,text,jsonb,integer)') is not null
     or to_regprocedure('public.sellerpilot_service_enqueue_lazada_inquiry_fanout(text,jsonb,integer)') is not null
     or to_regclass('sellerpilot_private.lazada_im_bootstrap_admissions') is not null then
    raise exception 'LAZADA_MULTI_ACCOUNT_ALREADY_EXISTS';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'lazada'
       and credential.status = 'active'
     group by credential.environment, credential.seller_account_key
    having credential.seller_account_key is not null and count(*) > 1
  ) or exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'lazada'
       and credential.status = 'active'
       and credential.seller_account_key is null
     group by credential.created_by, credential.environment
    having count(*) > 1
  ) then
    raise exception 'LAZADA_MULTI_ACCOUNT_EXISTING_AMBIGUITY';
  end if;
end
$migration$;

-- Keep every non-Lazada channel on its existing one-active-per-environment
-- contract. A provider-certified Lazada seller may have one active credential
-- globally, while each owner may have at most one unattested OAuth setup row.
drop index if exists sellerpilot_private.channel_credentials_one_active_idx;
create unique index channel_credentials_one_active_non_lazada_idx
  on sellerpilot_private.channel_credentials(channel, environment)
  where status = 'active' and channel <> 'lazada';
create unique index channel_credentials_one_active_lazada_account_idx
  on sellerpilot_private.channel_credentials(environment, seller_account_key)
  where status = 'active' and channel = 'lazada'
    and seller_account_key is not null;
create unique index channel_credentials_one_active_lazada_pending_owner_idx
  on sellerpilot_private.channel_credentials(created_by, environment)
  where status = 'active' and channel = 'lazada'
    and seller_account_key is null;

create function public.sellerpilot_list_active_lazada_credentials()
returns table(
  id uuid,
  owner_id uuid,
  environment text,
  status text,
  expires_at timestamptz,
  last_rotated_at timestamptz,
  created_at timestamptz,
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return query
  select credential.id,
         credential.created_by,
         credential.environment,
         credential.status,
         credential.expires_at,
         credential.last_rotated_at,
         credential.created_at,
         credential.seller_account_key,
         credential.seller_account_key_source,
         credential.seller_account_verified_at
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'lazada'
     and credential.status = 'active'
   order by credential.environment,
            credential.created_by,
            credential.seller_account_key nulls last,
            credential.version desc,
            credential.id;
end
$$;

-- Lazada connection creation/rotation must name the exact predecessor. A new
-- account does not revoke another seller's credential, and rotating a shared
-- administrator-owned row preserves its owner while recording the actor.
create function public.sellerpilot_rotate_lazada_credential(
  p_previous_credential_id uuid,
  p_environment text,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_rotation_interval_days integer default 90,
  p_warning_days integer default 30,
  p_grace_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_vault_id uuid;
  v_version integer;
  v_owner_id uuid;
  v_previous sellerpilot_private.channel_credentials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_fingerprint text;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_environment not in ('sandbox', 'production')
     or p_rotation_interval_days not between 1 and 365
     or p_warning_days not between 1 and 180
     or p_grace_days not between 0 and 30
     or jsonb_typeof(p_secret_payload) <> 'object'
     or p_secret_payload = '{}'::jsonb
     or octet_length(p_secret_payload::text) > 32000 then
    raise exception 'invalid Lazada credential rotation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:lazada-credential:' || p_environment || ':' ||
    coalesce(p_previous_credential_id::text, auth.uid()::text)
  ));
  if p_previous_credential_id is null then
    v_owner_id := auth.uid();
  else
    select credential.* into v_previous
      from sellerpilot_private.channel_credentials credential
     where credential.id = p_previous_credential_id
       and credential.channel = 'lazada'
       and credential.environment = p_environment
       and credential.status = 'active'
     for update;
    if not found then
      raise exception 'active Lazada credential not found' using errcode = 'P0002';
    end if;
    v_owner_id := v_previous.created_by;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:lazada-credential-owner:' || p_environment || ':' || v_owner_id::text
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:lazada-credential-version:' || p_environment
  ));
  if p_previous_credential_id is null and exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'lazada'
       and credential.environment = p_environment
       and credential.created_by = v_owner_id
       and credential.status = 'active'
       and credential.seller_account_key is null
  ) then
    raise exception 'LAZADA_PENDING_CREDENTIAL_EXISTS' using errcode = '55000';
  end if;

  select coalesce(max(credential.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'lazada'
     and credential.environment = p_environment;
  v_fingerprint := upper(substr(encode(
    extensions.digest(p_secret_payload::text, 'sha256'), 'hex'
  ), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_lazada_%s_v%s_%s', p_environment, v_version, v_id),
    'SellerPilot Lazada credential. Never expose to browser or logs.'
  ) into v_vault_id;

  if p_previous_credential_id is not null then
    update sellerpilot_private.channel_credentials credential
       set status = case when p_grace_days = 0 then 'revoked' else 'grace' end,
           grace_ends_at = case when p_grace_days = 0 then v_now
             else v_now + make_interval(days => p_grace_days) end
     where credential.id = p_previous_credential_id
       and credential.status = 'active';
    if not found then
      raise exception 'active Lazada credential not found' using errcode = 'P0002';
    end if;
  end if;

  insert into sellerpilot_private.channel_credentials(
    id, channel, environment, version, vault_secret_id, fingerprint, status,
    expires_at, rotation_interval_days, warning_days, last_rotated_at, created_by
  ) values(
    v_id, 'lazada', p_environment, v_version, v_vault_id, v_fingerprint, 'active',
    p_expires_at, p_rotation_interval_days, p_warning_days, v_now, v_owner_id
  );
  insert into sellerpilot_private.credential_audit(
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values(
    v_id, 'lazada', p_environment,
    case when p_previous_credential_id is null then 'created' else 'rotated' end,
    auth.uid(),
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint,
      'expires_at', p_expires_at, 'grace_days', p_grace_days,
      'previous_credential_id', p_previous_credential_id,
      'owner_id', v_owner_id)
  );
  return v_id;
end
$$;

create table sellerpilot_private.lazada_im_bootstrap_admissions(
  credential_id uuid primary key references sellerpilot_private.channel_credentials(id),
  owner_id uuid not null,
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  country text not null check(country in('SG','MY','TH','VN','ID','PH')),
  attempted_at timestamptz not null default clock_timestamp(),
  job_id uuid,
  unique(owner_id,credential_id,seller_account_key,country)
);
alter table sellerpilot_private.lazada_im_bootstrap_admissions enable row level security;
revoke all on table sellerpilot_private.lazada_im_bootstrap_admissions
  from public,anon,authenticated,service_role;

-- Exact read enqueue. The service caller supplies a credential row selected
-- by the authenticated shared-admin list. This function revalidates owner,
-- provider-certified account identity, expiry and lineage atomically.
create function public.sellerpilot_service_enqueue_lazada_periodic_sync(
  p_credential_id uuid,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_request_key text;
  v_scoped_key text;
  v_payload jsonb;
  v_existing_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_data_type text;
  v_country text;
  v_country_count integer;
  v_bootstrap boolean;
  v_existing_admission_job uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_credential_id is null
     or p_operation not in ('orders.list', 'inquiries.list')
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(coalesce(p_request_payload->'arguments','{}'::jsonb)) <> 'object'
     or octet_length(p_request_payload::text) > 128000
     or p_min_interval_minutes not between 1 and 60 then
    raise exception 'invalid exact Lazada periodic sync' using errcode = '22023';
  end if;
  select credential.id,
         credential.environment,
         credential.created_by,
         credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'lazada'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    return jsonb_build_object(
      'channel', 'lazada', 'operation', p_operation,
      'status', 'reconnect_required'
    );
  end if;

  v_payload := p_request_payload;
  if p_operation = 'inquiries.list' then
    select count(distinct upper(binding.country)),min(upper(binding.country))
      into v_country_count,v_country
      from sellerpilot_private.cs_credential_capability_bindings binding
     where binding.credential_id=v_credential.id
       and binding.channel='lazada'
       and binding.operation='inquiries.list'
       and binding.status='active'
       and (binding.expires_at is null or binding.expires_at>clock_timestamp())
       and upper(binding.country) in('SG','MY','TH','VN','ID','PH');
    if v_country_count <> 1 then
      return jsonb_build_object(
        'channel','lazada','operation',p_operation,'status','reconciliation_required',
        'credentialId',v_credential.id,'reason','country_binding_ambiguous'
      );
    end if;
    if nullif(trim(v_payload->'arguments'->>'sellerpilotLazadaCountry'),'') is not null
       and upper(trim(v_payload->'arguments'->>'sellerpilotLazadaCountry')) <> v_country then
      return jsonb_build_object(
        'channel','lazada','operation',p_operation,'status','reconciliation_required',
        'credentialId',v_credential.id,'reason','country_binding_mismatch'
      );
    end if;
    v_payload := jsonb_set(
      v_payload,'{arguments}',coalesce(v_payload->'arguments','{}'::jsonb)
        || jsonb_build_object('sellerpilotLazadaCountry',v_country),true
    );
  end if;

  v_request_key := left(coalesce(
    nullif(trim(v_payload->>'periodicKey'), ''),
    pg_catalog.md5(v_payload::text)
  ), 120);
  v_scoped_key := 'lazada:v1:' || pg_catalog.md5(
    v_request_key || E'\x1f' || v_credential.created_by::text || E'\x1f' ||
    v_credential.id::text || E'\x1f' || v_credential.seller_account_key
  );
  v_payload := jsonb_set(
    v_payload, '{periodicKey}', to_jsonb(v_scoped_key), true
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:periodic-sync:lazada:' || p_operation || ':' ||
    v_credential.id::text || ':' || v_scoped_key
  ));

  v_bootstrap := p_operation='inquiries.list'
    and coalesce(p_request_payload->'arguments'->>'bootstrap','false')='true';
  if v_bootstrap then
    insert into sellerpilot_private.lazada_im_bootstrap_admissions(
      credential_id,owner_id,seller_account_key,country
    ) values(
      v_credential.id,v_credential.created_by,v_credential.seller_account_key,v_country
    ) on conflict(credential_id) do nothing;
    if not found then
      select admission.job_id into v_existing_admission_job
        from sellerpilot_private.lazada_im_bootstrap_admissions admission
       where admission.credential_id=v_credential.id;
      return jsonb_build_object(
        'channel','lazada','operation',p_operation,'status','already_pending',
        'credentialId',v_credential.id,'country',v_country,'jobId',v_existing_admission_job
      );
    end if;
  end if;

  select job.id into v_existing_id
    from sellerpilot_private.channel_gateway_jobs job
   where job.credential_id = v_credential.id
     and job.created_by = v_credential.created_by
     and job.seller_account_key = v_credential.seller_account_key
     and job.channel = 'lazada'
     and job.operation = p_operation
     and trim(job.request_payload->>'periodicKey') = v_scoped_key
     and (job.status in ('queued', 'running')
       or job.created_at > clock_timestamp()
          - make_interval(mins => p_min_interval_minutes))
   order by job.created_at desc, job.id
  limit 1;
  if v_existing_id is not null then
    if v_bootstrap then
      update sellerpilot_private.lazada_im_bootstrap_admissions
         set job_id=v_existing_id
       where credential_id=v_credential.id;
    end if;
    return jsonb_build_object(
      'channel', 'lazada', 'operation', p_operation,
      'status', 'already_pending', 'credentialId',v_credential.id,
      'country',v_country,'jobId', v_existing_id
    );
  end if;

  insert into sellerpilot_private.channel_gateway_jobs(
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by, seller_account_key
  ) values(
    v_job_id, v_credential.id, null, 'lazada', p_operation,
    v_credential.environment, v_payload, v_credential.created_by,
    v_credential.seller_account_key
  );
  if v_bootstrap then
    update sellerpilot_private.lazada_im_bootstrap_admissions
       set job_id=v_job_id
     where credential_id=v_credential.id;
  end if;
  v_data_type := case when p_operation = 'orders.list'
    then 'orders' else 'inquiries' end;
  insert into sellerpilot_private.channel_sync_state(
    owner_id, channel_key, data_type, status, imported_count,
    last_started_at, last_error, updated_at
  ) values(
    v_credential.created_by, 'lazada', v_data_type, 'queued', 0,
    clock_timestamp(), null, clock_timestamp()
  ) on conflict(owner_id, channel_key, data_type) do update set
    status = 'queued', last_started_at = clock_timestamp(),
    last_error = null, updated_at = clock_timestamp();
  return jsonb_build_object(
    'channel', 'lazada', 'operation', p_operation,
    'status', 'queued', 'credentialId',v_credential.id,
    'country',v_country,'jobId', v_job_id
  );
end
$$;

create function public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credential record;
  v_result jsonb;
  v_accounts jsonb:='[]'::jsonb;
  v_count integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_operation<>'inquiries.list' or jsonb_typeof(p_request_payload)<>'object'
     or p_min_interval_minutes not between 1 and 60 then
    raise exception 'invalid Lazada inquiry fanout' using errcode='22023';
  end if;
  select count(*) into v_count
    from sellerpilot_private.channel_credentials credential
   where credential.channel='lazada' and credential.environment='production'
     and credential.status='active'
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if v_count>100 then
    return jsonb_build_object('channel','lazada','operation',p_operation,
      'status','failed','accounts','[]'::jsonb,'reason','account_limit_exceeded');
  end if;
  for v_credential in
    select credential.id,credential.created_by,credential.seller_account_key
      from sellerpilot_private.channel_credentials credential
     where credential.channel='lazada' and credential.environment='production'
       and credential.status='active'
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source='provider_certified_v1'
       and credential.seller_account_verified_at is not null
     order by credential.created_by,credential.seller_account_key,credential.id
  loop
    begin
      v_result:=public.sellerpilot_service_enqueue_lazada_periodic_sync(
        v_credential.id,p_operation,p_request_payload,p_min_interval_minutes
      );
    exception when others then
      v_result:=jsonb_build_object('status','failed','reason','exact_enqueue_failed');
    end;
    v_accounts:=v_accounts||jsonb_build_array(jsonb_build_object(
      'credentialId',v_credential.id,'ownerId',v_credential.created_by,
      'sellerAccountKey',v_credential.seller_account_key,
      'status',coalesce(v_result->>'status','failed'),
      'country',v_result->>'country'
    ));
  end loop;
  if v_count=0 then
    return jsonb_build_object('channel','lazada','operation',p_operation,
      'status','not_connected','accounts',v_accounts);
  end if;
  return jsonb_build_object('channel','lazada','operation',p_operation,
    'status',case
      when exists(select 1 from jsonb_array_elements(v_accounts) account where account->>'status'='failed') then 'failed'
      when exists(select 1 from jsonb_array_elements(v_accounts) account where account->>'status'='queued') then 'queued'
      when exists(select 1 from jsonb_array_elements(v_accounts) account where account->>'status'='reconciliation_required') then 'reconciliation_required'
      when exists(select 1 from jsonb_array_elements(v_accounts) account where account->>'status'='reconnect_required') then 'reconnect_required'
      else 'already_pending' end,
    'accounts',v_accounts
  );
end
$$;

revoke all on function public.sellerpilot_list_active_lazada_credentials()
  from public, anon, service_role;
grant execute on function public.sellerpilot_list_active_lazada_credentials()
  to authenticated;
revoke all on function public.sellerpilot_rotate_lazada_credential(
  uuid,text,jsonb,timestamptz,integer,integer,integer
) from public, anon, service_role;
grant execute on function public.sellerpilot_rotate_lazada_credential(
  uuid,text,jsonb,timestamptz,integer,integer,integer
) to authenticated;
revoke all on function public.sellerpilot_service_enqueue_lazada_periodic_sync(
  uuid,text,jsonb,integer
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_lazada_periodic_sync(
  uuid,text,jsonb,integer
) to service_role;
revoke all on function public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
  text,jsonb,integer
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
  text,jsonb,integer
) to service_role;

comment on function public.sellerpilot_list_active_lazada_credentials() is
  'Shared-admin Lazada metadata list. Every row retains exact owner, credential and seller account lineage.';
comment on function public.sellerpilot_rotate_lazada_credential(
  uuid,text,jsonb,timestamptz,integer,integer,integer
) is 'Creates a new Lazada account or rotates one exact credential without revoking another active seller account.';
comment on function public.sellerpilot_service_enqueue_lazada_periodic_sync(
  uuid,text,jsonb,integer
) is 'Service-only exact Lazada periodic read enqueue bound to owner, credential and provider-certified seller identity.';
comment on function public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
  text,jsonb,integer
) is 'Bounded service-only Lazada inquiry fanout. Each active provider-certified credential is revalidated and enqueued independently.';

notify pgrst, 'reload schema';
commit;
