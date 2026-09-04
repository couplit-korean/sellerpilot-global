-- Follow-up to 20260905003000. Do not rewrite that applied history.
-- Live jobs_are_current() is false because source extract requires named GET
-- readback steps to be ok=true. Production create/update hashes and listing
-- preimage already match, but:
--   GetItemDetailInfo-publication-readback ok=false, ResultCode 0, S2, ShippingNo 806971
--   qoo10-rollback-pre-activation-readback ok=false, ResultCode 0, S1, ShippingNo 806971
-- The provider GET succeeded; ok=false is the shippingVerified=false publication
-- fence. Read the unique remote item from that named GET even when ok is false.
-- Write receipts still require named_step ok=true.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500031);

create or replace function sellerpilot_private.qoo10_shipping_s1_named_remote_item(
  p_response jsonb,
  p_name text,
  p_remote_id text
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_step jsonb;
  v_item jsonb;
  v_count integer;
  v_status integer;
begin
  select count(*) into v_count
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_name;
  if v_count <> 1 then return null; end if;
  select step into v_step
    from jsonb_array_elements(coalesce(p_response->'steps','[]'::jsonb)) step
   where step->>'name' = p_name;
  begin
    v_status := (v_step->>'status')::integer;
  exception when others then
    return null;
  end;
  if v_status not between 200 and 299
     or coalesce(v_step#>>'{data,ResultCode}','') is distinct from '0'
  then
    return null;
  end if;
  select count(distinct coalesce(item->>'ItemCode', item->>'GdNo', item->>'ItemNo'))
    into v_count
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(v_step#>'{data,ResultObject}', v_step->'data'), p_remote_id
    ) item;
  if v_count is distinct from 1 then return null; end if;
  select item into v_item
    from sellerpilot_private.qoo10_exact_remote_items(
      coalesce(v_step#>'{data,ResultObject}', v_step->'data'), p_remote_id
    ) item;
  return v_item;
exception when others then
  return null;
end;
$$;

revoke all on function
  sellerpilot_private.qoo10_shipping_s1_named_remote_item(jsonb,text,text)
  from public, anon, authenticated, service_role;

comment on function sellerpilot_private.qoo10_shipping_s1_named_remote_item(jsonb,text,text) is
  'Named Qoo10 GET item with ResultCode 0; ok=false publication fence is allowed.';

commit;
