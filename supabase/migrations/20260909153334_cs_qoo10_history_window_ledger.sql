-- Private integration-sandbox review draft. The central integrator must assign
-- the final migration version. This ledger stores only window metadata,
-- counts, digests, and child request arguments; provider/customer bodies are
-- deliberately absent.
begin;

create table sellerpilot_private.qoo10_history_windows (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete cascade,
  job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete set null,
  window_key text not null
    check (window_key ~ '^inquiries:history:qoo10:(inquiry:S[123]|claim:all):[0-9]{14}:[0-9]{14}$'),
  source text not null check (source in ('qapi_inquiry','qapi_claim')),
  inquiry_status text,
  calendar_date date not null,
  refinement text not null check (refinement in ('day','hour','minute','second')),
  parent_window_key text,
  completion_state text not null default 'queued'
    check (completion_state in ('queued','complete','refining','gap')),
  completion_reason text,
  provider_status integer,
  provider_row_count integer check (provider_row_count is null or provider_row_count >= 0),
  provider_total integer check (provider_total is null or provider_total >= 0),
  observed_row_limit integer check (observed_row_limit is null or observed_row_limit > 0),
  refinement_count integer not null default 0 check (refinement_count between 0 and 60),
  irreducible_gap boolean not null default false,
  completion_claim_token uuid,
  completion_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id),
  completion_fingerprint text
    check (completion_fingerprint is null or completion_fingerprint ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default clock_timestamp(),
  unique (credential_id, window_key),
  foreign key (credential_id, parent_window_key)
    references sellerpilot_private.qoo10_history_windows(credential_id, window_key)
    deferrable initially deferred,
  check (
    (source='qapi_inquiry' and inquiry_status in ('S1','S2','S3'))
    or (source='qapi_claim' and inquiry_status is null)
  ),
  check (
    (completion_state='queued'
      and completion_claim_token is null
      and completion_worker_token_id is null
      and completion_fingerprint is null)
    or (completion_state<>'queued'
      and completion_claim_token is not null
      and completion_worker_token_id is not null
      and completion_fingerprint is not null)
  )
);

alter table sellerpilot_private.qoo10_history_windows enable row level security;
revoke all on sellerpilot_private.qoo10_history_windows
  from public, anon, authenticated, service_role;

create index qoo10_history_windows_open_idx
  on sellerpilot_private.qoo10_history_windows(credential_id,completion_state,calendar_date,window_key)
  where completion_state <> 'complete';

create function public.sellerpilot_service_record_qoo10_history_window_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_completion jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_marker jsonb;
  v_coverage jsonb;
  v_completeness jsonb;
  v_child jsonb;
  v_child_marker jsonb;
  v_child_window_id uuid;
  v_child_job_id uuid;
  v_child_key_count integer;
  v_arguments_key_count integer;
  v_params_key_count integer;
  v_window_key text;
  v_state text;
  v_refinement_count integer;
  v_status text := 'recorded';
  v_worker_token_id uuid;
  v_completion_fingerprint text;
  v_existing sellerpilot_private.qoo10_history_windows%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_job_id is null or p_claim_token is null
     or jsonb_typeof(p_completion) is distinct from 'object'
     or octet_length(p_completion::text) > 128000
     or jsonb_typeof(p_completion->'contractVersion') is distinct from 'string'
     or p_completion->>'contractVersion' is distinct from 'sellerpilot-qoo10-history-gateway-completion/1'
     or jsonb_typeof(p_completion->'windowKey') is distinct from 'string'
     or jsonb_typeof(p_completion->'state') is distinct from 'string'
     or coalesce(p_completion->>'state','') not in ('complete','refining','gap')
     or jsonb_typeof(p_completion->'coverage') is distinct from 'object'
     or jsonb_typeof(p_completion->'refinementRequests') is distinct from 'array'
     or jsonb_array_length(p_completion->'refinementRequests') > 60 then
    raise exception 'QOO10_HISTORY_COMPLETION_INVALID' using errcode='22023';
  end if;

  v_window_key := p_completion->>'windowKey';
  v_state := p_completion->>'state';
  v_coverage := p_completion->'coverage';
  v_completeness := v_coverage->'completeness';
  v_refinement_count := jsonb_array_length(p_completion->'refinementRequests');
  if coalesce(v_window_key !~ '^inquiries:history:qoo10:(inquiry:S[123]|claim:all):[0-9]{14}:[0-9]{14}$',true)
     or jsonb_typeof(v_coverage->'contractVersion') is distinct from 'string'
     or v_coverage->>'contractVersion' is distinct from 'sellerpilot-qoo10-history-coverage/1'
     or jsonb_typeof(v_coverage->'windowKey') is distinct from 'string'
     or v_coverage->>'windowKey' is distinct from v_window_key
     or jsonb_typeof(v_coverage->'source') is distinct from 'string'
     or coalesce(v_coverage->>'source','') not in ('qapi_inquiry','qapi_claim')
     or jsonb_typeof(v_coverage->'providerStatus') is distinct from 'number'
     or (v_coverage->>'providerStatus')::numeric <> trunc((v_coverage->>'providerStatus')::numeric)
     or (v_coverage->>'providerStatus')::numeric not between 100 and 599
     or jsonb_typeof(v_coverage->'providerRows') is distinct from 'number'
     or (v_coverage->>'providerRows')::numeric <> trunc((v_coverage->>'providerRows')::numeric)
     or (v_coverage->>'providerRows')::numeric < 0
     or coalesce(jsonb_typeof(v_coverage->'providerTotal'),'missing') not in ('number','null','missing')
     or (jsonb_typeof(v_coverage->'providerTotal')='number' and (
       (v_coverage->>'providerTotal')::numeric <> trunc((v_coverage->>'providerTotal')::numeric)
       or (v_coverage->>'providerTotal')::numeric < 0
     ))
     or coalesce(jsonb_typeof(v_coverage->'observedRowLimit'),'missing') not in ('number','null','missing')
     or (jsonb_typeof(v_coverage->'observedRowLimit')='number' and (
       (v_coverage->>'observedRowLimit')::numeric <> trunc((v_coverage->>'observedRowLimit')::numeric)
       or (v_coverage->>'observedRowLimit')::numeric <= 0
     ))
     or jsonb_typeof(v_coverage->'refinementRequired') is distinct from 'boolean'
     or (v_coverage->>'refinementRequired')::boolean is distinct from (v_refinement_count > 0)
     or jsonb_typeof(v_coverage->'irreducibleGap') is distinct from 'boolean'
     or jsonb_typeof(v_completeness) is distinct from 'object'
     or jsonb_typeof(v_completeness->'state') is distinct from 'string'
     or coalesce(v_completeness->>'state','') not in ('complete','incomplete','unverified')
     or jsonb_typeof(v_completeness->'reason') is distinct from 'string'
     or coalesce(v_completeness->>'reason','') not in (
       'provider_success_empty','provider_total_reconciled','provider_error',
       'observed_row_limit_reached','provider_total_invalid',
       'provider_total_mismatch','missing_total_and_row_limit'
     )
     or (v_state='refining') is distinct from (v_refinement_count > 0)
     or (v_state='complete') is distinct from (v_completeness->>'state'='complete') then
    raise exception 'QOO10_HISTORY_COMPLETION_INVALID' using errcode='22023';
  end if;

  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id=job.id and receipt.claim_token=p_claim_token
   where job.id=p_job_id
     and job.channel='qoo10'
     and job.operation='inquiries.list'
     and job.status='succeeded';
  if not found then
    raise exception 'QOO10_HISTORY_COMPLETION_RECEIPT_REQUIRED' using errcode='42501';
  end if;

  select receipt.worker_token_id into v_worker_token_id
    from sellerpilot_private.gateway_completion_receipts receipt
   where receipt.job_id=p_job_id
     and receipt.claim_token=p_claim_token;

  if not exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens token
     where token.id=v_worker_token_id
       and token.token_hash=p_token_hash
       and token.scope in ('gateway','serverless_cs','legacy_combined')
       and token.status='active'
       and token.expires_at>v_now
  ) then
    raise exception 'QOO10_HISTORY_COMPLETION_UNAUTHORIZED' using errcode='42501';
  end if;
  v_completion_fingerprint := encode(extensions.digest(
    p_job_id::text || chr(31) || p_claim_token::text || chr(31)
      || v_worker_token_id::text || chr(31) || p_completion::text,
    'sha256'
  ),'hex');

  v_marker := v_job.request_payload#>'{arguments,sellerpilotHistoryWindow}';
  if jsonb_typeof(v_marker) is distinct from 'object'
     or jsonb_typeof(v_marker->'contractVersion') is distinct from 'string'
     or v_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-history-window/1'
     or jsonb_typeof(v_marker->'windowKey') is distinct from 'string'
     or v_marker->>'windowKey' is distinct from v_window_key
     or jsonb_typeof(v_marker->'source') is distinct from 'string'
     or v_marker->>'source' is distinct from v_coverage->>'source'
     or jsonb_typeof(v_marker->'calendarDate') is distinct from 'string'
     or coalesce(v_marker->>'calendarDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(v_marker->'refinement') is distinct from 'string'
     or coalesce(v_marker->>'refinement','') not in ('day','hour','minute','second')
     or coalesce(jsonb_typeof(v_marker->'parentWindowKey'),'missing') not in ('string','null')
     or jsonb_typeof(v_job.request_payload->'periodicKey') is distinct from 'string'
     or v_job.request_payload->>'periodicKey' is distinct from v_window_key
     or jsonb_typeof(v_job.request_payload->'arguments') is distinct from 'object'
     or coalesce(v_job.seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or (v_marker->>'source'='qapi_inquiry' and (
       jsonb_typeof(v_marker->'status') is distinct from 'string'
       or coalesce(v_marker->>'status','') not in ('S1','S2','S3')
     ))
     or (v_marker->>'source'='qapi_claim' and v_marker ? 'status') then
    raise exception 'QOO10_HISTORY_JOB_LINEAGE_MISMATCH' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('sellerpilot:qoo10-history:' || v_job.credential_id::text || ':' || v_window_key));
  select history_window.* into v_existing
    from sellerpilot_private.qoo10_history_windows history_window
   where history_window.credential_id=v_job.credential_id
     and history_window.window_key=v_window_key
   for update;
  if found and v_existing.completion_fingerprint is not null then
    if v_existing.job_id is distinct from p_job_id
       or v_existing.completion_claim_token is distinct from p_claim_token
       or v_existing.completion_worker_token_id is distinct from v_worker_token_id
       or v_existing.completion_fingerprint is distinct from v_completion_fingerprint then
      raise exception 'QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH' using errcode='40001';
    end if;
    return jsonb_build_object(
      'contract','sellerpilot-qoo10-history-window-record/1',
      'status','duplicate',
      'jobId',p_job_id,
      'windowKey',v_window_key,
      'completionState',v_existing.completion_state,
      'refinementCount',v_existing.refinement_count
    );
  elsif found and (
    v_existing.job_id is distinct from p_job_id
    or v_existing.completion_state is distinct from 'queued'
    or v_existing.completion_claim_token is not null
    or v_existing.completion_worker_token_id is not null
  ) then
    raise exception 'QOO10_HISTORY_COMPLETION_REPLAY_MISMATCH' using errcode='40001';
  end if;

  if v_existing.id is null then
    insert into sellerpilot_private.qoo10_history_windows(
      credential_id,job_id,window_key,source,inquiry_status,calendar_date,refinement,
      parent_window_key,completion_state,completion_reason,provider_status,
      provider_row_count,provider_total,observed_row_limit,refinement_count,
      irreducible_gap,completion_claim_token,completion_worker_token_id,
      completion_fingerprint,updated_at
    ) values (
      v_job.credential_id,p_job_id,v_window_key,v_marker->>'source',nullif(v_marker->>'status',''),
      (v_marker->>'calendarDate')::date,v_marker->>'refinement',nullif(v_marker->>'parentWindowKey',''),
      v_state,v_completeness->>'reason',(v_coverage->>'providerStatus')::integer,
      (v_coverage->>'providerRows')::integer,
      case when jsonb_typeof(v_coverage->'providerTotal')='number'
        then (v_coverage->>'providerTotal')::integer end,
      case when jsonb_typeof(v_coverage->'observedRowLimit')='number'
        then (v_coverage->>'observedRowLimit')::integer end,
      v_refinement_count,(v_coverage->>'irreducibleGap')::boolean,
      p_claim_token,v_worker_token_id,v_completion_fingerprint,v_now
    );
  else
    update sellerpilot_private.qoo10_history_windows history_window set
      completion_state=v_state,
      completion_reason=v_completeness->>'reason',
      provider_status=(v_coverage->>'providerStatus')::integer,
      provider_row_count=(v_coverage->>'providerRows')::integer,
      provider_total=case when jsonb_typeof(v_coverage->'providerTotal')='number'
        then (v_coverage->>'providerTotal')::integer end,
      observed_row_limit=case when jsonb_typeof(v_coverage->'observedRowLimit')='number'
        then (v_coverage->>'observedRowLimit')::integer end,
      refinement_count=v_refinement_count,
      irreducible_gap=(v_coverage->>'irreducibleGap')::boolean,
      completion_claim_token=p_claim_token,
      completion_worker_token_id=v_worker_token_id,
      completion_fingerprint=v_completion_fingerprint,
      updated_at=v_now
    where history_window.id=v_existing.id;
  end if;

  for v_child in select value from jsonb_array_elements(p_completion->'refinementRequests') loop
    v_child_marker := v_child#>'{arguments,sellerpilotHistoryWindow}';
    if jsonb_typeof(v_child) is distinct from 'object'
       or jsonb_typeof(v_child->'periodicKey') is distinct from 'string'
       or jsonb_typeof(v_child->'arguments') is distinct from 'object'
       or jsonb_typeof(v_child#>'{arguments,params}') is distinct from 'object'
       or jsonb_typeof(v_child_marker) is distinct from 'object' then
      raise exception 'QOO10_HISTORY_CHILD_INVALID' using errcode='22023';
    end if;

    select count(*)::integer into v_child_key_count
      from jsonb_object_keys(v_child);
    select count(*)::integer into v_arguments_key_count
      from jsonb_object_keys(v_child->'arguments');
    select count(*)::integer into v_params_key_count
      from jsonb_object_keys(v_child#>'{arguments,params}');

    if v_child_key_count <> 2
       or coalesce(v_child->>'periodicKey','') !~ '^inquiries:history:qoo10:(inquiry:S[123]|claim:all):[0-9]{14}:[0-9]{14}$'
       or jsonb_typeof(v_child_marker->'contractVersion') is distinct from 'string'
       or v_child_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-history-window/1'
       or jsonb_typeof(v_child_marker->'windowKey') is distinct from 'string'
       or v_child_marker->>'windowKey' is distinct from v_child->>'periodicKey'
       or jsonb_typeof(v_child_marker->'parentWindowKey') is distinct from 'string'
       or v_child_marker->>'parentWindowKey' is distinct from v_window_key
       or jsonb_typeof(v_child_marker->'source') is distinct from 'string'
       or v_child_marker->>'source' is distinct from v_marker->>'source'
       or coalesce(v_child_marker->>'status','') is distinct from coalesce(v_marker->>'status','')
       or jsonb_typeof(v_child_marker->'calendarDate') is distinct from 'string'
       or v_child_marker->>'calendarDate' is distinct from v_marker->>'calendarDate'
       or jsonb_typeof(v_child_marker->'refinement') is distinct from 'string'
       or (case v_marker->>'refinement'
         when 'day' then v_child_marker->>'refinement'='hour'
         when 'hour' then v_child_marker->>'refinement'='minute'
         when 'minute' then v_child_marker->>'refinement'='second'
         else false
       end) is distinct from true
       or (v_child#>>'{arguments,params,search_start_dt}' is distinct from split_part(v_child->>'periodicKey',':',6)
          and v_child#>>'{arguments,params,search_Sdate}' is distinct from split_part(v_child->>'periodicKey',':',6))
       or (v_child#>>'{arguments,params,search_end_dt}' is distinct from split_part(v_child->>'periodicKey',':',7)
          and v_child#>>'{arguments,params,search_Edate}' is distinct from split_part(v_child->>'periodicKey',':',7))
       or (v_marker->>'source'='qapi_inquiry' and (
         v_arguments_key_count <> 2
         or v_params_key_count <> 3
         or v_child#>>'{arguments,params,proc_status}' is distinct from v_marker->>'status'
       ))
       or (v_marker->>'source'='qapi_claim' and (
         v_arguments_key_count <> 3
         or v_child#>>'{arguments,kind}' is distinct from 'claim'
         or v_params_key_count <> 3
         or v_child#>>'{arguments,params,search_condition}' is distinct from '2'
       ))
       or octet_length((v_child->'arguments')::text) > 4000 then
      raise exception 'QOO10_HISTORY_CHILD_INVALID' using errcode='22023';
    end if;

    v_child_window_id := null;
    insert into sellerpilot_private.qoo10_history_windows(
      credential_id,window_key,source,inquiry_status,calendar_date,refinement,
      parent_window_key,completion_state
    ) values (
      v_job.credential_id,v_child->>'periodicKey',v_child_marker->>'source',
      nullif(v_child_marker->>'status',''),(v_child_marker->>'calendarDate')::date,
      v_child_marker->>'refinement',v_window_key,'queued'
    ) on conflict (credential_id,window_key) do nothing
      returning id into v_child_window_id;

    if v_child_window_id is not null then
      v_child_job_id := gen_random_uuid();
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,attempt_id,channel,operation,environment,request_payload,
        seller_account_key,created_by
      ) values (
        v_child_job_id,v_job.credential_id,null,'qoo10','inquiries.list',v_job.environment,
        jsonb_build_object('periodicKey',v_child->>'periodicKey','arguments',v_child->'arguments'),
        v_job.seller_account_key,v_job.created_by
      );
      update sellerpilot_private.qoo10_history_windows
         set job_id=v_child_job_id,updated_at=v_now
       where id=v_child_window_id;
    end if;
  end loop;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-history-window-record/1',
    'status',v_status,
    'jobId',p_job_id,
    'windowKey',v_window_key,
    'completionState',v_state,
    'refinementCount',v_refinement_count
  );
end
$$;

revoke all on function public.sellerpilot_service_record_qoo10_history_window_v1(
  text,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_record_qoo10_history_window_v1(
  text,uuid,uuid,jsonb
) to service_role;

commit;
