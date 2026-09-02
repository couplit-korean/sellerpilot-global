-- Release-ordered fix: the Qoo10 exact-localization constraint triggers are deferred until the
-- enqueue transaction commits. The historical enqueue inserts the gateway job
-- before its verified-publication wrapper fills request_fingerprint. PostgreSQL
-- preserves the INSERT event's original NEW tuple for a deferred row trigger,
-- so validating NEW at commit sees a null fingerprint even though the final
-- persisted job and its permit binding are complete. Validate the final row by
-- immutable job id, while preserving every permit, seller-account, payload,
-- and terminal-readback fence.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 902101000);

create or replace function
  sellerpilot_private.guard_qoo10_exact_localization_update_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_marker jsonb;
begin
  -- Preserve the exact internal-only adoption transition introduced by
  -- 20260901173400. It retires the already-live uncertain source job without
  -- replaying the provider call, but only after the immutable readback receipt
  -- for that same job, attempt, listing, and credential exists.
  if tg_op = 'UPDATE'
     and old.status = 'reconciliation_required'
     and new.status = 'failed'
     and current_setting(
           'sellerpilot.qoo10_already_live_adopt_source', true
         ) is not distinct from old.id::text
     and to_jsonb(new) - array['status', 'error_message', 'updated_at']
           is not distinct from
         to_jsonb(old) - array['status', 'error_message', 'updated_at']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_already_live_adoptions receipt
        where receipt.source_job_id = old.id
          and receipt.source_attempt_id = old.attempt_id
          and receipt.listing_id = old.listing_id
          and receipt.credential_id = old.credential_id
          and receipt.remote_id = '1217336970'
          and receipt.provider_status = 'S2'
          and receipt.remote_visibility = 'live'
          and receipt.purchase_available
          and not receipt.provider_call_replayed
          and receipt.external_write_count = 0
     )
  then return new; end if;

  if tg_op = 'UPDATE'
     and old.status = 'reconciliation_required'
     and new.status = 'failed'
     and current_setting(
           'sellerpilot.qoo10_partial_manual_reconcile_source', true
         ) is not distinct from old.id::text
     and to_jsonb(new) - array['status', 'error_message', 'updated_at']
           is not distinct from
         to_jsonb(old) - array['status', 'error_message', 'updated_at']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_partial_manual_reconciliations
           evidence
        where evidence.source_job_id = old.id
          and evidence.source_attempt_id = old.attempt_id
          and evidence.listing_id = old.listing_id
          and evidence.credential_id = old.credential_id
          and evidence.remote_id = '1217336970'
          and evidence.resolution =
                'partial_remote_effect_manual_activation_required'
          and not evidence.provider_call_replayed
     )
  then return new; end if;

  if tg_op = 'UPDATE'
     and old.status = 'reconciliation_required'
     and new.status = 'failed'
     and current_setting(
           'sellerpilot.qoo10_no_effect_reconcile_source', true
         ) is not distinct from old.id::text
     and to_jsonb(new) - array['status', 'error_message', 'updated_at']
           is not distinct from
         to_jsonb(old) - array['status', 'error_message', 'updated_at']
     and exists (
       select 1
         from sellerpilot_private.qoo10_exact_no_effect_reconciliations evidence
        where evidence.source_job_id = old.id
          and evidence.source_attempt_id = old.attempt_id
          and evidence.listing_id = old.listing_id
          and evidence.credential_id = old.credential_id
          and evidence.remote_id = '1217336970'
          and evidence.resolution = 'no_remote_effect'
          and not evidence.provider_call_replayed
     )
  then return new; end if;

  -- This is a deferred AFTER trigger. Validate the final transaction row, not
  -- the stale INSERT event captured before request_fingerprint was populated.
  select current_job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs current_job
   where current_job.id = new.id;
  if not found then
    raise exception 'exact Qoo10 localization update job row unavailable'
      using errcode = '55000';
  end if;

  v_marker :=
    v_job.request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
  if v_job.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and v_marker is null
  then return new; end if;
  if v_job.operation is distinct from 'listing.update' and v_marker is null then
    return new;
  end if;
  if v_job.listing_id is distinct from
       '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_job.credential_id is distinct from
       '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.environment is distinct from 'production'
     or v_job.seller_account_key is distinct from
       '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     or not exists (
       select 1
         from sellerpilot_private.qoo10_exact_localization_update_permits permit
        where permit.update_job_id = v_job.id
          and permit.update_attempt_id = v_job.attempt_id
          and permit.listing_id = v_job.listing_id
          and permit.credential_id = v_job.credential_id
          and permit.seller_account_key = v_job.seller_account_key
          and permit.release_sha = v_marker->>'releaseSha'
          and permit.request_fingerprint = v_job.request_fingerprint
          and permit.arguments_sha256 = encode(extensions.digest(
                (v_job.request_payload->'arguments')::text, 'sha256'
              ), 'hex')
          and permit.arguments_bytes = octet_length(
                (v_job.request_payload->'arguments')::text
              )
          and permit.request_payload_sha256 = encode(extensions.digest(
                v_job.request_payload::text, 'sha256'
              ), 'hex')
          and permit.request_payload_bytes =
                octet_length(v_job.request_payload::text)
          and permit.invalidated_at is null
          and sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
                v_job.request_payload->'arguments', permit.release_sha
              )
     )
  then
    raise exception 'exact Qoo10 localization update job lineage invalid'
      using errcode = '55000';
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'exact Qoo10 localization update job lineage invalid'
    using errcode = '55000';
end;
$$;

create or replace function
  sellerpilot_private.guard_exact_qoo10_adopted_localization_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_permit record;
  v_is_adopted boolean;
begin
  -- Keep this adopted-contract trigger on the same final-row semantics as the
  -- base Qoo10 permit trigger. Terminal status and response validation still
  -- run only for an UPDATE transition represented by this trigger event.
  select current_job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs current_job
   where current_job.id = new.id;
  if not found then
    raise exception 'exact Qoo10 adopted localization job row unavailable'
      using errcode = '55000';
  end if;

  v_is_adopted := coalesce(
    v_job.request_payload#>>
      '{arguments,sellerpilotQoo10AdoptedLocalization,contract}' =
        'qoo10_exact_adopted_live_localization_v1',
    false
  );
  select permit.* into v_permit
    from sellerpilot_private.qoo10_exact_localization_update_permits permit
   where permit.update_job_id = v_job.id;
  if not v_is_adopted
     and (not found or v_permit.lineage_contract is null)
  then return new; end if;
  if not found
     or v_permit.lineage_contract is distinct from
          'qoo10_exact_already_live_adoption_v1'
     or v_job.listing_id is distinct from
          '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     or v_job.credential_id is distinct from
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     or v_job.channel is distinct from 'qoo10'
     or v_job.operation is distinct from 'listing.update'
     or v_job.environment is distinct from 'production'
     or not sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(
          v_job.request_payload->'arguments',
          v_permit.release_sha,
          v_permit.adoption_observation_sha256,
          v_permit.prewrite_snapshot_sha256
        )
  then
    raise exception 'exact Qoo10 adopted localization job lineage invalid'
      using errcode = '55000';
  end if;

  if tg_op = 'UPDATE'
     and old.status is distinct from v_job.status
     and v_job.status in ('succeeded', 'failed', 'reconciliation_required')
  then
    if v_job.status = 'succeeded' and not (
      jsonb_typeof(v_job.response_payload->'steps') = 'array'
      and jsonb_array_length(v_job.response_payload->'steps') = 3
      and v_job.response_payload->>'ok' = 'true'
      and v_job.response_payload->>'publicationFulfilled' = 'true'
      and v_job.response_payload#>>'{remoteState,providerStatus}' in ('S2', '2')
      and v_job.response_payload#>>'{remoteState,visibility}' = 'live'
      and v_job.response_payload#>>'{remoteState,locale}' = 'ja-JP'
      and v_job.response_payload#>>'{remoteState,imageCount}' = '8'
      and v_job.response_payload#>>'{steps,0,name}' =
            'qoo10-exact-adopted-live-prewrite-readback'
      and v_job.response_payload#>>'{steps,0,ok}' = 'true'
      and v_job.response_payload#>>'{steps,1,name}' = 'EditGoodsContents'
      and v_job.response_payload#>>'{steps,1,ok}' = 'true'
      and v_job.response_payload#>>'{steps,2,name}' =
            'qoo10-exact-adopted-localization-postwrite-readback'
      and v_job.response_payload#>>'{steps,2,ok}' = 'true'
      and v_job.response_payload#>>'{steps,2,data,sellerpilotVerification}' =
            'QOO10_EXACT_ADOPTED_S2_LOCALIZATION_VERIFIED'
    ) then
      raise exception 'exact Qoo10 adopted localization success lacks fresh readback'
        using errcode = '55000';
    end if;
    if v_job.status = 'failed' and not exists (
      select 1 from jsonb_array_elements(
        coalesce(v_job.response_payload->'steps', '[]'::jsonb)
      ) step
       where step#>'{data,sellerpilotNoWriteConfirmed}' = 'true'::jsonb
    ) then
      raise exception 'uncertain Qoo10 adopted localization must reconcile'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_qoo10_exact_localization_update_job(),
  sellerpilot_private.guard_exact_qoo10_adopted_localization_job()
  from public, anon, authenticated, service_role;

do $assert_qoo10_deferred_job_lineage_postimage$
declare
  v_base text := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_qoo10_exact_localization_update_job()'::regprocedure
  );
  v_adopted text := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.guard_exact_qoo10_adopted_localization_job()'::regprocedure
  );
begin
  if pg_catalog.strpos(
       v_base,
       'from sellerpilot_private.channel_gateway_jobs current_job'
     ) = 0
     or pg_catalog.strpos(v_base, 'current_job.id = new.id') = 0
     or pg_catalog.strpos(
          v_base,
          'permit.request_fingerprint = v_job.request_fingerprint'
        ) = 0
     or pg_catalog.strpos(
          v_base,
          'permit.request_fingerprint = ' || 'new.request_fingerprint'
        ) <> 0
     or pg_catalog.strpos(
          v_base,
          'permit.seller_account_key = v_job.seller_account_key'
        ) = 0
     or pg_catalog.strpos(
          v_base,
          'qoo10_exact_localization_v2_arguments_valid'
        ) = 0
     or pg_catalog.strpos(
          v_base,
          'sellerpilot.qoo10_already_live_adopt_source'
        ) = 0
     or pg_catalog.strpos(
          v_base,
          'qoo10_exact_already_live_adoptions'
        ) = 0
  then
    raise exception 'QOO10_DEFERRED_JOB_LINEAGE_BASE_POSTIMAGE_MISMATCH'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(
       v_adopted,
       'from sellerpilot_private.channel_gateway_jobs current_job'
     ) = 0
     or pg_catalog.strpos(v_adopted, 'current_job.id = new.id') = 0
     or pg_catalog.strpos(
          v_adopted,
          'qoo10_exact_adopted_localization_arguments_valid'
        ) = 0
     or pg_catalog.strpos(
          v_adopted,
          'QOO10_EXACT_ADOPTED_S2_LOCALIZATION_VERIFIED'
        ) = 0
  then
    raise exception 'QOO10_DEFERRED_JOB_LINEAGE_ADOPTED_POSTIMAGE_MISMATCH'
      using errcode = '55000';
  end if;
end;
$assert_qoo10_deferred_job_lineage_postimage$;

commit;
