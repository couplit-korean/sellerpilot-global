-- Proposal only. Do not apply directly to production.
-- Apply after qoo10-007. This seals only delivery-bound Qoo10 S3 readback
-- jobs when their common gateway completion receipt is inserted. There is no
-- backfill: a receipt that predates this seal is not trusted as S3 evidence.
begin;

create table sellerpilot_private.qoo10_reply_s3_completion_seals (
  job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  credential_id uuid not null,
  channel text not null check (channel = 'qoo10'),
  operation text not null check (operation = 'inquiries.list'),
  environment text not null,
  created_by uuid not null,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  terminal_status text not null
    check (terminal_status in ('succeeded','failed','reconciliation_required')),
  completed_at timestamptz not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  completion_fingerprint text not null check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  sealed_at timestamptz not null default clock_timestamp(),
  unique (job_id, claim_token),
  foreign key (job_id, claim_token)
    references sellerpilot_private.gateway_completion_receipts(job_id, claim_token)
    on delete restrict
);

alter table sellerpilot_private.qoo10_reply_s3_completion_seals enable row level security;
revoke all on sellerpilot_private.qoo10_reply_s3_completion_seals
  from public, anon, authenticated, service_role;

create function sellerpilot_private.qoo10_reply_s3_json_sha256(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(coalesce(p_value, 'null'::jsonb)::text, 'sha256'),
    'hex'
  )
$$;

revoke all on function sellerpilot_private.qoo10_reply_s3_json_sha256(jsonb)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.seal_qoo10_reply_s3_gateway_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_marker jsonb;
begin
  select job.* into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.job_id
   for share;
  if not found then
    raise exception 'QOO10_REPLY_S3_SEAL_JOB_MISSING' using errcode = '55000';
  end if;

  v_marker := v_job.request_payload#>'{arguments,sellerpilotQoo10ReplyReadback}';
  if v_marker is null then return new; end if;

  if jsonb_typeof(v_marker) is distinct from 'object'
     or v_marker->>'contractVersion' is distinct from 'sellerpilot-qoo10-reply-readback/1'
     or coalesce(v_marker->>'deliveryId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_marker->>'inquiryType','') not in ('MSG','HELP','ITEM')
     or coalesce(v_marker->>'questionNo','') !~ '^[0-9]{1,40}$'
     or coalesce(v_marker->>'sequenceNo','') !~ '^[0-9]{1,40}$'
     or v_job.request_payload#>>'{arguments,params,proc_status}' is distinct from 'S3'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_start_dt}','') !~ '^[0-9]{14}$'
     or coalesce(v_job.request_payload#>>'{arguments,params,search_end_dt}','') !~ '^[0-9]{14}$'
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'inquiries.list'
     or v_job.status not in ('succeeded','failed','reconciliation_required')
     or v_job.completed_at is null
     or v_job.credential_id is null
     or v_job.created_by is null
     or coalesce(v_job.seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or new.claim_token is null
     or new.worker_token_id is null
     or coalesce(new.completion_fingerprint,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'QOO10_REPLY_S3_SEAL_SOURCE_INVALID' using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_reply_s3_completion_seals (
    job_id,claim_token,worker_token_id,credential_id,channel,operation,
    environment,created_by,seller_account_key,terminal_status,completed_at,
    request_sha256,response_sha256,completion_fingerprint
  ) values (
    v_job.id,new.claim_token,new.worker_token_id,v_job.credential_id,
    v_job.channel,v_job.operation,v_job.environment,v_job.created_by,
    v_job.seller_account_key,v_job.status,v_job.completed_at,
    sellerpilot_private.qoo10_reply_s3_json_sha256(v_job.request_payload),
    sellerpilot_private.qoo10_reply_s3_json_sha256(v_job.response_payload),
    new.completion_fingerprint
  );
  return new;
end
$$;

revoke all on function sellerpilot_private.seal_qoo10_reply_s3_gateway_completion()
  from public, anon, authenticated, service_role;

create trigger seal_qoo10_reply_s3_gateway_completion
after insert on sellerpilot_private.gateway_completion_receipts
for each row execute function sellerpilot_private.seal_qoo10_reply_s3_gateway_completion();

create function sellerpilot_private.guard_qoo10_reply_s3_sealed_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from sellerpilot_private.qoo10_reply_s3_completion_seals seal
     where seal.job_id = old.id
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'QOO10_REPLY_S3_SEALED_JOB_IMMUTABLE' using errcode = '55000';
  end if;
  if new.credential_id is distinct from old.credential_id
     or new.channel is distinct from old.channel
     or new.operation is distinct from old.operation
     or new.environment is distinct from old.environment
     or new.status is distinct from old.status
     or new.request_payload is distinct from old.request_payload
     or new.response_payload is distinct from old.response_payload
     or new.created_by is distinct from old.created_by
     or new.seller_account_key is distinct from old.seller_account_key
     or new.completed_at is distinct from old.completed_at then
    raise exception 'QOO10_REPLY_S3_SEALED_JOB_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_sealed_job()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_sealed_job
before update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_sealed_job();

create function sellerpilot_private.guard_qoo10_reply_s3_seal_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from sellerpilot_private.qoo10_reply_s3_completion_seals seal
     where seal.job_id = old.job_id
  ) then
    raise exception 'QOO10_REPLY_S3_COMPLETION_RECEIPT_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_seal_source()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_seal_source
before update or delete on sellerpilot_private.gateway_completion_receipts
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_seal_source();

create function sellerpilot_private.guard_qoo10_reply_s3_seal_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'QOO10_REPLY_S3_COMPLETION_SEAL_IMMUTABLE' using errcode = '55000';
end
$$;

revoke all on function sellerpilot_private.guard_qoo10_reply_s3_seal_immutable()
  from public, anon, authenticated, service_role;

create trigger guard_qoo10_reply_s3_seal_immutable
before update or delete on sellerpilot_private.qoo10_reply_s3_completion_seals
for each row execute function sellerpilot_private.guard_qoo10_reply_s3_seal_immutable();

alter function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) rename to sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1;

revoke all on function public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_delivery_id uuid,
  p_state text,
  p_reason text,
  p_matching_rows integer,
  p_reply_content_observed boolean,
  p_resend_allowed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform 1
    from sellerpilot_private.qoo10_reply_s3_completion_seals seal
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id = seal.job_id
     and receipt.claim_token = seal.claim_token
     and receipt.worker_token_id = seal.worker_token_id
     and receipt.completion_fingerprint = seal.completion_fingerprint
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = seal.job_id
     and job.credential_id = seal.credential_id
     and job.channel = seal.channel
     and job.operation = seal.operation
     and job.environment = seal.environment
     and job.created_by = seal.created_by
     and job.seller_account_key = seal.seller_account_key
     and job.status = seal.terminal_status
     and job.completed_at = seal.completed_at
   where seal.job_id = p_job_id
     and seal.claim_token = p_claim_token
     and sellerpilot_private.qoo10_reply_s3_json_sha256(job.request_payload)
           = seal.request_sha256
     and sellerpilot_private.qoo10_reply_s3_json_sha256(job.response_payload)
           = seal.response_sha256
   for share of seal, receipt, job;
  if not found then
    raise exception 'QOO10_REPLY_S3_READBACK_SEAL_INVALID' using errcode = '55000';
  end if;

  select public.sellerpilot_service_record_qoo10_reply_s3_readback_unsealed_v1(
    p_token_hash,p_job_id,p_claim_token,p_delivery_id,p_state,p_reason,
    p_matching_rows,p_reply_content_observed,p_resend_allowed
  ) into v_result;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
  text,uuid,uuid,uuid,text,text,integer,boolean,boolean
) to service_role;

commit;
