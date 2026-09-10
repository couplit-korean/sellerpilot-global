-- Proposal only. Do not apply directly to production.
-- Apply after qoo10-007, qoo10-008, and qoo10-009.
--
-- The generic atomic completion requires normalized inquiries for every
-- successful inquiries.list result. A delivery-bound Qoo10 S3 readback is not
-- a ticket import and intentionally has no normalized inquiry payload. Route
-- only that sealed marker contract through an exact atomic terminal+receipt
-- path, leaving every ordinary read and every other channel on the predecessor.
-- Also allow the exact serverless_cs receipt owner through the already sealed
-- qoo10-007 lineage query; the outer qoo10-008 wrapper still verifies the
-- immutable job/receipt/seal tuple before this predicate can be reached.

begin;

do $patch_qoo10_s3_serverless_scope$
declare
  v_definition text;
  v_rewritten text;
  v_compact_old constant text := 'token.scope in (''gateway'',''legacy_combined'')';
  v_spaced_old constant text := 'token.scope in (''gateway'', ''legacy_combined'')';
  v_new constant text := 'token.scope in (''gateway'',''legacy_combined'',''serverless_cs'')';
  v_occurrences integer;
begin
  if to_regprocedure(
    'public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(text,uuid,uuid,uuid,text,text,integer,boolean,boolean)'
  ) is null then
    raise exception 'QOO10_REPLY_S3_UNSEALED_STATUS_RPC_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(text,uuid,uuid,uuid,text,text,integer,boolean,boolean)'::regprocedure
  ) into v_definition;
  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_compact_old, '')))
      / length(v_compact_old)
    + (length(v_definition) - length(replace(v_definition, v_spaced_old, '')))
      / length(v_spaced_old);
  if v_occurrences <> 1 then
    raise exception 'QOO10_REPLY_S3_STATUS_SCOPE_PREIMAGE_MISMATCH';
  end if;

  v_rewritten := replace(v_definition, v_compact_old, v_new);
  v_rewritten := replace(v_rewritten, v_spaced_old, v_new);
  if v_rewritten = v_definition
     or v_rewritten like '%' || v_compact_old || '%'
     or v_rewritten like '%' || v_spaced_old || '%' then
    raise exception 'QOO10_REPLY_S3_STATUS_SCOPE_REWRITE_FAILED';
  end if;
  execute v_rewritten;
end
$patch_qoo10_s3_serverless_scope$;

revoke all on function
  public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(
    text,uuid,uuid,uuid,text,text,integer,boolean,boolean
  ) from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_145336_complete_before_qoo10_reply_s3;

revoke all on function public.sellerpilot_145336_complete_before_qoo10_reply_s3(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_worker_id uuid;
  v_completion_fingerprint text;
  v_receipt sellerpilot_private.gateway_completion_receipts%rowtype;
  v_completed boolean;
  v_marker jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  v_marker := v_job.request_payload#>'{arguments,sellerpilotQoo10ReplyReadback}';

  if not found
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'inquiries.list'
     or v_marker is null then
    return public.sellerpilot_145336_complete_before_qoo10_reply_s3(
      p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
      p_error_message,p_credential_refresh,p_normalized_orders,
      p_normalized_inquiries,p_diagnostic
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null
     or p_status not in ('succeeded','failed','reconciliation_required')
     or p_credential_refresh is not null
     or p_normalized_orders is not null
     or p_normalized_inquiries is not null
     or p_diagnostic is not null
     or jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-readback/1'
     or coalesce(v_marker->>'deliveryId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_marker->>'inquiryType','') not in ('MSG','HELP','ITEM')
     or coalesce(v_marker->>'questionNo','') !~ '^[0-9]{1,40}$'
     or coalesce(v_marker->>'sequenceNo','') !~ '^[0-9]{1,40}$'
     or v_job.request_payload#>>'{arguments,params,proc_status}' is distinct from 'S3'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_start_dt}','') !~ '^[0-9]{14}$'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_end_dt}','') !~ '^[0-9]{14}$'
     or (p_response_payload is not null and (
       jsonb_typeof(p_response_payload) is distinct from 'object'
       or octet_length(p_response_payload::text) > 1000000
       or p_response_payload->>'channel' is distinct from 'qoo10'
       or p_response_payload->>'operation' is distinct from 'inquiries.list'
       or p_response_payload#>>'{steps,0,data,sellerpilotMarker}' is distinct from
          'sellerpilot-qoo10-s3-stored-evidence/1'
     ))
     or (p_status = 'succeeded' and (
       p_response_payload is null
       or p_response_payload->>'ok' is distinct from 'true'
       or jsonb_typeof(p_response_payload->'steps') is distinct from 'array'
       or jsonb_array_length(p_response_payload->'steps') <> 1
       or p_response_payload#>>'{steps,0,name}' is distinct from 'GetInquiryMessage'
       or p_response_payload#>>'{steps,0,ok}' is distinct from 'true'
       or p_response_payload#>>'{steps,0,data,ResultCode}' is distinct from '0'
       or jsonb_typeof(p_response_payload#>'{steps,0,data,ResultObject}')
            is distinct from 'array'
     )) then
    raise exception 'QOO10_REPLY_S3_ATOMIC_COMPLETION_INVALID' using errcode = '22023';
  end if;

  if not sellerpilot_private.worker_token_may_complete_gateway_job(
    p_token_hash,p_job_id,p_claim_token
  ) then
    return jsonb_build_object('status','ownership_lost');
  end if;

  v_completion_fingerprint := sellerpilot_private.gateway_completion_fingerprint(
    p_status,p_response_payload,p_error_message,p_credential_refresh,
    p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  select receipt.* into v_receipt
    from sellerpilot_private.gateway_completion_receipts receipt
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = receipt.worker_token_id
   where receipt.job_id = p_job_id
     and receipt.claim_token = p_claim_token
     and token.token_hash = p_token_hash
     and token.scope in ('gateway','legacy_combined','serverless_cs')
     and token.status = 'active'
     and token.expires_at > clock_timestamp();
  if found then
    if v_receipt.completion_fingerprint <> v_completion_fingerprint then
      raise exception 'gateway completion replay mismatch' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'status','completed','replayed',true,'continuationJobId',null
    );
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = job.worker_token_id
   where job.id = p_job_id
     and job.channel = 'qoo10'
     and job.operation = 'inquiries.list'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.token_hash = p_token_hash
     and token.scope in ('gateway','legacy_combined','serverless_cs')
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
   for update of job;
  if not found then return jsonb_build_object('status','ownership_lost'); end if;
  v_worker_id := v_job.worker_token_id;

  v_completed := public.sellerpilot_complete_channel_gateway_job(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    case when p_status='succeeded' then null else p_error_message end
  );
  if v_completed is not true then
    raise exception 'gateway completion claim changed' using errcode = '40001';
  end if;

  insert into sellerpilot_private.gateway_completion_receipts(
    job_id,claim_token,worker_token_id,completion_fingerprint,continuation_job_id
  ) values(
    p_job_id,p_claim_token,v_worker_id,v_completion_fingerprint,null
  );
  return jsonb_build_object(
    'status','completed','credentialId',v_job.credential_id,
    'continuationJobId',null
  );
end
$$;

revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

-- Recreate the delegating wrapper after the canonical function rename so its
-- compiled dependency always resolves to the new exact S3 branch.
create or replace function public.sellerpilot_service_complete_serverless_cs_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not sellerpilot_private.worker_token_may_complete_gateway_job(
    p_token_hash,p_job_id,p_claim_token
  ) then
    return jsonb_build_object('status','ownership_lost');
  end if;
  return public.sellerpilot_service_complete_gateway_transaction(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,
    p_error_message,p_credential_refresh,p_normalized_orders,
    p_normalized_inquiries,p_diagnostic
  );
end
$$;

revoke all on function public.sellerpilot_service_complete_serverless_cs_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_complete_serverless_cs_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

commit;
