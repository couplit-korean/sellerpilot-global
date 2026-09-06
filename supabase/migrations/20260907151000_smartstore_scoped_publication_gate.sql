-- Extend the existing single-channel exact-release gate to SmartStore.
-- The previous global status retains all evidence-based reconciliation counters.
-- Installing this schema does not open a gate, change a job, or call a provider.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
do $dependencies$
begin
  if pg_catalog.to_regprocedure('sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid)') is null
     or pg_catalog.to_regprocedure('public.sellerpilot_service_listing_mutation_release_gate_status()') is null
     or pg_catalog.to_regprocedure('sellerpilot_private.listing_mutation_release_gate_is_effective()') is null then
    raise exception 'SMARTSTORE_SCOPED_GATE_DEPENDENCY_MISSING' using errcode='55000';
  end if;
end;
$dependencies$;

alter table sellerpilot_private.listing_mutation_release_gate
  drop constraint if exists listing_mutation_release_gate_channel_check;

alter table sellerpilot_private.listing_mutation_release_gate
  add constraint listing_mutation_release_gate_channel_check check (
    opened_channel is null or opened_channel in ('qoo10', 'coupang', 'smartstore')
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
    when p_channel is null or p_channel not in ('qoo10', 'coupang', 'smartstore') then 1
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
    when p_channel in ('qoo10', 'coupang', 'smartstore')
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
       and p_channel in ('qoo10', 'coupang', 'smartstore') then
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
     or p_channel not in ('qoo10', 'coupang', 'smartstore')
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
             and case p_channel
               when 'qoo10' then
                 not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
                 and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)
               when 'smartstore' then
                 not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(job.id)
               else true
             end
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

-- Preserve the 150000 global status rather than replacing its proof logic.
alter function public.sellerpilot_service_listing_mutation_release_gate_status()
  rename to sellerpilot_071510_listing_gate_status_pre_smartstore_scope;
revoke all on function public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_service_listing_mutation_release_gate_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()
    || jsonb_build_object(
      'smartstoreAdapterReady', coalesce((
        select adapter_ready from sellerpilot_private.listing_publication_adapter_release
        where channel='smartstore'
      ), false),
      'smartstoreAttestedRelease', sellerpilot_private.attested_listing_publication_release_sha('smartstore'),
      'smartstoreReleaseConsistent', sellerpilot_private.attested_listing_publication_release_sha('smartstore') is not null,
      'smartstoreRuntimeReleaseMatches', coalesce(
        sellerpilot_private.active_serverless_runtime_release_sha()
          = sellerpilot_private.attested_listing_publication_release_sha('smartstore'),false),
      'smartstoreReviewViolations', sellerpilot_private.listing_publication_review_violation_count('smartstore'),
      'smartstoreQueuedOrRunning', (
        select count(*)::integer from sellerpilot_private.channel_gateway_jobs job
        where job.channel='smartstore'
          and job.operation in ('listing.create','listing.update','listing.stop')
          and job.status in ('queued','running')
      ),
      'smartstoreReconciliationRequired', (
        select count(*)::integer from sellerpilot_private.channel_gateway_jobs job
        where job.channel='smartstore'
          and job.operation in ('listing.create','listing.update','listing.stop')
          and job.status='reconciliation_required'
          and not sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(job.id)
      ),
      'smartstoreEffectiveOpen', sellerpilot_private.listing_mutation_release_gate_is_effective('smartstore')
    );
$$;
revoke all on function public.sellerpilot_service_listing_mutation_release_gate_status()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_listing_mutation_release_gate_status() to service_role;
comment on function public.sellerpilot_service_set_listing_channel_mutation_release_gate(text,boolean,text) is
  'Opens one exact-release Qoo10, Coupang, or SmartStore scope after selected-channel reviews, queue and evidence-based reconciliation checks, and global running-job drain. Never modifies retained provider jobs.';
commit;
