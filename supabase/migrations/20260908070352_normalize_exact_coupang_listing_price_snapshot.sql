-- Preserve the numeric(14,2) representation used by product_listings.price
-- when building the immutable listing postimage. PostgreSQL jsonb equality
-- treats 3190 and 3190.00 as equal, but jsonb::text preserves the numeric
-- scale and therefore produces different SHA-256 digests. Only the exact
-- recorder and its already-installed reaper completion hash pin are changed.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072067);

do $preflight$
declare
  recorder_definition text;
  recovery_definition text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'COUPANG_PRICE_SNAPSHOT_OWNER_INVALID'
      using errcode = '42501';
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.record_coupang_exact_post_price_completion(uuid)'::regprocedure
  ) into strict recorder_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)'::regprocedure
  ) into strict recovery_definition;
  if encode(extensions.digest(recorder_definition, 'sha256'), 'hex') <>
       'c78c6f8adc8acb860387091f7dad1e5594b25aa815c36d1adc57dbda650e2de3'
     or encode(extensions.digest(recovery_definition, 'sha256'), 'hex') <>
       'e235bb0f6cb7e87e49bd85c42e3d4888be9f78ac22c0203559fb6a44317d760a'
     or pg_catalog.format_type(
       (
         select attribute.atttypid
           from pg_catalog.pg_attribute attribute
          where attribute.attrelid =
            'sellerpilot_private.product_listings'::regclass
            and attribute.attname = 'price'
       ),
       (
         select attribute.atttypmod
           from pg_catalog.pg_attribute attribute
          where attribute.attrelid =
            'sellerpilot_private.product_listings'::regclass
            and attribute.attname = 'price'
       )
     ) <> 'numeric(14,2)'
     or (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid
          and encode(
            extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex'
          ) = '6a4dd03a0d9a8d7a0e34a4d61c30c79589f465a40a7142eecd531031c7800493'
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id =
          '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid
     )
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_verify_receipts receipt
        where receipt.verifier_job_id =
          '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid
     )
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_reaper_completions receipt
        where receipt.verifier_job_id =
          '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid
     ) then
    raise exception 'COUPANG_PRICE_SNAPSHOT_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

do $install$
declare
  old_recorder_definition text;
  new_recorder_definition text;
  installed_recorder_definition text;
  old_recovery_definition text;
  new_recovery_definition text;
  installed_recovery_definition text;
  old_price_fragment constant text :=
    $old$'price', run.desired_price,
    'updated_at', projection_at$old$;
  new_price_fragment constant text :=
    $new$'price', run.desired_price::numeric(14,2),
    'updated_at', projection_at$new$;
  old_recorder_sha constant text :=
    'c78c6f8adc8acb860387091f7dad1e5594b25aa815c36d1adc57dbda650e2de3';
  new_recorder_sha constant text :=
    '2c4937db26550e697ed326886dc1fcb44ae36c7974054591e3c99a84fd8878b3';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.record_coupang_exact_post_price_completion(uuid)'::regprocedure
  ) into strict old_recorder_definition;
  if (
       pg_catalog.length(old_recorder_definition)
       - pg_catalog.length(pg_catalog.replace(
           old_recorder_definition, old_price_fragment, ''
         ))
     ) / pg_catalog.length(old_price_fragment) <> 1
     or pg_catalog.strpos(
       old_recorder_definition, new_price_fragment
     ) <> 0 then
    raise exception 'COUPANG_PRICE_SNAPSHOT_RECORDER_FRAGMENT_DRIFT'
      using errcode = '55000';
  end if;
  new_recorder_definition := pg_catalog.replace(
    old_recorder_definition, old_price_fragment, new_price_fragment
  );
  execute new_recorder_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.record_coupang_exact_post_price_completion(uuid)'::regprocedure
  ) into strict installed_recorder_definition;
  if installed_recorder_definition is distinct from new_recorder_definition
     or encode(
       extensions.digest(installed_recorder_definition, 'sha256'), 'hex'
     ) <> new_recorder_sha then
    raise exception 'COUPANG_PRICE_SNAPSHOT_RECORDER_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)'::regprocedure
  ) into strict old_recovery_definition;
  if (
       pg_catalog.length(old_recovery_definition)
       - pg_catalog.length(pg_catalog.replace(
           old_recovery_definition, old_recorder_sha, ''
         ))
     ) / pg_catalog.length(old_recorder_sha) <> 1
     or pg_catalog.strpos(old_recovery_definition, new_recorder_sha) <> 0 then
    raise exception 'COUPANG_PRICE_SNAPSHOT_RECOVERY_FRAGMENT_DRIFT'
      using errcode = '55000';
  end if;
  new_recovery_definition := pg_catalog.replace(
    old_recovery_definition, old_recorder_sha, new_recorder_sha
  );
  execute new_recovery_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)'::regprocedure
  ) into strict installed_recovery_definition;
  if installed_recovery_definition is distinct from new_recovery_definition
     or encode(
       extensions.digest(installed_recovery_definition, 'sha256'), 'hex'
     ) <> 'e8a0d50d042029d3af2c2a23a30fdce4207f365535fbfdf507a6a27de55ce311' then
    raise exception 'COUPANG_PRICE_SNAPSHOT_RECOVERY_POSTIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$install$;

do $postflight$
declare
  recorder_name constant regprocedure :=
    'sellerpilot_private.record_coupang_exact_post_price_completion(uuid)'::regprocedure;
  recovery_name constant regprocedure :=
    'sellerpilot_private.complete_exact_coupang_post_price_after_reaper(uuid,jsonb)'::regprocedure;
  protected_owner_count integer;
  unauthorized_acl_count integer;
begin
  select count(*) into strict protected_owner_count
    from pg_catalog.pg_proc procedure
   where procedure.oid in (recorder_name, recovery_name)
     and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
     and procedure.prosecdef
     and exists (
       select 1
         from unnest(coalesce(procedure.proconfig, '{}'::text[])) config(value)
        where config.value in ('search_path=', 'search_path=""')
     );
  select count(*) into strict unauthorized_acl_count
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )) acl
   where procedure.oid in (recorder_name, recovery_name)
     and acl.grantee <> procedure.proowner;
  if encode(extensions.digest(
       pg_catalog.pg_get_functiondef(recorder_name), 'sha256'
     ), 'hex') <>
       '2c4937db26550e697ed326886dc1fcb44ae36c7974054591e3c99a84fd8878b3'
     or encode(extensions.digest(
       pg_catalog.pg_get_functiondef(recovery_name), 'sha256'
     ), 'hex') <>
       'e8a0d50d042029d3af2c2a23a30fdce4207f365535fbfdf507a6a27de55ce311'
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(recorder_name),
       $marker$'price', run.desired_price::numeric(14,2),$marker$
     ) = 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(recovery_name),
       '2c4937db26550e697ed326886dc1fcb44ae36c7974054591e3c99a84fd8878b3'
     ) = 0
     or protected_owner_count <> 2
     or unauthorized_acl_count <> 0
     or (
       select count(*)
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = '2d64d82c-ce61-427f-81f0-c622bfa8bab6'::uuid
          and encode(
            extensions.digest(to_jsonb(job)::text, 'sha256'), 'hex'
          ) = '6a4dd03a0d9a8d7a0e34a4d61c30c79589f465a40a7142eecd531031c7800493'
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_post_price_reaper_completions
     ) then
    raise exception 'COUPANG_PRICE_SNAPSHOT_INSTALL_DRIFT'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on function
sellerpilot_private.record_coupang_exact_post_price_completion(uuid) is
'Records the exact Coupang post-price publication receipt and preserves the product listing numeric(14,2) price representation in its immutable postimage.';

commit;
