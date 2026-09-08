-- Proposal only. Read-only checkpoint projection; it does not enqueue jobs.
begin;

create function public.sellerpilot_next_smartstore_history_window_v1(
  p_floor_date date,
  p_through_date date,
  p_credential_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_completed integer;
  v_next record;
  v_has_next boolean;
  v_owner_id uuid;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_floor_date is null or p_through_date is null or p_floor_date > p_through_date
     or p_floor_date < date '2000-01-01' or p_through_date - p_floor_date > 5000
     or p_environment not in ('production','sandbox') then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_RANGE_INVALID' using errcode = '22023';
  end if;
  select credential.created_by into v_owner_id
    from sellerpilot_private.channel_credentials credential
     where credential.id = p_credential_id
       and credential.created_by is not null
       and credential.channel = 'smartstore'
       and credential.environment = p_environment
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > statement_timestamp())
   limit 1;
  if not found then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_CREDENTIAL_INVALID' using errcode = '42501';
  end if;

  with recursive windows as (
    select 1 ordinal,p_through_date end_date,
      greatest(p_floor_date,p_through_date-29) start_date
    union all
    select ordinal+1,start_date-1,
      greatest(p_floor_date,start_date-30)
      from windows where start_date > p_floor_date
  ), states as (
    select win.*,
      format('product:%s:%s',win.start_date,win.end_date) product_item_key,
      format('customer:%s:%s',win.start_date,win.end_date) customer_item_key,
      format(
        '^inquiries:history:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:smartstore:product:%s:%s$',
        win.start_date,win.end_date
      ) product_scope_pattern,
      format(
        '^inquiries:history:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:smartstore:customer:%s:%s$',
        win.start_date,win.end_date
      ) customer_scope_pattern
      from windows win
  ), paired as (
    select state.*,
      exists (
        select 1 from sellerpilot_private.cs_history_scans scan
         where scan.owner_id = v_owner_id and scan.credential_id = p_credential_id
           and scan.channel = 'smartstore' and scan.environment = p_environment
           and scan.scope_key ~ state.product_scope_pattern and scan.ticket_kind = 'product'
           and scan.status = 'completed' and scan.scan_completed_at is not null
           and scan.reconciled_at is not null and scan.unprocessed_count = 0
      ) product_complete,
      exists (
        select 1 from sellerpilot_private.cs_history_scans scan
         where scan.owner_id = v_owner_id and scan.credential_id = p_credential_id
           and scan.channel = 'smartstore' and scan.environment = p_environment
           and scan.scope_key ~ state.customer_scope_pattern and scan.ticket_kind = 'customer'
           and scan.status = 'completed' and scan.scan_completed_at is not null
           and scan.reconciled_at is not null and scan.unprocessed_count = 0
      ) customer_complete
      from states state
  )
  select count(*)::integer,
    count(*) filter (where product_complete and customer_complete)::integer
    into v_total,v_completed from paired;

  with recursive windows as (
    select 1 ordinal,p_through_date end_date,
      greatest(p_floor_date,p_through_date-29) start_date
    union all
    select ordinal+1,start_date-1,
      greatest(p_floor_date,start_date-30)
      from windows where start_date > p_floor_date
  ), states as (
    select win.*,
      format('product:%s:%s',win.start_date,win.end_date) product_item_key,
      format('customer:%s:%s',win.start_date,win.end_date) customer_item_key,
      format(
        '^inquiries:history:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:smartstore:product:%s:%s$',
        win.start_date,win.end_date
      ) product_scope_pattern,
      format(
        '^inquiries:history:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:smartstore:customer:%s:%s$',
        win.start_date,win.end_date
      ) customer_scope_pattern
      from windows win
  )
  select state.* into v_next from states state
   where not (
    exists (
      select 1 from sellerpilot_private.cs_history_scans scan
       where scan.owner_id = v_owner_id and scan.credential_id = p_credential_id
         and scan.channel = 'smartstore' and scan.environment = p_environment
         and scan.scope_key ~ state.product_scope_pattern and scan.ticket_kind = 'product'
         and scan.status = 'completed' and scan.scan_completed_at is not null
         and scan.reconciled_at is not null and scan.unprocessed_count = 0
    ) and exists (
      select 1 from sellerpilot_private.cs_history_scans scan
       where scan.owner_id = v_owner_id and scan.credential_id = p_credential_id
         and scan.channel = 'smartstore' and scan.environment = p_environment
         and scan.scope_key ~ state.customer_scope_pattern and scan.ticket_kind = 'customer'
         and scan.status = 'completed' and scan.scan_completed_at is not null
         and scan.reconciled_at is not null and scan.unprocessed_count = 0
    )
   ) order by state.ordinal limit 1;
  v_has_next := found;

  return jsonb_build_object(
    'contract','sellerpilot-smartstore-history-checkpoint/1',
    'checkedAt',statement_timestamp(),
    'environment',p_environment,
    'totalWindowCount',v_total,
    'completedWindowCount',v_completed,
    'remainingWindowCount',v_total-v_completed,
    'complete',not v_has_next,
    'nextWindow',case when not v_has_next then null else jsonb_build_object(
      'key',format('smartstore:history:v1:%s:%s',v_next.start_date,v_next.end_date),
      'fromDate',v_next.start_date,
      'throughDate',v_next.end_date,
      'productItemKey',v_next.product_item_key,
      'customerItemKey',v_next.customer_item_key
    ) end,
    'advanceRule','both_product_and_customer_completed_reconciled_zero_unprocessed'
  );
end
$$;

revoke all on function public.sellerpilot_next_smartstore_history_window_v1(date,date,uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_next_smartstore_history_window_v1(date,date,uuid,text)
  to authenticated;

commit;
