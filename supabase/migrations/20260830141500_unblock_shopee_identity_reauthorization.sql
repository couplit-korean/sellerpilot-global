-- Remove one observed Shopee OAuth bootstrap deadlock only when every durable
-- field still proves that neither a provider mutation nor a credential stage
-- occurred. Then keep legacy Shopee credentials behind an account-identity
-- fence: only OAuth reauthorization or the read-only identity diagnostic may
-- run before a provider-certified seller account key exists.

begin;

do $cleanup_exact_unstarted_oauth$
declare
  v_job sellerpilot_private.channel_gateway_jobs%rowtype;
begin
  select job.*
    into v_job
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = 'f4a260cd-bf97-4750-9d19-22f71892d095'::uuid
   for update;

  if not found then
    return;
  end if;

  -- A deployment retry may replay this migration after the exact row was
  -- already cancelled. Accept only the terminal shape written below; a
  -- partially changed or independently cancelled row must still abort.
  if v_job.status is not distinct from 'cancelled' then
    if v_job.channel is distinct from 'shopee'
       or v_job.operation is distinct from 'oauth.exchange'
       or v_job.environment is distinct from 'production'
       or v_job.attempt_count is distinct from 1
       or v_job.credential_refresh_in_flight is distinct from false
       or v_job.credential_refresh_started_at is not null
       or v_job.credential_refresh_fingerprint is not null
       or v_job.prepared_credential_id is not null
       or v_job.credential_refresh_prepared_at is not null
       or v_job.credential_refresh_recovery_vault_id is not null
       or v_job.credential_refresh_recovery_fingerprint is not null
       or v_job.credential_refresh_recovery_staged_at is not null
       or v_job.oauth_request_vault_id is not null
       or not coalesce(
         v_job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$',
         false
       )
       or v_job.oauth_source_credential_id is distinct from v_job.credential_id
       or v_job.oauth_exchange_completed is distinct from false
       or v_job.provider_mutation_started_at is not null
       or v_job.worker_token_id is not null
       or v_job.claim_token is not null
       or v_job.lease_expires_at is not null
       or v_job.completed_at is null
       or v_job.error_message is distinct from
         'Cancelled after exact evidence confirmed no provider or credential mutation.' then
      raise exception
        'observed Shopee OAuth reconciliation no longer matches exact cancelled evidence';
    end if;
    return;
  end if;

  if v_job.channel is distinct from 'shopee'
     or v_job.operation is distinct from 'oauth.exchange'
     or v_job.environment is distinct from 'production'
     or v_job.status is distinct from 'reconciliation_required'
     or v_job.attempt_count is distinct from 1
     or v_job.credential_refresh_in_flight is distinct from true
     or v_job.credential_refresh_started_at is null
     or v_job.credential_refresh_fingerprint is not null
     or v_job.prepared_credential_id is not null
     or v_job.credential_refresh_prepared_at is not null
     or v_job.credential_refresh_recovery_vault_id is not null
     or v_job.credential_refresh_recovery_fingerprint is not null
     or v_job.credential_refresh_recovery_staged_at is not null
     or v_job.oauth_request_vault_id is not null
     or not coalesce(
       v_job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$',
       false
     )
     or v_job.oauth_source_credential_id is distinct from v_job.credential_id
     or v_job.oauth_exchange_completed is distinct from false
     or v_job.provider_mutation_started_at is not null
     or v_job.worker_token_id is not null
     or v_job.claim_token is not null
     or v_job.lease_expires_at is not null
     or v_job.error_message is distinct from
       '채널 인증 갱신 즉시 보존 실패 · HTTP 400' then
    raise exception
      'observed Shopee OAuth reconciliation no longer matches exact no-mutation evidence';
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         credential_refresh_in_flight = false,
         credential_refresh_started_at = null,
         completed_at = coalesce(job.completed_at, clock_timestamp()),
         error_message =
           'Cancelled after exact evidence confirmed no provider or credential mutation.',
         updated_at = clock_timestamp()
   where job.id = v_job.id;
end;
$cleanup_exact_unstarted_oauth$;

do $shopee_identity_claim_fence$
declare
  v_definition text;
  v_rewritten text;
  v_anchor constant text := $old$)
     and (
       (
         job.channel = 'coupang'$old$;
  v_replacement constant text := $new$)
     and (
       job.channel <> 'shopee'
       or job.operation = 'oauth.exchange'
       or (
         job.operation = 'diagnostic.test'
         and credential.seller_account_key is null
         and credential.seller_account_key_source = 'legacy_unattested'
         and credential.seller_account_verified_at is null
       )
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )
     and (
       (
         job.channel = 'coupang'$new$;
begin
  if to_regprocedure(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'
  ) is null then
    return;
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure
  ) into v_definition;

  if position('job.channel <> ''shopee''' in v_definition) > 0 then
    return;
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_anchor, ''))
  ) / length(v_anchor) <> 1 then
    raise exception 'expected one bounded serverless Shopee claim anchor';
  end if;

  v_rewritten := replace(v_definition, v_anchor, v_replacement);
  if v_rewritten = v_definition
     or position('job.channel <> ''shopee''' in v_rewritten) = 0 then
    raise exception 'Shopee provider-identity claim fence rewrite failed';
  end if;

  execute v_rewritten;
end;
$shopee_identity_claim_fence$;

do $privileges$
begin
  if to_regprocedure(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'
  ) is null then
    return;
  end if;

  execute $sql$
    revoke all on function
      public.sellerpilot_claim_serverless_gateway_job(text, text)
      from public, anon, authenticated
  $sql$;
  execute $sql$
    grant execute on function
      public.sellerpilot_claim_serverless_gateway_job(text, text)
      to service_role
  $sql$;
end;
$privileges$;

commit;
