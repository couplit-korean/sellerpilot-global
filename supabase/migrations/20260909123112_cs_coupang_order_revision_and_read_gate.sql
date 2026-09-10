-- Proposal-only coordinator migration. Do not apply from the channel worktree.
-- Adds read-side Coupang order provenance without changing provider orders,
-- fulfillment, shipment, cancellation, refund, product, or inventory state.

begin;

-- Pin the observed production wrapper chain and the canonical common CS
-- migration. If a coordinator migration changes any preimage, this proposal
-- must be rebased instead of silently replacing that implementation.
do $$
begin
  if to_regprocedure('public.sellerpilot_service_ingest_orders(uuid,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_ingest_orders_pre_lazada_ownership(uuid,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_270827_ingest_orders_without_shopee_lineage(uuid,text,jsonb)') is null
     or to_regprocedure('public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(uuid,text,jsonb)') is null
     or to_regprocedure('sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)') is null
     or to_regprocedure('sellerpilot_private.reconcile_cs_order_binding_from_ticket()') is null
     or to_regprocedure('sellerpilot_private.reconcile_cs_order_bindings_from_order()') is null
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_service_ingest_orders(uuid,text,jsonb)'::regprocedure)
        is distinct from '7657c4469226c8a0873628e9f029380d'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_ingest_orders_pre_lazada_ownership(uuid,text,jsonb)'::regprocedure)
        is distinct from '1a426cc962f53f230a4fa4e0f147d22e'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_270827_ingest_orders_without_shopee_lineage(uuid,text,jsonb)'::regprocedure)
        is distinct from '72163b030ad8554f56df9b673f098510'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(uuid,text,jsonb)'::regprocedure)
        is distinct from 'fb7b4b6eea9d1d4b8c7e3a60c9949b31'
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)'::regprocedure)
        is distinct from '1fdde0da2bcaf7c1e1d903e471f37c52'
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.reconcile_cs_order_binding_from_ticket()'::regprocedure)
        is distinct from 'c60972386a52709d7af1c6be3d4e0d38'
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.reconcile_cs_order_bindings_from_order()'::regprocedure)
        is distinct from '1f50bece268e0a27ecd43790b955ed6a'
     or not has_function_privilege(
          'service_role','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege(
          'authenticated','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE') then
    raise exception 'COUPANG_CS_ORDER_LINEAGE_PREIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

create table sellerpilot_private.coupang_order_credential_lineage(
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  external_order_id text not null check(length(trim(external_order_id)) between 1 and 240),
  order_id uuid not null references sellerpilot_private.commerce_orders(id) on delete cascade,
  order_revision text not null check(order_revision ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default clock_timestamp(),
  primary key(source_credential_id,external_order_id),
  unique(order_id,source_credential_id)
);
create index coupang_order_lineage_lookup_idx
  on sellerpilot_private.coupang_order_credential_lineage(
    owner_id,external_order_id,seller_account_key
  );
alter table sellerpilot_private.coupang_order_credential_lineage enable row level security;
revoke all on sellerpilot_private.coupang_order_credential_lineage
  from public,anon,authenticated,service_role;

create function sellerpilot_private.coupang_order_revision_v1(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select encode(extensions.digest(concat_ws(E'\x1f',
    'coupang-order-revision-v1',to_jsonb(orders)::text
  ),'sha256'),'hex')
    from sellerpilot_private.commerce_orders orders
   where orders.id=p_order_id
     and orders.channel_key='coupang'
     and not orders.demo
$$;
revoke all on function sellerpilot_private.coupang_order_revision_v1(uuid)
  from public,anon,authenticated,service_role;

alter table sellerpilot_private.cs_order_bindings
  add column coupang_lineage_status text
    check(coupang_lineage_status is null or coupang_lineage_status in(
      'exact','not_applicable','unmatched','unverified_credential',
      'legacy_unknown','vendor_mismatch','cross_vendor_collision'
    ));

-- Never fail the already-completed order ingest. Only a current, verified,
-- provider-certified production credential can append evidence. All failures
-- are returned as local diagnostic states, not raised into the order caller.
create function sellerpilot_private.record_coupang_order_lineage_v1(
  p_credential_id uuid,
  p_order_id uuid,
  p_external_order_id text
) returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_seller_account_key text;
  v_order sellerpilot_private.commerce_orders%rowtype;
  v_order_revision text;
begin
  select credential.created_by,credential.seller_account_key
    into v_owner,v_seller_account_key
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='coupang'
     and credential.environment='production'
     and credential.status in('active','grace')
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>statement_timestamp());
  if not found then
    return 'credential_unverified';
  end if;

  select orders.* into v_order
    from sellerpilot_private.commerce_orders orders
   where orders.id=p_order_id
     and orders.owner_id=v_owner
     and orders.channel_key='coupang'
     and orders.external_order_id=nullif(trim(p_external_order_id),'')
     and not orders.demo
   for key share;
  if not found then
    return 'order_unmatched';
  end if;
  v_order_revision:=sellerpilot_private.coupang_order_revision_v1(v_order.id);
  if v_order_revision is null then
    return 'order_unmatched';
  end if;

  insert into sellerpilot_private.coupang_order_credential_lineage(
    owner_id,source_credential_id,seller_account_key,external_order_id,
    order_id,order_revision,observed_at
  ) values(
    v_owner,p_credential_id,v_seller_account_key,v_order.external_order_id,
    v_order.id,v_order_revision,clock_timestamp()
  )
  on conflict(source_credential_id,external_order_id) do update set
    order_id=excluded.order_id,
    order_revision=excluded.order_revision,
    observed_at=excluded.observed_at
  where sellerpilot_private.coupang_order_credential_lineage.owner_id=excluded.owner_id
    and sellerpilot_private.coupang_order_credential_lineage.seller_account_key=excluded.seller_account_key;
  if not found then
    return 'immutable_mismatch';
  end if;
  return 'recorded';
exception when others then
  -- PL/pgSQL rolls back statements in this block, including a partial ledger
  -- write, while the caller's earlier order ingest remains intact.
  return 'storage_unavailable';
end;
$$;
revoke all on function sellerpilot_private.record_coupang_order_lineage_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.coupang_cs_order_binding_candidate_v1(p_ticket_id uuid)
returns table(order_id uuid,lineage_status text)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_order_id uuid;
  v_order_revision text;
  v_distinct_sellers integer;
  v_has_current_revision boolean;
  v_has_current_ticket_seller boolean;
begin
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id=p_ticket_id and ticket.channel_key='coupang' and not ticket.demo;
  if not found then
    raise exception 'COUPANG_CS_ORDER_TICKET_INVALID' using errcode='22023';
  end if;
  if nullif(trim(v_ticket.external_order_reference),'') is null then
    return query select null::uuid,'not_applicable'::text;
    return;
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_ticket.source_credential_id
     and credential.created_by=v_ticket.owner_id
     and credential.channel='coupang'
     and credential.environment='production'
     and credential.status in('active','grace')
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and (credential.expires_at is null or credential.expires_at>statement_timestamp());
  if not found
     or v_ticket.seller_account_key is distinct from v_credential.seller_account_key then
    return query select null::uuid,'unverified_credential'::text;
    return;
  end if;

  select orders.id into v_order_id
    from sellerpilot_private.commerce_orders orders
   where orders.owner_id=v_ticket.owner_id
     and orders.channel_key='coupang'
     and orders.external_order_id=trim(v_ticket.external_order_reference)
     and not orders.demo;
  if not found then
    return query select null::uuid,'unmatched'::text;
    return;
  end if;
  v_order_revision:=sellerpilot_private.coupang_order_revision_v1(v_order_id);

  select count(distinct lineage.seller_account_key)::integer,
         coalesce(bool_or(lineage.order_revision=v_order_revision),false),
         coalesce(bool_or(lineage.order_revision=v_order_revision
           and lineage.seller_account_key=v_credential.seller_account_key),false)
    into v_distinct_sellers,v_has_current_revision,v_has_current_ticket_seller
    from sellerpilot_private.coupang_order_credential_lineage lineage
   where lineage.owner_id=v_ticket.owner_id
     and lineage.external_order_id=trim(v_ticket.external_order_reference)
     and lineage.order_id=v_order_id;

  if v_distinct_sellers=0 then
    return query select null::uuid,'legacy_unknown'::text;
    return;
  elsif v_distinct_sellers>1 then
    return query select null::uuid,'cross_vendor_collision'::text;
    return;
  elsif not v_has_current_revision then
    return query select null::uuid,'legacy_unknown'::text;
    return;
  elsif not v_has_current_ticket_seller then
    return query select null::uuid,'vendor_mismatch'::text;
    return;
  end if;
  return query select v_order_id,'exact'::text;
  return;
end;
$$;
revoke all on function sellerpilot_private.coupang_cs_order_binding_candidate_v1(uuid)
  from public,anon,authenticated,service_role;

-- Preserve the canonical common implementation as an immutable predecessor.
alter function sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)
  rename to cs_order_binding_is_exact_pre_coupang_lineage_v1;
revoke all on function sellerpilot_private.cs_order_binding_is_exact_pre_coupang_lineage_v1(uuid,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.cs_order_binding_is_exact(
  p_owner_id uuid,p_channel text,p_external_order_reference text,
  p_credential_id uuid,p_order_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if p_channel<>'coupang' then
    return sellerpilot_private.cs_order_binding_is_exact_pre_coupang_lineage_v1(
      p_owner_id,p_channel,p_external_order_reference,p_credential_id,p_order_id
    );
  end if;
  if p_order_id is null then
    return true;
  end if;
  return exists(
    select 1
      from sellerpilot_private.commerce_orders orders
      join sellerpilot_private.channel_credentials credential
        on credential.id=p_credential_id
       and credential.created_by=p_owner_id
       and credential.channel='coupang'
       and credential.environment='production'
       and credential.status in('active','grace')
       and credential.seller_account_key ~ '^[a-f0-9]{64}$'
       and credential.seller_account_key_source='provider_certified_v1'
       and credential.seller_account_verified_at is not null
       and (credential.expires_at is null or credential.expires_at>statement_timestamp())
     where orders.id=p_order_id
       and orders.owner_id=p_owner_id
       and orders.channel_key='coupang'
       and orders.external_order_id=nullif(trim(p_external_order_reference),'')
       and not orders.demo
       and (select count(distinct lineage.seller_account_key)
              from sellerpilot_private.coupang_order_credential_lineage lineage
             where lineage.owner_id=p_owner_id
               and lineage.external_order_id=orders.external_order_id
               and lineage.order_id=orders.id)=1
       and exists(
         select 1
           from sellerpilot_private.coupang_order_credential_lineage lineage
          where lineage.owner_id=p_owner_id
            and lineage.external_order_id=orders.external_order_id
            and lineage.order_id=orders.id
            and lineage.order_revision=
              sellerpilot_private.coupang_order_revision_v1(orders.id)
            and lineage.seller_account_key=credential.seller_account_key
       )
  );
end;
$$;
revoke all on function sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_order_id uuid;
  v_lineage_status text;
  v_binding_status text;
  v_existing_credential_id uuid;
begin
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id=p_ticket_id and ticket.channel_key='coupang' and not ticket.demo
   for update;
  if not found then return; end if;
  select credential.id into v_existing_credential_id
    from sellerpilot_private.channel_credentials credential
   where credential.id=v_ticket.source_credential_id;
  select candidate.order_id,candidate.lineage_status
    into strict v_order_id,v_lineage_status
    from sellerpilot_private.coupang_cs_order_binding_candidate_v1(v_ticket.id) candidate;
  v_binding_status:=case v_lineage_status
    when 'exact' then 'exact'
    when 'not_applicable' then 'not_applicable'
    when 'unverified_credential' then 'unverified_credential'
    else 'unmatched'
  end;

  update sellerpilot_private.support_tickets ticket
     set order_id=v_order_id
   where ticket.id=v_ticket.id and ticket.order_id is distinct from v_order_id;
  insert into sellerpilot_private.cs_order_bindings(
    ticket_id,credential_id,channel,external_order_reference,order_id,status,
    evidence_fingerprint,checked_at,coupang_lineage_status
  ) values(
    v_ticket.id,v_existing_credential_id,'coupang',
    nullif(trim(v_ticket.external_order_reference),''),v_order_id,v_binding_status,
    encode(extensions.digest(concat_ws(E'\x1f','coupang-cs-order-v2',v_ticket.owner_id::text,
      coalesce(v_ticket.source_credential_id::text,''),coalesce(v_ticket.seller_account_key,''),
      coalesce(v_ticket.external_order_reference,''),coalesce(v_order_id::text,''),
      coalesce(sellerpilot_private.coupang_order_revision_v1(v_order_id),''),v_lineage_status
    ),'sha256'),'hex'),clock_timestamp(),v_lineage_status
  ) on conflict(ticket_id) do update set
    credential_id=excluded.credential_id,
    channel=excluded.channel,
    external_order_reference=excluded.external_order_reference,
    order_id=excluded.order_id,
    status=excluded.status,
    evidence_fingerprint=excluded.evidence_fingerprint,
    checked_at=excluded.checked_at,
    coupang_lineage_status=excluded.coupang_lineage_status;
end;
$$;
revoke all on function sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(uuid)
  from public,anon,authenticated,service_role;

-- The existing ticket trigger keeps its OID and trigger declaration. Only its
-- Coupang branch changes; every non-Coupang call still goes to the canonical
-- common reconciler with the same arguments and return behavior.
create or replace function sellerpilot_private.reconcile_cs_order_binding_from_ticket()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.channel_key='coupang' and not new.demo then
    begin
      perform sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(new.id);
    exception when others then
      -- A CS projection outage must not roll back provider intake.
      null;
    end;
  else
    perform sellerpilot_private.reconcile_one_cs_order_binding(new.id);
  end if;
  return new;
end;
$$;
revoke all on function sellerpilot_private.reconcile_cs_order_binding_from_ticket()
  from public,anon,authenticated,service_role;

-- Preserve the canonical old/new identity lookup query and row order. The only
-- branch is which exact reconciler is called for the selected ticket.
create or replace function sellerpilot_private.reconcile_cs_order_bindings_from_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ticket record;
begin
  for v_ticket in
    select ticket.id,ticket.channel_key
      from sellerpilot_private.support_tickets ticket
     where (tg_op <> 'DELETE' and ticket.owner_id=new.owner_id
       and ticket.channel_key=new.channel_key
       and nullif(trim(ticket.external_order_reference),'')=new.external_order_id)
      or (tg_op <> 'INSERT' and (
       ticket.order_id=old.id or (ticket.owner_id=old.owner_id
        and ticket.channel_key=old.channel_key
        and nullif(trim(ticket.external_order_reference),'')=old.external_order_id)))
     order by ticket.id
  loop
    if v_ticket.channel_key='coupang' then
      begin
        perform sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(v_ticket.id);
      exception when others then
        -- The order row is authoritative for the completed ingest. Readers
        -- independently enforce exact lineage and cannot trust a stale link.
        null;
      end;
    else
      perform sellerpilot_private.reconcile_one_cs_order_binding(v_ticket.id);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function sellerpilot_private.reconcile_cs_order_bindings_from_order()
  from public,anon,authenticated,service_role;

create function sellerpilot_private.reconcile_coupang_cs_order_bindings_from_lineage_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  v_external_order_id text:=case when tg_op='DELETE' then old.external_order_id else new.external_order_id end;
  v_ticket_id uuid;
begin
  for v_ticket_id in
    select ticket.id
      from sellerpilot_private.support_tickets ticket
     where ticket.owner_id=v_owner
       and ticket.channel_key='coupang'
       and not ticket.demo
       and nullif(trim(ticket.external_order_reference),'')=v_external_order_id
     order by ticket.id
  loop
    begin
      perform sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(v_ticket_id);
    exception when others then
      null;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function sellerpilot_private.reconcile_coupang_cs_order_bindings_from_lineage_v1()
  from public,anon,authenticated,service_role;
create trigger sellerpilot_reconcile_coupang_cs_order_bindings_after_lineage
after insert or update or delete on sellerpilot_private.coupang_order_credential_lineage
for each row execute function sellerpilot_private.reconcile_coupang_cs_order_bindings_from_lineage_v1();

create function sellerpilot_private.reconcile_coupang_cs_order_bindings_from_credential_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ticket_id uuid;
begin
  for v_ticket_id in
    select ticket.id
      from sellerpilot_private.support_tickets ticket
     where ticket.channel_key='coupang'
       and not ticket.demo
       and ticket.source_credential_id=new.id
     order by ticket.id
  loop
    begin
      perform sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(v_ticket_id);
    exception when others then
      null;
    end;
  end loop;
  return null;
end;
$$;
revoke all on function sellerpilot_private.reconcile_coupang_cs_order_bindings_from_credential_v1()
  from public,anon,authenticated,service_role;
create trigger sellerpilot_reconcile_coupang_cs_order_bindings_after_credential
after update of status,environment,seller_account_key,seller_account_key_source,
  seller_account_verified_at,expires_at
on sellerpilot_private.channel_credentials
for each row when(old.channel='coupang' or new.channel='coupang')
execute function sellerpilot_private.reconcile_coupang_cs_order_bindings_from_credential_v1();

-- There is deliberately no install-time UPDATE of support_tickets or
-- cs_order_bindings. Existing Coupang links remain physically unchanged for
-- impact counting, while this exact validator denies them until an exact
-- provider-certified read appends lineage and the targeted triggers rebind.

alter function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  rename to sellerpilot_ingest_orders_pre_coupang_cs_lineage_v1;
revoke all on function public.sellerpilot_ingest_orders_pre_coupang_cs_lineage_v1(uuid,text,jsonb)
  from public,anon,authenticated,service_role;

-- This is the complete executable hook against the current
-- Lazada -> Shopee -> historical upsert wrapper chain. It calls the entire
-- existing implementation first and preserves its return value and errors.
create function public.sellerpilot_service_ingest_orders(
  p_credential_id uuid,
  p_channel text,
  p_orders jsonb
) returns integer
language plpgsql
security definer
set search_path=pg_catalog,public,sellerpilot_private
as $$
declare
  v_result integer;
  v_owner uuid;
  v_order jsonb;
  v_external_order_id text;
  v_order_id uuid;
  v_ticket_id uuid;
  v_record_status text;
begin
  v_result:=public.sellerpilot_ingest_orders_pre_coupang_cs_lineage_v1(
    p_credential_id,p_channel,p_orders
  );
  if p_channel<>'coupang' then
    return v_result;
  end if;

  select credential.created_by into v_owner
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='coupang';
  if not found then
    return v_result;
  end if;

  for v_order in select value from jsonb_array_elements(p_orders)
  loop
    v_external_order_id:=left(trim(coalesce(v_order->>'externalOrderId','')),240);
    if v_external_order_id<>'' then
      select orders.id into v_order_id
        from sellerpilot_private.commerce_orders orders
       where orders.owner_id=v_owner
         and orders.channel_key='coupang'
         and orders.external_order_id=v_external_order_id
         and not orders.demo;
      if found then
        v_record_status:=sellerpilot_private.record_coupang_order_lineage_v1(
          p_credential_id,v_order_id,v_external_order_id
        );
        -- Always revisit only tickets for the touched owner/order reference.
        -- If evidence was denied or its storage failed, the candidate remains
        -- unverified/legacy and cannot become exact.
        for v_ticket_id in
          select ticket.id
            from sellerpilot_private.support_tickets ticket
           where ticket.owner_id=v_owner
             and ticket.channel_key='coupang'
             and not ticket.demo
             and nullif(trim(ticket.external_order_reference),'')=v_external_order_id
           order by ticket.id
        loop
          begin
            perform sellerpilot_private.reconcile_one_coupang_cs_order_binding_v1(v_ticket_id);
          exception when others then
            -- CS projection failure is observable through absent/non-exact
            -- lineage, but never changes the completed order-ingest outcome.
            null;
          end;
        end loop;
      end if;
    end if;
  end loop;
  return v_result;
end;
$$;
revoke all on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
  to service_role;

-- The complete predecessor chain and API ACL must still be intact after the
-- rename/wrap. No historical wrapper is recreated or edited in place.
do $$
begin
  if (select md5(prosrc) from pg_proc
        where oid='public.sellerpilot_ingest_orders_pre_coupang_cs_lineage_v1(uuid,text,jsonb)'::regprocedure)
       is distinct from '7657c4469226c8a0873628e9f029380d'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_ingest_orders_pre_lazada_ownership(uuid,text,jsonb)'::regprocedure)
        is distinct from '1a426cc962f53f230a4fa4e0f147d22e'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_270827_ingest_orders_without_shopee_lineage(uuid,text,jsonb)'::regprocedure)
        is distinct from '72163b030ad8554f56df9b673f098510'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(uuid,text,jsonb)'::regprocedure)
        is distinct from 'fb7b4b6eea9d1d4b8c7e3a60c9949b31'
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.cs_order_binding_is_exact_pre_coupang_lineage_v1(uuid,text,text,uuid,uuid)'::regprocedure)
        is distinct from '1fdde0da2bcaf7c1e1d903e471f37c52'
     or not has_function_privilege(
          'service_role','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege(
          'authenticated','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_service_ingest_orders(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_ingest_orders_pre_coupang_cs_lineage_v1(uuid,text,jsonb)','EXECUTE') then
    raise exception 'COUPANG_CS_ORDER_LINEAGE_POSTIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

-- Proposal-only coordinator migration. Apply only after the reviewed 007
-- Coupang order-lineage migration. No provider or commerce mutation is added.

do $$
begin
  if to_regclass('sellerpilot_private.cs_reply_draft_jobs') is null
     or to_regprocedure('public.sellerpilot_create_cs_reply_draft(uuid,uuid,text,text,text)') is null
     or to_regprocedure('sellerpilot_private.coupang_cs_order_binding_candidate_v1(uuid)') is null
     or to_regprocedure('sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)') is null
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.coupang_cs_order_binding_candidate_v1(uuid)'::regprocedure)
        is distinct from 'd3b63be5f1d57a55196b1598622a8cf3'
     or (select md5(prosrc) from pg_proc
          where oid='sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)'::regprocedure)
        is distinct from 'c8d22addeaa08f37a4787a0549dd4141'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure)
        is distinct from 'a1395073773c39c98aae04b2cdc0652f'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_get_ticket_reply_context_v2(uuid)'::regprocedure)
        is distinct from 'a95fc5f04ab1eec9a2c3287f47fdaef7'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_31033000_create_support_reply_job_unsafe(uuid,uuid,text,text)'::regprocedure)
        is distinct from 'f283b016bf036df178a8ed34c97096c4'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_read_cs_order_binding_health_v1()'::regprocedure)
        is distinct from '545c98eb651cac531354bbe32ccb0196'
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')

     or not has_function_privilege(
          'authenticated','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE') then
    raise exception 'COUPANG_CS_ORDER_READER_GATE_PREIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

create function sellerpilot_private.coupang_cs_order_read_is_exact_v1(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce((
    select ticket.channel_key<>'coupang' or (
      ticket.order_id is not null
      and sellerpilot_private.cs_order_binding_is_exact(
        ticket.owner_id,ticket.channel_key,ticket.external_order_reference,
        ticket.source_credential_id,ticket.order_id
      )
    )
      from sellerpilot_private.support_tickets ticket
     where ticket.id=p_ticket_id and not ticket.demo
  ),false)
$$;
revoke all on function sellerpilot_private.coupang_cs_order_read_is_exact_v1(uuid)
  from public,anon,authenticated,service_role;

alter function public.sellerpilot_get_cs_workspace_snapshot()
  rename to sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1;
revoke all on function public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1()
  from public,anon,authenticated,service_role;

create function public.sellerpilot_get_cs_workspace_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_tickets jsonb;
begin
  v_result:=public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1();
  select coalesce(jsonb_agg(
    case when ticket.channel_key='coupang'
              and item.value->'orderId'<>'null'::jsonb
              and not sellerpilot_private.coupang_cs_order_read_is_exact_v1(ticket.id)
         then jsonb_set(item.value,'{orderId}','null'::jsonb,true)
         else item.value end
    order by item.ordinality
  ),'[]'::jsonb)
    into v_tickets
    from jsonb_array_elements(coalesce(v_result->'tickets','[]'::jsonb))
      with ordinality item(value,ordinality)
    left join sellerpilot_private.support_tickets ticket
      on ticket.id=(item.value->>'ticketId')::uuid;
  return jsonb_set(v_result,'{tickets}',v_tickets,true);
end;
$$;
revoke all on function public.sellerpilot_get_cs_workspace_snapshot()
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_cs_workspace_snapshot()
  to authenticated;

alter function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  rename to sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  v_result:=public.sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1(p_id);
  if v_result is not null
     and v_result->>'channel_key'='coupang'
     and v_result->'order_id'<>'null'::jsonb
     and not sellerpilot_private.coupang_cs_order_read_is_exact_v1(p_id) then
    v_result:=jsonb_set(v_result,'{order_id}','null'::jsonb,true);
  end if;
  return v_result;
end;
$$;
revoke all on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_ticket_reply_context_v2(uuid)
  to authenticated;

-- Dedicated CS drafts already store order=null; preserve that canonical path and its Lazada concurrency guard.

alter function public.sellerpilot_read_cs_order_binding_health_v1()
  rename to sellerpilot_read_cs_order_binding_health_pre_coupang_gate_v1;
revoke all on function public.sellerpilot_read_cs_order_binding_health_pre_coupang_gate_v1()
  from public,anon,authenticated,service_role;

create function public.sellerpilot_read_cs_order_binding_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',channel,'status',status,'count',count
  ) order by channel,status),'[]'::jsonb)
    into v_rows
    from(
      select effective.channel,effective.status,count(*)::integer count
        from(
          select binding.channel,
            case when binding.channel<>'coupang' then binding.status
                 else case (select candidate.lineage_status
                              from sellerpilot_private.coupang_cs_order_binding_candidate_v1(ticket.id)
                                   candidate)
                        when 'exact' then 'exact'
                        when 'not_applicable' then 'not_applicable'
                        when 'unverified_credential' then 'unverified_credential'
                        else 'unmatched' end
                 end as status
            from sellerpilot_private.cs_order_bindings binding
            join sellerpilot_private.support_tickets ticket
              on ticket.id=binding.ticket_id
           where ticket.owner_id=auth.uid() and not ticket.demo
        ) effective
       group by effective.channel,effective.status
    ) summary;
  return jsonb_build_object(
    'contract','sellerpilot-cs-order-binding-health/1',
    'checkedAt',statement_timestamp(),
    'groups',v_rows,
    'matchingRule','same_owner_channel_exact_external_order_and_credential',
    'csCommerceMutationAllowed',false
  );
end;
$$;
revoke all on function public.sellerpilot_read_cs_order_binding_health_v1()
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_order_binding_health_v1()
  to authenticated;

do $$
begin
  if (select md5(prosrc) from pg_proc
        where oid='public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1()'::regprocedure)
       is distinct from 'a1395073773c39c98aae04b2cdc0652f'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_get_ticket_reply_context_v2_pre_coupang_order_gate_v1(uuid)'::regprocedure)
        is distinct from 'a95fc5f04ab1eec9a2c3287f47fdaef7'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_31033000_create_support_reply_job_unsafe(uuid,uuid,text,text)'::regprocedure)
        is distinct from 'f283b016bf036df178a8ed34c97096c4'
     or (select md5(prosrc) from pg_proc
          where oid='public.sellerpilot_read_cs_order_binding_health_pre_coupang_gate_v1()'::regprocedure)
        is distinct from '545c98eb651cac531354bbe32ccb0196'
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE')
     or not has_function_privilege(
          'authenticated','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_get_ticket_reply_context_v2(uuid)','EXECUTE')

     or not has_function_privilege(
          'authenticated','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'anon','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE')
     or has_function_privilege(
          'service_role','public.sellerpilot_read_cs_order_binding_health_v1()','EXECUTE') then
    raise exception 'COUPANG_CS_ORDER_READER_GATE_POSTIMAGE_OR_ACL_MISMATCH';
  end if;
end;
$$;

notify pgrst,'reload schema';
commit;
