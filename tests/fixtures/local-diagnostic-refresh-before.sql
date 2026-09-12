CREATE OR REPLACE FUNCTION sellerpilot_private.refresh_cs_read_lane()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_flags integer := 0; v_repinned integer := 0; v_shopee integer := 0; v_refreshed integer := 0;
  template_route sellerpilot_private.local_channel_executor_routes;
  target_credential uuid; target_key text;
begin
  update sellerpilot_private.serverless_static_egress_policy set enabled = false, updated_at = now()
   where channel in ('elevenst','shopee','temu') and enabled is true;
  get diagnostics v_flags = row_count;
  begin
    v_repinned := sellerpilot_private.repin_fixed_ip_read_routes();
  exception when others then v_repinned := -1; end;
  select credential.id, credential.seller_account_key into target_credential, target_key
    from sellerpilot_private.channel_credentials credential
   where credential.channel='shopee' and credential.environment='production' and credential.status='active'
   order by credential.created_at desc limit 1;
  if target_credential is not null then
    for template_route in select * from sellerpilot_private.local_channel_executor_routes
       where channel='elevenst' and operation in ('orders.list','inquiries.list')
    loop
      update sellerpilot_private.local_channel_executor_routes existing
         set expires_at = now() + interval '7 days', release_sha = template_route.release_sha,
             credential_id = target_credential, seller_account_key = target_key,
             approved_at = now(), enabled = true
       where existing.channel='shopee' and existing.operation = template_route.operation;
      get diagnostics v_refreshed = row_count;
      v_shopee := v_shopee + v_refreshed;
      if v_refreshed = 0 then
        template_route.id := gen_random_uuid(); template_route.channel := 'shopee';
        template_route.credential_id := target_credential; template_route.seller_account_key := target_key;
        template_route.created_at := now(); template_route.approved_at := now();
        template_route.expires_at := now() + interval '7 days';
        insert into sellerpilot_private.local_channel_executor_routes values (template_route.*);
      end if;
    end loop;
  end if;
  return jsonb_build_object('egressFlagsDisabled', v_flags, 'readRoutesRepinned', v_repinned, 'shopeeRoutesTouched', v_shopee);
end; $function$
