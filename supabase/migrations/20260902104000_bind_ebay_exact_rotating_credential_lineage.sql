-- Preserve the exact failed pre-provider attempt as historical evidence while
-- allowing a later sole active eBay credential for the same provider-certified
-- seller lineage to execute the approved existing-listing update. Credential
-- rotation must not rewrite the attempt or weaken any listing/provider fence.
--
-- This migration replaces only the read-only identity RPC. It creates no
-- permit or operation attempt, enqueues no gateway job and never calls eBay.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 917000009);

do $ebay_exact_rotating_credential_preimage$
declare
  v_identity text;
  v_old constant text := $old$    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
     and attempt.owner_id = listing.owner_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = listing.channel_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key$old$;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.ebay_exact_current_credential_is_valid(uuid,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.exact_existing_update_release_is_current(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'sellerpilot_private.active_serverless_runtime_release_sha()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'
     ) is null
  then
    raise exception 'eBay rotating-credential identity preimage missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_identity;

  if (
       pg_catalog.length(v_identity)
       - pg_catalog.length(pg_catalog.replace(v_identity, v_old, ''))
     ) / pg_catalog.length(v_old) <> 1
     or pg_catalog.strpos(v_identity, 'attempt_credential.id') <> 0
     or pg_catalog.strpos(
          v_identity, '079cd680-47fb-4910-b3d8-27d19356e66e'
        ) = 0
     or pg_catalog.strpos(
          v_identity, '8b2cbfaf-3854-437d-b381-abfd70291354'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'ddccde35-9c58-4856-b673-d7aa27ce4220'
        ) = 0
     or pg_catalog.strpos(v_identity, '800551945442') = 0
     or pg_catalog.strpos(v_identity, '244042196011') = 0
     or pg_catalog.strpos(v_identity, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.strpos(
          v_identity,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'ebay_exact_current_credential_is_valid'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'exact_existing_update_release_is_current'
        ) = 0
  then
    raise exception 'eBay rotating-credential identity preimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_rotating_credential_preimage$;

do $patch_ebay_exact_rotating_credential_identity$
declare
  v_signature constant regprocedure :=
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure;
  v_definition text;
  v_owner oid;
  v_post_owner oid;
  v_old constant text := $old$    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
     and attempt.owner_id = listing.owner_id
     and attempt.credential_id = p_credential_id
     and attempt.channel = listing.channel_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key$old$;
  v_new constant text := $new$    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = listing.operation_attempt_id
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
     and attempt_credential.expires_at is not null
     and attempt_credential.expires_at > statement_timestamp()
     and attempt_credential.last_checked_at is not null
     and attempt_credential.last_check_status = 'passed'
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = listing.channel_key
     and attempt_credential.version <= credential.version$new$;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid), procedure.proowner
    into strict v_definition, v_owner
    from pg_catalog.pg_proc procedure
   where procedure.oid = v_signature;

  if (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
     ) / pg_catalog.length(v_old) <> 1
     or pg_catalog.strpos(v_definition, 'attempt_credential.id') <> 0
  then
    raise exception 'eBay rotating-credential identity patch target mismatch'
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
          v_definition, 'attempt_credential.status in (''active'', ''revoked'')'
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
          v_definition, 'attempt_credential.expires_at > statement_timestamp()'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt_credential.version <= credential.version'
        ) = 0
     or pg_catalog.strpos(
          v_definition, 'attempt.credential_id = p_credential_id'
        ) <> 0
     or pg_catalog.strpos(
          v_definition, 'ebay_exact_current_credential_is_valid'
        ) = 0
  then
    raise exception 'eBay rotating-credential identity patch failed'
      using errcode = '55000';
  end if;
end;
$patch_ebay_exact_rotating_credential_identity$;

do $ebay_exact_rotating_credential_postimage$
declare
  v_identity text;
  v_alias text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_identity;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(uuid,uuid,uuid,text,text)'::regprocedure
  ) into strict v_alias;

  if pg_catalog.strpos(
       v_identity, '079cd680-47fb-4910-b3d8-27d19356e66e'
     ) = 0
     or pg_catalog.strpos(
          v_identity, '8b2cbfaf-3854-437d-b381-abfd70291354'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'ddccde35-9c58-4856-b673-d7aa27ce4220'
        ) = 0
     or pg_catalog.strpos(v_identity, '800551945442') = 0
     or pg_catalog.strpos(v_identity, '244042196011') = 0
     or pg_catalog.strpos(v_identity, 'QA-20260823-CC-001-US') = 0
     or pg_catalog.strpos(
          v_identity,
          'cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f'
        ) = 0
     or pg_catalog.strpos(v_identity, 'listing.price = 12.90') = 0
     or pg_catalog.strpos(v_identity, 'product.on_hand = 1') = 0
     or pg_catalog.strpos(v_identity, 'attempt.status = ''failed''') = 0
     or pg_catalog.strpos(v_identity, 'attempt.http_status = 422') = 0
     or pg_catalog.strpos(v_identity, 'attempt.remote_id is null') = 0
     or pg_catalog.strpos(v_identity, 'attempt.gateway_write_required') = 0
     or pg_catalog.strpos(v_identity, 'attempt.pre_gateway_retryable') = 0
     or pg_catalog.strpos(
          v_identity, 'attempt_job.attempt_id = attempt.id'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'exact_existing_update_release_is_current'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'active_serverless_runtime_release_sha'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'ebay_exact_current_credential_is_valid'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'attempt_credential.id = attempt.credential_id'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'attempt_credential.version <= credential.version'
        ) = 0
     or pg_catalog.strpos(
          v_identity, 'attempt.credential_id = p_credential_id'
        ) <> 0
     or pg_catalog.strpos(
          v_alias,
          'sellerpilot_service_get_ebay_exact_existing_qa_recovery_identit'
        ) = 0
  then
    raise exception 'eBay rotating-credential identity postimage mismatch'
      using errcode = '55000';
  end if;
end;
$ebay_exact_rotating_credential_postimage$;

comment on function
  public.sellerpilot_service_get_ebay_exact_qa_recovery_identity(
    uuid, uuid, uuid, text, text
  ) is
  'Returns exact eBay item 800551945442 identity only when failed pre-provider attempt 079cd680 retains a valid historical provider-certified same-seller credential and the supplied credential is the sole current provider-certified successor.';

commit;
