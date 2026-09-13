-- Reviewed forward recovery. No jobs, approvals or provider actions are created.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
do $recovery_guard$ begin
if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_get_inquiry_reply_delivery' and pg_get_function_identity_arguments(p.oid)='p_ticket_id uuid, p_job_id uuid') is distinct from 'ed58b89f8a8705c3625d16e6623adff0' then raise exception 'RECOVERY_PREIMAGE_DRIFT:sellerpilot_get_inquiry_reply_delivery';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_next_smartstore_history_window_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_next_smartstore_history_window_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_next_smartstore_history_window_v2') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_next_smartstore_history_window_v2';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_next_smartstore_history_window_v3') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_next_smartstore_history_window_v3';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_next_smartstore_history_window_v4') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_next_smartstore_history_window_v4';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_smartstore_cs_account_ticket_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_smartstore_cs_account_ticket_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_smartstore_cs_order_binding_health_v2') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_smartstore_cs_order_binding_health_v2';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_read_smartstore_cs_order_binding_health_v3') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_read_smartstore_cs_order_binding_health_v3';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_service_record_smartstore_reply_readback_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_service_record_smartstore_reply_readback_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_start_smartstore_inquiry_history_window_v5') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_start_smartstore_inquiry_history_window_v5';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_start_smartstore_inquiry_history_window_v6') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_start_smartstore_inquiry_history_window_v6';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sellerpilot_start_smartstore_inquiry_history_window_v7') then raise exception 'RECOVERY_ALREADY_DEFINED:sellerpilot_start_smartstore_inquiry_history_window_v7';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='apply_smartstore_history_coverage_bounds_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:apply_smartstore_history_coverage_bounds_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='enqueue_smartstore_reply_readback_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:enqueue_smartstore_reply_readback_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='prepare_smartstore_reply_readback_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:prepare_smartstore_reply_readback_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_history_run_lineage_valid_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_history_run_lineage_valid_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='smartstore_history_run_reconciled_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:smartstore_history_run_reconciled_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='sync_smartstore_cs_ticket_identity_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:sync_smartstore_cs_ticket_identity_v1';end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sellerpilot_private' and p.proname='try_timestamptz_v1') then raise exception 'RECOVERY_ALREADY_DEFINED:try_timestamptz_v1';end if;
end $recovery_guard$;
-- Reviewed source: 20260908140403_cs_smartstore_order_binding_v2.sql
-- Source SHA256: 8771e2c8b8ef769d0ca43011c23aa66317c15676fe348aea9cd2e7516e6f0c0a
-- Proposal only. The coordinator assigns the migration version after review.
create function public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_owner_id uuid;
  v_active_scope_count integer;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select count(distinct concat_ws('|',credential.created_by::text,credential.seller_account_key))::integer
    into v_active_scope_count
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'smartstore' and credential.environment = 'production'
     and credential.status = 'active' and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > statement_timestamp());
  if v_active_scope_count <> 1 then
    raise exception 'SMARTSTORE_ORDER_BINDING_ACTIVE_SCOPE_INVALID' using errcode = '55000';
  end if;
  select credential.created_by into v_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'smartstore' and credential.environment = 'production'
     and credential.status = 'active' and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
   order by credential.version desc,credential.created_at desc,credential.id limit 1;

  with projected as (
    select case
      when ticket.provider_context->>'kind' = 'product' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status = 'not_applicable'
               and (not (ticket.provider_context ? 'productOrderIds')
                 or (jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
                   and jsonb_array_length(ticket.provider_context->'productOrderIds') = 0))
          then 'not_applicable' else 'contract_mismatch' end
      when ticket.provider_context->>'kind' <> 'customer' then 'contract_mismatch'
      when ticket.provider_context->>'orderReferenceState' = 'exact_product_order' then
        case when jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
               and jsonb_array_length(ticket.provider_context->'productOrderIds') = 1
               and jsonb_typeof(ticket.provider_context->'productOrderIds'->0) = 'string'
               and ticket.provider_context->'productOrderIds'->>0 ~ '^[1-9][0-9]{0,19}$'
               and nullif(trim(ticket.external_order_reference),'') = ticket.provider_context->'productOrderIds'->>0
               and binding.status in ('exact','unmatched','unverified_credential')
          then binding.status else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState' = 'ambiguous_product_orders' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
               and jsonb_array_length(ticket.provider_context->'productOrderIds') > 0
               and not exists (
                 select 1 from jsonb_array_elements(ticket.provider_context->'productOrderIds') item
                  where jsonb_typeof(item) <> 'string'
                     or item#>>'{}' !~ '^[1-9][0-9]{0,19}$'
               )
               and binding.status = 'not_applicable'
          then 'ambiguous_product_orders' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState' = 'invalid_product_order_list' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status = 'not_applicable'
          then 'invalid_product_order_list' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState' = 'unavailable' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status = 'not_applicable'
               and (not (ticket.provider_context ? 'productOrderIds')
                 or (jsonb_typeof(ticket.provider_context->'productOrderIds') = 'array'
                   and jsonb_array_length(ticket.provider_context->'productOrderIds') = 0))
          then 'not_applicable' else 'contract_mismatch' end
      else 'contract_mismatch'
    end ui_status
    from sellerpilot_private.support_tickets ticket
    join sellerpilot_private.cs_order_bindings binding on binding.ticket_id = ticket.id
    where ticket.owner_id = v_owner_id
      and ticket.channel_key = 'smartstore'
      and binding.channel = 'smartstore'
      and not ticket.demo
  ), grouped as (
    select ui_status status,count(*)::integer count
      from projected group by ui_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel','smartstore','status',status,'count',count
  ) order by status),'[]'::jsonb) into v_groups from grouped;

  return jsonb_build_object(
    'contract','sellerpilot-cs-smartstore-order-binding-health/2',
    'projectionContract','smartstore-cs-order-binding-projection/1',
    'checkedAt',statement_timestamp(),
    'matchingRule','same_owner_channel_exact_product_order_and_credential',
    'automaticOrderLinkState','exact',
    'csCommerceMutationAllowed',false,
    'groups',v_groups
  );
end
$$;

revoke all on function public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
  to authenticated;


-- Reviewed source: 20260908140405_cs_smartstore_history_checkpoint.sql
-- Source SHA256: 2030f6c603330098675fc5c66dc0a2dcacfc8d95e607a4c51f0eec42e2261b20
-- Proposal only. Read-only checkpoint projection; it does not enqueue jobs.
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


-- Reviewed source: 20260908140407_cs_smartstore_exact_history_window_v5.sql
-- Source SHA256: 7a11223587a2621ef3548e7ae4efe0cca8f4acfc148144dc5a68228ca3962b8f
-- Proposal only. The coordinator assigns the migration version after review.
-- Adds an exact 1-30 day SmartStore-only enqueue path without widening other channels.
alter table sellerpilot_private.inquiry_history_backfill_runs
  drop constraint inquiry_history_backfill_runs_history_days_check,
  add constraint inquiry_history_backfill_runs_history_days_check check (
    (channels = array['smartstore']::text[] and history_days between 1 and 30)
    or (channels <> array['smartstore']::text[] and history_days between 7 and 30)
  );

create function public.sellerpilot_start_smartstore_inquiry_history_window_v5(
  p_from_date date,
  p_through_date date,
  p_credential_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_history_days integer;
  v_credential record;
  v_request_key text;
  v_run_id uuid;
  v_existing_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_retried_jobs integer := 0;
  v_result jsonb;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_from_date is null or p_through_date is null or p_from_date > p_through_date
     or p_from_date < date '2000-01-01' or p_through_date - p_from_date > 29
     or p_through_date > (v_now at time zone 'Asia/Seoul')::date
     or p_environment <> 'production' then
    raise exception 'SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID' using errcode = '22023';
  end if;
  v_history_days := p_through_date - p_from_date + 1;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:smartstore:' || p_environment)
  );
  if not exists (
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'smartstore' and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'smartstore'
     and credential.environment = p_environment
     and credential.status = 'active'
     and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1')
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > v_now)
   for update;
  if not found then
    raise exception 'SMARTSTORE_EXACT_HISTORY_CREDENTIAL_INVALID' using errcode = '42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id <> v_credential.id and other.channel = 'smartstore'
       and other.environment = p_environment and other.status = 'active'
       and (other.expires_at is null or other.expires_at > v_now)
  ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ACTIVE_SCOPE_AMBIGUOUS' using errcode = '55000';
  end if;

  v_request_key := encode(extensions.digest(concat_ws('|',
    'channel-inquiry-history-smartstore-exact-v5',v_credential.created_by::text,
    v_credential.id::text,v_credential.seller_account_key,p_environment,
    p_from_date::text,p_through_date::text,v_history_days::text
  ),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:inquiry-history:' || v_request_key)
  );
  select run.* into v_existing_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.request_key = v_request_key for update;
  if found then
    if v_existing_run.owner_id <> v_credential.created_by
       or v_existing_run.history_days <> v_history_days
       or v_existing_run.range_start <> p_from_date
       or v_existing_run.range_end <> p_through_date
       or v_existing_run.channels <> array['smartstore']::text[]
       or v_existing_run.credential_ids->>'smartstore' is distinct from v_credential.id::text then
      raise exception 'SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH' using errcode = '55000';
    end if;
    if v_existing_run.status = 'failed' then
      update sellerpilot_private.channel_gateway_jobs job set
        status = 'queued',worker_token_id = null,claim_token = null,
        lease_expires_at = null,completed_at = null,error_message = null,
        updated_at = clock_timestamp()
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}' = v_existing_run.id::text
         and job.created_by = v_credential.created_by
         and job.credential_id = v_credential.id
         and job.channel = 'smartstore' and job.environment = p_environment
         and job.operation = 'inquiries.list' and job.status = 'failed'
         and job.attempt_count < 4 and not job.credential_refresh_in_flight
         and job.credential_refresh_recovery_vault_id is null;
      get diagnostics v_retried_jobs = row_count;
    end if;
    return sellerpilot_private.refresh_inquiry_history_backfill_run(v_existing_run.id)
      || jsonb_build_object(
        'contract','sellerpilot-smartstore-exact-history-window/5',
        'reused',true,'retriedJobs',v_retried_jobs,'acceptedNotCompleted',true
      );
  end if;

  insert into sellerpilot_private.inquiry_history_backfill_runs(
    request_key,owner_id,initiated_by,history_days,range_start,range_end,
    expected_initial_jobs,channels,credential_ids
  ) values (
    v_request_key,v_credential.created_by,v_actor,v_history_days,p_from_date,p_through_date,
    2,array['smartstore']::text[],jsonb_build_object('smartstore',v_credential.id::text)
  ) returning id into v_run_id;

  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,'smartstore',format('product:%s:%s',p_from_date,p_through_date),
    jsonb_build_object('kind','product','query',jsonb_build_object(
      'fromDate',format('%sT00:00:00.000+09:00',p_from_date),
      'toDate',case when p_through_date = (v_now at time zone 'Asia/Seoul')::date
        then to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        else format('%sT23:59:59.999+09:00',p_through_date) end,
      'page',1,'size',100
    ))
  );
  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,'smartstore',format('customer:%s:%s',p_from_date,p_through_date),
    jsonb_build_object('kind','customer','query',jsonb_build_object(
      'startSearchDate',p_from_date::text,'endSearchDate',p_through_date::text,
      'page',1,'size',200
    ))
  );

  if (select count(*) from sellerpilot_private.channel_gateway_jobs job
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}' = v_run_id::text) <> 2
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}' = v_run_id::text
          and (job.created_by <> v_credential.created_by
            or job.credential_id <> v_credential.id
            or job.channel <> 'smartstore' or job.environment <> p_environment
            or job.operation <> 'inquiries.list')
     ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ENQUEUE_SCOPE_MISMATCH' using errcode = '55000';
  end if;
  v_result := sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
  if coalesce((v_result->>'totalJobs')::integer,0) <> 2 then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ENQUEUE_COUNT_MISMATCH' using errcode = '55000';
  end if;
  return v_result || jsonb_build_object(
    'contract','sellerpilot-smartstore-exact-history-window/5',
    'reused',false,'retriedJobs',0,'acceptedNotCompleted',true
  );
end;
$$;

revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text)
  to authenticated;

comment on function public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text) is
  'Admin-only exact 1-30 calendar-day SmartStore product/customer inquiry read enqueue. It preserves one credential seller scope and returns acceptance, never provider completion.';

notify pgrst,'reload schema';

-- Reviewed source: 20260908142530_cs_smartstore_checkpoint_run_scope_v2.sql
-- Source SHA256: 27f597dbba849deabf73d25b166319afd4aba65c566a4720cad2c069b4ea4a13
-- Proposal only. The coordinator assigns the migration version after review.
-- A window advances only when one succeeded, exact-scope history run owns both
-- reconciled SmartStore product/customer scan rows.
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

-- Reviewed source: 20260908151019_cs_smartstore_explicit_coverage_bounds.sql
-- Source SHA256: a998f448cb2821cd4b042f5d72aeb3636b7c852d73647f23993ad56845821c0d
-- Proposal only. The coordinator assigns the migration version after review.
-- Preserve the generic coverage recorder while overriding SmartStore timestamps
-- only when the root history job carries the explicit v6 boundary contract.
create function sellerpilot_private.try_timestamptz_v1(p_value text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null
     or p_value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end
$$;

create function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root sellerpilot_private.channel_gateway_jobs%rowtype;
  v_mode text;
  v_from_text text;
  v_through_text text;
  v_observed_text text;
  v_from_at timestamptz;
  v_through_at timestamptz;
  v_observed_at timestamptz;
  v_from_date date;
  v_through_date date;
  v_kind text;
  v_item_key text;
begin
  if new.channel <> 'smartstore' then return new; end if;

  select job.* into v_root
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.root_job_id
     and job.created_by = new.owner_id
     and job.credential_id = new.credential_id
     and job.channel = new.channel
     and job.environment = new.environment
     and job.operation = 'inquiries.list';
  if not found then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_ROOT_INVALID' using errcode = '55000';
  end if;

  v_mode := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}','');
  v_from_text := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}','');
  v_through_text := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}','');
  v_observed_text := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}','');
  if v_mode is null and v_from_text is null and v_through_text is null
     and v_observed_text is null then
    return new;
  end if;
  if coalesce(v_mode,'') not in ('cutoff','full_day') or v_from_text is null
     or v_through_text is null or v_observed_text is null then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;

  v_from_at := sellerpilot_private.try_timestamptz_v1(v_from_text);
  v_through_at := sellerpilot_private.try_timestamptz_v1(v_through_text);
  v_observed_at := sellerpilot_private.try_timestamptz_v1(v_observed_text);
  if v_from_at is null or v_through_at is null or v_observed_at is null then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;
  if v_through_at < v_from_at then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;

  v_from_date := (v_from_at at time zone 'Asia/Seoul')::date;
  v_through_date := (v_through_at at time zone 'Asia/Seoul')::date;
  if v_from_at <> (v_from_date::timestamp at time zone 'Asia/Seoul') then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID' using errcode = '22023';
  end if;
  if v_mode = 'full_day' and (
       v_through_at <> ((v_through_date+1)::timestamp at time zone 'Asia/Seoul'
         - interval '1 millisecond')
       or v_through_date >= (v_observed_at at time zone 'Asia/Seoul')::date
     ) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_FULL_DAY_INVALID' using errcode = '22023';
  end if;
  if v_mode = 'cutoff' and (
       v_through_at <> v_observed_at
       or v_through_date <> (v_observed_at at time zone 'Asia/Seoul')::date
     ) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_CUTOFF_INVALID' using errcode = '22023';
  end if;

  v_kind := nullif(v_root.request_payload#>>'{arguments,kind}','');
  v_item_key := nullif(v_root.request_payload#>>'{arguments,sellerpilotHistoryItemKey}','');
  if coalesce(v_kind,'') not in ('product','customer')
     or v_item_key is distinct from format('%s:%s:%s',v_kind,v_from_date,v_through_date)
     or v_root.request_payload->>'periodicKey' is distinct from format(
       'inquiries:history:%s:smartstore:%s',
       v_root.request_payload#>>'{arguments,sellerpilotHistoryRunId}',v_item_key
     ) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_SCOPE_INVALID' using errcode = '22023';
  end if;
  if (v_kind = 'product' and (
        sellerpilot_private.try_timestamptz_v1(
          v_root.request_payload#>>'{arguments,query,fromDate}'
        ) is distinct from v_from_at
        or sellerpilot_private.try_timestamptz_v1(
          v_root.request_payload#>>'{arguments,query,toDate}'
        ) is distinct from v_through_at
      ))
     or (v_kind = 'customer' and (
        v_root.request_payload#>>'{arguments,query,startSearchDate}'
          is distinct from v_from_date::text
        or v_root.request_payload#>>'{arguments,query,endSearchDate}'
          is distinct from v_through_date::text
      )) then
    raise exception 'SMARTSTORE_HISTORY_COVERAGE_QUERY_BOUNDARY_MISMATCH' using errcode = '22023';
  end if;

  new.timezone_name := 'Asia/Seoul';
  new.range_start_at := v_from_at;
  new.range_end_at := v_through_at;
  return new;
end
$$;

drop trigger if exists apply_smartstore_history_coverage_bounds_v1
  on sellerpilot_private.cs_history_scans;
create trigger apply_smartstore_history_coverage_bounds_v1
before insert on sellerpilot_private.cs_history_scans
for each row execute function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1();

revoke all on function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1()
  from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.try_timestamptz_v1(text)
  from public,anon,authenticated,service_role;

comment on function sellerpilot_private.apply_smartstore_history_coverage_bounds_v1() is
  'Internal trigger: validates the SmartStore v6 explicit cutoff/full-day boundary contract and stores timezone-independent coverage timestamps.';
comment on function sellerpilot_private.try_timestamptz_v1(text) is
  'Internal fail-closed parser for explicit offset-bearing SmartStore history coverage timestamps.';


-- Reviewed source: 20260908151022_cs_smartstore_exact_history_window_v6.sql
-- Source SHA256: a98b0f9d333e9fe851c87b302b13eb0c7a7e62c76fa85249151c7c59779fe6b0
-- Proposal only. The coordinator assigns the migration version after review.
-- Enqueues exact SmartStore history windows with an immutable observed cutoff.
-- A request through the current KST date is cutoff evidence; after that date,
-- the same calendar scope gets a distinct full-day run.
create or replace function public.sellerpilot_start_smartstore_inquiry_history_window_v6(
  p_from_date date,
  p_through_date date,
  p_credential_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := date_trunc('milliseconds',clock_timestamp());
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_history_days integer;
  v_credential record;
  v_coverage_mode text;
  v_coverage_from_at timestamptz;
  v_coverage_through_at timestamptz;
  v_request_key text;
  v_run_id uuid;
  v_existing_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_existing_from_text text;
  v_existing_through_text text;
  v_existing_observed_text text;
  v_retried_jobs integer := 0;
  v_result jsonb;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_from_date is null or p_through_date is null or p_from_date > p_through_date
     or p_from_date < date '2000-01-01' or p_through_date-p_from_date > 29
     or p_through_date > v_today or p_environment <> 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID' using errcode = '22023';
  end if;

  v_history_days := p_through_date-p_from_date+1;
  v_coverage_mode := case when p_through_date=v_today then 'cutoff' else 'full_day' end;
  v_coverage_from_at := p_from_date::timestamp at time zone 'Asia/Seoul';
  v_coverage_through_at := case when v_coverage_mode='cutoff' then v_now
    else (p_through_date+1)::timestamp at time zone 'Asia/Seoul'
      - interval '1 millisecond' end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:smartstore:'||p_environment)
  );
  if not exists (
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel='smartstore' and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment=p_environment
     and credential.status='active'
     and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>v_now)
   for update;
  if not found then
    raise exception 'SMARTSTORE_EXACT_HISTORY_CREDENTIAL_INVALID' using errcode = '42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id<>v_credential.id and other.channel='smartstore'
       and other.environment=p_environment and other.status='active'
       and (other.expires_at is null or other.expires_at>v_now)
  ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ACTIVE_SCOPE_AMBIGUOUS' using errcode = '55000';
  end if;

  v_request_key := encode(extensions.digest(concat_ws('|',
    'channel-inquiry-history-smartstore-exact-v6',v_credential.created_by::text,
    v_credential.id::text,v_credential.seller_account_key,p_environment,
    p_from_date::text,p_through_date::text,v_history_days::text,v_coverage_mode
  ),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:inquiry-history:'||v_request_key)
  );
  select run.* into v_existing_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.request_key=v_request_key for update;
  if found then
    if v_existing_run.owner_id<>v_credential.created_by
       or v_existing_run.history_days<>v_history_days
       or v_existing_run.range_start<>p_from_date
       or v_existing_run.range_end<>p_through_date
       or v_existing_run.channels<>array['smartstore']::text[]
       or v_existing_run.credential_ids->>'smartstore' is distinct from v_credential.id::text
       or (select count(*) from sellerpilot_private.channel_gateway_jobs job
            where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text)<>2
       or exists (
         select 1 from sellerpilot_private.channel_gateway_jobs job
          where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
            and (job.created_by is distinct from v_credential.created_by
              or job.credential_id is distinct from v_credential.id
              or job.channel is distinct from 'smartstore'
              or job.environment is distinct from p_environment
              or job.operation is distinct from 'inquiries.list'
              or job.request_payload#>>'{arguments,kind}' is null
              or job.request_payload#>>'{arguments,kind}' not in ('product','customer')
              or job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}' is distinct from
                format('%s:%s:%s',job.request_payload#>>'{arguments,kind}',p_from_date,p_through_date)
              or job.request_payload->>'periodicKey' is distinct from format(
                'inquiries:history:%s:smartstore:%s:%s:%s',v_existing_run.id,
                job.request_payload#>>'{arguments,kind}',p_from_date,p_through_date
              )
              or job.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'
                is distinct from v_coverage_mode
              or sellerpilot_private.try_timestamptz_v1(
                job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
              ) is distinct from v_coverage_from_at
              or case when v_coverage_mode='full_day' then
                sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
                ) is distinct from v_coverage_through_at
                or sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) is null
                or (sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) at time zone 'Asia/Seoul')::date<=p_through_date
              else
                sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
                ) is distinct from sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                )
                or sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) is null
                or (sellerpilot_private.try_timestamptz_v1(
                  job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
                ) at time zone 'Asia/Seoul')::date<>p_through_date
              end)
       ) then
      raise exception 'SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH' using errcode = '55000';
    end if;

    select min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'),
           min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'),
           min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}')
      into v_existing_from_text,v_existing_through_text,v_existing_observed_text
      from sellerpilot_private.channel_gateway_jobs job
     where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text;
    if v_existing_run.status='failed' then
      update sellerpilot_private.channel_gateway_jobs job set
        status='queued',worker_token_id=null,claim_token=null,lease_expires_at=null,
        completed_at=null,error_message=null,updated_at=clock_timestamp()
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
         and job.created_by=v_credential.created_by and job.credential_id=v_credential.id
         and job.channel='smartstore' and job.environment=p_environment
         and job.operation='inquiries.list' and job.status='failed'
         and job.attempt_count<4 and not job.credential_refresh_in_flight
         and job.credential_refresh_recovery_vault_id is null;
      get diagnostics v_retried_jobs = row_count;
    end if;
    return sellerpilot_private.refresh_inquiry_history_backfill_run(v_existing_run.id)
      || jsonb_build_object(
        'contract','sellerpilot-smartstore-exact-history-window/6',
        'reused',true,'retriedJobs',v_retried_jobs,'acceptedNotCompleted',true,
        'coverageMode',v_coverage_mode,'fullCalendarDayCoverage',v_coverage_mode='full_day',
        'coverageFromAt',v_existing_from_text,'coverageThroughAt',v_existing_through_text,
        'coverageObservedAt',v_existing_observed_text
      );
  end if;

  insert into sellerpilot_private.inquiry_history_backfill_runs(
    request_key,owner_id,initiated_by,history_days,range_start,range_end,
    expected_initial_jobs,channels,credential_ids
  ) values (
    v_request_key,v_credential.created_by,v_actor,v_history_days,p_from_date,p_through_date,
    2,array['smartstore']::text[],jsonb_build_object('smartstore',v_credential.id::text)
  ) returning id into v_run_id;

  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,'smartstore',format('product:%s:%s',p_from_date,p_through_date),
    jsonb_build_object(
      'kind','product',
      'sellerpilotHistoryCoverageMode',v_coverage_mode,
      'sellerpilotHistoryCoverageFromAt',v_coverage_from_at,
      'sellerpilotHistoryCoverageThroughAt',v_coverage_through_at,
      'sellerpilotHistoryCoverageObservedAt',v_now,
      'query',jsonb_build_object(
        'fromDate',format('%sT00:00:00.000+09:00',p_from_date),
        'toDate',to_char(v_coverage_through_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'page',1,'size',100
      )
    )
  );
  perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
    v_run_id,'smartstore',format('customer:%s:%s',p_from_date,p_through_date),
    jsonb_build_object(
      'kind','customer',
      'sellerpilotHistoryCoverageMode',v_coverage_mode,
      'sellerpilotHistoryCoverageFromAt',v_coverage_from_at,
      'sellerpilotHistoryCoverageThroughAt',v_coverage_through_at,
      'sellerpilotHistoryCoverageObservedAt',v_now,
      'query',jsonb_build_object(
        'startSearchDate',p_from_date::text,'endSearchDate',p_through_date::text,
        'page',1,'size',200
      )
    )
  );

  if (select count(*) from sellerpilot_private.channel_gateway_jobs job
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text)<>2
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text
          and (job.created_by is distinct from v_credential.created_by
            or job.credential_id is distinct from v_credential.id
            or job.channel is distinct from 'smartstore'
            or job.environment is distinct from p_environment
            or job.operation is distinct from 'inquiries.list'
            or job.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'
              is distinct from v_coverage_mode
            or sellerpilot_private.try_timestamptz_v1(
              job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
            ) is distinct from v_coverage_from_at
            or sellerpilot_private.try_timestamptz_v1(
              job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
            ) is distinct from v_coverage_through_at
            or sellerpilot_private.try_timestamptz_v1(
              job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
            ) is distinct from v_now)
     ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ENQUEUE_SCOPE_MISMATCH' using errcode = '55000';
  end if;
  v_result := sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
  if coalesce((v_result->>'totalJobs')::integer,0)<>2 then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ENQUEUE_COUNT_MISMATCH' using errcode = '55000';
  end if;
  return v_result || jsonb_build_object(
    'contract','sellerpilot-smartstore-exact-history-window/6',
    'reused',false,'retriedJobs',0,'acceptedNotCompleted',true,
    'coverageMode',v_coverage_mode,'fullCalendarDayCoverage',v_coverage_mode='full_day',
    'coverageFromAt',v_coverage_from_at,'coverageThroughAt',v_coverage_through_at,
    'coverageObservedAt',v_now
  );
end
$$;

revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v5(date,date,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text)
  to authenticated;

comment on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(date,date,uuid,text) is
  'Admin-only exact SmartStore history enqueue. Current KST day is cutoff evidence; past dates are immutable full-day coverage and use a distinct request lineage.';

notify pgrst,'reload schema';

-- Reviewed source: 20260908151024_cs_smartstore_checkpoint_full_day_v3.sql
-- Source SHA256: 2836efef554655d066d5c764e20d43f42c000859750a10017966ca1a993fdae3
-- Proposal only. The coordinator assigns the migration version after review.
-- Completion requires exact full KST calendar-day coverage. A current-day
-- cutoff scan remains resumable and cannot advance the checkpoint.
create function public.sellerpilot_next_smartstore_history_window_v3(
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
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_owner_id uuid;
  v_total integer := 0;
  v_completed integer := 0;
  v_window_start date;
  v_window_end date;
  v_expected_start_at timestamptz;
  v_expected_end_at timestamptz;
  v_window_complete boolean;
  v_next_start date;
  v_next_end date;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_floor_date is null or p_through_date is null or p_floor_date > p_through_date
     or p_floor_date < date '2000-01-01' or p_through_date - p_floor_date > 5000
     or p_through_date > v_today
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
    v_expected_start_at := v_window_start::timestamp at time zone 'Asia/Seoul';
    v_expected_end_at := (v_window_end+1)::timestamp at time zone 'Asia/Seoul'
      - interval '1 millisecond';
    v_total := v_total + 1;

    select v_window_end < v_today and exists (
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
           select 1
             from sellerpilot_private.cs_history_scans product_scan
             join sellerpilot_private.channel_gateway_jobs product_job
               on product_job.id = product_scan.root_job_id
              and product_job.created_by = product_scan.owner_id
              and product_job.credential_id = product_scan.credential_id
              and product_job.channel = product_scan.channel
              and product_job.environment = product_scan.environment
              and product_job.operation = 'inquiries.list'
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
              and product_scan.timezone_name = 'Asia/Seoul'
              and product_scan.range_start_at = v_expected_start_at
              and product_scan.range_end_at = v_expected_end_at
              and product_scan.scope_digest = encode(extensions.digest(
                pg_catalog.convert_to(product_job.request_payload::text,'UTF8'),'sha256'
              ),'hex')
              and product_job.status = 'succeeded'
              and product_job.request_payload#>>'{arguments,kind}' = 'product'
              and product_job.request_payload#>>'{arguments,sellerpilotHistoryRunId}' = run.id::text
              and product_job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}' =
                format('product:%s:%s',v_window_start,v_window_end)
              and product_job.request_payload->>'periodicKey' = format(
                'inquiries:history:%s:smartstore:product:%s:%s',
                run.id,v_window_start,v_window_end
              )
              and product_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}' = 'full_day'
              and sellerpilot_private.try_timestamptz_v1(
                product_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
              ) = v_expected_start_at
              and sellerpilot_private.try_timestamptz_v1(
                product_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
              ) = v_expected_end_at
              and (sellerpilot_private.try_timestamptz_v1(
                product_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
              ) at time zone 'Asia/Seoul')::date > v_window_end
         )
         and exists (
           select 1
             from sellerpilot_private.cs_history_scans customer_scan
             join sellerpilot_private.channel_gateway_jobs customer_job
               on customer_job.id = customer_scan.root_job_id
              and customer_job.created_by = customer_scan.owner_id
              and customer_job.credential_id = customer_scan.credential_id
              and customer_job.channel = customer_scan.channel
              and customer_job.environment = customer_scan.environment
              and customer_job.operation = 'inquiries.list'
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
              and customer_scan.timezone_name = 'Asia/Seoul'
              and customer_scan.range_start_at = v_expected_start_at
              and customer_scan.range_end_at = v_expected_end_at
              and customer_scan.scope_digest = encode(extensions.digest(
                pg_catalog.convert_to(customer_job.request_payload::text,'UTF8'),'sha256'
              ),'hex')
              and customer_job.status = 'succeeded'
              and customer_job.request_payload#>>'{arguments,kind}' = 'customer'
              and customer_job.request_payload#>>'{arguments,sellerpilotHistoryRunId}' = run.id::text
              and customer_job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}' =
                format('customer:%s:%s',v_window_start,v_window_end)
              and customer_job.request_payload->>'periodicKey' = format(
                'inquiries:history:%s:smartstore:customer:%s:%s',
                run.id,v_window_start,v_window_end
              )
              and customer_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}' = 'full_day'
              and sellerpilot_private.try_timestamptz_v1(
                customer_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
              ) = v_expected_start_at
              and sellerpilot_private.try_timestamptz_v1(
                customer_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
              ) = v_expected_end_at
              and (sellerpilot_private.try_timestamptz_v1(
                customer_job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
              ) at time zone 'Asia/Seoul')::date > v_window_end
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
    'contract','sellerpilot-smartstore-history-checkpoint/3',
    'checkedAt',v_now,
    'environment',p_environment,
    'totalWindowCount',v_total,
    'completedWindowCount',v_completed,
    'remainingWindowCount',v_total-v_completed,
    'complete',v_next_start is null,
    'nextWindow',case when v_next_start is null then null else jsonb_build_object(
      'key',format('smartstore:history:v3:%s:%s',v_next_start,v_next_end),
      'fromDate',v_next_start,
      'throughDate',v_next_end,
      'productItemKey',format('product:%s:%s',v_next_start,v_next_end),
      'customerItemKey',format('customer:%s:%s',v_next_start,v_next_end)
    ) end,
    'advanceRule','same_succeeded_run_both_kinds_exact_full_kst_day_coverage'
  );
end
$$;

revoke all on function public.sellerpilot_next_smartstore_history_window_v1(date,date,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_next_smartstore_history_window_v2(date,date,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_next_smartstore_history_window_v3(date,date,uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_next_smartstore_history_window_v3(date,date,uuid,text)
  to authenticated;

comment on function public.sellerpilot_next_smartstore_history_window_v3(date,date,uuid,text) is
  'Admin-only SmartStore checkpoint. Only past, exact full KST calendar-day coverage in one succeeded run advances; current-day cutoff scans remain incomplete.';

notify pgrst,'reload schema';

-- Reviewed source: 20260908155617_cs_smartstore_continuation_safe_window_v7.sql
-- Source SHA256: 8eb6a1e9900cf328b02915949fc4bca63e909fbf422cd2a9235e273e3e41bc85
-- Proposal only. Apply after the frozen supplement 006 candidate.
-- Keep the two initial SmartStore jobs distinct from their pagination
-- descendants, validate the complete tagged lineage, and retry only failed
-- jobs in that exact lineage.
create or replace function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
  p_run_id uuid,
  p_owner_id uuid,
  p_credential_id uuid,
  p_environment text,
  p_from_date date,
  p_through_date date,
  p_coverage_mode text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
with recursive
expected as (
  select
    p_from_date::timestamp at time zone 'Asia/Seoul' as from_at,
    (p_through_date+1)::timestamp at time zone 'Asia/Seoul'
      - interval '1 millisecond' as full_day_through_at
),
roots as (
  select
    job.id,
    job.request_payload,
    job.request_payload#>>'{arguments,kind}' as kind,
    job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}' as item_key
  from sellerpilot_private.channel_gateway_jobs job
  where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
    and nullif(job.request_payload->>'continuationOf','') is null
),
valid_roots as (
  select
    root.id,root.kind,root.item_key,0 as depth,
    (root.request_payload#>>'{arguments,query,page}')::integer as page_number,
    (root.request_payload#>>'{arguments,query,size}')::integer as page_size,
    sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
    ) as from_at,
    sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
    ) as through_at,
    sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
    ) as observed_at
  from roots root
  join sellerpilot_private.channel_gateway_jobs job on job.id=root.id
  cross join expected
  where job.created_by=p_owner_id
    and job.credential_id=p_credential_id
    and job.channel='smartstore'
    and job.environment=p_environment
    and job.operation='inquiries.list'
    and root.kind in ('product','customer')
    and root.item_key=format('%s:%s:%s',root.kind,p_from_date,p_through_date)
    and root.request_payload->>'periodicKey'=format(
      'inquiries:history:%s:smartstore:%s:%s:%s',
      p_run_id,root.kind,p_from_date,p_through_date
    )
    and root.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'=p_coverage_mode
    and root.request_payload#>>'{arguments,query,page}'='1'
    and (
      (root.kind='product' and root.request_payload#>>'{arguments,query,size}'='100')
      or (root.kind='customer' and root.request_payload#>>'{arguments,query,size}'='200')
    )
    and sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
    )=expected.from_at
    and sellerpilot_private.try_timestamptz_v1(
      root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
    ) is not null
    and (
      (p_coverage_mode='full_day'
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
        )=expected.full_day_through_at
        and (sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
        ) at time zone 'Asia/Seoul')::date>p_through_date)
      or
      (p_coverage_mode='cutoff'
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
        )=sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
        )
        and (sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
        ) at time zone 'Asia/Seoul')::date=p_through_date)
    )
    and (
      (root.kind='product'
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,query,fromDate}'
        )=expected.from_at
        and sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,query,toDate}'
        )=sellerpilot_private.try_timestamptz_v1(
          root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
        ))
      or
      (root.kind='customer'
        and root.request_payload#>>'{arguments,query,startSearchDate}'=p_from_date::text
        and root.request_payload#>>'{arguments,query,endSearchDate}'=p_through_date::text)
    )
),
lineage(id,kind,item_key,depth,page_number,page_size,from_at,through_at,observed_at) as (
  select id,kind,item_key,depth,page_number,page_size,from_at,through_at,observed_at
    from valid_roots
  union all
  select
    child.id,parent.kind,parent.item_key,parent.depth+1,parent.page_number+1,parent.page_size,
    parent.from_at,parent.through_at,parent.observed_at
  from lineage parent
  join sellerpilot_private.channel_gateway_jobs child
    on child.request_payload->>'continuationOf'=parent.id::text
  where child.created_by=p_owner_id
    and child.credential_id=p_credential_id
    and child.channel='smartstore'
    and child.environment=p_environment
    and child.operation='inquiries.list'
    and child.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
    and child.request_payload#>>'{arguments,sellerpilotHistoryItemKey}'=parent.item_key
    and child.request_payload#>>'{arguments,kind}'=parent.kind
    and child.request_payload#>>'{arguments,sellerpilotHistoryCoverageMode}'=p_coverage_mode
    and sellerpilot_private.try_timestamptz_v1(
      child.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'
    )=parent.from_at
    and sellerpilot_private.try_timestamptz_v1(
      child.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
    )=parent.through_at
    and sellerpilot_private.try_timestamptz_v1(
      child.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}'
    )=parent.observed_at
    and child.request_payload#>>'{arguments,sellerpilotPaginationDepth}'
      ~ '^[1-9][0-9]?$'
    and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer
      =parent.depth+1
    and (child.request_payload#>>'{arguments,sellerpilotPaginationDepth}')::integer<=50
    and child.request_payload#>>'{arguments,query,page}' ~ '^[1-9][0-9]{0,6}$'
    and (child.request_payload#>>'{arguments,query,page}')::integer=parent.page_number+1
    and child.request_payload#>>'{arguments,query,size}'=parent.page_size::text
    and child.request_payload->>'periodicKey'=format(
      'continuation:%s:%s',parent.id,parent.depth+1
    )
    and (
      (parent.kind='product'
        and sellerpilot_private.try_timestamptz_v1(
          child.request_payload#>>'{arguments,query,fromDate}'
        )=parent.from_at
        and sellerpilot_private.try_timestamptz_v1(
          child.request_payload#>>'{arguments,query,toDate}'
        )=parent.through_at)
      or
      (parent.kind='customer'
        and child.request_payload#>>'{arguments,query,startSearchDate}'=p_from_date::text
        and child.request_payload#>>'{arguments,query,endSearchDate}'=p_through_date::text)
    )
),
tagged as (
  select job.id,job.request_payload
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
)
select coalesce(
  p_coverage_mode in ('cutoff','full_day')
  and (select count(*) from roots)=2
  and (select count(*) from valid_roots)=2
  and (select count(*) from valid_roots where kind='product')=1
  and (select count(*) from valid_roots where kind='customer')=1
  and (select count(distinct through_at) from valid_roots)=1
  and (select count(distinct observed_at) from valid_roots)=1
  and (select count(*) from tagged)=(select count(*) from lineage)
  and not exists (
    select 1 from tagged
     where not exists (select 1 from lineage where lineage.id=tagged.id)
  )
  and not exists (
    select 1 from tagged
     where nullif(tagged.request_payload->>'continuationOf','') is not null
     group by tagged.request_payload->>'continuationOf'
     having count(*)<>1
  ),false
)
$$;

revoke all on function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
  uuid,uuid,uuid,text,date,date,text
) from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  p_from_date date,
  p_through_date date,
  p_credential_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := date_trunc('milliseconds',clock_timestamp());
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_history_days integer;
  v_credential record;
  v_coverage_mode text;
  v_request_key text;
  v_existing_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_existing_from_text text;
  v_existing_through_text text;
  v_existing_observed_text text;
  v_retried_jobs integer := 0;
  v_result jsonb;
begin
  if v_actor is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_from_date is null or p_through_date is null or p_from_date>p_through_date
     or p_from_date<date '2000-01-01' or p_through_date-p_from_date>29
     or p_through_date>v_today or p_environment is distinct from 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_EXACT_HISTORY_WINDOW_INVALID' using errcode='22023';
  end if;
  v_history_days:=p_through_date-p_from_date+1;
  v_coverage_mode:=case when p_through_date=v_today then 'cutoff' else 'full_day' end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:smartstore:'||p_environment)
  );
  if not exists (
    select 1 from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel='smartstore' and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode='55000';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment=p_environment
     and credential.status='active'
     and credential.created_by is not null
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>v_now)
   for update;
  if not found then
    raise exception 'SMARTSTORE_EXACT_HISTORY_CREDENTIAL_INVALID' using errcode='42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id<>v_credential.id and other.channel='smartstore'
       and other.environment=p_environment and other.status='active'
       and (other.expires_at is null or other.expires_at>v_now)
  ) then
    raise exception 'SMARTSTORE_EXACT_HISTORY_ACTIVE_SCOPE_AMBIGUOUS' using errcode='55000';
  end if;

  -- v7 deliberately adopts the compatible v6 request lineage so installing
  -- the continuation fix cannot duplicate a window already accepted by v6.
  v_request_key:=encode(extensions.digest(concat_ws('|',
    'channel-inquiry-history-smartstore-exact-v6',v_credential.created_by::text,
    v_credential.id::text,v_credential.seller_account_key,p_environment,
    p_from_date::text,p_through_date::text,v_history_days::text,v_coverage_mode
  ),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sellerpilot:inquiry-history:'||v_request_key)
  );
  select run.* into v_existing_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.request_key=v_request_key for update;

  if not found then
    v_result:=public.sellerpilot_start_smartstore_inquiry_history_window_v6(
      p_from_date,p_through_date,p_credential_id,p_environment
    );
    return v_result||jsonb_build_object(
      'contract','sellerpilot-smartstore-exact-history-window/7'
    );
  end if;

  if v_existing_run.owner_id<>v_credential.created_by
     or v_existing_run.history_days<>v_history_days
     or v_existing_run.range_start<>p_from_date
     or v_existing_run.range_end<>p_through_date
     or v_existing_run.channels<>array['smartstore']::text[]
     or v_existing_run.credential_ids->>'smartstore' is distinct from v_credential.id::text
     or sellerpilot_private.smartstore_history_run_lineage_valid_v1(
       v_existing_run.id,v_credential.created_by,v_credential.id,p_environment,
       p_from_date,p_through_date,v_coverage_mode
     ) is distinct from true then
    raise exception 'SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH' using errcode='55000';
  end if;

  select
    min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageFromAt}'),
    min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'),
    min(job.request_payload#>>'{arguments,sellerpilotHistoryCoverageObservedAt}')
    into v_existing_from_text,v_existing_through_text,v_existing_observed_text
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
     and nullif(job.request_payload->>'continuationOf','') is null;

  if v_existing_run.status='failed' then
    update sellerpilot_private.channel_gateway_jobs job set
      status='queued',worker_token_id=null,claim_token=null,lease_expires_at=null,
      completed_at=null,error_message=null,updated_at=clock_timestamp()
     where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_existing_run.id::text
       and job.created_by=v_credential.created_by
       and job.credential_id=v_credential.id
       and job.channel='smartstore' and job.environment=p_environment
       and job.operation='inquiries.list' and job.status='failed'
       and job.attempt_count<4 and not job.credential_refresh_in_flight
       and job.credential_refresh_recovery_vault_id is null;
    get diagnostics v_retried_jobs=row_count;
  end if;

  return sellerpilot_private.refresh_inquiry_history_backfill_run(v_existing_run.id)
    ||jsonb_build_object(
      'contract','sellerpilot-smartstore-exact-history-window/7',
      'reused',true,'retriedJobs',v_retried_jobs,'acceptedNotCompleted',true,
      'coverageMode',v_coverage_mode,
      'fullCalendarDayCoverage',v_coverage_mode='full_day',
      'coverageFromAt',v_existing_from_text,
      'coverageThroughAt',v_existing_through_text,
      'coverageObservedAt',v_existing_observed_text
    );
end
$$;

revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v6(
  date,date,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  date,date,uuid,text
) from public,anon,service_role;
grant execute on function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  date,date,uuid,text
) to authenticated;

comment on function sellerpilot_private.smartstore_history_run_lineage_valid_v1(
  uuid,uuid,uuid,text,date,date,text
) is 'Internal exact SmartStore root plus continuation lineage validator.';
comment on function public.sellerpilot_start_smartstore_inquiry_history_window_v7(
  date,date,uuid,text
) is 'Admin-only v6-compatible SmartStore history enqueue/retry that accepts valid page continuations and rejects forged or duplicate lineages.';

notify pgrst,'reload schema';

-- Reviewed source: 20260908155620_cs_smartstore_checkpoint_deferred_cutoff_v4.sql
-- Source SHA256: 7f7096901dab9a77ac5cb09d4ba47cabaaaea28cfe27ec83bfd4d387542a9b61
-- Proposal only. Apply after smartstore-009-continuation-safe-window-v7.sql.
-- A reconciled current-day cutoff is still incomplete, but it is deferred
-- while older full-day windows remain. After the date rolls over, the same
-- window becomes eligible for a distinct full-day v7 run.
create or replace function sellerpilot_private.smartstore_history_run_reconciled_v1(
  p_run_id uuid,
  p_owner_id uuid,
  p_credential_id uuid,
  p_environment text,
  p_from_date date,
  p_through_date date,
  p_coverage_mode text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
with recursive target_run as (
  select run.*
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id=p_run_id
     and run.owner_id=p_owner_id
     and run.range_start=p_from_date
     and run.range_end=p_through_date
     and run.history_days=p_through_date-p_from_date+1
     and run.channels=array['smartstore']::text[]
     and run.credential_ids->>'smartstore'=p_credential_id::text
     and run.status='succeeded'
     and run.completed_at is not null
     and run.expected_initial_jobs=2
     and run.total_jobs>=run.expected_initial_jobs
     and run.succeeded_jobs=run.total_jobs
     and run.queued_jobs=0 and run.running_jobs=0 and run.failed_jobs=0
),
tagged_jobs as (
  select job.*
    from sellerpilot_private.channel_gateway_jobs job
   where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=p_run_id::text
),
roots as (
  select job.*
    from tagged_jobs job
   where nullif(job.request_payload->>'continuationOf','') is null
),
job_roots(job_id,root_job_id) as (
  select root.id,root.id from roots root
  union all
  select child.id,parent.root_job_id
    from job_roots parent
    join tagged_jobs child
      on child.request_payload->>'continuationOf'=parent.job_id::text
),
matched as (
  select root.request_payload#>>'{arguments,kind}' as kind
    from roots root
    join sellerpilot_private.cs_history_scans scan
      on scan.root_job_id=root.id
     and scan.owner_id=root.created_by
     and scan.credential_id=root.credential_id
     and scan.channel=root.channel
     and scan.environment=root.environment
   where root.status='succeeded'
     and scan.scope_key=format(
       'inquiries:history:%s:smartstore:%s:%s:%s',p_run_id,
       root.request_payload#>>'{arguments,kind}',p_from_date,p_through_date
     )
     and scan.ticket_kind=root.request_payload#>>'{arguments,kind}'
     and scan.status='completed'
     and scan.scan_completed_at is not null
     and scan.reconciled_at is not null
     and scan.unprocessed_count=0
     and scan.timezone_name='Asia/Seoul'
     and scan.range_start_at=p_from_date::timestamp at time zone 'Asia/Seoul'
     and scan.range_end_at=sellerpilot_private.try_timestamptz_v1(
       root.request_payload#>>'{arguments,sellerpilotHistoryCoverageThroughAt}'
     )
     and scan.scope_digest=encode(extensions.digest(
       pg_catalog.convert_to(root.request_payload::text,'UTF8'),'sha256'
     ),'hex')
),
matched_pages as (
  select mapped.job_id
    from job_roots mapped
    join sellerpilot_private.cs_history_scans scan
      on scan.root_job_id=mapped.root_job_id
    join sellerpilot_private.cs_history_scan_pages page
      on page.scan_id=scan.id and page.job_id=mapped.job_id
   where page.continuation_expected=exists(
     select 1 from tagged_jobs child
      where child.request_payload->>'continuationOf'=mapped.job_id::text
   )
)
select coalesce(
  exists(select 1 from target_run)
  and sellerpilot_private.smartstore_history_run_lineage_valid_v1(
    p_run_id,p_owner_id,p_credential_id,p_environment,
    p_from_date,p_through_date,p_coverage_mode
  )
  and (select count(*) from tagged_jobs)=(select total_jobs from target_run)
  and not exists(select 1 from tagged_jobs where status<>'succeeded')
  and (select count(*) from matched_pages)=(select count(*) from tagged_jobs)
  and (select count(*) from matched)=2
  and (select count(*) from matched where kind='product')=1
  and (select count(*) from matched where kind='customer')=1,
  false
)
$$;

revoke all on function sellerpilot_private.smartstore_history_run_reconciled_v1(
  uuid,uuid,uuid,text,date,date,text
) from public,anon,authenticated,service_role;

create or replace function public.sellerpilot_next_smartstore_history_window_v4(
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
  v_now timestamptz:=statement_timestamp();
  v_today date:=(v_now at time zone 'Asia/Seoul')::date;
  v_owner_id uuid;
  v_total integer:=0;
  v_completed integer:=0;
  v_window_start date;
  v_window_end date;
  v_window_complete boolean;
  v_cutoff_observed boolean;
  v_next_start date;
  v_next_end date;
  v_deferred_start date;
  v_deferred_end date;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_floor_date is null or p_through_date is null or p_floor_date>p_through_date
     or p_floor_date<date '2000-01-01' or p_through_date-p_floor_date>5000
     or p_through_date>v_today or p_environment is distinct from 'production'
     or p_credential_id is null then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_RANGE_INVALID' using errcode='22023';
  end if;

  select credential.created_by into v_owner_id
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.created_by is not null
     and credential.channel='smartstore'
     and credential.environment=p_environment
     and credential.status='active'
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>v_now)
   limit 1;
  if not found then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_CREDENTIAL_INVALID' using errcode='42501';
  end if;
  if exists (
    select 1 from sellerpilot_private.channel_credentials other
     where other.id<>p_credential_id and other.channel='smartstore'
       and other.environment=p_environment and other.status='active'
       and (other.expires_at is null or other.expires_at>v_now)
  ) then
    raise exception 'SMARTSTORE_HISTORY_CHECKPOINT_ACTIVE_SCOPE_AMBIGUOUS' using errcode='55000';
  end if;

  v_window_end:=p_through_date;
  loop
    v_window_start:=greatest(p_floor_date,v_window_end-29);
    v_total:=v_total+1;

    select v_window_end<v_today and exists (
      select 1
        from sellerpilot_private.inquiry_history_backfill_runs run
       where run.owner_id=v_owner_id
         and run.range_start=v_window_start
         and run.range_end=v_window_end
         and sellerpilot_private.smartstore_history_run_reconciled_v1(
           run.id,v_owner_id,p_credential_id,p_environment,
           v_window_start,v_window_end,'full_day'
         )
    ) into v_window_complete;

    select v_window_end=v_today and exists (
      select 1
        from sellerpilot_private.inquiry_history_backfill_runs run
       where run.owner_id=v_owner_id
         and run.range_start=v_window_start
         and run.range_end=v_window_end
         and sellerpilot_private.smartstore_history_run_reconciled_v1(
           run.id,v_owner_id,p_credential_id,p_environment,
           v_window_start,v_window_end,'cutoff'
         )
    ) into v_cutoff_observed;

    if v_window_complete then
      v_completed:=v_completed+1;
    elsif v_cutoff_observed then
      v_deferred_start:=v_window_start;
      v_deferred_end:=v_window_end;
    elsif v_next_start is null then
      v_next_start:=v_window_start;
      v_next_end:=v_window_end;
    end if;

    exit when v_window_start=p_floor_date;
    v_window_end:=v_window_start-1;
  end loop;

  -- A current cutoff is never completion. Once it has been reconciled, leave
  -- it behind older missing full-day windows; return it again only when no
  -- older work remains so the route never represents the full range complete.
  if v_next_start is null and v_deferred_start is not null then
    v_next_start:=v_deferred_start;
    v_next_end:=v_deferred_end;
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-smartstore-history-checkpoint/4',
    'checkedAt',v_now,
    'environment',p_environment,
    'totalWindowCount',v_total,
    'completedWindowCount',v_completed,
    'remainingWindowCount',v_total-v_completed,
    'complete',v_next_start is null,
    'nextWindow',case when v_next_start is null then null else jsonb_build_object(
      'key',format('smartstore:history:v4:%s:%s',v_next_start,v_next_end),
      'fromDate',v_next_start,
      'throughDate',v_next_end,
      'productItemKey',format('product:%s:%s',v_next_start,v_next_end),
      'customerItemKey',format('customer:%s:%s',v_next_start,v_next_end)
    ) end,
    'advanceRule','current_cutoff_deferred_behind_older_exact_full_kst_day_windows'
  );
end
$$;

revoke all on function public.sellerpilot_next_smartstore_history_window_v3(
  date,date,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_next_smartstore_history_window_v4(
  date,date,uuid,text
) from public,anon,service_role;
grant execute on function public.sellerpilot_next_smartstore_history_window_v4(
  date,date,uuid,text
) to authenticated;

comment on function sellerpilot_private.smartstore_history_run_reconciled_v1(
  uuid,uuid,uuid,text,date,date,text
) is 'Internal exact-run, exact-lineage and two-kind reconciled SmartStore coverage check.';
comment on function public.sellerpilot_next_smartstore_history_window_v4(
  date,date,uuid,text
) is 'Admin-only checkpoint that defers a reconciled current cutoff behind older full-day work without ever counting that cutoff complete.';

notify pgrst,'reload schema';

-- Reviewed source: 20260909152143_cs_smartstore_account_scope.sql
-- Source SHA256: 29b126c68069ce7180f057025c1f871255d3df8a1a005517ce5f1bbc99b1acb9
drop index if exists sellerpilot_private.channel_credentials_one_active_idx;
drop index if exists sellerpilot_private.channel_credentials_one_active_non_lazada_idx;
drop index if exists sellerpilot_private.channel_credentials_one_active_non_lazada_elevenst_idx;
-- Preserve the currently installed 11st uniqueness; only SmartStore is scoped here.
create unique index channel_credentials_one_active_non_lazada_smartstore_idx
  on sellerpilot_private.channel_credentials(channel,environment)
  where status='active' and channel not in('lazada','smartstore');
create unique index channel_credentials_one_active_smartstore_account_idx
  on sellerpilot_private.channel_credentials(
    created_by,channel,environment,seller_account_key
  )
  where status='active' and channel='smartstore'
    and seller_account_key is not null;
create unique index channel_credentials_one_active_smartstore_legacy_idx
  on sellerpilot_private.channel_credentials(
    created_by,channel,environment
  )
  where status='active' and channel='smartstore'
    and seller_account_key is null;

create table sellerpilot_private.smartstore_cs_ticket_identities_v1(
  ticket_id uuid primary key
    references sellerpilot_private.support_tickets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  seller_account_key text not null,
  source_credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  provider_ticket_kind text not null
    check(provider_ticket_kind in('product','customer')),
  provider_ticket_id text not null check(provider_ticket_id~'^[1-9][0-9]{0,18}$'),
  legacy_external_ticket_id text not null,
  identity_contract text not null
    check(identity_contract in(
      'smartstore-provider-ticket-v1',
      'smartstore-legacy-ticket-compat-v1'
    )),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id,seller_account_key,provider_ticket_kind,provider_ticket_id)
);
create index smartstore_cs_ticket_identity_credential_idx
  on sellerpilot_private.smartstore_cs_ticket_identities_v1(
    owner_id,source_credential_id,updated_at desc
  );
alter table sellerpilot_private.smartstore_cs_ticket_identities_v1
  enable row level security;
revoke all on sellerpilot_private.smartstore_cs_ticket_identities_v1
  from public,anon,authenticated,service_role;

create function sellerpilot_private.sync_smartstore_cs_ticket_identity_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing sellerpilot_private.smartstore_cs_ticket_identities_v1%rowtype;
  v_kind text;
  v_provider_id text;
  v_expected_legacy text;
  v_contract text;
begin
  if new.channel_key<>'smartstore' or new.demo then
    delete from sellerpilot_private.smartstore_cs_ticket_identities_v1
     where ticket_id=new.id;
    return new;
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=new.source_credential_id
     and credential.created_by=new.owner_id
     and credential.channel='smartstore'
     and credential.environment='production'
     and credential.status in('active','grace')
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found
     or new.seller_account_key is distinct from v_credential.seller_account_key
     or new.channel_account_id is distinct from new.source_credential_id then
    delete from sellerpilot_private.smartstore_cs_ticket_identities_v1
     where ticket_id=new.id;
    return new;
  end if;

  v_kind:=coalesce(
    nullif(new.provider_context->>'providerTicketKind',''),
    nullif(new.provider_context->>'kind','')
  );
  v_provider_id:=case v_kind
    when 'product' then coalesce(
      nullif(new.provider_context->>'providerTicketId',''),
      nullif(new.provider_context->>'questionId',''),
      nullif(regexp_replace(new.external_ticket_id,'^smartstore:product-qna:',''),'')
    )
    when 'customer' then coalesce(
      nullif(new.provider_context->>'providerTicketId',''),
      nullif(new.provider_context->>'inquiryNo',''),
      nullif(regexp_replace(new.external_ticket_id,'^customer:',''),'')
    )
    else null end;
  v_expected_legacy:=case v_kind
    when 'product' then 'smartstore:product-qna:'||coalesce(v_provider_id,'')
    when 'customer' then 'customer:'||coalesce(v_provider_id,'')
    else null end;
  if v_provider_id is null
     or v_provider_id!~'^[1-9][0-9]{0,18}$'
     or new.external_ticket_id is distinct from v_expected_legacy
     or (
       new.provider_context ? 'legacyExternalTicketId'
       and new.provider_context->>'legacyExternalTicketId'
         is distinct from v_expected_legacy
     )
     or (
       new.provider_context ? 'providerTicketId'
       and new.provider_context->>'providerTicketId' is distinct from v_provider_id
     )
     or (
       new.provider_context ? 'providerTicketKind'
       and new.provider_context->>'providerTicketKind' is distinct from v_kind
     ) then
    raise exception 'SMARTSTORE_CS_TICKET_PROVIDER_IDENTITY_INVALID'
      using errcode='23514';
  end if;

  v_contract:=case
    when new.provider_context->>'identityContract'
      ='smartstore-provider-ticket-v1'
      then 'smartstore-provider-ticket-v1'
    when not(new.provider_context ? 'identityContract')
      then 'smartstore-legacy-ticket-compat-v1'
    else null end;
  if v_contract is null then
    raise exception 'SMARTSTORE_CS_TICKET_IDENTITY_CONTRACT_INVALID'
      using errcode='23514';
  end if;

  select identity.* into v_existing
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
   where identity.ticket_id=new.id
   for update;
  if found and (
    v_existing.owner_id is distinct from new.owner_id
    or v_existing.seller_account_key is distinct from v_credential.seller_account_key
    or v_existing.source_credential_id is distinct from new.source_credential_id
    or v_existing.provider_ticket_kind is distinct from v_kind
    or v_existing.provider_ticket_id is distinct from v_provider_id
  ) then
    raise exception 'SMARTSTORE_CS_TICKET_ACCOUNT_SCOPE_IMMUTABLE'
      using errcode='23514';
  end if;

  insert into sellerpilot_private.smartstore_cs_ticket_identities_v1(
    ticket_id,owner_id,seller_account_key,source_credential_id,
    provider_ticket_kind,provider_ticket_id,legacy_external_ticket_id,
    identity_contract,updated_at
  ) values(
    new.id,new.owner_id,v_credential.seller_account_key,new.source_credential_id,
    v_kind,v_provider_id,v_expected_legacy,v_contract,clock_timestamp()
  )
  on conflict(ticket_id) do update set
    identity_contract=case
      when excluded.identity_contract='smartstore-provider-ticket-v1'
        then excluded.identity_contract
      else sellerpilot_private.smartstore_cs_ticket_identities_v1.identity_contract
    end,
    updated_at=excluded.updated_at;
  return new;
end
$$;
revoke all on function
  sellerpilot_private.sync_smartstore_cs_ticket_identity_v1()
  from public,anon,authenticated,service_role;

create trigger sellerpilot_sync_smartstore_cs_ticket_identity_v1
after insert or update of owner_id,channel_key,external_ticket_id,demo,
  source_credential_id,channel_account_id,seller_account_key,provider_context
on sellerpilot_private.support_tickets
for each row execute function
  sellerpilot_private.sync_smartstore_cs_ticket_identity_v1();

insert into sellerpilot_private.smartstore_cs_ticket_identities_v1(
  ticket_id,owner_id,seller_account_key,source_credential_id,
  provider_ticket_kind,provider_ticket_id,legacy_external_ticket_id,
  identity_contract
)
select
  ticket.id,ticket.owner_id,ticket.seller_account_key,ticket.source_credential_id,
  ticket.provider_context->>'kind',
  case ticket.provider_context->>'kind'
    when 'product' then coalesce(
      nullif(ticket.provider_context->>'questionId',''),
      nullif(regexp_replace(ticket.external_ticket_id,'^smartstore:product-qna:',''),'')
    )
    when 'customer' then coalesce(
      nullif(ticket.provider_context->>'inquiryNo',''),
      nullif(regexp_replace(ticket.external_ticket_id,'^customer:',''),'')
    )
  end,
  ticket.external_ticket_id,
  case when ticket.provider_context->>'identityContract'
      ='smartstore-provider-ticket-v1'
    then 'smartstore-provider-ticket-v1'
    else 'smartstore-legacy-ticket-compat-v1' end
from sellerpilot_private.support_tickets ticket
join sellerpilot_private.channel_credentials credential
  on credential.id=ticket.source_credential_id
 and credential.created_by=ticket.owner_id
 and credential.channel='smartstore'
 and credential.environment='production'
 and credential.status in('active','grace')
 and credential.seller_account_key=ticket.seller_account_key
 and credential.seller_account_key_source in(
   'provider_certified_v1','credential_incarnation_v1'
 )
 and credential.seller_account_verified_at is not null
where ticket.channel_key='smartstore'
  and not ticket.demo
  and ticket.channel_account_id=ticket.source_credential_id
  and ticket.provider_context->>'kind' in('product','customer')
  and (
    (ticket.provider_context->>'kind'='product'
      and ticket.external_ticket_id~'^smartstore:product-qna:[1-9][0-9]{0,18}$')
    or
    (ticket.provider_context->>'kind'='customer'
      and ticket.external_ticket_id~'^customer:[1-9][0-9]{0,18}$')
  )
on conflict(ticket_id) do nothing;

create function public.sellerpilot_read_smartstore_cs_order_binding_health_v3(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_groups jsonb;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment='production'
     and credential.status='active'
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (
       credential.expires_at is null
       or credential.expires_at>statement_timestamp()
     );
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;

  with projected as(
    select case
      when ticket.provider_context->>'kind'='product' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'not_applicable' else 'contract_mismatch' end
      when ticket.provider_context->>'kind'<>'customer'
        then 'contract_mismatch'
      when ticket.provider_context->>'orderReferenceState'
          ='exact_product_order' then
        case when jsonb_typeof(
                    ticket.provider_context->'productOrderIds'
                  )='array'
               and jsonb_array_length(
                    ticket.provider_context->'productOrderIds'
                  )=1
               and ticket.provider_context->'productOrderIds'->>0
                    ~'^[1-9][0-9]{0,19}$'
               and nullif(trim(ticket.external_order_reference),'')
                    =ticket.provider_context->'productOrderIds'->>0
               and binding.status in(
                 'exact','unmatched','unverified_credential'
               )
               and binding.credential_id=p_credential_id
          then binding.status else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState'
          ='ambiguous_product_orders' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'ambiguous_product_orders' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState'
          ='invalid_product_order_list' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'invalid_product_order_list' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState'='unavailable' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'not_applicable' else 'contract_mismatch' end
      else 'contract_mismatch' end ui_status
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
    join sellerpilot_private.support_tickets ticket
      on ticket.id=identity.ticket_id
    join sellerpilot_private.cs_order_bindings binding
      on binding.ticket_id=ticket.id
    where identity.owner_id=v_credential.created_by
      and identity.seller_account_key=v_credential.seller_account_key
      and identity.source_credential_id=p_credential_id
      and ticket.owner_id=v_credential.created_by
      and ticket.source_credential_id=p_credential_id
      and ticket.seller_account_key=v_credential.seller_account_key
      and not ticket.demo
  ),grouped as(
    select ui_status status,count(*)::integer count
      from projected group by ui_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel','smartstore','status',status,'count',count
  )order by status),'[]'::jsonb)
    into v_groups from grouped;

  return jsonb_build_object(
    'contract','sellerpilot-cs-smartstore-order-binding-health/3',
    'projectionContract','smartstore-cs-order-binding-projection/1',
    'checkedAt',statement_timestamp(),
    'credentialId',p_credential_id,
    'accountScope',encode(extensions.digest(
      v_credential.seller_account_key,'sha256'
    ),'hex'),
    'matchingRule',
      'same_owner_account_source_credential_exact_product_order',
    'automaticOrderLinkState','exact',
    'csCommerceMutationAllowed',false,
    'groups',v_groups
  );
end
$$;

create function public.sellerpilot_read_smartstore_cs_account_ticket_v1(
  p_credential_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_identity sellerpilot_private.smartstore_cs_ticket_identities_v1%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_history jsonb;
  v_binding jsonb;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment='production'
     and credential.status in('active','grace')
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;

  select identity.*
    into v_identity
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
    join sellerpilot_private.support_tickets ticket
      on ticket.id=identity.ticket_id
   where identity.ticket_id=p_ticket_id
     and identity.owner_id=v_credential.created_by
     and identity.seller_account_key=v_credential.seller_account_key
     and identity.source_credential_id=p_credential_id
     and ticket.owner_id=identity.owner_id
     and ticket.source_credential_id=identity.source_credential_id
     and ticket.seller_account_key=identity.seller_account_key
     and not ticket.demo;
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id=v_identity.ticket_id
     and ticket.owner_id=v_identity.owner_id
     and ticket.source_credential_id=v_identity.source_credential_id
     and ticket.seller_account_key=v_identity.seller_account_key
     and not ticket.demo;
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'inboundKey',message.inbound_key,
    'remoteMessageId',message.remote_message_id,
    'senderRole',message.sender_role,
    'body',message.body,
    'receivedAt',message.received_at
  )order by message.received_at,message.id),'[]'::jsonb)
    into v_history
    from sellerpilot_private.support_inbound_messages message
   where message.ticket_id=v_ticket.id
     and message.owner_id=v_identity.owner_id
     and message.channel_key='smartstore';

  select case when binding.ticket_id is null then null else
    jsonb_build_object(
      'status',binding.status,
      'externalOrderReference',binding.external_order_reference,
      'orderId',binding.order_id,
      'credentialId',binding.credential_id
    ) end
    into v_binding
    from (select 1) seed
    left join sellerpilot_private.cs_order_bindings binding
      on binding.ticket_id=v_ticket.id
     and (
       binding.credential_id is null
       or binding.credential_id=p_credential_id
     );

  return jsonb_build_object(
    'contract','sellerpilot-cs-smartstore-account-ticket/1',
    'credentialId',p_credential_id,
    'accountScope',encode(extensions.digest(
      v_credential.seller_account_key,'sha256'
    ),'hex'),
    'identity',jsonb_build_object(
      'kind',v_identity.provider_ticket_kind,
      'providerTicketId',v_identity.provider_ticket_id,
      'legacyExternalTicketId',v_identity.legacy_external_ticket_id,
      'identityContract',v_identity.identity_contract
    ),
    'ticket',jsonb_build_object(
      'id',v_ticket.id,
      'message',v_ticket.message,
      'latestInboundKey',v_ticket.latest_inbound_key,
      'externalOrderReference',v_ticket.external_order_reference
    ),
    'history',v_history,
    'orderBinding',v_binding,
    'csCommerceMutationAllowed',false
  );
end
$$;

revoke all on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
  from public,anon,authenticated,service_role;
revoke all on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v3(uuid)
  from public,anon,service_role;
grant execute on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v3(uuid)
  to authenticated;
revoke all on function
  public.sellerpilot_read_smartstore_cs_account_ticket_v1(uuid,uuid)
  from public,anon,service_role;
grant execute on function
  public.sellerpilot_read_smartstore_cs_account_ticket_v1(uuid,uuid)
  to authenticated;

comment on table
  sellerpilot_private.smartstore_cs_ticket_identities_v1 is
  'Compatibility sidecar preserving legacy SmartStore external IDs while binding each ticket to owner, seller account, and source credential.';
comment on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v3(uuid) is
  'Approved-admin read of one exact SmartStore owner/account/source-credential order-binding scope.';
comment on function
  public.sellerpilot_read_smartstore_cs_account_ticket_v1(uuid,uuid) is
  'Approved-admin ticket, inbound-history, and order-binding read within one exact SmartStore account scope.';

notify pgrst,'reload schema';

-- Reviewed source: 20260909152145_cs_smartstore_exact_reply_readback.sql
-- Source SHA256: dedce79346097e1b6353c9893b16986f0f079147b32bdbfe253715c477aa3899
-- A SmartStore provider ACK is only transport acceptance. Queue one bounded,
-- read-only provider list request and resolve the ticket only after the common
-- observation ledger sees the exact account, target, generation and body.
alter table sellerpilot_private.support_reply_deliveries
  add column smartstore_readback_state text
    check(smartstore_readback_state in('pending','verified','unverified','failed')),
  add column smartstore_readback_reason text,
  add column smartstore_readback_checked_at timestamptz,
  add column smartstore_automatic_resend_allowed boolean not null default false;

alter table sellerpilot_private.support_reply_deliveries
  add constraint support_reply_deliveries_smartstore_no_automatic_resend check(
    channel_key<>'smartstore' or smartstore_automatic_resend_allowed=false
  );

create table sellerpilot_private.smartstore_reply_readback_links_v1(
  source_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  delivery_id uuid not null unique
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  ticket_id uuid not null
    references sellerpilot_private.support_tickets(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check(seller_account_key~'^[a-f0-9]{64}$'),
  provider_ticket_kind text not null
    check(provider_ticket_kind in('product','customer')),
  provider_ticket_id text not null check(provider_ticket_id~'^[1-9][0-9]{0,18}$'),
  expected_inbound_key text not null check(expected_inbound_key~'^smartstore:[a-f0-9]{64}$'),
  expected_reply_fingerprint text not null check(expected_reply_fingerprint~'^[a-f0-9]{64}$'),
  accepted_after timestamptz not null,
  state text not null default 'pending'
    check(state in('pending','verified','unverified','failed')),
  reason text,
  observed_message_id uuid
    references sellerpilot_private.support_inbound_messages(id) on delete set null,
  checked_at timestamptz,
  automatic_resend_allowed boolean not null default false
    check(automatic_resend_allowed=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.smartstore_reply_readback_links_v1 enable row level security;
revoke all on sellerpilot_private.smartstore_reply_readback_links_v1
  from public,anon,authenticated,service_role;

create function sellerpilot_private.prepare_smartstore_reply_readback_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.channel_key='smartstore' and new.status='succeeded'
     and new.smartstore_readback_state is null then
    new.smartstore_readback_state:='pending';
    new.smartstore_readback_reason:='provider_accepted_exact_readback_pending';
    new.smartstore_automatic_resend_allowed:=false;
  end if;
  return new;
end
$$;
revoke all on function sellerpilot_private.prepare_smartstore_reply_readback_v1()
  from public,anon,authenticated,service_role;
create trigger prepare_smartstore_reply_readback_v1
before insert or update of status,verification_status
on sellerpilot_private.support_reply_deliveries
for each row execute function sellerpilot_private.prepare_smartstore_reply_readback_v1();

create function sellerpilot_private.enqueue_smartstore_reply_readback_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_identity sellerpilot_private.smartstore_cs_ticket_identities_v1%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_readback_job_id uuid:=gen_random_uuid();
  v_kind text;
  v_provider_ticket_id text;
  v_reply text;
  v_reply_fingerprint text;
  v_query jsonb;
  v_from timestamptz;
  v_to timestamptz;
begin
  if new.channel_key<>'smartstore' or new.status<>'succeeded'
     or new.verification_status<>'provider_accepted' then
    return new;
  end if;
  if exists(select 1 from sellerpilot_private.smartstore_reply_readback_links_v1
    where source_job_id=new.gateway_job_id) then
    return new;
  end if;

  select job.* into v_source
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=new.gateway_job_id
   for update;
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id=new.ticket_id
     and ticket.owner_id=new.owner_id
     and ticket.channel_key='smartstore'
     and not ticket.demo
   for update;
  select identity.* into v_identity
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
   where identity.ticket_id=new.ticket_id
   for share;
  if v_source.id is null or v_ticket.id is null or v_identity.ticket_id is null
     or v_source.channel<>'smartstore' or v_source.operation<>'inquiries.reply'
     or v_source.status<>'succeeded'
     or v_source.provider_mutation_started_at is null
     or v_source.request_payload->>'sellerpilotTicketId' is distinct from v_ticket.id::text
     or v_source.request_payload->>'sellerpilotInboundKey' is distinct from v_ticket.latest_inbound_key then
    raise exception 'SMARTSTORE_REPLY_READBACK_SOURCE_INVALID' using errcode='23514';
  end if;

  v_kind:=coalesce(nullif(v_source.request_payload#>>'{arguments,kind}',''),'product');
  v_provider_ticket_id:=case v_kind
    when 'product' then v_source.request_payload#>>'{arguments,questionId}'
    when 'customer' then v_source.request_payload#>>'{arguments,inquiryNo}'
    else null end;
  v_reply:=nullif(trim(v_source.request_payload#>>'{arguments,reply}'),'');
  v_reply_fingerprint:=case when v_reply is null then null else
    encode(extensions.digest(v_reply,'sha256'),'hex') end;
  if v_kind is distinct from v_identity.provider_ticket_kind
     or v_provider_ticket_id is distinct from v_identity.provider_ticket_id
     or v_source.request_payload->>'sellerpilotReplyFingerprint'
          is distinct from new.reply_fingerprint
     or v_reply_fingerprint is distinct from new.reply_fingerprint
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,contract}'
          is distinct from 'sellerpilot-reply-acceptance/1'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,level}'
          is distinct from 'provider_accepted'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,channel}'
          is distinct from 'smartstore'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,kind}'
          is distinct from v_kind
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,bindingDigest}'
          is distinct from encode(extensions.digest(
            case v_kind
              when 'product' then '{"questionId":"'||v_provider_ticket_id||'"}'
              else '{"inquiryNo":"'||v_provider_ticket_id||'"}' end,
            'sha256'
          ),'hex') then
    raise exception 'SMARTSTORE_REPLY_READBACK_TARGET_INVALID' using errcode='23514';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_source.credential_id
     and credential.created_by=v_ticket.owner_id
     and credential.channel='smartstore'
     and credential.environment=v_source.environment
     and credential.status in('active','grace')
     and credential.seller_account_key=v_ticket.seller_account_key
     and credential.seller_account_key=v_identity.seller_account_key
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>statement_timestamp())
   for share;
  if v_credential.id is null
     or v_source.created_by is distinct from v_ticket.owner_id
     or v_source.credential_id is distinct from v_ticket.source_credential_id
     or v_source.credential_id is distinct from v_identity.source_credential_id
     or v_source.seller_account_key is distinct from v_ticket.seller_account_key
     or v_source.seller_account_key is distinct from v_identity.seller_account_key then
    raise exception 'SMARTSTORE_REPLY_READBACK_ACCOUNT_INVALID' using errcode='23514';
  end if;

  v_from:=v_ticket.received_at-interval '5 minutes';
  v_to:=v_ticket.received_at+interval '5 minutes';
  v_query:=case v_kind when 'product' then jsonb_build_object(
    'fromDate',to_char(v_from at time zone 'Asia/Seoul','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+09:00',
    'toDate',to_char(v_to at time zone 'Asia/Seoul','YYYY-MM-DD"T"HH24:MI:SS.MS')||'+09:00',
    'answered',true,'page',1,'size',100
  ) else jsonb_build_object(
    'startSearchDate',to_char(v_ticket.received_at at time zone 'Asia/Seoul','YYYY-MM-DD'),
    'endSearchDate',to_char(v_ticket.received_at at time zone 'Asia/Seoul','YYYY-MM-DD'),
    'answered',true,'page',1,'size',200
  ) end;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,
    request_payload,created_by,seller_account_key
  ) values(
    v_readback_job_id,v_source.credential_id,null,'smartstore','inquiries.list',
    v_source.environment,
    jsonb_build_object(
      'periodicKey','inquiries:reply-readback:smartstore:'||new.id::text,
      'arguments',jsonb_build_object(
        'kind',v_kind,
        case when v_kind='product' then 'questionId' else 'inquiryNo' end,
        v_provider_ticket_id,
        'query',v_query
      ),
      'sellerpilotSmartstoreReplyReadback',jsonb_build_object(
        'contract','sellerpilot-smartstore-reply-readback/1',
        'sourceJobId',v_source.id,'deliveryId',new.id,'ticketId',v_ticket.id,
        'kind',v_kind,'providerTicketId',v_provider_ticket_id,
        'expectedInboundKey',v_ticket.latest_inbound_key,
        'expectedReplyFingerprint',new.reply_fingerprint
      )
    ),
    v_source.created_by,v_source.seller_account_key
  );
  insert into sellerpilot_private.smartstore_reply_readback_links_v1(
    source_job_id,delivery_id,readback_job_id,ticket_id,owner_id,
    credential_id,seller_account_key,provider_ticket_kind,provider_ticket_id,
    expected_inbound_key,expected_reply_fingerprint,accepted_after
  ) values(
    v_source.id,new.id,v_readback_job_id,v_ticket.id,v_ticket.owner_id,
    v_source.credential_id,v_source.seller_account_key,v_kind,
    v_provider_ticket_id,v_ticket.latest_inbound_key,new.reply_fingerprint,
    v_source.provider_mutation_started_at
  );
  update sellerpilot_private.support_tickets ticket set
    status='in_progress',provider_status='waiting',
    provider_status_updated_at=clock_timestamp(),resolved_at=null,
    reply_delivery_status='sending',
    reply_delivery_error='판매채널 접수 후 동일 답변의 원격 재조회를 확인 중입니다.',
    updated_at=clock_timestamp()
   where ticket.id=v_ticket.id
     and ticket.latest_inbound_key=v_ticket.latest_inbound_key;
  return new;
end
$$;
revoke all on function sellerpilot_private.enqueue_smartstore_reply_readback_v1()
  from public,anon,authenticated,service_role;
create trigger enqueue_smartstore_reply_readback_v1
after insert or update of status,verification_status
on sellerpilot_private.support_reply_deliveries
for each row execute function sellerpilot_private.enqueue_smartstore_reply_readback_v1();

create function public.sellerpilot_service_record_smartstore_reply_readback_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_link sellerpilot_private.smartstore_reply_readback_links_v1%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_readback sellerpilot_private.channel_gateway_jobs%rowtype;
  v_target_count integer:=0;
  v_exact_count integer:=0;
  v_exact_message_id uuid;
  v_state text;
  v_reason text;
  v_checked_at timestamptz;
begin
  if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null then
    raise exception 'SMARTSTORE_REPLY_READBACK_ARGUMENT_INVALID' using errcode='22023';
  end if;
  select link.* into v_link
    from sellerpilot_private.smartstore_reply_readback_links_v1 link
   where link.readback_job_id=p_job_id
   for update;
  if not found then
    raise exception 'SMARTSTORE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000';
  end if;
  select delivery.* into v_delivery
    from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id=v_link.delivery_id
   for update;
  select readback.* into v_readback
    from sellerpilot_private.channel_gateway_jobs readback
   where readback.id=v_link.readback_job_id;
  if v_delivery.id is null or v_readback.id is null or not exists(
    select 1
      from sellerpilot_private.channel_gateway_jobs source
      join sellerpilot_private.support_tickets ticket
        on ticket.id=v_link.ticket_id
      join sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
        on identity.ticket_id=ticket.id
      join sellerpilot_private.channel_credentials credential
        on credential.id=v_link.credential_id
      join sellerpilot_private.gateway_completion_receipts receipt
        on receipt.job_id=v_readback.id and receipt.claim_token=p_claim_token
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id=receipt.worker_token_id and token.token_hash=p_token_hash
     where source.id=v_link.source_job_id
       and v_readback.channel='smartstore' and v_readback.operation='inquiries.list'
       and v_readback.status in('succeeded','failed','reconciliation_required')
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,contract}'
            ='sellerpilot-smartstore-reply-readback/1'
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,sourceJobId}'
            =source.id::text
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,deliveryId}'
            =v_delivery.id::text
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,ticketId}'
            =ticket.id::text
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,expectedInboundKey}'
            =v_link.expected_inbound_key
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,expectedReplyFingerprint}'
            =v_link.expected_reply_fingerprint
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,kind}'
            =v_link.provider_ticket_kind
       and v_readback.request_payload#>>'{sellerpilotSmartstoreReplyReadback,providerTicketId}'
            =v_link.provider_ticket_id
       and source.channel='smartstore' and source.operation='inquiries.reply'
       and source.status='succeeded' and source.provider_mutation_started_at=v_link.accepted_after
       and source.request_payload->>'sellerpilotInboundKey'=v_link.expected_inbound_key
       and source.request_payload->>'sellerpilotReplyFingerprint'=v_link.expected_reply_fingerprint
       and source.credential_id=v_link.credential_id and v_readback.credential_id=v_link.credential_id
       and source.created_by=v_link.owner_id and v_readback.created_by=v_link.owner_id
       and source.seller_account_key=v_link.seller_account_key
       and v_readback.seller_account_key=v_link.seller_account_key
       and ticket.owner_id=v_link.owner_id and ticket.source_credential_id=v_link.credential_id
       and ticket.seller_account_key=v_link.seller_account_key
       and identity.owner_id=v_link.owner_id
       and identity.source_credential_id=v_link.credential_id
       and identity.seller_account_key=v_link.seller_account_key
       and identity.provider_ticket_kind=v_link.provider_ticket_kind
       and identity.provider_ticket_id=v_link.provider_ticket_id
       and credential.created_by=v_link.owner_id and credential.channel='smartstore'
       and credential.seller_account_key=v_link.seller_account_key
       and token.scope in('gateway','legacy_combined','serverless_cs')
       and token.status='active' and token.expires_at>statement_timestamp()
  ) then
    raise exception 'SMARTSTORE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000';
  end if;
  v_checked_at:=coalesce(v_readback.completed_at,v_readback.updated_at,clock_timestamp());

  select count(*),count(*) filter(where
      encode(extensions.digest(regexp_replace(message.body,
        '^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')
        =v_link.expected_reply_fingerprint),
    (min(message.id::text) filter(where
      encode(extensions.digest(regexp_replace(message.body,
        '^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')
        =v_link.expected_reply_fingerprint))::uuid
    into v_target_count,v_exact_count,v_exact_message_id
    from sellerpilot_private.support_inbound_messages message
   where message.ticket_id=v_link.ticket_id
     and message.owner_id=v_link.owner_id
     and message.channel_key='smartstore'
     and message.sender_role='seller'
     and message.provider_context->>'replyObservationContract'
          ='sellerpilot-reply-observation/1'
     and message.provider_context#>>'{binding,kind}'=v_link.provider_ticket_kind
     and coalesce(message.provider_context#>>'{binding,questionId}',
       message.provider_context#>>'{binding,inquiryNo}')=v_link.provider_ticket_id
     and message.received_at>=v_link.accepted_after-interval '5 minutes';

  if v_readback.status<>'succeeded' then
    v_state:='failed';v_reason:='provider_read_failed';
  elsif v_exact_count=1
      and v_delivery.verification_status='remote_observed'
      and v_delivery.observed_message_id=v_exact_message_id then
    v_state:='verified';v_reason:='exact_reply_observed';
  elsif v_exact_count>1 then
    v_state:='unverified';v_reason:='ambiguous_exact_reply_observations';
  elsif v_target_count>0 then
    v_state:='unverified';v_reason:='reply_body_mismatch';
  else
    v_state:='unverified';v_reason:='exact_reply_not_observed';
  end if;

  update sellerpilot_private.smartstore_reply_readback_links_v1 link set
    state=v_state,reason=v_reason,observed_message_id=case
      when v_state='verified' then v_exact_message_id else null end,
    checked_at=v_checked_at,automatic_resend_allowed=false,
    updated_at=clock_timestamp()
   where link.readback_job_id=p_job_id;
  update sellerpilot_private.support_reply_deliveries delivery set
    smartstore_readback_state=v_state,smartstore_readback_reason=v_reason,
    smartstore_readback_checked_at=v_checked_at,
    smartstore_automatic_resend_allowed=false,
    verification_status=case when v_state='verified' then 'remote_observed'
      else 'reconciliation_required' end,
    verification_contract='sellerpilot-smartstore-reply-readback/1',
    reconciliation_reason=case when v_state='verified' then null else v_reason end,
    updated_at=clock_timestamp()
   where delivery.id=v_link.delivery_id;
  if v_state<>'verified' then
    update sellerpilot_private.support_tickets ticket set
      status='in_progress',provider_status='waiting',
      provider_status_updated_at=clock_timestamp(),resolved_at=null,
      reply_delivery_status='reconciliation_required',
      reply_delivery_error='판매채널 답변의 동일 본문을 재조회로 확인하지 못했습니다. 재전송 없이 확인이 필요합니다.',
      updated_at=clock_timestamp()
     where ticket.id=v_link.ticket_id
       and ticket.latest_inbound_key=v_link.expected_inbound_key;
  end if;
  return jsonb_build_object(
    'contract','sellerpilot-smartstore-reply-readback-result/1',
    'deliveryId',v_link.delivery_id,'state',v_state,'reason',v_reason,
    'targetObservations',v_target_count,'exactObservations',v_exact_count,
    'automaticResendAllowed',false
  );
end
$$;
revoke all on function public.sellerpilot_service_record_smartstore_reply_readback_v1(
  text,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_smartstore_reply_readback_v1(
  text,uuid,uuid
) to service_role;

create function public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1(
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer:=0;v_now timestamptz:=clock_timestamp();
begin
  if p_limit not between 1 and 500 then
    raise exception 'SMARTSTORE_STALE_REPLY_LIMIT_INVALID' using errcode='22023';
  end if;
  with stale as(
    select delivery.id,link.ticket_id,link.expected_inbound_key
      from sellerpilot_private.support_reply_deliveries delivery
      join sellerpilot_private.smartstore_reply_readback_links_v1 link
        on link.delivery_id=delivery.id
     where delivery.channel_key='smartstore'
       and delivery.verification_status='provider_accepted'
       and delivery.provider_accepted_at<=statement_timestamp()-interval '15 minutes'
       and link.state='pending'
     order by delivery.provider_accepted_at,delivery.id
     for update of delivery,link skip locked limit p_limit
  ),updated as(
    update sellerpilot_private.support_reply_deliveries delivery set
      verification_status='reconciliation_required',
      verification_contract='sellerpilot-smartstore-reply-readback/1',
      reconciliation_reason='stale_provider_accepted',
      smartstore_readback_state='unverified',
      smartstore_readback_reason='stale_provider_accepted',
      smartstore_readback_checked_at=v_now,
      smartstore_automatic_resend_allowed=false,updated_at=v_now
     from stale where delivery.id=stale.id returning stale.*
  ),links as(
    update sellerpilot_private.smartstore_reply_readback_links_v1 link set
      state='unverified',reason='stale_provider_accepted',checked_at=v_now,
      automatic_resend_allowed=false,updated_at=v_now
     from updated where link.delivery_id=updated.id returning updated.*
  ),tickets as(
    update sellerpilot_private.support_tickets ticket set
      status='in_progress',provider_status='waiting',
      provider_status_updated_at=v_now,resolved_at=null,
      reply_delivery_status='reconciliation_required',
      reply_delivery_error='판매채널 접수 후 15분 동안 동일 답변이 확인되지 않았습니다. 재전송 없이 확인이 필요합니다.',
      updated_at=v_now
     from links where ticket.id=links.ticket_id
       and ticket.latest_inbound_key=links.expected_inbound_key returning ticket.id
  ) select count(*) into v_count from links;
  return jsonb_build_object(
    'contract','sellerpilot-smartstore-stale-reply-escalation/1',
    'escalated',v_count,'automaticResendAllowed',false
  );
end
$$;
revoke all on function public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1(integer)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_escalate_stale_smartstore_reply_acceptance_v1(integer)
  to service_role;

create or replace function public.sellerpilot_get_inquiry_reply_delivery(
  p_ticket_id uuid,p_job_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else(
    select jsonb_build_object(
      'jobId',d.gateway_job_id,'ticketId',d.ticket_id,'channel',d.channel_key,
      'inboundKey',job.request_payload->>'sellerpilotInboundKey','status',d.status,
      'verificationStatus',d.verification_status,'verificationContract',d.verification_contract,
      'safeMessage',d.safe_message,'reconciliationReason',d.reconciliation_reason,
      'providerRequestId',d.provider_request_id,'providerMessageId',d.provider_message_id,
      'providerAcceptedAt',d.provider_accepted_at,'remoteObservedAt',d.remote_observed_at,
      'smartstoreReadbackState',d.smartstore_readback_state,
      'smartstoreReadbackReason',d.smartstore_readback_reason,
      'smartstoreReadbackCheckedAt',d.smartstore_readback_checked_at,
      'automaticResendAllowed',case when d.channel_key='smartstore' then false else null end,
      'verificationAttention',case
        when d.channel_key='smartstore' and d.verification_status='provider_accepted'
         and d.provider_accepted_at<=statement_timestamp()-interval '15 minutes'
          then 'stale_provider_accepted'
        when d.channel_key='smartstore' and d.verification_status='provider_accepted'
          then 'exact_readback_pending'
        when d.channel_key='smartstore' and d.verification_status='reconciliation_required'
          then 'manual_verification_required'
        else null end,
      'queuedAt',d.queued_at,'startedAt',d.started_at,'completedAt',d.completed_at,'updatedAt',d.updated_at)
      from sellerpilot_private.support_reply_deliveries d
      join sellerpilot_private.channel_gateway_jobs job on job.id=d.gateway_job_id
      join sellerpilot_private.support_tickets ticket on ticket.id=d.ticket_id
     where d.ticket_id=p_ticket_id and((p_job_id is not null and d.gateway_job_id=p_job_id)
       or(p_job_id is null and d.gateway_job_id=ticket.last_delivery_job_id))
       and not ticket.demo
     order by d.queued_at desc,d.id desc limit 1
  ) end
$$;
revoke all on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_inquiry_reply_delivery(uuid,uuid)
  to authenticated;

notify pgrst,'reload schema';

commit;
