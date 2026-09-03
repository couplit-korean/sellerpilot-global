-- Keep the exact Qoo10 localization status endpoint readable before the first
-- v2 source, verifier, activation permit, or outcome exists. PL/pgSQL records
-- that are skipped by conditional SELECT INTO statements have no tuple
-- descriptor, so even reading one of their fields raises SQLSTATE 55000.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 908100001);

do $initialize_qoo10_release_status_records$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.sellerpilot_service_get_exact_qoo10_localization_release_status(uuid,uuid,text)'
  );
  v_definition text;
  v_rewritten text;
  v_anchor constant text := $status_anchor$  end if;

  select job.id,job.status,job.request_fingerprint,job.created_at,job.completed_at
    into v_source$status_anchor$;
  v_replacement constant text := $status_replacement$  end if;

  -- Assign tuple descriptors before any conditional SELECT INTO can be
  -- skipped. Later SELECT INTO statements overwrite these typed null rows.
  select null::uuid as verifier_job_id,
         null::text as status,
         null::text as release_sha,
         null::timestamptz as completed_at
    into v_verifier;
  select null::uuid as activation_job_id,
         null::text as status,
         null::timestamptz as armed_at,
         null::timestamptz as expires_at,
         null::timestamptz as bound_at,
         null::timestamptz as consumed_at,
         null::timestamptz as invalidated_at
    into v_permit;
  select null::text as terminal_status,
         null::text as provider_status,
         null::text as remote_visibility,
         null::timestamptz as verified_at,
         null::timestamptz as completed_at
    into v_outcome;

  select job.id,job.status,job.request_fingerprint,job.created_at,job.completed_at
    into v_source$status_replacement$;
  v_anchor_count integer;
begin
  if v_signature is null then
    raise exception 'exact Qoo10 localization release status function is missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;

  if pg_catalog.strpos(pg_catalog.lower(v_definition),
       'null::uuid as verifier_job_id') <> 0
     and pg_catalog.strpos(pg_catalog.lower(v_definition),
       'null::uuid as activation_job_id') <> 0
     and pg_catalog.strpos(pg_catalog.lower(v_definition),
       'null::text as terminal_status') <> 0
  then
    return;
  end if;

  v_anchor_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  if v_anchor_count <> 1 then
    raise exception 'exact Qoo10 localization release status preimage drifted'
      using errcode = '55000';
  end if;

  v_rewritten := pg_catalog.replace(v_definition, v_anchor, v_replacement);
  execute v_rewritten;
end;
$initialize_qoo10_release_status_records$;

-- CREATE OR REPLACE preserves the existing owner and ACL, but reassert the
-- intended service-only boundary explicitly because this is a public-schema
-- SECURITY DEFINER function.
revoke all on function
  public.sellerpilot_service_get_exact_qoo10_localization_release_status(
    uuid, uuid, text
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_exact_qoo10_localization_release_status(
    uuid, uuid, text
  )
  to service_role;

do $qoo10_release_status_records_postimage$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.sellerpilot_service_get_exact_qoo10_localization_release_status(uuid,uuid,text)'
  );
  v_definition text;
begin
  if v_signature is null then
    raise exception 'exact Qoo10 localization release status postimage missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
  if pg_catalog.strpos(pg_catalog.lower(v_definition),
       'null::uuid as verifier_job_id') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_definition),
       'null::uuid as activation_job_id') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_definition),
       'null::text as terminal_status') = 0
  then
    raise exception 'exact Qoo10 localization status initializers missing'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_proc procedure
     where procedure.oid = v_signature
       and procedure.prosecdef
       and procedure.provolatile = 's'::"char"
       and procedure.proconfig = array['search_path=""']::text[]
  ) then
    raise exception 'exact Qoo10 localization status function flags drifted'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from (values
        ('public'::name),
        ('anon'::name),
        ('authenticated'::name)
      ) role(role_name)
     where pg_catalog.has_function_privilege(
       role.role_name,
       v_signature,
       'EXECUTE'
     )
  ) then
    raise exception 'exact Qoo10 localization status public ACL drifted'
      using errcode = '55000';
  end if;
  if not pg_catalog.has_function_privilege(
    'service_role',
    v_signature,
    'EXECUTE'
  ) then
    raise exception 'exact Qoo10 localization status service ACL drifted'
      using errcode = '55000';
  end if;

  -- The status RPC is STABLE and read-only. This exercises the empty/partial
  -- chain that previously failed before the API could return its JSON status.
  perform public.sellerpilot_service_get_exact_qoo10_localization_release_status(
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid,
    pg_catalog.repeat('0', 40)
  );
end;
$qoo10_release_status_records_postimage$;

commit;
