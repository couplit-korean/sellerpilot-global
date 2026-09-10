-- Read-only, fail-closed source-capability projection. This does not add a
-- provider endpoint or customer mutation; it projects the already canonical
-- GetInquiryMessage history for one attested Qoo10 seller account.
begin;

do $preimage$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
      or to_regclass('sellerpilot_private.support_tickets') is null
      or to_regclass('sellerpilot_private.support_inbound_messages') is null
      or to_regclass('sellerpilot_private.qoo10_history_windows') is null
      or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'QOO10_SOURCE_CAPABILITY_PREIMAGE_MISSING';
  end if;
  if to_regprocedure(
    'public.sellerpilot_read_qoo10_inquiry_source_v1(uuid)'
  ) is not null then
    raise exception 'QOO10_SOURCE_CAPABILITY_ALREADY_APPLIED';
  end if;
end
$preimage$;

create index qoo10_support_tickets_account_source_idx
  on sellerpilot_private.support_tickets(
    owner_id,seller_account_key,received_at desc,id
  )
  where channel_key='qoo10' and not demo
    and ticket_kind='conversation'
    and external_ticket_id ~ '^qoo10:conversation:[a-f0-9]{64}$';

create function public.sellerpilot_read_qoo10_inquiry_source_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_scope_state text := 'identity_unverified';
  v_ticket_count integer := 0;
  v_inbound_count integer := 0;
  v_waiting_count integer := 0;
  v_answered_count integer := 0;
  v_closed_count integer := 0;
  v_unknown_count integer := 0;
  v_last_received_at timestamptz;
  v_window_count integer := 0;
  v_queued_count integer := 0;
  v_complete_count integer := 0;
  v_refining_count integer := 0;
  v_gap_count integer := 0;
  v_verified_zero_count integer := 0;
  v_positive_complete_count integer := 0;
  v_earliest_date date;
  v_latest_date date;
  v_last_window_at timestamptz;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='qoo10'
     and credential.environment='production';
  if not found then
    raise exception 'QOO10_SOURCE_CAPABILITY_ACCOUNT_SELECTION_INVALID'
      using errcode='22023';
  end if;

  if v_credential.seller_account_key ~ '^[a-f0-9]{64}$'
      and v_credential.seller_account_key_source in (
        'provider_certified_v1','credential_incarnation_v1'
      )
      and v_credential.seller_account_verified_at is not null then
    v_scope_state := case
      when v_credential.status='active'
        and (v_credential.expires_at is null or v_credential.expires_at>v_now)
        then 'account_scoped'
      else 'credential_unavailable'
    end;

    if v_scope_state='account_scoped' then
    select count(*)::integer,
           count(*) filter (where ticket.provider_status='waiting')::integer,
           count(*) filter (where ticket.provider_status='answered')::integer,
           count(*) filter (where ticket.provider_status='closed')::integer,
           count(*) filter (where ticket.provider_status='unknown')::integer
      into v_ticket_count,v_waiting_count,v_answered_count,
           v_closed_count,v_unknown_count
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id=v_credential.created_by
       and ticket.channel_key='qoo10'
       and ticket.seller_account_key=v_credential.seller_account_key
       and ticket.ticket_kind='conversation'
       and ticket.external_ticket_id ~ '^qoo10:conversation:[a-f0-9]{64}$'
       and not ticket.demo;

    select count(*)::integer,max(message.received_at)
      into v_inbound_count,v_last_received_at
      from sellerpilot_private.support_inbound_messages message
      join sellerpilot_private.support_tickets ticket on ticket.id=message.ticket_id
     where ticket.owner_id=v_credential.created_by
       and ticket.channel_key='qoo10'
       and ticket.seller_account_key=v_credential.seller_account_key
       and ticket.ticket_kind='conversation'
       and ticket.external_ticket_id ~ '^qoo10:conversation:[a-f0-9]{64}$'
       and not ticket.demo
       and message.owner_id=ticket.owner_id
       and message.channel_key='qoo10'
       and message.sender_role='customer';

    select count(*)::integer,
           count(*) filter (where history_window.completion_state='queued')::integer,
           count(*) filter (where history_window.completion_state='complete')::integer,
           count(*) filter (where history_window.completion_state='refining')::integer,
           count(*) filter (where history_window.completion_state='gap')::integer,
           count(*) filter (
             where history_window.completion_state='complete'
               and history_window.completion_reason in (
                 'provider_success_empty','provider_total_reconciled'
               )
               and history_window.provider_status between 200 and 299
               and history_window.provider_row_count=0
           )::integer,
           count(*) filter (
             where history_window.completion_state='complete'
               and history_window.provider_status between 200 and 299
               and history_window.provider_row_count>0
           )::integer,
           min(history_window.calendar_date),max(history_window.calendar_date),
           max(history_window.updated_at)
      into v_window_count,v_queued_count,v_complete_count,v_refining_count,
           v_gap_count,v_verified_zero_count,v_positive_complete_count,
           v_earliest_date,v_latest_date,v_last_window_at
      from sellerpilot_private.qoo10_history_windows history_window
      join sellerpilot_private.channel_credentials source_credential
        on source_credential.id=history_window.credential_id
     where source_credential.created_by=v_credential.created_by
       and source_credential.channel='qoo10'
       and source_credential.environment=v_credential.environment
       and source_credential.seller_account_key=v_credential.seller_account_key
       and source_credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
       and source_credential.seller_account_verified_at is not null
       and history_window.source='qapi_inquiry';
    end if;
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-inquiry-source-read/1',
    'checkedAt',v_now,
    'credentialId',v_credential.id,
    'sellerAccountKeyHash',case when v_scope_state<>'identity_unverified'
      then v_credential.seller_account_key else null end,
    'environment',v_credential.environment,
    'scopeState',v_scope_state,
    'canonical',jsonb_build_object(
      'ticketCount',v_ticket_count,
      'inboundMessageCount',v_inbound_count,
      'waitingTicketCount',v_waiting_count,
      'answeredTicketCount',v_answered_count,
      'closedTicketCount',v_closed_count,
      'unknownTicketCount',v_unknown_count,
      'lastReceivedAt',v_last_received_at
    ),
    'history',jsonb_build_object(
      'windowCount',v_window_count,
      'queuedWindowCount',v_queued_count,
      'completeWindowCount',v_complete_count,
      'refiningWindowCount',v_refining_count,
      'gapWindowCount',v_gap_count,
      'verifiedZeroWindowCount',v_verified_zero_count,
      'positiveCompleteWindowCount',v_positive_complete_count,
      'earliestCalendarDate',v_earliest_date,
      'latestCalendarDate',v_latest_date,
      'lastUpdatedAt',v_last_window_at
    )
  );
end
$$;

revoke all on function public.sellerpilot_read_qoo10_inquiry_source_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_qoo10_inquiry_source_v1(uuid)
  to authenticated;

commit;
