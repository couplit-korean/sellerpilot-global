-- Preserve the credential version observed by the exact provider read. Joining
-- the current credential row at read time cannot prove when a cache row was
-- verified, and must not turn an old cache into current evidence.

begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_market_targets') is null
     or to_regprocedure('public.sellerpilot_list_channel_market_targets_v2(text)') is null
     or to_regprocedure('public.sellerpilot_service_upsert_shopee_market_target_v2(uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamp with time zone)') is null then
    raise exception 'SHOPEE_EXACT_TARGET_V2_PREIMAGE_REQUIRED';
  end if;
end $$;

alter table sellerpilot_private.channel_market_targets
  add column credential_version integer;
alter table sellerpilot_private.channel_market_targets
  add constraint channel_market_targets_credential_version_positive
  check (credential_version is null or credential_version > 0);

create or replace function public.sellerpilot_list_channel_market_targets_v2(p_channel text)
returns table (
  target_id text,
  display_name text,
  market_code text,
  locale text,
  language text,
  currency text,
  remote_status text,
  verified_at timestamptz,
  credential_id uuid,
  credential_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.target_id, t.display_name, t.market_code, t.locale, t.language,
         t.currency, t.remote_status, t.verified_at, t.credential_id,
         t.credential_version
    from sellerpilot_private.channel_market_targets t
    join sellerpilot_private.channel_credentials c on c.id = t.credential_id
   where public.sellerpilot_is_admin()
     and t.channel = p_channel
     and t.environment = 'production'
     and p_channel in ('shopee', 'lazada')
   order by t.market_code, t.display_name, t.target_id
$$;

alter function public.sellerpilot_service_upsert_shopee_market_target_v2(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) rename to sellerpilot_60909204000_upsert_shopee_target_v2_unsafe;

create function public.sellerpilot_service_upsert_shopee_market_target_v2(
  p_owner_id uuid,
  p_expected_credential_id uuid,
  p_expected_credential_version integer,
  p_target_id text,
  p_display_name text,
  p_market_code text,
  p_locale text,
  p_language text,
  p_currency text,
  p_remote_status text,
  p_provider_subject text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt jsonb;
  v_target_record_id uuid;
  v_updated integer;
begin
  v_receipt := public.sellerpilot_60909204000_upsert_shopee_target_v2_unsafe(
    p_owner_id,p_expected_credential_id,p_expected_credential_version,
    p_target_id,p_display_name,p_market_code,p_locale,p_language,p_currency,
    p_remote_status,p_provider_subject,p_observed_at
  );
  begin
    v_target_record_id := (v_receipt->>'targetRecordId')::uuid;
  exception when invalid_text_representation then
    raise exception 'SHOPEE_EXACT_TARGET_RECEIPT_INVALID' using errcode = '22023';
  end;
  if v_receipt->>'contractVersion' is distinct from '2'
     or v_receipt->>'credentialId' is distinct from p_expected_credential_id::text
     or (v_receipt->>'credentialVersion')::integer is distinct from p_expected_credential_version
     or v_receipt->>'targetId' is distinct from pg_catalog.btrim(p_target_id)
     or v_receipt->>'marketCode' is distinct from 'SG' then
    raise exception 'SHOPEE_EXACT_TARGET_RECEIPT_INVALID' using errcode = '22023';
  end if;
  update sellerpilot_private.channel_market_targets t
     set credential_version = p_expected_credential_version
   where t.id = v_target_record_id
     and t.owner_id = p_owner_id
     and t.credential_id = p_expected_credential_id
     and t.channel = 'shopee'
     and t.environment = 'production'
     and t.target_id = pg_catalog.btrim(p_target_id)
     and t.market_code = 'SG';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'SHOPEE_EXACT_TARGET_RECEIPT_STORE_FAILED' using errcode = '40001';
  end if;
  return v_receipt;
end;
$$;

revoke all on function public.sellerpilot_60909204000_upsert_shopee_target_v2_unsafe(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_upsert_shopee_market_target_v2(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_upsert_shopee_market_target_v2(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,timestamptz
) to service_role;
revoke all on function public.sellerpilot_list_channel_market_targets_v2(text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_list_channel_market_targets_v2(text)
  to authenticated;

commit;
