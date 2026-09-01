-- The exact fac9 localization call has no durable prewrite readback, while an
-- independent CHANGHEE seller-center inspection proves a partial remote effect.
-- The single manual activation happened after that S1 observation but before
-- this migration could be installed. Retire the uncertain source without a
-- provider replay and atomically bind both the historical S1 evidence and the
-- later seller-center/public S2 evidence. The two phase functions remain
-- private implementation details so production cannot be left at S1 merely
-- because the second operator call was delayed or failed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993,901085000);

do $qoo10_partial_manual_history_fence$
declare
  v_history_table regclass;
begin
  v_history_table := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if exists (
      select 1 from supabase_migrations.schema_migrations migration
       where migration.version='20260901085000'
         and migration.name is distinct from
               'reconcile_qoo10_partial_manual_activation'
    ) then
      raise exception 'exact Qoo10 partial manual migration history drifted'
        using errcode='55000';
    end if;
  end if;
end;
$qoo10_partial_manual_history_fence$;

lock table sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.channel_operation_attempts,
  sellerpilot_private.product_listings
  in share row exclusive mode;

create function sellerpilot_private.qoo10_exact_partial_manual_observation_valid(
  p_observation jsonb
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(
    jsonb_typeof(p_observation)='object'
    and p_observation ?& array[
      'contract','profileName','remoteId','sellerSku','title','promotionName',
      'providerStatus','sellerStopped','purchaseAvailable','currency','priceJpy',
      'quantity','shippingNo','representativeImageCount','additionalImageCount',
      'detailImageCount','detailLocale','detailJapanese','observedAt'
    ]
    and p_observation-array[
      'contract','profileName','remoteId','sellerSku','title','promotionName',
      'providerStatus','sellerStopped','purchaseAvailable','currency','priceJpy',
      'quantity','shippingNo','representativeImageCount','additionalImageCount',
      'detailImageCount','detailLocale','detailJapanese','observedAt'
    ]='{}'::jsonb
    and p_observation->>'contract'=
          'qoo10_seller_center_partial_readback_v1'
    and p_observation->>'profileName'='CHANGHEE'
    and p_observation->>'remoteId'='1217336970'
    and p_observation->>'sellerSku'='QA-20260823-CC-001'
    and p_observation->>'title'='貼り付け式ケーブル整理クリップ6個セット'
    and p_observation->>'promotionName'='購入前確認'
    and p_observation->>'providerStatus'='S1'
    and p_observation->'sellerStopped'='true'::jsonb
    and p_observation->'purchaseAvailable'='false'::jsonb
    and p_observation->>'currency'='JPY'
    and p_observation->'priceJpy'=to_jsonb(1871)
    and p_observation->'quantity'=to_jsonb(1)
    and p_observation->>'shippingNo'='806971'
    and p_observation->'representativeImageCount'=to_jsonb(1)
    and p_observation->'additionalImageCount'=to_jsonb(0)
    and p_observation->'detailImageCount'=to_jsonb(8)
    and p_observation->>'detailLocale'='ja-JP'
    and p_observation->'detailJapanese'='true'::jsonb
    and p_observation->>'observedAt' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
    false
  )
$$;

create function sellerpilot_private.qoo10_exact_manual_activation_observation_valid(
  p_observation jsonb
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(
    jsonb_typeof(p_observation)='object'
    and p_observation ?& array[
      'contract','profileName','remoteId','sellerSku','title','promotionName',
      'providerStatus','sellerStatus','purchaseAvailable','currency','priceJpy',
      'quantity','shippingNo','representativeImageCount','additionalImageCount',
      'detailImageCount','detailLocale','detailJapanese','sellerCenterObserved',
      'publicPageObserved','publicUrl','manualActivationCount',
      'manualActivationConfirmedAt','observedAt'
    ]
    and p_observation-array[
      'contract','profileName','remoteId','sellerSku','title','promotionName',
      'providerStatus','sellerStatus','purchaseAvailable','currency','priceJpy',
      'quantity','shippingNo','representativeImageCount','additionalImageCount',
      'detailImageCount','detailLocale','detailJapanese','sellerCenterObserved',
      'publicPageObserved','publicUrl','manualActivationCount',
      'manualActivationConfirmedAt','observedAt'
    ]='{}'::jsonb
    and p_observation->>'contract'=
          'qoo10_seller_center_manual_activation_readback_v1'
    and p_observation->>'profileName'='CHANGHEE'
    and p_observation->>'remoteId'='1217336970'
    and p_observation->>'sellerSku'='QA-20260823-CC-001'
    and p_observation->>'title'='貼り付け式ケーブル整理クリップ6個セット'
    and p_observation->>'promotionName'='購入前確認'
    and p_observation->>'providerStatus'='S2'
    and p_observation->>'sellerStatus'='selling'
    and p_observation->'purchaseAvailable'='true'::jsonb
    and p_observation->>'currency'='JPY'
    and p_observation->'priceJpy'=to_jsonb(1871)
    and p_observation->'quantity'=to_jsonb(1)
    and p_observation->>'shippingNo'='806971'
    and p_observation->'representativeImageCount'=to_jsonb(1)
    and p_observation->'additionalImageCount'=to_jsonb(0)
    and p_observation->'detailImageCount'=to_jsonb(8)
    and p_observation->>'detailLocale'='ja-JP'
    and p_observation->'detailJapanese'='true'::jsonb
    and p_observation->'sellerCenterObserved'='true'::jsonb
    and p_observation->'publicPageObserved'='true'::jsonb
    and p_observation->>'publicUrl'='https://www.qoo10.jp/g/1217336970'
    and p_observation->'manualActivationCount'=to_jsonb(1)
    and p_observation->>'manualActivationConfirmedAt' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$'
    and p_observation->>'observedAt' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
    false
  )
$$;

create table sellerpilot_private.qoo10_exact_partial_manual_reconciliations (
  source_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  remote_id text not null,
  seller_account_key text not null,
  source_request_sha256 text not null,
  source_request_bytes integer not null,
  source_response_sha256 text not null,
  source_response_bytes integer not null,
  partial_observation jsonb not null,
  partial_observation_sha256 text not null,
  later_jobs jsonb not null,
  later_jobs_sha256 text not null,
  partial_observed_at timestamptz not null,
  resolution text not null,
  provider_call_replayed boolean not null,
  manual_activation_count_allowed integer not null,
  reconciled_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_partial_manual_target_check check (
    source_job_id='fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and source_attempt_id='4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
    and listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id='ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id='1217336970'
    and seller_account_key=
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and source_request_sha256=
      'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
    and source_request_bytes=23555
    and source_response_sha256=
      'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
    and source_response_bytes=16669
    and sellerpilot_private.qoo10_exact_partial_manual_observation_valid(
          partial_observation
        )
    and partial_observation_sha256=
          encode(extensions.digest(partial_observation::text,'sha256'),'hex')
    and partial_observed_at=(partial_observation->>'observedAt')::timestamptz
    and jsonb_typeof(later_jobs)='array'
    and jsonb_array_length(later_jobs)=3
    and later_jobs_sha256=
          encode(extensions.digest(later_jobs::text,'sha256'),'hex')
    and resolution='partial_remote_effect_manual_activation_required'
    and not provider_call_replayed
    and manual_activation_count_allowed=1
  )
);

create table sellerpilot_private.qoo10_exact_manual_activation_outcomes (
  source_job_id uuid primary key
    references sellerpilot_private.qoo10_exact_partial_manual_reconciliations(
      source_job_id
    ) on delete restrict,
  source_attempt_id uuid not null unique,
  listing_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  owner_id uuid not null,
  remote_id text not null,
  final_observation jsonb not null,
  final_observation_sha256 text not null,
  manual_activation_confirmed_at timestamptz not null,
  final_observed_at timestamptz not null,
  provider_status text not null,
  remote_visibility text not null,
  purchase_available boolean not null,
  manual_activation_count integer not null,
  provider_call_replayed boolean not null,
  finalized_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_manual_activation_outcome_target_check check (
    source_job_id='fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and source_attempt_id='4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
    and listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id='ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id='1217336970'
    and sellerpilot_private.qoo10_exact_manual_activation_observation_valid(
          final_observation
        )
    and final_observation_sha256=
          encode(extensions.digest(final_observation::text,'sha256'),'hex')
    and manual_activation_confirmed_at=
          (final_observation->>'manualActivationConfirmedAt')::timestamptz
    and final_observed_at=(final_observation->>'observedAt')::timestamptz
    and final_observed_at>=manual_activation_confirmed_at
    and provider_status='S2'
    and remote_visibility='live'
    and purchase_available
    and manual_activation_count=1
    and not provider_call_replayed
  )
);

alter table sellerpilot_private.qoo10_exact_partial_manual_reconciliations
  enable row level security;
alter table sellerpilot_private.qoo10_exact_manual_activation_outcomes
  enable row level security;
revoke all on
  sellerpilot_private.qoo10_exact_partial_manual_reconciliations,
  sellerpilot_private.qoo10_exact_manual_activation_outcomes
  from public,anon,authenticated,service_role;

create trigger block_qoo10_exact_partial_manual_reconciliation_change
before update or delete
on sellerpilot_private.qoo10_exact_partial_manual_reconciliations
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();
create trigger block_qoo10_exact_manual_activation_outcome_change
before update or delete
on sellerpilot_private.qoo10_exact_manual_activation_outcomes
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();

create function sellerpilot_private.qoo10_exact_partial_manual_later_jobs(
  p_source_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',job.id,
    'operation',job.operation,
    'status',job.status,
    'attemptCount',job.attempt_count,
    'providerMutationStarted',job.provider_mutation_started_at is not null,
    'completed',job.completed_at is not null
  ) order by job.created_at,job.id),'[]'::jsonb)
    from sellerpilot_private.channel_gateway_jobs source
    join sellerpilot_private.channel_gateway_jobs job
      on job.listing_id=source.listing_id
     and job.created_at>source.created_at
   where source.id=p_source_job_id
     and job.operation in (
       'listing.create','listing.update','listing.stop','listing.activate',
       'price.update','inventory.update'
     )
$$;

create function sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(
  p_source_job_id uuid,
  p_later_jobs jsonb
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    p_source_job_id='fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and p_later_jobs is not distinct from
          sellerpilot_private.qoo10_exact_partial_manual_later_jobs(
            p_source_job_id
          )
    and jsonb_array_length(p_later_jobs)=3
    and (select count(*) from jsonb_array_elements(p_later_jobs) job
          where job->>'operation'='listing.activate'
            and job->>'status'='failed'
            and job->'providerMutationStarted'='false'::jsonb
            and job->'completed'='true'::jsonb)=3
    and (select count(*) from jsonb_array_elements(p_later_jobs) job
          where job->'attemptCount'=to_jsonb(0))=2
    and (select count(*) from jsonb_array_elements(p_later_jobs) job
          where job->'attemptCount'=to_jsonb(1))=1,
    false
  )
$$;

create function sellerpilot_private.qoo10_partial_manual_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_marker text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_phase text:=pg_catalog.split_part(coalesce(p_marker,''),':',1);
  v_source_id text:=pg_catalog.split_part(coalesce(p_marker,''),':',2);
  v_partial sellerpilot_private.qoo10_exact_partial_manual_reconciliations%rowtype;
  v_outcome sellerpilot_private.qoo10_exact_manual_activation_outcomes%rowtype;
  v_expected jsonb;
  v_resources jsonb;
begin
  if v_source_id is distinct from 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'
     or p_old->>'id' is distinct from '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
     or p_old->>'owner_id' is distinct from '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'
     or p_old->>'product_id' is distinct from 'ddccde35-9c58-4856-b673-d7aa27ce4220'
     or p_old->>'channel_key' is distinct from 'qoo10'
     or p_old->>'market' is distinct from 'JP'
     or p_old->>'target_id' is distinct from ''
     or p_old->>'remote_id' is distinct from '1217336970'
     or p_old->>'requested_publication_intent' is distinct from 'live'
     or p_old->>'operation_attempt_id' is distinct from
          '4402cc76-295b-4e17-8c07-d5d0e9967ce9'
     or p_old->>'seller_account_key' is distinct from
          '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
  then return false; end if;

  select * into v_partial
    from sellerpilot_private.qoo10_exact_partial_manual_reconciliations evidence
   where evidence.source_job_id=v_source_id::uuid;
  if not found then return false; end if;

  if v_phase='partial' then
    if p_old->>'status' is distinct from 'failed'
       or p_old->>'failure_class' is distinct from 'external_action'
       or p_old->>'remote_visibility' is distinct from 'unknown'
    then return false; end if;
    v_expected:=p_old||jsonb_build_object(
      'remote_visibility','non_public',
      'provider_status','S1',
      'last_verified_at',to_jsonb(v_partial.partial_observed_at),
      'last_error',
        'Qoo10 부분 반영 확인 · 판매자센터 수동 판매재개 및 최종 공개 검증 필요',
      'updated_at',p_new->'updated_at'
    );
    return p_new=v_expected;
  end if;

  if v_phase is distinct from 'final'
     or p_old->>'status' is distinct from 'failed'
     or p_old->>'failure_class' is distinct from 'external_action'
     or p_old->>'remote_visibility' is distinct from 'non_public'
     or p_old->>'provider_status' is distinct from 'S1'
  then return false; end if;
  select * into v_outcome
    from sellerpilot_private.qoo10_exact_manual_activation_outcomes outcome
   where outcome.source_job_id=v_partial.source_job_id;
  if not found then return false; end if;
  v_resources:=jsonb_build_object(
    'resources',jsonb_build_object('itemCode','1217336970'),
    'verification',jsonb_build_object(
      'contract','qoo10_seller_center_manual_activation_readback_v1',
      'verifiedAt',to_jsonb(v_outcome.final_observed_at),
      'evidenceSha256',v_outcome.final_observation_sha256,
      'locale','ja-JP','imageCount',8,
      'purchaseAvailable',true,'manualActivationCount',1
    )
  );
  v_expected:=p_old||jsonb_build_object(
    'status','published','remote_visibility','live','provider_status','S2',
    'remote_resources',v_resources,
    'published_at',to_jsonb(v_outcome.manual_activation_confirmed_at),
    'last_verified_at',to_jsonb(v_outcome.final_observed_at),
    'last_error','null'::jsonb,'failure_class','null'::jsonb,
    'updated_at',p_new->'updated_at'
  );
  return p_new=v_expected;
exception when others then
  return false;
end;
$$;

do $qoo10_partial_manual_listing_guard_patch$
declare
  v_definition text;
  v_before text:='begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
  v_after text:='begin
  if nullif(current_setting(''sellerpilot.qoo10_partial_manual_apply'', true), '''') is not null then
    if not sellerpilot_private.qoo10_partial_manual_listing_update_allowed(
      to_jsonb(old),to_jsonb(new),
      current_setting(''sellerpilot.qoo10_partial_manual_apply'', true)
    ) then
      raise exception ''invalid exact Qoo10 partial/manual listing projection'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.qoo10_partial_manual_apply')=0 then
    if pg_catalog.strpos(v_definition,v_before)=0 then
      raise exception 'exact Qoo10 partial/manual listing guard preimage drifted'
        using errcode='55000';
    end if;
    execute pg_catalog.replace(v_definition,v_before,v_after);
  end if;
end;
$qoo10_partial_manual_listing_guard_patch$;

create or replace function sellerpilot_private.guard_qoo10_exact_localization_update_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_marker jsonb:=new.request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
begin
  if tg_op='UPDATE'
     and old.status='reconciliation_required'
     and new.status='failed'
     and current_setting(
           'sellerpilot.qoo10_partial_manual_reconcile_source',true
         ) is not distinct from old.id::text
     and to_jsonb(new)-array['status','error_message','updated_at']
           is not distinct from
         to_jsonb(old)-array['status','error_message','updated_at']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_partial_manual_reconciliations evidence
        where evidence.source_job_id=old.id
          and evidence.source_attempt_id=old.attempt_id
          and evidence.listing_id=old.listing_id
          and evidence.credential_id=old.credential_id
          and evidence.remote_id='1217336970'
          and evidence.resolution=
                'partial_remote_effect_manual_activation_required'
          and not evidence.provider_call_replayed
     )
  then return new; end if;
  if tg_op='UPDATE'
     and old.status='reconciliation_required'
     and new.status='failed'
     and current_setting(
           'sellerpilot.qoo10_no_effect_reconcile_source',true
         ) is not distinct from old.id::text
     and to_jsonb(new)-array['status','error_message','updated_at']
           is not distinct from
         to_jsonb(old)-array['status','error_message','updated_at']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
        where evidence.source_job_id=old.id
          and evidence.source_attempt_id=old.attempt_id
          and evidence.listing_id=old.listing_id
          and evidence.credential_id=old.credential_id
          and evidence.remote_id='1217336970'
          and evidence.resolution='no_remote_effect'
          and not evidence.provider_call_replayed
     )
  then return new; end if;
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

create function public.sellerpilot_service_reconcile_exact_qoo10_partial_manual(
  p_source_job_id uuid,
  p_release_sha text,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_existing sellerpilot_private.qoo10_exact_partial_manual_reconciliations%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_later_jobs jsonb;
  v_observed_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,901085000);
  if p_source_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_exact_partial_manual_observation_valid(
          p_observation
        )
  then
    raise exception 'exact Qoo10 partial manual identity invalid'
      using errcode='55000';
  end if;
  begin
    v_observed_at:=(p_observation->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'exact Qoo10 partial observation timestamp invalid'
      using errcode='55000';
  end;

  select * into v_existing
    from sellerpilot_private.qoo10_exact_partial_manual_reconciliations evidence
   where evidence.source_job_id=p_source_job_id;
  if found then
    if v_existing.partial_observation is distinct from p_observation
       or v_existing.resolution is distinct from
            'partial_remote_effect_manual_activation_required'
       or not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs source
          where source.id=p_source_job_id and source.status='failed'
       )
       or not exists (
         select 1 from sellerpilot_private.product_listings listing
          where listing.id=v_existing.listing_id
            and listing.status='failed'
            and listing.failure_class='external_action'
            and listing.remote_visibility='non_public'
            and listing.provider_status='S1'
       )
    then
      raise exception 'exact Qoo10 partial manual replay conflict'
        using errcode='55000';
    end if;
    return jsonb_build_object(
      'contract','qoo10_partial_remote_effect_manual_reconciliation_v1',
      'sourceJobId',p_source_job_id,'sourceStatus','failed',
      'resolution',v_existing.resolution,'providerStatus','S1',
      'remoteVisibility','non_public','providerCallReplayed',false,
      'manualActivationReady',true,'manualActivationCountAllowed',1,
      'reused',true
    );
  end if;

  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id=p_source_job_id for update;
  select * into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id=v_source.attempt_id for update;
  select * into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id=v_source.listing_id for update;
  v_later_jobs:=sellerpilot_private.qoo10_exact_partial_manual_later_jobs(
    v_source.id
  );

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
     or v_source.attempt_count<>1
     or v_source.provider_mutation_started_at is null
     or v_source.completed_at is null
     or octet_length(v_source.request_payload::text)<>23555
     or encode(extensions.digest(v_source.request_payload::text,'sha256'),'hex')<>
          'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
     or octet_length(v_source.response_payload::text)<>16669
     or encode(extensions.digest(v_source.response_payload::text,'sha256'),'hex')<>
          'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
     or jsonb_array_length(v_source.response_payload->'steps')<>3
     or sellerpilot_private.qoo10_exact_no_effect_snapshot(
          v_source.response_payload#>'{steps,0,data,ResultObject}'
        ) is not null
     or not sellerpilot_private.qoo10_exact_no_effect_source_arguments_valid(
          v_source.id,v_source.request_payload->'arguments',p_release_sha
        )
     or (select count(*) from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id=v_source.id)<>1
     or exists (
       select 1 from sellerpilot_private.qoo10_exact_no_effect_verifier_runs run
        where run.source_job_id=v_source.id
     )
     or exists (
       select 1
         from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
        where evidence.source_job_id=v_source.id
     )
     or not sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(
          v_source.id,v_later_jobs
        )
     or v_observed_at<v_source.completed_at
     or v_observed_at>clock_timestamp()+interval '1 minute'
  then
    raise exception 'exact Qoo10 partial source evidence incomplete'
      using errcode='55000';
  end if;

  if v_attempt.owner_id is distinct from
       '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or v_attempt.credential_id is distinct from v_source.credential_id
     or v_attempt.channel is distinct from 'qoo10'
     or v_attempt.operation is distinct from 'listing.update'
     or v_attempt.status is distinct from 'manual_required'
     or v_attempt.remote_id is distinct from '1217336970'
     or v_attempt.request_fingerprint is distinct from v_source.request_fingerprint
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
     or v_listing.remote_id is distinct from '1217336970'
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.seller_account_key is distinct from v_source.seller_account_key
  then
    raise exception 'exact Qoo10 partial attempt or listing identity drifted'
      using errcode='55000';
  end if;

  insert into sellerpilot_private.qoo10_exact_partial_manual_reconciliations (
    source_job_id,source_attempt_id,listing_id,product_id,credential_id,owner_id,
    remote_id,seller_account_key,source_request_sha256,source_request_bytes,
    source_response_sha256,source_response_bytes,partial_observation,
    partial_observation_sha256,later_jobs,later_jobs_sha256,
    partial_observed_at,resolution,provider_call_replayed,
    manual_activation_count_allowed,reconciled_at
  ) values (
    v_source.id,v_attempt.id,v_listing.id,v_listing.product_id,
    v_source.credential_id,v_attempt.owner_id,'1217336970',
    v_source.seller_account_key,
    encode(extensions.digest(v_source.request_payload::text,'sha256'),'hex'),
    octet_length(v_source.request_payload::text),
    encode(extensions.digest(v_source.response_payload::text,'sha256'),'hex'),
    octet_length(v_source.response_payload::text),p_observation,
    encode(extensions.digest(p_observation::text,'sha256'),'hex'),v_later_jobs,
    encode(extensions.digest(v_later_jobs::text,'sha256'),'hex'),v_observed_at,
    'partial_remote_effect_manual_activation_required',false,1,clock_timestamp()
  );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_partial_manual_reconcile_source',v_source.id::text,true
  );
  update sellerpilot_private.channel_gateway_jobs source
     set status='failed',
         error_message=
           'QOO10_PARTIAL_REMOTE_EFFECT_CONFIRMED: manual seller-center activation and exact final public readback required; provider retry forbidden.',
         updated_at=clock_timestamp()
   where source.id=v_source.id and source.status='reconciliation_required';
  if not found then
    raise exception 'exact Qoo10 partial source transition failed'
      using errcode='55000';
  end if;

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_partial_manual_apply','partial:'||v_source.id::text,true
  );
  update sellerpilot_private.product_listings listing
     set remote_visibility='non_public',provider_status='S1',
         last_verified_at=v_observed_at,
         last_error=
           'Qoo10 부분 반영 확인 · 판매자센터 수동 판매재개 및 최종 공개 검증 필요',
         updated_at=clock_timestamp()
   where listing.id=v_listing.id and listing.status='failed'
     and listing.failure_class='external_action'
     and listing.remote_visibility='unknown';
  if not found then
    raise exception 'exact Qoo10 partial listing projection failed'
      using errcode='55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,action,entity_type,entity_id,safe_detail
  ) values (
    v_attempt.owner_id,'qoo10_exact_partial_remote_effect_reconciled',
    'product_listing',v_listing.id::text,jsonb_build_object(
      'source_job_id',v_source.id,'remote_id','1217336970',
      'partial_observation_sha256',
        encode(extensions.digest(p_observation::text,'sha256'),'hex'),
      'later_jobs_sha256',
        encode(extensions.digest(v_later_jobs::text,'sha256'),'hex'),
      'resolution','partial_remote_effect_manual_activation_required',
      'provider_call_replayed',false,'manual_activation_count_allowed',1
    )
  );

  return jsonb_build_object(
    'contract','qoo10_partial_remote_effect_manual_reconciliation_v1',
    'sourceJobId',v_source.id,'sourceStatus','failed',
    'resolution','partial_remote_effect_manual_activation_required',
    'providerStatus','S1','remoteVisibility','non_public',
    'providerCallReplayed',false,'manualActivationReady',true,
    'manualActivationCountAllowed',1,'reused',false
  );
end;
$$;

create function public.sellerpilot_service_finalize_exact_qoo10_manual_activation(
  p_source_job_id uuid,
  p_release_sha text,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_partial sellerpilot_private.qoo10_exact_partial_manual_reconciliations%rowtype;
  v_existing sellerpilot_private.qoo10_exact_manual_activation_outcomes%rowtype;
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_later_jobs jsonb;
  v_manual_activation_confirmed_at timestamptz;
  v_observed_at timestamptz;
  v_observation_sha text;
  v_resources jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,901085000);
  if p_source_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_exact_manual_activation_observation_valid(
          p_observation
        )
  then
    raise exception 'exact Qoo10 manual activation identity invalid'
      using errcode='55000';
  end if;
  begin
    v_manual_activation_confirmed_at:=
      (p_observation->>'manualActivationConfirmedAt')::timestamptz;
    v_observed_at:=(p_observation->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'exact Qoo10 manual activation confirmation timestamp invalid'
      using errcode='55000';
  end;
  v_observation_sha:=encode(
    extensions.digest(p_observation::text,'sha256'),'hex'
  );

  select * into v_existing
    from sellerpilot_private.qoo10_exact_manual_activation_outcomes outcome
   where outcome.source_job_id=p_source_job_id;
  if found then
    if v_existing.final_observation is distinct from p_observation
       or not exists (
         select 1 from sellerpilot_private.product_listings listing
          where listing.id=v_existing.listing_id
            and listing.status='published'
            and listing.failure_class is null
            and listing.remote_visibility='live'
            and listing.provider_status='S2'
       )
    then
      raise exception 'exact Qoo10 manual activation replay conflict'
        using errcode='55000';
    end if;
    return jsonb_build_object(
      'contract','qoo10_manual_activation_final_reconciliation_v1',
      'sourceJobId',p_source_job_id,'providerStatus','S2',
      'remoteVisibility','live','purchaseAvailable',true,
      'providerCallReplayed',false,'manualActivationCount',1,'reused',true
    );
  end if;

  select * into strict v_partial
    from sellerpilot_private.qoo10_exact_partial_manual_reconciliations evidence
   where evidence.source_job_id=p_source_job_id for update;
  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id=p_source_job_id for update;
  select * into strict v_attempt
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id=v_partial.source_attempt_id for update;
  select * into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id=v_partial.listing_id for update;
  v_later_jobs:=sellerpilot_private.qoo10_exact_partial_manual_later_jobs(
    p_source_job_id
  );

  if v_partial.resolution is distinct from
       'partial_remote_effect_manual_activation_required'
     or v_partial.provider_call_replayed
     or v_partial.manual_activation_count_allowed<>1
     or v_source.status is distinct from 'failed'
     or v_source.error_message is distinct from
          'QOO10_PARTIAL_REMOTE_EFFECT_CONFIRMED: manual seller-center activation and exact final public readback required; provider retry forbidden.'
     or v_attempt.status is distinct from 'manual_required'
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.remote_visibility is distinct from 'non_public'
     or v_listing.provider_status is distinct from 'S1'
     or v_listing.remote_id is distinct from '1217336970'
     or v_listing.operation_attempt_id is distinct from v_attempt.id
     or v_later_jobs is distinct from v_partial.later_jobs
     or not sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(
          p_source_job_id,v_later_jobs
        )
     or v_manual_activation_confirmed_at<v_partial.partial_observed_at
     or v_observed_at<v_manual_activation_confirmed_at
     or v_observed_at>clock_timestamp()+interval '1 minute'
  then
    raise exception 'exact Qoo10 manual activation evidence incomplete'
      using errcode='55000';
  end if;

  insert into sellerpilot_private.qoo10_exact_manual_activation_outcomes (
    source_job_id,source_attempt_id,listing_id,product_id,credential_id,owner_id,
    remote_id,final_observation,final_observation_sha256,
    manual_activation_confirmed_at,
    final_observed_at,provider_status,remote_visibility,purchase_available,
    manual_activation_count,provider_call_replayed,finalized_at
  ) values (
    v_partial.source_job_id,v_partial.source_attempt_id,v_partial.listing_id,
    v_partial.product_id,v_partial.credential_id,v_partial.owner_id,
    v_partial.remote_id,p_observation,v_observation_sha,
    v_manual_activation_confirmed_at,
    v_observed_at,'S2','live',true,1,false,clock_timestamp()
  );

  v_resources:=jsonb_build_object(
    'resources',jsonb_build_object('itemCode','1217336970'),
    'verification',jsonb_build_object(
      'contract','qoo10_seller_center_manual_activation_readback_v1',
      'verifiedAt',to_jsonb(v_observed_at),
      'evidenceSha256',v_observation_sha,
      'locale','ja-JP','imageCount',8,
      'purchaseAvailable',true,'manualActivationCount',1
    )
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_partial_manual_apply','final:'||v_source.id::text,true
  );
  update sellerpilot_private.product_listings listing
     set status='published',remote_visibility='live',provider_status='S2',
         remote_resources=v_resources,
         published_at=v_manual_activation_confirmed_at,
         last_verified_at=v_observed_at,last_error=null,failure_class=null,
         updated_at=clock_timestamp()
   where listing.id=v_partial.listing_id and listing.status='failed'
     and listing.failure_class='external_action'
     and listing.remote_visibility='non_public'
     and listing.provider_status='S1';
  if not found then
    raise exception 'exact Qoo10 final listing projection failed'
      using errcode='55000';
  end if;

  update sellerpilot_private.channel_operation_attempts attempt
     set status='failed',http_status=409,
         safe_message=
           'Qoo10 부분 반영 작업 종료 · 판매자센터 1회 판매재개 및 최종 공개 검증 완료'
   where attempt.id=v_partial.source_attempt_id
     and attempt.status='manual_required';
  if not found then
    raise exception 'exact Qoo10 manual attempt retirement failed'
      using errcode='55000';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,action,entity_type,entity_id,safe_detail
  ) values (
    v_partial.owner_id,'qoo10_exact_manual_activation_reconciled',
    'product_listing',v_partial.listing_id::text,jsonb_build_object(
      'source_job_id',v_partial.source_job_id,'remote_id',v_partial.remote_id,
      'final_observation_sha256',v_observation_sha,'provider_status','S2',
      'remote_visibility','live','purchase_available',true,
      'manual_activation_count',1,'provider_call_replayed',false
    )
  );

  return jsonb_build_object(
    'contract','qoo10_manual_activation_final_reconciliation_v1',
    'sourceJobId',v_partial.source_job_id,'providerStatus','S2',
    'remoteVisibility','live','purchaseAvailable',true,
    'providerCallReplayed',false,'manualActivationCount',1,'reused',false
  );
end;
$$;

create function public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
  p_source_job_id uuid,
  p_release_sha text,
  p_partial_observation jsonb,
  p_final_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing_partial sellerpilot_private.qoo10_exact_partial_manual_reconciliations%rowtype;
  v_existing_final sellerpilot_private.qoo10_exact_manual_activation_outcomes%rowtype;
  v_partial_observed_at timestamptz;
  v_manual_activation_confirmed_at timestamptz;
  v_final_observed_at timestamptz;
  v_partial_result jsonb;
  v_final_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,901085000);
  if p_source_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_exact_partial_manual_observation_valid(
          p_partial_observation
        )
     or not sellerpilot_private.qoo10_exact_manual_activation_observation_valid(
          p_final_observation
        )
  then
    raise exception 'exact Qoo10 post-activation identity invalid'
      using errcode='55000';
  end if;
  begin
    v_partial_observed_at:=
      (p_partial_observation->>'observedAt')::timestamptz;
    v_manual_activation_confirmed_at:=
      (p_final_observation->>'manualActivationConfirmedAt')::timestamptz;
    v_final_observed_at:=(p_final_observation->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'exact Qoo10 post-activation timestamp invalid'
      using errcode='55000';
  end;
  if v_manual_activation_confirmed_at<v_partial_observed_at
     or v_final_observed_at<v_manual_activation_confirmed_at
     or v_final_observed_at>clock_timestamp()+interval '1 minute'
  then
    raise exception 'exact Qoo10 post-activation evidence order invalid'
      using errcode='55000';
  end if;

  select * into v_existing_final
    from sellerpilot_private.qoo10_exact_manual_activation_outcomes outcome
   where outcome.source_job_id=p_source_job_id;
  if found then
    select * into strict v_existing_partial
      from sellerpilot_private.qoo10_exact_partial_manual_reconciliations evidence
     where evidence.source_job_id=p_source_job_id;
    if v_existing_partial.partial_observation is distinct from
         p_partial_observation
       or v_existing_final.final_observation is distinct from p_final_observation
       or v_existing_partial.provider_call_replayed
       or v_existing_final.provider_call_replayed
       or not exists (
         select 1 from sellerpilot_private.channel_gateway_jobs source
          where source.id=p_source_job_id and source.status='failed'
       )
       or not exists (
         select 1 from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id=v_existing_partial.source_attempt_id
            and attempt.status='failed'
       )
       or not exists (
         select 1 from sellerpilot_private.product_listings listing
          where listing.id=v_existing_partial.listing_id
            and listing.status='published'
            and listing.failure_class is null
            and listing.remote_visibility='live'
            and listing.provider_status='S2'
            and listing.remote_id='1217336970'
       )
    then
      raise exception 'exact Qoo10 post-activation replay conflict'
        using errcode='55000';
    end if;
    return jsonb_build_object(
      'contract','qoo10_post_activation_atomic_reconciliation_v1',
      'sourceJobId',p_source_job_id,
      'partialEvidenceReused',true,'finalEvidenceReused',true,
      'providerStatus','S2','remoteVisibility','live',
      'purchaseAvailable',true,'manualActivationCount',1,
      'providerCallReplayed',false,'externalWriteCount',0,'reused',true
    );
  end if;

  select public.sellerpilot_service_reconcile_exact_qoo10_partial_manual(
    p_source_job_id,p_release_sha,p_partial_observation
  ) into v_partial_result;
  select public.sellerpilot_service_finalize_exact_qoo10_manual_activation(
    p_source_job_id,p_release_sha,p_final_observation
  ) into v_final_result;

  return jsonb_build_object(
    'contract','qoo10_post_activation_atomic_reconciliation_v1',
    'sourceJobId',p_source_job_id,
    'partialEvidenceReused',v_partial_result->'reused',
    'finalEvidenceReused',v_final_result->'reused',
    'providerStatus','S2','remoteVisibility','live',
    'purchaseAvailable',true,'manualActivationCount',1,
    'providerCallReplayed',false,'externalWriteCount',0,'reused',false
  );
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_partial_manual_observation_valid(jsonb),
  sellerpilot_private.qoo10_exact_manual_activation_observation_valid(jsonb),
  sellerpilot_private.qoo10_exact_partial_manual_later_jobs(uuid),
  sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(uuid,jsonb),
  sellerpilot_private.qoo10_partial_manual_listing_update_allowed(jsonb,jsonb,text),
  public.sellerpilot_service_reconcile_exact_qoo10_partial_manual(uuid,text,jsonb),
  public.sellerpilot_service_finalize_exact_qoo10_manual_activation(uuid,text,jsonb),
  public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
    uuid,text,jsonb,jsonb
  )
  from public,anon,authenticated,service_role;
grant execute on function
  public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
    uuid,text,jsonb,jsonb
  )
  to service_role;

do $qoo10_partial_manual_postimage$
declare
  v_reconcile regprocedure:=pg_catalog.to_regprocedure(
    'public.sellerpilot_service_reconcile_exact_qoo10_partial_manual(uuid,text,jsonb)'
  );
  v_finalize regprocedure:=pg_catalog.to_regprocedure(
    'public.sellerpilot_service_finalize_exact_qoo10_manual_activation(uuid,text,jsonb)'
  );
  v_atomic regprocedure:=pg_catalog.to_regprocedure(
    'public.sellerpilot_service_reconcile_exact_qoo10_post_activation(uuid,text,jsonb,jsonb)'
  );
  v_guard regprocedure:=pg_catalog.to_regprocedure(
    'sellerpilot_private.guard_product_listing_seller_lineage()'
  );
begin
  if v_reconcile is null or v_finalize is null or v_atomic is null
     or v_guard is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_guard),
          'sellerpilot.qoo10_partial_manual_apply')=0
     or pg_catalog.has_function_privilege('service_role',v_reconcile,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_finalize,'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',v_atomic,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_reconcile,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_finalize,'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',v_atomic,'EXECUTE')
  then
    raise exception 'exact Qoo10 partial manual postimage drifted'
      using errcode='55000';
  end if;
end;
$qoo10_partial_manual_postimage$;

comment on table
  sellerpilot_private.qoo10_exact_partial_manual_reconciliations is
  'One exact fac9 partial-effect adjudication from CHANGHEE seller-center evidence; no provider replay is permitted and one manual activation is allowed.';
comment on table
  sellerpilot_private.qoo10_exact_manual_activation_outcomes is
  'One exact append-only S2/live outcome requiring seller-center and public purchase readback after the single manual activation.';
comment on function
  public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
    uuid,text,jsonb,jsonb
  ) is
  'Atomically records historical S1 plus already completed one-shot manual S2 activation evidence; it performs no provider write and rolls back both ledger phases on any mismatch.';

commit;
