begin;

do $$
declare v_ingest regprocedure := to_regprocedure(
  'public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'
);
begin
  if v_ingest is null or not exists (
    select 1 from pg_proc p
     where p.oid = v_ingest
       and position('SHOPEE_COMMENT_CONTEXT_INVALID' in p.prosrc) > 0
       and p.prosecdef
       and p.proowner = 'postgres'::regrole
       and p.proconfig = array['search_path=""']::text[]
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception 'SHOPEE_RETURN_CS_INGEST_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure(
    'public.sellerpilot_08045000_ingest_before_shopee_returns(uuid,text,jsonb)'
  ) is not null then
    raise exception 'SHOPEE_RETURN_CS_MIGRATION_ALREADY_WRAPPED';
  end if;
end $$;

alter function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) rename to sellerpilot_08045000_ingest_before_shopee_returns;

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
  v_sanitized jsonb := '[]'::jsonb;
  v_external_id text;
  v_shop_id text;
  v_return_sn text;
  v_remote_message_id text;
begin
  if p_channel <> 'shopee'
     or not exists (
       select 1 from jsonb_array_elements(
         case when jsonb_typeof(p_inquiries) = 'array' then p_inquiries else '[]'::jsonb end
       ) item
       where item#>>'{providerContext,kind}' = 'return_refund'
     ) then
    return public.sellerpilot_08045000_ingest_before_shopee_returns(
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
      raise exception 'SHOPEE_RETURN_CONTEXT_INVALID';
    end if;
    v_context := v_inquiry->'providerContext';
    v_external_id := coalesce(v_inquiry->>'externalTicketId', '');
    v_shop_id := coalesce(v_context->>'shopId', '');
    v_return_sn := coalesce(v_context->>'returnSn', '');
    v_remote_message_id := coalesce(v_inquiry->>'remoteMessageId', '');
    if v_context->>'kind' is distinct from 'return_refund'
       or v_context->'replySupported' is distinct from 'false'::jsonb
       or v_inquiry->>'ticketKind' is distinct from 'after_sales'
       or coalesce(v_inquiry->'replyContext', '{}'::jsonb) <> '{}'::jsonb
       or v_shop_id !~ '^[1-9][0-9]{0,31}$'
       or v_return_sn !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
       or v_external_id <> 'shopee:return:' || v_shop_id || ':' || v_return_sn
       or v_remote_message_id !~ ('^' || v_shop_id || ':' || v_return_sn || ':[a-f0-9]{64}$') then
      raise exception 'SHOPEE_RETURN_CONTEXT_INVALID';
    end if;
    v_sanitized := v_sanitized || jsonb_build_array(
      jsonb_set(
        jsonb_set(v_inquiry, '{replyContext}', '{}'::jsonb, true),
        '{ticketKind}', '"after_sales"'::jsonb, true
      )
    );
  end loop;

  -- Return/refund is intentionally read-only in the CS surface. Calling the
  -- pre-comment generic ingest avoids coercing a return serial into a product
  -- comment reply identity while retaining the shared archive and order link.
  return public.sellerpilot_07200000_ingest_before_shopee(
    p_credential_id, p_channel, v_sanitized
  );
end;
$$;

revoke all on function public.sellerpilot_08045000_ingest_before_shopee_returns(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) to service_role;

comment on function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) is
  'Ingests exact marketplace CS identities, including read-only Shopee return/refund details separated from product-comment reply routing.';

commit;
