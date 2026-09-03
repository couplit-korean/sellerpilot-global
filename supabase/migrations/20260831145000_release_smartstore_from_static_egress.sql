-- Naver Commerce API authenticates Smartstore with its client-credential
-- signature contract; Smartstore is not one of the channels that requires a
-- provider-allowlisted source address. Release only Smartstore from the old
-- fixed-egress fence. The historical policy row is deliberately retained and
-- never enabled here so a rollback/audit can still reconstruct prior state.

begin;

-- When migration history is available, require the exact immediately prior
-- release. Local replay fixtures without Supabase's history table are still
-- fenced by the executable preimages below.
do $migration$
declare
  v_static_definition text;
  v_periodic_definition text;
  v_policy_preimage text;
  v_has_current_history boolean := false;
  v_has_exact_predecessor boolean := false;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $history$
      select
        exists (
          select 1
            from supabase_migrations.schema_migrations migration
           where migration.version >= '20260831143000'
        ),
        exists (
          select 1
            from supabase_migrations.schema_migrations migration
           where migration.version = '20260831143000'
             and migration.name = 'ebay_exact_existing_qa_recovery_fence'
        )
    $history$
      into v_has_current_history, v_has_exact_predecessor;
  end if;

  if v_has_current_history and not v_has_exact_predecessor then
    raise exception 'Smartstore non-static egress migration history drifted';
  end if;

  select pg_catalog.pg_get_functiondef(
    'sellerpilot_private.serverless_static_egress_allowed(text)'::regprocedure
  ) into v_static_definition;
  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)'::regprocedure
  ) into v_periodic_definition;
  if v_static_definition is null
     or (
       position(
         'p_channel in (''coupang'', ''smartstore'', ''elevenst'', ''temu'', ''shopee'')'
         in v_static_definition
       ) = 0
       and position(
         'p_channel in (''coupang'', ''smartstore'', ''elevenst'', ''temu'')'
         in v_static_definition
       ) = 0
       and position('when p_channel = ''smartstore'' then true' in lower(v_static_definition)) = 0
     )
     or v_periodic_definition is null
     or position(
       'sellerpilot_310450_enqueue_periodic_sync_unsafe'
       in v_periodic_definition
     ) = 0 then
    raise exception 'Smartstore non-static egress executable preimage drifted';
  end if;

  select to_jsonb(policy)::text
    into v_policy_preimage
    from sellerpilot_private.serverless_static_egress_policy policy
   where policy.channel = 'smartstore';
  if v_policy_preimage is null then
    raise exception 'retained Smartstore static-egress policy row is missing';
  end if;
  perform set_config(
    'sellerpilot.smartstore_static_policy_preimage',
    v_policy_preimage,
    true
  );
end;
$migration$;

-- Existing serverless claim functions call this predicate for the historical
-- five-channel set. Make Smartstore an explicit non-static exception while
-- preserving both the database policy and request-header attestation for the
-- remaining four fixed-egress channels.
create or replace function sellerpilot_private.serverless_static_egress_allowed(
  p_channel text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_channel = 'smartstore' then true
    else coalesce(
      p_channel in ('coupang', 'elevenst', 'temu', 'shopee')
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
         where trim(entry) not in ('coupang', 'elevenst', 'temu', 'shopee')
            or trim(entry) = ''
      ),
      false
    )
  end;
$$;

revoke all on function sellerpilot_private.serverless_static_egress_allowed(text)
  from public, anon, authenticated, service_role;

-- Do not expose the retained Smartstore audit row as an active static-egress
-- requirement. Every returned key is still an exact boolean and no provider
-- credential or runtime header is disclosed.
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

-- Bypass only the retired Smartstore inquiry gate. Coupang still flows through
-- the previous static-egress wrapper, while Temu keeps its later explicit
-- periodic gate and every unrelated channel keeps the exact predecessor chain.
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
  if p_channel = 'smartstore' and p_operation = 'inquiries.list' then
    return public.sellerpilot_20260828_enqueue_periodic_sync_before_static_egress_gate(
      p_channel,
      p_operation,
      p_request_payload,
      p_min_interval_minutes
    );
  end if;

  if p_channel = 'temu'
     and p_operation = 'inquiries.list'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = 'temu'
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

-- Smartstore customer inquiries delegate through the pre-ledger wrapper. Keep
-- its Coupang fence, but remove Smartstore from that legacy two-channel check.
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
  if p_channel = 'coupang'
     and not exists (
       select 1
         from sellerpilot_private.serverless_static_egress_policy policy
        where policy.channel = 'coupang'
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

-- Smartstore product Q&A has an additional policy check inside the current
-- exact-ID/ledger function. Rewrite exactly that check and abort on any drift;
-- all ID, inbound-generation and duplicate-delivery fences remain unchanged.
do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old_count integer;
  v_new_count integer;
  v_old constant text := $old$  if not exists (
    select 1
      from sellerpilot_private.serverless_static_egress_policy policy
     where policy.channel = 'smartstore'
       and policy.enabled
  ) then
    raise exception 'STATIC_EGRESS_REQUIRED' using errcode = '55000';
  end if;$old$;
  v_new constant text := $new$  /* SMARTSTORE_NONSTATIC_EGRESS_V1 */
  null;$new$;
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
       or position('SMARTSTORE_NONSTATIC_EGRESS_V1' in v_rewritten) = 0 then
      raise exception 'Smartstore product inquiry static-egress rewrite failed';
    end if;
    execute v_rewritten;
  else
    raise exception 'Smartstore product inquiry static-egress preimage drifted';
  end if;
end;
$migration$;

revoke all on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(
  uuid, text, text, jsonb
) to service_role;

-- The 30-day combined history run still includes Coupang, so only Coupang's
-- policy remains a prerequisite. The original bounded history implementation
-- is called directly to avoid the retired Smartstore policy check.
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

-- Migration-local executable postimage proof. Smartstore must be claimable
-- without a runtime header, while every still-static channel must remain
-- closed even if its DB policy happens to be enabled. The retained policy row
-- must be byte-for-byte unchanged, including updated_at.
do $migration$
declare
  v_status jsonb;
  v_policy_postimage text;
begin
  perform set_config('request.headers', '{}'::text, true);
  if sellerpilot_private.serverless_static_egress_allowed('smartstore')
       is distinct from true
     or sellerpilot_private.serverless_static_egress_allowed('coupang')
       is distinct from false
     or sellerpilot_private.serverless_static_egress_allowed('elevenst')
       is distinct from false
     or sellerpilot_private.serverless_static_egress_allowed('temu')
       is distinct from false
     or sellerpilot_private.serverless_static_egress_allowed('shopee')
       is distinct from false then
    raise exception 'Smartstore non-static egress claim postimage failed';
  end if;

  v_status := public.sellerpilot_service_serverless_static_egress_status();
  if v_status ? 'smartstore'
     or not (v_status ?& array['coupang', 'elevenst', 'temu', 'shopee'])
     or (select count(*) from jsonb_object_keys(v_status)) <> 4 then
    raise exception 'Smartstore static-egress status postimage failed';
  end if;

  select to_jsonb(policy)::text
    into v_policy_postimage
    from sellerpilot_private.serverless_static_egress_policy policy
   where policy.channel = 'smartstore';
  if v_policy_postimage is distinct from current_setting(
    'sellerpilot.smartstore_static_policy_preimage',
    true
  ) then
    raise exception 'Smartstore static-egress policy row changed';
  end if;
end;
$migration$;

comment on table sellerpilot_private.serverless_static_egress_policy is
  'Fail-closed egress attestations for Coupang, 11st, Temu, and Shopee; the retained Smartstore row is historical and ignored.';
comment on function sellerpilot_private.serverless_static_egress_allowed(text) is
  'Allows Smartstore without static egress and requires exact DB plus request-header attestation for Coupang, 11st, Temu, and Shopee.';
comment on function public.sellerpilot_service_serverless_static_egress_status() is
  'Returns boolean fixed-egress readiness for Coupang, 11st, Temu, and Shopee only.';
comment on function public.sellerpilot_service_enqueue_periodic_sync(
  text, text, jsonb, integer
) is
  'Queues bounded periodic reads; Smartstore bypasses the retired static-egress gate while Coupang and Temu retain it.';

commit;
