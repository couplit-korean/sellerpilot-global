begin;

create table sellerpilot_private.shopee_reply_readback_attempts (
  delivery_id uuid not null
    references sellerpilot_private.support_reply_deliveries(id) on delete restrict,
  attempt integer not null check (attempt between 1 and 3),
  source_job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  readback_job_id uuid not null unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  next_readback_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  ticket_id uuid not null
    references sellerpilot_private.support_tickets(id) on delete restrict,
  shop_id text not null check (shop_id ~ '^[1-9][0-9]{0,31}$'),
  comment_id text not null check (comment_id ~ '^[1-9][0-9]{0,18}$'),
  item_id text not null check (item_id ~ '^[1-9][0-9]{0,18}$'),
  expected_inbound_key text not null check (expected_inbound_key ~ '^shopee:[a-f0-9]{64}$'),
  expected_reply_fingerprint text not null check (expected_reply_fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued'
    check (state in ('queued','observed','delayed','missing','mismatch','incomplete')),
  reason text,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (delivery_id, attempt),
  unique (source_job_id, attempt)
);

alter table sellerpilot_private.shopee_reply_readback_attempts enable row level security;
revoke all on sellerpilot_private.shopee_reply_readback_attempts
  from public, anon, authenticated, service_role;

create function sellerpilot_private.enqueue_shopee_reply_readback_after_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_readback_job_id uuid := gen_random_uuid();
  v_shop_id text; v_comment_id text; v_item_id text; v_inbound_key text;
begin
  if new.channel_key <> 'shopee' or new.status <> 'succeeded'
     or new.verification_status <> 'provider_accepted' then return new; end if;
  if exists (select 1 from sellerpilot_private.shopee_reply_readback_attempts attempt
      where attempt.delivery_id = new.id) then return new; end if;

  select job.* into v_source from sellerpilot_private.channel_gateway_jobs job
   where job.id = new.gateway_job_id for update;
  if not found or v_source.channel <> 'shopee' or v_source.operation <> 'inquiries.reply'
     or v_source.status <> 'succeeded'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,contract}'
          is distinct from 'sellerpilot-reply-acceptance/1'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,level}'
          is distinct from 'provider_accepted'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,channel}'
          is distinct from 'shopee'
     or v_source.response_payload#>>'{steps,0,data,sellerpilotReplyAcceptance,kind}'
          is distinct from 'product_review' then
    raise exception 'SHOPEE_REPLY_READBACK_SOURCE_INVALID' using errcode = '23514';
  end if;
  v_shop_id := nullif(v_source.request_payload#>>'{arguments,shopId}','');
  v_comment_id := nullif(v_source.request_payload#>>'{arguments,commentId}','');
  v_item_id := nullif(v_source.request_payload#>>'{arguments,itemId}','');
  v_inbound_key := nullif(v_source.request_payload->>'sellerpilotInboundKey','');
  if coalesce(v_shop_id,'') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(v_comment_id,'') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(v_item_id,'') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(v_inbound_key,'') !~ '^shopee:[a-f0-9]{64}$'
     or new.reply_fingerprint is distinct from
          v_source.request_payload->>'sellerpilotReplyFingerprint' then
    raise exception 'SHOPEE_REPLY_READBACK_BINDING_INVALID' using errcode = '23514';
  end if;

  select ticket.* into v_ticket from sellerpilot_private.support_tickets ticket
   where ticket.id = new.ticket_id and ticket.channel_key = 'shopee'
     and ticket.external_ticket_id = 'shopee:' || v_shop_id || ':' || v_comment_id
     and ticket.reply_context->>'shopId' = v_shop_id
     and ticket.reply_context->>'commentId' = v_comment_id
     and ticket.reply_context->>'itemId' = v_item_id and not ticket.demo for update;
  if not found then raise exception 'SHOPEE_REPLY_READBACK_TICKET_INVALID' using errcode = '23514'; end if;

  select credential.* into v_credential from sellerpilot_private.channel_credentials credential
   where credential.id = v_source.credential_id and credential.channel = 'shopee'
     and credential.environment = v_source.environment
     and credential.created_by = v_ticket.owner_id and credential.status in ('active','grace')
     and (credential.expires_at is null or credential.expires_at > statement_timestamp()) for share;
  if not found or v_source.created_by is distinct from v_ticket.owner_id
     or v_ticket.source_credential_id is distinct from v_source.credential_id
     or coalesce(v_source.seller_account_key,'') !~ '^[a-f0-9]{64}$'
     or v_ticket.seller_account_key is distinct from v_source.seller_account_key
     or v_credential.seller_account_key is distinct from v_source.seller_account_key then
    raise exception 'SHOPEE_REPLY_READBACK_CREDENTIAL_INVALID' using errcode = '23514';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,request_payload,
    created_by,seller_account_key,rate_not_before
  ) values (
    v_readback_job_id,v_source.credential_id,null,'shopee','inquiries.list',v_source.environment,
    jsonb_build_object(
      'periodicKey','inquiries:reply-readback:shopee:' || new.id::text || ':1',
      'arguments',jsonb_build_object('kind','product_review','shopId',v_shop_id,
        'commentId',v_comment_id,'itemId',v_item_id,'cursor','','pageSize',100),
      'sellerpilotShopeeReplyReadback',jsonb_build_object(
        'contract','sellerpilot-shopee-reply-readback/1','deliveryId',new.id,
        'sourceJobId',v_source.id,'ticketId',v_ticket.id,'expectedInboundKey',v_inbound_key,
        'expectedReplyFingerprint',new.reply_fingerprint,'shopId',v_shop_id,
        'commentId',v_comment_id,'itemId',v_item_id,'attempt',1)
    ),v_source.created_by,v_source.seller_account_key,clock_timestamp()+interval '15 seconds'
  );
  insert into sellerpilot_private.shopee_reply_readback_attempts(
    delivery_id,attempt,source_job_id,readback_job_id,credential_id,ticket_id,
    shop_id,comment_id,item_id,expected_inbound_key,expected_reply_fingerprint
  ) values (new.id,1,v_source.id,v_readback_job_id,v_source.credential_id,v_ticket.id,
    v_shop_id,v_comment_id,v_item_id,v_inbound_key,new.reply_fingerprint);
  return new;
end $$;

revoke all on function sellerpilot_private.enqueue_shopee_reply_readback_after_acceptance()
  from public, anon, authenticated, service_role;
create trigger enqueue_shopee_reply_readback_after_acceptance
after insert or update of status,verification_status
on sellerpilot_private.support_reply_deliveries for each row execute function
sellerpilot_private.enqueue_shopee_reply_readback_after_acceptance();

create function public.sellerpilot_service_record_shopee_reply_readback_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_delivery_id uuid,p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt sellerpilot_private.shopee_reply_readback_attempts%rowtype;
  v_delivery sellerpilot_private.support_reply_deliveries%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_next_job_id uuid; v_state text; v_reason text; v_attempt_no integer;
  v_evidence_sha text; v_now timestamptz := clock_timestamp();
begin
  if coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$' or p_job_id is null
     or p_claim_token is null or p_delivery_id is null
     or jsonb_typeof(p_outcome) is distinct from 'object'
     or not (p_outcome ?& array['state','reason','attempt','matchingSellerReplies',
       'replyContentObserved','automaticResendAllowed'])
     or p_outcome - array['state','reason','attempt','matchingSellerReplies',
       'replyContentObserved','automaticResendAllowed'] <> '{}'::jsonb then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_outcome->'state') is distinct from 'string'
     or jsonb_typeof(p_outcome->'reason') is distinct from 'string'
     or jsonb_typeof(p_outcome->'attempt') is distinct from 'number'
     or coalesce(p_outcome->>'attempt','') !~ '^[1-3]$'
     or jsonb_typeof(p_outcome->'matchingSellerReplies') is distinct from 'number'
     or coalesce(p_outcome->>'matchingSellerReplies','') !~ '^(0|[1-9][0-9]{0,8})$'
     or jsonb_typeof(p_outcome->'replyContentObserved') is distinct from 'boolean'
     or jsonb_typeof(p_outcome->'automaticResendAllowed') is distinct from 'boolean' then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode='22023';
  end if;
  begin
    v_state := p_outcome->>'state'; v_reason := p_outcome->>'reason';
    v_attempt_no := (p_outcome->>'attempt')::integer;
  exception when others then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end;
  if v_state not in ('observed','delayed','missing','mismatch','incomplete')
     or v_attempt_no not between 1 and 3
     or (p_outcome->>'matchingSellerReplies')::integer < 0
     or (p_outcome->>'automaticResendAllowed')::boolean is distinct from false
     or ((p_outcome->>'replyContentObserved')::boolean) is distinct from (v_state='observed')
     or (v_state='observed' and v_reason<>'exact_reply_observed')
     or (v_state='delayed' and (v_reason<>'exact_reply_not_yet_observed' or v_attempt_no>=3))
     or (v_state='missing' and (v_reason<>'exact_reply_missing_after_bound' or v_attempt_no<>3))
     or (v_state='mismatch' and v_reason not in ('reply_body_mismatch','reply_target_mismatch'))
     or (v_state='incomplete' and v_reason not in ('reply_timestamp_unavailable','provider_result_invalid')) then
    raise exception 'SHOPEE_REPLY_READBACK_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select attempt.* into v_attempt
    from sellerpilot_private.shopee_reply_readback_attempts attempt
   where attempt.delivery_id=p_delivery_id and attempt.attempt=v_attempt_no
     and attempt.readback_job_id=p_job_id for update;
  if not found then raise exception 'SHOPEE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000'; end if;


  select job.* into v_job from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.gateway_completion_receipts receipt
      on receipt.job_id=job.id and receipt.claim_token=p_claim_token
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id=receipt.worker_token_id and token.token_hash=p_token_hash
    join sellerpilot_private.support_tickets ticket
      on ticket.id=v_attempt.ticket_id and ticket.owner_id=job.created_by
     and ticket.source_credential_id=job.credential_id and not ticket.demo
     and ticket.seller_account_key=job.seller_account_key
    join sellerpilot_private.channel_credentials credential
      on credential.id=job.credential_id and credential.created_by=job.created_by
     and credential.channel='shopee' and credential.environment=job.environment
     and credential.seller_account_key=job.seller_account_key
     and credential.status in ('active','grace')
     and (credential.expires_at is null or credential.expires_at>v_now)
    join sellerpilot_private.channel_gateway_jobs source
      on source.id=v_attempt.source_job_id and source.created_by=job.created_by
     and source.credential_id=job.credential_id and source.seller_account_key=job.seller_account_key
     and source.channel='shopee' and source.operation='inquiries.reply' and source.status='succeeded'
   where job.id=p_job_id and job.channel='shopee' and job.operation='inquiries.list'
     and job.status='succeeded' and job.credential_id=v_attempt.credential_id
     and token.scope in ('gateway','legacy_combined','serverless_cs') and token.status='active'
     and token.expires_at>v_now;
  if not found
     or v_job.request_payload->>'periodicKey' is distinct from
        'inquiries:reply-readback:shopee:'||p_delivery_id::text||':'||v_attempt_no::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,contract}'
        is distinct from 'sellerpilot-shopee-reply-readback/1'
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,deliveryId}'
        is distinct from p_delivery_id::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,sourceJobId}'
        is distinct from v_attempt.source_job_id::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,ticketId}'
        is distinct from v_attempt.ticket_id::text
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,expectedInboundKey}'
        is distinct from v_attempt.expected_inbound_key
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,expectedReplyFingerprint}'
        is distinct from v_attempt.expected_reply_fingerprint
     or v_job.request_payload#>>'{arguments,shopId}' is distinct from v_attempt.shop_id
     or v_job.request_payload#>>'{arguments,commentId}' is distinct from v_attempt.comment_id
     or v_job.request_payload#>>'{arguments,itemId}' is distinct from v_attempt.item_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,shopId}'
        is distinct from v_attempt.shop_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,commentId}'
        is distinct from v_attempt.comment_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,itemId}'
        is distinct from v_attempt.item_id
     or v_job.request_payload#>>'{sellerpilotShopeeReplyReadback,attempt}'
        is distinct from v_attempt_no::text then
    raise exception 'SHOPEE_REPLY_READBACK_LINEAGE_INVALID' using errcode='55000';
  end if;
  v_evidence_sha := encode(extensions.digest(p_outcome::text,'sha256'),'hex');
  if v_attempt.state<>'queued' then
    if v_attempt.evidence_sha256 is distinct from v_evidence_sha then
      raise exception 'SHOPEE_REPLY_READBACK_REPLAY_MISMATCH' using errcode='40001';
    end if;
    return jsonb_build_object('contract','sellerpilot-shopee-reply-readback-result/1',
      'deliveryId',v_attempt.delivery_id,'attempt',v_attempt.attempt,'state',v_attempt.state,
      'nextJobId',v_attempt.next_readback_job_id,'providerAcceptancePreserved',
        (select verification_status='provider_accepted' from sellerpilot_private.support_reply_deliveries where id=v_attempt.delivery_id),
      'automaticResendAllowed',false);
  end if;

  select delivery.* into v_delivery from sellerpilot_private.support_reply_deliveries delivery
   where delivery.id=p_delivery_id and delivery.gateway_job_id=v_attempt.source_job_id
     and delivery.channel_key='shopee' and delivery.reply_fingerprint=v_attempt.expected_reply_fingerprint
     and delivery.status='succeeded' for update;
  if not found or (v_state='observed' and v_delivery.verification_status<>'remote_observed')
     or (v_state<>'observed' and v_delivery.verification_status<>'provider_accepted') then
    raise exception 'SHOPEE_REPLY_READBACK_OBSERVATION_MISMATCH' using errcode='55000';
  end if;

  v_evidence_sha := encode(extensions.digest(p_outcome::text,'sha256'),'hex');
  if v_state='delayed' then
    v_next_job_id := gen_random_uuid();
    insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,channel,operation,environment,request_payload,
      created_by,seller_account_key,rate_not_before
    ) select v_next_job_id,job.credential_id,null,'shopee','inquiries.list',job.environment,
      jsonb_set(jsonb_set(job.request_payload,'{periodicKey}',
        to_jsonb('inquiries:reply-readback:shopee:'||p_delivery_id::text||':'||(v_attempt_no+1)::text)),
        '{sellerpilotShopeeReplyReadback,attempt}',to_jsonb(v_attempt_no+1)),
      job.created_by,job.seller_account_key,v_now+(30*v_attempt_no)*interval '1 second'
      from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
    insert into sellerpilot_private.shopee_reply_readback_attempts(
      delivery_id,attempt,source_job_id,readback_job_id,credential_id,ticket_id,
      shop_id,comment_id,item_id,expected_inbound_key,expected_reply_fingerprint
    ) values (p_delivery_id,v_attempt_no+1,v_attempt.source_job_id,v_next_job_id,
      v_attempt.credential_id,v_attempt.ticket_id,v_attempt.shop_id,v_attempt.comment_id,
      v_attempt.item_id,v_attempt.expected_inbound_key,v_attempt.expected_reply_fingerprint);
  end if;
  update sellerpilot_private.shopee_reply_readback_attempts set state=v_state,reason=v_reason,
    evidence_sha256=v_evidence_sha,checked_at=v_now,next_readback_job_id=v_next_job_id
   where delivery_id=p_delivery_id and attempt=v_attempt_no;
  return jsonb_build_object('contract','sellerpilot-shopee-reply-readback-result/1',
    'deliveryId',p_delivery_id,'attempt',v_attempt_no,'state',v_state,'nextJobId',v_next_job_id,
    'providerAcceptancePreserved',v_state<>'observed','automaticResendAllowed',false);
end $$;

revoke all on function public.sellerpilot_service_record_shopee_reply_readback_v1(
  text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_shopee_reply_readback_v1(
  text,uuid,uuid,uuid,jsonb) to service_role;

commit;
