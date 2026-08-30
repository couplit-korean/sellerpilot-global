-- Correct the immutable fac9 Qoo10 request contract used by the one-shot
-- resume lineage. The actual prepared UpdateGoods params intentionally omit
-- ItemPrice and ItemQty; their authoritative values are already bound in
-- sellerpilotQoo10RollbackUpdateRecovery.expectedState. The applied 56500
-- migration and its history remain immutable.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $qoo10_resume_payload_contract_preimage$
declare
  v_function constant regprocedure :=
    'sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)'::regprocedure;
  v_definition_sha text;
  v_target_present boolean;
  v_release_active boolean;
  v_previous_history_count bigint := 0;
  v_current_history_count bigint := 0;
begin
  select encode(
           extensions.digest(pg_catalog.pg_get_functiondef(function_row.oid), 'sha256'),
           'hex'
         )
    into strict v_definition_sha
    from pg_catalog.pg_proc function_row
   where function_row.oid = v_function
     and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
     and function_row.prosecdef
     and function_row.provolatile = 's'::"char"
     and function_row.proconfig = array['search_path=""']::text[];

  if v_definition_sha is distinct from
       'ec01294fe79dd0b730ecde015dcb357c17cd35ea135a30f5342e00c81f17a89d'
     or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
  then
    raise exception 'exact Qoo10 resume lineage pre-image drifted'
      using errcode = '55000';
  end if;

  v_target_present := exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
  );
  v_release_active :=
    sellerpilot_private.active_serverless_runtime_release_sha()
      = '52c0a26c93a3c377b042b65554234fb559bdab3f';

  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $history$
      select count(*) filter (where history.version = '20260831056500'),
             count(*) filter (where history.version = '20260831056600')
        from supabase_migrations.schema_migrations history
    $history$
      into strict v_previous_history_count, v_current_history_count;
    if v_previous_history_count <> 1 or v_current_history_count <> 0 then
      raise exception 'exact Qoo10 resume migration history precondition failed'
        using errcode = '55000';
    end if;
  elsif v_target_present or v_release_active then
    raise exception 'exact Qoo10 resume migration history is unavailable'
      using errcode = '55000';
  end if;

  if (select count(*)
        from sellerpilot_private.qoo10_exact_preprovider_resume_permits) <> 0
  then
    raise exception 'exact Qoo10 resume permit must remain unarmed'
      using errcode = '55000';
  end if;

  if v_target_present or v_release_active then
    if not v_target_present
       or not v_release_active
       or not sellerpilot_private.qoo10_exact_preprovider_resume_release_is_current(
         '52c0a26c93a3c377b042b65554234fb559bdab3f'
       )
       or not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id = job.attempt_id
          where job.id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
            and job.attempt_id =
                  '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
            and job.listing_id =
                  '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
            and job.credential_id =
                  '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
            and job.channel = 'qoo10'
            and job.operation = 'listing.update'
            and job.environment = 'production'
            and job.status = 'queued'
            and job.attempt_count = 0
            and job.worker_token_id is null
            and job.claim_token is null
            and job.lease_expires_at is null
            and job.started_at is null
            and job.completed_at is null
            and job.response_payload is null
            and job.error_message is null
            and job.provider_mutation_started_at is null
            and job.credential_refresh_started_at is null
            and job.request_fingerprint =
                  '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
            and octet_length(job.request_payload::text) = 23555
            and encode(
                  extensions.digest(job.request_payload::text, 'sha256'), 'hex'
                ) =
                  'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
            and not ((job.request_payload#>'{arguments,params}') ? 'ItemPrice')
            and not ((job.request_payload#>'{arguments,params}') ? 'ItemQty')
            and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}' =
                  '1871'
            and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}' =
                  '1'
            and attempt.idempotency_key =
                  'product-edit:ddccde35-9c58-4856-b673-d7aa27ce4220:4e5b97be-3fe5-4537-9e26-d36fb36ec1fc:5fb751b6-0372-4ad3-b238-6670d58b42f9'
            and attempt.status = 'running'
            and attempt.completed_at is null
       )
       or exists (
         select 1
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id =
                'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
       )
    then
      raise exception 'exact Qoo10 resume payload-contract state mismatch'
        using errcode = '55000';
    end if;
  end if;
end;
$qoo10_resume_payload_contract_preimage$;

create or replace function sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
  p_job_id uuid,
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = job.attempt_id
      join sellerpilot_private.product_listings listing
        on listing.id = job.listing_id
      join sellerpilot_private.products product
        on product.id = listing.product_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = job.credential_id
      join sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
        on evidence.listing_id = listing.id
       and evidence.product_id = product.id
       and evidence.credential_id = credential.id
       and evidence.source_job_id =
             '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid
       and evidence.remote_id = listing.remote_id
      join sellerpilot_private.qoo10_listing_create_rollback_confirmations confirmation
        on confirmation.source_job_id = evidence.source_job_id
       and confirmation.source_attempt_id = evidence.source_attempt_id
       and confirmation.listing_id = listing.id
       and confirmation.credential_id = credential.id
       and confirmation.remote_id = listing.remote_id
      join sellerpilot_private.channel_gateway_jobs adult_job
        on adult_job.id = evidence.job_id
       and adult_job.attempt_id = evidence.attempt_id
       and adult_job.listing_id = evidence.listing_id
       and adult_job.credential_id = evidence.credential_id
      join sellerpilot_private.channel_operation_attempts adult_attempt
        on adult_attempt.id = evidence.attempt_id
       and adult_attempt.credential_id = evidence.credential_id
       and adult_attempt.owner_id = listing.owner_id
      join sellerpilot_private.channel_gateway_jobs baseline_job
        on baseline_job.id = evidence.baseline_update_job_id
       and baseline_job.listing_id = evidence.listing_id
       and baseline_job.credential_id = evidence.credential_id
      join sellerpilot_private.qoo10_listing_update_rejection_observations
        baseline_observation
        on baseline_observation.update_job_id = evidence.baseline_update_job_id
       and baseline_observation.source_job_id = evidence.source_job_id
       and baseline_observation.source_attempt_id = evidence.source_attempt_id
       and baseline_observation.listing_id = evidence.listing_id
       and baseline_observation.credential_id = evidence.credential_id
       and baseline_observation.remote_id = evidence.remote_id
       and baseline_observation.response_sha256 = evidence.baseline_response_sha256
      join sellerpilot_private.operation_audit evidence_audit
        on evidence_audit.owner_id = listing.owner_id
       and evidence_audit.action = 'qoo10_exact_adultyn_rejection_reconciled'
       and evidence_audit.entity_type = 'channel_gateway_job'
       and evidence_audit.entity_id = evidence.job_id::text
       and evidence_audit.safe_detail is not distinct from
         sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
     where p_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
       and p_release_sha = '52c0a26c93a3c377b042b65554234fb559bdab3f'
       and job.id = p_job_id
       and job.attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
       and job.listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and job.credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
       and job.channel = 'qoo10'
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.seller_account_key =
             '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and job.request_fingerprint =
             '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
       and job.created_at = '2026-08-30 22:38:42.23343+00'::timestamptz
       and octet_length(job.request_payload::text) = 23555
       and encode(
             extensions.digest(job.request_payload::text, 'sha256'), 'hex'
           ) = 'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
       and job.request_payload#>>'{arguments,params,ItemCode}' = '1217336970'
       and job.request_payload#>>'{arguments,params,SecondSubCat}' = '320000542'
       and job.request_payload#>>'{arguments,params,ProductionPlaceType}' = '2'
       and job.request_payload#>>'{arguments,params,ProductionPlace}' = 'CN'
       and job.request_payload#>>'{arguments,params,RetailPrice}' = '1871'
       and not ((job.request_payload#>'{arguments,params}') ? 'ItemPrice')
       and not ((job.request_payload#>'{arguments,params}') ? 'ItemQty')
       and job.request_payload#>>'{arguments,params,ShippingNo}' = '806971'
       and job.request_payload#>>'{arguments,params,AdultYN}' = 'N'
       and not ((job.request_payload#>'{arguments,params}') ? 'AudultYN')
       and job.request_payload#>>'{arguments,publicationIntent}' = 'live'
       and job.request_payload#>>'{arguments,publicationStateContract}' =
             'verified_remote_state_v1'
       and job.request_payload#>>'{arguments,publicationExpectedLocale}' = 'ja-JP'
       and job.request_payload#>>'{arguments,publicationExpectedImageCount}' = '8'
       and job.request_payload#>>'{arguments,publicationExpectedFingerprint}' =
             job.request_fingerprint
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,status}' =
             'allowed'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,contract}' =
             'qoo10_create_rollback_confirmation_v1'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,listingId}' =
             listing.id::text
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,remoteId}' =
             listing.remote_id
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,providerStatus}' =
             'S1'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,sourceJobId}' =
             confirmation.source_job_id::text
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,categoryCode}' =
             '320000542'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,retailPriceJpy}' =
             '1871'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}' =
             '1871'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}' =
             '1'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}' =
             '806971'
       and job.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,biContentsNo}' =
             '8461402963'
       and attempt.id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
       and attempt.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and attempt.credential_id = credential.id
       and attempt.channel = 'qoo10'
       and attempt.operation = 'listing.update'
       and attempt.idempotency_key =
             'product-edit:ddccde35-9c58-4856-b673-d7aa27ce4220:4e5b97be-3fe5-4537-9e26-d36fb36ec1fc:5fb751b6-0372-4ad3-b238-6670d58b42f9'
       and attempt.request_fingerprint = job.request_fingerprint
       and attempt.status = 'running'
       and attempt.http_status is null
       and attempt.remote_id is null
       and attempt.safe_message is null
       and attempt.started_at = '2026-08-30 22:38:33.731944+00'::timestamptz
       and attempt.completed_at is null
       and attempt.gateway_write_required
       and not attempt.pre_gateway_retryable
       and attempt.seller_account_key = job.seller_account_key
       and listing.id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and listing.owner_id = attempt.owner_id
       and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = 'qoo10'
       and listing.market = 'JP'
       and listing.target_id = ''
       and listing.operation_attempt_id = attempt.id
       and listing.status = 'queued'
       and listing.failure_class is null
       and listing.last_error is null
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'non_public'
       and listing.provider_status = 'S1'
       and listing.remote_id = '1217336970'
       and listing.seller_account_key = job.seller_account_key
       and listing.published_at is null
       and listing.last_verified_at = evidence.provider_observed_at
       and listing.updated_at = job.created_at
       and product.owner_id = attempt.owner_id
       and not product.demo
       and product.status <> 'archived'
       and credential.channel = 'qoo10'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > statement_timestamp())
       and credential.created_by = job.created_by
       and credential.seller_account_key = job.seller_account_key
       and credential.seller_account_key_source in (
             'provider_certified_v1', 'credential_incarnation_v1'
           )
       and credential.seller_account_verified_at is not null
       and confirmation.seller_account_key = job.seller_account_key
       and confirmation.credential_fingerprint = credential.fingerprint
       and confirmation.category_code = '320000542'
       and confirmation.retail_price_jpy = 1871
       and confirmation.sell_price_jpy = 1871
       and confirmation.quantity = 1
       and confirmation.shipping_no = '0'
       and confirmation.bi_contents_no = 8461402963
       and confirmation.new_provider_status = 'S1'
       and confirmation.confirmed_at =
             '2026-08-30 14:51:26.505498+00'::timestamptz
       and evidence.job_id = 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid
       and evidence.attempt_id = 'c19956d8-67d3-465b-90cd-a41b9123ad4e'::uuid
       and evidence.source_attempt_id =
             '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid
       and evidence.baseline_update_job_id =
             '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid
       and evidence.baseline_response_sha256 =
             '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
       and evidence.request_fingerprint =
             '388a0ed6bed7d1537ee0b4792429b1c796daabe12303681348b5634d1d37b3f9'
       and evidence.request_sha256 =
             'c74ae7bafc7e884b04fd30012f30a834495df4b0cf1e97969dd860f6e878da5e'
       and evidence.response_sha256 =
             'ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad'
       and evidence.provider_rejection_code = '-99'
       and evidence.provider_rejection_message = 'AdultYNは必須です。'
       and evidence.provider_status = 'S1'
       and evidence.remote_visibility = 'non_public'
       and evidence.item_title = '貼り付け式ケーブル整理クリップ6個セット'
       and evidence.adult_yn = 'N'
       and evidence.origin_type = '2'
       and evidence.origin_code = 'CN'
       and evidence.retail_price_jpy = 1871
       and evidence.quantity = 1
       and evidence.shipping_no = '806971'
       and evidence.detail_image_count = 8
       and evidence.mismatch_paths =
             array['ItemDescription.text', 'Keyword']::text[]
       and evidence.provider_changed_date = '2026-08-30 21:57:11'
       and evidence.provider_observed_at =
             '2026-08-30 21:32:29.567929+00'::timestamptz
       and not evidence.provider_mutation_accepted
       and not evidence.provider_call_replayed
       and adult_job.channel = 'qoo10'
       and adult_job.operation = 'listing.update'
       and adult_job.environment = 'production'
       and adult_job.status = 'succeeded'
       and adult_job.error_message is null
       and adult_job.request_fingerprint = evidence.request_fingerprint
       and adult_job.seller_account_key = confirmation.seller_account_key
       and adult_job.attempt_count = 1
       and adult_job.provider_mutation_started_at =
             '2026-08-30 21:32:22.585567+00'::timestamptz
       and adult_job.created_at =
             '2026-08-30 21:29:28.87921+00'::timestamptz
       and adult_job.started_at =
             '2026-08-30 21:32:19.498509+00'::timestamptz
       and adult_job.completed_at = evidence.provider_observed_at
       and adult_job.updated_at = evidence.reconciled_at
       and encode(
             extensions.digest(adult_job.request_payload::text, 'sha256'), 'hex'
           ) = evidence.request_sha256
       and encode(
             extensions.digest(adult_job.response_payload::text, 'sha256'), 'hex'
           ) = evidence.response_sha256
       and adult_attempt.channel = 'qoo10'
       and adult_attempt.operation = 'listing.update'
       and adult_attempt.status = 'failed'
       and adult_attempt.http_status = 200
       and adult_attempt.remote_id = evidence.remote_id
       and adult_attempt.request_fingerprint = evidence.request_fingerprint
       and adult_attempt.seller_account_key = confirmation.seller_account_key
       and adult_attempt.gateway_write_required
       and not adult_attempt.pre_gateway_retryable
       and adult_attempt.completed_at = evidence.provider_observed_at
       and baseline_job.channel = 'qoo10'
       and baseline_job.operation = 'listing.update'
       and baseline_job.status = 'succeeded'
       and baseline_observation.update_attempt_id =
             'dc9a6e45-e333-4a15-b432-c14a03734f9c'::uuid
       and baseline_observation.provider_rejection_code = '-99'
       and baseline_observation.provider_rejection_reason =
             'ProductionPlaceType_required'
       and baseline_observation.provider_status = 'S1'
       and baseline_observation.observed_origin_type = '2'
       and baseline_observation.observed_origin = 'CN'
       and baseline_observation.observed_retail_price_jpy = 1871
       and baseline_observation.observed_sell_price_jpy = 1871
       and baseline_observation.observed_quantity = 1
       and baseline_observation.source_shipping_no = '0'
       and baseline_observation.observed_shipping_no = evidence.shipping_no
       and baseline_observation.observed_detail_image_count = 8
       and not baseline_observation.provider_mutation_accepted
       and baseline_observation.observed_at =
             '2026-08-30 15:06:13.213314+00'::timestamptz
       and job.created_at > adult_job.created_at
       and (
         select array_agg(later_job.id order by later_job.created_at, later_job.id)
           from sellerpilot_private.channel_gateway_jobs later_job
          where later_job.listing_id = evidence.listing_id
            and later_job.operation in (
                  'listing.create', 'listing.update', 'listing.stop'
                )
            and later_job.created_at > adult_job.created_at
       ) = array[job.id]
       and sellerpilot_private.qoo10_exact_preprovider_resume_release_is_current(
             p_release_sha
           )
       and (
         select count(*)
           from sellerpilot_private.channel_gateway_jobs active_job
          where active_job.operation in (
                  'listing.create', 'listing.update', 'listing.stop'
                )
            and active_job.status in (
                  'queued', 'running', 'reconciliation_required'
                )
       ) = 1
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs other_job
          where other_job.operation in (
                  'listing.create', 'listing.update', 'listing.stop'
                )
            and other_job.status in (
                  'queued', 'running', 'reconciliation_required'
                )
            and other_job.id <> job.id
       )
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)
  from public, anon, authenticated, service_role;

do $qoo10_resume_payload_contract_postimage$
declare
  v_function constant regprocedure :=
    'sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)'::regprocedure;
  v_definition_sha text;
  v_target_present boolean := exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
  );
begin
  select encode(
           extensions.digest(pg_catalog.pg_get_functiondef(function_row.oid), 'sha256'),
           'hex'
         )
    into strict v_definition_sha
    from pg_catalog.pg_proc function_row
   where function_row.oid = v_function
     and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
     and function_row.prosecdef
     and function_row.provolatile = 's'::"char"
     and function_row.proconfig = array['search_path=""']::text[];

  if v_definition_sha is distinct from
       '283ea8340708a4666e6948fb205f371f7481d7cb976cca8ec99c8d1018c395d3'
     or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
  then
    raise exception 'exact Qoo10 resume lineage post-image drifted'
      using errcode = '55000';
  end if;

  if v_target_present
     and not sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
       '52c0a26c93a3c377b042b65554234fb559bdab3f'
     )
  then
    raise exception 'corrected exact Qoo10 resume lineage is not current'
      using errcode = '55000';
  end if;
end;
$qoo10_resume_payload_contract_postimage$;

comment on function
  sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)
is 'Exact fac9 lineage: prepared params omit ItemPrice/ItemQty; recovery expectedState binds price and quantity.';

commit;
