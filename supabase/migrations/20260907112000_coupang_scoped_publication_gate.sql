-- Permit a release-attested Coupang adapter to use the existing channel-scoped
-- publication boundary. Qoo10 keeps the same scoped contract and the global
-- eight-channel gate keeps its evidence-based reconciliation rules unchanged.
-- This migration neither mutates retained receipts nor creates a job exception.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_release_gate_is_effective(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.listing_mutation_release_gate_is_effective()'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_listing_mutation_release_gate_status()'
     ) is null
  then
    raise exception 'COUPANG_SCOPED_PUBLICATION_GATE_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end;
$dependencies$;

alter table sellerpilot_private.listing_mutation_release_gate
  drop constraint if exists listing_mutation_release_gate_channel_check;

alter table sellerpilot_private.listing_mutation_release_gate
  add constraint listing_mutation_release_gate_channel_check check (
    opened_channel is null or opened_channel in ('qoo10', 'coupang')
  );

create or replace function sellerpilot_private.listing_publication_review_violation_count(
  p_channel text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel is null or p_channel not in ('qoo10', 'coupang') then 1
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

create or replace function sellerpilot_private.attested_listing_publication_release_sha(
  p_channel text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel in ('qoo10', 'coupang')
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

-- The no-argument predicate remains the global eight-channel gate. A scoped
-- opening grants only the channel named on the singleton gate row.
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
      when p_channel = gate.opened_channel
       and p_channel in ('qoo10', 'coupang') then
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

create or replace function public.sellerpilot_service_set_listing_channel_mutation_release_gate(
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
  if p_channel is null
     or p_channel not in ('qoo10', 'coupang')
     or p_open is null then
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
             and (
               p_channel <> 'qoo10'
               or (
                 not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
                 and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)
               )
             )
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

  if not found and p_open then
    raise exception 'listing mutation release-gate state missing'
      using errcode = '55000';
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
      'listingMutationsRunning', (
        select count(*)::integer
          from sellerpilot_private.channel_gateway_jobs job
         where job.operation in (
           'listing.create', 'listing.update', 'listing.stop'
         )
           and job.status = 'running'
      ),
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
           and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
           and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)
      ),
      'qoo10EffectiveOpen',
        sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10'),
      'coupangAdapterReady', coalesce((
        select release.adapter_ready
          from sellerpilot_private.listing_publication_adapter_release release
         where release.channel = 'coupang'
      ), false),
      'coupangAttestedRelease',
        sellerpilot_private.attested_listing_publication_release_sha('coupang'),
      'coupangReleaseConsistent',
        sellerpilot_private.attested_listing_publication_release_sha('coupang')
          is not null,
      'coupangRuntimeReleaseMatches',
        coalesce(
          sellerpilot_private.active_serverless_runtime_release_sha()
            = sellerpilot_private.attested_listing_publication_release_sha(
                'coupang'
              ),
          false
        ),
      'coupangReviewViolations',
        sellerpilot_private.listing_publication_review_violation_count('coupang'),
      'coupangQueuedOrRunning', (
        select count(*)::integer
          from sellerpilot_private.channel_gateway_jobs job
         where job.channel = 'coupang'
           and job.operation in (
             'listing.create', 'listing.update', 'listing.stop'
           )
           and job.status in ('queued', 'running')
      ),
      'coupangReconciliationRequired', (
        select count(*)::integer
          from sellerpilot_private.channel_gateway_jobs job
         where job.channel = 'coupang'
           and job.operation in (
             'listing.create', 'listing.update', 'listing.stop'
           )
           and job.status = 'reconciliation_required'
      ),
      'coupangEffectiveOpen',
        sellerpilot_private.listing_mutation_release_gate_is_effective('coupang')
    )
    || jsonb_build_object(
      'reconciliationRequired', (
        select count(*)::integer
          from sellerpilot_private.channel_gateway_jobs job
         where job.operation in (
           'listing.create', 'listing.update', 'listing.stop'
         )
           and job.status = 'reconciliation_required'
           and not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
           and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)
           and not sellerpilot_private.unstarted_listing_create_reconciliation_resolved(job.id)
           and not sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(job.id)
      )
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

comment on function
  public.sellerpilot_service_set_listing_channel_mutation_release_gate(
    text, boolean, text
  ) is
  'Opens or closes an exact-release Qoo10 or Coupang publication scope after channel review, selected-channel queue/reconciliation, and global running-job checks. Does not change the global gate.';

comment on function sellerpilot_private.listing_mutation_release_gate_is_effective(text) is
  'Channel-aware exact-release publication predicate. Delegates null-scoped rows to the unchanged global gate and permits only the matching Qoo10 or Coupang scope.';

commit;
