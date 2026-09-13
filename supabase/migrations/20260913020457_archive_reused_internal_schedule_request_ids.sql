-- Extend the existing CS wake receipt archival strategy to the five internal
-- schedules. No sequence rewind, dropped history, or marketplace job mutation.
begin;
create table sellerpilot_private.internal_schedule_request_archives(
  archive_id bigint generated always as identity primary key,
  archived_at timestamptz not null default clock_timestamp(),
  archive_reason text not null default 'pg_net_request_id_reused' check(archive_reason='pg_net_request_id_reused'),
  request_id bigint not null,route_key text not null,requested_at timestamptz not null,
  resolved_at timestamptz not null,outcome text not null check(outcome<>'queued'),
  http_status integer,timed_out boolean,safe_error_code text
);
create index internal_schedule_request_archives_request_idx
  on sellerpilot_private.internal_schedule_request_archives(request_id,archived_at desc);
alter table sellerpilot_private.internal_schedule_request_archives enable row level security;
revoke all on sellerpilot_private.internal_schedule_request_archives from public,anon,authenticated,service_role;
revoke all on sequence sellerpilot_private.internal_schedule_request_archives_archive_id_seq from public,anon,authenticated,service_role;
do $archive$
declare v_definition text;v_source text;
 v_old text:=$old$  insert into sellerpilot_private.internal_schedule_requests (
    request_id, route_key, requested_at
  ) values (
    v_request_id, p_route_key, clock_timestamp()
  );$old$;
 v_new text:=$new$  -- pg_net IDs can repeat after its unlogged queue restarts. Preserve the
  -- resolved historical receipt before binding the reused ID to this request.
  declare
    v_requested_at timestamptz:=clock_timestamp();
    v_archived integer;
    v_reset integer;
  begin
    insert into sellerpilot_private.internal_schedule_requests(request_id,route_key,requested_at)
      values(v_request_id,p_route_key,v_requested_at);
  exception when unique_violation then
    insert into sellerpilot_private.internal_schedule_request_archives(
      request_id,route_key,requested_at,resolved_at,outcome,http_status,timed_out,safe_error_code
    ) select request_id,route_key,requested_at,resolved_at,outcome,http_status,timed_out,safe_error_code
        from sellerpilot_private.internal_schedule_requests
       where request_id=v_request_id and outcome<>'queued' and resolved_at is not null;
    get diagnostics v_archived=row_count;
    if v_archived<>1 then
      raise exception 'INTERNAL_SCHEDULE_REQUEST_ID_IN_FLIGHT' using errcode='55000';
    end if;
    update sellerpilot_private.internal_schedule_requests
       set route_key=p_route_key,requested_at=v_requested_at,resolved_at=null,
           outcome='queued',http_status=null,timed_out=null,safe_error_code=null
     where request_id=v_request_id and outcome<>'queued' and resolved_at is not null;
    get diagnostics v_reset=row_count;
    if v_reset<>1 then
      raise exception 'INTERNAL_SCHEDULE_REQUEST_ID_IN_FLIGHT' using errcode='55000';
    end if;
    delete from net._http_response where id=v_request_id and created<v_requested_at;
  end;$new$;
begin
 select prosrc,pg_get_functiondef(oid) into v_source,v_definition from pg_proc
  where oid='sellerpilot_private.schedule_internal_route(text)'::regprocedure;
 if md5(v_source)<>'884a05c82e3b1525a6ef914bc1cf6cd2' then
   raise exception 'INTERNAL_SCHEDULE_ARCHIVE_PREIMAGE_MISMATCH';
 end if;
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
   raise exception 'INTERNAL_SCHEDULE_ARCHIVE_ANCHOR_MISMATCH';
 end if;
 execute replace(v_definition,v_old,v_new);
end;
$archive$;
commit;
