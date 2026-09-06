-- Persist incomplete product intake and channel publication forms without
-- mutating the product, approval, listing, permit, or provider ledgers.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900702300);

create or replace function sellerpilot_private.product_registration_draft_data_is_safe(
  p_data jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  with recursive value_walk(value, depth, object_key) as (
    select p_data, 0, null::text
    union all
    select child.value, value_walk.depth + 1, child.object_key
      from value_walk
      cross join lateral (
        select object_entry.value, object_entry.key as object_key
          from pg_catalog.jsonb_each(
            case when pg_catalog.jsonb_typeof(value_walk.value) = 'object'
              then value_walk.value else '{}'::jsonb end
          ) object_entry
        union all
        select array_entry.value, null::text
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(value_walk.value) = 'array'
              then value_walk.value else '[]'::jsonb end
          ) array_entry
      ) child
     where value_walk.depth <= 16
  )
  select coalesce(
    pg_catalog.jsonb_typeof(p_data) = 'object'
    and pg_catalog.octet_length(p_data::text) <= 262144
    and count(*) <= 4096
    and max(depth) <= 16
    and bool_and(
      object_key is null
      or (
        pg_catalog.char_length(object_key) between 1 and 128
        and object_key not in ('__proto__', 'prototype', 'constructor')
        and object_key !~ '[[:cntrl:]]'
      )
    ),
    false
  )
    from value_walk;
$$;

revoke all on function sellerpilot_private.product_registration_draft_data_is_safe(jsonb)
  from public, anon, authenticated, service_role;

create table sellerpilot_private.product_registration_drafts (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid not null,
  kind text not null check (kind in ('intake', 'publish')),
  product_id uuid references sellerpilot_private.products(id) on delete restrict,
  version bigint not null check (version between 1 and 2147483647),
  data jsonb not null check (
    sellerpilot_private.product_registration_draft_data_is_safe(data)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_registration_drafts_owner_kind_draft_key
    unique (owner_id, kind, draft_id)
);

create index product_registration_drafts_product_idx
  on sellerpilot_private.product_registration_drafts (owner_id, product_id)
  where product_id is not null;

alter table sellerpilot_private.product_registration_drafts enable row level security;
revoke all on sellerpilot_private.product_registration_drafts
  from public, anon, authenticated, service_role;
revoke all on sequence sellerpilot_private.product_registration_drafts_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.sellerpilot_service_get_product_registration_draft(
  p_owner_id uuid,
  p_draft_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row sellerpilot_private.product_registration_drafts%rowtype;
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_owner_id is null
     or p_draft_id is null
     or p_kind not in ('intake', 'publish') then
    raise exception 'PRODUCT_REGISTRATION_DRAFT_QUERY_INVALID' using errcode = '22023';
  end if;

  select draft.* into v_row
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = p_owner_id
     and draft.kind = p_kind
     and draft.draft_id = p_draft_id;
  if v_row.id is null then return null; end if;

  return pg_catalog.jsonb_build_object(
    'draftId', v_row.draft_id,
    'kind', v_row.kind,
    'productId', v_row.product_id,
    'version', v_row.version,
    'data', v_row.data,
    'updatedAt', v_row.updated_at
  );
end;
$$;

create or replace function public.sellerpilot_service_put_product_registration_draft(
  p_owner_id uuid,
  p_draft_id uuid,
  p_kind text,
  p_product_id uuid,
  p_expected_version bigint,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row sellerpilot_private.product_registration_drafts%rowtype;
  v_product_id uuid;
  v_updated_at timestamptz := pg_catalog.clock_timestamp();
begin
  if coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_owner_id is null
     or p_draft_id is null
     or p_kind not in ('intake', 'publish')
     or p_expected_version is null
     or p_expected_version < 0
     or p_expected_version > 2147483647 then
    raise exception 'PRODUCT_REGISTRATION_DRAFT_QUERY_INVALID' using errcode = '22023';
  end if;
  if not sellerpilot_private.product_registration_draft_data_is_safe(p_data) then
    raise exception 'PRODUCT_REGISTRATION_DRAFT_DATA_INVALID' using errcode = '22023';
  end if;
  if p_product_id is not null and not exists (
    select 1
      from sellerpilot_private.products product
     where product.id = p_product_id
       and product.owner_id = p_owner_id
  ) then
    raise exception 'PRODUCT_REGISTRATION_DRAFT_PRODUCT_NOT_OWNED' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_owner_id::text || ':' || p_kind || ':' || p_draft_id::text,
      900702300
    )
  );

  select draft.* into v_row
    from sellerpilot_private.product_registration_drafts draft
   where draft.owner_id = p_owner_id
     and draft.kind = p_kind
     and draft.draft_id = p_draft_id
   for update;

  if v_row.id is null then
    if p_expected_version <> 0 then
      raise exception 'PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT' using errcode = '40001';
    end if;
    insert into sellerpilot_private.product_registration_drafts (
      owner_id, draft_id, kind, product_id, version, data, updated_at
    ) values (
      p_owner_id, p_draft_id, p_kind, p_product_id, 1, p_data, v_updated_at
    )
    returning * into v_row;
  else
    if p_expected_version is distinct from v_row.version then
      raise exception 'PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT' using errcode = '40001';
    end if;
    if v_row.version >= 2147483647 then
      raise exception 'PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT' using errcode = '40001';
    end if;
    if v_row.product_id is not null
       and p_product_id is not null
       and p_product_id is distinct from v_row.product_id then
      raise exception 'PRODUCT_REGISTRATION_DRAFT_PRODUCT_REBIND_FORBIDDEN'
        using errcode = '55000';
    end if;
    v_product_id := coalesce(v_row.product_id, p_product_id);

    update sellerpilot_private.product_registration_drafts draft
       set product_id = v_product_id,
           version = draft.version + 1,
           data = p_data,
           updated_at = v_updated_at
     where draft.id = v_row.id
       and draft.version = p_expected_version
    returning * into v_row;
    if v_row.id is null then
      raise exception 'PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT' using errcode = '40001';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'draftId', v_row.draft_id,
    'kind', v_row.kind,
    'productId', v_row.product_id,
    'version', v_row.version,
    'data', v_row.data,
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke all on function public.sellerpilot_service_get_product_registration_draft(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.sellerpilot_service_put_product_registration_draft(uuid, uuid, text, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.sellerpilot_service_get_product_registration_draft(uuid, uuid, text)
  to service_role;
grant execute on function public.sellerpilot_service_put_product_registration_draft(uuid, uuid, text, uuid, bigint, jsonb)
  to service_role;

commit;
