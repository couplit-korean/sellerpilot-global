-- Read-only catalog capture, project sqaoqucxakebqkiygdxb; no operational rows.
-- guard prosrc MD5: 67f6f545198ab0a7e1e2e57473cc9e5c
alter table sellerpilot_private.inventory_sync_items drop constraint inventory_sync_items_status_check;
alter table sellerpilot_private.inventory_sync_items add constraint inventory_sync_items_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'superseded'::text, 'reconciliation_required'::text]));
alter table sellerpilot_private.inventory_sync_runs drop constraint inventory_sync_runs_status_check;
alter table sellerpilot_private.inventory_sync_runs add constraint inventory_sync_runs_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'partial'::text, 'failed'::text, 'superseded'::text, 'reconciliation_required'::text]));
CREATE OR REPLACE FUNCTION sellerpilot_private.guard_inventory_write_generation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1
      from sellerpilot_private.inventory_sync_items i
     where i.product_id = new.product_id
       and i.status = 'reconciliation_required'
  ) or exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs j
      join sellerpilot_private.product_listings l on l.id = j.listing_id
     where l.product_id = new.product_id
       and j.operation = 'inventory.update'
       and j.status in ('queued', 'running', 'reconciliation_required')
  ) then
    raise exception 'inventory remote write must complete or reconcile before a new generation';
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER guard_inventory_write_generation BEFORE INSERT ON sellerpilot_private.inventory_sync_runs FOR EACH ROW EXECUTE FUNCTION sellerpilot_private.guard_inventory_write_generation();
