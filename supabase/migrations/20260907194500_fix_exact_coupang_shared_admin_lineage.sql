-- The exact Coupang create was submitted with a credential owned by one admin,
-- while the operation attempt and listing belong to the collaborating admin.
-- Preserve both identities: the verifier continues to run as the credential
-- owner, and the listing remains owned by the attempt owner.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(1637578093, 8072040);

do $preflight$
declare
  v_definition text;
  v_verification_definition text;
  v_source_rows integer;
begin
  if to_regclass('sellerpilot_private.coupang_exact_live_verify_runs') is null
     or to_regclass('sellerpilot_private.coupang_exact_live_verify_receipts') is null then
    raise exception 'exact Coupang reconciliation base migration is missing'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'sellerpilot_private.coupang_exact_live_source_current()'::regprocedure
  ) into strict v_definition;
  if v_definition !~ 'a\.owner_id\s*=\s*j\.created_by'
     and not (
       v_definition ~ 'a\.owner_id\s*<>\s*j\.created_by'
       and v_definition ~ 'credential\.created_by\s*=\s*j\.created_by'
     ) then
    raise exception 'exact Coupang source predicate preimage drifted'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(
    'public.sellerpilot_service_listing_publication_verification_source(text,uuid,uuid)'::regprocedure
  ) into strict v_verification_definition;
  if strpos(v_verification_definition, 'sellerpilot_verification_source_before_coupang_exact_live') = 0
     or strpos(v_verification_definition, 'coupang_exact_live_source_current') = 0
     or strpos(v_verification_definition, '16375780938') = 0 then
    raise exception 'exact Coupang verification source preimage drifted'
      using errcode = '55000';
  end if;

  select
    (select count(*) from sellerpilot_private.channel_gateway_jobs
      where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid)
    + (select count(*) from sellerpilot_private.channel_operation_attempts
      where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid)
    + (select count(*) from sellerpilot_private.product_listings
      where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid)
    into v_source_rows;

  if v_source_rows not in (0, 3) then
    raise exception 'exact Coupang source tuple is partial'
      using errcode = '55000';
  end if;

  if v_source_rows = 3 and not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid
       and attempt.id = job.attempt_id
       and attempt.owner_id <> job.created_by
      join sellerpilot_private.product_listings listing
        on listing.id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
       and listing.id = job.listing_id
       and listing.owner_id = attempt.owner_id
      join sellerpilot_private.channel_credentials credential
        on credential.id = job.credential_id
       and credential.id = attempt.credential_id
       and credential.created_by = job.created_by
       and credential.channel = job.channel
       and credential.environment = job.environment
       and credential.status = 'active'
       and credential.seller_account_key is not distinct from job.seller_account_key
       and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     where job.id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
       and job.channel = 'coupang'
       and job.operation = 'listing.create'
       and job.environment = 'production'
  ) then
    raise exception 'exact Coupang shared-admin lineage is unavailable'
      using errcode = '55000';
  end if;
end
$preflight$;

create or replace function sellerpilot_private.coupang_exact_live_source_current()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  a sellerpilot_private.channel_operation_attempts%rowtype;
  l sellerpilot_private.product_listings%rowtype;
  readback jsonb;
begin
  select * into j from sellerpilot_private.channel_gateway_jobs
   where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5';
  select * into a from sellerpilot_private.channel_operation_attempts
   where id = 'd771421b-f408-4f75-addd-03879393fab8';
  select * into l from sellerpilot_private.product_listings
   where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4';
  select x into readback
    from jsonb_array_elements(coalesce(j.response_payload->'steps', '[]'))
      with ordinality q(x, n)
   where x->>'name' = 'listing-approval-readback'
   order by n desc
   limit 1;

  return j.id is not null and a.id is not null and l.id is not null
    and j.attempt_id = a.id and j.listing_id = l.id
    and j.channel = 'coupang' and j.operation = 'listing.create'
    and j.environment = 'production'
    and j.status = 'reconciliation_required'
    and j.provider_mutation_started_at is not null
    and j.response_payload->>'remoteId' = '16375780938'
    and a.id = 'd771421b-f408-4f75-addd-03879393fab8'
    and a.owner_id <> j.created_by
    and a.credential_id = j.credential_id
    and a.channel = 'coupang' and a.operation = 'listing.create'
    and a.status = 'manual_required'
    and a.remote_id = '16375780938'
    and a.request_fingerprint = j.request_fingerprint
    and a.seller_account_key = j.seller_account_key
    and exists (
      select 1
        from sellerpilot_private.channel_credentials credential
       where credential.id = j.credential_id
         and credential.created_by = j.created_by
         and credential.channel = j.channel
         and credential.environment = j.environment
         and credential.status = 'active'
         and credential.seller_account_key is not distinct from j.seller_account_key
         and (credential.expires_at is null or credential.expires_at > clock_timestamp())
    )
    and l.channel_key = 'coupang'
    and l.product_id = '1ed4acfc-7603-48ec-a638-241131e59358'
    and l.owner_id = a.owner_id and l.operation_attempt_id = a.id
    and l.status = 'failed' and l.failure_class = 'external_action'
    and l.requested_publication_intent = 'live'
    and l.remote_visibility = 'unknown'
    and l.marketplace_sku is null and l.seller_account_key is null
    and l.remote_id = '16375780938'
    and j.request_fingerprint ~ '^[a-f0-9]{64}$'
    and jsonb_array_length(j.request_payload#>'{arguments,body,items}') > 0
    and not exists (
      select 1
        from jsonb_array_elements(j.request_payload#>'{arguments,body,items}') item
       where item->>'externalVendorSku' <> 'AUTO-780720401E2D4E4EA45F'
          or item->>'salePrice' <> '3190'
          or item->>'maximumBuyCount' <> '1'
    )
    and j.request_payload#>>'{arguments,publicationExpectedFingerprint}' = j.request_fingerprint
    and j.request_payload#>>'{arguments,publicationIntent}' = 'live'
    and j.request_payload#>>'{arguments,publicationStateContract}' = 'verified_remote_state_v1'
    and j.request_payload#>>'{arguments,publicationExpectedLocale}' = 'ko-KR'
    and j.request_payload#>>'{arguments,publicationExpectedImageCount}' = '8'
    and jsonb_typeof(j.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}') = 'object'
    and readback->>'status' ~ '^2[0-9][0-9]$'
    and readback#>>'{data,code}' = 'SUCCESS'
    and readback#>>'{data,data,sellerProductId}' = '16375780938'
    and jsonb_array_length(readback#>'{data,data,items}') = 1
    and not exists (
      select 1
        from jsonb_array_elements(readback#>'{data,data,items}') item
       where (
            select count(*)
              from jsonb_array_elements(item->'contents') content
              cross join lateral jsonb_array_elements(content->'contentDetails') detail
             where upper(detail->>'detailType') = 'IMAGE'
               and coalesce(detail->>'content', '') <> ''
          ) <> 8
    );
exception when others then
  return false;
end
$$;

create or replace function public.sellerpilot_service_listing_publication_verification_source(
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
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  s sellerpilot_private.channel_gateway_jobs%rowtype;
  a sellerpilot_private.channel_operation_attempts%rowtype;
  l sellerpilot_private.product_listings%rowtype;
  r sellerpilot_private.coupang_exact_live_verify_runs%rowtype;
  step jsonb;
  payload jsonb;
  binding jsonb;
  ids jsonb;
  roles jsonb;
  vendor_ids jsonb;
begin
  if p_token_hash is null
     or p_job_id is null
     or p_claim_token is null
     or not sellerpilot_private.serverless_cs_job_is_owned(
       p_token_hash,
       p_job_id,
       p_claim_token,
       true
     ) then
    raise exception 'publication verification source ownership required'
      using errcode = '42501';
  end if;

  select * into r
    from sellerpilot_private.coupang_exact_live_verify_runs
   where verifier_job_id = p_job_id;
  select * into j
    from sellerpilot_private.channel_gateway_jobs
   where id = r.verifier_job_id;
  if j.id is null then
    return public.sellerpilot_verification_source_before_coupang_exact_live(
      p_token_hash,
      p_job_id,
      p_claim_token
    );
  end if;

  select * into s from sellerpilot_private.channel_gateway_jobs
   where id = r.source_job_id;
  select * into a from sellerpilot_private.channel_operation_attempts
   where id = r.source_attempt_id;
  select * into l from sellerpilot_private.product_listings
   where id = r.listing_id;

  if j.status <> 'running'
     or j.claim_token is distinct from p_claim_token
     or j.operation <> 'listing.publication.verify'
     or j.attempt_id is not null
     or j.provider_mutation_started_at is not null
     or j.write_resource_kind is not null
     or j.write_resource_key is not null
     or j.request_payload#>>'{arguments,sellerpilotReadOnly}' <> 'true'
     or sellerpilot_private.coupang_exact_live_source_current() is not true
     or encode(extensions.digest(to_jsonb(s)::text, 'sha256'), 'hex')
        <> r.source_job_sha256
     or encode(extensions.digest(to_jsonb(a)::text, 'sha256'), 'hex')
        <> r.source_attempt_sha256
     or encode(extensions.digest(to_jsonb(l)::text, 'sha256'), 'hex')
        <> r.source_listing_sha256 then
    raise exception 'exact Coupang verifier source unavailable'
      using errcode = '55000';
  end if;

  select x into step
    from jsonb_array_elements(s.response_payload->'steps')
      with ordinality q(x, n)
   where x->>'name' = 'listing-approval-readback'
   order by n desc
   limit 1;
  binding := s.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}';
  select jsonb_agg(x->>'publicUrl' order by n),
         jsonb_agg(x->>'role' order by n)
    into ids, roles
    from jsonb_array_elements(binding->'providerTransportImages')
      with ordinality q(x, n);
  select coalesce(
           jsonb_agg(item->>'vendorItemId' order by n)
             filter (where nullif(btrim(item->>'vendorItemId'), '') is not null),
           '[]'::jsonb
         )
    into vendor_ids
    from jsonb_array_elements(step#>'{data,data,items}')
      with ordinality q(item, n);

  payload := s.response_payload || jsonb_build_object(
    'steps', coalesce(s.response_payload->'steps', '[]') || jsonb_build_array(
      jsonb_build_object(
        'name', 'seller-product-publication-readback',
        'ok', true,
        'status', (step->>'status')::int,
        'data', step->'data'
      )
    ),
    'remoteState', jsonb_build_object(
      'resources', jsonb_build_object(
        'sellerProductId', '16375780938',
        'vendorItemIds', vendor_ids
      ),
      'evidence', jsonb_build_object(
        'providerAssignedDescendantIdentityBinding', jsonb_build_object(
          'contract', 'coupang_provider_assigned_vendor_items_v1',
          'sourceJobId', s.id,
          'sellerProductId', '16375780938'
        ),
        'publicationAssetBinding', jsonb_build_object(
          'contract', 'sellerpilot_provider_asset_binding_v1',
          'sourceAssetBindingDigest',
            sellerpilot_private.coupang_exact_live_asset_digest(binding),
          'approvedManifestDigest', binding->>'approvedManifestDigest',
          'approvedDetailPageVersion', (binding->>'approvedDetailPageVersion')::int,
          'approvedDetailRoles', (
            select jsonb_agg(x->>'role' order by n)
              from jsonb_array_elements(binding->'approvedDetailImages')
                with ordinality q(x, n)
          ),
          'providerImageSurface', 'detail_content',
          'providerTransportRoles', roles,
          'providerDetailImageIdentities', ids,
          'providerImageDigest', encode(
            extensions.digest(
              sellerpilot_private.coupang_exact_live_json_array(ids),
              'sha256'
            ),
            'hex'
          )
        )
      )
    )
  );

  return jsonb_build_object(
    'contract', 'listing_publication_verification_source_v1',
    'verificationJobId', j.id,
    'sourceJobId', s.id,
    'sourceOperation', s.operation,
    'sourceArguments', s.request_payload->'arguments',
    'sourceResponsePayload', payload,
    'sourceFingerprint', s.request_fingerprint,
    'expectedRemoteId', '16375780938',
    'expectedLocale', 'ko-KR',
    'expectedImageCount', 8,
    'market', j.request_payload#>>'{arguments,market}',
    'targetId', j.request_payload#>>'{arguments,targetId}'
  );
end
$$;

do $postflight$
declare
  v_source_rows integer;
begin
  select
    (select count(*) from sellerpilot_private.channel_gateway_jobs
      where id = '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid)
    + (select count(*) from sellerpilot_private.channel_operation_attempts
      where id = 'd771421b-f408-4f75-addd-03879393fab8'::uuid)
    + (select count(*) from sellerpilot_private.product_listings
      where id = 'fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid)
    into v_source_rows;

  if v_source_rows = 3
     and sellerpilot_private.coupang_exact_live_source_current() is not true
     and sellerpilot_private.listing_mutation_reconciliation_resolved(
       '25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
     ) is not true then
    raise exception 'exact Coupang shared-admin source predicate remains false'
      using errcode = '55000';
  end if;
end
$postflight$;

revoke all on function sellerpilot_private.coupang_exact_live_source_current()
from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_listing_publication_verification_source(
  text,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_listing_publication_verification_source(
  text,
  uuid,
  uuid
) to service_role;

commit;
