-- 쇼피 상세 문의 양식은 로그인 없이 접수되므로 관리자 전용 cs_snapshot 으로
-- 소유자를 찾을 수 없었다(운영에서 503). CS 원장 소유자를 인증 없이 해석하는
-- 서비스 전용 RPC 를 추가한다. 규칙은 채널 적재 함수와 같은 순서를 쓴다:
-- 활성 운영 자격증명의 소유자 → 마지막 원장 소유자.
create or replace function public.sellerpilot_public_cs_ledger_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select credential.created_by
       from sellerpilot_private.channel_credentials credential
      where credential.channel = 'shopee'
        and credential.environment = 'production'
        and credential.status = 'active'
        and credential.created_by is not null
      order by credential.version desc nulls last, credential.created_at desc
      limit 1),
    (select ticket.owner_id
       from sellerpilot_private.support_tickets ticket
      where ticket.owner_id is not null
      order by ticket.updated_at desc
      limit 1)
  );
$$;

revoke all on function public.sellerpilot_public_cs_ledger_owner() from public, anon, authenticated;
grant execute on function public.sellerpilot_public_cs_ledger_owner() to service_role;
