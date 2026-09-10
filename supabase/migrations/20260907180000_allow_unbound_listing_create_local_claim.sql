-- Allow a release/IP-bound local executor to claim a new listing while its
-- seller lineage is intentionally still unbound. The existing listing guard
-- binds seller_account_key only after a successful provider create and
-- verified remote readback, so update and other existing-listing operations
-- continue to require an exact non-null seller key.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 907180000);

do $patch_local_create_claim$
declare
  definition text;
  patched_definition text;
  needle constant text := $needle$    and seller_account_key = job.seller_account_key
    and operation_attempt_id = attempt.id;$needle$;
  replacement constant text := $replacement$    and (
      seller_account_key = job.seller_account_key
      or (
        -- LISTING_CREATE_UNBOUND_SELLER_LINEAGE: the terminal verified
        -- completion remains the only path that binds the listing key.
        job.operation = 'listing.create'
        and seller_account_key is null
      )
    )
    and operation_attempt_id = attempt.id;$replacement$;
  hit_count integer;
begin
  if pg_catalog.to_regprocedure(
       'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'
     ) is null then
    raise exception 'LOCAL_CREATE_CLAIM_DEPENDENCY_MISSING'
      using errcode = '55000';
  end if;

  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  );
  if pg_catalog.strpos(
       definition,
       'LISTING_CREATE_UNBOUND_SELLER_LINEAGE'
     ) > 0 then
    raise exception 'LOCAL_CREATE_CLAIM_ALREADY_PATCHED'
      using errcode = '55000';
  end if;

  hit_count := (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, needle, ''))
  ) / pg_catalog.length(needle);
  if hit_count <> 1
     or (
       pg_catalog.strpos(
         definition,
         'SMARTSTORE_LOCAL_UPDATE_REMOTE_IDENTITY'
       ) = 0
       and pg_catalog.to_regprocedure(
         'sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid)'
       ) is not null
     ) then
    raise exception 'LOCAL_CREATE_CLAIM_PREDICATE_PREIMAGE_DRIFT'
      using errcode = '55000';
  end if;

  patched_definition := pg_catalog.replace(
    definition,
    needle,
    replacement
  );
  execute patched_definition;

  definition := pg_catalog.pg_get_functiondef(
    'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  );
  if pg_catalog.strpos(
       definition,
       'LISTING_CREATE_UNBOUND_SELLER_LINEAGE'
     ) = 0
     or pg_catalog.strpos(
          definition,
          'job.operation = ''listing.create'''
        ) = 0
     or pg_catalog.strpos(
          definition,
          'seller_account_key is null'
        ) = 0 then
    raise exception 'LOCAL_CREATE_CLAIM_PREDICATE_POSTIMAGE_FAILED'
      using errcode = '55000';
  end if;
end;
$patch_local_create_claim$;

revoke all on function sellerpilot_private.local_channel_executor_job_allowed(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

comment on function sellerpilot_private.local_channel_executor_job_allowed(
  uuid, uuid, uuid, text, text, text
) is
  'Allows an unbound listing only for a new local listing.create whose attempt, job, credential, route, release, egress, source manifest, and approval all match. Existing-listing operations still require the exact seller account key.';

notify pgrst, 'reload schema';

commit;
