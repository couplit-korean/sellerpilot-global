-- Recover the one Lotte Qoo10 JP listing whose create/update already wrote
-- UpdateGoods and EditGoodsContents (ResultCode 0) while ShippingNo 0 was
-- normalized by the provider to 806971.  Source and update jobs stay
-- byte-immutable.  Recovery is forward-only: one read-only
-- listing.publication.verify, then one single-use listing.activate whose
-- expectedState.shippingNo is the observed 806971, then a GUC-gated listing
-- apply from the current failed/external_action preimage after a strict
-- S2/live outcome.  Deterministic schema replay with no production rows is a
-- no-op besides installing the contract.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500030);

do $qoo10_shipping_s1_history_fence$
declare
  v_history_table regclass;
begin
  v_history_table := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  if v_history_table is not null then
    execute 'lock table supabase_migrations.schema_migrations in share mode';
    if exists (
      select 1 from supabase_migrations.schema_migrations migration
       where migration.version = '20260905003000'
    ) then
      raise exception 'exact Qoo10 shipping S1 migration already applied'
        using errcode = '55000';
    end if;
  end if;
end;
$qoo10_shipping_s1_history_fence$;

lock table sellerpilot_private.channel_gateway_jobs,
  sellerpilot_private.channel_operation_attempts,
  sellerpilot_private.product_listings
  in share row exclusive mode;

create table sellerpilot_private.qoo10_shipping_s1_source_observations (
  observation_id uuid primary key default gen_random_uuid(),
  create_job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  update_job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  product_id uuid not null
    references sellerpilot_private.products(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  remote_id text not null,
  requested_shipping_no text not null,
  observed_shipping_no text not null,
  create_request_sha256 text not null,
  create_response_sha256 text not null,
  update_request_sha256 text not null,
  update_response_sha256 text not null,
  observation jsonb not null,
  contract text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint qoo10_shipping_s1_source_observation_ids_check check (
    create_job_id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid
    and update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
    and listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and remote_id = '1217536689'
    and requested_shipping_no = '0'
    and observed_shipping_no = '806971'
    and create_request_sha256 =
          'afb9623fc3892fc7a387ba46dc3a06c58ed0e7707a634fb5cd6dc50eeb133cec'
    and create_response_sha256 =
          '11c202e9c52146c42094dddf19fae7d494bc66c9c7949ecc0bbc9f528105893a'
    and update_request_sha256 =
          'e59ea7c11a9e47b1f365e512e2df2c57270395134c94bf9cf0014fb872bc7eb3'
    and update_response_sha256 =
          'df728f98d58e319bdce5d18e2503a03d78b40cfd923966a0416fb77363fcd6ee'
    and jsonb_typeof(observation) = 'object'
    and contract = 'qoo10_shipping_s1_source_observation_v1'
  )
);

create unique index qoo10_shipping_s1_one_source_observation
  on sellerpilot_private.qoo10_shipping_s1_source_observations(create_job_id, update_job_id);

create table sellerpilot_private.qoo10_shipping_s1_verifier_runs (
  verifier_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  source_observation_id uuid not null
    references sellerpilot_private.qoo10_shipping_s1_source_observations(observation_id)
    on delete restrict,
  create_job_id uuid not null,
  update_job_id uuid not null,
  listing_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  remote_id text not null,
  seller_account_key text not null,
  release_sha text not null,
  contract text not null,
  queued_at timestamptz not null,
  constraint qoo10_shipping_s1_verifier_ids_check check (
    create_job_id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid
    and update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
    and listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and remote_id = '1217536689'
    and release_sha ~ '^[a-f0-9]{40}$'
    and contract = 'qoo10_shipping_s1_verifier_v1'
  )
);

create table sellerpilot_private.qoo10_shipping_s1_observations (
  verifier_job_id uuid primary key
    references sellerpilot_private.qoo10_shipping_s1_verifier_runs(verifier_job_id)
    on delete restrict,
  source_observation_id uuid not null,
  create_job_id uuid not null,
  update_job_id uuid not null,
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
  constraint qoo10_shipping_s1_observation_check check (
    create_job_id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid
    and update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
    and listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and remote_id = '1217536689'
    and release_sha ~ '^[a-f0-9]{40}$'
    and verifier_response_sha256 ~ '^[a-f0-9]{64}$'
    and verifier_response_bytes between 100 and 1000000
    and jsonb_typeof(activation_expectation) = 'object'
    and activation_expectation#>>'{expectedState,shippingNo}' = '806971'
    and provider_status = 'S1'
    and remote_visibility = 'non_public'
    and verifier_completed_at >= verified_at
    and verifier_completed_at <= verified_at + interval '5 minutes'
    and contract = 'qoo10_shipping_s1_observation_v1'
  )
);

create table sellerpilot_private.qoo10_shipping_s1_activation_permits (
  activation_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  activation_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  verifier_job_id uuid not null unique
    references sellerpilot_private.qoo10_shipping_s1_observations(verifier_job_id)
    on delete restrict,
  create_job_id uuid not null,
  update_job_id uuid not null,
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
  constraint qoo10_shipping_s1_activation_target_check check (
    create_job_id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid
    and update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
    and listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and credential_id = '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and remote_id = '1217536689'
    and release_sha ~ '^[a-f0-9]{40}$'
    and activation_request_sha256 ~ '^[a-f0-9]{64}$'
    and activation_request_bytes between 100 and 128000
    and write_resource_key ~ '^[a-f0-9]{64}$'
    and contract = 'qoo10_shipping_s1_activation_permit_v1'
  ),
  constraint qoo10_shipping_s1_activation_fresh_check check (
    expires_at > armed_at and expires_at <= armed_at + interval '2 minutes'
  ),
  constraint qoo10_shipping_s1_activation_binding_check check (
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
      and consumed_at is null
      and invalidation_reason in (
        'expired_before_claim','expired_after_claim','failed_before_provider'
      )
      and (
        (
          invalidation_reason = 'expired_before_claim'
          and bound_at is null and bound_worker_token_id is null
          and bound_claim_token is null
        ) or (
          invalidation_reason in ('expired_after_claim','failed_before_provider')
        )
      )
    )
  )
);

create unique index qoo10_shipping_s1_one_active_listing_permit
  on sellerpilot_private.qoo10_shipping_s1_activation_permits(listing_id)
  where invalidated_at is null;
create unique index qoo10_shipping_s1_one_consumed_listing_permit
  on sellerpilot_private.qoo10_shipping_s1_activation_permits(listing_id)
  where consumed_at is not null;

create table sellerpilot_private.qoo10_shipping_s1_activation_outcomes (
  activation_job_id uuid primary key
    references sellerpilot_private.qoo10_shipping_s1_activation_permits(activation_job_id)
    on delete restrict,
  create_job_id uuid not null,
  update_job_id uuid not null,
  verifier_job_id uuid not null unique,
  listing_id uuid not null,
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
  constraint qoo10_shipping_s1_activation_outcome_check check (
    create_job_id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid
    and update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
    and listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and remote_id = '1217536689'
    and terminal_status in ('succeeded','failed','reconciliation_required')
    and contract = 'qoo10_shipping_s1_activation_outcome_v1'
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

alter table sellerpilot_private.qoo10_shipping_s1_source_observations enable row level security;
alter table sellerpilot_private.qoo10_shipping_s1_verifier_runs enable row level security;
alter table sellerpilot_private.qoo10_shipping_s1_observations enable row level security;
alter table sellerpilot_private.qoo10_shipping_s1_activation_permits enable row level security;
alter table sellerpilot_private.qoo10_shipping_s1_activation_outcomes enable row level security;
revoke all on sellerpilot_private.qoo10_shipping_s1_source_observations,
  sellerpilot_private.qoo10_shipping_s1_verifier_runs,
  sellerpilot_private.qoo10_shipping_s1_observations,
  sellerpilot_private.qoo10_shipping_s1_activation_permits,
  sellerpilot_private.qoo10_shipping_s1_activation_outcomes
  from public, anon, authenticated, service_role;

create function sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'exact Qoo10 shipping S1 evidence is immutable' using errcode = '55000';
end;
$$;

create trigger block_qoo10_shipping_s1_source_observation_change
before update or delete on sellerpilot_private.qoo10_shipping_s1_source_observations
for each row execute function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change();
create trigger block_qoo10_shipping_s1_verifier_run_change
before update or delete on sellerpilot_private.qoo10_shipping_s1_verifier_runs
for each row execute function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change();
create trigger block_qoo10_shipping_s1_observation_change
before update or delete on sellerpilot_private.qoo10_shipping_s1_observations
for each row execute function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change();
create trigger block_qoo10_shipping_s1_activation_outcome_change
before update or delete on sellerpilot_private.qoo10_shipping_s1_activation_outcomes
for each row execute function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change();

create function sellerpilot_private.qoo10_shipping_s1_release_is_current(
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
    and sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10')
          is true,
    false
  )
$$;

create function sellerpilot_private.qoo10_shipping_s1_requested_shipping_no(
  p_request_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    nullif(p_request_payload#>>'{arguments,params,ShippingNo}',''),
    nullif(p_request_payload#>>'{arguments,params,ShippingNO}',''),
    nullif(p_request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}',''),
    ''
  )
$$;

create function sellerpilot_private.qoo10_shipping_s1_has_activation_step(
  p_response jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select exists (
    select 1
      from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
     where lower(coalesce(step->>'name','')) in (
             'qoo10-rollback-recovery-activate',
             'qoo10-s1-activation',
             'editgoodsstatus'
           )
        or lower(coalesce(step->>'name','')) like '%editgoodsstatus%'
        or lower(coalesce(step->>'name','')) like '%s1-activation%'
  )
$$;

create function sellerpilot_private.qoo10_shipping_s1_named_step(
  p_response jsonb,
  p_name text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_step jsonb;
  v_count integer := 0;
  v_status integer;
begin
  select count(*) into v_count
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_name;
  if v_count <> 1 then return null; end if;
  select step into v_step
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_name;
  begin
    v_status := (v_step->>'status')::integer;
  exception when others then
    return null;
  end;
  if v_step->>'ok' is distinct from 'true'
     or v_status not between 200 and 299
     or coalesce(v_step#>>'{data,ResultCode}','') is distinct from '0'
  then
    return null;
  end if;
  return v_step;
exception when others then
  return null;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_named_remote_item(
  p_response jsonb,
  p_name text,
  p_remote_id text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_step jsonb;
  v_item jsonb;
  v_count integer;
begin
  v_step := sellerpilot_private.qoo10_shipping_s1_named_step(p_response, p_name);
  if v_step is null then return null; end if;
  select count(distinct coalesce(item->>'ItemCode', item->>'GdNo', item->>'ItemNo'))
    into v_count
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(v_step#>'{data,ResultObject}', v_step->'data'), p_remote_id
    ) item;
  if v_count is distinct from 1 then return null; end if;
  select item into v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(v_step#>'{data,ResultObject}', v_step->'data'), p_remote_id
    ) item;
  return v_item;
exception when others then
  return null;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_readback_item(
  p_response jsonb,
  p_remote_id text
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    sellerpilot_private.qoo10_shipping_s1_named_remote_item(
      p_response, 'qoo10-rollback-pre-activation-readback', p_remote_id
    ),
    sellerpilot_private.qoo10_shipping_s1_named_remote_item(
      p_response, 'GetItemDetailInfo-publication-readback', p_remote_id
    ),
    sellerpilot_private.qoo10_shipping_s1_named_remote_item(
      p_response, 'GetItemDetailInfo', p_remote_id
    )
  )
$$;

create function sellerpilot_private.qoo10_shipping_s1_observed_shipping_no(
  p_response jsonb,
  p_remote_id text
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_item jsonb;
  v_shipping text;
begin
  v_item := sellerpilot_private.qoo10_shipping_s1_readback_item(
    p_response, p_remote_id
  );
  if v_item is null then return ''; end if;
  v_shipping := coalesce(
    v_item->>'ShippingNo', v_item->>'ShippingNO', v_item->>'DeliveryGroupNo', ''
  );
  return v_shipping;
exception when others then
  return '';
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_step_checks(
  p_response jsonb,
  p_name text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_checks jsonb;
begin
  select count(*) into v_count
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_name;
  if v_count <> 1 then return null; end if;
  select coalesce(
           step#>'{data,sellerpilotPublicationChecks}',
           step->'sellerpilotPublicationChecks'
         )
    into v_checks
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_name;
  if jsonb_typeof(v_checks) is distinct from 'object' or v_checks = '{}'::jsonb then
    return null;
  end if;
  return v_checks;
exception when others then
  return null;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_publication_checks(
  p_response jsonb
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_checks jsonb;
begin
  v_checks := coalesce(
    sellerpilot_private.qoo10_shipping_s1_step_checks(
      p_response, 'qoo10-rollback-pre-activation-readback'
    ),
    sellerpilot_private.qoo10_shipping_s1_step_checks(
      p_response, 'GetItemDetailInfo-publication-readback'
    ),
    sellerpilot_private.qoo10_shipping_s1_step_checks(
      p_response, 'EditGoodsContents'
    )
  );
  if v_checks is null then
    select coalesce(step#>'{data,sellerpilotPublicationChecks}', step->'sellerpilotPublicationChecks')
      into v_checks
      from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
     where jsonb_typeof(coalesce(
             step#>'{data,sellerpilotPublicationChecks}',
             step->'sellerpilotPublicationChecks'
           )) = 'object'
     limit 1;
  end if;
  if v_checks is null and jsonb_typeof(p_response#>'{remoteState,evidence}') = 'object' then
    v_checks := p_response#>'{remoteState,evidence}';
  end if;
  return coalesce(v_checks, '{}'::jsonb);
exception when others then
  return '{}'::jsonb;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_publication_checks_match(
  p_response jsonb,
  p_require_recovery boolean
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_checks jsonb := sellerpilot_private.qoo10_shipping_s1_publication_checks(p_response);
begin
  if jsonb_typeof(v_checks) is distinct from 'object' or v_checks = '{}'::jsonb then
    return false;
  end if;
  if coalesce(v_checks->>'identityVerified','') is distinct from 'true'
     or coalesce(v_checks->>'statusVerified','') is distinct from 'true'
     or coalesce(v_checks->>'sellerCodeVerified','') is distinct from 'true'
     or coalesce(v_checks->>'localeVerified','') is distinct from 'true'
     or coalesce(v_checks->>'fingerprintVerified','') is distinct from 'true'
     or coalesce(v_checks->>'imageCountVerified','') is distinct from 'true'
     or coalesce(v_checks->>'sellerAccountIdentityVerified','') is distinct from 'true'
     or coalesce(v_checks->>'categoryVerified','') is distinct from 'true'
     or coalesce(v_checks->>'titleVerified','') is distinct from 'true'
     or coalesce(v_checks->>'priceQuantityVerified','') is distinct from 'true'
     or coalesce(v_checks->>'representativeImageVerified','') is distinct from 'true'
     or coalesce(v_checks->>'detailImageDigestVerified','') is distinct from 'true'
     or coalesce(v_checks->>'shippingVerified','') is distinct from 'false'
  then
    return false;
  end if;
  if p_require_recovery then
    return coalesce(v_checks->>'recoveryExpectationVerified','') = 'true'
      and coalesce(v_checks->>'retailPriceVerified','') = 'true'
      and coalesce(v_checks->>'sellPriceVerified','') = 'true'
      and coalesce(v_checks->>'quantityVerified','') = 'true'
      and coalesce(v_checks->>'confirmedBiCdnImageVerified','') = 'true'
      and coalesce(v_checks->>'detailImageUrlsVerified','') = 'true';
  end if;
  return true;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_provider_status(
  p_response jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select upper(coalesce(
    nullif(p_response#>>'{remoteState,providerStatus}',''),
    (
      select coalesce(step#>>'{data,providerStatus}', step#>>'{data,ResultObject,ItemStatus}')
        from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
       where coalesce(step#>>'{data,providerStatus}', step#>>'{data,ResultObject,ItemStatus}','') <> ''
       limit 1
    ),
    ''
  ))
$$;

create function sellerpilot_private.qoo10_shipping_s1_single_remote_item(
  p_response jsonb,
  p_remote_id text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_item jsonb;
  v_count integer;
begin
  select count(distinct coalesce(item->>'ItemCode', item->>'GdNo', item->>'ItemNo'))
    into v_count
    from sellerpilot_private.qoo10_exact_remote_items(p_response, p_remote_id) item;
  if v_count is distinct from 1 then
    select count(distinct coalesce(item->>'ItemCode', item->>'GdNo', item->>'ItemNo'))
      into v_count
      from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step,
           sellerpilot_private.qoo10_exact_remote_items(
             coalesce(step#>'{data,ResultObject}', step->'data'), p_remote_id
           ) item;
    if v_count is distinct from 1 then return null; end if;
    select item into v_item
      from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step,
           sellerpilot_private.qoo10_exact_remote_items(
             coalesce(step#>'{data,ResultObject}', step->'data'), p_remote_id
           ) item;
    return v_item;
  end if;
  select item into v_item
    from sellerpilot_private.qoo10_exact_remote_items(p_response, p_remote_id) item;
  return v_item;
exception when others then
  return null;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
  p_create_request jsonb,
  p_create_response jsonb,
  p_update_request jsonb,
  p_update_response jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_create_item jsonb;
  v_update_item jsonb;
  v_create_observed text;
  v_update_observed text;
begin
  if p_create_request is null or p_create_response is null
     or p_update_request is null or p_update_response is null then
    return null;
  end if;
  if p_create_request#>>'{arguments,params,ShippingNo}' is distinct from '0'
     or p_update_request#>>'{arguments,params,ShippingNo}' is distinct from '0'
     or p_update_request#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}'
          is distinct from '0'
  then return null; end if;
  if sellerpilot_private.qoo10_shipping_s1_has_activation_step(p_create_response)
     or sellerpilot_private.qoo10_shipping_s1_has_activation_step(p_update_response)
  then return null; end if;
  if sellerpilot_private.qoo10_shipping_s1_named_step(p_create_response,'EditGoodsContents') is null
     or sellerpilot_private.qoo10_shipping_s1_named_step(p_update_response,'UpdateGoods') is null
     or sellerpilot_private.qoo10_shipping_s1_named_step(p_update_response,'EditGoodsContents') is null
  then return null; end if;
  v_create_item := sellerpilot_private.qoo10_shipping_s1_readback_item(
    p_create_response, '1217536689'
  );
  v_update_item := sellerpilot_private.qoo10_shipping_s1_readback_item(
    p_update_response, '1217536689'
  );
  if v_create_item is null or v_update_item is null then return null; end if;
  v_create_observed := coalesce(
    v_create_item->>'ShippingNo', v_create_item->>'ShippingNO',
    v_create_item->>'DeliveryGroupNo', ''
  );
  v_update_observed := coalesce(
    v_update_item->>'ShippingNo', v_update_item->>'ShippingNO',
    v_update_item->>'DeliveryGroupNo', ''
  );
  if v_create_observed is distinct from '806971'
     or v_update_observed is distinct from '806971'
     or upper(coalesce(v_update_item->>'ItemStatus', v_update_item->>'Status', ''))
          is distinct from 'S1'
  then return null; end if;
  if not sellerpilot_private.qoo10_shipping_s1_publication_checks_match(
           p_update_response, true
         )
  then return null; end if;
  return jsonb_build_object(
    'contract','qoo10_shipping_s1_source_observation_v1',
    'requestedShippingNo','0',
    'confirmationShippingNo','0',
    'observedShippingNo','806971',
    'createObservedShippingNo',v_create_observed,
    'updateObservedShippingNo',v_update_observed,
    'providerStatus','S1',
    'createChecks',sellerpilot_private.qoo10_shipping_s1_publication_checks(p_create_response),
    'updateChecks',sellerpilot_private.qoo10_shipping_s1_publication_checks(p_update_response)
  );
exception when others then
  return null;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_create sellerpilot_private.channel_gateway_jobs%rowtype;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_observation jsonb;
begin
  select * into v_create
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid;
  select * into v_update
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;
  select * into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;
  if v_create.id is null or v_update.id is null or v_listing.id is null then
    return false;
  end if;
  if v_create.channel is distinct from 'qoo10'
     or v_create.operation is distinct from 'listing.create'
     or v_create.environment is distinct from 'production'
     or v_create.listing_id is distinct from v_listing.id
     or v_create.credential_id is distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_create.seller_account_key is distinct from
          '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or v_create.status in ('queued','running')
     or v_create.completed_at is null
     or v_create.provider_mutation_started_at is null
     or encode(extensions.digest(v_create.request_payload::text,'sha256'),'hex')
          is distinct from
          'afb9623fc3892fc7a387ba46dc3a06c58ed0e7707a634fb5cd6dc50eeb133cec'
     or encode(extensions.digest(v_create.response_payload::text,'sha256'),'hex')
          is distinct from
          '11c202e9c52146c42094dddf19fae7d494bc66c9c7949ecc0bbc9f528105893a'
     or v_update.channel is distinct from 'qoo10'
     or v_update.operation is distinct from 'listing.update'
     or v_update.environment is distinct from 'production'
     or v_update.listing_id is distinct from v_listing.id
     or v_update.credential_id is distinct from v_create.credential_id
     or v_update.seller_account_key is distinct from v_create.seller_account_key
     or v_update.attempt_id is distinct from
          '86054977-b362-4f64-9ecd-24ef18963c6f'::uuid
     or v_update.status in ('queued','running')
     or v_update.completed_at is null
     or v_update.provider_mutation_started_at is null
     or encode(extensions.digest(v_update.request_payload::text,'sha256'),'hex')
          is distinct from
          'e59ea7c11a9e47b1f365e512e2df2c57270395134c94bf9cf0014fb872bc7eb3'
     or encode(extensions.digest(v_update.response_payload::text,'sha256'),'hex')
          is distinct from
          'df728f98d58e319bdce5d18e2503a03d78b40cfd923966a0416fb77363fcd6ee'
     or v_listing.product_id is distinct from
          '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
     or v_listing.owner_id is distinct from
          '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.market is distinct from 'JP'
     or v_listing.target_id is distinct from 'Japan · QAPI'
     or v_listing.remote_id is distinct from '1217536689'
     or v_listing.status is distinct from 'failed'
     or v_listing.failure_class is distinct from 'external_action'
     or v_listing.remote_visibility is distinct from 'unknown'
     or v_listing.provider_status is not null
     or v_listing.published_at is not null
     or v_listing.last_verified_at is not null
     or v_listing.operation_attempt_id is distinct from
          '86054977-b362-4f64-9ecd-24ef18963c6f'::uuid
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.seller_account_key is distinct from v_create.seller_account_key
     or v_create.request_payload#>>'{arguments,params,ShippingNo}'
          is distinct from '0'
     or v_update.request_payload#>>'{arguments,params,ShippingNo}'
          is distinct from '0'
     or v_update.request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,shippingNo}'
          is distinct from '0'
  then
    return false;
  end if;
  v_observation := sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
    v_create.request_payload, v_create.response_payload,
    v_update.request_payload, v_update.response_payload
  );
  return v_observation is not null
    and v_observation->>'requestedShippingNo' = '0'
    and v_observation->>'observedShippingNo' = '806971';
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_record_source_observation()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_create sellerpilot_private.channel_gateway_jobs%rowtype;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_observation jsonb;
  v_id uuid;
begin
  if not sellerpilot_private.qoo10_shipping_s1_jobs_are_current() then
    raise exception 'exact Qoo10 shipping S1 source observation is not current'
      using errcode = '55000';
  end if;
  select * into strict v_create
    from sellerpilot_private.channel_gateway_jobs
   where id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid;
  select * into strict v_update
    from sellerpilot_private.channel_gateway_jobs
   where id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;
  select * into strict v_listing
    from sellerpilot_private.product_listings
   where id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;
  v_observation := sellerpilot_private.qoo10_shipping_s1_source_observation_extract(
    v_create.request_payload, v_create.response_payload,
    v_update.request_payload, v_update.response_payload
  );
  select observation_id into v_id
    from sellerpilot_private.qoo10_shipping_s1_source_observations
   where create_job_id = v_create.id and update_job_id = v_update.id;
  if v_id is not null then return v_id; end if;
  insert into sellerpilot_private.qoo10_shipping_s1_source_observations (
    create_job_id, update_job_id, listing_id, product_id, credential_id,
    remote_id, requested_shipping_no, observed_shipping_no,
    create_request_sha256, create_response_sha256,
    update_request_sha256, update_response_sha256,
    observation, contract
  ) values (
    v_create.id, v_update.id, v_listing.id, v_listing.product_id,
    v_create.credential_id, '1217536689', '0', '806971',
    encode(extensions.digest(v_create.request_payload::text,'sha256'),'hex'),
    encode(extensions.digest(v_create.response_payload::text,'sha256'),'hex'),
    encode(extensions.digest(v_update.request_payload::text,'sha256'),'hex'),
    encode(extensions.digest(v_update.response_payload::text,'sha256'),'hex'),
    v_observation, 'qoo10_shipping_s1_source_observation_v1'
  ) returning observation_id into v_id;
  return v_id;
end;
$$;

create function public.sellerpilot_service_get_qoo10_shipping_s1_release_status(
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
  v_create record;
  v_update record;
  v_verifier record;
  v_permit record;
  v_outcome record;
  v_source_observation record;
begin
  if p_product_id is distinct from '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
     or p_listing_id is distinct from '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
  then
    raise exception 'exact Qoo10 shipping S1 status identity invalid'
      using errcode = '55000';
  end if;

  select null::uuid as observation_id, null::text as requested_shipping_no,
         null::text as observed_shipping_no
    into v_source_observation;
  select null::uuid as verifier_job_id, null::text as status,
         null::text as release_sha, null::timestamptz as completed_at
    into v_verifier;
  select null::uuid as activation_job_id, null::text as status,
         null::timestamptz as armed_at, null::timestamptz as expires_at,
         null::timestamptz as bound_at, null::timestamptz as consumed_at,
         null::timestamptz as invalidated_at
    into v_permit;
  select null::text as terminal_status, null::text as provider_status,
         null::text as remote_visibility, null::timestamptz as verified_at,
         null::timestamptz as completed_at
    into v_outcome;

  select job.id, job.status, job.created_at, job.completed_at
    into v_create
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid;
  select job.id, job.status, job.created_at, job.completed_at
    into v_update
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;
  select observation.observation_id, observation.requested_shipping_no,
         observation.observed_shipping_no
    into v_source_observation
    from sellerpilot_private.qoo10_shipping_s1_source_observations observation
   where observation.create_job_id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid
     and observation.update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
   limit 1;
  if v_source_observation.observation_id is not null then
    select run.verifier_job_id, job.status, run.release_sha, job.completed_at
      into v_verifier
      from sellerpilot_private.qoo10_shipping_s1_verifier_runs run
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = run.verifier_job_id
     where run.source_observation_id = v_source_observation.observation_id
     order by run.queued_at desc
     limit 1;
  end if;
  if v_verifier.verifier_job_id is not null then
    select permit.activation_job_id, job.status, permit.armed_at, permit.expires_at,
           permit.bound_at, permit.consumed_at, permit.invalidated_at
      into v_permit
      from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
     where permit.verifier_job_id = v_verifier.verifier_job_id;
  end if;
  if v_permit.activation_job_id is not null then
    select outcome.terminal_status, outcome.provider_status,
           outcome.remote_visibility, outcome.verified_at, outcome.completed_at
      into v_outcome
      from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
     where outcome.activation_job_id = v_permit.activation_job_id;
  end if;

  return jsonb_build_object(
    'contract','qoo10_shipping_s1_release_status_v1',
    'productId',p_product_id,
    'listingId',p_listing_id,
    'remoteId','1217536689',
    'createJobId','687852dc-36de-4049-b170-bdf7839ccf2f',
    'updateJobId','089467c1-cadb-4d31-93a8-d5882c46d753',
    'releaseSha',p_release_sha,
    'releaseCurrent',sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha),
    'jobsCurrent',sellerpilot_private.qoo10_shipping_s1_jobs_are_current(),
    'requestedShippingNo','0',
    'observedShippingNo','806971',
    'create', case when v_create.id is null then null else jsonb_build_object(
      'jobId',v_create.id,'status',v_create.status,
      'createdAt',v_create.created_at,'completedAt',v_create.completed_at
    ) end,
    'update', case when v_update.id is null then null else jsonb_build_object(
      'jobId',v_update.id,'status',v_update.status,
      'createdAt',v_update.created_at,'completedAt',v_update.completed_at
    ) end,
    'sourceObservation', case when v_source_observation.observation_id is null then null
      else jsonb_build_object(
        'observationId',v_source_observation.observation_id,
        'requestedShippingNo',v_source_observation.requested_shipping_no,
        'observedShippingNo',v_source_observation.observed_shipping_no
      ) end,
    'verifier', case when v_verifier.verifier_job_id is null then null else
      jsonb_build_object(
        'jobId',v_verifier.verifier_job_id,'status',v_verifier.status,
        'releaseSha',v_verifier.release_sha,'completedAt',v_verifier.completed_at
      ) end,
    'activation', case when v_permit.activation_job_id is null then null else
      jsonb_build_object(
        'jobId',v_permit.activation_job_id,'status',v_permit.status,
        'armedAt',v_permit.armed_at,'expiresAt',v_permit.expires_at,
        'boundAt',v_permit.bound_at,'consumedAt',v_permit.consumed_at,
        'invalidatedAt',v_permit.invalidated_at
      ) end,
    'outcome', case when v_outcome.terminal_status is null then null else
      jsonb_build_object(
        'terminalStatus',v_outcome.terminal_status,
        'providerStatus',v_outcome.provider_status,
        'remoteVisibility',v_outcome.remote_visibility,
        'verifiedAt',v_outcome.verified_at,'completedAt',v_outcome.completed_at
      ) end
  );
end;
$$;

create function public.sellerpilot_service_enqueue_qoo10_shipping_s1_verifier(
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
  v_existing uuid;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_create sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_observation_id uuid;
  v_arguments jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
  if p_listing_id is distinct from '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
     or not sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
     or exists (
       select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits
        where invalidated_at is null
     )
  then
    raise exception 'exact Qoo10 shipping S1 verifier preconditions are not met'
      using errcode = '55000';
  end if;

  select run.verifier_job_id into v_existing
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = run.verifier_job_id
   where run.listing_id = p_listing_id
     and run.update_job_id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
     and job.status in ('queued','running')
   order by run.queued_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'contract','qoo10_shipping_s1_verifier_v1',
      'updateJobId','089467c1-cadb-4d31-93a8-d5882c46d753',
      'createJobId','687852dc-36de-4049-b170-bdf7839ccf2f',
      'verifierJobId',v_existing,
      'reused',true
    );
  end if;

  v_observation_id := sellerpilot_private.qoo10_shipping_s1_record_source_observation();
  select * into strict v_update
    from sellerpilot_private.channel_gateway_jobs
   where id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;
  select * into strict v_create
    from sellerpilot_private.channel_gateway_jobs
   where id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid;
  select * into strict v_listing
    from sellerpilot_private.product_listings
   where id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;
  if v_update.request_payload#>>'{arguments,publicationExpectedFingerprint}'
       !~ '^[a-f0-9]{64}$'
  then
    raise exception 'exact Qoo10 shipping S1 publication fingerprint required'
      using errcode = '55000';
  end if;

  v_arguments := jsonb_build_object(
    'publicationReviewId', v_listing.id,
    'publicationReviewSourceJobId', v_update.id,
    'publicationReviewCheck', 1,
    'sellerpilotReadOnly', true,
    'sellerpilotQoo10ShippingS1Recovery', 'qoo10_shipping_s1_verifier_v1',
    'remoteId', '1217536689',
    'market', 'JP',
    'targetId', 'Japan · QAPI',
    'publicationIntent', 'live',
    'publicationStateContract', 'verified_remote_state_v1',
    'publicationExpectedLocale', 'ja-JP',
    'publicationExpectedFingerprint',
      v_update.request_payload#>>'{arguments,publicationExpectedFingerprint}',
    'publicationExpectedImageCount', 8
  );

  perform pg_catalog.set_config(
    'sellerpilot.qoo10_shipping_s1_verifier_enqueue', v_job_id::text, true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation,
    environment, request_payload, status, seller_account_key,
    request_fingerprint, created_by, created_at, updated_at
  ) values (
    v_job_id, v_update.credential_id, null, v_listing.id,
    'qoo10', 'listing.publication.verify', 'production',
    jsonb_build_object(
      'periodicKey','qoo10-shipping-s1:' || v_update.id::text,
      'arguments', v_arguments
    ),
    'queued', v_update.seller_account_key, v_update.request_fingerprint,
    v_update.created_by, clock_timestamp(), clock_timestamp()
  );

  insert into sellerpilot_private.qoo10_shipping_s1_verifier_runs (
    verifier_job_id, source_observation_id, create_job_id, update_job_id,
    listing_id, product_id, credential_id, owner_id, remote_id,
    seller_account_key, release_sha, contract, queued_at
  ) values (
    v_job_id, v_observation_id, v_create.id, v_update.id, v_listing.id,
    v_listing.product_id, v_update.credential_id, v_listing.owner_id,
    '1217536689', v_update.seller_account_key, p_release_sha,
    'qoo10_shipping_s1_verifier_v1', clock_timestamp()
  );

  return jsonb_build_object(
    'contract','qoo10_shipping_s1_verifier_v1',
    'updateJobId', v_update.id,
    'createJobId', v_create.id,
    'verifierJobId', v_job_id,
    'sourceObservationId', v_observation_id,
    'reused', false
  );
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_activation_expectation_valid(
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
  if v_params->>'ShippingNo' is distinct from '0'
     or v_source_state->>'shippingNo' is distinct from '0'
  then
    return false;
  end if;
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
    and v_expected_state->>'shippingNo' = '806971'
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
    and (
      p_expectation->>'expectedDetailHtmlSha256' = encode(
        extensions.digest(v_params->>'ItemDescription','sha256'),'hex'
      )
      or p_expectation->>'expectedDetailHtmlSha256' = encode(
        extensions.digest(
          sellerpilot_private.qoo10_canonical_provider_detail_html(
            v_params->>'ItemDescription'
          ),
          'sha256'
        ),
        'hex'
      )
    )
    and p_expectation->'expectedDetailImageUrls' = v_source_detail_images
    and jsonb_array_length(p_expectation->'expectedDetailImageUrls') = 8
    and (
      nullif(v_params->>'SellerCode','') is null
      or p_expectation->>'expectedSellerCode' = v_params->>'SellerCode'
    );
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.record_qoo10_shipping_s1_observation(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_run sellerpilot_private.qoo10_shipping_s1_verifier_runs%rowtype;
  v_source_arguments jsonb;
  v_step jsonb;
  v_expectation jsonb;
  v_verified_at timestamptz;
  v_shipping text;
begin
  select * into v_run
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs
   where verifier_job_id = p_job_id;
  if not found then return false; end if;
  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs where id = p_job_id;
  select source.request_payload->'arguments' into strict v_source_arguments
    from sellerpilot_private.channel_gateway_jobs source
   where source.id = v_run.update_job_id;
  v_step := sellerpilot_private.qoo10_shipping_s1_named_step(
    v_job.response_payload, 'qoo10-exact-s1-recovery-verification'
  );
  if v_job.status is distinct from 'succeeded'
     or v_job.completed_at is null
     or v_job.response_payload is null
     or v_job.operation is distinct from 'listing.publication.verify'
     or v_job.request_payload#>>'{arguments,sellerpilotReadOnly}' is distinct from 'true'
     or v_job.provider_mutation_started_at is not null
     or v_step is null
     or jsonb_typeof(v_step#>'{data,sellerpilotQoo10ActivationExpectation}')
          is distinct from 'object'
     or upper(coalesce(
          v_step#>>'{data,providerStatus}',
          v_step#>>'{data,ResultObject,ItemStatus}',
          v_job.response_payload#>>'{remoteState,providerStatus}',
          ''
        )) is distinct from 'S1'
     or sellerpilot_private.qoo10_shipping_s1_has_activation_step(v_job.response_payload)
  then
    return false;
  end if;
  v_shipping := sellerpilot_private.qoo10_shipping_s1_observed_shipping_no(
    v_job.response_payload, '1217536689'
  );
  if v_shipping is distinct from '806971' then return false; end if;
  v_expectation := v_step#>'{data,sellerpilotQoo10ActivationExpectation}';
  if not sellerpilot_private.qoo10_shipping_s1_activation_expectation_valid(
    v_expectation, v_source_arguments
  ) then return false; end if;
  begin
    v_verified_at := (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
  exception when others then
    return false;
  end;
  if v_job.started_at is null or v_verified_at is null
     or v_verified_at < v_job.started_at
     or v_verified_at > v_job.completed_at + interval '1 minute'
  then
    return false;
  end if;

  insert into sellerpilot_private.qoo10_shipping_s1_observations (
    verifier_job_id, source_observation_id, create_job_id, update_job_id,
    listing_id, remote_id, release_sha, verifier_response_sha256,
    verifier_response_bytes, activation_expectation, provider_status,
    remote_visibility, verified_at, verifier_completed_at, contract
  ) values (
    v_job.id, v_run.source_observation_id, v_run.create_job_id, v_run.update_job_id,
    v_run.listing_id, v_run.remote_id, v_run.release_sha,
    encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex'),
    octet_length(v_job.response_payload::text), v_expectation, 'S1', 'non_public',
    v_verified_at, v_job.completed_at, 'qoo10_shipping_s1_observation_v1'
  ) on conflict (verifier_job_id) do nothing;
  return found or exists (
    select 1 from sellerpilot_private.qoo10_shipping_s1_observations
     where verifier_job_id = v_job.id
  );
end;
$$;

create function public.sellerpilot_service_enqueue_qoo10_shipping_s1_activation(
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
  v_observation sellerpilot_private.qoo10_shipping_s1_observations%rowtype;
  v_run sellerpilot_private.qoo10_shipping_s1_verifier_runs%rowtype;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_arguments jsonb;
  v_marker jsonb;
  v_payload jsonb;
  v_request_sha text;
  v_resource_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
  if exists (
    select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits
     where invalidated_at is null
  ) then
    raise exception 'exact Qoo10 shipping S1 activation is already armed'
      using errcode = '55000';
  end if;
  select * into v_observation
    from sellerpilot_private.qoo10_shipping_s1_observations
   where verifier_job_id = p_verifier_job_id;
  select * into v_run
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs
   where verifier_job_id = p_verifier_job_id;
  if v_run.verifier_job_id is null
     or v_observation.verifier_job_id is null
     or v_observation.release_sha is distinct from p_release_sha
     or v_observation.verifier_completed_at + interval '2 minutes' <= clock_timestamp()
     or not sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha)
     or not sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
     or v_observation.activation_expectation#>>'{expectedState,shippingNo}'
          is distinct from '806971'
  then
    raise exception 'fresh exact Qoo10 shipping S1 observation required'
      using errcode = '55000';
  end if;
  select * into strict v_update
    from sellerpilot_private.channel_gateway_jobs
   where id = v_run.update_job_id;

  v_marker := jsonb_set(
    v_observation.activation_expectation || jsonb_build_object(
      'status','allowed',
      'contract','qoo10_s1_activation_v1',
      'listingId', v_run.listing_id,
      'remoteId', v_run.remote_id,
      'providerStatus','S1',
      'sourceJobId', v_run.update_job_id,
      'verifierJobId', v_run.verifier_job_id,
      'verifierResponseSha256', v_observation.verifier_response_sha256,
      'verifierCompletedAt', v_observation.verifier_completed_at
    ),
    '{expectedState,shippingNo}',
    '"806971"'::jsonb,
    true
  );
  v_arguments := jsonb_set(
    coalesce(v_update.request_payload->'arguments','{}'::jsonb),
    '{sellerpilotQoo10S1Activation}', v_marker, true
  );
  v_arguments := jsonb_set(
    v_arguments,
    '{sellerpilotQoo10ShippingS1Activation}',
    jsonb_build_object(
      'status','allowed',
      'contract','qoo10_shipping_s1_activation_v1',
      'listingId', v_run.listing_id,
      'remoteId', v_run.remote_id,
      'createJobId', v_run.create_job_id,
      'updateJobId', v_run.update_job_id,
      'verifierJobId', v_run.verifier_job_id
    ),
    true
  );
  if v_arguments#>>'{params,ShippingNo}' is distinct from '0' then
    raise exception 'exact Qoo10 shipping S1 activation source ShippingNo is not the stored selector'
      using errcode = '55000';
  end if;
  v_arguments := jsonb_set(
    v_arguments,
    '{params,ShippingNo}',
    '"806971"'::jsonb,
    true
  );
  v_payload := jsonb_build_object('arguments', v_arguments);
  v_request_sha := encode(extensions.digest(v_payload::text,'sha256'),'hex');
  v_resource_key := encode(extensions.digest(
    'qoo10-shipping-s1-activation:' || v_run.update_job_id::text || ':' ||
      v_run.verifier_job_id::text || ':' || v_run.remote_id,
    'sha256'
  ),'hex');

  insert into sellerpilot_private.channel_operation_attempts (
    id, owner_id, credential_id, channel, operation, idempotency_key,
    request_fingerprint, status, started_at, seller_account_key,
    gateway_write_required, pre_gateway_retryable
  ) values (
    v_attempt_id, v_run.owner_id, v_run.credential_id, 'qoo10', 'listing.activate',
    'qoo10-shipping-s1-activate:' || v_run.update_job_id::text || ':' ||
      v_run.verifier_job_id::text,
    v_request_sha, 'running', clock_timestamp(), v_run.seller_account_key, true, false
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_shipping_s1_activation_enqueue', v_job_id::text, true
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, listing_id, channel, operation, environment,
    request_payload, status, seller_account_key, request_fingerprint,
    write_resource_kind, write_resource_key, created_by, created_at, updated_at
  ) values (
    v_job_id, v_run.credential_id, v_attempt_id, v_run.listing_id, 'qoo10',
    'listing.activate', 'production', v_payload, 'queued', v_run.seller_account_key,
    v_request_sha, 'listing_mutation', v_resource_key,
    v_update.created_by, clock_timestamp(), clock_timestamp()
  );
  insert into sellerpilot_private.qoo10_shipping_s1_activation_permits (
    activation_job_id, activation_attempt_id, verifier_job_id, create_job_id,
    update_job_id, listing_id, credential_id, owner_id, remote_id,
    seller_account_key, release_sha, activation_request_sha256,
    activation_request_bytes, write_resource_key, contract, armed_at, expires_at
  ) values (
    v_job_id, v_attempt_id, v_run.verifier_job_id, v_run.create_job_id,
    v_run.update_job_id, v_run.listing_id, v_run.credential_id, v_run.owner_id,
    v_run.remote_id, v_run.seller_account_key, p_release_sha, v_request_sha,
    octet_length(v_payload::text), v_resource_key,
    'qoo10_shipping_s1_activation_permit_v1', clock_timestamp(),
    v_observation.verifier_completed_at + interval '2 minutes'
  );

  return jsonb_build_object(
    'contract','qoo10_shipping_s1_activation_permit_v1',
    'createJobId', v_run.create_job_id,
    'updateJobId', v_run.update_job_id,
    'verifierJobId', v_run.verifier_job_id,
    'activationJobId', v_job_id,
    'activationAttemptId', v_attempt_id,
    'expectedShippingNo','806971',
    'expiresAt', v_observation.verifier_completed_at + interval '2 minutes'
  );
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_job.listing_id is not distinct from
           '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and p_job.channel is not distinct from 'qoo10'
    and p_job.operation is not distinct from 'listing.publication.verify'
    and p_job.credential_id is not distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and p_job.request_payload->>'periodicKey' is not distinct from
          'qoo10-shipping-s1:089467c1-cadb-4d31-93a8-d5882c46d753'
    and p_job.request_payload#>'{arguments,sellerpilotReadOnly}'
          is not distinct from 'true'::jsonb
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10ShippingS1Recovery}'
          is not distinct from 'qoo10_shipping_s1_verifier_v1'
    and p_job.request_payload#>>'{arguments,publicationReviewSourceJobId}'
          is not distinct from '089467c1-cadb-4d31-93a8-d5882c46d753'
    and p_job.request_payload#>>'{arguments,publicationReviewId}'
          is not distinct from '13858f41-78fd-463f-9390-e8f06e71e538'
    and p_job.request_payload#>>'{arguments,remoteId}'
          is not distinct from '1217536689'
    and p_job.request_payload#>>'{arguments,targetId}'
          is not distinct from 'Japan · QAPI'
$$;

create function sellerpilot_private.qoo10_shipping_s1_activation_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_job.listing_id is not distinct from
           '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
    and p_job.channel is not distinct from 'qoo10'
    and p_job.operation is not distinct from 'listing.activate'
    and p_job.credential_id is not distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'
          is not distinct from 'allowed'
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'
          is not distinct from 'qoo10_s1_activation_v1'
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'
          is not distinct from '13858f41-78fd-463f-9390-e8f06e71e538'
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'
          is not distinct from '1217536689'
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
          is not distinct from '806971'
    and p_job.request_payload#>>'{arguments,sellerpilotQoo10ShippingS1Activation,contract}'
          is not distinct from 'qoo10_shipping_s1_activation_v1'
$$;

create function sellerpilot_private.guard_qoo10_shipping_s1_verifier_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_new boolean;
  v_exact_new boolean;
begin
  if tg_op in ('UPDATE','DELETE')
     and old.id in (
       '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid,
       '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
     )
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs verifier
        where verifier.id is distinct from old.id
          and verifier.status in ('queued','running','reconciliation_required')
          and sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(verifier)
     )
  then
    raise exception 'exact Qoo10 shipping S1 source is locked by its verifier'
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

  v_exact_new := sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(new);
  if v_exact_new then
    perform 1
      from sellerpilot_private.channel_gateway_jobs source_job
     where source_job.id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
     for update;
    if not sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
       or (
         current_setting('sellerpilot.qoo10_shipping_s1_verifier_enqueue', true)
           is distinct from new.id::text
         and not exists (
           select 1 from sellerpilot_private.qoo10_shipping_s1_verifier_runs run
            where run.verifier_job_id = new.id
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
            and other_job.id not in (
              new.id,
              '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid,
              '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
            )
       )
    then
      raise exception 'exact Qoo10 shipping S1 verifier overlap is not current'
        using errcode = '55000';
    end if;
  elsif exists (
    select 1 from sellerpilot_private.channel_gateway_jobs verifier
     where verifier.listing_id = new.listing_id
       and verifier.id is distinct from new.id
       and verifier.status in ('queued','running','reconciliation_required')
       and sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(verifier)
       and not sellerpilot_private.qoo10_shipping_s1_activation_job_matches(new)
  ) then
    raise exception 'listing work overlaps the exact Qoo10 shipping S1 verifier'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_qoo10_shipping_s1_verifier_overlap
before insert or update or delete
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_qoo10_shipping_s1_verifier_overlap();

drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(
             channel_gateway_jobs
           )
        then 'qoo10_shipping_s1_verifier_v1'
      when sellerpilot_private.qoo10_shipping_s1_activation_job_matches(
             channel_gateway_jobs
           )
        then 'qoo10_shipping_s1_activation_v1'
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

create function sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
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
     or p_new->>'id' is distinct from p_old->>'id'
     or p_new->'request_payload' is distinct from p_old->'request_payload'
     or (p_old->>'attempt_count')::integer <> 0
     or (p_new->>'attempt_count')::integer <> 1
     or p_old->'provider_mutation_started_at' <> 'null'::jsonb
     or p_new->'provider_mutation_started_at' <> 'null'::jsonb
  then return false; end if;
  v_job_id := (p_new->>'id')::uuid;
  if exists (
    select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
     where permit.activation_job_id = v_job_id
       and permit.bound_at is not null
       and permit.consumed_at is null
       and permit.invalidated_at is null
       and permit.bound_worker_token_id = (p_new->>'worker_token_id')::uuid
       and permit.bound_claim_token = (p_new->>'claim_token')::uuid
  ) then
    return true;
  end if;
  update sellerpilot_private.qoo10_shipping_s1_activation_permits permit
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
     and sellerpilot_private.qoo10_shipping_s1_release_is_current(permit.release_sha)
     and sellerpilot_private.qoo10_shipping_s1_jobs_are_current();
  return found;
exception when others then
  return false;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_activation_provider_allowed(
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
      from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
      join sellerpilot_private.qoo10_shipping_s1_observations observation
        on observation.verifier_job_id = permit.verifier_job_id
     where permit.activation_job_id = p_job_id
       and permit.bound_claim_token = p_claim_token
       and permit.bound_at is not null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and permit.consumed_at is null
       and job.status = 'running'
       and job.operation = 'listing.activate'
       and job.channel = 'qoo10'
       and job.claim_token = p_claim_token
       and job.provider_mutation_started_at is null
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
             = '806971'
       and sellerpilot_private.qoo10_shipping_s1_release_is_current(permit.release_sha)
       and sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
  )
$$;

create function sellerpilot_private.consume_qoo10_shipping_s1_activation_provider(
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update sellerpilot_private.qoo10_shipping_s1_activation_permits permit
     set consumed_at = clock_timestamp()
   where permit.activation_job_id = p_job_id
     and permit.bound_claim_token = p_claim_token
     and permit.consumed_at is null
     and permit.invalidated_at is null
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = permit.activation_job_id
          and job.status = 'running'
          and job.provider_mutation_started_at is not null
          and job.completed_at is null
     );
  return found;
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.qoo10_shipping_s1_activation_permits permit
        on permit.activation_job_id = job.id
     where job.id = p_job_id
       and job.status = 'queued'
       and job.operation = 'listing.activate'
       and job.channel = 'qoo10'
       and job.environment = 'production'
       and job.attempt_count = 0
       and job.worker_token_id is null
       and job.claim_token is null
       and job.provider_mutation_started_at is null
       and job.write_resource_kind = 'listing_mutation'
       and permit.invalidated_at is null
       and permit.bound_at is null
       and permit.consumed_at is null
       and permit.expires_at > statement_timestamp()
       and permit.credential_id = job.credential_id
       and permit.activation_attempt_id = job.attempt_id
       and permit.listing_id = job.listing_id
       and permit.seller_account_key = job.seller_account_key
       and permit.write_resource_key = job.write_resource_key
       and permit.activation_request_sha256 = job.request_fingerprint
       and job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
             = '806971'
       and job.request_payload#>>'{arguments,params,ShippingNo}'
             = '806971'
       and sellerpilot_private.qoo10_shipping_s1_release_is_current(permit.release_sha)
       and sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
  ), false)
$$;

create function sellerpilot_private.qoo10_shipping_s1_activation_claim_expired(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
     where permit.activation_job_id = p_job_id
       and permit.invalidated_at is null
       and permit.consumed_at is null
       and permit.expires_at <= statement_timestamp()
  )
$$;

create function sellerpilot_private.expire_qoo10_shipping_s1_activation_preclaim()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
begin
  if not exists (
    select 1
      from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
     where permit.invalidated_at is null
       and permit.expires_at <= statement_timestamp()
       and permit.bound_at is null
       and permit.consumed_at is null
       and job.status = 'queued'
       and job.provider_mutation_started_at is null
  ) then
    return 0;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
  with expired as (
    select permit.activation_job_id, permit.activation_attempt_id
      from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = permit.activation_job_id
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = permit.activation_attempt_id
     where permit.invalidated_at is null
       and permit.expires_at <= statement_timestamp()
       and permit.bound_at is null
       and permit.consumed_at is null
       and job.status = 'queued'
       and job.provider_mutation_started_at is null
     for update of permit, job, attempt
  ), invalidated as (
    update sellerpilot_private.qoo10_shipping_s1_activation_permits permit
       set invalidated_at = clock_timestamp(),
           invalidation_reason = 'expired_before_claim'
      from expired
     where permit.activation_job_id = expired.activation_job_id
     returning permit.activation_job_id, permit.activation_attempt_id
  ), failed_jobs as (
    update sellerpilot_private.channel_gateway_jobs job
       set status = 'failed',
           error_message =
             'Exact Qoo10 shipping S1 activation observation expired before claim; no provider mutation was started.',
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
           'Exact Qoo10 shipping S1 activation observation expired before claim; no provider mutation was started.',
         completed_at = clock_timestamp()
    from failed_jobs
   where attempt.id = failed_jobs.activation_attempt_id
     and attempt.status = 'running';
  get diagnostics v_expired = row_count;
  update sellerpilot_private.qoo10_shipping_s1_activation_permits permit
     set invalidated_at = clock_timestamp(),
         invalidation_reason = 'expired_after_claim'
    from sellerpilot_private.channel_gateway_jobs job
   where permit.activation_job_id = job.id
     and permit.invalidated_at is null
     and permit.expires_at <= statement_timestamp()
     and permit.bound_at is not null
     and permit.consumed_at is null
     and job.provider_mutation_started_at is null;
  return v_expired;
end;
$$;

create function sellerpilot_private.guard_qoo10_shipping_s1_activation_claim_bind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'queued' and new.status = 'running'
     and sellerpilot_private.qoo10_shipping_s1_activation_job_matches(new)
  then
    if not sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
      to_jsonb(old), to_jsonb(new)
    ) then
      raise exception 'exact Qoo10 shipping S1 activation claim bind failed'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_qoo10_shipping_s1_activation_claim_bind
before update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_qoo10_shipping_s1_activation_claim_bind();

do $qoo10_shipping_s1_closed_gate_claim$
declare
  v_definition text;
  v_before text;
  v_after text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.block_closed_listing_mutation_claim()'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'closed listing mutation claim guard missing'
      using errcode = '55000';
  end if;
  if pg_catalog.strpos(v_definition, 'bind_qoo10_shipping_s1_activation_claim') > 0 then
    return;
  end if;
  v_before := $body$or sellerpilot_private.bind_exact_existing_update_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
  v_after := $body$or sellerpilot_private.bind_exact_existing_update_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    v_before := $body$or sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
    v_after := $body$or sellerpilot_private.bind_exact_qoo10_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )
       or sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(
         to_jsonb(old),to_jsonb(new)
       )$body$;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'exact Qoo10 shipping S1 closed-gate claim patch target not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_closed_gate_claim$;

do $qoo10_shipping_s1_activation_lineage_guard$
declare
  v_definition text;
  v_before text := $body$  if tg_op = 'INSERT' then
    if new.operation is distinct from 'listing.activate'
       or new.channel is distinct from 'qoo10'
    then return new; end if;$body$;
  v_after text := $body$  if tg_op = 'INSERT' then
    if new.operation is distinct from 'listing.activate'
       or new.channel is distinct from 'qoo10'
    then return new; end if;
    if current_setting('sellerpilot.qoo10_shipping_s1_activation_enqueue', true)
         is not distinct from new.id::text
    then
      if new.listing_id is distinct from '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
         or new.credential_id is distinct from '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
         or new.environment is distinct from 'production'
         or new.status is distinct from 'queued'
         or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'
              is distinct from 'qoo10_s1_activation_v1'
         or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
              is distinct from '806971'
         or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'
              is distinct from '1217536689'
         or new.request_payload#>>'{arguments,sellerpilotQoo10ShippingS1Activation,contract}'
              is distinct from 'qoo10_shipping_s1_activation_v1'
      then
        raise exception 'exact Qoo10 shipping S1 activation enqueue lineage invalid'
          using errcode = '55000';
      end if;
      return new;
    end if;$body$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage()'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'exact Qoo10 S1 activation lineage guard missing'
      using errcode = '55000';
  end if;
  if pg_catalog.strpos(v_definition, 'sellerpilot.qoo10_shipping_s1_activation_enqueue') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'exact Qoo10 shipping S1 activation lineage patch target not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_activation_lineage_guard$;

do $qoo10_shipping_s1_activation_lineage_update_guard$
declare
  v_definition text;
  v_before text := $body$  if old.operation is distinct from 'listing.activate'
     or new.operation is distinct from 'listing.activate'
     or old.channel is distinct from 'qoo10'
     or new.channel is distinct from 'qoo10'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_activation_permits permit$body$;
  v_after text := $body$  if exists (
       select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
        where permit.activation_job_id is not distinct from new.id
     ) then
    if old.operation is distinct from 'listing.activate'
       or new.operation is distinct from 'listing.activate'
       or new.listing_id is distinct from '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
       or new.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
            is distinct from '806971'
       or not exists (
         select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
          where permit.activation_job_id is not distinct from new.id
            and new.attempt_id is not distinct from permit.activation_attempt_id
            and new.request_fingerprint is not distinct from permit.activation_request_sha256
       )
    then
      raise exception 'exact Qoo10 shipping S1 activation job lineage is immutable'
        using errcode = '55000';
    end if;
    return new;
  end if;
  if old.operation is distinct from 'listing.activate'
     or new.operation is distinct from 'listing.activate'
     or old.channel is distinct from 'qoo10'
     or new.channel is distinct from 'qoo10'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_s1_activation_permits permit$body$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'exact Qoo10 shipping S1 activation job lineage is immutable') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'exact Qoo10 shipping S1 activation update-lineage patch target not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_activation_lineage_update_guard$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_090500_begin_gateway_before_qoo10_shipping_s1;
revoke all on function
  public.sellerpilot_090500_begin_gateway_before_qoo10_shipping_s1(text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text, p_job_id uuid, p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipping boolean := false;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
  select exists (
    select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
     where permit.activation_job_id = p_job_id
  ) into v_shipping;
  if coalesce(v_shipping, false) then
    if not sellerpilot_private.qoo10_shipping_s1_activation_provider_allowed(
      p_job_id, p_claim_token
    ) then return false; end if;
    v_started := public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
      p_token_hash, p_job_id, p_claim_token
    );
    if coalesce(v_started, false)
       and not sellerpilot_private.consume_qoo10_shipping_s1_activation_provider(
         p_job_id, p_claim_token
       )
    then
      raise exception 'exact Qoo10 shipping S1 activation permit consumption failed'
        using errcode = '40001';
    end if;
    return coalesce(v_started, false);
  end if;
  return public.sellerpilot_090500_begin_gateway_before_qoo10_shipping_s1(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

do $qoo10_shipping_s1_serverless_begin$
begin
  if to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    return;
  end if;
  if to_regprocedure(
       'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'
     ) is null then
    raise exception 'exact Qoo10 shipping S1 innermost serverless mutation boundary missing'
      using errcode = '55000';
  end if;
  execute $rename$alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
    rename to sellerpilot_090500_begin_serverless_before_qoo10_shipping_s1$rename$;
  execute $revoke$revoke all on function public.sellerpilot_090500_begin_serverless_before_qoo10_shipping_s1(text,uuid,uuid)
    from public, anon, authenticated, service_role$revoke$;
  execute $fn$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text, p_job_id uuid, p_claim_token uuid
    ) returns boolean language plpgsql security definer set search_path = '' as $body$
    declare
      v_shipping boolean := false;
      v_started boolean;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 900500030);
      select exists (
        select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
         where permit.activation_job_id = p_job_id
      ) into v_shipping;
      if coalesce(v_shipping, false) then
        if not sellerpilot_private.qoo10_shipping_s1_activation_provider_allowed(
          p_job_id, p_claim_token
        ) then return false; end if;
        v_started := public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
          p_token_hash, p_job_id, p_claim_token
        );
        if coalesce(v_started, false)
           and not sellerpilot_private.consume_qoo10_shipping_s1_activation_provider(
             p_job_id, p_claim_token
           )
        then
          raise exception 'exact Qoo10 shipping S1 activation permit consumption failed'
            using errcode = '40001';
        end if;
        return coalesce(v_started, false);
      end if;
      return public.sellerpilot_090500_begin_serverless_before_qoo10_shipping_s1(
        p_token_hash, p_job_id, p_claim_token
      );
    end;
    $body$
  $fn$;
end;
$qoo10_shipping_s1_serverless_begin$;

do $qoo10_shipping_s1_innermost_serverless$
declare
  v_definition text;
  v_before text := $body$(job.channel='qoo10'
          and sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
            p_job_id,p_claim_token
          ))$body$;
  v_after text := $body$(job.channel='qoo10'
          and (
            sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
              p_job_id,p_claim_token
            )
            or sellerpilot_private.qoo10_shipping_s1_activation_provider_allowed(
              p_job_id,p_claim_token
            )
          ))$body$;
begin
  if to_regprocedure(
       'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'
     ) is null then
    return;
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_activation_provider_allowed') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'exact Qoo10 shipping S1 innermost serverless provider patch target not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_innermost_serverless$;

do $qoo10_shipping_s1_innermost_local$
declare
  v_definition text;
  v_before text := $body$(job.channel='qoo10'
          and sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
            p_job_id,p_claim_token
          ))$body$;
  v_after text := $body$(job.channel='qoo10'
          and (
            sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
              p_job_id,p_claim_token
            )
            or sellerpilot_private.qoo10_shipping_s1_activation_provider_allowed(
              p_job_id,p_claim_token
            )
          ))$body$;
begin
  if to_regprocedure(
       'public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(text,uuid,uuid)'
     ) is null then
    return;
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(text,uuid,uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_activation_provider_allowed') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    return;
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_innermost_local$;

alter function public.sellerpilot_service_listing_publication_verification_source(
  text,uuid,uuid
) rename to sellerpilot_090500_listing_publication_verification_source_before_shipping_s1;
revoke all on function
  public.sellerpilot_090500_listing_publication_verification_source_before_shipping_s1(
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
       p_token_hash, p_job_id, p_claim_token, true
     )
  then
    raise exception 'publication verification source ownership required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'contract','listing_publication_verification_source_v1',
           'verificationJobId', verifier.id,
           'sourceJobId', update_job.id,
           'sourceOperation', update_job.operation,
           'sourceArguments', update_job.request_payload->'arguments',
           'sourceResponsePayload', update_job.response_payload,
           'sourceFingerprint',
             update_job.request_payload#>>'{arguments,publicationExpectedFingerprint}',
           'expectedRemoteId', run.remote_id,
           'expectedLocale','ja-JP',
           'expectedImageCount', 8,
           'market','JP',
           'targetId','Japan · QAPI'
         )
    into v_source
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs run
    join sellerpilot_private.channel_gateway_jobs verifier
      on verifier.id = run.verifier_job_id
    join sellerpilot_private.channel_gateway_jobs update_job
      on update_job.id = run.update_job_id
   where run.verifier_job_id = p_job_id
     and verifier.status = 'running'
     and verifier.claim_token = p_claim_token
     and verifier.operation = 'listing.publication.verify'
     and verifier.provider_mutation_started_at is null
     and verifier.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
     and sellerpilot_private.qoo10_shipping_s1_jobs_are_current();
  if v_source is not null then return v_source; end if;
  return public.sellerpilot_090500_listing_publication_verification_source_before_shipping_s1(
    p_token_hash, p_job_id, p_claim_token
  );
end;
$$;

create function sellerpilot_private.qoo10_shipping_s1_activation_listing_update_allowed(
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
begin
  if coalesce(p_job_id,'') !~ '^[0-9a-f-]{36}$' then return false; end if;
  select job.*, outcome.activation_response_sha256
    into v_job
    from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
    join sellerpilot_private.channel_gateway_jobs job
      on job.id = outcome.activation_job_id
   where outcome.activation_job_id = p_job_id::uuid
     and outcome.listing_id = (p_new->>'id')::uuid
     and outcome.terminal_status = 'succeeded'
     and outcome.provider_status = 'S2'
     and outcome.remote_visibility = 'live'
     and job.status = 'succeeded';
  if not found then return false; end if;
  v_state := v_job.response_payload->'remoteState';
  begin
    v_verified_at := (v_state->>'verifiedAt')::timestamptz;
    v_created_at := nullif(v_state->>'createdAt','')::timestamptz;
  exception when others then
    return false;
  end;
  v_resources := jsonb_build_object(
    'resources', v_state->'resources',
    'verification', jsonb_build_object(
      'verifiedAt', to_jsonb(v_verified_at),
      'evidence', v_state->'evidence',
      'locale', v_state->>'locale',
      'fingerprint', v_state->>'fingerprint',
      'imageCount', (v_state->>'imageCount')::integer
    )
  );
  v_expected := p_old || jsonb_build_object(
    'status','published',
    'remote_visibility','live',
    'provider_status','S2',
    'remote_resources', v_resources,
    'remote_created_at', to_jsonb(coalesce(
      v_created_at, nullif(p_old->>'remote_created_at','')::timestamptz
    )),
    'published_at', to_jsonb(coalesce(
      nullif(p_old->>'published_at','')::timestamptz, v_verified_at
    )),
    'last_verified_at', to_jsonb(v_verified_at),
    'last_error', 'null'::jsonb,
    'failure_class', 'null'::jsonb,
    'updated_at', p_new->'updated_at'
  );
  return p_old->>'id' = '13858f41-78fd-463f-9390-e8f06e71e538'
    and p_old->>'product_id' = '1ed4acfc-7603-48ec-a638-241131e59358'
    and p_old->>'channel_key' = 'qoo10'
    and p_old->>'market' = 'JP'
    and p_old->>'target_id' = 'Japan · QAPI'
    and p_old->>'remote_id' = '1217536689'
    and p_old->>'status' = 'failed'
    and p_old->>'failure_class' = 'external_action'
    and p_old->>'remote_visibility' = 'unknown'
    and p_old->'provider_status' = 'null'::jsonb
    and p_old->'published_at' = 'null'::jsonb
    and p_old->'last_verified_at' = 'null'::jsonb
    and p_old->>'requested_publication_intent' = 'live'
    and p_new = v_expected;
exception when others then
  return false;
end;
$$;

do $qoo10_shipping_s1_listing_guard_patch$
declare
  v_definition text;
  v_before text := $body$if nullif(current_setting('sellerpilot.qoo10_s1_activation_apply', true), '') is not null then$body$;
  v_after text := $body$if nullif(current_setting('sellerpilot.qoo10_shipping_s1_activation_apply', true), '') is not null then
    if not sellerpilot_private.qoo10_shipping_s1_activation_listing_update_allowed(
      to_jsonb(old), to_jsonb(new),
      current_setting('sellerpilot.qoo10_shipping_s1_activation_apply', true)
    ) then
      raise exception 'invalid exact Qoo10 shipping S1 activation listing update';
    end if;
    return new;
  end if;

  if nullif(current_setting('sellerpilot.qoo10_s1_activation_apply', true), '') is not null then$body$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilot.qoo10_shipping_s1_activation_apply') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'product listing exact Qoo10 shipping S1 activation guard entry not found'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$qoo10_shipping_s1_listing_guard_patch$;

create function sellerpilot_private.apply_qoo10_shipping_s1_activation_listing(
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
    from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
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
    'resources', v_state->'resources',
    'verification', jsonb_build_object(
      'verifiedAt', to_jsonb(v_verified_at),
      'evidence', v_state->'evidence',
      'locale', v_state->>'locale',
      'fingerprint', v_state->>'fingerprint',
      'imageCount', (v_state->>'imageCount')::integer
    )
  );
  perform pg_catalog.set_config(
    'sellerpilot.qoo10_shipping_s1_activation_apply', p_job_id::text, true
  );
  update sellerpilot_private.product_listings listing
     set status = 'published',
         remote_visibility = 'live',
         provider_status = 'S2',
         remote_resources = v_resources,
         remote_created_at = coalesce(v_created_at, listing.remote_created_at),
         published_at = coalesce(listing.published_at, v_verified_at),
         last_verified_at = v_verified_at,
         last_error = null,
         failure_class = null,
         updated_at = clock_timestamp()
   where listing.id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
     and listing.status = 'failed'
     and listing.failure_class = 'external_action'
     and listing.remote_visibility = 'unknown'
     and listing.provider_status is null
     and listing.published_at is null
     and listing.last_verified_at is null
     and listing.remote_id = '1217536689'
     and listing.product_id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
     and listing.target_id = 'Japan · QAPI'
     and listing.requested_publication_intent = 'live'
     and listing.seller_account_key = v_job.seller_account_key;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create function sellerpilot_private.record_qoo10_shipping_s1_activation_outcome(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.qoo10_shipping_s1_activation_permits%rowtype;
  v_verified_at timestamptz;
  v_valid_s2 boolean := false;
  v_terminal_status text;
  v_shipping text;
begin
  select * into v_permit
    from sellerpilot_private.qoo10_shipping_s1_activation_permits
   where activation_job_id = p_job_id
     and invalidated_at is null;
  if not found then return false; end if;
  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs where id = p_job_id;
  if exists (
    select 1 from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
     where outcome.activation_job_id = v_job.id
  ) then return true; end if;

  if v_job.status = 'failed'
     and v_permit.consumed_at is null
     and v_job.provider_mutation_started_at is null
     and v_job.response_payload is null
  then
    v_terminal_status := 'failed';
    update sellerpilot_private.qoo10_shipping_s1_activation_permits permit
       set invalidated_at = clock_timestamp(),
           invalidation_reason = 'failed_before_provider'
     where permit.activation_job_id = v_permit.activation_job_id
       and permit.consumed_at is null
       and permit.invalidated_at is null;
  elsif v_job.status = 'reconciliation_required'
        and v_permit.consumed_at is not null
  then
    v_terminal_status := 'reconciliation_required';
  elsif v_job.status = 'succeeded' and v_job.response_payload is not null then
    v_shipping := sellerpilot_private.qoo10_shipping_s1_observed_shipping_no(
      v_job.response_payload, '1217536689'
    );
    v_valid_s2 :=
      sellerpilot_private.qoo10_shipping_s1_provider_status(v_job.response_payload) = 'S2'
      and v_shipping = '806971'
      and coalesce(v_job.response_payload#>>'{remoteState,visibility}','') = 'live'
      and v_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
            = '806971';
    if not v_valid_s2 then
      raise exception 'exact Qoo10 shipping activation terminal evidence invalid'
        using errcode = '55000';
    end if;
    v_terminal_status := 'succeeded';
    v_verified_at := (v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
  else
    raise exception 'exact Qoo10 shipping activation terminal evidence invalid'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.qoo10_shipping_s1_activation_outcomes (
    activation_job_id, create_job_id, update_job_id, verifier_job_id,
    listing_id, remote_id, terminal_status, activation_response_sha256,
    activation_response_bytes, provider_status, remote_visibility,
    verified_at, completed_at, contract
  ) values (
    v_job.id, v_permit.create_job_id, v_permit.update_job_id, v_permit.verifier_job_id,
    v_permit.listing_id, v_permit.remote_id, v_terminal_status,
    case when v_job.response_payload is null then null else
      encode(extensions.digest(v_job.response_payload::text,'sha256'),'hex') end,
    case when v_job.response_payload is null then null else
      octet_length(v_job.response_payload::text) end,
    case when v_valid_s2 then 'S2' end,
    case when v_valid_s2 then 'live' end,
    v_verified_at, coalesce(v_job.completed_at, clock_timestamp()),
    'qoo10_shipping_s1_activation_outcome_v1'
  ) on conflict (activation_job_id) do nothing;
  if v_valid_s2
     and not sellerpilot_private.apply_qoo10_shipping_s1_activation_listing(v_job.id)
  then
    raise exception 'exact Qoo10 shipping S1 activation listing projection failed'
      using errcode = '55000';
  end if;
  return true;
end;
$$;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_090500_complete_before_qoo10_shipping_s1;
revoke all on function
  public.sellerpilot_090500_complete_before_qoo10_shipping_s1(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text,
  p_response_payload jsonb default null, p_error_message text default null,
  p_credential_refresh jsonb default null, p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null, p_diagnostic jsonb default null
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
  v_result := public.sellerpilot_090500_complete_before_qoo10_shipping_s1(
    p_token_hash, p_job_id, p_claim_token, p_status, p_response_payload,
    p_error_message, p_credential_refresh, p_normalized_orders,
    p_normalized_inquiries, p_diagnostic
  );
  if v_result->>'status' not in ('completed','completed_replay') then
    return v_result;
  end if;
  select operation into v_operation
    from sellerpilot_private.channel_gateway_jobs where id = p_job_id;
  if v_operation = 'listing.publication.verify'
     and exists (
       select 1 from sellerpilot_private.qoo10_shipping_s1_verifier_runs
        where verifier_job_id = p_job_id
     )
  then
    if not sellerpilot_private.record_qoo10_shipping_s1_observation(p_job_id) then
      raise exception 'exact Qoo10 shipping S1 observation was not recorded'
        using errcode = '55000';
    end if;
  elsif v_operation = 'listing.activate'
        and exists (
          select 1 from sellerpilot_private.qoo10_shipping_s1_activation_permits
           where activation_job_id = p_job_id
        )
  then
    if not sellerpilot_private.record_qoo10_shipping_s1_activation_outcome(p_job_id) then
      raise exception 'exact Qoo10 shipping activation completion was not recorded'
        using errcode = '55000';
    end if;
  end if;
  return v_result;
end;
$$;

create or replace function sellerpilot_private.qoo10_shipping_s1_source_reconciliation_resolved(
  p_source_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_source_job_id in (
           '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid,
           '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid
         )
    and exists (
      select 1
        from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
        join sellerpilot_private.channel_gateway_jobs activation
          on activation.id = outcome.activation_job_id
       where outcome.terminal_status = 'succeeded'
         and outcome.provider_status = 'S2'
         and outcome.remote_visibility = 'live'
         and activation.status = 'succeeded'
         and activation.operation = 'listing.activate'
         and encode(extensions.digest(activation.response_payload::text,'sha256'),'hex')
               = outcome.activation_response_sha256
    )
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
  select coalesce(
    sellerpilot_private.qoo10_shipping_s1_source_reconciliation_resolved(p_source_job_id)
    or exists (
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
    ),
    false
  )
$$;

do $qoo10_shipping_s1_local_claim$
declare
  v_definition text;
  v_expire_before text := $body$  where id = v_token_id;

  with expired as ($body$;
  v_expire_after text := $body$  where id = v_token_id;

  perform sellerpilot_private.expire_qoo10_shipping_s1_activation_preclaim();

  with expired as ($body$;
  v_order_before text := $body$   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)
         then 0
       else 1
     end,$body$;
  v_order_after text := $body$   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)
         or sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
         then 0
       else 1
     end,$body$;
  v_exclude_before text := $body$   for update of j, c skip locked$body$;
  v_exclude_after text := $body$     and not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)
     and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(j)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
     )
   for update of j, c skip locked$body$;
begin
  if to_regprocedure(
       'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'
     ) is null then
    raise exception 'exact Qoo10 shipping S1 local 11820 claimant missing'
      using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'expire_qoo10_shipping_s1_activation_preclaim') > 0
     and pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_activation_claim_priority') > 0
     and pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_verifier_job_matches') > 0
  then
    return;
  end if;
  if pg_catalog.strpos(v_definition, v_expire_before) = 0
     or pg_catalog.strpos(v_definition, v_order_before) = 0
     or pg_catalog.strpos(v_definition, v_exclude_before) = 0
  then
    raise exception 'exact Qoo10 shipping S1 local 11820 claim patch target not found'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_expire_before, v_expire_after);
  v_definition := pg_catalog.replace(v_definition, v_order_before, v_order_after);
  v_definition := pg_catalog.replace(v_definition, v_exclude_before, v_exclude_after);
  execute v_definition;
end;
$qoo10_shipping_s1_local_claim$;

do $qoo10_shipping_s1_serverless_claim$
declare
  v_definition text;
  v_expire_before text := 'perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);';
  v_expire_after text := $body$perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);
  perform sellerpilot_private.expire_qoo10_shipping_s1_activation_preclaim();$body$;
  v_order_before text := 'when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)';
  v_order_after text := $body$when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)
         or sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)$body$;
  v_exclude_before text := 'for update of job skip locked';
  v_exclude_after text := $body$and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(job)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)
     )
   for update of job skip locked$body$;
  v_expire_hits integer;
  v_order_hits integer;
  v_exclude_hits integer;
begin
  if to_regprocedure(
       'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'
     ) is null then
    return;
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'expire_qoo10_shipping_s1_activation_preclaim') > 0
     and pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_activation_claim_priority') > 0
     and pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_activation_job_matches') > 0
  then
    return;
  end if;
  v_expire_hits := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_expire_before, '')))
    / pg_catalog.length(v_expire_before);
  v_order_hits := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_order_before, '')))
    / pg_catalog.length(v_order_before);
  v_exclude_hits := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_exclude_before, '')))
    / pg_catalog.length(v_exclude_before);
  if v_expire_hits <> 1 or v_order_hits <> 1 or v_exclude_hits <> 1 then
    raise exception 'exact Qoo10 shipping S1 serverless 183000 claim patch target not found'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_expire_before, v_expire_after);
  v_definition := pg_catalog.replace(v_definition, v_order_before, v_order_after);
  v_definition := pg_catalog.replace(v_definition, v_exclude_before, v_exclude_after);
  execute v_definition;
end;
$qoo10_shipping_s1_serverless_claim$;

revoke all on function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change(),
  sellerpilot_private.qoo10_shipping_s1_release_is_current(text),
  sellerpilot_private.qoo10_shipping_s1_requested_shipping_no(jsonb),
  sellerpilot_private.qoo10_shipping_s1_has_activation_step(jsonb),
  sellerpilot_private.qoo10_shipping_s1_named_step(jsonb,text),
  sellerpilot_private.qoo10_shipping_s1_step_checks(jsonb,text),
  sellerpilot_private.qoo10_shipping_s1_named_remote_item(jsonb,text,text),
  sellerpilot_private.qoo10_shipping_s1_readback_item(jsonb,text),
  sellerpilot_private.qoo10_shipping_s1_observed_shipping_no(jsonb,text),
  sellerpilot_private.qoo10_shipping_s1_publication_checks(jsonb),
  sellerpilot_private.qoo10_shipping_s1_publication_checks_match(jsonb,boolean),
  sellerpilot_private.qoo10_shipping_s1_provider_status(jsonb),
  sellerpilot_private.qoo10_shipping_s1_single_remote_item(jsonb,text),
  sellerpilot_private.qoo10_shipping_s1_source_observation_extract(jsonb,jsonb,jsonb,jsonb),
  sellerpilot_private.qoo10_shipping_s1_jobs_are_current(),
  sellerpilot_private.qoo10_shipping_s1_record_source_observation(),
  sellerpilot_private.qoo10_shipping_s1_activation_expectation_valid(jsonb,jsonb),
  sellerpilot_private.record_qoo10_shipping_s1_observation(uuid),
  sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(sellerpilot_private.channel_gateway_jobs),
  sellerpilot_private.qoo10_shipping_s1_activation_job_matches(sellerpilot_private.channel_gateway_jobs),
  sellerpilot_private.guard_qoo10_shipping_s1_verifier_overlap(),
  sellerpilot_private.bind_qoo10_shipping_s1_activation_claim(jsonb,jsonb),
  sellerpilot_private.guard_qoo10_shipping_s1_activation_claim_bind(),
  sellerpilot_private.qoo10_shipping_s1_activation_provider_allowed(uuid,uuid),
  sellerpilot_private.consume_qoo10_shipping_s1_activation_provider(uuid,uuid),
  sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(uuid),
  sellerpilot_private.qoo10_shipping_s1_activation_claim_expired(uuid),
  sellerpilot_private.expire_qoo10_shipping_s1_activation_preclaim(),
  sellerpilot_private.qoo10_shipping_s1_activation_listing_update_allowed(jsonb,jsonb,text),
  sellerpilot_private.apply_qoo10_shipping_s1_activation_listing(uuid),
  sellerpilot_private.record_qoo10_shipping_s1_activation_outcome(uuid),
  sellerpilot_private.qoo10_shipping_s1_source_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  public.sellerpilot_service_get_qoo10_shipping_s1_release_status(uuid,uuid,text),
  public.sellerpilot_service_enqueue_qoo10_shipping_s1_verifier(uuid,text),
  public.sellerpilot_service_enqueue_qoo10_shipping_s1_activation(uuid,text),
  public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  )
  from public, anon, authenticated, service_role;

grant execute on function
  public.sellerpilot_service_get_qoo10_shipping_s1_release_status(uuid,uuid,text),
  public.sellerpilot_service_enqueue_qoo10_shipping_s1_verifier(uuid,text),
  public.sellerpilot_service_enqueue_qoo10_shipping_s1_activation(uuid,text),
  public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid),
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  )
  to service_role;

do $qoo10_shipping_s1_serverless_acl$
begin
  if to_regprocedure(
       'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
     ) is null then
    return;
  end if;
  execute $rev$revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
    from public, anon, authenticated$rev$;
  execute $gr$grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
    to service_role$gr$;
end;
$qoo10_shipping_s1_serverless_acl$;

comment on table sellerpilot_private.qoo10_shipping_s1_source_observations is
  'Immutable ShippingNo 0->806971 evidence taken from the create and update jobs; those jobs are never rewritten.';
comment on table sellerpilot_private.qoo10_shipping_s1_observations is
  'Fresh read-only S1 verifier evidence; never authorizes a provider write by itself.';
comment on table sellerpilot_private.qoo10_shipping_s1_activation_permits is
  'One job/claim/provider-boundary permit for listing.activate with expectedState.shippingNo=806971.';
comment on function public.sellerpilot_service_enqueue_qoo10_shipping_s1_verifier(uuid,text) is
  'Enqueues one listing.publication.verify read-only probe for the Lotte Qoo10 shipping S1 recovery.';
comment on function public.sellerpilot_service_enqueue_qoo10_shipping_s1_activation(uuid,text) is
  'Arms one single-use listing.activate whose expectedState.shippingNo is the observed 806971.';

commit;
