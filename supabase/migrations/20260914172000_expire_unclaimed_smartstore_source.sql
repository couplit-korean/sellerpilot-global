-- One never-claimed request expired while its local execution path was blocked.
-- Preserve its evidence; a new official source must enter through normal admission.
begin;
set local lock_timeout='5s';
set local statement_timeout='25s';
create table sellerpilot_private.smartstore_unclaimed_source_expiry_receipts(
 job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
 job_before jsonb not null, attempt_before jsonb not null,
 listing_before jsonb not null, source_before jsonb not null,
 reason text not null check(reason='SMARTSTORE_CREATE_SOURCE_EXPIRED_BEFORE_CLAIM'),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.smartstore_unclaimed_source_expiry_receipts enable row level security;
revoke all on sellerpilot_private.smartstore_unclaimed_source_expiry_receipts from public,anon,authenticated,service_role;
do $expire$
declare
 j sellerpilot_private.channel_gateway_jobs%rowtype;
 a sellerpilot_private.channel_operation_attempts%rowtype;
 l sellerpilot_private.product_listings%rowtype;
 s sellerpilot_private.smartstore_create_category_attribute_sources%rowtype;
 reason constant text := 'SMARTSTORE_CREATE_SOURCE_EXPIRED_BEFORE_CLAIM';
 stopped_at timestamptz := clock_timestamp();
begin
 perform pg_advisory_xact_lock(193674993,821065042);
 select * into j from sellerpilot_private.channel_gateway_jobs where id='540d7294-fad2-4de9-8786-acf107a80c73' for update;
 select * into a from sellerpilot_private.channel_operation_attempts where id='c20ac461-2947-4be6-b36e-758666af66c8' for update;
 select * into l from sellerpilot_private.product_listings where id='043ccf5a-ca7a-4f89-8add-15de541287b1' for update;
 select * into s from sellerpilot_private.smartstore_create_category_attribute_sources where id='3c2ee8dd-2bd2-4255-80cb-5b74c870db37' for share;
 if j.id is null or a.id is null or l.id is null or s.id is null
 or md5(to_jsonb(j)::text) is distinct from '493029b6748de7825cdb5de8e91690f0'
 or md5(to_jsonb(a)::text) is distinct from '61c10c95ee059a31de8a41dd062ccf0b'
 or md5(to_jsonb(l)::text) is distinct from '43ac9a487936ac4b655e1b8df2d91de2'
 or md5(to_jsonb(s)::text) is distinct from 'f31943c215fa3acacc57ad6c485566d2'
 then raise exception 'SMARTSTORE_UNCLAIMED_EXPIRY_PREIMAGE_DRIFT';end if;
 if j.channel is distinct from 'smartstore' or j.operation is distinct from 'listing.create'
 or j.environment is distinct from 'production' or j.status is distinct from 'queued'
 or j.attempt_count is distinct from 0 or j.started_at is not null or j.completed_at is not null
 or j.worker_token_id is not null or j.claim_token is not null or j.lease_expires_at is not null
 or j.provider_mutation_started_at is not null or j.oauth_provider_call_started_at is not null or j.response_payload is not null
 or j.credential_refresh_in_flight is distinct from false or j.credential_refresh_started_at is not null
 or j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null
 or j.oauth_exchange_completed is distinct from false
 or j.credential_id is distinct from '2aa76829-3d63-4842-9c3e-622acd3d0d2f'::uuid
 or j.created_by is distinct from '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
 or j.attempt_id is distinct from a.id or j.listing_id is distinct from l.id
 or a.owner_id is distinct from '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
 or a.owner_id is distinct from l.owner_id or a.credential_id is distinct from j.credential_id
 or a.channel is distinct from j.channel or a.operation is distinct from j.operation
 or a.status is distinct from 'running' or a.completed_at is not null or a.remote_id is not null
 or a.request_fingerprint is distinct from j.request_fingerprint
 or a.seller_account_key is distinct from j.seller_account_key
 or l.channel_key is distinct from j.channel or l.operation_attempt_id is distinct from a.id
 or l.status is distinct from 'queued' or l.remote_id is not null or l.published_at is not null
 or l.provider_resource_id is not null or l.remote_resources is distinct from '{}'::jsonb
 -- Before the first verified CREATE the listing has no seller binding yet;
 -- the attempt/job carry it. Preserve that null, rather than invent a binding.
 or l.seller_account_key is not null
 or l.product_id is distinct from 'c0bdb493-6447-41bf-af0a-46a3da7a75a8'::uuid
 or s.owner_id is distinct from l.owner_id or s.product_id is distinct from l.product_id
 or s.credential_id is distinct from j.credential_id or s.retired_at is not null
 or s.expires_at is null or s.expires_at>stopped_at
 or s.assignment_revision::text is distinct from j.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentRevision}'
 or s.assignment_digest is distinct from j.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,assignmentDigest}'
 or s.official_readback_digest is distinct from j.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,officialReadbackDigest}'
 or s.product_attributes_sha256 is distinct from j.request_payload#>>'{arguments,sellerpilotSmartstoreCategoryAttributeMapping,productAttributesSha256}'
 or exists(select 1 from sellerpilot_private.smartstore_create_final_transports where job_id=j.id)
 or exists(select 1 from sellerpilot_private.smartstore_create_final_completions where job_id=j.id)
 or exists(select 1 from sellerpilot_private.channel_gateway_jobs other where other.listing_id=l.id and other.id<>j.id)
 then raise exception 'SMARTSTORE_UNCLAIMED_EXPIRY_EVIDENCE_MISMATCH';end if;
 insert into sellerpilot_private.smartstore_unclaimed_source_expiry_receipts(job_id,job_before,attempt_before,listing_before,source_before,reason)
 values(j.id,to_jsonb(j),to_jsonb(a),to_jsonb(l),to_jsonb(s),reason);
 update sellerpilot_private.channel_gateway_jobs set status='cancelled',error_message=reason,completed_at=stopped_at,updated_at=stopped_at where id=j.id;
 update sellerpilot_private.channel_operation_attempts set status='failed',http_status=409,safe_message=reason,completed_at=stopped_at where id=a.id;
 -- Existing seller-lineage trigger accepts a pre-provider failure without an
 -- identity change. No special trigger bypass or persistent stop fence is used.
 update sellerpilot_private.product_listings set status='failed',failure_class='retryable',last_error=reason,updated_at=stopped_at where id=l.id;
 insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
 values(l.owner_id,'smartstore_unclaimed_source_expired','channel_gateway_job',j.id::text,
 jsonb_build_object('reason',reason,'listingId',l.id,'attemptId',a.id,'sourceId',s.id,'providerRequestSent',false));
end $expire$;
commit;
