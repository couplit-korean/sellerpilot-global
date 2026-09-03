-- Allow one content-only cleanup of the already-adopted live Qoo10 item.
-- The immutable CHANGHEE receipt is alternate lineage for this permit; it
-- never authorizes create, status activation, price, inventory, shipping, or
-- representative-image mutation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065044);

alter table sellerpilot_private.qoo10_exact_localization_update_permits
  add column lineage_contract text,
  add column adoption_source_job_id uuid references
    sellerpilot_private.qoo10_exact_already_live_adoptions(source_job_id)
    on delete restrict,
  add column adoption_observation_sha256 text,
  add column prewrite_snapshot jsonb,
  add column prewrite_snapshot_sha256 text;

alter table sellerpilot_private.qoo10_exact_localization_update_permits
  add constraint qoo10_exact_localization_adopted_lineage_check check (
    (
      lineage_contract is null
      and adoption_source_job_id is null
      and adoption_observation_sha256 is null
      and prewrite_snapshot is null
      and prewrite_snapshot_sha256 is null
    ) or (
      lineage_contract = 'qoo10_exact_already_live_adoption_v1'
      and adoption_source_job_id =
            'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
      and adoption_observation_sha256 ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(prewrite_snapshot) = 'object'
      and octet_length(prewrite_snapshot::text) between 100 and 65536
      and prewrite_snapshot_sha256 = encode(
            extensions.digest(prewrite_snapshot::text, 'sha256'), 'hex'
          )
    )
  );

create function sellerpilot_private.qoo10_exact_adopted_localization_snapshot(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract', 'qoo10_exact_adopted_live_localization_snapshot_v1',
    'receipt', jsonb_build_object(
      'sourceJobId', receipt.source_job_id,
      'sourceAttemptId', receipt.source_attempt_id,
      'observationSha256', receipt.observation_sha256,
      'observedAt', receipt.observed_at,
      'recordedAt', receipt.recorded_at,
      'providerStatus', receipt.provider_status,
      'remoteVisibility', receipt.remote_visibility,
      'purchaseAvailable', receipt.purchase_available,
      'externalWriteCount', receipt.external_write_count
    ),
    'listing', jsonb_build_object(
      'id', listing.id,
      'productId', listing.product_id,
      'ownerId', listing.owner_id,
      'channel', listing.channel_key,
      'market', listing.market,
      'targetId', listing.target_id,
      'remoteId', listing.remote_id,
      'status', listing.status,
      'failureClass', listing.failure_class,
      'requestedPublicationIntent', listing.requested_publication_intent,
      'remoteVisibility', listing.remote_visibility,
      'providerStatus', listing.provider_status,
      'currency', listing.currency,
      'price', listing.price,
      'publishedAt', listing.published_at,
      'lastVerifiedAt', listing.last_verified_at,
      'sellerAccountKey', listing.seller_account_key,
      'remoteResources', listing.remote_resources
    ),
    'product', jsonb_build_object(
      'id', product.id,
      'ownerId', product.owner_id,
      'sku', product.sku,
      'onHand', product.on_hand,
      'demo', product.demo,
      'status', product.status
    ),
    'credential', jsonb_build_object(
      'id', credential.id,
      'channel', credential.channel,
      'environment', credential.environment,
      'status', credential.status,
      'sellerAccountKey', credential.seller_account_key
    )
  )
    from sellerpilot_private.product_listings listing
    join sellerpilot_private.products product on product.id = listing.product_id
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
    join sellerpilot_private.qoo10_exact_already_live_adoptions receipt
      on receipt.listing_id = listing.id
   where p_listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and p_credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     and p_product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     and p_market = 'JP'
     and p_target_id = ''
     and listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     and listing.channel_key = 'qoo10'
     and listing.market = p_market
     and listing.target_id = p_target_id
     and listing.remote_id = '1217336970'
     and listing.status = 'published'
     and listing.failure_class is null
     and listing.requested_publication_intent = 'live'
     and listing.remote_visibility = 'live'
     and listing.provider_status = 'S2'
     and listing.currency = 'JPY'
     and listing.price = 1871
     and listing.published_at = receipt.observed_at
     and listing.last_verified_at = receipt.observed_at
     and listing.seller_account_key = receipt.seller_account_key
     and listing.remote_resources#>>'{resources,itemCode}' = '1217336970'
     and listing.remote_resources#>>'{verification,evidenceSha256}' =
           receipt.observation_sha256
     and listing.remote_resources#>>'{verification,providerStatus}' = 'S2'
     and listing.remote_resources#>>'{verification,remoteVisibility}' = 'live'
     and listing.remote_resources#>'{verification,purchaseAvailable}' = 'true'::jsonb
     and listing.remote_resources#>'{verification,knownLocalizationIssues,romanizedTitlePresent}' = 'true'::jsonb
     and listing.remote_resources#>'{verification,knownLocalizationIssues,krwPricePresent}' = 'true'::jsonb
     and product.id = p_product_id
     and product.owner_id = listing.owner_id
     and product.sku = 'QA-20260823-CC-001'
     and product.on_hand = 1
     and not product.demo
     and product.status is distinct from 'archived'
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and credential.seller_account_key = listing.seller_account_key
     and receipt.source_job_id =
           'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     and receipt.credential_id = credential.id
     and receipt.product_id = product.id
     and receipt.remote_id = listing.remote_id
     and receipt.provider_status = 'S2'
     and receipt.remote_visibility = 'live'
     and receipt.purchase_available
     and not receipt.provider_call_replayed
     and receipt.external_write_count = 0
     and receipt.observation#>>'{profileName}' = 'CHANGHEE'
     and receipt.observation#>>'{detailLocale}' = 'ja-JP'
     and receipt.observation#>'{detailContainsRomanizedTitle}' = 'true'::jsonb
     and receipt.observation#>'{detailContainsKrwPrice}' = 'true'::jsonb
     and receipt.recorded_at >= receipt.observed_at
     and receipt.recorded_at <= receipt.observed_at + interval '15 minutes'
$$;

create function public.sellerpilot_service_get_exact_qoo10_adopted_localization_identity(
  p_listing_id uuid,
  p_credential_id uuid,
  p_product_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_snapshot_sha text;
  v_observation_sha text;
begin
  v_snapshot := sellerpilot_private.qoo10_exact_adopted_localization_snapshot(
    p_listing_id, p_credential_id, p_product_id, p_market, p_target_id
  );
  if jsonb_typeof(v_snapshot) is distinct from 'object'
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = p_listing_id
          and job.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'listing.activate', 'price.update', 'inventory.update'
          )
          and job.status in ('queued', 'running', 'reconciliation_required')
     )
  then return null; end if;
  v_snapshot_sha := encode(
    extensions.digest(v_snapshot::text, 'sha256'), 'hex'
  );
  v_observation_sha := v_snapshot#>>'{receipt,observationSha256}';
  return jsonb_build_object(
    'status', 'allowed',
    'contract', 'qoo10_exact_adopted_live_localization_identity_v1',
    'sourceJobId', 'fac9c5c4-940d-4600-88f3-8f97a069dfbf',
    'listingId', p_listing_id,
    'remoteId', '1217336970',
    'observationSha256', v_observation_sha,
    'prewriteSnapshotSha256', v_snapshot_sha
  );
end;
$$;

create function sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
  p_arguments jsonb,
  p_release_sha text,
  p_observation_sha256 text,
  p_prewrite_snapshot_sha256 text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
      p_arguments, p_release_sha
    )
    and jsonb_typeof(
          p_arguments->'sellerpilotQoo10AdoptedLocalization'
        ) = 'object'
    and (select count(*) from jsonb_object_keys(
          p_arguments->'sellerpilotQoo10AdoptedLocalization'
        )) = 5
    and p_arguments#>>'{sellerpilotQoo10AdoptedLocalization,status}' = 'allowed'
    and p_arguments#>>'{sellerpilotQoo10AdoptedLocalization,contract}' =
          'qoo10_exact_adopted_live_localization_v1'
    and p_arguments#>>'{sellerpilotQoo10AdoptedLocalization,sourceJobId}' =
          'fac9c5c4-940d-4600-88f3-8f97a069dfbf'
    and p_arguments#>>'{sellerpilotQoo10AdoptedLocalization,observationSha256}' =
          p_observation_sha256
    and p_arguments#>>'{sellerpilotQoo10AdoptedLocalization,prewriteSnapshotSha256}' =
          p_prewrite_snapshot_sha256
    and p_observation_sha256 ~ '^[a-f0-9]{64}$'
    and p_prewrite_snapshot_sha256 ~ '^[a-f0-9]{64}$'
    and not (p_arguments->'params' ? 'StandardImage'),
    false
  )
$$;

create function public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text,
  p_observation_sha256 text,
  p_prewrite_snapshot_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_snapshot_sha text;
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065044);
  v_snapshot := sellerpilot_private.qoo10_exact_adopted_localization_snapshot(
    p_listing_id,
    p_credential_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    'JP',
    ''
  );
  v_snapshot_sha := encode(
    extensions.digest(v_snapshot::text, 'sha256'), 'hex'
  );
  if p_listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or p_credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or p_observation_sha256 !~ '^[a-f0-9]{64}$'
     or p_prewrite_snapshot_sha256 !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or jsonb_typeof(v_snapshot) is distinct from 'object'
     or v_snapshot#>>'{receipt,observationSha256}' is distinct from
          p_observation_sha256
     or v_snapshot_sha is distinct from p_prewrite_snapshot_sha256
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = p_listing_id
          and job.request_payload#>>'{arguments,sellerpilotQoo10AdoptedLocalization,contract}' =
                'qoo10_exact_adopted_live_localization_v1'
     )
     or exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.listing_id = p_listing_id
          and job.operation in (
            'listing.create', 'listing.update', 'listing.stop',
            'listing.activate', 'price.update', 'inventory.update'
          )
          and job.status in ('queued', 'running', 'reconciliation_required')
     )
  then
    raise exception 'exact Qoo10 adopted localization permit identity invalid'
      using errcode = '55000';
  end if;

  update sellerpilot_private.qoo10_exact_localization_update_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_before_job'
   where permit.listing_id = p_listing_id
     and permit.invalidated_at is null
     and permit.update_job_id is null
     and permit.expires_at <= statement_timestamp();

  select permit.* into v_permit
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.listing_id = p_listing_id
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.update_job_id is not null
       or v_permit.lineage_contract is distinct from
            'qoo10_exact_already_live_adoption_v1'
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.adoption_observation_sha256 is distinct from
            p_observation_sha256
       or v_permit.prewrite_snapshot_sha256 is distinct from
            p_prewrite_snapshot_sha256
       or v_permit.expires_at <= statement_timestamp()
    then
      raise exception 'exact Qoo10 adopted localization permit conflict'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', 'qoo10_adopted_localization_update_permit_v1',
      'permitId', v_permit.permit_id,
      'listingId', v_permit.listing_id,
      'releaseSha', v_permit.release_sha,
      'requestFingerprint', v_permit.request_fingerprint,
      'observationSha256', v_permit.adoption_observation_sha256,
      'prewriteSnapshotSha256', v_permit.prewrite_snapshot_sha256,
      'bound', false,
      'reused', true
    );
  end if;

  insert into sellerpilot_private.qoo10_exact_localization_update_permits (
    source_job_id, listing_id, product_id, credential_id, owner_id, remote_id,
    seller_account_key, release_sha, request_fingerprint, armed_at, expires_at,
    lineage_contract, adoption_source_job_id, adoption_observation_sha256,
    prewrite_snapshot, prewrite_snapshot_sha256
  ) values (
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
    p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '1217336970',
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46',
    p_release_sha, p_request_fingerprint,
    clock_timestamp(), clock_timestamp() + interval '5 minutes',
    'qoo10_exact_already_live_adoption_v1',
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
    p_observation_sha256, v_snapshot, p_prewrite_snapshot_sha256
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract', 'qoo10_adopted_localization_update_permit_v1',
    'permitId', v_permit.permit_id,
    'listingId', v_permit.listing_id,
    'releaseSha', v_permit.release_sha,
    'requestFingerprint', v_permit.request_fingerprint,
    'observationSha256', v_permit.adoption_observation_sha256,
    'prewriteSnapshotSha256', v_permit.prewrite_snapshot_sha256,
    'bound', false,
    'reused', false
  );
end;
$$;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_173500_enqueue_before_qoo10_adopted_localization;
revoke all on function
  public.sellerpilot_173500_enqueue_before_qoo10_adopted_localization(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
begin
  if p_listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and p_channel = 'qoo10'
     and p_operation = 'listing.update'
     and v_arguments#>>'{sellerpilotQoo10ExactLocalization,contract}' =
           'qoo10_exact_localization_update_v2'
  then
    select permit.* into v_permit
      from sellerpilot_private.qoo10_exact_localization_update_permits permit
     where permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.invalidated_at is null
       and permit.update_job_id is null
       and permit.expires_at > statement_timestamp()
       and permit.request_fingerprint = (
         select attempt.request_fingerprint
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = p_attempt_id
       )
     for update;
    if found
       and v_permit.lineage_contract =
             'qoo10_exact_already_live_adoption_v1'
       and not sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
         v_arguments,
         v_permit.release_sha,
         v_permit.adoption_observation_sha256,
         v_permit.prewrite_snapshot_sha256
       )
    then
      raise exception 'exact Qoo10 adopted localization enqueue lineage invalid'
        using errcode = '55000';
    end if;
  end if;
  return public.sellerpilot_173500_enqueue_before_qoo10_adopted_localization(
    p_listing_id, p_credential_id, p_attempt_id, p_channel, p_operation,
    p_request_payload
  );
end;
$$;

alter function sellerpilot_private.exact_qoo10_localization_update_provider_allowed(
  uuid, uuid
) rename to exact_qoo10_localization_provider_allowed_before_173500;

create function sellerpilot_private.exact_qoo10_localization_update_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
  v_arguments jsonb;
begin
  if not sellerpilot_private.exact_qoo10_localization_provider_allowed_before_173500(
    p_job_id, p_claim_token
  ) then return false; end if;
  select permit.* into v_permit
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.update_job_id = p_job_id
     and permit.bound_claim_token = p_claim_token;
  if not found then return false; end if;
  select job.request_payload->'arguments' into v_arguments
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;
  return v_permit.lineage_contract is null
    or (
      v_permit.lineage_contract = 'qoo10_exact_already_live_adoption_v1'
      and sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
        v_arguments,
        v_permit.release_sha,
        v_permit.adoption_observation_sha256,
        v_permit.prewrite_snapshot_sha256
      )
    );
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.guard_exact_qoo10_adopted_localization_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
  v_is_adopted boolean := coalesce(
    new.request_payload#>>
      '{arguments,sellerpilotQoo10AdoptedLocalization,contract}' =
        'qoo10_exact_adopted_live_localization_v1',
    false
  );
begin
  select permit.* into v_permit
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.update_job_id = new.id;
  if not v_is_adopted
     and (not found or v_permit.lineage_contract is null)
  then return new; end if;
  if not found
     or v_permit.lineage_contract is distinct from
          'qoo10_exact_already_live_adoption_v1'
     or new.listing_id is distinct from
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or new.credential_id is distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or new.channel is distinct from 'qoo10'
     or new.operation is distinct from 'listing.update'
     or new.environment is distinct from 'production'
     or not sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
          new.request_payload->'arguments',
          v_permit.release_sha,
          v_permit.adoption_observation_sha256,
          v_permit.prewrite_snapshot_sha256
        )
  then
    raise exception 'exact Qoo10 adopted localization job lineage invalid'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and new.status in ('succeeded', 'failed', 'reconciliation_required')
  then
    if new.status = 'succeeded' and not (
      jsonb_typeof(new.response_payload->'steps') = 'array'
      and jsonb_array_length(new.response_payload->'steps') = 3
      and new.response_payload->>'ok' = 'true'
      and new.response_payload->>'publicationFulfilled' = 'true'
      and new.response_payload#>>'{remoteState,providerStatus}' in ('S2', '2')
      and new.response_payload#>>'{remoteState,visibility}' = 'live'
      and new.response_payload#>>'{remoteState,locale}' = 'ja-JP'
      and new.response_payload#>>'{remoteState,imageCount}' = '8'
      and new.response_payload#>>'{steps,0,name}' =
            'qoo10-exact-adopted-live-prewrite-readback'
      and new.response_payload#>>'{steps,0,ok}' = 'true'
      and new.response_payload#>>'{steps,1,name}' = 'EditGoodsContents'
      and new.response_payload#>>'{steps,1,ok}' = 'true'
      and new.response_payload#>>'{steps,2,name}' =
            'qoo10-exact-adopted-localization-postwrite-readback'
      and new.response_payload#>>'{steps,2,ok}' = 'true'
      and new.response_payload#>>'{steps,2,data,sellerpilotVerification}' =
            'QOO10_EXACT_ADOPTED_S2_LOCALIZATION_VERIFIED'
    ) then
      raise exception 'exact Qoo10 adopted localization success lacks fresh readback'
        using errcode = '55000';
    end if;
    if new.status = 'failed' and not exists (
      select 1 from jsonb_array_elements(
        coalesce(new.response_payload->'steps', '[]'::jsonb)
      ) step
       where step#>'{data,sellerpilotNoWriteConfirmed}' = 'true'::jsonb
    ) then
      raise exception 'uncertain Qoo10 adopted localization must reconcile'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger guard_exact_qoo10_adopted_localization_job
after insert or update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function
  sellerpilot_private.guard_exact_qoo10_adopted_localization_job();

revoke all on function
  sellerpilot_private.qoo10_exact_adopted_localization_snapshot(
    uuid, uuid, uuid, text, text
  ),
  sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
    jsonb, text, text, text
  ),
  sellerpilot_private.exact_qoo10_localization_provider_allowed_before_173500(
    uuid, uuid
  ),
  sellerpilot_private.exact_qoo10_localization_update_provider_allowed(
    uuid, uuid
  ),
  sellerpilot_private.guard_exact_qoo10_adopted_localization_job(),
  public.sellerpilot_service_get_exact_qoo10_adopted_localization_identity(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ),
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_get_exact_qoo10_adopted_localization_identity(
    uuid, uuid, uuid, text, text
  ),
  public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ),
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid, uuid, uuid, text, text, jsonb
  ) to service_role;

comment on function
  public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(
    uuid, uuid, text, text, text, text
  ) is
  'Arms one content-only Qoo10 detail cleanup from the immutable CHANGHEE already-live adoption receipt; performs no provider call.';

commit;
