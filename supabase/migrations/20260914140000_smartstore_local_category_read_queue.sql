-- Put the three SmartStore category reads in the existing authorized local
-- read queue so newer periodic reads cannot continually preempt its fallback.
-- Existing route, seller, credential, worker, release and egress gates remain.
-- No jobs, routes, schedules or provider policy are changed by this migration.
begin;
do $migration$
declare source text; patched text; constraint_source text; entry record;
begin
  for entry in select * from (values
    ('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)', '961ef7b7a3d86547d0afe725e5002ff8'),
    ('sellerpilot_private.local_channel_executor_access(text,text)', 'f126ef22f5bfd145d93e5b2074cdf783'),
    ('sellerpilot_private.local_channel_executor_read_bootstrap_allowed(uuid,uuid,uuid,text,text,text)', '7273ed71b4a0c43aaca0690711896c6b')
  ) as expected(signature, source_md5) loop
    if (select md5(prosrc) from pg_proc where oid=entry.signature::regprocedure)
      is distinct from entry.source_md5 then
      raise exception 'SMARTSTORE_LOCAL_CATEGORY_PREIMAGE_CHANGED:%', entry.signature;
    end if;
    source := pg_get_functiondef(entry.signature::regprocedure);
    patched := replace(source, $old$in ('coupang','elevenst','temu','lazada')$old$, $new$in ('coupang','elevenst','temu','lazada','smartstore')$new$);
    if (length(source)-length(replace(source,$old$in ('coupang','elevenst','temu','lazada')$old$,'')))/length($old$in ('coupang','elevenst','temu','lazada')$old$) <> 1 then
      raise exception 'SMARTSTORE_LOCAL_CATEGORY_PATCH_DRIFT:%', entry.signature;
    end if;
    execute patched;
  end loop;
  select pg_get_constraintdef(oid) into constraint_source from pg_constraint
    where conrelid='sellerpilot_private.local_channel_executor_routes'::regclass
      and conname='local_channel_executor_routes_operation_check';
  if constraint_source is null or md5(constraint_source) <> '67b6c8808a2baeb43add663a1a81dc4a' then
    raise exception 'SMARTSTORE_LOCAL_CATEGORY_CONSTRAINT_PREIMAGE_CHANGED';
  end if;
  alter table sellerpilot_private.local_channel_executor_routes drop constraint local_channel_executor_routes_operation_check;
  execute 'alter table sellerpilot_private.local_channel_executor_routes add constraint local_channel_executor_routes_operation_check CHECK ('
    || substring(constraint_source from 8 for length(constraint_source)-8)
    || $extra$ OR (channel='smartstore' AND operation in ('categories.suggest','categories.attributes','categories.validate')))$extra$;

  if (select md5(prosrc) from pg_proc where oid='public.sellerpilot_gateway_queue_pulse(text)'::regprocedure)
    is distinct from '227ddb59c8999d44ad461276678b366d' then
    raise exception 'SMARTSTORE_LOCAL_CATEGORY_PULSE_PREIMAGE_CHANGED';
  end if;
  source := pg_get_functiondef('public.sellerpilot_gateway_queue_pulse(text)'::regprocedure);
  patched := replace(source,
    $old$and not sellerpilot_private.serverless_gateway_job_allowed(j.channel, j.operation)$old$,
    $new$and (not sellerpilot_private.serverless_gateway_job_allowed(j.channel, j.operation)
      or (j.channel='smartstore' and j.operation in ('categories.suggest','categories.attributes','categories.validate')))$new$);
  if patched=source then raise exception 'SMARTSTORE_LOCAL_CATEGORY_PULSE_PATCH_DRIFT'; end if;
  execute patched;
end;
$migration$;
commit;
