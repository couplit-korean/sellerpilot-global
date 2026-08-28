-- Extend the bounded Vercel CS worker to the existing Qoo10 inquiry contracts.
-- This migration changes only the dedicated serverless_cs claim/ownership
-- surface. It does not broaden the persistent gateway token or any UI/API
-- marketplace scope.

begin;

drop index if exists
  sellerpilot_private.channel_gateway_jobs_serverless_cs_queue_idx;
create index channel_gateway_jobs_serverless_cs_queue_idx
  on sellerpilot_private.channel_gateway_jobs (created_at, id)
  where status = 'queued'
    and channel in ('ebay', 'coupang', 'smartstore', 'qoo10')
    and operation in ('inquiries.list', 'inquiries.reply');

create or replace function sellerpilot_private.serverless_cs_job_is_owned(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_require_live_lease boolean default true
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
      join sellerpilot_private.channel_gateway_jobs job
        on job.worker_token_id = token.id
     where token.token_hash = p_token_hash
       and token.scope = 'serverless_cs'
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and job.id = p_job_id
       and job.claim_token = p_claim_token
       and job.channel in ('ebay', 'coupang', 'smartstore', 'qoo10')
       and job.operation in ('inquiries.list', 'inquiries.reply')
       and (
         not p_require_live_lease
         or (
           job.status = 'running'
           and job.lease_expires_at > clock_timestamp()
         )
       )
  );
$$;

create or replace function sellerpilot_private.worker_token_may_complete_gateway_job(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where token.token_hash = p_token_hash
       and token.status = 'active'
       and token.expires_at > clock_timestamp()
       and (
         token.scope in ('gateway', 'legacy_combined')
         or (
           token.scope = 'serverless_cs'
           and (
             exists (
               select 1
                 from sellerpilot_private.channel_gateway_jobs job
                where job.id = p_job_id
                  and job.worker_token_id = token.id
                  and job.claim_token = p_claim_token
                  and job.channel in ('ebay', 'coupang', 'smartstore', 'qoo10')
                  and job.operation in ('inquiries.list', 'inquiries.reply')
             )
             or exists (
               select 1
                 from sellerpilot_private.gateway_completion_receipts receipt
                 join sellerpilot_private.channel_gateway_jobs job
                   on job.id = receipt.job_id
                where receipt.job_id = p_job_id
                  and receipt.worker_token_id = token.id
                  and receipt.claim_token = p_claim_token
                  and job.channel in ('ebay', 'coupang', 'smartstore', 'qoo10')
                  and job.operation in ('inquiries.list', 'inquiries.reply')
             )
           )
         )
       )
  );
$$;

-- Keep the proven claim body and its lease/cooldown behavior intact. Widen
-- only its three channel predicates, and fail closed if the preceding function
-- body has drifted from the version this migration was reviewed against.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_occurrences integer;
  v_old constant text := 'job.channel in (''ebay'', ''coupang'', ''smartstore'')';
  v_new constant text := 'job.channel in (''ebay'', ''coupang'', ''smartstore'', ''qoo10'')';
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_cs_job(text,text)'::regprocedure
  ) into v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);
  if v_occurrences <> 3 then
    raise exception
      'expected three serverless CS claim channel guards, found %',
      v_occurrences;
  end if;

  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition or position(v_old in v_rewritten) > 0 then
    raise exception 'serverless CS claim channel guard rewrite failed';
  end if;
  execute v_rewritten;
end;
$migration$;

create or replace function public.sellerpilot_service_begin_serverless_cs_provider_mutation(
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
  v_started boolean;
begin
  if not sellerpilot_private.serverless_cs_job_is_owned(
    p_token_hash, p_job_id, p_claim_token, true
  ) then
    return false;
  end if;

  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at = coalesce(
           job.provider_mutation_started_at,
           clock_timestamp()
         ),
         updated_at = clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens token
   where job.id = p_job_id
     and job.channel in ('ebay', 'coupang', 'smartstore', 'qoo10')
     and job.operation = 'inquiries.reply'
     and job.status = 'running'
     and job.claim_token = p_claim_token
     and job.lease_expires_at > clock_timestamp()
     and token.id = job.worker_token_id
     and token.token_hash = p_token_hash
     and token.scope = 'serverless_cs'
     and token.status = 'active'
     and token.expires_at > clock_timestamp()
  returning true into v_started;

  return coalesce(v_started, false);
end;
$$;

revoke all on function sellerpilot_private.serverless_cs_job_is_owned(
  text, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function sellerpilot_private.worker_token_may_complete_gateway_job(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.sellerpilot_claim_serverless_cs_job(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_claim_serverless_cs_job(text, text)
  to service_role;

revoke all on function
  public.sellerpilot_service_begin_serverless_cs_provider_mutation(
    text, uuid, uuid
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_begin_serverless_cs_provider_mutation(
    text, uuid, uuid
  ) to service_role;

comment on function public.sellerpilot_claim_serverless_cs_job(text, text) is
  'Claims at most one eBay, Coupang, Smartstore, or Qoo10 inquiries.list/reply job for the bounded Vercel runtime.';

commit;
