-- Integration draft only. The integrator assigns the migration number.
-- This migration stores body-free provider read evidence, connects normalized
-- 11st Alimi rows to the existing private CS ledger, and exposes one bounded
-- authenticated-admin read model. It does not enable any provider mutation.

begin;

do $$
declare
  v_ingest regprocedure := to_regprocedure(
    'public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'
  );
begin
  if v_ingest is null or not exists (
    select 1
      from pg_proc procedure
     where procedure.oid = v_ingest
       and procedure.prosecdef
       and procedure.proowner = 'postgres'::regrole
       and procedure.proconfig = array['search_path=""']::text[]
       and position('ELEVENST_PRODUCT_QNA_CONTEXT_INVALID' in procedure.prosrc) > 0
       and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
       and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'ELEVENST_ALIMI_INGEST_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure(
    'public.sellerpilot_004_ingest_before_elevenst_alimi(uuid,text,jsonb)'
  ) is not null
     or to_regprocedure(
       'public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)'
     ) is not null
     or to_regprocedure(
       'public.sellerpilot_read_elevenst_cs_read_state_v1(text)'
     ) is not null then
    raise exception 'ELEVENST_READ_STATE_MIGRATION_ALREADY_APPLIED';
  end if;
end $$;

create table sellerpilot_private.elevenst_cs_read_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (length(seller_account_key) between 1 and 240),
  seller_id text not null check (seller_id = 'couplit'),
  seller_name text not null check (seller_name = '커플릿'),
  surface text not null check (surface in ('product_qna', 'urgent_alimi')),
  scope_start date not null,
  scope_end date not null,
  status_filter text,
  checked_at timestamptz not null,
  http_status integer check (http_status between 100 and 599),
  accepted boolean not null,
  result_code text check (result_code is null or length(result_code) between 1 and 40),
  provider_rows integer not null check (provider_rows between 0 and 5001),
  parser_marker text,
  parse_incomplete boolean not null default false,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  check (scope_end >= scope_start),
  check (
    (surface = 'product_qna' and scope_end - scope_start <= 6
      and status_filter is not null and status_filter in ('00', '01', '02'))
    or
    (surface = 'urgent_alimi' and scope_end - scope_start <= 29
      and (status_filter is null or status_filter in ('01', '02', '03', '04', '05', '06')))
  ),
  check (
    (accepted and http_status = 200 and not parse_incomplete)
    or not accepted
  )
);

create unique index elevenst_cs_read_observation_dedupe_idx
  on sellerpilot_private.elevenst_cs_read_observations (
    credential_id, surface, scope_start, scope_end,
    coalesce(status_filter, ''), evidence_sha256
  );
create index elevenst_cs_read_observation_latest_idx
  on sellerpilot_private.elevenst_cs_read_observations (
    seller_id, surface, checked_at desc, id desc
  );

create table sellerpilot_private.elevenst_alimi_state_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null
    references sellerpilot_private.support_tickets(id) on delete cascade,
  owner_id uuid not null,
  source_credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null,
  read_observation_id uuid
    references sellerpilot_private.elevenst_cs_read_observations(id) on delete set null,
  emer_ntce_seq text not null check (emer_ntce_seq ~ '^[1-9][0-9]{0,19}$'),
  emer_ctnt_seq text not null check (emer_ctnt_seq ~ '^[1-9][0-9]{0,19}$'),
  alimi_kind text not null check (alimi_kind in ('urgent_inquiry', 'urgent_notice')),
  current_status text not null check (current_status in ('01', '02', '03', '04', '05', '06')),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, seller_account_key, emer_ntce_seq, emer_ctnt_seq, source_digest)
);
create index elevenst_alimi_state_events_ticket_idx
  on sellerpilot_private.elevenst_alimi_state_events (
    ticket_id, observed_at desc, id desc
  );

alter table sellerpilot_private.elevenst_cs_read_observations enable row level security;
alter table sellerpilot_private.elevenst_alimi_state_events enable row level security;
revoke all on sellerpilot_private.elevenst_cs_read_observations,
  sellerpilot_private.elevenst_alimi_state_events
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_004_ingest_before_elevenst_alimi;

create function public.sellerpilot_service_ingest_inquiries(
  p_credential_id uuid,
  p_channel text,
  p_inquiries jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_inquiry jsonb;
  v_context jsonb;
  v_existing sellerpilot_private.support_tickets%rowtype;
  v_ticket_id uuid;
  v_kind text;
  v_status text;
  v_emer_ntce_seq text;
  v_emer_ctnt_seq text;
  v_inbound_key text;
  v_received_at timestamptz;
  v_current_is_newer boolean;
begin
  if p_channel <> 'elevenst'
     or jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries) = 0
     or not exists (
       select 1
         from jsonb_array_elements(p_inquiries) item(value)
        where item.value#>>'{providerContext,kind}' in ('urgent_inquiry', 'urgent_notice')
     ) then
    return public.sellerpilot_004_ingest_before_elevenst_alimi(
      p_credential_id, p_channel, p_inquiries
    );
  end if;
  if jsonb_array_length(p_inquiries) > 5000
     or octet_length(p_inquiries::text) > 8000000
     or exists (
       select 1
         from jsonb_array_elements(p_inquiries) item(value)
        where item.value#>>'{providerContext,kind}' not in ('urgent_inquiry', 'urgent_notice')
     ) then
    raise exception 'ELEVENST_ALIMI_BATCH_INVALID';
  end if;

  select credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source, credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp());
  if not found
     or v_credential.seller_account_key is null
     or v_credential.seller_account_key_source not in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
     or v_credential.seller_account_verified_at is null then
    raise exception 'ELEVENST_ALIMI_ACTIVE_LINEAGE_REQUIRED';
  end if;

  for v_inquiry in
    select value from jsonb_array_elements(p_inquiries) item(value)
  loop
    v_context := v_inquiry->'providerContext';
    v_kind := coalesce(v_context->>'kind', '');
    v_status := coalesce(v_context->>'status', '');
    v_emer_ntce_seq := coalesce(v_context->>'emerNtceSeq', '');
    v_emer_ctnt_seq := coalesce(v_context->>'emerCtntSeq', '');
    v_inbound_key := coalesce(v_inquiry->>'inboundKey', '');
    begin
      v_received_at := (v_inquiry->>'receivedAt')::timestamptz;
    exception when others then
      raise exception 'ELEVENST_ALIMI_CONTEXT_INVALID';
    end;

    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or jsonb_typeof(v_context) is distinct from 'object'
       or jsonb_typeof(v_inquiry->'replyContext') is distinct from 'object'
       or v_inquiry->'replyContext' <> '{}'::jsonb
       or exists (
         select 1 from jsonb_object_keys(v_inquiry) key
          where key <> all(array[
            'externalTicketId','customerName','subject','message','status','priority',
            'receivedAt','remoteMessageId','senderRole','externalOrderReference',
            'providerContext','replyContext','inboundKey','providerStatus','ticketKind'
          ])
       )
       or exists (
         select 1 from jsonb_object_keys(v_context) key
          where key <> all(array[
            'kind','emerNtceSeq','emerCtntSeq','type','status','replyDueDate',
            'orderNo','orderProductSequence','replySupported','sourceDigest',
            'unsequencedReplies'
          ])
       )
       or v_emer_ntce_seq !~ '^[1-9][0-9]{0,19}$'
       or v_emer_ctnt_seq !~ '^[1-9][0-9]{0,19}$'
       or v_kind not in ('urgent_inquiry', 'urgent_notice')
       or v_status not in ('01', '02', '03', '04', '05', '06')
       or v_context->>'type' not in ('reply_request', 'notice')
       or (v_kind = 'urgent_inquiry' and v_context->>'type' <> 'reply_request')
       or (v_kind = 'urgent_notice' and v_context->>'type' <> 'notice')
       or v_context->'replySupported' is distinct from 'false'::jsonb
       or coalesce(v_context->>'sourceDigest', '') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(v_context->'unsequencedReplies') is distinct from 'array'
       or jsonb_array_length(v_context->'unsequencedReplies') > 20
       or exists (
         select 1
           from jsonb_array_elements(v_context->'unsequencedReplies') reply(value)
          where jsonb_typeof(reply.value) is distinct from 'object'
             or (select count(*) from jsonb_object_keys(reply.value)) <> 2
             or reply.value->>'reason' <> 'provider_timestamp_unavailable'
             or nullif(reply.value->>'body', '') is null
             or length(reply.value->>'body') > 2000
       )
       or v_inquiry->>'externalTicketId' <> 'elevenst:alimi:' || v_emer_ntce_seq
       or v_inquiry->>'remoteMessageId' <>
          'alimi:' || v_emer_ntce_seq || ':' || v_emer_ctnt_seq || ':inbound'
       or v_inbound_key !~ '^elevenst:[a-f0-9]{64}$'
       or v_inbound_key is distinct from 'elevenst:' || encode(extensions.digest(
          'v2' || chr(31) || 'elevenst' || chr(31)
          || 'elevenst:alimi:' || v_emer_ntce_seq || chr(31)
          || 'alimi:' || v_emer_ntce_seq || ':' || v_emer_ctnt_seq || ':inbound',
          'sha256'
        ),'hex')
       or v_inquiry->>'customerName' <>
          (case when v_kind = 'urgent_notice' then '11번가 시스템' else '11번가 고객' end)
       or v_inquiry->>'senderRole' <>
          (case when v_kind = 'urgent_notice' then 'system' else 'customer' end)
       or v_inquiry->>'status' <>
          (case when v_status in ('03', '05', '06') then 'resolved' else 'waiting' end)
       or v_inquiry->>'providerStatus' <>
          (case when v_status in ('03', '05', '06') then 'answered' else 'waiting' end)
       or v_inquiry->>'ticketKind' <> 'conversation'
       or v_inquiry->'priority' is distinct from '1'::jsonb
       or nullif(v_inquiry->>'subject', '') is null
       or length(v_inquiry->>'subject') > 1000
       or nullif(v_inquiry->>'message', '') is null
       or length(v_inquiry->>'message') > 20000
       or not isfinite(v_received_at)
       or v_received_at > statement_timestamp() + interval '5 minutes'
       or (coalesce(v_context->>'orderNo', '') <> ''
         and v_context->>'orderNo' !~ '^[1-9][0-9]{0,19}$')
       or (coalesce(v_context->>'orderProductSequence', '') <> ''
         and v_context->>'orderProductSequence' !~ '^[1-9][0-9]{0,19}$')
       or coalesce(v_inquiry->>'externalOrderReference', '') is distinct from
          coalesce(v_context->>'orderNo', '') then
      raise exception 'ELEVENST_ALIMI_CONTEXT_INVALID';
    end if;

    select ticket.* into v_existing
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id = v_credential.created_by
       and ticket.channel_key = 'elevenst'
       and ticket.external_ticket_id = 'elevenst:alimi:' || v_emer_ntce_seq
     for update;
    if found and
       v_existing.seller_account_key is distinct from v_credential.seller_account_key then
      raise exception 'ELEVENST_ALIMI_ACCOUNT_BOUNDARY_MISMATCH';
    end if;

    v_current_is_newer := found
      and coalesce(v_existing.provider_context->>'emerCtntSeq', '0')::numeric
        > v_emer_ctnt_seq::numeric;
    if not found then
      insert into sellerpilot_private.support_tickets (
        owner_id, external_ticket_id, channel_key, customer_name, subject, message,
        status, priority, received_at, resolved_at, demo, updated_at,
        source_credential_id, channel_account_id, seller_account_key,
        reply_context, provider_status,
        provider_status_updated_at, latest_inbound_key, provider_context,
        external_order_reference, ticket_kind
      ) values (
        v_credential.created_by, 'elevenst:alimi:' || v_emer_ntce_seq, 'elevenst',
        v_inquiry->>'customerName', v_inquiry->>'subject', v_inquiry->>'message',
        v_inquiry->>'status', 1, v_received_at,
        case when v_status in ('03','05','06') then statement_timestamp() else null end,
        false, statement_timestamp(), p_credential_id, p_credential_id,
        v_credential.seller_account_key,
        '{}'::jsonb, v_inquiry->>'providerStatus', statement_timestamp(),
        v_inbound_key, v_context, nullif(v_inquiry->>'externalOrderReference',''),
        'conversation'
      ) returning id into v_ticket_id;
    else
      v_ticket_id := v_existing.id;
      if not v_current_is_newer then
        update sellerpilot_private.support_tickets ticket set
          customer_name = v_inquiry->>'customerName',
          subject = v_inquiry->>'subject',
          message = v_inquiry->>'message',
          status = v_inquiry->>'status',
          resolved_at = case when v_status in ('03','05','06')
            then coalesce(ticket.resolved_at, statement_timestamp()) else null end,
          updated_at = statement_timestamp(),
          source_credential_id = p_credential_id,
          channel_account_id = p_credential_id,
          provider_status = v_inquiry->>'providerStatus',
          provider_status_updated_at = statement_timestamp(),
          latest_inbound_key = v_inbound_key,
          provider_context = v_context,
          external_order_reference = nullif(v_inquiry->>'externalOrderReference','')
        where ticket.id = v_ticket_id;
      end if;
    end if;

    insert into sellerpilot_private.support_inbound_messages (
      ticket_id, owner_id, channel_key, inbound_key, remote_message_id,
      sender_role, body, provider_context, received_at, updated_at
    ) values (
      v_ticket_id, v_credential.created_by, 'elevenst', v_inbound_key,
      v_inquiry->>'remoteMessageId', v_inquiry->>'senderRole',
      v_inquiry->>'message', v_context, v_received_at, statement_timestamp()
    ) on conflict (owner_id, channel_key, inbound_key) do update set
      provider_context = excluded.provider_context,
      body = excluded.body,
      updated_at = statement_timestamp()
    where sellerpilot_private.support_inbound_messages.ticket_id = excluded.ticket_id
      and sellerpilot_private.support_inbound_messages.remote_message_id = excluded.remote_message_id
      and sellerpilot_private.support_inbound_messages.sender_role = excluded.sender_role;

    insert into sellerpilot_private.elevenst_alimi_state_events (
      ticket_id, owner_id, source_credential_id, seller_account_key,
      emer_ntce_seq, emer_ctnt_seq, alimi_kind, current_status,
      source_digest, observed_at
    ) values (
      v_ticket_id, v_credential.created_by, p_credential_id,
      v_credential.seller_account_key, v_emer_ntce_seq, v_emer_ctnt_seq,
      v_kind, v_status, v_context->>'sourceDigest', statement_timestamp()
    ) on conflict do nothing;
  end loop;
  return jsonb_array_length(p_inquiries);
end;
$$;

revoke all on function public.sellerpilot_004_ingest_before_elevenst_alimi(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

create function public.sellerpilot_service_record_elevenst_cs_read_v1(
  p_credential_id uuid,
  p_observation jsonb,
  p_inquiries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_surface text := coalesce(p_observation->>'surface','');
  v_scope_start date;
  v_scope_end date;
  v_checked_at timestamptz;
  v_http_status integer;
  v_provider_rows integer;
  v_accepted boolean;
  v_parse_incomplete boolean;
  v_status_filter text := nullif(p_observation->>'statusFilter','');
  v_observation_id uuid;
  v_duplicate boolean := false;
  v_stored integer := 0;
begin
  if jsonb_typeof(p_observation) is distinct from 'object'
     or jsonb_typeof(p_inquiries) is distinct from 'array'
     or exists (
       select 1 from jsonb_object_keys(p_observation) key
        where key <> all(array[
          'surface','sellerId','sellerName','scopeStart','scopeEnd','statusFilter',
          'checkedAt','httpStatus','accepted','resultCode','providerRows',
          'parserMarker','parseIncomplete','evidenceSha256'
        ])
     ) then
    raise exception 'ELEVENST_READ_OBSERVATION_INVALID';
  end if;
  begin
    v_scope_start := to_date(p_observation->>'scopeStart','YYYYMMDD');
    v_scope_end := to_date(p_observation->>'scopeEnd','YYYYMMDD');
    v_checked_at := (p_observation->>'checkedAt')::timestamptz;
    v_http_status := nullif(p_observation->>'httpStatus','')::integer;
    v_provider_rows := (p_observation->>'providerRows')::integer;
    v_accepted := (p_observation->>'accepted')::boolean;
    v_parse_incomplete := (p_observation->>'parseIncomplete')::boolean;
  exception when others then
    raise exception 'ELEVENST_READ_OBSERVATION_INVALID';
  end;
  if p_observation->>'sellerId' <> 'couplit'
     or p_observation->>'sellerName' <> '커플릿'
     or v_surface not in ('product_qna','urgent_alimi')
     or p_observation->>'scopeStart' !~ '^[0-9]{8}$'
     or p_observation->>'scopeEnd' !~ '^[0-9]{8}$'
     or to_char(v_scope_start,'YYYYMMDD') <> p_observation->>'scopeStart'
     or to_char(v_scope_end,'YYYYMMDD') <> p_observation->>'scopeEnd'
     or v_scope_end < v_scope_start
     or (v_surface = 'product_qna' and (
       v_scope_end - v_scope_start > 6 or v_status_filter is null
       or v_status_filter not in ('00','01','02')
     ))
     or (v_surface = 'urgent_alimi' and (
       v_scope_end - v_scope_start > 29
       or (v_status_filter is not null and v_status_filter not in ('01','02','03','04','05','06'))
     ))
     or not isfinite(v_checked_at)
     or v_checked_at > statement_timestamp() + interval '5 minutes'
     or v_http_status not between 100 and 599
     or v_provider_rows not between 0 and 5001
     or coalesce(p_observation->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
     or (v_accepted and (v_http_status <> 200 or v_parse_incomplete))
     or (v_surface = 'product_qna' and jsonb_array_length(p_inquiries) <> 0)
     or (v_surface = 'urgent_alimi' and v_accepted and (
       p_observation->>'resultCode' <> '0'
       or p_observation->>'parserMarker' <> 'sellerpilot-elevenst-alimi-parser/1'
       or v_provider_rows <> jsonb_array_length(p_inquiries)
     ))
     or (v_surface = 'urgent_alimi' and not v_accepted
       and jsonb_array_length(p_inquiries) <> 0)
     or (v_parse_incomplete and (
       v_surface <> 'urgent_alimi' or v_accepted or v_provider_rows <> 5001
       or p_observation->>'parserMarker' <> 'sellerpilot-elevenst-alimi-parser/1'
     )) then
    raise exception 'ELEVENST_READ_OBSERVATION_INVALID';
  end if;

  select credential.created_by, credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'ELEVENST_READ_ACTIVE_LINEAGE_REQUIRED';
  end if;

  insert into sellerpilot_private.elevenst_cs_read_observations (
    owner_id, credential_id, seller_account_key, seller_id, seller_name,
    surface, scope_start, scope_end, status_filter, checked_at, http_status,
    accepted, result_code, provider_rows, parser_marker, parse_incomplete,
    evidence_sha256
  ) values (
    v_credential.created_by, p_credential_id, v_credential.seller_account_key,
    'couplit', '커플릿', v_surface, v_scope_start, v_scope_end,
    v_status_filter, v_checked_at, v_http_status, v_accepted,
    nullif(p_observation->>'resultCode',''), v_provider_rows,
    nullif(p_observation->>'parserMarker',''), v_parse_incomplete,
    p_observation->>'evidenceSha256'
  ) on conflict do nothing returning id into v_observation_id;
  if v_observation_id is null then
    v_duplicate := true;
    select observation.id into strict v_observation_id
      from sellerpilot_private.elevenst_cs_read_observations observation
     where observation.credential_id = p_credential_id
       and observation.surface = v_surface
       and observation.scope_start = v_scope_start
       and observation.scope_end = v_scope_end
       and coalesce(observation.status_filter,'') = coalesce(v_status_filter,'')
       and observation.evidence_sha256 = p_observation->>'evidenceSha256';
    update sellerpilot_private.elevenst_cs_read_observations observation set
      checked_at = greatest(observation.checked_at, v_checked_at)
    where observation.id = v_observation_id;
  end if;

  if v_surface = 'urgent_alimi' and v_accepted then
    select count(*)::integer into v_stored
      from jsonb_array_elements(p_inquiries) item(value)
     where exists (
       select 1
         from sellerpilot_private.support_inbound_messages message
         join sellerpilot_private.support_tickets ticket on ticket.id = message.ticket_id
        where message.owner_id = v_credential.created_by
          and message.channel_key = 'elevenst'
          and message.inbound_key = item.value->>'inboundKey'
          and ticket.source_credential_id = p_credential_id
          and ticket.seller_account_key = v_credential.seller_account_key
          and ticket.provider_context->>'kind' in ('urgent_inquiry','urgent_notice')
     );
    if v_stored <> jsonb_array_length(p_inquiries) then
      raise exception 'ELEVENST_ALIMI_LEDGER_LINK_INCOMPLETE';
    end if;
    update sellerpilot_private.elevenst_alimi_state_events event set
      read_observation_id = v_observation_id
    where event.owner_id = v_credential.created_by
      and event.source_credential_id = p_credential_id
      and event.read_observation_id is null
      and exists (
        select 1 from jsonb_array_elements(p_inquiries) item(value)
         where item.value#>>'{providerContext,emerNtceSeq}' = event.emer_ntce_seq
           and item.value#>>'{providerContext,emerCtntSeq}' = event.emer_ctnt_seq
           and item.value#>>'{providerContext,sourceDigest}' = event.source_digest
      );
  end if;
  return jsonb_build_object(
    'contract','sellerpilot-elevenst-cs-read-record/1',
    'observationId',v_observation_id,
    'duplicateObservation',v_duplicate,
    'accepted',v_accepted,
    'providerRows',v_provider_rows,
    'storedRows',v_stored
  );
end;
$$;

revoke all on function public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)
  to service_role;

create function public.sellerpilot_read_elevenst_cs_read_state_v1(
  p_seller_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_qna sellerpilot_private.elevenst_cs_read_observations%rowtype;
  v_alimi sellerpilot_private.elevenst_cs_read_observations%rowtype;
  v_qna_count integer;
  v_alimi_count integer;
  v_qna_latest timestamptz;
  v_alimi_latest timestamptz;
  v_active_count integer;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_seller_id is distinct from 'couplit' then
    raise exception 'ELEVENST_SELLER_SCOPE_INVALID' using errcode = '22023';
  end if;

  select count(*)::integer into v_active_count
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if v_active_count <> 1 then
    raise exception 'ELEVENST_ACTIVE_CREDENTIAL_NOT_UNIQUE';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and exists (
       select 1
         from sellerpilot_private.elevenst_cs_read_observations observation
        where observation.credential_id = credential.id
          and observation.seller_id = 'couplit'
     )
   order by credential.version desc, credential.created_at desc, credential.id desc
   limit 1;
  if not found then
    raise exception 'ELEVENST_ACTIVE_READ_LINEAGE_UNAVAILABLE';
  end if;

  select observation.* into v_qna
    from sellerpilot_private.elevenst_cs_read_observations observation
   where observation.credential_id = v_credential.id
     and observation.seller_account_key = v_credential.seller_account_key
     and observation.seller_id = 'couplit'
     and observation.surface = 'product_qna'
     and observation.status_filter = '00'
   order by observation.checked_at desc, observation.id desc limit 1;
  select observation.* into v_alimi
    from sellerpilot_private.elevenst_cs_read_observations observation
   where observation.credential_id = v_credential.id
     and observation.seller_account_key = v_credential.seller_account_key
     and observation.seller_id = 'couplit'
     and observation.surface = 'urgent_alimi'
     and observation.status_filter is null
   order by observation.checked_at desc, observation.id desc limit 1;
  if v_qna.id is null or v_alimi.id is null then
    raise exception 'ELEVENST_READ_STATE_INCOMPLETE';
  end if;

  select count(*)::integer, max(ticket.received_at)
    into v_qna_count, v_qna_latest
    from sellerpilot_private.support_tickets ticket
   where ticket.owner_id = v_credential.created_by
     and ticket.channel_key = 'elevenst'
     and ticket.seller_account_key = v_credential.seller_account_key
     and ticket.provider_context->>'kind' = 'product_qna'
     and not ticket.demo;
  select count(*)::integer, max(ticket.received_at)
    into v_alimi_count, v_alimi_latest
    from sellerpilot_private.support_tickets ticket
   where ticket.owner_id = v_credential.created_by
     and ticket.channel_key = 'elevenst'
     and ticket.seller_account_key = v_credential.seller_account_key
     and ticket.provider_context->>'kind' in ('urgent_inquiry','urgent_notice')
     and not ticket.demo;

  return jsonb_build_object(
    'sellerId','couplit',
    'sellerName','커플릿',
    'productQna',jsonb_build_object(
      'checkedAt',to_char(
        v_qna.checked_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'httpStatus',v_qna.http_status,
      'accepted',v_qna.accepted,
      'resultCode',v_qna.result_code,
      'providerRows',v_qna.provider_rows,
      'storedRowCount',v_qna_count,
      'latestStoredReceivedAt',case when v_qna_latest is null then null else to_char(
        v_qna_latest at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) end
    ),
    'urgentAlimi',jsonb_build_object(
      'checkedAt',to_char(
        v_alimi.checked_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'httpStatus',v_alimi.http_status,
      'accepted',v_alimi.accepted,
      'resultCode',v_alimi.result_code,
      'providerRows',v_alimi.provider_rows,
      'storedRowCount',v_alimi_count,
      'latestStoredReceivedAt',case when v_alimi_latest is null then null else to_char(
        v_alimi_latest at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) end
    )
  );
end;
$$;

revoke all on function public.sellerpilot_read_elevenst_cs_read_state_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_elevenst_cs_read_state_v1(text)
  to authenticated;

comment on function public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)
  is 'Service-only, body-free 11st read observation receipt linked after normalized Alimi ledger ingestion. No provider mutation.';
comment on function public.sellerpilot_read_elevenst_cs_read_state_v1(text)
  is 'Authenticated approved-admin read of the active couplit 11st evidence lineage. No customer text, member ID or credential secret.';

commit;
