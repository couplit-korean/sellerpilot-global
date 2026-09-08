begin;

do $$
declare v_ingest regprocedure := to_regprocedure(
  'public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'
);
begin
  if v_ingest is null or not exists (
    select 1 from pg_proc p
     where p.oid = v_ingest
       and encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') =
         'd50af6b5f00163d03cd166ca25c8f5e62105a6ceefc0f38c85b723bc93bfec4d'
       and p.prosecdef
       and p.proowner = 'postgres'::regrole
       and p.proconfig = array['search_path=""']::text[]
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception 'SHOPEE_CS_INGEST_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure(
    'public.sellerpilot_07200000_ingest_before_shopee(uuid,text,jsonb)'
  ) is not null then
    raise exception 'SHOPEE_CS_MIGRATION_ALREADY_WRAPPED';
  end if;
end $$;

create or replace function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_operation
    when 'diagnostic.test' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.list' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.suggest' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.attributes' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'categories.validate' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'orders.list' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'orders.get' then p_channel in ('qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'inquiries.list' then p_channel in ('qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'inquiries.reply' then p_channel in ('qoo10','shopee','lazada','coupang','smartstore','ebay')
    when 'shops.get' then p_channel in ('shopee','lazada')
    when 'competitor.search' then p_channel = 'elevenst'
    when 'listing.lineage.verify' then p_channel in ('qoo10','shopee','lazada','ebay')
    when 'listing.create' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore','ebay')
    when 'listing.update' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','smartstore')
    when 'listing.stop' then p_channel in ('qoo10','shopee','lazada','coupang','elevenst','temu','smartstore')
    when 'inventory.update' then p_channel in ('qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'shipment.acknowledge' then p_channel in ('qoo10','shopee','lazada','coupang','smartstore')
    when 'shipment.confirm' then p_channel in ('qoo10','shopee','lazada','coupang','temu','smartstore','ebay')
    when 'oauth.exchange' then p_channel in ('shopee','lazada','ebay')
    else false
  end;
$$;

revoke all on function sellerpilot_private.serverless_gateway_job_allowed(text, text)
  from public, anon, authenticated, service_role;

alter function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) rename to sellerpilot_07200000_ingest_before_shopee;

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
  v_sanitized jsonb := '[]'::jsonb;
  v_context jsonb;
  v_existing_context jsonb;
  v_external_id text;
  v_shop_id text;
  v_comment_id text;
  v_item_id text;
  v_count integer;
begin
  if p_channel <> 'shopee' then
    return public.sellerpilot_07200000_ingest_before_shopee(
      p_credential_id, p_channel, p_inquiries
    );
  end if;
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'shopee'
     and credential.status in ('active', 'grace');
  if not found then raise exception 'active channel credential required'; end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> 'provider_certified_v1' then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) <> 'object' then
      raise exception 'SHOPEE_COMMENT_CONTEXT_INVALID';
    end if;
    v_external_id := coalesce(v_inquiry->>'externalTicketId', '');
    v_shop_id := coalesce(v_inquiry#>>'{replyContext,shopId}', '');
    v_comment_id := coalesce(v_inquiry#>>'{replyContext,commentId}', '');
    v_item_id := coalesce(v_inquiry#>>'{replyContext,itemId}', '');
    if v_shop_id !~ '^[1-9][0-9]{0,31}$'
       or v_comment_id !~ '^[1-9][0-9]{0,18}$'
       or v_item_id !~ '^[1-9][0-9]{0,18}$'
       or (case
            when v_comment_id ~ '^[1-9][0-9]{0,18}$'
              then v_comment_id::numeric > 9007199254740991
            else false
          end)
       or v_external_id <> 'shopee:' || v_shop_id || ':' || v_comment_id then
      raise exception 'SHOPEE_COMMENT_CONTEXT_INVALID';
    end if;
    v_context := jsonb_build_object(
      'shopId', v_shop_id,
      'commentId', v_comment_id,
      'itemId', v_item_id
    );
    select ticket.reply_context
      into v_existing_context
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id = v_credential.created_by
       and ticket.channel_key = 'shopee'
       and ticket.external_ticket_id = v_external_id
       and ticket.seller_account_key = v_credential.seller_account_key
       and not ticket.demo
     for update;
    if found and v_existing_context <> '{}'::jsonb
       and v_existing_context is distinct from v_context then
      raise exception 'INQUIRY_REPLY_CONTEXT_MISMATCH';
    end if;
    v_sanitized := v_sanitized || jsonb_build_array(
      jsonb_set(v_inquiry, '{replyContext}', v_context, true)
    );
  end loop;

  v_count := public.sellerpilot_07200000_ingest_before_shopee(
    p_credential_id, p_channel, v_sanitized
  );
  for v_inquiry in select value from jsonb_array_elements(v_sanitized) loop
    v_external_id := v_inquiry->>'externalTicketId';
    v_context := v_inquiry->'replyContext';
    update sellerpilot_private.support_tickets ticket
       set reply_context = v_context,
           updated_at = now()
     where ticket.owner_id = v_credential.created_by
       and ticket.channel_key = 'shopee'
       and ticket.external_ticket_id = v_external_id
       and ticket.source_credential_id = p_credential_id
       and ticket.seller_account_key = v_credential.seller_account_key
       and not ticket.demo;
    if not found then raise exception 'INQUIRY_REPLY_CONTEXT_PERSIST_FAILED'; end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.sellerpilot_07200000_ingest_before_shopee(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) to service_role;

alter function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) rename to sellerpilot_07200000_enqueue_reply_before_shopee;

create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
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
  v_shop_id text;
  v_comment_id text;
  v_item_id text;
  v_expected_external_ticket_id text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_channel <> 'shopee' then
    return public.sellerpilot_07200000_enqueue_reply_before_shopee(
      p_ticket_id, p_channel, p_reply_text, p_request_payload
    );
  end if;

  if p_ticket_id is null
     or v_reply is null
     or length(v_reply) > 500
     or regexp_replace(v_reply, E'[\t\n\r]', '', 'g') ~ '[[:cntrl:]]'
     or p_request_payload is null
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'arguments') <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid inquiry reply gateway job';
  end if;

  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id = p_ticket_id
     and ticket.channel_key = 'shopee'
     and not ticket.demo
   for update;
  if not found then raise exception 'inquiry reply ticket not found'; end if;
  if v_ticket.provider_status <> 'waiting' then
    raise exception 'PROVIDER_INQUIRY_NOT_WAITING';
  end if;
  if nullif(p_request_payload->>'sellerpilotExpectedInboundKey', '')
       is distinct from v_ticket.latest_inbound_key then
    raise exception 'INQUIRY_CONTEXT_STALE';
  end if;
  if v_ticket.latest_inbound_key is null
     or not exists (
       select 1
         from sellerpilot_private.support_inbound_messages message
        where message.ticket_id = p_ticket_id
          and message.channel_key = 'shopee'
          and message.inbound_key = v_ticket.latest_inbound_key
          and message.sender_role = 'customer'
     ) then
    raise exception 'INQUIRY_LATEST_MESSAGE_UNBOUND';
  end if;
  if v_ticket.source_credential_id is null
     or v_ticket.seller_account_key is null then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  select credential.id, credential.channel, credential.environment,
         credential.created_by, credential.seller_account_key,
         credential.seller_account_key_source,
         credential.seller_account_verified_at
    into v_source_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_ticket.source_credential_id;
  if not found
     or v_source_credential.channel <> 'shopee'
     or v_source_credential.created_by <> v_ticket.owner_id
     or v_source_credential.environment not in ('sandbox', 'production')
     or v_source_credential.seller_account_key_source <> 'provider_certified_v1'
     or v_source_credential.seller_account_verified_at is null
     or v_source_credential.seller_account_key is distinct from v_ticket.seller_account_key then
    raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND';
  end if;

  v_payload_reply := nullif(trim(p_request_payload#>>'{arguments,reply}'), '');
  v_shop_id := p_request_payload#>>'{arguments,shopId}';
  v_comment_id := p_request_payload#>>'{arguments,commentId}';
  v_item_id := p_request_payload#>>'{arguments,itemId}';
  v_expected_external_ticket_id := 'shopee:' || coalesce(v_shop_id, '') || ':' || coalesce(v_comment_id, '');
  if v_payload_reply is distinct from v_reply
     or coalesce(v_shop_id, '') !~ '^[1-9][0-9]{0,31}$'
     or coalesce(v_comment_id, '') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(v_item_id, '') !~ '^[1-9][0-9]{0,18}$'
     or (case
          when coalesce(v_comment_id, '') ~ '^[1-9][0-9]{0,18}$'
            then v_comment_id::numeric > 9007199254740991
          else false
        end)
     or v_ticket.external_ticket_id is distinct from v_expected_external_ticket_id
     or v_shop_id is distinct from v_ticket.reply_context->>'shopId'
     or v_comment_id is distinct from v_ticket.reply_context->>'commentId'
     or v_item_id is distinct from v_ticket.reply_context->>'itemId' then
    raise exception 'inquiry reply Shopee comment context mismatch';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.operation = 'inquiries.reply'
       and job.channel = 'shopee'
       and job.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
       and job.status in ('queued', 'running', 'reconciliation_required')
       and job.request_payload->>'sellerpilotInboundKey'
             is distinct from v_ticket.latest_inbound_key
  ) then
    raise exception 'INQUIRY_REPLY_RECONCILIATION_REQUIRED';
  end if;

  select attempt.id, attempt.status, attempt.reply_fingerprint
    into v_legacy
    from sellerpilot_private.support_reply_attempts attempt
   where attempt.ticket_id = p_ticket_id
     and attempt.status in ('preparing', 'sending', 'succeeded', 'reconciliation_required')
   order by case
       when attempt.status = 'reconciliation_required' then 0
       when attempt.status = 'sending' then 1
       when attempt.status = 'preparing' then 2
       else 3
     end,
     attempt.created_at desc
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

  v_reply_fingerprint := encode(extensions.digest(v_reply, 'sha256'), 'hex');
  select job.id, job.status,
         job.request_payload->>'sellerpilotReplyFingerprint' as reply_fingerprint
    into v_existing
    from sellerpilot_private.channel_gateway_jobs job
   where job.operation = 'inquiries.reply'
     and job.channel = 'shopee'
     and job.request_payload->>'sellerpilotTicketId' = p_ticket_id::text
     and (
       job.status in ('queued', 'running', 'reconciliation_required')
       or (job.status = 'succeeded' and job.response_payload @> '{"ok":true}'::jsonb)
     )
   order by case
       when job.status = 'reconciliation_required' then 0
       when job.status in ('queued', 'running') then 1
       else 2
     end,
     job.created_at desc,
     job.id desc
   limit 1;
  if found then
    if v_existing.reply_fingerprint is distinct from v_reply_fingerprint then
      raise exception 'INQUIRY_REPLY_CONFLICT';
    end if;
    update sellerpilot_private.support_tickets ticket
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
     where ticket.id = p_ticket_id;
    return v_existing.id;
  end if;

  if v_ticket.status = 'resolved' then
    raise exception 'INQUIRY_REPLY_ALREADY_RESOLVED';
  end if;

  select credential.id, credential.environment, credential.created_by
    into v_credential_id, v_environment, v_created_by
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'shopee'
     and credential.environment = v_source_credential.environment
     and credential.created_by = v_ticket.owner_id
     and credential.seller_account_key = v_ticket.seller_account_key
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > now())
   order by (credential.id = v_ticket.source_credential_id) desc,
            credential.seller_account_verified_at desc,
            credential.version desc,
            credential.created_at desc,
            credential.id
   for update
   limit 1;
  if not found then raise exception 'INQUIRY_REPLY_LINEAGE_UNBOUND'; end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment,
    request_payload, created_by, seller_account_key
  ) values (
    v_id, v_credential_id, null, 'shopee', 'inquiries.reply', v_environment,
    jsonb_build_object(
      'arguments', jsonb_build_object(
        'shopId', v_shop_id,
        'commentId', v_comment_id,
        'itemId', v_item_id,
        'reply', v_reply
      ),
      'sellerpilotTicketId', p_ticket_id,
      'sellerpilotInboundKey', v_ticket.latest_inbound_key,
      'sellerpilotReplyFingerprint', v_reply_fingerprint
    ),
    v_created_by, v_ticket.seller_account_key
  );

  update sellerpilot_private.support_tickets ticket
     set reply_delivery_status = 'preparing',
         reply_delivery_error = null,
         reply_operation_attempt_id = null,
         reply_gateway_job_id = v_id,
         updated_at = now()
   where ticket.id = p_ticket_id
     and ticket.seller_account_key = v_ticket.seller_account_key;
  if not found then raise exception 'inquiry reply ticket ledger mismatch'; end if;

  return v_id;
end;
$$;

revoke all on function public.sellerpilot_07200000_enqueue_reply_before_shopee(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) is
  'Queues exact-bound marketplace replies, including Shopee reply_comment bound to credential, shop, item, comment and latest inbound generation.';

do $shopee_remote_reply_resolution_fence$
declare
  v_definition text;
  v_old constant text := $old$v_ticket.channel_key in ('qoo10', 'lazada', 'coupang', 'smartstore', 'ebay')$old$;
  v_new constant text := $new$v_ticket.channel_key in ('qoo10', 'shopee', 'lazada', 'coupang', 'smartstore', 'ebay')$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_update_ticket(uuid,text,text,text)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition) > 0 and position(v_old in v_definition) = 0 then
    null;
  elsif position(v_old in v_definition) > 0 and position(v_new in v_definition) = 0 then
    execute replace(v_definition, v_old, v_new);
  else
    raise exception 'Shopee remote reply resolution fence preimage drifted';
  end if;
end;
$shopee_remote_reply_resolution_fence$;

commit;
