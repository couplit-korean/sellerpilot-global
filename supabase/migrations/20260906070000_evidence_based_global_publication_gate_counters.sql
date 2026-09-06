-- Evidence-based global publication gate counters.
--
-- The global reconciliation counter still comes from the frozen
-- sellerpilot_301100_listing_gate_status_pre_publication_review body, which
-- counts every retained listing.create/update/stop receipt. Exact recovery
-- deliberately preserves those source receipts forever, so the global gate
-- could never reach zero. This migration keeps every receipt, trigger and job
-- status untouched and only teaches the live status wrapper and the gate
-- opener to skip receipts that an evidence predicate already resolves.
--
-- New predicates carry their own proof and never exempt an unknown remote
-- outcome:
--   * unstarted_listing_create_reconciliation_resolved: the create never
--     started a provider mutation, stored no response and left no remote
--     identity, so no orphan remote listing can exist.
--   * elevenst_bound_listing_create_reconciliation_resolved: the retained
--     receipt was reconciled by the existing GET-only bind, whose observation
--     row and bound listing identity must both match.

begin;

create or replace function sellerpilot_private.unstarted_listing_create_reconciliation_resolved(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $unstarted_listing_create$
  select exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.product_listings listing
        on listing.id = job.listing_id
     where job.id = p_job_id
       and job.operation = 'listing.create'
       and job.status = 'reconciliation_required'
       and job.provider_mutation_started_at is null
       and job.response_payload is null
       and job.write_resource_key is null
       and listing.remote_id is null
       and listing.provider_resource_id is null
  );
$unstarted_listing_create$;

comment on function sellerpilot_private.unstarted_listing_create_reconciliation_resolved(uuid) is
  'Gate exemption predicate. True only when a retained listing.create receipt never started a provider mutation and its listing still carries no remote identity, so the receipt cannot hide an unreconciled remote object. The receipt itself stays reconciliation_required.';

revoke all on function sellerpilot_private.unstarted_listing_create_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $elevenst_bound_listing_create$
  select exists (
    select 1
      from sellerpilot_private.elevenst_cookie_create_get_observations observation
      join sellerpilot_private.channel_gateway_jobs job
        on job.id = observation.source_job_id
      join sellerpilot_private.product_listings listing
        on listing.id = observation.listing_id
     where observation.source_job_id = p_job_id
       and observation.bound_at is not null
       and observation.prodmarket_accepted
       and observation.seller_prd_cd_matched
       and job.channel = 'elevenst'
       and job.operation = 'listing.create'
       and job.status = 'reconciliation_required'
       and listing.remote_id = observation.remote_id
       and listing.marketplace_sku = observation.seller_sku
       and listing.product_id = observation.product_id
  );
$elevenst_bound_listing_create$;

comment on function sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(uuid) is
  'Gate exemption predicate. True only when the retained 11st create receipt was reconciled by the existing GET-only bind and the bound listing still matches the observed remote identity. The receipt and its immutability trigger stay untouched.';

revoke all on function sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(uuid)
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sellerpilot_service_listing_mutation_release_gate_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
           and (not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
        and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id))
      ),
      'qoo10EffectiveOpen',
        sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10')
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
$function$;


CREATE OR REPLACE FUNCTION public.sellerpilot_service_set_listing_mutation_release_gate(p_open boolean, p_release_sha text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where job.operation in ('listing.create', 'listing.update', 'listing.stop')
     and (
       job.status <> 'reconciliation_required'
       or (not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
        and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)
        and not sellerpilot_private.unstarted_listing_create_reconciliation_resolved(job.id)
        and not sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(job.id))
     );
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
$function$;

commit;
