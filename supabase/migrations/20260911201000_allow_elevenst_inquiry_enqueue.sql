-- 11번가 상품 Q&A CS 경로는 코드·카탈로그·읽기 라우트까지 열려 있는데, 정기 동기화
-- enqueue 게이트가 주문(orders.list)만 허용해서 문의 조회를 접수조차 못 했다.
-- (20260821123000_enable_elevenst_order_sync.sql 이 남긴 제한)
do $patch$
declare
  v_def text;
  v_marker text := E'\n\\s*or \\(p_channel = ''elevenst'' and p_operation <> ''orders\\.list''\\)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sellerpilot_enqueue_periodic_sync_without_identity_gate';
  if v_def is null then
    raise exception 'periodic enqueue gate function missing';
  end if;
  if position('p_channel = ''elevenst'' and p_operation <> ''orders.list''' in v_def) = 0 then
    raise notice 'already allows elevenst inquiries';
    return;
  end if;
  v_def := regexp_replace(v_def, v_marker, '', 'g');
  execute v_def;
end;
$patch$;
