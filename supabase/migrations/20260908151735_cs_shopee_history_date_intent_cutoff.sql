-- Follow-up to the frozen request invariants migration. The public route sends
-- calendar intent to v2; PostgreSQL owns the first cutoff and reuses it after
-- response loss, including when a same-date retry crosses KST midnight.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.cs_shopee_history_start_requests') is null
     or to_regprocedure('public.sellerpilot_service_start_cs_shopee_history_v1(uuid,uuid,bigint,bigint)') is null then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_PREIMAGE_REQUIRED';
  end if;
end $$;

create table sellerpilot_private.cs_shopee_history_request_intents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  from_date date not null,
  to_date date not null,
  from_epoch bigint not null check (from_epoch > 0),
  cutoff_epoch bigint not null check (cutoff_epoch > from_epoch),
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,request_key),
  check (to_date >= from_date),
  check (to_date-from_date <= 3650)
);

alter table sellerpilot_private.cs_shopee_history_request_intents enable row level security;
revoke all on sellerpilot_private.cs_shopee_history_request_intents
  from public,anon,authenticated,service_role;

-- Preserve an exact cutoff for any local row created between the preceding
-- invariant migration and this follow-up.
insert into sellerpilot_private.cs_shopee_history_request_intents(
  owner_id,request_key,from_date,to_date,from_epoch,cutoff_epoch,created_at
)
select request.owner_id,request.request_key,
       (pg_catalog.to_timestamp(request.from_epoch) at time zone 'Asia/Seoul')::date,
       (pg_catalog.to_timestamp(request.to_epoch) at time zone 'Asia/Seoul')::date,
       request.from_epoch,request.to_epoch,request.created_at
  from sellerpilot_private.cs_shopee_history_start_requests request
on conflict(owner_id,request_key) do nothing;

create function public.sellerpilot_service_start_cs_shopee_history_v2(
  p_owner_id uuid,
  p_request_key uuid,
  p_from_date date,
  p_to_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_today date;
  v_from_epoch bigint;
  v_candidate_cutoff bigint;
  v_intent sellerpilot_private.cs_shopee_history_request_intents%rowtype;
begin
  v_today:=(v_now at time zone 'Asia/Seoul')::date;
  if p_owner_id is null or p_request_key is null or p_from_date is null or p_to_date is null
     or p_from_date>p_to_date or p_to_date>v_today or p_to_date-p_from_date>3650 then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_INVALID' using errcode='22023';
  end if;
  v_from_epoch:=floor(extract(epoch from
    (p_from_date::timestamp at time zone 'Asia/Seoul')))::bigint;
  v_candidate_cutoff:=case when p_to_date=v_today
    then floor(extract(epoch from v_now))::bigint
    else floor(extract(epoch from
      (((p_to_date+1)::timestamp at time zone 'Asia/Seoul')-interval '1 second')))::bigint end;
  if v_from_epoch<1 or v_candidate_cutoff<=v_from_epoch
     or v_candidate_cutoff-v_from_epoch>315360000 then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_INVALID' using errcode='22023';
  end if;

  insert into sellerpilot_private.cs_shopee_history_request_intents(
    owner_id,request_key,from_date,to_date,from_epoch,cutoff_epoch
  ) values(p_owner_id,p_request_key,p_from_date,p_to_date,v_from_epoch,v_candidate_cutoff)
  on conflict(owner_id,request_key) do nothing;

  select intent.* into v_intent
    from sellerpilot_private.cs_shopee_history_request_intents intent
   where intent.owner_id=p_owner_id and intent.request_key=p_request_key
   for update;
  if not found or v_intent.from_date is distinct from p_from_date
     or v_intent.to_date is distinct from p_to_date
     or v_intent.from_epoch is distinct from v_from_epoch then
    raise exception 'SHOPEE_HISTORY_DATE_INTENT_REUSE_MISMATCH' using errcode='23514';
  end if;

  return public.sellerpilot_service_start_cs_shopee_history_v1(
    p_owner_id,p_request_key,v_intent.from_epoch,v_intent.cutoff_epoch
  );
end $$;

revoke all on function public.sellerpilot_service_start_cs_shopee_history_v1(
  uuid,uuid,bigint,bigint
) from public,anon,authenticated,service_role;
revoke all on function public.sellerpilot_service_start_cs_shopee_history_v2(
  uuid,uuid,date,date
) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_start_cs_shopee_history_v2(
  uuid,uuid,date,date
) to service_role;

commit;
