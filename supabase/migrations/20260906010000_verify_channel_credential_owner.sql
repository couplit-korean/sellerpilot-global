-- Owner semantics are not inferred from an API alias:
-- sellerpilot_service_ingest_orders (20260821102500) selects c.created_by into v_owner.
-- sellerpilot_enqueue_channel_gateway_job (20260817054039) carries c.created_by
-- into channel_gateway_jobs.created_by. Target binding (20260817061650) requires
-- c.created_by = p_owner_id. This read-only proof uses that same private owner.
begin;

do $guard$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'sellerpilot_verify_channel_credential_owner_v1'
  ) then
    raise exception 'CHANNEL_CREDENTIAL_OWNER_PROOF_ALREADY_DEFINED';
  end if;
end;
$guard$;

create function public.sellerpilot_verify_channel_credential_owner_v1(
  p_credential_id uuid,
  p_channel text,
  p_environment text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $function$
declare
  v_user_id uuid := auth.uid();
  v_proof jsonb;
begin
  -- current_user is the definer here; SET ROLE remains the actual API role.
  -- A service-role or owner session must not substitute a user principal.
  if current_setting('role', true) is distinct from 'authenticated'
     or v_user_id is null
     or public.sellerpilot_is_admin() is not true then
    raise exception 'CHANNEL_CREDENTIAL_OWNER_PROOF_DENIED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'contractVersion', 1,
    'credentialId', c.id,
    'ownerId', c.created_by,
    'channel', c.channel,
    'environment', c.environment,
    'credentialVersion', c.version,
    'expiresAt', c.expires_at
  ) into v_proof
  from sellerpilot_private.channel_credentials c
  where c.id = p_credential_id
    and c.channel = p_channel
    and c.environment = p_environment
    and c.created_by = v_user_id
    and c.status = 'active'
    and c.version > 0
    and (c.expires_at is null or c.expires_at > clock_timestamp());

  if v_proof is null then
    raise exception 'CHANNEL_CREDENTIAL_OWNER_PROOF_DENIED' using errcode = '42501';
  end if;
  return v_proof;
end;
$function$;

revoke all on function public.sellerpilot_verify_channel_credential_owner_v1(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.sellerpilot_verify_channel_credential_owner_v1(uuid, text, text)
  to authenticated;
commit;
