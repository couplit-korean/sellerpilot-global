-- Enable only implemented category reads on explicitly approved local routes.
-- No route approval, credential rebinding, egress change or job mutation is performed.
begin;
do $migration$
declare source text; patched text; constraint_source text;
begin
  select pg_get_functiondef('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'::regprocedure) into source;
  if md5(source) <> '675d129fde60d85428348bc74ed95184' then raise exception 'LOCAL_CATEGORY_READ_PREIMAGE_CHANGED:sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)'; end if;
  patched := replace(source, $old$j.operation in ('diagnostic.test', 'inquiries.list', 'orders.list')$old$, $new$(j.operation in ('diagnostic.test', 'inquiries.list', 'orders.list') or (j.channel in ('coupang','elevenst','temu') and j.operation in ('categories.suggest','categories.attributes','categories.validate')))$new$);
  if patched = source then raise exception 'LOCAL_CATEGORY_READ_PATCH_MISSING'; end if;
  execute patched;
  select pg_get_functiondef('sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure) into source;
  if md5(source) <> 'f5485a700866537a27e4d03a520395d4' then raise exception 'LOCAL_CATEGORY_READ_PREIMAGE_CHANGED:sellerpilot_private.local_channel_executor_access(text,text)'; end if;
  patched := replace(source, $old$when p_operation in ('diagnostic.test','orders.list','inquiries.list')$old$, $new$when p_channel in ('coupang','elevenst','temu') and p_operation in ('categories.suggest','categories.attributes','categories.validate') then 'read'
    when p_operation in ('diagnostic.test','orders.list','inquiries.list')$new$);
  if patched = source then raise exception 'LOCAL_CATEGORY_READ_PATCH_MISSING'; end if;
  execute patched;
  select pg_get_functiondef('sellerpilot_private.local_channel_executor_read_bootstrap_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure) into source;
  if md5(source) <> '4c7de15034f4e4b755f0384486fabb64' then raise exception 'LOCAL_CATEGORY_READ_PREIMAGE_CHANGED:sellerpilot_private.local_channel_executor_read_bootstrap_allowed(uuid,uuid,uuid,text,text,text)'; end if;
  patched := replace(source, $old$job.operation in ('diagnostic.test', 'orders.list', 'inquiries.list')$old$, $new$(job.operation in ('diagnostic.test', 'orders.list', 'inquiries.list') or (job.channel in ('coupang','elevenst','temu') and job.operation in ('categories.suggest','categories.attributes','categories.validate')))$new$);
  if patched = source then raise exception 'LOCAL_CATEGORY_READ_PATCH_MISSING'; end if;
  execute patched;
  select pg_get_constraintdef(oid) into constraint_source from pg_constraint
    where conrelid = 'sellerpilot_private.local_channel_executor_routes'::regclass
      and conname = 'local_channel_executor_routes_operation_check';
  if constraint_source is null or md5(constraint_source) <> '18d2a17c5fe8c0a67c566cf413db2de2' then
    raise exception 'LOCAL_CATEGORY_READ_ROUTE_PREIMAGE_CHANGED';
  end if;
  alter table sellerpilot_private.local_channel_executor_routes drop constraint local_channel_executor_routes_operation_check;
  execute 'alter table sellerpilot_private.local_channel_executor_routes add constraint local_channel_executor_routes_operation_check CHECK ('
    || substring(constraint_source from 8 for length(constraint_source)-8)
    || $extra$ OR (channel in ('coupang','elevenst','temu') AND operation in ('categories.suggest','categories.attributes','categories.validate')))$extra$;
end;
$migration$;
commit;
