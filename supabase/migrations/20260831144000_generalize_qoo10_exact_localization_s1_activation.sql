-- Replace the one historical Qoo10 S1 recovery source with a new, server-bound
-- localization update without replaying the ambiguous provider mutation.
-- The historical fac9 job remains immutable. A separate replacement-intent
-- receipt does not discount fac9 until the new ja-JP update has reached a
-- verified one-use S1 -> S2 outcome. One short-lived permit admits only that
-- exact update through the closed gate; its request fingerprint is then
-- carried through a read-only S1 verifier and activation permit.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $qoo10_localization_v2_history_fence$
declare
  v_history_table regclass;
begin
  v_history_table := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if exists (
      select 1 from supabase_migrations.schema_migrations migration
       where migration.version >= '20260831140000'
    ) and ((
      select pg_catalog.count(*)
        from supabase_migrations.schema_migrations migration
       where migration.version = '20260831143000'
         and migration.name = 'ebay_exact_existing_qa_recovery_fence'
    ) <> 1
       or exists (
         select 1 from supabase_migrations.schema_migrations migration
          where migration.version = '20260831144000'
       ))
    then
      raise exception 'exact Qoo10 localization v2 migration history drifted'
        using errcode = '55000';
    end if;
  end if;
end;
$qoo10_localization_v2_history_fence$;

lock table sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.channel_operation_attempts,
  sellerpilot_private.product_listings,
  sellerpilot_private.qoo10_exact_s1_verifier_runs,
  sellerpilot_private.qoo10_exact_s1_observations,
  sellerpilot_private.qoo10_exact_s1_activation_permits,
  sellerpilot_private.qoo10_exact_s1_activation_outcomes
  in share row exclusive mode;

create table sellerpilot_private.qoo10_exact_localization_source_retirements (
  source_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null,
  remote_id text not null,
  source_request_sha256 text not null,
  source_response_sha256 text not null,
  replacement_contract text not null,
  provider_call_replayed boolean not null,
  retired_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_localization_source_retirement_check check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and source_attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and remote_id = '1217336970'
    and source_request_sha256 =
          'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
    and source_response_sha256 =
          'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
    and replacement_contract = 'qoo10_exact_localization_update_v2'
    and not provider_call_replayed
  )
);

alter table sellerpilot_private.qoo10_exact_localization_source_retirements
  enable row level security;
revoke all on sellerpilot_private.qoo10_exact_localization_source_retirements
  from public, anon, authenticated, service_role;

create trigger block_qoo10_exact_localization_source_retirement_change
before update or delete
on sellerpilot_private.qoo10_exact_localization_source_retirements
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();

create table sellerpilot_private.qoo10_exact_localization_update_permits (
  permit_id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  remote_id text not null,
  seller_account_key text not null,
  release_sha text not null,
  request_fingerprint text not null,
  arguments_sha256 text,
  arguments_bytes integer,
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  update_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  update_attempt_id uuid unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  request_payload_sha256 text,
  request_payload_bytes integer,
  bound_at timestamptz,
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint qoo10_exact_localization_update_permit_target_check check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id = '1217336970'
    and seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and release_sha ~ '^[a-f0-9]{40}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
    and expires_at > armed_at
    and expires_at <= armed_at + interval '5 minutes'
  ),
  constraint qoo10_exact_localization_update_permit_binding_check check (
    (
      invalidated_at is null and invalidation_reason is null
      and (
        (
          update_job_id is null and update_attempt_id is null
          and arguments_sha256 is null and arguments_bytes is null
          and request_payload_sha256 is null and request_payload_bytes is null
          and bound_at is null and bound_worker_token_id is null
          and bound_claim_token is null and consumed_at is null
        ) or (
          update_job_id is not null and update_attempt_id is not null
          and arguments_sha256 ~ '^[a-f0-9]{64}$'
          and arguments_bytes between 100 and 128000
          and request_payload_sha256 ~ '^[a-f0-9]{64}$'
          and request_payload_bytes between 100 and 128000
          and (
            (
              bound_at is null and bound_worker_token_id is null
              and bound_claim_token is null and consumed_at is null
            ) or (
              bound_at is not null and bound_worker_token_id is not null
              and bound_claim_token is not null
              and (consumed_at is null or consumed_at >= bound_at)
            )
          )
        )
      )
    ) or (
      invalidated_at is not null and invalidation_reason = 'expired_before_job'
      and update_job_id is null and update_attempt_id is null
      and arguments_sha256 is null and arguments_bytes is null
      and request_payload_sha256 is null and request_payload_bytes is null
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
    )
  )
);

create unique index qoo10_exact_localization_one_update_per_listing
  on sellerpilot_private.qoo10_exact_localization_update_permits(listing_id)
  where invalidated_at is null;

alter table sellerpilot_private.qoo10_exact_localization_update_permits
  enable row level security;
revoke all on sellerpilot_private.qoo10_exact_localization_update_permits
  from public, anon, authenticated, service_role;

do $qoo10_localization_v2_retire_fac9_without_replay$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  select * into v_source
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid;
  if not found then
    -- Deterministic schema replay has no production evidence to synthesize.
    return;
  end if;

  if v_source.attempt_id is distinct from
       '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
     or v_source.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_source.credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_source.channel is distinct from 'qoo10'
     or v_source.operation is distinct from 'listing.update'
     or v_source.environment is distinct from 'production'
     or v_source.status is distinct from 'reconciliation_required'
     or v_source.seller_account_key is distinct from
       '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or encode(extensions.digest(v_source.request_payload::text,'sha256'),'hex')
          is distinct from
       'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
     or encode(extensions.digest(v_source.response_payload::text,'sha256'),'hex')
          is distinct from
       'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
     or not exists (
       select 1
         from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = v_source.attempt_id
          and attempt.owner_id =
                '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and attempt.credential_id = v_source.credential_id
          and attempt.channel is not distinct from 'qoo10'
          and attempt.operation is not distinct from 'listing.update'
          and attempt.remote_id is not distinct from '1217336970'
          and attempt.gateway_write_required
          and not attempt.pre_gateway_retryable
     )
     or not exists (
       select 1
         from sellerpilot_private.product_listings listing
        where listing.id = v_source.listing_id
          and listing.owner_id =
                '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
          and listing.product_id =
                'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
          and listing.channel_key is not distinct from 'qoo10'
          and listing.market = 'JP'
          and listing.target_id = ''
          and listing.remote_id = '1217336970'
          and listing.seller_account_key = v_source.seller_account_key
          and not (
            listing.status = 'published'
            or listing.remote_visibility = 'live'
            or upper(coalesce(listing.provider_status,'')) = 'S2'
          )
     )
     or (
       select count(*) from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_source.id
     ) <> 1
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs later_job
        where later_job.listing_id = v_source.listing_id
          and later_job.operation in ('listing.create','listing.update','listing.stop')
          and later_job.created_at > v_source.created_at
     )
  then
    raise exception 'historical exact Qoo10 localization source drifted'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_exact_localization_source_retirements (
    source_job_id,source_attempt_id,listing_id,remote_id,
    source_request_sha256,source_response_sha256,replacement_contract,
    provider_call_replayed
  ) values (
    v_source.id,v_source.attempt_id,v_source.listing_id,'1217336970',
    'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d',
    'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768',
    'qoo10_exact_localization_update_v2',false
  );
end;
$qoo10_localization_v2_retire_fac9_without_replay$;

alter table sellerpilot_private.qoo10_exact_s1_verifier_runs
  add column source_request_fingerprint text;

alter table sellerpilot_private.qoo10_exact_s1_verifier_runs
  drop constraint qoo10_exact_s1_verifier_source_check;
alter table sellerpilot_private.qoo10_exact_s1_verifier_runs
  add constraint qoo10_exact_s1_verifier_source_check check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id = '1217336970'
    and seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and source_request_sha256 ~ '^[a-f0-9]{64}$'
    and source_request_bytes between 100 and 1000000
    and source_response_sha256 ~ '^[a-f0-9]{64}$'
    and source_response_bytes between 100 and 1000000
    and release_sha ~ '^[a-f0-9]{40}$'
    and contract = 'qoo10_exact_s1_verifier_v1'
    and (
      (
        source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
        and source_attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
        and source_request_fingerprint is null
        and source_request_sha256 =
          'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
        and source_response_sha256 =
          'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
      ) or (
        source_job_id is distinct from
          'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
        and source_request_fingerprint ~ '^[a-f0-9]{64}$'
      )
    )
  );

alter table sellerpilot_private.qoo10_exact_s1_observations
  drop constraint qoo10_exact_s1_observation_source_check;
alter table sellerpilot_private.qoo10_exact_s1_observations
  add constraint qoo10_exact_s1_observation_source_check check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and remote_id = '1217336970'
    and release_sha ~ '^[a-f0-9]{40}$'
    and verifier_response_sha256 ~ '^[a-f0-9]{64}$'
    and verifier_response_bytes between 100 and 1000000
    and jsonb_typeof(activation_expectation) = 'object'
    and octet_length(activation_expectation::text) between 500 and 128000
    and provider_status = 'S1'
    and remote_visibility = 'non_public'
    and verifier_completed_at >= verified_at
    and verifier_completed_at <= verified_at + interval '5 minutes'
    and contract = 'qoo10_exact_s1_observation_v1'
  );

alter table sellerpilot_private.qoo10_exact_s1_activation_permits
  drop constraint qoo10_exact_s1_activation_target_check;
alter table sellerpilot_private.qoo10_exact_s1_activation_permits
  add constraint qoo10_exact_s1_activation_target_check check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id = '1217336970'
    and seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and release_sha ~ '^[a-f0-9]{40}$'
    and activation_request_sha256 ~ '^[a-f0-9]{64}$'
    and activation_request_bytes between 100 and 128000
    and write_resource_key ~ '^[a-f0-9]{64}$'
    and contract = 'qoo10_exact_s1_activation_permit_v1'
  );

alter table sellerpilot_private.qoo10_exact_s1_activation_outcomes
  drop constraint qoo10_exact_s1_activation_outcome_check;
alter table sellerpilot_private.qoo10_exact_s1_activation_outcomes
  add constraint qoo10_exact_s1_activation_outcome_check check (
    listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and remote_id = '1217336970'
    and terminal_status in ('succeeded','failed','reconciliation_required')
    and contract = 'qoo10_exact_s1_activation_outcome_v1'
    and (
      terminal_status is distinct from 'succeeded'
      or (
        activation_response_sha256 ~ '^[a-f0-9]{64}$'
        and activation_response_bytes between 100 and 1000000
        and provider_status = 'S2'
        and remote_visibility = 'live'
        and verified_at is not null
      )
    )
  );

create function sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
  p_arguments jsonb,
  p_release_sha text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_params jsonb := p_arguments->'params';
  v_marker jsonb := p_arguments->'sellerpilotQoo10ExactLocalization';
  v_copy text;
  v_images jsonb;
begin
  if p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or jsonb_typeof(v_params) is distinct from 'object'
     or jsonb_typeof(v_marker) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_marker)) <> 8
  then return false; end if;
  v_copy := lower(concat_ws(E'\n',
    v_params->>'ItemTitle',v_params->>'Keyword',v_params->>'ItemDescription'
  ));
  v_images := sellerpilot_private.qoo10_exact_detail_image_urls(
    v_params->>'ItemDescription'
  );
  return v_marker->>'status' is not distinct from 'allowed'
    and v_marker->>'contract' is not distinct from
          'qoo10_exact_localization_update_v2'
    and v_marker->>'productId' is not distinct from
          'ddccde35-9c58-4856-b673-d7aa27ce4220'
    and v_marker->>'listingId' is not distinct from
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
    and v_marker->>'credentialId' is not distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'
    and v_marker->>'remoteId' is not distinct from '1217336970'
    and v_marker->>'sellerSku' is not distinct from 'QA-20260823-CC-001'
    and v_marker->>'releaseSha' is not distinct from p_release_sha
    and v_params->>'ItemCode' is not distinct from '1217336970'
    and v_params->>'SellerCode' is not distinct from 'QA-20260823-CC-001'
    and v_params->>'SecondSubCat' is not distinct from '320000542'
    and v_params->>'ItemTitle' is not distinct from
          '貼り付け式ケーブル整理クリップ6個セット'
    and v_params->>'Keyword' is not distinct from
          '貼り付け式ケーブル整理クリップ6個セット,No Brand,購入前確認'
    and v_params->>'PromotionName' is not distinct from '購入前確認'
    and v_params->>'RetailPrice' is not distinct from '1871'
    and v_params->>'ItemPrice' is not distinct from '1871'
    and v_params->>'ItemQty' is not distinct from '1'
    and v_params->>'ShippingNo' is not distinct from '806971'
    and p_arguments->>'publicationIntent' is not distinct from 'live'
    and p_arguments->>'publicationStateContract' is not distinct from
          'verified_remote_state_v1'
    and p_arguments->>'publicationExpectedLocale' is not distinct from 'ja-JP'
    and p_arguments->>'publicationExpectedFingerprint' ~ '^[a-f0-9]{64}$'
    and p_arguments->>'publicationExpectedImageCount' is not distinct from '8'
    and v_copy !~ '[가-힣]'
    and v_copy !~ '(^|[^a-z])krw([^a-z]|$)'
    and pg_catalog.strpos(v_copy,'₩') = 0
    and pg_catalog.strpos(v_copy,'ウォン') = 0
    and v_copy !~ '[0-9][0-9,.[:space:]]*[[:space:]]*원'
    and not exists (
      select 1 from unnest(array[
        'buchakhyeong','keibeul','jeongri','keulrip',
        '6gae','seteu','geomjeongsaek'
      ]) token where pg_catalog.strpos(
        regexp_replace(v_copy,'[^a-z0-9]','','g'),token
      ) > 0
    )
    and jsonb_array_length(v_images) = 8
    and (
      select count(*) = 8
         and count(distinct image.value) = 8
         and bool_and(
           jsonb_typeof(image.value) = 'string'
           and image.value#>>'{}' ~ '^https://[^[:space:]#]+$'
         )
        from jsonb_array_elements(v_images) image(value)
    );
exception when others then
  return false;
end;
$$;

create function public.sellerpilot_service_arm_exact_qoo10_localization_update(
  p_listing_id uuid,
  p_credential_id uuid,
  p_release_sha text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  if p_listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or p_credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or p_release_sha is null
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(
       p_release_sha
     )
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_source_retirements retirement
        where retirement.source_job_id =
              'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
          and retirement.source_attempt_id =
              '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
          and retirement.listing_id = p_listing_id
          and retirement.remote_id = '1217336970'
          and retirement.replacement_contract =
                'qoo10_exact_localization_update_v2'
          and not retirement.provider_call_replayed
     )
     or exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs source
        where source.listing_id = p_listing_id
          and source.channel is not distinct from 'qoo10'
          and source.operation is not distinct from 'listing.update'
          and source.request_payload#>>
                '{arguments,sellerpilotQoo10ExactLocalization,contract}' =
                'qoo10_exact_localization_update_v2'
     )
  then
    raise exception 'exact Qoo10 localization update permit identity invalid'
      using errcode='55000';
  end if;

  update sellerpilot_private.qoo10_exact_localization_update_permits permit
     set invalidated_at=clock_timestamp(),
         invalidation_reason='expired_before_job'
   where permit.listing_id=p_listing_id
     and permit.invalidated_at is null
     and permit.update_job_id is null
     and permit.expires_at <= statement_timestamp();

  select * into v_permit
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.listing_id=p_listing_id
     and permit.invalidated_at is null
   for update;
  if found then
    if v_permit.update_job_id is not null
       or v_permit.release_sha is distinct from p_release_sha
       or v_permit.request_fingerprint is distinct from p_request_fingerprint
       or v_permit.expires_at <= statement_timestamp()
    then
      raise exception 'exact Qoo10 localization update permit conflict'
        using errcode='55000';
    end if;
    return jsonb_build_object(
      'contract','qoo10_exact_localization_update_permit_v2',
      'permitId',v_permit.permit_id,
      'listingId',v_permit.listing_id,
      'releaseSha',v_permit.release_sha,
      'requestFingerprint',v_permit.request_fingerprint,
      'armedAt',v_permit.armed_at,
      'expiresAt',v_permit.expires_at,
      'bound',false,
      'reused',true
    );
  end if;

  insert into sellerpilot_private.qoo10_exact_localization_update_permits (
    source_job_id,listing_id,product_id,credential_id,owner_id,remote_id,
    seller_account_key,release_sha,request_fingerprint,armed_at,expires_at
  ) values (
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid,
    p_listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    p_credential_id,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '1217336970',
    '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46',
    p_release_sha,p_request_fingerprint,clock_timestamp(),
    clock_timestamp()+interval '5 minutes'
  ) returning * into v_permit;

  return jsonb_build_object(
    'contract','qoo10_exact_localization_update_permit_v2',
    'permitId',v_permit.permit_id,
    'listingId',v_permit.listing_id,
    'releaseSha',v_permit.release_sha,
    'requestFingerprint',v_permit.request_fingerprint,
    'armedAt',v_permit.armed_at,
    'expiresAt',v_permit.expires_at,
    'bound',false,
    'reused',false
  );
end;
$$;

create function sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
  p_source_job_id uuid,
  p_release_sha text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_arguments jsonb;
begin
  if p_source_job_id is null
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$' then
    return false;
  end if;
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_source_job_id;
  if not found then return false; end if;
  v_arguments := v_job.request_payload->'arguments';

  if jsonb_typeof(v_job.request_payload) is distinct from 'object'
     or jsonb_typeof(v_arguments) is distinct from 'object'
     or jsonb_typeof(v_params) is distinct from 'object'
     or jsonb_typeof(v_marker) is distinct from 'object'
     or jsonb_typeof(v_job.response_payload) is distinct from 'object'
     or jsonb_typeof(v_job.response_payload->'steps') is distinct from 'array'
     or jsonb_array_length(v_job.response_payload->'steps') <> 4
     or v_arguments->>'publicationExpectedImageCount' is distinct from '8'
     or exists (
       select 1
         from jsonb_array_elements(v_job.response_payload->'steps') step
        where step->>'ok' is distinct from 'true'
           or case
                when step->>'status' ~ '^[0-9]+$' then
                  (step->>'status')::integer not between 200 and 299
                else true
              end
           or step#>>'{data,ResultCode}' is distinct from '0'
     )
  then
    return false;
  end if;

  return sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
      v_arguments,p_release_sha
    )
    and v_job.id is distinct from
          'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and v_job.attempt_id is not null
    and v_job.listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and v_job.credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and v_job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
    and v_job.channel is not distinct from 'qoo10'
    and v_job.operation is not distinct from 'listing.update'
    and v_job.environment is not distinct from 'production'
    -- All four provider/readback steps succeeded, but live publication is
    -- deliberately unfulfilled while the exact item remains seller-stopped S1.
    -- gatewayJobCompletionStatus therefore records only this shape as
    -- reconciliation_required; it is not an arbitrary failed update.
    and v_job.status is not distinct from 'reconciliation_required'
    and v_job.attempt_count = 1
    and v_job.provider_mutation_started_at is not null
    and v_job.completed_at is not null
    and v_job.response_payload is not null
    and v_job.seller_account_key is not distinct from
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and v_job.request_fingerprint ~ '^[a-f0-9]{64}$'
    and sellerpilot_private.qoo10_exact_response_state_valid(
      jsonb_set(v_job.response_payload,'{ok}','true'::jsonb,true),
      'listing.update','qoo10-rollback-pre-activation-readback',
      'S1','non_public',v_arguments
    )
    and v_job.response_payload->>'ok' is not distinct from 'false'
    and v_job.response_payload->>'publicationFulfilled' is not distinct from
          'false'
    and v_job.response_payload#>>'{steps,0,name}' is not distinct from
          'qoo10-exact-current-s1-prewrite-readback'
    and v_job.response_payload#>>'{steps,1,name}' is not distinct from
          'UpdateGoods'
    and v_job.response_payload#>>'{steps,2,name}' is not distinct from
          'EditGoodsContents'
    and v_job.response_payload#>>'{steps,3,name}' is not distinct from
          'qoo10-rollback-pre-activation-readback'
    and (
      select count(*) from sellerpilot_private.gateway_completion_receipts receipt
       where receipt.job_id = v_job.id
    ) = 1
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
       where attempt.id = v_job.attempt_id
         and attempt.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and attempt.credential_id = v_job.credential_id
         and attempt.channel is not distinct from 'qoo10'
         and attempt.operation is not distinct from 'listing.update'
         and attempt.status = 'manual_required'
         and attempt.remote_id = '1217336970'
         and attempt.request_fingerprint = v_job.request_fingerprint
         and attempt.completed_at = v_job.completed_at
         and attempt.gateway_write_required
         and not attempt.pre_gateway_retryable
    )
    and exists (
      select 1
        from sellerpilot_private.product_listings listing
        join sellerpilot_private.products product on product.id = listing.product_id
        join sellerpilot_private.channel_credentials credential
          on credential.id = v_job.credential_id
       where listing.id = v_job.listing_id
         and listing.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and listing.channel_key is not distinct from 'qoo10'
         and listing.market = 'JP'
         and listing.target_id = ''
         and listing.status = 'failed'
         and listing.failure_class = 'external_action'
         and listing.remote_visibility = 'unknown'
         and listing.requested_publication_intent = 'live'
         and listing.remote_id = '1217336970'
         and listing.seller_account_key = v_job.seller_account_key
         and product.owner_id = listing.owner_id
         and not product.demo
         and product.status is distinct from 'archived'
         and credential.channel is not distinct from 'qoo10'
         and credential.environment is not distinct from 'production'
         and credential.status is not distinct from 'active'
         and credential.seller_account_key = v_job.seller_account_key
    )
    and not exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs later_job
       where later_job.listing_id = v_job.listing_id
         and later_job.operation in ('listing.create','listing.update','listing.stop')
         and later_job.created_at > v_job.created_at
    )
    and not exists (
      select 1
        from sellerpilot_private.channel_gateway_jobs active_job
       where active_job.listing_id = v_job.listing_id
         and active_job.operation in ('listing.create','listing.update','listing.stop')
         and active_job.status in ('queued','running')
         and active_job.id is distinct from v_job.id
    );
exception when others then
  return false;
end;
$$;

do $qoo10_localization_v2_preserve_legacy_source_predicate$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.qoo10_exact_s1_source_is_current()'::regprocedure
  ) into v_definition;
  v_rewritten := pg_catalog.replace(
    v_definition,
    'qoo10_exact_s1_source_is_current()',
    'qoo10_exact_s1_legacy_source_is_current()'
  );
  if v_rewritten = v_definition then
    raise exception 'legacy exact Qoo10 source predicate preimage missed'
      using errcode = '55000';
  end if;
  execute v_rewritten;
end;
$qoo10_localization_v2_preserve_legacy_source_predicate$;

create or replace function sellerpilot_private.qoo10_exact_s1_source_is_current()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source_job_id uuid;
  v_release_sha text;
begin
  select run.source_job_id,run.release_sha
    into v_source_job_id,v_release_sha
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = run.verifier_job_id
   where run.source_request_fingerprint is not null
     and verifier.status in ('queued','running','succeeded','reconciliation_required')
   order by run.queued_at desc
   limit 1;
  if found then
    return sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
      v_source_job_id,v_release_sha
    );
  end if;
  return sellerpilot_private.qoo10_exact_s1_legacy_source_is_current();
end;
$$;

create or replace function sellerpilot_private.qoo10_exact_s1_verifier_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_job.listing_id is not distinct from
      '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and p_job.channel is not distinct from 'qoo10'
    and p_job.operation is not distinct from 'listing.publication.verify'
    and p_job.credential_id is not distinct from
      '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and p_job.seller_account_key is not distinct from
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and p_job.request_fingerprint ~ '^[a-f0-9]{64}$'
    and p_job.request_payload->>'periodicKey' is not distinct from (
      'qoo10-exact-s1:' ||
      (p_job.request_payload#>>'{arguments,publicationReviewSourceJobId}')
    )
    and p_job.request_payload#>>'{arguments,publicationReviewSourceJobId}' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>'{arguments,sellerpilotReadOnly}'
          is not distinct from 'true'::jsonb
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10ExactS1Recovery}'
          is not distinct from
      'qoo10_exact_s1_verifier_v1'
    and p_job.request_payload#>>'{arguments,publicationReviewId}'
          is not distinct from
      '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
    and p_job.request_payload#>>'{arguments,remoteId}'
          is not distinct from '1217336970'
    and p_job.request_payload#>>'{arguments,publicationExpectedLocale}'
          is not distinct from 'ja-JP'
$$;

create or replace function sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_new boolean;
  v_exact_new boolean;
  v_source_job_id uuid;
  v_release_sha text;
begin
  if tg_op in ('UPDATE','DELETE') and exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs verifier
     where verifier.id is distinct from old.id
       and verifier.status in ('queued','running','reconciliation_required')
       and sellerpilot_private.qoo10_exact_s1_verifier_job_matches(verifier)
       and verifier.request_payload#>>'{arguments,publicationReviewSourceJobId}' =
             old.id::text
  ) then
    raise exception 'exact Qoo10 localization source is locked by its verifier'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  v_active_new := new.listing_id is not null
    and new.operation in (
      'listing.create','listing.update','listing.stop','listing.activate',
      'price.update','inventory.update',
      'listing.lineage.verify','listing.publication.verify'
    )
    and new.status in ('queued','running','reconciliation_required');
  if not v_active_new then return new; end if;

  v_exact_new := sellerpilot_private.qoo10_exact_s1_verifier_job_matches(new);
  if v_exact_new then
    begin
      v_source_job_id :=
        (new.request_payload#>>'{arguments,publicationReviewSourceJobId}')::uuid;
    exception when others then
      raise exception 'exact Qoo10 verifier source id invalid' using errcode='55000';
    end;
    select source.request_payload#>>
             '{arguments,sellerpilotQoo10ExactLocalization,releaseSha}'
      into v_release_sha
      from sellerpilot_private.channel_gateway_jobs source
     where source.id = v_source_job_id
       and source.status is not distinct from 'reconciliation_required'
     for update;
    if not found
       or (
         v_source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and not sellerpilot_private.qoo10_exact_s1_legacy_source_is_current()
       )
       or (
         v_source_job_id is distinct from
           'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and (
           current_setting(
             'sellerpilot.qoo10_exact_localization_verifier_enqueue',true
           ) is distinct from new.id::text
           or not sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
             v_source_job_id,v_release_sha
           )
         )
       )
       or exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs other_job
          where other_job.listing_id = new.listing_id
            and other_job.status in ('queued','running','reconciliation_required')
            and other_job.operation in (
              'listing.create','listing.update','listing.stop','listing.activate',
              'price.update','inventory.update',
              'listing.lineage.verify','listing.publication.verify'
            )
            and other_job.id not in (new.id,v_source_job_id)
       )
    then
      raise exception 'exact Qoo10 localization verifier overlap is not current'
        using errcode = '55000';
    end if;
  elsif exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs verifier
     where verifier.listing_id = new.listing_id
       and verifier.id is distinct from new.id
       and verifier.status in ('queued','running','reconciliation_required')
       and sellerpilot_private.qoo10_exact_s1_verifier_job_matches(verifier)
  ) then
    raise exception 'listing work overlaps the exact Qoo10 S1 verifier'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when sellerpilot_private.qoo10_exact_s1_verifier_job_matches(
             channel_gateway_jobs
           )
        then 'qoo10_exact_s1_verifier_v1'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.update'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key=
             '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,status}'=
             'allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,contract}'=
             'qoo10_exact_localization_update_v2'
        then 'qoo10_exact_localization_update_v2'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.activate'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key=
             '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'=
             'allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'=
             'qoo10_s1_activation_v1'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'=
             '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'=
             '1217336970'
        then 'qoo10_exact_s1_activation_v1'
      when channel='temu' and operation='listing.stop'
       and request_payload#>>'{arguments,sellerpilotTemuContainment,version}'=
             'temu_safe_test_containment_v1'
        then 'temu_safe_test_containment_v1'
      when channel='temu' and operation='listing.publication.verify'
       and request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'=
             'temu_safe_test_containment_discovery_v1'
       and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
        then 'temu_safe_test_containment_discovery_v1'
      else 'default'
    end)
  )
  where listing_id is not null
    and operation in (
      'listing.create','listing.update','listing.stop','listing.activate',
      'price.update','inventory.update',
      'listing.lineage.verify','listing.publication.verify'
    )
    and status in ('queued','running','reconciliation_required');

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid,uuid,uuid,text,text,jsonb
) rename to sellerpilot_311440_enqueue_before_qoo10_localization_v2;
revoke all on function
  public.sellerpilot_311440_enqueue_before_qoo10_localization_v2(
    uuid,uuid,uuid,text,text,jsonb
  ) from public,anon,authenticated,service_role;

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
set search_path=''
as $$
declare
  v_arguments jsonb:=p_request_payload->'arguments';
  v_marker jsonb:=p_request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
  v_release_sha text:=v_marker->>'releaseSha';
  v_permit sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
  v_result jsonb;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  if p_listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_marker is not null
  then
    if p_listing_id is distinct from
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       or p_credential_id is distinct from
         '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       or p_channel is distinct from 'qoo10'
       or p_operation is distinct from 'listing.update'
       or not sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
         v_arguments,v_release_sha
       )
       or not exists (
         select 1
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id=p_attempt_id
            and attempt.owner_id=
                  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
            and attempt.credential_id=p_credential_id
            and attempt.channel='qoo10'
            and attempt.operation='listing.update'
            and attempt.status='running'
            and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
       )
    then
      raise exception 'exact Qoo10 localization enqueue identity invalid'
        using errcode='55000';
    end if;
    select * into v_permit
      from sellerpilot_private.qoo10_exact_localization_update_permits permit
     where permit.listing_id=p_listing_id
       and permit.credential_id=p_credential_id
       and permit.release_sha=v_release_sha
       and permit.invalidated_at is null
       and permit.update_job_id is null
       and permit.expires_at>statement_timestamp()
       and permit.request_fingerprint=(
         select attempt.request_fingerprint
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id=p_attempt_id
       )
     for update;
    if not found then
      raise exception 'exact Qoo10 localization update permit missing'
        using errcode='55000';
    end if;
  end if;

  v_result:=public.sellerpilot_311440_enqueue_before_qoo10_localization_v2(
    p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
    p_request_payload
  );

  if v_marker is not null then
    if v_result->>'job_id' is null
       or v_result->>'job_id' !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_result->>'status' is distinct from 'queued'
    then
      raise exception 'exact Qoo10 localization update job not newly queued'
        using errcode='55000';
    end if;
    v_job_id:=(v_result->>'job_id')::uuid;
    update sellerpilot_private.qoo10_exact_localization_update_permits permit
       set update_job_id=v_job_id,
           update_attempt_id=p_attempt_id,
           arguments_sha256=encode(extensions.digest(v_arguments::text,'sha256'),'hex'),
           arguments_bytes=octet_length(v_arguments::text),
           request_payload_sha256=encode(
             extensions.digest(p_request_payload::text,'sha256'),'hex'
           ),
           request_payload_bytes=octet_length(p_request_payload::text)
     where permit.permit_id=v_permit.permit_id
       and permit.update_job_id is null
       and permit.update_attempt_id is null
       and permit.invalidated_at is null
       and permit.expires_at>statement_timestamp()
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.id=v_job_id
            and job.attempt_id=p_attempt_id
            and job.listing_id=p_listing_id
            and job.credential_id=p_credential_id
            and job.channel='qoo10'
            and job.operation='listing.update'
            and job.environment='production'
            and job.status='queued'
            and job.attempt_count=0
            and job.seller_account_key=permit.seller_account_key
            and job.request_fingerprint=permit.request_fingerprint
            and job.request_payload=p_request_payload
            and job.provider_mutation_started_at is null
            and job.response_payload is null
            and job.completed_at is null
       );
    if not found then
      raise exception 'exact Qoo10 localization update job binding failed'
        using errcode='55000';
    end if;
  end if;
  return v_result;
end;
$$;

create function sellerpilot_private.guard_qoo10_exact_localization_update_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_marker jsonb:=new.request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
begin
  if new.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and v_marker is null
  then return new; end if;
  if new.operation is distinct from 'listing.update' and v_marker is null then
    return new;
  end if;
  if new.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or new.credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or new.channel is distinct from 'qoo10'
     or new.operation is distinct from 'listing.update'
     or new.environment is distinct from 'production'
     or new.seller_account_key is distinct from
       '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_update_permits permit
        where permit.update_job_id=new.id
          and permit.update_attempt_id=new.attempt_id
          and permit.listing_id=new.listing_id
          and permit.credential_id=new.credential_id
          and permit.seller_account_key=new.seller_account_key
          and permit.release_sha=v_marker->>'releaseSha'
          and permit.request_fingerprint=new.request_fingerprint
          and permit.arguments_sha256=encode(extensions.digest(
                (new.request_payload->'arguments')::text,'sha256'
              ),'hex')
          and permit.arguments_bytes=octet_length(
                (new.request_payload->'arguments')::text
              )
          and permit.request_payload_sha256=encode(extensions.digest(
                new.request_payload::text,'sha256'
              ),'hex')
          and permit.request_payload_bytes=octet_length(new.request_payload::text)
          and permit.invalidated_at is null
          and sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
                new.request_payload->'arguments',permit.release_sha
              )
     )
  then
    raise exception 'exact Qoo10 localization update job lineage invalid'
      using errcode='55000';
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'exact Qoo10 localization update job lineage invalid'
    using errcode='55000';
end;
$$;

create constraint trigger guard_qoo10_exact_localization_update_job
after insert or update on sellerpilot_private.channel_gateway_jobs
deferrable initially deferred
for each row execute function
  sellerpilot_private.guard_qoo10_exact_localization_update_job();

create function sellerpilot_private.bind_exact_qoo10_localization_update_claim(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job_id uuid;
  v_claim_token uuid;
  v_worker_token_id uuid;
begin
  if jsonb_typeof(p_old) is distinct from 'object'
     or jsonb_typeof(p_new) is distinct from 'object'
  then return false; end if;
  v_job_id:=(p_old->>'id')::uuid;
  v_claim_token:=(p_new->>'claim_token')::uuid;
  v_worker_token_id:=(p_new->>'worker_token_id')::uuid;
  if p_new->>'id' is distinct from p_old->>'id'
     or p_old->>'status' is distinct from 'queued'
     or p_new->>'status' is distinct from 'running'
     or p_old->>'channel' is distinct from 'qoo10'
     or p_new->>'channel' is distinct from 'qoo10'
     or p_old->>'operation' is distinct from 'listing.update'
     or p_new->>'operation' is distinct from 'listing.update'
     or (p_old->>'attempt_count')::integer is distinct from 0
     or (p_new->>'attempt_count')::integer is distinct from 1
     or p_old->'worker_token_id' is distinct from 'null'::jsonb
     or p_old->'claim_token' is distinct from 'null'::jsonb
     or p_old->'lease_expires_at' is distinct from 'null'::jsonb
     or p_old->'started_at' is distinct from 'null'::jsonb
     or p_old->'completed_at' is distinct from 'null'::jsonb
     or p_old->'response_payload' is distinct from 'null'::jsonb
     or p_old->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'completed_at' is distinct from 'null'::jsonb
     or p_new->'response_payload' is distinct from 'null'::jsonb
     or p_new->'provider_mutation_started_at' is distinct from 'null'::jsonb
     or p_new->'error_message' is distinct from 'null'::jsonb
     or (p_new->>'started_at')::timestamptz is null
     or (p_new->>'lease_expires_at')::timestamptz <= statement_timestamp()
     or (p_new->>'lease_expires_at')::timestamptz >
          statement_timestamp()+interval '16 minutes'
     or p_new-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
        is distinct from
        p_old-'status'-'worker_token_id'-'claim_token'-'attempt_count'
          -'lease_expires_at'-'started_at'-'error_message'-'updated_at'
  then return false; end if;

  update sellerpilot_private.qoo10_exact_localization_update_permits permit
     set bound_at=clock_timestamp(),
         bound_worker_token_id=v_worker_token_id,
         bound_claim_token=v_claim_token
   where permit.update_job_id=v_job_id
     and permit.update_attempt_id=(p_new->>'attempt_id')::uuid
     and permit.listing_id=(p_new->>'listing_id')::uuid
     and permit.credential_id=(p_new->>'credential_id')::uuid
     and permit.seller_account_key=p_new->>'seller_account_key'
     and permit.request_fingerprint=p_new->>'request_fingerprint'
     and permit.request_payload_sha256=encode(extensions.digest(
           (p_new->'request_payload')::text,'sha256'),'hex')
     and permit.request_payload_bytes=octet_length(
           (p_new->'request_payload')::text
         )
     and permit.invalidated_at is null
     and permit.consumed_at is null
     and permit.bound_at is null
     and permit.bound_worker_token_id is null
     and permit.bound_claim_token is null
     and permit.expires_at>statement_timestamp()
     and sellerpilot_private.qoo10_exact_s1_release_is_current(
           permit.release_sha
         )
     and sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
           p_new->'request_payload'->'arguments',permit.release_sha
         );
  return found;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.exact_qoo10_localization_update_provider_allowed(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
      from sellerpilot_private.qoo10_exact_localization_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=permit.update_job_id
     where permit.update_job_id=p_job_id
       and permit.bound_claim_token=p_claim_token
       and permit.bound_worker_token_id=job.worker_token_id
       and permit.bound_at is not null
       and permit.invalidated_at is null
       and permit.expires_at>statement_timestamp()
       and job.status='running'
       and job.channel='qoo10'
       and job.operation='listing.update'
       and job.environment='production'
       and job.claim_token=p_claim_token
       and job.attempt_count=1
       and job.started_at is not null
       and job.lease_expires_at>statement_timestamp()
       and job.completed_at is null
       and job.response_payload is null
       and job.error_message is null
       and job.attempt_id=permit.update_attempt_id
       and job.listing_id=permit.listing_id
       and job.credential_id=permit.credential_id
       and job.seller_account_key=permit.seller_account_key
       and job.request_fingerprint=permit.request_fingerprint
       and permit.arguments_sha256=encode(extensions.digest(
             (job.request_payload->'arguments')::text,'sha256'),'hex')
       and permit.arguments_bytes=octet_length(
             (job.request_payload->'arguments')::text
           )
       and permit.request_payload_sha256=encode(extensions.digest(
             job.request_payload::text,'sha256'),'hex')
       and permit.request_payload_bytes=octet_length(job.request_payload::text)
       and sellerpilot_private.qoo10_exact_s1_release_is_current(
             permit.release_sha
           )
       and sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
             job.request_payload->'arguments',permit.release_sha
           )
       and (
         (job.provider_mutation_started_at is null and permit.consumed_at is null)
         or (
           job.provider_mutation_started_at is not null
           and permit.consumed_at is not null
           and permit.consumed_at>=job.provider_mutation_started_at
         )
       )
  )
$$;

create function sellerpilot_private.consume_exact_qoo10_localization_update_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  update sellerpilot_private.qoo10_exact_localization_update_permits permit
     set consumed_at=clock_timestamp()
   where permit.update_job_id=p_job_id
     and permit.bound_claim_token=p_claim_token
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at>statement_timestamp()
     and exists(
       select 1
         from sellerpilot_private.channel_gateway_jobs job
        where job.id=permit.update_job_id
          and job.status='running'
          and job.claim_token=permit.bound_claim_token
          and job.worker_token_id=permit.bound_worker_token_id
          and job.provider_mutation_started_at is not null
          and job.completed_at is null
          and job.response_payload is null
     );
  if found then return true; end if;
  return exists(
    select 1
      from sellerpilot_private.qoo10_exact_localization_update_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=permit.update_job_id
     where permit.update_job_id=p_job_id
       and permit.bound_claim_token=p_claim_token
       and permit.bound_worker_token_id=job.worker_token_id
       and permit.consumed_at is not null
       and permit.invalidated_at is null
       and permit.expires_at>statement_timestamp()
       and job.status='running'
       and job.claim_token=p_claim_token
       and job.provider_mutation_started_at is not null
       and permit.consumed_at>=job.provider_mutation_started_at
       and job.completed_at is null
       and job.response_payload is null
  );
end;
$$;

create or replace function sellerpilot_private.block_closed_listing_mutation_claim()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if old.status='queued' and new.status='running'
     and (
       old.operation in ('listing.create','listing.update','listing.stop','listing.activate')
       or new.operation in ('listing.create','listing.update','listing.stop','listing.activate')
     )
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       coalesce(new.channel,old.channel)
     )
     and not (
       sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_qoo10_localization_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_temu_server_owned_mutation_claim(
         to_jsonb(old),to_jsonb(new)
       )
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode='55000';
  end if;
  return new;
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_311440_begin_gateway_before_qoo10_localization_v2;
revoke all on function
  public.sellerpilot_311440_begin_gateway_before_qoo10_localization_v2(
    text,uuid,uuid
  ) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_exact boolean:=false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select job.channel='qoo10' and job.operation='listing.update'
      and job.request_payload#>>
            '{arguments,sellerpilotQoo10ExactLocalization,contract}'=
            'qoo10_exact_localization_update_v2'
    into v_exact
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id;
  if coalesce(v_exact,false) then
    if not sellerpilot_private.exact_qoo10_localization_update_provider_allowed(
      p_job_id,p_claim_token
    ) then return false; end if;
    v_started:=public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
      p_token_hash,p_job_id,p_claim_token
    );
    if coalesce(v_started,false)
       and not sellerpilot_private.consume_exact_qoo10_localization_update_provider(
         p_job_id,p_claim_token
       )
    then
      raise exception 'exact Qoo10 localization update permit consumption failed'
        using errcode='40001';
    end if;
    return coalesce(v_started,false);
  end if;
  return public.sellerpilot_311440_begin_gateway_before_qoo10_localization_v2(
    p_token_hash,p_job_id,p_claim_token
  );
end;
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_311440_begin_serverless_before_qoo10_localization_v2;
revoke all on function
  public.sellerpilot_311440_begin_serverless_before_qoo10_localization_v2(
    text,uuid,uuid
  ) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_exact boolean:=false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select job.channel='qoo10' and job.operation='listing.update'
      and job.request_payload#>>
            '{arguments,sellerpilotQoo10ExactLocalization,contract}'=
            'qoo10_exact_localization_update_v2'
    into v_exact
    from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id;
  if coalesce(v_exact,false) then
    if not sellerpilot_private.exact_qoo10_localization_update_provider_allowed(
      p_job_id,p_claim_token
    ) then return false; end if;
    v_started:=public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
      p_token_hash,p_job_id,p_claim_token
    );
    if coalesce(v_started,false)
       and not sellerpilot_private.consume_exact_qoo10_localization_update_provider(
         p_job_id,p_claim_token
       )
    then
      raise exception 'exact Qoo10 localization update permit consumption failed'
        using errcode='40001';
    end if;
    return coalesce(v_started,false);
  end if;
  return public.sellerpilot_311440_begin_serverless_before_qoo10_localization_v2(
    p_token_hash,p_job_id,p_claim_token
  );
end;
$$;

create function public.sellerpilot_service_enqueue_exact_qoo10_localization_verifier(
  p_listing_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing uuid;
  v_source_count integer;
  v_arguments jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_source_retirements retirement
        where retirement.source_job_id =
              'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
          and not retirement.provider_call_replayed
          and retirement.replacement_contract =
                'qoo10_exact_localization_update_v2'
     )
     or exists (
       select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits permit
        where permit.invalidated_at is null
     )
  then
    raise exception 'exact Qoo10 localization verifier preconditions are not met'
      using errcode = '55000';
  end if;

  select count(*) into v_source_count
    from sellerpilot_private.channel_gateway_jobs source
   where source.listing_id is not distinct from p_listing_id
     and source.channel is not distinct from 'qoo10'
     and source.operation is not distinct from 'listing.update'
     and source.environment is not distinct from 'production'
     and source.status is not distinct from 'reconciliation_required'
     and source.request_payload#>>
           '{arguments,sellerpilotQoo10ExactLocalization,contract}'
           is not distinct from
           'qoo10_exact_localization_update_v2'
     and source.request_payload#>>
           '{arguments,sellerpilotQoo10ExactLocalization,releaseSha}'
           is not distinct from
           p_release_sha
     and sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
           source.id,p_release_sha
         );
  if v_source_count <> 1 then
    raise exception 'one current exact Qoo10 localization update is required'
      using errcode = '55000';
  end if;
  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.listing_id is not distinct from p_listing_id
     and source.channel is not distinct from 'qoo10'
     and source.operation is not distinct from 'listing.update'
     and source.environment is not distinct from 'production'
     and source.status is not distinct from 'reconciliation_required'
     and source.request_payload#>>
           '{arguments,sellerpilotQoo10ExactLocalization,contract}'
           is not distinct from
           'qoo10_exact_localization_update_v2'
     and source.request_payload#>>
           '{arguments,sellerpilotQoo10ExactLocalization,releaseSha}'
           is not distinct from
           p_release_sha
     and sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
           source.id,p_release_sha
         );

  select run.verifier_job_id into v_existing
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = run.verifier_job_id
   where run.source_job_id = v_source.id
     and run.source_request_fingerprint = v_source.request_fingerprint
     and verifier.status in ('queued','running')
   order by run.queued_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'contract','qoo10_exact_localization_verifier_v2',
      'sourceJobId',v_source.id,
      'sourceRequestFingerprint',v_source.request_fingerprint,
      'verifierJobId',v_existing,
      'reused',true
    );
  end if;

  v_arguments := jsonb_build_object(
    'publicationReviewId',v_source.listing_id,
    'publicationReviewSourceJobId',v_source.id,
    'publicationReviewCheck',1,
    'sellerpilotReadOnly',true,
    'sellerpilotQoo10ExactS1Recovery','qoo10_exact_s1_verifier_v1',
    'remoteId','1217336970',
    'market','JP',
    'targetId','',
    'publicationIntent','live',
    'publicationStateContract','verified_remote_state_v1',
    'publicationExpectedLocale','ja-JP',
    'publicationExpectedFingerprint',
      v_source.request_payload#>>'{arguments,publicationExpectedFingerprint}',
    'publicationExpectedImageCount',8
  );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_exact_localization_verifier_enqueue',v_job_id::text,true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,
    created_by,created_at,updated_at
  ) values (
    v_job_id,v_source.credential_id,null,v_source.listing_id,
    'qoo10','listing.publication.verify','production',
    jsonb_build_object(
      'periodicKey','qoo10-exact-s1:' || v_source.id::text,
      'arguments',v_arguments
    ),
    'queued',v_source.seller_account_key,v_source.request_fingerprint,
    v_source.created_by,clock_timestamp(),clock_timestamp()
  );

  insert into sellerpilot_private.qoo10_exact_s1_verifier_runs (
    verifier_job_id,source_job_id,source_attempt_id,listing_id,product_id,
    credential_id,owner_id,remote_id,seller_account_key,
    source_request_sha256,source_request_bytes,source_response_sha256,
    source_response_bytes,source_request_fingerprint,release_sha,contract,queued_at
  ) values (
    v_job_id,v_source.id,v_source.attempt_id,v_source.listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,
    v_source.credential_id,'768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
    '1217336970',v_source.seller_account_key,
    encode(extensions.digest(v_source.request_payload::text,'sha256'),'hex'),
    octet_length(v_source.request_payload::text),
    encode(extensions.digest(v_source.response_payload::text,'sha256'),'hex'),
    octet_length(v_source.response_payload::text),v_source.request_fingerprint,
    p_release_sha,'qoo10_exact_s1_verifier_v1',clock_timestamp()
  );

  return jsonb_build_object(
    'contract','qoo10_exact_localization_verifier_v2',
    'sourceJobId',v_source.id,
    'sourceRequestFingerprint',v_source.request_fingerprint,
    'verifierJobId',v_job_id,
    'reused',false
  );
end;
$$;

alter function public.sellerpilot_service_listing_publication_verification_source(
  text,uuid,uuid
) rename to sellerpilot_144000_listing_publication_verification_source_before_qoo10_v2;
revoke all on function
  public.sellerpilot_144000_listing_publication_verification_source_before_qoo10_v2(
    text,uuid,uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_listing_publication_verification_source(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
begin
  if p_token_hash is null or p_job_id is null or p_claim_token is null
     or not sellerpilot_private.serverless_cs_job_is_owned(
       p_token_hash,p_job_id,p_claim_token,true
     )
  then
    raise exception 'publication verification source ownership required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'contract','listing_publication_verification_source_v1',
           'verificationJobId',verifier.id,
           'sourceJobId',source.id,
           'sourceOperation',source.operation,
           'sourceArguments',source.request_payload->'arguments',
           'sourceResponsePayload',source.response_payload,
           'sourceFingerprint',
             source.request_payload#>>'{arguments,publicationExpectedFingerprint}',
           'expectedRemoteId',run.remote_id,
           'expectedLocale','ja-JP',
           'expectedImageCount',8,
           'market','JP',
           'targetId',''
         ) into v_source
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = run.verifier_job_id
    join sellerpilot_private.channel_gateway_jobs source
      on source.id = run.source_job_id
   where run.verifier_job_id is not distinct from p_job_id
     and run.source_request_fingerprint is not null
     and verifier.status is not distinct from 'running'
     and verifier.claim_token is not distinct from p_claim_token
     and verifier.operation is not distinct from 'listing.publication.verify'
     and verifier.provider_mutation_started_at is null
     and verifier.request_payload#>>'{arguments,sellerpilotReadOnly}'
           is not distinct from 'true'
     and verifier.request_payload#>>
           '{arguments,sellerpilotQoo10ExactS1Recovery}'
           is not distinct from
           'qoo10_exact_s1_verifier_v1'
     and source.status is not distinct from 'reconciliation_required'
     and source.request_fingerprint is not distinct from
           run.source_request_fingerprint
     and octet_length(source.request_payload::text) is not distinct from
           run.source_request_bytes
     and encode(extensions.digest(source.request_payload::text,'sha256'),'hex')
           is not distinct from
           run.source_request_sha256
     and octet_length(source.response_payload::text) is not distinct from
           run.source_response_bytes
     and encode(extensions.digest(source.response_payload::text,'sha256'),'hex')
           is not distinct from
           run.source_response_sha256
     and sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
           source.id,run.release_sha
         );
  if v_source is not null then return v_source; end if;
  return public.sellerpilot_144000_listing_publication_verification_source_before_qoo10_v2(
    p_token_hash,p_job_id,p_claim_token
  );
end;
$$;

create function public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(
  p_verifier_job_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_attempt_id uuid := gen_random_uuid();
  v_observation sellerpilot_private.qoo10_exact_s1_observations%rowtype;
  v_run sellerpilot_private.qoo10_exact_s1_verifier_runs%rowtype;
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_arguments jsonb;
  v_marker jsonb;
  v_payload jsonb;
  v_request_sha text;
  v_resource_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if exists (
    select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits permit
     where permit.invalidated_at is null
  ) then
    raise exception 'exact Qoo10 S1 activation is already armed'
      using errcode = '55000';
  end if;

  select * into v_run
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id = p_verifier_job_id
     and run.source_request_fingerprint is not null;
  select * into v_observation
    from sellerpilot_private.qoo10_exact_s1_observations observation
   where observation.verifier_job_id = p_verifier_job_id;
  if v_run.verifier_job_id is null
     or v_observation.verifier_job_id is null
     or v_run.source_request_fingerprint !~ '^[a-f0-9]{64}$'
     or v_run.release_sha is distinct from p_release_sha
     or v_observation.release_sha is distinct from p_release_sha
     or v_observation.source_job_id is distinct from v_run.source_job_id
     or v_observation.verifier_completed_at + interval '2 minutes' <=
          clock_timestamp()
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
       v_run.source_job_id,p_release_sha
     )
     or exists (
       select 1 from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
        where outcome.verifier_job_id = p_verifier_job_id
           or outcome.source_job_id = v_run.source_job_id
     )
  then
    raise exception 'fresh exact Qoo10 localization S1 observation required'
      using errcode = '55000';
  end if;
  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = v_run.source_job_id
     and source.request_fingerprint = v_run.source_request_fingerprint;

  v_marker := v_observation.activation_expectation || jsonb_build_object(
    'status','allowed',
    'contract','qoo10_s1_activation_v1',
    'listingId',v_run.listing_id,
    'remoteId',v_run.remote_id,
    'providerStatus','S1',
    'sourceJobId',v_run.source_job_id,
    'sourceRequestFingerprint',v_run.source_request_fingerprint,
    'verifierJobId',v_run.verifier_job_id,
    'verifierResponseSha256',v_observation.verifier_response_sha256,
    'verifierCompletedAt',v_observation.verifier_completed_at
  );
  v_arguments := jsonb_set(
    v_source.request_payload->'arguments',
    '{sellerpilotQoo10S1Activation}',v_marker,true
  );
  v_payload := jsonb_build_object('arguments',v_arguments);
  v_request_sha := encode(extensions.digest(v_payload::text,'sha256'),'hex');
  v_resource_key := encode(extensions.digest(
    'qoo10-s1-activation:' || v_run.source_job_id::text || ':' ||
      v_run.source_request_fingerprint || ':' || v_run.verifier_job_id::text || ':' ||
      v_run.remote_id,
    'sha256'
  ),'hex');

  insert into sellerpilot_private.channel_operation_attempts (
    id,owner_id,credential_id,channel,operation,idempotency_key,
    request_fingerprint,status,started_at,seller_account_key,
    gateway_write_required,pre_gateway_retryable
  ) values (
    v_attempt_id,v_run.owner_id,v_run.credential_id,'qoo10','listing.activate',
    'qoo10-s1-activate-v2:' || v_run.source_job_id::text || ':' ||
      v_run.verifier_job_id::text,
    v_request_sha,'running',clock_timestamp(),v_run.seller_account_key,true,false
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_s1_activation_enqueue',v_job_id::text,true
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_s1_activation_source',v_run.source_job_id::text,true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,
    write_resource_kind,write_resource_key,created_by,created_at,updated_at
  ) values (
    v_job_id,v_run.credential_id,v_attempt_id,v_run.listing_id,'qoo10',
    'listing.activate','production',v_payload,'queued',v_run.seller_account_key,
    v_request_sha,'listing_mutation',v_resource_key,
    '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid,
    clock_timestamp(),clock_timestamp()
  );
  insert into sellerpilot_private.qoo10_exact_s1_activation_permits (
    activation_job_id,activation_attempt_id,verifier_job_id,source_job_id,
    listing_id,credential_id,owner_id,remote_id,seller_account_key,release_sha,
    activation_request_sha256,activation_request_bytes,write_resource_key,
    contract,armed_at,expires_at
  ) values (
    v_job_id,v_attempt_id,v_run.verifier_job_id,v_run.source_job_id,
    v_run.listing_id,v_run.credential_id,v_run.owner_id,v_run.remote_id,
    v_run.seller_account_key,p_release_sha,v_request_sha,
    octet_length(v_payload::text),v_resource_key,
    'qoo10_exact_s1_activation_permit_v1',clock_timestamp(),
    v_observation.verifier_completed_at + interval '2 minutes'
  );

  return jsonb_build_object(
    'contract','qoo10_exact_localization_activation_v2',
    'sourceJobId',v_run.source_job_id,
    'sourceRequestFingerprint',v_run.source_request_fingerprint,
    'verifierJobId',v_run.verifier_job_id,
    'activationJobId',v_job_id,
    'activationAttemptId',v_attempt_id,
    'expiresAt',v_observation.verifier_completed_at + interval '2 minutes'
  );
end;
$$;

create or replace function sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_job_id uuid;
  v_expected_source_job_id uuid;
  v_source_request_fingerprint text;
  v_source_release_sha text;
begin
  if tg_op = 'INSERT' then
    if new.operation is distinct from 'listing.activate'
       or new.channel is distinct from 'qoo10'
    then return new; end if;
    begin
      v_source_job_id := (
        new.request_payload#>>
          '{arguments,sellerpilotQoo10S1Activation,sourceJobId}'
      )::uuid;
      v_expected_source_job_id := coalesce(
        nullif(current_setting(
          'sellerpilot.qoo10_s1_activation_source',true
        ),'')::uuid,
        'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
      );
    exception when others then
      raise exception 'exact Qoo10 S1 activation source binding invalid'
        using errcode = '55000';
    end;
    v_source_request_fingerprint := new.request_payload#>>
      '{arguments,sellerpilotQoo10S1Activation,sourceRequestFingerprint}';
    if v_source_job_id is distinct from
         'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    then
      select source.request_payload#>>
               '{arguments,sellerpilotQoo10ExactLocalization,releaseSha}'
        into v_source_release_sha
        from sellerpilot_private.channel_gateway_jobs source
       where source.id = v_source_job_id;
    end if;

    if current_setting('sellerpilot.qoo10_s1_activation_enqueue',true) is distinct from
         new.id::text
       or new.channel is distinct from 'qoo10'
       or new.environment is distinct from 'production'
       or new.status is distinct from 'queued'
       or new.credential_id is distinct from
            '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       or new.listing_id is distinct from
            '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       or new.seller_account_key is distinct from
            '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       or new.write_resource_kind is distinct from 'listing_mutation'
       or new.write_resource_key is null
       or new.request_fingerprint is distinct from
            encode(extensions.digest(new.request_payload::text,'sha256'),'hex')
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'
            is distinct from
            'allowed'
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'
            is distinct from
            'qoo10_s1_activation_v1'
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'
            is distinct from
            new.listing_id::text
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'
            is distinct from
            '1217336970'
       or v_source_job_id is distinct from v_expected_source_job_id
       or new.request_payload#>>'{arguments,params,ItemCode}'
            is distinct from '1217336970'
       or (
         v_source_job_id is not distinct from
           'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and v_source_request_fingerprint is not null
       )
       or (
         v_source_job_id is distinct from
           'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and (
           v_source_request_fingerprint is null
           or
           v_source_request_fingerprint !~ '^[a-f0-9]{64}$'
           or not exists (
             select 1
               from sellerpilot_private.channel_gateway_jobs source
              where source.id is not distinct from v_source_job_id
                and source.request_fingerprint is not distinct from
                      v_source_request_fingerprint
                and source.request_payload#>>
                      '{arguments,sellerpilotQoo10ExactLocalization,contract}'
                      is not distinct from
                      'qoo10_exact_localization_update_v2'
                and v_source_release_sha is not null
                and sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
                      source.id,v_source_release_sha
                    )
           )
         )
       )
       or not exists (
         select 1
           from sellerpilot_private.channel_operation_attempts attempt
           join sellerpilot_private.channel_credentials credential
             on credential.id = attempt.credential_id
           join sellerpilot_private.product_listings listing
             on listing.id = new.listing_id
          where attempt.id = new.attempt_id
            and attempt.owner_id is not distinct from
                  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
            and attempt.credential_id is not distinct from new.credential_id
            and attempt.channel is not distinct from 'qoo10'
            and attempt.operation is not distinct from 'listing.activate'
            and attempt.status is not distinct from 'running'
            and attempt.seller_account_key is not distinct from
                  new.seller_account_key
            and credential.channel is not distinct from 'qoo10'
            and credential.environment is not distinct from 'production'
            and credential.status is not distinct from 'active'
            and credential.seller_account_key is not distinct from
                  new.seller_account_key
            and credential.seller_account_key_source in (
              'provider_certified_v1','credential_incarnation_v1'
            )
            and listing.remote_id is not distinct from '1217336970'
            and listing.seller_account_key is not distinct from
                  new.seller_account_key
       )
    then
      raise exception 'exact Qoo10 S1 activation enqueue lineage invalid'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if (old.operation is distinct from 'listing.activate'
      or old.channel is distinct from 'qoo10')
     and (new.operation is distinct from 'listing.activate'
      or new.channel is distinct from 'qoo10') then
    return new;
  end if;
  if old.operation is distinct from 'listing.activate'
     or new.operation is distinct from 'listing.activate'
     or old.channel is distinct from 'qoo10'
     or new.channel is distinct from 'qoo10'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_activation_permits permit
        where permit.activation_job_id is not distinct from new.id
          and new.credential_id is not distinct from permit.credential_id
          and new.attempt_id is not distinct from permit.activation_attempt_id
          and new.listing_id is not distinct from permit.listing_id
          and new.channel is not distinct from 'qoo10'
          and new.environment is not distinct from 'production'
          and new.seller_account_key is not distinct from
                permit.seller_account_key
          and new.request_fingerprint is not distinct from
                permit.activation_request_sha256
          and octet_length(new.request_payload::text) is not distinct from
                permit.activation_request_bytes
          and encode(extensions.digest(
                new.request_payload::text,'sha256'
              ),'hex') is not distinct from permit.activation_request_sha256
          and new.write_resource_kind is not distinct from 'listing_mutation'
          and new.write_resource_key is not distinct from
                permit.write_resource_key
          and new.request_payload#>>
                '{arguments,sellerpilotQoo10S1Activation,sourceJobId}'
                is not distinct from
                permit.source_job_id::text
          and (
            new.request_payload#>>
              '{arguments,sellerpilotQoo10S1Activation,sourceRequestFingerprint}'
          ) is not distinct from (
            select run.source_request_fingerprint
              from sellerpilot_private.qoo10_exact_s1_verifier_runs run
             where run.verifier_job_id = permit.verifier_job_id
          )
     )
  then
    raise exception 'exact Qoo10 S1 activation job lineage is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(
  p_source_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
      select 1
        from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
        join sellerpilot_private.channel_gateway_jobs activation
          on activation.id = outcome.activation_job_id
        join sellerpilot_private.channel_gateway_jobs source
          on source.id = outcome.source_job_id
       where (
         outcome.source_job_id is not distinct from p_source_job_id
         or (
           p_source_job_id is not distinct from
             'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
           and outcome.source_job_id is distinct from
                 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
           and exists (
             select 1
               from sellerpilot_private.qoo10_exact_localization_source_retirements retirement
              where retirement.source_job_id is not distinct from p_source_job_id
                and retirement.replacement_contract is not distinct from
                      'qoo10_exact_localization_update_v2'
                and not retirement.provider_call_replayed
           )
         )
       )
         and outcome.terminal_status is not distinct from 'succeeded'
         and outcome.provider_status is not distinct from 'S2'
         and outcome.remote_visibility is not distinct from 'live'
         and activation.status is not distinct from 'succeeded'
         and activation.operation is not distinct from 'listing.activate'
         and source.status is not distinct from 'reconciliation_required'
         and (
           source.id is not distinct from
             'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
           or source.request_payload#>>
                '{arguments,sellerpilotQoo10ExactLocalization,contract}'
                is not distinct from
                'qoo10_exact_localization_update_v2'
         )
         and encode(extensions.digest(
               activation.response_payload::text,'sha256'
             ),'hex') = outcome.activation_response_sha256
    ),false)
$$;

create function public.sellerpilot_service_get_exact_qoo10_localization_release_status(
  p_product_id uuid,
  p_listing_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_verifier record;
  v_permit record;
  v_outcome record;
begin
  if p_product_id is distinct from
       'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
     or p_listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
  then
    raise exception 'exact Qoo10 localization status identity invalid'
      using errcode = '55000';
  end if;

  select job.id,job.status,job.request_fingerprint,job.created_at,job.completed_at
    into v_source
    from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = p_listing_id
     and job.channel = 'qoo10'
     and job.operation = 'listing.update'
     and job.request_payload#>>
           '{arguments,sellerpilotQoo10ExactLocalization,contract}' =
           'qoo10_exact_localization_update_v2'
   order by job.created_at desc
   limit 1;
  if v_source.id is not null then
    select run.verifier_job_id,job.status,run.release_sha,job.completed_at
      into v_verifier
      from sellerpilot_private.qoo10_exact_s1_verifier_runs run
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = run.verifier_job_id
     where run.source_job_id = v_source.id
       and run.source_request_fingerprint = v_source.request_fingerprint
     order by run.queued_at desc
     limit 1;
  end if;
  if v_verifier.verifier_job_id is not null then
    select permit.activation_job_id,job.status,permit.armed_at,permit.expires_at,
           permit.bound_at,permit.consumed_at,permit.invalidated_at
      into v_permit
      from sellerpilot_private.qoo10_exact_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
     where permit.verifier_job_id = v_verifier.verifier_job_id;
  end if;
  if v_permit.activation_job_id is not null then
    select outcome.terminal_status,outcome.provider_status,
           outcome.remote_visibility,outcome.verified_at,outcome.completed_at
      into v_outcome
      from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
     where outcome.activation_job_id = v_permit.activation_job_id;
  end if;

  return jsonb_build_object(
    'contract','qoo10_exact_localization_release_status_v2',
    'productId',p_product_id,
    'listingId',p_listing_id,
    'remoteId','1217336970',
    'releaseSha',p_release_sha,
    'releaseCurrent',
      sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha),
    'historicalSourceRetired',exists(
      select 1
        from sellerpilot_private.qoo10_exact_localization_source_retirements retirement
       where retirement.source_job_id =
             'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and not retirement.provider_call_replayed
    ),
    'source',case when v_source.id is null then null else jsonb_build_object(
      'jobId',v_source.id,'status',v_source.status,
      'requestFingerprint',v_source.request_fingerprint,
      'createdAt',v_source.created_at,'completedAt',v_source.completed_at
    ) end,
    'verifier',case when v_verifier.verifier_job_id is null then null else
      jsonb_build_object(
        'jobId',v_verifier.verifier_job_id,'status',v_verifier.status,
        'releaseSha',v_verifier.release_sha,'completedAt',v_verifier.completed_at
      ) end,
    'activation',case when v_permit.activation_job_id is null then null else
      jsonb_build_object(
        'jobId',v_permit.activation_job_id,'status',v_permit.status,
        'armedAt',v_permit.armed_at,'expiresAt',v_permit.expires_at,
        'boundAt',v_permit.bound_at,'consumedAt',v_permit.consumed_at,
        'invalidatedAt',v_permit.invalidated_at
      ) end,
    'outcome',case when v_outcome.terminal_status is null then null else
      jsonb_build_object(
        'terminalStatus',v_outcome.terminal_status,
        'providerStatus',v_outcome.provider_status,
        'remoteVisibility',v_outcome.remote_visibility,
        'verifiedAt',v_outcome.verified_at,'completedAt',v_outcome.completed_at
      ) end
  );
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(jsonb,text),
  sellerpilot_private.qoo10_exact_localization_v2_source_is_current(uuid,text),
  sellerpilot_private.qoo10_exact_s1_legacy_source_is_current(),
  sellerpilot_private.qoo10_exact_s1_source_is_current(),
  sellerpilot_private.qoo10_exact_s1_verifier_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ),
  sellerpilot_private.guard_qoo10_exact_s1_verifier_overlap(),
  sellerpilot_private.guard_qoo10_exact_localization_update_job(),
  sellerpilot_private.bind_exact_qoo10_localization_update_claim(jsonb,jsonb),
  sellerpilot_private.exact_qoo10_localization_update_provider_allowed(uuid,uuid),
  sellerpilot_private.consume_exact_qoo10_localization_update_provider(uuid,uuid),
  sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage(),
  sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_arm_exact_qoo10_localization_update(uuid,uuid,text,text),
  public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_enqueue_exact_qoo10_localization_verifier(uuid,text),
  public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(uuid,text),
  public.sellerpilot_service_get_exact_qoo10_localization_release_status(uuid,uuid,text),
  public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_arm_exact_qoo10_localization_update(uuid,uuid,text,text),
  public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_enqueue_exact_qoo10_localization_verifier(uuid,text),
  public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(uuid,text),
  public.sellerpilot_service_get_exact_qoo10_localization_release_status(uuid,uuid,text),
  public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)
  to service_role;

do $qoo10_localization_v2_postimage$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_localization_source_retirements'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.qoo10_exact_localization_update_permits'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(jsonb,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_arm_exact_qoo10_localization_update(uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_qoo10_localization_verifier(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_exact_qoo10_localization_release_status(uuid,uuid,text)'
     ) is null
     or not exists (
       select 1
         from information_schema.columns column_row
        where column_row.table_schema = 'sellerpilot_private'
          and column_row.table_name = 'qoo10_exact_s1_verifier_runs'
          and column_row.column_name = 'source_request_fingerprint'
          and column_row.data_type = 'text'
          and column_row.is_nullable = 'YES'
     )
     or exists (
       select 1
         from (values
           ('public'::name),('anon'::name),('authenticated'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(uuid,text)',
          'EXECUTE'
        )
     )
     or exists (
       select 1
         from (values
           ('public'::name),('anon'::name),('authenticated'::name),
           ('service_role'::name)
         ) role(role_name)
        where pg_catalog.has_function_privilege(
          role.role_name,
          'sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(jsonb,text)',
          'EXECUTE'
        )
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.sellerpilot_service_arm_exact_qoo10_localization_update(uuid,uuid,text,text)',
       'EXECUTE'
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure
         join pg_catalog.pg_namespace namespace
           on namespace.oid=procedure.pronamespace
        where namespace.nspname='public'
          and procedure.proname in (
            'sellerpilot_service_arm_exact_qoo10_localization_update',
            'sellerpilot_service_enqueue_exact_qoo10_localization_verifier',
            'sellerpilot_service_enqueue_exact_qoo10_localization_activation',
            'sellerpilot_service_get_exact_qoo10_localization_release_status'
          )
          and (
            not procedure.prosecdef
            or pg_catalog.pg_get_userbyid(procedure.proowner)
                 is distinct from current_user
          )
     )
  then
    raise exception 'exact Qoo10 localization v2 postimage invalid'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from sellerpilot_private.qoo10_exact_localization_source_retirements
     where provider_call_replayed
  ) or exists (
    select 1 from sellerpilot_private.qoo10_exact_s1_verifier_runs run
     where run.source_request_fingerprint is not null
  ) or exists (
    select 1
      from sellerpilot_private.qoo10_exact_localization_update_permits
  )
  then
    -- Applying this migration may retire fac9, but it must never synthesize a
    -- replacement write, verifier, permit or activation job.
    raise exception 'exact Qoo10 localization v2 migration synthesized work'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs source
     where source.id='fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
  ) and sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(
    'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
  ) then
    raise exception 'fac9 reconciliation was discounted before replacement S2'
      using errcode='55000';
  end if;
end;
$qoo10_localization_v2_postimage$;

comment on table
  sellerpilot_private.qoo10_exact_localization_source_retirements is
  'Immutable replacement intent for fac9 without replaying its provider calls; fac9 is discounted only after the replacement v2 source reaches an exact S2/live outcome.';
comment on function
  public.sellerpilot_service_enqueue_exact_qoo10_localization_activation(uuid,text) is
  'Creates one activation permit only from a fresh exact S1 observation bound to the new localization source job and its immutable request fingerprint.';

commit;
