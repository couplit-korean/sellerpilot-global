begin;

do $guard$
declare
  readiness pg_catalog.pg_proc%rowtype;
  ingest pg_catalog.pg_proc%rowtype;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'LAZADA_IM_COUNTRY_BINDING_POSTGRES_SESSION_REQUIRED';
  end if;

  select procedure.* into readiness
    from pg_catalog.pg_proc procedure
   where procedure.oid = to_regprocedure(
     'public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)'
   );
  select procedure.* into ingest
    from pg_catalog.pg_proc procedure
   where procedure.oid = to_regprocedure(
     'public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)'
   );

  if readiness.oid is null
     or ingest.oid is null
     or readiness.proowner <> 'postgres'::regrole
     or ingest.proowner <> 'postgres'::regrole
     or readiness.prosecdef is distinct from true
     or ingest.prosecdef is distinct from true
     or readiness.proconfig is distinct from array['search_path=""']::text[]
     or ingest.proconfig is distinct from array['search_path=""']::text[]
     or readiness.provolatile <> 's'
     or ingest.provolatile <> 'v'
     or pg_catalog.md5(readiness.prosrc) <> '57d4ef25c6059d0e83c88c29c64eb96c'
     or pg_catalog.md5(ingest.prosrc) <> '43fd79d79a8b8d1085d38567b21df995'
     or has_function_privilege(
       'anon','public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)','EXECUTE'
     )
     or has_function_privilege(
       'authenticated','public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)','EXECUTE'
     )
     or not has_function_privilege(
       'service_role','public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)','EXECUTE'
     )
     or has_function_privilege(
       'anon','public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)','EXECUTE'
     )
     or has_function_privilege(
       'authenticated','public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)','EXECUTE'
     )
     or not has_function_privilege(
       'service_role','public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)','EXECUTE'
     ) then
    raise exception 'LAZADA_IM_COUNTRY_BINDING_PREIMAGE_CHANGED';
  end if;
end
$guard$;

create or replace function public.sellerpilot_service_lazada_im_ingest_ready_v3(
  p_credential_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with binding_stats as (
    select
      count(*) as active_count,
      count(*) filter (
        where binding.expires_at is null or binding.expires_at > clock_timestamp()
      ) as valid_count,
      count(distinct binding.app_fingerprint) filter (
        where binding.expires_at is null or binding.expires_at > clock_timestamp()
      ) as valid_app_count,
      count(distinct binding.token_fingerprint) filter (
        where binding.expires_at is null or binding.expires_at > clock_timestamp()
      ) as valid_token_count,
      count(distinct upper(binding.country)) filter (
        where binding.expires_at is null or binding.expires_at > clock_timestamp()
      ) as valid_country_count,
      count(*) filter (
        where (binding.expires_at is null or binding.expires_at > clock_timestamp())
          and upper(binding.country) in ('MY','PH','SG','TH','VN')
      ) as exact_country_count
    from sellerpilot_private.cs_credential_capability_bindings binding
    where binding.credential_id = p_credential_id
      and binding.channel = 'lazada'
      and binding.operation = 'inquiries.list'
      and binding.status = 'active'
  )
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
  ) and exists (
    select 1
      from binding_stats stats
     where stats.valid_app_count = 1
       and stats.valid_token_count = 1
       and (
         (
           stats.active_count = 1
           and stats.valid_count = 1
           and stats.valid_country_count = 1
         )
         or (
           stats.active_count = 5
           and stats.valid_count = 5
           and stats.valid_country_count = 5
           and stats.exact_country_count = 5
         )
       )
  )
$$;

alter function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)
  owner to postgres;
revoke all on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)
  to service_role;

-- The existing V3 projection remains unchanged except for capability selection.
-- A legacy one-country credential may omit providerContext.country. A five-country
-- credential must provide it on every row, and the row is admitted only when the
-- exact active, unexpired country/app/token capability exists.
create or replace function public.sellerpilot_service_ingest_lazada_inquiries_v3(
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
  v_single_country text;
  v_binding_count integer;
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
  select count(*), min(binding.app_fingerprint), min(binding.token_fingerprint),
         case when count(*) = 1 then upper(min(binding.country)) end
    into v_binding_count, v_app, v_token, v_single_country
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
    if v_context ? 'country' and (
      jsonb_typeof(v_context->'country') is distinct from 'string'
      or upper(trim(v_context->>'country')) !~ '^[A-Z0-9_-]{1,40}$'
    ) then
      v_pending_count := v_pending_count + 1;
      continue;
    end if;
    v_country := nullif(upper(trim(v_context->>'country')),'');
    if v_binding_count = 1 and v_country is null then
      v_country := v_single_country;
    end if;
    if v_country is null or not exists (
      select 1
        from sellerpilot_private.cs_credential_capability_bindings binding
       where binding.credential_id = p_credential_id
         and binding.channel = 'lazada'
         and binding.operation = 'inquiries.list'
         and upper(binding.country) = v_country
         and binding.app_fingerprint = v_app
         and binding.token_fingerprint = v_token
         and binding.status = 'active'
         and (binding.expires_at is null or binding.expires_at > clock_timestamp())
    ) then
      v_pending_count := v_pending_count + 1;
      continue;
    end if;
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

alter function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)
  owner to postgres;
revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)
  to service_role;

comment on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid) is
  'Allows one active legacy country or the exact active MY/PH/SG/TH/VN set, always with one app and token fingerprint.';
comment on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb) is
  'Binds every Lazada IM revision to its active country capability. Missing country falls back only for a one-country legacy credential.';

notify pgrst,'reload schema';
commit;
