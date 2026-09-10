-- channel: elevenst
-- assignment: CS-elevenst-CONT-08
-- Proposal only. Central owns merging the global active-index predicate with
-- the independently reviewed multi-account channels. This candidate refuses
-- a non-canonical preimage instead of silently removing another allowance.
--
-- 11st ProductSearch proves that an API key is usable from the registered IP,
-- but it does not return the seller ID. Therefore a stored seller_id remains
-- an administrator claim, never provider-certified identity evidence. A new
-- credential stays pending until a recent exact-credential access test passes.

begin;

alter table sellerpilot_private.channel_credentials
  drop constraint channel_credentials_status_check;
alter table sellerpilot_private.channel_credentials
  add constraint channel_credentials_status_check
  check (status in ('pending','active','grace','revoked','invalid'));

create table sellerpilot_private.elevenst_credential_identity_claims (
  credential_id uuid primary key
    references sellerpilot_private.channel_credentials(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  seller_id_digest text not null check (seller_id_digest ~ '^[a-f0-9]{64}$'),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  lifecycle_state text not null
    check (lifecycle_state in ('pending','active','grace','revoked','invalid')),
  identity_evidence text not null default 'admin_claim_v1'
    check (identity_evidence = 'admin_claim_v1'),
  access_checked_at timestamptz,
  activated_at timestamptz,
  replaced_credential_id uuid
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((lifecycle_state = 'pending' and activated_at is null)
    or lifecycle_state <> 'pending'),
  check (replaced_credential_id is null or lifecycle_state <> 'pending')
);

-- Initial connections with the same normalized administrator-claimed seller
-- ID cannot both be pending/active. Exact rotation first retires the old claim
-- and then inserts the replacement claim in the same transaction.
create unique index elevenst_credential_identity_live_claim_idx
  on sellerpilot_private.elevenst_credential_identity_claims (
    environment, seller_id_digest
  ) where lifecycle_state in ('pending','active');

revoke all on sellerpilot_private.elevenst_credential_identity_claims
  from public, anon, authenticated, service_role;

create function sellerpilot_private.elevenst_seller_id_digest(
  p_vault_secret_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret jsonb;
  v_seller_id text;
begin
  begin
    select decrypted.decrypted_secret::jsonb into v_secret
      from vault.decrypted_secrets decrypted
     where decrypted.id = p_vault_secret_id;
  exception when others then
    return null;
  end;
  v_seller_id := lower(trim(coalesce(v_secret->>'seller_id','')));
  if length(v_seller_id) not between 2 and 100
     or v_seller_id ~ '[[:cntrl:]]' then
    return null;
  end if;
  return encode(extensions.digest(
    convert_to('elevenst' || E'\x1f' || v_seller_id, 'UTF8'),
    'sha256'
  ), 'hex');
end;
$$;

revoke all on function sellerpilot_private.elevenst_seller_id_digest(uuid)
  from public, anon, authenticated, service_role;

-- Keep the private claim ledger aligned when an existing generic revocation or
-- grace-expiry path changes a 11st credential status. Those paths still act on
-- an exact credential UUID; they do not choose an arbitrary active account.
create function sellerpilot_private.sync_elevenst_credential_claim_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'elevenst'
     and new.status is distinct from old.status then
    update sellerpilot_private.elevenst_credential_identity_claims claim
       set lifecycle_state = new.status
     where claim.credential_id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_elevenst_credential_claim_lifecycle
after update of status on sellerpilot_private.channel_credentials
for each row execute function
  sellerpilot_private.sync_elevenst_credential_claim_lifecycle();

revoke all on function sellerpilot_private.sync_elevenst_credential_claim_lifecycle()
  from public, anon, authenticated, service_role;

-- Preserve the exact current credential owner/account lineage during an
-- explicitly targeted 11st rotation. All other branches are the installed
-- 20260830054851 provider-certification behavior.
create or replace function sellerpilot_private.credential_seller_account_lineage(
  p_channel text,
  p_environment text,
  p_vault_secret_id uuid
)
returns table (
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret_text text;
  v_secret jsonb;
  v_subject text;
  v_identity_version text;
  v_rotation_source uuid;
  v_inherited record;
  v_legacy_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
  v_service_attested boolean;
begin
  if lower(trim(p_channel)) = 'elevenst' then
    begin
      v_rotation_source := nullif(
        current_setting('sellerpilot.elevenst_credential_rotation_source', true),
        ''
      )::uuid;
    exception when invalid_text_representation then
      v_rotation_source := null;
    end;
    if v_rotation_source is not null then
      select credential.seller_account_key,
             credential.seller_account_key_source,
             credential.seller_account_verified_at
        into v_inherited
        from sellerpilot_private.channel_credentials credential
        join sellerpilot_private.elevenst_credential_identity_claims claim
          on claim.credential_id = credential.id
         and claim.seller_account_key = credential.seller_account_key
       where credential.id = v_rotation_source
         and credential.channel = 'elevenst'
         and credential.environment = lower(trim(p_environment))
         and credential.status in ('grace','revoked')
         and credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'credential_incarnation_v1'
         and credential.seller_account_verified_at is not null
         and claim.lifecycle_state in ('grace','revoked');
      if found then
        return query select
          v_inherited.seller_account_key::text,
          v_inherited.seller_account_key_source::text,
          v_inherited.seller_account_verified_at::timestamptz;
        return;
      end if;
    end if;
  end if;

  v_service_attested := v_legacy_role = 'service_role'
    or sellerpilot_private.credential_lineage_attestation_marker_matches(
      p_channel,
      p_environment,
      p_vault_secret_id
    );

  select decrypted.decrypted_secret
    into v_secret_text
    from vault.decrypted_secrets decrypted
   where decrypted.id = p_vault_secret_id;

  if v_secret_text is null then
    return query select null::text, 'legacy_unattested'::text, null::timestamptz;
    return;
  end if;

  begin
    v_secret := v_secret_text::jsonb;
  exception when invalid_text_representation then
    return query select null::text, 'legacy_unattested'::text, null::timestamptz;
    return;
  end;

  if p_channel in ('shopee', 'lazada', 'ebay') then
    v_subject := nullif(trim(v_secret->>'provider_account_subject'), '');
    v_identity_version := nullif(trim(v_secret->>'provider_account_identity_version'), '');
    if not v_service_attested
       or v_identity_version <> 'v1'
       or v_subject is null
       or length(v_subject) > 2048
       or (p_channel = 'shopee' and v_subject !~ '^shopee:(main|shop):[0-9]+$')
       or (p_channel = 'lazada' and (
         length(v_subject) not between 51 and 522
         or v_subject !~ '^lazada:v1:[A-Za-z0-9_-]+$'
       ))
       or (p_channel = 'ebay' and (
         length(v_subject) not between 11 and 522
         or v_subject !~ '^ebay:eias:[^[:cntrl:]]+$'
       )) then
      return query select null::text, 'legacy_unattested'::text, null::timestamptz;
      return;
    end if;

    return query
      select encode(
        extensions.digest(
          lower(trim(p_channel)) || E'\x1f'
            || lower(trim(p_environment)) || E'\x1f' || v_subject,
          'sha256'
        ),
        'hex'
      ), 'provider_certified_v1'::text, now();
    return;
  end if;

  return query
    select sellerpilot_private.new_seller_account_key(),
           'credential_incarnation_v1'::text,
           now();
end;
$$;

-- Backfill the one canonical active 11st credential. Its seller ID remains an
-- administrator claim; the historical access-test timestamp is retained only
-- as access evidence and never relabeled provider identity proof.
insert into sellerpilot_private.elevenst_credential_identity_claims (
  credential_id, environment, seller_id_digest, seller_account_key,
  lifecycle_state, access_checked_at, activated_at, created_by
)
select credential.id,
       credential.environment,
       sellerpilot_private.elevenst_seller_id_digest(credential.vault_secret_id),
       credential.seller_account_key,
       case credential.status
         when 'active' then 'active'
         when 'grace' then 'grace'
         when 'revoked' then 'revoked'
         else 'invalid'
       end,
       case when credential.last_check_status = 'passed'
         then credential.last_checked_at else null end,
       case when credential.status = 'active' then credential.created_at else null end,
       credential.created_by
  from sellerpilot_private.channel_credentials credential
 where credential.channel = 'elevenst'
   and credential.seller_account_key ~ '^[a-f0-9]{64}$'
   and sellerpilot_private.elevenst_seller_id_digest(
     credential.vault_secret_id
   ) is not null
on conflict (credential_id) do nothing;

do $$
declare v_definition text;
begin
 select indexdef into v_definition from pg_indexes
 where schemaname='sellerpilot_private' and indexname='channel_credentials_one_active_non_lazada_idx';
 if v_definition is null or v_definition !~ 'channel <> ''lazada''::text' then
  raise exception 'ELEVENST_ACTIVE_INDEX_CENTRAL_MERGE_REQUIRED';
 end if;
 if to_regclass('sellerpilot_private.channel_credentials_one_active_lazada_account_idx') is null
 or to_regclass('sellerpilot_private.channel_credentials_one_active_lazada_pending_owner_idx') is null then
  raise exception 'ELEVENST_LAZADA_ACCOUNT_FENCES_REQUIRED';
 end if;
 drop index sellerpilot_private.channel_credentials_one_active_non_lazada_idx;
end;
$$;
create unique index channel_credentials_one_active_non_lazada_elevenst_idx
 on sellerpilot_private.channel_credentials(channel, environment)
 where status='active' and channel not in ('lazada','elevenst');
create unique index if not exists channel_credentials_elevenst_active_account_idx
  on sellerpilot_private.channel_credentials (
    channel, environment, seller_account_key
  ) where status = 'active' and channel = 'elevenst';

alter function public.sellerpilot_rotate_credential(
  text, text, jsonb, timestamptz, integer, integer, integer
) rename to sellerpilot_rotate_credential_before_elevenst_multi_account;

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
set search_path = ''
as $$
begin
  if lower(trim(p_channel)) = 'elevenst' then
    raise exception 'ELEVENST_EXACT_CREDENTIAL_FLOW_REQUIRED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_rotate_credential_before_elevenst_multi_account(
    p_channel, p_environment, p_secret_payload, p_expires_at,
    p_rotation_interval_days, p_warning_days, p_grace_days
  );
end;
$$;

revoke all on function public.sellerpilot_rotate_credential_before_elevenst_multi_account(
  text, text, jsonb, timestamptz, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_rotate_credential(
  text, text, jsonb, timestamptz, integer, integer, integer
) from public, anon;
grant execute on function public.sellerpilot_rotate_credential(
  text, text, jsonb, timestamptz, integer, integer, integer
) to authenticated;

alter function public.sellerpilot_get_active_credential_secret(text, text)
  rename to sellerpilot_get_active_credential_secret_before_elevenst_multi_account;

create function public.sellerpilot_get_active_credential_secret(
  p_channel text,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if lower(trim(p_channel)) = 'elevenst' then
    raise exception 'ELEVENST_EXACT_CREDENTIAL_ID_REQUIRED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_get_active_credential_secret_before_elevenst_multi_account(
    p_channel, p_environment
  );
end;
$$;

revoke all on function public.sellerpilot_get_active_credential_secret_before_elevenst_multi_account(
  text, text
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_get_active_credential_secret(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_get_active_credential_secret(text, text)
  to service_role;

create function public.sellerpilot_create_elevenst_credential_pending_v1(
  p_environment text,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_rotation_interval_days integer default 90,
  p_warning_days integer default 30
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
  v_fingerprint text;
  v_seller_digest text;
  v_account_key text;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_environment not in ('sandbox','production')
     or jsonb_typeof(p_secret_payload) is distinct from 'object'
     or coalesce(p_secret_payload->>'api_key','') !~ '^[A-Za-z0-9]{32}$'
     or length(trim(coalesce(p_secret_payload->>'seller_id',''))) not between 2 and 100
     or trim(coalesce(p_secret_payload->>'seller_id','')) ~ '[[:cntrl:]]'
     or p_rotation_interval_days not between 1 and 365
     or p_warning_days not between 1 and 180
     or octet_length(p_secret_payload::text) > 32000 then
    raise exception 'ELEVENST_PENDING_CREDENTIAL_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtext(
    'sellerpilot:elevenst:' || p_environment
  ));
  select coalesce(max(credential.version),0)+1 into v_version
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'elevenst'
     and credential.environment = p_environment;
  v_fingerprint := upper(substr(encode(extensions.digest(
    p_secret_payload::text, 'sha256'
  ), 'hex'),1,12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_elevenst_%s_v%s_%s',p_environment,v_version,v_id),
    'SellerPilot provider credential. Never expose to browser or logs.'
  ) into v_vault_id;
  insert into sellerpilot_private.channel_credentials (
    id,channel,environment,version,vault_secret_id,fingerprint,status,
    expires_at,rotation_interval_days,warning_days,last_rotated_at,created_by
  ) values (
    v_id,'elevenst',p_environment,v_version,v_vault_id,v_fingerprint,'pending',
    p_expires_at,p_rotation_interval_days,p_warning_days,now(),auth.uid()
  ) returning seller_account_key into v_account_key;
  v_seller_digest := sellerpilot_private.elevenst_seller_id_digest(v_vault_id);
  if v_seller_digest is null then
    raise exception 'ELEVENST_PENDING_IDENTITY_INVALID';
  end if;
  insert into sellerpilot_private.elevenst_credential_identity_claims (
    credential_id,environment,seller_id_digest,seller_account_key,
    lifecycle_state,created_by
  ) values (
    v_id,p_environment,v_seller_digest,v_account_key,'pending',auth.uid()
  );
  insert into sellerpilot_private.credential_audit (
    credential_id,channel,environment,action,actor_user_id,safe_detail
  ) values (
    v_id,'elevenst',p_environment,'created',auth.uid(),jsonb_build_object(
      'version',v_version,'fingerprint',v_fingerprint,
      'identityStatus','pending','identityEvidence','admin_claim_v1'
    )
  );
  return v_id;
end;
$$;

create function public.sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'credential_id',credential.id,
    'environment',credential.environment,
    'secret_payload',decrypted.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_credentials credential
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = 'pending'
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'pending'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp());
  if v_result is null then
    raise exception 'ELEVENST_PENDING_CREDENTIAL_UNAVAILABLE';
  end if;
  return v_result;
end;
$$;

create function public.sellerpilot_activate_elevenst_credential_v1(
  p_credential_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_claim sellerpilot_private.elevenst_credential_identity_claims%rowtype;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'pending'
   for update;
  if not found
     or v_credential.last_check_status is distinct from 'passed'
     or v_credential.last_checked_at is null
     or v_credential.last_checked_at < statement_timestamp() - interval '30 minutes'
     or (v_credential.expires_at is not null
       and v_credential.expires_at <= statement_timestamp()) then
    raise exception 'ELEVENST_RECENT_EXACT_ACCESS_TEST_REQUIRED';
  end if;
  select claim.* into strict v_claim
    from sellerpilot_private.elevenst_credential_identity_claims claim
   where claim.credential_id = v_credential.id
     and claim.lifecycle_state = 'pending'
   for update;
  update sellerpilot_private.elevenst_credential_identity_claims claim
     set lifecycle_state = 'active',
         access_checked_at = v_credential.last_checked_at,
         activated_at = statement_timestamp()
   where claim.credential_id = v_credential.id;
  update sellerpilot_private.channel_credentials credential
     set status = 'active'
   where credential.id = v_credential.id;
  insert into sellerpilot_private.credential_audit (
    credential_id,channel,environment,action,actor_user_id,safe_detail
  ) values (
    v_credential.id,'elevenst',v_credential.environment,'restored',auth.uid(),
    jsonb_build_object(
      'identityStatus','active','identityEvidence','admin_claim_v1',
      'accessCheckedAt',v_credential.last_checked_at
    )
  );
  return v_credential.id;
end;
$$;

create function public.sellerpilot_rotate_elevenst_credential_v1(
  p_credential_id uuid,
  p_secret_patch jsonb,
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
  v_old sellerpilot_private.channel_credentials%rowtype;
  v_claim sellerpilot_private.elevenst_credential_identity_claims%rowtype;
  v_old_secret jsonb;
  v_next_secret jsonb;
  v_id uuid := gen_random_uuid();
  v_vault_id uuid;
  v_version integer;
  v_fingerprint text;
  v_now timestamptz := statement_timestamp();
  v_account_key text;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_secret_patch) is distinct from 'object'
     or p_secret_patch = '{}'::jsonb
     or octet_length(p_secret_patch::text) > 32000
     or p_rotation_interval_days not between 1 and 365
     or p_warning_days not between 1 and 180
     or p_grace_days not between 0 and 30 then
    raise exception 'ELEVENST_EXACT_ROTATION_INVALID';
  end if;
  select credential.* into v_old
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
   for update;
  if not found then
    raise exception 'ELEVENST_EXACT_ACTIVE_CREDENTIAL_REQUIRED';
  end if;
  select claim.* into strict v_claim
    from sellerpilot_private.elevenst_credential_identity_claims claim
   where claim.credential_id = v_old.id
     and claim.lifecycle_state = 'active'
     and claim.seller_account_key = v_old.seller_account_key
   for update;
  perform pg_advisory_xact_lock(hashtext(
    'sellerpilot:elevenst:' || v_old.environment
  ));
  select decrypted.decrypted_secret::jsonb into strict v_old_secret
    from vault.decrypted_secrets decrypted
   where decrypted.id = v_old.vault_secret_id;
  v_next_secret := v_old_secret || p_secret_patch;
  if coalesce(v_next_secret->>'api_key','') !~ '^[A-Za-z0-9]{32}$'
     or lower(trim(coalesce(v_next_secret->>'seller_id',''))) is distinct from
        lower(trim(coalesce(v_old_secret->>'seller_id',''))) then
    raise exception 'ELEVENST_ROTATION_SELLER_ID_IMMUTABLE';
  end if;
  select coalesce(max(credential.version),0)+1 into v_version
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'elevenst'
     and credential.environment = v_old.environment;
  v_fingerprint := upper(substr(encode(extensions.digest(
    v_next_secret::text,'sha256'
  ),'hex'),1,12));
  select vault.create_secret(
    v_next_secret::text,
    format('sellerpilot_elevenst_%s_v%s_%s',v_old.environment,v_version,v_id),
    'SellerPilot provider credential. Never expose to browser or logs.'
  ) into v_vault_id;
  update sellerpilot_private.channel_credentials credential
     set status = case when p_grace_days = 0 then 'revoked' else 'grace' end,
         grace_ends_at = case when p_grace_days = 0 then v_now
           else v_now + make_interval(days => p_grace_days) end
   where credential.id = v_old.id;
  update sellerpilot_private.elevenst_credential_identity_claims claim
     set lifecycle_state = case when p_grace_days = 0 then 'revoked' else 'grace' end
   where claim.credential_id = v_old.id;
  perform set_config(
    'sellerpilot.elevenst_credential_rotation_source',v_old.id::text,true
  );
  insert into sellerpilot_private.channel_credentials (
    id,channel,environment,version,vault_secret_id,fingerprint,status,
    expires_at,rotation_interval_days,warning_days,last_rotated_at,created_by
  ) values (
    v_id,'elevenst',v_old.environment,v_version,v_vault_id,v_fingerprint,'active',
    p_expires_at,p_rotation_interval_days,p_warning_days,v_now,v_old.created_by
  ) returning seller_account_key into v_account_key;
  if v_account_key is distinct from v_old.seller_account_key then
    raise exception 'ELEVENST_ROTATION_LINEAGE_MISMATCH';
  end if;
  insert into sellerpilot_private.elevenst_credential_identity_claims (
    credential_id,environment,seller_id_digest,seller_account_key,
    lifecycle_state,access_checked_at,activated_at,replaced_credential_id,
    created_by
  ) values (
    v_id,v_old.environment,v_claim.seller_id_digest,v_account_key,'active',
    v_claim.access_checked_at,v_now,v_old.id,v_old.created_by
  );
  perform set_config('sellerpilot.elevenst_credential_rotation_source','',true);
  insert into sellerpilot_private.credential_audit (
    credential_id,channel,environment,action,actor_user_id,safe_detail
  ) values (
    v_id,'elevenst',v_old.environment,'rotated',auth.uid(),jsonb_build_object(
      'version',v_version,'fingerprint',v_fingerprint,
      'previousCredentialId',v_old.id,'graceDays',p_grace_days,
      'identityEvidence','admin_claim_v1'
    )
  );
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_create_elevenst_credential_pending_v1(
  text,jsonb,timestamptz,integer,integer
) from public, anon;
revoke all on function public.sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_activate_elevenst_credential_v1(uuid)
  from public, anon;
revoke all on function public.sellerpilot_rotate_elevenst_credential_v1(
  uuid,jsonb,timestamptz,integer,integer,integer
) from public, anon;
grant execute on function public.sellerpilot_create_elevenst_credential_pending_v1(
  text,jsonb,timestamptz,integer,integer
) to authenticated;
grant execute on function public.sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1(uuid)
  to service_role;
grant execute on function public.sellerpilot_activate_elevenst_credential_v1(uuid)
  to authenticated;
grant execute on function public.sellerpilot_rotate_elevenst_credential_v1(
  uuid,jsonb,timestamptz,integer,integer,integer
) to authenticated;

commit;
