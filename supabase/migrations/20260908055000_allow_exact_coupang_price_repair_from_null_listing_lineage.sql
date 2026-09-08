-- Preserve the immutable NULL seller lineage on the one adjudicated Coupang
-- listing while binding its exact price repair to the verified credential,
-- source-attempt, source-job, verifier, route, and worker seller identity.
-- This migration installs guards only.  It does not enqueue work or call Coupang.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072055);

do $preflight$
declare
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  lineage_definition text;
  helper_definition text;
  snapshot_definition text;
  enqueue_definition text;
  fragment text;
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_price_repair_permits'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'
     ) is null then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_DEPENDENCY_MISSING'
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
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_NOT_EMPTY'
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
  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
   for share;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = source_job.id
     and source_attempt_id = source_attempt.id
     and verifier_job_id = verifier.id
     and listing_id = listing.id
   for share;

  if listing.seller_account_key is not null
     or not (to_jsonb(listing) ? 'seller_account_key')
     or to_jsonb(listing)->'seller_account_key' is distinct from 'null'::jsonb
     or source_job.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or source_attempt.seller_account_key is distinct from
       source_job.seller_account_key
     or verifier.seller_account_key is distinct from source_job.seller_account_key
     or credential.seller_account_key is distinct from
       source_job.seller_account_key
     or source_job.status <> 'reconciliation_required'
     or source_job.operation <> 'listing.create'
     or source_job.attempt_id <> source_attempt.id
     or source_job.listing_id <> listing.id
     or source_job.credential_id <> credential.id
     or source_attempt.status <> 'manual_required'
     or source_attempt.operation <> 'listing.create'
     or verifier.status <> 'reconciliation_required'
     or verifier.operation <> 'listing.publication.verify'
     or verifier.listing_id <> listing.id
     or adjudication.decision <> 'provider_live_price_drift'
     or adjudication.contract <>
       'coupang_exact_live_price_drift_adjudication_v1'
     or not adjudication.provider_live_verified
     or adjudication.exact_content_verified
     or adjudication.buyer_visible_verified
     or adjudication.provider_mutation_performed
     or adjudication.provider_call_replayed
     or encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
       <> adjudication.source_job_sha256
     or encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
       <> adjudication.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
       <> adjudication.verifier_job_sha256
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256
     or encode(extensions.digest(
       adjudication.adjudication_evidence::text,'sha256'
     ),'hex') <> adjudication.adjudication_sha256 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_EVIDENCE_DRIFT'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  ) into strict lineage_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  ) into strict helper_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict snapshot_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;

  fragment := $old$      if new.operation in ('price.update', 'inventory.update') and (
        v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then$old$;
  if (length(lineage_definition)-length(replace(lineage_definition,fragment,'')))
       / length(fragment) <> 1
     or pg_catalog.strpos(lineage_definition,
       'coupang_exact_price_repair_insert_identity_allowed(new) then') = 0 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_GUARD_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  if encode(extensions.digest(helper_definition,'sha256'),'hex') <>
       '664851e1c3059df62cbef1681f3325284c0cb14570fc7983c3cf64e85e661c1e'
     or pg_catalog.strpos(helper_definition,'listing_after_snapshot') > 0
     or pg_catalog.strpos(helper_definition,
       'sellerpilot.coupang_exact_price_repair_enqueue') = 0 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_HELPER_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  fragment := '       and listing.seller_account_key = permit.seller_account_key';
  if (length(snapshot_definition)-length(replace(snapshot_definition,fragment,'')))
       / length(fragment) <> 1 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_SNAPSHOT_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  foreach fragment in array array[
    '     and candidate.seller_account_key = listing.seller_account_key',
    '     or credential.seller_account_key is distinct from listing.seller_account_key',
    '    request_sha,''running'',true,false,listing.seller_account_key,now_at,now_at',
    '    ''production'',payload,''queued'',listing.seller_account_key,request_sha',
    '    listing.owner_id,credential.created_by,listing.seller_account_key,'
  ] loop
    if (length(enqueue_definition)-length(replace(enqueue_definition,fragment,'')))
         / length(fragment) <> 1 then
      raise exception 'COUPANG_EXACT_NULL_LINEAGE_ENQUEUE_PREIMAGE_DRIFT: %',
        fragment using errcode = '55000';
    end if;
  end loop;
end
$preflight$;

create or replace function
sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(
  job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  marker jsonb;
  repair_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
begin
  marker := job.request_payload
    #>'{arguments,sellerpilotCoupangExactPriceRepair}';
  if sellerpilot_private.coupang_exact_price_repair_job_matches(job) is not true
     or current_setting(
       'sellerpilot.coupang_exact_price_repair_enqueue',true
     ) is distinct from job.id::text
     or job.status <> 'queued'
     or job.attempt_count <> 0
     or job.worker_token_id is not null
     or job.claim_token is not null
     or job.lease_expires_at is not null
     or job.started_at is not null
     or job.completed_at is not null
     or job.response_payload is not null
     or job.error_message is not null
     or job.provider_mutation_started_at is not null
     or jsonb_typeof(marker) <> 'object'
     or job.listing_id <>
       'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
     or job.credential_id <>
       '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
     or job.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or encode(extensions.digest(job.request_payload::text,'sha256'),'hex')
       <> job.request_fingerprint then
    return false;
  end if;

  select * into repair_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = job.attempt_id;
  select * into source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid;
  select * into source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid;
  select * into verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;
  select * into listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid;
  select * into credential
    from sellerpilot_private.channel_credentials
   where id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid;
  select * into adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = source_job.id
     and source_attempt_id = source_attempt.id
     and verifier_job_id = verifier.id
     and listing_id = listing.id;

  return coalesce(repair_attempt.id = job.attempt_id
    and repair_attempt.owner_id = listing.owner_id
    and repair_attempt.credential_id = credential.id
    and repair_attempt.channel = 'coupang'
    and repair_attempt.operation = 'price.update'
    and repair_attempt.status = 'running'
    and repair_attempt.seller_account_key = job.seller_account_key
    and repair_attempt.request_fingerprint = job.request_fingerprint
    and source_job.status = 'reconciliation_required'
    and source_job.channel = 'coupang'
    and source_job.operation = 'listing.create'
    and source_job.attempt_id = source_attempt.id
    and source_job.listing_id = listing.id
    and source_job.credential_id = credential.id
    and source_job.seller_account_key = job.seller_account_key
    and source_attempt.status = 'manual_required'
    and source_attempt.channel = 'coupang'
    and source_attempt.operation = 'listing.create'
    and source_attempt.owner_id = listing.owner_id
    and source_attempt.credential_id = credential.id
    and source_attempt.seller_account_key = job.seller_account_key
    and verifier.status = 'reconciliation_required'
    and verifier.channel = 'coupang'
    and verifier.operation = 'listing.publication.verify'
    and verifier.listing_id = listing.id
    and verifier.seller_account_key = job.seller_account_key
    and listing.owner_id =
      '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and listing.product_id =
      '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
    and listing.channel_key = 'coupang'
    and listing.seller_account_key is null
    and to_jsonb(listing)->'seller_account_key' = 'null'::jsonb
    and listing.remote_id = '16375780938'
    and listing.remote_resources#>>'{resources,sellerProductId}' =
      '16375780938'
    and listing.remote_resources#>'{resources,vendorItemIds}' =
      '["96027942778"]'::jsonb
    and credential.created_by = source_job.created_by
    and credential.channel = 'coupang'
    and credential.environment = 'production'
    and credential.status = 'active'
    and credential.seller_account_key = job.seller_account_key
    and credential.seller_account_key_source in (
      'provider_certified_v1','credential_incarnation_v1'
    )
    and credential.seller_account_verified_at is not null
    and credential.last_checked_at is not null
    and credential.last_check_status = 'passed'
    and adjudication.decision = 'provider_live_price_drift'
    and adjudication.contract =
      'coupang_exact_live_price_drift_adjudication_v1'
    and adjudication.provider_live_verified
    and not adjudication.exact_content_verified
    and not adjudication.buyer_visible_verified
    and not adjudication.provider_mutation_performed
    and not adjudication.provider_call_replayed
    and to_jsonb(listing) = adjudication.listing_after_snapshot
    and encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
      = adjudication.listing_after_sha256
    and encode(extensions.digest(to_jsonb(source_job)::text,'sha256'),'hex')
      = adjudication.source_job_sha256
    and encode(extensions.digest(to_jsonb(source_attempt)::text,'sha256'),'hex')
      = adjudication.source_attempt_sha256
    and encode(extensions.digest(to_jsonb(verifier)::text,'sha256'),'hex')
      = adjudication.verifier_job_sha256
    and encode(extensions.digest(
      adjudication.adjudication_evidence::text,'sha256'
    ),'hex') = adjudication.adjudication_sha256
    and marker->>'sourceJobId' = source_job.id::text
    and marker->>'sourceAttemptId' = source_attempt.id::text
    and marker->>'verifierJobId' = verifier.id::text
    and marker->>'listingAdjudicatedSha256' =
      adjudication.listing_after_sha256
    and marker->>'sourceJobRowSha256' = adjudication.source_job_sha256
    and marker->>'sourceAttemptRowSha256' = adjudication.source_attempt_sha256
    and marker->>'verifierJobRowSha256' = adjudication.verifier_job_sha256
    and marker->>'adjudicationSha256' = adjudication.adjudication_sha256
    and sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
      source_job.id
    ),false);
exception when others then
  return false;
end
$$;

revoke all on function
sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(
  sellerpilot_private.channel_gateway_jobs
) from public, anon, authenticated, service_role;

do $patch_gateway_seller_lineage$
declare
  definition text;
  before_fragment constant text := $before$      if new.operation in ('price.update', 'inventory.update') and (
        v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then$before$;
  after_fragment constant text := $after$      if new.operation in ('price.update', 'inventory.update') and (
        v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) and not sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(
        new
      ) then$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  ) into strict definition;
  if (length(definition)-length(replace(definition,before_fragment,'')))
       / length(before_fragment) <> 1 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_GUARD_PATCH_DRIFT'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(definition,before_fragment,after_fragment);
end
$patch_gateway_seller_lineage$;

do $patch_snapshot$
declare
  definition text;
  before_fragment constant text :=
    '       and listing.seller_account_key = permit.seller_account_key';
  after_fragment constant text := $after$       and listing.seller_account_key is null
       and source_job.seller_account_key = permit.seller_account_key
       and source_attempt.seller_account_key = permit.seller_account_key
       and verifier.seller_account_key = permit.seller_account_key$after$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict definition;
  if (length(definition)-length(replace(definition,before_fragment,'')))
       / length(before_fragment) <> 1 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_SNAPSHOT_PATCH_DRIFT'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(definition,before_fragment,after_fragment);
end
$patch_snapshot$;

do $patch_enqueue$
declare
  definition text;
  fragment text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict definition;

  fragment := '     and candidate.seller_account_key = listing.seller_account_key';
  definition := replace(definition,fragment,
    '     and candidate.seller_account_key = credential.seller_account_key');

  fragment := '     or credential.seller_account_key is distinct from listing.seller_account_key';
  definition := replace(definition,fragment,$new$     or listing.seller_account_key is not null
     or credential.seller_account_key is distinct from
       'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
     or source_attempt.seller_account_key is distinct from
       credential.seller_account_key
     or verifier.seller_account_key is distinct from
       credential.seller_account_key$new$);

  fragment :=
    '    request_sha,''running'',true,false,listing.seller_account_key,now_at,now_at';
  definition := replace(definition,fragment,
    '    request_sha,''running'',true,false,credential.seller_account_key,now_at,now_at');

  fragment :=
    '    ''production'',payload,''queued'',listing.seller_account_key,request_sha';
  definition := replace(definition,fragment,
    '    ''production'',payload,''queued'',credential.seller_account_key,request_sha');

  fragment := '    listing.owner_id,credential.created_by,listing.seller_account_key,';
  definition := replace(definition,fragment,
    '    listing.owner_id,credential.created_by,credential.seller_account_key,');

  if pg_catalog.strpos(definition,
       'candidate.seller_account_key = listing.seller_account_key') > 0
     or pg_catalog.strpos(definition,
       'credential.seller_account_key is distinct from listing.seller_account_key') > 0
     or pg_catalog.strpos(definition,
       'false,listing.seller_account_key,now_at,now_at') > 0
     or pg_catalog.strpos(definition,
       '''queued'',listing.seller_account_key,request_sha') > 0
     or pg_catalog.strpos(definition,
       'credential.created_by,listing.seller_account_key') > 0
     or pg_catalog.strpos(definition,
       'candidate.seller_account_key = credential.seller_account_key') = 0
     or pg_catalog.strpos(definition,
       'listing.seller_account_key is not null') = 0 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_ENQUEUE_PATCH_FAILED'
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
  lineage_definition text;
  helper_definition text;
  snapshot_definition text;
  enqueue_definition text;
  helper_language text;
  helper_security_definer boolean;
  helper_volatility "char";
  helper_config text[];
  helper_oid oid;
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
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_POSTFLIGHT_DATA_FAILED'
      using errcode = '55000';
  end if;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid;
  select * into strict adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id =
     '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid;
  if listing.seller_account_key is not null
     or to_jsonb(listing) is distinct from adjudication.listing_after_snapshot
     or encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex')
       <> adjudication.listing_after_sha256 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_POSTFLIGHT_EVIDENCE_FAILED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  ) into strict lineage_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)'::regprocedure
  ) into strict helper_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.coupang_exact_price_repair_snapshot_is_current(uuid)'::regprocedure
  ) into strict snapshot_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure
  ) into strict enqueue_definition;
  select procedure.oid,language.lanname,procedure.prosecdef,
         procedure.provolatile,procedure.proconfig
    into strict helper_oid,helper_language,helper_security_definer,
         helper_volatility,helper_config
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where procedure.oid =
     'sellerpilot_private.coupang_exact_price_repair_insert_identity_allowed(sellerpilot_private.channel_gateway_jobs)'::regprocedure;
  select procedure.oid,language.lanname,procedure.prosecdef,
         procedure.provolatile,procedure.proconfig
    into strict enqueue_oid,enqueue_language,enqueue_security_definer,
         enqueue_volatility,enqueue_config
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
   where procedure.oid =
     'public.sellerpilot_service_enqueue_exact_coupang_price_repair(text)'::regprocedure;

  if helper_language <> 'plpgsql'
     or not helper_security_definer
     or helper_volatility <> 's'
     or helper_config is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege('anon',helper_oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',helper_oid,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',helper_oid,'EXECUTE')
     or enqueue_language <> 'plpgsql'
     or not enqueue_security_definer
     or enqueue_volatility <> 'v'
     or enqueue_config is distinct from
       array['search_path=""','TimeZone=UTC']::text[]
     or pg_catalog.has_function_privilege('anon',enqueue_oid,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',enqueue_oid,'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'service_role',enqueue_oid,'EXECUTE'
     )
     or pg_catalog.strpos(helper_definition,'listing_after_snapshot') = 0
     or pg_catalog.strpos(helper_definition,'listing.seller_account_key is null') = 0
     or (length(lineage_definition)-length(replace(
       lineage_definition,
       'coupang_exact_price_repair_insert_identity_allowed',''
     ))) / length('coupang_exact_price_repair_insert_identity_allowed') <> 2
     or pg_catalog.strpos(snapshot_definition,
       'listing.seller_account_key is null') = 0
     or pg_catalog.strpos(snapshot_definition,
       'source_job.seller_account_key = permit.seller_account_key') = 0
     or pg_catalog.strpos(enqueue_definition,
       'candidate.seller_account_key = credential.seller_account_key') = 0
     or pg_catalog.strpos(enqueue_definition,
       'listing.seller_account_key is not null') = 0
     or pg_catalog.strpos(enqueue_definition,
       'credential.created_by,credential.seller_account_key') = 0 then
    raise exception 'COUPANG_EXACT_NULL_LINEAGE_POSTFLIGHT_FUNCTION_FAILED'
      using errcode = '55000';
  end if;
end
$postflight$;

commit;
