-- Proposal-only. Apply after 20260908140416_cs_temu_detail_retry_replay.sql.
-- Do not execute from the channel worktree or against production.

begin;

create function sellerpilot_private.enforce_temu_gateway_owner_credential_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'temu' and not exists (
    select 1
      from sellerpilot_private.channel_credentials credential
     where credential.id = new.credential_id
       and credential.channel = 'temu'
       and credential.created_by = new.created_by
  ) then
    raise exception 'TEMU_GATEWAY_OWNER_CREDENTIAL_MISMATCH'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function sellerpilot_private.enforce_temu_gateway_owner_credential_v1()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      left join sellerpilot_private.channel_credentials credential
        on credential.id = job.credential_id
       and credential.channel = 'temu'
       and credential.created_by = job.created_by
     where job.channel = 'temu'
       and credential.id is null
  ) then
    raise exception 'TEMU_GATEWAY_OWNER_CREDENTIAL_BACKFILL_REQUIRED';
  end if;
end
$$;

create trigger enforce_temu_gateway_owner_credential_v1
before insert or update of credential_id, created_by, channel
on sellerpilot_private.channel_gateway_jobs
for each row execute function
  sellerpilot_private.enforce_temu_gateway_owner_credential_v1();

create function public.sellerpilot_service_requeue_temu_after_sales_detail_v3(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_retry_arguments jsonb,
  p_retry_count integer,
  p_retry_after_seconds integer,
  p_deferred_count integer,
  p_replay_count integer,
  p_provider_status integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if not exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.channel_credentials credential
        on credential.id = job.credential_id
       and credential.channel = 'temu'
       and credential.created_by = job.created_by
     where job.id = p_job_id
       and job.channel = 'temu'
       and job.operation = 'inquiries.list'
  ) then
    raise exception 'Temu gateway owner or credential mismatch'
      using errcode = '42501';
  end if;

  return public.sellerpilot_service_requeue_temu_after_sales_detail_v2(
    p_token_hash,
    p_job_id,
    p_claim_token,
    p_retry_arguments,
    p_retry_count,
    p_retry_after_seconds,
    p_deferred_count,
    p_replay_count,
    p_provider_status
  );
end
$$;

revoke all on function public.sellerpilot_service_requeue_temu_after_sales_detail_v3(
  text, uuid, uuid, jsonb, integer, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_service_requeue_temu_after_sales_detail_v3(
  text, uuid, uuid, jsonb, integer, integer, integer, integer, integer
) to service_role;

create function public.sellerpilot_read_cs_history_coverage_v2(
  p_owner_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true
     or p_owner_id is null
     or p_owner_id is distinct from auth.uid() then
    raise exception 'owner administrator required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'contract', 'cs_history_coverage_read_v1',
    'checkedAt', statement_timestamp(),
    'scans', coalesce(jsonb_agg(jsonb_build_object(
      'scanId', id,
      'channel', channel,
      'environment', environment,
      'scopeKey', scope_key,
      'ticketKind', ticket_kind,
      'status', status,
      'rangeStartAt', range_start_at,
      'rangeEndAt', range_end_at,
      'timezone', timezone_name,
      'pageCount', page_count,
      'providerRowCount', provider_row_count,
      'projectedEventCount', projected_event_count,
      'observedUniqueCount', observed_unique_count,
      'repeatedObservationCount', repeated_observation_count,
      'excludedCount', excluded_count,
      'unprocessedCount', unprocessed_count,
      'missingRanges', missing_ranges,
      'startedAt', started_at,
      'scanCompletedAt', scan_completed_at,
      'reconciledAt', reconciled_at,
      'updatedAt', updated_at
    ) order by updated_at desc, id desc) filter (where id is not null), '[]'::jsonb),
    'gaps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'jobId', job_id,
        'channel', channel,
        'environment', environment,
        'scopeKey', scope_key,
        'terminalStatus', terminal_status,
        'firstObservedAt', first_observed_at,
        'lastObservedAt', last_observed_at,
        'resolvedAt', resolved_at
      ) order by last_observed_at desc, job_id desc), '[]'::jsonb)
        from (
          select *
            from sellerpilot_private.cs_history_scan_gaps
           where owner_id = p_owner_id
           order by last_observed_at desc, job_id desc
           limit 100
        ) recent_gap
    )
  ) into v_result
  from (
    select *
      from sellerpilot_private.cs_history_scans
     where owner_id = p_owner_id
     order by updated_at desc, id desc
     limit 100
  ) scan;

  return v_result;
end
$$;

revoke all on function public.sellerpilot_read_cs_history_coverage_v1()
  from authenticated;
revoke all on function public.sellerpilot_read_cs_history_coverage_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_cs_history_coverage_v2(uuid)
  to authenticated;

comment on function public.sellerpilot_service_requeue_temu_after_sales_detail_v3(
  text, uuid, uuid, jsonb, integer, integer, integer, integer, integer
) is
  'Owner-bound Temu after-sales detail retry wrapper; preserves the v2 receipt contract.';
comment on function public.sellerpilot_read_cs_history_coverage_v2(uuid) is
  'Returns only the authenticated administrator owner history coverage and gaps.';

commit;
