-- General local executor for exact channel/operation/seller/release/egress routes.
-- This migration creates no enabled route and contains no job/product exception.
-- An operator must insert a short-lived attestation row after verifying the
-- deployed release, worker token and provider-registered egress address.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900711000);

do $dependencies$
declare
  outer_claim text;
  scope_claim text;
  serialized_claim text;
begin
  if pg_catalog.to_regprocedure(
       'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_claim_channel_gateway_job(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_approval_revision_is_current(uuid,bigint,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_import_is_current(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.external_detail_source_manifest(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_260826_claim_gateway_unscoped(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_11840_claim_gateway_unsafe(text,text)'
     ) is null
  then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;
  outer_claim := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_channel_gateway_job(text,text)'::regprocedure
  );
  scope_claim := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_260826_claim_gateway_unscoped(text,text)'::regprocedure
  );
  serialized_claim := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11840_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(
       outer_claim,'public.sellerpilot_260826_claim_gateway_unscoped('
     ) = 0
     or pg_catalog.strpos(
       scope_claim,'public.sellerpilot_11840_claim_gateway_unsafe('
     ) = 0
     or pg_catalog.strpos(
       serialized_claim,'public.sellerpilot_11820_claim_gateway_unsafe('
     ) = 0 then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_CLAIM_CHAIN_DRIFT'
      using errcode = '55000';
  end if;
end;
$dependencies$;

create table sellerpilot_private.local_channel_executor_routes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  channel text not null check (channel in ('coupang','smartstore')),
  operation text not null check (
    (channel = 'coupang' and operation in (
      'categories.attributes', 'categories.validate', 'listing.create'
    ))
    or (channel = 'smartstore' and operation = 'listing.create')
  ),
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  worker_token_id uuid not null
    references sellerpilot_private.ai_cli_worker_tokens(id) on delete restrict,
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  egress_ip_sha256 text not null check (egress_ip_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > approved_at and expires_at <= approved_at + interval '90 days'),
  unique (
    owner_id, channel, operation, credential_id, seller_account_key,
    worker_token_id, release_sha, egress_ip_sha256
  )
);

create unique index local_channel_executor_one_active_route_idx
  on sellerpilot_private.local_channel_executor_routes (
    owner_id, channel, operation, credential_id
  ) where enabled;

alter table sellerpilot_private.local_channel_executor_routes enable row level security;
revoke all on sellerpilot_private.local_channel_executor_routes
  from public, anon, authenticated, service_role;

create function sellerpilot_private.local_channel_executor_access(
  p_channel text,
  p_operation text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_channel = 'coupang'
      and p_operation in ('categories.attributes','categories.validate')
      then 'read'
    when p_operation = 'listing.create'
      and p_channel in ('coupang','smartstore')
      then 'write'
    else null
  end
$$;

revoke all on function sellerpilot_private.local_channel_executor_access(text,text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.local_channel_executor_approval_is_current(
  p_product_id uuid,
  p_approval_revision bigint,
  p_content_sha256 text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  product sellerpilot_private.products%rowtype;
  has_revision boolean;
begin
  select * into product
  from sellerpilot_private.products
  where id = p_product_id;
  if product.id is null or product.external_detail_import_id is null then
    return false;
  end if;

  select exists (
    select 1
    from sellerpilot_private.external_detail_approval_revisions revision
    where revision.import_id = product.external_detail_import_id
  ) into has_revision;

  if p_approval_revision is not null or p_content_sha256 is not null then
    return p_approval_revision is not null
      and coalesce(p_content_sha256,'') ~ '^[a-f0-9]{64}$'
      and sellerpilot_private.external_detail_approval_revision_is_current(
        product.external_detail_import_id,
        p_approval_revision,
        p_content_sha256
      );
  end if;

  return not has_revision
    and sellerpilot_private.external_detail_import_is_current(
      product.external_detail_import_id
    );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.local_channel_executor_approval_is_current(uuid,bigint,text)
  from public, anon, authenticated, service_role;

create function sellerpilot_private.local_channel_executor_route_is_current(
  p_owner_id uuid,
  p_channel text,
  p_operation text,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_release_sha text,
  p_egress_ip_sha256 text,
  p_worker_version text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    sellerpilot_private.local_channel_executor_access(p_channel,p_operation)
      is not null
    and coalesce(p_release_sha,'') ~ '^[a-f0-9]{40}$'
    and coalesce(p_egress_ip_sha256,'') ~ '^[a-f0-9]{64}$'
    and coalesce(p_worker_version,'') = 'sellerpilot-cli-worker/1.61+' || p_release_sha
      || '.' || left(p_egress_ip_sha256,11)
    and sellerpilot_private.active_serverless_runtime_release_sha()
      = p_release_sha
    and (
      sellerpilot_private.local_channel_executor_access(p_channel,p_operation)
        = 'read'
      or sellerpilot_private.listing_mutation_release_gate_is_effective(
        p_channel
      )
    )
    and exists (
      select 1
      from sellerpilot_private.local_channel_executor_routes route
      join sellerpilot_private.channel_credentials credential
        on credential.id = route.credential_id
       and credential.id = p_credential_id
       and credential.channel = route.channel
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.last_check_status = 'passed'
       and credential.seller_account_key = route.seller_account_key
       and credential.seller_account_key_source in (
         'provider_certified_v1','credential_incarnation_v1'
       )
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = route.worker_token_id
       and token.id = p_worker_token_id
       and token.scope = 'gateway'
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and token.last_seen_at >= clock_timestamp() - interval '3 minutes'
       and token.last_version = p_worker_version
      where route.owner_id = p_owner_id
        and route.channel = p_channel
        and route.operation = p_operation
        and route.release_sha = p_release_sha
        and route.egress_ip_sha256 = p_egress_ip_sha256
        and route.enabled
        and route.approved_at <= clock_timestamp()
        and route.expires_at > clock_timestamp()
        and exists (
          select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = route.owner_id
        )
        and exists (
          select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = route.approved_by
        )
        and exists (
          select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = credential.created_by
        )
        and exists (
          select 1 from sellerpilot_private.admin_users admin
          where admin.user_id = token.created_by
        )
        and exists (
          select 1
          from sellerpilot_private.serverless_static_egress_policy policy
          where policy.channel = p_channel
            and policy.enabled is false
        )
    )
$$;

revoke all on function
  sellerpilot_private.local_channel_executor_route_is_current(
    uuid,text,text,uuid,uuid,text,text,text
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_local_channel_executor_readiness(
  p_owner_id uuid,
  p_channel text,
  p_operation text,
  p_credential_id uuid,
  p_product_id uuid,
  p_release_sha text,
  p_approval_revision bigint,
  p_content_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  access_mode text;
  route sellerpilot_private.local_channel_executor_routes%rowtype;
  worker_version text;
begin
  if not sellerpilot_private.request_has_unambiguous_service_role_claim() then
    raise exception 'service role required' using errcode = '42501';
  end if;
  access_mode := sellerpilot_private.local_channel_executor_access(
    p_channel,p_operation
  );
  if access_mode is null or coalesce(p_release_sha,'') !~ '^[a-f0-9]{40}$' then
    return null;
  end if;

  select candidate.* into route
  from sellerpilot_private.local_channel_executor_routes candidate
  where candidate.owner_id = p_owner_id
    and candidate.channel = p_channel
    and candidate.operation = p_operation
    and candidate.credential_id = p_credential_id
    and candidate.release_sha = p_release_sha
    and candidate.enabled
    and candidate.expires_at > clock_timestamp()
  order by candidate.approved_at desc
  limit 1;
  if route.id is null then return null; end if;
  worker_version := 'sellerpilot-cli-worker/1.61+' || route.release_sha
    || '.' || left(route.egress_ip_sha256,11);

  if not sellerpilot_private.local_channel_executor_route_is_current(
       p_owner_id,p_channel,p_operation,p_credential_id,
       route.worker_token_id,p_release_sha,route.egress_ip_sha256,worker_version
     ) then
    return null;
  end if;
  if access_mode = 'read' then
    if p_approval_revision is not null
       or p_content_sha256 is not null then
      return null;
    end if;
    if p_product_id is not null and not exists (
      select 1 from sellerpilot_private.products product
      where product.id = p_product_id
        and product.owner_id = p_owner_id
        and not product.demo
        and product.status <> 'archived'
    ) then
      return null;
    end if;
  elsif p_product_id is null
     or not exists (
       select 1 from sellerpilot_private.products product
       where product.id = p_product_id
         and product.owner_id = p_owner_id
         and not product.demo
         and product.status <> 'archived'
     )
     or not sellerpilot_private.local_channel_executor_approval_is_current(
       p_product_id,p_approval_revision,p_content_sha256
     ) then
    return null;
  end if;

  return jsonb_build_object(
    'contract','local_channel_executor_readiness_v1',
    'ready',true,
    'access',access_mode,
    'channel',p_channel,
    'operation',p_operation,
    'credentialId',p_credential_id,
    'productId',p_product_id,
    'releaseSha',p_release_sha,
    'approvalRevision',p_approval_revision,
    'contentSha256',p_content_sha256
  );
end;
$$;

revoke all on function public.sellerpilot_service_local_channel_executor_readiness(
  uuid,text,text,uuid,uuid,text,bigint,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_local_channel_executor_readiness(
  uuid,text,text,uuid,uuid,text,bigint,text
) to service_role;

create function sellerpilot_private.local_channel_executor_job_allowed(
  p_job_id uuid,
  p_credential_id uuid,
  p_worker_token_id uuid,
  p_worker_version text,
  p_release_sha text,
  p_egress_ip_sha256 text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job sellerpilot_private.channel_gateway_jobs%rowtype;
  attempt sellerpilot_private.channel_operation_attempts%rowtype;
  listing sellerpilot_private.product_listings%rowtype;
  binding jsonb;
  approval_revision bigint;
  content_sha256 text;
  access_mode text;
begin
  select * into job
  from sellerpilot_private.channel_gateway_jobs
  where id = p_job_id and credential_id = p_credential_id;
  if job.id is null then return false; end if;
  access_mode := sellerpilot_private.local_channel_executor_access(
    job.channel,job.operation
  );
  if access_mode is null
     or job.environment <> 'production'
     or job.status <> 'queued'
     or job.provider_mutation_started_at is not null
     or job.credential_refresh_in_flight is not false
     or job.credential_refresh_recovery_vault_id is not null
     or job.prepared_credential_id is not null
     or job.oauth_exchange_completed is not false then
    return false;
  end if;

  select * into attempt
  from sellerpilot_private.channel_operation_attempts
  where id = job.attempt_id
    and credential_id = job.credential_id
    and channel = job.channel
    and operation = job.operation
    and status = 'running'
    and remote_id is null;
  if attempt.id is null
     or attempt.seller_account_key is distinct from job.seller_account_key then
    return false;
  end if;
  if not sellerpilot_private.local_channel_executor_route_is_current(
       attempt.owner_id,job.channel,job.operation,job.credential_id,
       p_worker_token_id,p_release_sha,p_egress_ip_sha256,p_worker_version
     ) then
    return false;
  end if;
  if not exists (
    select 1
    from sellerpilot_private.channel_credentials credential
    where credential.id = job.credential_id
      and credential.seller_account_key = job.seller_account_key
  ) then
    return false;
  end if;

  if access_mode = 'read' then
    return job.listing_id is null
      and job.request_payload#>>'{arguments,sellerpilotExternalDetail,importId}'
        is null;
  end if;

  select * into listing
  from sellerpilot_private.product_listings
  where id = job.listing_id
    and owner_id = attempt.owner_id
    and channel_key = job.channel
    and seller_account_key = job.seller_account_key
    and operation_attempt_id = attempt.id;
  if listing.id is null then return false; end if;

  binding := job.request_payload#>'{arguments,sellerpilotExternalDetail}';
  if binding is null
     or binding->>'contract' is distinct from
       'sellerpilot_external_detail_channel_v1'
     or binding->>'productId' is distinct from listing.product_id::text
     or binding->>'ownerId' is distinct from attempt.owner_id::text
     or binding->>'channel' is distinct from job.channel
     or sellerpilot_private.external_detail_source_manifest(job.id) is null then
    return false;
  end if;

  if binding ? 'approvalRevision' or binding ? 'contentSha256' then
    if not (binding ? 'approvalRevision')
       or not (binding ? 'contentSha256')
       or coalesce(binding->>'approvalRevision','') !~ '^[1-9][0-9]*$' then
      return false;
    end if;
    approval_revision := (binding->>'approvalRevision')::bigint;
    content_sha256 := binding->>'contentSha256';
  end if;
  return sellerpilot_private.local_channel_executor_approval_is_current(
    listing.product_id,approval_revision,content_sha256
  );
exception when others then
  return false;
end;
$$;

revoke all on function sellerpilot_private.local_channel_executor_job_allowed(
  uuid,uuid,uuid,text,text,text
) from public, anon, authenticated, service_role;

do $install_claim_filter$
declare
  source text;
  patched text;
  queued_marker constant text := $marker$   where j.status = 'queued'$marker$;
  running_marker constant text := $marker$     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running$marker$;
  guc_marker constant text := 'sellerpilot.local_channel_executor_lane';
  queued_at integer;
  running_relative integer;
  segment text;
  expression text;
  replacement text;
begin
  source := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if pg_catalog.strpos(source,guc_marker) > 0 then
    if (
      pg_catalog.length(source)
      - pg_catalog.length(pg_catalog.replace(source,guc_marker,''))
    ) / pg_catalog.length(guc_marker) <> 2
       or pg_catalog.strpos(source,'local_channel_executor_job_allowed') = 0 then
      raise exception 'LOCAL_CHANNEL_EXECUTOR_CLAIM_POSTIMAGE_DRIFT';
    end if;
    return;
  end if;

  queued_at := pg_catalog.strpos(source,queued_marker);
  if queued_at = 0 then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_CLAIM_WHERE_MISSING';
  end if;
  running_relative := pg_catalog.strpos(
    pg_catalog.substr(source,queued_at),running_marker
  );
  if running_relative = 0 then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_RUNNING_FENCE_MISSING';
  end if;
  segment := pg_catalog.substr(
    source,
    queued_at + pg_catalog.length(queued_marker),
    running_relative - pg_catalog.length(queued_marker) - 1
  );
  if pg_catalog.strpos(segment,'serverless_gateway_job_allowed') = 0
     or pg_catalog.strpos(segment,'sellerpilot.local_gateway_recovery_lane') = 0
     or pg_catalog.strpos(segment,'and not (') = 0 then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_CLAIM_EXCLUSION_DRIFT';
  end if;
  expression := pg_catalog.regexp_replace(segment,'^[[:space:]]+','');
  if pg_catalog.left(expression,4) <> 'and ' then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_CLAIM_EXPRESSION_DRIFT prefix=%',
      pg_catalog.left(expression,40);
  end if;
  expression := pg_catalog.substr(expression,5);
  replacement := $replacement$
     and (
       (
         coalesce(current_setting('sellerpilot.local_channel_executor_lane',true),'') = 'enabled'
         and sellerpilot_private.local_channel_executor_job_allowed(
           j.id,c.id,v_token_id,p_worker_version,
           current_setting('sellerpilot.local_channel_executor_release_sha',true),
           current_setting('sellerpilot.local_channel_executor_egress_sha256',true)
         )
       )
       or (
         coalesce(current_setting('sellerpilot.local_channel_executor_lane',true),'') is distinct from 'enabled'
         and $replacement$ || expression || E'\n       )\n     )';
  patched := pg_catalog.substr(
    source,1,queued_at + pg_catalog.length(queued_marker) - 1
  ) || replacement || pg_catalog.substr(source,queued_at + running_relative - 1);
  execute patched;
  source := pg_catalog.pg_get_functiondef(
    'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure
  );
  if (
       pg_catalog.length(source)
       - pg_catalog.length(pg_catalog.replace(source,guc_marker,''))
     ) / pg_catalog.length(guc_marker) <> 2
     or pg_catalog.strpos(source,'local_channel_executor_job_allowed') = 0
     or pg_catalog.strpos(source,running_marker) = 0 then
    raise exception 'LOCAL_CHANNEL_EXECUTOR_CLAIM_INSTALL_MISMATCH';
  end if;
end;
$install_claim_filter$;

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
  prior_lane text;
  prior_release text;
  prior_egress text;
  result jsonb;
begin
  if coalesce(p_release_sha,'') !~ '^[a-f0-9]{40}$'
     or coalesce(p_egress_ip_sha256,'') !~ '^[a-f0-9]{64}$'
     or p_worker_version is distinct from
       'sellerpilot-cli-worker/1.61+' || p_release_sha
       || '.' || left(p_egress_ip_sha256,11) then
    raise exception 'invalid local channel executor attestation'
      using errcode = '42501';
  end if;
  prior_lane := coalesce(current_setting(
    'sellerpilot.local_channel_executor_lane',true
  ),'');
  prior_release := coalesce(current_setting(
    'sellerpilot.local_channel_executor_release_sha',true
  ),'');
  prior_egress := coalesce(current_setting(
    'sellerpilot.local_channel_executor_egress_sha256',true
  ),'');
  perform pg_catalog.set_config(
    'sellerpilot.local_channel_executor_lane','enabled',true
  );
  perform pg_catalog.set_config(
    'sellerpilot.local_channel_executor_release_sha',p_release_sha,true
  );
  perform pg_catalog.set_config(
    'sellerpilot.local_channel_executor_egress_sha256',p_egress_ip_sha256,true
  );
  begin
    result := public.sellerpilot_claim_channel_gateway_job(
      p_token_hash,p_worker_version
    );
  exception when others then
    perform pg_catalog.set_config(
      'sellerpilot.local_channel_executor_lane',prior_lane,true
    );
    perform pg_catalog.set_config(
      'sellerpilot.local_channel_executor_release_sha',prior_release,true
    );
    perform pg_catalog.set_config(
      'sellerpilot.local_channel_executor_egress_sha256',prior_egress,true
    );
    raise;
  end;
  perform pg_catalog.set_config(
    'sellerpilot.local_channel_executor_lane',prior_lane,true
  );
  perform pg_catalog.set_config(
    'sellerpilot.local_channel_executor_release_sha',prior_release,true
  );
  perform pg_catalog.set_config(
    'sellerpilot.local_channel_executor_egress_sha256',prior_egress,true
  );
  return result;
end;
$$;

revoke all on function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) to service_role;

comment on table sellerpilot_private.local_channel_executor_routes is
  'Bounded operator attestations binding a local worker to one owner, channel operation, credential seller, release and observed egress hash; release, egress, token or credential drift invalidates the route without recurring scripts.';
comment on function public.sellerpilot_claim_local_channel_executor_job(
  text,text,text,text
) is
  'Claims only general local-executor whitelist jobs whose seller, actor, credential, release, egress and external-detail approval are current; the original running and reconciliation fences remain in the inner claimant.';

commit;
