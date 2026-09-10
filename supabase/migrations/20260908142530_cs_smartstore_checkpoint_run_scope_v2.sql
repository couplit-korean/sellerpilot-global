-- Proposal only. The coordinator assigns the migration version after review.
-- A window advances only when one succeeded, exact-scope history run owns both
-- reconciled SmartStore product/customer scan rows.
begin;

create function public.sellerpilot_next_smartstore_history_window_v2(
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
  v_now timestamptz := statement_timestamp();
  v_owner_id uuid;
  v_total integer := 0;
  v_completed integer := 0;
  v_window_start date;
  v_window_end date;
  v_window_complete boolean;
  v_next_start date;
  v_next_end date;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_floor_date is null or p_through_date is null or p_floor_date > p_through_date
     or p_floor_date < date '2000-01-01' or p_through_date - p_floor_date > 5000
     or p_through_date > (v_now at time zone 'Asia/Seoul')::date
     or p_environment is null or p_environment <> 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_RANGE_INVALID' using errcode = '22023';
  end if;

  select credential.created_by into v_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.created_by is not null
     and credential.channel = 'smartstore'
     and credential.environment = p_environment
     and credential.status = 'active'
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > v_now)
   limit 1;
  if not found then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_CREDENTIAL_INVALID' using errcode = '42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id <> p_credential_id
       and other.channel = 'smartstore'
       and other.environment = p_environment
       and other.status = 'active'
       and (other.expires_at is null or other.expires_at > v_now)
  ) then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_ACTIVE_SCOPE_AMBIGUOUS' using errcode = '55000';
  end if;

  v_window_end := p_through_date;
  loop
    v_window_start := greatest(p_floor_date,v_window_end-29);
    v_total := v_total + 1;

    select exists (
      select 1
        from sellerpilot_private.inquiry_history_backfill_runs run
       where run.owner_id = v_owner_id
         and run.range_start = v_window_start
         and run.range_end = v_window_end
         and run.history_days = v_window_end-v_window_start+1
         and run.channels = array['smartstore']::text[]
         and run.credential_ids->>'smartstore' = p_credential_id::text
         and run.status = 'succeeded'
         and run.completed_at is not null
         and run.expected_initial_jobs = 2
         and run.total_jobs >= run.expected_initial_jobs
         and run.succeeded_jobs = run.total_jobs
         and run.queued_jobs = 0
         and run.running_jobs = 0
         and run.failed_jobs = 0
         and exists (
           select 1 from sellerpilot_private.cs_history_scans product_scan
            where product_scan.owner_id = v_owner_id
              and product_scan.credential_id = p_credential_id
              and product_scan.channel = 'smartstore'
              and product_scan.environment = p_environment
              and product_scan.scope_key = format(
                'inquiries:history:%s:smartstore:product:%s:%s',
                run.id,v_window_start,v_window_end
              )
              and product_scan.ticket_kind = 'product'
              and product_scan.status = 'completed'
              and product_scan.scan_completed_at is not null
              and product_scan.reconciled_at is not null
              and product_scan.unprocessed_count = 0
              and product_scan.range_start_at is not null
              and product_scan.range_end_at is not null
         )
         and exists (
           select 1 from sellerpilot_private.cs_history_scans customer_scan
            where customer_scan.owner_id = v_owner_id
              and customer_scan.credential_id = p_credential_id
              and customer_scan.channel = 'smartstore'
              and customer_scan.environment = p_environment
              and customer_scan.scope_key = format(
                'inquiries:history:%s:smartstore:customer:%s:%s',
                run.id,v_window_start,v_window_end
              )
              and customer_scan.ticket_kind = 'customer'
              and customer_scan.status = 'completed'
              and customer_scan.scan_completed_at is not null
              and customer_scan.reconciled_at is not null
              and customer_scan.unprocessed_count = 0
              and customer_scan.range_start_at is not null
              and customer_scan.range_end_at is not null
         )
    ) into v_window_complete;

    if v_window_complete then
      v_completed := v_completed + 1;
    elsif v_next_start is null then
      v_next_start := v_window_start;
      v_next_end := v_window_end;
    end if;

    exit when v_window_start = p_floor_date;
    v_window_end := v_window_start-1;
  end loop;

  return jsonb_build_object(
    'contract','sellerpilot-smartstore-history-checkpoint/2',
    'checkedAt',v_now,
    'environment',p_environment,
    'totalWindowCount',v_total,
    'completedWindowCount',v_completed,
    'remainingWindowCount',v_total-v_completed,
    'complete',v_next_start is null,
    'nextWindow',case when v_next_start is null then null else jsonb_build_object(
      'key',format('smartstore:history:v2:%s:%s',v_next_start,v_next_end),
      'fromDate',v_next_start,
      'throughDate',v_next_end,
      'productItemKey',format('product:%s:%s',v_next_start,v_next_end),
      'customerItemKey',format('customer:%s:%s',v_next_start,v_next_end)
    ) end,
    'advanceRule','same_succeeded_run_both_product_and_customer_completed_reconciled_zero_unprocessed'
  );
end
$$;

revoke all on function public.sellerpilot_next_smartstore_history_window_v2(date,date,uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_next_smartstore_history_window_v2(date,date,uuid,text)
  to authenticated;

-- The legacy projection admits unrelated scan rows. Keep its definition for
-- migration history, but do not leave an authenticated API bypass to it.
revoke all on function public.sellerpilot_next_smartstore_history_window_v1(date,date,uuid,text)
  from public,anon,authenticated,service_role;

comment on function public.sellerpilot_next_smartstore_history_window_v2(date,date,uuid,text) is
  'Admin-only SmartStore history checkpoint. Completion requires one exact succeeded run and both reconciled product/customer scans in that same run.';

notify pgrst,'reload schema';
commit;
