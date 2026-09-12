-- Restore the application's daily history cooldown without widening current
-- reads, order syncs, provider mutations, or changing existing job lineages.
-- Exact definitions captured from production on 2026-09-12, before this repair.
begin;
do $migration$
declare target record; original text; patched text; needle text; replacement text;
begin
  for target in select * from (values
    ('sellerpilot_enqueue_periodic_sync_without_identity_gate','642f5aaccc4b404801026703af466ab8',false),
    ('sellerpilot_20260828_enqueue_periodic_sync_before_static_egress','123f2fd69f4bec0ce423d19d03c8008a',false),
    ('sellerpilot_310450_enqueue_periodic_sync_unsafe','f70e31fba5f44d653a3dc7ac541cd6f5',true)
  ) as source(name,expected_md5,positive_guard) loop
    select pg_get_functiondef(p.oid) into original from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname=target.name
        and pg_get_function_identity_arguments(p.oid)='p_channel text, p_operation text, p_request_payload jsonb, p_min_interval_minutes integer';
    if original is null or md5(original)<>target.expected_md5 then
      raise exception 'DAILY_INQUIRY_REPAIR_PREIMAGE_MISMATCH: %', target.name;
    end if;
    needle := case when target.positive_guard then 'p_min_interval_minutes between 1 and 60'
      else 'p_min_interval_minutes not between 1 and 60' end;
    replacement := case when target.positive_guard then 'p_min_interval_minutes between 1 and '
      else 'p_min_interval_minutes not between 1 and ' end ||
      '(case when p_operation = ''inquiries.list'' and coalesce(p_request_payload->>''periodicKey'', '''') like ''inquiries:history:%'' then 1440 else 60 end)';
    if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 then
      raise exception 'DAILY_INQUIRY_REPAIR_GUARD_MISMATCH: %', target.name;
    end if;
    patched := replace(original,needle,replacement);
    if target.positive_guard then
      needle := '''ebay-inquiries:v1:'' || pg_catalog.md5(';
      replacement := '(case when v_request_key like ''inquiries:history:%'' then ''inquiries:history:ebay:v1:'' else ''ebay-inquiries:v1:'' end) || pg_catalog.md5(';
      if (length(patched)-length(replace(patched,needle,'')))/length(needle)<>1 then
        raise exception 'DAILY_INQUIRY_REPAIR_EBAY_KEY_MISMATCH';
      end if;
      patched := replace(patched,needle,replacement);
    end if;
    execute patched;
  end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
