-- CS drafts own their queue, lease, results and polling. Authentication uses
-- the existing scoped worker identity; no product job/state/table is queried.
begin;
create table sellerpilot_private.cs_reply_draft_jobs (
 id uuid primary key,
 ticket_id uuid not null references sellerpilot_private.support_tickets(id),
 requested_by uuid not null references auth.users(id),
 inbound_key text not null check(length(inbound_key) between 1 and 500),
 request_payload jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
 claim_token uuid,
 worker_token_hash text,
 lease_expires_at timestamptz,
 attempt_count integer not null default 0 check(attempt_count between 0 and 3),
 result_payload jsonb,
 error_message text,
 created_at timestamptz not null default clock_timestamp(),
 started_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz
);
alter table sellerpilot_private.cs_reply_draft_jobs enable row level security;
revoke all on sellerpilot_private.cs_reply_draft_jobs from public,anon,authenticated,service_role;
create index cs_reply_draft_claim_idx on sellerpilot_private.cs_reply_draft_jobs(created_at,id) where status='queued';
create index cs_reply_draft_ticket_idx on sellerpilot_private.cs_reply_draft_jobs(ticket_id,created_at desc);

create function public.sellerpilot_create_cs_reply_draft(p_id uuid,p_ticket_id uuid,p_expected_inbound_key text,p_target_locale text,p_tone text default 'polite')
returns uuid language plpgsql security definer set search_path='' as $$
declare t sellerpilot_private.support_tickets%rowtype; existing sellerpilot_private.cs_reply_draft_jobs%rowtype; payload jsonb;
begin
 if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then raise exception 'administrator access required' using errcode='42501'; end if;
 if p_id is null or p_expected_inbound_key is null or length(p_expected_inbound_key) not between 1 and 500
  or p_target_locale is null or p_target_locale not in ('ko-KR','en-US','ja-JP','zh-TW','th-TH','vi-VN','id-ID','ms-MY','pt-BR','es-MX')
  or p_tone is null or p_tone not in ('polite','concise','apologetic') then raise exception 'invalid CS draft request' using errcode='22023'; end if;
 select * into t from sellerpilot_private.support_tickets where id=p_ticket_id and not demo for update;
 if not found then raise exception 'support ticket not found' using errcode='42501'; end if;
 if t.latest_inbound_key is distinct from p_expected_inbound_key then raise exception 'INQUIRY_CONTEXT_STALE' using errcode='55000'; end if;
 if t.channel_key='lazada' and sellerpilot_private.lazada_im_ticket_projection_state_v1(t.id,statement_timestamp()) is distinct from 'normal' then
  raise exception 'LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE' using errcode='55000'; end if;
 payload:=jsonb_build_object('ticket_id',t.id,'sellerpilotInboundKey',t.latest_inbound_key,'channel',t.channel_key,
  'target_locale',p_target_locale,'tone',p_tone,'subject',left(coalesce(t.subject,''),500),'message',left(t.message,12000),'order',null);
 if length(coalesce(t.message,''))=0 then raise exception 'CS_MESSAGE_EMPTY' using errcode='22023'; end if;
 select * into existing from sellerpilot_private.cs_reply_draft_jobs where id=p_id;
 if found then
  if existing.ticket_id<>t.id or existing.inbound_key<>p_expected_inbound_key or existing.request_payload<>payload then raise exception 'CS_DRAFT_ID_REUSED' using errcode='23505'; end if;
  return existing.id;
 end if;
 insert into sellerpilot_private.cs_reply_draft_jobs(id,ticket_id,requested_by,inbound_key,request_payload)
 values(p_id,t.id,auth.uid(),p_expected_inbound_key,payload);
 return p_id;
end $$;

create function public.sellerpilot_get_cs_reply_draft(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.cs_reply_draft_jobs%rowtype; latest_key text;
begin
 if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then raise exception 'administrator access required' using errcode='42501'; end if;
 select * into j from sellerpilot_private.cs_reply_draft_jobs where id=p_id;
 if not found then return null; end if;
 select latest_inbound_key into latest_key from sellerpilot_private.support_tickets where id=j.ticket_id and not demo;
 if not found then return null; end if;
 return jsonb_build_object('id',j.id,'status',case when latest_key is distinct from j.inbound_key then 'failed' else j.status end,
  'result',case when latest_key is not distinct from j.inbound_key then j.result_payload else null end,
  'error',case when latest_key is distinct from j.inbound_key then '새 고객 메시지가 도착했습니다. 최신 문의에서 다시 요청해 주세요.' else j.error_message end,
  'createdAt',j.created_at,'updatedAt',j.updated_at,'attemptCount',j.attempt_count);
end $$;

create function public.sellerpilot_cancel_cs_reply_draft(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then raise exception 'administrator access required' using errcode='42501'; end if;
 update sellerpilot_private.cs_reply_draft_jobs set status='cancelled',lease_expires_at=null,updated_at=clock_timestamp(),completed_at=clock_timestamp()
 where id=p_id and status in ('queued','running');
 return found;
end $$;

create function public.sellerpilot_claim_cs_reply_draft(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.cs_reply_draft_jobs%rowtype;
begin
 if sellerpilot_private.worker_token_has_scope(p_token_hash,'ai',true) is distinct from true then raise exception 'CS worker authentication required' using errcode='42501'; end if;
 update sellerpilot_private.cs_reply_draft_jobs set status=case when attempt_count<3 then 'queued' else 'failed' end,
  error_message=case when attempt_count>=3 then '답변 초안 작업자의 실행 시간이 만료되었습니다.' else null end,
  lease_expires_at=null,updated_at=clock_timestamp(),completed_at=case when attempt_count>=3 then clock_timestamp() else null end
 where status='running' and lease_expires_at<=clock_timestamp();
 select * into j from sellerpilot_private.cs_reply_draft_jobs where status='queued' order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update sellerpilot_private.cs_reply_draft_jobs set status='running',claim_token=gen_random_uuid(),worker_token_hash=p_token_hash,
  lease_expires_at=clock_timestamp()+interval '90 seconds',attempt_count=attempt_count+1,started_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'claim_token',j.claim_token,'request',j.request_payload,'attempt_count',j.attempt_count,'lease_expires_at',j.lease_expires_at);
end $$;

create function public.sellerpilot_touch_cs_reply_draft(p_token_hash text,p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if sellerpilot_private.worker_token_has_scope(p_token_hash,'ai',true) is distinct from true then raise exception 'CS worker authentication required' using errcode='42501'; end if;
 update sellerpilot_private.cs_reply_draft_jobs set lease_expires_at=least(clock_timestamp()+interval '90 seconds',started_at+interval '12 minutes'),updated_at=clock_timestamp()
 where id=p_id and claim_token=p_claim_token and worker_token_hash=p_token_hash and status='running' and lease_expires_at>clock_timestamp() and started_at>clock_timestamp()-interval '12 minutes';
 return found;
end $$;

create function public.sellerpilot_complete_cs_reply_draft(p_token_hash text,p_id uuid,p_claim_token uuid,p_status text,p_result jsonb default null,p_error text default null)
returns text language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.cs_reply_draft_jobs%rowtype; latest_key text;
begin
 if sellerpilot_private.worker_token_has_scope(p_token_hash,'ai',true) is distinct from true then raise exception 'CS worker authentication required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('succeeded','failed') then raise exception 'invalid CS completion' using errcode='22023'; end if;
 -- Match enqueue's ticket-before-job lock order to avoid a retry/completion deadlock.
 select * into j from sellerpilot_private.cs_reply_draft_jobs where id=p_id;
 if not found then return 'lease_lost'; end if;
 select latest_inbound_key into latest_key from sellerpilot_private.support_tickets where id=j.ticket_id and not demo for share;
 select * into j from sellerpilot_private.cs_reply_draft_jobs where id=p_id for update;
 if not found or j.claim_token is distinct from p_claim_token or j.worker_token_hash is distinct from p_token_hash then return 'lease_lost'; end if;
 if j.status in ('succeeded','failed') then
  if j.status=p_status and j.result_payload is not distinct from p_result and j.error_message is not distinct from left(p_error,500) then return 'replayed'; end if;
  raise exception 'CS_DRAFT_COMPLETION_REPLAY_MISMATCH' using errcode='55000';
 end if;
 if j.status<>'running' or j.lease_expires_at<=clock_timestamp() then return 'lease_lost'; end if;
 if latest_key is distinct from j.inbound_key then
  update sellerpilot_private.cs_reply_draft_jobs set status='failed',error_message='INQUIRY_CONTEXT_STALE',lease_expires_at=null,updated_at=clock_timestamp(),completed_at=clock_timestamp() where id=j.id;
  return 'stale';
 end if;
 if p_status='succeeded' and (p_result is null or jsonb_typeof(p_result)<>'object' or p_result->>'mode' is distinct from 'support-reply'
  or p_result->>'targetLocale' is distinct from j.request_payload->>'target_locale' or length(coalesce(p_result->>'draft','')) not between 10 and 4000) then
  raise exception 'CS_DRAFT_RESULT_INVALID' using errcode='22023'; end if;
 update sellerpilot_private.cs_reply_draft_jobs set status=p_status,result_payload=p_result,error_message=left(p_error,500),lease_expires_at=null,updated_at=clock_timestamp(),completed_at=clock_timestamp() where id=j.id;
 return 'completed';
end $$;

revoke all on function public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text), public.sellerpilot_get_cs_reply_draft(uuid), public.sellerpilot_cancel_cs_reply_draft(uuid) from public,anon,service_role;
grant execute on function public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text), public.sellerpilot_get_cs_reply_draft(uuid), public.sellerpilot_cancel_cs_reply_draft(uuid) to authenticated;
revoke all on function public.sellerpilot_claim_cs_reply_draft(text),public.sellerpilot_touch_cs_reply_draft(text,uuid,uuid),public.sellerpilot_complete_cs_reply_draft(text,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_claim_cs_reply_draft(text),public.sellerpilot_touch_cs_reply_draft(text,uuid,uuid),public.sellerpilot_complete_cs_reply_draft(text,uuid,uuid,text,jsonb,text) to service_role;

-- One-time adoption only. Historical product tables are not a runtime dependency.
-- Keep old rows as provenance, revoke their active leases atomically, and move
-- only support_reply rows into the CS-owned queue. No product job is changed.
do $$
begin
 if to_regclass('sellerpilot_private.ai_cli_jobs') is not null then
  lock table sellerpilot_private.ai_cli_jobs in share row exclusive mode;
  insert into sellerpilot_private.cs_reply_draft_jobs(id,ticket_id,requested_by,inbound_key,request_payload,status,result_payload,error_message,created_at,updated_at,completed_at)
  select j.id,t.id,j.created_by,coalesce(nullif(j.request_payload->>'sellerpilotInboundKey',''),'legacy-inbound-unavailable'),
   (j.request_payload-'order')||jsonb_build_object('order',null),
   case when nullif(j.request_payload->>'sellerpilotInboundKey','') is null then 'failed'
    when j.status in ('queued','running') then 'queued' else j.status end,
   case when j.status='succeeded' then j.result_payload else null end,
   case when nullif(j.request_payload->>'sellerpilotInboundKey','') is null then 'INQUIRY_CONTEXT_STALE'
    when j.status in ('queued','running') then null else j.error_message end,
   j.created_at,clock_timestamp(),case when j.status in ('queued','running') then null else j.completed_at end
  from sellerpilot_private.ai_cli_jobs j join sellerpilot_private.support_tickets t on t.id::text=j.request_payload->>'ticket_id'
  where j.kind='support_reply' and not t.demo
  on conflict(id) do nothing;
  update sellerpilot_private.ai_cli_jobs j set status='cancelled',lease_expires_at=null,
   error_message='CS_DRAFT_MOVED_TO_DEDICATED_QUEUE',updated_at=clock_timestamp(),completed_at=clock_timestamp()
  where j.kind='support_reply' and j.status in ('queued','running')
   and exists(select 1 from sellerpilot_private.cs_reply_draft_jobs c where c.id=j.id);
 end if;
end $$;

-- Preserve the public RPC signature for old integrations while ensuring that
-- all newly requested drafts enter only the CS queue.
create or replace function public.sellerpilot_create_support_reply_job(p_id uuid,p_ticket_id uuid,p_expected_inbound_key text,p_target_locale text,p_tone text default 'polite')
returns uuid language sql security definer set search_path='' as $$
 select public.sellerpilot_create_cs_reply_draft(p_id,p_ticket_id,p_expected_inbound_key,p_target_locale,p_tone)
$$;
revoke all on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
