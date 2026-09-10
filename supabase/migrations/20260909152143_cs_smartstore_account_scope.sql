begin;

drop index if exists sellerpilot_private.channel_credentials_one_active_idx;
drop index if exists sellerpilot_private.channel_credentials_one_active_non_lazada_idx;
drop index if exists sellerpilot_private.channel_credentials_one_active_non_lazada_elevenst_idx;
create unique index channel_credentials_one_active_non_lazada_elevenst_smartstore_idx
  on sellerpilot_private.channel_credentials(channel,environment)
  where status='active' and channel not in('lazada','elevenst','smartstore');
create unique index channel_credentials_one_active_smartstore_account_idx
  on sellerpilot_private.channel_credentials(
    created_by,channel,environment,seller_account_key
  )
  where status='active' and channel='smartstore'
    and seller_account_key is not null;
create unique index channel_credentials_one_active_smartstore_legacy_idx
  on sellerpilot_private.channel_credentials(
    created_by,channel,environment
  )
  where status='active' and channel='smartstore'
    and seller_account_key is null;

create table sellerpilot_private.smartstore_cs_ticket_identities_v1(
  ticket_id uuid primary key
    references sellerpilot_private.support_tickets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  seller_account_key text not null,
  source_credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  provider_ticket_kind text not null
    check(provider_ticket_kind in('product','customer')),
  provider_ticket_id text not null check(provider_ticket_id~'^[1-9][0-9]{0,18}$'),
  legacy_external_ticket_id text not null,
  identity_contract text not null
    check(identity_contract in(
      'smartstore-provider-ticket-v1',
      'smartstore-legacy-ticket-compat-v1'
    )),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id,seller_account_key,provider_ticket_kind,provider_ticket_id)
);
create index smartstore_cs_ticket_identity_credential_idx
  on sellerpilot_private.smartstore_cs_ticket_identities_v1(
    owner_id,source_credential_id,updated_at desc
  );
alter table sellerpilot_private.smartstore_cs_ticket_identities_v1
  enable row level security;
revoke all on sellerpilot_private.smartstore_cs_ticket_identities_v1
  from public,anon,authenticated,service_role;

create function sellerpilot_private.sync_smartstore_cs_ticket_identity_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing sellerpilot_private.smartstore_cs_ticket_identities_v1%rowtype;
  v_kind text;
  v_provider_id text;
  v_expected_legacy text;
  v_contract text;
begin
  if new.channel_key<>'smartstore' or new.demo then
    delete from sellerpilot_private.smartstore_cs_ticket_identities_v1
     where ticket_id=new.id;
    return new;
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=new.source_credential_id
     and credential.created_by=new.owner_id
     and credential.channel='smartstore'
     and credential.environment='production'
     and credential.status in('active','grace')
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found
     or new.seller_account_key is distinct from v_credential.seller_account_key
     or new.channel_account_id is distinct from new.source_credential_id then
    delete from sellerpilot_private.smartstore_cs_ticket_identities_v1
     where ticket_id=new.id;
    return new;
  end if;

  v_kind:=coalesce(
    nullif(new.provider_context->>'providerTicketKind',''),
    nullif(new.provider_context->>'kind','')
  );
  v_provider_id:=case v_kind
    when 'product' then coalesce(
      nullif(new.provider_context->>'providerTicketId',''),
      nullif(new.provider_context->>'questionId',''),
      nullif(regexp_replace(new.external_ticket_id,'^smartstore:product-qna:',''),'')
    )
    when 'customer' then coalesce(
      nullif(new.provider_context->>'providerTicketId',''),
      nullif(new.provider_context->>'inquiryNo',''),
      nullif(regexp_replace(new.external_ticket_id,'^customer:',''),'')
    )
    else null end;
  v_expected_legacy:=case v_kind
    when 'product' then 'smartstore:product-qna:'||coalesce(v_provider_id,'')
    when 'customer' then 'customer:'||coalesce(v_provider_id,'')
    else null end;
  if v_provider_id is null
     or v_provider_id!~'^[1-9][0-9]{0,18}$'
     or new.external_ticket_id is distinct from v_expected_legacy
     or (
       new.provider_context ? 'legacyExternalTicketId'
       and new.provider_context->>'legacyExternalTicketId'
         is distinct from v_expected_legacy
     )
     or (
       new.provider_context ? 'providerTicketId'
       and new.provider_context->>'providerTicketId' is distinct from v_provider_id
     )
     or (
       new.provider_context ? 'providerTicketKind'
       and new.provider_context->>'providerTicketKind' is distinct from v_kind
     ) then
    raise exception 'SMARTSTORE_CS_TICKET_PROVIDER_IDENTITY_INVALID'
      using errcode='23514';
  end if;

  v_contract:=case
    when new.provider_context->>'identityContract'
      ='smartstore-provider-ticket-v1'
      then 'smartstore-provider-ticket-v1'
    when not(new.provider_context ? 'identityContract')
      then 'smartstore-legacy-ticket-compat-v1'
    else null end;
  if v_contract is null then
    raise exception 'SMARTSTORE_CS_TICKET_IDENTITY_CONTRACT_INVALID'
      using errcode='23514';
  end if;

  select identity.* into v_existing
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
   where identity.ticket_id=new.id
   for update;
  if found and (
    v_existing.owner_id is distinct from new.owner_id
    or v_existing.seller_account_key is distinct from v_credential.seller_account_key
    or v_existing.source_credential_id is distinct from new.source_credential_id
    or v_existing.provider_ticket_kind is distinct from v_kind
    or v_existing.provider_ticket_id is distinct from v_provider_id
  ) then
    raise exception 'SMARTSTORE_CS_TICKET_ACCOUNT_SCOPE_IMMUTABLE'
      using errcode='23514';
  end if;

  insert into sellerpilot_private.smartstore_cs_ticket_identities_v1(
    ticket_id,owner_id,seller_account_key,source_credential_id,
    provider_ticket_kind,provider_ticket_id,legacy_external_ticket_id,
    identity_contract,updated_at
  ) values(
    new.id,new.owner_id,v_credential.seller_account_key,new.source_credential_id,
    v_kind,v_provider_id,v_expected_legacy,v_contract,clock_timestamp()
  )
  on conflict(ticket_id) do update set
    identity_contract=case
      when excluded.identity_contract='smartstore-provider-ticket-v1'
        then excluded.identity_contract
      else sellerpilot_private.smartstore_cs_ticket_identities_v1.identity_contract
    end,
    updated_at=excluded.updated_at;
  return new;
end
$$;
revoke all on function
  sellerpilot_private.sync_smartstore_cs_ticket_identity_v1()
  from public,anon,authenticated,service_role;

create trigger sellerpilot_sync_smartstore_cs_ticket_identity_v1
after insert or update of owner_id,channel_key,external_ticket_id,demo,
  source_credential_id,channel_account_id,seller_account_key,provider_context
on sellerpilot_private.support_tickets
for each row execute function
  sellerpilot_private.sync_smartstore_cs_ticket_identity_v1();

insert into sellerpilot_private.smartstore_cs_ticket_identities_v1(
  ticket_id,owner_id,seller_account_key,source_credential_id,
  provider_ticket_kind,provider_ticket_id,legacy_external_ticket_id,
  identity_contract
)
select
  ticket.id,ticket.owner_id,ticket.seller_account_key,ticket.source_credential_id,
  ticket.provider_context->>'kind',
  case ticket.provider_context->>'kind'
    when 'product' then coalesce(
      nullif(ticket.provider_context->>'questionId',''),
      nullif(regexp_replace(ticket.external_ticket_id,'^smartstore:product-qna:',''),'')
    )
    when 'customer' then coalesce(
      nullif(ticket.provider_context->>'inquiryNo',''),
      nullif(regexp_replace(ticket.external_ticket_id,'^customer:',''),'')
    )
  end,
  ticket.external_ticket_id,
  case when ticket.provider_context->>'identityContract'
      ='smartstore-provider-ticket-v1'
    then 'smartstore-provider-ticket-v1'
    else 'smartstore-legacy-ticket-compat-v1' end
from sellerpilot_private.support_tickets ticket
join sellerpilot_private.channel_credentials credential
  on credential.id=ticket.source_credential_id
 and credential.created_by=ticket.owner_id
 and credential.channel='smartstore'
 and credential.environment='production'
 and credential.status in('active','grace')
 and credential.seller_account_key=ticket.seller_account_key
 and credential.seller_account_key_source in(
   'provider_certified_v1','credential_incarnation_v1'
 )
 and credential.seller_account_verified_at is not null
where ticket.channel_key='smartstore'
  and not ticket.demo
  and ticket.channel_account_id=ticket.source_credential_id
  and ticket.provider_context->>'kind' in('product','customer')
  and (
    (ticket.provider_context->>'kind'='product'
      and ticket.external_ticket_id~'^smartstore:product-qna:[1-9][0-9]{0,18}$')
    or
    (ticket.provider_context->>'kind'='customer'
      and ticket.external_ticket_id~'^customer:[1-9][0-9]{0,18}$')
  )
on conflict(ticket_id) do nothing;

create function public.sellerpilot_read_smartstore_cs_order_binding_health_v3(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_groups jsonb;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment='production'
     and credential.status='active'
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
     and (
       credential.expires_at is null
       or credential.expires_at>statement_timestamp()
     );
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;

  with projected as(
    select case
      when ticket.provider_context->>'kind'='product' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'not_applicable' else 'contract_mismatch' end
      when ticket.provider_context->>'kind'<>'customer'
        then 'contract_mismatch'
      when ticket.provider_context->>'orderReferenceState'
          ='exact_product_order' then
        case when jsonb_typeof(
                    ticket.provider_context->'productOrderIds'
                  )='array'
               and jsonb_array_length(
                    ticket.provider_context->'productOrderIds'
                  )=1
               and ticket.provider_context->'productOrderIds'->>0
                    ~'^[1-9][0-9]{0,19}$'
               and nullif(trim(ticket.external_order_reference),'')
                    =ticket.provider_context->'productOrderIds'->>0
               and binding.status in(
                 'exact','unmatched','unverified_credential'
               )
               and binding.credential_id=p_credential_id
          then binding.status else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState'
          ='ambiguous_product_orders' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'ambiguous_product_orders' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState'
          ='invalid_product_order_list' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'invalid_product_order_list' else 'contract_mismatch' end
      when ticket.provider_context->>'orderReferenceState'='unavailable' then
        case when nullif(trim(ticket.external_order_reference),'') is null
               and binding.status='not_applicable'
          then 'not_applicable' else 'contract_mismatch' end
      else 'contract_mismatch' end ui_status
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
    join sellerpilot_private.support_tickets ticket
      on ticket.id=identity.ticket_id
    join sellerpilot_private.cs_order_bindings binding
      on binding.ticket_id=ticket.id
    where identity.owner_id=v_credential.created_by
      and identity.seller_account_key=v_credential.seller_account_key
      and identity.source_credential_id=p_credential_id
      and ticket.owner_id=v_credential.created_by
      and ticket.source_credential_id=p_credential_id
      and ticket.seller_account_key=v_credential.seller_account_key
      and not ticket.demo
  ),grouped as(
    select ui_status status,count(*)::integer count
      from projected group by ui_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel','smartstore','status',status,'count',count
  )order by status),'[]'::jsonb)
    into v_groups from grouped;

  return jsonb_build_object(
    'contract','sellerpilot-cs-smartstore-order-binding-health/3',
    'projectionContract','smartstore-cs-order-binding-projection/1',
    'checkedAt',statement_timestamp(),
    'credentialId',p_credential_id,
    'accountScope',encode(extensions.digest(
      v_credential.seller_account_key,'sha256'
    ),'hex'),
    'matchingRule',
      'same_owner_account_source_credential_exact_product_order',
    'automaticOrderLinkState','exact',
    'csCommerceMutationAllowed',false,
    'groups',v_groups
  );
end
$$;

create function public.sellerpilot_read_smartstore_cs_account_ticket_v1(
  p_credential_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_identity sellerpilot_private.smartstore_cs_ticket_identities_v1%rowtype;
  v_ticket sellerpilot_private.support_tickets%rowtype;
  v_history jsonb;
  v_binding jsonb;
begin
  if auth.uid() is null
     or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='smartstore'
     and credential.environment='production'
     and credential.status in('active','grace')
     and credential.seller_account_key is not null
     and credential.seller_account_key_source in(
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;

  select identity.*
    into v_identity
    from sellerpilot_private.smartstore_cs_ticket_identities_v1 identity
    join sellerpilot_private.support_tickets ticket
      on ticket.id=identity.ticket_id
   where identity.ticket_id=p_ticket_id
     and identity.owner_id=v_credential.created_by
     and identity.seller_account_key=v_credential.seller_account_key
     and identity.source_credential_id=p_credential_id
     and ticket.owner_id=identity.owner_id
     and ticket.source_credential_id=identity.source_credential_id
     and ticket.seller_account_key=identity.seller_account_key
     and not ticket.demo;
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;
  select ticket.* into v_ticket
    from sellerpilot_private.support_tickets ticket
   where ticket.id=v_identity.ticket_id
     and ticket.owner_id=v_identity.owner_id
     and ticket.source_credential_id=v_identity.source_credential_id
     and ticket.seller_account_key=v_identity.seller_account_key
     and not ticket.demo;
  if not found then
    raise exception 'SMARTSTORE_CS_ACCOUNT_SCOPE_MISMATCH'
      using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'inboundKey',message.inbound_key,
    'remoteMessageId',message.remote_message_id,
    'senderRole',message.sender_role,
    'body',message.body,
    'receivedAt',message.received_at
  )order by message.received_at,message.id),'[]'::jsonb)
    into v_history
    from sellerpilot_private.support_inbound_messages message
   where message.ticket_id=v_ticket.id
     and message.owner_id=v_identity.owner_id
     and message.channel_key='smartstore';

  select case when binding.ticket_id is null then null else
    jsonb_build_object(
      'status',binding.status,
      'externalOrderReference',binding.external_order_reference,
      'orderId',binding.order_id,
      'credentialId',binding.credential_id
    ) end
    into v_binding
    from (select 1) seed
    left join sellerpilot_private.cs_order_bindings binding
      on binding.ticket_id=v_ticket.id
     and (
       binding.credential_id is null
       or binding.credential_id=p_credential_id
     );

  return jsonb_build_object(
    'contract','sellerpilot-cs-smartstore-account-ticket/1',
    'credentialId',p_credential_id,
    'accountScope',encode(extensions.digest(
      v_credential.seller_account_key,'sha256'
    ),'hex'),
    'identity',jsonb_build_object(
      'kind',v_identity.provider_ticket_kind,
      'providerTicketId',v_identity.provider_ticket_id,
      'legacyExternalTicketId',v_identity.legacy_external_ticket_id,
      'identityContract',v_identity.identity_contract
    ),
    'ticket',jsonb_build_object(
      'id',v_ticket.id,
      'message',v_ticket.message,
      'latestInboundKey',v_ticket.latest_inbound_key,
      'externalOrderReference',v_ticket.external_order_reference
    ),
    'history',v_history,
    'orderBinding',v_binding,
    'csCommerceMutationAllowed',false
  );
end
$$;

revoke all on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v2()
  from public,anon,authenticated,service_role;
revoke all on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v3(uuid)
  from public,anon,service_role;
grant execute on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v3(uuid)
  to authenticated;
revoke all on function
  public.sellerpilot_read_smartstore_cs_account_ticket_v1(uuid,uuid)
  from public,anon,service_role;
grant execute on function
  public.sellerpilot_read_smartstore_cs_account_ticket_v1(uuid,uuid)
  to authenticated;

comment on table
  sellerpilot_private.smartstore_cs_ticket_identities_v1 is
  'Compatibility sidecar preserving legacy SmartStore external IDs while binding each ticket to owner, seller account, and source credential.';
comment on function
  public.sellerpilot_read_smartstore_cs_order_binding_health_v3(uuid) is
  'Approved-admin read of one exact SmartStore owner/account/source-credential order-binding scope.';
comment on function
  public.sellerpilot_read_smartstore_cs_account_ticket_v1(uuid,uuid) is
  'Approved-admin ticket, inbound-history, and order-binding read within one exact SmartStore account scope.';

notify pgrst,'reload schema';
commit;
