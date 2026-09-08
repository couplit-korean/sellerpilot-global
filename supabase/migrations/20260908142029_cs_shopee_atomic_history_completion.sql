-- Executable review draft only. The integration coordinator must allocate the
-- migration version after applying the history ledger proposal. This wrapper
-- makes the ordinary gateway completion and its body-free Shopee history event
-- one PostgreSQL transaction: either both commit or both roll back.
begin;

do $$
begin
  if to_regprocedure('public.sellerpilot_service_complete_serverless_cs_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.sellerpilot_service_record_cs_shopee_history_event_v1(text,uuid,uuid,text,jsonb)') is null then
    raise exception 'SHOPEE_HISTORY_COMPLETION_PREIMAGE_REQUIRED';
  end if;
end $$;

create function public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null,
  p_history_run_id text default null,
  p_history_event jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion jsonb;
  v_history jsonb;
begin
  if coalesce(p_history_run_id,'') !~ '^[A-Za-z0-9:_-]{1,120}$'
     or jsonb_typeof(p_history_event) is distinct from 'object' then
    raise exception 'SHOPEE_HISTORY_COMPLETION_EVENT_REQUIRED' using errcode='22023';
  end if;
  v_completion:=public.sellerpilot_service_complete_serverless_cs_transaction(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
    p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  if coalesce(v_completion->>'status','')<>'completed' then return v_completion; end if;
  v_history:=public.sellerpilot_service_record_cs_shopee_history_event_v1(
    p_token_hash,p_job_id,p_claim_token,p_history_run_id,p_history_event
  );
  if coalesce(v_history->>'contract','')<>'sellerpilot-shopee-history-event/1'
     or coalesce(v_history->>'status','') not in ('recorded','duplicate') then
    raise exception 'SHOPEE_HISTORY_COMPLETION_EVENT_FAILED' using errcode='55000';
  end if;
  return v_completion||jsonb_build_object(
    'shopeeHistoryEventStatus',v_history->>'status',
    'shopeeHistoryEventSequence',(v_history->>'sequence')::integer
  );
end $$;

revoke all on function public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb,text,jsonb
) to service_role;

commit;
