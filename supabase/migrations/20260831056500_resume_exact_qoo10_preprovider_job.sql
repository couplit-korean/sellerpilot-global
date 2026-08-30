-- Resume only the one Qoo10 listing.update job that was durably enqueued by
-- release 52c0a26 but could not be claimed after the scoped release gate was
-- closed in the HTTP request's finally block. The provider boundary was never
-- reached. This migration does not open any release gate, enqueue a new job,
-- cancel an attempt, or call Qoo10.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $exact_qoo10_resume_preflight$
begin
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  if not found
     or not exists (
       select 1
         from sellerpilot_private.listing_mutation_release_gate gate
        where gate.singleton
          and not gate.is_open
          and gate.opened_at is null
          and gate.opened_release_sha is null
          and gate.opened_channel is null
     )
     or sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10')
  then
    raise exception 'exact Qoo10 pre-provider resume requires a closed gate'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.operation in ('listing.create', 'listing.update', 'listing.stop')
       and job.status in ('running', 'reconciliation_required')
  ) then
    raise exception 'running or uncertain listing mutations must drain first'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'sellerpilot_private.block_closed_listing_mutation_claim()'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate(text,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(text,uuid,uuid)'
     ) is null
  then
    raise exception 'exact Qoo10 resume predecessor chain is missing'
      using errcode = '55000';
  end if;

  if (
    to_regprocedure(
      'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
    ) is null
  ) is distinct from (
    to_regprocedure(
      'public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)'
    ) is null
  ) then
    raise exception 'exact Qoo10 serverless provider chain drift detected'
      using errcode = '55000';
  end if;

  if to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is not null
     and (
       to_regprocedure(
         'public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(text,uuid,uuid)'
       ) is null
       or to_regprocedure(
         'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'
       ) is null
     )
  then
    raise exception 'exact Qoo10 serverless provider delegate chain is missing'
      using errcode = '55000';
  end if;
end;
$exact_qoo10_resume_preflight$;

do $exact_qoo10_resume_function_preimages$
declare
  v_count integer := 0;
  v_row record;
  v_expected_sha text;
  v_expected_security_definer boolean;
  v_expected_service_execute boolean;
begin
  for v_row in
    select function_row.oid,
           function_row.oid::regprocedure::text as signature,
           encode(
             extensions.digest(
               pg_catalog.pg_get_functiondef(function_row.oid), 'sha256'
             ),
             'hex'
           ) as definition_sha,
           pg_catalog.pg_get_userbyid(function_row.proowner) as owner_name,
           function_row.prosecdef,
           function_row.provolatile,
           function_row.proconfig,
           pg_catalog.has_function_privilege(
             'service_role', function_row.oid, 'EXECUTE'
           ) as service_execute,
           pg_catalog.has_function_privilege(
             'anon', function_row.oid, 'EXECUTE'
           ) as anon_execute,
           pg_catalog.has_function_privilege(
             'authenticated', function_row.oid, 'EXECUTE'
           ) as authenticated_execute
      from pg_catalog.pg_proc function_row
     where function_row.oid in (
       'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure,
       'public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)'::regprocedure,
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'::regprocedure,
       'public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)'::regprocedure,
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
     )
     order by signature
  loop
    v_count := v_count + 1;
    case v_row.signature
      when 'sellerpilot_private.block_closed_listing_mutation_claim()' then
        v_expected_sha :=
          'da69ee7313607497720fb5942c50920854afd2fb02a5e84e446dc7f25b9af8ba';
        v_expected_security_definer := false;
        v_expected_service_execute := false;
      when 'sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)' then
        v_expected_sha :=
          'dc9ba62631a29f81051e1d63e4fc74ccd4747171bf0ab3c6c444b7fd2649fdf0';
        v_expected_security_definer := true;
        v_expected_service_execute := false;
      when 'sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)' then
        v_expected_sha :=
          '829a67730204bc5bd9007dfccf470dfce3dfba8b495e68cb59d128cebeed6a11';
        v_expected_security_definer := true;
        v_expected_service_execute := true;
      when 'sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)' then
        v_expected_sha :=
          '28b7e21a342d15428d79d06c314c77e194c4c19fbe72b43dbe2cd0726d1b93a9';
        v_expected_security_definer := true;
        v_expected_service_execute := false;
      when 'sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)' then
        v_expected_sha :=
          '39888fe7d2792448572c25f584f08612e7f28aa1b02ba0ca9b1235c9edda615b';
        v_expected_security_definer := true;
        v_expected_service_execute := true;
      else
        raise exception 'unexpected exact Qoo10 resume predecessor: %',
          v_row.signature using errcode = '55000';
    end case;

    if v_row.definition_sha is distinct from v_expected_sha
       or v_row.owner_name is distinct from 'postgres'
       or v_row.prosecdef is distinct from v_expected_security_definer
       or v_row.provolatile is distinct from 'v'::"char"
       or v_row.proconfig is distinct from array['search_path=""']::text[]
       or v_row.service_execute is distinct from v_expected_service_execute
       or v_row.anon_execute
       or v_row.authenticated_execute
    then
      raise exception 'exact Qoo10 resume function pre-image mismatch: %',
        v_row.signature using errcode = '55000';
    end if;
  end loop;

  if v_count <> 5 then
    raise exception 'exact Qoo10 resume requires all five function pre-images'
      using errcode = '55000';
  end if;
end;
$exact_qoo10_resume_function_preimages$;

create table sellerpilot_private.qoo10_exact_preprovider_resume_permits (
  job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null unique
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  job_created_by uuid not null references auth.users(id) on delete restrict,
  remote_id text not null,
  seller_account_key text not null,
  release_sha text not null,
  request_fingerprint text not null,
  request_payload_sha256 text not null,
  request_payload_bytes integer not null,
  contract text not null,
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  bound_at timestamptz,
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  consumed_at timestamptz,
  constraint qoo10_exact_resume_target_check check (
    job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and job_created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
    and remote_id = '1217336970'
  ),
  constraint qoo10_exact_resume_release_request_check check (
    seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and release_sha = '52c0a26c93a3c377b042b65554234fb559bdab3f'
    and request_fingerprint =
      '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
    and request_payload_sha256 =
      'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
    and request_payload_bytes = 23555
    and contract = 'qoo10_exact_preprovider_resume_v1'
  ),
  constraint qoo10_exact_resume_window_check check (
    expires_at > armed_at and expires_at <= armed_at + interval '30 minutes'
  ),
  constraint qoo10_exact_resume_binding_check check (
    (
      bound_at is null
      and bound_worker_token_id is null
      and bound_claim_token is null
      and consumed_at is null
    )
    or (
      bound_at is not null
      and bound_worker_token_id is not null
      and bound_claim_token is not null
      and (consumed_at is null or consumed_at >= bound_at)
    )
  )
);

alter table sellerpilot_private.qoo10_exact_preprovider_resume_permits
  enable row level security;
revoke all on table sellerpilot_private.qoo10_exact_preprovider_resume_permits
  from public, anon, authenticated, service_role;

create function sellerpilot_private.qoo10_exact_preprovider_resume_release_is_current(
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_release_sha = '52c0a26c93a3c377b042b65554234fb559bdab3f'
    and sellerpilot_private.attested_listing_publication_release_sha('qoo10')
          = p_release_sha
    and sellerpilot_private.active_serverless_runtime_release_sha()
          = p_release_sha
    and sellerpilot_private.listing_publication_review_violation_count('qoo10') = 0
    and exists (
      select 1
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
         and not gate.is_open
         and gate.opened_at is null
         and gate.opened_release_sha is null
         and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10'),
    false
  )
$$;

create function sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
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
       and job.request_payload#>>'{arguments,params,ItemPrice}' = '1871'
       and job.request_payload#>>'{arguments,params,ItemQty}' = '1'
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

create function public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(
  p_job_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing sellerpilot_private.qoo10_exact_preprovider_resume_permits%rowtype;
  v_armed_at timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
  lock table sellerpilot_private.channel_operation_attempts in share row exclusive mode;
  lock table sellerpilot_private.product_listings in share row exclusive mode;
  lock table sellerpilot_private.qoo10_exact_preprovider_resume_permits
    in share row exclusive mode;

  if p_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_release_sha is distinct from
       '52c0a26c93a3c377b042b65554234fb559bdab3f'
  then
    raise exception 'exact Qoo10 pre-provider resume identity required'
      using errcode = '22023';
  end if;

  select permit.* into v_existing
    from sellerpilot_private.qoo10_exact_preprovider_resume_permits permit
   where permit.job_id = p_job_id;
  if found then
    if v_existing.consumed_at is null
       and v_existing.expires_at > statement_timestamp() then
      return jsonb_build_object(
        'contract', v_existing.contract,
        'jobId', v_existing.job_id,
        'releaseSha', v_existing.release_sha,
        'armedAt', v_existing.armed_at,
        'expiresAt', v_existing.expires_at,
        'bound', v_existing.bound_claim_token is not null,
        'consumedAt', v_existing.consumed_at,
        'reused', true
      );
    end if;
    raise exception 'exact Qoo10 resume permit is no longer armable'
      using errcode = '55000';
  end if;

  if not sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
       p_job_id, p_release_sha
     )
     or not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = p_job_id
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
     )
     or exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = p_job_id
     )
  then
    raise exception 'exact Qoo10 pre-provider resume preconditions are not met'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_exact_preprovider_resume_permits (
    job_id, attempt_id, listing_id, product_id, credential_id,
    owner_id, job_created_by, remote_id, seller_account_key, release_sha,
    request_fingerprint, request_payload_sha256, request_payload_bytes,
    contract, armed_at, expires_at
  ) values (
    p_job_id,
    '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid,
    '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid,
    '1217336970',
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46',
    p_release_sha,
    '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799',
    'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d',
    23555,
    'qoo10_exact_preprovider_resume_v1',
    v_armed_at,
    v_armed_at + interval '30 minutes'
  );

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    'qoo10_exact_preprovider_resume_armed',
    'channel_gateway_job',
    p_job_id::text,
    jsonb_build_object(
      'contract', 'qoo10_exact_preprovider_resume_v1',
      'releaseSha', p_release_sha,
      'requestFingerprint',
        '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799',
      'requestPayloadSha256',
        'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d',
      'providerMutationStarted', false,
      'gateOpened', false,
      'expiresAt', v_armed_at + interval '30 minutes'
    )
  );

  return jsonb_build_object(
    'contract', 'qoo10_exact_preprovider_resume_v1',
    'jobId', p_job_id,
    'releaseSha', p_release_sha,
    'armedAt', v_armed_at,
    'expiresAt', v_armed_at + interval '30 minutes',
    'bound', false,
    'consumedAt', null,
    'reused', false
  );
end;
$$;

create function sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_claim_token uuid;
  v_worker_token_id uuid;
begin
  if jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object' then
    return false;
  end if;
  v_job_id := (p_old->>'id')::uuid;
  v_claim_token := (p_new->>'claim_token')::uuid;
  v_worker_token_id := (p_new->>'worker_token_id')::uuid;

  if v_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' is distinct from 'queued'
     or p_new->>'status' is distinct from 'running'
     or (p_old->>'attempt_count')::integer is distinct from 0
     or (p_new->>'attempt_count')::integer is distinct from 1
     or p_old->'worker_token_id' is distinct from 'null'::jsonb
     or p_old->'claim_token' is distinct from 'null'::jsonb
     or p_old->'lease_expires_at' is distinct from 'null'::jsonb
     or p_old->'started_at' is distinct from 'null'::jsonb
     or p_old->'completed_at' is distinct from 'null'::jsonb
     or p_old->'response_payload' is distinct from 'null'::jsonb
     or p_old->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_old->'credential_refresh_started_at' is distinct from 'null'::jsonb
     or p_new->'completed_at' is distinct from 'null'::jsonb
     or p_new->'response_payload' is distinct from 'null'::jsonb
     or p_new->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'credential_refresh_started_at' is distinct from 'null'::jsonb
     or p_new->'error_message' is distinct from 'null'::jsonb
     or (p_new->>'started_at')::timestamptz is null
     or (p_new->>'lease_expires_at')::timestamptz <= statement_timestamp()
     or (p_new->>'lease_expires_at')::timestamptz >
          statement_timestamp() + interval '16 minutes'
     or (p_new->>'updated_at')::timestamptz <
          (p_old->>'updated_at')::timestamptz
     or p_new - 'status' - 'worker_token_id' - 'claim_token'
          - 'attempt_count' - 'lease_expires_at' - 'started_at'
          - 'error_message' - 'updated_at'
        is distinct from
        p_old - 'status' - 'worker_token_id' - 'claim_token'
          - 'attempt_count' - 'lease_expires_at' - 'started_at'
          - 'error_message' - 'updated_at'
     or not sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
          v_job_id, '52c0a26c93a3c377b042b65554234fb559bdab3f'
        )
  then
    return false;
  end if;

  update sellerpilot_private.qoo10_exact_preprovider_resume_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = v_worker_token_id,
         bound_claim_token = v_claim_token
   where permit.job_id = v_job_id
     and permit.release_sha = '52c0a26c93a3c377b042b65554234fb559bdab3f'
     and permit.consumed_at is null
     and permit.expires_at > statement_timestamp()
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null;
  return found;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.qoo10_exact_preprovider_resume_permits permit
      join sellerpilot_private.channel_gateway_jobs job on job.id = permit.job_id
     where p_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
       and permit.job_id = p_job_id
       and permit.release_sha = '52c0a26c93a3c377b042b65554234fb559bdab3f'
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_at is not null
       and permit.expires_at > statement_timestamp()
       and job.status = 'running'
       and job.claim_token = p_claim_token
       and job.worker_token_id = permit.bound_worker_token_id
       and job.attempt_count = 1
       and job.started_at is not null
       and job.lease_expires_at > statement_timestamp()
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and job.credential_refresh_started_at is null
       and (
         (
           job.provider_mutation_started_at is null
           and permit.consumed_at is null
         )
         or (
           job.provider_mutation_started_at is not null
           and permit.consumed_at is not null
           and permit.consumed_at >= job.provider_mutation_started_at
         )
       )
       and sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
             p_job_id, permit.release_sha
           )
  )
$$;

create function sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.qoo10_exact_preprovider_resume_permits permit
     set consumed_at = clock_timestamp()
   where permit.job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     and permit.job_id = p_job_id
     and permit.release_sha = '52c0a26c93a3c377b042b65554234fb559bdab3f'
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null
     and permit.expires_at > statement_timestamp()
     and exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = permit.job_id
          and job.status = 'running'
          and job.claim_token = permit.bound_claim_token
          and job.worker_token_id = permit.bound_worker_token_id
          and job.provider_mutation_started_at is not null
          and job.completed_at is null
          and job.response_payload is null
     );
  if not found then
    -- The predecessor marker RPC is coalescing. If its first response was
    -- lost, allow only the already-consumed permit bound to this same claim;
    -- this is not a new permit and cannot bind a different claim.
    return exists (
      select 1
        from sellerpilot_private.qoo10_exact_preprovider_resume_permits permit
        join sellerpilot_private.channel_gateway_jobs job
          on job.id = permit.job_id
       where permit.job_id =
               'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and permit.job_id = p_job_id
         and permit.release_sha =
               '52c0a26c93a3c377b042b65554234fb559bdab3f'
         and permit.bound_claim_token = p_claim_token
         and permit.bound_worker_token_id = job.worker_token_id
         and permit.consumed_at is not null
         and permit.expires_at > statement_timestamp()
         and job.status = 'running'
         and job.claim_token = p_claim_token
         and job.provider_mutation_started_at is not null
         and permit.consumed_at >= job.provider_mutation_started_at
         and job.completed_at is null
         and job.response_payload is null
    );
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    'qoo10_exact_preprovider_resume_consumed',
    'channel_gateway_job',
    p_job_id::text,
    jsonb_build_object(
      'contract', 'qoo10_exact_preprovider_resume_v1',
      'releaseSha', '52c0a26c93a3c377b042b65554234fb559bdab3f',
      'providerMutationStarted', true,
      'gateOpened', false
    )
  );
  return true;
end;
$$;

-- The trigger is the only queued -> running bypass. It binds the worker and
-- claim token atomically with that exact transition and rejects any other row
-- or any additional field mutation while the gate is closed.
create or replace function sellerpilot_private.block_closed_listing_mutation_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'queued'
     and new.status = 'running'
     and (
       old.operation in ('listing.create', 'listing.update', 'listing.stop')
       or new.operation in ('listing.create', 'listing.update', 'listing.stop')
     )
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       coalesce(new.channel, old.channel)
     )
     and not sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim(
       to_jsonb(old), to_jsonb(new)
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function
  public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(
    p_token_hash text,
    p_job_id uuid,
    p_claim_token uuid
  )
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
  v_operation text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.channel, job.operation
    into v_channel, v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;
  if v_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(v_channel)
     and not sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(
       p_job_id, p_claim_token
     )
  then
    return false;
  end if;
  return public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

create or replace function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
  v_operation text;
  v_resume_allowed boolean := false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.channel, job.operation
    into v_channel, v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;
  if v_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(v_channel)
  then
    v_resume_allowed :=
      sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(
        p_job_id, p_claim_token
      );
    if not v_resume_allowed then return false; end if;
  end if;

  v_started :=
    public.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate(
      p_token_hash, p_job_id, p_claim_token
    );
  if v_started and v_resume_allowed
     and not sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider(
       p_job_id, p_claim_token
     )
  then
    raise exception 'exact Qoo10 resume permit consumption failed'
      using errcode = '40001';
  end if;
  return v_started;
end;
$$;

do $exact_qoo10_serverless_provider_chain$
begin
  if to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    return;
  end if;

  execute $inner$
    create or replace function
      public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(
        p_token_hash text,
        p_job_id uuid,
        p_claim_token uuid
      )
    returns boolean
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    declare
      v_channel text;
      v_operation text;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.channel, job.operation
        into v_channel, v_operation
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id;
      if not found then return false; end if;
      if v_operation in ('listing.create', 'listing.update', 'listing.stop')
         and not sellerpilot_private.listing_mutation_release_gate_is_effective(v_channel)
         and not sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(
           p_job_id, p_claim_token
         )
      then
        return false;
      end if;
      return public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
        p_token_hash, p_job_id, p_claim_token
      );
    end;
    $function$
  $inner$;

  execute $outer$
    create or replace function
      public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
        p_token_hash text,
        p_job_id uuid,
        p_claim_token uuid
      )
    returns boolean
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    declare
      v_channel text;
      v_operation text;
      v_resume_allowed boolean := false;
      v_started boolean;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.channel, job.operation
        into v_channel, v_operation
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id;
      if not found then return false; end if;
      if v_operation in ('listing.create', 'listing.update', 'listing.stop')
         and not sellerpilot_private.listing_mutation_release_gate_is_effective(v_channel)
      then
        v_resume_allowed :=
          sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(
            p_job_id, p_claim_token
          );
        if not v_resume_allowed then return false; end if;
      end if;

      v_started :=
        public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(
          p_token_hash, p_job_id, p_claim_token
        );
      if v_started and v_resume_allowed
         and not sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider(
           p_job_id, p_claim_token
         )
      then
        raise exception 'exact Qoo10 resume permit consumption failed'
          using errcode = '40001';
      end if;
      return v_started;
    end;
    $function$
  $outer$;

  execute 'revoke all on function public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role';
end;
$exact_qoo10_serverless_provider_chain$;

revoke all on function
  sellerpilot_private.qoo10_exact_preprovider_resume_release_is_current(text)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.block_closed_listing_mutation_claim()
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(uuid,text)
  to service_role;
grant execute on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  to service_role;

do $exact_qoo10_resume_post_image$
declare
  v_table_oid oid :=
    'sellerpilot_private.qoo10_exact_preprovider_resume_permits'::regclass;
  v_function regprocedure;
begin
  if not exists (
       select 1
         from pg_catalog.pg_class table_row
        where table_row.oid = v_table_oid and table_row.relrowsecurity
     )
     or exists (
       select 1
         from aclexplode(coalesce(
           (select table_row.relacl from pg_catalog.pg_class table_row
             where table_row.oid = v_table_oid),
           acldefault('r', (select table_row.relowner
                              from pg_catalog.pg_class table_row
                             where table_row.oid = v_table_oid))
         )) acl
        where acl.grantee <> (select table_row.relowner
                                from pg_catalog.pg_class table_row
                               where table_row.oid = v_table_oid)
     ) then
    raise exception 'exact Qoo10 resume table ACL post-image mismatch'
      using errcode = '55000';
  end if;

  foreach v_function in array array[
    'sellerpilot_private.qoo10_exact_preprovider_resume_release_is_current(text)'::regprocedure,
    'sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(uuid,text)'::regprocedure,
    'sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(uuid,uuid)'::regprocedure,
    'sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider(uuid,uuid)'::regprocedure,
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure,
    'public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)'::regprocedure
  ] loop
    if pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
    then
      raise exception 'exact Qoo10 private function ACL mismatch: %', v_function
        using errcode = '55000';
    end if;
  end loop;

  foreach v_function in array array[
    'public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(uuid,text)'::regprocedure,
    'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
  ] loop
    if not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
    then
      raise exception 'exact Qoo10 service function ACL mismatch: %', v_function
        using errcode = '55000';
    end if;
  end loop;
end;
$exact_qoo10_resume_post_image$;

do $exact_qoo10_resume_core_function_postimages$
declare
  v_count integer := 0;
  v_row record;
  v_expected_sha text;
  v_expected_security_definer boolean;
  v_expected_service_execute boolean;
begin
  for v_row in
    select function_row.oid,
           function_row.oid::regprocedure::text as signature,
           encode(
             extensions.digest(
               pg_catalog.pg_get_functiondef(function_row.oid), 'sha256'
             ),
             'hex'
           ) as definition_sha,
           pg_catalog.pg_get_userbyid(function_row.proowner) as owner_name,
           function_row.prosecdef,
           function_row.provolatile,
           function_row.proconfig,
           pg_catalog.has_function_privilege(
             'service_role', function_row.oid, 'EXECUTE'
           ) as service_execute,
           pg_catalog.has_function_privilege(
             'anon', function_row.oid, 'EXECUTE'
           ) as anon_execute,
           pg_catalog.has_function_privilege(
             'authenticated', function_row.oid, 'EXECUTE'
           ) as authenticated_execute
      from pg_catalog.pg_proc function_row
     where function_row.oid in (
       'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure,
       'public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)'::regprocedure,
       'public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'::regprocedure,
       'public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)'::regprocedure,
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
     )
     order by signature
  loop
    v_count := v_count + 1;
    case v_row.signature
      when 'sellerpilot_private.block_closed_listing_mutation_claim()' then
        v_expected_sha :=
          '97c7ba15ff3f5f76c8be7eecc1950d26b05d008c23bce1e99c34417b55ebf2aa';
        v_expected_security_definer := false;
        v_expected_service_execute := false;
      when 'sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(text,uuid,uuid)' then
        v_expected_sha :=
          'c2cbfdc4342759222c469f60827012d1d1dcf246a6b1c1ae40f1cd46a4a6dbb5';
        v_expected_security_definer := true;
        v_expected_service_execute := false;
      when 'sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)' then
        v_expected_sha :=
          '335a723ef61592abe2c5c7dd97d43f8c1aa9ac56923c97417355a32740951025';
        v_expected_security_definer := true;
        v_expected_service_execute := true;
      when 'sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)' then
        v_expected_sha :=
          '893b7c40e6b36251c27ec093c001d46bbb5a31d62afccd63ce50812b6b2024b3';
        v_expected_security_definer := true;
        v_expected_service_execute := false;
      when 'sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)' then
        v_expected_sha :=
          'b13d2c69191a32c3d0a944298647a1436570aa0a8e50dcc92a49448770265059';
        v_expected_security_definer := true;
        v_expected_service_execute := true;
      else
        raise exception 'unexpected exact Qoo10 resume post-image: %',
          v_row.signature using errcode = '55000';
    end case;

    if v_row.definition_sha is distinct from v_expected_sha
       or v_row.owner_name is distinct from 'postgres'
       or v_row.prosecdef is distinct from v_expected_security_definer
       or v_row.provolatile is distinct from 'v'::"char"
       or v_row.proconfig is distinct from array['search_path=""']::text[]
       or v_row.service_execute is distinct from v_expected_service_execute
       or v_row.anon_execute
       or v_row.authenticated_execute
    then
      raise exception 'exact Qoo10 resume function post-image mismatch: %',
        v_row.signature using errcode = '55000';
    end if;
  end loop;

  if v_count <> 5 then
    raise exception 'exact Qoo10 resume requires all five function post-images'
      using errcode = '55000';
  end if;
end;
$exact_qoo10_resume_core_function_postimages$;

comment on table sellerpilot_private.qoo10_exact_preprovider_resume_permits is
  'One non-renewable release-52c0a26 permit for fac9c5c4 only; gate remains closed.';
comment on function
  public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(uuid,text) is
  'Service-only one-shot arm RPC for exact pre-provider Qoo10 job fac9c5c4; never opens or bypasses enqueue.';

commit;
