-- Promote Temu into the verified publication release as the eighth channel.
-- The migration is deliberately forward-only: it closes any inherited release
-- opening, expands the two publication-ledger channel constraints, seeds a
-- fail-closed Temu adapter attestation, and only then extends read-only
-- publication verification and the global eight-adapter attestation contract.

begin;

do $temu_publication_installation_fence$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.operation in (
       'listing.create', 'listing.update', 'listing.stop', 'listing.activate'
     )
       and job.status in ('queued', 'running', 'reconciliation_required')
       and not (
         job.status='reconciliation_required'
         and sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
       )
  ) then
    raise exception
      'listing mutation jobs must be terminal before Temu publication release installation'
      using errcode = '55000';
  end if;

  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = false,
         opened_at = null,
         opened_release_sha = null,
         opened_channel = null,
         updated_at = clock_timestamp()
   where gate.singleton;
  if not found then
    raise exception 'listing mutation release-gate state missing'
      using errcode = '55000';
  end if;
end;
$temu_publication_installation_fence$;

-- One listing mutation remains serialized. The only overlap is a Temu
-- containment stop with the exact quarantined create job it is recovering.
-- A trigger below validates that pair against the containment source UUID.
drop index if exists sellerpilot_private.channel_gateway_jobs_one_active_listing_resource_idx;
drop index if exists sellerpilot_private.channel_gateway_jobs_one_active_per_listing_idx;
drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.publication.verify'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_fingerprint='76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799'
       and request_payload->>'periodicKey'=
             'qoo10-exact-s1:fac9c5c4-940d-4600-88f3-8f97a069dfbf'
       and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
       and request_payload#>>'{arguments,sellerpilotQoo10ExactS1Recovery}'=
             'qoo10_exact_s1_verifier_v1'
       and request_payload#>>'{arguments,publicationReviewSourceJobId}'=
             'fac9c5c4-940d-4600-88f3-8f97a069dfbf'
       and request_payload#>>'{arguments,publicationReviewId}'=
             '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       and request_payload#>>'{arguments,remoteId}'='1217336970'
       and request_payload#>>'{arguments,publicationExpectedLocale}'='ja-JP'
        then 'qoo10_exact_s1_verifier_v1'
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

alter table sellerpilot_private.listing_publication_reviews
  drop constraint if exists listing_publication_reviews_channel_check;
alter table sellerpilot_private.listing_publication_reviews
  add constraint listing_publication_reviews_channel_check check (channel in (
    'qoo10', 'shopee', 'lazada', 'coupang',
    'elevenst', 'smartstore', 'ebay', 'temu'
  ));

alter table sellerpilot_private.listing_publication_adapter_release
  drop constraint if exists listing_publication_adapter_release_channel_check;
alter table sellerpilot_private.listing_publication_adapter_release
  add constraint listing_publication_adapter_release_channel_check check (channel in (
    'qoo10', 'shopee', 'lazada', 'coupang',
    'elevenst', 'smartstore', 'ebay', 'temu'
  ));

insert into sellerpilot_private.listing_publication_adapter_release (
  channel, adapter_ready, contract_version, release_sha, verified_at, updated_at
) values (
  'temu', false, null, null, null, clock_timestamp()
)
on conflict (channel) do update
  set adapter_ready = false,
      contract_version = null,
      release_sha = null,
      verified_at = null,
      updated_at = clock_timestamp();

-- The authenticated idempotency claim predates provider-owned activation and
-- intentionally rejected every listing.activate request. Admit only the Temu
-- activation operation introduced here, keep it provider-write classified,
-- and preserve the existing safe pre-gateway retry contract. A failed
-- activation that already owns a gateway job is never revived by this claim;
-- the reaper retires only an unconsumed permit and a later operator generation
-- must claim a new attempt.
alter table sellerpilot_private.channel_operation_attempts
  drop constraint channel_operation_attempts_pre_gateway_retryable_check;
alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_pre_gateway_retryable_check
  check (
    not pre_gateway_retryable
    or (
      gateway_write_required
      and (
        operation in ('listing.create', 'listing.update', 'listing.stop')
        or (channel = 'temu' and operation = 'listing.activate')
      )
      and status = 'failed'
      and remote_id is null
    )
  );

do $temu_activation_claim_patch$
declare
  v_inner text;
  v_outer text;
  v_fail text;
  v_listing_prefix_before constant text :=
    $anchor$'listing.create', 'listing.update', 'listing.stop',$anchor$;
  v_listing_prefix_after constant text :=
    $anchor$'listing.create', 'listing.update', 'listing.stop', 'listing.activate',$anchor$;
  v_retry_before constant text :=
    $anchor$p_operation in ('listing.create', 'listing.update', 'listing.stop')$anchor$;
  v_retry_after constant text :=
    $anchor$p_operation in ('listing.create', 'listing.update', 'listing.stop', 'listing.activate')$anchor$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_301000_claim_channel_operation_pre_remote_state(uuid,text,text,text,text)'::regprocedure
  ) into v_inner;
  if sellerpilot_private.qoo10_definition_occurrences(v_inner, v_listing_prefix_before) <> 3
     or sellerpilot_private.qoo10_definition_occurrences(v_inner, v_listing_prefix_after) <> 0
     or sellerpilot_private.qoo10_definition_occurrences(v_inner, v_retry_before) <> 1
     or pg_catalog.strpos(
          v_inner,
          'or (p_operation = ''listing.activate'' and p_channel <> ''temu'')'
        ) <> 0 then
    raise exception 'Temu activation claim predecessor preimage drifted (prefix %, retry %)',
      sellerpilot_private.qoo10_definition_occurrences(v_inner, v_listing_prefix_before),
      sellerpilot_private.qoo10_definition_occurrences(v_inner, v_retry_before)
      using errcode = '55000';
  end if;
  v_inner := pg_catalog.replace(v_inner, v_listing_prefix_before, v_listing_prefix_after);
  v_inner := pg_catalog.replace(v_inner, v_retry_before, v_retry_after);
  v_inner := pg_catalog.replace(
    v_inner,
    '     or length(trim(p_idempotency_key)) not between 16 and 160',
    '     or (p_operation = ''listing.activate'' and p_channel <> ''temu'')' ||
      chr(10) || '     or length(trim(p_idempotency_key)) not between 16 and 160'
  );
  if sellerpilot_private.qoo10_definition_occurrences(
       v_inner,
       'or (p_operation = ''listing.activate'' and p_channel <> ''temu'')'
     ) <> 1 then
    raise exception 'Temu activation claim channel fence patch failed'
      using errcode = '55000';
  end if;
  execute v_inner;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)'::regprocedure
  ) into v_outer;
  if encode(extensions.digest(v_outer, 'sha256'), 'hex') is distinct from
       '6be63710e119958b8df3da93a7035c90975181898a2da8247e84b75f8581edac'
     or sellerpilot_private.qoo10_definition_occurrences(
          v_outer,
          $anchor$p_operation not in ('listing.create', 'listing.update', 'listing.stop')$anchor$
        ) <> 1
     or sellerpilot_private.qoo10_definition_occurrences(
          v_outer,
          $anchor$p_operation in ('listing.create', 'listing.update')$anchor$
        ) <> 1 then
    raise exception 'Temu activation claim wrapper preimage drifted'
      using errcode = '55000';
  end if;
  v_outer := pg_catalog.replace(
    v_outer,
    $anchor$p_operation not in ('listing.create', 'listing.update', 'listing.stop')$anchor$,
    $anchor$p_operation not in ('listing.create', 'listing.update', 'listing.stop', 'listing.activate')$anchor$
  );
  v_outer := pg_catalog.replace(
    v_outer,
    $anchor$p_operation in ('listing.create', 'listing.update')$anchor$,
    $anchor$p_operation in ('listing.create', 'listing.update', 'listing.activate')$anchor$
  );
  execute v_outer;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_fail_pre_gateway_channel_operation(uuid,integer,text)'::regprocedure
  ) into v_fail;
  if sellerpilot_private.qoo10_definition_occurrences(
       v_fail,
       $anchor$attempt.operation in ('listing.create', 'listing.update', 'listing.stop')$anchor$
     ) <> 1
     or pg_catalog.strpos(v_fail, 'attempt.channel = ''temu''') <> 0 then
    raise exception 'Temu pre-gateway failure function preimage drifted'
      using errcode = '55000';
  end if;
  v_fail := pg_catalog.replace(
    v_fail,
    $anchor$attempt.operation in ('listing.create', 'listing.update', 'listing.stop')$anchor$,
    $anchor$(attempt.operation in ('listing.create', 'listing.update', 'listing.stop')
       or (attempt.channel = 'temu' and attempt.operation = 'listing.activate'))$anchor$
  );
  execute v_fail;
end;
$temu_activation_claim_patch$;

revoke all on function
  public.sellerpilot_301000_claim_channel_operation_pre_remote_state(
    uuid,text,text,text,text
  ) from public,anon,authenticated,service_role;
revoke all on function
  public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)
  from public,anon,service_role;
grant execute on function
  public.sellerpilot_claim_channel_operation(uuid,text,text,text,text)
  to authenticated;
revoke all on function
  public.sellerpilot_service_fail_pre_gateway_channel_operation(uuid,integer,text)
  from public,anon,authenticated;
grant execute on function
  public.sellerpilot_service_fail_pre_gateway_channel_operation(uuid,integer,text)
  to service_role;

-- The pending-review registrar is otherwise unchanged. Patch only its
-- canonical channel allowlist and reject an unexpected deployed preimage.
do $temu_pending_review_registrar$
declare
  v_definition text;
  v_before constant text :=
    $allowlist$'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay'$allowlist$;
  v_after constant text :=
    $allowlist$'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu'$allowlist$;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.register_pending_listing_publication_review(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_after) = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'pending publication review registrar allowlist drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$temu_pending_review_registrar$;

-- Temu verification is fixed-egress work. Defer instead of enqueueing when
-- the policy is closed, matching the existing Coupang/Smartstore/11st path.
do $temu_pending_review_static_egress$
declare
  v_definition text;
  v_before constant text :=
    $allowlist$in ('coupang','smartstore','elevenst')$allowlist$;
  v_after constant text :=
    $allowlist$in ('coupang','smartstore','elevenst','temu')$allowlist$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_due_listing_publication_verifications(integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_after) = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'publication review static-egress predicate drifted'
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$temu_pending_review_static_egress$;

-- Temu safe-test containment and final activation are server-owned mutations.
-- Browser payloads never mint these capabilities: every permit is derived
-- from one immutable create job, listing, credential and seller lineage.
create table sellerpilot_private.temu_listing_activation_permits (
  activation_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  activation_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
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
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  goods_id text not null check (
    goods_id ~ '^[1-9][0-9]{0,18}$'
    and goods_id::numeric <= 9223372036854775807
  ),
  external_goods_id text not null check (
    length(external_goods_id) between 1 and 128
    and external_goods_id !~ '[[:cntrl:]]'
  ),
  market text not null check (length(market) <= 80),
  target_id text not null check (length(target_id) <= 160),
  activation_fingerprint text not null check (activation_fingerprint ~ '^[a-f0-9]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  request_payload_sha256 text not null check (request_payload_sha256 ~ '^[a-f0-9]{64}$'),
  request_payload_bytes integer not null check (request_payload_bytes between 2 and 128000),
  write_resource_key text not null check (write_resource_key ~ '^[a-f0-9]{64}$'),
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  bound_at timestamptz,
  consumed_at timestamptz,
  terminal_status text check (
    terminal_status is null
    or terminal_status in ('succeeded','failed','reconciliation_required')
  ),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (bound_at is null and bound_worker_token_id is null and bound_claim_token is null and consumed_at is null)
    or (bound_at is not null and bound_worker_token_id is not null and bound_claim_token is not null
      and (consumed_at is null or consumed_at >= bound_at))
  ),
  check ((terminal_status is null and completed_at is null)
    or (terminal_status is not null and completed_at is not null))
);

create unique index temu_activation_one_live_source
  on sellerpilot_private.temu_listing_activation_permits(source_job_id)
  where terminal_status is null or consumed_at is not null;
create unique index temu_activation_one_live_listing
  on sellerpilot_private.temu_listing_activation_permits(listing_id)
  where terminal_status is null or consumed_at is not null;

create table sellerpilot_private.temu_safe_test_containment_permits (
  containment_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  containment_attempt_id uuid not null unique
    references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  source_job_id uuid not null unique
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
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  goods_id text not null check (
    goods_id ~ '^[1-9][0-9]{0,18}$'
    and goods_id::numeric <= 9223372036854775807
  ),
  external_goods_id text not null check (
    length(external_goods_id) between 1 and 128
    and external_goods_id !~ '[[:cntrl:]]'
  ),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  request_payload_sha256 text not null check (request_payload_sha256 ~ '^[a-f0-9]{64}$'),
  request_payload_bytes integer not null check (request_payload_bytes between 2 and 128000),
  write_resource_key text not null check (write_resource_key ~ '^[a-f0-9]{64}$'),
  bound_worker_token_id uuid
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  bound_claim_token uuid,
  bound_at timestamptz,
  consumed_at timestamptz,
  terminal_status text check (
    terminal_status is null
    or terminal_status in ('succeeded','failed','reconciliation_required')
  ),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (listing_id, source_job_id),
  check (
    (bound_at is null and bound_worker_token_id is null and bound_claim_token is null and consumed_at is null)
    or (bound_at is not null and bound_worker_token_id is not null and bound_claim_token is not null
      and (consumed_at is null or consumed_at >= bound_at))
  ),
  check ((terminal_status is null and completed_at is null)
    or (terminal_status is not null and completed_at is not null))
);

-- A create transport timeout can be accepted remotely before Temu's exact-ID
-- list endpoint becomes consistent. Persist that uncertainty separately from
-- the provider mutation job, then perform bounded read-only discovery. The
-- discovered LONG is frozen exactly once before a containment permit exists.
create table sellerpilot_private.temu_safe_test_containment_discoveries (
  source_job_id uuid primary key
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
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  external_goods_id text not null check (
    length(external_goods_id) between 1 and 128
    and external_goods_id !~ '[[:cntrl:]]'
  ),
  discovery_fingerprint text not null check (discovery_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (
    status in ('pending','queued','verifying','discovered','contained','manual_required')
  ),
  check_count integer not null default 0 check (check_count between 0 and 5),
  next_check_at timestamptz,
  deadline_at timestamptz not null,
  last_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  discovered_goods_id text check (
    discovered_goods_id is null or (
      discovered_goods_id ~ '^[1-9][0-9]{0,18}$'
      and discovered_goods_id::numeric <= 9223372036854775807
    )
  ),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status in ('pending','queued','verifying') and discovered_goods_id is null)
    or (status in ('discovered','contained') and discovered_goods_id is not null)
    or status = 'manual_required'
  )
);

alter table sellerpilot_private.temu_listing_activation_permits enable row level security;
alter table sellerpilot_private.temu_safe_test_containment_permits enable row level security;
alter table sellerpilot_private.temu_safe_test_containment_discoveries enable row level security;
revoke all on sellerpilot_private.temu_listing_activation_permits,
  sellerpilot_private.temu_safe_test_containment_permits,
  sellerpilot_private.temu_safe_test_containment_discoveries
  from public, anon, authenticated, service_role;

create function sellerpilot_private.temu_publication_exact_long(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[1-9][0-9]{0,18}$' then
    return false;
  end if;
  return p_value::numeric <= 9223372036854775807;
exception when numeric_value_out_of_range or invalid_text_representation then
  return false;
end;
$$;

create function sellerpilot_private.temu_publication_asset_identity(p_binding jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with identity_rows as (
    select jsonb_agg(jsonb_build_object(
          'role',entry.value->>'role',
          'approvedObjectPath',entry.value->>'approvedObjectPath',
          'approvedSourceSha256',entry.value->>'approvedSourceSha256'
        ) order by entry.ordinality)
          as images
          from jsonb_array_elements(case
                 when jsonb_typeof(p_binding->'approvedDetailImages')='array'
                   then p_binding->'approvedDetailImages'
                 else '[]'::jsonb
               end)
               with ordinality entry(value,ordinality)
         having count(*) = 8
            and count(distinct entry.value->>'role') = 8
            and count(distinct entry.value->>'approvedObjectPath') = 8
            and count(distinct entry.value->>'approvedSourceSha256') = 8
            and bool_and(coalesce(entry.value->>'role','') <> '')
            and bool_and(coalesce(entry.value->>'approvedObjectPath','') <> '')
            and bool_and(coalesce(entry.value->>'approvedSourceSha256','') ~ '^[a-f0-9]{64}$')
  )
  select case
    when jsonb_typeof(p_binding) = 'object'
     and p_binding->>'contract' = 'sellerpilot_publication_asset_binding_v1'
     and p_binding->>'providerImageSurface' = 'detail_content'
     and coalesce(p_binding->>'approvedManifestDigest','') ~ '^[a-f0-9]{64}$'
     and jsonb_typeof(p_binding->'approvedDetailPageVersion') = 'number'
     and coalesce(p_binding->>'approvedDetailPageVersion','') ~ '^[1-9][0-9]*$'
     and jsonb_typeof(p_binding->'approvedDetailImages') = 'array'
     and jsonb_array_length(p_binding->'approvedDetailImages') = 8
     and identity_rows.images is not null
    then jsonb_build_object(
      'contract',p_binding->>'contract',
      'approvedDetailPageVersion',p_binding->'approvedDetailPageVersion',
      'approvedManifestDigest',p_binding->>'approvedManifestDigest',
      'images',identity_rows.images
    )
    else null
  end from identity_rows
$$;

create function sellerpilot_private.temu_activation_context(
  p_owner_id uuid,
  p_product_id uuid,
  p_listing_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_listing sellerpilot_private.product_listings%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_goods_id text;
  v_external_goods_id text;
  v_arguments jsonb;
  v_fingerprint text;
  v_generation integer;
  v_claim_key text;
begin
  select * into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id
     and listing.owner_id = p_owner_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'temu'
     and listing.market = coalesce(p_market,'')
     and listing.target_id = coalesce(p_target_id,'')
     and listing.status = 'paused'
     and listing.requested_publication_intent = 'safe_test'
     and listing.remote_visibility in ('non_public','withdrawn')
     and listing.remote_id is not null;
  if not found then return null; end if;

  select * into v_product
    from sellerpilot_private.products product
   where product.id=p_product_id and product.owner_id=p_owner_id
     and not product.demo
     and product.detail_page_version=product.detail_page_approved_version
     and product.detail_page_approved_version is not null
     and product.detail_page_image_manifest->>'contract'=
          'sellerpilot_detail_image_manifest_v2'
     and product.detail_page_image_manifest->>'algorithm'='sha256'
     and product.detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
     and jsonb_typeof(product.detail_page_image_manifest->'images')='array'
     and jsonb_array_length(product.detail_page_image_manifest->'images')=8;
  if not found then return null; end if;

  select * into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'temu'
     and credential.status = 'active'
     and credential.seller_account_key is not null
     and credential.seller_account_key = v_listing.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and (credential.expires_at is null or credential.expires_at > statement_timestamp());
  if not found then return null; end if;

  v_goods_id := v_listing.remote_resources#>>'{resources,goodsId}';
  v_external_goods_id := v_listing.remote_resources#>>'{resources,externalGoodsId}';
  if not sellerpilot_private.temu_publication_exact_long(v_goods_id)
     or v_goods_id <> v_listing.remote_id
     or coalesce(v_external_goods_id,'') = '' then
    return null;
  end if;

  select source.* into v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.listing_id = v_listing.id
     and source.attempt_id = v_listing.operation_attempt_id
     and source.credential_id = v_credential.id
     and source.created_by = p_owner_id
     and source.channel = 'temu'
     and source.operation = 'listing.create'
     and source.status = 'succeeded'
     and source.seller_account_key = v_listing.seller_account_key
     and source.provider_mutation_started_at is not null
     and source.completed_at is not null
     and source.request_fingerprint ~ '^[a-f0-9]{64}$'
     and source.request_payload#>>'{arguments,publicationIntent}' = 'safe_test'
     and source.request_payload#>>'{arguments,publicationStateContract}' = 'verified_remote_state_v1'
     and source.request_payload#>>'{arguments,publicationExpectedLocale}' = 'ko-KR'
     and source.request_payload#>>'{arguments,publicationExpectedImageCount}' = '8'
     and source.request_payload#>>'{arguments,body,goodsBasic,externalGoodsId}' = v_external_goods_id
     and sellerpilot_private.temu_publication_asset_identity(
           source.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
         ) is not null
     and source.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}'=
          v_product.detail_page_approved_version::text
     and source.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}'=
          v_product.detail_page_image_manifest->>'digest'
     and not exists(
       select 1
         from jsonb_array_elements(
           source.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
         ) with ordinality bound(image,position)
         full join jsonb_array_elements(v_product.detail_page_image_manifest->'images')
           with ordinality current_image(image,position)
           using(position)
        where bound.image is null or current_image.image is null
           or bound.image->>'role'<>current_image.image->>'role'
           or bound.image->>'approvedObjectPath'<>current_image.image->>'path'
           or bound.image->>'approvedSourceSha256'<>current_image.image->>'sourceSha256'
     )
     and source.response_payload->>'ok' = 'true'
     and source.response_payload->>'publicationFulfilled' = 'true'
     and source.response_payload->>'publicationIntent' = 'safe_test'
     and source.response_payload->>'remoteId' = v_goods_id
     and source.response_payload#>>'{remoteState,verified}' = 'true'
     and source.response_payload#>>'{remoteState,visibility}' in ('non_public','withdrawn')
     and source.response_payload#>>'{remoteState,resources,goodsId}' = v_goods_id
     and source.response_payload#>>'{remoteState,resources,externalGoodsId}' = v_external_goods_id
     and source.response_payload#>>'{remoteState,locale}' = 'ko-KR'
     and source.response_payload#>>'{remoteState,fingerprint}' = source.request_fingerprint
     and source.response_payload#>>'{remoteState,imageCount}' = '8'
     and not exists (
       select 1 from sellerpilot_private.channel_gateway_jobs duplicate
        where duplicate.id <> source.id
          and duplicate.listing_id = source.listing_id
          and duplicate.channel = 'temu'
          and duplicate.operation = 'listing.create'
          and duplicate.status = 'succeeded'
     )
   order by source.completed_at desc, source.id
   limit 1;
  if not found then return null; end if;

  -- An active or provider-bound activation is never given another claim key.
  -- Only terminal, proven-unconsumed attempts advance the DB-owned generation.
  if exists (
    select 1
      from sellerpilot_private.temu_listing_activation_permits permit
     where permit.listing_id = v_listing.id
       and (
         permit.terminal_status is null
         or permit.consumed_at is not null
         or permit.terminal_status <> 'failed'
       )
  ) then
    return null;
  end if;
  select 1 + count(*)::integer into v_generation
    from sellerpilot_private.temu_listing_activation_permits permit
   where permit.listing_id = v_listing.id
     and permit.source_job_id = v_source.id
     and permit.terminal_status = 'failed'
     and permit.consumed_at is null;
  v_claim_key := 'temu-activation:' || encode(extensions.digest(
    concat_ws('|','temu-activation-claim-v1',v_source.id::text,
      v_listing.id::text,v_credential.id::text,v_generation::text),
    'sha256'
  ),'hex');

  v_fingerprint := encode(extensions.digest(
    concat_ws('|','temu-activation-v1',v_source.id::text,
      v_listing.id::text,p_product_id::text,v_credential.id::text,p_owner_id::text,
      v_listing.seller_account_key,v_goods_id,v_external_goods_id,
      v_listing.market,v_listing.target_id,v_generation::text),
    'sha256'
  ),'hex');
  v_arguments := ((v_source.request_payload->'arguments')
      - 'sellerpilotTemuActivation'::text - 'sellerpilotTemuContainment'::text)
    || jsonb_build_object(
      'goodsId',v_goods_id,
      'externalGoodsId',v_external_goods_id,
      'publicationIntent','live',
      'sellerpilotTemuActivation',jsonb_build_object(
        'version','temu_verified_non_public_activation_v1',
        'sourceJobId',v_source.id,
        'listingId',v_listing.id,
        'goodsId',v_goods_id,
        'externalGoodsId',v_external_goods_id,
        'activationFingerprint',v_fingerprint,
        'credentialId',v_credential.id,
        'ownerId',p_owner_id,
        'market',v_listing.market,
        'targetId',v_listing.target_id,
        'generation',v_generation
      )
    );
  return jsonb_build_object(
    'status','allowed',
    'contract','temu_verified_non_public_activation_context_v1',
    'sourceJobId',v_source.id,
    'sourceAttemptId',v_source.attempt_id,
    'sellerAccountKey',v_listing.seller_account_key,
    'assetIdentity',sellerpilot_private.temu_publication_asset_identity(
      v_source.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
    ),
    'activationGeneration',v_generation,
    'claimIdempotencyKey',v_claim_key,
    'activationFingerprint',v_fingerprint,
    'arguments',v_arguments
  );
end;
$$;

create function public.sellerpilot_service_get_temu_activation_context(
  p_owner_id uuid,
  p_product_id uuid,
  p_listing_id uuid,
  p_credential_id uuid,
  p_market text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_context jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  v_context := sellerpilot_private.temu_activation_context(
    p_owner_id,p_product_id,p_listing_id,p_credential_id,p_market,p_target_id
  );
  return coalesce(v_context,jsonb_build_object(
    'status','blocked','contract','temu_verified_non_public_activation_context_v1'
  ));
end;
$$;

create function public.sellerpilot_service_enqueue_temu_activation(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_context jsonb;
  v_arguments jsonb := p_request_payload->'arguments';
  v_job_id uuid := gen_random_uuid();
  v_payload_sha text;
  v_resource_key text;
  v_existing sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  if not sellerpilot_private.listing_mutation_release_gate_is_effective('temu')
     or not sellerpilot_private.serverless_static_egress_allowed('temu') then
    raise exception 'TEMU_ACTIVATION_RELEASE_OR_STATIC_EGRESS_CLOSED'
      using errcode = '55000';
  end if;
  if jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(v_arguments) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid Temu activation payload';
  end if;
  select * into v_attempt from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = p_attempt_id and attempt.credential_id = p_credential_id
     and attempt.channel = 'temu' and attempt.operation = 'listing.activate'
     and attempt.status = 'running' and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
   for update;
  if not found then raise exception 'running Temu activation attempt required'; end if;
  select * into v_listing from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id and listing.owner_id = v_attempt.owner_id
     and listing.channel_key = 'temu' for update;
  if not found then raise exception 'Temu activation listing mismatch'; end if;
  select * into v_credential from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id and credential.channel = 'temu'
     and credential.status = 'active'
     and credential.seller_account_key = v_attempt.seller_account_key
     and credential.seller_account_key = v_listing.seller_account_key
     and (credential.expires_at is null or credential.expires_at > statement_timestamp())
   for update;
  if not found then raise exception 'Temu activation credential mismatch'; end if;
  v_context := sellerpilot_private.temu_activation_context(
    v_attempt.owner_id,v_listing.product_id,v_listing.id,v_credential.id,
    v_listing.market,v_listing.target_id
  );
  if v_context is null
     or v_arguments#>'{sellerpilotTemuActivation}' is distinct from
          v_context#>'{arguments,sellerpilotTemuActivation}'
     or v_arguments->>'goodsId' is distinct from v_context#>>'{arguments,goodsId}'
     or v_arguments->>'externalGoodsId' is distinct from
          v_context#>>'{arguments,externalGoodsId}'
     or v_arguments#>>'{body,goodsBasic,externalGoodsId}' is distinct from
          v_context#>>'{arguments,body,goodsBasic,externalGoodsId}'
     or v_arguments->>'publicationIntent' <> 'live'
     or v_arguments->>'publicationStateContract' <> 'verified_remote_state_v1'
     or v_arguments->>'publicationExpectedLocale' <> 'ko-KR'
     or v_arguments->>'publicationExpectedImageCount' <> '8'
     or v_arguments->>'publicationExpectedFingerprint' is distinct from
          v_attempt.request_fingerprint
     or sellerpilot_private.temu_publication_asset_identity(
          v_arguments->'sellerpilotPublicationAssetBinding'
        ) is distinct from v_context->'assetIdentity'
     or jsonb_typeof(v_arguments#>'{body,goodsBasic,detailImage}') <> 'array'
     or jsonb_array_length(v_arguments#>'{body,goodsBasic,detailImage}') <> 8
  then
    raise exception 'Temu activation immutable context mismatch'
      using errcode = '55000';
  end if;
  select * into v_existing from sellerpilot_private.channel_gateway_jobs job
   where job.listing_id = p_listing_id and job.channel = 'temu'
     and job.operation in (
       'listing.create','listing.update','listing.stop','listing.activate',
       'price.update','inventory.update'
     )
     and job.status in ('queued','running','reconciliation_required')
   order by job.created_at,job.id for update limit 1;
  if found then
    return jsonb_build_object(
      'status',case when v_existing.status='reconciliation_required'
        then 'reconciliation_required' else 'in_progress' end,
      'job_id',v_existing.id,'attempt_id',v_existing.attempt_id,'reused',true
    );
  end if;
  select job.* into v_existing
    from sellerpilot_private.temu_listing_activation_permits permit
    join sellerpilot_private.channel_gateway_jobs job
      on job.id=permit.activation_job_id
   where (permit.listing_id=p_listing_id
      or permit.source_job_id=(v_context->>'sourceJobId')::uuid)
     and not (permit.terminal_status='failed' and permit.consumed_at is null)
   order by permit.created_at desc,permit.activation_job_id
   limit 1;
  if found then
    update sellerpilot_private.channel_operation_attempts attempt
       set status='manual_required',http_status=409,
           safe_message='Temu 공개 승격은 원격 쓰기 중복을 막기 위해 동일 QA 상품에 한 번만 허용됩니다. 기존 승격 결과를 판매자센터에서 확인해 주세요.',
           completed_at=clock_timestamp()
     where attempt.id=p_attempt_id and attempt.status='running';
    return jsonb_build_object(
      'status','reconciliation_required','job_id',v_existing.id,
      'attempt_id',v_existing.attempt_id,'reused',true,
      'manualRequired',true
    );
  end if;
  v_payload_sha := encode(extensions.digest(p_request_payload::text,'sha256'),'hex');
  v_resource_key := encode(extensions.digest(
    pg_catalog.convert_to('temu','UTF8') || decode('00','hex') ||
    pg_catalog.convert_to('listing_mutation','UTF8') || decode('00','hex') ||
    pg_catalog.convert_to(p_listing_id::text,'UTF8'),'sha256'
  ),'hex');
  perform pg_catalog.set_config('sellerpilot.temu_activation_enqueue',v_job_id::text,true);
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,
    write_resource_kind,write_resource_key,created_by,created_at,updated_at
  ) values (
    v_job_id,v_credential.id,v_attempt.id,v_listing.id,'temu','listing.activate',
    v_credential.environment,p_request_payload,'queued',v_listing.seller_account_key,
    v_attempt.request_fingerprint,'listing_mutation',v_resource_key,v_attempt.owner_id,
    clock_timestamp(),clock_timestamp()
  );
  insert into sellerpilot_private.temu_listing_activation_permits (
    activation_job_id,activation_attempt_id,source_job_id,source_attempt_id,
    listing_id,product_id,credential_id,owner_id,seller_account_key,
    goods_id,external_goods_id,market,target_id,activation_fingerprint,
    request_fingerprint,request_payload_sha256,request_payload_bytes,write_resource_key
  ) values (
    v_job_id,v_attempt.id,(v_context->>'sourceJobId')::uuid,
    (v_context->>'sourceAttemptId')::uuid,v_listing.id,v_listing.product_id,
    v_credential.id,v_attempt.owner_id,v_listing.seller_account_key,
    v_arguments->>'goodsId',v_arguments->>'externalGoodsId',v_listing.market,
    v_listing.target_id,v_context->>'activationFingerprint',v_attempt.request_fingerprint,
    v_payload_sha,octet_length(p_request_payload::text),v_resource_key
  );
  update sellerpilot_private.product_listings listing
     set operation_attempt_id=v_attempt.id,status='queued',last_error=null,
         failure_class=null,updated_at=clock_timestamp()
   where listing.id=v_listing.id;
  return jsonb_build_object(
    'status','queued','job_id',v_job_id,'attempt_id',v_attempt.id,
    'listing_id',v_listing.id,'reused',false
  );
end;
$$;

-- The historical exact-Qoo10 trigger owns only Qoo10 activation rows. Temu
-- activation has an independent capability ledger and must not be interpreted
-- as the one production Qoo10 recovery item.
do $temu_scope_qoo10_activation_guard$
declare v_definition text; v_rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_qoo10_s1_activation_job_lineage()'::regprocedure
  ) into v_definition;
  v_rewritten := pg_catalog.replace(
    v_definition,
    'if new.operation <> ''listing.activate'' then return new; end if;',
    'if new.operation <> ''listing.activate'' or new.channel <> ''qoo10'' then return new; end if;'
  );
  v_rewritten := pg_catalog.replace(
    v_rewritten,
    'if old.operation <> ''listing.activate'' and new.operation <> ''listing.activate'' then',
    'if old.channel <> ''qoo10'' and new.channel <> ''qoo10'' then return new; end if;' ||
      chr(10) || '  if old.operation <> ''listing.activate'' and new.operation <> ''listing.activate'' then'
  );
  if v_rewritten = v_definition
     or pg_catalog.strpos(v_rewritten,
          'new.operation <> ''listing.activate'' or new.channel <> ''qoo10''') = 0
     or pg_catalog.strpos(v_rewritten,
          'old.channel <> ''qoo10'' and new.channel <> ''qoo10''') = 0 then
    raise exception 'Qoo10 activation guard scoping preimage drifted'
      using errcode = '55000';
  end if;
  execute v_rewritten;
end;
$temu_scope_qoo10_activation_guard$;

create function sellerpilot_private.guard_temu_server_owned_mutation_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_marker text;
begin
  if tg_op = 'DELETE' then
    if old.channel='temu' and (
      old.operation='listing.activate'
      or old.request_payload#>>'{arguments,sellerpilotTemuContainment,version}' =
           'temu_safe_test_containment_v1'
      or old.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}' =
           'temu_safe_test_containment_discovery_v1'
    ) then
      raise exception 'Temu server-owned mutation lineage is immutable';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.channel <> 'temu' then return new; end if;
    if new.operation='listing.publication.verify'
       and new.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'=
            'temu_safe_test_containment_discovery_v1' then
      v_marker := current_setting('sellerpilot.temu_discovery_enqueue',true);
      if v_marker is distinct from new.id::text
         or new.status<>'queued' or new.attempt_count<>0
         or new.environment<>'production' or new.listing_id is null
         or new.attempt_id is not null or new.seller_account_key is null
         or new.write_resource_kind is not null or new.write_resource_key is not null
         or new.request_fingerprint !~ '^[a-f0-9]{64}$'
         or new.request_payload#>'{arguments,sellerpilotReadOnly}'<>'true'::jsonb
         or not exists(
           select 1 from sellerpilot_private.channel_gateway_jobs source
            where source.id=(new.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,sourceJobId}')::uuid
              and source.attempt_id=(new.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,sourceAttemptId}')::uuid
              and source.listing_id=new.listing_id
              and source.credential_id=new.credential_id
              and source.created_by=new.created_by
              and source.seller_account_key=new.seller_account_key
              and source.channel='temu' and source.operation='listing.create'
              and source.status='reconciliation_required'
         )
      then raise exception 'Temu containment discovery enqueue lineage invalid'
        using errcode='55000'; end if;
    elsif new.operation = 'listing.activate' then
      v_marker := current_setting('sellerpilot.temu_activation_enqueue',true);
      if v_marker is distinct from new.id::text
         or new.status <> 'queued' or new.attempt_count <> 0
         or new.environment <> 'production'
         or new.listing_id is null or new.attempt_id is null
         or new.seller_account_key is null
         or new.write_resource_kind <> 'listing_mutation'
         or new.write_resource_key !~ '^[a-f0-9]{64}$'
         or new.request_fingerprint !~ '^[a-f0-9]{64}$'
         or new.request_payload#>>'{arguments,sellerpilotTemuActivation,version}' <>
              'temu_verified_non_public_activation_v1'
         or new.request_payload#>>'{arguments,sellerpilotTemuActivation,listingId}' <>
              new.listing_id::text
      then raise exception 'Temu activation enqueue lineage invalid' using errcode='55000';
      end if;
    elsif new.request_payload#>>'{arguments,sellerpilotTemuContainment,version}' =
            'temu_safe_test_containment_v1' then
      v_marker := current_setting('sellerpilot.temu_containment_enqueue',true);
      if v_marker is distinct from new.id::text
         or new.operation <> 'listing.stop' or new.status <> 'queued'
         or new.attempt_count <> 0 or new.environment <> 'production'
         or new.listing_id is null or new.attempt_id is null
         or new.seller_account_key is null
         or new.write_resource_kind <> 'listing_mutation'
         or new.write_resource_key !~ '^[a-f0-9]{64}$'
         or new.request_fingerprint !~ '^[a-f0-9]{64}$'
      then raise exception 'Temu containment enqueue lineage invalid' using errcode='55000';
      end if;
    end if;
    return new;
  end if;

  if old.channel='temu' and (
      old.operation='listing.activate'
      or old.request_payload#>>'{arguments,sellerpilotTemuContainment,version}' =
           'temu_safe_test_containment_v1'
      or old.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}' =
           'temu_safe_test_containment_discovery_v1'
    ) then
    if new.channel is distinct from old.channel
       or new.operation is distinct from old.operation
       or new.credential_id is distinct from old.credential_id
       or new.attempt_id is distinct from old.attempt_id
       or new.listing_id is distinct from old.listing_id
       or new.environment is distinct from old.environment
       or new.request_payload is distinct from old.request_payload
       or new.request_fingerprint is distinct from old.request_fingerprint
       or new.seller_account_key is distinct from old.seller_account_key
       or new.write_resource_kind is distinct from old.write_resource_kind
       or new.write_resource_key is distinct from old.write_resource_key
    then raise exception 'Temu server-owned mutation lineage is immutable'
      using errcode='55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_temu_server_owned_mutation_job
before insert or update or delete on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.guard_temu_server_owned_mutation_job();

create function sellerpilot_private.guard_temu_listing_mutation_serialization()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_containment_source uuid;
begin
  if new.channel<>'temu' or new.listing_id is null
     or new.operation not in (
       'listing.create','listing.update','listing.stop','listing.activate',
       'price.update','inventory.update'
     )
     or new.status not in ('queued','running','reconciliation_required') then
    return new;
  end if;
  perform 1 from sellerpilot_private.product_listings listing
   where listing.id=new.listing_id for update;
  begin
    v_containment_source := nullif(
      new.request_payload#>>'{arguments,sellerpilotTemuContainment,sourceJobId}',''
    )::uuid;
  exception when others then
    raise exception 'Temu containment source job invalid' using errcode='55000';
  end;
  if exists(
    select 1 from sellerpilot_private.channel_gateway_jobs active
     where active.id<>new.id and active.channel='temu'
       and active.listing_id=new.listing_id
       and active.operation in (
         'listing.create','listing.update','listing.stop','listing.activate',
         'price.update','inventory.update'
       )
       and active.status in ('queued','running','reconciliation_required')
       and not (
         v_containment_source is not null
         and new.operation='listing.stop'
         and active.id=v_containment_source
         and active.operation='listing.create'
         and active.status='reconciliation_required'
       )
  ) then
    raise exception 'TEMU_LISTING_MUTATION_ALREADY_ACTIVE' using errcode='55000';
  end if;
  return new;
end;
$$;

create trigger guard_temu_listing_mutation_serialization
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_temu_listing_mutation_serialization();

create function sellerpilot_private.bind_temu_server_owned_mutation_claim(
  p_old jsonb,p_new jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_job_id uuid; v_bound boolean := false;
begin
  if jsonb_typeof(p_old)<>'object' or jsonb_typeof(p_new)<>'object'
     or p_old->>'status'<>'queued' or p_new->>'status'<>'running'
     or p_old->>'channel'<>'temu' or p_new->>'channel'<>'temu'
     or p_new->>'id' is distinct from p_old->>'id'
     or p_new->'credential_id' is distinct from p_old->'credential_id'
     or p_new->'attempt_id' is distinct from p_old->'attempt_id'
     or p_new->'listing_id' is distinct from p_old->'listing_id'
     or p_new->'request_payload' is distinct from p_old->'request_payload'
     or p_new->'request_fingerprint' is distinct from p_old->'request_fingerprint'
     or p_new->'seller_account_key' is distinct from p_old->'seller_account_key'
     or p_new->'write_resource_key' is distinct from p_old->'write_resource_key'
     or (p_old->>'attempt_count')::integer not between 0 and 3
     or (p_new->>'attempt_count')::integer<>
          (p_old->>'attempt_count')::integer+1
     or p_old->'worker_token_id'<>'null'::jsonb
     or p_old->'claim_token'<>'null'::jsonb
     or p_new->'worker_token_id'='null'::jsonb
     or p_new->'claim_token'='null'::jsonb
     or p_old->'provider_mutation_started_at'<>'null'::jsonb
     or p_new->'provider_mutation_started_at'<>'null'::jsonb
  then return false; end if;
  v_job_id := (p_new->>'id')::uuid;
  if p_new->>'operation'='listing.activate' then
    update sellerpilot_private.temu_listing_activation_permits permit
       set bound_at=clock_timestamp(),
           bound_worker_token_id=(p_new->>'worker_token_id')::uuid,
           bound_claim_token=(p_new->>'claim_token')::uuid
     where permit.activation_job_id=v_job_id
       and permit.consumed_at is null and permit.terminal_status is null
       and permit.activation_attempt_id=(p_new->>'attempt_id')::uuid
       and permit.listing_id=(p_new->>'listing_id')::uuid
       and permit.credential_id=(p_new->>'credential_id')::uuid
       and permit.seller_account_key=p_new->>'seller_account_key'
       and permit.request_fingerprint=p_new->>'request_fingerprint'
       and permit.write_resource_key=p_new->>'write_resource_key'
       and permit.request_payload_sha256=encode(extensions.digest(
             (p_new->'request_payload')::text,'sha256'),'hex')
       and permit.request_payload_bytes=octet_length((p_new->'request_payload')::text);
    v_bound := found;
    if not v_bound then
      select exists(select 1
        from sellerpilot_private.temu_listing_activation_permits permit
       where permit.activation_job_id=v_job_id
         and permit.bound_worker_token_id=(p_new->>'worker_token_id')::uuid
         and permit.bound_claim_token=(p_new->>'claim_token')::uuid
         and permit.bound_at is not null and permit.consumed_at is null)
      into v_bound;
    end if;
  elsif p_new->>'operation'='listing.stop'
    and p_new#>>'{request_payload,arguments,sellerpilotTemuContainment,version}' =
          'temu_safe_test_containment_v1' then
    update sellerpilot_private.temu_safe_test_containment_permits permit
       set bound_at=clock_timestamp(),
           bound_worker_token_id=(p_new->>'worker_token_id')::uuid,
           bound_claim_token=(p_new->>'claim_token')::uuid
     where permit.containment_job_id=v_job_id
       and permit.consumed_at is null and permit.terminal_status is null
       and permit.containment_attempt_id=(p_new->>'attempt_id')::uuid
       and permit.listing_id=(p_new->>'listing_id')::uuid
       and permit.credential_id=(p_new->>'credential_id')::uuid
       and permit.seller_account_key=p_new->>'seller_account_key'
       and permit.request_fingerprint=p_new->>'request_fingerprint'
       and permit.write_resource_key=p_new->>'write_resource_key'
       and permit.request_payload_sha256=encode(extensions.digest(
             (p_new->'request_payload')::text,'sha256'),'hex')
       and permit.request_payload_bytes=octet_length((p_new->'request_payload')::text);
    v_bound := found;
    if not v_bound then
      select exists(select 1
        from sellerpilot_private.temu_safe_test_containment_permits permit
       where permit.containment_job_id=v_job_id
         and permit.bound_worker_token_id=(p_new->>'worker_token_id')::uuid
         and permit.bound_claim_token=(p_new->>'claim_token')::uuid
         and permit.bound_at is not null and permit.consumed_at is null)
      into v_bound;
    end if;
  end if;
  return v_bound;
exception when others then return false;
end;
$$;

create function sellerpilot_private.bind_temu_server_owned_mutation_claim_trigger()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='queued' and new.status='running' and new.channel='temu'
     and (new.operation='listing.activate'
       or new.request_payload#>>'{arguments,sellerpilotTemuContainment,version}'=
            'temu_safe_test_containment_v1')
     and not sellerpilot_private.bind_temu_server_owned_mutation_claim(
       to_jsonb(old),to_jsonb(new)
     ) then
    raise exception 'Temu server-owned mutation claim binding failed'
      using errcode='55000';
  end if;
  return new;
end;
$$;

create trigger a_bind_temu_server_owned_mutation_claim
before update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.bind_temu_server_owned_mutation_claim_trigger();

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
       or sellerpilot_private.bind_temu_server_owned_mutation_claim(
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

create function sellerpilot_private.temu_activation_provider_allowed(
  p_job_id uuid,p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
      from sellerpilot_private.temu_listing_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=permit.activation_job_id
      join sellerpilot_private.product_listings listing
        on listing.id=permit.listing_id
      join sellerpilot_private.products product
        on product.id=permit.product_id
     where permit.activation_job_id=p_job_id
       and permit.bound_claim_token=p_claim_token
       and permit.bound_worker_token_id=job.worker_token_id
       and permit.bound_at is not null and permit.consumed_at is null
       and permit.terminal_status is null
       and job.channel='temu' and job.operation='listing.activate'
       and job.status='running' and job.claim_token=p_claim_token
       and job.attempt_count=1 and job.lease_expires_at>statement_timestamp()
       and job.provider_mutation_started_at is null
       and job.response_payload is null and job.completed_at is null
       and job.credential_id=permit.credential_id
       and job.attempt_id=permit.activation_attempt_id
       and job.listing_id=permit.listing_id
       and job.seller_account_key=permit.seller_account_key
       and job.request_fingerprint=permit.request_fingerprint
       and job.write_resource_key=permit.write_resource_key
       and permit.request_payload_sha256=encode(extensions.digest(
             job.request_payload::text,'sha256'),'hex')
       and permit.request_payload_bytes=octet_length(job.request_payload::text)
       and listing.owner_id=permit.owner_id and listing.product_id=permit.product_id
       and listing.seller_account_key=permit.seller_account_key
       and listing.status='queued'
       and listing.operation_attempt_id=permit.activation_attempt_id
       and listing.requested_publication_intent='safe_test'
       and listing.remote_visibility in ('non_public','withdrawn')
       and listing.remote_id=permit.goods_id
       and listing.remote_resources#>>'{resources,goodsId}'=permit.goods_id
       and listing.remote_resources#>>'{resources,externalGoodsId}'=permit.external_goods_id
       and product.owner_id=permit.owner_id
       and product.id=listing.product_id
       and product.detail_page_approved_version is not null
       and product.detail_page_version=product.detail_page_approved_version
       and product.detail_page_image_manifest->>'contract'=
            'sellerpilot_detail_image_manifest_v2'
       and product.detail_page_image_manifest->>'algorithm'='sha256'
       and product.detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
       and jsonb_typeof(product.detail_page_image_manifest->'images')='array'
       and jsonb_array_length(product.detail_page_image_manifest->'images')=8
       and sellerpilot_private.temu_publication_asset_identity(
             job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
           ) is not null
       and job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}'=
            product.detail_page_approved_version::text
       and job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}'=
            product.detail_page_image_manifest->>'digest'
       and not exists(
         select 1
           from jsonb_array_elements(
             job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
           ) with ordinality bound(image,position)
           full join jsonb_array_elements(product.detail_page_image_manifest->'images')
             with ordinality current_image(image,position)
             using(position)
          where bound.image is null or current_image.image is null
             or bound.image->>'role'<>current_image.image->>'role'
             or bound.image->>'approvedObjectPath'<>current_image.image->>'path'
             or bound.image->>'approvedSourceSha256'<>current_image.image->>'sourceSha256'
       )
       and sellerpilot_private.listing_mutation_release_gate_is_effective('temu')
       and sellerpilot_private.serverless_static_egress_allowed('temu')
  )
$$;

create function sellerpilot_private.temu_containment_provider_allowed(
  p_job_id uuid,p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
      from sellerpilot_private.temu_safe_test_containment_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=permit.containment_job_id
      join sellerpilot_private.channel_gateway_jobs source
        on source.id=permit.source_job_id
     where permit.containment_job_id=p_job_id
       and permit.bound_claim_token=p_claim_token
       and permit.bound_worker_token_id=job.worker_token_id
       and permit.bound_at is not null and permit.consumed_at is null
       and permit.terminal_status is null
       and job.channel='temu' and job.operation='listing.stop'
       and job.request_payload#>>'{arguments,sellerpilotTemuContainment,version}'=
            'temu_safe_test_containment_v1'
       and job.status='running' and job.claim_token=p_claim_token
       and job.attempt_count=1 and job.lease_expires_at>statement_timestamp()
       and job.provider_mutation_started_at is null
       and job.response_payload is null and job.completed_at is null
       and job.credential_id=permit.credential_id
       and job.attempt_id=permit.containment_attempt_id
       and job.listing_id=permit.listing_id
       and job.seller_account_key=permit.seller_account_key
       and job.request_fingerprint=permit.request_fingerprint
       and job.write_resource_key=permit.write_resource_key
       and permit.request_payload_sha256=encode(extensions.digest(
             job.request_payload::text,'sha256'),'hex')
       and permit.request_payload_bytes=octet_length(job.request_payload::text)
       and source.channel='temu' and source.operation='listing.create'
       and source.status='reconciliation_required'
       and source.id=permit.source_job_id and source.attempt_id=permit.source_attempt_id
       and source.listing_id=permit.listing_id and source.credential_id=permit.credential_id
       and source.request_payload#>>'{arguments,publicationIntent}'='safe_test'
       and (
         source.response_payload->>'remoteId'=permit.goods_id
         or exists(
           select 1
             from sellerpilot_private.temu_safe_test_containment_discoveries discovery
            where discovery.source_job_id=source.id
              and discovery.status='discovered'
              and discovery.discovered_goods_id=permit.goods_id
         )
       )
       and source.request_payload#>>'{arguments,body,goodsBasic,externalGoodsId}'=
            permit.external_goods_id
       and sellerpilot_private.serverless_static_egress_allowed('temu')
  )
$$;

create function sellerpilot_private.consume_temu_server_owned_mutation_provider(
  p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  update sellerpilot_private.temu_listing_activation_permits permit
     set consumed_at=clock_timestamp()
   where permit.activation_job_id=p_job_id
     and permit.bound_claim_token=p_claim_token and permit.consumed_at is null
     and exists(select 1 from sellerpilot_private.channel_gateway_jobs job
       where job.id=p_job_id and job.status='running'
         and job.claim_token=p_claim_token
         and job.provider_mutation_started_at is not null
         and job.completed_at is null);
  if found then return true; end if;
  update sellerpilot_private.temu_safe_test_containment_permits permit
     set consumed_at=clock_timestamp()
   where permit.containment_job_id=p_job_id
     and permit.bound_claim_token=p_claim_token and permit.consumed_at is null
     and exists(select 1 from sellerpilot_private.channel_gateway_jobs job
       where job.id=p_job_id and job.status='running'
         and job.claim_token=p_claim_token
         and job.provider_mutation_started_at is not null
         and job.completed_at is null);
  return found;
end;
$$;

create function sellerpilot_private.schedule_temu_safe_test_containment_discovery(
  p_source_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_external_goods_id text;
  v_known_goods_id text;
  v_fingerprint text;
begin
  select * into v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id=p_source_job_id
     and source.channel='temu' and source.operation='listing.create'
     and source.status='reconciliation_required'
     and source.request_payload#>>'{arguments,publicationIntent}'='safe_test'
     and source.request_payload#>>'{arguments,publicationStateContract}'=
          'verified_remote_state_v1'
     and source.request_payload#>>'{arguments,publicationExpectedLocale}'='ko-KR'
     and source.provider_mutation_started_at is not null
     and source.completed_at is not null
     and source.attempt_id is not null and source.listing_id is not null
     and source.request_payload#>>'{arguments,sellerpilotTemuCreateCorrelation,version}'=
          'temu_create_attempt_external_id_v1'
     and source.request_payload#>>'{arguments,sellerpilotTemuCreateCorrelation,externalGoodsId}'=
          source.request_payload#>>'{arguments,body,goodsBasic,externalGoodsId}'
   for update;
  if not found then return false; end if;
  v_external_goods_id:=
    v_source.request_payload#>>'{arguments,body,goodsBasic,externalGoodsId}';
  v_known_goods_id:=nullif(v_source.response_payload->>'remoteId','');
  if v_known_goods_id is not null
     and not sellerpilot_private.temu_publication_exact_long(v_known_goods_id) then
    v_known_goods_id:=null;
  end if;
  if coalesce(v_external_goods_id,'')='' or length(v_external_goods_id)>128
     or v_external_goods_id ~ '[[:cntrl:]]' then return false; end if;
  select * into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id=v_source.listing_id
     and listing.owner_id=v_source.created_by
     and listing.channel_key='temu'
     and listing.seller_account_key=v_source.seller_account_key
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from sellerpilot_private.channel_credentials credential
     where credential.id=v_source.credential_id and credential.channel='temu'
       and credential.environment='production'
       and credential.seller_account_key=v_source.seller_account_key
  ) then return false; end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|',
    'temu-containment-discovery-v1',v_source.id::text,v_source.attempt_id::text,
    v_listing.id::text,v_listing.product_id::text,v_source.credential_id::text,
    v_source.created_by::text,v_source.seller_account_key,v_external_goods_id
  ),'sha256'),'hex');
  insert into sellerpilot_private.temu_safe_test_containment_discoveries(
    source_job_id,source_attempt_id,listing_id,product_id,credential_id,
    owner_id,seller_account_key,external_goods_id,discovery_fingerprint,
    status,next_check_at,deadline_at,discovered_goods_id
  ) values(
    v_source.id,v_source.attempt_id,v_listing.id,v_listing.product_id,
    v_source.credential_id,v_source.created_by,v_source.seller_account_key,
    v_external_goods_id,v_fingerprint,
    case when v_known_goods_id is null then 'pending' else 'discovered' end,
    case when v_known_goods_id is null then clock_timestamp()+interval '1 minute'
      else clock_timestamp() end,
    clock_timestamp()+interval '30 minutes',v_known_goods_id
  ) on conflict(source_job_id) do update
    set status=case
          when excluded.discovered_goods_id is not null
           and sellerpilot_private.temu_safe_test_containment_discoveries.status
                 in ('pending','queued','verifying')
            then 'discovered'
          else sellerpilot_private.temu_safe_test_containment_discoveries.status end,
        discovered_goods_id=coalesce(
          sellerpilot_private.temu_safe_test_containment_discoveries.discovered_goods_id,
          excluded.discovered_goods_id
        ),
        next_check_at=case
          when excluded.discovered_goods_id is not null then clock_timestamp()
          else sellerpilot_private.temu_safe_test_containment_discoveries.next_check_at end,
        updated_at=clock_timestamp()
    where sellerpilot_private.temu_safe_test_containment_discoveries.discovery_fingerprint=
          excluded.discovery_fingerprint;
  return found or exists(
    select 1 from sellerpilot_private.temu_safe_test_containment_discoveries discovery
     where discovery.source_job_id=v_source.id
       and discovery.discovery_fingerprint=v_fingerprint
  );
end;
$$;

create function sellerpilot_private.enqueue_due_temu_containment_discoveries(
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_discovery sellerpilot_private.temu_safe_test_containment_discoveries%rowtype;
  v_job_id uuid;
  v_arguments jsonb;
  v_containment jsonb;
  v_queued integer:=0;
  v_deferred integer:=0;
  v_manual integer:=0;
begin
  if p_limit not between 1 and 50 then
    raise exception 'invalid Temu containment discovery limit';
  end if;
  for v_discovery in
    select * from sellerpilot_private.temu_safe_test_containment_discoveries discovery
     where discovery.status in ('pending','discovered')
       and discovery.next_check_at<=clock_timestamp()
     order by discovery.next_check_at,discovery.source_job_id
     for update skip locked limit p_limit
  loop
    if v_discovery.check_count>=5 or v_discovery.deadline_at<=clock_timestamp() then
      update sellerpilot_private.temu_safe_test_containment_discoveries discovery
         set status='manual_required',next_check_at=null,
             last_error='Temu 외부 상품 ID가 제한 시간 안에 단일 상품으로 확인되지 않았습니다.',
             updated_at=clock_timestamp()
       where discovery.source_job_id=v_discovery.source_job_id;
      v_manual:=v_manual+1;
      continue;
    end if;
    if not sellerpilot_private.serverless_static_egress_allowed('temu')
       or not exists(
         select 1 from sellerpilot_private.channel_credentials credential
          where credential.id=v_discovery.credential_id
            and credential.channel='temu' and credential.status='active'
            and credential.environment='production'
            and credential.seller_account_key=v_discovery.seller_account_key
            and (credential.expires_at is null
              or credential.expires_at>statement_timestamp())
       ) then
      update sellerpilot_private.temu_safe_test_containment_discoveries discovery
         set next_check_at=least(discovery.deadline_at,
               clock_timestamp()+interval '5 minutes'),
             last_error='Temu 고정 egress 또는 활성 credential을 기다리는 중입니다.',
             updated_at=clock_timestamp()
       where discovery.source_job_id=v_discovery.source_job_id;
      v_deferred:=v_deferred+1;
      continue;
    end if;
    if v_discovery.status='discovered' then
      v_containment:=sellerpilot_private.enqueue_temu_safe_test_containment(
        v_discovery.source_job_id
      );
      if v_containment is null then
        update sellerpilot_private.temu_safe_test_containment_discoveries discovery
           set next_check_at=least(discovery.deadline_at,
                 clock_timestamp()+interval '5 minutes'),
               last_error='Temu exact 상품 격리 작업의 원장 결속을 재시도합니다.',
               updated_at=clock_timestamp()
         where discovery.source_job_id=v_discovery.source_job_id;
        v_deferred:=v_deferred+1;
      else
        update sellerpilot_private.temu_safe_test_containment_discoveries discovery
           set next_check_at=null,last_error=null,updated_at=clock_timestamp()
         where discovery.source_job_id=v_discovery.source_job_id;
        v_queued:=v_queued+1;
      end if;
      continue;
    end if;
    v_job_id:=gen_random_uuid();
    v_arguments:=jsonb_build_object(
      'sellerpilotReadOnly',true,
      'sellerpilotTemuContainmentDiscovery',jsonb_build_object(
        'version','temu_safe_test_containment_discovery_v1',
        'sourceJobId',v_discovery.source_job_id,
        'sourceAttemptId',v_discovery.source_attempt_id,
        'listingId',v_discovery.listing_id,
        'credentialId',v_discovery.credential_id,
        'externalGoodsId',v_discovery.external_goods_id,
        'discoveryFingerprint',v_discovery.discovery_fingerprint
      )
    );
    perform pg_catalog.set_config('sellerpilot.temu_discovery_enqueue',v_job_id::text,true);
    insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,attempt_id,listing_id,channel,operation,environment,
      request_payload,status,seller_account_key,request_fingerprint,
      created_by,created_at,updated_at
    ) values(
      v_job_id,v_discovery.credential_id,null,v_discovery.listing_id,'temu',
      'listing.publication.verify','production',
      jsonb_build_object('periodicKey','temu-containment-discovery:'||
        v_discovery.source_job_id::text||':'||(v_discovery.check_count+1)::text,
        'arguments',v_arguments),
      'queued',v_discovery.seller_account_key,v_discovery.discovery_fingerprint,
      v_discovery.owner_id,clock_timestamp(),clock_timestamp()
    );
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='queued',check_count=discovery.check_count+1,
           next_check_at=null,last_job_id=v_job_id,last_error=null,
           updated_at=clock_timestamp()
     where discovery.source_job_id=v_discovery.source_job_id
       and discovery.status='pending';
    if not found then raise exception 'Temu containment discovery ownership changed'
      using errcode='40001'; end if;
    v_queued:=v_queued+1;
  end loop;
  return jsonb_build_object(
    'contract','temu_safe_test_containment_discovery_v1',
    'queued',v_queued,'deferred',v_deferred,'manualRequired',v_manual,
    'pending',(select count(*)::integer
      from sellerpilot_private.temu_safe_test_containment_discoveries discovery
      where discovery.status in ('pending','queued','verifying','discovered'))
  );
end;
$$;

create function sellerpilot_private.sync_temu_containment_discovery_job_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.channel='temu' and new.operation='listing.publication.verify'
     and new.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'=
          'temu_safe_test_containment_discovery_v1'
     and new.status='running' then
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='verifying',updated_at=clock_timestamp()
     where discovery.last_job_id=new.id and discovery.status='queued';
  elsif new.channel='temu' and new.operation='listing.publication.verify'
     and new.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'=
          'temu_safe_test_containment_discovery_v1'
     and old.status='running' and new.status='queued' then
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='queued',last_error='Temu exact 상품 조회 worker lease를 안전하게 재시도합니다.',
           updated_at=clock_timestamp()
     where discovery.last_job_id=new.id and discovery.status='verifying';
  end if;
  return new;
end;
$$;

create trigger sync_temu_containment_discovery_job_status
after insert or update of status on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.sync_temu_containment_discovery_job_status();

-- The generic seller-lineage trigger predates attempt-scoped Temu containment
-- and normally requires listing.stop to reuse the listing's previous attempt.
-- Permit only the server-owned containment job that is being inserted by the
-- private enqueue function and that is bound to the exact quarantined create.
create function sellerpilot_private.temu_containment_seller_lineage_allowed(
  p_job jsonb,
  p_listing jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_marker jsonb:=p_job#>'{request_payload,arguments,sellerpilotTemuContainment}';
  v_goods_id text:=p_job#>>'{request_payload,arguments,goodsId}';
  v_external_goods_id text:=p_job#>>'{request_payload,arguments,externalGoodsId}';
begin
  if jsonb_typeof(p_job)<>'object' or jsonb_typeof(p_listing)<>'object'
     or jsonb_typeof(v_marker)<>'object'
     or p_job->>'channel'<>'temu' or p_job->>'operation'<>'listing.stop'
     or v_marker->>'version'<>'temu_safe_test_containment_v1'
     or current_setting('sellerpilot.temu_containment_enqueue',true)
          is distinct from p_job->>'id'
     or p_job->>'id' !~ '^[0-9a-fA-F-]{36}$'
     or p_job->>'attempt_id' !~ '^[0-9a-fA-F-]{36}$'
     or p_job->>'listing_id' !~ '^[0-9a-fA-F-]{36}$'
     or p_job->>'credential_id' !~ '^[0-9a-fA-F-]{36}$'
     or p_job->>'created_by' !~ '^[0-9a-fA-F-]{36}$'
     or p_job->>'request_fingerprint' !~ '^[a-f0-9]{64}$'
     or p_job->>'request_fingerprint' is distinct from
          v_marker->>'containmentFingerprint'
     or p_job->>'listing_id' is distinct from v_marker->>'listingId'
     or p_job->>'credential_id' is distinct from v_marker->>'credentialId'
     or p_listing->>'id' is distinct from p_job->>'listing_id'
     or p_listing->>'channel_key'<>'temu'
     or p_listing->>'product_id' is distinct from v_marker->>'productId'
     or p_listing->>'seller_account_key' is null
     or p_listing->>'seller_account_key' is distinct from
          p_job->>'seller_account_key'
     or not sellerpilot_private.temu_publication_exact_long(v_goods_id)
     or v_marker->>'goodsId' is distinct from v_goods_id
     or v_marker->>'externalGoodsId' is distinct from v_external_goods_id
     or coalesce(v_external_goods_id,'')=''
  then return false; end if;

  select source.* into v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id=(v_marker->>'sourceJobId')::uuid
     and source.attempt_id=(v_marker->>'sourceAttemptId')::uuid
     and source.listing_id=(p_job->>'listing_id')::uuid
     and source.credential_id=(p_job->>'credential_id')::uuid
     and source.created_by=(p_job->>'created_by')::uuid
     and source.seller_account_key=p_job->>'seller_account_key'
     and source.channel='temu' and source.operation='listing.create'
     and source.status='reconciliation_required'
     and source.provider_mutation_started_at is not null
     and source.completed_at is not null
     and source.request_payload#>>'{arguments,publicationIntent}'='safe_test'
     and source.request_payload#>>'{arguments,publicationStateContract}'=
          'verified_remote_state_v1'
     and source.request_payload#>>'{arguments,sellerpilotTemuCreateCorrelation,version}'=
          'temu_create_attempt_external_id_v1'
     and source.request_payload#>>'{arguments,sellerpilotTemuCreateCorrelation,externalGoodsId}'=
          v_external_goods_id
     and source.request_payload#>>'{arguments,body,goodsBasic,externalGoodsId}'=
          v_external_goods_id;
  if not found
     or p_listing->>'operation_attempt_id' is distinct from
          v_source.attempt_id::text
  then return false; end if;

  return (
    nullif(v_source.response_payload->>'remoteId','')=v_goods_id
    and exists(
      select 1 from jsonb_array_elements(case
        when jsonb_typeof(v_source.response_payload->'steps')='array'
          then v_source.response_payload->'steps' else '[]'::jsonb end) entry
       where entry->>'name' in ('goods-v3-add','goods-reconcile')
         and entry->>'ok'='true'
    )
  ) or exists(
    select 1
      from sellerpilot_private.temu_safe_test_containment_discoveries discovery
     where discovery.source_job_id=v_source.id
       and discovery.source_attempt_id=v_source.attempt_id
       and discovery.listing_id=v_source.listing_id
       and discovery.credential_id=v_source.credential_id
       and discovery.seller_account_key=v_source.seller_account_key
       and discovery.status='discovered'
       and discovery.discovered_goods_id=v_goods_id
       and discovery.external_goods_id=v_external_goods_id
  );
exception when others then return false;
end;
$$;

do $temu_containment_seller_lineage_patch$
declare
  v_definition text;
  v_before text := '      if new.operation in (''listing.update'', ''listing.stop'') and (
        v_listing.operation_attempt_id is distinct from new.attempt_id
        or v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) then';
  v_after text := '      if new.operation in (''listing.update'', ''listing.stop'') and (
        v_listing.operation_attempt_id is distinct from new.attempt_id
        or v_listing.seller_account_key is null
        or v_listing.seller_account_key is distinct from v_credential_key
      ) and not sellerpilot_private.temu_containment_seller_lineage_allowed(
        to_jsonb(new),to_jsonb(v_listing)
      ) then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_gateway_job_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition,v_before)=0
     or pg_catalog.strpos(v_definition,
          'temu_containment_seller_lineage_allowed')>0 then
    raise exception 'Temu containment seller-lineage preimage drifted'
      using errcode='55000';
  end if;
  execute pg_catalog.replace(v_definition,v_before,v_after);
end;
$temu_containment_seller_lineage_patch$;

create function sellerpilot_private.enqueue_temu_safe_test_containment(
  p_source_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_job_id uuid:=gen_random_uuid();
  v_attempt_id uuid:=gen_random_uuid();
  v_goods_id text;
  v_external_goods_id text;
  v_fingerprint text;
  v_resource_key text;
  v_arguments jsonb;
  v_payload jsonb;
  v_payload_sha text;
  v_discovered_goods_id text;
  v_existing sellerpilot_private.temu_safe_test_containment_permits%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select * into v_existing
    from sellerpilot_private.temu_safe_test_containment_permits permit
   where permit.source_job_id=p_source_job_id;
  if found then return jsonb_build_object(
    'status',case when v_existing.terminal_status is null then 'in_progress'
      else v_existing.terminal_status end,
    'job_id',v_existing.containment_job_id,
    'attempt_id',v_existing.containment_attempt_id,'reused',true
  ); end if;
  select * into v_source
    from sellerpilot_private.channel_gateway_jobs source
   where source.id=p_source_job_id and source.channel='temu'
     and source.operation='listing.create'
     and source.status='reconciliation_required'
     and source.request_payload#>>'{arguments,publicationIntent}'='safe_test'
     and source.request_payload#>>'{arguments,publicationStateContract}'=
          'verified_remote_state_v1'
     and source.request_payload#>>'{arguments,publicationExpectedLocale}'='ko-KR'
     and source.provider_mutation_started_at is not null
     and source.completed_at is not null
     and (
       exists(
         select 1 from jsonb_array_elements(case
           when jsonb_typeof(source.response_payload->'steps')='array'
             then source.response_payload->'steps' else '[]'::jsonb end) entry
          where entry->>'name' in ('goods-v3-add','goods-reconcile')
            and entry->>'ok'='true'
       )
       or exists(
         select 1
           from sellerpilot_private.temu_safe_test_containment_discoveries discovery
          where discovery.source_job_id=source.id
            and discovery.status='discovered'
            and discovery.discovered_goods_id is not null
       )
     )
   for update;
  if not found then return null; end if;
  select discovery.discovered_goods_id into v_discovered_goods_id
    from sellerpilot_private.temu_safe_test_containment_discoveries discovery
   where discovery.source_job_id=v_source.id
     and discovery.status='discovered';
  v_goods_id:=coalesce(nullif(v_source.response_payload->>'remoteId',''),
    v_discovered_goods_id);
  v_external_goods_id:=
    v_source.request_payload#>>'{arguments,body,goodsBasic,externalGoodsId}';
  if not sellerpilot_private.temu_publication_exact_long(v_goods_id)
     or coalesce(v_external_goods_id,'')='' then return null; end if;
  select * into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id=v_source.listing_id and listing.owner_id=v_source.created_by
     and listing.channel_key='temu' and listing.product_id is not null
     and listing.seller_account_key=v_source.seller_account_key
   for update;
  if not found then return null; end if;
  select * into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_source.credential_id and credential.channel='temu'
     and credential.status='active'
     and credential.environment='production'
     and credential.seller_account_key=v_source.seller_account_key
     and (credential.expires_at is null or credential.expires_at>statement_timestamp())
   for update;
  if not found or not sellerpilot_private.serverless_static_egress_allowed('temu')
  then return null; end if;
  v_fingerprint:=encode(extensions.digest(
    concat_ws('|','temu-containment-v1',v_source.id::text,v_listing.id::text,
      v_source.attempt_id::text,v_credential.id::text,v_goods_id,v_external_goods_id),
    'sha256'
  ),'hex');
  v_resource_key:=encode(extensions.digest(
    pg_catalog.convert_to('temu','UTF8') || decode('00','hex') ||
    pg_catalog.convert_to('listing_mutation','UTF8') || decode('00','hex') ||
    pg_catalog.convert_to(v_listing.id::text,'UTF8'),'sha256'
  ),'hex');
  v_arguments:=jsonb_build_object(
    'goodsId',v_goods_id,'externalGoodsId',v_external_goods_id,
    'publicationStateContract','verified_remote_state_v1',
    'publicationExpectedLocale','ko-KR',
    'publicationExpectedImageCount',0,
    'publicationExpectedFingerprint',v_fingerprint,
    'sellerpilotTemuContainment',jsonb_build_object(
      'version','temu_safe_test_containment_v1',
      'sourceJobId',v_source.id,'sourceAttemptId',v_source.attempt_id,
      'listingId',v_listing.id,'productId',v_listing.product_id,
      'credentialId',v_credential.id,'goodsId',v_goods_id,
      'externalGoodsId',v_external_goods_id,
      'containmentFingerprint',v_fingerprint
    )
  );
  v_payload:=jsonb_build_object('arguments',v_arguments);
  v_payload_sha:=encode(extensions.digest(v_payload::text,'sha256'),'hex');
  insert into sellerpilot_private.channel_operation_attempts(
    id,owner_id,credential_id,channel,operation,idempotency_key,
    request_fingerprint,status,started_at,seller_account_key,
    gateway_write_required,pre_gateway_retryable
  ) values(
    v_attempt_id,v_source.created_by,v_credential.id,'temu','listing.stop',
    'temu-contain:'||v_source.id::text,v_fingerprint,'running',clock_timestamp(),
    v_source.seller_account_key,true,false
  );
  perform pg_catalog.set_config('sellerpilot.temu_containment_enqueue',v_job_id::text,true);
  insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,status,seller_account_key,request_fingerprint,
    write_resource_kind,write_resource_key,created_by,created_at,updated_at
  ) values(
    v_job_id,v_credential.id,v_attempt_id,v_listing.id,'temu','listing.stop',
    'production',v_payload,'queued',v_source.seller_account_key,v_fingerprint,
    'listing_mutation',v_resource_key,v_source.created_by,
    clock_timestamp(),clock_timestamp()
  );
  insert into sellerpilot_private.temu_safe_test_containment_permits(
    containment_job_id,containment_attempt_id,source_job_id,source_attempt_id,
    listing_id,product_id,credential_id,owner_id,seller_account_key,
    goods_id,external_goods_id,request_fingerprint,request_payload_sha256,
    request_payload_bytes,write_resource_key
  ) values(
    v_job_id,v_attempt_id,v_source.id,v_source.attempt_id,v_listing.id,
    v_listing.product_id,v_credential.id,v_source.created_by,
    v_source.seller_account_key,v_goods_id,v_external_goods_id,v_fingerprint,
    v_payload_sha,octet_length(v_payload::text),v_resource_key
  );
  return jsonb_build_object(
    'status','queued','job_id',v_job_id,'attempt_id',v_attempt_id,
    'source_job_id',v_source.id,'listing_id',v_listing.id,'reused',false
  );
end;
$$;

create function public.sellerpilot_service_enqueue_temu_containment_recovery(
  p_source_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  return sellerpilot_private.enqueue_temu_safe_test_containment(p_source_job_id);
end;
$$;

create function sellerpilot_private.record_temu_containment_discovery(
  p_job_id uuid
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_discovery sellerpilot_private.temu_safe_test_containment_discoveries%rowtype;
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_step jsonb;
  v_count integer;
  v_goods_id text;
  v_containment jsonb;
begin
  select discovery.* into v_discovery
    from sellerpilot_private.temu_safe_test_containment_discoveries discovery
   where discovery.last_job_id=p_job_id for update;
  if not found then return 'not_discovery'; end if;
  if v_discovery.status in ('discovered','contained','manual_required') then
    return v_discovery.status;
  end if;
  select * into strict v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='temu'
     and job.operation='listing.publication.verify'
     and job.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'=
          'temu_safe_test_containment_discovery_v1'
     and job.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,sourceJobId}'=
          v_discovery.source_job_id::text
     and job.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,sourceAttemptId}'=
          v_discovery.source_attempt_id::text
     and job.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,externalGoodsId}'=
          v_discovery.external_goods_id
     and job.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,discoveryFingerprint}'=
          v_discovery.discovery_fingerprint
     and job.request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
     and job.status in ('succeeded','failed','reconciliation_required')
     and job.completed_at is not null
     and exists(
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id=job.id
     );
  v_step:=case when jsonb_typeof(v_job.response_payload->'steps')='array'
    then v_job.response_payload#>'{steps,0}' else null end;
  begin
    v_count:=(v_step#>>'{data,sellerpilotMatchingGoodsCount}')::integer;
  exception when others then v_count:=null; end;
  v_goods_id:=coalesce(nullif(v_job.response_payload->>'remoteId',''),
    nullif(v_step#>>'{data,sellerpilotRecoveredGoodsId}',''));

  if v_job.status='succeeded' and v_step->>'ok'='true' and v_count=1
     and sellerpilot_private.temu_publication_exact_long(v_goods_id) then
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='discovered',discovered_goods_id=v_goods_id,
           next_check_at=null,last_error=null,updated_at=clock_timestamp()
     where discovery.source_job_id=v_discovery.source_job_id
       and discovery.status in ('queued','verifying');
    if not found then raise exception 'Temu containment discovery state drifted'
      using errcode='40001'; end if;
    v_containment:=sellerpilot_private.enqueue_temu_safe_test_containment(
      v_discovery.source_job_id
    );
    if v_containment is null then
      update sellerpilot_private.temu_safe_test_containment_discoveries discovery
         set next_check_at=least(discovery.deadline_at,
               clock_timestamp()+interval '5 minutes'),
             last_error='확인된 Temu 상품의 격리 작업 원장 결속을 재시도합니다.',
             updated_at=clock_timestamp()
       where discovery.source_job_id=v_discovery.source_job_id;
      return 'discovered';
    end if;
    return 'discovered';
  elsif v_job.status='succeeded' and v_step->>'ok'='true' and v_count=0
        and v_discovery.check_count<5
        and v_discovery.deadline_at>clock_timestamp() then
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='pending',next_check_at=least(discovery.deadline_at,
             clock_timestamp()+case when discovery.check_count<2
               then interval '1 minute' else interval '5 minutes' end),
           last_error='Temu 상품이 아직 exact externalGoodsId 조회에 나타나지 않았습니다.',
           updated_at=clock_timestamp()
     where discovery.source_job_id=v_discovery.source_job_id;
    return 'pending';
  elsif (v_job.status<>'succeeded' or v_step->>'ok'<>'true' or v_count is null)
        and v_discovery.check_count<5
        and v_discovery.deadline_at>clock_timestamp() then
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='pending',next_check_at=least(discovery.deadline_at,
             clock_timestamp()+interval '5 minutes'),
           last_error='Temu exact externalGoodsId 조회가 일시 실패했습니다.',
           updated_at=clock_timestamp()
     where discovery.source_job_id=v_discovery.source_job_id;
    return 'pending';
  else
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='manual_required',next_check_at=null,
           last_error=case when coalesce(v_count,-1)>1
             then '같은 Temu externalGoodsId 상품이 여러 개여서 자동 격리를 중단했습니다.'
             else 'Temu 상품을 단일 exact LONG 식별자로 확정하지 못했습니다.' end,
           updated_at=clock_timestamp()
     where discovery.source_job_id=v_discovery.source_job_id;
    return 'manual_required';
  end if;
end;
$$;

alter function public.sellerpilot_service_enqueue_due_listing_publication_verifications(
  integer
) rename to sellerpilot_133000_enqueue_due_publication_before_temu_containment;
revoke all on function
  public.sellerpilot_133000_enqueue_due_publication_before_temu_containment(integer)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_enqueue_due_listing_publication_verifications(
  p_limit integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_publication jsonb;
  v_containment jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  v_publication:=
    public.sellerpilot_133000_enqueue_due_publication_before_temu_containment(
      p_limit
    );
  v_containment:=sellerpilot_private.enqueue_due_temu_containment_discoveries(
    p_limit
  );
  return v_publication || jsonb_build_object(
    'temuContainmentDiscovery',v_containment
  );
end;
$$;

create function sellerpilot_private.temu_terminal_remote_state_valid(
  p_job_id uuid,
  p_goods_id text,
  p_external_goods_id text,
  p_expected_image_count integer,
  p_allowed_visibility text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_state jsonb;
  v_asset jsonb;
  v_verified_at timestamptz;
begin
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='temu'
     and job.status='succeeded' and job.completed_at is not null;
  if not found or v_job.response_payload->>'ok'<>'true'
     or v_job.response_payload->>'publicationStateContract'<>
          'verified_remote_state_v1'
     or v_job.response_payload->>'remoteId'<>p_goods_id then return false; end if;
  v_state:=v_job.response_payload->'remoteState';
  begin v_verified_at:=(v_state->>'verifiedAt')::timestamptz;
  exception when others then return false; end;
  if v_state#>>'{evidence,imageOrderVerified}'<>'true'
     or v_state#>>'{evidence,contentVerified}'<>'true'
     or v_state#>>'{evidence,skuIdentityVerified}'<>'true'
     or v_state#>>'{evidence,priceVerified}'<>'true'
     or v_state#>>'{evidence,stockVerified}'<>'true'
     or v_state#>>'{evidence,goodsIdVerified}'<>'true'
     or v_state#>>'{evidence,externalGoodsIdVerified}'<>'true' then
    return false;
  end if;
  if p_expected_image_count=8 then
    v_asset:=v_state#>'{evidence,publicationAssetBinding}';
    if v_state#>>'{evidence,version}'<>'temu_list_status_detail_stock_v2'
       or not (
         coalesce(v_state#>'{evidence,readbackMethods}','[]'::jsonb)
           @> '["temu.local.goods.sku.stock.query"]'::jsonb
       )
       or jsonb_typeof(v_job.request_payload#>'{arguments,body,skuList}')<>'array'
       or jsonb_array_length(v_job.request_payload#>'{arguments,body,skuList}')<1
       or v_state#>>'{evidence,observedSkuCount}'<>
            jsonb_array_length(v_job.request_payload#>'{arguments,body,skuList}')::text
       or jsonb_typeof(v_asset)<>'object'
       or v_asset->>'contract'<>'sellerpilot_provider_asset_binding_v1'
       or v_asset->>'providerImageSurface'<>'detail_content'
       or coalesce(v_asset->>'sourceAssetBindingDigest','') !~ '^[a-f0-9]{64}$'
       or coalesce(v_asset->>'providerImageDigest','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(v_asset->'approvedDetailRoles')<>'array'
       or jsonb_array_length(v_asset->'approvedDetailRoles')<>8
       or jsonb_typeof(v_asset->'providerTransportRoles')<>'array'
       or v_asset->'providerTransportRoles'<>v_asset->'approvedDetailRoles'
       or jsonb_typeof(v_asset->'providerDetailImageIdentities')<>'array'
       or jsonb_array_length(v_asset->'providerDetailImageIdentities')<>8
       or (select count(distinct image.value)::integer
             from jsonb_array_elements_text(
               v_asset->'providerDetailImageIdentities'
             ) image(value))<>8
       or not exists(
         select 1
           from sellerpilot_private.product_listings listing
           join sellerpilot_private.products product
             on product.id=listing.product_id and product.owner_id=listing.owner_id
          where listing.id=v_job.listing_id
            and product.detail_page_approved_version is not null
            and product.detail_page_version=product.detail_page_approved_version
            and product.detail_page_image_manifest->>'contract'=
                 'sellerpilot_detail_image_manifest_v2'
            and product.detail_page_image_manifest->>'algorithm'='sha256'
            and product.detail_page_image_manifest->>'digest'=
                 v_asset->>'approvedManifestDigest'
            and product.detail_page_approved_version::text=
                 v_asset->>'approvedDetailPageVersion'
            and sellerpilot_private.temu_publication_asset_identity(
                  v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}'
                ) is not null
            and v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}'=
                 v_asset->>'approvedManifestDigest'
            and v_job.request_payload#>>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailPageVersion}'=
                 v_asset->>'approvedDetailPageVersion'
            and not exists(
              select 1
                from jsonb_array_elements(
                  v_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding,approvedDetailImages}'
                ) with ordinality bound(image,position)
                full join jsonb_array_elements(product.detail_page_image_manifest->'images')
                  with ordinality current_image(image,position)
                  using(position)
               where bound.image is null or current_image.image is null
                  or bound.image->>'role'<>current_image.image->>'role'
                  or bound.image->>'approvedObjectPath'<>current_image.image->>'path'
                  or bound.image->>'approvedSourceSha256'<>current_image.image->>'sourceSha256'
            )
            and v_asset->'approvedDetailRoles'=(
              select jsonb_agg(image.value->>'role' order by image.ordinality)
                from jsonb_array_elements(
                  product.detail_page_image_manifest->'images'
                ) with ordinality image(value,ordinality)
            )
       ) then
      return false;
    end if;
  elsif p_expected_image_count<>0 then
    return false;
  end if;
  return v_state->>'verified'='true'
    and v_state->>'visibility'=any(p_allowed_visibility)
    and coalesce(v_state->>'providerStatus','')<>''
    and v_state->>'locale'='ko-KR'
    and v_state->>'fingerprint'=v_job.request_fingerprint
    and v_state->>'imageCount'=p_expected_image_count::text
    and v_state#>>'{resources,goodsId}'=p_goods_id
    and v_state#>>'{resources,externalGoodsId}'=p_external_goods_id
    and v_state#>>'{evidence,identityVerified}'='true'
    and v_state#>>'{evidence,statusVerified}'='true'
    and v_state#>>'{evidence,localeVerified}'='true'
    and v_state#>>'{evidence,fingerprintVerified}'='true'
    and v_state#>>'{evidence,imageCountVerified}'='true'
    and v_verified_at>=v_job.provider_mutation_started_at
    and v_verified_at<=clock_timestamp()+interval '5 minutes';
exception when others then return false;
end;
$$;

create function sellerpilot_private.temu_remote_resources_from_job(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'resources',job.response_payload#>'{remoteState,resources}',
    'verification',jsonb_build_object(
      'verifiedAt',job.response_payload#>'{remoteState,verifiedAt}',
      'evidence',job.response_payload#>'{remoteState,evidence}',
      'locale',job.response_payload#>>'{remoteState,locale}',
      'fingerprint',job.response_payload#>>'{remoteState,fingerprint}',
      'imageCount',(job.response_payload#>>'{remoteState,imageCount}')::integer
    )
  ) from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id
$$;

create function sellerpilot_private.temu_server_owned_listing_update_allowed(
  p_old jsonb,p_new jsonb,p_job_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_activation sellerpilot_private.temu_listing_activation_permits%rowtype;
  v_containment sellerpilot_private.temu_safe_test_containment_permits%rowtype;
  v_allowed text[]:=array[
    'remote_id','status','requested_publication_intent','remote_visibility',
    'provider_status','remote_resources','remote_created_at','published_at',
    'last_verified_at','last_error','failure_class','operation_attempt_id','updated_at'
  ];
begin
  if p_job_id !~ '^[0-9a-fA-F-]{36}$' or jsonb_typeof(p_old)<>'object'
     or jsonb_typeof(p_new)<>'object' then return false; end if;
  select * into v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id::uuid and job.channel='temu'
     and job.status in ('succeeded','failed','reconciliation_required')
     and job.completed_at is not null;
  if not found or (p_new-v_allowed)<>(p_old-v_allowed)
     or p_new->>'seller_account_key' is distinct from v_job.seller_account_key
     or p_new->>'id' is distinct from v_job.listing_id::text then return false; end if;
  select * into v_activation
    from sellerpilot_private.temu_listing_activation_permits permit
   where permit.activation_job_id=v_job.id;
  if found then
    if p_new->>'remote_id'<>v_activation.goods_id
       or p_new#>>'{remote_resources,resources,goodsId}'<>v_activation.goods_id
       or p_new#>>'{remote_resources,resources,externalGoodsId}'<>
            v_activation.external_goods_id then return false; end if;
    if v_activation.terminal_status='succeeded' then
      return p_new->>'operation_attempt_id'=v_activation.activation_attempt_id::text
        and p_new->>'requested_publication_intent'='live'
        and p_new->>'remote_visibility'=
              v_job.response_payload#>>'{remoteState,visibility}'
        and p_new->>'status'=case
              when p_new->>'remote_visibility'='live' then 'published' else 'paused' end
        and p_new->'last_error'='null'::jsonb
        and p_new->'failure_class'='null'::jsonb;
    elsif v_activation.consumed_at is null then
      return p_new->>'operation_attempt_id'=v_activation.source_attempt_id::text
        and p_new->>'requested_publication_intent'='safe_test'
        and p_new->>'status'='paused'
        and p_new->>'remote_visibility' in ('non_public','withdrawn');
    else
      return p_new->>'operation_attempt_id'=v_activation.activation_attempt_id::text
        and p_new->>'requested_publication_intent'='live'
        and p_new->>'status'='failed'
        and p_new->>'failure_class'='external_action';
    end if;
  end if;
  select * into v_containment
    from sellerpilot_private.temu_safe_test_containment_permits permit
   where permit.containment_job_id=v_job.id;
  if not found or p_new->>'remote_id'<>v_containment.goods_id
     or p_new#>>'{remote_resources,resources,goodsId}'<>v_containment.goods_id
     or p_new#>>'{remote_resources,resources,externalGoodsId}'<>
          v_containment.external_goods_id
     or p_new->>'operation_attempt_id'<>v_containment.containment_attempt_id::text
     or p_new->>'requested_publication_intent'<>'safe_test' then return false; end if;
  if v_containment.terminal_status='succeeded' then
    return p_new->>'status'='paused'
      and p_new->>'remote_visibility' in ('non_public','withdrawn')
      and p_new->'last_error'='null'::jsonb
      and p_new->'failure_class'='null'::jsonb;
  end if;
  return p_new->>'status'='failed' and p_new->>'failure_class'='external_action';
exception when others then return false;
end;
$$;

do $temu_listing_projection_guard_patch$
declare
  v_definition text;
  v_before text := 'begin
  if nullif(current_setting(''sellerpilot.qoo10_s1_activation_apply'', true), '''') is not null then';
  v_after text := 'begin
  if nullif(current_setting(''sellerpilot.temu_publication_apply'', true), '''') is not null then
    if not sellerpilot_private.temu_server_owned_listing_update_allowed(
      to_jsonb(old),to_jsonb(new),
      current_setting(''sellerpilot.temu_publication_apply'', true)
    ) then
      raise exception ''invalid Temu server-owned listing projection'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.qoo10_s1_activation_apply'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition,'sellerpilot.temu_publication_apply')=0 then
    if pg_catalog.strpos(v_definition,v_before)=0 then
      raise exception 'Temu product listing projection guard preimage drifted'
        using errcode='55000';
    end if;
    execute pg_catalog.replace(v_definition,v_before,v_after);
  end if;
end;
$temu_listing_projection_guard_patch$;

-- Temu's final live transition is a server-owned listing.activate job. Extend
-- the existing pending-review machinery only to accept that exact immutable
-- source; all ordinary browser activation remains blocked by the permit path.
do $temu_pending_activation_source_patch$
declare
  v_name regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_name in array array[
    'sellerpilot_private.guard_listing_publication_review()'::regprocedure,
    'sellerpilot_private.register_pending_listing_publication_review(uuid)'::regprocedure,
    'sellerpilot_private.apply_listing_publication_verifier_completion(uuid)'::regprocedure,
    'sellerpilot_private.listing_publication_review_is_current(uuid)'::regprocedure,
    'public.sellerpilot_310540_listing_publication_verification_source(text,uuid,uuid)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_name) into v_definition;
    v_rewritten:=pg_catalog.replace(
      v_definition,
      '''listing.create'', ''listing.update''',
      '''listing.create'', ''listing.update'', ''listing.activate'''
    );
    if v_rewritten=v_definition
       and pg_catalog.strpos(v_definition,'''listing.activate''')=0 then
      raise exception 'Temu pending activation source preimage drifted: %',v_name
        using errcode='55000';
    end if;
    if v_rewritten<>v_definition then execute v_rewritten; end if;
  end loop;
end;
$temu_pending_activation_source_patch$;

create function sellerpilot_private.record_temu_activation_outcome(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.temu_listing_activation_permits%rowtype;
  v_source sellerpilot_private.channel_gateway_jobs%rowtype;
  v_visibility text;
  v_resources jsonb;
  v_verified_at timestamptz;
  v_created_at timestamptz;
  v_terminal text;
begin
  select * into v_permit
    from sellerpilot_private.temu_listing_activation_permits permit
   where permit.activation_job_id=p_job_id for update;
  if not found then return false; end if;
  select * into strict v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='temu'
     and job.operation='listing.activate'
     and job.attempt_id=v_permit.activation_attempt_id
     and job.listing_id=v_permit.listing_id
     and job.credential_id=v_permit.credential_id
     and job.seller_account_key=v_permit.seller_account_key
     and job.status in ('succeeded','failed','reconciliation_required')
     and job.completed_at is not null
     and exists(select 1 from sellerpilot_private.gateway_completion_receipts receipt
       where receipt.job_id=job.id
         and receipt.claim_token=v_permit.bound_claim_token
         and receipt.worker_token_id=v_permit.bound_worker_token_id);
  select * into strict v_source from sellerpilot_private.channel_gateway_jobs source
   where source.id=v_permit.source_job_id
     and source.attempt_id=v_permit.source_attempt_id
     and source.status='succeeded'
     and source.response_payload->>'publicationFulfilled'='true'
     and source.response_payload#>>'{remoteState,visibility}' in ('non_public','withdrawn')
     and source.response_payload->>'remoteId'=v_permit.goods_id;
  if v_permit.terminal_status is not null then return true; end if;

  if v_permit.consumed_at is null then
    if v_job.provider_mutation_started_at is not null
       or v_job.status not in ('failed','reconciliation_required') then return false; end if;
    v_terminal:='failed';
    v_visibility:=v_source.response_payload#>>'{remoteState,visibility}';
    v_resources:=jsonb_build_object(
      'resources',v_source.response_payload#>'{remoteState,resources}',
      'verification',jsonb_build_object(
        'verifiedAt',v_source.response_payload#>'{remoteState,verifiedAt}',
        'evidence',v_source.response_payload#>'{remoteState,evidence}',
        'locale',v_source.response_payload#>>'{remoteState,locale}',
        'fingerprint',v_source.response_payload#>>'{remoteState,fingerprint}',
        'imageCount',(v_source.response_payload#>>'{remoteState,imageCount}')::integer
      )
    );
  elsif sellerpilot_private.temu_terminal_remote_state_valid(
    v_job.id,v_permit.goods_id,v_permit.external_goods_id,8,
    array['live','pending_review']::text[]
  ) then
    v_terminal:='succeeded';
    v_visibility:=v_job.response_payload#>>'{remoteState,visibility}';
    v_resources:=sellerpilot_private.temu_remote_resources_from_job(v_job.id);
    v_verified_at:=(v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
    begin v_created_at:=nullif(v_job.response_payload#>>'{remoteState,createdAt}','')::timestamptz;
    exception when others then v_created_at:=null; end;
  else
    v_terminal:='reconciliation_required';
    v_visibility:='unknown';
    v_resources:=jsonb_build_object(
      'resources',jsonb_build_object('goodsId',v_permit.goods_id,
        'externalGoodsId',v_permit.external_goods_id),
      'verification',jsonb_build_object('contract','temu_activation_unverified_v1')
    );
  end if;
  update sellerpilot_private.temu_listing_activation_permits permit
     set terminal_status=v_terminal,completed_at=v_job.completed_at
   where permit.activation_job_id=v_job.id and permit.terminal_status is null;
  if not found then return false; end if;
  perform pg_catalog.set_config('sellerpilot.temu_publication_apply',v_job.id::text,true);
  if v_terminal='succeeded' then
    update sellerpilot_private.product_listings listing
       set remote_id=v_permit.goods_id,
           status=case when v_visibility='live' then 'published' else 'paused' end,
           requested_publication_intent='live',remote_visibility=v_visibility,
           provider_status=v_job.response_payload#>>'{remoteState,providerStatus}',
           remote_resources=v_resources,
           remote_created_at=coalesce(v_created_at,listing.remote_created_at),
           published_at=case when v_visibility='live'
             then coalesce(listing.published_at,v_verified_at) else null end,
           last_verified_at=v_verified_at,last_error=null,failure_class=null,
           operation_attempt_id=v_permit.activation_attempt_id,
           updated_at=clock_timestamp()
     where listing.id=v_permit.listing_id;
  elsif v_permit.consumed_at is null then
    update sellerpilot_private.product_listings listing
       set remote_id=v_permit.goods_id,status='paused',
           requested_publication_intent='safe_test',remote_visibility=v_visibility,
           provider_status=v_source.response_payload#>>'{remoteState,providerStatus}',
           remote_resources=v_resources,
           last_verified_at=(v_source.response_payload#>>'{remoteState,verifiedAt}')::timestamptz,
           last_error=left(coalesce(v_job.error_message,
             'Temu 최종 공개 전 읽기 검증이 실패했습니다.'),1000),
           failure_class='retryable',operation_attempt_id=v_permit.source_attempt_id,
           updated_at=clock_timestamp()
     where listing.id=v_permit.listing_id;
  else
    update sellerpilot_private.product_listings listing
       set remote_id=v_permit.goods_id,status='failed',
           requested_publication_intent='live',remote_visibility='unknown',
           provider_status=null,remote_resources=v_resources,
           last_error='Temu 공개 전환 결과가 불명확합니다. 판매자센터에서 즉시 상태를 확인해야 합니다.',
           failure_class='external_action',
           operation_attempt_id=v_permit.activation_attempt_id,
           updated_at=clock_timestamp()
     where listing.id=v_permit.listing_id;
  end if;
  if not found then raise exception 'Temu activation listing projection failed'
    using errcode='55000'; end if;
  if v_terminal='succeeded' and v_visibility='pending_review' then
    if not sellerpilot_private.register_pending_listing_publication_review(v_job.id) then
      raise exception 'Temu activation pending review registration failed'
        using errcode='55000';
    end if;
  end if;
  return true;
exception when no_data_found then return false;
end;
$$;

create function sellerpilot_private.record_temu_containment_outcome(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.temu_safe_test_containment_permits%rowtype;
  v_terminal text;
  v_visibility text:='unknown';
  v_resources jsonb;
  v_verified_at timestamptz;
begin
  select * into v_permit
    from sellerpilot_private.temu_safe_test_containment_permits permit
   where permit.containment_job_id=p_job_id for update;
  if not found then return false; end if;
  select * into strict v_job from sellerpilot_private.channel_gateway_jobs job
   where job.id=p_job_id and job.channel='temu' and job.operation='listing.stop'
     and job.attempt_id=v_permit.containment_attempt_id
     and job.listing_id=v_permit.listing_id
     and job.credential_id=v_permit.credential_id
     and job.status in ('succeeded','failed','reconciliation_required')
     and job.completed_at is not null
     and exists(select 1 from sellerpilot_private.gateway_completion_receipts receipt
       where receipt.job_id=job.id
         and receipt.claim_token=v_permit.bound_claim_token
         and receipt.worker_token_id=v_permit.bound_worker_token_id);
  if v_permit.terminal_status is not null then return true; end if;
  if v_permit.consumed_at is not null
     and sellerpilot_private.temu_terminal_remote_state_valid(
       v_job.id,v_permit.goods_id,v_permit.external_goods_id,0,
       array['non_public','withdrawn']::text[]
     ) then
    v_terminal:='succeeded';
    v_visibility:=v_job.response_payload#>>'{remoteState,visibility}';
    v_resources:=sellerpilot_private.temu_remote_resources_from_job(v_job.id);
    v_verified_at:=(v_job.response_payload#>>'{remoteState,verifiedAt}')::timestamptz;
  else
    v_terminal:='reconciliation_required';
    v_resources:=jsonb_build_object(
      'resources',jsonb_build_object('goodsId',v_permit.goods_id,
        'externalGoodsId',v_permit.external_goods_id),
      'verification',jsonb_build_object('contract','temu_containment_unverified_v1')
    );
  end if;
  update sellerpilot_private.temu_safe_test_containment_permits permit
     set terminal_status=v_terminal,completed_at=v_job.completed_at
   where permit.containment_job_id=v_job.id and permit.terminal_status is null;
  if not found then return false; end if;
  perform pg_catalog.set_config('sellerpilot.temu_publication_apply',v_job.id::text,true);
  update sellerpilot_private.product_listings listing
     set remote_id=v_permit.goods_id,
         status=case when v_terminal='succeeded' then 'paused' else 'failed' end,
         requested_publication_intent='safe_test',remote_visibility=v_visibility,
         provider_status=case when v_terminal='succeeded'
           then v_job.response_payload#>>'{remoteState,providerStatus}' else null end,
         remote_resources=v_resources,
         last_verified_at=case when v_terminal='succeeded' then v_verified_at else null end,
         last_error=case when v_terminal='succeeded' then null
           else 'Temu 비공개 격리 결과가 불명확합니다. 판매자센터에서 즉시 확인해야 합니다.' end,
         failure_class=case when v_terminal='succeeded' then null else 'external_action' end,
         published_at=null,operation_attempt_id=v_permit.containment_attempt_id,
         updated_at=clock_timestamp()
   where listing.id=v_permit.listing_id;
  if not found then raise exception 'Temu containment listing projection failed'
    using errcode='55000'; end if;
  if v_terminal='succeeded' then
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='contained',updated_at=clock_timestamp(),last_error=null
     where discovery.source_job_id=v_permit.source_job_id
       and discovery.status='discovered';
  end if;
  return true;
exception when no_data_found then return false;
end;
$$;

create function sellerpilot_private.temu_safe_test_source_reconciliation_resolved(
  p_source_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
      from sellerpilot_private.temu_safe_test_containment_permits permit
      join sellerpilot_private.channel_gateway_jobs source
        on source.id=permit.source_job_id
      join sellerpilot_private.channel_gateway_jobs containment
        on containment.id=permit.containment_job_id
     where permit.source_job_id=p_source_job_id
       and permit.terminal_status='succeeded'
       and permit.consumed_at is not null
       and source.status='reconciliation_required'
       and source.channel='temu' and source.operation='listing.create'
       and containment.status='succeeded'
       and containment.response_payload#>>'{remoteState,visibility}'
            in ('non_public','withdrawn')
       and containment.response_payload->>'remoteId'=permit.goods_id
  )
$$;

do $temu_containment_gate_resolution_patch$
declare
  v_name regprocedure;
  v_definition text;
  v_rewritten text;
begin
  foreach v_name in array array[
    'public.sellerpilot_service_set_listing_mutation_release_gate(boolean,text)'::regprocedure,
    'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure,
    'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_name) into v_definition;
    v_rewritten:=pg_catalog.replace(
      v_definition,
      'not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)',
      '(not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
        and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id))'
    );
    if v_rewritten=v_definition then
      raise exception 'Temu containment gate resolution preimage drifted: %',v_name
        using errcode='55000';
    end if;
    execute v_rewritten;
  end loop;
end;
$temu_containment_gate_resolution_patch$;

alter function public.sellerpilot_service_complete_gateway_transaction(
  text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
) rename to sellerpilot_133000_complete_gateway_before_temu_publication;
revoke all on function
  public.sellerpilot_133000_complete_gateway_before_temu_publication(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
  p_response_payload jsonb default null,p_error_message text default null,
  p_credential_refresh jsonb default null,p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_channel text;
  v_operation text;
  v_containment boolean;
  v_discovery boolean;
  v_terminal_status text;
  v_remote_id text;
  v_scheduled boolean;
begin
  select job.channel,job.operation,
         job.request_payload#>>'{arguments,sellerpilotTemuContainment,version}'=
           'temu_safe_test_containment_v1',
         job.request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'=
           'temu_safe_test_containment_discovery_v1'
    into v_channel,v_operation,v_containment,v_discovery
    from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  if v_channel='temu' and v_operation='listing.activate' then
    -- Bypass only the Qoo10-specific post-completion recorder. All atomic
    -- transport receipts and generic side effects below it remain intact.
    v_result:=public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(
      p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
      p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
    );
  else
    v_result:=public.sellerpilot_133000_complete_gateway_before_temu_publication(
      p_token_hash,p_job_id,p_claim_token,p_status,p_response_payload,p_error_message,
      p_credential_refresh,p_normalized_orders,p_normalized_inquiries,p_diagnostic
    );
  end if;
  if v_result->>'status' not in ('completed','completed_replay') then return v_result; end if;

  if v_channel='temu' and v_operation='listing.activate' then
    if not sellerpilot_private.record_temu_activation_outcome(p_job_id) then
      raise exception 'Temu activation completion was not recorded'
        using errcode='55000';
    end if;
  elsif v_channel='temu' and v_operation='listing.stop'
        and coalesce(v_containment,false) then
    if not sellerpilot_private.record_temu_containment_outcome(p_job_id) then
      raise exception 'Temu containment completion was not recorded'
        using errcode='55000';
    end if;
  elsif v_channel='temu' and v_operation='listing.publication.verify'
        and coalesce(v_discovery,false) then
    perform sellerpilot_private.record_temu_containment_discovery(p_job_id);
  elsif v_channel='temu' and v_operation='listing.create' then
    select job.status,job.response_payload->>'remoteId'
      into v_terminal_status,v_remote_id
      from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
    if v_terminal_status='reconciliation_required' then
      v_scheduled:=sellerpilot_private.schedule_temu_safe_test_containment_discovery(
        p_job_id
      );
      if v_scheduled and sellerpilot_private.temu_publication_exact_long(v_remote_id) then
        perform sellerpilot_private.enqueue_temu_safe_test_containment(p_job_id);
      elsif not coalesce(v_scheduled,false) then
        insert into sellerpilot_private.operation_audit(
          owner_id,action,entity_type,entity_id,safe_detail
        ) select job.created_by,'temu_containment_manual_required',
            'channel_gateway_job',job.id::text,jsonb_build_object(
              'channel','temu','operation','listing.create',
              'reason','durable_recovery_context_unavailable',
              'contract','temu_safe_test_containment_v1'
            )
          from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
      end if;
    end if;
  end if;
  return v_result;
end;
$$;

-- The generic stale-lease reaper deliberately does not synthesize gateway
-- completion receipts. Project its direct terminal writes into the Temu
-- capability ledgers so a worker crash cannot leave a consumed permit or the
-- product listing indefinitely queued. Pre-provider retries keep the same job
-- and are rebound by bind_temu_server_owned_mutation_claim above.
create function sellerpilot_private.finalize_reaped_temu_publication_jobs()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row record;
  v_activation integer:=0;
  v_containment integer:=0;
  v_discovery integer:=0;
begin
  for v_row in
    select permit.*,job.status job_status,job.completed_at job_completed_at,
           job.provider_mutation_started_at,job.error_message
      from sellerpilot_private.temu_listing_activation_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=permit.activation_job_id
     where permit.terminal_status is null
       and job.status in ('failed','reconciliation_required')
       and job.completed_at is not null
       and not exists(select 1 from sellerpilot_private.gateway_completion_receipts receipt
         where receipt.job_id=job.id)
     for update of permit
  loop
    update sellerpilot_private.temu_listing_activation_permits permit
       set terminal_status=case when v_row.consumed_at is null
             then 'failed' else 'reconciliation_required' end,
           completed_at=v_row.job_completed_at
     where permit.activation_job_id=v_row.activation_job_id
       and permit.terminal_status is null;
    if not found then continue; end if;
    perform pg_catalog.set_config(
      'sellerpilot.temu_publication_apply',v_row.activation_job_id::text,true
    );
    if v_row.consumed_at is null then
      update sellerpilot_private.product_listings listing
         set status='paused',requested_publication_intent='safe_test',
             remote_visibility=case when listing.remote_visibility in ('non_public','withdrawn')
               then listing.remote_visibility else 'unknown' end,
             last_error=left(coalesce(v_row.error_message,
               'Temu 공개 승격 worker가 provider 쓰기 전에 종료되어 안전하게 재시도할 수 있습니다.'),1000),
             failure_class='retryable',
             operation_attempt_id=v_row.source_attempt_id,
             updated_at=clock_timestamp()
       where listing.id=v_row.listing_id;
    else
      update sellerpilot_private.product_listings listing
         set status='failed',requested_publication_intent='live',
             remote_visibility='unknown',provider_status=null,
             last_error='Temu 공개 승격 worker lease가 provider 쓰기 뒤 만료됐습니다. 판매자센터에서 즉시 상태를 확인해야 합니다.',
             failure_class='external_action',
             operation_attempt_id=v_row.activation_attempt_id,
             updated_at=clock_timestamp()
       where listing.id=v_row.listing_id;
    end if;
    if not found then raise exception 'reaped Temu activation listing projection failed'
      using errcode='55000'; end if;
    v_activation:=v_activation+1;
  end loop;

  for v_row in
    select permit.*,job.status job_status,job.completed_at job_completed_at,
           job.provider_mutation_started_at,job.error_message
      from sellerpilot_private.temu_safe_test_containment_permits permit
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=permit.containment_job_id
     where permit.terminal_status is null
       and job.status in ('failed','reconciliation_required')
       and job.completed_at is not null
       and not exists(select 1 from sellerpilot_private.gateway_completion_receipts receipt
         where receipt.job_id=job.id)
     for update of permit
  loop
    update sellerpilot_private.temu_safe_test_containment_permits permit
       set terminal_status=case when v_row.consumed_at is null
             then 'failed' else 'reconciliation_required' end,
           completed_at=v_row.job_completed_at
     where permit.containment_job_id=v_row.containment_job_id
       and permit.terminal_status is null;
    if not found then continue; end if;
    perform pg_catalog.set_config(
      'sellerpilot.temu_publication_apply',v_row.containment_job_id::text,true
    );
    update sellerpilot_private.product_listings listing
       set status='failed',requested_publication_intent='safe_test',
           remote_visibility='unknown',provider_status=null,
           last_error=case when v_row.consumed_at is null
             then 'Temu 격리 worker가 provider 쓰기 전에 반복 종료됐습니다. 판매자센터에서 수동 판매중지가 필요합니다.'
             else 'Temu 격리 worker lease가 provider 쓰기 뒤 만료됐습니다. 판매자센터에서 즉시 상태를 확인해야 합니다.' end,
           failure_class='external_action',
           operation_attempt_id=v_row.containment_attempt_id,
           updated_at=clock_timestamp()
     where listing.id=v_row.listing_id;
    if not found then raise exception 'reaped Temu containment listing projection failed'
      using errcode='55000'; end if;
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status='manual_required',next_check_at=null,
           last_error='Temu exact 상품 격리 worker가 종료되어 판매자센터 수동 확인이 필요합니다.',
           updated_at=clock_timestamp()
     where discovery.source_job_id=v_row.source_job_id
       and discovery.status in ('discovered','queued','verifying','pending');
    v_containment:=v_containment+1;
  end loop;

  for v_row in
    select discovery.source_job_id,discovery.check_count,discovery.deadline_at,
           discovery.status discovery_status,job.id job_id,job.status job_status
      from sellerpilot_private.temu_safe_test_containment_discoveries discovery
      join sellerpilot_private.channel_gateway_jobs job
        on job.id=discovery.last_job_id
     where discovery.status in ('queued','verifying')
       and job.status in ('failed','reconciliation_required')
       and job.completed_at is not null
       and not exists(select 1 from sellerpilot_private.gateway_completion_receipts receipt
         where receipt.job_id=job.id)
     for update of discovery
  loop
    update sellerpilot_private.temu_safe_test_containment_discoveries discovery
       set status=case when discovery.check_count<5
                         and discovery.deadline_at>clock_timestamp()
                       then 'pending' else 'manual_required' end,
           next_check_at=case when discovery.check_count<5
                                and discovery.deadline_at>clock_timestamp()
                              then least(discovery.deadline_at,
                                   clock_timestamp()+interval '5 minutes')
                              else null end,
           last_error=case when discovery.check_count<5
                             and discovery.deadline_at>clock_timestamp()
                           then 'Temu exact 상품 조회 worker가 종료되어 새 read-only 조회를 예약합니다.'
                           else 'Temu exact 상품 조회 제한을 초과해 판매자센터 수동 확인이 필요합니다.' end,
           updated_at=clock_timestamp()
     where discovery.source_job_id=v_row.source_job_id;
    v_discovery:=v_discovery+1;
  end loop;
  return jsonb_build_object(
    'activation',v_activation,'containment',v_containment,'discovery',v_discovery
  );
end;
$$;

alter function public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  rename to sellerpilot_133000_reap_gateway_before_temu_publication;
revoke all on function
  public.sellerpilot_133000_reap_gateway_before_temu_publication(integer)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_reap_stale_channel_gateway_jobs(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  v_result:=public.sellerpilot_133000_reap_gateway_before_temu_publication(p_limit);
  perform sellerpilot_private.finalize_reaped_temu_publication_jobs();
  return v_result;
end;
$$;

-- Preserve the exact Qoo10 activation path and admit Temu activation only;
-- provider mutation still requires the independent per-job permit below.
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
    when p_operation = 'listing.activate' then p_channel in ('qoo10','temu')
    when p_operation = 'listing.publication.verify' and p_channel = 'temu'
      then true
    else sellerpilot_private.serverless_gateway_job_allowed_before_qoo10_s1_activation(
      p_channel, p_operation
    )
  end
$$;

-- The innermost serverless boundary previously admitted activation only when
-- the exact Qoo10 permit was present. Dispatch Temu to its own one-shot permit
-- without weakening Qoo10 or any other operation.
create or replace function public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_started boolean;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash,p_job_id,p_claim_token,true
  ) then return false; end if;
  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at=coalesce(
           job.provider_mutation_started_at,clock_timestamp()
         ),updated_at=clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id=p_job_id
     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,job.operation
     )
     and (
       job.operation in (
         'listing.create','listing.update','listing.stop','inventory.update',
         'inquiries.reply','shipment.acknowledge','shipment.confirm'
       )
       or (job.operation='listing.activate' and (
         (job.channel='qoo10'
          and sellerpilot_private.exact_qoo10_s1_activation_provider_allowed(
            p_job_id,p_claim_token
          ))
         or (job.channel='temu'
          and sellerpilot_private.temu_activation_provider_allowed(
            p_job_id,p_claim_token
          ))
       ))
     )
     and job.status='running' and job.claim_token=p_claim_token
     and job.lease_expires_at>clock_timestamp()
     and token.id=job.worker_token_id and token.token_hash=p_token_hash
     and token.scope='serverless_cs' and token.status='active'
     and token.expires_at>clock_timestamp()
  returning true into v_started;
  return coalesce(v_started,false);
end;
$$;

alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_133000_begin_serverless_before_temu_publication;
revoke all on function
  public.sellerpilot_133000_begin_serverless_before_temu_publication(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_channel text; v_operation text; v_containment boolean; v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select job.channel,job.operation,
         job.request_payload#>>'{arguments,sellerpilotTemuContainment,version}'=
           'temu_safe_test_containment_v1'
    into v_channel,v_operation,v_containment
    from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  if v_channel='temu' and v_operation='listing.stop' and coalesce(v_containment,false) then
    if not sellerpilot_private.temu_containment_provider_allowed(
      p_job_id,p_claim_token
    ) or not sellerpilot_private.serverless_cs_job_is_owned(
      p_token_hash,p_job_id,p_claim_token,true
    ) then return false; end if;
    update sellerpilot_private.channel_gateway_jobs job
       set provider_mutation_started_at=clock_timestamp(),updated_at=clock_timestamp()
      from sellerpilot_private.ai_cli_worker_tokens token
     where job.id=p_job_id and job.status='running'
       and job.claim_token=p_claim_token and job.provider_mutation_started_at is null
       and job.lease_expires_at>clock_timestamp()
       and token.id=job.worker_token_id and token.token_hash=p_token_hash
       and token.scope='serverless_cs' and token.status='active'
       and token.expires_at>clock_timestamp()
    returning true into v_started;
  elsif v_channel='temu' and v_operation='listing.activate' then
    if not sellerpilot_private.temu_activation_provider_allowed(
      p_job_id,p_claim_token
    ) then return false; end if;
    v_started := public.sellerpilot_056700_begin_serverless_before_qoo10_s1_activation(
      p_token_hash,p_job_id,p_claim_token
    );
  else
    return public.sellerpilot_133000_begin_serverless_before_temu_publication(
      p_token_hash,p_job_id,p_claim_token
    );
  end if;
  if coalesce(v_started,false)
     and not sellerpilot_private.consume_temu_server_owned_mutation_provider(
       p_job_id,p_claim_token
     ) then
    raise exception 'Temu server-owned mutation permit consumption failed'
      using errcode='40001';
  end if;
  return coalesce(v_started,false);
end;
$$;

alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text,uuid,uuid
) rename to sellerpilot_133000_begin_gateway_before_temu_publication;
revoke all on function
  public.sellerpilot_133000_begin_gateway_before_temu_publication(text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,p_job_id uuid,p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_channel text;
  v_operation text;
  v_containment boolean;
  v_started boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select job.channel,job.operation,
         job.request_payload#>>'{arguments,sellerpilotTemuContainment,version}'=
           'temu_safe_test_containment_v1'
    into v_channel,v_operation,v_containment
    from sellerpilot_private.channel_gateway_jobs job where job.id=p_job_id;
  -- Containment is deliberately serverless-only. A local worker cannot
  -- consume or bypass its one-shot permit while the global gate is closed.
  if v_channel='temu' and v_operation='listing.stop'
     and coalesce(v_containment,false) then
    return false;
  elsif v_channel='temu' and v_operation='listing.activate' then
    if not sellerpilot_private.temu_activation_provider_allowed(
      p_job_id,p_claim_token
    ) then return false; end if;
    v_started := public.sellerpilot_056700_begin_gateway_before_qoo10_s1_activation(
      p_token_hash,p_job_id,p_claim_token
    );
    if coalesce(v_started,false)
       and not sellerpilot_private.consume_temu_server_owned_mutation_provider(
         p_job_id,p_claim_token
       ) then
      raise exception 'Temu activation permit consumption failed'
        using errcode='40001';
    end if;
    return coalesce(v_started,false);
  end if;
  return public.sellerpilot_133000_begin_gateway_before_temu_publication(
    p_token_hash,p_job_id,p_claim_token
  );
end;
$$;

create or replace function sellerpilot_private.attested_listing_publication_release_sha()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with adapters as (
    select count(*)::integer as ready_count,
           min(release.release_sha) as minimum_sha,
           max(release.release_sha) as maximum_sha
      from sellerpilot_private.listing_publication_adapter_release release
     where release.adapter_ready
  )
  select case
    when adapters.ready_count = 8
     and adapters.minimum_sha = adapters.maximum_sha
     and rechecker.rechecker_ready
     and rechecker.release_sha = adapters.minimum_sha
      then adapters.minimum_sha
    else null
  end
    from adapters
    join sellerpilot_private.listing_publication_rechecker_release rechecker
      on rechecker.singleton;
$$;

-- A channel argument still never opens a new scoped gate. Qoo10 remains the
-- sole scoped exception; Temu is admitted only through the global eight-channel
-- gate when opened_channel is null.
create or replace function sellerpilot_private.listing_mutation_release_gate_is_effective(
  p_channel text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when p_channel is null or p_channel not in (
        'qoo10', 'shopee', 'lazada', 'coupang',
        'elevenst', 'smartstore', 'ebay', 'temu'
      ) then false
      when gate.opened_channel is null then
        sellerpilot_private.listing_mutation_release_gate_is_effective()
      when p_channel = 'qoo10' and gate.opened_channel = p_channel then
        gate.is_open
        and gate.opened_release_sha
              = sellerpilot_private.attested_listing_publication_release_sha(
                  p_channel
                )
        and gate.opened_release_sha
              = sellerpilot_private.active_serverless_runtime_release_sha()
        and sellerpilot_private.listing_publication_review_violation_count(
              p_channel
            ) = 0
      else false
    end,
    false
  )
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton;
$$;

create or replace function public.sellerpilot_service_set_listing_publication_adapter_ready(
  p_channel text,
  p_ready boolean,
  p_release_sha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row sellerpilot_private.listing_publication_adapter_release%rowtype;
begin
  if p_channel not in (
       'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu'
     ) or p_ready is null
     or (p_ready and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$') then
    raise exception 'invalid listing publication adapter attestation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  update sellerpilot_private.listing_publication_adapter_release release
     set adapter_ready = p_ready,
         contract_version = case when p_ready then 'verified_remote_state_v1' else null end,
         release_sha = case when p_ready then p_release_sha else null end,
         verified_at = case when p_ready then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where release.channel = p_channel
   returning release.* into v_row;
  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = false,
         opened_at = null,
         opened_release_sha = null,
         opened_channel = null,
         updated_at = clock_timestamp()
   where gate.singleton
     and gate.is_open
     and (gate.opened_channel is null or gate.opened_channel = p_channel)
     and (
       not p_ready
       or gate.opened_release_sha is distinct from p_release_sha
     );
  return jsonb_build_object(
    'channel', v_row.channel, 'ready', v_row.adapter_ready,
    'contract', v_row.contract_version, 'releaseSha', v_row.release_sha,
    'verifiedAt', v_row.verified_at
  );
end;
$$;

revoke all on function
  sellerpilot_private.temu_publication_exact_long(text),
  sellerpilot_private.temu_publication_asset_identity(jsonb),
  sellerpilot_private.temu_activation_context(uuid,uuid,uuid,uuid,text,text),
  sellerpilot_private.guard_temu_server_owned_mutation_job(),
  sellerpilot_private.guard_temu_listing_mutation_serialization(),
  sellerpilot_private.bind_temu_server_owned_mutation_claim(jsonb,jsonb),
  sellerpilot_private.bind_temu_server_owned_mutation_claim_trigger(),
  sellerpilot_private.block_closed_listing_mutation_claim(),
  sellerpilot_private.temu_activation_provider_allowed(uuid,uuid),
  sellerpilot_private.temu_containment_provider_allowed(uuid,uuid),
  sellerpilot_private.consume_temu_server_owned_mutation_provider(uuid,uuid),
  sellerpilot_private.schedule_temu_safe_test_containment_discovery(uuid),
  sellerpilot_private.enqueue_due_temu_containment_discoveries(integer),
  sellerpilot_private.sync_temu_containment_discovery_job_status(),
  sellerpilot_private.temu_containment_seller_lineage_allowed(jsonb,jsonb),
  sellerpilot_private.enqueue_temu_safe_test_containment(uuid),
  sellerpilot_private.record_temu_containment_discovery(uuid),
  sellerpilot_private.temu_terminal_remote_state_valid(uuid,text,text,integer,text[]),
  sellerpilot_private.temu_remote_resources_from_job(uuid),
  sellerpilot_private.temu_server_owned_listing_update_allowed(jsonb,jsonb,text),
  sellerpilot_private.record_temu_activation_outcome(uuid),
  sellerpilot_private.record_temu_containment_outcome(uuid),
  sellerpilot_private.finalize_reaped_temu_publication_jobs(),
  sellerpilot_private.temu_safe_test_source_reconciliation_resolved(uuid),
  sellerpilot_private.serverless_gateway_job_allowed(text,text),
  sellerpilot_private.register_pending_listing_publication_review(uuid),
  sellerpilot_private.attested_listing_publication_release_sha(),
  sellerpilot_private.listing_mutation_release_gate_is_effective(text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
    text,uuid,uuid
  ) from public,anon,authenticated,service_role;
revoke all on function
  public.sellerpilot_service_get_temu_activation_context(
    uuid,uuid,uuid,uuid,text,text
  ),
  public.sellerpilot_service_enqueue_temu_activation(uuid,uuid,uuid,jsonb),
  public.sellerpilot_service_enqueue_temu_containment_recovery(uuid),
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  ,public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  from public,anon,authenticated;
grant execute on function
  public.sellerpilot_service_get_temu_activation_context(
    uuid,uuid,uuid,uuid,text,text
  ),
  public.sellerpilot_service_enqueue_temu_activation(uuid,uuid,uuid,jsonb),
  public.sellerpilot_service_enqueue_temu_containment_recovery(uuid),
  public.sellerpilot_service_complete_gateway_transaction(
    text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
  ),
  public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    text,uuid,uuid
  ),
  public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
  ,public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)
  to service_role;
revoke all on function
  public.sellerpilot_service_enqueue_due_listing_publication_verifications(integer)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_enqueue_due_listing_publication_verifications(integer)
  to service_role;
revoke all on function
  public.sellerpilot_service_set_listing_publication_adapter_ready(text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_set_listing_publication_adapter_ready(text, boolean, text)
  to service_role;

comment on column
  sellerpilot_private.listing_mutation_release_gate.opened_channel is
  'Null for the eight-channel global gate; qoo10 for the exact-SHA Qoo10-only gate.';
comment on function
  sellerpilot_private.listing_mutation_release_gate_is_effective(text) is
  'Channel-aware effective provider-mutation boundary; qoo10 scoped or eight-channel global.';

commit;
