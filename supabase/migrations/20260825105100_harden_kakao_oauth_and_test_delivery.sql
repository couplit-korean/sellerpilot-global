-- Kakao OAuth callback and manual test delivery lifecycle hardening.
-- Authorization codes and token payloads live only in Vault; the relational
-- ledger stores non-reversible fingerprints and exact claim ownership.

begin;

create table if not exists sellerpilot_private.kakao_oauth_callback_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  state_nonce uuid not null unique,
  redirect_uri text not null check (
    length(redirect_uri) between 8 and 2000
    and redirect_uri ~ '^https?://'
  ),
  state_expires_at timestamptz not null,
  code_fingerprint text check (
    code_fingerprint is null or code_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  status text not null default 'awaiting_code' check (status in (
    'awaiting_code',
    'prepared',
    'exchanging',
    'token_staged',
    'connected',
    'failed',
    'reconciliation_required'
  )),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  provider_started_at timestamptz,
  authorization_code_vault_id uuid,
  staged_token_vault_id uuid,
  staged_token_fingerprint text check (
    staged_token_fingerprint is null or staged_token_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  staged_token_expires_at timestamptz,
  token_staged_at timestamptz,
  integration_id uuid references sellerpilot_private.kakao_integrations(id) on delete set null,
  kakao_user_id text check (kakao_user_id is null or length(kakao_user_id) between 1 and 120),
  nickname text check (nickname is null or length(nickname) <= 160),
  safe_error text check (safe_error is null or length(safe_error) <= 160),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  reconciliation_required_at timestamptz,
  check (
    (status = 'awaiting_code'
      and code_fingerprint is null
      and authorization_code_vault_id is null
      and staged_token_vault_id is null)
    or
    (status in ('prepared', 'exchanging')
      and code_fingerprint is not null
      and authorization_code_vault_id is not null
      and staged_token_vault_id is null)
    or
    (status = 'token_staged'
      and code_fingerprint is not null
      and authorization_code_vault_id is null
      and staged_token_vault_id is not null
      and staged_token_fingerprint is not null
      and token_staged_at is not null)
    or
    (status = 'connected'
      and integration_id is not null
      and authorization_code_vault_id is null
      and staged_token_vault_id is null
      and completed_at is not null)
    or
    (status in ('failed', 'reconciliation_required')
      and authorization_code_vault_id is null
      and staged_token_vault_id is null)
  ),
  check (
    status <> 'exchanging'
    or (
      claim_token is not null
      and lease_expires_at is not null
      and provider_started_at is not null
    )
  )
);

create index if not exists kakao_oauth_callback_owner_time_idx
  on sellerpilot_private.kakao_oauth_callback_attempts (owner_id, created_at desc);
create index if not exists kakao_oauth_callback_lease_idx
  on sellerpilot_private.kakao_oauth_callback_attempts (lease_expires_at)
  where status in ('prepared', 'exchanging', 'token_staged');
create index if not exists kakao_oauth_callback_temp_token_idx
  on sellerpilot_private.kakao_oauth_callback_attempts (token_staged_at)
  where status = 'token_staged';

alter table sellerpilot_private.kakao_oauth_callback_attempts enable row level security;
revoke all on sellerpilot_private.kakao_oauth_callback_attempts
  from public, anon, authenticated;

create or replace function public.sellerpilot_service_sweep_kakao_oauth_callbacks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_prepared_released integer := 0;
  v_token_released integer := 0;
  v_reconciliation integer := 0;
  v_expired integer := 0;
begin
  for v_row in
    select a.id, a.authorization_code_vault_id, a.staged_token_vault_id
      from sellerpilot_private.kakao_oauth_callback_attempts a
     where a.status = 'exchanging'
       and a.lease_expires_at is not null
       and a.lease_expires_at <= clock_timestamp()
     for update skip locked
  loop
    if v_row.authorization_code_vault_id is not null then
      delete from vault.secrets where id = v_row.authorization_code_vault_id;
    end if;
    if v_row.staged_token_vault_id is not null then
      delete from vault.secrets where id = v_row.staged_token_vault_id;
    end if;
    update sellerpilot_private.kakao_oauth_callback_attempts
       set status = 'reconciliation_required',
           authorization_code_vault_id = null,
           staged_token_vault_id = null,
           lease_expires_at = null,
           safe_error = 'KAKAO_CODE_EXCHANGE_OUTCOME_UNKNOWN',
           reconciliation_required_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_row.id;
    v_reconciliation := v_reconciliation + 1;
  end loop;

  update sellerpilot_private.kakao_oauth_callback_attempts
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         safe_error = coalesce(safe_error, 'KAKAO_CALLBACK_PREPARATION_INTERRUPTED'),
         updated_at = clock_timestamp()
   where status = 'prepared'
     and lease_expires_at is not null
     and lease_expires_at <= clock_timestamp()
     and state_expires_at + interval '1 hour' > clock_timestamp();
  get diagnostics v_prepared_released = row_count;

  update sellerpilot_private.kakao_oauth_callback_attempts
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         safe_error = coalesce(safe_error, 'KAKAO_PROFILE_LOOKUP_INTERRUPTED'),
         updated_at = clock_timestamp()
   where status = 'token_staged'
     and lease_expires_at is not null
     and lease_expires_at <= clock_timestamp()
     and token_staged_at > clock_timestamp() - interval '24 hours';
  get diagnostics v_token_released = row_count;

  for v_row in
    select a.id, a.authorization_code_vault_id, a.staged_token_vault_id
      from sellerpilot_private.kakao_oauth_callback_attempts a
     where (
       a.status = 'awaiting_code'
       and a.state_expires_at <= clock_timestamp()
     ) or (
       a.status = 'prepared'
       and a.state_expires_at + interval '1 hour' <= clock_timestamp()
     ) or (
       a.status = 'token_staged'
       and a.token_staged_at <= clock_timestamp() - interval '24 hours'
     )
     for update skip locked
  loop
    if v_row.authorization_code_vault_id is not null then
      delete from vault.secrets where id = v_row.authorization_code_vault_id;
    end if;
    if v_row.staged_token_vault_id is not null then
      delete from vault.secrets where id = v_row.staged_token_vault_id;
    end if;
    update sellerpilot_private.kakao_oauth_callback_attempts
       set status = 'failed',
           authorization_code_vault_id = null,
           staged_token_vault_id = null,
           claim_token = null,
           claimed_at = null,
           lease_expires_at = null,
           safe_error = 'KAKAO_CALLBACK_EXPIRED',
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_row.id;
    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object(
    'prepared_released', v_prepared_released,
    'token_staged_released', v_token_released,
    'reconciliation_required', v_reconciliation,
    'expired', v_expired
  );
end;
$$;

create or replace function public.sellerpilot_service_register_kakao_oauth_state(
  p_owner_id uuid,
  p_state_nonce uuid,
  p_redirect_uri text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner_id is null
     or not exists (
       select 1 from sellerpilot_private.admin_users a where a.user_id = p_owner_id
     )
     or p_state_nonce is null
     or length(trim(coalesce(p_redirect_uri, ''))) not between 8 and 2000
     or trim(p_redirect_uri) !~ '^https?://'
     or p_expires_at is null
     or p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '15 minutes' then
    raise exception 'invalid Kakao OAuth state';
  end if;

  perform public.sellerpilot_service_sweep_kakao_oauth_callbacks();
  insert into sellerpilot_private.kakao_oauth_callback_attempts (
    owner_id, state_nonce, redirect_uri, state_expires_at
  ) values (
    p_owner_id, p_state_nonce, trim(p_redirect_uri), p_expires_at
  ) on conflict (state_nonce) do nothing;

  return exists (
    select 1
      from sellerpilot_private.kakao_oauth_callback_attempts a
     where a.state_nonce = p_state_nonce
       and a.owner_id = p_owner_id
       and a.redirect_uri = trim(p_redirect_uri)
       and a.state_expires_at = p_expires_at
  );
end;
$$;

create or replace function public.sellerpilot_service_claim_kakao_oauth_callback(
  p_owner_id uuid,
  p_state_nonce uuid,
  p_redirect_uri text,
  p_authorization_code text,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt sellerpilot_private.kakao_oauth_callback_attempts%rowtype;
  v_fingerprint text;
  v_vault_id uuid;
  v_claim_token uuid;
begin
  if p_owner_id is null
     or p_state_nonce is null
     or length(coalesce(p_authorization_code, '')) not between 8 and 2048
     or length(trim(coalesce(p_redirect_uri, ''))) not between 8 and 2000 then
    raise exception 'invalid Kakao OAuth callback claim';
  end if;
  v_fingerprint := encode(
    extensions.digest(p_authorization_code, 'sha256'),
    'hex'
  );

  perform public.sellerpilot_service_sweep_kakao_oauth_callbacks();
  select a.* into v_attempt
    from sellerpilot_private.kakao_oauth_callback_attempts a
   where a.state_nonce = p_state_nonce
     and a.owner_id = p_owner_id
     and a.redirect_uri = trim(p_redirect_uri)
   for update;
  if not found then
    return jsonb_build_object('status', 'invalid_state');
  end if;
  if v_attempt.code_fingerprint is not null
     and v_attempt.code_fingerprint <> v_fingerprint then
    return jsonb_build_object('status', 'invalid_replay');
  end if;
  if v_attempt.status in ('connected', 'failed', 'reconciliation_required') then
    return jsonb_build_object(
      'status', v_attempt.status,
      'attemptId', v_attempt.id,
      'safeError', v_attempt.safe_error
    );
  end if;
  if v_attempt.status = 'awaiting_code' then
    if v_attempt.state_expires_at <= clock_timestamp() then
      update sellerpilot_private.kakao_oauth_callback_attempts
         set status = 'failed',
             safe_error = 'KAKAO_STATE_EXPIRED',
             completed_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where id = v_attempt.id;
      return jsonb_build_object('status', 'failed', 'safeError', 'KAKAO_STATE_EXPIRED');
    end if;
    select vault.create_secret(
      p_authorization_code,
      format('sellerpilot_kakao_oauth_code_%s_%s', v_attempt.id, gen_random_uuid()),
      'Temporary claim-bound Kakao OAuth authorization code'
    ) into v_vault_id;
    v_claim_token := gen_random_uuid();
    update sellerpilot_private.kakao_oauth_callback_attempts
       set status = 'prepared',
           code_fingerprint = v_fingerprint,
           authorization_code_vault_id = v_vault_id,
           claim_token = v_claim_token,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp()
             + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 180), 600))),
           attempt_count = least(attempt_count + 1, 10),
           safe_error = null,
           updated_at = clock_timestamp()
     where id = v_attempt.id;
    return jsonb_build_object(
      'status', 'claimed',
      'phase', 'prepared',
      'attemptId', v_attempt.id,
      'claimToken', v_claim_token
    );
  end if;

  if v_attempt.status in ('prepared', 'token_staged')
     and v_attempt.lease_expires_at is not null
     and v_attempt.lease_expires_at > clock_timestamp()
     and v_attempt.claim_token is not null then
    return jsonb_build_object('status', 'in_progress', 'attemptId', v_attempt.id);
  end if;
  if v_attempt.status = 'exchanging' then
    return jsonb_build_object('status', 'in_progress', 'attemptId', v_attempt.id);
  end if;
  if v_attempt.status not in ('prepared', 'token_staged') then
    return jsonb_build_object('status', 'invalid_state');
  end if;

  v_claim_token := gen_random_uuid();
  update sellerpilot_private.kakao_oauth_callback_attempts
     set claim_token = v_claim_token,
         claimed_at = clock_timestamp(),
         lease_expires_at = clock_timestamp()
           + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 180), 600))),
         attempt_count = least(attempt_count + 1, 10),
         safe_error = null,
         updated_at = clock_timestamp()
   where id = v_attempt.id;
  return jsonb_build_object(
    'status', 'claimed',
    'phase', v_attempt.status,
    'attemptId', v_attempt.id,
    'claimToken', v_claim_token
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_kakao_oauth_exchange(
  p_attempt_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update sellerpilot_private.kakao_oauth_callback_attempts
     set status = 'exchanging',
         provider_started_at = clock_timestamp(),
         lease_expires_at = greatest(
           lease_expires_at,
           clock_timestamp() + interval '3 minutes'
         ),
         updated_at = clock_timestamp()
   where id = p_attempt_id
     and status = 'prepared'
     and claim_token = p_claim_token
     and lease_expires_at > clock_timestamp()
     and authorization_code_vault_id is not null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_service_stage_kakao_oauth_token(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt sellerpilot_private.kakao_oauth_callback_attempts%rowtype;
  v_fingerprint text;
  v_vault_id uuid;
begin
  if jsonb_typeof(p_secret_payload) <> 'object'
     or length(coalesce(p_secret_payload->>'access_token', '')) < 8
     or octet_length(p_secret_payload::text) > 32000
     or p_expires_at is null
     or p_expires_at <= clock_timestamp() then
    raise exception 'invalid Kakao OAuth token stage';
  end if;
  v_fingerprint := encode(
    extensions.digest(p_secret_payload::text, 'sha256'),
    'hex'
  );
  select a.* into v_attempt
    from sellerpilot_private.kakao_oauth_callback_attempts a
   where a.id = p_attempt_id
     and a.claim_token = p_claim_token
   for update;
  if not found then return false; end if;
  if v_attempt.status = 'token_staged' then
    return v_attempt.staged_token_fingerprint = v_fingerprint;
  end if;
  if v_attempt.status <> 'exchanging'
     or v_attempt.lease_expires_at is null
     or v_attempt.lease_expires_at <= clock_timestamp() then
    return false;
  end if;

  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_kakao_oauth_token_%s_%s', p_attempt_id, gen_random_uuid()),
    'Temporary claim-bound Kakao OAuth token response'
  ) into v_vault_id;
  update sellerpilot_private.kakao_oauth_callback_attempts
     set status = 'token_staged',
         staged_token_vault_id = v_vault_id,
         staged_token_fingerprint = v_fingerprint,
         staged_token_expires_at = p_expires_at,
         token_staged_at = clock_timestamp(),
         authorization_code_vault_id = null,
         lease_expires_at = greatest(
           lease_expires_at,
           clock_timestamp() + interval '3 minutes'
         ),
         updated_at = clock_timestamp()
   where id = p_attempt_id;
  if v_attempt.authorization_code_vault_id is not null then
    delete from vault.secrets where id = v_attempt.authorization_code_vault_id;
  end if;
  return true;
end;
$$;

create or replace function public.sellerpilot_service_get_claimed_kakao_oauth_token(
  p_attempt_id uuid,
  p_claim_token uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'secret', s.decrypted_secret::jsonb,
    'expiresAt', a.staged_token_expires_at
  )
    from sellerpilot_private.kakao_oauth_callback_attempts a
    join vault.decrypted_secrets s on s.id = a.staged_token_vault_id
   where a.id = p_attempt_id
     and a.status = 'token_staged'
     and a.claim_token = p_claim_token
     and a.lease_expires_at > clock_timestamp()
$$;

create or replace function public.sellerpilot_service_release_kakao_oauth_claim(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update sellerpilot_private.kakao_oauth_callback_attempts
     set claim_token = null,
         claimed_at = null,
         lease_expires_at = null,
         safe_error = left(coalesce(nullif(p_error, ''), 'KAKAO_CALLBACK_RETRY_REQUIRED'), 160),
         updated_at = clock_timestamp()
   where id = p_attempt_id
     and claim_token = p_claim_token
     and status in ('prepared', 'token_staged');
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_service_finish_kakao_oauth_attempt(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt sellerpilot_private.kakao_oauth_callback_attempts%rowtype;
begin
  if p_outcome not in ('failed', 'reconciliation_required')
     or length(coalesce(p_error, '')) not between 1 and 160 then
    raise exception 'invalid Kakao OAuth terminal outcome';
  end if;
  select a.* into v_attempt
    from sellerpilot_private.kakao_oauth_callback_attempts a
   where a.id = p_attempt_id
     and a.claim_token = p_claim_token
   for update;
  if not found then return false; end if;
  if v_attempt.status = p_outcome then
    return v_attempt.safe_error = left(p_error, 160);
  end if;
  if v_attempt.status not in ('prepared', 'exchanging', 'token_staged') then
    return false;
  end if;
  if v_attempt.authorization_code_vault_id is not null then
    delete from vault.secrets where id = v_attempt.authorization_code_vault_id;
  end if;
  if v_attempt.staged_token_vault_id is not null then
    delete from vault.secrets where id = v_attempt.staged_token_vault_id;
  end if;
  update sellerpilot_private.kakao_oauth_callback_attempts
     set status = p_outcome,
         authorization_code_vault_id = null,
         staged_token_vault_id = null,
         lease_expires_at = null,
         safe_error = left(p_error, 160),
         completed_at = case when p_outcome = 'failed' then clock_timestamp() else null end,
         reconciliation_required_at = case
           when p_outcome = 'reconciliation_required' then clock_timestamp()
           else null
         end,
         updated_at = clock_timestamp()
   where id = p_attempt_id;
  return true;
end;
$$;

create or replace function public.sellerpilot_service_complete_kakao_oauth_connection(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_kakao_user_id text,
  p_nickname text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt sellerpilot_private.kakao_oauth_callback_attempts%rowtype;
  v_integration_id uuid;
  v_old_vault_id uuid;
begin
  if length(trim(coalesce(p_kakao_user_id, ''))) not between 1 and 120
     or length(coalesce(p_nickname, '')) > 160 then
    raise exception 'invalid Kakao OAuth profile';
  end if;
  select a.* into v_attempt
    from sellerpilot_private.kakao_oauth_callback_attempts a
   where a.id = p_attempt_id
     and a.claim_token = p_claim_token
   for update;
  if not found then return null; end if;
  if v_attempt.status = 'connected' then
    return v_attempt.integration_id;
  end if;
  if v_attempt.status <> 'token_staged'
     or v_attempt.staged_token_vault_id is null
     or v_attempt.staged_token_expires_at is null
     or v_attempt.lease_expires_at is null
     or v_attempt.lease_expires_at <= clock_timestamp() then
    return null;
  end if;

  select k.vault_secret_id into v_old_vault_id
    from sellerpilot_private.kakao_integrations k
   where k.owner_id = v_attempt.owner_id
   for update;
  insert into sellerpilot_private.kakao_integrations (
    owner_id, kakao_user_id, nickname, vault_secret_id, status, expires_at
  ) values (
    v_attempt.owner_id,
    trim(p_kakao_user_id),
    left(coalesce(p_nickname, ''), 160),
    v_attempt.staged_token_vault_id,
    'active',
    v_attempt.staged_token_expires_at
  )
  on conflict (owner_id) do update
    set kakao_user_id = excluded.kakao_user_id,
        nickname = excluded.nickname,
        vault_secret_id = excluded.vault_secret_id,
        status = 'active',
        expires_at = excluded.expires_at,
        updated_at = clock_timestamp()
  returning id into v_integration_id;

  insert into sellerpilot_private.notification_preferences (owner_id)
  values (v_attempt.owner_id)
  on conflict do nothing;

  update sellerpilot_private.kakao_oauth_callback_attempts
     set status = 'connected',
         staged_token_vault_id = null,
         authorization_code_vault_id = null,
         integration_id = v_integration_id,
         kakao_user_id = trim(p_kakao_user_id),
         nickname = left(coalesce(p_nickname, ''), 160),
         lease_expires_at = null,
         safe_error = null,
         completed_at = clock_timestamp(),
         reconciliation_required_at = null,
         updated_at = clock_timestamp()
   where id = p_attempt_id;

  if v_attempt.authorization_code_vault_id is not null then
    delete from vault.secrets where id = v_attempt.authorization_code_vault_id;
  end if;
  if v_old_vault_id is not null and v_old_vault_id <> v_attempt.staged_token_vault_id then
    delete from vault.secrets where id = v_old_vault_id;
  end if;
  return v_integration_id;
end;
$$;

alter table sellerpilot_private.kakao_notification_deliveries
  add column if not exists is_manual_test boolean not null default false,
  add column if not exists test_request_id uuid,
  add column if not exists credential_refresh_started_at timestamptz,
  add column if not exists credential_refresh_completed_at timestamptz,
  add column if not exists credential_refresh_fingerprint text;

alter table sellerpilot_private.kakao_notification_deliveries
  drop constraint if exists kakao_notification_deliveries_manual_test_check;
alter table sellerpilot_private.kakao_notification_deliveries
  add constraint kakao_notification_deliveries_manual_test_check check (
    (
      (
        not is_manual_test
        and test_request_id is null
      ) or (
        is_manual_test
        and event_type = 'test'
        and test_request_id is not null
      )
    )
    and (
      credential_refresh_fingerprint is null
      or credential_refresh_fingerprint ~ '^[a-f0-9]{64}$'
    )
    and (
      credential_refresh_completed_at is null
      or (
        credential_refresh_started_at is not null
        and credential_refresh_fingerprint is not null
      )
    )
  );

create unique index if not exists kakao_manual_test_request_idx
  on sellerpilot_private.kakao_notification_deliveries (owner_id, test_request_id)
  where is_manual_test;

-- A Kakao integration has a rotating refresh token. Older workers retain the
-- credential snapshot returned with their claim, so two live deliveries for
-- the same owner could otherwise rotate or use that credential concurrently.
-- Treat active rows left by the pre-fence implementation as ambiguous before
-- installing the database-enforced one-active-delivery invariant.
with conflicting_owners as (
  select d.owner_id
    from sellerpilot_private.kakao_notification_deliveries d
   where d.status in ('preparing', 'sending')
   group by d.owner_id
  having count(*) > 1
)
update sellerpilot_private.kakao_notification_deliveries d
   set status = 'reconciliation_required',
       last_error = 'KAKAO_CONCURRENT_OWNER_DELIVERY_OUTCOME_UNKNOWN',
       lease_expires_at = null,
       completed_at = null,
       reconciliation_required_at = clock_timestamp(),
       updated_at = clock_timestamp()
 where d.status in ('preparing', 'sending')
   and exists (
     select 1
       from conflicting_owners c
      where c.owner_id = d.owner_id
   );

create unique index if not exists kakao_notification_one_active_delivery_owner_idx
  on sellerpilot_private.kakao_notification_deliveries (owner_id)
  where status in ('preparing', 'sending');
create unique index if not exists kakao_notification_one_unresolved_refresh_owner_idx
  on sellerpilot_private.kakao_notification_deliveries (owner_id)
  where credential_refresh_started_at is not null
    and credential_refresh_completed_at is null
    and status in ('preparing', 'reconciliation_required');
drop index if exists sellerpilot_private.kakao_manual_test_one_unresolved_owner_idx;
create index if not exists kakao_manual_test_unresolved_owner_idx
  on sellerpilot_private.kakao_notification_deliveries (owner_id)
  where is_manual_test
    and status in ('preparing', 'sending', 'reconciliation_required');

create or replace function public.sellerpilot_service_sweep_stale_kakao_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
  v_step integer := 0;
begin
  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'reconciliation_required',
         last_error = 'KAKAO_REFRESH_OUTCOME_UNKNOWN',
         lease_expires_at = null,
         completed_at = null,
         reconciliation_required_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where d.status = 'preparing'
     and d.credential_refresh_started_at is not null
     and d.credential_refresh_completed_at is null
     and d.lease_expires_at is not null
     and d.lease_expires_at <= clock_timestamp();
  get diagnostics v_step = row_count;
  v_updated := v_updated + v_step;

  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'failed',
         last_error = coalesce(d.last_error, 'KAKAO_TEST_PREPARATION_EXPIRED'),
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where d.is_manual_test
     and d.status = 'preparing'
     and d.lease_expires_at is not null
     and d.lease_expires_at <= clock_timestamp()
     and (
       d.credential_refresh_started_at is null
       or d.credential_refresh_completed_at is not null
     );
  get diagnostics v_step = row_count;
  v_updated := v_updated + v_step;

  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'reconciliation_required',
         last_error = case
           when d.is_manual_test then 'KAKAO_TEST_SEND_OUTCOME_UNKNOWN'
           else 'KAKAO_SEND_COMPLETION_LOST_OR_PROCESS_INTERRUPTED'
         end,
         lease_expires_at = null,
         completed_at = null,
         reconciliation_required_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where d.status = 'sending'
     and (
       (d.lease_expires_at is not null and d.lease_expires_at <= clock_timestamp())
       or (
         d.lease_expires_at is null
         and d.send_started_at is not null
         and d.send_started_at <= clock_timestamp() - interval '3 minutes'
       )
     );
  get diagnostics v_step = row_count;
  v_updated := v_updated + v_step;

  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'reconciliation_required',
         last_error = 'KAKAO_LEGACY_DELIVERY_OUTCOME_UNKNOWN',
         lease_expires_at = null,
         completed_at = null,
         reconciliation_required_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where d.status = 'pending'
     and d.legacy_completion_eligible_until is not null
     and d.legacy_completion_eligible_until <= clock_timestamp();
  get diagnostics v_step = row_count;
  v_updated := v_updated + v_step;

  return v_updated;
end;
$$;

create or replace function public.sellerpilot_service_claim_kakao_notifications(
  p_limit integer,
  p_lease_seconds integer
)
returns table (
  id uuid,
  owner_id uuid,
  event_type text,
  title text,
  body text,
  link_path text,
  secret_payload jsonb,
  expires_at timestamptz,
  kakao_user_id text,
  nickname text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sellerpilot_service_sweep_stale_kakao_notifications();

  update sellerpilot_private.kakao_notification_deliveries d
     set status = 'failed',
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         last_error = coalesce(d.last_error, 'KAKAO_PREPARATION_LEASE_EXHAUSTED'),
         updated_at = clock_timestamp()
   where not d.is_manual_test
     and d.status = 'preparing'
     and d.attempt_count >= 3
     and d.lease_expires_at is not null
     and d.lease_expires_at <= clock_timestamp();

  return query
  with owner_candidates as materialized (
    select k.owner_id
      from sellerpilot_private.kakao_integrations k
     where k.status = 'active'
       and exists (
         select 1
           from vault.decrypted_secrets s
          where s.id = k.vault_secret_id
       )
       and not exists (
         select 1
           from sellerpilot_private.kakao_notification_deliveries blocked
          where blocked.owner_id = k.owner_id
            and blocked.status in ('preparing', 'reconciliation_required')
            and blocked.credential_refresh_started_at is not null
            and blocked.credential_refresh_completed_at is null
       )
       and not exists (
         select 1
           from sellerpilot_private.kakao_notification_deliveries active_delivery
          where active_delivery.owner_id = k.owner_id
            and (
              active_delivery.status = 'sending'
              or (
                active_delivery.status = 'preparing'
                and active_delivery.lease_expires_at > clock_timestamp()
              )
            )
       )
       and exists (
         select 1
           from sellerpilot_private.kakao_notification_deliveries eligible
          where eligible.owner_id = k.owner_id
            and not eligible.is_manual_test
            and eligible.attempt_count < 3
            and (
              eligible.legacy_completion_eligible_until is null
              or eligible.legacy_completion_eligible_until <= clock_timestamp()
            )
            and (
              (eligible.status = 'pending' and eligible.available_at <= clock_timestamp())
              or (
                eligible.status = 'preparing'
                and eligible.lease_expires_at is not null
                and eligible.lease_expires_at <= clock_timestamp()
              )
            )
       )
     order by (
       select min(coalesce(eligible.available_at, eligible.created_at))
         from sellerpilot_private.kakao_notification_deliveries eligible
        where eligible.owner_id = k.owner_id
          and not eligible.is_manual_test
          and eligible.attempt_count < 3
          and (
            (eligible.status = 'pending' and eligible.available_at <= clock_timestamp())
            or (
              eligible.status = 'preparing'
              and eligible.lease_expires_at is not null
              and eligible.lease_expires_at <= clock_timestamp()
            )
          )
     ), k.owner_id
     limit greatest(1, least(coalesce(p_limit, 50), 100))
     for update of k skip locked
  ), candidates as materialized (
    select (
      select d.id
        from sellerpilot_private.kakao_notification_deliveries d
       where d.owner_id = o.owner_id
         and not d.is_manual_test
         and d.attempt_count < 3
         and (
           d.legacy_completion_eligible_until is null
           or d.legacy_completion_eligible_until <= clock_timestamp()
         )
         and (
           (d.status = 'pending' and d.available_at <= clock_timestamp())
           or (
             d.status = 'preparing'
             and d.lease_expires_at is not null
             and d.lease_expires_at <= clock_timestamp()
           )
         )
       order by case when d.status = 'preparing' then 0 else 1 end,
                coalesce(d.available_at, d.created_at),
                d.created_at,
                d.id
       limit 1
       for update of d skip locked
    ) as id
      from owner_candidates o
  ), claimed as (
    update sellerpilot_private.kakao_notification_deliveries d
       set status = 'preparing',
           claim_token = gen_random_uuid(),
           claimed_at = clock_timestamp(),
           attempt_count = least(d.attempt_count + 1, 10),
           lease_expires_at = clock_timestamp()
             + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900))),
           send_started_at = null,
           reconciliation_required_at = null,
           updated_at = clock_timestamp()
      from candidates c
     where c.id is not null
       and d.id = c.id
    returning d.id, d.owner_id, d.event_type, d.title, d.body, d.link_path, d.claim_token
  )
  select c.id,
         c.owner_id,
         c.event_type,
         c.title,
         c.body,
         c.link_path,
         s.decrypted_secret::jsonb,
         k.expires_at,
         k.kakao_user_id,
         k.nickname,
         c.claim_token
    from claimed c
    join sellerpilot_private.kakao_integrations k
      on k.owner_id = c.owner_id
     and k.status = 'active'
    join vault.decrypted_secrets s
      on s.id = k.vault_secret_id
   order by c.id;
end;
$$;

create or replace function public.sellerpilot_service_claim_kakao_test_delivery(
  p_owner_id uuid,
  p_request_id uuid,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery sellerpilot_private.kakao_notification_deliveries%rowtype;
  v_integration sellerpilot_private.kakao_integrations%rowtype;
  v_claim_token uuid;
  v_secret jsonb;
begin
  if p_owner_id is null
     or p_request_id is null
     or not exists (
       select 1 from sellerpilot_private.admin_users a where a.user_id = p_owner_id
     ) then
    raise exception 'invalid Kakao test delivery claim';
  end if;
  perform public.sellerpilot_service_sweep_stale_kakao_notifications();

  select d.* into v_delivery
    from sellerpilot_private.kakao_notification_deliveries d
   where d.owner_id = p_owner_id
     and d.is_manual_test
     and d.test_request_id = p_request_id;
  if found then
    if v_delivery.status in ('sent', 'failed', 'reconciliation_required') then
      return jsonb_build_object(
        'status', v_delivery.status,
        'deliveryId', v_delivery.id,
        'terminal', true,
        'safeError', v_delivery.last_error
      );
    end if;
    if v_delivery.status = 'sending'
       or (
         v_delivery.status = 'preparing'
         and v_delivery.lease_expires_at is not null
         and v_delivery.lease_expires_at > clock_timestamp()
         and v_delivery.claim_token is not null
       ) then
      return jsonb_build_object(
        'status', 'in_progress',
        'deliveryId', v_delivery.id,
        'terminal', false
      );
    end if;
    if v_delivery.status <> 'preparing' then
      return jsonb_build_object('status', 'invalid_state');
    end if;
  end if;

  -- The integration row is the per-owner mutex shared with the periodic
  -- claimant. Re-read the request after taking it: another invocation may
  -- have completed this exact request while this transaction was waiting.
  select k.* into v_integration
    from sellerpilot_private.kakao_integrations k
   where k.owner_id = p_owner_id
     and k.status = 'active'
   for update;
  if not found then
    select d.* into v_delivery
      from sellerpilot_private.kakao_notification_deliveries d
     where d.owner_id = p_owner_id
       and d.is_manual_test
       and d.test_request_id = p_request_id;
    if found and v_delivery.status in ('sent', 'failed', 'reconciliation_required') then
      return jsonb_build_object(
        'status', v_delivery.status,
        'deliveryId', v_delivery.id,
        'terminal', true,
        'safeError', v_delivery.last_error
      );
    end if;
    return jsonb_build_object('status', 'not_connected');
  end if;

  select d.* into v_delivery
    from sellerpilot_private.kakao_notification_deliveries d
   where d.owner_id = p_owner_id
     and d.is_manual_test
     and d.test_request_id = p_request_id
   for update;
  if found then
    if v_delivery.status in ('sent', 'failed', 'reconciliation_required') then
      return jsonb_build_object(
        'status', v_delivery.status,
        'deliveryId', v_delivery.id,
        'terminal', true,
        'safeError', v_delivery.last_error
      );
    end if;
    if v_delivery.status = 'sending'
       or (
         v_delivery.status = 'preparing'
         and v_delivery.lease_expires_at is not null
         and v_delivery.lease_expires_at > clock_timestamp()
         and v_delivery.claim_token is not null
       ) then
      return jsonb_build_object(
        'status', 'in_progress',
        'deliveryId', v_delivery.id,
        'terminal', false
      );
    end if;
    if v_delivery.status <> 'preparing' then
      return jsonb_build_object('status', 'invalid_state');
    end if;

    if exists (
      select 1
        from sellerpilot_private.kakao_notification_deliveries active_delivery
       where active_delivery.owner_id = p_owner_id
         and active_delivery.id <> v_delivery.id
         and active_delivery.status in ('preparing', 'sending')
    ) then
      return jsonb_build_object(
        'status', 'in_progress',
        'deliveryId', v_delivery.id,
        'terminal', false,
        'requestConflict', true
      );
    end if;

    v_claim_token := gen_random_uuid();
    update sellerpilot_private.kakao_notification_deliveries
       set claim_token = v_claim_token,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp()
             + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 180), 600))),
           attempt_count = least(attempt_count + 1, 10),
           updated_at = clock_timestamp()
     where id = v_delivery.id;
  else
    select d.* into v_delivery
      from sellerpilot_private.kakao_notification_deliveries d
     where d.owner_id = p_owner_id
       and d.status = 'reconciliation_required'
       and d.credential_refresh_started_at is not null
       and d.credential_refresh_completed_at is null
     order by d.created_at
     for update
     limit 1;
    if found then
      return jsonb_build_object(
        'status', 'reconciliation_required',
        'deliveryId', v_delivery.id,
        'terminal', true,
        'requestConflict', true,
        'safeError', coalesce(v_delivery.last_error, 'KAKAO_REFRESH_OUTCOME_UNKNOWN')
      );
    end if;

    select d.* into v_delivery
      from sellerpilot_private.kakao_notification_deliveries d
     where d.owner_id = p_owner_id
       and d.status in ('preparing', 'sending')
     order by d.created_at, d.id
     for update
     limit 1;
    if found then
      return jsonb_build_object(
        'status', 'in_progress',
        'deliveryId', v_delivery.id,
        'terminal', false,
        'requestConflict', true
      );
    end if;

    select d.* into v_delivery
      from sellerpilot_private.kakao_notification_deliveries d
     where d.owner_id = p_owner_id
       and d.is_manual_test
       and d.status = 'reconciliation_required'
     order by d.created_at
     for update
     limit 1;
    if found then
      return jsonb_build_object(
        'status', v_delivery.status,
        'deliveryId', v_delivery.id,
        'terminal', true,
        'requestConflict', true,
        'safeError', v_delivery.last_error
      );
    end if;
    v_claim_token := gen_random_uuid();
    insert into sellerpilot_private.kakao_notification_deliveries (
      owner_id,
      event_key,
      event_type,
      title,
      body,
      link_path,
      status,
      attempt_count,
      available_at,
      claim_token,
      claimed_at,
      lease_expires_at,
      is_manual_test,
      test_request_id
    ) values (
      p_owner_id,
      'manual_test:' || p_request_id::text,
      'test',
      'SellerPilot 카카오 알림 테스트',
      '가입한 사용자 본인의 ‘나와의 채팅’ 연결이 정상입니다.',
      '/?view=notifications',
      'preparing',
      1,
      clock_timestamp(),
      v_claim_token,
      clock_timestamp(),
      clock_timestamp()
        + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 180), 600))),
      true,
      p_request_id
    ) returning * into v_delivery;
  end if;

  select s.decrypted_secret::jsonb into v_secret
    from vault.decrypted_secrets s
   where s.id = v_integration.vault_secret_id;
  if v_secret is null then
    update sellerpilot_private.kakao_notification_deliveries
       set status = 'failed',
           last_error = 'KAKAO_CREDENTIAL_VAULT_UNAVAILABLE',
           lease_expires_at = null,
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_delivery.id
       and claim_token = v_claim_token
       and status = 'preparing';
    return jsonb_build_object(
      'status', 'failed',
      'deliveryId', v_delivery.id,
      'terminal', true,
      'safeError', 'KAKAO_CREDENTIAL_VAULT_UNAVAILABLE'
    );
  end if;
  return jsonb_build_object(
    'status', 'claimed',
    'deliveryId', v_delivery.id,
    'claimToken', v_claim_token,
    'secret', v_secret,
    'expiresAt', v_integration.expires_at,
    'kakaoUserId', v_integration.kakao_user_id,
    'nickname', v_integration.nickname,
    'refreshCompleted', v_delivery.credential_refresh_completed_at is not null
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_kakao_notification_refresh(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update sellerpilot_private.kakao_notification_deliveries
     set credential_refresh_started_at = clock_timestamp(),
         lease_expires_at = greatest(
           lease_expires_at,
           clock_timestamp() + interval '3 minutes'
         ),
         updated_at = clock_timestamp()
   where id = p_delivery_id
     and status = 'preparing'
     and claim_token = p_claim_token
     and lease_expires_at > clock_timestamp()
     and credential_refresh_started_at is null
     and credential_refresh_completed_at is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sellerpilot_service_stage_kakao_notification_refresh(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery sellerpilot_private.kakao_notification_deliveries%rowtype;
  v_integration sellerpilot_private.kakao_integrations%rowtype;
  v_fingerprint text;
  v_vault_id uuid;
begin
  if jsonb_typeof(p_secret_payload) <> 'object'
     or length(coalesce(p_secret_payload->>'access_token', '')) < 8
     or octet_length(p_secret_payload::text) > 32000
     or p_expires_at is null
     or p_expires_at <= clock_timestamp() then
    raise exception 'invalid Kakao notification refresh stage';
  end if;
  v_fingerprint := encode(
    extensions.digest(p_secret_payload::text, 'sha256'),
    'hex'
  );
  select d.* into v_delivery
    from sellerpilot_private.kakao_notification_deliveries d
   where d.id = p_delivery_id
     and d.claim_token = p_claim_token
   for update;
  if not found then return false; end if;
  if v_delivery.credential_refresh_completed_at is not null then
    return v_delivery.credential_refresh_fingerprint = v_fingerprint;
  end if;
  if v_delivery.status <> 'preparing'
     or v_delivery.credential_refresh_started_at is null
     or v_delivery.lease_expires_at is null
     or v_delivery.lease_expires_at <= clock_timestamp() then
    return false;
  end if;

  select k.* into v_integration
    from sellerpilot_private.kakao_integrations k
   where k.owner_id = v_delivery.owner_id
     and k.status = 'active'
   for update;
  if not found then return false; end if;
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_kakao_refresh_%s_%s', p_delivery_id, gen_random_uuid()),
    'Kakao token rotated by a claim-bound notification delivery'
  ) into v_vault_id;
  update sellerpilot_private.kakao_integrations
     set vault_secret_id = v_vault_id,
         expires_at = p_expires_at,
         updated_at = clock_timestamp()
   where id = v_integration.id;
  update sellerpilot_private.kakao_notification_deliveries
     set credential_refresh_completed_at = clock_timestamp(),
         credential_refresh_fingerprint = v_fingerprint,
         lease_expires_at = greatest(
           lease_expires_at,
           clock_timestamp() + interval '3 minutes'
         ),
         updated_at = clock_timestamp()
   where id = p_delivery_id;
  if v_integration.vault_secret_id <> v_vault_id then
    delete from vault.secrets where id = v_integration.vault_secret_id;
  end if;
  return true;
end;
$$;

create or replace function public.sellerpilot_service_finish_kakao_notification_preparation(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_outcome not in ('failed', 'reconciliation_required')
     or length(coalesce(p_error, '')) not between 1 and 160 then
    raise exception 'invalid Kakao notification preparation outcome';
  end if;
  update sellerpilot_private.kakao_notification_deliveries
     set status = p_outcome,
         last_error = left(p_error, 160),
         lease_expires_at = null,
         completed_at = case when p_outcome = 'failed' then clock_timestamp() else null end,
         reconciliation_required_at = case
           when p_outcome = 'reconciliation_required' then clock_timestamp()
           else null
         end,
         updated_at = clock_timestamp()
   where id = p_delivery_id
     and status = 'preparing'
     and claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then return true; end if;
  return exists (
    select 1
      from sellerpilot_private.kakao_notification_deliveries d
     where d.id = p_delivery_id
       and d.claim_token = p_claim_token
       and d.status = p_outcome
       and d.last_error = left(p_error, 160)
  );
end;
$$;

revoke all on function public.sellerpilot_service_sweep_kakao_oauth_callbacks()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_register_kakao_oauth_state(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_kakao_oauth_callback(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_kakao_oauth_exchange(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_stage_kakao_oauth_token(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_get_claimed_kakao_oauth_token(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_release_kakao_oauth_claim(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_finish_kakao_oauth_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_complete_kakao_oauth_connection(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_claim_kakao_test_delivery(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_begin_kakao_notification_refresh(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_stage_kakao_notification_refresh(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_finish_kakao_notification_preparation(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.sellerpilot_service_sweep_kakao_oauth_callbacks()
  to service_role;
grant execute on function public.sellerpilot_service_register_kakao_oauth_state(uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.sellerpilot_service_claim_kakao_oauth_callback(uuid, uuid, text, text, integer)
  to service_role;
grant execute on function public.sellerpilot_service_begin_kakao_oauth_exchange(uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_stage_kakao_oauth_token(uuid, uuid, jsonb, timestamptz)
  to service_role;
grant execute on function public.sellerpilot_service_get_claimed_kakao_oauth_token(uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_release_kakao_oauth_claim(uuid, uuid, text)
  to service_role;
grant execute on function public.sellerpilot_service_finish_kakao_oauth_attempt(uuid, uuid, text, text)
  to service_role;
grant execute on function public.sellerpilot_service_complete_kakao_oauth_connection(uuid, uuid, text, text)
  to service_role;
grant execute on function public.sellerpilot_service_claim_kakao_test_delivery(uuid, uuid, integer)
  to service_role;
grant execute on function public.sellerpilot_service_begin_kakao_notification_refresh(uuid, uuid)
  to service_role;
grant execute on function public.sellerpilot_service_stage_kakao_notification_refresh(uuid, uuid, jsonb, timestamptz)
  to service_role;
grant execute on function public.sellerpilot_service_finish_kakao_notification_preparation(uuid, uuid, text, text)
  to service_role;

commit;
