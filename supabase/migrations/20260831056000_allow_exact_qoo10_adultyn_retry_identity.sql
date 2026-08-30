-- Preserve the original Qoo10 create-rollback retry identity while allowing
-- the one exact AdultYN rejection evidence recorded by 20260831055000 to
-- remain the current verification source. This migration never opens the
-- publication gate, creates a gateway job, or calls Qoo10.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

select pg_catalog.pg_advisory_xact_lock(193674993, 1415336750);

do $qoo10_adultyn_retry_identity_preflight$
declare
  v_identity_definition text;
  v_enqueue_definition text;
  v_outer_enqueue_definition text;
  v_claim_definition text;
begin
  if not exists (
    select 1
      from sellerpilot_private.listing_mutation_release_gate gate
     where gate.singleton
       and not gate.is_open
       and gate.opened_at is null
       and gate.opened_release_sha is null
       and gate.opened_channel is null
  ) or sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10') then
    raise exception 'Qoo10 AdultYN retry identity patch requires closed gate'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_identity_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_outer_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
  ) into v_claim_definition;

  if encode(extensions.digest(v_identity_definition, 'sha256'), 'hex') is distinct from
       '5db53e5f921c497df1faf8b9c3ff1b4f68bad873763c80e8f35d882fbfc78dab'
     or encode(extensions.digest(v_enqueue_definition, 'sha256'), 'hex') is distinct from
       '4b62884414366a00f2729bf775aa355628b6b2a2b8020fc5eca3509340d306e2'
     or encode(extensions.digest(v_outer_enqueue_definition, 'sha256'), 'hex') is distinct from
       'b1e6272328e57f3bf012ddd2ff4bcde0972a4b08cce23e09d41278b39c934412'
     or encode(extensions.digest(v_claim_definition, 'sha256'), 'hex') is distinct from
       '6be63710e119958b8df3da93a7035c90975181898a2da8247e84b75f8581edac' then
    raise exception 'Qoo10 AdultYN retry identity function pre-image drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
          and owner_role.rolname = 'postgres'
          and function_row.prosecdef
          and function_row.provolatile = 's'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        ) then
    raise exception 'Qoo10 rollback identity ACL pre-image drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
          and owner_role.rolname = 'postgres'
          and function_row.prosecdef
          and function_row.provolatile = 'v'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        ) then
    raise exception 'Qoo10 internal enqueue ACL pre-image drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
          and owner_role.rolname = 'postgres'
          and function_row.prosecdef
          and function_row.provolatile = 'v'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        ) then
    raise exception 'Qoo10 outer enqueue ACL pre-image drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
          and owner_role.rolname = 'postgres'
          and function_row.prosecdef
          and function_row.provolatile = 'v'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or not pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)',
          'EXECUTE'
        ) then
    raise exception 'channel operation claim ACL pre-image drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_adultyn_retry_identity_preflight$;

create or replace function
  sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(
    p_listing_id uuid,
    p_credential_id uuid,
    p_product_id uuid,
    p_market text,
    p_target_id text
  )
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
      join sellerpilot_private.product_listings listing
        on listing.id = evidence.listing_id
       and listing.product_id = evidence.product_id
      join sellerpilot_private.products product
        on product.id = evidence.product_id
       and product.owner_id = listing.owner_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = evidence.credential_id
      join sellerpilot_private.qoo10_listing_create_rollback_confirmations confirmation
        on confirmation.source_job_id = evidence.source_job_id
       and confirmation.source_attempt_id = evidence.source_attempt_id
       and confirmation.listing_id = evidence.listing_id
       and confirmation.credential_id = evidence.credential_id
       and confirmation.remote_id = evidence.remote_id
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
      join sellerpilot_private.operation_audit audit
        on audit.owner_id = listing.owner_id
       and audit.action = 'qoo10_exact_adultyn_rejection_reconciled'
       and audit.entity_type = 'channel_gateway_job'
       and audit.entity_id = evidence.job_id::text
       and audit.safe_detail is not distinct from
         sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
     where p_listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and p_credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and p_market = 'JP'
       and p_target_id = ''
       and evidence.job_id = 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid
       and evidence.attempt_id = 'c19956d8-67d3-465b-90cd-a41b9123ad4e'::uuid
       and evidence.listing_id = p_listing_id
       and evidence.product_id = p_product_id
       and evidence.credential_id = p_credential_id
       and evidence.source_job_id = '0bc5ff1f-c884-4615-8a79-4688da46af6a'::uuid
       and evidence.source_attempt_id = '05e1959d-d7d8-4389-b7de-7335d28e4f91'::uuid
       and evidence.baseline_update_job_id = '2b56d31c-9d88-4df6-9be0-ab2aebc2c918'::uuid
       and evidence.baseline_response_sha256 =
         '6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f'
       and evidence.remote_id = '1217336970'
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
       and evidence.mismatch_paths = array['ItemDescription.text', 'Keyword']::text[]
       and evidence.provider_changed_date = '2026-08-30 21:57:11'
       and evidence.provider_observed_at =
         '2026-08-30 21:32:29.567929+00'::timestamptz
       and not evidence.provider_mutation_accepted
       and not evidence.provider_call_replayed
       and listing.id = p_listing_id
       and listing.product_id = p_product_id
       and listing.channel_key = 'qoo10'
       and listing.market = p_market
       and listing.target_id = p_target_id
       and listing.status = 'paused'
       and listing.failure_class = 'retryable'
       and listing.requested_publication_intent = 'live'
       and listing.remote_visibility = 'non_public'
       and listing.provider_status = 'S1'
       and listing.remote_id = evidence.remote_id
       and listing.seller_account_key = confirmation.seller_account_key
       and listing.operation_attempt_id = evidence.source_attempt_id
       and listing.published_at is null
       and listing.last_verified_at = evidence.provider_observed_at
       and listing.last_error =
         'Qoo10 원격 상품 비공개(S1) 확인 완료 · AdultYN 포함 listing.update 재시도 필요'
       and listing.updated_at = evidence.reconciled_at
       and not product.demo
       and product.status <> 'archived'
       and credential.channel = 'qoo10'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null or credential.expires_at > statement_timestamp())
       and credential.fingerprint = confirmation.credential_fingerprint
       and credential.seller_account_key = confirmation.seller_account_key
       and credential.seller_account_key_source in (
         'provider_certified_v1', 'credential_incarnation_v1'
       )
       and credential.seller_account_verified_at is not null
       and confirmation.category_code = '320000542'
       and confirmation.retail_price_jpy = 1871
       and confirmation.sell_price_jpy = 1871
       and confirmation.quantity = 1
       and confirmation.shipping_no = '0'
       and confirmation.bi_contents_no = 8461402963
       and confirmation.new_provider_status = 'S1'
       and confirmation.confirmed_at =
         '2026-08-30 14:51:26.505498+00'::timestamptz
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
       and adult_job.created_at = '2026-08-30 21:29:28.87921+00'::timestamptz
       and adult_job.started_at = '2026-08-30 21:32:19.498509+00'::timestamptz
       and adult_job.completed_at = evidence.provider_observed_at
       and adult_job.updated_at = evidence.reconciled_at
       and encode(extensions.digest(adult_job.request_payload::text, 'sha256'), 'hex') =
         evidence.request_sha256
       and encode(extensions.digest(adult_job.response_payload::text, 'sha256'), 'hex') =
         evidence.response_sha256
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
       and baseline_observation.provider_rejection_reason = 'ProductionPlaceType_required'
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
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs later_job
          where later_job.listing_id = evidence.listing_id
            and later_job.operation in ('listing.create', 'listing.update', 'listing.stop')
            and later_job.created_at > adult_job.created_at
       )
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;

do $qoo10_adultyn_retry_identity_patch$
declare
  v_definition text;
  v_anchor text;
  v_replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_definition;
  v_anchor := '     and listing.last_verified_at = confirmation.confirmed_at
     and listing.last_error =
       ''Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요''';
  v_replacement := '     and (
       (
         listing.last_verified_at = confirmation.confirmed_at
         and listing.last_error =
           ''Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요''
       )
       or sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(
         p_listing_id, p_credential_id, p_product_id, p_market, p_target_id
       )
     )';
  if sellerpilot_private.qoo10_definition_occurrences(v_definition, v_anchor) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed('
        ) <> 0 then
    raise exception 'Qoo10 rollback identity patch anchor drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  v_anchor := '         and listing.last_verified_at = confirmation.confirmed_at
         and listing.last_error =
           ''Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요''';
  v_replacement := '         and (
           (
             listing.last_verified_at = confirmation.confirmed_at
             and listing.last_error =
               ''Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요''
           )
           or sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(
             p_listing_id,
             p_credential_id,
             listing.product_id,
             listing.market,
             listing.target_id
           )
         )';
  if sellerpilot_private.qoo10_definition_occurrences(v_definition, v_anchor) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_definition,
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed('
        ) <> 0 then
    raise exception 'Qoo10 internal enqueue patch anchor drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
end;
$qoo10_adultyn_retry_identity_patch$;

revoke all on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid, uuid, uuid, text, text
  ) to service_role;
revoke all on function
  public.sellerpilot_310500_enqueue_listing_before_channel_gate(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

do $qoo10_adultyn_retry_identity_postimage$
declare
  v_helper_definition text;
  v_identity_definition text;
  v_enqueue_definition text;
  v_outer_enqueue_definition text;
  v_claim_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_helper_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into v_identity_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_outer_enqueue_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
  ) into v_claim_definition;

  if encode(extensions.digest(v_helper_definition, 'sha256'), 'hex') is distinct from
       '56c165eb8e08ba67192944b9b7ac9a18687d74cde3327e62568d4c9459660a34'
     or encode(extensions.digest(v_identity_definition, 'sha256'), 'hex') is distinct from
       'c47e80ae0fbe9f872383d1a1e1412053f00106e809055b7b1ff82af86a843256'
     or encode(extensions.digest(v_enqueue_definition, 'sha256'), 'hex') is distinct from
       'ce0e788743b15eb7fc40b5b8a102da6bbc5f3fd5cebb7ac2f85ad2baa99b7bfd'
     or sellerpilot_private.qoo10_definition_occurrences(
       v_identity_definition,
       'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed('
     ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_enqueue_definition,
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed('
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_identity_definition,
          'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요'
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_enqueue_definition,
          'Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요'
        ) <> 1
     or encode(extensions.digest(v_outer_enqueue_definition, 'sha256'), 'hex') is distinct from
       'b1e6272328e57f3bf012ddd2ff4bcde0972a4b08cce23e09d41278b39c934412'
     or encode(extensions.digest(v_claim_definition, 'sha256'), 'hex') is distinct from
       '6be63710e119958b8df3da93a7035c90975181898a2da8247e84b75f8581edac' then
    raise exception 'Qoo10 AdultYN retry identity function post-image drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)'::regprocedure
          and owner_role.rolname = 'postgres'
          and not function_row.prosecdef
          and function_row.provolatile = 's'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or pg_catalog.has_function_privilege(
          'service_role',
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        ) then
    raise exception 'Qoo10 AdultYN retry identity helper ACL post-image drifted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
          and owner_role.rolname = 'postgres'
          and function_row.prosecdef
          and function_row.provolatile = 's'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or not pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)',
          'EXECUTE'
        )
     or not exists (
       select 1
         from pg_catalog.pg_proc function_row
         join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
        where function_row.oid =
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
          and owner_role.rolname = 'postgres'
          and function_row.prosecdef
          and function_row.provolatile = 'v'
          and function_row.proconfig = array['search_path=""']::text[]
     )
     or pg_catalog.has_function_privilege(
          'service_role',
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'anon',
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        )
     or pg_catalog.has_function_privilege(
          'authenticated',
          'public.sellerpilot_310500_enqueue_listing_before_channel_gate(uuid,uuid,uuid,text,text,jsonb)',
          'EXECUTE'
        ) then
    raise exception 'Qoo10 AdultYN retry identity ACL post-image drifted'
      using errcode = '55000';
  end if;

  if exists (
       select 1
         from sellerpilot_private.qoo10_adultyn_rejection_reconciliations evidence
        where evidence.job_id = 'c25d3154-4110-4a25-9659-8e56aacf1b8d'::uuid
     ) and not sellerpilot_private.qoo10_exact_adultyn_retry_identity_allowed(
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid,
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid,
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
       'JP',
       ''
     ) then
    raise exception 'Qoo10 exact AdultYN evidence is not retry-identity eligible'
      using errcode = '55000';
  end if;
end;
$qoo10_adultyn_retry_identity_postimage$;

commit;
