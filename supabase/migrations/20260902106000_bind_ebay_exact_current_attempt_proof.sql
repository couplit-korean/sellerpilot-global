-- Rebind the exact eBay content-rearm proof to the latest failed attempt that
-- stopped before a gateway job existed. The attempt keeps its historical v106
-- credential as immutable evidence; the supplied credential remains the sole
-- active provider-certified successor for the same seller lineage.
--
-- This migration replaces the private boolean proof and removes historical
-- token-freshness checks from the read-only identity RPC. It creates no permit,
-- attempt or gateway job and never calls eBay.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000010);

do $ebay_exact_current_attempt_proof_preimage$
declare
  v_proof text;
  v_old_attempt constant text :=
    'c9d5b739-4ae7-4596-acbc-06f900a21ba3';
  v_new_attempt constant text :=
    '079cd680-47fb-4910-b3d8-27d19356e66e';
  v_old_fingerprint constant text :=
    'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2';
  v_new_fingerprint constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_release_is_current(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'
     ) is null
  then
    raise exception 'eBay current-attempt proof preimage missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure
  ) into strict v_proof;

  if (
       pg_catalog.length(v_proof)
       - pg_catalog.length(pg_catalog.replace(v_proof, v_old_attempt, ''))
     ) / pg_catalog.length(v_old_attempt) <> 1
     or (
       pg_catalog.length(v_proof)
       - pg_catalog.length(pg_catalog.replace(v_proof, v_old_fingerprint, ''))
     ) / pg_catalog.length(v_old_fingerprint) <> 1
     or pg_catalog.strpos(v_proof, v_new_attempt) <> 0
     or pg_catalog.strpos(v_proof, 'attempt_credential.id') <> 0
     or pg_catalog.strpos(v_proof, '8b2cbfaf-3854-437d-b381-abfd70291354') = 0
     or pg_catalog.strpos(v_proof, 'ddccde35-9c58-4856-b673-d7aa27ce4220') = 0
     or pg_catalog.strpos(v_proof, '800551945442') = 0
     or pg_catalog.strpos(v_proof, '244042196011') = 0
     or pg_catalog.strpos(v_proof, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.strpos(v_proof, 'listing.price = 12.90') = 0
     or pg_catalog.strpos(v_proof, 'product.on_hand = 1') = 0
     or pg_catalog.strpos(v_proof, 'attempt.status = ''failed''') = 0
     or pg_catalog.strpos(v_proof, 'attempt.http_status = 422') = 0
     or pg_catalog.strpos(v_proof, 'attempt.remote_id is null') = 0
     or pg_catalog.strpos(v_proof, 'attempt.gateway_write_required') = 0
     or pg_catalog.strpos(v_proof, 'attempt.pre_gateway_retryable') = 0
     or pg_catalog.strpos(v_proof, 'retry_job.attempt_id = attempt.id') = 0
     or pg_catalog.strpos(v_proof, 'count(*) = 13') = 0
     or pg_catalog.strpos(
          v_proof,
          'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
        ) = 0
     or pg_catalog.strpos(v_proof, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(v_proof, 'exact_existing_update_release_is_current') = 0
  then
    raise exception 'eBay current-attempt proof preimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_current_attempt_proof_preimage$;

do $patch_ebay_exact_current_attempt_proof$
declare
  v_signature constant regprocedure :=
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old_join constant text := $old$        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id = 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'::uuid
         and attempt.owner_id = listing.owner_id
         and attempt.channel = listing.channel_key
        join sellerpilot_private.exact_existing_update_permits permit$old$;
  v_new_join constant text := $new$        join sellerpilot_private.channel_operation_attempts attempt
          on attempt.id = '079cd680-47fb-4910-b3d8-27d19356e66e'::uuid
         and attempt.owner_id = listing.owner_id
         and attempt.channel = listing.channel_key
        join sellerpilot_private.channel_credentials attempt_credential
          on attempt_credential.id = attempt.credential_id
         and attempt_credential.channel = listing.channel_key
         and attempt_credential.environment = 'production'
         and attempt_credential.status in ('active', 'revoked')
         and attempt_credential.version > 0
         and attempt_credential.fingerprint ~ '^[A-F0-9]{12}$'
         and attempt_credential.seller_account_key = listing.seller_account_key
         and attempt_credential.seller_account_key_source = 'provider_certified_v1'
         and attempt_credential.seller_account_verified_at is not null
        join sellerpilot_private.exact_existing_update_permits permit$new$;
  v_old_fingerprint constant text :=
    'ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2';
  v_new_fingerprint constant text :=
    'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef';
  v_old_current constant text := $old$         and current_credential.last_check_status = 'passed'
         and permit.channel = 'ebay'$old$;
  v_new_current constant text := $new$         and current_credential.last_check_status = 'passed'
         and attempt_credential.version <= current_credential.version
         and permit.channel = 'ebay'$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old_join, ''))
     ) / pg_catalog.length(v_old_join) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(
           v_definition, v_old_fingerprint, ''
         ))
     ) / pg_catalog.length(v_old_fingerprint) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old_current, ''))
     ) / pg_catalog.length(v_old_current) <> 1
  then
    raise exception 'eBay current-attempt proof patch target mismatch'
      using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_join, v_new_join);
  v_definition := pg_catalog.replace(
    v_definition, v_old_fingerprint, v_new_fingerprint
  );
  execute pg_catalog.replace(v_definition, v_old_current, v_new_current);

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_old_fingerprint) <> 0
     or pg_catalog.strpos(
          v_definition, 'c9d5b739-4ae7-4596-acbc-06f900a21ba3'
        ) <> 0
     or pg_catalog.strpos(
          v_definition, '079cd680-47fb-4910-b3d8-27d19356e66e'
        ) = 0
     or pg_catalog.strpos(v_definition, v_new_fingerprint) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.id = attempt.credential_id'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'attempt_credential.seller_account_key = listing.seller_account_key'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'attempt_credential.seller_account_key_source = ''provider_certified_v1'''
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.version <= current_credential.version'
        ) = 0
     or pg_catalog.strpos(v_definition, 'ebay_exact_current_credential_is_valid') = 0
  then
    raise exception 'eBay current-attempt proof patch failed'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_current_attempt_proof$;

do $patch_ebay_exact_historical_credential_freshness$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text := $old$     and attempt_credential.seller_account_verified_at is not null
     and attempt_credential.expires_at is not null
     and attempt_credential.expires_at > statement_timestamp()
     and attempt_credential.last_checked_at is not null
     and attempt_credential.last_check_status = 'passed'
    join sellerpilot_private.channel_credentials credential$old$;
  v_new constant text := $new$     and attempt_credential.seller_account_verified_at is not null
    join sellerpilot_private.channel_credentials credential$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 1
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.id = attempt.credential_id'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.version <= credential.version'
        ) = 0
  then
    raise exception 'eBay historical credential freshness patch target mismatch'
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);

  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_post_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if v_post_owner is distinct from v_owner
     or pg_catalog.strpos(v_definition, v_old) <> 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.id = attempt.credential_id'
        ) = 0
     or pg_catalog.strpos(
          v_definition,
          'attempt_credential.seller_account_key_source = ''provider_certified_v1'''
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.seller_account_verified_at is not null'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.version <= credential.version'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_current_credential_is_valid'
        ) = 0
  then
    raise exception 'eBay historical credential freshness patch failed'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_historical_credential_freshness$;

do $ebay_exact_current_attempt_proof_postimage$
declare
  v_proof text;
  v_identity text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)'::regprocedure
  ) into strict v_proof;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_identity;

  if pg_catalog.strpos(v_proof, '079cd680-47fb-4910-b3d8-27d19356e66e') = 0
     or pg_catalog.strpos(
          v_proof,
          'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'
        ) = 0
     or pg_catalog.strpos(v_proof, '8b2cbfaf-3854-437d-b381-abfd70291354') = 0
     or pg_catalog.strpos(v_proof, 'ddccde35-9c58-4856-b673-d7aa27ce4220') = 0
     or pg_catalog.strpos(v_proof, '800551945442') = 0
     or pg_catalog.strpos(v_proof, '244042196011') = 0
     or pg_catalog.strpos(v_proof, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.strpos(v_proof, 'listing.price = 12.90') = 0
     or pg_catalog.strpos(v_proof, 'product.on_hand = 1') = 0
     or pg_catalog.strpos(v_proof, 'attempt.status = ''failed''') = 0
     or pg_catalog.strpos(v_proof, 'attempt.http_status = 422') = 0
     or pg_catalog.strpos(v_proof, 'retry_job.attempt_id = attempt.id') = 0
     or pg_catalog.strpos(v_proof, 'count(*) = 13') = 0
     or pg_catalog.strpos(
          v_proof,
          'normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
        ) = 0
     or pg_catalog.strpos(v_proof, 'exact_existing_update_release_is_current') = 0
     or pg_catalog.strpos(v_proof, 'ebay_exact_current_credential_is_valid') = 0
     or pg_catalog.strpos(
          v_proof, 'attempt_credential.version <= current_credential.version'
        ) = 0
     or pg_catalog.strpos(
          v_proof, 'attempt_credential.expires_at > statement_timestamp()'
        ) <> 0
     or pg_catalog.strpos(
          v_proof, 'attempt_credential.last_check_status = ''passed'''
        ) <> 0
     or pg_catalog.strpos(
          v_identity, 'attempt_credential.id = attempt.credential_id'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'attempt_credential.version <= credential.version'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'attempt_credential.expires_at > statement_timestamp()'
        ) <> 0
     or pg_catalog.strpos(
          v_identity, 'attempt_credential.last_check_status = ''passed'''
        ) <> 0
  then
    raise exception 'eBay current-attempt proof postimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_current_attempt_proof_postimage$;

comment on function
  sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
    uuid, text, text
  ) is
  'Proves the exact eBay item 800551945442 content rearm from failed no-job attempt 079cd680 while keeping its historical provider-certified lineage independent of token freshness and separate from the sole current same-seller credential.';

commit;
