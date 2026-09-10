-- Lazada-only durable item ownership. No provider calls or collection enqueue.
begin;

do $$ begin
  if (select array(select x::text from unnest(proacl) x order by x::text) from pg_proc
       where oid=to_regprocedure('public.sellerpilot_service_ingest_orders(uuid,text,jsonb)'))
       is distinct from array['postgres=X/postgres','service_role=X/postgres']::text[]
    or (select array(select x::text from unnest(proacl) x order by x::text) from pg_proc
       where oid=to_regprocedure('public.sellerpilot_get_order_fulfillment_context_v2(uuid[])'))
       is distinct from array['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
    or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.sellerpilot_service_ingest_orders(uuid,text,jsonb)')) is distinct from '1a426cc962f53f230a4fa4e0f147d22e'
    or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.sellerpilot_get_order_fulfillment_context_v2(uuid[])')) is distinct from '7526114472f6b62aba3e225bb0d9e275'
    or not has_function_privilege('service_role','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.sellerpilot_get_order_fulfillment_context_v2(uuid[])','EXECUTE')
    or has_function_privilege('anon','public.sellerpilot_get_order_fulfillment_context_v2(uuid[])','EXECUTE') then
    raise exception 'LAZADA_OWNERSHIP_PREIMAGE_OR_ACL_MISMATCH';
  end if;
end $$;

alter table sellerpilot_private.commerce_orders
  add column lazada_source_credential_id uuid,
  add column lazada_seller_account_key text,
  add column lazada_ownership_blocked boolean not null default false;

create table sellerpilot_private.lazada_order_item_claims (
  owner_id uuid not null,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  remote_item_id text not null check (length(remote_item_id) between 1 and 1000),
  order_id uuid not null references sellerpilot_private.commerce_orders(id),
  first_seen_at timestamptz not null default now(),
  primary key(seller_account_key,remote_item_id,order_id)
);
alter table sellerpilot_private.lazada_order_item_claims enable row level security;
revoke all on sellerpilot_private.lazada_order_item_claims from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_order_has_item_conflict(p_order_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,sellerpilot_private as $$
 select exists(select 1 from sellerpilot_private.lazada_order_item_claims a
 join sellerpilot_private.lazada_order_item_claims b on b.seller_account_key=a.seller_account_key
   and b.remote_item_id=a.remote_item_id and b.order_id<>a.order_id where a.order_id=p_order_id)
$$;
revoke all on function sellerpilot_private.lazada_order_has_item_conflict(uuid) from public,anon,authenticated,service_role;

-- Existing rows have no attested source credential. Never infer it from the
-- currently active seller. Keep them quarantined even after a later resync.
-- Preserve the original provider context as evidence. The fulfillment projection
-- and shipment fences mask/reject blocked rows without destroying their source.
update sellerpilot_private.commerce_orders
   set lazada_ownership_blocked=true
 where channel_key='lazada' and not demo;

create function sellerpilot_private.lazada_order_ownership_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,sellerpilot_private as $$
declare c record; cid uuid; ids jsonb; n integer; d integer;
begin
  if tg_op='UPDATE' and old.channel_key='lazada' and not old.demo then
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
       or new.channel_key is distinct from old.channel_key or new.external_order_id is distinct from old.external_order_id
       or new.demo is distinct from old.demo then
      raise exception 'LAZADA_ORDER_IDENTITY_IMMUTABLE';
    end if;
    if old.lazada_seller_account_key is not null and
       (new.lazada_seller_account_key is distinct from old.lazada_seller_account_key
        or new.lazada_source_credential_id is distinct from old.lazada_source_credential_id) then
      raise exception 'LAZADA_ORDER_LINEAGE_IMMUTABLE';
    end if;
    new.lazada_ownership_blocked := old.lazada_ownership_blocked or new.lazada_ownership_blocked;
  end if;
  if new.channel_key<>'lazada' or new.demo then return new; end if;
  cid := nullif(current_setting('sellerpilot.lazada_ingest_credential',true),'')::uuid;
  if cid is not null then
    select * into c from sellerpilot_private.channel_credentials
     where id=cid and channel='lazada' and created_by=new.owner_id
       and environment='production' and status in ('active','grace')
       and seller_account_key ~ '^[a-f0-9]{64}$'
       and seller_account_key_source='provider_certified_v1' and seller_account_verified_at is not null;
    if not found then raise exception 'LAZADA_ORDER_CREDENTIAL_UNATTESTED'; end if;
    if new.lazada_seller_account_key is not null and new.lazada_seller_account_key<>c.seller_account_key then
      new.lazada_ownership_blocked := true;
    elsif new.lazada_seller_account_key is null then
      new.lazada_source_credential_id := c.id;
      new.lazada_seller_account_key := c.seller_account_key;
    end if;
  elsif tg_op='INSERT' then
    -- A direct table writer cannot attest a seller by supplying new columns.
    new.lazada_source_credential_id := null;
    new.lazada_seller_account_key := null;
    new.lazada_ownership_blocked := true;
  elsif old.lazada_seller_account_key is null then
    new.lazada_source_credential_id := old.lazada_source_credential_id;
    new.lazada_seller_account_key := null;
    new.lazada_ownership_blocked := true;
  end if;
  -- Only attested ingest may introduce new item claims. Ordinary row writers
  -- do not take the seller lock and cannot add/rebind identifiers.
  if cid is null and tg_op='UPDATE' and new.provider_context->'orderItemIds' is distinct from old.provider_context->'orderItemIds'
     and coalesce(new.provider_context->'orderItemIds','[]'::jsonb)<>'[]'::jsonb then
    raise exception 'LAZADA_ITEM_CONTEXT_REQUIRES_INGEST';
  end if;
  if sellerpilot_private.lazada_order_has_item_conflict(new.id) then new.lazada_ownership_blocked:=true; end if;
  ids := new.provider_context->'orderItemIds';
  if not new.lazada_ownership_blocked and jsonb_typeof(ids)='array' then
    select count(*),count(distinct value#>>'{}') into n,d from jsonb_array_elements(ids);
    if n between 1 and 100 and n=d
       and new.provider_context->>'orderId'=new.external_order_id
       and length(trim(coalesce(new.provider_context->>'deliveryType','')))>0
       and not exists(select 1 from jsonb_array_elements(ids) v(value)
         where jsonb_typeof(value)<>'string' or length(trim(value#>>'{}')) not between 1 and 1000
           or (value#>>'{}')<>trim(value#>>'{}')) then
      return new;
    end if;
  end if;
  new.provider_context := jsonb_build_object('orderId',new.external_order_id,'orderItemIds','[]'::jsonb,'deliveryType','');
  return new;
end $$;

create function sellerpilot_private.lazada_record_order_item_claims()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,sellerpilot_private as $$
begin
  if new.channel_key<>'lazada' or new.demo then return new; end if;
  if new.lazada_ownership_blocked or new.lazada_seller_account_key is null
     or jsonb_array_length(new.provider_context->'orderItemIds')=0 then return new; end if;
  insert into sellerpilot_private.lazada_order_item_claims(owner_id,seller_account_key,remote_item_id,order_id)
    select new.owner_id,new.lazada_seller_account_key,value,new.id
      from jsonb_array_elements_text(new.provider_context->'orderItemIds')
    on conflict do nothing;
  -- Append only: no AFTER advisory lock or cross-order UPDATE. The durable
  -- conflict join masks ALL owners at read/claim/mutation time, even after clear.
  return new;
end $$;

create trigger lazada_order_ownership_guard before insert or update
on sellerpilot_private.commerce_orders for each row execute function sellerpilot_private.lazada_order_ownership_guard();
create trigger lazada_record_order_item_claims after insert or update
on sellerpilot_private.commerce_orders for each row execute function sellerpilot_private.lazada_record_order_item_claims();
revoke all on function sellerpilot_private.lazada_order_ownership_guard() from public,anon,authenticated,service_role;
revoke all on function sellerpilot_private.lazada_record_order_item_claims() from public,anon,authenticated,service_role;

alter function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
 rename to sellerpilot_ingest_orders_pre_lazada_ownership;
revoke all on function public.sellerpilot_ingest_orders_pre_lazada_ownership(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.sellerpilot_service_ingest_orders(p_credential_id uuid,p_channel text,p_orders jsonb)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,sellerpilot_private as $$
declare c record; previous text; result integer;
begin
  if p_channel<>'lazada' then return public.sellerpilot_ingest_orders_pre_lazada_ownership(p_credential_id,p_channel,p_orders); end if;
  select * into c from sellerpilot_private.channel_credentials where id=p_credential_id
    and channel='lazada' and environment='production' and status in ('active','grace')
    and seller_account_key ~ '^[a-f0-9]{64}$' and seller_account_key_source='provider_certified_v1'
    and seller_account_verified_at is not null;
  if not found then raise exception 'LAZADA_ORDER_CREDENTIAL_UNATTESTED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lazada:'||c.seller_account_key,0));
  previous := current_setting('sellerpilot.lazada_ingest_credential',true);
  perform set_config('sellerpilot.lazada_ingest_credential',c.id::text,true);
  result := public.sellerpilot_ingest_orders_pre_lazada_ownership(p_credential_id,p_channel,p_orders);
  perform set_config('sellerpilot.lazada_ingest_credential',coalesce(previous,''),true);
  return result;
end $$;
revoke all on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) to service_role;

-- Leave every other channel's fulfillment projection byte-for-byte equivalent.
create or replace function public.sellerpilot_get_order_fulfillment_context_v2(p_ids uuid[])
returns table(id uuid,external_order_id text,channel_key text,status text,provider_context jsonb)
language sql stable security definer set search_path=pg_catalog,public,sellerpilot_private as $$
 select o.id,o.external_order_id,o.channel_key,o.status,
   case when o.channel_key='lazada' and (
      o.lazada_ownership_blocked or sellerpilot_private.lazada_order_has_item_conflict(o.id) or o.lazada_seller_account_key is null
      or (select count(*) from sellerpilot_private.channel_credentials c where c.channel='lazada'
          and c.created_by=o.owner_id and c.environment='production' and c.status='active')<>1
      or not exists(select 1 from sellerpilot_private.channel_credentials c where c.channel='lazada'
          and c.created_by=o.owner_id and c.environment='production' and c.status='active'
          and c.seller_account_key=o.lazada_seller_account_key
          and c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null))
     then jsonb_build_object('orderId',o.external_order_id,'orderItemIds','[]'::jsonb,'deliveryType','')
     else o.provider_context end
 from sellerpilot_private.commerce_orders o
 where public.sellerpilot_is_admin() and o.id=any(coalesce(p_ids,array[]::uuid[])) and not o.demo
 order by o.ordered_at limit 20
$$;
revoke all on function public.sellerpilot_get_order_fulfillment_context_v2(uuid[]) from public,anon;
grant execute on function public.sellerpilot_get_order_fulfillment_context_v2(uuid[]) to authenticated;

-- Applied to existing queued rows as they are claimed, and again at the
-- provider-mutation marker. Never trust a previously serialized draft.
create function sellerpilot_private.guard_lazada_shipment_job()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,sellerpilot_private as $$
declare o record; c record; a jsonb; current_ids jsonb; requested_ids jsonb;
begin
 if new.channel<>'lazada' or new.operation not in ('shipment.confirm','shipment.acknowledge') then return new; end if;
 if tg_op='UPDATE' then
   if tg_argv[0]='provider_marker' then
     -- UPDATE OF fires even when COALESCE retains the existing marker. Every
     -- external-write authorization attempt must recheck current ownership.
     if new.status<>'running' then raise exception 'LAZADA_SHIPMENT_NOT_RUNNING'; end if;
   elsif new.status<>'running' or old.status='running' then
     return new;
   end if;
 end if;
 select * into c from sellerpilot_private.channel_credentials where id=new.credential_id;
 if c.seller_account_key is null then raise exception 'LAZADA_SHIPMENT_CURRENT_LINEAGE_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lazada:'||c.seller_account_key,0));
 -- Refresh credential status after any wait for the physical seller lock.
 select * into c from sellerpilot_private.channel_credentials where id=new.credential_id;
 select * into o from sellerpilot_private.commerce_orders where id=new.order_id;
 if o.id is null or o.channel_key<>'lazada' or o.demo or o.status not in ('paid','ready_to_ship')
   or o.lazada_ownership_blocked or sellerpilot_private.lazada_order_has_item_conflict(o.id)
   or o.owner_id is distinct from c.created_by or o.owner_id is distinct from new.created_by
   or o.lazada_seller_account_key is distinct from c.seller_account_key
   or new.seller_account_key is distinct from c.seller_account_key
   or c.channel<>'lazada' or c.status<>'active' or c.environment<>new.environment
   or c.seller_account_key_source<>'provider_certified_v1' or c.seller_account_verified_at is null then
   raise exception 'LAZADA_SHIPMENT_CURRENT_OWNERSHIP_CONFLICT';
 end if;
 a:=new.request_payload->'arguments';
 if a->>'orderId' is distinct from o.external_order_id
   or a->'providerContext'->>'orderId' is distinct from o.external_order_id
   or a->'providerContext'->>'deliveryType' is distinct from o.provider_context->>'deliveryType'
   or jsonb_typeof(a->'providerContext'->'orderItemIds') is distinct from 'array'
   or jsonb_typeof(o.provider_context->'orderItemIds') is distinct from 'array' then
   raise exception 'LAZADA_SHIPMENT_STALE_CONTEXT';
 end if;
 select jsonb_agg(value order by value) into current_ids from jsonb_array_elements(o.provider_context->'orderItemIds');
 select jsonb_agg(value order by value) into requested_ids from jsonb_array_elements(a->'providerContext'->'orderItemIds');
 if current_ids is null or current_ids is distinct from requested_ids
   or exists(select 1 from jsonb_array_elements_text(current_ids) x(item) where not exists(
     select 1 from sellerpilot_private.lazada_order_item_claims k where k.order_id=o.id
       and k.seller_account_key=c.seller_account_key and k.remote_item_id=x.item)) then
   raise exception 'LAZADA_SHIPMENT_STALE_CONTEXT';
 end if;
 return new;
end $$;
create trigger zzzz_guard_lazada_shipment_job before insert or update of status on sellerpilot_private.channel_gateway_jobs
 for each row execute function sellerpilot_private.guard_lazada_shipment_job();
create trigger zzzz_guard_lazada_shipment_marker before update of provider_mutation_started_at on sellerpilot_private.channel_gateway_jobs
 for each row execute function sellerpilot_private.guard_lazada_shipment_job('provider_marker');
revoke all on function sellerpilot_private.guard_lazada_shipment_job() from public,anon,authenticated,service_role;

commit;
