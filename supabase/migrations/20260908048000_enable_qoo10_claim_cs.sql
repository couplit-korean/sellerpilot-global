begin;

do $$
declare
  v_ingest regprocedure := to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)');
begin
  if v_ingest is null or not exists (
    select 1 from pg_proc p
     where p.oid=v_ingest
       and position('COUPANG_AFTER_SALES_CONTEXT_INVALID' in p.prosrc)>0
       and p.prosecdef and p.proowner='postgres'::regrole
       and p.proconfig=array['search_path=""']::text[]
       and not has_function_privilege('anon',p.oid,'EXECUTE')
       and not has_function_privilege('authenticated',p.oid,'EXECUTE')
       and has_function_privilege('service_role',p.oid,'EXECUTE')
  ) then raise exception 'QOO10_CLAIM_INGEST_PREIMAGE_REVIEW_REQUIRED'; end if;
  if to_regprocedure(
    'public.sellerpilot_08048000_ingest_before_qoo10_claim(uuid,text,jsonb)'
  ) is not null then raise exception 'QOO10_CLAIM_MIGRATION_ALREADY_WRAPPED'; end if;
end $$;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_08048000_ingest_before_qoo10_claim;

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
  v_order_no text;
  v_status text;
  v_request_date text;
  v_date_key text;
  v_revision text;
  v_label text;
  v_expected_subject text;
  v_expected_message text;
  v_expected_state text;
begin
  if p_channel<>'qoo10' or not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(p_inquiries)='array' then p_inquiries else '[]'::jsonb end
    ) item where item#>>'{providerContext,kind}'='claim'
  ) then
    return public.sellerpilot_08048000_ingest_before_qoo10_claim(
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
   where credential.id=p_credential_id and credential.channel='qoo10'
     and credential.status in ('active','grace');
  if not found then raise exception 'active channel credential required'; end if;
  if v_credential.seller_account_key is null
     or v_credential.seller_account_key_source<>'provider_certified_v1' then
    raise exception 'INQUIRY_SELLER_LINEAGE_UNATTESTED';
  end if;

  for v_inquiry in select value from jsonb_array_elements(p_inquiries) loop
    if jsonb_typeof(v_inquiry) is distinct from 'object'
       or jsonb_typeof(v_inquiry->'providerContext') is distinct from 'object' then
      raise exception 'QOO10_CLAIM_CONTEXT_INVALID';
    end if;
    v_context:=v_inquiry->'providerContext';
    v_order_no:=coalesce(v_context->>'orderNo','');
    v_status:=coalesce(v_context->>'claimStatus','');
    v_request_date:=coalesce(v_context->>'requestDate','');
    v_revision:=coalesce(v_context->>'providerRevision','');
    v_label:=case v_status
      when '1' then '취소 요청' when '2' then '취소 처리 중' when '3' then '취소 완료'
      when '4' then '반품 요청' when '5' then '반품 처리 중' when '6' then '반품 완료'
      when '11' then '교환 요청' when '12' then '교환 승인' when '13' then '재배송'
      when '14' then '미수취 전액 환불 완료' when '15' then '미수취 부분 환불 완료'
      when '16' then '미결제 주문 취소' else null end;
    if v_request_date~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$' then
      v_date_key:=to_char(v_request_date::timestamptz at time zone 'UTC','YYYYMMDDHH24MISS');
    else v_date_key:=''; end if;
    v_expected_subject:='Qoo10 '||coalesce(v_label,'')||' · '||case
      when coalesce(v_context->>'itemTitle','')<>'' then v_context->>'itemTitle'
      else '주문 '||v_order_no end;
    v_expected_message:=case when coalesce(v_context->>'reason','')<>''
      then v_context->>'reason' else '상태: '||coalesce(v_label,'') end;
    v_expected_state:=case when v_status in ('3','6','14','15','16')
      then 'resolved' else 'waiting' end;

    if v_context->>'kind' is distinct from 'claim'
       or v_order_no!~'^[1-9][0-9]{0,19}$'
       or v_label is null or v_date_key=''
       or v_revision!~'^[a-f0-9]{64}$'
       or v_context->'replySupported' is distinct from 'false'::jsonb
       or v_inquiry->>'externalTicketId' is distinct from
          'qoo10:claim:'||v_order_no||':'||v_date_key
       or v_inquiry->>'remoteMessageId' is distinct from
          'claim:'||v_order_no||':'||v_date_key||':'||v_revision
       or v_inquiry->>'externalOrderReference' is distinct from v_order_no
       or v_inquiry->>'ticketKind' is distinct from 'after_sales'
       or coalesce(v_inquiry->'replyContext','{}'::jsonb)<>'{}'::jsonb
       or v_inquiry->>'customerName' is distinct from 'Qoo10 주문 고객'
       or v_inquiry->>'senderRole' is distinct from 'customer'
       or v_inquiry->>'subject' is distinct from v_expected_subject
       or v_inquiry->>'message' is distinct from v_expected_message
       or v_inquiry->>'receivedAt' is distinct from v_request_date
       or v_inquiry->>'status' is distinct from v_expected_state
       or v_inquiry->>'providerStatus' is distinct from
          (case when v_expected_state='resolved' then 'answered' else 'waiting' end)
       or v_inquiry->'priority' is distinct from
          to_jsonb(case when v_status in ('1','4','11') then 2 else 3 end)
       or octet_length(v_context::text)>64000
       or exists (
         select 1 from jsonb_object_keys(v_context) key
          where key<>all(array[
            'kind','orderNo','claimStatus','requestDate','cancelRefundDate','orderDate',
            'paymentDate','shippingDate','deliveredDate','reason','itemCode',
            'sellerItemCode','itemTitle','orderQty','paymentNation','currency',
            'paymentAmount','deliveryCompany','trackingNo','deliveryCompanyReturn',
            'trackingNoReturn','itemCondition','nrDutyTarget','nrSolType',
            'nrPartRefundCnt','nrPartRefundBalance','replySupported','providerRevision'
          ])
       )
       or exists (
         select 1 from jsonb_each(v_context) item
          where item.key not in ('replySupported')
            and jsonb_typeof(item.value) is distinct from 'string'
       )
       or exists (
         select 1 from unnest(array[
           coalesce(v_context->>'cancelRefundDate',''),coalesce(v_context->>'orderDate',''),
           coalesce(v_context->>'paymentDate',''),coalesce(v_context->>'shippingDate',''),
           coalesce(v_context->>'deliveredDate','')
         ]) value where value<>'' and value!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$'
       ) then raise exception 'QOO10_CLAIM_CONTEXT_INVALID'; end if;
  end loop;

  return public.sellerpilot_08048000_ingest_before_qoo10_claim(
    p_credential_id,p_channel,p_inquiries
  );
end;
$$;

revoke all on function public.sellerpilot_08048000_ingest_before_qoo10_claim(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  to service_role;

comment on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) is
  'Ingests exact CS identities, including read-only Qoo10 claims while excluding buyer IDs, contacts and pickup addresses.';

notify pgrst,'reload schema';
commit;
