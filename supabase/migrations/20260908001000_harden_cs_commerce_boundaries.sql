-- Keep customer-service reads linked to the exact marketplace order while
-- preventing a CS lineage from becoming a commerce mutation.
begin;

create table sellerpilot_private.cs_order_bindings(
  ticket_id uuid primary key references sellerpilot_private.support_tickets(id) on delete cascade,
  credential_id uuid references sellerpilot_private.channel_credentials(id) on delete set null,
  channel text not null,
  external_order_reference text,
  order_id uuid references sellerpilot_private.commerce_orders(id) on delete set null,
  status text not null check(status in('exact','unmatched','unverified_credential','not_applicable')),
  evidence_fingerprint text not null check(evidence_fingerprint~'^[a-f0-9]{64}$'),
  checked_at timestamptz not null default clock_timestamp()
);
create index cs_order_bindings_health_idx on sellerpilot_private.cs_order_bindings(channel,status,checked_at desc);
alter table sellerpilot_private.cs_order_bindings enable row level security;
revoke all on sellerpilot_private.cs_order_bindings from public,anon,authenticated,service_role;

create function sellerpilot_private.cs_order_binding_is_exact(p_owner_id uuid,p_channel text,p_external_order_reference text,p_credential_id uuid,p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_order_id is null or exists(
  select 1 from sellerpilot_private.commerce_orders orders
  join sellerpilot_private.channel_credentials credential on credential.id=p_credential_id
   and credential.created_by=p_owner_id and credential.channel=p_channel
  where orders.id=p_order_id and orders.owner_id=p_owner_id and orders.channel_key=p_channel
   and not orders.demo and nullif(trim(p_external_order_reference),'')=orders.external_order_id
 );
$$;
revoke all on function sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid) from public,anon,authenticated,service_role;

create function sellerpilot_private.validate_cs_order_binding() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.order_id is not null and not sellerpilot_private.cs_order_binding_is_exact(new.owner_id,new.channel_key,new.external_order_reference,new.source_credential_id,new.order_id) then
  if tg_op='UPDATE' and new.order_id is not distinct from old.order_id
    and (new.owner_id is distinct from old.owner_id or new.channel_key is distinct from old.channel_key
      or new.external_order_reference is distinct from old.external_order_reference
      or new.source_credential_id is distinct from old.source_credential_id) then
   new.order_id:=null;
  else raise exception 'CS_ORDER_BINDING_NOT_EXACT' using errcode='23514';end if;
 end if;
 return new;
end $$;
revoke all on function sellerpilot_private.validate_cs_order_binding() from public,anon,authenticated,service_role;

create function sellerpilot_private.reconcile_one_cs_order_binding(p_ticket_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_ticket sellerpilot_private.support_tickets%rowtype;v_order_id uuid;v_status text;v_credential_valid boolean:=false;v_reference text;v_existing_credential_id uuid;
begin
 select*into v_ticket from sellerpilot_private.support_tickets where id=p_ticket_id for update;
 if not found then return;end if;
 v_reference:=nullif(trim(v_ticket.external_order_reference),'');
 select id into v_existing_credential_id from sellerpilot_private.channel_credentials where id=v_ticket.source_credential_id;
 select exists(select 1 from sellerpilot_private.channel_credentials credential where credential.id=v_ticket.source_credential_id
  and credential.created_by=v_ticket.owner_id and credential.channel=v_ticket.channel_key)into v_credential_valid;
 if v_reference is null then v_status:='not_applicable';
 elsif not v_credential_valid then v_status:='unverified_credential';
 else
  select orders.id into v_order_id from sellerpilot_private.commerce_orders orders where orders.owner_id=v_ticket.owner_id
   and orders.channel_key=v_ticket.channel_key and orders.external_order_id=v_reference and not orders.demo;
  v_status:=case when found then'exact'else'unmatched'end;
 end if;
 update sellerpilot_private.support_tickets set order_id=v_order_id where id=v_ticket.id and order_id is distinct from v_order_id;
 insert into sellerpilot_private.cs_order_bindings(ticket_id,credential_id,channel,external_order_reference,order_id,status,evidence_fingerprint,checked_at)
 values(v_ticket.id,v_existing_credential_id,v_ticket.channel_key,v_reference,v_order_id,v_status,
  encode(extensions.digest(concat_ws(E'\x1f','cs-order-v1',v_ticket.owner_id::text,v_ticket.channel_key,coalesce(v_reference,''),coalesce(v_order_id::text,''),coalesce(v_ticket.source_credential_id::text,'')),'sha256'),'hex'),clock_timestamp())
 on conflict(ticket_id)do update set credential_id=excluded.credential_id,channel=excluded.channel,external_order_reference=excluded.external_order_reference,
  order_id=excluded.order_id,status=excluded.status,evidence_fingerprint=excluded.evidence_fingerprint,checked_at=excluded.checked_at;
end $$;
revoke all on function sellerpilot_private.reconcile_one_cs_order_binding(uuid) from public,anon,authenticated,service_role;

create function sellerpilot_private.reconcile_cs_order_binding_from_ticket() returns trigger language plpgsql security definer set search_path='' as $$
begin perform sellerpilot_private.reconcile_one_cs_order_binding(new.id);return new;end $$;
revoke all on function sellerpilot_private.reconcile_cs_order_binding_from_ticket() from public,anon,authenticated,service_role;
create trigger sellerpilot_reconcile_cs_order_binding after insert or update of owner_id,channel_key,external_order_reference,source_credential_id
 on sellerpilot_private.support_tickets for each row execute function sellerpilot_private.reconcile_cs_order_binding_from_ticket();

-- Reconcile both the old identity and the new identity. An UPDATE that
-- changes a lookup key must also visit tickets that no longer match NEW.
create function sellerpilot_private.reconcile_cs_order_bindings_from_order() returns trigger language plpgsql security definer set search_path='' as $$
declare v_ticket_id uuid;
begin
 for v_ticket_id in
  select ticket.id from sellerpilot_private.support_tickets ticket
  where (tg_op <> 'DELETE' and ticket.owner_id=new.owner_id
    and ticket.channel_key=new.channel_key
    and nullif(trim(ticket.external_order_reference),'')=new.external_order_id)
   or (tg_op <> 'INSERT' and (
    ticket.order_id=old.id or (ticket.owner_id=old.owner_id
     and ticket.channel_key=old.channel_key
     and nullif(trim(ticket.external_order_reference),'')=old.external_order_id)))
  order by ticket.id
 loop
  perform sellerpilot_private.reconcile_one_cs_order_binding(v_ticket_id);
 end loop;
 return null;
end $$;
revoke all on function sellerpilot_private.reconcile_cs_order_bindings_from_order() from public,anon,authenticated,service_role;
create trigger sellerpilot_reconcile_cs_order_bindings_after_order after insert or delete or update of owner_id,channel_key,external_order_id,demo
 on sellerpilot_private.commerce_orders for each row execute function sellerpilot_private.reconcile_cs_order_bindings_from_order();

create function sellerpilot_private.reconcile_cs_order_bindings_from_credential() returns trigger language plpgsql security definer set search_path='' as $$
declare v_ticket_id uuid;
begin
 for v_ticket_id in
  select ticket.id from sellerpilot_private.support_tickets ticket
  where ticket.source_credential_id=old.id
  order by ticket.id
 loop
  perform sellerpilot_private.reconcile_one_cs_order_binding(v_ticket_id);
 end loop;
 return null;
end $$;
revoke all on function sellerpilot_private.reconcile_cs_order_bindings_from_credential() from public,anon,authenticated,service_role;
create trigger sellerpilot_reconcile_cs_order_bindings_after_credential after delete or update of created_by,channel
 on sellerpilot_private.channel_credentials for each row execute function sellerpilot_private.reconcile_cs_order_bindings_from_credential();

create function sellerpilot_private.reject_cs_lineage_commerce_mutation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.request_payload?'sellerpilotTicketId' and new.operation<>'inquiries.reply' then
  raise exception 'CS_LINEAGE_COMMERCE_MUTATION_FORBIDDEN' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function sellerpilot_private.reject_cs_lineage_commerce_mutation() from public,anon,authenticated,service_role;
create trigger sellerpilot_reject_cs_lineage_commerce_mutation before insert or update of operation,request_payload
 on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.reject_cs_lineage_commerce_mutation();

insert into sellerpilot_private.cs_order_bindings(ticket_id,credential_id,channel,external_order_reference,order_id,status,evidence_fingerprint,checked_at)
select ticket.id,ticket.source_credential_id,ticket.channel_key,nullif(trim(ticket.external_order_reference),''),
 case when credential.id is not null then orders.id else null end,
 case when nullif(trim(ticket.external_order_reference),'')is null then'not_applicable' when credential.id is null then'unverified_credential'
  when orders.id is null then'unmatched'else'exact'end,
 encode(extensions.digest(concat_ws(E'\x1f','cs-order-v1',ticket.owner_id::text,ticket.channel_key,coalesce(trim(ticket.external_order_reference),''),
  coalesce(case when credential.id is not null then orders.id::text else''end,''),coalesce(ticket.source_credential_id::text,'')),'sha256'),'hex'),clock_timestamp()
from sellerpilot_private.support_tickets ticket
left join sellerpilot_private.channel_credentials credential on credential.id=ticket.source_credential_id and credential.created_by=ticket.owner_id and credential.channel=ticket.channel_key
left join sellerpilot_private.commerce_orders orders on orders.owner_id=ticket.owner_id and orders.channel_key=ticket.channel_key
 and orders.external_order_id=nullif(trim(ticket.external_order_reference),'') and not orders.demo
where not ticket.demo
on conflict(ticket_id)do update set credential_id=excluded.credential_id,channel=excluded.channel,external_order_reference=excluded.external_order_reference,
 order_id=excluded.order_id,status=excluded.status,evidence_fingerprint=excluded.evidence_fingerprint,checked_at=excluded.checked_at;
update sellerpilot_private.support_tickets ticket set order_id=binding.order_id from sellerpilot_private.cs_order_bindings binding
 where binding.ticket_id=ticket.id and ticket.order_id is distinct from binding.order_id;

create trigger sellerpilot_validate_cs_order_binding before insert or update of order_id,owner_id,channel_key,external_order_reference,source_credential_id
 on sellerpilot_private.support_tickets for each row execute function sellerpilot_private.validate_cs_order_binding();

create function public.sellerpilot_read_cs_order_binding_health_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('channel',channel,'status',status,'count',count)order by channel,status),'[]'::jsonb)into v_rows
 from(select binding.channel,binding.status,count(*)::integer count from sellerpilot_private.cs_order_bindings binding
  join sellerpilot_private.support_tickets ticket on ticket.id=binding.ticket_id where ticket.owner_id=auth.uid() and not ticket.demo group by binding.channel,binding.status)summary;
 return jsonb_build_object('contract','sellerpilot-cs-order-binding-health/1','checkedAt',statement_timestamp(),'groups',v_rows,
  'matchingRule','same_owner_channel_exact_external_order_and_credential','csCommerceMutationAllowed',false);
end $$;
revoke all on function public.sellerpilot_read_cs_order_binding_health_v1() from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_order_binding_health_v1() to authenticated;

notify pgrst,'reload schema';
commit;
