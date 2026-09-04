-- Follow-up to 20260905003000/14100/14200/14300. Do not rewrite applied history.
-- Activation e09ab646-19ef-4865-a79e-08baef769086 already consumed its one
-- provider-mutation permit and executed EditGoodsStatus exactly once. Its
-- worker completion rolled back because the older generic exact-Qoo10 wrapper
-- tried to record a fac9 activation outcome before the shipping-specific
-- outer wrapper could record its outcome. This migration only fixes that
-- completion guard and installs a pinned GET-only completion receipt/RPC.
-- It never enqueues or executes another provider mutation and never rewrites
-- the expired no-call activation 12eaf867-9ee5-45b1-aed0-b5456bc124a3.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500144);

-- Shipping-S1 has its own outer outcome recorder (20260905014100). Skip only
-- the generic fac9 recorder for a job that has a shipping-S1 permit. Exact
-- Qoo10 jobs without that permit retain the original fail-closed guard.
do $qoo10_shipping_s1_complete_guard_patch$
declare
  v_definition text;
  v_before text := $body$  elsif v_operation = 'listing.activate' then
    if not sellerpilot_private.record_exact_qoo10_s1_activation_outcome(p_job_id) then
      raise exception 'exact Qoo10 activation completion was not recorded'
        using errcode = '55000';
    end if;$body$;
  v_after text := $body$  elsif v_operation = 'listing.activate'
        and exists (
          select 1
            from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
           where permit.activation_job_id = p_job_id
        ) then
    null; -- 20260905014100 records the shipping-S1 outcome after this returns.
  elsif v_operation = 'listing.activate' then
    if not sellerpilot_private.record_exact_qoo10_s1_activation_outcome(p_job_id) then
      raise exception 'exact Qoo10 activation completion was not recorded'
        using errcode = '55000';
    end if;$body$;
  v_occurrences integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_133000_complete_gateway_before_temu_publication(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'generic exact Qoo10 completion wrapper missing'
      using errcode = '55000';
  end if;
  if pg_catalog.strpos(
       v_definition,
       'qoo10_shipping_s1_activation_permits permit'
     ) > 0
  then
    return;
  end if;
  v_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_before, ''))
  ) / nullif(pg_catalog.length(v_before), 0);
  if v_occurrences is distinct from 1 then
    raise exception 'generic exact Qoo10 completion guard preimage drifted'
      using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_before, v_after);
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_133000_complete_gateway_before_temu_publication(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'qoo10_shipping_s1_activation_permits permit') = 0
     or pg_catalog.strpos(
          v_definition,
          'exact Qoo10 activation completion was not recorded'
        ) = 0
  then
    raise exception 'generic exact Qoo10 completion guard patch not installed'
      using errcode = '55000';
  end if;
end;
$qoo10_shipping_s1_complete_guard_patch$;

-- Keep the existing create/update readback precedence and add the worker's
-- activation post-readback step as the final, activation-only source.
create or replace function sellerpilot_private.qoo10_shipping_s1_readback_item(
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
    ),
    sellerpilot_private.qoo10_shipping_s1_named_remote_item(
      p_response, 'qoo10-s1-activation-post-readback', p_remote_id
    )
  )
$$;

-- Reuse every retained-content check from 14200 while requiring the original
-- provider payload itself to be a unique, alias-consistent S2 item. The 14200
-- S1 helper is intentionally unchanged.
create function sellerpilot_private.qoo10_shipping_s1_live_retained_item_matches(
  p_item jsonb,
  p_create_arguments jsonb,
  p_update_arguments jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select sellerpilot_private.qoo10_exact_aliases_consistent(
           p_item, array['ItemStatus','Status']
         )
    and upper(coalesce(p_item->>'ItemStatus', p_item->>'Status', '')) = 'S2'
    and sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches(
          p_item || jsonb_build_object('ItemStatus','S1','Status','S1'),
          p_create_arguments,
          p_update_arguments
        )
$$;

revoke all on function
  sellerpilot_private.qoo10_shipping_s1_live_retained_item_matches(jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role;

create table sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts (
  activation_job_id uuid primary key
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  listing_id uuid not null
    references sellerpilot_private.product_listings(id) on delete restrict,
  remote_id text not null check (remote_id = '1217536689'),
  result_code text not null check (result_code = '0'),
  provider_status text not null check (provider_status = 'S2'),
  observed_shipping_no text not null check (observed_shipping_no = '806971'),
  readback jsonb not null check (
    jsonb_typeof(readback) = 'object'
    and octet_length(readback::text) between 2 and 500000
  ),
  readback_sha256 text not null check (readback_sha256 ~ '^[a-f0-9]{64}$'),
  readback_bytes integer not null check (readback_bytes between 2 and 500000),
  contract text not null check (
    contract = 'qoo10_shipping_s1_post_mutation_get_receipt_v1'
  ),
  created_at timestamptz not null default clock_timestamp(),
  check (activation_job_id = 'e09ab646-19ef-4865-a79e-08baef769086'::uuid),
  check (listing_id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid)
);

alter table sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts
  enable row level security;
revoke all on sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts
  from public, anon, authenticated, service_role;

create trigger block_qoo10_shipping_s1_post_mutation_get_receipt_change
before update or delete on
  sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts
for each row execute function
  sellerpilot_private.block_qoo10_shipping_s1_immutable_ledger_change();

create function public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get(
  p_activation_job_id uuid,
  p_release_sha text,
  p_readback jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
  v_permit sellerpilot_private.qoo10_shipping_s1_activation_permits%rowtype;
  v_listing sellerpilot_private.product_listings%rowtype;
  v_create sellerpilot_private.channel_gateway_jobs%rowtype;
  v_update sellerpilot_private.channel_gateway_jobs%rowtype;
  v_item jsonb;
  v_shipping text;
  v_status text;
  v_token_hash text;
  v_response jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_readback_sha text;
  v_readback_bytes integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 900500144);

  if p_activation_job_id is distinct from
       'e09ab646-19ef-4865-a79e-08baef769086'::uuid
     or p_release_sha is null
     or p_release_sha !~ '^[a-f0-9]{40}$'
     or p_readback is null
     or jsonb_typeof(p_readback) is distinct from 'object'
     or octet_length(p_readback::text) not between 2 and 500000
     or not sellerpilot_private.qoo10_shipping_s1_release_is_current(p_release_sha)
  then
    raise exception 'exact Qoo10 shipping S1 GET completion identity invalid'
      using errcode = '55000';
  end if;

  -- Exact replay only after the immutable receipt, outcome, and listing
  -- projection all exist. No provider call or historical rewrite is needed.
  if exists (
       select 1
         from sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts receipt
         join sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
           on outcome.activation_job_id = receipt.activation_job_id
         join sellerpilot_private.channel_gateway_jobs job
           on job.id = outcome.activation_job_id
         join sellerpilot_private.product_listings listing
           on listing.id = receipt.listing_id
        where receipt.activation_job_id = p_activation_job_id
          and receipt.readback_sha256 = encode(
                extensions.digest(p_readback::text,'sha256'),'hex'
              )
          and outcome.terminal_status = 'succeeded'
          and outcome.provider_status = 'S2'
          and outcome.remote_visibility = 'live'
          and job.status = 'succeeded'
          and listing.status = 'published'
          and listing.remote_visibility = 'live'
          and listing.provider_status = 'S2'
     )
  then
    return jsonb_build_object(
      'mode','qoo10_shipping_s1_post_mutation_get_complete_v1',
      'activationJobId',p_activation_job_id,
      'remoteId','1217536689',
      'providerStatus','S2',
      'visibility','live',
      'completed',true,
      'replayed',true,
      'providerMutationExecuted',false
    );
  end if;

  select * into strict v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_activation_job_id
   for update;
  select * into strict v_permit
    from sellerpilot_private.qoo10_shipping_s1_activation_permits permit
   where permit.activation_job_id = p_activation_job_id;
  select * into strict v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = '13858f41-78fd-463f-9390-e8f06e71e538'::uuid;
  select * into strict v_create
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '687852dc-36de-4049-b170-bdf7839ccf2f'::uuid;
  select * into strict v_update
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '089467c1-cadb-4d31-93a8-d5882c46d753'::uuid;

  if v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.activate'
     or v_job.environment is distinct from 'production'
     or v_job.listing_id is distinct from v_listing.id
     or v_job.credential_id is distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_job.status is distinct from 'running'
     or v_job.attempt_count is distinct from 1
     or v_job.provider_mutation_started_at is null
     or v_job.completed_at is not null
     or v_job.response_payload is not null
     or v_job.claim_token is null
     or v_job.worker_token_id is null
     or v_job.request_payload#>>'{arguments,sellerpilotQoo10S1Activation,expectedState,shippingNo}'
          is distinct from '806971'
     or v_job.request_payload#>>'{arguments,params,ShippingNo}'
          is distinct from '806971'
     or v_permit.listing_id is distinct from v_listing.id
     or v_permit.create_job_id is distinct from v_create.id
     or v_permit.update_job_id is distinct from v_update.id
     or v_permit.verifier_job_id is distinct from
          '457b4481-0a66-4a76-89a0-884087d0c22e'::uuid
     or v_permit.bound_claim_token is distinct from v_job.claim_token
     or v_permit.bound_worker_token_id is distinct from v_job.worker_token_id
     or v_permit.bound_at is null
     or v_permit.consumed_at is null
     or v_permit.invalidated_at is not null
     or v_listing.product_id is distinct from
          '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
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
     or v_listing.requested_publication_intent is distinct from 'live'
     or v_listing.seller_account_key is distinct from v_job.seller_account_key
     or not sellerpilot_private.qoo10_shipping_s1_jobs_are_current()
     or not exists (
          select 1
            from sellerpilot_private.qoo10_shipping_s1_direct_retry_receipts retry
           where retry.retry_activation_job_id = v_job.id
             and retry.failed_activation_job_id =
                   '12eaf867-9ee5-45b1-aed0-b5456bc124a3'::uuid
             and retry.verifier_job_id = v_permit.verifier_job_id
        )
     or exists (
          select 1 from sellerpilot_private.gateway_completion_receipts receipt
           where receipt.job_id = v_job.id
        )
     or exists (
          select 1 from sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
           where outcome.activation_job_id = v_job.id
        )
     or exists (
          select 1
            from sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts receipt
           where receipt.activation_job_id = v_job.id
        )
  then
    raise exception 'exact Qoo10 shipping S1 GET completion preimage drifted'
      using errcode = '55000';
  end if;

  if coalesce(p_readback->>'ResultCode','') is distinct from '0' then
    raise exception 'exact Qoo10 shipping S1 GET did not succeed'
      using errcode = '55000';
  end if;
  v_item := sellerpilot_private.qoo10_shipping_s1_single_remote_item(
    coalesce(p_readback->'ResultObject', p_readback), '1217536689'
  );
  if v_item is null
     or not sellerpilot_private.qoo10_shipping_s1_live_retained_item_matches(
          v_item, v_create.request_payload->'arguments',
          v_update.request_payload->'arguments'
        )
  then
    raise exception 'exact Qoo10 shipping S1 GET live evidence invalid'
      using errcode = '55000';
  end if;
  v_shipping := coalesce(
    v_item->>'ShippingNo', v_item->>'ShippingNO',
    v_item->>'DeliveryGroupNo', ''
  );
  v_status := upper(coalesce(v_item->>'ItemStatus', v_item->>'Status', ''));
  if v_shipping is distinct from '806971' or v_status is distinct from 'S2' then
    raise exception 'exact Qoo10 shipping S1 GET terminal state invalid'
      using errcode = '55000';
  end if;

  select worker_token.token_hash into strict v_token_hash
    from sellerpilot_private.ai_cli_worker_tokens worker_token
   where worker_token.id = v_job.worker_token_id
     and worker_token.scope in ('gateway','legacy_combined','serverless_cs')
     and worker_token.status = 'active'
     and worker_token.expires_at > clock_timestamp();

  v_readback_sha := encode(extensions.digest(p_readback::text,'sha256'),'hex');
  v_readback_bytes := octet_length(p_readback::text);
  insert into sellerpilot_private.qoo10_shipping_s1_post_mutation_get_receipts (
    activation_job_id, listing_id, remote_id, result_code,
    provider_status, observed_shipping_no, readback,
    readback_sha256, readback_bytes, contract
  ) values (
    v_job.id, v_listing.id, '1217536689', '0', 'S2', '806971',
    p_readback, v_readback_sha, v_readback_bytes,
    'qoo10_shipping_s1_post_mutation_get_receipt_v1'
  );

  -- Restore only this still-running claim's completion lease. Provider begin is
  -- already consumed and cannot pass again. No status/claim lineage changes.
  update sellerpilot_private.channel_gateway_jobs job
     set lease_expires_at = greatest(
           coalesce(job.lease_expires_at, '-infinity'::timestamptz),
           clock_timestamp() + interval '5 minutes'
         ),
         updated_at = clock_timestamp()
   where job.id = v_job.id
     and job.status = 'running'
     and job.claim_token = v_job.claim_token
     and job.worker_token_id = v_job.worker_token_id
     and job.provider_mutation_started_at is not null
     and job.completed_at is null;
  if not found then
    raise exception 'exact Qoo10 shipping S1 completion lease was not restored'
      using errcode = '55000';
  end if;

  v_fingerprint := v_update.request_payload#>>'{arguments,publicationExpectedFingerprint}';
  if v_fingerprint is null or v_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'exact Qoo10 shipping S1 publication fingerprint invalid'
      using errcode = '55000';
  end if;
  v_response := jsonb_build_object(
    'ok',true,
    'channel','qoo10',
    'operation','listing.activate',
    'remoteId','1217536689',
    'publicationStateContract','verified_remote_state_v1',
    'publicationIntent','live',
    'publicationFulfilled',true,
    'steps',jsonb_build_array(jsonb_build_object(
      'name','qoo10-s1-activation-post-readback',
      'ok',true,
      'status',200,
      'data',p_readback
    )),
    'remoteState',jsonb_build_object(
      'verified',true,
      'visibility','live',
      'providerStatus','S2',
      'verifiedAt',to_jsonb(clock_timestamp()),
      'locale','ja-JP',
      'fingerprint',v_fingerprint,
      'imageCount',8,
      'resources',jsonb_build_object(
        'itemCode','1217536689',
        'readbackContract','qoo10_shipping_s1_post_mutation_get_receipt_v1'
      ),
      'evidence',jsonb_build_object(
        'identityVerified',true,
        'statusVerified',true,
        'sellerCodeVerified',true,
        'localeVerified',true,
        'fingerprintVerified',true,
        'imageCountVerified',true,
        'sellerAccountIdentityVerified',true,
        'categoryVerified',true,
        'titleVerified',true,
        'priceQuantityVerified',true,
        'representativeImageVerified',true,
        'detailImageDigestVerified',true,
        'shippingVerified',true,
        'keywordRetainedFromCreateVerified',true,
        'promotionNameRetainedFromCreateVerified',true,
        'postMutationGetReceiptVerified',true
      )
    )
  );

  v_result := public.sellerpilot_service_complete_gateway_transaction(
    v_token_hash, v_job.id, v_job.claim_token, 'succeeded', v_response,
    null, null, null, null, null
  );
  if coalesce(v_result->>'status','') not in ('completed','completed_replay') then
    raise exception 'exact Qoo10 shipping S1 GET completion was not accepted'
      using errcode = '55000';
  end if;

  if not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs job
         join sellerpilot_private.qoo10_shipping_s1_activation_outcomes outcome
           on outcome.activation_job_id = job.id
         join sellerpilot_private.product_listings listing
           on listing.id = outcome.listing_id
        where job.id = v_job.id
          and job.status = 'succeeded'
          and job.completed_at is not null
          and outcome.terminal_status = 'succeeded'
          and outcome.provider_status = 'S2'
          and outcome.remote_visibility = 'live'
          and listing.id = v_listing.id
          and listing.status = 'published'
          and listing.remote_visibility = 'live'
          and listing.provider_status = 'S2'
          and listing.published_at is not null
          and listing.last_verified_at is not null
     )
  then
    raise exception 'exact Qoo10 shipping S1 GET completion did not project live'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'mode','qoo10_shipping_s1_post_mutation_get_complete_v1',
    'activationJobId',v_job.id,
    'remoteId','1217536689',
    'providerStatus','S2',
    'visibility','live',
    'completed',true,
    'replayed',false,
    'providerMutationExecuted',false,
    'readbackSha256',v_readback_sha
  );
exception
  when no_data_found or too_many_rows then
    raise exception 'exact Qoo10 shipping S1 GET completion preimage missing'
      using errcode = '55000';
end;
$$;

revoke all on function
  public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get(
    uuid,text,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get(
    uuid,text,jsonb
  ) to service_role;

comment on function
  public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get(
    uuid,text,jsonb
  ) is
  'Completes only e09ab646 from one immutable fresh S2/806971 GET receipt; never executes or enqueues a provider mutation.';

commit;
