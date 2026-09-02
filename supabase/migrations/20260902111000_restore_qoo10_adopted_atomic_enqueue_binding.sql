begin;

-- Later exact-channel wrappers retained the Qoo10 payload validator but
-- replaced the 20260831144000 wrapper that atomically bound a newly queued job
-- to its one-time localization permit.  Rebuild the current top-level wrapper
-- with the Qoo10 branch first, while retaining the deployed Coupang branch and
-- its complete predecessor chain through sp_173990_enqueue_pre.
create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_qoo10_marker jsonb :=
    p_request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
  v_qoo10_release_sha text := v_qoo10_marker->>'releaseSha';
  v_qoo10_permit
    sellerpilot_private.qoo10_exact_localization_update_permits%rowtype;
  v_coupang_permit record;
  v_result jsonb;
  v_job_id uuid;
begin
  if p_listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_qoo10_marker is not null
  then
    perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
    if p_listing_id is distinct from
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
       or p_credential_id is distinct from
         '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
       or p_channel is distinct from 'qoo10'
       or p_operation is distinct from 'listing.update'
       or not sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
         v_arguments, v_qoo10_release_sha
       )
       or not exists (
         select 1
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = p_attempt_id
            and attempt.owner_id =
                  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
            and attempt.credential_id = p_credential_id
            and attempt.channel = 'qoo10'
            and attempt.operation = 'listing.update'
            and attempt.status = 'running'
            and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
            and attempt.seller_account_key =
                  '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       )
    then
      raise exception 'exact Qoo10 localization enqueue identity invalid'
        using errcode = '55000';
    end if;

    select permit.* into v_qoo10_permit
      from sellerpilot_private.qoo10_exact_localization_update_permits permit
     where permit.listing_id = p_listing_id
       and permit.credential_id = p_credential_id
       and permit.seller_account_key =
             '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
       and permit.release_sha = v_qoo10_release_sha
       and permit.invalidated_at is null
       and permit.update_job_id is null
       and permit.update_attempt_id is null
       and permit.expires_at > statement_timestamp()
       and permit.request_fingerprint = (
         select attempt.request_fingerprint
           from sellerpilot_private.channel_operation_attempts attempt
          where attempt.id = p_attempt_id
       )
       and sellerpilot_private.qoo10_exact_s1_release_is_current(
             permit.release_sha
           )
       and (
         permit.lineage_contract is null
         or (
           permit.lineage_contract =
             'qoo10_exact_already_live_adoption_v1'
           and sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
             v_arguments,
             permit.release_sha,
             permit.adoption_observation_sha256,
             permit.prewrite_snapshot_sha256
           )
         )
       )
     for update;
    if not found then
      raise exception 'exact Qoo10 localization update permit missing'
        using errcode = '55000';
    end if;

    v_result := public.sp_173990_enqueue_pre(
      p_listing_id,
      p_credential_id,
      p_attempt_id,
      p_channel,
      p_operation,
      p_request_payload
    );
    if coalesce(v_result->>'job_id', '') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_result->>'status' is distinct from 'queued'
    then
      raise exception 'exact Qoo10 localization update job not newly queued'
        using errcode = '55000';
    end if;
    v_job_id := (v_result->>'job_id')::uuid;

    update sellerpilot_private.qoo10_exact_localization_update_permits permit
       set update_job_id = v_job_id,
           update_attempt_id = p_attempt_id,
           arguments_sha256 = encode(
             extensions.digest(v_arguments::text, 'sha256'), 'hex'
           ),
           arguments_bytes = octet_length(v_arguments::text),
           request_payload_sha256 = encode(
             extensions.digest(p_request_payload::text, 'sha256'), 'hex'
           ),
           request_payload_bytes = octet_length(p_request_payload::text)
     where permit.permit_id = v_qoo10_permit.permit_id
       and permit.update_job_id is null
       and permit.update_attempt_id is null
       and permit.invalidated_at is null
       and permit.expires_at > statement_timestamp()
       and sellerpilot_private.qoo10_exact_s1_release_is_current(
             permit.release_sha
           )
       and exists (
         select 1
           from sellerpilot_private.channel_gateway_jobs job
          where job.id = v_job_id
            and job.attempt_id = p_attempt_id
            and job.listing_id = permit.listing_id
            and job.credential_id = permit.credential_id
            and job.channel = 'qoo10'
            and job.operation = 'listing.update'
            and job.environment = 'production'
            and job.status = 'queued'
            and job.attempt_count = 0
            and job.seller_account_key = permit.seller_account_key
            and job.request_fingerprint = permit.request_fingerprint
            and job.request_payload = p_request_payload
            and job.provider_mutation_started_at is null
            and job.response_payload is null
            and job.completed_at is null
       );
    if not found then
      raise exception 'exact Qoo10 localization update job binding failed'
        using errcode = '55000';
    end if;
    return v_result;
  end if;

  if p_channel <> 'coupang'
     or p_operation <> 'listing.update'
     or p_listing_id <> '7ffc6e46-3173-4695-9889-5fa1529765f1'::uuid
     or v_arguments#>>'{sellerpilotCoupangExactQaRepresentative,contract}' <>
          'coupang_exact_qa_representative_v1'
  then
    return public.sp_173990_enqueue_pre(
      p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
      p_request_payload
    );
  end if;
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(193674993,917399001);
  select permit.* into strict v_coupang_permit
    from sellerpilot_private.exact_existing_update_permits permit
    join sellerpilot_private.coupang_exact_representative_permits rep
      on rep.permit_id = permit.permit_id
   where permit.channel = 'coupang'
     and permit.listing_id = p_listing_id
     and permit.credential_id = p_credential_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and rep.request_fingerprint = permit.request_fingerprint
     and rep.release_sha = permit.release_sha
     and sellerpilot_private.exact_existing_update_lineage_is_current(
           permit.permit_id
         )
     and sellerpilot_private.exact_existing_update_arguments_valid(
           'coupang',v_arguments,permit.release_sha,
           permit.request_fingerprint,permit.stock
         )
     and exists (
       select 1 from sellerpilot_private.channel_operation_attempts attempt
        where attempt.id = p_attempt_id
          and attempt.owner_id = permit.owner_id
          and attempt.credential_id = permit.credential_id
          and attempt.channel = 'coupang'
          and attempt.operation = 'listing.update'
          and attempt.status = 'running'
          and attempt.seller_account_key = permit.seller_account_key
          and attempt.request_fingerprint = permit.request_fingerprint
     )
   for update of permit,rep;
  v_result := public.sp_173990_enqueue_pre(
    p_listing_id,p_credential_id,p_attempt_id,p_channel,p_operation,
    p_request_payload
  );
  if coalesce(v_result->>'job_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_result->>'status' <> 'queued'
  then raise exception 'Coupang exact representative job not newly queued'
    using errcode = '55000'; end if;
  v_job_id := (v_result->>'job_id')::uuid;
  update sellerpilot_private.exact_existing_update_permits permit
     set update_job_id = v_job_id,
         update_attempt_id = p_attempt_id,
         arguments_sha256 = encode(
           extensions.digest(v_arguments::text,'sha256'),'hex'
         ),
         arguments_bytes = octet_length(v_arguments::text),
         request_payload_sha256 = encode(
           extensions.digest(p_request_payload::text,'sha256'),'hex'
         ),
         request_payload_bytes = octet_length(p_request_payload::text)
   where permit.permit_id = v_coupang_permit.permit_id
     and permit.update_job_id is null
     and permit.update_attempt_id is null
     and permit.invalidated_at is null
     and permit.expires_at > statement_timestamp()
     and sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
           permit.permit_id
         )
     and exists (
       select 1 from sellerpilot_private.channel_gateway_jobs job
        where job.id = v_job_id
          and job.attempt_id = p_attempt_id
          and job.listing_id = permit.listing_id
          and job.credential_id = permit.credential_id
          and job.channel = 'coupang'
          and job.operation = 'listing.update'
          and job.environment = 'production'
          and job.status = 'queued'
          and job.attempt_count = 0
          and job.seller_account_key = permit.seller_account_key
          and job.request_fingerprint = permit.request_fingerprint
          and job.request_payload = p_request_payload
          and job.provider_mutation_started_at is null
          and job.response_payload is null
          and job.completed_at is null
     );
  if not found then
    if not exists (
      select 1 from sellerpilot_private.exact_existing_update_permits permit
       where permit.permit_id = v_coupang_permit.permit_id
         and permit.update_job_id = v_job_id
         and permit.update_attempt_id = p_attempt_id
         and permit.arguments_sha256 = encode(
           extensions.digest(v_arguments::text,'sha256'),'hex'
         )
         and permit.request_payload_sha256 = encode(
           extensions.digest(p_request_payload::text,'sha256'),'hex'
         )
    ) then raise exception 'Coupang exact representative job binding failed'
      using errcode = '55000'; end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is
  'Restores atomic Qoo10 adopted-localization job-to-permit binding while preserving the deployed Coupang and predecessor enqueue chain.';

commit;
