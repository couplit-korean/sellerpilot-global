-- Adjudicate the immutable exact Coupang GET result without calling Coupang
-- again.  The provider readback proves that one approved seller product and
-- one on-sale vendor item exist, but the observed price (6000) differs from
-- the immutable CREATE request (3190).  This is a contained, negative
-- reconciliation: it records provider-live price drift, never creates the
-- positive exact-content receipt, and never opens a release gate.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072040);

do $dependencies$
begin
  if pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_live_invalid_completion_captures'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_live_verify_runs'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.coupang_exact_live_verify_receipts'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.gateway_completion_receipts'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.guard_product_listing_seller_lineage()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_listing_mutation_release_gate_status()'
     ) is null
  then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end
$dependencies$;

create table if not exists
sellerpilot_private.coupang_exact_live_price_drift_adjudications (
  verifier_job_id uuid primary key
    references sellerpilot_private.coupang_exact_live_invalid_completion_captures(
      verifier_job_id
    ) on delete restrict
    check (
      verifier_job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ),
  source_job_id uuid not null unique check (
    source_job_id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
  ),
  source_attempt_id uuid not null check (
    source_attempt_id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid
  ),
  listing_id uuid not null unique check (
    listing_id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
  ),
  remote_id text not null check (remote_id = '16375780938'),
  vendor_item_ids jsonb not null check (
    vendor_item_ids = '["96027942778"]'::jsonb
  ),
  source_price integer not null check (source_price = 3190),
  observed_price integer not null check (observed_price = 6000),
  observed_stock integer not null check (observed_stock = 1),
  seller_approved boolean not null check (seller_approved),
  seller_requested boolean not null check (not seller_requested),
  all_vendor_items_on_sale boolean not null check (all_vendor_items_on_sale),
  source_remote_detail_images jsonb not null check (
    jsonb_typeof(source_remote_detail_images) = 'array'
    and jsonb_array_length(source_remote_detail_images) = 8
  ),
  captured_remote_detail_images jsonb not null check (
    jsonb_typeof(captured_remote_detail_images) = 'array'
    and jsonb_array_length(captured_remote_detail_images) = 8
  ),
  ordered_remote_images_match boolean not null check (
    ordered_remote_images_match
  ),
  mismatch_fields jsonb not null check (
    mismatch_fields = '["detailImages","contentDigest"]'::jsonb
  ),
  provider_live_verified boolean not null check (provider_live_verified),
  exact_content_verified boolean not null check (not exact_content_verified),
  buyer_visible_verified boolean not null check (not buyer_visible_verified),
  provider_mutation_performed boolean not null check (
    not provider_mutation_performed
  ),
  provider_call_replayed boolean not null check (not provider_call_replayed),
  capture_response_sha256 text not null check (
    capture_response_sha256 =
      '1f3c77508fef248047f30ee6e6e2f976242596c0575df5a79b725f9c520499f7'
  ),
  capture_row_sha256 text not null check (
    capture_row_sha256 ~ '^[a-f0-9]{64}$'
  ),
  capture_migration_sha256 text not null check (
    capture_migration_sha256 =
      '4fb9dba920a9473f7b07df2a54b4a70405e19d0b64ff854aa32a26c676387abb'
  ),
  run_row_sha256 text not null check (run_row_sha256 ~ '^[a-f0-9]{64}$'),
  source_job_sha256 text not null check (
    source_job_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_attempt_sha256 text not null check (
    source_attempt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_listing_sha256 text not null check (
    source_listing_sha256 ~ '^[a-f0-9]{64}$'
  ),
  verifier_job_sha256 text not null check (
    verifier_job_sha256 ~ '^[a-f0-9]{64}$'
  ),
  listing_before_snapshot jsonb not null check (
    jsonb_typeof(listing_before_snapshot) = 'object'
  ),
  listing_before_sha256 text not null check (
    listing_before_sha256 ~ '^[a-f0-9]{64}$'
  ),
  listing_after_snapshot jsonb not null check (
    jsonb_typeof(listing_after_snapshot) = 'object'
  ),
  listing_after_sha256 text not null check (
    listing_after_sha256 ~ '^[a-f0-9]{64}$'
  ),
  adjudication_evidence jsonb not null check (
    jsonb_typeof(adjudication_evidence) = 'object'
  ),
  adjudication_sha256 text not null unique check (
    adjudication_sha256 ~ '^[a-f0-9]{64}$'
  ),
  decision text not null check (decision = 'provider_live_price_drift'),
  contract text not null check (
    contract = 'coupang_exact_live_price_drift_adjudication_v1'
  ),
  observed_at timestamptz not null,
  adjudicated_at timestamptz not null
);

alter table
sellerpilot_private.coupang_exact_live_price_drift_adjudications
enable row level security;
revoke all on table
sellerpilot_private.coupang_exact_live_price_drift_adjudications
from public, anon, authenticated, service_role;

create or replace function
sellerpilot_private.coupang_exact_live_ordered_detail_images(
  p_payload jsonb,
  p_step_name text
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(detail.value->>'content'
      order by step.ordinality, item.ordinality,
               content.ordinality, detail.ordinality),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(p_payload->'steps', '[]'::jsonb))
       with ordinality step(value, ordinality)
  cross join lateral jsonb_array_elements(
    coalesce(step.value#>'{data,data,items}', '[]'::jsonb)
  ) with ordinality item(value, ordinality)
  cross join lateral jsonb_array_elements(
    coalesce(item.value->'contents', '[]'::jsonb)
  ) with ordinality content(value, ordinality)
  cross join lateral jsonb_array_elements(
    coalesce(content.value->'contentDetails', '[]'::jsonb)
  ) with ordinality detail(value, ordinality)
  where step.value->>'name' = p_step_name
    and upper(detail.value->>'detailType') = 'IMAGE'
    and nullif(btrim(detail.value->>'content'), '') is not null
$$;

revoke all on function
sellerpilot_private.coupang_exact_live_ordered_detail_images(jsonb, text)
from public, anon, authenticated, service_role;

create or replace function
sellerpilot_private.block_coupang_exact_live_price_drift_adjudication_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_EXACT_LIVE_PRICE_DRIFT_ADJUDICATION_IMMUTABLE'
    using errcode = '55000';
end
$$;

revoke all on function
sellerpilot_private.block_coupang_exact_live_price_drift_adjudication_change()
from public, anon, authenticated, service_role;

do $immutable_trigger$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid =
       'sellerpilot_private.coupang_exact_live_price_drift_adjudications'::regclass
       and trigger_row.tgname =
         'block_coupang_exact_live_price_drift_adjudication_change'
       and not trigger_row.tgisinternal
  ) then
    create trigger block_coupang_exact_live_price_drift_adjudication_change
    before update or delete
    on sellerpilot_private.coupang_exact_live_price_drift_adjudications
    for each row execute function
    sellerpilot_private.block_coupang_exact_live_price_drift_adjudication_change();
  end if;
end
$immutable_trigger$;

create or replace function
sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
  p_source_job_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  adjudication
    sellerpilot_private.coupang_exact_live_price_drift_adjudications%rowtype;
  capture
    sellerpilot_private.coupang_exact_live_invalid_completion_captures%rowtype;
  run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
begin
  if p_source_job_id is distinct from
       '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
  then return false; end if;

  select * into adjudication
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where source_job_id = p_source_job_id;
  if adjudication.verifier_job_id is null then return false; end if;

  select * into capture
    from sellerpilot_private.coupang_exact_live_invalid_completion_captures
   where verifier_job_id = adjudication.verifier_job_id;
  select * into run
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = adjudication.verifier_job_id;
  select * into source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = adjudication.source_job_id;
  select * into source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = adjudication.source_attempt_id;
  select * into verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = adjudication.verifier_job_id;
  select * into listing
    from sellerpilot_private.product_listings
   where id = adjudication.listing_id;

  return capture.verifier_job_id is not null
    and run.verifier_job_id = adjudication.verifier_job_id
    and run.source_job_id = adjudication.source_job_id
    and run.source_attempt_id = adjudication.source_attempt_id
    and run.listing_id = adjudication.listing_id
    and run.remote_id = adjudication.remote_id
    and source_job.id = adjudication.source_job_id
    and source_job.status = 'reconciliation_required'
    and source_job.channel = 'coupang'
    and source_job.operation = 'listing.create'
    and source_attempt.id = adjudication.source_attempt_id
    and source_attempt.status = 'manual_required'
    and verifier.id = adjudication.verifier_job_id
    and verifier.status = 'reconciliation_required'
    and verifier.channel = 'coupang'
    and verifier.operation = 'listing.publication.verify'
    and verifier.attempt_id is null
    and verifier.provider_mutation_started_at is null
    and verifier.oauth_provider_call_started_at is null
    and verifier.write_resource_kind is null
    and verifier.write_resource_key is null
    and verifier.response_payload = capture.response_payload
    and encode(extensions.digest(verifier.response_payload::text, 'sha256'), 'hex')
          = adjudication.capture_response_sha256
    and encode(extensions.digest(to_jsonb(verifier)::text, 'sha256'), 'hex')
          = adjudication.verifier_job_sha256
    and encode(extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex')
          = adjudication.source_job_sha256
    and encode(extensions.digest(to_jsonb(source_attempt)::text, 'sha256'), 'hex')
          = adjudication.source_attempt_sha256
    and encode(extensions.digest(to_jsonb(run)::text, 'sha256'), 'hex')
          = adjudication.run_row_sha256
    and encode(extensions.digest(to_jsonb(capture)::text, 'sha256'), 'hex')
          = adjudication.capture_row_sha256
    and encode(
          extensions.digest(adjudication.adjudication_evidence::text, 'sha256'),
          'hex'
        ) = adjudication.adjudication_sha256
    and adjudication.source_listing_sha256 = run.source_listing_sha256
    and adjudication.listing_before_sha256 = run.source_listing_sha256
    and encode(
          extensions.digest(adjudication.listing_before_snapshot::text, 'sha256'),
          'hex'
        ) = adjudication.listing_before_sha256
    and encode(
          extensions.digest(adjudication.listing_after_snapshot::text, 'sha256'),
          'hex'
        ) = adjudication.listing_after_sha256
    and to_jsonb(listing) = adjudication.listing_after_snapshot
    and encode(extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex')
          = adjudication.listing_after_sha256
    and adjudication.decision = 'provider_live_price_drift'
    and adjudication.provider_live_verified
    and not adjudication.exact_content_verified
    and not adjudication.buyer_visible_verified
    and not adjudication.provider_mutation_performed
    and not adjudication.provider_call_replayed
    and not exists (
      select 1
        from sellerpilot_private.coupang_exact_live_verify_receipts receipt
       where receipt.verifier_job_id = adjudication.verifier_job_id
    )
    and not exists (
      select 1
        from sellerpilot_private.gateway_completion_receipts receipt
       where receipt.job_id = adjudication.verifier_job_id
    );
exception when others then
  return false;
end
$$;

revoke all on function
sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(uuid)
from public, anon, authenticated, service_role;

create or replace function
sellerpilot_private.coupang_exact_live_price_drift_listing_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_verifier_job_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(p_verifier_job_id, '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;

  return exists (
    select 1
      from sellerpilot_private.coupang_exact_live_price_drift_adjudications
        adjudication
     where adjudication.verifier_job_id = p_verifier_job_id::uuid
       and adjudication.listing_id = (p_old->>'id')::uuid
       and p_new->>'id' = p_old->>'id'
       and p_old = adjudication.listing_before_snapshot
       and p_new = adjudication.listing_after_snapshot
       and encode(extensions.digest(p_old::text, 'sha256'), 'hex')
             = adjudication.listing_before_sha256
       and encode(extensions.digest(p_new::text, 'sha256'), 'hex')
             = adjudication.listing_after_sha256
       and p_new->>'status' = 'failed'
       and p_new->>'failure_class' = 'external_action'
       and p_new->>'remote_visibility' = 'live'
       and p_new->>'remote_id' = '16375780938'
       and p_new->'published_at' is not distinct from p_old->'published_at'
       and p_new->'public_url' is not distinct from p_old->'public_url'
       and (
         p_new - array[
           'status', 'failure_class', 'remote_visibility', 'provider_status',
           'remote_resources', 'last_verified_at', 'last_error', 'updated_at'
         ]::text[]
       ) = (
         p_old - array[
           'status', 'failure_class', 'remote_visibility', 'provider_status',
           'remote_resources', 'last_verified_at', 'last_error', 'updated_at'
         ]::text[]
       )
  );
exception when others then
  return false;
end
$$;

revoke all on function
sellerpilot_private.coupang_exact_live_price_drift_listing_update_allowed(
  jsonb, jsonb, text
)
from public, anon, authenticated, service_role;

do $listing_guard$
declare
  procedure_name constant regprocedure :=
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure;
  definition text;
  begin_position integer;
  branch constant text := E'\n  if nullif(current_setting(''sellerpilot.coupang_exact_live_price_drift_adjudicate'', true), '''') is not null then\n    if sellerpilot_private.coupang_exact_live_price_drift_listing_update_allowed(\n      to_jsonb(old),\n      to_jsonb(new),\n      current_setting(''sellerpilot.coupang_exact_live_price_drift_adjudicate'', true)\n    ) is not true then\n      raise exception ''invalid exact Coupang price-drift listing projection''\n        using errcode = ''55000'';\n    end if;\n    return new;\n  end if;\n';
begin
  select pg_catalog.pg_get_functiondef(procedure_name) into strict definition;
  if pg_catalog.strpos(
       definition,
       'sellerpilot.coupang_exact_live_price_drift_adjudicate'
     ) > 0 then
    return;
  end if;
  begin_position := pg_catalog.strpos(lower(definition), 'begin');
  if begin_position = 0 then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_LISTING_GUARD_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  definition := pg_catalog.substr(definition, 1, begin_position + 4)
    || branch || pg_catalog.substr(definition, begin_position + 5);
  execute definition;
end
$listing_guard$;

do $patch_scoped_setter$
declare
  procedure_name constant regprocedure :=
    'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure;
  definition text;
  patched_definition text;
  before_pattern constant text :=
    E'when[[:space:]]+''coupang''[[:space:]]+then[[:space:]]+not[[:space:]]+sellerpilot_private\\.listing_mutation_reconciliation_resolved\\(job\\.id\\)';
  after_fragment constant text := E'when ''coupang'' then\n                 not (\n                   sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)\n                   or sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(job.id)\n                 )';
begin
  select pg_catalog.pg_get_functiondef(procedure_name) into strict definition;
  if pg_catalog.strpos(
       definition,
       'coupang_exact_live_price_drift_reconciliation_resolved'
     ) > 0 then
    if definition ~ before_pattern then
      raise exception 'COUPANG_EXACT_PRICE_DRIFT_SETTER_POSTIMAGE_AMBIGUOUS'
        using errcode = '55000';
    end if;
    return;
  end if;
  patched_definition := pg_catalog.regexp_replace(
    definition,
    before_pattern,
    after_fragment
  );
  if patched_definition = definition or patched_definition ~ before_pattern then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_SETTER_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  execute patched_definition;
end
$patch_scoped_setter$;

do $patch_scoped_status$
declare
  procedure_name constant regprocedure :=
    'public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()'::regprocedure;
  definition text;
  patched_definition text;
  before_pattern constant text :=
    E'and[[:space:]]+not[[:space:]]+sellerpilot_private\\.listing_mutation_reconciliation_resolved\\(job\\.id\\)';
  after_fragment constant text := E'and not (\n             sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)\n             or sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(job.id)\n           )';
begin
  select pg_catalog.pg_get_functiondef(procedure_name) into strict definition;
  if pg_catalog.strpos(
       definition,
       'coupang_exact_live_price_drift_reconciliation_resolved'
     ) > 0 then
    if definition ~ before_pattern then
      raise exception 'COUPANG_EXACT_PRICE_DRIFT_STATUS_POSTIMAGE_AMBIGUOUS'
        using errcode = '55000';
    end if;
    return;
  end if;
  patched_definition := pg_catalog.regexp_replace(
    definition,
    before_pattern,
    after_fragment
  );
  if patched_definition = definition or patched_definition ~ before_pattern then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_STATUS_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;
  execute patched_definition;
end
$patch_scoped_status$;

do $adjudicate$
declare
  v_verifier_id constant uuid :=
    '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;
  v_source_job_id constant uuid :=
    '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid;
  v_source_attempt_id constant uuid :=
    'd771421b-f408-4f75-addd-03879393fab8'::uuid;
  v_listing_id constant uuid :=
    'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid;
  v_remote_id constant text := '16375780938';
  v_vendor_id constant text := '96027942778';
  v_response_sha constant text :=
    '1f3c77508fef248047f30ee6e6e2f976242596c0575df5a79b725f9c520499f7';
  v_capture_migration_sha constant text :=
    '4fb9dba920a9473f7b07df2a54b4a70405e19d0b64ff854aa32a26c676387abb';
  v_last_error constant text :=
    'COUPANG_PROVIDER_LIVE_PRICE_DRIFT: source=3190 observed=6000; remote detail images stable but approved-source content digest is not exact.';
  v_present integer;
  v_existing integer;
  v_now timestamptz := clock_timestamp();
  capture
    sellerpilot_private.coupang_exact_live_invalid_completion_captures%rowtype;
  run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  source_attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  listing_after sellerpilot_private.product_listings%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  seller_step jsonb;
  vendor_step jsonb;
  content_step jsonb;
  source_images jsonb;
  captured_images jsonb;
  capture_sha text;
  run_sha text;
  source_job_sha text;
  source_attempt_sha text;
  verifier_sha text;
  listing_before jsonb;
  listing_before_sha text;
  listing_after_expected jsonb;
  listing_after_sha text;
  v_remote_resources jsonb;
  evidence jsonb;
  evidence_sha text;
  review_before jsonb;
  review_after jsonb;
begin
  select count(*) into v_existing
    from sellerpilot_private.coupang_exact_live_price_drift_adjudications
   where verifier_job_id = v_verifier_id;
  if v_existing = 1 then
    if sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
         v_source_job_id
       ) is not true then
      raise exception 'COUPANG_EXACT_PRICE_DRIFT_REPLAY_MISMATCH'
        using errcode = '55000';
    end if;
    return;
  elsif v_existing <> 0 then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_DUPLICATE_ADJUDICATION'
      using errcode = '55000';
  end if;

  select
    (select count(*) from
      sellerpilot_private.coupang_exact_live_invalid_completion_captures
      where verifier_job_id = v_verifier_id)
    + (select count(*) from sellerpilot_private.coupang_exact_live_verify_runs
      where verifier_job_id = v_verifier_id)
    + (select count(*) from sellerpilot_private.channel_gateway_jobs
      where id = v_verifier_id)
    + (select count(*) from sellerpilot_private.channel_gateway_jobs
      where id = v_source_job_id)
    + (select count(*) from sellerpilot_private.channel_operation_attempts
      where id = v_source_attempt_id)
    + (select count(*) from sellerpilot_private.product_listings
      where id = v_listing_id)
    into v_present;
  if v_present = 0 then return; end if;
  if v_present <> 6 then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_PARTIAL_PREIMAGE'
      using errcode = '55000';
  end if;

  select * into strict capture
    from sellerpilot_private.coupang_exact_live_invalid_completion_captures
   where verifier_job_id = v_verifier_id
   for share;
  select * into strict run
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = v_verifier_id
   for share;
  select * into strict verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = v_verifier_id
   for update;
  select * into strict source_job
    from sellerpilot_private.channel_gateway_jobs
   where id = v_source_job_id
   for share;
  select * into strict source_attempt
    from sellerpilot_private.channel_operation_attempts
   where id = v_source_attempt_id
   for share;
  select * into strict listing
    from sellerpilot_private.product_listings
   where id = v_listing_id
   for update;
  select * into strict credential
    from sellerpilot_private.channel_credentials
   where id = verifier.credential_id
   for share;
  select to_jsonb(review) into review_before
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = v_listing_id
   for share;

  capture_sha := encode(
    extensions.digest(to_jsonb(capture)::text, 'sha256'), 'hex'
  );
  run_sha := encode(extensions.digest(to_jsonb(run)::text, 'sha256'), 'hex');
  source_job_sha := encode(
    extensions.digest(to_jsonb(source_job)::text, 'sha256'), 'hex'
  );
  source_attempt_sha := encode(
    extensions.digest(to_jsonb(source_attempt)::text, 'sha256'), 'hex'
  );
  verifier_sha := encode(
    extensions.digest(to_jsonb(verifier)::text, 'sha256'), 'hex'
  );
  listing_before := to_jsonb(listing);
  listing_before_sha := encode(
    extensions.digest(listing_before::text, 'sha256'), 'hex'
  );

  select step.value into seller_step
    from jsonb_array_elements(capture.response_payload->'steps')
      with ordinality step(value, ordinality)
   where step.value->>'name' = 'seller-product-publication-reverification';
  select step.value into vendor_step
    from jsonb_array_elements(capture.response_payload->'steps')
      with ordinality step(value, ordinality)
   where step.value->>'name' = 'vendor-item-publication-reverification';
  select step.value into content_step
    from jsonb_array_elements(capture.response_payload->'steps')
      with ordinality step(value, ordinality)
   where step.value->>'name' = 'publication-content-verification';

  source_images :=
    sellerpilot_private.coupang_exact_live_ordered_detail_images(
      source_job.response_payload,
      'listing-approval-readback'
    );
  captured_images :=
    sellerpilot_private.coupang_exact_live_ordered_detail_images(
      capture.response_payload,
      'seller-product-publication-reverification'
    );

  if coalesce(capture.verifier_job_id <> v_verifier_id
     or capture.source_job_id <> v_source_job_id
     or capture.source_attempt_id <> v_source_attempt_id
     or capture.listing_id <> v_listing_id
     or capture.worker_token_id <>
          '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
     or capture.claim_token <>
          '6eb48202-e6e3-4b3a-a280-af5805fc404a'::uuid
     or capture.response_sha256 <> v_response_sha
     or encode(
          extensions.digest(capture.response_payload::text, 'sha256'), 'hex'
        ) <> v_response_sha
     or capture.adjudication <> 'unresolved'
     or capture.contract <> 'coupang_exact_live_invalid_completion_capture_v1'
     or capture.validation_sqlstate <> '55000'
     or capture.validation_message <>
          'exact Coupang GET verification incomplete'
     or capture.provider_mutation_performed
     or capture.buyer_visible_verified
     or encode(
          extensions.digest(capture.claimed_job_snapshot::text, 'sha256'),
          'hex'
        ) <> capture.claimed_job_sha256
     or run.verifier_job_id <> v_verifier_id
     or run.source_job_id <> v_source_job_id
     or run.source_attempt_id <> v_source_attempt_id
     or run.listing_id <> v_listing_id
     or run.remote_id <> v_remote_id
     or run.source_job_sha256 <> source_job_sha
     or run.source_attempt_sha256 <> source_attempt_sha
     or run.source_listing_sha256 <> listing_before_sha
     or capture.listing_sha256 <> listing_before_sha
     or capture.listing_snapshot <> listing_before
     or capture.completed_job_sha256 <> verifier_sha
     or capture.completed_job_snapshot <> to_jsonb(verifier)
     or verifier.channel <> 'coupang'
     or verifier.operation <> 'listing.publication.verify'
     or verifier.environment <> 'production'
     or verifier.listing_id <> v_listing_id
     or verifier.credential_id <> source_job.credential_id
     or verifier.created_by <> source_job.created_by
     or verifier.seller_account_key is distinct from
          source_job.seller_account_key
     or verifier.status <> 'reconciliation_required'
     or verifier.response_payload <> capture.response_payload
     or verifier.attempt_id is not null
     or verifier.worker_token_id is not null
     or verifier.claim_token is not null
     or verifier.lease_expires_at is not null
     or verifier.provider_mutation_started_at is not null
     or verifier.oauth_provider_call_started_at is not null
     or verifier.write_resource_kind is not null
     or verifier.write_resource_key is not null
     or source_job.status <> 'reconciliation_required'
     or source_job.channel <> 'coupang'
     or source_job.operation <> 'listing.create'
     or source_job.environment <> 'production'
     or source_job.attempt_id <> v_source_attempt_id
     or source_job.listing_id <> v_listing_id
     or source_job.credential_id <> verifier.credential_id
     or source_attempt.status <> 'manual_required'
     or source_attempt.channel <> 'coupang'
     or source_attempt.operation <> 'listing.create'
     or source_attempt.remote_id <> v_remote_id
     or source_attempt.owner_id <> listing.owner_id
     or source_attempt.credential_id <> source_job.credential_id
     or source_attempt.seller_account_key is distinct from
          source_job.seller_account_key
     or credential.id <> source_job.credential_id
     or credential.created_by <> source_job.created_by
     or credential.channel <> 'coupang'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or credential.seller_account_key is distinct from source_job.seller_account_key
     or source_job.created_by = source_attempt.owner_id
     or listing.channel_key <> 'coupang'
     or listing.operation_attempt_id <> v_source_attempt_id
     or listing.remote_id <> v_remote_id
     or listing.status <> 'failed'
     or listing.failure_class <> 'external_action'
     or listing.requested_publication_intent <> 'live'
     or listing.remote_visibility <> 'unknown'
     or capture.publication_review_snapshot is distinct from review_before
     or (
       review_before is not null
       and capture.publication_review_sha256 <> encode(
         extensions.digest(review_before::text, 'sha256'), 'hex'
       )
     )
     or capture.response_payload->'ok' <> 'false'::jsonb
     or capture.response_payload->>'channel' <> 'coupang'
     or capture.response_payload->>'operation' <>
          'listing.publication.verify'
     or capture.response_payload->>'remoteId' <> v_remote_id
     or capture.response_payload->>'publicationIntent' <> 'live'
     or capture.response_payload->>'publicationStateContract' <>
          'verified_remote_state_v1'
     or capture.response_payload ? 'remoteState'
     or capture.response_payload ? 'publicationFulfilled'
     or jsonb_array_length(capture.response_payload->'steps') <> 3
     or (select count(*) from jsonb_array_elements(capture.response_payload->'steps') step
          where step->>'name' = 'seller-product-publication-reverification') <> 1
     or (select count(*) from jsonb_array_elements(capture.response_payload->'steps') step
          where step->>'name' = 'vendor-item-publication-reverification') <> 1
     or (select count(*) from jsonb_array_elements(capture.response_payload->'steps') step
          where step->>'name' = 'publication-content-verification') <> 1
     or seller_step->'ok' <> 'true'::jsonb
     or (seller_step->>'status')::integer not between 200 and 299
     or seller_step#>>'{data,code}' <> 'SUCCESS'
     or seller_step#>>'{data,data,sellerProductId}' <> v_remote_id
     or upper(seller_step#>>'{data,data,status}') <> 'APPROVED'
     or seller_step#>'{data,data,requested}' <> 'false'::jsonb
     or jsonb_array_length(seller_step#>'{data,data,items}') <> 1
     or seller_step#>>'{data,data,items,0,vendorItemId}' <> v_vendor_id
     or vendor_step->'ok' <> 'true'::jsonb
     or (vendor_step->>'status')::integer not between 200 and 299
     or vendor_step#>>'{data,code}' <> 'SUCCESS'
     or vendor_step#>>'{data,sellerpilotVendorItemId}' <> v_vendor_id
     or vendor_step#>'{data,data,onSale}' <> 'true'::jsonb
     or (vendor_step#>>'{data,data,amountInStock}')::integer <> 1
     or (vendor_step#>>'{data,data,salePrice}')::integer <> 6000
     or (source_job.request_payload#>>'{arguments,body,items,0,salePrice}')::integer
          <> 3190
     or content_step->'ok' <> 'false'::jsonb
     or (content_step->>'status')::integer <> 422
     or content_step#>>'{data,sellerpilotVerification}' <>
          'LISTING_PUBLICATION_CONTENT_UNVERIFIED'
     or content_step#>'{data,mismatchFields}' <>
          '["detailImages","contentDigest"]'::jsonb
     or content_step#>'{data,detailImageCountVerified}' <> 'false'::jsonb
     or content_step#>'{data,contentDigestVerified}' <> 'false'::jsonb
     or content_step#>'{data,titleVerified}' <> 'true'::jsonb
     or content_step#>'{data,descriptionVerified}' <> 'true'::jsonb
     or content_step#>'{data,titleLanguageVerified}' <> 'true'::jsonb
     or content_step#>'{data,descriptionLanguageVerified}' <> 'true'::jsonb
     or content_step#>'{data,languageContentVerified}' <> 'true'::jsonb
     or content_step#>'{data,approvedManifestDigestVerified}' <> 'true'::jsonb
     or content_step#>'{data,sourceIdentityVerified}' <> 'true'::jsonb
     or content_step#>'{data,representativeImageVerified}' <> 'true'::jsonb
     or content_step#>'{data,providerBodyDetailImagesVerified}' <> 'true'::jsonb
     or content_step#>>'{data,sourceJobId}' <> v_source_job_id::text
     or (content_step#>>'{data,sourceDetailImageCount}')::integer <> 8
     or (content_step#>>'{data,sourceReadbackDetailImageCount}')::integer <> 8
     or (content_step#>>'{data,remoteDetailImageCount}')::integer <> 8
     or jsonb_array_length(source_images) <> 8
     or jsonb_array_length(captured_images) <> 8
     or source_images <> captured_images
     or (select count(distinct image#>>'{}') from jsonb_array_elements(source_images) image) <> 8
     or exists (
       select 1 from jsonb_array_elements_text(source_images) image
        where pg_catalog.strpos(image, '/vendor_inventory/') = 0
     )
     or exists (
       select 1 from sellerpilot_private.coupang_exact_live_verify_receipts receipt
        where receipt.verifier_job_id = v_verifier_id
     )
     or exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_verifier_id
     )
  , true) then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_PREIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  v_remote_resources := jsonb_build_object(
    'contract', 'coupang_provider_live_price_drift_v1',
    'resources', jsonb_build_object(
      'sellerProductId', v_remote_id,
      'vendorItemIds', jsonb_build_array(v_vendor_id)
    ),
    'verification', jsonb_build_object(
      'captureResponseSha256', v_response_sha,
      'sourcePrice', 3190,
      'observedPrice', 6000,
      'observedStock', 1,
      'sellerApproved', true,
      'sellerRequested', false,
      'allVendorItemsOnSale', true,
      'orderedRemoteImagesMatch', true,
      'remoteDetailImageCount', 8,
      'exactContentVerified', false,
      'buyerVisibleVerified', false,
      'providerMutationPerformed', false,
      'decision', 'provider_live_price_drift'
    )
  );

  listing_after_expected := listing_before || jsonb_build_object(
    'status', 'failed',
    'failure_class', 'external_action',
    'remote_visibility', 'live',
    'provider_status', 'APPROVED|requested=false|onSale=true',
    'remote_resources', v_remote_resources,
    'last_verified_at', verifier.completed_at,
    'last_error', v_last_error,
    'updated_at', v_now
  );
  listing_after_sha := encode(
    extensions.digest(listing_after_expected::text, 'sha256'), 'hex'
  );
  evidence := jsonb_build_object(
    'contract', 'coupang_exact_live_price_drift_adjudication_v1',
    'decision', 'provider_live_price_drift',
    'captureMigrationSha256', v_capture_migration_sha,
    'captureResponseSha256', v_response_sha,
    'captureRowSha256', capture_sha,
    'runRowSha256', run_sha,
    'sourceJobSha256', source_job_sha,
    'sourceAttemptSha256', source_attempt_sha,
    'sourceListingSha256', run.source_listing_sha256,
    'verifierJobSha256', verifier_sha,
    'listingBeforeSha256', listing_before_sha,
    'listingAfterSha256', listing_after_sha,
    'remoteId', v_remote_id,
    'vendorItemIds', jsonb_build_array(v_vendor_id),
    'sourcePrice', 3190,
    'observedPrice', 6000,
    'observedStock', 1,
    'sellerApproved', true,
    'sellerRequested', false,
    'allVendorItemsOnSale', true,
    'sourceRemoteDetailImages', source_images,
    'capturedRemoteDetailImages', captured_images,
    'orderedRemoteImagesMatch', true,
    'mismatchFields', jsonb_build_array('detailImages', 'contentDigest'),
    'providerLiveVerified', true,
    'exactContentVerified', false,
    'buyerVisibleVerified', false,
    'providerMutationPerformed', false,
    'providerCallReplayed', false,
    'observedAt', verifier.completed_at
  );
  evidence_sha := encode(
    extensions.digest(evidence::text, 'sha256'), 'hex'
  );

  insert into
  sellerpilot_private.coupang_exact_live_price_drift_adjudications (
    verifier_job_id, source_job_id, source_attempt_id, listing_id,
    remote_id, vendor_item_ids, source_price, observed_price, observed_stock,
    seller_approved, seller_requested, all_vendor_items_on_sale,
    source_remote_detail_images, captured_remote_detail_images,
    ordered_remote_images_match, mismatch_fields, provider_live_verified,
    exact_content_verified, buyer_visible_verified,
    provider_mutation_performed, provider_call_replayed,
    capture_response_sha256, capture_row_sha256, capture_migration_sha256,
    run_row_sha256, source_job_sha256, source_attempt_sha256,
    source_listing_sha256, verifier_job_sha256,
    listing_before_snapshot, listing_before_sha256,
    listing_after_snapshot, listing_after_sha256,
    adjudication_evidence, adjudication_sha256, decision, contract,
    observed_at, adjudicated_at
  ) values (
    v_verifier_id, v_source_job_id, v_source_attempt_id, v_listing_id,
    v_remote_id, jsonb_build_array(v_vendor_id), 3190, 6000, 1,
    true, false, true, source_images, captured_images, true,
    jsonb_build_array('detailImages', 'contentDigest'), true, false, false,
    false, false, v_response_sha, capture_sha, v_capture_migration_sha,
    run_sha, source_job_sha, source_attempt_sha, run.source_listing_sha256,
    verifier_sha, listing_before, listing_before_sha,
    listing_after_expected, listing_after_sha, evidence, evidence_sha,
    'provider_live_price_drift',
    'coupang_exact_live_price_drift_adjudication_v1',
    verifier.completed_at, v_now
  );

  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_price_drift_adjudicate',
    v_verifier_id::text,
    true
  );
  update sellerpilot_private.product_listings listing_row
     set status = 'failed',
         failure_class = 'external_action',
         remote_visibility = 'live',
         provider_status = 'APPROVED|requested=false|onSale=true',
         remote_resources = v_remote_resources,
         last_verified_at = verifier.completed_at,
         last_error = v_last_error,
         updated_at = v_now
   where listing_row.id = v_listing_id
     and to_jsonb(listing_row) = listing_before;
  if not found then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_LISTING_UPDATE_LOST_FENCE'
      using errcode = '55000';
  end if;

  select * into strict listing_after
    from sellerpilot_private.product_listings
   where id = v_listing_id;
  select to_jsonb(review) into review_after
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = v_listing_id;

  if to_jsonb(listing_after) <> listing_after_expected
     or encode(
          extensions.digest(to_jsonb(listing_after)::text, 'sha256'), 'hex'
        ) <> listing_after_sha
     or listing_after.published_at is distinct from listing.published_at
     or listing_after.public_url is distinct from listing.public_url
     or review_after is distinct from review_before
     or sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(
          v_source_job_id
        ) is not true
     or exists (
       select 1 from sellerpilot_private.coupang_exact_live_verify_receipts receipt
        where receipt.verifier_job_id = v_verifier_id
     )
     or exists (
       select 1 from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = v_verifier_id
     )
  then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_POSTIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  insert into sellerpilot_private.operation_audit(
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    listing.owner_id,
    'coupang_exact_live_price_drift_adjudicated',
    'product_listing',
    listing.id::text,
    jsonb_build_object(
      'contract', 'coupang_exact_live_price_drift_adjudication_v1',
      'decision', 'provider_live_price_drift',
      'sourcePrice', 3190,
      'observedPrice', 6000,
      'remoteId', v_remote_id,
      'vendorItemIds', jsonb_build_array(v_vendor_id),
      'captureResponseSha256', v_response_sha,
      'adjudicationSha256', evidence_sha,
      'providerMutationPerformed', false,
      'buyerVisibleVerified', false
    )
  );
end
$adjudicate$;

do $postflight$
declare
  trigger_enabled "char";
  trigger_function oid;
  trigger_type smallint;
  guard_definition text;
  setter_definition text;
  status_definition text;
  current_status_definition text;
  global_resolver_definition text;
  ledger_rls boolean;
begin
  select trigger_row.tgenabled,
         trigger_row.tgfoid,
         trigger_row.tgtype
    into strict trigger_enabled, trigger_function, trigger_type
    from pg_catalog.pg_trigger trigger_row
   where trigger_row.tgrelid =
     'sellerpilot_private.coupang_exact_live_price_drift_adjudications'::regclass
     and trigger_row.tgname =
       'block_coupang_exact_live_price_drift_adjudication_change'
     and not trigger_row.tgisinternal;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into strict guard_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text)'::regprocedure
  ) into strict setter_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()'::regprocedure
  ) into strict status_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure
  ) into strict current_status_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.listing_mutation_reconciliation_resolved(uuid)'::regprocedure
  ) into strict global_resolver_definition;
  select relation.relrowsecurity into strict ledger_rls
    from pg_catalog.pg_class relation
   where relation.oid =
     'sellerpilot_private.coupang_exact_live_price_drift_adjudications'::regclass;

  if trigger_enabled <> 'O'
     or trigger_function <>
       'sellerpilot_private.block_coupang_exact_live_price_drift_adjudication_change()'::regprocedure::oid
     or trigger_type <> 27
     or pg_catalog.strpos(
       guard_definition,
       'sellerpilot.coupang_exact_live_price_drift_adjudicate'
     ) = 0
     or pg_catalog.strpos(
       setter_definition,
       'coupang_exact_live_price_drift_reconciliation_resolved'
     ) = 0
     or pg_catalog.strpos(
       status_definition,
       'coupang_exact_live_price_drift_reconciliation_resolved'
     ) = 0
     or pg_catalog.strpos(
       current_status_definition,
       'sellerpilot_071510_listing_gate_status_pre_smartstore_scope'
     ) = 0
     or pg_catalog.strpos(
       global_resolver_definition,
       'coupang_exact_live_price_drift_reconciliation_resolved'
     ) <> 0
     or not ledger_rls
     or has_table_privilege(
       'anon',
       'sellerpilot_private.coupang_exact_live_price_drift_adjudications',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'sellerpilot_private.coupang_exact_live_price_drift_adjudications',
       'SELECT'
     )
     or has_table_privilege(
       'service_role',
       'sellerpilot_private.coupang_exact_live_price_drift_adjudications',
       'SELECT'
     )
     or has_function_privilege(
       'service_role',
       'sellerpilot_private.coupang_exact_live_price_drift_reconciliation_resolved(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'sellerpilot_private.coupang_exact_live_price_drift_listing_update_allowed(jsonb,jsonb,text)',
       'EXECUTE'
     )
  then
    raise exception 'COUPANG_EXACT_PRICE_DRIFT_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;
end
$postflight$;

comment on table
sellerpilot_private.coupang_exact_live_price_drift_adjudications is
  'Immutable negative reconciliation for exact Coupang seller product 16375780938. Records provider-live price drift from source 3190 to observed 6000 without asserting exact content or buyer visibility.';

commit;
