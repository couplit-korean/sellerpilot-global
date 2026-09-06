-- Run the SmartStore existing-remote adoption readback through the registered
-- Mac gateway. The job is read-only and carries a database-created CAS marker.
-- It never changes a provider product, rewrites the uncertain CREATE ledger,
-- or exposes the full official readback in the generic gateway response.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907160000);

do $dependencies$
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_service_prepare_smartstore_manual_adoption(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_commit_smartstore_manual_adoption(uuid,uuid,uuid,uuid,bigint,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.smartstore_jsonb_has_exact_keys(jsonb,text[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_hash(jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_claim_local_gateway_recovery_job(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'
     ) is null
     or pg_catalog.to_regclass(
       'sellerpilot_private.gateway_completion_receipts'
     ) is null
  then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
end;
$dependencies$;

create function sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_job.channel = 'smartstore'
    and p_job.operation = 'listing.lineage.verify'
    and p_job.environment = 'production'
    and p_job.attempt_id is null
    and p_job.listing_id is not null
    and p_job.credential_id is not null
    and coalesce(p_job.seller_account_key,'') ~ '^[a-f0-9]{64}$'
    and p_job.provider_mutation_started_at is null
    and p_job.credential_refresh_in_flight is false
    and p_job.credential_refresh_recovery_vault_id is null
    and p_job.prepared_credential_id is null
    and p_job.oauth_exchange_completed is false
    and p_job.request_payload->>'sellerpilotLineageVersion'
      = 'provider_listing_readback_v1'
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload,
      array['sellerpilotLineageVersion','arguments']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload->'arguments',
      array['sellerpilotSmartstoreManualAdoptionReadback']
    )
    and sellerpilot_private.smartstore_jsonb_has_exact_keys(
      p_job.request_payload#>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}',
      array[
        'contract','ownerId','productId','listingId','sourceJobId',
        'sourceAttemptId','credentialId','sellerAccountKey','sellerSku',
        'approvalRevision','contentSha256','manifestDigest'
      ]
    )
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,contract}'
      = 'smartstore_manual_adoption_readback_job_v1'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,ownerId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,productId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,listingId}'
      = p_job.listing_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sourceJobId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sourceAttemptId}'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,credentialId}'
      = p_job.credential_id::text
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sellerAccountKey}'
      = p_job.seller_account_key
    and length(trim(p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sellerSku}'))
      between 1 and 100
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,sellerSku}'
      !~ '[[:cntrl:]]'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,approvalRevision}'
      ~ '^[1-9][0-9]*$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,contentSha256}'
      ~ '^[a-f0-9]{64}$'
    and p_job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,manifestDigest}'
      ~ '^[a-f0-9]{64}$'
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
    sellerpilot_private.channel_gateway_jobs
  ) from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_manual_adoption_readback_binding(
  p_job sellerpilot_private.channel_gateway_jobs
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  marker jsonb;
  preparation jsonb;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
begin
  job := p_job;
  if job.id is null
     or sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job)
       is not true then
    return null;
  end if;
  marker := job.request_payload
    #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    (marker->>'ownerId')::uuid,
    (marker->>'productId')::uuid
  );
  if preparation->>'contract' is distinct from
       'smartstore_manual_adoption_prepare_v1'
     or coalesce(preparation->>'status' in ('ready','already_verified'),false)
       is not true
     or preparation->>'productId' is distinct from marker->>'productId'
     or preparation->>'listingId' is distinct from marker->>'listingId'
     or preparation->>'sourceJobId' is distinct from marker->>'sourceJobId'
     or preparation->>'sourceAttemptId' is distinct from marker->>'sourceAttemptId'
     or preparation->>'credentialId' is distinct from marker->>'credentialId'
     or preparation->>'sellerSku' is distinct from marker->>'sellerSku'
     or preparation->>'approvalRevision' is distinct from marker->>'approvalRevision'
     or preparation->>'contentSha256' is distinct from marker->>'contentSha256'
     or preparation->>'manifestDigest' is distinct from marker->>'manifestDigest' then
    return null;
  end if;
  select * into source_job
  from sellerpilot_private.channel_gateway_jobs
  where id = (marker->>'sourceJobId')::uuid;
  select * into credential
  from sellerpilot_private.channel_credentials
  where id = job.credential_id;
  if source_job.id is null
     or credential.id is null
     or source_job.attempt_id::text is distinct from marker->>'sourceAttemptId'
     or source_job.credential_id is distinct from job.credential_id
     or source_job.listing_id is distinct from job.listing_id
     or source_job.created_by is distinct from job.created_by
     or credential.created_by is distinct from source_job.created_by
     or source_job.seller_account_key is distinct from job.seller_account_key
     or credential.seller_account_key is distinct from job.seller_account_key
     or credential.channel <> 'smartstore'
     or credential.environment <> 'production'
     or credential.status <> 'active'
     or (credential.expires_at is not null
       and credential.expires_at <= clock_timestamp())
     or credential.seller_account_key_source not in (
       'provider_certified_v1','credential_incarnation_v1'
     ) then
    return null;
  end if;
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_binding_v1',
    'status',preparation->>'status',
    'preparation',preparation
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_readback_binding(
    sellerpilot_private.channel_gateway_jobs
  )
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_manual_adoption_readback_binding(
  p_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select sellerpilot_private.smartstore_manual_adoption_readback_binding(job)
  from sellerpilot_private.channel_gateway_jobs job
  where job.id = p_job_id
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_readback_binding(uuid)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
  p_job_id uuid,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_worker_version text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.id = p_credential_id
     and credential.channel = 'smartstore'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key = job.seller_account_key
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
    join sellerpilot_private.ai_cli_worker_tokens token
      on token.id = p_worker_token_id
     and token.scope = 'gateway'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
     and token.last_version = p_worker_version
     and p_worker_version ~ '^sellerpilot-cli-worker/1[.]61[+][0-9a-f]{40}[.][0-9a-f]{11}$'
     and p_worker_version like 'sellerpilot-cli-worker/1.61+'
       || sellerpilot_private.active_serverless_runtime_release_sha() || '.%'
    where job.id = p_job_id
      and job.status = 'queued'
      and (
        job.attempt_count = 0
        or job.updated_at <= clock_timestamp() - case
          when job.attempt_count = 1 then interval '5 seconds'
          when job.attempt_count = 2 then interval '10 seconds'
          when job.attempt_count = 3 then interval '20 seconds'
          when job.attempt_count = 4 then interval '40 seconds'
          else interval '80 seconds'
        end
      )
      and sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job)
      and sellerpilot_private.smartstore_manual_adoption_readback_binding(job.id)
        #>>'{status}' = 'ready'
  )
$$;

revoke all on function
  sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
    uuid,uuid,uuid,text
  ) from public, anon, authenticated, service_role;

-- A forged marker must not gain the separate active-job lane. The marker is
-- accepted while prepare is ready and after the same tuple becomes verified,
-- so the atomic completion can update the verifier after the adoption commit.
create function sellerpilot_private.guard_smartstore_manual_adoption_readback_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_marker jsonb;
  new_marker jsonb;
  binding jsonb;
begin
  new_marker := new.request_payload
    #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';
  if tg_op = 'UPDATE' then
    old_marker := old.request_payload
      #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';
  end if;
  if new_marker is null and old_marker is null then return new; end if;
  if new_marker is null
     or sellerpilot_private.smartstore_manual_adoption_readback_job_matches(new)
       is not true
     or (tg_op = 'UPDATE' and (
       old_marker is distinct from new_marker
       or old.channel is distinct from new.channel
       or old.operation is distinct from new.operation
       or old.environment is distinct from new.environment
       or old.listing_id is distinct from new.listing_id
       or old.credential_id is distinct from new.credential_id
       or old.seller_account_key is distinct from new.seller_account_key
       or old.created_by is distinct from new.created_by
     )) then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_MARKER_INVALID';
  end if;
  binding := sellerpilot_private.smartstore_manual_adoption_readback_binding(new);
  -- An expired running read whose approval/account tuple drifted is quarantined
  -- instead of remaining running or being automatically read again.
  if tg_op = 'UPDATE'
     and old.status = 'running' and new.status = 'queued'
     and binding is null then
    new.status := 'reconciliation_required';
    new.worker_token_id := null;
    new.claim_token := null;
    new.lease_expires_at := null;
    new.response_payload := null;
    new.error_message := 'SMARTSTORE_ADOPTION_READBACK_CAS_DRIFT';
    new.completed_at := clock_timestamp();
  end if;
  if new.status in ('queued','running','succeeded') and binding is null then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_BINDING_NOT_CURRENT';
  end if;
  if new.status = 'succeeded' and binding#>>'{status}' <> 'already_verified' then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_VERIFICATION_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_smartstore_manual_adoption_readback_job()
  from public, anon, authenticated, service_role;
create trigger smartstore_manual_adoption_readback_job_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.guard_smartstore_manual_adoption_readback_job();

-- One receipt per claim makes completion retries idempotent without consuming
-- the generic job-level receipt when a safe read is requeued under a new claim.
create table sellerpilot_private.smartstore_adoption_readback_completion_receipts (
  job_id uuid not null
    references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  claim_token uuid not null,
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  completion_fingerprint text not null
    check (completion_fingerprint ~ '^[a-f0-9]{64}$'),
  result_status text not null check (
    result_status in (
      'verified','queued','failed','reconciliation_required'
    )
  ),
  readback_sha256 text check (
    readback_sha256 is null or readback_sha256 ~ '^[a-f0-9]{64}$'
  ),
  adoption_receipt_id uuid
    references sellerpilot_private.smartstore_manual_adoption_receipts(id)
    on delete restrict,
  attestation_id uuid
    references sellerpilot_private.smartstore_manual_adoption_attestations(id)
    on delete restrict,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id,claim_token),
  check (
    (result_status = 'verified'
      and readback_sha256 is not null
      and adoption_receipt_id is not null
      and attestation_id is not null)
    or (result_status <> 'verified'
      and readback_sha256 is null
      and adoption_receipt_id is null
      and attestation_id is null)
  )
);

alter table sellerpilot_private.smartstore_adoption_readback_completion_receipts
  enable row level security;
revoke all on sellerpilot_private.smartstore_adoption_readback_completion_receipts
  from public, anon, authenticated, service_role;

-- Add one distinct verifier lane while preserving every prior lane verbatim.
drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
  on sellerpilot_private.channel_gateway_jobs (
    listing_id,
    (case
      when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_verifier_v1'
      when sellerpilot_private.qoo10_shipping_s1_activation_job_matches(channel_gateway_jobs)
        then 'qoo10_shipping_s1_activation_v1'
      when sellerpilot_private.qoo10_exact_s1_verifier_job_matches(channel_gateway_jobs)
        then 'qoo10_exact_s1_verifier_v1'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.update'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,contract}'='qoo10_exact_localization_update_v2'
        then 'qoo10_exact_localization_update_v2'
      when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       and channel='qoo10' and operation='listing.activate'
       and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'='allowed'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'='qoo10_s1_activation_v1'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
       and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'='1217336970'
        then 'qoo10_exact_s1_activation_v1'
      when channel='temu' and operation='listing.stop'
       and request_payload#>>'{arguments,sellerpilotTemuContainment,version}'='temu_safe_test_containment_v1'
        then 'temu_safe_test_containment_v1'
      when channel='temu' and operation='listing.publication.verify'
       and request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'='temu_safe_test_containment_discovery_v1'
       and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
        then 'temu_safe_test_containment_discovery_v1'
      when sellerpilot_private.smartstore_manual_adoption_readback_job_matches(
        channel_gateway_jobs
      ) then 'smartstore_manual_adoption_readback_v1'
      when channel='smartstore' and operation='listing.update'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contract}'='smartstore_manual_adoption_verified_v1'
       and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,status}'='verified'
        then 'smartstore_manual_adoption_normal_update_v1'
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

-- Reuse the proven SmartStore Mac read claimant. General local claims and the
-- recovery wrapper admit this operation only when the strict current marker
-- predicate passes. The serverless claimant remains explicitly excluded.
do $install_local_claim$
declare
  definition text;
  general_pattern constant text :=
    $pattern$j[.]operation[[:space:]]+not[[:space:]]+in[[:space:]]*[(][[:space:]]*'diagnostic[.]test'[[:space:]]*,[[:space:]]*'categories[.]list'[[:space:]]*,[[:space:]]*'categories[.]suggest'[[:space:]]*,[[:space:]]*'categories[.]attributes'[[:space:]]*,[[:space:]]*'categories[.]validate'[[:space:]]*,[[:space:]]*'inquiries[.]list'[[:space:]]*,[[:space:]]*'listing[.]publication[.]verify'[[:space:]]*[)]$pattern$;
  general_replacement constant text := $replacement$j.operation not in (
         'diagnostic.test','categories.list','categories.suggest',
         'categories.attributes','categories.validate','inquiries.list',
         'listing.publication.verify'
       )
       and not sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
         j.id,c.id,v_token_id,p_worker_version
       )$replacement$;
  recovery_pattern constant text :=
    $pattern$j[.]channel[[:space:]]*=[[:space:]]*'smartstore'[[:space:]]+and[[:space:]]+j[.]operation[[:space:]]+in[[:space:]]*[(][[:space:]]*'diagnostic[.]test'[[:space:]]*,[[:space:]]*'categories[.]list'[[:space:]]*,[[:space:]]*'categories[.]suggest'[[:space:]]*,[[:space:]]*'categories[.]attributes'[[:space:]]*,[[:space:]]*'categories[.]validate'[[:space:]]*,[[:space:]]*'inquiries[.]list'[[:space:]]*,[[:space:]]*'listing[.]publication[.]verify'[[:space:]]*[)]$pattern$;
  recovery_replacement constant text := $replacement$j.channel = 'smartstore'
           and (
             j.operation in (
               'diagnostic.test','categories.list','categories.suggest',
               'categories.attributes','categories.validate','inquiries.list',
               'listing.publication.verify'
             )
             or sellerpilot_private.smartstore_manual_adoption_readback_claim_allowed(
               j.id,c.id,v_token_id,p_worker_version
             )
           )$replacement$;
  serverless_definition text;
  general_hits integer;
  recovery_hits integer;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(
       definition,'smartstore_manual_adoption_readback_claim_allowed'
     ) = 0 then
    select count(*)::integer into general_hits
    from pg_catalog.regexp_matches(definition,general_pattern,'g');
    select count(*)::integer into recovery_hits
    from pg_catalog.regexp_matches(definition,recovery_pattern,'g');
    if general_hits <> 1 or recovery_hits <> 1 then
      raise exception 'SMARTSTORE_ADOPTION_READBACK_CLAIM_PREIMAGE_DRIFT';
    end if;
    definition := pg_catalog.regexp_replace(
      definition,general_pattern,general_replacement
    );
    definition := pg_catalog.regexp_replace(
      definition,recovery_pattern,recovery_replacement
    );
    execute definition;
    definition := pg_catalog.pg_get_functiondef(
      'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
    );
  end if;
  if (
       pg_catalog.length(definition)
       - pg_catalog.length(pg_catalog.replace(
           definition,'smartstore_manual_adoption_readback_claim_allowed',''
         ))
     ) / pg_catalog.length('smartstore_manual_adoption_readback_claim_allowed') <> 2
     or pg_catalog.strpos(definition,'sellerpilot.local_gateway_recovery_lane') = 0
     or pg_catalog.strpos(definition,'sellerpilot.local_channel_executor_lane') = 0
     or pg_catalog.strpos(definition,'qoo10_shipping_s1_verifier_job_matches') = 0
     or pg_catalog.strpos(definition,'qoo10_shipping_s1_activation_job_matches') = 0
     or pg_catalog.strpos(definition,'66147e5d-0479-4c51-896e-97e782af99e1') = 0
     or pg_catalog.strpos(definition,'0d2c492e-2025-4717-bb3f-0fd2b886fd4f') = 0 then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_CLAIM_POSTIMAGE_DRIFT';
  end if;
  serverless_definition := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(
       serverless_definition,
       $$job.channel is distinct from 'smartstore'$$
     ) = 0 then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_SERVERLESS_EXCLUSION_DRIFT';
  end if;
end;
$install_local_claim$;

create function public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preparation jsonb;
  source_job sellerpilot_private.channel_gateway_jobs%rowtype;
  credential sellerpilot_private.channel_credentials%rowtype;
  existing_job sellerpilot_private.channel_gateway_jobs%rowtype;
  marker jsonb;
  request_payload jsonb;
  new_job_id uuid := gen_random_uuid();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-adoption:' || p_product_id::text)
  );
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor,p_product_id
  );
  if preparation->>'status' = 'already_verified' then
    select job.* into existing_job
    from sellerpilot_private.channel_gateway_jobs job
    where sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job)
      and job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,productId}'
        = p_product_id::text
    order by job.created_at desc,job.id desc limit 1;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','verified','reason','ADOPTION_ALREADY_VERIFIED',
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'jobId',existing_job.id,'reused',true,
      'receiptId',preparation->>'receiptId',
      'attestationId',preparation->>'attestationId',
      'originProductNo',preparation->>'originProductNo',
      'channelProductNo',preparation->>'channelProductNo',
      'providerMutationPerformed',false,'contentVerified',true,
      'normalUpdateEligible',true
    );
  end if;
  if preparation->>'status' <> 'ready' then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','blocked','reason','PREPARE_BLOCKED',
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'jobId',null,'reused',false,'receiptId',null,'attestationId',null,
      'originProductNo',null,'channelProductNo',null,
      'providerMutationPerformed',false,'contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;

  select job.* into existing_job
  from sellerpilot_private.channel_gateway_jobs job
  where sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job)
    and job.listing_id = (preparation->>'listingId')::uuid
    and job.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,productId}'
      = p_product_id::text
    and job.status in ('queued','running','reconciliation_required')
  order by
    case job.status when 'reconciliation_required' then 0
      when 'running' then 1 when 'queued' then 2 else 3 end,
    job.created_at desc,job.id desc
  limit 1
  for update;
  if existing_job.id is not null then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status',case
        when existing_job.status in ('queued','running','reconciliation_required')
          then existing_job.status else 'blocked' end,
      'reason',case existing_job.status
        when 'queued' then 'READBACK_QUEUED'
        when 'running' then 'READBACK_RUNNING'
        when 'reconciliation_required' then 'READBACK_RECONCILIATION_REQUIRED'
        else 'READBACK_FAILED' end,
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'jobId',existing_job.id,'reused',true,
      'receiptId',null,'attestationId',null,
      'originProductNo',null,'channelProductNo',null,
      'providerMutationPerformed',false,'contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;

  select * into source_job
  from sellerpilot_private.channel_gateway_jobs
  where id = (preparation->>'sourceJobId')::uuid for share;
  select * into credential
  from sellerpilot_private.channel_credentials
  where id = (preparation->>'credentialId')::uuid for share;
  if source_job.id is null or credential.id is null
     or source_job.created_by is distinct from credential.created_by
     or source_job.seller_account_key is distinct from credential.seller_account_key then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_PREPARE_TUPLE_DRIFT'
      using errcode = '40001';
  end if;
  marker := jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_job_v1',
    'ownerId',p_actor,'productId',p_product_id,
    'listingId',preparation->>'listingId',
    'sourceJobId',preparation->>'sourceJobId',
    'sourceAttemptId',preparation->>'sourceAttemptId',
    'credentialId',preparation->>'credentialId',
    'sellerAccountKey',credential.seller_account_key,
    'sellerSku',preparation->>'sellerSku',
    'approvalRevision',(preparation->>'approvalRevision')::bigint,
    'contentSha256',preparation->>'contentSha256',
    'manifestDigest',preparation->>'manifestDigest'
  );
  request_payload := jsonb_build_object(
    'sellerpilotLineageVersion','provider_listing_readback_v1',
    'arguments',jsonb_build_object(
      'sellerpilotSmartstoreManualAdoptionReadback',marker
    )
  );
  insert into sellerpilot_private.channel_gateway_jobs (
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,seller_account_key,created_by
  ) values (
    new_job_id,credential.id,null,(preparation->>'listingId')::uuid,
    'smartstore','listing.lineage.verify','production',request_payload,
    credential.seller_account_key,source_job.created_by
  );
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_enqueue_v1',
    'status','queued','reason','READBACK_QUEUED',
    'productId',p_product_id,'listingId',preparation->>'listingId',
    'jobId',new_job_id,'reused',false,
    'receiptId',null,'attestationId',null,
    'originProductNo',null,'channelProductNo',null,
    'providerMutationPerformed',false,'contentVerified',false,
    'normalUpdateEligible',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(uuid,uuid)
  to service_role;

create function public.sellerpilot_service_get_smartstore_manual_adoption_readback_status(
  p_actor uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preparation jsonb;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  preparation := public.sellerpilot_service_prepare_smartstore_manual_adoption(
    p_actor,p_product_id
  );
  select candidate.* into job
  from sellerpilot_private.channel_gateway_jobs candidate
  where sellerpilot_private.smartstore_manual_adoption_readback_job_matches(candidate)
    and candidate.request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoptionReadback,productId}'
      = p_product_id::text
  order by candidate.created_at desc,candidate.id desc limit 1;
  if preparation->>'status' = 'already_verified' then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','verified','reason','ADOPTION_ALREADY_VERIFIED',
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'jobId',job.id,'reused',true,
      'receiptId',preparation->>'receiptId',
      'attestationId',preparation->>'attestationId',
      'originProductNo',preparation->>'originProductNo',
      'channelProductNo',preparation->>'channelProductNo',
      'providerMutationPerformed',false,'contentVerified',true,
      'normalUpdateEligible',true
    );
  end if;
  if preparation->>'status' <> 'ready' then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','blocked','reason','PREPARE_BLOCKED',
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'jobId',job.id,'reused',job.id is not null,
      'receiptId',null,'attestationId',null,
      'originProductNo',null,'channelProductNo',null,
      'providerMutationPerformed',false,'contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  if job.id is null then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_enqueue_v1',
      'status','blocked','reason','NO_READBACK_JOB',
      'productId',p_product_id,'listingId',preparation->>'listingId',
      'jobId',null,'reused',false,'receiptId',null,'attestationId',null,
      'originProductNo',null,'channelProductNo',null,
      'providerMutationPerformed',false,'contentVerified',false,
      'normalUpdateEligible',false
    );
  end if;
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_enqueue_v1',
    'status',case when job.status in ('queued','running','reconciliation_required')
      then job.status else 'blocked' end,
    'reason',case job.status
      when 'queued' then 'READBACK_QUEUED'
      when 'running' then 'READBACK_RUNNING'
      when 'reconciliation_required' then 'READBACK_RECONCILIATION_REQUIRED'
      else 'READBACK_FAILED' end,
    'productId',p_product_id,'listingId',preparation->>'listingId',
    'jobId',job.id,'reused',true,'receiptId',null,'attestationId',null,
    'originProductNo',null,'channelProductNo',null,
    'providerMutationPerformed',false,'contentVerified',false,
    'normalUpdateEligible',false
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_get_smartstore_manual_adoption_readback_status(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_smartstore_manual_adoption_readback_status(uuid,uuid)
  to service_role;

create function public.sellerpilot_complete_smartstore_manual_adoption_readback(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_readback jsonb default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  worker_token sellerpilot_private.ai_cli_worker_tokens%rowtype;
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  marker jsonb;
  binding jsonb;
  completion_receipt sellerpilot_private.smartstore_adoption_readback_completion_receipts%rowtype;
  commit_result jsonb;
  readback_sha text;
  safe_error text;
  completion_fingerprint text;
  result_status text;
  result_reason text;
  safe_response jsonb;
  prior_lineage_rebind text;
begin
  if p_job_id is null or p_claim_token is null
     or p_status not in ('succeeded','failed','retryable')
     or (p_status = 'succeeded' and (
       jsonb_typeof(p_readback) is distinct from 'object'
       or octet_length(p_readback::text) > 2097152
       or p_error_message is not null
     ))
     or (p_status <> 'succeeded' and p_readback is not null) then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_COMPLETION_INVALID';
  end if;
  select * into worker_token
  from sellerpilot_private.ai_cli_worker_tokens token
  where token.token_hash = p_token_hash
    and token.scope = 'gateway'
    and token.status = 'active'
    and token.expires_at > clock_timestamp();
  if worker_token.id is null then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_WORKER_DENIED'
      using errcode = '42501';
  end if;
  safe_error := case
    when p_status = 'succeeded' then null
    when coalesce(p_error_message,'') ~ '^[A-Z0-9_:-]{1,160}$'
      then p_error_message
    else 'SMARTSTORE_ADOPTION_READBACK_FAILED'
  end;
  readback_sha := case when p_status = 'succeeded'
    then sellerpilot_private.external_detail_hash(p_readback) else null end;
  completion_fingerprint := sellerpilot_private.external_detail_hash(
    jsonb_build_object(
      'status',p_status,'readbackSha256',readback_sha,'safeError',safe_error
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    193674993,pg_catalog.hashtext('smartstore-adoption-job:' || p_job_id::text)
  );
  select * into completion_receipt
  from sellerpilot_private.smartstore_adoption_readback_completion_receipts receipt
  where receipt.job_id = p_job_id
    and receipt.claim_token = p_claim_token
    and receipt.worker_token_id = worker_token.id;
  if completion_receipt.job_id is not null then
    if completion_receipt.completion_fingerprint
         is distinct from completion_fingerprint then
      return jsonb_build_object(
        'contract','smartstore_manual_adoption_readback_completion_v1',
        'status','reconciliation_required','jobId',p_job_id,
        'receiptId',completion_receipt.adoption_receipt_id,
        'attestationId',completion_receipt.attestation_id,
        'readbackSha256',completion_receipt.readback_sha256,
        'reused',true,'reason','COMPLETION_REPLAY_MISMATCH'
      );
    end if;
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status',completion_receipt.result_status,'jobId',p_job_id,
      'receiptId',completion_receipt.adoption_receipt_id,
      'attestationId',completion_receipt.attestation_id,
      'readbackSha256',completion_receipt.readback_sha256,
      'reused',true,'reason',completion_receipt.reason
    );
  end if;

  select claimed.* into job
  from sellerpilot_private.channel_gateway_jobs claimed
  where claimed.id = p_job_id
    and claimed.status = 'running'
    and claimed.worker_token_id = worker_token.id
    and claimed.claim_token = p_claim_token
    and claimed.lease_expires_at > clock_timestamp()
  for update;
  if job.id is null then
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','lease_lost','jobId',p_job_id,'receiptId',null,
      'attestationId',null,'readbackSha256',null,
      'reused',false,'reason','CLAIM_LEASE_LOST'
    );
  end if;
  if sellerpilot_private.smartstore_manual_adoption_readback_job_matches(job)
       is not true then
    raise exception 'SMARTSTORE_ADOPTION_READBACK_JOB_MISMATCH';
  end if;
  binding := sellerpilot_private.smartstore_manual_adoption_readback_binding(job.id);
  if binding#>>'{status}' is distinct from 'ready' then
    prior_lineage_rebind := coalesce(current_setting(
      'sellerpilot.provider_listing_lineage_rebind',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='reconciliation_required',response_payload=null,
          error_message='SMARTSTORE_ADOPTION_READBACK_CAS_DRIFT',
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
    );
    insert into sellerpilot_private.smartstore_adoption_readback_completion_receipts (
      job_id,claim_token,worker_token_id,completion_fingerprint,result_status,
      readback_sha256,adoption_receipt_id,attestation_id,reason
    ) values (
      job.id,p_claim_token,worker_token.id,completion_fingerprint,
      'reconciliation_required',null,null,null,
      'SMARTSTORE_ADOPTION_READBACK_CAS_DRIFT'
    );
    insert into sellerpilot_private.gateway_completion_receipts (
      job_id,claim_token,worker_token_id,completion_fingerprint,
      continuation_job_id
    ) values (
      job.id,p_claim_token,worker_token.id,completion_fingerprint,null
    );
    return jsonb_build_object(
      'contract','smartstore_manual_adoption_readback_completion_v1',
      'status','reconciliation_required','jobId',job.id,
      'receiptId',null,'attestationId',null,'readbackSha256',null,
      'reused',false,'reason','SMARTSTORE_ADOPTION_READBACK_CAS_DRIFT'
    );
  end if;
  marker := job.request_payload
    #>'{arguments,sellerpilotSmartstoreManualAdoptionReadback}';

  if p_status = 'succeeded' then
    commit_result := public.sellerpilot_service_commit_smartstore_manual_adoption(
      (marker->>'ownerId')::uuid,
      (marker->>'productId')::uuid,
      (marker->>'sourceJobId')::uuid,
      (marker->>'credentialId')::uuid,
      (marker->>'approvalRevision')::bigint,
      marker->>'contentSha256',marker->>'manifestDigest',p_readback
    );
    if commit_result->>'contract' <> 'smartstore_manual_adoption_verified_v1'
       or commit_result->>'status' not in ('verified','already_verified')
       or commit_result->>'providerMutationPerformed' <> 'false'
       or commit_result->>'normalUpdateEligible' <> 'true' then
      raise exception 'SMARTSTORE_ADOPTION_READBACK_COMMIT_REJECTED';
    end if;
    result_status := 'verified';
    result_reason := 'ADOPTION_VERIFIED';
    safe_response := jsonb_build_object(
      'contract','smartstore_manual_adoption_gateway_receipt_v1',
      'ok',true,'channel','smartstore',
      'operation','listing.lineage.verify',
      'verificationStatus','verified',
      'readbackSha256',readback_sha,
      'receiptId',commit_result->>'receiptId',
      'attestationId',commit_result->>'attestationId',
      'originProductNo',commit_result->>'originProductNo',
      'channelProductNo',commit_result->>'channelProductNo',
      'providerMutationPerformed',false
    );
    prior_lineage_rebind := coalesce(current_setting(
      'sellerpilot.provider_listing_lineage_rebind',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='succeeded',response_payload=safe_response,error_message=null,
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
    );
  elsif p_status = 'retryable' then
    if job.attempt_count >= 6 then
      result_status := 'reconciliation_required';
      result_reason := 'READBACK_RECONCILIATION_REQUIRED';
      prior_lineage_rebind := coalesce(current_setting(
        'sellerpilot.provider_listing_lineage_rebind',true
      ),'');
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
      );
      begin
        update sellerpilot_private.channel_gateway_jobs
        set status='reconciliation_required',response_payload=null,
            error_message='SMARTSTORE_ADOPTION_READBACK_RETRY_LIMIT',
            worker_token_id=null,claim_token=null,lease_expires_at=null,
            completed_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=job.id;
      exception when others then
        perform pg_catalog.set_config(
          'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
        );
        raise;
      end;
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
      );
    else
      result_status := 'queued';
      result_reason := 'READBACK_QUEUED';
      prior_lineage_rebind := coalesce(current_setting(
        'sellerpilot.provider_listing_lineage_rebind',true
      ),'');
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
      );
      begin
        update sellerpilot_private.channel_gateway_jobs
        set status='queued',response_payload=null,error_message=null,
            worker_token_id=null,claim_token=null,lease_expires_at=null,
            completed_at=null,updated_at=clock_timestamp()
        where id=job.id;
      exception when others then
        perform pg_catalog.set_config(
          'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
        );
        raise;
      end;
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
      );
    end if;
  else
    result_status := 'failed';
    result_reason := 'READBACK_FAILED';
    safe_response := jsonb_build_object(
      'contract','smartstore_manual_adoption_gateway_receipt_v1',
      'ok',false,'channel','smartstore',
      'operation','listing.lineage.verify','reason',safe_error,
      'providerMutationPerformed',false
    );
    prior_lineage_rebind := coalesce(current_setting(
      'sellerpilot.provider_listing_lineage_rebind',true
    ),'');
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',job.id::text,true
    );
    begin
      update sellerpilot_private.channel_gateway_jobs
      set status='failed',response_payload=safe_response,error_message=safe_error,
          worker_token_id=null,claim_token=null,lease_expires_at=null,
          completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=job.id;
    exception when others then
      perform pg_catalog.set_config(
        'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
      );
      raise;
    end;
    perform pg_catalog.set_config(
      'sellerpilot.provider_listing_lineage_rebind',prior_lineage_rebind,true
    );
  end if;

  insert into sellerpilot_private.smartstore_adoption_readback_completion_receipts (
    job_id,claim_token,worker_token_id,completion_fingerprint,result_status,
    readback_sha256,adoption_receipt_id,attestation_id,reason
  ) values (
    job.id,p_claim_token,worker_token.id,completion_fingerprint,result_status,
    readback_sha,
    case when result_status='verified'
      then (commit_result->>'receiptId')::uuid else null end,
    case when result_status='verified'
      then (commit_result->>'attestationId')::uuid else null end,
    result_reason
  );
  if result_status <> 'queued' then
    insert into sellerpilot_private.gateway_completion_receipts (
      job_id,claim_token,worker_token_id,completion_fingerprint,
      continuation_job_id
    ) values (
      job.id,p_claim_token,worker_token.id,completion_fingerprint,null
    );
  end if;
  return jsonb_build_object(
    'contract','smartstore_manual_adoption_readback_completion_v1',
    'status',result_status,'jobId',job.id,
    'receiptId',case when result_status='verified'
      then commit_result->>'receiptId' else null end,
    'attestationId',case when result_status='verified'
      then commit_result->>'attestationId' else null end,
    'readbackSha256',readback_sha,'reused',false,'reason',result_reason
  );
end;
$$;

revoke all on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(
    text,uuid,uuid,text,jsonb,text
  ) to service_role;

comment on function
  public.sellerpilot_service_enqueue_smartstore_manual_adoption_readback(uuid,uuid)
  is 'Queues one exact read-only SmartStore existing-remote adoption verifier from current DB-owned prepare/CAS data. Browser-supplied credential, source and approval identities are not accepted.';
comment on function
  public.sellerpilot_complete_smartstore_manual_adoption_readback(text,uuid,uuid,text,jsonb,text)
  is 'Atomically verifies the exact gateway claim and current prepare tuple, commits official readback through the 150000 adoption contract, then stores only safe IDs and a digest in the generic gateway job. No provider mutation occurs.';

commit;
