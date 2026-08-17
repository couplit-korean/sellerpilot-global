-- Route Coupang API traffic through the same authenticated Mac worker whose
-- public IP is allowlisted in Coupang WING. Keep OAuth-only operations limited
-- to Shopee and Lazada.

begin;

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint channel_gateway_jobs_channel_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_channel_check
  check (channel in ('shopee', 'lazada', 'coupang'));

alter table sellerpilot_private.channel_gateway_jobs
  drop constraint channel_gateway_jobs_operation_check;

alter table sellerpilot_private.channel_gateway_jobs
  add constraint channel_gateway_jobs_operation_check check (operation in (
    'oauth.exchange', 'shops.get', 'diagnostic.test',
    'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
    'listing.create', 'listing.update', 'listing.stop',
    'price.update', 'inventory.update', 'orders.list', 'orders.get',
    'shipment.acknowledge', 'shipment.confirm'
  ));

create or replace function public.sellerpilot_enqueue_channel_gateway_job(
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_environment text;
  v_created_by uuid;
begin
  if p_channel not in ('shopee', 'lazada', 'coupang')
     or p_operation not in (
       'oauth.exchange', 'shops.get', 'diagnostic.test',
       'categories.list', 'categories.suggest', 'categories.attributes', 'categories.validate',
       'listing.create', 'listing.update', 'listing.stop',
       'price.update', 'inventory.update', 'orders.list', 'orders.get',
       'shipment.acknowledge', 'shipment.confirm'
     )
     or (p_channel = 'coupang' and p_operation in ('oauth.exchange', 'shops.get'))
     or jsonb_typeof(p_request_payload) <> 'object'
     or octet_length(p_request_payload::text) > 128000 then
    raise exception 'invalid channel gateway job';
  end if;

  select c.environment, c.created_by
    into v_environment, v_created_by
    from sellerpilot_private.channel_credentials c
   where c.id = p_credential_id
     and c.channel = p_channel
     and c.status = 'active'
     and (c.expires_at is null or c.expires_at > now())
   for update;
  if not found then raise exception 'active channel credential required'; end if;

  if p_attempt_id is not null and not exists (
    select 1
      from sellerpilot_private.channel_operation_attempts a
     where a.id = p_attempt_id
       and a.credential_id = p_credential_id
       and a.channel = p_channel
       and a.operation = p_operation
       and a.status = 'running'
  ) then
    raise exception 'running channel operation required';
  end if;

  insert into sellerpilot_private.channel_gateway_jobs (
    id, credential_id, attempt_id, channel, operation, environment, request_payload, created_by
  ) values (
    v_id, p_credential_id, p_attempt_id, p_channel, p_operation, v_environment, p_request_payload, v_created_by
  );
  return v_id;
end;
$$;

revoke all on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sellerpilot_enqueue_channel_gateway_job(uuid, uuid, text, text, jsonb) to service_role;

commit;
