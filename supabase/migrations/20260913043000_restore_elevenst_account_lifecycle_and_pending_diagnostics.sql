-- Reviewed forward recovery. Existing 11st credentials are backfilled as admin claims only.
-- No pending credentials, jobs, approvals or provider actions are created.
-- SmartStore and Lazada multi-account indexes and all other channel lineage are preserved.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_activate_elevenst_credential_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_activate_elevenst_credential_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_claim_elevenst_pending_diagnostic_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_claim_elevenst_pending_diagnostic_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_complete_elevenst_pending_diagnostic_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_complete_elevenst_pending_diagnostic_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_create_elevenst_credential_pending_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_create_elevenst_credential_pending_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_enqueue_elevenst_pending_diagnostic_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_enqueue_elevenst_pending_diagnostic_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_get_active_credential_secret' and pg_get_function_identity_arguments(p.oid)='p_channel text, p_environment text') is distinct from '016ec7740777f5e6ed5c3950d7efbb9b' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_get_active_credential_secret';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_rotate_credential' and pg_get_function_identity_arguments(p.oid)='p_channel text, p_environment text, p_secret_payload jsonb, p_expires_at timestamp with time zone, p_rotation_interval_days integer, p_warning_days integer, p_grace_days integer') is distinct from 'ff1e5d721f1517df4cf236cce99ddf9a' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_rotate_credential';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_rotate_elevenst_credential_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_rotate_elevenst_credential_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_get_elevenst_pending_diagnostic_secret_v1';end if;
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='credential_seller_account_lineage' and pg_get_function_identity_arguments(p.oid)='p_channel text, p_environment text, p_vault_secret_id uuid') is distinct from '97afa03ab47f679c707de19f60a91971' then raise exception 'RECOVERY_PREIMAGE_DRIFT:credential_seller_account_lineage';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='elevenst_seller_id_digest') then raise exception 'RECOVERY_ALREADY_DEFINED:elevenst_seller_id_digest';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='sync_elevenst_credential_claim_lifecycle') then raise exception 'RECOVERY_ALREADY_DEFINED:sync_elevenst_credential_claim_lifecycle';end if;
end $recovery_guard$;
-- Reviewed source: 20260909133643_cs_elevenst_account_lifecycle.sql
-- Source SHA256: abb99afe7b746c9e72df82bd79886b45fc9dedffb1c5dffb3560b355ea4bd148
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

do $status_guard$ begin
if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='sellerpilot_private.channel_credentials'::regclass and conname='channel_credentials_status_check') is distinct from $status_preimage$CHECK ((status = ANY (ARRAY['active'::text, 'grace'::text, 'revoked'::text, 'invalid'::text])))$status_preimage$ then raise exception 'ELEVENST_CREDENTIAL_STATUS_PREIMAGE_DRIFT';end if;end $status_guard$;

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

alter table sellerpilot_private.elevenst_credential_identity_claims enable row level security;

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
-- Preserve all current non-11st account certification, including Temu mall identity.
alter function sellerpilot_private.credential_seller_account_lineage(text,text,uuid)
  rename to credential_lineage_before_202609134300;
revoke all on function sellerpilot_private.credential_lineage_before_202609134300(text,text,uuid)
  from public,anon,authenticated,service_role;
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
  v_rotation_source uuid;
  v_inherited record;
begin
  if lower(trim(p_channel)) is distinct from 'elevenst' then
    return query select * from sellerpilot_private.credential_lineage_before_202609134300(p_channel,p_environment,p_vault_secret_id);
    return;
  end if;
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
 where schemaname='sellerpilot_private' and indexname='channel_credentials_one_active_non_lazada_smartstore_idx';
 if v_definition is distinct from $index_preimage$CREATE UNIQUE INDEX channel_credentials_one_active_non_lazada_smartstore_idx ON sellerpilot_private.channel_credentials USING btree (channel, environment) WHERE ((status = 'active'::text) AND (channel <> ALL (ARRAY['lazada'::text, 'smartstore'::text])))$index_preimage$ then
  raise exception 'ELEVENST_ACTIVE_INDEX_CENTRAL_MERGE_REQUIRED';
 end if;
 if to_regclass('sellerpilot_private.channel_credentials_one_active_lazada_account_idx') is null
 or to_regclass('sellerpilot_private.channel_credentials_one_active_lazada_pending_owner_idx') is null then
  raise exception 'ELEVENST_LAZADA_ACCOUNT_FENCES_REQUIRED';
 end if;
 drop index sellerpilot_private.channel_credentials_one_active_non_lazada_smartstore_idx;
end;
$$;
create unique index channel_credentials_one_active_non_lazada_elevenst_smartstore_idx
 on sellerpilot_private.channel_credentials(channel, environment)
 where status='active' and channel not in ('lazada','elevenst','smartstore');
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


-- Reviewed source: 20260909133703_cs_elevenst_pending_diagnostic.sql
-- Source SHA256: 9de9aafd2ed57d408f71d0335210c3073ba8c98b3f86ed4e7e8be427e3eeb6ed
-- channel: elevenst
-- assignment: CS-elevenst-CONT-09
-- Proposal only. Apply after the accepted CONT-08 credential lifecycle and the
-- centrally combined multi-account active-index migration.
--
-- This adds one read-only fixed-egress lane for a pending 11st credential. It
-- does not certify seller identity: ProductSearch only proves API-key access.

create unique index channel_gateway_jobs_one_elevenst_pending_diagnostic_idx
  on sellerpilot_private.channel_gateway_jobs (credential_id)
  where channel = 'elevenst'
    and operation = 'diagnostic.test'
    and status in ('queued','running')
    and request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true';

create function public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1(
  p_credential_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_job_id uuid := gen_random_uuid();
  v_existing uuid;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = 'pending'
     and claim.seller_account_key = credential.seller_account_key
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'pending'
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
   for update of credential;
  if not found then
    raise exception 'ELEVENST_PENDING_CREDENTIAL_REQUIRED';
  end if;
  select job.id into v_existing
    from sellerpilot_private.channel_gateway_jobs job
   where job.credential_id = v_credential.id
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and job.status in ('queued','running')
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true'
   order by job.created_at desc
   limit 1;
  if v_existing is not null then return v_existing; end if;
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,channel,operation,environment,
    request_payload,status,created_by
  ) values (
    v_job_id,v_credential.id,null,'elevenst','diagnostic.test',
    v_credential.environment,
    jsonb_build_object(
      'sellerpilotPendingCredentialDiagnosticV1',true,
      'identityEvidence','admin_claim_v1'
    ),
    'queued',v_credential.created_by
  );
  return v_job_id;
end;
$$;

create function public.sellerpilot_claim_elevenst_pending_diagnostic_v1(
  p_token_hash text,
  p_worker_version text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_result jsonb;
begin
  if not sellerpilot_private.worker_token_has_scope(
       p_token_hash,'gateway',true
     ) then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  select token.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update;
  if not found then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;
  update sellerpilot_private.ai_cli_worker_tokens token
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version),''),80)
   where token.id = v_token_id;
  -- Pending diagnostics are read-only and may safely reclaim a lost lease.
  -- A fresh claim token fences the previous worker; attempts remain bounded.
  update sellerpilot_private.channel_gateway_jobs job
    set status=case when attempt_count >= 3 then 'failed' else 'queued' end,
        worker_token_id=null, claim_token=null, lease_expires_at=null,
        completed_at=case when attempt_count >= 3 then clock_timestamp() else null end,
        error_message=case when attempt_count >= 3 then 'ELEVENST_PENDING_DIAGNOSTIC_ATTEMPTS_EXHAUSTED' else null end,
        updated_at=clock_timestamp()
    where (p_job_id is null or job.id=p_job_id)
      and job.channel='elevenst' and job.operation='diagnostic.test'
      and job.status='running' and job.lease_expires_at <= clock_timestamp()
      and job.provider_mutation_started_at is null
      and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1'='true';
  select job.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs job
   where (p_job_id is null or job.id = p_job_id)
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and job.status = 'queued'
     and job.attempt_count < 3
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true'
     and exists (
       select 1
         from sellerpilot_private.channel_credentials credential
         join sellerpilot_private.elevenst_credential_identity_claims claim
           on claim.credential_id = credential.id
          and claim.lifecycle_state = 'pending'
          and claim.seller_account_key = credential.seller_account_key
        where credential.id = job.credential_id
          and credential.channel = 'elevenst'
          and credential.status = 'pending'
          and (credential.expires_at is null
            or credential.expires_at > clock_timestamp())
     )
   order by job.created_at,job.id
   limit 1
   for update of job skip locked;
  if v_job_id is null then return null; end if;
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = job.attempt_count + 1,
         lease_expires_at = clock_timestamp() + interval '3 minutes',
         started_at = coalesce(job.started_at,clock_timestamp()),
         error_message = null,
         updated_at = clock_timestamp()
   where job.id = v_job_id
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and job.status = 'queued'
     and job.attempt_count < 3
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true';
  if not found then return null; end if;
  select jsonb_build_object(
    'id',job.id,
    'claim_token',job.claim_token,
    'credential_id',job.credential_id,
    'channel',job.channel,
    'operation',job.operation,
    'environment',job.environment,
    'request',job.request_payload,
    'credential',decrypted.decrypted_secret::jsonb,
    'attempt_count',job.attempt_count
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.status = 'pending'
     and credential.channel = 'elevenst'
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = 'pending'
     and claim.seller_account_key = credential.seller_account_key
    join vault.decrypted_secrets decrypted
      on decrypted.id = credential.vault_secret_id
   where job.id = v_job_id
     and job.claim_token = v_claim_token
     and job.worker_token_id = v_token_id
     and job.status = 'running';
  if v_result is null then
    raise exception 'ELEVENST_PENDING_DIAGNOSTIC_CLAIM_MISMATCH';
  end if;
  return v_result;
end;
$$;

create function public.sellerpilot_complete_elevenst_pending_diagnostic_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_diagnostic jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_status text := coalesce(p_diagnostic->>'status','');
  v_message text := trim(coalesce(p_diagnostic->>'message',''));
  v_response jsonb;
begin
  if jsonb_typeof(p_diagnostic) is distinct from 'object'
     or v_status not in ('passed','manual','failed')
     or length(v_message) not between 1 and 500
     or exists (
       select 1 from jsonb_object_keys(p_diagnostic) key
        where key <> all(array['status','message','remoteRequestId'])
     )
     or (p_diagnostic ? 'remoteRequestId'
       and length(coalesce(p_diagnostic->>'remoteRequestId','')) > 160) then
    raise exception 'ELEVENST_PENDING_DIAGNOSTIC_RESULT_INVALID';
  end if;
  if not sellerpilot_private.worker_token_has_scope(p_token_hash,'gateway',true) then
    raise exception 'invalid worker token' using errcode='42501';
  end if;
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = 'elevenst'
     and credential.status in ('pending','active','grace','revoked','invalid')
    join sellerpilot_private.elevenst_credential_identity_claims claim
      on claim.credential_id = credential.id
     and claim.lifecycle_state = credential.status
     and claim.seller_account_key = credential.seller_account_key
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.channel = 'elevenst'
     and job.operation = 'diagnostic.test'
     and (job.status in ('succeeded','failed')
       or (job.status='running' and job.lease_expires_at > clock_timestamp() and credential.status='pending'))
     and job.provider_mutation_started_at is null
     and job.request_payload->>'sellerpilotPendingCredentialDiagnosticV1' = 'true'
   for update of job,credential,claim;
  if not found then
    raise exception 'ELEVENST_PENDING_DIAGNOSTIC_COMPLETION_MISMATCH';
  end if;
  if v_job.status in ('succeeded','failed') then
    if v_job.response_payload->'diagnostic' is distinct from p_diagnostic
       or v_job.response_payload->>'identityEvidence' is distinct from 'admin_claim_v1' then
      raise exception 'ELEVENST_PENDING_DIAGNOSTIC_REPLAY_MISMATCH';
    end if;
    return jsonb_build_object('status','completed','jobId',v_job.id,
      'credentialId',v_job.credential_id,'diagnosticStatus',v_status,
      'identityEvidence','admin_claim_v1');
  end if;
  v_response := jsonb_build_object(
    'ok',v_status <> 'failed',
    'channel','elevenst',
    'operation','diagnostic.test',
    'diagnostic',p_diagnostic,
    'safeMessage',v_message,
    'identityEvidence','admin_claim_v1'
  );
  update sellerpilot_private.channel_gateway_jobs job
     set status = case when v_status = 'failed' then 'failed' else 'succeeded' end,
         response_payload = v_response,
         error_message = case when v_status = 'failed' then v_message else null end,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = v_job.id;
  update sellerpilot_private.channel_credentials credential
     set last_checked_at = clock_timestamp(),
         last_check_status = v_status,
         last_check_message = v_message
   where credential.id = v_job.credential_id
     and credential.status = 'pending';
  insert into sellerpilot_private.credential_audit (
    credential_id,channel,environment,action,safe_detail
  ) values (
    v_job.credential_id,'elevenst',v_job.environment,'tested',jsonb_build_object(
      'status',v_status,'message',v_message,
      'jobId',v_job.id,'identityEvidence','admin_claim_v1'
    )
  );
  return jsonb_build_object(
    'status','completed','jobId',v_job.id,
    'credentialId',v_job.credential_id,'diagnosticStatus',v_status,
    'identityEvidence','admin_claim_v1'
  );
end;
$$;

revoke all on function public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1(uuid)
  from public,anon;
revoke all on function public.sellerpilot_claim_elevenst_pending_diagnostic_v1(text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_complete_elevenst_pending_diagnostic_v1(text,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_enqueue_elevenst_pending_diagnostic_v1(uuid)
  to authenticated;
grant execute on function public.sellerpilot_claim_elevenst_pending_diagnostic_v1(text,text,uuid)
  to service_role;
grant execute on function public.sellerpilot_complete_elevenst_pending_diagnostic_v1(text,uuid,uuid,jsonb)
  to service_role;


commit;
