begin;

do $$
declare v_history regprocedure := to_regprocedure(
  'public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)'
);
begin
  if v_history is null or not exists (
    select 1 from pg_proc p
     where p.oid=v_history
       and position('channel-inquiry-history-v2' in p.prosrc)>0
       and p.prosecdef and p.proowner='postgres'::regrole
       and p.proconfig=array['search_path=""']::text[]
       and has_function_privilege('authenticated',p.oid,'EXECUTE')
       and not has_function_privilege('anon',p.oid,'EXECUTE')
       and not has_function_privilege('service_role',p.oid,'EXECUTE')
  ) then raise exception 'COUPANG_AFTER_SALES_HISTORY_PREIMAGE_REVIEW_REQUIRED'; end if;
  if to_regprocedure(
    'public.sellerpilot_08047100_history_before_coupang_after_sales(text[],integer,date)'
  ) is not null then raise exception 'COUPANG_AFTER_SALES_HISTORY_ALREADY_WRAPPED'; end if;
end $$;

alter function public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)
  rename to sellerpilot_08047100_history_before_coupang_after_sales;

create function public.sellerpilot_start_inquiry_history_backfill_v3(
  p_channels text[],
  p_history_days integer default 30,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_run_id uuid;
  v_run record;
  v_slice_start date;
  v_slice_end date;
  v_item_key text;
  v_expected integer;
  v_reused boolean;
  v_retried integer;
begin
  v_result:=public.sellerpilot_08047100_history_before_coupang_after_sales(
    p_channels,p_history_days,p_end_date
  );
  v_reused:=coalesce((v_result->>'reused')::boolean,false);
  v_retried:=coalesce((v_result->>'retriedJobs')::integer,0);
  if not ('coupang'=any(p_channels)) then return v_result; end if;
  if coalesce(v_result->>'runId','')!~'^[0-9a-f-]{36}$' then
    raise exception 'COUPANG_AFTER_SALES_HISTORY_RUN_INVALID';
  end if;
  v_run_id:=(v_result->>'runId')::uuid;
  select run.history_days,run.range_start,run.range_end,run.channels
    into strict v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id=v_run_id for update;
  v_expected:=case when 'coupang'=any(v_run.channels)
      then ceil(v_run.history_days/7.0)::integer*8 else 0 end
    + case when 'smartstore'=any(v_run.channels) then 2 else 0 end;
  update sellerpilot_private.inquiry_history_backfill_runs
     set expected_initial_jobs=v_expected,updated_at=clock_timestamp()
   where id=v_run_id;

  v_slice_start:=v_run.range_start;
  while v_slice_start<=v_run.range_end loop
    v_slice_end:=least(v_slice_start+6,v_run.range_end);
    foreach v_item_key in array array['return_request','cancel_request'] loop
      if not exists (
        select 1 from sellerpilot_private.channel_gateway_jobs job
         where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text
           and job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}'=
             format('%s:%s:%s',v_item_key,v_slice_start,v_slice_end)
      ) then
        perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
          v_run_id,'coupang',format('%s:%s:%s',v_item_key,v_slice_start,v_slice_end),
          jsonb_build_object(
            'kind',v_item_key,
            'query',jsonb_build_object(
              'searchType','timeFrame',
              'createdAtFrom',format('%sT00:00',v_slice_start),
              'createdAtTo',format('%sT23:59',v_slice_end),
              'cancelType',case when v_item_key='return_request' then 'RETURN' else 'CANCEL' end
            )
          )
        );
      end if;
    end loop;
    if not exists (
      select 1 from sellerpilot_private.channel_gateway_jobs job
       where job.request_payload#>>'{arguments,sellerpilotHistoryRunId}'=v_run_id::text
         and job.request_payload#>>'{arguments,sellerpilotHistoryItemKey}'=
           format('exchange_request:%s:%s',v_slice_start,v_slice_end)
    ) then
      perform sellerpilot_private.enqueue_inquiry_history_backfill_item(
        v_run_id,'coupang',format('exchange_request:%s:%s',v_slice_start,v_slice_end),
        jsonb_build_object(
          'kind','exchange_request',
          'query',jsonb_build_object(
            'createdAtFrom',format('%sT00:00:00',v_slice_start),
            'createdAtTo',format('%sT23:59:59',v_slice_end),
            'maxPerPage',10
          )
        )
      );
    end if;
    v_slice_start:=v_slice_start+7;
  end loop;
  v_result:=sellerpilot_private.refresh_inquiry_history_backfill_run(v_run_id);
  if coalesce((v_result->>'totalJobs')::integer,0)<>v_expected then
    raise exception 'COUPANG_AFTER_SALES_HISTORY_ENQUEUE_COUNT_MISMATCH';
  end if;
  return v_result||jsonb_build_object('reused',v_reused,'retriedJobs',v_retried);
end;
$$;

revoke all on function public.sellerpilot_08047100_history_before_coupang_after_sales(text[],integer,date)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)
  from public,anon,service_role;
grant execute on function public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date)
  to authenticated;

comment on function public.sellerpilot_start_inquiry_history_backfill_v3(text[],integer,date) is
  'Queues complete scoped inquiry history, including three read-only Coupang after-sales surfaces per seven-day window.';

notify pgrst,'reload schema';
commit;
