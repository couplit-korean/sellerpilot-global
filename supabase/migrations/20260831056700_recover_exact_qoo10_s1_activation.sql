-- Recover the one Qoo10 item whose UpdateGoods and EditGoodsContents calls
-- completed but whose terminal S1 readback was conservatively classified as
-- reconciliation_required.  Recovery is deliberately split into two jobs:
-- an ordinary read-only listing.publication.verify observation, followed by
-- one dedicated listing.activate provider mutation.  The source job is never
-- rewritten and neither UpdateGoods nor EditGoodsContents can be replayed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint if exists channel_gateway_jobs_operation_check;
alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test', 'competitor.search',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop', 'listing.activate',
    'listing.lineage.verify', 'listing.publication.verify',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'inquiries.list', 'inquiries.reply', 'shipment.acknowledge', 'shipment.confirm'
  )) not valid;

alter table sellerpilot_private.channel_operation_attempts
  drop constraint if exists channel_operation_attempts_operation_check;
alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_operation_check check (operation in (
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop', 'listing.activate',
    'price.update', 'inventory.update', 'orders.list', 'orders.get', 'inquiries.list',
    'shipment.acknowledge', 'shipment.confirm'
  ));

create table sellerpilot_private.qoo10_exact_s1_verifier_runs (
  verifier_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_attempt_id uuid not null
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
  release_sha text not null,
  contract text not null,
  queued_at timestamptz not null,
  constraint qoo10_exact_s1_verifier_source_check check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and source_attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
    and remote_id = '1217336970'
    and seller_account_key =
      '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
    and source_request_sha256 =
      'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
    and source_request_bytes = 23555
    and source_response_sha256 =
      'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
    and source_response_bytes = 16669
    and release_sha ~ '^[a-f0-9]{40}$'
    and contract = 'qoo10_exact_s1_verifier_v1'
  )
);

create table sellerpilot_private.qoo10_exact_s1_observations (
  verifier_job_id uuid primary key
    references sellerpilot_private.qoo10_exact_s1_verifier_runs(verifier_job_id)
    on delete restrict,
  source_job_id uuid not null,
  listing_id uuid not null,
  remote_id text not null,
  release_sha text not null,
  verifier_response_sha256 text not null,
  verifier_response_bytes integer not null,
  activation_expectation jsonb not null,
  provider_status text not null,
  remote_visibility text not null,
  verified_at timestamptz not null,
  verifier_completed_at timestamptz not null,
  contract text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_s1_observation_source_check check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
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
  )
);

create table sellerpilot_private.qoo10_exact_s1_activation_permits (
  activation_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  activation_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  verifier_job_id uuid not null unique
    references sellerpilot_private.qoo10_exact_s1_observations(verifier_job_id)
    on delete restrict,
  source_job_id uuid not null,
  listing_id uuid not null,
  credential_id uuid not null,
  owner_id uuid not null,
  remote_id text not null,
  seller_account_key text not null,
  release_sha text not null,
  activation_request_sha256 text not null,
  activation_request_bytes integer not null,
  write_resource_key text not null,
  contract text not null,
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  bound_at timestamptz,
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint qoo10_exact_s1_activation_target_check check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
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
  ),
  constraint qoo10_exact_s1_activation_fresh_check check (
    expires_at > armed_at and expires_at <= armed_at + interval '2 minutes'
  ),
  constraint qoo10_exact_s1_activation_binding_check check (
    (
      invalidated_at is null and invalidation_reason is null
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
    ) or (
      invalidated_at is not null
      and invalidated_at >= expires_at
      and invalidation_reason = 'expired_before_claim'
      and bound_at is null and bound_worker_token_id is null
      and bound_claim_token is null and consumed_at is null
    )
  )
);

create unique index qoo10_exact_s1_one_active_source_permit
  on sellerpilot_private.qoo10_exact_s1_activation_permits(source_job_id)
  where invalidated_at is null;
create unique index qoo10_exact_s1_one_active_listing_permit
  on sellerpilot_private.qoo10_exact_s1_activation_permits(listing_id)
  where invalidated_at is null;

create table sellerpilot_private.qoo10_exact_s1_activation_outcomes (
  activation_job_id uuid primary key
    references sellerpilot_private.qoo10_exact_s1_activation_permits(activation_job_id)
    on delete restrict,
  source_job_id uuid not null unique,
  verifier_job_id uuid not null unique,
  listing_id uuid not null unique,
  remote_id text not null,
  terminal_status text not null,
  activation_response_sha256 text,
  activation_response_bytes integer,
  provider_status text,
  remote_visibility text,
  verified_at timestamptz,
  completed_at timestamptz not null,
  contract text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint qoo10_exact_s1_activation_outcome_check check (
    source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and remote_id = '1217336970'
    and terminal_status in ('succeeded','failed','reconciliation_required')
    and contract = 'qoo10_exact_s1_activation_outcome_v1'
    and (
      terminal_status <> 'succeeded'
      or (
        activation_response_sha256 ~ '^[a-f0-9]{64}$'
        and activation_response_bytes between 100 and 1000000
        and provider_status = 'S2'
        and remote_visibility = 'live'
        and verified_at is not null
      )
    )
  )
);

alter table sellerpilot_private.qoo10_exact_s1_verifier_runs enable row level security;
alter table sellerpilot_private.qoo10_exact_s1_observations enable row level security;
alter table sellerpilot_private.qoo10_exact_s1_activation_permits enable row level security;
alter table sellerpilot_private.qoo10_exact_s1_activation_outcomes enable row level security;
revoke all on sellerpilot_private.qoo10_exact_s1_verifier_runs,
  sellerpilot_private.qoo10_exact_s1_observations,
  sellerpilot_private.qoo10_exact_s1_activation_permits,
  sellerpilot_private.qoo10_exact_s1_activation_outcomes
  from public, anon, authenticated, service_role;

create function sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'exact Qoo10 S1 evidence is immutable' using errcode = '55000';
end;
$$;

create trigger block_qoo10_exact_s1_verifier_run_change
before update or delete on sellerpilot_private.qoo10_exact_s1_verifier_runs
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();
create trigger block_qoo10_exact_s1_observation_change
before update or delete on sellerpilot_private.qoo10_exact_s1_observations
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();
create trigger block_qoo10_exact_s1_activation_outcome_change
before update or delete on sellerpilot_private.qoo10_exact_s1_activation_outcomes
for each row execute function
  sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change();

create function sellerpilot_private.qoo10_exact_s1_release_is_current(
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_release_sha ~ '^[a-f0-9]{40}$'
    and sellerpilot_private.attested_listing_publication_release_sha('qoo10')
          = p_release_sha
    and sellerpilot_private.active_serverless_runtime_release_sha()
          = p_release_sha
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

create function sellerpilot_private.qoo10_exact_s1_source_is_current()
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
     where job.id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
       and job.attempt_id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
       and job.listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and job.credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and job.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
       and job.channel = 'qoo10'
       and job.operation = 'listing.update'
       and job.environment = 'production'
       and job.status = 'reconciliation_required'
       and job.attempt_count = 1
       and job.started_at = '2026-08-30 23:40:03.366985+00'::timestamptz
       and job.provider_mutation_started_at =
             '2026-08-30 23:40:04.536552+00'::timestamptz
       and job.completed_at = '2026-08-30 23:40:12.844179+00'::timestamptz
       and job.error_message is not null
       and job.seller_account_key =
             '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and job.request_fingerprint =
             '76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
       and octet_length(job.request_payload::text) = 23555
       and encode(extensions.digest(job.request_payload::text, 'sha256'), 'hex') =
             'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d'
       and octet_length(job.response_payload::text) = 16669
       and encode(extensions.digest(job.response_payload::text, 'sha256'), 'hex') =
             'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
       and not exists (
         select 1
           from jsonb_array_elements(coalesce(job.response_payload->'steps','[]'::jsonb)) step
          where lower(coalesce(step->>'name','')) in (
            'qoo10-rollback-recovery-activate', 'qoo10-s1-activation',
            'editgoodsstatus'
          )
       )
       and (
         select count(*)
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = job.id
       ) = 1
       and attempt.id = '4402cc76-295b-4e17-8c07-d5d0e9967ce9'::uuid
       and attempt.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
       and attempt.credential_id = job.credential_id
       and attempt.channel = 'qoo10'
       and attempt.operation = 'listing.update'
       and attempt.status = 'manual_required'
       and attempt.http_status = 409
       and attempt.remote_id = '1217336970'
       and attempt.completed_at = job.completed_at
       and attempt.gateway_write_required
       and not attempt.pre_gateway_retryable
       and listing.id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and listing.owner_id = attempt.owner_id
       and listing.product_id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and listing.channel_key = 'qoo10'
       and listing.market = 'JP'
       and listing.target_id = ''
       and listing.status = 'failed'
       and listing.failure_class = 'external_action'
       and listing.remote_visibility = 'unknown'
       and listing.requested_publication_intent = 'live'
       and listing.remote_id = '1217336970'
       and listing.seller_account_key = job.seller_account_key
       and listing.marketplace_sku is null
       and listing.updated_at = '2026-08-30 23:40:12.971653+00'::timestamptz
       and product.id = 'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
       and product.owner_id = listing.owner_id
       and not product.demo
       and product.status <> 'archived'
       and credential.channel = 'qoo10'
       and credential.environment = 'production'
       and credential.status = 'active'
       and credential.seller_account_key = job.seller_account_key
       and credential.created_by = job.created_by
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs later_job
          where later_job.listing_id = job.listing_id
            and later_job.operation in (
              'listing.create','listing.update','listing.stop'
            )
            and later_job.created_at > job.created_at
       )
       and not exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs active_job
          where active_job.listing_id = job.listing_id
            and active_job.operation in (
              'listing.create','listing.update','listing.stop'
            )
            and active_job.status in (
              'queued','running','reconciliation_required'
            )
            and active_job.id <> job.id
       )
  )
$$;

create function sellerpilot_private.qoo10_exact_remote_items(
  p_value jsonb,
  p_remote_id text
)
returns setof jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    if exists (
         select 1 from jsonb_each(p_value) field
          where field.key in ('ItemCode','ItemNo','GdNo')
       )
       and not exists (
         select 1 from jsonb_each(p_value) field
          where field.key in ('ItemCode','ItemNo','GdNo')
            and (
              jsonb_typeof(field.value) not in ('string','number')
              or field.value#>>'{}' <> p_remote_id
            )
       )
    then
      return next p_value;
    end if;
    for v_child in select value from jsonb_each(p_value) loop
      return query select *
        from sellerpilot_private.qoo10_exact_remote_items(v_child, p_remote_id);
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value) loop
      return query select *
        from sellerpilot_private.qoo10_exact_remote_items(v_child, p_remote_id);
    end loop;
  end if;
end;
$$;

create function sellerpilot_private.qoo10_exact_aliases_consistent(
  p_item jsonb,
  p_aliases text[]
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    bool_and(jsonb_typeof(field.value) in ('string','number'))
      and count(distinct field.value#>>'{}') <= 1,
    true
  )
    from jsonb_each(p_item) field
   where lower(field.key) = any (
     select lower(alias) from unnest(p_aliases) alias
   )
$$;

create function sellerpilot_private.qoo10_exact_representative_image_matches(
  p_value text,
  p_content_id text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_content_id ~ '^[1-9][0-9]{5,19}$'
    and p_value ~ (
      '^https://gd[.]image-qoo10[.]jp/li/'
      || pg_catalog.right(p_content_id,3) || '/'
      || pg_catalog.substr(
           p_content_id,pg_catalog.length(p_content_id) - 5,3
         ) || '/'
      || p_content_id
      || '(?:[.]g(?:_[a-z0-9-]+)*)?[.]jpg$'
    )
$$;

create function sellerpilot_private.qoo10_exact_keyword_matches(
  p_expected_title text,
  p_expected_keyword text,
  p_actual_keyword text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_expected_keyword <> ''
    and p_actual_keyword <> ''
    and not exists (
      select 1
        from unnest(pg_catalog.string_to_array(p_expected_keyword,',')) token
       where token = '' or token <> pg_catalog.btrim(token)
    )
    and not exists (
      select 1
        from unnest(pg_catalog.string_to_array(p_actual_keyword,',')) token
       where token = '' or token <> pg_catalog.btrim(token)
    )
    and (
      p_actual_keyword = p_expected_keyword
      or (
      p_expected_title <> ''
      and pg_catalog.strpos(p_expected_title, ',') = 0
      and pg_catalog.length(p_expected_keyword) >
            pg_catalog.length(p_expected_title) + 1
      and pg_catalog.left(
            p_expected_keyword, pg_catalog.length(p_expected_title) + 1
          ) = p_expected_title || ','
      and p_actual_keyword = pg_catalog.substr(
            p_expected_keyword, pg_catalog.length(p_expected_title) + 2
          )
      and (
        pg_catalog.length(p_expected_keyword)
        - pg_catalog.length(pg_catalog.replace(
            p_expected_keyword, p_expected_title, ''
          ))
      ) = pg_catalog.length(p_expected_title)
      )
    )
$$;

create function sellerpilot_private.qoo10_exact_item_matches_source(
  p_item jsonb,
  p_source_arguments jsonb,
  p_expected_status text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_params jsonb := p_source_arguments->'params';
  v_recovery jsonb := p_source_arguments#>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState}';
  v_title text := v_params->>'ItemTitle';
  v_expected_keyword text := v_params->>'Keyword';
  v_actual_keyword text := p_item->>'Keyword';
  v_retail text := coalesce(p_item->>'RetailPrice','');
  v_sell text := coalesce(p_item->>'SellPrice', p_item->>'ItemPrice', '');
  v_quantity text := coalesce(
    p_item->>'ItemQty', p_item->>'Qty', p_item->>'StockQty', ''
  );
begin
  return jsonb_typeof(p_item) = 'object'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ItemCode','ItemNo','GdNo']
        )
    and coalesce(p_item->>'ItemCode', p_item->>'ItemNo', p_item->>'GdNo', '') = '1217336970'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ItemStatus','Status']
        )
    and upper(coalesce(p_item->>'ItemStatus', p_item->>'Status', '')) = p_expected_status
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ItemTitle']
        )
    and coalesce(p_item->>'ItemTitle','') = v_title
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['Keyword','Keywords']
        )
    and sellerpilot_private.qoo10_exact_keyword_matches(
          v_title, v_expected_keyword,
          coalesce(p_item->>'Keyword',p_item->>'Keywords','')
        )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['PromotionName','PromotionNm']
        )
    and coalesce(p_item->>'PromotionName',p_item->>'PromotionNm','') =
          coalesce(v_params->>'PromotionName','')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['IndustrialCode','barcode','gtin']
        )
    and coalesce(
          p_item->>'IndustrialCode',p_item->>'barcode',p_item->>'gtin',''
        ) = coalesce(v_params->>'IndustrialCode','')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ItemDetail','ItemDescription','Description']
        )
    and coalesce(
          p_item->>'ItemDetail',p_item->>'ItemDescription',p_item->>'Description',''
        ) = v_params->>'ItemDescription'
    and sellerpilot_private.qoo10_exact_detail_image_urls(coalesce(
          p_item->>'ItemDetail',p_item->>'ItemDescription',p_item->>'Description',''
        )) = sellerpilot_private.qoo10_exact_detail_image_urls(
          v_params->>'ItemDescription'
        )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['SecondSubCat','SecondSubCatCd','CategoryCode','CateSCode']
        )
    and coalesce(
          p_item->>'SecondSubCat',p_item->>'SecondSubCatCd',
          p_item->>'CategoryCode',p_item->>'CateSCode',''
        ) = v_recovery->>'categoryCode'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['RetailPrice']
        )
    and v_retail ~ '^[0-9]+(?:[.]0+)?$'
    and v_retail::numeric = (v_recovery->>'retailPriceJpy')::numeric
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['SellPrice','ItemPrice']
        )
    and v_sell ~ '^[0-9]+(?:[.]0+)?$'
    and v_sell::numeric = (v_recovery->>'sellPriceJpy')::numeric
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ItemQty','Qty','StockQty']
        )
    and v_quantity ~ '^[0-9]+$'
    and v_quantity::numeric = (v_recovery->>'quantity')::numeric
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ShippingNo','ShippingNO','DeliveryGroupNo']
        )
    and coalesce(
          p_item->>'ShippingNo',p_item->>'ShippingNO',
          p_item->>'DeliveryGroupNo',''
        ) = v_recovery->>'shippingNo'
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['BIContentsNo','BiContentsNo','BIContentsNO']
        )
    and not exists (
      select 1
        from jsonb_each(p_item) field
       where lower(field.key) in (
               lower('BIContentsNo'),lower('BiContentsNo'),lower('BIContentsNO')
             )
         and not (
           jsonb_typeof(field.value) in ('string','number')
           and case
             when field.value#>>'{}' ~ '^[0-9]+$' then
               (field.value#>>'{}')::numeric =
                 (v_recovery->>'biContentsNo')::numeric
             else false
           end
         )
    )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ImageUrl','StandardImage','MainImageUrl']
        )
    and sellerpilot_private.qoo10_exact_representative_image_matches(
          coalesce(
            p_item->>'ImageUrl',p_item->>'StandardImage',
            p_item->>'MainImageUrl',''
          ),
          v_recovery->>'biContentsNo'
        )
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ProductionPlaceType','OriginType']
        )
    and coalesce(
          p_item->>'ProductionPlaceType', p_item->>'OriginType', ''
        ) = coalesce(v_params->>'ProductionPlaceType','')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['ProductionPlace','Origin','OriginCode']
        )
    and coalesce(
          p_item->>'ProductionPlace', p_item->>'Origin',
          p_item->>'OriginCode', ''
        ) = coalesce(v_params->>'ProductionPlace','')
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          p_item,array['AdultYN','AdultYn','AdultFlag']
        )
    and upper(coalesce(
          p_item->>'AdultYN', p_item->>'AdultYn', p_item->>'AdultFlag', ''
        )) =
          upper(coalesce(v_params->>'AdultYN',''))
    and (
      coalesce(v_params->>'SellerCode','') = ''
      or coalesce(p_item->>'SellerCode','') = v_params->>'SellerCode'
    );
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.qoo10_exact_response_state_valid(
  p_response jsonb,
  p_operation text,
  p_step_name text,
  p_expected_status text,
  p_expected_visibility text,
  p_source_arguments jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_step jsonb;
  v_item jsonb;
  v_state jsonb := p_response->'remoteState';
  v_evidence jsonb := v_state->'evidence';
begin
  select step into v_step
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_step_name;
  if not found or (
    select count(*) from jsonb_array_elements(
      coalesce(p_response->'steps','[]'::jsonb)
    ) step where step->>'name' = p_step_name
  ) <> 1 then return false; end if;

  select item into v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      v_step#>'{data,ResultObject}', '1217336970'
    ) item;
  if not found or (
    select count(*) from sellerpilot_private.qoo10_exact_remote_items(
      v_step#>'{data,ResultObject}', '1217336970'
    )
  ) <> 1 then return false; end if;

  return p_response->>'ok' = 'true'
    and p_response->>'channel' = 'qoo10'
    and p_response->>'operation' = p_operation
    and p_response->>'remoteId' = '1217336970'
    and p_response->>'publicationStateContract' = 'verified_remote_state_v1'
    and p_response->>'publicationIntent' = 'live'
    and (p_response->>'publicationFulfilled')::boolean is not distinct from
          (p_expected_status = 'S2')
    and v_step->>'ok' = 'true'
    and (v_step->>'status')::integer between 200 and 299
    and coalesce(v_step#>>'{data,ResultCode}','') = '0'
    and sellerpilot_private.qoo10_exact_item_matches_source(
          v_item, p_source_arguments, p_expected_status
        )
    and v_state->>'verified' = 'true'
    and v_state->>'visibility' = p_expected_visibility
    and upper(v_state->>'providerStatus') = p_expected_status
    and v_state->>'locale' = 'ja-JP'
    and v_state->>'fingerprint' =
          p_source_arguments->>'publicationExpectedFingerprint'
    and (v_state->>'imageCount')::integer = 8
    and v_evidence->>'identityVerified' = 'true'
    and v_evidence->>'statusVerified' = 'true'
    and v_evidence->>'localeVerified' = 'true'
    and v_evidence->>'fingerprintVerified' = 'true'
    and v_evidence->>'imageCountVerified' = 'true'
    and v_evidence->>'titleVerified' = 'true'
    and v_evidence->>'descriptionVerified' = 'true'
    and v_evidence->>'languageContentVerified' = 'true'
    and v_evidence->>'detailImageCountVerified' = 'true'
    and v_evidence->>'contentDigestVerified' = 'true'
    and v_evidence->>'representativeImageVerified' = 'true'
    and v_evidence->>'providerBodyDetailImagesVerified' = 'true'
    and coalesce(v_evidence->>'sourceImageDigest','') ~ '^[a-f0-9]{64}$'
    and v_evidence->>'remoteImageDigest' = v_evidence->>'sourceImageDigest';
exception when others then
  return false;
end;
$$;

-- The source request permits one specifically observed Qoo10 normalization:
-- removal of the exact leading title keyword.  Activation must not re-open
-- that choice.  Bind the post-write keyword byte-for-byte to both the fresh
-- immutable observation and the marker carried by the one-shot write job.
create function sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(
  p_response jsonb,
  p_request_payload jsonb,
  p_observation_expectation jsonb,
  p_step_name text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_step jsonb;
  v_item jsonb;
  v_expected_keyword text := p_observation_expectation->>'expectedKeyword';
begin
  select step into v_step
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_step_name;
  if not found or (
    select count(*) from jsonb_array_elements(
      coalesce(p_response->'steps','[]'::jsonb)
    ) step where step->>'name' = p_step_name
  ) <> 1 then return false; end if;

  select item into v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      v_step#>'{data,ResultObject}', '1217336970'
    ) item;
  if not found or (
    select count(*) from sellerpilot_private.qoo10_exact_remote_items(
      v_step#>'{data,ResultObject}', '1217336970'
    )
  ) <> 1 then return false; end if;

  return v_expected_keyword <> ''
    and p_request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedKeyword}' =
          v_expected_keyword
    and sellerpilot_private.qoo10_exact_aliases_consistent(
          v_item,array['Keyword','Keywords']
        )
    and coalesce(v_item->>'Keyword',v_item->>'Keywords','') =
          v_expected_keyword;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.qoo10_exact_hex_codepoint(
  p_hex text
)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_value integer := 0;
  v_digit integer;
  v_index integer;
begin
  if p_hex = '' or pg_catalog.length(p_hex) > 6 then return null; end if;
  for v_index in 1..pg_catalog.length(p_hex) loop
    v_digit := pg_catalog.strpos(
      '0123456789abcdef',lower(pg_catalog.substr(p_hex,v_index,1))
    ) - 1;
    if v_digit < 0 then return null; end if;
    v_value := v_value * 16 + v_digit;
  end loop;
  return case when v_value between 1 and 1114111 then v_value end;
end;
$$;

create function sellerpilot_private.qoo10_exact_decode_html(
  p_html text
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_html text := p_html;
  v_match text[];
  v_code integer;
begin
  for v_match in
    select match_values from pg_catalog.regexp_matches(
      v_html,'(&#[xX]([0-9a-fA-F]+);)','g'
    ) as match_row(match_values)
  loop
    v_code := sellerpilot_private.qoo10_exact_hex_codepoint(v_match[2]);
    if v_code is not null then
      v_html := pg_catalog.replace(v_html,v_match[1],pg_catalog.chr(v_code));
    end if;
  end loop;
  for v_match in
    select match_values from pg_catalog.regexp_matches(
      v_html,'(&#([0-9]+);)','g'
    ) as match_row(match_values)
  loop
    begin
      v_code := v_match[2]::integer;
    exception when others then
      v_code := null;
    end;
    if v_code between 1 and 1114111 then
      v_html := pg_catalog.replace(v_html,v_match[1],pg_catalog.chr(v_code));
    end if;
  end loop;
  v_html := pg_catalog.replace(v_html, '&lt;', '<');
  v_html := pg_catalog.replace(v_html, '&gt;', '>');
  v_html := pg_catalog.replace(v_html, '&quot;', '"');
  v_html := pg_catalog.replace(v_html, '&#39;', '''');
  return pg_catalog.replace(v_html, '&amp;', '&');
end;
$$;

-- Match the runtime's ordered <img src=...> projection for the exact stored
-- Qoo10 source HTML, including its numeric/named entity decode order.
create function sellerpilot_private.qoo10_exact_detail_image_urls(
  p_html text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_html text := sellerpilot_private.qoo10_exact_decode_html(p_html);
  v_urls jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(pg_catalog.btrim(
           coalesce(matches[1],matches[2],matches[3])
         )) order by ordinal), '[]'::jsonb)
    into v_urls
    from pg_catalog.regexp_matches(
      v_html,
      '<img[[:>:]][^>]*[[:<:]]src[[:>:]][[:space:]]*=[[:space:]]*(?:"([^"]+)"|''([^'']+)''|([^[:space:]>]+))',
      'gi'
    ) with ordinality as found(matches,ordinal)
   where pg_catalog.btrim(coalesce(matches[1],matches[2],matches[3])) <> '';
  return v_urls;
exception when others then
  return '[]'::jsonb;
end;
$$;

create function sellerpilot_private.qoo10_exact_activation_expectation_valid(
  p_expectation jsonb,
  p_source_arguments jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_expected_state jsonb := p_expectation->'expectedState';
  v_source_state jsonb :=
    p_source_arguments#>'{sellerpilotQoo10RollbackUpdateRecovery,expectedState}';
  v_params jsonb := p_source_arguments->'params';
  v_source_detail_images jsonb :=
    sellerpilot_private.qoo10_exact_detail_image_urls(
      p_source_arguments#>>'{params,ItemDescription}'
    );
  v_top_keys integer;
  v_state_keys integer;
begin
  select count(*) into v_top_keys from jsonb_object_keys(p_expectation);
  select count(*) into v_state_keys from jsonb_object_keys(v_expected_state);
  return jsonb_typeof(p_expectation) = 'object'
    and jsonb_typeof(v_expected_state) = 'object'
    and v_top_keys = case
      when nullif(v_params->>'SellerCode','') is null then 7 else 8 end
    and v_state_keys = 9
    and v_expected_state->>'categoryCode' = v_source_state->>'categoryCode'
    and jsonb_typeof(v_expected_state->'retailPriceJpy') = 'number'
    and (v_expected_state->>'retailPriceJpy')::numeric =
          (v_source_state->>'retailPriceJpy')::numeric
    and jsonb_typeof(v_expected_state->'sellPriceJpy') = 'number'
    and (v_expected_state->>'sellPriceJpy')::numeric =
          (v_source_state->>'sellPriceJpy')::numeric
    and jsonb_typeof(v_expected_state->'quantity') = 'number'
    and (v_expected_state->>'quantity')::numeric =
          (v_source_state->>'quantity')::numeric
    and v_expected_state->>'shippingNo' = v_source_state->>'shippingNo'
    and jsonb_typeof(v_expected_state->'biContentsNo') = 'number'
    and (v_expected_state->>'biContentsNo')::numeric =
          (v_source_state->>'biContentsNo')::numeric
    and v_expected_state->>'originType' = v_params->>'ProductionPlaceType'
    and v_expected_state->>'originCode' = v_params->>'ProductionPlace'
    and v_expected_state->>'adultYn' = v_params->>'AdultYN'
    and p_expectation->>'expectedTitle' = v_params->>'ItemTitle'
    and sellerpilot_private.qoo10_exact_keyword_matches(
          v_params->>'ItemTitle',v_params->>'Keyword',
          p_expectation->>'expectedKeyword'
        )
    and p_expectation->>'expectedPromotionName' =
          coalesce(v_params->>'PromotionName','')
    and p_expectation->>'expectedIndustrialCode' =
          coalesce(v_params->>'IndustrialCode','')
    and p_expectation->>'expectedDetailHtmlSha256' = encode(
      extensions.digest(v_params->>'ItemDescription','sha256'),'hex'
    )
    and p_expectation->'expectedDetailImageUrls' = v_source_detail_images
    and jsonb_array_length(p_expectation->'expectedDetailImageUrls') = 8
    and (
      select count(*) = 8
             and count(distinct image.value) = 8
             and bool_and(
               jsonb_typeof(image.value) = 'string'
               and image.value#>>'{}' ~ '^https://[^[:space:]#]+$'
             )
        from jsonb_array_elements(
          p_expectation->'expectedDetailImageUrls'
        ) image(value)
    )
    and (
      nullif(v_params->>'SellerCode','') is null
      or p_expectation->>'expectedSellerCode' = v_params->>'SellerCode'
    );
exception when others then
  return false;
end;
$$;

create function public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(
  p_source_job_id uuid,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_existing uuid;
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_arguments jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_source_job_id is distinct from
       'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_exact_s1_source_is_current()
     or exists (
       select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits
        where invalidated_at is null
     )
  then
    raise exception 'exact Qoo10 S1 verifier preconditions are not met'
      using errcode = '55000';
  end if;

  select run.verifier_job_id into v_existing
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = run.verifier_job_id
   where run.source_job_id = p_source_job_id
     and job.status in ('queued','running')
   order by run.queued_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'contract','qoo10_exact_s1_verifier_v1',
      'sourceJobId',p_source_job_id,
      'verifierJobId',v_existing,
      'reused',true
    );
  end if;

  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_source_job_id;
  v_arguments := jsonb_build_object(
    'publicationReviewId', v_source.listing_id,
    'publicationReviewSourceJobId', v_source.id,
    'publicationReviewCheck', 1,
    'sellerpilotReadOnly', true,
    'sellerpilotQoo10ExactS1Recovery', 'qoo10_exact_s1_verifier_v1',
    'remoteId', '1217336970',
    'market', 'JP',
    'targetId', '',
    'publicationIntent', 'live',
    'publicationStateContract', 'verified_remote_state_v1',
    'publicationExpectedLocale', 'ja-JP',
    'publicationExpectedFingerprint', v_source.request_fingerprint,
    'publicationExpectedImageCount', 8
  );

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key,
    request_fingerprint, created_by, created_at, updated_at
  ) values (
    v_job_id, v_source.credential_id, null, v_source.listing_id,
    'qoo10', 'listing.publication.verify', 'production',
    jsonb_build_object(
      'periodicKey','qoo10-exact-s1:' || p_source_job_id::text,
      'arguments',v_arguments
    ),
    'queued',v_source.seller_account_key,v_source.request_fingerprint,
    v_source.created_by,clock_timestamp(),clock_timestamp()
  );

  insert into sellerpilot_private.qoo10_exact_s1_verifier_runs (
    verifier_job_id, source_job_id, source_attempt_id, listing_id,
    product_id, credential_id, owner_id, remote_id, seller_account_key,
    source_request_sha256, source_request_bytes, source_response_sha256,
    source_response_bytes, release_sha, contract, queued_at
  ) values (
    v_job_id,p_source_job_id,v_source.attempt_id,v_source.listing_id,
    'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid,v_source.credential_id,
    '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,'1217336970',
    v_source.seller_account_key,
    'c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d',23555,
    'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768',16669,
    p_release_sha,'qoo10_exact_s1_verifier_v1',clock_timestamp()
  );

  return jsonb_build_object(
    'contract','qoo10_exact_s1_verifier_v1',
    'sourceJobId',p_source_job_id,
    'verifierJobId',v_job_id,
    'reused',false
  );
end;
$$;

-- Preserve the general verifier source contract.  Only the exact registered
-- fac9 verifier may hydrate from a reconciliation_required source job.
alter function public.sellerpilot_service_listing_publication_verification_source(
  text,uuid,uuid
) rename to sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1;

revoke all on function
  public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(
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
     ) then
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
           'sourceFingerprint',source.request_fingerprint,
           'expectedRemoteId',run.remote_id,
           'expectedLocale','ja-JP',
           'expectedImageCount',8,
           'market','JP',
           'targetId',''
         )
    into v_source
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = run.verifier_job_id
    join sellerpilot_private.channel_gateway_jobs source
      on source.id = run.source_job_id
   where run.verifier_job_id = p_job_id
     and verifier.status = 'running'
     and verifier.claim_token = p_claim_token
     and verifier.operation = 'listing.publication.verify'
     and verifier.provider_mutation_started_at is null
     and verifier.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
     and verifier.request_payload#>>'{arguments,sellerpilotQoo10ExactS1Recovery}' =
           'qoo10_exact_s1_verifier_v1'
     and source.status = 'reconciliation_required'
     and encode(extensions.digest(source.request_payload::text,'sha256'),'hex') =
           run.source_request_sha256
     and encode(extensions.digest(source.response_payload::text,'sha256'),'hex') =
           run.source_response_sha256
     and sellerpilot_private.qoo10_exact_s1_source_is_current();
  if v_source is not null then return v_source; end if;
  return public.sellerpilot_056700_listing_publication_verification_source_before_qoo10_s1(
    p_token_hash,p_job_id,p_claim_token
  );
end;
$$;

create function sellerpilot_private.record_exact_qoo10_s1_observation(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_run sellerpilot_private.qoo10_exact_s1_verifier_runs%rowtype;
  v_source_arguments jsonb;
  v_expectation jsonb;
  v_verified_at timestamptz;
begin
  select * into v_run
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id = p_job_id;
  if not found then return false; end if;
  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  select source.request_payload->'arguments' into strict v_source_arguments
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = v_run.source_job_id;

  if v_job.status <> 'succeeded'
     or v_job.completed_at is null
     or v_job.response_payload is null
     or not sellerpilot_private.qoo10_exact_response_state_valid(
       v_job.response_payload,'listing.publication.verify',
       'qoo10-exact-s1-recovery-verification','S1','non_public',
       v_source_arguments
     )
     or v_job.response_payload#>>'{remoteState,evidence,sourceJobId}' <>
          v_run.source_job_id::text
     or v_job.response_payload#>>'{remoteState,evidence,sourceOperation}' <>
          'listing.update'
     or v_job.response_payload#>>'{remoteState,evidence,sourceContentVerified}' <>
          'true'
  then
    return false;
  end if;
  select step#>'{data,sellerpilotQoo10ActivationExpectation}'
    into v_expectation
    from jsonb_array_elements(v_job.response_payload->'steps') step
   where step->>'name' = 'qoo10-exact-s1-recovery-verification';
  if not sellerpilot_private.qoo10_exact_activation_expectation_valid(
    v_expectation,v_source_arguments
  ) then return false; end if;
  begin
    v_verified_at :=
      (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
  exception when others then
    return false;
  end;
  if v_job.started_at is null or v_verified_at < v_job.started_at
     or v_verified_at > v_job.completed_at + interval '1 minute' then
    return false;
  end if;

  insert into sellerpilot_private.qoo10_exact_s1_observations (
    verifier_job_id,source_job_id,listing_id,remote_id,release_sha,
    verifier_response_sha256,verifier_response_bytes,activation_expectation,provider_status,
    remote_visibility,verified_at,verifier_completed_at,contract
  ) values (
    v_job.id,v_run.source_job_id,v_run.listing_id,v_run.remote_id,v_run.release_sha,
    encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex'),
    octet_length(v_job.response_payload::text),v_expectation,'S1','non_public',
    v_verified_at,v_job.completed_at,'qoo10_exact_s1_observation_v1'
  ) on conflict (verifier_job_id) do nothing;
  return found or exists (
    select 1 from sellerpilot_private.qoo10_exact_s1_observations observation
     where observation.verifier_job_id = v_job.id
       and observation.verifier_response_sha256 =
             encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex')
  );
end;
$$;

create function public.sellerpilot_service_enqueue_exact_qoo10_s1_activation(
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
    select 1 from sellerpilot_private.qoo10_exact_s1_activation_permits
     where invalidated_at is null
  ) then
    raise exception 'exact Qoo10 S1 activation is already armed'
      using errcode = '55000';
  end if;
  select * into v_observation
    from sellerpilot_private.qoo10_exact_s1_observations observation
   where observation.verifier_job_id = p_verifier_job_id;
  select * into v_run
    from sellerpilot_private.qoo10_exact_s1_verifier_runs run
   where run.verifier_job_id = p_verifier_job_id;
  if not found or v_observation.verifier_job_id is null
     or v_observation.release_sha is distinct from p_release_sha
     or v_observation.verifier_completed_at + interval '2 minutes' <= clock_timestamp()
     or not sellerpilot_private.qoo10_exact_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_exact_s1_source_is_current()
  then
    raise exception 'fresh exact Qoo10 S1 observation required'
      using errcode = '55000';
  end if;
  select * into strict v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = v_run.source_job_id;

  v_marker := v_observation.activation_expectation || jsonb_build_object(
    'status','allowed',
    'contract','qoo10_s1_activation_v1',
    'listingId',v_run.listing_id,
    'remoteId',v_run.remote_id,
    'providerStatus','S1',
    'sourceJobId',v_run.source_job_id,
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
      v_run.verifier_job_id::text || ':' || v_run.remote_id,
    'sha256'
  ),'hex');

  insert into sellerpilot_private.channel_operation_attempts (
    id,owner_id,credential_id,channel,operation,idempotency_key,
    request_fingerprint,status,started_at,seller_account_key,
    gateway_write_required,pre_gateway_retryable
  ) values (
    v_attempt_id,v_run.owner_id,v_run.credential_id,'qoo10','listing.activate',
    'qoo10-s1-activate:' || v_run.source_job_id::text || ':' ||
      v_run.verifier_job_id::text,
    v_request_sha,'running',clock_timestamp(),v_run.seller_account_key,true,false
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_s1_activation_enqueue',v_job_id::text,true
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
    'contract','qoo10_exact_s1_activation_permit_v1',
    'sourceJobId',v_run.source_job_id,
    'verifierJobId',v_run.verifier_job_id,
    'activationJobId',v_job_id,
    'activationAttemptId',v_attempt_id,
    'expiresAt',v_observation.verifier_completed_at + interval '2 minutes'
  );
end;
$$;

create function sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.operation <> 'listing.activate' then return new; end if;
    if current_setting('sellerpilot.qoo10_s1_activation_enqueue',true) is distinct from
         new.id::text
       or new.channel <> 'qoo10'
       or new.environment <> 'production'
       or new.status <> 'queued'
       or new.credential_id <>
            '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       or new.listing_id <>
            '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       or new.seller_account_key <>
            '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       or new.write_resource_kind <> 'listing_mutation'
       or new.write_resource_key is null
       or new.request_fingerprint <>
            encode(extensions.digest(new.request_payload::text,'sha256'),'hex')
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}' <>
            'allowed'
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}' <>
            'qoo10_s1_activation_v1'
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}' <>
            new.listing_id::text
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}' <>
            '1217336970'
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,sourceJobId}' <>
            'fac9c5c4-940d-4600-88f3-8f97a069dfbf'
       or new.request_payload#>>'{arguments,params,ItemCode}' <> '1217336970'
       or not exists (
         select 1
           from sellerpilot_private.channel_operation_attempts attempt
           join sellerpilot_private.channel_credentials credential
             on credential.id = attempt.credential_id
           join sellerpilot_private.product_listings listing
             on listing.id = new.listing_id
          where attempt.id = new.attempt_id
            and attempt.owner_id =
                  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
            and attempt.credential_id = new.credential_id
            and attempt.channel = 'qoo10'
            and attempt.operation = 'listing.activate'
            and attempt.status = 'running'
            and attempt.seller_account_key = new.seller_account_key
            and credential.channel = 'qoo10'
            and credential.environment = 'production'
            and credential.status = 'active'
            and credential.seller_account_key = new.seller_account_key
            and credential.seller_account_key_source in (
              'provider_certified_v1','credential_incarnation_v1'
            )
            and listing.remote_id = '1217336970'
            and listing.seller_account_key = new.seller_account_key
       )
    then
      raise exception 'exact Qoo10 S1 activation enqueue lineage invalid'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if old.operation <> 'listing.activate' and new.operation <> 'listing.activate' then
    return new;
  end if;
  if old.operation <> 'listing.activate' or new.operation <> 'listing.activate'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_activation_permits permit
        where permit.activation_job_id = new.id
          and new.credential_id = permit.credential_id
          and new.attempt_id = permit.activation_attempt_id
          and new.listing_id = permit.listing_id
          and new.channel = 'qoo10'
          and new.environment = 'production'
          and new.seller_account_key = permit.seller_account_key
          and new.request_fingerprint = permit.activation_request_sha256
          and octet_length(new.request_payload::text) =
                permit.activation_request_bytes
          and encode(extensions.digest(
                new.request_payload::text,'sha256'
              ),'hex') = permit.activation_request_sha256
          and new.write_resource_kind = 'listing_mutation'
          and new.write_resource_key = permit.write_resource_key
     )
  then
    raise exception 'exact Qoo10 S1 activation job lineage is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_exact_qoo10_s1_activation_job_lineage
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage();

create function sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
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
begin
  if jsonb_typeof(p_old) <> 'object' or jsonb_typeof(p_new) <> 'object'
     or p_old->>'status' <> 'queued' or p_new->>'status' <> 'running'
     or p_old->>'operation' <> 'listing.activate'
     or p_new->>'operation' <> 'listing.activate'
     or p_old->>'channel' <> 'qoo10' or p_new->>'channel' <> 'qoo10'
     or p_old->>'environment' <> 'production'
     or p_new->>'environment' <> 'production'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_new->'credential_id' is distinct from p_old->'credential_id'
     or p_new->'attempt_id' is distinct from p_old->'attempt_id'
     or p_new->'listing_id' is distinct from p_old->'listing_id'
     or p_new->'seller_account_key' is distinct from p_old->'seller_account_key'
     or p_new->'request_payload' is distinct from p_old->'request_payload'
     or p_new->'request_fingerprint' is distinct from p_old->'request_fingerprint'
     or p_new->'write_resource_kind' is distinct from p_old->'write_resource_kind'
     or p_new->'write_resource_key' is distinct from p_old->'write_resource_key'
     or (p_old->>'attempt_count')::integer <> 0
     or (p_new->>'attempt_count')::integer <> 1
     or p_old->'worker_token_id' <> 'null'::jsonb
     or p_old->'claim_token' <> 'null'::jsonb
     or p_old->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'provider_mutation_started_at' <> 'null'::jsonb
  then return false; end if;
  v_job_id := (p_new->>'id')::uuid;
  update sellerpilot_private.qoo10_exact_s1_activation_permits permit
     set bound_at = clock_timestamp(),
         bound_worker_token_id = (p_new->>'worker_token_id')::uuid,
         bound_claim_token = (p_new->>'claim_token')::uuid
   where permit.activation_job_id = v_job_id
     and permit.bound_at is null and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and permit.credential_id = (p_new->>'credential_id')::uuid
     and permit.activation_attempt_id = (p_new->>'attempt_id')::uuid
     and permit.listing_id = (p_new->>'listing_id')::uuid
     and permit.seller_account_key = p_new->>'seller_account_key'
     and p_new->>'write_resource_kind' = 'listing_mutation'
     and permit.write_resource_key = p_new->>'write_resource_key'
     and permit.activation_request_sha256 = p_new->>'request_fingerprint'
     and octet_length((p_new->'request_payload')::text) =
           permit.activation_request_bytes
     and encode(extensions.digest(
           (p_new->'request_payload')::text,'sha256'
         ),'hex') = permit.activation_request_sha256
     and permit.release_sha = (
       select run.release_sha
         from sellerpilot_private.qoo10_exact_s1_verifier_runs run
        where run.verifier_job_id = permit.verifier_job_id
     )
     and sellerpilot_private.qoo10_exact_s1_release_is_current(permit.release_sha)
     and sellerpilot_private.qoo10_exact_s1_source_is_current();
  return found;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
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
      from sellerpilot_private.qoo10_exact_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
      join sellerpilot_private.qoo10_exact_s1_observations observation
        on observation.verifier_job_id = permit.verifier_job_id
     where permit.activation_job_id = p_job_id
       and permit.bound_claim_token = p_claim_token
       and permit.bound_worker_token_id = job.worker_token_id
       and permit.bound_at is not null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and job.status = 'running'
       and job.operation = 'listing.activate'
       and job.channel = 'qoo10'
       and job.environment = 'production'
       and job.credential_id = permit.credential_id
       and job.attempt_id = permit.activation_attempt_id
       and job.listing_id = permit.listing_id
       and job.seller_account_key = permit.seller_account_key
       and job.write_resource_kind = 'listing_mutation'
       and job.write_resource_key = permit.write_resource_key
       and job.claim_token = p_claim_token
       and job.attempt_count = 1
       and job.lease_expires_at > statement_timestamp()
       and job.completed_at is null
       and job.response_payload is null
       and job.provider_mutation_started_at is null
       and permit.consumed_at is null
       and job.request_fingerprint = permit.activation_request_sha256
       and octet_length(job.request_payload::text) = permit.activation_request_bytes
       and encode(extensions.digest(job.request_payload::text,'sha256'),'hex') =
             permit.activation_request_sha256
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,verifierJobId}' =
             permit.verifier_job_id::text
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,verifierResponseSha256}' =
             observation.verifier_response_sha256
       and sellerpilot_private.qoo10_exact_s1_release_is_current(permit.release_sha)
       and sellerpilot_private.qoo10_exact_s1_source_is_current()
  )
$$;

create function sellerpilot_private.consume_exact_qoo10_s1_activation_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.qoo10_exact_s1_activation_permits permit
     set consumed_at = clock_timestamp()
   where permit.activation_job_id = p_job_id
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = permit.activation_job_id
          and job.status = 'running'
          and job.claim_token = permit.bound_claim_token
          and job.worker_token_id = permit.bound_worker_token_id
          and job.provider_mutation_started_at is not null
          and job.completed_at is null
     );
  return found;
end;
$$;

create or replace function sellerpilot_private.block_closed_listing_mutation_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'queued' and new.status = 'running'
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
       or sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- A two-minute observation must not leave an unclaimable mutation at the head
-- of either worker queue.  Only a never-claimed, never-started activation can
-- be expired.  Its permit remains as audit evidence but is invalidated so a
-- new verifier observation may arm a different one-shot job.
create function sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
begin
  -- Ordinary channel claims must not contend on the recovery lock.  Take the
  -- global lock only when an exact, safely terminalizable activation is
  -- already visible; the locked CTE below rechecks every predicate before it
  -- changes anything.
  if not exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.activation_attempt_id
     where permit.invalidated_at is null
       and permit.expires_at <= statement_timestamp()
       and permit.bound_at is null
       and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null
       and permit.consumed_at is null
       and job.status = 'queued'
       and job.operation = 'listing.activate'
       and job.channel = 'qoo10'
       and job.worker_token_id is null
       and job.claim_token is null
       and job.attempt_count = 0
       and job.started_at is null
       and job.lease_expires_at is null
       and job.provider_mutation_started_at is null
       and job.response_payload is null
       and job.completed_at is null
       and attempt.status = 'running'
       and attempt.operation = 'listing.activate'
  ) then
    return 0;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  with expired as (
    select permit.activation_job_id,permit.activation_attempt_id
      from sellerpilot_private.qoo10_exact_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.activation_attempt_id
     where permit.invalidated_at is null
       and permit.expires_at <= statement_timestamp()
       and permit.bound_at is null
       and permit.bound_worker_token_id is null
       and permit.bound_claim_token is null
       and permit.consumed_at is null
       and job.status = 'queued'
       and job.operation = 'listing.activate'
       and job.channel = 'qoo10'
       and job.worker_token_id is null
       and job.claim_token is null
       and job.attempt_count = 0
       and job.started_at is null
       and job.lease_expires_at is null
       and job.provider_mutation_started_at is null
       and job.response_payload is null
       and job.completed_at is null
       and attempt.status = 'running'
       and attempt.operation = 'listing.activate'
     for update of permit,job,attempt
  ), invalidated as (
    update sellerpilot_private.qoo10_exact_s1_activation_permits permit
       set invalidated_at = clock_timestamp(),
           invalidation_reason = 'expired_before_claim'
      from expired
     where permit.activation_job_id = expired.activation_job_id
     returning permit.activation_job_id,permit.activation_attempt_id
  ), failed_jobs as (
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed',
           error_message =
             'Exact Qoo10 S1 activation observation expired before claim; no provider mutation was started.',
           completed_at = clock_timestamp(),
           updated_at = clock_timestamp()
      from invalidated
     where job.id = invalidated.activation_job_id
       and job.status = 'queued'
     returning invalidated.activation_attempt_id
  )
  update sellerpilot_private.channel_operation_attempts attempt
     set status = 'failed',
         http_status = 409,
         safe_message =
           'Exact Qoo10 S1 activation observation expired before claim; no provider mutation was started.',
         completed_at = clock_timestamp()
    from failed_jobs
   where attempt.id = failed_jobs.activation_attempt_id
     and attempt.status = 'running';
  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

-- Preserve the deployed claim functions' full lock/parallelism/OAuth fences.
-- Inject cleanup only after each function's existing token check and before it
-- can select a queued row; invalid callers therefore cannot mutate the queue.
do $qoo10_exact_s1_claim_expiry_patch$
declare
  v_definition text;
  v_rewritten text;
  v_marker text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_channel_gateway_job(text,text)'::regprocedure
  ) into v_definition;
  v_marker := '  return public.sellerpilot_260826_claim_gateway_unscoped(';
  v_rewritten := pg_catalog.replace(
    v_definition,v_marker,
    '  perform sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim();'
      || chr(10) || v_marker
  );
  if v_rewritten = v_definition then
    raise exception 'local gateway claim cleanup insertion point changed'
      using errcode = '55000';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(
    v_definition,
    '  -- Keep ordinary channel drains on the deployed parallel claimant'
  ) > 0 then
    v_marker := '  -- Keep ordinary channel drains on the deployed parallel claimant';
  elsif pg_catalog.strpos(
    v_definition,
    '  -- Opportunistically recover expired leases before applying the running-job'
  ) > 0 then
    -- The partial migration replay exercises the immediately preceding bounded
    -- parallel claimant.  Inject at the equivalent post-auth/pre-selection
    -- point without replacing any of its concurrency behavior.
    v_marker := '  -- Opportunistically recover expired leases before applying the running-job';
  else
    raise exception 'serverless gateway claim cleanup insertion point changed'
      using errcode = '55000';
  end if;
  v_rewritten := pg_catalog.replace(
    v_definition,v_marker,
    '  perform sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim();'
      || chr(10) || chr(10) || v_marker
  );
  execute v_rewritten;
end;
$qoo10_exact_s1_claim_expiry_patch$;

-- Wrap both local and serverless provider boundaries.  The renamed functions
-- keep every existing fence, but are no longer callable by service_role.
alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_056700_begin_gateway_before_qoo10_s1_activation;
revoke all on function
  public.sellerpilot_056700_begin_gateway_before_qoo10_s1_activation(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select operation into v_operation
    from sellerpilot_private.channel_gateway_jobs where id = p_job_id;
  if v_operation = 'listing.activate'
     and not sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
       p_job_id,p_claim_token
     ) then return false; end if;
  v_started :=
    public.sellerpilot_056700_begin_gateway_before_qoo10_s1_activation(
      p_token_hash,p_job_id,p_claim_token
    );
  if v_operation = 'listing.activate' and v_started
     and not sellerpilot_private.consume_exact_qoo10_s1_activation_provider(
       p_job_id,p_claim_token
     ) then
    raise exception 'exact Qoo10 S1 activation permit consumption failed'
      using errcode = '40001';
  end if;
  return v_started;
end;
$$;

do $serverless_activation_wrapper$
begin
  if to_regprocedure(
    'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
  ) is null then return; end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_056700_begin_serverless_before_qoo10_s1_activation';
  execute 'revoke all on function public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation(text,uuid,uuid) from public, anon, authenticated, service_role';
  execute $function$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path = '' as $body$
    declare v_operation text; v_started boolean;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
      select operation into v_operation
        from sellerpilot_private.channel_gateway_jobs where id = p_job_id;
      if v_operation = 'listing.activate'
         and not sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
           p_job_id,p_claim_token
         ) then return false; end if;
      v_started :=
        public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation(
          p_token_hash,p_job_id,p_claim_token
        );
      if v_operation = 'listing.activate' and v_started
         and not sellerpilot_private.consume_exact_qoo10_s1_activation_provider(
           p_job_id,p_claim_token
         ) then
        raise exception 'exact Qoo10 S1 activation permit consumption failed'
          using errcode = '40001';
      end if;
      return v_started;
    end;
    $body$
  $function$;
  execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) from public, anon, authenticated';
  execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role';
end;
$serverless_activation_wrapper$;

-- Add listing.activate to the serverless dispatch allowlist without relaxing
-- any other operation/channel pair.
alter function sellerpilot_private.serverless_gateway_job_allowed(text,text)
  rename to serverless_gateway_job_allowed_before_qoo10_s1_activation;
create function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,p_operation text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_operation = 'listing.activate'
    then p_channel = 'qoo10'
    else sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(
      p_channel,p_operation
    ) end
$$;

create function sellerpilot_private.qoo10_exact_s1_activation_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_job_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_state jsonb;
  v_expected jsonb;
  v_resources jsonb;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if coalesce(p_job_id,'') !~ '^[0-9a-f-]{36}$' then return false; end if;
  select job.*, outcome.activation_response_sha256
    into v_job
    from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = outcome.activation_job_id
   where outcome.activation_job_id = p_job_id::uuid
     and outcome.listing_id = (p_new->>'id')::uuid
     and outcome.terminal_status = 'succeeded'
     and outcome.provider_status = 'S2'
     and outcome.remote_visibility = 'live'
     and job.status = 'succeeded'
     and job.channel = 'qoo10'
     and job.operation = 'listing.activate'
     and job.listing_id = outcome.listing_id
     and job.response_payload->>'ok' = 'true'
     and job.response_payload->>'remoteId' = outcome.remote_id
     and job.response_payload#>>'{remoteState,verified}' = 'true'
     and job.response_payload#>>'{remoteState,providerStatus}' = 'S2'
     and job.response_payload#>>'{remoteState,visibility}' = 'live'
     and encode(extensions.digest(job.response_payload::text,'sha256'),'hex') =
           outcome.activation_response_sha256;
  if not found then return false; end if;

  v_state := v_job.response_payload->'remoteState';
  begin
    v_verified_at := (v_state->>'verifiedAt')::timestamptz;
    v_created_at := nullif(v_state->>'createdAt','')::timestamptz;
    v_updated_at := (p_new->>'updated_at')::timestamptz;
  exception when others then
    return false;
  end;
  if v_verified_at is null
     or v_verified_at < v_job.provider_mutation_started_at
     or v_verified_at > v_job.completed_at + interval '1 minute'
     or v_updated_at < v_job.completed_at
     or v_updated_at > clock_timestamp() + interval '1 minute'
  then return false; end if;

  v_resources := jsonb_build_object(
    'resources',v_state->'resources',
    'verification',jsonb_build_object(
      'verifiedAt',to_jsonb(v_verified_at),
      'evidence',v_state->'evidence',
      'locale',v_state->>'locale',
      'fingerprint',v_state->>'fingerprint',
      'imageCount',(v_state->>'imageCount')::integer
    )
  );
  v_expected := p_old || jsonb_build_object(
    'status','published',
    'remote_visibility','live',
    'provider_status','S2',
    'remote_resources',v_resources,
    'remote_created_at',to_jsonb(coalesce(
      v_created_at,nullif(p_old->>'remote_created_at','')::timestamptz
    )),
    'published_at',to_jsonb(coalesce(
      nullif(p_old->>'published_at','')::timestamptz,v_verified_at
    )),
    'last_verified_at',to_jsonb(v_verified_at),
    'last_error','null'::jsonb,
    'failure_class','null'::jsonb,
    'updated_at',p_new->'updated_at'
  );
  return p_old->>'id' = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
    and p_old->>'owner_id' = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'
    and p_old->>'product_id' = 'ddccde35-9c58-4856-b673-d7aa27ce4220'
    and p_old->>'channel_key' = 'qoo10'
    and p_old->>'market' = 'JP'
    and p_old->>'target_id' = ''
    and p_old->>'remote_id' = '1217336970'
    and p_old->>'status' = 'failed'
    and p_old->>'failure_class' = 'external_action'
    and p_old->>'remote_visibility' = 'unknown'
    and p_old->>'requested_publication_intent' = 'live'
    and p_old->>'seller_account_key' = v_job.seller_account_key
    and p_new = v_expected;
exception when others then
  return false;
end;
$$;

do $qoo10_exact_s1_listing_guard_patch$
declare
  v_definition text;
  v_before text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_exact_adultyn_rejection_job'', true), '''') is not null then';
  v_after text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_s1_activation_apply'', true), '''') is not null then
    if not sellerpilot_private.qoo10_exact_s1_activation_listing_update_allowed(
      to_jsonb(old),to_jsonb(new),
      current_setting(''sellerpilot.qoo10_s1_activation_apply'', true)
    ) then
      raise exception ''invalid exact Qoo10 S1 activation listing update'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_exact_adultyn_rejection_job'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.qoo10_s1_activation_apply') = 0 then
    if pg_catalog.strpos(v_definition,v_before) = 0 then
      raise exception 'product listing exact Qoo10 activation guard entry not found'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition,v_before,v_after);
  end if;
end;
$qoo10_exact_s1_listing_guard_patch$;

create function sellerpilot_private.apply_exact_qoo10_s1_activation_listing(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_state jsonb;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_resources jsonb;
  v_rows integer;
begin
  select job.* into v_job
    from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = outcome.activation_job_id
   where outcome.activation_job_id = p_job_id
     and outcome.terminal_status = 'succeeded'
     and outcome.provider_status = 'S2'
     and outcome.remote_visibility = 'live'
     and job.status = 'succeeded'
     and encode(extensions.digest(job.response_payload::text,'sha256'),'hex') =
           outcome.activation_response_sha256;
  if not found then return false; end if;
  v_state := v_job.response_payload->'remoteState';
  begin
    v_verified_at := (v_state->>'verifiedAt')::timestamptz;
    v_created_at := nullif(v_state->>'createdAt','')::timestamptz;
  exception when others then
    return false;
  end;
  v_resources := jsonb_build_object(
    'resources',v_state->'resources',
    'verification',jsonb_build_object(
      'verifiedAt',to_jsonb(v_verified_at),
      'evidence',v_state->'evidence',
      'locale',v_state->>'locale',
      'fingerprint',v_state->>'fingerprint',
      'imageCount',(v_state->>'imageCount')::integer
    )
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_s1_activation_apply',p_job_id::text,true
  );
  update sellerpilot_private.product_listings listing
     set status = 'published',
         remote_visibility = 'live',
         provider_status = 'S2',
         remote_resources = v_resources,
         remote_created_at = coalesce(v_created_at,listing.remote_created_at),
         published_at = coalesce(listing.published_at,v_verified_at),
         last_verified_at = v_verified_at,
         last_error = null,
         failure_class = null,
         updated_at = clock_timestamp()
   where listing.id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and listing.status = 'failed'
     and listing.remote_visibility = 'unknown'
     and listing.failure_class = 'external_action'
     and listing.remote_id = '1217336970'
     and listing.requested_publication_intent = 'live'
     and listing.seller_account_key = v_job.seller_account_key;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create function sellerpilot_private.record_exact_qoo10_s1_activation_outcome(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.qoo10_exact_s1_activation_permits%rowtype;
  v_observation_expectation jsonb;
  v_source_arguments jsonb;
  v_verified_at timestamptz;
  v_valid_s2 boolean := false;
  v_explicit_no_write boolean := false;
  v_reconciliation_evidence boolean := false;
  v_pre_provider_failure boolean := false;
  v_payloadless_reconciliation boolean := false;
  v_terminal_status text;
begin
  select * into v_permit
    from sellerpilot_private.qoo10_exact_s1_activation_permits permit
   where permit.activation_job_id = p_job_id
     and permit.invalidated_at is null;
  if not found then return false; end if;
  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs job where job.id = p_job_id;
  select source.request_payload->'arguments' into strict v_source_arguments
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = v_permit.source_job_id;
  select observation.activation_expectation into strict v_observation_expectation
    from sellerpilot_private.qoo10_exact_s1_observations observation
   where observation.verifier_job_id = v_permit.verifier_job_id;
  if exists (
    select 1
      from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
     where outcome.activation_job_id = v_job.id
       and outcome.activation_response_sha256 is not distinct from
           case when v_job.response_payload is null then null else
             encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex') end
       and outcome.activation_response_bytes is not distinct from
           case when v_job.response_payload is null then null else
             octet_length(v_job.response_payload::text) end
  ) then return true; end if;
  if v_job.status not in ('succeeded','failed','reconciliation_required')
     or v_job.completed_at is null or v_permit.consumed_at is null
     or not sellerpilot_private.qoo10_exact_s1_source_is_current()
     or not exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_job.id
          and receipt.claim_token = v_permit.bound_claim_token
          and receipt.worker_token_id = v_permit.bound_worker_token_id
     )
  then
    -- A claimed activation may fail safely before crossing the provider
    -- boundary.  It has no remote outcome and must terminalize without
    -- consuming the one-shot permit or changing the listing.
    if not (
      v_job.status = 'failed'
      and v_job.completed_at is not null
      and v_permit.consumed_at is null
      and v_job.provider_mutation_started_at is null
      and v_job.response_payload is null
      and sellerpilot_private.qoo10_exact_s1_source_is_current()
      and exists (
        select 1 from sellerpilot_private.gateway_completion_receipts receipt
         where receipt.job_id = v_job.id
           and receipt.claim_token = v_permit.bound_claim_token
           and receipt.worker_token_id = v_permit.bound_worker_token_id
      )
    ) then return false; end if;
  end if;

  v_pre_provider_failure :=
    v_job.status = 'failed'
    and v_job.provider_mutation_started_at is null
    and v_permit.consumed_at is null
    and v_job.response_payload is null;
  v_payloadless_reconciliation :=
    v_job.status = 'reconciliation_required'
    and v_job.provider_mutation_started_at is not null
    and v_permit.consumed_at is not null
    and v_job.response_payload is null;

  if v_job.response_payload is not null then
    begin
      v_valid_s2 :=
      jsonb_typeof(v_job.response_payload->'steps') = 'array'
      and jsonb_array_length(v_job.response_payload->'steps') = 2
      and v_job.response_payload#>>'{steps,0,name}' = 'qoo10-s1-activation'
      and v_job.response_payload#>>'{steps,1,name}' =
            'qoo10-s1-activation-post-readback'
      and v_job.response_payload#>>'{steps,0,ok}' = 'true'
      and (v_job.response_payload#>>'{steps,0,status}')::integer
            between 200 and 299
      and (v_job.response_payload#>'{steps,0,data}') ? 'ResultCode'
      and v_job.response_payload#>>'{steps,0,data,ResultCode}' = '0'
      and sellerpilot_private.qoo10_exact_response_state_valid(
        v_job.response_payload,'listing.activate',
        'qoo10-s1-activation-post-readback','S2','live',v_source_arguments
      )
      and sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(
        v_job.response_payload,v_job.request_payload,v_observation_expectation,
        'qoo10-s1-activation-post-readback'
      );
      v_explicit_no_write :=
        v_job.status = 'succeeded'
      and v_job.response_payload->>'ok' = 'false'
      and jsonb_typeof(v_job.response_payload->'steps') = 'array'
      and jsonb_array_length(v_job.response_payload->'steps') = 2
      and v_job.response_payload#>>'{steps,0,name}' = 'qoo10-s1-activation'
      and v_job.response_payload#>>'{steps,1,name}' =
            'qoo10-s1-activation-post-readback'
      and v_job.response_payload#>>'{steps,0,ok}' = 'false'
      and (v_job.response_payload#>>'{steps,0,status}')::integer
            between 200 and 299
      and coalesce(v_job.response_payload#>>'{steps,0,data,ResultCode}','')
            ~ '^-?[1-9][0-9]*$'
      and v_job.response_payload#>>'{steps,0,data,sellerpilotNoWriteConfirmed}' =
            'true'
        and sellerpilot_private.qoo10_exact_response_state_valid(
          jsonb_set(v_job.response_payload,'{ok}','true'::jsonb,true),
          'listing.activate','qoo10-s1-activation-post-readback',
          'S1','non_public',v_source_arguments
        )
        and sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(
          v_job.response_payload,v_job.request_payload,v_observation_expectation,
          'qoo10-s1-activation-post-readback'
        );
      v_reconciliation_evidence :=
        jsonb_typeof(v_job.response_payload->'steps') = 'array'
        and exists (
          select 1
            from jsonb_array_elements(v_job.response_payload->'steps') step
           where step#>>'{data,sellerpilotReconciliationRequired}' = 'true'
        );
    exception when others then
      v_valid_s2 := false;
      v_explicit_no_write := false;
    end;
  end if;

  if v_job.status = 'succeeded' and v_valid_s2 then
    v_terminal_status := 'succeeded';
  elsif v_job.status = 'succeeded' and v_explicit_no_write then
    -- The worker transport retains the exact S1 response as a succeeded
    -- envelope; the recovery ledger derives the business outcome as failed.
    v_terminal_status := 'failed';
  elsif v_pre_provider_failure then
    v_terminal_status := 'failed';
  elsif v_job.status = 'reconciliation_required'
        and v_job.provider_mutation_started_at is not null
        and v_permit.consumed_at is not null
        and (v_payloadless_reconciliation or v_reconciliation_evidence) then
    v_terminal_status := 'reconciliation_required';
  else
    raise exception 'exact Qoo10 activation terminal evidence invalid'
      using errcode = '55000';
  end if;
  if v_valid_s2 then
    v_verified_at :=
      (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
  end if;

  insert into sellerpilot_private.qoo10_exact_s1_activation_outcomes (
    activation_job_id,source_job_id,verifier_job_id,listing_id,remote_id,
    terminal_status,activation_response_sha256,activation_response_bytes,
    provider_status,remote_visibility,verified_at,completed_at,contract
  ) values (
    v_job.id,v_permit.source_job_id,v_permit.verifier_job_id,v_permit.listing_id,
    v_permit.remote_id,v_terminal_status,
    case when v_job.response_payload is null then null else
      encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex') end,
    case when v_job.response_payload is null then null else
      octet_length(v_job.response_payload::text) end,
    case when v_valid_s2 then 'S2' when v_explicit_no_write then 'S1' end,
    case when v_valid_s2 then 'live' when v_explicit_no_write then 'non_public' end,
    v_verified_at,v_job.completed_at,'qoo10_exact_s1_activation_outcome_v1'
  ) on conflict (activation_job_id) do nothing;
  if v_valid_s2
     and not sellerpilot_private.apply_exact_qoo10_s1_activation_listing(v_job.id)
  then
    raise exception 'exact Qoo10 S1 activation listing projection failed'
      using errcode = '55000';
  end if;
  return found or exists (
    select 1 from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
     where outcome.activation_job_id = v_job.id
       and outcome.terminal_status = v_terminal_status
       and outcome.activation_response_sha256 is not distinct from
           case when v_job.response_payload is null then null else
             encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex') end
       and outcome.activation_response_bytes is not distinct from
           case when v_job.response_payload is null then null else
             octet_length(v_job.response_payload::text) end
  );
end;
$$;

-- Completion receipts are inserted inside this transaction.  The wrapper
-- records immutable read/write evidence only after the existing completion
-- implementation and every existing side effect has succeeded.
alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_056700_complete_gateway_before_qoo10_s1_activation;
revoke all on function
  public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_response_payload jsonb default null,p_error_message text default null,
  p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_operation text;
begin
  v_result := public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(
    p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
    p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
  );
  if v_result->>'status' not in ('completed','completed_replay') then
    return v_result;
  end if;
  select operation into v_operation
    from sellerpilot_private.channel_gateway_jobs where id = p_job_id;
  if v_operation = 'listing.publication.verify'
     and exists (
       select 1 from sellerpilot_private.qoo10_exact_s1_verifier_runs
        where verifier_job_id = p_job_id
     ) then
    perform sellerpilot_private.record_exact_qoo10_s1_observation(p_job_id);
  elsif v_operation = 'listing.activate' then
    if not sellerpilot_private.record_exact_qoo10_s1_activation_outcome(p_job_id) then
      raise exception 'exact Qoo10 activation completion was not recorded'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

create function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(
  p_source_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_source_job_id = 'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
    and exists (
      select 1
        from sellerpilot_private.qoo10_exact_s1_activation_outcomes outcome
        join sellerpilot_private.channel_gateway_jobs activation
          on activation.id = outcome.activation_job_id
        join sellerpilot_private.channel_gateway_jobs source
          on source.id = outcome.source_job_id
       where outcome.source_job_id = p_source_job_id
         and outcome.terminal_status = 'succeeded'
         and outcome.provider_status = 'S2'
         and outcome.remote_visibility = 'live'
         and activation.status = 'succeeded'
         and activation.operation = 'listing.activate'
         and source.status = 'reconciliation_required'
         and encode(extensions.digest(source.response_payload::text,'sha256'),'hex') =
               'b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768'
    )
$$;

-- Keep the source job's terminal history immutable.  The release gate may
-- discount that one reconciliation only after the activation outcome ledger
-- proves an exact S2/live readback.  All other reconciliation rows retain the
-- existing blocking behavior.  Patch the current post-image instead of
-- copying these large release-gate functions and silently dropping a later
-- safety check.
do $qoo10_exact_s1_gate_patch$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)'::regprocedure
  ) into v_definition;
  v_rewritten := pg_catalog.replace(
    v_definition,
    $needle$where job.operation in ('listing.create', 'listing.update', 'listing.stop');$needle$,
    $replacement$where job.operation in ('listing.create', 'listing.update', 'listing.stop')
     and (
       job.status <> 'reconciliation_required'
       or not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
     );$replacement$
  );
  if v_rewritten = v_definition then
    raise exception 'global listing release-gate post-image changed'
      using errcode = '55000';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure
  ) into v_definition;
  v_rewritten := pg_catalog.replace(
    v_definition,
    $needle$where job.channel = p_channel
     and job.operation in ('listing.create', 'listing.update', 'listing.stop');$needle$,
    $replacement$where job.channel = p_channel
     and job.operation in ('listing.create', 'listing.update', 'listing.stop')
     and (
       job.status <> 'reconciliation_required'
       or not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
     );$replacement$
  );
  if v_rewritten = v_definition then
    raise exception 'scoped listing release-gate post-image changed'
      using errcode = '55000';
  end if;
  execute v_rewritten;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
  ) into v_definition;
  v_rewritten := pg_catalog.replace(
    v_definition,
    $needle$and job.status = 'reconciliation_required'
      ),$needle$,
    $replacement$and job.status = 'reconciliation_required'
           and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
      ),$replacement$
  );
  if v_rewritten = v_definition then
    raise exception 'listing release-gate status post-image changed'
      using errcode = '55000';
  end if;
  execute v_rewritten;

  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)'::regprocedure
     ), 'qoo10_exact_s1_source_reconciliation_resolved') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure
     ), 'qoo10_exact_s1_source_reconciliation_resolved') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
     ), 'qoo10_exact_s1_source_reconciliation_resolved') = 0
  then
    raise exception 'exact Qoo10 S1 gate exception patch was not installed'
      using errcode = '55000';
  end if;
end;
$qoo10_exact_s1_gate_patch$;

revoke all on function sellerpilot_private.block_qoo10_exact_s1_immutable_ledger_change(),
  sellerpilot_private.qoo10_exact_s1_release_is_current(text),
  sellerpilot_private.qoo10_exact_s1_source_is_current(),
  sellerpilot_private.qoo10_exact_remote_items(jsonb,text),
  sellerpilot_private.qoo10_exact_aliases_consistent(jsonb,text[]),
  sellerpilot_private.qoo10_exact_representative_image_matches(text,text),
  sellerpilot_private.qoo10_exact_keyword_matches(text,text,text),
  sellerpilot_private.qoo10_exact_item_matches_source(jsonb,jsonb,text),
  sellerpilot_private.qoo10_exact_response_state_valid(jsonb,text,text,text,text,jsonb),
  sellerpilot_private.qoo10_exact_activation_keyword_binding_valid(jsonb,jsonb,jsonb,text),
  sellerpilot_private.qoo10_exact_hex_codepoint(text),
  sellerpilot_private.qoo10_exact_decode_html(text),
  sellerpilot_private.qoo10_exact_detail_image_urls(text),
  sellerpilot_private.qoo10_exact_activation_expectation_valid(jsonb,jsonb),
  sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage(),
  sellerpilot_private.qoo10_exact_s1_activation_listing_update_allowed(jsonb,jsonb,text),
  sellerpilot_private.apply_exact_qoo10_s1_activation_listing(uuid),
  sellerpilot_private.record_exact_qoo10_s1_observation(uuid),
  sellerpilot_private.bind_exact_qoo10_s1_activation_claim(jsonb,jsonb),
  sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(uuid,uuid),
  sellerpilot_private.consume_exact_qoo10_s1_activation_provider(uuid,uuid),
  sellerpilot_private.expire_exact_qoo10_s1_activation_preclaim(),
  sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid),
  sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(uuid),
  sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(text,text),
  sellerpilot_private.serverless_gateway_job_allowed(text,text)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text),
  public.sellerpilot_service_enqueue_exact_qoo10_s1_activation(uuid,text),
  public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ) from public, anon, authenticated;

grant execute on function
  public.sellerpilot_service_enqueue_exact_qoo10_s1_verifier(uuid,text),
  public.sellerpilot_service_enqueue_exact_qoo10_s1_activation(uuid,text),
  public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ) to service_role;

comment on table sellerpilot_private.qoo10_exact_s1_observations is
  'Immutable fresh S1 readback evidence; never authorizes a provider write by itself.';
comment on table sellerpilot_private.qoo10_exact_s1_activation_permits is
  'One job/claim/provider-boundary permit for EditGoodsStatus(S2), expiring two minutes after verifier completion.';
comment on function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(uuid) is
  'Exact gate exception predicate; the fac9 source history remains reconciliation_required and is superseded only by an immutable S2 activation outcome.';

commit;
