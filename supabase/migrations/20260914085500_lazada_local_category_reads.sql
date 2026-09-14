-- Lazada is already pinned to local execution. Admit only its three implemented
-- category reads; existing per-operation route, identity and runtime gates stay.
-- This migration grants no route approval and does not enqueue or change jobs.
begin;
do $migration$
declare source text; patched text; constraint_source text; entry record;
begin
  for entry in select * from (values
    ('sellerpilot_private.claim_local_channel_executor_read_job(text,text,text,text)', 'b33cfef822cdb9123ad50cd97f1ccf8c'),
    ('sellerpilot_private.local_channel_executor_access(text,text)', '9f85a5ebc3425c3f8a6efd41fc00ab25'),
    ('sellerpilot_private.local_channel_executor_read_bootstrap_allowed(uuid,uuid,uuid,text,text,text)', '962ddf7677d3baeb24323b26e677dc80')
  ) as expected(signature, source_md5) loop
    if (select md5(prosrc) from pg_proc where oid=entry.signature::regprocedure)
      is distinct from entry.source_md5 then
      raise exception 'LAZADA_LOCAL_CATEGORY_PREIMAGE_CHANGED:%', entry.signature;
    end if;
    source := pg_get_functiondef(entry.signature::regprocedure);
    patched := replace(source, $old$in ('coupang','elevenst','temu')$old$, $new$in ('coupang','elevenst','temu','lazada')$new$);
    if (length(source)-length(replace(source,$old$in ('coupang','elevenst','temu')$old$,'')))/length($old$in ('coupang','elevenst','temu')$old$) <> 1 then
      raise exception 'LAZADA_LOCAL_CATEGORY_PATCH_DRIFT:%', entry.signature;
    end if;
    execute patched;
  end loop;
  select pg_get_constraintdef(oid) into constraint_source from pg_constraint
    where conrelid='sellerpilot_private.local_channel_executor_routes'::regclass
      and conname='local_channel_executor_routes_operation_check';
  if constraint_source is null or md5(constraint_source) <> '68c0516a7f81e20f66a392b7f6bc9aa4' then
    raise exception 'LAZADA_LOCAL_CATEGORY_CONSTRAINT_PREIMAGE_CHANGED';
  end if;
  alter table sellerpilot_private.local_channel_executor_routes drop constraint local_channel_executor_routes_operation_check;
  execute 'alter table sellerpilot_private.local_channel_executor_routes add constraint local_channel_executor_routes_operation_check CHECK ('
    || substring(constraint_source from 8 for length(constraint_source)-8)
    || $extra$ OR (channel='lazada' AND operation in ('categories.suggest','categories.attributes','categories.validate')))$extra$;
end;
$migration$;
commit;
