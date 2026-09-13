-- Repair GET collection scheduling after a certified same-seller credential
-- rotation. This changes no product, reply, shipment, or completed history.
begin;
do $rotation$
declare
  v_oid regprocedure := 'public.sellerpilot_service_enqueue_ebay_case_dispute_collection_v2(jsonb)'::regprocedure;
  v_definition text;
  v_source text;
  v_old text;
  v_new text;
begin
  select prosrc,pg_catalog.pg_get_functiondef(oid) into v_source,v_definition from pg_catalog.pg_proc where oid=v_oid;
  if pg_catalog.md5(v_source)<>'12c3ef266cd655407df5c2cc102fa1ef' then
    raise exception 'EBAY_COLLECTION_ROTATION_PREIMAGE_MISMATCH';
  end if;
  v_old:=$old0$  foreach v_resource in array array['resolution_case','payment_dispute'] loop$old0$;
  v_new:=$new0$  -- Credential rotation invalidates the exact collection lineage. Retire only
  -- unfinished GETs with no durable page or external-write/refresh ambiguity.
  -- Keep completed runs and pages unchanged; collect again with the new key.
  with retired as (
    update sellerpilot_private.channel_gateway_jobs job
       set status='cancelled',
           error_message='EBAY_CASE_DISPUTE_CREDENTIAL_ROTATED_RECOLLECT',
           completed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
      from sellerpilot_private.ebay_case_dispute_collection_runs run,
           sellerpilot_private.channel_credentials previous
     where job.request_payload#>>'{arguments,collectionRootJobId}'=run.root_job_id::text
       and run.credential_id=previous.id and previous.status='revoked'
       and previous.channel='ebay' and previous.environment='production'
       and previous.created_by=v_credential.created_by
       and previous.seller_account_key_source='provider_certified_v1'
       and previous.seller_account_key=run.seller_account_key
       and run.credential_id<>v_credential.id
       and run.seller_account_key=v_credential.seller_account_key
       and job.credential_id in (run.credential_id,v_credential.id)
       and job.seller_account_key=v_credential.seller_account_key
       and job.channel='ebay' and job.operation='inquiries.list'
       and job.environment='production' and job.status in ('queued','running')
       and job.request_payload#>>'{arguments,kind}'='case_dispute_history'
       and job.provider_mutation_started_at is null
       and job.credential_refresh_in_flight is false
       and not exists(select 1 from sellerpilot_private.ebay_case_dispute_collection_pages page where page.job_id=job.id)
    returning job.id
  )
  insert into sellerpilot_private.operation_audit(owner_id,action,entity_type,entity_id,safe_detail)
    select v_credential.created_by,'ebay_case_dispute_credential_rotation',
           'channel_gateway_job',id::text,
           pg_catalog.jsonb_build_object('channel','ebay','operation','inquiries.list',
             'reason','credential_rotated_recollect','credentialVersion',v_credential.version)
      from retired;

  foreach v_resource in array array['resolution_case','payment_dispute'] loop$new0$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
    raise exception 'EBAY_COLLECTION_ROTATION_ANCHOR_MISMATCH';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:=$old1$    v_enqueue := public.sellerpilot_service_enqueue_periodic_sync(
      'ebay','inquiries.list',v_job,60
    );$old1$;
  v_new:=$new1$    -- Respect a healthy pre-migration or current-generation cooldown. Never
    -- attach a new collection run to an earlier credential's returned job ID.
    if exists(
      select 1 from sellerpilot_private.ebay_case_dispute_collection_runs run
        join sellerpilot_private.channel_gateway_jobs job on job.id=run.root_job_id
       where run.credential_id=v_credential.id and run.credential_version=v_credential.version
         and run.seller_account_key=v_credential.seller_account_key
         and run.plan_key=v_job->>'periodicKey' and run.collection_anchor=v_anchor
         and (job.status in ('queued','running')
           or job.created_at>pg_catalog.clock_timestamp()-interval '60 minutes')
         and job.error_message is distinct from 'EBAY_CASE_DISPUTE_CREDENTIAL_ROTATED_RECOLLECT'
    ) then
      v_pending:=v_pending+1;
      continue;
    end if;
    v_enqueue := public.sellerpilot_service_enqueue_periodic_sync(
      'ebay','inquiries.list',pg_catalog.jsonb_set(v_job,'{periodicKey}',
        pg_catalog.to_jsonb((v_job->>'periodicKey') || ':c:' || pg_catalog.md5(
          v_credential.id::text || ':' || v_credential.version::text
        )),false),60
    );$new1$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
    raise exception 'EBAY_COLLECTION_ROTATION_ANCHOR_MISMATCH';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$rotation$;
notify pgrst,'reload schema';
commit;
