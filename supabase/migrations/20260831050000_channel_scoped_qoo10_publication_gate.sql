-- Forward-only release after the CS 20260831033000 ledger migration. This
-- migration intentionally assumes the deployed schema objects from
-- 20260830222257 and 20260831010000 already exist; it does not replay or
-- repair their migration-history rows.
--
-- Allow an explicitly attested Qoo10 adapter to open a release-scoped provider
-- mutation boundary without asserting that the other six publication adapters
-- are ready. The existing global gate remains the only path for every other
-- channel. All enqueue, claim, and provider-write boundaries evaluate the
-- concrete job channel so a Qoo10-scoped opening cannot leak to another
-- marketplace.

begin;

alter table sellerpilot_private.listing_mutation_release_gate
  add column opened_channel text;

alter table sellerpilot_private.listing_mutation_release_gate
  add constraint listing_mutation_release_gate_channel_check check (
    opened_channel is null or opened_channel = 'qoo10'
  ),
  add constraint listing_mutation_release_gate_closed_channel_check check (
    is_open or opened_channel is null
  );

-- Do not inherit an opening from the previous global contract. Installation
-- is serialized with every provider-mutation boundary and aborts if a listing
-- job can still be claimed or is already executing.
do $installation_fence$
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.operation in (
       'listing.create', 'listing.update', 'listing.stop'
     )
       and job.status in ('queued', 'running')
  ) then
    raise exception
      'listing mutation jobs must drain before scoped release-gate installation'
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
$installation_fence$;

create function sellerpilot_private.listing_publication_review_violation_count(
  p_channel text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel is distinct from 'qoo10' then 1
    else (
      select count(*)::integer
        from (
          select listing.id
            from sellerpilot_private.product_listings listing
           where listing.channel_key = p_channel
             and listing.requested_publication_intent = 'live'
             and listing.remote_visibility = 'pending_review'
             and not sellerpilot_private.listing_publication_review_is_current(
               listing.id
             )
          union all
          select review.listing_id
            from sellerpilot_private.listing_publication_reviews review
            join sellerpilot_private.product_listings listing
              on listing.id = review.listing_id
           where review.channel = p_channel
             and listing.channel_key = p_channel
             and review.status in ('pending', 'queued', 'verifying')
             and not (
               listing.requested_publication_intent = 'live'
               and listing.remote_visibility = 'pending_review'
             )
        ) violation
    )
  end;
$$;

create function sellerpilot_private.attested_listing_publication_release_sha(
  p_channel text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel = 'qoo10'
     and adapter.adapter_ready
     and adapter.contract_version = 'verified_remote_state_v1'
     and rechecker.rechecker_ready
     and rechecker.release_sha = adapter.release_sha
      then adapter.release_sha
    else null
  end
    from sellerpilot_private.listing_publication_adapter_release adapter
    join sellerpilot_private.listing_publication_rechecker_release rechecker
      on rechecker.singleton
   where adapter.channel = p_channel;
$$;

-- The no-argument predicate continues to mean the seven-channel global gate.
-- Requiring a null opened_channel is the critical fail-closed distinction
-- between a global opening and the Qoo10-only opening introduced below.
create or replace function sellerpilot_private.listing_mutation_release_gate_is_effective()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    gate.is_open
    and gate.opened_channel is null
    and gate.opened_release_sha
          = sellerpilot_private.attested_listing_publication_release_sha()
    and gate.opened_release_sha
          = sellerpilot_private.active_serverless_runtime_release_sha()
    and sellerpilot_private.listing_publication_review_violation_count() = 0,
    false
  )
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton;
$$;

create function sellerpilot_private.listing_mutation_release_gate_is_effective(
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
        'elevenst', 'smartstore', 'ebay'
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

revoke all on function
  sellerpilot_private.listing_publication_review_violation_count(text)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.attested_listing_publication_release_sha(text)
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.listing_mutation_release_gate_is_effective(text)
  from public, anon, authenticated, service_role;

-- Attestation drift closes both global and scoped openings. Clear the scope
-- marker in the same statement so closed rows can never retain stale scope.
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
       'qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay'
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

create or replace function public.sellerpilot_service_set_listing_publication_rechecker_ready(
  p_ready boolean,
  p_release_sha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row sellerpilot_private.listing_publication_rechecker_release%rowtype;
begin
  if p_ready is null
     or (p_ready and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$') then
    raise exception 'invalid listing publication rechecker attestation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  update sellerpilot_private.listing_publication_rechecker_release release
     set rechecker_ready = p_ready,
         release_sha = case when p_ready then p_release_sha else null end,
         verified_at = case when p_ready then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where release.singleton
   returning release.* into v_row;
  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = false,
         opened_at = null,
         opened_release_sha = null,
         opened_channel = null,
         updated_at = clock_timestamp()
   where gate.singleton
     and gate.is_open
     and (
       not p_ready
       or gate.opened_release_sha is distinct from p_release_sha
     );
  return jsonb_build_object(
    'ready', v_row.rechecker_ready, 'releaseSha', v_row.release_sha,
    'verifiedAt', v_row.verified_at
  );
end;
$$;

-- Preserve the existing global opener. It still requires all seven adapters,
-- the rechecker, the active runtime, and a clean global review/job ledger.
create or replace function public.sellerpilot_service_set_listing_mutation_release_gate(
  p_open boolean,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans integer;
  v_attested_release text;
  v_active_runtime_release text;
  v_queued_or_running integer;
  v_reconciliation_required integer;
begin
  if p_open is null then
    raise exception 'listing mutation release-gate state required'
      using errcode = '22004';
  end if;
  if p_open and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$' then
    raise exception 'exact listing publication release required'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  perform 1
    from sellerpilot_private.listing_publication_adapter_release release
   order by release.channel
   for update;
  perform 1
    from sellerpilot_private.listing_publication_rechecker_release release
   where release.singleton
   for update;
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  if p_open then
    v_attested_release :=
      sellerpilot_private.attested_listing_publication_release_sha();
    if v_attested_release is null
       or v_attested_release is distinct from p_release_sha then
      raise exception 'all publication components must attest the exact release'
        using errcode = '55000';
    end if;
    v_active_runtime_release :=
      sellerpilot_private.active_serverless_runtime_release_sha();
    if v_active_runtime_release is null
       or v_active_runtime_release is distinct from p_release_sha then
      raise exception 'active serverless runtime must match the exact release'
        using errcode = '55000';
    end if;
    v_orphans :=
      sellerpilot_private.listing_publication_review_violation_count();
    if v_orphans <> 0 then
      raise exception 'orphan pending publication reviews must be resolved'
        using errcode = '55000';
    end if;
  end if;

  select count(*) filter (
           where job.status in ('queued', 'running')
         )::integer,
         count(*) filter (
           where job.status = 'reconciliation_required'
         )::integer
    into v_queued_or_running, v_reconciliation_required
    from sellerpilot_private.channel_gateway_jobs job
   where job.operation in ('listing.create', 'listing.update', 'listing.stop');
  if p_open and v_queued_or_running <> 0 then
    raise exception
      'listing mutation jobs must drain before release-gate activation'
      using errcode = '55000';
  end if;
  if p_open and v_reconciliation_required <> 0 then
    raise exception
      'listing mutation reconciliations must be resolved before release-gate activation'
      using errcode = '55000';
  end if;

  update sellerpilot_private.listing_mutation_release_gate gate
     set is_open = p_open,
         opened_at = case when p_open then clock_timestamp() else null end,
         opened_release_sha = case when p_open then p_release_sha else null end,
         opened_channel = null,
         updated_at = clock_timestamp()
   where gate.singleton;
  if not found then
    raise exception 'listing mutation release-gate state missing'
      using errcode = '55000';
  end if;

  return public.sellerpilot_service_listing_mutation_release_gate_status();
end;
$$;

-- This is deliberately not a generic per-channel opener. Only Qoo10 has the
-- exact update/readback evidence required for this release. Adding another
-- channel requires a new forward migration and review of that adapter.
create function public.sellerpilot_service_set_listing_channel_mutation_release_gate(
  p_channel text,
  p_open boolean,
  p_release_sha text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans integer;
  v_attested_release text;
  v_active_runtime_release text;
  v_queued_or_running integer;
  v_reconciliation_required integer;
  v_global_running integer;
begin
  if p_channel is distinct from 'qoo10' or p_open is null then
    raise exception 'unsupported scoped listing publication channel'
      using errcode = '22023';
  end if;
  if p_open and coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$' then
    raise exception 'exact scoped listing publication release required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform 1
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton
   for update;
  perform 1
    from sellerpilot_private.listing_publication_adapter_release release
   where release.channel = p_channel
   for update;
  perform 1
    from sellerpilot_private.listing_publication_rechecker_release release
   where release.singleton
   for update;
  lock table sellerpilot_private.channel_gateway_jobs
    in share row exclusive mode;

  if p_open then
    v_attested_release :=
      sellerpilot_private.attested_listing_publication_release_sha(p_channel);
    if v_attested_release is null
       or v_attested_release is distinct from p_release_sha then
      raise exception 'scoped publication components must attest the exact release'
        using errcode = '55000';
    end if;
    v_active_runtime_release :=
      sellerpilot_private.active_serverless_runtime_release_sha();
    if v_active_runtime_release is null
       or v_active_runtime_release is distinct from p_release_sha then
      raise exception 'active serverless runtime must match the exact release'
        using errcode = '55000';
    end if;
    v_orphans :=
      sellerpilot_private.listing_publication_review_violation_count(p_channel);
    if v_orphans <> 0 then
      raise exception 'scoped orphan pending publication reviews must be resolved'
        using errcode = '55000';
    end if;
  end if;

  select count(*) filter (
           where job.status in ('queued', 'running')
         )::integer,
         count(*) filter (
           where job.status = 'reconciliation_required'
         )::integer
    into v_queued_or_running, v_reconciliation_required
    from sellerpilot_private.channel_gateway_jobs job
   where job.channel = p_channel
     and job.operation in ('listing.create', 'listing.update', 'listing.stop');
  select count(*)::integer
    into v_global_running
    from sellerpilot_private.channel_gateway_jobs job
   where job.operation in ('listing.create', 'listing.update', 'listing.stop')
     and job.status = 'running';
  if p_open and v_global_running <> 0 then
    raise exception
      'running listing mutations must drain before scoped release-gate activation'
      using errcode = '55000';
  end if;
  if p_open and v_queued_or_running <> 0 then
    raise exception
      'scoped listing mutation jobs must drain before release-gate activation'
      using errcode = '55000';
  end if;
  if p_open and v_reconciliation_required <> 0 then
    raise exception
      'scoped listing mutation reconciliations must be resolved before release-gate activation'
      using errcode = '55000';
  end if;

  if p_open then
    update sellerpilot_private.listing_mutation_release_gate gate
       set is_open = true,
           opened_at = clock_timestamp(),
           opened_release_sha = p_release_sha,
           opened_channel = p_channel,
           updated_at = clock_timestamp()
     where gate.singleton;
  else
    update sellerpilot_private.listing_mutation_release_gate gate
       set is_open = false,
           opened_at = null,
           opened_release_sha = null,
           opened_channel = null,
           updated_at = clock_timestamp()
     where gate.singleton
       and gate.opened_channel = p_channel;
  end if;

  return public.sellerpilot_service_listing_mutation_release_gate_status();
end;
$$;

revoke all on function
  public.sellerpilot_service_set_listing_channel_mutation_release_gate(
    text, boolean, text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_set_listing_channel_mutation_release_gate(
    text, boolean, text
  ) to service_role;

-- Extend the status contract additively. effectiveOpen keeps its original
-- global meaning; qoo10EffectiveOpen is the only scoped permission bit.
create or replace function public.sellerpilot_service_listing_mutation_release_gate_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sellerpilot_301100_listing_gate_status_pre_publication_review()
    || jsonb_build_object(
      'publicationRecheckerReady', coalesce((
        select release.rechecker_ready
          from sellerpilot_private.listing_publication_rechecker_release release
         where release.singleton
      ), false),
      'publicationAdaptersReady', (
        select count(*)::integer
          from sellerpilot_private.listing_publication_adapter_release release
         where release.adapter_ready
      ),
      'attestedRelease',
        sellerpilot_private.attested_listing_publication_release_sha(),
      'activeRuntimeRelease',
        sellerpilot_private.active_serverless_runtime_release_sha(),
      'openedRelease', gate.opened_release_sha,
      'openedChannel', gate.opened_channel,
      'publicationReleaseConsistent',
        sellerpilot_private.attested_listing_publication_release_sha()
          is not null,
      'runtimeReleaseMatches',
        coalesce(
          sellerpilot_private.active_serverless_runtime_release_sha()
            = sellerpilot_private.attested_listing_publication_release_sha(),
          false
        ),
      'orphanPendingReviews',
        sellerpilot_private.listing_publication_review_violation_count(),
      'effectiveOpen',
        sellerpilot_private.listing_mutation_release_gate_is_effective(),
      'qoo10AdapterReady', coalesce((
        select release.adapter_ready
          from sellerpilot_private.listing_publication_adapter_release release
         where release.channel = 'qoo10'
      ), false),
      'qoo10AttestedRelease',
        sellerpilot_private.attested_listing_publication_release_sha('qoo10'),
      'qoo10ReleaseConsistent',
        sellerpilot_private.attested_listing_publication_release_sha('qoo10')
          is not null,
      'qoo10RuntimeReleaseMatches',
        coalesce(
          sellerpilot_private.active_serverless_runtime_release_sha()
            = sellerpilot_private.attested_listing_publication_release_sha(
                'qoo10'
              ),
          false
        ),
      'qoo10ReviewViolations',
        sellerpilot_private.listing_publication_review_violation_count('qoo10'),
      'qoo10QueuedOrRunning', (
        select count(*)::integer
          from sellerpilot_private.channel_gateway_jobs job
         where job.channel = 'qoo10'
           and job.operation in (
             'listing.create', 'listing.update', 'listing.stop'
           )
           and job.status in ('queued', 'running')
      ),
      'qoo10ReconciliationRequired', (
        select count(*)::integer
          from sellerpilot_private.channel_gateway_jobs job
         where job.channel = 'qoo10'
           and job.operation in (
             'listing.create', 'listing.update', 'listing.stop'
           )
           and job.status = 'reconciliation_required'
      ),
      'qoo10EffectiveOpen',
        sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10')
    )
    from sellerpilot_private.listing_mutation_release_gate gate
   where gate.singleton;
$$;

revoke all on function
  public.sellerpilot_service_listing_mutation_release_gate_status()
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_listing_mutation_release_gate_status()
  to service_role;

create or replace function sellerpilot_private.block_closed_listing_mutation_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'queued'
     and new.status = 'running'
     and (
       old.operation in ('listing.create', 'listing.update', 'listing.stop')
       or new.operation in ('listing.create', 'listing.update', 'listing.stop')
     )
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       coalesce(new.channel, old.channel)
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Preserve the post-CS inbound-generation/token fence as the delegate. The
-- Qoo10 channel gate is an outer listing-only boundary and must never replace
-- the CS reply fence installed by 20260831033000.
alter function public.sellerpilot_service_begin_gateway_provider_mutation(
  text, uuid, uuid
) rename to sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate;

revoke all on function
  public.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_begin_gateway_provider_mutation(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
  v_operation text;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  select job.channel, job.operation
    into v_channel, v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  if not found then return false; end if;
  if v_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       v_channel
     )
  then
    return false;
  end if;
  return public.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate(
    p_token_hash,
    p_job_id,
    p_claim_token
  );
end;
$$;

do $serverless_channel_gate$
begin
  if to_regprocedure(
    'public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'
  ) is null then
    return;
  end if;
  execute 'alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) rename to sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate';
  execute 'revoke all on function public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(text,uuid,uuid) from public,anon,authenticated,service_role';
  execute $create$
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      p_token_hash text,
      p_job_id uuid,
      p_claim_token uuid
    )
    returns boolean
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    declare
      v_channel text;
      v_operation text;
    begin
      perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
      select job.channel, job.operation
        into v_channel, v_operation
        from sellerpilot_private.channel_gateway_jobs job
       where job.id = p_job_id;
      if not found then return false; end if;
      if v_operation in ('listing.create', 'listing.update', 'listing.stop')
         and not sellerpilot_private.listing_mutation_release_gate_is_effective(
           v_channel
         )
      then
        return false;
      end if;
      return public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(
        p_token_hash,
        p_job_id,
        p_claim_token
      );
    end;
    $function$
  $create$;
  execute 'revoke all on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) from public, anon, authenticated, service_role';
  execute 'grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text, uuid, uuid) to service_role';
end;
$serverless_channel_gate$;

revoke all on function
  sellerpilot_private.block_closed_listing_mutation_claim()
  from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_gateway_provider_mutation(text, uuid, uuid)
  to service_role;

-- Retain the complete verified publication ledger behavior from 302050; only
-- its release decision becomes channel-aware.
create or replace function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent text := nullif(trim(
    p_request_payload#>>'{arguments,publicationIntent}'
  ), '');
  v_result jsonb;
  v_listing_id uuid;
  v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if not sellerpilot_private.listing_mutation_release_gate_is_effective(
    p_channel
  ) then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;

  perform sellerpilot_private.assert_verified_listing_enqueue_contract(
    'listing.create',
    p_request_payload,
    p_request_fingerprint,
    null
  );

  v_result := public.sellerpilot_300950_reserve_listing_before_release_gate(
    p_product_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_market,
    p_target_id,
    p_currency,
    p_price,
    p_request_fingerprint,
    p_request_payload
  );

  if v_result->>'status' = 'queued' then
    if coalesce(v_result->>'job_id', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_result->>'listing_id', '')
         !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'reserved publication job lineage missing';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;
    v_listing_id := (v_result->>'listing_id')::uuid;
    perform 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_job_id
       and job.listing_id = v_listing_id
       and job.attempt_id = p_attempt_id
       and job.channel = p_channel
       and job.operation = 'listing.create'
       and job.status in ('queued', 'running')
       and job.request_payload = p_request_payload
       and job.request_fingerprint = p_request_fingerprint;
    if not found then
      raise exception 'reserved publication job lineage mismatch';
    end if;
  end if;

  if v_result->>'status' = 'queued'
     and coalesce((v_result->>'reused')::boolean, false) is false
     and coalesce(v_result->>'listing_id', '')
       ~ '^[0-9a-fA-F-]{36}$' then
    v_listing_id := (v_result->>'listing_id')::uuid;
    update sellerpilot_private.product_listings listing
       set requested_publication_intent = v_intent,
           remote_visibility = 'unknown',
           provider_status = null,
           remote_resources = '{}'::jsonb,
           remote_created_at = null,
           published_at = null,
           last_verified_at = null,
           updated_at = clock_timestamp()
     where listing.id = v_listing_id
       and listing.operation_attempt_id = p_attempt_id
       and listing.channel_key = p_channel;
    if not found then
      raise exception 'reserved publication intent lineage mismatch';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;

-- Keep the final 20260830222257 Qoo10 S1 rollback exact-ledger wrapper intact.
-- It is moved behind a new outer channel gate, while its 20260830205000
-- predecessor is
-- replaced below so the nested effective-gate check is channel-aware too.
alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_310500_enqueue_listing_before_channel_gate;

revoke all on function
  public.sellerpilot_310500_enqueue_listing_before_channel_gate(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(
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
  v_intent text;
  v_requested_intent text;
  v_request_fingerprint text;
  v_payload jsonb := p_request_payload;
  v_result jsonb;
  v_job_id uuid;
  v_bound_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       p_channel
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;

  if p_operation = 'listing.create' then
    raise exception 'ATOMIC_LISTING_CREATE_REQUIRED';
  end if;

  select attempt.request_fingerprint
    into v_request_fingerprint
    from sellerpilot_private.channel_operation_attempts attempt
   where attempt.id = p_attempt_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = p_channel
     and attempt.operation = p_operation
     and attempt.status = 'running'
   for update;
  if not found then raise exception 'running listing operation required'; end if;

  if p_operation = 'listing.update' then
    select listing.requested_publication_intent
      into v_intent
      from sellerpilot_private.product_listings listing
     where listing.id = p_listing_id
       and listing.channel_key = p_channel
     for update;
    if not found then raise exception 'product listing not found'; end if;
    if jsonb_typeof(p_request_payload) <> 'object'
       or (
         p_request_payload ? 'arguments'
         and jsonb_typeof(p_request_payload->'arguments') <> 'object'
       ) then
      raise exception 'invalid listing update payload';
    end if;
    v_requested_intent := nullif(trim(
      p_request_payload#>>'{arguments,publicationIntent}'
    ), '');
    if v_requested_intent is not null
       and v_requested_intent is distinct from v_intent then
      raise exception 'listing update publication intent mismatch';
    end if;
    v_payload := jsonb_set(
      p_request_payload,
      '{arguments}',
      coalesce(p_request_payload->'arguments', '{}'::jsonb)
        || jsonb_build_object('publicationIntent', v_intent),
      true
    );
  end if;

  perform sellerpilot_private.assert_verified_listing_enqueue_contract(
    p_operation,
    v_payload,
    v_request_fingerprint,
    case when p_operation = 'listing.update' then v_intent else null end
  );

  v_result := public.sellerpilot_300950_enqueue_listing_before_release_gate(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    v_payload
  );

  if v_result->>'status' = 'queued' then
    if coalesce(v_result->>'job_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'verified publication job lineage missing';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;
    select job.id
      into v_bound_job_id
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = v_job_id
       and job.listing_id = p_listing_id
       and job.attempt_id = p_attempt_id
       and job.channel = p_channel
       and job.operation = p_operation
       and job.status = 'running'
       and job.request_payload = v_payload
       and job.request_fingerprint = v_request_fingerprint;
    if found then return v_result; end if;

    update sellerpilot_private.channel_gateway_jobs job
       set request_fingerprint = v_request_fingerprint,
           updated_at = clock_timestamp()
     where job.id = v_job_id
       and job.listing_id = p_listing_id
       and job.attempt_id = p_attempt_id
       and job.channel = p_channel
       and job.operation = p_operation
       and job.status = 'queued'
       and job.request_payload = v_payload
       and (
         job.request_fingerprint is null
         or job.request_fingerprint = v_request_fingerprint
       )
    returning job.id into v_bound_job_id;
    if v_bound_job_id is null then
      raise exception 'verified publication job lineage mismatch';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(
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
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       p_channel
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;
  return public.sellerpilot_310500_enqueue_listing_before_channel_gate(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

comment on column
  sellerpilot_private.listing_mutation_release_gate.opened_channel is
  'Null for the seven-channel global gate; qoo10 for the exact-SHA Qoo10-only gate.';
comment on function
  public.sellerpilot_service_set_listing_channel_mutation_release_gate(
    text, boolean, text
  ) is
  'Service-only exact-SHA Qoo10 scoped release gate; every other channel is rejected.';
comment on function
  sellerpilot_private.listing_mutation_release_gate_is_effective(text) is
  'Channel-aware effective provider-mutation boundary; qoo10 scoped or seven-channel global.';

commit;
