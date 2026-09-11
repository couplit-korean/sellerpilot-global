-- 쇼피 상세 문의 양식이 support_tickets 로 직접 insert 하면 PostgREST 가 노출하지
-- 않는 sellerpilot_private 스키마라 거절된다(운영에서 "문의 원장 저장이 거절됐습니다").
-- 다른 채널 적재와 같이 public 스키마의 SECURITY DEFINER RPC 로 저장한다.
create or replace function public.sellerpilot_public_shopee_storefront_inquiry(
  p_external_ticket_id text,
  p_inbound_key text,
  p_customer_name text,
  p_subject text,
  p_message text,
  p_received_at timestamptz,
  p_item_id text,
  p_order_sn text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_ticket uuid;
begin
  if p_external_ticket_id is null or p_inbound_key is null
     or p_customer_name is null or p_message is null or p_received_at is null then
    raise exception 'SHOPEE_STOREFRONT_INQUIRY_ARGUMENTS_REQUIRED' using errcode = '22023';
  end if;
  select public.sellerpilot_public_cs_ledger_owner() into v_owner;
  if v_owner is null then
    raise exception 'SHOPEE_STOREFRONT_LEDGER_OWNER_REQUIRED' using errcode = '55000';
  end if;
  insert into sellerpilot_private.support_tickets(
    owner_id, external_ticket_id, channel_key, customer_name, subject, message,
    status, priority, received_at, demo, updated_at, provider_status,
    provider_status_updated_at, latest_inbound_key, provider_context, reply_context,
    external_order_reference, ticket_kind
  ) values (
    v_owner, left(p_external_ticket_id, 200), 'shopee', left(p_customer_name, 240),
    left(p_subject, 500), left(p_message, 4000), 'waiting', 3, p_received_at, false,
    p_received_at, 'waiting', p_received_at, p_inbound_key,
    jsonb_build_object('kind', 'storefront_form', 'itemId', coalesce(p_item_id, ''),
                       'orderSn', coalesce(p_order_sn, '')),
    '{}'::jsonb, nullif(p_order_sn, ''), 'conversation'
  )
  returning id into v_ticket;
  return v_ticket;
end;
$$;

revoke all on function public.sellerpilot_public_shopee_storefront_inquiry(text,text,text,text,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.sellerpilot_public_shopee_storefront_inquiry(text,text,text,text,text,timestamptz,text,text) to service_role;

-- 진단 중 만든 테스트 행 정리
delete from sellerpilot_private.support_tickets
 where external_ticket_id = 'shopee:storefront:diag-0001';
