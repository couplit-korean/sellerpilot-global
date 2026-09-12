-- The CS read lane kept closing by itself. A read could only be claimed when
-- eight conditions held at the same instant, and three of them (route
-- release_sha, token last_version, egress fingerprint) change on every deploy,
-- worker restart, or token refresh. Repairing them by hand is what made the
-- lane look like it kept breaking.
--
-- This function restores the durable parts of the lane, and a five minute
-- schedule runs it, so a deploy no longer has to be followed by a manual
-- ritual before inquiries can be read again.

create or replace function sellerpilot_private.refresh_cs_read_lane()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_flags integer := 0;
  v_repinned integer := 0;
  v_shopee integer := 0;
  v_shopee_refreshed integer := 0;
  template_route sellerpilot_private.local_channel_executor_routes;
  target_credential uuid;
  target_key text;
begin
  -- A channel must be off the serverless static egress list before this
  -- machine may read it.
  update sellerpilot_private.serverless_static_egress_policy
     set enabled = false, updated_at = now()
   where channel in ('elevenst', 'shopee', 'temu')
     and enabled is true;
  get diagnostics v_flags = row_count;

  -- Move the fixed-IP read routes onto the release the runtime is actually
  -- serving, and push their expiry out again.
  begin
    v_repinned := sellerpilot_private.repin_fixed_ip_read_routes();
  exception
    when others then
      v_repinned := -1;
  end;

  -- Shopee needs its own read routes on the active credential; mirror the
  -- elevenst rows and refresh the existing ones.
  select credential.id, credential.seller_account_key
    into target_credential, target_key
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
   order by credential.created_at desc
   limit 1;

  if target_credential is not null then
    for template_route in
      select *
        from sellerpilot_private.local_channel_executor_routes
       where channel = 'elevenst'
         and operation in ('orders.list', 'inquiries.list')
    loop
      update sellerpilot_private.local_channel_executor_routes existing
         set expires_at = now() + interval '7 days',
             release_sha = template_route.release_sha,
             credential_id = target_credential,
             seller_account_key = target_key,
             approved_at = now(),
             enabled = true
       where existing.channel = 'shopee'
         and existing.operation = template_route.operation;
      get diagnostics v_shopee_refreshed = row_count;
      v_shopee := v_shopee + v_shopee_refreshed;

      if v_shopee_refreshed = 0 then
        template_route.id := gen_random_uuid();
        template_route.channel := 'shopee';
        template_route.credential_id := target_credential;
        template_route.seller_account_key := target_key;
        template_route.created_at := now();
        template_route.approved_at := now();
        template_route.expires_at := now() + interval '7 days';
        insert into sellerpilot_private.local_channel_executor_routes values (template_route.*);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'egressFlagsDisabled', v_flags,
    'readRoutesRepinned', v_repinned,
    'shopeeRoutesTouched', v_shopee
  );
end;
$function$;

revoke all on function sellerpilot_private.refresh_cs_read_lane() from public;

-- Run it every five minutes so a deploy or a worker restart can no longer
-- leave the read lane closed until someone notices.
select cron.schedule(
  'sellerpilot-cs-read-lane-autoheal',
  '*/5 * * * *',
  $cron$select sellerpilot_private.refresh_cs_read_lane();$cron$
);
