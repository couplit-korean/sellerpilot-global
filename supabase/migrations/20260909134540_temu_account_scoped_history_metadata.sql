begin;

-- The legacy no-argument reader remains available for other channels, but it
-- no longer exposes Temu rows. Temu requires an explicit verified account.
create or replace function public.sellerpilot_read_cs_history_coverage_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'contract','cs_history_coverage_read_v1',
    'checkedAt',statement_timestamp(),
    'scans',coalesce(jsonb_agg(jsonb_build_object(
      'scanId',id,'channel',channel,'environment',environment,'scopeKey',scope_key,
      'ticketKind',ticket_kind,'status',status,'rangeStartAt',range_start_at,
      'rangeEndAt',range_end_at,'timezone',timezone_name,'pageCount',page_count,
      'providerRowCount',provider_row_count,'projectedEventCount',projected_event_count,
      'observedUniqueCount',observed_unique_count,'repeatedObservationCount',repeated_observation_count,
      'excludedCount',excluded_count,'unprocessedCount',unprocessed_count,'missingRanges',missing_ranges,
      'startedAt',started_at,'scanCompletedAt',scan_completed_at,'reconciledAt',reconciled_at,
      'updatedAt',updated_at
    ) order by updated_at desc,id desc) filter (where id is not null),'[]'::jsonb),
    'gaps',(select coalesce(jsonb_agg(jsonb_build_object(
      'jobId',job_id,'channel',channel,'environment',environment,'scopeKey',scope_key,
      'terminalStatus',terminal_status,'firstObservedAt',first_observed_at,
      'lastObservedAt',last_observed_at,'resolvedAt',resolved_at
    ) order by last_observed_at desc,job_id desc),'[]'::jsonb)
      from (select * from sellerpilot_private.cs_history_scan_gaps
        where channel<>'temu' order by last_observed_at desc,job_id desc limit 100) recent_gap)
  ) into v_result
  from (select * from sellerpilot_private.cs_history_scans where channel<>'temu'
    order by updated_at desc,id desc limit 100) scan;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v2(uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_list_temu_cs_accounts_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'contract','sellerpilot-temu-cs-accounts/1','checkedAt',statement_timestamp(),
    'accounts',coalesce(jsonb_agg(jsonb_build_object(
      'credentialId',credential.id,
      'label',format('Temu 운영 계정 · 키 %s · v%s',left(credential.fingerprint,8),credential.version),
      'environment','production','credentialFingerprint',credential.fingerprint,
      'sellerAccountKeyHash',credential.seller_account_key
    )order by credential.version desc,credential.id),'[]'::jsonb)
  )into v_result
  from sellerpilot_private.channel_credentials credential
  where credential.channel='temu' and credential.environment='production'
    and credential.status='active'
    and (credential.expires_at is null or credential.expires_at>clock_timestamp())
    and coalesce(credential.fingerprint,'')<>''
    and credential.seller_account_key~'^[a-f0-9]{64}$'
    and credential.seller_account_key_source='provider_certified_v1'
    and credential.seller_account_verified_at is not null;
  return v_result;
end
$$;

revoke all on function public.sellerpilot_list_temu_cs_accounts_v1()
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_list_temu_cs_accounts_v1()to authenticated;

create function public.sellerpilot_read_cs_history_coverage_v2(p_credential_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_now timestamptz:=statement_timestamp();
  v_scans jsonb;
  v_gaps jsonb;
  v_exact integer;
  v_legacy integer;
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'TEMU_HISTORY_ACCOUNT_SELECTION_INVALID' using errcode='22023';end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'scanId',row.id,'channel',row.channel,'environment',row.environment,'scopeKey',row.scope_key,
    'ticketKind',row.ticket_kind,'status',row.status,'rangeStartAt',row.range_start_at,
    'rangeEndAt',row.range_end_at,'timezone',row.timezone_name,'pageCount',row.page_count,
    'providerRowCount',row.provider_row_count,'projectedEventCount',row.projected_event_count,
    'observedUniqueCount',row.observed_unique_count,'repeatedObservationCount',row.repeated_observation_count,
    'excludedCount',row.excluded_count,'unprocessedCount',row.unprocessed_count,'missingRanges',row.missing_ranges,
    'startedAt',row.started_at,'scanCompletedAt',row.scan_completed_at,'reconciledAt',row.reconciled_at,
    'updatedAt',row.updated_at
  )order by row.updated_at desc,row.id desc),'[]'::jsonb)into v_scans
  from(select scan.* from sellerpilot_private.cs_history_scans scan
    join sellerpilot_private.channel_gateway_jobs root on root.id=scan.root_job_id
   where scan.channel='temu' and scan.environment='production'
     and scan.credential_id=v_credential.id and scan.owner_id=v_credential.created_by
     and root.credential_id=v_credential.id and root.created_by=v_credential.created_by
     and root.channel='temu' and root.operation='inquiries.list'
     and (root.seller_account_key=v_credential.seller_account_key or root.seller_account_key is null)
   order by scan.updated_at desc,scan.id desc limit 100)row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',row.job_id,'channel',row.channel,'environment',row.environment,'scopeKey',row.scope_key,
    'terminalStatus',row.terminal_status,'firstObservedAt',row.first_observed_at,
    'lastObservedAt',row.last_observed_at,'resolvedAt',row.resolved_at
  )order by row.last_observed_at desc,row.job_id desc),'[]'::jsonb)into v_gaps
  from(select gap.* from sellerpilot_private.cs_history_scan_gaps gap
    join sellerpilot_private.channel_gateway_jobs job on job.id=gap.job_id
   where gap.channel='temu' and gap.environment='production'
     and gap.credential_id=v_credential.id and gap.owner_id=v_credential.created_by
     and job.credential_id=v_credential.id and job.created_by=v_credential.created_by
     and job.channel='temu' and job.operation='inquiries.list'
     and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
   order by gap.last_observed_at desc,gap.job_id desc limit 100)row;

  select count(*)filter(where seller_key=v_credential.seller_account_key)::integer,
         count(*)filter(where seller_key is null)::integer into v_exact,v_legacy
  from(
    select root.seller_account_key seller_key from sellerpilot_private.cs_history_scans scan
      join sellerpilot_private.channel_gateway_jobs root on root.id=scan.root_job_id
     where scan.channel='temu' and scan.environment='production'
       and scan.credential_id=v_credential.id and scan.owner_id=v_credential.created_by
       and root.credential_id=v_credential.id and root.created_by=v_credential.created_by
       and (root.seller_account_key=v_credential.seller_account_key or root.seller_account_key is null)
    union all
    select job.seller_account_key from sellerpilot_private.cs_history_scan_gaps gap
      join sellerpilot_private.channel_gateway_jobs job on job.id=gap.job_id
     where gap.channel='temu' and gap.environment='production'
       and gap.credential_id=v_credential.id and gap.owner_id=v_credential.created_by
       and job.credential_id=v_credential.id and job.created_by=v_credential.created_by
       and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
  )binding;

  return jsonb_build_object(
    'contract','cs_history_coverage_read_v2','checkedAt',v_now,
    'credentialId',v_credential.id,'sellerAccountKeyHash',v_credential.seller_account_key,
    'coverage',jsonb_build_object('contract','cs_history_coverage_read_v1','checkedAt',v_now,
      'scans',v_scans,'gaps',v_gaps),
    'bindingSummary',jsonb_build_object('exactSellerRows',v_exact,'legacyCredentialRows',v_legacy)
  );
end
$$;

revoke all on function public.sellerpilot_read_cs_history_coverage_v2(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_cs_history_coverage_v2(uuid)to authenticated;

create function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(
  p_credential_id uuid,p_job_id uuid default null
)returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_rows jsonb;
begin
  if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='temu'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key~'^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then raise exception 'TEMU_RETRY_ACCOUNT_SELECTION_INVALID' using errcode='22023';end if;
  if p_job_id is not null and not exists(
    select 1 from sellerpilot_private.channel_gateway_jobs job
     where job.id=p_job_id and job.credential_id=v_credential.id
       and job.created_by=v_credential.created_by and job.channel='temu'
       and job.operation='inquiries.list'
       and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
  )then raise exception 'TEMU_RETRY_JOB_SCOPE_MISMATCH' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',row.job_id,'retryCount',row.retry_count,'deferredCount',row.deferred_count,
    'replayCount',row.replay_count,'providerStatus',row.provider_status,
    'failureCode',row.failure_code,'observedAt',row.observed_at,
    'nextAttemptAt',row.next_attempt_at,'outcome',row.outcome,'resolvedAt',row.resolved_at,
    'accountBinding',case when row.seller_account_key is null then'legacy_credential_owner'
      else'credential_seller_exact'end
  )order by row.observed_at desc,row.job_id,row.retry_count desc),'[]'::jsonb)into v_rows
  from(select ledger.*,job.seller_account_key
    from sellerpilot_private.temu_after_sales_detail_retry_ledger ledger
    join sellerpilot_private.channel_gateway_jobs job on job.id=ledger.job_id
   where job.credential_id=v_credential.id and job.created_by=v_credential.created_by
     and job.channel='temu' and job.operation='inquiries.list'
     and (job.seller_account_key=v_credential.seller_account_key or job.seller_account_key is null)
     and (p_job_id is null or job.id=p_job_id)
   order by ledger.observed_at desc,ledger.job_id,ledger.retry_count desc limit 100)row;
  return jsonb_build_object(
    'contract','sellerpilot-temu-detail-retry-read/1','checkedAt',statement_timestamp(),
    'credentialId',v_credential.id,'sellerAccountKeyHash',v_credential.seller_account_key,
    'retries',v_rows
  );
end
$$;

revoke all on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(uuid,uuid)
  to authenticated;

comment on function public.sellerpilot_read_cs_history_coverage_v2(uuid)is
  'Reads Temu history coverage for one explicitly selected active provider-certified credential. Shared admins may select accounts; worker ownership is never used as seller ownership.';
comment on function public.sellerpilot_admin_temu_after_sales_detail_retry_status_v3(uuid,uuid)is
  'Reads body-free Temu detail retry metadata for one selected credential and seller binding, with credential-owner compatibility for legacy jobs lacking seller_account_key.';

notify pgrst,'reload schema';
commit;
