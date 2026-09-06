-- Follow-up to 20260905003000. Do not rewrite that applied history.
-- 03000 wraps complete and raises 55000 when record_qoo10_shipping_s1_observation
-- returns false. Inner complete returns status=completed for failed jobs too.
-- record() requires job.status=succeeded plus the exact S1 verification step,
-- so a failed or unmatched verifier complete rolls back and leaves
-- 457b4481-0a66-4a76-89a0-884087d0c22e running. Drain 1365 503 upstream_5xx
-- is that rolled-back complete. Exact S1 used PERFORM for the verifier.
-- Failed/reconciliation verifier completes must persist. Succeeded still
-- requires a recorded observation or the transaction rolls back.
-- Source jobs, listing, enqueue, and activation are unchanged.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500141);

create or replace function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text,
  p_response_payload jsonb default null, p_error_message text default null,
  p_credential_refresh jsonb default null, p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null, p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_operation text;
  v_job_status text;
begin
  v_result := public.sellerpilot_090500_complete_before_qoo10_shipping_s1(
    p_token_hash, p_job_id, p_claim_token, p_status, p_response_payload,
    p_error_message, p_credential_refresh, p_normalized_orders,
    p_normalized_inquiries, p_diagnostic
  );
  if v_result->>'status' not in ('completed','completed_replay') then
    return v_result;
  end if;
  select job.operation, job.status into v_operation, v_job_status
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if v_operation = 'listing.publication.verify'
     and exists (
       select 1 from sellerpilot_private.qoo10_shipping_s1_verifier_runs
        where verifier_job_id = p_job_id
     )
  then
    if v_job_status = 'succeeded' then
      if not sellerpilot_private.record_qoo10_shipping_s1_observation(p_job_id) then
        raise exception 'exact Qoo10 shipping S1 observation was not recorded'
          using errcode = '55000';
      end if;
    else
      perform sellerpilot_private.record_qoo10_shipping_s1_observation(p_job_id);
    end if;
  elsif v_operation = 'listing.activate'
        and exists (
          select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits
           where activation_job_id = p_job_id
        )
  then
    if not sellerpilot_private.record_qoo10_shipping_s1_activation_outcome(p_job_id) then
      raise exception 'exact Qoo10 shipping activation completion was not recorded'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  )
  from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  )
  to service_role;

comment on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) is
  'Completes a gateway job; shipping S1 verifier observation is required only after succeeded.';

commit;
