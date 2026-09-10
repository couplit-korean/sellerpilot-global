-- Integration-owned forward migration draft. Do not apply from the Lazada
-- worktree. Apply only after canonical Lazada 005, 008, 009, and the dedicated
-- CS reply-draft queue migration 20260908172414.
--
-- Read cursors deliberately use a stable as-of timestamp. Mutations must not:
-- they serialize with V3 ingestion and evaluate every committed revision.
begin;

do $migration$
begin
  if to_regprocedure('public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)') is null
     or to_regprocedure('sellerpilot_private.lazada_im_projection_state_v1(uuid,uuid,text,text,text,text,timestamptz)') is null
     or to_regprocedure('sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz)') is null
     or to_regprocedure('public.sellerpilot_update_ticket(uuid,text,text,text)') is null
     or to_regprocedure('public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text)') is null
     or to_regprocedure('public.sellerpilot_get_cs_reply_draft(uuid)') is null
     or to_regprocedure('public.sellerpilot_claim_cs_reply_draft(text)') is null
     or to_regprocedure('public.sellerpilot_complete_cs_reply_draft(text,uuid,uuid,text,jsonb,text)') is null
     or to_regprocedure('public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)') is null
     or to_regprocedure('public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)') is null
     or to_regprocedure('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)') is null
     or to_regprocedure('sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)') is null
     or to_regprocedure('sellerpilot_private.worker_token_has_scope(text,text,boolean)') is null
     or to_regclass('sellerpilot_private.lazada_im_message_revisions') is null
     or to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.support_tickets') is null
     or to_regclass('sellerpilot_private.support_inbound_messages') is null
     or to_regclass('sellerpilot_private.cs_reply_draft_jobs') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.ai_cli_worker_tokens') is null then
    raise exception 'LAZADA_IM_CONCURRENT_REPLY_FENCE_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('sellerpilot_private.lazada_im_lock_current_ticket_action_v1(uuid,uuid)') is not null
     or to_regprocedure('sellerpilot_private.lazada_im_lock_reply_job_action_v1(uuid)') is not null
     or to_regprocedure('public.sellerpilot_09103500_create_cs_reply_draft_unsafe(uuid,uuid,text,text,text)') is not null
     or to_regprocedure('public.sellerpilot_09100000_enqueue_reply_unsafe(uuid,text,text,jsonb)') is not null then
    raise exception 'LAZADA_IM_CONCURRENT_REPLY_FENCE_ALREADY_EXISTS';
  end if;
end
$migration$;

-- Lock exactly the lineage already used by V3 ingestion. V3 locks the source
-- credential row, then this seller-level key, once before iterating its batch.
-- Reply-side callers use the same order before locking any ticket row. The
-- infinity cutoff means "all rows visible in this fresh VOLATILE query", not
-- a user-visible read cursor and not the statement start time.
create function sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
  p_ticket_id uuid,
  p_expected_owner uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before record;
  v_after record;
  v_credential record;
  v_message record;
  v_state text;
begin
  select ticket.id, ticket.owner_id, ticket.channel_key,
         ticket.source_credential_id, ticket.seller_account_key,
         ticket.external_ticket_id, ticket.latest_inbound_key
    into v_before
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and not ticket.demo;
  if not found then return null; end if;
  if p_expected_owner is not null and v_before.owner_id <> p_expected_owner then
    return null;
  end if;
  if v_before.channel_key <> 'lazada' then
    return jsonb_build_object(
      'ticketId',v_before.id,'ticketChannel',v_before.channel_key,
      'state','normal','latestInboundKey',v_before.latest_inbound_key
    );
  end if;
  if v_before.source_credential_id is null
     or nullif(trim(v_before.seller_account_key),'') is null then
    raise exception 'LAZADA_IM_REPLY_LINEAGE_UNBOUND' using errcode='55000';
  end if;

  select credential.id, credential.created_by, credential.channel,
         credential.seller_account_key, credential.seller_account_key_source,
         credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_before.source_credential_id
   for update;
  if not found
     or v_credential.created_by <> v_before.owner_id
     or v_credential.channel <> 'lazada'
     or v_credential.seller_account_key is distinct from v_before.seller_account_key
     or v_credential.seller_account_key_source <> 'provider_certified_v1'
     or v_credential.seller_account_verified_at is null then
    raise exception 'LAZADA_IM_REPLY_LINEAGE_UNBOUND' using errcode='55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'lazada-im-v3:' || v_before.owner_id::text || ':' || v_before.seller_account_key,
    0
  ));

  select ticket.id, ticket.owner_id, ticket.channel_key,
         ticket.source_credential_id, ticket.seller_account_key,
         ticket.external_ticket_id, ticket.latest_inbound_key
    into v_after
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and not ticket.demo
   for update;
  if not found
     or v_after.owner_id is distinct from v_before.owner_id
     or v_after.channel_key is distinct from v_before.channel_key
     or v_after.source_credential_id is distinct from v_before.source_credential_id
     or v_after.seller_account_key is distinct from v_before.seller_account_key
     or v_after.external_ticket_id is distinct from v_before.external_ticket_id then
    raise exception 'LAZADA_IM_REPLY_LINEAGE_CHANGED' using errcode='40001';
  end if;

  select message.remote_message_id,
         message.provider_context->>'nativeContentFingerprint' as native_content_fingerprint
    into v_message
    from sellerpilot_private.support_inbound_messages message
   where message.ticket_id = v_after.id
     and message.owner_id = v_after.owner_id
     and message.channel_key = 'lazada'
     and message.inbound_key = v_after.latest_inbound_key
   order by message.created_at desc, message.id desc
   limit 1
   for update;
  if not found
     or nullif(trim(v_message.remote_message_id),'') is null
     or coalesce(v_message.native_content_fingerprint,'') !~ '^[a-f0-9]{64}$' then
    v_state := 'context_stale';
  else
    v_state := sellerpilot_private.lazada_im_projection_state_v1(
      v_after.owner_id,
      v_after.source_credential_id,
      v_after.seller_account_key,
      v_after.external_ticket_id,
      v_message.remote_message_id,
      v_message.native_content_fingerprint,
      'infinity'::timestamptz
    );
  end if;
  return jsonb_build_object(
    'ticketId',v_after.id,
    'ticketChannel',v_after.channel_key,
    'ownerId',v_after.owner_id,
    'credentialId',v_after.source_credential_id,
    'sellerAccountKey',v_after.seller_account_key,
    'latestInboundKey',v_after.latest_inbound_key,
    'state',v_state
  );
end
$$;
revoke all on function sellerpilot_private.lazada_im_lock_current_ticket_action_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Revision ingestion owns the same seller lock. If a current generation is
-- recalled or becomes conflicting after enqueue, cancel it before claim/send.
-- A mutation already linearized at provider_mutation_started_at is uncertain,
-- never safe to retry automatically.
create function sellerpilot_private.fence_lazada_reply_jobs_on_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
begin
  if new.revision_kind not in ('recalled','conflict') then return new; end if;
  for v_ticket in
    select ticket.id, ticket.latest_inbound_key
      from sellerpilot_private.support_tickets ticket
      join sellerpilot_private.support_inbound_messages message
        on message.ticket_id=ticket.id
       and message.owner_id=ticket.owner_id
       and message.channel_key=ticket.channel_key
       and message.inbound_key=ticket.latest_inbound_key
     where ticket.owner_id=new.owner_id
       and ticket.channel_key='lazada'
       and ticket.source_credential_id=new.credential_id
       and ticket.seller_account_key=new.seller_account_key
       and ticket.external_ticket_id=new.external_ticket_id
       and message.remote_message_id=new.remote_message_id
       and (
         new.revision_kind='conflict'
         or (
           new.revision_kind='recalled'
           and new.native_content_fingerprint=
             message.provider_context->>'nativeContentFingerprint'
           and new.provider_context->>'eventKind'='recalled'
           and new.provider_context->>'recallTargetMessageId'=message.remote_message_id
         )
       )
     order by ticket.id
  loop
    update sellerpilot_private.channel_gateway_jobs job
       set status=case when job.provider_mutation_started_at is null
              then 'failed' else 'reconciliation_required' end,
           error_message=case when job.provider_mutation_started_at is null
              then 'Lazada latest message became non-actionable before provider mutation.'
              else 'Lazada latest message changed after provider mutation started; provider outcome requires reconciliation.' end,
           completed_at=clock_timestamp(),
           lease_expires_at=null,
           worker_token_id=null,
           claim_token=null,
           updated_at=clock_timestamp()
     where job.channel='lazada'
       and job.operation='inquiries.reply'
       and job.credential_id=new.credential_id
       and job.seller_account_key=new.seller_account_key
       and job.request_payload->>'sellerpilotTicketId'=v_ticket.id::text
       and job.request_payload->>'sellerpilotInboundKey'=v_ticket.latest_inbound_key
       and job.status in ('queued','running');
    update sellerpilot_private.cs_reply_draft_jobs draft
       set status='failed',
           result_payload=null,
           error_message='LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE',
           lease_expires_at=null,
           worker_token_hash=null,
           claim_token=null,
           updated_at=clock_timestamp(),
           completed_at=clock_timestamp()
     where draft.ticket_id=v_ticket.id
       and draft.inbound_key=v_ticket.latest_inbound_key
       and draft.status in ('queued','running','succeeded');
  end loop;
  return new;
end
$$;
revoke all on function sellerpilot_private.fence_lazada_reply_jobs_on_revision_v1()
  from public,anon,authenticated,service_role;
create trigger fence_lazada_reply_jobs_on_revision_v1
after insert on sellerpilot_private.lazada_im_message_revisions
for each row execute function sellerpilot_private.fence_lazada_reply_jobs_on_revision_v1();

-- The authenticated mutation gates use a fresh current-state check while
-- holding the exact V3 lineage lock. Stable read pagination remains unchanged.
alter function public.sellerpilot_update_ticket(uuid,text,text,text)
  rename to sellerpilot_09100000_update_ticket_unsafe;
create function public.sellerpilot_update_ticket(
  p_id uuid,p_status text,p_reply_draft text,p_expected_inbound_key text
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_action jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(p_id,null);
  if v_action->>'ticketChannel'='lazada'
     and v_action->>'state'<>'normal'
     and (nullif(trim(coalesce(p_reply_draft,'')),'') is not null or p_status='resolved') then
    raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode='55000';
  end if;
  return public.sellerpilot_09100000_update_ticket_unsafe(
    p_id,p_status,p_reply_draft,p_expected_inbound_key
  );
end $$;
revoke all on function public.sellerpilot_09100000_update_ticket_unsafe(uuid,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_update_ticket(uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_update_ticket(uuid,text,text,text)
  to authenticated;

-- The current draft route calls the dedicated CS queue directly. Fence its
-- create/read/claim/complete boundaries as well as the legacy compatibility
-- name, and retain the shared-admin contract by not substituting auth.uid()
-- for the ticket owner.
alter function public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text)
  rename to sellerpilot_09103500_create_cs_reply_draft_unsafe;
create function public.sellerpilot_create_cs_reply_draft(
  p_id uuid,p_ticket_id uuid,p_expected_inbound_key text,
  p_target_locale text,p_tone text default 'polite'
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_action jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
    p_ticket_id,null
  );
  if v_action is null then raise exception 'support ticket not found'; end if;
  if v_action->>'ticketChannel'='lazada' and v_action->>'state'<>'normal' then
    raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode='55000';
  end if;
  return public.sellerpilot_09103500_create_cs_reply_draft_unsafe(
    p_id,p_ticket_id,p_expected_inbound_key,p_target_locale,p_tone
  );
end $$;
revoke all on function public.sellerpilot_09103500_create_cs_reply_draft_unsafe(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text)
  to authenticated;

alter function public.sellerpilot_get_cs_reply_draft(uuid)
  rename to sellerpilot_09103500_get_cs_reply_draft_unsafe;
create function public.sellerpilot_get_cs_reply_draft(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_ticket_id uuid; v_action jsonb; v_job record;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select draft.ticket_id into v_ticket_id
    from sellerpilot_private.cs_reply_draft_jobs draft where draft.id=p_id;
  if not found then return null; end if;
  v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
    v_ticket_id,null
  );
  if v_action is null
     or (v_action->>'ticketChannel'='lazada' and v_action->>'state'<>'normal') then
    select draft.id,draft.created_at,draft.updated_at,draft.attempt_count into v_job
      from sellerpilot_private.cs_reply_draft_jobs draft where draft.id=p_id;
    if not found then return null; end if;
    return jsonb_build_object(
      'id',v_job.id,'status','failed','result',null,
      'error','회수됐거나 원문 충돌 상태인 메시지의 답변 초안은 표시할 수 없습니다.',
      'createdAt',v_job.created_at,'updatedAt',v_job.updated_at,
      'attemptCount',v_job.attempt_count
    );
  end if;
  return public.sellerpilot_09103500_get_cs_reply_draft_unsafe(p_id);
end $$;
revoke all on function public.sellerpilot_09103500_get_cs_reply_draft_unsafe(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_get_cs_reply_draft(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_cs_reply_draft(uuid)
  to authenticated;

alter function public.sellerpilot_claim_cs_reply_draft(text)
  rename to sellerpilot_09103500_claim_cs_reply_draft_unsafe;
create function public.sellerpilot_claim_cs_reply_draft(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_candidate record; v_job record; v_action jsonb;
begin
  if sellerpilot_private.worker_token_has_scope(p_token_hash,'ai',true) is distinct from true then
    raise exception 'CS worker authentication required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065043);
  loop
    select draft.id,draft.ticket_id into v_candidate
      from sellerpilot_private.cs_reply_draft_jobs draft
     where draft.status='queued'
        or (draft.status='running' and draft.lease_expires_at<=clock_timestamp())
     order by draft.created_at,draft.id limit 1;
    if not found then return null; end if;
    v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
      v_candidate.ticket_id,null
    );
    select draft.* into v_job
      from sellerpilot_private.cs_reply_draft_jobs draft
     where draft.id=v_candidate.id
       and (draft.status='queued'
         or (draft.status='running' and draft.lease_expires_at<=clock_timestamp()))
     for update;
    if not found then continue; end if;
    if v_job.status='running' and v_job.attempt_count>=3 then
      update sellerpilot_private.cs_reply_draft_jobs
         set status='failed',error_message='답변 초안 작업자의 실행 시간이 만료되었습니다.',
             lease_expires_at=null,worker_token_hash=null,claim_token=null,
             result_payload=null,updated_at=clock_timestamp(),completed_at=clock_timestamp()
       where id=v_job.id;
      continue;
    end if;
    if v_action is null
       or (v_action->>'ticketChannel'='lazada' and v_action->>'state'<>'normal') then
      update sellerpilot_private.cs_reply_draft_jobs
         set status='failed',error_message='LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE',
             lease_expires_at=null,worker_token_hash=null,claim_token=null,
             result_payload=null,updated_at=clock_timestamp(),completed_at=clock_timestamp()
       where id=v_job.id;
      continue;
    end if;
    update sellerpilot_private.cs_reply_draft_jobs
       set status='running',claim_token=gen_random_uuid(),worker_token_hash=p_token_hash,
           lease_expires_at=clock_timestamp()+interval '90 seconds',
           attempt_count=attempt_count+1,started_at=clock_timestamp(),
           updated_at=clock_timestamp(),completed_at=null,error_message=null
     where id=v_job.id returning * into v_job;
    return jsonb_build_object(
      'id',v_job.id,'claim_token',v_job.claim_token,'request',v_job.request_payload,
      'attempt_count',v_job.attempt_count,'lease_expires_at',v_job.lease_expires_at
    );
  end loop;
end $$;
revoke all on function public.sellerpilot_09103500_claim_cs_reply_draft_unsafe(text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_claim_cs_reply_draft(text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_claim_cs_reply_draft(text)
  to service_role;

alter function public.sellerpilot_complete_cs_reply_draft(text,uuid,uuid,text,jsonb,text)
  rename to sellerpilot_09103500_complete_cs_reply_draft_unsafe;
create function public.sellerpilot_complete_cs_reply_draft(
  p_token_hash text,p_id uuid,p_claim_token uuid,p_status text,
  p_result jsonb default null,p_error text default null
)
returns text language plpgsql security definer set search_path='' as $$
declare v_job record; v_action jsonb;
begin
  if sellerpilot_private.worker_token_has_scope(p_token_hash,'ai',true) is distinct from true then
    raise exception 'CS worker authentication required' using errcode='42501';
  end if;
  select draft.ticket_id into v_job
    from sellerpilot_private.cs_reply_draft_jobs draft where draft.id=p_id;
  if not found then return 'lease_lost'; end if;
  v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
    v_job.ticket_id,null
  );
  select draft.* into v_job
    from sellerpilot_private.cs_reply_draft_jobs draft where draft.id=p_id for update;
  if not found
     or v_job.claim_token is distinct from p_claim_token
     or v_job.worker_token_hash is distinct from p_token_hash then
    return 'lease_lost';
  end if;
  if v_action is null
     or (v_action->>'ticketChannel'='lazada' and v_action->>'state'<>'normal') then
    update sellerpilot_private.cs_reply_draft_jobs
       set status='failed',result_payload=null,
           error_message='LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE',
           lease_expires_at=null,worker_token_hash=null,claim_token=null,
           updated_at=clock_timestamp(),completed_at=clock_timestamp()
     where id=v_job.id and status in ('queued','running','succeeded');
    return 'stale';
  end if;
  return public.sellerpilot_09103500_complete_cs_reply_draft_unsafe(
    p_token_hash,p_id,p_claim_token,p_status,p_result,p_error
  );
end $$;
revoke all on function public.sellerpilot_09103500_complete_cs_reply_draft_unsafe(text,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_complete_cs_reply_draft(text,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_complete_cs_reply_draft(text,uuid,uuid,text,jsonb,text)
  to service_role;

alter function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  rename to sellerpilot_09100000_create_support_reply_job_unsafe;
create function public.sellerpilot_create_support_reply_job(
  p_id uuid,p_ticket_id uuid,p_expected_inbound_key text,
  p_target_locale text,p_tone text default 'polite'
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_action jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
    p_ticket_id,null
  );
  if v_action is null then raise exception 'support ticket not found'; end if;
  if v_action->>'ticketChannel'='lazada' and v_action->>'state'<>'normal' then
    raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode='55000';
  end if;
  return public.sellerpilot_09100000_create_support_reply_job_unsafe(
    p_id,p_ticket_id,p_expected_inbound_key,p_target_locale,p_tone
  );
end $$;
revoke all on function public.sellerpilot_09100000_create_support_reply_job_unsafe(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
  to authenticated;

-- The old queue wrapper takes the global gateway lock after its 009 ticket
-- lock. Take that global lock first here, then the V3 lineage locks, avoiding
-- the global->ticket versus ticket->global cycle while retaining old behavior.
alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  rename to sellerpilot_09100000_enqueue_reply_unsafe;
create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  p_ticket_id uuid,p_channel text,p_reply_text text,p_request_payload jsonb
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_action jsonb;
begin
  if p_channel='lazada' then
    perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
    v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
      p_ticket_id,null
    );
    if v_action is null or v_action->>'ticketChannel'<>'lazada' then
      raise exception 'inquiry reply ticket not found';
    end if;
    if v_action->>'state'<>'normal' then
      raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode='55000';
    end if;
  end if;
  return public.sellerpilot_09100000_enqueue_reply_unsafe(
    p_ticket_id,p_channel,p_reply_text,p_request_payload
  );
end $$;
revoke all on function public.sellerpilot_09100000_enqueue_reply_unsafe(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
  to service_role;

-- Called only after the gateway-wide advisory lock is held. It first reads the
-- job identity without a row lock, delegates credential/seller/ticket locking
-- to the exact V3 helper, and only then locks/revalidates the job. Revision-side
-- cancellation also takes job before ticket through the existing ledger
-- trigger, so it deliberately does not pre-lock a ticket in that trigger.
create function sellerpilot_private.lazada_im_lock_reply_job_action_v1(p_job_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_job record; v_action jsonb; v_ticket_id uuid;
begin
  select job.channel,job.operation,job.credential_id,job.seller_account_key,
         job.request_payload,job.status,job.provider_mutation_started_at
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id;
  if not found or v_job.channel<>'lazada' or v_job.operation<>'inquiries.reply' then
    return jsonb_build_object('applies',false);
  end if;
  if coalesce(v_job.request_payload->>'sellerpilotTicketId','')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('applies',true,'state','context_stale');
  end if;
  v_ticket_id:=(v_job.request_payload->>'sellerpilotTicketId')::uuid;
  v_action:=sellerpilot_private.lazada_im_lock_current_ticket_action_v1(
    v_ticket_id,null
  );
  select job.channel,job.operation,job.credential_id,job.seller_account_key,
         job.request_payload,job.status,job.provider_mutation_started_at
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id
   for update;
  if not found or v_action is null
     or v_job.channel<>'lazada' or v_job.operation<>'inquiries.reply'
     or v_job.credential_id::text is distinct from v_action->>'credentialId'
     or v_job.seller_account_key is distinct from v_action->>'sellerAccountKey'
     or v_job.request_payload->>'sellerpilotTicketId' is distinct from v_action->>'ticketId'
     or v_job.request_payload->>'sellerpilotInboundKey' is distinct from v_action->>'latestInboundKey' then
    return jsonb_build_object(
      'applies',true,'state','context_stale',
      'providerMutationStarted',v_job.provider_mutation_started_at is not null
    );
  end if;
  return v_action || jsonb_build_object(
    'applies',true,
    'providerMutationStarted',v_job.provider_mutation_started_at is not null
  );
end $$;
revoke all on function sellerpilot_private.lazada_im_lock_reply_job_action_v1(uuid)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.reject_lazada_reply_job_action_v1(
  p_job_id uuid,p_provider_mutation_started boolean
)
returns void language plpgsql security definer set search_path='' as $$
begin
  update sellerpilot_private.channel_gateway_jobs job
     set status=case when p_provider_mutation_started
            then 'reconciliation_required' else 'failed' end,
         error_message=case when p_provider_mutation_started
            then 'Lazada latest message changed after provider mutation started; provider outcome requires reconciliation.'
            else 'Lazada latest message is not actionable before provider mutation.' end,
         completed_at=clock_timestamp(),lease_expires_at=null,
         worker_token_id=null,claim_token=null,updated_at=clock_timestamp()
   where job.id=p_job_id and job.status='running';
end $$;
revoke all on function sellerpilot_private.reject_lazada_reply_job_action_v1(uuid,boolean)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_09100000_begin_gateway_mutation_unsafe;
create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_action jsonb; v_is_lazada_reply boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select coalesce(job.channel='lazada' and job.operation='inquiries.reply',false)
    into v_is_lazada_reply
    from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  if not coalesce(v_is_lazada_reply,false) then
    return public.sellerpilot_09100000_begin_gateway_mutation_unsafe(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if not exists (
    select 1 from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.ai_cli_worker_tokens token on token.id=job.worker_token_id
    where job.id=p_job_id and job.claim_token=p_claim_token
      and job.status='running' and job.lease_expires_at>clock_timestamp()
      and token.token_hash=p_token_hash
      and token.scope in ('gateway','legacy_combined')
      and token.status='active' and token.expires_at>clock_timestamp()
  ) then
    return public.sellerpilot_09100000_begin_gateway_mutation_unsafe(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  v_action:=sellerpilot_private.lazada_im_lock_reply_job_action_v1(p_job_id);
  if v_action->>'state'<>'normal' then
    perform sellerpilot_private.reject_lazada_reply_job_action_v1(
      p_job_id,coalesce((v_action->>'providerMutationStarted')::boolean,false)
    );
    return false;
  end if;
  return public.sellerpilot_09100000_begin_gateway_mutation_unsafe(
    p_token_hash,p_job_id,p_claim_token
  );
end $$;
revoke all on function public.sellerpilot_09100000_begin_gateway_mutation_unsafe(text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  rename to sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe;
create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_action jsonb; v_is_lazada_reply boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select coalesce(job.channel='lazada' and job.operation='inquiries.reply',false)
    into v_is_lazada_reply
    from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  if not coalesce(v_is_lazada_reply,false) then
    return public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash,p_job_id,p_claim_token,true
  ) then
    return public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  v_action:=sellerpilot_private.lazada_im_lock_reply_job_action_v1(p_job_id);
  if v_action->>'state'<>'normal' then
    perform sellerpilot_private.reject_lazada_reply_job_action_v1(
      p_job_id,coalesce((v_action->>'providerMutationStarted')::boolean,false)
    );
    return false;
  end if;
  return public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(
    p_token_hash,p_job_id,p_claim_token
  );
end $$;
revoke all on function public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

notify pgrst,'reload schema';
commit;
