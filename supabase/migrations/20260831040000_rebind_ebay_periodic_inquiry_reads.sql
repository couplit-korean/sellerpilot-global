-- An eBay inquiry read can predate provider identity certification on the
-- same credential row. The gateway lineage trigger correctly leaves that
-- already-created job immutable, but the periodic dedupe used to keep
-- returning the now-unclaimable job forever. Close only untouched periodic
-- reads whose lineage no longer matches the current certified credential,
-- then let the existing enqueue function create a freshly bound read.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('sellerpilot:rebind-ebay-periodic-inquiry-reads:v1')
);
lock table sellerpilot_private.channel_gateway_jobs
  in share row exclusive mode;

with cancelled as (
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         error_message = 'EBAY_PERIODIC_INQUIRY_LINEAGE_REBIND_REQUIRED',
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
    from sellerpilot_private.channel_credentials credential
   where job.credential_id = credential.id
     and job.channel = 'ebay'
     and job.operation = 'inquiries.list'
     and job.status = 'queued'
     and job.attempt_count = 0
     and job.attempt_id is null
     and job.worker_token_id is null
     and job.claim_token is null
     and job.lease_expires_at is null
     and job.started_at is null
     and job.provider_mutation_started_at is null
     and nullif(trim(job.request_payload->>'periodicKey'), '') is not null
     and credential.channel = 'ebay'
     and credential.environment = 'production'
     and job.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null
       or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source = 'provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and job.seller_account_key is distinct from
           credential.seller_account_key
  returning job.id, job.created_by
)
insert into sellerpilot_private.operation_audit (
  owner_id, action, entity_type, entity_id, safe_detail
)
select
  cancelled.created_by,
  'ebay_periodic_inquiry_lineage_rebind',
  'channel_gateway_job',
  cancelled.id::text,
  jsonb_build_object(
    'channel', 'ebay',
    'operation', 'inquiries.list',
    'reason', 'provider_identity_certified_after_enqueue',
    'periodic', true
  )
from cancelled;

alter function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) rename to sellerpilot_310400_enqueue_periodic_sync_unsafe;

revoke all on function
  public.sellerpilot_310400_enqueue_periodic_sync_unsafe(
    text, text, jsonb, integer
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_periodic_sync(
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential record;
  v_request_key text;
  v_cancelled_job_id uuid;
  v_forward_payload jsonb := p_request_payload;
begin
  if p_channel = 'ebay'
     and p_operation = 'inquiries.list'
     and jsonb_typeof(p_request_payload) = 'object'
     and octet_length(p_request_payload::text) <= 128000
     and p_min_interval_minutes between 1 and 60
     and nullif(trim(p_request_payload->>'periodicKey'), '') is not null then
    v_request_key := left(trim(p_request_payload->>'periodicKey'), 120);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      'sellerpilot:periodic-sync:' || p_channel || ':' || p_operation || ':' ||
      v_request_key
    ));

    select credential.id,
           credential.created_by,
           credential.seller_account_key,
           credential.environment
      into v_credential
      from sellerpilot_private.channel_credentials credential
     where credential.channel = 'ebay'
       and credential.environment = 'production'
       and credential.status = 'active'
       and (credential.expires_at is null
         or credential.expires_at > clock_timestamp())
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source = 'provider_certified_v1'
       and credential.seller_account_verified_at is not null
     order by credential.version desc,
              credential.created_at desc,
              credential.id
     limit 1;

    if v_credential.id is not null then
      update sellerpilot_private.channel_gateway_jobs job
         set status = 'cancelled',
             error_message =
               'EBAY_PERIODIC_INQUIRY_LINEAGE_REBIND_REQUIRED',
             completed_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where job.credential_id = v_credential.id
         and job.channel = 'ebay'
         and job.operation = 'inquiries.list'
         and job.status = 'queued'
         and job.attempt_count = 0
         and job.attempt_id is null
         and job.worker_token_id is null
         and job.claim_token is null
         and job.lease_expires_at is null
         and job.started_at is null
         and job.provider_mutation_started_at is null
         and job.environment = 'production'
         and left(trim(job.request_payload->>'periodicKey'), 120) =
               v_request_key
         and job.seller_account_key is distinct from
               v_credential.seller_account_key
      returning job.id into v_cancelled_job_id;

      if v_cancelled_job_id is not null then
        insert into sellerpilot_private.operation_audit (
          owner_id, action, entity_type, entity_id, safe_detail
        ) values (
          v_credential.created_by,
          'ebay_periodic_inquiry_lineage_rebind',
          'channel_gateway_job',
          v_cancelled_job_id::text,
          jsonb_build_object(
            'channel', 'ebay',
            'operation', 'inquiries.list',
            'reason', 'provider_identity_certified_after_enqueue',
            'periodic', true
          )
        );
      end if;

      -- The predecessor intentionally treats any recently-created terminal
      -- row as a cooldown hit. A newly-cancelled lineage-less row would
      -- therefore still return already_pending for five minutes. Bind the
      -- dedupe generation to the certified seller identity only when no
      -- healthy raw-key cooldown is in force. Provider arguments are
      -- unchanged; periodicKey is internal scheduler metadata.
      if v_cancelled_job_id is not null or not exists (
        select 1
          from sellerpilot_private.channel_gateway_jobs job
         where job.credential_id = v_credential.id
           and job.channel = 'ebay'
           and job.operation = 'inquiries.list'
           and left(trim(job.request_payload->>'periodicKey'), 120) =
                 v_request_key
           and (
             job.status in ('queued', 'running')
             or job.created_at > clock_timestamp()
                  - make_interval(mins => p_min_interval_minutes)
           )
           and job.error_message is distinct from
                 'EBAY_PERIODIC_INQUIRY_LINEAGE_REBIND_REQUIRED'
      ) then
        v_forward_payload := jsonb_set(
          p_request_payload,
          '{periodicKey}',
          to_jsonb(
            'ebay-inquiries:v1:' || pg_catalog.md5(
              v_request_key || E'\x1f' || v_credential.seller_account_key
            )
          ),
          false
        );
      end if;
    end if;
  end if;

  return public.sellerpilot_310400_enqueue_periodic_sync_unsafe(
    p_channel,
    p_operation,
    v_forward_payload,
    p_min_interval_minutes
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) to service_role;

comment on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) is
  'Queues bounded periodic reads and replaces only untouched eBay inquiry reads whose seller lineage predates provider certification.';

commit;
