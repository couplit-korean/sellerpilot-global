-- Queue privacy-minimized customer-support drafts for the local Codex CLI worker.

begin;

alter table sellerpilot_private.ai_cli_jobs
  drop constraint if exists ai_cli_jobs_kind_check;

alter table sellerpilot_private.ai_cli_jobs
  add constraint ai_cli_jobs_kind_check
  check (kind in ('product_studio', 'product_research', 'support_reply'));

create or replace function public.sellerpilot_create_support_reply_job(
  p_id uuid,
  p_ticket_id uuid,
  p_target_locale text,
  p_tone text default 'polite'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_order sellerpilot_private.commerce_orders%rowtype;
  v_payload jsonb;
begin
  if not public.sellerpilot_is_admin()
     or p_target_locale not in ('ko-KR', 'en-US', 'ja-JP', 'zh-TW', 'th-TH', 'vi-VN', 'id-ID', 'ms-MY', 'pt-BR', 'es-MX')
     or p_tone not in ('polite', 'concise', 'apologetic') then
    raise exception 'invalid support reply request' using errcode = '42501';
  end if;

  select * into v_ticket
    from sellerpilot_private.support_tickets t
   where t.id = p_ticket_id and t.owner_id = auth.uid() and not t.demo;
  if not found then raise exception 'support ticket not found'; end if;

  if v_ticket.order_id is not null then
    select * into v_order
      from sellerpilot_private.commerce_orders o
     where o.id = v_ticket.order_id and o.owner_id = auth.uid() and not o.demo;
  end if;

  v_payload := jsonb_build_object(
    'ticket_id', v_ticket.id,
    'channel', v_ticket.channel_key,
    'target_locale', p_target_locale,
    'tone', p_tone,
    'subject', left(v_ticket.subject, 500),
    'message', left(v_ticket.message, 12000),
    'order', case when v_order.id is null then null else jsonb_build_object(
      'external_order_id', left(v_order.external_order_id, 240),
      'product_name', left(v_order.product_name, 500),
      'quantity', v_order.quantity,
      'status', v_order.status,
      'ordered_at', v_order.ordered_at,
      'shipped_at', v_order.shipped_at
    ) end
  );

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (p_id, 'support_reply', v_payload, auth.uid());

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', auth.uid(), p_id, jsonb_build_object(
    'kind', 'support_reply',
    'channel', v_ticket.channel_key,
    'target_locale', p_target_locale,
    'has_order_context', v_order.id is not null
  ));
  return p_id;
end;
$$;

revoke all on function public.sellerpilot_create_support_reply_job(uuid, uuid, text, text) from public, anon;
grant execute on function public.sellerpilot_create_support_reply_job(uuid, uuid, text, text) to authenticated;

commit;
