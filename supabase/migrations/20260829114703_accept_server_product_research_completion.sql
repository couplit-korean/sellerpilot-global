begin;

-- The Vercel product-research runtime emits the explicit server lineage mode.
-- The original completion function retained the legacy desktop-worker mode and
-- therefore rejected every valid server result before the claim fence ran.
create or replace function public.sellerpilot_service_complete_product_research_ai_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_result_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_receipt record;
  v_fingerprint text;
begin
  if p_job_id is null or p_claim_token is null then return false; end if;
  if jsonb_typeof(p_result_payload) is distinct from 'object'
     or p_result_payload->>'mode' not in ('cli-research', 'server-research')
     or pg_catalog.octet_length(p_result_payload::text) > 262144 then
    raise exception 'invalid product research result';
  end if;

  v_fingerprint := sellerpilot_private.ai_completion_fingerprint(
    'succeeded', p_result_payload, null
  );

  select job.kind, job.status, job.worker_token_id, job.claim_token,
         job.lease_expires_at
    into v_job
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_job_id
   for update;
  if not found then return false; end if;

  select receipt.status, receipt.completion_fingerprint
    into v_receipt
    from sellerpilot_private.server_product_research_completion_receipts receipt
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token;
  if found then
    return v_receipt.status = 'succeeded'
       and v_receipt.completion_fingerprint = v_fingerprint;
  end if;

  if v_job.kind <> 'product_research'
     or v_job.status <> 'running'
     or v_job.worker_token_id is not null
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_expires_at <= clock_timestamp()
     or not exists (
       select 1
         from sellerpilot_private.server_product_research_claims claim
        where claim.job_id = p_job_id
          and claim.claim_token = p_claim_token
          and claim.lease_expires_at > clock_timestamp()
     ) then
    return false;
  end if;

  update sellerpilot_private.ai_cli_jobs job
     set status = 'succeeded',
         result_payload = p_result_payload,
         error_message = null,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where job.id = p_job_id;

  insert into sellerpilot_private.server_product_research_completion_receipts (
    job_id, claim_token, status, completion_fingerprint
  ) values (
    p_job_id, p_claim_token, 'succeeded', v_fingerprint
  );
  delete from sellerpilot_private.server_product_research_claims claim
   where claim.job_id = p_job_id
     and claim.claim_token = p_claim_token;
  insert into sellerpilot_private.ai_cli_audit (
    action, job_id, safe_detail
  ) values (
    'job_succeeded', p_job_id,
    jsonb_build_object('source', 'vercel_product_research')
  );
  return true;
end;
$$;

revoke all on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb)
  to service_role;

comment on function public.sellerpilot_service_complete_product_research_ai_job(uuid, uuid, jsonb) is
  'Completes an exact Vercel server product-research claim; server-research is current and cli-research remains cutover-compatible.';

commit;
