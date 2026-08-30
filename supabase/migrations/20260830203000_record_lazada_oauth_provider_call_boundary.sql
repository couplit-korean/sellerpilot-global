-- Distinguish the durable credential-refresh fence from the narrower moment
-- when the worker is ready to dispatch Lazada's token request. This marker is
-- intentionally separate from provider_mutation_started_at: the latter is a
-- listing/CS write fence and existing Lazada recovery logic relies on it
-- remaining null for a successful OAuth credential rotation.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists oauth_provider_call_started_at timestamptz;

create index if not exists channel_gateway_jobs_lazada_oauth_provider_call_idx
  on sellerpilot_private.channel_gateway_jobs (
    oauth_provider_call_started_at,
    id
  )
  where channel = 'lazada'
    and operation = 'oauth.exchange'
    and oauth_provider_call_started_at is not null;

create or replace function public.sellerpilot_service_mark_lazada_oauth_provider_call_started(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marked boolean;
  v_provider_call_started_at timestamptz := clock_timestamp();
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_claim_token is null then
    raise exception 'invalid worker token' using errcode = '42501';
  end if;

  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash,
    p_job_id,
    p_claim_token,
    true
  ) then
    return false;
  end if;

  -- The credential fence must already be durable, while no token response or
  -- staged replacement may exist yet. The Vault reference proves that the
  -- authorization code was never copied into the ordinary job payload.
  update sellerpilot_private.channel_gateway_jobs job
     set oauth_provider_call_started_at = coalesce(
           job.oauth_provider_call_started_at,
           v_provider_call_started_at
         ),
         updated_at = v_provider_call_started_at
   where job.id = p_job_id
     and job.channel = 'lazada'
     and job.operation = 'oauth.exchange'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and job.credential_refresh_in_flight
     and job.started_at is not null
     and job.credential_refresh_started_at is not null
     and job.started_at <= job.credential_refresh_started_at
     and job.credential_refresh_started_at <= coalesce(
           job.oauth_provider_call_started_at,
           v_provider_call_started_at
         )
     and not job.oauth_exchange_completed
     and job.prepared_credential_id is null
     and job.credential_refresh_recovery_vault_id is null
     and job.provider_mutation_started_at is null
     and job.oauth_source_credential_id is not null
     and job.oauth_request_vault_id is not null
     and job.oauth_request_fingerprint ~ '^[a-f0-9]{64}$'
     and job.request_payload = jsonb_build_object('vaultBacked', true)
  returning true into v_marked;

  return coalesce(v_marked, false);
end;
$$;

revoke all on function
  public.sellerpilot_service_mark_lazada_oauth_provider_call_started(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_mark_lazada_oauth_provider_call_started(
    text, uuid, uuid
  ) to service_role;

comment on column
  sellerpilot_private.channel_gateway_jobs.oauth_provider_call_started_at is
  'Fail-closed boundary recorded immediately before a Vault-backed Lazada OAuth token request; contains no provider payload, authorization code, token, request id, or account data.';

comment on function
  public.sellerpilot_service_mark_lazada_oauth_provider_call_started(
    text, uuid, uuid
  ) is
  'Marks only the owned, fenced, Vault-backed Lazada OAuth provider-call boundary without storing request or response data.';

commit;
