-- SellerPilot Lazada token refresh worker support.
-- Only the service role can rotate refreshed OAuth tokens; browser clients never receive token plaintext.

begin;

alter table sellerpilot_private.credential_audit
  drop constraint if exists credential_audit_action_check;

alter table sellerpilot_private.credential_audit
  add constraint credential_audit_action_check
  check (action in ('created', 'rotated', 'schedule_updated', 'tested', 'revoked', 'restored', 'token_refreshed'));

create or replace function public.sellerpilot_service_refresh_lazada(
  p_credential_id uuid,
  p_secret_payload jsonb,
  p_expires_at timestamptz
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
  v_environment text;
  v_created_by uuid;
  v_fingerprint text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_secret_payload) <> 'object'
     or length(coalesce(p_secret_payload->>'access_token', '')) < 8
     or length(coalesce(p_secret_payload->>'refresh_token', '')) < 8
     or octet_length(p_secret_payload::text) > 32000
     or p_expires_at is null
     or p_expires_at <= now() then
    raise exception 'invalid refreshed credential';
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'lazada'
     and c.status = 'active'
   for update;
  if not found then raise exception 'active Lazada credential not found'; end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:lazada:' || v_environment));
  select coalesce(max(c.version), 0) + 1
    into v_version
    from sellerpilot_private.channel_credentials c
   where c.channel = 'lazada' and c.environment = v_environment;

  v_fingerprint := upper(substr(encode(digest(p_secret_payload::text, 'sha256'), 'hex'), 1, 12));
  select vault.create_secret(
    p_secret_payload::text,
    format('sellerpilot_lazada_%s_v%s_%s', v_environment, v_version, v_id),
    'SellerPilot refreshed Lazada OAuth credential. Never expose to browser or logs.'
  ) into v_vault_id;

  update sellerpilot_private.channel_credentials
     set status = 'revoked', grace_ends_at = now()
   where id = p_credential_id;

  insert into sellerpilot_private.channel_credentials (
    id, channel, environment, version, vault_secret_id, fingerprint, status,
    expires_at, rotation_interval_days, warning_days, last_rotated_at, created_by
  )
  select v_id, 'lazada', v_environment, v_version, v_vault_id, v_fingerprint, 'active',
         p_expires_at, c.rotation_interval_days, c.warning_days, now(), v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id;

  insert into sellerpilot_private.credential_audit (
    credential_id, channel, environment, action, actor_user_id, safe_detail
  ) values (
    v_id, 'lazada', v_environment, 'token_refreshed', null,
    jsonb_build_object('version', v_version, 'fingerprint', v_fingerprint, 'expires_at', p_expires_at, 'source', 'vercel_cron')
  );
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_service_refresh_lazada(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_refresh_lazada(uuid, jsonb, timestamptz) to service_role;

commit;
