-- Admit only the already fenced eBay exact-existing listing.update job to the
-- serverless worker. The provider boundary remains the independent, one-shot
-- exact_existing_update permit enforced by the 20260901080000 migration.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

-- Serialize with both the serverless runtime and the exact-permit state
-- machine. Row writers are frozen while the expired, never-claimed production
-- tuple is inspected and (only if it still matches) re-armed for five minutes.
select pg_catalog.pg_advisory_xact_lock(193674993, 821065060);
select pg_catalog.pg_advisory_xact_lock(193674993, 908000001);
select pg_catalog.pg_advisory_xact_lock(193674993, 916450001);

lock table sellerpilot_private.channel_gateway_jobs
  in share row exclusive mode;
lock table sellerpilot_private.channel_operation_attempts
  in share row exclusive mode;
lock table sellerpilot_private.product_listings
  in share row exclusive mode;
lock table sellerpilot_private.exact_existing_update_permits
  in share row exclusive mode;
lock table sellerpilot_private.operation_audit
  in share row exclusive mode;

do $ebay_serverless_update_preimage$
declare
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.serverless_gateway_job_allowed(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_arguments_valid(text,jsonb,text,text,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_release_is_current(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)'
     ) is null
  then
    raise exception 'eBay serverless listing.update preimage missing'
      using errcode = '55000';
  end if;

  if sellerpilot_private.serverless_gateway_job_allowed(
       'ebay', 'listing.update'
     )
  then
    raise exception 'eBay serverless listing.update is already allowed'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
         )
    into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.exact_existing_update_provider_allowed'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.consume_exact_existing_update_provider'
     ) = 0
  then
    raise exception 'eBay exact provider permit boundary is not installed'
      using errcode = '55000';
  end if;
end
$ebay_serverless_update_preimage$;

create temporary table ebay_serverless_update_fence_preimage
on commit drop
as
select pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
       )) as permit_guard_md5,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure
       )) as job_guard_md5,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
       )) as provider_boundary_md5;

-- The production job was created by the application but its five-minute
-- permit expired while the serverless pair was omitted from the database
-- allowlist. It is still queued, unclaimed, and pre-provider. Re-arm that one
-- immutable tuple in place so the existing runtime SHA can claim it as soon
-- as this transaction exposes the pair. No general TTL or retry rule changes.
do $rearm_exact_ebay_unclaimed_job$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_listing_id constant uuid :=
    '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid;
  v_source_attempt_id constant uuid :=
    '07b8ced8-fa77-4c22-a708-2ce1ec4e3c77'::uuid;
  v_attempt_id constant uuid :=
    '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid;
  v_job_id constant uuid :=
    '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid;
  v_permit_id constant uuid :=
    'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid;
  v_credential_id constant uuid :=
    '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid;
  v_release_sha constant text :=
    '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b';
  v_request_fingerprint constant text :=
    '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc';
  v_arguments_sha256 constant text :=
    '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569';
  v_request_payload_sha256 constant text :=
    '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d';
  v_seller_account_key constant text :=
    'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f';
  v_original_armed_at constant timestamptz :=
    '2026-09-01 07:50:52.964294+00'::timestamptz;
  v_original_expires_at constant timestamptz :=
    '2026-09-01 07:55:52.964294+00'::timestamptz;
  v_rearmed_at timestamptz := clock_timestamp();
  v_present_rows integer;
  v_updated_rows integer;
begin
  select
    (select count(*)
       from sellerpilot_private.channel_gateway_jobs job
      where job.id = v_job_id)
    +
    (select count(*)
       from sellerpilot_private.exact_existing_update_permits permit
      where permit.permit_id = v_permit_id)
    into v_present_rows;

  -- Clean local/database replay fixtures contain neither production row.
  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 2 then
    raise exception 'EBAY_SERVERLESS_EXACT_REARM_TUPLE_INCOMPLETE'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.operation_audit audit
     where audit.action = 'ebay_serverless_exact_permit_rearmed'
       and audit.entity_type = 'channel_gateway_job'
       and audit.entity_id = v_job_id::text
  ) then
    raise exception 'EBAY_SERVERLESS_EXACT_REARM_ALREADY_RECORDED'
      using errcode = '55000';
  end if;

  perform 1
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = job.channel
     and credential.seller_account_key = job.seller_account_key
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = v_permit_id
     and permit.update_job_id = job.id
     and permit.update_attempt_id = attempt.id
     and permit.listing_id = listing.id
     and permit.product_id = product.id
     and permit.credential_id = credential.id
     and permit.owner_id = listing.owner_id
     and permit.seller_account_key = listing.seller_account_key
   where job.id = v_job_id
     and job.credential_id = v_credential_id
     and job.attempt_id = v_attempt_id
     and job.listing_id = v_listing_id
     and job.channel = 'ebay'
     and job.operation = 'listing.update'
     and job.environment = 'production'
     and job.status = 'queued'
     and job.attempt_count = 0
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.started_at is null
     and job.completed_at is null
     and job.provider_mutation_started_at is null
     and job.response_payload is null
     and job.error_message is null
     and not job.credential_refresh_in_flight
     and job.credential_refresh_started_at is null
     and job.credential_refresh_prepared_at is null
     and job.prepared_credential_id is null
     and job.credential_refresh_recovery_vault_id is null
     and job.oauth_provider_call_started_at is null
     and job.request_fingerprint = v_request_fingerprint
     and encode(extensions.digest(
           (job.request_payload->'arguments')::text, 'sha256'
         ), 'hex') = v_arguments_sha256
     and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') =
           v_request_payload_sha256
     and job.request_payload#>>
           '{arguments,sellerpilotEbayExactExistingQaRecovery,contract}' =
           'ebay_exact_existing_qa_recovery_v2'
     and job.request_payload#>>
           '{arguments,sellerpilotEbayExactExistingQaRecovery,listingId}' =
           v_listing_id::text
     and job.request_payload#>>
           '{arguments,sellerpilotEbayExactExistingQaRecovery,credentialId}' =
           v_credential_id::text
     and listing.id = v_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'ebay'
     and listing.status = 'queued'
     and listing.failure_class is null
     and listing.operation_attempt_id = v_attempt_id
     and listing.last_error is null
     and listing.remote_id = '800551945442'
     and listing.market = 'US'
     and listing.target_id = 'EBAY_US'
     and listing.marketplace_sku = 'QA-20260823-CC-001-US'
     and listing.provider_resource_id = '244042196011'
     and listing.currency = 'USD'
     and listing.price = 12.90
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.remote_resources = '{}'::jsonb
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand between 1 and 999999
     and not product.demo
     and product.status <> 'archived'
     and exists (
       select 1
         from sellerpilot_private.channel_operation_attempts source_attempt
        where source_attempt.id = v_source_attempt_id
          and source_attempt.owner_id = v_owner_id
          and source_attempt.channel = 'ebay'
     )
     and attempt.id = v_attempt_id
     and attempt.owner_id = v_owner_id
     and attempt.credential_id = v_credential_id
     and attempt.channel = 'ebay'
     and attempt.operation = 'listing.update'
     and attempt.status = 'running'
     and attempt.http_status is null
     and attempt.remote_id is null
     and attempt.safe_message is null
     and attempt.completed_at is null
     and attempt.gateway_write_required
     and not attempt.pre_gateway_retryable
     and attempt.request_fingerprint = v_request_fingerprint
     and attempt.seller_account_key = v_seller_account_key
     and credential.id = v_credential_id
     and sellerpilot_private.ebay_exact_current_credential_is_valid(
           credential.id, v_seller_account_key
         )
     and permit.channel = 'ebay'
     and permit.release_sha = v_release_sha
     and permit.request_fingerprint = v_request_fingerprint
     and permit.arguments_sha256 = v_arguments_sha256
     and permit.arguments_bytes = octet_length(
           (job.request_payload->'arguments')::text
         )
     and permit.request_payload_sha256 = v_request_payload_sha256
     and permit.request_payload_bytes = octet_length(job.request_payload::text)
     and permit.armed_at = v_original_armed_at
     and permit.expires_at = v_original_expires_at
     and permit.expires_at <= statement_timestamp()
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and sellerpilot_private.exact_existing_update_release_is_current(
           'ebay', v_release_sha
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           'ebay', job.request_payload->'arguments', v_release_sha,
           v_request_fingerprint, permit.stock
         )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_active
        where other_active.listing_id = v_listing_id
          and other_active.id <> v_job_id
          and other_active.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'price.update', 'inventory.update'
          )
          and other_active.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   for update of job, attempt, listing, product, credential, permit;

  if not found then
    raise exception 'EBAY_SERVERLESS_EXACT_REARM_PREFLIGHT_MISMATCH'
      using errcode = '55000';
  end if;

  execute 'alter table sellerpilot_private.exact_existing_update_permits disable trigger guard_exact_existing_update_permit_transition';

  update sellerpilot_private.exact_existing_update_permits permit
     set armed_at = v_rearmed_at,
         expires_at = v_rearmed_at + interval '5 minutes'
   where permit.permit_id = v_permit_id
     and permit.channel = 'ebay'
     and permit.listing_id = v_listing_id
     and permit.credential_id = v_credential_id
     and permit.release_sha = v_release_sha
     and permit.request_fingerprint = v_request_fingerprint
     and permit.update_job_id = v_job_id
     and permit.update_attempt_id = v_attempt_id
     and permit.arguments_sha256 = v_arguments_sha256
     and permit.request_payload_sha256 = v_request_payload_sha256
     and permit.armed_at = v_original_armed_at
     and permit.expires_at = v_original_expires_at
     and permit.expires_at <= statement_timestamp()
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null;
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'EBAY_SERVERLESS_EXACT_REARM_UPDATE_FAILED'
      using errcode = '55000';
  end if;

  execute 'alter table sellerpilot_private.exact_existing_update_permits enable trigger guard_exact_existing_update_permit_transition';

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail, occurred_at
  ) values (
    v_owner_id,
    'ebay_serverless_exact_permit_rearmed',
    'channel_gateway_job',
    v_job_id::text,
    jsonb_build_object(
      'contract', 'ebay_serverless_exact_permit_rearm_v1',
      'productId', v_product_id,
      'listingId', v_listing_id,
      'remoteId', '800551945442',
      'providerResourceId', '244042196011',
      'credentialId', v_credential_id,
      'attemptId', v_attempt_id,
      'jobId', v_job_id,
      'permitId', v_permit_id,
      'releaseSha', v_release_sha,
      'requestFingerprint', v_request_fingerprint,
      'argumentsSha256', v_arguments_sha256,
      'requestPayloadSha256', v_request_payload_sha256,
      'previousArmedAt', v_original_armed_at,
      'previousExpiresAt', v_original_expires_at,
      'rearmedAt', v_rearmed_at,
      'expiresAt', v_rearmed_at + interval '5 minutes',
      'permitTtlSeconds', 300,
      'attemptCount', 0,
      'workerClaimed', false,
      'providerMutationStarted', false,
      'providerCallReplayed', false
    ),
    v_rearmed_at
  );
end
$rearm_exact_ebay_unclaimed_job$;

create temporary table ebay_serverless_update_allowlist_preimage
on commit drop
as
with channels(channel) as (
  values
    ('qoo10'), ('shopee'), ('lazada'), ('coupang'),
    ('elevenst'), ('temu'), ('smartstore'), ('ebay')
), operations(operation) as (
  values
    ('diagnostic.test'),
    ('categories.list'), ('categories.suggest'),
    ('categories.attributes'), ('categories.validate'),
    ('orders.list'), ('orders.get'),
    ('inquiries.list'), ('inquiries.reply'),
    ('shops.get'), ('competitor.search'),
    ('listing.lineage.verify'),
    ('listing.create'), ('listing.update'), ('listing.stop'),
    ('listing.activate'), ('listing.publication.verify'),
    ('price.update'), ('inventory.update'),
    ('shipment.acknowledge'), ('shipment.confirm'),
    ('oauth.exchange')
)
select channel,
       operation,
       sellerpilot_private.serverless_gateway_job_allowed(
         channel, operation
       ) as allowed
  from channels
 cross join operations;

create or replace function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_channel = 'ebay' and p_operation = 'listing.update' then true
    when p_operation = 'listing.activate' then p_channel in ('qoo10','temu')
    when p_operation = 'listing.publication.verify' and p_channel = 'temu'
      then true
    else sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(
      p_channel, p_operation
    )
  end
$$;

revoke all on function
  sellerpilot_private.serverless_gateway_job_allowed(text, text)
  from public, anon, authenticated, service_role;

do $ebay_serverless_update_postimage$
declare
  v_definition text;
begin
  if not sellerpilot_private.serverless_gateway_job_allowed(
       'ebay', 'listing.update'
     )
     or exists (
       select 1
         from ebay_serverless_update_allowlist_preimage preimage
        where (preimage.channel, preimage.operation)
              is distinct from ('ebay'::text, 'listing.update'::text)
          and sellerpilot_private.serverless_gateway_job_allowed(
                preimage.channel, preimage.operation
              ) is distinct from preimage.allowed
     )
     or exists (
       select 1
         from (values
           ('public'::name), ('anon'::name), ('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'sellerpilot_private.serverless_gateway_job_allowed(text,text)',
          'EXECUTE'
        )
     )
  then
    raise exception 'eBay serverless listing.update postimage invalid'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
           'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
         )
    into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.exact_existing_update_provider_allowed'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.consume_exact_existing_update_provider'
     ) = 0
  then
    raise exception 'eBay exact provider permit boundary changed unexpectedly'
      using errcode = '55000';
  end if;

  if exists (
       select 1
         from ebay_serverless_update_fence_preimage preimage
        where preimage.permit_guard_md5 is distinct from pg_catalog.md5(
                pg_catalog.pg_get_functiondef(
                  'sellerpilot_private.guard_exact_existing_update_permit_transition()'::regprocedure
                )
              )
           or preimage.job_guard_md5 is distinct from pg_catalog.md5(
                pg_catalog.pg_get_functiondef(
                  'sellerpilot_private.guard_exact_existing_update_job()'::regprocedure
                )
              )
           or preimage.provider_boundary_md5 is distinct from pg_catalog.md5(
                pg_catalog.pg_get_functiondef(
                  'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure
                )
              )
     )
     or not exists (
       select 1
         from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid =
              'sellerpilot_private.exact_existing_update_permits'::regclass
          and trigger_row.tgname =
              'guard_exact_existing_update_permit_transition'
          and trigger_row.tgenabled = 'O'
          and not trigger_row.tgisinternal
     )
  then
    raise exception 'eBay exact permit guards changed unexpectedly'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
  ) and not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = job.attempt_id
      join sellerpilot_private.product_listings listing
        on listing.id = job.listing_id
      join sellerpilot_private.exact_existing_update_permits permit
        on permit.permit_id =
             'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
       and permit.update_job_id = job.id
       and permit.update_attempt_id = attempt.id
      join sellerpilot_private.operation_audit audit
        on audit.action = 'ebay_serverless_exact_permit_rearmed'
       and audit.entity_type = 'channel_gateway_job'
       and audit.entity_id = job.id::text
     where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
       and job.channel = 'ebay'
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.status = 'queued'
       and job.attempt_count = 0
       and job.worker_token_id is null
       and job.claim_token is null
       and job.lease_expires_at is null
       and job.started_at is null
       and job.completed_at is null
       and job.provider_mutation_started_at is null
       and job.response_payload is null
       and job.error_message is null
       and not job.credential_refresh_in_flight
       and job.oauth_provider_call_started_at is null
       and job.credential_id =
             '9e7de791-e6e6-4255-8d61-5a1f9576d797'::uuid
       and job.attempt_id =
             '22457f2e-51d8-43c5-bb03-d2c1bb7fe697'::uuid
       and job.listing_id =
             '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
       and job.request_fingerprint =
             '79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc'
       and encode(extensions.digest(
             (job.request_payload->'arguments')::text, 'sha256'
           ), 'hex') =
             '7ba187bf54fd6b22a012bdacbdb5508ccdd6e7b124f6b943e2e1d54287cdf569'
       and encode(extensions.digest(
             job.request_payload::text, 'sha256'
           ), 'hex') =
             '35f62d099968e998ed6f87bc9fc8c18a0d6467501dddc716adb1824473742f9d'
       and attempt.status = 'running'
       and attempt.http_status is null
       and attempt.completed_at is null
       and not attempt.pre_gateway_retryable
       and listing.status = 'queued'
       and listing.failure_class is null
       and listing.operation_attempt_id = attempt.id
       and listing.remote_id = '800551945442'
       and permit.channel = 'ebay'
       and permit.listing_id = listing.id
       and permit.credential_id = job.credential_id
       and permit.release_sha =
             '031d45077aa55ed0ca1eb3f85ccb4abbe52b7c9b'
       and permit.request_fingerprint = job.request_fingerprint
       and permit.armed_at >
             '2026-09-01 07:55:52.964294+00'::timestamptz
       and permit.expires_at = permit.armed_at + interval '5 minutes'
       and permit.expires_at > statement_timestamp()
       and permit.bound_at is null
       and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null
       and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.invalidation_reason is null
       and audit.owner_id =
             '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and audit.safe_detail->>'contract' =
             'ebay_serverless_exact_permit_rearm_v1'
       and audit.safe_detail->>'providerCallReplayed' = 'false'
  ) then
    raise exception 'eBay exact unclaimed job rearm postimage invalid'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id = '08e8cff9-5d7c-4992-b668-6d932aa5ff10'::uuid
     ) and exists (
       select 1
         from sellerpilot_private.exact_existing_update_permits permit
        where permit.permit_id =
              'c2e9f199-f6a7-425f-8668-7eebd5b08bb4'::uuid
       union all
       select 1
         from sellerpilot_private.operation_audit audit
        where audit.action = 'ebay_serverless_exact_permit_rearmed'
          and audit.entity_type = 'channel_gateway_job'
          and audit.entity_id =
              '08e8cff9-5d7c-4992-b668-6d932aa5ff10'
     )
  then
    raise exception 'eBay exact rearm clean replay postimage invalid'
      using errcode = '55000';
  end if;
end
$ebay_serverless_update_postimage$;

commit;
