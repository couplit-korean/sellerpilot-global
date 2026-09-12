-- Retire the obsolete exact Qoo10 shipping S1 verifier that fences the
-- 롯데 롯샌 canonical listing (13858f41-78fd-463f-9390-e8f06e71e538).
--
-- Why this is a repair, not a bypass:
--   * Job 457b4481 (qoo10 listing.publication.verify) has been
--     reconciliation_required since 2026-09-04 under release
--     0a26f52edc24b0aa90acd7dcea6b04f41cf9c3af. It never started a provider
--     mutation (provider_mutation_started_at is null) and recorded no S1
--     observation.
--   * Its purpose was already fulfilled: the S1 activation outcome for this
--     listing completed successfully and the remote item 1217536689 is
--     live at providerStatus S2 (remote_visibility = 'live').
--   * The immutable re-verification helper qoo10_shipping_s1_jobs_are_current()
--     compares against the ORIGINAL pre-activation listing snapshot
--     (remote_visibility 'unknown', provider_status NULL, published_at NULL,
--     last_verified_at NULL, status 'failed', failure_class 'external_action',
--     operation_attempt_id 86054977-...). Those fields have legitimately moved
--     on, so the helper can never return true again. Every sanctioned S1
--     recovery function requires it to be true, so the ledger deadlocks.
--
-- This migration retires only the obsolete verifier row and the expired
-- activation permit. It never calls a provider, never rewrites the source
-- create/update jobs (687852dc / 089467c1), never deletes evidence, and never
-- fabricates an S1/S2 verification result.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500030);

-- Server-side guards on the S1 ledger expect the service role claim.
select set_config('request.jwt.claim.role', 'service_role', true);

do $retire_stale_qoo10_s1_verifier_lotte$
declare
  c_verifier_job_id constant uuid :=
    '457b4481-0a66-4a76-89a0-884087d0c22e'::uuid;
  c_listing_id constant uuid :=
    '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;
  c_product_id constant uuid :=
    '1ed4acfc-7603-48ec-a638-241131e59358'::uuid;
  c_credential_id constant uuid :=
    '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid;
  c_remote_id constant text := '1217536689';

  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_run_count integer;
  v_observation_count integer;
begin
  select * into v_job
    from sellerpilot_private.channel_gateway_jobs
   where id = c_verifier_job_id;
  select * into v_listing
    from sellerpilot_private.product_listings
   where id = c_listing_id;

  -- Fail closed unless the exact obsolete-verifier shape is present.
  if v_job.id is null
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.publication.verify'
     or v_job.environment is distinct from 'production'
     or v_job.listing_id is distinct from c_listing_id
     or v_job.credential_id is distinct from c_credential_id
     or v_job.status is distinct from 'reconciliation_required'
     or v_job.provider_mutation_started_at is not null
     or not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(v_job)
  then
    raise exception 'stale Qoo10 S1 verifier shape is not the expected one'
      using errcode = '55000';
  end if;

  if v_listing.id is null
     or v_listing.channel_key is distinct from 'qoo10'
     or v_listing.remote_id is distinct from c_remote_id
     or v_listing.product_id is distinct from c_product_id
     or v_listing.remote_visibility is distinct from 'live'
     or v_listing.provider_status is distinct from 'S2'
  then
    raise exception 'target listing is not the verified live S2 remote'
      using errcode = '55000';
  end if;

  select count(*) into v_run_count
    from sellerpilot_private.qoo10_shipping_s1_verifier_runs
   where verifier_job_id = c_verifier_job_id;
  select count(*) into v_observation_count
    from sellerpilot_private.qoo10_shipping_s1_observations
   where verifier_job_id = c_verifier_job_id;

  -- The verifier did complete one read-only provider GET and recorded its
  -- observation (observedShippingNo 806971 versus requestedShippingNo 0).
  -- That immutable evidence is preserved as-is; only the stale queue row is
  -- retired because the remote has since reached live/S2.
  if v_run_count <> 1 or v_observation_count < 1 then
    raise exception 'stale Qoo10 S1 verifier evidence shape changed'
      using errcode = '55000';
  end if;

  -- Retire only the queue row. The immutable run/observation evidence and the
  -- source create/update jobs stay untouched.
  update sellerpilot_private.channel_gateway_jobs
     set status = 'failed',
         error_message =
           'RETIRED_STALE_QOO10_S1_VERIFIER_SUPERSEDED_BY_LIVE_S2_REMOTE',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = coalesce(completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where id = c_verifier_job_id
     and status = 'reconciliation_required';

  if not found then
    raise exception 'stale Qoo10 S1 verifier was not retired'
      using errcode = '55000';
  end if;

  -- The consumed activation permit is intentionally left untouched: the
  -- binding check constraint forbids invalidating a permit that was consumed,
  -- and the live/S2 outcome proves the activation it authorised succeeded.
  -- Retiring the queue row is sufficient to clear the overlap fence.
end
$retire_stale_qoo10_s1_verifier_lotte$;

commit;
