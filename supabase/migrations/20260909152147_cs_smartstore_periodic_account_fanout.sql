begin;

alter function public.sellerpilot_service_enqueue_periodic_sync(
  text,text,jsonb,integer
) rename to sellerpilot_091225_enqueue_periodic_sync_before_smartstore_fanout;

revoke all on function
  public.sellerpilot_091225_enqueue_periodic_sync_before_smartstore_fanout(
    text,text,jsonb,integer
  ) from public,anon,authenticated,service_role;

create index channel_gateway_jobs_smartstore_periodic_credential_idx
  on sellerpilot_private.channel_gateway_jobs(
    credential_id,
    (left(trim(request_payload->>'periodicKey'),120)),
    created_at desc
  )
  where channel='smartstore' and operation='inquiries.list'
    and nullif(trim(request_payload->>'periodicKey'),'') is not null;

create function public.sellerpilot_service_enqueue_periodic_sync(
  p_channel text,
  p_operation text,
  p_request_payload jsonb,
  p_min_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_request_key text;
  v_credential record;
  v_existing_id uuid;
  v_job_id uuid;
  v_results jsonb:='[]'::jsonb;
  v_status text;
  v_active_count integer:=0;
  v_eligible_count integer:=0;
  v_queued_count integer:=0;
  v_pending_count integer:=0;
  v_expired_count integer:=0;
  v_reconnect_count integer:=0;
  v_failed_count integer:=0;
  v_static_egress_enabled boolean:=true;
begin
  if p_channel<>'smartstore' or p_operation<>'inquiries.list' then
    return public.sellerpilot_091225_enqueue_periodic_sync_before_smartstore_fanout(
      p_channel,p_operation,p_request_payload,p_min_interval_minutes
    );
  end if;

  if jsonb_typeof(p_request_payload) is distinct from 'object'
     or octet_length(p_request_payload::text)>128000
     or p_min_interval_minutes not between 1 and 1440 then
    raise exception 'invalid SmartStore periodic inquiry sync';
  end if;
  v_request_key:=left(trim(p_request_payload->>'periodicKey'),120);
  if v_request_key is null or v_request_key='' then
    raise exception 'invalid SmartStore periodic inquiry key';
  end if;

  if pg_catalog.to_regclass(
    'sellerpilot_private.serverless_static_egress_policy'
  ) is not null then
    execute $policy$
      select exists(
        select 1
          from sellerpilot_private.serverless_static_egress_policy policy
         where policy.channel='smartstore' and policy.enabled
      )
    $policy$ into v_static_egress_enabled;
  end if;
  if not v_static_egress_enabled then
    return jsonb_build_object(
      'contract','sellerpilot-smartstore-periodic-fanout/1',
      'channel',p_channel,
      'operation',p_operation,
      'requestKey',v_request_key,
      'status','fixed_egress_required',
      'results','[]'::jsonb,
      'credentialCount',0,
      'eligibleCount',0,
      'queuedCount',0,
      'pendingCount',0,
      'expiredCount',0,
      'reconnectRequiredCount',0,
      'failedCount',0
    );
  end if;

  for v_credential in
    select credential.id,credential.created_by,credential.environment,
           credential.expires_at,credential.seller_account_key,
           credential.seller_account_key_source,
           credential.seller_account_verified_at
      from sellerpilot_private.channel_credentials credential
     where credential.channel='smartstore'
       and credential.environment='production'
       and credential.status='active'
     order by credential.created_by,credential.seller_account_key,
              credential.version desc,credential.created_at desc,
              credential.id
  loop
    v_active_count:=v_active_count+1;
    if v_credential.expires_at is not null
       and v_credential.expires_at<=v_now then
      v_expired_count:=v_expired_count+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'credentialId',v_credential.id,
        'status','not_connected',
        'reason','CREDENTIAL_EXPIRED'
      ));
      continue;
    end if;
    if v_credential.seller_account_key is null
       or v_credential.seller_account_key_source not in(
         'provider_certified_v1','credential_incarnation_v1'
       )
       or v_credential.seller_account_verified_at is null then
      v_reconnect_count:=v_reconnect_count+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'credentialId',v_credential.id,
        'status','reconnect_required',
        'reason','SMARTSTORE_ACCOUNT_IDENTITY_UNVERIFIED'
      ));
      continue;
    end if;

    v_eligible_count:=v_eligible_count+1;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      'sellerpilot:smartstore-periodic-sync:'||
      v_credential.id::text||':'||v_request_key
    ));
    select job.id into v_existing_id
      from sellerpilot_private.channel_gateway_jobs job
     where job.credential_id=v_credential.id
       and job.channel='smartstore'
       and job.operation='inquiries.list'
       and left(trim(job.request_payload->>'periodicKey'),120)=v_request_key
       and (
         job.status in('queued','running')
         or job.created_at>v_now
           -pg_catalog.make_interval(mins=>p_min_interval_minutes)
       )
     order by job.created_at desc,job.id
     limit 1;

    if v_existing_id is not null then
      v_pending_count:=v_pending_count+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'credentialId',v_credential.id,
        'status','already_pending',
        'jobId',v_existing_id
      ));
      continue;
    end if;

    begin
      v_job_id:=pg_catalog.gen_random_uuid();
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,attempt_id,channel,operation,environment,
        request_payload,created_by
      ) values(
        v_job_id,v_credential.id,null,'smartstore','inquiries.list',
        v_credential.environment,p_request_payload,v_credential.created_by
      );

      insert into sellerpilot_private.channel_sync_state(
        owner_id,channel_key,data_type,status,imported_count,
        last_started_at,last_error,updated_at
      ) values(
        v_credential.created_by,'smartstore','inquiries','queued',0,
        v_now,null,v_now
      )
      on conflict(owner_id,channel_key,data_type) do update set
        status='queued',last_started_at=v_now,last_error=null,updated_at=v_now;

      v_queued_count:=v_queued_count+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'credentialId',v_credential.id,
        'status','queued',
        'jobId',v_job_id
      ));
    exception when others then
      v_failed_count:=v_failed_count+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'credentialId',v_credential.id,
        'status','failed',
        'reason','SMARTSTORE_ACCOUNT_ENQUEUE_FAILED',
        'sqlstate',sqlstate
      ));
    end;
  end loop;

  v_status:=case
    when v_failed_count>0 then 'failed'
    when v_reconnect_count>0 then 'reconnect_required'
    when v_queued_count>0 then 'queued'
    when v_pending_count>0 then 'already_pending'
    else 'not_connected'
  end;
  return jsonb_build_object(
    'contract','sellerpilot-smartstore-periodic-fanout/1',
    'channel','smartstore',
    'operation','inquiries.list',
    'requestKey',v_request_key,
    'status',v_status,
    'results',v_results,
    'credentialCount',v_active_count,
    'eligibleCount',v_eligible_count,
    'queuedCount',v_queued_count,
    'pendingCount',v_pending_count,
    'expiredCount',v_expired_count,
    'reconnectRequiredCount',v_reconnect_count,
    'failedCount',v_failed_count
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_periodic_sync(
  text,text,jsonb,integer
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_enqueue_periodic_sync(
  text,text,jsonb,integer
) to service_role;

comment on function public.sellerpilot_service_enqueue_periodic_sync(
  text,text,jsonb,integer
) is
  'Fans SmartStore inquiry polling out to every exact active production credential while preserving the existing scheduler contract for all other channels.';

commit;
