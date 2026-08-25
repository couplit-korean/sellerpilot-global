-- TracX delivery callbacks may update an order only through an explicit,
-- typed provider-reference binding. SellerPilot is a shared admin workspace:
-- the TracX credential creator is not necessarily the owner assigned by the
-- source marketplace credential, so callback ownership must come from the
-- exact bound order.

begin;

-- Do not let this rollout wait indefinitely for a busy orders/events table.
-- A later deployment can retry the whole transaction without leaving a
-- partially installed callback fence.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create unique index if not exists commerce_orders_id_owner_idx
  on sellerpilot_private.commerce_orders (id, owner_id);

create table if not exists sellerpilot_private.tracx_order_bindings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  order_owner_id uuid not null,
  source_channel text not null,
  environment text not null check (environment in ('sandbox', 'production')),
  tracx_seller_account_key text not null
    check (tracx_seller_account_key ~ '^[a-f0-9]{64}$'),
  reference_kind text not null
    check (reference_kind in ('packing_no', 'reference_order_no')),
  reference_value text not null
    check (
      length(reference_value) between 1 and 240
      and reference_value = trim(reference_value)
      and reference_value !~ '[[:cntrl:]]'
    ),
  bound_with_credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  binding_source text not null
    check (binding_source in ('explicit_admin_v1', 'historical_event_v1')),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint tracx_order_bindings_order_owner_fkey
    foreign key (order_id, order_owner_id)
    references sellerpilot_private.commerce_orders(id, owner_id)
    on delete cascade,
  constraint tracx_order_bindings_one_order_key unique (order_id),
  constraint tracx_order_bindings_reference_scope_key
    unique (tracx_seller_account_key, reference_kind, reference_value),
  constraint tracx_order_bindings_actor_source_check check (
    (binding_source = 'explicit_admin_v1' and created_by is not null)
    or
    (binding_source = 'historical_event_v1' and created_by is null)
  )
);

create index if not exists tracx_order_bindings_owner_time_idx
  on sellerpilot_private.tracx_order_bindings (order_owner_id, created_at desc);

alter table sellerpilot_private.tracx_order_bindings enable row level security;
revoke all on sellerpilot_private.tracx_order_bindings
  from public, anon, authenticated, service_role;

alter table sellerpilot_private.tracx_delivery_events
  add column if not exists binding_id uuid
    references sellerpilot_private.tracx_order_bindings(id) on delete set null;

alter table sellerpilot_private.tracx_delivery_events
  alter column owner_id drop not null;

-- The previous owner/event key reflected the credential creator rather than
-- the matched order. Credential + event is the actual webhook retry scope and
-- remains idempotent even when an unmatched event has no owner yet.
alter table sellerpilot_private.tracx_delivery_events
  drop constraint if exists tracx_delivery_events_owner_id_event_key_key;
create unique index if not exists tracx_delivery_events_credential_event_key_idx
  on sellerpilot_private.tracx_delivery_events (credential_id, event_key);

-- Existing TracX orders are backfilled only when a persisted provider event
-- proves both the exact typed reference and the credential lineage. One event
-- must identify one order, one order must have one binding identity, and that
-- reference must identify only one order inside the TracX account scope.
-- Tracking numbers and marketplace external order numbers are never evidence.
with candidate_evidence as (
  select event.id as event_id,
         event.order_id as persisted_order_id,
         event.received_at,
         orders.id as order_id,
         orders.owner_id as order_owner_id,
         orders.channel_key as source_channel,
         credential.id as credential_id,
         credential.environment,
         credential.seller_account_key as tracx_seller_account_key,
         typed_reference.reference_kind,
         orders.logistics_reference as reference_value
    from sellerpilot_private.tracx_delivery_events event
    join sellerpilot_private.channel_credentials credential
      on credential.id = event.credential_id
     and credential.channel = 'tracx'
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
    join sellerpilot_private.commerce_orders orders
      on not orders.demo
     and orders.logistics_provider = 'tracx'
     and nullif(trim(orders.logistics_reference), '') is not null
     and (
       event.packing_no = orders.logistics_reference
       or event.reference_order_no = orders.logistics_reference
     )
    cross join lateral (
      select case
        when event.packing_no = orders.logistics_reference
         and event.reference_order_no is distinct from orders.logistics_reference
          then 'packing_no'::text
        when event.reference_order_no = orders.logistics_reference
         and event.packing_no is distinct from orders.logistics_reference
          then 'reference_order_no'::text
        else null::text
      end as reference_kind
    ) typed_reference
   where typed_reference.reference_kind is not null
), event_ranked as (
  select candidate_evidence.*,
         count(*) over (partition by candidate_evidence.event_id) as event_candidate_count
    from candidate_evidence
), event_unambiguous as (
  select event_ranked.*
    from event_ranked
   where event_ranked.event_candidate_count = 1
     and (
       event_ranked.persisted_order_id is null
       or event_ranked.persisted_order_id = event_ranked.order_id
     )
), binding_identities as (
  select evidence.order_id,
         evidence.order_owner_id,
         evidence.source_channel,
         evidence.environment,
         evidence.tracx_seller_account_key,
         evidence.reference_kind,
         evidence.reference_value,
         (array_agg(
           evidence.credential_id
           order by evidence.received_at desc, evidence.event_id desc
         ))[1] as bound_with_credential_id
    from event_unambiguous evidence
   group by evidence.order_id,
            evidence.order_owner_id,
            evidence.source_channel,
            evidence.environment,
            evidence.tracx_seller_account_key,
            evidence.reference_kind,
            evidence.reference_value
), binding_ranked as (
  select identity.*,
         count(*) over (partition by identity.order_id) as order_identity_count,
         count(*) over (
           partition by identity.tracx_seller_account_key,
                        identity.reference_kind,
                        identity.reference_value
         ) as reference_order_count
    from binding_identities identity
)
insert into sellerpilot_private.tracx_order_bindings (
  order_id,
  order_owner_id,
  source_channel,
  environment,
  tracx_seller_account_key,
  reference_kind,
  reference_value,
  bound_with_credential_id,
  binding_source,
  created_by
)
select identity.order_id,
       identity.order_owner_id,
       identity.source_channel,
       identity.environment,
       identity.tracx_seller_account_key,
       identity.reference_kind,
       identity.reference_value,
       identity.bound_with_credential_id,
       'historical_event_v1',
       null
  from binding_ranked identity
 where identity.order_identity_count = 1
   and identity.reference_order_count = 1
on conflict do nothing;

-- Attach an older unmatched event only when its typed provider reference and
-- credential account/incarnation identify exactly one explicit binding. Never
-- rewrite an event that was already attached to a different order.
with reconciliation_candidates as (
  select event.id as event_id,
         binding.id as binding_id,
         binding.order_id,
         binding.order_owner_id
    from sellerpilot_private.tracx_delivery_events event
    join sellerpilot_private.channel_credentials credential
      on credential.id = event.credential_id
     and credential.channel = 'tracx'
    join sellerpilot_private.tracx_order_bindings binding
      on binding.environment = credential.environment
     and binding.tracx_seller_account_key = credential.seller_account_key
     and (
       (
         credential.seller_account_key_source = 'provider_certified_v1'
         and binding.tracx_seller_account_key = credential.seller_account_key
       )
       or
       (
         credential.seller_account_key_source = 'credential_incarnation_v1'
         and binding.bound_with_credential_id = credential.id
       )
     )
     and (
       (
         binding.reference_kind = 'packing_no'
         and event.packing_no = binding.reference_value
       )
       or
       (
         binding.reference_kind = 'reference_order_no'
         and event.reference_order_no = binding.reference_value
       )
     )
    join sellerpilot_private.commerce_orders orders
      on orders.id = binding.order_id
     and orders.owner_id = binding.order_owner_id
     and not orders.demo
     and orders.logistics_provider = 'tracx'
     and orders.logistics_reference = binding.reference_value
   where event.order_id is null
      or event.order_id = binding.order_id
), reconciliation_ranked as (
  select candidate.*,
         count(*) over (partition by candidate.event_id) as candidate_count
    from reconciliation_candidates candidate
), safe_reconciliation as (
  select candidate.event_id,
         candidate.binding_id,
         candidate.order_id,
         candidate.order_owner_id
    from reconciliation_ranked candidate
   where candidate.candidate_count = 1
)
update sellerpilot_private.tracx_delivery_events event
   set owner_id = safe.order_owner_id,
       order_id = safe.order_id,
       binding_id = safe.binding_id
  from safe_reconciliation safe
 where event.id = safe.event_id
   and (event.order_id is null or event.order_id = safe.order_id);

-- Apply only the newest safely attached historical event per order. This is a
-- reconciliation of exact evidence, not a second matching strategy.
with latest_event as (
  select distinct on (event.order_id)
         event.order_id,
         event.owner_id as order_owner_id,
         event.tracking_no,
         event.status_code,
         event.status_desc,
         coalesce(event.event_at, event.received_at) as effective_event_at
    from sellerpilot_private.tracx_delivery_events event
    join sellerpilot_private.tracx_order_bindings binding
      on binding.id = event.binding_id
     and binding.order_id = event.order_id
     and binding.order_owner_id = event.owner_id
   where event.order_id is not null
   order by event.order_id,
            coalesce(event.event_at, event.received_at) desc,
            event.received_at desc,
            event.id desc
)
update sellerpilot_private.commerce_orders orders
   set tracking_number = coalesce(latest.tracking_no, orders.tracking_number),
       delivery_status_code = latest.status_code,
       delivery_status_desc = latest.status_desc,
       delivery_status_at = latest.effective_event_at,
       status = case
         when latest.status_code = 'D4'
          and orders.status not in ('cancelled', 'refunded') then 'delivered'
         else orders.status
       end,
       delivered_at = case
         when latest.status_code = 'D4'
          and orders.status not in ('cancelled', 'refunded')
           then coalesce(orders.delivered_at, latest.effective_event_at)
         else orders.delivered_at
       end,
       updated_at = clock_timestamp()
  from latest_event latest
 where orders.id = latest.order_id
   and orders.owner_id = latest.order_owner_id
   and orders.logistics_provider = 'tracx'
   and (
     orders.delivery_status_at is null
     or latest.effective_event_at >= orders.delivery_status_at
   );

-- A live order without exact typed evidence must be bound manually before the
-- rollout. Guessing PackingNo versus RefOrderNo would recreate the unsafe
-- callback fallback this migration removes. Terminal history may remain
-- unbound because no callback can mutate it through the new ingest function.
do $$
begin
  if exists (
    select 1
      from sellerpilot_private.commerce_orders orders
     where not orders.demo
       and orders.logistics_provider = 'tracx'
       and orders.status in ('paid', 'ready_to_ship', 'shipped')
       and not exists (
         select 1
           from sellerpilot_private.tracx_order_bindings binding
          where binding.order_id = orders.id
            and binding.order_owner_id = orders.owner_id
       )
  ) then
    raise exception 'nonterminal TracX orders require an exact typed binding before rollout';
  end if;
end
$$;

create or replace function public.sellerpilot_bind_tracx_order(
  p_order_id uuid,
  p_reference_kind text,
  p_reference_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order record;
  v_credential record;
  v_existing sellerpilot_private.tracx_order_bindings%rowtype;
  v_existing_credential record;
  v_conflicting_order_id uuid;
  v_reference_kind text := trim(coalesce(p_reference_kind, ''));
  v_reference_value text := trim(coalesce(p_reference_value, ''));
  v_binding_id uuid;
begin
  if v_actor is null
     or not public.sellerpilot_is_admin()
     or p_order_id is null
     or v_reference_kind not in ('packing_no', 'reference_order_no')
     or length(v_reference_value) not between 1 and
       (case when v_reference_kind = 'packing_no' then 100 else 240 end)
     or v_reference_value ~ '[[:cntrl:]]' then
    raise exception 'invalid TracX order binding' using errcode = '42501';
  end if;

  select orders.id, orders.owner_id, orders.channel_key,
         orders.logistics_provider, orders.logistics_reference
    into v_order
    from sellerpilot_private.commerce_orders orders
   where orders.id = p_order_id
     and not orders.demo
   for update;
  if not found then
    raise exception 'real order not found' using errcode = 'P0002';
  end if;

  select credential.id,
         credential.environment,
         credential.seller_account_key,
         credential.seller_account_key_source
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'tracx'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     )
   for share;
  if not found then
    raise exception 'active production TracX credential required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    195365769,
    pg_catalog.hashtext(concat_ws(
      ':', v_credential.seller_account_key, v_reference_kind, v_reference_value
    ))
  );

  select binding.*
    into v_existing
    from sellerpilot_private.tracx_order_bindings binding
   where binding.order_id = v_order.id
   for update;
  if found then
    if v_existing.environment <> v_credential.environment
       or v_existing.reference_kind <> v_reference_kind
       or v_existing.reference_value <> v_reference_value then
      raise exception 'TracX order is already bound to another reference'
        using errcode = '23505';
    end if;

    -- A static API-key rotation intentionally receives a new credential
    -- incarnation. An administrator may move the exact same typed reference
    -- on the exact same order to the new active incarnation. No account,
    -- order, kind, or reference-value inference is permitted.
    if v_existing.tracx_seller_account_key <> v_credential.seller_account_key
       or (
         v_credential.seller_account_key_source = 'credential_incarnation_v1'
         and v_existing.bound_with_credential_id <> v_credential.id
       ) then
      if v_order.logistics_provider is distinct from 'tracx'
         or v_order.logistics_reference is distinct from v_existing.reference_value then
        raise exception 'order logistics binding conflicts with existing provider'
          using errcode = '23505';
      end if;
      select existing_credential.id,
             existing_credential.seller_account_key,
             existing_credential.seller_account_key_source
        into v_existing_credential
        from sellerpilot_private.channel_credentials existing_credential
       where existing_credential.id = v_existing.bound_with_credential_id
         and existing_credential.channel = 'tracx'
       for share;
      if not found
         or v_existing_credential.seller_account_key_source <> 'credential_incarnation_v1'
         or v_existing_credential.seller_account_key <> v_existing.tracx_seller_account_key
         or v_credential.seller_account_key_source <> 'credential_incarnation_v1' then
        raise exception 'TracX order is bound to another credential lineage'
          using errcode = '23505';
      end if;

      select binding.order_id
        into v_conflicting_order_id
        from sellerpilot_private.tracx_order_bindings binding
       where binding.tracx_seller_account_key = v_credential.seller_account_key
         and binding.reference_kind = v_reference_kind
         and binding.reference_value = v_reference_value
         and binding.order_id <> v_order.id
       for update;
      if found then
        raise exception 'TracX reference is already bound to another order'
          using errcode = '23505';
      end if;

      -- Deleting the old binding nulls only the binding_id on historical
      -- events. Their order/owner evidence remains immutable, while a callback
      -- authenticated by the old credential can no longer reach the order.
      delete from sellerpilot_private.tracx_order_bindings binding
       where binding.id = v_existing.id;
      insert into sellerpilot_private.tracx_order_bindings (
        order_id,
        order_owner_id,
        source_channel,
        environment,
        tracx_seller_account_key,
        reference_kind,
        reference_value,
        bound_with_credential_id,
        binding_source,
        created_by
      ) values (
        v_order.id,
        v_order.owner_id,
        v_order.channel_key,
        v_credential.environment,
        v_credential.seller_account_key,
        v_reference_kind,
        v_reference_value,
        v_credential.id,
        'explicit_admin_v1',
        v_actor
      ) returning id into v_binding_id;

      insert into sellerpilot_private.operation_audit (
        owner_id,
        action,
        entity_type,
        entity_id,
        safe_detail
      ) values (
        v_order.owner_id,
        'tracx_order_rebound',
        'order',
        v_order.id::text,
        jsonb_build_object(
          'actor_id', v_actor,
          'source_channel', v_order.channel_key,
          'environment', v_credential.environment,
          'reference_kind', v_reference_kind,
          'previous_credential_id', v_existing.bound_with_credential_id,
          'credential_id', v_credential.id
        )
      );

      return jsonb_build_object(
        'bindingId', v_binding_id,
        'orderId', v_order.id,
        'orderOwnerId', v_order.owner_id,
        'sourceChannel', v_order.channel_key,
        'environment', v_credential.environment,
        'referenceKind', v_reference_kind,
        'referenceValue', v_reference_value,
        'replayed', false,
        'rebound', true
      );
    end if;

    if v_order.logistics_provider is null
       and v_order.logistics_reference is null then
      update sellerpilot_private.commerce_orders orders
         set logistics_provider = 'tracx',
             logistics_reference = v_existing.reference_value,
             updated_at = clock_timestamp()
       where orders.id = v_existing.order_id
         and orders.owner_id = v_existing.order_owner_id;
    elsif v_order.logistics_provider is distinct from 'tracx'
       or v_order.logistics_reference is distinct from v_existing.reference_value then
      raise exception 'order logistics binding conflicts with existing provider'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'bindingId', v_existing.id,
      'orderId', v_existing.order_id,
      'orderOwnerId', v_existing.order_owner_id,
      'sourceChannel', v_existing.source_channel,
      'environment', v_existing.environment,
      'referenceKind', v_existing.reference_kind,
      'referenceValue', v_existing.reference_value,
      'replayed', true
    );
  end if;

  if (v_order.logistics_provider is not null or v_order.logistics_reference is not null)
     and (
       v_order.logistics_provider is distinct from 'tracx'
       or v_order.logistics_reference is distinct from v_reference_value
     ) then
    raise exception 'order logistics binding conflicts with existing provider'
      using errcode = '23505';
  end if;

  select binding.order_id
    into v_conflicting_order_id
    from sellerpilot_private.tracx_order_bindings binding
   where binding.tracx_seller_account_key = v_credential.seller_account_key
     and binding.reference_kind = v_reference_kind
     and binding.reference_value = v_reference_value
   for update;
  if found and v_conflicting_order_id <> v_order.id then
    raise exception 'TracX reference is already bound to another order'
      using errcode = '23505';
  end if;

  insert into sellerpilot_private.tracx_order_bindings (
    order_id,
    order_owner_id,
    source_channel,
    environment,
    tracx_seller_account_key,
    reference_kind,
    reference_value,
    bound_with_credential_id,
    binding_source,
    created_by
  ) values (
    v_order.id,
    v_order.owner_id,
    v_order.channel_key,
    v_credential.environment,
    v_credential.seller_account_key,
    v_reference_kind,
    v_reference_value,
    v_credential.id,
    'explicit_admin_v1',
    v_actor
  ) returning id into v_binding_id;

  update sellerpilot_private.commerce_orders orders
     set logistics_provider = 'tracx',
         logistics_reference = v_reference_value,
         updated_at = clock_timestamp()
   where orders.id = v_order.id
     and orders.owner_id = v_order.owner_id;
  if not found then
    raise exception 'order changed during TracX binding' using errcode = '40001';
  end if;

  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail
  ) values (
    v_order.owner_id,
    'tracx_order_bound',
    'order',
    v_order.id::text,
    jsonb_build_object(
      'actor_id', v_actor,
      'source_channel', v_order.channel_key,
      'environment', v_credential.environment,
      'credential_lineage_source', v_credential.seller_account_key_source,
      'reference_kind', v_reference_kind
    )
  );

  return jsonb_build_object(
    'bindingId', v_binding_id,
    'orderId', v_order.id,
    'orderOwnerId', v_order.owner_id,
    'sourceChannel', v_order.channel_key,
    'environment', v_credential.environment,
    'referenceKind', v_reference_kind,
    'referenceValue', v_reference_value,
    'replayed', false
  );
end;
$$;

create or replace function public.sellerpilot_service_ingest_tracx_delivery(
  p_credential_id uuid,
  p_event jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
  v_credential_seller_account_key text;
  v_credential_seller_account_key_source text;
  v_binding_id uuid;
  v_order_id uuid;
  v_order_owner uuid;
  v_persisted_order_id uuid;
  v_candidate_count integer := 0;
  v_event_key text;
  v_packing text := left(trim(coalesce(p_event->>'PackingNo', '')), 100);
  v_tracking text := left(trim(coalesce(p_event->>'TrackingNo', '')), 100);
  v_reference text := left(trim(coalesce(p_event->>'RefOrderNo', '')), 240);
  v_status text := upper(left(trim(coalesce(p_event->>'StatusCode', '')), 20));
  v_status_desc text := left(trim(coalesce(p_event->>'StatusDesc', '')), 240);
  v_event_at timestamptz;
begin
  if jsonb_typeof(p_event) <> 'object'
     or octet_length(p_event::text) > 16000
     or v_status = ''
     or (v_packing = '' and v_tracking = '' and v_reference = '') then
    raise exception 'invalid TracX delivery event' using errcode = '42501';
  end if;

  select credential.environment,
         credential.seller_account_key,
         credential.seller_account_key_source
    into v_environment,
         v_credential_seller_account_key,
         v_credential_seller_account_key_source
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'tracx'
     and credential.status in ('active', 'grace')
     and (
       credential.status = 'active'
       or credential.grace_ends_at is null
       or credential.grace_ends_at > clock_timestamp()
     )
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1', 'credential_incarnation_v1'
     );
  if v_environment is null then
    raise exception 'TracX credential not found' using errcode = '42501';
  end if;

  begin
    v_event_at := nullif(trim(coalesce(p_event->>'Date', '')), '')::timestamptz;
  exception when others then
    v_event_at := null;
  end;

  -- PackingNo and RefOrderNo have distinct namespaces. TrackingNo and the
  -- marketplace external order number are deliberately never candidates.
  select count(distinct candidate.order_id)::integer,
         (array_agg(candidate.binding_id order by candidate.binding_id))[1],
         (array_agg(candidate.order_id order by candidate.binding_id))[1],
         (array_agg(candidate.order_owner_id order by candidate.binding_id))[1]
    into v_candidate_count, v_binding_id, v_order_id, v_order_owner
    from (
      select binding.id as binding_id,
             binding.order_id,
             binding.order_owner_id
        from sellerpilot_private.tracx_order_bindings binding
        join sellerpilot_private.commerce_orders orders
          on orders.id = binding.order_id
         and orders.owner_id = binding.order_owner_id
       where binding.environment = v_environment
         and binding.tracx_seller_account_key = v_credential_seller_account_key
         and (
           (
             v_credential_seller_account_key_source = 'provider_certified_v1'
             and binding.tracx_seller_account_key = v_credential_seller_account_key
           )
           or
           (
             v_credential_seller_account_key_source = 'credential_incarnation_v1'
             and binding.bound_with_credential_id = p_credential_id
           )
         )
         and not orders.demo
         and orders.logistics_provider = 'tracx'
         and orders.logistics_reference = binding.reference_value
         and (
           (
             binding.reference_kind = 'packing_no'
             and v_packing <> ''
             and binding.reference_value = v_packing
           )
           or (
             binding.reference_kind = 'reference_order_no'
             and v_reference <> ''
             and binding.reference_value = v_reference
           )
         )
    ) candidate;

  if v_candidate_count <> 1 then
    v_binding_id := null;
    v_order_id := null;
    v_order_owner := null;
  end if;

  v_event_key := encode(extensions.digest(concat_ws('|',
    v_packing,
    v_tracking,
    v_reference,
    v_status,
    coalesce(p_event->>'Date', ''),
    coalesce(p_event->>'DeliveryCompanyCode', '')
  ), 'sha256'), 'hex');

  insert into sellerpilot_private.tracx_delivery_events (
    owner_id,
    credential_id,
    event_key,
    packing_no,
    tracking_no,
    reference_order_no,
    delivery_company_code,
    status_code,
    status_desc,
    event_at,
    order_id,
    binding_id
  ) values (
    v_order_owner,
    p_credential_id,
    v_event_key,
    nullif(v_packing, ''),
    nullif(v_tracking, ''),
    nullif(v_reference, ''),
    nullif(left(trim(coalesce(p_event->>'DeliveryCompanyCode', '')), 40), ''),
    v_status,
    nullif(v_status_desc, ''),
    v_event_at,
    v_order_id,
    v_binding_id
  ) on conflict (credential_id, event_key) do update
      set owner_id = coalesce(excluded.owner_id, sellerpilot_private.tracx_delivery_events.owner_id),
          order_id = coalesce(excluded.order_id, sellerpilot_private.tracx_delivery_events.order_id),
          binding_id = coalesce(excluded.binding_id, sellerpilot_private.tracx_delivery_events.binding_id)
    where sellerpilot_private.tracx_delivery_events.order_id is null
       or sellerpilot_private.tracx_delivery_events.order_id = excluded.order_id
  returning order_id into v_persisted_order_id;

  if v_order_id is not null
     and (not found or v_persisted_order_id is distinct from v_order_id) then
    v_binding_id := null;
    v_order_id := null;
    v_order_owner := null;
  end if;

  if v_order_id is not null then
    update sellerpilot_private.commerce_orders orders
       set tracking_number = coalesce(nullif(v_tracking, ''), orders.tracking_number),
           delivery_status_code = v_status,
           delivery_status_desc = nullif(v_status_desc, ''),
           delivery_status_at = coalesce(v_event_at, clock_timestamp()),
           status = case
             when v_status = 'D4'
              and orders.status not in ('cancelled', 'refunded') then 'delivered'
             else orders.status
           end,
           delivered_at = case
             when v_status = 'D4'
              and orders.status not in ('cancelled', 'refunded')
               then coalesce(orders.delivered_at, v_event_at, clock_timestamp())
             else orders.delivered_at
           end,
           updated_at = clock_timestamp()
     where orders.id = v_order_id
       and orders.owner_id = v_order_owner
       and orders.logistics_provider = 'tracx'
       and exists (
         select 1
           from sellerpilot_private.tracx_order_bindings binding
          where binding.id = v_binding_id
            and binding.order_id = orders.id
            and binding.order_owner_id = orders.owner_id
       )
       and (
         orders.delivery_status_at is null
         or coalesce(v_event_at, clock_timestamp()) >= orders.delivery_status_at
       );
  end if;

  return v_order_id is not null;
end;
$$;

revoke all on function public.sellerpilot_bind_tracx_order(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.sellerpilot_bind_tracx_order(uuid, text, text)
  to authenticated;

revoke all on function public.sellerpilot_service_ingest_tracx_delivery(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ingest_tracx_delivery(uuid, jsonb)
  to service_role;

commit;
