begin;

do $$
declare
  v_ingest regprocedure := to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)');
begin
  if v_ingest is null or not exists (
    select 1 from pg_proc p
     where p.oid = v_ingest
       and position('TEMU_AFTER_SALES_CONTEXT_INVALID' in p.prosrc) > 0
       and p.prosecdef and p.proowner = 'postgres'::regrole
       and p.proconfig = array['search_path=""']::text[]
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception 'COUPANG_AFTER_SALES_INGEST_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure('public.sellerpilot_08047000_ingest_before_coupang_after_sales(uuid,text,jsonb)') is not null then
    raise exception 'COUPANG_AFTER_SALES_MIGRATION_ALREADY_WRAPPED';
  end if;
end $$;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_08047000_ingest_before_coupang_after_sales;

create function public.sellerpilot_service_ingest_inquiries(
  p_credential_id uuid,
  p_channel text,
  p_inquiries jsonb
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credential record;
  v_inquiry jsonb;
  v_context jsonb;
  v_item jsonb;
  v_kind text;
  v_id text;
  v_expected_type text;
  v_expected_external text;
  v_remote_message_id text;
begin
  if p_channel <> 'coupang' or not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(p_inquiries)='array' then p_inquiries else '[]'::jsonb end
    ) item
    where item#>>'{providerContext,kind}' in ('return_request','cancel_request','exchange_request')
  ) then
    return public.sellerpilot_08047000_ingest_before_coupang_after_sales(
      p_credential_id,p_channel,p_inquiries
    );
  end if;
  if jsonb_typeof(p_inquiries) is distinct from 'array'
     or jsonb_array_length(p_inquiries)>500
     or octet_length(p_inquiries::text)>1000000 then
    raise exception 'invalid normalized inquiries';
  end if;

  select credential.seller_account_key,credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='coupang'
     and credential.status in ('active','grace');
  if not found then raise exception 'active channel credential required'; end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source<>'provider_certified_v1' then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or jsonb_typeof(v_inquiry->'providerContext') is distinct from 'object' then
      raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID';
    end if;
    v_context:=v_inquiry->'providerContext';
    v_kind:=coalesce(v_context->>'kind','');
    v_remote_message_id:=coalesce(v_inquiry->>'remoteMessageId','');
    if v_kind not in ('return_request','cancel_request','exchange_request')
       or v_context->'replySupported' is distinct from 'false'::jsonb
       or v_inquiry->>'ticketKind' is distinct from 'after_sales'
       or coalesce(v_inquiry->'replyContext','{}'::jsonb)<>'{}'::jsonb
       or coalesce(v_inquiry->>'externalOrderReference','')!~'^[1-9][0-9]{0,19}$'
       or coalesce(v_context->>'providerRevision','')!~'^[a-f0-9]{64}$' then
      raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID';
    end if;

    if v_kind='exchange_request' then
      v_id:=coalesce(v_context->>'exchangeId','');
      v_expected_external:='coupang:exchange:'||v_id;
      if v_id!~'^[1-9][0-9]{0,19}$'
         or v_inquiry->>'externalTicketId' is distinct from v_expected_external
         or v_remote_message_id!~('^exchange:'||v_id||':[a-f0-9]{64}$')
         or coalesce(v_context->>'exchangeStatus','') not in ('RECEIPT','PROGRESS','SUCCESS','REJECT','CANCEL')
         or jsonb_typeof(v_context->'exchangeItems') is distinct from 'array'
         or jsonb_array_length(v_context->'exchangeItems')>100
         or exists (
           select 1 from jsonb_object_keys(v_context) key
            where key<>all(array[
              'kind','exchangeId','exchangeStatus','orderDeliveryStatus','referType',
              'faultType','reasonCode','reasonCodeText','reasonDetail','cancelReason',
              'createdByType','deliveryStatus','collectStatus','exchangeItems',
              'replySupported','providerRevision'
            ])
         ) then
        raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID';
      end if;
      for v_item in select value from jsonb_array_elements(v_context->'exchangeItems') loop
        if jsonb_typeof(v_item) is distinct from 'object' or exists (
          select 1 from jsonb_object_keys(v_item) key where key<>all(array[
            'exchangeItemId','orderItemId','targetItemId','orderItemName','targetItemName',
            'quantity','originalShipmentBoxId'
          ])
        ) then raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID'; end if;
      end loop;
    else
      v_id:=coalesce(v_context->>'receiptId','');
      v_expected_type:=case when v_kind='return_request' then 'RETURN' else 'CANCEL' end;
      v_expected_external:='coupang:'||case when v_kind='return_request' then 'return' else 'cancel' end||':'||v_id;
      if v_id!~'^[1-9][0-9]{0,19}$'
         or v_context->>'receiptType' is distinct from v_expected_type
         or coalesce(v_context->>'receiptStatus','')=''
         or v_inquiry->>'externalTicketId' is distinct from v_expected_external
         or v_remote_message_id!~('^'||lower(v_expected_type)||':'||v_id||':[a-f0-9]{64}$')
         or jsonb_typeof(v_context->'returnItems') is distinct from 'array'
         or jsonb_array_length(v_context->'returnItems')>100
         or jsonb_typeof(v_context->'returnDeliveries') is distinct from 'array'
         or jsonb_array_length(v_context->'returnDeliveries')>100
         or exists (
           select 1 from jsonb_object_keys(v_context) key
            where key<>all(array[
              'kind','receiptId','receiptType','receiptStatus','faultType','reasonCode',
              'reasonCodeText','cancelReasonCategory1','cancelReasonCategory2',
              'releaseStopStatus','preRefund','completeConfirmType','returnItems',
              'returnDeliveries','replySupported','providerRevision'
            ])
         ) then
        raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID';
      end if;
      for v_item in select value from jsonb_array_elements(v_context->'returnItems') loop
        if jsonb_typeof(v_item) is distinct from 'object' or exists (
          select 1 from jsonb_object_keys(v_item) key where key<>all(array[
            'vendorItemId','vendorItemName','sellerProductId','cancelCount','purchaseCount',
            'shipmentBoxId','releaseStatus'
          ])
        ) then raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID'; end if;
      end loop;
      for v_item in select value from jsonb_array_elements(v_context->'returnDeliveries') loop
        if jsonb_typeof(v_item) is distinct from 'object' or exists (
          select 1 from jsonb_object_keys(v_item) key where key<>all(array[
            'deliveryCompanyCode','deliveryInvoiceNo'
          ])
        ) then raise exception 'COUPANG_AFTER_SALES_CONTEXT_INVALID'; end if;
      end loop;
    end if;
  end loop;

  return public.sellerpilot_08047000_ingest_before_coupang_after_sales(
    p_credential_id,p_channel,p_inquiries
  );
end;
$$;

revoke all on function public.sellerpilot_08047000_ingest_before_coupang_after_sales(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) to service_role;

comment on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) is
  'Ingests exact CS identities, including read-only Coupang return, cancellation and exchange reasons without buyer contact or address fields.';

notify pgrst,'reload schema';
commit;
