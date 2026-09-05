-- Apply only after inspecting the live definitions/ACLs of the two wrapped
-- functions. No historical SQL is rewritten. Deploy this before the TS change.
-- Preflight (read only):
-- select p.oid::regprocedure, p.prosecdef, p.proacl, pg_get_functiondef(p.oid)
-- from pg_proc p where p.oid in (
-- 'public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'::regprocedure,
-- 'public.sellerpilot_prune_personal_data(timestamptz)'::regprocedure);
begin;
do $$
begin
  if to_regprocedure('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_prune_personal_data(timestamptz)') is null then
    raise exception 'LAZADA_QUARANTINE_PREREQUISITE_REQUIRED';
  end if;
  if position('v_seller_events' in pg_get_functiondef('public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'::regprocedure)) = 0
     or position('support_pending_seller_messages' in pg_get_functiondef('public.sellerpilot_prune_personal_data(timestamptz)'::regprocedure)) = 0 then
    raise exception 'LAZADA_QUARANTINE_LIVE_DEFINITION_REVIEW_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.lazada_unordered_messages (
  owner_id uuid not null references auth.users(id) on delete cascade,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  external_ticket_id text not null check (length(external_ticket_id) between 1 and 240),
  remote_message_id text not null check (length(remote_message_id) between 1 and 240),
  body_digest text not null,
  sender_role text not null check(sender_role in ('customer','seller')),
  body text not null check (length(body) between 1 and 20000 and octet_length(body) <= 60000),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (owner_id, seller_account_key, external_ticket_id, remote_message_id, body_digest, sender_role),
  check (expires_at = observed_at + interval '7 days')
);
comment on table sellerpilot_private.lazada_unordered_messages is
  'Seller text with unknown send time, never an inbound/reply/approval event. Minimal original body, no customer names or provider envelope. Seven-day observation retention; no replay extension. Max 1000 rows per owner. Explicit operator review only, no automatic promotion.';
alter table sellerpilot_private.lazada_unordered_messages enable row level security;
revoke all on sellerpilot_private.lazada_unordered_messages from public, anon, authenticated, service_role;
create index lazada_unordered_expiry_idx on sellerpilot_private.lazada_unordered_messages(expires_at);
-- Retain an owner-scoped digest until 90 days after first observation, including
-- after body deletion, so replay cannot restart the seven-day window. No raw IDs.
create table sellerpilot_private.lazada_unordered_dedup (
  owner_id uuid not null references auth.users(id) on delete cascade,
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  first_observed_at timestamptz not null default now(),
  first_body_digest text not null,
  first_sender_role text not null,
  conflicted boolean not null default false,
  storage_status text not null default 'pending' check(storage_status in ('pending','stored','expired_unstored')),
  primary key(owner_id,identity_digest)
);
alter table sellerpilot_private.lazada_unordered_dedup enable row level security;
revoke all on sellerpilot_private.lazada_unordered_dedup from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
  rename to sellerpilot_202609051400_ingest_inquiries;
revoke all on function public.sellerpilot_202609051400_ingest_inquiries(uuid,text,jsonb)
  from public, anon, authenticated, service_role;


-- JSON V2 commits normal messages independently of bounded quarantine failure.
create function public.sellerpilot_service_ingest_lazada_inquiries_v2(p_credential_id uuid,p_inquiries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
 v_owner uuid; v_account text; v_cert boolean; e jsonb; normals jsonb:='[]'::jsonb;
 tid text; mid text; body text; role text; digest text; bh text; seen record;
 conflict boolean; quarantine boolean; conflicts jsonb; valid_time boolean;
 nc integer:=0; qc integer:=0; pc integer:=0; cc integer:=0; ec integer:=0; retained integer; tombstones integer;
begin
 if jsonb_typeof(p_inquiries) is distinct from 'array' or jsonb_array_length(p_inquiries)>10000 then raise exception 'LAZADA_INGEST_BATCH_INVALID'; end if;
 select c.created_by,c.seller_account_key,c.seller_account_key_source='provider_certified_v1' into v_owner,v_account,v_cert
 from sellerpilot_private.channel_credentials c where c.id=p_credential_id and c.channel='lazada' and c.status in ('active','grace');
 if v_owner is null then raise exception 'active channel credential required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lazada-unordered:'||v_owner::text,0));
 delete from sellerpilot_private.lazada_unordered_messages where owner_id=v_owner and expires_at<=now();
 delete from sellerpilot_private.lazada_unordered_dedup where owner_id=v_owner and first_observed_at<=now()-interval '90 days';
 select count(*) into retained from sellerpilot_private.lazada_unordered_messages where owner_id=v_owner;
 select count(*) into tombstones from sellerpilot_private.lazada_unordered_dedup where owner_id=v_owner;
 select coalesce(jsonb_object_agg(k,true),'{}'::jsonb) into conflicts from (
   select jsonb_build_array(trim(x->>'externalTicketId'),trim(x->>'remoteMessageId'))::text k from jsonb_array_elements(p_inquiries) x
   group by 1 having count(distinct jsonb_build_array(coalesce(x->>'senderRole','customer'),x->>'message'))>1
 ) grouped;
 for e in select value from jsonb_array_elements(p_inquiries) loop
   tid:=trim(e->>'externalTicketId'); mid:=trim(e->>'remoteMessageId'); body:=e->>'message'; role:=coalesce(e->>'senderRole','customer');
   if jsonb_typeof(e->'message') is distinct from 'string' or body is null or length(body) not between 1 and 20000 or octet_length(body)>60000
      or tid is null or tid not like 'lazada-im:%' or length(tid) not between 11 and 240 or mid is null or length(mid) not between 1 and 240
      or role not in ('customer','seller') then pc:=pc+1; continue; end if;
   if e->>'orderingStatus'='unverified' and (role<>'seller' or coalesce(e->>'receivedAt','')<>'') then pc:=pc+1; continue; end if;
   digest:=encode(extensions.digest(jsonb_build_array(v_owner,v_account,tid,mid)::text,'sha256'),'hex');
   bh:=encode(extensions.digest(body,'sha256'),'hex');
   select * into seen from sellerpilot_private.lazada_unordered_dedup d where d.owner_id=v_owner and d.identity_digest=digest;
   conflict:=coalesce(seen.conflicted,false) or (seen.identity_digest is not null and (seen.first_body_digest<>bh or seen.first_sender_role<>role))
     or conflicts ? jsonb_build_array(tid,mid)::text or coalesce(e->>'orderingStatus'='conflict',false);
   conflict:=conflict or exists(
     select 1 from sellerpilot_private.support_inbound_messages m join sellerpilot_private.support_tickets t on t.id=m.ticket_id
     join sellerpilot_private.channel_credentials c on c.id=t.source_credential_id
     where m.owner_id=v_owner and m.channel_key='lazada' and t.external_ticket_id=tid and m.remote_message_id=mid
       and c.seller_account_key=v_account and (m.body<>body or m.sender_role<>role)
   ) or exists(select 1 from sellerpilot_private.lazada_unordered_messages q where q.owner_id=v_owner and q.seller_account_key=v_account
      and q.external_ticket_id=tid and q.remote_message_id=mid and (q.body<>body or q.sender_role<>role));
   valid_time:=coalesce(e->>'receivedAt','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$';
   if valid_time then
     begin perform (e->>'receivedAt')::timestamptz;
     exception when invalid_datetime_format or datetime_field_overflow then valid_time:=false;
     end;
   end if;
   quarantine:=conflict or coalesce(e->>'orderingStatus'='unverified',false) or not valid_time;
   if quarantine then
     if conflict then cc:=cc+1; end if;
     if v_account is null or not coalesce(v_cert,false) then pc:=pc+1; continue; end if;
     if seen.identity_digest is null then
       if tombstones>=10000 then pc:=pc+1; continue; end if;
       insert into sellerpilot_private.lazada_unordered_dedup(owner_id,identity_digest,first_body_digest,first_sender_role,conflicted)
       values(v_owner,digest,bh,role,conflict); tombstones:=tombstones+1;
     else
       if conflict then update sellerpilot_private.lazada_unordered_dedup set conflicted=true where owner_id=v_owner and identity_digest=digest; end if;
       if seen.first_observed_at<=now()-interval '7 days' then
         if seen.storage_status<>'stored' then
           update sellerpilot_private.lazada_unordered_dedup set storage_status='expired_unstored' where owner_id=v_owner and identity_digest=digest;
           ec:=ec+1;
         end if;
         continue;
       end if;
     end if;
     if exists(select 1 from sellerpilot_private.lazada_unordered_messages q where q.owner_id=v_owner and q.seller_account_key=v_account
       and q.external_ticket_id=tid and q.remote_message_id=mid and q.body_digest=bh and q.sender_role=role) then qc:=qc+1; continue; end if;
     if retained>=1000 then
       update sellerpilot_private.lazada_unordered_dedup set storage_status='pending' where owner_id=v_owner and identity_digest=digest;
       pc:=pc+1; continue;
     end if;
     insert into sellerpilot_private.lazada_unordered_messages(owner_id,seller_account_key,external_ticket_id,remote_message_id,body_digest,sender_role,body,observed_at,expires_at)
       select v_owner,v_account,tid,mid,bh,role,body,first_observed_at,first_observed_at+interval '7 days'
       from sellerpilot_private.lazada_unordered_dedup where owner_id=v_owner and identity_digest=digest;
     update sellerpilot_private.lazada_unordered_dedup set storage_status='stored' where owner_id=v_owner and identity_digest=digest;
     retained:=retained+1; qc:=qc+1;
   else normals:=normals||jsonb_build_array(e); end if;
 end loop;
 if jsonb_array_length(normals)>0 then nc:=public.sellerpilot_202609051400_ingest_inquiries(p_credential_id,'lazada',normals); end if;
 return jsonb_build_object('contract','lazada_ingest_v2','status',case when pc+cc+ec>0 then 'partial' else 'complete' end,
  'normalCount',nc,'quarantinedCount',qc,'pendingCount',pc,'conflictCount',cc,'expiredUnstoredCount',ec,
  'retryAfterSeconds',300,'retentionDays',7,
  'retryPolicy','replay original unresolved events within first-observation 7-day window; conflicts/expired unstored require operator review; never auto reply');
end $$;
revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb) to service_role;

-- Integer ABI unchanged. Only the upgraded JSON receivers can represent and
-- commit partial ingestion. Old clients cannot mistake partial for a count.
create function public.sellerpilot_service_ingest_inquiries(p_credential_id uuid,p_channel text,p_inquiries jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
 if p_channel<>'lazada' then return public.sellerpilot_202609051400_ingest_inquiries(p_credential_id,p_channel,p_inquiries); end if;
 r:=public.sellerpilot_service_ingest_lazada_inquiries_v2(p_credential_id,p_inquiries);
 if r->>'status'<>'complete' then raise exception 'LAZADA_PARTIAL_REQUIRES_JSON_INGEST_V2'; end if;
 return (r->>'normalCount')::integer+(r->>'quarantinedCount')::integer;
end $$;
revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) to service_role;

-- Ingest in a separate, ownership-validated transaction. On partial the job
-- remains uncompleted. On complete the caller passes [] to the existing final
-- transaction; a replay is idempotent and cannot bypass lease/token validation.
create function public.sellerpilot_service_ingest_lazada_gateway_v2(p_token_hash text,p_job_id uuid,p_claim_token uuid,p_inquiries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb; r jsonb; pending jsonb; fingerprint text;
begin
 c:=public.sellerpilot_service_gateway_completion_context(p_token_hash,p_job_id,p_claim_token);
 if c is null or c->>'channel'<>'lazada' or c->>'operation'<>'inquiries.list' or c->>'status' not in ('running','completed_replay') then raise exception 'LAZADA_INGEST_CLAIM_REQUIRED'; end if;
 if c->>'status'='completed_replay' then return jsonb_build_object('contract','lazada_ingest_v2','status','complete','alreadyApplied',true); end if;
 select response_payload->'lazadaIngestionPending' into pending from sellerpilot_private.channel_gateway_jobs where id=p_job_id for update;
 select encode(extensions.digest(coalesce(jsonb_agg(e order by e::text),'[]'::jsonb)::text,'sha256'),'hex') into fingerprint from jsonb_array_elements(p_inquiries) e;
 r:=public.sellerpilot_service_ingest_lazada_inquiries_v2((c->>'credential_id')::uuid,p_inquiries);
 -- A retry omitting the earlier unstored originals cannot turn a partial job
 -- into success. Commit its independent normal messages, but require the
 -- original normalized batch (or explicit operator reconciliation).
 if pending is not null and (pending->>'fingerprint'<>fingerprint or (pending->>'expiresAt')::timestamptz<=now()) then
   return r||jsonb_build_object('status','partial','originalBatchRequired',true);
 end if;
 if r->>'status'='partial' then
   -- This is an ownership-validated running Lazada read, never a reply job.
   -- Keep only a bounded digest/deadline receipt, not provider bodies/PII. A
   -- later successful completion writes the usual sanitized read receipt.
   update sellerpilot_private.channel_gateway_jobs set response_payload=jsonb_build_object('lazadaIngestionPending',
     coalesce(pending,jsonb_build_object('fingerprint',fingerprint,'firstObservedAt',now(),'expiresAt',now()+interval '7 days'))),updated_at=now()
     where id=p_job_id;
 elsif pending is not null then
   update sellerpilot_private.channel_gateway_jobs set response_payload=response_payload-'lazadaIngestionPending',updated_at=now() where id=p_job_id;
 end if;
 return r;
end $$;
revoke all on function public.sellerpilot_service_ingest_lazada_gateway_v2(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_lazada_gateway_v2(text,uuid,uuid,jsonb) to service_role;

-- Read-only readiness fence for new server code against an old database.
create function public.sellerpilot_service_lazada_quarantine_ready()
returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
revoke all on function public.sellerpilot_service_lazada_quarantine_ready() from public,anon,authenticated;
grant execute on function public.sellerpilot_service_lazada_quarantine_ready() to service_role;

-- Integrate with the existing retention invocation, without creating a job.
alter function public.sellerpilot_prune_personal_data(timestamptz) rename to sellerpilot_202609051400_prune_personal_data;
revoke all on function public.sellerpilot_202609051400_prune_personal_data(timestamptz) from public,anon,authenticated,service_role;
create function public.sellerpilot_prune_personal_data(p_completed_before timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_deleted integer;
begin
  v_result := public.sellerpilot_202609051400_prune_personal_data(p_completed_before);
  delete from sellerpilot_private.lazada_unordered_messages where expires_at <= now();
  get diagnostics v_deleted = row_count;
  delete from sellerpilot_private.lazada_unordered_dedup where first_observed_at <= now()-interval '90 days';
  return v_result || jsonb_build_object('lazadaUnorderedMessagesDeleted',v_deleted);
end $$;
revoke all on function public.sellerpilot_prune_personal_data(timestamptz) from public,anon,authenticated;
grant execute on function public.sellerpilot_prune_personal_data(timestamptz) to service_role;
commit;
