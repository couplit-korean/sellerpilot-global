begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Remove cards without erasing provider receipts needed for duplicate prevention.
create table sellerpilot_private.registration_activity_controls (
 activity_id text primary key,
 owner_id uuid not null references auth.users(id),
 stopped_at timestamptz not null default now(),
 deleted_at timestamptz,
 check (activity_id ~ '^(product|job|research|asset|revision):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
alter table sellerpilot_private.registration_activity_controls enable row level security;
revoke all on sellerpilot_private.registration_activity_controls from public,anon,authenticated,service_role;
create index registration_activity_controls_owner_idx on sellerpilot_private.registration_activity_controls(owner_id);
create table sellerpilot_private.registration_history_resets (
 owner_id uuid primary key references auth.users(id), cleared_at timestamptz not null
);
alter table sellerpilot_private.registration_history_resets enable row level security;
revoke all on sellerpilot_private.registration_history_resets from public,anon,authenticated,service_role;

alter table sellerpilot_private.first_draft_image_requests drop constraint first_draft_image_requests_status_check;
alter table sellerpilot_private.first_draft_image_requests add constraint first_draft_image_requests_status_check
 check(status in ('queued','generating','done','cancelled'));

create function public.sellerpilot_control_registration_activity(p_activity_id text, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
 v_id uuid; v_product_id uuid; v_job_id uuid; v_owner uuid; v_kind text;
 v_active integer := 0; v_cancelled integer := 0; v_row record; v_count integer := 0;
begin
 if auth.uid() is null or not public.sellerpilot_is_admin() then
  raise exception 'administrator access required' using errcode='42501';
 end if;
 if p_action not in ('stop','delete','clear') then raise exception 'REGISTRATION_ACTION_INVALID'; end if;
 if p_action='clear' then
  if p_activity_id is not null then raise exception 'REGISTRATION_ACTION_INVALID'; end if;
  for v_row in
   select 'product:'||p.id::text as id from sellerpilot_private.products p
    where p.owner_id=auth.uid() and not p.demo
   union
   select (case when j.kind='product_research' then 'research:'
     when j.kind='product_asset_regeneration' then 'asset:'
     when exists(select 1 from sellerpilot_private.product_ai_revisions r where r.job_id=j.id) then 'revision:'
     else 'job:' end)||j.id::text
    from sellerpilot_private.ai_cli_jobs j where j.created_by=auth.uid()
     and j.kind in ('product_studio','product_research','product_asset_regeneration')
  loop
   perform public.sellerpilot_control_registration_activity(v_row.id,'delete');
   v_count:=v_count+1;
  end loop;
  insert into sellerpilot_private.registration_history_resets values(auth.uid(),clock_timestamp())
   on conflict(owner_id) do update set cleared_at=excluded.cleared_at;
  return jsonb_build_object('action','clear','deletedCount',v_count);
 end if;
 if p_activity_id is null or p_activity_id !~ '^(product|job|research|asset|revision):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'REGISTRATION_ACTIVITY_INVALID';
 end if;
 v_id:=split_part(p_activity_id,':',2)::uuid;
 if split_part(p_activity_id,':',1)='product' then
  select p.id,p.ai_job_id,p.owner_id into v_product_id,v_job_id,v_owner
   from sellerpilot_private.products p where p.id=v_id and not p.demo for update;
 else
  select j.id,j.created_by,j.kind into v_job_id,v_owner,v_kind
   from sellerpilot_private.ai_cli_jobs j where j.id=v_id
    and j.kind in ('product_studio','product_research','product_asset_regeneration') for update;
  if (split_part(p_activity_id,':',1)='research' and v_kind is distinct from 'product_research')
   or (split_part(p_activity_id,':',1)='asset' and v_kind is distinct from 'product_asset_regeneration')
   or (split_part(p_activity_id,':',1) in ('job','revision') and v_kind is distinct from 'product_studio') then
   raise exception 'REGISTRATION_ACTIVITY_INVALID';
  end if;
 end if;
 if v_job_id is not null and v_product_id is null then
  select p.id into v_product_id from sellerpilot_private.products p where p.ai_job_id=v_job_id and p.owner_id=auth.uid() and not p.demo;
 end if;
 if v_owner is distinct from auth.uid() then raise exception 'REGISTRATION_ACTIVITY_NOT_OWNED' using errcode='42501'; end if;
 insert into sellerpilot_private.registration_activity_controls(activity_id,owner_id,deleted_at)
 values(p_activity_id,v_owner,case when p_action='delete' then clock_timestamp() end)
 on conflict(activity_id) do update set deleted_at=coalesce(registration_activity_controls.deleted_at,excluded.deleted_at);
 if v_product_id is not null and p_activity_id <> 'product:'||v_product_id::text then
  insert into sellerpilot_private.registration_activity_controls(activity_id,owner_id,deleted_at)
   values('product:'||v_product_id::text,v_owner,case when p_action='delete' then clock_timestamp() end)
   on conflict(activity_id) do update set deleted_at=coalesce(registration_activity_controls.deleted_at,excluded.deleted_at);
 end if;
 if v_kind='product_research' then
  for v_row in select j.id from sellerpilot_private.ai_cli_jobs j where j.created_by=v_owner
   and j.kind='product_studio' and j.request_payload->>'source_research_job_id'=v_job_id::text
  loop perform public.sellerpilot_control_registration_activity('job:'||v_row.id::text,p_action); end loop;
 end if;
 if v_job_id is not null then
  update sellerpilot_private.ai_cli_jobs set status='cancelled',error_message='관리자가 작업을 취소했습니다.',
   worker_token_id=null,claim_token=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=v_job_id and created_by=v_owner and status in ('queued','running');
  get diagnostics v_cancelled=row_count;
  update sellerpilot_private.first_draft_image_requests set status='cancelled',worker_token_id=null,
   completed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error='관리자가 작업을 취소했습니다.'
   where job_id=v_job_id and owner_id=v_owner and status in ('queued','generating');
  update sellerpilot_private.product_ai_revisions set status='cancelled',failure_reason='관리자가 작업을 취소했습니다.',updated_at=clock_timestamp()
   where job_id=v_job_id and owner_id=v_owner and status='pending';
 end if;
 if v_product_id is not null then
  update sellerpilot_private.channel_gateway_jobs g set status='cancelled',error_message='관리자가 등록 작업을 중지했습니다.',
   completed_at=clock_timestamp(),updated_at=clock_timestamp(),worker_token_id=null,lease_expires_at=null
   where g.created_by=v_owner and g.status='queued' and g.operation in ('listing.create','listing.update','listing.activate')
    and exists(select 1 from sellerpilot_private.product_listings l where l.product_id=v_product_id and l.operation_attempt_id=g.attempt_id);
  select count(*) into v_active from sellerpilot_private.product_listings l
   join sellerpilot_private.channel_operation_attempts a on a.id=l.operation_attempt_id
   where l.product_id=v_product_id and a.status='running'
    and not exists(select 1 from sellerpilot_private.channel_gateway_jobs g where g.attempt_id=a.id and g.status='cancelled');
 end if;
 return jsonb_build_object('action',p_action,'activityId',p_activity_id,'inFlight',v_active,'cancelledAiJobs',v_cancelled);
end;
$fn$;
revoke all on function public.sellerpilot_control_registration_activity(text,text) from public,anon;
grant execute on function public.sellerpilot_control_registration_activity(text,text) to authenticated;

-- Fence new dispatches and retries. Already-running calls retain their truthful
-- outcome; cancellation never rewrites an ambiguous external result as success.
create function sellerpilot_private.guard_stopped_registration() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare v_product uuid; v_job uuid; v_source text;
begin
 if tg_table_name='product_listings' then
  if new.status <> 'queued' or (tg_op='UPDATE' and old.status='queued' and old.operation_attempt_id is not distinct from new.operation_attempt_id) then return new; end if;
  v_product:=new.product_id;
 elsif tg_table_name='channel_gateway_jobs' then
  if new.operation not in ('listing.create','listing.update','listing.activate') or new.status not in ('queued','running') then return new; end if;
  select l.product_id into v_product from sellerpilot_private.product_listings l where l.operation_attempt_id=new.attempt_id limit 1;
 elsif tg_table_name='ai_cli_jobs' then
  if new.status not in ('queued','running') then return new; end if;
  v_job:=new.id;
  v_source:=new.request_payload->>'source_research_job_id';
  select p.id into v_product from sellerpilot_private.products p where p.ai_job_id=new.id limit 1;
 else
  if new.status not in ('queued','generating') then return new; end if;
  v_job:=new.job_id;
 end if;
 if exists(select 1 from sellerpilot_private.registration_activity_controls c
  where (v_source is not null and c.activity_id='research:'||v_source)
    or (v_product is not null and c.activity_id='product:'||v_product::text)
    or (v_job is not null and c.activity_id in ('job:'||v_job::text,'research:'||v_job::text,'asset:'||v_job::text,'revision:'||v_job::text))) then
  raise exception 'REGISTRATION_ACTIVITY_STOPPED' using errcode='P0001';
 end if;
 return new;
end;
$fn$;
revoke all on function sellerpilot_private.guard_stopped_registration() from public,anon,authenticated,service_role;
create trigger registration_stop_listing before insert or update on sellerpilot_private.product_listings for each row execute function sellerpilot_private.guard_stopped_registration();
create trigger registration_stop_gateway before insert or update of status on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_stopped_registration();
create trigger registration_stop_ai before insert or update of status on sellerpilot_private.ai_cli_jobs for each row execute function sellerpilot_private.guard_stopped_registration();
create trigger registration_stop_first_draft before insert or update of status on sellerpilot_private.first_draft_image_requests for each row execute function sellerpilot_private.guard_stopped_registration();

alter function public.sellerpilot_list_registration_activity(integer) rename to sellerpilot_list_registration_activity_before_controls;
alter function public.sellerpilot_list_registration_activity_before_controls(integer) set schema sellerpilot_private;
revoke all on function sellerpilot_private.sellerpilot_list_registration_activity_before_controls(integer) from public,anon,authenticated,service_role;
create function public.sellerpilot_list_registration_activity(p_limit integer default 120)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_base jsonb; v_result jsonb;
begin
 if auth.uid() is null or not public.sellerpilot_is_admin() then raise exception 'administrator access required' using errcode='42501'; end if;
 v_base:=sellerpilot_private.sellerpilot_list_registration_activity_before_controls(300);
 with research as (
  select jsonb_build_object('id','research:'||j.id::text,'productId',null,
   'productName',coalesce(nullif(j.result_payload->'suggestedFields'->>'productName',''),left(j.request_payload->>'research_input',100),'상품 정보·이미지'),
   'productCode','AI-'||upper(left(j.id::text,8)),'sku','',
   'status',case when j.status in ('queued','running') or q.status='generating' or (q.status='queued' and q.attempts<q.max_attempts) then 'analyzing'
    when j.status in ('failed','cancelled') or q.status='cancelled' or (q.status='queued' and q.attempts>=q.max_attempts) then 'failed' else 'ready' end,
   'queueState',case when j.status='queued' or (q.status='queued' and q.attempts<q.max_attempts) then 'queued' when j.status='running' or q.status='generating' then 'running' end,
   'startedAt',j.created_at,'updatedAt',greatest(j.updated_at,coalesce(q.updated_at,j.updated_at)),
   'completedAt',case when j.status in ('queued','running') or q.status='generating' or (q.status='queued' and q.attempts<q.max_attempts) then null else coalesce(q.completed_at,j.completed_at) end,
   'elapsedSeconds',greatest(0,extract(epoch from coalesce(q.completed_at,j.completed_at,now())-j.created_at)::integer),
   'channelCount',0,'publishedCount',0,'failedCount',0,'blockedCount',0,'channels','[]'::jsonb,
   'message',coalesce(q.last_error,j.error_message,'')) as value
  from sellerpilot_private.ai_cli_jobs j left join sellerpilot_private.first_draft_image_requests q on q.job_id=j.id
  where j.created_by=auth.uid() and j.kind='product_research'
  order by j.updated_at desc limit 300
 ), cards as (select value from jsonb_array_elements(v_base) union all select value from research), visible as (
  select case when c.activity_id is not null then cards.value || jsonb_build_object(
   'controlState',case when live.active then 'stopping' else 'stopped' end,
   'status',case when live.active then 'publishing' else 'failed' end,
   'message',case when live.active then '중지 요청됨 · 이미 전달한 채널 응답을 확인하고 있습니다.' else '관리자가 작업을 취소했습니다.' end)
   else cards.value end as value
  from cards left join sellerpilot_private.registration_activity_controls c on c.activity_id=cards.value->>'id'
  cross join lateral (select exists(
   select 1 from sellerpilot_private.product_listings l join sellerpilot_private.channel_operation_attempts a on a.id=l.operation_attempt_id
   where l.product_id::text=cards.value->>'productId' and a.status='running'
    and not exists(select 1 from sellerpilot_private.channel_gateway_jobs g where g.attempt_id=a.id and g.status='cancelled')) as active) live
  where c.deleted_at is null
 ), limited as (select value from visible order by (value->>'updatedAt')::timestamptz desc,value->>'id' limit greatest(1,least(coalesce(p_limit,120),300)))
 select coalesce(jsonb_agg(value),'[]'::jsonb) into v_result from limited;
 return v_result;
end;
$fn$;
revoke all on function public.sellerpilot_list_registration_activity(integer) from public,anon;
grant execute on function public.sellerpilot_list_registration_activity(integer) to authenticated;
create function public.sellerpilot_registration_history_reset() returns timestamptz
language sql stable security definer set search_path='' as $fn$
 select cleared_at from sellerpilot_private.registration_history_resets where owner_id=auth.uid() and public.sellerpilot_is_admin();
$fn$;
revoke all on function public.sellerpilot_registration_history_reset() from public,anon;
grant execute on function public.sellerpilot_registration_history_reset() to authenticated;
commit;
