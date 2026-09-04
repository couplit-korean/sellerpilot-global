-- Persist the operator-verified 2026-09-04 local gateway routing state.
-- Why:
-- 1. Shopee category/diagnostic and listing writes must run from the Mac IP
--    already registered with the provider; Vercel has rotating egress.
-- 2. A live serverless_cs token must not suppress all eligible local claims.
-- 3. A fresh passed Shopee diagnostic may supersede older read-only
--    reconciliation blockers that never started a provider mutation.
-- 4. 11st listing.create may use the same registered Mac egress so an
--    isolated retry is not left behind the fixed-egress handoff branch.
--
-- This definition was captured from pg_get_functiondef after the bounded live
-- overlays were verified. It does not fail-complete or rewrite existing jobs.

CREATE OR REPLACE FUNCTION public.sellerpilot_11820_claim_gateway_unsafe(p_token_hash text, p_worker_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
begin
  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > now()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  with expired as (
    update sellerpilot_private.channel_gateway_jobs j
       set status = case
             when j.oauth_exchange_completed and not j.credential_refresh_in_flight then 'succeeded'
             when j.credential_refresh_in_flight
               or (
                 j.operation = 'oauth.exchange'
                 and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null)
               )
               or j.operation in (
               'listing.create', 'listing.update', 'listing.stop',
               'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
             ) then 'reconciliation_required'
             when j.attempt_count >= 4 then 'failed'
             else 'queued'
           end,
           error_message = case
             when j.oauth_exchange_completed and not j.credential_refresh_in_flight then null
             when j.credential_refresh_in_flight then
               'Gateway credential refresh outcome requires reconciliation.'
             when j.operation = 'oauth.exchange'
               and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null) then
               'Gateway OAuth exchange was only partially staged; provider outcome requires reconciliation.'
             when j.operation in (
               'listing.create', 'listing.update', 'listing.stop',
               'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
             ) then 'Gateway write lease expired; provider outcome requires reconciliation.'
             when j.attempt_count >= 4 then 'Channel worker lease expired four times.'
             else j.error_message
           end,
           response_payload = case
             when j.oauth_exchange_completed and not j.credential_refresh_in_flight then
               jsonb_build_object(
                 'ok', true,
                 'channel', j.channel,
                 'operation', 'oauth.exchange',
                 'safeMessage', 'OAuth credential was durably staged before worker completion was interrupted.'
               )
             else j.response_payload
           end,
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = case
             when j.oauth_exchange_completed
               or j.credential_refresh_in_flight
               or (
                 j.operation = 'oauth.exchange'
                 and (j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is not null)
               )
               or j.operation in (
               'listing.create', 'listing.update', 'listing.stop',
               'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
             ) or j.attempt_count >= 4 then now()
             else j.completed_at
           end,
           updated_at = now()
     where j.status = 'running'
       and (j.lease_expires_at is null or j.lease_expires_at < now())
    returning j.attempt_id, j.operation
  ), reconciled_attempts as (
    update sellerpilot_private.channel_operation_attempts a
       set status = 'manual_required',
           http_status = 409,
           safe_message = 'Gateway write lease expired; provider outcome requires reconciliation.',
           completed_at = now()
      from expired e
     where e.attempt_id = a.id
       and e.operation in (
         'listing.create', 'listing.update', 'listing.stop',
         'price.update', 'inventory.update', 'shipment.acknowledge', 'shipment.confirm'
       )
       and a.status in ('running', 'failed', 'manual_required')
    returning a.id
  )
  update sellerpilot_private.product_listings l
     set status = 'failed',
         last_error = 'Gateway write lease expired; provider outcome requires reconciliation.',
         failure_class = 'external_action',
         updated_at = now()
    from expired e
   where e.attempt_id = l.operation_attempt_id
     and e.operation in ('listing.create', 'listing.update', 'listing.stop');

  -- A terminal OAuth grant has either been consumed or made unsafe by an
  -- uncertain provider call. Remove its encrypted request as part of the same
  -- claim transaction before any unrelated work can start.
  delete from vault.secrets s
   using sellerpilot_private.channel_gateway_jobs j
   where s.id = j.oauth_request_vault_id
     and j.operation = 'oauth.exchange'
     and j.status in ('succeeded', 'failed', 'cancelled', 'reconciliation_required')
     and j.oauth_request_vault_id is not null;

  update sellerpilot_private.channel_gateway_jobs j
     set oauth_request_vault_id = null,
         updated_at = now()
   where j.operation = 'oauth.exchange'
     and j.status in ('succeeded', 'failed', 'cancelled', 'reconciliation_required')
     and j.oauth_request_vault_id is not null;

  -- A lease may expire after a credential was rotated. Repoint only after the
  -- job is queued; a still-live provider call keeps its original credential.
  update sellerpilot_private.channel_gateway_jobs j
     set credential_id = active_c.id,
         updated_at = now()
    from sellerpilot_private.channel_credentials old_c,
         sellerpilot_private.channel_credentials active_c
   where j.credential_id = old_c.id
     and j.status = 'queued'
     and old_c.status <> 'active'
     and active_c.channel = old_c.channel
     and active_c.environment = old_c.environment
     and active_c.status = 'active'
     and active_c.id <> old_c.id;

  -- Lock the credential row with the job row. Concurrent claims skip every
  -- other queued job for that credential, while unrelated credentials remain
  -- independently claimable.
  select j.id into v_job_id
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c
      on c.id = j.credential_id
     and c.status = 'active'
   where j.status = 'queued'
     and not (
       (
         j.channel = 'shopee' and false and j.operation not in (
                    'categories.list', 'categories.suggest',
                                  'categories.attributes', 'categories.validate', 'diagnostic.test'
                                              )
         or (
           sellerpilot_private.serverless_gateway_job_allowed(
             j.channel,
             j.operation
           )
           and ((j.channel in ('coupang', 'smartstore', 'temu')
                 or (j.channel = 'elevenst' and j.operation is distinct from 'listing.create'))
                  or (false and j.channel = 'shopee' and j.operation in (
                                'categories.list', 'categories.suggest',
                                              'categories.attributes', 'categories.validate', 'diagnostic.test'
                                                          )))
         )
       )
       or (
         sellerpilot_private.serverless_gateway_job_allowed(
           j.channel,
           j.operation
         )
         and exists (
           select 1
             from sellerpilot_private.ai_cli_worker_tokens serverless_token
            where false and serverless_token.scope = 'serverless_cs'
              and serverless_token.status = 'active'
              and serverless_token.expires_at > clock_timestamp()
         )
       )
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running
         join sellerpilot_private.channel_credentials running_c
           on running_c.id = running.credential_id
        where running_c.channel = c.channel
          and running_c.environment = c.environment
          and running.status = 'running'
     )
     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs unresolved
         join sellerpilot_private.channel_credentials unresolved_c
           on unresolved_c.id = unresolved.credential_id
        where unresolved_c.channel = c.channel
          and unresolved_c.environment = c.environment
          and unresolved.status = 'reconciliation_required'
           and not (
             j.channel = 'shopee'
             and (
               j.operation in ('categories.list','categories.suggest','categories.attributes','categories.validate','diagnostic.test')
               or (
                 j.operation = 'listing.create'
                 and unresolved.provider_mutation_started_at is null
                 and c.last_check_status = 'passed'
                 and c.last_checked_at is not null
                 and c.last_checked_at > coalesce(unresolved.completed_at, unresolved.updated_at)
               )
             )
           )
           and not (
                  j.channel = 'shopee'
                         and j.operation in (
                                  'categories.list',
                                           'categories.suggest',
                                                    'categories.attributes',
                                                             'categories.validate',
                                                                      'diagnostic.test'
                                                                             )
                                                                                  )
                and not (
                            j.channel = 'shopee'
                                        and j.operation in (
                                                      'categories.list', 'categories.suggest',
                                                                    'categories.attributes', 'categories.validate', 'diagnostic.test'
                                                                                )
                                                                                            and unresolved.operation is distinct from 'oauth.exchange'
                                                                                                        and unresolved.provider_mutation_started_at is null
                                                                                                                  )
          and (
            unresolved.credential_refresh_in_flight
            or unresolved.credential_refresh_recovery_vault_id is not null
            or (
              unresolved.operation = 'oauth.exchange'
              and unresolved.prepared_credential_id is not null
              and not unresolved.oauth_exchange_completed
            )
          )
     )
   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)
         then 0
       else 1
     end,
     case when j.prepared_credential_id is null then 1 else 0 end,
     case when j.attempt_id is null then 1 else 0 end,
     case
       when j.operation = 'inquiries.reply' then 0
       when coalesce(j.request_payload->>'periodicKey', '') like 'inquiries:history:%'
         or nullif(j.request_payload #>> '{arguments,sellerpilotHistoryRunId}', '') is not null
         then 2
       else 1
     end,
     j.created_at,
     j.id
   for update of j, c skip locked
   limit 1;
  if v_job_id is null then return null; end if;

  v_claim_token := gen_random_uuid();

  update sellerpilot_private.channel_gateway_jobs j
     set status = 'running',
         worker_token_id = v_token_id,
         claim_token = v_claim_token,
         attempt_count = j.attempt_count + 1,
         lease_expires_at = now() + interval '15 minutes',
         started_at = coalesce(j.started_at, now()),
         error_message = null,
         updated_at = now()
   where j.id = v_job_id;

  select jsonb_build_object(
    'id', j.id,
    'claim_token', j.claim_token,
    'credential_id', j.credential_id,
    'channel', j.channel,
    'operation', j.operation,
    'environment', j.environment,
    'request', case
      when j.operation = 'oauth.exchange' then oauth_d.decrypted_secret::jsonb
      else j.request_payload
    end,
    'attempt_count', j.attempt_count,
    'credential', d.decrypted_secret::jsonb
  ) into v_result
    from sellerpilot_private.channel_gateway_jobs j
    join sellerpilot_private.channel_credentials c on c.id = j.credential_id
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
    left join vault.decrypted_secrets oauth_d on oauth_d.id = j.oauth_request_vault_id
   where j.id = v_job_id
     and c.status = 'active'
     and (j.operation <> 'oauth.exchange' or oauth_d.decrypted_secret is not null);

  if v_result is null then
    update sellerpilot_private.channel_gateway_jobs j
       set status = 'failed',
           error_message = 'Active credential could not be decrypted.',
           worker_token_id = null,
           claim_token = null,
           lease_expires_at = null,
           completed_at = now(),
           updated_at = now()
     where j.id = v_job_id;

    update sellerpilot_private.channel_operation_attempts a
       set status = 'failed',
           http_status = 422,
           safe_message = 'Active credential could not be decrypted.',
           completed_at = now()
      from sellerpilot_private.channel_gateway_jobs j
     where j.id = v_job_id
       and j.operation in ('listing.create', 'listing.update', 'listing.stop')
       and a.id = j.attempt_id
       and a.status in ('running', 'failed');

    update sellerpilot_private.product_listings l
       set status = 'failed',
           last_error = 'Active credential could not be decrypted.',
           failure_class = 'retryable',
           updated_at = now()
      from sellerpilot_private.channel_gateway_jobs j
     where j.id = v_job_id
       and j.operation in ('listing.create', 'listing.update', 'listing.stop')
       and l.operation_attempt_id = j.attempt_id;

    delete from vault.secrets s
     using sellerpilot_private.channel_gateway_jobs j
     where s.id = j.oauth_request_vault_id
       and j.id = v_job_id
       and j.oauth_request_vault_id is not null;
    update sellerpilot_private.channel_gateway_jobs
       set oauth_request_vault_id = null,
           updated_at = now()
     where id = v_job_id;
  end if;
  return v_result;
end;
$function$
  ;

revoke all on function public.sellerpilot_11820_claim_gateway_unsafe(text, text)
  from public, anon, authenticated, service_role;
