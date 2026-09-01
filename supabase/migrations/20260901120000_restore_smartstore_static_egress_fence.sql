-- Naver Commerce API accepts calls only from an outbound IPv4 registered on
-- the target application. Restore Smartstore to the same fail-closed
-- database + request-header fixed-egress contract as the other IP-bound
-- channels. This migration deliberately does not enable the policy row: an
-- operator must first verify the actual Vercel outbound IP is registered in
-- Naver Commerce API Center.

begin;

do $migration$
declare
  v_static_definition text;
  v_periodic_definition text;
  v_status_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.serverless_static_egress_allowed(text)'::regprocedure
  ) into v_static_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)'::regprocedure
  ) into v_periodic_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_serverless_static_egress_status()'::regprocedure
  ) into v_status_definition;

  if v_static_definition is null
     or (
       position('when p_channel = ''smartstore'' then true' in lower(v_static_definition)) = 0
       and position(
         'p_channel in (''coupang'', ''smartstore'', ''elevenst'', ''temu'', ''shopee'')'
         in v_static_definition
       ) = 0
     )
     or v_periodic_definition is null
     or position('sellerpilot_310450_enqueue_periodic_sync_unsafe' in v_periodic_definition) = 0
     or v_status_definition is null
     or not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = 'smartstore'
     ) then
    raise exception 'Smartstore static-egress corrective preimage drifted';
  end if;
end;
$migration$;

create or replace function sellerpilot_private.serverless_static_egress_allowed(
  p_channel text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_channel in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')
    and exists (
      select 1
        from sellerpilot_private.serverless_static_egress_policy policy
       where policy.channel = p_channel
         and policy.enabled
    )
    and p_channel = any (
      regexp_split_to_array(
        lower(trim(coalesce(
          nullif(
            coalesce(
              nullif(current_setting('request.headers', true), ''),
              '{}'
            )::jsonb ->> 'x-sellerpilot-static-egress-channels',
            ''
          ),
          ''
        ))),
        '\s*,\s*'
      )
    )
    and not exists (
      select 1
        from unnest(regexp_split_to_array(
          lower(trim(coalesce(
            nullif(
              coalesce(
                nullif(current_setting('request.headers', true), ''),
                '{}'
              )::jsonb ->> 'x-sellerpilot-static-egress-channels',
              ''
            ),
            ''
          ))),
          '\s*,\s*'
        )) entry
       where trim(entry) not in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')
          or trim(entry) = ''
    ),
    false
  );
$$;

revoke all on function sellerpilot_private.serverless_static_egress_allowed(text)
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_serverless_static_egress_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'coupang', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'coupang'
    ), false),
    'smartstore', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'smartstore'
    ), false),
    'elevenst', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'elevenst'
    ), false),
    'temu', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'temu'
    ), false),
    'shopee', coalesce(bool_or(policy.enabled) filter (
      where policy.channel = 'shopee'
    ), false)
  )
  from sellerpilot_private.serverless_static_egress_policy policy;
$$;

revoke all on function public.sellerpilot_service_serverless_static_egress_status()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_serverless_static_egress_status()
  to service_role;

create or replace function public.sellerpilot_service_enqueue_periodic_sync(
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
begin
  if p_channel in ('smartstore', 'temu')
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
          and policy.enabled
     ) then
    return jsonb_build_object(
      'channel', p_channel,
      'operation', p_operation,
      'status', 'fixed_egress_required',
      'blockedReason', 'STATIC_EGRESS_REQUIRED'
    );
  end if;

  return public.sellerpilot_310450_enqueue_periodic_sync_unsafe(
    p_channel,
    p_operation,
    p_request_payload,
    p_min_interval_minutes
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) to service_role;

create or replace function public.sellerpilot_31033000_enqueue_inquiry_reply_unsafe(
  p_ticket_id uuid,
  p_channel text,
  p_reply_text text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel in ('coupang', 'smartstore')
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = p_channel
          and policy.enabled
     ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;

  return public.sellerpilot_20260828_enqueue_reply_before_static_gate(
    p_ticket_id,
    p_channel,
    p_reply_text,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_31033000_enqueue_inquiry_reply_unsafe(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

-- Smartstore product Q&A has a dedicated enqueue path that does not delegate
-- through sellerpilot_31033000_enqueue_inquiry_reply_unsafe. Replace only the
-- prior non-static marker with the restored DB policy check.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old_count integer;
  v_new_count integer;
  v_old constant text := $old$  /* SMARTSTORE_NONSTATIC_EGRESS_V1 */
  null;$old$;
  v_new constant text := $new$  /* SMARTSTORE_STATIC_EGRESS_RESTORED_V1 */
  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'smartstore'
       and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)'::regprocedure
  ) into v_definition;
  v_old_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_old, '')))
      / length(v_old)
  end;
  v_new_count := case when v_definition is null then 0 else
    (length(v_definition) - length(replace(v_definition, v_new, '')))
      / length(v_new)
  end;
  if v_old_count = 0 and v_new_count = 1 then
    null;
  elsif v_old_count = 1 and v_new_count = 0 then
    v_rewritten := replace(v_definition, v_old, v_new);
    if v_rewritten = v_definition
       or position(v_old in v_rewritten) > 0
       or position('SMARTSTORE_STATIC_EGRESS_RESTORED_V1' in v_rewritten) = 0 then
      raise exception 'Smartstore product inquiry static-egress restore failed';
    end if;
    execute v_rewritten;
  else
    raise exception 'Smartstore product inquiry corrective preimage drifted';
  end if;
end;
$migration$;

revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

create or replace function public.sellerpilot_start_inquiry_history_backfill(
  p_history_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'coupang'
       and policy.enabled
  ) or not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'smartstore'
       and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;

  update sellerpilot_private.inquiry_history_backfill_runs run
     set status = 'failed',
         blocked_reason = null,
         failed_jobs = (
           select count(*)::integer
             from sellerpilot_private.channel_gateway_jobs job
            where job.request_payload #>> '{arguments,sellerpilotHistoryRunId}'
                  = run.id::text
              and job.status = 'failed'
         ),
         completed_at = coalesce(run.completed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where run.status = 'blocked'
     and run.history_days = p_history_days
     and run.range_end = (clock_timestamp() at time zone 'Asia/Seoul')::date;

  return public.sellerpilot_20260828_start_history_before_static_egress_gate(
    p_history_days
  );
end;
$$;

revoke all on function public.sellerpilot_start_inquiry_history_backfill(integer)
  from public, anon, service_role;
grant execute on function public.sellerpilot_start_inquiry_history_backfill(integer)
  to authenticated;

-- Jobs accepted while Smartstore incorrectly bypassed the fixed-egress gate
-- must not become delayed sends when the policy is enabled later. Only
-- pre-provider queued CS reads/replies are retired; running or ambiguous jobs
-- are left untouched for their existing completion/reconciliation fences.
update sellerpilot_private.channel_gateway_jobs job
   set status = 'failed',
       error_message = 'STATIC_EGRESS_REQUIRED',
       worker_token_id = null,
       claim_token = null,
       lease_expires_at = null,
       completed_at = clock_timestamp(),
       updated_at = clock_timestamp()
 where job.channel = 'smartstore'
   and job.operation in ('inquiries.list', 'inquiries.reply')
   and job.status = 'queued';

do $migration$
declare
  v_status jsonb;
begin
  perform set_config('request.headers', '{}'::text, true);
  if sellerpilot_private.serverless_static_egress_allowed('smartstore')
       is distinct from false then
    raise exception 'Smartstore static-egress corrective claim postimage failed';
  end if;
  v_status := public.sellerpilot_service_serverless_static_egress_status();
  if not (v_status ?& array[
       'coupang', 'smartstore', 'elevenst', 'temu', 'shopee'
     ])
     or (select count(*) from jsonb_object_keys(v_status)) <> 5 then
    raise exception 'Smartstore static-egress corrective status postimage failed';
  end if;
end;
$migration$;

comment on table sellerpilot_private.serverless_static_egress_policy is
  'Fail-closed DB attestations for channels whose providers require an allowlisted stable outbound IP, including Smartstore.';
comment on function sellerpilot_private.serverless_static_egress_allowed(text) is
  'Requires exact DB policy plus request-header attestation for Coupang, Smartstore, 11st, Temu, and Shopee.';
comment on function public.sellerpilot_service_serverless_static_egress_status() is
  'Returns boolean fixed-egress readiness for Coupang, Smartstore, 11st, Temu, and Shopee only.';
comment on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) is
  'Queues bounded periodic reads and returns fixed_egress_required for Smartstore until its DB policy is explicitly enabled.';

commit;
