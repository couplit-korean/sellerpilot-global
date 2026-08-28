-- Bind every eBay ASQ inquiry and reply to its exact Trading API site. eBay's
-- AddMemberMessageRTQ supports both Sandbox and Production, so replies are
-- admitted only for provider-certified, provider-verified seller accounts in
-- the ticket's exact environment. The admission fence preserves
-- eBay's documented 75 replies / 60 seconds / seller ceiling even after a
-- worker outage leaves an old queue behind.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists provider_mutation_started_at timestamptz;

do $migration$
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.channel = 'ebay'
       and job.operation = 'inquiries.reply'
       and job.status in ('queued', 'running')
     group by job.environment, job.seller_account_key
    having count(*) > 75
  ) then
    raise exception 'eBay ASQ active reply backlog exceeds provider rate ceiling'
      using errcode = '55000';
  end if;
end;
$migration$;

create index if not exists channel_gateway_jobs_ebay_asq_rate_window_idx
  on sellerpilot_private.channel_gateway_jobs (
    environment,
    seller_account_key,
    (coalesce(provider_mutation_started_at, started_at)) desc
  )
  where channel = 'ebay'
    and operation = 'inquiries.reply';

-- Trading MessageID is documented as unique only for a single eBay user. The
-- support ticket table predates seller lineage and still has a unique key on
-- (owner, channel, external_ticket_id), so derive a stable opaque identity
-- from both the certified seller account and provider MessageID.
create or replace function sellerpilot_private.ebay_asq_ticket_external_id(
  p_seller_account_key text,
  p_parent_message_id text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'ebay:' || encode(
    extensions.digest(p_seller_account_key || ':' || p_parent_message_id, 'sha256'),
    'hex'
  )
$$;

update sellerpilot_private.support_tickets ticket
   set external_ticket_id = sellerpilot_private.ebay_asq_ticket_external_id(
         ticket.seller_account_key,
         ticket.reply_context->>'parentMessageId'
       ),
       updated_at = now()
 where ticket.channel_key = 'ebay'
   and ticket.seller_account_key ~ '^[a-f0-9]{64}$'
   and coalesce(ticket.reply_context->>'parentMessageId', '') <> '';

create or replace function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started boolean;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_job_id is null
     or p_claim_token is null
     or not sellerpilot_private.worker_token_has_scope(
       p_token_hash,
       'gateway',
       true
     ) then
    return false;
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at = coalesce(
           job.provider_mutation_started_at,
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
  returning true into v_started;

  return coalesce(v_started, false);
end;
$$;

create or replace function public.sellerpilot_service_ingest_inquiries(
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
  v_sanitized jsonb := '[]'::jsonb;
  v_external_id text;
  v_external_id_raw text;
  v_storage_external_id text;
  v_item_id text;
  v_item_id_raw text;
  v_parent_message_id text;
  v_parent_message_id_raw text;
  v_recipient_id text;
  v_recipient_id_raw text;
  v_marketplace_id text;
  v_marketplace_id_raw text;
  v_reply_context jsonb;
  v_existing_reply_context jsonb;
  v_count integer;
begin
  if p_channel <> 'ebay' then
    return public.sellerpilot_28141000_ingest_inquiries_unsafe(
      p_credential_id,
      p_channel,
      p_inquiries
    );
  end if;

  if jsonb_typeof(p_inquiries) <> 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  select c.id, c.created_by, c.seller_account_key,
         c.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = 'ebay'
     and c.status in ('active', 'grace')
   for update;
  if not found then
    raise exception 'active channel credential required';
  end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> 'provider_certified_v1' then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) <> 'object' then
      v_sanitized := v_sanitized || jsonb_build_array(v_inquiry);
      continue;
    end if;

    v_external_id_raw := coalesce(v_inquiry->>'externalTicketId', '');
    v_external_id := left(trim(v_external_id_raw), 240);
    v_item_id_raw := coalesce(v_inquiry#>>'{replyContext,itemId}', '');
    v_item_id := trim(v_item_id_raw);
    v_parent_message_id_raw := coalesce(
      v_inquiry#>>'{replyContext,parentMessageId}',
      ''
    );
    v_parent_message_id := trim(v_parent_message_id_raw);
    v_recipient_id_raw := coalesce(
      v_inquiry#>>'{replyContext,recipientId}',
      ''
    );
    v_recipient_id := trim(v_recipient_id_raw);
    v_marketplace_id_raw := coalesce(
      v_inquiry#>>'{replyContext,marketplaceId}',
      ''
    );
    v_marketplace_id := upper(trim(v_marketplace_id_raw));

    v_reply_context := case
      when jsonb_typeof(v_inquiry->'replyContext') = 'object'
        and v_external_id_raw = v_external_id
        and v_item_id_raw = v_item_id
        and v_parent_message_id_raw = v_parent_message_id
        and v_recipient_id_raw = v_recipient_id
        and v_marketplace_id_raw = v_marketplace_id
        and v_item_id ~ '^[1-9][0-9]{0,18}$'
        and length(v_parent_message_id) between 1 and 230
        and v_parent_message_id ~ '^[^[:cntrl:]]+$'
        and length(v_recipient_id) between 1 and 240
        and v_recipient_id ~ '^[^[:cntrl:]]+$'
        and v_marketplace_id in (
          'EBAY_US', 'EBAY_CA', 'EBAY_CA_FR', 'EBAY_GB', 'EBAY_AU', 'EBAY_AT',
          'EBAY_BE_FR', 'EBAY_BE_NL',
          'EBAY_FR', 'EBAY_DE', 'EBAY_IT', 'EBAY_NL', 'EBAY_ES',
          'EBAY_CH', 'EBAY_HK', 'EBAY_IE', 'EBAY_IN', 'EBAY_MY', 'EBAY_PH',
          'EBAY_PL', 'EBAY_SG'
        )
        and v_external_id = 'ebay:' || v_parent_message_id
      then jsonb_build_object(
        'itemId', v_item_id,
        'parentMessageId', v_parent_message_id,
        'recipientId', v_recipient_id,
        'marketplaceId', v_marketplace_id
      )
      else '{}'::jsonb
    end;

    -- A partially routed eBay inquiry cannot safely become replyable. Keep it
    -- out of the support ledger until the provider returns exact item,
    -- recipient, seller-account and listing-site lineage.
    if v_reply_context = '{}'::jsonb then
      continue;
    end if;
    v_storage_external_id := sellerpilot_private.ebay_asq_ticket_external_id(
      v_credential.seller_account_key,
      v_parent_message_id
    );

    select t.reply_context
      into v_existing_reply_context
      from sellerpilot_private.support_tickets t
     where t.owner_id = v_credential.created_by
       and t.channel_key = 'ebay'
       and t.external_ticket_id = v_storage_external_id
     for update;

    if found and v_existing_reply_context <> '{}'::jsonb then
      if v_reply_context = '{}'::jsonb then
        v_reply_context := v_existing_reply_context;
      elsif v_existing_reply_context ? 'marketplaceId' then
        if v_reply_context is distinct from v_existing_reply_context then
          raise exception 'INQUIRY_REPLY_CONTEXT_MISMATCH';
        end if;
      elsif (v_reply_context - 'marketplaceId') is distinct from v_existing_reply_context then
        -- A pre-release three-field eBay route can be upgraded only when all
        -- previously bound fields exactly match this site-specific read.
        raise exception 'INQUIRY_REPLY_CONTEXT_MISMATCH';
      end if;
    end if;

    v_sanitized := v_sanitized || jsonb_build_array(
      jsonb_set(
        jsonb_set(v_inquiry, '{replyContext}', v_reply_context, true),
        '{externalTicketId}',
        to_jsonb(v_storage_external_id),
        true
      )
    );
  end loop;

  v_count := public.sellerpilot_28141000_ingest_inquiries_unsafe(
    p_credential_id,
    p_channel,
    v_sanitized
  );

  for v_inquiry in select value from jsonb_array_elements(v_sanitized) loop
    if jsonb_typeof(v_inquiry) <> 'object' then continue; end if;
    v_external_id := left(trim(coalesce(v_inquiry->>'externalTicketId', '')), 240);
    v_reply_context := coalesce(v_inquiry->'replyContext', '{}'::jsonb);
    if jsonb_typeof(v_reply_context) = 'object'
       and v_reply_context <> '{}'::jsonb
       and coalesce(v_inquiry->>'status', 'waiting') in ('waiting', 'resolved') then
      update sellerpilot_private.support_tickets t
         set reply_context = v_reply_context,
             updated_at = now()
       where t.owner_id = v_credential.created_by
         and t.channel_key = 'ebay'
         and t.external_ticket_id = v_external_id
         and t.source_credential_id = p_credential_id
         and t.seller_account_key = v_credential.seller_account_key
         and not t.demo;
      if not found then
        raise exception 'INQUIRY_REPLY_CONTEXT_PERSIST_FAILED';
      end if;
    end if;
  end loop;

  return v_count;
end;
$$;

drop function public.sellerpilot_get_ticket_reply_dispatch_context(uuid);

create function public.sellerpilot_get_ticket_reply_dispatch_context(p_id uuid)
returns table(
  id uuid,
  external_ticket_id text,
  channel_key text,
  status text,
  reply_context jsonb,
  environment text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         t.external_ticket_id,
         t.channel_key,
         t.status,
         t.reply_context,
         c.environment,
         c.seller_account_key_source,
         c.seller_account_verified_at
    from sellerpilot_private.support_tickets t
    left join sellerpilot_private.channel_credentials c
      on c.id = t.source_credential_id
     and c.channel = t.channel_key
     and c.created_by = t.owner_id
   where auth.uid() is not null
     and public.sellerpilot_is_admin()
     and t.id = p_id
     and not t.demo
   limit 1
$$;

create or replace function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  p_ticket_id uuid,
  p_channel text,
  p_reply_text text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_source_credential record;
  v_credential_id uuid;
  v_environment text;
  v_created_by uuid;
  v_existing record;
  v_legacy record;
  v_id uuid := gen_random_uuid();
  v_reply text := nullif(trim(p_reply_text), '');
  v_payload_reply text;
  v_reply_fingerprint text;
  v_item_id text;
  v_parent_message_id text;
  v_recipient_id text;
  v_marketplace_id text;
  v_rate_window_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_channel <> 'ebay' then
    return public.sellerpilot_11820_enqueue_reply_unsafe(
      p_ticket_id,
      p_channel,
      p_reply_text,
      p_request_payload
    );
  end if;

  if v_reply is null
     or length(v_reply) > 2000
     or v_reply ~ '</?[[:alpha:]][^>]*>'
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  select t.* into v_ticket
    from sellerpilot_private.support_tickets t
   where t.id = p_ticket_id
     and not t.demo
   for update;
  if not found or v_ticket.channel_key <> 'ebay' then
    raise exception 'inquiry reply ticket not found';
  end if;
  if v_ticket.source_credential_id is null
     or v_ticket.seller_account_key is null then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  select c.id, c.channel, c.environment, c.created_by, c.seller_account_key,
         c.seller_account_key_source, c.seller_account_verified_at
    into v_source_credential
    from sellerpilot_private.channel_credentials c
   where c.id = v_ticket.source_credential_id;
  if not found
     or v_source_credential.channel <> 'ebay'
     or v_source_credential.created_by <> v_ticket.owner_id
     or v_source_credential.environment not in ('sandbox', 'production')
     or v_source_credential.seller_account_key_source <> 'provider_certified_v1'
     or v_source_credential.seller_account_verified_at is null
     or v_source_credential.seller_account_key is distinct from v_ticket.seller_account_key then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;
  v_payload_reply := nullif(trim(p_request_payload#>>'{arguments,reply}'), '');
  if v_payload_reply is distinct from v_reply then
    raise exception 'inquiry reply payload mismatch';
  end if;

  v_item_id := p_request_payload#>>'{arguments,itemId}';
  v_parent_message_id := p_request_payload#>>'{arguments,parentMessageId}';
  v_recipient_id := p_request_payload#>>'{arguments,recipientId}';
  v_marketplace_id := p_request_payload#>>'{arguments,marketplaceId}';

  if coalesce(v_item_id, '') !~ '^[1-9][0-9]{0,18}$'
     or length(coalesce(v_parent_message_id, '')) not between 1 and 230
     or coalesce(v_parent_message_id, '') !~ '^[^[:cntrl:]]+$'
     or length(coalesce(v_recipient_id, '')) not between 1 and 240
     or coalesce(v_recipient_id, '') !~ '^[^[:cntrl:]]+$'
     or coalesce(v_marketplace_id, '') not in (
       'EBAY_US', 'EBAY_CA', 'EBAY_CA_FR', 'EBAY_GB', 'EBAY_AU', 'EBAY_AT',
       'EBAY_BE_FR', 'EBAY_BE_NL',
       'EBAY_FR', 'EBAY_DE', 'EBAY_IT', 'EBAY_NL', 'EBAY_ES',
       'EBAY_CH', 'EBAY_HK', 'EBAY_IE', 'EBAY_IN', 'EBAY_MY', 'EBAY_PH',
       'EBAY_PL', 'EBAY_SG'
     )
     or v_ticket.external_ticket_id is distinct from
          sellerpilot_private.ebay_asq_ticket_external_id(
            v_ticket.seller_account_key,
            v_parent_message_id
          )
     or v_item_id is distinct from v_ticket.reply_context->>'itemId'
     or v_parent_message_id is distinct from v_ticket.reply_context->>'parentMessageId'
     or v_recipient_id is distinct from v_ticket.reply_context->>'recipientId'
     or v_marketplace_id is distinct from v_ticket.reply_context->>'marketplaceId' then
    raise exception 'inquiry reply eBay ASQ context mismatch';
  end if;

  select a.id, a.status, a.reply_fingerprint
    into v_legacy
    from sellerpilot_private.support_reply_attempts a
   where a.ticket_id = p_ticket_id
     and a.status in (
       'preparing', 'sending', 'succeeded', 'reconciliation_required'
     )
   order by case
       when a.status = 'reconciliation_required' then 0
       when a.status = 'sending' then 1
       when a.status = 'preparing' then 2
       else 3
     end,
     a.created_at desc
   limit 1;
  if found then
    if v_legacy.status in ('sending', 'reconciliation_required') then
      raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED';
    end if;
    if v_legacy.status = 'preparing' then
      raise exception 'INQUIRY_REPLY_LEGACY_IN_PROGRESS';
    end if;
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  v_reply_fingerprint := encode(
    extensions.digest(v_reply, 'sha256'),
    'hex'
  );

  select j.id, j.status,
         j.request_payload->>'sellerpilotReplyFingerprint' as reply_fingerprint
    into v_existing
    from sellerpilot_private.channel_gateway_jobs j
   where j.operation = 'inquiries.reply'
     and j.channel = 'ebay'
     and j.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
     and (
       j.status in ('queued', 'running', 'reconciliation_required')
       or (j.status = 'succeeded' and j.response_payload @> '{"ok":true}'::jsonb)
     )
   order by case
       when j.status = 'reconciliation_required' then 0
       when j.status in ('queued', 'running') then 1
       else 2
     end,
     j.created_at desc,
     j.id desc
   limit 1;
  if found then
    if v_existing.reply_fingerprint is distinct from v_reply_fingerprint then
      raise exception 'INQUIRY_REPLY_CONFLICT';
    end if;
    update sellerpilot_private.support_tickets t
       set reply_gateway_job_id = v_existing.id,
           reply_delivery_status = case v_existing.status
             when 'queued' then 'preparing'
             when 'running' then 'sending'
             when 'reconciliation_required' then 'reconciliation_required'
             else 'succeeded'
           end,
           reply_delivery_error = case
             when v_existing.status = 'reconciliation_required'
               then '판매채널 답변 접수 여부를 수동 확인해야 합니다.'
             else null
           end,
           reply_operation_attempt_id = null,
           updated_at = now()
     where t.id = p_ticket_id;
    return v_existing.id;
  end if;

  if v_ticket.status = 'resolved' then
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  select c.id, c.environment, c.created_by
    into v_credential_id, v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.channel = 'ebay'
     and c.environment = v_source_credential.environment
     and c.created_by = v_ticket.owner_id
     and c.seller_account_key = v_ticket.seller_account_key
     and c.seller_account_key_source = 'provider_certified_v1'
     and c.seller_account_verified_at is not null
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   order by (c.id = v_ticket.source_credential_id) desc,
            c.seller_account_verified_at desc,
            c.version desc,
            c.created_at desc,
            c.id
   for update
   limit 1;
  if not found then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  -- Error 518 (or an HTTP 429 transport response) means eBay has activated
  -- the documented 100-second block. Preserve that cooldown across workers
  -- and process restarts instead of immediately retrying from another lease.
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs recent_job
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(recent_job.response_payload->'steps') = 'array'
            then recent_job.response_payload->'steps'
          else '[]'::jsonb
        end
      ) provider_step
     where recent_job.channel = 'ebay'
       and recent_job.operation = 'inquiries.reply'
       and recent_job.environment = v_environment
       and recent_job.seller_account_key = v_ticket.seller_account_key
       and recent_job.completed_at >= clock_timestamp() - interval '100 seconds'
       and (
         provider_step->>'status' = '429'
         or exists (
           select 1
             from jsonb_array_elements(
               case
                 when jsonb_typeof(provider_step#>'{data,errors}') = 'array'
                   then provider_step#>'{data,errors}'
                 else '[]'::jsonb
               end
             ) provider_error
            where provider_error->>'errorCode' = '518'
         )
       )
  ) then
    raise exception 'EBAY_ASQ_PROVIDER_COOLDOWN_100_SECONDS'
      using errcode = '57014';
  end if;

  select count(*)::integer
    into v_rate_window_count
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = 'ebay'
     and job.operation = 'inquiries.reply'
     and job.environment = v_environment
     and job.seller_account_key = v_ticket.seller_account_key
     and (
       job.status in ('queued', 'running')
       or coalesce(job.provider_mutation_started_at, job.started_at)
            >= clock_timestamp() - interval '60 seconds'
     );
  if v_rate_window_count >= 75 then
    raise exception 'EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS'
      using errcode = '57014';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id,
    credential_id,
    attempt_id,
    channel,
    operation,
    environment,
    request_payload,
    created_by
  ) values (
    v_id,
    v_credential_id,
    null,
    'ebay',
    'inquiries.reply',
    v_environment,
    p_request_payload || jsonb_build_object(
      'sellerpilotTicketId', p_ticket_id,
      'sellerpilotReplyFingerprint', v_reply_fingerprint
    ),
    v_created_by
  );

  update sellerpilot_private.support_tickets t
     set reply_delivery_status = 'preparing',
         reply_delivery_error = null,
         reply_operation_attempt_id = null,
         reply_gateway_job_id = v_id,
         updated_at = now()
   where t.id = p_ticket_id
     and t.seller_account_key = v_ticket.seller_account_key;
  if not found then
    raise exception 'inquiry reply ticket ledger mismatch';
  end if;

  return v_id;
end;
$$;

revoke all on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) to service_role;

revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

revoke all on function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) to service_role;

revoke all on function public.sellerpilot_get_ticket_reply_dispatch_context(uuid)
  from public, anon;
grant execute on function public.sellerpilot_get_ticket_reply_dispatch_context(uuid)
  to authenticated;

revoke all on function sellerpilot_private.ebay_asq_ticket_external_id(text, text)
  from public, anon, authenticated, service_role;

commit;
