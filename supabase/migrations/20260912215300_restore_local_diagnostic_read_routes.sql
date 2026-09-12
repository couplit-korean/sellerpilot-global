-- Diagnostic reads reuse an existing approved read route for the same account,
-- worker and egress. No listing, reply, inventory or shipment route is created.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
create function sellerpilot_private.refresh_local_diagnostic_read_routes()
returns integer language plpgsql security definer set search_path='' as $fn$
declare
  source_route sellerpilot_private.local_channel_executor_routes;
  target_route sellerpilot_private.local_channel_executor_routes;
  touched integer:=0;
begin
  perform pg_advisory_xact_lock(72609313,3);
  for source_route in
    select distinct on(r.owner_id,r.channel,r.credential_id,r.seller_account_key,r.worker_token_id,r.egress_ip_sha256) r.*
    from sellerpilot_private.local_channel_executor_routes r
    join sellerpilot_private.channel_credentials c on c.id=r.credential_id
      and c.channel=r.channel and c.seller_account_key=r.seller_account_key
      and c.status='active' and c.environment='production'
      and (c.expires_at is null or c.expires_at>clock_timestamp())
    join sellerpilot_private.ai_cli_worker_tokens t on t.id=r.worker_token_id
      and t.status='active' and t.scope='gateway' and t.expires_at>clock_timestamp()
    where r.channel in ('coupang','smartstore','elevenst','temu','shopee','lazada')
      and r.operation in ('orders.list','inquiries.list') and r.enabled
      and r.approved_by is not null and r.approved_at is not null
      and (r.expires_at is null or r.expires_at>clock_timestamp())
      and r.release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
    order by r.owner_id,r.channel,r.credential_id,r.seller_account_key,r.worker_token_id,r.egress_ip_sha256,r.approved_at desc,r.id
  loop
    select * into target_route from sellerpilot_private.local_channel_executor_routes r
      where r.owner_id=source_route.owner_id and r.channel=source_route.channel
        and r.operation='diagnostic.test' and r.credential_id=source_route.credential_id
        and r.seller_account_key=source_route.seller_account_key
        and r.worker_token_id=source_route.worker_token_id
        and r.egress_ip_sha256=source_route.egress_ip_sha256
      order by (r.release_sha=source_route.release_sha) desc,r.approved_at desc,r.id
      limit 1 for update;
    -- Preserve an explicit current disable. Expired old routes can be renewed
    -- from the still-current read authorization instead of remaining stranded.
    if target_route.id is not null and not target_route.enabled
       and (target_route.expires_at is null or target_route.expires_at>clock_timestamp()) then continue;end if;
    if target_route.id is null then
      target_route:=source_route;target_route.id:=gen_random_uuid();
      target_route.operation:='diagnostic.test';target_route.created_at:=clock_timestamp();
      insert into sellerpilot_private.local_channel_executor_routes values(target_route.*);
    else
      update sellerpilot_private.local_channel_executor_routes set
        release_sha=source_route.release_sha,approved_by=source_route.approved_by,
        approved_at=source_route.approved_at,expires_at=source_route.expires_at,enabled=true
        where id=target_route.id;
    end if;
    touched:=touched+1;
  end loop;
  return touched;
end $fn$;
revoke all on function sellerpilot_private.refresh_local_diagnostic_read_routes() from public,anon,authenticated,service_role;

do $patch$
declare definition text:=pg_get_functiondef('sellerpilot_private.refresh_cs_read_lane()'::regprocedure);
begin
  if md5(definition) is distinct from '17f3ba6565331a423efacccff1b26068' then raise exception 'LOCAL_DIAGNOSTIC_REFRESH_PREIMAGE_CHANGED';end if;
  definition:=replace(definition,
    $old$return jsonb_build_object('egressFlagsDisabled', v_flags,$old$,
    $new$return jsonb_build_object('diagnosticReadRoutes',sellerpilot_private.refresh_local_diagnostic_read_routes(),'egressFlagsDisabled', v_flags,$new$);
  execute definition;
end $patch$;
select sellerpilot_private.refresh_local_diagnostic_read_routes();
commit;
