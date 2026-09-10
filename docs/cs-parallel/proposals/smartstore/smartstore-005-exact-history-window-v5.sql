-- Proposal only. The coordinator assigns the migration version after review.
-- Adds an exact 1-30 day SmartStore-only enqueue path without widening other channels.
begin;

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
commit;
