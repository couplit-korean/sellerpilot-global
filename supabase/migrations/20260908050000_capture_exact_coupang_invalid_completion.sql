-- Preserve the exact Coupang GET-only completion payload when the strict
-- reconciliation validator rejects it. The provider call has already ended;
-- this path records the readback as reconciliation_required and never opens a
-- provider mutation or projects the listing as published.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
select pg_catalog.pg_advisory_xact_lock(1637578093, 8072040);

create table sellerpilot_private.coupang_exact_live_invalid_completion_captures (
  verifier_job_id uuid primary key
    references sellerpilot_private.coupang_exact_live_verify_runs(verifier_job_id)
    on delete restrict
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
  worker_token_id uuid not null check (
    worker_token_id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
  ),
  claim_token uuid not null,
  response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  original_completion_fingerprint text not null check (
    original_completion_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  claimed_job_snapshot jsonb not null check (
    jsonb_typeof(claimed_job_snapshot) = 'object'
  ),
  claimed_job_sha256 text not null check (
    claimed_job_sha256 ~ '^[a-f0-9]{64}$'
  ),
  listing_snapshot jsonb not null check (
    jsonb_typeof(listing_snapshot) = 'object'
  ),
  listing_sha256 text not null check (listing_sha256 ~ '^[a-f0-9]{64}$'),
  publication_review_snapshot jsonb,
  publication_review_sha256 text,
  check (
    (publication_review_snapshot is null and publication_review_sha256 is null)
    or (
      jsonb_typeof(publication_review_snapshot) = 'object'
      and publication_review_sha256 ~ '^[a-f0-9]{64}$'
    )
  ),
  completed_job_snapshot jsonb not null check (
    jsonb_typeof(completed_job_snapshot) = 'object'
  ),
  completed_job_sha256 text not null check (
    completed_job_sha256 ~ '^[a-f0-9]{64}$'
  ),
  validation_sqlstate text not null check (validation_sqlstate = '55000'),
  validation_message text not null check (
    validation_message = 'exact Coupang GET verification incomplete'
  ),
  adjudication text not null check (adjudication = 'unresolved'),
  contract text not null check (
    contract = 'coupang_exact_live_invalid_completion_capture_v1'
  ),
  provider_mutation_performed boolean not null check (
    provider_mutation_performed is false
  ),
  buyer_visible_verified boolean not null check (
    buyer_visible_verified is false
  ),
  captured_at timestamptz not null default clock_timestamp()
);

create table
sellerpilot_private.coupang_exact_live_expired_in_memory_claim_recoveries (
  verifier_job_id uuid primary key
    references sellerpilot_private.coupang_exact_live_verify_runs(verifier_job_id)
    on delete restrict
    check (
      verifier_job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ),
  failed_job_snapshot jsonb not null check (
    jsonb_typeof(failed_job_snapshot) = 'object'
  ),
  failed_job_sha256 text not null check (
    failed_job_sha256 =
      '13e88ef324c815cf44572873c24ebfa6add6e4306d24d2feacb89509b83fb6e7'
  ),
  worker_token_id uuid not null check (
    worker_token_id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
  ),
  claim_token uuid not null check (
    claim_token = '6eb48202-e6e3-4b3a-a280-af5805fc404a'::uuid
  ),
  rearmed_expires_at timestamptz not null,
  contract text not null check (
    contract = 'coupang_exact_live_expired_in_memory_claim_recovery_v1'
  ),
  provider_mutation_performed boolean not null check (
    provider_mutation_performed is false
  ),
  recovered_at timestamptz not null default clock_timestamp()
);

alter table sellerpilot_private.coupang_exact_live_invalid_completion_captures
  enable row level security;
alter table
sellerpilot_private.coupang_exact_live_expired_in_memory_claim_recoveries
  enable row level security;
revoke all on
sellerpilot_private.coupang_exact_live_invalid_completion_captures
  from public, anon, authenticated, service_role;
revoke all on
sellerpilot_private.coupang_exact_live_expired_in_memory_claim_recoveries
  from public, anon, authenticated, service_role;

create function
sellerpilot_private.block_coupang_exact_live_invalid_completion_capture_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'COUPANG_EXACT_LIVE_INVALID_COMPLETION_CAPTURE_IMMUTABLE'
    using errcode = '55000';
end
$$;

revoke all on function
sellerpilot_private.block_coupang_exact_live_invalid_completion_capture_change()
from public, anon, authenticated, service_role;

create trigger block_coupang_exact_live_invalid_completion_capture_change
before update or delete
on sellerpilot_private.coupang_exact_live_invalid_completion_captures
for each row execute function
sellerpilot_private.block_coupang_exact_live_invalid_completion_capture_change();

create trigger block_coupang_exact_live_expired_in_memory_claim_recovery_change
before update or delete
on sellerpilot_private.coupang_exact_live_expired_in_memory_claim_recoveries
for each row execute function
sellerpilot_private.block_coupang_exact_live_invalid_completion_capture_change();

alter function public.sellerpilot_service_complete_gateway_transaction(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
) rename to sellerpilot_complete_before_coupang_exact_invalid_capture;

revoke all on function
public.sellerpilot_complete_before_coupang_exact_invalid_capture(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
)
from public, anon, authenticated, service_role;

create function public.sellerpilot_service_complete_gateway_transaction(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null,
  p_credential_refresh jsonb default null,
  p_normalized_orders jsonb default null,
  p_normalized_inquiries jsonb default null,
  p_diagnostic jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  claimed_job sellerpilot_private.channel_gateway_jobs%rowtype;
  completed_job sellerpilot_private.channel_gateway_jobs%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  listing_after sellerpilot_private.product_listings%rowtype;
  prior_capture
    sellerpilot_private.coupang_exact_live_invalid_completion_captures%rowtype;
  failed_sqlstate text;
  failed_message text;
  completed_snapshot jsonb;
  claimed_snapshot jsonb;
  listing_snapshot jsonb;
  review_snapshot jsonb;
  review_snapshot_after jsonb;
  response_sha text;
  completion_fingerprint text;
begin
  if p_job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid then
    select * into prior_capture
      from sellerpilot_private.coupang_exact_live_invalid_completion_captures
     where verifier_job_id = p_job_id;
    if prior_capture.verifier_job_id is not null then
      if p_status is distinct from 'succeeded'
         or p_claim_token is distinct from prior_capture.claim_token
         or jsonb_typeof(p_response_payload) is distinct from 'object'
         or encode(
           extensions.digest(p_response_payload::text, 'sha256'),
           'hex'
         ) is distinct from prior_capture.response_sha256
         or sellerpilot_private.gateway_completion_fingerprint(
           p_status,
           p_response_payload,
           p_error_message,
           p_credential_refresh,
           p_normalized_orders,
           p_normalized_inquiries,
           p_diagnostic
         ) is distinct from prior_capture.original_completion_fingerprint
         or encode(
           extensions.digest(prior_capture.response_payload::text, 'sha256'),
           'hex'
         ) is distinct from prior_capture.response_sha256
         or encode(
           extensions.digest(prior_capture.claimed_job_snapshot::text, 'sha256'),
           'hex'
         ) is distinct from prior_capture.claimed_job_sha256
         or encode(
           extensions.digest(prior_capture.completed_job_snapshot::text, 'sha256'),
           'hex'
         ) is distinct from prior_capture.completed_job_sha256
         or prior_capture.adjudication is distinct from 'unresolved'
         or not exists (
           select 1
             from sellerpilot_private.ai_cli_worker_tokens worker
            where worker.id = prior_capture.worker_token_id
              and worker.token_hash = p_token_hash
              and worker.scope in ('gateway', 'legacy_combined')
              and worker.status = 'active'
              and worker.expires_at > clock_timestamp()
         )
         or not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs job
            where job.id = prior_capture.verifier_job_id
              and job.status = 'reconciliation_required'
              and job.response_payload = prior_capture.response_payload
              and encode(
                extensions.digest(to_jsonb(job)::text, 'sha256'),
                'hex'
              ) = prior_capture.completed_job_sha256
         )
      then
        raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_REPLAY_MISMATCH'
          using errcode = '40001';
      end if;
      return jsonb_build_object(
        'status', 'completed',
        'replayed', true,
        'coupangExactCapture', prior_capture.contract
      );
    end if;
  end if;

  begin
    result := public.sellerpilot_complete_before_coupang_exact_invalid_capture(
      p_token_hash,
      p_job_id,
      p_claim_token,
      p_status,
      p_response_payload,
      p_error_message,
      p_credential_refresh,
      p_normalized_orders,
      p_normalized_inquiries,
      p_diagnostic
    );
    return result;
  exception when sqlstate '55000' then
    get stacked diagnostics
      failed_sqlstate = returned_sqlstate,
      failed_message = message_text;
  end;

  select * into run
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = p_job_id;

  select * into claimed_job
    from sellerpilot_private.channel_gateway_jobs
   where id = p_job_id
   for update;

  select * into listing
    from sellerpilot_private.product_listings
   where id = run.listing_id
   for update;

  select to_jsonb(review) into review_snapshot
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = run.listing_id;

  if failed_message is distinct from 'exact Coupang GET verification incomplete'
     or run.verifier_job_id is null
     or p_job_id is distinct from
       '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
     or run.source_job_id is distinct from
       '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
     or run.source_attempt_id is distinct from
       'd771421b-f408-4f75-addd-03879393fab8'::uuid
     or run.listing_id is distinct from
       'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
     or p_status is distinct from 'succeeded'
     or jsonb_typeof(p_response_payload) is distinct from 'object'
     or p_response_payload->>'channel' is distinct from 'coupang'
     or p_response_payload->>'operation' is distinct from
       'listing.publication.verify'
     or p_response_payload->>'remoteId' is distinct from '16375780938'
     or octet_length(p_response_payload::text) > 1000000
     or p_response_payload::text ~*
       '"[^"[:cntrl:]]*(authorization|cookie|credential|password|secret|signature|token)[^"[:cntrl:]]*"[[:space:]]*:'
     or p_error_message is not null
     or p_credential_refresh is not null
     or p_normalized_orders is not null
     or p_normalized_inquiries is not null
     or p_diagnostic is not null
     or claimed_job.id is null
     or claimed_job.status is distinct from 'running'
     or sellerpilot_private.coupang_exact_live_verifier_job_matches(claimed_job)
       is not true
     or sellerpilot_private.coupang_exact_live_source_current() is not true
     or claimed_job.request_payload#>>'{arguments,sellerpilotReadOnly}'
       is distinct from 'true'
     or claimed_job.worker_token_id is distinct from
       '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
     or claimed_job.claim_token is distinct from p_claim_token
     or claimed_job.lease_expires_at <= clock_timestamp()
     or claimed_job.attempt_count is distinct from 4
     or claimed_job.response_payload is not null
     or claimed_job.completed_at is not null
     or claimed_job.attempt_id is not null
     or claimed_job.provider_mutation_started_at is not null
     or claimed_job.oauth_provider_call_started_at is not null
     or claimed_job.write_resource_kind is not null
     or claimed_job.write_resource_key is not null
     or claimed_job.credential_refresh_in_flight is distinct from false
     or claimed_job.credential_refresh_fingerprint is not null
     or claimed_job.prepared_credential_id is not null
     or claimed_job.credential_refresh_prepared_at is not null
     or claimed_job.credential_refresh_recovery_vault_id is not null
     or claimed_job.credential_refresh_recovery_fingerprint is not null
     or claimed_job.credential_refresh_recovery_staged_at is not null
     or claimed_job.credential_refresh_started_at is not null
     or claimed_job.oauth_request_vault_id is not null
     or claimed_job.oauth_request_fingerprint is not null
     or claimed_job.oauth_source_credential_id is not null
     or claimed_job.oauth_exchange_completed is distinct from false
     or listing.id is null
     or encode(
       extensions.digest(to_jsonb(listing)::text, 'sha256'),
       'hex'
     ) is distinct from run.source_listing_sha256
     or exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = p_job_id
     )
  then
    raise exception using
      errcode = failed_sqlstate,
      message = failed_message;
  end if;

  claimed_snapshot := to_jsonb(claimed_job);
  listing_snapshot := to_jsonb(listing);
  response_sha := encode(
    extensions.digest(p_response_payload::text, 'sha256'),
    'hex'
  );
  completion_fingerprint :=
    sellerpilot_private.gateway_completion_fingerprint(
      p_status,
      p_response_payload,
      p_error_message,
      p_credential_refresh,
      p_normalized_orders,
      p_normalized_inquiries,
      p_diagnostic
    );

  -- Use the canonical completion layer below publication-review projection.
  -- It authenticates the exact worker/claim/lease, records no generic service
  -- completion receipt, and stores the original rejected readback only as a
  -- reconciliation_required result.
  if public.sellerpilot_301100_complete_gateway_pre_publication_review(
    p_token_hash,
    p_job_id,
    p_claim_token,
    'reconciliation_required',
    p_response_payload,
    'COUPANG_EXACT_LIVE_GET_RESULT_CAPTURED_FOR_RECONCILIATION'
  ) is not true then
    raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_COMPLETION_REJECTED'
      using errcode = '55000';
  end if;

  select * into strict completed_job
    from sellerpilot_private.channel_gateway_jobs
   where id = p_job_id
   for update;

  select * into strict listing_after
    from sellerpilot_private.product_listings
   where id = run.listing_id
   for update;

  select to_jsonb(review) into review_snapshot_after
    from sellerpilot_private.listing_publication_reviews review
   where review.listing_id = run.listing_id;

  if completed_job.status is distinct from 'reconciliation_required'
     or completed_job.response_payload is distinct from p_response_payload
     or completed_job.error_message is distinct from
       'COUPANG_EXACT_LIVE_GET_RESULT_CAPTURED_FOR_RECONCILIATION'
     or completed_job.completed_at is null
     or completed_job.worker_token_id is not null
     or completed_job.claim_token is not null
     or completed_job.lease_expires_at is not null
     or completed_job.attempt_id is not null
     or completed_job.provider_mutation_started_at is not null
     or completed_job.oauth_provider_call_started_at is not null
     or completed_job.write_resource_kind is not null
     or completed_job.write_resource_key is not null
     or (
       to_jsonb(completed_job) - array[
         'status',
         'response_payload',
         'error_message',
         'worker_token_id',
         'claim_token',
         'lease_expires_at',
         'completed_at',
         'updated_at'
       ]::text[]
     ) is distinct from (
       claimed_snapshot - array[
         'status',
         'response_payload',
         'error_message',
         'worker_token_id',
         'claim_token',
         'lease_expires_at',
         'completed_at',
         'updated_at'
       ]::text[]
     )
     or to_jsonb(listing_after) is distinct from listing_snapshot
     or review_snapshot_after is distinct from review_snapshot
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_live_verify_receipts receipt
        where receipt.verifier_job_id = p_job_id
     )
     or exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = p_job_id
     )
  then
    raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_POSTIMAGE_REJECTED'
      using errcode = '55000';
  end if;

  completed_snapshot := to_jsonb(completed_job);

  insert into
  sellerpilot_private.coupang_exact_live_invalid_completion_captures (
    verifier_job_id,
    source_job_id,
    source_attempt_id,
    listing_id,
    worker_token_id,
    claim_token,
    response_payload,
    response_sha256,
    original_completion_fingerprint,
    claimed_job_snapshot,
    claimed_job_sha256,
    listing_snapshot,
    listing_sha256,
    publication_review_snapshot,
    publication_review_sha256,
    completed_job_snapshot,
    completed_job_sha256,
    validation_sqlstate,
    validation_message,
    adjudication,
    contract,
    provider_mutation_performed,
    buyer_visible_verified,
    captured_at
  ) values (
    p_job_id,
    run.source_job_id,
    run.source_attempt_id,
    run.listing_id,
    claimed_job.worker_token_id,
    p_claim_token,
    p_response_payload,
    response_sha,
    completion_fingerprint,
    claimed_snapshot,
    encode(extensions.digest(claimed_snapshot::text, 'sha256'), 'hex'),
    listing_snapshot,
    encode(extensions.digest(listing_snapshot::text, 'sha256'), 'hex'),
    review_snapshot,
    case when review_snapshot is null then null else
      encode(extensions.digest(review_snapshot::text, 'sha256'), 'hex')
    end,
    completed_snapshot,
    encode(extensions.digest(completed_snapshot::text, 'sha256'), 'hex'),
    failed_sqlstate,
    failed_message,
    'unresolved',
    'coupang_exact_live_invalid_completion_capture_v1',
    false,
    false,
    clock_timestamp()
  );

  return jsonb_build_object(
    'status', 'completed',
    'coupangExactCapture',
    'coupang_exact_live_invalid_completion_capture_v1'
  );
end
$$;

revoke all on function public.sellerpilot_service_complete_gateway_transaction(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
)
from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_complete_gateway_transaction(
  text, uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb, jsonb
)
to service_role;

alter function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
) rename to sellerpilot_gateway_completion_context_before_coupang_exact_invalid_capture;

revoke all on function
public.sellerpilot_gateway_completion_context_before_coupang_exact_invalid_capture(
  text, uuid, uuid
)
from public, anon, authenticated, service_role;

create function public.sellerpilot_service_gateway_completion_context(
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
  result jsonb;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  capture
    sellerpilot_private.coupang_exact_live_invalid_completion_captures%rowtype;
begin
  result :=
    public.sellerpilot_gateway_completion_context_before_coupang_exact_invalid_capture(
      p_token_hash,
      p_job_id,
      p_claim_token
    );
  if result is not null then return result; end if;

  select * into capture
    from sellerpilot_private.coupang_exact_live_invalid_completion_captures
   where verifier_job_id = p_job_id
     and claim_token = p_claim_token;
  if capture.verifier_job_id is null then return null; end if;

  select job_row.* into job
    from sellerpilot_private.channel_gateway_jobs job_row
    join sellerpilot_private.ai_cli_worker_tokens worker
      on worker.id = capture.worker_token_id
     and worker.token_hash = p_token_hash
     and worker.scope in ('gateway', 'legacy_combined')
     and worker.status = 'active'
     and worker.expires_at > clock_timestamp()
   where job_row.id = capture.verifier_job_id
     and job_row.status = 'reconciliation_required'
     and job_row.response_payload = capture.response_payload
     and encode(
       extensions.digest(job_row.response_payload::text, 'sha256'),
       'hex'
     ) = capture.response_sha256
     and encode(
       extensions.digest(to_jsonb(job_row)::text, 'sha256'),
       'hex'
     ) = capture.completed_job_sha256
     and job_row.worker_token_id is null
     and job_row.claim_token is null
     and job_row.lease_expires_at is null
     and job_row.provider_mutation_started_at is null
     and job_row.oauth_provider_call_started_at is null
     and job_row.write_resource_kind is null
     and job_row.write_resource_key is null
     and not exists (
       select 1
         from sellerpilot_private.gateway_completion_receipts receipt
        where receipt.job_id = job_row.id
     )
     and not exists (
       select 1
         from sellerpilot_private.coupang_exact_live_verify_receipts receipt
        where receipt.verifier_job_id = job_row.id
     );
  if job.id is null then return null; end if;

  return jsonb_build_object(
    'id', job.id,
    'credential_id', job.credential_id,
    'attempt_id', job.attempt_id,
    'listing_id', job.listing_id,
    'channel', job.channel,
    'operation', job.operation,
    'status', 'completed_replay',
    'normalization_timestamp', coalesce(job.started_at, job.created_at),
    'publication_verification_boundary',
      job.started_at,
    'updated_at', job.updated_at
  );
end
$$;

revoke all on function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_gateway_completion_context(
  text, uuid, uuid
)
to service_role;

do $verify$
declare
  definition text;
  function_owner text;
  security_definer boolean;
  function_config text[];
  execute_acl text[];
begin
  select
    pg_catalog.pg_get_functiondef(function_row.oid),
    pg_catalog.pg_get_userbyid(function_row.proowner),
    function_row.prosecdef,
    function_row.proconfig,
    array(
      select pg_catalog.format(
        '%s:%s:%s',
        pg_catalog.pg_get_userbyid(permission.grantee),
        permission.privilege_type,
        permission.is_grantable
      )
      from pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) permission
      order by 1
    )
  into strict
    definition,
    function_owner,
    security_definer,
    function_config,
    execute_acl
  from pg_catalog.pg_proc function_row
  where function_row.oid =
    'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure;

  if pg_catalog.strpos(
       definition,
       'coupang_exact_live_invalid_completion_capture_v1'
     ) = 0
     or pg_catalog.strpos(
       definition,
       'public.sellerpilot_301100_complete_gateway_pre_publication_review('
     ) = 0
     or function_owner <> 'postgres'
     or not security_definer
     or function_config is distinct from array['search_path=""']::text[]
     or execute_acl is distinct from
       array['postgres:EXECUTE:f', 'service_role:EXECUTE:f']::text[]
  then
    raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_WRAPPER_DRIFT'
      using errcode = '55000';
  end if;
end
$verify$;

do $verify_context$
declare
  definition text;
  function_owner text;
  security_definer boolean;
  function_config text[];
  volatility "char";
  execute_acl text[];
begin
  select
    pg_catalog.pg_get_functiondef(function_row.oid),
    pg_catalog.pg_get_userbyid(function_row.proowner),
    function_row.prosecdef,
    function_row.proconfig,
    function_row.provolatile,
    array(
      select pg_catalog.format(
        '%s:%s:%s',
        pg_catalog.pg_get_userbyid(permission.grantee),
        permission.privilege_type,
        permission.is_grantable
      )
      from pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) permission
      order by 1
    )
  into strict
    definition,
    function_owner,
    security_definer,
    function_config,
    volatility,
    execute_acl
  from pg_catalog.pg_proc function_row
  where function_row.oid =
    'public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)'::regprocedure;

  if pg_catalog.strpos(
       definition,
       'coupang_exact_live_invalid_completion_captures'
     ) = 0
     or pg_catalog.strpos(definition, '''completed_replay''') = 0
     or function_owner <> 'postgres'
     or not security_definer
     or function_config is distinct from array['search_path=""']::text[]
     or volatility <> 'v'
     or execute_acl is distinct from
       array['postgres:EXECUTE:f', 'service_role:EXECUTE:f']::text[]
  then
    raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_CONTEXT_DRIFT'
      using errcode = '55000';
  end if;
end
$verify_context$;

-- Keep the already-computed in-memory result completable while this exact
-- one-time wrapper is installed. The worker process is paused locally during
-- deployment, so no concurrent heartbeat can race this extension.
do $hold_exact_claim$
declare
  updated_count integer;
  anchor_count integer;
  failed_job sellerpilot_private.channel_gateway_jobs%rowtype;
  failed_snapshot jsonb;
  failed_sha text;
  refreshed_expiry timestamptz;
begin
  select count(*) into anchor_count
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;
  if anchor_count = 0 then
    if exists (
      select 1
        from sellerpilot_private.coupang_exact_live_verify_runs run
       where run.verifier_job_id =
         '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ) or exists (
      select 1
        from sellerpilot_private.coupang_exact_live_invalid_completion_captures capture
       where capture.verifier_job_id =
         '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    ) then
      raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_PARTIAL_ANCHOR'
        using errcode = '55000';
    end if;
    return;
  end if;

  select * into strict failed_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
   for update;
  failed_snapshot := to_jsonb(failed_job);
  failed_sha := encode(
    extensions.digest(failed_snapshot::text, 'sha256'),
    'hex'
  );
  refreshed_expiry := clock_timestamp() + interval '15 minutes';

  if failed_job.status = 'failed' then
    if failed_sha is distinct from
         '13e88ef324c815cf44572873c24ebfa6add6e4306d24d2feacb89509b83fb6e7'
       or failed_job.attempt_count is distinct from 4
       or failed_job.started_at is distinct from
         '2026-09-07 20:06:14.564185+00'::timestamptz
       or failed_job.completed_at is distinct from
         '2026-09-07 20:22:01.073012+00'::timestamptz
       or failed_job.updated_at is distinct from
         '2026-09-07 20:22:01.073012+00'::timestamptz
       or failed_job.error_message is distinct from
         'Channel worker lease expired four times.'
       or failed_job.worker_token_id is not null
       or failed_job.claim_token is not null
       or failed_job.lease_expires_at is not null
       or failed_job.response_payload is not null
       or failed_job.attempt_id is not null
       or failed_job.provider_mutation_started_at is not null
       or failed_job.oauth_provider_call_started_at is not null
       or failed_job.write_resource_kind is not null
       or failed_job.write_resource_key is not null
       or failed_job.credential_refresh_in_flight is distinct from false
       or failed_job.credential_refresh_fingerprint is not null
       or failed_job.prepared_credential_id is not null
       or failed_job.credential_refresh_prepared_at is not null
       or failed_job.credential_refresh_recovery_vault_id is not null
       or failed_job.credential_refresh_recovery_fingerprint is not null
       or failed_job.credential_refresh_recovery_staged_at is not null
       or failed_job.credential_refresh_started_at is not null
       or failed_job.oauth_request_vault_id is not null
       or failed_job.oauth_request_fingerprint is not null
       or failed_job.oauth_source_credential_id is not null
       or failed_job.oauth_exchange_completed is distinct from false
       or sellerpilot_private.coupang_exact_live_verifier_job_matches(failed_job)
         is not true
       or sellerpilot_private.coupang_exact_live_source_current() is not true
       or exists (
         select 1
           from sellerpilot_private.gateway_completion_receipts receipt
          where receipt.job_id = failed_job.id
       )
       or exists (
         select 1
           from sellerpilot_private.coupang_exact_live_verify_receipts receipt
          where receipt.verifier_job_id = failed_job.id
       )
       or exists (
         select 1
           from sellerpilot_private.coupang_exact_live_invalid_completion_captures capture
          where capture.verifier_job_id = failed_job.id
       )
       or exists (
         select 1
           from sellerpilot_private.coupang_exact_live_expired_in_memory_claim_recoveries recovery
          where recovery.verifier_job_id = failed_job.id
       )
       or not exists (
         select 1
           from sellerpilot_private.ai_cli_worker_tokens worker
          where worker.id =
            '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
            and worker.scope in ('gateway', 'legacy_combined')
            and worker.status = 'active'
            and worker.expires_at > refreshed_expiry
       )
    then
      raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_EXPIRED_JOB_DRIFT'
        using errcode = '55000';
    end if;

    insert into
    sellerpilot_private.coupang_exact_live_expired_in_memory_claim_recoveries (
      verifier_job_id,
      failed_job_snapshot,
      failed_job_sha256,
      worker_token_id,
      claim_token,
      rearmed_expires_at,
      contract,
      provider_mutation_performed,
      recovered_at
    ) values (
      failed_job.id,
      failed_snapshot,
      failed_sha,
      '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
      '6eb48202-e6e3-4b3a-a280-af5805fc404a'::uuid,
      refreshed_expiry,
      'coupang_exact_live_expired_in_memory_claim_recovery_v1',
      false,
      clock_timestamp()
    );

    update sellerpilot_private.channel_gateway_jobs job
       set status = 'running',
           worker_token_id =
             '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
           claim_token =
             '6eb48202-e6e3-4b3a-a280-af5805fc404a'::uuid,
           lease_expires_at = refreshed_expiry,
           error_message = null,
           completed_at = null,
           updated_at = clock_timestamp()
     where job.id = failed_job.id
       and encode(
         extensions.digest(to_jsonb(job)::text, 'sha256'),
         'hex'
       ) = failed_sha;
    get diagnostics updated_count = row_count;
  else
    update sellerpilot_private.channel_gateway_jobs job
       set lease_expires_at = refreshed_expiry,
           updated_at = clock_timestamp()
     where job.id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
       and job.status = 'running'
       and job.worker_token_id =
         '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
       and job.claim_token =
         '6eb48202-e6e3-4b3a-a280-af5805fc404a'::uuid
       and job.attempt_count = 4
       and job.response_payload is null
       and job.completed_at is null
       and job.provider_mutation_started_at is null
       and job.oauth_provider_call_started_at is null
       and job.write_resource_kind is null
       and job.write_resource_key is null;
    get diagnostics updated_count = row_count;
  end if;
  if updated_count <> 1 then
    raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_CLAIM_DRIFT'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
     where job.id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
       and job.status = 'running'
       and job.worker_token_id =
         '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
       and job.claim_token =
         '6eb48202-e6e3-4b3a-a280-af5805fc404a'::uuid
       and job.lease_expires_at = refreshed_expiry
       and job.attempt_count = 4
       and job.response_payload is null
       and job.error_message is null
       and job.completed_at is null
       and job.provider_mutation_started_at is null
       and job.oauth_provider_call_started_at is null
       and job.write_resource_kind is null
       and job.write_resource_key is null
  ) then
    raise exception 'COUPANG_EXACT_LIVE_INVALID_CAPTURE_REARM_POSTIMAGE'
      using errcode = '55000';
  end if;
end
$hold_exact_claim$;

commit;
