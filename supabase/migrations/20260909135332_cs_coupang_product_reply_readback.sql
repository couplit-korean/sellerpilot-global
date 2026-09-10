-- CONT-07 accumulated proposal only. Apply from the central integration worktree after review.
-- Depends on 20260908143355_cs_coupang_reply_readback.sql and the accepted R06 migration.
begin;

do $$ begin
  if to_regclass('sellerpilot_private.coupang_reply_readback_links') is null
     or to_regprocedure('sellerpilot_private.enqueue_coupang_reply_readback_after_acceptance()') is null
     or to_regprocedure('public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)') is null then
    raise exception 'COUPANG_PRODUCT_READBACK_PREIMAGE_MISMATCH' using errcode='55000';
  end if;
end $$;

create table sellerpilot_private.coupang_product_reply_readback_links (
  source_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  delivery_id uuid not null references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  child_job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  ticket_id uuid not null references sellerpilot_private.support_tickets(id) on delete restrict,
  inquiry_id text not null check (inquiry_id ~ '^[1-9][0-9]*$'),
  expected_inbound_key text not null check (expected_inbound_key ~ '^coupang:[a-f0-9]{64}$'),
  expected_reply_fingerprint text not null check (expected_reply_fingerprint ~ '^[a-f0-9]{64}$'),
  inquiry_start_at date not null,
  inquiry_end_at date not null,
  created_at timestamptz not null default clock_timestamp(),
  check (inquiry_end_at >= inquiry_start_at and inquiry_end_at - inquiry_start_at <= 6)
);
create index coupang_product_reply_readback_links_source_idx
  on sellerpilot_private.coupang_product_reply_readback_links(source_job_id,created_at,child_job_id);
alter table sellerpilot_private.coupang_product_reply_readback_links enable row level security;
revoke all on sellerpilot_private.coupang_product_reply_readback_links
  from public, anon, authenticated, service_role;

create table sellerpilot_private.coupang_product_reply_readback_retries (
  child_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  retry_count integer not null check (retry_count between 1 and 2),
  worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  claim_sha256 text not null check (claim_sha256 ~ '^[a-f0-9]{64}$'),
  arguments_sha256 text not null check (arguments_sha256 ~ '^[a-f0-9]{64}$'),
  provider_status integer not null,
  observed_at timestamptz not null,
  next_attempt_at timestamptz not null,
  primary key (child_job_id, retry_count)
);
alter table sellerpilot_private.coupang_product_reply_readback_retries enable row level security;
revoke all on sellerpilot_private.coupang_product_reply_readback_retries
  from public, anon, authenticated, service_role;

create function sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_inbound sellerpilot_private.support_inbound_messages%rowtype;
  v_child_id uuid := gen_random_uuid();
  v_inquiry_id text;
  v_inbound_key text;
  v_start date;
  v_end date;
begin
  if new.channel_key <> 'coupang' or new.status <> 'succeeded'
     or new.verification_status <> 'provider_accepted' then return new; end if;
  if exists(select 1 from sellerpilot_private.coupang_product_reply_readback_links
             where source_job_id=new.gateway_job_id) then return new; end if;

  select * into v_source from sellerpilot_private.channel_gateway_jobs
   where id=new.gateway_job_id for update;
  if not found or v_source.channel<>'coupang' or v_source.operation<>'inquiries.reply'
     or v_source.status<>'succeeded' then
    raise exception 'COUPANG_PRODUCT_READBACK_SOURCE_INVALID' using errcode='23514';
  end if;
  if v_source.request_payload#>>'{arguments,kind}' is distinct from 'product' then return new; end if;
  if v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,contract}'
          is distinct from 'sellerpilot-reply-acceptance/1'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,level}'
          is distinct from 'provider_accepted'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,channel}'
          is distinct from 'coupang'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,kind}'
          is distinct from 'product' then
    raise exception 'COUPANG_PRODUCT_READBACK_ACCEPTANCE_INVALID' using errcode='23514';
  end if;
  if v_source.request_payload#>'{arguments,parentAnswerId}' is not null
     or v_source.request_payload#>'{arguments,expectedParentAnswerId}' is not null then
    update sellerpilot_private.support_reply_deliveries set
      status='reconciliation_required',verification_status='reconciliation_required',
      reconciliation_reason='COUPANG_PRODUCT_READBACK_PARENT_ANSWER_ID_FORBIDDEN',
      updated_at=clock_timestamp()
     where id=new.id;
    return new;
  end if;
  v_inquiry_id:=nullif(v_source.request_payload#>>'{arguments,inquiryId}','');
  v_inbound_key:=coalesce(nullif(v_source.request_payload->>'sellerpilotInboundKey',''),
                          nullif(v_source.request_payload->>'sellerpilotExpectedInboundKey',''));
  if coalesce(v_inquiry_id,'') !~ '^[1-9][0-9]*$'
     or coalesce(v_inbound_key,'') !~ '^coupang:[a-f0-9]{64}$'
     or new.reply_fingerprint is distinct from v_source.request_payload->>'sellerpilotReplyFingerprint' then
    raise exception 'COUPANG_PRODUCT_READBACK_BINDING_INVALID' using errcode='23514';
  end if;
  select * into v_ticket from sellerpilot_private.support_tickets
   where id=new.ticket_id and channel_key='coupang'
     and external_ticket_id='product:'||v_inquiry_id and not demo for update;
  if not found or v_ticket.latest_inbound_key is distinct from v_inbound_key
     or v_ticket.source_credential_id is distinct from v_source.credential_id
     or v_ticket.seller_account_key is distinct from v_source.seller_account_key
     or v_ticket.owner_id is distinct from v_source.created_by then
    update sellerpilot_private.support_reply_deliveries set
      status='reconciliation_required',verification_status='reconciliation_required',
      reconciliation_reason='COUPANG_PRODUCT_READBACK_TICKET_STALE',updated_at=clock_timestamp()
     where id=new.id;
    return new;
  end if;
  select * into v_inbound from sellerpilot_private.support_inbound_messages
   where ticket_id=v_ticket.id and owner_id=v_ticket.owner_id and channel_key='coupang'
     and inbound_key=v_inbound_key and sender_role='customer' for share;
  if not found then
    update sellerpilot_private.support_reply_deliveries set
      status='reconciliation_required',verification_status='reconciliation_required',
      reconciliation_reason='COUPANG_PRODUCT_READBACK_INBOUND_MISSING',updated_at=clock_timestamp()
     where id=new.id;
    return new;
  end if;
  select * into v_credential from sellerpilot_private.channel_credentials
   where id=v_source.credential_id and channel='coupang' and environment=v_source.environment
     and environment='production' and status in('active','grace')
     and created_by=v_ticket.owner_id and seller_account_key=v_source.seller_account_key
     and seller_account_key_source='provider_certified_v1' and seller_account_verified_at is not null
     and (expires_at is null or expires_at>statement_timestamp()) for share;
  if not found then
    update sellerpilot_private.support_reply_deliveries set
      status='reconciliation_required',verification_status='reconciliation_required',
      reconciliation_reason='COUPANG_PRODUCT_READBACK_CREDENTIAL_INVALID',updated_at=clock_timestamp()
     where id=new.id;
    return new;
  end if;

  -- Freeze a seven-calendar-day KST window around the exact customer message.
  -- This remains valid when the inquiry is older than the ordinary current poll.
  v_start:=((v_inbound.received_at at time zone 'Asia/Seoul')::date-3);
  v_end:=((v_inbound.received_at at time zone 'Asia/Seoul')::date+3);
  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,request_payload,created_by,seller_account_key
  ) values (
    v_child_id,v_source.credential_id,null,'coupang','inquiries.list',v_source.environment,
    jsonb_build_object(
      'periodicKey','inquiries:product-reply-readback:'||v_source.id::text,
      'arguments',jsonb_build_object(
        'kind','product-reply-readback','inquiryId',v_inquiry_id,
        'sourceJobId',v_source.id,'ticketId',v_ticket.id,
        'expectedInboundKey',v_inbound_key,'expectedReplyFingerprint',new.reply_fingerprint,
        'sellerpilotCoupangReadbackAttempt',0,
        'query',jsonb_build_object('answeredType','ALL','inquiryStartAt',to_char(v_start,'YYYY-MM-DD'),
          'inquiryEndAt',to_char(v_end,'YYYY-MM-DD'),'pageNum',1,'pageSize',50)
      )
    ),v_source.created_by,v_source.seller_account_key
  );
  insert into sellerpilot_private.coupang_product_reply_readback_links(
    source_job_id,delivery_id,child_job_id,credential_id,ticket_id,inquiry_id,
    expected_inbound_key,expected_reply_fingerprint,inquiry_start_at,inquiry_end_at
  ) values (v_source.id,new.id,v_child_id,v_source.credential_id,v_ticket.id,v_inquiry_id,
            v_inbound_key,new.reply_fingerprint,v_start,v_end);
  return new;
end $$;
revoke all on function sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()
  from public,anon,authenticated,service_role;
create trigger enqueue_coupang_product_reply_readback_after_acceptance
after insert or update of status,verification_status on sellerpilot_private.support_reply_deliveries
for each row execute function sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance();

create function sellerpilot_private.bind_coupang_product_reply_readback_continuation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_parent_id uuid;
  v_parent sellerpilot_private.channel_gateway_jobs%rowtype;
  v_link sellerpilot_private.coupang_product_reply_readback_links%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_old jsonb;
  v_next jsonb;
begin
  if new.channel<>'coupang' or new.operation<>'inquiries.list'
     or new.request_payload#>>'{arguments,kind}' is distinct from 'product-reply-readback' then
    return new;
  end if;
  begin v_parent_id:=nullif(new.request_payload->>'continuationOf','')::uuid;
  exception when others then
    raise exception 'COUPANG_PRODUCT_READBACK_CONTINUATION_INVALID' using errcode='23514';
  end;
  if v_parent_id is null then return new; end if;
  select * into v_parent from sellerpilot_private.channel_gateway_jobs where id=v_parent_id for share;
  select * into v_link from sellerpilot_private.coupang_product_reply_readback_links
   where child_job_id=v_parent_id for share;
  select * into v_ticket from sellerpilot_private.support_tickets where id=v_link.ticket_id for share;
  v_old:=v_parent.request_payload->'arguments';
  v_next:=new.request_payload->'arguments';
  if v_parent.id is null or v_link.child_job_id is null or v_ticket.id is null
     or new.credential_id is distinct from v_link.credential_id
     or new.environment is distinct from v_parent.environment
     or new.created_by is distinct from v_ticket.owner_id
     or new.seller_account_key is not null and new.seller_account_key is distinct from v_ticket.seller_account_key
     or v_next ? 'parentAnswerId' or v_next ? 'expectedParentAnswerId'
     or v_next->>'sourceJobId' is distinct from v_link.source_job_id::text
     or v_next->>'ticketId' is distinct from v_link.ticket_id::text
     or v_next->>'inquiryId' is distinct from v_link.inquiry_id
     or v_next->>'expectedInboundKey' is distinct from v_link.expected_inbound_key
     or v_next->>'expectedReplyFingerprint' is distinct from v_link.expected_reply_fingerprint
     or v_next->>'sellerpilotCoupangReadbackAttempt' is distinct from v_old->>'sellerpilotCoupangReadbackAttempt'
     or v_next#>>'{query,answeredType}' is distinct from 'ALL'
     or v_next#>>'{query,pageSize}' is distinct from '50'
     or v_next#>>'{query,inquiryStartAt}' is distinct from to_char(v_link.inquiry_start_at,'YYYY-MM-DD')
     or v_next#>>'{query,inquiryEndAt}' is distinct from to_char(v_link.inquiry_end_at,'YYYY-MM-DD')
     or coalesce((v_next#>>'{query,pageNum}')::integer,0)
          is distinct from coalesce((v_old#>>'{query,pageNum}')::integer,0)+1
     or coalesce((v_next#>>'{query,pageNum}')::integer,0) not between 2 and 50 then
    raise exception 'COUPANG_PRODUCT_READBACK_CONTINUATION_INVALID' using errcode='23514';
  end if;
  update sellerpilot_private.channel_gateway_jobs set seller_account_key=v_ticket.seller_account_key
   where id=new.id and seller_account_key is null;
  insert into sellerpilot_private.coupang_product_reply_readback_links(
    source_job_id,delivery_id,child_job_id,credential_id,ticket_id,inquiry_id,
    expected_inbound_key,expected_reply_fingerprint,inquiry_start_at,inquiry_end_at
  ) values(v_link.source_job_id,v_link.delivery_id,new.id,v_link.credential_id,v_link.ticket_id,
    v_link.inquiry_id,v_link.expected_inbound_key,v_link.expected_reply_fingerprint,
    v_link.inquiry_start_at,v_link.inquiry_end_at);
  return new;
end $$;
revoke all on function sellerpilot_private.bind_coupang_product_reply_readback_continuation()
  from public,anon,authenticated,service_role;
create trigger bind_coupang_product_reply_readback_continuation
after insert on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.bind_coupang_product_reply_readback_continuation();

create function public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_retry_arguments jsonb,
  p_retry_count integer,p_retry_after_seconds integer,p_deferred_count integer,
  p_replay_count integer,p_provider_status integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_token_id uuid;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_link sellerpilot_private.coupang_product_reply_readback_links%rowtype;
  v_existing sellerpilot_private.coupang_product_reply_readback_retries%rowtype;
  v_old jsonb;
  v_delay integer;
  v_claim_hash text:=encode(extensions.digest(p_claim_token::text,'sha256'),'hex');
  v_args_hash text:=encode(extensions.digest(p_retry_arguments::text,'sha256'),'hex');
begin
  select id into v_token_id from sellerpilot_private.ai_cli_worker_tokens
   where token_hash=p_token_hash and scope in('gateway','serverless_cs')
     and status='active' and expires_at>v_now;
  if v_token_id is null then raise exception 'invalid worker token' using errcode='42501'; end if;
  v_delay:=case p_retry_count when 1 then 15 when 2 then 60 else null end;
  if p_claim_token is null or v_delay is null or p_retry_after_seconds is distinct from v_delay
     or p_deferred_count is distinct from 1 or p_replay_count is distinct from 0
     or not coalesce(p_provider_status in(0,404,408,425,429,500,502,503,504),false)
     or jsonb_typeof(p_retry_arguments) is distinct from 'object'
     or octet_length(p_retry_arguments::text)>64000 then
    raise exception 'COUPANG_PRODUCT_READBACK_RETRY_INVALID' using errcode='22023';
  end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs
   where id=p_job_id and status='running' and worker_token_id=v_token_id
     and claim_token=p_claim_token and lease_expires_at>v_now for update;
  if not found then
    select * into v_existing from sellerpilot_private.coupang_product_reply_readback_retries
     where child_job_id=p_job_id and retry_count=p_retry_count;
    if not found or v_existing.worker_token_id is distinct from v_token_id
       or v_existing.claim_sha256 is distinct from v_claim_hash
       or v_existing.arguments_sha256 is distinct from v_args_hash
       or v_existing.provider_status is distinct from p_provider_status
       or not exists(select 1 from sellerpilot_private.channel_gateway_jobs j
         where j.id=p_job_id and j.status='queued' and j.worker_token_id is null and j.claim_token is null
           and j.rate_not_before=v_existing.next_attempt_at
           and encode(extensions.digest((j.request_payload->'arguments')::text,'sha256'),'hex')=v_args_hash) then
      raise exception 'COUPANG_PRODUCT_READBACK_RETRY_REPLAY_CONFLICT' using errcode='40001';
    end if;
    return jsonb_build_object('contract','sellerpilot-coupang-product-reply-readback-retry/1',
      'status','deferred','retryCount',p_retry_count,'retryAfterSeconds',p_retry_after_seconds,
      'failureCode','COUPANG_PRODUCT_REPLY_READBACK_PENDING','replayed',true);
  end if;
  select * into v_link from sellerpilot_private.coupang_product_reply_readback_links
   where child_job_id=v_job.id for share;
  if not found or v_job.channel<>'coupang' or v_job.operation<>'inquiries.list'
     or v_job.provider_mutation_started_at is not null
     or v_job.credential_id is distinct from v_link.credential_id
     or v_job.seller_account_key is distinct from (select seller_account_key from sellerpilot_private.support_tickets where id=v_link.ticket_id)
     or not exists(select 1 from sellerpilot_private.channel_credentials c
       where c.id=v_link.credential_id and c.channel='coupang' and c.status in('active','grace')
         and (c.expires_at is null or c.expires_at>v_now))
     or not exists(select 1 from sellerpilot_private.support_tickets t
       where t.id=v_link.ticket_id and t.latest_inbound_key=v_link.expected_inbound_key and not t.demo) then
    raise exception 'COUPANG_PRODUCT_READBACK_RETRY_STALE' using errcode='55000';
  end if;
  v_old:=v_job.request_payload->'arguments';
  if p_retry_arguments->>'kind' is distinct from 'product-reply-readback'
     or p_retry_arguments ? 'parentAnswerId' or p_retry_arguments ? 'expectedParentAnswerId'
     or (p_retry_arguments->>'sellerpilotCoupangReadbackAttempt')::integer is distinct from p_retry_count
     or p_retry_count is distinct from coalesce((v_old->>'sellerpilotCoupangReadbackAttempt')::integer,0)+1
     or p_retry_arguments->>'inquiryId' is distinct from v_link.inquiry_id
     or p_retry_arguments->>'sourceJobId' is distinct from v_link.source_job_id::text
     or p_retry_arguments->>'ticketId' is distinct from v_link.ticket_id::text
     or p_retry_arguments->>'expectedInboundKey' is distinct from v_link.expected_inbound_key
     or p_retry_arguments->>'expectedReplyFingerprint' is distinct from v_link.expected_reply_fingerprint
     or p_retry_arguments#>>'{query,answeredType}' is distinct from 'ALL'
     or p_retry_arguments#>>'{query,pageNum}' is distinct from '1'
     or p_retry_arguments#>>'{query,pageSize}' is distinct from '50'
     or p_retry_arguments#>>'{query,inquiryStartAt}' is distinct from to_char(v_link.inquiry_start_at,'YYYY-MM-DD')
     or p_retry_arguments#>>'{query,inquiryEndAt}' is distinct from to_char(v_link.inquiry_end_at,'YYYY-MM-DD') then
    raise exception 'COUPANG_PRODUCT_READBACK_RETRY_SCOPE_CHANGED' using errcode='22023';
  end if;
  insert into sellerpilot_private.coupang_product_reply_readback_retries(
    child_job_id,retry_count,worker_token_id,claim_sha256,arguments_sha256,provider_status,observed_at,next_attempt_at
  ) values (v_job.id,p_retry_count,v_token_id,v_claim_hash,v_args_hash,p_provider_status,v_now,
            v_now+p_retry_after_seconds*interval '1 second');
  update sellerpilot_private.channel_gateway_jobs set
    request_payload=jsonb_set(request_payload,'{arguments}',p_retry_arguments,false),status='queued',
    worker_token_id=null,claim_token=null,lease_expires_at=null,
    rate_not_before=v_now+p_retry_after_seconds*interval '1 second',
    error_message='COUPANG_PRODUCT_REPLY_READBACK_RETRY_SCHEDULED',completed_at=null,updated_at=v_now
   where id=v_job.id and status='running' and worker_token_id=v_token_id and claim_token=p_claim_token;
  if not found then raise exception 'gateway job ownership lost' using errcode='40001'; end if;
  return jsonb_build_object('contract','sellerpilot-coupang-product-reply-readback-retry/1',
    'status','deferred','retryCount',p_retry_count,'retryAfterSeconds',p_retry_after_seconds,
    'failureCode','COUPANG_PRODUCT_REPLY_READBACK_PENDING','replayed',false);
end $$;
revoke all on function public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
  text,uuid,uuid,jsonb,integer,integer,integer,integer,integer
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_requeue_coupang_product_reply_readback_v1(
  text,uuid,uuid,jsonb,integer,integer,integer,integer,integer
) to service_role;

create function sellerpilot_private.mark_coupang_product_reply_readback_terminal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status not in('failed','reconciliation_required') then return new; end if;
  update sellerpilot_private.support_reply_deliveries delivery set
    status='reconciliation_required',verification_status='reconciliation_required',
    reconciliation_reason=left(coalesce(new.error_message,'COUPANG_PRODUCT_REPLY_READBACK_TERMINAL'),1000),
    updated_at=clock_timestamp()
  from sellerpilot_private.coupang_product_reply_readback_links link
  where link.child_job_id=new.id and delivery.id=link.delivery_id
    and delivery.verification_status<>'remote_observed';
  return new;
end $$;
revoke all on function sellerpilot_private.mark_coupang_product_reply_readback_terminal()
  from public,anon,authenticated,service_role;
create trigger mark_coupang_product_reply_readback_terminal
after update of status on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.mark_coupang_product_reply_readback_terminal();

commit;
