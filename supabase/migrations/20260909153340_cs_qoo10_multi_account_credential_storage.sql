-- Current-central integration proposal. Lazada already owns account-scoped
-- active indexes, so narrow only the remaining non-Lazada index while allowing
-- one active Qoo10 credential per attested owner/account lineage.
begin;

do $$
declare
  v_index regclass := to_regclass(
    'sellerpilot_private.channel_credentials_one_active_non_lazada_elevenst_smartstore_idx'
  );
begin
  if to_regprocedure(
    'public.sellerpilot_qoo10_account_storage_ingest_before_v1(uuid,text,jsonb)'
  ) is not null then
    raise exception 'QOO10_ACCOUNT_STORAGE_MIGRATION_ALREADY_APPLIED';
  end if;
  if v_index is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_one_active_lazada_account_idx'
     ) is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_one_active_lazada_pending_owner_idx'
     ) is null
     or to_regclass(
       'sellerpilot_private.channel_credentials_elevenst_active_account_idx'
     ) is null
     or not exists (
       select 1
         from pg_index index_row
        where index_row.indexrelid = v_index
          and index_row.indisunique
          and position('status' in pg_get_expr(index_row.indpred,index_row.indrelid)) > 0
          and position('active' in pg_get_expr(index_row.indpred,index_row.indrelid)) > 0
          and position('lazada' in pg_get_expr(index_row.indpred,index_row.indrelid)) > 0
          and position('elevenst' in pg_get_expr(index_row.indpred,index_row.indrelid)) > 0
          and position('smartstore' in pg_get_expr(index_row.indpred,index_row.indrelid)) > 0
          and position('qoo10' in pg_get_expr(index_row.indpred,index_row.indrelid)) = 0
     ) then
    raise exception 'QOO10_MULTI_ACCOUNT_ACTIVE_CREDENTIAL_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'qoo10'
       and credential.status = 'active'
       and (
         credential.seller_account_key is null
         or credential.seller_account_key !~ '^[a-f0-9]{64}$'
         or credential.seller_account_key_source not in (
           'provider_certified_v1','credential_incarnation_v1'
         )
         or credential.seller_account_verified_at is null
       )
  ) then
    raise exception 'QOO10_MULTI_ACCOUNT_ACTIVE_LINEAGE_UNATTESTED';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'qoo10' and credential.status = 'active'
     group by credential.created_by,credential.environment,credential.seller_account_key
    having count(*) > 1
  ) then
    raise exception 'QOO10_MULTI_ACCOUNT_DUPLICATE_ACTIVE_LINEAGE';
  end if;
end
$$;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_qoo10_account_storage_ingest_before_v1;

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
  v_restore jsonb := '{}'::jsonb;
  v_external_id text;
  v_incoming_sequence numeric;
  v_existing_sequence numeric;
  v_account_digest text;
  v_conversation_digest text;
  v_message_digest text;
  v_count integer;
  v_snapshot jsonb;
begin
  if p_channel <> 'qoo10' then
    return public.sellerpilot_qoo10_account_storage_ingest_before_v1(
      p_credential_id,p_channel,p_inquiries
    );
  end if;
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;
  select credential.created_by,credential.environment,
         credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.status in ('active','grace')
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'active channel credential required'; end if;

  v_account_digest := encode(extensions.digest(
    'sellerpilot-qoo10-account-v1' || chr(31) || lower(v_credential.created_by::text)
      || chr(31) || v_credential.seller_account_key
      || chr(31) || v_credential.environment,
    'sha256'
  ),'hex');
  for v_inquiry in select value from jsonb_array_elements(p_inquiries) item(value)
  loop
    v_external_id := coalesce(v_inquiry->>'externalTicketId','');
    v_context := v_inquiry->'providerContext';
    if v_external_id ~ '^qoo10:conversation:[a-f0-9]{64}$' then
      v_conversation_digest := encode(extensions.digest(
        'qoo10-thread-v2' || chr(31) || v_account_digest || chr(31)
          || coalesce(v_context->>'inquiryType','') || chr(31)
          || coalesce(v_context->>'questionNo',''),
        'sha256'
      ),'hex');
      v_message_digest := encode(extensions.digest(
        'qoo10-message-v2' || chr(31) || v_conversation_digest || chr(31)
          || coalesce(v_context->>'sequenceNo',''),
        'sha256'
      ),'hex');
      if jsonb_typeof(v_context) is distinct from 'object'
         or v_context->>'accountIdentityDigest' <> v_account_digest
         or v_context->>'conversationIdentityDigest' <> v_conversation_digest
         or v_context->>'messageIdentityDigest' <> v_message_digest
         or v_external_id <> 'qoo10:conversation:' || v_conversation_digest
         or v_inquiry->>'inboundKey' <> 'qoo10:inbound:' || v_message_digest
         or v_inquiry->>'remoteMessageId' <> v_context->>'sequenceNo'
         or v_context->>'providerExternalTicketId' <>
            'qoo10:v2:' || coalesce(v_context->>'inquiryType','') || ':'
              || coalesce(v_context->>'questionNo','')
         or v_inquiry->'replyContext' <> jsonb_build_object(
              'inquiryType',v_context->>'inquiryType',
              'questionNo',v_context->>'questionNo',
              'sequenceNo',v_context->>'sequenceNo',
              'legacyExternalTicketId','qoo10:' || (v_context->>'inquiryType')
                || ':' || (v_context->>'questionNo') || ':' || (v_context->>'sequenceNo')
            )
         or not coalesce(v_context->'legacyExternalTicketIds','[]'::jsonb) @>
            jsonb_build_array('qoo10:' || (v_context->>'inquiryType') || ':'
              || (v_context->>'questionNo') || ':' || (v_context->>'sequenceNo')) then
        raise exception 'QOO10_ACCOUNT_SCOPED_INQUIRY_CONTEXT_INVALID';
      end if;
      begin
        v_incoming_sequence := (v_context->>'sequenceNo')::numeric;
      exception when others then
        raise exception 'QOO10_ACCOUNT_SCOPED_INQUIRY_CONTEXT_INVALID';
      end;
      select ticket.* into v_existing
        from sellerpilot_private.support_tickets ticket
       where ticket.owner_id = v_credential.created_by
         and ticket.channel_key = 'qoo10'
         and ticket.external_ticket_id = v_external_id
       for update;
      if found then
        begin
          v_existing_sequence := (v_existing.provider_context->>'sequenceNo')::numeric;
        exception when others then
          v_existing_sequence := null;
        end;
        if v_existing_sequence is not null
           and v_existing_sequence > v_incoming_sequence then
          v_restore := v_restore || jsonb_build_object(v_existing.id::text,to_jsonb(v_existing));
        end if;
      end if;
    elsif v_external_id ~ '^qoo10:claim-conversation:[a-f0-9]{64}$' then
      if jsonb_typeof(v_context) is distinct from 'object'
         or v_context->>'accountIdentityDigest' <> v_account_digest
         or v_context->>'ticketIdentityVersion' <> 'qoo10-claim-v1'
         or v_context->>'messageIdentityVersion' <> 'qoo10-claim-revision-v1'
         or v_inquiry->>'inboundKey' <>
            'qoo10:claim-inbound:' || coalesce(v_context->>'messageIdentityDigest','')
         or v_external_id <>
            'qoo10:claim-conversation:' || coalesce(v_context->>'conversationIdentityDigest','') then
        raise exception 'QOO10_ACCOUNT_SCOPED_CLAIM_CONTEXT_INVALID';
      end if;
    end if;
  end loop;

  v_count := public.sellerpilot_qoo10_account_storage_ingest_before_v1(
    p_credential_id,p_channel,p_inquiries
  );
  for v_inquiry in select value from jsonb_array_elements(p_inquiries) item(value)
  loop
    if coalesce(v_inquiry->>'externalTicketId','')
         ~ '^qoo10:conversation:[a-f0-9]{64}$' then
      update sellerpilot_private.support_tickets ticket set
        reply_context = v_inquiry->'replyContext'
      where ticket.owner_id = v_credential.created_by
        and ticket.channel_key = 'qoo10'
        and ticket.external_ticket_id = v_inquiry->>'externalTicketId'
        and ticket.seller_account_key = v_credential.seller_account_key
        and ticket.latest_inbound_key = v_inquiry->>'inboundKey';
    end if;
  end loop;
  for v_external_id,v_snapshot in select key,value from jsonb_each(v_restore)
  loop
    update sellerpilot_private.support_tickets ticket set
      customer_name = v_snapshot->>'customer_name',
      subject = v_snapshot->>'subject',
      message = v_snapshot->>'message',
      status = v_snapshot->>'status',
      priority = (v_snapshot->>'priority')::integer,
      received_at = (v_snapshot->>'received_at')::timestamptz,
      resolved_at = (v_snapshot->>'resolved_at')::timestamptz,
      source_credential_id = (v_snapshot->>'source_credential_id')::uuid,
      channel_account_id = (v_snapshot->>'channel_account_id')::uuid,
      seller_account_key = v_snapshot->>'seller_account_key',
      reply_context = v_snapshot->'reply_context',
      provider_context = v_snapshot->'provider_context',
      provider_status = v_snapshot->>'provider_status',
      provider_status_updated_at = (v_snapshot->>'provider_status_updated_at')::timestamptz,
      latest_inbound_key = v_snapshot->>'latest_inbound_key',
      external_order_reference = v_snapshot->>'external_order_reference',
      ticket_kind = v_snapshot->>'ticket_kind'
    where ticket.id = v_external_id::uuid;
  end loop;
  return v_count;
end
$$;

revoke all on function public.sellerpilot_qoo10_account_storage_ingest_before_v1(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

drop index sellerpilot_private.channel_credentials_one_active_non_lazada_elevenst_smartstore_idx;

create unique index channel_credentials_one_active_other_cs_idx
  on sellerpilot_private.channel_credentials(channel,environment)
  where status = 'active' and channel not in ('lazada','elevenst','smartstore','qoo10');

create unique index channel_credentials_one_active_qoo10_account_idx
  on sellerpilot_private.channel_credentials(
    created_by,environment,seller_account_key
  )
  where status = 'active' and channel = 'qoo10';

-- Qoo10 rotation can preserve an account only when the provider-certified
-- subject was written to Vault by the service-attested credential path. A
-- plain API-key rotation without that subject remains a new incarnation.
create or replace function sellerpilot_private.credential_seller_account_lineage(
  p_channel text,
  p_environment text,
  p_vault_secret_id uuid
)
returns table (
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_secret_text text;
  v_secret jsonb;
  v_subject text;
  v_identity_version text;
  v_rotation_source uuid;
  v_inherited record;
  v_legacy_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
  v_service_attested boolean;
begin
  if lower(trim(p_channel)) = 'elevenst' then
    begin
      v_rotation_source := nullif(
        current_setting('sellerpilot.elevenst_credential_rotation_source', true),
        ''
      )::uuid;
    exception when invalid_text_representation then
      v_rotation_source := null;
    end;
    if v_rotation_source is not null then
      select credential.seller_account_key,
             credential.seller_account_key_source,
             credential.seller_account_verified_at
        into v_inherited
        from sellerpilot_private.channel_credentials credential
        join sellerpilot_private.elevenst_credential_identity_claims claim
          on claim.credential_id = credential.id
         and claim.seller_account_key = credential.seller_account_key
       where credential.id = v_rotation_source
         and credential.channel = 'elevenst'
         and credential.environment = lower(trim(p_environment))
         and credential.status in ('grace','revoked')
         and credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'credential_incarnation_v1'
         and credential.seller_account_verified_at is not null
         and claim.lifecycle_state in ('grace','revoked');
      if found then
        return query select
          v_inherited.seller_account_key::text,
          v_inherited.seller_account_key_source::text,
          v_inherited.seller_account_verified_at::timestamptz;
        return;
      end if;
    end if;
  end if;

  v_service_attested := v_legacy_role = 'service_role'
    or sellerpilot_private.credential_lineage_attestation_marker_matches(
      p_channel,p_environment,p_vault_secret_id
    );
  select decrypted.decrypted_secret into v_secret_text
    from vault.decrypted_secrets decrypted
   where decrypted.id = p_vault_secret_id;
  if v_secret_text is null then
    return query select null::text,'legacy_unattested'::text,null::timestamptz;
    return;
  end if;
  begin
    v_secret := v_secret_text::jsonb;
  exception when invalid_text_representation then
    return query select null::text,'legacy_unattested'::text,null::timestamptz;
    return;
  end;
  if p_channel in ('qoo10','shopee','lazada','ebay') then
    v_subject := nullif(trim(v_secret->>'provider_account_subject'),'');
    v_identity_version := nullif(trim(v_secret->>'provider_account_identity_version'),'');
    if not v_service_attested
       or v_identity_version <> 'v1'
       or v_subject is null
       or length(v_subject) > 2048
       or (p_channel = 'qoo10' and v_subject !~ '^qoo10:v1:[A-Za-z0-9._-]{1,240}$')
       or (p_channel = 'shopee' and v_subject !~ '^shopee:(main|shop):[0-9]+$')
       or (p_channel = 'lazada' and (
         length(v_subject) not between 51 and 522
         or v_subject !~ '^lazada:v1:[A-Za-z0-9_-]+$'
       ))
       or (p_channel = 'ebay' and (
         length(v_subject) not between 11 and 522
         or v_subject !~ '^ebay:eias:[^[:cntrl:]]+$'
       )) then
      return query select null::text,'legacy_unattested'::text,null::timestamptz;
      return;
    end if;
    return query select encode(extensions.digest(
      lower(trim(p_channel)) || chr(31) || lower(trim(p_environment))
        || chr(31) || v_subject,
      'sha256'
    ),'hex'),'provider_certified_v1'::text,now();
    return;
  end if;
  return query select sellerpilot_private.new_seller_account_key(),
    'credential_incarnation_v1'::text,now();
end
$$;

commit;
