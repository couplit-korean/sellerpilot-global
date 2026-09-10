begin;

do $$
declare v_ingest regprocedure := to_regprocedure(
  'public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'
);
begin
  if v_ingest is null or not exists (
    select 1 from pg_proc p
     where p.oid = v_ingest
       and position('SHOPEE_RETURN_CONTEXT_INVALID' in p.prosrc) > 0
       and p.prosecdef
       and p.proowner = 'postgres'::regrole
       and p.proconfig = array['search_path=""']::text[]
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception 'TEMU_AFTER_SALES_INGEST_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure(
    'public.sellerpilot_08046000_ingest_before_temu_details(uuid,text,jsonb)'
  ) is not null then
    raise exception 'TEMU_AFTER_SALES_MIGRATION_ALREADY_WRAPPED';
  end if;
end $$;

alter function public.sellerpilot_service_ingest_inquiries(
  uuid, text, jsonb
) rename to sellerpilot_08046000_ingest_before_temu_details;

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
  v_case jsonb;
  v_external_id text;
  v_after_sales_sn text;
  v_order_sn text;
  v_remote_message_id text;
begin
  if p_channel <> 'temu' then
    return public.sellerpilot_08046000_ingest_before_temu_details(
      p_credential_id, p_channel, p_inquiries
    );
  end if;
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries) > 500
     or octet_length(p_inquiries::text) > 1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select credential.seller_account_key, credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.status in ('active', 'grace');
  if not found then raise exception 'active channel credential required'; end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> 'provider_certified_v1' then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) <> 'object' then
      raise exception 'TEMU_AFTER_SALES_CONTEXT_INVALID';
    end if;
    v_context := v_inquiry->'providerContext';
    v_external_id := coalesce(v_inquiry->>'externalTicketId', '');
    v_after_sales_sn := coalesce(v_context->>'afterSalesSn', '');
    v_order_sn := coalesce(v_context->>'orderSn', '');
    v_remote_message_id := coalesce(v_inquiry->>'remoteMessageId', '');
    if jsonb_typeof(v_context) is distinct from 'object'
       or v_context->>'detailContract' is distinct from 'temu.aftersales.parentaftersales.detail.get'
       or v_context->'replySupported' is distinct from 'false'::jsonb
       or v_inquiry->>'ticketKind' is distinct from 'after_sales'
       or coalesce(v_inquiry->'replyContext', '{}'::jsonb) <> '{}'::jsonb
       or v_after_sales_sn !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
       or v_order_sn !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
       or v_external_id <> 'aftersales:' || v_after_sales_sn
       or v_remote_message_id !~ ('^' || v_after_sales_sn || ':[a-f0-9]{64}$')
       or jsonb_typeof(v_context->'afterSalesCases') is distinct from 'array'
       or jsonb_array_length(v_context->'afterSalesCases') not between 1 and 200
       or exists (
         select 1 from jsonb_object_keys(v_context) key
          where key <> all(array[
            'afterSalesSn','orderSn','statusGroup','availableOperations',
            'providerRevision','providerRevisionSource','replySupported',
            'afterSalesCases','refundSummary','detailContract'
          ])
       ) then
      raise exception 'TEMU_AFTER_SALES_CONTEXT_INVALID';
    end if;
    for v_case in select value from jsonb_array_elements(v_context->'afterSalesCases') loop
      if jsonb_typeof(v_case) is distinct from 'object'
         or coalesce(v_case->>'afterSalesSn','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
         or coalesce(v_case->>'orderSn','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
         or exists (
           select 1 from jsonb_object_keys(v_case) key
            where key <> all(array[
              'afterSalesSn','orderSn','reasonCode','reason','buyerComment',
              'status','requestedQuantity','requestedRefund'
            ])
         ) then
        raise exception 'TEMU_AFTER_SALES_CONTEXT_INVALID';
      end if;
    end loop;
  end loop;

  return public.sellerpilot_08046000_ingest_before_temu_details(
    p_credential_id, p_channel, p_inquiries
  );
end;
$$;

revoke all on function public.sellerpilot_08046000_ingest_before_temu_details(
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
  'Ingests exact marketplace CS identities, including read-only Temu parent after-sales details without arbitrary provider contact fields.';

commit;
