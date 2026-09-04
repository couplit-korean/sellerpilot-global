-- Follow-up to 20260905011000: vault.decrypted_secrets.decrypted_secret is text.
-- Keep the one-job fail-closed claim, but cast the already-decrypted JSON before inspecting shop identity.
begin;

create or replace function public.sellerpilot_claim_exact_shopee_diagnostic_job(
  p_token_hash text,
  p_worker_version text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_claim_token uuid;
  v_result jsonb;
begin
  if p_job_id is distinct from 'e3ef63f5-cd39-4883-898c-60399dbf449c'::uuid then
    return null;
  end if;

  select t.id into v_token_id
    from sellerpilot_private.ai_cli_worker_tokens t
   where t.token_hash = p_token_hash
     and t.status = 'active'
     and t.expires_at > clock_timestamp()
   for update;
  if v_token_id is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = clock_timestamp(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where id = v_token_id;

  begin
    select j.id into v_job_id
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.channel_credentials c
        on c.id = j.credential_id
       and c.status = 'active'
       and c.channel = 'shopee'
     where j.id = 'e3ef63f5-cd39-4883-898c-60399dbf449c'::uuid
       and j.id = p_job_id
       and j.channel = 'shopee'
       and j.operation = 'diagnostic.test'
       and j.status = 'queued'
       and j.environment = 'production'
       and j.provider_mutation_started_at is null
     for update of j, c skip locked;
    if v_job_id is null then
      return null;
    end if;

    v_claim_token := pg_catalog.gen_random_uuid();

    update sellerpilot_private.channel_gateway_jobs j
       set status = 'running',
           worker_token_id = v_token_id,
           claim_token = v_claim_token,
           attempt_count = j.attempt_count + 1,
           lease_expires_at = clock_timestamp() + interval '15 minutes',
           started_at = coalesce(j.started_at, clock_timestamp()),
           error_message = null,
           updated_at = clock_timestamp()
     where j.id = v_job_id
       and j.id = 'e3ef63f5-cd39-4883-898c-60399dbf449c'::uuid
       and j.channel = 'shopee'
       and j.operation = 'diagnostic.test'
       and j.status = 'queued';
    if not found then
      raise exception 'exact Shopee diagnostic claim lost the queued row'
        using errcode = '55000';
    end if;

    select jsonb_build_object(
             'id', j.id,
             'claim_token', j.claim_token,
             'credential_id', j.credential_id,
             'channel', j.channel,
             'operation', j.operation,
             'environment', j.environment,
             'request', j.request_payload,
             'attempt_count', j.attempt_count,
             'credential', d.decrypted_secret::jsonb
           )
      into v_result
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.channel_credentials c on c.id = j.credential_id
      join vault.decrypted_secrets d on d.id = c.vault_secret_id
     where j.id = v_job_id
       and c.status = 'active'
       and c.channel = 'shopee'
       and (
         (d.decrypted_secret::jsonb)->>'shop_id' = '1719148844'
         or exists (
           select 1
             from pg_catalog.jsonb_array_elements(
               coalesce((d.decrypted_secret::jsonb)->'shopee_targets', '[]'::jsonb)
             ) target
            where target->>'type' = 'shop'
              and target->>'id' = '1719148844'
         )
       );
    if v_result is null then
      raise exception 'exact Shopee diagnostic credential shop is not 1719148844'
        using errcode = '55000';
    end if;
    return v_result;
  exception when others then
    return null;
  end;
end;
$$;

revoke all on function public.sellerpilot_claim_exact_shopee_diagnostic_job(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_claim_exact_shopee_diagnostic_job(text, text, uuid)
  to service_role;

commit;
