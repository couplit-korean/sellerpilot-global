-- Follow-up to 20260905014400. Do not rewrite applied history.
-- The exact activation already consumed its one provider mutation while the
-- serverless schedules were paused. The normal runtime canary must refuse that
-- running mutation, while the GET-only completion cannot make the mutation
-- terminal until the runtime SHA is current. Break only that exact recovery
-- cycle under a closed gate, current Qoo10 attestation, and six paused crons.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500145);

create function sellerpilot_private.qoo10_shipping_s1_completion_release_is_current(
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
    and sellerpilot_private.active_serverless_runtime_release_sha() is null
    and exists (
      select 1
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
         and not gate.is_open
         and gate.opened_at is null
         and gate.opened_release_sha is null
         and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10')
    and (
      select count(*) = 6 and bool_and(not job.active)
        from cron.job job
       where (job.jobid, job.jobname) in (
         (1, 'sellerpilot-serverless-cs-wake-v1'),
         (2, 'sellerpilot-product-research-v1'),
         (3, 'sellerpilot-channel-sync-v1'),
         (4, 'sellerpilot-competitor-prices-v1'),
         (5, 'sellerpilot-kakao-notifications-v1'),
         (6, 'sellerpilot-maintenance-v1')
       )
    )
    and (
      exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
          join sellerpilot_private.qoo10_shipping_s1_activation_permits permit
            on permit.activation_job_id = job.id
          join sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts retry
            on retry.retry_activation_job_id = job.id
         where job.id = 'e09ab646-19ef-4865-a79e-08baef769086'::uuid
           and job.channel = 'qoo10'
           and job.operation = 'listing.activate'
           and job.environment = 'production'
           and job.listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
           and job.status = 'running'
           and job.attempt_count = 1
           and job.provider_mutation_started_at is not null
           and job.completed_at is null
           and job.claim_token is not null
           and job.worker_token_id is not null
           and permit.verifier_job_id = '457b4481-0a66-4a76-89a0-884087d0c22e'::uuid
           and permit.bound_claim_token = job.claim_token
           and permit.bound_worker_token_id = job.worker_token_id
           and permit.bound_at is not null
           and permit.consumed_at is not null
           and permit.invalidated_at is null
           and retry.failed_activation_job_id =
                 '12eaf867-9ee5-45b1-aed0-b5456bc124a3'::uuid
           and not exists (
             select 1
               from sellerpilot_private.gateway_completion_receipts receipt
              where receipt.job_id = job.id
           )
           and not exists (
             select 1
               from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
              where outcome.activation_job_id = job.id
           )
           and not exists (
             select 1
               from sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts receipt
              where receipt.activation_job_id = job.id
           )
      )
      or exists (
        select 1
          from sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts receipt
          join sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
            on outcome.activation_job_id = receipt.activation_job_id
          join sellerpilot_private.channel_gateway_jobs job
            on job.id = outcome.activation_job_id
          join sellerpilot_private.product_listings listing
            on listing.id = receipt.listing_id
         where receipt.activation_job_id =
                 'e09ab646-19ef-4865-a79e-08baef769086'::uuid
           and receipt.listing_id =
                 '13858f41-78fd-463f-9390-e8f06e71e538'::uuid
           and receipt.result_code = '0'
           and receipt.provider_status = 'S2'
           and receipt.observed_shipping_no = '806971'
           and outcome.terminal_status = 'succeeded'
           and outcome.provider_status = 'S2'
           and outcome.remote_visibility = 'live'
           and job.status = 'succeeded'
           and job.completed_at is not null
           and listing.status = 'published'
           and listing.remote_visibility = 'live'
           and listing.provider_status = 'S2'
           and listing.published_at is not null
           and listing.last_verified_at is not null
           and exists (
             select 1
               from sellerpilot_private.gateway_completion_receipts completion
              where completion.job_id = job.id
           )
      )
    ),
    false
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_shipping_s1_completion_release_is_current(text)
  from public, anon, authenticated, service_role;

comment on function
  sellerpilot_private.qoo10_shipping_s1_completion_release_is_current(text) is
  'Exact e09ab646 GET-only completion or immutable committed replay may proceed before runtime reactivation only with current Qoo10 attestation, a closed gate, and the six named crons paused.';

do $patch$
declare
  v_definition text;
  v_needle constant text :=
    'or not sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha)';
  v_replacement constant text :=
    'or not (sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha) or sellerpilot_private.qoo10_shipping_s1_completion_release_is_current(p_release_sha))';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get(uuid,text,jsonb)'::regprocedure
  ) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_needle, '')))
       / length(v_needle) <> 1
  then
    raise exception 'exact Qoo10 GET completion release guard preimage drifted'
      using errcode = '55000';
  end if;

  execute replace(v_definition, v_needle, v_replacement);
end
$patch$;

comment on function
  public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get(
    uuid,text,jsonb
  ) is
  'Completes only e09ab646 from one immutable fresh S2/806971 GET receipt; the exact pre-runtime release exception requires a closed gate, current Qoo10 attestation, and six paused crons; never executes or enqueues a provider mutation.';

commit;
