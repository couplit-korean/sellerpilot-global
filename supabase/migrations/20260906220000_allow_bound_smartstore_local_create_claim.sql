-- Candidate only: parent owns operational application. No row/lease mutation here.
-- Normal LOCAL claim only; serverless and local_recovery exclusions remain unchanged.
-- Version pin is the observed registered Mac version, not proof of current runner readiness.
-- Confirm actual 1.60 runner capability/registered egress before any normal consumption.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
select pg_catalog.pg_advisory_xact_lock(193674993, 900622000);
do $migration$
declare
  source text;
  patched text;
  old_predicate constant text := $old$     and not (
       j.channel = 'smartstore'
       and j.operation not in (
         'diagnostic.test',
         'categories.list',
         'categories.suggest',
         'categories.attributes',
         'categories.validate',
         'inquiries.list',
         'listing.publication.verify'
       )
     )$old$;
  new_predicate constant text := $new$     and not (
       j.channel = 'smartstore'
       and j.operation not in (
         'diagnostic.test',
         'categories.list',
         'categories.suggest',
         'categories.attributes',
         'categories.validate',
         'inquiries.list',
         'listing.publication.verify'
       )
       and not coalesce((
         j.id = '66147e5d-0479-4c51-896e-97e782af99e1'::uuid
         and j.attempt_id = '0d2c492e-2025-4717-bb3f-0fd2b886fd4f'::uuid
         and j.channel = 'smartstore' and j.operation = 'listing.create'
         and j.environment = 'production' and j.attempt_count = 0
         and j.started_at is null and j.provider_mutation_started_at is null
         and j.worker_token_id is null and j.claim_token is null and j.lease_expires_at is null
         and j.request_payload#>>'{arguments,publicationIntent}' = 'live'
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,contract}' = 'sellerpilot_external_detail_channel_v1'
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,productId}' = '1ed4acfc-7603-48ec-a638-241131e59358'
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,importId}' = '08acb37f-7ed0-40b0-8fb3-4a217a7ac912'
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,version}' = '2'
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,channel}' = j.channel
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,language}' = 'ko'
         and j.request_payload#>>'{arguments,sellerpilotExternalDetail,locale}' = 'ko-KR'
         and j.request_payload#>>'{arguments,publicationExpectedLocale}' = 'ko-KR'
         and c.channel = j.channel and c.environment = j.environment
         and c.created_by = j.created_by
         and (c.expires_at is null or c.expires_at > clock_timestamp())
         and j.seller_account_key is not distinct from c.seller_account_key
         and p_worker_version = 'sellerpilot-cli-worker/1.60'
         and exists (
           select 1 from sellerpilot_private.ai_cli_worker_tokens bound_token
           where bound_token.id = v_token_id
             and bound_token.id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
             and bound_token.token_hash = p_token_hash
             and bound_token.scope = 'gateway' and bound_token.status = 'active'
             and bound_token.expires_at > clock_timestamp()
         )
         and sellerpilot_private.listing_mutation_release_gate_is_effective('smartstore')
         and exists (
           select 1 from sellerpilot_private.channel_operation_attempts a
           join sellerpilot_private.products p on p.id = '1ed4acfc-7603-48ec-a638-241131e59358'::uuid
           join sellerpilot_private.external_detail_imports r on r.id = p.external_detail_import_id
           where a.id = j.attempt_id and a.owner_id = p.owner_id and r.owner_id = p.owner_id
             and a.credential_id = j.credential_id and a.channel = j.channel and a.operation = j.operation
             and a.status = 'running' and a.remote_id is null
             and a.request_fingerprint = j.request_fingerprint
             and j.request_fingerprint ~ '^[a-f0-9]{64}$'
             and r.id = '08acb37f-7ed0-40b0-8fb3-4a217a7ac912'::uuid and r.status = 'approved'
             and r.approved_detail_version = 2 and p.detail_page_version = 2
             and r.approved_product_updated_at = p.updated_at
             and r.approved_product_updated_at = (j.request_payload#>>'{arguments,sellerpilotExternalDetail,productUpdatedAt}')::timestamptz
             and p.ai_job_id::text = r.payload->>'expectedAiJobId'
             and r.request_sha256 = '8f1ebe5d61834100351b96385d84f063f39b329e7e68b9b255abb286caf056f2'
             and r.request_sha256 = j.request_payload#>>'{arguments,sellerpilotExternalDetail,requestSha256}'
             and r.payload#>>'{reviewedCopy,ko,documentSha256}' = j.request_payload#>>'{arguments,sellerpilotExternalDetail,documentSha256}'
             and case when jsonb_typeof(r.payload->'assets') = 'array' then jsonb_array_length(r.payload->'assets') = 8 else false end
             and case when jsonb_typeof(r.receipts) = 'array' then jsonb_array_length(r.receipts) = 8 else false end
             and case when jsonb_typeof(j.request_payload#>'{arguments,sellerpilotExternalDetail,imageSha256s}') = 'array' then jsonb_array_length(j.request_payload#>'{arguments,sellerpilotExternalDetail,imageSha256s}') = 8 else false end
             and case when jsonb_typeof(j.request_payload#>'{arguments,sellerpilotExternalDetail,pixelSha256s}') = 'array' then jsonb_array_length(j.request_payload#>'{arguments,sellerpilotExternalDetail,pixelSha256s}') = 8 else false end
             and not exists (
               select 1 from generate_series(0,7) image_index
               where coalesce(r.payload#>>array['assets',image_index::text,'sourceSha256'], '') !~ '^[a-f0-9]{64}$'
                  or coalesce(r.receipts#>>array[image_index::text,'decodedRgbaSha256'], '') !~ '^[a-f0-9]{64}$'
                  or r.payload#>>array['assets',image_index::text,'sourceSha256'] is distinct from j.request_payload#>>array['arguments','sellerpilotExternalDetail','imageSha256s',image_index::text]
                  or r.receipts#>>array[image_index::text,'decodedRgbaSha256'] is distinct from j.request_payload#>>array['arguments','sellerpilotExternalDetail','pixelSha256s',image_index::text]
             )
         )
       ), false)
     )$new$;
begin
  source := pg_catalog.pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex') = 'e3badc98aeb7a95b349e3379d749078ae34b7fba1267232abad2a19a65283145' then return; end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex') <> '66a40ae29039a93d629d097e951ab5eab642c0d31c2b2e65aaab9ffacee2ef7d' then raise exception 'SMARTSTORE_BOUND_LOCAL_CREATE_SOURCE_DRIFT'; end if;
  patched := pg_catalog.replace(source,old_predicate,new_predicate);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(patched,'UTF8')),'hex') <> 'e3badc98aeb7a95b349e3379d749078ae34b7fba1267232abad2a19a65283145' then raise exception 'SMARTSTORE_BOUND_LOCAL_CREATE_PATCH_MISMATCH'; end if;
  execute patched;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure),'UTF8')),'hex') <> 'e3badc98aeb7a95b349e3379d749078ae34b7fba1267232abad2a19a65283145' then raise exception 'SMARTSTORE_BOUND_LOCAL_CREATE_READBACK_MISMATCH'; end if;
end
$migration$;
commit;
