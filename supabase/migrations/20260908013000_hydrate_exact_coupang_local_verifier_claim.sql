-- Hydrate the one exact Coupang GET verifier in the same transaction that
-- claims it for the attested local executor. No stored source/request row is
-- changed, and the temporary gateway-token read capability is scoped to this
-- function call and this verifier claim token.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(1637578093, 8072038);

do $preflight$
declare
  claim_definition text;
  allowed_definition text;
  unsafe_claim_definition text;
  source_definition text;
  ownership_definition text;
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  run sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_claim_local_channel_executor_before_coupang_hydration(text,text,text,text)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.coupang_exact_live_local_running_owned(text,uuid,uuid)'
     ) is not null then
    raise exception 'COUPANG_EXACT_LOCAL_HYDRATION_ALREADY_PATCHED'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
  ) into strict claim_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  ) into strict unsafe_claim_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into strict allowed_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'::regprocedure
  ) into strict source_definition;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)'::regprocedure
  ) into strict ownership_definition;

  if pg_catalog.strpos(claim_definition,
       'sellerpilot_claim_local_channel_executor_before_coupang_get') = 0
     or pg_catalog.strpos(claim_definition,
       '86d2cb63-d382-4cc9-8153-654cf7ccec80') = 0
     or pg_catalog.strpos(allowed_definition,
       'coupang_exact_live_local_claim_allowed') = 0
     or pg_catalog.strpos(unsafe_claim_definition,
       'sellerpilot.local_channel_executor_lane') = 0
     or pg_catalog.strpos(unsafe_claim_definition,
       'local_channel_executor_job_allowed') = 0
     or pg_catalog.strpos(source_definition,
       'sellerpilot_private.serverless_cs_job_is_owned') = 0
     or pg_catalog.strpos(source_definition,
       'coupang_exact_live_source_current') = 0
     or pg_catalog.strpos(source_definition,
       'coupang_provider_assigned_vendor_items_v1') = 0
     or pg_catalog.strpos(ownership_definition,
       $$token.scope = 'serverless_cs'$$) = 0
     or sellerpilot_private.serverless_gateway_job_allowed(
       'coupang', 'listing.publication.verify'
     ) is true then
    raise exception 'COUPANG_EXACT_LOCAL_HYDRATION_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  select * into verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
   for update;
  select * into run
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
   for share;

  if verifier.id is null
     or run.verifier_job_id is null
     or (select count(*) from sellerpilot_private.coupang_exact_live_verify_runs) <> 1
     or run.source_job_id is distinct from
       '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
     or run.source_attempt_id is distinct from
       'd771421b-f408-4f75-addd-03879393fab8'::uuid
     or run.listing_id is distinct from
       'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
     or run.remote_id is distinct from '16375780938'
     or verifier.status is distinct from 'queued'
     or verifier.worker_token_id is not null
     or verifier.claim_token is not null
     or verifier.lease_expires_at is not null
     or verifier.provider_mutation_started_at is not null
     or verifier.write_resource_kind is not null
     or verifier.write_resource_key is not null
     or verifier.credential_refresh_in_flight is not false
     or verifier.credential_refresh_recovery_vault_id is not null
     or verifier.prepared_credential_id is not null
     or verifier.oauth_exchange_completed is not false
     or sellerpilot_private.coupang_exact_live_verifier_job_matches(verifier)
       is not true
     or sellerpilot_private.coupang_exact_live_source_current() is not true
     or exists (
       select 1
         from sellerpilot_private.coupang_exact_live_verify_receipts
     ) then
    raise exception 'COUPANG_EXACT_LOCAL_HYDRATION_SOURCE_DRIFT'
      using errcode = '55000';
  end if;
end
$preflight$;

-- This predicate is useful only while the outer claim wrapper holds the exact
-- transaction-local marker. Outside that call, a gateway token can never pass
-- the serverless source-reader ownership helper.
create function sellerpilot_private.coupang_exact_live_local_running_owned(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  verifier sellerpilot_private.channel_gateway_jobs%rowtype;
  v_release_sha text;
  v_egress_sha256 text;
begin
  v_release_sha := current_setting(
    'sellerpilot.coupang_exact_live_local_hydration_release', true
  );
  v_egress_sha256 := current_setting(
    'sellerpilot.coupang_exact_live_local_hydration_egress', true
  );
  select * into verifier
    from sellerpilot_private.channel_gateway_jobs
   where id = p_job_id;

  return coalesce(
    p_job_id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid
    and current_setting(
      'sellerpilot.coupang_exact_live_local_hydration', true
    ) = p_job_id::text
    and coalesce(p_token_hash, '') ~ '^[a-f0-9]{64}$'
    and coalesce(v_release_sha, '') ~ '^[a-f0-9]{40}$'
    and coalesce(v_egress_sha256, '') ~ '^[a-f0-9]{64}$'
    and sellerpilot_private.active_serverless_runtime_release_sha() = v_release_sha
    and verifier.status = 'running'
    and verifier.claim_token = p_claim_token
    and verifier.lease_expires_at > clock_timestamp()
    and verifier.attempt_id is null
    and verifier.provider_mutation_started_at is null
    and verifier.write_resource_kind is null
    and verifier.write_resource_key is null
    and verifier.credential_refresh_in_flight is false
    and verifier.credential_refresh_recovery_vault_id is null
    and verifier.prepared_credential_id is null
    and verifier.oauth_exchange_completed is false
    and sellerpilot_private.coupang_exact_live_verifier_job_matches(verifier)
      is true
    and sellerpilot_private.coupang_exact_live_source_current() is true
    and (select count(*)
           from sellerpilot_private.coupang_exact_live_verify_runs) = 1
    and not exists (
      select 1
        from sellerpilot_private.coupang_exact_live_verify_receipts
    )
    and exists (
      select 1
        from sellerpilot_private.coupang_exact_live_verify_runs run
        join sellerpilot_private.channel_gateway_jobs source
          on source.id = run.source_job_id
        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id = run.source_attempt_id
        join sellerpilot_private.product_listings listing
          on listing.id = run.listing_id
       where run.verifier_job_id = verifier.id
         and run.source_job_id =
           '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
         and run.source_attempt_id =
           'd771421b-f408-4f75-addd-03879393fab8'::uuid
         and run.listing_id =
           'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
         and run.remote_id = '16375780938'
         and encode(extensions.digest(to_jsonb(source)::text, 'sha256'), 'hex')
           = run.source_job_sha256
         and encode(extensions.digest(to_jsonb(attempt)::text, 'sha256'), 'hex')
           = run.source_attempt_sha256
         and encode(extensions.digest(to_jsonb(listing)::text, 'sha256'), 'hex')
           = run.source_listing_sha256
         and listing.owner_id = attempt.owner_id
         and attempt.owner_id <> source.created_by
    )
    and exists (
      select 1
        from sellerpilot_private.channel_credentials credential
       where credential.id = verifier.credential_id
         and credential.id =
           '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
         and credential.channel = 'coupang'
         and credential.environment = 'production'
         and credential.status = 'active'
         and (credential.expires_at is null
           or credential.expires_at > clock_timestamp())
         and credential.last_check_status = 'passed'
         and credential.seller_account_key = verifier.seller_account_key
         and credential.seller_account_key_source in (
           'provider_certified_v1', 'credential_incarnation_v1'
         )
         and credential.created_by = verifier.created_by
         and exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = credential.created_by
         )
    )
    and exists (
      select 1
        from sellerpilot_private.ai_cli_worker_tokens token
       where token.id = verifier.worker_token_id
         and token.token_hash = p_token_hash
         and token.scope = 'gateway'
         and token.status = 'active'
         and token.expires_at > clock_timestamp()
         and token.last_seen_at >= clock_timestamp() - interval '3 minutes'
         and token.last_version = 'sellerpilot-cli-worker/1.61+'
           || v_release_sha || '.' || left(v_egress_sha256, 11)
         and exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = token.created_by
         )
    )
    and exists (
      select 1
        from sellerpilot_private.coupang_exact_live_local_claim_routes exact_route
        join sellerpilot_private.local_channel_executor_routes source_route
          on source_route.id = exact_route.source_read_route_id
         and source_route.owner_id = exact_route.owner_id
         and source_route.channel = exact_route.channel
         and source_route.operation in (
           'categories.attributes', 'categories.validate'
         )
         and source_route.credential_id = exact_route.credential_id
         and source_route.seller_account_key = exact_route.seller_account_key
         and source_route.worker_token_id = exact_route.worker_token_id
         and source_route.egress_ip_sha256 = exact_route.egress_ip_sha256
         and source_route.enabled
         and source_route.approved_at <= clock_timestamp()
         and source_route.expires_at > clock_timestamp()
        join sellerpilot_private.product_listings listing
          on listing.id = verifier.listing_id
         and listing.owner_id = exact_route.owner_id
       where exact_route.job_id = verifier.id
         and exact_route.credential_id = verifier.credential_id
         and exact_route.worker_token_id = verifier.worker_token_id
         and exact_route.owner_id =
           '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and exact_route.channel = 'coupang'
         and exact_route.operation = 'listing.publication.verify'
         and exact_route.seller_account_key = verifier.seller_account_key
         and exact_route.release_sha = v_release_sha
         and exact_route.egress_ip_sha256 = v_egress_sha256
         and exact_route.activated_by = verifier.created_by
         and exact_route.activated_at <= clock_timestamp()
         and exact_route.expires_at > clock_timestamp()
         and exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = exact_route.owner_id
         )
         and exists (
           select 1 from sellerpilot_private.admin_users admin
            where admin.user_id = source_route.approved_by
         )
    )
    and exists (
      select 1
        from sellerpilot_private.serverless_static_egress_policy policy
       where policy.channel = 'coupang'
         and policy.enabled is false
    ),
    false
  );
exception when others then
  return false;
end
$$;

revoke all on function
  sellerpilot_private.coupang_exact_live_local_running_owned(text,uuid,uuid)
  from public, anon, authenticated, service_role;

-- Preserve the existing serverless-CS ownership matrix exactly. The added OR
-- is reachable only inside the exact local claim transaction above.
create or replace function sellerpilot_private.serverless_cs_job_is_owned(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_require_live_lease boolean default true
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
        from sellerpilot_private.ai_cli_worker_tokens token
        join sellerpilot_private.channel_gateway_jobs job
          on job.worker_token_id = token.id
       where token.token_hash = p_token_hash
         and token.scope = 'serverless_cs'
         and token.status = 'active'
         and token.expires_at > clock_timestamp()
         and job.id = p_job_id
         and job.claim_token = p_claim_token
         and sellerpilot_private.serverless_gateway_job_allowed(
           job.channel,
           job.operation
         )
         and (
           not p_require_live_lease
           or (
             job.status = 'running'
             and job.lease_expires_at > clock_timestamp()
           )
         )
    )
    or (
      p_require_live_lease
      and sellerpilot_private.coupang_exact_live_local_running_owned(
        p_token_hash,
        p_job_id,
        p_claim_token
      )
    ),
    false
  )
$$;

revoke all on function sellerpilot_private.serverless_cs_job_is_owned(
  text,uuid,uuid,boolean
) from public, anon, authenticated, service_role;

-- The ordinary gateway fallback must skip this exact row. The local lane sets
-- its own transaction-local marker and still reaches the dedicated predicate.
do $exclude_generic_claim$
declare
  source text;
  patched text;
  queued_marker constant text := $marker$   where j.status = 'queued'$marker$;
  exclusion_marker constant text :=
    'sellerpilot.coupang_exact_live_generic_claim_exclusion_v1';
  first_at integer;
begin
  source := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(source, exclusion_marker) > 0 then
    return;
  end if;
  first_at := pg_catalog.strpos(source, queued_marker);
  if first_at = 0
     or pg_catalog.strpos(
       pg_catalog.substr(source, first_at + pg_catalog.length(queued_marker)),
       queued_marker
     ) > 0 then
    raise exception 'COUPANG_EXACT_GENERIC_CLAIM_WHERE_DRIFT'
      using errcode = '55000';
  end if;
  patched := pg_catalog.substr(
    source, 1, first_at + pg_catalog.length(queued_marker) - 1
  ) || $patch$
     and (
       coalesce(current_setting(
         'sellerpilot.local_channel_executor_lane', true
       ), '') = 'enabled'
       or (
         current_setting(
           'sellerpilot.coupang_exact_live_generic_claim_exclusion_v1', true
         ) is null
         and sellerpilot_private.coupang_exact_live_verifier_job_matches(j)
           is not true
       )
     )
$patch$ || pg_catalog.substr(
    source, first_at + pg_catalog.length(queued_marker)
  );
  execute patched;
  source := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(source, exclusion_marker) = 0
     or pg_catalog.strpos(source,
       'coupang_exact_live_verifier_job_matches') = 0
     or pg_catalog.strpos(source,
       'sellerpilot.local_channel_executor_lane') = 0 then
    raise exception 'COUPANG_EXACT_GENERIC_CLAIM_EXCLUSION_FAILED'
      using errcode = '55000';
  end if;
end
$exclude_generic_claim$;

alter function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) rename to sellerpilot_claim_local_channel_executor_before_coupang_hydration;
revoke all on function
  public.sellerpilot_claim_local_channel_executor_before_coupang_hydration(
    text,text,text,text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_claim_local_channel_executor_job(
  p_token_hash text,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_marker text;
  prior_release text;
  prior_egress text;
  result jsonb;
  source jsonb;
  arguments_value jsonb;
  claimed_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  if coalesce(p_release_sha, '') !~ '^[a-f0-9]{40}$'
     or coalesce(p_egress_ip_sha256, '') !~ '^[a-f0-9]{64}$'
     or p_worker_version is distinct from
       'sellerpilot-cli-worker/1.61+' || p_release_sha
       || '.' || left(p_egress_ip_sha256, 11)
     or sellerpilot_private.active_serverless_runtime_release_sha()
       is distinct from p_release_sha then
    raise exception 'invalid local channel executor hydration attestation'
      using errcode = '42501';
  end if;

  prior_marker := coalesce(current_setting(
    'sellerpilot.coupang_exact_live_local_hydration', true
  ), '');
  prior_release := coalesce(current_setting(
    'sellerpilot.coupang_exact_live_local_hydration_release', true
  ), '');
  prior_egress := coalesce(current_setting(
    'sellerpilot.coupang_exact_live_local_hydration_egress', true
  ), '');
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_local_hydration',
    '86d2cb63-d382-4cc9-8153-654cf7ccec80',
    true
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_local_hydration_release',
    p_release_sha,
    true
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_local_hydration_egress',
    p_egress_ip_sha256,
    true
  );

  begin
    result := public.sellerpilot_claim_local_channel_executor_before_coupang_hydration(
      p_token_hash,
      p_worker_version,
      p_release_sha,
      p_egress_ip_sha256
    );

    if result->>'id' = '86d2cb63-d382-4cc9-8153-654cf7ccec80' then
      select * into claimed_job
        from sellerpilot_private.channel_gateway_jobs
       where id = '86d2cb63-d382-4cc9-8153-654cf7ccec80'::uuid;
      if result->>'claim_token' is null
         or result->>'channel' is distinct from 'coupang'
         or result->>'operation' is distinct from 'listing.publication.verify'
         or result->>'environment' is distinct from 'production'
         or jsonb_typeof(result->'request') is distinct from 'object'
         or jsonb_typeof(result#>'{request,arguments}') is distinct from 'object'
         or sellerpilot_private.coupang_exact_live_local_running_owned(
           p_token_hash,
           claimed_job.id,
           (result->>'claim_token')::uuid
         ) is not true then
        raise exception 'COUPANG_EXACT_LOCAL_CLAIM_RESULT_INVALID'
          using errcode = '55000';
      end if;

      source := public.sellerpilot_service_listing_publication_verification_source(
        p_token_hash,
        claimed_job.id,
        claimed_job.claim_token
      );
      if jsonb_typeof(source) is distinct from 'object'
         or source->>'contract' is distinct from
           'listing_publication_verification_source_v1'
         or source->>'verificationJobId' is distinct from claimed_job.id::text
         or source->>'sourceJobId' is distinct from
           '25adf712-1e9a-432b-8b0d-09cf35a826c5'
         or source->>'sourceOperation' is distinct from 'listing.create'
         or source->>'sourceFingerprint' is distinct from
           'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
         or source->>'expectedRemoteId' is distinct from '16375780938'
         or source->>'expectedLocale' is distinct from 'ko-KR'
         or source->>'expectedImageCount' is distinct from '8'
         or source->>'market' is distinct from ''
         or source->>'targetId' is distinct from ''
         or jsonb_typeof(source->'sourceArguments') is distinct from 'object'
         or jsonb_typeof(source->'sourceResponsePayload') is distinct from 'object'
         or source#>>'{sourceResponsePayload,remoteState,resources,sellerProductId}'
           is distinct from '16375780938'
         or source#>>'{sourceResponsePayload,remoteState,evidence,providerAssignedDescendantIdentityBinding,contract}'
           is distinct from 'coupang_provider_assigned_vendor_items_v1'
         or source#>>'{sourceResponsePayload,remoteState,evidence,providerAssignedDescendantIdentityBinding,sourceJobId}'
           is distinct from '25adf712-1e9a-432b-8b0d-09cf35a826c5'
         or source#>>'{sourceResponsePayload,remoteState,evidence,providerAssignedDescendantIdentityBinding,sellerProductId}'
           is distinct from '16375780938' then
        raise exception 'COUPANG_EXACT_LOCAL_SOURCE_CONTRACT_INVALID'
          using errcode = '55000';
      end if;

      arguments_value := result#>'{request,arguments}';
      result := jsonb_set(
        result,
        '{request,arguments}',
        arguments_value || jsonb_build_object(
          'sellerpilotPublicationSource', source
        ),
        false
      );

      if result#>>'{request,arguments,sellerpilotPublicationSource,verificationJobId}'
           is distinct from claimed_job.id::text
         or claimed_job.request_payload ? 'sellerpilotPublicationSource'
         or claimed_job.request_payload#>'{arguments,sellerpilotPublicationSource}'
           is not null
         or claimed_job.provider_mutation_started_at is not null
         or claimed_job.write_resource_kind is not null
         or claimed_job.write_resource_key is not null then
        raise exception 'COUPANG_EXACT_LOCAL_HYDRATION_POSTCONDITION_FAILED'
          using errcode = '55000';
      end if;
    end if;
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.coupang_exact_live_local_hydration', prior_marker, true
    );
    perform pg_catalog.set_config(
      'sellerpilot.coupang_exact_live_local_hydration_release', prior_release, true
    );
    perform pg_catalog.set_config(
      'sellerpilot.coupang_exact_live_local_hydration_egress', prior_egress, true
    );
    raise;
  end;

  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_local_hydration', prior_marker, true
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_local_hydration_release', prior_release, true
  );
  perform pg_catalog.set_config(
    'sellerpilot.coupang_exact_live_local_hydration_egress', prior_egress, true
  );
  return result;
end
$$;

revoke all on function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) to service_role;

comment on function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) is
  'Claims through the existing local executor policy and atomically hydrates only exact Coupang verifier 86d2cb63-d382-4cc9-8153-654cf7ccec80 for GET-only provider execution; source or attestation drift rolls the claim back.';

notify pgrst, 'reload schema';
commit;
