-- Add OpenAI to SellerPilot's Vault-backed credential lifecycle.
-- Existing channel secrets and audit rows are preserved.

begin;

alter table sellerpilot_private.channel_credentials
  drop constraint if exists channel_credentials_channel_check;

alter table sellerpilot_private.channel_credentials
  add constraint channel_credentials_channel_check
  check (channel in ('qoo10', 'shopee', 'lazada', 'openai'));

create or replace function public.sellerpilot_rotate_credential(
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
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare
  v_id uuid := gen_random_uuid();
  v_vault_id uuid;
  v_version integer;
  v_previous_id uuid;
  v_now timestamptz := now();
  v_fingerprint text;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'openai') then
    raise exception 'unsupported channel';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'unsupported environment';
  end if;
  if p_rotation_interval_days not between 1 and 365 or p_warning_days not between 1 and 180 or p_grace_days not between 0 and 30 then
    raise exception 'invalid rotation schedule';
  end if;
  if jsonb_typeof(p_secret_payload) <> 'object' or p_secret_payload = '{}'::jsonb or length(p_secret_payload::text) > 32000 then
    raise exception 'invalid secret payload';
  end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:' || p_channel || ':' || p_environment));
  select c.id into v_previous_id
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment and c.status = 'active'
   for update;

  select coalesce(max(c.version), 0) + 1 into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = p_channel and c.environment = p_environment;

  v_fingerprint := upper(substr(encode(digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_%s_%s_v%s_%s', p_channel, p_environment, v_version, v_id),
    'SellerPilot credential. Never expose to browser or logs.'
  ) into v_vault_id;

  if v_previous_id is not null then
    update sellerpilot_private.channel_credentials
       set status = case when p_grace_days = 0 then 'revoked' else 'grace' end,
           grace_ends_at = case when p_grace_days = 0 then v_now else v_now + make_interval(days => p_grace_days) end
     where id = v_previous_id;
  end if;

  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, expires_at,
    rotation_interval_days, warning_days, last_rotated_at, created_by
  ) values (
    v_id, p_channel, p_environment, v_version, v_vault_id, v_fingerprint,
    p_expires_at, p_rotation_interval_days, p_warning_days, v_now, auth.uid()
  );

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, p_channel, p_environment,
    case when v_previous_id is null then 'created' else 'rotated' end,
    auth.uid(),
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint, 'expires_at', p_expires_at, 'grace_days', p_grace_days)
  );
  return v_id;
end;
$$;

create or replace function public.sellerpilot_decrypt_credential(p_credential_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare
  v_secret text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select d.decrypted_secret into v_secret
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.id = p_credential_id and c.status in ('active', 'grace');
  if v_secret is null then raise exception 'credential not available'; end if;
  return v_secret::jsonb;
end;
$$;

create or replace function public.sellerpilot_record_credential_test(
  p_credential_id uuid,
  p_status text,
  p_safe_message text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_channel text;
  v_environment text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_status not in ('passed', 'failed', 'manual') then raise exception 'invalid test status'; end if;
  update sellerpilot_private.channel_credentials
     set last_checked_at = now(), last_check_status = p_status, last_check_message = left(p_safe_message, 500)
   where id = p_credential_id
   returning channel, environment into v_channel, v_environment;
  if not found then raise exception 'credential not found'; end if;
  insert into sellerpilot_private.credential_audit (credential_id, channel, environment, action, safe_detail)
  values (p_credential_id, v_channel, v_environment, 'tested', jsonb_build_object('status', p_status, 'message', left(p_safe_message, 500)));
end;
$$;

create or replace function public.sellerpilot_get_active_credential_secret(
  p_channel text,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private, vault
as $$
declare
  v_result jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_channel not in ('qoo10', 'shopee', 'lazada', 'openai') or p_environment not in ('sandbox', 'production') then
    raise exception 'unsupported credential selector';
  end if;

  select jsonb_build_object(
    'credential_id', c.id,
    'expires_at', c.expires_at,
    'secret_payload', d.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.channel = p_channel
     and c.environment = p_environment
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   limit 1;

  return v_result;
end;
$$;

revoke all on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) from public, anon;
revoke all on function public.sellerpilot_decrypt_credential(uuid) from public, anon, authenticated;
revoke all on function public.sellerpilot_record_credential_test(uuid, text, text) from public, anon, authenticated;
revoke all on function public.sellerpilot_get_active_credential_secret(text, text) from public, anon, authenticated;
grant execute on function public.sellerpilot_rotate_credential(text, text, jsonb, timestamptz, integer, integer, integer) to authenticated;
grant execute on function public.sellerpilot_decrypt_credential(uuid) to service_role;
grant execute on function public.sellerpilot_record_credential_test(uuid, text, text) to service_role;
grant execute on function public.sellerpilot_get_active_credential_secret(text, text) to service_role;

commit;
