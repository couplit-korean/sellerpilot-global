-- CONT-08 forward proposal. Apply only after the current-central Coupang
-- vendor-scoped ticket migration proposal. This keeps Lazada and Elevenst
-- account indexes/functions intact and removes channel-global Coupang choice.
begin;

do $preimage$
begin
  if to_regclass(
       'sellerpilot_private.channel_credentials_one_active_other_cs_idx'
     ) is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_one_active_coupang_vendor_idx'
     ) is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_one_active_lazada_account_idx'
     ) is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_one_active_lazada_pending_owner_idx'
     ) is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_elevenst_active_account_idx'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_rotate_credential(text,text,jsonb,timestamptz,integer,integer,integer)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_get_active_credential_secret(text,text)'
     ) is null
     or to_regprocedure(
       'sellerpilot_private.credential_seller_account_lineage(text,text,uuid)'
     ) is null then
    raise exception 'COUPANG_EXACT_CREDENTIAL_CURRENT_CENTRAL_REQUIRED';
  end if;
end
$preimage$;

create function sellerpilot_private.coupang_vendor_id_v1(p_secret jsonb)
returns text
language plpgsql
immutable
strict
set search_path=''
as $$
declare v_vendor_id text := upper(trim(coalesce(p_secret->>'vendor_id','')));
begin
  if jsonb_typeof(p_secret) is distinct from 'object'
     or jsonb_typeof(p_secret->'vendor_id') is distinct from 'string'
     or length(v_vendor_id) not between 2 and 100
     or v_vendor_id !~ '^[A-Z0-9_-]+$' then
    raise exception 'COUPANG_VENDOR_ID_INVALID';
  end if;
  return v_vendor_id;
end
$$;

create function sellerpilot_private.coupang_vendor_account_key_v1(
  p_environment text,
  p_vendor_id text
)
returns text
language plpgsql
immutable
strict
set search_path=''
as $$
begin
  if p_environment not in ('sandbox','production')
     or p_vendor_id !~ '^[A-Z0-9_-]{2,100}$' then
    raise exception 'COUPANG_VENDOR_ID_INVALID';
  end if;
  return encode(extensions.digest(
    concat_ws(chr(31),'coupang-vendor-v1',p_environment,p_vendor_id),
    'sha256'
  ),'hex');
end
$$;

revoke all on function sellerpilot_private.coupang_vendor_id_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.coupang_vendor_account_key_v1(text,text)
  from public,anon,authenticated,service_role;

alter function sellerpilot_private.credential_seller_account_lineage(text,text,uuid)
  rename to credential_seller_account_lineage_before_coupang_exact;

create function sellerpilot_private.credential_seller_account_lineage(
  p_channel text,
  p_environment text,
  p_vault_secret_id uuid
)
returns table(
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_secret jsonb;
  v_vendor_id text;
  v_rotation_source uuid;
  v_inherited record;
begin
  if lower(trim(p_channel)) <> 'coupang' then
    return query select * from
      sellerpilot_private.credential_seller_account_lineage_before_coupang_exact(
        p_channel,p_environment,p_vault_secret_id
      );
    return;
  end if;
  begin
    v_rotation_source:=nullif(
      current_setting('sellerpilot.coupang_credential_rotation_source',true),''
    )::uuid;
  exception when invalid_text_representation then
    v_rotation_source:=null;
  end;
  if v_rotation_source is not null then
    select credential.seller_account_key,
           credential.seller_account_key_source,
           credential.seller_account_verified_at
      into v_inherited
      from sellerpilot_private.channel_credentials credential
     where credential.id=v_rotation_source
       and credential.channel='coupang'
       and credential.environment=lower(trim(p_environment))
       and credential.status in ('grace','revoked')
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
       and credential.seller_account_verified_at is not null;
    if found then
      return query select
        v_inherited.seller_account_key::text,
        v_inherited.seller_account_key_source::text,
        v_inherited.seller_account_verified_at::timestamptz;
      return;
    end if;
  end if;
  select decrypted.decrypted_secret::jsonb into v_secret
    from vault.decrypted_secrets decrypted
   where decrypted.id=p_vault_secret_id;
  v_vendor_id:=sellerpilot_private.coupang_vendor_id_v1(v_secret);
  return query select
    sellerpilot_private.coupang_vendor_account_key_v1(
      lower(trim(p_environment)),v_vendor_id
    ),
    'credential_incarnation_v1'::text,
    statement_timestamp();
exception when no_data_found or invalid_text_representation then
  return query select null::text,'legacy_unattested'::text,null::timestamptz;
end
$$;

revoke all on function
  sellerpilot_private.credential_seller_account_lineage_before_coupang_exact(
    text,text,uuid
  ) from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.credential_seller_account_lineage(
  text,text,uuid
) from public,anon,authenticated,service_role;

alter function public.sellerpilot_rotate_credential(
  text,text,jsonb,timestamptz,integer,integer,integer
) rename to sellerpilot_rotate_credential_before_coupang_exact;

create function public.sellerpilot_rotate_credential(
  p_channel text,
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
set search_path=''
as $$
begin
  if lower(trim(p_channel))='coupang' then
    raise exception 'COUPANG_EXACT_CREDENTIAL_FLOW_REQUIRED' using errcode='55000';
  end if;
  return public.sellerpilot_rotate_credential_before_coupang_exact(
    p_channel,p_environment,p_secret_payload,p_expires_at,
    p_rotation_interval_days,p_warning_days,p_grace_days
  );
end
$$;

revoke all on function public.sellerpilot_rotate_credential_before_coupang_exact(
  text,text,jsonb,timestamptz,integer,integer,integer
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_rotate_credential(
  text,text,jsonb,timestamptz,integer,integer,integer
) from public,anon;
grant execute on function public.sellerpilot_rotate_credential(
  text,text,jsonb,timestamptz,integer,integer,integer
) to authenticated;

create function public.sellerpilot_create_coupang_credential_v1(
  p_environment text,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_rotation_interval_days integer default 180,
  p_warning_days integer default 14
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid:=gen_random_uuid();
  v_vault_id uuid;
  v_version integer;
  v_fingerprint text;
  v_vendor_id text;
  v_expected_account_key text;
  v_actual_account_key text;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_environment is null or p_environment not in ('sandbox','production')
     or jsonb_typeof(p_secret_payload) is distinct from 'object'
     or jsonb_typeof(p_secret_payload->'access_key') is distinct from 'string'
     or length(trim(coalesce(p_secret_payload->>'access_key',''))) not between 1 and 8000
     or jsonb_typeof(p_secret_payload->'secret_key') is distinct from 'string'
     or length(trim(coalesce(p_secret_payload->>'secret_key',''))) not between 1 and 8000
     or octet_length(p_secret_payload::text)>32000
     or p_rotation_interval_days is null
     or p_rotation_interval_days not between 1 and 365
     or p_warning_days is null
     or p_warning_days not between 1 and 180 then
    raise exception 'COUPANG_EXACT_CREDENTIAL_INVALID';
  end if;
  v_vendor_id:=sellerpilot_private.coupang_vendor_id_v1(p_secret_payload);
  v_expected_account_key:=sellerpilot_private.coupang_vendor_account_key_v1(
    p_environment,v_vendor_id
  );
  perform pg_advisory_xact_lock(hashtext(
    'sellerpilot:coupang:'||p_environment
  ));
  if exists(select 1 from sellerpilot_private.channel_credentials credential
    where credential.channel='coupang'
      and credential.environment=p_environment
      and credential.status='active'
      and credential.seller_account_key=v_expected_account_key) then
    raise exception 'COUPANG_VENDOR_ALREADY_ACTIVE' using errcode='23505';
  end if;
  select coalesce(max(credential.version),0)+1 into v_version
    from sellerpilot_private.channel_credentials credential
   where credential.channel='coupang' and credential.environment=p_environment;
  v_fingerprint:=upper(substr(encode(extensions.digest(
    p_secret_payload::text,'sha256'
  ),'hex'),1,12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_coupang_%s_v%s_%s',p_environment,v_version,v_id),
    'SellerPilot provider credential. Never expose to browser or logs.'
  ) into v_vault_id;
  insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,status,
    expires_at,rotation_interval_days,warning_days,last_rotated_at,created_by
  ) values(
    v_id,'coupang',p_environment,v_version,v_vault_id,v_fingerprint,'active',
    p_expires_at,p_rotation_interval_days,p_warning_days,now(),auth.uid()
  ) returning seller_account_key into v_actual_account_key;
  if v_actual_account_key is distinct from v_expected_account_key then
    raise exception 'COUPANG_VENDOR_LINEAGE_MISMATCH';
  end if;
  insert into sellerpilot_private.credential_audit(
    credential_id,channel,environment,action,actor_user_id,safe_detail
  ) values(
    v_id,'coupang',p_environment,'created',auth.uid(),jsonb_build_object(
      'version',v_version,'fingerprint',v_fingerprint,
      'vendorFingerprint',substr(v_expected_account_key,1,12),
      'identityEvidence','credential_incarnation_v1'
    )
  );
  return v_id;
end
$$;

create function public.sellerpilot_rotate_coupang_credential_v1(
  p_credential_id uuid,
  p_secret_patch jsonb,
  p_expires_at timestamptz default null,
  p_rotation_interval_days integer default 180,
  p_warning_days integer default 14,
  p_grace_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old sellerpilot_private.channel_credentials%rowtype;
  v_old_secret jsonb;
  v_next_secret jsonb;
  v_id uuid:=gen_random_uuid();
  v_vault_id uuid;
  v_version integer;
  v_fingerprint text;
  v_expected_account_key text;
  v_actual_account_key text;
  v_now timestamptz:=statement_timestamp();
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if jsonb_typeof(p_secret_patch) is distinct from 'object'
     or p_secret_patch='{}'::jsonb
     or octet_length(p_secret_patch::text)>32000
     or p_rotation_interval_days is null
     or p_rotation_interval_days not between 1 and 365
     or p_warning_days is null
     or p_warning_days not between 1 and 180
     or p_grace_days is null
     or p_grace_days not between 0 and 30 then
    raise exception 'COUPANG_EXACT_ROTATION_INVALID';
  end if;
  select credential.* into v_old
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='coupang'
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
   for update;
  if not found then raise exception 'COUPANG_EXACT_ACTIVE_CREDENTIAL_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext(
    'sellerpilot:coupang:'||v_old.environment
  ));
  select decrypted.decrypted_secret::jsonb into strict v_old_secret
    from vault.decrypted_secrets decrypted where decrypted.id=v_old.vault_secret_id;
  v_next_secret:=v_old_secret||p_secret_patch;
  if jsonb_typeof(v_next_secret->'access_key') is distinct from 'string'
     or length(trim(coalesce(v_next_secret->>'access_key',''))) not between 1 and 8000
     or jsonb_typeof(v_next_secret->'secret_key') is distinct from 'string'
     or length(trim(coalesce(v_next_secret->>'secret_key',''))) not between 1 and 8000 then
    raise exception 'COUPANG_EXACT_ROTATION_INVALID';
  end if;
  if sellerpilot_private.coupang_vendor_id_v1(v_next_secret)
       is distinct from sellerpilot_private.coupang_vendor_id_v1(v_old_secret) then
    raise exception 'COUPANG_ROTATION_VENDOR_ID_IMMUTABLE';
  end if;
  v_expected_account_key:=v_old.seller_account_key;
  if v_expected_account_key !~ '^[a-f0-9]{64}$'
     or v_old.seller_account_key_source not in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     or v_old.seller_account_verified_at is null then
    raise exception 'COUPANG_ROTATION_VENDOR_LINEAGE_INVALID';
  end if;
  select coalesce(max(credential.version),0)+1 into v_version
    from sellerpilot_private.channel_credentials credential
   where credential.channel='coupang' and credential.environment=v_old.environment;
  v_fingerprint:=upper(substr(encode(extensions.digest(
    v_next_secret::text,'sha256'
  ),'hex'),1,12));
  select vault.create_secret(
    v_next_secret::text,
    format('sellerpilot_coupang_%s_v%s_%s',v_old.environment,v_version,v_id),
    'SellerPilot provider credential. Never expose to browser or logs.'
  ) into v_vault_id;
  perform set_config(
    'sellerpilot.coupang_credential_rotation_source',v_old.id::text,true
  );
  update sellerpilot_private.channel_credentials credential set
    status=case when p_grace_days=0 then 'revoked' else 'grace' end,
    grace_ends_at=case when p_grace_days=0 then v_now
      else v_now+make_interval(days=>p_grace_days) end
   where credential.id=v_old.id;
  insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,status,
    expires_at,rotation_interval_days,warning_days,last_rotated_at,created_by
  ) values(
    v_id,'coupang',v_old.environment,v_version,v_vault_id,v_fingerprint,'active',
    p_expires_at,p_rotation_interval_days,p_warning_days,v_now,v_old.created_by
  ) returning seller_account_key into v_actual_account_key;
  if v_actual_account_key is distinct from v_expected_account_key then
    raise exception 'COUPANG_ROTATION_VENDOR_LINEAGE_MISMATCH';
  end if;
  update sellerpilot_private.support_tickets ticket
     set source_credential_id=v_id,updated_at=v_now
   where ticket.source_credential_id=v_old.id
     and ticket.channel_key='coupang'
     and ticket.seller_account_key=v_expected_account_key;
  update sellerpilot_private.coupang_order_credential_lineage lineage
     set source_credential_id=v_id
   where lineage.source_credential_id=v_old.id
     and lineage.seller_account_key=v_expected_account_key;
  insert into sellerpilot_private.credential_audit(
    credential_id,channel,environment,action,actor_user_id,safe_detail
  ) values(
    v_id,'coupang',v_old.environment,'rotated',auth.uid(),jsonb_build_object(
      'version',v_version,'fingerprint',v_fingerprint,
      'previousCredentialId',v_old.id,'graceDays',p_grace_days,
      'vendorFingerprint',substr(v_expected_account_key,1,12),
      'identityEvidence',v_old.seller_account_key_source
    )
  );
  return v_id;
end
$$;

create function public.sellerpilot_service_get_coupang_credential_secret_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'credential_id',credential.id,
    'environment',credential.environment,
    'seller_account_key',credential.seller_account_key,
    'secret_payload',decrypted.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_credentials credential
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where credential.id=p_credential_id
     and credential.channel='coupang'
     and credential.status='active'
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>statement_timestamp());
  if v_result is null then raise exception 'COUPANG_EXACT_CREDENTIAL_UNAVAILABLE'; end if;
  return v_result;
end
$$;

alter function public.sellerpilot_get_active_credential_secret(text,text)
  rename to sellerpilot_get_active_credential_secret_before_coupang_exact;

create function public.sellerpilot_get_active_credential_secret(
  p_channel text,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_count integer;
  v_credential_id uuid;
begin
  if lower(trim(p_channel))<>'coupang' then
    return public.sellerpilot_get_active_credential_secret_before_coupang_exact(
      p_channel,p_environment
    );
  end if;
  select count(*) into v_count
    from sellerpilot_private.channel_credentials credential
   where credential.channel='coupang'
     and credential.environment=lower(trim(p_environment))
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>statement_timestamp());
  if v_count>1 then
    raise exception 'COUPANG_EXACT_CREDENTIAL_ID_REQUIRED' using errcode='55000';
  end if;
  if v_count=0 then return null; end if;
  select credential.id into strict v_credential_id
    from sellerpilot_private.channel_credentials credential
   where credential.channel='coupang'
     and credential.environment=lower(trim(p_environment))
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>statement_timestamp());
  return public.sellerpilot_service_get_coupang_credential_secret_v1(v_credential_id);
end
$$;

revoke all on function public.sellerpilot_create_coupang_credential_v1(
  text,jsonb,timestamptz,integer,integer
) from public,anon;
revoke all on function public.sellerpilot_rotate_coupang_credential_v1(
  uuid,jsonb,timestamptz,integer,integer,integer
) from public,anon;
revoke all on function public.sellerpilot_service_get_coupang_credential_secret_v1(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_get_active_credential_secret_before_coupang_exact(
  text,text
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_get_active_credential_secret(text,text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_create_coupang_credential_v1(
  text,jsonb,timestamptz,integer,integer
) to authenticated;
grant execute on function public.sellerpilot_rotate_coupang_credential_v1(
  uuid,jsonb,timestamptz,integer,integer,integer
) to authenticated;
grant execute on function public.sellerpilot_service_get_coupang_credential_secret_v1(uuid)
  to service_role;
grant execute on function public.sellerpilot_get_active_credential_secret(text,text)
  to service_role;

notify pgrst,'reload schema';
commit;
