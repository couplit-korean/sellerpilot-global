-- Opaque Supabase sb_secret_* requests run as the service_role database role
-- but do not populate request.jwt.claim.role. Provider identity was therefore
-- preserved in Vault while the rotated credential row remained
-- legacy_unattested. Bind certification to the exact claim-bound refresh
-- instead of trusting a caller-controlled provider subject or a legacy GUC.

begin;

create or replace function sellerpilot_private.credential_lineage_attestation_marker_matches(
  p_channel text,
  p_environment text,
  p_vault_secret_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_marker text := nullif(
    current_setting('sellerpilot.provider_account_credential_attestation', true),
    ''
  );
  v_mode text;
  v_job_id uuid;
  v_claim_token uuid;
begin
  if v_marker is null then return false; end if;
  v_mode := split_part(v_marker, ':', 1);
  v_job_id := split_part(v_marker, ':', 2)::uuid;

  if v_mode = 'live' then
    v_claim_token := split_part(v_marker, ':', 3)::uuid;
    return exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.channel_credentials credential
          on credential.id = job.prepared_credential_id
         and credential.id = job.credential_id
        join sellerpilot_private.ai_cli_worker_tokens worker_token
          on worker_token.id = job.worker_token_id
       where job.id = v_job_id
         and job.claim_token = v_claim_token
         and job.status = 'running'
         and job.lease_expires_at > now()
         and job.credential_refresh_prepared_at is not null
         and worker_token.status = 'active'
         and worker_token.expires_at > now()
         and credential.status = 'active'
         and credential.channel = lower(trim(p_channel))
         and credential.environment = lower(trim(p_environment))
         and credential.vault_secret_id = p_vault_secret_id
    );
  end if;

  if v_mode = 'repair' then
    return exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.channel_credentials credential
          on credential.id = job.prepared_credential_id
         and credential.id = job.credential_id
       where job.id = v_job_id
         and job.channel = 'ebay'
         and job.operation = 'diagnostic.test'
         and job.status = 'succeeded'
         and job.credential_refresh_prepared_at is not null
         and job.completed_at >= job.credential_refresh_prepared_at
         and coalesce((job.response_payload->>'ok')::boolean, false)
         and job.response_payload->>'operation' = 'diagnostic.test'
         and credential.status = 'active'
         and credential.last_check_status = 'passed'
         and credential.last_checked_at >= job.credential_refresh_prepared_at
         and credential.seller_account_key is null
         and credential.seller_account_key_source = 'legacy_unattested'
         and credential.seller_account_verified_at is null
         and credential.channel = lower(trim(p_channel))
         and credential.environment = lower(trim(p_environment))
         and credential.vault_secret_id = p_vault_secret_id
    );
  end if;

  return false;
exception when invalid_text_representation then
  return false;
end;
$$;

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
  v_legacy_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
  v_service_attested boolean;
begin
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

create or replace function sellerpilot_private.guard_credential_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineage record;
begin
  if tg_op = 'INSERT' then
    select * into v_lineage
      from sellerpilot_private.credential_seller_account_lineage(
        new.channel,
        new.environment,
        new.vault_secret_id
      );
    new.seller_account_key := v_lineage.seller_account_key;
    new.seller_account_key_source := v_lineage.seller_account_key_source;
    new.seller_account_verified_at := v_lineage.seller_account_verified_at;
    return new;
  end if;

  if new.vault_secret_id is distinct from old.vault_secret_id
     or new.channel is distinct from old.channel
     or new.environment is distinct from old.environment
     or new.seller_account_key is distinct from old.seller_account_key
     or new.seller_account_key_source is distinct from old.seller_account_key_source
     or new.seller_account_verified_at is distinct from old.seller_account_verified_at then
    if (to_jsonb(new) - array[
          'seller_account_key',
          'seller_account_key_source',
          'seller_account_verified_at'
        ]::text[])
         is not distinct from
       (to_jsonb(old) - array[
          'seller_account_key',
          'seller_account_key_source',
          'seller_account_verified_at'
        ]::text[])
       and old.seller_account_key is null
       and old.seller_account_key_source = 'legacy_unattested'
       and old.seller_account_verified_at is null then
      select * into v_lineage
        from sellerpilot_private.credential_seller_account_lineage(
          new.channel,
          new.environment,
          new.vault_secret_id
        );
      if v_lineage.seller_account_key ~ '^[a-f0-9]{64}$'
         and v_lineage.seller_account_key_source = 'provider_certified_v1'
         and v_lineage.seller_account_verified_at is not null then
        new.seller_account_key := v_lineage.seller_account_key;
        new.seller_account_key_source := v_lineage.seller_account_key_source;
        new.seller_account_verified_at := v_lineage.seller_account_verified_at;
        return new;
      end if;
    end if;
    raise exception 'credential seller lineage is immutable';
  end if;
  return new;
end;
$$;

alter function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) rename to sellerpilot_54851_prepare_refresh_identity_unsafe;

create function public.sellerpilot_service_prepare_gateway_credential_refresh(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz default null,
  p_recovery_only boolean default false,
  p_oauth_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preparation jsonb;
  v_prepared_credential_id uuid;
  v_lineage record;
  v_updated integer;
begin
  v_preparation := public.sellerpilot_54851_prepare_refresh_identity_unsafe(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_secret_payload,
    p_expires_at,
    p_recovery_only,
    p_oauth_complete
  );
  if coalesce(v_preparation->>'status', '') <> 'prepared' then
    return v_preparation;
  end if;

  begin
    v_prepared_credential_id := (v_preparation->>'credential_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'prepared provider credential identity is invalid';
  end;

  perform 1
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens worker_token
      on worker_token.id = job.worker_token_id
   where job.id = p_job_id
     and job.claim_token = p_claim_token
     and job.status = 'running'
     and job.lease_expires_at > now()
     and job.credential_id = v_prepared_credential_id
     and job.prepared_credential_id = v_prepared_credential_id
     and job.credential_refresh_prepared_at is not null
     and worker_token.token_hash = p_token_hash
     and worker_token.status = 'active'
     and worker_token.expires_at > now();
  if not found then
    raise exception 'prepared provider credential claim is unavailable';
  end if;

  perform set_config(
    'sellerpilot.provider_account_credential_attestation',
    'live:' || p_job_id::text || ':' || p_claim_token::text,
    true
  );
  select lineage.* into v_lineage
    from sellerpilot_private.channel_credentials credential
    cross join lateral sellerpilot_private.credential_seller_account_lineage(
      credential.channel,
      credential.environment,
      credential.vault_secret_id
    ) lineage
   where credential.id = v_prepared_credential_id;
  if v_lineage.seller_account_key !~ '^[a-f0-9]{64}$'
     or v_lineage.seller_account_key_source <> 'provider_certified_v1'
     or v_lineage.seller_account_verified_at is null then
    raise exception 'provider credential identity attestation failed';
  end if;

  update sellerpilot_private.channel_credentials credential
     set seller_account_key = v_lineage.seller_account_key,
         seller_account_key_source = v_lineage.seller_account_key_source,
         seller_account_verified_at = v_lineage.seller_account_verified_at
   where credential.id = v_prepared_credential_id
     and credential.seller_account_key is null
     and credential.seller_account_key_source = 'legacy_unattested'
     and credential.seller_account_verified_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    perform 1
      from sellerpilot_private.channel_credentials credential
     where credential.id = v_prepared_credential_id
       and credential.seller_account_key = v_lineage.seller_account_key
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null;
    if found then
      perform set_config('sellerpilot.provider_account_credential_attestation', '', true);
      return v_preparation;
    end if;
  end if;
  if v_updated <> 1 then
    raise exception 'prepared provider credential is unavailable';
  end if;
  perform set_config('sellerpilot.provider_account_credential_attestation', '', true);
  return v_preparation;
end;
$$;

-- Repair only an active credential whose provider subject was staged by the
-- exact succeeded eBay diagnostic transaction. No public seller ID or
-- user-entered field is accepted as evidence.
do $repair$
declare
  v_candidate record;
  v_lineage record;
begin
  for v_candidate in
    select credential.id as credential_id,
           credential.channel,
           credential.environment,
           credential.vault_secret_id,
           job.id as job_id
      from sellerpilot_private.channel_credentials credential
      join sellerpilot_private.channel_gateway_jobs job
        on job.credential_id = credential.id
       and job.prepared_credential_id = credential.id
     where credential.channel = 'ebay'
       and credential.status = 'active'
       and credential.seller_account_key is null
       and credential.seller_account_key_source = 'legacy_unattested'
       and credential.seller_account_verified_at is null
       and job.operation = 'diagnostic.test'
       and job.status = 'succeeded'
       and job.credential_refresh_prepared_at is not null
       and job.completed_at >= job.credential_refresh_prepared_at
       and coalesce((job.response_payload->>'ok')::boolean, false)
       and job.response_payload->>'operation' = 'diagnostic.test'
       and credential.last_check_status = 'passed'
       and credential.last_checked_at >= job.credential_refresh_prepared_at
     order by job.completed_at desc
  loop
    perform set_config(
      'sellerpilot.provider_account_credential_attestation',
      'repair:' || v_candidate.job_id::text,
      true
    );
    select * into v_lineage
      from sellerpilot_private.credential_seller_account_lineage(
        v_candidate.channel,
        v_candidate.environment,
        v_candidate.vault_secret_id
      );
    if v_lineage.seller_account_key !~ '^[a-f0-9]{64}$'
       or v_lineage.seller_account_key_source <> 'provider_certified_v1'
       or v_lineage.seller_account_verified_at is null then
      raise exception 'succeeded eBay diagnostic identity repair failed';
    end if;
    update sellerpilot_private.channel_credentials credential
       set seller_account_key = v_lineage.seller_account_key,
           seller_account_key_source = v_lineage.seller_account_key_source,
           seller_account_verified_at = v_lineage.seller_account_verified_at
     where credential.id = v_candidate.credential_id;
  end loop;
  perform set_config('sellerpilot.provider_account_credential_attestation', '', true);
end;
$repair$;

revoke all on function
  sellerpilot_private.credential_lineage_attestation_marker_matches(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.credential_seller_account_lineage(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.guard_credential_seller_lineage()
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_54851_prepare_refresh_identity_unsafe(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) to service_role;

comment on function public.sellerpilot_service_prepare_gateway_credential_refresh(
  text, uuid, uuid, jsonb, timestamptz, boolean, boolean
) is 'Stages a claim-bound OAuth refresh and certifies only the immutable provider identity preserved in its exact Vault payload.';

commit;
