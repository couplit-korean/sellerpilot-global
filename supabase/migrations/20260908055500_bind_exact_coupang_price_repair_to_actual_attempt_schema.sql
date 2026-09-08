-- Bind the exact Coupang price repair enqueue to the deployed
-- channel_operation_attempts schema.  Production has started_at but no
-- created_at column.  The prior failed call rolled back before creating any
-- attempt, job, permit, or provider mutation.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072056);

do $preflight$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  helper_definition text;
  snapshot_definition text;
  enqueue_definition text;
  columns_fragment constant text :=
    '    seller_account_key,created_at,started_at';
  values_fragment constant text :=
    '    request_sha,''running'',true,false,credential.seller_account_key,now_at,now_at';
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'
     ) is null then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
  if exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'channel_operation_attempts'
          and column_name = 'created_at'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'sellerpilot_private'
          and table_name = 'channel_operation_attempts'
          and column_name = 'started_at'
          and is_nullable = 'NO'
     ) then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  if exists (
       select 1
         from sellerpilot_private.coupang_exact_price_repair_permits
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangExactPriceRepair',false)
     )
     or exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.channel = 'coupang'
          and attempt.operation = 'price.update'
          and attempt.idempotency_key =
            'exact-coupang-price-repair:25adf712-1e9a-432b-8b0d-09cf35a826c5'
     ) then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_NOT_EMPTY'
      using errcode = '55000';
  end if;

  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
   for share;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid
   for share;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
   for share;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
   for share;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = source_job.id
     and source_attempt_id = source_attempt.id
     and verifier_job_id = verifier.id
     and listing_id = listing.id
   for share;
  if listing.seller_account_key is not null
     or source_job.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or source_attempt.seller_account_key is distinct from
       source_job.seller_account_key
     or verifier.seller_account_key is distinct from source_job.seller_account_key
     or encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
       <> adjudication.source_job_sha256
     or encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
       <> adjudication.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
       <> adjudication.verifier_job_sha256
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256 then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_EVIDENCE_DRIFT'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  ) into strict helper_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict snapshot_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  if pg_catalog.strpos(helper_definition,'listing_after_snapshot') = 0
     or pg_catalog.strpos(helper_definition,
       'listing.seller_account_key is null') = 0
     or pg_catalog.strpos(snapshot_definition,
       'source_attempt.seller_account_key = permit.seller_account_key') = 0
     or pg_catalog.strpos(enqueue_definition,
       'candidate.seller_account_key = credential.seller_account_key') = 0
     or (length(enqueue_definition)-length(replace(
       enqueue_definition,columns_fragment,''
     ))) / length(columns_fragment) <> 1
     or (length(enqueue_definition)-length(replace(
       enqueue_definition,values_fragment,''
     ))) / length(values_fragment) <> 1 then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_FUNCTION_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

do $patch_enqueue$
declare
  definition text;
  columns_fragment constant text :=
    '    seller_account_key,created_at,started_at';
  values_fragment constant text :=
    '    request_sha,''running'',true,false,credential.seller_account_key,now_at,now_at';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict definition;
  definition := pg_catalog.replace(
    definition,columns_fragment,'    seller_account_key,started_at'
  );
  definition := pg_catalog.replace(
    definition,values_fragment,
    '    request_sha,''running'',true,false,credential.seller_account_key,now_at'
  );
  if pg_catalog.strpos(definition,columns_fragment) > 0
     or pg_catalog.strpos(definition,values_fragment) > 0
     or pg_catalog.strpos(definition,
       '    seller_account_key,started_at') = 0
     or pg_catalog.strpos(definition,
       '    request_sha,''running'',true,false,credential.seller_account_key,now_at'
     ) = 0 then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_PATCH_FAILED'
      using errcode = '55000';
  end if;
  execute definition;
end
$patch_enqueue$;

do $postflight$
declare
  listing sellerpilot_private.product_listings%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  enqueue_definition text;
  enqueue_language text;
  enqueue_security_definer boolean;
  enqueue_volatility "char";
  enqueue_config text[];
  enqueue_oid oid;
begin
  if exists (
       select 1
         from sellerpilot_private.coupang_exact_price_repair_permits
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where coalesce((job.request_payload#>'{arguments}')
          ? 'sellerpilotCoupangExactPriceRepair',false)
     )
     or exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.channel = 'coupang'
          and attempt.operation = 'price.update'
          and attempt.idempotency_key =
            'exact-coupang-price-repair:25adf712-1e9a-432b-8b0d-09cf35a826c5'
     ) then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_POSTFLIGHT_DATA_FAILED'
      using errcode = '55000';
  end if;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id =
     '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  select procedure.oid,language.lanname,procedure.prosecdef,
         procedure.provolatile,procedure.proconfig
    into strict enqueue_oid,enqueue_language,enqueue_security_definer,
         enqueue_volatility,enqueue_config
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where procedure.oid =
     'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure;
  if listing.seller_account_key is not null
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256
     or pg_catalog.strpos(enqueue_definition,'created_at,started_at') > 0
     or pg_catalog.strpos(enqueue_definition,
       'seller_account_key,started_at') = 0
     or pg_catalog.strpos(enqueue_definition,
       'false,credential.seller_account_key,now_at,now_at') > 0
     or pg_catalog.strpos(enqueue_definition,
       'false,credential.seller_account_key,now_at') = 0
     or enqueue_language <> 'plpgsql'
     or not enqueue_security_definer
     or enqueue_volatility <> 'v'
     or enqueue_config is distinct from
       array['search_path=""','TimeZone=UTC']::text[]
     or pg_catalog.has_function_privilege('anon',enqueue_oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',enqueue_oid,'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'service_role',enqueue_oid,'EXECUTE'
     ) then
    raise exception 'COUPANG_EXACT_ATTEMPT_SCHEMA_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;
end
$postflight$;

commit;
