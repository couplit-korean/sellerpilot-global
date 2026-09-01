-- Adopt the current already-live state of one exact Qoo10 listing from a
-- fresh CHANGHEE seller-center plus public-page readback. This is an internal
-- reconciliation only: it creates no gateway job and performs no provider
-- request. The separate localization update remains fenced behind its own
-- later permit/release step.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065043);

create function sellerpilot_private.qoo10_exact_already_live_observation_valid(
  p_observation jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_observation) = 'object'
    and p_observation ?& array[
      'contract', 'profileName', 'remoteId', 'sellerSku', 'title',
      'promotionName', 'providerStatus', 'sellerStatus', 'sellerStatusLabel',
      'nextSellerActionLabel', 'purchaseAvailable', 'cartActionLabel',
      'currency', 'priceJpy', 'quantity', 'shippingNo', 'shippingFeeJpy',
      'shippingCompany', 'representativeImageCount', 'additionalImageCount',
      'detailImageCount', 'detailUniqueImageCount', 'detailLocale',
      'detailJapanese', 'detailContainsRomanizedTitle',
      'detailContainsKrwPrice', 'sellerCenterObserved', 'publicPageObserved',
      'publicUrl', 'observedAt'
    ]
    and p_observation - array[
      'contract', 'profileName', 'remoteId', 'sellerSku', 'title',
      'promotionName', 'providerStatus', 'sellerStatus', 'sellerStatusLabel',
      'nextSellerActionLabel', 'purchaseAvailable', 'cartActionLabel',
      'currency', 'priceJpy', 'quantity', 'shippingNo', 'shippingFeeJpy',
      'shippingCompany', 'representativeImageCount', 'additionalImageCount',
      'detailImageCount', 'detailUniqueImageCount', 'detailLocale',
      'detailJapanese', 'detailContainsRomanizedTitle',
      'detailContainsKrwPrice', 'sellerCenterObserved', 'publicPageObserved',
      'publicUrl', 'observedAt'
    ] = '{}'::jsonb
    and p_observation->>'contract' =
          'qoo10_seller_center_already_live_readback_v1'
    and p_observation->>'profileName' = 'CHANGHEE'
    and p_observation->>'remoteId' = '1217336970'
    and p_observation->>'sellerSku' = 'QA-20260823-CC-001'
    and p_observation->>'title' =
          '貼り付け式ケーブル整理クリップ6個セット'
    and p_observation->>'promotionName' =
          '販売者が確認した入力だけに基づく商品案内'
    and p_observation->>'providerStatus' = 'S2'
    and p_observation->>'sellerStatus' = 'selling'
    and p_observation->>'sellerStatusLabel' = '판매중'
    and p_observation->>'nextSellerActionLabel' = '판매중지로 변경'
    and p_observation->'purchaseAvailable' = 'true'::jsonb
    and p_observation->>'cartActionLabel' = 'カートに入れる'
    and p_observation->>'currency' = 'JPY'
    and p_observation->'priceJpy' = to_jsonb(1871)
    and p_observation->'quantity' = to_jsonb(1)
    and p_observation->>'shippingNo' = '806971'
    and p_observation->'shippingFeeJpy' = to_jsonb(0)
    and p_observation->>'shippingCompany' = 'TracX Logis'
    and p_observation->'representativeImageCount' = to_jsonb(1)
    and p_observation->'additionalImageCount' = to_jsonb(0)
    and p_observation->'detailImageCount' = to_jsonb(8)
    and p_observation->'detailUniqueImageCount' = to_jsonb(8)
    and p_observation->>'detailLocale' = 'ja-JP'
    and p_observation->'detailJapanese' = 'true'::jsonb
    and p_observation->'detailContainsRomanizedTitle' = 'true'::jsonb
    and p_observation->'detailContainsKrwPrice' = 'true'::jsonb
    and p_observation->'sellerCenterObserved' = 'true'::jsonb
    and p_observation->'publicPageObserved' = 'true'::jsonb
    and p_observation->>'publicUrl' =
          'https://www.qoo10.jp/g/1217336970'
    and p_observation->>'observedAt' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
    false
  )
$$;

create table sellerpilot_private.qoo10_exact_already_live_adoptions (
  source_job_id uuid primary key check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
  ) references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique check (
    source_attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
  ) references sellerpilot_private.channel_operation_attempts(id)
    on delete restrict,
  listing_id uuid not null unique check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
  ) references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null check (
    product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
  ) references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null check (
    credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
  ) references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null check (
    owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
  ) references auth.users(id) on delete restrict,
  remote_id text not null check (remote_id = '1217336970'),
  seller_account_key text not null check (
    seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
  ),
  observation jsonb not null check (
    sellerpilot_private.qoo10_exact_already_live_observation_valid(observation)
  ),
  observation_sha256 text not null check (
    observation_sha256 =
      encode(extensions.digest(observation::text, 'sha256'), 'hex')
  ),
  later_jobs jsonb not null check (jsonb_typeof(later_jobs) = 'array'),
  later_jobs_sha256 text not null check (
    later_jobs_sha256 =
      encode(extensions.digest(later_jobs::text, 'sha256'), 'hex')
  ),
  observed_at timestamptz not null check (
    observed_at = (observation->>'observedAt')::timestamptz
  ),
  provider_status text not null check (provider_status = 'S2'),
  remote_visibility text not null check (remote_visibility = 'live'),
  purchase_available boolean not null check (purchase_available),
  provider_call_replayed boolean not null check (not provider_call_replayed),
  external_write_count integer not null check (external_write_count = 0),
  recorded_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.qoo10_exact_already_live_adoptions
  enable row level security;
revoke all on sellerpilot_private.qoo10_exact_already_live_adoptions
  from public, anon, authenticated, service_role;

create trigger block_qoo10_exact_already_live_adoption_change
before update or delete
on sellerpilot_private.qoo10_exact_already_live_adoptions
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();

create function sellerpilot_private.qoo10_exact_already_live_resources(
  p_source_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'resources', jsonb_build_object('itemCode', receipt.remote_id),
    'verification', jsonb_build_object(
      'contract', 'qoo10_seller_center_already_live_readback_v1',
      'verifiedAt', to_jsonb(receipt.observed_at),
      'recordedAt', to_jsonb(receipt.recorded_at),
      'evidenceSha256', receipt.observation_sha256,
      'browserProfile', receipt.observation->>'profileName',
      'locale', receipt.observation->>'detailLocale',
      'providerStatus', receipt.provider_status,
      'sellerStatus', receipt.observation->>'sellerStatus',
      'remoteVisibility', receipt.remote_visibility,
      'purchaseAvailable', receipt.purchase_available,
      'sellerCenterObserved', receipt.observation->'sellerCenterObserved',
      'publicPageObserved', receipt.observation->'publicPageObserved',
      'publicUrl', receipt.observation->>'publicUrl',
      'imageCount', receipt.observation->'detailImageCount',
      'representativeImageCount',
        receipt.observation->'representativeImageCount',
      'additionalImageCount', receipt.observation->'additionalImageCount',
      'detailImageCount', receipt.observation->'detailImageCount',
      'detailUniqueImageCount', receipt.observation->'detailUniqueImageCount',
      'publicationTimeKnown', false,
      'publishedAtSource', 'first_verified_live_at',
      'knownLocalizationIssues', jsonb_build_object(
        'romanizedTitlePresent',
          receipt.observation->'detailContainsRomanizedTitle',
        'krwPricePresent', receipt.observation->'detailContainsKrwPrice'
      ),
      'providerCallReplayed', receipt.provider_call_replayed,
      'externalWriteCount', receipt.external_write_count
    )
  )
    from sellerpilot_private.qoo10_exact_already_live_adoptions receipt
   where receipt.source_job_id = p_source_job_id
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_already_live_resources(uuid)
  from public, anon, authenticated, service_role;

create function
  sellerpilot_private.qoo10_exact_already_live_listing_update_allowed(
    p_old jsonb,
    p_new jsonb,
    p_source_job_id uuid
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt sellerpilot_private.qoo10_exact_already_live_adoptions%rowtype;
  v_resources jsonb;
begin
  if p_source_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_old->>'id' is distinct from
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'owner_id' is distinct from
          '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'
     or p_old->>'product_id' is distinct from
          'ddccde35-9c58-4856-b673-d7aa27ce4220'
     or p_old->>'channel_key' is distinct from 'qoo10'
     or p_old->>'market' is distinct from 'JP'
     or p_old->>'target_id' is distinct from ''
     or p_old->>'remote_id' is distinct from '1217336970'
     or p_old->>'operation_attempt_id' is distinct from
          '4402cc76-295b-4e17-8c07-d5d0e9967ce9'
     or p_old->>'seller_account_key' is distinct from
          '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or p_old->>'status' is distinct from 'failed'
     or p_old->>'failure_class' is distinct from 'external_action'
     or p_old->>'requested_publication_intent' is distinct from 'live'
     or p_old->>'remote_visibility' is distinct from 'unknown'
     or p_old->'provider_status' is distinct from 'null'::jsonb
     or p_old->'published_at' is distinct from 'null'::jsonb
     or p_old->'last_verified_at' is distinct from 'null'::jsonb
  then
    return false;
  end if;

  select receipt.* into v_receipt
    from sellerpilot_private.qoo10_exact_already_live_adoptions receipt
   where receipt.source_job_id = p_source_job_id
     and receipt.listing_id = (p_old->>'id')::uuid
     and receipt.remote_id = '1217336970'
     and receipt.provider_status = 'S2'
     and receipt.remote_visibility = 'live'
     and receipt.purchase_available
     and not receipt.provider_call_replayed
     and receipt.external_write_count = 0;
  if not found then return false; end if;

  v_resources := sellerpilot_private.qoo10_exact_already_live_resources(
    p_source_job_id
  );
  if jsonb_typeof(v_resources) <> 'object'
     or octet_length(v_resources::text) > 65536 then
    return false;
  end if;

  return p_new = p_old || jsonb_build_object(
    'status', 'published',
    'remote_visibility', 'live',
    'provider_status', 'S2',
    'remote_resources', v_resources,
    'published_at', to_jsonb(v_receipt.observed_at),
    'last_verified_at', to_jsonb(v_receipt.observed_at),
    'last_error', 'null'::jsonb,
    'failure_class', 'null'::jsonb,
    'updated_at', to_jsonb(v_receipt.recorded_at)
  );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_already_live_listing_update_allowed(
    jsonb, jsonb, uuid
  ) from public, anon, authenticated, service_role;

-- Add a transaction-local exact-row branch ahead of the existing listing
-- guard. The marker alone grants nothing; the helper compares the complete old
-- and new rows against the immutable receipt inserted by the same transaction.
do $patch_qoo10_already_live_listing_guard$
declare
  v_definition text;
  v_before text;
  v_after text;
  v_branch text := '  if nullif(current_setting(''sellerpilot.qoo10_already_live_adoption'', true), '''') is not null then
    if not sellerpilot_private.qoo10_exact_already_live_listing_update_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.qoo10_already_live_adoption'', true)::uuid
    ) then
      raise exception ''invalid exact Qoo10 already-live adoption'';
    end if;
    return new;
  end if;

';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_already_live_adoption'
     ) = 0 then
    v_before := 'begin
  if nullif(current_setting(''sellerpilot.shopee_existing_adoption'', true), '''') is not null then';
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      v_before := 'begin
  if nullif(current_setting(''sellerpilot.elevenst_manual_live_reconciliation'', true), '''') is not null then';
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      v_before := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_partial_manual_apply'', true), '''') is not null then';
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      v_before := 'begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      v_before := 'begin
  if old.seller_account_key is null';
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'Qoo10 already-live listing guard preimage drifted'
        using errcode = '55000';
    end if;
    v_after := 'begin
' || v_branch || pg_catalog.substr(v_before, length('begin
') + 1);
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$patch_qoo10_already_live_listing_guard$;

-- Retire only the exact uncertain source job after the immutable already-live
-- receipt exists. All ordinary gateway transitions retain the existing guard.
do $patch_qoo10_already_live_job_guard$
declare
  v_definition text;
  v_before text := 'begin
  if tg_op=''UPDATE''
     and old.status=''reconciliation_required''';
  v_after text := 'begin
  if tg_op=''UPDATE''
     and old.status=''reconciliation_required''
     and new.status=''failed''
     and current_setting(
           ''sellerpilot.qoo10_already_live_adopt_source'', true
         ) is not distinct from old.id::text
     and to_jsonb(new)-array[''status'',''error_message'',''updated_at'']
           is not distinct from
         to_jsonb(old)-array[''status'',''error_message'',''updated_at'']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_already_live_adoptions receipt
        where receipt.source_job_id=old.id
          and receipt.source_attempt_id=old.attempt_id
          and receipt.listing_id=old.listing_id
          and receipt.credential_id=old.credential_id
          and receipt.remote_id=''1217336970''
          and receipt.provider_status=''S2''
          and receipt.remote_visibility=''live''
          and receipt.purchase_available
          and not receipt.provider_call_replayed
          and receipt.external_write_count=0
     )
  then return new; end if;
  if tg_op=''UPDATE''
     and old.status=''reconciliation_required''';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_qoo10_exact_localization_update_job()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       'sellerpilot.qoo10_already_live_adopt_source'
     ) = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'Qoo10 already-live job guard preimage drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$patch_qoo10_already_live_job_guard$;

create function public.sellerpilot_service_adopt_exact_qoo10_already_live(
  p_source_job_id uuid,
  p_release_sha text,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing sellerpilot_private.qoo10_exact_already_live_adoptions%rowtype;
  v_later_jobs jsonb;
  v_observed_at timestamptz;
  v_observation_sha text;
  v_resources jsonb;
  v_active_later_jobs integer;
  v_active_permits integer;
  v_same_remote_listings integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  if p_source_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(
          p_release_sha
        )
     or not sellerpilot_private.qoo10_exact_already_live_observation_valid(
          p_observation
        )
  then
    raise exception 'exact Qoo10 already-live adoption identity invalid'
      using errcode = '55000';
  end if;
  begin
    v_observed_at := (p_observation->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'exact Qoo10 already-live observation timestamp invalid'
      using errcode = '55000';
  end;
  if v_observed_at < clock_timestamp() - interval '15 minutes'
     or v_observed_at > clock_timestamp() + interval '1 minute' then
    raise exception 'exact Qoo10 already-live observation is not fresh'
      using errcode = '55000';
  end if;
  v_observation_sha := encode(
    extensions.digest(p_observation::text, 'sha256'),
    'hex'
  );

  select receipt.* into v_existing
    from sellerpilot_private.qoo10_exact_already_live_adoptions receipt
   where receipt.source_job_id = p_source_job_id;
  if found then
    if v_existing.observation is distinct from p_observation
       or v_existing.observation_sha256 is distinct from v_observation_sha
       or not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs source
          where source.id = p_source_job_id and source.status = 'failed'
       )
       or not exists (
         select 1 from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = v_existing.source_attempt_id
            and attempt.status = 'failed'
       )
       or not exists (
         select 1 from sellerpilot_private.product_listings listing
          where listing.id = v_existing.listing_id
            and listing.status = 'published'
            and listing.failure_class is null
            and listing.remote_visibility = 'live'
            and listing.provider_status = 'S2'
            and listing.remote_id = '1217336970'
       ) then
      raise exception 'exact Qoo10 already-live adoption replay conflict'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'contract', 'qoo10_already_live_adoption_v1',
      'sourceJobId', p_source_job_id,
      'listingId', v_existing.listing_id,
      'remoteId', v_existing.remote_id,
      'providerStatus', v_existing.provider_status,
      'remoteVisibility', v_existing.remote_visibility,
      'purchaseAvailable', v_existing.purchase_available,
      'providerCallReplayed', false,
      'externalWriteCount', 0,
      'knownLocalizationIssues', true,
      'reused', true
    );
  end if;

  select source.* into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = p_source_job_id for update;
  select attempt.* into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = v_source.attempt_id for update;
  select listing.* into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = v_source.listing_id for update;
  select product.* into strict v_product
    from sellerpilot_private.products product
   where product.id = v_listing.product_id for update;
  select credential.* into strict v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = v_source.credential_id for update;
  v_later_jobs := sellerpilot_private.qoo10_exact_partial_manual_later_jobs(
    v_source.id
  );

  select count(*)::integer into v_active_later_jobs
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = v_listing.id
     and job.id <> v_source.id
     and job.operation in (
       'listing.create', 'listing.update', 'listing.stop', 'listing.activate',
       'price.update', 'inventory.update'
     )
     and job.status in ('queued', 'running', 'reconciliation_required');
  select count(*)::integer into v_active_permits
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.listing_id = v_listing.id
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp();
  select count(*)::integer into v_same_remote_listings
    from sellerpilot_private.product_listings other_listing
   where other_listing.channel_key = 'qoo10'
     and other_listing.remote_id = '1217336970';

  if v_source.attempt_id is distinct from
       '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
     or v_source.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_source.credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_source.created_by is distinct from
       '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
     or v_source.channel is distinct from 'qoo10'
     or v_source.operation is distinct from 'listing.update'
     or v_source.environment is distinct from 'production'
     or v_source.status is distinct from 'reconciliation_required'
     or v_source.seller_account_key is distinct from
       '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or v_source.attempt_count <> 1
     or v_source.provider_mutation_started_at is null
     or v_source.completed_at is null
     or octet_length(v_source.request_payload::text) <> 23555
     or encode(extensions.digest(
          v_source.request_payload::text,
          'sha256'
        ), 'hex') <>
          'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
     or octet_length(v_source.response_payload::text) <> 16669
     or encode(extensions.digest(
          v_source.response_payload::text,
          'sha256'
        ), 'hex') <>
          'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
     or not sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
          v_source.id,
          v_source.request_payload->'arguments',
          p_release_sha
        )
     or not sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(
          v_source.id,
          v_later_jobs
        )
     or v_active_later_jobs <> 0
     or v_active_permits <> 0
     or v_same_remote_listings <> 1
     or exists (
       select 1
         from sellerpilot_private.qoo10_exact_partial_manual_reconciliations partial
        where partial.source_job_id = v_source.id
     )
     or exists (
       select 1
         from sellerpilot_private.qoo10_exact_manual_activation_outcomes outcome
        where outcome.source_job_id = v_source.id
     )
     or exists (
       select 1
         from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
        where evidence.source_job_id = v_source.id
     )
  then
    raise exception 'exact Qoo10 already-live source evidence incomplete'
      using errcode = '55000';
  end if;

  if v_attempt.owner_id is distinct from
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or v_attempt.credential_id is distinct from v_credential.id
     or v_attempt.channel is distinct from 'qoo10'
     or v_attempt.operation is distinct from 'listing.update'
     or v_attempt.status is distinct from 'manual_required'
     or v_attempt.remote_id is distinct from '1217336970'
     or v_attempt.request_fingerprint is distinct from
          v_source.request_fingerprint
     or not v_attempt.gateway_write_required
     or v_attempt.pre_gateway_retryable
     or v_listing.owner_id is distinct from v_attempt.owner_id
     or v_listing.product_id is distinct from
          'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.market is distinct from 'JP'
     or v_listing.target_id is distinct from ''
     or v_listing.operation_attempt_id is distinct from v_attempt.id
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.remote_visibility is distinct from 'unknown'
     or v_listing.provider_status is not null
     or v_listing.remote_id is distinct from '1217336970'
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.currency is distinct from 'JPY'
     or v_listing.price <> 1871
     or v_listing.published_at is not null
     or v_listing.last_verified_at is not null
     or v_listing.seller_account_key is distinct from
          v_source.seller_account_key
     or v_product.owner_id is distinct from v_listing.owner_id
     or v_product.sku is distinct from 'QA-20260823-CC-001'
     or v_product.on_hand <> 1
     or v_product.demo
     or v_product.status not in ('draft', 'active')
     or v_credential.created_by is distinct from v_listing.owner_id
     or v_credential.channel is distinct from 'qoo10'
     or v_credential.environment is distinct from 'production'
     or v_credential.status is distinct from 'active'
     or v_credential.seller_account_key is distinct from
          v_listing.seller_account_key
     or v_credential.seller_account_key_source not in (
          'provider_certified_v1', 'credential_incarnation_v1'
        )
     or v_credential.seller_account_verified_at is null
     or v_credential.last_checked_at is null
     or v_credential.last_check_status is distinct from 'passed'
     or (
       v_credential.expires_at is not null
       and v_credential.expires_at <= statement_timestamp()
     )
  then
    raise exception 'exact Qoo10 already-live tuple drifted'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_exact_already_live_adoptions (
    source_job_id, source_attempt_id, listing_id, product_id, credential_id,
    owner_id, remote_id, seller_account_key, observation,
    observation_sha256, later_jobs, later_jobs_sha256, observed_at,
    provider_status, remote_visibility, purchase_available,
    provider_call_replayed, external_write_count
  ) values (
    v_source.id, v_attempt.id, v_listing.id, v_product.id, v_credential.id,
    v_listing.owner_id, '1217336970', v_listing.seller_account_key,
    p_observation, v_observation_sha, v_later_jobs,
    encode(extensions.digest(v_later_jobs::text, 'sha256'), 'hex'),
    v_observed_at, 'S2', 'live', true, false, 0
  ) returning * into v_existing;

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_already_live_adopt_source',
    v_source.id::text,
    true
  );
  update sellerpilot_private.channel_gateway_jobs source
     set status = 'failed',
         error_message =
           'QOO10_ALREADY_LIVE_ADOPTED: CHANGHEE seller-center and public readback verified S2/live; provider replay forbidden.',
         updated_at = v_existing.recorded_at
   where source.id = v_source.id
     and source.status = 'reconciliation_required';
  if not found then
    raise exception 'exact Qoo10 already-live source retirement failed'
      using errcode = '55000';
  end if;

  v_resources := sellerpilot_private.qoo10_exact_already_live_resources(
    v_source.id
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_already_live_adoption',
    v_source.id::text,
    true
  );
  update sellerpilot_private.product_listings listing
     set status = 'published',
         remote_visibility = 'live',
         provider_status = 'S2',
         remote_resources = v_resources,
         published_at = v_observed_at,
         last_verified_at = v_observed_at,
         last_error = null,
         failure_class = null,
         updated_at = v_existing.recorded_at
   where listing.id = v_listing.id
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null;
  if not found then
    raise exception 'exact Qoo10 already-live listing projection failed'
      using errcode = '55000';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed',
         http_status = 409,
         safe_message =
           'Qoo10 원격 상품은 이미 판매중으로 확인됨 · 재전송 없이 내부 원장 채택 완료'
   where attempt.id = v_attempt.id
     and attempt.status = 'manual_required';
  if not found then
    raise exception 'exact Qoo10 already-live attempt retirement failed'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    v_listing.owner_id,
    'qoo10_exact_already_live_adopted',
    'product_listing',
    v_listing.id::text,
    jsonb_build_object(
      'contract', 'qoo10_already_live_adoption_v1',
      'sourceJobId', v_source.id,
      'sourceAttemptId', v_attempt.id,
      'listingId', v_listing.id,
      'productId', v_product.id,
      'credentialId', v_credential.id,
      'remoteId', '1217336970',
      'sellerSku', 'QA-20260823-CC-001',
      'providerStatus', 'S2',
      'remoteVisibility', 'live',
      'purchaseAvailable', true,
      'observationSha256', v_observation_sha,
      'laterJobsSha256', v_existing.later_jobs_sha256,
      'observedAt', v_observed_at,
      'publicationTimeKnown', false,
      'publishedAtSource', 'first_verified_live_at',
      'knownLocalizationIssues', true,
      'providerCallReplayed', false,
      'providerWritePerformedByRpc', false,
      'gatewayJobCreated', false,
      'externalWriteCount', 0
    )
  );

  return jsonb_build_object(
    'contract', 'qoo10_already_live_adoption_v1',
    'sourceJobId', v_source.id,
    'listingId', v_listing.id,
    'remoteId', '1217336970',
    'providerStatus', 'S2',
    'remoteVisibility', 'live',
    'purchaseAvailable', true,
    'providerCallReplayed', false,
    'externalWriteCount', 0,
    'knownLocalizationIssues', true,
    'reused', false
  );
exception when no_data_found or too_many_rows then
  raise exception 'exact Qoo10 already-live tuple is incomplete'
    using errcode = '55000';
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_already_live_observation_valid(jsonb),
  sellerpilot_private.qoo10_exact_already_live_resources(uuid),
  sellerpilot_private.qoo10_exact_already_live_listing_update_allowed(
    jsonb, jsonb, uuid
  ),
  public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid, text, jsonb)
  to service_role;

do $qoo10_already_live_postimage$
declare
  v_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.sellerpilot_service_adopt_exact_qoo10_already_live(uuid,text,jsonb)'
  );
  v_listing_guard regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.guard_product_listing_seller_lineage()'
  );
  v_job_guard regprocedure := pg_catalog.to_regprocedure(
    'sellerpilot_private.guard_qoo10_exact_localization_update_job()'
  );
begin
  if v_rpc is null or v_listing_guard is null or v_job_guard is null
     or pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(v_listing_guard),
          'sellerpilot.qoo10_already_live_adoption'
        ) = 0
     or pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(v_job_guard),
          'sellerpilot.qoo10_already_live_adopt_source'
        ) = 0
     or not pg_catalog.has_function_privilege(
          'service_role', v_rpc, 'EXECUTE'
        )
     or pg_catalog.has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_rpc, 'EXECUTE')
  then
    raise exception 'exact Qoo10 already-live adoption postimage drifted'
      using errcode = '55000';
  end if;
end;
$qoo10_already_live_postimage$;

comment on table sellerpilot_private.qoo10_exact_already_live_adoptions is
  'Append-only fresh CHANGHEE seller-center and public readback for exact Qoo10 item 1217336970; no provider replay or external write is allowed.';
comment on function
  public.sellerpilot_service_adopt_exact_qoo10_already_live(
    uuid, text, jsonb
  ) is
  'Atomically adopts the already-live exact Qoo10 readback into internal ledgers only; it performs no provider call and preserves the separate localization-update fence.';

commit;
