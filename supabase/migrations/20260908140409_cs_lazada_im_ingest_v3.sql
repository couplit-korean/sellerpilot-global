-- DRAFT ONLY. Integration owner assigns the migration number after exact
-- production preimage review. This file is executable in the isolated PGlite
-- regression; it is not applied to the local or production migration tree.
begin;

do $migration$
begin
  if to_regprocedure('public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)') is null
     or to_regprocedure('public.sellerpilot_service_ingest_lazada_gateway_v2(text,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)') is null
     or to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.cs_credential_capability_bindings') is null
     or to_regclass('sellerpilot_private.channel_gateway_jobs') is null
     or to_regclass('sellerpilot_private.support_tickets') is null
     or to_regclass('sellerpilot_private.support_inbound_messages') is null then
    raise exception 'LAZADA_IM_INGEST_V3_PREREQUISITE_REQUIRED';
  end if;
  if to_regprocedure('public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)') is not null
     or to_regprocedure('public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_service_ingest_lazada_gateway_v3(text,uuid,uuid,jsonb)') is not null
     or to_regclass('sellerpilot_private.lazada_im_message_revisions') is not null then
    raise exception 'LAZADA_IM_INGEST_V3_ALREADY_EXISTS';
  end if;
  if has_function_privilege('anon','public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)','EXECUTE') then
    raise exception 'LAZADA_IM_INGEST_V2_ACL_REVIEW_REQUIRED';
  end if;
end
$migration$;

-- Body-free projection revision evidence. Exact provider envelopes stay in the
-- existing raw inbox; this ledger records only bounded digests and safe parser
-- metadata so replay/recall/conflict decisions are durable.
create table sellerpilot_private.lazada_im_message_revisions (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  external_ticket_id text not null check (external_ticket_id like 'lazada-im:%' and length(external_ticket_id) between 11 and 240),
  remote_message_id text not null check (length(remote_message_id) between 1 and 240),
  revision_kind text not null check (revision_kind in ('message','seller','system','recalled','conflict')),
  sender_role text not null check (sender_role in ('customer','seller','system')),
  native_content_fingerprint text not null check (native_content_fingerprint ~ '^[a-f0-9]{64}$'),
  body_fingerprint text not null check (body_fingerprint ~ '^[a-f0-9]{64}$'),
  attachment_fingerprint text not null check (attachment_fingerprint ~ '^[a-f0-9]{64}$'),
  app_fingerprint text not null check (app_fingerprint ~ '^[a-f0-9]{64}$'),
  token_fingerprint text not null check (token_fingerprint ~ '^[a-f0-9]{64}$'),
  country text not null check (country ~ '^[A-Z0-9_-]{1,40}$'),
  provider_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_context) = 'object' and octet_length(provider_context::text) <= 64000),
  first_observed_at timestamptz not null default clock_timestamp(),
  unique (
    owner_id, seller_account_key, external_ticket_id, remote_message_id,
    revision_kind, native_content_fingerprint
  )
);
create index lazada_im_message_revisions_identity_idx
  on sellerpilot_private.lazada_im_message_revisions(
    owner_id, seller_account_key, external_ticket_id, remote_message_id, first_observed_at, id
  );
alter table sellerpilot_private.lazada_im_message_revisions enable row level security;
revoke all on sellerpilot_private.lazada_im_message_revisions from public,anon,authenticated,service_role;

create function public.sellerpilot_service_lazada_im_ingest_ready_v3(p_credential_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.id = p_credential_id
       and credential.channel = 'lazada'
       and credential.status in ('active','grace')
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
       and (credential.expires_at is null or credential.expires_at > clock_timestamp())
  ) and (
    select count(*) > 0
       and count(distinct binding.app_fingerprint) = 1
       and count(distinct binding.token_fingerprint) = 1
       and count(distinct binding.country) = 1
      from sellerpilot_private.cs_credential_capability_bindings binding
     where binding.credential_id = p_credential_id
       and binding.channel = 'lazada'
       and binding.operation = 'inquiries.list'
       and binding.status = 'active'
       and (binding.expires_at is null or binding.expires_at > clock_timestamp())
  )
$$;
revoke all on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid) to service_role;

create function public.sellerpilot_service_ingest_lazada_inquiries_v3(
  p_credential_id uuid,
  p_inquiries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_owner uuid;
  v_account text;
  v_app text;
  v_token text;
  v_country text;
  v_row jsonb;
  v_delegated jsonb := '[]'::jsonb;
  v_context jsonb;
  v_revision_context jsonb;
  v_external text;
  v_remote text;
  v_body text;
  v_role text;
  v_event text;
  v_native text;
  v_body_fingerprint text;
  v_attachment_fingerprint text;
  v_inbound_key text;
  v_received_at timestamptz;
  v_ticket_id uuid;
  v_message_id uuid;
  v_message_ticket_id uuid;
  v_message_inbound_key text;
  v_conflict boolean;
  v_v2 jsonb := jsonb_build_object(
    'contract','lazada_ingest_v2','status','complete','normalCount',0,
    'quarantinedCount',0,'pendingCount',0,'conflictCount',0,'expiredUnstoredCount',0
  );
  v_system_count integer := 0;
  v_seller_count integer := 0;
  v_recall_count integer := 0;
  v_conflict_count integer := 0;
  v_pending_count integer := 0;
begin
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'LAZADA_INGEST_BATCH_INVALID';
  end if;
  if public.sellerpilot_service_lazada_im_ingest_ready_v3(p_credential_id) is distinct from true then
    raise exception 'LAZADA_IM_INGEST_V3_BINDING_REQUIRED' using errcode='42501';
  end if;
  select credential.created_by, credential.seller_account_key
    into v_owner, v_account
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'lazada'
     and credential.status in ('active','grace')
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
   for update;
  if v_owner is null then raise exception 'active channel credential required'; end if;
  select min(binding.app_fingerprint), min(binding.token_fingerprint), min(binding.country)
    into v_app, v_token, v_country
    from sellerpilot_private.cs_credential_capability_bindings binding
   where binding.credential_id = p_credential_id
     and binding.channel = 'lazada'
     and binding.operation = 'inquiries.list'
     and binding.status = 'active'
     and (binding.expires_at is null or binding.expires_at > clock_timestamp());

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lazada-im-v3:' || v_owner::text || ':' || v_account, 0)
  );

  for v_row in select value from jsonb_array_elements(p_inquiries) loop
    v_context := case when jsonb_typeof(v_row->'providerContext') = 'object'
      then v_row->'providerContext' else '{}'::jsonb end;
    v_external := trim(coalesce(v_row->>'externalTicketId',''));
    v_remote := trim(coalesce(v_row->>'remoteMessageId',''));
    v_body := v_row->>'message';
    v_role := coalesce(nullif(v_row->>'senderRole',''),'customer');
    v_event := coalesce(nullif(v_context->>'eventKind',''),'message');
    v_native := coalesce(v_context->>'nativeContentFingerprint','');
    if jsonb_typeof(v_row) is distinct from 'object'
       or v_external not like 'lazada-im:%'
       or length(v_external) not between 11 and 240
       or length(v_remote) not between 1 and 240
       or v_role not in ('customer','seller','system')
       or jsonb_typeof(v_row->'message') is distinct from 'string'
       or length(v_body) not between 1 and 20000
       or octet_length(v_body) > 60000
       or v_native !~ '^[a-f0-9]{64}$'
       or octet_length(v_context::text) > 64000
       or (v_context ? 'eventKind' and (
         jsonb_typeof(v_context->'eventKind') <> 'string'
         or length(v_context->>'eventKind') not between 1 and 80
       ))
       or (v_context ? 'templateKind' and (
         jsonb_typeof(v_context->'templateKind') <> 'string'
         or length(v_context->>'templateKind') not between 1 and 80
       ))
       or (v_context ? 'roleBasis' and (
         jsonb_typeof(v_context->'roleBasis') <> 'string'
         or length(v_context->>'roleBasis') not between 1 and 80
       ))
       or (v_context ? 'recallTargetMessageId' and (
         jsonb_typeof(v_context->'recallTargetMessageId') <> 'string'
         or length(v_context->>'recallTargetMessageId') not between 1 and 240
       ))
       or (v_context ? 'historyOnly'
         and jsonb_typeof(v_context->'historyOnly') not in ('boolean','null'))
       or (v_context ? 'messageStatus'
         and jsonb_typeof(v_context->'messageStatus') not in ('number','null'))
       or (jsonb_typeof(v_context->'messageStatus') = 'number'
         and v_context->>'messageStatus' !~ '^-?[0-9]{1,10}$')
       or (v_context ? 'messageType'
         and jsonb_typeof(v_context->'messageType') not in ('number','null'))
       or (jsonb_typeof(v_context->'messageType') = 'number'
         and v_context->>'messageType' !~ '^-?[0-9]{1,10}$')
       or (v_context ? 'templateId'
         and jsonb_typeof(v_context->'templateId') not in ('number','null'))
       or (jsonb_typeof(v_context->'templateId') = 'number'
         and v_context->>'templateId' !~ '^-?[0-9]{1,10}$') then
      v_pending_count := v_pending_count + 1;
      continue;
    end if;
    -- Raw and current message projection retain the bounded native payload.
    -- The revision ledger is a strict scalar allowlist: unknown or nested
    -- fields can never carry bodies, attachment URLs, or provider envelopes.
    v_revision_context := jsonb_strip_nulls(jsonb_build_object(
      'eventKind',v_event,
      'messageStatus',v_context->'messageStatus',
      'messageType',v_context->'messageType',
      'templateId',v_context->'templateId',
      'templateKind',v_context->'templateKind',
      'roleBasis',v_context->'roleBasis',
      'recallTargetMessageId',v_context->'recallTargetMessageId',
      'historyOnly',v_context->'historyOnly'
    ));
    if exists (
      select 1 from sellerpilot_private.support_tickets ticket
       where ticket.owner_id = v_owner
         and ticket.channel_key = 'lazada'
         and ticket.external_ticket_id = v_external
         and (ticket.source_credential_id is distinct from p_credential_id
           or ticket.seller_account_key is distinct from v_account)
    ) then
      raise exception 'LAZADA_IM_TICKET_LINEAGE_MISMATCH';
    end if;

    v_body_fingerprint := encode(extensions.digest(v_body,'sha256'),'hex');
    v_attachment_fingerprint := encode(extensions.digest(
      coalesce(v_context->'nativeMedia','null'::jsonb)::text,'sha256'
    ),'hex');
    v_inbound_key := left(nullif(trim(v_row->>'inboundKey'),''),500);
    if v_inbound_key is null then
      v_inbound_key := 'lazada:' || encode(extensions.digest(
        concat_ws(chr(31),'v2','lazada',v_external,v_remote),'sha256'
      ),'hex');
    end if;
    begin
      v_received_at := nullif(v_row->>'receivedAt','')::timestamptz;
    exception when others then
      v_received_at := null;
    end;

    v_conflict := coalesce(v_row->>'orderingStatus'='conflict',false) or exists (
      select 1
        from sellerpilot_private.lazada_im_message_revisions revision
       where revision.owner_id = v_owner
         and revision.seller_account_key = v_account
         and revision.external_ticket_id = v_external
         and revision.remote_message_id = v_remote
         and revision.revision_kind <> 'conflict'
         and revision.native_content_fingerprint <> v_native
    );
    if v_conflict then
      insert into sellerpilot_private.lazada_im_message_revisions(
        owner_id,credential_id,seller_account_key,external_ticket_id,remote_message_id,
        revision_kind,sender_role,native_content_fingerprint,body_fingerprint,
        attachment_fingerprint,app_fingerprint,token_fingerprint,country,provider_context
      ) values (
        v_owner,p_credential_id,v_account,v_external,v_remote,'conflict',v_role,v_native,
        v_body_fingerprint,v_attachment_fingerprint,v_app,v_token,v_country,
        v_revision_context || jsonb_build_object('projectionConflict',true)
      ) on conflict do nothing;
      v_conflict_count := v_conflict_count + 1;
      if v_role in ('customer','seller') then
        v_delegated := v_delegated || jsonb_build_array(
          jsonb_set(jsonb_set(jsonb_set(v_row,'{orderingStatus}','"conflict"'::jsonb,true),
            '{receivedAt}','""'::jsonb,true),'{status}','"waiting"'::jsonb,true)
        );
      else
        v_pending_count := v_pending_count + 1;
      end if;
      continue;
    end if;

    insert into sellerpilot_private.lazada_im_message_revisions(
      owner_id,credential_id,seller_account_key,external_ticket_id,remote_message_id,
      revision_kind,sender_role,native_content_fingerprint,body_fingerprint,
      attachment_fingerprint,app_fingerprint,token_fingerprint,country,provider_context
    ) values (
      v_owner,p_credential_id,v_account,v_external,v_remote,
      case when v_event='recalled' then 'recalled'
           when v_role='seller' then 'seller'
           when v_role='system' then 'system' else 'message' end,
      v_role,v_native,v_body_fingerprint,v_attachment_fingerprint,v_app,v_token,v_country,v_revision_context
    ) on conflict do nothing;

    if v_event = 'recalled' then
      select message.id, message.ticket_id, message.inbound_key
        into v_message_id, v_message_ticket_id, v_message_inbound_key
        from sellerpilot_private.support_inbound_messages message
        join sellerpilot_private.support_tickets ticket on ticket.id=message.ticket_id
       where message.owner_id=v_owner and message.channel_key='lazada'
         and message.remote_message_id=v_remote
         and ticket.external_ticket_id=v_external
         and ticket.source_credential_id=p_credential_id
         and ticket.seller_account_key=v_account
         and message.provider_context->>'nativeContentFingerprint'=v_native
       order by message.received_at,message.id
       limit 1
       for update of message,ticket;
      if v_message_id is null then
        v_pending_count := v_pending_count + 1;
      else
        update sellerpilot_private.support_inbound_messages message
           set provider_context = message.provider_context || v_context
             || jsonb_build_object('eventKind','recalled','recalled',true),
               updated_at = clock_timestamp()
         where message.id=v_message_id;
        update sellerpilot_private.support_tickets ticket
           set provider_context = ticket.provider_context || jsonb_build_object(
                 'currentMessageRecalled',true,'recalledRemoteMessageId',v_remote
               ),
               updated_at=clock_timestamp()
         where ticket.id=v_message_ticket_id
           and ticket.latest_inbound_key=v_message_inbound_key;
        v_recall_count := v_recall_count + 1;
      end if;
      continue;
    end if;

    if v_role = 'system' then
      if v_received_at is null or v_row->>'orderingStatus' in ('unverified','conflict') then
        v_pending_count := v_pending_count + 1;
        continue;
      end if;
      insert into sellerpilot_private.support_tickets(
        owner_id,external_ticket_id,channel_key,customer_name,subject,message,
        status,priority,received_at,resolved_at,demo,updated_at,
        source_credential_id,seller_account_key,provider_status,
        provider_status_updated_at,latest_inbound_key,provider_context,
        channel_account_id,ticket_kind
      ) values (
        v_owner,v_external,'lazada','Lazada 시스템',
        left(coalesce(nullif(trim(v_row->>'subject'),''),'Lazada 시스템 이벤트'),500),
        v_body,'resolved',greatest(1,least(5,coalesce((v_row->>'priority')::integer,3))),
        v_received_at,v_received_at,false,clock_timestamp(),p_credential_id,v_account,
        'closed',v_received_at,null,'{}'::jsonb,p_credential_id,'conversation'
      ) on conflict (owner_id,channel_key,external_ticket_id) do nothing;
      select ticket.id into v_ticket_id
        from sellerpilot_private.support_tickets ticket
       where ticket.owner_id=v_owner and ticket.channel_key='lazada'
         and ticket.external_ticket_id=v_external
         and ticket.source_credential_id=p_credential_id
         and ticket.seller_account_key=v_account
         and not ticket.demo
       for update;
      if v_ticket_id is null then raise exception 'LAZADA_IM_SYSTEM_TICKET_REQUIRED'; end if;
      insert into sellerpilot_private.support_inbound_messages(
        ticket_id,owner_id,channel_key,inbound_key,remote_message_id,
        sender_role,body,provider_context,received_at,updated_at
      ) values (
        v_ticket_id,v_owner,'lazada',v_inbound_key,v_remote,'system',v_body,
        v_context,v_received_at,clock_timestamp()
      ) on conflict (owner_id,channel_key,inbound_key) do update set
        provider_context=sellerpilot_private.support_inbound_messages.provider_context||excluded.provider_context,
        updated_at=clock_timestamp();
      v_system_count := v_system_count + 1;
      continue;
    end if;

    v_delegated := v_delegated || jsonb_build_array(v_row);
    if v_role='seller' then v_seller_count:=v_seller_count+1; end if;
  end loop;

  if jsonb_array_length(v_delegated)>0 then
    v_v2:=public.sellerpilot_service_ingest_lazada_inquiries_v2(p_credential_id,v_delegated);
    for v_row in select value from jsonb_array_elements(v_delegated) loop
      if coalesce(v_row->>'orderingStatus','')='conflict' then continue; end if;
      v_context:=case when jsonb_typeof(v_row->'providerContext')='object' then v_row->'providerContext' else '{}'::jsonb end;
      update sellerpilot_private.support_inbound_messages message
         set provider_context=message.provider_context||v_context,updated_at=clock_timestamp()
        from sellerpilot_private.support_tickets ticket
       where ticket.id=message.ticket_id
         and ticket.owner_id=v_owner and ticket.channel_key='lazada'
         and ticket.source_credential_id=p_credential_id and ticket.seller_account_key=v_account
         and ticket.external_ticket_id=trim(v_row->>'externalTicketId')
         and message.remote_message_id=trim(v_row->>'remoteMessageId');
    end loop;
  end if;

  return jsonb_build_object(
    'contract','lazada_ingest_v3',
    'status',case when v_pending_count+v_conflict_count>0 or v_v2->>'status'='partial'
      then 'partial' else 'complete' end,
    'normalCount',coalesce((v_v2->>'normalCount')::integer,0),
    'sellerCount',v_seller_count,
    'systemCount',v_system_count,
    'recallCount',v_recall_count,
    'quarantinedCount',coalesce((v_v2->>'quarantinedCount')::integer,0),
    'pendingCount',v_pending_count+coalesce((v_v2->>'pendingCount')::integer,0),
    'conflictCount',greatest(v_conflict_count,coalesce((v_v2->>'conflictCount')::integer,0)),
    'expiredUnstoredCount',coalesce((v_v2->>'expiredUnstoredCount')::integer,0),
    'retryAfterSeconds',300
  );
end
$$;
revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb) to service_role;

create function public.sellerpilot_service_ingest_lazada_gateway_v3(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_inquiries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_result jsonb;
  v_pending jsonb;
  v_fingerprint text;
  v_pending_valid boolean;
  v_pending_expired boolean;
  v_pending_expires_at timestamptz;
begin
  v_context:=public.sellerpilot_service_gateway_completion_context(
    p_token_hash,p_job_id,p_claim_token
  );
  if v_context is null or v_context->>'channel'<>'lazada'
     or v_context->>'operation'<>'inquiries.list'
     or v_context->>'status' not in ('running','completed_replay') then
    raise exception 'LAZADA_INGEST_CLAIM_REQUIRED';
  end if;
  if v_context->>'status'='completed_replay' then
    -- completion_context proves the same job/claim/worker receipt, but the
    -- receipt does not bind a normalized payload digest. Ignore all replay
    -- input and report that distinction instead of claiming it was ingested.
    return jsonb_build_object(
      'contract','lazada_ingest_v3','status','complete','alreadyApplied',true,
      'replayPayloadIgnored',true,'replayBasis','gateway_completion_receipt'
    );
  end if;
  select job.response_payload->'lazadaIngestionPending' into v_pending
    from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id for update;
  if not found then raise exception 'LAZADA_INGEST_JOB_REQUIRED'; end if;
  select encode(extensions.digest(
    coalesce(jsonb_agg(element order by element::text),'[]'::jsonb)::text,'sha256'
  ),'hex') into v_fingerprint from jsonb_array_elements(p_inquiries) element;
  if v_pending is not null then
    v_pending_valid := jsonb_typeof(v_pending)='object'
      and coalesce(v_pending->>'fingerprint','') ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(v_pending->'expiresAt')='string';
    if v_pending_valid then
      begin
        v_pending_expires_at := (v_pending->>'expiresAt')::timestamptz;
      exception when others then
        v_pending_valid := false;
      end;
    end if;
    v_pending_expired := coalesce(
      v_pending_valid and v_pending_expires_at<=clock_timestamp(),false
    );
    if not coalesce(v_pending_valid,false)
       or v_pending->>'fingerprint'<>v_fingerprint
       or v_pending_expired then
      return jsonb_build_object(
        'contract','lazada_ingest_v3','status','partial',
        'originalBatchRequired',true,'ingestSkipped',true,
        'pendingReceiptMalformed',not coalesce(v_pending_valid,false),
        'pendingReceiptExpired',v_pending_expired,'retryAfterSeconds',300
      );
    end if;
  end if;
  v_result:=public.sellerpilot_service_ingest_lazada_inquiries_v3(
    (v_context->>'credential_id')::uuid,p_inquiries
  );
  if v_result->>'status'='partial' then
    update sellerpilot_private.channel_gateway_jobs job
       set response_payload=jsonb_build_object('lazadaIngestionPending',coalesce(v_pending,
             jsonb_build_object('fingerprint',v_fingerprint,'firstObservedAt',clock_timestamp(),
               'expiresAt',clock_timestamp()+interval '7 days'))),updated_at=clock_timestamp()
     where job.id=p_job_id;
  elsif v_pending is not null then
    update sellerpilot_private.channel_gateway_jobs job
       set response_payload=job.response_payload-'lazadaIngestionPending',updated_at=clock_timestamp()
     where job.id=p_job_id;
  end if;
  return v_result;
end
$$;
revoke all on function public.sellerpilot_service_ingest_lazada_gateway_v3(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_lazada_gateway_v3(text,uuid,uuid,jsonb) to service_role;

commit;
