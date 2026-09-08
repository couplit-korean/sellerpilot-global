begin;

do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.sellerpilot_read_ebay_case_dispute_history_v2(uuid,text,timestamptz,bigint,integer)'
  ) is not null then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_READ_V2_SOURCE_DRIFT';
  end if;
  if pg_catalog.to_regclass('sellerpilot_private.ebay_case_dispute_history_events') is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_record_ebay_case_dispute_history_v1(uuid,text,text,text,text,timestamptz,jsonb)'
     ) is null then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_READ_V1_REQUIRED';
  end if;
end
$migration$;

create function public.sellerpilot_read_ebay_case_dispute_history_v2(
  p_credential_id uuid,
  p_resource_kind text default null,
  p_before_observed_at timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid := auth.uid();
  v_events jsonb;
  v_candidate_count integer;
  v_next_observed_at timestamptz;
  v_next_id bigint;
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
  if (p_before_observed_at is null) <> (p_before_id is null) or p_before_id is not null and p_before_id < 1 then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_CURSOR_INVALID';
  end if;
  if not exists (
    select 1 from sellerpilot_private.channel_credentials credential
     where credential.id = p_credential_id
       and credential.created_by = v_owner
       and credential.channel = 'ebay'
  ) then
    raise exception 'EBAY_CASE_DISPUTE_HISTORY_ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  select pg_catalog.count(*)::integer into v_candidate_count
  from (
    select source.id
      from sellerpilot_private.ebay_case_dispute_history_events source
     where source.owner_user_id = v_owner
       and source.credential_id = p_credential_id
       and (p_resource_kind is null or source.resource_kind = p_resource_kind)
       and (p_before_observed_at is null or (source.observed_at,source.id) < (p_before_observed_at,p_before_id))
     order by source.observed_at desc,source.id desc
     limit p_limit + 1
  ) candidate;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId',event.id::text,
    'resourceKind',event.resource_kind,
    'providerNativeId',event.provider_native_id,
    'providerStatus',event.provider_status,
    'providerUpdatedAt',event.provider_updated_at,
    'normalized',event.normalized_safe,
    'observedStateSha256',event.observed_state_sha256,
    'observedAt',event.observed_at
  ) order by event.observed_at desc,event.id desc),'[]'::jsonb)
  into v_events
  from (
    select source.*
      from sellerpilot_private.ebay_case_dispute_history_events source
     where source.owner_user_id = v_owner
       and source.credential_id = p_credential_id
       and (p_resource_kind is null or source.resource_kind = p_resource_kind)
       and (p_before_observed_at is null or (source.observed_at,source.id) < (p_before_observed_at,p_before_id))
     order by source.observed_at desc,source.id desc
     limit p_limit
  ) event;

  if v_candidate_count > p_limit then
    select source.observed_at,source.id into v_next_observed_at,v_next_id
      from sellerpilot_private.ebay_case_dispute_history_events source
     where source.owner_user_id = v_owner
       and source.credential_id = p_credential_id
       and (p_resource_kind is null or source.resource_kind = p_resource_kind)
       and (p_before_observed_at is null or (source.observed_at,source.id) < (p_before_observed_at,p_before_id))
     order by source.observed_at desc,source.id desc
     offset p_limit - 1 limit 1;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract','sellerpilot-ebay-case-dispute-history/2',
    'credentialId',p_credential_id,
    'resourceKind',p_resource_kind,
    'events',v_events,
    'nextBeforeObservedAt',v_next_observed_at,
    'nextBeforeId',case when v_next_id is null then null else v_next_id::text end
  );
end
$function$;

revoke all on function public.sellerpilot_read_ebay_case_dispute_history_v2(uuid,text,timestamptz,bigint,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_ebay_case_dispute_history_v2(uuid,text,timestamptz,bigint,integer)
  to authenticated;

comment on function public.sellerpilot_read_ebay_case_dispute_history_v2(uuid,text,timestamptz,bigint,integer) is
  'Owner-admin read of safe eBay case/dispute history with a stable observed_at plus id cursor.';

commit;
