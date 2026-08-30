begin;

-- The first remote-publication ledger accepted an image count above the
-- server-owned expectation. Patch the deployed function body in place so both
-- existing databases and clean migration replays require exact equality.
do $exact_publication_image_count$
declare
  v_definition text;
  v_before constant text :=
    'and v_image_count >= v_expected_image_count';
  v_after constant text :=
    'and v_image_count = v_expected_image_count';
begin
  if pg_catalog.to_regprocedure(
    'sellerpilot_private.apply_verified_remote_listing_completion(uuid,uuid,text,text,text,jsonb,text)'
  ) is null then
    return;
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.apply_verified_remote_listing_completion(uuid,uuid,text,text,text,jsonb,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_before) > 0 then
    execute pg_catalog.replace(v_definition, v_before, v_after);
  elsif pg_catalog.strpos(v_definition, v_after) = 0 then
    raise exception 'verified publication image-count predicate not found';
  end if;
end;
$exact_publication_image_count$;

-- A provider's first live readback is only source evidence. Keep every live
-- create/update paused until a separately leased read-only verifier performs
-- the strict content, language, asset-lineage, identity, and status readback.
do $independent_live_verification_gate$
declare
  v_apply_definition text;
  v_predecessor_definition text;
  v_live_branch_before constant text :=
    'elsif v_visibility = ''live''
        and v_listing.requested_publication_intent = ''live'' then
    update sellerpilot_private.product_listings listing
       set status = ''published'',
           remote_visibility = ''live'',';
  v_live_branch_after constant text :=
    'elsif v_visibility = ''live''
        and v_listing.requested_publication_intent = ''live'' then
    perform pg_catalog.set_config(
      ''sellerpilot.publication_source_pending_job'', p_job_id::text, true
    );
    update sellerpilot_private.product_listings listing
       set status = ''paused'',
           remote_visibility = ''pending_review'',';
  v_published_before constant text :=
    'published_at = coalesce(
             v_prior_published_at,
             v_verified_at
           ),';
  v_published_after constant text := 'published_at = null,';
  v_action_before constant text :=
    'v_action := ''listing_remote_live_verified'';';
  v_action_after constant text :=
    'v_action := ''listing_remote_verification_pending'';';
  v_reconciliation_before constant text :=
    'and v_listing_action not in (
       ''listing_remote_live_verified'',
       ''listing_remote_non_public_verified''
     ) then';
  v_reconciliation_after constant text :=
    'and v_listing_action not in (
       ''listing_remote_live_verified'',
       ''listing_remote_non_public_verified'',
       ''listing_remote_verification_pending''
     ) then';
begin
  if pg_catalog.to_regprocedure(
    'sellerpilot_private.apply_verified_remote_listing_completion(uuid,uuid,text,text,text,jsonb,text)'
  ) is not null then
    select pg_catalog.pg_get_functiondef(
      'sellerpilot_private.apply_verified_remote_listing_completion(uuid,uuid,text,text,text,jsonb,text)'::regprocedure
    ) into v_apply_definition;
    if pg_catalog.strpos(v_apply_definition, v_action_after) = 0 then
      if pg_catalog.strpos(v_apply_definition, v_live_branch_before) = 0
         or pg_catalog.strpos(v_apply_definition, v_published_before) = 0
         or pg_catalog.strpos(v_apply_definition, v_action_before) = 0 then
        raise exception 'direct live publication branch not found';
      end if;
      v_apply_definition := pg_catalog.replace(
        v_apply_definition, v_live_branch_before, v_live_branch_after
      );
      v_apply_definition := pg_catalog.replace(
        v_apply_definition, v_published_before, v_published_after
      );
      v_apply_definition := pg_catalog.replace(
        v_apply_definition, v_action_before, v_action_after
      );
      execute v_apply_definition;
    end if;
  end if;

  if pg_catalog.to_regprocedure(
    'public.sellerpilot_301100_complete_gateway_pre_publication_review(text,uuid,uuid,text,jsonb,text)'
  ) is not null then
    select pg_catalog.pg_get_functiondef(
      'public.sellerpilot_301100_complete_gateway_pre_publication_review(text,uuid,uuid,text,jsonb,text)'::regprocedure
    ) into v_predecessor_definition;
    if pg_catalog.strpos(
      v_predecessor_definition, 'listing_remote_verification_pending'
    ) = 0 then
      if pg_catalog.strpos(
        v_predecessor_definition, v_reconciliation_before
      ) = 0 then
        raise exception 'gateway completion reconciliation predicate not found';
      end if;
      v_predecessor_definition := pg_catalog.replace(
        v_predecessor_definition,
        v_reconciliation_before,
        v_reconciliation_after
      );
      execute v_predecessor_definition;
    end if;
  end if;
end;
$independent_live_verification_gate$;

create or replace function
  sellerpilot_private.listing_publication_source_pending_update_allowed(
    p_old jsonb,
    p_new jsonb,
    p_job_id text
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_state jsonb;
  v_expected_resources jsonb;
  v_verified_at timestamptz;
  v_created_at timestamptz;
begin
  if coalesce(p_job_id, '') !~ '^[0-9a-f-]{36}$' then return false; end if;
  select job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id::uuid
     and job.listing_id = (p_new->>'id')::uuid
     and job.attempt_id = (p_new->>'operation_attempt_id')::uuid
     and job.channel = p_new->>'channel_key'
     and job.operation in ('listing.create', 'listing.update')
     and job.status = 'succeeded'
     and job.response_payload->>'publicationStateContract'
           = 'verified_remote_state_v1'
     and job.response_payload->>'publicationIntent' = 'live'
     and job.response_payload#>>'{remoteState,visibility}' = 'live'
     and job.response_payload#>>'{remoteState,verified}' = 'true'
     and coalesce((job.response_payload->>'ok')::boolean, false)
     and coalesce((job.response_payload->>'publicationFulfilled')::boolean, false);
  if not found then return false; end if;
  v_state := v_job.response_payload->'remoteState';
  begin
    v_verified_at := (v_state->>'verifiedAt')::timestamptz;
    v_created_at := coalesce(
      nullif(v_state->>'createdAt', '')::timestamptz,
      nullif(p_old->>'remote_created_at', '')::timestamptz
    );
  exception when others then
    return false;
  end;
  v_expected_resources := jsonb_build_object(
    'resources', v_state->'resources',
    'verification', jsonb_build_object(
      'verifiedAt', to_jsonb(v_verified_at),
      'evidence', v_state->'evidence',
      'locale', v_state->>'locale',
      'fingerprint', lower(v_state->>'fingerprint'),
      'imageCount', (v_state->>'imageCount')::integer
    )
  );
  return p_new->>'status' = 'paused'
    and p_new->>'requested_publication_intent' = 'live'
    and p_new->>'remote_visibility' = 'pending_review'
    and p_new->>'remote_id' = v_job.response_payload->>'remoteId'
    and p_new->>'provider_status' = v_state->>'providerStatus'
    and p_new->'remote_resources' = v_expected_resources
    and (p_new->>'remote_created_at')::timestamptz is not distinct from v_created_at
    and (p_new->>'last_verified_at')::timestamptz = v_verified_at
    and p_new->'published_at' = 'null'::jsonb
    and p_new->'last_error' = 'null'::jsonb
    and p_new->'failure_class' = 'null'::jsonb
    and p_new->>'seller_account_key' = v_job.seller_account_key
    and p_new - 'status' - 'remote_visibility' - 'provider_status'
          - 'remote_resources' - 'remote_created_at' - 'published_at'
          - 'last_verified_at' - 'last_error' - 'failure_class' - 'updated_at'
      = p_old - 'status' - 'remote_visibility' - 'provider_status'
          - 'remote_resources' - 'remote_created_at' - 'published_at'
          - 'last_verified_at' - 'last_error' - 'failure_class' - 'updated_at';
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.listing_publication_source_pending_update_allowed(
    jsonb, jsonb, text
  ) from public, anon, authenticated, service_role;

do $source_pending_guard_patch$
declare
  v_definition text;
  v_before text := 'begin
  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then';
  v_after text := 'begin
  if nullif(current_setting(''sellerpilot.publication_source_pending_job'', true), '''') is not null then
    if not sellerpilot_private.listing_publication_source_pending_update_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting(''sellerpilot.publication_source_pending_job'', true)
    ) then
      raise exception ''invalid source publication pending update'';
    end if;
    return new;
  end if;

  if nullif(current_setting(''sellerpilot.publication_review_apply'', true), '''') is not null then';
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'sellerpilot.publication_source_pending_job') = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'product listing source-pending guard entry not found';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$source_pending_guard_patch$;

-- Re-declare the small review wrapper instead of patching its comments or
-- formatting. The provider may have observed live, but the immutable source
-- response is deliberately converted to pending_review before registration.
create or replace function public.sellerpilot_complete_channel_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_response_payload jsonb default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text;
  v_completed boolean;
begin
  select job.operation
    into v_operation
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token;

  v_completed := public.sellerpilot_301100_complete_gateway_pre_publication_review(
    p_token_hash, p_job_id, p_claim_token, p_status,
    p_response_payload, p_error_message
  );
  if v_completed is not true or v_operation is null then return v_completed; end if;

  if v_operation in ('listing.create', 'listing.update') then
    update sellerpilot_private.channel_gateway_jobs job
       set response_payload = jsonb_set(
             jsonb_set(
               jsonb_set(
                 job.response_payload,
                 '{remoteState,visibility}',
                 '"pending_review"'::jsonb,
                 false
               ),
               '{remoteState,evidence,providerObservedVisibility}',
               '"live"'::jsonb,
               true
             ),
             '{publicationFulfilled}',
             'false'::jsonb,
             true
           ),
           updated_at = clock_timestamp()
     where job.id = p_job_id
       and job.status = 'succeeded'
       and job.response_payload->>'publicationIntent' = 'live'
       and job.response_payload#>>'{remoteState,visibility}' = 'live';
    perform sellerpilot_private.register_pending_listing_publication_review(
      p_job_id
    );
  elsif v_operation = 'listing.publication.verify' then
    perform sellerpilot_private.apply_listing_publication_verifier_completion(
      p_job_id
    );
  end if;
  return true;
end;
$$;

revoke all on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.sellerpilot_complete_channel_gateway_job(
  text, uuid, uuid, text, jsonb, text
) to service_role;

-- The review ledger must not promote a status-only readback. Bind its terminal
-- state to the immutable source job plus exact localized content and image
-- projection digests emitted by the read-only executor.
do $publication_content_gate$
declare
  v_definition text;
  v_before constant text :=
    'and v_state#>>''{evidence,imageCountVerified}'' = ''true''';
  v_after constant text :=
    'and v_state#>>''{evidence,imageCountVerified}'' = ''true''
      and v_state#>>''{evidence,contentVerified}'' = ''true''
      and v_state#>>''{evidence,sourceContentVerified}'' = ''true''
      and v_state#>>''{evidence,languageContentVerified}'' = ''true''
      and v_state#>>''{evidence,titleLanguageVerified}'' = ''true''
      and v_state#>>''{evidence,descriptionLanguageVerified}'' = ''true''
      and v_state#>>''{evidence,detailImageCountVerified}'' = ''true''
      and v_state#>>''{evidence,approvedManifestDigestVerified}'' = ''true''
      and v_state#>>''{evidence,sourceIdentityVerified}'' = ''true''
      and v_state#>>''{evidence,contentDigestVerified}'' = ''true''
      and v_state#>>''{evidence,sourceJobId}'' = v_review.source_job_id::text
      and v_state#>>''{evidence,sourceOperation}'' in (
        ''listing.create'', ''listing.update''
      )
      and v_state#>>''{evidence,sourceContentDigest}'' ~ ''^[a-f0-9]{64}$''
      and v_state#>>''{evidence,remoteContentDigest}'' =
            v_state#>>''{evidence,sourceContentDigest}''
      and v_state#>>''{evidence,sourceImageDigest}'' ~ ''^[a-f0-9]{64}$''
      and v_state#>>''{evidence,remoteImageDigest}'' =
            v_state#>>''{evidence,sourceImageDigest}''
      and v_state#>>''{evidence,remoteProjectionDigest}'' =
            v_state#>>''{evidence,remoteContentDigest}''
      and v_state#>>''{evidence,providerImageSurface}'' in (
        ''detail_content'', ''gallery''
      )';
begin
  if pg_catalog.to_regprocedure(
    'sellerpilot_private.apply_listing_publication_verifier_completion(uuid)'
  ) is null then
    return;
  end if;
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.apply_listing_publication_verifier_completion(uuid)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, 'sourceContentVerified') = 0 then
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'publication verifier evidence predicate not found';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end if;
end;
$publication_content_gate$;

-- Persist the exact public URL emitted by the trusted Storage client. A path
-- that merely looks content-addressed on an attacker-controlled host is not
-- evidence for the bytes registered by the source attempt.
alter table sellerpilot_private.products
  drop constraint if exists products_detail_page_approval_check;
alter table sellerpilot_private.products
  add constraint products_detail_page_approval_check check (
    (
      detail_page_approved_version = 0
      and detail_page_image_manifest is null
    )
    or (
      detail_page_data is not null
      and detail_page_version > 0
      and detail_page_approved_version = detail_page_version
      and jsonb_typeof(detail_page_image_manifest) = 'object'
      and detail_page_image_manifest->>'contract' in (
        'sellerpilot_detail_image_manifest_v1',
        'sellerpilot_detail_image_manifest_v2'
      )
      and detail_page_image_manifest->>'algorithm' = 'sha256'
      and detail_page_image_manifest->>'digest' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(detail_page_image_manifest->'images') = 'array'
      and jsonb_array_length(detail_page_image_manifest->'images') = 8
    )
  );

-- The Studio worker computes these digests from the exact generated PNG
-- bytes before upload. New successful Studio results cannot omit or relabel
-- that complete 16-asset digest ledger. Legacy succeeded rows remain readable
-- but cannot produce a v2 publication manifest until regenerated.
create or replace function sellerpilot_private.guard_product_studio_asset_sha256s()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths jsonb;
  v_digests jsonb;
  v_old_digests jsonb;
  v_path_count integer;
  v_digest_count integer;
  v_old_digest_count integer;
  v_regeneration_job_id uuid;
  v_regeneration record;
  v_expected_result jsonb;
begin
  if new.kind <> 'product_studio'
     or new.status <> 'succeeded'
     or (
       tg_op = 'UPDATE'
       and old.status = 'succeeded'
       and new.result_payload is not distinct from old.result_payload
     ) then
    return new;
  end if;
  v_paths := new.result_payload->'asset_storage_paths';
  v_digests := new.result_payload->'asset_storage_sha256s';
  v_old_digests := case when tg_op = 'UPDATE'
    then coalesce(old.result_payload->'asset_storage_sha256s', '{}'::jsonb)
    else '{}'::jsonb end;
  v_path_count := case when jsonb_typeof(v_paths) = 'object'
    then (select count(*) from jsonb_object_keys(v_paths)) else 0 end;
  v_digest_count := case when jsonb_typeof(v_digests) = 'object'
    then (select count(*) from jsonb_object_keys(v_digests)) else 0 end;
  v_old_digest_count := case when jsonb_typeof(v_old_digests) = 'object'
    then (select count(*) from jsonb_object_keys(v_old_digests)) else 0 end;

  -- A row that first becomes succeeded is produced by the current Studio
  -- worker and must be complete immediately. Existing succeeded rows predate
  -- this ledger, so their exact immutable path map may accumulate hashes only
  -- monotonically as individually regenerated assets are proven.
  if jsonb_typeof(v_paths) <> 'object'
     or jsonb_typeof(v_digests) <> 'object'
     or v_path_count <> 16
     or v_digest_count not between 1 and 16
     or exists (
       select 1
         from jsonb_each_text(v_paths) path_entry
        where path_entry.value !~ '^results/[0-9a-f-]{36}/claims/[0-9a-f-]{36}/[a-z0-9-]+[.]png$'
     )
     or exists (
       select 1
         from jsonb_object_keys(v_digests) digest_key
         where not (v_paths ? digest_key)
            or v_digests->>digest_key !~ '^[a-f0-9]{64}$'
     )
     or (
       (tg_op = 'INSERT' or old.status <> 'succeeded')
       and v_digest_count <> 16
     )
     then
    raise exception 'product studio asset SHA-256 ledger invalid';
  end if;

  if tg_op = 'UPDATE' and old.status = 'succeeded' then
    if new.result_payload - 'asset_storage_sha256s'
         is not distinct from old.result_payload - 'asset_storage_sha256s' then
      if jsonb_typeof(v_old_digests) <> 'object'
         or not (v_old_digests <@ v_digests)
         or v_digest_count <= v_old_digest_count then
        raise exception 'product studio asset SHA-256 ledger invalid';
      end if;
    else
      begin
        v_regeneration_job_id := nullif(pg_catalog.current_setting(
          'sellerpilot.asset_sha_merge_job', true
        ), '')::uuid;
      exception when others then
        v_regeneration_job_id := null;
      end;
      select job.request_payload, job.result_payload, job.created_by
        into v_regeneration
        from sellerpilot_private.ai_cli_jobs job
       where job.id = v_regeneration_job_id
         and job.kind = 'product_asset_regeneration'
         and job.status = 'succeeded'
         and (job.request_payload->>'source_job_id')::uuid = new.id
         and job.created_by = new.created_by;
      if not found then
        raise exception 'product studio asset regeneration ledger invalid';
      end if;
      v_expected_result := jsonb_set(
        jsonb_set(
          jsonb_set(
            old.result_payload,
            '{asset_storage_sha256s}',
            v_old_digests,
            true
          ),
          array['asset_storage_paths', v_regeneration.request_payload->>'asset_id'],
          to_jsonb(v_regeneration.result_payload#>>array[
            'asset_storage_paths', v_regeneration.request_payload->>'asset_id'
          ]),
          true
        ),
        array['asset_storage_sha256s', v_regeneration.request_payload->>'asset_id'],
        to_jsonb(v_regeneration.result_payload#>>array[
          'asset_storage_sha256s', v_regeneration.request_payload->>'asset_id'
        ]),
        true
      );
      if new.result_payload is distinct from v_expected_result then
        raise exception 'product studio asset regeneration ledger invalid';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_product_studio_asset_sha256s
  on sellerpilot_private.ai_cli_jobs;
create trigger guard_product_studio_asset_sha256s
before insert or update of status, result_payload
on sellerpilot_private.ai_cli_jobs
for each row execute function
  sellerpilot_private.guard_product_studio_asset_sha256s();

revoke all on function sellerpilot_private.guard_product_studio_asset_sha256s()
  from public, anon, authenticated, service_role;

create or replace function sellerpilot_private.merge_regenerated_asset_sha256()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id text;
  v_source_job_id uuid;
  v_asset_path text;
  v_digest text;
begin
  if new.kind <> 'product_asset_regeneration'
     or new.status <> 'succeeded'
     or (tg_op = 'UPDATE' and old.status = 'succeeded') then
    return new;
  end if;
  v_asset_id := new.request_payload->>'asset_id';
  v_source_job_id := (new.request_payload->>'source_job_id')::uuid;
  v_asset_path := new.result_payload#>>array['asset_storage_paths', v_asset_id];
  v_digest := new.result_payload#>>array['asset_storage_sha256s', v_asset_id];
  if coalesce(v_asset_id, '') = ''
     or coalesce(v_asset_path, '') !~ '^results/[0-9a-f-]{36}/claims/[0-9a-f-]{36}/[a-z0-9-]+[.]png$'
     or v_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'regenerated asset SHA-256 ledger invalid';
  end if;
  perform pg_catalog.set_config(
    'sellerpilot.asset_sha_merge_job', new.id::text, true
  );
  update sellerpilot_private.ai_cli_jobs source
     set result_payload = jsonb_set(
           jsonb_set(
             jsonb_set(
               coalesce(source.result_payload, '{}'::jsonb),
               '{asset_storage_sha256s}',
               coalesce(source.result_payload->'asset_storage_sha256s', '{}'::jsonb),
               true
             ),
             array['asset_storage_paths', v_asset_id],
             to_jsonb(v_asset_path),
             true
           ),
           array['asset_storage_sha256s', v_asset_id],
           to_jsonb(v_digest),
           true
         ),
         updated_at = clock_timestamp()
   where source.id = v_source_job_id
     and source.kind = 'product_studio'
     and source.status = 'succeeded';
  if not found then raise exception 'source Studio SHA-256 ledger update failed'; end if;
  return new;
end;
$$;

drop trigger if exists merge_regenerated_asset_sha256
  on sellerpilot_private.ai_cli_jobs;
create trigger merge_regenerated_asset_sha256
after insert or update of status
on sellerpilot_private.ai_cli_jobs
for each row execute function
  sellerpilot_private.merge_regenerated_asset_sha256();

revoke all on function sellerpilot_private.merge_regenerated_asset_sha256()
  from public, anon, authenticated, service_role;

create or replace function
  public.sellerpilot_service_bind_product_detail_page_source_digests(
    p_product_id uuid,
    p_owner_id uuid,
    p_version bigint,
    p_prior_manifest_digest text,
    p_images jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_paths jsonb;
  v_digests jsonb;
  v_image jsonb;
  v_prior_image jsonb;
  v_index integer;
  v_input text := '';
  v_digest text;
  v_manifest jsonb;
begin
  if p_product_id is null
     or p_owner_id is null
     or p_version < 1
     or coalesce(p_prior_manifest_digest, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_images) <> 'array'
     or jsonb_array_length(p_images) <> 8
     or (
       select count(distinct image->>'role') <> 8
          or count(distinct image->>'path') <> 8
          or count(distinct image->>'sourceSha256') <> 8
          or bool_or(
            image->>'sourceSha256' !~ '^[a-f0-9]{64}$'
            or not sellerpilot_private.detail_page_asset_path_is_valid(
              image->>'role', image->>'path'
            )
          )
         from jsonb_array_elements(p_images) image
     ) then
    raise exception 'detail page source digest binding invalid';
  end if;

  select product.id, product.ai_job_id, product.detail_page_version,
         product.detail_page_approved_version,
         product.detail_page_image_manifest,
         job.result_payload->'asset_storage_paths' as storage_paths,
         job.result_payload->'asset_storage_sha256s' as storage_digests
    into v_product
    from sellerpilot_private.products product
    join sellerpilot_private.ai_cli_jobs job
      on job.id = product.ai_job_id
     and job.kind = 'product_studio'
     and job.status = 'succeeded'
     and job.created_by = product.owner_id
   where product.id = p_product_id
     and product.owner_id = p_owner_id
     and not product.demo
   for update of product;
  if not found
     or v_product.detail_page_version <> p_version
     or v_product.detail_page_approved_version <> p_version
     or v_product.detail_page_image_manifest->>'contract'
          <> 'sellerpilot_detail_image_manifest_v1'
     or v_product.detail_page_image_manifest->>'digest'
          <> p_prior_manifest_digest
     or jsonb_typeof(v_product.storage_paths) <> 'object'
     or jsonb_typeof(v_product.storage_digests) <> 'object'
     or (select count(*) from jsonb_object_keys(v_product.storage_paths)) <> 16
     or (select count(*) from jsonb_object_keys(v_product.storage_digests)) <> 16
     or exists (
       select 1
         from jsonb_object_keys(v_product.storage_paths) path_key
        where not (v_product.storage_digests ? path_key)
           or v_product.storage_digests->>path_key !~ '^[a-f0-9]{64}$'
     ) then
    raise exception 'detail page source digest context unavailable';
  end if;
  v_paths := v_product.storage_paths;
  v_digests := v_product.storage_digests;

  for v_index in 0..7 loop
    v_image := p_images->v_index;
    v_prior_image := v_product.detail_page_image_manifest->'images'->v_index;
    if (v_image::jsonb)->>'role' <> (v_prior_image::jsonb)->>'role'
       or (v_image::jsonb)->>'path' <> (v_prior_image::jsonb)->>'path'
       or v_paths->>((v_image::jsonb)->>'role') <> (v_image::jsonb)->>'path'
       or v_digests->>((v_image::jsonb)->>'role') <> (v_image::jsonb)->>'sourceSha256'
       or not exists (
         select 1
           from storage.objects stored
          where stored.bucket_id = 'sellerpilot-ai'
            and stored.name = (v_image::jsonb)->>'path'
       ) then
      raise exception 'detail page source digest does not match Studio ledger';
    end if;
    if v_index > 0 then v_input := v_input || chr(10); end if;
    v_input := v_input || ((v_image::jsonb)->>'role') || chr(9)
      || ((v_image::jsonb)->>'path') || chr(9)
      || ((v_image::jsonb)->>'sourceSha256');
  end loop;
  v_digest := encode(extensions.digest(v_input, 'sha256'), 'hex');
  v_manifest := jsonb_build_object(
    'contract', 'sellerpilot_detail_image_manifest_v2',
    'algorithm', 'sha256',
    'digest', v_digest,
    'images', p_images
  );
  update sellerpilot_private.products product
     set detail_page_image_manifest = v_manifest,
         updated_at = clock_timestamp()
   where product.id = p_product_id
     and product.detail_page_version = p_version
     and product.detail_page_approved_version = p_version
     and product.detail_page_image_manifest->>'digest'
           = p_prior_manifest_digest;
  if not found then raise exception 'detail page source digest binding raced'; end if;
  return v_manifest;
end;
$$;

revoke all on function
  public.sellerpilot_service_bind_product_detail_page_source_digests(
    uuid, uuid, bigint, text, jsonb
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_bind_product_detail_page_source_digests(
    uuid, uuid, bigint, text, jsonb
  ) to service_role;

alter table if exists sellerpilot_private.marketplace_normalized_asset_refs
  add column if not exists canonical_public_url text,
  add column if not exists source_object_path text,
  add column if not exists source_content_sha256 text;

create or replace function
  public.sellerpilot_service_bind_marketplace_normalized_asset_urls(
    p_attempt_id uuid,
    p_assets jsonb
  )
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected integer;
  v_updated integer;
begin
  if p_attempt_id is null
     or jsonb_typeof(p_assets) <> 'array'
     or jsonb_array_length(p_assets) not between 1 and 32 then
    raise exception 'normalized asset URL binding invalid';
  end if;

  v_expected := jsonb_array_length(p_assets);
  if (
    select count(*) <> v_expected
       or count(distinct (asset::jsonb)->>'objectPath') <> v_expected
       or count(distinct (asset::jsonb)->>'publicUrl') <> v_expected
       or bool_or(
         (asset::jsonb)->>'objectPath' !~ '^normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
         or (asset::jsonb)->>'contentSha256' !~ '^[0-9a-f]{64}$'
         or ((asset::jsonb)->>'objectPath') <>
              ('normalized/' || left(((asset::jsonb)->>'contentSha256'), 2) || '/'
                || ((asset::jsonb)->>'contentSha256') || '.jpg')
         or (asset::jsonb)->>'publicUrl' !~
              '^https://[a-z0-9-]+\.supabase\.(co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
         or substring(
              (asset::jsonb)->>'publicUrl'
              from '/storage/v1/object/public/sellerpilot-marketplace/(normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg)$'
          ) <> (asset::jsonb)->>'objectPath'
         or (((asset::jsonb) ? 'sourceObjectPath')
               <> ((asset::jsonb) ? 'sourceSha256'))
         or (
           (asset::jsonb) ? 'sourceObjectPath'
           and (
             (asset::jsonb)->>'sourceObjectPath' !~
               '^results/[0-9a-f-]{36}/claims/[0-9a-f-]{36}/[a-z0-9-]+[.]png$'
             or (asset::jsonb)->>'sourceSha256' !~ '^[a-f0-9]{64}$'
           )
         )
       )
      from jsonb_array_elements(p_assets) as provided_asset(asset)
  ) then
    raise exception 'normalized asset URL binding invalid';
  end if;

  with provided as (
    select (asset::jsonb)->>'objectPath' as object_path,
           (asset::jsonb)->>'contentSha256' as content_sha256,
           (asset::jsonb)->>'publicUrl' as public_url,
           (asset::jsonb)->>'sourceObjectPath' as source_object_path,
           (asset::jsonb)->>'sourceSha256' as source_sha256
      from jsonb_array_elements(p_assets) as provided_asset(asset)
  )
  update sellerpilot_private.marketplace_normalized_asset_refs ref
     set canonical_public_url = provided.public_url,
         source_object_path = coalesce(
           provided.source_object_path, ref.source_object_path
         ),
         source_content_sha256 = coalesce(
           provided.source_sha256, ref.source_content_sha256
         ),
         updated_at = clock_timestamp()
    from provided
    join sellerpilot_private.marketplace_normalized_assets normalized
      on normalized.object_path = provided.object_path
     and normalized.content_sha256 = provided.content_sha256
     and normalized.status = 'available'
   where ref.attempt_id = p_attempt_id
     and ref.object_path = provided.object_path
     and ref.upload_confirmed_at is not null
     and (
       ref.canonical_public_url is null
       or ref.canonical_public_url = provided.public_url
     )
     and (
       provided.source_object_path is null
       or (
         (ref.source_object_path is null
           or ref.source_object_path = provided.source_object_path)
         and (ref.source_content_sha256 is null
           or ref.source_content_sha256 = provided.source_sha256)
       )
     );
  get diagnostics v_updated = row_count;
  if exists (
    select 1
      from (
        select (asset::jsonb)->>'objectPath' as object_path,
               (asset::jsonb)->>'sourceObjectPath' as source_object_path,
               (asset::jsonb)->>'sourceSha256' as source_sha256
          from jsonb_array_elements(p_assets) as provided_asset(asset)
      ) provided
      join sellerpilot_private.marketplace_normalized_asset_refs ref
        on ref.attempt_id = p_attempt_id
       and ref.object_path = provided.object_path
     where provided.source_object_path is not null
       and (
         ref.source_object_path is distinct from provided.source_object_path
         or ref.source_content_sha256 is distinct from provided.source_sha256
       )
  ) then
    raise exception 'normalized asset source lineage mismatch';
  end if;
  if v_updated <> v_expected then
    raise exception 'normalized asset URL binding scope mismatch';
  end if;
  return true;
end;
$$;

revoke all on function
  public.sellerpilot_service_bind_marketplace_normalized_asset_urls(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_bind_marketplace_normalized_asset_urls(uuid, jsonb)
  to service_role;

create or replace function
  sellerpilot_private.listing_publication_asset_binding_is_current(
    p_binding jsonb,
    p_manifest jsonb,
    p_approved_version bigint,
    p_attempt_id uuid
  )
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_approved jsonb;
  v_transport jsonb;
  v_manifest_image jsonb;
  v_index integer;
  v_approved_roles text[] := array[]::text[];
  v_approved_urls text[] := array[]::text[];
  v_approved_paths text[] := array[]::text[];
  v_approved_source_digests text[] := array[]::text[];
  v_approved_digests text[] := array[]::text[];
  v_transport_roles text[] := array[]::text[];
  v_transport_urls text[] := array[]::text[];
  v_transport_paths text[] := array[]::text[];
  v_transport_digests text[] := array[]::text[];
begin
  if jsonb_typeof(p_binding) <> 'object'
     or jsonb_typeof(p_manifest) <> 'object'
     or p_binding->>'contract' <> 'sellerpilot_publication_asset_binding_v1'
     or p_manifest->>'contract' <> 'sellerpilot_detail_image_manifest_v2'
     or p_binding->>'approvedManifestDigest' <> p_manifest->>'digest'
     or p_binding->>'approvedDetailPageVersion' <> p_approved_version::text
     or jsonb_typeof(p_binding->'approvedDetailImages') <> 'array'
     or jsonb_typeof(p_binding->'providerTransportImages') <> 'array'
     or jsonb_typeof(p_manifest->'images') <> 'array'
     or jsonb_array_length(p_binding->'approvedDetailImages') <> 8
     or jsonb_array_length(p_binding->'providerTransportImages') <> 8
     or jsonb_array_length(p_manifest->'images') <> 8
     or p_binding->>'providerImageSurface' not in ('detail_content', 'gallery') then
    return false;
  end if;

  for v_index in 0..7 loop
    v_approved := p_binding->'approvedDetailImages'->v_index;
    v_transport := p_binding->'providerTransportImages'->v_index;
    v_manifest_image := p_manifest->'images'->v_index;
    if (v_approved->>'role') <> (v_manifest_image->>'role')
       or (v_approved->>'approvedObjectPath') <> (v_manifest_image->>'path')
       or (v_approved->>'approvedSourceSha256') <>
            (v_manifest_image->>'sourceSha256')
       or v_approved->>'approvedSourceSha256' !~ '^[a-f0-9]{64}$'
       or (v_approved->>'role') !~ '^detail-[a-z0-9-]+$'
       or (v_approved->>'objectPath') <>
            ('normalized/' || left((v_approved->>'contentSha256'), 2) || '/'
              || (v_approved->>'contentSha256') || '.jpg')
       or v_approved->>'contentSha256' !~ '^[0-9a-f]{64}$'
       or v_approved->>'publicUrl' !~
            '^https://[a-z0-9-]+\.supabase\.(co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
       or substring(
            v_approved->>'publicUrl'
            from '/storage/v1/object/public/sellerpilot-marketplace/(normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg)$'
          ) <> v_approved->>'objectPath'
       or (v_transport->>'objectPath') <>
            ('normalized/' || left((v_transport->>'contentSha256'), 2) || '/'
              || (v_transport->>'contentSha256') || '.jpg')
       or v_transport->>'contentSha256' !~ '^[0-9a-f]{64}$'
       or v_transport->>'publicUrl' !~
            '^https://[a-z0-9-]+\.supabase\.(co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
       or substring(
            v_transport->>'publicUrl'
            from '/storage/v1/object/public/sellerpilot-marketplace/(normalized/[0-9a-f]{2}/[0-9a-f]{64}\.jpg)$'
          ) <> v_transport->>'objectPath'
       or v_approved->>'role' = any(v_approved_roles)
       or v_approved->>'publicUrl' = any(v_approved_urls)
       or v_approved->>'objectPath' = any(v_approved_paths)
       or v_approved->>'contentSha256' = any(v_approved_digests)
       or v_approved->>'approvedSourceSha256' = any(v_approved_source_digests)
       or v_transport->>'role' = any(v_transport_roles)
       or v_transport->>'publicUrl' = any(v_transport_urls)
       or v_transport->>'objectPath' = any(v_transport_paths)
       or v_transport->>'contentSha256' = any(v_transport_digests)
       or not exists (
         select 1
           from sellerpilot_private.marketplace_normalized_asset_refs ref
           join sellerpilot_private.marketplace_normalized_assets normalized
             on normalized.object_path = ref.object_path
          where ref.attempt_id = p_attempt_id
            and ref.object_path = v_approved->>'objectPath'
            and ref.upload_confirmed_at is not null
            and ref.canonical_public_url = v_approved->>'publicUrl'
            and ref.source_object_path = v_approved->>'approvedObjectPath'
            and ref.source_content_sha256 =
                  v_approved->>'approvedSourceSha256'
            and normalized.status = 'available'
            and normalized.content_sha256 = v_approved->>'contentSha256'
       )
       or not exists (
         select 1
           from sellerpilot_private.marketplace_normalized_asset_refs ref
           join sellerpilot_private.marketplace_normalized_assets normalized
             on normalized.object_path = ref.object_path
          where ref.attempt_id = p_attempt_id
            and ref.object_path = v_transport->>'objectPath'
            and ref.upload_confirmed_at is not null
            and ref.canonical_public_url = v_transport->>'publicUrl'
            and normalized.status = 'available'
            and normalized.content_sha256 = v_transport->>'contentSha256'
       ) then
      return false;
    end if;
    v_approved_roles := array_append(v_approved_roles, v_approved->>'role');
    v_approved_urls := array_append(v_approved_urls, v_approved->>'publicUrl');
    v_approved_paths := array_append(v_approved_paths, v_approved->>'objectPath');
    v_approved_source_digests := array_append(
      v_approved_source_digests, v_approved->>'approvedSourceSha256'
    );
    v_approved_digests := array_append(v_approved_digests, v_approved->>'contentSha256');
    v_transport_roles := array_append(v_transport_roles, v_transport->>'role');
    v_transport_urls := array_append(v_transport_urls, v_transport->>'publicUrl');
    v_transport_paths := array_append(v_transport_paths, v_transport->>'objectPath');
    v_transport_digests := array_append(v_transport_digests, v_transport->>'contentSha256');
  end loop;

  if p_binding->>'providerImageSurface' = 'detail_content' then
    return v_transport_roles = v_approved_roles
      and v_transport_urls = v_approved_urls
      and v_transport_paths = v_approved_paths
      and v_transport_digests = v_approved_digests;
  end if;
  return v_transport_roles[1] = 'gallery-representative'
    and v_transport_roles[2:8] = v_approved_roles[1:7]
    and v_transport_urls[2:8] = v_approved_urls[1:7]
    and v_transport_paths[2:8] = v_approved_paths[1:7]
    and v_transport_digests[2:8] = v_approved_digests[1:7];
end;
$$;

revoke all on function
  sellerpilot_private.listing_publication_asset_binding_is_current(
    jsonb, jsonb, bigint, uuid
  ) from public, anon, authenticated;

-- A publication verifier needs the exact immutable request that originally
-- produced the pending-review listing. Keep that large body out of the queued
-- verifier payload and reveal it only to the currently leased service worker.
create function public.sellerpilot_service_listing_publication_verification_source(
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
  v_source jsonb;
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

  select jsonb_build_object(
           'contract', 'listing_publication_verification_source_v1',
           'verificationJobId', verifier.id,
           'sourceJobId', source_job.id,
           'sourceOperation', source_job.operation,
           'sourceArguments', source_job.request_payload->'arguments',
           'sourceResponsePayload', source_job.response_payload,
           'sourceFingerprint', source_job.request_fingerprint,
           'expectedRemoteId', review.expected_remote_id,
           'expectedLocale', review.expected_locale,
           'expectedImageCount', review.expected_image_count,
           'market', review.market,
           'targetId', review.target_id
         )
    into v_source
    from sellerpilot_private.channel_gateway_jobs verifier
    join sellerpilot_private.listing_publication_reviews review
      on review.listing_id = verifier.listing_id
     and review.last_job_id = verifier.id
    join sellerpilot_private.channel_gateway_jobs source_job
      on source_job.id = review.source_job_id
    join sellerpilot_private.products product
      on product.id = review.product_id
     and product.owner_id = review.owner_id
   where verifier.id = p_job_id
     and verifier.claim_token = p_claim_token
     and verifier.status = 'running'
     and verifier.operation = 'listing.publication.verify'
     and verifier.attempt_id is null
     and verifier.provider_mutation_started_at is null
     and verifier.write_resource_kind is null
     and verifier.write_resource_key is null
     and review.status = 'verifying'
     and review.source_job_id =
           (verifier.request_payload#>>'{arguments,publicationReviewSourceJobId}')::uuid
     and verifier.request_payload#>>'{arguments,sellerpilotReadOnly}' = 'true'
     and verifier.request_payload#>>'{arguments,publicationIntent}' = 'live'
     and verifier.request_payload#>>'{arguments,publicationStateContract}' =
           'verified_remote_state_v1'
     and verifier.request_payload#>>'{arguments,remoteId}' =
           review.expected_remote_id
     and verifier.request_payload#>>'{arguments,publicationExpectedLocale}' =
           review.expected_locale
     and verifier.request_payload#>>'{arguments,publicationExpectedFingerprint}' =
           review.expected_fingerprint
     and verifier.request_payload#>>'{arguments,publicationExpectedImageCount}' = '8'
     and source_job.operation in ('listing.create', 'listing.update')
     and source_job.status = 'succeeded'
     and source_job.request_fingerprint = review.expected_fingerprint
     and jsonb_typeof(source_job.request_payload->'arguments') = 'object'
     and jsonb_typeof(source_job.response_payload) = 'object'
     and product.detail_page_approved_version = product.detail_page_version
     and jsonb_typeof(product.detail_page_image_manifest) = 'object'
     and sellerpilot_private.listing_publication_asset_binding_is_current(
           source_job.request_payload#>'{arguments,sellerpilotPublicationAssetBinding}',
           product.detail_page_image_manifest,
           product.detail_page_approved_version,
           source_job.attempt_id
         )
     and source_job.response_payload#>>'{remoteState,evidence,publicationAssetBinding,contract}' =
           'sellerpilot_provider_asset_binding_v1'
     and source_job.response_payload#>>'{remoteState,evidence,publicationAssetBinding,approvedManifestDigest}' =
           product.detail_page_image_manifest->>'digest'
     and source_job.response_payload#>>'{remoteState,evidence,publicationAssetBinding,approvedDetailPageVersion}' =
           product.detail_page_approved_version::text
     and jsonb_array_length(
           source_job.response_payload#>'{remoteState,evidence,publicationAssetBinding,providerDetailImageIdentities}'
         ) = 8
     and sellerpilot_private.listing_publication_review_is_current(
           review.listing_id
         );

  if v_source is null then
    raise exception 'publication verification source is unavailable'
      using errcode = '55000';
  end if;
  return v_source;
end;
$$;

revoke all on function
  public.sellerpilot_service_listing_publication_verification_source(
    text, uuid, uuid
  ) from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_listing_publication_verification_source(
    text, uuid, uuid
  ) to service_role;

comment on function
  public.sellerpilot_service_listing_publication_verification_source(
    text, uuid, uuid
  ) is
  'Returns an exact source mutation request only to the live, owned, read-only publication verifier lease.';

comment on function
  public.sellerpilot_service_bind_marketplace_normalized_asset_urls(uuid, jsonb)
  is
  'Binds an uploaded normalized object path and digest to the exact canonical Supabase Storage public URL emitted by the trusted service worker.';

commit;
