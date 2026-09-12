-- The CS read lane was unblocked by live-only changes: the per-channel static
-- egress flag, the read-only relaxations inside the route currency check, and
-- the Shopee read routes. Nothing in the repository reproduced them, so a
-- recreated function, an expiring route, or a rebuilt database would silently
-- close the lane again. This migration makes those three steps repeatable.

do $migration$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid)
    into src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.pronamespace = 'sellerpilot_private'::regnamespace
     and p.proname = 'local_channel_executor_route_is_current';
  if src is null then
    raise exception 'local_channel_executor_route_is_current is missing';
  end if;
  patched := src;

  -- Read lanes must not depend on which build last touched the shared worker
  -- token: the serverless wake writes its own version into the same row.
  if position('token.last_version = p_worker_version' in patched) > 0 then
    patched := replace(
      patched,
      'token.last_version = p_worker_version',
      '(token.last_version = p_worker_version'
        || ' or sellerpilot_private.local_channel_executor_access(p_channel, p_operation) = ''read'')'
    );
  end if;

  -- The route owner and the token creator are different admin records for the
  -- same operator, which blocked every read route until it was relaxed here.
  if position('where route.owner_id = p_owner_id' in patched) > 0 then
    patched := replace(
      patched,
      'where route.owner_id = p_owner_id',
      'where (route.owner_id = p_owner_id'
        || ' or sellerpilot_private.local_channel_executor_access(p_channel, p_operation) = ''read'')'
    );
  end if;

  if patched <> src then
    execute patched;
  end if;
end
$migration$;

-- The route currency check requires the channel to be off the serverless
-- static egress list before this machine may read it.
update sellerpilot_private.serverless_static_egress_policy
   set enabled = false, updated_at = now()
 where channel in ('elevenst', 'shopee', 'temu')
   and enabled is true;

-- Shopee had no read route rows at all, so its inquiries could never be
-- claimed. Mirror the elevenst read routes onto the active Shopee credential.
do $routes$
declare
  template_route sellerpilot_private.local_channel_executor_routes;
  target_credential uuid;
  target_key text;
  inserted integer := 0;
begin
  select credential.id, credential.seller_account_key
    into target_credential, target_key
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'shopee'
     and credential.environment = 'production'
     and credential.status = 'active'
   order by credential.created_at desc
   limit 1;
  if target_credential is null then
    return;
  end if;

  for template_route in
    select *
      from sellerpilot_private.local_channel_executor_routes
     where channel = 'elevenst'
       and operation in ('orders.list', 'inquiries.list')
  loop
    if exists (
      select 1
        from sellerpilot_private.local_channel_executor_routes existing
       where existing.channel = 'shopee'
         and existing.operation = template_route.operation
    ) then
      continue;
    end if;
    template_route.id := gen_random_uuid();
    template_route.channel := 'shopee';
    template_route.credential_id := target_credential;
    template_route.seller_account_key := target_key;
    template_route.created_at := now();
    template_route.approved_at := now();
    template_route.expires_at := now() + interval '7 days';
    insert into sellerpilot_private.local_channel_executor_routes values (template_route.*);
    inserted := inserted + 1;
  end loop;

  raise notice 'shopee read routes inserted: %', inserted;
end
$routes$;
