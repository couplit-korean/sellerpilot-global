-- Follow-up to 20260905012000+12100. Do not rewrite applied history.
-- The exact local GET binder proved sellerPrdCd + prdNo 9598600918, then the
-- observation RPC rolled back with SQLSTATE 57014 at the authenticator's 8s
-- default. Keep that global default. Give only the three exact, service_role-
-- only 11st recovery RPCs a bounded function-local window.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500147);

do $guard$
declare
  v_get text;
  v_record text;
  v_bind text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)'::regprocedure
  ) into v_get;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_record_elevenst_cookie_create_observation(uuid,text,text,integer,integer,boolean,boolean,text)'::regprocedure
  ) into v_record;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)'::regprocedure
  ) into v_bind;

  if strpos(v_get, 'b9faa28e-a73f-4457-bb34-d643cf9a9a74') = 0
     or strpos(v_record, '9598600918') = 0
     or strpos(v_record, 'AUTO-780720401E2D4E4EA45F') = 0
     or strpos(v_bind, 'elevenst_cookie_create_jobs_are_current()') = 0
     or strpos(v_bind, 'sourceJobRewritten'', false') = 0
  then
    raise exception 'exact 11st GET-only recovery RPC preimage drifted'
      using errcode = '55000';
  end if;
end
$guard$;

alter function
  public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid)
  set statement_timeout = '60s';
alter function
  public.sellerpilot_service_record_elevenst_cookie_create_observation(
    uuid,text,text,integer,integer,boolean,boolean,text
  ) set statement_timeout = '60s';
alter function
  public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid)
  set statement_timeout = '60s';

comment on function
  public.sellerpilot_service_get_elevenst_cookie_create_recovery_status(uuid) is
  'Exact service_role-only 11st GET recovery status; function-local 60s timeout keeps the authenticator global default at 8s.';
comment on function
  public.sellerpilot_service_record_elevenst_cookie_create_observation(
    uuid,text,text,integer,integer,boolean,boolean,text
  ) is
  'Records only GET-proven sellerPrdCd AUTO-780720401E2D4E4EA45F + prdNo 9598600918; function-local 60s timeout; never rewrites the source create job.';
comment on function
  public.sellerpilot_service_bind_elevenst_cookie_create_observation(uuid) is
  'Binds only the immutable exact 11st GET observation; function-local 60s timeout; never calls listing.create or rewrites b9faa28e.';

commit;
