begin;

-- The v2 localization wrapper owns a five-minute, one-use permit for exactly
-- one historical Qoo10 listing. Its enqueue still traverses two older global
-- release-gate wrappers, though, so a correctly armed request was rejected
-- before a gateway job could be written. Keep those generic gates closed and
-- admit only the already-validated immutable v2 tuple through the two nested
-- enqueue checks.
create function sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_arguments jsonb := p_request_payload->'arguments';
  v_marker jsonb :=
    p_request_payload#>'{arguments,sellerpilotQoo10ExactLocalization}';
  v_release_sha text := v_marker->>'releaseSha';
begin
  return coalesce(
    p_listing_id = '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
    and p_credential_id =
          '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
    and p_channel = 'qoo10'
    and p_operation = 'listing.update'
    and jsonb_typeof(p_request_payload) = 'object'
    and jsonb_typeof(v_arguments) = 'object'
    and jsonb_typeof(v_marker) = 'object'
    and sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
          v_arguments,
          v_release_sha
        )
    and sellerpilot_private.qoo10_exact_s1_release_is_current(v_release_sha)
    and exists (
      select 1
        from sellerpilot_private.channel_operation_attempts attempt
        join sellerpilot_private.qoo10_exact_localization_update_permits permit
          on permit.listing_id = p_listing_id
         and permit.product_id =
               'ddccde35-9c58-4856-b673-d7aa27ce4220'::uuid
         and permit.credential_id = p_credential_id
         and permit.owner_id =
               '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
         and permit.source_job_id =
               'fac9c5c4-940d-4600-88f3-8f97a069dfbf'::uuid
         and permit.remote_id = '1217336970'
         and permit.seller_account_key =
               '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
         and permit.release_sha = v_release_sha
         and permit.request_fingerprint = attempt.request_fingerprint
         and permit.update_job_id is null
         and permit.update_attempt_id is null
         and permit.arguments_sha256 is null
         and permit.request_payload_sha256 is null
         and permit.bound_at is null
         and permit.consumed_at is null
         and permit.invalidated_at is null
         and permit.expires_at > statement_timestamp()
       where attempt.id = p_attempt_id
         and attempt.credential_id = p_credential_id
         and attempt.channel = 'qoo10'
         and attempt.operation = 'listing.update'
         and attempt.status = 'running'
         and attempt.request_fingerprint ~ '^[a-f0-9]{64}$'
    ),
    false
  );
exception when others then
  return false;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

do $patch_exact_qoo10_closed_gate_enqueue$
declare
  v_signature regprocedure;
  v_definition text;
  v_before text := $body$
  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       p_channel
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;$body$;
  v_after text := $body$
  if p_operation in ('listing.create', 'listing.update', 'listing.stop')
     and not sellerpilot_private.listing_mutation_release_gate_is_effective(
       p_channel
     )
     and not sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
       p_listing_id,
       p_credential_id,
       p_attempt_id,
       p_channel,
       p_operation,
       p_request_payload
     )
  then
    raise exception 'LISTING_MUTATION_RELEASE_GATE_CLOSED'
      using errcode = '55000';
  end if;$body$;
begin
  foreach v_signature in array array[
    'public.sellerpilot_31132018_enqueue_before_smartstore_exact_qa_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.sellerpilot_222257_enqueue_listing_before_qoo10_rollback_fence(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    if pg_catalog.strpos(
         v_definition,
         'qoo10_exact_localization_enqueue_gate_bypass_allowed'
       ) > 0 then
      continue;
    end if;
    if pg_catalog.strpos(v_definition, v_before) = 0 then
      raise exception 'exact Qoo10 closed-gate enqueue patch target not found: %',
        v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_definition, v_before, v_after);
  end loop;
end;
$patch_exact_qoo10_closed_gate_enqueue$;

comment on function
  sellerpilot_private.qoo10_exact_localization_enqueue_gate_bypass_allowed(
    uuid, uuid, uuid, text, text, jsonb
  ) is
  'Fail-closed nested-enqueue exception for the armed, immutable Qoo10 exact localization v2 tuple only; every generic listing mutation remains release-gated.';

commit;
