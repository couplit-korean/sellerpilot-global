-- The exact-existing permit has two different ledger phases. Before enqueue,
-- the listing must still be the exact failed/external-action row captured by
-- the permit. The predecessor enqueue then atomically changes that same row to
-- queued, clears failure_class, binds operation_attempt_id, and inserts the
-- gateway job. Reusing the pre-enqueue predicate after that state transition
-- rolls the whole transaction back. Keep the original predicate for arming and
-- preflight, and use a separate queued/running predicate after the predecessor.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 911400001);

do $install_exact_existing_enqueued_lineage_phase$
begin
  -- Bounded migration-contract tests replay older schema prefixes. A prefix
  -- without the exact permit ledger is outside this forward patch and must be
  -- a clean no-op rather than synthesizing part of the subsystem.
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  execute $ddl$
create function sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
  p_permit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from sellerpilot_private.exact_existing_update_permits permit
      join sellerpilot_private.product_listings listing
        on listing.id = permit.listing_id
       and listing.product_id = permit.product_id
       and listing.owner_id = permit.owner_id
       and listing.channel_key = permit.channel
       and listing.market = permit.market
       and listing.target_id = permit.target_id
       and listing.remote_id = permit.remote_id
       and listing.currency = permit.currency
       and listing.price = permit.price
       and listing.seller_account_key = permit.seller_account_key
      join sellerpilot_private.products product
        on product.id = permit.product_id
       and product.owner_id = permit.owner_id
       and product.sku = case permit.channel
         when 'ebay' then 'QA-20260823-CC-001'
         else permit.seller_sku
       end
       and product.on_hand = permit.stock
       and not product.demo
       and product.status <> 'archived'
      join sellerpilot_private.channel_credentials credential
        on credential.id = permit.credential_id
       and credential.channel = permit.channel
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.version = permit.credential_version
       and credential.fingerprint = permit.credential_fingerprint
       and credential.seller_account_key = permit.seller_account_key
       and credential.seller_account_key_source =
             permit.credential_account_source
       and credential.seller_account_verified_at =
             permit.credential_verified_at
       and credential.expires_at is not distinct from
             permit.credential_expires_at
       and credential.last_checked_at is not distinct from
             permit.credential_last_checked_at
       and credential.last_check_status is not distinct from
             permit.credential_last_check_status
       and (credential.expires_at is null
         or credential.expires_at > statement_timestamp())
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = listing.operation_attempt_id
       and attempt.owner_id = permit.owner_id
       and attempt.credential_id = permit.credential_id
       and attempt.channel = permit.channel
       and attempt.operation = 'listing.update'
       and attempt.status = 'running'
       and attempt.seller_account_key = permit.seller_account_key
       and attempt.request_fingerprint = permit.request_fingerprint
      join sellerpilot_private.channel_gateway_jobs job
        on job.attempt_id = attempt.id
       and job.listing_id = permit.listing_id
       and job.credential_id = permit.credential_id
       and job.channel = permit.channel
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.status in ('queued', 'running')
       and job.seller_account_key = permit.seller_account_key
       and job.request_fingerprint = permit.request_fingerprint
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
      left join sellerpilot_private.elevenst_listing_snapshots snapshot
        on permit.channel = 'elevenst'
       and snapshot.listing_id = permit.listing_id
       and snapshot.credential_id = permit.credential_id
       and snapshot.seller_account_key = permit.seller_account_key
       and snapshot.remote_id = permit.remote_id
     where permit.permit_id = p_permit_id
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_release_is_current(
             permit.channel, permit.release_sha
           )
       and listing.status = 'queued'
       and listing.failure_class is null
       and (
         (
           permit.update_job_id is null
           and permit.update_attempt_id is null
         ) or (
           permit.update_job_id = job.id
           and permit.update_attempt_id = attempt.id
         )
       )
       and (
         (
           permit.channel = 'coupang'
           and permit.listing_id =
                 '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
           and permit.remote_id = '16356981734'
           and permit.provider_resource_id = '95962393877'
           and permit.seller_sku = 'QA-20260823-CC-001'
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'unknown'
           and listing.provider_status is null
           and listing.published_at is null
           and permit.credential_account_source =
                 'credential_incarnation_v1'
           and permit.snapshot_revision is null
           and permit.snapshot_payload_sha256 is null
           and permit.snapshot_source_job_id is null
         ) or (
           permit.channel = 'elevenst'
           and permit.listing_id =
                 '363f3b81-f364-4f22-af4e-4920199904d0'::uuid
           and permit.credential_id =
                 'b2dd0ff7-4420-495f-aead-a45857fb3bfe'::uuid
           and permit.remote_id = '9573255804'
           and permit.seller_sku = 'QA-20260823-CC-001'
           and (listing.marketplace_sku is null
             or listing.marketplace_sku = permit.seller_sku)
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'unknown'
           and (listing.provider_status is null
             or listing.provider_status = '105')
           and listing.published_at is null
           and permit.credential_account_source =
                 'credential_incarnation_v1'
           and snapshot.revision = permit.snapshot_revision
           and snapshot.source_job_id = permit.snapshot_source_job_id
           and encode(extensions.digest(
                 snapshot.product_payload::text, 'sha256'
               ), 'hex') = permit.snapshot_payload_sha256
         ) or (
           permit.channel = 'ebay'
           and permit.listing_id =
                 '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
           and permit.remote_id = '800551945442'
           and permit.seller_sku = 'QA-20260823-CC-001-US'
           and listing.marketplace_sku = permit.seller_sku
           and listing.provider_resource_id = permit.provider_resource_id
           and listing.requested_publication_intent = 'live'
           and listing.remote_visibility = 'unknown'
           and listing.provider_status is null
           and listing.published_at is null
           and permit.credential_account_source = 'provider_certified_v1'
           and sellerpilot_private.ebay_exact_current_credential_is_valid(
                 permit.credential_id, permit.seller_account_key
               )
           and permit.snapshot_revision is null
           and permit.snapshot_payload_sha256 is null
           and permit.snapshot_source_job_id is null
         )
       )
  )
$function$;
$ddl$;

  execute $ddl$
revoke all on function
  sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(uuid)
  from public, anon, authenticated, service_role
$ddl$;
end;
$install_exact_existing_enqueued_lineage_phase$;

do $patch_exact_existing_enqueued_phase_calls$
declare
  v_signature regprocedure;
  v_definition text;
  v_preflight_name constant text :=
    'sellerpilot_private.exact_existing_update_lineage_is_current(';
  v_enqueued_name constant text :=
    'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(';
  v_enqueue_after_before constant text := $body$
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_lineage_is_current(
             permit.permit_id
           )
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.id = v_job_id$body$;
  v_enqueue_after_after constant text := $body$
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
             permit.permit_id
           )
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.id = v_job_id$body$;
  v_occurrences integer;
begin
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  v_signature :=
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure;
  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
  if pg_catalog.strpos(v_definition, v_enqueue_after_before) = 0
     or pg_catalog.strpos(v_definition, v_enqueue_after_after) > 0
  then
    raise exception 'exact existing enqueue post-state patch target mismatch: %',
      v_signature using errcode = '55000';
  end if;
  execute pg_catalog.replace(
    v_definition, v_enqueue_after_before, v_enqueue_after_after
  );

  foreach v_signature in array array[
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure,
    'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    v_occurrences := (
      length(v_definition)
      - length(pg_catalog.replace(v_definition, v_preflight_name, ''))
    ) / length(v_preflight_name);
    if v_occurrences <> 1
       or pg_catalog.strpos(v_definition, v_enqueued_name) > 0
    then
      raise exception 'exact existing enqueued phase patch target mismatch: %',
        v_signature using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      v_definition, v_preflight_name, v_enqueued_name
    );
  end loop;
end;
$patch_exact_existing_enqueued_phase_calls$;

-- Retire only the second proved Coupang pre-gateway rollback and restore only
-- its exact listing to the explicit operator-controlled recovery class. This
-- block never creates a permit, attempt, job, or remote write.
do $reconcile_coupang_exact_enqueued_phase_rollback$
declare
  v_owner_id constant uuid :=
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid;
  v_product_id constant uuid :=
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid;
  v_listing_id constant uuid :=
    '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid;
  v_attempt_id constant uuid :=
    'b107b984-b568-4c79-931f-00393feb5675'::uuid;
  v_permit_id constant uuid :=
    '630378a5-d7bb-4baf-857d-b7284c554680'::uuid;
  v_release_sha constant text :=
    '3d42c10758d5fe94166a3d39e672a711aba609ac';
  v_safe_message constant text :=
    'Vercel 서버리스 채널 게이트웨이에서 안전하게 처리된 오류가 발생했습니다.';
  v_present_rows integer;
  v_updated_rows integer;
begin
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  select
    (select count(*) from sellerpilot_private.product_listings listing
      where listing.id = v_listing_id)
    +
    (select count(*) from sellerpilot_private.channel_operation_attempts attempt
      where attempt.id = v_attempt_id)
    +
    (select count(*) from sellerpilot_private.exact_existing_update_permits permit
      where permit.permit_id = v_permit_id)
    into v_present_rows;

  if v_present_rows = 0 then return; end if;
  if v_present_rows <> 3 then
    raise exception 'COUPANG_EXACT_ENQUEUED_PHASE_RECONCILIATION_INCOMPLETE'
      using errcode = '55000';
  end if;

  perform 1
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product
      on product.id = listing.product_id
     and product.owner_id = listing.owner_id
    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
     and attempt.owner_id = listing.owner_id
     and attempt.channel = listing.channel_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = attempt.credential_id
     and credential.channel = listing.channel_key
     and credential.seller_account_key = listing.seller_account_key
    join sellerpilot_private.exact_existing_update_permits permit
      on permit.permit_id = v_permit_id
     and permit.channel = listing.channel_key
     and permit.listing_id = listing.id
     and permit.product_id = listing.product_id
     and permit.owner_id = listing.owner_id
     and permit.credential_id = credential.id
     and permit.seller_account_key = listing.seller_account_key
     and permit.request_fingerprint = attempt.request_fingerprint
   where listing.id = v_listing_id
     and listing.owner_id = v_owner_id
     and listing.product_id = v_product_id
     and listing.channel_key = 'coupang'
     and listing.remote_id = '16356981734'
     and listing.market = 'KR'
     and listing.target_id = 'KR'
     and listing.currency = 'KRW'
     and listing.price = 5000
     and listing.status = 'failed'
     and listing.failure_class = 'retryable'
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.operation_attempt_id = v_attempt_id
     and listing.last_error = v_safe_message
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status <> 'archived'
     and attempt.operation = 'listing.update'
     and attempt.status = 'failed'
     and attempt.http_status = 422
     and attempt.remote_id is null
     and attempt.safe_message = v_safe_message
     and attempt.gateway_write_required
     and attempt.pre_gateway_retryable
     and attempt.completed_at is not null
     and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
     and attempt.seller_account_key = listing.seller_account_key
     and credential.status = 'active'
     and credential.environment = 'production'
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
     and credential.last_check_status = 'passed'
     and credential.last_checked_at is not null
     and (credential.expires_at is null
       or credential.expires_at > statement_timestamp())
     and permit.release_sha = v_release_sha
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.arguments_sha256 is null
     and permit.arguments_bytes is null
     and permit.request_payload_sha256 is null
     and permit.request_payload_bytes is null
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.invalidation_reason is null
     and permit.expires_at <= statement_timestamp()
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
           or job.id = permit.update_job_id
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs active_job
        where active_job.listing_id = v_listing_id
          and active_job.operation in (
            'listing.create', 'listing.update', 'listing.stop'
          )
          and active_job.status in (
            'queued', 'running', 'reconciliation_required'
          )
     )
   for update of listing, product, attempt, credential, permit;

  if not found then
    raise exception 'COUPANG_EXACT_ENQUEUED_PHASE_RECONCILIATION_MISMATCH'
      using errcode = '55000';
  end if;

  update sellerpilot_private.exact_existing_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.permit_id = v_permit_id
     and permit.channel = 'coupang'
     and permit.listing_id = v_listing_id
     and permit.release_sha = v_release_sha
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.bound_at is null
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at <= statement_timestamp()
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.attempt_id = v_attempt_id
     );

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_ENQUEUED_PHASE_PERMIT_RETIRE_FAILED'
      using errcode = '55000';
  end if;

  update sellerpilot_private.product_listings listing
     set failure_class = 'external_action'
   where listing.id = v_listing_id
     and listing.operation_attempt_id = v_attempt_id
     and listing.failure_class = 'retryable'
     and listing.last_error = v_safe_message;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'COUPANG_EXACT_ENQUEUED_PHASE_LISTING_RESTORE_FAILED'
      using errcode = '55000';
  end if;
end;
$reconcile_coupang_exact_enqueued_phase_rollback$;

do $exact_existing_enqueued_phase_postimage$
declare
  v_definition text;
  v_signature regprocedure;
begin
  if pg_catalog.to_regclass(
    'sellerpilot_private.exact_existing_update_permits'
  ) is null then
    return;
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current('
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'sellerpilot_private.exact_existing_update_lineage_is_current('
     ) = 0
  then
    raise exception 'exact existing enqueue phase postimage mismatch'
      using errcode = '55000';
  end if;

  foreach v_signature in array array[
    'sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)'::regprocedure,
    'sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)'::regprocedure,
    'sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    if pg_catalog.strpos(
         v_definition,
         'sellerpilot_private.exact_existing_update_enqueued_lineage_is_current('
       ) = 0
       or pg_catalog.strpos(
         v_definition,
         'sellerpilot_private.exact_existing_update_lineage_is_current('
       ) > 0
    then
      raise exception 'exact existing enqueued phase postimage mismatch: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$exact_existing_enqueued_phase_postimage$;

commit;
