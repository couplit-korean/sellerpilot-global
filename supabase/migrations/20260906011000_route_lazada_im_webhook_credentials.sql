-- Additive read-only lookup; deploy before the webhook code. No existing
-- global credential selector, owner binding, token, or grant is rewritten.
begin;
do $guard$
begin
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='sellerpilot_service_lazada_im_webhook_candidates_v1') then
    raise exception 'LAZADA_IM_WEBHOOK_CANDIDATES_ALREADY_DEFINED';
  end if;
end;
$guard$;

create function public.sellerpilot_service_lazada_im_webhook_candidates_v1(p_app_key text default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $function$
declare
  v_candidates jsonb;
  v_count integer;
begin
  -- Definer current_user is not the caller. ACL plus actual SET ROLE guard:
  -- JWT text alone must never grant access to these minimal signing secrets.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'LAZADA_IM_WEBHOOK_CANDIDATES_DENIED' using errcode='42501';
  end if;
  if p_app_key is not null and (length(p_app_key) not between 1 and 256 or btrim(p_app_key)<>p_app_key) then
    raise exception 'LAZADA_IM_WEBHOOK_APP_SELECTOR_INVALID' using errcode='22023';
  end if;
  with candidates as materialized (
    select c.id, d.decrypted_secret::jsonb as payload
    from sellerpilot_private.channel_credentials c
    join vault.decrypted_secrets d on d.id=c.vault_secret_id
    where c.channel='lazada' and c.environment='production' and c.status='active'
      and (c.expires_at is null or c.expires_at>statement_timestamp())
      and nullif(btrim(d.decrypted_secret::jsonb->>'im_app_key'),'') is not null
      and jsonb_typeof(d.decrypted_secret::jsonb->'im_app_key') in ('string','number')
      and jsonb_typeof(d.decrypted_secret::jsonb->'im_app_secret')='string'
      and nullif(btrim(d.decrypted_secret::jsonb->>'im_app_secret'),'') is not null
      and (p_app_key is null or btrim(d.decrypted_secret::jsonb->>'im_app_key')=p_app_key)
    order by c.id
    limit 33
  )
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object(
    'credential_id', id,
    'secret_payload', jsonb_build_object(
      'im_app_key', payload->'im_app_key', 'im_app_secret', payload->'im_app_secret',
      'country', payload->'country', 'account_platform', payload->'account_platform',
      'country_user_info', payload->'country_user_info',
      'provider_account_subject', payload->'provider_account_subject',
      'provider_account_identity_version', payload->'provider_account_identity_version'
    )
  ) order by id),'[]'::jsonb) into v_count,v_candidates from candidates;
  -- Overflow intentionally returns no partial list, even when a listed key
  -- could verify: omitted candidates might make account selection ambiguous.
  return jsonb_build_object('contract','lazada_im_webhook_candidates_v1', 'limit',32,
    'overflow',v_count>32, 'candidates',case when v_count>32 then '[]'::jsonb else v_candidates end);
end;
$function$;
revoke all on function public.sellerpilot_service_lazada_im_webhook_candidates_v1(text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_lazada_im_webhook_candidates_v1(text) to service_role;
comment on function public.sellerpilot_service_lazada_im_webhook_candidates_v1(text) is
  'Service-only bounded IM signing candidates v1. Contains secrets: never log/return to HTTP clients. No ownership attestation is synthesized. Overflow must fail closed.';
commit;
