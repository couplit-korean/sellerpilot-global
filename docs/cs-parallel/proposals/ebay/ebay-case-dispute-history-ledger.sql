begin;

do $migration$
begin
  if pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_history_events') is not null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_record_ebay_case_dispute_history_v1(uuid,text,text,text,text,timestamptz,jsonb)') is not null
     or pg_catalog.to_regprocedure('public.sellerpilot_read_ebay_case_dispute_history_v1(uuid,text,timestamptz,integer)') is not null then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_SOURCE_DRIFT';
  end if;
end
$migration$;

create table sellerpilot_private.ebay_case_dispute_history_events (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  seller_account_key text not null check (seller_account_key ~ '^[0-9a-f]{64}$'),
  environment text not null check (environment in ('production','sandbox')),
  resource_kind text not null check (resource_kind in ('resolution_case','payment_dispute')),
  provider_native_id text not null check (
    pg_catalog.length(pg_catalog.btrim(provider_native_id)) between 1 and 240
    and provider_native_id = pg_catalog.btrim(provider_native_id)
    and provider_native_id !~ '[[:cntrl:]]'
  ),
  provider_status text not null check (provider_status ~ '^[A-Z][A-Z0-9_]{0,119}$'),
  provider_updated_at timestamptz,
  normalized_safe jsonb not null check (pg_catalog.jsonb_typeof(normalized_safe) = 'object'),
  observed_state_sha256 text not null check (observed_state_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (
    owner_user_id, credential_id, environment, resource_kind,
    provider_native_id, observed_state_sha256
  )
);

alter table sellerpilot_private.ebay_case_dispute_history_events enable row level security;
revoke all on sellerpilot_private.ebay_case_dispute_history_events from public, anon, authenticated, service_role;
revoke all on sequence sellerpilot_private.ebay_case_dispute_history_events_id_seq from public, anon, authenticated, service_role;

create index ebay_case_dispute_history_owner_resource_idx
  on sellerpilot_private.ebay_case_dispute_history_events (
    owner_user_id, credential_id, resource_kind, observed_at desc, id desc
  );

create function public.sellerpilot_service_record_ebay_case_dispute_history_v1(
  p_credential_id uuid,
  p_seller_account_key text,
  p_resource_kind text,
  p_provider_native_id text,
  p_provider_status text,
  p_provider_updated_at timestamptz,
  p_normalized_safe jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_allowed_keys text[];
  v_amount_key text;
  v_state_sha256 text;
  v_event_id bigint;
  v_inserted integer := 0;
begin
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'ebay'
     and credential.status = 'active'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_key = p_seller_account_key;
  if not found or v_credential.created_by is null then
    raise exception 'EBAY_CASE_DISPUTE_CREDENTIAL_UNVERIFIED';
  end if;
  if p_resource_kind not in ('resolution_case','payment_dispute')
     or p_provider_native_id is null
     or pg_catalog.length(pg_catalog.btrim(p_provider_native_id)) not between 1 and 240
     or p_provider_native_id <> pg_catalog.btrim(p_provider_native_id)
     or p_provider_native_id ~ '[[:cntrl:]]'
     or p_provider_status is null
     or p_provider_status !~ '^[A-Z][A-Z0-9_]{0,119}$'
     or pg_catalog.jsonb_typeof(p_normalized_safe) <> 'object' then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_INVALID';
  end if;

  if p_resource_kind = 'resolution_case' then
    v_allowed_keys := array[
      'caseId','status','itemId','transactionId','creationDate','lastModifiedDate',
      'respondByDate','claimAmount','sellerBinding'
    ];
    v_amount_key := 'claimAmount';
    if p_normalized_safe->>'caseId' is distinct from p_provider_native_id
       or p_normalized_safe->>'status' is distinct from p_provider_status
       or coalesce(p_normalized_safe->>'sellerBinding','') not in ('matched','redacted') then
      raise exception 'EBAY_CASE_DISPUTE_HISTORY_IDENTITY_MISMATCH';
    end if;
  else
    v_allowed_keys := array[
      'paymentDisputeId','orderId','status','reason','openDate','respondByDate',
      'closedDate','amount','revision','sellerResponse','resolutionOutcome',
      'resolutionReason','evidenceRequestCount'
    ];
    v_amount_key := 'amount';
    if p_normalized_safe->>'paymentDisputeId' is distinct from p_provider_native_id
       or p_normalized_safe->>'status' is distinct from p_provider_status then
      raise exception 'EBAY_CASE_DISPUTE_HISTORY_IDENTITY_MISMATCH';
    end if;
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(p_normalized_safe) as key_name(value)
     where not key_name.value = any(v_allowed_keys)
  ) or coalesce(pg_catalog.jsonb_typeof(p_normalized_safe->v_amount_key),'') <> 'object'
    or exists (
      select 1
        from pg_catalog.jsonb_object_keys(p_normalized_safe->v_amount_key) as amount_key(value)
       where amount_key.value not in ('value','currency')
    )
    or coalesce(p_normalized_safe->v_amount_key->>'currency','') !~ '^[A-Z]{3}$'
    or coalesce(p_normalized_safe->v_amount_key->>'value','') !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_UNSAFE_PAYLOAD';
  end if;

  v_state_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        p_resource_kind || pg_catalog.chr(31) || p_provider_native_id || pg_catalog.chr(31)
        || p_provider_status || pg_catalog.chr(31) || p_normalized_safe::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into sellerpilot_private.ebay_case_dispute_history_events (
    owner_user_id, credential_id, seller_account_key, environment, resource_kind,
    provider_native_id, provider_status, provider_updated_at, normalized_safe,
    observed_state_sha256
  ) values (
    v_credential.created_by, v_credential.id, v_credential.seller_account_key,
    v_credential.environment, p_resource_kind, p_provider_native_id,
    p_provider_status, p_provider_updated_at, p_normalized_safe, v_state_sha256
  )
  on conflict (
    owner_user_id, credential_id, environment, resource_kind,
    provider_native_id, observed_state_sha256
  ) do nothing
  returning id into v_event_id;
  get diagnostics v_inserted = row_count;

  if v_event_id is null then
    select event.id into v_event_id
      from sellerpilot_private.ebay_case_dispute_history_events event
     where event.owner_user_id = v_credential.created_by
       and event.credential_id = v_credential.id
       and event.environment = v_credential.environment
       and event.resource_kind = p_resource_kind
       and event.provider_native_id = p_provider_native_id
       and event.observed_state_sha256 = v_state_sha256;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot-ebay-case-dispute-history-record/1',
    'eventId',v_event_id::text,
    'inserted',v_inserted = 1,
    'resourceKind',p_resource_kind,
    'providerNativeId',p_provider_native_id,
    'observedStateSha256',v_state_sha256
  );
end
$function$;

create function public.sellerpilot_read_ebay_case_dispute_history_v1(
  p_credential_id uuid,
  p_resource_kind text default null,
  p_before timestamptz default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid := auth.uid();
  v_result jsonb;
begin
  if v_owner is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_resource_kind is not null and p_resource_kind not in ('resolution_case','payment_dispute') then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_KIND_INVALID';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_LIMIT_INVALID';
  end if;
  if not exists (
    select 1 from sellerpilot_private.channel_credentials credential
     where credential.id = p_credential_id
       and credential.created_by = v_owner
       and credential.channel = 'ebay'
  ) then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  select pg_catalog.jsonb_build_object(
    'contract','sellerpilot-ebay-case-dispute-history/1',
    'credentialId',p_credential_id,
    'resourceKind',p_resource_kind,
    'events',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'eventId',event.id::text,
      'resourceKind',event.resource_kind,
      'providerNativeId',event.provider_native_id,
      'providerStatus',event.provider_status,
      'providerUpdatedAt',event.provider_updated_at,
      'normalized',event.normalized_safe,
      'observedStateSha256',event.observed_state_sha256,
      'observedAt',event.observed_at
    ) order by event.observed_at desc,event.id desc),'[]'::jsonb)
  ) into v_result
  from (
    select source.*
      from sellerpilot_private.ebay_case_dispute_history_events source
     where source.owner_user_id = v_owner
       and source.credential_id = p_credential_id
       and (p_resource_kind is null or source.resource_kind = p_resource_kind)
       and (p_before is null or source.observed_at < p_before)
     order by source.observed_at desc,source.id desc
     limit p_limit
  ) event;
  return v_result;
end
$function$;

revoke all on function public.sellerpilot_service_record_ebay_case_dispute_history_v1(uuid,text,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_ebay_case_dispute_history_v1(uuid,text,text,text,text,timestamptz,jsonb)
  to service_role;

revoke all on function public.sellerpilot_read_ebay_case_dispute_history_v1(uuid,text,timestamptz,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_ebay_case_dispute_history_v1(uuid,text,timestamptz,integer)
  to authenticated;

comment on table sellerpilot_private.ebay_case_dispute_history_events is
  'GET-only eBay resolution-case/payment-dispute safe normalized state history. Not a reply or business-action queue.';

commit;
