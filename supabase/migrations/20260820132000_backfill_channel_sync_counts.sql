-- Keep sync health counts aligned with the live unified ledgers. Marketplace
-- collectors can finish in multiple provider-specific pages or statuses, so a
-- final empty response must not hide rows already imported by the same sync.

begin;

update sellerpilot_private.channel_sync_state s
   set imported_count = case s.data_type
         when 'orders' then (
           select count(*)
             from sellerpilot_private.commerce_orders o
            where o.owner_id = s.owner_id
              and o.channel_key = s.channel_key
              and not o.demo
         )
         when 'inquiries' then (
           select count(*)
             from sellerpilot_private.support_tickets t
            where t.owner_id = s.owner_id
              and t.channel_key = s.channel_key
              and not t.demo
         )
         else s.imported_count
       end,
       updated_at = now();

commit;
